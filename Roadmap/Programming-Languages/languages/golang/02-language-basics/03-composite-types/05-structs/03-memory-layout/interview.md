# Struct Memory Layout — Interview Questions

A set of interview-style questions on Go struct memory layout — padding, alignment, the 32-bit atomic alignment trap, false sharing, zero-sized fields, the `fieldalignment` analyzer, and the compiler's layout algorithm. Concise but complete answers.

---

## Q1. What is struct field padding in Go?

Padding is zero-or-garbage bytes the Go compiler inserts between struct fields (and at the end of a struct) so that each field's address is a multiple of its alignment requirement. Padding is invisible to your code but counts toward `unsafe.Sizeof`. A `struct{ a byte; b int64 }` on 64-bit is 16 bytes: 1 byte for `a`, 7 bytes padding, 8 bytes for `b`.

---

## Q2. Why does Go pad struct fields instead of packing them?

For performance and correctness. CPUs read multi-byte values from aligned addresses in one cycle; from misaligned addresses they may need two cycles or trap. On strict-alignment architectures (32-bit ARM, MIPS) misaligned reads can cause `SIGBUS`. Padding ensures every field starts at an address divisible by its alignment.

---

## Q3. Does the Go compiler reorder struct fields automatically?

No. The Go spec guarantees fields are laid out in declaration order. The compiler will not silently rearrange them, because:

1. Wire formats and cgo interop depend on declared order.
2. `unsafe.Offsetof` is a compile-time constant tied to declared order.
3. Reflection walks fields in declared order.

If you want optimal packing, you reorder the fields yourself or use `fieldalignment -fix`.

---

## Q4. How do you compute the size of a struct by hand?

The algorithm:

```
offset = 0
struct_align = 1
for each field in declared order:
    a = field's alignment (FieldAlign for 32-bit nuances)
    if a > struct_align: struct_align = a
    offset = round_up(offset, a)
    record field offset
    offset += field's size
size = round_up(offset, struct_align)
```

Plus the special rule: if a non-zero struct's last field has size 0, add 1 byte before the final round-up.

---

## Q5. What's the difference between `unsafe.Sizeof` and `unsafe.Alignof`?

`Sizeof` returns how many bytes a value occupies. `Alignof` returns the multiple-of value its address must satisfy. For `int64` on 64-bit: `Sizeof = 8`, `Alignof = 8`. For `bool`: `Sizeof = 1`, `Alignof = 1`. Both are compile-time constants for statically sized types.

---

## Q6. What does `unsafe.Offsetof(s.f)` return?

The byte offset of field `f` from the start of struct `s`. Compile-time constant. Used for unsafe pointer arithmetic, cgo struct mapping, and verifying layout against an expected protocol format.

---

## Q7. What is the size of `struct{}`?

Zero bytes. `unsafe.Sizeof(struct{}{}) == 0`. Used for set-like maps (`map[K]struct{}`) and signal-only channels (`chan struct{}`). Multiple `struct{}` values may share an address.

---

## Q8. What is the "last-field zero-sized" rule?

If a non-zero-sized struct ends with a zero-sized field, the compiler adds **one byte of padding** to ensure that field's address isn't equal to the struct's end (which would be a past-end pointer the GC could mishandle).

```go
type S struct {
    a int32     // 4 bytes
    b struct{}  // 0 bytes; would otherwise produce &s.b past end
}
fmt.Println(unsafe.Sizeof(S{}))  // 8, not 4
```

Moving the zero-sized field to a non-last position avoids the extra byte.

---

## Q9. Why is the famous `struct{a bool; b int64; c bool}` example 24 bytes?

Layout walk on 64-bit:

| Offset | Field | Size |
|--------|-------|------|
| 0 | a | 1 |
| 1–7 | pad | 7 |
| 8 | b | 8 |
| 16 | c | 1 |
| 17–23 | trailing pad | 7 |

Total 24. Reorder as `b, a, c`: 8 + 1 + 1 + 6 trailing = 16. Same data, 33 % less memory.

---

## Q10. What is `reflect.Type.FieldAlign()` and how does it differ from `Align()`?

`Align()` returns the alignment when the value sits standalone. `FieldAlign()` returns the alignment when it sits inside a struct. For most types they're equal. The exception: on 32-bit platforms, `int64`/`uint64`/`float64`/`complex64` have `Align = 8` but `FieldAlign = 4`. The compiler honours `FieldAlign` when laying out struct fields, which is the root cause of the 32-bit atomic alignment bug.

---

## Q11. Why do 64-bit atomic operations sometimes crash on 32-bit ARM?

Because `atomic.AddInt64`/`AddUint64` require their target to be **8-byte aligned**, but on 32-bit ARM the compiler only guarantees **4-byte alignment** for `int64` fields inside structs. The hardware `LDREXD`/`STREXD` pair requires 8-byte alignment and traps on misaligned access.

Fixes (any one):
1. Make the `int64` field the **first** field in the struct (heap allocations guarantee 8-byte alignment of the first word).
2. Use `atomic.Int64`/`atomic.Uint64` (Go 1.19+), which contain a self-aligning field.
3. Explicitly pad: `_ uint32` before the `int64` field, if needed.

