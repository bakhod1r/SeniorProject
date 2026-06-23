# Stdlib Generic Packages — Professional Level

## Table of Contents
1. [The migration story](#the-migration-story)
2. [Release-by-release additions](#release-by-release-additions)
3. [Code review patterns to enforce stdlib usage](#code-review-patterns-to-enforce-stdlib-usage)
4. [Team-level adoption playbook](#team-level-adoption-playbook)
5. [Summary](#summary)

---

## The migration story

Before Go 1.21 every team had its own `util` or `pkg/internal` directory full of helpers like `ContainsString`, `MapKeys`, `MaxInt`, `SortByName`. The migration to stdlib generics replaces those helpers, but the shape of the migration matters.

### From `sort.Slice` to `slices.SortFunc`

The pre-1.21 idiom for sorting a struct slice:

```go
sort.Slice(people, func(i, j int) bool {
    return people[i].Age < people[j].Age
})
```

Two annoyances:
1. The closure indexes back into `people`, which is verbose.
2. The comparator returns `bool`, not the standard tri-state `int`.

The post-1.21 idiom:

```go
slices.SortFunc(people, func(a, b Person) int {
    return cmp.Compare(a.Age, b.Age)
})
```

The closure receives elements directly, the comparator is the universal `cmp.Compare` form, and the function name says "sort a slice", not "sort by index".

Both styles still compile. `sort.Slice` will not be removed — it pre-dates generics and is part of the Go 1 compatibility promise. But new code should use `slices.SortFunc`.

### From manual loops to `slices.Contains`

```go
// Before
found := false
for _, v := range s {
    if v == target { found = true; break }
}

// After
found := slices.Contains(s, target)
```

One line, no off-by-one risk.

### From `for k := range m { keys = append(keys, k) }` to `maps.Keys`

```go
// Before (Go 1.20)
keys := make([]string, 0, len(m))
for k := range m { keys = append(keys, k) }

// Go 1.21–1.22
keys := maps.Keys(m) // returned []K

// Go 1.23+
keys := slices.Collect(maps.Keys(m)) // maps.Keys returns iter.Seq[K]
```

### From `if a != "" { return a }; if b != "" { return b }` to `cmp.Or`

```go
// Before
name := func() string {
    if userInput != "" { return userInput }
    if configValue != "" { return configValue }
    return "default"
}()

// After (1.22+)
name := cmp.Or(userInput, configValue, "default")
```

This idiom alone saves dozens of lines across a typical codebase.

---

## Release-by-release additions

The stdlib generic surface grew incrementally. Knowing what is in which release is essential for matching `go.mod` directives to the API you intend to use.

### Go 1.21 (August 2023)

The big bang. Notable additions:

- `slices` package promoted from `golang.org/x/exp/slices`
- `maps` package promoted from `golang.org/x/exp/maps`
- `cmp` package, including `cmp.Ordered`, `cmp.Compare`, `cmp.Less`
- `min`, `max`, `clear` as built-in functions
- `slices.Min`, `slices.Max`, `slices.MinFunc`, `slices.MaxFunc`
- `slices.BinarySearch`, `slices.BinarySearchFunc`

Release notes: <https://go.dev/doc/go1.21#minor_library_changes>

### Go 1.22 (February 2024)

- `slices.Concat` — concatenate any number of slices in one allocation
- `cmp.Or` — return first non-zero argument
- `slices.Repeat` — repeat a slice N times

Release notes: <https://go.dev/doc/go1.22>

### Go 1.23 (August 2024)

- `iter` package — `iter.Seq[T]` and `iter.Seq2[K, V]`
- `slices.All`, `slices.Values`, `slices.Backward` — return iterators over a slice
- `slices.Sorted`, `slices.SortedFunc`, `slices.SortedStableFunc` — collect from iterator into sorted slice
- `slices.Collect` — `iter.Seq[T]` to `[]T`
- `slices.AppendSeq` — append iterator output to existing slice
- `maps.Keys`, `maps.Values` switched to return `iter.Seq[K]` / `iter.Seq[V]`
- `maps.All`, `maps.Collect` — adapters between iterators and maps
- Range-over-func became a stable language feature

Release notes: <https://go.dev/doc/go1.23>

### Go 1.24 (February 2025)

- Generic type aliases (`type Vec[T any] = []T`) — fully supported, enabling cleaner type wrappers across the stdlib
- `weak.Pointer[T]` — generic weak pointer in `weak` package
- Fine-tuned performance improvements in `slices.Sort`

Release notes: <https://go.dev/doc/go1.24>

### Compatibility matrix

| Need | Minimum Go version |
|------|--------------------|
| `slices.Sort`, `cmp.Ordered` | 1.21 |
| `cmp.Or`, `slices.Concat` | 1.22 |
| `iter.Seq`, `slices.Collect`, iterator-returning `maps.Keys` | 1.23 |
| Generic type aliases | 1.24 |

Pin `go 1.23` in `go.mod` if you want the iterator API; pin `1.22` if `cmp.Or` is enough.

---

## Code review patterns to enforce stdlib usage

A team that has migrated to generic stdlib packages benefits from review rules. Recommended rules:

### Rule 1 — No hand-rolled `Contains` / `Index` / `Sort` helpers

If a reviewer sees:

```go
func contains(s []string, t string) bool { ... }
```

…they ask: "Why not `slices.Contains`?" Unless there is a reason (older Go version, custom equality), the helper is replaced.

### Rule 2 — `slices.SortFunc(s, cmp.Compare)` over `sort.Slice`

For new code, prefer the typed comparator. Only keep `sort.Slice` if the file is supporting Go < 1.21.

### Rule 3 — `cmp.Or` for first-non-zero chains

The pattern:

```go
v := a
if v == "" { v = b }
if v == "" { v = c }
```

…is flagged in review and rewritten as `cmp.Or(a, b, c)`.

### Rule 4 — `maps.Clone` over manual map copy loops

```go
// flagged
for k, v := range src { dst[k] = v }
// preferred
dst := maps.Clone(src)
```

The stdlib version is faster and clearer.

### Rule 5 — Watch for unused returns

Every reviewer should know that `slices.Insert`, `slices.Delete`, and `slices.Compact` **must be reassigned**. A bare call without assignment is almost always a bug.

### Rule 6 — Pre-size collections

If you know the final size, pre-size:

```go
keys := make([]string, 0, len(m))
```

Some teams add a linter rule for this.

### Rule 7 — Don't reinvent `cmp.Ordered`

If a team-internal `Ordered` constraint exists, replace it with `cmp.Ordered`. Multiple constraints with the same meaning create confusion.

### Tooling

- `gopls` flags some of these patterns automatically.
- `golangci-lint` has rules for unused return values.
- A team-internal `forbidigo` rule can ban `sort.Slice` in new files.
- `staticcheck` (`SA1029` family) catches some misuse but not this pattern set.

---

## Team-level adoption playbook

A working playbook used by several teams that migrated successfully:

### Phase 1 — Baseline

1. Bump `go.mod` to `go 1.21` (or whichever minimum your dependents allow).
2. Update CI to use the same toolchain.
3. Run `go vet` and `staticcheck` on the existing tree to surface pre-existing issues that the new linter rules might double-report.

### Phase 2 — Discover and replace

1. Grep for hand-written `Contains`, `MapKeys`, `MaxInt`, etc.
2. Replace with stdlib calls.
3. Add migration commits as small PRs grouped by module.

### Phase 3 — Lock the new style

1. Add forbidigo or staticcheck rules to ban `sort.Slice` in new files.
2. Update CONTRIBUTING.md with the patterns above.
3. Run a one-time `gopls` quick-fix sweep.

### Phase 4 — Iterator APIs

1. When you bump to `go 1.23`, decide if you want `maps.Keys` to return `iter.Seq[K]`. Most code paths can use `slices.Collect(maps.Keys(m))` to keep the slice idiom.
2. New code can use `for k := range maps.Keys(m)` directly for cleaner loops.

### Common migration mistakes

- **Removing `sort.Slice` from packages used by older consumers.** Backward compatibility breaks.
- **Replacing `interface{}` helpers without checking call sites.** Consumers may depend on the looser API.
- **Bumping `go.mod` past what users have installed.** Coordinate with downstream.
- **Mixing `maps.Keys` (1.21 slice form) and `slices.Collect(maps.Keys(...))` (1.23 form) in one PR.** Pick one and stick.

---

## Case studies

### Case 1 — A logging library

A team maintained a logging library with custom helpers `containsString`, `dedupStrings`, and `sortByLevel`. Migration:

1. Replaced `containsString` with `slices.Contains` — 12 call sites, one PR.
2. Replaced `dedupStrings` with `slices.Sort` + `slices.Compact` — semantics matched.
3. `sortByLevel` became `slices.SortFunc` with `cmp.Compare(a.Level, b.Level)`.

Result: removed 80 lines of utility code, no behaviour changes, faster benchmarks (the stdlib pdqsort beat the library's heapsort).

### Case 2 — A data pipeline

A pipeline processed batches of records, deduplicating by key and sorting by timestamp. Original code used `sort.Slice` and a manual `map[string]struct{}` dedup loop.

Migration replaced both with:

```go
slices.SortStableFunc(batch, func(a, b Record) int {
    return cmp.Or(
        cmp.Compare(a.Key, b.Key),
        cmp.Compare(a.Time.Unix(), b.Time.Unix()),
    )
})
batch = slices.CompactFunc(batch, func(a, b Record) bool {
    return a.Key == b.Key
})
```

Six lines replaced 30. Benchmarks improved by 12% on average batches.

### Case 3 — A configuration loader

The loader resolved config values from environment, file, and defaults. The original code:

```go
val := os.Getenv("FOO")
if val == "" { val = file["FOO"] }
if val == "" { val = "default" }
```

…replaced with `cmp.Or(os.Getenv("FOO"), file["FOO"], "default")`. Across the codebase: 60 lines saved, every chain became a one-liner.

The catch: `cmp.Or` evaluates all arguments. The team kept the explicit chain in places where lookup was expensive (`loadFromNetwork()`).

## Versioning your `go.mod`

Lock the minimum Go version that supports the stdlib API you use:

```go
// go.mod
module example.com/myapp

go 1.21    // for slices, maps, cmp
// or
go 1.22    // for cmp.Or, slices.Concat
// or
go 1.23    // for iter.Seq, slices.Collect, iterator-returning maps.Keys
// or
go 1.24    // for generic type aliases, weak.Pointer
```

Choose the minimum that works for the API you actually use. Bumping for "the latest" introduces compatibility friction with users on older toolchains.

For libraries with broad use, follow the **previous-stable** convention: support N-1 and N-2 stable Go releases. As of 2026, that means supporting 1.23 and 1.24 if 1.25 is current.

## Summary

The migration to `slices`, `maps`, and `cmp` is **incremental**, not "big bang". Teams that adopt them well:

1. **Track release notes** — know which API landed in which release.
2. **Lock minimum Go version** in `go.mod` and CI.
3. **Replace hand-written helpers** with stdlib calls in small PRs.
4. **Enforce review rules** — `slices.SortFunc(s, cmp.Compare)` over `sort.Slice`, `cmp.Or` over chained ifs.
5. **Coordinate with downstream consumers** before bumping the toolchain.
6. **Treat the iterator switch (1.23)** as a separate, deliberate migration.

The stdlib generic packages are the **foundation** of modern Go style. A team that has internalized them writes shorter, clearer, faster code — and onboards new engineers more quickly because the idioms are universal.

Move on to `specification.md` for accurate signatures and pkg-doc excerpts of the most important functions.
