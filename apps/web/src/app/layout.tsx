import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { AppErrorBoundary, UnhandledRejectionReporter } from '@/components/error-boundary';

import './globals.css';

export const metadata: Metadata = {
  title: 'Drift',
  description: 'AI 社交平台',
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  // 字体栈来自 --font-sans（src/styles/tokens.css）：系统字体，零网络字体开销。
  //
  // shadcn init 在这里注入过一个 Geist 的网络字体加载，已移除 —— UI-SPEC
  // ## Design System 的 Font 一行要求系统字体栈，理由是中文字形要贴近用户本机
  // IM 观感，这正是「类微信」的第一性目标；顺带省一次网络字体往返。
  // tools/ci/design-tokens.test.ts 断言这里不再有任何网络字体加载。
  //
  // 全局错误上报（D-28）：error boundary + unhandledrejection，白名单字段 ——
  // 见 components/error-boundary.ts 的说明。
  return (
    <html lang="zh-CN" className="font-sans">
      <body className="bg-background text-foreground">
        <AppErrorBoundary>
          <UnhandledRejectionReporter />
          {children}
        </AppErrorBoundary>
      </body>
    </html>
  );
}
