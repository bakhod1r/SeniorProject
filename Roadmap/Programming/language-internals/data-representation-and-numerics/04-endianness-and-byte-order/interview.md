# Endianness & Byte Order — Interview Questions

> **Topic:** [Endianness & Byte Order](README.md)
> **Focus:** Conceptual, language-specific (C/C++, Go, Rust, Java, Python), tricky/trap, and design questions on byte order — with crisp model answers.

---

## Table of Contents

- [Conceptual](#conceptual)
- [Language-Specific](#language-specific)
- [Tricky / Trap](#tricky--trap)
- [Design](#design)

---

## Conceptual

## Question 1

**What is endianness, in one sentence?**

Endianness is the order in which the bytes of a multi-byte scalar (an integer, float, etc.) are laid out at consecutive memory addresses (or on the wire). Big-endian puts the most significant byte at the lowest address; little-endian puts the least significant byte at the lowest address.

## Question 2

**Show how `0x12345678` is stored in big-endian vs little-endian.**

```text
Big-endian     (addr+0 → addr+3):  12 34 56 78
Little-endian  (addr+0 → addr+3):  78 56 34 12
```

Both represent the same number `305419896`; they differ only in which end sits at the lowest address.

## Question 3

**Which is "the big end" and which is "the little end"?**

The big end is the most significant byte (the one with the largest place value — `0x12` in `0x12345678`). The little end is the least significant byte (`0x78`). Big-endian stores the big end first (lowest address); little-endian stores the little end first.

## Question 4

**Why does network byte order exist, and what is it?**

Different machines historically used different byte orders, so network protocols needed *one* agreed order for header fields (IP addresses, ports, lengths) to interoperate. That order is **big-endian**, called "network byte order." It was chosen because the dominant machines when TCP/IP was designed (mainframes, 68k, SPARC, PowerPC) were big-endian.

## Question 5

**Is your typical laptop big- or little-endian? Why?**

Little-endian. x86/x86-64 and (in their common Linux/macOS configuration) ARM are little-endian. x86's market dominance made little-endian the de facto host order. This creates the permanent friction: hosts are LE, the network wire is BE.

## Question 6

**Where does the term "endian" come from?**

From Jonathan Swift's *Gulliver's Travels* (1726): two factions war over whether to crack a boiled egg at the big end or the little end — a satire of pointless dogma. Danny Cohen adopted the term in his 1980 paper *"On Holy Wars and a Plea for Peace,"* arguing the byte-order debate is equally silly: either order works, you just have to agree.

## Question 7

**Does text have endianness?**

UTF-8 does **not** — it emits bytes one at a time in a fixed sequence, so there's no "which byte first" question. That's a major reason UTF-8 dominates the web. UTF-16 and UTF-32 **do** have endianness because their code units are 2 and 4 bytes wide; they use a Byte Order Mark (BOM): `FE FF` = big-endian, `FF FE` = little-endian.

## Question 8

**Do floats have endianness?**

Yes. A `float` (4 bytes) and `double` (8 bytes) are laid out in the same byte order as integers on essentially all platforms (IEEE-754, host order). To serialize one portably you reinterpret its bits as a same-size integer, byte-swap the integer, then write it. There is no operation that "byte-swaps a float as a float."

## Question 9

**How do you detect endianness at runtime?**

Store a known multi-byte value and inspect its first byte:

```c
uint32_t x = 1;
int little = (*(char*)&x == 1);   // 1 if little-endian
```

If the byte at the lowest address is `0x01`, the little end is first → little-endian. Better, detect at *compile* time with `__BYTE_ORDER__` (C) or `std::endian::native` (C++20).

## Question 10

**What's the difference between a byte swap and `htonl`?**

A byte swap (`bswap`) **always** reverses bytes. `htonl` reverses bytes **only if the host is little-endian** — on a big-endian host it's a no-op. So `htonl` is "make this big-endian on any host," which is what you want at a boundary; a hardcoded swap would be wrong on a big-endian machine.

---

## Language-Specific

## Question 11

**(C) What do `htonl`, `htons`, `ntohl`, `ntohs` do?**

They convert between host and network (big-endian) byte order. `h`=host, `n`=network, `l`=long (32-bit), `s`=short (16-bit). `htonl` = host-to-network 32-bit, `ntohs` = network-to-host 16-bit, etc. On a little-endian host they byte-swap; on a big-endian host they're the identity. Use them around every multi-byte protocol field on send/receive.

## Question 12

**(C) Why is `uint32_t v = *(uint32_t*)buf;` dangerous?**

Three independent problems: (1) **endianness** — it reads `buf` in native order, wrong for big-endian wire data; (2) **alignment** — `buf` may be unaligned, which is undefined behavior and can SIGBUS on ARM/SPARC; (3) **strict aliasing** — accessing a `char` buffer through a `uint32_t*` violates aliasing rules and can be miscompiled at `-O2`. Use `memcpy(&v, buf, 4)` (then convert) or shift-and-OR instead.

## Question 13

**(C/C++) What's the safe, portable way to read a big-endian `uint32` from a buffer?**

Shift-and-OR on individual bytes — it's alignment-safe, alias-safe, and host-endianness-independent:

```c
uint32_t v = ((uint32_t)b[0]<<24)|((uint32_t)b[1]<<16)|((uint32_t)b[2]<<8)|b[3];
```

Or `memcpy` then convert: `memcpy(&v,b,4); v = be32toh(v);`.

## Question 14

**(C++) What's the relationship between bitfield order and byte endianness?**

They're separate, both implementation-defined problems. Byte endianness orders the bytes of a scalar; **bitfield layout** (which bits a `:4` field occupies within a byte, and how fields straddle byte boundaries) is independently implementation-defined and can differ across compilers and across BE/LE builds. Conclusion: **never parse a wire protocol with C bitfields** — read the byte and extract bits with explicit shifts/masks.

## Question 15

**(C++) What modern standard tools exist for endianness?**

`std::endian` (C++20, `<bit>`) gives `std::endian::native`/`little`/`big` for compile-time detection; `std::byteswap` (C++23, `<bit>`) does an unconditional byte swap; `std::bit_cast` (C++20) reinterprets a float's bits as an integer without aliasing UB. Together they replace the old macro/`union` hacks.

## Question 16

**(Go) How does `encoding/binary` handle byte order?**

You explicitly choose `binary.BigEndian` or `binary.LittleEndian` and call `.Uint32(buf)` / `.PutUint32(buf, v)` etc. The order is named in the call, handles unaligned slices, and never assumes host order — there's no unsafe cast to misuse. Go deliberately makes byte order impossible to get implicitly wrong.

## Question 17

**(Rust) How do you convert integers to/from a specific byte order in Rust?**

Methods name the order: `u32::to_be_bytes()` / `from_be_bytes()` for big-endian, `to_le_bytes()` / `from_le_bytes()` for little-endian, and `to_ne_bytes()` for native. They take/return fixed-size arrays (`[u8; 4]`), so length and alignment are handled by the type system and there's no aliasing UB. Floats have the same methods (`f32::to_be_bytes`).

## Question 18

**(Java) What's Java's default byte order, and how do you change it?**

The JVM's `ByteBuffer` defaults to **big-endian** (`ByteOrder.BIG_ENDIAN`) — convenient since that's network order. Change it with `buffer.order(ByteOrder.LITTLE_ENDIAN)`. `ByteOrder.nativeOrder()` returns the host's order. Java's primitives themselves don't expose endianness; you only see it when you go through `ByteBuffer` or `DataInputStream` (which is always big-endian).

## Question 19

**(Python) How does `struct` specify byte order?**

A format-string prefix: `>` big-endian, `<` little-endian, `=` native, `!` network (same as big-endian). E.g. `struct.unpack('>I', buf)` reads a big-endian unsigned 32-bit int; `struct.pack('<H', x)` writes a little-endian 16-bit. `int.to_bytes(4, 'big')` / `int.from_bytes(buf, 'little')` are the modern integer-specific equivalents.

## Question 20

**(Python) What does `'!'` mean in a struct format string, and why have both `!` and `>`?**

`!` means network byte order, which *is* big-endian — so `!` and `>` produce identical bytes. `!` exists for readability/intent: it documents "this is a wire format" at the call site, the same way `htonl` reads better than a bare swap. Both also imply standard sizes and no padding (unlike native `@`).

---

## Tricky / Trap

## Question 21

**These four bytes are in memory: `78 56 34 12`. What number is it?**

Trick — it depends on interpretation. As **little-endian** it's `0x12345678` = 305,419,896. As **big-endian** it's `0x78563412` = 2,018,915,346. The bytes alone don't determine the value; the reader's chosen byte order does. That ambiguity is the whole topic.

## Question 22

**A teammate "fixes" an endianness bug by replacing `htonl(x)` with `bswap32(x)`. What's wrong?**

It's only correct on little-endian hosts. `htonl` swaps *conditionally* (no-op on big-endian); a bare `bswap32` swaps *unconditionally*, so on a big-endian host it now produces little-endian bytes where big-endian was wanted — the opposite bug. Never replace a conditional conversion with an unconditional swap.

## Question 23

**A UUID round-trips correctly as a string between Windows and Linux, but byte-wise comparisons of the same UUID fail. Why?**

The Microsoft GUID byte layout stores the first three fields (`Data1` 32-bit, `Data2`/`Data3` 16-bit) in **little-endian**, while RFC 4122 stores all fields big-endian. So the *first 8 bytes are reversed per-field* between the two layouts (the last 8 bytes match). The string form hides this, but raw-byte comparison, hashing, or keying breaks. Fix: compare/key by canonical string (or normalize the bytes), never by host-native bytes.

## Question 24

**Someone reverses all 16 bytes of a GUID to convert MS↔RFC. Why is that wrong?**

Only the first three fields differ between the layouts; `Data4` (the last 8 bytes) is a plain byte array stored identically in both. Reversing all 16 bytes corrupts the clock-sequence and node fields. The correct swap reverses only `Data1` (4 bytes), `Data2` (2), and `Data3` (2).

## Question 25

**Why might an endianness bug pass all tests in debug builds and fail in release?**

Because the underlying cause is often a **strict-aliasing violation** (`*(uint32_t*)charbuf`), and the aliasing-based optimization that miscompiles it only kicks in at `-O2`/`-O3`. At `-O0` the code happens to work; optimized, the compiler reorders or caches loads under the assumption the pointers don't alias, producing wrong results. The fix is `memcpy`/shift-and-OR, not turning off optimization.

## Question 26

**Is `uint8_t` affected by endianness? What about an ASCII string?**

No. Endianness only orders bytes *within* a multi-byte scalar. A single byte has only one byte, so there's nothing to order. An ASCII (or UTF-8) string is a sequence of single bytes emitted in a fixed order — no endianness either. You never `htons` a byte.

## Question 27

**A binary protocol worked perfectly between two services for a year, then started corrupting data when a network appliance was added. Likely cause?**

The protocol probably used **native (little-endian) byte order** for fields like a message length, and the new appliance is **big-endian** (legacy networking gear often is). It reads the length byte-reversed — e.g. 200 becomes ~3.35 billion — then desynchronizes the stream and silently corrupts subsequent messages. Root cause: order wasn't pinned and there's no magic number to fail loud. Fix: pin big-endian, add a magic + length sanity bound, test the BE path.

## Question 28

**What is "middle-endian," and where would you see it?**

A historical mixed byte order. The PDP-11 stored a 32-bit value as two 16-bit words in big-endian word order but little-endian byte order within each word, so `0x12345678` became `34 12 78 56`. You won't meet a PDP-11, but the term survives, and some specs still order multi-word fields surprisingly — always read the spec rather than assuming a uniform order.

## Question 29

**Why can mmap'd "zero-copy" file formats be a portability trap?**

They read native struct fields directly without parsing, so the file's byte order is **locked to the writer's host endianness**. A file written on x86 (LE) is byte-reversed garbage when read raw on a BE host. It's a one-way architectural door: fast, but only portable if you bake an endianness marker + load-time swap into the format (as FlatBuffers/Cap'n Proto/Arrow do, pinning little-endian) or guarantee a homogeneous fleet.

## Question 30

**Is a "UTF-8 BOM" a byte order mark?**

No — UTF-8 has no byte order, so it needs no BOM. The 3 bytes `EF BB BF` some tools prepend are a *signature*, not a byte-order mark. They can break parsers that don't expect leading bytes (shebang lines, JSON, CSV headers), so strip them deliberately on ingest.

---

## Design

## Question 31

**You're designing a new binary wire protocol. What byte order do you choose and how do you enforce it?**

Pin **big-endian** (network order) — it's the least-surprising convention for a protocol. Enforce it by: shipping a shared codec library with sanctioned `read_be*`/`write_be*` accessors (raw buffer private); using fixed-width types (`uint32`, not native `int`); adding a **magic number** at offset 0 and a **version** field so wrong-endian/wrong-version reads fail loud; bounding length fields to reject absurd values; and running conformance/golden-vector tests — including a big-endian execution path — in CI. The goal is to make the wrong order impossible to ship, not merely documented.

## Question 32

**How would you design a UUID storage scheme that's safe across Windows/.NET and POSIX systems?**

Store and compare UUIDs in **one canonical form** — RFC 4122 byte order (or the canonical string) — everywhere. At each boundary with a Windows/.NET source that hands you GUID bytes, normalize by reversing only `Data1`/`Data2`/`Data3`. Never compare, hash, or B-tree-key on host-native or mixed-endian bytes. Document the canonical layout in the data contract so no team reintroduces a second layout.

## Question 33

**You need fixed-width binary keys for a distributed key-value store. What byte order and why?**

**Big-endian, fixed width.** Big-endian byte order makes lexicographic (byte-wise) sort order match numeric order, which is essential for correct range scans in a B-tree/LSM. Fixed width ensures every host produces identical bytes for the same value, so keys, hashes, and dedup content-addresses agree across the fleet. Little-endian keys would sort incorrectly and native-width keys would differ across platforms.

## Question 34

**When is it acceptable to use native byte order (no conversion) in a stored or transmitted format?**

Only when the data never crosses an endianness boundary: e.g., a memory-mapped cache or shared-memory IPC used exclusively within a single host (or a guaranteed-homogeneous fleet), where you deliberately accept the endianness lock for zero-copy speed. Even then, embed an endianness marker so a future foreign-order host can detect and swap rather than silently corrupt. For anything that might travel between machines, always pin an explicit order.

## Question 35

**How do you make a serialization format endianness-robust "by construction"?**

(1) Pin one byte order in the spec, in writing. (2) Make the raw buffer private; expose only order-explicit accessors. (3) Use fixed-width schema types, never native `int`/`long`. (4) Put a magic number at offset 0 so wrong-endian reads fail immediately. (5) Serialize floats via their integer bit pattern; never use C bitfields for fields. (6) Test against golden byte vectors in CI, exercising a big-endian path. The principle: the wrong byte order shouldn't merely be discouraged — it should be unrepresentable in the sanctioned API.

## Question 36

**Two services hash a record to dedup it; the same record produces different hashes on an x86 node and an ARM-BE node. Diagnose and fix.**

They're almost certainly hashing the **in-memory native representation** of multi-byte fields, which differs by host endianness. Same logical value, different bytes, different hash → the same content stored twice. Fix: define a **canonical serialization** (fixed-width big-endian) and hash *that*, normalizing at every ingest point. Hashing must operate on canonical bytes, never on host-native memory.

## Question 37

**Your protocol's length field is read as 3.3 billion and the parser hangs. Walk through the bug and the defenses you'd add.**

A 32-bit length written little-endian and read big-endian (or vice versa) byte-reverses, turning a small length into a huge one (e.g. `0x000000C8` → `0xC8000000`). The parser tries to read gigabytes and hangs or desyncs. Defenses: (1) pin and enforce one byte order; (2) a **magic number** so a wrong-endian peer fails on message #1; (3) a **MAX_MSG length bound** that rejects insane lengths; (4) cross-architecture round-trip/fuzz tests. Together these convert a silent multi-hour corruption into an immediate, debuggable error.
