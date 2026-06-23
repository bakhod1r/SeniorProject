---
layout: default
title: Hardware Barriers — Tasks
parent: Hardware Barriers
grand_parent: Memory Ordering Barriers
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/22-memory-ordering-barriers/01-hardware-barriers/tasks/
---

# Hardware Memory Barriers — Tasks

> Hands-on exercises. Each task has a goal, a starter snippet (where relevant), success criteria, and hints. Solutions are not given; the point is the discovery.

---

## Task 1 — Find the atomic instruction (junior)

**Goal.** Disassemble a tiny program and identify the atomic instruction.

**Starter:**
```go
package main

import "sync/atomic"

var x atomic.Int32

func main() {
    x.Store(42)
    _ = x.Load()
}
```

**Steps:**
1. Build: `go build -o prog main.go`.
2. Disassemble: `go tool objdump -s 'main\.main' ./prog`.
3. Identify the instruction(s) corresponding to `x.Store(42)` and `x.Load()`.

**Success.** You can name the instruction (e.g., `XCHGL` for store, `MOVL` for load on amd64) and explain why.

**Hint.** On amd64, look for `XCHG`. On arm64 (with `GOARCH=arm64 GOOS=linux go build`), look for `STLR` and `LDAR`.

---

## Task 2 — Cross-platform disassembly (junior)

**Goal.** Compare assembly across platforms.

**Steps:**
1. Build the program from Task 1 for amd64, arm64, and riscv64:
   ```
   GOOS=linux GOARCH=amd64 go build -o prog-amd64
   GOOS=linux GOARCH=arm64 go build -o prog-arm64
   GOOS=linux GOARCH=riscv64 go build -o prog-rv64
   ```
2. Disassemble each and identify the atomic Store / Load instruction.

**Success.** You have three different disassemblies and can explain which barrier semantics each instruction provides.

---

## Task 3 — Demonstrate the race (junior)

**Goal.** Write code that races, run `-race`, observe the report.

**Starter:**
```go
package main

import (
    "fmt"
    "time"
)

var counter int

func main() {
    for i := 0; i < 100; i++ {
        go func() { counter++ }()
    }
    time.Sleep(time.Second)
    fmt.Println(counter)
}
```

**Steps:**
1. Run: `go run main.go`.
2. Run with race detector: `go run -race main.go`.
3. Note the race report.
4. Fix using `atomic.Int64`.
5. Verify the race detector is now silent.

**Success.** You have a clean run with atomics and you can articulate what the race detector found.

---

## Task 4 — Build a publish-subscribe handshake (junior)

**Goal.** Implement a publisher-subscriber pattern with `atomic.Bool` and a payload pointer.

**Requirements:**
- Publisher writes `data := &Payload{Value: 42}` and sets `ready.Store(true)`.
- Subscriber spins on `ready.Load()`; when true, reads the payload.
- Subscriber prints the value.
- Run with `-race`; should report no race.

**Success.** Both goroutines complete with the expected value, race detector silent.

**Hint.** Use `atomic.Pointer[Payload]` for the payload.

---

## Task 5 — Detect false sharing (middle)

**Goal.** Benchmark two layouts and observe the difference.

**Starter:**
```go
type Unpadded struct {
    a atomic.Int64
    b atomic.Int64
}

type Padded struct {
    a atomic.Int64
    _ [56]byte
    b atomic.Int64
    _ [56]byte
}
```

**Steps:**
1. Write benchmarks where two goroutines each update one field of `Unpadded` and `Padded` in tight loops.
2. Run `go test -bench=. -benchtime=5s`.
3. Compare the throughput.

**Success.** Padded version is significantly faster (typically 5-20x). You can explain why.

---

## Task 6 — Build a SPSC ring buffer (middle)

**Goal.** Implement a single-producer, single-consumer bounded ring buffer with only `sync/atomic`.

**Requirements:**
- `Push(v)` and `Pop()` methods.
- Capacity is power of 2.
- Uses `atomic.Uint64` for head and tail.
- Slot writes are non-atomic (SPSC discipline allows it).
- Pad head and tail to separate cache lines.
- Test with a producer goroutine and consumer goroutine; verify ordered delivery.

