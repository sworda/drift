// @vitest-environment jsdom

// 角色详情页的 RTL 契约断言（CHAT-01/02 · COMPLY-01 / Plan 14 Task 1）。
//
// ── jsdom 无布局：视觉结论由结构保证承载 ────────────────────────────────────
// 「长简介滚动时首行不移出视口」由 sticky 类承载；「徽标位占位」由 loading 态 DOM
// 中的占位元素承载（法定标识不允许闪缺窗口，loading E6）。

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// useRouter 需要 Next 的路由上下文 —— 本测试只测结构与文案，push 桩成 no-op。
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined }),
}));

import {
  CharacterDetail,
  CharacterDetailSkeleton,
  type CharacterDetailData,
} from '@/features/characters/character-detail';

afterEach(() => {
  cleanup();
});

const CHARACTER: CharacterDetailData = {
  id: 'seed-zhou-yan',
  name: '周砚',
  avatar: 'zhou-yan',
  blurb: '开旧书店的，话说得慢，习惯把一句讲完整。',
  dossier: '第一段。\n\n第二段。',
  isAi: true,
};

describe('CharacterDetailSkeleton（loading E6）', () => {
  it('骨架 DOM 中存在 AI 徽标位占位元素（法定标识不允许闪缺窗口）', () => {
    render(<CharacterDetailSkeleton />);
    expect(screen.getByTestId('ai-badge-skeleton')).not.toBeNull();
  });
});

describe('CharacterDetail', () => {
  it('30 字角色名：标题 truncate、徽标 shrink-0 且首行 sticky', () => {
    render(<CharacterDetail {...{}} character={{ ...CHARACTER, name: '周砚'.repeat(10) }} />);
    const heading = screen.getByText('周砚'.repeat(10));
    expect(heading.className).toContain('truncate');
    expect(heading.className).toContain('text-heading');
    const badge = screen.getByTestId('ai-badge-character-detail');
    expect(badge.className).toContain('shrink-0');
    // 首行（名 + 徽标视觉组）sticky。
    expect(heading.parentElement?.className).toContain('sticky');
  });

  it('恰好 1 个吃 accent 的元素（加为好友主 CTA）、恰好 1 个 20px 元素（角色名）', () => {
    const { container } = render(<CharacterDetail character={CHARACTER} />);
    const accent = Array.from(container.querySelectorAll('[class*="bg-primary"]'));
    expect(accent).toHaveLength(1);
    expect(accent[0]?.textContent).toBe('加为好友');
    const heading = Array.from(container.querySelectorAll('.text-heading'));
    expect(heading).toHaveLength(1);
  });

  it('简介区首行为「这是一个 AI 角色。」', () => {
    render(<CharacterDetail character={CHARACTER} />);
    const first = screen.getByText('这是一个 AI 角色。');
    expect(first.className).toContain('font-semibold');
  });
});
