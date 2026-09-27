// @vitest-environment jsdom

// 注册 UI 的 RTL 契约断言（PRIV-01 / COMPLY-06 / COMPLY-07）。
//
// ── 与 consent-state.test.ts 的分工（两者互补，不是替代）────────────────────
// consent-state.test.ts 用**穷举**证明「改一项其余四项逐键不变」（5 scope × 2 值 ×
// 2 起点）—— 那是 PRIV-01 无捆绑同意的核心机械断言，强度高于任何一次点击抽样。
// 本文件负责证明**UI 真的接在那个纯函数上**：真实点击一个 checkbox 之后，DOM 里
// 其余四项的 aria-checked 不变。少了本文件，纯函数再对也可能接错线；少了那一份，
// 点击断言只是一次抽样。
//
// ⚠️ @testing-library/react@16.3.3 / @testing-library/dom@10.4.2 / jsdom@30.1.1 是
// 一次 blocking-human 包合法性 checkpoint 的产物（编排器独立核验 registry + 用户裁决
// 放行，2026-09-27）。三者只在 workspace 根的 devDependencies 里，不进任何 app 的
// 生产依赖 —— tools/ci/test-deps-isolation.test.ts 断言这件事。
//
// ⚠️ 只用 fireEvent，**不用** @testing-library/user-event —— 后者不在那次批准的三个
// 包里。Radix 的 Checkbox / RadioGroup 都监听 click，fireEvent.click 足够。

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { CONSENT_SCOPES, CONSENT_SCOPE_SPECS } from '@drift/contract';

import { AGE_GATE_REJECTION_TESTID } from './age-gate';
import { ConsentCheckboxes } from './consent-checkboxes';
import { INITIAL_CONSENT_SELECTION, setScope } from './consent-state';
import {
  AGE_GATE_REJECTION,
  CONTACT_FIELD_DESCRIPTION,
  CONTACT_FORMAT_ERROR,
  CONTACT_PHONE_PLACEHOLDER,
  NEXT_STEP_LABEL,
  REGISTER_CTA,
  REGISTER_SUBMIT_ERROR,
} from './copy';
import { CONTACT_NAME_INPUT_ID, CONTACT_PHONE_INPUT_ID } from './emergency-contact';
import { OnboardingSteps, SUBMIT_ERROR_TESTID, type AccountFields } from './steps';

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

afterEach(() => {
  cleanup();
});

