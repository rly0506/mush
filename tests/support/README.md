# tests/support — M1 fixture-reference 参考件（非生产实现）

本目录是 **M1 fixture 翻译** 的可执行载体：把 agent-bridge（黄金参照，
`D:\意向项目\.agent-bridge`，只读）fixture 所断言的行为语义翻译成最小 Node/TS
参考件，使翻译后的 `node:test` 断言真实可跑、可红可绿。

- 每个文件头部注明黄金参照 PS 源与行号；
- 这些参考件 **不是** mush 的生产实现；RM-001 M1 明确“此阶段不写实现”；
- M2 时，测试的 import 将从本目录切换到生产 `src/` 模块，断言本身保持不变。

时间单位注：PS 版超时参数以秒计；session 参考件接受毫秒（测试用 60ms/200ms
跑同一超时状态机），断言语义（fail-closed reason / 无签名事件 / 杀子进程）不弱化。
