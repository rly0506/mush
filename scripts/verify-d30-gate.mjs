/** D30 闸门验证：真实派发必须停审批卡（BLOCKED_WAITING_OWNER），不产生任何调用。 */
const body = {
  adapter_id: 'kimi-code',
  prompt: 'D30 闸门验证：本条应停审批卡，不产生任何调用。',
  real: true,
  effort: 'HIGH',
  timeout_s: 60,
  workspace: 'D:\\mush',
};
const res = await fetch('http://127.0.0.1:4790/api/dispatch', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
const j = await res.json();
console.log('status:', j.dispatch ? j.dispatch.status : j.error ?? JSON.stringify(j).slice(0, 120));
