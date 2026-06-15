# `min`, `max` & `clear` Built-ins — Interview Questions

> Practice questions ranging from junior to staff-level. Each has a model answer, common wrong answers, and follow-up probes.

---

## Junior

### Q1. What do `min`, `max`, and `clear` do, and when were they added?

**Model answer.** They are predeclared built-in functions added in Go 1.21. `min` and `max` take one or more arguments of any ordered type (integers, floats, strings) and return the smallest or largest, with the same type as the arguments. `clear` takes a map or a slice: on a map it deletes all entries; on a slice it sets every element to the zero value without changing length or capacity. None of them require an import — they are predeclared like `len` and `append`.

**Common wrong answers.**
- "They're in the `math` package." (No — `min`/`max` are built-ins; `math.Min`/`math.Max` are different functions.)
- "`clear(s)` makes the slice empty (length 0)." (No — it zeroes elements; length is unchanged.)
- "They work on slices like `max(s...)`." (No — they take fixed arguments, not a spread slice.)

**Follow-up.** *What Go version do you need?* — 1.21+, and the `go` directive in `go.mod` must be `1.21` or higher.

---

### Q2. What does `clear` do to a slice versus a map?

**Model answer.** On a **map**, `clear(m)` deletes every entry, leaving an empty but reusable map (`len(m) == 0`). On a **slice**, `clear(s)` sets each element in `s[0:len(s)]` to its zero value; the length and capacity are unchanged. So "map: remove everything; slice: zero everything, keep the length."

**Common wrong answer.** "Both make the thing empty." (Only the map becomes empty; the slice keeps its length with zeroed elements.)

**Follow-up.** *How do you actually empty a slice keeping its capacity?* — `s = s[:0]`. That is a different operation from `clear`.

---

### Q3. How do you find the largest element of a slice?

**Model answer.** Not with `max` — the built-ins are not slice-aware. Use `slices.Max(s)` from the `slices` package (Go 1.21). `max(s...)` does not compile. `max` is for a fixed set of values like `max(a, b, c)`.

**Follow-up.** *What does `slices.Max` do on an empty slice?* — It panics. The built-in `max` requires at least one argument at compile time.

---

### Q4. Why are `min`/`max` built-ins instead of functions in a package?

**Model answer.** Three reasons. (1) They can be evaluated at compile time when their arguments are constants, so `min(64, 128)` can be an array size — a function call cannot. (2) They are variadic over any fixed count with no slice allocation: `max(a, b, c, d)` costs nothing extra. (3) They are universal enough that requiring an import (and choosing which package) was friction, so the language gives one canonical spelling.

**Follow-up.** *Could you write `max` as a generic function?* — Yes, `func Max[T cmp.Ordered](a, b T) T`, but it cannot fold to a constant and a variadic version allocates.

---

### Q5. What does `max(2.0, math.NaN())` return?

**Model answer.** `NaN`. If any argument is a NaN, the result is a NaN. The built-ins propagate NaN; they do not skip it. The same applies to `min`.

**Common wrong answer.** "2.0, because NaN isn't a real number." (No — NaN poisons the result.)

**Follow-up.** *What if you want to ignore NaN?* — Filter NaN values out before calling `min`/`max`.

---

## Middle

### Q6. Why can `clear` remove a NaN map key when `delete` cannot?

**Model answer.** `delete(m, k)` must *find* the key by lookup, and a NaN key never compares equal to anything — including itself (`NaN != NaN`) — so the lookup never matches and nothing is deleted. The key is stuck. `clear(m)` empties the map at the runtime level by walking its structure, so it removes every entry including unreachable NaN keys. This correctness fix is a primary reason `clear` exists as a built-in.

**Follow-up.** *Before `clear`, how did people empty such a map?* — They had to allocate a new one: `m = make(...)`, losing the backing storage and breaking any aliases.

---

### Q7. What is the difference between `clear(s)`, `s = s[:0]`, and `s = nil`?

**Model answer.**
- `clear(s)` zeroes every element across `len(s)`; length and capacity unchanged.
- `s = s[:0]` sets length to 0 but keeps the backing array (and its old data, including references) and the capacity.
- `s = nil` discards the slice entirely; length and capacity both 0, backing array eligible for GC.

For a slice of pointers, `s = s[:0]` alone leaks: the backing array still references the old objects. Clear first (`clear(s)`) to drop references, then truncate.

