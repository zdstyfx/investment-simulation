# 05 · API 接口清单

约定:JSON over HTTP。鉴权用 `Authorization: Bearer <jwt>`。金额单位元(整数)。所有写操作做服务端校验。

## 鉴权 auth

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| POST | `/api/auth/register` | 无 | 小组自助注册 `{username, password}` → `{token}` |
| POST | `/api/auth/login` | 无 | 小组登录 `{username, password}` → `{token, role:'group'}` |
| POST | `/api/auth/admin/login` | 无 | 主办方登录(校验预置硬账号)`{username, password}` → `{token, role:'admin'}` |
| GET | `/api/me` | 任意 | 返回当前身份 `{role, id, username}` |

> 无主办方注册接口。admins 由部署 seed 种入。

## 小组 group(需 group token)

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/sessions` | 可加入的场次列表(status=open/running):`[{id,name,status,joined}]` |
| POST | `/api/sessions/:id/join` | 加入场次 `{join_code, team_name}` → `{membership}`(校验码、分配 seat_no、初始化 balance) |
| GET | `/api/sessions/:id/me` | **仅自己**:`{team_name, seat_no, balance, investments:[{target_seat, target_team, amount}]}` |
| GET | `/api/sessions/:id/state` | 轮询用全局状态(见下);group token 时附带 `my_balance` |
| PUT | `/api/sessions/:id/investment` | 投资 upsert `{target_id, amount}` → `{ok, balance}`(按 04 节规则校验) |

`GET /state` 返回(对小组/大屏通用,**不含任何别组金额**):
```json
{
  "status": "running",
  "current_round": 6,
  "window_open": true,
  "current_target": { "membership_id": 33, "seat_no": 3, "team_name": "...", "direction": "运动健康" },
  "window_ends_at": "2026-07-03T16:42:10Z",
  "revealed": false
}
```

## 大屏 screen(免登录)

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/sessions/:id/screen` | 轮询:当前路演组、倒计时、阶段;**揭榜后**附带榜单 |
| GET | `/api/sessions/:id/leaderboard` | 仅 `revealed=1` 时:`{funding:[...], investment:[...]}` |

榜单元素示例:`{seat_no, team_name, product, funding_total, funding_rank, effective_multiplier, valuation, invest_roi, invest_net}`(揭榜后才可见)。

## 主办方 admin(需 admin token)

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/admin/sessions` | 新建场次 `{name, config}` → `{id, join_code}`(status=draft) |
| GET | `/api/admin/sessions` | 全部场次列表 |
| GET | `/api/admin/sessions/:id` | 场次详情:config、memberships、运行时状态、(可见)聚合数据 |
| PATCH | `/api/admin/sessions/:id` | 改 `{name?, config?}`(draft/open 阶段可改配置) |
| POST | `/api/admin/sessions/:id/open` | status→open(开放加入) |
| POST | `/api/admin/sessions/:id/start` | status→running |
| POST | `/api/admin/sessions/:id/round` | 设当前路演组 `{target_id, round_no}` |
| POST | `/api/admin/sessions/:id/window` | 开/关投资窗口 `{open: true|false, duration_seconds?}` |
| POST | `/api/admin/sessions/:id/next` | 关窗并切到下一路演组(便捷操作) |
| PUT | `/api/admin/sessions/:id/multipliers` | 录评审倍率 `{target_id, value}`(可任意时间;也可支持批量数组) |
| POST | `/api/admin/sessions/:id/settle` | 一键结算(算融资榜→套前 N 倍率→算收益→写快照),status→settled,可重入 |
| POST | `/api/admin/sessions/:id/reveal` | revealed→1(大屏展示榜单) |
| POST | `/api/admin/sessions/:id/special-award` | 指定韶音特别关注奖 `{membership_id}` |
| GET | `/api/admin/sessions/:id/memberships` | 各队 + 余额 +(主办方可见)融资/投资聚合 |

## 错误约定

- 校验失败返回 `400` + `{error, reason}`(如 `WINDOW_CLOSED`、`NOT_CURRENT_TARGET`、`INSUFFICIENT_BALANCE`、`SELF_INVEST_FORBIDDEN`、`STEP_MISMATCH`)。
- 鉴权失败 `401`;越权 `403`(如小组访问 admin 接口、跨场次访问他人数据)。
