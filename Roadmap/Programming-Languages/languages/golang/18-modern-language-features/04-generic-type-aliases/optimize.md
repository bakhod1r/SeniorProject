# Generic Type Aliases — Optimization

> Honest framing first: a generic type alias has **zero runtime cost**. It is resolved entirely at compile time into its right-hand side; there is no wrapper, no indirection, no allocation. So "optimization" here is not about speed — `Set[int]` performs identically to `map[int]struct{}` because it *is* that type in the binary. What is genuinely worth optimizing is the **design and ergonomics** of generic code: removing verbose repetition, deleting wrapper-and-forwarding boilerplate that aliases now make unnecessary, simplifying constraint-heavy signatures, and choosing alias-vs-defined-type so the compiler and your readers do less work.
>
> Each entry below states the problem, shows a "before" and an "after," and the realistic gain. The closing sections cover when an alias is the *wrong* tool — because over-aliasing has real costs of its own.

---

## Optimization 1 — Replace a wrapper-and-forward re-export with an alias

**Problem:** Before Go 1.24, re-exporting a generic type meant a wrapper defined type plus hand-forwarded methods. That is a distinct type (breaking identity) and a pile of boilerplate.

**Before:**
```go
type Cache[K comparable, V any] struct{ impl internal.Cache[K, V] }

func New[K comparable, V any]() *Cache[K, V] { return &Cache[K, V]{} }
func (c *Cache[K, V]) Get(k K) (V, bool)     { return c.impl.Get(k) }
func (c *Cache[K, V]) Set(k K, v V)          { c.impl.Set(k, v) }
func (c *Cache[K, V]) Len() int              { return c.impl.Len() }
// ...one forwarder per method, forever
```

**After:**
```go
type Cache[K comparable, V any] = internal.Cache[K, V] // identity preserved, methods carry over
func New[K comparable, V any]() *Cache[K, V] { return internal.New[K, V]() }
```

**Expected gain:** Delete every forwarder. The method set transfers automatically (it comes from the RHS), and `store.Cache[K,V]` is now *identical* to `internal.Cache[K,V]` — callers interoperate with no conversion. One line replaces dozens, and the re-export can never drift out of sync with the upstream method set.

---

## Optimization 2 — Name a verbose generic literal once

**Problem:** A long generic type literal repeated across many signatures is noise. Readers re-parse the same `struct{...}` or `func(...)` shape every time.

**Before:**
```go
func register(path string, h func(context.Context, Request) (Response, error)) {}
func wrap(h func(context.Context, Request) (Response, error)) func(context.Context, Request) (Response, error) {}
var routes map[string]func(context.Context, Request) (Response, error)
```

**After:**
```go
type Handler[Req, Res any] = func(context.Context, Req) (Res, error)

func register(path string, h Handler[Request, Response]) {}
func wrap(h Handler[Request, Response]) Handler[Request, Response] {}
var routes map[string]Handler[Request, Response]
```

**Expected gain:** Each signature shrinks to the part that varies. Because `Handler[...]` is *identical* to the function type, every plain function literal still satisfies it with no conversion. The intent ("this is a handler") is now in the name.

---

## Optimization 3 — Simplify a constraint-heavy signature

**Problem:** A function whose parameters all share a long, repeated generic shape forces the reader to mentally substitute the same type over and over.

**Before:**
```go
func merge[K comparable, V any](
    a map[K][]V,
    b map[K][]V,
) map[K][]V { /* ... */ }
```

**After:**
```go
type MultiMap[K comparable, V any] = map[K][]V

func merge[K comparable, V any](a, b MultiMap[K, V]) MultiMap[K, V] { /* ... */ }
```

**Expected gain:** The signature names the data structure (`MultiMap`) instead of spelling its shape three times. No runtime change; the readability win is the point. Callers' raw `map[K][]V` values still pass directly — identity holds.

---

## Optimization 4 — Provide a domain vocabulary without new types

**Problem:** Domain code reads better with domain words, but you do not want the overhead (or the conversions) of defined types where no behavior or invariant is needed.

**Before:**
```go
func lookup(id string, all map[string]User) (User, bool) { u, ok := all[id]; return u, ok }
```

**After:**
```go
type ByID[T any] = map[string]T

func lookup(id string, all ByID[User]) (User, bool) { u, ok := all[id]; return u, ok }
```

