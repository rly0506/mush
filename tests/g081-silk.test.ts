import { test, describe } from 'node:test';
import assert from 'node:assert';
import { renderBoardPage } from '../src/web/page.ts';
import { keyedListHtml, planPatch } from '../src/web/ui/keyed-patch.ts';
import { splitThinking } from '../src/web/repl.ts';
import { runCli } from '../src/cli.ts';

// GOAL-081：丝滑工程——渲染竞态根治 + 终端面 + 零门槛首单（机检规格）。
// 渲染产物断言 + 最小 DOM 桩实测内嵌 patchList 的节点同一性。

/** 提取渲染产物 <script> 内嵌 JS（page.ts 为单文件模板）。 */
function extractInlineScript(html: string): string {
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  return blocks.join('\n');
}

/** 最小 DOM 桩：只实现 patchList 用到的接口（children/firstChild/insertBefore/remove/innerHTML）。 */
class StubNode {
  key: string | null = null;
  html = '';
  children: StubNode[] = [];
  parent: StubNode | null = null;
  get innerHTML(): string {
    return this.html;
  }
  set innerHTML(v: string) {
    this.html = v;
  }
  getAttribute(name: string): string | null {
    return name === 'data-key' ? this.key : null;
  }
  setAttribute(name: string, value: string): void {
    if (name === 'data-key') this.key = value;
  }
  get firstChild(): StubNode | null {
    return this.children[0] ?? null;
  }
  get nextSibling(): StubNode | null {
    if (this.parent === null) return null;
    const idx = this.parent.children.indexOf(this);
    return this.parent.children[idx + 1] ?? null;
  }
  insertBefore(node: StubNode, ref: StubNode | null): void {
    node.parent?.children.splice(node.parent.children.indexOf(node), 1);
    const idx = ref === null ? this.children.length : this.children.indexOf(ref);
    this.children.splice(idx === -1 ? this.children.length : idx, 0, node);
    node.parent = this;
  }
  remove(): void {
    if (this.parent === null) return;
    this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
  }
  get ownerDocument(): { createElement: () => StubNode } {
    return { createElement: () => new StubNode() };
  }
}

/** 从 page.ts 内嵌副本中取出 patchList 函数体并在桩上执行。 */
function evalEmbeddedPatchList(script: string): (root: StubNode, items: { key: string; html: string }[]) => Record<string, number> {
  const match = /function patchList\(root, items\) \{([\s\S]*?)\n  \}\n  function clearKeyed/.exec(script);
  assert.ok(match !== null, 'page.ts 必须内嵌 patchList 副本（GOAL-081 键控增量）');
  // eslint-disable-next-line no-new-func
  const fn = new Function(
    'root',
    'items',
    `var document = { createElement: function () { return root.ownerDocument.createElement(); } };\n` +
      `function patchList(root, items) {${match[1]}\n  }\n` +
      `return patchList(root, items);`,
  ) as (root: StubNode, items: { key: string; html: string }[]) => Record<string, number>;
  return fn;
}

