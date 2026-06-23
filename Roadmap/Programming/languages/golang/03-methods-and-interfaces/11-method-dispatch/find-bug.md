# Method Dispatch — Find the Bug

Each exercise follows this format:
1. Buggy code (the call **looks** static but isn't, or a "devirt" assumption fails)
2. Hint
3. Identifying the bug and its cause (often visible only via `-gcflags='-m'` or a benchmark)
4. Fixed code

Every bug here is about **how the call gets dispatched**, not about whether the program is correct.

---

## Bug 1 — Accidental dynamic dispatch in a hot loop

```go
type Encoder interface{ Encode(b []byte) []byte }

type GzipEncoder struct{}
func (GzipEncoder) Encode(b []byte) []byte { return b }

func Run(items [][]byte) {
    var e Encoder = GzipEncoder{}     // assigned once, used in hot loop
    for _, it := range items {
        _ = e.Encode(it)
    }
}
```

**Hint:** Look at the type of `e`, not the type stored inside it.

**Bug:** Even though only one concrete type is ever stored in `e`, the compiler sees an `Encoder` and emits an indirect call through `itab.fun[0]`. The encoder cannot inline. `-gcflags='-m=2'` will not show "devirtualizing e.Encode" because the source-level type is the interface.

**Fix:**

```go
func Run(items [][]byte) {
    e := GzipEncoder{}                // concrete type pinned in source
    for _, it := range items {
        _ = e.Encode(it)              // static, inlined
    }
}
```

Or, if the API must accept an interface, pin inside `Run`:

```go
func Run(e Encoder, items [][]byte) {
    if ge, ok := e.(GzipEncoder); ok {
        for _, it := range items { _ = ge.Encode(it) }
        return
    }
    for _, it := range items { _ = e.Encode(it) }
}
```

---

## Bug 2 — Method value created inside the loop

```go
type Worker struct{ id int }
func (w *Worker) Step(x int) int { return x + w.id }

func Loop(w *Worker, xs []int) int {
    s := 0
    for _, x := range xs {
        fn := w.Step          // method value, every iteration
        s += fn(x)
    }
    return s
}
```

**Hint:** Run `go build -gcflags='-m' ./...` and look for "escapes to heap".

**Bug:** A method value (`w.Step`) is a closure carrying `w` as captured state. Inside the loop it allocates on every iteration:

```
./loop.go:5:9: w.Step escapes to heap
./loop.go:5:9: moved to heap: w.Step
```

Plus every call goes through closure indirection — slower than direct dispatch and slower than even the interface call.

**Fix:**

```go
func Loop(w *Worker, xs []int) int {
    s := 0
    for _, x := range xs { s += w.Step(x) }   // direct call, inlined
    return s
}
```

If you really need a function value, use a method expression and pass the receiver explicitly:

```go
fn := (*Worker).Step
for _, x := range xs { s += fn(w, x) }        // no closure, no alloc
```

---

## Bug 3 — Devirt missed because of indirect storage

```go
type Op interface{ Do(int) int }
type Add struct{ K int }
func (a *Add) Do(x int) int { return x + a.K }

type Pipeline struct{ ops []Op }   // slice of interface

func (p *Pipeline) Run(x int) int {
    for _, op := range p.ops { x = op.Do(x) }   // dynamic
    return x
}
```

**Hint:** What is `op`'s static type?

**Bug:** `p.ops` is `[]Op`, so `op`'s static type is the interface even though every element is `*Add`. The compiler cannot devirtualize a slice element without help — there is no way to prove from local context that all entries share the concrete type.

**Fix (when the pipeline is homogeneous):**

```go
type Pipeline struct{ ops []*Add }   // concrete

func (p *Pipeline) Run(x int) int {
    for _, op := range p.ops { x = op.Do(x) }   // static
    return x
}
```

Or generic:

```go
type Pipeline[T any] struct{ ops []func(T) T }
func (p *Pipeline[T]) Run(v T) T {
    for _, op := range p.ops { v = op(v) }
    return v
}
```

---

## Bug 4 — Body just over the inline budget

```go
func (c *Cache) Get(k string) (V, bool) {
    c.mu.Lock()
    defer c.mu.Unlock()
    if v, ok := c.m[k]; ok {
        c.stats.hits++
        c.lru.touch(k)
        return v, true
    }
    c.stats.misses++
    return zero, false
}
```

**Hint:** Run with `-gcflags='-m=2'`.

**Bug:**

```
./cache.go:1:6: cannot inline (*Cache).Get: function too complex: cost 96 exceeds budget 80
```

The body is too big. Every `Get` call site eats a `CALL`, two register saves, etc. — measurable in a tight loop.

**Fix:** Split into a small inline-friendly hot path and an out-of-line slow path:

```go
func (c *Cache) Get(k string) (V, bool) {
    if v, ok := c.fast[k]; ok { return v, true }   // small, cost ~12
    return c.getSlow(k)
}

//go:noinline
func (c *Cache) getSlow(k string) (V, bool) { /* lock, lru, stats */ }
```

Now `Get` inlines into every caller and the rare slow path stays out of icache pressure.

---

## Bug 5 — Pointer-receiver method on an interface value

```go
type Speaker interface{ Speak() string }
type Robot struct{ name string }
func (r *Robot) Speak() string { return r.name }

func Loud(s Speaker) string { return s.Speak() }

func main() {
    Loud(Robot{"R2"})    // ?
}
```

**Hint:** Method set rules.

**Bug:** `Speak` has a pointer receiver, so the method set of `Robot` (value) does not contain it. Compile error: `Robot does not implement Speaker (Speak method has pointer receiver)`. There is no dispatch to argue about — the program does not build.

But there is a sneakier variant: if the user adds `Speak` on the value receiver "to fix the build", they double the wrapper count and lose devirt opportunities.

**Fix:**

```go
Loud(&Robot{"R2"})    // pass a pointer; method set of *Robot has Speak
```

Avoid the temptation to duplicate the method on both receivers just to dodge the compile error.

---

## Bug 6 — `go:noinline` left from debugging

```go
//go:noinline
func (p Point) Mul(k int) Point { return Point{p.X*k, p.Y*k} }
```

**Hint:** Read the pragma.

**Bug:** Someone added `//go:noinline` while debugging; it never got removed. Now even though the body costs 6, the compiler is forbidden to inline. Every call adds a frame. Hot loops over `Mul` get noticeably slower.

**Fix:** Delete the pragma. If you need to keep `Mul` non-inlinable for a benchmark, gate it behind a build tag:

```go
//go:build benchnoinline
//go:noinline
```

---

## Bug 7 — Type assertion forgets to assert

```go
type Logger interface{ Log(string) }
type stdoutLogger struct{}
func (stdoutLogger) Log(s string) { _ = s }

func Hot(l Logger, msgs []string) {
    for _, m := range msgs { l.Log(m) }     // dynamic
}

// caller
Hot(stdoutLogger{}, msgs)
```

**Hint:** PGO would devirt this — but is PGO actually enabled?

**Bug:** The author intended PGO devirtualization, but the build command is `go build ./...`, with no profile and no `-pgo=auto`. The hot site stays dynamic in production. `-gcflags='-m=2'` shows no devirt notes.

**Fix:**

```bash
go test -bench=Hot -cpuprofile=default.pgo ./hotpath
go build -pgo=auto ./...
go build -pgo=auto -gcflags='-m=2' ./... 2>&1 | grep devirt
# devirtualizing l.Log to stdoutLogger
```

Or, if PGO is not possible, manually pin the concrete type as in Bug 1.

---

## Bug 8 — Embedded interface hides dynamic dispatch

```go
type Logger interface{ Log(string) }

type Service struct {
    Logger          // embedded interface
    db *sql.DB
}

func (s *Service) Save(k string) {
    s.Log("saving " + k)   // looks like a method on Service
}
```

**Hint:** What is the static type of `s.Log`?

**Bug:** Embedding an interface promotes its method, but the call is still `itab` dispatch — the compiler cannot know the concrete type even when the rest of the program only ever stores one. Reviewers often miss this because `s.Log(...)` reads like a normal method call.

**Fix (concrete type embedded directly):**

```go
type Service struct {
    log *FileLogger    // concrete pointer
    db  *sql.DB
}
func (s *Service) Save(k string) { s.log.Log("saving " + k) } // static
```

If multiple loggers are needed at construction time, accept the interface in the constructor but store a concrete field:

```go
func NewService(l Logger, db *sql.DB) *Service {
    fl, _ := l.(*FileLogger)            // pin concrete in hot field
    return &Service{log: fl, db: db}
}
```

---

## Bug 9 — Interface assertion in the hot loop

```go
func Sum(xs []any) int {
    s := 0
    for _, x := range xs {
        n, _ := x.(int)        // assertion every iteration
        s += n
    }
    return s
}
```

**Hint:** Where does the type-switch table get built?

**Bug:** Each `x.(int)` reads the itab, compares the type pointer, branches. In a hot loop this dwarfs the addition. The cost is similar to dynamic dispatch but disguised as "harmless".

**Fix:** Lift the type to the API boundary:

```go
func Sum(xs []int) int {
    s := 0
    for _, x := range xs { s += x }   // simple ADD, vectorizable
    return s
}
```

If the input is genuinely heterogeneous, group by type once and process each group with a typed function — the assertion happens N times instead of N×M.

---

## Bug 10 — `errors.Is` in a hot path

```go
for _, j := range jobs {
    if err := j.Run(); errors.Is(err, ErrTransient) {
        retry(j)
    }
}
```

**Hint:** What does `errors.Is` do under the hood?

**Bug:** `errors.Is` walks the wrap chain via the `Unwrap()` interface method — every step is a dynamic dispatch. In hot job loops with many transient errors this becomes a measurable share of CPU.

**Fix:** When the sentinel is the only thing you check, compare directly first:

```go
for _, j := range jobs {
    err := j.Run()
    if err == ErrTransient || errors.Is(err, ErrTransient) {
        retry(j)
    }
}
```

The pointer comparison short-circuits the dispatch chain in the common case.

---

## Bug 11 — Generic call goes through itab anyway

```go
type Adder interface{ Add(int) int }

func Apply[T Adder](a T, xs []int) int {
    s := 0
    for _, x := range xs { s = a.Add(s) + x }   // dynamic?
    _ = xs
    return s
}
```

**Hint:** What is `T`'s shape?

**Bug:** `T` is constrained by an interface, so the GCShape stencil treats `T` as an interface — the call goes through the itab, identical to a non-generic interface version. Generics did not buy devirtualization here.

**Fix (concrete constraint):**

```go
type Add struct{ K int }
func (a Add) Add(x int) int { return x + a.K }

func Apply[T ~struct{ K int }](a T, xs []int) int { ... } // structural, scalar shape
```

Better: take a function instead of an interface.

```go
func Apply[T any](add func(T, T) T, zero T, xs []T) T { ... }
```

The function gets inlined per shape; no itab.

---

## Bug 12 — Indirect call hidden by `defer`

```go
func (s *Service) Handle(req Req) (resp Resp) {
    defer s.metrics.Observe(time.Now())   // indirect call via interface
    return s.do(req)
}
```

**Hint:** Open-coded defer (Go 1.14+) is fast, but...

**Bug:** Open-coded defer skips the `deferproc` runtime cost, but the deferred call itself is still through `s.metrics.Observe`. If `Metrics` is an interface, that's a dynamic dispatch on every `Handle` call — small but constant.

**Fix:** Store a concrete metrics struct:

```go
type Service struct{ metrics *promMetrics }
```

Or skip `defer` in the hottest endpoints and call the observation explicitly so the compiler can inline the concrete call.

---

## Bug 13 — Devirt assumption broken by tests

Production build: hot site is devirtualized via PGO. CI build: `default.pgo` is missing, so the same site falls back to dynamic dispatch — a microbenchmark in CI reports 3x regression and the team panics.

**Hint:** What does the build pipeline ship?

**Bug:** PGO devirt is opportunistic. When `default.pgo` is absent or stale, every devirt vanishes. Benchmarks that rely on PGO numbers must be reproducible.

**Fix:**
- Commit a representative `default.pgo` (Go supports this).
- Or run benchmarks with `-pgo=off` in CI to keep the numbers comparable.
- Add `go build -pgo=auto -gcflags='-m=2' 2>&1 | grep devirt` as a CI assertion.

---

## Bug 14 — `interface{}` parameter for a hot helper

```go
func mustOK(v any) {
    if e, ok := v.(error); ok && e != nil { panic(e) }
}

for _, r := range results { mustOK(r.err) } // hot
```

**Hint:** Boxing.

**Bug:** Passing `r.err` (which is already an `error` interface) into `any` reboxes it — allocation if the error is not nil-checked first, plus an extra type assertion. In tight error-checking loops this shows up in pprof.

**Fix:**

```go
func mustOK(e error) {
    if e != nil { panic(e) }
}
```

Same dispatch cost (one indirect call to `Error()` if you panic), zero boxing on the happy path.

---

## Bug 15 — Vtable-style design in Go

```go
type IShape interface {
    Area() float64
    Perimeter() float64
    Centroid() (float64, float64)
    BoundingBox() Rect
    // ... 12 more methods
}
```

The hot path only ever needs `Area`, but the team has built a 16-method interface to "future-proof" the design. Every concrete implementation now carries 16 itab slots; every assignment to `IShape` builds the full itab on first use; the interface table itself is bigger than the hot working set.

**Hint:** Interface size matters.

**Bug:** Wide interfaces inflate itab build time and waste icache. The hot path could be a 1-method interface and the rest could be optional capabilities discovered via assertion.

**Fix:**

```go
type Areal interface{ Area() float64 }
type WithCentroid interface{ Centroid() (float64, float64) }
// ...
```

Take the narrow interface in the hot function; assert to a wider one only where needed:

```go
func Sum(shapes []Areal) float64 {
    var s float64
    for _, sh := range shapes { s += sh.Area() } // 1-slot itab
    return s
}
```

---

## Cheat Sheet

```
DISPATCH BUGS — TYPICAL CAUSES
──────────────────────────────────
1. Concrete type stored in interface variable           → dynamic
2. Slice/map of interface elements                      → dynamic
3. Embedded interface field                             → dynamic
4. Method value in a hot loop                           → alloc + indirect
5. PGO not enabled, devirt didn't happen                → dynamic
6. Body crosses the 80-node inline budget               → no inline
7. //go:noinline left over from debugging               → no inline
8. Type assertion inside hot loop                       → branch + load
9. Wide interface for a narrow hot path                 → big itab
10. Generics with interface constraint                  → still itab

DIAGNOSTIC FLAGS
──────────────────────────────────
go build -gcflags='-m'        # inline + escape decisions
go build -gcflags='-m=2'      # cost numbers + devirt notes
go build -pgo=auto            # PGO devirt (Go 1.21+)
go test -bench .              # confirm with ns/op numbers
go tool nm -size BIN          # see GCShape stencils

RULES OF THUMB
──────────────────────────────────
- Pin concrete types at the hot path.
- Use interfaces at the boundary, not the body.
- Keep hot methods short (cost < 80).
- Method expression > method value in hot code.
- PGO is not a substitute for clean dispatch design.
```
