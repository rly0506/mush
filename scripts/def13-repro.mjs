/** DEF-13 诊断：重建 481d0b7e 的精确缝合 prompt（哈希比对回执），并手动复跑 dsh。 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { DSH_STITCH_HEAD, DSH_STITCH_HISTORY, DSH_STITCH_TAIL, DSH_CHARTER_FIXED, buildDshStitchedPrompt, readProjectBrief } from '../src/web/workstreams.ts';

const RECEIPT_SHA = '386405B0864E0E733D7D46BB4E32E0BB9DC7D074184147F807DFF0951D5EA483';

const instruction = [
  '读取并完整执行派发包 docs/dispatch/rm004-p19a-deepseek-taskpool.md（RM-004 M3，GOAL-019 后端，D34 修订：本 Goal 已收敛为纯后端，前端无关）。',
  'F-45：worktree runtime/worktrees/deepseek-e，分支 g019a，基于当前 master。',
  '约束不变：禁改 dispatch approval 段与 page.ts。',
  '批次回执 BATCH-NN 从 44 起，文件名带 -ds 后缀。',
].join('\n');

const brief = readProjectBrief('D:\\mush');
let prompt = instruction;
if (brief !== '') prompt = `[项目层 AGENTS.md]\n${brief}\n\n${prompt}`;
const finalPrompt = buildDshStitchedPrompt(DSH_CHARTER_FIXED, '', prompt);

const sha = createHash('sha256').update(finalPrompt, 'utf8').digest('hex').toUpperCase();
console.log('rebuilt sha :', sha);
console.log('receipt sha :', RECEIPT_SHA);
console.log('MATCH:', sha === RECEIPT_SHA);
console.log('prompt chars:', finalPrompt.length);
if (process.argv[2] !== '--run') process.exit(sha === RECEIPT_SHA ? 0 : 1);

// 手动复跑：与 t1-runner 同型调用（DEF-03 垫片解析后 node 入口）
const { resolveWindowsShim } = await import('../src/adapters/t1-runner.ts');
const shim = resolveWindowsShim('dsh');
console.log('shim:', shim ? shim.entry : 'none (direct spawn)');
const args = shim ? [shim.entry, '--profile', 'headless', finalPrompt] : ['dsh', '--profile', 'headless', finalPrompt];
const child = spawn(shim ? shim.node : 'dsh', args, { cwd: 'D:\\mush', windowsHide: true });
let out = '', err = '';
child.stdout.on('data', (d) => (out += d));
child.stderr.on('data', (d) => (err += d));
child.on('exit', (code) => {
  console.log('EXIT=', code);
  console.log('STDOUT(200):', out.slice(0, 200).replace(/\n/g, ' | '));
  console.log('STDERR(400):', err.slice(0, 400).replace(/\n/g, ' | '));
});
