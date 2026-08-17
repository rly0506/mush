/** 弃置 p20b 卡（重排：人因 UX 批先行，完成后重新压卡）。 */
const BASE = 'http://127.0.0.1:4790';

async function main() {
  const snap = await (await fetch(BASE + '/api/snapshot')).json();
  const pending = (snap.approvals ?? []).filter((a) => a.status === 'WAITING' && a.dispatch);
  for (const a of pending) {
    if (a.dispatch.goal_id !== 'MUSH-GOAL-021') continue;
    const res = await fetch(BASE + '/api/approvals/respond', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ request_file: a.request_file, decision: 'REJECTED', note: '重排：人因 UX 批（GOAL-022）先行，M2 完成后重新压卡——避免 kimi 双通道' }),
    });
    console.log(a.request_file.slice(9, 17), res.status);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
