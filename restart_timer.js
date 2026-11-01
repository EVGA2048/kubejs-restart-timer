// 重启定时器
// - 每天 19:00 重启（可改 RESTART_HOUR）
// - 提醒：3h / 2h / 1h / 30m / 10m / 5m / 30s，最后 10 秒逐秒倒数
// - 连续 24 小时无人上线则跳过当天重启
// - TPS 低于 15 持续 10 分钟：只通知在线管理员，由管理员决定是否重启
// - /skiprestart  跳过下一次重启（也会取消管理员触发的重启）
// - /restartnow   管理员立即触发重启（30 秒倒计时）
// - /restartstatus 查看下次重启时间与当前 TPS

const RESTART_HOUR = 19
const IDLE_SKIP_HOURS = 24
const TPS_WARN = 15
const TPS_WARN_MINUTES = 10
const TPS_WARN_COOLDOWN_MIN = 60
const FORCE_COUNTDOWN_SEC = 30

const REMINDERS = [
    { ms: 3 * 60 * 60 * 1000, text: '3 小时' },
    { ms: 2 * 60 * 60 * 1000, text: '2 小时' },
    { ms: 1 * 60 * 60 * 1000, text: '1 小时' },
    { ms: 30 * 60 * 1000, text: '30 分钟' },
    { ms: 10 * 60 * 1000, text: '10 分钟' },
    { ms: 5 * 60 * 1000, text: '5 分钟' },
    { ms: 30 * 1000, text: '30 秒' }
]

let nextRestartAt = 0
let skipNext = false
let announced = {}
let lastActiveAt = Date.now()
let samples = []
let lowSince = 0
let lastWarnAt = 0
let lastCountdown = -1
let forcedRestartAt = 0
let forcedLastSec = -1
let confirmExpiresAt = 0
const System = Java.loadClass('java.lang.System')


function nextDaily(hour) {
    const d = new Date()
    const t = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, 0, 0, 0)
    if (t.getTime() <= Date.now()) t.setDate(t.getDate() + 1)
    return t.getTime()
}

function scheduleNext() {
    nextRestartAt = nextDaily(RESTART_HOUR)
    announced = {}
    lastCountdown = -1
    console.info('[重启定时器] 下次重启：' + new Date(nextRestartAt).toString())
}

function broadcast(server, color, msg) {
    const now = Date.now()
    const last = System.getProperty('es2rt.lastMsg') || ''
    const lastAt = Number(System.getProperty('es2rt.lastAt') || 0)
    if (last === msg && now - lastAt < 2000) return
    System.setProperty('es2rt.lastMsg', msg)
    System.setProperty('es2rt.lastAt', '' + now)
    let c = Text.of(msg)
    if (color === 'gold') c = Text.gold(c)
    else if (color === 'red') c = Text.red(c)
    else if (color === 'yellow') c = Text.yellow(c)
    server.tell(c)
}

function notifyAdmins(server, msg) {
    let sent = false
    const list = server.getPlayerList().getPlayers()
    for (let i = 0; i < list.size(); i++) {
        const p = list.get(i)
        if (p.hasPermissions(2)) {
            p.tell(Text.yellow(Text.of(msg)))
            sent = true
        }
    }
    if (!sent) console.info('[重启定时器] (无管理员在线) ' + msg)
}

function currentTps() {
    if (samples.length < 2) return 20
    const a = samples[0]
    const b = samples[samples.length - 1]
    const dt = (b.t - a.t) / 1000
    if (dt < 5) return 20
    return (b.ticks - a.ticks) / dt
}

ServerEvents.loaded(event => {
    lastActiveAt = Date.now()
    scheduleNext()
    console.info('[重启定时器] 已启用')
})

