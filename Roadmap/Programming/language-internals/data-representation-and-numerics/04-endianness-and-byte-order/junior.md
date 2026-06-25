# Endianness & Byte Order — Junior Level

> **Topic:** [Endianness & Byte Order](README.md)
> **Focus:** A number bigger than one byte has to be stored as several bytes. *In what order?* That order is called endianness, and getting it wrong silently corrupts data.

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

> Focus: **A 4-byte integer is four bytes. Which byte goes first?**

A single byte (8 bits) can hold a value from 0 to 255. That is tiny. Almost every useful number — a 32-bit `int`, a 64-bit timestamp, a `float`, a pixel — is **bigger than one byte**, so the CPU stores it as a *sequence* of bytes sitting at consecutive memory addresses.

Here is the entire problem in one picture. Take the 32-bit number `0x12345678` (that is `305419896` in decimal). It is made of four bytes:

```text
0x12   0x34   0x56   0x78
```

Now write those four bytes into memory at addresses 100, 101, 102, 103. **In what order?**

```text
Big-endian     (address →)  100:0x12  101:0x34  102:0x56  103:0x78
Little-endian  (address →)  100:0x78  101:0x56  102:0x34  103:0x12
```

Both store the *same number*. They just disagree about which end goes at the lowest address.

- **Big-endian** puts the **big end first** — the most significant byte (`0x12`) at the lowest address. This is "the way you write it on paper," left to right.
- **Little-endian** puts the **little end first** — the least significant byte (`0x78`) at the lowest address. This looks "backwards" to a human but is what your laptop almost certainly does.

That choice — which end goes first — is called **endianness** (or **byte order**). It is one of those topics that you can ignore for months because *everything on one machine agrees with itself*, and then it bites you hard the moment two machines, or a file, or a network packet enter the picture.

> 🎓 **Why this matters for a junior:** The first time endianness will hurt you is when you read a value from a file or a network socket and get a garbage number like `2018915346` instead of the `305419896` you expected. The bytes were fine — they were just in the order the *other* side used. This page teaches you to recognize that bug on sight and to never write the code that causes it.

This page covers: what big- and little-endian are, why your machine is probably little-endian but the network is big-endian, where the funny name comes from, how to detect which one you are on, and the golden rule — **always pick an explicit byte order when data crosses a boundary**.

---

## Prerequisites

What you should know before reading this:

- **Required:** What a byte and a bit are. A byte is 8 bits and holds 0–255.
- **Required:** Hexadecimal notation. `0xFF` = 255, `0x10` = 16. Each two hex digits is exactly one byte.
- **Required:** That an `int` is usually 4 bytes and a `long`/`int64` is 8 bytes.
- **Helpful:** A vague idea that memory is a big array of byte-sized cells, each with an address (a number).
- **Helpful:** Having seen a number printed in hex (e.g. `printf("%x")`).

You do **not** need to know:

