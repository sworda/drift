// 同意项契约与文案的单一真相源（L4，不连库、不读 env）。
//
// 这里守的是**分叉**：五个 scope 的取值、它们的界面名称、以及撤回确认的两条文案，
// 同时出现在 REQUIREMENTS.md 的 PRIV-01、01-UI-SPEC.md 的两张表、以及
// @drift/contract 的常量里。抄三份的后果不是不一致本身，而是不一致**不会变红** ——
// 改了 UI-SPEC 的文案而忘了改代码，测试全绿，界面与法定披露口径从此各说各话。
//
// 手法与 tools/ci/legal-required-sentences.test.ts 相同：权威来源是那两份文档，测试在
// 运行时从文档里逐行提取，提取不到就抛错并点名 —— 而不是把句子抄成测试常量。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  ACCOUNT_DELETION_CONFIRMATION_PHRASE,
  CONSENT_LABEL_PLACEHOLDER,
  CONSENT_SCOPES,
  CONSENT_SCOPE_SPECS,
  REQUIRED_SCOPES,
  REVOKE_OPTIONAL_CONFIRMATION,
  REVOKE_REQUIRED_CONFIRMATION,
  revokeConfirmationCopy,
} from '../../packages/contract/src/consent.ts';

const REPO_ROOT = new URL('../../', import.meta.url);
const UI_SPEC = readFileSync(
  fileURLToPath(
    new URL('.planning/phases/01-compliance-safety-chat-skeleton/01-UI-SPEC.md', REPO_ROOT),
  ),
  'utf8',
);
const REQUIREMENTS = readFileSync(
  fileURLToPath(new URL('.planning/REQUIREMENTS.md', REPO_ROOT)),
  'utf8',
);

/** 取 Copywriting Contract 表里某一行的 Copy 列。找不到即抛错 —— 不静默当成通过。 */
function copyCell(label: string): string {
  const line = UI_SPEC.split('\n').find(
    (candidate) => candidate.startsWith('|') && candidate.includes(label),
  );
  if (line === undefined) {
    throw new Error(
      `01-UI-SPEC.md 的 ## Copywriting Contract 里找不到「${label}」这一行 —— ` +
        '撤回确认文案失去了权威来源，界面与合同口径随即可以各说各话',
    );
  }
  const copy = (line.split('|')[2] ?? '').trim();
  if (copy.length === 0) throw new Error(`「${label}」这一行的 Copy 列是空的`);
  return copy;
}

describe('五项同意的取值与必选性（PRIV-01）', () => {
  it('恰好五项，scope 值逐字对齐 PRIV-01', () => {
    expect([...CONSENT_SCOPES]).toEqual([
      'basic_service',
      'sensitive_pi',
      'research_l0',
      'research_l1',
      'persona_evolution',
    ]);
    for (const scope of CONSENT_SCOPES) {
      expect(REQUIREMENTS, `PRIV-01 里没有 ${scope}`).toContain(`\`${scope}\``);
    }
  });

  it('required 为 true 的恰好两项：basic_service 与 sensitive_pi', () => {
    expect([...REQUIRED_SCOPES]).toEqual(['basic_service', 'sensitive_pi']);
    expect(CONSENT_SCOPES.filter((s) => CONSENT_SCOPE_SPECS[s].required)).toHaveLength(2);
  });

  it('五项的界面名称都能在 UI-SPEC 的交互契约同意项行里找到', () => {
    const line = UI_SPEC.split('\n').find((l) => l.includes('五个同意项（PRIV-01）'));
    expect(line, 'UI-SPEC 的交互契约里找不到同意项行').toBeDefined();
    for (const scope of CONSENT_SCOPES) {
      expect(line ?? '', `${scope} 的名称与 UI-SPEC 不一致`).toContain(
        CONSENT_SCOPE_SPECS[scope].label,
      );
    }
  });

  it('说明文字不写法条条号（UI-SPEC ## 文案语气基线）', () => {
    for (const scope of CONSENT_SCOPES) {
      const description = CONSENT_SCOPE_SPECS[scope].description;
      expect(description.length, `${scope} 的说明是空的`).toBeGreaterThan(10);
      expect(description, `${scope} 的说明在讲法条而不是讲后果`).not.toMatch(/第.{1,4}条/u);
    }
  });

  it('不存在任何能一次表达多项的常量（捆绑同意在这一层不可表达）', () => {
    const source = readFileSync(
      fileURLToPath(new URL('packages/contract/src/consent.ts', REPO_ROOT)),
      'utf8',
    );
    // **先去注释再扫**：文件头那段说明本身就要写出「这里没有全选控件」这句话，
    // 而一条把自己的说明也判为违规的断言只会逼人把说明删掉 —— 那是在用检查换沉默。
    // 同 UI-SPEC〔禁用〕规则的「唯一例外：对该规则本身的引述」。
    const code = source
      .replace(/\/\*[\s\S]*?\*\//gu, '')
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/u, ''))
      .join('\n');
    for (const banned of ['ALL_GRANTED', 'selectAll', 'setAll', 'toggleAll', '全选']) {
      expect(code.includes(banned), `contract 里出现了捆绑同意的形态：${banned}`).toBe(false);
    }
    // 去注释这件事本身要非空真：把违规词放进代码位置仍然要被抓到。
    expect(`${code}\nexport const ALL_GRANTED = true;`.includes('ALL_GRANTED')).toBe(true);
  });
});

