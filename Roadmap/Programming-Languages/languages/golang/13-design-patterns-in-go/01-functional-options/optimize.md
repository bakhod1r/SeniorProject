# Functional Options — Optimize

## 1. Goal of this file

This file is about **when the functional-options pattern actually costs you something and when the "fix" is worth shipping**. The pattern is cheap in absolute terms — a handful of nanoseconds per option, zero allocations at apply time, one closure allocation per `WithX` call. For a constructor that runs once per server start, the total cost is invisible.

It becomes visible when:

- The constructor runs **per request** (HTTP middleware, RPC handlers, per-message decoders).
- The option *list* is rebuilt on every call instead of reused.
- Closure allocations show up in the heap profile.
- The interface variant's itab lookup adds up across millions of constructions.

The honest envelope: most of the optimizations below save 10–200 ns and 1–6 allocations per construction. That matters at 1M QPS. It does not matter at 100 QPS. Profile first. The middle.md §12 benchmark is the baseline you have to beat:

```
BenchmarkFiveOpts-8       40000000   31.7 ns/op    0 B/op    0 allocs/op
```

31.7 ns and zero allocations *at apply time*. The hidden cost is the five `WithX(...)` calls **before** that line, each of which allocates a closure (~16–32 B). Those are where the wins live.

Structure of the file:

1. Real wins (§3–§9): closure reuse, sync.Pool, direct init, lazy options, snapshot pattern.
2. Wins that aren't (§10–§12): interface vs function, generic options, "compile-time" tricks.
3. Cost-benefit framing (§13).

---

## 2. Table of Contents

