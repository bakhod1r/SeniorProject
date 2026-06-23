# Generic Type Aliases — Find the Bug

## How to use

Each problem shows a code snippet. Read it carefully and answer:
1. What is the bug?
2. How would you fix it?
3. Could a different language tool (defined type, wrapper) have prevented it?

Solutions are at the end. The bugs are mostly **realistic** — many were caught during early adoption of generic aliases in the Go 1.22 - 1.24 window.

All examples assume Go 1.24 unless noted otherwise.

---

## Bug 1 — Method on alias

```go
type Vec[T any] = []T

func (v Vec[T]) Len() int { return len(v) }
```

**Hint:** Aliases cannot do something defined types can.

---

## Bug 2 — Constraint mismatch

```go
package bar
type Set[T comparable] = map[T]struct{}

package mypkg
import "example.com/bar"
type Loose[T any] = bar.Set[T]
```

**Hint:** Read the constraints carefully.

---

## Bug 3 — Old Go version

```go
// go.mod has: go 1.22
type Vec[T any] = []T
```

**Hint:** Check the Go version and any GOEXPERIMENT setting.

---

## Bug 4 — Renamed parameter that shadows

```go
type Map[K comparable, V any] = map[K]V

package mypkg
import "other"
type Map[V comparable, K any] = other.Map[V, K]
```

**Hint:** Look at the parameter names vs positions.

---

## Bug 5 — Stacked aliases of unclear intent

```go
type A[T any] = B[T]
type B[T any] = C[T]
type C[T any] = []T

func main() {
    var x A[int]
    fmt.Println(x)
}
```

**Hint:** This compiles. So what is the bug?

---

## Bug 6 — Embedding an alias-of-interface

```go
type Doer[T any] = interface { Do(T) error }

type MyHandler[T any] struct {
    Doer[T]
}

func (h MyHandler[T]) Do(v T) error {
    return h.Doer.Do(v) // ?
}
```

**Hint:** Embedding interfaces vs embedding aliases of interfaces.

---

## Bug 7 — Reflection expecting alias name

```go
type Vec[T any] = []T

v := Vec[int]{1, 2, 3}
fmt.Println(reflect.TypeOf(v).Name()) // "" surprisingly
fmt.Println(reflect.TypeOf(v).String()) // "[]int", not "Vec[int]"
```

**Hint:** What does the runtime know about aliases?

---

## Bug 8 — Type switch with both names

```go
type Vec[T any] = []T

func classify(x any) string {
    switch x.(type) {
    case []int:    return "slice"
    case Vec[int]: return "vec" // ?
    }
    return "other"
}
```

**Hint:** Same type, two cases.

---

## Bug 9 — Migration shim that broke

```go
// pkg/old (pre-1.24)
package old
import "example.com/new"

type Result[T any] new.Result[T] // defined type
```

A library moves to 1.24 and changes this to:
```go
type Result[T any] = new.Result[T] // alias
```

What might break for downstream callers?

**Hint:** Some callers may have used type assertions.

---

## Bug 10 — Constraint loosening attempt

```go
package bar
type Set[T comparable] map[T]struct{} // defined type

package mypkg
import "example.com/bar"
type AnySet[T any] = bar.Set[T]
```

**Hint:** Two compile errors.

---

## Bug 11 — Trying to "rename" for namespace

```go
package mypkg
import "example.com/bar"
type bar = bar.List // ?
```

**Hint:** Identifier collision with package name.

---

## Bug 12 — Forgetting the `=`

```go
type Vec[T any] []T

var v Vec[int] = []int{1, 2, 3} // ?
```

**Hint:** This compiles, but is it the same as the alias version?

---

## Bug 13 — Cyclic alias

```go
type A[T any] = B[T]
type B[T any] = A[T]
```

**Hint:** What does the compiler do?

---

## Bug 14 — Re-export without copying constraint

```go
package bar
type Cache[K comparable, V any] = map[K]V

package mypkg
import "example.com/bar"
type Cache = bar.Cache // ?
```

**Hint:** Aliases without parameters need a fully specialised right-hand side.

---

## Bug 15 — Method declaration in same package, but on alias

```go
package mypkg
type Vec[T any] = []T

func (v Vec[T]) String() string { return "vec" } // ?
```

**Hint:** Even in the same package, the rule applies.

---

## Solutions

### Bug 1 — fix
Aliases cannot carry methods. Switch to a defined type:
```go
type Vec[T any] []T
func (v Vec[T]) Len() int { return len(v) }
```
Or, if you need re-export semantics, embed the original in a wrapper:
```go
type Vec[T any] struct { Items []T }
func (v Vec[T]) Len() int { return len(v.Items) }
```

### Bug 2 — fix
Match the constraint:
```go
type Set[T comparable] = bar.Set[T]
```
The compiler refuses to silently widen a constraint.

