/**
 * GOAL-067（P1-7）：工作区路径包含性守卫。
 *
 * 采用与 diff-collector.ts F-AUD-03 相同的标准：解析后的绝对路径必须以
 * normRoot + path.sep 开头——裸 startsWith(normRoot) 会被兄弟目录前缀绕过
 * （workspace=D:\mush 时 D:\mush-backup\x 通过校验）。越界返回 null，
 * 由调用方决定跳过或报错。
 */

import path from 'node:path';

export function resolveInsideWorkspace(workspaceRoot: string, targetRel: string): string | null {
  const normRoot = path.resolve(workspaceRoot);
  const prefix = normRoot.endsWith(path.sep) ? normRoot : normRoot + path.sep;
  let full: string;
  try {
    full = path.resolve(normRoot, targetRel);
  } catch {
    return null;
  }
  if (!full.startsWith(prefix)) return null;
  return full;
}
