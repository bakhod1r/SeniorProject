# Closure Internals — Professional

Author: Bakhodir Yashin Mansur

This file shows how closure internals matter in production Go code: middleware, errgroup, debugging captured-state bugs, profiling allocations, and reducing closure overhead in hot paths. It assumes the material in [senior.md](senior.md). Examples reflect patterns seen in real services.

---

## 1. Closures as middleware

The canonical HTTP middleware shape:

```go
type Middleware func(http.Handler) http.Handler

func WithRequestID(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        id := uuid.NewString()
        r = r.WithContext(context.WithValue(r.Context(), reqIDKey{}, id))
        w.Header().Set("X-Request-ID", id)
        next.ServeHTTP(w, r)
    })
}
```

What you wrote:

- `WithRequestID` returns an `http.HandlerFunc` (which is itself a `func`-typed type implementing `http.Handler`).
- The returned function literal captures `next`.

Allocations per call to `WithRequestID(next)`:

- One env struct of `(next http.Handler)` — two words.
- One funcval pointing at the body.
- The `http.HandlerFunc` conversion is free (single-method interface optimisation in 1.18+).

If you stack three middleware:

```go
final := WithRequestID(WithLogging(WithAuth(handler)))
```

Three closures, three env structs. All allocated **once at startup**, not per request. The cost is fixed, the request path is just three indirect calls. That's why the pattern scales.

### Anti-pattern: per-request middleware factories

```go
// Bad: closure created on every request
func handleRoot(w http.ResponseWriter, r *http.Request) {
    inner := func(...) { ... }   // env captures r, w, etc.
    chain := wrap(wrap(inner))
    chain.ServeHTTP(w, r)
}
```

Now you allocate the chain per request. Hot endpoints pay it on every hit. Move the chain construction to package init or a `sync.Once`.

---

## 2. Closures in errgroup

`golang.org/x/sync/errgroup` is closure-heavy by design:

```go
g, ctx := errgroup.WithContext(ctx)
for _, url := range urls {
    url := url               // pre-1.22 — defeat loop-var capture
    g.Go(func() error {
        return fetch(ctx, url)
    })
}
if err := g.Wait(); err != nil { return err }
```

Each `g.Go(func() error { ... })` spawns a goroutine whose entry is the closure. The closure:

- Captures `ctx` and `url`.
- Allocates a funcval and env on the heap (always — goroutines).
- Adds to the group's internal wait state.

For 100 URLs that's 100 heap allocations of ~32 bytes each plus 100 goroutine stacks (each ~2 KB initially). The closure cost is small relative to the goroutine cost, but it adds up at the million-task scale (batch processing, fan-out crawlers, log shippers).

Mitigations:

1. **Use a worker pool**: a fixed number of goroutines pull from a channel of tasks. The closure cost moves from per-task to per-worker.
2. **Pre-build a struct per task**, then have the goroutine read from it. The funcval can still be created once outside the loop if the body takes the task as a parameter — but Go's `errgroup.Go` expects a `func() error`, so you'd be channelling tasks rather than spawning per task.
3. **Use Go 1.22+** to drop the `url := url` shadow line.

---

## 3. Capture-bug case studies

### Case study 1 — config snapshot drift

Production code:

```go
type Config struct { Tier string; Retries int }

func (s *Server) ReloadConfig(c *Config) {
    s.cfg = c
    s.processor = func(req Request) Response {
        return process(req, c)   // captures the *Config from this call
    }
}
```

Reported bug: after the second `ReloadConfig`, requests still saw the first config. The processor closure captured the **first call's** `c` and was never reassigned because the second `ReloadConfig` rebuilt `s.processor` from the new `c`.

…wait, did it? Read again. `s.processor = func(req Request) Response { ... }`. Each call rebuilds the closure. So why the bug?

The bug was elsewhere: another goroutine had cached the old `s.processor` value before the reload. Closures pin captured state at *creation time*; if a consumer holds a reference to an old closure, it keeps the old config alive. Memory profile showed two `Config` instances in `inuse_objects`.

**Lesson**: a closure is a reference graph anchor. When you replace a global closure, all extant copies still reference the old env. Use a pointer indirection (`*Config`) inside the closure that you mutate atomically, not a fresh `*Config` per reload.

### Case study 2 — goroutine leak via captured channel

```go
func runWorker(work <-chan job, done chan<- struct{}) {
    go func() {
        for j := range work {
            process(j)
        }
        done <- struct{}{}
    }()
}
```

