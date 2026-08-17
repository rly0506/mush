/** 第三方通道分诊：纯文本最小调用是否也崩（区分 DEF-13 工具触发 vs 通道响应畸形）。 */
import { spawn } from 'node:child_process';
import { resolveWindowsShim } from '../src/adapters/t1-runner.ts';

const shim = resolveWindowsShim('dsh');

function runDsh(label, prompt, profile) {
  return new Promise((resolve) => {
    const started = Date.now();
    const args = profile ? ['--profile', profile, prompt] : ['--profile', 'headless', prompt];
    const child = spawn(shim.node, [shim.entry, ...args], { cwd: 'D:\\mush', windowsHide: true });
    let out = '', err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    const timer = setTimeout(() => { child.kill(); resolve(`${label}: TIMEOUT(90s)`); }, 90_000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve(`${label}: exit=${code} ${Math.round((Date.now() - started) / 1000)}s ${err.includes('PI_AI_ERROR') ? '**PI_AI_ERROR**' : 'ok'} | out: ${out.slice(0, 80).replace(/\n/g, ' ')}`);
    });
  });
}

console.log(await runDsh('A 纯文本(reply ok)', 'reply: ok'));
console.log(await runDsh('B 纯中文问候', '你好，请只回复：收到'));
