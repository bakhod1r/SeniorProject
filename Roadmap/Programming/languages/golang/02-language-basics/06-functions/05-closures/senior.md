# Go Closures — Senior Level

## 1. Overview

Senior-level closure mastery means precise understanding of compiler-driven capture analysis, the heap-vs-stack decision, the cost of indirect calls through funcvals, the Go 1.22 loop-variable transformation, GC roots through closure structs, and the production patterns that arise from capture-induced memory pinning, races, and goroutine leaks.

---

## 2. Advanced Semantics

### 2.1 Closure Conversion

When the compiler sees a function literal with free variables, it performs **closure conversion**:
1. Identifies the set of captured variables.
2. Synthesizes a closure struct type containing the captures (or pointers to them for shared mutable captures).
3. Rewrites the literal body to read captures via the closure context register (DX on amd64).
4. Inserts code to allocate and initialize the closure struct.

Captures of unique-write or read-only variables may be inlined as values. Captures of mutated/shared variables become pointers to a heap cell.

### 2.2 Stack vs Heap

Escape analysis determines closure location:
- Non-escaping → stack frame of enclosing function.
- Escaping → heap.

```bash
go build -gcflags="-m=2" 2>&1 | grep "func literal"
# "func literal does not escape"
# OR
# "func literal escapes to heap"
```

If the closure escapes, captured locals must too — they move to the heap as well.

### 2.3 Shared Cell Pattern

For variables shared by closure and outer scope and possibly mutated, the compiler creates a single heap cell that both reference:

```go
n := 0
incr := func() { n++ }
get := func() int { return n }
```

Compiles roughly to:
```
heap_cell_n := alloc(int)
*heap_cell_n = 0
incr_closure := { code: incr_body, n_ptr: heap_cell_n }
get_closure := { code: get_body, n_ptr: heap_cell_n }
n is replaced by *heap_cell_n in both bodies and any outer references.
```

This makes capture-by-reference work correctly for both reads and writes.

### 2.4 Indirect Call Cost

Calling through a closure is an indirect call:

```asm
MOVQ closure, DX        ; closure context register
MOVQ (DX), R8           ; load code pointer (or whatever offset stores it)
CALL R8                 ; indirect branch
```

Cost: ~3-5 cycles vs ~1 for direct call. Cannot be inlined unless devirtualized.

PGO can inline hot indirect calls when one closure dominates a call site.

### 2.5 Loop Variable Transformation (Go 1.22)

Pre-1.22:
```go
for i := 0; i < N; i++ { body using i }
```

Compiled to: single stack slot for `i`, reused. Closures capture pointer to this slot.

Go 1.22+:
```go
for i := 0; i < N; i++ { body using i }
```

Conceptually transforms to:
```go
for outerI := 0; outerI < N; outerI++ {
    i := outerI // fresh variable per iteration
    body
}
```

Each iteration's `i` is a separate stack slot (or heap cell if captured by escaping closure). Closures see distinct values.

The compiler optimizes away the per-iteration allocation when no closure captures `i`.

### 2.6 Pointer Arithmetic in Closure Captures

The compiler may use pointer arithmetic to access multiple captures from a single context register:

```
DX → closure struct base
0(DX): code ptr
8(DX): capture 0
16(DX): capture 1
24(DX): capture 2
```

Loads use offsets from DX.

### 2.7 Reference Counting? No.

Go doesn't reference-count closures. The GC tracks closure values like any other heap allocation. When the closure becomes unreachable, both the closure struct and any captured cells become eligible for collection.

---

## 3. Production Patterns

### 3.1 Avoid Heavy Captures

```go
// BAD — captures big config; pins it for closure lifetime
func makeHandler(cfg *BigConfig) func() {
    return func() { use(cfg.threshold) }
}

// GOOD — captures only the int
func makeHandler(cfg *BigConfig) func() {
    threshold := cfg.threshold
    return func() { use(threshold) }
}
```

