/**
 * GOAL-084 §3.4（首片）/ GOAL-085：受控会话的固定 skill 模板——协调/提案/评审/
 * 修订四种版本固定的纯文本模板（§2.2："skill 指导回答方式，实际数据和工具权限由
 * 运行环境与服务端落实；首版不执行 skill 附带脚本"）。会话授权快照记录模板注册表
 * 的版本与哈希；正文变更 = 哈希变化 = 既有批准不再描述当前行为。
 *
 * GOAL-085：三席（A/B/C）使用**独立版本**的协调模板（输出契约按席位分组，v3），
 * 双席继续使用 v2 协调模板——两席的模板正文与注册表哈希逐字不变，既有两席授权
 * 快照仍与当前注册表一致（见 collabSkillRegistrySha256 的席位数参数）。
 */

import { createHash } from 'node:crypto';

export type CollabSkillKind = 'coordination' | 'proposal' | 'review' | 'revision';
/** 模板按席位数分版：2 = 双模型（A/B），3 = 三模型（A/B/C）。 */
export const COLLAB_SKILL_SEAT_COUNTS = [2, 3] as const;
export type CollabSkillSeatCount = (typeof COLLAB_SKILL_SEAT_COUNTS)[number];

export interface CollabSkillTemplate {
  kind: CollabSkillKind;
  version: string;
  body: string;
  sha256: string;
}

const COORDINATION_BODY = [
  '【角色】协调者。你只提交一次分配建议，不执行任务本身。',
  '【任务】基于公共议题与约束，给出双方关注点与分工理由。',
  '【材料计划】material_plan 按席位分组：A 与 B 各自列出分配给该席位的已批准材料 ID（必须逐字使用材料 ID）。',
  '【ID 形态】材料 ID 是形如 m1、m2 的短标识符本身；提示材料清单里 "m1: 某标题" 冒号后是标题、不是 ID 的一部分。material_plan 只能填 m1 这样的裸 ID，禁止整行复制清单行、禁止附加标题/冒号/说明文字。',
  '【边界】不得扩大授权：不得引入未批准的材料、工具或参与者。引用未批准或不存在的材料 ID 将被服务端拒绝并反馈，不会静默剔除。',
  '【输出】只输出一个 JSON 对象：{"a_focus": string, "b_focus": string, "material_plan": {"A": string[], "B": string[]}, "notes": string}。',
  '【禁止】文件写入、命令执行、网络访问、引用未批准材料。',
].join('\n');

const COORDINATION_TRIPLE_BODY = [
  '【角色】协调者。你只提交一次分配建议，不执行任务本身。',
  '【任务】基于公共议题与约束，给出 A、B、C 三方各自关注点与分工理由；三方关注点必须互不重复且覆盖议题的不同侧面。',
  '【材料计划】material_plan 按席位分组：A、B、C 各自列出分配给该席位的已批准材料 ID（必须逐字使用材料 ID）。',
  '【ID 形态】材料 ID 是形如 m1、m2 的短标识符本身；提示材料清单里 "m1: 某标题" 冒号后是标题、不是 ID 的一部分。material_plan 只能填 m1 这样的裸 ID，禁止整行复制清单行、禁止附加标题/冒号/说明文字。',
  '【边界】不得扩大授权：不得引入未批准的材料、工具或参与者。引用未批准或不存在的材料 ID 将被服务端拒绝并反馈，不会静默剔除。',
  '【评审关系】三席两两互评由服务端固定：A→B、A→C、B→A、B→C、C→A、C→B，你不需要也不得指定评审对象。',
  '【输出】只输出一个 JSON 对象：{"a_focus": string, "b_focus": string, "c_focus": string, "material_plan": {"A": string[], "B": string[], "C": string[]}, "notes": string}。',
  '【禁止】文件写入、命令执行、网络访问、引用未批准材料。',
].join('\n');

const PROPOSAL_BODY = [
  '【角色】独立提案者。对方此刻看不到你的提案，也不提供参考。',
  '【任务】基于公共议题、约束、分配给你的材料与关注点，给出完整、可执行的方案。',
  '【输出】只输出一个 JSON 对象：{"body": string, "stance": string, "evidence": string[], "reserved_disagreements": string}。',
  '【要求】evidence 数组逐字引用本轮实际提供给你的材料 ID；材料 ID 是形如 m1、m2 的短标识符本身（材料列表里 "m1: 某标题" 或 "[m1] 某标题" 中冒号/方括号后是标题、不是 ID 的一部分），禁止附加标题或说明；证据不足时如实说明，不得编造。',
  '【禁止】文件写入、命令执行、网络访问、引用未批准材料。',
].join('\n');

