# Method Dispatch — Interview Questions

## Table of Contents
1. [Junior-Level Questions](#junior-level-questions)
2. [Middle-Level Questions](#middle-level-questions)
3. [Senior-Level Questions](#senior-level-questions)
4. [Tricky / Curveball Questions](#tricky-curveball-questions)
5. [Coding Tasks](#coding-tasks)
6. [System Design Style](#system-design-style)
7. [What Interviewers Look For](#what-interviewers-look-for)

---

## Junior-Level Questions

### Q1: What is the difference between static and dynamic dispatch in Go?

**Answer:** Static dispatch happens when the compiler knows the concrete type at the call site and emits a direct `CALL fn` instruction. Dynamic dispatch happens when the call goes through an interface variable; the runtime loads the function pointer from `itab.fun[i]` and issues an indirect call. Static dispatch can be inlined; dynamic dispatch usually cannot.

### Q2: What is `itab`?

**Answer:** `itab` ("interface table") is a runtime structure for each `(interface, concrete type)` pair. It contains the interface and concrete type info plus an array `fun[]` of function pointers, one per interface method. The runtime builds itabs lazily on first use and caches them.

### Q3: Roughly how much does a dynamic call cost compared to a static one?

**Answer:** Around 1-3 nanoseconds for the indirect call itself, plus possible branch-predictor cost. A statically dispatched and inlined call is effectively free (~0 ns).

### Q4: Which compiler flag shows inlining decisions?

**Answer:** `go build -gcflags='-m'`. Use `-m=2` for verbose output that includes devirtualization decisions.

### Q5: Does Go inline method calls automatically?

**Answer:** Yes, when:
- The method is statically dispatched.
- Its body fits the inline budget (~80 nodes since Go 1.22).
- It does not contain disqualifying constructs (some forms of `defer`, `recover`, function literals capturing heavyweight context).

---

## Middle-Level Questions

### Q6: Why can't the compiler inline a method called through an interface?

**Answer:** Because the actual function body is unknown until runtime. The compiler does not know which concrete type's method will execute, so it cannot substitute a body. Devirtualization (especially PGO-driven) can convert the call to static, after which inlining becomes possible.

### Q7: What is the inline budget and how is it measured?

**Answer:** The inliner uses an estimated cost in AST nodes. Each statement, expression, or call has a cost (a function call alone costs ~57). The budget is approximately 80 nodes (Go 1.22). Bodies above the budget are not inlined. You can read the actual cost with `go build -gcflags='-m=2'`.

### Q8: What is a "monomorphic" vs "polymorphic" call site?

**Answer:** Monomorphic: the same concrete type is called every time at this site. The CPU's branch-target buffer learns the target and the indirect call is nearly free. Polymorphic (or megamorphic): multiple concrete types reach the site. The predictor misses, costing ~10-20 ns per mispredict.

### Q9: How do you write a benchmark that distinguishes static from dynamic dispatch?

**Answer:**
```go
type Adder interface { Add(int) int }
type C struct{ b int }
func (c C) Add(x int) int { return c.b + x }

func BenchmarkStatic(b *testing.B) {
    c := C{}
    for i := 0; i < b.N; i++ { _ = c.Add(i) }
}

func BenchmarkDynamic(b *testing.B) {
    var a Adder = C{}
    for i := 0; i < b.N; i++ { _ = a.Add(i) }
}
```
Consume the result (e.g., `sink = c.Add(i)`) to prevent dead-code elimination, and run with `-count=10 | benchstat`.

### Q10: What does `itab.fun[]` look like for an interface with two methods?

**Answer:** An array of two `uintptr` slots, each holding a function pointer. The runtime walks the concrete type's method table and fills these slots in the order the interface declares its methods. Looking up `iface.tab.fun[1]` retrieves the second method's address.

---

## Senior-Level Questions

### Q11: What does PGO devirtualization do at the machine-code level?

**Answer:** It emits a guarded direct call: a comparison of the interface's type pointer against the most-common concrete type, then a direct call (often inlined) on the hot branch and the regular indirect call on the cold branch. This works without changing source code.

### Q12: What concrete-type bias does PGO need to fire?

**Answer:** A strong bias toward one type — empirically above ~80% in most releases, though the exact threshold is internal and may change. If the call site is roughly equal among several types, PGO will not devirtualize.

### Q13: Why does Go not perform tail-call optimization?

**Answer:** Two main reasons: (1) it complicates stack traces and runtime introspection, and (2) the Go team has prioritized debugging clarity over the optimization. As a result, deep recursive method chains can grow the stack significantly. Workaround: rewrite as iteration.

### Q14: Explain GCShape stenciling for generics.

**Answer:** Go generics are not fully monomorphized. The compiler groups type parameters by GC shape (size, alignment, pointer mask) and emits one stencil per shape. Within the stencil, type-dependent operations go through a runtime dictionary. Concrete operations are inlined per stencil. This balances code size and dispatch cost.

### Q15: When does generics dispatch beat interface dispatch?

**Answer:** When the call site uses scalar or non-pointer types (separate stencils, near-static dispatch), and the function body is large enough to amortize the dictionary lookup overhead. For pointer types sharing a single stencil, the dispatch cost is comparable to interface dispatch — sometimes slower. Always benchmark.

### Q16: What's the cost of `reflect.Value.MethodByName(...).Call(...)`?

**Answer:** Roughly 100-500 ns per call, plus allocations for argument boxing. Two orders of magnitude slower than interface dispatch. Reasonable in non-hot paths; unacceptable in tight loops. Codegen or generics replace it in performance-sensitive code.

### Q17: How does the compiler track concrete types across local control flow?

**Answer:** The static devirtualizer walks the IR and tracks the most-recent assignment to each interface variable. If the right-hand side is a concrete-typed expression and no intervening function call could mutate the variable, the call is rewritten to a direct call. The pass conservatively gives up across function boundaries.

### Q18: What does `iface` look like in memory and what are the implications?

**Answer:** Two words on 64-bit: `(itab pointer, data pointer)`. Implications: (1) interface assignment is two-word copy; (2) "typed nil" — `data == nil` but `tab != nil` — is a non-nil interface that panics if methods dereference it; (3) every interface call requires loading both words plus `tab.fun[i]`.

---

## Tricky / Curveball Questions

### Q19: Why does this benchmark show 0.3 ns for a method call?
```go
func BenchmarkX(b *testing.B) {
    c := Calc{}
    for i := 0; i < b.N; i++ { c.Add(i) }
}
```
**Answer:** The compiler inlined `Add` and then deleted the call entirely because the result is unused. To measure honest call cost: store the result in a sink variable, and add `//go:noinline` if you want to measure non-inlined static dispatch.

### Q20: Can `var i Iface = &Concrete{}; i.M()` be inlined without PGO?

**Answer:** Yes. The static devirtualizer recognizes the local assignment, rewrites `i.M()` to `(&Concrete{}).M()`, and the inliner can then inline if the body fits. Confirm with `-gcflags='-m=2'`.

### Q21: Does this code dispatch statically or dynamically?
```go
func process(items []io.Writer) {
    for _, w := range items {
        w.Write(buf)
    }
}
```
**Answer:** Dynamically. `w` is an interface with no provable single concrete type. Devirtualization fails because the slice may hold mixed types. PGO can guard-devirtualize the hot branch if traffic is biased.

### Q22: What changed in Go 1.22 for method values created in loops?

**Answer:** Loop-variable scoping changed: each iteration gets a fresh variable. Method values like `m := obj.Method` inside `for _, obj := range objs` now capture the per-iteration `obj`, removing a long-standing class of bugs in pre-1.22 code.

### Q23: If I add `//go:noinline` to a method, does it become dynamically dispatched?

**Answer:** No. `//go:noinline` only blocks inlining. Static vs dynamic dispatch is determined by whether the call site has an interface variable. A non-inlined method called on a concrete type is still statically dispatched — there's a real `CALL` instruction to a fixed label.

### Q24: Why does an interface holding `nil` concrete data not crash on `i == nil` but does crash on `i.M()` (when M dereferences)?

**Answer:** `i == nil` compares both words of the iface. If `tab` is non-nil, the comparison returns false. But `i.M()` looks up `tab.fun[k]` and calls it with `data` (which is nil); inside `M`, dereferencing the receiver panics. This is the "typed nil" gotcha — relevant to dispatch because the itab still drives the call.

### Q25: A team adds an interface around a hot serializer "for testability." Throughput drops 8%. Why?

**Answer:** Every previously-static method call became dynamic. Dynamic calls cost ~1-3 ns each plus block inlining. In a serializer doing millions of operations per second, that adds up. Mitigations: pin the concrete type in production code, mock at integration boundaries, or apply PGO.

---

## Coding Tasks

### Task 1: Write a benchmark proving devirtualization happened

```go
type I interface { M() int }
type T struct{}
func (T) M() int { return 42 }

func direct() int {
    var i I = T{}
    return i.M()
}
```

Build with `go build -gcflags='-m=2'` and look for `devirtualizing i.M to T`.

### Task 2: Write a benchmark with allocation-free method expression

```go
type S struct{ n int }
func (s *S) Tick() { s.n++ }

func BenchmarkExpr(b *testing.B) {
    s := &S{}
    f := (*S).Tick
    b.ResetTimer()
    for i := 0; i < b.N; i++ { f(s) }
}
```

Run with `-benchmem`. `0 allocs/op` confirms the method-expression form does not allocate.

### Task 3: Convert a megamorphic loop into per-type batches

```go
// Before
for _, w := range writers { w.Write(buf) }

// After
type bucket struct { w io.Writer; buf []byte }
buckets := groupByType(writers)
for _, b := range buckets {
    for _, w := range b {
        w.Write(buf) // monomorphic per group
    }
}
```

### Task 4: Sketch a PGO setup

```bash
# 1. Run service with pprof
curl -o cpu.pprof "http://localhost:8080/debug/pprof/profile?seconds=60"

# 2. Move to repo
cp cpu.pprof default.pgo

# 3. Build
go build -o app .

# 4. Verify
go build -gcflags='-m=2 -d=pgodebug=1' . 2>&1 | grep PGO
```

### Task 5: Detect a hot indirect call in a profile

```bash
go test -bench=. -cpuprofile=cpu.out
go tool pprof cpu.out
(pprof) top
(pprof) list HotMethod
(pprof) disasm HotMethod
# Look for `CALL DX` or similar indirect-call patterns in hot lines
```

---

## System Design Style

### Q26: You have a JSON encoder called 1M times per second. How would you reduce dispatch cost?

**Answer:** Steps in order:
1. Profile: confirm `runtime.assertI2I`/indirect calls dominate.
2. Pin the concrete encoder type in the hot path; remove the `Encoder` interface there.
3. If multiple concrete encoders must coexist, batch by type (group items by encoder, dispatch once per batch).
4. Adopt PGO with a representative profile.
5. Consider codegen (e.g., `easyjson`) to eliminate reflection.
6. As a last resort, generics-stencil the encoder for each known concrete type.

### Q27: Your team wants to introduce interfaces "for mockability" across all internal packages. What's the dispatch impact and your recommendation?

**Answer:** Adding interfaces converts every previously-static call into a dynamic one. In hot code that's tangible (1-3 ns × call rate). Recommendation: only introduce interfaces at boundaries where multiple implementations actually exist. Mock at integration boundaries (DBs, external APIs). Avoid wrapping leaf utilities. Combine with PGO if a layer must remain interface-based.

### Q28: How do you keep PGO profiles fresh in CI/CD?

**Answer:**
- Continuous profiling (Pyroscope/Datadog/Polar Signals) collects production profiles 24/7.
- A nightly job aggregates profiles from all replicas of the latest production version.
- The aggregated profile is committed (or stored as a versioned artifact) under `default.pgo`.
- CI builds with PGO; benchmark suite runs with and without PGO; regressions block the merge.
- Profiles are pinned per major release branch to avoid mixing across version-specific code shape.

---

## What Interviewers Look For

### Junior

- Can describe direct call vs indirect call.
- Knows `itab` exists and what `fun[]` is for.
- Has run `go test -bench` and read its output.
- Understands inlining as an optimization.

### Middle

- Reads `-gcflags='-m'` fluently.
- Writes benchmarks that resist dead-code elimination.
- Knows the BTB / monomorphic-vs-polymorphic distinction.
- Can hoist a type assertion out of a loop.

### Senior

- Understands `cmd/compile` passes related to dispatch.
- Can use `-gcflags='-m=2 -d=pgodebug=1'`.
- Knows GCShape stenciling and its implications.
- Can argue for or against introducing an interface based on dispatch cost.

### Professional

- Owns a PGO pipeline in CI/CD.
- Can audit a production profile and identify dispatch hot spots.
- Knows when to switch to codegen vs when generics suffice.
- Manages the trade-off between API ergonomics and dispatch cost across teams.

---

## Cheat Sheet

```
QUICK ANSWERS
─────────────────────────────────
1. Static call cost      ~0-1 ns (often inlined)
2. Dynamic call cost     ~1-3 ns (steady state)
3. Reflect call cost     ~100-500 ns
4. Inline budget         ~80 nodes (Go 1.22)
5. itab lookup first hit ~30-60 ns
6. PGO needs profile     default.pgo (Go 1.21+)
7. TCO in Go             not implemented
8. Generics dispatch     stenciled by GCShape

DIAGNOSTIC ONE-LINERS
─────────────────────────────────
go build -gcflags='-m=2'              inline + devirt
go build -gcflags='-S'                assembly
go build -gcflags='-d=pgodebug=1' .   PGO logs
go test -bench=. -cpuprofile=cpu.out  capture profile
go tool pprof -disasm Func cpu.out    find indirect calls

THINGS NOT TO SAY
─────────────────────────────────
- "Methods are slower than functions" — not in Go
- "Interfaces are always slow" — only in hot loops
- "PGO always helps" — needs biased traffic
- "Generics are always faster" — depends on GCShape
```
