// pino-no-pii 的子进程脚本 —— 跑一个真实 turn，让 pino 把全过程日志写到 stdout。
//
// ⚠️ 本文件**不是** *.test.ts，vitest 不收集它；它由 tools/ci/pino-no-pii.test.ts
// 以 `node --experimental-transform-types` 拉起（transform 模式是必须的：apps/api 的
// 模块链里有参数属性语法，strip-only 模式直接 SyntaxError —— 实测）。
//
// 为什么必须子进程：pino 的默认目标是 fd 1 上的 sonic-boom，**不经过**
// process.stdout 对象 —— 同进程 monkey-patch write() 抓不到它（这是 pino 的性能
// 设计，不是我们的代码能改的）。老老实实起一个进程、抓它的 stdout。
//
// 这个子进程跑的是「一个完整 turn」：用户消息（正文 = 一段可识别特征串 + 一个
// 11 位假手机号）→ 落库 → mock 人格渲染 → mock safety.classify → safetyGateway →
// 角色消息落库（disclosure 注入）→ deliver（无连接 = 0）。父进程对 stdout 断言
// 「不含正文的任何 ≥6 字子串、不含 11 位手机号」—— 这是对「pino 日志从设计上
// 不含个人信息」这条登记的运行时证明（RESEARCH §2.3 / §7.1）。

process.env['PORT'] = '3001';
process.env['WEB_ORIGIN'] ??= 'http://127.0.0.1:3000';
process.env['WECOM_WEBHOOK_URL'] ??= 'https://example.invalid/hook';
process.env['OPERATOR_API_TOKEN'] ??= 'pino-child-operator-token-0123456789abcdef';
process.env['BETTER_AUTH_SECRET'] ??= 'pino-child-better-auth-secret-0123456789ab';
process.env['CONTACT_ENCRYPTION_KEY'] ??=
  '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
process.env['LLM_PROVIDER_MODE'] = 'mock';
// trace 是最低级别：全部日志事件都写出来 —— 断言面对的是**最大**暴露面。
process.env['LOG_LEVEL'] = 'trace';

const { runTurn } = await import('../../apps/api/src/modules/chat/turn.ts');
const { closeDb, ownerSql } = await import('@drift/db');
const { seedConversation } = await import('./fixtures.ts');

/** 特征串：与父测试的常量逐字一致（那里有断言防两份定义漂移）。 */
export const PII_FEATURE_STRING = '企鹅量子薄荷糖纸鹤夹克旋涡标本';
export const PII_FAKE_PHONE = '19912345678';

const seeded = await seedConversation('pino-no-pii');
const result = await runTurn({
  conversationId: seeded.conversationId,
  userId: seeded.userId,
  text: `${PII_FEATURE_STRING} ${PII_FAKE_PHONE}，今天想找人说说话。`,
});

if (result.reply.outcome === 'gated') {
  process.stdout.write(`[pino-child] turn ok: seq=${String(result.reply.seq)}\n`);
} else {
  process.stdout.write(`[pino-child] turn outcome=${result.reply.outcome}\n`);
}

await closeDb();
await ownerSql.end({ timeout: 5 });
process.exit(0);
