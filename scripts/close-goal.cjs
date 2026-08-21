#!/usr/bin/env node
/**
 * GOAL-062: DoD 一键收官与任务池自动流转工具
 * 用法: node scripts/close-goal.cjs <GOAL-ID> [test_file]
 * 示例: node scripts/close-goal.cjs GOAL-058
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const goalArg = process.argv[2];
if (!goalArg) {
  console.error('❌ 错误: 请指定 Goal 编号，例如: node scripts/close-goal.cjs GOAL-058');
  process.exit(1);
}

const numMatch = /\d+/.exec(goalArg);
if (!numMatch) {
  console.error('❌ 错误: 无法解析 Goal 编号:', goalArg);
  process.exit(1);
}

const num = parseInt(numMatch[0], 10);
const goalId = 'GOAL-' + String(num).padStart(3, '0');
const customTest = process.argv[3];

const goalsDir = path.resolve(__dirname, '../goals');
const receiptsDir = path.resolve(goalsDir, 'receipts');
const tasksPath = path.resolve(__dirname, '../runtime/tasks.jsonl');

// 1. 定位目标 markdown 文件
const files = fs.readdirSync(goalsDir);
const targetFile = files.find(f => f.toUpperCase().startsWith(goalId) && f.endsWith('.md'));

if (!targetFile) {
  console.error(`❌ 错误: 在 goals/ 目录下未找到与 ${goalId} 匹配的文件`);
  process.exit(1);
}

const fullPath = path.join(goalsDir, targetFile);
console.log(`🔍 找到目标文档: ${targetFile}`);

// 2. 如果指定了测试文件，或存在匹配的单测，先跑测试验收
let testToRun = customTest;
if (!testToRun) {
  const testsDir = path.resolve(__dirname, '../tests');
  if (fs.existsSync(testsDir)) {
    const testFiles = fs.readdirSync(testsDir);
    const matchedTest = testFiles.find(tf => tf.toLowerCase().includes('g' + String(num).padStart(3, '0')));
    if (matchedTest) testToRun = path.join('tests', matchedTest);
  }
}

if (testToRun && fs.existsSync(path.resolve(__dirname, '..', testToRun))) {
  console.log(`🧪 正在执行专属验收测试: ${testToRun} ...`);
  try {
    execSync(`node --test --test-isolation=none "${testToRun}"`, {
      cwd: path.resolve(__dirname, '..'),
      stdio: 'inherit'
    });
    console.log('✅ 测试 100% 通过！');
  } catch (err) {
    console.error('❌ 验收测试未通过，终止收官操作！');
    process.exit(1);
  }
}

// 3. 更新目标 markdown 文件状态为 DONE
let content = fs.readFileSync(fullPath, 'utf8');
if (/^[-\ *]\s*状态\s*[:：]/m.test(content)) {
  content = content.replace(/^([-\ *]\s*状态\s*[:：]\s*)`?[A-Za-z_]+`?/m, '$1`DONE`');
} else {
  // 插入状态行
  content = content.replace(/^(#\s+.+\n)/m, '$1\n- 状态：`DONE`\n');
}
fs.writeFileSync(fullPath, content, 'utf8');
console.log(`📝 已将 ${targetFile} 状态更新为 DONE`);

// 4. 写入完成回执
fs.mkdirSync(receiptsDir, { recursive: true });
const receiptPath = path.join(receiptsDir, `${goalId}-receipt.json`);
const receipt = {
  goal_id: goalId,
  file: targetFile,
  status: 'DONE',
  closed_at: new Date().toISOString(),
  verified_by: 'close-goal.cjs',
};
fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2), 'utf8');
console.log(`🧾 已生成完成回执: ${path.basename(receiptPath)}`);

// 5. 触发任务池自动对账
try {
  const { syncGoalsDirectoryToTasks } = require('../src/web/tasks.ts');
  const tasks = syncGoalsDirectoryToTasks(tasksPath, goalsDir, receiptsDir);
  const updatedTask = tasks.find(t => t.goal_id === goalId);
  console.log(`🎯 任务池已同步: ${goalId} 状态 ➔ ${updatedTask ? updatedTask.status : 'DONE'}`);
} catch (e) {
  console.log('⚠️ 任务池同步触发警告 (运行时将自动对账):', e.message);
}

console.log(`\n🎉 ${goalId} 成功收官！已推进到看板「完成」栏。\n`);
