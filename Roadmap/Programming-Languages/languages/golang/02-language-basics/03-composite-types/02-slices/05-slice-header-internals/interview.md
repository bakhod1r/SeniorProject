# Slice Header Internals — Interview Questions

A set of interview-style questions on Go's slice header — its layout, semantics, and the operations that produce or consume one. Concise but complete answers; depth where it matters.

---

## Q1. What are the three fields of a Go slice header?

`Data unsafe.Pointer` (points at the first element of the visible region of the backing array), `Len int` (number of accessible elements), `Cap int` (size of the backing array from `Data` onward). On 64-bit machines, the header is 24 bytes.

---

## Q2. Is a slice a value type or a reference type?

A slice **value** is the three-word header, which is a value type — passed by value, copied on assignment. But the `Data` field is a pointer into a shared backing array. So while the header itself is a value, the elements it references are shared. This dual nature is the source of most slice-related confusion.

---

## Q3. What happens when you pass a slice to a function?

The caller's three-word header is copied onto the callee's stack (or into registers under the register-based ABI). The callee gets its own header but with the same `Data` pointer. Reading and writing elements goes through `Data` and is visible to the caller. Reassigning the callee's header (`s = ...`) does not affect the caller.

---

## Q4. Why can `s[i:j]` allow `j` to exceed `len(s)`?

Because slicing is bounded by `cap`, not `len`. The expression produces a header `{Data + i*sizeof(T), j - i, cap(s) - i}`. The constraint is `0 <= i <= j <= cap(s)`. This permits "reading ahead" into pre-allocated capacity.

---

## Q5. What is the full slice expression and why does it exist?

`s[i:j:k]` produces a header with `Cap = k - i` (in addition to `Len = j - i` and `Data + i`). It exists to bound the recipient's `append` damage: by capping `Cap` to the visible length, you force any `append` by the caller to allocate fresh memory rather than overwrite cells beyond your slice that belong to the original backing array.

---

## Q6. What does `append` return and why must you assign it back?

`append` returns a slice header. If the input had spare capacity, the returned header may have the same `Data` and a larger `Len`. If not, it points to a new backing array. Either way, the input header is *not* updated in place — Go pass-by-value semantics make that impossible. So `s = append(s, x)`.

---

## Q7. What's the difference between `var s []int` and `s := []int{}`?

The first is `nil`: `s.Data == nil, Len == 0, Cap == 0`. The second is non-nil but empty: `s.Data` points to an allocated zero-length array, `Len == 0, Cap == 0`. They behave identically for `len`, `cap`, `range`, and `append`, but differ in `s == nil` comparison, `reflect.DeepEqual`, and JSON marshalling (`null` vs `[]`).

---

## Q8. Can you compare two slices with `==`?

No — only to `nil`. The spec forbids `==` between slice values because there is no obvious efficient definition (header equality is one thing, element equality another). Use `slices.Equal(a, b)` (Go 1.21) or `bytes.Equal(a, b)` for `[]byte`.

---

## Q9. What is the typed-nil interface pitfall with slices?

```go
var s []int            // nil slice
var i any = s
fmt.Println(i == nil)  // false
```

When the slice is wrapped in an interface, the interface header carries the type (`[]int`) plus the slice header (whose Data is nil). The interface is *not* nil because its type word is non-nil — even though the slice value is nil. Returning a typed-nil slice from a function that declares an interface return is a common bug source.

---

## Q10. Why does mutating a slice in a function sometimes affect the caller and sometimes not?

Element writes (`s[i] = x`) affect the caller because they go through `Data`, which is shared. Header rewrites (`s = newSlice`, `s = append(s, x)` if it grew, `s = s[:0]`) do not affect the caller because the callee's header is its own copy. If the callee needs to modify the caller's header, the caller must pass `*[]T`.

---

## Q11. Two slices have `&s1[0] == &s2[0]`. Are they the same slice?

They share the same backing-array starting address. They are not necessarily the same slice value: they may have different `Len` and/or `Cap`. They are guaranteed to share at least the first element.

---

## Q12. What does this print?

```go
s := []int{1, 2, 3, 4, 5}
t := s[1:3]
t = append(t, 99)
fmt.Println(s)
```

`[1 2 3 99 5]`. The `append` has spare capacity (`cap(t) == cap(s) - 1 == 4`, `len(t) == 2`), so it writes the 99 into `s[3]`. `t` now sees `[2, 3, 99]`, but `s[3]` was overwritten.

---

## Q13. How would you produce a slice that doesn't alias its source's backing array?

`slices.Clone(s)` (Go 1.21+), or `append([]T(nil), s...)`, or `make([]T, len(s))` followed by `copy(...)`. All allocate a fresh array and copy the elements.

---

## Q14. Why is `bytes.Buffer.Bytes()` dangerous?

