# 公开性状态变更合规 checklist（2026-09-27，基线首签）

依据模板 `compliance/CHECKLIST-TEMPLATE.md`。本份是**基线首签**：`compliance/publicness.json`
首次入仓，四项状态从「无登记」变为登记值，因此需要一次签字。

## 勾选的语义（重要）

勾选等于「这一条已经作出裁决，且裁决与证据写在下面的表里」，不等于「这件事已经做完了」。
裁决只有 `implemented` 与 `not_applicable` 两个取值，后者**仅当四条抗辩全部成立时**可用。
本次四条抗辩全部成立（见下），因此六条全部裁决为 `not_applicable`。

⚠️ 四条抗辩任一破裂后 `not_applicable` 不再是合法裁决，`tools/ci/publicness.mjs` 的
`CHECKLIST_FULLY_CHECKED` 会因此失败 —— 那一刻这六条必须逐条实装才能再次签字通过。

## 变更记录

- **变更日期**：2026-09-27
- **变更项**：四项状态首次登记 —— `public_signup_entrance`: 无登记 → `false`；
  `app_store_listed`: 无登记 → `false`；`registered_users`: 无登记 → `0`；
  `monetized`: 无登记 → `false`
- **确认人**：zexueli

## 四条抗辩的当前事实

| 抗辩 | 当前取值 | 事实依据 |
|---|---|---|
| 无公开注册入口 | `public_signup_entrance: false` | 准入唯一路径是一次性邀请码（`packages/db/src/schema/invite.ts`，D-23 明确否决通用多次码）；`apps/api/src/modules/auth/routes.ts` 的注册入口要求一个未使用且未撤销的码 |
| 未上架应用商店 | `app_store_listed: false` | Phase 1 只有 Web 端（`apps/web`），没有任何移动端分发产物 |
| 注册用户数 ≤ 10 | `registered_users: 0` | 尚无任何邀请码被消耗（`invite_code.used_by` 全为空）；对账由 `tools/ci/publicness-reconcile.mjs` 每日执行 |
| 无商业化 | `monetized: false` | 无支付、无订阅、无广告代码路径 |

## 必需条目（六条，全部已勾选）

- [x] `security_assessment` 安全评估：已完成生成式人工智能服务的安全评估并留档（评估报告
      与自评结论），或已按上表裁决为不适用并给出依据。
- [x] `algorithm_filing` 算法备案：已完成算法备案（或已确认调用已备案模型走地方网信办
      应用登记的较轻路径并留存受理凭证），或已裁决为不适用并给出依据。
- [x] `minor_mode` 未成年人模式：已实装（年龄识别路径、未成年人不可用或受限的执行点、
      监护人告知文案）且有一条会失败的检查守着它，或已裁决为不适用并给出依据。
- [x] `crisis_intervention` 危机干预：两级危机识别与干预已上线、危机探针集通过率 100%、
      二级危机的会话外联络通道真实可达（不是只有文案），或已裁决为不适用并给出依据。
- [x] `two_hour_reminder` 2 小时提醒：连续使用时长提醒已实装在**服务端**计时（前端计时在
      刷新与多端下不成立）且文案与 UI-SPEC 的〔法定〕呈现契约一致，或已裁决为不适用并给出依据。
- [x] `appeal_channel` 申诉渠道：用户申诉与投诉渠道已上线且有人值守、响应时限已写进对外
      文案并可被核对，或已裁决为不适用并给出依据。

## 逐条裁决与证据

| 条目 | 裁决 | 证据 |
|---|---|---|
| `security_assessment` | `not_applicable` | 四条抗辩全部成立（见上表），主张不构成《人工智能拟人化服务管理办法》第二条的「向公众提供」；依据 `.planning/research/PITFALLS-COMPLIANCE.md` §1.6 开放问题 3（Confidence Low-Medium）。个保法侧无豁免，因此 PIA 仍已完成：`compliance/PIA-2026.md` |
| `algorithm_filing` | `not_applicable` | 同上抗辩。备案路径已预先确认：调用已备案模型走地方网信办应用登记的较轻路径（`.planning/research/PITFALLS-COMPLIANCE.md` §1.2）；受托方与模型清单见 `compliance/dpa/` |
| `minor_mode` | `not_applicable` | 同上抗辩。准入是一次性邀请码的熟人范围，无公开注册入口（`packages/db/src/schema/invite.ts`）；一旦 `public_signup_entrance` 转 `true`，本条即不可再裁决为不适用 |
| `crisis_intervention` | `not_applicable` | 同上抗辩，且不是发布阻断项。事实状态：两级危机干预是 Phase 1 的交付内容（SAFE-01..05），出站安全网关与挽留话术拦截已落地（`packages/safety/src/gateway.ts`、`tools/ci/egress-registry.test.ts`），会话外联络通道与危机探针集分别在 Plan 07 / Plan 08 —— 本条在四条抗辩破裂前不得以「已上线」勾选 |
| `two_hour_reminder` | `not_applicable` | 同上抗辩。COMPLY-03 的服务端计时在 Phase 1 内交付（Plan 12）；当前尚未实装，因此本条只能是 `not_applicable`，不得记为 `implemented` |
| `appeal_channel` | `not_applicable` | 同上抗辩。当前无对外申诉渠道；运营者联络通道是 `WECOM_WEBHOOK_URL` 的 IM 告警，它服务的是二级危机而非用户申诉，二者不可混记 |
