# Generic Performance — Interview Q&A

## How to use this file

Each question has a **short answer** for memorization and a **long answer** for understanding. Practice both. In a real interview, lead with the short version.

Difficulty:
- 🟢 Beginner
- 🟡 Mid-level
- 🔴 Senior
- 🟣 Expert

---

## Beginner 🟢

### Q1. Does Go monomorphize generics like C++?
**Short:** No. Go uses GC shape stenciling with a runtime dictionary.

**Long:** C++ creates a fully specialised body per type. Go groups types by GC shape (memory layout) and emits one body per shape, then passes a per-type dictionary at runtime. This keeps binaries small at the cost of some indirection.

### Q2. Are generics free at runtime in Go?
**Short:** Mostly yes for numeric types, slightly costly for pointer-shaped types.

**Long:** Numeric generics often inline cleanly and match hand-written speed. Pointer-shaped generics share a stencil and pay a dictionary cost on operations that depend on the concrete type.

### Q3. Are generics faster than `interface{}`?
**Short:** Almost always.

**Long:** `interface{}` requires boxing values into a `(type, data)` pair, often allocating on the heap. Generics avoid boxing and skip type assertions. The savings are typically 10-30× on hot paths.

### Q4. What is a GC shape?
**Short:** The set of properties (size, pointer pattern, alignment) the GC needs to walk a value.

**Long:** Two types share a GC shape if they look identical to the garbage collector. All `*T` types share one shape because they are one pointer-sized word. `int` and `int64` share an 8-byte scalar shape on 64-bit systems.

### Q5. What is a dictionary in Go generics?
**Short:** A hidden runtime structure passed to a generic function with the type-specific bits.

**Long:** It contains the type descriptor, equality function, hash function, and method tables for the concrete type used at the call site. The stencil body looks up these when it needs them.

### Q6. What does `pprof` show for a generic function?
**Short:** Stencil-mangled names like `pkg.Func[go.shape.int_0]`.

**Long:** Each shape gets its own profile entry. You read them as separate hot paths even when they share the same source function.

### Q7. Does `slices.Sort` outperform `sort.Slice`?
**Short:** Yes, typically 30-40%.

**Long:** `slices.Sort` is generic so the comparator inlines into the partition step. `sort.Slice` uses reflection and indirect comparator calls.

### Q8. Where can a generic value escape to the heap?
**Short:** When the compiler cannot prove stack-safety for all instantiations of a shape.

**Long:** Escape analysis must be conservative across all types sharing a stencil. If one possible type forces an escape, all instantiations pay it.

### Q9. What flag shows compiler escape and inlining decisions?
**Short:** `-gcflags="-m"`.

**Long:** Pass it to `go build` or `go test` to see per-line decisions. Use `-m=2` for more detail.

### Q10. Are `any` and `interface{}` performance-equivalent?
**Short:** Yes — `any` is just an alias for `interface{}`.

**Long:** Both produce identical machine code. `any` is the Go 1.18+ readability change.

---

## Mid-level 🟡

### Q11. Why do pointer-shaped generics share a single stencil?
**Short:** Because the GC sees them all as one pointer-sized word with a pointer bit set.

**Long:** Sharing is a deliberate compiler choice to keep binary size small. The trade-off is that operations dependent on the concrete pointer type (equality, hashing) must consult the dictionary.

### Q12. Is `Sum[int]` over a million ints as fast as a hand-written `sumInts`?
**Short:** Typically yes — within 1-2%.

**Long:** Numeric types have unique shapes; the body inlines; arithmetic is recognised as primitive. The compiler often produces identical machine code for both versions.

### Q13. Why might a generic `Find[T comparable]` be slower than a hand-written `findFoo`?
**Short:** `==` goes through the dictionary when multiple shapes share the stencil.

**Long:** When the function is instantiated for many distinct pointer-shaped types, the compiler cannot devirtualize the equality call. Hand-rolling the function for the specific type lets the compiler inline `==` directly.

### Q14. What is escape analysis and how do generics affect it?
**Short:** The pass that decides whether a value lives on stack or heap. Generics sometimes force values to the heap because the analysis is conservative across shapes.

**Long:** A generic body must be safe for every type sharing its shape. If even one type would force an escape (e.g., interface conversion, taking an address), all instantiations may allocate.

### Q15. How do you measure generic performance in Go?
**Short:** `go test -bench=. -benchmem` plus `pprof`.

**Long:** Use `testing.B` for microbenchmarks. Pass `-benchmem` for allocations. Use `runtime/pprof` or `net/http/pprof` for production-level profiling. `benchstat` compares before/after.