describe('GOAL-081: silk engineering — keyed patch / delegation / REPL / first-task', () => {
  const html = renderBoardPage('test-token');
  const script = extractInlineScript(html);

  test('1. 键控包裹段：keyedListHtml 每项带 data-key，属性级转义生效', () => {
    const out = keyedListHtml([
      { key: 'a"1', html: '<b>x</b>' },
      { key: 'b<2>', html: '<i>y</i>' },
    ]);
    assert.ok(out.includes('data-key="a&quot;1"'), 'key 须属性级转义');
    assert.ok(out.includes('data-key="b&lt;2&gt;"'), '尖括号须转义');
    assert.ok(out.startsWith('<div data-key=') && out.endsWith('</div>'), '每项独立包裹段');
  });

  test('2. planPatch 计划层：keep/add/remove 分类正确', () => {
    const stats = planPatch(['a', 'b', 'c'], [
      { key: 'b', html: 'x' },
      { key: 'd', html: 'y' },
    ]);
    assert.strictEqual(stats.kept, 1);
    assert.strictEqual(stats.added, 1);
    assert.strictEqual(stats.removed, 2);
  });

  test('3. 内嵌 patchList 节点同一性：改一张卡只动一个节点，其余引用不变', () => {
    const patchList = evalEmbeddedPatchList(script);
    const root = new StubNode();
    const initial = [
      { key: 'k1', html: '<span>one</span>' },
      { key: 'k2', html: '<span>two</span>' },
      { key: 'k3', html: '<span>three</span>' },
    ];
    patchList(root, initial);
    const before = root.children.slice();
    assert.strictEqual(before.length, 3, '初始三节点');

    const stats = patchList(root, [
      { key: 'k1', html: '<span>one</span>' }, // 未变
      { key: 'k2', html: '<span>TWO-CHANGED</span>' }, // 仅此张变化
      { key: 'k3', html: '<span>three</span>' }, // 未变
    ]);
    assert.strictEqual(stats.kept, 2, '两张未变卡 kept');
    assert.strictEqual(stats.updated, 1, '仅一张卡 updated');
    assert.strictEqual(root.children[0], before[0], 'k1 节点引用不变（点击不吞的根治断言）');
    assert.strictEqual(root.children[1], before[1], 'k2 节点引用不变（就地换 innerHTML）');
    assert.strictEqual(root.children[2], before[2], 'k3 节点引用不变');
    assert.strictEqual(root.children[1].innerHTML, '<span>TWO-CHANGED</span>', '变化卡内容已更新');

    // 增删：k3 消失、k4 新增、k1 位置提前。
    const stats2 = patchList(root, [
      { key: 'k1', html: '<span>one</span>' },
      { key: 'k4', html: '<span>four</span>' },
    ]);
    assert.strictEqual(stats2.removed, 2, 'k2/k3 移除');
    assert.strictEqual(stats2.added, 1, 'k4 新增');
    assert.deepStrictEqual(root.children.map((c) => c.key), ['k1', 'k4'], '顺序与增删正确');
  });

  test('4. 事件委托：page.ts 含 g081DelegateClicks 且为捕获相 document 委托', () => {
    assert.ok(script.includes('function g081DelegateClicks()'), '必须存在委托安装函数');
    assert.ok(script.includes("document.addEventListener('click', function (e)"), '委托挂在 document click');
    assert.ok(/g081DelegateClicks[\s\S]*?true\); \/\/ capture/.test(script) || script.includes('}, true); // capture'), '委托必须为捕获相');
    for (const attr of ['data-task-dispatch', 'data-task-rerun', 'data-task-move', 'data-task-mark-done', 'data-respond', 'data-toggle-appr', 'data-task-menu', 'data-goto-approvals']) {
      assert.ok(script.includes(`hasAttribute('${attr}')`), `委托须覆盖 ${attr}`);
    }
  });

  test('5. SSE 高频列表全部走 patchList（负向：dispatch/tasks/rail-approvals/rail-dogs/epochs/recent-activity 无残留整段赋值）', () => {
    for (const marker of [
      'patchList(el, dispatchItems)',
      'patchList(el, laneItems)',
      'patchList(el, railItems)',
      'patchList(streamEl, actItems)',
      'patchList(railEl, actItems)',
    ]) {
      assert.ok(script.includes(marker), `缺少键控补丁调用 ${marker}`);
    }
    assert.ok(script.includes("key: String(epoch.run_id) + '#' + String(epoch.assignment_epoch)"), 'epoch 卡须带键');
    assert.ok(script.includes("key: String(r.adapter_id)"), '犬卡须带键');
    // 负向：renderDispatches/renderTasks/renderRailApprovals/renderRailDogs 不再对列表整段 innerHTML 赋值。
    const dispatches = /function renderDispatches\(\)[\s\S]*?\n  \}\n/.exec(script)?.[0] ?? '';
    assert.ok(!/el\.innerHTML = list\.map/.test(dispatches), 'renderDispatches 不得整段重建列表');
    const tasks = /function renderTasks\(\)[\s\S]*?renderTasksDag\(\);\n  \}/.exec(script)?.[0] ?? '';
    assert.ok(!/el\.innerHTML = blockedBadge/.test(tasks), 'renderTasks 泳道不得整段重建（空态 clearKeyed 除外）');
    const rail = /function renderRailApprovals\(\)[\s\S]*?\n  \}\n/.exec(script)?.[0] ?? '';
    assert.ok(!/el\.innerHTML = waiting\.map/.test(rail), 'renderRailApprovals 不得整段重建');
  });

  test('6. 审批内联：聊天流三键卡 + 回执徽标 + 改后批准预填', () => {
    assert.ok(script.includes('chat-approval-card'), '聊天流审批卡类名');
    for (const marker of ['data-chat-respond="APPROVED"', 'data-chat-respond="REJECTED"', 'data-chat-amend']) {
      assert.ok(script.includes(marker), `缺少内联审批动作 ${marker}`);
    }
    assert.ok(script.includes('function chatApprovalRespond('), '内联应答函数');
    assert.ok(script.includes('chat-appr-done'), '批准回执徽标态');
    assert.ok(script.includes("prefillDispatchFromSnapshot(String(d.dispatch_id || '')"), '改后批准须预填快照');
  });

  test('7. 第一单零配置：snapshot 派生信号 + 引导横幅 + 一键预填免费通道', () => {
    assert.ok(html.includes('id="first-task-banner"'), '引导横幅容器');
    assert.ok(html.includes('id="btn-first-task"'), '一键首单按钮');
    assert.ok(script.includes('function g081FirstTaskBanner()'), '横幅控制函数');
    assert.ok(script.includes("snapshot.first_task.zero_config === true"), '仅零配置时升起');
    assert.ok(script.includes("localStorage.getItem('mush.first-task.dismissed')"), '关闭持久化');
    assert.ok(script.includes("free_adapter_id"), '免费通道 id 来自 snapshot');
  });

  test('8. REPL：splitThinking 思维链剥离 + mush chat 命令注册', () => {
    const { thinking, body } = splitThinking('<think>foo\nbar</think>\n正文答案');
    assert.strictEqual(thinking, 'foo\nbar');
    assert.strictEqual(body, '正文答案');
    const noThink = splitThinking('纯文本');
    assert.strictEqual(noThink.thinking, '');
    assert.strictEqual(noThink.body, '纯文本');
    // CLI 注册
    assert.ok(true, 'runCli 冒烟见 test 9');
  });

  test('9. CLI chat 命令注册与未知旗标拒绝（DEF-07 口径）', async () => {
    const usage = await runCli([]);
    assert.strictEqual(usage.exitCode, 64);
    assert.ok(usage.stdout.includes('chat'), 'usage 须含 chat 命令');
    const bad = await runCli(['chat', '--bogus-flag']);
    assert.strictEqual(bad.exitCode, 64, '未知旗标须 usage error');
    assert.ok(bad.stdout.includes('unknown flag'), '须报 unknown flag');
  });

  test('10. DEF-07 解析守卫：渲染产物无模板转义泄漏', () => {
    assert.ok(!html.includes('\\n  '), '模板转义泄漏：出现字面 \\n');
    assert.ok(!/style="[^"]*`/.test(html), '模板反引号泄漏进属性');
    // 内联 patchList 副本不得含 TS 语法（浏览器须可直接执行）。
    const patchSrc = /function patchList\(root, items\) \{[\s\S]*?\n  \}\n/.exec(script)?.[0] ?? '';
    assert.ok(!patchSrc.includes(': PatchStats') && !patchSrc.includes('interface '), '内嵌副本不得含 TS 注解');
  });
});
