// jsdom 环境缺失的浏览器 API 补齐（L3 的 apps/web 渲染断言用）。
//
// jsdom 30 不实现 ResizeObserver，而 Radix 的 `@radix-ui/react-use-size`（Checkbox 与
// RadioGroup 的指示器都用它）在 layout effect 里直接 new 它 —— 不补就是每个渲染断言
// 都以 `ReferenceError: ResizeObserver is not defined` 失败。
//
// ⚠️ 只补**环境**，不补**行为**：ResizeObserver 的 stub 不触发任何回调。这是刻意的 ——
// 一个会伪造尺寸变化的 stub 会让「布局在某个尺寸下正确」这类断言变成自说自话。
// 本阶段没有任何依赖真实尺寸的断言（响应式走查是人工验收项）。
//
// ⚠️ 全部补齐都带 `typeof … === 'undefined'` 守卫：本文件对 node 环境的单元测试也会
// 加载，覆盖真实实现会是一次静默的行为替换。

class ResizeObserverStub {
  observe(): void {
    // 不产生回调，见文件头。
  }
  unobserve(): void {
    // 同上。
  }
  disconnect(): void {
    // 同上。
  }
}

const globals = globalThis as unknown as Record<string, unknown>;

if (typeof globals['ResizeObserver'] === 'undefined') {
  globals['ResizeObserver'] = ResizeObserverStub;
}

// Radix 的部分原语在关闭/聚焦时调它；jsdom 不实现，缺了会抛。
if (typeof globals['document'] !== 'undefined') {
  const proto = (globals['Element'] as { prototype: Record<string, unknown> } | undefined)
    ?.prototype;
  if (proto !== undefined && typeof proto['scrollIntoView'] === 'undefined') {
    proto['scrollIntoView'] = function scrollIntoView(): void {
      // jsdom 没有布局，滚动是 no-op。
    };
  }
}

// matchMedia：jsdom 不实现（Plan 14 的 EmojiPicker 用 pointer: coarse 判定移动端）。
// 与 ResizeObserver 同一条纪律：只补环境不补行为 —— stub 恒报「非触屏」，
// 不伪造任何媒体查询命中；触屏分支由 variant 覆写参数直接测。
interface MediaQueryListStub {
  readonly matches: boolean;
  readonly media: string;
  addEventListener(): void;
  removeEventListener(): void;
  addListener(): void;
  removeListener(): void;
}

if (typeof globals['matchMedia'] === 'undefined') {
  globals['matchMedia'] = function matchMedia(media: string): MediaQueryListStub {
    return {
      matches: false,
      media,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
    };
  };
}
