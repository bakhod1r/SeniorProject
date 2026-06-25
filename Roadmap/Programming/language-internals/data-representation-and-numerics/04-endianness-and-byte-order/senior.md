# Endianness & Byte Order — Senior Level

> **Topic:** [Endianness & Byte Order](README.md)
> **Focus:** The hardware and compiler reality — `bswap`/`REV`/`MOVBE`, SIMD bulk swapping, compile-time detection, bi-endian architectures — and designing serialization that is endianness-robust by construction.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Code Examples](#code-examples)
8. [Pros & Cons](#pros--cons)
9. [Use Cases](#use-cases)
10. [Coding Patterns](#coding-patterns)
11. [Best Practices](#best-practices)
12. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)

---

## Introduction

> Focus: **What the CPU and compiler actually do when you swap bytes — and how to make endianness a non-issue at the API boundary so callers never get it wrong.**

By now you can read a multi-byte value out of a buffer without invoking undefined behavior. The senior concern shifts from *correctness in the small* to **performance, portability, and API design in the large**:

- How does a byte swap compile? When is it free (folded into a load via `MOVBE`), when is it one `BSWAP`/`REV`, and when does it become a SIMD `PSHUFB` over a whole array?
- How do you detect endianness at **compile time** so the conversion is zero-cost on the native-order host and a single instruction on the other?
- What does a **bi-endian** CPU (ARM, PowerPC, MIPS) actually switch, and what doesn't switch (the cache, the I/O)?
- How do you design a serialization format and its accessor API so that a future engineer *cannot* introduce an endianness bug?

The throughline: **endianness should be invisible at every boundary except one — the serialization layer — and there it should be explicit, total, and tested.** A senior engineer's job is to build that layer so well that application code never touches a byte order again.

> 🎓 **Why this matters at the senior level:** You will own the serialization codec, the wire protocol, or the on-disk format that a hundred other engineers depend on. If your accessors are correct and your format pins byte order unambiguously, endianness bugs disappear from the whole codebase. If they don't, you'll be debugging "the number is wrong on the ARM build" tickets forever. This is leverage.

---

## Prerequisites

- **Required:** Middle tier — the three traps, `memcpy`/shift-and-OR idioms, `htonl` vs `bswap`, float-via-integer.
- **Required:** Comfort reading basic x86/ARM assembly mnemonics (you don't have to write it).
- **Required:** Understanding of compiler optimization levels and intrinsics.
- **Helpful:** Familiarity with SIMD concepts (vector registers, shuffles).
- **Helpful:** Having designed or maintained a binary protocol or file format.

You do **not** need: cache-coherence-protocol depth or large-distributed-format governance — that's `professional.md`.

---

## Glossary

| Term | Definition |
|------|-----------|
| **`BSWAP`** | x86 instruction reversing the bytes of a 32/64-bit register in one op. |
| **`MOVBE`** | x86 instruction that loads/stores while byte-swapping — a *free* swap fused with memory access. |
| **`REV` / `REV16`** | ARM instructions to reverse bytes of a 32-bit word / within each halfword. |
| **`PSHUFB` / `vpshufb`** | x86 SSSE3/AVX byte-shuffle; reorders 16/32 bytes per instruction — used for bulk array swaps. |
| **`__builtin_bswap32/64`** | GCC/Clang intrinsic → `BSWAP`/`REV`. |
| **`std::byteswap`** | C++23 `<bit>` standard byte swap. |
| **`std::endian`** | C++20 `<bit>` enum: `std::endian::native`, `little`, `big` — compile-time endianness query. |
| **`__BYTE_ORDER__`** | GCC/Clang predefined macro: `__ORDER_LITTLE_ENDIAN__` or `__ORDER_BIG_ENDIAN__`. |
| **Bi-endian** | A CPU that can run in either byte order, selectable by a mode bit (ARM, PowerPC, MIPS, SPARC v9). |
| **`SETEND` / `E`-bit** | ARM mechanism to switch data endianness at runtime (`SETEND BE`/`LE`). |
| **Native byte order** | The order the executing CPU/ABI uses for memory scalars. |
| **Constexpr serialization** | Computing serialized bytes at compile time — possible because shift-and-OR is constant-foldable. |

---

## Core Concepts

### 1. How a byte swap compiles

Write the portable shift-and-mask `bswap32`, the `__builtin_bswap32` intrinsic, or `std::byteswap` — at `-O2` they **all compile to the same single instruction**:

```text
x86-64:   bswap eax           ; 32-bit reverse
ARM64:    rev   w0, w0        ; 32-bit reverse
```

The compiler pattern-matches the idiomatic shift/mask sequence and emits the hardware op. So you never need inline assembly for a swap — write the intrinsic (or even the portable C) and trust the optimizer. The portable C version exists precisely so the *one* compiler that lacks the intrinsic still gets a correct (if slightly slower) swap.

### 2. `MOVBE`: the free swap

On Intel Atom/Haswell+ there's `MOVBE` — "move big-endian" — which **loads or stores a value while reversing its bytes**, fused into the memory operation. When you do `be32toh(load)` on such a chip, the compiler can emit a single `movbe` instead of `mov` + `bswap`. The byte swap costs *nothing extra* — it rides on the load you were doing anyway. This is why "convert at the boundary" has essentially zero performance cost on modern hardware: the swap is amortized into the memory access.

### 3. Bulk swapping with SIMD

When you must byte-swap a *large array* (e.g. converting a megabyte of big-endian samples to host order), per-element `bswap` is slow. SIMD shuffles fix this. `PSHUFB` (SSSE3) reorders 16 bytes per instruction according to an index vector; AV2/AVX-512 do 32/64 bytes:

```text
shuffle mask for 4x uint32 swap (per 16-byte lane):
  3 2 1 0  7 6 5 4  11 10 9 8  15 14 13 12
```

One `vpshufb` swaps four 32-bit ints at once. With AVX2 you swap eight per instruction. This is how high-performance codecs (image decoders, columnar databases, network capture tools) convert bulk data — often 8–16× faster than scalar swaps. The compiler auto-vectorizes simple swap loops at `-O3`, but for guaranteed throughput you write the intrinsics.

### 4. Compile-time endianness detection

You want conversion code that is **a no-op on the native-order host and a single swap on the other**, decided at compile time so there's no runtime branch:

```c
#if __BYTE_ORDER__ == __ORDER_LITTLE_ENDIAN__
  #define HOST_IS_LE 1
#elif __BYTE_ORDER__ == __ORDER_BIG_ENDIAN__
  #define HOST_IS_LE 0
#else
  #error "unknown byte order"
#endif
```

In C++20, prefer the standard, type-safe query:

```cpp
#include <bit>
constexpr bool host_is_le = std::endian::native == std::endian::little;
```

Because it's `constexpr`, the compiler eliminates the dead branch entirely: on a little-endian host, `host_to_be` becomes a swap with no branch; on big-endian it becomes the identity, also branchless. This is strictly better than runtime detection — same correctness, zero runtime cost, and it composes into `constexpr` serialization.

> **Why not runtime detection?** The classic `union {uint32_t i; char c[4];}` or `*(char*)&x` runtime check works but adds a branch and defeats constant folding. Use it only when you genuinely don't know the order until runtime (essentially never for a fixed target). Compile-time is the senior default.

### 5. Bi-endian architectures: what actually switches

ARM, PowerPC, MIPS, and SPARC v9 are **bi-endian**: a mode bit selects the byte order for data accesses. Critical nuances:

- The switch affects **how multi-byte loads/stores interpret memory**, not the bytes themselves. Memory is just bytes; the mode decides assembly.
- **Instructions are usually fixed-endian** regardless of the data mode (ARM instruction fetch has its own rule). So "switch to big-endian" means *data*, not *code*.
- ARM offers `SETEND BE`/`SETEND LE` (AArch32) to flip data endianness for a region — historically used to consume big-endian network data on a little-endian-configured core. AArch64 dropped `SETEND`; you use `REV` instead.
- **Almost everyone runs ARM and PowerPC little-endian today** (Linux on ARM64 is LE; even POWER moved to LE for ppc64le). Big-endian ARM/PPC exist mainly in legacy networking gear and some embedded.

The practical upshot: *don't* rely on a runtime endianness mode to do your conversions. Pin byte order in the format and convert explicitly; that works on any mode of any chip.

### 6. The historical big-endian machines (and why network order is BE)

Network byte order is big-endian because the dominant machines of the 1970s–80s — IBM mainframes, the Motorola 68000 (early Macs, Amiga, Sun), PDP-10, and later SPARC and PowerPC — were big-endian. When TCP/IP was specified, BE was the natural "neutral" choice. Then x86 (little-endian) took over the world, leaving us with the permanent friction: **hosts are LE, the wire is BE.** That mismatch is the entire reason `htonl` exists and the entire reason endianness bugs are a perennial.

| Architecture | Endianness |
|--------------|-----------|
| x86 / x86-64 | Little |
| ARM (modern Linux/macOS) | Little (bi-endian capable) |
| RISC-V | Little |
| PowerPC (classic), ppc64 | Big (ppc64le is Little) |
| SPARC | Big (v9 bi-endian) |
| Motorola 68000 | Big |
| IBM z/Architecture (mainframe) | Big |
| MIPS | Bi-endian (both deployed) |
| PDP-11 | Middle-endian (historical curiosity) |

### 7. Designing an endianness-robust format

A format is robust when an engineer *cannot* serialize it wrong:

1. **Pin one byte order in the spec, in writing.** Big-endian is conventional ("network order"); little-endian matches common hardware. Either is fine — *commit*.
2. **Provide the only sanctioned accessors.** Ship `read_be32`/`write_be32` (or a typed reader/writer class) and make the raw buffer private. No one should hand-roll a swap.
3. **Use fixed-width, fixed-order types in the schema.** Avoid native `int`/`long` whose width and order vary. Protobuf, FlatBuffers, Cap'n Proto, and CBOR all pin this.
4. **Add a magic number / version at offset 0.** A magic like `0x89504E47` (PNG's) lets you detect a wrong-endian or wrong-format read immediately — if the magic reads byte-reversed, you know.
5. **Round-trip and golden-bytes tests** in CI, ideally on both an LE and a BE target (or a simulated BE path).

### 8. Float and SIMD-vector byte order

A `float`/`double` follows host integer endianness via its IEEE-754 bit pattern — serialize through the integer (middle tier). For **SIMD vectors** and **struct-of-arrays** data, byte order applies per element; a bulk `PSHUFB` swap handles whole vectors. Beware: some file formats store a vector's *elements* in one order and the *lanes* in another — read the spec, don't assume.

### 9. Why text is the easy case (and the trap that remains)

UTF-8 is byte-order-free — its great virtue. But two traps persist at the senior level:

- **UTF-16 surrogate pairs** are each a 16-bit code unit, so each unit is endian-sensitive; a wrong byte order corrupts the whole stream, not just one character.
- **A "UTF-8 BOM" (`EF BB BF`) is not a byte-order mark** — UTF-8 has no order — it's just a signature some tools emit. It can break parsers (shebangs, JSON) that don't expect leading bytes. Strip it deliberately.

---

## Real-World Analogies

**The customs checkpoint.** Your serialization layer is the only customs checkpoint at the border. Everything entering (deserialize) or leaving (serialize) the country passes through it and gets its paperwork (byte order) normalized. Inside the country (your process), nobody checks passports. Build one excellent checkpoint and the interior is carefree — that's the whole design philosophy.

**The free escalator (`MOVBE`).** A plain swap is taking the stairs (an extra `bswap`). `MOVBE` is an escalator that moves you *and* reorients you in the same motion — you arrive byte-swapped having spent no extra effort, because the reordering rode on the trip you were already taking.

**The assembly line shuffle (SIMD).** Swapping one integer is reversing four cards by hand. `PSHUFB` is a machine that reverses four stacks of cards simultaneously in one pull of a lever — and AVX2 pulls the lever on eight stacks. Bulk work demands the machine, not the hand.

---

## Mental Models

### Model 1: "Convert at the boundary; the boundary is one well-built layer"

Endianness conversion belongs in exactly one architectural layer — the serializer/deserializer. Everything inside is native; everything outside is the format's pinned order. Your job is to make that layer airtight so the rest of the system never touches byte order.

### Model 2: "Compile-time, not runtime"

A fixed-target build knows its endianness at compile time. Encode conversions so the compiler folds the no-op branch away (`std::endian::native`, `__BYTE_ORDER__`). Runtime detection is a code smell unless you genuinely target multiple orders from one binary.

### Model 3: "The swap is (almost) free; correctness is the only cost"

On modern hardware a swap is one instruction, often fused into the load (`MOVBE`) or vectorized (`PSHUFB`). So there's no performance argument for skipping conversion. The only thing skipping it buys you is bugs. Always convert.

### Model 4: "Make wrong code impossible, not just unwritten"

A senior format design doesn't *document* "use big-endian"; it *prevents* anything else — private buffer, sanctioned accessors, fixed-width schema types, a magic number that fails loudly on a wrong-endian read. Design the bug out.

---

## Code Examples

### Branchless, compile-time host↔BE conversion (C++20)

```cpp
#include <bit>
#include <cstdint>
#include <concepts>

template <std::unsigned_integral T>
constexpr T byteswap(T v) noexcept {            // (std::byteswap in C++23)
    auto bytes = std::bit_cast<std::array<std::byte, sizeof(T)>>(v);
    std::ranges::reverse(bytes);
    return std::bit_cast<T>(bytes);
}

template <std::unsigned_integral T>
constexpr T host_to_be(T v) noexcept {
    if constexpr (std::endian::native == std::endian::big) return v;
    else return byteswap(v);                    // single REV/BSWAP, no branch
}
```

`if constexpr` removes the dead branch at compile time. On a big-endian host this is the identity; on little-endian it's one `bswap`. No runtime test, no portability `#ifdef` soup.

### Intrinsic + MOVBE-friendly load (C, GCC/Clang)

```c
#include <stdint.h>
#include <string.h>

static inline uint32_t load_be32(const void *p) {
    uint32_t v;
    memcpy(&v, p, sizeof v);          // alias/alignment safe
#if __BYTE_ORDER__ == __ORDER_LITTLE_ENDIAN__
    v = __builtin_bswap32(v);         // compiler may fuse into MOVBE
#endif
    return v;
}
```

On a Haswell-class CPU, `gcc -O2 -mmovbe` can compile the whole function to a single `movbe` instruction — load and swap fused.

### SIMD bulk swap of uint32 array (x86 SSSE3)

```c
#include <tmmintrin.h>   // SSSE3
#include <stddef.h>
#include <stdint.h>

// Byte-swap N uint32 values in place (N multiple of 4 for the fast path).
void bswap32_array(uint32_t *a, size_t n) {
    const __m128i mask = _mm_set_epi8(
        12,13,14,15,  8,9,10,11,  4,5,6,7,  0,1,2,3);  // reverse each 4 bytes
    size_t i = 0;
    for (; i + 4 <= n; i += 4) {
        __m128i v = _mm_loadu_si128((__m128i const*)(a + i));
        v = _mm_shuffle_epi8(v, mask);                 // PSHUFB: 4 swaps at once
        _mm_storeu_si128((__m128i*)(a + i), v);
    }
    for (; i < n; ++i) a[i] = __builtin_bswap32(a[i]); // scalar tail
}
```

One `pshufb` swaps four 32-bit ints; AVX2's `_mm256_shuffle_epi8` does eight. This is the pattern image and database codecs use for bulk byte-order conversion.

### Constexpr serialization (compile-time bytes, Rust)

```rust
// Rust's to_be_bytes is const-evaluable; the bytes can be baked at compile time.
const MAGIC: u32 = 0x8950_4E47;             // "\x89PNG"-ish
const MAGIC_BE: [u8; 4] = MAGIC.to_be_bytes(); // [0x89,0x50,0x4E,0x47] at compile time

fn check(buf: &[u8]) -> bool {
    buf.get(..4) == Some(&MAGIC_BE)
}
```

### Go — order-pinned codec boundary

```go
type Header struct {
	Magic   uint32
	Version uint16
	Length  uint32
}

func (h *Header) MarshalBE() []byte {
	b := make([]byte, 10)
	binary.BigEndian.PutUint32(b[0:], h.Magic)
	binary.BigEndian.PutUint16(b[4:], h.Version)
	binary.BigEndian.PutUint32(b[6:], h.Length)
	return b
}
func UnmarshalBE(b []byte) (Header, error) {
	if len(b) < 10 { return Header{}, io.ErrUnexpectedEOF }
	return Header{
		Magic:   binary.BigEndian.Uint32(b[0:]),
		Version: binary.BigEndian.Uint16(b[4:]),
		Length:  binary.BigEndian.Uint32(b[6:]),
	}, nil
}
```

The byte order lives *only* in the marshal/unmarshal pair; the struct fields are plain native ints everywhere else.

---

## Pros & Cons

### Compile-time conversion (`std::endian`, `__BYTE_ORDER__`)

| Pros | Cons |
|------|------|
| Zero runtime cost; dead branch eliminated. | Requires knowing the target at build time (fine for almost all targets). |
| Composes into `constexpr` serialization. | Macro path is non-portable across exotic compilers (use C++20 `std::endian`). |

### SIMD bulk swap

| Pros | Cons |
|------|------|
| 8–16× faster for large arrays. | Architecture-specific intrinsics; needs a scalar fallback. |
| Often auto-vectorized at `-O3` for simple loops. | Overkill for small/occasional swaps. |

### Bi-endian runtime mode (`SETEND`)

| Pros | Cons |
|------|------|
| Lets one core consume foreign-order data natively. | Brittle, AArch64 removed it, hard to reason about — prefer explicit `REV`/conversion. |

---

## Use Cases

- **High-throughput codecs** — image/video decoders, columnar/analytics engines (Parquet, Arrow), packet capture — where bulk SIMD swapping matters.
- **Cross-platform binary formats** — you ship one format consumed by LE and (occasionally) BE machines.
- **Embedded/networking firmware** — may run on big-endian or bi-endian cores; conversions must be explicit, not mode-dependent.
- **Protocol stacks** — `MOVBE`/`REV` make per-field conversion negligible; the API design is what matters.
- **Memory-mapped on-disk formats** — where you want the stored order to match host for zero-copy reads (a deliberate trade-off; see professional tier).

---

## Coding Patterns

### Pattern 1: One codec layer, native everywhere else

Confine all byte-order logic to serialize/deserialize functions. Application and domain code use plain native integers. This is the single most important structural rule.

### Pattern 2: Compile-time order selection, branchless

Use `if constexpr (std::endian::native == ...)` (C++) or `__BYTE_ORDER__` `#if` (C) so conversion folds to identity-or-single-swap with no runtime branch.

### Pattern 3: SIMD with a scalar tail

Vectorize the bulk of an array swap; always include a scalar loop for the remainder and for sizes below the vector width. Never assume the array length is a multiple of the lane count.

### Pattern 4: Magic-number sentinel

Put a known magic at offset 0 of every format. A wrong-endian or wrong-format read trips it immediately, turning a silent corruption into a loud, early failure.

---

## Best Practices

1. **Confine byte order to the serialization layer.** Native everywhere else.
2. **Detect endianness at compile time** (`std::endian::native`, `__BYTE_ORDER__`); avoid runtime branches.
3. **Write intrinsics/portable shift-and-OR, not inline asm** — the compiler emits `BSWAP`/`REV`/`MOVBE`.
4. **Use SIMD only for bulk array conversion**, always with a scalar fallback.
5. **Pin one byte order in the format spec and enforce it with private buffers + sanctioned accessors.**
6. **Add a magic number** so wrong-endian reads fail loudly and early.
7. **Use fixed-width schema types** (`uint32` not `int`), never native `int`/`long` whose size/order vary by platform.
8. **Test serialization against golden bytes in CI**, and exercise the big-endian path (a forced-swap build or a BE emulator) at least in unit tests.
9. **Treat any reliance on a runtime endianness mode (`SETEND`) as legacy** — convert explicitly instead.

---

## Edge Cases & Pitfalls

- **Assuming the swap costs measurable time.** On `MOVBE`/`REV` hardware it's effectively free; "I skipped conversion for speed" is almost always a false economy that buys only bugs.
- **Forgetting the SIMD scalar tail.** A swap loop that handles only full vectors silently skips the last 1–3 elements.
- **Relying on auto-vectorization.** `-O3` *may* vectorize a swap loop, but compiler/version differences mean you can't count on it for guaranteed throughput — write intrinsics when it matters.
- **Confusing instruction vs data endianness on bi-endian chips.** Switching data mode does not byte-swap the instruction stream; reasoning about "switch to BE" without that distinction leads to wrong mental models.
- **`ppc64` vs `ppc64le` mismatch.** Building for the wrong PowerPC ABI flips byte order silently. Match the toolchain triple.
- **The "UTF-8 BOM" breaking parsers.** `EF BB BF` is not a byte-order mark; it can corrupt shebang lines, JSON, and CSV headers. Strip it explicitly on ingest.
- **`std::bit_cast`/`memcpy` for float reinterpret, not a cast.** Type-punning a float through a `uint32_t*` is still strict-aliasing UB at this tier too; use `bit_cast`/`memcpy`.
- **Zero-copy mmap formats are endianness-locked.** If you mmap a file and read native ints directly for speed, the file is only readable on hosts of that endianness. That's a legitimate trade-off — but document it loudly; it's a portability landmine otherwise.

---

## Cheat Sheet

```text
HOW A SWAP COMPILES (-O2):
  __builtin_bswap32 / std::byteswap / portable shift-mask  -> x86 BSWAP, ARM REV
  be32toh(load) on Haswell+        -> single MOVBE (free swap fused with load)
  bulk array swap                  -> PSHUFB (SSSE3, 4x) / vpshufb (AVX2, 8x)

COMPILE-TIME DETECTION:
  C:   #if __BYTE_ORDER__ == __ORDER_LITTLE_ENDIAN__
  C++: if constexpr (std::endian::native == std::endian::little)   // <bit>, C++20
  -> dead branch eliminated: identity on native host, one swap on the other

BI-ENDIAN (ARM/PPC/MIPS/SPARCv9): mode bit flips DATA order, not instructions.
  ARM SETEND (AArch32 only); AArch64 uses REV. Most run LE today (ppc64le, ARM64 LE).

WHY BE IS NETWORK ORDER: 1970s-80s machines (68k, SPARC, PPC, mainframes) were BE.

ROBUST FORMAT DESIGN:
  1 pin order in spec   2 private buffer + sanctioned read_be/write_be accessors
  3 fixed-width schema types  4 magic number at offset 0  5 golden-byte CI tests

FLOATS: serialize via integer bit pattern (bit_cast/memcpy), then swap the integer.
```

---

## Summary

- A byte swap is **one instruction** (`BSWAP`/`REV`), often **free** when fused into a load (`MOVBE`), and **8–16× batched** via SIMD (`PSHUFB`/`vpshufb`) for large arrays — so there is no performance excuse to skip conversion.
- **Detect endianness at compile time** (`std::endian::native`, `__BYTE_ORDER__`) so conversion folds to identity-or-single-swap with no runtime branch.
- **Bi-endian** CPUs (ARM, PPC, MIPS, SPARC v9) switch *data* byte order via a mode bit, not the instruction stream; almost all run little-endian today. Don't rely on the mode — convert explicitly.
- **Network byte order is big-endian** for historical reasons (the dominant 1970s–80s machines were BE); x86's later dominance is why LE-host/BE-wire friction is permanent.
- Design formats to make wrong code **impossible**: pin one order in the spec, hide the raw buffer behind sanctioned accessors, use fixed-width schema types, add a magic number, and test against golden bytes — ideally on a big-endian path.
- Confine all byte-order logic to **one serialization layer**; everything inside is native.

The next tier (`professional.md`) covers the production failures: GUID/UUID byte-order confusion across systems, GPT vs MBR partition layout, network-protocol corruption postmortems, mmap'd zero-copy formats as a deliberate endianness lock, and governing byte order across a fleet of heterogeneous services.
