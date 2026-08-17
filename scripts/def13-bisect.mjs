/** DEF-13 二分：缝合结构 / 项目层简报 / 纯长度 三要素谁触发 dsh PI_AI_ERROR。指令一律无害。 */
import { spawn } from 'node:child_process';
import { DSH_CHARTER_FIXED, buildDshStitchedPrompt, readProjectBrief } from '../src/web/workstreams.ts';
import { resolveWindowsShim } from '../src/adapters/t1-runner.ts';

const shim = resolveWindowsShim('dsh');
const brief = readProjectBrief('D:\\mush');

function runDsh(label, prompt) {
  return new Promise((resolve) => {
    const child = spawn(shim.node, [shim.entry, '--profile', 'headless', prompt], { cwd: 'D:\\mush', windowsHide: true });
    let err = '';
    child.stderr.on('data', (d) => (err += d));
    child.stdout.on('data', () => {});
    const timer = setTimeout(() => { child.kill(); resolve(`${label}: TIMEOUT`); }, 90_000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      const pi = err.includes('PI_AI_ERROR');
      resolve(`${label}: exit=${code} chars=${prompt.length} ${pi ? '**PI_AI_ERROR**' : err.slice(0, 80).replace(/\n/g, ' ')}`);
    });
  });
}

console.log('brief chars:', brief.length);
console.log(await runDsh('A 纯指令', 'reply: ok'));
console.log(await runDsh('B 缝合+小指令', buildDshStitchedPrompt(DSH_CHARTER_FIXED, '', 'reply: ok')));
console.log(await runDsh('C 简报+小指令', `[项目层 AGENTS.md]\n${brief}\n\nreply: ok`));
console.log(await runDsh('D 缝合+简报+小指令', buildDshStitchedPrompt(DSH_CHARTER_FIXED, '', `[项目层 AGENTS.md]\n${brief}\n\nreply: ok`)));
const pad = '这是一段用于测试长度的填充文本，不包含任何指令。'.repeat(220);
console.log(await runDsh('E 纯长度5.5k', `reply: ok\n\n${pad}`));
