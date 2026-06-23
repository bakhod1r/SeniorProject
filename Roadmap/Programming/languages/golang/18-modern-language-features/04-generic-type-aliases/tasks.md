# Generic Type Aliases — Hands-on Tasks

> Practical exercises from easy to hard. Each task says what to build, what success looks like, and a hint or expected outcome. Solutions are at the end. All tasks assume Go 1.24+ with `go 1.24` in `go.mod`.

---

## Easy

### Task 1 — Write your first generic alias

Create a module and write:

```go
type Set[T comparable] = map[T]struct{}
```

In `main`, build a `Set[string]`, add two elements, print its length, and check membership. Confirm it behaves exactly like a `map[string]struct{}`.

**Goal.** See that a generic alias instantiation *is* its right-hand side.

---

### Task 2 — Prove identity (no conversion)

Using the `Set` from Task 1, write:

```go
var s Set[int] = Set[int]{}
var m map[int]struct{} = s   // must compile with NO conversion
s = m                        // and the reverse
```

If either line needs a cast, you misunderstood the feature.

**Goal.** Internalise that `Set[int]` and `map[int]struct{}` are *identical*, not merely assignable.

---

### Task 3 — Alias vs defined type, side by side

Declare both:

```go
type SetAlias[T comparable]   = map[T]struct{}
type SetDefined[T comparable] map[T]struct{}
```

Try to assign each to a `map[T]struct{}` without conversion. Observe that the alias assigns freely and the defined type requires `map[int]struct{}(x)`.

**Goal.** Feel the difference the single `=` makes.

---

### Task 4 — Trigger the no-methods error

Add to Task 1:

```go
func (s Set[T]) Add(v T) { s[v] = struct{}{} }
```

Read the compile error. Then fix it by converting `Set` into a *defined* type (drop the `=`) and confirm `Add` now compiles.

**Goal.** Learn that methods need a defined type, and recognise the error message.

---

### Task 5 — Trigger the constraint error

Change the alias to `type Set[T any] = map[T]struct{}` and build. Read the declaration-time error. Restore `comparable`. Then try `Set[[]int]` and read the instantiation-time error.

**Goal.** Distinguish the two constraint checkpoints: declaration (constraint must match the RHS) and instantiation (argument must satisfy the constraint).

---

## Medium

### Task 6 — Build a `Pair` and a `Result` alias

Write:

```go
type Pair[A, B any]  = struct{ First A; Second B }
type Result[T any]   = struct{ Value T; Err error }
```

Construct a `Pair[int, string]` and assign it to a matching anonymous struct with no conversion. Write a function returning `Result[int]` and consume it.

**Goal.** Use struct-shaped aliases and confirm struct identity holds.

---

### Task 7 — Partial instantiation

Write a two-parameter alias and specialise it:

```go
type Map[K comparable, V any] = map[K]V
type StringMap[V any]         = Map[string, V]  // one parameter remains
type IntSet                   = Map[int, struct{}] // fully fixed
```

Confirm `StringMap[int]` is identical to `map[string]int` and `IntSet` is identical to `map[int]struct{}`.

**Goal.** Build new generic and non-generic aliases by fixing parameters, and watch identity flow through each hop.

---

### Task 8 — Re-export a generic *defined* type via alias

Create two packages:

```go
// internal/cache
type Cache[K comparable, V any] struct{ data map[K]V }
func New[K comparable, V any]() *Cache[K, V] { return &Cache[K, V]{data: map[K]V{}} }
func (c *Cache[K, V]) Set(k K, v V) { c.data[k] = v }
func (c *Cache[K, V]) Get(k K) (V, bool) { v, ok := c.data[k]; return v, ok }
```

```go
// pkg/store
type Cache[K comparable, V any] = cache.Cache[K, V]
func New[K comparable, V any]() *Cache[K, V] { return cache.New[K, V]() }
```

From a third package, build a `store.Cache[string,int]`, call `Set`/`Get` (note the methods came across!), and assign a `*store.Cache[string,int]` to a `*cache.Cache[string,int]` variable with no conversion.

**Goal.** See the flagship use case: identity-preserving re-export where the method set transfers.

---

### Task 9 — Function-type alias

Write:

```go
type Handler[Req, Res any] = func(context.Context, Req) (Res, error)
```

Register a couple of handlers with a generic `register[Req, Res any](path string, h Handler[Req, Res])` and confirm a plain function literal satisfies `Handler[...]` with no conversion.

**Goal.** Name a verbose callback shape and rely on identity so literals fit directly.

---

### Task 10 — Alias of an alias

