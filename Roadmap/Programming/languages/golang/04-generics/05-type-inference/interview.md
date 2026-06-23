# Type Inference — Interview Questions

A working list of 30+ interview questions and answers about Go's type inference. Difficulty grows from easy to advanced. Each entry has a short, direct answer plus a worked example or follow-up where relevant.

---

## Section 1: Fundamentals

### Q1. What is type inference in Go?
**Answer.** Type inference is the compiler's process of deducing type arguments to a generic function or type so that the caller does not need to write them in `[T]` brackets. It comes in two flavours: function argument type inference (FTAI) and constraint type inference.

### Q2. What is a type argument vs a type parameter?
**Answer.** A *type parameter* is the placeholder in the function signature: `func F[T any](x T)`. A *type argument* is the concrete type used to instantiate it: in `F[int](42)`, `int` is the type argument.

### Q3. Does type inference change program semantics?
**Answer.** No. Anything inferred can be written explicitly. The program's behaviour is identical. Inference is purely a notational convenience.

### Q4. When can the compiler infer T from a call?
**Answer.** When `T` appears in at least one parameter type whose corresponding argument type uniquely determines `T` through unification, and any constraint requirements are satisfied.

### Q5. Give an example where T cannot be inferred.
**Answer.**
```go
func Make[T any]() T { var z T; return z }
// Make() — fails. T appears only in the return.
Make[int]() // works.
```

### Q6. Why does `Max(3, 5)` infer T = int?
**Answer.** Both arguments are untyped integer constants. They default to `int`, and unification of both parameter positions agrees on `T = int`.

---

## Section 2: FTAI

### Q7. What does FTAI stand for and what does it do?
**Answer.** Function Argument Type Inference. It walks each function argument and unifies the argument type with the corresponding parameter type, recording substitutions for type parameters.

### Q8. What is type unification?
**Answer.** A recursive structural comparison of two types that records bindings for type parameters when they appear and fails on irreconcilable mismatches. It is the core algorithm beneath inference.

### Q9. Give an example of unification on composite types.
**Answer.**
```go
func F[T any](xs []T) {}
F([]int{1, 2}) // unify []T with []int → T = int.
```

### Q10. Can FTAI infer through nested types?
**Answer.** Yes. Inference recurses into pointers, slices, maps, channels, function types, and structs.
```go
func F[T any](m map[string][]T) {}
F(map[string][]int{"a": {1,2}}) // T = int
```

### Q11. What happens if two parameter positions disagree about T?
**Answer.** Compilation fails. Unification reaches a contradiction.
```go
func Equal[T comparable](a, b T) bool { return a == b }
Equal(1, "x") // ERROR: T cannot be both int and string.
```

---

## Section 3: Constraint Type Inference

### Q12. What is constraint type inference?
**Answer.** A second inference phase that uses the *shape* of a constraint to derive remaining type parameters. Most commonly it derives `E` from `S ~[]E` once `S` is known.

### Q13. Why does this work?
```go
func First[S ~[]E, E any](s S) E { return s[0] }
First([]int{1, 2}) // S = []int, E = int
```
**Answer.** FTAI sets `S = []int`. The constraint `~[]E` has core type `[]E`. Unifying `[]int` against `[]E` yields `E = int`.

### Q14. Why does constraint inference fail here?
```go
type Mixed interface { ~int | ~string }
func F[T Mixed](x T) T { return x }
```
**Answer.** Constraint inference still works fine — but only FTAI is needed here. If you tried `func F[T Mixed, U any](x U) T` and expected `T` to be derived from `U`, it would fail because `Mixed` has no core type connecting it to `U`.

### Q15. What is a "core type"?
**Answer.** The single underlying type shared by all members of a constraint's type set, when one exists. `~int | ~int32` has no core type. `~[]E` has core type `[]E`.

---

## Section 4: Untyped Constants

### Q16. What is an untyped constant?
**Answer.** A literal like `1`, `"hi"`, `nil`, `true` that has no fixed type until context (an assignment or argument) decides one.

### Q17. What is the default type for these?
**Answer.**
| Constant | Default |
|----------|---------|
| `1`, `42` | `int` |
| `1.0`, `3.14` | `float64` |
| `'a'` | `rune` (`int32`) |
| `"hi"` | `string` |
| `true`, `false` | `bool` |
| `0i` | `complex128` |

