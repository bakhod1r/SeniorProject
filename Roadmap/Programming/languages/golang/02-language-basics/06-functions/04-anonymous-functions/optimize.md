# Go Anonymous Functions — Optimize

## Instructions

Each exercise presents inefficient or wasteful use of anonymous functions/closures. Identify the issue, write an optimized version, and explain the improvement. Difficulty: 🟢 Easy, 🟡 Medium, 🔴 Hard.

---

## Exercise 1 🟢 — Closure Allocation in a Loop

**Problem**: A loop creates a new closure capturing different state each iteration.

```go
for i := 0; i < N; i++ {
    sched.Go(func() {
        process(i)
    })
}
```

**Question**: How many allocations? How do you fix?

<details>
<summary>Solution</summary>

**Issue**: Each iteration creates a closure capturing `i`. Because the closure is passed to `sched.Go` (escapes), each closure heap-allocates the funcval + capture struct (~32 B per iteration).

**Optimization** — pass `i` as an argument to a non-capturing function:
```go
for i := 0; i < N; i++ {
    sched.GoArg(processArg, i)
}

func processArg(arg int) { process(arg) }
```

Or use a method expression:
```go
for i := 0; i < N; i++ {
    sched.Go(func() { process(i) })
}
```

If you can't change `sched.Go`'s signature, the closure is unavoidable. Check whether the closure cost is actually significant in your profile before optimizing.

**Benchmark** (1M iterations, closure escapes):
- Per-iteration closure: ~50 ns/op, 32 B/op, 1 alloc/op
- No closure (pass as arg): ~10 ns/op, 0 B/op, 0 allocs/op

**Key insight**: Closures in hot loops escape and allocate. When the API allows, pass state as args instead.
</details>

---

## Exercise 2 🟢 — Non-Capturing Literal Hoisted

**Problem**: A non-capturing literal is created in a hot loop.

```go
for _, x := range items {
    transform(x, func(v int) int { return v * 2 })
}
```

**Question**: Is this actually wasteful?

<details>
<summary>Solution</summary>

**Discussion**: A NON-CAPTURING literal is essentially free. The compiler emits a single shared funcval for the literal (often hoisted to a global), so each iteration just passes the same address.

You can verify:
```bash
go build -gcflags="-m=2" 2>&1 | grep "func literal"
# Should NOT say "escapes" or "allocates"
```

**No real optimization needed** for non-capturing literals. But for clarity, you can hoist:

```go
double := func(v int) int { return v * 2 }
for _, x := range items {
    transform(x, double)
}
```

**Benchmark**: identical performance for both forms when the literal is non-capturing.

**Key insight**: Non-capturing literals don't allocate per iteration. Don't worry about hoisting them unless you measure a problem.
</details>

---

## Exercise 3 🟢 — Defer in Tight Loop

**Problem**: A defer + closure inside a per-iteration helper.

```go
func processBatch(items []Item) {
    for _, item := range items {
        mu.Lock()
        defer mu.Unlock() // BUG
        item.Process()
    }
}
```

**Question**: What goes wrong, and what's the optimal fix?

<details>
<summary>Solution</summary>

**Issue**: `defer mu.Unlock()` runs at function exit, not iteration exit. The mutex stays locked across iterations — deadlock on the second iteration.

**Optimization** — explicit unlock OR per-iteration helper:
```go
// Option 1: explicit unlock
func processBatch(items []Item) {
    for _, item := range items {
        mu.Lock()
        item.Process()
        mu.Unlock()
    }
}

// Option 2: helper function
func processBatch(items []Item) {
    for _, item := range items {
        processOne(item)
    }
}

func processOne(item Item) {
    mu.Lock()
    defer mu.Unlock() // open-coded defer; near-zero cost
    item.Process()
}
```

**Benchmark** (1M iterations):
- Explicit unlock: ~22 ns/iter
- Helper with defer: ~24 ns/iter (open-coded)
- Buggy version (deadlocks): N/A

**Key insight**: defer in a loop accumulates across iterations. For per-iteration cleanup, extract a helper or unlock explicitly.
</details>

---

## Exercise 4 🟡 — Heavy Capture Pinning Memory

**Problem**: A closure captures a large struct pointer.

```go
type BigData struct { buf [1<<20]byte }

func makeReader(b *BigData) func() byte {
    return func() byte {
        return b.buf[0]
    }
}
```

**Question**: What's the lifetime impact, and how do you fix?

<details>
<summary>Solution</summary>

**Issue**: The returned closure captures `b`. As long as the closure exists, `b` (1 MB) is pinned and unreclaimable.

**Optimization** — capture only what you need:
```go
func makeReader(b *BigData) func() byte {
    first := b.buf[0] // capture the byte, not the pointer
    return func() byte {
        return first
    }
}
```

After this, `b` becomes unreachable as soon as `makeReader` returns. The 1 MB is freed.

**Benchmark** (100 instances kept alive):
- Capture pointer: ~100 MB total RSS
- Capture byte: ~100 bytes total RSS

