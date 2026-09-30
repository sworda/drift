'use client';

// 表情选择器（CHAT-04）—— v1 仅 Unicode emoji，无自定义表情包、无表情库依赖
//（T-14-SC：不引入任何未核验包；Unicode 字符是运行时内建）。
//
// 移动端用 Sheet、桌面用 Popover（UI-SPEC ## 交互契约 表情行）。判定 pointer:
// coarse = 触屏。触发按钮的可访问名称为「插入表情」（四个 icon-only 控件之一，
// tooltip 不作为唯一来源 —— 这里根本没有 tooltip）。

import { useEffect, useState } from 'react';
import { Smile } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';

/** v1 表情集：常用 Unicode emoji 的一个固定子集（列宽 8 的网格）。 */
export const EMOJI_SET = [
  '😀', '😄', '😊', '🥰', '😜', '🤔', '😭', '😅',
  '😉', '😍', '🤗', '😴', '🙄', '😤', '😢', '🙃',
  '🌷', '🌸', '🍀', '⭐', '🌙', '☀️', '🔥', '❄️',
  '☕', '🍵', '🍚', '🍜', '🎂', '🍎', '📖', '🎵',
  '👍', '🤝', '🙏', '💪', '❤️', '💕', '✨', '🫂',
] as const;

/** 触发按钮的可访问名称（UI-SPEC ## 交互契约 无障碍名称行，逐字）。 */
export const EMOJI_TRIGGER_LABEL = '插入表情';

export interface EmojiPickerProps {
  readonly onPick: (emoji: string) => void;
  /** 覆写容器形态（测试用）；缺省按触屏判定。 */
  readonly variant?: 'sheet' | 'popover' | undefined;
  readonly disabled?: boolean | undefined;
}

function EmojiGrid({ onPick }: { readonly onPick: (emoji: string) => void }) {
  return (
    <div className="grid grid-cols-8 gap-xs" data-testid="emoji-grid">
      {EMOJI_SET.map((emoji) => (
        <button
          key={emoji}
          type="button"
          className="flex size-touch items-center justify-center rounded-lg text-xl"
          onClick={() => onPick(emoji)}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

export function EmojiPicker({ onPick, variant, disabled = false }: EmojiPickerProps) {
  const [isTouch, setIsTouch] = useState(false);
  useEffect(() => {
    setIsTouch(window.matchMedia('(pointer: coarse)').matches);
  }, []);

  const useSheet = (variant ?? (isTouch ? 'sheet' : 'popover')) === 'sheet';

  if (useSheet) {
    return (
      <Sheet>
        <SheetTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={EMOJI_TRIGGER_LABEL}
            data-testid="emoji-trigger"
            disabled={disabled}
            className="size-touch"
          >
            <Smile aria-hidden="true" className="size-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="bottom">
          <SheetHeader>
            <SheetTitle>表情</SheetTitle>
          </SheetHeader>
          <EmojiGrid onPick={onPick} />
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={EMOJI_TRIGGER_LABEL}
          data-testid="emoji-trigger"
          disabled={disabled}
          className="size-touch"
        >
          <Smile aria-hidden="true" className="size-5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent>
        <EmojiGrid onPick={onPick} />
      </PopoverContent>
    </Popover>
  );
}
