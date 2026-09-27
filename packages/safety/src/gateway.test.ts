// 出站网关的单元测试（L3）—— 四条不可协商行为各自的最小充分覆盖。
//
// 「不存在绕过路径」这类断言的默认状态是空真通过，所以这里每一条都配一个**反面
// 用例**：fail-closed 配三种失败输入、ended 配 active、挽留拦截配三条阴性。

import { describe, expect, it, vi } from 'vitest';

import {
  RETENTION_PHRASES,
  SAFETY_CONFIDENCE_FLOOR,
  parseClassification,
  safetyGateway,
  type Classification,
  type SafetyEventDraft,
} from './index.ts';

/** 被调用即失败的 sink：用在「这一支不该写 safety_event」的用例里。 */
function forbiddenRecorder(): (draft: SafetyEventDraft) => string {
  return () => {
    throw new Error('这一支不该写 safety_event');
  };
}

/** 捕获式 sink：返回一个固定的 safety_event id（真实实现返回落库行的主键）。 */
function capturingRecorder(into: SafetyEventDraft[]): (draft: SafetyEventDraft) => string {
  return (draft) => {
    into.push(draft);
    return 'sev_unit_test';
  };
}

describe('SAFE-05：classifierStatus 为 failed 时 level 恒为 elevated', () => {
  // 三类失败（RESEARCH §4.3）各一条输入。
  const failures: readonly [string, Classification][] = [
    // (a) provider 报错/超时 —— 调用方直接构造 failed（类型上它没有 level 字段可填）。
    ['provider 报错', { classifierStatus: 'failed' }],
    // (b) 结构化输出 schema 校验失败。
    ['schema 校验失败', parseClassification('这不是 JSON')],
    // (c) 置信度低于阈值。
    [
      '低置信',
      parseClassification(JSON.stringify({ level: 'none', confidence: 0.1, categories: ['none'] })),
    ],
  ];

  for (const [label, classification] of failures) {
    it(`${label} ⇒ escalated 且 level 为 elevated，不是 crisis`, async () => {
      expect(classification.classifierStatus).toBe('failed');
      const recorded: SafetyEventDraft[] = [];
      const result = await safetyGateway({
        candidateText: '今天过得怎么样？',
        classification,
        conversationStatus: 'active',
        recordSafetyEvent: capturingRecorder(recorded),
      });
      expect(result.outcome).toBe('escalated');
      if (result.outcome !== 'escalated') return;
      // crisis 会联络紧急联系人 —— 分类器 bug 不该让别人的手机响（SAFE-05 明文）。
      expect(result.level).toBe('elevated');
      expect(result.overrideApplied).toBe(true);
      // 这一支在类型层就没有 text 字段；运行时再确认一次没有可投递的文本。
      expect('text' in result).toBe(false);
      // fail-closed 走**一级**卡片：它在类型上就没有 contactStatus，于是 SAFE-03 的
      // 「不联络」在渲染层也无从违反。UI 表现与一级完全相同（用户看不到「系统出错了」）。
      expect(result.careCard.level).toBe('level1');
      expect('contactStatus' in result.careCard).toBe(false);
      expect(JSON.stringify(result.careCard)).not.toMatch(/出错|错误|失败|error/iu);
      // 留证：恰好一行，classifier_status 为 failed。
      expect(recorded).toHaveLength(1);
      expect(recorded[0]?.classifierStatus).toBe('failed');
      expect(recorded[0]?.ruleHits).toContain('classifier:failed');
      expect(result.safetyEventId).toBe('sev_unit_test');
    });
  }

  it('调用方无法构造 level 为 none 且 classifierStatus 为 failed 的组合（类型层）', () => {
    // 这条是编译期约束的运行时影子：failed 分支没有 level 字段，因此下面这个对象
    // 只有 classifierStatus 一个键 —— 如果哪天类型被改成扁平的两字段形状，
    // 这条断言会连同 tools/ci 的负向 type fixture 一起失效，所以两处都要有。
    const failed: Classification = { classifierStatus: 'failed' };
    expect(Object.keys(failed)).toEqual(['classifierStatus']);
  });

  it('parseClassification：合法输出 ⇒ ok；缺字段 / 越界 / 低于阈值 ⇒ failed', () => {
    // ⚠️ Plan 07 起校验用 @drift/prompts 的 SafetyClassifyOutput（zod）而不是手写的
    // 三条 if。因此 `categories` 也是**必填** —— 它在那份契约里就是必填的，而此前
    // 的手写校验完全忽略它（一个只回 level 的模型会被当成合规回答）。
    expect(
      parseClassification(JSON.stringify({ level: 'watch', confidence: 0.9, categories: ['none'] })),
    ).toEqual({ classifierStatus: 'ok', level: 'watch' });
    expect(parseClassification(JSON.stringify({ level: 'none' })).classifierStatus).toBe('failed');
    expect(
      parseClassification(JSON.stringify({ level: 'none', confidence: 0.9 })).classifierStatus,
      'categories 缺失同样算 schema 失败 —— 契约里它是必填',
    ).toBe('failed');
    expect(
      parseClassification(JSON.stringify({ level: 'none', confidence: 1.5, categories: [] }))
        .classifierStatus,
    ).toBe('failed');
    expect(
      parseClassification(JSON.stringify({ level: 'none', confidence: 'high', categories: [] }))
        .classifierStatus,
    ).toBe('failed');
    expect(
      parseClassification(JSON.stringify({ level: 'bogus', confidence: 0.9, categories: [] }))
        .classifierStatus,
    ).toBe('failed');
    // 阈值边界：恰好等于下限算通过，低于才算失败。
    expect(
      parseClassification(
        JSON.stringify({
          level: 'none',
          confidence: SAFETY_CONFIDENCE_FLOOR,
          categories: ['none'],
        }),
      ).classifierStatus,
    ).toBe('ok');
  });
});

