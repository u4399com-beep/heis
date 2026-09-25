// hostgate.go — 同 host 并发 + 速率 双维闸门 (反反爬核心组件).
//
// 核心机制:
//   - 每 host 一个槽位账本 (inFlight / limit / failStreak / successStreak / minGapMs)
//   - 计账式准入: 释放只触发一次容量复查 (pump), 不把槽位"递给"任何特定等待者;
//     等待者按 FIFO 队头次序自行复查 "limit - inFlight > 0" 并自计入账;
//     新请求必须排在既存等待者之后 (队空 + 有余量才走快速通道), 杜绝 barge 插队.
//   - 降额: 同 host 连续失败 ≥3 → limit-1 (最低 1), 60s 冷却内不再降; 连续成功 ≥10
//     → limit+1 (不超过 baseLimit). 降额不动在飞请求, 存量自然回落.
//   - 速率节流: 同 host 相邻准入最小间隔 minGapMs; 准入判定 = 并发余量 + 节流到点.
//   - 限流冷却: 429 感知后推后 rateLimitedUntil; 该期间 pump 不放行.
//   - LRU 治理: gates Map 软上限 1000; acquire 路径惰性 sweep + 驱逐 idle host.
//
// Go 实现要点: 用 chan struct 信号 + sync.Mutex 取代 promise 队列; 单 goroutine
// pump 避免锁竞争; context.Context 支持取消 (与 Semaphore 配合 stop/换代).
package crawl

import (
        "context"
        "net/url"
        "strings"
        "sync"
        "time"
)

const (
        HostGateDefaultLimit   = 3
        HostGateMinLimit       = 1
        HostGateMaxLimit       = 10
        HostGateWaitTimeoutMs = 30000
        DerateFailStreak       = 3
        DerateCooldownMs       = 60000
        RecoverSuccessStreak   = 10
        HostGateRateLimitDefaultMs = 30000
        HostGateRateLimitMaxMs     = 120000
        HostsCap                   = 1000
        SweepEvery                 = 100
        SweepMax                   = 200
)

// HostGateTicket — 准入票据 (释放时回传 host).
type HostGateTicket struct {
        Host string
}

// HostGateDerateEvent — 降额事件 (供 runner 写日志).
type HostGateDerateEvent struct {
        Host       string
        FailStreak int
        OldLimit   int
        NewLimit   int
}

type waiter struct {
        ch     chan struct{}
        ctx    context.Context
        cancel context.CancelFunc
}

type hostState struct {
        host                  string
        inFlight              int
        limit                 int
        baseLimit             int
        failStreak            int
        successStreak         int
        penaltyUntil          int64
        waiters              []*waiter
        minGapMs              int
        minGapMsLastValue     int
        minGapMsBeforeCooldown int
        lastAdmitAt           int64
        rateLimitedUntil      int64
        // R64-B B1/B3: 自适应调整时间戳 (UnixMilli), cooldown 防抖动
        lastConcurrencyAdjustAt int64 // B1: 上次 AdjustConcurrency 时间
        lastMinGapAdjustAt      int64 // B3: 上次 AdjustMinGap 时间
}

// HostGate — 同 host 并发闸门 (进程级单例, 多任务共享).
type HostGate struct {
        mu   sync.Mutex
        gate map[string]*hostState
        // sweepN 计数 (摊销惰性 sweep)
        sweepN int
}

var (
        hostGateOnce sync.Once
        hostGateInst *HostGate
)

// GetHostGate — 进程级单例.
func GetHostGate() *HostGate {
        hostGateOnce.Do(func() {
                hostGateInst = &HostGate{gate: make(map[string]*hostState)}
        })
        return hostGateInst
}

// HostGateKeyOf — host 键: URL host 小写 (含非默认端口, 同主机不同端口视为不同站).
func HostGateKeyOf(s string) string {
        u, err := url.Parse(s)
        if err != nil {
                return ""
        }
        if u.Host == "" {
                return ""
        }
        return strings.ToLower(u.Host)
}

