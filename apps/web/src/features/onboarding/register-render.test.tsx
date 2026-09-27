// 注册 UI 的渲染契约（PRIV-01 / COMPLY-06 / COMPLY-07）。
//
// ⚠️ 用 `react-dom/server` 的静态渲染，**不是** RTL：`@testing-library/react` 与
// jsdom 都不在 Plan 02 那次包合法性人工核验的清单里，而 T-09-SC 禁止本 plan 新增
// 未经核验的包。因此这里能断言的是「渲染出来的结构与文案」，断言不了「点击之后
// 发生了什么」与焦点落在哪里 —— 后两者已登记 SKIPPED_CHECKS.md 的
// `ui-contract-static-render-only`，解除条件是批准并安装 RTL。
//
// 被这条限制影响最大的那条断言（点一项其余四项不变）没有被降级：它的内容在
// consent-state.test.ts 里被**穷举**证明（5 scope × 2 值 × 2 起点），比一次点击更强。

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CONSENT_SCOPES, CONSENT_SCOPE_SPECS } from '@drift/contract';

import { AGE_GATE_REJECTION_TESTID } from './age-gate';
import { ConsentCheckboxes } from './consent-checkboxes';
import { INITIAL_CONSENT_SELECTION, setScope } from './consent-state';
import {
  AGE_GATE_REJECTION,
  CONTACT_FIELD_DESCRIPTION,
  CONTACT_PHONE_PLACEHOLDER,
  REGISTER_CTA,
} from './copy';
import { OnboardingSteps, type AccountFields } from './steps';

const ADULT: AccountFields = {
  inviteCode: 'invite-1',
  email: 'a@example.invalid',
  password: 'correct-horse',
  name: '张三',
  birthDate: '1995-06-15',
};
const MINOR: AccountFields = { ...ADULT, birthDate: '2015-06-15' };
const NOW = new Date('2026-09-27T00:00:00.000Z');

const COMPLETE_CONTACT = { kind: 'emergency', name: '联系人', phone: '13800001234' } as const;

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function renderConsentStep(selection = INITIAL_CONSENT_SELECTION): string {
  return renderToStaticMarkup(
    <OnboardingSteps
      now={NOW}
      initialStep={2}
      initialAccount={ADULT}
      initialContact={COMPLETE_CONTACT}
      initialConsents={selection}
      submit={() => Promise.resolve()}
    />,
  );
}

describe('(a)(b) 五个独立同意项，且不存在「全选」控件', () => {
  const markup = renderToStaticMarkup(
    <ConsentCheckboxes selection={INITIAL_CONSENT_SELECTION} onToggle={() => undefined} />,
  );

  it('恰好渲染 5 个 checkbox', () => {
    expect(countOccurrences(markup, 'role="checkbox"')).toBe(CONSENT_SCOPES.length);
    for (const scope of CONSENT_SCOPES) {
      expect(markup).toContain(`data-consent-scope="${scope}"`);
    }
  });

  it('可访问树里没有任何名称含「全选」的控件', () => {
    expect(markup).not.toContain('全选');
  });

  it('非空真证明：把一个「全选」按钮注入渲染树后，上一条断言会失败', () => {
    // PLAN 要求「临时加一个把 5 项一起置为 true 的按钮，断言 (b) 或 (c) 变红」。
    // 临时改源码只证明了执行那一刻；注入之后每个 PR 都证明一次（同 01-05 的处置）。
    const withSelectAll = renderToStaticMarkup(
      <div>
        <button type="button">全选</button>
        <ConsentCheckboxes selection={INITIAL_CONSENT_SELECTION} onToggle={() => undefined} />
      </div>,
    );
    expect(withSelectAll).toContain('全选');
    expect(countOccurrences(withSelectAll, 'role="checkbox"')).toBe(CONSENT_SCOPES.length);
  });

  it('五项的名称与 13px 说明都在场（说明不是 tooltip、不是占位符）', () => {
    for (const scope of CONSENT_SCOPES) {
      const spec = CONSENT_SCOPE_SPECS[scope];
      expect(markup).toContain(spec.label);
      expect(markup).toContain(spec.description);
    }
    expect(countOccurrences(markup, 'text-[13px]')).toBe(CONSENT_SCOPES.length);
  });

  it('只勾一项时，只有那一项是 checked（其余四项的渲染态不变）', () => {
    for (const scope of CONSENT_SCOPES) {
      const one = renderToStaticMarkup(
        <ConsentCheckboxes
          selection={setScope(INITIAL_CONSENT_SELECTION, scope, true)}
          onToggle={() => undefined}
        />,
      );
      expect(countOccurrences(one, 'aria-checked="true"')).toBe(1);
      expect(countOccurrences(one, 'aria-checked="false"')).toBe(CONSENT_SCOPES.length - 1);
    }
  });
});

