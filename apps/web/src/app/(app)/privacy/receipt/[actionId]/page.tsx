// 删除回执页（PRIV-05）—— 独立路由 /privacy/receipt/[actionId]，不是弹层。
//
// 回执在删除完成后读取：session 已随账号消失，唯一凭证是 URL 上的 token
//（POST /me/delete 响应发放的一次性回执凭证）。token 错 / 缺 ⇒ 404，页面如实
// 呈现「找不到回执」而不是空白（空态与错误态必须可区分，UI-SPEC）。

import { ReceiptClient } from './receipt-client';

export default async function ReceiptPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly actionId: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { actionId } = await params;
  const query = await searchParams;
  const token = typeof query['token'] === 'string' ? query['token'] : '';
  return <ReceiptClient actionId={actionId} token={token} />;
}
