# Adapter Pattern — Optimization

## 1. How to use this file

Twelve scenarios where adapter code is slower than it needs to be. Each:

- **Scenario** — the inefficiency.
- **Before** — measured-slow code with realistic benchmark numbers.
- **After** (collapsible) — optimised version with benchmark comparison.
- **Why faster** — what changed at the runtime level.
- **Trade-offs** — what you lose by optimising.
- **When NOT to do this** — the cases where the optimisation isn't worth it.

The honest answer for most adapter "optimisations": they don't matter. Adapters are 1-5 ns of overhead per call. Unless you're handling >100k QPS, the dispatch cost is below the noise. Most optimisations here apply to library code or high-throughput services.

Benchmarks are illustrative — your numbers will differ. The qualitative direction (faster vs slower, allocs vs no allocs) is more important than the absolute ns/op.

Go 1.22, amd64, GOMAXPROCS=8.

---

## 2. Table of Contents

1. [How to use this file](#1-how-to-use-this-file)
2. [Table of Contents](#2-table-of-contents)
3. [Exercise 1 — Adapter constructed inside a hot loop](#exercise-1--adapter-constructed-inside-a-hot-loop)
4. [Exercise 2 — Interface conversion forcing escape](#exercise-2--interface-conversion-forcing-escape)
5. [Exercise 3 — Adapter holding interface instead of concrete pointer](#exercise-3--adapter-holding-interface-instead-of-concrete-pointer)
6. [Exercise 4 — Boxed args in adapter signatures](#exercise-4--boxed-args-in-adapter-signatures)
7. [Exercise 5 — Adapter using reflect for translation](#exercise-5--adapter-using-reflect-for-translation)
8. [Exercise 6 — Lazy init with mutex instead of sync.Once](#exercise-6--lazy-init-with-mutex-instead-of-synconce)
9. [Exercise 7 — Adapter chains that PGO could devirtualize](#exercise-7--adapter-chains-that-pgo-could-devirtualize)
10. [Exercise 8 — Function adapter with pointer receiver](#exercise-8--function-adapter-with-pointer-receiver)
11. [Exercise 9 — Adapter recompiling regex per call](#exercise-9--adapter-recompiling-regex-per-call)
12. [Exercise 10 — fmt.Sprintf in hot path](#exercise-10--fmtsprintf-in-hot-path)
13. [Exercise 11 — Defer in tight adapter](#exercise-11--defer-in-tight-adapter)
14. [Exercise 12 — Adapter using map for static dispatch](#exercise-12--adapter-using-map-for-static-dispatch)
15. [When NOT to optimize](#when-not-to-optimize)
16. [Summary](#summary)

---

## Exercise 1 — Adapter constructed inside a hot loop

**Scenario:** Per-request adapter construction.

**Before:**

```go
func handle(items []Item) {
    for _, item := range items {
        a := &chargerAdapter{Item: item}
        var c Charger = a
        c.Charge(ctx)
    }
}
```

Benchmark:

```
BenchmarkLoopAdapterCreate-8     5000000    240 ns/op    32 B/op    1 allocs/op
```

Every iteration allocates a `chargerAdapter` and an interface wrapper. At 100k iterations, that's 100k allocations of GC pressure.

<details><summary>After</summary>

```go
func handle(items []Item) {
    a := &chargerAdapter{}
    var c Charger = a  // interface conversion once
    for _, item := range items {
        a.Item = item
        c.Charge(ctx)
    }
}
```

```
BenchmarkHoistedAdapter-8       50000000    24 ns/op    0 B/op    0 allocs/op
```

10× speedup, zero allocations.

**Why faster:** One allocation outside the loop instead of N inside. The interface conversion (`var c Charger = a`) happens once; the itab stays stable since the concrete type doesn't change.

**Trade-offs:** The adapter is reused with mutating state. Not safe if `Charge` retains a reference to the adapter (it shouldn't, but verify). Also not safe for concurrent calls — if `handle` was called from multiple goroutines on the same adapter, you'd race on `a.Item`.

**When NOT to do this:** When `Charge` is asynchronous or might capture the adapter pointer. The mutation between iterations would be visible to async observers. Use a sync.Pool or per-iteration allocation in that case.
</details>

---

## Exercise 2 — Interface conversion forcing escape

**Scenario:** A function returns an interface, forcing the adapter onto the heap.

**Before:**

```go
func newAdapter(src *Source) Iface {
    return &Adapter{src: src}  // escapes to heap because returned interface
}

func use() {
    for i := 0; i < 1000; i++ {
        a := newAdapter(&Source{})
        a.Do()
    }
}
```

```
BenchmarkEscapingAdapter-8       3000000    480 ns/op    48 B/op    2 allocs/op
```

`Source` and `Adapter` both heap-allocate because the interface return prevents stack allocation.

<details><summary>After</summary>

Hoist construction to a place where the adapter can stay on the stack:

```go
func use() {
    src := Source{}
    a := &Adapter{src: &src}  // analysis sees the use; can sometimes stack-allocate
    for i := 0; i < 1000; i++ {
        a.Do()  // direct call, no interface
    }
}
```

```
BenchmarkStackAdapter-8        50000000    18 ns/op    0 B/op    0 allocs/op
```

**Why faster:** The escape analysis pass sees `Adapter` doesn't escape the function (it's not returned, not stored in a heap object, not passed to an interface that escapes). It stays on the stack. The interface conversion is eliminated.

**Trade-offs:** Loses the abstraction at the call site — you're calling `Adapter` directly, not the interface. Substitution and testing become harder. Only worth it for tight inner loops where allocations dominate.

**When NOT to do this:** When the abstraction matters more than performance. Most code is fine with one allocation per construction.
</details>

---

## Exercise 3 — Adapter holding interface instead of concrete pointer

**Scenario:** The adapter accepts an interface but always wraps a known concrete type.

**Before:**

```go
type Adapter struct{ Inner Reader }  // interface
func (a *Adapter) Read(p []byte) (int, error) { return a.Inner.Read(p) }
```

Used:

```go
r := bytes.NewReader([]byte("..."))
a := &Adapter{Inner: r}
```

Every `a.Read(p)` call goes through interface dispatch.

```
BenchmarkInterfaceInner-8       100000000   12 ns/op
```

<details><summary>After</summary>

If the inner type is always `*bytes.Reader`, hold it as concrete:

```go
type BytesAdapter struct{ Inner *bytes.Reader }
func (a *BytesAdapter) Read(p []byte) (int, error) { return a.Inner.Read(p) }
```

```
BenchmarkConcreteInner-8        200000000    6 ns/op
```

2× speedup — no interface dispatch on the inner call.

**Why faster:** Direct method call instead of indirect itab lookup. The compiler can inline `(*bytes.Reader).Read` because the type is known.

**Trade-offs:** Locked into `*bytes.Reader`. To swap to a different `Reader`, you need a new adapter type or to change this one's field. Defeats the abstraction.

**When NOT to do this:** Almost always. The benefit (~6 ns/call) is rarely worth the loss of flexibility. Only if profiling identifies adapter dispatch as a hot path *and* you have a single dominant inner type.
</details>

---

## Exercise 4 — Boxed args in adapter signatures

**Scenario:** Adapter signature uses `interface{}` (or `any`) and the caller passes a value type.

**Before:**

```go
type Adapter struct{ Inner Sink }

func (a *Adapter) Push(v any) error {
    return a.Inner.Receive(v)
}

// Caller:
a.Push(42)  // boxes int into interface{}
```

```
BenchmarkBoxedAny-8     50000000    22 ns/op   8 B/op   1 allocs/op
```

Every call to `Push(42)` allocates an `iface` (or boxed int) on the heap.

<details><summary>After</summary>

If the value type is known, specialise:

```go
type IntAdapter struct{ Inner Sink }

func (a *IntAdapter) PushInt(v int) error {
    return a.Inner.ReceiveInt(v)
}
```

```
BenchmarkSpecialised-8     500000000   2.5 ns/op   0 B/op   0 allocs/op
```

10× speedup, zero allocations.

**Why faster:** No interface conversion at the call site. The int stays in a register.

**Trade-offs:** No generic adapter — one method per value type. For an adapter that's called with many types, this multiplies the method count.

**When NOT to do this:** When the adapter genuinely is generic across types. Generics (Go 1.18+) sometimes do this better:

```go
type Adapter[T any] struct{ Inner Sink[T] }
func (a *Adapter[T]) Push(v T) error { return a.Inner.Receive(v) }
```

GCShape stencilling avoids boxing for common types.
</details>

---

## Exercise 5 — Adapter using reflect for translation

**Scenario:** Adapter uses reflection to map field names.

**Before:**

```go
func (a *Adapter) Translate(src interface{}) error {
    v := reflect.ValueOf(src).Elem()
    name := v.FieldByName("Name").String()
    age  := int(v.FieldByName("Age").Int())
    return a.Inner.Send(Target{Name: name, Age: age})
}
```

```
BenchmarkReflectAdapter-8    1000000   1200 ns/op   192 B/op   8 allocs/op
```

Reflect is slow and allocation-heavy.

<details><summary>After</summary>

Direct field access:

```go
type Source struct{ Name string; Age int }

func (a *Adapter) Translate(src Source) error {
    return a.Inner.Send(Target{Name: src.Name, Age: src.Age})
}
```

```
BenchmarkDirectAdapter-8     200000000    8 ns/op   0 B/op   0 allocs/op
```

150× speedup.

**Why faster:** No reflection. Field access is a single memory load; no type descriptors, no string lookups, no boxing.

**Trade-offs:** Now the adapter only handles one concrete type. To handle multiple, write multiple adapters or use generics.

**When NOT to do this:** When the adapter genuinely needs to handle types it didn't know about at compile time (config-driven, plugin, runtime-loaded). That's the *only* case where reflection earns its cost.
</details>

---

## Exercise 6 — Lazy init with mutex instead of sync.Once

**Scenario:** Lazy adapter init via mutex.

**Before:**

```go
type Adapter struct {
    mu     sync.Mutex
    client *Client
}

func (a *Adapter) lazy() *Client {
    a.mu.Lock()
    defer a.mu.Unlock()
    if a.client == nil {
        a.client = NewClient()
    }
    return a.client
}
```

Every call acquires the mutex, even after initialisation.

```
BenchmarkMutexLazy-8      50000000    24 ns/op   0 B/op   0 allocs/op
```

<details><summary>After</summary>

Use `sync.Once`:

```go
type Adapter struct {
    once   sync.Once
    client *Client
}

func (a *Adapter) lazy() *Client {
    a.once.Do(func() { a.client = NewClient() })
    return a.client
}
```

```
BenchmarkOnceLazy-8      500000000    2.5 ns/op   0 B/op   0 allocs/op
```

10× speedup post-init.

**Why faster:** `sync.Once` uses an atomic check on the fast path. After the first call, subsequent calls do a single atomic load and a memory barrier — no mutex acquisition.

**Trade-offs:** `sync.Once.Do` is a closure call. For init that's *very* infrequent, the difference is invisible.

**When NOT to do this:** Almost never — `sync.Once` is strictly better than the mutex pattern for one-time init.
</details>

---

## Exercise 7 — Adapter chains that PGO could devirtualize

**Scenario:** Three-layer adapter chain in a hot HTTP handler.

**Before:**

```go
type Recover struct{ next http.Handler }
type Trace   struct{ next http.Handler }
type Adapter struct{ next http.Handler }
```

```
BenchmarkChainNoPGO-8       3000000    450 ns/op
```

Each layer adds an interface dispatch.

<details><summary>After (with PGO)</summary>

Collect a CPU profile in production:

```bash
go test -bench=. -cpuprofile=cpu.pprof
go build -pgo=cpu.pprof .
```

PGO devirtualizes the dominant call type:

```
BenchmarkChainWithPGO-8     5000000    280 ns/op
```

~35% faster.

**Why faster:** PGO sees that `next` is always the same concrete type in the profile. It inlines the call into a direct branch, falling back to indirect dispatch only for the rare other types.

**Trade-offs:** Larger binary (~5-10% increase). Profile must reflect production workload — if it doesn't, devirtualization targets the wrong types.

**When NOT to do this:** Small services, batch jobs, anything not running hot enough to need it. For sub-1k QPS services, PGO adds build complexity for invisible wins.
</details>

---

## Exercise 8 — Function adapter with pointer receiver

**Scenario:** A `Func`-style adapter uses a pointer receiver.

**Before:**

```go
type HandlerFunc func(w, r)

func (f *HandlerFunc) ServeHTTP(w, r) { (*f)(w, r) }
```

Callers:

```go
h := HandlerFunc(myFunc)
mux.Handle("/api", &h)
```

```
BenchmarkPointerFunc-8    100000000   15 ns/op
```

<details><summary>After</summary>

Value receiver:

```go
func (f HandlerFunc) ServeHTTP(w, r) { f(w, r) }
```

Callers:

```go
mux.Handle("/api", HandlerFunc(myFunc))
```

```
BenchmarkValueFunc-8      300000000   3 ns/op
```

5× speedup.

**Why faster:** Value receiver enables JMP-based tail call (see professional.md §11). The compiler proves the wrapper does nothing after `f(w, r)` and emits a direct jump instead of a call. Pointer receiver adds an extra indirection (load the function pointer through `f`).

**Trade-offs:** None worth mentioning — value receiver is the canonical idiom for function-type adapters. The pointer version is essentially always wrong.

**When NOT to do this:** When the function value would be modified through the receiver (which would be weird).
</details>

---

## Exercise 9 — Adapter recompiling regex per call

**Scenario:** Adapter compiles a regex on every call.

**Before:**

```go
func (a *Adapter) Match(s string) bool {
    re := regexp.MustCompile(`^[a-z]+$`)
    return re.MatchString(s)
}
```

```
BenchmarkCompilePerCall-8     500000     2200 ns/op   1024 B/op   8 allocs/op
```

<details><summary>After</summary>

Compile once at construction (or as a package var):

```go
var lowercasePattern = regexp.MustCompile(`^[a-z]+$`)

func (a *Adapter) Match(s string) bool {
    return lowercasePattern.MatchString(s)
}
```

```
BenchmarkPrecompiled-8      30000000    35 ns/op   0 B/op   0 allocs/op
```

60× speedup.

**Why faster:** Regex compilation is expensive. Doing it once at init amortises the cost to zero per call.

**Trade-offs:** None significant. The pattern is fixed at compile time anyway.

**When NOT to do this:** When the regex is constructed from runtime input (e.g., user-provided pattern). Then per-call compilation is unavoidable — but consider caching by pattern string.
</details>

---

## Exercise 10 — `fmt.Sprintf` in hot path

**Scenario:** Adapter formatting strings on every call.

**Before:**

```go
func (a *Adapter) Log(id int, msg string) {
    a.Inner.Print(fmt.Sprintf("id=%d msg=%s", id, msg))
}
```

```
BenchmarkSprintf-8      5000000    320 ns/op   48 B/op   2 allocs/op
```

<details><summary>After</summary>

Use `strings.Builder` for low-allocation formatting, or pass structured data to a structured logger:

```go
func (a *Adapter) Log(id int, msg string) {
    var sb strings.Builder
    sb.Grow(32)
    sb.WriteString("id=")
    sb.WriteString(strconv.Itoa(id))
    sb.WriteString(" msg=")
    sb.WriteString(msg)
    a.Inner.Print(sb.String())
}
```

```
BenchmarkBuilder-8      30000000    62 ns/op    16 B/op   1 allocs/op
```

5× speedup. Better still: use a structured logger that doesn't format eagerly:

```go
func (a *Adapter) Log(id int, msg string) {
    a.Inner.Info("event", "id", id, "msg", msg)  // no Sprintf
}
```

Structured loggers (slog, zap, zerolog) defer formatting until output.

**Why faster:** `fmt.Sprintf` is a generic formatter — it processes the format string, handles reflection-based dispatch, allocates the result. `strings.Builder` does the concatenation directly. Structured loggers skip formatting entirely for unsampled levels.

**Trade-offs:** More code for builder. Structured logger requires adopting it everywhere.

**When NOT to do this:** When the message rate is low and clarity beats microseconds.
</details>

---

## Exercise 11 — Defer in tight adapter

**Scenario:** Defer used in an adapter method that's called millions of times per second.

**Before:**

```go
func (a *Adapter) Do() error {
    a.mu.Lock()
    defer a.mu.Unlock()
    return a.inner.Process()
}
```

```
BenchmarkDeferLock-8    100000000   22 ns/op
```

<details><summary>After</summary>

Open-coded deferred call is fast in Go 1.14+, but for *very* tight loops, you can hand-unlock:

```go
func (a *Adapter) Do() error {
    a.mu.Lock()
    err := a.inner.Process()
    a.mu.Unlock()
    return err
}
```

```
BenchmarkManualUnlock-8    150000000   14 ns/op
```

~35% faster.

**Why faster:** Even with Go's optimised "open-coded defers" (Go 1.14+), defer adds ~5-10 ns per call when measured. Manual unlock is direct.

**Trade-offs:** Risk of forgetting unlock on early returns. Defer is the safer pattern.

**When NOT to do this:** Almost always. The safety of `defer` is worth more than the nanoseconds. Only consider this when (a) you have a profile showing defer overhead is significant and (b) the function has a single return point so manual unlock is trivially correct.
</details>

---

## Exercise 12 — Adapter using map for static dispatch

**Scenario:** Adapter dispatches by string key using a map.

**Before:**

```go
type Adapter struct{ handlers map[string]func() error }

func (a *Adapter) Handle(name string) error {
    fn, ok := a.handlers[name]
    if !ok { return errors.New("unknown") }
    return fn()
}
```

```
BenchmarkMapDispatch-8    20000000    65 ns/op
```

<details><summary>After</summary>

If the set of names is fixed and small (<10), a switch is faster:

```go
func (a *Adapter) Handle(name string) error {
    switch name {
    case "save":   return a.save()
    case "delete": return a.delete()
    case "load":   return a.load()
    default:       return errors.New("unknown")
    }
}
```

```
BenchmarkSwitchDispatch-8    150000000    8 ns/op
```

8× speedup for small N.

**Why faster:** Map lookup involves hashing the string (~30 ns) and a memory dereference. Switch on string compares each case — fast for small N. The compiler may even use a hash-based dispatch internally for large switches.

**Trade-offs:** Adding a new case requires editing the function (not registering at runtime). Less dynamic.

**When NOT to do this:** When the set of names is large (>20) or determined at runtime. The map handles those cases well.
</details>

---

## When NOT to optimize

Most adapter-related optimisations are micro-optimisations. They matter only if:

1. **Profiling shows the adapter is a bottleneck.** Run `go tool pprof` and verify before optimising.
2. **The QPS is high enough to matter.** A 100ns saving × 10 QPS = 1 microsecond/sec. Irrelevant.
3. **The clarity loss is acceptable.** Most optimisations make code harder to read.

The right order:

1. **Measure** — profile your actual workload.
2. **Identify hot paths** — adapters that show up in the top 10 of CPU.
3. **Optimise selectively** — apply the techniques above only to those hot paths.
4. **Measure again** — confirm the optimisation paid off.

Premature optimisation of adapters is a classic time-waster. The pattern is *already* efficient — Go's compiler handles the common cases well. Most "improvements" you can make are marginal.

The exceptions that are almost always worth it (no measurement needed):

- `sync.Once` for lazy init (cheaper than mutex; no downside).
- Value receivers on function-type adapters (cheaper; the canonical idiom).
- Pre-compiled regexes (compilation is expensive; once per package init is free).
- `var _ Iface = (*Adapter)(nil)` compile-time check (zero runtime cost; catches bugs).

Everything else: measure first.

---

## Summary

**Wins that always ship:**
- Value receiver on function adapters (Exercise 8).
- `sync.Once` for lazy init (Exercise 6).
- Pre-compile regexes (Exercise 9).
- Compile-time interface check (`var _ Iface = (*Adapter)(nil)`).

**Wins behind a profile:**
- Hoist construction out of hot loops (Exercise 1).
- Stack-allocate adapters where possible (Exercise 2).
- Replace `reflect` with direct field access (Exercise 5).
- Replace `fmt.Sprintf` with structured logging (Exercise 10).

**Wins that trade off flexibility:**
- Concrete inner type instead of interface (Exercise 3).
- Generic specialisation (Exercise 4).
- Map → switch for small N (Exercise 12).

**Rarely worth it:**
- Manual unlock instead of defer (Exercise 11).
- PGO devirtualization (Exercise 7) — only for hot services.

Most adapter performance work is *avoiding* allocations, not shaving nanoseconds off the dispatch. Profile, identify, then apply selectively.
