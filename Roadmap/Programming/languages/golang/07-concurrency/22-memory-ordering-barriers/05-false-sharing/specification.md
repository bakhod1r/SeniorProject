---
layout: default
title: False Sharing — Specification
parent: False Sharing
grand_parent: Memory Ordering Barriers
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/22-memory-ordering-barriers/05-false-sharing/specification/
---

# False Sharing — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [What the Go Memory Model Says](#what-the-go-memory-model-says)
3. [What the Go Language Spec Says](#what-the-go-language-spec-says)
4. [The `runtime/internal/sys` Package](#the-runtimeinternalsys-package)
5. [Hardware Specifications](#hardware-specifications)
6. [Compiler Behaviour](#compiler-behaviour)
7. [Memory Alignment Guarantees](#memory-alignment-guarantees)
8. [Implementation Notes Per Architecture](#implementation-notes-per-architecture)
9. [References](#references)

---

## Introduction

False sharing is, strictly speaking, a *performance* phenomenon, not a *correctness* phenomenon. The Go Memory Model is silent on cache lines: it specifies what reads and writes are guaranteed to observe, but says nothing about how the hardware implements them.

This file collects the normative and quasi-normative sources relevant to false sharing in Go:

- The Go Memory Model.
- The Go Language Specification.
- The `runtime/internal/sys` package's `CacheLinePad` and `CacheLineSize` constants.
- Hardware architecture manuals (Intel, ARM).
- Compiler behaviour around struct layout.
- Alignment guarantees in the runtime.

---

## What the Go Memory Model Says

The Go Memory Model (`https://go.dev/ref/mem`) defines happens-before relationships for synchronisation. Direct quotes (paraphrased for layout):

> The Go memory model specifies the conditions under which reads of a variable in one goroutine can be guaranteed to observe values produced by writes to the same variable in a different goroutine.

The model does *not* say:

- How values are physically stored.
- What unit of memory the hardware accesses.
- Whether reads and writes are atomic at the byte, word, or cache-line granularity.
- How the runtime should align variables.

In short: the Go memory model is a software-level contract. False sharing exists at the hardware level, below the memory model's abstraction.

### Implication 1: padding does not change observable behaviour

A program with padded counters and a program with unpadded counters compute the *same answer*. The memory model guarantees the same observations. The only difference is performance.

### Implication 2: no compiler-enforced cache-line alignment

The Go compiler does not insert cache-line padding automatically. It does insert *alignment padding* for hardware alignment requirements (e.g., `int64` must be 8-byte aligned on 32-bit platforms), but never for cache-line size.

### Implication 3: race detector silence

The race detector finds data races: unsynchronised concurrent accesses to the same memory location. False sharing involves *different* memory locations and (often) synchronised access via atomics. The race detector does not warn on false sharing — and is not designed to.

### Synchronisation primitives covered

The memory model defines happens-before for:

- `sync/atomic` operations.
- Channel operations.
- `sync.Mutex` Lock/Unlock pairs.
- `sync.Once` Do.
- `sync.WaitGroup` Add/Done/Wait.
- Goroutine creation and exit.
- `runtime.Gosched`, `runtime.LockOSThread`, etc., as documented.

For each, the model specifies the read/write ordering guarantees. None of these mention cache lines.

---

## What the Go Language Spec Says

The Go Language Specification (`https://go.dev/ref/spec`) defines syntax and semantics. Relevant sections:

### Section: Numeric types

`int64`, `uint64` are 64-bit (8 bytes). Smaller types (`int8`, `int16`, `int32`) are correspondingly sized. The spec does not mandate any alignment beyond what the compiler chooses to satisfy hardware requirements.

### Section: Struct types

> A struct is a sequence of named elements, called fields, each of which has a name and a type. [...] Within a struct, non-blank field names must be unique.

The spec does *not* specify struct layout. A struct of three `int8` fields is *at least* 3 bytes; in practice, the compiler may align to 4 or 8 bytes. Compiler choices are observable via `unsafe.Sizeof` and `unsafe.Offsetof`.

### Section: Size and alignment guarantees

> For a variable x of any type: unsafe.Alignof(x) is at least 1.
> For a variable x of struct type: unsafe.Alignof(x) is the largest of all the values unsafe.Alignof(x.f) for each field f of x, but at least 1.
> For a variable x of array type: unsafe.Alignof(x) is the same as the alignment of a variable of the array's element type.

The spec guarantees a *minimum* alignment based on field types. It does *not* guarantee a *maximum*. A compiler is free to over-align (e.g., to a cache line). In practice, Go's compiler does not over-align.

### Section: Atomic operations

The `sync/atomic` package documents atomic operations on integer types and pointers. Quoting from the package documentation:

> On ARM, 386, and 32-bit MIPS, it is the caller's responsibility to arrange for 64-bit alignment of 64-bit words accessed atomically.

This is the only place the standard library mentions alignment in connection with concurrency. It is about *atomicity*, not false sharing. Note: this requirement is for 64-bit *atomic operations on 32-bit platforms*; the *value* must be 64-bit aligned (8-byte boundary). It does not address cache lines.

### Section: Goroutines and concurrency

The spec describes the `go` statement and references the memory model for synchronisation. No mention of cache or hardware behaviour.

---

## The `runtime/internal/sys` Package

The `runtime/internal/sys` package contains platform-specific constants used by the runtime. It is *internal* — user code cannot import it directly without `go:linkname` tricks.

Public-relevant constants:

### `CacheLineSize`

Defined per platform:

```go
// From runtime/internal/sys (paraphrased layout):

//go:build amd64 || arm64 || mips64 || mips64le || riscv64 || s390x || wasm
const CacheLineSize = 64

//go:build ppc64 || ppc64le
const CacheLineSize = 128

//go:build 386 || arm || mips || mipsle
const CacheLineSize = 32
```

This is the runtime's view of the coherence granularity. It is used internally for padding fields in `sync.Pool`, the scheduler, the semaphore table, and other hot structures.

### `CacheLinePad`

Defined (paraphrased):

```go
type CacheLinePad struct {
    _ [CacheLineSize]byte
}
```

A zero-method struct sized to exactly one cache line. Used as a field type in runtime structs to provide named, documented padding.

### Why not exported

The constants and types are intentionally internal. Reasons:

1. **Stability**: the runtime may change cache line sizes (or add new architectures) without breaking the public API.
2. **Encouragement to measure**: forcing user code to define its own constants encourages explicit choice and measurement, rather than blind reuse.
3. **Architecture-specific tuning**: a user might want 128-byte padding on amd64 (for prefetcher defence) even though the runtime uses 64. The internal constant would obscure this choice.

### Accessing via `go:linkname`

For libraries that want runtime-aware padding (rare):

```go
//go:linkname cacheLineSize runtime/internal/sys.CacheLineSize
var cacheLineSize uintptr
```

This is fragile (subject to runtime refactoring) and not recommended for application code.

---

## Hardware Specifications

### Intel (x86-64)

From the *Intel 64 and IA-32 Architectures Optimization Reference Manual*:

- Cache line size: **64 bytes** (all modern Intel CPUs, since Pentium 4).
- Coherence protocol: MESIF (Modified, Exclusive, Shared, Invalid, Forward).
- L1 cache: typically 32 KB data + 32 KB instruction per core.
- L2 cache: 256 KB - 1 MB per core (varies).
- L3 cache: shared, 1-2 MB per core, several MB to dozens of MB total.

Adjacent-line prefetcher: the L2 cache prefetcher fetches pairs of 64-byte lines as 128-byte units. This means false sharing can occur at the 128-byte level even with 64-byte padding.

Reference: *Intel 64 and IA-32 Architectures Optimization Reference Manual*, section on hardware prefetchers.

### AMD (x86-64)

- Cache line size: **64 bytes** (all modern AMD CPUs).
- Coherence protocol: MOESI (Modified, Owner, Exclusive, Shared, Invalid).
- L1, L2, L3 sizes vary by generation (Ryzen, EPYC).

Reference: *AMD64 Architecture Programmer's Manual Volume 2: System Programming*.

### ARM (ARMv8, ARMv9)

- Cache line size: **64 bytes** on most implementations. **128 bytes** on some Apple Silicon (M1/M2/M3 — confirmed via `sysctl hw.cachelinesize`).
- Coherence protocol: MESI variant (specifics vary by SoC).

For maximum safety on Apple Silicon, pad to 128 bytes. The Go runtime uses 64 (conservative for most ARM, undersized for some Apple).

Reference: *ARM Architecture Reference Manual ARMv8 / ARMv9*.

### PowerPC (ppc64, ppc64le)

- Cache line size: **128 bytes**.
- Coherence protocol: MESI variant.

The Go runtime correctly uses 128 on ppc64.

### RISC-V

- Cache line size: implementation-defined, typically 64 bytes. The Go runtime uses 64.

### Summary

| Architecture | Cache line | Notes |
|--------------|-----------|-------|
| amd64 (Intel, AMD) | 64 | Pad to 128 for prefetcher defence on Intel. |
| arm64 (most) | 64 | |
| arm64 (Apple M-series) | 128 (some implementations) | Pad to 128 for safety. |
| ppc64, ppc64le | 128 | |
| 386, arm, mips | 32 | Less common; 32-bit targets. |

---

## Compiler Behaviour

### Struct field layout

The Go compiler lays out struct fields in declaration order, with alignment padding inserted to satisfy each field's alignment requirement.

Example:

```go
type S struct {
    a int8  // offset 0
    // 7 bytes of alignment padding inserted automatically
    b int64 // offset 8
    c int8  // offset 16
    // 3 bytes of alignment padding inserted automatically
    d int32 // offset 20
}
// total size: 24 bytes
```

This alignment padding is unrelated to cache-line padding. It exists to satisfy hardware alignment for `int64` (which must be 8-byte aligned) and `int32` (4-byte aligned).

The compiler does *not* re-order fields. The order you write is the order in memory.

### Struct size

`unsafe.Sizeof(S{})` reports the total size including alignment padding. For cache-line awareness, this is the value you need to verify against `CacheLineSize`.

### Array layout

`[N]T` lays out N elements of T consecutively, with no inter-element padding. Successive elements are `sizeof(T)` bytes apart. If `sizeof(T)` is a multiple of `CacheLineSize`, each element starts on a (relative) cache-line boundary; otherwise, elements straddle lines.

### Slice layout

A slice is a 3-word header (pointer, length, capacity) — 24 bytes on 64-bit platforms. The slice header itself is at one address; the underlying array is at the pointed-to address. Cache-line considerations apply to the *underlying array*, not the slice header.

### Map layout

Maps are opaque hash tables. Internal layout is not part of the spec. The runtime's `runtime/map.go` implementation uses bucket arrays internally, but concurrent maps writes are *not allowed* (the runtime panics), so map-internal false sharing is moot.

### Channel layout

Channels are opaque. The runtime's `runtime/chan.go` defines `hchan` with internal mutex, buffer, and counters. Send and receive contend on the mutex (so lock contention dominates over cache effects).

### Atomic types

`atomic.Int64`, `atomic.Uint64`, etc., are 8 bytes (the value). The wrapper introduces no extra fields. Two `atomic.Int64`s in a struct are 16 bytes; they pack like raw `int64`s.

---

## Memory Alignment Guarantees

### Heap allocation

The Go runtime's `mallocgc` aligns allocations to the size class. Small objects (≤ size of `*int`) are 8-byte aligned. Larger objects are aligned to their natural alignment (usually 8 or 16 bytes for typical structs).

For 64-byte alignment, the runtime does *not* guarantee it for user-defined structs. A struct sized exactly 64 bytes may be allocated at any 8-byte aligned address — it might cross a 64-byte boundary.

For arrays of 64-byte structs, internal elements are 64 bytes apart (because their stride is 64), but the *first* element may start at a non-cache-line-aligned address.

For most padded-counter use cases, this is acceptable: internal adjacency is what matters.

### Stack allocation

Goroutine stacks are allocated by the runtime in chunks (initially 2 KB, growing as needed). Stack alignment is implementation-specific but typically 8 or 16 bytes. False sharing across stacks is rare in practice.

### Global variables

Global variables are placed in BSS / data segments by the linker. The linker may pack globals densely; two globals can share a cache line. For hot globals, use explicit padding inside their containing struct.

---

## Implementation Notes Per Architecture

### amd64

- `LOCK` prefix on memory operations forces cache-line ownership in exclusive state.
- `CMPXCHG`, `XADD`, `XCHG`, `INC`, etc. with `LOCK` are the atomic primitives.
- Adjacent-line prefetcher operates on 128-byte chunks; false sharing at 64-byte padding can still occur via prefetcher.
- Aligned 8-byte accesses to 8-byte-aligned addresses are atomic without `LOCK` (a guarantee from the architecture).

### arm64

- `LDAR` (Load-Acquire) and `STLR` (Store-Release) provide ordered atomic operations.
- `LDXR`/`STXR` (Load-Exclusive/Store-Exclusive) for CAS.
- 64-byte cache lines on most implementations.
- Some Apple Silicon implementations have 128-byte effective coherence granularity.

### ppc64

- 128-byte cache lines.
- `lwarx`/`stwcx.` for atomic operations.
- Coherence is weaker than x86; explicit memory barriers (`lwsync`, `sync`) are needed for some patterns.

### 32-bit platforms (386, arm)

- `sync/atomic` operations on 64-bit values require the caller to ensure 8-byte alignment.
- The Go compiler attempts to satisfy this but cannot guarantee it for fields whose containing struct is not aligned.
- Cache lines are typically 32 bytes; padding constants adjust accordingly.

---

## References

### Normative Go documents

- **The Go Programming Language Specification** — `https://go.dev/ref/spec`. Defines syntax, semantics, and types.
- **The Go Memory Model** — `https://go.dev/ref/mem`. Defines synchronisation guarantees.
- **`sync/atomic` package documentation** — `https://pkg.go.dev/sync/atomic`. Documents atomic operations and alignment requirements.

### Go runtime source

- `runtime/internal/sys/intrinsics.go` — `CacheLinePad`, `CacheLineSize`.
- `runtime/sync/pool.go` (the `sync` package) — `poolLocal` with explicit padding.
- `runtime/sema.go` — semaphore table with padded roots.
- `runtime/runtime2.go` — per-P struct.
- `runtime/mcache.go` — per-P allocator cache.

### Hardware architecture manuals

- *Intel 64 and IA-32 Architectures Optimization Reference Manual*, Intel Corporation. Section on cache hierarchy and hardware prefetchers.
- *Intel 64 and IA-32 Architectures Software Developer's Manual*, Volume 3: System Programming. Section on memory ordering.
- *AMD64 Architecture Programmer's Manual Volume 2: System Programming*, AMD Corporation.
- *ARM Architecture Reference Manual ARMv8 / ARMv9*, ARM Limited.

### Academic and industry references

- **Ulrich Drepper**, *What Every Programmer Should Know About Memory*. The definitive guide to cache and memory behaviour from a programmer's perspective.
- **Maurice Herlihy and Nir Shavit**, *The Art of Multiprocessor Programming*. Standard text on concurrent data structures.
- **Paul McKenney**, *Is Parallel Programming Hard, And, If So, What Can You Do About It?*. Comprehensive guide; section on cache effects is excellent.
- **LMAX Disruptor paper**, by Martin Thompson et al. The canonical example of a cache-line-aware lock-free queue.

### Tools

- **`perf c2c`** — Linux performance counter tool for cache-to-cache analysis. Documentation in the Linux kernel's `tools/perf/Documentation/`.
- **`pprof`** — Go's profiling tool. Standard library `runtime/pprof` and external `github.com/google/pprof`.
- **`go tool objdump`** — assembly disassembly of compiled Go binaries.
- **`benchstat`** — `golang.org/x/perf/cmd/benchstat`. Statistical comparison of Go benchmark output.

### Go proposal documents (historical / informational)

- Proposals around `sync/atomic` typed wrappers (Go 1.19) — `https://github.com/golang/go/issues/`. Discussions of memory layout and padding rationale.
- Proposals around scheduler tuning — various issues on the Go GitHub repository.

### Non-Go cross-references

- **Java's `@Contended` annotation (JEP 142)** — `https://openjdk.org/jeps/142`. JVM-managed cache-line padding.
- **C++ `std::hardware_destructive_interference_size`** (C++17) — a compile-time constant for the recommended minimum offset between concurrently-accessed objects to avoid false sharing.
- **Rust `crossbeam_utils::CachePadded`** — Rust's standard pattern for cache-padded structures.

### Go community resources

- **"False sharing in Go" blog posts** — various community blogs; search for production case studies.
- **Go forum discussions** — `https://forum.golangbridge.org/` and `https://groups.google.com/g/golang-nuts`. Periodic discussions of false sharing in Go programs.
- **Conference talks** — GopherCon talks on performance often discuss false sharing in real-world Go services.

---

## Summary of Normative Status

| Topic | Where defined | Normative? |
|-------|---------------|------------|
| `go` statement, goroutines | Language Spec | Yes |
| Happens-before | Memory Model | Yes |
| Cache line size | Hardware manuals; `runtime/internal/sys` | Hardware: yes. Go internal: yes (but unstable) |
| Struct field layout | Compiler implementation | Implementation-defined; observable via `unsafe.Sizeof`/`Offsetof` |
| Cache-line padding | Not in spec or memory model | Convention; user-managed |
| Atomic alignment | `sync/atomic` package docs | Yes (for 32-bit platforms) |
| False sharing | Hardware (MESI, etc.) | Implementation detail of the hardware |
| `sync.Pool` padding | `sync/pool.go` source | Implementation; not part of public contract |

The bottom line: the Go memory model and spec define *correctness*. False sharing is a *hardware* phenomenon. The Go runtime acknowledges it by padding internal structures. User code must pad manually, guided by benchmarks and the hardware-architecture references above.
