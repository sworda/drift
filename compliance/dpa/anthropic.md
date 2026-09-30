---
provider: anthropic
provider_name: Anthropic（**境外**）
# 本项目对该受托方的**要求状态**：不得将本项目数据用于模型改进（个保法第二十一条）。
# 这个键是要求，不是观测 —— 观测结果在 evidence_captured_at 与 status 两个键里，
# 并由 tools/ci/compliance-docs.test.ts 绑定：未签且路由已启用时必须在
# SKIPPED_CHECKS.md 有一条带解除条件的登记，否则构建失败。
data_used_for_training: false
signed_at: null
evidence_captured_at: null
status: not_required_yet
reviewed_at: 2026-09-27
reviewed_by: zexueli
---
# 委托处理协议留档 —— Anthropic（anthropic，境外）

**角色**：`chat.reply.frontier`（**境外**，Phase 1 **未启用**，`enabled: false`）。
**模型**：`claude-sonnet-5`。**baseURL**：`https://api.anthropic.com/v1`。

## 这一条的性质与另三家不同：它是跨境，不只是委托

向境外提供个人信息除第二十一条的委托处理要求之外，**另需个保法第三十八条以下的单独同意
与出境合规路径**（安全评估 / 标准合同 / 认证）。本项目不打算走这条路径，因此采取的是
**在类型层让真实用户原文传不进去**：

- `chat.reply.frontier` 已从 `CallMode` 中整个移除，唯一入口是
  `callFrontier(readonly SyntheticText[])`；普通 `string` 在编译期就传不进去，负向
  type fixture 证明这一点。
- host 白名单拆成境内（`ALLOWED_LLM_HOSTS`）与**仅合成**（`SYNTHETIC_ONLY_HOSTS`）两张
  互斥表，`api.anthropic.com` 只在后一张表里。

换句话说：**本 provider 的合规立场不是「签了协议所以可以传」，而是「真实用户原文在技术
上传不进去」。** 协议只覆盖合成文本的处理。

## 为什么路由表里必须有它

`PLAT-07` 要求必须存在一个境外的 frontier 条目（用于能力对照），`PLAT-05` 不允许该条目
缺字段。给它填一个假的 `baseURL` 会让配置与它声明的模型不自洽 —— 那是比空洞更糟的状态。

## 启用前的阻断项（四条，缺一不可）

1. 与 Anthropic 签署数据处理条款，含不得用于训练、留存期限、不得转委托；
2. 在控制台关闭「数据用于模型改进」类开关并捕获证据；
3. **确认该角色的输入仍然只可能是合成文本**；若要传任何真实用户数据，必须先完成第三十八
   条以下的出境合规路径与单独同意 —— 这是一次独立的法律动作，不在本文件覆盖范围内；
4. 把本文件的 `status` 改为 `signed` 并在同一个 commit 里改 `routes.ts` 的 `enabled`。

## 关闭数据用于模型改进的配置证据

**要求的状态**：关闭「用户数据用于模型训练 / 服务改进」类开关，并留存配置证据。

| 证据项 | 位置 | 要求取值 | 当前 |
|---|---|---|---|
| 账号级数据使用开关 | Anthropic Console → Organization → Data controls | 关闭「用于模型改进」 | **未捕获（角色未启用）** |
| 截图留档 | `compliance/evidence/anthropic-<日期>.png` | 含组织标识与截图时间 | **未捕获（角色未启用）** |
| 协议文本 | `compliance/evidence/anthropic-dpa-<日期>.pdf` | 含数据处理条款与再委托限制 | **未捕获（角色未启用）** |

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
「配置证据」章节；并断言 `anthropic` 若在路由表中已启用而本文件仍未签署，则
`SKIPPED_CHECKS.md` 必须有一条带解除条件的登记。