### Q18. Why does `Reduce(events, 0, addCount)` infer `int` and not `int64`?
**Answer.** Because `0` is an untyped int constant; its default type is `int`. The accumulator type `U = int` is inferred. Use `int64(0)` or explicit instantiation to force `int64`.

### Q19. How do typed arguments interact with untyped constants?
**Answer.** Typed arguments bind type parameters first. Untyped constants must then be representable in the bound type.
```go
F(int32(1), 2) // F[T int32|...](a, b T): T = int32; 2 must be representable as int32. OK.
```

---

## Section 5: Failure Modes

### Q20. List four reasons inference might fail.
**Answer.**
1. A type parameter appears only in the return.
2. An argument is `nil` and no other clue exists.
3. A function-typed argument has the wrong shape.
4. Two arguments produce conflicting bindings for the same parameter.

### Q21. Why does `Map(s, fmt.Sprint)` fail?
**Answer.** `fmt.Sprint` has type `func(...any) string`. The parameter expects `func(T) U`. Unification fails on the function shape (variadic-any ≠ fixed-arity).

### Q22. Why does `Map(s, strconv.Itoa)` succeed in 1.21+?
**Answer.** `strconv.Itoa` has type `func(int) string`. Unification with `func(T) U` yields `T = int, U = string`. Go 1.21 made the function-shape unification work in this case.

### Q23. Why does this fail?
```go
func F[T any](*T) {}
F(nil)
```
**Answer.** `nil` has no type the compiler can use to infer `T`. Either annotate (`F[int](nil)`) or pass a typed nil (`var p *int; F(p)`).

### Q24. What is the workaround when inference fails?
**Answer.** Provide explicit type arguments at the call site (`F[int](nil)`) or restructure the function so the missing parameter is anchored in an argument (e.g., add a sentinel parameter).

---

## Section 6: Version Differences

### Q25. What changed in Go 1.21 inference?
**Answer.**
- Function-shape unification works for named functions (`strconv.Itoa` style).
- Better handling of untyped constants in mixed contexts.
- Improved unification with named types.
- The `cmp` package landed (`cmp.Ordered`).

### Q26. Will my code that worked in 1.18 still work in 1.21?
**Answer.** Yes — inference rules expanded, not contracted. New cases compile; old cases still do.

### Q27. Should I write `go 1.21` in `go.mod`?
**Answer.** Yes for new modules. It enables modern inference and lets you import `cmp`, `slices`, and `maps` from the standard library.

---

## Section 7: Spec and Algorithm

### Q28. What two phases compose Go's inference?
**Answer.** Function argument type inference and constraint type inference, applied iteratively until a fixed point.

### Q29. What is loose vs exact unification?
**Answer.** Exact unification requires types to be identical. Loose unification considers assignability (e.g., untyped constants and named types). FTAI uses loose unification at the leaves; constraint inference often requires exact.

### Q30. What is partial type inference?
**Answer.** Supplying some type arguments explicitly and letting the rest be inferred.
```go
func Cast[Out, In any](x In) Out { /* ... */ }
Cast[float64](42) // Out = float64 (explicit), In = int (inferred)
```

---

## Section 8: API Design

### Q31. How would you redesign `Build[T]() T` so callers do not need explicit T?
**Answer.** Add a sentinel argument or a builder type.
```go
func Build[T any](_ T) T { var z T; return z }
Build(User{}) // T = User inferred.

// Or:
type Builder[T any] struct{}
func For[T any]() Builder[T] { return Builder[T]{} }
func (Builder[T]) Build() T { var z T; return z }
For[User]().Build() // T given once.
```

### Q32. Why is the slice + element pattern `func F[S ~[]E, E any](s S) E` preferred over `func F[E any](s []E) E`?
**Answer.** It accepts named slice types like `type IDs []int` while still inferring fully. The element parameter `E` is derived from constraint type inference.

### Q33. When should you pick explicit instantiation over inference?
**Answer.** At public API boundaries, in test fixtures, in generated code, when the inferred default would be wrong (e.g., `int` vs `int64`), and when readability benefits from naming the type.

---

## Section 9: Practical Tricky Cases

### Q34. `make([]T, 0)` — why does inference not "just work" here?
**Answer.** `make` is a builtin, not a generic function. Type inference rules apply to generic *functions* and *types*, not to builtins. You must always supply the type.

