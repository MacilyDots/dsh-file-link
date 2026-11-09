/* dsh-file-link — recognizer behaviour on realistic assistant prose.
 *
 * Run: node test/real-prose.mjs
 */
import { findPathMatches, splitAnnotation } from '../lib/paths.js';

const samples = [
  '报告、结果和运行器分别是 X:\\work\\report.md (line 1)、results.json (line 1) 和 run.py (line 1)。',
  '详见 `src/client/App.tsx` 与 `README.md`。',
  '修改 packages/client/ui-chat/src/client/ChatView.tsx:13242 后重跑。',
  '对比 https://github.com/foo/bar/blob/main/src/index.ts 里的实现。',
  '第 1.2.3 版之后，v2.0.0 稳定了。',
  '这是 e.g. 一个例子，see also i.e. the above.',
  '工作区在 X:\\work，会话日志落在 .dsh\\sessions\\--X-work--\\ 下。',
];

for (const text of samples) {
  const hits = findPathMatches(text);
  console.log('\nTEXT:', text);
  if (hits.length === 0) {
    console.log('  (no matches)');
    continue;
  }
  for (const hit of hits) {
    const split = splitAnnotation(hit.raw);
    console.log(`  -> ${JSON.stringify(hit.raw)}  path=${JSON.stringify(split.path)} line=${split.line}`);
  }
}
