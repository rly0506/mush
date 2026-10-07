// Project-local PreToolUse guard. Never log tool arguments or raw hook payloads.
import { appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
let raw = '', decision = 'deny', tool = 'unknown', input;
try {
  for await (const chunk of process.stdin) {
    if (raw.length + chunk.length > 1024 * 1024) throw new Error('input limit');
    raw += chunk;
  }
  input = JSON.parse(raw);
  const name = input?.toolCall?.name;
  if (typeof name === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(name)) tool = name;
  // finish only returns the final answer; it has no resource or delegation capability.
  if (tool === 'finish') decision = 'allow';
} catch { /* Malformed input denies instead of returning an error that a host could ignore. */ }
try {
  appendFileSync(new URL('./tool-gate.jsonl', import.meta.url), JSON.stringify({
    at: new Date().toISOString(), tool, decision,
    ...(typeof input?.conversationId === 'string' && /^[a-f0-9-]{36}$/i.test(input.conversationId)
      ? { conversation_id: input.conversationId } : {}),
    input_keys: input && typeof input === 'object' ? Object.keys(input).slice(0,16) : [],
    ...(tool === 'invoke_subagent' ? { requested_subagents: Array.isArray(input?.toolCall?.args?.Subagents)
      ? input.toolCall.args.Subagents.length : null } : {}),
    payload_sha256: createHash('sha256').update(raw).digest('hex'),
  }) + '\n');
} catch { /* Denial still returns when audit storage is unavailable. */ }
process.stdout.write(JSON.stringify({ decision, reason: decision === 'allow'
  ? 'Final structured answer only' : 'mush authorized discussion forbids resource tools and recursive dispatch' }) + '\n');
