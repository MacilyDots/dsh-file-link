/* dsh-file-link — unit tests for the path recognizer and address builder.
 *
 * Run: node test/paths.test.mjs
 */
import assert from 'node:assert/strict';
import {
  looksLikeFilePath,
  splitAnnotation,
  fileAddressFor,
  resolveWorkspacePath,
  findPathMatches,
} from '../lib/paths.js';

let pass = 0;
function t(name, fn) {
  try {
    fn();
    pass++;
  } catch (err) {
    console.error(`FAIL ${name}\n  ${err.message}`);
    process.exitCode = 1;
  }
}

// ── looksLikeFilePath ────────────────────────────────────────────────
t('accepts windows absolute', () => {
  assert.equal(looksLikeFilePath('X:\\work\\foo.py'), true);
});
t('accepts unc', () => {
  assert.equal(looksLikeFilePath('\\\\server\\share\\a.md'), true);
});
t('accepts posix absolute with extension', () => {
  assert.equal(looksLikeFilePath('/usr/local/bin/node'), true);
});
t('accepts relative with separator', () => {
  assert.equal(looksLikeFilePath('src/foo.ts'), true);
  assert.equal(looksLikeFilePath('./run.py'), true);
});
t('accepts bare known filename', () => {
  assert.equal(looksLikeFilePath('README.md'), true);
});
t('rejects bare unknown extension', () => {
  assert.equal(looksLikeFilePath('foo.bar'), false);
  assert.equal(looksLikeFilePath('a.b.c'), false);
});
t('rejects bare english word', () => {
  assert.equal(looksLikeFilePath('hello'), false);
});
t('rejects url', () => {
  assert.equal(looksLikeFilePath('https://example.com/a.ts'), false);
});
t('rejects directory-only relative', () => {
  assert.equal(looksLikeFilePath('src/components'), false);
});

// ── splitAnnotation ──────────────────────────────────────────────────
t('splits colon line', () => {
  assert.deepEqual(splitAnnotation('a.py:12'), { path: 'a.py', line: 12, col: undefined });
});
t('splits colon line and col', () => {
  assert.deepEqual(splitAnnotation('a.py:12:5'), { path: 'a.py', line: 12, col: 5 });
});
t('splits (line N)', () => {
  assert.deepEqual(splitAnnotation('a.py (line 4069)'), { path: 'a.py', line: 4069, col: undefined });
});
t('leaves plain path', () => {
  assert.deepEqual(splitAnnotation('a.py'), { path: 'a.py', line: undefined, col: undefined });
});

// ── fileAddressFor ───────────────────────────────────────────────────
t('relative path stays session scoped', () => {
  assert.equal(
    fileAddressFor('s1', 'X:\\work', 'src/a.ts'),
    'dsh-resource://file/session/s1/src/a.ts',
  );
});
t('absolute inside workspace becomes relative', () => {
  assert.equal(
    fileAddressFor('s1', 'X:\\work', 'X:\\work\\x.py'),
    'dsh-resource://file/session/s1/x.py',
  );
});
t('absolute outside workspace keeps spelling', () => {
  assert.equal(
    fileAddressFor('s1', 'X:\\work', 'X:\\Windows\\system32\\drivers\\etc\\hosts'),
    'dsh-resource://file/session/s1/X:/Windows/system32/drivers/etc/hosts',
  );
});
t('drive colon survives encoding', () => {
  const addr = fileAddressFor('s1', 'X:\\work', 'X:\\x\\y.txt');
  assert.ok(addr.includes('X:/x/y.txt'));
});

// ── resolveWorkspacePath ─────────────────────────────────────────────
t('resolves relative against cwd', () => {
  // The separator follows the workspace root; the path's own spelling is left
  // to the Host, which normalizes it on open.
  assert.equal(resolveWorkspacePath('X:\\work', 'a/b.py'), 'X:\\work\\a/b.py');
  assert.equal(resolveWorkspacePath('/srv/app', 'a/b.py'), '/srv/app/a/b.py');
});
t('absolute passes through', () => {
  assert.equal(resolveWorkspacePath('X:\\work', 'X:\\a\\b.py'), 'X:\\a\\b.py');
});

// ── findPathMatches ──────────────────────────────────────────────────
t('finds windows path in prose', () => {
  const hits = findPathMatches('see X:\\work\\run.py (line 1) for details');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].raw, 'X:\\work\\run.py (line 1)');
});
t('finds bare filename', () => {
  const hits = findPathMatches('open README.md now');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].raw, 'README.md');
});
t('ignores prose words', () => {
  assert.equal(findPathMatches('this is a normal sentence about cats').length, 0);
});
t('finds multiple paths', () => {
  const hits = findPathMatches('compare a.py and b/c/d.ts please');
  assert.equal(hits.length, 2);
  assert.equal(hits[0].raw, 'a.py');
  assert.equal(hits[1].raw, 'b/c/d.ts');
});
t('no overlap duplicates', () => {
  const hits = findPathMatches('x/y/z.rs');
  assert.equal(hits.length, 1);
});
t('sentence-ending period is not part of the path', () => {
  const hits = findPathMatches('Check the a.py file.');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].raw, 'a.py');
});
t('colon line annotation is captured', () => {
  const hits = findPathMatches('edit src/foo.ts:12 to fix it');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].raw, 'src/foo.ts:12');
});
t('url is not a path', () => {
  assert.equal(findPathMatches('see https://example.com/a.ts now').length, 0);
});
t('mixed absolute and relative in one sentence', () => {
  const hits = findPathMatches('Compare X:\\work\\x.py with ./local.ts and README.md.');
  assert.equal(hits.length, 3);
  assert.equal(hits[0].raw, 'X:\\work\\x.py');
  assert.equal(hits[1].raw, './local.ts');
  assert.equal(hits[2].raw, 'README.md');
});
t('line annotation round-trips through splitAnnotation', () => {
  const hits = findPathMatches('run run.py (line 1)');
  assert.equal(hits.length, 1);
  const split = splitAnnotation(hits[0].raw);
  assert.equal(split.path, 'run.py');
  assert.equal(split.line, 1);
});

console.log(`ok ${pass} assertions passed`);
