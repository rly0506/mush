/**
 * GOAL-081：键控增量渲染助手（渲染竞态根治地基）。
 *
 * 背景缺陷：SSE 快照驱动的高频列表（派发/泳道卡/审批/活动流）此前整段
 * innerHTML 重建——渲染瞬间旧节点被销毁，恰逢其时的点击直接丢失
 * （G076/G078 两度亲历），且 per-render 绑定监听随节点一同蒸发。
 *
 * 本模块提供两件零框架地基件：
 *  1. keyedListHtml：由 {key, html} 项构造「包裹段」HTML——每项包一层
 *     <div data-key="…">，该包裹段是补丁算法的稳定挂载点；
 *  2. planPatch：键控 diff 的计划层（纯数据）——按 key 分类 keep/add/remove，
 *     DOM 副本再按 innerHTML 是否变化细分 kept/updated（未变节点引用不动，
 *     点击不被吞；变化节点就地换 innerHTML，其上监听有意作废待重绑）。
 *
 * 事件侧配合 document 级委托（见 page.ts g081DelegateClicks）：列表重建
 * 不再依赖节点存活，委托永久生效。
 *
 * 运行形态：keyedListHtml/planPatch 为 Node 侧纯函数；真正动 DOM 的
 * patchList 由 src/web/page.ts 以「逻辑同构副本」注入浏览器内联 <script>
 * （内联脚本无法 import，tsconfig 亦无 DOM lib）——两侧改动须同步，
 * 机检 tests/g081-silk.test.ts 用最小 DOM 桩实测 page.ts 内嵌副本。
 */

export interface KeyedItem {
  key: string;
  html: string;
}

/** 属性级转义（与 page.ts esc 同规则）。 */
export function patchEsc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 构造键控包裹段 HTML。每项 `<div data-key="key">html</div>`。
 * 包裹层透明（无样式），仅作补丁定位锚。
 */
export function keyedListHtml(items: KeyedItem[]): string {
  return items
    .map((item) => `<div data-key="${patchEsc(item.key)}">${item.html}</div>`)
    .join('');
}

export interface PatchStats {
  added: number;
  updated: number;
  removed: number;
  kept: number;
}

/**
 * 键控增量补丁（结构化同构说明）。DOM 实现由 page.ts 内嵌副本承担——
 * 浏览器内联脚本无法 import 本模块，tsconfig 也不含 DOM lib。
 * 此处以「补丁计划」纯数据形态表达同一份语义：给定现有 key 序与目标项，
 * 算出 keep/update/add/remove 分类，供 Node 侧测试与文档对照。
 */
export function planPatch(existingKeys: string[], items: KeyedItem[]): PatchStats {
  const stats: PatchStats = { added: 0, updated: 0, removed: 0, kept: 0 };
  const remaining = new Set(existingKeys);
  for (const item of items) {
    if (remaining.has(item.key)) {
      stats.kept += 1; // DOM 副本中再按 innerHTML 是否变化细分 kept/updated
      remaining.delete(item.key);
    } else {
      stats.added += 1;
    }
  }
  stats.removed = remaining.size;
  return stats;
}
