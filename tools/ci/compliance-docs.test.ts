import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// 按路径 import 而不经包边界：@drift/llm 的包入口会拖进 router.ts → @drift/db，
// 而后者在模块加载时读 DATABASE_URL 并构造连接池。本条断言必须能在 ci:fast（不连任何
// 数据库）里跑，而 routes.ts 本身是纯配置。
import { ROUTES } from '../../packages/llm/src/routes.ts';

import {
  RECONCILE_REPORT_FIELDS,
  REGISTERED_USERS_CAP,
  buildReconcileReport,
  buildReconcileWecomPayload,
} from '../../apps/api/src/worker/jobs/publicness-reconcile.ts';
import { checkEgressHash } from './egress-hash.mjs';
import { USER_CAP } from './publicness.mjs';

/**
 * PRIV-09 / PRIV-10 / COMPLY-11 的合规产出物断言（L4）。
 *
 * 这一层把法务动作变成机器可验证的结构：**新增一个 provider 而没有对应的委托处理协议
 * 留档 ⇒ 构建失败。** 它的空真风险很明确 —— 只有四个 provider 且都已登记时，这条断言
 * 恒真。因此负向 fixture（一个含不存在 provider 的假路由表）与断言实现同等重要。
 */

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DPA_DIR = 'compliance/dpa';
const PIA_DOC = 'compliance/PIA-2026.md';

/** PIA 的五个必需章节（个保法第五十五条、第五十六条）。 */
const PIA_SECTIONS = [
  '处理目的与方式',
  '对个人权益的影响与安全风险',
  '保护措施的合法性有效性',
  '敏感个人信息说明',
  '委托处理说明',
];