**Expected gain:** `ByID[User]` reads as the domain concept it is. Since it is identical to `map[string]User`, callers pass raw maps with no friction. Use this only where the name *adds* clarity — `ByID` does; `M[T] = map[string]T` named `M` does not.

---

## Optimization 5 — Use an alias as a zero-cost migration shim

**Problem:** Renaming or moving a generic type means touching every call site at once — a risky flag-day change — unless you can keep the old name working.

**Before (flag-day rename):**
```go
// rename Outcome → Result everywhere in one PR; every consumer breaks until updated
type Result[T any] struct{ Value T; Err error }
```

**After (shim absorbs the transition):**
```go
type Result[T any] struct{ Value T; Err error }

// Deprecated: use Result. Kept for one release cycle.
type Outcome[T any] = Result[T]
```

**Expected gain:** Old and new names are the *same type* for the deprecation window, so consumers migrate on their own schedule with no incompatible-type errors. The "optimization" is to your *change-management* cost: you decouple the rename from the call-site updates and remove risk from the rollout.

---

## Optimization 6 — Prefer a defined type when you actually need behavior

**Problem:** Reaching for an alias and then discovering you need a method forces a disruptive refactor (and a churn of call-site conversions if the type was already public).

**Before (alias, then stuck):**
```go
type Set[T comparable] = map[T]struct{}
// later: "I need s.Add(v) and s.Contains(v)" — impossible on an alias
```

**After (decide up front):**
```go
type Set[T comparable] map[T]struct{}            // defined type from the start
func (s Set[T]) Add(v T)        { s[v] = struct{}{} }
func (s Set[T]) Contains(v T) bool { _, ok := s[v]; return ok }
```

**Expected gain:** Avoids a future refactor. Ask the design question early — "will I ever want a method or a distinct type?" If yes, start with a defined type; the alias would only have to be torn out later (and tearing out a *public* alias changes identity, a potentially breaking change).

---

## Optimization 7 — Keep alias chains shallow

**Problem:** Each alias hop is free at runtime but costs a reader (and a tool author) a lookup. Deep chains turn a simple type into a scavenger hunt.

**Before:**
```go
type A[T any]        = B[T]
type B[T comparable] = C[T]
type C[T comparable] = D[T]
type D[T comparable] = map[T]struct{}
```

**After:**
```go
type Set[T comparable] = map[T]struct{} // one hop, intent clear
```

**Expected gain:** The real type is one lookup away, not four. Constraints are visible at the declaration that matters. As a bonus, you avoid the class of bugs where a loose constraint high in the chain fails to satisfy a strict one lower down.

---

## Optimization 8 — Strengthen a constraint to expose a narrower, safer view

**Problem:** A general type accepts a broad constraint, but a particular API should only allow a subset — and you do not want to duplicate the type.

**Before (callers can pass any comparable key, including ones this API mishandles):**
```go
func sortedKeys[K comparable, V any](m map[K]V) []K { /* needs ordering! */ }
```

**After (alias narrows the constraint without a new type):**
```go
type OrderedMap[K cmp.Ordered, V any] = map[K]V

func sortedKeys[K cmp.Ordered, V any](m OrderedMap[K, V]) []K { /* can sort K */ }
```

**Expected gain:** The signature now *documents and enforces* that keys must be ordered, using the same underlying `map[K]V`. You may strengthen a constraint on an alias (narrowing callers); you may never weaken it. This turns a latent runtime assumption into a compile-time guarantee at zero runtime cost.

---

## Optimization 9 — Re-export with verbatim constraints to avoid friction

**Problem:** A re-export that subtly changes a constraint either fails to compile (if weakened) or surprises callers (if needlessly narrowed), adding friction to an otherwise transparent boundary.

**Before:**
```go
// RHS: type Cache[K comparable, V any] struct {...}
type Cache[K cmp.Ordered, V any] = internal.Cache[K, V] // accidental over-narrowing
// now string-keyed-but-unordered use cases that internal.Cache supports are blocked
```

**After:**
```go
type Cache[K comparable, V any] = internal.Cache[K, V] // verbatim — maximally compatible
```

