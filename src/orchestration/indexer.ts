/**
 * mush 智能上下文装配与轻量 AST 依赖分析引擎（GOAL-032 / GP-19）
 *
 * 目标：
 * - 纯本地 Node/TS 驱动，零外部依赖；
 * - 自动分析目标文件的导入导出依赖拓扑与类型接口声明；
 * - 自动关联测试用例，按 Token 预算打包高密度上下文。
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

export interface ModuleSymbolInfo {
  exports: string[];
  imports: Array<{ source: string; importedSymbols: string[] }>;
  typesAndInterfaces: string[];
  signatures: string[];
}

export interface DependencyNode {
  relative_path: string;
  absolute_path: string;
  exports: string[];
  signatures: string[];
  imported_by: string[];
}

export interface ContextAssembleOptions {
  workspaceRoot: string;
  targetFiles: string[];
  symbols?: string[];
  maxTokensBudget?: number;
  includeTests?: boolean;
  maxDepth?: number;
}

export interface AssembledContext {
  target_files: Array<{ relative_path: string; content: string; exports: string[] }>;
  dependencies: DependencyNode[];
  associated_tests: Array<{ relative_path: string; content: string }>;
  prompt_block: string;
  estimated_tokens: number;
}

/**
 * 提取模块中的符号、类型与函数签名
 */
export function extractModuleSymbols(code: string): ModuleSymbolInfo {
  const exports: string[] = [];
  const imports: Array<{ source: string; importedSymbols: string[] }> = [];
  const typesAndInterfaces: string[] = [];
  const signatures: string[] = [];

  const lines = code.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // 1. 匹配 import 语句
    const importMatch = /import\s+(?:type\s+)?(?:(\w+)|\{([^}]+)\}|\*\s+as\s+(\w+))\s+from\s+['"]([^'"]+)['"]/.exec(line);
    if (importMatch !== null) {
      const source = importMatch[4];
      const importedSymbols: string[] = [];
      if (importMatch[1]) importedSymbols.push(importMatch[1]);
      if (importMatch[3]) importedSymbols.push(importMatch[3]);
      if (importMatch[2]) {
        for (const sym of importMatch[2].split(',')) {
          const trimmed = sym.trim().split(/\s+as\s+/)[0].trim();
          if (trimmed) importedSymbols.push(trimmed);
        }
      }
      imports.push({ source, importedSymbols });
    }

    // 2. 匹配 export 声明
    const exportNamedMatch = /export\s+(?:async\s+)?(?:function|class|const|let|var|type|interface|enum)\s+(\w+)/.exec(line);
    if (exportNamedMatch !== null) {
      exports.push(exportNamedMatch[1]);
    } else {
      const exportGroupMatch = /export\s+\{([^}]+)\}/.exec(line);
      if (exportGroupMatch !== null) {
        for (const sym of exportGroupMatch[1].split(',')) {
          const trimmed = sym.trim().split(/\s+as\s+/)[0].trim();
          if (trimmed) exports.push(trimmed);
        }
      } else if (/export\s+default\s+/.test(line)) {
        exports.push('default');
      }
    }

    // 3. 提取 interface / type 声明签名
    if (/^(?:export\s+)?(?:type|interface)\s+\w+/.test(line)) {
      let block = line;
      if (line.includes('{') && !line.includes('}')) {
        let depth = 1;
        for (let j = i + 1; j < lines.length && j < i + 30; j++) {
          const nextLine = lines[j];
          block += '\n' + nextLine;
          if (nextLine.includes('{')) depth++;
          if (nextLine.includes('}')) depth--;
          if (depth <= 0) break;
        }
      }
      typesAndInterfaces.push(block);
      signatures.push(block);
    } else if (/^(?:export\s+)?(?:async\s+)?function\s+\w+\s*\([^)]*\)(?:\s*:\s*[^{]+)?/.test(line)) {
      // 提取函数头部签名
      const sigMatch = /^(?:export\s+)?(?:async\s+)?function\s+\w+\s*\([^)]*\)(?:\s*:\s*[^{]+)?/.exec(line);
      if (sigMatch) signatures.push(sigMatch[0].trim());
    }
  }

  return {
    exports: Array.from(new Set(exports)),
    imports,
    typesAndInterfaces,
    signatures,
  };
}

