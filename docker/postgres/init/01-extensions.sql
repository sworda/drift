-- postgres 容器**首次**初始化时执行一次（/docker-entrypoint-initdb.d）。
--
-- PLAT-02：一个 PostgreSQL 同时承载 OLTP + 向量检索 + 任务队列。这个文件就是
-- 那三者共存的前置条件。

-- ── pgvector ────────────────────────────────────────────────────────────────
-- 镜像 pgvector/pgvector:pg18 自带扩展文件，这里只是把它装进数据库。
CREATE EXTENSION IF NOT EXISTS vector;

-- ── pg-boss 的专属 schema ───────────────────────────────────────────────────
-- pg-boss 自建表、自跑自己的迁移，必须与 drizzle 管的 public schema 分开
-- （packages/db/drizzle.config.ts 的 schemaFilter 只含 'public'）。
-- boss.start() 会自己建这个 schema；这里预建的意义是让 /healthz 的 pgboss 探针
-- 有确定的语义：schema 存在但没有表 = worker 还没跑完迁移，而不是「连不上库」。
CREATE SCHEMA IF NOT EXISTS pgboss;

-- ── 版本下限断言 ────────────────────────────────────────────────────────────
-- pgvector 必须 >= 0.8.2：该版修复了并行 HNSW 构建的缓冲区溢出（CVE-2026-3172）。
-- 这条断言放在数据库初始化里而不是只放在 CI 里，是因为镜像 tag 是可变的 ——
-- pgvector/pgvector:pg18 将来指向哪个扩展版本不由本仓库决定。版本不够时容器
-- 初始化直接失败，比起来之后再发现要好得多。
-- 用整数元组比较而不是字符串比较：'0.10.0' < '0.8.2' 在字符串序下成立，是错的。
DO $$
DECLARE
  ext_version text;
  parts int[];
BEGIN
  SELECT extversion INTO ext_version FROM pg_extension WHERE extname = 'vector';
  IF ext_version IS NULL THEN
    RAISE EXCEPTION 'pgvector 扩展未安装 —— 镜像不是 pgvector/pgvector:pg18？';
  END IF;
  parts := string_to_array(ext_version, '.')::int[];
  IF (parts[1], parts[2], coalesce(parts[3], 0)) < (0, 8, 2) THEN
    RAISE EXCEPTION
      'pgvector % 低于 0.8.2（CVE-2026-3172：并行 HNSW 构建缓冲区溢出）', ext_version;
  END IF;
  RAISE NOTICE 'pgvector % OK', ext_version;
END
$$;
