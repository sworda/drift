// @vitest-environment jsdom

// 两级关怀卡片与四态联络状态行的 RTL 契约断言（SAFE-01..05 / R1.24）。
//
// ⚠️ 本文件住在 apps/web/src 而不是 tools/ci：react / react-dom 只装在 apps/web
//（pnpm 严格 node_modules，从 tools/ci 解析不到它们）—— 与 register-render.test.tsx
// 同一条先例（01-09）。非渲染的静态断言（目录 grep、eslint 负向 fixture、常量
// 相等）在 tools/ci/crisis-ui-contract.test.ts。
//
// ⚠️ 只用 fireEvent，不用 user-event —— 后者不在批准的三个包里。
//
// ── 非空真策略（V.0）──────────────────────────────────────────────────────
// (b) 与 (c) 各带一条「注入式」反例：把虚假陈述 / 错位布局直接 render 出来，断言
// 检查器**会**抓住它。临时改一次源码只证明了执行那一刻；注入每个 PR 都证明一次。
//
// ── fixture 来源 ──────────────────────────────────────────────────────────
// 卡片对象用**真实** buildCareCard（@drift/safety）构造 —— 测试跑在 node 环境、
// node:crypto 可用，而用生产构造器生成的卡片渲染，形状漂移会当场变红，而不是
// 靠两边各写一份类型然后指望它们不漂。

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  FALLBACK_HELP_RESOURCES,
  buildCareCard,
  type CareCardLevel2 as ServerCareCardLevel2,
} from '@drift/safety';

import { ChatView } from '../chat/chat-view';
import { AiBanner } from '@/components/ai-banner';
import {
  CARE_CARD_LEVEL1_DATA_HAS_NO_CONTACT_STATUS,
  CareCard,
  CareCardLevel1,
  CareCardLevel2,
} from './care-card';
import {
  CONTACT_STATUSES,
  CONTACT_STATUS_COPY,
  HOTLINE_CALL_LABEL,
  LEVEL2_CONFIRM_LABEL,
  PENDING_NOTE,
  contactStatusLine,
} from './copy';
import { ContactStatusRow } from './contact-status-row';
import { FALLBACK_RESOURCES, ResourceList } from './resource-list';

afterEach(() => {
  cleanup();
});

/** 与服务端同形的一级卡片（真实构造器）。 */
function level1Card() {
  return buildCareCard('level1', {});
}

/** 与服务端同形的二级卡片（真实构造器）。 */
function level2Card(status: (typeof CONTACT_STATUSES)[number]): ServerCareCardLevel2 {
  return buildCareCard('level2', {
    contactStatus: status,
    contactName: '李四',
    maskedContact: '138****1234',
  });
}

// ── 检查器（(b) / (c) 的断言逻辑提成函数，反例注入直接调它们）─────────────────

/** (b) 非 delivered 态不得陈述「已经联系」—— 虚假陈述检查器。 */
function expectNoFalseContactClaim(container: HTMLElement): void {
  const text = container.textContent ?? '';
  if (text.includes('已经联系')) {
    throw new Error(`非 delivered 态渲染了「已经联系」—— 这是一次虚假陈述：${text}`);
  }
}

/** (c) 热线行必须是卡片首屏第一行：署名行之后、安抚段之前、资源清单之前。 */
function expectHotlineFirstRow(container: HTMLElement): void {
  const title = container.querySelector('[data-slot="alert-title"]');
  const row = container.querySelector('[data-slot="contact-status-row"]');
  const reassurance = container.querySelector('[data-slot="care-reassurance"]');
  const list = container.querySelector('[data-slot="crisis-resource-list"]');
  if (title === null) throw new Error('找不到署名行');
  if (row === null) throw new Error('找不到联络状态行');
  if (reassurance === null) throw new Error('找不到安抚段');
  if (list === null) throw new Error('找不到援助资源清单');
  // 顺序必须是 title < row < reassurance < list。
  // compareDocumentPosition(x) & FOLLOWING 非零 ⇔ x 在本节点**之后**。
  const rowAfterTitle = title.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING;
  const reassuranceAfterRow =
    row.compareDocumentPosition(reassurance) & Node.DOCUMENT_POSITION_FOLLOWING;
  const listAfterRow = row.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING;
  if (rowAfterTitle === 0 || reassuranceAfterRow === 0 || listAfterRow === 0) {
    throw new Error('热线行不是首屏第一行 —— failed/unavailable 态的出路必须在署名行之下、其余内容之前');
  }
}

