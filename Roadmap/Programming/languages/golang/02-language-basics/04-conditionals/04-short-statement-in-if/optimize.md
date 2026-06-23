# Go Short Statement in If — Optimize

## 1. The Honest Answer Up Front

The init form is **not a performance feature**. It is a syntactic and scoping feature. The Go compiler emits identical machine code for:

```go
if v := f(); v > 0 { use(v) }
```

and:

```go
{
    v := f()
    if v > 0 { use(v) }
}
```

You can verify this with `go tool compile -S` on either form — the assembly is byte-identical. Anything in this document that talks about register pressure or escape analysis differences is **at most** a few cycles per call and almost never a real-world concern. Optimizing for the init form is optimizing for **readability and correctness**, not for performance.

That said, there are a few cases worth understanding for completeness.

---

## 2. What the Compiler Sees

After parsing and type-checking, the compiler lowers the init form by hoisting the init statement above the if and emitting the if as a normal branch. By the time SSA is built, there is no trace of the init form. The optimizer treats the variable identically to any local.

Verify with:

```bash
go build -gcflags="-S" your.go 2>&1 | less
```

Two functions that differ only in init form vs hoisted declaration produce the same instruction stream.

---

## 3. Tighter Scope and Register Allocation

The compiler can sometimes keep a variable in a register longer when its lifetime is shorter. Init form **shortens** the lifetime relative to a hoisted declaration only when the hoisted version creates uses past the if. Compare:

**Init form:**
```go
func a(x int) int {
    if y := x * 2; y > 10 {
        return y
    }
    return 0
}
```

**Hoisted, used after the if:**
```go
func b(x int) int {
    y := x * 2
    if y > 10 {
        return y
    }
    return y - 1 // y still alive
}
```

The first compiles to a tight branch; the second keeps `y` live through both paths. But the comparison is unfair — they do different work. If you write the equivalent function:

**Hoisted, equivalent semantics:**
```go
func a2(x int) int {
    y := x * 2
    if y > 10 {
        return y
    }
    return 0
}
```

`a` and `a2` produce the same SSA: `y` is computed, compared, returned or dropped. The compiler's liveness analysis is local; it doesn't matter whether the source spelling used init form.

The **takeaway**: tighter source-level scope does not by itself change codegen. The compiler reasons about lifetime per-SSA-value, not per-source-block.

---

## 4. Escape Analysis

Init form does not affect escape analysis. The escape analyzer looks at where pointers go:

```go
if p := newThing(); p.OK() {
    p.Use()
}
```

vs

```go
p := newThing()
if p.OK() {
    p.Use()
}
```

Both produce the same `escapes` decision. If `p`'s allocation is captured by something that survives the function (channel, return, package var), it escapes. If not, it stays on the stack.

Init form **does not** make a stack allocation more likely. The myth that "tighter scope keeps things on the stack" is wrong: the analyzer does not consider source-level scope — it considers data flow.

---

## 5. Benchmarks

Benchmarks confirming equivalence:

```go
package init_test

import "testing"

func init1(x int) int {
    if y := x * 2; y > 10 {
        return y
    }
    return 0
}

func hoist1(x int) int {
    y := x * 2
    if y > 10 {
        return y
    }
    return 0
}

var sink int

func BenchmarkInit(b *testing.B) {
    for i := 0; i < b.N; i++ {
        sink = init1(i)
    }
}

func BenchmarkHoist(b *testing.B) {
    for i := 0; i < b.N; i++ {
        sink = hoist1(i)
    }
}
```

Typical result on a modern machine:

```
BenchmarkInit-12     1000000000   0.45 ns/op
BenchmarkHoist-12    1000000000   0.45 ns/op
```

Identical to within noise. Run on a quiet machine with `-count=10` to confirm.

---

## 6. The Comma-Ok Edge Cases

Comma-ok forms (`v, ok := m[k]`) compile slightly differently from a single-result map index. The two-result form sets `ok = true` if present, `ok = false` if absent, with `v` always set to the zero value if absent. The single-result form returns the zero value silently.

Whether this is in init or hoisted does not matter; the codegen difference comes from comma-ok vs single result.

```go
// Single result:
v := m[k]              // one map-access call
if v > 0 { ... }       // condition test

// Comma-ok in init:
if v, ok := m[k]; ok && v > 0 { ... } // one map-access call, two-result form
```

