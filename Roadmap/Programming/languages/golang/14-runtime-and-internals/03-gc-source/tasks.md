# Go GC Source — Practice Tasks

Twenty-four exercises that drag you from `GODEBUG=gctrace=1` on a hello-world to reading `runtime/mgcpacer.go` and reproducing a GC death spiral under a tight `GOMEMLIMIT`. Along the way: `runtime.ReadMemStats`, `runtime/metrics`, `pprof -alloc_space` vs `-inuse_space`, mark-assist, write-barrier slow paths, finalizers as a leak detector, and the trigger-heap calculation that powers the pacer. Difficulty: **J**unior, **M**id, **S**enior, **Staff**.

Each task gives a Goal, Difficulty, Skills, Setup, Steps, Acceptance criteria, and folded Hints + Reference solution. The Go source lives at `$(go env GOROOT)/src/runtime/`; the GC implementation is `mgc.go`, `mgcmark.go`, `mgcsweep.go`, `mgcpacer.go`, `mgcwork.go`, `mbarrier.go`, plus the design comment block at the top of `mgc.go`. Read those first when a task says "read the source"; reference solutions cite specific function names and line ranges as of Go 1.22.

The discipline this file builds is not "make GC fast". It is "ask a precise question, run the smallest experiment that answers it, and read the source to confirm what the numbers mean". Most Go programmers stop at `gctrace=1`. Staff engineers can point at the line in `gcControllerState.heapGoalInternal` that produced the trigger.

---

## Task 1: gctrace one-liner

**Goal.** Run a small allocating program with `GODEBUG=gctrace=1`, capture one line of GC trace output, and explain every field by referencing the formatter in `runtime/mgc.go`.

**Difficulty.** Junior.

**Skills.** `GODEBUG`, basic Go program execution, reading `mgc.go` comments.

**Setup.** Go 1.22+. Any terminal. Save the program as `gctrace1/main.go`.

**Steps.**
1. Write a program that allocates ~50 MiB across many small slices over ~2 seconds.
2. Run with `GODEBUG=gctrace=1 go run ./gctrace1`.
3. Copy one full line (starts with `gc N`).
4. Open `runtime/mgc.go`, search for `gctrace`, and read the printf the runtime uses. As of Go 1.22 the format is documented inline; the formatter is in `gcMarkTermination` writing through `printlock`/`print`.
5. Annotate each field of your captured line with what it means.

**Acceptance criteria.**
- You can produce at least one `gc N ...` line.
- You can name each field: gc number, wall-clock time since start, CPU fraction, three pause phases, heap sizes (live before/after, goal), Pscan, goroutine count, etc.
- Your annotation matches the source comments, not a blog post.

<details><summary>Hints</summary>

- The Go runtime writes the trace synchronously after every GC cycle. If you allocate too little, nothing prints; bump the loop count.
- The format documentation lives as a comment block in `mgc.go`, search for `// gctrace`.
- Fields with `+` are wall vs CPU breakdowns; the `->` arrow is "before -> after" sizes.
- `MB goal` is the heap target the pacer aimed at; `MB stacks` is the total goroutine stack budget.

</details>

<details><summary>Reference solution</summary>

```go
// gctrace1/main.go
package main

import (
    "fmt"
    "time"
)

func main() {
    // Allocate ~50 MiB in small chunks to force several GCs.
    keep := make([][]byte, 0, 50_000)
    deadline := time.Now().Add(2 * time.Second)
    for time.Now().Before(deadline) {
        b := make([]byte, 1024) // 1 KiB
        for i := range b {
            b[i] = byte(i)
        }
        keep = append(keep, b)
        if len(keep) > 30_000 {
            // Drop half to give the GC something to reclaim.
            keep = keep[len(keep)/2:]
        }
    }
    fmt.Println("retained", len(keep))
}
```

Run with:

```
$ GODEBUG=gctrace=1 go run ./gctrace1 2>&1 | head -5
gc 1 @0.005s 0%: 0.027+0.42+0.005 ms clock, 0.21+0.13/0.41/0.42+0.044 ms cpu, 4->4->2 MB, 5 MB goal, 0 MB stacks, 0 MB globals, 8 P
gc 2 @0.019s 0%: 0.011+0.30+0.004 ms clock, 0.092+0.18/0.30/0.04+0.034 ms cpu, 4->4->2 MB, 5 MB goal, 0 MB stacks, 0 MB globals, 8 P
```

Field-by-field for `gc 2 @0.019s 0%: 0.011+0.30+0.004 ms clock, 0.092+0.18/0.30/0.04+0.034 ms cpu, 4->4->2 MB, 5 MB goal, 0 MB stacks, 0 MB globals, 8 P`:

| Field | Meaning | Source |
|-------|---------|--------|
| `gc 2` | GC cycle number (`work.cycles`) | `mgc.go: gcMarkTermination` |
| `@0.019s` | Wall-clock time since program start | `runtimeNano()` minus start |
| `0%` | Fraction of CPU spent in GC since program start | `gcController.assistTime + dedicatedMarkTime + ...` over total |
| `0.011+0.30+0.004 ms clock` | Three phases: sweep termination + concurrent mark + mark termination, wall time | `clock[0..2]` in `gcMarkTermination` |
| `0.092+0.18/0.30/0.04+0.034 ms cpu` | Same three phases in CPU time; the middle term is `assistTime/dedicatedTime/idleTime` | `cpu[0..2]` |
| `4->4->2 MB` | Heap live size: before mark, after mark, after sweep | `work.heap0`, `work.heap1`, `work.heap2` |
| `5 MB goal` | Heap target the pacer used to schedule this cycle | `gcController.heapGoal()` |
| `0 MB stacks` | Total goroutine stack budget | `gcController.lastStackScan` |
| `0 MB globals` | Reachable globals scanned this cycle | `gcController.globalsScan` |
| `8 P` | GOMAXPROCS at cycle end | `gomaxprocs` |

The "phase" model: STW sweep termination is brief — finishes the previous cycle's sweep. Concurrent mark is where the bulk of the work happens. STW mark termination flushes write-barrier buffers and rotates `gcWorkBufs`. Anything longer than ~1 ms in either STW field is worth investigating.

Senior takeaway: the trace is a *log of the pacer's outputs*, not a profile. It tells you what the pacer asked for and what it got; it does not tell you which allocation site caused the heap growth — that's `pprof -alloc_space` (Task 6).

</details>

**Extension.** Run the same program with `GODEBUG=gctrace=1,gcpacertrace=1`. The second key dumps the pacer's internal state every cycle: trigger ratio, scan work estimate, assist ratio. Map each pacertrace field to a struct field in `gcControllerState` (in `mgcpacer.go`).

---

## Task 2: ReadMemStats before and after allocation

**Goal.** Use `runtime.ReadMemStats` to measure heap growth across an explicit allocation of one million small objects.

**Difficulty.** Junior.

**Skills.** `runtime.MemStats`, basic benchmarking discipline.

**Setup.** `memstats1/main.go`. Standard library only.

**Steps.**
1. Read `MemStats` into `before`.
2. Allocate `1_000_000` items of `struct{ A, B int64 }` into a slice (keep them live).
3. Read `MemStats` into `after`.
4. Print `HeapAlloc`, `HeapInuse`, `HeapObjects`, `TotalAlloc`, `Mallocs` differences.
5. Compute and print bytes per allocation: `(after.HeapAlloc-before.HeapAlloc) / (after.Mallocs - before.Mallocs)`.

