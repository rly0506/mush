/**
 * M1 fixture-reference（非生产实现）：
 * 把黄金参照 invoke-managed-pi-agent.ps1 的线级 JSONL framing 语义翻译为
 * Node/TS 可执行参考件，仅服务于 M1 fixture 翻译测试；M2 由生产实现替换。
 *
 * PS 源（只读）：
 *   D:\意向项目\.agent-bridge\tools\tests\bridge-pi-rpc.tests.ps1
 *     Assert-WireFraming L290-L307
 *   D:\意向项目\.agent-bridge\tools\invoke-managed-pi-agent.ps1
 *     ConvertFrom-ManagedPiFencedCompletionText L95-L106
 */

/** BOM-free、LF-only 的 JSONL 命令行编码（PS wrapper L282-L286 语义）。 */
export function encodeJsonlCommand(command: Record<string, unknown>): string {
  return JSON.stringify(command) + '\n';
}

/**
 * GOAL010-T8-PI-RPC-002 线级 framing 断言（移植 PS L296-L307，强度不降低）：
 * - 原始首个字节必须为 0x7B（无 BOM）
 * - 不得出现 CR (0x0D)，只允许 LF 分隔
 * - 至少 get_state + prompt 两条非空行
 * - 每一行都必须是合法 JSON
 */
export function assertWireFraming(bytes: Uint8Array): void {
  if (bytes.length < 2) {
    throw new Error('Wire framing violated: expected at least get_state + prompt JSONL lines.');
  }
  if (bytes[0] !== 0x7b) {
    throw new Error(
      `Wire framing violated: first command byte must be 0x7B ('{'), got 0x${bytes[0].toString(16).toUpperCase().padStart(2, '0')}.`,
    );
  }
  if (bytes.includes(0x0d)) {
    throw new Error('Wire framing violated: CR (0x0D) found; commands must be LF-only JSONL.');
  }
  const text = new TextDecoder('utf-8').decode(bytes);
  const lines = text.split('\n').filter((line) => line.trim() !== '');
  if (lines.length < 2) {
    throw new Error('Wire framing violated: expected at least get_state + prompt JSONL lines.');
  }
  for (const line of lines) {
    try {
      JSON.parse(line);
    } catch {
      throw new Error('Wire framing violated: a command line is not valid JSON.');
    }
  }
}

const COMPLETE_OUTER_FENCE_RE = /^[ \t]*```json[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*(?:\r?\n)*$/;

/**
 * GOAL010-T8-PI-FENCED-JSON-COMPLETION-001：
 * 只剥掉完整的 ```json/``` 外层围栏；任何其他内容原样交给严格解析器。
 * 不做宽泛 Markdown 接受（移植 wrapper L103-L105 的窄正则）。
 */
export function stripOuterJsonFence(text: string): string {
  const match = COMPLETE_OUTER_FENCE_RE.exec(text);
  return match ? (match[1] ?? text) : text;
}
