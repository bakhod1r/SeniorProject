# Why Generics? — Interview Q&A

## How to use this file

Each question has a **short answer** for memorization and a **long answer** for understanding. Practice both. In a real interview, give the short version first and expand only if asked.

Difficulty:
- 🟢 Beginner
- 🟡 Mid-level
- 🔴 Senior
- 🟣 Expert

---

## Beginner 🟢

### Q1. What problem do generics solve in Go?
**Short:** Code duplication, loss of type safety with `interface{}`, and the burden of external code generators.

**Long:** Before Go 1.18, the same algorithm (like `Contains` or `Max`) had to be written once per type, or use `interface{}` and runtime assertions, or use a code generator like `genny`. Generics let you write the function once with a type parameter `T`, with full compile-time type checking.

### Q2. When were generics added to Go?
**Short:** Go 1.18, March 2022.

**Long:** Go was released in 2009. Generics were debated almost from day one but rejected in multiple proposals (2010, 2013, 2016, 2018) because the team did not want to repeat the complexity of C++ templates or the runtime cost of Java erasure. The accepted proposal — **Type Parameters** — was authored by Ian Lance Taylor and Robert Griesemer and shipped in Go 1.18.

### Q3. Are `any` and `interface{}` the same?
**Short:** Yes. `any` is a predeclared alias for `interface{}` introduced in Go 1.18.

**Long:** `type any = interface{}`. They are interchangeable. New code should prefer `any` for readability.

### Q4. What is a type parameter?
**Short:** A placeholder for a real type, declared in `[ ]` after a function or type name.

**Long:** In `func F[T any](x T) T`, `T` is a type parameter. It has no value of its own — at each call site the compiler picks a real type to fill it in.

### Q5. What is a type constraint?
**Short:** An interface that defines which types a type parameter may accept.

**Long:** Constraints in Go are interfaces with optional type elements. `[T any]` allows every type, `[T comparable]` allows types usable with `==`, `[T int | float64]` allows only `int` and `float64`.

### Q6. Why not just use `interface{}` everywhere?
**Short:** It loses compile-time type safety, requires runtime assertions, and forces boxing.

**Long:** `interface{}` accepts any type, but inside the function you cannot use type-specific operations without a type switch or assertion. The compiler cannot catch wrong-type calls. Performance suffers because each value is boxed into a `(type, data)` pair.

### Q7. Give a one-line generic function example.
**Short:** `func First[T any](s []T) T { return s[0] }`.

### Q8. What does `[T comparable]` allow?
**Short:** Use of `==` and `!=` on values of type `T`.

**Long:** It restricts `T` to types that support equality. This includes all basic types, structs of comparable fields, arrays of comparable elements, and pointers — but excludes slices, maps, and functions.

### Q9. What does `[T any]` allow?
**Short:** Any operation that does not require knowledge of `T`'s methods or operators.

**Long:** You can pass `T`, return `T`, store `T`, but you cannot call `<`, `==`, `+`, or any method on it. You can call `len` only if `T`'s constraint says so.

### Q10. Name three Go stdlib packages that use generics.
**Short:** `slices`, `maps`, `cmp`.

**Long:** Added in Go 1.21. `slices` for slice algorithms, `maps` for map utilities, `cmp` for comparison helpers and the `cmp.Ordered` constraint.

---

## Mid-level 🟡

### Q11. What is type inference and when does it fail?
**Short:** The compiler deducing type arguments from function arguments. It fails when no argument pins the type parameter.

**Long:** In `Map([]int{1,2}, strconv.Itoa)`, the compiler sees the first argument is `[]int` so `T = int`, then the second argument is `func(int) string` so `U = string`. It fails when **all** arguments are themselves generic, or when the type parameter only appears in the return type. Then you must write the type arguments explicitly.

### Q12. Why can a method not have its own type parameters?
**Short:** Deliberate language design choice to limit complexity.

**Long:** Allowing method-level type parameters would significantly complicate the implementation (especially for runtime types and reflection) and was deemed not worth the cost. The workaround is to make the operation a free function: `func Map[T, U any](b Box[T], f func(T) U) Box[U]`.