The leak: if `work` is never closed and never goes out of scope, the goroutine blocks forever in `range work`. The closure captures `work` and `done`; both stay alive; nothing gets GC'd; the goroutine is stuck.

The internal cause is reference graph: as long as the goroutine exists and references the channels, they cannot be collected. A goroutine that captures a channel is exactly as alive as the channel — closing the channel from outside is the only escape.

**Lesson**: every long-lived goroutine that captures a channel must have a documented termination condition. Add a `ctx context.Context` to the closure's capture and `select` on `<-ctx.Done()` alongside the channel read.

### Case study 3 — mutex copy via method value

```go
type Counter struct { mu sync.Mutex; n int }

func (c Counter) Add(x int) { c.mu.Lock(); defer c.mu.Unlock(); c.n += x }

func main() {
    c := &Counter{}
    incr := c.Add   // method value with value receiver — COPY of *c
    incr(1); incr(2)
}
```

`c.Add` is a method value with a **value** receiver. The compiler copies `*c` (including the embedded `sync.Mutex`!) into the funcval env. Each call locks the **copied** mutex. The intended shared state isn't shared. `go vet` warns: `Add passes lock by value`.

**Lesson**: when capturing a struct via method value, use pointer receivers if any field needs identity (mutexes, atomics, channels, maps).

---

## 4. Profiling closure-heavy hot paths

### Heap profile

```bash
go tool pprof -alloc_objects http://localhost:6060/debug/pprof/heap
(pprof) top20
```

A closure-allocation hotspot looks like:

```
flat   flat%   sum%   cum   cum%
40MB   28.4%  28.4%   40MB  28.4%  runtime.newobject /usr/local/go/src/runtime/malloc.go:1100
                              github.com/me/svc/internal/middleware.go:42 (inlined)
                              github.com/me/svc/internal/middleware.go:60
```

Source pointer is the file:line of the function literal. Find the literal, ask whether it can be hoisted, replaced with a method, or made non-capturing.

### CPU profile

Indirect closure calls show up under `runtime.morestack` and `runtime.findfunc` in extreme cases (deep call chains). More typically you see the closure body's symbol with a parent frame that is the calling site, e.g.:

```
0.12s   2.4%  main.processItem.func1 /me/svc/process.go:88
```

If `func1` consumes lots of CPU and is called in a tight loop, that's a candidate for refactoring to a non-closure form (method, package-level function with explicit parameters).

### Trace

`runtime/trace` shows goroutine lifetimes. Many short goroutines whose entry is `main.handle.func1` indicates `go func(){...}()` patterns. Each new goroutine costs ~2 KB stack + closure allocation. If trace shows a thousand short goroutines per second, consider pooling them.

---

## 5. Reducing closure allocations

### Technique A — hoist the closure

```go
// before — closure allocated per call
func process(items []Item) {
    sort.Slice(items, func(i, j int) bool { return items[i].Key < items[j].Key })
}

// after — no improvement, sort.Slice already non-allocating for stack closures
```

`sort.Slice` doesn't escape the comparator, so the closure stays on the stack. No allocation. Inspect with `-gcflags='-m'` to be sure.

But:

```go
// before
func processAll(itemSets [][]Item) {
    for _, items := range itemSets {
        sort.Slice(items, func(i, j int) bool { return items[i].Key < items[j].Key })
    }
}
```

