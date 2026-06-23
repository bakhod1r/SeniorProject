# Modern Standard-Library Additions — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [What Changed and Why It Matters](#what-changed-and-why-it-matters)
3. [`slog` as an Architectural Decision](#slog-as-an-architectural-decision)
4. [The Generic Toolkit and the End of `x/exp`](#the-generic-toolkit-and-the-end-of-xexp)
5. [`math/rand/v2`: a Case Study in API Evolution](#mathrandv2-a-case-study-in-api-evolution)
6. [`unique` and Memory Architecture](#unique-and-memory-architecture)
7. [The 1.22 Router Decision: Stdlib vs Framework](#the-122-router-decision-stdlib-vs-framework)
8. [Version Floors as a Dependency Constraint](#version-floors-as-a-dependency-constraint)
9. [Adoption Strategy for an Existing Codebase](#adoption-strategy-for-an-existing-codebase)
10. [Performance Considerations](#performance-considerations)
11. [Anti-Patterns](#anti-patterns)
12. [Senior-Level Checklist](#senior-level-checklist)
13. [Summary](#summary)

---

## Introduction

A senior engineer does not ask "how do I call `slog.Info`." They ask: *what does adopting this change about our architecture, our dependency graph, our minimum-version contract, and our performance envelope?* The Go 1.21–1.24 stdlib additions are not just convenience functions; they shift where the boundary sits between "the language gives me this" and "I pull in a dependency for this."

The mechanics are in [junior.md](junior.md) and [middle.md](middle.md). This file is about *judgement*: what changed, why the Go team made these calls, and how to adopt them deliberately.

After reading this you will:
- Frame each addition as a trade-off, not a feature checklist
- Decide `slog` handler architecture for a real system
- Reason about the `x/exp` graduation and its signature changes
- Understand `math/rand/v2` as a model for how Go evolves APIs under the compatibility promise
- Make the stdlib-router-vs-framework call with evidence
- Plan a phased adoption across a large codebase

---

## What Changed and Why It Matters

Step back and look at the *theme* of 1.21–1.24: **the standard library absorbed the most-copied third-party patterns, made possible by generics (1.18) and iterators (1.23).** Each addition removes a recurring reason teams added a dependency.

| Addition | The third-party thing it replaces | Why the Go team did it now |
|----------|-----------------------------------|----------------------------|
| `log/slog` | `logrus`, `zap`, `zerolog` (for the *interface*) | Structured logging was universal; a stdlib *interface* lets libraries log without imposing a logger. |
| `slices`/`maps`/`cmp` | `lo`, hand-rolled helpers, `x/exp` | Generics finally made type-safe helpers expressible in stdlib. |
| `math/rand/v2` | nothing external; fixes v1's design debt | The compatibility promise blocked fixing v1 in place; v2 is the escape hatch. |
| `unique` | `intern` libraries, ad-hoc dedup maps | High-cardinality-repetitive data is common; weak-reference interning needs runtime support. |
| `net/http` routing | `chi`, `gorilla/mux`, `gin` (for *routing*) | The single most common reason to add a router was method + path-variable matching. |

The strategic point for a senior: **your default dependency footprint should shrink.** A new Go 1.22+ service can do structured logging and RESTful routing with zero third-party imports. That is fewer CVEs to track, fewer `go.mod` lines, faster builds, and a smaller audit surface.

But "can" is not "should everywhere." The `slog` interface is excellent; `zap` may still win on raw throughput. The stdlib router is excellent; `chi` still wins on middleware ergonomics. Senior judgement is knowing where the stdlib is now *sufficient* and where a dependency still earns its keep.

---

## `slog` as an Architectural Decision

`slog`'s most important design choice is the **`Logger` / `Handler` split**. This is not cosmetic — it is what makes `slog` the right *interface* even when you do not use its *handlers*.

### The interface vs implementation separation

`slog.Handler` is an interface:

```go
type Handler interface {
    Enabled(context.Context, Level) bool
    Handle(context.Context, Record) error
    WithAttrs(attrs []Attr) Handler
    WithGroup(name string) Handler
}
```

Anyone — including `zap`, `zerolog`, an OpenTelemetry bridge, a test buffer — can implement `Handler`. This means:

- **Libraries log against `*slog.Logger`** (or the default) without imposing a logging *implementation* on the application. Before `slog`, a library that used `logrus` forced `logrus` on every consumer. Now a library calls `slog.Default()` and the application decides the backend.
- **The application chooses the handler**: `slog`'s JSON handler in prod, a pretty handler in dev, a `slogtest`-friendly handler in tests, or a high-performance third-party handler (`slog-zap`, `slog-zerolog`) where throughput matters.

This is the real architectural win: `slog` standardised the *seam*, not the *engine*. Treat it as the logging equivalent of `io.Reader`.

### Handler architecture decisions for a service

- **Where do request-scoped fields live?** Either bind with `logger.With("trace_id", id)` per request and thread the logger through, or write a custom handler whose `Handle(ctx, record)` extracts trace/tenant from `ctx`. The latter keeps call sites clean but couples the handler to your context conventions. Most teams thread a `*slog.Logger`.
- **Redaction is a handler concern.** `ReplaceAttr` or a wrapping handler should drop secrets/PII centrally, not at every call site.
- **Sampling and rate-limiting** belong in a wrapping handler, not in business code.
- **Fan-out** (write to stdout *and* a remote collector) is a multi-handler wrapper.

The lesson: design *handlers* as the policy layer. Keep call sites declarative (`slog.Info("order placed", "id", id)`), and put cross-cutting concerns in the handler.

---

## The Generic Toolkit and the End of `x/exp`

`slices`, `maps`, and `cmp` are the *graduation* of `golang.org/x/exp/slices`, `/maps`, `/constraints` into the standard library — but graduation came with deliberate changes.

### Why the signatures changed at graduation

The most consequential: **`maps.Keys` and `maps.Values` changed from returning `[]K` to returning `iter.Seq[K]`** when iterators landed in 1.23. The experimental versions predated iterators. Once `range`-over-func existed, returning an iterator was the more composable choice: it allocates nothing unless you collect, and it composes with `slices.Sorted`, `slices.Collect`, and direct `for range`.

For a senior leading a migration, this is the gotcha to flag in review: a mechanical import-path swap from `x/exp/maps` to `maps` will compile in most places but silently break anywhere code treated `Keys`/`Values` as slices. Grep for `maps.Keys` and `maps.Values` and wrap each in `slices.Collect`/`slices.Sorted` as needed.

### `cmp.Compare` as the comparator standard

`cmp.Compare` returning `-1/0/+1` matched to `slices.SortFunc`'s `func(a, b T) int` contract created a *consistent comparator protocol* across the stdlib. `cmp.Or` (1.22) then made multi-key comparators trivial. This is now the idiomatic sort:

```go
slices.SortFunc(rows, func(a, b Row) int {
    return cmp.Or(cmp.Compare(a.A, b.A), cmp.Compare(a.B, b.B))
})
```

Standardising the comparator shape matters: it is the difference between every codebase inventing its own less-func convention and everyone reading the same three-line pattern.

---

## `math/rand/v2`: a Case Study in API Evolution

`math/rand/v2` is worth studying *as a process*, because it is the first `v2` of a stdlib package and a template for how Go evolves under the Go 1 compatibility promise.

### The constraint

Go 1 promises that code compiling under 1.0 keeps compiling. So `math/rand`'s mistakes — the weak default generator, the `Intn`/`Int63n` naming mess, the surprising global-seed behaviour, the serialising mutex — could not be fixed *in place* without breaking programs.

### The escape hatch

The team's answer: a *new import path* (`math/rand/v2`) that can make breaking choices while v1 stays frozen. v2's improvements:

- **Better generators** (PCG, ChaCha8) replacing the 1970s additive generator.
- **No global `Seed`.** v1's seed-or-get-deterministic-output footgun is removed; the global is auto-seeded unpredictably and cannot be reseeded.
- **Consistent naming** (`IntN`, `Int64N`, `Uint64N`) and a generic `N[T]`.
- **`Rand` no longer carries the same global-mutex baggage** for top-level calls.

### The senior takeaway

When you own a widely-used package and discover a design mistake, this is the playbook: freeze v1, ship v2 at a new path, and document the migration. The cost is two packages to maintain; the benefit is not breaking the world. Recognising when an API is worth a v2 — versus patching around it forever — is a senior design skill, and `math/rand/v2` is the canonical worked example to point juniors at.

---

## `unique` and Memory Architecture

`unique` (1.23) is a *systems* feature dressed as a small package. It exists because canonicalisation — storing one copy of each distinct value — previously required either a global `map[T]T` you managed by hand (with no GC reclamation) or a third-party interning library.

### What `unique` gives that a hand-rolled map cannot

- **Weak-reference semantics.** Interned entries are reclaimed by the GC once no live `Handle` references them. A hand-rolled `map[string]string` leaks forever. This required runtime support that only landed alongside the package.
- **Pointer-equality comparisons.** `Handle[T]` comparison is O(1), independent of `T`'s size. Comparing two interned 1KB structs is a pointer compare.
- **Concurrency-safe** `Make` without you writing the lock.

### When it changes architecture

For data with high cardinality *and* high repetition — telemetry labels, normalised enums, network addresses, parsed-out constant strings — interning can cut heap usage dramatically and speed up equality-heavy hot paths (deduplication, group-by). The stdlib's own `net/netip` uses it to make `Addr` comparisons cheap.

The senior caution: `unique` is a memory/CPU trade, and `Make` is not free (a hash + map lookup). Profile before adopting. Interning genuinely-unique data is pure overhead. This is a "measure, then apply to the proven hot spot" tool, not a default.

---

## The 1.22 Router Decision: Stdlib vs Framework

The 1.22 `ServeMux` enhancement removes the single most common reason teams reached for a router: method matching and path variables. So: do you drop `chi`/`gorilla`/`gin`?

### What the stdlib now does

- Method matching (`GET /x`), with automatic `HEAD` and `405 + Allow`.
- Path wildcards (`{id}`), remainder wildcards (`{path...}`), exact-match (`{$}`).
- **Specificity-based precedence** with **registration-time conflict panics** — no silent ambiguity, no order-dependence.

### What it still does not do

- Middleware *composition* ergonomics (you wrap handlers manually).
- Route groups / sub-routers with shared prefixes and middleware.
- Regex constraints on path segments.
- Per-route middleware as a first-class concept.

### The senior call

- **New small-to-medium services:** start with the stdlib mux. The routing is genuinely sufficient, and `http.Handler`/middleware wrapping is a few lines. Adding a router later is cheap.
- **Large services with deep middleware trees, route groups, and many engineers:** a thin router like `chi` (which is `http.Handler`-compatible and barely a framework) often still earns its place for the *grouping and middleware* ergonomics, not the routing per se.
- **Avoid heavy frameworks** (full MVC stacks) unless the team genuinely wants the conventions — the routing argument for them is now gone.

The key insight: the stdlib closed the *routing* gap, not the *middleware-organisation* gap. Choose based on which gap actually hurts you.

---

## Version Floors as a Dependency Constraint

Every feature here raises your **minimum Go version**, which is a real, often-underweighted cost.

- Using `slog` requires consumers on **1.21+**. A *library* that adopts `slog` forces 1.21 on every importer. For a widely-imported library this is a breaking decision; gate it carefully or keep a logging seam that does not require it.
- The 1.22 routing requires the `go 1.22` directive to get the new semantics.
- `unique` and iterator funcs require 1.23.

For applications you control end-to-end, bumping the floor is usually fine. For libraries, the version floor is part of your public contract: raising it can strand users on older toolchains (regulated environments, slow corporate upgrades). The senior discipline is to set the `go` directive to the *lowest* version that supports the features you actually use, and to treat raising it as a minor-version-worthy change with a note in the changelog.

---

## Adoption Strategy for an Existing Codebase

A phased, low-risk rollout:

1. **Raise the `go` directive and toolchain** to the target (e.g. `go 1.23`), in its own PR. Confirm the build and tests pass with no behaviour change.
2. **Adopt `slices`/`maps`/`cmp` opportunistically.** These are local, mechanical, low-risk. Replace hand loops as you touch code; do not do a big-bang rewrite.
3. **Introduce `slog` at the seam first.** Set the default handler in `main`, bridge legacy `log` via `slog.NewLogLogger`, then migrate hot call sites. Do *not* rewrite every `log.Printf` at once.
4. **Migrate `math/rand` → `v2`** in new code; convert old code only where you can verify the determinism implications (any test relying on `rand.Seed` needs an explicit source).
5. **Adopt the 1.22 router for new endpoints**; leave the existing router until there is a reason to consolidate.
6. **Apply `unique` only to a profiled memory hot spot**, never speculatively.

Throughout: each step is independently shippable and revertible. Resist coupling a stdlib-modernisation PR with feature work — the diffs and the risk profiles do not mix.

---

## Performance Considerations

- **`slog` variadic vs `LogAttrs`.** The `Info(msg, args...)` form boxes args into `[]any`, causing allocations. `LogAttrs(ctx, level, msg, attrs...)` with typed `Attr`s avoids the boxing. Guard expensive logs with `logger.Enabled(ctx, level)`. In throughput-critical paths a third-party handler (zap-backed) may still beat the stdlib JSON handler.
- **`slices.Contains` is linear.** Repeated membership belongs in a set (`map[T]struct{}`).
- **Iterators are zero-allocation when ranged directly** but `slices.Collect`/`Sorted` allocate the result slice — expected, but know it.
- **`math/rand/v2`** is faster than v1 and the global path avoids a shared mutex bottleneck under contention.
- **`unique.Make`** costs a lookup; the payoff is heap reduction and O(1) handle equality. Net win only with real repetition.
- **The 1.22 router** does pattern matching with a trie-like structure; it is competitive with third-party routers and avoids their reflection/allocation overhead in some cases.

---

## Anti-Patterns

- **Big-bang rewriting all logging to `slog` in one PR.** High risk, huge diff, no incremental value. Migrate at the seam, then call sites.
- **Mechanical `x/exp/maps` → `maps` swap without auditing `Keys`/`Values` uses.** Silent slice-vs-iterator breakage.
- **Adopting `slog` in a widely-imported library without considering the 1.21 version floor.** You impose it on every consumer.
- **Using `cmp.Or` for side-effecting fallbacks** expecting short-circuit. It evaluates everything.
- **Reaching for `unique` speculatively.** Overhead without measured repetition.
- **Removing `rand.Seed` calls without replacing the determinism** tests relied on. Construct an explicit `rand.New(rand.NewPCG(...))`.
- **Logging secrets/PII as `slog` attributes.** Structured logs are indexed and shipped off-box; redact centrally in the handler.
- **Treating the stdlib router as a framework.** It is routing, not middleware organisation; do not contort it into one.

---

## Senior-Level Checklist

- [ ] Treat `slog`'s `Handler` interface as the standardised seam; put policy (redaction, sampling, fan-out) in handlers
- [ ] Choose logging *backend* per environment without changing call sites
- [ ] Audit every `maps.Keys`/`maps.Values` use when graduating off `x/exp`
- [ ] Standardise on `cmp.Compare` + `cmp.Or` comparators in `SortFunc`
- [ ] Set the `go` directive to the lowest version your used features require
- [ ] In libraries, treat a version-floor bump as a contract change
- [ ] Migrate `math/rand` → `v2` deliberately, replacing seeding-based determinism
- [ ] Start new services on the stdlib router; add `chi`-class deps only for middleware/grouping needs
- [ ] Apply `unique` only to profiled memory hot spots
- [ ] Keep stdlib-modernisation PRs separate from feature PRs
- [ ] Redact secrets/PII in a central `slog` handler, never at call sites

---

## Summary

The Go 1.21–1.24 stdlib additions share one theme: generics and iterators let the standard library absorb the most-copied third-party patterns, shrinking the default dependency footprint. **`slog`** standardised the logging *seam* (the `Handler` interface) so libraries can log without imposing a backend and applications choose policy in handlers. **`slices`/`maps`/`cmp`** graduated from `x/exp` with one sharp edge — `maps.Keys`/`Values` became iterators — that every migration must audit. **`math/rand/v2`** is the canonical example of evolving an API under the Go 1 compatibility promise via a new import path. **`unique`** brought GC-aware interning into the stdlib for memory-and-equality-critical hot spots. The **1.22 router** closed the routing gap but not the middleware-organisation gap.

The senior responsibility is judgement: adopt these to reduce dependencies and modernise, but per-context — stdlib *routing* may be sufficient where stdlib *logging throughput* is not, version floors are real contract costs, and the right rollout is phased, profiled, and decoupled from feature work.
