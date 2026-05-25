# Closure Internals — Optimize

Author: Bakhodir Yashin Mansur

This file is the optimisation playbook for closure-heavy Go code. Every section maps to a real cost — funcval allocation, indirect call, prevented inlining, or escape-induced heap pressure — and gives a concrete refactor with a way to measure the result.

---

## 1. Avoid spurious captures

### Problem

```go
func process(items []Item) []Result {
    return lo.Map(items, func(it Item, _ int) Result {
        ctx := context.Background()           // captures nothing
        timeout := 5 * time.Second            // captures nothing
        return doWork(ctx, it, timeout)
    })
}
```

The closure looks like it captures `ctx` and `timeout`, but both are constructed inside the body. The compiler synthesises an env struct *only if* there are captures. Here there are none — but readers think otherwise.

### Fix

The bigger problem is when a programmer assumes a heavy capture and refactors prematurely. Confirm with `-gcflags='-m=2'`:

```
./main.go:5:34: func literal does not escape
./main.go:5:34: closure: no captures
```

Zero captures, zero env struct, zero allocation.

### When to genuinely worry

```go
func process(items []Item, ctx context.Context, timeout time.Duration) []Result {
    return lo.Map(items, func(it Item, _ int) Result {
        return doWork(ctx, it, timeout) // now captures ctx and timeout
    })
}
```

Two captures. `lo.Map` doesn't escape the closure (compiler proves it), so the env can be stack-allocated. Verify; if the env escapes, hoist the work into a typed helper.

---

## 2. Prefer methods over closures in tight loops

### Problem

```go
func sumKeys(items []Item) int {
    sum := 0
    each := func(it Item) { sum += it.Key }
    for _, it := range items { each(it) }
    return sum
}
```

`each` is called per element. The body is a one-liner that would inline trivially if it were a regular function, but the compiler can't inline through `each`'s indirect call.

### Fix

Inline the body directly:

```go
func sumKeys(items []Item) int {
    sum := 0
    for _, it := range items { sum += it.Key }
    return sum
}
```

Or, if the operation must be parameterised, define a method on a typed slice:

```go
type Items []Item
func (xs Items) SumKeys() int {
    s := 0
    for _, it := range xs { s += it.Key }
    return s
}
```

The method body is a static function pointer; inlining decisions are made normally.

### Benchmark

```
BenchmarkClosure-12   25 ns/op   0 B/op   0 allocs/op
BenchmarkMethod-12    18 ns/op   0 B/op   0 allocs/op
```

The closure version is slower because the indirect call defeats the compiler's loop unrolling. The gap widens with hotter bodies.

---

## 3. Hoist closure construction out of loops

### Problem

```go
for _, item := range items {
    callbacks = append(callbacks, func() { handle(item.ID) })
}
```

The closure captures `item`. The compiler synthesises an env per iteration. Heap allocation per iteration.

### Fix A — hoist if possible

Sometimes the closure doesn't actually need per-iteration state:

```go
handler := func(id ID) { handle(id) }  // captures nothing
for _, item := range items {
    callbacks = append(callbacks, func() { handler(item.ID) })
}
```

Wait — the outer closure still captures `item.ID`. No real improvement.

### Fix B — bind via argument

```go
for _, item := range items {
    id := item.ID
    callbacks = append(callbacks, func() { handle(id) })
}
```

Captures `id` (one word) instead of `item` (struct). Smaller env.

### Fix C — switch to a different data structure

```go
ids := make([]ID, len(items))
for i, item := range items { ids[i] = item.ID }
// later: handle(ids[i]) directly, no closures
```

If you can avoid creating N closures, do. One slice of IDs is one allocation; N closures is N+1.

---

## 4. Inlining limits

### How inlining handles closures

The Go compiler can inline:

- A function that doesn't take a `func`-typed parameter (its callees are statically known).
- A direct call to a known function.

It cannot inline:

- The body of a closure called via a `func()` variable.
- A function that calls through a `func()` parameter (because the body is unknown).

### Implication

```go
func benchmark(b *testing.B, fn func()) {
    for i := 0; i < b.N; i++ { fn() }
}
```

`fn()` is an indirect call. Even if `fn` is a trivial `func() {}`, the compiler can't see it. Each iteration pays the call overhead.

```go
func benchmarkDirect(b *testing.B) {
    for i := 0; i < b.N; i++ { /* body */ }
}
```

Body is inlined and unrolled.

### Workaround — generics-via-instantiation

```go
func benchmark[F ~func()](b *testing.B, fn F) {
    for i := 0; i < b.N; i++ { fn() }
}
```

In some cases the compiler instantiates per concrete `F` and can inline if it knows the type. Verify; this is fragile.

### Workaround — manual inlining

```go
//go:inline-required  (no such pragma, but reviewers should treat as hint)
```

Inline the body at the call site instead of using a higher-order function. Loses abstraction, gains performance.

---

## 5. Closure inlining check

Quickly inspect whether a closure was inlined:

```bash
go build -gcflags='-m -m' ./... 2>&1 | grep -E '(can inline|inlined|escapes)'
```

