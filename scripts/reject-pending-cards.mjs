/** owner 指令：否决全部在场派发审批卡（REJECTED 折算终态）。 */
const BASE = 'http://127.0.0.1:4790';

async function main() {
  const snap = await (await fetch(BASE + '/api/snapshot')).json();
  const pending = (snap.approvals ?? []).filter((a) => a.status === 'WAITING' && a.dispatch);
  for (const a of pending) {
    const res = await fetch(BASE + '/api/approvals/respond', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ request_file: a.request_file, decision: 'REJECTED', note: 'owner 2026-08-17 指令否决（配合 GOAL-019/020 融合重排）' }),
    });
    const j = await res.json().catch(() => ({}));
    console.log(a.request_file.slice(9, 17), a.dispatch.adapter_id, res.status, j.dispatch ? JSON.stringify(j.dispatch) : (j.error ?? ''));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
