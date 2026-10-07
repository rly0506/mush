// GOAL-084 权限探针用本地哑 agent（零网络、零模型、零副作用）：
// 递归面核验（C5/A5）让被测通道尝试启动本脚本——观察"能否派生子进程"，
// 而不是真实再调一次模型（避免递归测试消耗真实额度）。
console.log(JSON.stringify({ marker: 'DUMMY_AGENT_OK', pid: process.pid, at: new Date().toISOString() }));
