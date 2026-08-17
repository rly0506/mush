/** DEF-13：检查 481d0b7e 流事件 preview 的段落结构。 */
import { readFileSync } from 'node:fs';
const lines = readFileSync('D:/mush/runtime/streams.jsonl', 'utf8').trim().split('\n');
for (const line of lines) {
  const j = JSON.parse(line);
  if (!j.events) continue;
  for (const e of j.events) {
    if (!String(e.dispatch_id ?? '').startsWith('481d0b7e')) continue;
    const p = e.prompt_preview ?? '';
    console.log('preview len:', p.length, 'prompt_chars:', e.prompt_chars);
    const count = (s) => (p.match(new RegExp(s, 'g')) ?? []).length;
    console.log('项目层 x', count('项目层'), '| 流历史 x', count('流历史'), '| 新指令 x', count('新指令'), '| HANDOFF x', count('HANDOFF'));
    console.log('--- head 300 ---');
    console.log(p.slice(0, 300));
    console.log('--- tail 300 ---');
    console.log(p.slice(-300));
  }
}
