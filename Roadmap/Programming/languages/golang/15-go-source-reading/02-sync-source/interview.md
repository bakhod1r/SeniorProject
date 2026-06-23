# `sync` Package Source — Interview

## 1. How to use this file

Twenty-five questions about Go's `sync` package — what it does, how the source is shaped, where it surprises people in production. Junior to staff, in interview order. Each answer is the length you'd actually give in the room — two to five sentences — and where it matters there's a **follow-up to expect**. After the questions: a "What NOT to say" list with the lines that immediately mark a candidate as shallow, and a five-minute pre-interview checklist for the morning of. Read top to bottom on first pass. On revision, skim and re-read only the ones you stumbled on. The signal the interviewer is grading is whether you can move between API-level intuition ("Mutex is fast when uncontended") and source-level mechanics ("the fast path is a single CAS on the `state` word") without the seams showing.

---

## 2. Junior questions (Q1–Q5)

### Q1. What is `sync.Mutex` and when do you use it?

**Short answer:** `sync.Mutex` is Go's basic mutual-exclusion lock — at most one goroutine holds it at a time. You wrap a critical section between `mu.Lock()` and `mu.Unlock()` (almost always via `defer mu.Unlock()`) so that the goroutines coordinating on it can't observe each other mid-update. Use it when two or more goroutines read and write the *same* memory and at least one writes. If only one goroutine touches the field, you don't need a mutex; if all goroutines only read after initialization, you don't need one either.

**Follow-up:** What if you just need atomic reads and writes of a single int? Answer: use `sync/atomic` (or in modern Go, the typed `atomic.Int64`, `atomic.Pointer[T]`). A mutex is overkill for a single word — atomics are faster and the API is honest about what it does.

---

### Q2. Why do you pass `sync.Mutex` by pointer?

**Short answer:** `sync.Mutex` contains internal state (a `state` int32 and a `sema` uint32) that must be shared between everyone synchronising on it. If you copy the struct — by value receiver, by passing it to a function as `Mutex` instead of `*Mutex`, by embedding it in a struct that you then copy — each copy has its *own* state, and the lock no longer protects what you think it protects. `go vet` flags `Mutex` value copies precisely because this bug is silent. The rule is: if a struct has a `sync.Mutex` field, the struct is also pass-by-pointer once it's been used.

**Follow-up:** Can you initialize `sync.Mutex` to zero? Answer: yes, the zero value is a valid, unlocked mutex — that's a deliberate API choice across the whole package (`WaitGroup`, `Once`, `RWMutex`, `Mutex` are all useful at zero). No constructor needed, no `NewMutex()`.

---

### Q3. What's the difference between `Mutex` and `RWMutex`?

**Short answer:** `Mutex` is one-at-a-time — readers and writers all serialize through the same lock. `RWMutex` distinguishes readers from writers: many goroutines can hold the read lock (`RLock`) simultaneously, but a write lock (`Lock`) is exclusive and waits for all readers to drain. Use `RWMutex` when reads vastly outnumber writes *and* the critical section is long enough that read-parallelism actually helps. For short critical sections — a few field accesses — plain `Mutex` is faster because `RWMutex` has more bookkeeping.

**Follow-up:** How much does `RWMutex` cost over `Mutex`? Answer: depends on contention. Uncontended `RLock` is roughly twice the cost of `Lock` (two atomic ops vs one), and the writer path is slower because it has to count readers out. For a critical section of fewer than ~1µs, `RWMutex` rarely beats `Mutex`. Benchmark before assuming.

---

### Q4. What is `sync.WaitGroup` for?

**Short answer:** `WaitGroup` waits for a known set of goroutines to finish. You call `wg.Add(n)` to declare "I'm about to launch n goroutines," each goroutine calls `wg.Done()` when it's done, and the parent calls `wg.Wait()` to block until the counter reaches zero. It's a counter with a "wait for zero" primitive — nothing more. Inside, it's an atomic counter plus a semaphore that releases waiters when the counter hits zero.

**Follow-up:** What's the right place to call `Add`? Answer: in the parent goroutine, *before* launching the child. Calling `Add` inside the goroutine you just launched is a race — `Wait` can return before the goroutine ever bumps the counter. This is the most common `WaitGroup` bug and the race detector catches it.

---

### Q5. What is `sync.Once`?

**Short answer:** `sync.Once` guarantees a function runs exactly once across all goroutines that ever call `once.Do(fn)`, even under concurrency. The typical use is lazy initialization — a singleton, a parsed config, a connection pool — where you want the work to happen on first use rather than at package init time. All callers after the first see the work completed; concurrent callers during the first call block until the function returns. The zero value works; no constructor.

**Follow-up:** What if `fn` panics? Answer: `Once` still considers itself "done" — subsequent calls to `Do` will *not* re-run the function. If you need retry-on-panic semantics, build it yourself with a mutex; the `Once` contract is "run-at-most-once", not "succeed-at-least-once". Go 1.21 added `OnceFunc`, `OnceValue`, `OnceValues` for ergonomic wrappers; same semantics, panics still latch.

---

## 3. Middle questions (Q6–Q12)

### Q6. Walk through `Mutex.Lock` — fast path vs slow path.