The two-result form is a slightly different runtime call (`runtime.mapaccess2` vs `runtime.mapaccess1`), but both are O(1). The "ok" path adds a small constant overhead — typically a few nanoseconds — which is dominated by the actual work.

---

## 7. When You Might See a Real Difference

In extreme microbenchmarks, you can construct cases where the init form vs hoisted form produce different register schedules. These differences are:

- Sub-nanosecond per call
- Highly dependent on surrounding code
- Reproducibility-fragile

If you see such a result, the right action is to verify with `go tool objdump`, confirm what changed, and decide whether the cosmetic change is worth a constant-factor improvement at the third decimal place.

In production code: the answer is no. Choose init form for clarity, not for nanoseconds.

---

## 8. The Real Optimization: Avoiding Bugs

The init form's optimization story is **bug avoidance**, not speed:

1. **Eliminating stale-err reads** prevents incorrect behavior that would have been logged or returned wrong values — savings: real production incidents avoided.
2. **Comma-ok in init** distinguishes "missing" from "zero", preventing silent zero-value bugs.
3. **Type assertion guards** prevent panics that would have crashed the process.
4. **Switch-init** avoids redundant computation in cases that share an input.

If you want to optimize, optimize for these correctness wins. Performance is essentially flat.

---

## 9. Switch-Init Sharing

The one place where init **does** consistently save work is switch:

```go
// Without init:
switch f().Kind() {
case A: ...
case B: ...
case C: ...
}
// f() called once (the tag is evaluated once)

// With init:
switch x := f(); x.Kind() {
case A: ...
case B: ...
case C: ...
}
// f() called once; x available in all cases
```

Both forms call `f()` exactly once. The difference is that the init form **names** the result, so cases can reference it. Without init, you would either recompute (wasteful) or hoist (verbose):

```go
// Hoisted:
x := f()
switch x.Kind() {
case A: useA(x)
case B: useB(x)
}
```

Same performance, slightly more verbose. The init form is purely a readability win.

---

## 10. Type Switch With Init

```go
switch x := lookup(); v := x.(type) {
case int: ...
case string: ...
}
```

`lookup()` runs once. The type switch then dispatches on `x`'s dynamic type. Without init, you would extract `lookup()` to a variable explicitly. The performance is the same; init keeps `x` scoped tightly.

---

## 11. For-Init: A Different Story

The for-init is not exactly the same as if-init for performance, because of the Go 1.22 loop-variable change:

```go
for i := 0; i < n; i++ { body }
```

Pre-1.22: `i` is a single stack slot reused per iteration.
Go 1.22+: each iteration of `body` (when captured by an escaping closure) sees a fresh `i`.

This is a different optimization story; it does not apply to if-init or switch-init, which run once per execution.

---

## 12. Compile-Time Cost

Type-checking init form takes about the same as a hoisted declaration. The parser does slightly more work because it has to look ahead for the optional `;`, but this is dominated by the rest of the file. Compile-time cost is not a concern.

---

## 13. Microbench: Map Comma-Ok in Init vs Hoisted

```go
package init_test

import "testing"

var globalMap = map[string]int{
    "a": 1, "b": 2, "c": 3, "d": 4, "e": 5,
}

func initForm(k string) int {
    if v, ok := globalMap[k]; ok {
        return v
    }
    return 0
}

func hoistedForm(k string) int {
    v, ok := globalMap[k]
    if ok {
        return v
    }
    return 0
}

var sink int

func BenchmarkInitForm(b *testing.B) {
    for i := 0; i < b.N; i++ {
        sink = initForm("c")
    }
}

func BenchmarkHoistedForm(b *testing.B) {
    for i := 0; i < b.N; i++ {
        sink = hoistedForm("c")
    }
}
```

Typical results:

```
BenchmarkInitForm-12      200000000   7.5 ns/op
BenchmarkHoistedForm-12   200000000   7.5 ns/op
```

Identical. The map access dominates; the surrounding init/hoist syntax is not visible at the assembly level.

---

## 14. Microbench: Type Assertion in Init

