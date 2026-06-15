# Modern Standard-Library Additions — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [The `slog.Handler` Contract in Full](#the-sloghandler-contract-in-full)
3. [Writing a Correct Custom Handler](#writing-a-correct-custom-handler)
4. [`slog` Record and Attr Internals](#slog-record-and-attr-internals)
5. [`slices`/`maps` Allocation and Aliasing Semantics](#slicesmaps-allocation-and-aliasing-semantics)
6. [`math/rand/v2` Generator Internals](#mathrandv2-generator-internals)
7. [`unique` Internals: Canonicalization and Weak References](#unique-internals-canonicalization-and-weak-references)
8. [`net/http.ServeMux` Pattern Matching Internals](#nethttpservemux-pattern-matching-internals)
9. [`structs.HostLayout`, `go/version`, `testing/synctest`](#structshostlayout-goversion-testingsynctest)
10. [Library-Author Concerns](#library-author-concerns)
11. [Performance Profile and Benchmarking](#performance-profile-and-benchmarking)
12. [Operational Playbook](#operational-playbook)
13. [Summary](#summary)

---

## Introduction

The professional level treats these additions as implementation contracts you may need to implement, benchmark, or build on. The dangerous misconception is that `slog.Handler` is "just a formatter" or that `unique` is "just a map" — both have invariants that, violated, produce subtle correctness or performance bugs.

This file is for engineers who write custom `slog` handlers, build libraries that must log without imposing a backend, run high-throughput services where allocation behaviour matters, or maintain infrastructure that depends on the exact semantics of these APIs.

After reading you will:
- Implement a spec-compliant `slog.Handler` including `WithAttrs`/`WithGroup`
- Reason about `Record`/`Attr` allocation and the `LogAttrs` fast path
- Predict `slices`/`maps` aliasing and zeroing behaviour
- Understand PCG/ChaCha8 and the `math/rand/v2` global source
- Explain `unique`'s weak-reference canonicalization
- Trace `ServeMux` precedence to its matching algorithm

---

## The `slog.Handler` Contract in Full

```go
type Handler interface {
    Enabled(ctx context.Context, level Level) bool
    Handle(ctx context.Context, r Record) error
    WithAttrs(attrs []Attr) Handler
    WithGroup(name string) Handler
}
```

The contract (from the package documentation) has rules that handler authors *must* obey:

- **`Enabled`** is a cheap pre-check. The `Logger` calls it before constructing the `Record` so that disabled levels cost nothing. It must not have side effects.
- **`Handle`** is called only if `Enabled` returned true. It receives a `Record` already populated. It must:
  - Ignore `r.Time` if it is the zero time (do not emit a time field).
  - Treat an `Attr` with an empty `Key` and any value as ignorable *only* in the documented cases; otherwise output it.
  - **Not** retain `r` or the `[]Attr` slices beyond the call (they may be reused).
  - Handle attributes added via `WithAttrs`/`WithGroup` *before* the record's own attributes, in order.
- **`WithAttrs`** returns a *new* handler with the given attributes pre-bound. It must not mutate the receiver — loggers are shared across goroutines.
- **`WithGroup`** returns a new handler that qualifies all subsequent attributes (its own and the record's) under `name`. Empty group names are a no-op per the spec.

The `Logger` is a thin wrapper: `logger.Info(msg, args)` converts `args` to attrs, builds a `Record`, calls `handler.Enabled`, and if true, `handler.Handle`. `With`/`WithGroup` on the logger delegate to the handler's `WithAttrs`/`WithGroup`.

---

## Writing a Correct Custom Handler

The two correctness traps are: **mutating shared state in `WithAttrs`/`WithGroup`**, and **mishandling groups**. A minimal correct handler that writes `key=value` lines:

```go
type lineHandler struct {
    w      io.Writer
    level  slog.Leveler
    groups []string          // accumulated group prefix
    attrs  []slog.Attr       // attrs bound via WithAttrs
    mu     *sync.Mutex       // shared so concurrent Handles don't interleave
}

func (h *lineHandler) Enabled(_ context.Context, l slog.Level) bool {
    return l >= h.level.Level()
}

func (h *lineHandler) WithAttrs(as []slog.Attr) slog.Handler {
    nh := *h                                  // copy by value (do NOT mutate receiver)
    nh.attrs = append(slices.Clip(h.attrs), as...)
    return &nh
}

func (h *lineHandler) WithGroup(name string) slog.Handler {
    if name == "" {
        return h
    }
    nh := *h
    nh.groups = append(slices.Clip(h.groups), name)
    return &nh
}

func (h *lineHandler) Handle(_ context.Context, r slog.Record) error {
    var b strings.Builder
    fmt.Fprintf(&b, "level=%s msg=%q", r.Level, r.Message)
    prefix := strings.Join(h.groups, ".")
    for _, a := range h.attrs {
        writeAttr(&b, prefix, a)
    }
    r.Attrs(func(a slog.Attr) bool { // Record.Attrs iterates the record's own attrs
        writeAttr(&b, prefix, a)
        return true
    })
    b.WriteByte('\n')
    h.mu.Lock()
    defer h.mu.Unlock()
    _, err := io.WriteString(h.w, b.String())
    return err
}
```

Critical details:

- **`slices.Clip` before `append`** prevents a child handler from accidentally overwriting a sibling's backing array — a classic aliasing bug when `WithAttrs` is called twice from the same parent.
- **The mutex is a pointer**, shared across all derived handlers, so writes to the same `Writer` do not interleave.
- **`Record.Attrs(fn)`** is the API to iterate a record's attributes (it does not expose a slice, to allow internal optimisation).
- **Resolve `LogValuer` attributes**: production handlers should call `a.Value.Resolve()` to evaluate lazy `slog.LogValuer` values (used for deferred/expensive attribute computation and redaction).

Use `slogtest.TestHandler` to verify your handler against the official conformance suite.

---

## `slog` Record and Attr Internals

- **`Attr`** is a struct `{ Key string; Value Value }`. `Value` is a tagged union (`Kind` + packed fields) that stores common types (int64, float64, bool, string, time, duration) *without boxing into `any`*. This is why typed constructors (`slog.Int`, `slog.String`) avoid the allocation that the loose `args ...any` form incurs.
- **`Record`** holds a small inline array of attrs plus an overflow slice; few-attr records avoid heap allocation entirely.
- **The two front doors:**
  - `logger.Info(msg, args...)` — `args` is `[]any`; each non-`Attr` value is boxed, and pairs are assembled into `Attr`s. Convenient, allocates.
  - `logger.LogAttrs(ctx, level, msg, attrs...)` — `attrs` are already `Attr`; no boxing. The performance path.
- **`LogValuer`** lets a type compute its log representation lazily: `func (t T) LogValue() slog.Value`. The value is only resolved if the record is actually emitted, so expensive or sensitive computations are deferred (and can be redacted in one place).
- **PC capture for source location:** the `Record` stores a program counter; `AddSource: true` resolves it to file:line only when emitting, keeping the common path cheap.

---

## `slices`/`maps` Allocation and Aliasing Semantics

Professional gotchas codified:

- **`slices.Delete(s, i, j)`** (since 1.22) zeroes the now-unused tail elements to release references for GC, then returns the shortened slice. It **mutates the input's backing array**. Callers sharing that array see the mutation. `Clone` if the original must survive.
- **`slices.Insert`/`Replace`** may or may not allocate depending on capacity; the returned slice is the authority — never assume the input slice header is still valid.
- **`slices.Compact`** mutates in place and returns a prefix; the tail beyond the returned length is zeroed (1.22+).
- **`slices.Clip(s)`** returns `s[:len(s):len(s)]` — capping capacity so a later `append` reallocates instead of clobbering shared storage. Essential in handler/builder code.
- **`maps.Clone`/`slices.Clone`** are *shallow*. Nested reference types are shared.
- **Iterator functions** (`slices.Values`, `maps.Keys`) allocate nothing themselves; `Collect`/`Sorted` allocate the destination. Ranging directly is allocation-free.
- **`maps.Keys` ordering** is nondeterministic per the map iteration contract; tests must not assume order without `slices.Sorted`.

---

## `math/rand/v2` Generator Internals

`math/rand/v2` defines a `Source` interface with a single 64-bit output method:

```go
type Source interface { Uint64() uint64 }
```

Two concrete sources ship:

- **`PCG`** (`NewPCG(seed1, seed2 uint64)`) — a Permuted Congruential Generator with 128 bits of state. Fast, statistically strong, small. The recommended general-purpose seedable source for reproducibility.
- **`ChaCha8`** (`NewChaCha8(seed [32]byte)`) — eight rounds of the ChaCha stream cipher used as a generator. Higher quality, used internally as the **global** source's algorithm, seeded once at process start from the OS.

The global top-level functions (`rand.IntN`, `rand.Float64`, …) draw from a runtime-managed per-thread ChaCha8 state seeded unpredictably at startup. There is intentionally **no `Seed`** — the v1 footgun (deterministic-by-default unless seeded) is gone. Reproducibility requires an explicit `rand.New(rand.NewPCG(a, b))`.

`rand.N[T Integer](n T) T` is a generic uniform `[0, n)` over any integer-kinded type — including named types like `time.Duration` — implemented with the standard rejection method to avoid modulo bias. The non-generic `IntN`/`Int64N`/`Uint64N` exist for the common cases.

---

## `unique` Internals: Canonicalization and Weak References

`unique.Make[T comparable](v T) Handle[T]`:

- Maintains a process-global concurrent map keyed by `T`'s value, mapping each distinct value to a single canonical heap allocation.
- `Make` hashes `v`, looks it up, and either returns a handle to the existing canonical entry or inserts a new one. Concurrency-safe.
- `Handle[T]` is a small struct wrapping a pointer to the canonical entry. `Handle[T] == Handle[T]` is therefore a **pointer comparison** — O(1) regardless of `sizeof(T)`.
- `Handle.Value()` dereferences the canonical copy.

The key runtime feature is **weak references**: the global map holds canonical entries weakly, so once no live `Handle` references an entry, the GC reclaims it. This is what distinguishes `unique` from a hand-rolled `map[T]T`, which would pin every value forever. `unique` relies on internal weak-pointer support (the same mechanism later exposed as the `weak` package).

Implications:

- **Do not call `Make` in a hot loop on rarely-repeating data** — every call is a hash + concurrent-map operation.
- **Handles are comparable and map-key usable**, making them ideal as deduplicated map keys.
- **Liveness matters:** an interned value persists only while some handle is reachable; entries are not a permanent cache.

---

## `net/http.ServeMux` Pattern Matching Internals

A 1.22 pattern decomposes into `[METHOD] [HOST]/[segments]`, where each segment is a literal, a `{name}` wildcard (one segment), a `{name...}` multi-segment wildcard (must be last), or `{$}` (anchors to the exact path).

Matching and precedence:

- Patterns are indexed in a structure that allows the mux to find all patterns matching a request and select the **most specific**. Specificity is defined precisely: a literal segment is more specific than a `{wildcard}`, which is more specific than `{wildcard...}`.
- **Conflict detection at registration.** If two registered patterns can match a common set of requests and neither is strictly more specific, `mux.Handle` **panics** at registration time. This converts a class of silent routing ambiguities into a startup failure — a deliberate reliability choice.
- **Method semantics:** registering `GET /x` also serves `HEAD /x`. A path-but-not-method match returns `405` with a computed `Allow` header. Patterns without a method match all methods.
- **`{$}`** distinguishes `/items/` (exact) from `/items/sub`. Without it, a trailing-slash pattern is a subtree (prefix) match, preserving the pre-1.22 subtree behaviour.
- **`PathValue`/`SetPathValue`** are stored on the `*http.Request`; `PathValue` returns `""` for unknown names.

The `go` directive gates behaviour: a module on `go 1.22+` gets the new semantics; older directives keep legacy matching, so a toolchain upgrade alone never changes a service's routing.

---

## `structs.HostLayout`, `go/version`, `testing/synctest`

- **`structs.HostLayout`** (1.23): an empty-struct marker field placed in a struct to tell the compiler the struct's layout must match the host platform/C ABI (relevant for cgo and `syscall` structs). It carries no data; it is a compiler signal that influences field layout guarantees on platforms where Go might otherwise reorder/pad differently.
- **`go/version`** (1.22): `version.IsValid("go1.21")`, `version.Compare("go1.21", "go1.22")` (returns -1/0/+1), `version.Lang("go1.21.3") == "go1.21"`. For tools that reason about `go` directives and toolchain strings programmatically — linters, build systems.
- **`testing/synctest`** (1.24, experimental under `GOEXPERIMENT=synctest`): runs a "bubble" of goroutines against a *fake clock* so concurrent code with timers/sleeps can be tested deterministically. `synctest.Run` starts the bubble; `synctest.Wait` blocks until all goroutines in the bubble are durably blocked. It makes flaky time-dependent concurrency tests reproducible. Experimental — API may change.

---

## Library-Author Concerns

If you publish a library:

- **Log via `slog.Default()` or an injected `*slog.Logger`** — never impose a logging backend. Accept a `*slog.Logger` (or a `slog.Handler`) in your constructor; default to `slog.Default()`. This is the post-`slog` idiom and a courtesy to consumers.
- **The version-floor tax:** adopting `slog`/`unique`/iterators raises your module's `go` directive, which every importer inherits. For broadly-used libraries, weigh this against keeping a backend-agnostic seam. Document any floor bump as a notable change.
- **Avoid leaking `x/exp` types** in your public API; migrate to stdlib `slices`/`maps`/`cmp` and audit `Keys`/`Values` slice-vs-iterator at the boundary.
- **Expose `LogValuer`** on types that have sensitive fields so consumers' handlers can redact lazily and centrally.
- **For `math/rand/v2`,** accept an injectable `*rand.Rand` (or a `rand.Source`) so consumers can make your library's randomness deterministic in their tests.

---

## Performance Profile and Benchmarking

- **`slog`:** benchmark `LogAttrs` vs the variadic form; expect the variadic `[]any` boxing to dominate allocations. The disabled-level path (`Enabled` false) should be near-zero-cost — verify with `-benchmem`. The JSON handler's per-record allocations are the usual hot spot in log-heavy services; a buffer pool in a custom handler helps.
- **`slices`:** generic functions are monomorphised by the compiler — no interface dispatch; performance matches hand-written code. `Contains` is O(n) — do not put it inside a loop over the same slice.
- **`math/rand/v2`:** global functions avoid v1's global mutex; under contention v2 scales better. PCG is faster per call than ChaCha8.
- **`unique`:** `Make` is a concurrent-map operation; benchmark it against the alternative (storing the raw value) on representative data. The win is heap size and handle-equality speed, visible under `pprof` heap profiles, not micro-benchmarks of `Make` alone.
- **Router:** the 1.22 mux matches without per-request allocation for path values beyond the request-scoped storage; competitive with lightweight third-party routers.

Always benchmark with `testing.B`, `-benchmem`, and `benchstat` across multiple runs; reason about allocations (`allocs/op`) as much as latency.

---

## Operational Playbook

- **Adopting `slog` org-wide:** define a shared handler package (level config, JSON output, redaction via `ReplaceAttr`/`LogValuer`, trace-ID extraction). Mandate `slog.SetDefault` in `main`; lint for `fmt.Sprintf` inside log calls.
- **Determinism in tests:** ban global `math/rand/v2` usage in code under test; inject a seeded `*rand.Rand`.
- **Memory regressions:** when a heap profile shows duplicated strings/structs with high count, evaluate `unique` on that exact field; verify with before/after heap profiles.
- **Router rollout:** bump `go.mod` to `go 1.22`, add tests for trailing-slash and `405` behaviour, and rely on the registration-time conflict panic as a CI guard against ambiguous routes.
- **Handler conformance:** gate any custom `slog.Handler` behind `slogtest.TestHandler` in CI.

---

## Summary

At the professional level these additions are contracts. **`slog.Handler`** has strict rules — no receiver mutation in `WithAttrs`/`WithGroup`, `slices.Clip` before append, resolve `LogValuer`, conform to `slogtest` — and a `Value` union plus `LogAttrs` fast path that govern its allocation profile. **`slices`/`maps`** carry precise aliasing and tail-zeroing semantics that bite callers who assume immutability. **`math/rand/v2`** exposes a one-method `Source`, ships PCG and ChaCha8, and removes global reseeding by design. **`unique`** is GC-aware, weak-reference canonicalization giving O(1) handle equality. The **1.22 `ServeMux`** uses specificity-based matching with registration-time conflict panics, gated by the `go` directive. Library authors should log via an injected `*slog.Logger`, weigh version floors as a contract cost, and accept injectable randomness. Everything here is benchmarkable and conformance-testable — treat the documented invariants as the spec they are.
