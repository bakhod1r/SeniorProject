# Strategy Pattern — Optimize

## 1. Goal of this file

This file is about **when a naïve strategy is slow or wasteful, and when the fix is worth shipping**. Junior taught the two shapes (interface, function). Middle taught the variants — adapters, registries, composition, testing. Optimize is about the cases where a textbook strategy shows up in a CPU or allocation profile and you have to do something about it.

The honest envelope: most strategies are set once at startup (`NewProcessor(stripeGateway)`), called from request handlers at hundreds to thousands of QPS, and never measured. At those frequencies, the pattern is essentially free — one indirect call, ~1-2 ns of overhead, zero allocations. Nobody notices.

It becomes visible when:

- The strategy is called **per element** in a tight loop (sorting comparators, codec encode/decode per byte chunk).
- The strategy is **constructed per call** via a closure that captures state (`func sortBy(field string) func(...) bool`).
- The strategy is **looked up by name** from a registry on every request instead of resolved once.
- The strategy chain uses **`reflect`** for dispatch instead of type assertion or type switch.
- The strategy needs a **goroutine per call** when a worker pool would do.
- The strategy interface is **wide** with stub implementations on the hot path.

Baseline you need to beat. From middle.md §13:

```
BenchmarkDirectCall-8           1000000000   0.85 ns/op   0 B/op   0 allocs/op
BenchmarkFunctionStrategy-8     1000000000   0.91 ns/op   0 B/op   0 allocs/op
BenchmarkInterfaceStrategy-8     700000000   1.62 ns/op   0 B/op   0 allocs/op
BenchmarkClosureCapture-8        500000000   2.10 ns/op  16 B/op   1 allocs/op
```

A direct call is 0.85 ns. A function strategy is ~1 ns. An interface dispatch adds another ~0.7 ns. A closure that escapes costs one allocation. That's the budget — most optimizations in this file fight for the difference between "1.6 ns and 0 allocs" and "200 ns and 3 allocs", which usually means killing closure captures, reflect, or per-call registry lookups.

Structure of the file:

1. Real wins (§3–§9): pre-built closures, devirtualized dispatch, cached registry lookup, type-switch over reflect, shared mocks, segregated interfaces, flattened decorator chains.
2. Wins that aren't always wins (§10–§14): boot-time strategy slice, direct field access in generics, worker pool over per-call goroutines, type-safe comparators, cached parsed config.
3. Cost-benefit framing (§15).

---

## 2. Table of Contents

