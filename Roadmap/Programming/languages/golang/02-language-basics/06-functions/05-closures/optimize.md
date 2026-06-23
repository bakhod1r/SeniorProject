# Go Closures — Optimize

## Instructions

Each exercise presents inefficient or wasteful closure usage. Identify the issue, write an optimized version, and explain. Difficulty: 🟢 Easy, 🟡 Medium, 🔴 Hard.

---

## Exercise 1 🟢 — Heavy Capture

**Problem**:
```go
type BigData struct{ buf [1<<20]byte }

func makeReader(b *BigData) func() byte {
    return func() byte { return b.buf[0] }
}
```

**Question**: What's the memory cost, and how do you fix?

<details>
<summary>Solution</summary>

**Issue**: Each closure pins 1 MB. With 100 closures, 100 MB are held until all are GC'd.

**Optimization** — capture only the needed byte:
```go
func makeReader(b *BigData) func() byte {
    first := b.buf[0]
    return func() byte { return first }
}
```

After: each closure holds 1 byte. The BigData is freed when `makeReader` returns.

**Benchmark** (100 instances, kept alive):
- Capture pointer: 100 MB pinned
- Capture byte: 100 bytes pinned

**Key insight**: Capturing pointers extends pointee lifetime. Extract minimum needed.
</details>

---

## Exercise 2 🟢 — Closure in Hot Loop

**Problem**:
```go
for _, item := range items {
    sched.Go(func() { process(item) })
}
```

**Question**: How many allocations? How do you reduce?

<details>
<summary>Solution</summary>

**Issue**: Each iteration creates a closure capturing `item`. If `sched.Go` retains it, the closure escapes — heap allocation per iteration.

**Optimization** — pass `item` as an argument:
```go
for _, item := range items {
    sched.GoArg(processArg, item)
}

func processArg(arg interface{}) { process(arg.(Item)) }
```

Or pass the typed function directly:
```go
for _, item := range items {
    sched.GoTyped(process, item)
}
```

If `sched.Go`'s API can't change, the closure is unavoidable. Profile first to confirm it matters.

**Benchmark** (1M iters):
- Closure per iter: ~50 ns/op, 32 B/op, 1 alloc/op
- Direct call: ~5 ns/op, 0 allocs

**Key insight**: Closures in hot loops escape and allocate. Restructure to pass state as args when possible.
</details>

---

## Exercise 3 🟢 — Non-Capturing Closure Hoisted

**Problem**:
```go
for _, x := range items {
    transform(x, func(v int) int { return v * 2 })
}
```

**Question**: Is hoisting needed?

<details>
<summary>Solution</summary>

**Discussion**: This literal captures NOTHING. Non-capturing literals are essentially free — the compiler emits a single funcval (often hoisted to a global). Each iteration just passes the same address.

**No optimization needed.** For clarity, you could hoist:
```go
double := func(v int) int { return v * 2 }
for _, x := range items {
    transform(x, double)
}
```

Both versions perform identically.

**Verify**:
```bash
go build -gcflags="-m=2" 2>&1 | grep "func literal"
# "func literal does not escape"  → free
```

**Key insight**: Non-capturing literals are free. Hoisting is a style choice, not a performance fix.
</details>

---

## Exercise 4 🟡 — Mutex Inside Closure

**Problem**:
```go
func newCounter() func() int {
    var mu sync.Mutex
    n := 0
    return func() int {
        mu.Lock()
        defer mu.Unlock()
        n++
        return n
    }
}
```

**Question**: This is correct. What's the performance characteristic? Is there a faster alternative?

<details>
<summary>Solution</summary>

**Discussion**: Mutex Lock/Unlock costs ~25 ns per call uncontended. For a simple integer counter, atomic is faster:

**Optimization** — use atomic:
```go
import "sync/atomic"

func newAtomicCounter() func() int64 {
    var n int64
    return func() int64 {
        return atomic.AddInt64(&n, 1)
    }
}
```

**Benchmark** (1M ops, uncontended):
- Mutex closure: ~30 ns/op
- Atomic closure: ~3 ns/op (~10×)

For high contention, atomic also wins because it's lock-free.

**When to use mutex anyway**: when the operation is more complex than a single int update (e.g., updating a slice + map + counter).

**Key insight**: For simple counters, atomic > mutex. For richer state, mutex is unavoidable.
</details>

---

## Exercise 5 🟡 — Memoization Cache Unbounded

