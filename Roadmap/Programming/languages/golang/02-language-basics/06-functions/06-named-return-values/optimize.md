# Go Named Return Values — Optimize

## Instructions

Each exercise presents inefficient or wasteful patterns around named return values. Identify the issue, write an optimized version, and explain. Difficulty: 🟢 Easy, 🟡 Medium, 🔴 Hard.

---

## Exercise 1 🟢 — Defer Eager Argument Evaluation

**Problem**:
```go
func op() (n int, err error) {
    defer fmt.Printf("op: n=%d err=%v\n", n, err) // BUG?
    n = 42
    err = errors.New("nope")
    return
}
```

**Question**: Does this print the final values? How do you fix?

<details>
<summary>Solution</summary>

**Issue**: `defer fmt.Printf(...)` evaluates `n` and `err` EAGERLY. They're captured at defer time (n=0, err=nil). The actual print at function exit shows the captured values, not the final.

Output:
```
op: n=0 err=<nil>
```

**Fix** — wrap in closure for late evaluation:
```go
defer func() {
    fmt.Printf("op: n=%d err=%v\n", n, err)
}()
```

Output now:
```
op: n=42 err=nope
```

**Performance**: closure form is slightly slower (~1 ns) but correctness matters more.

**Key insight**: `defer call(args)` is eager-args. Use `defer func(){...}()` for late evaluation.
</details>

---

## Exercise 2 🟢 — Naked Return in Long Function

**Problem**:
```go
func process(data []byte) (count int, total int, err error) {
    // ... 50 lines of complex logic ...
    if condition1 {
        // ...
        return
    }
    if condition2 {
        // ...
        return
    }
    // ...
    return
}
```

**Question**: Why is this hard to maintain?

<details>
<summary>Solution</summary>

**Issue**: Naked returns 50 lines down from the result names obscure what's being returned. Multiple naked returns on different paths require the reader to trace state through the entire function to understand what each return produces.

**Optimization** — explicit returns or split into helpers:

```go
func process(data []byte) (int, int, error) {
    // ... 50 lines ...
    if condition1 {
        return c1, t1, nil
    }
    if condition2 {
        return c2, t2, nil
    }
    return cFinal, tFinal, nil
}
```

Or split:
```go
func process(data []byte) (int, int, error) {
    if condition1(data) {
        return processCase1(data)
    }
    if condition2(data) {
        return processCase2(data)
    }
    return processDefault(data)
}
```

**Key insight**: Naked return is a tool for SHORT functions. For long ones, explicit returns or function decomposition wins.
</details>

---

## Exercise 3 🟡 — Cleanup Error Capture Without Named Return

**Problem**:
```go
func op() error {
    f, err := os.Open(path)
    if err != nil { return err }
    var workErr error
    // ... do work, set workErr ...
    cerr := f.Close()
    if workErr != nil { return workErr }
    if cerr != nil { return cerr }
    return nil
}
```

**Question**: How do you simplify with named return?

<details>
<summary>Solution</summary>

**Optimization** — named return + defer:
```go
func op() (err error) {
    f, err := os.Open(path)
    if err != nil { return err }
    defer func() {
        if cerr := f.Close(); cerr != nil && err == nil {
            err = cerr
        }
    }()
    // ... do work, set err ...
    return
}
```

Benefits:
- Cleanup happens even on early-error paths (defer always runs).
- Single source of truth: `err`.
- Shorter code.
- Correct even if `Close()` is called from multiple paths.

**Performance**: identical to manual version (open-coded defer makes it free).

**Key insight**: Named return + defer simplifies cleanup-error propagation. Use it for any function that acquires a resource.
</details>

---

## Exercise 4 🟡 — Defer Allocation in Hot Loop

**Problem**:
```go
func processBatch(items []Item) (count int, err error) {
    for _, item := range items {
        defer func() {
            count++
        }() // BUG: defer in loop!
        item.Process()
    }
    return
}
```

**Question**: What's wrong, and how do you fix?

<details>
<summary>Solution</summary>

**Issue**: Defer in a loop accumulates 1 defer per iteration. For 10k items, 10k defer records. Plus, defers all run at function exit, not iteration exit — `count` is incremented N times at the end, not during processing.

Open-coded defer is disabled inside loops; falls back to stack/heap defer (~30-50 ns per defer).

**Fix** — increment directly, not via defer:
```go
func processBatch(items []Item) (count int, err error) {
    for _, item := range items {
        item.Process()
        count++
    }
    return
}
```