Memory savings can be huge — the difference between holding a 10 MB config vs a 4-byte int.

### 3.2 Synchronize Captured Mutable State

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

The closure captures both `mu` and `n`. Single closure instance is concurrency-safe.

### 3.3 Cancel-Aware Goroutines

```go
func startWorker(ctx context.Context, data Data) {
    go func() {
        for {
            select {
            case <-ctx.Done():
                return
            case <-time.After(10 * time.Second):
                process(data)
            }
        }
    }()
}
```

The closure captures `ctx` and `data`. Without `ctx.Done()`, the goroutine leaks and pins `data` forever.

### 3.4 Closure Per Call vs Hoisted

```go
// Per call (allocates if escaping)
for _, item := range items {
    sched.Go(func() { process(item) })
}

// Hoisted (no per-iter allocation if non-capturing)
processAll := func(item Item) { process(item) }
for _, item := range items {
    sched.GoArg(processAll, item)
}
```

The hoisted version requires `sched.GoArg` accepting an arg; this is a common API design choice for hot paths.

### 3.5 Closure-Based DSL

Closures excel as building blocks for small DSLs:

```go
type Predicate func(Item) bool

And := func(ps ...Predicate) Predicate {
    return func(i Item) bool {
        for _, p := range ps {
            if !p(i) { return false }
        }
        return true
    }
}

isAdult := func(i Item) bool { return i.Age >= 18 }
isMember := func(i Item) bool { return i.Member }

eligible := And(isAdult, isMember)
filter(items, eligible)
```

Each combinator is a closure capturing its operands.

### 3.6 Interface vs Closure

For a single-method interface, a closure can replace it:

```go
// Interface
type Notifier interface {
    Notify(event string) error
}

// Closure equivalent
type NotifyFunc func(event string) error

func (f NotifyFunc) Notify(event string) error { return f(event) }

// Now NotifyFunc satisfies Notifier:
var n Notifier = NotifyFunc(func(e string) error {
    fmt.Println(e); return nil
})
```

This is the idiom used by `http.HandlerFunc` to make a function satisfy `http.Handler`.

---

## 4. Concurrency Considerations

### 4.1 Captured Mutable State Across Goroutines

Always synchronize:
- Per-closure mutex (preferred).
- Atomic operations for simple int/pointer captures.
- Channels for serialization.

### 4.2 Pre-1.22 Loop Capture Race

```go
// Pre-1.22 only:
var wg sync.WaitGroup
for i := 0; i < 5; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        fmt.Println(i)
    }()
}
wg.Wait()
```

`i` is shared. Each goroutine reads the same `i`; the main goroutine writes to it via `i++`. Race condition.

Go 1.22+ fixes this by per-iteration semantics. Pre-1.22 needs `i := i` shadow.

### 4.3 Goroutine Leaks From Long-Lived Closures

```go
func leak() {
    config := loadBig()
    go func() {
        for { time.Sleep(time.Hour); _ = config }
    }()
}
```

The goroutine never exits. `config` is pinned forever. Leaks accumulate over the process lifetime.

Fix: use context cancellation; design every goroutine to listen for shutdown.

### 4.4 Finalizers and Captured State

A `runtime.SetFinalizer` callback is itself a closure. Be careful: the finalizer captures state and runs in a separate goroutine. Captures must be safe to read from the finalizer thread.

---

## 5. Memory and GC Interactions

### 5.1 Closure Struct as Heap Object

For escaping closures:
- 1 heap allocation for the closure struct.
- 1 additional heap allocation per captured cell (for shared mutable captures).
- The closure struct is a GC root via the funcval; captured pointers within are scanned.

### 5.2 Pointer-Density of Captures

