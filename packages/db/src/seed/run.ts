// 种子入库脚本（`pnpm --filter @drift/db run db:seed`）。
//
// 幂等：按 id 判存在。重复跑不会产生第二套角色，也不会新建第二版 persona_version ——
// persona_version 是 append-only 的版本链，每跑一次 seed 就多一版会让「冻结 baseline」
// 从第一天起就是假的。
//
// ⚠️ 入库前每个角色都过一次 reviewCharacterConcept（COMPLY-08）。审核不通过就**退出 1**，
// 不跳过那一个角色 —— 「跳过不合规的那个，剩下的照常入库」会让一次规则命中变成
// 一条没人看的日志。

import { eq } from 'drizzle-orm';

import { closeDb, ownerDb } from '../client.ts';
import { character, personaVersion } from '../schema/character.ts';
import { reviewCharacterConcept, SEED_CHARACTERS, SEED_MODEL_SNAPSHOT, seedPromptVersion } from './characters.ts';

async function seed(): Promise<void> {
  for (const seedCharacter of SEED_CHARACTERS) {
    for (const [field, text] of [
      ['blurb', seedCharacter.blurb],
      ['dossier', seedCharacter.dossier.markdown],
    ] as const) {
      const review = reviewCharacterConcept(text);
      if (!review.ok) {
        throw new Error(
          `COMPLY-08 审核未通过：${seedCharacter.name} 的 ${field} —— ${review.reason ?? ''}`,
        );
      }
    }
  }

  for (const seedCharacter of SEED_CHARACTERS) {
    const existing = await ownerDb
      .select({ id: character.id })
      .from(character)
      .where(eq(character.id, seedCharacter.id));
    if (existing.length > 0) {
      process.stdout.write(`[seed] ${seedCharacter.name} 已存在，跳过\n`);
      continue;
    }

    await ownerDb.transaction(async (t) => {
      await t.insert(character).values({
        id: seedCharacter.id,
        name: seedCharacter.name,
        avatar: seedCharacter.avatar,
        blurb: seedCharacter.blurb,
        currentPersonaVersionId: null,
      });
      const [version] = await t
        .insert(personaVersion)
        .values({
          characterId: seedCharacter.id,
          parentId: null,
          core: seedCharacter.core,
          traits: seedCharacter.traits,
          dossier: seedCharacter.dossier,
          promptVersion: seedPromptVersion(seedCharacter.dossier.markdown),
          modelSnapshot: SEED_MODEL_SNAPSHOT,
        })
        .returning({ id: personaVersion.id });
      if (version === undefined) throw new Error('persona_version 插入未返回 id');
      await t
        .update(character)
        .set({ currentPersonaVersionId: version.id })
        .where(eq(character.id, seedCharacter.id));
    });
    process.stdout.write(`[seed] ${seedCharacter.name} 已入库\n`);
  }
}

try {
  await seed();
} finally {
  await closeDb();
}
