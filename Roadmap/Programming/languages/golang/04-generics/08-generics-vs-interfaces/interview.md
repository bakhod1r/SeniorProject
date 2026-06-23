# Generics vs Interfaces — Interview Q&A

## How to use this file

Each question has a **short answer** for memorization and a **long answer** for understanding. Practice both. In a real interview, give the short version first and expand only if asked.

Difficulty:
- 🟢 Beginner
- 🟡 Mid-level
- 🔴 Senior
- 🟣 Expert

---

## Beginner 🟢

### Q1. What is the one-line rule for choosing between generics and interfaces?
**Short:** Same code, different types → generics. Different behaviour, same shape → interfaces.

**Long:** If the function body is identical and only the type changes, generics. If different concrete types do different things behind the same name, interfaces. The decision is about where the variation lives — in the type or in the behaviour.

### Q2. When would you NOT use generics?
**Short:** When you need different behaviour per type, when storage is heterogeneous, when an interface gives a more stable API.

**Long:** Generics shine for "same body, many types". They are wrong for plugin systems, dependency injection, heterogeneous collections, and stable public APIs that may evolve. Most architectural seams are interface-shaped.

### Q3. Why is `io.Reader` still an interface?
**Short:** Each reader reads from a different source — disk, memory, socket — so the body is genuinely different per type.

**Long:** Generics over `io.Reader` would not help: every implementation reads `[]byte`, so there is no `T` to vary. The variation is in **how** bytes are obtained, which is exactly what an interface expresses. The whole `io` ecosystem (`Copy`, `LimitReader`, `MultiReader`) composes via interfaces.

### Q4. Can you mix generics and interfaces?
**Short:** Yes — use an interface as a generic constraint.

**Long:** `func F[T Stringer](v T) string { return v.String() }` is generic in `T` but requires `T` to satisfy the `Stringer` interface. The function gets compile-time type safety on the slice (no boxing) and method dispatch on each element.

### Q5. What does the cost of an interface call look like?
**Short:** A few nanoseconds for the indirect dispatch, plus possible heap boxing of the value.

**Long:** Every interface value is two words `(type, data)`. Calling a method goes through the v-table — one indirect read for the method pointer, then an indirect call. On modern CPUs this is 2 to 5 ns and can stress branch prediction. Boxing happens when you assign a non-pointer value to an interface and the value does not fit in a word.

### Q6. What is the cost of a generic call?
**Short:** Essentially zero — the compiler stamps out a body and the call is direct.

**Long:** After GC shape stenciling, a generic call is a regular function call. For pointer-shaped instantiations there is a small dictionary lookup for type-specific operations, but the call itself is direct. No boxing, no v-table.

### Q7. Can a generic function take a slice of mixed types?
**Short:** No. Each instantiation `[]T` is a single concrete type.

**Long:** `[]Stack[int]` cannot hold a `Stack[string]`. To mix concrete types in one slice you need an interface that all the types satisfy. Generics serve **homogeneous** collections; interfaces serve **heterogeneous** ones.

### Q8. What is "static dispatch" vs "dynamic dispatch"?
**Short:** Static is decided at compile time (generics); dynamic is decided at runtime (interfaces).

**Long:** A static call resolves to one specific function body in the compiled binary. A dynamic call goes through a method table looked up on the value at runtime. Static calls inline; dynamic calls usually do not.

### Q9. Should you ever convert an existing interface to a generic?
**Short:** Rarely — only when the body is uniform and the interface was a workaround for missing generics.

**Long:** Real interfaces (`io.Reader`, `error`, `http.Handler`) describe per-type behaviour and should stay interfaces. Pre-1.18 "fake" interfaces using `interface{}` for type erasure are good migration candidates — those were generics in disguise.

### Q10. Give one example of each tool from the standard library.
**Short:** `slices.Sort` is generic; `io.Reader` is an interface.

**Long:** `slices.Sort[S ~[]E, E cmp.Ordered](s S)` works for any ordered slice. `io.Reader` is implemented differently by `*os.File`, `*bytes.Reader`, `*tls.Conn`. Same data type (`[]byte`), different bodies — exactly the interface case.

---

## Mid-level 🟡

### Q11. What are the two flavours of polymorphism, and which Go tool maps to which?
**Short:** Parametric → generics. Subtype → interfaces.

