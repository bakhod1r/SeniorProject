# Methods on Generic Types — Interview Q&A

## How to use this file

Each question has a **short answer** for memorization and a **long answer** for understanding. Practice both. In a real interview, give the short version first and expand only if asked.

Difficulty:
- 🟢 Beginner
- 🟡 Mid-level
- 🔴 Senior
- 🟣 Expert

---

## Beginner 🟢

### Q1. Why does the receiver of a method on a generic type include `[T]`?
**Short:** To bind the method to the same type parameter the type declared.

**Long:** Without `[T]`, the compiler does not know which `T` you mean — there is no `T` in scope yet. The receiver's parameter list mirrors the type's so every method shares the same parameter.

### Q2. Can a method on a generic type introduce its own type parameter?
**Short:** No. Methods cannot have type parameters in Go.

**Long:** This is a deliberate language-design decision. The workaround is to make the operation a free function: `func Map[T, U any](b Box[T], f func(T) U) Box[U]`.

### Q3. Pointer receiver or value receiver — same rules as classic Go?
**Short:** Yes. Pointer for mutation or large structs; value for small read-only operations.

### Q4. What happens if you forget `[T]` on the receiver?
**Short:** Compile error: "Box requires type arguments".

### Q5. Can the receiver rename `T`?
**Short:** Yes, but don't. Use the same name as the type declaration.

**Long:** `func (b Box[X]) Get() X { return b.v }` compiles, but readers expect `T`. Renaming hurts readability.

### Q6. Can two methods on the same generic type use different type parameter names?
**Short:** Yes (the names are local to each method) but extremely confusing — don't.

### Q7. Does `Stack[int]` have its own method set?
**Short:** Yes. Each instantiation is a distinct type with its own method set.

### Q8. Can you define a method on `Stack[int]` specifically?
**Short:** No. The receiver must use the type parameter name, not a concrete type.

**Long:** Specialisation — declaring a method only for one instantiation — is forbidden. Use a free function: `func SumInts(s *Stack[int]) int { ... }`.

### Q9. Is `var s *Stack` legal?
**Short:** No. `Stack` must be instantiated: `var s *Stack[int]`.

### Q10. What is the type of `s.Push` after `s := &Stack[int]{}`?
**Short:** `func(int)` — a method value with `T` resolved to `int`.

---

## Mid-level 🟡

### Q11. Can constraints differ between methods on the same type?
**Short:** No. Constraints are declared once on the type.

**Long:** All methods inherit the type's constraint. To impose a tighter constraint on some operations, wrap the type or use a free function.

### Q12. How do you write a method that changes the element type, like `Map`?
**Short:** Make it a free function. Methods cannot introduce a new type parameter.

```go
func Map[T, U any](b Box[T], f func(T) U) Box[U] {
    return Box[U]{v: f(b.v)}
}
```

### Q13. Does an instantiated generic type satisfy interfaces normally?
**Short:** Yes — the methods on `Stack[int]` are checked against any interface.

**Long:** `*Stack[int]` satisfies `interface { Push(int) }` because its method set contains `Push(int)`. But `*Stack[string]` does not satisfy that interface — its `Push` takes `string`.

### Q14. Why does `var g AnyGetter = Box[int]{}` fail?
**Short:** `Box[int].Get` returns `int`, not `any`. The signatures don't match.

**Long:** Each instantiation's method has a concrete signature. To accept any `Box[T]`, use a generic interface `Getter[T any] interface { Get() T }`.

### Q15. How do you create a method value on a generic type?
**Short:** `f := s.Push` after `s := &Stack[int]{}`. The type parameter is resolved at binding time.

### Q16. What is a method expression on a generic type?
**Short:** `(*Stack[int]).Push` — a function value taking the receiver as the first argument. The instantiation must be explicit.

### Q17. What gets promoted when one generic type embeds another?
**Short:** The methods of the embedded instantiation, with the type parameters substituted from the outer type.

```go
type Outer[T any] struct{ Inner[T] }
// Outer[int] gets Inner[int]'s methods
```

### Q18. What happens if two embedded generic types have a method with the same name?
**Short:** Ambiguity — neither is promoted, and calling the method on the outer is a compile error.

### Q19. How do `comparable` constraints affect methods?
**Short:** They allow `==` and `!=` on `T` inside the method body.

