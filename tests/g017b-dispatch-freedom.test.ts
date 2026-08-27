import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderBoardPage } from '../src/web/page.ts';

// GOAL-017B（派发包 rm004-p17b）调度自由·前端 —— 五项复验的结构断言（jsdom-free）。
// 消费契约 v1.5（p17a 未落盘前按其包内描述 mock：verified/verify_reason/adapters CRUD/caps PUT）。

const html = renderBoardPage();

test('#1 犬只管理：添加（模板+命名）与移除（软删确认）', () => {
  assert.match(html, /id="roster-manage"/, 'roster 管理条容器');
  assert.match(html, /id="adapter-template"/, '基础模板下拉');
  assert.match(html, /id="adapter-new-id"/, '命名输入');
  assert.match(html, /postJson\('\/api\/adapters'/, '添加走 POST /api/adapters');
  assert.match(html, /data-remove=/, '每行移除按钮');
  assert.match(html, /method: 'DELETE'/, '移除走 DELETE');
  assert.match(html, /软删：roster 隐藏，历史派发记录与预算台账保留/, '软删语义确认文案');
  assert.match(html, /window\.confirm/, '移除需确认');
});

test('#2 头犬级联选择：harness → 模型变体两级 + UNVERIFIED 灰显徽标', () => {
  assert.match(html, /id="chat-head-select"/, 'harness 下拉');
  assert.match(html, /id="chat-head-variant"/, '模型变体下拉');
  assert.match(html, /id="chat-head-variant-wrap"/, '变体包装（无变体隐藏）');
  assert.match(html, /renderHeadCascade/, '级联渲染函数');
  assert.match(html, /isVerifiedEntry/, 'verified 判定');
  assert.match(html, /unverifiedReason/, 'UNVERIFIED 原因徽标');
  assert.match(html, /option\.unverified/, '灰显样式');
  assert.match(html, /payload\.model_id = variantSel\.value/, '变体随消息提交（model_id）');
});

test('#3 徽章链：当前头犬徽章 = 所选 harness 图标 + 模型名联动', () => {
  assert.match(html, /当前头犬：' \+ adapterId/, '徽章文本随选择');
  assert.match(html, /chat-head-variant'\)\.addEventListener\('change', renderHeadDogBadge/, '变体切换联动徽章');
  assert.match(html, /chat-head-select'\)\.addEventListener\('change', renderHeadVariantOptions/, 'harness 切换重算变体');
});

test('#4 品牌色官方主色表 + 运行边缘辉光（品牌色）', () => {
  assert.match(html, /--brand-deepseek: #4D6BFE/, 'DeepSeek 官方主色变量');
  assert.match(html, /--brand-claude: #D97757/, 'Claude 官方主色变量');
  assert.match(html, /--brand-kimi: #7C5CFF/, 'Kimi 官方主色变量');
  assert.match(html, /--brand-glm: #4E7AC7/, 'GLM 官方主色变量');
  assert.match(html, /--brand-opencode/, 'opencode 主色变量');
  assert.match(html, /BRAND_COLORS/, 'JS 品牌色表');
  assert.match(html, /--dog-brand/, '辉光读品牌色变量');
  assert.match(html, /@keyframes logo-glow/, '运行态边缘辉光动画');
  assert.match(html, /logo-hop/, '跳动保留');
});

test('#6 预算面板：admission 计数 + cap 行内编辑 PUT', () => {
  assert.match(html, /admission_count/, 'admission 计数字段消费');
  assert.match(html, /次派发记账/, '计数徽标文案（G076 人话化：admission→派发记账）');
  assert.match(html, /data-cap-actor=/, 'cap 行内输入');
  assert.match(html, /\/api\/budget\/caps\//, 'PUT caps 端点');
  assert.match(html, /method: 'PUT'/, 'cap 编辑走 PUT');
  assert.match(html, /data-cap-msg=/, '失败原因行内显示');
  assert.match(html, /cap 必须 > 0/, '数值校验');
});
