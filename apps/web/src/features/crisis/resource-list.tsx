'use client';

// 援助资源清单（UI-SPEC ## 危机干预呈现契约 + E8 empty 行）。
//
// ── 三条不可协商 ─────────────────────────────────────────────────────────────
//
//  1. **不折叠、不分页、恰好 1 条时也不改版式。** 折叠等于把求助渠道藏起来。
//     清单的 DOM 结构对 0/1/多 条必须完全一致（RTL 断言钉住）—— 唯一的差异是行数。
//  2. **清单为空 ⇒ fail-closed 渲染兜底两行（12356 与 120），不得渲染空卡片。**
//     服务端（packages/safety 的 care-cards.ts）已经保证清单非空，这里是渲染层的
//     第二道同向防线：一张「请寻求帮助」却没有任何号码的卡片，比没有卡片更糟。
//  3. **纵向滚动、清单一屏放不下时卡片仍置顶、联络状态行始终可见。** 因此滚动
//     容器是清单本身而不是整张卡片 —— 状态行在清单之外，天然不随清单滚走。

/**
 * 兜底资源（fail-closed）。与 packages/safety 的 FALLBACK_HELP_RESOURCES 同集 ——
 * 两份的一致性由 tools/ci/crisis-ui-contract.test.ts 的逐值相等断言守着；分叉的
 * 形态是渲染层与服务端各自兜底到不同的号码，而没有任何编译错误。
 */
export const FALLBACK_RESOURCES = [
  { label: '全国心理援助热线 12356', phone: '12356', availability: '24 小时接听' },
  { label: '急救 120', phone: '120', availability: '24 小时接听' },
] as const;

/** 单条援助资源的视图数据（与服务端 care-cards.ts 的 HelpResource 同形）。 */
export interface HelpResourceView {
  readonly label: string;
  readonly phone: string;
  readonly availability: string;
}

/** 空清单（含 null / undefined）一律落到兜底 —— 唯一出口是两条真实号码。 */
function resourcesOrFallback(
  resources: readonly HelpResourceView[] | null | undefined,
): readonly HelpResourceView[] {
  if (resources === null || resources === undefined || resources.length === 0) {
    return FALLBACK_RESOURCES;
  }
  return resources;
}

export interface ResourceListProps {
  readonly resources: readonly HelpResourceView[] | null | undefined;
}

/**
 * 援助资源清单。
 *
 * 每行的号码本身就是一个 tel: 锚点 —— 危机面上每一次多余的点击都是一次流失。
 * 可点区域覆盖整行（min-h-touch），与 44×44 直呼按钮同一条触控标准。
 */
export function ResourceList({ resources }: ResourceListProps) {
  const list = resourcesOrFallback(resources);
  return (
    <ul
      data-slot="crisis-resource-list"
      className="mt-sm max-h-[40vh] list-none overflow-y-auto rounded-md pl-0"
    >
      {list.map((resource) => (
        <li key={resource.phone} className="flex min-h-touch items-center justify-between gap-sm">
          <span className="text-body">{resource.label}</span>
          <a
            href={`tel:${resource.phone}`}
            aria-label={`${resource.label} ${resource.phone}`}
            className="flex min-h-touch items-center px-sm text-body text-care-text underline underline-offset-4"
          >
            {resource.phone}
          </a>
        </li>
      ))}
    </ul>
  );
}