**Success.** Correct ordered delivery under stress; `-race` silent.

---

## Task 7 — Build a sequence lock (middle)

**Goal.** Implement a sequence lock for a `Stats` struct.

**Requirements:**
- `Write(s Stats)` and `Read() Stats` methods.
- Writer increments seq odd before writing, even after.
- Reader reads seq, then data, then seq again; retries on mismatch.
- Test under contention: 1 writer goroutine + 10 readers; verify readers always see consistent (count, total) pairs.

**Success.** Readers never see torn (count, total) — `count` and `total` always match the latest published pair.

---

## Task 8 — Implement Dekker's algorithm (middle)

**Goal.** Implement Dekker's mutual exclusion algorithm using only atomic Bool variables.

**Requirements:**
- Two goroutines, each wanting the critical section.
- `flag[0]` and `flag[1]` (atomic.Bool) indicate intent.
- `turn` (atomic.Int32) breaks ties.
- The critical section protects an `atomic.Int64` counter.
- After 100,000 iterations on each side, counter should equal 200,000.

**Success.** Counter is exactly 200,000; `-race` silent.

**Hint.** Without proper atomics, mutual exclusion will fail. This is the classic test of StoreLoad-correct synchronisation.

---

## Task 9 — Bench `sync.Mutex` vs `sync/atomic` (middle)

**Goal.** Compare a counter using `sync.Mutex` vs `atomic.Int64.Add`.

**Steps:**
1. Write two benchmarks: `BenchmarkMutexCounter` and `BenchmarkAtomicCounter`, each incrementing from 10 goroutines, 1M ops total.
2. Run `go test -bench=. -cpu=1,2,4,8`.

**Success.** You have data on how each scales with cores; can explain the tradeoffs.

---

## Task 10 — Implement an MPMC queue (senior)

**Goal.** Build a Vyukov MPMC bounded queue.

**Requirements:**
- Capacity is power of 2.
- `Enqueue(v) bool` and `Dequeue() (v, ok)` methods.
- Multiple producers, multiple consumers.
- Lock-free.
- Test with 4 producers + 4 consumers, 10M total ops; verify no losses, no duplicates.

**Success.** All values produced are consumed exactly once; `-race` silent under stress.

---

## Task 11 — Build a hazard-pointer-style scheme (senior, advanced)

**Goal.** Even though Go's GC obviates hazard pointers for memory reclamation, build a *non-memory* version: a per-goroutine "hazard" register that says "I am reading the current generation N." A writer can detect when it's safe to retire generation N data.

**Requirements:**
- `RegisterReader()` returns a slot; `UnregisterReader(slot)` releases.
- `WriteNewGeneration()` increments a global generation; can scan all reader slots to know when generation N is safe to retire.
- Demonstrate with a benchmark.

**Success.** You can articulate when the writer is safe to retire data.

---

## Task 12 — Use `perf` to measure cache misses (senior, Linux)

**Goal.** Measure cache miss rates on a real workload.

**Steps:**
1. Pick a workload from your existing code or use Task 5's contended counter.
2. Build with `-gcflags="all=-N -l"` to disable inlining.
3. Run with `perf stat -e cache-misses,cache-references,L1-dcache-loads,L1-dcache-load-misses ./bin`.
4. Compare unpadded vs padded versions.

**Success.** You can interpret `perf` output and explain why one version has more cache misses.

---

## Task 13 — Use `perf` to measure memory order violations (senior, Linux)

**Goal.** Detect TSO replays with hardware counters.

**Steps:**
1. Use a contended CAS loop:
   ```go
   var n atomic.Int64
   for i := 0; i < 1e9; i++ {
       for !n.CompareAndSwap(n.Load(), n.Load()+1) {}
   }
   ```
2. Run with `perf stat -e machine_clears.memory_ordering ./bin`.
3. Observe the count.
4. Modify to avoid contention; re-measure.

**Success.** You see how machine_clears scales with contention; can explain why.

---

## Task 14 — Write a Herd7 litmus test (senior)

