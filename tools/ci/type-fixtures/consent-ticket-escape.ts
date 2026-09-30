// 负向 type fixture（V.0 #1）—— ConsentTicket 不可由外部构造，也不可省略。
//
// 对本目录跑 tsc **必须**退出码非 0。如果这些行竟然编译通过，说明
// packages/db/src/consent-ticket.ts 的品牌类型已退化（例如被写成
// `type ConsentTicket<S> = { scope: S }`）—— 那种退化没有任何报错，而它的后果是
// 「撤回 sensitive_pi 之后仍然把消息写进库」重新变成可表达的（PRIV-02 失守）。

import type { ConsentTicket, MessageProvenance, Tx } from '@drift/db';
import { insertUserMessage } from '@drift/db';

declare const tx: Tx;
declare const provenance: MessageProvenance;
declare const sensitiveTicket: ConsentTicket<'sensitive_pi'>;
declare const researchTicket: ConsentTicket<'research_l0'>;

// 违反 1：不传 ticket —— 落库必须先有合法性基础。
export const missingTicket = insertUserMessage(tx, {
  conversationId: 'c1',
  text: 'hello',
  provenance,
});

// 违反 2：拿一个长得像票的普通对象冒充 —— 幻影键无法在外部构造。
export const forgedTicket = insertUserMessage(tx, {
  conversationId: 'c1',
  text: 'hello',
  provenance,
  ticket: { scope: 'sensitive_pi' },
});

// 违反 3：scope 不匹配 —— 一张 research_l0 的票不能用来写消息。
export const wrongScope = insertUserMessage(tx, {
  conversationId: 'c1',
  text: 'hello',
  provenance,
  ticket: researchTicket,
});

// 违反 4：satisfies 不是断言 —— 它要求类型真的成立，所以这一行必须报错。
// 上面三条在品牌退化时会一起消失，这一条是独立的报错源。
export const bySatisfies = { scope: 'sensitive_pi' } satisfies ConsentTicket<'sensitive_pi'>;

// 这一行 tsc **不会**报错：向下断言在类型系统里合法。这正是 eslint.config.js 里两条
// `as ConsentTicket` 选择器必须存在的理由 —— 编译期挡不住断言，只有 lint 能挡。
export const byAssertion = { scope: 'sensitive_pi' } as unknown as ConsentTicket<'sensitive_pi'>;

// 正向对照：票齐全时必须编译通过。没有这一条，「全都报错」也能让上面的断言通过，
// 而那说明的是 fixture 写坏了，不是约束生效了。
export const ok = insertUserMessage(tx, {
  conversationId: 'c1',
  text: 'hello',
  provenance,
  ticket: sensitiveTicket,
});
