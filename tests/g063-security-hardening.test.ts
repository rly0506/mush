import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startBoardServer } from '../src/web/server.ts';
import { saveAttachment } from '../src/web/attachments.ts';
import { renderBoardPage } from '../src/web/page.ts';

test('GOAL-063 Zero-Trust Auth and Sandbox Hardening Suite', async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'mush-g063-'));
  const approvalRoot = path.join(root, 'approvals');
  const workspaceRoot = path.join(root, 'workspace');
  const runtimeRoot = path.join(root, 'runtime');
  mkdirSync(approvalRoot, { recursive: true });
  mkdirSync(workspaceRoot, { recursive: true });
  mkdirSync(runtimeRoot, { recursive: true });

  const callerToken = 'secret_token_123456';
  const server = await startBoardServer({
    approvalRoot,
    workspaceRoot,
    runtimeRoot,
    runId: 'test-g063',
    assignmentEpoch: 1,
    callerToken,
    enforceCallerToken: true,
  });

  const baseUrl = `http://127.0.0.1:${server.port}`;

  t.after(async () => {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  });

  await t.test('1. GET /api/session/token is protected against cross-origin access', async () => {
    // Cross-origin request should be 403
    const crossOrigin = await fetch(`${baseUrl}/api/session/token`, {
      headers: { 'Origin': 'https://evil.website.com' },
    });
    assert.equal(crossOrigin.status, 403);
    const crossJson = (await crossOrigin.json()) as any;
    assert.equal(crossJson.ok, false);
    assert.match(crossJson.error, /cross-origin session token access blocked/i);

    // Loopback request should return caller_token
    const loopback = await fetch(`${baseUrl}/api/session/token`, {
      headers: { 'Origin': `http://127.0.0.1:${server.port}` },
    });
    assert.equal(loopback.status, 200);
    const loopbackJson = (await loopback.json()) as any;
    assert.equal(loopbackJson.ok, true);
    assert.equal(loopbackJson.caller_token, callerToken);
  });

  await t.test('2. CSRF protection: blocks mutating requests with non-loopback Origin header', async () => {
    // Cross-origin attack attempt
    const evilRes = await fetch(`${baseUrl}/api/chat/mention-file`, {
      method: 'POST',
      headers: {
        'Origin': 'https://evil.attacker.com',
        'X-Mush-Caller-Auth': callerToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ filePath: 'any.txt' }),
    });
    assert.equal(evilRes.status, 403);
    const evilJson = (await evilRes.json()) as any;
    assert.equal(evilJson.ok, false);
    assert.match(evilJson.error, /cross-origin mutation blocked/i);

    // Valid loopback Origin succeeds CSRF check
    const validRes = await fetch(`${baseUrl}/api/chat/mention-file`, {
      method: 'POST',
      headers: {
        'Origin': `http://127.0.0.1:${server.port}`,
        'X-Mush-Caller-Auth': callerToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ filePath: 'nonexistent.txt' }),
    });
    assert.equal(validRes.status, 200); // Mention file returns 200 with result
  });

  await t.test('3. Sandbox: POST /api/chat/mention-file rejects paths outside registered workspace roots', async () => {
    // Create an outside secret file
    const outsideDir = mkdtempSync(path.join(tmpdir(), 'mush-outside-'));
    const secretFile = path.join(outsideDir, 'secret_key.pem');
    writeFileSync(secretFile, 'SUPER_SECRET_KEY');

    try {
      const res = await fetch(`${baseUrl}/api/chat/mention-file`, {
        method: 'POST',
        headers: {
          'X-Mush-Caller-Auth': callerToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ filePath: secretFile }),
      });
      assert.equal(res.status, 403);
      const json = (await res.json()) as any;
      assert.equal(json.ok, false);
      assert.match(json.error, /outside allowed workspace roots/i);
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  await t.test('4. Sandbox: POST /api/context/assemble rejects unregistered workspace roots', async () => {
    const res = await fetch(`${baseUrl}/api/context/assemble`, {
      method: 'POST',
      headers: {
        'X-Mush-Caller-Auth': callerToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        workspace: 'C:\\NonexistentOrOutsideFolder',
        files: ['index.ts'],
      }),
    });
    assert.equal(res.status, 403);
    const json = (await res.json()) as any;
    assert.equal(json.ok, false);
    assert.match(json.error, /not registered in allowlist/i);
  });

  await t.test('5. Session ID format enforcement in POST /api/chat and GET /api/chat/history', async () => {
    // Invalid resume session ID in POST /api/chat
    const badPost = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'X-Mush-Caller-Auth': callerToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: 'hello',
        resume: '../../etc/passwd',
      }),
    });
    assert.equal(badPost.status, 400);
    const badPostJson = (await badPost.json()) as any;
    assert.match(badPostJson.error, /invalid resume session_id format/i);

    // Invalid session query param in GET /api/chat/history
    const badHistory = await fetch(`${baseUrl}/api/chat/history?session=..%2F..%2Fetc%2Fpasswd`);
    assert.equal(badHistory.status, 400);
    const badHistJson = (await badHistory.json()) as any;
    assert.match(badHistJson.error, /invalid session query param format/i);
  });

  await t.test('6. SVG attachments receive CSP sandbox and X-Content-Type-Options headers', async () => {
    const svgContent = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
    const att = saveAttachment(runtimeRoot, {
      name: 'malicious.svg',
      type: 'image/svg+xml',
      data: Buffer.from(svgContent, 'utf8').toString('base64'),
    });

    const res = await fetch(`${baseUrl}/api/attachments/${att.id}`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /image\/svg\+xml/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.match(res.headers.get('content-security-policy') ?? '', /default-src 'none'/);
  });

  await t.test('7. Rendered board page includes escHtml sanitization in ELO table script', () => {
    const html = renderBoardPage(callerToken);
    assert.match(html, /function escHtml/);
    assert.match(html, /replace\(\/\[&<>"'\]\/g/);
  });
});
