'use client';

// 聊天页「更多」菜单（CHAT-04 / COMPLY-05）—— 第十九条「窗口操作」退出途径的
// 显式入口。
//
// ⚠️ 点击「结束本次会话」**直接执行**，没有「确定要离开吗」二次确认 ——
// UI-SPEC ## 硬退出呈现契约明文禁止。退出不需要挽留，也不需要确认：用户在
// 这里的意图已经完全明确，一次确认只是把离开变成一次心理成本。

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';

import { END_SESSION_LABEL } from './copy';

export interface ChatMoreSheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** 「结束本次会话」被点击：调用方负责 POST /conversations/:id/exit 与错误处理。 */
  readonly onEndSession: () => void;
}

export function ChatMoreSheet({ open, onOpenChange, onEndSession }: ChatMoreSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom">
        <SheetHeader>
          <SheetTitle>更多</SheetTitle>
        </SheetHeader>
        <div className="flex flex-col gap-sm">
          <Button
            variant="outline"
            data-testid="end-session-item"
            onClick={() => {
              onOpenChange(false);
              onEndSession();
            }}
          >
            {END_SESSION_LABEL}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