---

## Q12. What is false sharing?

When two CPUs write to two different variables that happen to live on the same cache line (typically 64 bytes), the cache coherence protocol forces the line to ping-pong between the cores' caches. Each write invalidates the other core's copy. Result: ostensibly independent writes perform like contended writes, often 50× slower.

Classic example:

```go
type Counters struct {
    A uint64
    B uint64
}
// Two goroutines each incrementing one field — false sharing.
```

Fix: pad each contended field to a full cache line:

```go
type Counter struct {
    v atomic.Uint64
    _ [56]byte  // 64 - 8
}
```

---

## Q13. What's a typical cache line size and why does it matter?

64 bytes on x86_64 and most arm64 chips. **128 bytes on Apple Silicon (M-series)**. Matters because the CPU pulls memory into cache one line at a time; struct fields on the same line are loaded together. Determines false sharing geometry and the practical pad size for hot atomics.

---

## Q14. What does the `fieldalignment` analyzer do?

It's a static analyzer in `golang.org/x/tools/go/analysis/passes/fieldalignment` that walks every struct in your package and reports:

1. The struct's current size and the optimal size if reordered.
2. The pointer-byte count (used by GC) and the optimal count.

With `-fix` it rewrites your source to the optimal order. Use it in CI to gate new code; exclude wire-format and cgo packages (those need declared order).

---

## Q15. Does embedding a struct flatten its layout?

No. An embedded struct is treated as a single field whose size and alignment come from the embedded type. Its internal padding remains:

```go
type Inner struct {
    a byte
    b int64
}
// Sizeof = 16

type Outer struct {
    x byte
    i Inner   // contributes 16 bytes, alignment 8
    y byte
}
// Sizeof = 32 — Inner's 7-byte internal pad stays
```

To get tighter packing, flatten the fields into the outer struct directly.

---

## Q16. What's the size of a `string` field in a struct?

16 bytes on 64-bit (8-byte pointer + 8-byte length). Alignment 8. The actual character data lives behind the pointer and isn't counted by `unsafe.Sizeof`.

---

## Q17. What's the size of a slice header in a struct?

24 bytes on 64-bit (8-byte pointer + 8-byte length + 8-byte capacity). Alignment 8. Same for any element type. The backing array lives elsewhere.

---

## Q18. What's the size of an `interface{}` value?