ServerEvents.tick(event => {
    const server = event.server
    if (!server) return
    if (server.getTickCount() % 20 !== 0) return

    const now = Date.now()
    if (confirmExpiresAt > 0 && now > confirmExpiresAt) confirmExpiresAt = 0
    if (server.getPlayerCount() > 0) lastActiveAt = now

    samples.push({ t: now, ticks: server.getTickCount() })
    while (samples.length > 2 && now - samples[0].t > 60000) samples.shift()

    const tps = currentTps()

    // TPS 低：只通知管理员，不自动重启
    if (tps < TPS_WARN && server.getPlayerCount() > 0) {
        if (lowSince === 0) lowSince = now
        if ((now - lowSince) / 60000 >= TPS_WARN_MINUTES &&
            now - lastWarnAt > TPS_WARN_COOLDOWN_MIN * 60000) {
            lastWarnAt = now
            notifyAdmins(server,
                '[重启定时器] TPS 已连续 ' + TPS_WARN_MINUTES + ' 分钟低于 ' + TPS_WARN +
                '（当前 ' + tps.toFixed(1) + '）。如确认卡顿，可执行 /restartnow 立即重启（30 秒倒计时）')
            console.info('[重启定时器] TPS 告警：' + tps.toFixed(1))
        }
    } else {
        lowSince = 0
    }

    // 管理员手动触发的重启
    if (forcedRestartAt > 0) {
        const left = forcedRestartAt - now
        if (left <= 0) {
            broadcast(server, 'red', '[重启定时器] 服务器正在重启……')
            server.runCommandSilent('stop')
            return
        }
        const sec = Math.ceil(left / 1000)
        if (sec !== forcedLastSec) {
            forcedLastSec = sec
            broadcast(server, 'red', '[重启定时器] 服务器将在 ' + sec + ' 秒后重启')
        }
        return
    }

    if (nextRestartAt === 0) return
    const left = nextRestartAt - now

    if (left <= 0) {
        if (skipNext) {
            skipNext = false
            scheduleNext()
            broadcast(server, 'gold', '[重启定时器] 已按请求跳过本次重启，下次：' + new Date(nextRestartAt).toLocaleString())
            return
        }

        if (now - lastActiveAt > IDLE_SKIP_HOURS * 60 * 60 * 1000) {
            scheduleNext()
            console.info('[重启定时器] 已连续 ' + IDLE_SKIP_HOURS + ' 小时无人上线，跳过本次重启')
            return
        }

        broadcast(server, 'red', '[重启定时器] 服务器正在重启……')
        server.runCommandSilent('stop')
        return
    }

    // 10 秒逐秒倒数
    if (left <= 10000) {
        const sec = Math.ceil(left / 1000)
        if (sec !== lastCountdown && sec >= 1) {
            lastCountdown = sec
            if (server.getPlayerCount() > 0) {
                broadcast(server, 'red', '[重启定时器] 服务器将在 ' + sec + ' 秒后重启')
            }
        }
        return
    }

    if (server.getPlayerCount() > 0) {
        var due = -1
        for (var i = 0; i < REMINDERS.length; i++) {
            if (left <= REMINDERS[i].ms && !announced[i]) due = i
        }
        if (due >= 0) {
            for (var j = 0; j < REMINDERS.length; j++) {
                if (left <= REMINDERS[j].ms) announced[j] = true
            }
                broadcast(server, 'yellow', '[重启定时器] 距服务器重启还有 ' + REMINDERS[due].text + '，请及时保存手头的工作')
        }
    }
})

ServerEvents.commandRegistry(event => {
    const { commands: Commands } = event

    event.register(Commands.literal('skiprestart').requires(s => s.hasPermission(2)).executes(ctx => {
        skipNext = true
        forcedRestartAt = 0
        confirmExpiresAt = 0
        ctx.source.sendSystemMessage(Text.gold(Text.of('[重启定时器] 已跳过下一次重启（如管理员刚触发重启，也已取消）')))
        return 1
    }))

    event.register(Commands.literal('restartnow').requires(s => s.hasPermission(2)).executes(ctx => {
        confirmExpiresAt = Date.now() + 60000
        ctx.source.sendSystemMessage(Text.gold(Text.of('[重启定时器] 你确定要立即重启吗？如确认，请在 60 秒内输入 /restartconfirm')))
        return 1
    }))

    event.register(Commands.literal('restartconfirm').requires(s => s.hasPermission(2)).executes(ctx => {
        if (confirmExpiresAt === 0 || Date.now() > confirmExpiresAt) {
            confirmExpiresAt = 0
            ctx.source.sendSystemMessage(Text.of('[重启定时器] 没有待确认的重启请求（请先执行 /restartnow）'))
            return 0
        }
        confirmExpiresAt = 0
        forcedRestartAt = Date.now() + FORCE_COUNTDOWN_SEC * 1000
        forcedLastSec = -1
        ctx.source.sendSystemMessage(Text.gold(Text.of('[重启定时器] 已确认，' + FORCE_COUNTDOWN_SEC + ' 秒后重启')))
        return 1
    }))

    event.register(Commands.literal('restartstatus').requires(s => s.hasPermission(2)).executes(ctx => {
        if (nextRestartAt === 0) {
            ctx.source.sendSystemMessage(Text.of('[重启定时器] 尚未初始化'))
            return 0
        }
        const mins = Math.max(0, Math.ceil((nextRestartAt - Date.now()) / 60000))
        let msg = '[重启定时器] 下次重启：' + new Date(nextRestartAt).toLocaleString() + '（约 ' + mins + ' 分钟后）'
        if (skipNext) msg += '（已请求跳过）'
        msg += ' 当前 TPS：' + currentTps().toFixed(1)
        ctx.source.sendSystemMessage(Text.of(msg))
        return 1
    }))
})