**Long:** A method on `Set[T comparable]` can do `m[v] = struct{}{}` because keys must be comparable. With `[T any]`, you cannot.

### Q20. Can you call a method with a pointer receiver on a non-addressable generic value?
**Short:** No. Same rule as classic Go: pointer-receiver methods need addressable values or pointers.

**Long:** `m["a"].Inc()` fails because map values are not addressable. Workaround: store pointers, or copy out, modify, store back.

---

## Senior 🔴

### Q21. Why are method-level type parameters forbidden?
**Short:** Implementation cost (dictionaries per method), cognitive cost (two layers of generics), and limited benefit.

**Long:** The Go team considered method-level type parameters and rejected them. Most use cases — operations that change the element type — can be expressed as free functions. The implementation would have required additional dictionary tracking per method, more complex method tables, and reflection support — all for minor ergonomic gain.

### Q22. How would you design a generic type whose methods need different constraints?
**Short:** Wrapper types that embed the base type and add constraint-specific methods.

**Long:**
```go
type Bag[T any] struct{ items []T }
type ComparableBag[T comparable] struct{ *Bag[T] }
func (b ComparableBag[T]) Distinct() []T { ... }
```

Or use free functions: `func Distinct[T comparable](b *Bag[T]) []T`.

### Q23. Walk through method dispatch on `(*Stack[int]).Push(42)`.
**Short:** Direct call to the stenciled body for `Stack` over the 8-byte scalar shape, with a dictionary describing `int`.

**Long:** The compiler stencils one body per GC shape. For pointer-shaped element types, the body uses a runtime dictionary; for scalars, it can often inline operations directly. `Push` on `int` has no operations that need the dictionary, so the body is essentially identical to a hand-written `func PushInt(s *Stack, v int)`.

### Q24. What is the difference between `*Stack[T]` and `*Stack[T] | Stack[T]` in a constraint?
**Short:** Trick question — receivers don't take constraint syntax.

**Long:** The receiver is a single, fixed type (or its pointer). Constraints with `|` apply to type **parameters**, not receivers. The "method receiver type" is one of `T` or `*T`.

### Q25. Why is `Stack[T] {}.Push(1)` not allowed?
**Short:** Composite literals are not addressable, and `Push` is a pointer-receiver method.

**Long:** You need an addressable value to call a pointer-receiver method. `(&Stack[int]{}).Push(1)` works.

### Q26. Can you embed a non-generic type in a generic type?
**Short:** Yes. The embedded type's methods are promoted normally; no parameter substitution is needed.

```go
type Logger struct{}
func (Logger) Log(s string) {}

type Service[T any] struct {
    Logger
    items []T
}
```

### Q27. How do you express "this T must have a method M"?
**Short:** Use an interface as the constraint: `[T interface{ M() }]`.

**Long:**
```go
type HasName interface { Name() string }
type List[T HasName] struct{ items []T }

func (l *List[T]) Names() []string {
    out := make([]string, 0, len(l.items))
    for _, v := range l.items { out = append(out, v.Name()) }
    return out
}
```

### Q28. What changes if you make `Stack[T]`'s receiver value-only?
**Short:** Mutating methods cannot persist changes — they update a copy.

**Long:** A value-receiver `Push` would `append` to a copy of `s.data`. The caller's `Stack[T]` does not change. This is a frequent bug — always use pointer receivers for stateful generic containers.

### Q29. How does method promotion handle generic-to-generic embedding?
**Short:** The outer's type parameters are substituted into the embedded type, then methods are promoted.

```go
type Inner[T any] struct{}
func (Inner[T]) Foo(v T) {}

type Outer[T any] struct{ Inner[T] }   // outer's T flows in
// Outer[int]{}.Foo(42) — Foo takes int
```

### Q30. What is the rule for method expressions on generic types?
**Short:** The instantiation must be fully explicit: `(*Stack[int]).Push`.

**Long:** The compiler cannot infer the type from a method expression — there is no call site to drive inference. You must spell out the instantiation in the expression.

---

## Expert 🟣

### Q31. Why did the Go team specifically reject method-level type parameters in 1.18?
**Short:** Implementation complexity for the runtime, reflection, and method tables.

**Long:** Per-method type parameters would require: per-method dictionaries even for value-receiver methods; method-table extensions; reflection support for method-level parameters; complex linker decisions for which method instantiations to emit. The team estimated the work at multiple releases for minor gain. Free functions cover most cases.

