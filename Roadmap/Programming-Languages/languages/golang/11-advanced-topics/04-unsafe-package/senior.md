# `unsafe` Package — Senior

## 1. Mental model

`unsafe.Pointer` is the language's universal pointer. The compiler's type system gets out of the way, but the runtime's GC and the underlying machine **do not**. Three constraints govern every line of `unsafe` code:

1. **Type punning** must respect size and alignment.
2. **GC visibility** must not be broken (no orphaned pointers via `uintptr`).
3. **Aliasing rules** must hold (don't mutate strings, respect cgo memory ownership).

Senior `unsafe` work is mostly about isolating these constraints in tiny, well-tested helpers.

---

## 2. The single-expression rule, dissected

The most subtle of the six pointer patterns is "convert to `uintptr`, do arithmetic, convert back, *in one expression*":

```go
// Legal: single expression
p := (*int)(unsafe.Pointer(uintptr(unsafe.Pointer(&t)) + unsafe.Offsetof(t.b)))

// Illegal: intermediate uintptr storage
addr := uintptr(unsafe.Pointer(&t)) + unsafe.Offsetof(t.b)
p := (*int)(unsafe.Pointer(addr))
```

Why? Because in the legal form, the compiler can see the entire expression and treat the conversion as one operation. The GC's responsibility — keep `&t` alive across the arithmetic — is local to the expression. With the intermediate `addr`, the GC could theoretically collect `t` between the two statements.

In practice the runtime is conservative and most code works either way. But "in practice" is exactly what undefined behavior eats for breakfast. Use `unsafe.Add` (Go 1.17+) to side-step the issue entirely.

---

## 3. The GC's view of `unsafe.Pointer`

The GC treats `unsafe.Pointer` as a strong reference. So:

- A heap-resident struct field of type `unsafe.Pointer` keeps its target alive.
- A heap-resident struct field of type `uintptr` does **not** keep its target alive.
- Local variables on the stack are scanned regardless of type label, but the compiler's escape analyzer may decide to optimize away local copies it can prove are dead — meaning a stale `uintptr` may "lose" the reference even on the stack.

When in doubt, use `runtime.KeepAlive(x)` at the program point where you need `x` to remain reachable.

---

## 4. Inter-package layout invariants

`unsafe.Offsetof` is computed against the struct definition the caller sees. If a different package (or a future version) reorders fields, your offset breaks. Two defenses:

1. **Define the struct in the same package** as the `unsafe` code. The package contract becomes "we own the layout".
2. **Self-check with constants**:

```go
const (
    _ = uint(unsafe.Offsetof(Header{}.Length) - 4)  // compile error if offset changes
)
```

If the constant subtraction would wrap to a huge unsigned value, you can write a constant assertion that fails compilation. This is the Go equivalent of `static_assert`.

---

## 5. The "fast b2s/s2b" debate

```go
func b2s(b []byte) string {
    return unsafe.String(unsafe.SliceData(b), len(b))
}
```

When justified:

- A measured bottleneck where the copy from `[]byte` to `string` is dominating CPU.
- The bytes are immutable after conversion (a build-once buffer, then read-only).
- The function is in package internals, not a public API surface.

When **not** justified:

- "It's faster" without a profile.
- The buffer is mutated after the string is taken.
- The string is stored in a `sync.Map`, used as a map key, or compared against literals.

The performance gain is typically a few percent of the conversion step, not the whole program. Make sure the cost is real before reaching for `unsafe`.

---

## 6. Lock-free data structures

`atomic.Pointer[T]` (Go 1.19+) makes most `unsafe.Pointer` + `atomic.LoadPointer` code unnecessary:

```go
var p atomic.Pointer[Node]

p.Store(&Node{...})
n := p.Load()
swapped := p.CompareAndSwap(old, new)
```

This is type-safe, alignment-correct, and just as fast as the `unsafe` version. Use it for new code; reach for `atomic.Pointer` with `unsafe.Pointer` only when you need to interoperate with raw memory (e.g., shared memory regions).

---

## 7. Cgo and the unsafe boundary

Passing Go memory to C is regulated by the cgo rules (see [06-cgo-basics](../06-cgo-basics/)). The crucial points:

- Go pointers passed to C must not be retained by C past the call's return.
- C-allocated memory (`C.malloc`) is **not** GC-tracked. You must `C.free` it.
- Use `runtime.KeepAlive(buf)` after C calls that hold the buffer asynchronously.
- For passing Go data structures, build a C-allocated mirror and copy field-by-field.

Bridging without `unsafe` is impossible; bridging with `unsafe` without discipline is dangerous.

---

## 8. `reflect.SliceHeader` and `StringHeader` — why deprecated

```go
// Old style
sh := (*reflect.SliceHeader)(unsafe.Pointer(&b))
sh.Data = ptr
sh.Len = n
sh.Cap = n
```

Problems:

- `Data` is `uintptr`, breaking GC visibility.
- The struct's layout has been stable historically but is **not** guaranteed.
- The pattern is hard to vet.

Go 1.20's `unsafe.Slice`, `unsafe.String`, `unsafe.SliceData`, `unsafe.StringData` are the supported replacements. They take `*T` and `int`, return slice/string values, and don't expose `uintptr`.

---

## 9. Detecting misuse

| Tool | Catches |
|------|---------|
| `go vet` `unsafeptr` analyzer | `uintptr` ↔ `unsafe.Pointer` round-trips through variables |
| `golangci-lint`'s `staticcheck` | Many additional `unsafe` patterns |
| `go test -race` | Data races on `unsafe`-shared memory |
| Test that builds layout constants | Struct layout regressions across releases |

Add these to CI for any package containing `unsafe`. The cost is minor; the catch rate is meaningful.

---

## 10. Memory-mapped I/O patterns

For reading large files efficiently:

```go
data, _ := mmap.Mmap(file)              // syscall.Mmap or 3rd-party wrapper
header := (*Header)(unsafe.Pointer(&data[0]))
```

Mistakes:

- Treating `data` as a `[]byte` while another goroutine writes to the underlying file.
- Not `Munmap`-ing on shutdown; the OS doesn't notice via Go's GC.
- Touching the slice after `Munmap` (segfault).

Wrap the mmap region in a struct that owns the `Munmap`, and document the lifetime.

---

## 11. The "interface header trick"

A Go `interface{}` is two words: a type-info pointer and a data pointer. Tools that want to expose internals do:

```go
type ifaceHeader struct {
    typ  unsafe.Pointer
    data unsafe.Pointer
}

func dataPtr(i any) unsafe.Pointer {
    return (*ifaceHeader)(unsafe.Pointer(&i)).data
}
```

This bypasses `reflect` for hot paths in serialization libraries. **Fragile** — the layout is internal and the Go team could change it. Used in `goccy/go-json`, `bytedance/sonic`, etc., with explicit version testing.

Don't use this in your own code unless you're maintaining a serialization library and prepared to chase Go release notes.

---

## 12. Atomicity of word-sized reads

Go does not guarantee that a non-atomic read of a word-sized field is torn-free. On most modern platforms it is, but the language doesn't promise. So:

```go
type T struct { x uint64 }

go func() { t.x = 1 }()
go func() { fmt.Println(t.x) }()       // race: may read partial value
```

Use `sync/atomic` (or `atomic.Uint64`). `unsafe` does not change this — it makes things worse by hiding the data race from the race detector if you're not careful.

---

## 13. Aligning structures for cache lines

```go
type padded struct {
    _ [64]byte    // unused; pads to a cache line
    n uint64
    _ [64-8]byte  // trailing padding
}
```

To prevent false sharing between fields written by different cores. `unsafe` isn't strictly required, but `unsafe.Sizeof(padded{})` lets you verify the layout.

For per-CPU sharded data structures (e.g., per-P counters), padding to 64 bytes is the standard pattern. Measure with `perf c2c` (Linux) before reaching for it.

---

## 14. Summary

Senior `unsafe` work is disciplined: small helpers, single-expression conversions, no stored `uintptr`, GC-aware code, vet+layout assertions in CI. The modern toolkit (`unsafe.Add`, `unsafe.Slice`, `unsafe.String*`, `atomic.Pointer[T]`) removes most of the historical footguns. Reach for `unsafe` after measurement, isolate it, and document the invariants.

---

## Further reading
- `unsafe.Pointer` rules: https://pkg.go.dev/unsafe#Pointer
- `atomic.Pointer[T]`: https://pkg.go.dev/sync/atomic#Pointer
- `goccy/go-json` interface-header source: a real-world example
- "Three Things I Wish I Knew When I Started Using Unsafe" — Filippo Valsorda
