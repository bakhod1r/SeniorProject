# `comparable` and `cmp.Ordered` — Interview Q&A

## How to use this file

Each question has a **short answer** for memorization and a **long answer** for understanding. Practice both. In a real interview, give the short version first and expand only if asked.

Difficulty:
- 🟢 Beginner
- 🟡 Mid-level
- 🔴 Senior
- 🟣 Expert

---

## Beginner 🟢

### Q1. What is `comparable`?
**Short:** A predeclared constraint that allows `==` and `!=` on a type parameter.

**Long:** It is built into the language — no import. Use it whenever your generic body needs to compare values for equality, e.g., as map keys, in sets, or in `Contains`-style helpers.

### Q2. Is `any` comparable?
**Short:** Since Go 1.20 — yes, but `==` may panic at runtime if the dynamic type is a slice, map, or function.

**Long:** Pre-1.20, `any` did **not** satisfy `comparable`. The 1.20 release relaxed that rule so interfaces (including `any`) qualify. The runtime can still panic when the dynamic value is uncomparable, but the constraint check passes at compile time.

### Q3. Is a struct with a slice field comparable?
**Short:** No. A struct is comparable only if **all** its fields are.

**Long:** `==` on a struct compares fields one by one. If any field is a slice, map, or function, the struct cannot be compared with `==`, so it does not satisfy `comparable`. You can use `slices.Equal` or write a custom `Equals` method.

### Q4. Difference between `comparable` and `cmp.Ordered`?
**Short:** `comparable` allows `==` and `!=`. `cmp.Ordered` also allows `<`, `<=`, `>`, `>=`.

**Long:** `cmp.Ordered` is strictly more powerful. Use the smaller one when the body only needs equality (sets, dedup) and the larger one when the body needs ordering (sort, min/max, BST).

### Q5. Where does `cmp.Ordered` live?
**Short:** In the standard `cmp` package. Added in Go 1.21.

**Long:** Before 1.21, the community used `golang.org/x/exp/constraints.Ordered`. The 1.21 promotion made `cmp.Ordered` the canonical version.

### Q6. Why is `[]int` not comparable?
**Short:** Go does not define `==` on slices.

**Long:** A slice is `(ptr, len, cap)` — comparing them with `==` could mean reference identity or content equality, neither of which Go picks. To compare slice contents, call `slices.Equal`.

### Q7. Are pointers comparable?
**Short:** Yes — by address.

**Long:** `*T == *T` is true when both point to the same address. Pointer equality says nothing about the values they point to. Two pointers to identical values compare unequal if they live in different heap slots.

### Q8. Are floats comparable?
**Short:** Yes — but `NaN != NaN`.

**Long:** `==` and `!=` work on floats. The catch is `NaN`: per IEEE-754, NaN is never equal to anything, including itself. So a `Set[float64]` cannot deduplicate NaN, and `Contains` for NaN returns false.

### Q9. Are interface values comparable?
**Short:** Yes — but the comparison may panic if the dynamic types are not comparable.

**Long:** Two interface values are equal if their dynamic types are identical and the underlying values are equal. If either dynamic type is a slice, map, or function, `==` panics at runtime.

### Q10. Why must map keys be comparable?
**Short:** Map collision detection uses `==`.

**Long:** A Go map looks up keys by hashing then comparing for equality. Both hashing and equality require `comparable` semantics. So map keys are checked for comparability at compile time.

---

## Mid-level 🟡

### Q11. Are user-defined types like `type UserID int` accepted by `cmp.Ordered`?
**Short:** Yes — `cmp.Ordered` uses `~int`, `~float64`, etc., so any defined type with an Ordered underlying qualifies.

**Long:** The tilde widens each term to all defined types whose underlying type matches. `type Score int` satisfies `cmp.Ordered` automatically. Without the tilde, only the bare `int`, `string`, etc. would qualify.

### Q12. What does `cmp.Compare` return for NaN?
**Short:** `cmp.Compare(NaN, x) = -1`, `cmp.Compare(x, NaN) = +1`, `cmp.Compare(NaN, NaN) = 0`.

**Long:** `cmp.Compare` extends `<` with deterministic NaN handling: NaN is treated as **less** than any non-NaN, and two NaNs are **equal**. This gives a total order that sort algorithms can rely on. Operators (`<`, `>`) still return false for any NaN comparison.

