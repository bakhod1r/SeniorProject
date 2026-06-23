# Go Defer — Interview Questions

## Table of Contents
1. [Junior Level Questions](#junior-level-questions)
2. [Middle Level Questions](#middle-level-questions)
3. [Senior Level Questions](#senior-level-questions)
4. [Trap Questions](#trap-questions)

---

## Junior Level Questions

**Q1: What does `defer` do in Go?**

**Answer**: `defer` schedules a function call to run when the surrounding function returns. The deferred call runs whether the function returns normally, hits a `return` statement, or panics. It is Go's primary mechanism for guaranteed cleanup of resources like files, locks, and database connections.

```go
func main() {
    f, _ := os.Open("data.txt")
    defer f.Close() // runs when main returns
    // ...
}
```

---

**Q2: What's the order of execution if you have 3 `defer`s?**

**Answer**: **LIFO** — last in, first out. The most recently registered defer runs first.

```go
func main() {
    defer fmt.Println("A") // runs third
    defer fmt.Println("B") // runs second
    defer fmt.Println("C") // runs first
}
// Output:
// C
// B
// A
```

You can think of deferred calls as a stack. Each `defer` pushes; function exit pops and executes.

---

**Q3: Does `defer` see updated variables or values at defer-time?**

**Answer**: It depends on how you write it.

- `defer fmt.Println(x)` evaluates `x` at the **defer statement** (defer-time). The value is captured.
- `defer func() { fmt.Println(x) }()` defers a closure that reads `x` at **call-time** (function exit).

```go
x := 1
defer fmt.Println("arg:", x)            // captures 1
defer func() { fmt.Println("closure:", x) }() // reads at exit
x = 99
```

LIFO order means the closure runs first. Output:
```
closure: 99
arg: 1
```

---

**Q4: Where would you use `defer` in everyday code?**

**Answer**: Whenever a resource needs guaranteed cleanup:

- `defer f.Close()` after `os.Open`
- `defer mu.Unlock()` after `mu.Lock()`
- `defer resp.Body.Close()` after `http.Get`
- `defer rows.Close()` after `db.Query`
- `defer cancel()` after `context.WithTimeout`
- `defer wg.Done()` inside a goroutine
- `defer recover()` in a panic-handler closure

---

**Q5: What happens to deferred calls if a panic occurs?**

**Answer**: They still run. The runtime walks up the stack on panic, executing every deferred call along the way (in LIFO order per function). This is what makes defer suitable for cleanup — even on panic, your file closes and your mutex unlocks.

```go
func main() {
    defer fmt.Println("cleanup")
    panic("boom")
}
// Output:
// cleanup
// (then the panic message and stack trace)
```

---

**Q6: Why must `defer` come after the error check, not before?**

**Answer**: Because if the open fails, you'd be deferring a `Close()` on a nil resource — which usually panics or produces a misleading error.

```go
// WRONG
f, err := os.Open(path)
defer f.Close() // f is nil if Open failed
if err != nil { return err }

// RIGHT
f, err := os.Open(path)
if err != nil { return err }
defer f.Close()
```

---

**Q7: What is the "resource cleanup pattern"?**

**Answer**: Acquire a resource, then immediately defer its release on the next line. This makes cleanup local and ensures it happens on every exit path.

```go
f, err := os.Open(p)
if err != nil { return err }
defer f.Close()
// f is now safe; will close on any return or panic
```

---

## Middle Level Questions

**Q8: Can `defer` change the return value?**

**Answer**: Yes — but only if the return value is **named**. The sequence is:

1. The `return EXPR` statement evaluates `EXPR`.
2. The result is assigned to the named return variable.
3. Deferred calls run in LIFO order. They can read and modify the named return.
4. The function returns the (possibly modified) value to the caller.

```go
func f() (n int) {
    defer func() { n *= 2 }()
    return 10
}
// returns 20
```

For unnamed returns, defer can't reach them — they've already been copied to a hidden slot the caller will read.

---

**Q9: How do you wrap errors uniformly using defer?**

**Answer**: Use a named `err` return + a deferred closure:

```go
func loadConfig(path string) (cfg *Config, err error) {
    defer func() {
        if err != nil {
            err = fmt.Errorf("loadConfig %q: %w", path, err)
        }
    }()
    // ... multiple paths, each setting err ...
    return parse(path)
}
```

Every error path through the function gets wrapped, with no risk of forgetting.

---

**Q10: Why is `defer` slower than direct call in a tight loop?**

**Answer**: A defer inside a loop disqualifies the function from open-coded defer. Each iteration's defer goes to the heap-allocated slow path:
- Allocate a `_defer` record (~48 bytes).
- Push onto the goroutine's defer list.
- At function exit, walk the list and invoke each one.

Total cost: ~30-50 ns per defer plus 1 heap allocation. Direct calls cost ~1-3 ns and zero allocations.

For a 1M-iteration loop, that's 30-50 ms of overhead and 48 MB of allocation, all retained until the function returns.

**Fix**: extract a helper:
```go
for _, x := range xs {
    handleOne(x)
}

func handleOne(x X) {
    defer x.Close()
    // ...
}
```

`handleOne` qualifies for open-coded defer. Cost drops to ~3-7 ns and zero allocations.

---

**Q11: What's the cost of `defer` and when does Go optimize it away?**

**Answer**: Go 1.14+ introduced **open-coded defer**. The compiler emits the deferred call's machine code directly into the function's exit paths, avoiding both allocation and indirect call.

Eligibility:
- ≤ 8 `defer` statements in the function.
- No `defer` is inside a loop.
- No call to `recover` from a non-deferred function.
- Optimizations are not disabled (`-N` disables it).

When all conditions hold, defer is ~3-7 ns/call. When any fails, the function falls back to stack-allocated (~12-15 ns) or heap-allocated (~30-50 ns) defers.

---

**Q12: What happens when you use `defer` in a function that calls `os.Exit`?**

**Answer**: The deferred calls **do not run**. `os.Exit` terminates the process immediately, bypassing Go's normal unwind.

```go
func main() {
    defer fmt.Println("cleanup")
    os.Exit(1)
}
// Output: nothing. "cleanup" is skipped.
```

Best practice: don't use `os.Exit` in functions with deferred cleanup. Return errors and let the program unwind through `main` normally.

`runtime.Goexit` is different — it runs deferred calls before terminating the goroutine.

---

**Q13: When would you NOT use `defer`?**

**Answer**:
- **Tight inner loops** where the per-iter cost (~50 ns when defer is in a loop) is significant relative to the work being done.
- **Long-running loops over external resources** (like 10,000 files) where defers accumulate and exhaust handles.
- **Hot mutex-protected paths** where ~4 ns of open-coded defer cost is measurable. Profile first.
- **One-exit functions** where defer adds noise without adding safety (rare; defer is almost always worth the small cost).

---

**Q14: How does `defer` interact with `recover`?**

**Answer**: `recover()` only works when called **directly inside a function invoked by `defer`**. Outside that context, it returns `nil` and does nothing.

```go
defer func() {
    if r := recover(); r != nil { /* handles panic */ }
}()
// ...
panic("x") // recovered
```

If you call `recover()` from a function called by the deferred function (one frame deeper), it doesn't work:

```go
defer cleanup()
// ...
func cleanup() {
    helper() // helper calls recover — TOO DEEP
}
```

To make `cleanup` work, `recover` must be inside `cleanup` directly, not in `helper`.

---

**Q15: How does `defer` interact with named return values to enable error wrapping?**

**Answer**: With named returns, a deferred closure can read and modify the return value(s) after `return EXPR` has evaluated and assigned them. This is the foundation of the idiomatic error-wrapping pattern:

```go
func foo() (err error) {
    defer func() {
        if err != nil {
            err = fmt.Errorf("foo: %w", err)
        }
    }()
    // ... err set by various code paths ...
    return err
}
```

The wrap is centralized; no individual return needs to remember to wrap.

---

## Senior Level Questions

**Q16: Explain the three implementations of `defer` in modern Go.**

**Answer**:

1. **Open-coded defer** (Go 1.14+): the compiler emits the deferred call's instructions directly into the function epilogue. No allocation, no indirect call. Used when defer count ≤ 8 and no defer is inside a loop. Cost: ~3-7 ns per defer.

2. **Stack-allocated defer** (Go 1.13+): the `_defer` record is allocated on the function's stack frame. Threaded onto the goroutine's defer list with a single store. Cost: ~12-15 ns per defer.

3. **Heap-allocated defer** (the original Go ≤ 1.12 path): the `_defer` record is allocated on the heap. Used when the function isn't eligible for the faster paths (e.g., defers in loops). Cost: ~30-50 ns per defer plus 1 heap allocation each.

The compiler picks per-function. You can verify with `go build -gcflags="-m"` or by disassembling and looking for `runtime.deferproc`.

---

**Q17: Why does a single defer inside a loop disqualify the entire function from open-coded defer?**

**Answer**: Open-coded defer relies on a small, statically-known bitmask (`deferBits`, 8 bits) to track which defers have been registered. The compiler emits inline code at each defer site to set the corresponding bit. At function exit, it consults the bitmask to know which defers to run.

If a defer is inside a loop, the same bit gets set on every iteration — you can't tell from the bitmask how many times the body executed. The compiler needs to know exactly which deferred-call invocations to make. With unbounded counts, the bitmask scheme fails.

The compiler conservatively falls back to the linked-list scheme for the entire function once any defer is in a loop. Even non-loop defers in the same function then go through the slow path.

The fix is simple: extract the loop body into a helper function. The helper's defer is bounded; the helper qualifies for open-coded.

---

**Q18: How does the runtime handle panic propagation through deferred calls?**

**Answer**: The runtime keeps a per-goroutine `_panic` linked list (most recent first). When `panic(v)` is called:

1. A new `_panic` record is created and pushed onto the goroutine's panic list.
2. `runtime.gopanic` walks the goroutine's `_defer` list from head (most recent).
3. For each `_defer`, it invokes the deferred function.
4. If the deferred function calls `recover()`, `gorecover` checks: is this the most recent panic and is the calling function the immediate target of a defer? If yes, mark the panic as recovered.
5. After the deferred function returns, if the panic was recovered, `gopanic` jumps back to the function whose deferred call recovered, simulating a normal return.
6. If not recovered, `gopanic` continues to the next defer.
7. If all defers are exhausted without recovery, `gopanic` calls `runtime.fatalpanic`, which prints the trace and aborts the goroutine.

For open-coded defers, the runtime synthesizes the necessary frame metadata from `funcdata` (compiler-generated tables associated with each function).

References: `runtime/panic.go`, especially `gopanic`, `gorecover`, `runOpenDeferFrame`.

---

**Q19: What does the compiler emit for a function with an open-coded defer?**

**Answer**: For:
```go
func F() {
    mu.Lock()
    defer mu.Unlock()
    work()
}
```

The compiler emits (paraphrased amd64):

```
TEXT main.F(SB)
    // function prologue
    // reserve a stack slot for deferBits (8-bit field)
    MOVB $0, deferBits(SP)

    // mu.Lock()
    LEAQ mu(SB), AX
    CALL sync.(*Mutex).Lock(SB)

    // register defer: set bit 0
    MOVB $1, deferBits(SP)
    // (no allocation, no list push)

    // work()
    CALL main.work(SB)

    // function epilogue: check deferBits, run set defers in LIFO
    MOVBQZX deferBits(SP), AX
    TESTB $1, AL
    JZ skip0
    LEAQ mu(SB), AX
    CALL sync.(*Mutex).Unlock(SB)
skip0:
    RET
```

No `runtime.deferproc`, no `runtime.deferreturn`. Just inline code with a bitmask check.

In the panic case, the runtime locates this stack frame, reads `deferBits`, and walks `funcdata` to find which calls to make.

---

**Q20: Compare `defer mu.Unlock()` vs explicit unlock in a hot path.**

**Answer**:

```go
// Option A
func get(k string) string {
    mu.RLock()
    defer mu.RUnlock()
    return data[k]
}

// Option B
func get(k string) string {
    mu.RLock()
    v := data[k]
    mu.RUnlock()
    return v
}
```

**Cost**: A is ~12 ns/op (8 ns for the lock pair + ~4 ns for open-coded defer). B is ~8 ns/op.

**Tradeoff**: A is panic-safe — if `data[k]` panicked, the mutex would still release. B is faster but leaks the lock on panic.

For a map lookup, `data[k]` cannot panic (returns zero value for missing keys), so panic-safety is moot. CockroachDB and similar performance-critical codebases use B in measured hot paths and document why.

For everything else, A is correct and the 4 ns is invisible.

---

**Q21: Why does Go limit open-coded defer to 8 per function?**

**Answer**: The `deferBits` field is 8 bits — a single byte stored on the stack frame. The choice was a balance:
- 8 bits cover the vast majority of real functions (most have 1-3 defers).
- A larger bitmask would cost more stack space and complicate the runtime metadata.
- A smaller bitmask would miss too many cases.

If you have 9+ defers, the function falls back to stack-allocated `_defer` records (linked list). Cost rises from ~3-7 ns to ~12-15 ns per defer. The cliff is real but rarely hit; functions with that many defers are uncommon.

---

**Q22: How do `defer`, `panic`, and `recover` interact at the goroutine level?**

**Answer**: Each goroutine has its own `_defer` list and `_panic` list. A panic propagates only within the goroutine that triggered it. If the panic isn't recovered, that goroutine crashes the entire program (since Go ≤ 1.0).

This means:
- A deferred recover in goroutine A cannot catch a panic in goroutine B.
- If you spawn a goroutine, you must defer-recover in *that goroutine* if you want to keep your program alive.

```go
go func() {
    defer func() {
        if r := recover(); r != nil { log.Print(r) }
    }()
    risky()
}()
```

Without the deferred recover in the goroutine, a panic crashes the whole process.

This is why every web framework wraps handlers in a recovery middleware — even though the request handler runs in a per-request goroutine, the recovery is on that goroutine, not the main one.

---

## Trap Questions

**Q23 (Trap): What does this print?**

```go
func main() {
    for i := 0; i < 3; i++ {
        defer fmt.Println(i)
    }
}
```

<details>
<summary>Answer</summary>

**Output**:
```
2
1
0
```

The defer's argument `i` is evaluated at defer-time. Each iteration captures a snapshot. LIFO produces 2, 1, 0.

This is **not** the loop-variable bug (Q24 covers that).
</details>

---

**Q24 (Trap): What does this print? (Go 1.21)**

```go
func main() {
    for i := 0; i < 3; i++ {
        defer func() { fmt.Println(i) }()
    }
}
```

<details>
<summary>Answer</summary>

**Output (Go ≤ 1.21)**:
```
3
3
3
```

**Output (Go ≥ 1.22)**:
```
2
1
0
```

In Go ≤ 1.21, all three closures share the same `i` variable, which is `3` after the loop. LIFO doesn't matter — they all print 3.

In Go 1.22+, each iteration gets a fresh `i`. Each closure captures its own; LIFO produces 2, 1, 0.

This is the loop-variable trap.
</details>

---

**Q25 (Trap): What does this return?**

```go
func f() int {
    x := 10
    defer func() { x = 99 }()
    return x
}
```

<details>
<summary>Answer</summary>

**Returns**: 10.

The return value is **unnamed**. The sequence:
1. `return x` evaluates `x` (= 10) and copies it to the hidden return slot.
2. Deferred closure runs; modifies the local `x` to 99.
3. Function returns the value in the hidden return slot: 10.

The defer cannot reach the unnamed return.

If you change to:
```go
func f() (x int) {
    x = 10
    defer func() { x = 99 }()
    return
}
```

Now `x` IS the named return. The defer modifies it to 99. Returns 99.
</details>

---

**Q26 (Trap): What does this print?**

```go
func main() {
    var x int
    defer func() {
        if r := recover(); r != nil {
            fmt.Println("recovered:", r)
        }
        fmt.Println("x =", x)
    }()
    x = 100
    panic("boom")
}
```

<details>
<summary>Answer</summary>

**Output**:
```
recovered: boom
x = 100
```

The panic triggers the deferred function. `recover()` catches "boom". The closure then reads `x`, which is 100 (set just before the panic).

This is the textbook pattern for "recover and log final state".
</details>

---

**Q27 (Trap): What does this print?**

```go
func trace(name string) func() {
    fmt.Println("enter", name)
    return func() { fmt.Println("exit", name) }
}

func main() {
    defer trace("main")()
}
```

<details>
<summary>Answer</summary>

**Output**:
```
enter main
exit main
```

`trace("main")` runs immediately (it's the receiver of the call expression `trace("main")()`). It prints "enter main" and returns a closure. `defer ...()` defers calling that returned closure. On exit, the closure runs and prints "exit main".

This is the `defer trace(name)()` idiom — the doubled `()` is intentional.
</details>

---

## Summary

This question set covers the major surface area of `defer`: execution order, argument evaluation, named return values, the relationship to panic/recover, the cost model and three implementations, the Go 1.22 loop-variable change, and common traps. A candidate fluent at all levels will breeze through Junior, navigate the Middle questions deliberately, and articulate the runtime model in Senior questions. The trap questions distinguish memorization from understanding.

---

## References

- [Effective Go — Defer](https://go.dev/doc/effective_go#defer)
- [Go Spec — Defer statements](https://go.dev/ref/spec#Defer_statements)
- [Go Blog — Defer, panic, recover](https://go.dev/blog/defer-panic-and-recover)
- [Go 1.14 release notes — open-coded defer](https://go.dev/doc/go1.14)
- [Go 1.22 release notes — loop variable change](https://go.dev/doc/go1.22)
- `runtime/panic.go` in the Go source tree
