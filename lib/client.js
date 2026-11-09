/* dsh-file-link — client half: clickable file references + accent colour.
 *
 * Two capabilities share one accent colour:
 *
 *   1. Every file path the assistant mentions in a settled message becomes a
 *      clickable inline span. Click previews it in the right sidebar,
 *      Ctrl+click hands it to the system default application, Alt+click
 *      reveals it in the file manager.
 *   2. A settings page picks that accent, which is applied through
 *      `ctx.theme.overrideTokens` so the Harness UI accent and the link
 *      colour move together.
 *
 * The path recognizer lives in lib/paths.js (unit-tested); the build script
 * inlines it here because a Client module cannot import Harness packages.
 *
 * Why DOM scanning instead of a slot: the Harness renders assistant prose as
 * Markdown inside `conversation.chat.node`, and no slot exposes the inline
 * text runs. Wrapping only text nodes (never React's element children) keeps
 * reconciliation intact; a MutationObserver re-wraps after re-renders.
 */
window.__ModuleLoader__.load({
  id: 'dsh-file-link',
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;

    var react = require('react');
    var h = react.createElement;

    // ── 内联自 lib/paths.js（单元测试见 test/paths.test.mjs）────────────
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
function isWindowsStylePath(value) {
  return /^[A-Za-z]:[/\\]/.test(value) || value.startsWith('\\\\');
}

/**
 * Whether a path is absolute in either spelling the Host accepts.
 * @param {string} path candidate text
 * @returns {boolean}
 */
function isAbsoluteWorkspacePath(path) {
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
function looksLikeFilePath(token) {
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
function splitAnnotation(raw) {
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
function fileAddressFor(sessionId, cwd, path) {
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
function resolveWorkspacePath(cwd, path) {
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
function findPathMatches(text) {
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


    // ── 内联自 src/settings.js ──────────────────────────────────────────
/* 每套预设给一对明暗值：light 用于浅色主题，dark 用于深色主题。深色侧整体更亮
 * 一档，否则深底上会糊成一团。`default` 的浅色值与官方 DeepSeek 蓝对齐
 * （--dsw-static-deepseek-500 #4176e6），这样「不选」和「选官方蓝」观感一致。 */
var ACCENT_PRESETS = [
  { id: 'default', label: '跟随主题', light: '', dark: '' },
  { id: 'deepseek', label: '官方蓝', light: '#4176e6', dark: '#7aaaff' },
  { id: 'green', label: '绿', light: '#0f9d6e', dark: '#34d399' },
  { id: 'violet', label: '紫', light: '#7c3aed', dark: '#a78bfa' },
  { id: 'rose', label: '玫红', light: '#db2777', dark: '#f472b6' },
  { id: 'amber', label: '琥珀', light: '#b45309', dark: '#fbbf24' },
  { id: 'teal', label: '青', light: '#0d9488', dark: '#2dd4bf' },
  { id: 'slate', label: '石板', light: '#475569', dark: '#94a3b8' }
];

/** Tokens that follow the accent.
 *
 * Which token actually paints "the accent" was the whole bug in the first
 * version: `--dsw-alias-brand-primary` is not a highlight colour, it is the
 * brand *foreground* — it resolves to near-black in light and near-white in
 * dark. Overriding it recoloured body text, so the UI looked untouched.
 *
 * The Harness highlight is the DeepSeek blue:
 *   light  `--dsw-static-deepseek-500` #4176e6
 *   dark   `--dsw-static-deepseek-400` #7aaaff
 * exposed as `--dsw-alias-state-business-primary`, which feeds the focus ring.
 * `--dsw-alias-button-primary-fill` aliases `brand-primary`, so a filled
 * primary button needs that one too — hence both layers below.
 *
 * `overrideTokens` validates only the value shape (a `{light, dark}` pair of
 * strings), never the token name, so every alias-layer name is accepted.
 */
var ACCENT_TOKENS = [
  // 真正的强调色：焦点环、选中态、品牌蓝
  '--dsw-alias-state-business-primary',
  // 主按钮填充走 brand-primary；不覆盖它，按钮会保持近黑/近白
  '--dsw-alias-brand-primary'
];

/** Static palette entries that back the accent; overwriting them reaches the
 *  components that reference `--dsw-static-deepseek-*` directly instead of
 *  going through the alias layer. */
var ACCENT_STATIC_TOKENS = ['--dsw-static-deepseek-500', '--dsw-static-deepseek-400'];

function settingsStyles() {
  return {
    root: { display: 'flex', flexDirection: 'column', gap: '14px', padding: '2px 0 8px' },
    group: {
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
      padding: '12px',
      borderRadius: '8px',
      border: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.22))',
      background: 'var(--dsw-alias-bg-layer-1, rgba(127,127,127,.04))'
    },
    groupTitle: { fontSize: '12px', fontWeight: 600, color: 'var(--dsw-alias-label-primary, inherit)' },
    row: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' },
    label: { fontSize: '12px', minWidth: '76px', color: 'var(--dsw-alias-label-secondary, #64748b)' },
    swatches: { display: 'flex', gap: '8px', flexWrap: 'wrap' },
    swatch: {
      width: '26px',
      height: '26px',
      borderRadius: '7px',
      border: '2px solid transparent',
      cursor: 'pointer',
      padding: 0,
      boxShadow: 'inset 0 0 0 1px var(--dsw-alias-border-l2, rgba(127,127,127,.35))'
    },
    swatchActive: { borderColor: 'var(--dsw-alias-label-primary, #111)' },
    hex: {
      width: '96px',
      padding: '4px 8px',
      borderRadius: '6px',
      border: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.25))',
      background: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,.06))',
      color: 'inherit',
      fontSize: '12px',
      fontFamily: 'ui-monospace, monospace'
    },
    color: { width: '32px', height: '26px', padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' },
    btn: {
      padding: '4px 12px',
      borderRadius: '6px',
      border: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.25))',
      background: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,.06))',
      color: 'inherit',
      fontSize: '12px',
      cursor: 'pointer'
    },
    muted: {
      fontSize: '11px',
      lineHeight: '1.65',
      color: 'var(--dsw-alias-label-secondary, #64748b)'
    },
    check: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer' },
    demo: {
      fontFamily: 'ui-monospace, monospace',
      fontSize: '12px',
      padding: '2px 5px',
      borderRadius: '4px',
      color: 'var(--dsw-alias-state-business-primary, #4176e6)',
      borderBottom: '1px dashed var(--dsw-alias-state-business-primary, #4176e6)'
    }
  };
}

