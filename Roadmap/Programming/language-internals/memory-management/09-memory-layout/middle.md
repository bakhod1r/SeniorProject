# Memory Layout — Middle Level
> **Topic:** [Memory Layout](README.md)
> **Focus:** The mechanisms — packing pragmas, cache lines as the real unit of cost, hot/cold field splitting, and your first encounter with false sharing.

---

## Table of Contents
- [Introduction](#introduction)
- [Prerequisites](#prerequisites)
- [Glossary](#glossary)
- [Core Concepts](#core-concepts)
- [Real-World Analogies](#real-world-analogies)
- [Mental Models](#mental-models)
- [Code Examples](#code-examples)
- [Pros & Cons](#pros--cons)
- [Use Cases](#use-cases)
- [Coding Patterns](#coding-patterns)
- [Best Practices](#best-practices)
- [Edge Cases & Pitfalls](#edge-cases--pitfalls)
- [Summary](#summary)

---

## Introduction

The junior tier established the rule: order fields largest-first to minimize padding. The middle tier explains the **mechanisms** behind that rule and introduces the lens through which all serious layout work is done: the **cache line**.

Alignment and padding are not the goal — they are tools. The real goal is to control which bytes land in the same 64-byte cache line, because that is the granularity at which the CPU actually moves data. From this single fact flow three big middle-level ideas: **packing** (deliberately removing padding, with consequences), **hot/cold splitting** (keeping frequently-touched fields together), and **false sharing** (the disaster that strikes when two CPU cores fight over one cache line).

---

## Prerequisites

- You understand alignment, natural alignment, padding, and trailing padding (junior tier).
- You know that `sizeof` is not the sum of fields, and that reordering shrinks structs.
- You have a working idea of CPU caches: L1 (~32 KB, ~4 cycles), L2 (~256 KB–1 MB, ~12 cycles), L3 (shared, ~40 cycles), main memory (~200+ cycles).
- You can run a microbenchmark in your language of choice and read a wall-clock difference.

---

## Glossary

- **Cache line** — the unit of transfer between cache and memory, almost universally **64 bytes** on x86-64 and modern ARM. Memory is divided into aligned 64-byte lines; touching any byte loads the whole line.
- **Packing** — forcing the compiler to remove padding so fields sit byte-adjacent, even if that means some are misaligned. Done with `#pragma pack`, `__attribute__((packed))`, or `#[repr(packed)]`.
- **Hot field** — a field accessed frequently (often, in a tight loop). **Cold field** — accessed rarely (error messages, debug info, audit timestamps).
- **False sharing** — when two cores write to *different* variables that happen to share one cache line, forcing the line to bounce between cores' caches even though there's no real data dependency.
- **Cache coherence** — the hardware protocol (MESI and relatives) that keeps each core's view of a cache line consistent. It is what makes false sharing expensive.
- **Cache-line fill / writeback** — loading a line into cache / writing a dirty line back to memory or another core.

---

## Core Concepts

### 1. The cache line is the real unit of cost

A modern CPU never reads one byte. When you touch a single `int`, the CPU loads the entire 64-byte cache line containing it. This has two consequences:

- **Spatial locality is free-ish.** The 63 neighboring bytes came along for the ride. If your next access is nearby, it's already in cache — a hit.
- **Layout decides hit rate.** If the fields you use together live in the same line, one fill serves them all. If they're scattered across many lines, you pay a fill per line, and you evict useful data to make room.

So "minimize padding" is really a proxy for "fit more useful data per cache line." A 12-byte struct means ~5 per line (with the line boundary cutting one in half); an 8-byte struct means exactly 8 per line, none split.

### 2. Packing: removing padding on purpose

Sometimes you *want* zero padding — typically to match a binary format (network packet, file header, hardware register block) byte-for-byte. You tell the compiler to pack:

```c
#pragma pack(push, 1)
struct WireHeader {
    uint8_t  version;   // offset 0
    uint32_t length;    // offset 1  (!! misaligned)
    uint16_t flags;     // offset 5
};                      // size 7, no padding
#pragma pack(pop)
```

Or per-struct in GCC/Clang:

```c
struct __attribute__((packed)) WireHeader { /* ... */ };
```

Rust:

```rust
#[repr(packed)]
struct WireHeader { version: u8, length: u32, flags: u16 } // size 7
```

**The trade-off is real and sharp:**

- **Win:** exact byte layout, smaller size, protocol/format compatibility.
- **Cost:** fields may be misaligned. On x86-64 a misaligned scalar read is *legal but slower*. On many ARM, MIPS, SPARC, and most embedded targets it is **undefined behavior** — it can fault and crash, or silently read the wrong bytes.
- **Worse trap (Rust/C):** taking a *reference or pointer* to a packed field is UB even on x86, because the reference type promises alignment the field doesn't have. `&packed.length` is a bug waiting to happen. Copy the field to a local first.

Pack only at trust boundaries (serialization), and read packed fields by **value**, never by pointer.

### 3. Hot/cold field splitting

Not all fields are equal. Consider a connection object touched on every request:

```c
struct Conn {
    int      fd;              // hot: every read/write
    uint64_t bytes_sent;      // hot: every write
    uint64_t bytes_recv;      // hot: every read
    char     peer_name[64];   // cold: logged once on error
    char     last_error[128]; // cold: only on failure
    time_t   created_at;      // cold: diagnostics
};
```

The hot fields total 20 bytes — they'd fit in one cache line. But interleaved with 200 bytes of cold data, the struct spans 4 cache lines, and a hot loop over many `Conn`s drags cold bytes into cache on every iteration, evicting useful data.

**Fix:** split hot from cold. Keep hot fields inline; move cold fields behind a pointer:

```c
struct ConnCold {
    char   peer_name[64];
    char   last_error[128];
    time_t created_at;
};
struct Conn {
    int          fd;          // all hot fields now
    uint64_t     bytes_sent;
    uint64_t     bytes_recv;
    struct ConnCold *cold;    // one pointer; followed only on the rare path
};
```

Now the hot struct is ~32 bytes, two per cache line, and a scan over connections touches only hot lines. The cold data still exists; you just don't pay to haul it on the common path.

### 4. False sharing: the scalability killer

This is the most important — and most surprising — concept in this tier.

Imagine two threads, each incrementing its own counter:

```c
struct Counters {
    uint64_t a;   // thread 1 writes this
    uint64_t b;   // thread 2 writes this
};
```

`a` and `b` are different variables; the threads never touch each other's. Logically there is **no contention**. But `a` and `b` sit in the *same 64-byte cache line*. Cache coherence works at line granularity: when thread 1 writes `a`, the protocol must give core 1 exclusive ownership of the whole line — which means **invalidating** core 2's copy. Then thread 2 writes `b`, stealing the line back and invalidating core 1. The line ping-pongs between cores on every write.

The result: code that should scale linearly with cores instead gets *slower* with more threads. This is **false sharing** — the cores share a cache line, not actual data, yet pay the full coherence cost.

**The fix** is to push each hot, per-thread field onto its own cache line with padding:

```c
struct Counters {
    alignas(64) uint64_t a;   // own line
    alignas(64) uint64_t b;   // own line
};
```

Now writes never collide. Each language has a blessed helper for this (covered in Coding Patterns). The cost is memory: you "waste" ~56 bytes per counter. For hot per-core data that is a trade you take every time — the speedup is often 5–10×.

---

## Real-World Analogies

**The shared whiteboard.** Two people each maintain their own tally on opposite corners of one whiteboard. The rule: only one person may hold the marker at a time, and whoever writes must first grab the whole board. Even though their tallies are unrelated, they constantly snatch the board from each other. Give each person their *own* whiteboard (separate cache lines) and they never wait. That snatching is false sharing; the separate boards are padding.

**Express vs. checked luggage.** Hot fields are your carry-on — always with you, instantly available. Cold fields are checked luggage — you can retrieve them, but only by going to baggage claim (following a pointer). Don't carry your entire wardrobe through security on every trip.

**Shipping containers.** The cache line is a 64-byte container. The crane (memory bus) moves one container at a time. Packing useful goods tightly into each container means fewer crane trips; leaving them half-empty (padding) or filling them with rarely-needed junk (cold fields) wastes every trip.

---

## Mental Models

- **"What lives in this line?"** For any hot access, ask which 64-byte line the field sits in and what *else* rides along. Useful neighbors = good. Cold junk = waste. Another thread's hot data = false sharing.
- **"Padding to shrink vs. padding to separate."** Junior padding is the enemy (waste from misordering). False-sharing padding is the friend (deliberate separation). Same mechanism, opposite intent — know which problem you're solving.
- **"Per-thread state wants its own line."** Any field written concurrently by different threads is a false-sharing suspect. Counters, sequence numbers, per-core stats, ring-buffer head/tail indices.

---

## Code Examples

### Go — measuring false sharing

```go
package main

import (
    "sync"
    "sync/atomic"
)

// Bad: two counters in adjacent slots -> same cache line.
type CountersBad struct {
    a uint64
    b uint64
}

// Good: pad each counter onto its own 64-byte line.
type CountersGood struct {
    a uint64
    _ [56]byte // 8 (uint64) + 56 = 64 bytes
    b uint64
    _ [56]byte
}

func hammer(p *uint64, wg *sync.WaitGroup) {
    defer wg.Done()
    for i := 0; i < 50_000_000; i++ {
        atomic.AddUint64(p, 1)
    }
}

func runBad() {
    c := &CountersBad{}
    var wg sync.WaitGroup
    wg.Add(2)
    go hammer(&c.a, &wg)
    go hammer(&c.b, &wg)
    wg.Wait()
}
// Benchmark runBad vs the padded version: the padded one is typically
// several times faster on a multi-core machine.
```

### C — packing trade-off, read by value

```c
#include <stdint.h>
#include <string.h>

#pragma pack(push, 1)
struct Packet { uint8_t type; uint32_t seq; uint16_t len; }; // 7 bytes
#pragma pack(pop)

uint32_t get_seq(const struct Packet *p) {
    uint32_t seq;
    memcpy(&seq, &p->seq, sizeof seq); // safe: byte copy, no misaligned deref
    return seq;
    // NOT: return p->seq;  -- on strict-alignment CPUs this can fault,
    //      and &p->seq is a misaligned pointer (UB) anywhere.
}
```

### Rust — explicit cache-line padding

```rust
#[repr(align(64))]
struct CachePadded<T>(T);

struct Counters {
    a: CachePadded<std::sync::atomic::AtomicU64>,
    b: CachePadded<std::sync::atomic::AtomicU64>,
}
// Each AtomicU64 now starts a fresh 64-byte line; writes don't collide.
// In real code, prefer crossbeam::utils::CachePadded.
```

---

## Pros & Cons

| Technique | Pros | Cons |
|-----------|------|------|
| **Packing** | Exact byte layout; smaller; format/protocol fit | Misaligned access (slow or UB); pointer-to-field is UB; not portable |
| **Hot/cold split** | Hot scans stay in-cache; fewer line fills | Extra indirection on the cold path; more allocations; more complexity |
| **Cache-line padding (anti-false-sharing)** | Removes coherence ping-pong; can be a multi-× speedup under contention | Burns memory (~56 bytes/field); pointless for non-shared data |

The meta-lesson: each technique trades **memory for speed** or **speed for compatibility**. None is universally good. Apply them where the data is hot or shared; leave cold, rare, single-threaded structs alone.

---

## Use Cases

- **Packing:** parsing/serializing network protocols, file formats, memory-mapped hardware, FFI structs that must match a C ABI exactly.
- **Hot/cold split:** request/connection objects, ORM entities with rarely-used audit columns, game entities with debug metadata, any "fat" object scanned in bulk.
- **Cache-line padding:** per-thread/per-core counters and stats, lock-free queue head/tail indices, sharded locks, the classic disruptor-style ring buffer.

---

## Coding Patterns

**Per-language false-sharing helpers** (memorize these):

- **Java:** `@jdk.internal.vm.annotation.Contended` (or the public `@Contended` with `-XX:-RestrictContended`) pads a field onto its own line.
- **Rust:** `crossbeam_utils::CachePadded<T>` wraps a value to occupy its own line.
- **Go:** manual padding — add a `_ [N]byte` filler, or use a `[64]byte`-sized wrapper. Go has no built-in attribute.
- **C/C++:** `alignas(64)` (C11/C++11) on the field, or `__declspec(align(64))` (MSVC), or pad with a `char _pad[64 - sizeof(field)]`.

**Hot/cold split pattern:** keep hot fields inline; move cold fields into a separately-allocated struct reached by one pointer, populated lazily.

**Pack-at-the-boundary pattern:** define a `#[repr(packed)]` / `#pragma pack` struct *only* for the wire/disk representation; parse it into a normal, well-aligned in-memory struct immediately. Never compute on packed structs.

---

## Best Practices

1. **Think in cache lines, not bytes.** The question is never "how big is this field" but "what shares its 64-byte line."
2. **Pad shared hot fields; never pad ordinary data.** Padding to prevent false sharing is targeted surgery, not a blanket policy.
3. **Pack only at trust boundaries**, and read packed fields by value (`memcpy`/local copy), never via reference or pointer.
4. **Split hot from cold when a struct is both fat and frequently scanned.** If it's small or rarely touched, don't bother.
5. **Always benchmark on the target hardware.** False-sharing and cache effects are invisible in source and depend on core count, cache size, and access pattern.

---

## Edge Cases & Pitfalls

- **Padding for false sharing must account for prefetching.** Some CPUs prefetch *pairs* of lines (128-byte spatial prefetcher). Padding to 128 bytes is sometimes needed; `crossbeam`'s `CachePadded` already handles this per-architecture.
- **Atomics don't prevent false sharing.** Using `atomic` makes operations correct, not contention-free. A contended atomic on a shared line still ping-pongs.
- **Packed + pointer = UB, even on x86.** The CPU might tolerate the read, but the *language* doesn't. `&packed_field` is undefined behavior in C and Rust regardless of architecture.
- **Slices of packed structs are dangerous.** Iterating a `[]PackedStruct` by reference produces misaligned references on every element.
- **The compiler can defeat your hot/cold split** by inlining and keeping cold data alive in registers/caches anyway. Profile to confirm the split actually helped.
- **`_ [56]byte` padding can be wrong after edits.** If you add a field before the pad, the math changes silently. Prefer language helpers or compute the pad from `sizeof`.
- **Sub-line false sharing within one struct.** Two hot fields of the *same* object written by two threads false-share even without arrays. The fix is the same: separate their lines.

---

## Summary

- The **cache line (64 bytes)** is the true unit of memory cost; layout is about controlling what shares a line.
- **Packing** removes padding for exact byte layout (protocols, FFI) but risks misaligned access — slow on x86, UB on strict-alignment CPUs, and always UB to take a pointer to a packed field. Pack at boundaries, read by value.
- **Hot/cold splitting** keeps frequently-used fields together in cache and banishes rarely-used fields behind a pointer, so bulk scans don't drag cold bytes through cache.
- **False sharing** is when two cores write different fields on the same line, ping-ponging it via cache coherence; it silently destroys multi-core scalability. Fix by padding shared hot fields onto their own cache line (`@Contended`, `CachePadded`, manual padding).
- Every technique trades memory or compatibility for speed — apply them surgically to hot or shared data, and always measure on real hardware.

Next, the **senior** tier zooms out to design-level decisions: AoS vs. SoA, pointer chasing vs. flat arrays, object-header overhead across managed runtimes, and data-oriented design.