**Goal.** Verify the SB litmus test against x86-TSO using Herd7.

**Steps:**
1. Install Herd7 (from the diy7 suite, `opam install herdtools7`).
2. Write the SB litmus file:
   ```
   X86 SB
   { x = 0; y = 0; }
   P0 | P1 ;
   MOV [x], $1 | MOV [y], $1 ;
   MOV EAX, [y] | MOV EBX, [x] ;
   exists (0:EAX = 0 /\ 1:EBX = 0)
   ```
3. Run: `herd7 sb.litmus`.
4. Confirm the bad outcome is allowed (it's TSO).
5. Add `MFENCE` between the store and load on both sides; re-run; confirm bad outcome is now forbidden.

**Success.** You see Herd7 confirm both the original anti-litmus and the fix.

---

## Task 15 — Profile a real production-like service (professional)

**Goal.** Find barriers as bottlenecks in a realistic workload.

**Steps:**
1. Write or use a small HTTP service with shared state (e.g. a request counter, an in-memory cache).
2. Load-test it with `wrk` or `hey`.
3. Profile with `pprof` and `perf`.
4. Identify any barrier-related bottlenecks (high contention on a mutex or atomic).
5. Refactor with sharding or `atomic.Pointer[T]` snapshots; re-measure.

**Success.** Demonstrable performance improvement, with profile evidence pre/post.

---

## Task 16 — Implement a thread-local cache (professional)

**Goal.** Build a per-P (per-processor) sharded cache for a hot lookup.

**Requirements:**
- Each P has its own local cache (a `map[Key]Value` or similar).
- Lookups hit the local cache first.
- On miss, fall back to a global cache (mutex-protected).
- Use `runtime.LockOSThread` and `runtime_procPin/procUnpin` (or equivalent) to bind goroutine to current P.

**Success.** No contention on the lookup fast path; correct global behaviour.

**Hint.** `runtime_procPin` is a private function; you may need to use `sync.Pool` instead, which is the production-grade Go equivalent.

---

## Task 17 — Diagnose false sharing in `sync.Pool` (professional)

**Goal.** Examine `sync.Pool`'s implementation; identify the padding it uses.

**Steps:**
1. Read `src/sync/pool.go` and `src/sync/poolqueue.go`.
2. Identify `poolLocal`, `poolLocalInternal`, the `pad` fields.
3. Explain why the padding is there.
4. Calculate the memory cost: how many bytes per P?

**Success.** You can explain the padding strategy and its tradeoff.

---

## Task 18 — Benchmark across architectures (professional)

**Goal.** Run a microbenchmark on amd64 and arm64; compare.

**Steps:**
1. Pick a benchmark (e.g. atomic.Add throughput, MPMC queue ops/sec).
2. Run on an x86 server (or a desktop).
3. Run on an arm64 server (AWS Graviton, Ampere Altra, Apple Silicon Linux VM).
4. Tabulate the results.

**Success.** You have cross-arch numbers and can explain the differences.

---

## Task 19 — Implement an `atomic.Pointer`-based version map (professional)

**Goal.** Build a service-config snapshot with `atomic.Pointer[Config]` updates.

**Requirements:**
- `Read() *Config` returns the current snapshot.
- `Update(c *Config)` publishes a new snapshot.
- Multiple readers, single writer.
- Readers must see a consistent snapshot at all times.

**Success.** Stress test with 100 readers and 1 writer for 30 seconds; no torn reads.

---

## Task 20 — Build a wait-free Treiber stack with explicit reclamation (professional)

**Goal.** Despite Go having GC, build a Treiber stack and manage the reclamation explicitly using a generation counter, then compare to letting GC handle it.

**Requirements:**
- Lock-free push and pop using CAS on the head pointer.
- A "retire" function that marks popped nodes; deferred free.
- Benchmark vs the all-Go-managed version.

**Success.** You learn how much the GC simplifies the algorithm; you can quantify the cost.

---

These twenty exercises span the full range of mastery. Treat them as a learning ladder: do them in order, write down your insights, and use them as discussion fodder when reviewing other people's concurrent code.