```go
type Marker interface{ marker() }
type T struct{}
func (T) marker() {}

func init1(i any) bool {
    if _, ok := i.(Marker); ok {
        return true
    }
    return false
}

func hoist1(i any) bool {
    _, ok := i.(Marker)
    if ok {
        return true
    }
    return false
}
```

Both compile to:

```
MOVQ i, AX
... type-assertion runtime check ...
JZ false_branch
MOVB $1, ret
RET
false_branch:
MOVB $0, ret
RET
```

The "ok" comma form costs the same in either shape. The runtime call (`runtime.assertI2I` or similar) is the dominant cost, ~10ns; init/hoist syntax adds 0 ns.

---

## 15. Switch-Init Cost When Tag Is Expensive

```go
func slowKey() Key { ... }

func dispatch(args ...) {
    switch k := slowKey(); k {
    case keyA: ...
    case keyB: ...
    case keyC: ...
    }
}
```

`slowKey()` runs once. The switch dispatches via a series of comparisons. If we wrote this without init:

```go
switch slowKey() {
case keyA: ...
case keyB: ...
case keyC: ...
}
```

`slowKey()` still runs once — the tag is evaluated once per switch by the spec. Init form is identical.

The performance cost is `slowKey()` itself; init form's only contribution is to **name** the result. If you need `k` inside a case, init is required (or hoist outside).

---

## 16. PGO and Init Form

Profile-guided optimization (Go 1.21+) inlines hot indirect calls. Init form does not affect this — the calls inside an init are subject to the same inlining heuristics as any other call. PGO does not look at source-level structure.

---

## 17. Summary

- Init form is purely a readability / scope feature.
- Compiler produces identical code to a hoisted declaration.
- No measurable performance difference in benchmarks.
- The "optimization" is bug prevention: stale errs, zero-value confusion, panics on type assertion, and missed channel-close cases.
- Switch-init saves typing, not cycles.
- Choose init form for clarity. If a microbenchmark prefers one shape, suspect noise first; verify with assembly second.

Performance-tuning the init form is optimizing the wrong layer. Spend the time on algorithm choice, allocation patterns, and contention — those move the dial.

---

## 18. Inlining Behavior

Functions called inside an init are subject to the standard inliner. Init form does not affect inlining decisions:

```go
//go:noinline
func notInlined(x int) int { return x * 2 }

func a(x int) int {
    if y := notInlined(x); y > 0 { return y }
    return 0
}

func b(x int) int {
    y := notInlined(x)
    if y > 0 { return y }
    return 0
}
```

Both `a` and `b` produce identical assembly:

```
MOVQ x, DI
CALL notInlined
TESTQ AX, AX
JLE zero
RET
zero:
XORQ AX, AX
RET
```

The init form is not a "barrier" to optimization; it is invisible to the inliner.

---

## 19. Goroutine Scheduling

Spawning a goroutine inside an if-branch does not interact with init form. The init runs synchronously before any goroutine is started:

```go
go func() {
    if v, ok := <-ch; ok {
        process(v)
    }
}()
```

The `<-ch` runs inside the goroutine; the goroutine starts when `go func() {...}()` is reached. Init form has no special scheduling behavior.

---

## 20. Stack Frame Size

Variables declared in init occupy stack slots in the enclosing function's frame. Two `if v := f(); ...` sequences each declare a `v` — but if their lifetimes do not overlap (one ends before the other begins), the compiler may reuse the same stack slot.

```go
func f() {
    if v := op1(); v > 0 { use(v) }
    if v := op2(); v > 0 { use(v) }
}
```

Two distinct `v` variables, but their live ranges do not overlap. The compiler can place them at the same offset in the frame. Stack frame size is unchanged from a hoisted-and-reused version:

```go
func g() {
    var v int
    v = op1()
    if v > 0 { use(v) }
    v = op2()
    if v > 0 { use(v) }
}
```

Same stack frame, same code.

---

## 21. Final Word

Performance considerations for the init form are essentially nil at the source level. The compiler treats it as identical to a hoisted declaration. The optimizations worth pursuing in Go are:

- Reducing allocations in hot paths (escape analysis matters here).
- Avoiding lock contention.
- Choosing better algorithms.
- Sizing channels and buffers correctly.

The init form is a pure scope/readability tool. Choose it for clarity. Reach for it because the code reads better, not because you expect a performance win — there is none to be had.
