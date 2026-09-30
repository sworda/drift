// 一键删除的入口与执行流程（PRIV-05 / UI-SPEC 交互契约「一键删除」行）。
//
// ── 不可协商的三件事 ────────────────────────────────────────────────────────
//   1. AlertDialog + 短语输入解锁（「删除我的全部数据」逐字）；初始焦点在**取消**
//      按钮上 —— 破坏性操作的默认焦点不落在确认（UI-SPEC 焦点契约）。
//   2. 执行中渲染 Progress；**执行完成后**才跳转回执页 —— 提前跳转会让回执上的
//      数字不可信（作业还在跑，回执读到的可能是 pending 态或半途结果）。
//   3. 回执是独立页面，不是 toast —— 一个会自动消失的通知承担不了告知义务。
//
// ── 轮询的两条路径 ─────────────────────────────────────────────────────────
// 作业执行期间 session 仍有效：GET /me/privacy-actions/:actionId 返回 202（未完成）。
// 作业完成的那一刻 user 与 session 行都被删掉，同一路由转 401 —— 这不是错误，是
// 「删除已完成」的信号：切换到 GET /privacy-receipts/:actionId?token=（回执凭证
// 是 POST /me/delete 响应给的一次性 token，122 位随机，不可枚举）。

'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertDialog } from 'radix-ui';
import { ACCOUNT_DELETION_CONFIRMATION_PHRASE } from '@drift/contract';

import { Progress } from '@/components/ui/progress';

import { API_ORIGIN, authedFetch } from '@/lib/session';

import {
  DELETE_CONFIRM_COPY,
  DELETE_RUNNING_COPY,
  DELETE_RUNNING_NOTE,
} from './copy';

/** 轮询间隔。500ms 对一次几十毫秒的作业足够密，对 DB 也足够轻。 */
const POLL_INTERVAL_MS = 500;

/** 轮询轮数上限 —— 防御「作业卡死 + 前端无限轮询」：到顶后停在失败态给出路。 */
const POLL_MAX_ROUNDS = 120;

export interface DeleteDialogProps {
  /** 完成后跳转前的回调（页面可用来清理本地状态）。 */
  readonly onComplete?: () => void;
}

type Phase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'running'; readonly actionId: string; readonly receiptToken: string }
  | { readonly kind: 'failed'; readonly reason: string };