**Follow-up.** *How do you zero the entire backing array, not just `len(s)`?* — `clear(s[:cap(s)])`.

---

### Q8. How does `max` behave with mixed argument types?

**Model answer.** All arguments must combine to a single ordered type under the usual operand rules. Untyped constants adapt: `max(1, 2.0)` is fine (result `float64`). But two distinct *typed* operands do not mix: `max(intVar, floatVar)` is a compile error; you must convert one side. And an untyped constant must be representable in a typed operand: `max(intVar, 3.5)` fails because `3.5` is not an `int`.

**Follow-up.** *What's the result type of `max(Celsius(1), Celsius(2))`?* — `Celsius`. Named types are preserved.

---

### Q9. When is a `min`/`max` expression a compile-time constant?

**Model answer.** When every argument is a constant. Then the result is a constant, computed at compile time, and usable in constant contexts — array sizes, `const` declarations. `const C = max(10, 20)` gives `C == 20`; `var a [min(4, 8)]int` is a `[4]int`. The moment any argument is a variable, the expression is a runtime value and cannot appear where a constant is required.

**Follow-up.** *Can constant float `min`/`max` involve NaN?* — No, because NaN is not a constant expression (`math.NaN()` is a function call). NaN is purely a runtime concern.

---

### Q10. How do the built-ins differ from `math.Min` / `math.Max`?

**Model answer.** `math.Min`/`math.Max` are `float64`-only library functions with documented IEEE-754 special cases. The built-ins are generic over all ordered types, allocate nothing, and fold to constants. The Go docs explicitly note the built-in `max`/`min` *differs* from `math.Max`/`math.Min` for the NaN-and-infinity cases — the math functions follow a strict IEEE `maxNum`/`minNum` intent. Use the built-ins in new code; reserve `math.Min`/`math.Max` for when you need their exact documented behaviour or are maintaining float-only code.

**Common wrong answer.** "They're the same thing." (They differ in types accepted and in NaN/infinity corner cases.)

**Follow-up.** *Does `math.Max(a, b)` compile on two ints?* — No, it wants `float64`. `max(a, b)` does.

---

### Q11. Is `clear` on a nil map or nil slice safe?

**Model answer.** Yes, both are safe no-ops — no panic. This contrasts with *writing* to a nil map (`m[k] = v`), which panics. `clear(nilMap)` and `clear(nilSlice)` simply do nothing.

**Follow-up.** *Does `clear(arr)` work on an array?* — No, `clear` wants a map or slice. Slice the array first: `clear(arr[:])`.

---

### Q12. Can you use `min`/`max`/`clear` inside generic functions?

**Model answer.** Yes. `min`/`max` compose with a `cmp.Ordered`-constrained type parameter: `func Clamp[T cmp.Ordered](x, lo, hi T) T { return min(max(x, lo), hi) }`. `clear` works on a type parameter whose type set is slices or maps: `func Reset[S ~[]E, E any](s S) { clear(s) }`. They add no dictionary or instantiation cost beyond the inlined operation. This is how the standard `slices`/`maps` packages use them internally.

**Follow-up.** *What is `cmp.Ordered`?* — The Go 1.21 standard constraint for any ordered type, matching exactly the types `min`/`max` accept.

---

## Senior

### Q13. You see `running = max(running, x)` in a loop over floats and the result is NaN. What happened?

**Model answer.** A NaN reached the reduction. Because `max` propagates NaN, once any `x` is NaN, `running` becomes NaN and stays NaN for every subsequent iteration — the reduction is poisoned. This is the fail-loud behaviour the language chose deliberately, so corruption is visible rather than silently producing the largest non-NaN value. The fix is to filter NaN before reducing, or to validate the input data. The bug is in trusting unvalidated float input, not in `max`.

**Follow-up.** *Would `math.Max` behave differently?* — No, `math.Max(x, NaN)` is also NaN. Neither skips NaN.

---

### Q14. When should you `clear` and reuse a map versus reallocate it?

**Model answer.** `clear(m)` retains the map's backing buckets and is cheap to refill — good for hot loops where the map stays a similar size, avoiding per-iteration allocation. But `clear` costs O(bucket count), and a map that once grew huge keeps its oversized bucket array after `clear`. If a map ballooned to millions of entries and is now small, `m = make(...)` is both faster (no walk of huge buckets) and sheds the wasted memory. The rule: clear-and-reuse for stable sizes; reallocate to release a one-time-huge map. Profile rather than assume.

