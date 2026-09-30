// 注册页（COMPLY-06 / COMPLY-07 / PRIV-01）。
//
// 页面本身只负责挂载 —— 全部交互契约在 features/onboarding/steps.tsx，那里才是
// tools/ci 与单元层断言的对象。

import { OnboardingSteps } from '@/features/onboarding/steps';

export default function RegisterPage() {
  return <OnboardingSteps />;
}