describe('同意不经 better-auth 的 databaseHooks 写入（T-09-02）', () => {
  /**
   * `databaseHooks.user.create.after` 在部分 adapter 下**不与建账号同事务**，用它写同意
   * 会产出「账号存在、同意缺失」的残缺账号 —— 而这类账号在「缺失视为未授权」的读取
   * 逻辑下看起来完全正常。PLAN 把它列为明令禁止项。
   *
   * 扫的是**去注释后的代码**：better-auth.ts 的文件头必须能写出「这里没有
   * databaseHooks」以及为什么，而一条把自己的说明也判为违规的断言只会逼人删说明。
   */
  const AUTH_FILES = [
    'apps/api/src/modules/auth/better-auth.ts',
    'apps/api/src/modules/auth/register.ts',
    'apps/api/src/modules/auth/invite.ts',
    'apps/api/src/modules/auth/routes.ts',
  ];

  function codeOf(relative: string): string {
    return readFileSync(fileURLToPath(new URL(relative, REPO_ROOT)), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//gu, '')
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/u, ''))
      .join('\n');
  }

  it.each(AUTH_FILES)('%s 的代码里没有 databaseHooks', (relative) => {
    expect(codeOf(relative).includes('databaseHooks')).toBe(false);
  });

  it('去注释这件事非空真：代码位置出现 databaseHooks 仍会被抓到', () => {
    expect(`${codeOf(AUTH_FILES[0] ?? '')}\nconst databaseHooks = {};`).toContain('databaseHooks');
  });

  it('邀请码是条件更新消耗，不是「先查再改」（T-09-01）', () => {
    const invite = codeOf('apps/api/src/modules/auth/invite.ts');
    expect(invite).toContain('used_by IS NULL');
    expect(invite).toContain('revoked_at IS NULL');
    // 表里不存在任何允许多次使用的列 —— 通用多次码泄漏即等于公开注册入口。
    const schema = readFileSync(
      fileURLToPath(new URL('packages/db/src/schema/invite.ts', REPO_ROOT)),
      'utf8',
    );
    for (const banned of ['max_uses', 'maxUses', 'use_count', 'useCount']) {
      expect(schema.includes(banned), `invite_code 出现了多次可用字段：${banned}`).toBe(false);
    }
  });
});

describe('撤回确认文案逐字对齐 UI-SPEC 的 Destructive confirmation 行', () => {
  it('可选项那一条逐字一致', () => {
    expect(REVOKE_OPTIONAL_CONFIRMATION).toBe(copyCell('Destructive confirmation（撤回某个同意项）'));
  });

  it('必选项那一条逐字一致（含「等于停止服务并删除你的全部数据」与短语输入）', () => {
    const authoritative = copyCell('Destructive confirmation（撤回必选同意项 · PRIV-02/PRIV-05）');
    expect(REVOKE_REQUIRED_CONFIRMATION).toBe(authoritative);
    expect(authoritative).toContain('等于停止服务并删除你的全部数据');
    expect(authoritative).toContain(`请输入「${ACCOUNT_DELETION_CONFIRMATION_PHRASE}」以确认`);
  });

  it('渲染出来的文案把占位符换成了该项的名称，且不残留占位符', () => {
    for (const scope of CONSENT_SCOPES) {
      const rendered = revokeConfirmationCopy(scope);
      expect(rendered).toContain(`「${CONSENT_SCOPE_SPECS[scope].label}」`);
      expect(rendered).not.toContain(CONSENT_LABEL_PLACEHOLDER);
      // 必选与可选走两条不同的模板 —— 前者必须提到删除，后者必须不提。
      if (CONSENT_SCOPE_SPECS[scope].required) {
        expect(rendered).toContain('删除你的全部数据');
      } else {
        expect(rendered).not.toContain('删除你的全部数据');
      }
    }
  });
});