**Follow-up.** *Same trade-off for slices?* — Less stark, but a slice that grew to a huge capacity and is now small wastes the backing array; `s = make(...)` sheds it, while `clear(s)`/`s = s[:0]` retains it.

---

### Q15. How would you migrate a codebase off hand-rolled `maxInt`/`minInt` helpers?

**Model answer.** First bump all modules to `go 1.21`+. Then mechanize the integer call sites — `maxInt(a, b)` → `max(a, b)` is a semantics-preserving rewrite, doable with `gofmt -r` or `eg`. Audit float helpers individually: a `maxF` built on `if a > b` matches the built-in, but one built on `math.Max` may differ on NaN/signed zero, so confirm the data can't be NaN or preserve `math.Max` deliberately. Replace `delete`-loops with `clear`, flagging any `map[float64]V` for the NaN-key correctness fix. Run tests, delete the dead helpers (a `deadcode`/`unused` linter confirms), and add a lint rule preventing the helpers from creeping back.

**Follow-up.** *Where's the risk concentrated?* — In floats. Integer and string migrations are mechanical and safe.

---

### Q16. Why did the language add three built-ins rather than library functions, given the compatibility cost?

**Model answer.** Two of them require capabilities only a built-in has. `min`/`max` must be built-ins to fold to compile-time constants (so they can size arrays and appear in `const` blocks) and to be variadic without allocating a slice. `clear` must be a built-in because emptying a map including its unreachable NaN keys — and bulk-zeroing a slice in place with GC cooperation — cannot be written in pure Go with the same guarantees. The compatibility cost was bounded because predeclared identifiers can be shadowed: existing code that used `min`/`max`/`clear` as ordinary names still works.

**Follow-up.** *What's the shadowing mechanism?* — A local or package-level declaration of `max` wins over the built-in within its scope.

---

### Q17. A reviewer changed `max(a, b)` to `math.Max(a, b)` on two floats "to be explicit." Is that correct?

**Model answer.** It is risky. `math.Max` is `float64`-only (so it breaks if `a`/`b` were ever non-`float64`), does not fold to constants, and has IEEE special cases the docs say *differ* from the built-in for NaN-and-infinity. Unless the code specifically needs `math.Max`'s documented behaviour, the change adds a subtle semantic shift and removes constant-folding and type generality. The built-in is the right default; revert the change unless there's a stated IEEE requirement.

**Follow-up.** *When is `math.Max` genuinely the right call?* — When you need its exact IEEE `maxNum`-style behaviour, or you're maintaining float-only code already built around it.

---

### Q18. Explain the reference-leak pattern involving slices and how `clear` fixes it.

**Model answer.** A `[]*T` (or `[]string`, `[]any`) truncated with `s = s[:0]` keeps its backing array, which still holds the old pointers — so the referenced objects stay reachable and the GC cannot reclaim them. In a pooled or long-lived slice this is a memory leak. `clear(s)` zeroes the `len(s)` range, dropping those references so the GC can collect what they pointed at. The correct release sequence for a pooled pointer slice is `clear(s)` then `pool.Put(s[:0])`. If references can live in the capacity region too, use `clear(s[:cap(s)])`.

**Follow-up.** *Does this matter for `[]int`?* — No. Pointer-free elements hold no references, so truncation alone leaks nothing live.

---

## Staff / Architect

### Q19. How do `min`/`max` lower in the compiler, and why is the float case different?

**Model answer.** A multi-argument `max(a, b, c)` is a compile-time-unrolled left-fold of two-argument operations, each lowering to a comparison feeding a conditional select — inlined, no call, no allocation. For integers and strings that's the whole story. Floats are different because a naive `x > y ? x : y` violates the spec: IEEE comparisons make `NaN > y` false, so the naive select would drop the NaN instead of propagating it, and `-0.0 > 0.0` is false with `-0.0 == 0.0` true, so the select can't distinguish signed zeros. The compiler therefore emits extra instructions — a NaN check forcing a NaN result, plus signed-zero disambiguation — because the hardware `MINSD`/`MAXSD` instructions alone don't match Go's semantics. The variadic count must be static, which is why you can't spread a slice into `max`.

**Follow-up.** *What does `clear` lower to?* — `runtime.mapclear` for maps; `memclrNoHeapPointers` or `memclrHasPointers` for slices depending on whether the element type has pointers.

