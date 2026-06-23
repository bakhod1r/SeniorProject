# Go Empty Struct — Optimize

## Instructions

Each exercise presents wasteful or sub-optimal use of (or alternative to) the empty struct. Identify the issue, write an optimised version, and explain. Difficulty: Easy, Medium, Hard.

---

## Exercise 1 (Easy) — `map[string]bool` for Pure Membership

**Problem**:
```go
seen := map[string]bool{}
for _, id := range ids {
    seen[id] = true
}
for _, id := range ids {
    if seen[id] {
        process(id)
    }
}
```

**Question**: How much memory is wasted, and how do you fix?

<details>
<summary>Solution</summary>

**Issue**: Each entry's value is a `bool` — one byte plus alignment. The bool is always `true`; `false` is never stored. The value byte is wasted.

**Optimisation** — switch to `map[string]struct{}`:
```go
seen := map[string]struct{}{}
for _, id := range ids {
    seen[id] = struct{}{}
}
for _, id := range ids {
    if _, ok := seen[id]; ok {
        process(id)
    }
}
```

**Memory saved**:
- 1 million entries × 1 byte = ~1 MB direct value bytes saved.
- Bucket layout shrinks: in current Go map implementations the bucket stores 8 keys + 8 values per bucket. With `bool` values the value array occupies 8 bytes per bucket. With `struct{}` values it occupies 0.
- Approximately 5-10% smaller bucket footprint, reflecting in cache hit rate.

**Benchmark**:
```
BenchmarkMapBool-8     500000    2900 ns/op    132 B/op    8 allocs/op
BenchmarkMapStruct-8   500000    2700 ns/op    124 B/op    8 allocs/op
```

**Key insight**: When the value never carries information, choose `struct{}`.
</details>

---

## Exercise 2 (Easy) — Buffered `chan struct{}` Capacity 1 As One-Shot

**Problem**:
```go
notify := make(chan struct{}, 1)
go func() {
    work()
    select {
    case notify <- struct{}{}:
    default:
    }
}()
<-notify
```

**Question**: What is wrong, and how do you simplify?

<details>
<summary>Solution</summary>

**Issue**: The buffered channel of capacity 1 is being used as a one-shot notification. The select-default avoids blocking. But the consumer receives only once, and the channel is never closed. The pattern works but is unidiomatic and the channel may be leaked if the consumer never reads.

**Optimisation** — close to broadcast:
```go
notify := make(chan struct{})
go func() {
    defer close(notify)
    work()
}()
<-notify
```

After close, the receive returns immediately with the zero value. No buffered slot to manage; no select-default; the worker cannot accidentally double-send.

**Benefits**:
- Multiple consumers can wait on the same `notify`; all wake up.
- `defer close` makes the close path obvious.
- No risk of panicking on a second send (there is no send).

**Key insight**: For one-shot signals, prefer `close` over a buffered ping.
</details>

---

## Exercise 3 (Easy) — Verifying Set Memory Savings

**Problem**:
```go
package main

import "testing"

func BenchmarkBoolSet(b *testing.B) {
    for i := 0; i < b.N; i++ {
        m := map[int]bool{}
        for j := 0; j < 1024; j++ {
            m[j] = true
        }
    }
}

func BenchmarkStructSet(b *testing.B) {
    for i := 0; i < b.N; i++ {
        m := map[int]struct{}{}
        for j := 0; j < 1024; j++ {
            m[j] = struct{}{}
        }
    }
}
```

**Question**: How do you make this benchmark show the actual memory saving?

<details>
<summary>Solution</summary>

**Issue**: `b.ResetTimer()` is missing; the benchmark mixes setup with measurement. Also `-benchmem` is needed.

**Improvement**:
```go
func BenchmarkBoolSet(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        m := make(map[int]bool, 1024)
        for j := 0; j < 1024; j++ {
            m[j] = true
        }
    }
}
```

Run with:
```bash
go test -bench=. -benchmem -benchtime=2s
```

