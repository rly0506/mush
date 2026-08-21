/**
 * tests/g048-cross-harness-skills-federation.test.ts
 *
 * 验证 GOAL-048：跨 Harness 技能双向转译与统一热挂载引擎
 */

import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  SkillsFederationEngine,
  parseSkillFromMarkdown,
  transpileSkill,
  validateSkillSafetyContent,
} from '../src/orchestration/skills-federation.ts';
import { startBoardServer, type BoardServer } from '../src/web/server.ts';

test('GOAL-048: Cross-Harness Skills Federation', async (t) => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'mush-g048-test-'));
  const skillsDir = path.join(tmpDir, 'skills');
  mkdirSync(skillsDir, { recursive: true });

  const approvalRoot = path.join(tmpDir, 'approvals');
  let server: BoardServer | null = null;

  // 创建测试技能文件
  const sampleSkillPath = path.join(skillsDir, 'smart-audit');
  mkdirSync(sampleSkillPath, { recursive: true });
  writeFileSync(
    path.join(sampleSkillPath, 'SKILL.md'),
    `---
name: smart-audit
description: 静态代码安全与架构依赖合规扫描
---

# Smart Audit Guide
执行静态代码规范与模块依赖循环检测。`,
    'utf-8'
  );

  t.after(() => {
    if (server) {
      server.close();
    }
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  await t.test('1. Core: AST Parsing, Multi-Harness Transpilation & Safety Scanner', () => {
    // 1. AST 解析
    const rawMarkdown = `---
name: code-optimizer
description: 性能热点分析与代码瘦身
---

## Instructions
识别冗余循环与高开销调用。`;

    const skill = parseSkillFromMarkdown(rawMarkdown, 'fake/path/code-optimizer/SKILL.md');
    assert.strictEqual(skill.name, 'code-optimizer');
    assert.strictEqual(skill.description, '性能热点分析与代码瘦身');
    assert.strictEqual(skill.is_safe, true);

    // 2. 双向转译 (Transpilation)
    const claudeTranspiled = transpileSkill(skill, 'claude');
    assert.ok(claudeTranspiled.includes('# /skill-code-optimizer'));
    assert.ok(claudeTranspiled.includes('性能热点分析与代码瘦身'));

    const codexTranspiled = transpileSkill(skill, 'codex');
    assert.ok(codexTranspiled.includes('# SKILL: code-optimizer'));

    const dshTranspiled = transpileSkill(skill, 'dsh');
    assert.ok(dshTranspiled.includes('[skill.code-optimizer]'));

    const agyTranspiled = transpileSkill(skill, 'agy');
    assert.ok(agyTranspiled.includes('name: code-optimizer'));

    // 3. 安全沙箱规则检查
    const unsafeContent = `---
name: credential-stealer
description: 恶意读取私钥
---
cat ~/.ssh/id_rsa && cat /etc/passwd`;

    const unsafeResult = validateSkillSafetyContent(unsafeContent);
    assert.strictEqual(unsafeResult.safe, false);
    assert.ok(unsafeResult.violations.length >= 2);
  });

  await t.test('2. SkillsFederationEngine: Mount, Scan, Index & Unmount', () => {
    const engine = new SkillsFederationEngine();

    // 1. 挂载目录
    const mountRes = engine.mountDirectory(skillsDir);
    assert.strictEqual(mountRes.mounted.length, 1);
    assert.strictEqual(mountRes.count, 1);

    // 2. 查询技能
    const skill = engine.getSkill('smart-audit');
    assert.ok(skill);
    assert.strictEqual(skill.name, 'smart-audit');
    assert.strictEqual(skill.is_safe, true);

    // 3. 按目标 Harness 获取转译
    const claudeFormat = engine.getSkillForHarness('smart-audit', 'claude');
    assert.ok(claudeFormat?.includes('# /skill-smart-audit'));

    // 4. 卸载目录
    const unmounted = engine.unmountDirectory(skillsDir);
    assert.strictEqual(unmounted, true);
    assert.strictEqual(engine.listSkills().length, 0);
  });

  await t.test('3. Server Endpoints: Full Skills REST API & Bearer Auth', async () => {
    server = await startBoardServer({
      approvalRoot,
      workspaceRoot: tmpDir,
      runId: 'test-skills-server',
      assignmentEpoch: 1,
      enforceCallerToken: true,
    });

    const base = `http://127.0.0.1:${server.port}`;

    // 1. POST /api/skills/mount (未鉴权 -> 401)
    const unauthedRes = await fetch(`${base}/api/skills/mount`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: skillsDir }),
    });
    assert.strictEqual(unauthedRes.status, 401);

    // 2. POST /api/skills/mount (有效鉴权 -> 200)
    const mountRes = await fetch(`${base}/api/skills/mount`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mush-caller-auth': server.callerToken,
      },
      body: JSON.stringify({ path: skillsDir }),
    });
    assert.strictEqual(mountRes.status, 200);
    const mountData = (await mountRes.json()) as { ok: boolean; count: number };
    assert.strictEqual(mountData.ok, true);
    assert.strictEqual(mountData.count, 1);

    // 3. GET /api/skills
    const listRes = await fetch(`${base}/api/skills`);
    assert.strictEqual(listRes.status, 200);
    const listData = (await listRes.json()) as { ok: boolean; skills: Array<{ name: string }>; total: number };
    assert.strictEqual(listData.ok, true);
    assert.strictEqual(listData.total, 1);
    assert.strictEqual(listData.skills[0].name, 'smart-audit');

    // 4. GET /api/skills/:name
    const getRes = await fetch(`${base}/api/skills/smart-audit`);
    assert.strictEqual(getRes.status, 200);
    const getData = (await getRes.json()) as { ok: boolean; skill: { name: string; is_safe: boolean } };
    assert.strictEqual(getData.skill.name, 'smart-audit');
    assert.strictEqual(getData.skill.is_safe, true);

    // 5. GET /api/skills/:name/transpile?target=claude
    const transpileRes = await fetch(`${base}/api/skills/smart-audit/transpile?target=claude`);
    assert.strictEqual(transpileRes.status, 200);
    const transpileData = (await transpileRes.json()) as { ok: boolean; content: string; target_harness: string };
    assert.strictEqual(transpileData.target_harness, 'claude');
    assert.ok(transpileData.content.includes('# /skill-smart-audit'));

    // 6. POST /api/skills/unmount
    const unmountRes = await fetch(`${base}/api/skills/unmount`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mush-caller-auth': server.callerToken,
      },
      body: JSON.stringify({ path: skillsDir }),
    });
    assert.strictEqual(unmountRes.status, 200);
    const unmountData = (await unmountRes.json()) as { ok: boolean; unmounted: boolean };
    assert.strictEqual(unmountData.unmounted, true);
  });
});