Write `type Result[T any] = struct{ Value T; Err error }` then `type Boxed[T any] = Result[T]`. Confirm `Boxed[int]`, `Result[int]`, and the raw struct are all the same type. Then create a *cycle* (`A → B → A`) and read the compile error.

**Goal.** Understand alias chains and the cyclic-alias restriction.

---

## Hard

### Task 11 — Migration shim

Simulate moving a type:

1. Define `type Widget[T any] struct{ V T }` in package `core`.
2. In package `legacy`, add `// Deprecated:` + `type Widget[T any] = core.Widget[T]`.
3. In a consumer, hold a `legacy.Widget[int]` and pass it to a function taking `core.Widget[int]` — no conversion.
4. Migrate the consumer to `core.Widget` and confirm nothing else changes.

**Goal.** Execute a zero-break rename using an identity-preserving alias.

---

### Task 12 — Constraint strengthening on a re-export

Given `type Cache[K comparable, V any] struct{...}` in another package, re-export it but *narrow* the key constraint:

```go
type OrderedCache[K cmp.Ordered, V any] = other.Cache[K, V]
```

Confirm `OrderedCache[int, string]` works but `OrderedCache[someNonOrdered, string]` is rejected, while the original `other.Cache` still accepts any comparable key.

**Goal.** Use an alias to expose a deliberately restricted view of a more permissive type. Note you can strengthen, never weaken.

---

### Task 13 — Reflection through an alias

For `type Set[T comparable] = map[T]struct{}` and `type C[K comparable, V any] = cache.Cache[K, V]`, print `reflect.TypeOf(...).String()`, `.Name()`, and `.PkgPath()` for an instance of each. Observe that:

- `Set[int]` reflects as an unnamed `map[int]struct {}`.
- `C[string,int]` reflects as `cache.Cache[...]` with `PkgPath` pointing at `cache`, not your package.

**Goal.** Confirm the alias does not exist at runtime and cannot rebrand a type for reflection-based systems.

---

### Task 14 — Inference through an alias

Write `type Slice[T any] = []T` and `func head[T any](s Slice[T]) T { return s[0] }`. Call `head([]int{1,2,3})` and `head([]string{"a"})` with *no* explicit type arguments. Confirm inference resolves `T` through the alias.

**Goal.** Verify inference unifies against the resolved RHS, treating the alias as a substitution step.

---

### Task 15 — Decide alias vs defined type for a domain type

You need a `Money` type that is always stored in integer cents and must never be mixed with a raw `int64`. Write it two ways and argue which is correct:

```go
type MoneyAlias   = int64       // wrong: interchangeable with int64
type MoneyDefined int64          // right: distinct, can have methods, enforces separation
func (m MoneyDefined) String() string { /* ... */ return "" }
```

**Goal.** Recognise that unit/identity safety needs a *defined* type; an alias erases exactly the distinction you want.

---

## Bonus / Stretch

### Task 16 — `go/types` Unalias

Write a small analyzer (using `golang.org/x/tools/go/packages` + `go/types`) that loads a package, finds a generic alias, and prints both the `types.Alias` and the result of `types.Unalias(...)`. Show that `types.Identical` returns false if you forget to `Unalias` and true if you do.

**Goal.** Build alias-aware tooling correctly — the #1 bug is forgetting `Unalias`.

---

### Task 17 — Audit a package for misused aliases

Write a script (grep/AST) that flags `type X = <basic type>` aliases that look like attempted unit types (`type UserID = int64`). Report them as candidates for conversion to defined types.

**Goal.** Catch the "alias for unit safety" anti-pattern automatically.

---

### Task 18 — Library re-export readiness check

Given a library, check whether each exported generic type can be re-exported via a verbatim alias: are all parameter constraints *exported* and nameable? Flag any type with an unexported constraint interface as "not re-export friendly."

**Goal.** Encode the design rule that re-exportable types must use nameable constraints.

---

### Task 19 — Minimum-version gate

Add a generic alias to a library's public API. Set the `go` directive to `go 1.24`. Then try to build a consumer with an older `go` directive / older toolchain and observe the error message. Document that adopting the feature imposes a Go 1.24 floor.

**Goal.** Make the compatibility cost of the feature concrete.

---

### Task 20 — Replace a wrapper with an alias (and measure the diff)

Find a place where a package wraps another package's generic type in a defined struct purely to re-export it (with hand-forwarded methods). Replace the wrapper with a generic alias. Count the lines of forwarding code deleted and confirm callers needing no conversion now interoperate directly.

**Goal.** Quantify the boilerplate generic aliases remove versus the pre-1.24 wrapper pattern.

---

## Solutions (sketched)