describe('COMPLY-05：会话 ended ⇒ 拒绝产出 GatedText（fail-closed）', () => {
  it('返回 conversation_ended 的 refused 态，且结果里没有任何可投递的文本', async () => {
    const result = await safetyGateway({
      candidateText: '我还在这儿呢。',
      classification: { classifierStatus: 'ok', level: 'none' },
      conversationStatus: 'ended',
      recordSafetyEvent: forbiddenRecorder(),
    });
    expect(result).toEqual({ outcome: 'refused', reason: 'conversation_ended' });
    // 「message 表无新增 sender_kind 为 character 的行」的单元层判据：
    // 落库出口 insertCharacterMessage 只接受 GatedText，而这一支不产出 GatedText，
    // 于是那次插入在类型层不可达 —— 没有 text 就没有可以落库的东西。
    // 真实 DB 层的同一条断言（含 worker 侧事务内二次检查）在 Plan 12 的 L5。
    expect('text' in result).toBe(false);
  });

  it('同一输入在 active 会话下是 gated —— 证明上一条不是恒 refused', async () => {
    const result = await safetyGateway({
      candidateText: '我还在这儿呢。',
      classification: { classifierStatus: 'ok', level: 'none' },
      conversationStatus: 'active',
      recordSafetyEvent: forbiddenRecorder(),
    });
    expect(result.outcome).toBe('gated');
    if (result.outcome !== 'gated') return;
    expect(result.text).toBe('我还在这儿呢。');
  });
});

