// 删除回执 —— 独立页面（不是 toast），PRIV-05 的呈现义务全部在这里。
//
// ── 数量的诚实口径（D-19 / Q1）──────────────────────────────────────────────
//   ·「共清除 N 处」= 服务端回执的 clearedCount（purge 成功执行且不计去标识化的
//     项数）—— 组件**不重算**这个数。前端重算等于给虚假陈述开了一个第二现场。
//   · 审计去标识化行**单列**（不混进逐项清单的「已清除」区），文案含「不计入上面
//     的 N」—— 回执说清除而实际保留，是一次需要显式披露的事（Q1）。
//   · 部分失败（status === 'partial'）**禁止**渲染「已删除完成」：改渲染 M/N 与
//     三个出路（重试 / 导出留副本 / 提交申诉）。四舍五入成成功是 T-11-06 的威胁。
//
// ⚠️ 回执可导出（UI-SPEC 删除回执行）：导出的是回执本身（表名、行数、时间戳），
// 不是对话副本 —— 用浏览器打印（window.print）承接，零新依赖。

'use client';

import {
  DELETE_PARTIAL_COPY,
  PARTIAL_APPEAL_LABEL,
  PARTIAL_EXPORT_LABEL,
  PARTIAL_RETRY_LABEL,
  RECEIPT_AUDIT_NOTE,
  RECEIPT_EXPORT_LABEL,
  RECEIPT_HEADING,
  RECEIPT_LIST_MAX_HEIGHT,
  RECEIPT_SUMMARY,
} from './copy';

/** 回执数据的本地视图（服务端 DeletionReceiptPayload 的 JSON 形状）。 */
export interface ReceiptData {
  readonly status: 'complete' | 'partial';
  readonly clearedCount: number;
  readonly failedCount: number;
  readonly items: readonly {
    readonly id: string;
    readonly label: string;
    readonly ok: boolean;
    readonly rows: number;
    readonly at: string;
    readonly deidentified: boolean;
  }[];
  readonly deletedAt: string;
}

export interface DeletionReceiptProps {
  readonly receipt: ReceiptData;
  /** 部分失败的重试出路（回到删除入口）。 */
  readonly onRetry?: () => void;
  /** 「先导出一份副本」出路（跳到导出分区）。 */
  readonly onExportCopy?: () => void;
}

/** ** 剥离（UI-SPEC 文案里的加粗标记；界面用 strong 语义另行加强）。 */
function plain(copy: string): string {
  return copy.replace(/\*\*/gu, '');
}

export function DeletionReceipt({ receipt, onRetry, onExportCopy }: DeletionReceiptProps) {
  const partial = receipt.status === 'partial';
  const clearedItems = receipt.items.filter((item) => !item.deidentified);
  const deidentifiedItems = receipt.items.filter((item) => item.deidentified);

  return (
    <main className="mx-auto min-h-dvh w-full max-w-[480px] md:max-w-[640px] lg:max-w-[720px] px-md pb-lg">
      {partial ? (
        <>
          {/* 部分失败：**禁止**渲染「已删除完成」—— 如实分列 M/N。 */}
          <h1 className="pt-lg text-display font-semibold text-text-primary" data-testid="receipt-partial-heading">
            删除没有全部完成
          </h1>
          <p className="mt-md whitespace-normal break-words text-body leading-relaxed text-destructive" data-testid="receipt-partial-copy">
            {plain(DELETE_PARTIAL_COPY(receipt.clearedCount, receipt.failedCount))}
          </p>
          <div className="mt-lg flex flex-col gap-sm">
            <button type="button" data-testid="partial-retry" className="h-11 rounded-lg border border-border px-md text-label font-medium text-text-primary hover:bg-muted" onClick={onRetry}>
              {PARTIAL_RETRY_LABEL}
            </button>
            <button type="button" data-testid="partial-export" className="h-11 rounded-lg border border-border px-md text-label text-text-secondary hover:bg-muted" onClick={onExportCopy}>
              {PARTIAL_EXPORT_LABEL}
            </button>
            <button type="button" data-testid="partial-appeal" className="h-11 rounded-lg border border-border px-md text-label text-text-secondary hover:bg-muted">
              {PARTIAL_APPEAL_LABEL}
            </button>
          </div>
        </>
      ) : (
        <>
          {/* 首读元素（UI-SPEC 视觉锚点契约：Display 28px，独立页面）。 */}
          <h1 className="pt-lg text-display font-semibold text-text-primary" data-testid="receipt-heading">
            {RECEIPT_HEADING}
          </h1>
          {/* 「共清除 N 处」摘要行 sticky —— 清单滚动时数量始终可见。 */}
          <p className="sticky top-0 z-10 mt-md bg-background py-sm whitespace-normal break-words text-body font-semibold text-text-primary" data-testid="receipt-summary">
            {plain(RECEIPT_SUMMARY(receipt.clearedCount))}
          </p>
        </>
      )}

      {/* 逐项清单：可纵向滚动；每一项都带行数与时间戳（N 与细节都诚实）。 */}
      <ul className={`mt-sm divide-y divide-border overflow-y-auto ${RECEIPT_LIST_MAX_HEIGHT}`} data-testid="receipt-items">
        {clearedItems.map((item) => (
          <li key={item.id} className="flex items-baseline justify-between gap-md py-sm" data-testid="receipt-item">
            <span className={`text-label ${item.ok ? 'text-text-primary' : 'text-destructive font-medium'}`}>
              {item.label}
              {item.ok ? null : '（未能清除）'}
            </span>
            <span className="shrink-0 text-label text-text-secondary">
              {item.ok ? `${String(item.rows)} 行 · ${item.at}` : item.at}
            </span>
          </li>
        ))}
      </ul>

      {/* 审计去标识化行：**单列**，不计入上面的 N（Q1 裁决的呈现义务）。 */}
      {deidentifiedItems.length > 0 ? (
        <div className="mt-md rounded-lg border border-border bg-card px-md py-sm" data-testid="receipt-deidentified">
          <p className="whitespace-normal break-words text-label leading-relaxed text-text-secondary">
            {plain(RECEIPT_AUDIT_NOTE(receipt.clearedCount))}
          </p>
          <p className="mt-xs text-label leading-relaxed text-text-secondary">
            保留的记录：{deidentifiedItems.map((item) => item.label.replace(/（已去除可识别信息，保留合规所需的事件记录）/u, '')).join('、')}。
          </p>
        </div>
      ) : null}

      <p className="mt-md text-label text-text-secondary" data-testid="receipt-deleted-at">
        删除执行时间：{receipt.deletedAt}
      </p>

      <button
        type="button"
        className="mt-lg h-11 rounded-lg border border-border px-md text-label font-medium text-text-primary hover:bg-muted"
        onClick={() => window.print()}
        data-testid="receipt-export"
      >
        {RECEIPT_EXPORT_LABEL}
      </button>
    </main>
  );
}
