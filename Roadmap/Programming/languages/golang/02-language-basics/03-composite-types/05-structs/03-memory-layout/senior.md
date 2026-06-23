# Struct Memory Layout — Senior

## 1. The view from `cmd/compile/internal/types`

Everything you've read so far about size, alignment, padding, and trailing pad rules is implemented in one file: `src/cmd/compile/internal/types/size.go`. It's worth opening the source — the algorithm is short and concrete.

The relevant entry point is `CalcSize(t *Type)`. For a struct, it walks the fields, tracks a running offset, inserts padding before each field whose alignment is unmet, sums the field sizes, then rounds the total to the struct's overall alignment.

Roughly (simplified):

```go
// in cmd/compile/internal/types/size.go (paraphrased)
func calcStructOffset(s *Struct) (size, align int64) {
    offset := int64(0)
    structAlign := int64(1)
    for _, f := range s.Fields {
        // Pad to the field's alignment.
        if a := f.Type.Align; a > structAlign {
            structAlign = a
        }
        offset = Rnd(offset, f.Type.Align)
        f.Offset = offset
        offset += f.Type.Size
    }
    // Special: non-zero struct ending in zero-sized field gets +1 byte.
    if last := s.Fields[len(s.Fields)-1]; offset > 0 && last.Type.Size == 0 {
        offset++
    }
    // Round size up to alignment.
    size = Rnd(offset, structAlign)
    return size, structAlign
}
```

`Rnd(x, a)` returns the smallest multiple of `a` that is ≥ `x`. The "if last field is zero-sized" branch is the rule from [middle.md](middle.md) §5. The actual source has more handling for non-Go types (cgo, generics), but for ordinary structs this is the engine.

Two consequences:

1. The compiler is deterministic — for the same Go version on the same platform, the layout is reproducible byte-for-byte.
2. The compiler is **not** intelligent — it doesn't reorder, doesn't combine bools into bytes, doesn't fold equal-sized fields. All "optimization" is the programmer's responsibility.

---

## 2. Native alignment vs `FieldAlign`

The `Type` descriptor carries **two** alignment numbers — see `internal/abi/type.go`:

```go
type Type struct {
    Size_       uintptr
    PtrBytes    uintptr
    Hash        uint32
    TFlag       TFlag
    Align_      uint8
    FieldAlign_ uint8
    // ...
}
```

`Align_` is the alignment when the value is allocated on its own. `FieldAlign_` is the alignment when the value sits inside a struct. For most types these are equal. The exceptions:

| Type | `Align` | `FieldAlign` |
|------|---------|--------------|
| `int64`, `uint64`, `float64`, `complex64` on 32-bit (386, arm) | 8 | 4 |
| Everything else | equal | equal |

Why the discrepancy on 32-bit? Because the **C ABI** of those platforms aligned 64-bit types to 4 bytes inside structs (to match struct layouts emitted by C compilers). The Go compiler honours that for cross-language compatibility. But certain operations — notably atomic 64-bit loads and stores — require 8-byte alignment in hardware. The resolution: on 32-bit you must align 64-bit atomic targets yourself (§6).

`reflect.TypeOf(int64(0)).Align()` returns 8; `reflect.TypeOf(SomeStruct{}).Field(i).Type.FieldAlign()` returns 4 (if the field is `int64` on 32-bit). Both are wired through the same descriptor.

---

## 3. The bitmap the GC reads

Each allocation on the Go heap carries a small **pointer bitmap** describing which of its 8-byte words contain pointers. The GC's mark phase reads this bitmap to know where to recurse.

The bitmap layout is in `runtime/mbitmap.go` (modern Go) and `internal/abi/type.go`. For a struct, the compiler computes `PtrBytes` — the number of bytes from the start of the struct that need scanning. Any tail bytes beyond `PtrBytes` are guaranteed pointer-free and are skipped.

This is why **placing pointer-bearing fields at the start** of a struct reduces GC scan work:

```go
type GCHeavy struct {
    flag1   bool
    flag2   bool
    name    string   // pointer at offset 8 (after padding)
    flag3   bool
    email   string   // pointer at offset 32 (after padding)
}
// PtrBytes = 48 (must scan up to and including the email pointer)
```

vs

```go
type GCLight struct {
    name  string  // offsets 0..15
    email string  // offsets 16..31
    flag1 bool    // offset 32
    flag2 bool
    flag3 bool
}
// PtrBytes = 32 — anything beyond byte 32 is skipped
```

