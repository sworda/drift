// 双层检测的 L3 单元测试 —— 规则层 / 合并规则 / 关怀卡片 / 分类封装。
//
// 这四件事都是纯函数（或只依赖一个注入端口），因此可以在这里穷举；把它们留到 L5 用
// 真实数据库去覆盖，会让每一条分支的验证成本高一个数量级，于是实际上只有 happy path
// 会被覆盖 —— 而 fail-closed 的价值全在非 happy path 上。

import { describe, expect, it } from 'vitest';

import {
  CARE_CARD_LEVELS,
  CONTACT_ATTEMPT_STATUSES,
  FALLBACK_HELP_RESOURCES,
  INBOUND_RULES,
  RISK_LEVELS,
  SAFETY_CONFIDENCE_FLOOR,
  buildCareCard,
  classifySafety,
  maskContact,
  maxRisk,
  parseClassification,
  resolveRisk,
  riskRank,
  scanInbound,
  type Classification,
  type ClassifyInvoke,
} from './index.ts';

describe('SAFE-05 / resolveRisk：规则层只能抬升，分类器失败恒为 elevated', () => {
  it('规则层 elevated + 分类 none ⇒ elevated（规则层不具决定性 ≠ 可被忽略）', () => {
    expect(resolveRisk('elevated', { classifierStatus: 'ok', level: 'none' })).toBe('elevated');
  });

  it('规则层 none + 分类 crisis ⇒ crisis', () => {
    expect(resolveRisk('none', { classifierStatus: 'ok', level: 'crisis' })).toBe('crisis');
  });

  it('规则层 crisis + 分类 none ⇒ crisis（取较高者，规则层永不降级）', () => {
    expect(resolveRisk('crisis', { classifierStatus: 'ok', level: 'none' })).toBe('crisis');
  });

  // 三类失败各一次。**恒得 elevated**，含规则层已建议 crisis 的那一次 ——
  // 失败分支既不向下回落 none，也不向上升 crisis（封顶，见 risk.ts 的说明）。
  const failures: readonly [string, Classification][] = [
    ['provider 报错/超时', { classifierStatus: 'failed' }],
    ['schema 校验失败', parseClassification('这不是 JSON')],
    ['置信度低于下限', parseClassification(JSON.stringify({ level: 'crisis', confidence: 0.2, categories: ['none'] }))],
  ];
  for (const [label, classification] of failures) {
    it(`${label} ⇒ elevated（四种入站建议等级下都一样）`, () => {
      expect(classification.classifierStatus).toBe('failed');
      for (const inbound of RISK_LEVELS) {
        expect(resolveRisk(inbound, classification)).toBe('elevated');
      }
    });
  }

  it('riskRank / maxRisk 用序号而不是字符串序比较', () => {
    // 字符串序下 'crisis' < 'none' < 'watch' —— 直接用 > 比较字符串会让 crisis 最小。
    expect(riskRank('crisis')).toBeGreaterThan(riskRank('watch'));
    expect(maxRisk('crisis', 'watch')).toBe('crisis');
    expect(maxRisk('none', 'none')).toBe('none');
  });
});

describe('R1.20 入站规则层：高召回、宁可误报、等级映射符合第十三条两级', () => {
  it('规则表里只有 elevated 与 crisis 两种建议等级', () => {
    for (const rule of INBOUND_RULES) {
      expect(['elevated', 'crisis']).toContain(rule.level);
    }
  });

  it('二级（自残自杀意图 / 重大财产损失）⇒ crisis', () => {
    for (const text of [
      '我不想活了',
      '想结束自己的生命',
      '昨天割腕了',
      '我被骗了，钱全没了',
      '赌输了，全部积蓄都没了',
    ]) {
      expect(scanInbound(text).suggestedLevel, text).toBe('crisis');
    }
  });

  it('一级（极端情绪）⇒ elevated，**不是** crisis（SAFE-03 明文不联络）', () => {
    for (const text of ['我真的撑不住了', '我是个废物', '看不到希望']) {
      expect(scanInbound(text).suggestedLevel, text).toBe('elevated');
    }
  });

  it('阴性对照不升级 —— 缺这一类时「永远返回 crisis」的规则层能 100% 通过', () => {
    for (const text of [
      '今天天气不错，我们去散步吧。',
      '这部电影的结局有点难懂。',
      '我明天要去交房租。',
    ]) {
      expect(scanInbound(text).suggestedLevel, text).toBe('none');
      expect(scanInbound(text).hits, text).toHaveLength(0);
    }
  });

  it('归一化：空格、零宽字符与标点不能让匹配失手', () => {
    expect(scanInbound('我 不 想 活 了').suggestedLevel).toBe('crisis');
    expect(scanInbound('我不\u200b想活了').suggestedLevel).toBe('crisis');
    expect(scanInbound('我，不想，活了。').suggestedLevel).toBe('crisis');
  });

  it('hits 只含规则 id，不含用户原文片段（safety_event 无正文列）', () => {
    const scan = scanInbound('我被骗了三万块，是杀猪盘。');
    expect(scan.hits.length).toBeGreaterThan(0);
    for (const hit of scan.hits) {
      expect(INBOUND_RULES.map((rule) => rule.id)).toContain(hit);
    }
    expect(JSON.stringify(scan)).not.toContain('三万');
  });

  it('不做金额阈值推断（Q7）：不带金额的明确表述同样命中', () => {
    expect(scanInbound('房款被套走了').suggestedLevel).toBe('crisis');
    expect(scanInbound('被骗了').suggestedLevel).toBe('crisis');
  });
});

