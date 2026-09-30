// 负向 type fixture —— 两条类型层约束的唯一守卫。
//
// 对本目录跑 tsc **必须**退出码非 0，且本文件至少报出 2 条 error TS：
//
//  1. `{ mode: 'routed', role: 'persona.probe' }` —— 探针不可走路由表。
//     routed 模式带降级链，而降级就是换模型：允许探针回退到 routed 等于允许尺子
//     在被测量的过程中被静默替换，而结果看起来完全正常（STACK §15.9 规则 0）。
//  2. 把普通 string 传给 `callFrontier` —— 境外通道只接受 SyntheticText（PLAT-07）。
//     PITFALLS 把「用户原文误发境外 provider」列为 HIGH 且**不可逆**（发出即已出境），
//     所以这条防线必须在编译期。
//
// ⚠️ 如果本文件竟然编译通过，说明 CallMode 的 Exclude 或 FrontierMessages 的品牌
// 类型已经退化成了普通字符串 —— 两者退化时都**零报错**，这是本阶段最危险的静默
// 失效形态之一。
import { callFrontier, type CallMode, type FrontierMessages } from '@drift/llm';

declare const request: Omit<Parameters<typeof callFrontier>[1], never>;
declare const executor: Parameters<typeof callFrontier>[2];

// 违反 1：探针走 routed。
export const probeRouted: CallMode = { mode: 'routed', role: 'persona.probe' };

// 违反 2：真实用户原文（普通 string）传进境外通道。
void callFrontier(['我今天很难过，想找人说说话。'], request, executor);

// 违反 3：同一条约束的赋值形态 —— string[] 不是 SyntheticText[]。
export const realUserText: FrontierMessages = ['我今天很难过，想找人说说话。'];

// 下面这行 tsc **不会**报错：SyntheticText 是 string 的子类型，向下断言在类型系统里
// 合法。这正是 eslint.config.js 里两条 as SyntheticText 选择器必须存在的理由 ——
// 编译期挡不住断言，只有 lint 能挡。
export const byAssertion: FrontierMessages = ['我今天很难过。' as never];