export function DeleteDialog({ onComplete }: DeleteDialogProps) {
  const [open, setOpen] = useState(false);
  const [phrase, setPhrase] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const cancelRef = useRef<HTMLButtonElement>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  useEffect(() => {
    if (!open) {
      setPhrase('');
      setPhase({ kind: 'idle' });
    }
  }, [open]);

  const unlocked = phrase === ACCOUNT_DELETION_CONFIRMATION_PHRASE;

  async function pollUntilDone(actionId: string, receiptToken: string): Promise<void> {
    for (let round = 0; round < POLL_MAX_ROUNDS; round += 1) {
      if (cancelledRef.current) return;
      const meResponse = await authedFetch(`/me/privacy-actions/${actionId}`).catch(() => null);
      if (meResponse !== null && meResponse.status === 200) {
        // 作业在 session 失效前的一瞬完成（竞争窗口内拿到终态）。
        break;
      }
      if (meResponse !== null && meResponse.status === 401) {
        // session 已随账号消失 —— 删除已完成，切 token 路径读回执。
        const receiptResponse = await fetch(
          `${API_ORIGIN}/privacy-receipts/${actionId}?token=${encodeURIComponent(receiptToken)}`,
          { credentials: 'include' },
        ).catch(() => null);
        if (receiptResponse !== null && receiptResponse.status === 200) break;
        setPhase({ kind: 'failed', reason: 'receipt_unreachable' });
        return;
      }
      // 202（未完成）之外的意外态（5xx / 404）：稍后重试一轮，连续失败到顶走 failed。
      if (meResponse !== null && meResponse.status !== 202 && meResponse.status !== 401) {
        setPhase({ kind: 'failed', reason: `poll_status_${String(meResponse.status)}` });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    if (cancelledRef.current) return;
    onComplete?.();
    window.location.href = `/privacy/receipt/${actionId}?token=${encodeURIComponent(receiptToken)}`;
  }

  async function startDeletion(): Promise<void> {
    const response = await authedFetch('/me/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmationPhrase: ACCOUNT_DELETION_CONFIRMATION_PHRASE }),
    }).catch(() => null);

    if (response === null || response.status !== 202) {
      // 什么都没发生（503 = 入队失败整条回滚）。渲染失败态 + 重试，而不是假装进行中。
      setPhase({ kind: 'failed', reason: 'request_failed' });
      return;
    }
    const credentials = (await response.json()) as { actionId: string; receiptToken: string };
    setPhase({ kind: 'running', actionId: credentials.actionId, receiptToken: credentials.receiptToken });
    await pollUntilDone(credentials.actionId, credentials.receiptToken);
  }

  return (
    <>
      {/* destructive 文字按钮，不吃 accent —— 刻意不抢眼（UI-SPEC 视觉锚点契约）。 */}
      <button
        type="button"
        data-testid="delete-entry"
        className="text-label font-medium text-destructive underline-offset-4 hover:underline"
        onClick={() => setOpen(true)}
      >
        删除我的全部数据
      </button>

      <AlertDialog.Root open={open} onOpenChange={setOpen}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <AlertDialog.Content className="fixed inset-x-md top-[20%] z-50 mx-auto max-w-[420px] rounded-xl border border-border bg-card p-lg">
            <AlertDialog.Title className="text-heading font-semibold text-text-primary">
              删除我的全部数据
            </AlertDialog.Title>
            <AlertDialog.Description className="mt-sm whitespace-normal break-words text-body leading-relaxed text-text-secondary">
              {DELETE_CONFIRM_COPY}
            </AlertDialog.Description>

            {phase.kind === 'idle' ? (
              <input
                value={phrase}
                onChange={(event) => setPhrase(event.target.value)}
                className="mt-md w-full rounded-lg border border-input bg-background px-md py-sm text-body text-text-primary outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                aria-label="删除确认短语输入"
                placeholder={ACCOUNT_DELETION_CONFIRMATION_PHRASE}
              />
            ) : null}

            {phase.kind === 'running' ? (
              <div className="mt-md" data-testid="delete-running">
                <Progress label={DELETE_RUNNING_COPY} />
                <p className="mt-sm text-label leading-relaxed text-text-secondary">{DELETE_RUNNING_COPY}</p>
                <p className="mt-xs text-label leading-relaxed text-text-secondary">{DELETE_RUNNING_NOTE}</p>
              </div>
            ) : null}

            {phase.kind === 'failed' ? (
              <div className="mt-md rounded-lg border border-destructive/30 bg-destructive/10 px-md py-sm" role="alert">
                <p className="whitespace-normal break-words text-label leading-relaxed text-destructive">
                  删除没有开始 —— 网络或服务器暂时没有响应。你的数据没有受到影响，再试一次即可。
                </p>
              </div>
            ) : null}

            <div className="mt-lg flex justify-end gap-sm">
              {/* 初始焦点在取消按钮（UI-SPEC 焦点契约）—— autoFocus 落在 Cancel 上。 */}
              <AlertDialog.Cancel
                ref={cancelRef}
                autoFocus
                className="h-9 rounded-lg border border-border px-md text-label text-text-secondary hover:bg-muted"
              >
                取消
              </AlertDialog.Cancel>
              <AlertDialog.Action
                className="h-9 rounded-lg bg-destructive/10 px-md text-label font-medium text-destructive hover:bg-destructive/20 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!unlocked || phase.kind === 'running' || phase.kind === 'failed'}
                // preventDefault：Radix 的 Action 默认点击即关对话框 —— 而这里
                // 恰恰要让对话框留着渲染 Progress 与失败态（提前关掉等于把
                // 「删除正在进行」藏起来，用户会以为已经完成）。
                onClick={(event) => {
                  event.preventDefault();
                  void startDeletion();
                }}
              >
                确认删除
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
  );
}