### Q16. What is PGO and how does it help generics?
**Short:** Profile-guided optimization (Go 1.21+) lets the compiler devirtualize and inline using a runtime profile.

**Long:** With PGO, the compiler can specialise hot generic call sites for the dominant type observed in the profile. Reported gains are typically 2-5% on services with generic-heavy hot paths.

### Q17. Why is `slices.SortFunc` faster than `sort.Slice`?
**Short:** The comparator inlines into the sort body; no reflection is used.

**Long:** `sort.Slice` uses runtime reflection to swap elements and calls the comparator indirectly. `slices.SortFunc` knows the type at compile time, so the swap is direct and the comparator can be inlined.

### Q18. When is migrating from `interface{}` to generics a measurable win?
**Short:** Whenever the old code boxes primitives or runs type assertions on hot paths.

**Long:** Containers, caches, queues, message channels with primitive payloads — any place where boxing was the bottleneck. Cold paths and rarely-called helpers see no measurable change.

### Q19. What is a stencil in Go generics?
**Short:** The shared body emitted per GC shape.

**Long:** The compiler emits one machine-code body per shape, parameterised by a runtime dictionary. All concrete types matching that shape call into the same body.

### Q20. Does `comparable` cost more than `==` on a concrete type?
**Short:** Sometimes — when the dictionary is consulted.

**Long:** For primitives, `==` reduces to a single CPU instruction whether or not the type is generic. For struct types shared across stencils, equality goes through a dictionary function pointer, which is slower than direct compare.

---

## Senior 🔴

### Q21. How do you know if a generic call is inlined?
**Short:** `go build -gcflags="-m=2"` — look for `inlining call to F[...]`.

**Long:** The compiler reports inlining decisions per line. If you see `cannot inline ...`, the dictionary cost stays. Use `-m=2` for more detail. The `dwarf` debug data in the binary also tracks inlining.

### Q22. Walk through what happens at runtime when you call `Find[*User](users, target)`.
**Short:** Pick the pointer-shape stencil, pass the `*User` dictionary, run the body.

**Long:** The compiler emits a static dictionary describing `*User` (type descriptor, equality function for `*User`). At the call site, this dictionary's address is loaded and passed as a hidden first argument. The body uses it to perform pointer comparisons. If the function is hot and seen at one site only, the compiler may devirtualize the equality call into a direct one.

### Q23. Why might generics make a hot path **slower** than `interface{}`?
**Short:** When every operation hits a cold dictionary slot and `interface{}`'s v-table happens to be cache-warmer.

**Long:** Rare in practice but possible. If the generic spans many distinct pointer-shaped types (10+), each per-iteration call may cause a TLB or cache miss on a different dictionary. The interface version, using a single v-table per type, can be more predictable. Always benchmark.

### Q24. How does Go's strategy compare to Rust's?
**Short:** Rust monomorphizes per type; Go stencils per shape with a runtime dictionary.

**Long:** Rust's approach yields zero-overhead generics at the cost of binary bloat. Go's approach trades a small runtime indirection for substantially smaller binaries. For numeric loops the speed is similar; for highly polymorphic code Rust pulls ahead in raw speed and Go pulls ahead in binary size.

### Q25. What does PGO actually do for generic devirtualization?
**Short:** Specialises hot generic call sites for the dominant type observed in the profile.

**Long:** The compiler reads the profile, identifies generic call sites where one type accounts for ≥X% of calls, and emits a fast path that bypasses the dictionary for that type. Falls back to the generic body for other types.

### Q26. How would you decide between concrete, generic, or specialized generic code?
**Short:** Concrete on hot single-type paths; generic on convenience helpers; specialized when you need both.

**Long:** Apply a decision tree. (1) Is this hot? (2) How many concrete types use it? (3) Are the types pointer-shaped? Choose concrete for hot single-type, generic for cold or low-shape-diversity, specialized wrappers for hot multi-shape.

### Q27. Why might a generic increase binary size more than expected?
**Short:** Many distinct GC shapes — particularly diverse struct layouts.

**Long:** Sharing is per shape, not per type. Two struct types with identical layouts share. Two with different field counts or pointer patterns do not. A library used with many distinct struct shapes inflates the stencil count.

### Q28. How does the compiler decide whether to devirtualize a dictionary call?
**Short:** When it can prove the concrete type at the call site, often via inlining or PGO.

**Long:** Static analysis follows variable types; a single-instantiation call is a simple case. PGO supplies hints from production profiles. If neither identifies the type, the indirect call stays.

