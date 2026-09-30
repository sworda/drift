-- 0001 —— drizzle 表达不了的三类 DB 层兜底：触发器、角色与权限、以及对 0000 里
-- 那几条法定约束的**存在性断言**。
--
-- ⚠️ 为什么 CHECK 约束本身定义在 0000 而不在这里：drizzle-kit 0.31 会 introspect
-- check 约束。一条只存在于裸 SQL 里、schema 文件里没有的 CHECK，在下一次
-- push/generate 时会被当成「库里有、schema 里没有」的漂移并生成 DROP —— 那等于用
-- 一次迁移把 COMPLY-09 的兜底删掉。所以约束定义在 packages/db/src/schema/message.ts
-- （drizzle 管得住的地方），而**这里断言它确实存在**：
--   - 有人把 schema 里那条 check() 删掉 → 重建迁移链时本文件 RAISE EXCEPTION，
--     迁移直接失败，而不是静默少一条约束；
--   - 断言引用了约束名字面量，于是「这条约束是否仍被当成必需」在仓库里 grep 得到。

-- ── 1. 三条法定约束的存在性断言（COMPLY-09 / IFC-08 / CHAT-07）──────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'message_disclosure_required'
      AND constraint_type = 'CHECK'
      AND table_name = 'message'
  ) THEN
    RAISE EXCEPTION 'COMPLY-09 兜底缺失：message 表没有 message_disclosure_required CHECK 约束。标识注入将只依赖应用层中间件，任何绕过它的新写入路径都不会在数据库层失败。';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'message_audience_allowed'
      AND constraint_type = 'CHECK'
      AND table_name = 'message'
  ) THEN
    RAISE EXCEPTION 'IFC-08 预留缺失：message 表没有 message_audience_allowed CHECK 约束。';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'message_conversation_seq_unique'
  ) THEN
    RAISE EXCEPTION 'CHAT-07 前提缺失：message 表没有 (conversation_id, seq) 唯一索引，断连补拉的完整性无法断言。';
  END IF;
END $$;
--> statement-breakpoint

-- ── 2. persona_version 的 core 不变触发器（PERS-10 / D-25）──────────────────
--
-- L1 内核**演化不可改**。现在建这条触发器几乎零成本；Phase 4 再建要面对已有数据。
-- 比较用 jsonb 的 <> 而不是文本比较：键顺序与空白不该被当成「内核变了」。

CREATE OR REPLACE FUNCTION persona_version_core_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  parent_core jsonb;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT core INTO parent_core FROM persona_version WHERE id = NEW.parent_id;
  IF parent_core IS NULL THEN
    RAISE EXCEPTION 'persona_version.parent_id % 指向不存在的版本', NEW.parent_id;
  END IF;

  IF NEW.core <> parent_core THEN
    RAISE EXCEPTION 'persona_version 的 core 不可变：新版本 % 的 core 与 parent % 不一致（价值观 / 硬边界 / 语体不变量由演化不可改）', NEW.id, NEW.parent_id;
  END IF;

  RETURN NEW;
END $fn$;
--> statement-breakpoint

CREATE TRIGGER persona_version_core_immutable
BEFORE INSERT OR UPDATE ON persona_version
FOR EACH ROW EXECUTE FUNCTION persona_version_core_immutable();
--> statement-breakpoint

-- ── 3. 两个角色（app_role / purge_role）─────────────────────────────────────
--
-- NOLOGIN 组角色：连接仍用部署的那一份凭证，身份靠启动参数 `-c role=<role>` 切换
-- （见 packages/db/src/client.ts）。这样 append-only 由 PG 权限保证，而部署不需要
-- 多带两份密码。
--
-- 幂等：CREATE ROLE 没有 IF NOT EXISTS，所以包在 DO 块里判 pg_roles。

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_role') THEN
    CREATE ROLE app_role NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'purge_role') THEN
    CREATE ROLE purge_role NOLOGIN;
  END IF;
END $$;
--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO app_role, purge_role;
--> statement-breakpoint

-- ── 4. 业务表：app_role 可读写 ───────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON
  "user", account, session, verification, emergency_contact,
  invite_code, consent,
  "character", persona_version,
  conversation, friendship,
  session_risk_state, usage_segment
TO app_role;
--> statement-breakpoint

-- message 不给 UPDATE / DELETE：改写一条已投递的消息就是改写对话历史，而 DB 是
-- 真相源（STACK §4）。删除走 purge_role。
GRANT SELECT, INSERT ON message TO app_role;
--> statement-breakpoint

-- ⚠️ contact_attempt **不属审计表族**：它是一台状态机（pending → delivered/failed），
-- status 必须可 UPDATE。把它跟 safety_event 一起 REVOKE 会让四态实现静默退化成两态
-- —— 二级危机卡片永远停在 pending，而没有任何现有断言会发现这件事。
GRANT SELECT, INSERT, UPDATE ON contact_attempt TO app_role;
--> statement-breakpoint

-- ── 5. 审计表族（D-06）：append-only ────────────────────────────────────────
--
-- 七张表：safety_event · consent_event · privacy_action · llm_call · client_error ·
-- exit_intent · dependency_signal
--
-- 先 GRANT 再 REVOKE，顺序不能反。也不要因为「反正没 GRANT 过 UPDATE」就省掉
-- REVOKE：PUBLIC 在某些部署里对 public schema 有默认权限，显式 REVOKE 是唯一
-- 可断言的姿态（tools/ci/schema-drift.test.ts 断言它真的抛权限错误）。

GRANT INSERT, SELECT ON
  safety_event, consent_event, privacy_action, llm_call, client_error, exit_intent, dependency_signal
TO app_role;
--> statement-breakpoint

REVOKE UPDATE, DELETE ON
  safety_event, consent_event, privacy_action, llm_call, client_error, exit_intent, dependency_signal
FROM app_role;
--> statement-breakpoint

-- ── 6. 删除 worker（PRIV-05 / RES-10）───────────────────────────────────────
--
-- 硬删 + 显式存储位置注册表（D-19）。级联删除在 worker 里**显式实现**、不依赖外键，
-- 所以 purge_role 需要对每一张表的 DELETE，而不是靠 ON DELETE CASCADE。

GRANT SELECT, DELETE ON ALL TABLES IN SCHEMA public TO purge_role;
--> statement-breakpoint

-- invite_code 的 used_by 要被**置空**而不是删行（码本身是运营资产，D-19）。
GRANT UPDATE (used_by, used_at) ON invite_code TO purge_role;
