// GOAL-085 隔离原生 CLI 假后端（零真实账户、零网络、零模型调用）。
// 用途：验证 mush 实际下发给 claude 的 argv、schema 运输、stream-json 解析、结构化输出、
// 工具请求面与自动加载上下文。被 DispatchPipeline 当作可执行文件真实 spawn。
//
// 行为：
//   1) 把收到的 argv 与 stdin、以及 cwd 写入 $MUSH_FAKE_CLAUDE_LOG（宿主指定的 JSONL）；
//   2) 按参数决定输出：无 --json-schema 时输出普通文本结果；有 inline schema 时输出符合
//      该 schema 的最小对象 + 一条**工具请求**事件（模拟模型尝试用工具），以便断言受控配置下
//      工具面是否可达；
//   3) 支持 --emit-tool-calls 时在 assistant 消息里加入 tool_use 内容块；
//   4) 支持 MUSH_FAKE_CLAUDE_HANG_MS 模拟长输出/挂起（取消测试用）。
import { appendFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const argv = process.argv.slice(2);
const logPath = process.env.MUSH_FAKE_CLAUDE_LOG;
const cwd = process.cwd();
const record = { at: new Date().toISOString(), cwd, argv };

// 只读元数据查询：与真实 CLI 一致地返回版本行（探针/派发前的版本核验会走这里）。
if (argv.includes('--version') && argv.length === 1) {
  if (logPath) appendFileSync(logPath, JSON.stringify({ ...record, kind: 'version' }) + '\n', 'utf8');
  process.stdout.write((process.env.MUSH_FAKE_CLAUDE_VERSION ?? '2.1.286') + ' (Claude Code)\n');
  process.exit(0);
}

// 读取 stdin：给 200ms 窗口，无人写入就继续（避免被未关闭的管道拖到超时）。
let stdin = '';
if (!process.stdin.isTTY) {
  const readAll = (async () => { for await (const chunk of process.stdin) stdin += chunk; })();
  await Promise.race([readAll, new Promise((resolve) => setTimeout(resolve, 200))]);
  process.stdin.destroy();
}
record.stdin_bytes = stdin.length;
record.stdin_sha256 = createHash('sha256').update(stdin).digest('hex');

if (logPath) appendFileSync(logPath, JSON.stringify(record) + '\n', 'utf8');

const valueAfter = (flag) => {
  const at = argv.indexOf(flag);
  return at === -1 ? undefined : argv[at + 1];
};

const model = process.env.MUSH_FAKE_CLAUDE_REPORT_MODEL ?? valueAfter('--model') ?? 'UNKNOWN';
const schemaText = valueAfter('--json-schema');
const hangMs = Number(process.env.MUSH_FAKE_CLAUDE_HANG_MS ?? '0');
if (hangMs > 0) await new Promise((resolve) => setTimeout(resolve, hangMs));

const emit = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');

emit({ type: 'system', subtype: 'init', model, session_id: 'fake-session-0001', tools: [] });

// 模型"尝试"使用工具：受控配置下 mush 只记录该请求，工具不会真的执行（没有工具进程）。
if (process.env.MUSH_FAKE_CLAUDE_EMIT_TOOL_CALLS === '1') {
  emit({
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 'toolu_fake_1', name: 'Bash', input: { command: 'echo MUSH_FAKE' } },
        { type: 'tool_use', id: 'toolu_fake_2', name: 'Write', input: { file_path: 'probe-write.txt', content: 'PROBE' } },
        { type: 'tool_use', id: 'toolu_fake_3', name: 'Read', input: { file_path: 'probe-read.txt' } },
      ],
    },
  });
}

let structured;
if (typeof schemaText === 'string') {
  try {
    const schema = JSON.parse(schemaText);
    const props = schema?.properties ?? {};
    structured = {};
    for (const key of Object.keys(props)) {
      const type = props[key]?.type;
      if (type === 'array') structured[key] = [];
      else if (type === 'object') structured[key] = {};
      else if (props[key]?.enum) structured[key] = props[key].enum[0];
      else structured[key] = 'FAKE';
    }
  } catch {
    structured = undefined;
  }
}

const resultText = JSON.stringify(structured ?? { body: 'FAKE_TEXT_RESULT', stance: 'support' });
emit({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: resultText }] } });
emit({
  type: 'result', subtype: 'success', is_error: false, num_turns: 2, duration_ms: 42,
  result: resultText,
  ...(structured !== undefined ? { structured_output: structured } : {}),
  total_cost_usd: 0,
  session_id: 'fake-session-0001',
});

if (process.env.MUSH_FAKE_CLAUDE_TOUCH) {
  try { writeFileSync(process.env.MUSH_FAKE_CLAUDE_TOUCH, 'touched', { flag: 'a' }); } catch { /* 记录失败不改变退出码 */ }
}