**Problem**:
```go
func memoize(fn func(int) int) func(int) int {
    cache := map[int]int{}
    return func(x int) int {
        if v, ok := cache[x]; ok { return v }
        v := fn(x)
        cache[x] = v
        return v
    }
}
```

**Question**: What's the long-term concern?

<details>
<summary>Solution</summary>

**Issue**: The cache grows unbounded. For long-lived closures with diverse inputs, memory usage grows linearly.

**Optimization** — bound the cache (LRU):
```go
import "container/list"

type lruEntry struct {
    key, value int
}

func memoizeLRU(fn func(int) int, capacity int) func(int) int {
    cache := map[int]*list.Element{}
    order := list.New()
    
    return func(x int) int {
        if e, ok := cache[x]; ok {
            order.MoveToFront(e)
            return e.Value.(lruEntry).value
        }
        v := fn(x)
        if order.Len() >= capacity {
            oldest := order.Back()
            order.Remove(oldest)
            delete(cache, oldest.Value.(lruEntry).key)
        }
        e := order.PushFront(lruEntry{x, v})
        cache[x] = e
        return v
    }
}
```

**Benchmark** (1M ops, capacity 1000):
- Unbounded: grows to 1M entries (~16 MB)
- LRU: capped at 1000 entries (~16 KB)

**Key insight**: Caches inside closures need eviction. Use LRU, TTL, or size limits.
</details>

---

## Exercise 6 🟡 — Indirect Call Cost

**Problem**:
```go
func sumWith(xs []int, transform func(int) int) int {
    total := 0
    for _, x := range xs {
        total += transform(x)
    }
    return total
}

double := func(x int) int { return x * 2 }
result := sumWith(data, double)
```

**Question**: When does the indirect call cost matter? How do you remove it?

<details>
<summary>Solution</summary>

**Discussion**: Each `transform(x)` is an indirect call (3-5 cycles overhead, no inlining). For 1M ints, ~3-5 ms total overhead.

**Optimization** — specialize when the transform is fixed:
```go
func sumDoubled(xs []int) int {
    total := 0
    for _, x := range xs {
        total += x * 2 // inlined
    }
    return total
}
```

**Benchmark** (1M ints):
- `sumWith(data, double)`: ~1.5 ms
- `sumDoubled(data)`: ~0.4 ms (~3.5×)

**With PGO** (Go 1.21+): if `transform` is dominantly `double`, PGO can devirtualize and inline. Much smaller specialization needed.

**Key insight**: Indirect calls through closures prevent inlining. For hot inner loops, specialize or use PGO.
</details>

---

## Exercise 7 🟡 — Closure Pinning Per-Request Data

**Problem**:
```go
func handle(req *Request) {
    log.Push(func() {
        log.Write(req.ID, "processed")
    })
}
```

**Question**: What gets pinned, and how do you fix?

<details>
<summary>Solution</summary>

**Issue**: Each closure captures `req` (the entire Request, possibly with body buffer). Until the log queue drains, all `req` instances stay in memory.

For 10k req/sec with 1 MB body each, 10 GB pinned at any time.

**Optimization** — extract minimal data:
```go
func handle(req *Request) {
    id := req.ID // small string
    log.Push(func() {
        log.Write(id, "processed")
    })
}
```

After: each closure pins ~16 bytes (string header + small string data). The Request is freed when handle returns.

**Benchmark** (10k closures pending):
- Pin Request (1 KB each): ~10 MB
- Pin only ID (~30 B): ~300 KB

**Key insight**: When closures outlive their creating function, they should capture only the data they actually need.
</details>

---

## Exercise 8 🔴 — Stack Allocation via Inlining

**Problem**:
```go
func sumPos(xs []int) int {
    isPos := func(x int) bool { return x > 0 }
    total := 0
    for _, x := range xs {
        if isPos(x) {
            total += x
        }
    }
    return total
}
```

**Question**: Does `isPos` allocate? Can you verify and ensure it doesn't?

<details>
<summary>Solution</summary>

**Discussion**: `isPos` doesn't capture; it's a non-capturing literal. The funcval is essentially free (single global). The call is indirect but doesn't allocate.

**Verify**:
```bash
go build -gcflags="-m=2" 2>&1 | grep -E "isPos|func literal"
# "func literal does not escape"
```

**Optimization** — inline the predicate:
```go
func sumPos(xs []int) int {
    total := 0
    for _, x := range xs {
        if x > 0 {
            total += x
        }
    }
    return total
}
```

**Benchmark** (1M ints):
- Closure version: ~3 ms (indirect call)
- Inlined: ~0.5 ms (~6×)