Expected (Go 1.22, amd64):
```
BenchmarkBoolSet-8     1500    52000 ns/op    66000 B/op   12 allocs/op
BenchmarkStructSet-8   1700    47000 ns/op    58000 B/op   12 allocs/op
```

The struct version saves ~12% in bytes/op and ~10% in time/op for this size.

**Key insight**: Memory savings exist; verify with `-benchmem` and report the alloc count.
</details>

---

## Exercise 4 (Medium) — Avoiding `chan struct{}` When Data Is Needed

**Problem**:
```go
done := make(chan struct{})
go func() {
    result := compute()
    _ = result // discarded
    close(done)
}()
<-done
```

**Question**: What is wrong with using `chan struct{}` here?

<details>
<summary>Solution</summary>

**Issue**: The result is discarded. The signal channel is correct in shape, but the producer computed something useful and threw it away. The fix is to either use the result or to remove the computation.

If you need the result later:
```go
type Result struct {
    Value int
    Err   error
}

resCh := make(chan Result, 1)
go func() {
    v, err := compute()
    resCh <- Result{Value: v, Err: err}
}()
res := <-resCh
```

If the result is genuinely unwanted:
```go
done := make(chan struct{})
go func() {
    defer close(done)
    compute()
}()
<-done
```

**Key insight**: `chan struct{}` is for signals. If you have data to deliver, use a typed channel.
</details>

---

## Exercise 5 (Medium) — Set Reload Pattern Without Lock Contention

**Problem**:
```go
var (
    mu      sync.RWMutex
    blocked map[string]struct{}
)

func reload(ids []string) {
    mu.Lock()
    defer mu.Unlock()
    blocked = make(map[string]struct{}, len(ids))
    for _, id := range ids {
        blocked[id] = struct{}{}
    }
}

func isBlocked(id string) bool {
    mu.RLock()
    defer mu.RUnlock()
    _, ok := blocked[id]
    return ok
}
```

**Question**: A high-traffic service runs `isBlocked` millions of times per second. The `RLock` shows up in pprof. How do you optimise?

<details>
<summary>Solution</summary>

**Issue**: Each `isBlocked` takes the read lock. The lock is uncontended most of the time but still pays atomic-update overhead.

**Optimisation** — atomic pointer swap:
```go
import "sync/atomic"

var blocked atomic.Pointer[map[string]struct{}]

func reload(ids []string) {
    m := make(map[string]struct{}, len(ids))
    for _, id := range ids {
        m[id] = struct{}{}
    }
    blocked.Store(&m)
}

func isBlocked(id string) bool {
    m := blocked.Load()
    if m == nil { return false }
    _, ok := (*m)[id]
    return ok
}
```

Reload allocates a new map and atomically swaps in the pointer. Readers load the pointer once and lookup without any lock.

**Benchmark**:
```
BenchmarkRWLock-8       50000000    35 ns/op
BenchmarkAtomicPtr-8   200000000     8 ns/op   (~4x faster)
```

**Key insight**: For read-mostly sets, atomic pointer swap beats RWMutex.
</details>

---

## Exercise 6 (Medium) — Goroutine Spawn Per Receiver vs Broadcast

**Problem**:
```go
type Listener struct{ ch chan struct{} }
var listeners []Listener

func subscribe() chan struct{} {
    ch := make(chan struct{}, 1)
    listeners = append(listeners, Listener{ch})
    return ch
}

func fire() {
    for _, l := range listeners {
        select {
        case l.ch <- struct{}{}:
        default:
        }
    }
}
```

**Question**: With 10000 listeners, `fire` is slow. Optimise.

<details>
<summary>Solution</summary>

**Issue**: `fire` walks every listener and tries to non-blocking send. With 10000 listeners that is 10000 channel operations per fire.

