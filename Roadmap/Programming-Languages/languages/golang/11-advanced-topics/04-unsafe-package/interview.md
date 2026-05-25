# `unsafe` Package — Interview

Common interview questions about Go's `unsafe` package.

---

## Q1. What does `unsafe` provide?

A small set of utilities that bypass Go's type system: `unsafe.Pointer` (generic pointer), `Sizeof`/`Alignof`/`Offsetof` (compile-time layout queries), and helpers like `unsafe.Add`, `unsafe.Slice`, `unsafe.String` for pointer arithmetic and view construction.

---

## Q2. What's the difference between `unsafe.Pointer` and `uintptr`?

`unsafe.Pointer` is a typed pointer; the GC traces it. `uintptr` is an integer; the GC does not consider it a reference. Storing a pointer as `uintptr` across program points can lead to the object being collected while you still need it.

---

## Q3. Name the six valid `unsafe.Pointer` conversion patterns.

1. `*T1` → `unsafe.Pointer` → `*T2` (size-compatible reinterpret).
2. `unsafe.Pointer` ↔ `uintptr` (for syscall args, no intervening operations).
3. Pointer arithmetic in a single expression (`unsafe.Add` is the modern form).
4. Conversion from `reflect.Value.Pointer/UnsafeAddr` — immediately to a `*T`.
5. Legacy `reflect.SliceHeader`/`StringHeader` (deprecated; use `unsafe.SliceData`/`StringData`).
6. Pointers returned from `syscall.Syscall` and similar OS interfaces.

---

## Q4. Why does the GC have trouble with `uintptr`?

The GC scans typed pointer slots. A `uintptr` looks like an integer, so the GC ignores it. If the only "reference" to an object is a `uintptr`, the GC may collect the object even though your code intends to dereference it later.

---

## Q5. When is `runtime.KeepAlive` needed?

After passing a pointer to C or a syscall that uses it asynchronously, or after converting through `uintptr`. It tells the compiler "this object must remain alive up to this point", preventing premature collection while another system holds the pointer.

---

## Q6. What does `unsafe.Sizeof("hello")` return?

The header size of a string: 16 bytes on 64-bit (pointer + length). It does **not** measure the content of the string. For content, use `len()`.

---

## Q7. Why was `unsafe.Slice` added in Go 1.17?

To replace the older idiom of building a slice via `reflect.SliceHeader`. The new API takes `(*T, int)`, returns `[]T`, and avoids the `uintptr` round-trip, making it safer and easier to vet.

---

## Q8. Is converting `[]byte` to `string` via `unsafe` safe?

Mechanically, yes — the memory layout works. **Semantically** only if the bytes won't be modified for the string's lifetime. Strings in Go are immutable; mutating the bytes corrupts map keys, switch cases, and equality comparisons.

---

## Q9. What's the difference between `unsafe.Sizeof` and `len()`?

`Sizeof` is a compile-time constant that returns the type's storage size, including pointer headers but not pointed-to data. `len()` is a runtime function that returns the element count of a slice/map/string/channel — the user-visible length, not the underlying storage.

---

## Q10. How do you reinterpret a `float64` as the bit pattern of a `uint64`?

```go
bits := *(*uint64)(unsafe.Pointer(&f))
```

Or use the safer `math.Float64bits(f)` which the compiler will optimize to the same instruction without `unsafe`.

---

## Q11. What guarantees does Go make about struct layout?

- Fields are in declaration order.
- Each field is aligned per its type.
- Padding is inserted as needed for alignment.
- Tail padding ensures the struct's size is a multiple of its alignment.

The actual offsets are platform-dependent. Use `unsafe.Offsetof` and `unsafe.Sizeof` to inspect.

---

## Q12. Is `unsafe` covered by Go's compatibility promise?

No. The `unsafe` package is explicitly excluded. The rules and analyses can tighten across releases. You should re-audit `unsafe` code after each Go upgrade.

---

## Q13. Can you set unexported fields with `unsafe`?

Yes, via `reflect.UnsafeAddr` plus `unsafe.Pointer`, you can construct a typed pointer to an unexported field and write through it. It's a documented escape hatch, used by `testing/quick` and similar, but considered bad style in application code.

---

## Q14. What's the right way to do lock-free atomic pointer swaps?

`sync/atomic.Pointer[T]` (Go 1.19+). It's type-safe, alignment-safe, and replaces the older `unsafe.Pointer` + `atomic.LoadPointer`/`StorePointer` pattern.

---

## Q15. Why does the standard library use `unsafe`?

For internal performance-critical code: type-punning in `runtime`, low-level structures in `sync/atomic`, syscall interfaces, memory mapping. The standard library is the most-reviewed `unsafe` code in the Go ecosystem.

---

## Q16. What does `go vet`'s `unsafeptr` analyzer catch?

Suspicious round-trips between `unsafe.Pointer` and `uintptr` — particularly cases where a `uintptr` is stored in a variable and later cast back, which is unsound.

---

## Q17. How do you avoid an `append` reallocating an `unsafe.Slice`?

You don't — if `append` exceeds capacity, it allocates a new backing array. For slices that wrap external memory, treat them as fixed-size views: index into them, read/write in place, but don't `append`. Or copy to a Go slice before appending.

---

## Q18. How does `unsafe.Pointer` interact with the race detector?

The race detector instruments typed memory access. `unsafe.Pointer` operations are also instrumented when they correspond to typed loads/stores, but tricky patterns (raw pointer arithmetic, type-punning) may be missed. Always run race tests for `unsafe`-using code.

---

## Q19. When would you choose `unsafe` over `reflect`?

When you've measured a reflection bottleneck and:

- The set of types is small (or you can cache offsets per type).
- The performance gain is significant (5–20× is typical).
- The code can be isolated to a small package with thorough tests.

If reflection is fast enough, don't introduce `unsafe`. If you need polymorphism and reflection is too slow, generate code instead.

---

## Q20. Bonus — describe a time you used (or refused to use) `unsafe`.

Open-ended. Strong answers identify a specific bottleneck (allocation, copy, reflection), describe the alternative considered (generics, codegen, pooling), explain why `unsafe` won (or didn't), and reference the test/bench that supports the decision.

---

## Cheat sheet

- `unsafe.Pointer` is GC-tracked; `uintptr` is not.
- Six valid pointer conversion patterns — anything else is undefined.
- Use `unsafe.Add`, `unsafe.Slice`, `unsafe.String*` (Go 1.17/1.20+) over older idioms.
- `runtime.KeepAlive` for cgo/syscall lifetime extension.
- `atomic.Pointer[T]` for lock-free pointer swaps (Go 1.19+).
- `Sizeof`, `Alignof`, `Offsetof` are compile-time constants.
- `unsafe` is **not** covered by Go's compatibility promise.

---

## Further reading
- `unsafe` package docs: https://pkg.go.dev/unsafe
- Go spec on `unsafe`: https://go.dev/ref/spec#Package_unsafe
