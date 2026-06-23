# Method Dispatch — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Three Call Forms in Assembly](#the-three-call-forms-in-assembly)
3. [Locating itab.fun[] in Practice](#locating-itabfun-in-practice)
4. [Per-Call Cost Anatomy](#per-call-cost-anatomy)
5. [Branch Predictor and Polymorphic Sites](#branch-predictor-and-polymorphic-sites)
6. [Inline Budget and the 80-Node Threshold](#inline-budget-and-the-80-node-threshold)
7. [Local Devirtualization](#local-devirtualization)
8. [Benchmark Methodology](#benchmark-methodology)
9. [`benchstat` and Statistical Significance](#benchstat-and-statistical-significance)
10. [Common Pitfalls in Dispatch Benchmarks](#common-pitfalls-in-dispatch-benchmarks)
11. [Type Assertions in Hot Loops](#type-assertions-in-hot-loops)
12. [Method Values vs Method Expressions Cost](#method-values-vs-method-expressions-cost)
13. [Reflection-Based Dispatch](#reflection-based-dispatch)
14. [Tricky Questions](#tricky-questions)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)

---

## Introduction

At the junior level you saw *that* dynamic dispatch exists and that it is slower. Now we look at *how much* slower, *why*, and how to measure it correctly. This file is hands-on: you will read assembly, peek at `itab.fun[]` from a debugger, and write benchmarks that actually distinguish dispatch cost from loop overhead.

---

## The Three Call Forms in Assembly

Compile the following with `go build -gcflags='-S' main.go 2>asm.txt`:

```go
type T struct{ n int }
func (t T) Inc() int { return t.n + 1 }

type I interface{ Inc() int }

func staticCall(t T) int    { return t.Inc() }
func dynamicCall(i I) int   { return i.Inc() }
func methodValueCall(t T) int {
    f := t.Inc
    return f()
}
```

Trimmed assembly (amd64, Go 1.22):

```asm
"".staticCall STEXT
    CALL    "".T.Inc(SB)        ; direct, fixed-address CALL

"".dynamicCall STEXT
    MOVQ    24(AX), DX          ; AX = itab; load fun[0]
    CALL    DX                  ; indirect CALL

"".methodValueCall STEXT
    LEAQ    "".T.Inc-fm(SB), AX
    ; ... allocate closure on heap or stack ...
    MOVQ    0(AX), DX           ; load fn pointer from closure
    CALL    DX                  ; indirect CALL
```

Three observations:
1. The static form is a single `CALL` to a known label.
2. The dynamic form has two memory loads first (itab, then `fun[i]`).
3. The method-value form often *also* allocates a closure when `t.Inc` escapes.

---

## Locating itab.fun[] in Practice

The runtime stores itabs in a hash table keyed by `(interface type, concrete type)`. The relevant declarations are in `runtime/iface.go` and `runtime/runtime2.go`:

```go
// from runtime2.go
type itab struct {
    inter *interfacetype
    _type *_type
    hash  uint32
    _     [4]byte
    fun   [1]uintptr // variable-sized; one slot per interface method
}
```

You can confirm this yourself with `go tool objdump`:

```bash
go tool objdump -s "main.dynamicCall" myprog | head -20
```

Look for `MOVQ N(AX), DX` where `N` is `24` on 64-bit (offset of `fun` in `itab`). That `N` corresponds to `fun[0]`; `fun[1]` would be at `32`, etc.

### Inspecting under Delve

```
(dlv) b main.dynamicCall
(dlv) c
(dlv) regs
(dlv) print *(*[3]uint64)(unsafe.Pointer(uintptr(rax)))
```

The third word is `fun[0]` — the function pointer the runtime will jump to.

---

## Per-Call Cost Anatomy

A single dynamic call decomposes into:

| Step | Approximate cost |
|---|---|
| Load `itab` from receiver word | <1 ns (often L1) |
| Load `fun[i]` from itab | <1 ns (often L1) |
| Indirect CALL instruction | 0.3-0.5 ns plus predictor |
| Predictor mispredict (if target varies) | 10-20 ns penalty |
| icache miss when target body is "cold" | 5-50 ns |

Steady-state, monomorphic call sites hit the predictor's BTB and look like a constant ~1.5 ns. Polymorphic call sites can degrade to 5-10 ns.

---

## Branch Predictor and Polymorphic Sites

Modern CPUs have a Branch Target Buffer (BTB) that learns the targets of indirect calls. If a single call site always invokes the same concrete method (monomorphic), the BTB caches it and the branch is "free."

```go
// MONOMORPHIC — predictor wins
var w io.Writer = os.Stdout
for i := 0; i < N; i++ {
    w.Write(buf)            // always (*os.File).Write
}

// POLYMORPHIC — predictor misses
ws := []io.Writer{os.Stdout, os.Stderr, &bytes.Buffer{}}
for _, w := range ws {
    w.Write(buf)            // alternates
}
```

A simple benchmark:

```go
func BenchmarkMonomorphic(b *testing.B) {
    var w io.Writer = io.Discard
    for i := 0; i < b.N; i++ {
        w.Write(nil)
    }
}

func BenchmarkPolymorphic(b *testing.B) {
    ws := []io.Writer{io.Discard, &bytes.Buffer{}}
    for i := 0; i < b.N; i++ {
        ws[i&1].Write(nil)
    }
}
```

Typical results show the polymorphic variant ~2-3x slower, dominated by mispredicts.

---

## Inline Budget and the 80-Node Threshold

The inliner uses a "node budget" measured in AST nodes. Each statement, expression, or call counts. Historically the budget was 80; Go 1.22 kept ~80 with some refinements (see `cmd/compile/internal/inline/inl.go`).

A method whose body exceeds the budget is **never inlined**, even when statically dispatched.

```go
// Likely inlined — small body
func (p Point) X() int { return p.x }

// Likely NOT inlined — too many nodes
func (p Point) Distance(q Point) float64 {
    dx := p.x - q.x
    dy := p.y - q.y
    return math.Sqrt(float64(dx*dx + dy*dy))
}
```

Run `go build -gcflags='-m=2'` and look for messages like:

```
./point.go:9:6: cannot inline (Point).Distance: function too complex: cost 124 exceeds budget 80
```

The cost listed is the inliner's estimate; tune your code if you want the inline.

### Forcing or blocking inlining

You cannot *force* inlining. You can *block* it with `//go:noinline`:

```go
//go:noinline
func (p Point) X() int { return p.x }
```

Useful in benchmarks to make sure both static and dynamic variants pay a real call cost.

---

## Local Devirtualization

Even without PGO, the compiler can devirtualize when the concrete type flows from a local variable:

```go
func run() int {
    var w io.Writer
    w = bytes.NewBuffer(nil)  // exact concrete type known here
    return w.(*bytes.Buffer).Len() // forced concrete via assertion
}
```

A more interesting case is when an interface assignment dominates the call:

```go
func process() {
    var s Speaker = Greeter{}
    s.Hello() // compiler may statically rewrite this to Greeter.Hello
}
```

This pattern is observable through `-gcflags='-m=2'` as `devirtualizing call to Speaker.Hello`. Without PGO, devirtualization is conservative — it gives up across function boundaries.

---

## Benchmark Methodology

Dispatch benchmarks are tricky. The compiler is aggressive at deleting "useless" code, so a naive loop measures *nothing*:

```go
// BAD: result discarded; compiler may delete the call
func BenchmarkBad(b *testing.B) {
    var s Speaker = Greeter{}
    for i := 0; i < b.N; i++ {
        s.Hello()
    }
}
```

Always consume the result and disable inlining of the boundary if needed:

```go
var sink string

//go:noinline
func consume(s string) { sink = s }

func BenchmarkGood(b *testing.B) {
    var s Speaker = Greeter{}
    for i := 0; i < b.N; i++ {
        consume(s.Hello())
    }
}
```

Another guard is `runtime.KeepAlive` for non-string values, or assigning into a package-level `var sink T`.

### Reset timer for setup-heavy benchmarks

```go
func BenchmarkX(b *testing.B) {
    data := buildLargeFixture()
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        _ = process(data)
    }
}
```

---

## `benchstat` and Statistical Significance

Run the benchmark several times and compare with `benchstat`:

```bash
go test -bench=. -count=10 -benchmem | tee old.txt
# (make change)
go test -bench=. -count=10 -benchmem | tee new.txt

benchstat old.txt new.txt
# name             old time/op    new time/op    delta
# Static-8         0.30 ns ± 2%   0.30 ns ± 1%   ~     (p=0.871 n=10+10)
# Dynamic-8        2.05 ns ± 3%   1.42 ns ± 2%   -30.7% (p=0.000 n=10+10)
```

`p` is the p-value; below 0.05 means the change is statistically significant.

---

## Common Pitfalls in Dispatch Benchmarks

1. **Letting the compiler eliminate the call.** Always consume the result.
2. **Confusing inlining with dispatch.** A static call that gets inlined looks free; mark it `//go:noinline` if you want to compare *call costs* specifically.
3. **Not warming up.** First iterations pay icache and BTB cost. `b.N` runs many times, but if the benchmark function itself is called only once, predictor warm-up is included.
4. **Mixing receivers and pointers in the same benchmark.** `Calc{}` and `&Calc{}` produce different itabs and may confuse the compiler.
5. **Comparing across machines.** Cache sizes, predictor depth, and clock speed differ. Always benchmark on the deployment-target hardware.

---

## Type Assertions in Hot Loops

```go
// SLOW — assertion every iteration
for _, x := range items {
    if g, ok := x.(Greeter); ok {
        g.Hello()
    }
}

// FAST — assert once, dispatch many times
gs := make([]Greeter, 0, len(items))
for _, x := range items {
    if g, ok := x.(Greeter); ok {
        gs = append(gs, g)
    }
}
for _, g := range gs {
    g.Hello() // STATIC
}
```

The assertion itself is not free — it is roughly the cost of one itab comparison plus a branch. Hoisting it converts dynamic dispatch into static dispatch in the hot loop.

---

## Method Values vs Method Expressions Cost

A **method value** captures the receiver in a closure. If the closure escapes, that's a heap allocation:

```go
fn := obj.Handle      // closure: (obj, &Handle)
go fn()               // escapes; heap alloc
```

A **method expression** does not capture; the receiver is passed as the first argument:

```go
fn := (*Service).Handle
fn(obj, req)          // no closure; no escape
```

Benchmark:

```go
type S struct{ n int }
func (s *S) Tick() { s.n++ }

func BenchmarkValue(b *testing.B) {
    s := &S{}
    for i := 0; i < b.N; i++ {
        f := s.Tick     // closure each iteration → heap alloc
        f()
    }
}

func BenchmarkExpr(b *testing.B) {
    s := &S{}
    f := (*S).Tick      // hoisted out of loop
    for i := 0; i < b.N; i++ {
        f(s)
    }
}
```

`-benchmem` will reveal the allocation rate of the value form. The expression form is allocation-free.

---

## Reflection-Based Dispatch

```go
v := reflect.ValueOf(obj)
m := v.MethodByName("Handle")
m.Call([]reflect.Value{reflect.ValueOf(req)})
```

Cost: ~100-500 ns per call, plus allocations. Reflection-based dispatch is two orders of magnitude slower than interface dispatch and three orders slower than static dispatch. Use it only outside hot paths (config, RPC plumbing, codecs that build a static plan once).

---

## Tricky Questions

**Q1: Why is an interface call slower even when the target stays the same?**
Because the compiler cannot prove that statically. Without proof, it must emit the indirect-call sequence. The CPU's BTB makes the actual run-time cost low for monomorphic sites, but the compiler still cannot inline through the call.

**Q2: Does pointer vs value receiver change dispatch cost?**
Slightly. Pointer-receiver methods take one fewer copy; value-receiver methods on small types may be *faster* because the receiver lives in a register. The dispatch *mechanism* is the same.

**Q3: Does Go ever cache itabs across runs?**
No. Itabs are built lazily at runtime and live for the duration of the process. They are not serialized to disk.

**Q4: Why does my benchmark show 0.30 ns/op for a "method call"?**
The compiler inlined it. Add `//go:noinline` to measure raw call cost, or accept that inlining is real and benchmark the realistic call site instead.

**Q5: Can `go test -bench` measure CPU branch mispredicts?**
Not directly. Use `perf stat -e branch-misses ./bench.test -test.bench=...` on Linux to get real hardware counters.

---

## Cheat Sheet

```
ASSEMBLY MARKERS
─────────────────────────────────
CALL X(SB)            static call (label = X)
MOVQ N(AX), DX        load itab.fun[N/8] (e.g. 24 = fun[0])
CALL DX               indirect call
LEAQ "".X-fm(SB), AX  method value formation

INLINER COST ESTIMATE
─────────────────────────────────
budget ~80 nodes (Go 1.22)
each statement ~1 node
each call ~57 nodes (huge)
runtime calls usually disqualify

DISPATCH COSTS (steady state)
─────────────────────────────────
inlined static    ~0 ns
non-inlined static ~0.5-1 ns
monomorphic dynamic ~1.5-2 ns
polymorphic dynamic ~3-8 ns
reflect.Value.Call ~100-500 ns

BENCHMARK CHECKLIST
─────────────────────────────────
[ ] consume the result (sink, KeepAlive)
[ ] use -count=10 + benchstat
[ ] disable inlining if measuring call itself
[ ] reset timer after setup
```

---

## Summary

Middle-level method-dispatch knowledge is largely about *seeing* what the compiler did and writing benchmarks that don't lie. You should:

- Know that an interface call decomposes into two memory loads plus an indirect CALL.
- Be able to point at `itab.fun[i]` in assembly or in a debugger.
- Understand the BTB's role in monomorphic vs polymorphic call-site behavior.
- Use `//go:noinline` and a `sink` variable to write honest benchmarks.
- Hoist type assertions out of hot loops and prefer method expressions to method values when allocations matter.

The senior file dives deeper: how the compiler decides to devirtualize, what PGO actually changes in the binary, and how generics dispatch interacts with the inliner.
