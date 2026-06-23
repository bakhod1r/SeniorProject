# Generic Type Aliases — Find the Bug

> Each snippet contains a real bug related to generic type aliases. Recall the rules: an alias (`type A[P ...] = RHS`) denotes its right-hand side — `Alias[Args]` is *identical* to the substituted RHS; it cannot have methods; its constraints must be at least as strong as the RHS requires; alias chains must be acyclic; and the feature is Go 1.24 (experimental behind `GOEXPERIMENT=aliastypeparams` in 1.23). Find the bug, explain it, fix it.

---

## Bug 1 — Method on an alias

```go
type Set[T comparable] = map[T]struct{}

func (s Set[T]) Add(v T) { s[v] = struct{}{} } // ?
```

```
./set.go: invalid receiver type Set (alias type)
```

**Bug:** You cannot declare methods on an alias. `Set` is not a defined type — it denotes `map[T]struct{}`, and a composite type literal is not a valid receiver base.

**Fix:** drop the `=` to make `Set` a *defined* type, which can carry methods:

```go
type Set[T comparable] map[T]struct{}            // defined type, no '='
func (s Set[T]) Add(v T) { s[v] = struct{}{} }   // now legal
```

Trade-off to accept: `Set[int]` is now *distinct* from `map[int]struct{}` and needs a conversion to cross that boundary.

---

## Bug 2 — Constraint weaker than the RHS demands

```go
type Set[T any] = map[T]struct{} // ?
```

```
./set.go: invalid map key type T (missing comparable constraint)
```

**Bug:** The RHS is a map; map keys must be comparable. The alias declares `T any`, which would allow non-comparable keys, so the *declaration* is rejected.

**Fix:** the alias's constraint must be at least as strong as the RHS requires:

```go
type Set[T comparable] = map[T]struct{}
```

You could strengthen further (`T cmp.Ordered`) to narrow callers, but never weaken below `comparable`.

---

## Bug 3 — Assuming the alias is a distinct type

```go
type UserID  = int64
type OrderID = int64

func charge(o OrderID) { /* ... */ }

func main() {
    var u UserID = 42
    charge(u) // compiles — but this is a logic bug!
}
```

**Bug:** `UserID`, `OrderID`, and `int64` are all the *same type* because they are aliases. The compiler cannot stop you passing a user id where an order id is expected. The "type safety" is illusory.

**Fix:** use *defined* types when you want the compiler to keep them apart:

```go
type UserID  int64
type OrderID int64
// charge(u) now fails to compile: UserID is not OrderID
```

Aliases *erase* distinctions; defined types *create* them. Pick by intent.

---

## Bug 4 — Trying to add behavior via the alias instead of the underlying type

```go
type Cache[K comparable, V any] = internal.Cache[K, V]

func (c *Cache[K, V]) Warm() { /* ... */ } // ?
```

```
./store.go: cannot define new methods on alias type Cache
```

**Bug:** Even though `internal.Cache` is a defined type with methods, you cannot add *new* methods through the alias. The alias only names the type; it is not a defined type in this package.

**Fix:** either add the method upstream on `internal.Cache`, or wrap with a *defined* type (accepting the identity break and method-forwarding cost):

```go
type Cache[K comparable, V any] struct{ internal.Cache[K, V] } // distinct type
func (c *Cache[K, V]) Warm() { /* ... */ }                      // now legal on the wrapper
```

If you only needed to *re-export* (not extend), keep the alias and drop `Warm` here.

---

## Bug 5 — Cyclic alias

```go
type A[T any] = B[T]
type B[T any] = A[T] // ?
```

```
./cyc.go: invalid recursive type alias A
```

**Bug:** Each alias denotes the other; substitution never terminates. Aliases must resolve to a concrete (non-alias) type eventually.

**Fix:** break the cycle. If you genuinely need self-reference, use a *defined* type, whose name provides a finite reference point:

```go
type List[T any] struct {
    Head T
    Tail *List[T] // valid: defined type, recursion terminates at the name
}
```

---

## Bug 6 — Bare alias name used as a type

```go
type Set[T comparable] = map[T]struct{}

func process(s Set) { /* ? */ }
```

