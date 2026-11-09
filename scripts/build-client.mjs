/* dsh-file-link — build lib/client.js from src/.
 *
 * A Harness Client module is loaded through `window.__ModuleLoader__.load` and
 * may only `require` browser globals React; it cannot import a sibling ES
 * module. So the unit-tested recognizer (lib/paths.js) and the settings page
 * (src/settings.js) are inlined into the factory body here.
 *
 * Run: node scripts/build-client.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

/** Strip ESM export keywords so the source can live inside a function body. */
function stripExports(source) {
  return source
    .replace(/^export\s+function\s+/gm, 'function ')
    .replace(/^export\s+const\s+/gm, 'const ')
    .replace(/^export\s+let\s+/gm, 'let ')
    .replace(/^export\s+class\s+/gm, 'class ')
    .replace(/^export\s+\{[^}]*\};?\s*$/gm, '');
}

/** Drop the leading file-comment of an inlined module; the wrapper explains it. */
function trimHeader(source) {
  return source.replace(/^\/\*[\s\S]*?\*\/\s*/, '');
}

const paths = stripExports(trimHeader(readFileSync(join(root, 'lib/paths.js'), 'utf8')));
const settings = stripExports(trimHeader(readFileSync(join(root, 'src/settings.js'), 'utf8')));
const body = readFileSync(join(root, 'src/client.body.js'), 'utf8');

const built = body
  .replace('/* __PATHS_INLINE__ */', () => `// ── 内联自 lib/paths.js（单元测试见 test/paths.test.mjs）────────────\n${paths.trim()}\n`)
  .replace('/* __SETTINGS_INLINE__ */', () => `// ── 内联自 src/settings.js ──────────────────────────────────────────\n${settings.trim()}\n`);

if (built.includes('__PATHS_INLINE__') || built.includes('__SETTINGS_INLINE__')) {
  throw new Error('build: placeholder replacement failed');
}

writeFileSync(join(root, 'lib/client.js'), built);
console.log('wrote lib/client.js', Buffer.byteLength(built), 'bytes');