describe('(d) 两项必选未全勾时主 CTA 为禁用态，而不是提交后报错', () => {
  /**
   * 判的是**属性** `disabled=""`，不是子串 'disabled'。
   * button 的 class 里有 `disabled:pointer-events-none` 这类 Tailwind 变体 ——
   * 用子串判会让「永远禁用」与「永远可用」两种实现都通过，这条断言就成了装饰。
   */
  function ctaDisabled(markup: string): boolean {
    const index = markup.lastIndexOf('<button', markup.indexOf(REGISTER_CTA));
    const tag = markup.slice(index, markup.indexOf('>', index) + 1);
    return tag.includes('disabled=""');
  }

  it('一项都不勾 ⇒ disabled', () => {
    expect(ctaDisabled(renderConsentStep())).toBe(true);
  });

  it('只勾 basic_service ⇒ 仍然 disabled', () => {
    const selection = setScope(INITIAL_CONSENT_SELECTION, 'basic_service', true);
    expect(ctaDisabled(renderConsentStep(selection))).toBe(true);
  });

  it('两项必选都勾上 ⇒ enabled（三项可选保持未勾也能提交）', () => {
    let selection = setScope(INITIAL_CONSENT_SELECTION, 'basic_service', true);
    selection = setScope(selection, 'sensitive_pi', true);
    const markup = renderConsentStep(selection);
    expect(ctaDisabled(markup)).toBe(false);
    // 三项可选仍未勾 —— 它们不是提交的前提。
    expect(countOccurrences(markup, 'aria-checked="false"')).toBe(3);
  });
});

describe('(e) 未满 18 是无出口的法定终态拒绝（COMPLY-07）', () => {
  const markup = renderToStaticMarkup(
    <OnboardingSteps now={NOW} initialStep={0} initialAccount={MINOR} />,
  );

  it('渲染终态拒绝文案', () => {
    expect(markup).toContain(AGE_GATE_REJECTION);
    expect(markup).toContain(AGE_GATE_REJECTION_TESTID);
  });

  it('整页没有任何 button 与 a —— 任何「下一步」都是在教人造假', () => {
    expect(countOccurrences(markup, '<button')).toBe(0);
    expect(countOccurrences(markup, '<a ')).toBe(0);
    expect(countOccurrences(markup, '<a>')).toBe(0);
  });

  it('生日当天即视为已满 18（边界不被拒）', () => {
    const onBirthday = renderToStaticMarkup(
      <OnboardingSteps
        now={new Date('2026-09-27T00:00:00.000Z')}
        initialStep={0}
        initialAccount={{ ...ADULT, birthDate: '2008-09-27' }}
      />,
    );
    expect(onBirthday).not.toContain(AGE_GATE_REJECTION);
  });
});

describe('(g) 紧急联系人的说明在 description 行，不是占位符', () => {
  const markup = renderToStaticMarkup(
    <OnboardingSteps
      now={NOW}
      initialStep={1}
      initialAccount={ADULT}
      initialContact={{ kind: 'emergency', name: '', phone: '' }}
    />,
  );

  it('说明与占位符是两段不同的文本，且说明在 field-description 里', () => {
    expect(CONTACT_FIELD_DESCRIPTION).not.toBe(CONTACT_PHONE_PLACEHOLDER);
    expect(markup).toContain(`placeholder="${CONTACT_PHONE_PLACEHOLDER}"`);
    expect(markup).toContain('data-slot="field-description"');
    const descIndex = markup.indexOf(CONTACT_FIELD_DESCRIPTION);
    expect(descIndex).toBeGreaterThan(0);
    // 说明文本不得出现在任何 placeholder 属性里。
    expect(markup).not.toContain(`placeholder="${CONTACT_FIELD_DESCRIPTION}"`);
  });

  it('二选一的两个单选都在场，填一个即完整', () => {
    expect(markup).toContain('监护人');
    expect(markup).toContain('紧急联系人');
    expect(countOccurrences(markup, 'role="radio"')).toBe(2);
  });
});

describe('视觉锚点：当前步骤标题是全屏唯一的 28px', () => {
  it.each([0, 1, 2] as const)('第 %i 步只有一个 28px 元素', (step) => {
    const markup = renderToStaticMarkup(
      <OnboardingSteps
        now={NOW}
        initialStep={step}
        initialAccount={ADULT}
        initialContact={COMPLETE_CONTACT}
      />,
    );
    expect(countOccurrences(markup, 'text-[28px]')).toBe(1);
  });
});