### Q13. What is the difference between `~int` and `int` in a constraint?
**Short:** `int` matches only the exact `int` type; `~int` matches any defined type whose underlying type is `int`.

**Long:** `type Celsius int` is **not** `int` — it is a distinct named type. `[T int]` rejects `Celsius`; `[T ~int]` accepts it. The tilde is essential for generic numeric code that should work with domain-specific types.

### Q14. How does Go implement generics — monomorphization or erasure?
**Short:** Hybrid. **GC shape stenciling** — one body per memory shape, with a runtime dictionary for type-specific operations.

**Long:** C++ uses pure monomorphization (one copy per instantiation, big binary). Java uses erasure (one copy, lost type info, boxing). Go groups types by GC shape (pointer-sized, 8-byte int, 4-byte int, etc.) and generates one body per shape, with a hidden dictionary for things like equality comparison.

### Q15. Why might a generic function be slower than a non-generic equivalent?
**Short:** GC shape stenciling adds dictionary indirection on operations like `==`, `<`.

**Long:** When multiple pointer-shaped types share one stenciled body, the body cannot inline operations that depend on the concrete type. It has to look them up in the runtime dictionary. For tight loops this can show up in benchmarks.

### Q16. Why might a generic function be faster than `interface{}`?
**Short:** No boxing, no runtime type checks, often inlinable.

**Long:** `interface{}` requires every value to be wrapped in a `(type, data)` pair, often requiring a heap allocation. Method calls on `interface{}` go through a v-table. A generic function instantiated for a concrete type avoids both costs.

### Q17. What is `cmp.Ordered`?
**Short:** A constraint for types usable with `<`, `<=`, `>`, `>=`. Includes integers, floats, and strings.

**Long:** Added in Go 1.21 as a stdlib analog of the popular `golang.org/x/exp/constraints.Ordered`. The full definition is roughly:
```go
type Ordered interface {
    ~int | ~int8 | ~int16 | ~int32 | ~int64 |
    ~uint | ~uint8 | ~uint16 | ~uint32 | ~uint64 | ~uintptr |
    ~float32 | ~float64 |
    ~string
}
```

### Q18. What is a type set?
**Short:** The set of types that satisfy a given constraint.

**Long:** Constraints are interfaces; the spec treats interface satisfaction as set membership. `interface { int | string }` has the type set `{int, string}`. `interface { Stringer }` has the set of all types with a `String() string` method. The intersection of a constraint's elements is its type set.

### Q19. How do you express "any number" as a constraint?
**Short:**
```go
type Number interface {
    ~int | ~int8 | ~int16 | ~int32 | ~int64 |
    ~uint | ~uint8 | ~uint16 | ~uint32 | ~uint64 | ~uintptr |
    ~float32 | ~float64
}
```

**Long:** Or import `golang.org/x/exp/constraints` for `Integer`, `Float`, etc. There is no built-in "Number" constraint in stdlib (only `cmp.Ordered`, which also includes `string`).

### Q20. Why did the proposal use **interfaces** as constraints instead of a new "contracts" feature?
**Short:** Reusing interfaces was simpler to teach and easier to implement.

**Long:** Earlier proposals (2016, 2018) introduced a separate "contract" syntax. Users found it confusing — too similar to interfaces yet different. The 1.18 design extended interfaces to allow type elements (`int | string`, `~T`), keeping one mental model.

---

## Senior 🔴

### Q21. When should you NOT use generics?
**Short:** Single-type functions, polymorphic behaviour (use interfaces), public APIs where signatures hurt readability, performance-critical code where benchmarks favour specialization.

**Long:** Generics are not free. Each type parameter clutters the signature and can slow compile time. They are useless when the algorithm depends on per-type behaviour (interfaces are the right tool). For public APIs, breaking changes via generics are easy to make, hard to detect.

### Q22. How do generics interact with reflection?
**Short:** Reflection works on the **instantiated** type, not the type parameter.

**Long:** Inside a generic function you cannot do `reflect.TypeOf(T)` directly — you have to wrap a value: `reflect.TypeOf(*new(T))` or convert via `any(v)`. The reflected type at runtime is the concrete type that was passed in, not the type parameter.

