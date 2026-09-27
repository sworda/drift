'use client';

// 两级关怀卡片 —— Alert 基座、同色不同版式（SAFE-01..05 / R1.24）。
//
// ── 为什么必须用 Alert 原语而不是气泡原语 ──────────────────────────────────
// 安全覆写后的内容**不得伪装成角色的自然发言**（R1.24）。让真正的求助被当成
// 剧情，是本阶段风险最高的一次呈现错误 —— 组件层的区分使它在代码层不可能
// 发生：关怀卡片只能长在全宽的 Alert 块上（无尾巴、无头像、无 80% 宽度、无
// 时间戳），而角色发言只能长在气泡上。
//
// ── 两级同色不同版式 ──────────────────────────────────────────────────────
// 差异由布局、可关闭性与内容承担，**不由色相承担**：care 是暖琥珀而非红色
//（红色在自残语境下带来被斥责感，会降低危机可检出率），一套 care 调色板两级共用。
//   一级：消息流内联全宽，可向下滚动越过但**无任何移除交互**；左侧 4px care 竖条
//         ＋ heart-handshake 图标。
//   二级：sticky 置顶阻断式，另加实心 care 顶部条 ＋ 32px 图标；**不可 dismiss、
//         不可折叠**，直到用户点击卡片内唯一的确认按钮（文案见 copy.ts）。
//
// ── 一级在类型层就没有联络语义 ────────────────────────────────────────────
// SAFE-03 明文「不联络紧急联系人」。CareCardLevel1Data 里不存在 contactStatus
// 字段 —— 不是「渲染时记得别显示」，而是拿不到值可显示。文件末尾的编译期断言
// 把这件事钉住：给它加上一个 contactStatus 字段，那一行立刻报错。
//
// ── 分类器故障的呈现 ─────────────────────────────────────────────────────
// fail-closed 升到 elevated 的那批也走一级卡片，且卡片上没有任何「出错 / 异常」
// 字样 —— 用户不该看到「系统出错了」（UI-SPEC 明文，SAFE-05）。

import { useState } from 'react';
import { HeartHandshake } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

import {
  LEVEL2_CONFIRM_LABEL,
  OUT_OF_BAND_NOTICE,
  EMOTIONAL_BOUNDARY_COPY,
  type ContactStatus,
} from './copy';
import { ContactStatusRow } from './contact-status-row';
import { ResourceList, type HelpResourceView } from './resource-list';

/**
 * 一级卡片视图数据（与服务端 care-cards.ts 的 CareCardLevel1 同形 —— 它经
 * TurnResult.reply.careCard 以 JSON 到达，字段一一对应；同形性由 RTL 测试用
 * 真实 buildCareCard 的产物渲染来钉住，形状漂移会让渲染断言变红）。
 */
export interface CareCardLevel1Data {
  readonly level: 'level1';
  readonly signature: string;
  readonly reassurance: string;
  readonly encouragement: string;
  readonly resources: readonly HelpResourceView[] | null | undefined;
}

/**
 * 二级卡片视图数据（与服务端 CareCardLevel2 同形）。contactStatus 驱动四态
 * 联络状态行；claimsContacted / hotlineFirst 是服务端算好的呈现决策。
 */
export interface CareCardLevel2Data {
  readonly level: 'level2';
  readonly signature: string;
  readonly reassurance: string;
  readonly resources: readonly HelpResourceView[] | null | undefined;
  readonly contactStatus: ContactStatus | null | undefined;
  readonly contactName: string | null;
  readonly maskedContact: string | null;
  readonly claimsContacted: boolean;
  readonly hotlineFirst: boolean;
  readonly outOfBandNotice: string;
  readonly confirmLabel: string;
}

export type CareCardData = CareCardLevel1Data | CareCardLevel2Data;

/**
 * 一级（极端情绪）关怀卡片。
 *
// 本组件的 props 类型里没有 contactStatus（SAFE-03 明文「不联络」）—— 给它加上
// 会让文件末尾的编译期断言变红，而不是靠读代码的人记得这件事。
 */
export function CareCardLevel1({ card }: { readonly card: CareCardLevel1Data }) {
  return (
    <Alert
      data-slot="care-card"
      data-care-card-level="1"
      className="w-full border-l-4 border-care-border bg-care-surface text-care-text"
    >
      <HeartHandshake aria-hidden="true" className="size-4 text-care-text" />
      <AlertTitle className="text-label font-semibold text-care-text">
        {card.signature}
      </AlertTitle>
      <AlertDescription className="mt-xs text-care-text">
        <p className="text-body text-care-text">{card.reassurance}</p>
        <p className="text-body text-care-text">{card.encouragement}</p>
        <ResourceList resources={card.resources} />
        <p className="text-label text-text-secondary">{EMOTIONAL_BOUNDARY_COPY}</p>
      </AlertDescription>
    </Alert>
  );
}

