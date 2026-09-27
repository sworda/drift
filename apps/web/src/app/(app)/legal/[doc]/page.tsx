// 法务文档渲染页（PRIV-06 / Plan 15 的两份正文的呈现面，Plan 10 Task 2）。
//
// 三条不可协商的约束：
//   1. **文案只从本地 content/legal 目录读**（静态 Markdown），不得从 API 或数据库取
//      —— 一旦文案可远端下发，源码层的禁用词扫描就失效了（T-10-07）。
//   2. **换行显示，不 truncate** —— 截断隐私说明等于未告知（UI-SPEC E9 long-text）。
//   3. 渲染层是禁用词三重检查的第二重：apps/web 的 RTL 断言对本页的 textContent
//      跑同一张词表（banned-render.test.tsx），只扫源码扫不到渲染结果。
//
// markdown 渲染是**手写的最小实现**（标题 / 段落 / 引用块 / 表格 / 列表 / 加粗 / 行内
// 代码 —— 两份正文用到的全部语法）：不引 markdown 库（新增依赖要走 Plan 02 的
// blocking-human 包合法性 checkpoint，T-10-SC），也不需要为两份已知结构的法务文档
// 引入完整 CommonMark。渲染器输出 React 元素而不是 innerHTML —— 法务正文也是不可信
// 输入，走 innerHTML 等于给未来的正文文件开一条 XSS 通道。
//
// ⚠️ 读文件的代码只在 default export 内部执行（不在模块顶层）—— RTL 测试要 import
// 本文件的 LegalDocPage，jsdom 环境下 import.meta.url 不是 file: URL，模块顶层的
// fileURLToPath 会直接抛错（01-09 实测的坑）。

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

/** 允许渲染的文档（也是 generateStaticParams 的全集）。 */
const LEGAL_DOCS = ['privacy', 'terms'] as const;

export interface LegalDocPageProps {
  readonly title: string;
  readonly markdown: string;
}

/** 行内语法：**加粗** 与 `行内代码`。法务正文只用这两种。 */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/u);
  return parts.filter(Boolean).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={`${keyPrefix}-b${String(index)}`}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={`${keyPrefix}-c${String(index)}`} className="rounded bg-card px-1 py-0.5 text-[0.9em]">{part.slice(1, -1)}</code>;
    }
    return part;
  });
}

/**
 * 最小 markdown 块级渲染。**换行显示，不 truncate** 是法定要求 —— 任何输出都不得带
 * line-clamp / text-ellipsis（tools/ci/privacy-ui-contract.test.ts (e) 断言这一点）。
 */
function renderMarkdown(markdown: string): ReactNode[] {
  const lines = markdown.split('\n');
  const blocks: ReactNode[] = [];
  let index = 0;
  let key = 0;

  const nextKey = (): string => `blk-${String(key++)}`;

  while (index < lines.length) {
    const line = lines[index];
    if (line === undefined || line.trim().length === 0) {
      index += 1;
      continue;
    }

    if (line.startsWith('## ')) {
      blocks.push(
        <h2 key={nextKey()} className="mt-lg mb-md text-heading font-semibold text-text-primary">
          {renderInline(line.slice(3), `h2-${String(key)}`)}
        </h2>,
      );
      index += 1;
    } else if (line.startsWith('# ')) {
      blocks.push(
        <h1 key={nextKey()} className="mb-lg text-display font-semibold text-text-primary">
          {renderInline(line.slice(2), `h1-${String(key)}`)}
        </h1>,
      );
      index += 1;
    } else if (line.startsWith('> ')) {
      const quote: string[] = [];
      while (index < lines.length && lines[index]?.startsWith('> ') === true) {
        quote.push((lines[index] ?? '').slice(2));
        index += 1;
      }
      blocks.push(
        <blockquote
          key={nextKey()}
          className="my-md border-l-2 border-border bg-card px-md py-sm text-body text-text-secondary"
        >
          {renderInline(quote.join(' '), `q-${String(key)}`)}
        </blockquote>,
      );
    } else if (line.startsWith('| ')) {
      const rows: string[][] = [];
      while (index < lines.length && lines[index]?.startsWith('|') === true) {
        const row = (lines[index] ?? '')
          .split('|')
          .slice(1, -1)
          .map((cell) => cell.trim());
        // 分隔行（|---|---|）不渲染，但结构上占一行。
        if (!row.every((cell) => /^-{2,}$/u.test(cell))) rows.push(row);
        index += 1;
      }
      const [header, ...body] = rows;
      blocks.push(
        <div key={nextKey()} className="my-md overflow-x-auto">
          <table className="w-full border-collapse text-label">
            <thead>
              <tr>
                {(header ?? []).map((cell, i) => (
                  <th key={`th-${String(i)}`} className="border border-border bg-card px-sm py-xs text-left font-semibold">
                    {renderInline(cell, `th-${String(key)}-${String(i)}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((row, r) => (
                <tr key={`tr-${String(r)}`}>
                  {row.map((cell, c) => (
                    <td key={`td-${String(r)}-${String(c)}`} className="border border-border px-sm py-xs align-top">
                      {renderInline(cell, `td-${String(key)}-${String(r)}-${String(c)}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
    } else if (line.startsWith('- ')) {
      const items: string[] = [];
      while (index < lines.length && lines[index]?.startsWith('- ') === true) {
        items.push((lines[index] ?? '').slice(2));
        index += 1;
      }
      blocks.push(
        <ul key={nextKey()} className="my-md list-disc space-y-xs pl-lg text-body text-text-primary">
          {items.map((item, i) => (
            <li key={`li-${String(i)}`} className="whitespace-normal break-words">
              {renderInline(item, `li-${String(key)}-${String(i)}`)}
            </li>
          ))}
        </ul>,
      );
    } else {
      const paragraph: string[] = [];
      while (index < lines.length) {
        const current = lines[index];
        if (
          current === undefined ||
          current.trim().length === 0 ||
          current.startsWith('#') ||
          current.startsWith('> ') ||
          current.startsWith('| ') ||
          current.startsWith('- ')
        ) {
          break;
        }
        paragraph.push(current);
        index += 1;
      }
      blocks.push(
        <p key={nextKey()} className="my-md whitespace-normal break-words text-body leading-relaxed text-text-primary">
          {renderInline(paragraph.join(''), `p-${String(key)}`)}
        </p>,
      );
    }
  }

  return blocks;
}

/** 渲染一份法务文档（RTL 渲染层断言的直接对象）。 */
export function LegalDocPage({ title, markdown }: LegalDocPageProps) {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-[480px]">
      <h1 className="sr-only">{title}</h1>
      {/* 滚动容器：语义上就是 scroll-area（纵向滚动、内容完整存在于 DOM、不截断）。 */}
      <div className="overflow-y-auto px-md py-lg">
        <div data-testid="legal-doc-content">{renderMarkdown(markdown)}</div>
      </div>
    </main>
  );
}

export function generateStaticParams(): Array<{ readonly doc: string }> {
  return LEGAL_DOCS.map((doc) => ({ doc }));
}

export default async function LegalDocRoute({ params }: { params: Promise<{ doc: string }> }): Promise<ReactNode> {
  const { doc } = await params;
  if ((LEGAL_DOCS as readonly string[]).includes(doc) === false) notFound();
  const markdown = readFileSync(join(process.cwd(), 'content/legal', `${doc}.md`), 'utf8');
  return <LegalDocPage title={doc === 'privacy' ? 'Drift 隐私政策' : 'Drift 服务协议'} markdown={markdown} />;
}
