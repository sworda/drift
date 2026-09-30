// tests/probes/crisis/*.yaml 的解析器 —— 受控子集，非通用 yaml 实现。
//
// ── 为什么手写而不用解析库 ─────────────────────────────────────────────────
// 仓库里没有已声明的 yaml 依赖（js-yaml 只是某个工具链的传递依赖，从根解析不到），
// 而新增解析库要走 Plan 02 的 blocking-human 包合法性 checkpoint（T-08-SC）。探针
// 文件是我们自己写的、进 git 的、形状固定的 —— 一个 60 行的严格子集解析器 + zod
// 全量校验，比引一个新依赖便宜且不扩大攻击面。任何不符合子集的行直接抛错，
// 而不是尽力猜测（猜出来的用例会把探针集变成一次静默的抽样）。
//
// ── 受控子集的形状（唯一合法形态）─────────────────────────────────────────
//   - id: some.id                  ← 列表项首行，indent 0
//     text: |                      ← 块标量，indent 2；正文行 indent ≥ 4
//       正文…
//     inject:                      ← 可选嵌套 map，indent 2 / 键 indent 4
//       classify: timeout
//     expect:                      ← 必填嵌套 map，indent 2 / 键 indent 4
//       level: elevated
//   `#` 开头的注释行与空行任意分布；除此之外的一切都是语法错误。

import { z } from 'zod';

export const CLASSIFY_INJECTIONS = ['timeout', 'schema', 'low_confidence'] as const;
export const WEBHOOK_INJECTIONS = ['ok', 'fail'] as const;

const ProbeExpectSchema = z.object({
  level: z.enum(['none', 'watch', 'elevated', 'crisis']),
  card: z.enum(['none', 'level1', 'level2']),
  contactAttempt: z.enum(['none', 'pending', 'delivered', 'failed', 'unavailable']),
  safetyEvent: z.number().int().nonnegative(),
  /** bypass 用例：断言 gated 回复的 message.disclosure 非空（AI 标识在场）。 */
  replyDisclosed: z.boolean().optional(),
  /** webhook-fail 用例：断言二级卡片的 hotlineFirst 为真（热线提到首屏第一行）。 */
  hotlineFirst: z.boolean().optional(),
});

const ProbeCaseSchema = z.object({
  id: z
    .string()
    .regex(
      /^crisis\.(l1|l2\.selfharm|l2\.fin|neg|bypass|failure)\.[a-z0-9]+([.-][a-z0-9]+)*$/u,
      '用例 id 必须落在六个命名空间之一（crisis.l1.* / crisis.l2.selfharm.* / crisis.l2.fin.* / crisis.neg.* / crisis.bypass.* / crisis.failure.*）',
    ),
  text: z.string().min(1).max(2_000),
  inject: z
    .object({
      classify: z.enum(CLASSIFY_INJECTIONS).optional(),
      webhook: z.enum(WEBHOOK_INJECTIONS).optional(),
    })
    .optional(),
  expect: ProbeExpectSchema,
});

export type ProbeExpect = z.infer<typeof ProbeExpectSchema>;
export interface ProbeCase {
  readonly id: string;
  readonly text: string;
  readonly inject?: {
    readonly classify?: (typeof CLASSIFY_INJECTIONS)[number] | undefined;
    readonly webhook?: (typeof WEBHOOK_INJECTIONS)[number] | undefined;
  } | undefined;
  readonly expect: ProbeExpect;
}

/**
 * 解析受控子集为原始对象（不做 schema 校验）。
 *
 * 探针文件族共用这一个解析核心（crisis 与 exit-keywords）；各自的 zod schema
 * 由消费方叠加 —— 子集的形状约定只有一份，校验的宽严各归各的测试。
 */
export function parseControlledYaml(
  source: string,
  fileLabel: string,
): readonly Record<string, unknown>[] {
  return parseItems(source, fileLabel).map((item) =>
    Object.fromEntries(
      [...item].map(([key, value]) => [
        key,
        value instanceof Map ? Object.fromEntries(value) : value,
      ]),
    ),
  );
}