**Key insight**: Closures pin captured pointers. Always extract the minimum data needed.
</details>

---

## Exercise 5 🟡 — Method Value Boxing

**Problem**: A loop binds a method value per iteration.

```go
for _, item := range items {
    handler := item.Process
    register(handler)
}
```

**Question**: What's the allocation pattern?

<details>
<summary>Solution</summary>

**Issue**: Each `item.Process` creates a method value — a funcval with the receiver bound. If the value receiver is large, this may allocate.

**Optimization** — use a method expression:
```go
register := func(p Processor, h func(Processor)) {
    // ... register ...
}

processFn := (*Item).Process // method expression
for _, item := range items {
    register(item, processFn)
}
```

Or, if you control `register`, change its signature to accept the method expression form once:
```go
type Handler interface { Process() }
for _, item := range items {
    register(item) // pass the item; register calls item.Process()
}
```

**Benchmark** (1M iterations):
- Method value per iteration: ~30 ns/iter, 16 B/iter, 1 alloc/iter (depending on receiver size)
- Method expression: ~10 ns/iter, 0 allocs

**Key insight**: Method values box the receiver. Method expressions don't. Use the latter for hot loops.
</details>

---

## Exercise 6 🟡 — IIFE for Conditional Default

**Problem**:

```go
config := func() *Config {
    if userConfig != nil {
        return userConfig
    }
    return defaultConfig()
}()
```

**Question**: Is the IIFE actually helpful here?

<details>
<summary>Solution</summary>

**Discussion**: The IIFE replaces what would be:
```go
var config *Config
if userConfig != nil {
    config = userConfig
} else {
    config = defaultConfig()
}
```

Both compile to similar code. The IIFE is a single expression (assignable in one line); the if/else is more familiar to most readers.

**For Go**: prefer if/else for clarity. IIFE is a JavaScript idiom that doesn't carry the same weight in Go.

**No performance difference**. The compiler inlines the IIFE in most cases (if non-capturing).

**Optimization**: when you have a TRUE need for one-expression scoping (e.g., complex switch returning a value):
```go
priority := func() int {
    switch req.Type {
    case "urgent": return 100
    case "high": return 50
    default: return 0
    }
}()
```

**Key insight**: IIFE for one-expression value computation can be cleaner than declaring + assigning. Use sparingly; prefer plain if/switch in most cases.
</details>

---

## Exercise 7 🟡 — Closure in Goroutine With Synchronization

**Problem**: A worker goroutine captures a result variable that the parent reads.

```go
var result int
go func() {
    result = compute()
}()
// ... parent reads result ...
fmt.Println(result)
```

**Question**: What's wrong and how do you fix?

<details>
<summary>Solution</summary>

**Issue**: Race condition. The parent reads `result` without synchronization. `go test -race` flags this.

**Fix** (option A — channel):
```go
ch := make(chan int)
go func() {
    ch <- compute()
}()
result := <-ch
fmt.Println(result)
```

**Fix** (option B — WaitGroup):
```go
var result int
var wg sync.WaitGroup
wg.Add(1)
go func() {
    defer wg.Done()
    result = compute()
}()
wg.Wait()
fmt.Println(result)
```

**Fix** (option C — errgroup for multiple goroutines):
```go
import "golang.org/x/sync/errgroup"

var result int
g := new(errgroup.Group)
g.Go(func() error {
    result = compute()
    return nil
})
g.Wait()
fmt.Println(result)
```

**Key insight**: Closures capture by reference. Sharing captured mutable state across goroutines requires synchronization (channel, mutex, atomic, WaitGroup).
</details>

---

## Exercise 8 🔴 — Map of Closures Pinning Memory

**Problem**: A handler map stores closures that each capture large state.

```go
handlers := map[string]func(){}
for _, conn := range openConnections {
    handlers[conn.ID] = func() {
        process(conn)
    }
}
```

**Question**: What's the memory impact, and how do you fix?

<details>
<summary>Solution</summary>

**Issue**: Each handler captures the entire `Conn` (large object with buffers, file handles). The handlers map pins ALL connections forever, even after they're "closed".

**Fix** — pass state explicitly:
```go
handlers := map[string]func(*Conn){}
handlers["default"] = func(c *Conn) { process(c) }

// At dispatch time:
handler := handlers["default"]
handler(conn)
```

The map now holds non-capturing closures (or named functions). Connections are freed when their references elsewhere are dropped.

If you must associate handlers with specific connections, store the connection separately:
```go
type Entry struct {
    Conn    *Conn
    Handler func(*Conn)
}
entries := map[string]Entry{}
```

When done with a connection, delete from the map and the conn becomes collectable.

**Benchmark** (1000 connections, 1 KB each):
- Closure-per-connection: ~1 MB pinned
- Shared handler: ~1 KB pinned (handlers map)

**Key insight**: Maps of closures pin captured state for the map's lifetime. Separate the data from the function, or evict explicitly.
</details>

