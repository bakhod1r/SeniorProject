# Endianness & Byte Order — Tasks & Exercises

> **Topic:** [Endianness & Byte Order](README.md)
> **Focus:** Hands-on exercises to make byte order concrete — detect it, swap it, serialize correctly, and reproduce the classic production bugs so you can recognize them on sight.

---

## Table of Contents

- [How to Use This Page](#how-to-use-this-page)
- [Warm-Up (Junior)](#warm-up-junior)
- [Core (Middle)](#core-middle)
- [Advanced (Senior)](#advanced-senior)
- [Production-Grade (Professional)](#production-grade-professional)
- [Self-Check Quiz](#self-check-quiz)
- [Hints](#hints)
- [Sparse Solutions](#sparse-solutions)

---

## How to Use This Page

Work top to bottom; tiers build on each other. For each task: try it cold, check your output against the **Self-Check**, and only then peek at **Hints**. Full solutions are deliberately sparse — the goal is that you can derive them. Use any language you're comfortable in unless a task names one. Where it helps, dump bytes in hex (`xxd`, `hexdump -C`, `printf("%02X")`, `fmt.Printf("% X")`) and *look* at the layout — seeing the bytes is half the lesson.

---

## Warm-Up (Junior)

### Task 1 — Detect your machine's endianness

Write a program that stores `0x01020304` in a 32-bit integer, then prints the four bytes **in memory order**. State whether your machine is big- or little-endian and how you concluded it.

**Self-check:** On a typical laptop you'll see `04 03 02 01` → little-endian (the little end, `0x04`, is at the lowest address). On a big-endian host you'd see `01 02 03 04`.

---

### Task 2 — Same bytes, two numbers

Given the byte sequence `DE AD BE EF`, compute by hand the unsigned 32-bit value it represents (a) interpreted as big-endian and (b) interpreted as little-endian. Then verify both with code.

**Self-check:** Big-endian = `0xDEADBEEF` = 3,735,928,559. Little-endian = `0xEFBEADDE` = 4,022,250,974. If your two numbers are equal, you made an arithmetic error.

---

### Task 3 — Write a number as explicit big-endian bytes

Write a function that takes a `uint32` and returns its 4 bytes in **big-endian** order, *without* using any library byte-order function (no `htonl`, no `binary.BigEndian`). Use only shifts and masks.

**Self-check:** Input `305419896` (`0x12345678`) must produce `12 34 56 78` on *any* machine. Run it on your (little-endian) laptop and confirm it does NOT produce `78 56 34 12` — if it does, you accidentally relied on memory layout.

---

### Task 4 — Round-trip a value through a file

Write `0x12345678` to a file as big-endian bytes, then read it back and reconstruct the integer. Confirm you recover `305419896`. Now read the *same* file as little-endian and observe the wrong number.

**Self-check:** Big-endian read → `305419896`. Little-endian read of the same file → `2018915346`. Seeing the wrong number is the point: the bytes were fine; the interpretation was wrong.

---

## Core (Middle)

### Task 5 — Implement `bswap16/32/64`

Implement byte-swap functions for 16-, 32-, and 64-bit unsigned integers using only shifts and masks (no intrinsics). Then verify each against your language's intrinsic (`__builtin_bswap*`, `bits.ReverseBytes*` in Go, `u32::swap_bytes` in Rust).

**Self-check:** `bswap32(0x12345678) == 0x78563412`; `bswap16(0x1234) == 0x3412`; `bswap64(0x0102030405060708) == 0x0807060504030201`. Your hand-rolled versions must match the intrinsics exactly.

---

### Task 6 — The unsafe-cast bug, demonstrated

In C, build a `uint8_t buf[8]` holding big-endian bytes for some value. Read a `uint32_t` out of it two ways: (a) the unsafe `*(uint32_t*)(buf+offset)` cast, and (b) the safe `memcpy` + `be32toh`. Use `offset = 1` (unaligned) and compile at `-O2`. Report the results.

**Self-check:** The safe version gives the correct value at any offset. The unsafe version gives a byte-reversed value (endianness bug) and, at `offset=1`, is undefined behavior — it may differ across compilers, warn under `-Wcast-align`, or crash on ARM/SPARC. If both "work" on your x86 laptop, note that this is exactly why the bug ships: it only fails elsewhere.

---

### Task 7 — Portable buffer reader

Write `read_be16`, `read_be32`, and `read_be64` using the **shift-and-OR** idiom (byte-at-a-time). They must be alignment-safe, alias-safe, and host-endianness-independent. Add a length check that returns an error/`None` if the buffer is too short.

**Self-check:** Feeding `00 00 00 00 00 00 00 01` to `read_be64` yields `1`; feeding a 3-byte buffer to `read_be32` returns the error, not a read past the end. Run on any machine — the results must be identical.

---

### Task 8 — Serialize a float portably

Serialize a `float` (e.g. `3.14159`) to 4 big-endian bytes by reinterpreting its bits as a `uint32` (via `memcpy`/`bit_cast`, **not** a pointer cast), swapping to big-endian, and emitting. Deserialize on a (hypothetical) other-endian reader and confirm you recover the value.

**Self-check:** `3.14159f` has IEEE-754 bits `0x40490FD0`, so the big-endian bytes are `40 49 0F D0`. Verify with `printf("%08X", bits)` after the `memcpy`. Confirm you never byte-swapped "the float as a float."

---

### Task 9 — Bitfields are NOT byte order

In C, define `struct { uint8_t lo:4; uint8_t hi:4; } x;` set `x.lo = 0xA; x.hi = 0xB;`, and print the raw byte. Now extract the same nibbles from a byte using explicit shifts (`(b>>4)&0xF`, `b&0xF`). Explain why only the second approach is portable for parsing a wire format.

**Self-check:** The raw byte is `0xBA` or `0xAB` depending on the compiler's bitfield ordering — which is implementation-defined and *separate* from byte endianness. The shift-based extraction is fully under your control and identical everywhere. Conclusion: never parse protocols with C bitfields.

---

## Advanced (Senior)

### Task 10 — Compile-time, branchless conversion

Write a `host_to_be32` that uses **compile-time** endianness detection (`__BYTE_ORDER__` in C, `std::endian::native` in C++20, or `cfg!(target_endian)` in Rust) so it compiles to either the identity (on a BE host) or a single swap (on LE) with **no runtime branch**. Inspect the generated assembly to confirm.

**Self-check:** On x86-64 at `-O2`, the function should compile to a single `bswap eax` (no comparison, no jump). On a BE target it should compile to a plain `mov`/`ret`. If you see a conditional branch, your detection wasn't compile-time.

---

### Task 11 — SIMD bulk swap

Write a function that byte-swaps an array of `uint32` in place using SIMD (`_mm_shuffle_epi8` / `vpshufb`, or `simd` in Rust), with a scalar fallback for the tail. Benchmark it against a scalar `__builtin_bswap32` loop on an array of, say, 16 million elements.

**Self-check:** Output must match the scalar version element-for-element (test the tail: use a length NOT divisible by your lane count). Expect roughly 4–8× throughput improvement (SSSE3 = 4 ints/instr, AVX2 = 8). If results differ at the array's end, your scalar tail is missing or wrong.

---

### Task 12 — Detect a writer's endianness from a magic number

Design a 4-byte magic for a file format such that reading it big-endian vs little-endian gives two *distinct, recognizable* values. Write a loader that reads the magic, decides which endianness the writer used, and reports whether the rest of the file needs byte-swapping. Reject anything that matches neither.

**Self-check:** A file written by your endianness reads `MAGIC` directly; a file written by the other endianness reads `bswap(MAGIC)`; random/foreign data matches neither and is rejected. This is how portable "zero-copy" formats stay portable — you've just built the mechanism.

---

### Task 13 — Round-trip + golden-bytes test

For a small struct `{ uint32 magic; uint16 version; uint64 length; }`, write a big-endian serializer and deserializer. Then write two tests: (a) serialize→deserialize equality, and (b) a **golden test** asserting the exact hex bytes of a known input. Explain why (b) catches bugs (a) cannot.

**Self-check:** The round-trip test (a) passes even if your serializer and deserializer share the *same wrong* byte order (two bugs cancel). The golden test (b) pins the actual on-wire bytes, catching a consistently-wrong order. Both are needed.

---

## Production-Grade (Professional)

### Task 14 — Reproduce the UUID/GUID mixed-endian bug

Take the UUID `00112233-4455-6677-8899-aabbccddeeff`. Produce (a) its RFC-4122 byte layout and (b) its Microsoft GUID byte layout. Write a function that converts between them, and a test proving the *string* round-trips while the *raw bytes* differ in exactly the first 8 bytes.

**Self-check:**
```text
RFC 4122:  00 11 22 33 44 55 66 77 88 99 AA BB CC DD EE FF
MS GUID:   33 22 11 00 55 44 77 66 88 99 AA BB CC DD EE FF
```
Only `Data1` (4 bytes), `Data2` (2), `Data3` (2) reverse; the last 8 bytes are unchanged. If your conversion touches `Data4`, it's wrong. This is the duplicate-records-across-platforms bug — make sure you can spot it.

---

### Task 15 — Canonical key for correct range scans

Build a composite key `(user_id: u64, timestamp: u64)` two ways: once little-endian, once big-endian. Insert several keys into a sorted structure (or just sort the byte arrays) and compare the resulting order to the intended numeric order.

**Self-check:** The **big-endian** keys sort identically to numeric order (correct range scans). The **little-endian** keys sort in a scrambled order. This is why distributed stores use big-endian fixed-width keys.

---

### Task 16 — Protocol that fails loud

Implement a message framing protocol: `[magic:u32-BE][length:u32-BE][payload:length bytes]`. Then write a parser with three defenses — magic check, `length <= MAX_MSG` bound, and a buffer-bounds check. Feed it (a) a valid message, (b) a message whose length field was written little-endian by a buggy peer, and (c) random bytes.

**Self-check:** (a) parses; (b) fails the length-sanity bound (the swapped length is enormous) — *immediately*, not after trying to read gigabytes; (c) fails the magic check. None of the three should hang, over-read, or silently desync. Compare this to a naive parser with no defenses to feel the difference.

---

### Task 17 — Cross-endian hash divergence

Hash a struct of multi-byte integers two ways: (a) by hashing its in-memory representation directly, and (b) by hashing a canonical big-endian serialization. Then byte-swap all the integer fields (simulating a big-endian host's memory) and re-hash both ways.

**Self-check:** Approach (a) produces *different* hashes for the same logical value before/after the swap → on a real mixed-endian fleet this silently double-stores identical content. Approach (b) produces the *same* hash both times. Conclusion: hash canonical bytes, never native memory.

---

## Self-Check Quiz

1. In `0x12345678`, which byte is the MSB and which is the LSB?
2. Your laptop prints `78 56 34 12` for `0x12345678`. Which endianness is it?
3. What is network byte order, and which CPUs match it natively?
4. Why is `*(uint32_t*)buf` wrong in three different ways?
5. What's the difference between `bswap32(x)` and `htonl(x)`?
6. How do you portably serialize a `float`?
7. Are bitfield order and byte endianness the same thing?
8. Why does UTF-8 need no BOM but UTF-16 does?
9. In the MS-GUID vs RFC-4122 layouts, which bytes differ?
10. Why is an mmap'd native-layout file format an "endianness lock"?

*(Answers are derivable from the tier pages; check yourself against `junior.md`–`professional.md`.)*

---

## Hints

- **Task 1:** Take the address of the int, cast to `unsigned char*`, print `p[0..3]`.
- **Task 3:** `b[0] = v >> 24; b[1] = v >> 16; b[2] = v >> 8; b[3] = v;` — note this never reads memory layout, so it's endianness-proof.
- **Task 6:** Compile with `gcc -O2 -Wall -Wcast-align`. To *see* the UB, try the same code on an ARM target or under UBSan (`-fsanitize=alignment`).
- **Task 8:** `uint32_t bits; memcpy(&bits, &f, 4);` then `bits = htonl(bits)`. Never `*(uint32_t*)&f`.
- **Task 10:** C++: `if constexpr (std::endian::native == std::endian::big) return v; else return std::byteswap(v);`
- **Task 11:** The SSSE3 shuffle mask to reverse each 4-byte group is `_mm_set_epi8(12,13,14,15, 8,9,10,11, 4,5,6,7, 0,1,2,3)`. Don't forget the scalar loop for `n % 4` leftovers.
- **Task 12:** Pick a magic whose two interpretations are both unlikely to appear by accident, e.g. an ASCII tag like `"A012"` — `bswap` of it is a different, recognizable constant.
- **Task 14:** Reverse only `g[0..3]`, `g[4..5]`, `g[6..7]`. Leave `g[8..15]` alone.
- **Task 15:** Big-endian works because byte-wise lexicographic order equals numeric order only when the most significant byte comes first.
- **Task 16:** Check magic first, then length bound, then `offset + length <= buffer_len`, *before* touching the payload.

---

## Sparse Solutions

### Task 3 (big-endian serialize, endianness-proof)

```c
void put_be32(uint8_t out[4], uint32_t v) {
    out[0] = (uint8_t)(v >> 24);
    out[1] = (uint8_t)(v >> 16);
    out[2] = (uint8_t)(v >>  8);
    out[3] = (uint8_t)(v);
}
```
Works identically on every machine because it describes place values, not memory layout.

### Task 5 (`bswap32`)

```c
uint32_t bswap32(uint32_t v) {
    return ((v & 0x000000FFu) << 24) | ((v & 0x0000FF00u) << 8) |
           ((v & 0x00FF0000u) >>  8) | ((v & 0xFF000000u) >> 24);
}
```

### Task 7 (portable big-endian readers)

```c
int read_be32(const uint8_t *b, size_t len, size_t off, uint32_t *out) {
    if (off + 4 > len) return -1;
    *out = ((uint32_t)b[off]   << 24) | ((uint32_t)b[off+1] << 16) |
           ((uint32_t)b[off+2] <<  8) | ((uint32_t)b[off+3]);
    return 0;
}
```

### Task 10 (compile-time conversion, C++)

```cpp
#include <bit>
constexpr uint32_t host_to_be32(uint32_t v) {
    if constexpr (std::endian::native == std::endian::big) return v;
    else return std::byteswap(v);   // C++23; or a manual bswap for C++20
}
```

### Task 14 (GUID layout conversion — only first 3 fields)

```c
void guid_layout_swap(uint8_t g[16]) {
    uint8_t t;
    t=g[0]; g[0]=g[3]; g[3]=t;   t=g[1]; g[1]=g[2]; g[2]=t;  // Data1 (4)
    t=g[4]; g[4]=g[5]; g[5]=t;                                 // Data2 (2)
    t=g[6]; g[6]=g[7]; g[7]=t;                                 // Data3 (2)
    // g[8..15] (Data4) intentionally untouched
}
```

### Task 16 (fail-loud framing parser)

```c
int parse_frame(const uint8_t *b, size_t len, uint32_t *plen) {
    if (len < 8) return ERR_SHORT;
    uint32_t magic = (b[0]<<24)|(b[1]<<16)|(b[2]<<8)|b[3];
    if (magic != MAGIC)              return ERR_BAD_MAGIC;   // wrong endian/format
    uint32_t L = (b[4]<<24)|(b[5]<<16)|(b[6]<<8)|b[7];
    if (L > MAX_MSG)                 return ERR_INSANE_LEN;  // swapped length
    if (8u + L > len)                return ERR_SHORT;       // bounds
    *plen = L;
    return OK;
}
```

The rest of the solutions follow directly from these patterns — derive them, then compare with the tier pages.
