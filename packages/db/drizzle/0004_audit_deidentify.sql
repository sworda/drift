-- 0004 —— 审计表族的去标识化前提（Q1 裁决 / PRIV-05 / COMPLY-11）。
--
-- Q1：一键删除时七张 append-only 审计表（D-06）的行**不删**，改为把 user_id 与全部
-- 可回链列（conversation_id / message_id / payload 里的 userId 键）置 NULL，保留事件
-- 形状（等级 / 规则 / 计数 / 时间戳）6 个月。这要求两件 schema 层的事实先成立：
--
--   1. 这些列必须**可空** —— NOT NULL 的 user_id 无法「移除」，只能替换成哨兵值，
--      而哨兵是一个可比对的假用户；
--   2. purge_role 必须有这些列的 UPDATE 权限 —— 审计表族对 app_role REVOKE UPDATE
--      （append-only，0001），去标识化的写入口因此只能是删除 worker 的连接。权限给到
--      **列级**而不是整表：purge_role 只能清空可回链列，改不了 rule_hits / level /
--      created_at —— 那正是「审计行的内容不可篡改」的边界（威胁模型：权限面最小）。
--
-- 列定义本体在 packages/db/src/schema/{audit,safety}.ts（drizzle 管得住的地方），
-- 本文件是使它们成立的 DDL + 存在性断言（0001 的先例：断言引用字面量，grep 得到）。

ALTER TABLE "consent_event" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "privacy_action" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "exit_intent" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "exit_intent" ALTER COLUMN "conversation_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "dependency_signal" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "safety_event" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "safety_event" ALTER COLUMN "conversation_id" DROP NOT NULL;--> statement-breakpoint

GRANT UPDATE ("user_id") ON "consent_event" TO purge_role;--> statement-breakpoint
GRANT UPDATE ("user_id", "payload") ON "privacy_action" TO purge_role;--> statement-breakpoint
GRANT UPDATE ("user_id", "conversation_id") ON "exit_intent" TO purge_role;--> statement-breakpoint
GRANT UPDATE ("user_id") ON "dependency_signal" TO purge_role;--> statement-breakpoint
GRANT UPDATE ("user_id", "conversation_id", "message_id") ON "safety_event" TO purge_role;--> statement-breakpoint
GRANT UPDATE ("user_id", "conversation_id") ON "llm_call" TO purge_role;--> statement-breakpoint
GRANT UPDATE ("user_id") ON "client_error" TO purge_role;--> statement-breakpoint

DO $$
BEGIN
  -- 存在性断言：可空性。有人把 schema 里的列改回 NOT NULL（重建迁移链时这里
  -- RAISE），去标识化会在半路因约束失败 —— 那会让删除作业部分失败，回执走 M/N
  -- 分支，而不是静默留下带 user_id 的审计行。
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name IN ('consent_event', 'privacy_action', 'exit_intent', 'dependency_signal', 'safety_event')
      AND column_name = 'user_id' AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'Q1 前提缺失：审计表族的 user_id 仍是 NOT NULL —— 去标识化无法移除 user_id，只能删行或换哨兵值，两者都不是裁决过的口径';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name IN ('safety_event', 'exit_intent')
      AND column_name = 'conversation_id' AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'Q1 前提缺失：safety_event / exit_intent 的 conversation_id 仍是 NOT NULL —— 删除用户会话后这些 FK 引用会阻止 user 行删除';
  END IF;

  -- 存在性断言：purge_role 的列级 UPDATE 权限。
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.column_privileges
    WHERE grantee = 'purge_role' AND table_name = 'safety_event'
      AND column_name = 'user_id' AND privilege_type = 'UPDATE'
  ) THEN
    RAISE EXCEPTION 'Q1 前提缺失：purge_role 没有 safety_event(user_id) 的 UPDATE 权限 —— 去标识化只能以 app_role 执行，而 app_role 对审计表族是 REVOKE UPDATE 的';
  END IF;
END $$;
