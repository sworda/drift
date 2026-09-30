// 删除回执的 RTL 断言（PRIV-05 / Q1 / UI-SPEC 视觉锚点契约）。
//
// ⚠️ 本文件住在 apps/web（react 只装在 apps/web，01-09 先例）。
//
// 断言集（PLAN Task 2 的 acceptance）：
//   · 成功态首读元素是「已删除完成」（text-display 28px）
//   · 「共清除 N 处」摘要行 sticky；逐项清单每项带行数与时间戳
//   · 审计去标识化行**单列**（receipt-deidentified 区，不混进已清除清单），
//     文案含「不计入上面的」
//   · 部分失败：DOM 中**不出现**「已删除完成」；含「这部分数据仍然存在」与
//     三个出路（重试 / 导出留副本 / 提交申诉）

// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { DeletionReceipt, type ReceiptData } from '@/features/privacy/receipt';

afterEach(() => {
  cleanup();
});

const COMPLETE: ReceiptData = {
  status: 'complete',
  clearedCount: 16,
  failedCount: 0,
  items: [
    { id: 'audit.safety_event', label: '安全事件记录（已去除可识别信息，保留合规所需的事件记录）', ok: true, rows: 2, at: '2026-09-27T10:00:00.000Z', deidentified: true },
    { id: 'audit.privacy_action', label: '隐私操作记录（已去除可识别信息，保留合规所需的事件记录）', ok: true, rows: 3, at: '2026-09-27T10:00:00.000Z', deidentified: true },
    { id: 'message', label: '聊天消息', ok: true, rows: 42, at: '2026-09-27T10:00:01.000Z', deidentified: false },
    { id: 'account', label: '登录凭证', ok: true, rows: 1, at: '2026-09-27T10:00:02.000Z', deidentified: false },
  ],
  deletedAt: '2026-09-27T10:00:03.000Z',
};

const PARTIAL: ReceiptData = {
  ...COMPLETE,
  status: 'partial',
  clearedCount: 15,
  failedCount: 1,
  items: [
    ...COMPLETE.items,
    { id: 'emergency_contact', label: '紧急联系人', ok: false, rows: 0, at: '2026-09-27T10:00:04.000Z', deidentified: false },
  ],
};

describe('DeletionReceipt 成功态', () => {
  it('首读元素是「已删除完成」（Display 28px 的独立呈现）', () => {
    render(<DeletionReceipt receipt={COMPLETE} />);
    const heading = screen.getByTestId('receipt-heading');
    expect(heading.textContent).toBe('已删除完成');
    expect(heading.className).toContain('text-display');
  });

  it('「共清除 N 处」摘要 sticky；每项带行数与时间戳', () => {
    render(<DeletionReceipt receipt={COMPLETE} />);
    const summary = screen.getByTestId('receipt-summary');
    expect(summary.textContent).toContain('共清除 16 处存储位置');
    expect(summary.className).toContain('sticky');
    const items = screen.getAllByTestId('receipt-item');
    expect(items.length).toBe(2); // 已清除区：去标识化项不在这里（单列在别处）。
    expect(items[0]?.textContent).toContain('42 行');
    expect(items[0]?.textContent).toContain('2026-09-27T10:00:01.000Z');
  });

  it('审计去标识化行单列，文案含「不计入上面的」，不混进已清除清单', () => {
    render(<DeletionReceipt receipt={COMPLETE} />);
    const deidentified = screen.getByTestId('receipt-deidentified');
    expect(deidentified.textContent).toContain('不计入上面的 16');
    expect(deidentified.textContent).toContain('已去除可识别信息');
    // 单列的呈现义务：两个去标识化项聚在这一区，而不在 receipt-items 清单里。
    expect(deidentified.textContent).toContain('安全事件记录');
    expect(deidentified.textContent).toContain('隐私操作记录');
    expect(screen.getAllByTestId('receipt-item').map((node) => node.textContent)).not.toContain(
      expect.stringContaining('已去除可识别信息'),
    );
  });

  it('回执可导出（导出回执按钮在场）', () => {
    render(<DeletionReceipt receipt={COMPLETE} />);
    expect(screen.getByTestId('receipt-export').textContent).toBe('导出回执');
  });
});

describe('DeletionReceipt 部分失败态（M/N，禁止四舍五入）', () => {
  it('DOM 中不出现「已删除完成」；含「这部分数据仍然存在」与三个出路', () => {
    render(<DeletionReceipt receipt={PARTIAL} />);
    expect(screen.queryByTestId('receipt-heading')).toBeNull();
    expect(screen.queryByText('已删除完成')).toBeNull();
    const copy = screen.getByTestId('receipt-partial-copy');
    expect(copy.textContent).toContain('已清除 15 处存储位置');
    expect(copy.textContent).toContain('还有 1 处没能清除');
    expect(copy.textContent).toContain('这部分数据仍然存在');
    // 三个出路：重试 / 导出留副本 / 提交申诉。
    expect(screen.getByTestId('partial-retry').textContent).toBe('再试一次');
    expect(screen.getByTestId('partial-export').textContent).toBe('先导出一份副本');
    expect(screen.getByTestId('partial-appeal').textContent).toBe('提交申诉');
  });

  it('未能清除的项在清单里如实标注，不显示行数', () => {
    render(<DeletionReceipt receipt={PARTIAL} />);
    const items = screen.getAllByTestId('receipt-item');
    const failed = items.find((node) => node.textContent?.includes('紧急联系人'));
    expect(failed?.textContent).toContain('（未能清除）');
    expect(failed?.textContent).not.toContain('0 行');
  });
});
