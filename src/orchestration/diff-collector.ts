/**
 * GOAL-035: 派发结果 Git Diff 采集与解析引擎
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

export type FileSensitivity = 'critical' | 'normal' | 'generated';

export interface DiffHunk {
  header: string;
  old_start: number;
  old_lines: number;
  new_start: number;
  new_lines: number;
  lines: string[];
}

export interface FileDiff {
  old_path: string;
  new_path: string;
  status: 'added' | 'deleted' | 'modified' | 'renamed';
  additions: number;
  deletions: number;
  sensitivity: FileSensitivity;
  hunks: DiffHunk[];
  is_binary?: boolean;
}

export interface DiffResult {
  files: FileDiff[];
  total_files: number;
  total_additions: number;
  total_deletions: number;
  captured_at_utc: string;
}

/** 敏感度分类 */
export function classifyDiffSensitivity(filePath: string): FileSensitivity {
  const norm = filePath.replace(/\\/g, '/');
  const base = path.basename(norm);

  if (
    base === 'CONSTITUTION.md' ||
    base === 'DECISIONS.md' ||
    base === 'AGENTS.md' ||
    /(^\.env|\.(env|key|pem|p12|pfx)$)/i.test(base) ||
    /(id_rsa|id_ed25519|credentials?|secrets?)/i.test(base)
  ) {
    return 'critical';
  }

  if (
    norm.startsWith('runtime/') ||
    norm.startsWith('dist/') ||
    norm.startsWith('build/') ||
    norm.startsWith('node_modules/') ||
    norm.startsWith('coverage/') ||
    norm.includes('/.system_generated/') ||
    norm.startsWith('.system_generated/')
  ) {
    return 'generated';
  }

  return 'normal';
}

/** 解析 Unified Diff 文本 */
export function parseUnifiedDiff(rawDiff: string): FileDiff[] {
  if (!rawDiff || rawDiff.trim() === '') return [];

  const files: FileDiff[] = [];
  const lines = rawDiff.split(/\r?\n/);
  let currentFile: FileDiff | null = null;
  let currentHunk: DiffHunk | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('diff --git ')) {
      if (currentHunk && currentFile) {
        currentFile.hunks.push(currentHunk);
        currentHunk = null;
      }
      if (currentFile) {
        files.push(currentFile);
      }

      // diff --git a/path b/path
      const parts = line.substring(11).split(' ');
      const oldPath = parts[0]?.replace(/^a\//, '') || '';
      const newPath = parts[1]?.replace(/^b\//, '') || oldPath;

      currentFile = {
        old_path: oldPath,
        new_path: newPath,
        status: 'modified',
        additions: 0,
        deletions: 0,
        sensitivity: classifyDiffSensitivity(newPath || oldPath),
        hunks: [],
      };
      continue;
    }

    if (!currentFile) continue;

    if (line.startsWith('new file mode ')) {
      currentFile.status = 'added';
    } else if (line.startsWith('deleted file mode ')) {
      currentFile.status = 'deleted';
    } else if (line.startsWith('similarity index ') || line.startsWith('rename from ')) {
      currentFile.status = 'renamed';
    } else if (line.startsWith('Binary files ') && line.includes('differ')) {
      currentFile.is_binary = true;
    } else if (line.startsWith('@@ ')) {
      if (currentHunk) {
        currentFile.hunks.push(currentHunk);
      }

      // @@ -old_start,old_lines +new_start,new_lines @@
      const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/);
      if (hunkMatch) {
        currentHunk = {
          header: line,
          old_start: parseInt(hunkMatch[1], 10),
          old_lines: hunkMatch[2] ? parseInt(hunkMatch[2], 10) : 1,
          new_start: parseInt(hunkMatch[3], 10),
          new_lines: hunkMatch[4] ? parseInt(hunkMatch[4], 10) : 1,
          lines: [],
        };
      } else {
        currentHunk = {
          header: line,
          old_start: 0,
          old_lines: 0,
          new_start: 0,
          new_lines: 0,
          lines: [],
        };
      }
    } else if (currentHunk) {
      const isCritical = currentFile.sensitivity === 'critical';
      if (line.startsWith('+') && !line.startsWith('+++')) {
        currentFile.additions++;
        currentHunk.lines.push(isCritical ? '+[REDACTED SENSITIVE CONTENT]' : line);
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        currentFile.deletions++;
        currentHunk.lines.push(isCritical ? '-[REDACTED SENSITIVE CONTENT]' : line);
      } else if (line.startsWith(' ') || line === '') {
        currentHunk.lines.push(isCritical ? ' [REDACTED SENSITIVE LINE]' : line);
      }
    }
  }

  if (currentHunk && currentFile) {
    currentFile.hunks.push(currentHunk);
  }
  if (currentFile) {
    files.push(currentFile);
  }

  return files;
}