describe('SAFE-03/04 关怀卡片：一级无联络语义，资源清单 fail-closed', () => {
  it('两级各有一个取值，且一级卡片对象里没有 contactStatus', () => {
    expect([...CARE_CARD_LEVELS]).toEqual(['level1', 'level2']);
    const level1 = buildCareCard('level1');
    expect('contactStatus' in level1).toBe(false);
    // 类型层的同一条约束由 care-cards.ts 末尾的编译期断言守着
    // （给 CareCardLevel1 加 contactStatus 会让那一行报错）。
    expect(JSON.stringify(level1)).not.toMatch(/联系|联络|contact/iu);
  });

  it('资源清单为空 ⇒ 返回 12356 与 120 两条兜底行，绝不返回空清单', () => {
    expect(buildCareCard('level1', { resources: [] }).resources.length).toBeGreaterThanOrEqual(2);
    expect(
      buildCareCard('level2', { resources: [], contactStatus: 'pending' }).resources.length,
    ).toBeGreaterThanOrEqual(2);
    const phones = FALLBACK_HELP_RESOURCES.map((resource) => resource.phone);
    expect(phones).toEqual(['12356', '120']);
  });

  it('二级卡片：claimsContacted 只有 delivered 为真（T-07-03 虚假陈述）', () => {
    for (const status of CONTACT_ATTEMPT_STATUSES) {
      const card = buildCareCard('level2', { contactStatus: status });
      expect(card.claimsContacted, status).toBe(status === 'delivered');
      // failed / unavailable 两态把援助渠道行提到首屏第一行（UI-SPEC）。
      expect(card.hotlineFirst, status).toBe(status === 'failed' || status === 'unavailable');
    }
  });

  it('二级卡片缺 contactStatus ⇒ 抛错（不得给一个没有根据的默认陈述）', () => {
    // @ts-expect-error 二级卡片必须带 contactStatus —— 这一行就是那条类型约束的证明
    expect(() => buildCareCard('level2', {})).toThrow(/contactStatus/u);
  });

  it('联系方式遮蔽：11 位留头三尾四，其余整串遮蔽', () => {
    expect(maskContact('13812341234')).toBe('138****1234');
    expect(maskContact('138-1234-1234')).toBe('138****1234');
    expect(maskContact('12345')).toBe('****');
  });
});

describe('SAFE-05 classifySafety：三类失败全部收敛成 failed，且永不抛错', () => {
  const input = { userText: '我今天很累。', candidateReply: '嗯，我在。', sessionRiskLevel: 'none' } as const;

  it('(a) provider 抛错 ⇒ provider_error / failed', async () => {
    const invoke: ClassifyInvoke = () => Promise.reject(new Error('boom'));
    const outcome = await classifySafety(input, { invoke });
    expect(outcome.classification.classifierStatus).toBe('failed');
    expect(outcome.failureReason).toBe('provider_error');
  });

  it('(a) 超时 ⇒ timeout / failed（没有超时就没有「有界」）', async () => {
    const invoke: ClassifyInvoke = () => new Promise(() => undefined);
    const outcome = await classifySafety(input, { invoke, timeoutMs: 20 });
    expect(outcome.classification.classifierStatus).toBe('failed');
    expect(outcome.failureReason).toBe('timeout');
  });

  it('(b) schema 校验失败 ⇒ schema_invalid / failed', async () => {
    for (const text of ['不是 JSON', '{}', JSON.stringify({ level: 'bogus', confidence: 0.9, categories: [] })]) {
      const invoke: ClassifyInvoke = () => Promise.resolve({ text, modelSnapshot: 'glm-test' });
      const outcome = await classifySafety(input, { invoke });
      expect(outcome.classification.classifierStatus, text).toBe('failed');
      expect(outcome.failureReason, text).toBe('schema_invalid');
    }
  });

  it('(c) 置信度低于下限 ⇒ low_confidence / failed，即便 level 说的是 crisis', async () => {
    const invoke: ClassifyInvoke = () =>
      Promise.resolve({
        text: JSON.stringify({ level: 'crisis', confidence: 0.2, categories: ['suicidal_intent'] }),
        modelSnapshot: 'glm-test',
      });
    const outcome = await classifySafety(input, { invoke });
    expect(outcome.classification.classifierStatus).toBe('failed');
    expect(outcome.failureReason).toBe('low_confidence');
    // 低置信的 crisis 不得变成一次真的 crisis（那会让别人的手机响）。
    expect(resolveRisk('none', outcome.classification)).toBe('elevated');
  });

  it('合法输出 ⇒ ok，并带回 modelSnapshot（SAFE-02 的事后复核靠它）', async () => {
    const invoke: ClassifyInvoke = () =>
      Promise.resolve({
        text: JSON.stringify({ level: 'watch', confidence: SAFETY_CONFIDENCE_FLOOR, categories: ['none'] }),
        modelSnapshot: 'glm-4.7-flash',
      });
    const outcome = await classifySafety(input, { invoke });
    expect(outcome.classification).toEqual({ classifierStatus: 'ok', level: 'watch' });
    expect(outcome.modelSnapshot).toBe('glm-4.7-flash');
    expect(outcome.failureReason).toBeNull();
  });
});