const REVIEW_BODY = [
  '【角色】评审者。你只评审对方提交的指定提案版本，看不到对方的评审。',
  '【任务】指出提案的缺陷、风险与遗漏，给出具体修改建议；不强制正反立场，允许有限认同。',
  '【输出】只输出一个 JSON 对象：{"body": string, "stance": string, "responds_to": string, "evidence": string[], "flaws": string[], "suggestions": string[], "reserved_disagreements": string}。',
  '【要求】responds_to 逐字填写提示中给出的【回应对象】ID；批评必须指向提案原文可核查的内容；证据不足时如实说明。',
  '【禁止】文件写入、命令执行、网络访问、引用未批准材料。',
].join('\n');

const REVISION_BODY = [
  '【角色】修订者。你只吸收针对自己提案的质疑，看不到对方的修订。',
  '【任务】逐条回应评审质疑：采纳、部分采纳或反驳（须给理由），产出修订方案。',
  '【输出】只输出一个 JSON 对象：{"body": string, "stance": string, "changes": string[], "reserved_disagreements": string}。',
  '【要求】修订后的方案必须保留原始版本可追溯的改动说明；未解决的分歧如实保留。',
  '【禁止】文件写入、命令执行、网络访问、引用未批准材料。',
].join('\n');

function template(kind: CollabSkillKind, version: string, body: string): CollabSkillTemplate {
  return { kind, version, body, sha256: createHash('sha256').update(body, 'utf8').digest('hex') };
}

/** 版本固定的四种双席模板；正文变更即哈希变化，既有授权快照将如实暴露这一差异。
 *  GOAL-085 起本数组逐字保持 GOAL-084 的正文（不得改动双模型既有模板）。 */
export const COLLAB_SKILL_TEMPLATES: readonly CollabSkillTemplate[] = [
  template('coordination', 'v2', COORDINATION_BODY),
  template('proposal', 'v2', PROPOSAL_BODY),
  template('review', 'v2', REVIEW_BODY),
  template('revision', 'v2', REVISION_BODY),
];

/** GOAL-085：三席专用协调模板——关注点/材料计划按 A/B/C 三组返回。 */
export const COLLAB_TRIPLE_COORDINATION_TEMPLATE: CollabSkillTemplate =
  template('coordination', 'v3-triple', COORDINATION_TRIPLE_BODY);

/** 按席位数取该会话适用的模板注册表：2 席 = GOAL-084 四种模板（哈希与旧快照一致），
 *  3 席 = 三席协调模板 + 上述四种（同 kind 时三席版本在前，查找必须先命中它）。
 *  两个注册表哈希互相独立。 */
export function collabSkillTemplatesFor(seatCount: number): readonly CollabSkillTemplate[] {
  if (seatCount === 3) return [COLLAB_TRIPLE_COORDINATION_TEMPLATE, ...COLLAB_SKILL_TEMPLATES];
  if (seatCount === 2) return COLLAB_SKILL_TEMPLATES;
  throw new Error(`unsupported collaboration seat count: ${seatCount}（只支持 2 或 3 席）`);
}

/** 模板注册表哈希——会话授权快照记录该值，模板正文或版本变化即暴露。
 *  缺省按两席注册表计算：快照只冻结其席位数对应的注册表，三席新增模板不得让
 *  既有两席批准失效。 */
export function collabSkillRegistrySha256(seatCount: number = 2): string {
  return createHash('sha256')
    .update(JSON.stringify(collabSkillTemplatesFor(seatCount).map((t) => ({ kind: t.kind, version: t.version, body: t.body, sha256: t.sha256 }))), 'utf8')
    .digest('hex');
}

export function collabSkillTemplate(kind: CollabSkillKind, seatCount: number = 2): CollabSkillTemplate {
  const found = collabSkillTemplatesFor(seatCount).find((t) => t.kind === kind);
  if (found === undefined) throw new Error(`unknown collaboration skill kind: ${kind}`);
  return found;
}

// ---- 各阶段正式 JSON Schema（§3.4 owner 复核：模板中的 string/string[] 只是描述，
// 校验以本节 Schema 为准——字段类型、材料引用与可见回应对象另由协调器语义核验。）----