func clampLimit(v int) int {
        if v < HostGateMinLimit {
                return HostGateMinLimit
        }
        if v > HostGateMaxLimit {
                return HostGateMaxLimit
        }
        return v
}

func (g *HostGate) stateOf(host string, baseLimit int) *hostState {
        st, ok := g.gate[host]
        if !ok {
                st = &hostState{
                        host:      host,
                        inFlight:  0,
                        limit:     baseLimit,
                        baseLimit: baseLimit,
                }
                g.gate[host] = st
        }
        return st
}

// isHostIdle — 是否空闲 (在飞 0 + 队列空 + 冷却过期).
func (g *HostGate) isHostIdle(st *hostState, now int64) bool {
        return st.inFlight == 0 &&
                len(st.waiters) == 0 &&
                st.penaltyUntil < now &&
                st.rateLimitedUntil < now
}

// evictOneIdleHost — 驱逐一个空闲 host, 返回是否仍超限.
func (g *HostGate) evictOneIdleHost() bool {
        now := time.Now().UnixMilli()
        for k, st := range g.gate {
                if g.isHostIdle(st, now) {
                        delete(g.gate, k)
                        return len(g.gate) > HostsCap
                }
        }
        return false
}

// sweepIdleHosts — 周期性 sweep (惰性, 上限 SweepMax 防病态大 Map 单次过久).
func (g *HostGate) sweepIdleHosts() {
        now := time.Now().UnixMilli()
        removed := 0
        for k, st := range g.gate {
                if removed >= SweepMax {
                        break
                }
                if g.isHostIdle(st, now) {
                        delete(g.gate, k)
                        removed++
                }
        }
}

// maybeSweepAndEvict — 周期性 sweep + 软上限驱逐.
// R64-B BUG-32 (P1): 原实现无 g.mu 锁, 与 stateOf (持锁写 g.gate[host]=st) 并发
//   访问 g.gate → Go runtime "fatal error: concurrent map read and map write"
//   panic. Acquire 在 g.mu.Lock() 之前调用本函数 (line 262), 多 goroutine 并发
//   Acquire 时 sweepIdleHosts / evictOneIdleHost 迭代+删除 g.gate, 与另一
//   goroutine 的 stateOf 写入竞态. 修复: 本函数内部自取 g.mu 锁, 与 Acquire
//   的 g.mu.Lock() 顺序执行 (非嵌套, 无死锁风险).
func (g *HostGate) maybeSweepAndEvict() {
        g.mu.Lock()
        defer g.mu.Unlock()
        g.sweepN++
        if g.sweepN%SweepEvery == 0 {
                g.sweepIdleHosts()
        }
        for len(g.gate) > HostsCap {
                if !g.evictOneIdleHost() {
                        break
                }
        }
}

// settleRateLimitExpiry — 限流冷却到期结算 (惰性): 清零连败 + 回滚 minGapMs 快照.
// R45-1A 修复: 原实现无条件从 minGapMsBeforeCooldown 还原 minGapMs. 但若冷却期间
//   新 caller 调 Acquire 传了不同的 minGapMs (会覆写 st.minGapMs 但不动 snapshot),
//   冷却到期 restore 会反转 caller 的意图 (回到冷却前的旧值, 不是 caller 期望的新值).
//   修复: 冷却期间 minGapMs 被 caller 覆写 (st.minGapMs != 快照原值) 时跳过还原.
func (g *HostGate) settleRateLimitExpiry(st *hostState) {
        if st.rateLimitedUntil > 0 && time.Now().UnixMilli() >= st.rateLimitedUntil {
                st.rateLimitedUntil = 0
                st.failStreak = 0
                if st.minGapMsBeforeCooldown > 0 {
                        // R45-1A: 若 minGapMs == 快照原值 → 冷却期间未被 caller 覆写,
                        //   还原是 no-op (但清 snapshot 让下次冷却重新记). 若 minGapMs !=
                        //   快照原值 → caller 在冷却期间覆写为新值, 不还原 (caller 优先).
                        if st.minGapMs != st.minGapMsBeforeCooldown {
                                // 不还原, caller 的新值生效
                        }
                        st.minGapMsBeforeCooldown = 0
                }
        }
}