The closure captures `items`, which changes each iteration. The compiler synthesises a new env per iteration. If the closure escapes (it doesn't here, but in similar code with `sort.SliceStable` semantics it might), allocation is per-iteration.

Switch to a sort interface or sort.Slice over a typed slice and the closure may inline.

### Technique B — replace with a method

```go
// before
results := lo.Map(items, func(it Item, _ int) string { return it.Key })

// after
type Items []Item
func (xs Items) Keys() []string {
    out := make([]string, len(xs))
    for i, x := range xs { out[i] = x.Key }
    return out
}
results := Items(items).Keys()
```

No closure allocation. Often faster because the loop body is inlinable. Trade-off: more code, harder to reuse the lambda shape across types (generics may help — see Technique C).

### Technique C — generics

```go
func Map[T, U any](xs []T, f func(T) U) []U {
    out := make([]U, len(xs))
    for i, x := range xs { out[i] = f(x) }
    return out
}

results := Map(items, func(it Item) string { return it.Key })
```

The closure `func(it Item) string` is still allocated when passed by interface or escapes. But each generic instantiation gives the compiler more concrete information; with luck the closure is inlined into the instantiated `Map[Item, string]` and the allocation disappears. Verify with `-gcflags='-m=2'`.

### Technique D — sync.Pool for closure state

If a closure must capture a large struct that varies per call, pool the struct:

```go
var bufPool = sync.Pool{New: func() any { return &bytes.Buffer{} }}

func Handle(w io.Writer) {
    buf := bufPool.Get().(*bytes.Buffer)
    defer func() {
        buf.Reset()
        bufPool.Put(buf)
    }()
    use(buf, w)
}
```

The `defer func()` here captures `buf`. The closure is the small overhead; the pool removes the big-buffer allocation. Net: one tiny closure per call instead of one large buffer.

### Technique E — direct call instead of indirect

```go
// before
var handler func(req Request) Response = doIt

handler(req)              // indirect call

// after
doIt(req)                 // direct call
```

Trivial when you can. In configurable systems (the handler is selected at runtime) you can pre-build a dispatch table of typed function pointers. Each table entry is a static funcval (no allocation), the call is still indirect, but the table lookup is cache-friendly and prediction-friendly.

---

## 6. Closure use in stdlib hot paths

### `sync.Once`

```go
type Once struct {
    done atomic.Uint32
    m    Mutex
}

func (o *Once) Do(f func()) {
    if o.done.Load() == 0 {
        o.doSlow(f)
    }
}
```

`f` is a `func()`. The fast path doesn't call `f`. The slow path calls it once. The closure passed in is typically captured-state ("init this database"), but it's only ever invoked once, so the cost is one-time.

### `http.HandlerFunc`

```go
type HandlerFunc func(ResponseWriter, *Request)
func (f HandlerFunc) ServeHTTP(w ResponseWriter, r *Request) { f(w, r) }
```

A single-method interface implemented by a function-typed type. Go 1.18+ optimises the `Handler(HandlerFunc(fn))` conversion to avoid an allocation in many cases. Earlier versions allocated a small wrapper.

### `errgroup.Go`

```go
func (g *Group) Go(f func() error) {
    g.wg.Add(1)
    go func() {
        defer g.wg.Done()
        if err := f(); err != nil { ... }
    }()
}
```

Two closures: the user-provided `f`, and the wrapper goroutine entry. The wrapper closure captures `g` and `f`. One env-struct allocation per `g.Go` call, on top of the goroutine.

In tight loops, this is the main cost above the goroutine cost. Profile shows `errgroup.(*Group).Go.func1` allocating.

---

## 7. Closures across goroutine boundaries

The deep rule: anything captured by a closure that runs in a goroutine must be **safe for concurrent access** with whatever the spawning goroutine does next. Common bugs:

```go
// Bug: shared counter
var n int
for i := 0; i < 100; i++ {
    go func() { n++ }()
}
```

Capture-by-reference + concurrent write = data race. `go run -race` catches it.

```go
// Bug: shared slice
results := make([]int, 0, 100)
for i := 0; i < 100; i++ {
    i := i
    go func() {
        results = append(results, work(i))
    }()
}
```

`append` may reallocate. Two goroutines may grow at once. Race.

```go
// Bug: shared map
m := make(map[int]int)
for i := 0; i < 100; i++ {
    i := i
    go func() { m[i] = work(i) }()
}
```

Go maps are not safe for concurrent write. Crash.

Fixes:

- Use `sync.Mutex`, `sync.RWMutex`, or `sync.Map`.
- Use a channel for results: `ch := make(chan result, n)`; each goroutine sends; main drains.
- Pre-allocate slots and have each goroutine write to its own index.

Each "fix" still uses closures — the closure isn't the problem. The problem is the captured *mutable shared state*.

---

## 8. Observability: logging captured state

When a closure causes a bug, you want to know what it captured. Two techniques.

### Print env at construction

```go
func makeHandler(id string, cfg *Config) http.HandlerFunc {
    log.Debug().Str("id", id).Str("tier", cfg.Tier).Msg("handler built")
    return func(w http.ResponseWriter, r *http.Request) { ... }
}
```

The log line records exactly what got captured. When a request later behaves oddly, search logs for `handler built` with the offending id.

### Print env from inside the closure

```go
return func(w http.ResponseWriter, r *http.Request) {
    log.Debug().Str("id", id).Msg("handler invoked")
    ...
}
```

Now each invocation logs the captured id. Pairs nicely with structured logging.

### Periodic dump

For long-lived closures (background workers), expose `expvar` or `prometheus` metrics that report captured state (queue length, last-processed item, config version). The closure has the state — give the operator a way to read it.

---

## 9. Tests for closure behaviour

Closures are testable. Mostly you test the function that returns the closure:

```go
func TestMakeCounter(t *testing.T) {
    c := makeCounter()
    if c() != 1 { t.Fatal() }
    if c() != 2 { t.Fatal() }
    // independent instance
    c2 := makeCounter()
    if c2() != 1 { t.Fatal() }
}
```

For middleware, test the full chain:

```go
func TestChain(t *testing.T) {
    var called []string
    record := func(name string) Middleware {
        return func(next http.Handler) http.Handler {
            return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
                called = append(called, name)
                next.ServeHTTP(w, r)
            })
        }
    }
    chain := record("a")(record("b")(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})))
    chain.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/", nil))
    if !reflect.DeepEqual(called, []string{"a", "b"}) { t.Fatal(called) }
}
```

The captured `called` slice is itself a test instrument — the test inspects the closure's side effects.

---

## 10. Capturing context — the most subtle bug

Two closures, two captures of `ctx`:

```go
ctx, cancel := context.WithCancel(parent)
go func() { worker1(ctx) }()
go func() { worker2(ctx) }()
cancel()  // both workers see the same cancelled context
```

Correct. Both closures captured the same `ctx` variable; calling `cancel()` propagates.

But:

```go
for _, item := range items {
    ctx, cancel := context.WithTimeout(parent, 5*time.Second)
    defer cancel()
    go func() { worker(ctx, item) }()
}
```

Two bugs:
1. Pre-1.22: `item` is shared across goroutines.
2. `defer cancel()` doesn't run until the surrounding function returns — but the loop has accumulated N pending cancels. The contexts stay alive across the whole loop, defeating the per-item timeout. Even worse, the deferred cancels pile up on the defer stack.

Fix:

```go
for _, item := range items {
    item := item
    go func() {
        ctx, cancel := context.WithTimeout(parent, 5*time.Second)
        defer cancel()
        worker(ctx, item)
    }()
}
```

Now each goroutine owns its own context and cancellation runs at goroutine exit, not at outer function exit.

The internals point: closures + `defer` + loops compound. Each construct is fine in isolation. Together they create surprises.

---

## 11. Anti-patterns checklist

- Closure-creating loop without value-copy (`v := v`) on Go ≤ 1.21.
- Method value on a struct with embedded `sync.Mutex` and value receiver.
- Captured `*Config` replaced via reassignment instead of mutation through a stable pointer.
- Closure inside a hot loop that allocates per iteration.
- Goroutine entry that captures channels but has no termination path.
- `defer cancel()` inside a loop.
- Closure capturing big slices/maps for read-only purposes — pass smaller slices instead.
- Method value used where method expression would do (no captured state needed).
- Heavy work inside `init()` building closures — slows program startup, no benefit.

---

## 12. Production readiness checklist

For any closure-heavy code shipping to production:

- [ ] All closure-capturing-goroutines have a documented exit condition.
- [ ] All shared captured state is concurrency-safe (locks, atomics, channels).
- [ ] Loop-variable capture either uses Go 1.22 semantics or shadow-by-`:=`.
- [ ] Hot-path closures profiled with `-benchmem`; allocations justified.
- [ ] Long-lived closures monitored via metrics on their captured state.
- [ ] `go vet` enabled in CI (catches lock-by-value among others).
- [ ] `-race` enabled in test pipeline.
- [ ] Reviewers know to flag `defer` inside loops and `go func(){...}()` inside loops.

---

## 13. Summary

In production, closures are not a curiosity — they are the primary mechanism for HTTP middleware, errgroup tasks, configurable callbacks, and goroutine entry points. Their behaviour at runtime is deterministic once you understand funcvals and capture. The most common bugs are mutable-state-shared-across-goroutines, defer-in-loops, and stale captured configs; the most common performance issues are per-iteration closure allocation in hot paths and closure-prevented inlining. Profile first, refactor with intent, and prefer methods or generics when the closure shape doesn't add value. [optimize.md](optimize.md) drills further into the optimisation playbook.

---

## Further reading

- `sync.Once` source: https://github.com/golang/go/blob/master/src/sync/once.go
- `errgroup` source: https://cs.opensource.google/go/x/sync/+/master:errgroup/errgroup.go
- `net/http` middleware patterns: https://pkg.go.dev/net/http
- Profiling allocations: https://go.dev/doc/diagnostics#profiling
- Sibling: [defer-basics](../09-defer-basics/), [escape-analysis](../../../11-advanced-topics/02-escape-analysis/), [interface-internals](../../../03-methods-and-interfaces/10-interface-internals/)