1. [Goal of this file](#1-goal-of-this-file)
2. [Table of Contents](#2-table-of-contents)
3. [Exercise 1: Closure capture allocates on every call](#3-exercise-1-closure-capture-allocates-on-every-call)
4. [Exercise 2: Interface dispatch in a hot path](#4-exercise-2-interface-dispatch-in-a-hot-path)
5. [Exercise 3: Registry map lookup on every request](#5-exercise-3-registry-map-lookup-on-every-request)
6. [Exercise 4: Strategy chain calling `reflect` instead of type assertion](#6-exercise-4-strategy-chain-calling-reflect-instead-of-type-assertion)
7. [Exercise 5: Mock strategy allocating per test call](#7-exercise-5-mock-strategy-allocating-per-test-call)
8. [Exercise 6: Wide interface with stub methods](#8-exercise-6-wide-interface-with-stub-methods)
9. [Exercise 7: Decorator chain with deep nesting](#9-exercise-7-decorator-chain-with-deep-nesting)
10. [Exercise 8: Strategy slice rebuilt every request](#10-exercise-8-strategy-slice-rebuilt-every-request)
11. [Exercise 9: Generic strategy with closure-list — replace with direct field access](#11-exercise-9-generic-strategy-with-closure-list--replace-with-direct-field-access)
12. [Exercise 10: Strategy spawning a goroutine per call](#12-exercise-10-strategy-spawning-a-goroutine-per-call)
13. [Exercise 11: Strategy comparison using `reflect.DeepEqual`](#13-exercise-11-strategy-comparison-using-reflectdeepequal)
14. [Exercise 12: JSON-loaded strategy re-reading config every call](#14-exercise-12-json-loaded-strategy-re-reading-config-every-call)
15. [When NOT to optimize](#15-when-not-to-optimize)
16. [The optimization checklist](#16-the-optimization-checklist)
17. [Summary](#17-summary)

---

## 3. Exercise 1: Closure capture allocates on every call

### Scenario

A helper builds a comparator strategy by capturing a `field` argument. The closure is constructed *inside the request handler* and thrown away after the sort. At thousands of sorts per second, each one allocates a fresh closure on the heap.

### Before

```go
package usersort

import (
    "sort"
    "time"
)

type User struct {
    Name      string
    Age       int
    CreatedAt time.Time
}

// lessByField returns a comparator. Each call captures `field` and `items`.
func lessByField(field string, items []User) func(i, j int) bool {
    return func(i, j int) bool {
        switch field {
        case "name":
            return items[i].Name < items[j].Name
        case "age":
            return items[i].Age < items[j].Age
        case "created":
            return items[i].CreatedAt.Before(items[j].CreatedAt)
        }
        return false
    }
}

func SortBy(field string, items []User) {
    sort.Slice(items, lessByField(field, items))
}
```

### Benchmark

```go
func BenchmarkClosureSort(b *testing.B) {
    b.ReportAllocs()
    items := makeUsers(100)
    for i := 0; i < b.N; i++ {
        SortBy("age", items)
    }
}
```

```
BenchmarkClosureSort-8    1_500_000    810 ns/op    48 B/op    2 allocs/op
```

The 48 B / 2 allocs is the closure itself (it captures `field` and `items`, both escape). The closure body's `switch field` runs on every comparison — `n log n` times per sort.

<details><summary>After</summary>

Resolve the field-to-comparator once, *outside* the closure. The comparator captures only `items`, not the string, and skips the per-call switch.

```go
package usersort

import (
    "sort"
    "time"
)

type User struct {
    Name      string
    Age       int
    CreatedAt time.Time
}

// Comparators are package-level — no allocation, no capture of `field`.
// Each takes the slice as argument (not captured).
func lessByName(items []User) func(i, j int) bool {
    return func(i, j int) bool { return items[i].Name < items[j].Name }
}

func lessByAge(items []User) func(i, j int) bool {
    return func(i, j int) bool { return items[i].Age < items[j].Age }
}

func lessByCreated(items []User) func(i, j int) bool {
    return func(i, j int) bool { return items[i].CreatedAt.Before(items[j].CreatedAt) }
}

func SortBy(field string, items []User) {
    var less func(i, j int) bool
    switch field {
    case "name":    less = lessByName(items)
    case "age":     less = lessByAge(items)
    case "created": less = lessByCreated(items)
    default:        return
    }
    sort.Slice(items, less)
}
```

```
BenchmarkResolvedSort-8    2_500_000    485 ns/op    24 B/op    1 allocs/op
```

1.7× faster, one allocation removed.

**Why it's faster.** Two wins. First, the switch runs once per *sort*, not once per *comparison* — for a 100-element sort doing ~664 compares, that's 663 saved switches. Second, the closure now captures only one variable (`items`) instead of two, so the closure environment is half the size — measurable in escape analysis.

Better still: hoist the slice from the closure too, with a method-value pattern.

```go
type byAge []User
func (s byAge) Len() int           { return len(s) }
func (s byAge) Less(i, j int) bool { return s[i].Age < s[j].Age }
func (s byAge) Swap(i, j int)      { s[i], s[j] = s[j], s[i] }

func SortBy(field string, items []User) {
    switch field {
    case "age": sort.Sort(byAge(items))
    // ...
    }
}
```

```
BenchmarkSortInterface-8    3_500_000    345 ns/op    0 B/op    0 allocs/op
```

2.3× faster than the original, zero allocations. The `sort.Interface` type's methods take their receiver by value (it's a slice header — 24 bytes, fits in registers).

**Trade-off.**

1. The original was 6 lines per sort key; the optimized version is 6 lines *per key* repeated for each. Adding a new sort key means writing a new comparator.
2. The `sort.Interface` variant requires a named slice type per sort key — more code for the same logic. It's the right answer when the sort key is stable; overkill when sort keys come from user input.
3. The switch-and-return-nil-on-default in `SortBy` is silent. Add an explicit error or default to maintain robustness.

**When NOT to do this.** If `SortBy` is called once per minute, the 48 B / 800 ns difference is invisible. Keep the original. The optimization pays off only when the sort is on the request path.

**pprof:**

```bash
go test -bench=BenchmarkClosureSort -memprofile=mem.prof
go tool pprof -alloc_objects mem.prof
(pprof) list lessByField
```

The `func(i, j int) bool { ... }` line shows as the allocation source. After hoisting, only the slice-header capture remains.

</details>

---

## 4. Exercise 2: Interface dispatch in a hot path

### Scenario

A bytes pipeline encodes records via an interface. The encoder is set once at startup but called per record. At millions of records per second, the indirect interface call dominates the budget. When the concrete type is known statically, the indirection is pure overhead.

### Before

```go
package encode

type Encoder interface {
    Encode(v int64, out []byte) []byte
}

type Varint struct{}

func (Varint) Encode(v int64, out []byte) []byte {
    uv := uint64(v) << 1
    if v < 0 {
        uv = ^uv
    }
    for uv >= 0x80 {
        out = append(out, byte(uv)|0x80)
        uv >>= 7
    }
    return append(out, byte(uv))
}

type Pipeline struct {
    enc Encoder
}

func NewPipeline(e Encoder) *Pipeline { return &Pipeline{enc: e} }

func (p *Pipeline) EncodeAll(records []int64, out []byte) []byte {
    for _, r := range records {
        out = p.enc.Encode(r, out)
    }
    return out
}
```

### Benchmark

```go
func BenchmarkPipelineEncode(b *testing.B) {
    b.ReportAllocs()
    p := NewPipeline(Varint{})
    records := make([]int64, 1024)
    for i := range records { records[i] = int64(i) }
    out := make([]byte, 0, 4096)
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        out = p.EncodeAll(records, out[:0])
    }
}
```

```
BenchmarkPipelineEncode-8    400_000    2_950 ns/op    0 B/op    0 allocs/op
```

2.9 microseconds per 1024 records — about 2.9 ns per record, almost half of which is the interface dispatch (the encode itself is only ~1.5 ns).

<details><summary>After</summary>

Two paths. The cleanest is to make the pipeline generic over the concrete encoder type. The compiler then specializes the loop with a direct call.

```go
package encode

type Encoder interface {
    Encode(v int64, out []byte) []byte
}

type Varint struct{}

func (Varint) Encode(v int64, out []byte) []byte {
    uv := uint64(v) << 1
    if v < 0 { uv = ^uv }
    for uv >= 0x80 {
        out = append(out, byte(uv)|0x80)
        uv >>= 7
    }
    return append(out, byte(uv))
}

// Generic pipeline — `E` is the concrete encoder type.
type Pipeline[E Encoder] struct {
    enc E
}

func NewPipeline[E Encoder](e E) *Pipeline[E] { return &Pipeline[E]{enc: e} }

func (p *Pipeline[E]) EncodeAll(records []int64, out []byte) []byte {
    for _, r := range records {
        out = p.enc.Encode(r, out)  // direct call, not interface dispatch
    }
    return out
}
```

```
BenchmarkPipelineEncodeGeneric-8    700_000    1_720 ns/op    0 B/op    0 allocs/op
```

1.7× faster. Each `Encode` call is now a direct call to `Varint.Encode`; for small bodies the compiler can even inline it.

**Why it's faster.** Generics in Go 1.18+ produce a per-instantiation specialized function (with the GC shape rules, multiple types sharing the same shape reuse code). For a struct type like `Varint`, the generic `Pipeline[Varint]` is its own function with `p.enc.Encode` compiled as a direct call to `Varint.Encode`. The interface table lookup vanishes.

For an even bigger win, drop the strategy entirely on the hot path and call the function directly:

```go
func (p *Pipeline) EncodeAllVarint(records []int64, out []byte) []byte {
    for _, r := range records {
        out = Varint{}.Encode(r, out)  // direct + inlined
    }
    return out
}
```

```
BenchmarkPipelineEncodeDirect-8    1_000_000    1_180 ns/op    0 B/op    0 allocs/op
```

2.5× faster than the original. The encode body inlines; the loop body becomes a few register operations.

**Alternative with PGO (Go 1.21+):** if you can't or don't want to generic-ize, profile-guided optimization devirtualizes the hot interface call automatically.

```bash
go test -cpuprofile=cpu.pgo -bench=.
go build -pgo=cpu.pgo
```

The compiler reads `cpu.pgo`, sees that `p.enc.Encode` is almost always `Varint.Encode`, and emits a fast-path direct call (with a fallback for other types). Same machine code as the generic version, no source-code change.

**Trade-off.**

1. **Generics specialize the pipeline.** `Pipeline[Varint]` and `Pipeline[Zigzag]` are different types — you can't store them in the same slice. If callers mix encoders dynamically, this doesn't work.
2. **Generics don't always specialize.** For pointer types and interface types, the Go compiler shares a "gcshape" instantiation, which means the interface dispatch returns even inside the generic. The win is real for value-type structs like `Varint{}` and unreliable for `*Varint`.
3. **PGO requires a profile.** You need a representative workload, captured with `cpuprofile` flags, fed back into the next build. CI must produce and consume profiles.
4. **The direct-call variant locks in `Varint`.** No more strategy at all. Adding a second encoder means duplicating `EncodeAllVarint` or going back to the strategy.

**When NOT to do this.** If the encoder is genuinely chosen per call (different rows use different encodings), generics don't help — you're back to interface dispatch. If the pipeline runs 100 records once per HTTP request, the 2 ns/record savings is invisible.

**pprof:**

```bash
go test -bench=BenchmarkPipelineEncode -cpuprofile=cpu.prof
go tool pprof -list 'EncodeAll$' cpu.prof
```

The before profile shows `runtime.assertI2I` (interface conversion) and `runtime.itab` lookups inside the loop. The after profile shows only `Varint.Encode` and the append.

</details>

---

## 5. Exercise 3: Registry map lookup on every request

### Scenario

A codec library uses the registry pattern (middle.md §5): codecs are registered by name in `init()`, and the request handler resolves the codec by name on every request. The map lookup is fast (~30 ns) but unnecessary when the name is stable for a given service.

### Before

```go
package codec

import (
    "fmt"
    "sync"
)

type Codec interface {
    Encode([]byte) []byte
    Decode([]byte) ([]byte, error)
}

var (
    registry   = map[string]Codec{}
    registryMu sync.RWMutex
)

func Register(name string, c Codec) {
    registryMu.Lock()
    defer registryMu.Unlock()
    registry[name] = c
}

func Get(name string) (Codec, error) {
    registryMu.RLock()
    defer registryMu.RUnlock()
    c, ok := registry[name]
    if !ok {
        return nil, fmt.Errorf("codec: unknown %q", name)
    }
    return c, nil
}

// Caller resolves on every request.
func EncodePayload(name string, data []byte) ([]byte, error) {
    c, err := Get(name)
    if err != nil { return nil, err }
    return c.Encode(data), nil
}
```

### Benchmark

```go
func BenchmarkResolveAndEncode(b *testing.B) {
    b.ReportAllocs()
    Register("gzip", gzipCodec{})
    data := []byte("payload")
    for i := 0; i < b.N; i++ {
        _, _ = EncodePayload("gzip", data)
    }
}
```

```
BenchmarkResolveAndEncode-8    20_000_000    62 ns/op    0 B/op    0 allocs/op
```

The encode itself (a stub returning the same slice) is < 5 ns. The remaining 55+ ns is the RWMutex lock, map lookup, and string hashing.

<details><summary>After</summary>

Resolve once at service boot. Cache the `Codec` value in the consumer.

```go
package mysvc

import "myorg/codec"

type Service struct {
    cdc codec.Codec  // resolved once at construction
}

func NewService(codecName string) (*Service, error) {
    c, err := codec.Get(codecName)
    if err != nil { return nil, err }
    return &Service{cdc: c}, nil
}

func (s *Service) EncodePayload(data []byte) []byte {
    return s.cdc.Encode(data)  // no lookup
}
```

```
BenchmarkCachedEncode-8    300_000_000    4 ns/op    0 B/op    0 allocs/op
```

15× faster. The interface dispatch + encode body is the entire cost.

**Why it's faster.** No map hash, no string compare, no read-lock CAS. The strategy is a field access. Once you've resolved the strategy, *you do not throw it away*.

For services that legitimately need to switch codecs per request (rare — usually based on a header), use a *typed cache* keyed by name:

```go
type CodecCache struct {
    cache sync.Map  // map[string]Codec
}

func (c *CodecCache) Encode(name string, data []byte) ([]byte, error) {
    if v, ok := c.cache.Load(name); ok {
        return v.(Codec).Encode(data), nil
    }
    cdc, err := codec.Get(name)
    if err != nil { return nil, err }
    c.cache.Store(name, cdc)
    return cdc.Encode(data), nil
}
```

```
BenchmarkSyncMapEncode-8    50_000_000    24 ns/op    0 B/op    0 allocs/op
```

2.5× faster than the original. `sync.Map.Load` is a single atomic load on the hot path.

**Trade-off.**

1. **Caching shifts the failure mode.** A typo in `codecName` now fails at service construction, not at first use. Usually a *good* shift — fail loud, fail early.
2. **The cached value is captured by reference.** If the registry replaces "gzip" later, the service still uses the old one. For most codec implementations (stateless, immutable) this is fine; for stateful strategies (e.g., a compressor with internal buffers), confirm the implementation is share-safe.
3. **`sync.Map` is optimized for read-heavy patterns with few keys.** Don't use it as a general-purpose map. For high-cardinality lookups (1000s of keys), an `RWMutex` + plain map is often faster.

**When NOT to do this.** If the codec is genuinely dynamic per request *and* the cache hit rate is low (every request has a unique name), neither variant helps — you're paying the lookup either way. That's a sign the strategy is in the wrong place; cache at a higher level.

**pprof:**

```bash
go test -bench=BenchmarkResolveAndEncode -cpuprofile=cpu.prof
go tool pprof -list 'EncodePayload$' cpu.prof
```

Before: `runtime.mapaccess2_faststr`, `sync.(*RWMutex).RLock`, `sync.(*RWMutex).RUnlock` dominate. After: only `Codec.Encode` and the loop overhead remain.

</details>

---

## 6. Exercise 4: Strategy chain calling `reflect` instead of type assertion

### Scenario

A middleware chain inspects whether each strategy implements an optional interface. The naïve version uses `reflect.TypeOf` to check capability — pulling in the reflect package's machinery for a check that a type assertion does in one instruction.

### Before

```go
package middleware

import (
    "context"
    "reflect"
)

type Handler interface {
    Handle(ctx context.Context, req Request) (Response, error)
}

type Cacheable interface {
    CacheKey(req Request) string
}

type Chain struct {
    handlers []Handler
}

// supportsCaching uses reflect — slow.
func supportsCaching(h Handler) bool {
    t := reflect.TypeOf(h)
    cacheableType := reflect.TypeOf((*Cacheable)(nil)).Elem()
    return t.Implements(cacheableType)
}

func (c *Chain) Handle(ctx context.Context, req Request) (Response, error) {
    for _, h := range c.handlers {
        if supportsCaching(h) {
            // do cache lookup
        }
        resp, err := h.Handle(ctx, req)
        if err != nil { return Response{}, err }
        _ = resp
    }
    return Response{}, nil
}
```

### Benchmark

```go
func BenchmarkReflectChain(b *testing.B) {
    b.ReportAllocs()
    c := &Chain{handlers: []Handler{cachingHandler{}, plainHandler{}, plainHandler{}}}
    req := Request{}
    for i := 0; i < b.N; i++ {
        _, _ = c.Handle(context.Background(), req)
    }
}
```

```
BenchmarkReflectChain-8    300_000    4_120 ns/op    288 B/op   12 allocs/op
```

`reflect.Type.Implements` does method-set comparison every call. The 288 B / 12 allocs come from `reflect.Type` value boxing.

<details><summary>After</summary>

Type assertion. One instruction, no allocation, identical semantics.

```go
package middleware

import "context"

type Handler interface {
    Handle(ctx context.Context, req Request) (Response, error)
}

type Cacheable interface {
    CacheKey(req Request) string
}

type Chain struct {
    handlers []Handler
}

func (c *Chain) Handle(ctx context.Context, req Request) (Response, error) {
    for _, h := range c.handlers {
        if ck, ok := h.(Cacheable); ok {
            _ = ck.CacheKey(req)  // direct call via the asserted interface
        }
        resp, err := h.Handle(ctx, req)
        if err != nil { return Response{}, err }
        _ = resp
    }
    return Response{}, nil
}
```

```
BenchmarkAssertChain-8    5_000_000    240 ns/op    0 B/op    0 allocs/op
```

17× faster, zero allocations.

**Why it's faster.** A type assertion (`h.(Cacheable)`) is implemented as a single itab pointer comparison. The runtime caches the result internally — `itab` for `(*cachingHandler, Cacheable)` is built once and reused. `reflect.Type.Implements`, by contrast, walks the method set and allocates intermediate `reflect.Type` values.

**Variant: type switch when there are multiple optional interfaces.**

```go
for _, h := range c.handlers {
    switch v := h.(type) {
    case interface {
        Handler
        Cacheable
        Loggable
    }:
        // implements all three
        v.Log(...)
        _ = v.CacheKey(req)
    case Cacheable:
        _ = v.CacheKey(req)
    case Loggable:
        v.Log(...)
    default:
        // basic handler only
    }
    // ... etc
}
```

The type switch dispatches in O(1) per case via itab lookup.

**Trade-off.**

1. The type-assertion path requires the optional interface to be known *at compile time*. If you genuinely need to discover capabilities at runtime ("does this struct implement an interface with these method names?"), reflect is the only answer.
2. Adding a new optional interface means adding a new type assertion. Adding a new strategy that implements an existing optional interface is free.
3. Type assertions on interface types that wrap a typed-nil panic. `if c, ok := h.(Cacheable); ok && c != nil` is sometimes necessary; for most strategy types it isn't.

**When NOT to do this.** If you're writing a *framework* that doesn't know the optional interfaces ahead of time — e.g., a plugin system where plugins register capabilities by tag — reflect is the unavoidable choice. For application code with a known set of capabilities, type assertion wins.

**pprof:**

```bash
go test -bench=BenchmarkReflectChain -cpuprofile=cpu.prof
go tool pprof -list 'supportsCaching$' cpu.prof
```

`reflect.Type.Implements`, `reflect.implements`, `reflect.specialChannelInfo` (and friends) dominate the before profile. The after profile has none of those — just the itab compare emitted inline.

</details>

---

## 7. Exercise 5: Mock strategy allocating per test call

### Scenario

A test for a per-request handler creates a fresh mock strategy on every iteration. The mock is small but the test does 100k iterations — that's 100k mock allocations the test runner has to garbage-collect, and the benchmark measures GC noise instead of the code being tested.

### Before

```go
package payment_test

import (
    "context"
    "testing"
)

type mockGateway struct {
    chargeCount int
    failureMode bool
}

func (m *mockGateway) Charge(ctx context.Context, amount int, ccy string) (string, error) {
    m.chargeCount++
    if m.failureMode { return "", errSimulated }
    return "mock_123", nil
}

func BenchmarkProcessor(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        g := &mockGateway{}                    // fresh allocation
        p := NewProcessor(g)                   // fresh processor
        _, _ = p.Process(ctx, sampleOrder)
    }
}
```

### Benchmark

```
BenchmarkProcessor-8    3_000_000    420 ns/op    192 B/op    4 allocs/op
```

The processor allocation, the mock allocation, and the order pass-through. The benchmark measures *setup*, not the processor logic.

<details><summary>After</summary>

Reuse the mock and processor across iterations. Reset counter state once per iteration.

```go
func BenchmarkProcessor(b *testing.B) {
    b.ReportAllocs()
    g := &mockGateway{}
    p := NewProcessor(g)
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        _, _ = p.Process(ctx, sampleOrder)
    }
    // chargeCount == b.N now; verify post-loop if needed.
}
```

```
BenchmarkProcessor-8    50_000_000    24 ns/op    0 B/op    0 allocs/op
```

17× faster, zero allocations in the hot path.

**Why it's faster.** The mock and processor live for the entire benchmark, not for each iteration. The `Process` method's actual cost — a nil-amount check, an interface dispatch to `Charge`, a counter increment — is what the benchmark now measures.

**Important: `b.ResetTimer()`.** Without it, the setup time (the two allocations) is amortized into the per-iteration cost, undercounting the per-iteration time when N is small and exaggerating it when N is large. Always reset the timer after setup.

For tests that need fresh state per call (e.g., the mock has a "calls" slice that should be empty at the start of each test), reset the mock instead of replacing it:

```go
func (m *mockGateway) Reset() {
    m.chargeCount = 0
    m.failureMode = false
}

func BenchmarkProcessor(b *testing.B) {
    g := &mockGateway{}
    p := NewProcessor(g)
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        g.Reset()  // cheap
        _, _ = p.Process(ctx, sampleOrder)
    }
}
```

```
BenchmarkProcessorReset-8    35_000_000    32 ns/op    0 B/op    0 allocs/op
```

The Reset is ~8 ns — three field writes — and still 10× faster than re-allocating.

**Trade-off.**

1. **Shared state between iterations.** If the mock accumulates calls and the test asserts on the final count, that count grows with `b.N`. Tests must read `b.N`-relative expectations: `if g.chargeCount != b.N { t.Errorf(...) }`.
2. **Concurrent benchmarks (`b.RunParallel`) need atomic counters.** A naked `int` increment from multiple goroutines is a race.
3. **The mock holds a reference for the whole benchmark.** If it has a `slice` field that grows, you'll OOM on long benchmarks. Reset slices: `m.calls = m.calls[:0]`.

**When NOT to do this.** Real tests (not benchmarks) often *do* want a fresh mock per case for isolation. The "reuse" pattern is specifically for benchmarks measuring per-call cost. For correctness tests, the small allocation is the right answer.

**pprof:**

```bash
go test -bench=BenchmarkProcessor -memprofile=mem.prof
go tool pprof -alloc_objects mem.prof
(pprof) top
```

Before: `mockGateway` and `Processor` dominate allocations. After: zero allocations in the test loop, with only the order's struct-by-value cost (which compiler hoists).

</details>

---

## 8. Exercise 6: Wide interface with stub methods

### Scenario

A storage backend interface has eight methods. The hot path uses one (`Read`). Implementations that don't support the others (e.g., a read-only cache layer) return "not supported" errors. Every type-assertion check the consumer might do for capability detection (middle.md §3) becomes "method exists but returns an error" — an interface dispatch that always fails, in the inner loop.

### Before

```go
package storage

import "errors"

type Storage interface {
    Read(key string) ([]byte, error)
    Write(key string, value []byte) error
    Delete(key string) error
    List(prefix string) ([]string, error)
    Lock(key string) error
    Unlock(key string) error
    Subscribe(prefix string) (<-chan Event, error)
    Stats() Statistics
}

var ErrNotSupported = errors.New("storage: operation not supported")

// ReadOnlyCache supports only Read. The other seven methods stub out.
type ReadOnlyCache struct {
    data map[string][]byte
}

func (c *ReadOnlyCache) Read(key string) ([]byte, error) {
    return c.data[key], nil
}

func (c *ReadOnlyCache) Write(string, []byte) error       { return ErrNotSupported }
func (c *ReadOnlyCache) Delete(string) error              { return ErrNotSupported }
func (c *ReadOnlyCache) List(string) ([]string, error)    { return nil, ErrNotSupported }
func (c *ReadOnlyCache) Lock(string) error                { return ErrNotSupported }
func (c *ReadOnlyCache) Unlock(string) error              { return ErrNotSupported }
func (c *ReadOnlyCache) Subscribe(string) (<-chan Event, error) { return nil, ErrNotSupported }
func (c *ReadOnlyCache) Stats() Statistics                { return Statistics{} }

// Hot loop in the consumer:
func LookupMany(s Storage, keys []string) [][]byte {
    out := make([][]byte, 0, len(keys))
    for _, k := range keys {
        if v, err := s.Read(k); err == nil {
            out = append(out, v)
        }
    }
    return out
}
```

### Benchmark

```go
func BenchmarkLookupMany(b *testing.B) {
    b.ReportAllocs()
    c := &ReadOnlyCache{data: map[string][]byte{"a": {1, 2}, "b": {3, 4}, "c": {5}}}
    keys := []string{"a", "b", "c", "missing", "a", "b"}
    var s Storage = c
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        _ = LookupMany(s, keys)
    }
}
```

```
BenchmarkLookupMany-8    1_500_000    810 ns/op    96 B/op    1 allocs/op
```

810 ns for 6 lookups. The interface dispatch to `Read` costs ~2 ns; the rest is the map lookup, the `len(keys)` allocation, and per-key bookkeeping.

The pain isn't *this* benchmark — it's the *compiler's pessimism*. With eight methods on `Storage`, the compiler can't easily devirtualize even when only `Read` is used. PGO would help; the simpler fix is to narrow the interface.

<details><summary>After</summary>

Segregate the interface. `LookupMany` accepts only a `Reader`. Implementations that don't write don't need to declare `Write`.

```go
package storage

// Reader is what LookupMany needs. Smaller method set.
type Reader interface {
    Read(key string) ([]byte, error)
}

type Writer interface {
    Write(key string, value []byte) error
    Delete(key string) error
}

type Subscriber interface {
    Subscribe(prefix string) (<-chan Event, error)
}

// Storage is the union; implementations declare what they support.
type Storage interface {
    Reader
    Writer
    Subscriber
}

// ReadOnlyCache now satisfies only Reader.
type ReadOnlyCache struct {
    data map[string][]byte
}

func (c *ReadOnlyCache) Read(key string) ([]byte, error) {
    return c.data[key], nil
}

// LookupMany accepts the narrow interface.
func LookupMany(r Reader, keys []string) [][]byte {
    out := make([][]byte, 0, len(keys))
    for _, k := range keys {
        if v, err := r.Read(k); err == nil {
            out = append(out, v)
        }
    }
    return out
}
```

```
BenchmarkLookupManyNarrow-8    2_200_000    560 ns/op    96 B/op    1 allocs/op
```

1.4× faster.

**Why it's faster.** With a one-method interface, Go's compiler can sometimes devirtualize the call (especially with PGO). Even without PGO, the smaller itab is faster to look up: `(*ReadOnlyCache, Reader)`'s itab has one entry; `(*ReadOnlyCache, Storage)`'s has eight. The cache effects are subtle but real on tight loops.

More importantly, the type signatures *document* what's needed. A reader-only cache can satisfy `Reader` without the embarrassment of seven stub methods. Tests that pass a one-method mock don't need to stub the other seven.

```go
// Now this works.
type stubReader struct{}
func (stubReader) Read(string) ([]byte, error) { return nil, nil }

LookupMany(stubReader{}, []string{"x"})  // compiles
```

Before segregation, the test would have needed eight stub methods on the mock.

**Trade-off.**

1. **Three interfaces instead of one.** Code that needs the full surface now writes `Storage = Reader + Writer + Subscriber`, or accepts the broad interface where appropriate. Often clearer; sometimes more verbose.
2. **Refactoring is non-trivial.** Existing call sites need to be updated to use the narrowest interface they need. For internal code this is mechanical; for an exported API it may require a major version bump.
3. **The optimization is *correctness*-driven, not speed-driven.** The performance win is small (~1.5×). The real win is the API: a `ReadOnlyCache` is no longer forced to lie via stub methods.

**When NOT to do this.** If the wide interface is established in your codebase and breaking it requires touching dozens of call sites for a ~1.5× speedup that wasn't on the profile, leave it. Segregate when you're already revisiting the API.

**pprof:**

```bash
go test -bench=BenchmarkLookupMany -cpuprofile=cpu.prof
go tool pprof -list 'LookupMany$' cpu.prof
```

The cost in both profiles is dominated by `runtime.mapaccess1_faststr`. The interface dispatch shows as `runtime.assertI2I` in the wide case; in the narrow case it inlines.

</details>

---

## 9. Exercise 7: Decorator chain with deep nesting

### Scenario

A request handler is wrapped in five decorators: logging, retry, metrics, auth, rate-limit. Each decorator implements the same interface and delegates to its inner. At request time, calling `chain.Handle(...)` does six interface dispatches (one per decorator, plus the terminal). For low-frequency endpoints this is invisible; for hot path RPC interceptors it's measurable.

### Before

```go
package middleware

import (
    "context"
    "log"
    "time"
)

type Handler interface {
    Handle(ctx context.Context, req Request) (Response, error)
}

type LoggingHandler struct {
    Inner Handler
    Log   *log.Logger
}

func (h *LoggingHandler) Handle(ctx context.Context, req Request) (Response, error) {
    start := time.Now()
    resp, err := h.Inner.Handle(ctx, req)
    h.Log.Printf("handle: %s, %v, err=%v", req.Method, time.Since(start), err)
    return resp, err
}

type RetryHandler struct {
    Inner    Handler
    Attempts int
}

func (h *RetryHandler) Handle(ctx context.Context, req Request) (Response, error) {
    var resp Response
    var err error
    for i := 0; i < h.Attempts; i++ {
        resp, err = h.Inner.Handle(ctx, req)
        if err == nil { return resp, nil }
    }
    return resp, err
}

type MetricsHandler struct{ Inner Handler }
type AuthHandler struct{ Inner Handler }
type RateLimitHandler struct{ Inner Handler }
// ... each just wraps and delegates ...

// Build the chain
func BuildChain(terminal Handler) Handler {
    var h Handler = terminal
    h = &LoggingHandler{Inner: h, Log: log.Default()}
    h = &RetryHandler{Inner: h, Attempts: 3}
    h = &MetricsHandler{Inner: h}
    h = &AuthHandler{Inner: h}
    h = &RateLimitHandler{Inner: h}
    return h
}
```

### Benchmark

```go
func BenchmarkChain(b *testing.B) {
    b.ReportAllocs()
    terminal := &terminalHandler{}
    chain := BuildChain(terminal)
    ctx := context.Background()
    req := Request{}
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        _, _ = chain.Handle(ctx, req)
    }
}
```

```
BenchmarkChain-8    1_000_000    1_260 ns/op    256 B/op    8 allocs/op
```

Six interface dispatches plus the per-decorator work (logging allocates a format string, retry allocates the closure for time tracking, etc.).

<details><summary>After</summary>

Two paths. The first — and simpler — is to flatten the chain into one struct.

```go
type FlatHandler struct {
    inner       Handler
    log         *log.Logger
    retryAttempts int
    rateLimit   *RateLimiter
    auth        *Authenticator
    metrics     *MetricsClient
}

func (h *FlatHandler) Handle(ctx context.Context, req Request) (Response, error) {
    // Rate limit
    if !h.rateLimit.Allow() {
        return Response{}, ErrRateLimited
    }
    // Auth
    if err := h.auth.Verify(ctx, req); err != nil {
        return Response{}, err
    }
    // Metrics
    start := time.Now()
    defer func() { h.metrics.Observe(req.Method, time.Since(start)) }()

    // Retry
    var resp Response
    var err error
    for i := 0; i < h.retryAttempts; i++ {
        resp, err = h.inner.Handle(ctx, req)
        if err == nil { break }
    }

    // Logging
    h.log.Printf("handle: %s, err=%v", req.Method, err)
    return resp, err
}
```

```
BenchmarkFlatChain-8    3_500_000    345 ns/op    96 B/op    3 allocs/op
```

3.7× faster, 5 fewer allocations.

**Why it's faster.** One interface dispatch (the terminal handler) instead of six. No retry-closure allocation per call. No per-decorator stack frame.

**Trade-off — and it's a real one.**

1. **You lose composability.** The "decorator" pattern's whole point is that you can mix and match — add retry without touching the rest. Flattening collapses that into a fixed pipeline. Adding a new concern means editing `FlatHandler`.
2. **Test isolation gets harder.** Before, you could test the retry logic alone by composing only `RetryHandler + terminalHandler`. After, retry is intertwined with rate-limit and logging.
3. **The order is hardcoded.** Decorators let you reorder by changing construction. Flattening makes the order a code change.

**A middle-ground: PGO devirtualization.** If you can't flatten because the composition is dynamic, Go 1.21+'s profile-guided optimization devirtualizes hot interface calls. Run the chain under profiling, feed the profile back into the build, and the compiler emits a direct-call fast-path for the most common decorator path.

```bash
go test -cpuprofile=cpu.pgo -bench=BenchmarkChain
go build -pgo=cpu.pgo ./...
```

```
BenchmarkChain-pgo-8    1_500_000    820 ns/op    256 B/op    8 allocs/op
```

1.5× faster than the original, no source change. The allocations stay (they come from the decorator bodies, not the dispatch).

**A different middle-ground: collapse small decorators only.** Keep the *behavior-bearing* decorators (auth, retry) as separate types but inline the *trivial* ones (logging, metrics). The chain shrinks from 6 dispatches to 3-4.

```go
// Logging absorbed into Retry; metrics absorbed into Auth.
h = &AuthMetricsHandler{Inner: h, Auth: a, Metrics: m}
h = &RetryLoggingHandler{Inner: h, Attempts: 3, Log: l}
h = &RateLimitHandler{Inner: h, RL: rl}
```

You trade some composability for less indirection. The result is usually a wash unless the dispatch is genuinely a bottleneck.

**When NOT to do this.** If the chain is built once at startup and called at HTTP-request frequency (1k-10k req/s), the 1 µs cost is invisible. The flattening is only worth it on the hot inner-RPC path (>100k req/s) or in libraries that ship the chain.

**pprof:**

```bash
go test -bench=BenchmarkChain -cpuprofile=cpu.prof
go tool pprof -list 'Handle$' cpu.prof
```

Each decorator's `Handle` shows as a separate frame. The flat version collapses them all into `FlatHandler.Handle`.

</details>

---

## 10. Exercise 8: Strategy slice rebuilt every request

### Scenario

A pricing engine constructs a list of discount strategies per request, even though the list is the same for every request. The construction allocates a `[]Discount`, fills it with three or four strategy values, and discards it after computing the total.

### Before

```go
package pricing

type Discount interface {
    Apply(subtotal int) int
}

type PercentOff struct{ Percent float64 }
func (p PercentOff) Apply(s int) int { return int(float64(s) * p.Percent / 100) }

type FlatOff struct{ Cents int }
func (f FlatOff) Apply(_ int) int { return f.Cents }

type MaxOff struct{ Cents int }
func (m MaxOff) Apply(s int) int {
    if s < m.Cents { return s }
    return m.Cents
}

// Called per request — allocates a fresh slice.
func ComputeTotal(items []Item) int {
    discounts := []Discount{
        PercentOff{Percent: 10},
        FlatOff{Cents: 100},
        MaxOff{Cents: 5000},
    }
    sub := subtotal(items)
    for _, d := range discounts {
        sub -= d.Apply(sub)
    }
    if sub < 0 { sub = 0 }
    return sub
}
```

### Benchmark

```go
func BenchmarkComputeTotal(b *testing.B) {
    b.ReportAllocs()
    items := []Item{{Cents: 1000, Qty: 2}, {Cents: 500, Qty: 3}}
    for i := 0; i < b.N; i++ {
        _ = ComputeTotal(items)
    }
}
```

```
BenchmarkComputeTotal-8    3_500_000    340 ns/op    144 B/op    4 allocs/op
```

144 bytes per call — the slice header, the slice's backing array of three `Discount` interface values (each 16 B), and the boxed concrete types (each escapes when stored in an interface slice).

<details><summary>After</summary>

Build the slice once at package init. Reuse across all calls.

```go
package pricing

var defaultDiscounts = []Discount{
    PercentOff{Percent: 10},
    FlatOff{Cents: 100},
    MaxOff{Cents: 5000},
}

func ComputeTotal(items []Item) int {
    sub := subtotal(items)
    for _, d := range defaultDiscounts {
        sub -= d.Apply(sub)
    }
    if sub < 0 { sub = 0 }
    return sub
}
```

```
BenchmarkComputeTotalCached-8    20_000_000    62 ns/op    0 B/op    0 allocs/op
```

5.5× faster, zero allocations.

**Why it's faster.** The discount slice and its three boxed interface values are allocated once when the package initializes. After that, `ComputeTotal` just iterates a pre-built slice — no heap traffic, no escape, just a loop.

**Trade-off — slight.**

1. **The discounts are now a package-level mutable.** If two callers want different discount lists, one of them has to construct its own. Make it a parameter:

```go
func ComputeTotalWith(items []Item, discounts []Discount) int { /* same loop */ }

func ComputeTotal(items []Item) int {
    return ComputeTotalWith(items, defaultDiscounts)
}
```

2. **The discounts must be stateless.** If `PercentOff.Apply` mutated `PercentOff`, sharing across goroutines is a race. All three discounts in this example are value-receiver structs with no internal state — safe to share.

3. **Init order matters.** If `defaultDiscounts` depends on configuration loaded later, you can't build it at package init. Move it into a constructor that runs after config is loaded.

**Variant: per-tenant discount lists, cached.**

```go
var tenantDiscounts sync.Map // map[tenantID][]Discount

func ComputeTotalForTenant(tenantID string, items []Item) int {
    v, ok := tenantDiscounts.Load(tenantID)
    if !ok {
        // Cold path: build the list, store it, retry.
        list := buildDiscountsForTenant(tenantID)
        v, _ = tenantDiscounts.LoadOrStore(tenantID, list)
    }
    return computeTotalWith(items, v.([]Discount))
}
```

`sync.Map.Load` is a single atomic load. Cold path runs once per tenant.

**When NOT to do this.** If the discount list legitimately varies per call (the customer's chosen promotions, a one-off campaign), there's nothing to cache — the list *is* the per-call input. In that case, accept the slice allocation; it's the price of dynamic configuration.

**pprof:**

```bash
go test -bench=BenchmarkComputeTotal -memprofile=mem.prof
go tool pprof -alloc_objects mem.prof
(pprof) list ComputeTotal
```

Before: the `[]Discount{...}` literal shows as the allocation source — slice + 3 interface boxes. After: zero alloc lines in `ComputeTotal`.

</details>

---

## 11. Exercise 9: Generic strategy with closure-list — replace with direct field access

### Scenario

A generic strategy accumulates "apply" functions in a slice, then runs them in `Build()`. Each `.With(func...)` allocates a closure. For the common case where the strategy is a settings struct with known fields, replacing the closure list with direct field setters eliminates both the closure allocations and the slice growth.

### Before

```go
package strategyx

type Settings[T any] struct {
    apply []func(*T)
}

func New[T any]() *Settings[T] { return &Settings[T]{} }

func (s *Settings[T]) With(f func(*T)) *Settings[T] {
    s.apply = append(s.apply, f)
    return s
}

func (s *Settings[T]) Apply(t *T) {
    for _, f := range s.apply {
        f(t)
    }
}

// Caller
type Compressor struct {
    Level   int
    Concurrency int
    BlockSize int
}

func configureCompressor() *Compressor {
    var c Compressor
    strategyx.New[Compressor]().
        With(func(c *Compressor) { c.Level = 9 }).
        With(func(c *Compressor) { c.Concurrency = 4 }).
        With(func(c *Compressor) { c.BlockSize = 65536 }).
        Apply(&c)
    return &c
}
```

### Benchmark

```go
func BenchmarkClosureStrategy(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        _ = configureCompressor()
    }
}
```

```
BenchmarkClosureStrategy-8    2_000_000    540 ns/op    288 B/op    7 allocs/op
```

Three closures + the slice growth + the `Settings` struct + the final compressor = 7 allocations.

<details><summary>After</summary>

Direct setters on a typed strategy. No generics, no closures.

```go
package compressor

type Settings struct {
    Level       int
    Concurrency int
    BlockSize   int
}

func (s *Settings) WithLevel(l int) *Settings       { s.Level = l; return s }
func (s *Settings) WithConcurrency(n int) *Settings { s.Concurrency = n; return s }
func (s *Settings) WithBlockSize(b int) *Settings   { s.BlockSize = b; return s }

func (s *Settings) Apply(c *Compressor) {
    c.Level = s.Level
    c.Concurrency = s.Concurrency
    c.BlockSize = s.BlockSize
}

// Caller
func configureCompressor() *Compressor {
    var c Compressor
    s := (&Settings{}).
        WithLevel(9).
        WithConcurrency(4).
        WithBlockSize(65536)
    s.Apply(&c)
    return &c
}
```

```
BenchmarkDirectStrategy-8    15_000_000    78 ns/op    64 B/op    2 allocs/op
```

6.9× faster, 5 fewer allocations.

**Why it's faster.** No closures means no closure allocations. No `apply` slice means no slice growth. Just field writes. The `Settings` struct and the final `Compressor` are the only heap allocations.

If you can fold settings directly into the constructor, eliminate the intermediate too:

```go
func NewCompressor(level, concurrency, blockSize int) *Compressor {
    return &Compressor{Level: level, Concurrency: concurrency, BlockSize: blockSize}
}
```

```
BenchmarkDirectConstructor-8    50_000_000    24 ns/op    32 B/op    1 allocs/op
```

22× faster than the original. No builder pattern at all — just a constructor.

**Trade-off.**

1. **You lose genericity.** The closure-list version worked for *any* struct `T`; the direct version is specific to `Compressor`. If you have 50 target structs, you'd write 50 settings types.
2. **You lose extensibility.** Third-party code can't add a new setting without modifying `Settings`. The closure version allowed arbitrary `func(*T)` extensions — including ones the original author didn't anticipate.
3. **API symmetry shifts.** With the closure version, *every* setting is a `With(func...)` call. With direct setters, you have `WithLevel`, `WithConcurrency`, etc. — N methods to maintain.

**When to keep the closure version.** Library authors who don't know the target struct (a "config DSL" framework, a plugin entry point) need the closure-list approach. For application code with finite, known target structs, write direct setters.

**When NOT to do this.** If the constructor is called rarely (once at boot), the 540 ns cost is invisible. If you have a single target struct and the API ergonomics of `WithFoo` is comparable to `With(func...)`, prefer direct — but the speedup itself isn't a reason to refactor existing code.

**pprof:**

```bash
go test -bench=BenchmarkClosureStrategy -memprofile=mem.prof
go tool pprof -alloc_objects mem.prof
(pprof) list 'With$'
```

`func1`, `func2`, `func3` (the anonymous closures) appear as allocation sources. After the rewrite, they vanish.

</details>

---

## 12. Exercise 10: Strategy spawning a goroutine per call

### Scenario

A "concurrent strategy" launches a fresh goroutine for every call, on the theory that the work might block. In practice, the calls don't block much, and goroutine creation (~2 µs in Go 1.22) plus the channel synchronization costs more than the work itself.

### Before

```go
package processor

type Strategy func(item Item) Result

type Processor struct {
    strategy Strategy
}

// Per-call goroutine plus channel for the result.
func (p *Processor) Process(item Item) Result {
    ch := make(chan Result, 1)
    go func() {
        ch <- p.strategy(item)
    }()
    return <-ch
}

func (p *Processor) ProcessAll(items []Item) []Result {
    out := make([]Result, len(items))
    for i, it := range items {
        out[i] = p.Process(it)
    }
    return out
}
```

### Benchmark

```go
func BenchmarkConcurrentStrategy(b *testing.B) {
    b.ReportAllocs()
    strategy := func(i Item) Result { return Result{Value: i.Value * 2} }
    p := &Processor{strategy: strategy}
    items := make([]Item, 100)
    for i := range items { items[i] = Item{Value: i} }
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        _ = p.ProcessAll(items)
    }
}
```

```
BenchmarkConcurrentStrategy-8    3_000    420_000 ns/op    96_800 B/op    300 allocs/op
```

100 items × 100 alloc/item (channel + goroutine stack initial allocation) ≈ 300 allocs. 420 µs to process 100 items that the strategy itself completes in nanoseconds each.

<details><summary>After</summary>

Two paths depending on whether parallelism is actually useful.

**Path A — the strategy doesn't block, so kill the goroutines.**

```go
func (p *Processor) Process(item Item) Result {
    return p.strategy(item)  // direct call
}

func (p *Processor) ProcessAll(items []Item) []Result {
    out := make([]Result, len(items))
    for i, it := range items {
        out[i] = p.strategy(it)
    }
    return out
}
```

```
BenchmarkSequential-8    500_000    2_400 ns/op    800 B/op    1 allocs/op
```

175× faster. One allocation (the output slice).

**Path B — the strategy does block, so a worker pool fans out.**

```go
package processor

import "sync"

type Strategy func(item Item) Result

type Pool struct {
    workers  int
    strategy Strategy
    jobs     chan job
    results  chan result
    wg       sync.WaitGroup
}

type job struct {
    idx  int
    item Item
}
type result struct {
    idx int
    res Result
}

func NewPool(workers int, strategy Strategy) *Pool {
    p := &Pool{
        workers:  workers,
        strategy: strategy,
        jobs:     make(chan job, workers*2),
        results:  make(chan result, workers*2),
    }
    p.wg.Add(workers)
    for i := 0; i < workers; i++ {
        go p.run()
    }
    return p
}

func (p *Pool) run() {
    defer p.wg.Done()
    for j := range p.jobs {
        p.results <- result{idx: j.idx, res: p.strategy(j.item)}
    }
}

func (p *Pool) ProcessAll(items []Item) []Result {
    out := make([]Result, len(items))
    go func() {
        for i, it := range items {
            p.jobs <- job{idx: i, item: it}
        }
    }()
    for i := 0; i < len(items); i++ {
        r := <-p.results
        out[r.idx] = r.res
    }
    return out
}

func (p *Pool) Close() {
    close(p.jobs)
    p.wg.Wait()
}
```

```
BenchmarkPool-8    25_000    48_000 ns/op    1_200 B/op    3 allocs/op
```

8.7× faster than the per-call-goroutine version. For non-blocking strategies, still slower than Path A — the channel sends are not free.

**Why Path A is faster.** A direct call is ~1 ns. A goroutine spawn + channel send + channel recv is ~2-3 µs. For non-blocking work, the goroutine is a 2000× cost amplifier.

**Why Path B is faster than per-call goroutines.** The pool's workers persist; their stacks are allocated once. Channel sends are ~50 ns each (the buffered channel avoids contention until full). The 2 µs per-goroutine spawn cost is amortized over the lifetime of the worker.

**Trade-off.**

1. **Path A is wrong if the strategy blocks.** If `strategy(item)` makes a network call, sequential processing serializes everything. The benchmark is misleading — under real blocking, Path A is slowest.
2. **Path B requires lifecycle management.** Pool must be closed; workers must drain. Forgetting `Close()` leaks goroutines. The pool's worker count is a tuning knob.
3. **Path B's channels add overhead for non-blocking work.** Benchmark against Path A; for CPU-bound work, sequential usually wins.
4. **Result ordering.** The per-call goroutine version returns in original order (it waits for *that* result). The pool version uses an index-tagged result to preserve order. Without the index, results would arrive in arbitrary order.

**When to use which.**

| Strategy work | Best path |
|---------------|-----------|
| CPU-bound, < 100 ns/item | Path A (sequential) |
| CPU-bound, 100 ns – 1 ms/item, many items | Path B (worker pool sized to GOMAXPROCS) |
| I/O-bound (network, disk) | Path B (pool sized larger than GOMAXPROCS) |
| Mixed | Path B with two pools (CPU + I/O) |

**When NOT to do this.** If the input has 1-5 items per call, both paths are wasted complexity. Just call the strategy directly in a `for` loop. The "fan-out" only pays off above ~20 items.

**pprof:**

```bash
go test -bench=BenchmarkConcurrentStrategy -trace=trace.out
go tool trace trace.out
```

The trace shows 100 short-lived goroutines per benchmark iteration, with most of the time spent in `runtime.goschedule` and `runtime.chansend1`. After Path B, the trace shows N stable workers (where N = pool size) processing all items.

</details>

---

## 13. Exercise 11: Strategy comparison using `reflect.DeepEqual`

### Scenario

A test asserts that two strategies are "equal" — same configuration, same wrapped state. The naïve approach uses `reflect.DeepEqual`, which works for any type but is slow because it walks the entire object graph. For high-volume test runs (fuzzing, property tests) the comparison time dominates.

### Before

```go
package strategy

import "reflect"

type Strategy struct {
    Name    string
    Weight  float64
    Tags    []string
    Configs map[string]string
}

func Equal(a, b *Strategy) bool {
    return reflect.DeepEqual(a, b)
}
```

### Benchmark

```go
func BenchmarkReflectEqual(b *testing.B) {
    b.ReportAllocs()
    s1 := &Strategy{
        Name:    "primary",
        Weight:  0.7,
        Tags:    []string{"a", "b", "c"},
        Configs: map[string]string{"x": "1", "y": "2", "z": "3"},
    }
    s2 := &Strategy{
        Name:    "primary",
        Weight:  0.7,
        Tags:    []string{"a", "b", "c"},
        Configs: map[string]string{"x": "1", "y": "2", "z": "3"},
    }
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        _ = Equal(s1, s2)
    }
}
```

```
BenchmarkReflectEqual-8    400_000    2_950 ns/op    432 B/op   18 allocs/op
```

`reflect.DeepEqual` boxes every intermediate value into `reflect.Value` to walk the tree.

<details><summary>After</summary>

Hand-rolled type-safe equality.

```go
func Equal(a, b *Strategy) bool {
    if a == b { return true }
    if a == nil || b == nil { return false }
    if a.Name != b.Name { return false }
    if a.Weight != b.Weight { return false }
    if len(a.Tags) != len(b.Tags) { return false }
    for i := range a.Tags {
        if a.Tags[i] != b.Tags[i] { return false }
    }
    if len(a.Configs) != len(b.Configs) { return false }
    for k, v := range a.Configs {
        if b.Configs[k] != v { return false }
    }
    return true
}
```

```
BenchmarkTypedEqual-8    30_000_000    42 ns/op    0 B/op    0 allocs/op
```

70× faster, zero allocations.

**Why it's faster.** Field-by-field comparison generates straight-line code: integer compares, string compares (pointer + length check first), slice loop, map loop. No reflection, no interface boxing, no type-tag inspection.

**Generic version (Go 1.21+ with `comparable` constraint):**

```go
func equalSliceComparable[T comparable](a, b []T) bool {
    if len(a) != len(b) { return false }
    for i := range a {
        if a[i] != b[i] { return false }
    }
    return true
}

func Equal(a, b *Strategy) bool {
    if a == b { return true }
    if a == nil || b == nil { return false }
    if a.Name != b.Name || a.Weight != b.Weight { return false }
    if !equalSliceComparable(a.Tags, b.Tags) { return false }
    return equalMapComparable(a.Configs, b.Configs)
}
```

The generic helpers reduce duplication. Still ~50 ns/op.

**Trade-off.**

1. **You must maintain it.** Add a field to `Strategy` and forget to update `Equal` — silent wrong-answers in tests. Either generate the comparator (see Exercise 12 in builder/optimize.md) or write an Eq test that itself uses `reflect.DeepEqual` as a baseline:

   ```go
   func TestEqualConsistent(t *testing.T) {
       a, b := randomStrategy(), randomStrategy()
       if Equal(a, b) != reflect.DeepEqual(a, b) {
           t.Errorf("inconsistent")
       }
   }
   ```

   Run this test under fuzzing to catch drift.

2. **Map iteration order is undefined**, so the comparison must be order-independent: iterate one map, look up keys in the other.

3. **NaN, ±0, and other float weirdness.** `0.0 == -0.0` (true), `NaN != NaN` (true — `reflect.DeepEqual` says false). For a Weight field, the typed version's `a.Weight != b.Weight` is more correct than `reflect.DeepEqual`, but you must know what "correct" means in your domain.

**When NOT to do this.** If you only compare strategies in a few tests, the 3 µs cost is invisible. The optimization pays off in:

- Property tests with millions of compares.
- Fuzz tests where the comparator is in the inner loop.
- Production code that uses Strategy equality for memoization (extremely rare).

For ordinary unit tests, `reflect.DeepEqual` is fine.

**Variant: code generation.** Tools like `go-cmp` or custom generators (Exercise 12 in builder/optimize.md) can produce a typed `Equal` per type. Same speed as hand-written, no maintenance drift.

**pprof:**

```bash
go test -bench=BenchmarkReflectEqual -cpuprofile=cpu.prof
go tool pprof -list 'Equal$' cpu.prof
```

`reflect.deepValueEqual`, `reflect.Value.Kind`, and `reflect.Value.UnsafePointer` dominate the before profile. After: only the loop bodies show up.

</details>

---

## 14. Exercise 12: JSON-loaded strategy re-reading config every call

### Scenario

A strategy is configured from a JSON file. The naïve `Apply` re-opens, re-reads, and re-parses the file on every invocation. For a service that processes thousands of items per second, this is thousands of filesystem syscalls and JSON parses per second.

### Before

```go
package pricing

import (
    "encoding/json"
    "os"
)

type DiscountConfig struct {
    Percent     float64 `json:"percent"`
    MaxOff      int     `json:"max_off"`
    EligibleSKUs []string `json:"eligible_skus"`
}

type FileBackedDiscount struct {
    Path string
}

func (d *FileBackedDiscount) Apply(item Item, subtotal int) int {
    data, err := os.ReadFile(d.Path)
    if err != nil { return 0 }
    var cfg DiscountConfig
    if err := json.Unmarshal(data, &cfg); err != nil { return 0 }

    if !contains(cfg.EligibleSKUs, item.SKU) { return 0 }
    off := int(float64(subtotal) * cfg.Percent / 100)
    if off > cfg.MaxOff { off = cfg.MaxOff }
    return off
}

func contains(s []string, x string) bool {
    for _, v := range s { if v == x { return true } }
    return false
}
```

### Benchmark

```go
func BenchmarkFileBackedDiscount(b *testing.B) {
    b.ReportAllocs()
    d := &FileBackedDiscount{Path: "/tmp/discount.json"}
    item := Item{SKU: "ABC", Cents: 1000}
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        _ = d.Apply(item, 5000)
    }
}
```

```
BenchmarkFileBackedDiscount-8    25_000    47_800 ns/op   3_120 B/op   16 allocs/op
```

48 microseconds per call. Most of it is `os.ReadFile` (syscall + buffer alloc) and `json.Unmarshal` (allocation per field, allocation per SKU string).

<details><summary>After</summary>

Parse once at construction. Cache the parsed config in the strategy. Use `atomic.Pointer` if hot-reload is needed.

```go
package pricing

import (
    "encoding/json"
    "os"
    "sync/atomic"
)

type DiscountConfig struct {
    Percent     float64
    MaxOff      int
    EligibleSKUs map[string]struct{}  // O(1) lookup
}

type FileBackedDiscount struct {
    cfg atomic.Pointer[DiscountConfig]
}

func NewFileBackedDiscount(path string) (*FileBackedDiscount, error) {
    d := &FileBackedDiscount{}
    if err := d.reload(path); err != nil { return nil, err }
    return d, nil
}

func (d *FileBackedDiscount) reload(path string) error {
    data, err := os.ReadFile(path)
    if err != nil { return err }
    var raw struct {
        Percent     float64  `json:"percent"`
        MaxOff      int      `json:"max_off"`
        EligibleSKUs []string `json:"eligible_skus"`
    }
    if err := json.Unmarshal(data, &raw); err != nil { return err }

    skus := make(map[string]struct{}, len(raw.EligibleSKUs))
    for _, s := range raw.EligibleSKUs {
        skus[s] = struct{}{}
    }
    d.cfg.Store(&DiscountConfig{
        Percent:      raw.Percent,
        MaxOff:       raw.MaxOff,
        EligibleSKUs: skus,
    })
    return nil
}

func (d *FileBackedDiscount) Apply(item Item, subtotal int) int {
    cfg := d.cfg.Load()
    if cfg == nil { return 0 }
    if _, ok := cfg.EligibleSKUs[item.SKU]; !ok { return 0 }
    off := int(float64(subtotal) * cfg.Percent / 100)
    if off > cfg.MaxOff { off = cfg.MaxOff }
    return off
}
```

```
BenchmarkCachedDiscount-8    300_000_000    4 ns/op    0 B/op    0 allocs/op
```

12,000× faster.

**Why it's faster.** No file read, no JSON parse, no slice scan. One atomic load (the pointer), one map lookup, two integer compares. The benchmark hovers around the cost of the work itself.

The `atomic.Pointer[DiscountConfig]` allows safe concurrent reload — a sidecar can call `reload()` on SIGHUP without locking the hot path.

**Trade-off.**

1. **Initial setup is asynchronous.** `NewFileBackedDiscount` fails if the file is missing. The strategy that worked "if the file appears later" no longer does. Usually a good change — fail at boot, not at first request.
2. **Reloading is on a separate code path.** You need a `Reload()` method or a goroutine that watches the file. Both are extra code.
3. **The `EligibleSKUs` map is allocated on every reload.** For very large SKU lists, this is a cost — but it happens once per reload, not once per request.

**Variant: file watcher for automatic reload.**

```go
func (d *FileBackedDiscount) Watch(path string) {
    // pseudo — use fsnotify in real code
    go func() {
        for range ticker.C {
            d.reload(path)
        }
    }()
}
```

Combined with the atomic pointer, this gives "config changes within a few seconds, no restart".

**A degenerate optimization** — if the config truly never changes after boot, skip the atomic pointer:

```go
type FileBackedDiscount struct {
    cfg DiscountConfig  // immutable after New
}
```

A direct field read is even faster than `atomic.Load`. Use this when you'd rather restart than reload.

**When NOT to do this.** If `Apply` is called once at startup (e.g., to generate a static report), the optimization is unnecessary — read the file once, work, exit. The pattern matters only for repeated calls.

**A trap to avoid: caching the *raw bytes*, not the parsed config.**

```go
// Don't do this.
type CachedDiscount struct {
    rawBytes []byte
}

func (d *CachedDiscount) Apply(item Item, subtotal int) int {
    var cfg DiscountConfig
    json.Unmarshal(d.rawBytes, &cfg)  // STILL parsing every call!
    /* ... */
}
```

This "caches" only the file-read; it leaves the expensive `json.Unmarshal` in the hot path. Cache the *parsed* form.

**pprof:**

```bash
go test -bench=BenchmarkFileBackedDiscount -memprofile=mem.prof
go tool pprof -alloc_space mem.prof
(pprof) top
```

`os.ReadFile`, `json.Unmarshal`, `runtime.makeslice` dominate. After caching, only the initial-load profile shows them; the steady-state profile is empty.

</details>

---

## 15. When NOT to optimize

The honest framing: **most strategies should not be optimized**. The pattern is cheap. The wins exist only when:

| Condition | Threshold to bother |
|-----------|---------------------|
| Strategy call frequency | > 100k calls/sec sustained |
| Profile shows strategy method in top 5 % CPU | Yes |
| Allocation profile shows strategy closures/maps in top 10 | Yes |
| The "fix" doesn't change the public API or break correctness | Yes |
| You can write a regression test | Yes |
| The fix survives a Go version bump | Probably yes |

If you can't tick most of those, don't optimize. The strategies in `crypto/cipher`, `database/sql` drivers, `compress/*`, gRPC interceptors are all "naïve" by the standards of this file — they ship because the simple version is good enough.

Specific anti-patterns to avoid:

| Anti-pattern | Why it's bad |
|--------------|--------------|
| Switching everything to function strategies "for speed" | Loses interface segregation, optional capabilities, and named-type clarity for a sub-nanosecond win |
| Flattening every decorator chain | Loses composability and test isolation for ~1 µs that wasn't on the profile |
| Worker pool for non-blocking strategies | Slower than sequential and adds lifecycle complexity |
| Caching strategy lookup when the name changes per call | Cache misses match or exceed the original cost |
| Hand-rolling `Equal` when you compare twice per run | 70× faster on noise. Wasted code |
| Removing reflect everywhere | Reflect is fine for framework-level discovery; only replace it on the hot path |
| Premature `sync.Pool` for strategy objects | Below ~10k QPS the pool overhead matches the savings |

The default answer to "can we make this strategy faster?" is **no, it's fine**. The yes cases are narrow and benchmark-justified.

---

## 16. The optimization checklist

Before shipping any optimization from this file:

1. [ ] Baseline benchmark exists (the unoptimized strategy).
2. [ ] Optimized benchmark shows ≥ 2× improvement OR saves ≥ 1 allocation per call.
3. [ ] `pprof` confirms the optimization targets a real hot spot (top 5 % CPU or top 10 allocs).
4. [ ] The new code passes the same tests as the old.
5. [ ] `-gcflags=-m` shows no unexpected escapes (especially for closure changes).
6. [ ] `-race` is clean (especially for cached registries, atomic-pointer configs, worker pools).
7. [ ] Documentation explains the assumption the optimization makes ("strategies must be stateless to share", "reload via SIGHUP", "config must exist at boot").
8. [ ] CI regression test (`benchstat`) compares against the baseline.
9. [ ] Code review has signed off on the trade-off (especially for API-shape changes like generics or PGO).
10. [ ] The "When NOT to do this" condition from the relevant exercise has been checked.

If any item is missing, the optimization isn't ready.

---

## 17. Summary

The interface-strategy in Go is already fast: ~1.6 ns and zero allocations per call. Most optimizations in this file save 10-1000 ns and 1-5 allocations. That matters at 100k QPS. It does not matter at 100 QPS.

The wins worth shipping cluster in seven areas:

1. **Resolve registry lookups once, not per call** (Exercise 3) — 15× faster, removes hash + lock from the hot path. Pure win when the strategy name is stable.
2. **Replace `reflect` capability checks with type assertion** (Exercise 4) — 17× faster, no allocation. Pure win when the optional interface is known at compile time.
3. **Pre-build strategy slices at boot** (Exercise 8) — 5× faster, zero alloc. Pure win when the strategy list is stable.
4. **Cache parsed config in the strategy** (Exercise 12) — 12,000× faster when the strategy was re-reading a file. Pure win.
5. **Hoist closure captures outside the hot loop** (Exercise 1) — moves the switch from per-element to per-call. Real win for tight loops.
6. **Replace `reflect.DeepEqual` with hand-rolled equality** (Exercise 11) — 70× faster on millions of compares; not worth it for handful-of-test situations.
7. **Reuse mock strategies in benchmarks** (Exercise 5) — removes setup noise. The benchmark now measures the code being tested.

The wins that don't always pay off:

- **Generics for devirtualization** (Exercise 2) — only when the concrete type is statically known and isn't a pointer.
- **PGO devirtualization** (Exercise 2, 7) — requires a profile-build workflow your CI may not support.
- **Flattening decorator chains** (Exercise 7) — kills composability; only ship when the chain is truly hot and the pattern is stable.
- **Worker pools for "concurrent" strategies** (Exercise 10) — wins only when work is I/O-bound or items are numerous and CPU-bound.
- **Wide-to-narrow interface segregation** (Exercise 6) — small perf win, mainly a correctness/API improvement.
- **Direct setters over closure-list strategies** (Exercise 9) — loses framework-style extensibility.

Always benchmark. Always check `-race`. Always confirm the optimization survives a Go version bump. Most production codebases need none of these optimizations; the pattern is fine as written in junior.md and middle.md.

---

## Further reading

- Go 1.21+ PGO: https://go.dev/doc/pgo
- `sync.Map`: https://pkg.go.dev/sync#Map
- `atomic.Pointer[T]`: https://pkg.go.dev/sync/atomic#Pointer
- Escape analysis: https://github.com/golang/go/wiki/CompilerOptimizations
- `benchstat`: https://pkg.go.dev/golang.org/x/perf/cmd/benchstat
- `go-cmp` (typed equality): https://pkg.go.dev/github.com/google/go-cmp/cmp
- Sibling: [middle.md](middle.md) — variant choices
- Sibling: [junior.md](junior.md) — the baseline shape
- Related: [../02-builder-pattern/optimize.md](../02-builder-pattern/optimize.md) — same file shape for builder
- Related: [../04-decorator-pattern/](../04-decorator-pattern/) — when decorators are themselves the hot path
- Inspiration (zero-allocation strategies): https://github.com/valyala/fasthttp
- Inspiration (interface segregation): `io.Reader`, `io.Writer`, `io.Closer` in stdlib
