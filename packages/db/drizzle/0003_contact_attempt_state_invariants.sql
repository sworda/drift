-- 0003 —— contact_attempt 四态的三条数据库层不变量（D-10 / SAFE-16）。
--
-- ⚠️ 三条 CHECK 都由 packages/db/src/schema/safety.ts 生成（drizzle-kit 0.31 会
-- introspect CHECK 约束，只存在于裸 SQL 里的约束会在下一次 push 时被当成漂移并
-- 生成 DROP —— 等于用一次迁移悄悄删掉这三条兜底）。文件末尾那段 DO 块是**存在性
-- 断言**，不是约束定义。
--
-- 三条各自兜住的是一次「虚假陈述」的数据形态，而不是一次程序错误：
--   delivered_at_consistency    —— 填了 delivered_at 而 status 不是 delivered
--   pending_requires_alert      —— 在等一件从未开始的事（没有 alert_sent_at 的 pending）
--   contact_ref_required        —— 除 unavailable 外都必须有联系方式引用

ALTER TABLE "contact_attempt" ALTER COLUMN "contact_ref" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "contact_attempt" ADD CONSTRAINT "contact_attempt_delivered_at_consistency" CHECK ("delivered_at" is null or "status" = 'delivered');--> statement-breakpoint
ALTER TABLE "contact_attempt" ADD CONSTRAINT "contact_attempt_pending_requires_alert" CHECK ("status" <> 'pending' or "alert_sent_at" is not null);--> statement-breakpoint
ALTER TABLE "contact_attempt" ADD CONSTRAINT "contact_attempt_contact_ref_required" CHECK ("contact_ref" is not null or "status" = 'unavailable');
--> statement-breakpoint

DO $$
DECLARE
  required_check text;
BEGIN
  FOREACH required_check IN ARRAY ARRAY[
    'contact_attempt_delivered_at_consistency',
    'contact_attempt_pending_requires_alert',
    'contact_attempt_contact_ref_required'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE constraint_name = required_check
        AND constraint_type = 'CHECK'
        AND table_name = 'contact_attempt'
    ) THEN
      RAISE EXCEPTION 'SAFE-04/SAFE-16 兜底缺失：contact_attempt 没有 % CHECK 约束。四态的自相矛盾终局将只依赖应用层，任何绕过 contact.ts 的新写入路径都不会在数据库层失败。', required_check;
    END IF;
  END LOOP;
END $$;