```
./p.go: cannot use generic type Set[T comparable] without instantiation
```

**Bug:** A generic alias must be instantiated before use as a type. `Set` alone is not a type; `Set[string]` is.

**Fix:** supply type arguments, or make the function itself generic:

```go
func process[T comparable](s Set[T]) { /* ... */ } // Set[T] is instantiated by T
```

---

## Bug 7 — Expecting a type switch to distinguish alias from RHS

```go
type Set[T comparable] = map[T]struct{}

func classify(v any) string {
    switch v.(type) {
    case Set[int]:
        return "set"
    case map[int]struct{}: // ?
        return "map"
    }
    return "other"
}
```

```
./c.go: duplicate case map[int]struct{} in type switch
        previous case at ./c.go (Set[int])
```

**Bug:** `Set[int]` and `map[int]struct{}` are the *same type*, so the two cases are duplicates. A type switch cannot tell them apart — there is nothing to tell apart.

**Fix:** keep one case. If you truly need to distinguish "set-ness," you need a *defined* type (`type Set[T comparable] map[T]struct{}`), which is a distinct runtime type the switch can match separately.

---

## Bug 8 — Relying on the 1.23 experiment

```bash
$ go version
go version go1.23.4 darwin/arm64
$ go build ./...
./set.go: type parameters require go1.24 or later (-lang was set to go1.23)
```

```go
// works only because the author had GOEXPERIMENT=aliastypeparams set locally
type Set[T comparable] = map[T]struct{}
```

**Bug:** The code compiles on the author's machine because they set `GOEXPERIMENT=aliastypeparams`, but generic aliases are experimental and off-by-default in 1.23. Teammates and CI without the flag fail.

**Fix:** target Go 1.24 (where the feature is default) and set the directive so the requirement is explicit:

```go.mod
go 1.24
```

Never depend on `GOEXPERIMENT=aliastypeparams` — it was a stepping stone, not a stable interface.

---

## Bug 9 — Re-export aliased but constructor forgotten

```go
// pkg/store
type Cache[K comparable, V any] = internal.Cache[K, V]
```

```go
// consumer
c := store.Cache[string, int]{} // ?
c.Set("a", 1)
```

```
./main.go: cannot use composite literal: internal.Cache has unexported fields
```

**Bug:** The alias re-exports the *type*, but `internal.Cache` has unexported fields and must be built via its constructor. Aliasing the type does not re-export the constructor or grant access to unexported fields.

**Fix:** re-export the constructor as a function alongside the alias:

```go
// pkg/store
type Cache[K comparable, V any] = internal.Cache[K, V]
func New[K comparable, V any]() *Cache[K, V] { return internal.New[K, V]() }
```

```go
c := store.New[string, int]()
c.Set("a", 1)
```

---

## Bug 10 — Weakening a constraint on a re-export

```go
// internal.Cache requires comparable keys:
//   type Cache[K comparable, V any] struct { ... }

type Cache[K any, V any] = internal.Cache[K, V] // ?
```

```
./store.go: K does not satisfy comparable (in internal.Cache[K, V])
```

**Bug:** The re-export declares `K any`, weaker than the RHS's `K comparable`. The substituted RHS could be ill-formed (`internal.Cache[[]byte, V]`), so the declaration is rejected.

**Fix:** copy the RHS constraints verbatim (or strengthen):

```go
type Cache[K comparable, V any] = internal.Cache[K, V]
```

When designing for re-export, library authors should use only *exported, nameable* constraints so a verbatim alias is always possible.

---

## Bug 11 — Aliasing for unit safety in a money type

```go
type Cents = int64

func add(a, b Cents) Cents { return a + b }

func main() {
    var dollars int64 = 5
    fmt.Println(add(dollars, dollars)) // compiles — dollars treated as Cents!
}
```

**Bug:** `Cents` is an alias of `int64`, so a raw `int64` (here meant as *dollars*) is accepted where `Cents` is expected. The unit distinction is not enforced.

**Fix:** use a defined type and a constructor:

```go
type Cents int64
func DollarsToCents(d int64) Cents { return Cents(d * 100) }
func add(a, b Cents) Cents { return a + b }
// add(dollars, dollars) now fails to compile
```

