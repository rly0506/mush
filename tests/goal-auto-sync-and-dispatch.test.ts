import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  parseGoalMarkdownDocument,
  syncGoalsDirectoryToTasks,
  loadTasks,
} from '../src/web/tasks.ts';

describe('Goal Markdown Document Auto-Discovery & Task Pool Sync (D67)', () => {
  test('1. parseGoalMarkdownDocument extracts title, metadata and summary accurately', () => {
    const mdContent = `# GOAL-056: 自动化测试用例智能生成器 (Smart Test Generator)

- 状态：\`READY\`
- 来源：owner 深度规划
- 优先级：高
- 依赖：GOAL-055, GOAL-044

---

## 1. 目标与价值

为解决多 Agent 协作时自动化测试编写效率低下的瓶颈，构建智能用例生成器。

本模块支持根据代码变更 Diff 与架构契约，全自动生成破坏性用例与边界断言。

---

## 2. 核心架构设计

### 2.1 生成器模块
- \`src/orchestration/test-gen.ts\` [NEW]
`;

    const parsed = parseGoalMarkdownDocument(mdContent, 'GOAL-056-smart-test-gen.md');
    assert.ok(parsed);
    assert.strictEqual(parsed.goal_id, 'GOAL-056');
    assert.strictEqual(parsed.title, '自动化测试用例智能生成器 (Smart Test Generator)');
    assert.strictEqual(parsed.status, 'READY');
    assert.strictEqual(parsed.priority, '高');
    assert.strictEqual(parsed.source, 'owner 深度规划');
    assert.ok(parsed.detail.includes('为解决多 Agent 协作时自动化测试编写效率低下的瓶颈'));
    assert.ok(parsed.detail.includes('依赖: GOAL-055, GOAL-044'));
  });

  test('2. syncGoalsDirectoryToTasks automatically creates task cards when new Goal docs are added', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'mush-goal-sync-test-'));
    const tasksPath = path.join(root, 'runtime', 'tasks.jsonl');
    const goalsDir = path.join(root, 'goals');
    const receiptsDir = path.join(root, 'goals', 'receipts');

    mkdirSync(path.dirname(tasksPath), { recursive: true });
    mkdirSync(goalsDir, { recursive: true });
    mkdirSync(receiptsDir, { recursive: true });

    // 1. 在 goals/ 目录添加一个新 Goal 文档
    const docPath = path.join(goalsDir, 'GOAL-057-distributed-scheduler.md');
    writeFileSync(
      docPath,
      `# GOAL-057: 分布式弹性任务调度器 (Distributed Scheduler)

- 状态：\`READY\`
- 来源：架构升级
- 优先级：高
- 依赖：GOAL-006

---

## 1. 目标与价值

实现跨多机集群的弹性调度中枢，支持海量任务并发分发与容灾重试。
`,
      'utf8',
    );

    const now = () => new Date('2026-08-20T12:00:00Z');

    // 2. 自动同步
    const tasks = syncGoalsDirectoryToTasks(tasksPath, goalsDir, receiptsDir, now);
    assert.strictEqual(tasks.length, 1);
    assert.strictEqual(tasks[0].goal_id, 'GOAL-057');
    assert.strictEqual(tasks[0].title, 'GOAL-057: 分布式弹性任务调度器 (Distributed Scheduler)');
    assert.strictEqual(tasks[0].status, 'READY');
    assert.strictEqual(tasks[0].priority, '高');
    assert.ok(tasks[0].detail.includes('实现跨多机集群的弹性调度中枢'));

    // 3. 验证再次调用是幂等的，不产生重复卡片
    const tasks2 = syncGoalsDirectoryToTasks(tasksPath, goalsDir, receiptsDir, now);
    assert.strictEqual(tasks2.length, 1);

    // 4. 模拟该 Goal 产生完成验收回执
    writeFileSync(
      path.join(receiptsDir, 'GOAL-057-completion.json'),
      JSON.stringify({ goal_id: 'GOAL-057', status: 'PASS' }),
      'utf8',
    );

    const tasks3 = syncGoalsDirectoryToTasks(tasksPath, goalsDir, receiptsDir, now);
    assert.strictEqual(tasks3.length, 1);
    assert.strictEqual(tasks3[0].status, 'DONE');
  });
});