### Q23. What is the "rule of three" for genericization?
**Short:** Do not generalize until you have **three** concrete instances of the same logic.

**Long:** Two instances might be coincidence and the cost of refactoring is small. Three instances reveal the real abstraction and provide enough data points to design the right type parameter list. Premature generalization is worse than duplication because the wrong abstraction is harder to undo than copy-paste.

### Q24. Why did the Go team add `slices`, `maps`, `cmp` only in 1.21, not 1.18?
**Short:** Quality bar — they wanted to see how the community used generics before locking in stdlib API.

**Long:** The two-release gap was deliberate. The stdlib team observed external libraries (`golang.org/x/exp/slices`, etc.) for a year, gathered feedback, and only then promoted the cleanest API to stdlib.

### Q25. How would you migrate a large codebase from `interface{}` helpers to generics?
**Short:** Add generic versions alongside the old ones, deprecate the old, migrate callers gradually, retire the old after a major-version bump.

**Long:** Big-bang migrations cause merge conflicts and review fatigue. The Hashicorp model — release a `/v2` module with generic APIs while keeping `/v1` alive — is the canonical approach for libraries. For applications, mark old helpers `// Deprecated: ...` and update callers as they are touched.

### Q26. Why is `sync.Pool` not generic?
**Short:** Pools sometimes store multiple types; the boxing cost is amortised by reuse; backwards compatibility.

**Long:** The Go team considered `Pool[T]` and rejected it. Most pools have one type per pool, but the API is older than 1.18 and changing it would break the world. Wrapping it yourself is trivial: `func GetX(p *sync.Pool) *X { return p.Get().(*X) }`.

### Q27. What happens at runtime when you call a generic function?
**Short:** A regular function call into the stenciled body, with a hidden dictionary parameter for type-specific operations.

**Long:** The compiler picks the right stencil based on the GC shape of the type argument. For a single concrete type used everywhere, the dictionary call is often devirtualized into a direct call by the compiler. For diverse pointer-shaped types, the dictionary lookup remains.

### Q28. Why is `comparable` "looser" in Go 1.20+?
**Short:** Interfaces now satisfy `comparable`, with a runtime panic possibility if the dynamic value is not actually comparable.

**Long:** Pre-1.20, interface types could not satisfy `comparable` because their dynamic types might be non-comparable (slices, maps, functions). Go 1.20 relaxed this — interfaces satisfy `comparable` at compile time, but `==` may panic at runtime if the dynamic types are incompatible. This made many real-world generic APIs (like `map[interface{}]V`) ergonomic again.

### Q29. Compare Go's generics implementation with Rust's.
**Short:** Both use trait/interface bounds. Rust uses pure monomorphization; Go uses GC shape stenciling.

**Long:** Rust's `<T: Ord>` is the spiritual analog of Go's `[T cmp.Ordered]`. Both are checked at compile time. The big difference is implementation: Rust generates one specialized body per type (fastest, biggest binary), while Go generates one body per shape with a runtime dictionary (smaller binary, slight indirection cost).

### Q30. How do you avoid generic API bloat in a library?
**Short:** Loose constraints, single-letter names, non-exported helpers, and "rule of three" before going generic.

**Long:** Start with the loosest constraint that compiles (often `any`), tighten only when needed. Keep type parameter names short and idiomatic. Hide complex generic helpers in `internal/`. Let users see only the necessary generic surface.

---

## Expert 🟣

### Q31. Why did Go pick the "constraint = interface" model over a separate contract?
**Short:** Simplicity and consistency — one mental model for "type set restrictions".

**Long:** The 2018 contracts proposal was rejected because it duplicated concepts already present in interfaces. The 2020 proposal solved the issue by **extending** interfaces to allow type elements (`int | string`, `~T`). This meant existing interfaces could become constraints with no syntactic change, and users only had to learn one feature. Trade-off: some interfaces (`comparable`) cannot be used as runtime values without restrictions.

### Q32. Why is `comparable` not the same as "supports `==`"?
**Short:** Strict comparability — interface types whose dynamic values might not be comparable are excluded (or panic at runtime in 1.20+).

