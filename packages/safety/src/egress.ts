// 出站出口注册表 —— 堵住 branded type 方案**唯一**的结构性缺口（RESEARCH §3.4）。
//
// 缺口是什么：三个出口的签名只接受 GatedText，于是「有没有一条生成路径绕过了出站
// 网关」由编译器回答而不是由 code review 回答。但**新增第四个出口如果接受 string，
// 类型系统不会报错** —— 类型系统只检查已经写成 GatedText 的那些签名，它对「本该写
// GatedText 却写成了 string」这件事没有任何意见。这是本方案唯一的结构性缺口。
//
// 这份注册表把那个缺口变成一条可失败的检查。tools/ci/egress-registry.test.ts 用
// TypeScript compiler API 扫全仓，取出所有「参数类型解析后含 GatedText」的导出函数，
// 断言其集合**恰好等于**本表中 carriesUserText 不为 false 的项，于是：
//   - 新增一个接受 GatedText 的导出函数而不登记 → 集合多一项 → 红
//   - 把某个出口的参数从 GatedText 改回 string     → 集合缺一项 → 红
//
// ── 两条不可协商 ────────────────────────────────────────────────────────────
//
//  1. **不得为了让集合相等断言变绿而从本表删项。** 删注册表项与修出口是两件完全
//     不同的事：前者只是把红色改成绿色，出口本身仍然在绕过网关。
//  2. **本文件不得 import 任何东西。** tools/ci/egress-hash.mjs 借 Node 的类型擦除
//     直接 import 它来算 COMPLY-11 的 egress_hash；一旦这里出现 import，那条哈希
//     计算就要么被拖进整个依赖图（于是在 CI 的纯静态 job 里算不出来），要么退化成
//     一份复制的常量表 —— 而复制的表会分叉，分叉之后哈希守的就不是真的出口集合。

/**
 * 一个出站出口。
 *
 * module 与 fn 是**断言的对象**，不是注释：集合相等断言按这两个字段与 AST 扫描结果
 * 比对，写错路径会让断言红，而不是让它悄悄漏掉一个出口。
 */
export interface EgressPoint {
  /** 稳定 id。egress_hash 按它排序，所以它同时是登记文件里那份清单的主键。 */
  readonly id: string;
  /** 仓库相对路径（posix 分隔符）。 */
  readonly module: string;
  /** 导出的函数名。 */
  readonly fn: string;
  /**
   * 该出口是否承载对话文本。省略 = true。
   *
   * 只有 false 的项不参与 GatedText 集合相等断言 —— 因为它根本不该看见对话文本。
   * 它的约束由另一条断言负责：告警载荷序列化后不含触发消息的任何片段（SAFE-16）。
   */
  readonly carriesUserText?: boolean;
}

/**
 * Phase 1 的四个出站出口。
 *
 * 前三个承载对话文本，签名只接受 GatedText。第四个（acute 告警）是 D-09 引入的一条
 * **新的个人信息流向**：它是出口，但不得携带对话文本 —— 告警 JSON 不会有人去读，
 * 所以「它带上了对话片段」这件事只能靠断言发现，不能靠复核发现。
 */
export const EGRESS_POINTS = [
  {
    id: 'ws.deliver',
    module: 'apps/api/src/ws/server.ts',
    fn: 'deliver',
  },
  {
    id: 'db.insertCharacterMessage',
    module: 'packages/db/src/message.ts',
    fn: 'insertCharacterMessage',
  },
  {
    id: 'export.renderLine',
    module: 'apps/api/src/modules/export/render.ts',
    fn: 'renderExportLine',
  },
  {
    id: 'alert.acuteWebhook',
    module: 'apps/api/src/modules/safety/alert.ts',
    fn: 'notifyOperator',
    // ← D-09 的 IM 告警：是出口，但不得携带对话文本（SAFE-16）。
    carriesUserText: false,
  },
] as const satisfies readonly EgressPoint[];

/** 承载对话文本的出口 —— 即签名必须只接受 GatedText 的那些。 */
export const TEXT_CARRYING_EGRESS_POINTS: readonly EgressPoint[] = EGRESS_POINTS.filter(
  (point) => ('carriesUserText' in point ? point.carriesUserText : true) !== false,
);