### Bug 3 — fix
Bump `go.mod`'s `go` directive to `1.24`, or set `GOEXPERIMENT=aliastypeparams` if you must stay on 1.22 / 1.23. Cleanest answer: just bump.

### Bug 4 — fix
Match parameter positions and names with the source. Re-ordering is technically legal but extremely confusing. Stick to:
```go
type Map[K comparable, V any] = other.Map[K, V]
```

### Bug 5 — fix (or rather, refactor)
The chain `A → B → C → []T` compiles but readers must follow three hops. Collapse:
```go
type A[T any] = []T
```
Two hops gone, intent clearer.

### Bug 6 — fix
The pattern works, but the embedding promotes the interface methods. Calling `h.Doer.Do(v)` is OK; just calling `h.Do(v)` would recurse infinitely on the wrapper method. Either remove the wrapper method or call the underlying explicitly:
```go
func (h MyHandler[T]) Do(v T) error {
    return h.Doer.Do(v) // explicit forward
}
```
The bug is mainly in writing the wrapper method when the embedded interface's method would already be promoted.

### Bug 7 — explanation
This is **not** a bug per se — it is correct behaviour. `Type.Name()` returns `""` for unnamed types like `[]int`, and `Type.String()` returns the underlying form. Code that depends on `reflect.TypeOf(x).Name() == "Vec"` will silently fail. Use struct names or compare full type identities (e.g. `reflect.TypeOf(x) == reflect.TypeOf(Vec[int]{})`) instead.

### Bug 8 — fix
The `Vec[int]` case is **unreachable** — it has the same type as `[]int`, so `case []int` matches first. The compiler will reject this with a duplicate case error. Remove one.

### Bug 9 — explanation
With a defined type, `old.Result[int]` was distinct from `new.Result[int]`; assertions like `x.(old.Result[int])` worked specifically. After switching to an alias, such assertions still pass for both names — but **type assertions assuming distinct identity** (e.g. registering `old.Result[int]` in a type registry) may now collapse with `new.Result[int]`. Rare, but real.

### Bug 10 — fix
Two issues:
1. `bar.Set[T comparable]` is a defined type, not an alias. You cannot alias to its underlying without re-naming the parameter.
2. The `T any` constraint is too loose for `comparable`.

The likely intended code:
```go
type Set[T comparable] = bar.Set[T]
```

### Bug 11 — fix
The identifier `bar` shadows the package import. Rename:
```go
type List = bar.List
```
Aliases of generic types must include the parameter list:
```go
type List[T any] = bar.List[T]
```

### Bug 12 — explanation
This is a **defined type**, not an alias. The single `=` is missing. The result: `Vec[int]` and `[]int` are now distinct types. Conversions are required. Methods can be added.

```go
type Vec[T any] = []T // alias
type Vec[T any]   []T // defined type
```

### Bug 13 — fix
The compiler reports a cyclic alias error. Fix by breaking the cycle — usually one side is a defined type, or you have one canonical alias and others reference it:
```go
type Real[T any] = []T
type A[T any] = Real[T]
type B[T any] = Real[T]
```

### Bug 14 — fix
Aliases without a parameter list cannot reference a parameterised type. Either fully specialise:
```go
type IntCache = bar.Cache[int, string]
```
or include the parameter list:
```go
type Cache[K comparable, V any] = bar.Cache[K, V]
```

### Bug 15 — fix
Same package, doesn't matter — the rule applies because the alias does not introduce a local type. Switch to a defined type:
```go
type Vec[T any] []T
func (v Vec[T]) String() string { return "vec" }
```

---

## Lessons

Patterns from these bugs:

1. **Methods cannot be declared on aliases** (Bugs 1, 15). This is the most common mistake — switch to a defined type.
2. **Constraint matching is enforced** (Bugs 2, 10). The alias must accept a subset of types accepted by the right-hand side.
3. **Go version matters** (Bug 3). `go.mod` directive `1.24` or `GOEXPERIMENT` flag.
4. **Don't re-order or rename parameters gratuitously** (Bug 4). Match the source.
5. **Stacked aliases compile but harm readability** (Bug 5). One hop is enough.
6. **Aliases preserve identity at runtime** (Bugs 7, 8, 9). Type switches, reflection, and type registries all see only the underlying type.
7. **The `=` is load-bearing** (Bug 12). Drop it and you have a defined type, not an alias.
8. **Cycles and ill-formed declarations are caught at compile time** (Bugs 11, 13, 14).

A senior engineer reads alias declarations as identity statements: each `type X[T] = Y[T]` is a precise claim that "X[T] is the same type as Y[T]". When the claim cannot be honoured (constraint mismatch, parameter list mismatch, method addition), the compiler refuses. Mismatch between what the alias claims and what the underlying type allows is **the** category of generic-alias bugs.
