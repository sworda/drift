// 角色与人格域（D-25 / PERS-10）。
//
// **Phase 1 就按最终 schema 建，不用临时 JSON 种子。** 判据不是「省一次迁移」，而是
// PERS-10 要求每条 persona_version 记 model_snapshot（解析后的快照标识，绝不可存
// 别名）—— 那是**事后补不了**的：临时 JSON 会让 Phase 4 既要迁移又永久丢掉这一版
// 的快照标识，而冻结 baseline 从 Phase 2 起就要开始积累。
//
// Phase 1 只填 core + 一版 traits/dossier，**不建演化管道**（那是 Phase 4-5）。

import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

import { newId } from '../sql-helpers.ts';

/**
 * L1 内核（ARCHITECTURE §5.1）。**演化不可改**，由 DB 触发器兜底（0001 迁移）：
 * 新版本的 core 必须逐字等于 parent 的 core，否则 RAISE EXCEPTION。
 *
 * hardBoundaries 里必须有一条语义为「不否认自己是 AI」的条目 —— 它是 COMPLY-01
 * 在人格层的对应物：危机探针集里「要求角色别说自己是 AI」那一类绕过尝试，挡在
 * 这里而不是挡在后处理里。
 */
export interface PersonaCore {
  readonly values: readonly string[];
  readonly hardBoundaries: readonly string[];
  readonly styleInvariants: readonly string[];
}

/** 大五 5 维 + 9 个社交行为倾向维，0-100 定点整数（PERS-03）。浮点会让「变化了多少」不可复现。 */
export interface PersonaTraits {
  readonly bigFive: {
    readonly openness: number;
    readonly conscientiousness: number;
    readonly extraversion: number;
    readonly agreeableness: number;
    readonly neuroticism: number;
  };
  readonly social: {
    readonly initiation: number;
    readonly selfDisclosure: number;
    readonly humor: number;
    readonly conflictAvoidance: number;
    readonly reciprocity: number;
    readonly warmth: number;
    readonly boundarySetting: number;
    readonly responseLatencyBias: number;
    readonly topicPersistence: number;
  };
}

/** 第一人称 Markdown 小传，600-900 token 预算内（RESEARCH §12.4）。 */
export interface PersonaDossier {
  readonly markdown: string;
  readonly tokenBudget: number;
}

export const character = pgTable('character', {
  id: text('id').primaryKey().$defaultFn(newId),
  name: text('name').notNull(),
  /** 头像资源标识（Phase 1 是静态资源名，不是 URL —— URL 会把渲染层绑到存储层）。 */
  avatar: text('avatar').notNull(),
  /** 角色库列表里的 13px 简介一行。 */
  blurb: text('blurb').notNull(),
  /**
   * 当前生效版本。可空：建 character 行与建第一版 persona_version 行是同一事务里的
   * 两步，中间这一瞬它必须允许为空，否则两张表互相等对方先存在。
   */
  currentPersonaVersionId: text('current_persona_version_id').references(
    (): AnyPgColumn => personaVersion.id,
  ),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const personaVersion = pgTable(
  'persona_version',
  {
    id: text('id').primaryKey().$defaultFn(newId),
    characterId: text('character_id')
      .notNull()
      .references((): AnyPgColumn => character.id),
    /** 上一版。null = 初始版本。自引用，构成 append-only 的版本链。 */
    parentId: text('parent_id').references((): AnyPgColumn => personaVersion.id),
    core: jsonb('core').$type<PersonaCore>().notNull(),
    traits: jsonb('traits').$type<PersonaTraits>().notNull(),
    dossier: jsonb('dossier').$type<PersonaDossier>().notNull(),
    /** 提示词内容哈希（PLAT-08）。真相源在 git，不在数据库。 */
    promptVersion: text('prompt_version').notNull(),
    /**
     * 生成这一版的模型**快照标识**（PERS-10）。
     * ⚠️ 绝不可存别名（latest / -alias 结尾之类）：别名会在某天被 provider 重新解析到
     * 另一个权重上，而那时这一版 traits 的「尺子」已经无从查证。
     */
    modelSnapshot: text('model_snapshot').notNull(),
    isHealthy: boolean('is_healthy').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('persona_version_character_id_idx').on(t.characterId),
    // 版本链是链不是环：parent_id 指向自己会让「取 parent 的 core 比对」变成取自己。
    check('persona_version_no_self_parent', sql.raw('parent_id is null or parent_id <> id')),
  ],
);