---

### Q20. Design the NaN policy for a public reduce-floats API built on these built-ins.

**Model answer.** Decide explicitly among three policies and document the choice. (1) **Poison** — let NaN propagate; simplest, fail-loud, surfaces bad data. (2) **Filter** — skip NaN values before reducing; convenient but hides data quality issues, so log or count skips. (3) **Error** — return an error if any input is NaN; strictest, good for validated pipelines. The wrong move is leaving it implicit, because callers will be surprised by poisoning. For a numeric library I'd default to error-or-filter at the public boundary with a documented contract, and use the raw built-ins (poison) internally where inputs are already validated. Also validate `lo <= hi` in any clamp helper, since `clamp(x, 10, 5)` silently produces nonsense.

**Follow-up.** *Where do signed zeros fit?* — Rarely material, but if your API distinguishes `+0`/`-0` (e.g. financial sign semantics) document that `min`/`max` order `-0 < +0`.

---

### Q21. How do you keep the codebase from regressing back to hand-rolled helpers and `math.Max`?

**Model answer.** Tooling plus convention. Add a `staticcheck`/custom-analyzer rule that flags new `maxInt`/`minInt` definitions and `delete`-loops that empty whole maps (suggest `clear`). Add a lint rule or review checklist item that flags new `math.Max`/`math.Min` in non-float-legacy code, requiring a justification comment for the IEEE behaviour. Provide a shared `cmp.Ordered` clamp helper so people don't re-roll it. Enforce `go 1.21`+ in `go.mod` across modules so the built-ins are always available. In review, treat `clear(s)` where length-0 is expected, and `s = s[:0]` on pointer slices without a preceding `clear`, as standard findings.

**Follow-up.** *How do you mechanize the one-time migration?* — `gofmt -r`/`eg` rewrite rules for the mechanical integer/string cases; manual audit for floats.

---

### Q22. What are the performance characteristics you'd cite when deciding whether to use these built-ins in a hot path?

**Model answer.** `min`/`max` on integers/strings are inlined compare-and-select — effectively free, no allocation, no call. On floats they carry a few extra instructions for NaN/signed-zero handling but are still call- and allocation-free. Constant `min`/`max` cost zero (folded). `clear(m)` is O(bucket count) via `runtime.mapclear` and retains storage — cheap to reuse for stable sizes, wasteful for one-time-huge maps. `clear(s)` is a vectorized `memclr` for pointer-free elements and a GC-aware clear for pointer elements — typically the fastest correct way to zero a slice, and one the compiler also produces from the recognized `for i := range s { s[i] = 0 }` memclr idiom. The benchmarking pitfall: passing constants to `min`/`max` folds the call away, so you must use variable inputs and consume the result to measure anything.

**Follow-up.** *When does `clear`-and-reuse lose to reallocation?* — When the map/slice grew very large once and now stays small; reallocation sheds the oversized backing storage.

---

## Quick-fire

| Q | Crisp answer |
|---|--------------|
| Added in which Go version? | 1.21. |
| Need an import? | No — predeclared. |
| `max(slice...)`? | Does not compile; use `slices.Max`. |
| `clear(s)` length after? | Unchanged; elements zeroed. |
| `clear(m)` length after? | 0. |
| `max(x, NaN)`? | NaN (propagates). |
| Remove a NaN map key? | `clear` — `delete` can't. |
| `clear(nilMap)`? | Safe no-op. |
| Same as `math.Max`? | No — different types and NaN/Inf rules. |
| Constant-foldable? | Yes, if all args constant. |

---

## Mock Interview Pacing

A 30-minute interview on these built-ins might cover:

- 0–5 min: warm-up — Q1, Q2, Q3.
- 5–15 min: middle topics — Q6, Q7, Q9, Q10.
- 15–25 min: a senior scenario — Q13 (NaN poisoning), Q14 (clear vs reallocate), or Q18 (reference leak).
- 25–30 min: a curveball — Q19 (lowering) or Q20 (NaN policy design).

If the candidate claims hands-on Go 1.21 experience, drive straight to Q6 (NaN keys) and Q7 (`clear` vs `s[:0]`) — both are field-test questions that separate readers from users. A staff candidate should reach the lowering question (Q19) and articulate why float `min`/`max` differs from integer, and should treat `math.Max` vs the built-in (Q17) precisely rather than as interchangeable.