---

## Bug 12 — Expecting reflection to report the alias name

```go
type Set[T comparable] = map[T]struct{}

func main() {
    fmt.Println(reflect.TypeOf(Set[int]{}).Name()) // ?
}
```

```
(prints an empty string, not "Set")
```

**Bug:** The alias does not exist at runtime. `Set[int]` *is* `map[int]struct{}`, an unnamed map, so `Name()` is empty. Code that registers or dispatches on `reflect.Type.Name()` will not see "Set".

**Fix:** if you need a runtime-distinguishable type with a real name, use a *defined* type:

```go
type Set[T comparable] map[T]struct{}
reflect.TypeOf(Set[int]{}).Name() // "Set"
```

For an alias of a *defined* type (`type C[K,V] = pkg.Cache[K,V]`), reflection reports `pkg.Cache`'s name and package — never the alias's.

---

## Bug 13 — Deep alias chain hides the real constraint

```go
type A[T any]          = B[T]
type B[T comparable]   = C[T] // ?
type C[T comparable]   = map[T]struct{}
```

```
./chain.go: T does not satisfy comparable (in B[T])
```

**Bug:** `A` declares `T any` but passes `T` to `B`, which requires `comparable`. The looser top-level constraint cannot satisfy the stricter one downstream. The chain also obscures *where* the real requirement lives.

**Fix:** propagate the strongest constraint up the chain, and keep chains short:

```go
type A[T comparable] = C[T]
type C[T comparable] = map[T]struct{}
```

Prefer one hop. A three-level alias chain is legal but a maintenance hazard.

---

## Bug 14 — Tool reports two identical types as different (missing Unalias)

```go
// analyzer using go/types
if types.Identical(aliasType, rhsType) {
    report("same")
} else {
    report("DIFFERENT") // ? fires even though they ARE the same
}
```

**Bug:** `aliasType` is a `*types.Alias` wrapper; `rhsType` is the resolved type. `types.Identical` may treat the wrapped alias and the bare resolved type as different unless you resolve first. The analyzer reports a false difference.

**Fix:** `Unalias` before comparing identity:

```go
if types.Identical(types.Unalias(aliasType), types.Unalias(rhsType)) {
    report("same")
}
```

Rule for alias-aware tooling: resolve aliases whenever your logic is semantics-facing (identity, assignability, method sets); keep the alias only for source-facing output.

---

## Bug 15 — Swapping a public defined type for an alias breaks a consumer's type switch

```go
// v1 (defined type):
type Token struct{ Raw string }

// v2 (alias of an identically-shaped type elsewhere) — looks harmless:
type Token = auth.Token
```

```go
// downstream code that worked under v1:
switch x.(type) {
case mypkg.Token:   // under v2, this now matches auth.Token, surprising the author
}
```

**Bug:** Replacing a *defined* type with an *alias* changes the type's identity. `mypkg.Token` is no longer a distinct type — it is `auth.Token`. Reflection-based registries, type switches, and `errors.As`-style matching that relied on the old identity behave differently.

**Fix:** treat alias ↔ defined-type swaps on *public* types as potentially breaking, even when the structural shape is identical. If consumers depend on the old identity, keep the defined type, or make the change in a major version with clear release notes.

---

## Bug 16 — Constraint interface is unexported, blocking re-export

```go
// other pkg
type ordered interface{ ~int | ~string } // unexported
type Sorter[T ordered] struct { ... }
```

```go
// your pkg — trying to re-export:
type Sorter[T other.ordered] = other.Sorter[T] // ?
```

```
./s.go: other.ordered is not exported
```

**Bug:** You cannot name `other.ordered` (unexported) at your re-export site, so a verbatim alias is impossible. The type was not designed for cross-package re-export.

**Fix:** the upstream author must export the constraint (`Ordered`) for the type to be re-exportable. As a consumer, you can only file an issue or wrap with your own constraint that you can prove is compatible — there is no clean alias here. Design lesson: types intended for re-export must use *exported* constraints.

---

## Bug 17 — Forgetting that the alias has no encapsulation