### Solution 1
```go
type Set[T comparable] = map[T]struct{}
func main() {
    s := Set[string]{}
    s["a"], s["b"] = struct{}{}, struct{}{}
    _, ok := s["a"]
    fmt.Println(len(s), ok) // 2 true
}
```

### Solution 2
Both assignments compile with no cast because `Set[int]` *is* `map[int]struct{}`. Identity, not assignability.

### Solution 3
`SetAlias[int]` assigns to/from `map[int]struct{}` freely. `SetDefined[int]` is a distinct type — `var m map[int]struct{} = sd` fails; you need `map[int]struct{}(sd)`.

### Solution 4
The error is "invalid receiver type Set (alias)" (wording varies). Fix: `type Set[T comparable] map[T]struct{}` (no `=`), then `Add` compiles — now it is a defined type.

### Solution 5
`type Set[T any] = map[T]struct{}` fails at declaration: map keys need comparable. With `comparable` restored, `Set[[]int]` fails at instantiation: `[]int` does not satisfy `comparable`.

### Solution 6
```go
type Pair[A, B any] = struct{ First A; Second B }
p := Pair[int, string]{First: 1, Second: "x"}
var q struct{ First int; Second string } = p // no conversion
```

### Solution 7
`StringMap[int] ≡ Map[string,int] ≡ map[string]int`; `IntSet ≡ map[int]struct{}`. Identity flows through each substitution.

### Solution 8
`store.Cache[K,V] = cache.Cache[K,V]` re-exports identity *and* method set (methods come from the RHS defined type). `var p *cache.Cache[string,int] = storeVal` compiles with no conversion. Re-export `New` as a function — the alias doesn't re-export the constructor.

### Solution 9
A plain `func(ctx, req) (res, error)` literal satisfies `Handler[Req,Res]` directly because they are identical types.

### Solution 10
`Boxed[int] ≡ Result[int] ≡ struct{ Value int; Err error }`. A cycle `type A[T any] = B[T]; type B[T any] = A[T]` errors with "invalid recursive type alias."

### Solution 11
The `legacy.Widget[int]` value is identical to `core.Widget[int]`, so it passes to a `core.Widget[int]` parameter with no conversion. The deprecation comment drives `staticcheck`/`go vet` warnings.

### Solution 12
You may strengthen the constraint (`cmp.Ordered` ⊂ `comparable`), narrowing callers. You may not weaken it. The original `other.Cache` is unaffected and still accepts any comparable key.

### Solution 13
`reflect.TypeOf(Set[int]{}).String()` → `map[int]struct {}`, `.Name()` empty. `reflect.TypeOf(C[string,int]{}).PkgPath()` → the *cache* package path. The alias has no runtime presence.

### Solution 14
```go
type Slice[T any] = []T
func head[T any](s Slice[T]) T { return s[0] }
head([]int{1,2,3})  // T=int inferred via Slice[T] = []T
head([]string{"a"}) // T=string
```

### Solution 15
`MoneyDefined` is correct: distinct from `int64`, can carry methods, prevents accidental mixing. `MoneyAlias` is interchangeable with `int64` and enforces nothing.

### Solution 16
Load with `packages.Load`; for each `types.Object` whose `Type()` is `*types.Alias`, compare `types.Identical(aliasType, rhs)` (true) vs naive pointer/struct comparison. `types.Unalias` is mandatory before identity checks.

### Solution 17
AST-walk `*ast.TypeSpec` where `Assign != token.NoPos` (an alias) and the RHS is a basic type. Heuristic flag for likely unit-type misuse.

### Solution 18
For each exported generic type, inspect each type parameter's constraint; if it resolves to an unexported interface, mark "not re-export friendly."

### Solution 19
With `go 1.24` set, an older toolchain reports a version error ("requires go ≥ 1.24" or a parse failure on older parsers). Document the floor for consumers.

### Solution 20
The alias replaces the wrapper struct plus N forwarding methods with a single line, and callers gain identity-based interop (no conversions). The deleted-line count is the boilerplate the feature removes.

---

## Checkpoints

After the easy tasks: you can write a generic alias, prove identity, distinguish it from a defined type, and recognise the no-methods and constraint errors.
After the medium tasks: you can build struct/function/partial aliases, re-export a generic type with its method set, and reason about alias chains.
After the hard tasks: you can run a migration shim, strengthen constraints on a re-export, predict reflection and inference behavior, and choose alias vs defined type for domain types.
After the bonus tasks: you can build alias-aware tooling (`Unalias`), audit for misuse and re-export readiness, reason about the version floor, and quantify the boilerplate aliases remove.
