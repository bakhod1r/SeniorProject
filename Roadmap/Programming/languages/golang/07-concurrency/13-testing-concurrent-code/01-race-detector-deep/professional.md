# Race Detector Deep Dive — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [The TSan Algorithm in One Page](#the-tsan-algorithm-in-one-page)
3. [Shadow Memory](#shadow-memory)
4. [Vector Clocks and Happens-Before](#vector-clocks-and-happens-before)
5. [Compiler Instrumentation](#compiler-instrumentation)
6. [The Race Runtime ABI](#the-race-runtime-abi)
7. [Platform Support and Limitations](#platform-support-and-limitations)
8. [Synchronisation Primitive Integration](#synchronisation-primitive-integration)
9. [How Reports Are Generated](#how-reports-are-generated)
10. [Comparison With C/C++ TSan and Java](#comparison-with-cc-tsan-and-java)
11. [Sources to Read](#sources-to-read)
12. [Self-Assessment](#self-assessment)
13. [Summary](#summary)

---

## Introduction

At senior level you treated the race detector as a black box with known cost. At professional level you open the box. You learn what ThreadSanitizer actually does under the hood: how shadow memory is laid out, what a vector clock looks like, why the cost is roughly 5–15x and not 100x, what the compiler emits at each memory access, and what calls the runtime injects at each synchronisation point. You will be able to reason about which races TSan can detect, which it cannot, and why an apparent false positive is almost always a real bug.

After this file you will:

- Sketch the TSan algorithm: shadow memory, vector clocks, happens-before edges.
- Describe the shadow memory layout for one byte of program memory.
- Read the disassembly of an instrumented function and identify the inserted TSan calls.
- Explain why Go's race runtime is a C library statically linked into Go binaries.
- Know which platforms support `-race` and why some do not.
- Compare Go's race detector with TSan in C/C++ and Java's race-detection landscape.

This is the level you reach when you need to debug a race that the detector seems to miss, or you are porting Go's race runtime to a new platform, or you are evaluating whether to trust a report that looks impossible.

---

## The TSan Algorithm in One Page

TSan (the version Go embeds, often called TSanV3) tracks a *happens-before* relation across all goroutines. The algorithm has four moving parts:

1. **A vector clock per goroutine.** Each goroutine has an array of integers, one per other goroutine, that records "how many events I have observed from goroutine J." Vector clocks are the classical Lamport-style mechanism for representing happens-before in a distributed system.

2. **Shadow memory.** For every byte of regular program memory, there is a parallel area in virtual memory containing four 8-byte "shadow slots." Each slot records the most recent access by some goroutine: vector clock, type (read/write), size.

3. **Memory access hook.** The compiler inserts a call before every memory access. The hook does: read the shadow slots, check whether any of them conflicts with the new access (different goroutine, no happens-before edge, at least one write), and if so, format a race report. Then it updates one of the shadow slots with the new access.

4. **Sync hook.** Every synchronisation primitive (Mutex Lock/Unlock, channel send/receive, atomics) calls a hook that updates the relevant vector clocks to record a happens-before edge.

The cost: each memory access is a function call plus a few shadow-memory loads. That is the 5–15x slowdown. Shadow memory is large but mostly unused (page-faulted in lazily); that is the 5–10x memory cost.

Soundness and precision:

- **Sound.** If TSan reports a race, there is a race. (Modulo bugs in TSan or the runtime, which are extremely rare.)
- **Precise on observed execution.** TSan does not produce false positives for the schedule it sees.
- **Not complete.** It cannot find races on code paths or interleavings it does not observe.

---

## Shadow Memory

The defining trick of TSan is shadow memory. For every byte of program memory at address `A`, there is a fixed offset that gives you the shadow location `S(A)`. On x86-64 Linux, the mapping in Go's TSan is approximately:

```
S(A) = (A & ~0x7fff8000000000) | 0x10000000000
```

The constant differs by platform; the principle does not. The shadow region is a large slice of virtual memory — hundreds of GB — that the kernel does not commit until pages are touched. Hence "5–10x memory" is virtual; resident memory is much less.

### The shadow cell

Each shadow location consists of **four 8-byte slots**. A slot is encoded roughly as:

```
| epoch (40 bits) | tid (16 bits) | size (3 bits) | access type (1 bit) | unused |
```

- **`epoch`** — the value of the writing goroutine's own clock at the time of the access. This is what makes the slot a vector-clock entry.
- **`tid`** — the goroutine ID (0..65535).
- **`size`** — 1, 2, 4, or 8 bytes.
- **`access type`** — read or write.

So one shadow cell can record up to four distinct accesses to the same memory region. When a fifth access happens, one of the existing slots is overwritten (typically the oldest).

### Why four slots?

Many real-world programs have several concurrent readers of the same memory. With only one slot, every new reader would evict the previous. Four slots let TSan track a few overlapping readers plus a writer, which covers the common case.

### Walking the algorithm at a single access

When goroutine G writes 8 bytes at address A:

1. Compute `S(A)`.
2. Load all four slots at `S(A)`.
3. For each slot, check: same address range? same byte range? If yes, evaluate happens-before between the slot's epoch+tid and G's current vector clock. If there is no edge in either direction and at least one access is a write, emit a race report.
4. Write G's vector-clock entry into one of the four slots (replacing the oldest or a same-tid entry).

The whole thing is straight-line code in assembly. On x86-64, it is about 30–50 instructions per access.

---

## Vector Clocks and Happens-Before

TSan uses vector clocks to represent happens-before. A vector clock for goroutine G is a function from goroutine ID to integer:

```
VC_G : tid -> integer
```

`VC_G[J]` means "G has observed at least this many events from J." Compare two vector clocks `VC_G` and `VC_H` element-wise:

- `VC_G <= VC_H` iff for all `j`, `VC_G[j] <= VC_H[j]`.
- "G happens-before H" iff `VC_G <= VC_H` and `VC_G != VC_H`.

### Updating on synchronisation

When G synchronises with H (e.g., G unlocks a mutex that H then locks):

```
VC_H[J] := max(VC_H[J], VC_G[J])  for all J
VC_H[H] := VC_H[H] + 1
```

H absorbs everything G knew, then advances its own clock. From now on, H "knows about" all of G's prior events.

### Checking a race

At an access by G to memory A with shadow slot S:

- S contains the epoch `e` and tid `t` of the previous access.
- G's vector clock entry for tid `t` is `VC_G[t]`.
- If `VC_G[t] >= e`, then G knows about that prior access — no race.
- Otherwise, G has no edge to the prior accessor — race.

This is the entire test. In hot code, it is a single integer comparison plus the shadow-load cost.

### Storage cost

A vector clock has one entry per goroutine. Go can spawn millions of goroutines. To keep vector clocks bounded, TSan reuses goroutine slots: when a goroutine exits, its slot can be assigned to a new goroutine. The slot space is around 8K simultaneous goroutines per TSan-recognised slot. Vector clocks are stored compactly with frequent reuse.

---

## Compiler Instrumentation

When you pass `-race` to `go build`, the compiler's `ssa` pipeline inserts calls before every load and store. Look at the unsorted output of `go tool objdump`:

```bash
go build -race -o /tmp/app ./cmd/example
go tool objdump -s 'main\.foo' /tmp/app
```

You will see something like:

```
TEXT main.foo(SB)
  PUSHQ BP
  MOVQ SP, BP
  ...
  LEAQ globalcounter(SB), AX
  MOVQ AX, 0(SP)
  CALL runtime.raceread(SB)
  MOVQ globalcounter(SB), AX
  ...
  LEAQ globalcounter(SB), AX
  MOVQ AX, 0(SP)
  CALL runtime.racewrite(SB)
  MOVQ DX, globalcounter(SB)
```

Each access has the pattern: load the address, call `runtime.raceread` or `runtime.racewrite`, then do the actual load or store. The hook does the shadow update; the real access still happens.

### Where instrumentation is inserted

The Go compiler instruments:

- Loads and stores of named variables.
- Pointer dereferences (`*p`).
- Slice element accesses (`s[i]`).
- Map operations (via the runtime's map functions, which are race-aware internally).
- Channel operations (the channel runtime is race-aware).
- Atomic operations (the `sync/atomic` calls are race-aware).
- Function-call argument evaluation when the argument is a pointer (memory may be aliased).

What it does *not* instrument:

- Pure-register operations.
- Constants.
- Calls into pure C code via cgo (those are opaque to the Go compiler).

### `nocheckptr` and `noinst` annotations

Internal runtime packages use pragmas (`//go:nocheckptr`, `//go:norace`) to opt out of instrumentation for performance-critical paths. The race detector itself uses these to avoid recursion: the race runtime cannot instrument its own memory accesses.

---

## The Race Runtime ABI

Go's race runtime is the actual TSan library, statically linked. The Go side lives in `runtime/race/` plus platform-specific assembly. Key files:

- `runtime/race/race.go` — wrapper functions, public ABI.
- `runtime/race/race_amd64.s`, `race_arm64.s`, `race_ppc64le.s`, `race_s390x.s`, `race_riscv64.s` — per-platform assembly that calls into the TSan C functions.
- `runtime/race/race_v1_amd64.syso` and similar — the precompiled TSan binary objects.

The TSan library exposes a set of C functions roughly named:

- `__tsan_init`
- `__tsan_fini`
- `__tsan_read1`, `__tsan_read2`, `__tsan_read4`, `__tsan_read8`, `__tsan_read16`
- `__tsan_write1`, `__tsan_write2`, ...
- `__tsan_func_enter`, `__tsan_func_exit`
- `__tsan_release`, `__tsan_acquire`
- `__tsan_proc_create`, `__tsan_proc_destroy`

Go's runtime wraps these. The wrappers handle stack switches: Go's goroutine stacks are not C stacks, so calling into C requires switching to a system stack.

### ABI peculiarities

- **Stack switching.** Each TSan call switches from the goroutine stack to a system stack and back. This is part of the per-access overhead.
- **No reentrancy.** TSan does not call back into Go. The runtime is strictly leaf code.
- **Bounded goroutine slots.** TSan tracks up to a few thousand simultaneous goroutine slots. Go recycles slots as goroutines exit.

---

## Platform Support and Limitations

The race detector runs on the following Go platforms:

| OS | Architecture | Support |
|---|---|---|
| Linux | amd64 | Full |
| Linux | arm64 | Full |
| Linux | ppc64le | Full |
| Linux | s390x | Full |
| Linux | riscv64 | Recent (Go 1.22+) |
| macOS (Darwin) | amd64 | Full |
| macOS (Darwin) | arm64 | Full |
| FreeBSD | amd64 | Full |
| NetBSD | amd64 | Best-effort |
| Windows | amd64 | Limited; some quirks with goroutine identification and signal handling |

Unsupported platforms include 32-bit (i386, arm), mobile (Android arm), and esoteric (wasm). The reason is shadow memory: TSan needs a large, fixed mapping in virtual address space. 32-bit address spaces are too small. WebAssembly does not have the address-space tricks TSan needs.

### Windows-specific quirks

- The race detector works on `windows/amd64` but the runtime support is newer and less battle-tested.
- Some signal-related diagnostics are weaker.
- File-path normalisation in reports differs.

When porting Go code that relies on `-race`, test on Linux first; treat Windows as best-effort.

---

## Synchronisation Primitive Integration

Every primitive in `sync`, `sync/atomic`, and the channel runtime calls into TSan at the right moments to publish happens-before edges. Concrete examples:

### `sync.Mutex`

- `Lock()` calls `__tsan_acquire(&m)` after acquiring the lock.
- `Unlock()` calls `__tsan_release(&m)` before releasing.

This makes the lock a synchronisation point. All accesses before `Unlock()` happen-before all accesses after the matching `Lock()` in another goroutine.

### `sync.RWMutex`

- `Lock()` and `Unlock()` work like `Mutex`.
- `RLock()` and `RUnlock()` use `__tsan_acquire_read` and `__tsan_release_read` semantics, allowing multiple concurrent readers without inducing false races between readers.

### Channels

- A send calls `__tsan_release(&ch)` then publishes the data.
- A receive picks up the data and calls `__tsan_acquire(&ch)`.

This creates the happens-before edge from send to receive. For buffered channels, the runtime tracks per-element synchronisation, not per-channel.

### `sync.Once`

- The first `Do()` to complete calls `__tsan_release(&o)`.
- All subsequent `Do()` calls call `__tsan_acquire(&o)` and return.

This makes the initialiser happen-before every observer.

### `sync.WaitGroup`

- `Add(n)` and `Done()` modify the counter atomically.
- `Wait()` returns after `Done()` brings the counter to zero, calling `__tsan_acquire` against a token released by the last `Done()`.

This means all goroutines that called `Done()` happen-before any code after `Wait()` returns.

### `sync/atomic`

Each atomic operation is a release-acquire or read-modify-write that publishes the appropriate edge:

- `atomic.Store` is a release.
- `atomic.Load` is an acquire.
- `atomic.CompareAndSwap` is both, on success.

TSan understands all of these natively.

---

## How Reports Are Generated

When TSan detects a race, the report-generation path is:

1. **Stop concurrent reporting.** A global flag prevents two reports from interleaving.
2. **Walk both goroutines' shadow stacks.** Each goroutine maintains a small stack of "called from" PCs. TSan uses this plus the current call stack to format frames.
3. **Resolve addresses to source positions.** The Go runtime has access to DWARF or its own line-number tables.
4. **Format the report.** Header, current access, previous access, "Goroutine N created at."
5. **Write to stderr.** Or to the log path if `GORACE=log_path=...`.
6. **Bump the race count.** Used in the "Found N data race(s)" summary at exit.
7. **Optionally halt.** If `halt_on_error=1`, call `exit(66)`.

The report path is single-threaded and slow (it does symbolisation, opens source files, etc.). That is fine: races are exceptional.

### Why reports sometimes look incomplete

If `history_size` is small, the previous access's stack may have been overwritten. The report will then say `[failed to restore the stack]` for the prior access. Bumping `history_size` to 7 keeps deeper history.

---

## Comparison With C/C++ TSan and Java

### C/C++ TSan

- Clang and GCC provide `-fsanitize=thread`.
- Same algorithm: shadow memory, vector clocks.
- Different memory layout: C/C++ TSan uses a different mapping function than Go.
- Higher overhead in C/C++ because the compiler instruments more aggressively (no goroutine-aware optimisations).
- Same exit code convention (66).
- Same report format (mostly).

The Go race detector is essentially the C/C++ TSan algorithm adapted to Go's runtime and goroutine model. Go-specific work includes goroutine ID management, channel integration, and stack switches.

### Java race detection

Java has multiple race detectors:

- **RoadRunner.** A research tool using vector clocks; not production.
- **ThreadSanitizer for Java.** Available in some IDEs (IntelliJ) and OpenJDK research builds.
- **FastTrack.** A simplified vector-clock algorithm; lower overhead, less precise.
- **Java Pathfinder.** Model checking, exhaustive but slow.

The Java story is fragmented because the JVM's memory model and the JIT make dynamic instrumentation harder. Go's static compilation makes TSan-style instrumentation cleaner and a single, blessed tool feasible.

### Helgrind and DRD (Valgrind)

For C/C++ outside TSan, Valgrind has `helgrind` and `drd`. They use different algorithms (Eraser-style lock-set analysis) and have different trade-offs: higher overhead, sometimes more false positives, but no recompile needed (work on existing binaries).

### Summary table

| Tool | Language | Algorithm | Overhead | False positives |
|---|---|---|---|---|
| Go `-race` | Go | TSan v3 (shadow + VC) | 5–15x CPU | Very rare |
| Clang/GCC `-fsanitize=thread` | C/C++ | TSan v3 | 10–30x CPU | Rare |
| RoadRunner | Java | Vector clocks | 10–30x | Low |
| FastTrack | Java | Simplified VC | 5–10x | Some |
| Helgrind | C/C++ | Eraser lock-set | 30–100x | Some |
| DRD | C/C++ | Happens-before | 30–100x | Few |

Go's choice of TSan v3 puts it in the same precision/overhead bracket as the best C/C++ tools, with the advantage that it is the only tool and is built into the toolchain.

---

## Sources to Read

- **Go source.** `runtime/race.go`, `runtime/race/`, `cmd/compile/internal/ssagen/race.go`.
- **TSan paper.** Serebryany and Iskhodzhanov, "ThreadSanitizer — data race detection in practice," 2009.
- **TSan v2 paper.** Konstantin Serebryany et al., "Dynamic Race Detection with LLVM Compiler," 2011.
- **Lamport.** "Time, Clocks, and the Ordering of Events in a Distributed System," 1978 (vector clock origins).
- **The Go memory model.** `go.dev/ref/mem`.
- **TSan documentation.** `github.com/google/sanitizers/wiki/ThreadSanitizerCppManual`.

For deep porting work, study the platform assembly in `runtime/race/race_amd64.s` and the linker flags in `cmd/link/internal/ld/lib.go` that pull in the `.syso` files.

---

## Self-Assessment

- [ ] I can describe how shadow memory is computed for a given address.
- [ ] I can explain a vector clock and how it is updated on synchronisation.
- [ ] I can read disassembly and identify the inserted TSan calls.
- [ ] I can explain why the Go race runtime is C code, not Go.
- [ ] I know which platforms support `-race` and why others do not.
- [ ] I can describe how `sync.Mutex.Lock` and channel operations call into TSan.
- [ ] I can compare Go's race detector with C/C++ TSan and Java race tools.
- [ ] I can read `runtime/race.go` and understand most of it.

---

## Summary

ThreadSanitizer is the core: shadow memory plus vector clocks, plus a compiler that instruments every memory access. Go's `-race` is TSan adapted to goroutines and channels. The cost is in two places: the inserted hook before each access (5–15x CPU) and the lazily-faulted shadow region (5–10x memory). The algorithm is sound: every report is a real race. The algorithm is precise on the observed execution: no false positives. The algorithm is incomplete: races on unexercised code paths are not caught. Supported platforms cover all major Linux architectures plus macOS amd64/arm64 and Windows amd64; 32-bit is unsupported because shadow memory will not fit. Every synchronisation primitive in `sync`, channels, and `sync/atomic` integrates with TSan to publish happens-before edges. Report generation is single-threaded and slow, which is appropriate because races are exceptional. Compared with C/C++ TSan and the fragmented Java race-detection landscape, Go's `-race` is the most uniform and the easiest to use.