```go
// intends "a validated, always-non-nil registry":
type Registry[T any] = map[string]T

func NewRegistry[T any]() Registry[T] { return Registry[T]{} }
```

```go
// elsewhere, bypassing the "constructor":
var r Registry[int] = nil   // nil map — no constructor enforced
r["x"] = 1                  // panic: assignment to entry in nil map
```

**Bug:** An alias provides no privacy boundary, so nothing forces callers through `NewRegistry`. They can build a `nil` `Registry[int]` directly because it is just a `map[string]int`.

**Fix:** to enforce an invariant (non-nil, validated), use a *defined* type with an unexported field and a constructor:

```go
type Registry[T any] struct{ m map[string]T }
func NewRegistry[T any]() Registry[T] { return Registry[T]{m: map[string]T{}} }
func (r Registry[T]) Set(k string, v T) { r.m[k] = v }
```

Aliases cannot enforce invariants; defined types can.

---

## Bug 18 — Generic alias in `go.mod go 1.21` project

```go.mod
go 1.21
```

```go
type Set[T comparable] = map[T]struct{}
```

```
./set.go: type parameters on aliases require go1.24 or later (-lang was set to go1.21 via go.mod)
```

**Bug:** Even on a Go 1.24 *toolchain*, the `go` directive sets the *language version*. With `go 1.21`, the compiler enforces 1.21 semantics and rejects generic aliases.

**Fix:** bump the directive to the version that supports the feature:

```go.mod
go 1.24
```

The directive both enables the feature and tells consumers the minimum version they need.

---

## Bug 19 — Partial-instantiation alias declares the wrong parameter count

```go
type Map[K comparable, V any] = map[K]V

type StringMap = Map[string] // ?
```

```
./m.go: not enough type arguments for type Map: have 1, want 2
```

**Bug:** `Map` has two parameters; you supplied one and left none open as a parameter of the new alias. This is neither a full instantiation nor a valid partial one.

**Fix:** decide what you want. To leave `V` open, declare a generic alias with `V`:

```go
type StringMap[V any] = Map[string, V] // partial: K=string, V open
```

To fully fix both:

```go
type StringIntMap = Map[string, int]   // non-generic alias
```

---

## Bug 20 — Assuming method promotion from an embedded alias preserves identity

```go
type Base[T any] = internal.Base[T]

type Service[T any] struct {
    Base[T] // embeds the aliased type
}
```

```go
// expecting *Service[int] to BE usable as *internal.Base[int]:
func use(b *internal.Base[int]) {}
func main() { use(&Service[int]{}) } // ? compile error
```

```
./s.go: cannot use &Service[int]{} (*Service[int]) as *internal.Base[int]
```

**Bug:** Embedding an aliased type into a *struct* creates a new, distinct type (`Service`). Embedding promotes methods but does **not** make `Service[int]` identical to `internal.Base[int]`. Only a direct alias (`type X[T any] = internal.Base[T]`) preserves identity.

**Fix:** if you want identity, alias directly rather than embedding:

```go
type Service[T any] = internal.Base[T] // identical to internal.Base[T]
```

If you embed (to *extend* with new fields/methods), accept that `Service` is a distinct type and pass `&s.Base` where the base is required.

---

## Summary

Generic type aliases are governed by a few rules, and almost every bug is a violation of one of them:

1. **An alias is not a defined type.** It cannot have methods, cannot be a method receiver, cannot enforce invariants, and creates no encapsulation boundary. When you need behavior, distinctness, or invariants, use a *defined* type (drop the `=`).
2. **An alias is *identical* to its RHS.** It does not create a distinct type — so it cannot give unit safety, cannot be distinguished in a type switch or by reflection, and an alias ↔ defined-type swap on a public type changes identity and is potentially breaking.
3. **Constraints and versions are strict.** The alias's constraint must be at least as strong as the RHS requires (never weaker); chains must be acyclic; constraints used at a re-export must be exported and nameable; and the feature requires `go 1.24` (set the directive, never rely on the 1.23 experiment).

Treat an alias as *exactly* a parameterized synonym for its right-hand side — no more, no less — and these bugs disappear.
