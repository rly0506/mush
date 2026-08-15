/**
 * M1 fixture-reference 兼容出口：U3 回放测试从这里 import；U4 起真正的类型与
 * 解析守卫已升格为生产 src/schema（M2 骨架），此处仅 re-export，测试直接落在
 * 生产类型上。
 */
export { parseBridgeEventV2 } from '../../src/schema/events.ts';
export type { BridgeEventV2, EvidencePathAndHash } from '../../src/schema/events.ts';
