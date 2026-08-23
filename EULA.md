# mush 最终用户许可协议与免责声明 (EULA & Liability Disclaimer)

**版本**: `v0.1.1-pilot`  
**生效日期**: 2026-08-21  

欢迎使用 **mush**（跨 Harness 原生多 Agent 协同工作台）。在安装、运行或使用 mush 之前，请仔细阅读本最终用户许可协议（以下简称“协议”）。

---

## 1. 软件定位与核心原则 (Software Scope & Core Principles)

1. **本地授权软件 (Local-Licensed Desktop Software)**：
   mush 是一款纯本地运行的软件。除用户配置的各模型厂商原生 API/CLI 与显式指定的 Git 私有远端同步外，mush 不向任何第三方服务器收集、上传或分析您的代码、提示词、会话记录或凭据。
2. **BYOK 模式 (Bring Your Own Key)**：
   用户自行提供并管理各大模型厂商（Anthropic, OpenAI, DeepSeek, Google, 智谱等）的 API Key 与 CLI 凭据。使用各厂商模型所产生的 Token 费用由用户直接向各厂商结算。

---

## 2. AI 自主执行与本地文件操作免责声明 (AI Autonomous Execution & File Operations Disclaimer)

1. **AI 生成代码与执行风险**：
   mush 编排各厂商 CLI（如 Claude Code, dsh, agy 等）在用户本地执行命令与读写文件。AI 模型可能产生幻觉、错误指令或意外的代码修改。
2. **工作区白名单与沙箱**：
   mush 提供了严格的工作区白名单与审批闸门机制。用户应当且必须合理配置工作区范围，并在关键破坏性操作时行使审批否决权。
3. **责任限制 (Limitation of Liability)**：
   在法律允许的最大范围内，mush 开发者与贡献者不对因使用本软件导致的任何直接、间接、附带或后果性损失（包括但不限于数据丢失、系统崩溃、代码损坏、业务中断或 API 账单超额）承担法律责任。建议用户在使用 mush 时对重要代码库保持版本控制（Git）与定期备份。

---

## 3. 预算与资费免责 (Budget & Billing Disclaimer)

mush 提供了本地权威预算 Cap 与 Telemetry 记账功能以协助用户监控成本，但该功能依赖本地估算与各 CLI 返回的 Token 元数据，不能作为与厂商对账的法定凭证。用户有义务定期检查各厂商控制台的实际账单与用量。

---

## 4. 商业使用与知识产权 (Commercial Use & IP)

1. 用户使用 mush 生成的所有代码、文档与制品，其全部知识产权归属于用户。
2. mush 开源核心部分遵循 Apache-2.0 许可证；商业授权版受对应商业许可凭证约束。

---

*如您对本协议有任何疑问，请参阅 `CONSTITUTION.md` 治理宪法。*