It returns a slice that aliases the buffer's internal array. Any subsequent `Write`, `Reset`, or grow may invalidate the returned slice's contents. The package docs explicitly say "the slice is valid only until the next modification of the buffer". To keep it, copy.

---

## Q15. What is the growth strategy for `append`?

Pre-Go 1.18: double when small (`cap < 1024`), then grow by 25 %. Post-Go 1.18: double under `cap < 256`, then transition smoothly to 1.25× growth. The exact formula is in `runtime/slice.go growslice`. The result is rounded up to the next `mallocgc` size class, so observed cap may exceed the formula's output. Don't rely on a specific factor; do rely on amortised O(1) per `append`.

---

## Q16. What is `runtime.growslice`?

The runtime function called by `append` when the existing backing array has no spare capacity. It picks a new capacity per the growth formula, allocates a backing array via `mallocgc`, copies the old elements (`memmove` for non-pointer types, `typedslicecopy` for pointer-bearing types), and returns a new three-word header.

---

## Q17. Why is `reflect.SliceHeader` deprecated?

Two reasons. First, its `Data` field is `uintptr`, not `unsafe.Pointer`, so the GC doesn't track it — code that builds a slice from a `SliceHeader` may have its backing array collected. Second, exporting a public layout type locked the runtime to a specific representation forever. The replacement is `unsafe.Slice` (to construct) and `unsafe.SliceData` (to read), introduced in Go 1.17 and 1.20.

---

## Q18. How do you construct a slice from a raw pointer in modern Go?

```go
s := unsafe.Slice((*T)(ptr), n)
```

The pointer is treated as `*T` (GC-tracked if it points into Go heap; raw if into C memory). The slice has `Data = ptr, Len = n, Cap = n`.

---

## Q19. How does the slice header interact with escape analysis?

The header itself usually lives in registers or on the stack. The **backing array** is allocated on the stack if the compiler can prove the slice doesn't escape the function (and the size is small enough), else on the heap via `mallocgc`. Returning a slice forces heap allocation of the backing array; storing it in a global does the same. `go build -gcflags="-m"` reports the decisions.

---

## Q20. Why might `make([]int, 0, 1000)` outperform `var s []int` in a loop appending 1000 items?

`make([]int, 0, 1000)` allocates one backing array of capacity 1000 up front. The bare `var` form starts with `cap == 0` and grows ~10 times to reach 1000, each growth allocating a new array and copying. The hint version is one `mallocgc`; the bare version is ten plus their copies. Typical 10× speedup on the loop.

---

## Q21. What does the "retention" pitfall look like?

Holding a small slice that points into a huge backing array keeps the entire array alive. Example: parsing a 1 GB file, slicing the first 100 bytes, returning that slice for caching. The cache entry is 100 bytes; the kept memory is 1 GB. Fix: `slices.Clone(slice)` to detach.

---

## Q22. When should you use a three-index slice expression in production?

When returning a sub-slice that callers might append to and you want to protect your backing array. The idiom `s[:n:n]` (or `s[i:j:j]`) sets `Cap == Len`, forcing any caller `append` to allocate fresh memory.

---

## Q23. How big is the slice header on a 32-bit machine?

12 bytes (`Data` 4 bytes, `Len` 4 bytes, `Cap` 4 bytes). On 64-bit it's 24 bytes. The Go runtime uses `int` for `Len` and `Cap`, so they match pointer width.

---

## Q24. What does `for i, v := range s` do mechanically?

The expression `s` is evaluated *once* and its header (Data, Len) captured. The loop iterates `i` from 0 to captured-Len - 1, and on each iteration loads `s.Data[i]` into a fresh `v` (Go 1.22+) or the same `v` (earlier). Mutations to `s` (header reassignment, append) during iteration don't change the captured length.

---

## Q25. Why does this print 5, not 3?

```go
s := make([]int, 3, 10)
t := s[:5]
fmt.Println(len(t))
```

`s[:5]` is bounded by `cap(s) = 10`, not by `len(s) = 3`. The resulting `t` has `Len = 5`, exposing two cells of the backing array that were beyond `s`'s `Len`. They contain zero (`make` zero-initialises the full capacity).

---

## Q26. How would you convert a `[]byte` to a `string` without copying?

Strictly, you can't safely in current Go; the runtime function `runtime.slicebytetostring` allocates. The `unsafe` workaround in legacy code is:

```go
*(*string)(unsafe.Pointer(&[]byte{...}))
```

But this violates string immutability if the original `[]byte` is later mutated. The compiler does have peephole opts for specific patterns (`m[string(b)]`, `string(b) == "x"`, `for range string(b)`) that elide the copy without `unsafe`. Use them when applicable.

---

## Q27. What's the difference between `s = s[:0]` and `s = nil`?

