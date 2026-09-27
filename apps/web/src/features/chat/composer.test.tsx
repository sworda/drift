// @vitest-environment jsdom

// Composer 与 EmojiPicker 的 RTL 契约断言（CHAT-03/04 · UI-SPEC E5 / 无障碍名称行）。

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Composer } from './composer';
import { EmojiPicker, EMOJI_TRIGGER_LABEL } from './emoji-picker';
import { COMPOSER_PLACEHOLDER, SEND_LABEL } from './copy';

afterEach(() => {
  cleanup();
});

describe('Composer（E5）', () => {
  it('占位符「说点什么…」；发送控件可访问名称为「发送」', () => {
    render(<Composer onSend={async () => true} />);
    expect(screen.getByPlaceholderText(COMPOSER_PLACEHOLDER)).toBeDefined();
    expect(screen.getByRole('button', { name: SEND_LABEL })).toBeDefined();
  });

  it('空输入时发送禁用（Neutral non-text 图标色、不承载文字）；有输入后启用（accent）', () => {
    render(<Composer onSend={async () => true} />);
    const send = screen.getByTestId('composer-send');
    expect((send as HTMLButtonElement).disabled).toBe(true);
    // 禁用态图标色 = Neutral non-text（#94A3B8，禁止承载文字 —— 按钮里没有任何文字）。
    expect(send.className).toContain('text-neutral-nontext');
    expect(send.textContent ?? '').toBe('');

    fireEvent.input(screen.getByTestId('composer-input'), { target: { value: '在吗？' } });
    const enabled = screen.getByTestId('composer-send');
    expect((enabled as HTMLButtonElement).disabled).toBe(false);
    expect(enabled.className).toContain('bg-primary');
  });

  it('onSend 受理（true）才清空；失败（false）内容保留可重试', async () => {
    let accept = false;
    const onSend = vi.fn(async () => accept);
    render(<Composer onSend={onSend} />);
    const input = screen.getByTestId('composer-input');
    fireEvent.input(input, { target: { value: '第一条' } });
    fireEvent.click(screen.getByTestId('composer-send'));
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect((input as HTMLTextAreaElement).value).toBe('第一条'); // 未受理，不清空

    accept = true;
    fireEvent.click(screen.getByTestId('composer-send'));
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(2));
    expect((input as HTMLTextAreaElement).value).toBe(''); // 受理，清空
  });

  it('textarea 的高度封顶（max-h 类在场）—— 自增高不把常驻条挤出首屏的前提', () => {
    render(<Composer onSend={async () => true} />);
    expect(screen.getByTestId('composer-input').className).toContain('max-h-[140px]');
  });

  it('四个 icon-only 控件之一：插入表情按钮带可编程确定的名称（非 tooltip）', () => {
    render(<EmojiPicker variant="popover" onPick={() => undefined} />);
    const trigger = screen.getByRole('button', { name: EMOJI_TRIGGER_LABEL });
    expect(trigger.textContent ?? '').not.toContain(EMOJI_TRIGGER_LABEL); // 名称不在可见文字里
  });

  it('选择表情回调收到该 emoji（Sheet 容器，Radix portal 也可查询）', async () => {
    const onPick = vi.fn();
    render(<EmojiPicker variant="sheet" onPick={onPick} />);
    fireEvent.click(screen.getByRole('button', { name: EMOJI_TRIGGER_LABEL }));
    const emoji = await waitFor(() => screen.getByText('😀'));
    fireEvent.click(emoji);
    expect(onPick).toHaveBeenCalledWith('😀');
  });
});
