---
layout: default
title: Mutex vs Atomic — Find the Bug
parent: Mutex vs Atomic
grand_parent: Primitives Decision Guide
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/24-primitives-decision-guide/02-mutex-vs-atomic/find-bug/
---

# Mutex vs Atomic — Find the Bug

[← Back](../)

Ten buggy snippets. Each compiles. Each is broken. Spot the bug before you read the explanation.

---

## Bug 1 — Mixed Atomic and Non-Atomic Access

```go
var counter int64

func add()  { atomic.AddInt64(&counter, 1) }
func read() int64 { return counter } // <-- plain read
```

**The bug.** `read()` does a non-atomic load of a word that other goroutines write atomically. The Go memory model explicitly does not define this. The race detector flags it with Go 1.19+.

**The fix.** All accesses must be atomic, or none of them:

```go
func read() int64 { return atomic.LoadInt64(&counter) }
```

Or use the typed atomic, which makes plain access impossible:

```go
var counter atomic.Int64
// counter.Add(1), counter.Load() — no plain access possible
```

---

## Bug 2 — Lost Update via Load-Modify-Store

```go
var n atomic.Int64

func incrementIfPositive() {
    v := n.Load()
    if v > 0 {
        n.Store(v + 1) // <-- lost-update window between Load and Store
    }
}
```

**The bug.** Between `Load` and `Store`, another goroutine can have its own `Load` followed by `Store`. Both see `v=5`, both write `6`. The counter increments once instead of twice.

**The fix.** A CAS loop:

```go
func incrementIfPositive() {
    for {
        v := n.Load()
        if v <= 0 {
            return
        }
        if n.CompareAndSwap(v, v+1) {
            return
        }
    }
}
```

---

## Bug 3 — 32-bit ARM Alignment Crash

```go
type Stats struct {
    Name    string
    Counter int64 // <-- not first; on 32-bit ARM may not be 8-byte aligned
}

func (s *Stats) Inc() {
    atomic.AddInt64(&s.Counter, 1) // panics on 32-bit ARM
}
```

**The bug.** `string` is 8 bytes on 64-bit but 8 bytes (header) on 32-bit too — wait, the issue is more subtle. On 32-bit ARM the struct header begins at an 8-byte boundary (heap allocation guarantee), `Name` occupies 8 bytes (two 4-byte words: pointer + length), so `Counter` ends up at offset 8, which is aligned. Try harder:

```go
type Stats struct {
    Tag     uint32  // 4 bytes
    Counter int64   // <-- offset 4 on 32-bit ARM — UNALIGNED
}
```

This struct: `Tag` at offset 0, `Counter` at offset 4. On 32-bit ARM, `atomic.AddInt64(&s.Counter, 1)` invokes `LDREXD` on an offset-4 address, which raises a hardware alignment fault. The Go runtime catches it and panics with `unaligned 64-bit atomic operation`.

**The fix (1.19+).** Use `atomic.Int64`, which carries `align64` and forces correct alignment:

```go
type Stats struct {
    Tag     uint32
    Counter atomic.Int64 // compiler inserts padding before this field
}
```

**The fix (pre-1.19).** Put 64-bit atomics first:

```go
type Stats struct {
    Counter int64
    Tag     uint32
}
```

---

## Bug 4 — ABA in a Hand-Rolled Pool

```go
type Pool struct {
    head atomic.Pointer[node]
}

type node struct {
    next *node
    buf  [4096]byte
}

// Returned nodes are placed in a sync.Pool for reuse to save allocations.
var nodePool = sync.Pool{New: func() any { return new(node) }}

func (p *Pool) Get() *node {
    for {
        old := p.head.Load()
        if old == nil {
            return nodePool.Get().(*node)
        }
        if p.head.CompareAndSwap(old, old.next) {
            return old
        }
    }
}

func (p *Pool) Put(n *node) {
    nodePool.Put(n) // <-- the bug: caller reused too early
}
```

Wait — the bug is wider. The Treiber stack above is correct in Go (GC keeps nodes alive). The bug is that `Put` recycles into a `sync.Pool`, which then hands the same `*node` back to another goroutine that pushes it onto the stack while a third goroutine is mid-CAS holding the same address. Classic ABA.

**The bug.** Hand-rolled object pooling breaks Go's GC-based ABA protection. The same `*node` address can be observed by two goroutines in two states.

