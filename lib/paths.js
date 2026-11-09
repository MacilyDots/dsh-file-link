/* dsh-file-link — path recognition and `dsh-resource://` address construction.
 *
 * Pure logic, no DOM: this module is loaded by the Client half and is also
 * unit-testable under plain Node.
 *
 * Two jobs:
 *   1. Decide which spans of a text node look like file references the Host
 *      can actually resolve. Over-matching turns prose into links, so the
 *      recognizer is deliberately biased toward paths that carry a separator
 *      or a known file extension.
 *   2. Rebuild the `dsh-resource://file/session/<id>/<path>` address grammar
 *      the Sidebar uses. Copied from `@deepseek-ai/dsh-util-workspace-path`
 *      because a plugin may not import Harness packages as modules; the
 *      grammar is stable across the 0.1.x-0.2.x line.
 */

/** File extensions treated as a real file reference when the token has no separator. */
const BARE_NAME_EXTENSIONS = new Set([
  // code
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'cts', 'mts', 'json', 'jsonc', 'json5',
  'py', 'pyi', 'rb', 'go', 'rs', 'java', 'kt', 'kts', 'swift', 'c', 'h', 'cc', 'cpp',
  'cxx', 'hpp', 'cs', 'php', 'pl', 'pm', 'lua', 'r', 'jl', 'dart', 'scala', 'clj',
  'ex', 'exs', 'erl', 'hrl', 'fs', 'fsx', 'vb', 'asm', 's', 'sql', 'graphql', 'gql',
  'proto', 'thrift', 'vue', 'svelte', 'astro', 'elm', 'ml', 'mli', 'nim', 'zig', 'v',
  'sol', 'move', 'cairo', 'wat', 'wasm',
  // docs & config
  'md', 'mdx', 'markdown', 'rst', 'txt', 'text', 'adoc', 'org', 'tex', 'bib',
  'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'properties', 'env', 'editorconfig',
  'gitignore', 'gitattributes', 'dockerignore', 'npmrc', 'nvmrc', 'babelrc',
  'eslintrc', 'prettierrc', 'stylelintrc', 'browserslistrc', 'lock',
  // web & assets
  'html', 'htm', 'xhtml', 'css', 'scss', 'sass', 'less', 'styl', 'stylus',
  'svg', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'tiff',
  'psd', 'ai', 'sketch', 'fig', 'xd', 'mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac',
  'mp4', 'mov', 'avi', 'mkv', 'webm', 'wmv', 'flv', 'm4v',
  'ttf', 'otf', 'woff', 'woff2', 'eot',
  // data
  'csv', 'tsv', 'psv', 'xml', 'plist', 'db', 'sqlite', 'sqlite3', 'parquet',
  'avro', 'ndjson', 'jsonl', 'xlsx', 'xls', 'xlsm', 'ods',
  // packages & archives
  'tgz', 'tar', 'gz', 'bz2', 'xz', 'zst', 'zip', 'rar', '7z', 'jar', 'war',
  'whl', 'egg', 'gem', 'nupkg', 'deb', 'rpm', 'dmg', 'pkg', 'msi', 'appimage',
  'iso', 'img', 'vhd', 'vmdk',
  // misc
  'log', 'out', 'err', 'pid', 'sock', 'patch', 'diff', 'bak', 'tmp', 'temp',
  'crt', 'key', 'pem', 'cer', 'p12', 'pfx', 'jks', 'keystore',
  'ipynb', 'rmd', 'qmd', 'drawio', 'excalidraw', 'canvas', 'board',
]);

/** Trailing line/column annotations: `:12`, `:12:5`, ` (line 12)`, `, line 12`. */
const TRAILING_ANNOTATION = /(?:\s*[,(]\s*(?:line|lines|行)\s*\d+(?:\s*[-–]\s*\d+)?\s*\)?|\s*:\s*\d+(?:\s*[:,]\s*\d+)?)$/i;

/**
 * Whether a path uses a Windows drive or UNC prefix.
 * @param {string} value candidate text
 * @returns {boolean}
 */
export function isWindowsStylePath(value) {
  return /^[A-Za-z]:[/\\]/.test(value) || value.startsWith('\\\\');
}

/**
 * Whether a path is absolute in either spelling the Host accepts.
 * @param {string} path candidate text
 * @returns {boolean}
 */
