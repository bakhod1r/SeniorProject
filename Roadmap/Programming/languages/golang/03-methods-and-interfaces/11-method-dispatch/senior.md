# Method Dispatch — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Compiler Pipeline for a Method Call](#compiler-pipeline-for-a-method-call)
3. [Devirtualization Pass — `cmd/compile/internal/devirtualize`](#devirtualization-pass-cmdcompileinternaldevirtualize)
4. [PGO Devirtualization (Go 1.21+)](#pgo-devirtualization-go-121)
5. [Reading PGO Profiles](#reading-pgo-profiles)
6. [Inliner Internals](#inliner-internals)
7. [Generics Dispatch — GCShape Stenciling](#generics-dispatch-gcshape-stenciling)
8. [Tail-Call Optimization Absence](#tail-call-optimization-absence)
9. [Itab Allocation and the Hash Map](#itab-allocation-and-the-hash-map)
10. [Cross-Function Devirtualization Limits](#cross-function-devirtualization-limits)
11. [Benchmark-Driven Refactoring](#benchmark-driven-refactoring)
12. [Compiler Flags Reference](#compiler-flags-reference)
13. [Reflection vs Code Generation](#reflection-vs-code-generation)
14. [Summary](#summary)

---

## Introduction

At the senior level, you treat the compiler as an artifact you can negotiate with. You read its diagnostics, understand its passes, and structure code so the inliner and devirtualizer have the information they need. This file walks through the relevant `cmd/compile` passes, shows how PGO rewrites call sites, and explains why generics use a hybrid dispatch strategy.

References used throughout:
- `cmd/compile/internal/devirtualize` (devirtualization passes)
- `cmd/compile/internal/inline` (inliner)
- `cmd/compile/internal/pgo` (profile parsing)
- Go 1.21 release notes: PGO general availability — https://tip.golang.org/doc/go1.21#compiler
- Go 1.22 release notes: inliner improvements — https://tip.golang.org/doc/go1.22#compiler

---

## Compiler Pipeline for a Method Call

A call like `s.Hello()` flows through these passes (simplified):

```
parse → typecheck → escape analysis →
  inline (inl.go) → devirtualize (static + PGO) →
    SSA build → SSA opt → regalloc → asm
```

Two passes are key for dispatch:
1. **inline.InlineCalls** — replaces calls with bodies when budget allows.
2. **devirtualize.Func** — turns interface calls into concrete calls when the compiler proves (or PGO suggests) the concrete type.

Devirtualization runs *before* inlining for static cases and *during* a dedicated PGO pass that may re-enter inlining.

---

## Devirtualization Pass — `cmd/compile/internal/devirtualize`

The static devirtualizer looks for patterns where the concrete type is provable from local IR:

```go
var i Iface = &Concrete{}  // static assignment dominates the call
i.M()                      // rewritten to (&Concrete{}).M
```

The pass walks the function and tracks the most-recent assignment to each interface variable. If the right-hand side is a concrete-typed expression and no further assignments intervene, the call is rewritten.

It will *not* devirtualize when:
- The interface variable is a parameter or struct field.
- An intervening function call could mutate the variable.
- The concrete type has multiple candidates along different control paths.

You can see the rewrite in `-gcflags='-m=2'`:

```
./main.go:42:5: devirtualizing i.M to *Concrete
```

This optimization has been in Go for several releases; PGO extends it to cross-function cases.

---

## PGO Devirtualization (Go 1.21+)

Profile-Guided Optimization, GA in Go 1.21, lets the compiler use a CPU profile from a representative production workload to make better decisions. For dispatch, the key effect is **PGO-driven devirtualization**: hot interface call sites get rewritten to direct calls to the most-common concrete target, with a fallback for the rare case.

### Workflow

```bash
# 1. Build instrumented (or use any pprof CPU profile)
go build -o app .
./app -cpuprofile=cpu.pprof  # or capture with net/http/pprof

# 2. Place profile next to main package
cp cpu.pprof ./default.pgo

# 3. Build with PGO (auto-detected since 1.21)
go build -o app .
```

The compiler emits a "guarded direct call":

```go
// Conceptual lowering at a hot site
if iface._type == &concrete_T_type {
    // direct call (often inlined)
    Concrete.M(iface.data, args...)
} else {
    // fallback to original indirect call
    iface.itab.fun[0](iface.data, args...)
}
```

The hot path is now a static call, often inline-able. The cold path remains correct for unanticipated concrete types.

### Caveats

- PGO only helps when the call site is **strongly biased** toward one concrete type. Diversity hurts.
- The profile must be representative; staging-only profiles can mislead the compiler.
- Each release improves the heuristics; benchmark before assuming a win.

See: https://go.dev/doc/pgo

---

## Reading PGO Profiles

```bash
go tool pprof -list "MyMethod" default.pgo
go tool pprof -peek "MyMethod" default.pgo
```

The `-peek` output shows callers and callees with relative weights — those weights are exactly what the compiler uses to rank devirtualization candidates.

For build-time confirmation:

```bash
go build -gcflags='-m=2 -d=pgodebug=1' . 2>&1 | grep -E 'devirt|PGO'
# main.go:42:5: PGO devirtualizing i.M to *Concrete (weight 0.94)
```

`pgodebug=1` (and higher levels) prints the devirtualizer's deliberations.

---

## Inliner Internals

The inliner's budget is enforced in `cmd/compile/internal/inline/inl.go`. Each AST node has a "cost":

| Construct | Cost (approx, Go 1.22) |
|---|---|
| Trivial assignment / arithmetic | 1 |
| Function call | 57 |
| Type assertion | 1 |
| Interface call | 57 (similar to call) |
| `defer` | 8+ |
| `select` / `range` | 7 |

Total budget: ~80. A method with a single function call inside its body usually fits; two function calls usually do not. Note that "function call" includes runtime calls — `fmt.Sprintf`, `make`, etc.

### Mid-stack inlining (1.10+)

Go inlines through several call levels (mid-stack). A method that calls a small helper can still be inlined if the helper is itself inlinable.

### `//go:nosplit`, `//go:noinline`, `//go:registerparams`

These pragmas affect inlining and ABI. `//go:noinline` is the only one safe for general use.

### Diagnosing failures

```
./main.go:9:6: cannot inline (*Big).Process: function too complex: cost 142 exceeds budget 80
```

Refactor: extract slow paths (rare branches, error-formatting) into separate non-inlined functions, leaving the hot path tight.

---

## Generics Dispatch — GCShape Stenciling

Go 1.18 generics use a *hybrid* approach known as **GCShape stenciling**. Instead of full monomorphization (one copy per concrete type) or pure dictionary passing (one copy total), the compiler groups types by their **GC shape**: the layout that affects garbage collection (size, pointer mask).

```go
func Sum[T int | float64 | int32](xs []T) T { ... }
```

GCShape grouping (as of Go 1.22):
- All scalar 8-byte types → one stencil
- All pointer-shaped types → one stencil with a runtime dictionary
- Each unique GC shape → its own stencil

### Implication for dispatch

Methods on generic types dispatch through a **dictionary** that contains itab-like pointers when the type parameter resolves to a pointer-shape group. Calls within the generic function go through this dictionary, costing roughly the same as an interface call.

```go
type Set[T comparable] struct{ m map[T]struct{} }
func (s *Set[T]) Add(v T) { s.m[v] = struct{}{} }
```

If `T = string`, you get a dedicated stencil — fast, direct map access. If `T = *MyType`, you share a stencil with all pointer types and pay a dictionary indirection on operations that depend on the type.

### Verifying

```bash
go build -gcflags='-m=2' . 2>&1 | grep -E 'dictionary|GCshape'
```

PGO and the inliner often hide the cost in practice. Benchmark hot generic code with realistic types.

---

## Tail-Call Optimization Absence

Go does **not** perform tail-call optimization (TCO). A call like:

```go
func (s *Server) Forward(req Req) Resp { return s.Handle(req) }
```

does not become a `JMP` — it is a real `CALL` that grows the stack. Two consequences:
1. Recursive method chains can stack-overflow.
2. Wrapping for instrumentation costs a frame.

The Go team has historically declined TCO because it complicates stack traces and runtime introspection. Workaround: rewrite tight recursion as iteration.

---

## Itab Allocation and the Hash Map

Itabs live in `runtime.itabTable`, a custom hash table with key `(interface*, _type*)`. On first use of a (concrete, interface) pair the runtime calls `getitab`, which:

1. Hashes the pair.
2. Looks up an existing itab; returns it if found.
3. Otherwise allocates a new itab, populates `fun[]` by walking the concrete type's method table, and stores it.

The lookup is roughly 30-60 ns the first time. After that the itab pointer is cached in the interface value (or the concrete type's metadata) and subsequent calls cost the regular indirect-call price.

### Memory cost

An itab is `O(num methods)` in size: roughly `40 + 8*N` bytes. A program with many interfaces and many concrete types pays a fixed memory tax that is normally negligible (KBs total).

---

## Cross-Function Devirtualization Limits

Static devirtualization stops at function boundaries because the compiler does not perform aggressive interprocedural analysis (IPA). Consider:

```go
func process(a Adder, n int) int {
    sum := 0
    for i := 0; i < n; i++ {
        sum += a.Add(i)  // dynamic — concrete type came from caller
    }
    return sum
}

func main() {
    process(Calc{}, 1000)  // caller knows it's Calc, callee does not
}
```

Without inlining, `process` cannot be devirtualized. With inlining, the body of `process` is pasted into `main`, and the local devirtualizer can act. So the practical recipe is: keep dispatch-sensitive functions small and inline-able.

PGO bridges this gap by *guarded devirtualization* at the call site, even without inlining.

---

## Benchmark-Driven Refactoring

A senior workflow when you suspect dispatch cost:

```
1. Write the benchmark with realistic data.
2. Capture a CPU profile: go test -bench=. -cpuprofile=cpu.out
3. View top: go tool pprof -top cpu.out
4. Inspect the suspicious function: pprof> list MyMethod
5. Disassemble: pprof> disasm MyMethod
6. Look for indirect CALL instructions in hot lines.
7. If found, choose: pin concrete type, hoist assertion, or apply PGO.
8. Re-run benchmark with -count=10 + benchstat.
```

Example output:

```
(pprof) disasm Process
. . . 4203a0:  movq 24(rax), rdx       ; itab.fun[0]
. . . 4203a4:  call rdx                ; <-- hot indirect call
```

A 30% sample-share on this CALL is your signal.

---

## Compiler Flags Reference

| Flag | Purpose |
|---|---|
| `-gcflags='-m'` | Inline + escape decisions |
| `-gcflags='-m=2'` | Verbose; includes devirtualization |
| `-gcflags='-S'` | Print assembly |
| `-gcflags='-d=ssa/check_bce/debug=1'` | Bounds-check elimination |
| `-gcflags='-d=pgodebug=1'` | PGO devirtualizer logs |
| `-gcflags='-d=pgodebug=2'` | More verbose PGO output |
| `-gcflags='-l'` | Disable inlining |
| `-gcflags='-N'` | Disable optimizations (debug builds) |
| `GOSSAFUNC=Func` | Dump SSA passes for one function |

`GOSSAFUNC=Process go build .` dumps an HTML view of every SSA pass for `Process` — invaluable for understanding why the compiler did or did not optimize.

---

## Reflection vs Code Generation

When you need polymorphism over types unknown at compile time (codecs, RPC, ORM), two strategies exist:

1. **Reflection**: `reflect.Value.MethodByName(...).Call(...)`. ~100-500 ns per call. Easy to write. Slow.
2. **Code generation**: `go generate` produces a switch statement (or table of method values) per concrete type. Static dispatch. Fast.

Many high-performance libraries (`gogoproto`, `easyjson`, `sqlc`, `mockgen`) take the codegen path precisely because reflection-based dispatch dominates the profile in steady state. The trade-off is build complexity for runtime speed.

A modern alternative is generics + interface constraint, which lets the compiler stencil per type:

```go
type Marshaler[T any] interface {
    Marshal(v T) ([]byte, error)
}
```

Per-type stencils give static dispatch within the generic body. For pointer types you still pay the dictionary cost, but it is generally lower than reflection.

---

## Summary

Senior-level method-dispatch mastery means:

1. Understanding the `cmd/compile` pipeline at the level of "inline → devirtualize → SSA."
2. Reading `-gcflags='-m=2'` and `-d=pgodebug` output fluently.
3. Knowing when PGO will help (single hot concrete target) and when it will not.
4. Recognizing GCShape stenciling and its dictionary indirection cost in generics.
5. Accepting that Go has no TCO and refactoring recursion accordingly.
6. Choosing between reflection and codegen based on hot-path profiles.

You should be able to take a profile of a real service, point at one indirect CALL, and say with confidence: "hoist this assertion / pin this type / enable PGO / inline this helper." The professional file extends these techniques to production workflows: deciding on observability hooks, dealing with multi-impl interface call sites, and shipping PGO into CI.