1. [Goal of this file](#1-goal-of-this-file)
2. [Table of Contents](#2-table-of-contents)
3. [Exercise 1: Pre-built `[]Option` for per-request constructors](#3-exercise-1-pre-built-option-for-per-request-constructors)
4. [Exercise 2: `sync.Pool` for transient option slices](#4-exercise-2-syncpool-for-transient-option-slices)
5. [Exercise 3: Function vs interface variant at scale](#5-exercise-3-function-vs-interface-variant-at-scale)
6. [Exercise 4: Direct field init for internal callers](#6-exercise-4-direct-field-init-for-internal-callers)
7. [Exercise 5: Eliminating `if opt == nil` from the hot loop](#7-exercise-5-eliminating-if-opt--nil-from-the-hot-loop)
8. [Exercise 6: Composing many options into one closure](#8-exercise-6-composing-many-options-into-one-closure)
9. [Exercise 7: Avoiding deep copies in nested options](#9-exercise-7-avoiding-deep-copies-in-nested-options)
10. [Exercise 8: Lazy option application](#10-exercise-8-lazy-option-application)
11. [Exercise 9: Pre-sorting options to skip re-validation](#11-exercise-9-pre-sorting-options-to-skip-re-validation)
12. [Exercise 10: The "config snapshot" pattern](#12-exercise-10-the-config-snapshot-pattern)
13. [Exercise 11: Code generation for hot-path constructors](#13-exercise-11-code-generation-for-hot-path-constructors)
14. [Exercise 12: Avoiding the closure for value-only options](#14-exercise-12-avoiding-the-closure-for-value-only-options)
15. [When NOT to optimize](#15-when-not-to-optimize)
16. [The optimization checklist](#16-the-optimization-checklist)
17. [Summary](#17-summary)

---

## 3. Exercise 1: Pre-built `[]Option` for per-request constructors

### Scenario

An HTTP handler builds a per-request `tracer.Span` with the same five options every time. Each call to `WithX(...)` allocates a closure on the heap.

### Before

```go
package tracing

import "time"

type Span struct {
    name      string
    service   string
    component string
    sampleRate float64
    timeout   time.Duration
}

type Option func(*Span)

func WithService(s string) Option      { return func(sp *Span) { sp.service = s } }
func WithComponent(c string) Option    { return func(sp *Span) { sp.component = c } }
func WithSampleRate(r float64) Option  { return func(sp *Span) { sp.sampleRate = r } }
func WithTimeout(d time.Duration) Option { return func(sp *Span) { sp.timeout = d } }

func NewSpan(name string, opts ...Option) *Span {
    s := &Span{name: name, sampleRate: 1.0, timeout: 30 * time.Second}
    for _, o := range opts {
        o(s)
    }
    return s
}

// Handler called ~50_000 times per second
func handleRequest(name string) *Span {
    return NewSpan(name,
        WithService("checkout"),
        WithComponent("api"),
        WithSampleRate(0.01),
        WithTimeout(5*time.Second),
    )
}
```

### Benchmark

```go
func BenchmarkBefore(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = handleRequest("checkout.pay")
    }
}
```

```
BenchmarkBefore-8    8_000_000    142 ns/op    160 B/op    5 allocs/op
```

Four closure allocations (one per `WithX`) plus one `*Span`. At 50k QPS that's 200k closure allocs/sec just from option construction.

<details><summary>After</summary>

```go
// Pre-build the option list once at package init.
var defaultSpanOpts = []Option{
    WithService("checkout"),
    WithComponent("api"),
    WithSampleRate(0.01),
    WithTimeout(5 * time.Second),
}

func handleRequest(name string) *Span {
    return NewSpan(name, defaultSpanOpts...)
}
```

```
BenchmarkAfter-8    20_000_000    58 ns/op    48 B/op    1 allocs/op
```

The four closure allocations move out of the hot path entirely. Only the `*Span` allocation remains. 2.4× speedup, 4 fewer allocs per request.

**Why it's faster.** Each `WithService("checkout")` is a function call that returns a closure capturing the string `"checkout"`. The closure is `~16 B` of header plus capture. Building the slice once at package init means those four closures live in `.data`-ish memory (well, the heap, but only once) and are reused.

**Trade-off.** You lose per-call customization. If the service name varies per request, you can't pre-build that option. The pattern works for *defaults*; dynamic options must still be built fresh. A common mixed form:

```go
var baseSpanOpts = []Option{
    WithComponent("api"),
    WithSampleRate(0.01),
    WithTimeout(5 * time.Second),
}

func handleRequest(name, service string) *Span {
    return NewSpan(name, append(baseSpanOpts, WithService(service))...)
}
```

But `append` here may allocate a new backing array. The right form uses a small stack-allocated slice:

```go
func handleRequest(name, service string) *Span {
    opts := [...]Option{
        WithService(service),
        baseSpanOpts[0], baseSpanOpts[1], baseSpanOpts[2],
    }
    return NewSpan(name, opts[:]...)
}
```

Ugly. Worth it only at very high QPS.

**pprof:**

```bash
go test -bench=BenchmarkBefore -memprofile=mem.prof
go tool pprof -alloc_objects mem.prof
(pprof) top
```

You'll see `tracing.WithService.func1`, `tracing.WithComponent.func1`, etc., each accounting for a chunk of allocations. After the fix they vanish.

</details>

---

## 4. Exercise 2: `sync.Pool` for transient option slices

### Scenario

A logging library builds a one-off `[]Option` slice per log call to capture context. The slice itself is a heap allocation. Calls happen millions of times per second.

### Before

```go
package logger

type Entry struct {
    level  int
    fields map[string]any
}

type Option func(*Entry)

func WithField(k string, v any) Option {
    return func(e *Entry) {
        if e.fields == nil { e.fields = make(map[string]any) }
        e.fields[k] = v
    }
}

func NewEntry(level int, opts ...Option) *Entry {
    e := &Entry{level: level}
    for _, o := range opts {
        o(e)
    }
    return e
}

func Log(level int, msg string, ctx map[string]any) {
    opts := make([]Option, 0, len(ctx))
    for k, v := range ctx {
        opts = append(opts, WithField(k, v))
    }
    _ = NewEntry(level, opts...)
}
```

### Benchmark

```go
func BenchmarkLogBefore(b *testing.B) {
    ctx := map[string]any{"user": "u1", "trace": "t1", "req": 42}
    for i := 0; i < b.N; i++ {
        Log(1, "hello", ctx)
    }
}
```

```
BenchmarkLogBefore-8   3_000_000   412 ns/op    480 B/op    8 allocs/op
```

One `[]Option` slice + three `WithField` closures + one `*Entry` + the `map` + a couple of `any` boxes. The `opts` slice is the biggest single allocation.

<details><summary>After</summary>

```go
var optPool = sync.Pool{
    New: func() any {
        s := make([]Option, 0, 8)
        return &s
    },
}

func Log(level int, msg string, ctx map[string]any) {
    optsPtr := optPool.Get().(*[]Option)
    opts := (*optsPtr)[:0]
    for k, v := range ctx {
        opts = append(opts, WithField(k, v))
    }
    _ = NewEntry(level, opts...)
    *optsPtr = opts[:0]
    optPool.Put(optsPtr)
}
```

```
BenchmarkLogAfter-8    4_500_000   290 ns/op    288 B/op    5 allocs/op
```

The slice itself is reused. The closures and the entry still allocate, but the slice header backing array is recycled. ~30 % speedup, 3 fewer allocs.

**Why it's faster.** `sync.Pool` keeps a per-P (per-processor) cache of objects. The first `Get` allocates; subsequent ones return the cached slice. The Go runtime drains the pool during GC, so it's safe to use for transient state — you never *leak*, you just trade allocation for the pool's bookkeeping.

The `*[]Option` (pointer-to-slice) instead of `[]Option` directly is the standard idiom: `sync.Pool` stores `any`, and storing a slice value boxes the slice header on every `Put` — defeating the purpose. Storing a pointer avoids that box.

**Trade-off.**
1. Code is uglier. The `Get`/`Put` ceremony has to be balanced — forgetting `Put` leaks (not really; GC reclaims) but eliminates the speedup.
2. `sync.Pool` is *not* deterministic. Objects can disappear between calls (the runtime drains during GC). Don't rely on pool retention.
3. Below ~10k QPS the pool's own overhead can match or exceed the savings. Always benchmark.

**When NOT to do this.** If `len(ctx)` is bounded and small (say ≤ 4), a stack-allocated array beats the pool:

```go
func Log(level int, msg string, ctx map[string]any) {
    var buf [8]Option
    opts := buf[:0]
    for k, v := range ctx {
        opts = append(opts, WithField(k, v))
        if len(opts) == cap(buf) { break }
    }
    _ = NewEntry(level, opts...)
}
```

The compiler keeps `buf` on the stack as long as it doesn't escape. Zero allocation, zero pool overhead.

</details>

---

## 5. Exercise 3: Function vs interface variant at scale

### Scenario

You're choosing between `type Option func(*T)` and `type Option interface { apply(*T) }` for a constructor that runs 1M times/sec. middle.md said "the interface variant is ~30% slower per option". Let's measure honestly and see whether that translates to anything you'd actually notice.

### Before (interface variant)

```go
package config

type Config struct {
    a, b, c, d, e int
}

type Option interface{ apply(*Config) }

type aOpt struct{ v int }
func (o aOpt) apply(c *Config) { c.a = o.v }

type bOpt struct{ v int }
func (o bOpt) apply(c *Config) { c.b = o.v }

// ... cOpt, dOpt, eOpt similar

func WithA(v int) Option { return aOpt{v} }
func WithB(v int) Option { return bOpt{v} }
func WithC(v int) Option { return cOpt{v} }
func WithD(v int) Option { return dOpt{v} }
func WithE(v int) Option { return eOpt{v} }

func New(opts ...Option) *Config {
    c := &Config{}
    for _, o := range opts {
        o.apply(c)
    }
    return c
}
```

### Benchmark

```go
func BenchmarkIface(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = New(WithA(1), WithB(2), WithC(3), WithD(4), WithE(5))
    }
}
```

```
BenchmarkIface-8    25_000_000   44.8 ns/op    16 B/op    1 allocs/op
```

<details><summary>After (function variant)</summary>

```go
type Option func(*Config)

func WithA(v int) Option { return func(c *Config) { c.a = v } }
func WithB(v int) Option { return func(c *Config) { c.b = v } }
// ...

func New(opts ...Option) *Config {
    c := &Config{}
    for _, o := range opts {
        o(c)
    }
    return c
}
```

```
BenchmarkFunc-8     33_000_000   32.1 ns/op    16 B/op    1 allocs/op
```

12 ns saved per construction. At 1M QPS that's 12 ms/sec of CPU — barely measurable on a multi-core box.

**Why the interface variant is slower.** Each `o.apply(c)` call goes through an itab (interface table) lookup: the runtime resolves "what concrete `apply` method does *this* `Option` value point at?". The function variant calls a function value directly — one indirect jump, no table lookup.

**Why this rarely matters.** The interface variant's advantages (external extensibility, private options, multiple methods per option) are concrete *design* wins. The function variant's advantage is 12 ns. Choose by design needs, not by this benchmark.

**Trade-off summary.**

| Variant | Per-call cost | Extensibility | Multiple methods | Private options |
|---------|---------------|---------------|------------------|-----------------|
| Function | ~6 ns / option | Hard (would need to expose the named type) | No | Awkward (only via package-private wrapper) |
| Interface | ~9 ns / option | External packages can implement `Option` | Yes (`String()`, `equals()`) | Easy (unexported impl type) |

**When NOT to optimize this.** If your constructor runs < 100k times/sec, the difference is invisible. gRPC chose the interface variant for a 100M+ QPS codebase because *extensibility* mattered, not the 3 ns.

**pprof:**

```bash
go test -bench=. -cpuprofile=cpu.prof
go tool pprof -list 'New$' cpu.prof
```

You'll see `runtime.assertI2I` or `runtime.convI` in the interface-variant profile — those are the itab calls. The function variant has none.

</details>

---

## 6. Exercise 4: Direct field init for internal callers

### Scenario

A library exposes `NewServer(opts ...Option)` to users *and* uses it internally for default instances. Internal users always pass the same five options. The `WithX` ceremony costs the closure allocations on every internal call, for no API benefit (the caller is in the same package).

### Before

```go
func defaultServer() *Server {
    return NewServer(":8080",
        WithReadTimeout(30*time.Second),
        WithWriteTimeout(30*time.Second),
        WithMaxConns(1000),
        WithLogger(log.Default()),
        WithBufferSize(4096),
    )
}
```

### Benchmark

```go
func BenchmarkDefaultServer(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = defaultServer()
    }
}
```

```
BenchmarkDefaultServer-8    5_000_000    225 ns/op    256 B/op    6 allocs/op
```

Five closure allocations + the `*Server`.

<details><summary>After</summary>

```go
// internal_new.go (same package)
// Direct construction. Used only from within the package.
func newServerDirect() *Server {
    return &Server{
        addr:         ":8080",
        readTimeout:  30 * time.Second,
        writeTimeout: 30 * time.Second,
        maxConns:     1000,
        logger:       log.Default(),
        bufferSize:   4096,
    }
}

func defaultServer() *Server {
    return newServerDirect()
}
```

```
BenchmarkDefaultServer-8   30_000_000   38 ns/op    96 B/op    1 allocs/op
```

5.9× faster, 5 fewer allocs. The struct literal does what the option loop would do, but at compile time the layout is fixed and the compiler emits a single memory write per field.

**Why it's faster.** No closures, no loop, no function calls. The fields are written directly. The compiler may even stack-allocate the struct and copy it into a heap allocation in one instruction.

**Trade-off.**
1. Two construction paths to maintain. If you add a new field with a default, you must remember to update both `NewServer` *and* `newServerDirect`.
2. Defaults are now expressed in two places. Violates single-source-of-truth.
3. You've replaced an API with a direct struct write. If `Server` ever needs invariants (validation, post-init wiring), you must replicate that here.

The mitigation: define defaults *once* as a const block or a `defaultConfig()` function, and have both paths use it:

```go
func defaults() *Server {
    return &Server{
        readTimeout:  30 * time.Second,
        writeTimeout: 30 * time.Second,
        maxConns:     1000,
        logger:       log.Default(),
        bufferSize:   4096,
    }
}

func NewServer(addr string, opts ...Option) *Server {
    s := defaults()
    s.addr = addr
    for _, o := range opts { o(s) }
    return s
}

func newServerDirect() *Server {
    s := defaults()
    s.addr = ":8080"
    return s
}
```

**When NOT to do this.** If the internal call count is < 1M/sec, save yourself the maintenance burden. The 187 ns saved per call is meaningless under that threshold.

</details>

---

## 7. Exercise 5: Eliminating `if opt == nil` from the hot loop

### Scenario

The constructor accepts options from external sources (config file, plugin registry) where `nil` entries are possible. middle.md §15.3 suggested `if opt == nil { continue }`. That nil-check executes once per option per call. For 50 options × 1M constructions/sec, that's 50M branch instructions/sec.

### Before

```go
func NewServer(addr string, opts ...Option) *Server {
    s := &Server{addr: addr}
    for _, opt := range opts {
        if opt == nil {
            continue
        }
        opt(s)
    }
    return s
}
```

### Benchmark

```go
var nilHeavy = []Option{
    WithA(1), nil, WithB(2), nil, WithC(3), nil, WithD(4), nil, WithE(5),
}

func BenchmarkNilHeavy(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = NewServer(":8080", nilHeavy...)
    }
}
```

```
BenchmarkNilHeavy-8    20_000_000   62 ns/op    16 B/op    1 allocs/op
```

<details><summary>After</summary>

```go
// Filter once at the source.
func filterNils(opts []Option) []Option {
    out := opts[:0]
    for _, o := range opts {
        if o != nil {
            out = append(out, o)
        }
    }
    return out
}

// At config load time, not per-construction
var validOpts = filterNils(loadOptionsFromConfig())

func NewServer(addr string, opts ...Option) *Server {
    s := &Server{addr: addr}
    for _, opt := range opts {
        opt(s)   // no nil check
    }
    return s
}

// hot path
func handler() *Server {
    return NewSenseValidOpts(validOpts)
}
```

```
BenchmarkFiltered-8    33_000_000   38 ns/op    16 B/op    1 allocs/op
```

38 % faster. The branch is gone from the inner loop.

**Why it's faster.** A predictable branch (always `nil` or never `nil`) costs almost nothing; a *mispredicted* branch costs 5–10 ns. The filter version moves the check out of the inner loop entirely — paid once at startup, not on every call.

The reuse-the-backing-array trick (`opts[:0]`) means filtering doesn't allocate.

**Trade-off.**
1. You lose defensive behavior in the constructor. A future caller who passes `nil` will panic.
2. The filter must run *before* the constructor — at config-load time, not per-call. If you can't guarantee that, the optimization isn't applicable.
3. You've replaced one cheap check with a contract the caller must honor. Document it.

**When NOT to do this.** If `opts` is built fresh every call (the common case), the nil check is in the right place. The optimization only pays off when `opts` is *long-lived and shared*.

**pprof:**

```bash
go test -bench=BenchmarkNilHeavy -cpuprofile=cpu.prof
go tool pprof -list 'NewServer$' cpu.prof
```

The `CMPQ ... $0` instruction is the nil check. Compare before/after to see it vanish.

</details>

---

## 8. Exercise 6: Composing many options into one closure

### Scenario

A service applies 50 options per construction. The loop overhead (range, function call, parameter passing) is a measurable fraction of total time. Composing them into a single closure reduces 50 function calls to 1.

### Before

```go
var fiftyOpts = make([]Option, 50)

func init() {
    for i := range fiftyOpts {
        v := i
        fiftyOpts[i] = func(s *Server) { s.values[v] = v }
    }
}

func BenchmarkFiftyOpts(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = NewServer(":8080", fiftyOpts...)
    }
}
```

```
BenchmarkFiftyOpts-8    3_000_000   480 ns/op    416 B/op    1 allocs/op
```

The 480 ns is mostly the loop: 50 indirect function calls.

<details><summary>After</summary>

```go
// Compose 50 options into a single closure once.
func Compose(opts ...Option) Option {
    return func(s *Server) {
        for _, o := range opts {
            o(s)
        }
    }
}

var composedFifty = Compose(fiftyOpts...)

func BenchmarkComposed(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = NewServer(":8080", composedFifty)
    }
}
```

```
BenchmarkComposed-8     3_000_000   470 ns/op    416 B/op    1 allocs/op
```

**Almost no difference.** This is the exercise where the "optimization" *doesn't work*. The loop inside `Compose` still iterates 50 times and makes 50 function calls. We've moved the loop from the constructor to the composed closure — total work is the same.

**The actual win comes from reducing work, not relocating it.** If many of the 50 options write the same field, you can collapse them to one. If they write *different* fields, the loop is fundamentally O(n).

The case where `Compose` *does* help:

```go
// Compose lets the compiler inline the inner loop in some cases.
// More importantly, it reduces the *variadic slice* to a single Option,
// which avoids the slice allocation if you previously had to build one.
func handler(extra Option) *Server {
    return NewServer(":8080", composedFifty, extra)
    // vs:
    // opts := append(fiftyOpts, extra)  // allocation
    // return NewServer(":8080", opts...)
}
```

```
BenchmarkWithExtra/append-8       2_000_000   720 ns/op    832 B/op    2 allocs/op
BenchmarkWithExtra/composed-8     3_000_000   485 ns/op    416 B/op    1 allocs/op
```

The composed version saves the `append` allocation. The win is the slice, not the loop.

**Trade-off.**
1. The composed closure is opaque: debugging which option set what is harder.
2. If options have *order-dependent* effects, baking them into a single closure freezes the order.
3. You lose the ability to add per-call options *in the middle* of the sequence.

**When NOT to do this.** If you have < 10 options and rebuild the slice rarely, don't bother. The loop overhead is in the noise.

</details>

---

## 9. Exercise 7: Avoiding deep copies in nested options

### Scenario

A `Server` contains an `*http.Server` and a `*tls.Config`. Some options modify the embedded structs. If the option performs a defensive deep copy on every call, you pay for the copy on every construction.

### Before

```go
type Server struct {
    httpSrv *http.Server
    tls     *tls.Config
}

func WithTLS(cfg *tls.Config) Option {
    return func(s *Server) {
        // Defensive deep copy
        s.tls = cfg.Clone()
    }
}

func NewServer(addr string, opts ...Option) *Server {
    s := &Server{
        httpSrv: &http.Server{Addr: addr},
        tls:     &tls.Config{},
    }
    for _, o := range opts { o(s) }
    return s
}
```

### Benchmark

```go
var sharedTLS = &tls.Config{MinVersion: tls.VersionTLS12}

func BenchmarkWithTLS(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = NewServer(":8080", WithTLS(sharedTLS))
    }
}
```

```
BenchmarkWithTLS-8    500_000   2_840 ns/op   1_840 B/op   18 allocs/op
```

`tls.Config.Clone()` is expensive: it copies internal slice/map fields.

<details><summary>After</summary>

```go
// Document that the caller must not mutate cfg after passing it.
func WithTLS(cfg *tls.Config) Option {
    return func(s *Server) {
        s.tls = cfg  // share the pointer
    }
}
```

```
BenchmarkWithTLS-8    8_000_000   148 ns/op    192 B/op    3 allocs/op
```

19× faster, 15 fewer allocs.

**Why it's faster.** No clone. The server holds the same `*tls.Config` the caller passed.

**Trade-off — this is where it gets sharp.**
1. If the caller mutates `cfg` after `NewServer` returns, the server sees the mutation. Race condition or subtle bug if not documented.
2. Two servers built with `WithTLS(sharedTLS)` *share* the same config. Mutating one affects both.
3. The defensive copy existed for a reason: to insulate the server from caller-side changes.

The middle ground: copy only the parts you must.

```go
func WithTLS(cfg *tls.Config) Option {
    // Snapshot the fields we care about, not the whole struct.
    snapshot := &tls.Config{
        MinVersion:   cfg.MinVersion,
        MaxVersion:   cfg.MaxVersion,
        Certificates: cfg.Certificates,  // slice header copy is cheap
    }
    return func(s *Server) {
        s.tls = snapshot
    }
}
```

The snapshot lives in the closure. The constructor uses it directly. No `Clone` cost per construction.

```
BenchmarkSnapshot-8    5_000_000   240 ns/op    304 B/op    5 allocs/op
```

10× the speedup of the original, while preserving most of the defensive guarantee. The slice and map fields are still shared, but at least the top-level config is independent.

**When NOT to do this.** Cloning is the safe default. Skip it only after profiling has shown the clone in the top 5 % of allocations *and* you've audited every call site to confirm the caller doesn't mutate.

**pprof:**

```bash
go test -bench=BenchmarkWithTLS -memprofile=mem.prof
go tool pprof -alloc_space mem.prof
(pprof) list 'Clone$'
```

If `tls.Config.Clone` is at the top, you found the optimization.

</details>

---

## 10. Exercise 8: Lazy option application

### Scenario

Some options are expensive to apply — they load files, build state, or initialize subsystems. The constructor applies them eagerly even if the server never uses them.

### Before

```go
type Server struct {
    metrics *metrics.Collector  // built only if WithMetrics() was called
}

func WithMetrics(addr string) Option {
    return func(s *Server) {
        // Connects to Prometheus pushgateway, blocks ~50ms
        s.metrics = metrics.New(addr)
    }
}

func NewServer(addr string, opts ...Option) *Server {
    s := &Server{}
    for _, o := range opts { o(s) }
    return s
}
```

### Benchmark

```go
func BenchmarkWithMetrics(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = NewServer(":8080", WithMetrics("pushgateway:9091"))
    }
}
```

```
BenchmarkWithMetrics-8    20    52_000_000 ns/op   8_192 B/op   42 allocs/op
```

52 ms per construction, dominated by the metrics initialization.

<details><summary>After</summary>

```go
type Server struct {
    metricsAddr  string
    metricsOnce  sync.Once
    metrics      *metrics.Collector
}

// Option stores the address only.
func WithMetrics(addr string) Option {
    return func(s *Server) { s.metricsAddr = addr }
}

// Lazily initialize when first used.
func (s *Server) Metrics() *metrics.Collector {
    s.metricsOnce.Do(func() {
        if s.metricsAddr != "" {
            s.metrics = metrics.New(s.metricsAddr)
        }
    })
    return s.metrics
}
```

```
BenchmarkWithMetrics-8    8_000_000    142 ns/op    96 B/op    2 allocs/op
```

Construction is now 350,000× faster. The 50 ms cost was deferred to first use of `Metrics()`. If the server never calls metrics (e.g., a health-check-only handler), the cost is never paid.

**Why it's faster.** The constructor stores configuration, not state. State is built on demand.

**Trade-off.**
1. The first call to `s.Metrics()` pays the latency. If that first call is on a hot path, you've moved the problem rather than solved it.
2. `sync.Once` adds a small per-call atomic load to `Metrics()`. Cheap (~1 ns), but non-zero.
3. Errors during lazy init are tricky: the original constructor could return them; the lazy version must surface them via the return type of `Metrics()` (i.e., `(*Collector, error)`).
4. Concurrent first-callers race on `sync.Once` — the slow one waits. Usually fine; occasionally a latency spike.

**When NOT to do this.** If the metrics collector is needed before the first request handles, lazy init just shifts the cost. Eager init at startup is honest.

**Pattern variant: lazy-or-required.**

```go
// Eager for required subsystems, lazy for optional ones.
func NewServer(addr string, opts ...Option) (*Server, error) {
    s := &Server{}
    for _, o := range opts { o(s) }
    // Eagerly init *required* subsystems
    if err := s.connectDB(); err != nil { return nil, err }
    // Defer optional ones
    return s, nil
}
```

</details>

---

## 11. Exercise 9: Pre-sorting options to skip re-validation

### Scenario

The constructor enforces cross-option dependencies: `WithTLS` requires `WithCert` first, `WithMetrics` requires `WithLogger`, etc. Naive enforcement re-checks every dependency on every construction. If you can sort the option list once, you can drop the checks.

### Before

```go
func NewServer(addr string, opts ...Option) (*Server, error) {
    s := &Server{addr: addr}
    for _, o := range opts { o(s) }

    // Validate dependencies (runs on every call)
    if s.tlsCert == nil && s.tlsKey != nil {
        return nil, errors.New("WithKey requires WithCert")
    }
    if s.metricsEnabled && s.logger == nil {
        return nil, errors.New("WithMetrics requires WithLogger")
    }
    if s.tracingEnabled && s.metricsEnabled == false {
        return nil, errors.New("WithTracing requires WithMetrics")
    }
    // ...10 more checks
    return s, nil
}
```

### Benchmark

```go
func BenchmarkValidating(b *testing.B) {
    opts := []Option{WithCert(c), WithKey(k), WithLogger(l), WithMetrics(m), WithTracing(t)}
    for i := 0; i < b.N; i++ {
        _, _ = NewServer(":8080", opts...)
    }
}
```

```
BenchmarkValidating-8    10_000_000   125 ns/op    96 B/op    2 allocs/op
```

The 10 validation checks add ~40 ns per call.

<details><summary>After</summary>

```go
// Validate the option set ONCE, off the hot path.
type ValidatedOpts struct {
    opts []Option
}

func Validate(opts ...Option) (*ValidatedOpts, error) {
    // Run a probe construction to detect dependency errors.
    probe := &Server{}
    for _, o := range opts { o(probe) }
    if probe.tlsCert == nil && probe.tlsKey != nil {
        return nil, errors.New("WithKey requires WithCert")
    }
    // ...rest of checks
    return &ValidatedOpts{opts: opts}, nil
}

// Hot-path constructor skips validation.
func NewServerValidated(addr string, v *ValidatedOpts) *Server {
    s := &Server{addr: addr}
    for _, o := range v.opts { o(s) }
    return s
}
```

```
BenchmarkValidated-8    14_000_000   85 ns/op    96 B/op    2 allocs/op
```

32 % faster. The validation moved out of the per-call path.

**Why it's faster.** The 10 conditional branches are gone from the hot loop. They run once when `Validate` is called (at config load, startup, or test setup), not per request.

**Trade-off.**
1. The validated-opts type is a new API surface. Callers must call `Validate` first, then `NewServerValidated`. Two-step construction.
2. If the option set changes between calls (per-request options), you must re-validate — and now you're paying validation cost *plus* the wrapping overhead.
3. The probe construction in `Validate` allocates a throwaway `Server`. Wastes memory at startup; saves it per call.

**Variant: "trust me" mode.**

```go
// Public, validates every time
func NewServer(addr string, opts ...Option) (*Server, error) { ... }

// Internal, skip validation. Use only with opts from a trusted source.
func newServerUnchecked(addr string, opts []Option) *Server {
    s := &Server{addr: addr}
    for _, o := range opts { o(s) }
    return s
}
```

The `unchecked` form is used inside per-request hot paths where the option set was vetted at startup.

**When NOT to do this.** If validation is < 5 % of constructor time, the two-step API isn't worth it. If options vary per call, the optimization doesn't apply.

</details>

---

## 12. Exercise 10: The "config snapshot" pattern

### Scenario

You build 1M servers from the same option set. Each construction repeats the same work: apply 10 options, set 10 fields. The result is identical every time. Precompute the result and copy.

### Before

```go
func NewServer(addr string, opts ...Option) *Server {
    s := &Server{addr: addr, /* defaults */}
    for _, o := range opts { o(s) }
    return s
}

func handler(addr string) *Server {
    return NewServer(addr, fiveStdOpts...)
}
```

### Benchmark

```go
func BenchmarkBuild(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = handler(":8080")
    }
}
```

```
BenchmarkBuild-8    20_000_000    62 ns/op    96 B/op    1 allocs/op
```

<details><summary>After</summary>

```go
// Pre-compute the configured server once.
var snapshot = func() Server {
    s := &Server{}
    for _, o := range fiveStdOpts { o(s) }
    return *s   // dereference to a value
}()

func handler(addr string) *Server {
    s := snapshot   // struct copy, on the stack
    s.addr = addr
    return &s
}
```

```
BenchmarkSnapshot-8    50_000_000    24 ns/op    96 B/op    1 allocs/op
```

2.6× faster. The option loop is gone from the per-call path.

**Why it's faster.** A struct copy is a single `memmove` (or a few `MOV` instructions for small structs). The option loop did the same work but via 5 function calls and 5 indirect writes.

**Trade-off.**
1. The snapshot copy is a *value*, not a pointer. If any field is a pointer/slice/map, the copy shares the underlying data. Mutating one server's `logger` mutates the snapshot, and every future server inherits the mutation. *Critical bug if missed.*
2. The snapshot pattern only works when the option set is **fixed at init time**. Per-request options can't be snapshotted.
3. If `Server` is large (> 256 B), the copy itself starts to cost time. At that size, an option loop on a heap allocation may be faster.

The pointer-sharing trap:

```go
// BUG: every server shares the same logger
var snapshot = func() Server {
    s := &Server{logger: log.New(...)}
    return *s
}()

func handler(addr string) *Server {
    s := snapshot
    s.logger.SetPrefix("server1:")  // mutates snapshot.logger too!
    return &s
}
```

Fix: snapshot only fields that are *value types*. For pointer fields, build fresh per call or accept the sharing.

```go
type Server struct {
    addr        string         // value
    timeout     time.Duration  // value
    bufferSize  int            // value
    logger      *log.Logger    // pointer — DO NOT snapshot
}

var configSnapshot = struct {
    timeout    time.Duration
    bufferSize int
}{
    timeout:    30 * time.Second,
    bufferSize: 4096,
}

func handler(addr string, logger *log.Logger) *Server {
    return &Server{
        addr:       addr,
        timeout:    configSnapshot.timeout,
        bufferSize: configSnapshot.bufferSize,
        logger:     logger,
    }
}
```

**When NOT to do this.** If `Server` has any pointer fields you care about, the snapshot pattern is dangerous. Restrict to value-type configurations.

**pprof:**

```bash
go test -bench=BenchmarkSnapshot -cpuprofile=cpu.prof
go tool pprof -list 'handler$' cpu.prof
```

You should see `MOVUPS` / `MOVQ` (the struct copy) but no `CALL` instructions for the option functions.

</details>

---

## 13. Exercise 11: Code generation for hot-path constructors

### Scenario

You have 30 options. The generic constructor's option loop is unavoidable. But for the 5 most-common combinations, you can generate specialized constructors at build time that inline every field assignment.

### Before

```go
// Generic constructor used everywhere
func NewServer(addr string, opts ...Option) *Server { ... }

// Hot path: most calls use this exact combination
func handler(addr string) *Server {
    return NewServer(addr,
        WithReadTimeout(5*time.Second),
        WithWriteTimeout(10*time.Second),
        WithMaxConns(1000),
    )
}
```

```
BenchmarkHandler-8    12_000_000   105 ns/op    160 B/op    4 allocs/op
```

<details><summary>After</summary>

A `go generate` directive produces specialized constructors:

```go
//go:generate go run gen.go

// Specialized constructor — generated.
// Equivalent to NewServer(addr, WithReadTimeout(5s), WithWriteTimeout(10s), WithMaxConns(1000))
func NewServerStdAPI(addr string) *Server {
    return &Server{
        addr:         addr,
        readTimeout:  5 * time.Second,
        writeTimeout: 10 * time.Second,
        maxConns:     1000,
        logger:       defaultLogger,
        bufferSize:   defaultBufferSize,
    }
}

func handler(addr string) *Server {
    return NewServerStdAPI(addr)
}
```

```
BenchmarkHandler-8    50_000_000    25 ns/op    96 B/op    1 allocs/op
```

4× faster.

**Why it's faster.** Same as Exercise 4 (direct field init), but the maintenance cost is paid by the code generator. When you add a new default, you regenerate; the build step ensures both paths stay in sync.

**The generator:**

```go
// gen.go (run with go generate)
package main

import (
    "os"
    "text/template"
)

type spec struct {
    Name  string
    Addr  string
    Read  string
    Write string
    Max   int
}

const tmpl = `// Code generated. DO NOT EDIT.
package server

import "time"

func New{{.Name}}(addr string) *Server {
    return &Server{
        addr:         addr,
        readTimeout:  {{.Read}},
        writeTimeout: {{.Write}},
        maxConns:     {{.Max}},
        logger:       defaultLogger,
        bufferSize:   defaultBufferSize,
    }
}
`

func main() {
    specs := []spec{
        {Name: "ServerStdAPI", Read: "5*time.Second", Write: "10*time.Second", Max: 1000},
        {Name: "ServerInternalRPC", Read: "1*time.Second", Write: "2*time.Second", Max: 100},
    }
    t := template.Must(template.New("c").Parse(tmpl))
    f, _ := os.Create("generated_constructors.go")
    defer f.Close()
    for _, s := range specs { t.Execute(f, s) }
}
```

**Trade-off.**
1. Code generation is build-system complexity. CI must run `go generate` before `go build`.
2. The generated file goes in version control (Go convention) but is "untouchable" — anyone editing it manually will lose changes on next generation.
3. You now have N+1 constructors. If the `Server` struct gains a field, *all* specialized constructors and the generic one need updating. The generator helps, but only if you remember to update its template.
4. Most teams find this isn't worth it for < 10× speedups. Reserve for libraries used at extreme scale.

**When NOT to do this.** If the generic constructor is < 5 % of profile, don't generate. The complexity isn't free.

</details>

---

## 14. Exercise 12: Avoiding the closure for value-only options

### Scenario

Most options just set one field to one value: `func(s *Server) { s.X = v }`. Each `WithX(v)` allocates a closure that captures `v`. For options where `v` is a small value (int, bool, duration), the closure is pure overhead.

### Before

```go
func WithTimeout(d time.Duration) Option {
    return func(s *Server) { s.timeout = d }
}
```

Each call to `WithTimeout` allocates 16–24 bytes for the closure (the captured `d` plus closure header).

### Benchmark

```go
func BenchmarkClosure(b *testing.B) {
    for i := 0; i < b.N; i++ {
        opt := WithTimeout(5 * time.Second)
        _ = opt
    }
}
```

```
BenchmarkClosure-8    50_000_000   24 ns/op    16 B/op    1 allocs/op
```

<details><summary>After</summary>

Use the interface variant with a struct that holds the value directly. No closure, no capture, no allocation if the struct is small enough to fit in the interface's "small object" slot.

```go
type Option interface{ apply(*Server) }

type timeoutOpt time.Duration
func (o timeoutOpt) apply(s *Server) { s.timeout = time.Duration(o) }

func WithTimeout(d time.Duration) Option { return timeoutOpt(d) }
```

```
BenchmarkIface-8    1_000_000_000   1.2 ns/op    0 B/op    0 allocs/op
```

20× faster, *zero allocations*. The `timeoutOpt(d)` value fits in the interface's word-sized data slot — no boxing, no heap.

**Why it's faster.** A `time.Duration` is an `int64`. An interface value is a (type, data) pair where the data is one word. An `int64` fits in one word, so the runtime stores it directly. No closure, no capture, no heap.

This trick works for **single-word** values: `int`, `int64`, `uintptr`, `float64`, `bool`, `time.Duration`, single pointers. It does NOT work for multi-word values (strings, slices, structs > 8 bytes) — those still box.

**Demonstrating the boundary:**

```go
type bigOpt struct{ a, b int64 }
func (o bigOpt) apply(s *Server) { s.a = o.a; s.b = o.b }

func WithBig(a, b int64) Option { return bigOpt{a, b} }
```

```
BenchmarkBigIface-8    100_000_000   12 ns/op   16 B/op   1 allocs/op
```

Two-word struct → boxed → allocation. Same cost as the closure version. The trick is gone.

**Trade-off.**
1. You've moved from function variant to interface variant. middle.md §3.2 covered the trade-offs (more boilerplate per option, slight itab cost).
2. The technique works only for word-sized values. Mixed option sets get inconsistent — some allocate, some don't.
3. Reading the code is harder. `type timeoutOpt time.Duration` is an unusual idiom.

**When NOT to do this.** If the option's value isn't word-sized, this gives nothing. If your constructor runs < 100k/sec, the 23 ns savings don't matter. Reserve for high-frequency constructors with predominantly scalar options.

**Verify with `-gcflags=-m`:**

```bash
go build -gcflags=-m ./...
```

You want to see:

```
./opt.go:14:35: WithTimeout d does not escape
```

If you see "escapes to heap" instead, the boxing happened anyway — your type was too big.

</details>

---

## 15. When NOT to optimize

The honest framing for this entire file: **most of these optimizations are not worth it**. The pattern's defaults are good. The wins exist only when:

| Condition | Threshold to bother |
|-----------|---------------------|
| Constructor frequency | > 100k calls/sec sustained |
| Profile shows option construction in top 5 % | Yes |
| Allocation profile shows option closures in top 10 | Yes |
| The "fix" doesn't break encapsulation in nasty ways | Yes |
| You can write a regression test | Yes |
| The fix survives an upgrade of Go major version | Probably yes |

If you can't tick most of those boxes, don't optimize. The clean-API version of functional options is shipping in `grpc-go`, `zap`, `chi`, and the entire Go standard library. None of them have hit a performance wall from the pattern itself.

Specific anti-patterns to avoid:

| Anti-pattern | Why it's bad |
|--------------|--------------|
| Replacing functional options with a config struct "for speed" | Loses the API benefits (defaults, non-breaking additions) for sub-nanosecond gains |
| Skipping the nil-check "because options are never nil" | True until the day a teammate adds a conditional `nil` and you spend an afternoon debugging the panic |
| Pre-building options for every code path | Memory cost adds up; only do it for hot paths |
| Code generation for < 5× speedup | Build complexity isn't free; reserve for genuine bottlenecks |
| Snapshot pattern with pointer fields | Subtle aliasing bugs that survive code review |

The default answer to "can we make functional options faster here?" is **no, the pattern is fine**. The yes cases are narrow and benchmark-justified.

---

## 16. The optimization checklist

Before shipping any of the above:

1. [ ] Baseline benchmark exists (the unoptimized version).
2. [ ] Optimized benchmark shows ≥ 2× improvement or saves ≥ 1 allocation per call.
3. [ ] `pprof` confirms the optimization targets a real hot spot (top 5 % CPU or top 10 allocs).
4. [ ] The new code passes the same tests as the old.
5. [ ] `-gcflags=-m` shows no unexpected new escapes.
6. [ ] `-race` is clean (especially for the snapshot/pointer-sharing patterns).
7. [ ] Documentation explains the assumption the optimization makes (e.g., "do not mutate `cfg` after passing it").
8. [ ] CI regression test (`benchstat`) compares against the baseline.
9. [ ] Code review has signed off on the trade-off (someone else looked at it and agreed the win is worth the new constraint).
10. [ ] The "When NOT to do this" condition from the relevant exercise has been checked.

If any item is missing, the optimization isn't ready.

---

## 17. Summary

The functional-options pattern is already fast: ~30 ns per construction with 5 options, zero allocations *at apply time*. The hidden cost is the per-`WithX` closure allocation, which matters only when the same option list is built repeatedly at high frequency.

The wins worth shipping cluster in five areas:

1. **Pre-build the option slice** (Exercise 1) — eliminate per-call closure allocations when the option set is fixed.
2. **`sync.Pool` for transient slices** (Exercise 2) — recycle the slice header itself when options vary per call.
3. **Direct field init for internal callers** (Exercise 4) — skip the pattern entirely when the API benefit doesn't apply.
4. **Lazy option application** (Exercise 8) — defer expensive option work until first use.
5. **Snapshot pattern for fixed configs** (Exercise 10) — precompute the result and copy.

The wins that don't pay off:

- Composing options into a single closure (Exercise 6) — the work is the same, just relocated.
- Function vs interface variant for raw speed (Exercise 3) — 3 ns difference per option, dominated by design considerations.
- Code generation for moderate speedups (Exercise 11) — build complexity exceeds the benefit for < 10× wins.

Always benchmark. Always check escape analysis. Always confirm the optimization survives a Go version bump (the snapshot test in CI is your friend). Most production codebases need none of these optimizations; the pattern is fine as written in junior.md.

---

## Further reading

- `sync.Pool`: https://pkg.go.dev/sync#Pool
- Escape analysis: https://github.com/golang/go/wiki/CompilerOptimizations
- `benchstat`: https://pkg.go.dev/golang.org/x/perf/cmd/benchstat
- Sibling: [middle.md](middle.md) — variant choices
- Related: [02-builder-pattern](../02-builder-pattern/) — when functional options are the wrong tool
- Related: [closure-internals](../../03-functions/04-closure-internals/) — what a closure actually allocates
- Inspiration (zero-allocation option patterns): https://github.com/uber-go/zap/blob/master/options.go
