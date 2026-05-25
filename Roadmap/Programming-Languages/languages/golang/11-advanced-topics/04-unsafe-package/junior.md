# `unsafe` Package — Junior

## 1. What is `unsafe`?

The `unsafe` package is Go's escape hatch from its type system. Most Go code never needs it. When you do touch it, you're saying: "I know what I'm doing, and I accept that the compiler is no longer protecting me."

The standard library uses `unsafe` in many places. Application code should reach for it last — after type assertions, generics, and `reflect` have all been tried.

---

## 2. Why the name?

Because using it can be unsafe. The Go compiler enforces type safety: you can't accidentally read an `int` as a `string`. With `unsafe.Pointer`, you can — and if you get it wrong, your program reads garbage, crashes, or silently corrupts data.

---

## 3. The handful of things it provides

```go
import "unsafe"

unsafe.Pointer        // generic pointer type
unsafe.Sizeof(x)      // bytes occupied by x's type
unsafe.Alignof(x)     // alignment requirement
unsafe.Offsetof(field)  // byte offset of field in its struct
unsafe.Add(p, n)      // (1.17+) typed pointer arithmetic
unsafe.Slice(p, n)    // (1.17+) wrap a pointer as a slice
unsafe.String(p, n)   // (1.20+) wrap a pointer as a string
```

These are tiny utilities. The whole package fits on one screen.

---

## 4. `unsafe.Sizeof` — usually safe

```go
fmt.Println(unsafe.Sizeof(int(0)))      // 8 on a 64-bit machine
fmt.Println(unsafe.Sizeof("hi"))        // 16 (the string header: ptr + len)
fmt.Println(unsafe.Sizeof([]int{1, 2})) // 24 (slice header: ptr + len + cap)
```

`Sizeof` returns the **header size**, not the size of what the value points to. For a slice, that's three words; for a string, two; for a map, one (the map header pointer).

You can use `Sizeof` freely; it's a compile-time constant and has no runtime risk.

---

## 5. `unsafe.Pointer` — the dangerous one

`unsafe.Pointer` is a universal pointer type. You can convert any typed pointer to it and back to any other typed pointer:

```go
var i int32 = 42
ip := &i
fp := (*float32)(unsafe.Pointer(ip))   // reinterpret i's bits as a float32
fmt.Println(*fp)                       // some near-zero float
```

This is type-punning. Common in low-level code (network protocols, binary formats, performance-critical loops). Dangerous because Go usually prevents this exact mistake.

---

## 6. Two simple "safe-ish" examples

### 6.1. Get the size of a struct without allocating

```go
type T struct { a int; b int; c int }
fmt.Println(unsafe.Sizeof(T{}))   // 24 on a 64-bit machine
```

### 6.2. Find the offset of a field

```go
type T struct {
    a int32
    b int64
}

fmt.Println(unsafe.Offsetof(T{}.b))   // 8 (after 4 bytes of int32 + 4 bytes of padding)
```

Both useful for debugging memory layout. Neither is dangerous on its own.

---

## 7. When you'll actually meet `unsafe`

Almost certainly when reading other people's code, not your own. Examples:

- The Go runtime itself (everywhere).
- Bytes-to-string conversion in serialization libraries.
- Cgo bridge code (passing Go data to C functions).
- Atomic operations on misaligned memory (rare).
- "Reinterpret a `[]byte` as a `[]uint32`" tricks in high-performance binary parsing.

If you're writing standard application code, you can go an entire career without writing `unsafe.Pointer` once.

---

## 8. The thing you might be tempted to do (and shouldn't, yet)

```go
func bytesToString(b []byte) string {
    return *(*string)(unsafe.Pointer(&b))   // works, but fragile
}
```

This works because a string header is a prefix of a slice header. But:

- It depends on the internal layout of slices and strings, which is **not** part of the language guarantee.
- Modifying the bytes after the conversion violates Go's "strings are immutable" assumption.

Use `unsafe.String(unsafe.SliceData(b), len(b))` instead (Go 1.20+) — same effect, supported by the language.

---

## 9. The compatibility promise

Most of Go's API is covered by the Go 1 compatibility promise: code that compiles today will compile in future versions. `unsafe` is **not** covered. The rules can tighten across releases. Your `unsafe`-heavy code might break.

Practical advice: avoid `unsafe` unless you have a specific reason, and pin the Go version that you've tested against.

---

## 10. Mental model: cost vs benefit

| Use case | Recommendation |
|----------|----------------|
| You want a faster `[]byte` → `string` in a critical inner loop | Maybe — measure first |
| You want to read the bytes of an int32 directly | Maybe — but try `encoding/binary` first |
| You want to set an unexported field of another package's type | No — you're abusing encapsulation |
| You want to "fix" a slow part of your code | No — find the actual bottleneck first |
| You're writing the next `encoding/json` | Probably — but you should be reading lots of existing code |

---

## 11. Reading other people's `unsafe` code

When you see `unsafe.Pointer` in a library, ask:

1. Is the conversion in one of the six documented valid patterns?
2. Is there a comment explaining what's being aliased and why?
3. Is there a `runtime.KeepAlive` if the code goes through `uintptr` to talk to C or syscalls?

If any answer is "no", be suspicious of the code.

---

## 12. Summary

`unsafe` is a small package with disproportionate weight: it bypasses Go's type checker. Most application code never needs it. For now, focus on knowing what's in it (`Sizeof`, `Alignof`, `Offsetof`, `Pointer`) and what its existence signals when you see it in other code. Save the deeper usage for later, when you have a concrete problem that demands it.

---

## Further reading
- `unsafe` package docs: https://pkg.go.dev/unsafe
- The Go spec on `unsafe`: https://go.dev/ref/spec#Package_unsafe
- "Unsafe in Go: When and How to Use It" — common blog series