**Short answer:** `Mutex.Lock` first tries a single CAS on the `state` int32: if `state` is 0 (unlocked, no waiters), `CompareAndSwap(state, 0, mutexLocked)` succeeds and we're done in one atomic op. That's the **fast path** — uncontended locking is essentially free, on the order of 10–20ns. If the CAS fails (lock held or waiters queued), control jumps to `lockSlow`, the **slow path**. There the goroutine spins briefly (a few iterations, on multicore and when the holder is running), then if still contended, parks on a semaphore (`runtime_SemacquireMutex`), going to sleep until the holder hands the lock off. The hand-off updates `state` to encode "the woken goroutine is now the owner" so the fast path stays exactly one CAS.

```go
// Approximated from src/sync/mutex.go.
func (m *Mutex) Lock() {
    // Fast path: grab unlocked mutex.
    if atomic.CompareAndSwapInt32(&m.state, 0, mutexLocked) {
        return
    }
    m.lockSlow()
}
```

The `state` int32 is bit-packed: the low bits encode `mutexLocked` (1), `mutexWoken` (2), `mutexStarving` (4), and the upper 29 bits hold the waiter count. One word, one CAS — that compactness is why the fast path is so cheap.

**Follow-up:** Why spin before parking? Answer: parking and unparking a goroutine costs hundreds of nanoseconds (scheduler work, possibly an OS futex). If the critical section is very short, the holder will release before the spinner has spent that much CPU — and waking from a spin is free. The runtime bounds the spin (typically 4 iterations of `procyield(30)`) so we don't burn CPU when contention is real. The decision to spin is delegated to `runtime_canSpin` — it requires multi-CPU, the lock holder must be running on another P, and the spin budget mustn't be exhausted.

---

### Q7. What's starvation mode in `sync.Mutex`?

**Short answer:** Without intervention, the fast-path "any goroutine can grab the lock" design lets a freshly-arriving goroutine win against a queued waiter — good for throughput, terrible for fairness. If contention is high enough, a queued waiter can sit on the semaphore indefinitely while newcomers keep racing past it. To prevent this, the `Mutex` source measures wait time on each unlock; if a waiter has been queued for more than **1ms**, the lock enters *starvation mode*. In starvation mode, `Unlock` hands the lock directly to the head waiter without going through the CAS race — newcomers go straight to the queue. The lock exits starvation mode when the woken waiter sees it's the last in line, or its wait was under 1ms.

**Follow-up:** What's the cost of starvation mode? Answer: throughput drops because the fast path is bypassed — every unlock is a hand-off. The 1ms threshold is the compromise: tolerable latency in the worst case for waiters, while normal-mode throughput is preserved for the common case. This is in `src/sync/mutex.go` — search for `starvationThresholdNs`.

---

### Q8. When does `sync.Pool` actually help?

**Short answer:** `sync.Pool` helps when you allocate short-lived, GC-heavy objects in hot paths *and* you can tolerate the pool dropping its contents at arbitrary GC events. The canonical wins are buffer reuse (`bytes.Buffer`, `[]byte`, gzip writers) in net/http handlers and encoders. The pool gives each P (processor) a local slot so `Get`/`Put` are almost lock-free in the common case, which is why it scales with cores. It does **not** help when (a) the objects are large and few, (b) you control their lifecycle anyway (just keep a slice), (c) GC pressure isn't actually the bottleneck — measure first.

```go
var bufPool = sync.Pool{
    New: func() any { return new(bytes.Buffer) },
}

func handler(w http.ResponseWriter, r *http.Request) {
    buf := bufPool.Get().(*bytes.Buffer)
    defer func() { buf.Reset(); bufPool.Put(buf) }()
    // ... use buf without allocating ...
}
```

The `Reset()` before `Put` is non-negotiable — pools recycle the object, not just the memory; stale state in the returned object is a bug waiting to surface.

**Follow-up:** What happens to pool contents at GC? Answer: the runtime clears pools at every GC cycle. Items not retrieved between GCs are dropped, so the pool is "best effort" — never assume `Get` returns something. The `New` callback runs if the pool is empty; it should return a usable zero-state object. This is why pools are about *amortizing* allocation, not *eliminating* it. Go 1.13 added the *victim cache* — the previous cycle's pool isn't dropped immediately but held one extra cycle — which roughly doubles hit rate for hot pools.

---

### Q9. Why is `sync.Map` slower than `map + Mutex` for write-heavy workloads?

**Short answer:** `sync.Map` is optimized for one specific pattern: **read-heavy, write-rarely, mostly-stable keys** (think connection caches keyed by remote addr, where keys are added once and read forever). Internally it keeps two maps — a lock-free `read` map for fast reads and a `dirty` map guarded by a mutex for writes. Reads hit `read` without locking; misses bump a counter and eventually promote `dirty` to `read`. The cost: every write goes through the mutex *and* tracks which keys are missing from `read`, so the bookkeeping is more expensive than `map[K]V` + `sync.RWMutex` for typical write-heavy traffic. If your workload writes often, the dual-map machinery is pure overhead.

**Follow-up:** When should you actually reach for `sync.Map`? Answer: when you've benchmarked and found that `map + RWMutex` is contention-bound *and* the keys are write-once. Otherwise, the simpler choice — and the Go team's own advice in the package docs — is `map + RWMutex` or `map + Mutex`. `sync.Map` is a specialised tool, not a default.

---

### Q10. When do you reach for `sync.Cond` vs a channel?

