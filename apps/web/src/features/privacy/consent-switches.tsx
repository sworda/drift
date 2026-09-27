// 隐私中心的五个逐项撤回开关（PRIV-02 / UI-SPEC E9 error 行）。
//
// 撤回失败的行为契约是本文件的中心：Switch **回弹到服务端的真实状态**（禁止乐观置
// 为已撤回 —— 那会让用户以为数据流已停），并渲染 REVOKE_FAILED_COPY（含「数据流
// 仍在继续」与重试 / 导出留副本 / 提交申诉三个出路）。Switch 的 checked 完全由 props
// 驱动（受控），乐观翻转在结构上写不出来 —— 页面只在撤销成功后重新拉取服务端状态。
//
// 撤回必选项走 AlertDialog + 逐字短语输入（初始焦点在取消按钮上，UI-SPEC 焦点契约）；
// 确认文案与短语都来自 @drift/contract 的同一份常量 —— 抄两份会让两端在「撤回会发生
// 什么」上各说各话。

'use client';

import { useEffect, useRef, useState } from 'react';

import {
  ACCOUNT_DELETION_CONFIRMATION_PHRASE,
  type ConsentScope,
  CONSENT_SCOPE_SPECS,
} from '@drift/contract';
import { AlertDialog } from 'radix-ui';

import { Switch } from '@/components/ui/switch';

import { REVOKE_FAILED_COPY, REVOKE_RETRY_LABEL } from './copy';

/** /me/consents 返回的单项（JSON 形状的本地视图）。 */
export interface ConsentSwitchItem {
  readonly scope: ConsentScope;
  readonly label: string;
  readonly description: string;
  readonly required: boolean;
  readonly granted: boolean;
}

export interface ConsentSwitchesProps {
  readonly consents: readonly ConsentSwitchItem[];
  /**
   * 发起一次撤回。resolve = 服务端确认撤回成功；reject = 撤回失败（Switch 回弹）。
   * confirmationPhrase 仅必选项需要 —— 由 AlertDialog 的逐字输入提供，服务端在缺短语时
   * 返回 409，本组件把那当作失败（Switch 回弹），不做第二种解读。
   */
  readonly onRevoke: (scope: ConsentScope, confirmationPhrase?: string) => Promise<void>;
}

export function ConsentSwitches({ consents, onRevoke }: ConsentSwitchesProps) {
  const [confirmingScope, setConfirmingScope] = useState<ConsentScope | null>(null);
  const [phrase, setPhrase] = useState('');
  const [failedScope, setFailedScope] = useState<ConsentScope | null>(null);
  const [busyScope, setBusyScope] = useState<ConsentScope | null>(null);
  const phraseInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (confirmingScope !== null) setPhrase('');
  }, [confirmingScope]);

  const attemptRevoke = async (scope: ConsentScope, phrase?: string): Promise<void> => {
    setBusyScope(scope);
    setFailedScope(null);
    try {
      await onRevoke(scope, phrase);
    } catch {
      setFailedScope(scope);
    } finally {
      setBusyScope(null);
    }
  };

  return (
    <div className="px-md pb-lg" data-testid="consent-switches">
      <ul className="mt-lg space-y-md">
        {consents.map((item) => {
          const failed = failedScope === item.scope;
          return (
            <li
              key={item.scope}
              className="rounded-lg border border-border bg-card px-md py-sm"
              // 置灰残留只属于「我们收集了什么」清单的撤回语义；这里撤回失败的表现是
              // Switch 回弹 + 错误文案，条目本身保持可读可重试。
            >
              <div className="flex items-start justify-between gap-md">
                <div className="min-w-0">
                  <p className="text-body font-medium text-text-primary">{item.label}</p>
                  {/* 换行显示，不 truncate（E9 long-text）。 */}
                  <p className="mt-xs whitespace-normal break-words text-label leading-relaxed text-text-secondary">
                    {item.description}
                  </p>
                </div>
                <Switch
                  checked={item.granted}
                  disabled={busyScope === item.scope}
                  aria-label={`撤回「${item.label}」的开关`}
                  onCheckedChange={(checked) => {
                    // 只处理「从开到关」：开关不存在「重新授权」这条路 —— 同意项的
                    // 授予发生在注册页，隐私中心只做撤回（PRIV-02）。
                    if (checked) return;
                    if (item.required) {
                      setConfirmingScope(item.scope);
                    } else {
                      void attemptRevoke(item.scope);
                    }
                  }}
                />
              </div>

              {failed ? (
                <div className="mt-sm rounded-lg border border-destructive/30 bg-destructive/10 px-md py-sm" role="alert">
                  <p className="whitespace-normal break-words text-label leading-relaxed text-destructive">
                    {REVOKE_FAILED_COPY}
                  </p>
                  <button
                    type="button"
                    className="mt-sm text-label font-medium text-destructive underline-offset-4 hover:underline"
                    onClick={() => void attemptRevoke(item.scope)}
                  >
                    {REVOKE_RETRY_LABEL}
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      <AlertDialog.Root
        open={confirmingScope !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmingScope(null);
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <AlertDialog.Content className="fixed inset-x-md top-[20%] z-50 mx-auto max-w-[420px] rounded-xl border border-border bg-card p-lg">
            <AlertDialog.Title className="text-heading font-semibold text-text-primary">撤回必选项会删除全部数据</AlertDialog.Title>
            <AlertDialog.Description className="mt-sm whitespace-normal break-words text-body leading-relaxed text-text-secondary">
              {confirmingScope !== null ? CONSENT_SCOPE_SPECS[confirmingScope].description : null}
              这一操作不可撤销 —— 确认请逐字输入「{ACCOUNT_DELETION_CONFIRMATION_PHRASE}」。
            </AlertDialog.Description>
            <input
              ref={phraseInputRef}
              value={phrase}
              onChange={(event) => setPhrase(event.target.value)}
              className="mt-md w-full rounded-lg border border-input bg-background px-md py-sm text-body text-text-primary outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              aria-label="删除确认短语输入"
              placeholder={ACCOUNT_DELETION_CONFIRMATION_PHRASE}
            />
            <div className="mt-lg flex justify-end gap-sm">
              {/* 初始焦点在取消按钮上 —— 破坏性操作的默认焦点不落在确认（UI-SPEC 焦点契约）。 */}
              <AlertDialog.Cancel autoFocus className="h-9 rounded-lg border border-border px-md text-label text-text-secondary hover:bg-muted">
                取消
              </AlertDialog.Cancel>
              <AlertDialog.Action
                className="h-9 rounded-lg bg-destructive/10 px-md text-label font-medium text-destructive hover:bg-destructive/20 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={phrase !== ACCOUNT_DELETION_CONFIRMATION_PHRASE}
                onClick={() => {
                  if (confirmingScope === null) return;
                  const scope = confirmingScope;
                  setConfirmingScope(null);
                  void attemptRevoke(scope, ACCOUNT_DELETION_CONFIRMATION_PHRASE);
                }}
              >
                确认删除
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </div>
  );
}
