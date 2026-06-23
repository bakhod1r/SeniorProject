# Why Generics? — Professional Level

## Table of Contents
1. The standard library's adoption journey
2. [`slices`, `maps`, `cmp` — the three anchor packages](#slices-maps-cmp-the-three-anchor-packages)
3. [`sync.OnceValue`, `atomic.Pointer[T]` and friends](#synconcevalue-atomicpointert-and-friends)
4. [Migration strategies for production codebases](#migration-strategies-for-production-codebases)
5. [Team-level guidelines](#team-level-guidelines)
6. [Case study: Kubernetes](#case-study-kubernetes)
7. [Case study: Hashicorp libraries](#case-study-hashicorp-libraries)
8. [Case study: Database drivers and ORMs](#case-study-database-drivers-and-orms)
9. [Case study: Observability and logging](#case-study-observability-and-logging)
10. [Case study: Internal Google adoption](#case-study-internal-google-adoption)
11. [Linters, tooling, and IDE support](#linters-tooling-and-ide-support)
12. [Migration checklist](#migration-checklist)
13. [Summary](#summary)

---

## The standard library's adoption journey

Go's stdlib is famously conservative. Generics arrived in 1.18 (March 2022) but the stdlib did not adopt them widely until later releases. Here is the timeline:

| Release | Date | Generic additions |
|---------|------|-------------------|
| 1.18 | Mar 2022 | Type parameters added; almost no stdlib uses them yet |
| 1.19 | Aug 2022 | Internal stdlib uses; `atomic.Pointer[T]` |
| 1.20 | Feb 2023 | `errors.Join`; experimental `slices`, `maps`, `cmp` in `golang.org/x/exp` |
| **1.21** | **Aug 2023** | **`slices`, `maps`, `cmp` promoted to stdlib**; `min`, `max`, `clear` builtins |
| 1.22 | Feb 2024 | `slices.Concat`; `cmp.Or` |
| 1.23 | Aug 2024 | Range-over-func; `iter.Seq[T]`, `iter.Seq2[K, V]` |
| 1.24 | Feb 2025 | Generic type aliases; `weak.Pointer[T]` |

The deliberate two-release gap between language support (1.18) and stdlib adoption (1.21) was a quality bar: the team waited to see how the community used generics before locking in stdlib APIs.

---

## `slices`, `maps`, `cmp` — the three anchor packages

### `slices`

```go
import "slices"

slices.Contains(s, target)        // bool
slices.Index(s, target)           // int
slices.Sort(s)                    // in-place sort
slices.SortFunc(s, cmpFunc)       // custom compare
slices.Reverse(s)
slices.Equal(a, b)
slices.Compact(s)
slices.Concat(a, b, c)            // 1.22+
slices.Min(s)                     // 1.21+, panics on empty
slices.Max(s)
slices.BinarySearch(s, target)
slices.Insert(s, i, v...)
slices.Delete(s, i, j)
slices.Clone(s)
```

These replace **dozens** of one-off helpers that every team used to write. They are also extensively benchmarked and inlined by the Go compiler.

### `maps`

```go
import "maps"

maps.Keys(m)         // iter.Seq[K] in 1.23+; []K in 1.21
maps.Values(m)
maps.Equal(a, b)
maps.Clone(m)
maps.Copy(dst, src)
maps.DeleteFunc(m, fn)
```

### `cmp`

```go
import "cmp"

cmp.Ordered    // constraint
cmp.Compare[T cmp.Ordered](a, b T) int
cmp.Less[T cmp.Ordered](a, b T) bool
cmp.Or[T comparable](vals ...T) T   // first non-zero; 1.22+
```

The `cmp.Ordered` constraint in particular has become **the standard** way to write "this T can be compared with `<`". Hand-rolling your own `Ordered` is now an anti-pattern.

---

## `sync.OnceValue`, `atomic.Pointer[T]` and friends

The `sync` and `sync/atomic` packages were among the first to adopt generics:

```go
// One-time initialization
var initOnce = sync.OnceValue[*DB](func() *DB { return openDB() })
db := initOnce()

// Type-safe atomic pointer
var p atomic.Pointer[Config]
p.Store(&Config{...})
cfg := p.Load() // *Config — no cast
```

These small wrappers eliminate years of `unsafe.Pointer` and `interface{}` glue. They are **the** model for what a good generic stdlib API looks like.

### Why `sync.Pool` is not generic

`sync.Pool.Get()` still returns `interface{}`. The team considered `Pool[T]` but decided against it because:

1. Pools often store **multiple** types
2. The boxing cost is amortised by reuse
3. Backwards compatibility for the existing API

This is a useful counter-example: **not every API benefits** from genericization.

---

## Migration strategies for production codebases

A team migrating a large Go codebase to generics has three realistic strategies:

### Strategy 1 — Big bang

Convert all `interface{}` helpers in one PR. Fast, but risky:
- One mistake breaks the world
- Code review burden is huge
- Easy to introduce subtle behaviour changes

Used by smaller projects (< 50 kLoC).

### Strategy 2 — Trickle migration

Add generic versions **alongside** existing code. Deprecate the old version. Migrate callers gradually.

```go
// Deprecated: use slices.Contains
func Contains(s []string, target string) bool { ... }

// New
func ContainsAny[T comparable](s []T, target T) bool { ... }
```

Used by Kubernetes, Hashicorp, Cloudflare. **Recommended** for most teams.

### Strategy 3 — Layer-by-layer

Migrate one architectural layer at a time:
1. Internal utility libs first
2. Then domain helpers
3. Then public APIs (carefully)

Slow but safe. Used in regulated industries (fintech, healthcare).

### Migration anti-patterns

- **Changing public API in place** — every dependent breaks
- **Mixing styles within one file** — readers get confused
- **Forgetting to update CI** to require Go 1.18+ before introducing generics
- **Generic-ifying without benchmarks** — sometimes the old code was faster

---

## Team-level guidelines

After observing dozens of teams migrate to generics, consistent patterns emerge.

### Adoption phases

1. **Phase 0 — Forbidden.** "We are on Go 1.16. Generics do not exist."
2. **Phase 1 — Internal only.** Generics are allowed in `internal/` packages but forbidden in public APIs.
3. **Phase 2 — Stdlib-pattern only.** Allowed if it mirrors a stdlib pattern (e.g., wraps `slices`).
4. **Phase 3 — Idiomatic.** Used everywhere it makes sense.

Most teams sit in **Phase 2** for at least a year before reaching Phase 3.

### Style guides

A typical team rulebook looks like:

> 1. Use `any`, not `interface{}`, in new code.
> 2. Prefer `slices.X` and `maps.X` over hand-rolled equivalents.
> 3. Type parameters: single uppercase letters (`T`, `K`, `V`, `E`).
> 4. New generic helpers must be added to `internal/util/generic` first.
> 5. Generic public API requires two reviewers and benchmark numbers.
> 6. No method-level type parameters (they don't exist in Go anyway).
> 7. Document any non-obvious constraint.

### Code review checklist

| Check | Why |
|-------|-----|
| Does the function need to be generic? | Avoid premature abstraction |
| Is the constraint as loose as possible? | Tightening later is hard |
| Are type parameter names idiomatic? | Readability |
| Is type inference working at all call sites? | Sometimes manual instantiation is needed |
| Are there benchmarks if it replaces a hot path? | Performance regressions are subtle |

---

## Case study: Kubernetes

Kubernetes is one of the largest Go codebases (5+ million LoC). Its lister/informer/cache layers were built before generics with **massive amounts of generated code** — every API resource (Pod, Service, Deployment, …) had its own typed lister, generated by `client-gen`.

After Go 1.18 the SIG API Machinery team introduced experimental generic helpers:

```go
// Before
type PodLister interface {
    List(selector labels.Selector) ([]*v1.Pod, error)
    Get(name string) (*v1.Pod, error)
}
type ServiceLister interface { ... } // identical structure
type DeploymentLister interface { ... }

// After (experimental)
type GenericLister[T runtime.Object] interface {
    List(selector labels.Selector) ([]T, error)
    Get(name string) (T, error)
}
```

The full migration is **still in progress** — even years after 1.18 — because Kubernetes' API stability guarantees prevent quick breaking changes. But the **client-go shared informers** have been quietly using generics under the hood since 1.21.

Lessons from Kubernetes:
- **Public API migration is slow** when stability matters
- **Internal layers** can adopt generics aggressively
- **Codegen still has a role** for things like deepcopy, conversion, and protobuf — generics did not kill it

---

## Case study: Hashicorp libraries

Hashicorp maintains widely used libraries: `hashicorp/golang-lru`, `hashicorp/go-multierror`, `hashicorp/hcl`. Their migration approach was textbook:

### golang-lru — generic LRU cache

```go
// v1 (pre-generics)
import "github.com/hashicorp/golang-lru"
cache, _ := lru.New(128)
cache.Add("key", value)
v, _ := cache.Get("key")
v.(string) // type assertion required

// v2 (post-generics)
import "github.com/hashicorp/golang-lru/v2"
cache, _ := lru.New[string, *User](128)
cache.Add("key", &User{...})
v, _ := cache.Get("key") // v is *User, no assertion
```

Hashicorp shipped this as a **new major version** (`/v2`), not as a breaking change to v1. This is the **canonical** approach: parallel module path, semver bump, gradual migration.

### Lessons

- **New major version** for breaking generic refactors
- **Keep v1 alive** for callers who cannot upgrade
- **Document migration path** clearly in the README

---

## Case study: Database drivers and ORMs

`database/sql` itself is **not** generic — `Scan(dest ...interface{})` still works the old way. But many ORMs and helpers have gone generic:

### sqlx-style helpers

```go
type User struct {
    ID   int
    Name string
}

// Generic helper
func QueryOne[T any](db *sql.DB, query string, args ...any) (*T, error) {
    row := db.QueryRow(query, args...)
    var t T
    if err := scanInto(row, &t); err != nil { return nil, err }
    return &t, nil
}

u, err := QueryOne[User](db, "SELECT * FROM users WHERE id = ?", 1)
```

Frameworks like `gorm`, `ent`, `sqlboiler`, and `bun` all have generic query APIs now. The user no longer writes `Scan(&u)` — the framework does it.

### Caveats

- Reflection is **still required** to map column names to struct fields
- Generics give you the **return type**, not the magic of mapping
- Performance is not free — the generic wrapper still calls `reflect`

---

## Case study: Observability and logging

`log/slog` (added in Go 1.21) does not use generics for its main API:

```go
slog.Info("hello", "user", u, "count", n)
```

It uses `...any` because logs are inherently variadic and heterogeneous. **Generics are not the right tool here.**

But auxiliary helpers in metrics libraries (Prometheus, OpenTelemetry) often use generics:

```go
type Counter[L prometheus.Labels] struct { ... }
func (c *Counter[L]) Inc(labels L) { ... }
```

Lesson: **logging is heterogeneous** (use `any`), **metrics are homogeneous** (use generics).

---

## Case study: Internal Google adoption

Google's monorepo contains millions of lines of Go. Their internal style guide (excerpts have been published in talks):

1. Generics are **opt-in** for new code, not mandatory for old.
2. Internal libraries (`util/`, `internal/`) may use generics freely.
3. Public APIs of products (Cloud SDK, gRPC, etc.) introduce generics only with explicit design review.
4. Generated code (protobuf, RPC stubs) is **still generated**, not generic.
5. `context.Context` was considered for genericization — and rejected. Some abstractions resist generics.

The Google experience confirms what smaller teams discover: **generics solve specific problems excellently and are useless for others**.

---

## Linters, tooling, and IDE support

After 1.18, the Go ecosystem caught up:

| Tool | Generic support |
|------|-----------------|
| `gofmt` | Day 1 |
| `gopls` | Day 1, with bugs ironed out by 1.20 |
| `staticcheck` | 1.19+ (with new generic checks like `SA9009`) |
| `revive` | Mid-2022 |
| `golangci-lint` | Bundled support shortly after |
| GoLand | Day 1 |
| VS Code Go | Improved gradually 2022-2023 |
| `dlv` (debugger) | Some quirks with stenciled bodies |
| `pprof` | Generic functions appear with mangled names |

Two practical tips:

1. **`pprof` flame graphs** show generic functions as `pkg.F[go.shape.int]` — the suffix tells you the GC shape, useful for performance work.
2. **`go vet`** has a new check (`-shadow`) for type parameters shadowing types in scope.

---

## Migration checklist

A pragmatic checklist for a team about to start using generics:

- [ ] Go version bumped to 1.18 or newer in `go.mod` (recommend 1.21+ for stdlib `slices`/`maps`)
- [ ] CI passes with `-tags generics` (no longer needed in 1.21+)
- [ ] Style guide updated with naming conventions
- [ ] At least one team member has read the [intro-generics blog post](https://go.dev/blog/intro-generics)
- [ ] Internal `internal/util/generic` package created for shared helpers
- [ ] Linter rules updated (`staticcheck`, `golangci-lint`)
- [ ] Public API decisions documented in design doc
- [ ] Benchmarks added for generic versions of hot paths
- [ ] Old `interface{}` helpers marked deprecated, not deleted
- [ ] CONTRIBUTING.md updated with generic guidelines
- [ ] Onboarding docs include the difference between `any`, `comparable`, and `cmp.Ordered`

---

## Summary

The professional view of generics is **strategic, not tactical**. A working engineer must:

1. **Understand the stdlib's gradual adoption** and use `slices`, `maps`, `cmp` first.
2. **Pick a migration strategy** that matches the team's risk tolerance.
3. **Codify team rules** — naming, constraint policy, public API rules.
4. **Learn from real case studies** — Kubernetes' slow migration, Hashicorp's `/v2` model, Google's selective adoption.
5. **Keep tooling current** — generics changed how `pprof`, `gopls`, and linters work.

Generics are now a normal part of Go. A professional team treats them like any other language feature: **a tool with costs and benefits, used deliberately, reviewed carefully, measured for performance**.

The next file (`specification.md`) digs into the formal grammar of type parameters, so you can read the Go spec confidently.