describe('COMPLY-05 / R1.33：挽留话术出站触发率恒为 0', () => {
  for (const phrase of RETENTION_PHRASES) {
    it(`候选文本含「${phrase}」⇒ 不产出 GatedText 并写一条 safety_event`, async () => {
      const recorded: SafetyEventDraft[] = [];
      const result = await safetyGateway({
        candidateText: `${phrase}，我们再待一下。`,
        classification: { classifierStatus: 'ok', level: 'none' },
        conversationStatus: 'active',
        recordSafetyEvent: capturingRecorder(recorded),
      });
      expect(result.outcome).toBe('refused');
      if (result.outcome !== 'refused') return;
      expect(result.reason).toBe('retention_phrase');
      if (result.reason !== 'retention_phrase') return;
      expect(result.retentionHits).toContain(phrase);
      expect('text' in result).toBe(false);

      expect(recorded).toHaveLength(1);
      const draft = recorded[0];
      expect(draft?.ruleHits).toContain(`retention:${phrase}`);
      // level 保持原值：挽留话术不是危机，记成 elevated 会污染会话风险态（SAFE-06）。
      expect(draft?.level).toBe('none');
      expect(draft?.overrideApplied).toBe(true);
      // 审计行只有哈希与长度，没有正文（PRIV-05 的删除面积）。
      expect(draft?.candidateReplyHash).toMatch(/^[0-9a-f]{64}$/u);
      expect(draft?.candidateReplyLen).toBe(`${phrase}，我们再待一下。`.length);
      expect(JSON.stringify(draft)).not.toContain('我们再待一下');
    });
  }

  it.each([
    ['走', '他站起来走了，门没关。'],
    ['聊一会天气', '我们刚刚聊一会天气，然后我就去睡了。'],
    ['你要离开公司了吗', '所以你要离开公司了吗？'],
  ])('阴性用例「%s」不被拦截，且不写 safety_event', async (_label, text) => {
    const recordSafetyEvent = vi.fn(() => 'sev_unit_test');
    const result = await safetyGateway({
      candidateText: text,
      classification: { classifierStatus: 'ok', level: 'none' },
      conversationStatus: 'active',
      recordSafetyEvent,
    });
    expect(result.outcome).toBe('gated');
    expect(recordSafetyEvent).not.toHaveBeenCalled();
  });

  it('crisis 胜过挽留拦截 —— 一次真实危机不得被一个文案问题掩盖', async () => {
    const recorded: SafetyEventDraft[] = [];
    const result = await safetyGateway({
      candidateText: `${RETENTION_PHRASES[0]}，我们一起想想办法。`,
      classification: { classifierStatus: 'ok', level: 'crisis' },
      conversationStatus: 'active',
      recordSafetyEvent: capturingRecorder(recorded),
    });
    expect(result.outcome).toBe('escalated');
    if (result.outcome !== 'escalated') return;
    expect(result.level).toBe('crisis');
    expect(result.careCard.level).toBe('level2');
    expect(recorded).toHaveLength(1);
  });

  it('规则层只能抬升：分类判 none 而规则层建议 elevated ⇒ 最终 elevated', async () => {
    const recorded: SafetyEventDraft[] = [];
    const result = await safetyGateway({
      candidateText: '嗯，我在听。',
      classification: { classifierStatus: 'ok', level: 'none' },
      conversationStatus: 'active',
      inboundSuggestedLevel: 'elevated',
      inboundRuleHits: ['extreme_emotion.cannot_hold_on'],
      previousLevel: 'watch',
      recordSafetyEvent: capturingRecorder(recorded),
    });
    expect(result.outcome).toBe('escalated');
    if (result.outcome !== 'escalated') return;
    expect(result.level).toBe('elevated');
    expect(result.ruleHits).toContain('extreme_emotion.cannot_hold_on');
    // risk 轨迹：前一等级 → 新等级（R1.25）。
    expect(recorded[0]?.previousLevel).toBe('watch');
    expect(recorded[0]?.level).toBe('elevated');
  });

  it('ended 胜过挽留拦截 —— 硬退出之后连 safety_event 都不写（零出站优先）', async () => {
    const result = await safetyGateway({
      candidateText: `${RETENTION_PHRASES[0]}。`,
      classification: { classifierStatus: 'ok', level: 'none' },
      conversationStatus: 'ended',
      recordSafetyEvent: forbiddenRecorder(),
    });
    expect(result.outcome).toBe('refused');
    if (result.outcome !== 'refused') return;
    expect(result.reason).toBe('conversation_ended');
  });
});