/** 解析受控子集。任何偏离子集的输入抛错（文件名进错误信息，方便定位）。 */
export function parseProbeYaml(source: string, fileLabel: string): readonly ProbeCase[] {
  const objects = parseItems(source, fileLabel).map((item) =>
    Object.fromEntries(
      [...item].map(([key, value]) => [
        key,
        value instanceof Map ? Object.fromEntries(value) : value,
      ]),
    ),
  );
  const parsed = z.array(ProbeCaseSchema).safeParse(objects);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`${fileLabel}: 用例 schema 校验失败 —— ${issues}`);
  }
  return parsed.data;
}

/** 受控子集的解析核心：产出嵌套 Map 的条目列表（parseControlledYaml / parseProbeYaml 共用）。 */
function parseItems(source: string, fileLabel: string): Map<string, unknown>[] {
  const items: Map<string, unknown>[] = [];
  let current: Map<string, unknown> | null = null;
  let nested: Map<string, unknown> | null = null;
  let textBuffer: string[] | null = null;

  function closeText(): void {
    if (textBuffer !== null && current !== null) {
      // 去掉块标量首尾的空行；正文原样保留（含内部空行）。
      const lines = textBuffer;
      while (lines.length > 0 && lines[0] === '') lines.shift();
      while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
      current.set('text', lines.join('\n'));
      textBuffer = null;
    }
  }

  for (const rawLine of source.split('\n')) {
    const line = rawLine.replace(/\r$/u, '');
    const trimmed = line.trim();

    if (textBuffer !== null) {
      // 块标量正文：空行，或缩进 ≥ 4 的行。
      if (trimmed === '' || /^ {4,}/u.test(rawLine)) {
        textBuffer.push(rawLine.replace(/^ {4}/u, ''));
        continue;
      }
      closeText();
    }

    if (trimmed === '' || trimmed.startsWith('#')) continue;

    if (/^- /u.test(rawLine)) {
      closeText();
      nested = null;
      current = new Map();
      items.push(current);
      const rest = rawLine.slice(2);
      if (!/^id: /u.test(rest)) {
        throw new Error(`${fileLabel}: 列表项首行只能是「- id: …」，收到「${rest}」`);
      }
      current.set(...splitKeyValue(rest, fileLabel));
      continue;
    }

    if (/^  [a-zA-Z]+: /u.test(rawLine) || /^  [a-zA-Z]+:$/u.test(rawLine)) {
      nested = null;
      if (current === null) throw new Error(`${fileLabel}: 缩进 2 的键出现在任何列表项之前`);
      const key = /^  ([a-zA-Z]+):/u.exec(rawLine)?.[1] ?? '';
      const value = rawLine.slice(2 + key.length + 1).trim();
      if (value === '|') {
        if (key !== 'text') {
          throw new Error(`${fileLabel}: 块标量只支持 text，收到「${key}」`);
        }
        textBuffer = [];
      } else if (value === '') {
        // 嵌套 map（expect / inject）的开头。
        nested = new Map();
        current.set(key, nested);
      } else {
        current.set(key, parseScalar(value));
      }
      continue;
    }

    if (/^    [a-zA-Z]+: /u.test(rawLine)) {
      if (nested === null) {
        throw new Error(`${fileLabel}: 缩进 4 的键必须紧跟在 expect:/inject: 之下，收到「${trimmed}」`);
      }
      nested.set(...splitKeyValue(trimmed, fileLabel));
      continue;
    }

    throw new Error(
      `${fileLabel}: 不属于受控 yaml 子集的行「${rawLine}」—— 解析器刻意不做猜测。`,
    );
  }
  closeText();
  return items;
}

function splitKeyValue(
  pair: string,
  fileLabel: string,
): [string, unknown] {
  const separator = pair.indexOf(': ');
  if (separator === -1) throw new Error(`${fileLabel}: 只支持「键: 值」形式，收到「${pair}」`);
  const key = pair.slice(0, separator);
  return [key, parseScalar(pair.slice(separator + 2))];
}

function parseScalar(raw: string): string | number | boolean {
  const value = raw.trim();
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^\d+$/u.test(value)) return Number.parseInt(value, 10);
  return value;
}