### Q29. What is the binary impact of GC shape stenciling vs full monomorphization?
**Short:** Stenciling produces sub-linear growth; monomorphization produces linear growth in number of types.

**Long:** Empirically, Go binaries with heavy generics grow 0.5-2% over a non-generic baseline. C++ template binaries can grow 50%+ for the same logical code. Stenciling is the primary reason Go binaries stay small.

### Q30. What information should a benchmark of a generic function include?
**Short:** ns/op, B/op, allocs/op, input size, Go version, hardware.

**Long:** Include enough metadata that the result is reproducible: the Go release, CPU architecture, input size, whether `b.ResetTimer` was called. Compare to a hand-written baseline. Run with `-count=10` for stability.

---

## Expert 🟣

### Q31. Could the compiler emit a per-type stencil for hot generics in the future?
**Short:** Yes — PGO already does some of this; the team has discussed an opt-in flag.

**Long:** PGO can specialise hot call sites today. A future Go release may add a build-time annotation (e.g., `//go:specialize`) to force per-type stenciling for selected functions. The cost is binary size, so the team has been cautious.

### Q32. How does the dictionary handle a generic calling another generic?
**Short:** Sub-dictionaries — one nested per inner generic call.

**Long:** A dictionary may contain pointers to sub-dictionaries used by inner generic calls. The compiler computes the closure of dictionaries needed and emits them as a connected static structure.

### Q33. Why does `==` on a generic interface type sometimes panic at runtime?
**Short:** Because `comparable` (since 1.20) accepts interface types whose dynamic values may not be comparable.

**Long:** Pre-1.20, `comparable` excluded interface types. Post-1.20, you can use interface types but `==` may panic if the dynamic types contain slices, maps, or functions. The compiler accepts the code; the runtime checks at comparison time.

### Q34. What is the cost difference between `runtime.mapaccess2` and `runtime.mapaccess2_fast64`?
**Short:** The fast variant skips a hash function call when the key is a 64-bit integer; saves a few ns/op.

**Long:** Generic maps over `[K comparable]` reach the fast variant only when `K` is exactly the right shape. For pointer-shape keys the slow path is used.

### Q35. How can you force a dictionary call to disappear in your code?
**Short:** Inline the body manually, use a non-generic wrapper, or arrange a single-instantiation call site.

**Long:** Three techniques: (1) write a non-generic wrapper for the hot type; (2) ensure the generic is called from one site only — the compiler is more aggressive at devirtualization; (3) use PGO to drive specialization.

### Q36. What does `go.shape.string` mean exactly?
**Short:** The shape category for `string` and other 16-byte structs containing a pointer + length.

**Long:** A `string` is `(ptr, len)` — pointer-shaped because its first word is a pointer. Slice headers (`[]T`) and `string` happen to share this shape category.

### Q37. Why is the dictionary passed implicitly rather than explicitly?
**Short:** ABI compatibility and ergonomics.

**Long:** An explicit dictionary parameter would change function signatures and make function-pointer types incompatible with non-generic equivalents. The Go team chose an implicit passing convention so that `var f = SomeGeneric[int]` produces a normal function value.

### Q38. How do generics interact with assembly code?
**Short:** Generic functions cannot be implemented in assembly directly — but they can call assembly helpers.

**Long:** The Go assembler does not understand stencils. The workaround is to write a non-generic assembly function and have the generic code call it. This is the pattern used in `crypto/internal` and similar packages.

### Q39. Can you reduce dictionary cost by ordering type parameters?
**Short:** No — the order does not affect runtime cost, only readability.

**Long:** The dictionary is keyed by the combination of types, not the order of parameters. Reordering for readability is fine; for performance it is irrelevant.

### Q40. How would you write a CI check that fails when a generic function regresses?
**Short:** Run `go test -bench` with `-count`, capture into a file, compare with `benchstat`, fail if delta exceeds threshold.

**Long:** Use a baseline file checked into the repository (or computed from `main`). Run `benchstat` between baseline and PR. Fail if any benchmark crosses a configurable threshold (e.g., +5%). Many teams pair this with a pprof regression check on a canary deploy.

---

## Summary

Memorize the **short answers** for fluency. Practice the **long answers** for depth. The most common interview themes are:

- GC shape stenciling vs monomorphization vs erasure
- Dictionary cost on pointer-shape generics
- `slices.Sort` outperforming `sort.Slice`
- When generics are slower than `interface{}` (rare cases)
- Tooling: `pprof`, `-gcflags=-m`, PGO
- Migration strategies and CI gating

A confident candidate explains **the trade-offs**, not just the syntax. They cite the design documents, name the tooling, and reach for benchmarks before opinions.
