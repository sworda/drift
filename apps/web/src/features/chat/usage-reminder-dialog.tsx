'use client';

// 2 小时时长提醒 Dialog（COMPLY-03 / UI-SPEC ## Copywriting Contract）。
//
// ── 计时权威在服务端，本组件不自设计时 ─────────────────────────────────────
// 组件只在收到服务端 usage.reminder 事件时被渲染一次（open 由父层的事件到达驱动）。
// eslint 对 chat 目录禁了那两个前端计时器调用，负向 fixture 钉住它非空真 ——
// 一个前端计时器会在刷新/重登录时清零，让「连续使用满 2 小时」永远不触发而界面
// 看不出异常（PITFALLS 点名的失效模式）。
//
// ── 渲染失败不得静默丢弃 ───────────────────────────────────────────────────
// 「提醒没弹」是一次静默的合规失效（UI-SPEC error E12 明文）。本组件用一个
// ErrorBoundary 兜住渲染失败并调用必填的 reportError —— 调用方把它接到合规事件
// 上报；没有这个边界，一次抛错会让 Dialog 悄悄不出现，而任何断言都不会红。

import { Component, type ErrorInfo, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import { USAGE_REMINDER_COPY, USAGE_REMINDER_PRIMARY, USAGE_REMINDER_SECONDARY } from './copy';

/**
 * 合规渲染边界：渲染失败时上报而不是静默消失。
 *
 * 独立导出而不是藏在 Dialog 里 —— 它的契约（抛错 ⇒ reportError 被调、正常 ⇒
 * children 原样渲染）由 RTL 测试直接钉住，两个提醒 Dialog 共用同一个边界。
 */
export class ComplianceRenderBoundary extends Component<
  { readonly reportError: (message: string) => void; readonly children: ReactNode },
  { readonly hasError: boolean }
> {
  override state = { hasError: false };

  static getDerivedStateFromError(): { readonly hasError: boolean } {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, _info: ErrorInfo): void {
    // 只上报错误名，不上报 message —— message 可能携带触发渲染的输入。
    this.props.reportError(`dialog_render_failed:${error.name}`);
  }

  override render(): ReactNode {
    return this.state.hasError ? null : this.props.children;
  }
}

export interface UsageReminderDialogProps {
  /** 收到服务端 usage.reminder 事件时为 true；任一按钮或遮罩关闭后由父层置回。 */
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** 渲染失败的上报口（必填 —— 可选等于允许静默丢弃一次合规告知）。 */
  readonly reportError: (message: string) => void;
}

export function UsageReminderDialog({ open, onOpenChange, reportError }: UsageReminderDialogProps) {
  return (
    <ComplianceRenderBoundary reportError={reportError}>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>使用时长提醒</DialogTitle>
            <DialogDescription>{USAGE_REMINDER_COPY}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            {/* 次按钮为 neutral 文字按钮（ghost，不吃 accent）—— UI-SPEC 明文。 */}
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              {USAGE_REMINDER_SECONDARY}
            </Button>
            <Button onClick={() => onOpenChange(false)}>{USAGE_REMINDER_PRIMARY}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ComplianceRenderBoundary>
  );
}