/**
 * 递归解析本地文件的依赖树（拓扑排序与防循环）
 */
export function resolveDependencyTree(
  workspaceRoot: string,
  entryFiles: string[],
  maxDepth = 2,
): DependencyNode[] {
  const root = path.resolve(workspaceRoot);
  const resolvedNodes = new Map<string, DependencyNode>();
  const visited = new Set<string>();

  function resolveLocalModule(fromFile: string, importSource: string): string | null {
    if (!importSource.startsWith('.') && !importSource.startsWith('/')) return null;
    const fromDir = path.dirname(fromFile);
    const candidateBase = path.resolve(fromDir, importSource);

    const extensions = ['', '.ts', '.js', '.mts', '.mjs', '.cjs', '.json', '/index.ts', '/index.js'];
    for (const ext of extensions) {
      const fullPath = candidateBase + ext;
      if (existsSync(fullPath) && statSync(fullPath).isFile()) {
        if (fullPath.startsWith(root)) {
          return fullPath;
        }
      }
    }
    return null;
  }

  function traverse(absPath: string, depth: number, importerPath: string | null) {
    if (!existsSync(absPath) || depth > maxDepth) return;
    const relPath = path.relative(root, absPath).replace(/\\/g, '/');

    if (resolvedNodes.has(relPath)) {
      if (importerPath) {
        resolvedNodes.get(relPath)!.imported_by.push(importerPath);
      }
      return;
    }

    if (visited.has(absPath)) return;
    visited.add(absPath);

    let content = '';
    try {
      content = readFileSync(absPath, 'utf8');
    } catch {
      return;
    }

    const symbols = extractModuleSymbols(content);
    const node: DependencyNode = {
      relative_path: relPath,
      absolute_path: absPath,
      exports: symbols.exports,
      signatures: symbols.signatures.slice(0, 15),
      imported_by: importerPath ? [importerPath] : [],
    };
    resolvedNodes.set(relPath, node);

    for (const imp of symbols.imports) {
      const resolvedLocal = resolveLocalModule(absPath, imp.source);
      if (resolvedLocal) {
        traverse(resolvedLocal, depth + 1, relPath);
      }
    }
  }

  for (const entry of entryFiles) {
    const absEntry = path.isAbsolute(entry) ? entry : path.resolve(root, entry);
    traverse(absEntry, 0, null);
  }

  return Array.from(resolvedNodes.values());
}

/**
 * 自动查找源文件关联的测试文件
 */
export function findAssociatedTests(workspaceRoot: string, sourceRelativePath: string): string[] {
  const root = path.resolve(workspaceRoot);
  const testsDir = path.join(root, 'tests');
  if (!existsSync(testsDir)) return [];

  const baseName = path.basename(sourceRelativePath).replace(/\.(ts|js|tsx|jsx)$/, '');
  const cleanBase = baseName.replace(/^[0-9a-zA-Z]+-/, '');

  const associated: string[] = [];
  try {
    const files = readdirSync(testsDir);
    for (const file of files) {
      if (!file.endsWith('.test.ts') && !file.endsWith('.test.js') && !file.endsWith('.spec.ts')) continue;
      const lower = file.toLowerCase();
      if (
        lower.includes(baseName.toLowerCase()) ||
        (cleanBase.length > 2 && lower.includes(cleanBase.toLowerCase()))
      ) {
        associated.push(path.join('tests', file).replace(/\\/g, '/'));
      }
    }
  } catch {
    // 忽略目录扫描异常
  }

  return associated;
}

/**
 * 智能装配精准上下文包
 */