**Long:** Parametric polymorphism is "the same code works for many types regardless of their identity". Subtype polymorphism is "many types share a name and behave differently behind it". Generics implement the first; interfaces implement the second. Go gives you both; many other languages mix the two awkwardly.

### Q12. Can a constraint be an interface?
**Short:** Yes — every constraint is an interface.

**Long:** The Go spec defines constraints as "interfaces that define a set of permissible type arguments". Method-only interfaces (`Stringer`) work as constraints. Type-element interfaces (`int | string`, `~float64`) are also interfaces — they just cannot be used as runtime types.

### Q13. Why might you prefer `[]T` over `[]Interface`?
**Short:** No boxing, flat memory, statically dispatched calls.

**Long:** A `[]int` is a contiguous block of `int`s. A `[]Interface` of `int` is a contiguous block of two-word headers, possibly each pointing to a heap allocation. For one million elements that is 8 MB vs 16+ MB plus a million heap objects.

### Q14. Why might you prefer `[]Interface` over `[]T`?
**Short:** Heterogeneous storage; runtime polymorphism.

**Long:** When the slice holds genuinely different concrete types — `[]Shape{Circle{...}, Square{...}}` — only an interface unifies them under one element type. Generics cannot.

### Q15. When does an interface call become as fast as a generic call?
**Short:** When the compiler can devirtualize, or PGO has trained on the hot path.

**Long:** Devirtualization happens when the concrete type at the call site is provably constant (a literal assignment, an inline-able variable). Profile-guided optimization in Go 1.21+ can devirtualize hot interface calls based on profile data. In both cases the interface call becomes a direct call and matches generic performance.

### Q16. Can a generic function have polymorphic behaviour?
**Short:** Only via methods on `T` that the constraint declares.

**Long:** The generic body sees only operations the constraint guarantees. If the constraint includes a method, the body can call that method and it dispatches per type. If you find yourself doing `switch any(v).(type)` inside a generic, the body is not really generic — it is interface dispatch in disguise.

### Q17. Why might `slices.Sort` be faster than `sort.Sort`?
**Short:** The comparator can be inlined; no per-call interface dispatch.

**Long:** `sort.Sort` calls `data.Less(i, j)` through an interface, costing an indirect call per comparison. `slices.Sort` calls the user's `cmp` function directly (or the compiler inlines `<` on `cmp.Ordered`). For 10,000-element slices the difference is around 40% in published benchmarks.

### Q18. Can you store generic functions in a slice?
**Short:** Not as such — generic functions are not first-class values until instantiated.

**Long:** `[]func[T any](T)` is illegal. You can store concrete instantiations: `[]func(int){f1, f2}` works, but each element must agree on the type. For heterogeneous behaviour, store interface values instead.

### Q19. Why is `error` an interface and not a generic?
**Short:** Error types vary in behaviour — they may wrap, expose codes, format differently. That is interface territory.

**Long:** `error` is `interface { Error() string }`. Many error types implement this differently — `*url.Error`, `*os.PathError`, custom types. Generics over the error message type would lose the rich error ecosystem (wrapping, type assertions, error chains).

### Q20. How does dependency injection differ between interfaces and generics?
**Short:** Interfaces compose at runtime; generics propagate type parameters everywhere.

**Long:** Injecting an interface lets you swap implementations in tests with no signature changes. Injecting a generic dependency forces every consumer to mention `T`, which is heavy. For DI specifically, interfaces are almost always the right call.

---

## Senior 🔴

### Q21. Walk me through migrating a `interface{}`-based cache to generics.
**Short:** Add a generic version alongside, deprecate the old, migrate callers, retire after a major-version bump.

**Long:** Step 1: introduce `Cache[K comparable, V any]` next to the existing `Cache`. Step 2: update internal callers to the generic version. Step 3: mark the old `Cache` as `// Deprecated`. Step 4: in the next major version, remove or rename. The Hashicorp `golang-lru/v2` migration is the canonical example.

### Q22. When would you keep an `interface{}` API even after generics existed?
**Short:** When the API is heterogeneous, when callers cannot upgrade Go version, when the API is `sync.Pool`-shaped.