---

## Exercise 9 🔴 — sync.Pool of Closures (Bad Idea)

**Problem**: A team tries to pool closures to avoid allocation.

```go
var pool = sync.Pool{
    New: func() any {
        return func() {
            // some work
        }
    },
}
```

**Question**: Why doesn't this work as expected?

<details>
<summary>Solution</summary>

**Issue**: A closure value (especially capturing) is heap-allocated each time it's created. Pool can store and retrieve the value, but you cannot "reset" its captured state — captures are bound at creation.

If the closure is non-capturing, there's no allocation to pool — the literal is essentially free.

If the closure captures different state per use, you can't pool effectively because each use needs different captures.

**Better approach** — pool the underlying state, not the closure:
```go
type Worker struct {
    buf []byte // mutable state
}

func (w *Worker) Process() { /* uses w.buf */ }

var pool = sync.Pool{
    New: func() any { return &Worker{buf: make([]byte, 1024)} },
}

w := pool.Get().(*Worker)
defer func() {
    w.buf = w.buf[:0]
    pool.Put(w)
}()
w.Process()
```

The method `(*Worker).Process` is bound to a fresh receiver each time you `Get` from the pool — but the underlying buffer is reused.

**Key insight**: Pool the data; methods on the data type are free. Don't try to pool closures themselves.
</details>

---

## Exercise 10 🔴 — Verify a Hot Closure Doesn't Allocate

**Problem**: You wrote a hot path with a closure and want to verify zero allocations.

```go
func sum(items []int, predicate func(int) bool) int {
    total := 0
    for _, x := range items {
        if predicate(x) {
            total += x
        }
    }
    return total
}

// Hot:
// _ = sum(data, func(n int) bool { return n > 0 })
```

**Task**: Show how to verify the predicate isn't causing allocations.

<details>
<summary>Solution</summary>

**Step 1 — escape analysis**:
```bash
go build -gcflags="-m=2" 2>&1 | grep "func literal"
```

Expected: `func literal does not escape` for the predicate.

**Step 2 — benchmark**:
```go
func BenchmarkSum(b *testing.B) {
    data := make([]int, 1000)
    for i := range data { data[i] = i - 500 }
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        _ = sum(data, func(n int) bool { return n > 0 })
    }
}
```

```bash
go test -bench=Sum -benchmem
# BenchmarkSum-8    1000000    1200 ns/op    0 B/op    0 allocs/op
```

If `0 allocs/op`, the closure is non-escaping (or non-capturing). If you see allocations:
- Check if the predicate captures something (it shouldn't here).
- Check `-gcflags="-m=2"` output for "escapes to heap".

**Step 3 — try inlining `sum`**:
For very hot paths, manually inline:
```go
func sumPos(items []int) int {
    total := 0
    for _, x := range items {
        if x > 0 { total += x }
    }
    return total
}
```

This eliminates the indirect call entirely.

**Benchmark** (1M ints, 50% positive):
- `sum(data, predicate)` (indirect call): ~1200 ns/op
- `sumPos(data)` (inlined): ~400 ns/op (~3× faster)

**Key insight**: Use `-gcflags="-m=2"` and `-benchmem` together to verify closure behavior. For tight inner loops, specialize away the indirection.
</details>

---

## Bonus Exercise 🔴 — Migrate to Go 1.22 Loop Variable Semantics

**Problem**: An existing codebase relies on the pre-1.22 shared-variable behavior:

```go
go.mod: go 1.21

results := []int{}
for i := 0; i < 5; i++ {
    go func() {
        results = append(results, i) // pre-1.22: races on shared i
    }()
}
```

**Task**: Plan the migration to Go 1.22 and identify what could break.

<details>
<summary>Solution</summary>

**Migration plan**:

1. **Update go.mod**: change `go 1.21` to `go 1.22`.

2. **Run the loopclosure analyzer**:
   ```bash
   go vet -loopclosure ./...
   ```
   Identifies code that captures loop variables in closures or goroutines.

3. **Run all tests**:
   ```bash
   go test ./...
   go test -race ./...
   ```

4. **Use the bisect tool** if tests fail:
   ```bash
   go install golang.org/x/tools/cmd/bisect@latest
   bisect -compile=loopvar go test ./mypackage
   ```
   Identifies which exact loop transitions changed behavior.

5. **Inspect each flagged site**: most will work BETTER under 1.22 (the old code was buggy). A few may rely on shared-variable behavior intentionally.

**Code that might intentionally rely on shared loop var (rare)**:
- Reduction patterns: `for i := range items { go func() { sum += someComputation(i) } ... }`. These were already broken under 1.21 (races); 1.22 makes them per-iteration but still racy.

**Most likely outcome**: tests that were flaky under 1.21 become deterministic under 1.22. Few real regressions.

**Key insight**: The 1.22 loop-variable change usually fixes more bugs than it introduces. Use `go vet -loopclosure` and `bisect` to identify hot spots, then verify with race detector.
</details>
