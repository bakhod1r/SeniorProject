# Generic Types & Interfaces — Interview Q&A

This file collects 30+ interview questions on generic types and interfaces, with concise, complete answers. Use them as flashcards or as a self-test before a Go interview.

---

### 1. What is a generic type in Go?

A type whose declaration carries one or more type parameters. Until you instantiate it (e.g., `Stack[int]`), it is a *blueprint*, not a usable type. Instantiation happens at compile time and produces a real, type-safe concrete type.

```go
type Stack[T any] struct { items []T }
```

---

### 2. How do you write a method on a generic type?

The receiver must repeat the type parameter list of the type:

```go
func (s *Stack[T]) Push(v T) { s.items = append(s.items, v) }
```

The constraint (`any`) is *not* repeated — only the parameter names appear in the receiver.

---

### 3. Can a method declare its own type parameters?

**No.** The Go spec forbids it:

> "A method declaration may not have type parameters."

So this is illegal:

```go
func (s *Stack[T]) Map[U any](fn func(T) U) *Stack[U] // compile error
```

The method's type parameters are exactly the receiver's type parameters.

---

### 4. Why are method-level type parameters disallowed?

Three reasons:

1. They make interface-satisfaction checking undecidable in general.
2. They interact awkwardly with method values and method expressions.
3. They were not necessary for the first generics release; the Go team chose simplicity.

The workaround is to write a top-level generic function:

```go
func MapStack[T, U any](s *Stack[T], fn func(T) U) *Stack[U] { ... }
```

---

### 5. How is `Stack[int]` different from `Stack[string]` at runtime?

They are **two distinct types** with separate method sets and separate identities. At runtime, the compiler may reuse a single compiled body across them (GC stenciling) — but the types are not interchangeable. You cannot assign one to the other; you cannot pass one to a function expecting the other.

---

### 6. When is a type parameter list on an interface a *constraint* and when is it a *value*?

The same `interface { ... }` syntax serves both roles. Where the interface is *used* tells you which:

- **Inside `[T constraint]`** → constraint role. May contain type sets (`int | string`, `~T`).
- **As the type of a variable, field, or parameter** → value role. May contain only methods.

If an interface contains type sets, it becomes constraint-only — using it as a variable type produces a compile error.

---

### 7. What is a type set?

A `|`-separated list of types inside an interface, optionally prefixed with `~`:

```go
type Number interface {
    int | int64 | float32 | float64
}

type Ordered interface {
    ~int | ~int64 | ~float64 | ~string
}
```

The set defines which underlying types are allowed for a type parameter constrained by this interface.

---

### 8. What does `~T` mean in a type set?

"Any type whose underlying type is `T`". Without `~`, only the exact type `T` is accepted.

```go
type Celsius float64
// allowed by ~float64
// NOT allowed by float64 (which is exact)
```

In practice, prefer `~` whenever you would accept a defined type.

---

### 9. How do you get the zero value of a type parameter inside a method?

Using `var zero T`. This is the only portable way; `nil`, `0`, `""` are not generally valid for an unknown `T`.

```go
func (s *Stack[T]) Pop() (T, bool) {
    var zero T
    if len(s.items) == 0 { return zero, false }
    /* ... */
}
```

---

### 10. Why do `Stack[int]` and `Stack[string]` have different method sets?

The methods are derived from `Stack[T]` by substituting `T`. With `T = int`, `Push(v T)` becomes `Push(v int)`; with `T = string`, it becomes `Push(v string)`. The method names and shapes are the same, but their signatures differ.

---

### 11. What is the difference between `type IntStack = Stack[int]` and `type IntStack Stack[int]`?

- `=` declares an **alias**. `IntStack` and `Stack[int]` are the *same* type. Methods on `Stack[T]` apply to `IntStack`.
- No `=` declares a new **defined type**. `IntStack` and `Stack[int]` are *different* types, requiring conversion to assign. You can attach extra methods to `IntStack` only.

---

### 12. Can two different packages declare `Stack[int]` and have them be the same type?