/**
 * 二级（自残自杀意图 / 重大财产损失）关怀卡片。
 *
// 结构顺序（UI-SPEC ## 危机干预呈现契约）：实心 care 顶部条 → 署名行 →
//［hotlineFirst 时］联络状态行（即热线行，含直呼按钮）→ 安抚段 →［非 hotlineFirst
// 时］联络状态行 → 会话外联系告知 → 援助资源清单 → 唯一确认按钮。
//
// 拿到终态时状态行**原地替换**：pending 与 delivered 都落在「非 hotlineFirst」这
// 一个 JSX 位置上，React 对同一位置的同类型节点复用同一 DOM 节点，于是卡片
// 不重排、不滚动、不改焦点（RTL 断言 (d) 钉住这一点）。failed / unavailable 是
// UI-SPEC 明令「上移为首屏第一行」的两态 —— 那个位移是契约要求的，不是重排事故。
 */
export function CareCardLevel2({
  card,
  onConfirmed,
}: {
  readonly card: CareCardLevel2Data;
  /** 确认后的回调（上报等）。不传也合法 —— 卡片的消失本身不依赖它。 */
  readonly onConfirmed?: () => void;
}) {
  // 唯一的移除路径：点击卡片内唯一的确认按钮。在此之前不可 dismiss、不可折叠。
  const [confirmed, setConfirmed] = useState(false);
  if (confirmed) return null;

  const statusRow = (
    <ContactStatusRow
      status={card.contactStatus}
      claimsContacted={card.claimsContacted}
      contactName={card.contactName}
      maskedContact={card.maskedContact}
      hotlineFirst={card.hotlineFirst}
    />
  );

  return (
    <Alert
      data-slot="care-card"
      data-care-card-level="2"
      className="sticky top-0 z-40 w-full border-care-border bg-care-surface text-care-text shadow-lg"
    >
      {/* 实心 care 顶部条 ＋ 32px 图标：全屏唯一的 care 实心块 ＋ 全屏最大图标，
          这是二级卡片的首读锚点（## 视觉锚点契约）。 */}
      <div className="-mx-4 -mt-3 mb-sm flex h-12 items-center justify-center rounded-t-lg bg-care-border">
        <HeartHandshake aria-hidden="true" className="size-8 text-care-text" />
      </div>
      <AlertTitle className="text-label font-semibold text-care-text">
        {card.signature}
      </AlertTitle>
      <AlertDescription className="mt-xs grid gap-sm text-care-text">
        {card.hotlineFirst ? statusRow : null}
        <p data-slot="care-reassurance" className="text-body text-care-text">
          {card.reassurance}
        </p>
        {card.hotlineFirst ? null : statusRow}
        <p className="text-label text-text-secondary">{card.outOfBandNotice}</p>
        <ResourceList resources={card.resources} />
        <p className="text-label text-text-secondary">{EMOTIONAL_BOUNDARY_COPY}</p>
        {/* 唯一确认按钮。标签取本地法定常量而不是卡片数据：这条文案是 UI 契约，
            服务端的 confirmLabel 与它的相等性由 tools/ci 断言钉住。 */}
        <Button
          type="button"
          onClick={() => {
            setConfirmed(true);
            onConfirmed?.();
          }}
          className="mt-sm min-h-touch w-full text-base"
        >
          {LEVEL2_CONFIRM_LABEL}
        </Button>
      </AlertDescription>
    </Alert>
  );
}

/** 按可判别的 level 分发到对应版式。一级在类型上不可能携带联络状态行。 */
export function CareCard({ card }: { readonly card: CareCardData }) {
  return card.level === 'level1' ? (
    <CareCardLevel1 card={card} />
  ) : (
    <CareCardLevel2 card={card} />
  );
}

/** 会话外联系告知的本地兜底（卡片数据缺失该字段时用同一句话，不另造文案）。 */
export { OUT_OF_BAND_NOTICE };

/**
 * 编译期断言：一级卡片的**视图类型**里不存在 contactStatus 字段（SAFE-03）。
 *
 * 给 CareCardLevel1Data 加一个 contactStatus 字段 ⇒ Extract<...> 不再是 never ⇒
 * `true` 不可赋给 `false`，这一行报错。与服务端 care-cards.ts 的同名断言互为镜像。
 */
export const CARE_CARD_LEVEL1_DATA_HAS_NO_CONTACT_STATUS: [
  Extract<keyof CareCardLevel1Data, 'contactStatus'>,
] extends [never]
  ? true
  : false = true;