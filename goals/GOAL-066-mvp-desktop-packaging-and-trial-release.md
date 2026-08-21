# GOAL-066: MVP 桌面封装、许可协议与试运行发版 (MVP Desktop Packaging & Pilot Release)

- 状态：`DONE`
- 来源：商业化战略规划 / owner 决策 D79
- 优先级：高
- 依赖：GOAL-065

---

## 1. 目标与价值

完成面向个人开发者的小版本 MVP 试运行包装与交付闭环：
1. **合规许可证与责任限制**：添加 Apache-2.0 开源核心协议与商用 EULA 责任限制免责条款；
2. **Git 审计历史脱敏**：清理 `goals/receipts` 中的敏感历史记录；
3. **桌面端一键启动与运行时内嵌**：提供便携式单文件启动器或 Tauri 2.0 极简桌面外壳；
4. **试运行版本号与发布准备**：升级 `package.json` 至 `v0.1.0-pilot`，生成标准 Release 说明与新手快速上手指南。

---

## 2. 核心架构设计

### 2.1 模块与文件变更清单
- `LICENSE` [NEW] — Apache-2.0 协议文档
- `EULA.md` [NEW] — 最终用户许可协议与 AI 自主操作责任边界声明
- `package.json` [MODIFY] — 升级版本号至 `0.1.0-pilot`，补充发布元数据
- `scripts/build-desktop.ps1` [NEW] — 桌面端快速打包脚本

---

## 3. 验收规格

- [ ] 新建自动化测试 `tests/g066-release-packaging.test.ts`
- [ ] 验证 LICENSE 与 EULA 完整且无冲突
- [ ] 验证打包产物能一键启动并成功加载看板
- [ ] 全量 534+ 测试套件保持 100% 绿灯