### Q13. Why doesn't `cmp.Ordered` include `complex64`?
**Short:** Complex numbers do not have a canonical total order.

**Long:** A complex `a+bi` could be ordered by real part, by magnitude, or by argument. None is universally correct. Including any one in `cmp.Ordered` would silently break code expecting another. The spec's "ordered" predicate excludes complex, and `cmp.Ordered` follows.

### Q14. What does the Go 1.20 release note say about `comparable`?
**Short:** "Comparable types (such as ordinary interfaces) may now satisfy `comparable` constraints, even if the type arguments are not strictly comparable (comparison may panic at runtime)."

**Long:** That single sentence relaxed the rule that interfaces could not satisfy `comparable`. The change made `Set[any]` legal at compile time. The cost is a runtime panic if `==` is called on a slice-typed value held by the interface.

### Q15. Is `time.Time` Ordered?
**Short:** No — `time.Time` is a struct, not in the `cmp.Ordered` type set.

**Long:** `time.Time` is comparable (its fields are all comparable), but its underlying type is a struct, not one of the types listed in `cmp.Ordered`. To sort `[]time.Time`, use `slices.SortFunc` with `time.Time.Compare` (added in Go 1.20).

### Q16. Is `time.Duration` Ordered?
**Short:** Yes — its underlying type is `int64`, which `cmp.Ordered` includes via `~int64`.

**Long:** `type Duration int64`. The tilde in `~int64` matches durations directly, so `slices.Sort([]time.Duration{...})` works.

### Q17. What does `cmp.Or` do?
**Short:** Returns the first non-zero argument; in chained comparators, returns the first non-zero compare result.

**Long:** Added in Go 1.22. Common use is tie-breaking sort comparators:
```go
cmp.Or(cmp.Compare(a.Age, b.Age), cmp.Compare(a.Name, b.Name))
```

### Q18. Difference between `slices.Sort` and `sort.Slice`?
**Short:** `slices.Sort` is generic, type-safe, NaN-aware, and faster. `sort.Slice` uses reflection.

**Long:** `slices.Sort` (1.21) requires `cmp.Ordered`. The comparator is inlinable, NaN-handled via `cmp.Compare`. `sort.Slice` predates generics, takes a function, and uses `reflect.Swapper`. Benchmarks show `slices.Sort` ~40% faster.

### Q19. Can `comparable` be embedded in a regular interface?
**Short:** Only as a constraint, not in a regular runtime interface.

**Long:** `type Hashable interface { comparable; Hash() uint64 }` is valid as a type-parameter constraint. Once you embed `comparable`, you cannot use the resulting interface as a runtime value (`var x Hashable = ...`) — the spec rejects it.

### Q20. What does "strictly comparable" mean?
**Short:** A type where `==` is **always** well-defined — no runtime panic possible.

**Long:** Strictly comparable types are non-interface types built only from strictly comparable parts. The Go 1.20 spec introduced this term to distinguish the older, narrower `comparable` from the new relaxed one. Interfaces are comparable but **not** strictly comparable.

---

## Senior 🔴

### Q21. Why might `Eq[any](a, b)` compile but panic?
**Short:** 1.20 lets `any` satisfy `comparable`, but if the dynamic type is uncomparable, `==` panics at runtime.

**Long:** `var x, y any = []int{1}, []int{1}; Eq(x, y)` compiles because `any` now passes the `comparable` check. At runtime, `==` on `any` recurses into the dynamic types — slices — and triggers `panic: runtime error: comparing uncomparable type []int`.

### Q22. How would you sort `[]float64` with NaN deterministically?
**Short:** Use `slices.Sort` (Go 1.21+) — it routes through `cmp.Compare` and places NaN deterministically.

**Long:** `slices.Sort` calls `cmp.Compare` internally, which defines NaN as less than every non-NaN. The result: NaN values cluster at the front. Pre-1.21, `sort.Float64s` had similar behavior, but `sort.Slice` with `<` did not.

### Q23. How do you sort `[]MyStruct` by a field?
**Short:**
```go
slices.SortFunc(s, func(a, b MyStruct) int {
    return cmp.Compare(a.Age, b.Age)
})
```