/** 渲染到「五项同意」那一步。 */
function renderConsentStep(selection = INITIAL_CONSENT_SELECTION) {
  return render(
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

describe('(a) 恰好 5 个彼此独立的 Checkbox', () => {
  it('注册页的同意步骤渲染恰好 5 个 checkbox，且五项名称与 13px 说明都在场', () => {
    renderConsentStep();
    expect(screen.getAllByRole('checkbox')).toHaveLength(CONSENT_SCOPES.length);
    for (const scope of CONSENT_SCOPES) {
      const spec = CONSENT_SCOPE_SPECS[scope];
      // 说明是持久可读的一行文字，不是 tooltip、不是 placeholder。
      expect(screen.getByText(spec.description)).toBeDefined();
      expect(screen.getAllByText(new RegExp(spec.label, 'u')).length).toBeGreaterThan(0);
    }
  });

  it('五项初始全部未勾 —— 必选项也不预勾（预勾的复选框不是同意，是默认）', () => {
    renderConsentStep();
    for (const box of screen.getAllByRole('checkbox')) {
      expect(box.getAttribute('aria-checked')).toBe('false');
    }
  });
});

describe('(b) 可访问树里不存在名称含「全选」的控件', () => {
  it('整棵树里没有任何名称或文本含「全选」的元素', () => {
    const { container } = renderConsentStep();
    expect(screen.queryAllByRole('button', { name: /全选/u })).toHaveLength(0);
    expect(screen.queryAllByRole('checkbox', { name: /全选/u })).toHaveLength(0);
    expect(container.textContent ?? '').not.toContain('全选');
  });

  it('非空真证明：把一个「全选」按钮注入渲染树后，上一条断言会失败', () => {
    // PLAN 要求「临时加一个把 5 项一起置为 true 的按钮，断言 (b) 或 (c) 变红」。
    // 注入式证明每个 PR 都跑一次，而临时改源码只证明了执行那一刻（同 01-05 的处置）。
    const { container } = render(
      <div>
        <button type="button">全选</button>
        <ConsentCheckboxes selection={INITIAL_CONSENT_SELECTION} onToggle={() => undefined} />
      </div>,
    );
    expect(screen.queryAllByRole('button', { name: /全选/u })).toHaveLength(1);
    expect(container.textContent ?? '').toContain('全选');
  });
});

describe('(c) 点击任一项，其余 4 项的 checked 状态不变', () => {
  it.each(CONSENT_SCOPES)('点击 %s 后其余四项逐个不变', (target) => {
    renderConsentStep();
    const boxes = screen.getAllByRole('checkbox');
    const before = boxes.map((box) => box.getAttribute('aria-checked'));
    const index = CONSENT_SCOPES.indexOf(target);
    const box = boxes[index];
    expect(box).toBeDefined();
    if (box === undefined) return;

    fireEvent.click(box);

    const after = screen.getAllByRole('checkbox').map((b) => b.getAttribute('aria-checked'));
    expect(after[index], `点击 ${target} 之后它本身没有切换`).toBe('true');
    for (const [i, value] of before.entries()) {
      if (i === index) continue;
      expect(
        after[i],
        `点击 ${target} 时第 ${String(i)} 项跟着变了 —— 这就是捆绑同意`,
      ).toBe(value);
    }
  });

  it('连续点击两项后恰好两项为 checked（逐项累加，不是整组翻转）', () => {
    renderConsentStep();
    const boxes = screen.getAllByRole('checkbox');
    fireEvent.click(boxes[0] as HTMLElement);
    fireEvent.click(boxes[2] as HTMLElement);
    const after = screen.getAllByRole('checkbox').map((b) => b.getAttribute('aria-checked'));
    expect(after.filter((v) => v === 'true')).toHaveLength(2);
    expect(after[0]).toBe('true');
    expect(after[2]).toBe('true');
  });
});

describe('(d) 必选项未全勾时主 CTA 为禁用态，而不是提交后报错', () => {
  function cta(): HTMLButtonElement {
    return screen.getByRole('button', { name: REGISTER_CTA }) as HTMLButtonElement;
  }

  it('一项都不勾 ⇒ disabled', () => {
    renderConsentStep();
    expect(cta().disabled).toBe(true);
  });

  it('只勾 basic_service ⇒ 仍然 disabled', () => {
    renderConsentStep(setScope(INITIAL_CONSENT_SELECTION, 'basic_service', true));
    expect(cta().disabled).toBe(true);
  });

  it('两项必选都勾上 ⇒ enabled（三项可选保持未勾也能提交）', () => {
    let selection = setScope(INITIAL_CONSENT_SELECTION, 'basic_service', true);
    selection = setScope(selection, 'sensitive_pi', true);
    renderConsentStep(selection);
    expect(cta().disabled).toBe(false);
    expect(
      screen.getAllByRole('checkbox').filter((b) => b.getAttribute('aria-checked') === 'false'),
    ).toHaveLength(3);
  });

  it('通过真实点击把两项必选勾上，CTA 从 disabled 变为 enabled', () => {
    renderConsentStep();
    expect(cta().disabled).toBe(true);
    const boxes = screen.getAllByRole('checkbox');
    fireEvent.click(boxes[CONSENS_INDEX.basic_service] as HTMLElement);
    expect(cta().disabled, '只勾一项就放行了').toBe(true);
    fireEvent.click(boxes[CONSENS_INDEX.sensitive_pi] as HTMLElement);
    expect(cta().disabled).toBe(false);
  });
});

/** 五项在 DOM 中的顺序即 CONSENT_SCOPES 的顺序（渲染顺序由它派生）。 */
const CONSENS_INDEX = {
  basic_service: CONSENT_SCOPES.indexOf('basic_service'),
  sensitive_pi: CONSENT_SCOPES.indexOf('sensitive_pi'),
} as const;

describe('(e) 未满 18 是无出口的法定终态拒绝（COMPLY-07）', () => {
  it('渲染终态拒绝文案，且整页 button 与 link 数量均为 0', () => {
    render(<OnboardingSteps now={NOW} initialStep={0} initialAccount={MINOR} />);
    const rejection = screen.getByTestId(AGE_GATE_REJECTION_TESTID);
    expect(rejection.textContent).toContain(AGE_GATE_REJECTION);
    // 容器内没有出口。
    expect(within(rejection).queryAllByRole('button')).toHaveLength(0);
    expect(within(rejection).queryAllByRole('link')).toHaveLength(0);
    // 整页也没有 —— 「下一步」在这一态整个不渲染。
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('生日当天即视为已满 18（边界不被拒）', () => {
    render(
      <OnboardingSteps
        now={new Date('2026-09-27T00:00:00.000Z')}
        initialStep={0}
        initialAccount={{ ...ADULT, birthDate: '2008-09-27' }}
      />,
    );
    expect(screen.queryByTestId(AGE_GATE_REJECTION_TESTID)).toBeNull();
  });

  it('把生日改成未满 18 之后，出口消失（不是一次性的初始态）', () => {
    render(<OnboardingSteps now={NOW} initialStep={0} initialAccount={ADULT} />);
    expect(screen.queryAllByRole('button').length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText(/出生日期/u), { target: { value: '2015-06-15' } });
    expect(screen.getByTestId(AGE_GATE_REJECTION_TESTID)).toBeDefined();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});

describe('(f) 手机号格式不通过时渲染指定文案，并把焦点移到该输入框', () => {
  it('填 10 位 ⇒ 错误文案在场且 document.activeElement 是手机号输入框', () => {
    render(
      <OnboardingSteps
        now={NOW}
        initialStep={1}
        initialAccount={ADULT}
        initialContact={{ kind: 'emergency', name: '联系人', phone: '1380000123' }}
      />,
    );
    // 「下一步」在这一步**不禁用**（见 steps.tsx 的说明）：否则这条文案与这次焦点移动
    // 永远不可达，而它是 UI-SPEC 为紧急联系人专门定的一条错误文案。
    fireEvent.click(screen.getByRole('button', { name: NEXT_STEP_LABEL }));

    expect(screen.getByText(CONTACT_FORMAT_ERROR)).toBeDefined();
    const phone = document.getElementById(CONTACT_PHONE_INPUT_ID);
    expect(phone).not.toBeNull();
    expect(document.activeElement, '焦点没有落在第一个出错字段上').toBe(phone);
  });

  it('称呼为空时焦点落在称呼而不是手机号（第一个出错字段）', () => {
    render(
      <OnboardingSteps
        now={NOW}
        initialStep={1}
        initialAccount={ADULT}
        initialContact={{ kind: 'emergency', name: '', phone: '1380000123' }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: NEXT_STEP_LABEL }));
    expect(document.activeElement).toBe(document.getElementById(CONTACT_NAME_INPUT_ID));
  });
});

describe('(g) 紧急联系人的说明在 Field 的 description 位置，不是占位符', () => {
  it('说明与占位符是两段不同的文本，且说明渲染在 field-description 里', () => {
    const { container } = render(
      <OnboardingSteps
        now={NOW}
        initialStep={1}
        initialAccount={ADULT}
        initialContact={{ kind: 'emergency', name: '', phone: '' }}
      />,
    );
    expect(CONTACT_FIELD_DESCRIPTION).not.toBe(CONTACT_PHONE_PLACEHOLDER);
    const phone = document.getElementById(CONTACT_PHONE_INPUT_ID) as HTMLInputElement;
    expect(phone.placeholder).toBe(CONTACT_PHONE_PLACEHOLDER);
    expect(phone.placeholder).not.toBe(CONTACT_FIELD_DESCRIPTION);
    const description = screen.getByText(CONTACT_FIELD_DESCRIPTION);
    expect(description.getAttribute('data-slot')).toBe('field-description');
    // 说明通过 aria-describedby 与输入框关联 —— 读屏能读到它。
    expect(phone.getAttribute('aria-describedby')).toBe(description.id);
    expect(container.querySelectorAll('[role="radio"]')).toHaveLength(2);
  });
});

describe('提交失败保留已填内容 + 全屏唯一 28px', () => {
  it('提交失败后渲染「注册没有完成」与「重试提交」，且已填内容一个字段都没清', async () => {
    let selection = setScope(INITIAL_CONSENT_SELECTION, 'basic_service', true);
    selection = setScope(selection, 'sensitive_pi', true);
    render(
      <OnboardingSteps
        now={NOW}
        initialStep={2}
        initialAccount={ADULT}
        initialContact={COMPLETE_CONTACT}
        initialConsents={selection}
        submit={() => Promise.reject(new Error('boom'))}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: REGISTER_CTA }));
    const error = await screen.findByTestId(SUBMIT_ERROR_TESTID);
    expect(error.textContent).toContain(REGISTER_SUBMIT_ERROR);
    expect(screen.getByRole('button', { name: '重试提交' })).toBeDefined();

    // 五项同意的勾选没有被清掉。
    expect(
      screen.getAllByRole('checkbox').filter((b) => b.getAttribute('aria-checked') === 'true'),
    ).toHaveLength(2);
    // 退回第一步，账号字段仍是提交前的内容（文案明说「你填的内容都还在」）。
    fireEvent.click(screen.getByRole('button', { name: '上一步' }));
    fireEvent.click(screen.getByRole('button', { name: '上一步' }));
    expect((screen.getByLabelText(/邀请码/u) as HTMLInputElement).value).toBe(ADULT.inviteCode);
    expect((screen.getByLabelText(/昵称/u) as HTMLInputElement).value).toBe(ADULT.name);
  });

  it.each([0, 1, 2] as const)('第 %i 步只有一个 28px 元素', (step) => {
    const { container } = render(
      <OnboardingSteps
        now={NOW}
        initialStep={step}
        initialAccount={ADULT}
        initialContact={COMPLETE_CONTACT}
      />,
    );
    expect(container.querySelectorAll('[class*="text-[28px]"]')).toHaveLength(1);
  });
});