Or extract per-iteration helper if cleanup IS needed:
```go
func processBatch(items []Item) (count int, err error) {
    for _, item := range items {
        if err = processOne(item); err != nil { return }
        count++
    }
    return
}
```

**Benchmark** (1M items):
- Defer in loop: ~80 ms, 10M defer records
- Direct increment: ~20 ms, 0 defers

**Key insight**: Defer doesn't run per iteration — it runs at function exit. Don't use defer for per-iteration logic.
</details>

---

## Exercise 5 🟡 — Named Return Escapes to Heap

**Problem**:
```go
var sink *int

func makeAndSink() (n int) {
    sink = &n // BUG?
    n = 42
    return
}
```

**Question**: What's the cost?

<details>
<summary>Solution</summary>

**Issue**: Taking the address of `n` and storing it in a global causes `n` to escape to the heap. Each call allocates a new int on the heap.

Verify:
```bash
go build -gcflags="-m" .
# moved to heap: n
```

**Optimization** — if you don't need persistent storage, return the value:
```go
func makeAndSink() int {
    return 42
}

n := makeAndSink()
sink = &n // address of caller's local; still escapes if sink outlives caller
```

Same escape issue at the caller, but at least it's explicit.

**If you genuinely need a heap-allocated int**:
```go
func newInt(v int) *int {
    p := new(int)
    *p = v
    return p
}
```

The escape is now intentional.

**Benchmark** (1M calls):
- Heap escape via named return: ~20 ns/op, 8 B/op, 1 alloc/op
- Value return: ~0.5 ns/op, 0 allocs/op (inlined)

**Key insight**: Named results behave like locals. If their address escapes, they go to the heap. Avoid taking addresses unless necessary.
</details>

---

## Exercise 6 🟡 — Recover Per Iteration

**Problem**:
```go
func processAll(items []Item) (failed int) {
    for _, item := range items {
        defer func() {
            if r := recover(); r != nil {
                failed++
            }
        }() // BUG: defer in loop AND eager recover semantics
        item.Process()
    }
    return
}
```

**Question**: Two bugs. Identify and fix.

<details>
<summary>Solution</summary>

**Bugs**:
1. defer in loop accumulates; runs at function exit, not per iteration.
2. recover only works inside a deferred function — and only if a panic IS in progress at the time the defer runs. Defers all run at exit; if any item panicked, the panic propagated up immediately and didn't wait for the loop to finish.

So this code DOESN'T work as a per-iteration safety net.

**Fix** — extract per-iteration helper:
```go
func processAll(items []Item) (failed int) {
    for _, item := range items {
        if !safeProcess(item) {
            failed++
        }
    }
    return
}

func safeProcess(item Item) (ok bool) {
    defer func() {
        if r := recover(); r != nil {
            ok = false
        }
    }()
    item.Process()
    return true
}
```

Now each iteration has its own defer scope. A panic in `safeProcess` is recovered locally; the loop continues.

**Benchmark** (1k items, 10% panic):
- Buggy: panics on first failure; loop ends.
- Fixed: completes all 1000, reports 100 failures.

**Key insight**: Recover only catches panics in the SAME function's deferred chain. For per-iteration recovery, extract a helper.
</details>

---

## Exercise 7 🔴 — Open-Coded Defer Disabled

**Problem**:
```go
func op() (err error) {
    defer logCleanup()
    defer cleanup1()
    defer cleanup2()
    defer cleanup3()
    defer cleanup4()
    defer cleanup5()
    defer cleanup6()
    defer cleanup7()
    defer cleanup8()
    defer cleanup9() // BUG: 9 defers, exceeds open-coded limit
    // ...
    return nil
}
```

**Question**: What's the cost difference?

<details>
<summary>Solution</summary>

**Issue**: Open-coded defer is limited to 8 defers per function. With 9, the compiler falls back to stack-allocated defers (~30 ns each).

For each call:
- Open-coded (≤ 8 defers): ~1 ns total overhead.
- Stack defer (9+ defers): ~270 ns total.

**Fix** (option A — combine cleanups):
```go
defer func() {
    cleanup1(); cleanup2(); ... ; cleanup9()
    logCleanup()
}()
```

Now 1 defer; open-coded.

**Fix** (option B — use a cleanup struct):
```go
type Cleanups []func()
func (c Cleanups) Run() {
    for i := len(c) - 1; i >= 0; i-- { c[i]() }
}

cleanups := Cleanups{
    cleanup1, cleanup2, ..., cleanup9, logCleanup,
}
defer cleanups.Run()
```

