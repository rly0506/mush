import assert from 'node:assert/strict';
import type { ChatService } from '../../src/web/chat.ts';
import type { DispatchPipeline } from '../../src/web/dispatch.ts';

/**
 * D83（2026-09-06，owner 决议）：聊天回复豁免 D30 逐单审批——originOwner 语义
 * （owner 敲字即批准），聊天派发受理即执行。本助手仅等待回合 settle 并返回
 * 终态记录；不再断言 BLOCKED_WAITING_OWNER、不再铸审批令牌、不再重跑。
 */
export async function awaitChatReply(pipeline: DispatchPipeline, chat: ChatService, dispatchId: string) {
  await chat.whenSettled();
  const record = pipeline.get(dispatchId);
  assert.ok(record, `chat dispatch ${dispatchId} must exist`);
  assert.notEqual(record?.status, 'BLOCKED_WAITING_OWNER', 'D83：聊天回合不得等待 owner 审批');
  return record;
}
