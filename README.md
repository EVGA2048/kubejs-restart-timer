# KubeJS 重启定时器 / Restart Timer

一个给 **Minecraft 1.21.1 + NeoForge + KubeJS 2101.x** 服务端用的定时重启脚本。

A daily restart scheduler for KubeJS servers, with in-game reminders, TPS alerts for admins, and a one-shot skip command.

---

## 功能

- **每天固定时间重启**（默认 19:00，可配置）
- **多段提醒**：3 小时、2 小时、1 小时、30 分钟、10 分钟、5 分钟、30 秒
- **最后 10 秒逐秒倒数**（10、9、8 … 1）
- **淡季自动跳过**：连续 24 小时无人上线，跳过当天重启（服务器保持运行）
- **TPS 告警**：TPS 低于 15 持续 10 分钟，只通知在线管理员，由管理员决定是否重启
  - 提醒间隔至少 60 分钟，不会刷屏
  - **不会自动重启**
- **管理员指令**：跳过本次重启 / 立即重启 / 查询状态

## 安装

1. 确认服务端已安装 KubeJS（2101.x，对应 MC 1.21.1）
2. 把 `restart_timer.js` 放到：

```
<服务端目录>/kubejs/server_scripts/restart_timer.js
```

3. 重启服务器，或执行 `/reload`

启动日志里应出现：

```
[重启定时器] 已启用
[重启定时器] 下次重启：2026-11-01 19:00:00
```

> ⚠️ 这是**服务端脚本**。不要放进客户端整合包：单人游戏里执行 `stop` 会直接退出存档。

## 指令

| 指令 | 权限 | 说明 |
|---|---|---|
| `/restartstatus` | OP (等级 2) | 查看下次重启时间、剩余分钟、当前 TPS |
| `/skiprestart` | OP (等级 2) | 跳过下一次定时重启（一次性）；也会取消 `/restartnow` 触发的重启 |
| `/restartnow` | OP (等级 2) | 立即触发重启，30 秒倒计时后执行 |

## 配置

所有参数在文件顶部：

```js
const RESTART_HOUR = 19          // 每天几点重启（24 小时制，服务器本地时间）
const IDLE_SKIP_HOURS = 24       // 连续多久没人上线就跳过当天重启
const TPS_WARN = 15              // TPS 低于此值开始计时
const TPS_WARN_MINUTES = 10      // 持续多少分钟后通知管理员
const TPS_WARN_COOLDOWN_MIN = 60 // 两次告警之间至少间隔多少分钟
const FORCE_COUNTDOWN_SEC = 30   // /restartnow 的倒计时秒数
```

提醒时间点在同文件的 `REMINDERS` 数组里，可以自行增删。

## 已知限制

- **指令是三个独立的单级指令**（`/skiprestart`、`/restartnow`、`/restartstatus`），不是 `/restart skip` 这种子指令。
  原因是 KubeJS `2101.7.2-build.348` 存在多级指令注册失败的 bug（[KubeJS#1079](https://github.com/KubeJS-Mods/KubeJS/issues/1079)），单级指令不受影响。
- **“最后活跃时间”保存在内存里**，服务器重启后会重新计算。也就是说手动重启后，24 小时空闲计时会重新开始。
- TPS 由脚本每 20 tick 采样一次、按最近 60 秒的 tick 数估算，数值可能有小幅波动，用于判断趋势足够。
- 重启使用原版 `stop` 指令，会正常存档、关闭插件后再退出，不是强制杀进程。

## 兼容性

- Minecraft 1.21.1
- NeoForge 21.1.x
- KubeJS 2101.x（在 `2101.7.2-build.348` 上测试）

其他版本的事件/指令 API 可能不同，不保证可用。

## License

MIT