// pump — 容量复查 (计账式准入核心): FIFO 队头起复查余量 + 节流到点 + 非冷却期.
// R41-1A 修复: 原实现 default 分支 (send 失败) 直接 continue 不回滚 inFlight,
//              导致槽位永久泄漏 (inFlight 增但 Release 永不被调用), 该 host 最终死锁.
//              修复: default 分支回滚 inFlight--.
//              并增加 waiter ctx 已取消的前置检查 (避免无谓 send 失败).
// R42-1B 修复: 原实现 lastAdmitAt = now 在 send 之前设置, 若 send 失败 (default 分支),
//              lastAdmitAt 仍被更新为 now, 导致下一轮 pump 因 minGapMs 节流而被卡住
//              (即使 send 失败的 waiter 已离队). 修复: 把 lastAdmitAt = now 移到 send 成功后.
func (g *HostGate) pump(st *hostState) {
        g.settleRateLimitExpiry(st)
        if len(st.waiters) == 0 {
                return
        }
        now := time.Now().UnixMilli()
        if now < st.rateLimitedUntil {
                return // 限流冷却期内整队不放行
        }
        for len(st.waiters) > 0 {
                if st.limit-st.inFlight <= 0 {
                        return // 并发余量不足
                }
                if now-st.lastAdmitAt < int64(st.minGapMs) {
                        return // 节流未到点: 卡住整个队列 (无 barge)
                }
                w := st.waiters[0]
                // R41-1A: 前置检查 waiter ctx 是否已取消 (避免无谓 send + 避免 inFlight 增后回滚)
                select {
                case <-w.ctx.Done():
                        // waiter 已超时/取消, 跳过 (不增 inFlight, 不 pump 该 waiter)
                        st.waiters = st.waiters[1:]
                        continue
                default:
                }
                st.waiters = st.waiters[1:]
                st.inFlight++
                select {
                case w.ch <- struct{}{}:
                        // 成功 admit — R42-1B: lastAdmitAt 仅在 send 成功后更新 (避免失败时误节流)
                        st.lastAdmitAt = now
                default:
                        // R41-1A: 回滚 inFlight (send 失败 = waiter 已离开或 buffered 满但 caller 不再读)
                        // R42-1B: 不更新 lastAdmitAt (避免下一轮 pump 被误节流)
                        st.inFlight--
                        continue
                }
        }
}