For large heaps with millions of these structs, the saved scan time shows up in `runtime/pprof` profiles under `runtime.scanobject`. The `fieldalignment` analyzer (`-pointerbytes`) reports the optimal pointer-bytes count for any struct.

---

## 4. Cache lines and the false-sharing problem

A CPU loads memory into its cache one **cache line** at a time. On x86_64 and arm64 this line is **64 bytes** (Apple Silicon: 128). When two CPUs write to two different variables that happen to live on the **same cache line**, the cache coherence protocol forces them to ping-pong the line back and forth. Each write invalidates the other CPU's copy. The result is "false sharing": writes that look independent perform like contended writes.

Classic example:

```go
type Counters struct {
    A uint64
    B uint64
}

// Goroutine 1 increments &c.A in a loop
// Goroutine 2 increments &c.B in a loop
```

Both fields fit in one 64-byte cache line. Two CPUs writing to the same line costs each one ~50 ns per write instead of ~1 ns. Throughput drops 50×.

The fix is to pad each counter so it sits alone on a line:

```go
type Counters struct {
    A   uint64
    _pa [7]uint64  // pad to 64 bytes
    B   uint64
    _pb [7]uint64
}

fmt.Println(unsafe.Sizeof(Counters{}))  // 128
```

You'll see this in `runtime/internal/atomic/types.go` where the runtime defines its own padded atomic types. For user code, a simple `_pad [N]byte` blank field works:

```go
type PaddedCounter struct {
    n   atomic.Uint64
    _   [56]byte  // 8 (n) + 56 = 64 bytes total
}
```

Measure with `BenchmarkParallel` and `runtime.GOMAXPROCS(N)` set to ≥2. Without padding, perf flatlines or **regresses** as N grows; with padding, it scales.

---

## 5. The `//go:align` directive (Go 1.23+)

Go 1.23 added a compiler directive `//go:align N` (where N is a power of two) that lets you specify a larger alignment for a top-level variable. It exists for very specific cases: SIMD pointers, hardware mailboxes, atomically-accessed 64-bit values on 32-bit platforms.

```go
//go:align 64
var hot Counter
```

