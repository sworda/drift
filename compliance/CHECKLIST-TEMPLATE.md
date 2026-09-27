# 公开性状态变更合规 checklist（模板）

**用法**：`compliance/publicness.json` 的四项状态（`public_signup_entrance` /
`app_store_listed` / `registered_users` / `monetized`）任一发生变化时，复制本模板为
`compliance/CHECKLIST-<YYYY-MM-DD>.md`，逐条裁决并勾选，然后在**同一个 commit** 里更新
`publicness.json` 的 `acknowledged_hash` 与 `acknowledged_checklist`。

**为什么是一份新文件而不是改这一份**：签字是一次有日期的动作。改同一份文件会让「上一次
是谁在什么状态下确认的」不可回答，而那正是 COMPLY-10 要求「显式可审计」的内容。

**为什么条目不能删**：`tools/ci/publicness.mjs` 的 `CHECKLIST_FULLY_CHECKED` 断言比对
的是**本模板的条目集合**。删掉一条模板条目不会让门禁变松，只会让已签的 checklist 与模板
失配而变红 —— 想少答一条题的唯一办法是把它答了。

## 勾选的语义（重要）

勾选 **不等于**「这件事已经做完了」，而等于「这一条已经作出裁决，且裁决与证据写在下面的
表里」。裁决只有两个取值：

| 裁决 | 含义 | 何时可用 |
|---|---|---|
| `implemented` | 已实装并留证 | 任何时候 |
| `not_applicable` | 当前不适用，依据是四条抗辩（无公开注册入口 / 未上架 / 注册用户数 ≤ 10 / 无商业化）**全部成立** | **仅当四条抗辩全部成立时** |

⚠️ 四条抗辩任一破裂（`public_signup_entrance` 或 `app_store_listed` 或 `monetized` 为
`true`，或 `registered_users` 超过 10）后，`not_applicable` 不再是一个合法裁决 ——
`CHECKLIST_FULLY_CHECKED` 会因此失败。这正是这份 checklist 的全部作用：把「我们不小心
变成公开服务了」从一件可以悄悄发生的事，变成一次必须逐条实装才能通过的发布。

**为什么不允许把「已排期」写成勾选**：一条写在文案里而没有实现的承诺，与写「匿名」是同一
性质的虚假陈述（`.planning/research/PITFALLS-SAFETY.md` §1.0 的框架提醒），不是待办事项。

## 变更记录

- **变更日期**：<YYYY-MM-DD>
- **变更项**：<四项状态里变了哪些，写成 before → after>
- **确认人**：<姓名>

## 必需条目（六条，全部必须为已勾选）

依据：`.planning/research/PITFALLS-COMPLIANCE.md` §1.6 开放问题 3 —— 四条抗辩任一破裂时，
下面六项必须**已实装**，而不是「已排期」。

- [ ] `security_assessment` 安全评估：已完成生成式人工智能服务的安全评估并留档（评估报告
      与自评结论），或已按上表裁决为不适用并给出依据。
- [ ] `algorithm_filing` 算法备案：已完成算法备案（或已确认调用已备案模型走地方网信办
      应用登记的较轻路径并留存受理凭证），或已裁决为不适用并给出依据。
- [ ] `minor_mode` 未成年人模式：已实装（年龄识别路径、未成年人不可用或受限的执行点、
      监护人告知文案）且有一条会失败的检查守着它，或已裁决为不适用并给出依据。
- [ ] `crisis_intervention` 危机干预：两级危机识别与干预已上线、危机探针集通过率 100%、
      二级危机的会话外联络通道真实可达（不是只有文案），或已裁决为不适用并给出依据。
- [ ] `two_hour_reminder` 2 小时提醒：连续使用时长提醒已实装在**服务端**计时（前端计时在
      刷新与多端下不成立）且文案与 UI-SPEC 的〔法定〕呈现契约一致，或已裁决为不适用并给出依据。
- [ ] `appeal_channel` 申诉渠道：用户申诉与投诉渠道已上线且有人值守、响应时限已写进对外
      文案并可被核对，或已裁决为不适用并给出依据。

## 逐条裁决与证据

每条都必须给出裁决与**可核对的证据**（文件路径 / 受理编号 / 检查名 / 抗辩依据），不接受
「已确认」这类无指向的表述。两列都不得为空。

| 条目 | 裁决 | 证据 |
|---|---|---|
| `security_assessment` | | |
| `algorithm_filing` | | |
| `minor_mode` | | |
| `crisis_intervention` | | |
| `two_hour_reminder` | | |
| `appeal_channel` | | |
