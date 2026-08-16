# tests/support — M1 兼容垫片（canonical 已迁至 src/）

GOAL-002 U5 收口后，本目录不再持有实现：原 M1 fixture 语义参考件已迁至
`src/core/`（生产实现或 M2 核心模块），测试文件直接 import `../src/core/*.ts` /
`../src/schema/*.ts`。

本目录保留的 `*.ts` 仅为 `export * from '../../src/...'` 兼容垫片（避免旧引用
断链），新代码不要再从这里 import。

时间单位/意图移植说明与 PS 源追溯注释随代码一并迁至 `src/core/` 各文件头部。