function FileLinkSettings() {
  var S = settingsStyles();
  var state = react.useState(fileLinkConfig());
  var current = state[0];
  var setCurrent = state[1];

  react.useEffect(function () {
    return subscribeConfig(function (next) {
      setCurrent(next);
    });
  }, []);

  function patch(next) {
    var merged = updateFileLinkConfig(next);
    setCurrent(merged);
  }

  var swatchNodes = ACCENT_PRESETS.map(function (preset) {
    var active = current.accentPreset === preset.id;
    var style = Object.assign({}, S.swatch, active ? S.swatchActive : {});
    if (preset.light) style.background = preset.light;
    else style.background =
      'linear-gradient(135deg, var(--dsw-alias-label-tertiary,#94a3b8), var(--dsw-alias-bg-base,#fff))';
    return h('button', {
      key: preset.id,
      type: 'button',
      title: preset.label,
      'aria-label': preset.label,
      'aria-pressed': active,
      style: style,
      onClick: function () {
        patch({ accentPreset: preset.id, accentCustom: '' });
      }
    });
  });

  return h(
    'div',
    { style: S.root },

    h(
      'div',
      { style: S.group },
      h('div', { style: S.groupTitle }, '强调色'),
      h(
        'div',
        { style: S.muted },
        '同一个颜色同时决定界面强调色和聊天里可点击文件的颜色，改一处两边都变。'
      ),
      h('div', { style: S.swatches }, swatchNodes),
      h(
        'div',
        { style: S.row },
        h('span', { style: S.label }, '自定义'),
        h('input', {
          type: 'color',
          style: S.color,
          value: current.accentCustom || accentColorOf(current, 'light') || '#2563eb',
          onChange: function (e) {
            patch({ accentPreset: 'custom', accentCustom: e.target.value });
          }
        }),
        h('input', {
          type: 'text',
          style: S.hex,
          placeholder: '#2563eb',
          value: current.accentCustom,
          onChange: function (e) {
            var value = String(e.target.value || '').trim();
            patch({ accentPreset: value ? 'custom' : 'default', accentCustom: value });
          }
        }),
        h(
          'button',
          {
            style: S.btn,
            type: 'button',
            onClick: function () {
              patch({ accentPreset: 'default', accentCustom: '' });
            }
          },
          '恢复默认'
        )
      ),
      h(
        'div',
        { style: S.row },
        h('span', { style: S.label }, '预览'),
        h('span', { style: S.demo }, 'src/app/main.ts'),
        h('span', { style: S.muted }, '← 这就是聊天里文件链接的样子')
      )
    ),

    h(
      'div',
      { style: S.group },
      h('div', { style: S.groupTitle }, '文件点击'),
      h(
        'label',
        { style: S.check },
        h('input', {
          type: 'checkbox',
          checked: current.enabled,
          onChange: function (e) {
            patch({ enabled: e.target.checked });
          }
        }),
        '把聊天里提到的文件路径变成可点击链接'
      ),
      h(
        'label',
        { style: S.check },
        h('input', {
          type: 'checkbox',
          checked: current.clickAction === 'preview',
          onChange: function (e) {
            patch({ clickAction: e.target.checked ? 'preview' : 'open' });
          }
        }),
        '单击在右侧栏预览（关闭则用系统默认程序打开）'
      ),
      h(
        'label',
        { style: S.check },
        h('input', {
          type: 'checkbox',
          checked: current.underline,
          onChange: function (e) {
            patch({ underline: e.target.checked });
          }
        }),
        '链接下方显示虚线下划线'
      ),
      h(
        'label',
        { style: S.check },
        h('input', {
          type: 'checkbox',
          checked: current.scanCode,
          onChange: function (e) {
            patch({ scanCode: e.target.checked });
          }
        }),
        '代码块里的路径也可点击'
      )
    ),

    h(
      'div',
      { style: S.group },
      h('div', { style: S.groupTitle }, '怎么用'),
      h(
        'div',
        { style: S.muted },
        '单击 → 右侧栏预览　·　Ctrl+单击 → 系统默认程序打开　·　Alt+单击 → 在资源管理器中定位'
      ),
      h(
        'div',
        { style: S.muted },
        '路径按会话工作区解析；相对路径先拼工作区根目录。点击不会打断文本选择：拖选超过 4px 或已有选中文本时不触发。'
      ),
      h(
        'div',
        { style: S.muted },
        '识别范围：带分隔符的相对/绝对路径，以及常见扩展名的裸文件名；URL 和普通英文单词不处理。'
      )
    )
  );
}


    // ── 配置 ──────────────────────────────────────────────────────────
    var STORAGE_KEY = 'dsh-file-link:config:v1';

    var DEFAULTS = {
      enabled: true,
      accentPreset: 'default',
      accentCustom: '',
      clickAction: 'preview',
      underline: true,
      scanCode: false
    };

    /* 旧版预设 id → 新版 id。第一版把 `blue` 当强调色，色值近似官方蓝，直接
     * 映射到 `deepseek`；其余旧 id 在新表里仍在，无需迁移。
     * 必须定义在 `var config = readConfig()` 之前：`var` 只提升声明不提升赋值，
     * 放到后面会让 normalizeConfig 读到 undefined。 */
    var PRESET_ALIASES = { blue: 'deepseek' };

    var config = readConfig();
    var listeners = new Set();

    function normalizeConfig(raw) {
      var src = raw && typeof raw === 'object' ? raw : {};
      var preset = typeof src.accentPreset === 'string' ? src.accentPreset : DEFAULTS.accentPreset;
      if (Object.prototype.hasOwnProperty.call(PRESET_ALIASES, preset)) preset = PRESET_ALIASES[preset];
      var known = false;
      for (var i = 0; i < ACCENT_PRESETS.length; i++) if (ACCENT_PRESETS[i].id === preset) known = true;
      if (preset === 'custom') known = true;
      return {
        enabled: src.enabled === undefined ? DEFAULTS.enabled : src.enabled !== false,
        accentPreset: known ? preset : DEFAULTS.accentPreset,
        accentCustom: typeof src.accentCustom === 'string' ? src.accentCustom : DEFAULTS.accentCustom,
        clickAction: src.clickAction === 'open' ? 'open' : 'preview',
        underline: src.underline === undefined ? DEFAULTS.underline : src.underline !== false,
        scanCode: src.scanCode === undefined ? DEFAULTS.scanCode : src.scanCode === true
      };
    }

    function readConfig() {
      try {
        var raw = window.localStorage.getItem(STORAGE_KEY);
        return raw === null ? normalizeConfig(null) : normalizeConfig(JSON.parse(raw));
      } catch (e) {
        return normalizeConfig(null);
      }
    }

    function fileLinkConfig() {
      return config;
    }

    function subscribeConfig(fn) {
      listeners.add(fn);
      return function () {
        listeners.delete(fn);
      };
    }

    function updateFileLinkConfig(patch) {
      config = normalizeConfig(Object.assign({}, config, patch));
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
      } catch (e) {
        /* 隐私模式/配额满：配置退化为本次会话有效 */
      }
      listeners.forEach(function (fn) {
        try {
          fn(config);
        } catch (e) {
          /* 单个订阅者出错不影响其它订阅者 */
        }
      });
      return config;
    }

    /** 解析当前强调色的浅/深两套值；空字符串表示交给宿主主题。 */
    function accentColorOf(cfg, scheme) {
      if (!cfg) return '';
      if (cfg.accentPreset === 'custom') {
        var custom = String(cfg.accentCustom || '').trim();
        return isHexColor(custom) ? custom : '';
      }
      for (var i = 0; i < ACCENT_PRESETS.length; i++) {
        if (ACCENT_PRESETS[i].id === cfg.accentPreset) return ACCENT_PRESETS[i][scheme] || '';
      }
      return '';
    }

    function isHexColor(value) {
      return /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value);
    }

    /** 把自定义色作为深浅两套的同一个值，预设则各用各的。
     *
     * 同时填 alias 层和 static 层：alias 层管焦点环/选中态，static 层管那些
     * 直接引用 `--dsw-static-deepseek-*` 的组件。两层同色才不会出现「按钮变了
     * 但焦点环没变」这种半生效。
     */
    function accentTokens(cfg) {
      var tokens = {};
      var light = accentColorOf(cfg, 'light');
      var dark = accentColorOf(cfg, 'dark');
      if (light === '' && dark === '') return null;
      var modes = {
        light: light === '' ? dark : light,
        dark: dark === '' ? light : dark
      };
      var i;
      for (i = 0; i < ACCENT_TOKENS.length; i++) tokens[ACCENT_TOKENS[i]] = modes;
      for (i = 0; i < ACCENT_STATIC_TOKENS.length; i++) tokens[ACCENT_STATIC_TOKENS[i]] = modes;
      return tokens;
    }

    // ── 样式 ──────────────────────────────────────────────────────────
    var STYLE_ID = 'dsh-file-link-style';

    /** 链接样式读的强调色变量。
     *
     * 用 `--dsw-alias-state-business-primary`（真正的品牌蓝）而不是
     * `--dsw-alias-brand-primary`（前景色，近黑/近白）——后者会让链接变成和
     * 正文同色，等于看不出是链接。
     */
    var LINK_ACCENT = 'var(--dsw-alias-state-business-primary,#4176e6)';

    function styleText(cfg) {
      var underline = cfg.underline
        ? 'border-bottom:1px dashed ' + LINK_ACCENT + ';'
        : 'border-bottom:0;';
      return (
        '.dshfl-link{' +
        'color:' + LINK_ACCENT + ';' +
        'cursor:pointer;' +
        'border-radius:2px;' +
        underline +
        'transition:background-color .12s ease;' +
        '}' +
        '.dshfl-link:hover{background:color-mix(in srgb,' + LINK_ACCENT + ' 16%,transparent);}' +
        '.dshfl-link:active{background:color-mix(in srgb,' + LINK_ACCENT + ' 26%,transparent);}' +
        '.dshfl-link[data-dshfl-missing="1"]{color:var(--dsw-alias-label-tertiary,#94a3b8);' +
        'border-bottom-style:dotted;}' +
        '.dshfl-toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);' +
        'padding:8px 14px;border-radius:8px;font-size:12px;z-index:2147483000;' +
        'background:var(--dsw-alias-bg-overlay,rgba(24,24,27,.94));' +
        'color:var(--dsw-alias-label-primary,#fafafa);' +
        'border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.3));' +
        'box-shadow:0 8px 24px rgba(0,0,0,.28);pointer-events:none;' +
        'opacity:0;transition:opacity .16s ease;}' +
        '.dshfl-toast[data-show="1"]{opacity:1;}'
      );
    }

    function ensureStyle(cfg) {
      var el = document.getElementById(STYLE_ID);
      if (el === null) {
        el = document.createElement('style');
        el.id = STYLE_ID;
        document.head.appendChild(el);
      }
      el.textContent = styleText(cfg);
      return el;
    }

    // ── 提示 ──────────────────────────────────────────────────────────
    var toastTimer = null;

    function toast(message) {
      var el = document.getElementById('dshfl-toast');
      if (el === null) {
        el = document.createElement('div');
        el.id = 'dshfl-toast';
        el.className = 'dshfl-toast';
        el.setAttribute('role', 'status');
        el.setAttribute('aria-live', 'polite');
        document.body.appendChild(el);
      }
      el.textContent = message;
      el.setAttribute('data-show', '1');
      if (toastTimer !== null) window.clearTimeout(toastTimer);
      toastTimer = window.setTimeout(function () {
        el.setAttribute('data-show', '0');
      }, 2200);
    }

    // ── 文本节点包裹 ──────────────────────────────────────────────────
    var SKIP_TAGS = {
      A: 1, BUTTON: 1, SCRIPT: 1, STYLE: 1, TEXTAREA: 1, INPUT: 1,
      PRE: 1, SVG: 1, CODE: 1, KBD: 1, SAMP: 1
    };

    /** 该文本节点是否值得扫描。 */
    function acceptableTextNode(node, cfg) {
      if (!node.nodeValue || node.nodeValue.length < 4) return false;
      var parent = node.parentElement;
      if (parent === null) return false;
      if (parent.closest('.dshfl-link')) return false;
      var tag = parent.tagName;
      if (SKIP_TAGS[tag] === 1) {
        // 代码块/行内代码按设置决定是否处理，但绝不碰代码块内的 PRE
        if (tag !== 'CODE') return false;
        if (!cfg.scanCode) return false;
        if (parent.closest('pre') !== null) return false;
      }
      return true;
    }

    /** 把一个文本节点里的文件路径包成可点击 span。返回是否改动。 */
    function wrapTextNode(node, cfg) {
      if (!acceptableTextNode(node, cfg)) return false;
      var text = node.nodeValue;
      var matches = findPathMatches(text);
      if (matches.length === 0) return false;

      var parent = node.parentNode;
      if (parent === null) return false;
      var frag = document.createDocumentFragment();
      var cursor = 0;

      for (var i = 0; i < matches.length; i++) {
        var m = matches[i];
        if (m.start < cursor) continue;
        if (m.start > cursor) frag.appendChild(document.createTextNode(text.slice(cursor, m.start)));
        var split = splitAnnotation(m.raw);
        var span = document.createElement('span');
        span.className = 'dshfl-link';
        span.setAttribute('data-dshfl-path', split.path);
        if (split.line !== undefined) span.setAttribute('data-dshfl-line', String(split.line));
        span.setAttribute('role', 'link');
        span.setAttribute('tabindex', '0');
        span.title = '单击预览 · Ctrl+单击用默认程序打开 · Alt+单击定位';
        span.textContent = m.raw;
        frag.appendChild(span);
        cursor = m.end;
      }
      if (cursor < text.length) frag.appendChild(document.createTextNode(text.slice(cursor)));
      parent.replaceChild(frag, node);
      return true;
    }

    /** 扫描一个子树；limit 防止一次性处理过多节点。 */
    function scanTree(root, cfg) {
      if (!root || root.nodeType !== 1) return 0;
      if (root.closest('.dshfl-link')) return 0;
      var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: function (node) {
          return acceptableTextNode(node, cfg) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
      });
      var pending = [];
      var node;
      var count = 0;
      while ((node = walker.nextNode()) !== null && count < 400) {
        pending.push(node);
        count++;
      }
      var changed = 0;
      for (var i = 0; i < pending.length; i++) {
        if (wrapTextNode(pending[i], cfg)) changed++;
      }
      return changed;
    }

    // ── 打开文件 ──────────────────────────────────────────────────────
    /** 当前活跃会话：主视图保留计数最高的那个。 */
    function activeSession(ctx) {
      try {
        var snap = ctx.sessions.list.getSnapshot();
        var rows = snap && snap.byId ? snap.byId : null;
        if (rows === null) return null;
        var best = null;
        var bestScore = 0;
        for (var id in rows) {
          if (!Object.prototype.hasOwnProperty.call(rows, id)) continue;
          var row = rows[id];
          var score = row && row.retainedBy ? row.retainedBy.mainView || 0 : 0;
          if (score > bestScore) {
            bestScore = score;
            best = { id: id, cwd: row.cwd };
          }
        }
        return best;
      } catch (e) {
        return null;
      }
    }

    /** 在右侧栏打开预览（与官方产物 chip 同一路径）。 */
    function previewPath(ctx, sessionId, cwd, path, line) {
      var url = fileAddressFor(sessionId, cwd, path);
      if (line === undefined) ctx.sidebarRight.openResource(url);
      else ctx.sidebarRight.openResource(url, { params: { line: line } });
    }

    /** 交给宿主桌面打开/定位。返回 Promise<boolean>。 */
    function hostOpen(ctx, absolutePath, action) {
      var request = action === 'reveal' ? { path: absolutePath, action: 'reveal' } : { path: absolutePath };
      return Promise.resolve()
        .then(function () {
          return ctx.remote.session.openWorkspacePath(request);
        })
        .then(function (result) {
          return Boolean(result && result.ok);
        })
        .catch(function () {
          return false;
        });
    }

    function handleActivate(ctx, el, event) {
      var cfg = config;
      if (!cfg.enabled) return;
      var path = el.getAttribute('data-dshfl-path');
      if (!path) return;
      var lineAttr = el.getAttribute('data-dshfl-line');
      var line = lineAttr === null ? undefined : Number(lineAttr);

      var session = activeSession(ctx);
      if (session === null) {
        toast('找不到当前会话，无法解析路径');
        return;
      }

      var modifierOpen = event.ctrlKey || event.metaKey;
      var modifierReveal = event.altKey;

      if (modifierReveal) {
        hostOpen(ctx, resolveWorkspacePath(session.cwd, path), 'reveal').then(function (ok) {
          if (!ok) toast('定位失败：' + path);
        });
        return;
      }

      if (modifierOpen) {
        hostOpen(ctx, resolveWorkspacePath(session.cwd, path), 'open').then(function (ok) {
          if (!ok) toast('打开失败：' + path);
        });
        return;
      }

      if (cfg.clickAction === 'open') {
        hostOpen(ctx, resolveWorkspacePath(session.cwd, path), 'open').then(function (ok) {
          if (!ok) toast('打开失败：' + path);
        });
        return;
      }

      try {
        previewPath(ctx, session.id, session.cwd, path, line);
      } catch (e) {
        toast('预览失败：' + path);
      }
    }

    // ── 插件主体 ──────────────────────────────────────────────────────
    var inject = ['slots', 'sessions', 'remote', 'remote.session', 'sidebarRight', 'locale', 'theme'];

    function apply(ctx) {
      var observer = null;
      var scanTimer = null;
      var themeDisposer = null;
      var styleEl = null;

      /** 重新应用强调色覆盖层；token 为空则撤掉。
       *
       * `theme` 是硬依赖（在 inject 里声明），所以 `ctx.theme` 一定可用；先前的
       * `ctx.get('theme')` 写法在服务尚未 active 时会静默返回 undefined，让选色
       * 看起来生效而界面不动。
       */
      function applyAccent() {
        var theme = ctx.theme;
        if (theme === undefined || theme === null) {
          toast('强调色未生效：theme 服务不可用');
          return;
        }
        if (themeDisposer !== null) {
          try {
            themeDisposer();
          } catch (e) {
            /* 覆盖层可能已被主题切换清掉 */
          }
          themeDisposer = null;
        }
        var tokens = accentTokens(config);
        if (tokens === null) return;
        try {
          themeDisposer = theme.overrideTokens('dsh-file-link', tokens);
        } catch (e) {
          // A rejected token name would otherwise leave the picker looking
          // applied while nothing changed, so say so once per attempt.
          themeDisposer = null;
          toast('强调色未生效：' + String((e && e.message) || e));
        }
      }

      function rescanAll() {
        if (!config.enabled) return;
        var roots = document.querySelectorAll('[data-chat-flow]');
        for (var i = 0; i < roots.length; i++) scanTree(roots[i], config);
      }

      function scheduleScan() {
        if (scanTimer !== null) return;
        scanTimer = window.setTimeout(function () {
          scanTimer = null;
          try {
            rescanAll();
          } catch (e) {
            /* 扫描失败不能影响对话 */
          }
        }, 120);
      }

      // 单击：用 mousedown 位置过滤拖选，避免打断复制。
      var downX = 0;
      var downY = 0;

      function onPointerDown(event) {
        downX = event.clientX;
        downY = event.clientY;
      }

      function onClick(event) {
        var target = event.target;
        if (!target || typeof target.closest !== 'function') return;
        var el = target.closest('.dshfl-link');
        if (el === null) return;
        if (event.button !== 0) return;
        var moved = Math.abs(event.clientX - downX) + Math.abs(event.clientY - downY);
        if (moved > 4) return;
        var selection = window.getSelection();
        if (selection !== null && String(selection.toString()).length > 0) return;
        event.preventDefault();
        event.stopPropagation();
        handleActivate(ctx, el, event);
      }

      function onKeyDown(event) {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        var target = event.target;
        if (!target || typeof target.closest !== 'function') return;
        var el = target.closest('.dshfl-link');
        if (el === null) return;
        event.preventDefault();
        handleActivate(ctx, el, { ctrlKey: false, metaKey: false, altKey: false });
      }

      ctx.effect(function () {
        styleEl = ensureStyle(config);
        applyAccent();
        rescanAll();

        document.addEventListener('mousedown', onPointerDown, true);
        document.addEventListener('click', onClick, true);
        document.addEventListener('keydown', onKeyDown, true);

        // React 重渲染会替换文本节点，观察器负责补回链接。
        observer = new MutationObserver(function (records) {
          for (var i = 0; i < records.length; i++) {
            var record = records[i];
            if (record.type !== 'childList' && record.type !== 'characterData') continue;
            scheduleScan();
            return;
          }
        });
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });

        var unsubscribe = subscribeConfig(function (next) {
          if (styleEl !== null) styleEl.textContent = styleText(next);
          applyAccent();
          if (next.enabled) scheduleScan();
        });

        return function () {
          document.removeEventListener('mousedown', onPointerDown, true);
          document.removeEventListener('click', onClick, true);
          document.removeEventListener('keydown', onKeyDown, true);
          if (observer !== null) {
            observer.disconnect();
            observer = null;
          }
          if (scanTimer !== null) {
            window.clearTimeout(scanTimer);
            scanTimer = null;
          }
          unsubscribe();
          if (themeDisposer !== null) {
            try {
              themeDisposer();
            } catch (e) {
              /* ignore */
            }
            themeDisposer = null;
          }
          if (styleEl !== null && styleEl.parentNode !== null) styleEl.parentNode.removeChild(styleEl);
          styleEl = null;
          var toastEl = document.getElementById('dshfl-toast');
          if (toastEl !== null && toastEl.parentNode !== null) toastEl.parentNode.removeChild(toastEl);
        };
      }, 'dsh-file-link: chat scan, click routing and accent layer');

      ctx.slots.inject('settings.section', function () {
        return ctx.slots.register(
          { name: 'settings.section', id: 'file-link', order: 21, label: '文件链接' },
          function () {
            return h(FileLinkSettings, null);
          }
        );
      });

      // 控制台自测入口
      try {
        window.__dshFileLink = {
          config: function () {
            return config;
          },
          update: updateFileLinkConfig,
          rescan: rescanAll,
          match: findPathMatches
        };
      } catch (e) {
        /* ignore */
      }
    }

    exports.name = 'dsh-file-link';
    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  }
});
