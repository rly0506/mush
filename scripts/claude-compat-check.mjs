#!/usr/bin/env node
// GOAL-085 第三阶段维护片：Claude 新版免费行为兼容检查——CLI 薄壳（逻辑在 src/claude-compat-check.ts）。
// 用法：node scripts/claude-compat-check.mjs --output-dir <dir> [--expected-version x.y.z] [--timeout-ms 90000] [--max-turns 5]
// 退出码：0 = 全部检查 PASS；1 = 存在 FAIL/UNKNOWN。零模型调用（假后端 loopback，合成凭据，隔离环境）。
import('../src/claude-compat-check.ts').then(async ({ main }) => {
  const code = await main(process.argv.slice(2));
  process.exitCode = code;
}).catch(error => {
  process.stderr.write(`claude-compat-check: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