// Acquire — 过闸获取槽位. 有余量 + 无排队者 + 非限流冷却期 + 节流到点 → 立即准入;
// 否则入 FIFO 队尾, 由 Release/Report 触发的 pump 复查准入. 等待超过 timeoutMs
// 或 ctx.Done() 返回 ctx.Err().
// R41-1A 修复: ctx2.Done() 分支需 drain w.ch (pump 可能在 ctx2 触发 Done 之前已成功 send 到
//              buffered chan, 若不 drain 就视为超时, inFlight 永不释放 → 槽位泄漏.
//              修复: ctx2.Done() 分支非阻塞 drain w.ch, 若有值则视为成功 admit 返回 ticket.
// R42-1B 修复: 原实现 drain 在 g.mu.Lock() 之前, 存在竞态: pump 持 g.mu 进行 send 时,
//              ctx2 触发 Done, Acquire 的 drain 先于 pump 的 send 跑, drain 返回 default (空),
//              然后 Acquire 取 g.mu.Lock() 阻塞等 pump 完成; pump 的 send 此时已写入 w.ch,
//              但 Acquire 已决定走 ctx2.Err() 路径, 不再读 w.ch → inFlight 永久泄漏.
//              修复: 把 drain 移到 g.mu.Lock() 内, 等 pump 完成后再 drain, 若有值则视为
//              成功 admit. 这样 pump 的 send 与 Acquire 的 drain 在 g.mu 同步, 不再竞态.
func (g *HostGate) Acquire(ctx context.Context, rawURL string, limit, timeoutMs, minGapMs int) (*HostGateTicket, error) {
        g.maybeSweepAndEvict()
        host := HostGateKeyOf(rawURL)
        if host == "" {
                return &HostGateTicket{Host: ""}, nil
        }
        baseLimit := clampLimit(limit)
        if timeoutMs < 1000 {
                timeoutMs = HostGateWaitTimeoutMs
        }
        if minGapMs < 0 {
                minGapMs = 0
        }

        g.mu.Lock()
        st := g.stateOf(host, baseLimit)
        st.baseLimit = baseLimit
        if st.limit > st.baseLimit {
                st.limit = st.baseLimit
        }
        // minGapMs 跟随最近一次 (新 caller 接管时不做 MAX 合并, 防旧 caller 60s 永久毒杀新 caller)
        if minGapMs != st.minGapMsLastValue {
                st.minGapMs = minGapMs
                st.minGapMsLastValue = minGapMs
        }

        // 快速通道: 队空 + 有余量 + 非冷却期 + 节流到点
        now := time.Now().UnixMilli()
        if len(st.waiters) == 0 && st.limit-st.inFlight > 0 &&
                now >= st.rateLimitedUntil && now-st.lastAdmitAt >= int64(st.minGapMs) {
                st.inFlight++
                st.lastAdmitAt = now
                g.mu.Unlock()
                return &HostGateTicket{Host: host}, nil
        }

        // 入 FIFO 等待队列
        ctx2, cancel := context.WithTimeout(ctx, time.Duration(timeoutMs)*time.Millisecond)
        defer cancel()
        w := &waiter{
                ch:     make(chan struct{}, 1),
                ctx:    ctx2,
                cancel: cancel,
        }
        st.waiters = append(st.waiters, w)
        g.mu.Unlock()

        // pump 复查 (新等待者入队后立即尝试)
        g.mu.Lock()
        g.pump(st)
        g.mu.Unlock()

        select {
        case <-w.ch:
                return &HostGateTicket{Host: host}, nil
        case <-ctx2.Done():
                // R42-1B: 把 drain 移到 g.mu.Lock() 内, 等 pump 完成后再 drain.
                // 否则 pump 持 g.mu 在 send 时, Acquire 的 drain 先于 send 跑 → drain 返回 default (空),
                // Acquire 走 ctx2.Err() 路径, 但 pump 的 send 已写入 w.ch → inFlight 永久泄漏.
                g.mu.Lock()
                select {
                case <-w.ch:
                        g.mu.Unlock()
                        return &HostGateTicket{Host: host}, nil
                default:
                }
                // 真的没拿到 admission: 从队列移除 (lazy)
                for i, x := range st.waiters {
                        if x == w {
                                st.waiters = append(st.waiters[:i], st.waiters[i+1:]...)
                                break
                        }
                }
                g.mu.Unlock()
                return nil, ctx2.Err()
        }
}

// Release — 释放槽位 (计账式: inFlight-- + pump).
func (g *HostGate) Release(t *HostGateTicket) {
        if t == nil || t.Host == "" {
                return
        }
        g.mu.Lock()
        defer g.mu.Unlock()
        st, ok := g.gate[t.Host]
        if !ok {
                return
        }
        if st.inFlight > 0 {
                st.inFlight--
        }
        g.pump(st)
}