function read(rel: string): string {
  return readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

/** 读 front-matter 为键值对。没有 front-matter 即抛错 —— 不静默当成通过。 */
function frontMatter(source: string, label: string): Map<string, string> {
  const matched = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(source);
  if (matched === null) {
    throw new Error(`${label} 没有 front-matter —— 协议留档与路由表失去绑定`);
  }
  const entries = new Map<string, string>();
  for (const line of (matched[1] ?? '').split('\n')) {
    if (line.trimStart().startsWith('#')) continue;
    const pair = /^([a-z_]+):\s*(.*)$/u.exec(line);
    if (pair === null) continue;
    entries.set(pair[1] ?? '', (pair[2] ?? '').trim());
  }
  return entries;
}

interface RouteLike {
  readonly provider: string;
  readonly enabled: boolean;
}

/** compliance/dpa/ 下每份留档的关键字段。 */
interface DpaRecord {
  readonly file: string;
  readonly provider: string;
  readonly status: string;
  readonly trainingDisabled: boolean;
  readonly hasEvidenceSection: boolean;
}

function loadDpaRecords(dir = DPA_DIR): DpaRecord[] {
  const absolute = path.join(REPO_ROOT, dir);
  return readdirSync(absolute)
    .filter((file) => file.endsWith('.md'))
    .sort()
    .map((file) => {
      const source = readFileSync(path.join(absolute, file), 'utf8');
      const meta = frontMatter(source, `${dir}/${file}`);
      return {
        file: `${dir}/${file}`,
        provider: meta.get('provider') ?? '',
        status: meta.get('status') ?? '',
        trainingDisabled: meta.get('data_used_for_training') === 'false',
        hasEvidenceSection: source.includes('## 关闭数据用于模型改进的配置证据'),
      };
    });
}

/** SKIPPED_CHECKS.md 的行 → 表格单元格。 */
function skippedRows(): string[][] {
  return read('SKIPPED_CHECKS.md')
    .split('\n')
    .filter((line) => line.startsWith('|'))
    .map((line) => line.split('|').map((cell) => cell.trim()));
}

/**
 * PRIV-10 的集合断言。**不通过即抛错**，且错误信息必须点名具体 provider。
 *
 * 三条：
 *   1. 路由表里每个 provider（mock 除外）都有一份留档；
 *   2. 反向 —— compliance/dpa/ 下没有孤儿文件；
 *   3. 每份留档都含 data_used_for_training: false 与配置证据章节；且**已启用**的 provider
 *      若尚未签署，必须在 SKIPPED_CHECKS.md 有一条带解除条件的登记。
 *
 * 第 3 条为什么按 enabled 分级：PLAT-05 不允许路由表留空洞，所以表里必然存在尚未启用的
 * provider（第一次用到时临时配一个会绕过全部启动期断言），而委托处理**在真实调用发生时
 * 才发生**。把「必须已签」的判据绑在 enabled 上，既不虚构一份没签的协议，也不给未签的
 * provider 留放行口子。
 */
function checkDpaCoverage(
  routes: Readonly<Record<string, RouteLike>>,
  records: readonly DpaRecord[],
  registeredGaps: readonly string[],
): void {
  const routed = new Set<string>();
  const enabled = new Set<string>();
  for (const route of Object.values(routes)) {
    if (route.provider === 'mock') continue;
    routed.add(route.provider);
    if (route.enabled) enabled.add(route.provider);
  }

  const byProvider = new Map(records.map((record) => [record.provider, record]));

  for (const provider of [...routed].sort()) {
    const record = byProvider.get(provider);
    if (record === undefined) {
      throw new Error(
        `路由表里的 provider ${provider} 在 ${DPA_DIR}/ 没有委托处理协议留档 —— ` +
          '个保法第二十一条要求委托处理有协议，事后补签无法覆盖已经发生的处理',
      );
    }
    if (!record.trainingDisabled) {
      throw new Error(
        `${record.file} 的 front-matter 缺少 data_used_for_training: false（provider ${provider}）`,
      );
    }
    if (!record.hasEvidenceSection) {
      throw new Error(`${record.file} 缺少「关闭数据用于模型改进的配置证据」章节（provider ${provider}）`);
    }
    if (enabled.has(provider) && record.status !== 'signed' && !registeredGaps.includes(provider)) {
      throw new Error(
        `provider ${provider} 在路由表中已启用（enabled: true）但 ${record.file} 的 status 是 ` +
          `${record.status}，且这个缺口没有登记进 SKIPPED_CHECKS.md —— 未签 DPA 的 provider ` +
          '不得静默放行',
      );
    }
  }

  for (const record of records) {
    if (!routed.has(record.provider)) {
      throw new Error(
        `${record.file} 是孤儿留档：provider ${record.provider} 不在路由表里 —— ` +
          '请复核它是否该删除，而不是让文件默默留着',
      );
    }
  }
}

/** 已在 SKIPPED_CHECKS.md 登记的「已启用但未签署」provider。 */
function registeredDpaGaps(): string[] {
  const row = skippedRows().find((cells) => cells[1] === 'dpa-unsigned-for-enabled-providers');
  if (row === undefined) return [];
  const why = row[2] ?? '';
  const condition = row[3] ?? '';
  if (condition.length === 0) return [];
  return [...new Set(Object.values(ROUTES).map((route) => route.provider))].filter((provider) =>
    why.includes(provider),
  );
}

describe('(a) PRIV-09：PIA 入 repo 且必需章节齐全', () => {
  it('文件存在且五个必需章节标题齐全', () => {
    expect(existsSync(path.join(REPO_ROOT, PIA_DOC))).toBe(true);
    const pia = read(PIA_DOC);
    for (const section of PIA_SECTIONS) {
      expect(pia, `PIA 缺少必需章节：${section}`).toContain(section);
    }
  });

  it('文件头注明留存期不少于 3 年（个保法第五十六条第二款）', () => {
    const meta = frontMatter(read(PIA_DOC), PIA_DOC);
    expect(meta.get('retention') ?? '').toContain('3 年');
    expect(meta.get('retention_until') ?? '').toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    expect(meta.get('assessed_at') ?? '').toMatch(/^\d{4}-\d{2}-\d{2}$/u);
  });

  it('两项不确定性已显式登记，且各自带解除条件', () => {
    const pia = read(PIA_DOC);
    // ① 文本类隐式标识的形态不明 —— 公开前的阻断项。
    expect(pia).toContain('GB 45438-2025');
    expect(pia).toContain('隐式标识');
    expect(pia).toContain('公开前必须完成此项复核');
    // ② 人格演化是否构成模型训练 —— 已按「构成」设计。
    expect(pia).toContain('第十六条第四款');
    expect(pia).toContain('按「构成」设计');
    expect((pia.match(/解除条件/gu) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('不含「我们是研究平台所以不适用」及其同义表述（PROJECT.md 的永久排除项）', () => {
    const pia = read(PIA_DOC);
    for (const banned of ['所以不适用本办法', '研究平台所以不适用', '不属于本办法适用范围']) {
      expect(pia.includes(banned), `PIA 出现了被永久排除的抗辩表述：${banned}`).toBe(false);
    }
    // 个保法没有小规模豁免这件事必须被写出来，而不是靠读者自己知道。
    expect(pia).toContain('个保法没有小规模豁免');
  });
});

describe('(b) PRIV-10：路由表 provider 集合与 compliance/dpa/ 的集合断言', () => {
  it('当前仓库通过（四个 provider 各有一份留档，无孤儿文件）', () => {
    const records = loadDpaRecords();
    expect(records.map((record) => record.provider).sort()).toEqual([
      'aliyun',
      'anthropic',
      'volcengine',
      'zhipu',
    ]);
    expect(() => {
      checkDpaCoverage(ROUTES, records, registeredDpaGaps());
    }).not.toThrow();
  });

  it('每份留档都含 data_used_for_training: false 与配置证据章节', () => {
    for (const record of loadDpaRecords()) {
      expect(record.trainingDisabled, `${record.file} 缺少 data_used_for_training: false`).toBe(true);
      expect(record.hasEvidenceSection, `${record.file} 缺少配置证据章节`).toBe(true);
      expect(record.provider.length).toBeGreaterThan(0);
      expect(record.status.length).toBeGreaterThan(0);
    }
  });

  it('mock 不需要 DPA（它不是一次委托处理）', () => {
    const withMock = {
      ...ROUTES,
      'memory.extract': { provider: 'mock', enabled: true },
    } as unknown as Readonly<Record<string, RouteLike>>;
    expect(() => {
      checkDpaCoverage(withMock, loadDpaRecords(), registeredDpaGaps());
    }).not.toThrow();
  });

  it('已启用但未签署的 provider 必须在 SKIPPED_CHECKS.md 有一条带解除条件的登记', () => {
    const row = skippedRows().find((cells) => cells[1] === 'dpa-unsigned-for-enabled-providers');
    const enabledUnsigned = loadDpaRecords().filter(
      (record) =>
        record.status !== 'signed' &&
        Object.values(ROUTES).some((route) => route.provider === record.provider && route.enabled),
    );
    if (enabledUnsigned.length === 0) {
      // 全部已签 ⇒ 那一行必须已被删除，否则它会变成一条永久留着的免责声明。
      expect(row, '所有已启用 provider 都已签署，SKIPPED_CHECKS.md 的那一行应当删除').toBeUndefined();
      return;
    }
    expect(row, '存在已启用但未签署的 provider，却没有任何登记').toBeDefined();
    const condition = row?.[3] ?? '';
    expect(condition.length, '解除条件为空 —— 等于写成「以后再说」').toBeGreaterThan(0);
    expect(condition).toContain('删除本行');
    expect(condition).toContain('LLM_PROVIDER_MODE=live');
    for (const record of enabledUnsigned) {
      expect(row?.[2] ?? '', `登记没有点名 ${record.provider}`).toContain(record.provider);
    }
  });
});

describe('(c) 负向 fixture：假路由表里的未登记 provider 必须让检查抛错', () => {
  it('喂一个含 openai 的假路由表 ⇒ 抛错且错误信息点名 openai', () => {
    const fakeRoutes: Readonly<Record<string, RouteLike>> = {
      'chat.reply': { provider: 'volcengine', enabled: true },
      // 未签 DPA 就被接进路由表的 provider —— T-13-07（critical）的确切形态。
      'chat.reply.experimental': { provider: 'openai', enabled: true },
    };
    expect(() => {
      checkDpaCoverage(fakeRoutes, loadDpaRecords(), registeredDpaGaps());
    }).toThrow(/openai/u);
    expect(() => {
      checkDpaCoverage(fakeRoutes, loadDpaRecords(), registeredDpaGaps());
    }).toThrow(/第二十一条/u);
  });

  it('孤儿留档同样抛错（provider 已从路由表移除而文件还在）', () => {
    const shrunk: Readonly<Record<string, RouteLike>> = {
      'chat.reply': { provider: 'volcengine', enabled: true },
    };
    expect(() => {
      checkDpaCoverage(shrunk, loadDpaRecords(), registeredDpaGaps());
    }).toThrow(/孤儿留档/u);
  });

  it('已启用、未签署、且登记被删掉 ⇒ 抛错（登记不是可选项）', () => {
    expect(() => {
      checkDpaCoverage(ROUTES, loadDpaRecords(), []);
    }).toThrow(/不得静默放行/u);
  });

  it('留档缺少 data_used_for_training: false ⇒ 抛错（注入一条坏记录）', () => {
    const records = loadDpaRecords().map((record) =>
      record.provider === 'volcengine' ? { ...record, trainingDisabled: false } : record,
    );
    expect(() => {
      checkDpaCoverage(ROUTES, records, registeredDpaGaps());
    }).toThrow(/data_used_for_training/u);
  });
});

describe('(d) COMPLY-11 交叉复核：登记文件的 egress_hash 与当前出口集合一致', () => {
  it('哈希一致（算法只有 egress-hash.mjs 一份实现，这里只做交叉复核）', () => {
    const result = checkEgressHash();
    expect(result.ok, result.message).toBe(true);
  });

  it('登记文件逐条覆盖了对账告警这条出口', () => {
    const doc = read('compliance/no-unlabeled-output.md');
    expect(doc).toContain('reconcile.publicnessWebhook');
    expect(doc).toContain('ReconcileReport');
  });
});

describe('对账的两处常量与载荷（D-23 / T-13-09）', () => {
  it('注册用户上限在 CI 脚本与运行时作业里是同一个值', () => {
    // 两份定义是刻意的（CI 脚本不能 import apps/api 的常量域，反之亦然），
    // 分叉由这条断言挡着。
    expect(REGISTERED_USERS_CAP).toBe(USER_CAP);
  });

  it('对账报告恰好四个字段，且没有一个是文本', () => {
    expect([...RECONCILE_REPORT_FIELDS]).toEqual(['declared', 'actual', 'matches', 'withinCap']);
    const report = buildReconcileReport(3, 7);
    expect(Object.keys(report).sort()).toEqual([...RECONCILE_REPORT_FIELDS].sort());
    for (const value of Object.values(report)) {
      expect(typeof value === 'number' || typeof value === 'boolean').toBe(true);
    }
  });

  it('告警载荷里不出现任何用户标识（载荷只由两个计数渲染）', () => {
    const body = JSON.stringify(buildReconcileWecomPayload(buildReconcileReport(3, 7)));
    for (const identifier of ['user_', 'usr-', 'INVITE-', '@example.com']) {
      expect(body.includes(identifier), `对账载荷出现了 ${identifier}`).toBe(false);
    }
    expect(body).toContain('3');
    expect(body).toContain('7');
    expect(body).toContain('不含任何用户标识与对话内容');
  });

  it('nightly.yml 真的会跑对账，且只跑一次', () => {
    const workflow = read('.github/workflows/nightly.yml');
    expect(workflow.match(/node tools\/ci\/publicness-reconcile\.mjs/gu) ?? []).toHaveLength(1);
  });
});
