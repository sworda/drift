// prompt_version 是内容哈希，且提示词真相源只在 git（PLAT-08）。
//
// 这个文件里有两类断言，性质不同：
//   - 哈希函数的行为（确定性、对改动敏感、对行尾不敏感）—— 可以被单元测试穷尽。
//   - **真相源在 git** —— 只能用一次对目录的字面扫描来守。它是一条「对尚不存在的
//     东西的防线」：今天 packages/prompts 里当然没有 fetch，而这条断言的价值在于
//     将来某人为了「让运营改提示词不用发版」加上它的那一天。

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { SEED_CHARACTERS } from '../../packages/db/src/seed/characters.ts';
import {
  CHAT_REPLY_SYSTEM_PROMPT,
  CHAT_REPLY_SYSTEM_VERSION,
} from '../../packages/prompts/src/chat-reply.ts';
import { PROMPT_IDS, PROMPTS } from '../../packages/prompts/src/registry.ts';
import {
  SAFETY_CLASSIFY_LEVELS,
  SAFETY_CLASSIFY_SYSTEM_PROMPT,
  SAFETY_CLASSIFY_SYSTEM_VERSION,
} from '../../packages/prompts/src/safety-classify.ts';
import { normalizePromptText, promptVersion } from '../../packages/prompts/src/version.ts';
import { RISK_LEVELS } from '../../packages/safety/src/risk.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PROMPTS_SRC = join(REPO_ROOT, 'packages', 'prompts', 'src');

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...sourceFiles(full));
    else if (entry.endsWith('.ts')) found.push(full);
  }
  return found;
}

describe('promptVersion 是内容哈希，不是手工递增的版本号', () => {
  it('同一文本重复调用得同一值（纯函数，不读盘不读环境）', () => {
    const text = '你要扮演一个具体的人。';
    expect(promptVersion(text)).toBe(promptVersion(text));
    expect(promptVersion(text)).toBe(promptVersion(text));
  });

  it('改动一个字符即变化', () => {
    expect(promptVersion('你要扮演一个具体的人。')).not.toBe(promptVersion('你要扮演一个具体的人！'));
    // 连一个标点都不能漏过去：漏过去的那一次改动会被漂移分析读成人格自己变了。
    expect(promptVersion(CHAT_REPLY_SYSTEM_PROMPT)).not.toBe(
      promptVersion(`${CHAT_REPLY_SYSTEM_PROMPT}.`),
    );
  });

  it('仅行尾差异（CRLF 与 LF）不改变值', () => {
    const lf = '第一行\n第二行\n第三行';
    const crlf = '第一行\r\n第二行\r\n第三行';
    const cr = '第一行\r第二行\r第三行';
    expect(promptVersion(crlf)).toBe(promptVersion(lf));
    expect(promptVersion(cr)).toBe(promptVersion(lf));
    // 首尾空白同理：一次多余的换行不该被当成一次提示词改动。
    expect(promptVersion(`\n${lf}  `)).toBe(promptVersion(lf));
    expect(normalizePromptText(crlf)).toBe(lf);
  });

  it('形如 pv_ 加 16 位小写 hex；空字符串也返回合法值而不抛错', () => {
    for (const text of ['', ' ', CHAT_REPLY_SYSTEM_PROMPT, SAFETY_CLASSIFY_SYSTEM_PROMPT]) {
      const version = promptVersion(text);
      expect(version).toMatch(/^pv_[0-9a-f]{16}$/);
      expect(version).toHaveLength(19);
    }
  });

  it('不存在手工递增的版本号：没有任何提示词版本是一个可读的序号', () => {
    for (const id of PROMPT_IDS) {
      expect(PROMPTS[id].version).toMatch(/^pv_[0-9a-f]{16}$/);
      // 排除 v1 / v2 / 1.0.3 这类手写形态。
      expect(PROMPTS[id].version).not.toMatch(/^v?\d+(\.\d+)*$/);
      // 版本必须由**正文**决定：改一个字符就得换一个值。手工递增的版本号做不到
      // 这件事，而它做不到的那一次就是归因链断掉的那一次。
      expect(promptVersion(`${PROMPTS[id].text} ${id}`), id).not.toBe(PROMPTS[id].version);
    }
  });
});

describe('PROMPTS 注册表', () => {
  it('至少含 chat.reply.system 与 safety.classify.system 两个 id', () => {
    expect(new Set(Object.keys(PROMPTS))).toEqual(
      new Set(['chat.reply.system', 'safety.classify.system']),
    );
    for (const id of PROMPT_IDS) {
      expect(PROMPTS[id].id).toBe(id);
      expect(PROMPTS[id].text.length).toBeGreaterThan(0);
    }
  });

  it('每一项的 version 都等于 promptVersion(text)，长度一致', () => {
    const lengths = new Set<number>();
    for (const id of PROMPT_IDS) {
      expect(PROMPTS[id].version, id).toBe(promptVersion(PROMPTS[id].text));
      lengths.add(PROMPTS[id].version.length);
    }
    expect(lengths.size).toBe(1);
  });

  it('注册表与各模块导出的版本常量是同一个值（不存在第二个计算点）', () => {
    expect(PROMPTS['chat.reply.system'].version).toBe(CHAT_REPLY_SYSTEM_VERSION);
    expect(PROMPTS['safety.classify.system'].version).toBe(SAFETY_CLASSIFY_SYSTEM_VERSION);
  });
});

describe('真相源在 git：packages/prompts/src 不得从远端或数据库读提示词', () => {
  it('全目录扫描不出现 fetch( / process.env / db.select / drizzle', () => {
    const files = sourceFiles(PROMPTS_SRC);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const needle of ['fetch(', 'process.env', 'db.select', 'drizzle']) {
        expect(
          text.includes(needle),
          `${file} 含 "${needle}" —— 提示词真相源已不在 git。那会让 git 里的版本与实际生效的版本无声分叉，prompt_version 随之失去归因能力。`,
        ).toBe(false);
      }
    }
  });
});

describe('SAFE-02：safety.classify 的提示词不含任何人格指令', () => {
  it('提示词文本不含任何种子角色的名字', () => {
    expect(SEED_CHARACTERS.length).toBeGreaterThan(0);
    for (const seed of SEED_CHARACTERS) {
      expect(
        SAFETY_CLASSIFY_SYSTEM_PROMPT.includes(seed.name),
        `分类器提示词里出现了角色名 ${seed.name} —— 人格指令会与安全指令竞争并系统性降低敏感度`,
      ).toBe(false);
    }
  });

  it('提示词文本不含语体 / 扮演类指令', () => {
    for (const needle of ['扮演', '第一人称', '语体', '小传', '价值观', '人格']) {
      expect(
        SAFETY_CLASSIFY_SYSTEM_PROMPT.includes(needle),
        `分类器提示词里出现了 "${needle}"`,
      ).toBe(false);
    }
  });

  it('风险四档与 packages/safety 的 RISK_LEVELS 逐字一致', () => {
    // 两处独立声明（prompts 是零业务依赖的叶子包），所以用集合相等断言防分叉。
    expect([...SAFETY_CLASSIFY_LEVELS]).toEqual([...RISK_LEVELS]);
  });
});