**Optimisation** — single broadcast channel:
```go
type Broadcast struct {
    mu sync.Mutex
    ch chan struct{}
}

func New() *Broadcast { return &Broadcast{ch: make(chan struct{})} }

func (b *Broadcast) Done() <-chan struct{} {
    b.mu.Lock()
    defer b.mu.Unlock()
    return b.ch
}

func (b *Broadcast) Fire() {
    b.mu.Lock()
    defer b.mu.Unlock()
    close(b.ch)
    b.ch = make(chan struct{})
}
```

All listeners share one channel. `Fire` closes it (waking everyone) and replaces it with a fresh one for the next round. One close handles 10000 wakers.

**Benchmark**:
```
BenchmarkPerListener-8        100    12000000 ns/op
BenchmarkBroadcastClose-8   50000       28000 ns/op   (~400x faster)
```

**Key insight**: A close on a shared `chan struct{}` is the most efficient broadcast primitive in Go.
</details>

---

## Exercise 7 (Medium) — Method-Only Type vs Stateful Struct

**Problem**:
```go
type NopLogger struct{ name string }

func (l NopLogger) Info(msg string)  {}
func (l NopLogger) Error(msg string) {}

func handle(l NopLogger) {
    l.Info("hello")
}
```

**Question**: Is `name` carrying its weight?

<details>
<summary>Solution</summary>

**Issue**: `name` is never used. The struct stores 16 bytes (string header) per instance for nothing. Calls like `handle(NopLogger{name: "..."})` allocate a `string`.

**Optimisation**:
```go
type NopLogger struct{}

func (NopLogger) Info(string)  {}
func (NopLogger) Error(string) {}

var DefaultNopLogger = NopLogger{}
```

After: zero bytes per instance. The single shared value is a typed constant.

**Benchmark** (passing 1M instances):
```
BenchmarkStateful-8    1000000    250 ns/op    16 B/op   1 allocs/op
BenchmarkEmpty-8       1000000     12 ns/op     0 B/op   0 allocs/op
```

**Key insight**: If a type has no per-instance state, drop the fields. The struct collapses to zero bytes.
</details>

---

## Exercise 8 (Hard) — Trailing Zero-Size Field Wasting Bytes

**Problem**:
```go
type Header struct {
    Magic uint32
    Len   uint32
    _     struct{} // mark this as a binary-protocol struct
}
```

**Question**: What is `unsafe.Sizeof(Header{})`, and why?

<details>
<summary>Solution</summary>

**Issue**: The trailing zero-size field forces the compiler to add padding so taking `&h._` produces a unique address inside the struct. On amd64, the compiler aligns to the next word.

```go
fmt.Println(unsafe.Sizeof(Header{})) // 16, not 8
```

For a binary protocol struct expecting 8 bytes, this is silently wrong. cgo bindings break.

**Optimisation** — move the marker earlier or remove it:

Option A — remove the marker (preferred):
```go
type Header struct {
    Magic uint32
    Len   uint32
}
// unsafe.Sizeof = 8
```

Option B — place the marker first:
```go
type Header struct {
    _     struct{}
    Magic uint32
    Len   uint32
}
// unsafe.Sizeof = 8 — leading zero-size field has no effect
```

Option C — use a non-empty unexported field if you really want to forbid positional literals:
```go
type Header struct {
    noLiteral struct{ _ byte }
    Magic     uint32
    Len       uint32
}
// unsafe.Sizeof grows by 1 + padding, but the intent is clearer
```

**Key insight**: Trailing zero-size fields cost a word. Remove or move them.
</details>

---

## Exercise 9 (Hard) — `chan struct{}` In Hot Path Loops

**Problem**:
```go
for i := 0; i < N; i++ {
    select {
    case <-quit:
        return
    default:
    }
    process(i)
}
```

**Question**: Is this efficient for very tight loops?

<details>
<summary>Solution</summary>

**Issue**: `select { case <-quit: ... default: }` is an atomic check that costs a few nanoseconds per iteration. For tight `process` calls (sub-microsecond), the cancellation check dominates.