For a closure to be inlined into its caller, it must:

1. Not escape.
2. Be called directly via its name (not through a variable).
3. Have a body small enough (~80 nodes default).

`func() { x++ }` called as `func() { x++ }()` *can* be inlined; `f := func() { x++ }; f()` typically cannot.

---

## 6. Reduce env struct size

### Problem

```go
type BigStruct struct { /* 200 bytes */ }

func makeHandler(b BigStruct, x int) func() {
    return func() { process(b, x) }
}
```

The env struct captures `b` by reference (one pointer) plus `x` by value (or by reference). The env is small; `b` itself stays where it was. If `b` was on the stack and the closure escapes, `b` is force-moved to the heap — a 200-byte allocation just for the closure.

### Fix — capture only what you need

```go
func makeHandler(b BigStruct, x int) func() {
    name := b.Name
    return func() { process(name, x) }
}
```

`process` now takes a `string` and an `int`. The env captures two scalars. `BigStruct` doesn't escape because of the closure.

This works only if `process` can be refactored to consume the narrower interface. When it can, the savings are substantial.

---

## 7. Sync.Pool for closure state

### Problem

A handler closure that builds a temporary buffer per call:

```go
func Handle(in []byte) []byte {
    return func() []byte {
        buf := make([]byte, 0, 1024)
        return append(buf, transform(in)...)
    }()
}
```

Each call allocates 1 KB.

### Fix — pool the buffer

```go
var bufPool = sync.Pool{
    New: func() any { return make([]byte, 0, 1024) },
}

func Handle(in []byte) []byte {
    buf := bufPool.Get().([]byte)[:0]
    out := append(buf, transform(in)...)
    result := append([]byte{}, out...) // copy out before returning to pool
    bufPool.Put(out)
    return result
}
```

The closure is gone; the work is direct. The pool eliminates the 1 KB allocation. The cost moves to the per-call result-copy.

If you genuinely need the closure shape (e.g., for `http.HandlerFunc`), keep the pool and capture it:

```go
func MakeHandler() http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        buf := bufPool.Get().([]byte)[:0]
        defer bufPool.Put(buf)
        // ... use buf
    }
}
```

The closure captures `bufPool` (a package-level variable — no env allocation needed for it) and nothing else.

---

## 8. Generics as an alternative to closures

### Problem — typeless higher-order function

```go
func Each(items []any, fn func(any)) {
    for _, it := range items { fn(it) }
}
```

`func(any)` is a closure; `[]any` boxes each element. Two layers of indirection per call.

### Fix — generic version

```go
func Each[T any](items []T, fn func(T)) {
    for _, it := range items { fn(it) }
}
```

`items` is no longer boxed. `fn` is still a closure, but the compiler may inline it when the call site reveals the concrete type. Allocations drop from O(N) to O(1) (the closure once, if it captures).

### Better — pure type parameterisation

```go
type Iter[T any] []T
func (xs Iter[T]) ForEach(fn func(T)) {
    for _, it := range xs { fn(it) }
}
```

Same idea, integrated into the type.

### Best — when shape allows

```go
func Sum[T constraints.Integer](xs []T) T {
    var s T
    for _, x := range xs { s += x }
    return s
}
```

No closure at all. The body is inlinable and unrolls; the type parameter resolves to a concrete operation.

---

## 9. Direct-pointer-to-function dispatch tables

### Problem — dynamic dispatch via map of closures

```go
var handlers = map[string]func(Request) Response{
    "add": func(r Request) Response { return add(r) },
    "sub": func(r Request) Response { return sub(r) },
}

func dispatch(op string, r Request) Response {
    return handlers[op](r)
}
```

The map stores funcvals. Map lookup + indirect call per dispatch.

### Fix — switch (devirtualises)

```go
func dispatch(op string, r Request) Response {
    switch op {
    case "add": return add(r)
    case "sub": return sub(r)
    }
    panic("unknown op")
}
```

`switch` on a small enum compiles to a jump table. Calls are direct, inlinable.

### When map-of-closures is right

When the set of operations is dynamic (extension points, plugin systems). Then the closure overhead is the price of flexibility. Otherwise, prefer `switch`.

---

## 10. Closures vs. struct-with-methods

### Trade-off

```go
// closure
type Handler func(Request) Response
func makeHandler(cfg *Config) Handler {
    return func(r Request) Response {
        return processWith(cfg, r)
    }
}

// struct
type Handler struct { cfg *Config }
func (h Handler) ServeHTTP(r Request) Response { return processWith(h.cfg, r) }
```

Both store one pointer. The closure form has one allocation (funcval) on creation; the struct form has zero allocations (the struct is the value). Method dispatch through an interface is one indirect call; method dispatch on a known type is direct.

The struct form wins on perf. The closure form wins on call-site terseness when the consumer expects a `func()`.

If you control both sides, structs.

---

## 11. Avoid closures inside benchmark loops

### Problem

```go
func BenchmarkX(b *testing.B) {
    for i := 0; i < b.N; i++ {
        cb := func(x int) int { return x + 1 }
        result = cb(i)
    }
}
```