**Short answer:** `sync.Cond` is for "wake up goroutines waiting on a condition over shared state guarded by a mutex." The pattern is `for !cond { c.Wait() }` inside the locked region, and `c.Signal()` or `c.Broadcast()` from whoever changes the state. Use it when (a) the condition involves multiple variables protected by the same mutex, (b) you may need to wake *all* waiters atomically (`Broadcast`), (c) channels would force you to invent the shared state separately. Channels are better for handoff of values, one-shot signals, and producer-consumer pipelines — anywhere a value flows. `Cond` is better for "state changed, anyone waiting should re-check."

```go
type Queue struct {
    mu       sync.Mutex
    cond     *sync.Cond
    items    []int
    closed   bool
}

func (q *Queue) Pop() (int, bool) {
    q.mu.Lock()
    defer q.mu.Unlock()
    for len(q.items) == 0 && !q.closed {
        q.cond.Wait() // unlocks + sleeps + re-locks on wake
    }
    if len(q.items) == 0 { return 0, false }
    x := q.items[0]; q.items = q.items[1:]
    return x, true
}
```

**Follow-up:** What's the gotcha with `Cond.Wait`? Answer: you must hold the mutex when calling `Wait`, and `Wait` atomically unlocks-and-sleeps then re-locks on wake. You also must re-check the condition in a loop, because spurious wakeups and lost races between `Signal` and `Wait` are possible. The `for !cond { c.Wait() }` idiom is non-negotiable. The internal implementation uses `runtime_notifyListAdd` + `runtime_notifyListWait` — a ticket-based notification list that guarantees `Signal` wakes exactly one of the goroutines waiting *at the time of the signal*, not one that arrives later.

---

### Q11. What does `WaitGroup.Add` need to happen before?

**Short answer:** `Add(delta)` must complete before any concurrent `Wait()` call returns from the same `WaitGroup` reaching zero. In practice: call `Add` in the goroutine that calls `Wait`, *before* launching the goroutines that will `Done()`. Calling `Add` inside the launched goroutine is racy — `Wait` can observe the counter at zero (because no `Add` has happened yet) and return immediately, even though work was queued. The race detector flags this. The source enforces this loosely — `Add` and `Done` both mutate the same counter atomically — but no synchronisation primitive can save you if `Add` and `Wait` race.

```go
// CORRECT — Add before go.
var wg sync.WaitGroup
for _, job := range jobs {
    wg.Add(1)
    go func(j Job) { defer wg.Done(); process(j) }(job)
}
wg.Wait()

// WRONG — Add inside the goroutine races with Wait.
for _, job := range jobs {
    go func(j Job) {
        wg.Add(1)            // may not run before Wait returns
        defer wg.Done()
        process(j)
    }(job)
}
wg.Wait()
```

**Follow-up:** What does `WaitGroup.Add` actually do internally? Answer: it does an `atomic.AddUint64` on a packed `state` word holding the counter (upper 32 bits) and waiter count (lower 32 bits). If the counter goes negative, panic. If it reaches zero with waiters, release semaphore tokens for each waiter. This is in `src/sync/waitgroup.go` — the packed-state trick lets one atomic op update both halves and detect "counter just hit zero with waiters present" in the same operation.

---

### Q12. What does the race detector actually see?

**Short answer:** Go's race detector (`go build -race`) instruments every memory access (read and write) and every synchronisation event (mutex Lock/Unlock, channel send/recv, goroutine create/end, atomic ops). It builds a happens-before graph on the fly and reports a race when two accesses to the same address — at least one a write — are *unordered* in that graph. It runs the actual program, so it only catches races on paths that execute; it's a *dynamic* detector, not static analysis. Overhead is real (5–10× slowdown, ~2× memory), so you turn it on in CI and test environments, not production.

**Follow-up:** What's a common false negative? Answer: races on paths that don't execute during the test (rare error branches, slow timeouts). The detector reports zero races and you still have one in production. The defence: stress tests with `-race` *and* property-based or fuzz tests that explore more paths. The detector is necessary but not sufficient.

---

## 4. Senior questions (Q13–Q20)

### Q13. Compare `Mutex` and `RWMutex` performance characteristics.

**Short answer:** Three regimes to think about.

| Workload | Mutex | RWMutex |
|----------|-------|---------|
| **Uncontended, short critical section (<1µs)** | One CAS ~10ns | Two atomics on RLock; usually slower |
| **Reads >> writes, critical section >5µs** | Reads serialize | Reads parallelize, RWMutex wins |
| **High contention, mixed** | Predictable, may starve readers | Writer can be starved by stream of readers (pre-Go 1.18 worse, still possible) |
| **Memory footprint** | 8 bytes | 24 bytes |

The dominant factor is critical-section length, not read/write ratio. If readers are in and out in a few hundred nanoseconds, `Mutex` usually wins even at 99% read because the lock acquisition cost dominates the work. If the read holds the lock for tens of microseconds (computing a hash, walking a slice, copying a struct), `RWMutex` lets readers actually overlap and wins. The Go source for `RWMutex` is layered on top of two `Mutex` instances plus an atomic counter — the implementation cost is what you save by using plain `Mutex` when you can.

**Follow-up:** Does `RWMutex` allow writer starvation? Answer: yes, in principle a continuous stream of readers can delay the writer. The Go implementation queues the writer via a flag (`readerCount` goes negative once a writer is waiting) so new readers block until existing readers drain — that bounds writer wait time. But it's not strictly fair; a writer can wait significantly longer than under `Mutex`. Test under realistic load.

---

### Q14. When do you shard a lock?