16 bytes on 64-bit. Two words: a type pointer (for `interface{}`/`any` it's an `*eface`'s `_type` pointer; for a named interface it's the `*itab` pointer) and a data pointer. Same for `error`, `io.Reader`, any named interface.

---

## Q19. Why is `map[K]V` only 8 bytes in a struct?

Because a `map` value is a pointer to the `runtime.hmap` struct. The struct field holds the pointer; the hashtable's buckets, count, etc. live behind it. So `unsafe.Sizeof(map[string]int{}) == 8` on 64-bit regardless of how many entries the map has.

---

## Q20. How can struct layout reduce GC overhead?

The GC scans every allocation for pointers, using a per-allocation bitmap. The number of bytes the GC must scan (`PtrBytes`) is determined by the offset of the **last pointer-containing field**. By placing all pointer fields at the **start** of a struct, you shrink `PtrBytes` and the GC mark phase runs faster.

```go
// PtrBytes = 48 (last pointer field at offset 32)
type Bad struct {
    flag1 bool
    name  string
    flag2 bool
    email string
    flag3 bool
}

// PtrBytes = 32 (last pointer field at offset 16)
type Good struct {
    name  string
    email string
    flag1 bool
    flag2 bool
    flag3 bool
}
```

---

## Q21. What does `//go:align N` do?

It's a compiler directive (Go 1.23+) on top-level variable declarations forcing alignment to N (a power of two). Used for SIMD pointers, hardware mailboxes, and 8-byte-aligned 64-bit values on 32-bit platforms. It does **not** apply to struct fields — for those you use explicit `_ [N]byte` padding.

---

## Q22. How do you measure a struct's actual layout?

Three options:

1. `unsafe.Sizeof(x)` + `unsafe.Offsetof(x.f)` printed in `main` — compile-time, runs anywhere.
2. `reflect.TypeOf(x).Size()` + `Field(i).Offset` — runtime; works on `reflect.Value`.
3. `structlayout pkg.Type` (third-party tool) — pretty-prints layout including padding gaps.

---

## Q23. What is the alignment of an empty struct field used to force alignment?

`[0]uint64{}` has size 0 and alignment 8. So `struct { _ [0]uint64; x [3]byte }` is forced to 8-byte alignment and the struct's size rounds to 8. Used (rarely) as a "force this struct aligned" marker.

---

## Q24. How does the Go compiler decide a struct's overall alignment?

It's the maximum alignment of any field. A struct with only `int8` fields has alignment 1. A struct containing an `int64` (on 64-bit) has alignment 8. A struct's size is always a multiple of its alignment so that arrays of the struct have each element naturally aligned.

---

## Q25. What's the trade-off of using `time.Time` vs `int64` for timestamps in a bulk struct?

`time.Time` is 24 bytes (a wall-time tuple plus a `*time.Location` pointer). `int64` Unix nanos is 8 bytes. For a struct allocated millions of times, swapping `time.Time` for `int64` saves 16 bytes per record and removes a pointer the GC must scan. Trade-off: you lose the timezone, monotonic clock, and `time.Time` methods — but you can reconstruct a `time.Time` on demand for display.

---

## Q26. What's the difference between AoS and SoA in Go?

Array-of-structs (AoS) — `[]Point` — is Go's natural style. Struct-of-arrays (SoA) — `struct { X, Y, Z []float64 }` — splits fields into parallel slices. SoA is faster when a hot loop reads only one field per element (better cache utilization, sometimes auto-vectorizable). AoS is faster when multiple fields per element are read together. SoA is rare in idiomatic Go but valuable for numeric sweeps.

---

## Q27. Why doesn't Go have C-style bitfields?

A design choice — Go favours explicit code over compiler-hidden bit packing. To pack flags, use a `uint8`/`uint16`/`uint32` and bitmask constants:

```go
const (
    FlagA = 1 << iota
    FlagB
    FlagC
)
func (s *S) Set(f uint16)  { s.flags |= f }
func (s *S) Has(f uint16) bool { return s.flags&f != 0 }
```

The boilerplate is ~5 lines; the saving for ten flags is ~10 bytes per struct.

---

## Q28. How do you align a hot atomic counter for false-sharing safety?

Wrap it in a struct padded to a full cache line:

```go
type paddedUint64 struct {
    v atomic.Uint64
    _ [56]byte  // 64 - 8
}
```

Now each `paddedUint64` occupies its own cache line. For Apple Silicon, pad to 128 bytes. The waste is 56 bytes per counter — usually negligible for a handful of hot counters.

---

## Q29. What's the layout of a `chan int`?

The struct field is **8 bytes** on 64-bit — a pointer to the `runtime.hchan` struct. The channel's buffer, lock, sendq/recvq, etc. live behind the pointer in the runtime-managed allocation. So `chan T` for any T contributes one word to the containing struct's size.

---

## Q30. What's the layout penalty of using `any` (`interface{}`)?

An `any` field is **16 bytes** (two pointers) regardless of the dynamic value. Plus, assigning a non-pointer concrete value to an `any` typically allocates on the heap (escape analysis fails). So `[]any{int(42)}` is much more expensive than `[]int{42}`. For hot-path code, prefer concrete types over `any`.

---

## Q31. When should you NOT optimize struct layout?

When the struct:

1. Is allocated a small number of times (< 10 000).
2. Is consumed by `encoding/binary` or a wire protocol.
3. Crosses the cgo boundary (Go and C layouts must match).
4. Has a JSON consumer that depends on field declaration order (yes, some do).
5. Is part of a public API where reordering is a versioning concern.

In all those cases, leave the layout alone and document why.

---

## Q32. How do you assert a struct's layout at compile time?

Use `unsafe.Sizeof` and `unsafe.Offsetof` in an `init()` panic:

```go
func init() {
    if unsafe.Sizeof(Packet{}) != 64 {
        panic("Packet layout drifted")
    }
    if unsafe.Offsetof(Packet{}.Payload) != 16 {
        panic("Packet.Payload offset wrong")
    }
}
```

The expressions are compile-time constants; the panic body is the only runtime work, and it fires at program start. Catches accidental field reordering by future maintainers.

---

## Q33. What's `runtime/internal/atomic` and why does it have padded types?

It's the runtime's private atomic package, used by the scheduler and memory allocator. It contains types like `Uint64` and `Pointer` with explicit cache-line padding to prevent the runtime's own hot atomics from false-sharing. User code can't import it (`internal/`), but the `sync/atomic` typed wrappers expose similar safety guarantees for application code.

---

## Q34. Summary

Struct memory layout in Go is governed by a deterministic algorithm: fields in declared order, padded to their alignment, struct size a multiple of struct alignment, with a +1 byte for trailing zero-sized fields. The cost of getting it wrong is bytes-per-allocation × allocation-rate — usually negligible, sometimes the difference between fitting in cache and not, sometimes the source of a 32-bit atomic crash, sometimes the cause of false-sharing pathology in a hot loop. The interview-grade knowledge: alignment table, `FieldAlign` vs `Align` on 32-bit, `fieldalignment` linter, the zero-sized-last-field rule, cache-line padding for hot atomics, and the GC scan implication of pointer-field placement.

---

## Further reading
- Go spec on alignment: https://go.dev/ref/spec#Size_and_alignment_guarantees
- `unsafe` package: https://pkg.go.dev/unsafe
- `reflect.Type`: https://pkg.go.dev/reflect#Type
- `sync/atomic` 32-bit alignment note: https://pkg.go.dev/sync/atomic#pkg-note-BUG
- `fieldalignment`: https://pkg.go.dev/golang.org/x/tools/go/analysis/passes/fieldalignment