You're measuring the closure construction and call, plus the body. If the goal was to benchmark the body, you've polluted the measurement.

### Fix

```go
func BenchmarkX(b *testing.B) {
    cb := func(x int) int { return x + 1 }
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        result = cb(i)
    }
}
```

Now only the call is measured.

For the actual closure-construction cost:

```go
func BenchmarkClosureBuild(b *testing.B) {
    for i := 0; i < b.N; i++ {
        cb := func(x int) int { return x + 1 }
        runtime.KeepAlive(cb)
    }
}
```

`KeepAlive` prevents the compiler from optimising the construction away.

---

## 12. Choosing the cheapest function shape

A summary table, ranked by allocation cost (lowest first):

| Shape | Allocation | Best for |
|-------|-----------|----------|
| Top-level function called directly | None | Stable APIs |
| Method on existing struct, direct call | None | Stateful operations |
| Method expression `(*T).M` | None | Function-as-parameter without state |
| Non-capturing closure `func(){}` | None | Lambda-style without state |
| Closure with captures, doesn't escape | Stack only | Short-lived callbacks (sort, filter) |
| Method value with non-escaping receiver | Stack only | Bound method passed to short-lived API |
| Capturing closure that escapes | Heap | Goroutine entry, long-lived callback |
| Method value with escaping receiver | Heap | Same |
| `reflect.MakeFunc` | Heap + extra indirection | Dynamic dispatch |

Pick the lowest row that satisfies your requirements.

---

## 13. Measurement workflow

A reproducible loop:

1. Write the simplest correct version (probably with closures).
2. Bench with `-benchmem`. Note allocs/op.
3. If allocs/op > 0 in a hot path, run `go build -gcflags='-m=2'` and find the literal that escapes.
4. Decide:
   - Stack-allocate by removing the escape (hoist, restructure).
   - Reduce env size (capture fewer/smaller variables).
   - Replace closure with method/struct/generic.
5. Re-bench. Confirm.
6. If still hot, profile with `pprof` and inspect inlining: `pprof -list <function>`.

This cycle takes minutes per function and removes the guesswork.

---

## 14. Static funcval reuse

Closures that capture nothing are emitted as static funcvals. The compiler shares them across call sites if it can prove they're the same literal. You can verify:

```bash
go tool nm ./bin | grep '\.f$' | wc -l
```

For a binary with N closure literals, you should see N (or fewer) symbols. Many more suggests the linker is generating per-call-site copies, which usually indicates the literal captured something subtly.

When you intentionally want a static closure, define it at package scope:

```go
var defaultHandler = func() { log.Println("default") }
```

Reuse `defaultHandler` everywhere instead of writing `func(){...}` inline at each call site.

---

## 15. Per-platform notes

- **amd64**: closure pointer in `DX`. Body prologue uses `MOVQ DX, X` to stash it.
- **arm64**: closure pointer in `R26`. Less register pressure than amd64.
- **wasm**: closures are heavier because wasm has a slower indirect-call mechanism. Profile your wasm binary specifically.

---

## 16. Inlining a closure manually

If a small closure is inlining-prevented because it's called through a variable, hand-inline:

```go
// before
each := func(x int) { sum += x }
for _, x := range xs { each(x) }

// after
for _, x := range xs { sum += x }
```

Trivial but real. Reviewers should not push back on this for hot paths.

---

## 17. Avoid `defer` inside closures inside loops

The compound is expensive: each iteration creates a closure, each closure registers a `defer`. Even with open-coded defers, this multiplies overhead. Refactor by extracting the body into a separate function:

```go
// before
for _, item := range items {
    func() {
        f, _ := os.Open(item.Path)
        defer f.Close()
        // ...
    }()
}

// after
for _, item := range items {
    process(item)
}

func process(item Item) {
    f, _ := os.Open(item.Path)
    defer f.Close()
    // ...
}
```

The named function gets open-coded defers reliably. The closure version may or may not, depending on the compiler version.

---

## 18. Summary

Closure optimisation is mostly about understanding where the allocation comes from. The big wins:

1. **Eliminate the closure** by inlining manually or switching to methods/generics.
2. **Eliminate the escape** by restructuring so the closure stays on the stack.
3. **Shrink the env** by capturing fewer or smaller variables.
4. **Reuse static funcvals** for non-capturing literals.
5. **Move heavy allocation out** of the closure body via `sync.Pool`.

Measure first, refactor with intent, and re-measure. Don't refactor blindly — many closures cost nothing and the readability win is worth the indirection.

---

## Further reading

- [middle.md](middle.md), [professional.md](professional.md)
- Benchmarking guide: https://pkg.go.dev/testing#hdr-Benchmarks
- Compiler optimisation flags: https://pkg.go.dev/cmd/compile
- `sync.Pool` documentation: https://pkg.go.dev/sync#Pool
- Generics performance: https://planetscale.com/blog/generics-can-make-your-go-code-slower
- Sibling: [interface-internals](../../../03-methods-and-interfaces/10-interface-internals/), [escape-analysis](../../../11-advanced-topics/02-escape-analysis/)
