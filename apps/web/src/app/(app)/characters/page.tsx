// 角色库（CHAT-01 / CHAT-02 / COMPLY-08）。
// 本 plan 只建路由与骨架布局；真实 DB 读取与「加为好友」在 Plan 04 的 tracer 接入。

export default function CharactersPage() {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-[480px] px-md py-lg">
      <h1 className="text-heading font-semibold text-text-primary">角色库</h1>
      {/* 空态与错误态必须可区分，不得静默渲染成空列表（UI-SPEC ## 不可协商项）。
          这里是**空态**：有明确文案与下一步，不是一个什么都没有的 div。 */}
      <p className="mt-lg text-body text-text-secondary">
        还没有可添加的角色。种子角色会在角色库接入后出现在这里。
      </p>
    </main>
  );
}