export function assembleContext(options: ContextAssembleOptions): AssembledContext {
  const root = path.resolve(options.workspaceRoot);
  const maxTokens = options.maxTokensBudget ?? 8000;
  const maxDepth = options.maxDepth ?? 2;
  const includeTests = options.includeTests ?? true;

  const targetFilesData: Array<{ relative_path: string; content: string; exports: string[] }> = [];
  const entryAbsFiles: string[] = [];

  for (const file of options.targetFiles) {
    const absPath = path.isAbsolute(file) ? file : path.resolve(root, file);
    if (!absPath.startsWith(root)) continue;
    if (existsSync(absPath) && statSync(absPath).isFile()) {
      const relPath = path.relative(root, absPath).replace(/\\/g, '/');
      const content = readFileSync(absPath, 'utf8');
      const symbols = extractModuleSymbols(content);
      targetFilesData.push({
        relative_path: relPath,
        content,
        exports: symbols.exports,
      });
      entryAbsFiles.push(absPath);
    }
  }

  // 解析依赖
  const allDependencies = resolveDependencyTree(root, entryAbsFiles, maxDepth);
  const targetRelSet = new Set(targetFilesData.map((t) => t.relative_path));
  const pureDependencies = allDependencies.filter((d) => !targetRelSet.has(d.relative_path));

  // 查找关联测试
  const associatedTestPaths = new Set<string>();
  if (includeTests) {
    for (const target of targetFilesData) {
      const tests = findAssociatedTests(root, target.relative_path);
      for (const t of tests) associatedTestPaths.add(t);
    }
  }

  const associatedTestsData: Array<{ relative_path: string; content: string }> = [];
  for (const testRel of associatedTestPaths) {
    const absPath = path.join(root, testRel);
    if (existsSync(absPath) && statSync(absPath).isFile()) {
      associatedTestsData.push({
        relative_path: testRel,
        content: readFileSync(absPath, 'utf8'),
      });
    }
  }

  // 组装 Markdown 提示块
  const blocks: string[] = [];

  blocks.push('## 📦 智能代码上下文包 (Smart Context Packet)\n');

  if (targetFilesData.length > 0) {
    blocks.push('### 🎯 目标文件 (Target Files)');
    for (const file of targetFilesData) {
      blocks.push(`#### 📄 \`${file.relative_path}\` (Exports: ${file.exports.join(', ') || 'none'})\n\`\`\`typescript\n${file.content}\n\`\`\``);
    }
  }

  if (pureDependencies.length > 0) {
    blocks.push('\n### 🧩 依赖模块与关键类型契约 (Dependencies & Type Signatures)');
    for (const dep of pureDependencies) {
      const sigs = dep.signatures.length > 0 ? dep.signatures.join('\n\n') : `// Exports: ${dep.exports.join(', ')}`;
      blocks.push(`#### 🔗 \`${dep.relative_path}\`\n\`\`\`typescript\n${sigs}\n\`\`\``);
    }
  }

  if (associatedTestsData.length > 0) {
    blocks.push('\n### 🧪 关联验证测试用例 (Associated Tests)');
    for (const t of associatedTestsData) {
      blocks.push(`#### 📋 \`${t.relative_path}\`\n\`\`\`typescript\n${t.content}\n\`\`\``);
    }
  }

  let promptBlock = blocks.join('\n\n');
  let estimatedTokens = Math.ceil(promptBlock.length / 3.5);

  // 预算超额修剪（如果超出预算，先裁减测试文件内容或依赖签名）
  if (estimatedTokens > maxTokens) {
    promptBlock = promptBlock.slice(0, Math.floor(maxTokens * 3.5)) + '\n\n...[上下文按 Token 预算截断]';
    estimatedTokens = maxTokens;
  }

  return {
    target_files: targetFilesData,
    dependencies: pureDependencies,
    associated_tests: associatedTestsData,
    prompt_block: promptBlock,
    estimated_tokens: estimatedTokens,
  };
}
