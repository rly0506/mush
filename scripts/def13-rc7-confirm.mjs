/** rc.7 确认：工具任务完整跑通（5 分钟上限）。 */
import { spawn } from 'node:child_process';
import { resolveWindowsShim } from '../src/adapters/t1-runner.ts';

const shim = resolveWindowsShim('dsh');
const started = Date.now();
const child = spawn(shim.node, [shim.entry, '--profile', 'headless', '读取 D:/mush/package.json 文件并告诉我 name 字段的值。只回答这一个值。'], { cwd: 'D:\\mush', windowsHide: true });
let out = '', err = '';
child.stdout.on('data', (d) => (out += d));
child.stderr.on('data', (d) => (err += d));
const timer = setTimeout(() => { child.kill(); console.log('TIMEOUT(300s)'); process.exit(1); }, 300_000);
child.on('exit', (code) => {
  clearTimeout(timer);
  console.log('EXIT=' + code, Math.round((Date.now() - started) / 1000) + 's');
  console.log('PI_AI_ERROR:', err.includes('PI_AI_ERROR') ? '**YES**' : 'NO');
  console.log('OUT:', out.slice(0, 300).replace(/\n/g, ' | '));
  if (err) console.log('ERR:', err.slice(0, 2000).replace(/\n/g, ' | '));
});
