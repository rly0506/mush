/** DEF-13 定性：工具调用触发假设（读文件任务 vs 禁工具任务 vs 闲聊）。 */
import { spawn } from 'node:child_process';
import { resolveWindowsShim } from '../src/adapters/t1-runner.ts';

const shim = resolveWindowsShim('dsh');

function runDsh(label, prompt) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(shim.node, [shim.entry, '--profile', 'headless', prompt], { cwd: 'D:\\mush', windowsHide: true });
    let err = '';
    child.stderr.on('data', (d) => (err += d));
    child.stdout.on('data', () => {});
    const timer = setTimeout(() => { child.kill(); resolve(`${label}: TIMEOUT`); }, 120_000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve(`${label}: exit=${code} ${Math.round((Date.now() - started) / 1000)}s ${err.includes('PI_AI_ERROR') ? '**PI**' : 'ok'}`);
    });
  });
}

console.log(await runDsh('H1 读文件任务', '读取 D:/mush/package.json 文件并告诉我 name 字段的值。'));
console.log(await runDsh('H2 任务但禁工具', '不用读取任何文件、不调用任何工具，直接凭空回答：mush 项目的大写字母有几个？只回答数字。'));