No. Type identity includes the package path of the declaration site. `pkgA.Stack[int]` and `pkgB.Stack[int]` are different types if both packages declare their own `Stack`.

---

### 13. Can generic types be self-referential?

Yes — extensively. A `Tree[T]` containing `*Tree[T]` children is the canonical example:

```go
type Tree[T any] struct {
    value       T
    left, right *Tree[T]
}
```

You must repeat the type parameter list inside the body when referring to the type.

---

### 14. Can a generic interface embed another generic interface?

Yes:

```go
type Reader[T any] interface { Read() (T, bool) }
type Writer[T any] interface { Write(v T) error }
type ReadWriter[T any] interface {
    Reader[T]
    Writer[T]
}
```

The embedded interface's parameters must be in scope.

---

### 15. What is `comparable`, and where can you use it?

A built-in interface meaning "supports `==` and `!=`". Required for map keys.

```go
type Set[T comparable] struct { m map[T]struct{} }
```

`comparable` is **constraint-only**: you cannot declare `var x comparable = 1`. It excludes slices, maps, functions, and structs/arrays containing them.

---

### 16. What does the constraint `any` allow?

Anything. `any` is an alias for `interface{}`. As a constraint it permits any type, including ones that cannot be compared, copied for free, or compared.

---

### 17. Can you use `==` on a type parameter constrained by `any`?

No. The compiler does not know that an arbitrary `T` supports `==`. Use `comparable` if you need equality:

```go
func Find[T comparable](xs []T, v T) int { ... }
```

Or accept a comparison function for `any`.

---

### 18. How does interface satisfaction work for generic types?

After instantiation, the method set is computed by substituting type arguments. The instantiated type satisfies an interface if its method set contains all the interface's methods with matching signatures (after substitution).

```go
type Pusher[T any] interface { Push(T) }
var p Pusher[int] = &Stack[int]{} // OK
var q Pusher[string] = &Stack[int]{} // ✘ Push(int) ≠ Push(string)
```

---

### 19. What is monomorphization and does Go use it?

Monomorphization = generating a separate compiled function body per concrete instantiation. Go uses it **partially**, mixed with **GC stenciling**: types with the same memory shape (e.g., all pointer types) often share a single compiled body and pass a *dictionary* with per-instantiation metadata.

---

### 20. What is GC stenciling?

The Go compiler's strategy: per *gcshape* (a class of types sharing memory layout / GC properties), one compiled body is emitted. A small dictionary, passed implicitly, carries per-instantiation type information. Pointer-shaped types share one body; many value types share another. This keeps binary size bounded while preserving most performance benefits.

---

### 21. Are generics in Go faster than `interface{}`?

Usually yes — they avoid boxing of value types and skip dynamic dispatch where the compiler can specialize. The win is biggest for value types in tight loops. For pointer types the difference is small (the dictionary lookup is cheap, but not free).

---

### 22. How do you write a generic concurrent map?

Wrap `sync.Map`:

```go
type SyncMap[K comparable, V any] struct { m sync.Map }
func (s *SyncMap[K, V]) Store(k K, v V) { s.m.Store(k, v) }
func (s *SyncMap[K, V]) Load(k K) (V, bool) {
    v, ok := s.m.Load(k)
    if !ok { var zero V; return zero, false }
    return v.(V), true
}
```

Or use a mutex-guarded `map[K]V` if read patterns favor that.

---

### 23. Can you put any type in `Set[T comparable]`?

Any *comparable* type. Numbers, strings, booleans, pointers, channels, interfaces, structs of comparable fields, arrays of comparable elements. Slices, maps, and functions are excluded.

---

### 24. What happens if you use `comparable` for `T` and try to put an `interface{}` value with a non-comparable underlying type?

Pre-Go 1.20, the compiler accepted it but `==` would panic at runtime. Go 1.20+ tightened the rule (the so-called "strict comparability"): you cannot use a constrained `T = interface{X}` as `comparable` if the dynamic value might be non-comparable. Always check current spec/release notes; this was an area of active change.

