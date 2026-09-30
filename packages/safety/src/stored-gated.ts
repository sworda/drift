// 历史角色消息的受控重出口（Plan 11 / COMPLY-02）—— 导出管道的接缝。
//
// 为什么需要它：renderExportLine（三个承载对话文本的出口之一）只接受 GatedText，
// 而 message 表读回来的 text 是普通 string。重新把历史文本过一遍 safetyGateway 是
// 错的方向 —— 网关的判定对象是「此刻生成的候选回复」，历史消息在落库当时已经
// 过了网关（insertCharacterMessage 的 GatedText 签名），重新判定只会因为分类器
// 版本变化而可能拒绝一段早已投递过的文本。
//
// 所以这里提供的是**恢复**而不是**产生**：输入必须带 message.disclosure
//（COMPLY-09 的 DB CHECK 保证角色消息非空 —— 它就是「这条文本过过网关」的
// 留证），disclosure 不合法就抛错。这不是第二个「产出点」：它不产生任何新的
// 可投递文本，只把已落库的历史消息恢复成编译期可传给出口的类型。
//
// ⚠️ 全仓库第二处（也是最后一处）受控的 as GatedText —— 第一处在 gateway.ts 的
// 唯一产出点。eslint 的仓库级禁令在使用点上豁免，与 gateway.ts 同一形态。

import type { Disclosure, GatedText } from '@drift/contract';

/**
 * 把一条**已带 disclosure 留证**的历史角色消息恢复为 GatedText。
 *
 * @param text message.text 的库值。
 * @param disclosure 同一行的 message.disclosure —— 合法性的唯一来源。
 * @throws disclosure 不是 ai_generated 形态时抛错（无法证明这段文本过过网关）。
 */
export function gatedFromStoredCharacterMessage(
  text: string,
  disclosure: Disclosure,
): GatedText {
  if (disclosure.kind !== 'ai_generated') {
    throw new Error(
      `拒绝恢复历史角色消息：disclosure 形态不是 ai_generated（实际 ${disclosure.kind}）—— 没有留证就不能当作过过网关的文本`,
    );
  }
  // eslint-disable-next-line no-restricted-syntax -- 全仓第二处受控提升（见文件头），与 gateway.ts 的唯一产出点同一豁免形态
  return text as GatedText;
}