**Short answer:** You shard when a single mutex is the contention bottleneck and the protected state can be partitioned by some key. The pattern: keep an array of `N` shards, each with its own mutex and its own slice of the data; route operations to `shards[hash(key) % N]`. The wins are linear-in-shard-count throughput improvement under high contention, because goroutines on different shards never see each other's lock. The cost: operations that need to span shards (snapshot all data, compute total size, iterate everything) now have to lock all shards in order — expensive — and you may pick the wrong shard count for your workload. Common shard counts are powers of two between 16 and `runtime.NumCPU() * 4`.

```go
type ShardedMap struct {
    shards [256]struct {
        mu sync.Mutex
        m  map[string]string
        _  [64]byte // cache-line padding to avoid false sharing
    }
}

func (s *ShardedMap) Get(key string) string {
    sh := &s.shards[fnv1a(key)%256]
    sh.mu.Lock()
    defer sh.mu.Unlock()
    return sh.m[key]
}
```

The padding matters: without it, adjacent shards' mutexes sit on the same cache line, and writes to one cause cache-coherency traffic for the other — a phenomenon called *false sharing* that can erase the benefit of sharding entirely.

**Follow-up:** Why not just use `sync.Map`? Answer: because (a) `sync.Map` is read-heavy-tuned, (b) sharded mutex preserves whatever struct you already have (no API rewrite), (c) sharding works for *any* state, not just maps — slices, caches, free lists. `sync.Map` is one specific point in the design space; sharding is a technique you apply to a much wider range of structures.

---

### Q15. Walk through `sync.Pool` internals.

**Short answer:** `Pool` keeps a `poolLocal` per P (one per processor). Each `poolLocal` has a `private` slot (single object, owned by this P, no atomics needed for the common case) and a `shared` deque (other Ps can steal from it). `Get` first checks `private`; if empty, pops the head of the local `shared` deque; if empty, work-steals from another P's `shared`; if still empty, calls `New`. `Put` puts into `private` if free, else pushes to the head of `shared`. Across GC cycles, the runtime moves the current "primary" cache to a "victim" cache (allocated last cycle), and clears the victim cache. So an object lives at most two GC cycles before being dropped — this is the *victim cache* trick added in Go 1.13, and it's what makes pools resilient to GC.

```go
// Approximated shape from src/sync/pool.go.
type Pool struct {
    local     unsafe.Pointer // per-P []poolLocal
    localSize uintptr
    victim     unsafe.Pointer // last cycle's local
    victimSize uintptr
    New func() any
}

type poolLocal struct {
    private any        // single item, no atomics
    shared  poolChain  // lock-free deque, others may steal
    pad     [cacheLineSize]byte // false-sharing guard
}
```

The `poolChain` is the interesting piece — a linked list of ring buffers, each twice the size of the previous, with lock-free push/pop on the owning P and lock-free pop from the other end for stealers. The double-ended design means the owner never collides with stealers in the steady state.

**Follow-up:** Why per-P and not per-goroutine? Answer: per-goroutine would explode memory (millions of goroutines, each holding pooled buffers). Per-P bounds the cache size to a multiple of CPU count, and crucially makes the fast path lock-free because a goroutine is pinned to its P during the `Get`/`Put` (the runtime disables preemption for the critical window via `runtime_procPin`). The victim cache compensates for GC clearing: a hot pool effectively sees a 2-cycle TTL rather than 1-cycle, which dramatically reduces miss rate.

---

### Q16. How does `sync.Map`'s `read + dirty` design work?

**Short answer:** `sync.Map` has two internal maps. **`read`** is an atomically-loaded `readOnly` struct holding `m map[interface{}]*entry`; reads check it without taking any lock. **`dirty`** is a regular `map` plus a `mu sync.Mutex`; it holds keys present in `read` *plus* keys added since the last promotion. When a `Load` misses in `read`, it grabs `mu`, checks `dirty`, increments a `misses` counter, and when misses exceed a threshold, *promotes* `dirty` to `read` (atomic store) and starts a fresh `dirty`. Writes to existing keys can update the entry's pointer atomically in `read`; writes to new keys go into `dirty`. `Delete` marks the entry as expunged (a sentinel) rather than removing it from `read`, so reads stay lock-free. The whole design optimizes for **keys that get added once and read many times** — that's the only workload where it's clearly better than `RWMutex + map`.

```go
// Simplified from src/sync/map.go.
type Map struct {
    mu     sync.Mutex
    read   atomic.Pointer[readOnly] // lock-free read path
    dirty  map[any]*entry            // mutated under mu
    misses int                        // counts read-misses; triggers promotion
}

type entry struct {
    p atomic.Pointer[any] // nil = deleted; expunged = removed from dirty too
}
```

The `entry.p` pointer indirection is what lets writes-to-existing-keys be lock-free: you CAS the entry's pointer to a new value, and any concurrent reader sees the old-or-new but never a torn read.

**Follow-up:** What's the cost of promotion? Answer: O(N) — `dirty` is copied to a new `read` map, and `read`'s expunged entries are dropped. Promotion happens on miss, so misses are amortized: most reads stay fast, occasional reads pay the promotion cost. If your workload writes new keys constantly, every read might trigger near-promotion behaviour and the dual structure is pure overhead — at that point `RWMutex + map` is faster and simpler.

---

### Q17. What's the memory-model contract of `Mutex`?