Single defer, manages many cleanups manually.

**Benchmark** (1M calls):
- 9 defers (stack-allocated): ~270 ns/op
- 1 combined defer (open-coded): ~5 ns/op

**Key insight**: Open-coded defer has an 8-defer limit. Beyond that, performance drops. Combine into a single defer for hot functions.
</details>

---

## Exercise 8 🔴 — Naming Adds Noise Without Value

**Problem**:
```go
func add(a, b int) (sum int) {
    sum = a + b
    return
}
```

**Question**: Is the named return helping?

<details>
<summary>Solution</summary>

**Discussion**: For a one-line function returning a single value, named return adds noise:
- The signature is more complex.
- The body has an unnecessary intermediate assignment.

**Optimization** — drop the name:
```go
func add(a, b int) int {
    return a + b
}
```

Same compiled code (after inlining); cleaner source.

**When to keep the name**:
- Defer modifies it.
- The name documents non-obvious meaning (e.g., `(stddev float64)` rather than `float64`).

**Key insight**: Named returns aren't free in cognitive load. Skip them when they add no value.
</details>

---

## Exercise 9 🔴 — Wrap Errors at Boundary, Not Per Step

**Problem**:
```go
func multiStep() (err error) {
    if err = step1(); err != nil {
        return fmt.Errorf("step1: %w", err)
    }
    if err = step2(); err != nil {
        return fmt.Errorf("step2: %w", err)
    }
    if err = step3(); err != nil {
        return fmt.Errorf("step3: %w", err)
    }
    return
}
```

**Question**: Is wrapping at every step necessary?

<details>
<summary>Solution</summary>

**Discussion**: If callers will use `errors.Is`/`errors.As`, the wrapping helps trace where errors originated. If callers only log, the wrapping adds context but allocates ~1 wrap per error.

**Optimization** (when wrapping is critical) — keep as is.

**Optimization** (when wrapping is overhead) — single wrap at the boundary:
```go
func multiStep() (err error) {
    defer func() {
        if err != nil {
            err = fmt.Errorf("multiStep: %w", err)
        }
    }()
    if err = step1(); err != nil { return }
    if err = step2(); err != nil { return }
    if err = step3(); err != nil { return }
    return
}
```

The defer wraps any non-nil err with the function name. Callers see "multiStep: <inner>" but lose the per-step context.

**Hybrid** — wrap only on user-visible errors:
```go
if err = step1(); err != nil {
    if isUserFacing(err) {
        return fmt.Errorf("step1: %w", err)
    }
    return err
}
```

**Benchmark** (1M errors):
- Wrap each step: ~120 ns/op (1 alloc per wrap × 3)
- Wrap at boundary: ~40 ns/op (1 alloc per error)

**Key insight**: Each wrap costs an allocation. Wrap with intention; the named-return-defer pattern lets you wrap once at the boundary.
</details>

---

## Exercise 10 🔴 — Verify Named Return Doesn't Allocate

**Problem**: You wrote a hot path with named returns and want to verify zero allocations.

```go
var ErrEmpty = errors.New("empty")

func parse(s string) (n int, err error) {
    if s == "" {
        err = ErrEmpty
        return
    }
    n = len(s)
    return
}
```

**Task**: Show how to verify zero allocations on both success and failure paths.

<details>
<summary>Solution</summary>

**Step 1 — escape analysis**:
```bash
go build -gcflags="-m=2" 2>&1 | grep -E "parse|escape"
```

Look for the absence of "moved to heap" for `n` or `err`.

**Step 2 — benchmark with `-benchmem`**:
```go
func BenchmarkParseSuccess(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        _, _ = parse("hello")
    }
}

func BenchmarkParseError(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        _, _ = parse("")
    }
}
```

```bash
go test -bench=. -benchmem
```

Expected:
```
BenchmarkParseSuccess-8    1000000000   0.5 ns/op   0 B/op   0 allocs/op
BenchmarkParseError-8      1000000000   0.6 ns/op   0 B/op   0 allocs/op
```

Both paths are 0-alloc:
- Success: int + nil interface — register-passed, no alloc.
- Error: int (zero) + sentinel pointer — no alloc.

**Step 3 — verify open-coded defer if used**:
If you have defers, check:
```bash
go build -gcflags="-d=defer=2" 2>&1 | grep "open-coded"
```

**Key insight**: Use `-gcflags="-m"` and `-benchmem` together. Named returns + sentinel errors + open-coded defer = zero-allocation hot paths.
</details>
