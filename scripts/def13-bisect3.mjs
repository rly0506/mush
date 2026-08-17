/** DEF-13 二分第三轮：F4 行拆解 CJK/拉丁成分。 */
import { spawn } from 'node:child_process';
import { resolveWindowsShim } from '../src/adapters/t1-runner.ts';

const shim = resolveWindowsShim('dsh');

function runDsh(label, prompt) {
  return new Promise((resolve) => {
    const child = spawn(shim.node, [shim.entry, '--profile', 'headless', prompt], { cwd: 'D:\\mush', windowsHide: true });
    let err = '';
    child.stderr.on('data', (d) => (err += d));
    child.stdout.on('data', () => {});
    const timer = setTimeout(() => { child.kill(); resolve(`${label}: TIMEOUT`); }, 90_000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve(`${label}: exit=${code} ${err.includes('PI_AI_ERROR') ? '**PI**' : 'ok'}`);
    });
  });
}

console.log(await runDsh('G1 纯CJK问候', '你好，请只回复两个字：收到'));
console.log(await runDsh('G2 F4去拉丁', '批次回执 从 44 起，文件名带后缀。'));
console.log(await runDsh('G3 纯拉丁片段', 'BATCH-NN -ds page.ts master worktree'));
console.log(await runDsh('G4 replyok复验', 'reply: ok'));
console.log(await runDsh('G5 F3复验', '约束不变：禁改 dispatch approval 段与 page.ts。'));