/** 采集工作区真实 Git Diff（未暂存 + 已暂存 + 未跟踪文件） */
export function captureWorkspaceDiff(workspaceRoot: string): DiffResult {
  const normRoot = path.resolve(workspaceRoot);
  const nowUtc = new Date().toISOString();

  if (!fs.existsSync(path.join(normRoot, '.git'))) {
    return {
      files: [],
      total_files: 0,
      total_additions: 0,
      total_deletions: 0,
      captured_at_utc: nowUtc,
    };
  }

  try {
    // 1. git diff (unstaged)
    const unstaged = execFileSync('git', ['diff', '--no-color', '--unified=3'], {
      cwd: normRoot,
      encoding: 'utf-8',
      timeout: 10000,
    });

    // 2. git diff --cached (staged)
    const staged = execFileSync('git', ['diff', '--cached', '--no-color', '--unified=3'], {
      cwd: normRoot,
      encoding: 'utf-8',
      timeout: 10000,
    });

    const allDiffText = [staged, unstaged].filter(Boolean).join('\n');
    const files = parseUnifiedDiff(allDiffText);

    // 统计
    let totalAdds = 0;
    let totalDels = 0;
    for (const f of files) {
      totalAdds += f.additions;
      totalDels += f.deletions;
    }

    // 敏感文件优先排序
    files.sort((a, b) => {
      const rank = (s: FileSensitivity) => (s === 'critical' ? 0 : s === 'normal' ? 1 : 2);
      return rank(a.sensitivity) - rank(b.sensitivity);
    });

    return {
      files,
      total_files: files.length,
      total_additions: totalAdds,
      total_deletions: totalDels,
      captured_at_utc: nowUtc,
    };
  } catch (error) {
    return {
      files: [],
      total_files: 0,
      total_additions: 0,
      total_deletions: 0,
      captured_at_utc: nowUtc,
    };
  }
}

/** 安全单文件回滚 (git checkout -- <file>) */
export function revertWorkspaceFile(workspaceRoot: string, targetFile: string): { ok: boolean; message: string } {
  const normRoot = path.resolve(workspaceRoot);
  const fullTarget = path.resolve(normRoot, targetFile);
  const normRootPrefix = normRoot.endsWith(path.sep) ? normRoot : normRoot + path.sep;

  // 路径穿越防线 (F-AUD-03: 严格校验以 normRoot + path.sep 开头，防止同名前缀目录绕过)
  if (!fullTarget.startsWith(normRootPrefix) || fullTarget === normRoot) {
    return { ok: false, message: 'Invalid target path (out of workspace boundary)' };
  }

  // .agent-bridge 黄金基准只读防线
  if (fullTarget.includes('.agent-bridge')) {
    return { ok: false, message: 'Path inside .agent-bridge is frozen' };
  }

  const relPath = path.relative(normRoot, fullTarget);

  try {
    execFileSync('git', ['checkout', '--', relPath], {
      cwd: normRoot,
      encoding: 'utf-8',
      timeout: 10000,
    });
    return { ok: true, message: `Successfully reverted ${relPath}` };
  } catch (err) {
    return { ok: false, message: `Git revert failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}
