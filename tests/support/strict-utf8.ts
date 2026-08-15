/**
 * M1 fixture-reference（非生产实现）：
 * dispatch packet 必须作为严格 UTF-8 文本读取（PS 版 UTF8Encoding(false,true) 在
 * 非法字节上抛错）；Node 用 TextDecoder fatal:true 得到同等严格语义。
 *
 * PS 源（只读）：
 *   D:\意向项目\.agent-bridge\tools\invoke-managed-pi-agent.ps1 L188-L190
 */

import { readFileSync } from 'node:fs';

export function readStrictUtf8(filePath: string): string {
  let bytes: Buffer;
  try {
    bytes = readFileSync(filePath);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error('dispatch-packet-read-error: failed to read dispatch packet bytes: ' + detail);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('dispatch-packet-read-error: dispatch packet is not strict UTF-8.');
  }
}
