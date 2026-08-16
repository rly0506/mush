/**
 * M1 fixture-reference（非生产实现）：
 * Windows 参数引用算法移植（golden runner 源码逐字语义）；M2 由生产实现替换。
 *
 * PS 源（只读）：
 *   D:\意向项目\.agent-bridge\tools\start-goal-orchestrator.ps1 L475-L509
 *   D:\意向项目\.agent-bridge\tools\tests\bridge-process-job.tests.ps1 L111-L159
 *   D:\意向项目\.agent-bridge\tools\tests\bridge-pi-adapter.tests.ps1 L183-L213
 */

const NEEDS_QUOTING_RE = /[\s"&|<>^;()$]/;

/** 逐字移植 PS ConvertTo-WindowsArgument L478-L508。 */
export function quoteWindowsArgument(value: string): string {
  if (value.length === 0) return '""';
  if (!NEEDS_QUOTING_RE.test(value)) return value;
  let builder = '"';
  let backslashes = 0;
  for (const character of value) {
    if (character === '\\') {
      backslashes += 1;
    } else if (character === '"') {
      builder += '\\'.repeat(backslashes * 2 + 1) + '"';
      backslashes = 0;
    } else {
      if (backslashes > 0) {
        builder += '\\'.repeat(backslashes);
        backslashes = 0;
      }
      builder += character;
    }
  }
  if (backslashes > 0) builder += '\\'.repeat(backslashes * 2);
  builder += '"';
  return builder;
}