**Long:** `sync.Pool.Get() interface{}` stayed as is because pools may store many types per pool, and the boxing cost is amortised. `database/sql.Scan(...interface{})` stayed because it accepts arbitrary destinations. Heterogeneity is the signal that interfaces are the right tool.

### Q23. How do you choose between a generic interface and a method-set interface?
**Short:** Generic interface when the type varies across implementations; method-set interface when behaviour varies.

**Long:** `Repository[T]` is a generic interface — every aggregate has the same Find/Save/Delete shape, but operates on a different type. `Notifier` is a method-set interface — different bodies, same `Notify(string) error` signature. The two often coexist: a generic interface for storage, a method-set interface for behaviour.

### Q24. Why might you split an interface into two: one method, one type-element?
**Short:** Because Go forbids type-element interfaces from being runtime types.

**Long:** If you want both a constraint (uses type elements) and a runtime interface (uses methods), they must be two declarations. Reuse via embedding is allowed, but the type-element variant cannot serve as a runtime type. This is a spec constraint, not a stylistic one.

### Q25. How would you design a plugin system in modern Go?
**Short:** Interface-shaped registry with plugins satisfying a small interface.

**Long:** `type Plugin interface { Init(...) error; Run(ctx) }` plus `var registry = map[string]Plugin{}`. Each plugin registers itself in `init()`. Generics would force a single `T`, defeating the plugin idea. Late binding is fundamentally an interface job.

### Q26. What is the cost of generic type parameters in public APIs?
**Short:** Every caller must mention `T`; documentation expands; type inference may surprise users.

**Long:** A `Cache[K, V]` shows up in every method signature in godoc. Hover panes get noisy. Type inference works in calls but not in variable declarations: `var c Cache` is illegal. Once published, removing `T` is a breaking change.

### Q27. Why is `slices.Sort[S ~[]E, E cmp.Ordered](s S)` written with two type parameters?
**Short:** So a custom slice type (`type IntList []int`) is preserved as the input type.

**Long:** With `func Sort[T cmp.Ordered](s []T)`, calling `Sort(myList)` would lose the `IntList` type. The two-parameter form `[S ~[]E, E cmp.Ordered]` lets `S` capture the slice type itself. This is a senior-level stdlib design lesson.

### Q28. How do you evolve a public interface API?
**Short:** Embed and add new methods on a sub-interface; never modify the original.

**Long:** Adding a method to a public interface breaks any external implementation. The Go pattern is: embed the old interface in a new one with extra methods, accept the wider interface in new functions, keep accepting the narrower interface in old functions. `io.ReadCloser` (which embeds `Reader` and `Closer`) is the model.

### Q29. When does a generic helper become a maintenance burden?
**Short:** When the constraint has more than two type elements, or when the body uses `any(v).(type)`, or when callers need many distinct instantiations.

**Long:** A constraint listing twelve numeric types means you missed `cmp.Ordered` or `constraints.Integer`. A `switch any(v).(type)` reveals hidden interface dispatch — refactor to a real interface. Hundreds of distinct instantiations bloat the binary; consider whether the abstraction is paying off.

### Q30. How do you decide whether to keep a single-implementation interface?
**Short:** Keep it only if a second implementation is imminent or required for tests; otherwise inline.

**Long:** A `UserRepo` interface with one production implementation **and** test fakes is justified. A `UserRepo` interface with one production implementation and no test usage is noise. The Go community has shifted away from "interface for everything" toward "interface when it pays for itself".

---

## Expert 🟣

### Q31. Compare generics and interfaces from a CPU cache perspective.
**Short:** Generics keep data flat and predictable; interfaces fragment via two-word headers and possible heap boxing.

**Long:** A `[]T` of one million `int`s sits in 8 MB of contiguous memory; the prefetcher loves it. A `[]Interface` of the same is 16 MB plus one million heap allocations, each chasing a pointer. Modern CPUs penalise pointer chasing heavily; generic-over-flat-data can be 5-50x faster on memory-bound code.

### Q32. How does PGO change the generics-vs-interfaces equation?
**Short:** PGO can devirtualize hot interface calls, narrowing the historical gap.

**Long:** Profile-guided optimization in Go 1.21+ can detect that a particular interface call site is dominated by one concrete type and emit a fast path that bypasses the v-table. For monomorphic-at-runtime interfaces, PGO closes most of the performance gap. The remaining gap is the interface header memory overhead, which PGO cannot fix.