export interface CollabJsonSchema {
  type: 'object' | 'string' | 'array';
  items?: CollabJsonSchema;
  required?: string[];
  additionalProperties?: false;
  properties?: Record<string, CollabJsonSchema>;
}

const STRING: CollabJsonSchema = { type: 'string' };
const STRING_ARRAY: CollabJsonSchema = { type: 'array', items: { type: 'string' } };

function objectSchema(required: string[], properties: Record<string, CollabJsonSchema>): CollabJsonSchema {
  return { type: 'object', required, additionalProperties: false, properties };
}

export const COLLAB_SKILL_SCHEMAS: Record<CollabSkillKind, CollabJsonSchema> = {
  coordination: objectSchema(['a_focus', 'b_focus', 'material_plan', 'notes'], {
    a_focus: STRING,
    b_focus: STRING,
    material_plan: objectSchema(['A', 'B'], { A: STRING_ARRAY, B: STRING_ARRAY }),
    notes: STRING,
  }),
  proposal: objectSchema(['body', 'stance', 'evidence', 'reserved_disagreements'], {
    body: STRING,
    stance: STRING,
    evidence: STRING_ARRAY,
    reserved_disagreements: STRING,
  }),
  review: objectSchema(['body', 'stance', 'responds_to', 'evidence', 'flaws', 'suggestions', 'reserved_disagreements'], {
    body: STRING,
    stance: STRING,
    responds_to: STRING,
    evidence: STRING_ARRAY,
    flaws: STRING_ARRAY,
    suggestions: STRING_ARRAY,
    reserved_disagreements: STRING,
  }),
  revision: objectSchema(['body', 'stance', 'changes', 'reserved_disagreements'], {
    body: STRING,
    stance: STRING,
    changes: STRING_ARRAY,
    reserved_disagreements: STRING,
  }),
};

/** GOAL-085：三席协调阶段的正式 Schema（c_focus + 三组材料计划）。评审/修订
 *  沿用上面的单提案格式——评审始终只针对一份被评审提案，与席位数无关。 */
export const COLLAB_TRIPLE_COORDINATION_SCHEMA: CollabJsonSchema =
  objectSchema(['a_focus', 'b_focus', 'c_focus', 'material_plan', 'notes'], {
    a_focus: STRING,
    b_focus: STRING,
    c_focus: STRING,
    material_plan: objectSchema(['A', 'B', 'C'], { A: STRING_ARRAY, B: STRING_ARRAY, C: STRING_ARRAY }),
    notes: STRING,
  });

/** 按席位数取阶段 Schema：2 席 = GOAL-084 契约；3 席仅 coordination 换 v3 契约。 */
export function collabSkillSchemasFor(seatCount: number): Record<CollabSkillKind, CollabJsonSchema> {
  if (seatCount !== 3) return COLLAB_SKILL_SCHEMAS;
  return { ...COLLAB_SKILL_SCHEMAS, coordination: COLLAB_TRIPLE_COORDINATION_SCHEMA };
}

/** 最小 JSON Schema 校验器（零依赖；只支持本文件 Schema 用到的子集）。
 *  返回 null = 合法；否则返回人话错误（供共享重试反馈与失败证据留存）。 */
export function validateCollabJson(value: unknown, schema: CollabJsonSchema, path = 'root'): string | null {
  if (schema.type === 'string') {
    return typeof value === 'string' ? null : `${path} 必须是字符串`;
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) return `${path} 必须是数组`;
    for (let i = 0; i < value.length; i++) {
      const itemError = validateCollabJson(value[i], schema.items ?? { type: 'string' }, `${path}[${i}]`);
      if (itemError !== null) return itemError;
    }
    return null;
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return `${path} 必须是对象`;
  const record = value as Record<string, unknown>;
  for (const key of schema.required ?? []) {
    if (!(key in record)) return `${path} 缺少必填字段 ${key}`;
  }
  const properties = schema.properties ?? {};
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(record)) {
      if (!(key in properties)) return `${path} 出现未定义字段 ${key}`;
    }
  }
  for (const [key, sub] of Object.entries(properties)) {
    if (!(key in record)) continue;
    const itemError = validateCollabJson(record[key], sub, `${path}.${key}`);
    if (itemError !== null) return itemError;
  }
  return null;
}