- Assembly, `bswap` instructions, or SIMD (that's `senior.md`/`professional.md`).
- Strict aliasing or undefined behavior (that's `middle.md` onward).
- Floating-point bit layout (touched lightly here, deep in higher tiers).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Byte** | 8 bits. The smallest unit memory addresses individually. Holds 0–255 (`0x00`–`0xFF`). |
| **Endianness / Byte order** | The order in which the bytes of a multi-byte value are laid out in memory or on the wire. |
| **Big-endian (BE)** | Most-significant byte at the **lowest** address. "Big end first." Reads like normal written numbers. |
| **Little-endian (LE)** | Least-significant byte at the **lowest** address. "Little end first." What x86/ARM use. |
| **Most significant byte (MSB)** | The byte that carries the largest place value. In `0x12345678`, that's `0x12`. |
| **Least significant byte (LSB)** | The byte that carries the smallest place value. In `0x12345678`, that's `0x78`. |
| **Network byte order** | A convention: network protocols use **big-endian**. Defined by the Internet standards (RFC 791 etc.). |
| **Host byte order** | Whatever your CPU natively uses. On most machines today, little-endian. |
| **Byte swap** | Reversing the order of the bytes of a value to convert between BE and LE. |
| **`htonl` / `ntohl`** | C functions: "host to network long" / "network to host long." Swap (or not) to/from big-endian. |
| **Scalar** | A single numeric value (int, float) — as opposed to a string or array. Endianness applies to scalars. |
| **Wire format** | The exact byte layout data takes when serialized to a file or network. Must pin a byte order. |
| **BOM (Byte Order Mark)** | A special marker at the start of a UTF-16/UTF-32 text file that announces its endianness. |

---

## Core Concepts

### 1. Why a number needs more than one byte

A byte holds 0–255. The number of people on Earth (~8 billion) does not fit in a byte. It does not even fit in two bytes (max 65,535) or four bytes (max ~4.29 billion). It needs eight bytes (a 64-bit integer).

Any time a value needs `N` bytes, the CPU must place those `N` bytes at `N` consecutive memory addresses. **Endianness is the rule that decides the order.** That's all it is. There is no deeper magic.

### 2. Big-endian: the human-friendly order

When you write the number "three thousand four hundred twenty-one" as `3421`, you write the **most significant digit first** (the `3`, worth thousands), then less significant digits, ending with the `1` (worth ones). That is big-endian for *digits*.

Big-endian for *bytes* does the same: most significant byte at the lowest (first) address.

```text
Value 0x12345678 stored big-endian:

address:   100   101   102   103
byte:     0x12  0x34  0x56  0x78
           MSB                LSB
```

If you dump that memory and read it left to right, you see `12 34 56 78` — exactly how the number is written. Big-endian is sometimes called **"network byte order"** because Internet protocols use it.

### 3. Little-endian: the machine-friendly order

Little-endian puts the **least significant byte first**:

```text
Value 0x12345678 stored little-endian:

address:   100   101   102   103
byte:     0x78  0x56  0x34  0x12
           LSB                MSB
```

Read left to right you see `78 56 34 12` — looks reversed. Why would anyone do this? Because it has a quiet advantage: the byte at the lowest address is always the "ones" byte, no matter how wide the number is. A 1-byte, 2-byte, 4-byte, and 8-byte version of the value `5` all start with the byte `0x05` at the same address. That makes some hardware tricks (and reading a wide value as a narrower one) cleaner. Intel chose little-endian for the x86 family, and x86 won the desktop. So **your machine is almost certainly little-endian.**

### 4. The same bytes, two meanings

This is the crux. Take these four bytes sitting in memory:

```text
0x78 0x56 0x34 0x12
```

- Interpreted as **little-endian**: the value is `0x12345678` = 305,419,896.
- Interpreted as **big-endian**: the value is `0x78563412` = 2,018,915,346.

**Nothing about the bytes themselves says which is correct.** The interpretation is a *decision* made by whoever reads them. If the writer and the reader disagree, you get a wrong number — not a crash, not an error, just a silently wrong number. That is what makes endianness bugs sneaky.

### 5. Why it usually doesn't bite you

On a single program, on a single machine, the CPU writes and reads memory with the *same* endianness. The bytes go in one order and come back in the same order. So `x = 5; print(x)` always prints `5`. You can write code for years and never think about endianness.

The trouble starts the moment bytes **leave your machine and come back differently**:

- You write an integer to a **file** on a little-endian laptop, then read it on a big-endian server.
- You send an integer over a **network socket** to another machine.
- You receive a **binary protocol** packet whose spec says "big-endian."
- You read a **binary file format** (image, archive, database page) written by another tool.

At every such boundary, the two sides must agree on byte order — or the number is wrong.

### 6. The convention: network is big-endian

Decades ago the Internet pioneers had to pick *one* byte order for protocol headers (IP addresses, port numbers, lengths), so machines of different endianness could talk. They picked **big-endian**, and it is now called **network byte order**. Every TCP/IP header field is big-endian. That is why C gives you `htons`/`htonl` ("host to network") and `ntohs`/`ntohl` ("network to host"): you call them around every multi-byte field you put on or take off the wire.

### 7. Where the funny name comes from

"Endian" comes from Jonathan Swift's 1726 novel *Gulliver's Travels*. Two factions go to war over which end of a boiled egg to crack first: the **Big-Endians** (big end) versus the **Little-Endians** (little end). The war is gloriously pointless — exactly Swift's joke about religious squabbles. In 1980 the engineer **Danny Cohen** borrowed the term in a famous paper, *"On Holy Wars and a Plea for Peace,"* arguing that the byte-order debate was just as silly: either order works fine, *you just have to agree*. The name stuck.

### 8. Text is (mostly) safe; numbers are not

A subtle, important point. **UTF-8 text has no endianness.** Its bytes are emitted one at a time in a fixed sequence, so there is no "which byte first" question — the string `"AB"` is always `0x41 0x42` everywhere. This is one reason UTF-8 dominates the web.

But **UTF-16 and UTF-32 do have endianness**, because their code units are 2 and 4 bytes wide. That is exactly why those encodings use a **BOM** (Byte Order Mark) at the start of a file: the bytes `FE FF` mean big-endian, `FF FE` mean little-endian. The BOM exists *only* to solve the endianness problem.

---

## Real-World Analogies

**The egg (the original).** *Gulliver's Travels:* crack the big end or the little end of a boiled egg? Both get you to the egg. The fight is about convention, not correctness — exactly endianness.

**Writing a date.** Some countries write `25/06/2026` (day first), others `2026-06-25` (year first). The same date, two orderings. If you don't know which convention a file uses, `04/05` could be April 5th or May 4th. That ambiguity — same data, order matters — is endianness for calendars.

**Reading a phone number split across sticky notes.** Imagine someone writes a 4-digit code on four sticky notes and hands them to you in a pile. If you don't know whether they stacked them "first digit on top" or "last digit on top," you can't reconstruct the number. The notes (bytes) are correct; the *order convention* is what you're missing.

**Stacking plates.** Little-endian is like stacking plates so the smallest is at the bottom; big-endian puts the biggest at the bottom. Either way it's the same set of plates. You only get confused when someone hands you a stack made the other way.

---

## Mental Models

### Model 1: "Lowest address = which end?"

The only question endianness answers: *at the lowest (first) memory address, do we find the big end or the little end of the number?*

- Big-endian → **big** end first.
- Little-endian → **little** end first.

Memorize that single sentence and you can always work out the layout from scratch.

### Model 2: "Bytes are dumb; the reader gives them meaning"

A row of bytes in memory is just `0x78 0x56 0x34 0x12`. It carries *no flag* telling you its endianness. The number you get out depends entirely on how the **reader** chooses to interpret them. Whenever data crosses a boundary, you are choosing an interpretation — make that choice explicit.

### Model 3: "The boundary is where you pay"

Inside one program on one machine, endianness is free and invisible. You only ever pay attention at the **boundaries**: file ↔ memory, network ↔ memory. Mark those boundaries in your mind. That is where conversion code (byte swaps, `htonl`, `binary.BigEndian`) belongs — and *only* there.

### Model 4: "Pick a side and write it down"

The fix for endianness is never "figure out the machine's endianness and adapt." The fix is "**the format declares one fixed byte order, and everyone obeys it**." Big or little — doesn't matter, as long as it's pinned in the spec. Danny Cohen's whole point.

---

## Code Examples

### Detecting your machine's endianness (C)

```c
#include <stdio.h>
#include <stdint.h>

int main(void) {
    uint32_t x = 0x12345678;
    uint8_t  *p = (uint8_t *)&x;   // look at x one byte at a time

    printf("first byte in memory: 0x%02X\n", p[0]);

    if (p[0] == 0x78)
        printf("little-endian (LSB first)\n");
    else if (p[0] == 0x12)
        printf("big-endian (MSB first)\n");
    return 0;
}
```

On a typical laptop this prints `0x78` → little-endian. We store the number, then peek at the *first* byte in memory. If it's the little end (`0x78`), we're little-endian.

### The classic bug: reading bytes with the wrong order (C)

```c
#include <stdio.h>
#include <stdint.h>

int main(void) {
    // Four bytes that arrived from somewhere, big-endian on the wire:
    uint8_t buf[4] = { 0x12, 0x34, 0x56, 0x78 };

    // WRONG on a little-endian machine: just reinterpreting the bytes
    uint32_t wrong;
    __builtin_memcpy(&wrong, buf, 4);
    printf("wrong:   %u\n", wrong);   // prints 2018915346 — garbage!

    // RIGHT: assemble explicitly as big-endian, shift by place value
    uint32_t right = ((uint32_t)buf[0] << 24) |
                     ((uint32_t)buf[1] << 16) |
                     ((uint32_t)buf[2] <<  8) |
                     ((uint32_t)buf[3]);
    printf("right:   %u\n", right);   // prints 305419896 — correct
    return 0;
}
```

The shift-and-OR version is the safe, portable way to read a big-endian value: it spells out exactly which byte has which place value, so it works the same on any machine.

### Reading/writing an explicit byte order (Go)

```go
package main

import (
	"encoding/binary"
	"fmt"
)

func main() {
	buf := []byte{0x12, 0x34, 0x56, 0x78}

	be := binary.BigEndian.Uint32(buf)    // 305419896
	le := binary.LittleEndian.Uint32(buf) // 2018915346

	fmt.Println("as big-endian:   ", be)
	fmt.Println("as little-endian:", le)

	// Writing a number out, big-endian (network order):
	out := make([]byte, 4)
	binary.BigEndian.PutUint32(out, 305419896)
	fmt.Printf("% X\n", out) // 12 34 56 78
}
```

Go makes endianness explicit and unmissable: you literally type `binary.BigEndian` or `binary.LittleEndian`. There is no "host order" temptation. This is exactly the right design.

### Explicit bytes in other languages

```python
# Python — struct: '>' = big-endian, '<' = little-endian
import struct
buf = bytes([0x12, 0x34, 0x56, 0x78])
print(struct.unpack('>I', buf)[0])   # 305419896  (big-endian)
print(struct.unpack('<I', buf)[0])   # 2018915346 (little-endian)
print((305419896).to_bytes(4, 'big').hex())  # 12345678
```

```rust
// Rust — the method name states the order; impossible to forget.
fn main() {
    let buf = [0x12u8, 0x34, 0x56, 0x78];
    println!("{}", u32::from_be_bytes(buf)); // 305419896
    println!("{}", u32::from_le_bytes(buf)); // 2018915346

    let n: u32 = 305419896;
    println!("{:02X?}", n.to_be_bytes());    // [12, 34, 56, 78]
}
```

```java
// Java — ByteBuffer; default is BIG_ENDIAN (the JVM's wire-friendly default).
import java.nio.ByteBuffer;
import java.nio.ByteOrder;

public class E {
    public static void main(String[] a) {
        byte[] buf = {0x12, 0x34, 0x56, 0x78};
        ByteBuffer bb = ByteBuffer.wrap(buf);
        System.out.println(bb.getInt(0)); // 305419896 (big-endian default)
        bb.order(ByteOrder.LITTLE_ENDIAN);
        System.out.println(bb.getInt(0)); // 2018915346
    }
}
```

Notice the pattern across every language: **the API forces you to name the order.** That is the whole lesson — never let byte order be implicit.

---

## Pros & Cons

### Little-endian

| Pros | Cons |
|------|------|
| Lowest byte is always the "ones" byte — reading a wide value as narrower is trivial (`int64` → `int32` is just "use the first 4 bytes"). | Hex dumps read "backwards" to humans, making debugging confusing. |
| Arithmetic carry propagates from the first byte naturally. | Doesn't match how protocols/files written by big-endian tools expect bytes. |
| Dominant on x86 and ARM — most code runs on it. | |

### Big-endian

| Pros | Cons |
|------|------|
| Memory dumps read like written numbers — easy to eyeball. | A wide value's "ones" byte is at a different offset for each width. |
| Matches network byte order, so protocol code reads naturally. | Increasingly rare in hardware; most CPUs are little-endian now. |

The honest takeaway for a junior: **neither is "better."** They're conventions. What matters is agreeing.

---

## Use Cases

You'll consciously think about endianness in these situations:

- **Network code.** Anything you put in a packet header field is big-endian. Use `htonl`/`ntohl` or your language's explicit big-endian writer.
- **Reading binary files.** Image formats, archives, database files — each declares a byte order. You must read it accordingly. (BMP is little-endian; PNG is big-endian.)
- **Custom serialization.** When you define your own binary save format, **pick a byte order and document it.** Most modern formats pick little-endian (matches common hardware) or big-endian (matches network convention) — just be explicit.
- **Cross-platform data exchange.** Sending binary blobs between machines you don't control.

You'll *ignore* endianness when:

- Working with **text** (JSON, CSV, UTF-8) — no byte-order question.
- Staying entirely **inside one process** in memory.

---

## Coding Patterns

### Pattern 1: Convert at the boundary, only at the boundary

```text
[ memory: native ints ]  <--convert here-->  [ file/network: fixed byte order ]
```

Keep your in-memory values as normal native integers. Do byte-order conversion in exactly one place: the serialize/deserialize functions. Never sprinkle swaps through your business logic.

### Pattern 2: Assemble multi-byte values by shifting, not casting

```c
// Reading a big-endian uint16 from a buffer, portably:
uint16_t v = ((uint16_t)buf[0] << 8) | (uint16_t)buf[1];
```

Building the value with shifts is **endianness-independent** — it produces the same result on any machine, because you're describing place values, not memory layout. This is the safest beginner technique.

### Pattern 3: Use the library, don't hand-roll

In Go use `encoding/binary`; in Python use `struct`; in Rust use `to_be_bytes`/`from_be_bytes`; in C use `htons`/`htonl` (or `memcpy` + a swap). These are tested and clear. Hand-written swap loops are where bugs hide.

---

## Best Practices

1. **Always pick an explicit byte order at every boundary.** Big or little — but write it in the spec and in the code. Never "whatever the machine does."
2. **Prefer big-endian (network order) for new wire formats** unless you have a reason to match hardware; it's the long-standing default and the least surprising to other developers.
3. **Use the standard library functions** (`htonl`, `binary.BigEndian`, `struct.pack('>...')`, `to_be_bytes`). They name the order and can't be "accidentally native."
4. **Build multi-byte values with shifts/OR** when reading buffers by hand — that code is endianness-proof.
5. **Document the byte order in your file/protocol spec** in big letters. Future-you will thank present-you.
6. **Use UTF-8 for text.** It sidesteps the whole problem; no BOM, no byte order.
7. **Test your serialization round-trip**: write a value, read it back, assert equality — and ideally test against a known-good byte sequence (a "golden" hex string).

---

## Edge Cases & Pitfalls

- **The silent wrong number.** The #1 endianness bug doesn't crash. You read a length field, get `2018915346` instead of `305419896`, and your program tries to allocate 2 GB or loops forever. When a parsed integer looks absurd, **suspect byte order first.**
- **Casting a struct pointer over a buffer.** Writing `struct Header *h = (struct Header*)buf;` and reading `h->length` reinterprets raw bytes in *native* order — which is wrong if the data is big-endian, *and* may misalign fields. Don't do it (the higher tiers explain why it's also undefined behavior). Read each field explicitly.
- **Forgetting `ntohs`/`ntohl` on receive.** Easy to remember to convert when sending and forget when receiving (or vice versa). Both directions need it.
- **Assuming "my machine is little-endian" forever.** Most are, but not all (some embedded, networking, and older big-endian systems exist). Code that hardcodes the assumption breaks there. Make it explicit instead.
- **Mixing up the number and its bytes.** `0x12345678` is *the number*; `12 34 56 78` are its big-endian *bytes*. Keep them straight when reading hex dumps.
- **UTF-16 without a BOM.** If you get a `.txt` in UTF-16 with no BOM, you genuinely cannot be sure of its endianness — you have to guess. UTF-8 has no such problem.
- **Single bytes are immune.** A `uint8_t`, an ASCII string byte, a `bool` — no endianness, because there's only one byte. The whole topic only applies to values **2 bytes or wider**.

---

## Cheat Sheet

```text
ENDIANNESS = the order of bytes in a multi-byte value.

Number:  0x12345678   (MSB=0x12, LSB=0x78)

Big-endian (BE):     12 34 56 78   <- MSB at lowest address ("big end first")
Little-endian (LE):  78 56 34 12   <- LSB at lowest address ("little end first")

WHO USES WHAT
  x86, ARM (default)............ little-endian   (your laptop)
  Network / Internet protocols.. big-endian      ("network byte order")
  PNG.......................... big-endian
  BMP.......................... little-endian
  UTF-8........................ NO endianness (safe everywhere)
  UTF-16 / UTF-32.............. has endianness  -> needs a BOM

C HELPERS:  htonl/htons (host->net=BE),  ntohl/ntohs (net->host)
Go:         binary.BigEndian / binary.LittleEndian
Python:     struct.pack('>I' big | '<I' little);  int.to_bytes(4,'big')
Rust:       u32::to_be_bytes / from_be_bytes  (and _le_ variants)
Java:       ByteBuffer.order(ByteOrder.BIG_ENDIAN)  (default is BIG)

GOLDEN RULE: at every file/network boundary, pin ONE explicit byte order.
SAFE READ:   value = (b[0]<<8) | b[1];   // shifts = endianness-proof
```

---

## Summary

- A value wider than one byte is stored as several bytes; **endianness** is the order of those bytes.
- **Big-endian** = most significant byte first (lowest address). **Little-endian** = least significant byte first. Same number, different layout.
- Your machine (x86/ARM) is almost certainly **little-endian**; the **network is big-endian** ("network byte order").
- The bytes themselves carry no endianness flag — the **reader** decides the interpretation, so writer and reader must agree.
- Bugs are **silent wrong numbers**, not crashes. When a parsed integer looks absurd, suspect byte order.
- The fix is never "detect and adapt" — it's "**pin one explicit byte order** at every boundary and obey it."
- **UTF-8 text has no endianness** (use it!); UTF-16/32 do and need a BOM.
- Use library helpers (`htonl`, `binary.BigEndian`, `struct`, `to_be_bytes`) — they name the order so you can't get it implicitly wrong.

Endianness is small but unforgiving. Learn the one-sentence rule, mark your boundaries, and pick a side — that's 95% of it. The next tier (`middle.md`) shows *how* to swap bytes correctly, the strict-aliasing trap behind "casting a struct over a buffer," and how floats and UUIDs add their own twists.
