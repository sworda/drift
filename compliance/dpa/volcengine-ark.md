---
provider: volcengine
provider_name: 火山引擎 · 火山方舟（Volcengine Ark）
# 本项目对该受托方的**要求状态**：不得将本项目数据用于模型改进（个保法第二十一条）。
# 这个键是要求，不是观测 —— 观测结果在 evidence_captured_at 与 status 两个键里，
# 并由 tools/ci/compliance-docs.test.ts 绑定：未签且路由已启用时必须在
# SKIPPED_CHECKS.md 有一条带解除条件的登记，否则构建失败。
data_used_for_training: false
signed_at: null
evidence_captured_at: null
status: pending_signature
reviewed_at: 2026-09-27
reviewed_by: zexueli
---
# 委托处理协议留档 —— 火山方舟（volcengine）

**角色**：`chat.reply`（境内，Phase 1 **已启用**）、`persona.probe`（未启用）。
**模型**：`doubao-seed-character-251128`。**baseURL**：`https://ark.cn-beijing.volces.com/api/v3`。

## 当前状态（如实登记）

⚠️ **`status: pending_signature`，`signed_at` 与 `evidence_captured_at` 均为 null。**

事实如下，不做任何美化：

1. 本项目尚**未**与火山引擎签署书面的数据处理协议；
2. 「数据用于模型改进」开关的控制台配置证据**尚未捕获**；
3. 因此本文件目前是**协议要求与证据待补的留档**，不是一份已生效协议的副本。

为什么这不等于「已经发生了无协议的委托处理」：`LLM_PROVIDER_MODE` 默认为 `mock`，Phase 1
未向该 provider 发起任何真实调用，**委托处理尚未发生**。个保法第二十一条规制的是处理
行为本身，而未发生的处理不存在事后补签的问题 —— 但这也正是为什么「首次真实调用」被
设为阻断项：一旦调用发生，就再也补不回来了。

该缺口已登记 `SKIPPED_CHECKS.md` 的 `dpa-unsigned-for-enabled-providers`，解除条件是
签署协议、关闭开关、捕获证据、把本文件的 `status` 改为 `signed` 并删除那一行。

## 关闭数据用于模型改进的配置证据

**要求的状态**：关闭「用户数据用于模型训练 / 服务改进」类开关，并留存配置证据。

需要捕获的证据（逐项，不接受「已确认」这类无指向的表述）：

| 证据项 | 位置 | 要求取值 | 当前 |
|---|---|---|---|
| 账号级数据使用开关 | 火山引擎控制台 → 方舟 → 账号/空间设置 → 数据使用与隐私 | 关闭「用于模型改进」 | **未捕获** |
| 请求级不落日志标记 | API 请求参数（若该 provider 提供） | 显式关闭内容留存 | **未捕获** |
| 截图留档 | `compliance/evidence/volcengine-ark-<日期>.png` | 含账号标识与截图时间 | **未捕获** |
| 协议文本 | `compliance/evidence/volcengine-ark-dpa-<日期>.pdf` | 含数据处理条款与再委托限制 | **未捕获** |

本项目侧已经成立的部分（这些是 git 内可核对的事实，不依赖对方）：

- 请求中**不包含**任何训练标记或数据共享同意标记；
- `llm_call` 只落 `input_hash`，不落请求正文，因此本项目自身不构成第二份正文副本；
- `baseURL` 写死在 git，改它必须过一次 code review 与一次 CI。

## 数据处理范围

| 项 | 内容 |
|---|---|
| 处理者角色 | **受托处理者**（个保法第二十一条），不是第二十三条的「接收方」 |
| 委托处理的目的 | 仅限完成本次推理请求并返回结果 |
| 传输的数据 | 系统提示词、人格小传、当轮及上下文窗口内的对话消息（含用户原文） |
| **不**传输的数据 | 账号标识、邀请码、同意记录、紧急联络人、审计表族的任何行 |
| 传输方向 | 仅境内（`packages/llm/src/hosts.ts` 的 `ALLOWED_LLM_HOSTS`），启动期断言拒绝表外 host |
| 落库的调用记录 | `llm_call` 只落 `input_hash` 与 `prompt_version`，**不落请求正文** |

## 留存与删除

- 要求受托方**不得留存超过完成本次推理所必需的期限**，不得将请求内容并入任何长期存储。
- 本项目侧：对话正文留在 `message` 表，保存期为账号存续期 + 24 个月硬上限滚动清理；
  `llm_call` 保存 6 个月。
- 用户行使删除权时（PRIV-05，Plan 11）本项目侧级联删除；**受托方侧的删除依赖协议约定**
  —— 这是一处如实标注的限制：我们无法在技术上验证对方是否真的没有留存。因此第一道
  防线是「不传不必要的数据」，而不是「传了再要求删掉」。

## 安全措施

- 传输层 TLS；`baseURL` 写死在 git（`packages/llm/src/routes.ts`），**不接受运行时覆盖**
  —— 环境变量可以在运行时被改成一个网关地址，而那正是「真实对话出境」这条不可逆风险的
  确切形态。
- 已知 AI 网关地址在 `DENIED_LLM_HOSTS` 黑名单里，三张 host 表互不相交由启动期断言保证。
- 凭据只存在境内本机的进程环境，不进 git、不进 GitHub Secrets（D-02）。
- 出站内容经安全网关（`packages/safety`），角色回复在落库时注入 AI 明示标识。

## 再委托限制

要求受托方**不得转委托**：未经本项目书面同意，不得将处理活动的任何部分再委托给第三方
（个保法第二十一条第三款）。若受托方的服务架构本身包含其自有的下游供应商，必须在协议
附件中列明，并作为本文件的一次实质变更重新复核。

## 变更与复核触发条件

- 路由表（`packages/llm/src/routes.ts`）中该 provider 的 `enabled`、`baseURL`、
  `modelSnapshot` 任一变化；
- 该 provider 的服务协议或数据处理条款更新；
- 首次以 `LLM_PROVIDER_MODE=live` 向该 provider 发起真实调用之前（**阻断项**）。

复核后更新 front-matter 的 `reviewed_at` / `reviewed_by`，并与代码改动在同一个 commit。

机械保证：`tools/ci/compliance-docs.test.ts` 断言路由表里每个 provider（`mock` 除外）都
在本目录有对应文件、反向不得有孤儿文件、本文件含 `data_used_for_training: false` 与
「配置证据」章节；并断言 `volcengine` 若在路由表中已启用而本文件仍未签署，则
`SKIPPED_CHECKS.md` 必须有一条带解除条件的登记。
