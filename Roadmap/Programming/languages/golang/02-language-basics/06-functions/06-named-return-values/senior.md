# Go Named Return Values — Senior Level

## 1. Overview

Senior-level mastery of named returns means understanding the open-coded defer interaction, the precise semantics of return-set-then-defer-modify, escape implications when named results are addressed, and the production patterns where named returns enable clean error/panic handling without breaking inlining or performance.

---

## 2. Advanced Semantics

### 2.1 Open-Coded Defer + Named Returns

Open-coded defer (Go 1.14+) inlines deferred function bodies directly into each return path. This makes the `defer + named return` pattern essentially zero-cost for the no-panic case:

```go
func op() (err error) {
    res, err := acquire()
    if err != nil { return err }
    defer func() {
        if cerr := res.Close(); cerr != nil && err == nil {
            err = cerr
        }
    }()
    return nil
}
```

For ≤ 8 defers without loop-defer, the compiler emits the deferred logic at each return point with a bitmap tracking which are active. The named result is just a normal local variable that the inlined defer reads/writes.

Verify:
```bash
go build -gcflags="-d=defer=2" 2>&1 | grep "open-coded"
```

### 2.2 Return Sequence Detail

For `return expr1, expr2`:
1. Evaluate `expr1`, `expr2` left-to-right.
2. Assign to named result variables (registers/stack slots).
3. Run open-coded defers (in registered order, LIFO).
4. Return.

The order matters: defers see the values set by `expr1`, `expr2`, and any further modifications from earlier defers in LIFO order.

### 2.3 Address of Named Result

You can take the address of a named result, but be careful with lifetime:

```go
func f() (n int) {
    p := &n // valid — n is a regular local
    *p = 42
    return // returns 42
}
```

If `p` escapes (e.g., stored in a global), `n` would need to move to the heap. Verify with `-gcflags="-m"`.

### 2.4 Named Returns and Inlining

Named returns don't inhibit inlining; they're regular locals. The inliner handles them like any other variable.

For a small function:
```go
func half(n int) (result int) { result = n / 2; return }
```

The inliner replaces a call site `r := half(10)` with `r := 10 / 2`. The named-result decoration is purely sugar at this point.

### 2.5 Result Initialization Cost

Named results are initialized to zero values. For primitive types (int, bool, etc.), this is a single move instruction. For larger types (struct, slice, map), it's a memset of the result-area memory.

For very large named struct results, this may be observable. Most code doesn't notice.

### 2.6 Defer + Named Return + Recover

The canonical pattern:

```go
func safe() (err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("recovered: %v", r)
        }
    }()
    risky()
    return nil
}
```

When `risky()` panics:
1. The panic propagates up.
2. The deferred function runs (still as part of unwinding).
3. `recover()` returns the panic value.
4. The deferred function assigns to `err`.
5. Once the deferred function returns without re-panicking, the panic is "absorbed".
6. The function returns normally with the named result `err` set.

Open-coded defer handles this case via the runtime's defer-table consulted during unwinding (slower path than the normal return path, but still fast).

---

## 3. Production Patterns

### 3.1 Cleanup-Error Propagation

```go
func processFile(path string) (n int, err error) {
    f, err := os.Open(path)
    if err != nil { return 0, err }
    defer func() {
        if cerr := f.Close(); cerr != nil && err == nil {
            err = cerr
        }
    }()
    n, err = countLines(f)
    return
}
```

Without named `err`:
```go
func processFile(path string) (int, error) {
    f, err := os.Open(path)
    if err != nil { return 0, err }
    n, err := countLines(f)
    cerr := f.Close()
    if err == nil && cerr != nil { err = cerr }
    return n, err
}
```

The named version is shorter AND correct on early-error paths (defer runs even if `countLines` returns early via panic or compiler-emitted return).

### 3.2 Auto-Rollback in Transactions

```go
func transfer(db *sql.DB, from, to string, amount int) (err error) {
    tx, err := db.Begin()
    if err != nil { return }
    defer func() {
        if err != nil {
            tx.Rollback()
            return
        }
        if cerr := tx.Commit(); cerr != nil {
            err = cerr
        }
    }()
    if _, err = tx.Exec("..."); err != nil { return }
    if _, err = tx.Exec("..."); err != nil { return }
    return
}
```

The defer commits on success, rolls back on any error path. The named `err` is the single source of truth.

### 3.3 Tracing/Metrics

```go
func tracedQuery(name string, q string) (rows *sql.Rows, err error) {
    start := time.Now()
    defer func() {
        metrics.Record(name, time.Since(start), err)
    }()
    rows, err = db.Query(q)
    return
}
```

The defer reads `err` and emits to metrics regardless of success/failure.

### 3.4 Panic Boundary

```go
func handle(req *Request) (resp *Response, err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("handler panic: %v", r)
            resp = nil
            // Optional: log stack
            log.Printf("panic: %s", debug.Stack())
        }
    }()
    return doHandle(req)
}
```

Used at API boundaries to prevent panics from crashing the server.

### 3.5 Avoid Naked Return in Long Functions

```go
// Bad
func longFunction() (a, b, c int, err error) {
    // ... 50 lines of complex logic ...
    return // reader has to scroll up to see what's returned
}

// Better
func longFunction() (int, int, int, error) {
    // ... 50 lines ...
    return a, b, c, nil // explicit
}
```

Or break into smaller functions.

---

## 4. Concurrency Considerations

### 4.1 Named Results and Goroutines