**The fix.** Do not pool nodes used in lock-free structures. Let the GC handle it. If allocation pressure is real, switch to a different structure (e.g. an array-based queue with a tag).

---

## Bug 5 — Compound Invariant Treated as Atomic

```go
type Account struct {
    Balance atomic.Int64
    History []Tx
    mu      sync.Mutex
}

func (a *Account) Withdraw(amt int64, tx Tx) {
    a.Balance.Add(-amt)
    a.mu.Lock()
    a.History = append(a.History, tx)
    a.mu.Unlock()
}
```

**The bug.** Balance and history are updated separately. Another goroutine reading `Balance` then `History` (under its own protocol) can see balance decremented but no matching transaction. Atomicity of one word does not give atomicity of two fields.

**The fix.** Protect both under the same mutex:

```go
func (a *Account) Withdraw(amt int64, tx Tx) {
    a.mu.Lock()
    defer a.mu.Unlock()
    a.Balance -= amt // now plain int64; the mutex protects it
    a.History = append(a.History, tx)
}
```

(And change `Balance` from `atomic.Int64` to `int64` — having both is worse than either alone.)

---

## Bug 6 — Forgetting the CAS Result

```go
var head atomic.Pointer[Node]

func Push(n *Node) {
    n.next = head.Load()
    head.CompareAndSwap(n.next, n) // <-- ignored return value
}
```

**The bug.** If CAS fails (another goroutine pushed first), this just drops the push. The new node is lost. `CompareAndSwap` returns false on failure; the caller must loop.

**The fix.**

```go
func Push(n *Node) {
    for {
        old := head.Load()
        n.next = old
        if head.CompareAndSwap(old, n) {
            return
        }
    }
}
```

---

## Bug 7 — Reading Inside a Mutex, Caching the Pointer

```go
var (
    mu  sync.RWMutex
    cfg *Config
)

func Get() *Config {
    mu.RLock()
    defer mu.RUnlock()
    return cfg
}

func Reload(c *Config) {
    mu.Lock()
    cfg = c
    mu.Unlock()
}
```

**The bug.** This is correct but pays for `RWMutex` on every read. The author wrote it because they assumed pointer reads need protection. Pointer reads of one word do not need a mutex — they need an `atomic.Pointer`.

**Performance fix.**

```go
var cfg atomic.Pointer[Config]

func Get() *Config       { return cfg.Load() }
func Reload(c *Config)   { cfg.Store(c) }
```

10-50x faster under read pressure, no contention on the lock's internal state.

---

## Bug 8 — Atomic Bool Reused as a Mutex

```go
var locked atomic.Bool

func tryLock() bool {
    if locked.Load() {
        return false
    }
    locked.Store(true)
    return true
}
```

**The bug.** `Load` then `Store` is not atomic. Two goroutines can both see `Load() == false`, both call `Store(true)`, both think they hold the lock.

**The fix.** One-shot CAS:

```go
func tryLock() bool {
    return locked.CompareAndSwap(false, true)
}

func unlock() {
    locked.Store(false)
}
```

(Although: if you need a lock, use `sync.Mutex`. This pattern is a spinlock and is almost always a mistake in Go because it does not integrate with the scheduler.)

---

## Bug 9 — `atomic.Value` Type Mismatch

```go
var v atomic.Value

func init() {
    v.Store(uint32(0))
}

func tick() {
    v.Store(int32(1)) // panics: store inconsistent type
}
```

**The bug.** `atomic.Value` requires every `Store` to use the same dynamic type. The first `Store` fixed `uint32`; the second `Store` with `int32` panics with `sync/atomic: store of inconsistently typed value into Value`.

**The fix.** Be consistent (use `int32` everywhere) or use `atomic.Int32`/`atomic.Uint32` which is type-checked at compile time. In new code, prefer the typed atomics.

---

## Bug 10 — Padding Forgotten on Hot Atomics

```go
type Metrics struct {
    Requests atomic.Int64
    Errors   atomic.Int64
}
```

**The bug.** `Requests` and `Errors` share a cache line. Two goroutines, each on a different core, both incrementing their respective counter, cause false sharing: every write invalidates the other CPU's cache line. Performance collapses by 5-10x compared to padded counters.

**The fix.**

```go
type Metrics struct {
    Requests atomic.Int64
    _        [56]byte // pad to cache line (64 bytes total)
    Errors   atomic.Int64
    _        [56]byte
}
```

