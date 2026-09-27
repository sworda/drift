-- 0002 —— safety_event 的 risk 轨迹起点（R1.25「留存 risk_level 轨迹」）。
--
-- ⚠️ 列与 CHECK 都由 packages/db/src/schema/safety.ts 生成，不是手写进来的：
-- drizzle-kit 0.31 会 introspect CHECK 约束，一条只存在于裸 SQL 里、schema 文件里
-- 没有的约束会在下一次 push/generate 时被当成漂移并生成 DROP。文件末尾那段 DO 块是
-- **存在性断言**（不是约束定义）—— 有人把 schema 里那条 check() 删掉时，重建迁移链
-- 会在这里 RAISE EXCEPTION 而不是静默少一条约束。
--
-- default 'none' 让这一列可以后补到已有行上而不需要回填。

ALTER TABLE "safety_event" ADD COLUMN "previous_level" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "safety_event" ADD CONSTRAINT "safety_event_previous_level_allowed" CHECK ("previous_level" in ('none', 'watch', 'elevated', 'crisis'));
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'safety_event' AND column_name = 'previous_level'
  ) THEN
    RAISE EXCEPTION 'R1.25 留证缺失：safety_event 没有 previous_level 列，risk 轨迹只剩终值，「这一轮从哪一档跳上来」事后无法回答。';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'safety_event_previous_level_allowed'
      AND constraint_type = 'CHECK'
      AND table_name = 'safety_event'
  ) THEN
    RAISE EXCEPTION 'safety_event 缺少 safety_event_previous_level_allowed CHECK 约束：previous_level 的取值域不再由数据库保证。';
  END IF;
END $$;
