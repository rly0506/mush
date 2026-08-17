/** DEF-13 二分第二轮：真实指令文本逐段定位触发句。 */
import { spawn } from 'node:child_process';
import { resolveWindowsShim } from '../src/adapters/t1-runner.ts';

const shim = resolveWindowsShim('dsh');

const instruction = [
  '读取并完整执行派发包 docs/dispatch/rm004-p19a-deepseek-taskpool.md（RM-004 M3，GOAL-019 后端，D34 修订：本 Goal 已收敛为纯后端，前端无关）。',
  'F-45：worktree runtime/worktrees/deepseek-e，分支 g019a，基于当前 master。',
  '约束不变：禁改 dispatch approval 段与 page.ts。',
  '批次回执 BATCH-NN 从 44 起，文件名带 -ds 后缀。',
].join('\n');

function runDsh(label, prompt) {
  return new Promise((resolve) => {
    const child = spawn(shim.node, [shim.entry, '--profile', 'headless', prompt], { cwd: 'D:\\mush', windowsHide: true });
    let err = '';
    child.stderr.on('data', (d) => (err += d));
    child.stdout.on('data', () => {});
    const timer = setTimeout(() => { child.kill(); resolve(`${label}: TIMEOUT`); }, 90_000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve(`${label}: exit=${code} ${err.includes('PI_AI_ERROR') ? '**PI_AI_ERROR**' : 'ok'}`);
    });
  });
}

const lines = instruction.split('\n');
console.log(await runDsh('F 整段指令', instruction));
console.log(await runDsh('F1 仅行1', lines[0]));
console.log(await runDsh('F2 仅行2', lines[1]));
console.log(await runDsh('F3 仅行3', lines[2]));
console.log(await runDsh('F4 仅行4', lines[3]));