export function isAbsoluteWorkspacePath(path) {
  return path.startsWith('/') || isWindowsStylePath(path);
}

/**
 * Extract the extension of a candidate token, lowercased and without the dot.
 * @param {string} token candidate text
 * @returns {string}
 */
function extensionOf(token) {
  const base = token.split(/[/\\]/).pop() || '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return '';
  return base.slice(dot + 1).toLowerCase();
}

/**
 * Whether a candidate token looks like a path the Host could resolve.
 *
 * Accepted: anything carrying a separator (relative or absolute), and bare
 * filenames whose extension is a known file type. Rejected: bare English
 * words, URLs, and tokens whose only "extension" is not a known type, so prose
 * such as "check the foo.bar handler" stays inert.
 *
 * @param {string} token candidate text
 * @returns {boolean}
 */
export function looksLikeFilePath(token) {
  if (token.length === 0 || token.length > 1024) return false;
  // Never treat a URL host or an explicit scheme as a path.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(token)) return false;
  if (token.startsWith('//')) return false;
  if (isAbsoluteWorkspacePath(token)) return true;
  if (token.includes('/') || token.includes('\\')) {
    // A relative path must still name a file, not just a directory segment.
    const ext = extensionOf(token);
    if (ext === '') return false;
    return BARE_NAME_EXTENSIONS.has(ext);
  }
  const ext = extensionOf(token);
  if (ext === '') return false;
  if (!BARE_NAME_EXTENSIONS.has(ext)) return false;
  // A bare reference is exactly `name.ext`. A second dot means a version
  // number (`1.2.3`), a sentence ending (`see a.b.c.`), or a dotted module
  // path — none of which the Host resolves as a file.
  const base = token.split(/[/\\]/).pop() || '';
  if ((base.match(/\./g) || []).length !== 1) return false;
  // Reject tokens that begin with a non-path character class (e.g. `e.g`).
  if (/^[^\w.\-\\/]/.test(token)) return false;
  return true;
}

/**
 * Split a trailing `:line` / `:line:col` / ` (line N)` annotation off a match.
 *
 * The annotation is not part of the path; it becomes the `line` parameter of
 * the preview so the file opens scrolled to the referenced row.
 *
 * @param {string} raw matched text
 * @returns {{ path: string, line: number | undefined, col: number | undefined }}
 */
export function splitAnnotation(raw) {
  const match = TRAILING_ANNOTATION.exec(raw);
  if (!match) return { path: raw, line: undefined, col: undefined };
  const tail = match[0];
  const path = raw.slice(0, raw.length - tail.length);
  if (path.length === 0) return { path: raw, line: undefined, col: undefined };
  const numbers = tail.match(/\d+/g);
  if (!numbers || numbers.length === 0) return { path, line: undefined, col: undefined };
  const line = Number(numbers[0]);
  const col = numbers.length > 1 ? Number(numbers[1]) : undefined;
  return { path, line: Number.isFinite(line) ? line : undefined, col };
}

/**
 * Build the `dsh-resource://file/session/<sessionId>/<path>` address.
 *
 * Mirrors `sessionFileAddress` / `fileAddressFor` from
 * `@deepseek-ai/dsh-util-workspace-path`: relative paths stay
 * session-relative, absolute paths inside the workspace are made relative to
 * it, and everything else keeps its absolute spelling. `:` stays literal so
 * drive letters survive encoding.
 *
 * @param {string} sessionId session that resolves the path
 * @param {string | undefined} cwd session workspace root
 * @param {string} path absolute or workspace-relative path
 * @returns {string} resource address
 */
export function fileAddressFor(sessionId, cwd, path) {
  const normalized = String(path).replace(/\\/g, '/');
  const encodeSegment = (segment) => encodeURIComponent(segment).replace(/%3A/gi, ':');
  const encodePath = (value) => value.split('/').map(encodeSegment).join('/');
  const sessionFile = (relative) =>
    `dsh-resource://file/session/${encodeSegment(sessionId)}/${encodePath(relative)}`;

  if (!isAbsoluteWorkspacePath(normalized)) return sessionFile(normalized);
  const root = cwd === undefined || cwd === null ? '' : String(cwd).replace(/\\/g, '/').replace(/\/+$/, '');
  if (root !== '' && normalized === root) return sessionFile('');
  if (root !== '' && normalized.startsWith(`${root}/`)) return sessionFile(normalized.slice(root.length + 1));
  return sessionFile(normalized);
}