**Key insight**: Even non-allocating closures pay the indirect-call tax in hot loops. Inline trivial predicates.
</details>

---

## Exercise 9 🔴 — Closure Capturing Loop Variable in Heavy State

**Problem**:
```go
fns := []func(){}
for i := 0; i < 1000; i++ {
    state := buildState(i) // 10 KB each
    fns = append(fns, func() {
        process(state)
    })
}
// Each closure pins ~10 KB; total 10 MB
```

**Question**: How do you reduce memory?

<details>
<summary>Solution</summary>

**Issue**: 1000 closures × 10 KB = 10 MB pinned. State persists as long as `fns` does.

**Optimization** — process eagerly if order doesn't matter:
```go
for i := 0; i < 1000; i++ {
    state := buildState(i)
    process(state) // no closure; state freed each iteration
}
// Total memory: ~10 KB at peak
```

If you NEED the closures (e.g., scheduled execution):
```go
type Job struct {
    State *State
    Run   func(*State)
}

jobs := []Job{}
for i := 0; i < 1000; i++ {
    state := buildState(i)
    jobs = append(jobs, Job{State: state, Run: process})
}
// Same memory, but explicit — easier to understand and clear
```

Or process in batches with a worker pool that consumes and discards state:
```go
work := make(chan *State, 100)
go func() {
    for s := range work { process(s) }
}()
for i := 0; i < 1000; i++ {
    work <- buildState(i)
}
close(work)
```

**Key insight**: Closures over heavy state in a slice pin the state. Process eagerly, use explicit jobs, or use a worker pool.
</details>

---

## Exercise 10 🔴 — Verify a Closure Doesn't Escape

**Problem**:
```go
func sumPos(xs []int) int {
    isPos := func(x int) bool { return x > 0 }
    total := 0
    for _, x := range xs {
        if isPos(x) {
            total += x
        }
    }
    return total
}
```

**Task**: Show how to verify the closure stays on the stack.

<details>
<summary>Solution</summary>

**Step 1 — escape analysis**:
```bash
go build -gcflags="-m=2" 2>&1 | grep -E "sumPos|func literal"
```

Expected:
```
./main.go:NN: can inline sumPos.func1
./main.go:NN: func literal does not escape
```

**Step 2 — benchmark with -benchmem**:
```go
func BenchmarkSumPos(b *testing.B) {
    data := make([]int, 1000)
    for i := range data { data[i] = i - 500 }
    b.ResetTimer()
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        _ = sumPos(data)
    }
}
```

```bash
go test -bench=. -benchmem
# BenchmarkSumPos-8    1000000   1500 ns/op   0 B/op   0 allocs/op
```

`0 allocs/op` confirms the closure doesn't allocate (it's stack-allocated and may be inlined).

**Step 3 — try `//go:noinline` to see overhead**:
```go
//go:noinline
func sumPosNoInline(xs []int) int { /* same body */ }
```

```
BenchmarkSumPosNoInline-8    300000000   3500 ns/op   0 B/op   0 allocs/op
```

The overhead from disabling inlining shows the cost of the indirect call.

**Key insight**: `-gcflags="-m"` and `-benchmem` together verify closure behavior. Stack-allocated closures + inlining = best performance.
</details>

---

## Bonus Exercise 🔴 — Migrate Loop-Capture Code to Go 1.22

**Problem**: A codebase has hundreds of patterns like:
```go
for _, item := range items {
    item := item // shadow
    go func() {
        process(item)
    }()
}
```

**Task**: Plan the migration to remove the now-unnecessary shadow lines.

<details>
<summary>Solution</summary>

**Discussion**: With `go 1.22` in `go.mod`, the shadow `item := item` is no longer needed. Each iteration's `item` is per-iteration automatically.

**Migration plan**:

1. **Update `go.mod`**: change `go 1.21` (or earlier) to `go 1.22`.

2. **Run all tests**: `go test ./...` and `go test -race ./...` to ensure no behavior change.

3. **Lint to find shadows**: `gocritic` or `staticcheck` can find redundant `i := i` patterns.

4. **Bulk-remove shadows**: a careful regex or `gopls` rename can strip them. Manual review for any non-trivial cases.

5. **Don't aggressively remove**: in some codebases, the shadow is a deliberate "I want a snapshot at this moment" — distinguishing intent from boilerplate matters.

**Verify** with race tests after each removal batch.

**Key insight**: Go 1.22 removes the need for the shadow workaround in most cases. Migrate gradually, test thoroughly, and leave shadows where they're semantic.
</details>
