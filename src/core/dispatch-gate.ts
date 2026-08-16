/**
 * M1 fixture-reference（非生产实现）：
 * 派发门原子写入语义（存在即拒绝、不覆盖、路径必须被 allowed root 包含、
 * dispatch_id 必须为 32 位十六进制）。Node 用 fs flag 'wx' 得到同等的
 * create-exclusive 语义。
 *
 * PS 源（只读）：
 *   D:\意向项目\.agent-bridge\tools\start-goal-orchestrator.ps1 L1256-L1290
 *   D:\意向项目\.agent-bridge\tools\tests\bridge-process-job.tests.ps1 L497-L506
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface DispatchGateResult {
  path: string;
  sha256: string;
  content: string;
}

export function writeDispatchGateAtomic(
  targetPath: string,
  dispatchId: string,
  allowedRoot: string,
): DispatchGateResult {
  if (!/^[0-9A-Fa-f]{32}$/.test(dispatchId)) {
    throw new Error('Dispatch gate dispatch_id must be a 32-hex value.');
  }
  const full = path.resolve(targetPath);
  const root = path.resolve(allowedRoot);
  const relative = path.relative(root, full);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Dispatch gate path must be contained by the allowed root.');
  }
  if (existsSync(full)) {
    throw new Error(`Dispatch gate already exists: ${full}`);
  }
  mkdirSync(path.dirname(full), { recursive: true });
  const content =
    JSON.stringify({
      schema_version: 2,
      dispatch_id: dispatchId,
      released_at_utc: new Date().toISOString(),
    }) + '\n';
  writeFileSync(full, content, { encoding: 'utf8', flag: 'wx' });
  const sha256 = createHash('sha256').update(readFileSync(full)).digest('hex').toUpperCase();
  return { path: full, sha256, content };
}
