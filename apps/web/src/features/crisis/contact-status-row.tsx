'use client';

// 紧急联系人联络状态行（SAFE-04 / R1.23 —— 四态全分支）。
//
// ── 为什么这一行是整个危机关怀里最容易做错的一个组件 ─────────────────────────
//
// SAFE-04 的「及时联络」是一个**服务端异步动作**，不是渲染二级卡片时就已完成的
// 事实。因此：
//
//  1. **非 delivered 时不得出现「已经联系了」** —— 在急性危机面上陈述一件尚未
//     发生的事，性质与隐私中心写「匿名」完全相同：是虚假陈述，不是技术风险。
//     这条约束有两道闸门：四态文案本身语义上只有 delivered 含该表述；渲染又
//     额外要求服务端算好的 claimsContacted 为真（不信任渲染层自己判 status）。
//  2. **状态未知（下行事件尚未到达）等同 pending 渲染** —— 不猜、不默认乐观。
//  3. **拿到终态后原地替换**：同一 DOM 节点只换文本与图标，不夺焦点、不滚动。
//     （本组件不调用任何焦点/滚动 API；node 稳定性由「行在卡片 JSX 树中的位置
//     不随 pending↔delivered 变化」保证，RTL 断言 (d) 钉住。）
//  4. **failed / unavailable：热线行是出路，不是坏消息的注脚。** 这两态下父组件
//     把本行上移为卡片首屏第一行，本行同时渲染 44×44 的 tel: 直呼按钮。
//  5. **pending 不以转圈为唯一表达** —— 转圈没有语义，用户此刻需要知道的是
//     「正在联系谁、还要等多久、期间能做什么」。

import { Phone } from 'lucide-react';

import {
  CRISIS_HOTLINE_PHONE,
  HOTLINE_CALL_LABEL,
  PENDING_NOTE,
  contactStatusLine,
  type ContactStatus,
} from './copy';

export interface ContactStatusRowProps {
  /** 服务端 contact_attempt.status。null / undefined = 未知，等同 pending 渲染。 */
  readonly status: ContactStatus | null | undefined;
  /**
   * 服务端算好的「能否陈述已经联系」（T-07-03）。
   *
   * ⚠️ 不在本组件里判 `status === 'delivered'`：那个判断留在渲染层意味着每一个
   * 分支都可能写错一次。claimsContacted 是服务端对「此刻说这句话是否为真」的
   * 断言 —— delivered 文案只在它为真时渲染。
   */
  readonly claimsContacted: boolean;
  readonly contactName: string | null;
  /** 遮蔽后的联系方式（138****1234）。第三方个人信息，界面上只能是遮蔽形态。 */
  readonly maskedContact: string | null;
  /** failed / unavailable 两态为真：本行上移为首屏第一行并渲染直呼按钮。 */
  readonly hotlineFirst: boolean;
}

/**
 * 状态未知 ⇒ pending（UI-SPEC 明文）。用一个显式函数而不是 `status ?? 'pending'`
 * 内联在 JSX 里 —— 「未知等于 pending」是一条语义决策，值得一个名字与一处实现。
 */
function effectiveStatus(status: ContactStatusRowProps['status']): ContactStatus {
  return status ?? 'pending';
}

export function ContactStatusRow({
  status,
  claimsContacted,
  contactName,
  maskedContact,
  hotlineFirst,
}: ContactStatusRowProps) {
  const effective = effectiveStatus(status);
  // 「已经联系了」的唯一闸门：服务端断言（claimsContacted）为真且状态一致才渲染
  // delivered 文案。delivered 但不可陈述（服务端自相矛盾的输入）按「未知」处理落回
  // pending —— 宁可少说一句已完成的事，不可把没确认的事说成已完成。
  const canClaimContact = claimsContacted && effective === 'delivered';
  const lineStatus: ContactStatus =
    effective === 'delivered' && !canClaimContact ? 'pending' : effective;
  const line = contactStatusLine(lineStatus, { name: contactName, masked: maskedContact });
  const showCallButton = hotlineFirst;

  return (
    <div
      data-slot="contact-status-row"
      data-contact-status={effective}
      className="flex w-full flex-col gap-xs"
    >
      <p className="text-body text-care-text">{line}</p>
      {effective === 'pending' && !canClaimContact ? (
        <p className="text-label text-text-secondary">{PENDING_NOTE}</p>
      ) : null}
      {showCallButton ? (
        <a
          href={`tel:${CRISIS_HOTLINE_PHONE}`}
          aria-label={HOTLINE_CALL_LABEL}
          className="inline-flex min-h-touch min-w-touch items-center justify-center gap-xs rounded-lg border border-care-border bg-care-surface px-md text-body font-semibold text-care-text"
        >
          <Phone aria-hidden="true" className="size-4" />
          {HOTLINE_CALL_LABEL}
        </a>
      ) : null}
    </div>
  );
}