/**
 * Resolve a workspace-relative path against the session root.
 *
 * `remote.session.openWorkspacePath` resolves against the Host process
 * directory, not the session workspace, so relative references must be
 * absolutized on the Client before they are handed over.
 *
 * @param {string | undefined} cwd session workspace root
 * @param {string} path absolute or workspace-relative path
 * @returns {string} absolute path, or the input when no root is known
 */
export function resolveWorkspacePath(cwd, path) {
  if (isAbsoluteWorkspacePath(path)) return path;
  if (cwd === undefined || cwd === null || cwd === '') return path;
  const separator = isWindowsStylePath(cwd) && cwd.includes('\\') ? '\\' : '/';
  return `${String(cwd).replace(/[/\\]+$/, '')}${separator}${path.replace(/^[/\\]+/, '')}`;
}

/**
 * Find every file reference inside one text run.
 *
 * The scanner is separator-first: absolute paths are matched greedily, then
 * relative paths carrying a separator, then bare filenames with a known
 * extension. Overlaps are resolved by taking the earliest match.
 *
 * @param {string} text text of one node
 * @returns {Array<{ start: number, end: number, raw: string }>} non-overlapping matches in order
 */
export function findPathMatches(text) {
  if (typeof text !== 'string' || text.length === 0) return [];
  const results = [];
  // One pass with a sticky scanner: at each position try the absolute form
  // first (it is the most specific), then separator-bearing relative paths,
  // then bare filenames. Anything that fails `looksLikeFilePath` costs one
  // character of advance, which keeps prose inert.
  const scanner =
    /(?:[A-Za-z]:[/\\][^\s"'`<>|*?\r\n]*?|\\\\[^\s"'`<>|*?\r\n]+[/\\][^\s"'`<>|*?\r\n]*?|(?:\.{0,2}[/\\])?[\w.@+-]+(?:[/\\][\w.@+-]+)+|[\w.@+-]+)\.[A-Za-z0-9]{1,12}/g;

  // URL spans are removed before scanning: a path inside a link
  // (`https://example.com/a.ts`) is already clickable and is not a workspace
  // reference.
  const urlSpans = findUrlSpans(text);

  let match;
  while ((match = scanner.exec(text)) !== null) {
    const raw = match[0];
    if (!looksLikeFilePath(raw)) continue;
    const start = match.index;
    if (urlSpans.some((span) => start >= span.start && start < span.end)) {
      scanner.lastIndex = start + raw.length;
      continue;
    }
    const withAnnotation = extendWithAnnotation(text, start, start + raw.length);
    results.push({ start, end: start + withAnnotation.length, raw: withAnnotation });
    // Skip the annotation so `a.py:12` never re-matches as `12.py`-like text.
    scanner.lastIndex = start + withAnnotation.length;
  }

  return results;
}

/**
 * Locate explicit URL spans in a text run so the path scanner can skip them.
 *
 * @param {string} text full node text
 * @returns {Array<{ start: number, end: number }>}
 */
function findUrlSpans(text) {
  const spans = [];
  const scanner = /\b(?:https?|ftp|file):\/\/[^\s"'`<>)\]]+|\bwww\.[^\s"'`<>)\]]+/gi;
  let match;
  while ((match = scanner.exec(text)) !== null) {
    spans.push({ start: match.index, end: match.index + match[0].length });
  }
  return spans;
}

/**
 * Extend a match past its path when a `:line`-style annotation immediately
 * follows, so `foo.py:12` is captured as one token.
 *
 * @param {string} text full node text
 * @param {number} start index where the match begins
 * @param {number} end index just past the path
 * @returns {string} match text from `start`, including the annotation when present
 */
function extendWithAnnotation(text, start, end) {
  const rest = text.slice(end);
  const colon = /^:\s*\d+(?:\s*:\s*\d+)?/.exec(rest);
  if (colon) return text.slice(start, end) + colon[0];
  const paren = /^\s*\(\s*(?:line|lines|行)\s*\d+(?:\s*[-–]\s*\d+)?\s*\)/i.exec(rest);
  if (paren) return text.slice(start, end) + paren[0];
  return text.slice(start, end);
}
