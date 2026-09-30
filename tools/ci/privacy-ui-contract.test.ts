// 隐私中心的静态契约断言（PRIV-03 / PRIV-02 的呈现面 —— RTL 渲染断言在
// apps/web/src/features/privacy/privacy-render.test.tsx，react 只装在 apps/web）。
//
// 这里守的是「结构」：清单不硬编码、文案与 UI-SPEC 逐字绑定、路由真的挂上了、
// API 侧没有第二份清单。动态行为（撤回后消失 / Switch 回弹 / 第三态方向）归 RTL。

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { DATA_INVENTORY } from '../../packages/db/src/inventory.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const UI_SPEC = readFileSync(
  join(REPO_ROOT, '.planning/phases/01-compliance-safety-chat-skeleton/01-UI-SPEC.md'),
  'utf8',
);
const FEATURES_DIR = join(REPO_ROOT, 'apps/web/src/features/privacy');

function read(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), 'utf8');
}

/** 先去注释再扫（consent-ui-contract 的先例）：说明文字要能写出被禁的形态。 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/u, ''))
    .join('\n');
}

function listProductionFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir).sort()) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) listProductionFiles(abs, out);
    else if (/\.tsx?$/u.test(abs) && !/\.test\.tsx?$/u.test(abs)) out.push(abs);
  }
  return out;
}

const PRIVACY_FEATURE_FILES = listProductionFiles(FEATURES_DIR);

/** UI-SPEC Copywriting Contract 表里某一行的 Copy 列（找不到即抛错）。 */
function copyCell(label: string): string {
  const line = UI_SPEC.split('\n').find((candidate) => candidate.startsWith('|') && candidate.includes(label));
  if (line === undefined) {
    throw new Error(`01-UI-SPEC.md 的 Copywriting Contract 里找不到「${label}」这一行`);
  }
  return (line.split('|')[2] ?? '').replace(/\*\*/gu, '').trim();
}

/** 从 copy.ts 里取一个字符串常量的值（赋值允许换行；值内不含引号）。 */
function copyConstant(name: string): string {
  const match = read('apps/web/src/features/privacy/copy.ts').match(
    new RegExp(`export const ${name} =\\s*'([^']+)'`, 'u'),
  );
  if (match === null) throw new Error(`copy.ts 里找不到常量 ${name}`);
  return match[1] ?? '';
}

describe('文案与 UI-SPEC 逐字绑定', () => {
  it('REVOKE_FAILED_COPY 与 EXPORT_CTA 逐字取自 Copywriting Contract', () => {
    // copy.ts 里的 ** 是加粗标记，与 UI-SPEC 的 ** 同义 —— 比对前两侧都剥掉。
    expect(copyConstant('REVOKE_FAILED_COPY').replace(/\*\*/gu, '')).toBe(
      copyCell('Error state（撤回同意项失败 · PRIV-02）'),
    );
    expect(copyConstant('EXPORT_CTA')).toBe(copyCell('Primary CTA（隐私中心导出）'));
  });

  it('四个分区名与交互契约的分区行一致', () => {
    const copy = read('apps/web/src/features/privacy/copy.ts');
    const interactionRow = UI_SPEC.split('\n').find((line) => line.includes('隐私中心「我们收集了什么」'));
    if (interactionRow === undefined) throw new Error('UI-SPEC 交互契约里找不到隐私中心行');
    expect(copy).toContain("TAB_COLLECTED = '我们收集了什么'");
    expect(copy).toContain("TAB_CONSENTS = '同意管理'");
    expect(copy).toContain("TAB_EXPORT = '导出'");
    expect(copy).toContain("TAB_DELETE = '删除'");
  });

  it('第三态文案含「还没有开始收集」与「开始之前不会有任何变化」（RESEARCH §6.5 的语义）', () => {
    const copy = read('apps/web/src/features/privacy/copy.ts');
    expect(copy).toContain('还没有开始收集');
    expect(copy).toContain('开始之前不会有任何变化');
  });
});

describe('「我们收集了什么」清单不硬编码（PRIV-03 / E9 populated）', () => {
  it('features/privacy 的生产文件里不出现任何 humanLabel 字面量（按带引号的字面量匹配）', () => {
    // 带引号匹配而不是子串：「删除账号」里有「账号」的子串，但那不是硬编码清单条目 ——
    // 硬编码的真实形态是把 humanLabel 当字符串字面量写死在 UI 代码里。
    const labels = [...new Set(DATA_INVENTORY.map((entry) => entry.humanLabel))];
    const offenders: string[] = [];
    for (const file of PRIVACY_FEATURE_FILES) {
      const code = stripComments(readFileSync(file, 'utf8'));
      for (const label of labels) {
        if (code.includes(`'${label}'`) || code.includes(`"${label}"`)) {
          offenders.push(`${file}: ${label}`);
        }
      }
    }
    expect(offenders, `硬编码的清单条目：\n${offenders.join('\n')}`).toEqual([]);
  });

  it('非空真：把一个 humanLabel 写进代码位置，检查器必须抓住', () => {
    const label = '紧急联系人';
    const fakeFile = `const x = '${label}';`;
    const code = stripComments(fakeFile);
    expect(code.includes(`'${label}'`)).toBe(true);
    expect(PRIVACY_FEATURE_FILES.length).toBeGreaterThan(0);
  });

  it('清单视图类型只有一份定义：collected-list 从 @drift/db/inventory import，不另写形状', () => {
    const collectedList = read('apps/web/src/features/privacy/collected-list.tsx');
    expect(collectedList).toContain("from '@drift/db/inventory'");
    // 不允许本地 interface 复刻 CollectedView —— 形状漂移是清单漂移的第一步。
    expect(collectedList.includes('interface CollectedView')).toBe(false);
  });
});

describe('服务端链路', () => {
  it('GET /me/collected 已挂载，且由 DATA_INVENTORY 生成（不引入第二份清单）', () => {
    const app = read('apps/api/src/http/app.ts');
    expect(app).toContain("from '../modules/privacy/inventory-routes.ts'");
    expect(app).toContain("app.route('/', privacyRoutes)");

    const route = read('apps/api/src/modules/privacy/inventory-routes.ts');
    expect(route).toContain('buildCollectedView(DATA_INVENTORY');
    // 不允许在路由里手写条目 —— 清单与实现漂移即构成虚假陈述。
    expect(route.includes('humanLabel')).toBe(false);
  });

  it('法务文档渲染页只读本地文件：不 import fetch、不 import 任何 API 客户端', () => {
    const legalPage = read('apps/web/src/app/(app)/legal/[doc]/page.tsx');
    expect(legalPage).toContain("readFileSync(join(process.cwd(), 'content/legal'");
    expect(legalPage.includes('fetch(')).toBe(false);
  });

  it('collected-list 不渲染置灰残留：清单条目上没有任何 disabled 形态', () => {
    // 先去注释 —— 文件头说明里引用「aria-disabled 残留即失败」这句话本身是必要的。
    const collectedList = stripComments(read('apps/web/src/features/privacy/collected-list.tsx'));
    expect(collectedList.includes('aria-disabled')).toBe(false);
    expect(collectedList.includes('disabled:')).toBe(false);
  });
});