// ReportFailure — 记录失败 (连续 ≥3 触发降额). 返回降额事件 (无降额时 nil).
func (g *HostGate) ReportFailure(host string) *HostGateDerateEvent {
        if host == "" {
                return nil
        }
        g.mu.Lock()
        defer g.mu.Unlock()
        st, ok := g.gate[host]
        if !ok {
                return nil
        }
        st.successStreak = 0
        st.failStreak++
        now := time.Now().UnixMilli()
        if st.failStreak >= DerateFailStreak && st.penaltyUntil < now {
                old := st.limit
                if st.limit > HostGateMinLimit {
                        st.limit--
                }
                st.penaltyUntil = now + DerateCooldownMs
                return &HostGateDerateEvent{Host: host, FailStreak: st.failStreak, OldLimit: old, NewLimit: st.limit}
        }
        return nil
}

// ReportSuccess — 记录成功 (连续 ≥10 回升一档, 不超过 baseLimit).
func (g *HostGate) ReportSuccess(host string) {
        if host == "" {
                return
        }
        g.mu.Lock()
        defer g.mu.Unlock()
        st, ok := g.gate[host]
        if !ok {
                return
        }
        st.failStreak = 0
        st.successStreak++
        if st.successStreak >= RecoverSuccessStreak && st.limit < st.baseLimit {
                st.limit++
                st.successStreak = 0
        }
}

// ReportRateLimited — 限流冷却 (429 感知). Retry-After 缺省 30s, 上限 120s.
func (g *HostGate) ReportRateLimited(host string, retryAfterMs int) {
        if host == "" {
                return
        }
        if retryAfterMs < 1000 {
                retryAfterMs = HostGateRateLimitDefaultMs
        }
        if retryAfterMs > HostGateRateLimitMaxMs {
                retryAfterMs = HostGateRateLimitMaxMs
        }
        g.mu.Lock()
        defer g.mu.Unlock()
        st, ok := g.gate[host]
        if !ok {
                // 即使新建账本也记录 (后续 acquire 会立即冷却, 不发请求)
                st = g.stateOf(host, HostGateDefaultLimit)
        }
        now := time.Now().UnixMilli()
        st.rateLimitedUntil = now + int64(retryAfterMs)
        if st.minGapMsBeforeCooldown == 0 && st.minGapMs > 0 {
                st.minGapMsBeforeCooldown = st.minGapMs
        }
}

// ---------- R64-B 采集增强 B1 + B3: 并发 + 速率自适应 API ----------
//
// B1 AdjustConcurrency: 按 host 健康度 (caller 传入的成功率 / latency 综合分)
//   动态调 baseLimit. 健康 (health > 0.8) → baseLimit+1 (上限 HostGateMaxLimit);
//   不健康 (health < 0.3) → baseLimit-1 (下限 HostGateMinLimit). 60s cooldown
//   防抖动. limit (当前并发) 不直接动, 让现有 inFlight 自然回落 + 下次 Acquire
//   走 fast path 用新 baseLimit.
//   价值: 健康 host 提并发 (5 章/批 → 8 章/批), 不健康 host 降并发 (避免雪崩).
//   caller (runner.go) 在周期性评估时调用, 不直接改 runner.go (R62-B 范围).
//
// B3 AdjustMinGap: 按源站响应延迟动态调 minGapMs. 快响应 (< 500ms) → 缩小
//   minGapMs -50ms (加速采集, 下限 0); 慢响应 (> 3000ms) → 扩大 minGapMs
//   +100ms (避免拖垮源站, 上限 10000ms). 30s cooldown 防抖动.
//   价值: 响应快时加速 (1 章/2s → 1 章/1s), 慢时减速 (1 章/5s → 1 章/8s).
//
// 健康度计算 (caller 侧, 仅供参考):
//   health = successRate * 0.6 + (1 - latencyMs/5000) * 0.4
//   例: 成功率 0.9 + 延迟 800ms → 0.54 + 0.336 = 0.876 (健康)
//       成功率 0.5 + 延迟 4000ms → 0.3 + 0.08 = 0.38 (一般)
//       成功率 0.2 + 延迟 6000ms → 0.12 + 0 = 0.12 (不健康)