**Long:** `MyStruct` is not in `cmp.Ordered`. Use `slices.SortFunc` with a comparator built from `cmp.Compare`. This gives NaN-safety on float fields and chains nicely with `cmp.Or` for tie-breakers.

### Q24. When should you use `[T comparable]` vs `[T cmp.Ordered]`?
**Short:** `comparable` for keys/equality; `cmp.Ordered` for sorting/range/min-max.

**Long:** Loosest constraint that compiles. If your function only does `==`, use `comparable` and broaden the caller base. If it needs `<`, use `cmp.Ordered` and accept the narrower set of types.

### Q25. Why is `Set[T comparable]` cleaner than `Set[T any]`?
**Short:** It enforces map-key compatibility at compile time.

**Long:** `Set[T comparable]` rejects slice/map/func element types at compile time. `Set[T any]` would have to validate at runtime, or rely on the 1.20 relaxation and risk panics during `Add`.

### Q26. Can you write a generic `BST[T cmp.Ordered]`? What about for `time.Time`?
**Short:** `BST[T cmp.Ordered]` is straightforward; for `time.Time` you need a `BSTFunc[T any]` variant with a comparator.

**Long:** `time.Time` is a struct and is not in the `cmp.Ordered` set. Provide both `BST[T cmp.Ordered]` and `BSTFunc[T any](cmp func(T, T) int)`. This mirrors stdlib's `slices.Sort` / `slices.SortFunc` split.

### Q27. What is the runtime cost of `==` on a struct?
**Short:** O(field count). The compiler generates field-by-field equality.

**Long:** Comparing two `User{ID, Name, Email}` values means comparing `ID`, then `Name`, then `Email`. For string fields, that includes the string compare (length first, then bytes). Big structs with many string fields can have nontrivial equality cost in hot loops.

### Q28. Why is `comparable` predeclared but `cmp.Ordered` is in a package?
**Short:** `comparable` interacts with the type system (operators, map keys); `cmp.Ordered` is just a type-set declaration that the spec needed no syntax for.

**Long:** `comparable` had to be predeclared because the compiler treats it specially when checking `==`. `cmp.Ordered` is a normal interface — once interface type elements were available (1.18), `cmp.Ordered` is just a regular declaration that fits in stdlib.

### Q29. How do you handle two NaNs in deduplication?
**Short:** Either reject NaN before insertion, or hash to the bit pattern.

**Long:** Because `NaN != NaN`, a `Set[float64]` cannot deduplicate NaN naturally. Workarounds: convert via `math.Float64bits` to compare as bits, or filter out NaN before insertion. The bit-pattern approach treats different NaNs as distinct keys, which may or may not be what you want.

### Q30. Why is sorting `[]complex128` not directly possible with `slices.Sort`?
**Short:** Complex is not in `cmp.Ordered` — no operator `<` is defined.

**Long:** Use `slices.SortFunc` with a domain-specific comparator (magnitude, lexicographic, or argument). The choice is intentionally explicit.

---

## Expert 🟣

### Q31. Walk through what happens when `Set[any]` stores a slice.
**Short:** Compile passes (1.20+). At `Add`, `m[v] = struct{}{}` triggers a hash on `v`. The hash routine checks dynamic type — slice — and panics.

**Long:** `Set[any]` is `map[any]struct{}`. Inserting a `[]int` requires hashing the key. Go's runtime hash routine for `interface{}` looks at the dynamic type; for a slice, it panics with `runtime error: hash of unhashable type []int`. The 1.20 relaxation lets the constraint pass, but the runtime still rejects slice keys.

### Q32. How does `cmp.Compare` handle negative zero?
**Short:** `cmp.Compare(-0.0, 0.0) == 0` — they are equal in IEEE-754 and in `cmp.Compare`.

**Long:** Negative and positive zero are equal under `==` and under `cmp.Compare`. They are bit-distinct (`math.Float64bits` differs), but `Compare` uses arithmetic ordering, not bits. `slices.Sort` therefore treats them as equivalent.

### Q33. Could `cmp.Ordered` ever include complex?
**Short:** Not without an explicit ordering policy in the spec.

