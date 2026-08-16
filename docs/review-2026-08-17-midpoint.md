# mush 中期复盘 · 2026-08-17（RM-002 收官前）

性质：owner 发起的战略复盘（四问：真的完成了吗 / 可改进什么 / 向谁学习 /
潜藏漏洞）。头犬审计意见，append-only。行动项编号接续 finding 池。

## 一、"真的完成了吗"——分四层诚实回答

| 层 | 状态 | 依据 |
| --- | --- | --- |
| RM-001（自举） | ✅ DONE | owner 转正 2026-08-17 |
| RM-002（活用化） | ~80% | owner 实操全流程 ✅（AD-20）；缺：意向项目收官、codex/opencode nonce 补跑 |
| "能日常用" | 还差三块 | 见下 a/b/c |
| "值得信赖的基础设施" | 还差两块 | 见下 d/e |

a. **持久化缺口（最大）**：派发记录（records Map）、事件链视图（内存
   EventLog）、workspace 选择都是**进程内存态**——看板重启即失忆。台账
   JSONL 虽落盘但**无哈希锚点**（宪法 §2 要求审计链可重建）。犬的会话也
   无续跑（dsh `--resume`/claude `--continue` 未接管线），长任务=每批新会话。
b. **kimi 犬未入册**："六犬在册"实为 5+fake：roster 无 kimi-code 适配器
   （G008 只做了 codex/opencode）。kimi 执行了 GOAL-005/007B 却不能被看板
   派活——自家功臣不在编。
c. **审核深度浅**：REVIEW=exit+stderr 机检；无 diff 级代码审核；触发门
   审批有了，但"头犬读犬的产出"仍是我在 mush 仓的人工动作。
d. **预算门是申报制**：amount_usd 由调用方自报，实测成本仅 claude 通道
   （stream cost）可得——低报可绕过 cap；dsh 无成本回传。治理语义漏洞。
e. **flaky 三连**：超时竞态已三次出现（F-29 族），从观察升级为必修。

## 二、值得学习的对象

- **agent-bridge（黄金参照，仍在侧）**：已继承合同/状态机/证据纪律；还值得
  再搬的：① **quarantine 隔离区**（可疑产物先隔离再人工裁决——mush 没有，
  恶意/坏犬输出直接进 workspace）；② dispatch-gates 的**进程级就绪门**
  （ready 文件 + PID，我们只做了语义模型）；③ epoch 租约的**真实文件锁**
  （防双开编排器——mush 双 board 实例现在会竞态）。
- **todos.dev**：头犬不掌握其确切产品形态（诚实记录，请 owner 点出你看中
  的具体特性）。按任务管理类成熟产品的通用强项，可对标的有：任务**依赖
  DAG**（mush 的 goal/批次是纯线性队列，G006/G008 靠人工约定"文件面不相交"）、
  **模板化 recurring 任务**、**进度百分比/燃尽**视图。
- **业界相邻**：Claude Code 的 **hooks/permissions 粒度**（pre-tool 审批——
  对应我们的犬内工具白名单，现在只有 harness 各自的 --allowed-tools）；
  MCP 生态做**通用工具面**（D5 已留观察位）。

## 三、潜藏漏洞（按严重度）

1. **DEF-04（高，已证实）DNS rebinding + 无鉴权看板**：server 从不校验
   Host 头（仅 127.0.0.1 绑定不是防线——恶意网页可将自身域名 rebind 到
   127.0.0.1，同源策略即对它放行）。后果：攻击者页面可 POST real dispatch
   （花真钱、以任意本地目录为 cwd 驱动犬写文件）、读 snapshot（含
   stdout_tail=犬读过的文件内容）、应答审批。**修复：Host 头白名单校验
   （127.0.0.1/localhost:port）+ 拒绝其他，成本一行级；可选 token。**
2. **F-41（中）workspace 任意写面**：dispatch 的 workspace 只验存在不验
   归属——配合 DEF-04 即"远程驱动本机任意目录执行 agent"；即使无 DEF-04，
   本机误操作也能把犬放进 `D:\意向项目`（黄金参照有 .git 但犬不读宪法）。
   建议：workspace 白名单制（known-workspaces 显式登记 + 意向项目永久
   deny 直到收官授权）。
3. **F-42（中）并发/重启竞态**：双 board 或 board+CLI 并发 → workspace.json
   互相覆盖、ledger 交错、内存 records 分裂。建议：单实例锁文件（学黄金
   参照 orchestrator.lock）。
4. **F-43（低）stdout_tail 泄露面**：犬输出（可能含读到的本地文件内容）
   展示于无鉴权页面——修 DEF-04 后缓解。
5. **F-44（低）供应链**：零依赖已收缩主面；但 dsh/kimi/claude 等 CLI 的
   npm-global 更新无 pin 策略（版本漂移=行为漂移，GOAL-005 的 stream-json
   --verbose 教训即是）。建议：capability registry 记录版本并告警漂移。

## 四、owner 新报缺陷

- **F-40（已证实）看板无法自主指定工作区**：workspace 控件只有下拉（数据
  = known-workspaces + cwd），无自由输入/新建入口；后端 `POST select` 本就
  接受任意存在路径——纯前端缺口。修复：路径输入框 + "登记"按钮（select 即
  入 known 列表）；"新建工作区"= 输入不存在的路径时明确确认对话框后 mkdir
  （写盘动作需 owner 点击确认，不静默）。与 F-39（路径归一）同批。

## 行动项汇总（建议排期，待 owner 点头）

| 批次 | 内容 | 执行犬 |
| --- | --- | --- |
| P1 安全批 | DEF-04 Host 校验 + F-41 workspace 白名单 | deepseek（小，紧急） |
| P2 前端批 | F-40 自由输入/新建 + F-39 路径归一 | kimi |
| P3 持久化批 | 事件链/记录落盘 + 台账哈希锚点 + 单实例锁（F-42） | deepseek |
| P4 补编批 | kimi adapter 入册 + flaky 修复 + 会话续跑接入 | deepseek/kimi |
| P5 对标批 | 任务 DAG/隔离区（等 todos.dev 特性确认后细化） | 待议 |

RM-002 收官（意向项目任务）建议在 P1/P2 之后执行——先堵 DNS rebinding
再对外多用。