// AdjustConcurrency — 按 host 健康度动态调 baseLimit (B1).
//   health ∈ [0.0, 1.0]. health > 0.8 → baseLimit+1 (cap HostGateMaxLimit);
//   health < 0.3 → baseLimit-1 (floor HostGateMinLimit). 60s cooldown 防抖动.
//   health ∈ [0.3, 0.8] 不动 (中性区间, 避免边缘抖动).
//   caller: runner.go 周期性评估 (每 N 章采完后调一次, 不在每章路径调).
func (g *HostGate) AdjustConcurrency(host string, health float64) {
        if host == "" {
                return
        }
        if health < 0 || health > 1 {
                return
        }
        g.mu.Lock()
        defer g.mu.Unlock()
        st, ok := g.gate[host]
        if !ok {
                // host 未在 gate (无 acquire 历史) → 不调 (无数据基线)
                return
        }
        now := time.Now().UnixMilli()
        // R64-B B1: 60s cooldown 防抖动 (上次调整 < 60s 内不调)
        if now-st.lastConcurrencyAdjustAt < 60*1000 {
                return
        }
        oldBase := st.baseLimit
        if health > 0.8 && st.baseLimit < HostGateMaxLimit {
                st.baseLimit++
        } else if health < 0.3 && st.baseLimit > HostGateMinLimit {
                st.baseLimit--
        } else {
                // 中性区间或已到边界, 不调
                return
        }
        st.lastConcurrencyAdjustAt = now
        // 当前 limit 不超过新 baseLimit (clamp down)
        if st.limit > st.baseLimit {
                st.limit = st.baseLimit
        }
        // R64-B B1: 记录调整事件供调试 (不返 event, 调用方按 host 查 baseLimit)
        _ = oldBase
}

// AdjustMinGap — 按源站响应延迟动态调 minGapMs (B3).
//   latencyMs < 500 → minGapMs -= 50 (下限 0, 加速).
//   latencyMs > 3000 → minGapMs += 100 (上限 10000ms, 减速).
//   500 ≤ latencyMs ≤ 3000 不动 (中性区间).
//   30s cooldown 防抖动.
//   caller: runner.go 在 fetchHttp 成功后调 (用 resp round-trip 延迟).
func (g *HostGate) AdjustMinGap(host string, latencyMs int64) {
        if host == "" || latencyMs < 0 {
                return
        }
        g.mu.Lock()
        defer g.mu.Unlock()
        st, ok := g.gate[host]
        if !ok {
                return
        }
        now := time.Now().UnixMilli()
        // R64-B B3: 30s cooldown 防抖动
        if now-st.lastMinGapAdjustAt < 30*1000 {
                return
        }
        oldGap := st.minGapMs
        if latencyMs < 500 {
                st.minGapMs -= 50
                if st.minGapMs < 0 {
                        st.minGapMs = 0
                }
        } else if latencyMs > 3000 {
                st.minGapMs += 100
                if st.minGapMs > 10000 {
                        st.minGapMs = 10000
                }
        } else {
                return
        }
        // R64-B B3: minGapMsLastValue 同步更新 (与 Acquire 同款, 防 caller 接管误判)
        st.minGapMsLastValue = st.minGapMs
        st.lastMinGapAdjustAt = now
        _ = oldGap
}

// HostHealthForAdjust — 计算 host 当前健康度 (供 admin / runner 查询).
//   返 (baseLimit, limit, inFlight, minGapMs, lastConcurrencyAdjustAt, lastMinGapAdjustAt).
//   不返 failStreak/successStreak (内部状态, 不暴露).
func (g *HostGate) HostHealthForAdjust(host string) (baseLimit, limit, inFlight, minGapMs int, lastConcurrencyAdjustAt, lastMinGapAdjustAt int64) {
        g.mu.Lock()
        defer g.mu.Unlock()
        st, ok := g.gate[host]
        if !ok {
                return 0, 0, 0, 0, 0, 0
        }
        return st.baseLimit, st.limit, st.inFlight, st.minGapMs, st.lastConcurrencyAdjustAt, st.lastMinGapAdjustAt
}