---

### 25. Can you have a generic interface used as a value type?

Yes — as long as it contains only methods (no type sets):

```go
type Iterator[T any] interface { Next() (T, bool) }

var it Iterator[int] = NewSliceIter([]int{1,2,3})
```

`Iterator[int]` is a normal interface value type after instantiation.

---

### 26. Why does `var n Number = 1` fail when `Number = int | float64`?

Because the type set `int | float64` makes `Number` a *constraint-only* interface. It cannot be used as a value type. Compile error:

> "interface contains type constraints"

To hold `int` *or* `float64` at runtime, use a regular interface (e.g., `any`) or a sum-type style union.

---

### 27. How do you embed a generic type inside another type?

Like any other field, but include the type parameters:

```go
type Cache[K comparable, V any] struct {
    m   map[K]V
    lru *List[K] // generic list parameterized by K
}
```

---

### 28. What pitfalls come with mixed value and pointer receivers on a generic type?

Same as for non-generic types: only `*T` has the full method set if some methods are pointer-receiver. Keep all methods either pointer or value to avoid surprising interface-satisfaction failures.

---

### 29. How do you test a generic type?

Test with at least two type parameters to flush out type-specific assumptions. A common approach is a generic test helper:

```go
func testStack[T comparable](t *testing.T, items []T) { /* ... */ }

func TestStackInt(t *testing.T)    { testStack(t, []int{1,2,3}) }
func TestStackString(t *testing.T) { testStack(t, []string{"a","b"}) }
```

Property-based ideas: "after Push, Pop returns the same value" — holds for any `T`.

---

### 30. What are the common signs that a generic type is over-engineered?

- Five or more type parameters.
- Constraints invented just to satisfy the type rather than express a real contract.
- `reflect.TypeOf(...)` switches inside methods (the `T` is doing nothing).
- A "container of any" usage everywhere — `Stack[any]`.
- Type assertions back to concrete types after retrieval.
- Generic types used to fake variance.

---

### 31. Can methods on a generic type be added after the fact in another package?

No — the same rule as for non-generic types applies. Methods must live in the same package as the type definition. You can wrap with a defined type in another package and add methods there.

---

### 32. How does reflection see an instantiated type?

`reflect.TypeOf(Stack[int]{})` returns a `reflect.Type` whose `Name()` includes the type arguments (e.g., `Stack[int]`). The package path is the source package. Two different instantiations are two different `reflect.Type` values.

There is **no** way to instantiate a generic type at runtime via reflection — instantiation is a compile-time operation.

---

### 33. When should you prefer a non-generic interface over a generic type?

When the relationship is *heterogeneous* — different concrete types implementing one contract, e.g., `Shape` with `Circle`, `Square`, `Triangle`. Generics force homogeneity (all elements same `T`).

When the set of implementations is open and unknown to the consumer, a regular interface is the right tool.

---

### 34. Can a generic type satisfy a non-generic interface?

Yes:

```go
type Stack[T any] struct{ items []T }
func (s *Stack[T]) Len() int { return len(s.items) }

type LenSource interface { Len() int }
var x LenSource = &Stack[int]{} // OK
```

The instantiated type's method set just needs the interface's methods.

---

### 35. Can a non-generic type satisfy a generic interface?

Yes — if the interface's methods, after instantiation, match.

```go
type Iterator[T any] interface { Next() (T, bool) }

type IntList struct { /* ... */ }
func (l *IntList) Next() (int, bool) { /* ... */ }

var it Iterator[int] = &IntList{} // OK — the instantiated method set matches
```

---

### Summary

Common interview themes:
- Method type parameters (forbidden).
- Type set syntax (`|`, `~`, `comparable`, `any`).
- Constraint vs value role of an interface.
- Type identity per instantiation.
- Implementation strategy (monomorphization vs GC stenciling).
- Practical patterns (Stack, Cache, Set, Iterator).

End of interview.md.
