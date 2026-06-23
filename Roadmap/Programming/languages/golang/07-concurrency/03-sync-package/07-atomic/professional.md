# sync/atomic — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [How `atomic.Int64.Add` Compiles on x86](#how-atomicint64add-compiles-on-x86)
3. [How `CompareAndSwap` Compiles on ARM64](#how-compareandswap-compiles-on-arm64)
4. [Cache Coherence and the MESI Protocol](#cache-coherence-and-the-mesi-protocol)
5. [Memory Barriers and the `LOCK` Prefix](#memory-barriers-and-the-lock-prefix)
6. [Runtime Source — `runtime/internal/atomic`](#runtime-source--runtimeinternalatomic)
7. [`atomic.Value` Implementation](#atomicvalue-implementation)
8. [Compiler Intrinsics and SSA](#compiler-intrinsics-and-ssa)
9. [The Cost of Sequential Consistency on Weak Architectures](#the-cost-of-sequential-consistency-on-weak-architectures)
10. [Race Detector Internals](#race-detector-internals)
11. [Reading the Source](#reading-the-source)
12. [Summary](#summary)

---

## Introduction

The professional level is where Go's `sync/atomic` stops being a library and starts being a thin layer over CPU instructions. You read `runtime/internal/atomic/asm_amd64.s` to see exactly what `Add` emits. You know which line in the SSA compiler turns `atomic.Int64.Add(&x, 1)` into the `LOCK XADDQ` instruction. You can explain why the same line on ARM64 emits an LL/SC loop and what that costs in cycles.

References are to Go 1.22 source; line numbers approximate.

---

## How `atomic.Int64.Add` Compiles on x86

On amd64, Go's `atomic.Int64.Add` ultimately calls `runtime/internal/atomic.Xadd64`. The implementation is in `runtime/internal/atomic/asm_amd64.s`:

```asm
// uint64 Xadd64(uint64 volatile* val, int64 delta)
// Atomically:
//     *val += delta;
//     return *val;
TEXT ·Xadd64(SB), NOSPLIT, $0-24
    MOVQ ptr+0(FP), BX
    MOVQ delta+8(FP), AX
    MOVQ AX, CX
    LOCK
    XADDQ AX, 0(BX)
    ADDQ  CX, AX
    MOVQ AX, ret+16(FP)
    RET
```

The instruction sequence:

1. Load the pointer to `val` into `BX`.
2. Load `delta` into `AX`. Save a copy in `CX` for the post-increment compute.
3. `LOCK XADDQ AX, 0(BX)` — the heart of the operation. This is the **lock-prefixed exchange-and-add** instruction. It atomically:
   - Loads `*BX` into a temporary.
   - Adds `AX` to `*BX`.
   - Stores the old `*BX` value into `AX`.
4. `ADDQ CX, AX` — `AX` now holds the *old* value plus `delta`, which is the new value. This is what the function returns.

The `LOCK` prefix guarantees:

- The instruction is atomic with respect to all other CPUs. No other CPU can observe a partial write.
- A full memory barrier: all loads/stores before the LOCK are visible to all CPUs before any load/store after.
- On modern x86, the CPU uses cache-coherency rather than literally locking the bus, so the cost is "exclusive access to this cache line" rather than "stall the entire memory system."

Approximate cost: 10-20 CPU cycles uncontended (~3-5 ns on a 4 GHz CPU). Contended: 50-500 cycles depending on how many cores compete for the cache line.

### `atomic.StoreInt64`

```asm
TEXT ·Store64(SB), NOSPLIT, $0-16
    MOVQ ptr+0(FP), BX
    MOVQ val+8(FP), AX
    XCHGQ AX, 0(BX)
    RET
```

A plain 64-bit MOV is already atomic on aligned x86. Why `XCHGQ`? Because Go's atomics are sequentially consistent, and `XCHG` is implicitly LOCK-prefixed (acts as a full barrier). A plain `MOV` would not establish the barrier; subsequent loads on other CPUs could appear reordered.

Alternative: `MOV` followed by `MFENCE`. On most CPUs, `XCHG` is as cheap as `MOV + MFENCE` and uses one instruction slot. The compiler picks `XCHG`.

### `atomic.LoadInt64`

```asm
TEXT ·Load64(SB), NOSPLIT, $0-16
    MOVQ ptr+0(FP), AX
    MOVQ 0(AX), AX
    MOVQ AX, ret+8(FP)
    RET
```

A simple `MOV`. Aligned 64-bit reads on x86-64 are atomic. Sequential consistency requires no special instruction for loads — x86 already provides total store order. The result: atomic load on x86 is *literally free* compared to a non-atomic load. The compiler still emits the function call (in Go 1.19+ this is often inlined to a single MOV).

### `atomic.CompareAndSwapInt64`

```asm
TEXT ·Cas64(SB), NOSPLIT, $0-25
    MOVQ ptr+0(FP), BX
    MOVQ old+8(FP), AX
    MOVQ new+16(FP), CX
    LOCK
    CMPXCHGQ CX, 0(BX)
    SETEQ ret+24(FP)
    RET
```

The classic `LOCK CMPXCHG` pattern. `CMPXCHG` compares `AX` with the memory location; if equal, stores `CX` there. The Zero flag (`ZF`) indicates success. `SETEQ` writes that flag as the return bool.

This is the foundation. Every higher atomic operation (`Add`, `Swap`, `Or`, `And`) is built from `CMPXCHG` directly or has a dedicated instruction (`XADD`, `XCHG`, etc.) that the CPU implements as if it were a `CMPXCHG` loop in hardware.

---

## How `CompareAndSwap` Compiles on ARM64

ARM64 has a weaker memory model than x86 and uses **load-linked / store-conditional** (LL/SC) for atomics. The implementation is in `runtime/internal/atomic/asm_arm64.s`:

```asm
// bool Cas64(uint64 *ptr, uint64 old, uint64 new)
TEXT ·Cas64(SB), NOSPLIT, $0-25
    MOVD    ptr+0(FP), R0
    MOVD    old+8(FP), R1
    MOVD    new+16(FP), R2
again:
    LDAXR   (R0), R3            // load-linked, acquire
    CMP     R1, R3
    BNE     fail
    STLXR   R2, (R0), R4        // store-conditional, release
    CBNZ    R4, again           // retry on store fail
    MOVB    $1, ret+24(FP)
    RET
fail:
    CLREX                       // clear exclusive monitor
    MOVB    $0, ret+24(FP)
    RET
```

Step-by-step:

1. `LDAXR (R0), R3` — Load-Acquire eXclusive Register. Reads `*R0` into `R3` and marks the cache line as "exclusive monitor armed" for this CPU. The "Acquire" semantics provide a memory barrier.
2. Compare with `old` (in `R1`). If unequal, clear the exclusive monitor and return `false`.
3. `STLXR R2, (R0), R4` — Store-Release eXclusive Register. Attempts to store `R2` to `*R0`. Succeeds only if the exclusive monitor is still armed for this CPU — i.e., no other CPU has written to the line. Result in `R4`: 0 on success, 1 on failure.
4. If the store failed (another CPU got there first), retry from `again`.

The LL/SC pattern is fundamentally a loop because the SC can spuriously fail (the kernel preempting the thread also clears the monitor). On amd64, `CMPXCHG` does not have this spurious-failure problem.

ARMv8.1+ added direct atomic instructions (`LDADD`, `CAS`, `SWP`) that do not need LL/SC. Go can use them when available (controlled by build flags). The performance is similar to x86 — single-instruction atomics with cache-coherence semantics.

### Cost on ARM64

- LL/SC pair: typically 5-10 cycles uncontended, but always at least one barrier instruction (`DMB ISH` or via the acquire/release form). Sequential consistency requires both halves to be barriered.
- ARMv8.1 atomics: comparable to x86 (`LOCK CMPXCHG`).
- Contended: cache-line bouncing dominates, same on x86 and ARM.

---

## Cache Coherence and the MESI Protocol

To understand atomic op costs, you need to understand cache coherence. Modern CPUs have per-core L1/L2 caches; they must agree on the state of memory. The standard protocol is **MESI** (Modified, Exclusive, Shared, Invalid):

| State | Meaning |
|---|---|
| **M (Modified)** | This cache holds the only valid copy; main memory is stale. |
| **E (Exclusive)** | This cache holds the only copy; main memory is up to date. |
| **S (Shared)** | Multiple caches hold this line; all consistent with memory. |
| **I (Invalid)** | This cache's copy is stale; must reload. |

When a CPU wants to write a line, it must get the line into M state. If another CPU has it in S or M, the protocol sends invalidation messages. The line transfers; the other caches drop to I.

An atomic operation requires exclusive ownership of the line for the duration of the operation. Specifically:

1. The CPU sends a "Read for Ownership" (RFO) request, invalidating other caches.
2. The CPU now has the line in M state.
3. The atomic op runs.
4. The line stays in M until another CPU asks for it.

### The contention cost

When CPU A wants to atomically increment `x` and CPU B also wants to:

1. A claims the line (M).
2. B's RFO arrives; A's cache writes back, transitions to S or I.
3. B claims the line (M).
4. A's next attempt RFOs again; B transitions back.

The line ping-pongs between caches. Each transition is ~30-100 cycles. Under heavy contention, this is the dominant cost.

### False sharing

If `x` and `y` are different variables but live on the same cache line, and CPU A writes `x` while CPU B writes `y`, both still incur cache-line transfers. The CPUs do not know they are touching different variables; they only see the line.

The fix is padding:

```go
type Counter struct {
    v atomic.Int64
    _ [56]byte // pad to 64-byte cache line
}
```

This wastes memory but eliminates false sharing.

### Cache-line size

- x86-64: 64 bytes.
- ARM64: usually 64 bytes; some chips 128 bytes (Apple M1: 128 bytes).
- POWER: 128 bytes.

Padding to 128 bytes is safer for portable code. The Go runtime uses a constant `internal/cpu.CacheLinePadSize` for this; user code can mirror the pattern.

---

## Memory Barriers and the `LOCK` Prefix

A **memory barrier** (or **fence**) forces an ordering on memory operations. Without barriers, the CPU is free to reorder loads and stores for performance.

### x86 memory model

x86 is "Total Store Order" (TSO): stores from one CPU are seen in program order by all CPUs, and each CPU sees its own loads in program order. The only reordering allowed: a later load may execute before an earlier store from the same CPU (store buffering).

This means most ordering constraints are free on x86. The exceptions:

- `STORE` followed by `LOAD` may reorder. To force ordering, insert `MFENCE` or use a `LOCK`-prefixed instruction (which acts as a full barrier).
- Non-temporal stores (`MOVNTI`, etc.) bypass cache; they need explicit `SFENCE`.

The `LOCK` prefix on x86 instructions acts as a full memory barrier in addition to the atomicity guarantee. `LOCK XADD`, `LOCK CMPXCHG`, `XCHG` (implicitly locked) all flush the store buffer.

### ARM memory model

ARM is weakly ordered: any load/store may reorder with any other unless explicitly fenced. The `DMB ISH` (Data Memory Barrier, Inner Shareable) instruction forces ordering across all shared CPUs.

ARMv8 also provides:
- `LDAR` (Load-Acquire): subsequent loads/stores cannot reorder before this load.
- `STLR` (Store-Release): preceding loads/stores cannot reorder after this store.

The acquire/release pair is sufficient for most lock-free algorithms. Go's atomics use `LDAR`/`STLR` for `Load`/`Store` and `LDAXR`/`STLXR` for CAS.

For sequential consistency, you need both acquire and release semantics on every atomic. On ARM, this means an explicit `DMB` after each atomic op, *or* using the acquire/release pair carefully.

### Why this matters

The cost of sequential consistency:
- x86: nearly free (TSO already provides most of it).
- ARM: a barrier per atomic op, ~5-10 cycles.
- POWER: even more expensive; rarely used for Go production.

If you write Go code that does 100M atomic ops/sec and you target both x86 and ARM, the ARM version may be 2-3x slower per op. Not because ARM is "worse" but because the barriers cost something.

---

## Runtime Source — `runtime/internal/atomic`

The package `runtime/internal/atomic` is the platform-specific implementation that `sync/atomic` calls into. Layout:

```
runtime/internal/atomic/
  atomic_amd64.go         // Go function declarations
  asm_amd64.s             // Assembly implementations
  atomic_arm64.go
  asm_arm64.s
  atomic_arm.go
  asm_arm.s
  atomic_386.go
  asm_386.s
  ...
  types.go                // Atomic types (Int32, Int64, ...)
  types_64bit.go          // 64-bit-only types
  unaligned.go            // Misalignment check
```

The Go-level types in `types.go`:

```go
type Int64 struct {
    _ noCopy
    _ align64
    v int64
}

func (i *Int64) Load() int64 { return Loadint64(&i.v) }
func (i *Int64) Store(v int64) { Storeint64(&i.v, v) }
func (i *Int64) Add(delta int64) int64 { return Xaddint64(&i.v, delta) }
// ... etc
```

The implementation is a thin wrapper. `Loadint64`, `Xaddint64`, etc. are platform-specific.

The `align64` type is a zero-sized type that the compiler treats specially to force 8-byte alignment of the containing struct on 32-bit platforms. Defined in `runtime/internal/atomic/types_64bit.go`:

```go
// align64 may be added to structs that must be 64-bit aligned.
// This struct is recognized by a special case in the compiler
// and will not work if copied to any other package.
type align64 struct{}
```

The "special case in the compiler" is in `cmd/compile/internal/types`. The compiler aligns any struct containing `align64` to 8 bytes. This is the fix for the 32-bit alignment trap — implemented in the compiler, not the user's struct layout.

### `sync/atomic` ↔ `runtime/internal/atomic`

`sync/atomic` exposes the public API. `runtime/internal/atomic` is the implementation. The public API:

```go
// sync/atomic/type.go
type Int64 struct {
    _ noCopy
    _ align64
    v int64
}

func (x *Int64) Load() int64 { return LoadInt64(&x.v) }
```

`LoadInt64` (the free function in `sync/atomic`) is:

```go
//go:noescape
func LoadInt64(addr *int64) int64
```

It is a function declaration with `//go:noescape` and no body — the implementation is in assembly. The compiler links it to `runtime∕internal∕atomic·Load64` (note the U+2215 division slash, used to avoid path conflicts in symbol names).

The compiler also recognises these calls as **intrinsics**: in optimised builds, `LoadInt64(&x)` is replaced inline with the corresponding load instruction, no function call. See `cmd/compile/internal/ssagen/ssa.go` for the intrinsic table.

---

## `atomic.Value` Implementation

`atomic.Value` predates generics. Its implementation in `sync/atomic/value.go`:

```go
type Value struct {
    v any
}

type efaceWords struct {
    typ  unsafe.Pointer
    data unsafe.Pointer
}

func (v *Value) Load() (val any) {
    vp := (*efaceWords)(unsafe.Pointer(v))
    typ := LoadPointer(&vp.typ)
    if typ == nil || uintptr(typ) == ^uintptr(0) {
        return nil // first store in progress, or no store yet
    }
    data := LoadPointer(&vp.data)
    vlp := (*efaceWords)(unsafe.Pointer(&val))
    vlp.typ = typ
    vlp.data = data
    return
}
```

A Go interface value is two words: a pointer to type descriptor (`typ`) and a pointer to data (`data`). `atomic.Value` stores the interface by treating the struct as two `unsafe.Pointer`s and atomically loading/storing each.

The trick: the first `Store` sets `typ` to a sentinel `^uintptr(0)` (all-ones) while writing data, then writes the real type pointer. Readers that see the sentinel know "store in progress" and treat the value as not yet set.

```go
func (v *Value) Store(val any) {
    if val == nil {
        panic("sync/atomic: store of nil value into Value")
    }
    vp := (*efaceWords)(unsafe.Pointer(v))
    vlp := (*efaceWords)(unsafe.Pointer(&val))
    for {
        typ := LoadPointer(&vp.typ)
        if typ == nil {
            // Attempt to start first store with sentinel.
            runtime_procPin()
            if !CompareAndSwapPointer(&vp.typ, nil, unsafe.Pointer(^uintptr(0))) {
                runtime_procUnpin()
                continue
            }
            // Now safe to write data.
            StorePointer(&vp.data, vlp.data)
            StorePointer(&vp.typ, vlp.typ) // unblocks readers
            runtime_procUnpin()
            return
        }
        if uintptr(typ) == ^uintptr(0) {
            // First store in progress; spin briefly.
            continue
        }
        // Subsequent store; check type matches.
        if typ != vlp.typ {
            panic("sync/atomic: store of inconsistently typed value into Value")
        }
        StorePointer(&vp.data, vlp.data)
        return
    }
}
```

`runtime_procPin` pins the goroutine to its P, preventing preemption during the brief window of the sentinel write. Without pinning, a goroutine could be descheduled with the sentinel still in `typ`, and concurrent readers would spin indefinitely.

The type-mismatch panic is enforced on every subsequent `Store`. This is the reason `atomic.Value` cannot hold different types over its lifetime.

### Why this is subtle

The implementation walks the line between "atomic enough" and "fast." Each load is two `LoadPointer` calls; the layout is two contiguous words; the first-store dance uses procPin to bound the duration. None of this would be possible with a pure-API approach — it depends on the binary layout of interface values, which is unstable across Go versions and treated as an internal contract.

`atomic.Pointer[T]` does not need any of this. It stores a single `unsafe.Pointer`, atomic load and store are one op each, and the type is fixed by the generic parameter at compile time. Cleaner, faster, simpler.

---

## Compiler Intrinsics and SSA

The Go compiler treats most `sync/atomic` functions as **intrinsics** — recognised by name and replaced with direct instruction sequences during SSA lowering. The intrinsic table is in `cmd/compile/internal/ssagen/ssa.go`:

```go
addF("sync/atomic", "LoadInt32",
    makeAtomicGuardedIntrinsicARM64(arm64.ALDARW, arm64.ALDARW, ...),
    sys.ARM64)

addF("runtime/internal/atomic", "Xadd64",
    func(s *state, n *ir.CallExpr, args []*ssa.Value) *ssa.Value {
        return s.newValue3(ssa.OpAtomicAdd64, ...)
    },
    sys.AMD64, sys.ARM64, ...)
```

When the compiler sees `atomic.LoadInt32(&x)`, it does *not* emit a function call. Instead it emits an SSA op `OpAtomicLoad32`, which lowers to the platform-specific atomic load instruction. The result: the atomic op compiles to one or two machine instructions, comparable to a non-atomic access plus a barrier.

This is why benchmarks show atomic ops at single-digit nanoseconds — there is no function-call overhead.

You can see the inlining by passing `-gcflags='-m=2'`:

```
go build -gcflags='-m=2' main.go
# atomic.LoadInt64(&x): inlined to MOVQ + barrier
```

Or by reading the assembly:

```
go tool compile -S main.go | grep -i 'atomic\|xadd\|cmpxchg'
```

You will see the bare `LOCK CMPXCHGQ` or `LDAXR/STLXR` directly in the function body.

### When inlining fails

If you call the atomic op through an interface or a function pointer, the compiler cannot inline. The function call to `runtime∕internal∕atomic·Xadd64` happens, costing an extra ~3 ns.

```go
type Counter interface{ Add(int64) int64 }
var c Counter = &atomic.Int64{}
c.Add(1) // interface dispatch; no inlining
```

For hot paths, avoid wrapping atomics behind interfaces. Use the concrete type.

---

## The Cost of Sequential Consistency on Weak Architectures

On x86 (TSO), sequential consistency is mostly free:

- Atomic load: same as non-atomic load (one MOV).
- Atomic store: XCHG instead of MOV (similar cost).
- RMW (Add, CAS, Swap): one LOCK-prefixed instruction.

On ARM64 (weak), sequential consistency requires barriers:

- Atomic load: `LDAR` instead of `LDR` (an extra acquire barrier).
- Atomic store: `STLR` instead of `STR` (an extra release barrier).
- RMW: LL/SC loop with barriers, or LSE atomic instruction with implicit barrier.

The cost per atomic op on ARM is typically ~2-5 ns, against ~1-3 ns on x86. The ratio is close enough that you do not redesign for it. But for a code path doing 100M atomics/sec, the ARM version may be 30-50% slower.

Some other languages (C++) let you pick `memory_order_relaxed` for ops that do not need ordering — purely for counter performance, no synchronisation. Go does not offer this. The decision was made for simplicity and safety: sequential consistency is the only memory model Go programmers need to reason about. The performance loss on weak architectures is accepted as a tradeoff.

### When this matters

Almost never for application code. Atomic ops are a tiny fraction of total execution. If you measure your service and find that atomic-op latency is the bottleneck, you have built something extreme — a counter or rate limiter that dominates a million-RPS service. At that point, sharding gives more relief than memory-model tuning.

---

## Race Detector Internals

The race detector is built on **ThreadSanitizer** (TSan), the Google-developed dynamic race detector. The Go integration is in `runtime/race.go` and `runtime/race/`.

### How it works

The race detector instruments every memory access. For each access, it records:

- Memory address.
- Type (read or write).
- The goroutine performing the access.
- A **vector clock** — the goroutine's view of all goroutines' progress.

A race is reported when two accesses to the same address, at least one of them a write, happen in goroutines whose vector clocks do not have a happens-before relation.

Atomic operations install happens-before edges. When goroutine A does `atomic.Store`, the race detector marks "A's clock is now part of the variable's published clock." When goroutine B does `atomic.Load` and sees that value, "B's clock now includes A's clock." Subsequent accesses by B to other variables that A wrote are no longer flagged.

### Overhead

- ~5-10x CPU.
- ~2-3x memory (vector clocks and shadow memory).
- Each atomic op pays an extra TSan callout.

The result: a `go test -race` run is several times slower than a normal test run. Acceptable for CI. Never run with `-race` in production.

### What `-race` cannot catch

- Races on code paths not exercised by the test.
- Races between memory mappings the runtime does not track (e.g., `mmap`-ed shared memory).
- Logical races: two operations are correctly synchronised, but the algorithm is wrong.

The race detector is necessary but not sufficient. Write comprehensive concurrent tests; do not assume `-race` clears your code of all concurrency bugs.

---

## Reading the Source

| File | Purpose |
|---|---|
| `src/sync/atomic/doc.go` | API documentation and contract |
| `src/sync/atomic/type.go` | Typed atomic types (Go 1.19+) |
| `src/sync/atomic/value.go` | `atomic.Value` implementation |
| `src/runtime/internal/atomic/types.go` | Platform-neutral type definitions |
| `src/runtime/internal/atomic/asm_amd64.s` | amd64 atomic primitives |
| `src/runtime/internal/atomic/asm_arm64.s` | arm64 atomic primitives |
| `src/runtime/internal/atomic/atomic_arm.go` | 32-bit ARM (with software emulation for 64-bit on older ARMs) |
| `src/runtime/race.go` | Race detector hooks |
| `src/cmd/compile/internal/ssagen/ssa.go` | Intrinsic table |

A productive exercise: take a function like `atomic.Int64.Add` and trace it from the `sync/atomic` API down to the assembly. Then disassemble a small Go program (`go tool objdump -s 'main\.main' binary`) and find the `LOCK XADD` instruction.

### Go memory model document

The authoritative reference: <https://go.dev/ref/mem>. The most important section for `sync/atomic` is "Synchronization" → "Atomic Values." Read it. Re-read it after writing a CAS loop. Re-read it when reviewing concurrent code.

### `runtime/HACKING.md`

`src/runtime/HACKING.md` covers runtime internals including the assumptions the runtime makes about atomic semantics. Useful when you write low-level code that interacts with the scheduler or GC.

### Russ Cox's hardware memory model series

- "Hardware Memory Models": <https://research.swtch.com/hwmm>
- "Programming Language Memory Models": <https://research.swtch.com/plmm>
- "Updating the Go Memory Model": <https://research.swtch.com/gomm>

The third post documents the Go 1.19 memory-model update — why atomics moved to formal sequential consistency, the trade-offs considered, and how it compares to Java and C++.

---

## Summary

At the professional level:

- **`atomic.Int64.Add` is one CPU instruction** on x86 (`LOCK XADDQ`) and an LL/SC loop on ARM64 (`LDAXR/STLXR`) or a single instruction on ARMv8.1.
- **`LOCK CMPXCHG` is the foundation** of every higher-level atomic. Even `Add` is theoretically expressible as a CAS loop in hardware.
- **Cache coherence (MESI)** is the bottleneck under contention. Atomic ops require exclusive cache-line ownership; high contention causes line ping-ponging.
- **Sequential consistency is cheap on x86, expensive on ARM.** The cost is a barrier per atomic op on weak architectures.
- **The Go compiler intrinsifies** `sync/atomic` calls into direct instructions in optimised builds — no function-call overhead.
- **`atomic.Value` works via two-word interface manipulation** using `procPin` and a sentinel type pointer; `atomic.Pointer[T]` is a much simpler successor.
- **The race detector understands atomics** and uses them to install happens-before edges, suppressing legitimate accesses while flagging mixed atomic/non-atomic.
- **Reading the source** — `runtime/internal/atomic`, the compiler's intrinsic table, the memory-model doc — is required to settle hard questions.

At this level, atomics stop being magic. They are CPU instructions wrapped in a Go API, with documented memory-model guarantees and well-understood costs. The next file (specification) gathers the formal contract and references in one place.