### Q33. Describe a case where generics are slower than interfaces.
**Short:** Diverse pointer-shaped types with frequent equality checks may show dictionary indirection costs.

**Long:** GC shape stenciling shares one body across all pointer-shaped types. Operations like `==` go through the dictionary. With many distinct pointer-shaped instantiations, each compare costs a lookup. A hand-rolled per-type version avoids this. In practice this matters only on extremely hot paths.

### Q34. Why did Go not unify generics and interfaces under a single syntax?
**Short:** Backwards compatibility — existing interface code must still work without generics knowledge.

**Long:** A unified syntax would have required changes to interface declarations everywhere. The 1.18 design extends interfaces with type elements but keeps the two consumption models — runtime variable type vs constraint — separate. This preserves the millions of lines of pre-1.18 interface code.

### Q35. How do you reason about API stability when a generic type leaks into public methods?
**Short:** Every method signature now mentions `T`; changing `T` is a breaking change to the entire surface.

**Long:** A public `Cache[K, V]` propagates `K, V` into `Get`, `Set`, `Delete`, `Range`, `Keys`, `Values`. Adding a third type parameter is a breaking change. The fix is to keep the generic surface small or hide it behind an interface for public consumption while keeping a generic implementation internal.

### Q36. Describe a case where converting from an interface to a generic improved performance.
**Short:** `slices.Sort` over `sort.Sort` — 40% faster on 10K-element slices.

**Long:** `sort.Sort` dispatches `Less(i, j)` through an interface; `slices.Sort` either inlines `<` on `cmp.Ordered` or calls the user's `func(a, b T) int` directly. Eliminating the indirect call is the main win. Real benchmarks show 20-40% speedups on numeric and string sorts.

### Q37. Why does `sync.Pool` not have a generic `Get[T]`?
**Short:** Pools sometimes store multiple types; the boxing cost is amortised by reuse; backwards compatibility.

**Long:** The Go team considered `Pool[T]` and rejected it for stdlib reasons. The interface form is sometimes useful for storing different types in one pool. Wrapping is trivial: `func GetX(p *sync.Pool) *X { return p.Get().(*X) }`. The decision encodes a real tradeoff: not every API benefits from genericization.

### Q38. How do generics affect the Liskov substitution principle in Go?
**Short:** They do not — Go has no inheritance. Both interfaces and generics rely on structural typing, not subtyping.

**Long:** LSP applies to languages with class inheritance. Go's interfaces use method-set membership; generics use type-set membership. Both are structural. Substitutability is a design principle the engineer enforces, not a language feature. The result is that LSP-style bugs are rare in Go regardless of which tool you pick.

### Q39. Describe the design tension when modelling a domain where some types share methods and some do not.
**Short:** Use an interface for the shared methods; use generics where the type itself varies; use a hybrid (generic over interface) when both apply.

**Long:** If `User` and `Order` both implement `ID() string`, that is `Identifiable`. If `Repository[T]` works for both, that is generic. A function `func Find[T Identifiable](r Repository[T], id string) (T, error)` combines both — generic in storage, interface in shared behaviour. Senior design separates these axes carefully.

### Q40. What is the cost of `any` as a function parameter compared to `[T any]`?
**Short:** `any` boxes the value at the call site; `[T any]` does not.

**Long:** `func F(v any)` always passes a `(type, data)` pair. The data may be on the heap. `func F[T any](v T)` passes the value directly — for small values entirely in registers. For large values it passes a pointer or copies the bytes, but never wraps in an interface header. On hot paths the difference is measurable; on cold paths it is not.

---

## Summary

Memorize the **short answers** for fluency. Practice the **long answers** for depth. Common interview themes:

- The one-line decision rule (same body vs different behaviour)
- Static vs dynamic dispatch and their costs
- When NOT to use generics (heterogeneous, plugin systems, DI)
- Why `io.Reader`, `error`, `http.Handler` stay as interfaces
- Hybrid pattern: generic function over interface constraint
- Backwards-compatible migrations (Hashicorp `/v2` model)
- Cost of generics in public APIs (type parameter propagation)

A confident candidate explains **why each tool exists** and **when each is the wrong choice**, not just the syntax.
