import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validateAdapterContract, type AdapterContract } from '../src/adapters/contract.ts';
import { evaluateLiveness, resolveWindowsExecutable } from '../src/core/liveness-ladder.ts';

// 2026-09-06 实机审计补漏：既有 g080 测试全部注入 spawnFn，从未覆盖 Windows 真实 spawn
// 语义——.cmd 垫片通道（dsh/zcode/codex）实机 L0 全灭（execFile 不做 PATHEXT 搜索）
// 而机检全绿。本文件不打桩：defaultSpawn 真实拉起临时 .cmd fixture，恒零成本、零网络。

const isWin = process.platform === 'win32';

function contractOf(executable: string): AdapterContract {
  return validateAdapterContract({
    adapter_id: 'fixture-dog',
    executable,
    arguments: ['--headless'],
    protocol: 't1',
    prompt_transport: 'stdin',
    expected_provider: 'fake',
    expected_model_id: 'fixture-dog-model',
  });
}

test('PATHEXT 解析：裸命令名命中 .cmd/.exe，缺失返回 undefined（win32）', () => {
  if (!isWin) return;
  const tmp = mkdtempSync(path.join(tmpdir(), 'mush-liveness-'));
  try {
    writeFileSync(path.join(tmp, 'onlycmd.cmd'), '@echo off\r\n', 'utf8');
    writeFileSync(path.join(tmp, 'dog.cmd'), '@echo off\r\n', 'utf8');
    writeFileSync(path.join(tmp, 'dog.exe'), 'not-a-real-exe', 'utf8'); // 仅测解析优先级，不执行
    // PATHEXT 兜底顺序 .EXE 先于 .CMD：两者并存时解析到 .exe（扩展名大小写随 PATHEXT 声明，断言不敏感）
    assert.match(resolveWindowsExecutable('dog', tmp, '')!, /\.exe$/i);
    assert.match(resolveWindowsExecutable('onlycmd', tmp, '')!, /\.cmd$/i);
    assert.equal(resolveWindowsExecutable('definitely-missing-xyz', tmp, ''), undefined);
    // 已带扩展名/路径的输入：存在原样返回，缺失诚实 undefined
    assert.equal(resolveWindowsExecutable(path.join(tmp, 'onlycmd.cmd'), tmp, ''), path.join(tmp, 'onlycmd.cmd'));
    assert.equal(resolveWindowsExecutable(path.join(tmp, 'nope.cmd'), tmp, ''), undefined);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('PATHEXT 解析：非 win32 原样透传', () => {
  if (isWin) {
    const desc = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'linux' });
    try {
      assert.equal(resolveWindowsExecutable('dsh', '', ''), 'dsh');
    } finally {
      Object.defineProperty(process, 'platform', desc!);
    }
  } else {
    assert.equal(resolveWindowsExecutable('dsh', '', ''), 'dsh');
  }
});

test('L0 真实拉起 .cmd 垫片通道（默认 defaultSpawn，不打桩）→ PROCESS_ONLY', async () => {
  if (!isWin) return;
  const tmp = mkdtempSync(path.join(tmpdir(), 'mush-liveness-'));
  const oldPath = process.env.PATH ?? '';
  try {
    writeFileSync(path.join(tmp, 'onlycmd.cmd'), '@echo off\r\necho fixture-dog 1.2.3\r\n', 'utf8');
    process.env.PATH = tmp + path.delimiter + oldPath; // 前插而非替换，保证 cmd.exe 本体可解析
    const result = await evaluateLiveness('fixture-dog', contractOf('onlycmd'));
    assert.equal(result.ok, true);
    assert.equal(result.level_reached, 1);
    assert.equal(result.label, 'PROCESS_ONLY');
  } finally {
    process.env.PATH = oldPath;
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('L0 真实解析失败 → DEAD + 诚实指引（不再谎报"未安装"）', async () => {
  if (!isWin) return;
  const result = await evaluateLiveness('fixture-dog', contractOf('definitely-missing-harness-xyz'));
  assert.equal(result.ok, false);
  assert.equal(result.label, 'DEAD');
  assert.equal(result.level_reached, 0);
  assert.match(result.detail, /PATH\/PATHEXT/);
});