**Acceptance criteria.**
- HeapObjects increases by approximately 1,000,000 (give or take internal allocations).
- `(HeapAlloc delta) / Mallocs` is approximately 16 bytes (two int64s) or 32 bytes (Go's `tiny` block padding for small composites).
- Program prints all five deltas clearly.

<details><summary>Hints</summary>

- `runtime.ReadMemStats(&m)` is a STW operation in older Go versions; modern Go (1.16+) avoids STW for the most-used fields but still requires care if measured under contention.
- Hold a reference to the slice through to the second `ReadMemStats`; if you drop it the GC will reclaim before measurement.
- `HeapAlloc` is live bytes; `TotalAlloc` is cumulative (only grows).

</details>

<details><summary>Reference solution</summary>

```go
// memstats1/main.go
package main

import (
    "fmt"
    "runtime"
)

type pair struct {
    A, B int64
}

func main() {
    var before, after runtime.MemStats
    runtime.GC()                 // start from a known state
    runtime.ReadMemStats(&before)

    n := 1_000_000
    items := make([]*pair, 0, n)
    for i := 0; i < n; i++ {
        items = append(items, &pair{A: int64(i), B: int64(i)})
    }

    runtime.ReadMemStats(&after)
    // Use items so the compiler can't elide the allocation.
    runtime.KeepAlive(items)

    fmt.Printf("HeapAlloc:    %+d bytes\n", int64(after.HeapAlloc)-int64(before.HeapAlloc))
    fmt.Printf("HeapInuse:    %+d bytes\n", int64(after.HeapInuse)-int64(before.HeapInuse))
    fmt.Printf("HeapObjects:  %+d\n", int64(after.HeapObjects)-int64(before.HeapObjects))
    fmt.Printf("TotalAlloc:   %+d bytes\n", int64(after.TotalAlloc)-int64(before.TotalAlloc))
    fmt.Printf("Mallocs:      %+d\n", int64(after.Mallocs)-int64(before.Mallocs))

    bytesPerAlloc := (after.HeapAlloc - before.HeapAlloc) /
        (after.Mallocs - before.Mallocs)
    fmt.Printf("bytes/alloc:  %d\n", bytesPerAlloc)
}
```

Sample output:

```
HeapAlloc:    +24000000 bytes
HeapInuse:    +24010752 bytes
HeapObjects:  +1000007
TotalAlloc:   +24000000 bytes
Mallocs:      +1000008
bytes/alloc:  23
```

Why ~24 bytes per `struct{A,B int64}` and not 16? The runtime size class for a 16-byte allocation rounds up to the smallest class that fits — see `runtime/sizeclasses.go`. Each entry costs the class size (often 24 or 32 bytes) plus a pointer in the slice's backing array. A senior reading this number will *not* say "but the struct is 16 bytes!" — they will reach for `sizeclasses.go` and confirm the runtime rounded to class 3 (24 bytes) or class 4 (32 bytes).

Senior takeaway: `ReadMemStats` is the cheapest accurate measurement of "did my change increase heap pressure?" Take a baseline, run the workload, take a snapshot, diff. The pprof tools tell you *where* — `MemStats` tells you *how much*.

</details>

**Extension.** Add `runtime/metrics` reading of `/memory/classes/heap/objects:bytes` and compare to `MemStats.HeapAlloc`. They should be equal within a few hundred bytes; if not, you've found a measurement skew worth investigating.

---

## Task 3: runtime.GC and NumGC

**Goal.** Demonstrate that calling `runtime.GC()` triggers a collection by reading `NumGC` before and after.

**Difficulty.** Junior.

**Skills.** `runtime.GC`, `runtime.MemStats.NumGC`.

**Setup.** `forcegc/main.go`.

**Steps.**
1. Read `NumGC` into `before`.
2. Call `runtime.GC()`.
3. Read `NumGC` into `after`.
4. Assert `after.NumGC == before.NumGC + 1`.
5. Repeat in a loop ten times and confirm linear growth.

**Acceptance criteria.**
- `NumGC` increments by exactly one per `runtime.GC()` call.
- Program produces ten lines, each showing `NumGC` incremented by 1.

<details><summary>Hints</summary>

- `runtime.GC()` blocks until the GC cycle completes; it includes mark termination. The `NumGC` increment is visible immediately after return.
- Don't call `runtime.GC()` in production code paths. It's for tests, benchmarks, and finalizer-flush scenarios — not "I need to free memory now". The pacer is smarter than you.

</details>

<details><summary>Reference solution</summary>

```go
// forcegc/main.go
package main

import (
    "fmt"
    "runtime"
)

func main() {
    var m runtime.MemStats
    runtime.ReadMemStats(&m)
    base := m.NumGC

    for i := 0; i < 10; i++ {
        runtime.GC()
        runtime.ReadMemStats(&m)
        delta := m.NumGC - base
        fmt.Printf("after call %2d: NumGC=%d (delta=%d)\n", i+1, m.NumGC, delta)
        if int(delta) != i+1 {
            fmt.Printf("UNEXPECTED: expected delta %d, got %d\n", i+1, delta)
        }
    }
}
```

The entry point is `runtime.GC` in `runtime/mgc.go`. It enters via:

```
runtime.GC() -> gcStart(gcTrigger{kind: gcTriggerCycle, n: n+1}) -> ... -> gcMarkTermination()
```

`gcStart` is the *only* function that begins a GC cycle. Whether the trigger is heap-based (pacer), time-based (`forcegcperiod`, 2 minutes), or explicit (`runtime.GC`), they all funnel through `gcStart`. Read it once — it's the entrance to the entire concurrent collector.

Senior takeaway: `runtime.GC` is a debugging tool. Calling it in hot paths defeats the pacer, which has been tuned to find the right trade-off between throughput and footprint for your workload. The only legitimate production uses are (a) before serialising `MemStats` for a metrics endpoint, (b) tests asserting on heap shape, (c) right after dropping a large structure when you *know* you want it reclaimed before the next phase (rare).

</details>

**Extension.** Time `runtime.GC()` calls under different live-heap sizes. Plot wall time vs heap size. The slope tells you the marker's throughput in MB/sec on your hardware — typically ~1 GB/s/core for pointer-heavy heaps.

---

## Task 4: GOGC sensitivity

**Goal.** Set `GOGC=50` and `GOGC=200` and measure the difference in `NumGC` over a fixed workload.

**Difficulty.** Junior.

**Skills.** `GOGC`, `runtime.MemStats`, comparative measurement.

**Setup.** `gogcsense/main.go`. Same program runs twice with different env values.

**Steps.**
1. Write a program that runs for ~2 seconds of allocation, then prints `NumGC` and `HeapInuse`.
2. Run with `GOGC=50 go run .` — record output.
3. Run with `GOGC=200 go run .` — record output.
4. Document the ratio: `GOGC=50` should produce ~3-4x as many GCs as `GOGC=200` for the same workload, with a smaller peak `HeapInuse`.

**Acceptance criteria.**
- `GOGC=50` produces strictly more `NumGC` than `GOGC=200`.
- `GOGC=200` shows higher peak `HeapInuse`.
- You can articulate why: `GOGC=N` means "trigger GC when heap is N% larger than last live size".

<details><summary>Hints</summary>

- `GOGC` is read at startup. To change it at runtime, use `debug.SetGCPercent(50)` — same effect, but per-process and reversible.
- The default is `GOGC=100`, meaning "double the live heap before GC".
- Set `GOGC=off` to disable GC entirely (don't ship this; great for benchmarks of allocator vs GC isolation).

</details>

<details><summary>Reference solution</summary>

```go
// gogcsense/main.go
package main

import (
    "fmt"
    "os"
    "runtime"
    "time"
)

func main() {
    keep := make([][]byte, 0, 1_000_000)
    deadline := time.Now().Add(2 * time.Second)
    var peak uint64
    for time.Now().Before(deadline) {
        keep = append(keep, make([]byte, 4096))
        if len(keep) > 5000 {
            keep = keep[len(keep)/2:]
        }
        var m runtime.MemStats
        runtime.ReadMemStats(&m)
        if m.HeapInuse > peak {
            peak = m.HeapInuse
        }
    }
    var m runtime.MemStats
    runtime.ReadMemStats(&m)
    fmt.Fprintf(os.Stdout, "GOGC=%s NumGC=%d peak_HeapInuse=%d retained=%d\n",
        os.Getenv("GOGC"), m.NumGC, peak, len(keep))
    runtime.KeepAlive(keep)
}
```

Sample run:

```
$ GOGC=50 go run ./gogcsense
GOGC=50 NumGC=312 peak_HeapInuse=23232512 retained=5000

$ GOGC=200 go run ./gogcsense
GOGC=200 NumGC=87 peak_HeapInuse=52166656 retained=5000
```

The trigger calculation lives in `runtime/mgcpacer.go` in `gcControllerState.commit`. Roughly: `nextGoal = liveHeap + (GOGC/100) * (liveHeap + stacks + globals)`. Lowering `GOGC` makes the goal closer to live heap, triggering sooner and more often.

Senior takeaway: `GOGC` is a single dial trading CPU (GC frequency) for RSS (heap headroom). Halving `GOGC` roughly doubles GC frequency and halves peak heap. There is no universally "right" value — it depends on whether your bottleneck is CPU, memory, or tail latency. Tune by *measuring*, never by feel.

</details>

**Extension.** Run a sweep: `GOGC` in `{25, 50, 100, 200, 400, 800}`. Plot `NumGC` and peak `HeapInuse`. The trade-off curve is hyperbolic-ish; identify the knee for your workload. Task 14 will turn this into a proper tuning exercise.

---

## Task 5: GOMEMLIMIT enforcement

**Goal.** Set `GOMEMLIMIT=100MiB` and demonstrate that Go obeys it: total RSS plateaus near the limit, GC frequency rises as allocations approach it, and the program does not OOM-kill.

**Difficulty.** Mid.

**Skills.** `GOMEMLIMIT`, `runtime/metrics`, OS RSS observation.

**Setup.** `memlimit/main.go`. Need access to a process-monitoring tool (`/usr/bin/time -l` on macOS, `/usr/bin/time -v` on Linux, or `ps`).

**Steps.**
1. Write a program that allocates ~200 MiB worth of small slices over 5 seconds, retaining half.
2. Run with no `GOMEMLIMIT`: observe peak RSS and `NumGC`.
3. Run with `GOMEMLIMIT=100MiB`: observe peak RSS and `NumGC`.
4. Confirm peak RSS stays below ~120 MiB (limit + small overhead) and `NumGC` is at least 2x higher.
5. Read the comment block at the top of `runtime/mgcpacer.go` describing the soft memory limit.

**Acceptance criteria.**
- Peak RSS under `GOMEMLIMIT=100MiB` is within ~20% of 100 MiB.
- `NumGC` is meaningfully higher under the limit.
- Program completes without OOM kill even if working set exceeds the limit briefly.

<details><summary>Hints</summary>

- `GOMEMLIMIT` accepts suffixes: `B`, `KiB`, `MiB`, `GiB`. No suffix means bytes.
- Use `debug.SetMemoryLimit(100 << 20)` to set programmatically.
- Set `GOGC=off GOMEMLIMIT=100MiB` to make `GOMEMLIMIT` the *only* trigger — useful for understanding what the limit does in isolation.
- The limit is "soft": Go will exceed it briefly rather than fail allocation. Hard OOM is the kernel's job.

</details>

<details><summary>Reference solution</summary>

```go
// memlimit/main.go
package main

import (
    "fmt"
    "runtime"
    "time"
)

func main() {
    keep := make([][]byte, 0, 100_000)
    deadline := time.Now().Add(5 * time.Second)
    for time.Now().Before(deadline) {
        keep = append(keep, make([]byte, 8192))
        if len(keep) > 12_000 {
            keep = keep[len(keep)/2:]
        }
    }
    var m runtime.MemStats
    runtime.ReadMemStats(&m)
    fmt.Printf("NumGC=%d HeapInuse=%d MB Sys=%d MB retained=%d\n",
        m.NumGC, m.HeapInuse>>20, m.Sys>>20, len(keep))
    runtime.KeepAlive(keep)
}
```

Run:

```
# No limit
$ /usr/bin/time -l go run ./memlimit
NumGC=12 HeapInuse=180 MB Sys=210 MB retained=6000
        220463104  maximum resident set size

# With limit
$ GOMEMLIMIT=100MiB /usr/bin/time -l go run ./memlimit
NumGC=78 HeapInuse=78 MB Sys=110 MB retained=6000
        118259712  maximum resident set size
```

The pacer's `GOMEMLIMIT` handling is in `runtime/mgcpacer.go: gcControllerState.heapGoalInternal`. Roughly:

```go
// Pseudo-code mirroring mgcpacer.go.
goal := liveHeap + (GOGC/100) * (liveHeap + stacks + globals)
if memLimit > 0 {
    headroom := totalMappedSpace - liveHeap
    memBased := memLimit - headroom
    if memBased < goal {
        goal = memBased   // trigger sooner to respect limit
    }
}
```

The `GOMEMLIMIT` floor is what causes GC frequency to rise as you approach the limit — the pacer aggressively pulls in the trigger. If you push past the limit, the assist ratio spikes (Task 13) and mutators effectively pay for the GC inline.

Senior takeaway: `GOMEMLIMIT` is the single most important runtime knob added in the last five years. Combined with `GOGC=off`, it gives you "use up to X memory, then collect aggressively" — exactly what containers, serverless functions, and any cgroup-bounded workload want. Pre-`GOMEMLIMIT` (before Go 1.19) you had to oversize containers or tune `GOGC` by hand; now the runtime does it for you. Read proposal 48409 (Task 20).

</details>

**Extension.** Set `GOMEMLIMIT=50MiB` for the same workload. Note what happens to throughput — the program slows noticeably as mark-assist kicks in. This is the "death spiral" zone (Task 19).

---

## Task 6: pprof alloc_space

**Goal.** Use `pprof -alloc_space` to identify the biggest cumulative allocator in a small program.

**Difficulty.** Mid.

**Skills.** `runtime/pprof`, `go tool pprof`, reading flame graphs.

**Setup.** `allocspace/main.go` plus `go.mod`. Need `go tool pprof` (bundled with Go).

**Steps.**
1. Write a program with two allocating functions: `tiny()` allocates `[]byte` of length 64 in a tight loop; `huge()` allocates `[]byte` of length 16384 less often. Tune so they end up with comparable *byte* totals.
2. Wrap the program in `pprof.StartCPUProfile` and `pprof.WriteHeapProfile` — but actually you want a *memory* profile from `runtime/pprof.Lookup("allocs")`.
3. Run, save to `mem.prof`.
4. Run `go tool pprof -alloc_space mem.prof`, type `top10`. The top entry should be `huge` or `tiny` depending on totals.

**Acceptance criteria.**
- You can produce a heap profile.
- `top10 -cum` shows your allocating functions ranked by cumulative bytes.
- You can explain why the ranking matches (or doesn't match) your intuition.

<details><summary>Hints</summary>

- The "allocs" profile is cumulative since process start; "heap" (default) is the in-use snapshot.
- `runtime.MemProfileRate` controls sampling; default 512 KiB. Set to 1 for exact counts in tests (slow).
- `-alloc_space` shows total bytes allocated; `-alloc_objects` shows allocation counts.

</details>

<details><summary>Reference solution</summary>

```go
// allocspace/main.go
package main

import (
    "log"
    "os"
    "runtime/pprof"
)

func tiny(n int) {
    bag := make([][]byte, 0, n)
    for i := 0; i < n; i++ {
        bag = append(bag, make([]byte, 64))
    }
    _ = bag
}

func huge(n int) {
    bag := make([][]byte, 0, n)
    for i := 0; i < n; i++ {
        bag = append(bag, make([]byte, 16384))
    }
    _ = bag
}

func main() {
    // Force MemProfileRate=1 so the profile is exact, not sampled.
    // For real programs leave the default (512 KiB) — it's fast and accurate.
    // runtime.MemProfileRate = 1

    tiny(100_000) // ~6.4 MiB total
    huge(1_000)   // ~16 MiB total

    f, err := os.Create("mem.prof")
    if err != nil {
        log.Fatal(err)
    }
    defer f.Close()
    if err := pprof.Lookup("allocs").WriteTo(f, 0); err != nil {
        log.Fatal(err)
    }
}
```

Then:

```
$ go run ./allocspace
$ go tool pprof -alloc_space mem.prof
(pprof) top10
Showing nodes accounting for 22.40MB, 100% of 22.40MB total
      flat  flat%   sum%        cum   cum%
   16.00MB 71.43% 71.43%    16.00MB 71.43%  main.huge
    6.40MB 28.57%   100%     6.40MB 28.57%  main.tiny
(pprof) list main.huge
ROUTINE ======================== main.huge
   16.00MB    16.00MB (flat, cum) 71.43% of Total
         .          .     19:func huge(n int) {
         .          .     20:    bag := make([][]byte, 0, n)
         .          .     21:    for i := 0; i < n; i++ {
   16.00MB    16.00MB     22:        bag = append(bag, make([]byte, 16384))
         .          .     23:    }
```

The `list` view points at the exact line. `-alloc_space` says "total bytes flowed through this site over the program lifetime", which is what you want when asking "which function should I `sync.Pool`?" (Task 9).

Senior takeaway: `-alloc_space` is the right answer to "which code path is making the GC work harder?" It does not say which path holds memory *live* — that's `-inuse_space` (Task 7). Confusing the two leads to "I optimised the wrong thing" mistakes that waste days.

</details>

**Extension.** Add `-source_path=$(go env GOROOT)` and `disasm main.huge` in pprof. You'll see the actual mallocgc call site — useful when the alloc is buried inside a library you control.

---

## Task 7: alloc_space versus inuse_space

**Goal.** Take both `-alloc_space` and `-inuse_space` profiles of a program where a hot allocator produces *short-lived* objects and a cold path produces *long-lived* objects. Explain the difference in pprof output.

**Difficulty.** Mid.

**Skills.** Distinguishing cumulative vs live profiles, building intuition about lifetimes.

**Setup.** `allocvinuse/main.go`.

**Steps.**
1. `churn()` allocates 10,000 64-byte slices in a loop, dropping each (short-lived).
2. `retain()` allocates 100 64-KiB slices and keeps them in a package-level slice (long-lived).
3. Save heap profile to `mem.prof`.
4. Run both `go tool pprof -alloc_space mem.prof` and `go tool pprof -inuse_space mem.prof`.
5. Compare `top10` outputs.

**Acceptance criteria.**
- `-alloc_space` ranks `churn` higher than `retain`.
- `-inuse_space` ranks `retain` higher than `churn`.
- You can explain: alloc_space counts all bytes ever allocated; inuse_space counts only bytes still reachable at profile capture time.

<details><summary>Hints</summary>

- The heap profile (`pprof.Lookup("heap")`) is a *snapshot*. It captures live objects.
- The allocs profile (`pprof.Lookup("allocs")`) is *cumulative*. It records every allocation since process start.
- They share the same file format; pprof's `-alloc_space` vs `-inuse_space` flags select which sample type to view.

</details>

<details><summary>Reference solution</summary>

```go
// allocvinuse/main.go
package main

import (
    "log"
    "os"
    "runtime"
    "runtime/pprof"
)

var retained [][]byte // package-level keeps this live

func churn() {
    for i := 0; i < 10_000; i++ {
        b := make([]byte, 64)
        _ = b
    }
}

func retain() {
    for i := 0; i < 100; i++ {
        retained = append(retained, make([]byte, 64<<10))
    }
}

func main() {
    churn()
    retain()
    // Force GC so heap profile reflects live data only.
    runtime.GC()

    f, err := os.Create("mem.prof")
    if err != nil {
        log.Fatal(err)
    }
    defer f.Close()
    if err := pprof.Lookup("heap").WriteTo(f, 0); err != nil {
        log.Fatal(err)
    }
}
```

```
$ go run ./allocvinuse
$ go tool pprof -alloc_space mem.prof
(pprof) top
      flat  flat%   sum%        cum   cum%
    6.40MB 51.61% 51.61%     6.40MB 51.61%  main.retain   (~6.4 MB live - matches what we kept)
    0.62MB 5.00%  56.61%     0.62MB 5.00%   main.churn    (sampled subset of the 10K allocs)

$ go tool pprof -inuse_space mem.prof
(pprof) top
      flat  flat%   sum%        cum   cum%
    6.40MB   100%   100%     6.40MB   100%  main.retain
         0     0%   100%          0     0%  main.churn   (all churned bytes were collected)
```

`inuse_space` shows `churn` as zero because `runtime.GC()` reclaimed all of it. `alloc_space` is dominated by `retain` because `churn`'s allocations were sampled at the default rate (one per 512 KiB) and 10,000 × 64 = 640 KiB total — so it shows up small even cumulatively.

Crank `runtime.MemProfileRate = 1` and you'll see `churn` show ~640 KB in alloc_space, still 0 in inuse_space.

Senior takeaway: pick the right view for the question. "Why is GC eating CPU?" — alloc_space. "Why is RSS not coming down?" — inuse_space. Mixing the two is the most common pprof mistake.

</details>

**Extension.** Capture a profile *without* calling `runtime.GC()` first. The `inuse_space` numbers will include not-yet-collected objects from `churn`. The implicit "you must GC before sampling for accurate live data" is `pprof.WriteHeapProfile`'s old behaviour; modern code uses `Lookup("heap").WriteTo` and decides GC explicitly.

---

## Task 8: pointer fields versus value fields

**Goal.** Build two structs of identical logical contents — one with pointer fields, one with value fields. Show that the pointer version has higher GC scan cost.

**Difficulty.** Mid.

**Skills.** Heap layout, GC scanning model, microbenchmarks.

**Setup.** `pointersvalues/` with `bench_test.go` and a small `main.go`.

**Steps.**
1. Define `type WithPtrs struct { A, B, C, D *int64 }` and `type WithVals struct { A, B, C, D int64 }`.
2. Allocate 1,000,000 of each into separate slices.
3. Force a GC with `runtime.GC()` and time each via `runtime/metrics` `/gc/heap/scan:bytes` or `MemStats.PauseNs[(NumGC-1)%256]`.
4. Confirm `WithPtrs` causes more bytes scanned than `WithVals`.

**Acceptance criteria.**
- The bytes-scanned metric for the pointer version is meaningfully higher (often 2-4x).
- You can explain: GC scans pointer fields; value-typed fields are skipped using the type's pointer bitmap.

<details><summary>Hints</summary>

- The bitmap that tells the GC which words are pointers lives in `runtime/mbitmap.go`; each type computes its bitmap at compile time, stored in `*_type`.
- `runtime/metrics` provides `/gc/scan/heap:bytes` for total scanned bytes (cumulative).
- Compare the GC pause distributions, not just totals — pointer-heavy heaps also have longer pauses on average.

</details>

<details><summary>Reference solution</summary>

```go
// pointersvalues/main.go
package main

import (
    "fmt"
    "runtime"
    "runtime/metrics"
)

type WithPtrs struct {
    A, B, C, D *int64
}

type WithVals struct {
    A, B, C, D int64
}

func newPtrs(n int) []WithPtrs {
    out := make([]WithPtrs, n)
    for i := range out {
        a, b, c, d := int64(i), int64(i+1), int64(i+2), int64(i+3)
        out[i] = WithPtrs{&a, &b, &c, &d}
    }
    return out
}

func newVals(n int) []WithVals {
    out := make([]WithVals, n)
    for i := range out {
        out[i] = WithVals{int64(i), int64(i + 1), int64(i + 2), int64(i + 3)}
    }
    return out
}

func scanBytes() uint64 {
    s := []metrics.Sample{{Name: "/gc/scan/heap:bytes"}}
    metrics.Read(s)
    return s[0].Value.Uint64()
}

func main() {
    const n = 1_000_000

    // Pointer version
    runtime.GC()
    before := scanBytes()
    ps := newPtrs(n)
    runtime.GC()
    after := scanBytes()
    fmt.Printf("WithPtrs: scanned %d bytes\n", after-before)
    runtime.KeepAlive(ps)

    // Value version
    runtime.GC()
    before = scanBytes()
    vs := newVals(n)
    runtime.GC()
    after = scanBytes()
    fmt.Printf("WithVals: scanned %d bytes\n", after-before)
    runtime.KeepAlive(vs)
}
```

Sample output:

```
WithPtrs: scanned 41943040 bytes
WithVals: scanned 16777216 bytes
```

The pointer struct is 32 bytes; the value struct is also 32 bytes — both occupy the same heap. The difference is what the GC has to *do* with them. Read `runtime/mgcmark.go: scanobject`: for each word in the object, the loop consults the type's bitmap; pointer words get dereferenced and queued, scalar words are skipped at near-zero cost. But the queueing, the marking, the work-stealing — that's where pointer cost shows up.

Beyond that, a million `*int64` allocations are a million *additional* heap objects to track. The pointer struct version is two heap pressures rolled together: more scan work *and* more total heap objects.

Senior takeaway: when designing a hot data structure, prefer value-typed fields where you can. Embed structs instead of pointing at them. The cost is more copying on assignment; the benefit is shorter GC scans and tighter cache locality. Profile both designs — but the default lean should be "values until proven otherwise".

</details>

**Extension.** Repeat with a struct containing 16 fields. The advantage of values grows: scan work scales with pointer count, value fields are essentially free.

---

## Task 9: sync.Pool to cut allocations

**Goal.** Replace a hot allocation with `sync.Pool`. Benchmark before and after; aim for >10x reduction in allocations per op.

**Difficulty.** Mid.

**Skills.** `sync.Pool`, `testing.B`, `b.ReportAllocs()`.

**Setup.** `poolbench/buffer_test.go`. A function that processes data using a temporary `[]byte` scratch buffer.

**Steps.**
1. Write `Process(data []byte) []byte` that allocates a 4 KiB scratch buffer per call, does some work, returns a copy of the result.
2. Benchmark with `go test -bench=. -benchmem`.
3. Refactor to use `sync.Pool` for the scratch buffer.
4. Benchmark again. Compare allocations and ns/op.

**Acceptance criteria.**
- Pooled version has roughly 1 alloc/op (just the returned copy) vs ~2 for the naive version.
- ns/op is lower for the pooled version under contention.
- You correctly Reset the pooled buffer before returning it to the pool.

<details><summary>Hints</summary>

- `sync.Pool.Put` does not guarantee retention — the pool can drop entries at any GC. Your code must handle `Get()` returning a brand new value.
- Reset (slice to length 0, retaining capacity) inside the function, before returning; otherwise the next caller sees stale data.
- Pools are per-P (per-processor), so `Get`/`Put` on the same goroutine is lock-free.
- Read `sync/pool.go: poolDequeue` for the lock-free deque implementation.

</details>

<details><summary>Reference solution</summary>

```go
// poolbench/buffer_test.go
package poolbench

import (
    "sync"
    "testing"
)

var pool = sync.Pool{
    New: func() any {
        b := make([]byte, 0, 4096)
        return &b
    },
}

// Naive: allocates a 4 KiB buffer every call.
func ProcessNaive(data []byte) []byte {
    buf := make([]byte, 0, 4096)
    for _, b := range data {
        buf = append(buf, b^0x55)
    }
    out := make([]byte, len(buf))
    copy(out, buf)
    return out
}

// Pooled: borrows from sync.Pool, resets, returns it.
func ProcessPool(data []byte) []byte {
    bufp := pool.Get().(*[]byte)
    buf := (*bufp)[:0] // reset, keep capacity
    defer func() {
        *bufp = buf[:0] // store back with capacity, length 0
        pool.Put(bufp)
    }()
    for _, b := range data {
        buf = append(buf, b^0x55)
    }
    out := make([]byte, len(buf))
    copy(out, buf)
    return out
}

var input = make([]byte, 2048)

func BenchmarkNaive(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        _ = ProcessNaive(input)
    }
}

func BenchmarkPool(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        _ = ProcessPool(input)
    }
}
```

Sample output:

```
$ go test -bench=. -benchmem
BenchmarkNaive-8     350000      3421 ns/op    6144 B/op    2 allocs/op
BenchmarkPool-8      720000      1612 ns/op    2048 B/op    1 allocs/op
```

Half the allocations, half the bytes, half the time. The remaining allocation is the returned `out` buffer — if the API let you write into a caller-supplied buffer, you'd get to 0 allocs/op.

`sync.Pool` is reset by the runtime on every GC. The clearing happens in `runtime/mgc.go: gcStart` via `poolCleanup`, called through `sync_runtime_registerPoolCleanup`. That means a long-idle pool will be empty after a GC; the cost of repopulating is `New()` calls on the cold path. Tune by keeping at least a few entries warm if your workload is bursty.

Senior takeaway: `sync.Pool` is for *reusable scratch space*, not for persistent caching. Use it for parser state, encoding buffers, regex match arrays — anything you'd otherwise allocate on every call. Don't use it for connection pools (use `database/sql.DB`), worker pools (build your own with channels), or long-lived caches (use a map or `lru.Cache`).

</details>

**Extension.** Run with `-cpu=1,2,4,8`. The pool's benefit per-core grows with contention because the lock-free deque keeps Get/Put on the same P most of the time. Compare with a naive `sync.Mutex`-protected free list at high parallelism — the standard pool wins by an order of magnitude.

---

## Task 10: force a leak with retained references

**Goal.** Build a "leaking" service where each request adds to a global map without removal. Confirm `HeapInuse` grows monotonically.

**Difficulty.** Mid.

**Skills.** Leak diagnosis, `runtime.ReadMemStats` over time, distinguishing "growth" from "leak".

**Setup.** `leak1/main.go`. A loop that simulates incoming requests, each adding to a global structure.

**Steps.**
1. Define `var sessions = map[string]*Session{}`.
2. In a loop, generate a unique session key and store a 1 KiB `*Session` value.
3. Every 1000 iterations, read `MemStats` and print `HeapAlloc` and `HeapInuse`.
4. Run for ~30 seconds. Confirm both grow without bound.
5. Add removal logic; confirm the growth stops.

**Acceptance criteria.**
- Initial version: `HeapInuse` grows monotonically until you stop the program.
- Fixed version: `HeapInuse` reaches a plateau, oscillates around it.
- You can articulate the difference between "leak" (unbounded growth of reachable objects) and "high memory use" (bounded but large).

<details><summary>Hints</summary>

- A true leak in Go means reachable-but-unused: the GC can't help because the references are real.
- Common leak shapes: global map, global channel that's never drained, goroutine waiting on a channel that's never sent to (goroutine leak), `time.NewTicker` never `Stop()`'d (timer leak).
- The remediation is always the same: identify the rooted-from-global reference; remove the unnecessary keep-alive.

</details>

<details><summary>Reference solution</summary>

```go
// leak1/main.go
package main

import (
    "fmt"
    "runtime"
    "strconv"
    "time"
)

type Session struct {
    UserID    string
    Data      [1024]byte
    CreatedAt time.Time
}

var sessions = map[string]*Session{}

func main() {
    start := time.Now()
    for i := 0; ; i++ {
        key := strconv.Itoa(i)
        sessions[key] = &Session{
            UserID:    key,
            CreatedAt: time.Now(),
        }

        if i%1000 == 0 {
            var m runtime.MemStats
            runtime.ReadMemStats(&m)
            fmt.Printf("[%5.1fs] i=%d HeapAlloc=%d MB HeapInuse=%d MB len(sessions)=%d\n",
                time.Since(start).Seconds(), i, m.HeapAlloc>>20, m.HeapInuse>>20, len(sessions))
        }

        if time.Since(start) > 30*time.Second {
            return
        }
    }
}
```

Run it: `HeapInuse` climbs continuously. Add this for the fix:

```go
// At the top of the loop, after writing, evict anything older than 5 seconds.
if i%1000 == 0 {
    cutoff := time.Now().Add(-5 * time.Second)
    for k, s := range sessions {
        if s.CreatedAt.Before(cutoff) {
            delete(sessions, k)
        }
    }
}
```

Now `len(sessions)` plateaus around the number of sessions created in 5 seconds, and `HeapInuse` plateaus accordingly.

The map *itself* doesn't shrink when you `delete` — the bucket array stays sized for the largest population. To return memory to the heap you must replace the map entirely (or use `maps.Clone` to a freshly-sized one). See `runtime/map.go` for the bucket layout. This is one of the most common production "leak that isn't quite a leak" patterns.

Senior takeaway: GCs do not solve leaks; they only solve forgotten allocations. Any time a global, a long-lived struct, or a goroutine holds references it doesn't need, you have a leak the runtime cannot help with. Finalizers (Task 15) can detect them; only code review and discipline prevent them.

</details>

**Extension.** Replace the global map with `sync.Map`. Repeat the leak; observe similar growth. Now replace with a fixed-size LRU. The leak goes away because eviction is structural, not dependent on the caller remembering to `delete`.

---

## Task 11: read mgc.go and find gcStart

**Goal.** Open `runtime/mgc.go`, identify the entry function for starting a GC cycle, and trace through one call's first ~30 lines.

**Difficulty.** Senior.

**Skills.** Reading runtime source, navigating Go's internal package layout.

**Setup.** Local Go install. `cd $(go env GOROOT)/src/runtime`.

**Steps.**
1. Open `mgc.go`. Find the function `gcStart`.
2. Read its docstring and the assertions at the top.
3. Trace what happens when the trigger is `gcTriggerCycle` (the kind used by `runtime.GC()`).
4. Identify where mutators are put into mark-assist mode (in `gcMarkRootPrepare` and `gcAssistAlloc`).
5. Write a short summary: which function STWs the world, where the write barrier is enabled, where concurrent mark workers spawn.

**Acceptance criteria.**
- You can quote the signature of `gcStart`.
- You can name three functions it calls in order: `stopTheWorldWithSema`, `setGCPhase(_GCmark)`, `startTheWorldWithSema`.
- You can locate where `gcphase` transitions to `_GCmark`.

<details><summary>Hints</summary>

- `gcStart`'s signature: `func gcStart(trigger gcTrigger)`.
- The function is long (~250 lines as of Go 1.22). Read the comment headers to navigate.
- The phase enum is `_GCoff`, `_GCmark`, `_GCmarktermination` (in `mgc.go` near the top).
- `setGCPhase` is the one-stop function that updates `writeBarrier.enabled` based on phase.

</details>

<details><summary>Reference solution</summary>

Open `$(go env GOROOT)/src/runtime/mgc.go`. The relevant function (Go 1.22):

```go
// gcStart starts the GC. It transitions from _GCoff to _GCmark (if
// debug.gcstoptheworld == 0) or performs all of GC (if
// debug.gcstoptheworld > 0).
//
// This may return without performing this transition in some cases,
// such as when called on a system stack or with locks held.
func gcStart(trigger gcTrigger) {
    // Since this is called from malloc and malloc is called in
    // the guts of a number of libraries that might be holding
    // locks, don't attempt to start GC in non-preemptible or
    // potentially unstable situations.
    mp := acquirem()
    if gp := getg(); gp == mp.g0 || mp.locks > 1 || mp.preemptoff != "" {
        releasem(mp)
        return
    }
    releasem(mp)
    mp = nil

    // ... lots of preconditions and sema acquire ...

    // Pick up the remaining unswept/not being swept spans concurrently
    for atomic.Load(&work.cycles) == n+1 && sweepone() != ^uintptr(0) {
        sweep.nbgsweep++
    }

    // ...

    // Enter mark phase, enabling write barriers.
    setGCPhase(_GCmark)

    // ...

    // Start concurrent mark workers (one per P).
    // gcBgMarkStartWorkers spawns runtime goroutines named "GC worker"
    // that loop calling gcBgMarkWorker.
    gcBgMarkStartWorkers()

    // ...

    // Start the world. Mutators now run concurrently with mark workers.
    startTheWorldWithSema(0, stw)
}
```

Tracing one call to `runtime.GC()`:

1. `runtime.GC()` (in `mgc.go`) sets up a `gcTrigger{kind: gcTriggerCycle, n: lastCycle+1}` and calls `gcStart`.
2. `gcStart` calls `stopTheWorldWithSema` — every mutator is paused. This is the first STW window (sweep termination).
3. `setGCPhase(_GCmark)` flips `writeBarrier.enabled = true` so every pointer write goes through the Dijkstra-style barrier in `runtime/mbarrier.go`.
4. `gcBgMarkStartWorkers` launches one goroutine per P. They loop in `gcBgMarkWorker` pulling roots from `gcWork`, marking objects grey-to-black.
5. `startTheWorldWithSema` resumes mutators. Concurrent mark begins; allocations during this window may incur *mark-assist* (Task 13).
6. When the mark queue drains, the runtime enters mark termination — second STW — flushes write-barrier buffers, transitions to `_GCoff`, kicks off the background sweeper.

The 30-line summary:

> `runtime.GC()` → `gcStart` (with `gcTriggerCycle`) → STW1 (sweep termination, calls `stopTheWorldWithSema`) → enable write barrier (`setGCPhase(_GCmark)`) → spawn N mark workers via `gcBgMarkStartWorkers` → release mutators (`startTheWorldWithSema`) → concurrent mark in `gcBgMarkWorker` and `gcMarkDone` → STW2 (mark termination, calls `stopTheWorldWithSema`) → disable write barrier (`setGCPhase(_GCoff)`) → wake sweeper → return.

Senior takeaway: the entire concurrent collector is funneled through one function, `gcStart`. Read it once and the high-level structure of Go's GC is yours forever; everything else (pacer, marker, sweeper, barriers) is a downstream specialization.

</details>

**Extension.** Find the place in `gcStart` where `forcegcperiod` matters — the periodic GC trigger. It's around the trigger evaluation; identify how the runtime decides "no allocations happened, but it's been 2 minutes, GC anyway".

---

## Task 12: GC pause histogram via runtime/metrics

**Goal.** Use the `runtime/metrics` package to read the `/gc/pauses:seconds` histogram. Compute and print p50, p95, p99 over a workload.

**Difficulty.** Senior.

**Skills.** `runtime/metrics`, histogram bucket math, runtime instrumentation.

**Setup.** `gcpauses/main.go`.

**Steps.**
1. Run a workload that triggers many GCs (e.g., the program from Task 4 with `GOGC=50`).
2. After completion, read `/gc/pauses:seconds` into a `metrics.Sample`.
3. Walk the histogram buckets to compute percentile pauses.
4. Print p50, p95, p99 in microseconds.
5. Compare with `runtime.MemStats.PauseNs` (a circular buffer of the last 256 pauses).

**Acceptance criteria.**
- Program outputs three percentile values.
- p99 is meaningfully larger than p50 (long-tail behaviour).
- You can explain the difference between the metrics-package histogram (cumulative all-time) and the PauseNs circular buffer (last 256).

<details><summary>Hints</summary>

- `metrics.Float64Histogram` has `Buckets []float64` (right edges) and `Counts []uint64` (counts per bucket).
- Percentile computation: total = sum of Counts; target = p/100 * total; walk Counts accumulating until you cross target; bucket boundary is your answer.
- All values in `Buckets` are in seconds; multiply by 1e6 for microseconds.
- `MemStats.PauseNs` only includes the *mark termination* phase pause (and recently *sweep termination*), not the full mark phase wall time.

</details>

<details><summary>Reference solution</summary>

```go
// gcpauses/main.go
package main

import (
    "fmt"
    "runtime"
    "runtime/metrics"
    "time"
)

func percentile(h *metrics.Float64Histogram, p float64) float64 {
    var total uint64
    for _, c := range h.Counts {
        total += c
    }
    if total == 0 {
        return 0
    }
    target := uint64(float64(total) * p / 100.0)
    var seen uint64
    for i, c := range h.Counts {
        seen += c
        if seen >= target {
            return h.Buckets[i+1] // right edge of bucket
        }
    }
    return h.Buckets[len(h.Buckets)-1]
}

func main() {
    // Generate some GC pressure.
    keep := make([][]byte, 0, 100_000)
    deadline := time.Now().Add(3 * time.Second)
    for time.Now().Before(deadline) {
        keep = append(keep, make([]byte, 4096))
        if len(keep) > 10_000 {
            keep = keep[len(keep)/2:]
        }
    }
    runtime.KeepAlive(keep)

    // Read the histogram.
    s := []metrics.Sample{{Name: "/gc/pauses:seconds"}}
    metrics.Read(s)
    if s[0].Value.Kind() != metrics.KindFloat64Histogram {
        fmt.Println("wrong kind:", s[0].Value.Kind())
        return
    }
    h := s[0].Value.Float64Histogram()

    fmt.Printf("p50 GC pause: %6.1f us\n", percentile(h, 50)*1e6)
    fmt.Printf("p95 GC pause: %6.1f us\n", percentile(h, 95)*1e6)
    fmt.Printf("p99 GC pause: %6.1f us\n", percentile(h, 99)*1e6)

    var m runtime.MemStats
    runtime.ReadMemStats(&m)
    fmt.Printf("NumGC: %d, total PauseNs: %d (avg %d us)\n",
        m.NumGC, m.PauseTotalNs, m.PauseTotalNs/uint64(m.NumGC)/1000)
}
```

Sample:

```
p50 GC pause:   24.0 us
p95 GC pause:  128.0 us
p99 GC pause:  512.0 us
NumGC: 187, total PauseNs: 7423000 (avg 39 us)
```

The histogram includes both STW phases (sweep term + mark term) plus any contributions from goroutine preemption while the world stops. The long tail comes from p99-tier outliers — usually stack scanning of large goroutines (Task 22) or write-barrier buffer flushes.

Senior takeaway: track p99 GC pause as an SLO. If your service's p99 latency budget is 10 ms and p99 GC pause is 5 ms, half your budget is gone before any application work happens. The fix is rarely "tune the GC"; it's "reduce heap size, reduce pointer density, fewer goroutines" — structural changes that lower the work the GC has to do per cycle.

</details>

**Extension.** Plot the histogram over time: read it at 1-second intervals, diff bucket counts, and graph p99 vs wall time. Sudden spikes correlate with allocation bursts.

---

## Task 13: mark-assist under tight allocation

**Goal.** Build a workload where mark-assist becomes the dominant cost. Read the `assist` field in `gctrace` output. Read the assist source in `mgc.go`.

**Difficulty.** Senior.

**Skills.** Mark-assist semantics, allocation pressure tuning, source reading.

**Setup.** `markassist/main.go`. Combined with `GODEBUG=gctrace=1`.

**Steps.**
1. Write a program with one tight-allocating goroutine that does `make([]byte, 64)` in a hot loop, billions of times.
2. Run with `GODEBUG=gctrace=1`.
3. Identify the "assist" field in the CPU breakdown (`a/b/c` where `a` is assist, `b` is dedicated, `c` is idle).
4. Increase allocation pressure (smaller `GOGC`); confirm the `a` term grows.
5. Read `runtime/mgc.go: gcAssistAlloc` to see how mutators are charged.

**Acceptance criteria.**
- You can identify the "assist" field in a gctrace line.
- With aggressive `GOGC=25`, mark-assist visibly dominates GC CPU.
- You can explain: when a goroutine allocates faster than mark workers can keep up, it gets *taxed* — it must do mark work itself before proceeding.

<details><summary>Hints</summary>

- The gctrace CPU phase format is `mark-prep + mark / mark-assist / mark-dedicated / mark-idle + mark-term`.
- The pacer's "assist ratio" lives in `gcController.assistWorkPerByte`; every B bytes you allocate, you owe assistWorkPerByte units of mark work.
- Read `gcAssistAlloc` — it's the function that wakes up when a mutator hits the assist debt threshold.

</details>

<details><summary>Reference solution</summary>

```go
// markassist/main.go
package main

import (
    "fmt"
    "runtime"
    "time"
)

func main() {
    keep := make([][]byte, 0, 1_000_000)
    deadline := time.Now().Add(3 * time.Second)
    for time.Now().Before(deadline) {
        for i := 0; i < 1000; i++ {
            keep = append(keep, make([]byte, 64))
        }
        // Drop most of them; we want allocation pressure, not retention.
        if len(keep) > 5000 {
            keep = keep[len(keep)/2:]
        }
    }
    var m runtime.MemStats
    runtime.ReadMemStats(&m)
    fmt.Printf("NumGC=%d totalPause=%dms retained=%d\n",
        m.NumGC, m.PauseTotalNs/1e6, len(keep))
    runtime.KeepAlive(keep)
}
```

Run with default GOGC:

```
$ GODEBUG=gctrace=1 GOGC=100 go run ./markassist 2>&1 | head -3
gc 1 @0.011s 3%: 0.05+0.42+0.012 ms clock, 0.41+0.21/0.33/0.12+0.097 ms cpu, 4->4->2 MB, 5 MB goal, 0 MB stacks, 0 MB globals, 8 P
...
```

The `0.21/0.33/0.12` is `assist/dedicated/idle` ms of CPU time. Now run with aggressive GOGC:

```
$ GODEBUG=gctrace=1 GOGC=10 go run ./markassist 2>&1 | head -3
gc 1 @0.005s 14%: 0.04+0.31+0.008 ms clock, 0.32+2.41/0.29/0.04+0.064 ms cpu, ...
```

The `2.41 ms` assist term has exploded — mutators are being taxed because they're allocating faster than the pacer wants them to.

The relevant source (Go 1.22, `runtime/mgc.go`):

```go
// gcAssistAlloc performs GC work to make up for a recent allocation
// that exceeded the assist credit. assistAlloc returns true if the
// mutator has done enough work to satisfy its current debt; false if
// further work is needed.
func gcAssistAlloc(gp *g) {
    // Check this goroutine's assist debt.
    debtBytes := -gp.gcAssistBytes
    // Compute the work to do: debt × assistWorkPerByte.
    scanWork := int64(assistWorkPerByte * float64(debtBytes))
    // ... do the work, possibly preempting back to the runtime to
    // help if more is needed ...
}
```

The mechanism: every allocation by a mutator decrements `gp.gcAssistBytes` by the bytes allocated (scaled by the assist ratio). When it goes negative, the mutator must do scan work before continuing — it pays its debt by helping the marker. This bounds heap growth even when the dedicated mark workers can't keep up.

Senior takeaway: mark-assist is the runtime's load-balancer between mutator throughput and GC progress. A high assist term in gctrace means the marker is falling behind — you're allocating faster than it can keep up with at the chosen `GOGC`. Either raise `GOGC` (more headroom) or reduce allocation pressure (the right answer). Raising `GOMAXPROCS` does *not* help by default; you need more *dedicated* GC CPU, which the pacer caps at 25%.

</details>

**Extension.** Set `GODEBUG=gctrace=1,gcassiststack=1` and grep for "assist on stack". The runtime prints when a mutator's assist crossed a threshold worth noting.

---

## Task 14: GOGC trade-off curve

**Goal.** For a synthetic workload, sweep `GOGC` across `{25, 50, 100, 200, 400, 800}` and plot GC CPU% vs peak `HeapInuse`. Identify the knee.

**Difficulty.** Senior.

**Skills.** Systematic benchmarking, trade-off visualisation, choosing a tuning parameter from data.

**Setup.** `gogcsweep/`. A program that runs a fixed workload and reports timing + memory. A shell script to drive the sweep.

**Steps.**
1. Write a deterministic workload (compute factorial-of-binomials, or any CPU-bound thing that allocates a known amount).
2. The program reports: total wall time, `MemStats.GCCPUFraction`, peak `HeapInuse`.
3. Loop: for `g` in `{25 50 100 200 400 800}`, run `GOGC=$g ./prog`, capture output.
4. Plot or table: x = GOGC, y1 = GCCPUFraction, y2 = peak HeapInuse.
5. Identify the knee — where doubling GOGC stops meaningfully reducing GC CPU.

**Acceptance criteria.**
- You have data for all six GOGC values.
- GCCPUFraction monotonically decreases with GOGC; peak heap monotonically increases.
- You can identify the knee for your workload (often near `GOGC=200` for allocation-heavy ones).

<details><summary>Hints</summary>

- Use `runtime.GC()` before timing to start from a known state.
- `MemStats.GCCPUFraction` is total GC CPU / total program CPU since start.
- Run each value 3+ times; take the median. Single runs are noisy.
- Generate the script: `for g in 25 50 100 200 400 800; do GOGC=$g ./prog >> results.csv; done`.

</details>

<details><summary>Reference solution</summary>

```go
// gogcsweep/main.go
package main

import (
    "fmt"
    "os"
    "runtime"
    "time"
)

func work() {
    keep := make([][]byte, 0, 100_000)
    for i := 0; i < 50_000; i++ {
        keep = append(keep, make([]byte, 1024))
        // Half-drop pattern to keep heap interesting.
        if len(keep) > 20_000 {
            keep = keep[len(keep)/2:]
        }
    }
    runtime.KeepAlive(keep)
}

func main() {
    runtime.GC()
    var peak uint64
    start := time.Now()
    done := make(chan struct{})
    go func() {
        for {
            select {
            case <-done:
                return
            default:
                var m runtime.MemStats
                runtime.ReadMemStats(&m)
                if m.HeapInuse > peak {
                    peak = m.HeapInuse
                }
            }
        }
    }()

    work()
    close(done)

    elapsed := time.Since(start)
    var m runtime.MemStats
    runtime.ReadMemStats(&m)
    fmt.Printf("GOGC=%s elapsed=%dms gc_cpu=%.4f peak_inuse=%d MB\n",
        os.Getenv("GOGC"), elapsed.Milliseconds(), m.GCCPUFraction, peak>>20)
}
```

Driver script (`run.sh`):

```bash
#!/bin/bash
for g in 25 50 100 200 400 800; do
    for trial in 1 2 3; do
        GOGC=$g go run ./gogcsweep
    done
done
```

Sample collated:

```
GOGC=25  elapsed=890ms gc_cpu=0.198 peak_inuse=18 MB
GOGC=50  elapsed=720ms gc_cpu=0.115 peak_inuse=24 MB
GOGC=100 elapsed=640ms gc_cpu=0.068 peak_inuse=37 MB
GOGC=200 elapsed=610ms gc_cpu=0.041 peak_inuse=58 MB
GOGC=400 elapsed=595ms gc_cpu=0.024 peak_inuse=92 MB
GOGC=800 elapsed=590ms gc_cpu=0.015 peak_inuse=140 MB
```

Knee at `GOGC=200`: doubling further from 200→400 cuts GC CPU from 4.1% to 2.4% (1.7x) but doubles heap. From 25→50, you cut GC CPU from 19.8% to 11.5% (1.7x) for a 33% heap increase — much better trade. Diminishing returns set in around GOGC=200 for this workload.

Senior takeaway: there's no good default for `GOGC` other than 100 — but for *your* workload there is an optimum. Run this sweep before deploying any performance-critical Go service. Combined with `GOMEMLIMIT`, you get the modern formula: `GOMEMLIMIT=<container limit>, GOGC=<tuned for your trade-off>`. The pre-`GOMEMLIMIT` formula of "`GOGC=off`, do manual `runtime.GC()` calls" is obsolete; never do it in new code.

</details>

**Extension.** Repeat with `GOMEMLIMIT=80MiB`. Watch how the pacer behaves: low `GOGC` is now redundant (the memory limit triggers); high `GOGC` is capped by the limit. The two knobs interact non-trivially — that's by design.

---

## Task 15: finalizer-based leak detector

**Goal.** Use `runtime.SetFinalizer` to detect a class of leaks: objects that should have been closed/released but weren't. Build a small helper that logs unfreed objects.

**Difficulty.** Senior.

**Skills.** Finalizers, weak references via finalizer pattern, leak diagnosis tooling.

**Setup.** `finalizeleak/main.go`. A `Resource` type that *should* be `Close()`d.

**Steps.**
1. Define `Resource` with `id`, `Open()`, `Close()`. In `Open`, set a finalizer that logs "LEAK: %d never closed".
2. In `Close`, *clear* the finalizer via `runtime.SetFinalizer(r, nil)` so closed resources are silent.
3. Write a program that opens 10 resources, closes 7, drops references to all.
4. Call `runtime.GC()` twice (finalizers run on a separate goroutine; two GCs ensure their queue drains).
5. Sleep briefly to let finalizer goroutine run; confirm exactly 3 "LEAK" lines.

**Acceptance criteria.**
- The unclosed resources are logged; the closed ones are not.
- You correctly clear the finalizer in `Close` so successful closures don't log.
- You can articulate the danger: finalizers run on a runtime goroutine, can block GC progress, and aren't guaranteed to run.

<details><summary>Hints</summary>

- `SetFinalizer(p, fn)` schedules `fn(p)` to be called *after* `p` becomes unreachable.
- `SetFinalizer(p, nil)` removes the previously-set finalizer.
- Two GCs may be needed because the finalizer goroutine itself needs to run; sleep a few ms.
- Don't ship finalizer-based logging to production — the overhead is non-trivial.

</details>

<details><summary>Reference solution</summary>

```go
// finalizeleak/main.go
package main

import (
    "fmt"
    "runtime"
    "sync/atomic"
    "time"
)

type Resource struct {
    id     int
    closed atomic.Bool
}

var nextID atomic.Int64

func Open() *Resource {
    r := &Resource{id: int(nextID.Add(1))}
    runtime.SetFinalizer(r, func(r *Resource) {
        if !r.closed.Load() {
            fmt.Printf("LEAK: Resource %d was never closed\n", r.id)
        }
    })
    return r
}

func (r *Resource) Close() {
    r.closed.Store(true)
    // Clear the finalizer so closed resources are silent on GC.
    runtime.SetFinalizer(r, nil)
}

func main() {
    for i := 0; i < 10; i++ {
        r := Open()
        if i%10 < 7 {
            r.Close()
        }
        // Drop the reference (in real code, this happens at scope exit).
    }
    runtime.GC()
    // Finalizers run on a separate goroutine; give them a moment.
    time.Sleep(50 * time.Millisecond)
    runtime.GC()
    time.Sleep(50 * time.Millisecond)
    fmt.Println("done")
}
```

Output:

```
LEAK: Resource 10 was never closed
LEAK: Resource 9 was never closed
LEAK: Resource 8 was never closed
done
```

The finalizer machinery lives in `runtime/mfinal.go`. The key function is `runfinq` — a goroutine spawned by `createfing` that loops processing the finalizer queue. When a finalizable object becomes unreachable, the GC enqueues it; `runfinq` calls the finalizer; the object is *not* freed until the next GC cycle (finalizers can resurrect, so the runtime can't free immediately).

The big constraint: finalizers can prevent collection of cycles (Task 23). They also delay reclamation by at least one extra cycle. And — crucially — they may never run if the program exits before the finalizer goroutine processes them.

Senior takeaway: finalizers are debugging tools, not lifecycle managers. Never depend on them for correctness — use `defer x.Close()` for that. But for catching the *one resource* that escaped `defer` in a complex codebase, they are unmatched. Several major Go projects (database drivers, the `net` package) use this pattern internally for fd leak detection during tests.

</details>

**Extension.** Use `runtime.AddCleanup` (Go 1.24+) instead of `SetFinalizer`. `AddCleanup` is the modern replacement: cleaner semantics (no resurrection), better composability. Compare ergonomics.

---

## Task 16: write barrier slow path in CPU profile

**Goal.** Build a write-heavy workload that surfaces the write-barrier slow path in a CPU profile. Identify it by function name.

**Difficulty.** Senior.

**Skills.** CPU profiling, write barrier semantics, source navigation.

**Setup.** `writebarrier/main.go` plus profile capture.

**Steps.**
1. Build a program that repeatedly writes pointers into long-lived heap-allocated slices during an active GC mark phase.
2. Capture a CPU profile while it runs.
3. Open the profile in `go tool pprof`, type `top` and look for `gcWriteBarrier` or `wbBufFlush`.
4. Read `runtime/mbarrier.go` and `runtime/mwbbuf.go` to understand the slow path.

**Acceptance criteria.**
- CPU profile shows `runtime.gcWriteBarrier` (or one of its variants) consuming non-trivial CPU.
- You can explain the role of `wbBuf` and why it exists (per-P amortization of barrier work).
- You can identify when the slow path runs vs the fast path.

<details><summary>Hints</summary>

- The write barrier is enabled during `_GCmark`, disabled otherwise. Force more GC mark time by combining tight allocation with frequent pointer writes.
- The fast path is a few instructions inlined at call sites; the slow path is `wbBufFlush` in `mwbbuf.go`.
- Use `-source_path` so pprof can show the runtime source.

</details>

<details><summary>Reference solution</summary>

```go
// writebarrier/main.go
package main

import (
    "log"
    "os"
    "runtime"
    "runtime/pprof"
    "time"
)

type Node struct {
    Next *Node
    Data [64]byte
}

func main() {
    f, err := os.Create("cpu.prof")
    if err != nil {
        log.Fatal(err)
    }
    defer f.Close()
    pprof.StartCPUProfile(f)
    defer pprof.StopCPUProfile()

    // Long-lived linked-list nodes; many heap pointer writes follow.
    head := &Node{}
    cur := head
    for i := 0; i < 100_000; i++ {
        cur.Next = &Node{}
        cur = cur.Next
    }
    runtime.KeepAlive(head)

    // Now shuffle pointers around to provoke write-barrier work
    // during the next GC mark phases.
    deadline := time.Now().Add(3 * time.Second)
    for time.Now().Before(deadline) {
        // Walk the list, swap pointers, allocate to keep GC active.
        a := head
        for a != nil && a.Next != nil {
            tmp := a.Next.Next
            a.Next = tmp
            a = tmp
        }
        // Reallocate the tail to force GC churn.
        for j := 0; j < 1000; j++ {
            _ = make([]byte, 1024)
        }
    }
    runtime.KeepAlive(head)
}
```

```
$ go run ./writebarrier
$ go tool pprof cpu.prof
(pprof) top10
Showing nodes accounting for 2540ms, 100% of 2540ms total
      flat  flat%   sum%        cum   cum%
     680ms 26.77% 26.77%      680ms 26.77%  runtime.gcWriteBarrier
     310ms 12.20% 38.98%      310ms 12.20%  runtime.wbBufFlush1
     240ms 9.45% 48.43%       240ms 9.45%   main.main
     ...
```

The fast path: the compiler emits an inlined check `if writeBarrier.enabled` followed by a buffered append to the per-P `wbBuf`. The slow path is `wbBufFlush`/`wbBufFlush1` (in `runtime/mwbbuf.go`), called when the buffer fills (~256 entries by default). The flush marks the relevant objects via the work queue.

The barrier itself is described at the top of `mbarrier.go`. Key insight: Go uses a *hybrid* barrier — Yuasa-style (snapshot-at-the-beginning) on the deleted pointer plus Dijkstra-style (incremental update) on the inserted pointer. Both are buffered. This is in `mbarrier.go: gcWriteBarrier1` and friends.

Senior takeaway: pointer-heavy mutating workloads pay an ongoing tax during GC mark, even if individual writes are fast. The amortized cost per write is tiny (a few cycles), but for code doing millions of pointer writes per second during long-running marks, it adds up. If you see `gcWriteBarrier` high in profiles, consider: (a) reducing pointer density (value embeds), (b) reducing GC frequency (`GOGC` up), (c) batching writes outside mark phases (impractical, but it explains some "mysterious" performance behaviour).

</details>

**Extension.** Run the same workload with `GOGC=off`. The write barrier should never engage (mark phase doesn't run). Confirm `gcWriteBarrier` drops to ~0 in the profile.

---

## Task 17: many small structs vs one large struct

**Goal.** Compare GC cost between (a) a slice of one million pointer-to-struct, and (b) a slice of one million inline structs. Show the cost difference.

**Difficulty.** Senior.

**Skills.** Heap layout, indirect-vs-direct allocation, cache effects.

**Setup.** `manysmall/main.go` with two configurations.

**Steps.**
1. Allocate `[]*Small` of length 1M, each pointing to a freshly-allocated `Small`.
2. Allocate `[]Small` of length 1M, all inline (no pointers).
3. For each, time `runtime.GC()` and measure `MemStats.PauseNs[i]` and `runtime/metrics /gc/scan/heap:bytes` delta.
4. Print scan bytes and pause times.

**Acceptance criteria.**
- The slice-of-pointers version causes more bytes scanned (one million extra objects to walk).
- The slice-of-values version is faster to GC and uses slightly less total heap.
- You can explain: the slice of `*Small` is itself a million-pointer array — the GC walks each one even though the targets contain no further pointers.

<details><summary>Hints</summary>

- The slice of `*Small` has 1M pointer words in the backing array; the slice of `Small` has 0 pointer words if `Small` is pure scalar.
- Use `unsafe.Sizeof(Small{})` to confirm sizes.
- Compare the total `HeapObjects` count — pointer slice has 1M+1, value slice has 1.

</details>

<details><summary>Reference solution</summary>

```go
// manysmall/main.go
package main

import (
    "fmt"
    "runtime"
    "runtime/metrics"
    "time"
)

type Small struct {
    A, B int64
    C    [16]byte
}

func scanBytes() uint64 {
    s := []metrics.Sample{{Name: "/gc/scan/heap:bytes"}}
    metrics.Read(s)
    return s[0].Value.Uint64()
}

func measure(name string, build func() any) {
    runtime.GC()
    before := scanBytes()
    start := time.Now()
    x := build()
    runtime.GC()
    elapsed := time.Since(start)
    after := scanBytes()
    var m runtime.MemStats
    runtime.ReadMemStats(&m)
    fmt.Printf("%-12s scan=%d MB heapObjects=%d gcTime=%dus\n",
        name, (after-before)>>20, m.HeapObjects, elapsed.Microseconds())
    runtime.KeepAlive(x)
}

func main() {
    const n = 1_000_000
    measure("PointerSlice", func() any {
        out := make([]*Small, n)
        for i := range out {
            out[i] = &Small{A: int64(i), B: int64(i)}
        }
        return out
    })
    measure("ValueSlice", func() any {
        out := make([]Small, n)
        for i := range out {
            out[i] = Small{A: int64(i), B: int64(i)}
        }
        return out
    })
}
```

Sample:

```
PointerSlice scan=64 MB heapObjects=1000007 gcTime=8200us
ValueSlice   scan=40 MB heapObjects=8       gcTime=3100us
```

The pointer slice has one million additional heap objects, each individually allocated. The GC scans the slice's backing array (1M pointer words = 8MB of pointers), then *follows* each pointer to scan the pointed-to `Small`. Even though `Small` has no pointer fields, the runtime has to dispatch to the per-type scan logic to confirm that. The value slice has *one* object — the backing array — which is one giant scan with no indirection.

Senior takeaway: pointer slices are pessimal for GC. If `Small` is small (less than ~128 bytes) and not separately mutated, inline it. Slice of values is faster to allocate (one syscall), faster to scan (one object), faster to iterate (cache-friendly, sequential memory). Pointer slice is right when (a) `Small` is large and you avoid copying it, or (b) you need stable identities (the pointer is the identity), or (c) you sometimes hold nil entries. Otherwise, default to values.

</details>

**Extension.** Bench the iteration too. `for _, s := range valueSlice` versus `for _, s := range pointerSlice`. The value version is roughly 2-3x faster on modern CPUs because of contiguous memory access.

---

## Task 18: read mgcpacer.go and explain heapGoalInternal

**Goal.** Open `runtime/mgcpacer.go`, find `gcControllerState.heapGoalInternal`, read it, and write a one-paragraph explanation of how it computes the next trigger.

**Difficulty.** Staff.

**Skills.** Reading pacer source, understanding feedback loops.

**Setup.** Local Go source.

**Steps.**
1. Open `mgcpacer.go`.
2. Find the struct `gcControllerState`. Read the field comments.
3. Find `func (c *gcControllerState) heapGoalInternal()`. Read it.
4. Identify the three terms: GOGC-based goal, GOMEMLIMIT-based goal, runway adjustment.
5. Write a paragraph summary in your own words.

**Acceptance criteria.**
- You can quote the function signature.
- You can describe the three constraints that compete to set the goal.
- You can explain why the goal is "internal" — there's a separate `heapGoal()` that returns the published goal after rounding.

<details><summary>Hints</summary>

- The pacer's design is documented in `runtime/mgcpacer.go` header comment; read that first.
- The function `heapGoalInternal` is short — maybe 30 lines. The complexity is in what the inputs *mean*.
- The published Pacer design doc lives in the Go source tree at `src/runtime/HACKING.md` and the proposal repo (issue 44167); read both for the full picture.

</details>

<details><summary>Reference solution</summary>

`runtime/mgcpacer.go` excerpt (Go 1.22, approximately):

```go
// heapGoalInternal is the implementation of heapGoal which returns
// internal details about the goal.
func (c *gcControllerState) heapGoalInternal() (goal, minTrigger uint64) {
    // Start with the goal calculated for memoryLimit.
    goal = c.memoryLimitHeapGoal()

    // Check if the goal from GOGC is more restrictive. If not, the goal
    // is set by the memory limit.
    if newGoal := c.heapGoalGOGC(); newGoal < goal {
        goal = newGoal
    }

    // ...minTrigger logic for runway smoothing...

    return goal, minTrigger
}
```

Paragraph summary:

> `heapGoalInternal` computes the heap size at which the next GC should *complete* (not trigger — the trigger is earlier, computed to allow the cycle to finish at the goal). It evaluates two candidate goals and picks the *more aggressive* one. The first candidate, `heapGoalGOGC`, is `liveHeap + (GOGC/100) × (liveHeap + stackBytes + globalBytes)` — the classic Go GC formula, scaled by the GOGC environment variable. The second candidate, `memoryLimitHeapGoal`, is the bound implied by `GOMEMLIMIT`: roughly `memLimit − overheadBytes`, where overhead includes spans, stacks, and globals. The pacer takes the *minimum* — whichever forces an earlier collection. The function also computes `minTrigger`, a floor that prevents the pacer from triggering so often it spends all CPU in GC; this is the "GC CPU ceiling" of 25%. The returned `goal` is the internal full-precision value; `heapGoal()` rounds it for external use. The cycle then runs, the pacer observes actual scan rate and live heap, and updates its rate estimates for the next cycle — a tight PID-like feedback loop. Reading this function once is the difference between knowing Go has a GC and understanding *why* it does what it does.

Senior takeaway: the pacer is a control system. Its inputs are observed scan rate, allocation rate, GOGC, GOMEMLIMIT. Its output is the next heap goal. Get it wrong (set GOGC too low under tight memory pressure) and the system enters a feedback storm — death spiral, Task 19. The genius of the Go 1.19 pacer redesign (proposal 44167) is that it composes GOGC and GOMEMLIMIT into the same control surface; before that, the two were fighting each other.

</details>

**Extension.** Find the `gcController.revise` function. This is called periodically to update the assist ratio mid-cycle as the pacer observes actual scan progress. Read it; it's the heart of "the GC adapts in real-time".

---

## Task 19: reproduce a GC death spiral

**Goal.** Combine high allocation pressure with tight `GOMEMLIMIT` to produce a "GC death spiral" — a state where the program spends most of its time in GC and makes no progress. Analyze using gctrace.

**Difficulty.** Staff.

**Skills.** Pathological tuning, gctrace interpretation, mark-assist saturation diagnosis.

**Setup.** `deathspiral/main.go`. Allocates heavily; combined with very low `GOMEMLIMIT`.

**Steps.**
1. Write a program that allocates 100 MiB worth of live data in a tight loop.
2. Run with `GOMEMLIMIT=80MiB GODEBUG=gctrace=1`.
3. Observe: the GC fires constantly, mark-assist dominates, throughput collapses.
4. Read `GCCPUFraction` — should be >50%.
5. Increase the limit; observe recovery.

**Acceptance criteria.**
- You can produce a run where `GCCPUFraction > 0.5` (more than half the CPU is in GC).
- gctrace lines show high assist (`a/b/c` where `a` is many ms).
- You can explain: with the limit below live-heap-plus-headroom, the pacer demands the impossible — collection at a rate exceeding the marker's throughput.

<details><summary>Hints</summary>

- The pacer caps dedicated GC CPU at 25% (`gcBackgroundUtilization`). To do more work, it must charge mutators via assist. Hence mutators stall.
- Modern Go (1.19+) protects against the worst case by exceeding the limit and logging a "soft memory limit exceeded" message when truly impossible. Hard OOM only if the OS reaps.
- Watch CPU vs wall-time gap: lots of CPU, little forward progress = spiral.

</details>

<details><summary>Reference solution</summary>

```go
// deathspiral/main.go
package main

import (
    "fmt"
    "os"
    "runtime"
    "time"
)

func main() {
    // Build a live heap close to the GOMEMLIMIT.
    live := make([][]byte, 0, 100_000)
    for i := 0; i < 70_000; i++ {
        live = append(live, make([]byte, 1024)) // ~70 MiB live
    }

    // Now allocate hot; the heap is full, the limit is near.
    start := time.Now()
    var allocOps int
    for time.Since(start) < 5*time.Second {
        _ = make([]byte, 4096) // pure garbage; allocated and dropped
        allocOps++
    }

    var m runtime.MemStats
    runtime.ReadMemStats(&m)
    fmt.Fprintf(os.Stdout, "GOMEMLIMIT=%s allocs=%d NumGC=%d GCCPUFraction=%.4f totalPauseMs=%d\n",
        os.Getenv("GOMEMLIMIT"), allocOps, m.NumGC, m.GCCPUFraction, m.PauseTotalNs/1e6)
    runtime.KeepAlive(live)
}
```

Run normal:

```
$ /usr/bin/time go run ./deathspiral
GOMEMLIMIT= allocs=82000000 NumGC=44 GCCPUFraction=0.0421 totalPauseMs=18
        5.21 real    5.18 user    0.10 sys
```

Run with tight limit:

```
$ GOMEMLIMIT=80MiB GODEBUG=gctrace=1 /usr/bin/time go run ./deathspiral 2>&1 | tail -10
gc 312 @4.78s 73%: 0.04+3.2+0.008 ms clock, 0.32+15.4/2.1/0.04+0.064 ms cpu, 76->77->75 MB, 80 MB goal, ...
gc 313 @4.82s 73%: 0.04+3.4+0.008 ms clock, 0.32+16.2/2.0/0.04+0.064 ms cpu, 76->77->75 MB, 80 MB goal, ...
GOMEMLIMIT=80MiB allocs=2400000 NumGC=313 GCCPUFraction=0.7321 totalPauseMs=2120
        5.34 real    5.30 user    0.12 sys
```

Allocation throughput dropped from 82M ops in 5 seconds to 2.4M — a 34x slowdown. `GCCPUFraction` rose from 4% to 73%. The pacer is forcing the program to spend 3/4 of its time doing GC work, because at this heap/limit ratio it's the only way to keep memory under the cap.

This is documented in `runtime/mgcpacer.go` and in the GOMEMLIMIT proposal (48409) under "death spiral protection". The Go runtime will *exceed* the limit before fully halting progress — but it will get very close to the spiral state, exactly as observed here. The OS may then OOM-kill if total RSS exceeds the cgroup limit.

The fix is structural: live heap must be smaller than `GOMEMLIMIT × 0.7` (rough rule). If it's not, either the limit needs to grow or the working set needs to shrink. There is no tuning escape from this — physics wins.

Senior takeaway: `GOMEMLIMIT` is a soft cap with a hard floor. Setting it below live heap creates a spiral. Always size the limit at 1.5x the steady-state live heap minimum, with monitoring on `GCCPUFraction > 0.20` as an early warning. Spiral is a configuration bug; the runtime cannot save you from it.

</details>

**Extension.** Add `debug.SetGCPercent(-1)` (disable percent-based trigger) and run with the tight limit. The limit alone now drives GC. Observe behaviour: similar spiral, slightly different shape.

---

## Task 20: read proposal 48409 (GOMEMLIMIT)

**Goal.** Read the Go proposal for `GOMEMLIMIT` (issue 48409, also `Design/48409-soft-memory-limit.md` in the proposal repo). Summarize the four design decisions.

**Difficulty.** Staff.

**Skills.** Reading design proposals, distinguishing trade-offs.

**Setup.** Browser or local clone of `golang/proposal`.

**Steps.**
1. Open https://github.com/golang/proposal/blob/master/design/48409-soft-memory-limit.md
2. Read the "Background", "Goals", "Design", and "Implementation" sections.
3. Identify four design decisions: soft vs hard limit, interaction with GOGC, behaviour at exhaustion, units/parsing.
4. Write a one-sentence explanation of each.

**Acceptance criteria.**
- You produce four design-decision summaries.
- Each captures the *trade-off* (what was rejected and why).
- You can articulate the *anti-goal* (what GOMEMLIMIT is not).

<details><summary>Hints</summary>

- Don't summarize from memory. Read the actual proposal.
- The "Rejected alternatives" section is the most informative — it tells you what they considered and why they chose otherwise.
- Cross-reference with `runtime/extern.go`'s documentation on `GOMEMLIMIT` for the final shipped behaviour.

</details>

<details><summary>Reference solution</summary>

Reading proposal 48409 (Michael Knyszek, accepted Q1 2022), the four design decisions:

**1. Soft limit, not hard.**
> *Decision:* `GOMEMLIMIT` is *soft* — the runtime tries hard to stay under it but exceeds it rather than fail allocation.
> *Rejected:* hard limit returning `runtime.OutOfMemoryError`. Reasoning: a hard limit would force application code to handle OOM at every allocation site, which is impractical in Go and conflicts with the "allocate freely" idiom. A soft limit lets the runtime apply best-effort backpressure (mark-assist, more frequent GC) without surfacing failures the user can't reasonably handle.

**2. Composes with GOGC, doesn't replace it.**
> *Decision:* `GOGC` continues to set the percentage-based trigger; `GOMEMLIMIT` is an additional ceiling. The pacer takes the min of both candidate goals.
> *Rejected:* replacing `GOGC` semantics or making them mutually exclusive. Reasoning: existing programs depend on `GOGC`'s trade-off behavior; the limit is for *bounded* environments (containers) where `GOGC` alone over-allocates. Keeping both gives operators a CPU-vs-memory dial (`GOGC`) and a hard ceiling (`GOMEMLIMIT`).

**3. Death spiral protection via 50% CPU cap.**
> *Decision:* if the runtime would spend more than 50% of CPU on GC to respect the limit, it lets the limit be exceeded instead.
> *Rejected:* unbounded mark-assist (Java's CMS-failure mode) or OOM-error. Reasoning: a runtime that spends 90% of its time in GC is dead-but-not-dead — worse than a clean failure. By capping GC CPU, the program continues making progress (via heap growth past the limit) rather than spiraling. The kernel OOM-kill becomes the fallback for truly impossible workloads.

**4. SI units and SI-suffix parsing.**
> *Decision:* `GOMEMLIMIT=100MiB` or `GOMEMLIMIT=1.5GiB`. Decimal: bytes. Suffixes: B, KiB, MiB, GiB.
> *Rejected:* MB/GB (1000-based) or raw-byte-only. Reasoning: containers and operators speak in MiB/GiB; the runtime should accept the same units. Decimal SI (MB = 1000²) was rejected as ambiguous in low-level contexts.

The anti-goal: `GOMEMLIMIT` is *not* a tool for tuning GC frequency. That's `GOGC`. `GOMEMLIMIT` is a backstop for *bounded* deployments — Kubernetes pods, AWS Lambda, anything with a hard container limit. Use `GOMEMLIMIT` to prevent OOM-kill; use `GOGC` to tune the throughput/footprint trade-off within that envelope.

Senior takeaway: design proposals are the best Go documentation. The shipped behaviour is the residue of dozens of design conversations; reading the proposal tells you *why* the runtime does what it does. Proposals worth reading from this same era: 14647 (low-latency GC), 17503 (concurrent stack scan removal), 44167 (pacer redesign), 51317 (GC scaling). They form a continuous narrative.

</details>

**Extension.** Compare with Java's `-Xmx` (hard heap cap) and `-XX:MaxRAMPercentage` (soft cap as fraction of container memory). Note how `GOMEMLIMIT`'s "soft" semantics differ from both — closer to G1's "max heap occupancy after concurrent cycle" hint.

---

## Task 21: custom allocation tracker via runtime/metrics

**Goal.** Build a small custom tracker that polls `runtime/metrics` once per second, computes deltas, and graphs live heap, allocation rate, and GC pause p99 over time.

**Difficulty.** Staff.

**Skills.** `runtime/metrics`, time series, building a Grafana-like view in a single binary.

**Setup.** `alloctrack/main.go`. Output to stdout (text graph) or to a file (CSV).

**Steps.**
1. Discover relevant metric names with `metrics.All()`.
2. Subscribe to: `/memory/classes/heap/objects:bytes`, `/gc/heap/allocs:bytes`, `/gc/heap/frees:bytes`, `/gc/pauses:seconds`, `/cpu/classes/gc/total:cpu-seconds`.
3. Sample every second; compute deltas.
4. Emit CSV with `timestamp, live_mb, alloc_rate_mbps, free_rate_mbps, gc_pause_p99_us, gc_cpu_pct`.
5. Run the workload from Task 4 or Task 5 alongside; observe the output.

**Acceptance criteria.**
- Program runs continuously, producing one row per second.
- Allocation rate is computed correctly (delta bytes / delta seconds).
- p99 pause is taken from the histogram bucket walk (Task 12).
- Output can be plotted in any tool (gnuplot, Excel, paste into a Grafana panel).

<details><summary>Hints</summary>

- `metrics.All()` returns a description for every metric; iterate to discover them.
- Reading is via `metrics.Read([]Sample)`; the `Sample.Value` has a `Kind()` distinguishing uint64, float64, float64 histogram.
- Wrap the polling in its own goroutine; the workload runs in `main`.

</details>

<details><summary>Reference solution</summary>

```go
// alloctrack/main.go
package main

import (
    "fmt"
    "os"
    "runtime/metrics"
    "time"
)

type sampler struct {
    samples []metrics.Sample
}

func newSampler() *sampler {
    names := []string{
        "/memory/classes/heap/objects:bytes",
        "/gc/heap/allocs:bytes",
        "/gc/heap/frees:bytes",
        "/gc/pauses:seconds",
        "/cpu/classes/gc/total:cpu-seconds",
        "/cpu/classes/total:cpu-seconds",
    }
    s := &sampler{samples: make([]metrics.Sample, len(names))}
    for i, n := range names {
        s.samples[i].Name = n
    }
    return s
}

func (s *sampler) read() {
    metrics.Read(s.samples)
}

func (s *sampler) live() uint64       { return s.samples[0].Value.Uint64() }
func (s *sampler) allocs() uint64     { return s.samples[1].Value.Uint64() }
func (s *sampler) frees() uint64      { return s.samples[2].Value.Uint64() }
func (s *sampler) gcCPU() float64     { return s.samples[4].Value.Float64() }
func (s *sampler) totalCPU() float64  { return s.samples[5].Value.Float64() }

func (s *sampler) pauseP99us() float64 {
    h := s.samples[3].Value.Float64Histogram()
    var total uint64
    for _, c := range h.Counts {
        total += c
    }
    if total == 0 {
        return 0
    }
    target := uint64(float64(total) * 0.99)
    var seen uint64
    for i, c := range h.Counts {
        seen += c
        if seen >= target {
            return h.Buckets[i+1] * 1e6
        }
    }
    return h.Buckets[len(h.Buckets)-1] * 1e6
}

func main() {
    out := os.Stdout
    fmt.Fprintln(out, "ts,live_mb,alloc_rate_mbps,free_rate_mbps,gc_pause_p99_us,gc_cpu_pct")

    prev := newSampler()
    prev.read()
    prevTime := time.Now()

    ticker := time.NewTicker(time.Second)
    defer ticker.Stop()

    // Background workload (move to a goroutine or run as separate process).
    go workload()

    for now := range ticker.C {
        cur := newSampler()
        cur.read()
        dt := now.Sub(prevTime).Seconds()
        allocRate := float64(cur.allocs()-prev.allocs()) / dt / (1 << 20)
        freeRate := float64(cur.frees()-prev.frees()) / dt / (1 << 20)
        gcCPUPct := 100 * (cur.gcCPU() - prev.gcCPU()) / (cur.totalCPU() - prev.totalCPU())
        fmt.Fprintf(out, "%d,%d,%.2f,%.2f,%.1f,%.2f\n",
            now.Unix(),
            cur.live()>>20,
            allocRate,
            freeRate,
            cur.pauseP99us(),
            gcCPUPct,
        )
        prev = cur
        prevTime = now
    }
}

func workload() {
    keep := make([][]byte, 0, 100_000)
    for {
        keep = append(keep, make([]byte, 4096))
        if len(keep) > 20_000 {
            keep = keep[len(keep)/2:]
        }
    }
}
```

Output:

```
ts,live_mb,alloc_rate_mbps,free_rate_mbps,gc_pause_p99_us,gc_cpu_pct
1700000000,42,178.40,176.20,256.0,3.21
1700000001,44,182.10,180.30,256.0,3.18
1700000002,43,181.80,180.50,512.0,3.41
...
```

This is a complete custom version of what `prometheus/client_golang` exposes via its `collectors.NewGoCollector(collectors.WithGoCollections(collectors.GoRuntimeMetricsCollection))`. The latter is what you'd ship to production; building it yourself once teaches you what every panel in a typical Go observability dashboard actually measures.

Senior takeaway: don't trust dashboards you don't understand. Build the data path once, end-to-end, from `metrics.Read` to a CSV row. The next time a production GC issue surfaces, you'll read the dashboard fluently instead of squinting at it.

</details>

**Extension.** Write the output to InfluxDB or Prometheus; visualize in Grafana. The runtime metrics align directly with the official `go_gc_*` Prometheus metrics — your panel won't look out of place.

---

## Task 22: dump goroutine stack and find GC roots

**Goal.** Use `runtime.Stack` to capture a goroutine's stack, then identify what would be a GC root from that goroutine.

**Difficulty.** Staff.

**Skills.** `runtime.Stack`, GC root identification, mapping stack frames to types.

**Setup.** `stackroots/main.go`.

**Steps.**
1. Write a function that holds several local variables of pointer types and slice types, then sleeps.
2. From another goroutine, capture the stack of the first using `runtime.Stack(buf, true)`.
3. Parse the output to identify the function's locals.
4. Cross-reference with `runtime/mgcmark.go: scanstack` — the function the GC uses to walk stack roots.
5. Document what the GC sees vs what `runtime.Stack` prints.

**Acceptance criteria.**
- You can dump a stack and identify locals.
- You can articulate what a "GC root" is: a pointer found while walking the goroutine's active stack frames + the goroutine's defer chain + the goroutine's panic chain.
- You can explain why the GC's view of "locals" is more detailed than the textual dump (it knows precise pointer offsets via the frame's *funcdata*).

<details><summary>Hints</summary>

- `runtime.Stack(buf, all=true)` dumps every goroutine; `all=false` dumps just the calling goroutine.
- The textual dump is for humans; the GC uses *stack maps* (per-PC pointer bitmaps generated by the compiler) to know exactly which words in each frame are pointers.
- Read `runtime/mgcmark.go: scanstack` to see how those stack maps are consumed.

</details>

<details><summary>Reference solution</summary>

```go
// stackroots/main.go
package main

import (
    "fmt"
    "runtime"
    "time"
)

func holder(ch <-chan struct{}) {
    local1 := make([]byte, 4096)
    local2 := &struct{ Name string }{Name: "alice"}
    local3 := map[string]int{"a": 1, "b": 2}
    _ = local1
    _ = local2
    _ = local3
    <-ch
}

func main() {
    ch := make(chan struct{})
    go holder(ch)
    time.Sleep(50 * time.Millisecond)

    buf := make([]byte, 64<<10)
    n := runtime.Stack(buf, true)
    fmt.Printf("---\n%s---\n", buf[:n])

    close(ch)
}
```

Output:

```
goroutine 1 [running]:
main.main()
        /tmp/stackroots/main.go:21 +0x6c

goroutine 6 [chan receive]:
main.holder(0xc0000a6000)
        /tmp/stackroots/main.go:14 +0x65
created by main.main in goroutine 1
        /tmp/stackroots/main.go:18 +0x53
```

The textual output names the function and shows the receiver argument's address but not the values of `local1`, `local2`, `local3`. These are *not absent* from the GC's view; they're absent from the *human-readable* view.

The actual GC root walk in `runtime/mgcmark.go: scanstack`:

```go
func scanstack(gp *g, gcw *gcWork) {
    // ... validation ...
    // Walk the stack frames from the top down.
    var state stackScanState
    state.stack = gp.stack
    state.buf = gcw
    // gentraceback walks frames; each frame's funcdata includes
    // a pointer bitmap saying which slots are pointers.
    n := 0
    gentraceback(^uintptr(0), ^uintptr(0), 0, gp, 0, nil, 0x7fffffff,
        scanframeworker(gp, &state, gcw), nil, 0)
    // ...also scan defer chain and panic chain...
}
```

For `holder`'s frame, the compiler-generated funcdata includes:
- `local1` is a `[]byte` (3 words: data ptr, len, cap; bitmap says word 0 is a pointer).
- `local2` is a `*struct{...}` (1 word, pointer).
- `local3` is a `map[string]int` which under the hood is a `*hmap` (1 word, pointer).

The GC walks each pointer slot, marks the pointed-to object, queues for further scanning. The `ch` argument is also a pointer (channels are `*hchan` under the hood) and is scanned similarly.

Senior takeaway: every active goroutine contributes its stack to the GC's root set. Lots of goroutines with deep stacks = lots of root scan work. The `runtime/metrics` value `/gc/stack/starting-size:bytes` and `MemStats.StackInuse` measure this directly. If you're seeing high `gc 0->X stacks` numbers in gctrace and high p99 pause, the answer is often "fewer goroutines" — not "tune the GC".

</details>

**Extension.** Use `runtime.Stack(buf, true)` periodically and grep for stacks blocked on channels you don't recognize — goroutine leak detector in 5 lines.

---

## Task 23: finalizer cycle preventing collection

**Goal.** Construct two objects with finalizers that reference each other (a cycle). Show that neither gets collected. Explain via `runtime/mfinal.go`.

**Difficulty.** Staff.

**Skills.** Finalizer semantics, cycle detection, reading source.

**Setup.** `finalizercycle/main.go`.

**Steps.**
1. Create `a *A` and `b *B` such that `a.ref = b` and `b.ref = a`.
2. Set finalizers on both.
3. Drop external references.
4. Run `runtime.GC()` repeatedly. Confirm finalizers never fire.
5. Read `runtime/mfinal.go` and explain why.

**Acceptance criteria.**
- The pair is never collected (you can demonstrate via repeated `MemStats` reads).
- You can quote the relevant passage from `mfinal.go` explaining the cycle restriction.
- You can articulate the workaround: remove one finalizer to break the cycle.

<details><summary>Hints</summary>

- The doc on `runtime.SetFinalizer` explicitly notes the cycle restriction.
- The mechanism: the GC keeps an object with a finalizer alive until the finalizer runs. If two such objects reference each other, neither can become unreachable.
- Workaround: use weak references (Go 1.24+ `weak` package) or break the cycle structurally.

</details>

<details><summary>Reference solution</summary>

```go
// finalizercycle/main.go
package main

import (
    "fmt"
    "runtime"
    "time"
)

type A struct {
    id  int
    ref *B
}

type B struct {
    id  int
    ref *A
}

func main() {
    var aFinalized, bFinalized bool

    func() {
        a := &A{id: 1}
        b := &B{id: 2}
        a.ref = b
        b.ref = a
        runtime.SetFinalizer(a, func(*A) { aFinalized = true; fmt.Println("A finalized") })
        runtime.SetFinalizer(b, func(*B) { bFinalized = true; fmt.Println("B finalized") })
        // a, b go out of scope at function return.
    }()

    for i := 0; i < 5; i++ {
        runtime.GC()
        time.Sleep(20 * time.Millisecond)
    }
    fmt.Printf("aFinalized=%v bFinalized=%v\n", aFinalized, bFinalized)

    // Compare: now break the cycle.
    func() {
        a := &A{id: 3}
        b := &B{id: 4}
        a.ref = b
        // b.ref = a   // cycle broken
        runtime.SetFinalizer(a, func(*A) { fmt.Println("A2 finalized") })
        runtime.SetFinalizer(b, func(*B) { fmt.Println("B2 finalized") })
    }()
    for i := 0; i < 5; i++ {
        runtime.GC()
        time.Sleep(20 * time.Millisecond)
    }
}
```

Output:

```
aFinalized=false bFinalized=false
B2 finalized
A2 finalized
```

The cycle pair never finalizes; the non-cycle pair does (in arbitrary order — finalizers are not topologically ordered).

The `runtime.SetFinalizer` doc says:

> A single goroutine runs all finalizers for a program, sequentially. If a finalizer must run for a long time, it should do so by starting a new goroutine.
> [...]
> Finalizers are not guaranteed to run if the program exits before they are scheduled. **A cyclic structure among finalized objects is never collected.** It is not guaranteed that a finalizer will run if the size of *obj is zero bytes, because the same address may have multiple objects.

The "never collected" cycle restriction is enforced by `runtime/mfinal.go`. The mechanism: when the GC marks an object with a registered finalizer, the runtime keeps the object's *transitive closure of references* reachable through `finalizer.fn` and the registered object. Two cyclically-referenced objects keep each other in this closure forever.

The structural fix: finalizers are not lifecycle managers. Use them for *one-shot* cleanup (close fd if accidentally not closed), not for object graphs. If you need cleanup across a cyclic structure, designate one root, finalize only it, and have it call cleanup on the rest.

Modern Go (1.24+) provides `runtime.AddCleanup`, which has cleaner semantics — the cleanup callback receives only a separate "context" value, not the object itself, breaking the resurrection-allowing reference. Use `AddCleanup` over `SetFinalizer` in new code.

Senior takeaway: finalizers are tricky enough that the standard library actively avoids them. `os.File`, `net.Conn`, `sql.DB` — none rely on finalization for correctness. They use `defer` and explicit `Close`. Finalizers in those packages exist *only* as a debugging aid to catch missed closes. Take the same approach in your code.

</details>

**Extension.** Replace one of the cycle's pointers with a `weak.Pointer[B]` (Go 1.24+). The cycle is broken from the GC's perspective; both objects can now be collected.

---

## Task 24: qualitative comparison with Java G1

**Goal.** Write a one-page comparison of Go's GC and Java's G1 at the level of "what does each prioritize, what are the headline trade-offs, where does each lose".

**Difficulty.** Staff.

**Skills.** Cross-runtime literacy, identifying meaningful comparisons.

**Setup.** No code. A blank document. References to the Go GC design and the G1 paper or OpenJDK G1 documentation.

**Steps.**
1. List Go GC's core properties: concurrent, non-moving, non-generational, mark-sweep with bitmap-based marking, software write barrier, hybrid Yuasa+Dijkstra barrier.
2. List G1's core properties: concurrent, *moving* (compacting), *generational* (young/old regions), mark-sweep + evacuation, mixed software/hardware barriers, SATB.
3. For each of: pause-time, throughput, memory overhead, latency tail, fragmentation, large-heap behavior — say who wins and why.
4. End with: when would you pick each?

**Acceptance criteria.**
- Six axes of comparison.
- A clear "Go wins / G1 wins / tie" per axis with reasoning.
- A concluding decision rule.

<details><summary>Hints</summary>

- Go: non-moving, so no compaction stalls; predictable sub-millisecond pauses; less efficient at huge heaps because objects don't move.
- G1: moving and generational, so much better throughput on long-lived heaps; pause-time goal-driven; worse predictability at the p99.9 tail.
- Both are concurrent; both target latency. The implementation philosophies diverge.

</details>

<details><summary>Reference solution</summary>

**Go GC vs Java G1 — six-axis comparison.**

*Properties recap:*

| | Go GC | G1 |
|--|-------|----|
| Moving | No (non-moving mark-sweep) | Yes (region-based copying) |
| Generational | No (Go 1.5+; experimentally generational in 1.5 then removed) | Yes (young/old regions) |
| Write barrier | Hybrid Yuasa+Dijkstra, buffered, ~few ns/write | SATB, card table, more complex |
| Pacer | Feedback-driven, GOGC + GOMEMLIMIT | Pause-time goal driven (`-XX:MaxGCPauseMillis`) |
| Mark algorithm | Tricolor with stack-marking on the workers | SATB + concurrent marking |

**1. Pause-time.**
> *Go wins.* Sub-millisecond p99 is typical; mark-termination STW is bounded by stack scan + flush. G1's p99 can reach tens of ms even with goal-based tuning, especially on large heaps with many regions.

**2. Throughput.**
> *G1 wins.* Compaction means contiguous allocation (bump pointer in young regions); the per-allocation cost is lower. Go's non-moving allocator must consult size-class free lists, and pointer-heavy heaps pay write-barrier costs G1's generational hypothesis avoids for most writes.

**3. Memory overhead.**
> *G1 wins on bookkeeping density; Go wins on tunability.* G1's per-region remembered sets cost memory; Go's bitmap is tighter. But Go without `GOMEMLIMIT` (pre-1.19) over-allocates 100% by default — `GOMEMLIMIT` made this competitive in 2022.

**4. Latency tail (p99.9 and worse).**
> *Go wins decisively.* The non-moving model means there is no "evacuation pause" outlier waiting to happen. G1's p99.9 is famously variable; tuning for it is most of what "Java GC engineering" means. Go's p99.9 is rarely worse than 2x its p99.

**5. Fragmentation.**
> *G1 wins.* This is the headline cost of Go's non-moving design: long-running Go services with diverse object sizes can develop heap fragmentation that recovers only through coalescing-on-allocation. G1 compacts as part of normal cycles, eliminating fragmentation as a long-term concern. For services with bounded object lifetimes this is moot; for very-long-running services with diverse allocation patterns, Go shows it.

**6. Large-heap behavior (>32 GB).**
> *G1 wins.* G1 was designed for multi-tens-of-GB heaps from day one; it scales by region count, not by individual objects. Go's mark phase scales with reachable bytes; pause time grows with stack scanning at high goroutine counts. Industry experience: Go works well up to ~64 GB heaps; beyond that, G1 (or ZGC/Shenandoah) is the better choice.

**Decision rule:**
- Latency-critical service, heap up to ~32 GB, predictable working set: **Go GC** is the obvious choice. Tail latency, simplicity, no tuning beyond `GOGC`/`GOMEMLIMIT`.
- High-throughput batch or analytical workload, heap from a few GB to 100+ GB, can tolerate occasional 100ms+ pauses: **G1** (or ZGC/Shenandoah for sub-10ms pauses at any heap size).
- Service with diverse long-lived object sizes and fragmentation pressure: **G1** for compaction; design Go data structures around pooling if you must use Go.

Senior takeaway: Go's GC is a *deliberate point on the design space*: extremely low pause time, low operational tuning surface, accepting fragmentation and lower throughput as the cost. G1 is a *different deliberate point*: configurable pause goal, throughput-optimized, accepting tuning complexity. Neither is universally better; the question is always "which trade-offs do you want to make for this workload". A staff engineer can articulate this without flinching; a junior describes Go's GC as "fast" or "good" without context.

</details>

**Extension.** Add a third column for ZGC and Shenandoah — both are pauseless (sub-millisecond at any heap size) using read barriers and concurrent compaction. The new question becomes "Go vs ZGC", which is closer than Go vs G1 ever was. Read the ZGC paper if you want to understand where GC research is heading.

---

## How to grade yourself

Score each task `0` (didn't try), `1` (got it with hints), `2` (unaided), `3` (extended it or found something the reference didn't show). Sum:

| Score | What it means |
|-------|---------------|
| 0–20  | You can run `GODEBUG=gctrace=1` but haven't yet built intuition for what the numbers mean. Re-do Tasks 1, 2, 4 carefully. The point of those three is to feel "GC happened *because*" rather than "GC happened". |
| 21–40 | You can read `MemStats`, pick the right pprof view, and tune `GOGC` from data. Tasks 11–13 are the leap from "user of the runtime" to "reader of the runtime". The first time you find a behaviour in `mgc.go` that explains a number you saw in gctrace, you've crossed it. |
| 41–55 | Senior. You can diagnose any GC issue with one terminal session: gctrace + `runtime/metrics` + pprof, plus one source-file lookup. Tasks 18–24 are about understanding the *design choices* that shaped this runtime — the pacer's feedback loop, GOMEMLIMIT's soft semantics, why finalizer cycles are forbidden, why Go's GC made the trade-offs it did. |
| 56–72 | Staff. You can defend the Go GC's design against criticism, predict when it will misbehave, and architect Go systems that respect its strengths. The final two tasks (death spiral and the G1 comparison) test whether you understand the *why*, not just the *what*. |

Concrete checks worth running:

- Task 1: every field in gctrace explainable from source. No "I think this means..." answers.
- Task 5: `peak RSS` under `GOMEMLIMIT=100MiB` is within 20% of 100 MiB on three repeated runs.
- Task 8: bytes-scanned ratio (pointer struct / value struct) is between 1.5x and 4x.
- Task 11: you can quote `gcStart`'s signature and three function names it calls.
- Task 12: p99 is at least 2x p50 in any non-trivial workload.
- Task 13: with `GOGC=10`, mark-assist field (`a` in `a/b/c`) is at least 5x larger than with `GOGC=100`.
- Task 14: there is a defensible "knee" in your data with a one-sentence justification.
- Task 19: under tight `GOMEMLIMIT`, `GCCPUFraction` exceeds 0.50 on at least one run.
- Task 23: you can demonstrate the cycle never collects AND demonstrate that breaking it allows collection.

The most important question is not *did you finish all 24* — it's *can you, given a gctrace line from a production system, predict the program's behaviour and propose a tuning?* That's the level the rest of this folder is building you toward. The source files of `runtime/mgc*.go` are 5,000+ lines; reading them once is a weekend, and worth every hour.

---

## Stretch challenges

**S1 — Reproduce the Go 1.5 generational experiment.** Go briefly had a generational mode in 1.5-beta that was removed before release. Read the issue threads (search "generational" on golang/go); understand why it was removed. Build a Go program that demonstrates why generational hypothesis would help (a workload where most objects die young) and explain why the team chose tricolor-non-moving over young-gen-copy.

**S2 — Build a `runtime/metrics` to Prometheus adapter from scratch.** Don't use `prometheus/client_golang`. Read `runtime/metrics.All()`; for each metric, choose the right Prometheus type (Counter/Gauge/Histogram); expose via `net/http`; render Prometheus exposition format manually. The exercise teaches you both the runtime metrics catalog and the Prometheus model. Compare your output with `client_golang` byte-for-byte.

**S3 — Profile-driven GC tuner.** Build a daemon that periodically samples `runtime/metrics`, computes `GCCPUFraction` and peak `HeapInuse`, and dynamically adjusts `debug.SetGCPercent()` and `debug.SetMemoryLimit()` to keep both within target windows. Run it under a varying workload; show that it tracks the workload better than any fixed tuning. This is what production Go services *should* do but rarely bother with — and it's only ~200 lines.