A subtle related bug: cache lines are 64 bytes on amd64, ARM64, and most modern CPUs, but some Intel CPUs prefetch in 128-byte pairs. The Go runtime conservatively pads to 64 in `runtime/internal/cpu.CacheLinePadSize`. For hot performance code, profile and consider 128.

---

## Summary Table

| Bug | Root cause | Fix |
|---|---|---|
| 1 | Mixed atomic/non-atomic | Atomic everywhere |
| 2 | Load-modify-store gap | CAS loop |
| 3 | 32-bit ARM alignment | `atomic.Int64` or first-field |
| 4 | ABA from hand-rolled pooling | Trust the GC |
| 5 | Compound invariant | One mutex over all fields |
| 6 | Ignored CAS return | Loop until CAS succeeds |
| 7 | RWMutex for one-pointer publish | `atomic.Pointer[T]` |
| 8 | Load-then-store TryLock | `CompareAndSwap` |
| 9 | `atomic.Value` type mismatch | Typed atomics |
| 10 | Cache-line false sharing | Pad to 64 bytes |

---

## Bug 11 — Atomic on a Copied Struct

```go
type Counter struct {
    n atomic.Int64
}

func (c Counter) Inc() { // receiver is VALUE, not pointer
    c.n.Add(1)
}

func main() {
    var c Counter
    for i := 0; i < 1000; i++ {
        go c.Inc()
    }
    // ... wait ...
    fmt.Println(c.n.Load()) // always 0
}
```

**The bug.** `Inc` has a value receiver, so each call gets its own copy of `Counter`. Every `Add` increments a temporary stack-local atomic. The original `c.n` is never touched.

`go vet` catches this with the `-copylocks` checker: `atomic.Int64` embeds `noCopy`, and `vet` warns about copying it.

**The fix.**

```go
func (c *Counter) Inc() {
    c.n.Add(1)
}
```

Pointer receiver. Or: pass `*Counter` to goroutines explicitly.

---

## Bug 12 — Type Mismatch in `atomic.Value`

```go
var cfg atomic.Value

func init() {
    cfg.Store(&Config{...})
}

func reset() {
    cfg.Store(nil) // panics: store of nil concrete value
}
```

**The bug.** `atomic.Value.Store(nil)` panics because the dynamic type of `nil` is `<nil>`, which differs from the first-stored type (`*Config`).

**The fix.** Store a typed nil:

```go
func reset() {
    var c *Config
    cfg.Store(c) // dynamic type is still *Config
}
```

Or use `atomic.Pointer[Config]`, where `Store(nil)` works correctly because the pointer type is fixed at compile time.

---

## Bug 13 — Forgetting Memory Order Across a Channel

```go
var ready bool
done := make(chan struct{})

go func() {
    ready = true
    close(done)
}()

<-done
if ready {
    // ...
}
```

Wait — is this a bug? Reading the Go memory model carefully: a channel send (close) is synchronised before the receive that observes it. Writes done before the close are visible after the receive. So `ready = true` is visible after `<-done`.

This is actually CORRECT. The bug is the assumption that you need atomic here. You do not. Channels carry memory order.

The bug PATTERN this teaches: do not slap `atomic.Bool` on every shared bool. If a channel or mutex already orders the access, you do not need atomics. Over-atomicising is a real code smell.

---

## Bug 14 — Two Atomic Counters Read Non-Jointly

```go
type Stats struct {
    Sent     atomic.Int64
    Received atomic.Int64
}

func (s *Stats) RoundTrip() (sent, received int64) {
    return s.Sent.Load(), s.Received.Load()
}
```

**The bug.** Each Load is atomic. The pair is not. Between the two loads, sends and receives may happen. If `Sent.Load() = 100` and then between the two loads goroutine X sends and the recipient receives (so both increment), `Received.Load() = 100` even though only 99 of those receives are for the 100 sends already observed.

For most monitoring this is fine. For invariants (e.g., "sent >= received"), it is broken.

**The fix.** One `atomic.Pointer[Stats]` published as a snapshot. Or a mutex held over both loads.

---

## Summary Table (extended)

| Bug | Root cause | Fix |
|---|---|---|
| 11 | Value receiver copies atomic | Pointer receiver, vet catches |
| 12 | atomic.Value nil type mismatch | Typed nil, or atomic.Pointer |
| 13 | Atomic where channel/mutex suffices | Trust the existing synchronisation |
| 14 | Joint snapshot expectation | Snapshot struct under atomic.Pointer |