**Long:** Two `interface{}` values can be `==`-compared at runtime, but if their dynamic types contain slices, maps, or functions, the comparison panics. The spec calls types **strictly comparable** if `==` is well-defined for all values of the type. `comparable` originally allowed only strictly comparable types; 1.20 relaxed it.

### Q33. Walk through GC shape stenciling for a generic function used with five distinct pointer types.
**Short:** One stencil body, five dictionaries, one `*pkg.F[go.shape.*pkg.Type]` symbol shared by all.

**Long:** Suppose `func F[T any](v *T) { ... }` is called with `*Foo`, `*Bar`, `*Baz`, `*Qux`, `*Quux`. All five have the same GC shape (pointer-shaped). The compiler generates **one** body. At each call site, a tiny dictionary describing `*Foo` (or `*Bar`, etc.) is constructed and passed implicitly. Inside the body, operations that depend on `T`'s type — such as `equal`, `hash`, the actual size — are looked up in the dictionary.

### Q34. What are GC shape stenciling's worst-case scenarios?
**Short:** Many distinct pointer-shaped instantiations with frequent `==` or `<` comparisons.

**Long:** The dictionary lookup cost is constant per operation but adds up in tight loops. A function like `Find[T comparable](s []T, target T) int` called over diverse struct types may have measurable overhead vs the hand-written version. In such cases, profiling and possibly hand-specializing pays off.

### Q35. Could Go ever switch to pure monomorphization?
**Short:** Possibly, with a build flag, but at the cost of binary bloat.

**Long:** The team has discussed an opt-in flag for hot paths. Doing it by default would significantly grow Go binaries — unacceptable for the language's "small binary" identity. Profile-guided optimization (PGO) might enable the compiler to monomorphize specific hot generic functions automatically in future releases.

### Q36. Is there a way to specialize a generic function for a specific type?
**Short:** Not officially. Workaround: write a non-generic wrapper for the hot type.

**Long:** Some languages (C++, Rust nightly) support explicit specialization. Go does not. If `Sum[int]` is your hot path, write a separate `func SumInt(s []int) int` and have the generic version delegate to it. The compiler will inline accordingly.

### Q37. Why is type inference deliberately limited (no return-type inference)?
**Short:** To keep error messages tractable and inference fast.

**Long:** Languages with return-type-driven inference (Haskell, Scala) can produce baroque inference algorithms that are hard to teach and slow to run. Go's design constraint — "the compiler must be fast and the errors must be clear" — pushed the team to limit inference to argument types. The user pays a small ergonomic price for predictable error messages.

### Q38. How does generics interact with `iota` and constant expressions?
**Short:** Type parameters cannot be used as constant types — generics are runtime-only.

**Long:** `const x T = 1` is invalid because `T` is unknown at constant evaluation. You can declare `var x T = 1` only if the constraint guarantees `1` is convertible to `T` (e.g., `[T ~int]`). This trips up beginners writing generic constants.

### Q39. Could generics replace `context.Context` propagation?
**Short:** No, because `context.Context` carries arbitrary values through cancellation and deadlines, which is heterogeneous by nature.

**Long:** The Go team considered a generic context to make `Value(key)` typed. They rejected it: contexts often carry values from different libraries, and forcing a single type parameter would either limit expressiveness or push complexity onto users. The current "interface + reflection-like access" model wins on flexibility.

### Q40. What surprises do generics introduce for `pprof` and the debugger?
**Short:** Stenciled bodies appear with mangled names like `pkg.F[go.shape.int_0]`.

**Long:** Profiling a generic function shows the GC shape suffix in flame graphs. This is useful for performance analysis (you can see which shape is hot) but confusing for first-time users. The debugger (`dlv`) handles generics correctly in modern versions but had quirks in 1.18-1.19.

---

## Summary

Memorize the **short answers** for fluency. Practice the **long answers** for depth. The most common interview themes are:

- Three problems generics solve (duplication, type safety, codegen)
- The version (1.18, March 2022)
- `any` vs `comparable` vs `cmp.Ordered`
- Why methods cannot have their own type parameters
- GC shape stenciling vs monomorphization vs erasure
- When NOT to use generics
- Stdlib adoption (`slices`, `maps`, `cmp` in 1.21)

A confident candidate explains **the why**, not just the syntax.