**Short answer:** `mu.Unlock()` happens-before any subsequent `mu.Lock()` returns. That's the entire contract, but it's a strong one: anything the unlocking goroutine wrote before `Unlock` is visible to the locking goroutine after `Lock` returns. This is what makes the mutex a *synchronisation* primitive and not just a lock — it provides memory ordering, not just mutual exclusion. Reads inside the critical section see a consistent snapshot of memory as of the previous unlock. The Go memory model spec (https://go.dev/ref/mem) explicitly states this. Same shape for `RWMutex` (Unlock → Lock and Unlock → RLock), `WaitGroup.Done` → `Wait` return, channel send → receive, `Once.Do`'s `f` completion → subsequent `Do` calls returning.

**Follow-up:** Why does this matter beyond mutual exclusion? Answer: because data races aren't just about "two writes at once" — they're about visibility. Without the happens-before edge, a write from goroutine A may not be visible to goroutine B even if there's no actual concurrent access. The mutex's memory ordering is why you can write `x = 1; mu.Unlock()` in one goroutine and `mu.Lock(); read x` in another and get `1`. Atomics provide a similar but weaker contract; channel send/recv provides it too.

---

### Q18. Explain `OnceValue` and `OnceValues`.

**Short answer:** Go 1.21 added `OnceFunc`, `OnceValue[T]`, and `OnceValues[T, U]` as convenience wrappers around `sync.Once`. `OnceValue(f func() T) func() T` returns a closure that, when called, runs `f` exactly once (under a `sync.Once`) and caches the return value; every subsequent call returns the cached value with no synchronisation needed after the first. `OnceValues` is the two-return variant for the common `(T, error)` pattern. The implementation is roughly `var v T; var once sync.Once; return func() T { once.Do(func() { v = f() }); return v }` plus the same panic-latching behaviour as `Once.Do`. The win is ergonomics — you express "lazy memoized value" in one line instead of declaring the once-and-cache fields by hand.

```go
// Before 1.21 — verbose memoization boilerplate.
var (
    cfg     *Config
    cfgOnce sync.Once
)
func loadConfig() *Config {
    cfgOnce.Do(func() { cfg = parseConfigFile() })
    return cfg
}

// 1.21+ — one line.
var loadConfig = sync.OnceValue(parseConfigFile)
```

**Follow-up:** Is the post-init read of the cached value race-free without a mutex? Answer: yes, because `Once.Do` completing happens-before any subsequent call to `Do` returning. The cached value's write inside `f` is ordered before any subsequent read by another goroutine through that happens-before edge. This is one of the cleanest examples of the memory model doing real work — no atomic load is needed on the read side after the first call. Note though that `OnceValue` does add a small per-call overhead even after init — it checks `Once.done` on every call — so for tightest hot paths you may still prefer caching the result yourself once init has completed.

---

### Q19. Compare `sync.Cond` with `chan struct{}`.

**Short answer:** `sync.Cond` and `chan struct{}` overlap for "wake up waiters" but differ in what they let you express.

| Concern | `sync.Cond` | `chan struct{}` |
|---------|-------------|-----------------|
| **Wake one** | `Signal()` — wakes one arbitrary waiter | Send one value; one receiver gets it |
| **Wake all** | `Broadcast()` — wakes all waiters atomically | Close the channel — all receivers unblock |
| **State coupling** | Built around a separate mutex + predicate | Channel value *is* the signal |
| **Reusable after Broadcast?** | Yes | Closed channels stay closed |
| **Spurious wakeups** | Possible — must re-check in a loop | No — receive always reflects a real send/close |

The `sync.Cond` API is direct port of pthread condvars and shows its age — most Go code is cleaner with channels. The exception is when the "condition" is a complex predicate over multiple variables under one mutex (`for !(state == Ready && queue.Empty()) { c.Wait() }`); expressing that with channels means inventing a separate signal channel and a re-check loop anyway. Use `Cond` when the state machine is *natural* to it; use channels otherwise.

**Follow-up:** What's the issue with `Broadcast` on a channel? Answer: closing a `chan struct{}` is the channel equivalent of `Broadcast` — all receivers unblock — but once closed it stays closed; you can't reuse it. For one-shot "release everyone" semantics, that's fine. For "release everyone now, then I'll re-arm for the next round," `Cond` or a fresh channel per round are the options.

---

### Q20. How do you debug "mutex held too long"?

**Short answer:** Five tools, in increasing intrusiveness.

1. **`go tool pprof` mutex profile.** Build with `runtime.SetMutexProfileFraction(N)` (or `import _ "net/http/pprof"`), hit `/debug/pprof/mutex`. Shows contention by stack — where goroutines are *waiting* on locks, summed by call site. The single highest-signal tool.
2. **Block profile.** `runtime.SetBlockProfileRate(N)` plus `/debug/pprof/block`. Shows where goroutines block (channels, mutexes, network). Complements mutex profile when the bottleneck isn't just mutex contention.
3. **Goroutine dump.** `SIGQUIT` or `/debug/pprof/goroutine?debug=2`. Look for many goroutines parked in `runtime_SemacquireMutex` with the same stack — that's "waiting on the same lock."
4. **Tracing.** `runtime/trace` shows mutex blocking events on a timeline; useful for understanding latency tail rather than aggregate contention.
5. **Source-level rework.** Once you know which lock, the fixes are: shrink the critical section (lift work outside the lock), shard the lock, switch to `RWMutex` if reads dominate, replace with `atomic` for a single word, replace with a lock-free structure if the access pattern allows.

The first move on a production "tail latency is bad" report is *always* the mutex profile — assumption-free, source-attributed, low-overhead in production.

**Follow-up:** Can the race detector help find held-too-long bugs? Answer: no — the race detector finds *races* (unsynchronized accesses), not contention. A correctly-locked program with horrendous contention races zero times. Profilers are the right tool for contention.

---

## 5. Staff/Architect questions (Q21–Q25)

### Q21. Design a fair `Mutex` without starvation mode.

**Short answer:** Fairness means FIFO: goroutines acquire the lock in the order they called `Lock`. Build it from a queue plus a single owner field.

```go
type FairMutex struct {
    mu      sync.Mutex // guards the queue, not the critical section
    held    bool
    waiters []chan struct{}
}

func (m *FairMutex) Lock() {
    m.mu.Lock()
    if !m.held {
        m.held = true
        m.mu.Unlock()
        return
    }
    ch := make(chan struct{})
    m.waiters = append(m.waiters, ch)
    m.mu.Unlock()
    <-ch // park until handed the lock
}

func (m *FairMutex) Unlock() {
    m.mu.Lock()
    defer m.mu.Unlock()
    if len(m.waiters) == 0 { m.held = false; return }
    next := m.waiters[0]
    m.waiters = m.waiters[1:]
    close(next) // hand off to head waiter — no race for the lock
}
```

1. **Queue of waiters.** Each call to `Lock` either becomes the owner (if the queue was empty and the lock was free) or appends itself to a singly-linked list of `*sudog`-like nodes and parks on a per-node semaphore.
2. **Hand-off on Unlock.** `Unlock` pops the head of the queue, sets the new owner, and releases that node's semaphore. No CAS race — the lock is *given* to the next waiter, not raced for.
3. **No fast path.** This is the cost: every `Lock` does at least an enqueue+park; every `Unlock` does a dequeue+wake. Throughput is bounded by hand-off cost (~hundreds of nanoseconds), which is 10–100× slower than `sync.Mutex`'s fast path.
4. **Memory model contract identical** — `Unlock` happens-before the woken `Lock` returns, same as `sync.Mutex`.

Why Go's `sync.Mutex` doesn't do this by default: most workloads are not contended enough to need fairness; the fast path dominates the user experience. Starvation mode is the compromise — fairness on demand (when a waiter has been blocked >1ms), throughput otherwise. A fair mutex would slow down 99% of the world to make 1% predictable. The staff move is to *measure* whether your workload is in that 1% before paying the cost.

**Follow-up:** Where would you actually use a fair mutex? Answer: when worst-case latency matters more than throughput — real-time-ish workloads, fair scheduling of network handlers, or where SLA bounds tail latency. Most application code does not need this; many systems pay the cost out of cargo-cult fairness.

---

### Q22. Critique `sync.Map`'s design.

**Short answer:** Five honest criticisms.

1. **Untyped API.** `Load(key interface{}) (interface{}, bool)` predates generics by years. In a 1.18+ world a `Map[K, V]` would be obvious; what we have requires type assertions at every call site. Go team has stated they won't generify `sync.Map` because the semantics aren't universally desirable.
2. **One-pattern optimization.** It's tuned for "keys added once, read forever." Outside that pattern it's *worse* than `map + RWMutex` — yet the name `sync.Map` invites people to reach for it as the default thread-safe map, which is a mistake.
3. **Memory overhead.** The dual-map structure plus per-entry pointer indirection roughly doubles memory vs a plain `map`. For caches with millions of entries, this is real.
4. **No iteration during write safety.** `Range` is documented as not necessarily seeing concurrent updates and not blocking writers — practically useful but means you can't build "snapshot" semantics on top of it.
5. **Promotion is O(N) and unpredictable.** A read can suddenly become expensive because it triggered a `dirty` → `read` promotion. For latency-sensitive paths this matters.

What a redesign would look like: a typed `Map[K comparable, V any]` with explicit pluggable strategy (read-heavy / write-heavy / balanced), or just deprecation in favour of `xsync.Map` or similar community implementations that use Cliff-Click-style striped hashtables. The fundamental issue is that "concurrent map" isn't one problem — read-heavy caches, write-heavy queues, and balanced workloads want different structures.

**Follow-up:** Why didn't the Go team build a striped hashmap instead? Answer: scope and stability. The 1.9 design (where `sync.Map` was added) targeted the specific workload they saw in the stdlib — `reflect`'s type cache, RPC method tables — and shipping a single struct kept the API surface small. A full striped-hashmap design opens many more questions (load factor, resize strategy, iteration semantics). They picked the smallest thing that solved their problem.

---

### Q23. Compare Go's `sync` to Rust's `std::sync`.

**Short answer:** Different design philosophies driven by different memory-safety guarantees.

| Aspect | Go `sync` | Rust `std::sync` |
|--------|-----------|------------------|
| **Mutex protects** | A *region of code* (the critical section); you protect data by convention | A *value* — `Mutex<T>` owns the `T`; you literally can't access `T` without locking |
| **Panic during critical section** | Lock stays locked unless you used `defer Unlock`; no automatic unwind | Lock is poisoned; subsequent `lock()` returns `Err(PoisonError)` so callers see corruption |
| **Read-write lock** | `sync.RWMutex` | `RwLock<T>`; same idea, also owns the data |
| **Atomic types** | `atomic.Int64`, `atomic.Pointer[T]` (modern); functions on raw words (old) | `AtomicI64`, `AtomicPtr<T>`, with explicit `Ordering` (Relaxed/Acquire/Release/SeqCst) on every op |
| **Memory ordering** | One model — sequentially-consistent-ish for synchronized accesses, race-free or undefined for unsynchronized | Explicit ordering at every atomic call site, exposing the hardware reality |
| **Once** | `sync.Once`, `OnceValue` | `std::sync::Once`, `OnceLock<T>`, `LazyLock<T>` |
| **Channels** | First-class `chan T` in language | `std::sync::mpsc` library type, less central |

The deepest difference: Rust's `Mutex<T>` makes the lock-data relationship a *type-level* property — the compiler enforces "you can't touch the data without locking" — while Go's `sync.Mutex` is a discipline you have to apply by convention. This is a direct consequence of Rust's borrow checker, which Go doesn't have. Go's choice trades correctness-by-construction for ergonomics and FFI simplicity; Rust trades verbosity for compile-time guarantees. Neither is universally right; they're appropriate to their respective language's whole design.

**Follow-up:** Is Rust's poisoning a feature? Answer: it's a *correctness* feature that's often a *usability* nightmare — most code calls `.unwrap()` on the lock result and crashes on poison, defeating the point. Many Rust shops use `parking_lot::Mutex` instead, which doesn't poison. The Go choice (no poisoning, no automatic unwind) is simpler and in practice probably the right call for a GC'd language with panics-as-recovery.

---

### Q24. When would you use `atomic.Pointer[T]` over `Mutex + *T`?

**Short answer:** When the pointer-swap *is* the synchronisation — you have a chunk of immutable data and you want to atomically publish a new version without forcing readers to lock. The pattern: writer constructs the new value off to the side, then calls `ptr.Store(new)`; readers call `ptr.Load()` and use the snapshot they got. No lock contention, no reader blocking, no writer blocking. This is great for hot-read configuration, route tables, feature flags, anywhere the data is replaced wholesale rather than mutated in place.

```go
type Config struct { /* immutable after construction */ }

var cfg atomic.Pointer[Config]

func init() { cfg.Store(loadInitial()) }

func Get() *Config { return cfg.Load() } // lock-free read on the hot path

func Reload() {
    next := loadFromDisk() // build the new snapshot off to the side
    cfg.Store(next)        // single atomic publish
}
```

It does **not** replace a mutex when (a) you need to read-modify-write the data (a counter), (b) multiple fields must update atomically together (atomic.Pointer can only swap one pointer), (c) readers must observe a consistent state across multiple `Load`s. For those, a mutex (or atomic+CAS on a versioned pointer) is still right. The mental model: `atomic.Pointer[T]` is *publish/subscribe of immutable snapshots*; `Mutex` is *coordinated mutation of mutable state*.

Senior moves: (a) the new value must be fully constructed before `Store` — racing reads can see only the post-Store state, which has to be valid; (b) old snapshots stay alive until readers drop their references — GC handles this for you, which is a real ergonomic win over Rust where you'd need `Arc<T>` and explicit lifetime management; (c) for "read mostly, write rare," `atomic.Pointer[T]` outperforms `RWMutex + T` because reads are a single atomic load with no locking at all.

**Follow-up:** What's the cost of `atomic.Pointer[T]` vs a raw `unsafe.Pointer`? Answer: zero at runtime — the generic wrapper compiles down to the same atomic ops. The win is type safety: you can't accidentally store a `*Wrong` into a `Pointer[Right]`, and you don't have to write `unsafe.Pointer` everywhere. Added in Go 1.19; use it.

---

### Q25. Discuss the runtime-sync linkname bridge.

**Short answer:** `sync` and the runtime need to share primitives — semaphores, goroutine parking, P-local storage — but they live in different packages. The mechanism is `//go:linkname`: `sync` declares `func runtime_Semacquire(s *uint32)` with no body, and a `//go:linkname runtime_Semacquire sync.runtime_Semacquire` directive in the runtime package binds the symbol at link time to the runtime's actual implementation. Same trick for `runtime_SemacquireMutex`, `runtime_Semrelease`, `runtime_canSpin`, `runtime_doSpin`, `sync_runtime_registerPoolCleanup`, `sync_runtime_procPin`, and a handful of others. This lets `sync` use runtime primitives without exposing them in the public `runtime` API.

```go
// In src/sync/runtime.go — declaration only.
func runtime_SemacquireMutex(s *uint32, lifo bool, skipframes int)

// In src/runtime/sema.go — the actual implementation.
//go:linkname sync_runtime_SemacquireMutex sync.runtime_SemacquireMutex
func sync_runtime_SemacquireMutex(addr *uint32, lifo bool, skipframes int) {
    semacquire1(addr, lifo, semaBlockProfile|semaMutexProfile, skipframes, waitReasonSyncMutexLock)
}
```

The trade-off: `//go:linkname` is unsafe-ish — it breaks the package abstraction barrier, the compiler can't check the signature matches across packages, and a runtime change can silently break `sync`. The Go team accepts this because (a) `sync` is co-developed with the runtime, (b) the alternative — exposing semaphore primitives in `runtime` — would invite misuse by user code, (c) it keeps the public `runtime` API minimal. The same bridge pattern shows up in `os`, `time`, and `reflect` for similar reasons.

Staff move: **don't use `//go:linkname` in application code.** It's a tool for the standard library and very low-level libraries (e.g., `golang.org/x/sys`); user code that uses it locks itself to specific Go versions and breaks on internal refactors. The Go team has been progressively restricting `//go:linkname` to runtime-stdlib use; Go 1.23 added an opt-in mechanism for hostile linknames. If you find yourself reaching for it, you almost certainly want a different design.

**Follow-up:** Could `sync` be reimplemented in pure user code without linknames? Answer: not really. The fast path of `Mutex` needs to interact with the goroutine scheduler (park/unpark) to avoid burning CPU on contention. Without scheduler primitives you'd have to busy-wait or use `runtime.Gosched()`, both of which are far worse than the current implementation. The linkname bridge is the price of having `sync` be a stdlib package rather than a runtime package.

---

## 6. What NOT to say

These lines mark a candidate as shallow within five seconds.

- **"Mutex is slow, use channels."** Channels are not a free upgrade — they have their own contention, and a `Mutex` fast path is one CAS. The right answer is "depends on whether you're protecting state or coordinating handoff."
- **"`sync.Map` is just a thread-safe map."** Reveals you've never read the package docs or measured. It's a specific optimization for a specific workload.
- **"Always use `RWMutex` if reads outnumber writes."** Critical-section length matters more than the read/write ratio. Short critical sections are usually slower under `RWMutex`.
- **"`WaitGroup.Add` can go anywhere."** Calling `Add` inside the goroutine you just launched is a race — Go's most common WaitGroup bug.
- **"The race detector finds all races."** It's dynamic; it only sees paths that execute. Necessary but not sufficient.
- **"`sync.Pool` is for reducing GC pressure."** Half-right. It's for *amortizing* allocation under high-throughput allocation-heavy paths, and the contents are dropped at GC — so it's not a general object cache.
- **"`sync.Once` will retry if the function fails."** It won't — `Do` considers itself done even on panic. If you need retry, build it yourself.
- **"You can copy a `Mutex` if you're careful."** No. `go vet` will yell, and the bug is silent. Pass by pointer; embed in pointer-passed structs.
- **"`sync.Cond` is the right way to wake goroutines."** Usually channels are cleaner. Reach for `Cond` only when the condition is a real predicate over locked state.
- **"Starvation mode is a bug."** It's a deliberate fairness guarantee that costs throughput. Knowing why it exists separates the candidate who's read the source from the one who hasn't.
- **"Use `atomic` for performance, use `Mutex` for safety."** They're not on the same axis — they solve different problems. Atomics protect single-word accesses with ordering; mutexes protect arbitrary critical sections.
- **"`//go:linkname` is fine in application code."** No. It locks you to a Go version and is being actively restricted.

---

## 7. Five-minute checklist

If you can run through this in under five minutes the morning of an interview, you're ready. Stumble on any item, re-read its section above.

- **`sync.Mutex` in two sentences.** Mutual exclusion lock, zero value is unlocked, must pass by pointer because it has internal state. Fast path is one CAS; slow path parks on a semaphore.
- **Why pointer.** Internal state (`state` int32 + `sema` uint32) is shared between users; copying gives you two unrelated locks.
- **Mutex vs RWMutex — when each wins.** Mutex for short critical sections regardless of read/write ratio. RWMutex when reads dominate *and* critical sections are long enough (>5µs rule of thumb) for read parallelism to matter.
- **Starvation mode.** Triggered when a waiter has been queued >1ms. Unlock hand-offs go directly to the head waiter instead of racing. Costs throughput, bounds worst-case latency.
- **`sync.Pool` use case.** Hot-path allocation reuse where GC pressure is the bottleneck. Per-P slots make it lock-free in the common case. Victim cache survives one GC.
- **`sync.Map` use case.** Read-heavy, write-once keys (think connection caches). Otherwise `map + RWMutex` is faster and simpler.
- **WaitGroup.Add ordering.** Call `Add` in the launching goroutine *before* `go func()`. Not inside the goroutine. Race detector catches this.
- **`Once` semantics.** Runs `f` at most once even on panic. After panic, subsequent `Do` calls return without running. `OnceValue`, `OnceFunc`, `OnceValues` added in 1.21.
- **`sync.Cond` core idiom.** `mu.Lock(); for !cond { c.Wait() }; mu.Unlock()`. Wait atomically unlocks-and-sleeps. Always re-check in a loop.
- **Memory-model contract.** `Unlock` happens-before subsequent `Lock` returns. This is what makes the mutex a synchronization primitive (visibility), not just a lock (exclusion).
- **`atomic.Pointer[T]` vs Mutex.** Atomic pointer publishes immutable snapshots; mutex coordinates mutable state. The first is faster for "config swap" patterns.
- **Debug "lock held too long."** Mutex profile (`SetMutexProfileFraction` + `/debug/pprof/mutex`) first. Block profile second. Goroutine dump third. Tracing for tail latency.
- **`//go:linkname` purpose.** Bridge between `sync` and the runtime for semaphores and scheduler primitives. Stdlib-internal; do not use in application code.
- **Race detector.** Dynamic instrumentation building a happens-before graph; reports unordered accesses where at least one is a write. 5–10× slowdown, ~2× memory. Necessary but not sufficient.
- **Three things `sync.Map`'s design gets wrong (for general use).** Untyped API, optimization for one workload only, O(N) promotion that makes some reads unexpectedly expensive.

---