If a named result is captured by a closure that's then sent to a goroutine, the goroutine reads/writes the same variable as the function. For named results that escape via closure capture, the variable moves to the heap.

```go
func work() (n int) {
    var wg sync.WaitGroup
    wg.Add(1)
    go func() {
        defer wg.Done()
        n = 42 // race: main goroutine returns n; this goroutine writes
    }()
    wg.Wait() // wait BEFORE return to avoid race
    return
}
```

Without `wg.Wait()` before return, this would race.

### 4.2 Defer + Goroutine

Defer runs in the goroutine that registered it. A defer in a function that spawned other goroutines doesn't wait for them — you need explicit synchronization.

```go
func leak() (err error) {
    defer func() {
        // runs when leak returns, NOT when the goroutine finishes
    }()
    go func() {
        // outlives the parent
    }()
    return nil
}
```

---

## 5. Memory and GC Interactions

### 5.1 Named Result Escape

If a named result is addressed and the address escapes:
- The result variable moves to the heap.
- One additional alloc per call.

```go
var sink *int
func f() (n int) {
    sink = &n // n escapes to heap
    n = 42
    return
}
```

For typical code, named results don't escape; they're just register/stack values.

### 5.2 Defer + Named Result Allocation

The deferred closure may need to capture the named result. If the defer is open-coded, no closure allocation; the modification is inlined.

For non-open-coded defers (in loops, > 8 defers), the closure captures the result reference. In rare cases this can be a small per-defer alloc.

---

## 6. Production Incidents

### 6.1 Lost Close Error

A team's file-write code discarded the close error:
```go
func save(path string, data []byte) error {
    f, err := os.Create(path)
    if err != nil { return err }
    defer f.Close() // close error discarded
    _, err = f.Write(data)
    return err
}
```

For network-attached storage, `Close` could return errors indicating the data wasn't fully flushed. Silent data loss in production.

Fix: named return + defer that captures close error:
```go
func save(path string, data []byte) (err error) {
    f, err := os.Create(path)
    if err != nil { return err }
    defer func() {
        if cerr := f.Close(); cerr != nil && err == nil {
            err = cerr
        }
    }()
    _, err = f.Write(data)
    return
}
```

### 6.2 Forgotten Assignment Returning Zero

A function failed silently because a path forgot to set the named result:
```go
func parse(s string) (n int, err error) {
    if s == "" {
        err = fmt.Errorf("empty")
        return // returns (0, err) — caller might use 0 inadvertently
    }
    n = strconv.Atoi(s) // BUG: this is multi-result; only n receives a value
    return
}
```

The bug: `n = strconv.Atoi(s)` is a compile error (multi-value RHS into single-value LHS). The team had had `n, _ = strconv.Atoi(s)` and "fixed" it to discard the error. The result: n was always 0 for invalid input, and err was zero-value nil.

Fix:
```go
n, err = strconv.Atoi(s)
return
```

### 6.3 Naked Return After Refactor Hides Bug

A function originally had `return value, nil`. A refactor changed it to use named results and `return`. Because the refactor missed setting `value` on one path, the function silently returned zero in production for some inputs.

Fix: prefer explicit returns when the function is more than ~10 lines, OR add tests for every code path.

---

## 7. Best Practices

1. **Use named returns to enable defer modification** (cleanup-error, panic-to-error).
2. **Use named returns for documentation** when result names add semantic value.
3. **Avoid naked return in long functions** — readers can't see what's returned.
4. **Don't shadow named results with `:=`**.
5. **Always assign before naked return** — or accept zero-value.
6. **Prefer explicit return at the bottom of branchy functions**.
7. **Keep defer logic short** — complex defers obscure semantics.
8. **Test all paths** — naked return makes "forgot to assign" silent.
9. **Document each named result**.
10. **Use the cleanup-error pattern uniformly across the codebase**.

---

## 8. Reading the Compiler Output

```bash
# Open-coded defer:
go build -gcflags="-d=defer=2"

# Inlining:
go build -gcflags="-m -m"

# Escape analysis:
go build -gcflags="-m=2"
```

Look for:
- "open-coded defer" — fast path active.
- "stack-allocated defer" — slower fallback.
- "moved to heap" for named results — escape due to address-taking.

---

## 9. Self-Assessment Checklist

- [ ] I use named returns deliberately (documentation, defer mod)
- [ ] I implement cleanup-error capture correctly
- [ ] I convert panics to errors at API boundaries
- [ ] I avoid naked return in long functions
- [ ] I never shadow named results
- [ ] I test all paths to catch missed assignments
- [ ] I understand open-coded defer interactions
- [ ] I know when named results escape to heap
- [ ] I document each named result

---

## 10. Summary

Named returns are local variables zero-initialized at function entry. Their main strengths: documentation in signature and defer-time modification (cleanup-error, panic-to-error, auto-rollback). Open-coded defer makes these patterns near-zero-cost. Avoid naked return in long or branchy functions where the assignment site is far from the return. Don't shadow with `:=`; use `=` for assignment. Always test all paths to catch missed assignments.

---

## 11. Further Reading

- [Effective Go — Named result parameters](https://go.dev/doc/effective_go#named-results)
- [Open-coded defers proposal](https://github.com/golang/proposal/blob/master/design/34481-opencoded-defers.md)
- [Go Blog — Defer, Panic, and Recover](https://go.dev/blog/defer-panic-and-recover)
- [Go Spec — Return statements](https://go.dev/ref/spec#Return_statements)
- 2.6.3 Multiple Return Values
- 2.6.1 Functions Basics