**Long:** The Go team has explicitly rejected this on grounds that complex order is context-dependent. A future proposal could introduce, say, magnitude-based ordering, but it would have to be a separate constraint (e.g., `cmp.OrderedComplex`) to avoid silently changing the meaning of existing code.

### Q34. What's the GC shape implication of `[T comparable]` over diverse pointer types?
**Short:** One stencil per pointer-shape class, each with its own equality dictionary. Equality goes through the dictionary, slightly slower than a direct compare.

**Long:** The compiler stencils the function once for "pointer-shaped" T. Inside, `==` resolves through a runtime dictionary that holds the type descriptor. For struct keys with deep equality, the dictionary call invokes the per-type equality routine. This is non-zero cost relative to a fully monomorphized direct compare.

### Q35. How would you constrain "any T that has a Compare method"?
**Short:**
```go
type Comparable[T any] interface {
    Compare(T) int
}
```

**Long:** This is a self-referential generic interface. Used by some priority-queue libraries: `func PQ[T Comparable[T]] struct{...}`. Note the recursive `T`: the method takes a `T` and returns an int.

### Q36. Why is `cmp.Or` typed `[T comparable]` and not `[T any]`?
**Short:** Because it compares values to the zero value with `==`.

**Long:** `cmp.Or(a, b, c)` returns the first non-zero. Detecting "non-zero" requires `==`, which requires `comparable`. If the type were `any`, `==` would not be allowed inside the body.

### Q37. Could you implement `cmp.Compare` yourself for `T cmp.Ordered`?
**Short:** Yes — but the float NaN handling is tricky. Use a NaN check and return values explicitly.

**Long:**
```go
func MyCompare[T cmp.Ordered](x, y T) int {
    xNaN := isNaN(x)
    yNaN := isNaN(y)
    if xNaN && yNaN { return 0 }
    if xNaN { return -1 }
    if yNaN { return 1 }
    if x < y { return -1 }
    if x > y { return 1 }
    return 0
}
```
Detecting NaN inside generic code requires a type switch on `any(x)` or runtime checks — adding complexity.

### Q38. Compare `comparable` to Java's `equals`.
**Short:** `comparable` is structural and defined by Go's `==`; Java's `equals` is method-based and overrideable.

**Long:** Go's equality is fixed by the type — you cannot override `==` for your own type. Java's `equals` is a method on `Object` that classes override. Generics in both languages constrain on this notion: Go's `comparable`, Java's `Comparable<T>` (which is actually closer to `cmp.Ordered`).

### Q39. How does `cmp.Ordered` interact with profile-guided optimization?
**Short:** PGO can devirtualize hot calls into stenciled bodies, making generic Ordered code as fast as hand-written.

**Long:** From Go 1.21, PGO data lets the compiler specialize generic functions for the most common type at hot call sites. A `Min[float64]` called millions of times can be inlined as if it were a hand-written `MinFloat64`. The dictionary indirection drops out for the hot path.

### Q40. What surprises do `comparable` and `cmp.Ordered` introduce in `pprof`?
**Short:** Generic functions appear with shape suffixes like `[go.shape.int_0]`. Equality calls show up as runtime helpers on slow paths.

**Long:** `pprof` flame graphs label stenciled bodies with their GC shape, helping you see which instantiations are hot. For `comparable` on diverse pointer-shapes, you may see `runtime.efaceeq` or `runtime.memequal` attribute small slices of CPU time. These are the equality dictionary calls.

---

## Summary

The most common interview themes around `comparable` and `cmp.Ordered`:

- The 1.20 relaxation: interfaces now satisfy `comparable`, with runtime panic risk
- The 1.21 promotion: `cmp.Ordered` and `cmp.Compare` move to stdlib
- NaN handling: operators are NaN-blind, `cmp.Compare` is NaN-aware
- Why complex is excluded from `cmp.Ordered`
- `~int` and friends: domain types ride free
- Choosing the smallest constraint: `any` → `comparable` → `cmp.Ordered`
- Strict vs relaxed comparability
- Sorting structs via `slices.SortFunc` + `cmp.Compare` + `cmp.Or`

A confident candidate explains **the design rationale** (why complex is out, why NaN is a problem, why 1.20 changed the rule) — not just the syntax.
