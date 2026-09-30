# 坏样例 3：有未勾选项的 checklist

**这份文件是负向 fixture，不是一次真实签字。** 它的条目集合与
`compliance/CHECKLIST-TEMPLATE.md` 一致（所以不会先被「集合不一致」那一条拦掉），但
`two_hour_reminder` 一条未勾选。CHECKLIST_FULLY_CHECKED 必须对它失败 —— 否则「一份没答完
的 checklist 也能当签字用」，而那正是 D-08 要抓的第三种绕过。

## 变更记录

- **变更日期**：2026-10-01
- **变更项**：`public_signup_entrance`: false → true
- **确认人**：（坏样例，无）

## 必需条目

- [x] `security_assessment` 安全评估
- [x] `algorithm_filing` 算法备案
- [x] `minor_mode` 未成年人模式
- [x] `crisis_intervention` 危机干预
- [ ] `two_hour_reminder` 2 小时提醒 —— **故意未勾选**
- [x] `appeal_channel` 申诉渠道

## 逐条裁决与证据

| 条目 | 裁决 | 证据 |
|---|---|---|
| `security_assessment` | `implemented` | 坏样例，无 |
| `algorithm_filing` | `implemented` | 坏样例，无 |
| `minor_mode` | `implemented` | 坏样例，无 |
| `crisis_intervention` | `implemented` | 坏样例，无 |
| `two_hour_reminder` | `implemented` | 坏样例，无 |
| `appeal_channel` | `implemented` | 坏样例，无 |