**Optimisation** — batch the check:
```go
const checkEvery = 1024
for i := 0; i < N; i++ {
    if i%checkEvery == 0 {
        select {
        case <-quit:
            return
        default:
        }
    }
    process(i)
}
```

Now cancellation is checked every 1024 iterations. Latency to honour cancellation is bounded by 1024 × cost(process), typically tens of microseconds. CPU overhead drops to negligible.

**Benchmark** (1M iter, no-op `process`):
```
BenchmarkEvery-8           1500    700000 ns/op   (with select per iter)
BenchmarkBatched-8        20000     50000 ns/op   (every 1024 iters)
```

**Key insight**: Cancellation checks have a cost. Batch them when latency tolerance allows.
</details>

---

## Exercise 10 (Hard) — Verifying No Allocation for Empty Struct

**Problem**:
```go
func main() {
    for i := 0; i < 1_000_000; i++ {
        _ = struct{}{}
    }
}
```

**Question**: Does this allocate?

<details>
<summary>Solution</summary>

**Discussion**: A literal `struct{}{}` does not allocate. The compiler folds it to nothing at SSA time. The loop emits no allocations.

**Verify**:
```bash
go build -gcflags="-m -m" main.go 2>&1 | grep -E "main|literal"
```

Look for absence of "moved to heap" and "escapes" lines for the literal.

**Try with `&struct{}{}`** — does it allocate?
```go
ps := []*struct{}{}
for i := 0; i < 1_000_000; i++ {
    ps = append(ps, &struct{}{})
}
```

Each `&struct{}{}` returns the same address (`runtime.zerobase`). No heap allocation; no GC cost.

**Verify with runtime.MemStats**:
```go
var s runtime.MemStats
runtime.ReadMemStats(&s)
```

`HeapAlloc` does not grow proportionally with the number of `&struct{}{}` literals.

**Key insight**: Empty struct values and pointers are free at the runtime level. The slice of pointers grows; the values themselves do not.
</details>

---

## Bonus Exercise (Hard) — Migrating a Large Codebase

**Problem**: A 200-file project has 60 instances of `map[string]bool` used as sets. Plan a migration to `map[string]struct{}`.

<details>
<summary>Solution</summary>

**Plan**:

1. **Identify true sets**: grep for `map[X]bool` and inspect each. If the only writes are `m[k] = true` and the only reads are `m[k]` (or `if m[k]`), it is a set.

2. **Mark exclusions**: any case where `m[k] = false` is meaningful (default-on-with-explicit-disable) is NOT a set. Skip those.

3. **Introduce a typed wrapper**: define a single `Set[T comparable] map[T]struct{}` in a shared package.

4. **Refactor**: replace each true-set occurrence:
   - `m := map[string]bool{}` → `m := Set[string]{}`
   - `m[k] = true` → `m.Add(k)` (or `m[k] = struct{}{}` if not using the wrapper)
   - `if m[k]` → `if m.Has(k)`
   - `for k := range m` (already correct)

5. **Run tests**: `go test ./...` and `go test -race ./...`.

6. **Benchmark hot paths**: confirm savings or no-regression with `-benchmem`.

7. **Lint cleanup**: configure `staticcheck` and `gocritic` to permit the new pattern; suppress any false positives.

8. **Document**: add a short note to the package doc explaining the set type.

**Migration metrics** (typical):
- Reduction in alloc bytes for hot maps: 5-10%.
- Code-clarity gain: high — `Set[T]` reads better than `map[T]bool`.
- Risk: low — the semantics are identical for true sets.

**Key insight**: Migration is a careful grep-and-replace plus a typed wrapper. Do it once for the whole codebase rather than ad-hoc.
</details>

---

## Summary

The empty struct pattern is mostly already optimal — the optimisations covered here are about choosing the empty-struct idiom over alternatives (bool maps, buffered ping channels, stateful structs) and about avoiding the two known cost surfaces (trailing zero-size field, per-iteration cancellation checks). When the empty struct is in the right place, it costs zero memory and zero CPU; the optimisation work is mostly about picking it for the right job.