`s[:0]` keeps the backing array (`Data` and `Cap` unchanged) and sets `Len = 0`. Future `append` reuses the existing array up to `Cap`. `s = nil` sets all three fields to zero — the array becomes (potentially) garbage-collectable. The first is the idiom for "reset and reuse"; the second is "release memory".

---

## Q28. How would you split a `[]byte` into chunks of N without allocating?

```go
for i := 0; i < len(s); i += N {
    end := i + N
    if end > len(s) { end = len(s) }
    chunk := s[i:end:end] // bounded
    process(chunk)
}
```

Each `chunk` is a fresh header but no element copy. The `:end` bound prevents `process` from `append`-ing into the next chunk.

---

## Q29. Why does this code race even though `a` and `b` look disjoint?

```go
s := make([]int, 1024)
a := s[:512]
b := s[256:]
go func() { a[300] = 1 }()
go func() { _ = b[44] }()  // same address!
```

`a[300]` and `b[44]` both resolve to `s.Data + 300 * sizeof(int) = s.Data + (256 + 44) * sizeof(int)` — the same machine address. The race detector will catch it. Even if the ranges *did* look disjoint by index, you'd need to verify they don't overlap in the backing array.

---

## Q30. Explain `unsafe.SliceData(s)`.

It returns a `*T` pointing at the underlying data of the slice — equivalent to `&s[0]` for non-empty slices, with the additional guarantee that it's well-defined (returning a sentinel pointer or nil) even when `len(s) == 0`. It's the GC-safe replacement for `unsafe.Pointer(&s[0])` in scenarios where the slice may be empty.

---

## Q31. What is the difference in semantics between `[]T(s)` for arrays and `(*[N]T)(s)`?

`[N]T(s)` is a slice-to-array-*value* conversion (Go 1.20+) — it copies elements into a fresh array; no aliasing. `(*[N]T)(s)` is a slice-to-array-*pointer* conversion (Go 1.17+) — it aliases the slice's backing array; no copy. Both panic if `len(s) < N`.

---

## Q32. Why does `copy(s, s[1:])` correctly shift a slice left?

`copy` uses `memmove` semantics, which correctly handles overlapping source and destination. It doesn't matter that the regions overlap; `memmove` detects the direction of overlap and copies in the safe direction.

---

## Q33. What does `slices.Grow(s, n)` do?

If `cap(s) - len(s) >= n`, returns `s` unchanged. Otherwise, allocates a new backing array large enough for `len(s) + n` elements (selected via the growth formula), copies the existing elements, and returns a new header with the same `Len` but larger `Cap`. It's the single-shot equivalent of preallocating before a loop of appends.

---

## Q34. Two slices both have `len == cap == 0`. Can they be `!=` to each other?

You can't compare them with `!=` — the spec forbids slice comparison except to `nil`. With `reflect.DeepEqual`, `[]int(nil)` and `[]int{}` are not equal because one is nil and one is not. With `slices.Equal`, they're equal because both have length 0.

---

## Q35. What's the cheapest way to check "is this slice non-empty"?

`len(s) > 0` or `len(s) != 0`. `len` is one machine instruction (a load from the header). It works for `nil` slices (returns 0). It does *not* require dereferencing `Data`, so it's safe on nil.

---

## Q36. If you `make([]int, 0, 1_000_000)` and never append, does the runtime still allocate?

Yes — `make` always allocates the requested capacity. The argument is interpreted as a hint *for the backing array's size*, not "max if needed". If you want lazy, accept nil and let `append` grow it. If you want exact, `make` is right.

---

## Q37. How would you safely return a sub-slice without aliasing the source?

```go
return slices.Clone(s[i:j])
// or
return append([]T(nil), s[i:j]...)
// or
out := make([]T, j-i)
copy(out, s[i:j])
return out
```

All three produce an independent backing array with `Cap == Len`.

---

## Q38. What is the cost of `len(s)` and `cap(s)`?

One machine instruction each — they read the second and third words of the header. The compiler does not call any function; there is no method dispatch. Caching them in a variable provides no speedup.

---

## Q39. What does `bytes.Buffer.Grow(n)` do internally?

It ensures the buffer has at least `n` bytes of capacity available beyond the current `Len`. If `cap - len >= n`, it's a no-op. Otherwise, it allocates a new backing array (via the same growth math as `append`) and copies the existing content. It returns nothing; the buffer's internal `buf` field is updated.

---

## Q40. In one sentence, what is a Go slice?

A three-word value type (`Data`, `Len`, `Cap`) that describes a contiguous view into a shared backing array, where the header is copied on every assignment but the array is not.

---

## Further reading
- Go spec — https://go.dev/ref/spec#Slice_types
- `runtime/slice.go` — https://github.com/golang/go/blob/master/src/runtime/slice.go
- `slices` package — https://pkg.go.dev/slices
- `unsafe.Slice` / `unsafe.SliceData` — https://pkg.go.dev/unsafe#Slice