`unsafe.Alignof(&hot)` will return 64. It does **not** apply to struct fields (you can't decorate a field). For struct fields you achieve the same effect with explicit padding.

Use it sparingly; the compiler enforces it as a hard constraint and the linker will refuse to lay out an over-aligned variable in a section that can't accommodate it.

---

## 6. The 32-bit `atomic.AddUint64` bug

This is the most famous Go layout bug in the wild. The setup:

```go
type Counter struct {
    enabled bool
    count   uint64  // FieldAlign = 4 on 32-bit
}

func (c *Counter) Add() {
    atomic.AddUint64(&c.count, 1)  // PANIC on 32-bit ARM
}
```

On a 32-bit platform, the struct's layout is:

| Offset | Field |
|--------|-------|
| 0 | enabled (1) |
| 1–3 | pad |
| 4 | count (8) — aligned to 4 (FieldAlign), not 8 |

`atomic.AddUint64` requires its target to be **8-byte aligned** because the LDREXD/STREXD instruction pair on 32-bit ARM requires it. A 4-byte aligned target causes a SIGBUS or, depending on the platform, undefined behaviour.

The Go docs in `sync/atomic` state this explicitly:

> On ARM, 386, and 32-bit MIPS, it is the caller's responsibility to arrange for 64-bit alignment of 64-bit words accessed atomically. The first word in a variable or in an allocated struct, array, or slice can be relied upon to be 64-bit aligned.

The fix is to put the atomic field **first** in the struct:

```go
type Counter struct {
    count   uint64  // offset 0 — guaranteed 8-byte aligned even on 32-bit
    enabled bool
}
```

Or, since Go 1.19, use the new `sync/atomic` types which **internally pad themselves**:

```go
type Counter struct {
    enabled bool
    count   atomic.Uint64  // self-aligning; safe anywhere in the struct
}
```

`atomic.Uint64` (and its siblings `Int64`, `Pointer`) are structs that contain an unexported `align64` field arranged to force 8-byte alignment regardless of position. See `src/sync/atomic/type.go`.

If your codebase ever runs on 32-bit (arm, 386, mips), the `atomic.Int64`/`Uint64` types are mandatory. On 64-bit-only code they're still recommended for readability.

---

## 7. Why ARM is stricter than amd64

x86_64 has decades of legacy supporting misaligned access — most instructions silently tolerate it. The penalty is a few cycles. Even an aligned-to-1 `mov` on `int64` works.

ARM and other RISC architectures historically required strict alignment: misaligned access traps. Newer ARMv8 cores relaxed this for ordinary loads/stores but kept it for **exclusive** (LDREX/STREX) and **load-acquire** (LDAR) instructions used in atomics. Result:

| Platform | Misaligned ordinary load | Misaligned atomic |
|----------|--------------------------|-------------------|
| amd64 | Slow but works | Works (LOCK CMPXCHG tolerates) |
| arm64 | Usually works | Traps |
| 386 | Slow but works | LOCK CMPXCHG8B requires alignment on some CPUs |
| arm (32-bit) | Traps | Traps |

The Go compiler emits alignment-aware code for all platforms it targets. The pitfalls are in user code that uses `unsafe.Pointer` arithmetic to produce pointers the compiler didn't bless.

---

## 8. Stack vs heap layout — same rules

A struct laid out on the goroutine stack follows the same algorithm as a heap-allocated one. Escape analysis decides where the struct lives; layout doesn't change.

There is one subtlety: the **stack** is contiguous and grows downward (typically). Large structs allocated on the stack may push the goroutine over its current stack size and trigger a growth, which copies the entire stack to a new, larger one and adjusts pointers. The size of the struct affects how often this happens.

To check: `go build -gcflags='-m=2' ./...` shows escape decisions per allocation. A struct printed as `moved to heap` escapes; `does not escape` stays on the stack.

For layout purposes the rule is: **don't put massive arrays in your struct if you allocate one per request**. A `struct { buf [4096]byte; ... }` is 4 KiB per allocation; if it escapes, that's heap pressure; if it stays on the stack, it's stack growth pressure.

---

## 9. Reading the layout from a binary

Sometimes you need to verify what the linker actually emitted. Tools:

```bash
go build -o app ./cmd/app

# Inspect data section sizes
go tool nm -size -sort=size ./app | head -20

# Inspect DWARF debug info for struct layouts (requires -ldflags without -w)
go build -gcflags='all=-dwarflocationlists=true' -o app ./cmd/app
go tool objdump -s 'main\.Foo' ./app | head -50

# Use a third-party tool
go install honnef.co/go/tools/cmd/structlayout@latest
structlayout -json mypkg.Foo
structlayout-pretty mypkg.Foo
```

`structlayout` produces JSON describing every field, offset, and pad slot:

```json
[
  {"Field": "Foo.a", "Start": 0, "End": 1, "Size": 1, "Align": 1, "Type": "bool"},
  {"Field": "Foo.b", "Start": 8, "End": 16, "Size": 8, "Align": 8, "Type": "int64", "PadBefore": 7}
]
```

`structlayout-pretty` renders an ASCII diagram. Pipe it through `structlayout-svg` for a graphical view. Use in code review when discussing struct shape.

---

## 10. Cgo and struct layout

When a Go struct corresponds to a C struct (via `cgo`), the Go and C layouts **must match** byte-for-byte for fields you read on both sides. The Go cgo machinery emits Go types like `_Ctype_struct_foo` whose layout matches the C compiler's output.

```c
// header.h
struct point { int32_t x; int64_t y; };
```

On 32-bit Linux, the C struct is 12 bytes (`x` at 0, `y` at 4 with no padding because the C ABI aligns `int64_t` to 4 in structs on 32-bit Linux). The Go side `_Ctype_struct_point` follows the same convention. **But** on 64-bit Linux, the C struct is 16 bytes (`x` at 0, pad, `y` at 8). cgo handles both.

The trap: writing a Go struct **by hand** that you intend to pass to C:

```go
type Point struct {
    X int32
    Y int64
}
// On 64-bit Linux: 16 bytes (4 + 4 pad + 8)
// On 32-bit Linux: also 16 bytes — because Go's int64 has Align 8 even on 32-bit
// But C struct point on 32-bit is 12 bytes
```

Mismatch on 32-bit. The fix is to declare the Go struct via cgo's auto-generation, or to add explicit padding to match C's expectation. Never assume Go's layout matches C's; verify with `unsafe.Sizeof` on both sides and a sample integration test.

---

## 11. `fieldtrack` and other obscure runtime layout

There are corners of the runtime that touch struct layout indirectly:

- **`//go:nosplit`** — a function annotation, not a layout one, but it affects how stack-allocated locals are arranged (no stack-check prologue).
- **`fieldtrack`** — a build-tag-gated mechanism (deprecated) that tracked which struct fields were actually used at link time; intended for dead-code elimination of unused struct fields. Removed from public-facing builds; mentioned here for completeness.
- **`runtime.SetFinalizer`** — adds metadata to an allocation but doesn't change struct layout. The metadata lives in a parallel runtime table.
- **`//go:notinheap`** — marks types that the GC must never see on the heap. Used for `*mheap`, `*g`, etc. inside the runtime. Forbidden in user code.

You won't manipulate these. They appear when reading runtime sources.

---

## 12. `linkname` reveals runtime layouts

Some runtime structs have **public** equivalents in `internal/abi` that user code can read via `go:linkname`. The most common: pulling `runtime.g` (the goroutine struct) fields for tracing.

For struct layout, you can use this to inspect runtime types' layouts without copying definitions:

```go
//go:linkname mcacheSize runtime.mcacheSize
var mcacheSize uintptr
```

This is its own topic — see `10-linkname-directive` (a sibling at the language-basics level). For the struct-layout angle, the relevant fact is: **runtime types' layouts are not stable across Go releases**. If you `linkname` into them you're betting on the layout. The runtime team is willing to break you.

---

## 13. Empty struct alignment quirks

`struct{}` has `Align = 1`. This is the smallest possible alignment, meaning a `struct{}` can be placed at any address. Conceptually two `struct{}` values occupy the same address. The Go runtime exploits this: a `map[K]struct{}` (a set) uses zero bytes per value entry — the hashmap allocates space for keys and metadata only.

```go
m := map[int]struct{}{}
m[1] = struct{}{}
m[2] = struct{}{}
fmt.Println(unsafe.Sizeof(m[1]))   // 0 — but be careful, this is the value type, not the map slot
```

Two oddities to remember:

1. **Pointer identity**: `&struct{}{} == &struct{}{}` is **not guaranteed**. The compiler may make these equal or not, depending on escape analysis. Don't rely on identity of zero-sized values.
2. **Channel signalling**: `chan struct{}` is the idiomatic "signal-only" channel. The signal itself is the send/receive; the value carries nothing.

---

## 14. A practical layout review checklist

When reviewing a struct in code review, ask:

1. **Will this struct be allocated in bulk?** (Slices of N>10k, per-request, per-message.)
2. **What's its current size? What's the optimal size?** (`fieldalignment` answer.)
3. **Are any fields atomically accessed?** (Use `atomic.Int64` etc.; consider padding to a cache line if heavily contended.)
4. **Is any field a marker `struct{}` at the end?** (Move it earlier or remove; the +1 byte rule wastes 8 bytes after rounding.)
5. **Are pointer fields clustered near the start?** (For GC scan efficiency.)
6. **Does the struct shape match a wire format?** (If yes, leave the order alone and document why.)
7. **Will this run on 32-bit?** (If yes, `atomic.Int64` only; not raw `int64` + `atomic.AddInt64`.)

A 30-second pass through this list catches 90 % of layout-related issues.

---

## 15. Summary

Senior knowledge of Go struct layout means knowing the compiler's algorithm — implemented in `cmd/compile/internal/types/size.go` — and the runtime-side constraints it serves: GC scan via the pointer bitmap, atomic alignment on 32-bit, cache-line geometry for parallel writes. The two-number alignment (Align vs FieldAlign) explains the 32-bit `int64` ABI compromise; the cache-line cost of false sharing motivates explicit padding around hot atomics; the `//go:align` directive (1.23+) and the `atomic.Uint64` type are the modern tools that make these problems disappear. Tools to keep in the toolbox: `fieldalignment`, `structlayout`, `go tool nm`, and (cautiously) `go:linkname` for inspecting runtime types.

---

## Further reading

- Compiler size algorithm: https://github.com/golang/go/blob/master/src/cmd/compile/internal/types/size.go
- Type descriptor (`internal/abi`): https://github.com/golang/go/blob/master/src/internal/abi/type.go
- `atomic.Uint64` source: https://github.com/golang/go/blob/master/src/sync/atomic/type.go
- `runtime/internal/atomic`: https://github.com/golang/go/tree/master/src/runtime/internal/atomic
- `sync/atomic` doc on 32-bit alignment: https://pkg.go.dev/sync/atomic#pkg-note-BUG
- `//go:align` proposal: https://github.com/golang/go/issues/19057
- `structlayout`: https://pkg.go.dev/honnef.co/go/tools/cmd/structlayout
