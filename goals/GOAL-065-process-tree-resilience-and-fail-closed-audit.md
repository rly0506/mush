# GOAL-065: 进程生命周期韧性、树杀与 Fail-Closed 纠偏 (Process Tree Resilience & Fail-Closed)

- 状态：`DONE`
- 来源：商业化安全审计 (P0) / owner 决策 D79
- 优先级：高
- 依赖：GOAL-064

---

## 1. 目标与价值

根治子进程调用与生命周期中的崩溃炸弹与判决缺陷：
1. **全局 EPIPE 崩溃防护**：为所有子进程 stdin 增加 error 事件监听与 writable 状态判断，彻底防止子进程秒退导致宿主 Node 进程崩溃；
2. **Windows 进程树终止 (Tree Kill)**：超时或主动终止时，通过 `taskkill /PID <pid> /T /F` 收割全部孙进程，杜绝孤儿进程占用端口与文件句柄；
3. **Fail-Closed 验收纠偏**：修复 `pi-rpc-runner` 在子进程退出码为 0 但未完成 Completion 时的错误放行缺陷，严格标记失败；
4. **审批令牌原子消费**：审批令牌消费采用原子 `renameSync` 机制，根除并发双花 (TOCTOU) 漏洞。

---

## 2. 核心架构设计

### 2.1 模块与文件变更清单
- `src/adapters/t1-runner.ts` [MODIFY] — 补齐 `child.stdin.on('error')`，超时调用进程树杀
- `src/adapters/pi-rpc-runner.ts` [MODIFY] — 补齐 EPIPE 保护；修复 exit 0 未完成 completion 的 Fail-Closed 判定
- `src/adapters/claude.ts` [MODIFY] — 补齐 EPIPE 与进程树清理
- `src/web/dispatch.ts` [MODIFY] — 审批令牌文件改用原子 rename 消费

---

## 3. 验收规格

- [ ] 新建自动化测试 `tests/g065-process-resilience.test.ts`
- [ ] 验证子进程秒退并写入 stdin 时服务不崩溃、优雅报错
- [ ] 验证超时终止后 Windows 孙进程被彻底清理
- [ ] 验证 pi 提前退出退出码 0 被正确判定为 FAIL (agent-exited-before-settled)
- [ ] 验证并发 rerun 相同审批令牌时仅有一单能成功派发（单次消费有效）
- [ ] 全量 534+ 测试套件保持 100% 绿灯
