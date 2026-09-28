// 角色库列表（CHAT-01 / CHAT-02）。
//
// UI-SPEC 的三条硬约束：
//   - 48px 头像 + 20px 名 + 13px 简介
//   - **列表内不放 accent**（accent 是 4 项闭合清单：主 CTA 填充、用户气泡、
//     未读数徽章、已勾选同意项。列表行不在表内）
//   - **行内不放按钮** —— 整行可点，加好友在详情页做。一行里塞一个按钮会让
//     「点行」与「点按钮」的命中区互相偷面积，在 44px 触控尺寸下尤其明显。
//
// 徽标 shrink-0 + 名字 truncate：徽标不得被过长的名字挤出〔法定〕。

import Link from 'next/link';

import { AiBadge } from '@/components/ai-badge';

export interface CharacterListItem {
  readonly id: string;
  readonly name: string;
  readonly avatar: string;
  readonly blurb: string;
  readonly isAi: boolean;
}

export interface CharacterListProps {
  readonly characters: readonly CharacterListItem[];
}

export function CharacterList({ characters }: CharacterListProps) {
  if (characters.length === 0) {
    // 空态与错误态必须可区分，**不得静默渲染成空列表**（UI-SPEC 不可协商项）。
    // 所以这里有明确文案与下一步，而不是一个什么都没有的容器。
    return (
      <p className="px-md py-lg text-body text-text-secondary">
        还没有可添加的角色。种子角色入库后会出现在这里。
      </p>
    );
  }

  return (
    <ul className="flex flex-col">
      {characters.map((character) => (
        <li key={character.id}>
          <Link
            href={`/characters/${character.id}`}
            className="flex min-w-0 items-center gap-md-tight px-md py-md-tight"
          >
            {/* 头像是静态资源标识而不是 URL —— 渲染层不绑存储层。Phase 1 用首字占位。 */}
            <span
              aria-hidden="true"
              className="flex size-12 shrink-0 items-center justify-center rounded-full bg-character-bubble text-heading text-text-primary"
            >
              {character.name.slice(0, 1)}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="flex min-w-0 items-center gap-sm">
                <span className="truncate text-heading font-semibold text-text-primary">{character.name}</span>
                {character.isAi ? <AiBadge data-testid="ai-badge-character-detail" /> : null}
              </span>
              <span className="truncate text-label text-text-secondary">{character.blurb}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
