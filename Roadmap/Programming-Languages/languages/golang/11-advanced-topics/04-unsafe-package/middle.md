# `unsafe` Package — Middle

## 1. The six valid conversion patterns

Go's `unsafe.Pointer` is governed by six documented patterns. Any conversion outside them is undefined behavior — even if today it works.

### 1.1. `*T1` → `unsafe.Pointer` → `*T2`

```go
var x float64 = 3.14
bits := *(*uint64)(unsafe.Pointer(&x))   // reinterpret bits
```

Sizes must match. `T2` must have the same memory layout as `T1` for the result to be meaningful.

### 1.2. `unsafe.Pointer` ↔ `uintptr` (no intervening operations)

For syscalls and cgo only:

```go
syscall.Syscall(SYS_FOO, uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)), 0)
```

### 1.3. Pointer arithmetic in a single expression

```go
field := *(*int)(unsafe.Pointer(uintptr(unsafe.Pointer(&t)) + unsafe.Offsetof(t.b)))
```

The cast back to `*T` must be in the same expression — no intermediate variable can hold the `uintptr`.

Better (Go 1.17+): use `unsafe.Add`:

```go
field := *(*int)(unsafe.Add(unsafe.Pointer(&t), unsafe.Offsetof(t.b)))
```

### 1.4. `reflect.Value.Pointer/UnsafeAddr` → `unsafe.Pointer`

```go
p := unsafe.Pointer(reflect.ValueOf(&obj).Pointer())
```

The result must be used immediately; it's no longer a tracked reference once it returns.

### 1.5. `reflect.SliceHeader`/`StringHeader` (deprecated)

Old code does:

```go
sh := (*reflect.SliceHeader)(unsafe.Pointer(&slice))
sh.Data = ...
```

New code (Go 1.20+):

```go
p := unsafe.SliceData(slice)  // *T
```

### 1.6. Syscall results

OS-returned pointers via `syscall.Syscall` carry their lifetime semantics by convention.

---

## 2. Why `uintptr` is dangerous

A `uintptr` is an integer. The GC does not consider it a reference. Memory reachable only through a `uintptr` may be collected:

```go
func bad() {
    x := new(int)
    *x = 42

    addr := uintptr(unsafe.Pointer(x))
    runtime.GC()                 // x may be collected here
    p := (*int)(unsafe.Pointer(addr))
    fmt.Println(*p)              // undefined behavior
}
```

The runtime can collect `x` because the only "reference" left is an integer, which the GC ignores.

Mitigations:

- Don't keep `uintptr` around across program points. Convert and use in one expression.
- Use `runtime.KeepAlive(x)` after the dereference to extend lifetime.
- Use `unsafe.Pointer` (which the GC does track) for any cross-statement storage.

---

## 3. The `unsafe.Add` and `unsafe.Slice` era (Go 1.17+)

Before 1.17:

```go
addr := uintptr(unsafe.Pointer(&arr[0])) + uintptr(i)*unsafe.Sizeof(arr[0])
p := (*int)(unsafe.Pointer(addr))
```

After 1.17:

```go
p := (*int)(unsafe.Add(unsafe.Pointer(&arr[0]), i*unsafe.Sizeof(arr[0])))
```

`Add` keeps the value as `unsafe.Pointer` throughout (GC-safe) and is type-checked enough to catch obvious mistakes.

`unsafe.Slice(p, n)` builds a `[]T` from a pointer and length:

```go
data := C.malloc(C.size_t(n * 4))
s := unsafe.Slice((*int32)(data), n)
// use s as []int32; later: C.free(data)
```

---

## 4. String/[]byte aliasing (Go 1.20+)

```go
func b2s(b []byte) string {
    return unsafe.String(unsafe.SliceData(b), len(b))
}

func s2b(s string) []byte {
    return unsafe.Slice(unsafe.StringData(s), len(s))
}
```

These functions document the (previously informal) idiom. The invariant: while the resulting view is alive, the underlying memory must not be modified through any path.

Mutating a `[]byte` while a derived `string` is alive corrupts:

- Anything keyed by the string in a map.
- Switch cases on the string.
- Future string comparisons.

Treat it as: write once, freeze, then alias.

---

## 5. Struct layout: `Sizeof`, `Alignof`, `Offsetof`

```go
type T struct {
    a bool   // 1 byte + 7 padding
    b int64  // 8 bytes
    c bool   // 1 byte + 7 padding (tail align)
}

unsafe.Sizeof(T{})       // 24
unsafe.Alignof(T{})      // 8
unsafe.Offsetof(T{}.b)   // 8
unsafe.Offsetof(T{}.c)   // 16
```

These are compile-time constants. Useful for:

- Verifying that your struct layout matches a binary format (sanity checks).
- Computing field offsets for reflection-bypass fast paths.
- Detecting size regressions across Go versions in CI.

---

## 6. Reinterpreting binary data

A common production use: parsing a fixed binary header.

```go
type Header struct {
    Magic   [4]byte
    Length  uint32
    Version uint16
    _       [2]byte    // padding
}

func parseHeader(b []byte) (*Header, error) {
    if len(b) < int(unsafe.Sizeof(Header{})) {
        return nil, errors.New("short read")
    }
    return (*Header)(unsafe.Pointer(&b[0])), nil
}
```

Caveats:

- Endianness must match the host (use `encoding/binary` if not).
- Alignment must match (most natural-aligned headers are fine).
- The returned pointer aliases the input slice; mutating one mutates the other.

When in doubt, use `encoding/binary` — slower, but obviously correct.

---

## 7. Atomic operations and alignment

Atomic 64-bit operations require 64-bit-aligned addresses on some platforms. Historically, this required hand-laid-out structs:

```go
type Counter struct {
    n uint64   // must be 8-byte aligned on 32-bit ARM
}
```

Go 1.19 introduced `atomic.Int64`, `atomic.Uint64`, etc., which carry their alignment guarantee in the struct layout. Prefer them over hand-aligned fields.

For `unsafe`-built pointers, you must ensure alignment yourself:

```go
p := unsafe.Pointer(&buf[0])
if uintptr(p)%8 != 0 {
    // pad or shift; atomic.AddUint64 will fault otherwise
}
```

---

## 8. `unsafe.Pointer` in struct fields

You can store `unsafe.Pointer` in a struct field. The GC will trace it. This is the *only* GC-safe way to store typeless pointers:

```go
type cache struct {
    head unsafe.Pointer
}
```

Storing `uintptr` instead would hide the reference from the GC.

---

## 9. Concurrency

`unsafe.Pointer` does not provide any concurrent-access guarantees. Reading and writing concurrently still requires synchronization. The `sync/atomic` package has atomic operations specifically for `unsafe.Pointer`:

```go
old := atomic.LoadPointer(&p)
atomic.StorePointer(&p, new)
swapped := atomic.CompareAndSwapPointer(&p, old, new)
```

These are the building blocks for lock-free data structures.

---

## 10. When `unsafe` is the right answer

- **Aliasing without copy.** `[]byte` ↔ `string` views in a hot serialization path.
- **Wrapping C memory.** Treating a `C.malloc`'d region as a Go slice.
- **Atomic operations on opaque pointers.** Lock-free queues, hazard pointers.
- **Fast binary parsing.** Pointing a struct at a `[]byte` instead of field-by-field decoding.
- **Bypassing reflection overhead.** Caching field offsets and writing through them.

In each case, `unsafe` should be confined to a small, well-commented function with tests.

---

## 11. Tests for `unsafe` code

```go
func TestLayoutSanity(t *testing.T) {
    if got, want := unsafe.Sizeof(Header{}), uintptr(12); got != want {
        t.Fatalf("Header size = %d, want %d", got, want)
    }
    if got, want := unsafe.Offsetof(Header{}.Length), uintptr(4); got != want {
        t.Fatalf("Length offset = %d, want %d", got, want)
    }
}
```

This is the cheapest insurance against a struct-layout regression. `go vet`'s `unsafeptr` checker catches some misuse; alignment is your responsibility.

---

## 12. `go vet` and analyzers

`go vet` runs the `unsafeptr` analyzer, which flags suspicious `uintptr` → `unsafe.Pointer` conversions, like storing a `uintptr` in a variable before converting back.

```bash
go vet ./...
```

Run it on PRs. Most unsound `unsafe` usage produces a vet error you can fix.

---

## 13. The compatibility promise (again)

The `unsafe` package is explicitly excluded from Go's compatibility promise. The six rules above have been stable for years, but always re-read https://pkg.go.dev/unsafe#Pointer when you upgrade.

---

## 14. Summary

`unsafe` is a small package with six pointer-conversion rules and a handful of utilities. Most code never needs it; some code (serialization, cgo bridges, low-level concurrency) needs it surgically. Use `unsafe.Add`, `unsafe.Slice`, `unsafe.String`, and `unsafe.SliceData` over older `reflect.SliceHeader` patterns. Beware `uintptr` — it's an integer, not a pointer. Test layout assumptions. Run `go vet`.

---

## Further reading
- `unsafe.Pointer` rules: https://pkg.go.dev/unsafe#Pointer
- `go vet unsafeptr` source: https://github.com/golang/tools/tree/master/go/analysis/passes/unsafeptr
- Go 1.17 release notes on `unsafe.Add` / `unsafe.Slice`
- Go 1.20 release notes on `unsafe.String` / `unsafe.SliceData`