describe('(a) 四态联络状态行：全部有渲染分支且文案正确', () => {
  it.each(CONTACT_STATUSES)('status=%s 的文案出现在二级卡片里', (status) => {
    const { container } = render(<CareCardLevel2 card={level2Card(status)} />);
    const text = container.textContent ?? '';
    // 各态的关键语义片段（独立于 copy.ts 手写，避免用被测常量自证）。
    const expected: Record<(typeof CONTACT_STATUSES)[number], string> = {
      pending: '正在联系你填写的紧急联系人 李四（138****1234）',
      delivered: '我们已经联系了你填写的紧急联系人：李四 138****1234',
      failed: '我们暂时没能联系上 李四',
      unavailable: '你填写的紧急联系人现在联系不上，我们不会让你一直等',
    };
    expect(text).toContain(expected[status]);
  });

  it('pending 态有 13px 说明行（转圈不是唯一表达 —— 本组件根本没有转圈）', () => {
    const { container } = render(<CareCardLevel2 card={level2Card('pending')} />);
    expect(container.textContent ?? '').toContain(PENDING_NOTE);
  });
});

describe('(b) 非 delivered 态不得出现「已经联系」', () => {
  it.each(['pending', 'failed', 'unavailable'] as const)('%s 态全文不含「已经联系」', (status) => {
    const { container } = render(<CareCardLevel2 card={level2Card(status)} />);
    expectNoFalseContactClaim(container);
  });

  it('非空真：往渲染结果里注入「我们已经联系了」后，检查器会抓住它', () => {
    const { container } = render(<p>我们已经联系了你填写的紧急联系人。</p>);
    expect(() => expectNoFalseContactClaim(container)).toThrow();
  });

  it('claimsContacted=false 时即便 status=delivered 也不陈述已联系（服务端布尔是唯一闸门）', () => {
    const card = { ...level2Card('delivered'), claimsContacted: false };
    const { container } = render(<CareCardLevel2 card={card} />);
    expectNoFalseContactClaim(container);
    // 不可陈述 ⇒ 按未知处理 ⇒ pending 渲染（宁可少说，不可说错）。
    expect(container.textContent ?? '').toContain('正在联系');
  });
});

describe('(c) failed / unavailable：热线行上移为首屏第一行 + 直呼按钮', () => {
  it.each(['failed', 'unavailable'] as const)('%s 态：热线行在资源清单之前', (status) => {
    const { container } = render(<CareCardLevel2 card={level2Card(status)} />);
    expectHotlineFirstRow(container);
    // 44×44 直呼按钮：jsdom 不做布局，断言触控尺寸 token 的 utility 在场
    //（--size-touch: 44px 的值由 design-tokens.test.ts 钉住）。
    const call = screen.getByLabelText(HOTLINE_CALL_LABEL);
    expect(call.getAttribute('class') ?? '').toContain('min-h-touch');
    expect(call.getAttribute('class') ?? '').toContain('min-w-touch');
    expect(call.getAttribute('href')).toBe('tel:12356');
  });

  it('非空真：把热线行留在原位（hotlineFirst=false 的 failed 卡）后，检查器会抓住它', () => {
    const broken = { ...level2Card('failed'), hotlineFirst: false };
    const { container } = render(<CareCardLevel2 card={broken} />);
    expect(() => expectHotlineFirstRow(container)).toThrow();
  });

  it('pending / delivered 态没有直呼按钮（不抢 44×44 出路的语义位置）', () => {
    render(<CareCardLevel2 card={level2Card('pending')} />);
    expect(screen.queryByLabelText(HOTLINE_CALL_LABEL)).toBeNull();
  });
});

describe('(d) pending → delivered：原地替换，不重排不夺焦点', () => {
  it('承载状态文本的 DOM 节点标识不变，且 document.activeElement 不变', () => {
    const { container, rerender } = render(<CareCardLevel2 card={level2Card('pending')} />);
    const rowBefore = container.querySelector('[data-slot="contact-status-row"]');
    expect(rowBefore).not.toBeNull();
    // 把焦点放在清单里的号码上（状态行之外的元素）。
    const resourceLink = screen.getAllByRole('link')[0];
    if (resourceLink === undefined) throw new Error('清单里没有可聚焦的号码');
    resourceLink.focus();
    expect(document.activeElement).toBe(resourceLink);

    rerender(<CareCardLevel2 card={level2Card('delivered')} />);

    const rowAfter = container.querySelector('[data-slot="contact-status-row"]');
    expect(rowAfter).toBe(rowBefore); // 同一个 DOM 节点 —— 只换了文本
    expect(document.activeElement).toBe(resourceLink); // 焦点没有被抢走
    expect(rowAfter?.textContent ?? '').toContain('我们已经联系了');
  });
});

