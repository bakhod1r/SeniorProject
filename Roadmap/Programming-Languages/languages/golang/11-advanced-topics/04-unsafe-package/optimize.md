# `unsafe` Package — Optimize

## 1. Use only after measurement

Reach for `unsafe` only when:

1. A profile clearly shows a copy/conversion dominating the path.
2. The safer alternatives (preallocate, `sync.Pool`, generics) didn't close the gap.
3. The code path is hot enough that the engineering cost pays back.

A 100× speedup on code called once at startup saves a microsecond. A 10% speedup on the hot path is worth weeks of effort.

---

## 2. The four high-value patterns

### 2.1. Zero-copy `[]byte` ↔ `string`

```go
func b2s(b []byte) string {
    return unsafe.String(unsafe.SliceData(b), len(b))
}
```

Use case: a hot encoder that builds bytes into a buffer and needs to return a string.

Constraint: the bytes must not be modified after the string is taken. Document this.

### 2.2. Cached struct-field offsets

```go
var nameOff = unsafe.Offsetof(User{}.Name)

func setName(u *User, s string) {
    *(*string)(unsafe.Add(unsafe.Pointer(u), nameOff)) = s
}
```

Use case: serialization libraries that walk many structs of the same type.

Constraint: the struct layout must not change without updating the offset.

### 2.3. Aliasing C memory as a Go slice

```go
buf := C.malloc(C.size_t(n))
defer C.free(buf)
s := unsafe.Slice((*byte)(buf), n)
// use s as a []byte
```

Use case: cgo bridge code reading large buffers from C libraries.

Constraint: don't grow `s` (`append` may reallocate, defeating the no-copy goal); free at the end.

### 2.4. Lock-free pointer swaps

```go
var head atomic.Pointer[Node]
head.Store(newNode)
n := head.Load()
```

Use case: lock-free data structures.

Constraint: think hard about ABA and memory ordering. Tests with `-race` and stress.

---

## 3. Benchmarking `unsafe` wins

```go
func BenchmarkB2SCopy(b *testing.B) {
    src := []byte("hello world")
    for i := 0; i < b.N; i++ {
        _ = string(src)
    }
}

func BenchmarkB2SUnsafe(b *testing.B) {
    src := []byte("hello world")
    for i := 0; i < b.N; i++ {
        _ = b2s(src)
    }
}
```

Expected: the unsafe version reports 0 allocs/op; the copy version reports 1.

The benchmark is the entire justification. Without one showing the win, the change is unjustified.

---

## 4. The "compile-time check" pattern

Verify your assumed offsets are correct *at compile time*, so layout regressions fail the build:

```go
const _ = uint(unsafe.Sizeof(Header{}) - 12)        // panics at compile if size != 12
const _ = uint(unsafe.Offsetof(Header{}.Crc) - 8)   // panics if offset != 8
```

These constants are zero-cost at runtime and catch any future field reordering or padding change.

---

## 5. Avoiding `interface{}` boxing via unsafe

Some serializers use the iface layout to skip a step:

```go
type ifaceHeader struct {
    _    *struct{}     // type pointer (we don't care)
    data unsafe.Pointer
}

func dataOf(v any) unsafe.Pointer {
    return (*ifaceHeader)(unsafe.Pointer(&v)).data
}
```

The "data" pointer is the underlying value's storage. For pointer-shaped values, it's the pointer itself.

This is fragile and depends on internal layout. Used in `bytedance/sonic` and similar high-performance libraries. Not for general use.

---

## 6. Cache-line alignment

For per-CPU counters and lock-free structures, padding to 64 bytes prevents false sharing:

```go
type counter struct {
    n uint64
    _ [56]byte   // pad to 64 bytes (cache line)
}

type shards [256]counter
```

Verify the padding with `unsafe.Sizeof`:

```go
const _ = uint(unsafe.Sizeof(counter{}) - 64)   // must be exactly 64
```

Without padding, 16 counters share one cache line, and writes to one invalidate the others on every core. With padding, each counter owns its line.

---

## 7. The `runtime.KeepAlive` companion

Whenever you go through `uintptr` (cgo, syscall):

