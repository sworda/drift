// 四条 backstop 视觉 UI-state 测试（UI-SPEC 标记 backstop 的行 / Plan 14 Task 3）。
//
// 1. 30 字角色名 → 会话行与聊天页头部：标题 truncate、徽标 shrink-0（T-14-05）
// 2. 2000 字单条消息 → max-w-[80%] + 换行生效、不产生横向滚动、不遮挡常驻条
// 3. 超出视口高度的危机资源清单 → 二级卡片 sticky 置顶、联络状态行在场、不可 dismiss
// 4. 超长紧急联系人姓名 → 联络状态行不被挤出（清单自身滚动，行在滚动容器外）
//
// ── 本文件守结构层（源码里的类与 DOM 契约），渲染层在 apps/web 的同名 RTL 文件
//（apps/web/src/ui-state-visual.test.tsx —— react 只装在 apps/web，01-09 先例）。
// jsdom 没有布局引擎：视觉结论由「产生该视觉的结构保证」承载（类名/DOM 顺序），
// 真实像素是人工走查（01-PLAYTEST）与响应式验收的职责。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

function read(rel: string): string {
  return readFileSync(`${REPO_ROOT}${rel}`, 'utf8');
}

/** 去注释（banned-terms 同一先例）：说明注释要能写出被禁词来解释规则本身。 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/u, ''))
    .join('\n');
}

describe('backstop 1：30 字角色名不挤出 AI 徽标（T-14-05）', () => {
  it('会话行：标题 truncate 与徽标（shrink-0）共存于同一行', () => {
    const list = read('apps/web/src/features/conversations/conversation-list.tsx');
    expect(list).toContain('<AiBadge data-testid="ai-badge-conversation-list"');
    expect(list).toMatch(/truncate[^<]*<\/span>\s*\{conversation\.counterpartKind/u);
    expect(read('apps/web/src/components/ai-badge.tsx')).toContain('shrink-0');
  });

  it('聊天页头部：标题 truncate、徽标渲染位在头部 JSX 里', () => {
    const client = read('apps/web/src/features/chat/chat-client.tsx');
    expect(client).toContain('<AiBadge data-testid="ai-badge-chat-header"');
    expect(client).toMatch(/truncate[^\n]*\{characterName\}/u);
  });
});

describe('backstop 2：2000 字单条消息不横向滚动、不遮挡常驻条', () => {
  it('气泡内容宽 80% + break-words（长词/长串强制换行）', () => {
    const view = read('apps/web/src/features/chat/chat-view.tsx');
    expect(view).toContain('max-w-[80%]');
    expect(view).toContain('break-words');
    expect(view).toContain('whitespace-normal');
  });

  it('消息流容器是 overflow-y-auto 的窄向滚动（横向不滚）', () => {
    const view = read('apps/web/src/features/chat/chat-view.tsx');
    expect(view).toContain('overflow-y-auto');
  });

  it('常驻条 sticky top-0（长消息流滚动时钉在视口顶）', () => {
    const banner = read('apps/web/src/components/ai-banner.tsx');
    expect(banner).toContain('sticky top-0');
  });
});

describe('backstop 3：危机资源清单超屏时二级卡片仍置顶、联络行在场', () => {
  it('二级卡片 sticky top-0（UI-SPEC：清单再长也不移出视口）', () => {
    const card = read('apps/web/src/features/crisis/care-card.tsx');
    expect(card).toMatch(/sticky top-0[^"]*"/u);
  });

  it('资源清单自身滚动（max-h + overflow-y-auto），联络状态行在清单之外', () => {
    const list = read('apps/web/src/features/crisis/resource-list.tsx');
    expect(list).toContain('max-h-[40vh]');
    expect(list).toContain('overflow-y-auto');
    // 卡片结构：statusRow 在 ResourceList 之前（hotlineFirst 时更靠前）—— 由
    // crisis/care-card.tsx 的 JSX 顺序保证。lastIndexOf：<ResourceList 首次出现
    // 在一级卡片的 JSX 里，二级的比较对象是**它自己**那一次渲染。
    const card = read('apps/web/src/features/crisis/care-card.tsx');
    const statusPos = card.indexOf('<ContactStatusRow');
    const listPos = card.lastIndexOf('<ResourceList');
    expect(statusPos).toBeGreaterThan(-1);
    expect(statusPos).toBeLessThan(listPos);
  });

  it('二级卡片不可 dismiss：没有关闭控件、移除只经唯一确认按钮', () => {
    const card = stripComments(read('apps/web/src/features/crisis/care-card.tsx'));
    expect(card).not.toMatch(/关闭|dismiss|onClose/u);
    expect(card).toContain('setConfirmed(true)');
  });
});

describe('backstop 4：超长紧急联系人姓名不挤出联络状态行', () => {
  it('状态行文本是普通流式文本（无截断/nowrap），长姓名自然换行', () => {
    const row = read('apps/web/src/features/crisis/contact-status-row.tsx');
    expect(row).toContain('<p className="text-body text-care-text">{line}</p>');
    expect(row).not.toContain('truncate');
    expect(row).not.toContain('whitespace-nowrap');
  });

  it('卡片网格是纵向 gap（不是横向 flex 压缩）', () => {
    const card = read('apps/web/src/features/crisis/care-card.tsx');
    expect(card).toContain('grid gap-sm');
  });
});