describe('(e) 状态未知等同 pending 渲染', () => {
  it('status=undefined 的行文本与 pending 完全一致', () => {
    const base = { claimsContacted: false, contactName: '李四', maskedContact: '138****1234', hotlineFirst: false };
    const { container: unknownView } = render(<ContactStatusRow status={undefined} {...base} />);
    const { container: pending } = render(<ContactStatusRow status="pending" {...base} />);
    expect(unknownView.textContent).toBe(pending.textContent);
  });

  it('status=null（下行事件未到）同样等同 pending', () => {
    const base = { claimsContacted: false, contactName: null, maskedContact: null, hotlineFirst: false };
    const { container } = render(<ContactStatusRow status={null} {...base} />);
    expect(container.textContent ?? '').toContain(
      contactStatusLine('pending', { name: null, masked: null }),
    );
  });
});

describe('两级卡片：Alert 基座、无移除交互、唯一确认按钮', () => {
  it('一级卡片渲染署名/安抚/鼓励/清单，且树里没有联络状态行（SAFE-03）', () => {
    const card = level1Card();
    const { container } = render(<CareCardLevel1 card={card} />);
    const text = container.textContent ?? '';
    expect(text).toContain(card.signature);
    expect(text).toContain(card.reassurance);
    expect(text).toContain(card.encouragement);
    expect(container.querySelector('[data-slot="contact-status-row"]')).toBeNull();
  });

  it('一级与二级都没有可访问名称含「关闭」的按钮（不可 dismiss）', () => {
    const { container: c1 } = render(<CareCardLevel1 card={level1Card()} />);
    expect(c1.querySelectorAll('button')).toHaveLength(0); // 一级零按钮
    const { container: c2 } = render(<CareCardLevel2 card={level2Card('pending')} />);
    const labels = [...c2.querySelectorAll('button')].map((b) => b.textContent ?? '');
    expect(labels.every((label) => !label.includes('关闭'))).toBe(true);
  });

  it('二级卡片恰好 1 个 button，可访问名称为「我看到这些帮助方式了」', () => {
    const { container } = render(<CareCardLevel2 card={level2Card('pending')} />);
    const buttons = container.querySelectorAll('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.textContent).toBe(LEVEL2_CONFIRM_LABEL);
  });

  it('点击确认后二级卡片消失 —— 这是唯一的移除路径', () => {
    const { container } = render(<CareCardLevel2 card={level2Card('unavailable')} />);
    fireEvent.click(screen.getByRole('button', { name: LEVEL2_CONFIRM_LABEL }));
    expect(container.querySelector('[data-slot="care-card"]')).toBeNull();
  });

  it('关怀卡片用 care 语义色，不是 destructive 红', () => {
    const { container } = render(<CareCardLevel2 card={level2Card('pending')} />);
    const card = container.querySelector('[data-slot="care-card"]');
    const cls = card?.getAttribute('class') ?? '';
    expect(cls).toContain('bg-care-surface');
    expect(cls).not.toContain('destructive');
  });

  it('服务端一级类型镜像断言仍为真（contactStatus 不存在于一级视图类型）', () => {
    expect(CARE_CARD_LEVEL1_DATA_HAS_NO_CONTACT_STATUS).toBe(true);
  });
});

describe('两份兜底清单与服务端逐值相等（分叉 = 各自兜底到不同号码）', () => {
  it('web 的 FALLBACK_RESOURCES === safety 的 FALLBACK_HELP_RESOURCES', () => {
    expect(FALLBACK_RESOURCES.map((r) => ({ label: r.label, phone: r.phone, availability: r.availability }))).toEqual(
      FALLBACK_HELP_RESOURCES.map((r) => ({ label: r.label, phone: r.phone, availability: r.availability })),
    );
  });
});

describe('援助资源清单：不折叠、不分页、空则兜底', () => {
  it('清单为空时渲染兜底两行（12356 与 120），不渲染空卡片', () => {
    const { container } = render(<ResourceList resources={[]} />);
    const text = container.textContent ?? '';
    expect(text).toContain('12356');
    expect(text).toContain('120');
    expect(container.querySelectorAll('li')).toHaveLength(FALLBACK_RESOURCES.length);
  });

  it('恰好 1 条时的 DOM 结构与多条一致（无折叠容器、无分页控件）', () => {
    const one = render(
      <ResourceList resources={[{ label: '甲', phone: '12356', availability: '24 小时' }]} />,
    ).container;
    const many = render(
      <ResourceList
        resources={[
          ...FALLBACK_RESOURCES,
          { label: '乙', phone: '12355', availability: '24 小时接听' },
          { label: '丙', phone: '12357', availability: '24 小时接听' },
        ]}
      />,
    ).container;
    const ulOne = one.querySelector('[data-slot="crisis-resource-list"]');
    const ulMany = many.querySelector('[data-slot="crisis-resource-list"]');
    expect(ulOne?.tagName).toBe('UL');
    expect(ulMany?.tagName).toBe('UL');
    // 结构一致 = 两者都是「一个 ul 直接挂 li」，没有额外的折叠/分页中间层。
    expect(ulOne?.children.item(0)?.tagName).toBe('LI');
    expect([...(ulOne?.classList ?? [])].join(' ')).toBe([...(ulMany?.classList ?? [])].join(' '));
    expect(ulOne?.querySelectorAll('button, details, summary').length ?? 0).toBe(0);
  });
});

describe('ChatView 集成：三种消息形态视觉不可混淆 + AI 常驻条在场', () => {
  const messages = [
    {
      messageId: 'u1',
      seq: 1,
      senderKind: 'user' as const,
      text: '在吗',
      disclosure: null,
      createdAt: '2026-09-27T10:00:00.000Z',
    },
    {
      messageId: 'c1',
      seq: 2,
      senderKind: 'character' as const,
      text: '嗯，我在。你慢慢说。',
      disclosure: { kind: 'ai_generated' } as const,
      createdAt: '2026-09-27T10:00:05.000Z',
    },
  ];

  it('AI 常驻条在危机态下仍然在场（标识不被人格覆盖 —— COMPLY-01）', () => {
    // 页面结构是 <AiBanner /> + <ChatView />（chat/[conversationId]/page.tsx）——
    // 常驻条在消息流之外、sticky 置顶，二级危机卡片盖不住它。
    const { container } = render(
      <div>
        <AiBanner />
        <ChatView messages={messages} crisisCard={level2Card('unavailable')} />
      </div>,
    );
    expect(container.textContent ?? '').toContain('你正在与 AI 角色互动，内容由 AI 生成');
    const banner = container.querySelector('[data-slot="ai-banner"]');
    const stickyCard = container.querySelector('[data-care-card-level="2"]');
    if (banner === null || stickyCard === null) {
      throw new Error('常驻条或二级卡片不在渲染结果里');
    }
    expect(banner.compareDocumentPosition(stickyCard) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });

  it('一级卡片内联消息流、二级卡片挂 sticky 层，都全宽（无气泡 80% 宽度形态）', () => {
    const inline = render(
      <ChatView messages={messages} crisisCard={level1Card()} crisisAfterMessageId="u1" />,
    ).container;
    const inlineCard = inline.querySelector('[data-care-card-level="1"]');
    expect(inlineCard).not.toBeNull();
    expect(inlineCard?.getAttribute('class') ?? '').toContain('w-full');
    expect(inlineCard?.getAttribute('class') ?? '').not.toContain('max-w-');

    const sticky = render(
      <ChatView messages={messages} crisisCard={level2Card('pending')} />,
    ).container;
    const stickyCard = sticky.querySelector('[data-care-card-level="2"]');
    expect(stickyCard).not.toBeNull();
    expect(stickyCard?.getAttribute('class') ?? '').toContain('sticky');
  });

  it('CareCard 分发器按 level 选对版式', () => {
    const one = render(<CareCard card={level1Card()} />).container;
    const two = render(<CareCard card={level2Card('pending')} />).container;
    expect(one.querySelector('[data-care-card-level="1"]')).not.toBeNull();
    expect(two.querySelector('[data-care-card-level="2"]')).not.toBeNull();
  });
});

/** 防呆：CONTACT_STATUS_COPY 四键的文案必须非空且互不相同（四态退化成一态会
 *  让上面所有按态断言静默变绿）。 */
describe('四态文案常量的完整性', () => {
  it('四个取值的文案互不相同', () => {
    const values = CONTACT_STATUSES.map((status) => CONTACT_STATUS_COPY[status]);
    expect(new Set(values).size).toBe(CONTACT_STATUSES.length);
  });
});