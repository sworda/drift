// 角色库（CHAT-01 / CHAT-02 / COMPLY-08）。
//
// Server Component：真实数据由 apps/api 的 GET /characters 提供。
// 会话凭证还没有前端载体（登录 UI 属 Plan 09），所以这里在**未登录时渲染空态**
// 而不是渲染假数据 —— 一个填着占位角色的列表会让「角色库接通了吗」这个问题
// 无法回答。空态与错误态分开渲染（UI-SPEC 不可协商项）。

import { CharacterList, type CharacterListItem } from '@/features/characters/character-list';

const API_ORIGIN = process.env['NEXT_PUBLIC_API_ORIGIN'] ?? 'http://127.0.0.1:3001';

type LoadResult =
  | { readonly kind: 'ok'; readonly characters: readonly CharacterListItem[] }
  | { readonly kind: 'unauthenticated' }
  | { readonly kind: 'error' };

async function loadCharacters(): Promise<LoadResult> {
  try {
    const response = await fetch(`${API_ORIGIN}/characters`, { cache: 'no-store' });
    if (response.status === 401) return { kind: 'unauthenticated' };
    if (!response.ok) return { kind: 'error' };
    const body = (await response.json()) as { characters: CharacterListItem[] };
    return { kind: 'ok', characters: body.characters };
  } catch {
    return { kind: 'error' };
  }
}

export default async function CharactersPage() {
  const result = await loadCharacters();

  return (
    <main className="mx-auto min-h-dvh w-full max-w-[480px]">
      <h1 className="px-md py-lg text-heading font-semibold text-text-primary">角色库</h1>

      {result.kind === 'ok' ? <CharacterList characters={result.characters} /> : null}

      {result.kind === 'unauthenticated' ? (
        <p className="px-md text-body text-text-secondary">
          需要先登录才能浏览角色库。登录入口随注册流程一起上线。
        </p>
      ) : null}

      {result.kind === 'error' ? (
        // 错误态与空态必须可区分，且文案必须含「下一步做什么」（UI-SPEC）。
        <p className="px-md text-body text-destructive">
          没能加载角色库。请检查网络后重试；如果一直这样，稍后再打开这一页。
        </p>
      ) : null}
    </main>
  );
}
