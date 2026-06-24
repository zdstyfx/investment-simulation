# 06 · 场次配置参数清单

每个场次新建时一次设好,整局生效,存于 `sessions.config_json`。下一局想换规则,新建场次重设即可。

## 完整默认配置(JSON)

```json
{
  "group_count": 10,
  "members_per_group": 3,

  "initial_funds": 1000000,
  "invest_step": 10000,
  "min_invest_per_tx": 0,
  "max_invest_per_tx": null,
  "max_invest_per_target": null,
  "allow_self_invest": false,
  "allow_hold": true,
  "allow_overdraft": false,
  "secrecy": true,

  "invest_window_seconds": 180,
  "presentation_seconds": 300,
  "presentation_order": "random",
  "allow_edit_in_window": true,

  "bonus_top_n": 3,
  "multiplier_min": 1,
  "multiplier_max": 10,
  "base_multiplier": 1,

  "directions": ["生产力硬件", "运动健康硬件", "AI+新型硬件"],
  "force_direction": true,

  "awards": { "funding": true, "investment": true, "special": true },
  "reveal_show_roi": true,
  "leaderboard_top_n": 3
}
```

## 字段说明

| 键 | 含义 | 默认 | 备注 |
|---|---|---|---|
| `group_count` | 小组数量 | 10 | ★ 决定 seat_no 范围与颜色分配 |
| `members_per_group` | 每组人数 | 3 | 仅记录用 |
| `initial_funds` | 初始虚拟资金(元) | 1000000 | ★ |
| `invest_step` | 投资步长(元) | 10000 | ★ 也是 UI 方块每格金额 |
| `min_invest_per_tx` | 单笔最小投资 | 0 | |
| `max_invest_per_tx` | 单笔最大投资 | null | null=无上限 |
| `max_invest_per_target` | 单组对单一目标累计上限 | null | 可选 |
| `allow_self_invest` | 允许投自己组 | false | |
| `allow_hold` | 允许保留不投 | true | |
| `allow_overdraft` | 允许超额投资 | false | |
| `secrecy` | 投资明细保密 | true | 服务端隔离 |
| `invest_window_seconds` | 投资窗口时长(秒) | 180 | ★ |
| `presentation_seconds` | 每组路演时长(秒) | 300 | 展示+答疑,仅提示用 |
| `presentation_order` | 路演顺序 | "random" | random / manual / draw |
| `allow_edit_in_window` | 窗口内可改金额 | true | 已定:可改、关窗即锁 |
| `bonus_top_n` | 享受倍率加成的融资名次 | 3 | ★ 主办方可改 |
| `multiplier_min` | 倍率下限 | 1 | ★ |
| `multiplier_max` | 倍率上限 | 10 | ★ |
| `base_multiplier` | 未入选名次的倍率 | 1 | ★ 可改 |
| `directions` | 命题方向列表 | 见上 | 可增删改 |
| `force_direction` | 强制从列表选题 | true | |
| `awards.funding` | 启用最会融资奖 | true | |
| `awards.investment` | 启用最会投资奖 | true | |
| `awards.special` | 启用韶音特别关注奖 | true | |
| `reveal_show_roi` | 揭榜展示净收益/回报率 | true | |
| `leaderboard_top_n` | 榜单展示前几名高亮 | 3 | |

★ = 最影响博弈平衡、当天最可能调的"旋钮"。

## 校验

- `bonus_top_n` ≤ `group_count`。
- `multiplier_min` ≤ `multiplier_max`;`base_multiplier` 通常 = 1。
- `initial_funds` 应为 `invest_step` 的整数倍(便于方块整除:格子数 = initial_funds / invest_step)。