**Expected gain:** The re-export behaves exactly like the source type — fewer "why does the re-export reject this?" support questions. Narrow deliberately (Opt 8) only when you *mean* to; otherwise copy constraints verbatim.

---

## Optimization 10 — Delete redundant non-generic aliases of instantiations

**Problem:** Teams sometimes accumulate one-off aliases for specific instantiations that add a name without adding clarity, growing the vocabulary readers must learn.

**Before:**
```go
type Set[T comparable] = map[T]struct{}
type StringSet         = Set[string]    // earns its keep?
type IntSet            = Set[int]
type RuneSet           = Set[rune]
type ByteSet           = Set[byte]
// ...a dozen more
```

**After (keep only the ones that carry domain meaning):**
```go
type Set[T comparable] = map[T]struct{}
type UserIDSet = Set[UserID] // domain concept — keep
// drop StringSet/IntSet/etc.: Set[string] is already clear at the call site
```

**Expected gain:** A smaller, more meaningful type vocabulary. `Set[string]` is self-explanatory; `StringSet` adds a synonym to memorize for no benefit. Reserve named instantiations for genuine domain concepts.

---

## Measurement

There is nothing to *benchmark* about the alias mechanism — it is a compile-time renaming with no runtime footprint. Confirm that for yourself once, then focus measurement on the design metrics that actually move:

```bash
# Prove zero runtime presence: the reflected type is the resolved RHS.
cat > t.go <<'EOF'
package main
import ("fmt"; "reflect")
type Set[T comparable] = map[T]struct{}
func main() { fmt.Println(reflect.TypeOf(Set[int]{})) } // map[int]struct {}
EOF
go run t.go

# Confirm no conversions are needed (identity holds) — it compiles or it doesn't.
go build ./...

# Design-level signals worth tracking on a refactor:
#  - lines of forwarding boilerplate deleted (Opt 1)
#  - repeated generic literals collapsed to a name (Opt 2/3)
#  - depth of alias chains (keep at 1) (Opt 7)
#  - count of named instantiations that carry no domain meaning (Opt 10)
```

The honest metric for a generic-alias change is *reader and maintainer effort*, not nanoseconds. A change that does not make signatures clearer, delete boilerplate, or de-risk a migration is not an improvement.

---

## When NOT to Use an Alias

An alias is the wrong tool whenever you need something it structurally cannot provide:

- **You need methods or invariants.** Aliases have no method set and no encapsulation. Use a defined type.
- **You need unit/identity safety.** `type UserID = int64` is interchangeable with `int64` and any other `= int64` alias. Use a defined type so the compiler keeps them apart.
- **You want a stable public API insulated from an internal type.** An alias welds the public name to the internal type. Use a defined wrapper when you need freedom to refactor internals.
- **You want to "hide" the source package.** Docs and reflection see through the alias to the resolved type. If hiding is a real requirement, wrap.
- **Over-naming.** A package full of one-letter aliases for maps and slices is *harder* to read. Name a shape only when the name adds clarity.
- **You cannot accept a Go 1.24 floor.** Adopting generic aliases in exported API forces all consumers onto Go 1.24+. If that floor is unacceptable, defer adoption.

Use an alias when you want a transparent, identity-preserving name — re-export, migration, naming a shared shape, narrowing a constraint. Reach for a defined type the moment you need behavior, distinctness, encapsulation, or insulation. The biggest "optimization" is making that choice correctly the first time.

---

## Summary

Generic type aliases cost nothing at runtime, so the wins are all in design. The headline optimization is deleting the pre-1.24 wrapper-and-forward pattern: an alias re-exports a generic type with identity preserved and the method set carried over for free, collapsing dozens of forwarder methods into one line. The rest are readability and change-management wins: naming verbose generic literals once, simplifying constraint-heavy signatures, providing a domain vocabulary without new types, using an alias as a zero-break migration shim, and strengthening a constraint to expose a narrower, safer view — all at zero runtime cost.

The counter-discipline matters just as much: keep alias chains to one hop, copy re-export constraints verbatim unless you mean to narrow, prune named instantiations that carry no domain meaning, and — most importantly — reach for a *defined* type the instant you need methods, distinctness, invariants, or insulation. The single most valuable optimization is choosing alias vs defined type correctly up front, because tearing a public alias out later changes type identity and is potentially breaking.
