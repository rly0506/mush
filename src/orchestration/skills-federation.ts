/**
 * GOAL-048: 跨 Harness 技能双向转译与统一热挂载引擎 (Skills Federation Engine)
 */

import path from 'node:path';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';

export type HarnessType = 'agy' | 'claude' | 'codex' | 'dsh' | 'generic';

export interface UnifiedSkillParam {
  name: string;
  type: string;
  description?: string;
  required?: boolean;
  default?: unknown;
}

export interface UnifiedSkill {
  name: string;
  description: string;
  parameters: UnifiedSkillParam[];
  content: string;
  source_path?: string;
  source_harness: HarnessType;
  is_safe: boolean;
  violations?: string[];
  metadata?: Record<string, unknown>;
}

export function parseSkillFromMarkdown(markdownContent: string, sourcePath?: string): UnifiedSkill {
  let name = '';
  let description = '';
  let content = markdownContent;
  let sourceHarness: HarnessType = 'generic';

  // 1. 尝试解析 YAML Frontmatter
  const frontmatterMatch = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(markdownContent);
  if (frontmatterMatch) {
    const yamlBlock = frontmatterMatch[1];
    content = frontmatterMatch[2].trim();
    sourceHarness = 'agy';

    const nameMatch = /^name:\s*(.+)$/m.exec(yamlBlock);
    const descMatch = /^description:\s*(.+)$/m.exec(yamlBlock);

    if (nameMatch) name = nameMatch[1].trim().replace(/^['"]|['"]$/g, '');
    if (descMatch) description = descMatch[1].trim().replace(/^['"]|['"]$/g, '');
  } else {
    // 2. 尝试从 Markdown 标题解析
    const titleMatch = /^#\s+(.+)$/m.exec(markdownContent);
    if (titleMatch) {
      name = titleMatch[1].trim();
    }
    const lines = markdownContent.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        description = trimmed.replace(/^>\s*/, '');
        break;
      }
    }
  }

  if (!name && sourcePath) {
    name = path.basename(sourcePath, path.extname(sourcePath)).toLowerCase();
  }
  if (!name) name = 'unnamed-skill';
  if (!description) description = `Custom skill: ${name}`;

  const safety = validateSkillSafetyContent(markdownContent);

  return {
    name,
    description,
    parameters: [],
    content,
    source_path: sourcePath,
    source_harness: sourceHarness,
    is_safe: safety.safe,
    violations: safety.violations,
  };
}

export function validateSkillSafetyContent(content: string): { safe: boolean; violations: string[] } {
  const violations: string[] = [];
  const dangerousPatterns = [
    { pattern: /(?:\/etc\/passwd|\/etc\/shadow|C:\\Windows\\System32)/i, reason: '尝试读取操作系统敏感目录' },
    { pattern: /(?:id_rsa|\.aws\/credentials|\.ssh\/authorized_keys)/i, reason: '包含私钥或凭据嗅探路径' },
    { pattern: /(?:rm\s+-rf\s+\/|Format-Volume|del\s+\/f\s+\/s\s+\/q\s+C:\\)/i, reason: '包含高危破坏性系统级删除指令' },
  ];

  for (const item of dangerousPatterns) {
    if (item.pattern.test(content)) {
      violations.push(item.reason);
    }
  }

  return {
    safe: violations.length === 0,
    violations,
  };
}

export function transpileSkill(skill: UnifiedSkill, targetHarness: HarnessType): string {
  switch (targetHarness) {
    case 'agy':
      return `---
name: ${skill.name}
description: ${skill.description}
---

${skill.content}`;

    case 'claude':
      return `# /skill-${skill.name}

> ${skill.description}

## Usage & Execution Instructions
${skill.content}`;

    case 'codex':
      return `# SKILL: ${skill.name}
DESCRIPTION: ${skill.description}

${skill.content}`;

    case 'dsh':
      return `[skill.${skill.name}]
description = "${skill.description.replace(/"/g, '\\"')}"

${skill.content}`;

    case 'generic':
    default:
      return `# ${skill.name}
${skill.description}

${skill.content}`;
  }
}

export class SkillsFederationEngine {
  private mountedDirs: Set<string> = new Set();
  private skillsCache: Map<string, UnifiedSkill> = new Map();

  constructor(initialDirs: string[] | string = []) {
    const dirs = Array.isArray(initialDirs) ? initialDirs : [initialDirs];
    for (const dir of dirs) {
      if (typeof dir === 'string' && dir.trim().length > 1) {
        this.mountDirectory(dir.trim());
      }
    }
  }

  public mountDirectory(dirPath: string): { count: number; mounted: string[] } {
    if (!existsSync(dirPath)) {
      return { count: 0, mounted: Array.from(this.mountedDirs) };
    }
    const resolved = path.resolve(dirPath);
    this.mountedDirs.add(resolved);
    this.scanFederatedSkills();
    return {
      count: this.skillsCache.size,
      mounted: Array.from(this.mountedDirs),
    };
  }

  public unmountDirectory(dirPath: string): boolean {
    const resolved = path.resolve(dirPath);
    const existed = this.mountedDirs.delete(resolved);
    if (existed) {
      this.scanFederatedSkills();
    }
    return existed;
  }

  public listMountedDirectories(): string[] {
    return Array.from(this.mountedDirs);
  }

  public scanFederatedSkills(): UnifiedSkill[] {
    this.skillsCache.clear();

    for (const dir of this.mountedDirs) {
      if (!existsSync(dir)) continue;
      this.scanDirectoryRecursive(dir, 0);
    }

    return Array.from(this.skillsCache.values());
  }

  private scanDirectoryRecursive(dir: string, depth = 0): void {
    if (depth > 5) return;
    try {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        if (entry === 'node_modules' || entry === '.git' || entry.startsWith('$')) continue;
        const fullPath = path.join(dir, entry);
        try {
          const stat = statSync(fullPath);
          if (stat.isDirectory()) {
            // 递归扫描子目录 (例如技能包 subfolder/SKILL.md)
            this.scanDirectoryRecursive(fullPath, depth + 1);
          } else if (stat.isFile()) {
            if (entry === 'SKILL.md' || entry.endsWith('.skill.md') || entry.endsWith('.skill')) {
              const raw = readFileSync(fullPath, 'utf-8');
              const skill = parseSkillFromMarkdown(raw, fullPath);
              if (skill.name) {
                this.skillsCache.set(skill.name, skill);
              }
            }
          }
        } catch {}
      }
    } catch {}
  }

  public getSkill(name: string): UnifiedSkill | undefined {
    return this.skillsCache.get(name);
  }

  public listSkills(): UnifiedSkill[] {
    return Array.from(this.skillsCache.values());
  }

  public getSkillForHarness(name: string, targetHarness: HarnessType): string | undefined {
    const skill = this.skillsCache.get(name);
    if (!skill) return undefined;
    return transpileSkill(skill, targetHarness);
  }
}