If captures contain many pointers, each closure adds many GC roots. Reduce by:
- Capturing primitive values when possible.
- Restructuring to capture a small struct.
- Setting captures to nil when done (if closure stays alive but doesn't need them).

### 5.3 Capture Lifetime Tracking

A closure keeps captured pointers alive. To enable GC of large objects:
- Drop the closure reference (`f = nil`).
- Make captured fields nilable and set them to nil within the closure when no longer needed.

```go
func makeOneShot(big *BigData) func() {
    return func() {
        process(big)
        big = nil // signal we're done; help GC
    }
}
```

The captured `big` is shared with the outer scope, so this nil affects only the closure's view, not the outer variable. To fully release, you'd need a more careful design (e.g., wrapping in a struct).

---

## 6. Production Incidents

### 6.1 Pinned Buffer Leak

A logging library wrapped each log line in a closure that captured a 4 KB buffer. Closures were queued for batch processing. With 10k log lines/sec, 40 MB of buffers pinned at any moment.

Fix: serialize the log line to a small string before queuing; closure captures only the string.

### 6.2 Pre-1.22 Loop Race in Production

A 1.20 service spawned goroutines per item:
```go
for _, item := range items {
    go func() { process(item) }()
}
```

`item` was shared; processed item was non-deterministic. Fixed with `item := item` shadow.

### 6.3 Closure-Captured Channel Causes Leak

A handler captured a result channel. The handler spawned a goroutine that wrote to the channel. If the handler returned without reading, the goroutine blocked forever waiting to send.

Fix: make the channel buffered, or use `select` with `ctx.Done()`.

### 6.4 Unbounded Memo Cache in a Closure

A memoize wrapper accumulated cache entries indefinitely. Memory grew until OOM.

Fix: bound the cache (LRU); evict entries older than N.

---

## 7. Best Practices

1. **Capture only what's needed**.
2. **Synchronize concurrent captures**.
3. **Bound closures' lifetimes** (cancellation context).
4. **Use struct + methods** when state grows.
5. **Profile escape behavior** with `-gcflags="-m"`.
6. **Avoid closures in tight inner loops**.
7. **Use snapshot capture** when you don't want live updates.
8. **Use generics** for typed closure factories.
9. **Beware long-lived closures** capturing per-request data.
10. **Test concurrent closures with `-race`**.

---

## 8. Reading the Compiler Output

```bash
# Closure escape:
go build -gcflags="-m=2"

# Inlining:
go build -gcflags="-m -m"

# Generated assembly:
go build -gcflags="-S"

# SSA passes:
GOSSAFUNC=foo go build .
```

Inspect:
- "func literal escapes to heap"
- "moved to heap: <var>"
- "inlining call to <func>"

---

## 9. Self-Assessment Checklist

- [ ] I understand the closure conversion process
- [ ] I can predict whether a closure escapes
- [ ] I know the cost of indirect calls
- [ ] I synchronize concurrent capture access
- [ ] I extract minimum captures to avoid pinning
- [ ] I understand the Go 1.22 loop-variable transformation
- [ ] I can debug closure-driven goroutine leaks
- [ ] I use snapshot capture when needed
- [ ] I read `-gcflags="-m"` to verify

---

## 10. Summary

Closures compile to a code pointer + capture environment. Non-escaping closures stay on the stack; escaping closures + their captures move to the heap. Captures are by reference; concurrent mutation needs synchronization. The Go 1.22 loop-variable change creates per-iteration variables, fixing a class of latent bugs. Production hazards are pinned memory through heavy captures, goroutine leaks from long-lived closures, and races from concurrent capture access.

---

## 11. Further Reading

- [Go Internal ABI — closure context register](https://github.com/golang/go/blob/master/src/cmd/compile/abi-internal.md)
- [Go 1.22 release notes — Loop variable](https://go.dev/doc/go1.22)
- [Closure conversion in cmd/compile](https://cs.opensource.google/go/go/+/refs/tags/go1.22:src/cmd/compile/internal/walk/closure.go)
- [Dave Cheney — Goroutines and closures](https://dave.cheney.net/2014/03/19/channel-axioms)
- 2.6.4 Anonymous Functions
- 2.6.7 Call by Value
- 2.7.4 Memory Management