### Q32. How does GC shape stenciling interact with methods?
**Short:** Each method on a generic type is stenciled per GC shape, with a hidden dictionary parameter.

**Long:** A method `(s *Stack[T]) Push(v T)` is stenciled once per shape of `T` (pointer-shaped, 8-byte scalar, etc.). All instantiations of `Stack[T]` for pointer-shaped types share one body; the dictionary identifies which exact `T` is being used for type-dependent operations like equality.

### Q33. Can a generic method satisfy an interface that does not mention the type parameter?
**Short:** Yes, if the method's signature (after substitution) matches the interface.

```go
type Box[T any] struct{ v T }
func (b Box[T]) String() string { return "box" }

type Stringer interface{ String() string }
var s Stringer = Box[int]{}   // OK
```

### Q34. What is the order of operations when the compiler resolves `Outer[int]{}.M()` where `M` comes from an embedded generic type?
**Short:** Substitute outer's type arguments → instantiate embedded type → look up `M` in embedded's method set → promote.

**Long:** The compiler first substitutes `Outer`'s `T = int` into the embedded type spec, producing `Inner[int]`. Then it computes `Inner[int]`'s method set. Then it checks if `M` is reachable through promotion. Finally it generates the call.

### Q35. Why might method values cause heap allocations?
**Short:** A method value captures the receiver — for pointer receivers, the captured pointer must outlive the local scope.

**Long:** `f := s.Push` for `s := &Stack[int]{}` captures `s`. Even if `s` was a local variable, the method value escapes the scope it was created in. The compiler must heap-allocate `s` (or the method-value structure). Avoid creating method values in tight loops.

### Q36. How do you simulate "method-level type parameters" using interfaces?
**Short:** Define a generic interface; the type parameter lives on the interface, not the method.

```go
type Mapper[T, U any] interface {
    Map(func(T) U) []U
}

func RunMap[T, U any](m Mapper[T, U], f func(T) U) []U {
    return m.Map(f)
}
```

The caller picks `T, U` when implementing `Mapper`. Not exactly the same as method-level parameters, but covers many use cases.

### Q37. What happens when an interface declares a method whose signature uses a type parameter not in the interface's parameter list?
**Short:** Compile error — type parameters in method signatures must be either the interface's own parameters or fully concrete.

**Long:**
```go
type Bad interface {
    Get() T   // ❌ T is undeclared
}

type Good[T any] interface {
    Get() T   // ✓
}
```

The interface itself must be parameterised by any type used in its methods.

### Q38. How does `dlv` (Delve debugger) handle methods on generic types?
**Short:** It shows the stenciled symbol like `pkg.(*Stack[go.shape.int_0]).Push`. Step-into works in modern versions.

**Long:** Early Go versions (1.18-1.19) had issues with breakpoints on stenciled methods. By 1.21+ Delve handles them transparently. Stack traces show the GC shape suffix, which can be useful for performance work but confusing in normal debugging.

### Q39. Is it possible to have methods on a generic type that are NOT visible across instantiations?
**Short:** No. All instantiations share the same method declarations — only the substituted signatures differ.

**Long:** You cannot say "Stack[int] has method SumInts but Stack[string] does not". To achieve that, write a free function or a wrapper type.

### Q40. How do generic methods affect binary size?
**Short:** One stencil per GC shape, so binary growth is **bounded by the number of distinct shapes**, not the number of instantiations.

**Long:** Calling `Stack[int]`, `Stack[int64]`, `Stack[uint64]` all share one stencil body (8-byte scalar shape). Calling `Stack[*Foo]`, `Stack[*Bar]`, `Stack[string]` all share another (pointer-shaped). The dictionary entries per concrete type are tiny. Binary growth from generics is usually a few percent — far less than C++ template instantiation.

---

## Summary

Memorize the **short answers** for fluency. Practice the **long answers** for depth. The most common interview themes for methods on generic types:

- Receiver must repeat the type parameter list
- Method-level type parameters are forbidden
- Pointer vs value receivers follow the same rules as before
- Each instantiation has its own method set
- Interface satisfaction is checked per instantiation
- Embedding propagates type arguments through method substitution
- Method values resolve type parameters at binding time
- Free functions are the standard workaround for "shape-changing" operations

A confident candidate can explain **why methods cannot have their own type parameters** and demonstrate the free-function workaround in code.