### Q35. Can I infer T from a method value of an interface?
**Answer.** Generally no — interface method values lose the underlying type. Pass a concrete value or a closure.

### Q36. Can I write `var f = Map; f(s, strconv.Itoa)`?
**Answer.** No. `Map` is a generic function and cannot be assigned to a variable without instantiation. Write `var f = Map[int, string]; f(s, strconv.Itoa)`.

### Q37. How does inference work for variadic generic functions?
**Answer.** Unification considers the variadic parameter as a slice. With at least one argument the type is determined. With no arguments `Sum()` fails to infer.

### Q38. Does inference happen at runtime?
**Answer.** No. Inference is entirely compile-time. The runtime sees only fully-instantiated functions.

---

## Section 10: Senior-Style Open Questions

### Q39. Suppose a teammate keeps writing `MyFunc[int](1)` instead of `MyFunc(1)`. What review feedback do you give?
**Answer.** Ask whether the explicit form is intentional — sometimes the type is documentary. If not, suggest dropping it. Confirm the inferred default matches their intent (especially around `int` vs `int64`). Suggest a comment if the explicit form is needed.

### Q40. You added a constraint `comparable` to a public generic function. What is the impact?
**Answer.** Existing call sites that passed non-comparable types now fail to compile. This is a breaking change. Document, deprecate the old shape, or split into two functions.

### Q41. How do you test that a generic API stays inferable as it evolves?
**Answer.** Add `Example` tests that exercise the canonical inferred call. They are compiled by `go test`. If a future signature change breaks inference, the example fails to build, and CI alerts you.

### Q42. A user says "the call site is too noisy". How do you investigate?
**Answer.** Reproduce the call. Check whether all type parameters appear in arguments. Check the Go version (modern features may help). Consider reordering parameters so partial instantiation is shorter, splitting into builder-style API, or providing typed wrappers for hot cases.

---

## Section 11: Rapid-Fire (One-Liners)

- **What is FTAI?** Inferring type arguments from function arguments via unification.
- **What is constraint inference?** Deriving type parameters from constraint shape (e.g., `~[]E`).
- **Untyped constant default for `1`?** `int`.
- **Default for `1.0`?** `float64`.
- **Default for `nil`?** None — context required.
- **Does `Build[T]() T` infer?** No.
- **What helps it infer?** A sentinel argument or builder.
- **What gives `cmp.Ordered`?** Standard ordering constraint, Go 1.21+.
- **Inference at runtime?** No, compile time.
- **Cost of inference?** Compile time only; runtime cost is zero.

---

## Section 12: Sample Coding Tasks (Interviewer Prompts)

### T1. Predict the inferred types

```go
func Pair[A, B any](a A, b B) [2]any { return [2]any{a, b} }

Pair(1, "hi")            // A = ?, B = ?
Pair(1, 2.0)             // A = ?, B = ?
Pair(int64(1), 2)        // A = ?, B = ?
```

**Answers.**
- `int`, `string`
- `int`, `float64`
- `int64`, `int`

### T2. Make this call infer
```go
func Build[T any]() T { var z T; return z }
// Build() — fix this so caller can write Build(prototype).
```
**Answer.**
```go
func Build[T any](_ T) T { var z T; return z }
prototype := User{}
u := Build(prototype) // T = User
```

### T3. Why does this fail?
```go
func Map[T, U any](s []T, f func(T) U) []U { /* ... */ }
Map([]int{1,2,3}, fmt.Sprint)
```
**Answer.** `fmt.Sprint` is `func(...any) string`. Unification with `func(T) U` fails. Fix: pass a closure.

### T4. Refactor for inference
Given:
```go
type Cache struct{}
func Get[V any](c *Cache, k string) V { /* ... */ }
Get[*User](cache, "u-1") // explicit always
```
**Answer.** Move `V` to the cache type:
```go
type Cache[V any] struct{}
func (*Cache[V]) Get(k string) V { /* ... */ }
users := &Cache[*User]{}
u := users.Get("u-1") // V pinned at the cache instance.
```

---

## Closing Thought

If a candidate can explain what FTAI and constraint inference do, predict default types of untyped constants, identify a function-shape unification failure, and discuss how to design APIs whose call sites are clean — they have a working professional understanding of Go's type inference.
