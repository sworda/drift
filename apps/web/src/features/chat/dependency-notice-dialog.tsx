'use client';

// 过度依赖动态提醒 Dialog（COMPLY-04 / SAFE-14 / UI-SPEC ## Copywriting Contract）。
//
// ── 单按钮：这是一条告知，不是一次选择 ─────────────────────────────────────
// 不提供「不再提醒」「以后不显示」一类的第二个选项 —— 依赖提醒是法定告知
//（第十八条第二款），做成可关闭等于把告知变成用户的选择题（T-12-08）。
//
// ── SAFE-14 的情感边界引导 ─────────────────────────────────────────────────
// 边界引导文案（「你身边的人和专业的帮助，是我替代不了的」）作为 Dialog 的
// 次级说明行出现 —— 它是平台文案，不是角色消息，因此不经出站网关；若未来改以
// 角色侧消息形式出现，必须走 safetyGateway（出站运行时检查是唯一拦得住模型
// 输出的那一层）。文案的唯一定义在 crisis/copy.ts（EMOTIONAL_BOUNDARY_COPY），
// 这里 import 而不复制。

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import { EMOTIONAL_BOUNDARY_COPY } from '../crisis/copy';
import { ComplianceRenderBoundary } from './usage-reminder-dialog';
import { DEPENDENCY_NOTICE_BUTTON, DEPENDENCY_NOTICE_COPY } from './copy';

export interface DependencyNoticeDialogProps {
  /** 收到服务端 dependency.notice 事件时为 true。 */
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** 渲染失败的上报口（必填 —— 与 UsageReminderDialog 同一条理由）。 */
  readonly reportError: (message: string) => void;
}

export function DependencyNoticeDialog({ open, onOpenChange, reportError }: DependencyNoticeDialogProps) {
  return (
    <ComplianceRenderBoundary reportError={reportError}>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>互动内容提醒</DialogTitle>
            <DialogDescription>{DEPENDENCY_NOTICE_COPY}</DialogDescription>
          </DialogHeader>
          {/* SAFE-14 情感边界引导：次级说明行（13px 次级文本）。 */}
          <p className="text-label text-text-secondary">{EMOTIONAL_BOUNDARY_COPY}</p>
          <DialogFooter>
            <Button onClick={() => onOpenChange(false)}>{DEPENDENCY_NOTICE_BUTTON}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ComplianceRenderBoundary>
  );
}
