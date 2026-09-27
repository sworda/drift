// 负向 fixture（V.0 #2）—— any 穿过只接受 GatedText 的出口。
//
// branded type 在运行时被擦除，而 deliver(anyValue, seq) 在默认 tsc 配置下**不报错**：
// any 可赋给任何类型。一个 JSON.parse(body)、一个 catch (e)、一个未标注返回类型的第三
// 方回调，都能把一段没过网关的文本送进出口。三层防线里只有 type-aware 的
// @typescript-eslint/no-unsafe-argument 能堵住这条通道。
//
// 对本文件跑 eslint **必须**报出 no-unsafe-argument。注意它需要类型信息，因此
// eslint.config.js 为这一个文件单独开了 type-aware（同目录其他 fixture 是关掉的），
// 配的 tsconfig 是 tools/ci/fixtures/tsconfig.json。
//
// 这里重声明 deliver 的签名而不 import 真实模块：被测对象是**规则是否活着**，不是那个
// 模块 —— import 会把 ws / pino 的整张类型图拖进一个负向 fixture 的 program。
import type { GatedText } from '@drift/contract';

declare function deliver(text: GatedText, seq: number): number;

const parsed = JSON.parse('{"text":"一段没有经过出站网关的模型输出"}');

export const sent = deliver(parsed.text, 1);
