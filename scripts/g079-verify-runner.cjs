// GOAL-079 实机验证引导：起临时看板服务（fake runner，fixture 隔离）+ 调 Playwright 脚本。
// Windows 转义铁律：复杂逻辑必须脚本文件（AGENTS.md）。仿 g076 基线起板姿势。
'use strict';
const { mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const fromRoot = (rel) => pathToFileURL(path.join(ROOT, rel)).href;

async function main() {
  const { DispatchPipeline } = await import(fromRoot('src/web/dispatch.ts'));
  const { startBoardServer } = await import(fromRoot('src/web/server.ts'));

  const fixture = path.join(ROOT, '.test-fixtures', 'g079-verify', String(process.pid));
  const approvalRoot = path.join(fixture, 'approvals');
  mkdirSync(approvalRoot, { recursive: true });
  mkdirSync(path.join(fixture, 'goals', 'receipts', 'dispatch-approvals'), { recursive: true });
  writeFileSync(
    path.join(fixture, 'goals', 'receipts', 'dispatch-approvals', 'head-dog.approved.json'),
    JSON.stringify({ approved: true }) + '\n', 'utf8');

  const runAdapter = async () => ({ exitCode: 0, stdout: 'g079 验证桩', stderr: '', timedOut: false, childKilled: false });
  const pipeline = new DispatchPipeline({
    workspaceRoot: fixture,
    approvalRoot,
    ledgerPath: path.join(fixture, 'ledger.jsonl'),
    runAdapter,
  });
  const server = await startBoardServer({
    approvalRoot,
    runId: 'g079-verify',
    assignmentEpoch: 1,
    port: 0,
    dispatch: pipeline,
    runtimeRoot: path.join(fixture, 'runtime'),
  });

  const base = `http://127.0.0.1:${server.port}/`;
  console.log('BOARD_UP', base);
  const py = path.join(ROOT, '.venv-pw', 'Scripts', 'python.exe');
  const child = spawn(py, [path.join(ROOT, 'scripts', 'verify-g079.py')], {
    env: { ...process.env, G079_BASE: base },
    stdio: 'inherit',
  });
  child.on('exit', (code) => {
    Promise.resolve(server.close ? server.close() : null).catch(() => {}).finally(() => {
      process.exit(code ?? 1);
    });
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
