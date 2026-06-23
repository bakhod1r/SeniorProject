# Modern Standard-Library Additions — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [`slog` in Depth: Logger, Handler, Record, Attr](#slog-in-depth-logger-handler-record-attr)
3. [`slog` Levels, Groups, `With`, and Context](#slog-levels-groups-with-and-context)
4. [The `slices` Package, Including 1.23 Iterators](#the-slices-package-including-123-iterators)
5. [The `maps` Package and Its Iterator Forms](#the-maps-package-and-its-iterator-forms)
6. [The `cmp` Package](#the-cmp-package)
7. [`math/rand/v2`: Rationale and API](#mathrandv2-rationale-and-api)
8. [The `unique` Package](#the-unique-package)
9. [`net/http.ServeMux` Routing (1.22) in Detail](#nethttpservemux-routing-122-in-detail)
10. [Other Notable Additions](#other-notable-additions)
11. [Migration Mechanics](#migration-mechanics)
12. [Pitfalls You Will Meet](#pitfalls-you-will-meet)
13. [Self-Assessment](#self-assessment)
14. [Summary](#summary)

---

## Introduction

You can call `slog.Info` and `slices.Sort`. The middle-level questions are *how these packages are shaped*: what a `slog.Handler` is and why it matters, why `maps.Keys` returns an iterator, what `math/rand/v2` actually fixed, and how the new `ServeMux` resolves overlapping patterns.

After reading this you will:
- Understand the `Logger → Handler → Record/Attr` pipeline and use `With`, groups, and context
- Use the full `slices`/`maps` API including the 1.23 iterator functions
- Know exactly why `math/rand/v2` exists and how its API differs from v1
- Use `unique.Make`/`Handle` correctly
- Reason about `ServeMux` pattern precedence and wildcards
- Migrate existing code without breaking it

---

## `slog` in Depth: Logger, Handler, Record, Attr

`slog` has four core types:

| Type | Role |
|------|------|
| `*slog.Logger` | The front end you call (`Info`, `Warn`, `LogAttrs`, `With`). Holds a `Handler`. |
| `slog.Handler` | An interface: decides formatting and destination. `TextHandler`, `JSONHandler` are built in. |
| `slog.Record` | One log event: time, level, message, and a set of attributes. |
| `slog.Attr` | One typed key/value pair (`slog.Int("n", 3)`, `slog.String("k", v)`). |

The flow: you call `logger.Info(msg, args...)` → the logger builds a `Record` → hands it to its `Handler` → the handler renders and writes it.

### Two ways to pass attributes

```go
// 1. Loosely-typed key/value variadics (convenient, allocates, can be misused)
slog.Info("login", "user", id, "ok", true)

// 2. Strongly-typed Attrs (verbose, fewer allocations, no BADKEY risk)
slog.LogAttrs(context.Background(), slog.LevelInfo, "login",
    slog.Int("user", id),
    slog.Bool("ok", true),
)
```

`LogAttrs` is the performance-and-correctness path: it takes a context, a level, a message, and `...Attr`. Use it in hot paths and where you want compile-time field typing.

### Constructing handlers

```go
opts := &slog.HandlerOptions{
    Level:     slog.LevelDebug,    // minimum level to emit
    AddSource: true,               // include file:line
    ReplaceAttr: func(groups []string, a slog.Attr) slog.Attr {
        if a.Key == "password" {   // redact
            return slog.Attr{}
        }
        return a
    },
}
textLogger := slog.New(slog.NewTextHandler(os.Stderr, opts))
jsonLogger := slog.New(slog.NewJSONHandler(os.Stdout, opts))
```

`ReplaceAttr` is the redaction/renaming hook — it runs for every attribute and lets you drop, rename, or rewrite it.

---

## `slog` Levels, Groups, `With`, and Context

### Levels

`slog` levels are `int`-backed: `LevelDebug=-4`, `LevelInfo=0`, `LevelWarn=4`, `LevelError=8`. The gaps let you define custom levels (`slog.Level(2)` for "Notice"). A handler emits a record only if its level ≥ the configured minimum.

```go
slog.SetLogLoggerLevel(slog.LevelWarn) // package-level default threshold
```

### `With` — bind attributes once

`logger.With(args...)` returns a child logger that attaches those attributes to *every* subsequent record. Ideal for request-scoped context:

```go
reqLog := slog.With("request_id", reqID, "route", "/items")
reqLog.Info("started")   // both attrs included
reqLog.Error("failed", "err", err) // both attrs + err
```

### Groups — namespacing attributes

`slog.Group` nests attributes under a key:

```go
slog.Info("request",
    slog.Group("http",
        slog.String("method", "GET"),
        slog.Int("status", 200),
    ),
)
// JSON: "http":{"method":"GET","status":200}
```

`logger.WithGroup("db")` opens a group for all following attributes on that logger.

### Context integration

`slog` supports context two ways:

1. **Pass the context to the log call** so handlers (and tracing middleware) can read it:
   ```go
   slog.InfoContext(ctx, "handled", "ms", elapsed)
   ```
2. **Store a logger in context** via your own helper, or use a custom handler that extracts trace IDs from `ctx` in its `Handle(ctx, record)` method. The handler's signature is `Handle(context.Context, slog.Record) error` precisely so it can pull request-scoped values (trace IDs, tenant) out of the context.

---

## The `slices` Package, Including 1.23 Iterators

Core functions (Go 1.21), all generic:

```go
slices.Sort(s)                        // ascending, cmp.Ordered
slices.SortFunc(s, func(a, b T) int)  // custom
slices.SortStableFunc(s, cmpFn)       // stable
slices.BinarySearch(s, target)        // (idx, found bool) — sorted input
slices.BinarySearchFunc(s, t, cmpFn)
slices.Index(s, v) / slices.IndexFunc(s, pred)
slices.Contains(s, v) / slices.ContainsFunc(s, pred)
slices.Equal(a, b) / slices.EqualFunc(a, b, eq)
slices.Compact(s) / slices.CompactFunc(s, eq) // adjacent dedup
slices.Insert(s, i, v...) / slices.Delete(s, i, j)
slices.Replace(s, i, j, v...)
slices.Clone(s)
slices.Reverse(s)
slices.Min(s) / slices.Max(s) / slices.MinFunc / slices.MaxFunc
slices.IsSorted(s) / slices.IsSortedFunc(s, cmpFn)
slices.Concat(s1, s2, ...)            // 1.22
```

### The 1.23 iterator functions

Go 1.23 added functions that bridge slices and iterators (`iter.Seq`):

```go
slices.All(s)        // iter.Seq2[int, T] — index/value pairs
slices.Values(s)     // iter.Seq[T]       — values only
slices.Collect(seq)  // iter.Seq[T] → []T
slices.Sorted(seq)   // iter.Seq[T] → sorted []T
slices.SortedFunc(seq, cmpFn)
slices.SortedStableFunc(seq, cmpFn) // stable variant
```

This is why `slices.Sorted(maps.Keys(m))` works: `maps.Keys` yields an `iter.Seq`, and `slices.Sorted` drains it into a sorted slice. See [01-iterators-and-range-over-func](../01-iterators-and-range-over-func/middle.md).

---

## The `maps` Package and Its Iterator Forms

Go 1.21 shipped `maps` with these — but note the **1.23 signature change**:

```go
// 1.21 experimental form returned slices; the STDLIB 1.23 form returns iterators:
maps.Keys(m)      // iter.Seq[K]
maps.Values(m)    // iter.Seq[V]
maps.All(m)       // iter.Seq2[K, V]

maps.Clone(m)             // shallow copy
maps.Copy(dst, src)       // copy src entries into dst
maps.Equal(m1, m2)        // bool
maps.EqualFunc(m1, m2, eq)
maps.DeleteFunc(m, func(k K, v V) bool) // delete matching entries
maps.Insert(m, seq)       // 1.23: insert iter.Seq2 pairs into m
maps.Collect(seq)         // 1.23: iter.Seq2 → map
```

Idioms:

```go
keys := slices.Collect(maps.Keys(m))        // []K, random order
sortedKeys := slices.Sorted(maps.Keys(m))   // []K, sorted
for k, v := range maps.All(m) { ... }       // range over the iterator

maps.DeleteFunc(m, func(k string, v int) bool {
    return v == 0                            // drop zero values
})
```

> Migration note: if you used `golang.org/x/exp/maps`, its `Keys` returned `[]K`. The stdlib version returns an iterator. Replace `maps.Keys(m)` with `slices.Collect(maps.Keys(m))` where you depended on a slice.

---

## The `cmp` Package

Small but load-bearing:

```go
type Ordered interface { ~int | ~int8 | ... | ~float64 | ~string }

cmp.Compare(a, b Ordered) int  // -1, 0, +1  (NaN-aware: NaN sorts low)
cmp.Less(a, b Ordered) bool    // a < b, NaN-aware
cmp.Or[T comparable](vals ...T) T // first non-zero, else zero (Go 1.22)
```

`cmp.Compare` is the canonical comparator for `slices.SortFunc`. `cmp.Or` collapses fallback chains:

```go
slices.SortFunc(rows, func(a, b Row) int {
    return cmp.Or(
        cmp.Compare(a.Priority, b.Priority),
        cmp.Compare(a.Name, b.Name),
        cmp.Compare(a.ID, b.ID),
    )
})

name := cmp.Or(req.Name, defaultName, "anonymous")
```

`cmp.Compare` is also **NaN-safe**, unlike a naive `if a < b`: it defines a total order where `NaN` is less than everything, so sorting float slices does not loop forever.

---

## `math/rand/v2`: Rationale and API

### Why a v2 at all

`math/rand` (v1) accumulated mistakes the team could not fix without breaking the Go 1 compatibility promise:

- **Global auto-seeding confusion.** Originally the global source was seeded with `1`, so every program produced the *same* sequence unless you called `rand.Seed(time.Now().UnixNano())`. Forgetting that was a classic bug. (v1 was later changed to auto-seed, and `rand.Seed` was deprecated.)
- **A weak, slow generator** (a 1970s-era additive generator) as the default.
- **Inconsistent naming**: `Intn`, `Int63n`, `Int31n`.
- **A global mutex** serialising all top-level calls.

`math/rand/v2` (Go 1.22) is a clean redesign:

```go
import "math/rand/v2"

rand.IntN(100)        // [0, 100), generic-friendly naming
rand.Int64N(1_000_000)
rand.Float64()        // [0.0, 1.0)
rand.Shuffle(n, swap)
rand.Perm(n)

// Generic N — works for any integer type
rand.N(int32(50))     // [0, 50) as int32
rand.N(time.Hour)     // even works on Duration (an int64)
```

### Explicit, modern sources

v2 ships two good generators and **no `Seed` function on the global**:

```go
// PCG: 128-bit state, fast, high quality
src := rand.NewPCG(seedHi, seedLo)
r := rand.New(src)
r.IntN(10)

// ChaCha8: cryptographically-derived stream generator (the global default seed source)
ch := rand.NewChaCha8([32]byte{ /* seed */ })
r2 := rand.New(ch)
```

The package-level functions (`rand.IntN`, …) use a per-call generator seeded once at startup from the OS, automatically and unpredictably. There is **no way to reseed the global** — by design. For reproducibility, construct your own `*rand.Rand` with a fixed `PCG` seed.

> Still not cryptographically secure for secrets even though ChaCha8 underlies it — use `crypto/rand` for keys/tokens.

---

## The `unique` Package

`unique` (Go 1.23) provides **interning**: storing one canonical copy of each distinct value and handing out lightweight handles.

```go
import "unique"

func unique.Make[T comparable](value T) unique.Handle[T]
func (h unique.Handle[T]) Value() T
```

Usage:

```go
h1 := unique.Make("us-east-1")
h2 := unique.Make("us-east-1")
// h1 == h2  → true (same canonical entry); comparing handles is a pointer compare
region := h1.Value() // "us-east-1"
```

What you get:

- **Memory savings.** A million records each holding the string `"us-east-1"` can share one backing copy; each record stores a small `Handle` instead.
- **Fast equality.** Comparing two `Handle[T]` values is effectively a pointer comparison — O(1), no string scan.
- **Automatic cleanup.** Entries no longer referenced by any live handle are reclaimed by the GC (via weak references internally).

When to use it: deduplicating high-cardinality-but-repetitive values — interned strings, normalised labels, `netip.Addr`-style keys. The standard library itself uses `unique` to intern `netip.Addr` values.

When NOT to use it: low-repetition data (interning overhead with no payoff), or hot loops where the hash-lookup cost of `Make` exceeds the memory benefit. Measure first.

---

## `net/http.ServeMux` Routing (1.22) in Detail

Before 1.22, `ServeMux` matched only path prefixes — no methods, no path variables. Go 1.22 extended the **pattern syntax**:

```
[METHOD ][HOST]/[PATH]
```

```go
mux.HandleFunc("GET /items/{id}", getItem)       // method + wildcard
mux.HandleFunc("POST /items", createItem)        // method only
mux.HandleFunc("/static/", serveStatic)          // prefix (trailing slash)
mux.HandleFunc("GET /files/{path...}", serveFile) // {path...} = rest of path
mux.HandleFunc("GET /items/{$}", listItems)      // {$} = exactly /items/, no subpaths
```

### Reading wildcards

```go
func getItem(w http.ResponseWriter, r *http.Request) {
    id := r.PathValue("id")        // "{id}"
    rest := r.PathValue("path")    // "{path...}" captures the remainder
}
```

### Precedence rules

When two patterns match a request, the **more specific** one wins, regardless of registration order:

- A pattern with a literal segment beats one with a wildcard at the same position (`/items/new` beats `/items/{id}`).
- A pattern that matches more path beats `{path...}` catch-alls.
- If two patterns are equally specific and both match, that is a **conflict** and `mux` panics at registration time — a loud, early failure rather than silent ambiguity.

### Method handling

- Registering `GET /x` automatically makes `HEAD /x` work too.
- A request whose path matches a pattern but whose method does not yields **405 Method Not Allowed** with an `Allow` header listing permitted methods — for free.

### Migration caveat (the 1.22 trailing-slash change)

Go 1.22 changed how some patterns are interpreted. Set the `go` directive in `go.mod` to `go 1.22` to opt into the new routing semantics; modules on older directives keep the legacy behaviour. This is gated precisely so existing services do not change behaviour on a toolchain upgrade.

---

## Other Notable Additions

| Addition | Version | What it is |
|----------|---------|-----------|
| `iter` package | 1.23 | The `iter.Seq` / `iter.Seq2` types underpinning range-over-func. See [01-iterators](../01-iterators-and-range-over-func/middle.md). |
| `structs.HostLayout` | 1.23 | A marker struct field that tells the compiler a struct mirrors a host/C ABI layout — for cgo/syscall structs. |
| `go/version` | 1.22 | `version.Compare`, `version.IsValid` for comparing `go1.x` version strings programmatically. |
| `testing/synctest` | 1.24 (experimental, `GOEXPERIMENT=synctest`) | Deterministic testing of concurrent code with a fake clock and goroutine bubble. |
| `crypto/rand` refinements | 1.24 | `crypto/rand.Read` no longer returns an error in practice; `rand.Text` for random strings. |
| `encoding` improvements | 1.24 | `encoding.TextAppender`/`BinaryAppender` interfaces; `json` `omitzero` tag option. |
| `os.Root` | 1.24 | Filesystem operations confined to a directory subtree (anti directory-traversal). |
| `time` / `net/http` | various | `time.Time` JSON improvements; `http.ServeMux` routing; `http.NewResponseController`. |

---

## Migration Mechanics

### Adopting `slog` alongside `log`

`slog` can *back* the old `log` package: `slog.NewLogLogger(handler, level)` returns a `*log.Logger` whose output flows through a `slog.Handler`. This lets you route legacy `log.Printf` calls into structured output while you migrate call sites.

### Migrating off `golang.org/x/exp/slices` and `/maps`

- `slices`: mostly drop-in; the import path changes from `golang.org/x/exp/slices` to `slices`.
- `maps`: **not** drop-in. `Keys`/`Values` changed from returning `[]T` to returning iterators. Wrap with `slices.Collect`/`slices.Sorted`.

### Adopting `math/rand/v2`

- Replace `rand.Intn(n)` → `rand.IntN(n)`, `rand.Int63n(n)` → `rand.Int64N(n)`.
- Remove all `rand.Seed(...)` calls — there is no global seed in v2. For determinism, construct an explicit `rand.New(rand.NewPCG(a, b))`.

### Opting into 1.22 routing

Bump the `go` directive in `go.mod` to `go 1.22` (or higher). Test trailing-slash behaviour, since some patterns are reinterpreted.

---

## Pitfalls You Will Meet

### Pitfall 1 — `maps.Keys` slice vs iterator confusion

Code ported from `x/exp` compiles until it does `sort.Strings(maps.Keys(m))`. Fix: `slices.Sorted(maps.Keys(m))`.

### Pitfall 2 — `slog` allocations in hot paths

The variadic `Info(msg, args...)` form allocates an `[]any`. In a tight loop, use `LogAttrs` with typed `Attr`s and guard with `logger.Enabled(ctx, level)`.

### Pitfall 3 — Expecting `cmp.Or` to short-circuit

All arguments are evaluated. `cmp.Or(a, expensiveCall())` always runs `expensiveCall()`.

### Pitfall 4 — Reseeding `math/rand/v2` global

There is no `rand.Seed`. Tests that relied on seeding the global for determinism must construct their own `*rand.Rand`.

### Pitfall 5 — `unique.Make` on rarely-repeating values

Interning unique-by-nature data (UUIDs, timestamps) adds overhead with no memory win. `unique` pays off only when values repeat heavily.

### Pitfall 6 — `ServeMux` pattern conflicts panic

Two equally-specific overlapping patterns panic at registration. This is intentional. Resolve by making one more specific or removing the duplicate.

### Pitfall 7 — `slices.Delete` and aliasing

`slices.Delete(s, i, j)` shifts elements and **zeroes the tail** (since 1.22) to avoid memory leaks, returning a shorter slice. The original backing array is mutated — clone first if the caller still needs it.

---

## Self-Assessment

You can move on to [senior.md](senior.md) when you can:

- [ ] Draw the `Logger → Handler → Record/Attr` pipeline and explain `ReplaceAttr`
- [ ] Use `With`, `WithGroup`, `slog.Group`, and `*Context` log methods
- [ ] Choose between variadic `Info` and `LogAttrs` and justify it on performance
- [ ] Use the full `slices` API and the 1.23 iterator bridge functions
- [ ] Explain why `maps.Keys` returns an iterator and convert it to a slice
- [ ] State the concrete problems `math/rand/v2` fixed and how to get reproducibility
- [ ] Use `unique.Make`/`Handle` and say when interning pays off
- [ ] Write `ServeMux` patterns with methods, `{id}`, `{path...}`, `{$}`, and predict precedence
- [ ] Migrate off `x/exp/slices`/`maps` and `math/rand` v1

---

## Summary

The modern stdlib is shaped by generics and iterators. **`slog`** is a `Logger → Handler → Record/Attr` pipeline; you swap handlers for format/destination, bind context with `With`/groups, and reach for `LogAttrs` when performance matters. **`slices`**/**`maps`**/**`cmp`** are the generic collection toolkit, with the 1.23 iterator functions (`Collect`, `Sorted`, `Keys`, `Values`, `All`) bridging to `iter.Seq`. **`math/rand/v2`** is a deliberate redo: PCG/ChaCha8 generators, generic `N`, consistent `*N` naming, and no global reseeding. **`unique`** interns repeated values for memory and fast equality. The **1.22 `ServeMux`** finally does method-and-wildcard routing with `PathValue` and specificity-based precedence. Adopt them by raising your `go` directive, replacing hand loops, and migrating off the `x/exp` and v1 packages with the small signature changes noted above.
