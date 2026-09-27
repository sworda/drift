// 「我们收集了什么」的数据来源（PRIV-03 / RESEARCH §6.5）。
//
// GET /me/collected —— 清单**全部由 DATA_INVENTORY 生成**，本文件不出现第二份清单：
// 判定「某 scope 确有写入路径」的依据就是它在注册表里的条目数（> 0），不引入别的真
// 相源。前端不硬编码任何条目 —— 清单与实现漂移即构成虚假陈述（T-10-04 的呈现面）。
//
// 两个部分正好是两份清单的分离（RESEARCH §6.5）：
//   collected                   —— 已授权且当前确有数据流的条目，按 scope 分组；
//   authorizedButNotCollecting  —— 已授权但该 scope 条目数为 0，渲染第三态
//                                  「已授权 · 尚未开始收集」。

import { type ConsentScope } from '@drift/contract';
import { buildCollectedView, consent, DATA_INVENTORY, db } from '@drift/db';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';

import { logError, logEvent } from '../../obs/logger.ts';
import { currentUserId } from '../auth/session.ts';

export const privacyRoutes = new Hono();

privacyRoutes.get('/me/collected', async (c) => {
  const userId = await currentUserId(c);
  if (userId === null) return c.json({ error: 'unauthorized' }, 401);

  try {
    const rows = await db
      .select({ scope: consent.scope, granted: consent.granted })
      .from(consent)
      .where(eq(consent.userId, userId));

    const grantedByScope: Record<ConsentScope, boolean> = {
      basic_service: false,
      sensitive_pi: false,
      research_l0: false,
      research_l1: false,
      persona_evolution: false,
    };
    for (const row of rows) {
      grantedByScope[row.scope] = row.granted;
    }

    logEvent('privacy.collected_viewed', { userId, route: '/me/collected', statusCode: 200 });
    return c.json(buildCollectedView(DATA_INVENTORY, grantedByScope));
  } catch (error) {
    logError('privacy.collected_view_failed', error, {
      userId,
      route: '/me/collected',
      statusCode: 500,
    });
    return c.json({ error: 'internal_error' }, 500);
  }
});