```go
buf := make([]byte, 4096)
ret := C.read(C.int(fd), unsafe.Pointer(&buf[0]), C.size_t(len(buf)))
runtime.KeepAlive(buf)
return ret
```

Without `KeepAlive`, the compiler can decide `buf`'s last use is the `&buf[0]` evaluation; if C is asynchronous, the slice could be collected before the C call returns.

This is the most common `unsafe` correctness bug.

---

## 8. The "structures over copies" technique

For an inner loop that processes many fixed-shape records:

```go
type Record struct {
    A, B, C uint32
}

func processSlow(b []byte) {
    for i := 0; i+12 <= len(b); i += 12 {
        a := binary.LittleEndian.Uint32(b[i:])
        b2 := binary.LittleEndian.Uint32(b[i+4:])
        c := binary.LittleEndian.Uint32(b[i+8:])
        consume(a, b2, c)
    }
}

func processFast(b []byte) {
    n := len(b) / 12
    recs := unsafe.Slice((*Record)(unsafe.Pointer(&b[0])), n)
    for _, r := range recs {
        consume(r.A, r.B, r.C)
    }
}
```

`processFast` aliases the bytes as records and reads them directly. The endianness must match the host (so this trick is platform-coupled).

---

## 9. Pre-allocated arrays via `unsafe.Slice`

```go
var arena [4096]byte

func scratch() []byte {
    return unsafe.Slice(&arena[0], len(arena))
}
```

The arena is a stack or BSS-resident array; the slice points into it without allocating. Useful for very small, fixed scratch spaces. Watch out for goroutine safety — concurrent users will corrupt each other.

---

## 10. The "string interning" pattern

For deduplication of many identical strings:

```go
type interner struct {
    table map[string]string
}

func (i *interner) intern(b []byte) string {
    s := b2s(b)
    if existing, ok := i.table[s]; ok {
        return existing
    }
    persistent := string(b)    // explicit copy
    i.table[persistent] = persistent
    return persistent
}
```

Lookup uses the no-copy view; storage uses a real copy. Memory savings can be large when many incoming buffers share the same value (HTTP headers, tag values).

---

## 11. What not to do

| Anti-pattern | Why bad |
|--------------|---------|
| Replace `for ... append` with `unsafe.Slice` | append handles growth; unsafe.Slice doesn't |
| Cast `[]uint32` to `[]float32` | Endianness, alignment, semantics: too many traps |
| Skip `runtime.KeepAlive` after cgo | Eventually crashes under GC pressure |
| Mutate a `[]byte` after taking a `string` view | Corrupts maps and string comparisons |
| Use `unsafe` to "speed up" reflection without a profile | Same cost, more fragility |

---

## 12. The cost of `unsafe` you didn't pay for

`unsafe` doesn't make code faster on its own — it lets you skip copies, allocations, or bounds checks. Each `unsafe` use should map to a specific cost being eliminated:

- Skipped copy (`b2s`, `s2b`).
- Skipped boxing (`ifaceHeader` trick).
- Skipped bounds checks (aliasing as a struct).
- Skipped reflection (offset access).

If you can't name the cost, you're using `unsafe` for the wrong reason.

---

## 13. Tools

| Tool | Purpose |
|------|---------|
| `go test -benchmem` | Confirm allocs went to zero |
| `go test -race` | Catch unsafe-induced data races |
| `go vet` | `unsafeptr` analyzer |
| `staticcheck` | Broader `unsafe` checks |
| `objdump` / `go tool objdump` | Verify the compiled code actually skips bounds checks |
| `perf` (Linux) | Cache-miss and false-sharing analysis |

---

## 14. Summary

`unsafe` optimization is about removing specific, measured costs: copies between `[]byte` and `string`, reflection overhead, boxing into `any`. Wrap each use in a safe API, verify with benchmarks, lock down layout assumptions with compile-time constants, and keep `runtime.KeepAlive` in mind. The wins are real but narrow; the maintenance cost is real and durable. Use sparingly, document thoroughly.

---

## Further reading
- `unsafe.Slice` / `unsafe.String` (Go 1.20)
- "Go 1.20: New unsafe Functions" — release notes
- `goccy/go-json` / `bytedance/sonic` source code
