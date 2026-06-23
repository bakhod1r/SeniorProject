# Method Dispatch — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [Production Dispatch Audit](#production-dispatch-audit)
3. [PGO in CI/CD](#pgo-in-cicd)
4. [Choosing Between Interfaces and Concrete Types in Public APIs](#choosing-between-interfaces-and-concrete-types-in-public-apis)
5. [Hot-Path Refactor Patterns](#hot-path-refactor-patterns)
6. [Observability for Dispatch Hot Spots](#observability-for-dispatch-hot-spots)
7. [Multi-Impl Call Sites — Megamorphic Mitigation](#multi-impl-call-sites-megamorphic-mitigation)
8. [Code-Generation Alternatives](#code-generation-alternatives)
9. [Generics Adoption Strategy](#generics-adoption-strategy)
10. [Versioning and ABI Stability](#versioning-and-abi-stability)
11. [Anti-Patterns at Scale](#anti-patterns-at-scale)
12. [Tooling Stack](#tooling-stack)
13. [Summary](#summary)

---

## Introduction

A professional perspective on method dispatch is operational: you own a binary running at scale, and a small percentage of its CPU is spent inside `runtime.itab.fun[i]` indirections. You need a repeatable workflow that detects dispatch hot spots, applies the right fix, validates the win, and ships it through your release pipeline — without breaking the API contract or destabilizing CI.

This file is structured as a playbook.

---

## Production Dispatch Audit

### Step 1 — Capture a representative profile

```bash
# From a running service exposing net/http/pprof
curl -o cpu.pprof "http://prod-host/debug/pprof/profile?seconds=60"
```

Capture during peak load with realistic traffic mix. Avoid profiling during cold start.

### Step 2 — Sample-attribute to indirect calls

```bash
go tool pprof -focus="runtime.itab|runtime.assertI|runtime.convI" cpu.pprof
(pprof) top
(pprof) list HotMethod
```

If `runtime.assertI2I`, `runtime.convI2I`, `runtime.typehash`, or interface call instructions show up high, dispatch is paying.

### Step 3 — Disassemble the suspect

```
(pprof) disasm HotMethod
```

Look for `CALL *DX` (or similar indirect-call patterns) in lines with high sample counts. Trace back to the source: which interface variable backs that call?

### Step 4 — Decide

Three classes of fix:
1. **Pin** — replace the interface with a concrete type (or pointer).
2. **Hoist** — move a type assertion out of the loop.
3. **PGO** — apply profile-guided devirtualization without source changes.

Each has trade-offs in API surface and code complexity.

---

## PGO in CI/CD

### Profile collection pipeline

```
production → continuous CPU profiling (Pyroscope, Polar Signals, Datadog) →
  daily aggregated profile → committed as default.pgo → next build picks it up
```

### Key practices

- **Aggregate** profiles across replicas to capture realistic call diversity.
- **Refresh** weekly; stale profiles can mislead the compiler when traffic patterns shift.
- **Pin** profiles per major release branch — don't share profiles across versions with different code shape.
- **Validate** with benchmarks; PGO occasionally regresses individual functions.

### Build flag

Since Go 1.21, `default.pgo` next to `main` is auto-detected. Explicit form:

```bash
go build -pgo=cpu.pprof -o app .
```

### Reproducibility

PGO builds are deterministic given the same source + same profile. Commit the profile to source control if you need byte-identical artifacts.

### CI gates

Add a benchmark suite to CI that compares PGO and non-PGO builds for headline benchmarks. Fail if PGO regresses by more than a configured threshold.

```yaml
# example CI step
- run: go test -bench=. -count=10 -cpu=4 ./... > non-pgo.txt
- run: go test -pgo=default.pgo -bench=. -count=10 -cpu=4 ./... > pgo.txt
- run: benchstat non-pgo.txt pgo.txt
```

---

## Choosing Between Interfaces and Concrete Types in Public APIs

### Heuristic table

| Situation | Recommendation |
|---|---|
| Single in-tree implementation | Concrete (no interface) |
| Multiple implementations exist | Interface (small, on consumer side) |
| Mock-only second implementation | Concrete + integration tests, or table-driven mocks |
| Caller is a library that takes I/O | Interface (`io.Reader`, etc.) |
| Hot-path serializer | Concrete + codegen |
| User-extensible plugin | Interface, accept dispatch cost |

### Consumer-side interfaces

The Go idiom — *accept interfaces, return structs* — also helps dispatch. Returning a concrete type lets the caller statically dispatch its own methods. Accepting an interface keeps your function flexible without forcing dynamic dispatch on the caller's hot loop.

### Splitting interfaces by hotness

Sometimes the same component has hot and cold operations. Split the interface:

```go
// Cold path — interface is fine
type Configurable interface { Configure(...) }

// Hot path — accept concrete or generic
func Process[E Encoder](e E, items []Item) {
    for _, it := range items {
        e.Encode(it)  // static dispatch via stencil
    }
}
```

---

## Hot-Path Refactor Patterns

### Pattern A — Concrete-type pinning

Before:

```go
type Encoder interface { Encode(v any) error }

func Drain(e Encoder, ch <-chan Item) error {
    for it := range ch {
        if err := e.Encode(it); err != nil { return err }
    }
    return nil
}
```

After:

```go
func Drain(e *JSONEncoder, ch <-chan Item) error { ... }
```

The interface is gone from the hot path; calls are static and inline-able.

### Pattern B — Type switch outside the loop

```go
// Before
for _, w := range writers {
    w.Write(buf) // megamorphic
}

// After
for _, w := range writers {
    switch v := w.(type) {
    case *bytes.Buffer:
        // hot path; statically dispatched
        for _, b := range buf { v.WriteByte(b) }
    default:
        v.Write(buf) // cold path
    }
}
```

You now have a static path for the common case and an interface fallback. Combine with PGO for similar effect with less source change.

### Pattern C — Method expression cache

When you must dispatch on user-selected operation:

```go
type opFn = func(*Engine, Args) Result

var ops = map[string]opFn{
    "encode": (*Engine).Encode,
    "decode": (*Engine).Decode,
}

// Lookup once, call many
fn := ops[opName]
for _, args := range batch {
    fn(eng, args) // single indirect call, no itab walk
}
```

Method expressions skip itab — the function pointer is direct. The remaining indirection is the unavoidable function-pointer call.

### Pattern D — Generic stencil

```go
func Process[E Encoder](e E, items []Item) error {
    for _, it := range items {
        if err := e.Encode(it); err != nil { return err }
    }
    return nil
}
```

When called with a concrete `*JSONEncoder`, Go stencils a copy where `e.Encode` is statically dispatched (or near-static via dictionary).

---

## Observability for Dispatch Hot Spots

### Metrics

Export per-method latency histograms only for *cold* operations. Don't instrument the hot loop itself.

### Tracing

For dispatch debugging, add a build tag:

```go
//go:build dispatchtrace

func init() {
    runtime.SetMutexProfileFraction(1)
    runtime.SetBlockProfileRate(1)
}
```

Capture the production profile *without* this tag; use it ad-hoc for diagnosis.

### Continuous profiling

Tools like Pyroscope or Polar Signals make production profiles available for every release. Treat the profile like a log: keep history, diff between releases, alert on regressions.

### Synthetic benchmark suite

Maintain a `benchmarks/` package with the 5-10 most performance-critical workloads. Run on every PR. Surface results as a PR comment.

---

## Multi-Impl Call Sites — Megamorphic Mitigation

A "megamorphic" call site sees many distinct concrete types over its lifetime. The CPU's BTB cannot track them; predictor accuracy collapses. Symptoms:

- High `branch-misses` in `perf stat`.
- High icache misses (different method bodies on each call).

### Mitigation strategies

1. **Specialize**: split the monolithic call site into per-type pipelines.
2. **Sort**: process all `*A` then all `*B`; turn megamorphic into batched-monomorphic.
3. **Inline-friendly switch**: an explicit type switch with a few common types and a default lets the compiler inline the hot cases.
4. **Reduce diversity**: do you really need 12 implementations, or can you collapse?

### Example: codec dispatch

A JSON encoder originally walked `[]Marshaler` calling `MarshalJSON` on every element. With ~50 distinct concrete types, the predictor saturates. Refactor:

```go
// Group by concrete type before encoding
groups := groupByType(items)
for _, g := range groups {
    encodeGroup(g) // each call site is monomorphic per group
}
```

---

## Code-Generation Alternatives

When dispatch is a documented bottleneck and changing the API isn't an option:

| Tool | Use case |
|---|---|
| `easyjson` | Replace `encoding/json` for hot endpoints |
| `gogoproto` | Generate Marshal/Unmarshal without reflection |
| `mockgen` | Cheap test mocks (still interfaces) |
| `sqlc` | Compile SQL → typed Go (no ORM reflection) |
| custom `go generate` | Type-specific dispatch tables |

Codegen pushes dispatch cost from runtime to build time. The trade-off is repository complexity and longer build times.

---

## Generics Adoption Strategy

When introducing generics into a codebase that previously used interfaces:

1. **Start at the leaf**: rewrite a small utility (`Map`, `Filter`, `Reduce`) first.
2. **Benchmark before/after**: confirm the stencil actually beats the interface version for your concrete types.
3. **Be aware of GCShape sharing**: pointer-shaped type parameters all share one stencil; benchmark with the concrete type, not just `any`.
4. **Avoid generic everything**: generic functions with `any` constraint and many call sites compile slower and may not dispatch better.
5. **Watch binary size**: each unique GCShape stencil adds code; modest growth is normal, 10x is a smell.

---

## Versioning and ABI Stability

Method dispatch decisions can leak into ABI:

- Adding a method to an exported interface is a **breaking change** for implementers.
- Removing a method is breaking for callers.
- Changing receiver from value to pointer alters method-set membership for embedders.
- Switching a public type from concrete to interface (to allow alternate implementations) is breaking.

Plan deprecation cycles. If you must change a public interface, add a new minor version of the interface (`type Foo2 interface { Foo; NewMethod() }`) and migrate callers.

---

## Anti-Patterns at Scale

### Anti-pattern 1 — "Interface everywhere for testability"

Inflates the public API, forces dynamic dispatch on every call, and creates mock proliferation. Use concrete types in production code; mock at integration boundaries.

### Anti-pattern 2 — `interface{}` (or `any`) as a default parameter type

Every call boxes the argument, paying allocation + type-info cost. Limit to true universal containers (event buses, generic caches).

### Anti-pattern 3 — One giant `Service` interface with 30 methods

Implementations must satisfy all of them. Itabs become large. Split by responsibility.

### Anti-pattern 4 — Reflection-based dispatch in steady state

Reflection-based hot loops are 100-500x slower than static dispatch. Replace with codegen or generics.

### Anti-pattern 5 — Premature PGO

PGO without a real bottleneck adds CI complexity for marginal wins. Profile first; apply PGO when the profile justifies it.

---

## Tooling Stack

A mature dispatch-aware setup includes:

- `go test -bench` + `benchstat` (significance testing)
- `go tool pprof` (CPU + memory profiling)
- `go tool objdump` (verify static vs indirect calls in the binary)
- `perf stat` on Linux for hardware counters (branch-misses, icache-misses)
- Continuous profiler in production (Pyroscope, Datadog Profiler, Polar Signals)
- `golangci-lint` with custom analyzers for "no interface in hot package X"
- `staticcheck` SA family (unused fields, dead code that bloats itabs)
- PGO profile management (artifact storage, refresh cadence)

---

## Summary

Professional dispatch tuning is a process, not a single optimization:

1. **Audit** with profiles, focusing on indirect-call samples.
2. **Decide** between pinning, hoisting, PGO, codegen, or generics.
3. **Validate** with benchmarks and `benchstat`.
4. **Ship** behind feature flags or canaries.
5. **Refresh** PGO profiles regularly; stale profiles are worse than none.
6. **Resist** premature optimization — most code is not hot enough to matter.

Combine these practices with the senior-level understanding of the compiler pipeline, and you can confidently own dispatch performance in a multi-team Go codebase.
