# GOGC and GOMEMLIMIT — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros-cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use / Feature](#product-use-feature)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases-pitfalls)
18. [Common Mistakes](#common-mistakes)
19. [Common Misconceptions](#common-misconceptions)
20. [Tricky Points](#tricky-points)
21. [Test](#test)
22. [Tricky Questions](#tricky-questions)
23. [Cheat Sheet](#cheat-sheet)
24. [Self-Assessment Checklist](#self-assessment-checklist)
25. [Summary](#summary)
26. [What You Can Build](#what-you-can-build)
27. [Further Reading](#further-reading)
28. [Related Topics](#related-topics)
29. [Diagrams & Visual Aids](#diagrams-visual-aids)

---

## Introduction

> Focus: "What is `GOGC`? What is `GOMEMLIMIT`? When and why do I touch them?"

Every Go program comes with a garbage collector that runs while your code runs. Most of the time you do not have to think about it — the runtime decides when to collect, how much to collect, and how to do it without freezing your program. The two environment variables `GOGC` and `GOMEMLIMIT` are the front-panel switches for that collector. They are the only knobs the standard Go runtime exposes for GC behaviour, and the same two knobs cover almost every tuning question you will be asked at a job interview or in an on-call rotation.

The shortest possible summary:

- `GOGC` decides **when** the next collection happens, as a percentage above the last collection's live size. Default `100` means "let the heap double before collecting again."
- `GOMEMLIMIT` (Go 1.19+) sets a **soft memory ceiling**. The collector tries to keep the total memory used by the Go runtime below this number.

You may run a Go program for years without setting either one. But the moment you put a Go service in a container with a 512 MB memory limit, or behind a strict P99 latency target, these two variables become the difference between a smooth service and one that OOM-kills under load.

After reading this file you will:

- Know what garbage collection in Go is at a high level (mark-and-sweep, concurrent, mostly non-blocking)
- Understand exactly what `GOGC=100` means and what changes if you set it to `50` or `200`
- Understand exactly what `GOMEMLIMIT=512MiB` means and why containers should use it
- Know the three runtime functions that mirror these environment variables: `debug.SetGCPercent`, `debug.SetMemoryLimit`, `runtime.GC()`
- Be able to read a single line of `GODEBUG=gctrace=1` output
- Recognise the most common tuning mistakes (setting `GOGC=off`, ignoring `GOMEMLIMIT` in containers, calling `runtime.GC()` in hot paths)

You do not yet need to understand the GC algorithm itself in detail. The middle and senior files cover concurrent mark, the write barrier, GC assist, and the 2022 soft-target redesign. This file is about the user-facing controls.

---

## Prerequisites

- **Required:** A Go installation, version 1.19 or newer. `GOMEMLIMIT` only exists from 1.19.
- **Required:** Comfort running a Go program from the command line and setting environment variables: `GOGC=50 go run main.go`.
- **Required:** A vague feel for what a garbage collector does — frees memory you no longer reference. You do not need to know the algorithm yet.
- **Helpful:** Some experience with another GC'd language (Java, C#, Python) so you know the words "young generation", "heap", "stop-the-world."
- **Helpful:** Awareness that Go programs run as a single OS process and that the `go` runtime allocates memory from the OS in chunks (the *heap*).

If `go version` prints `go1.19` or newer and you can run a `main.go` with an environment variable prepended, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Garbage collector (GC)** | The runtime subsystem that finds memory no longer reachable and returns it to the allocator. Go uses a concurrent, non-generational, mark-and-sweep collector. |
| **Heap** | The region of memory holding values that outlive their stack frame. Allocated by the Go runtime in pages; tracked and reclaimed by the GC. |
| **Live heap** | The portion of the heap still reachable from program roots (globals, stack, registers). What the GC keeps after a collection. |
| **Heap goal** | The size at which the runtime wants to start the next GC. Computed from the live heap and `GOGC`. |
| **`GOGC`** | Environment variable. The percentage growth of the heap above the last live size that triggers the next GC. Default `100`. Setting to `off` disables GC. |
| **`GOMEMLIMIT`** | Environment variable (Go 1.19+). A soft memory cap in bytes for the Go runtime. The GC tries to stay below it by collecting more aggressively as memory grows. |
| **Stop-the-world (STW)** | A phase where all goroutines pause so the GC can do work that requires a consistent snapshot. In modern Go, STW phases are short — typically well under a millisecond. |
| **Concurrent mark** | The phase where the GC walks objects to find what is reachable while the program continues to run. |
| **Sweep** | The phase where memory is actually freed. In Go, sweep runs lazily, concurrently with the allocator. |
| **GC assist** | A throttling mechanism: goroutines that allocate fast are forced to help the GC mark, so allocation pressure does not outpace collection. |
| **`runtime.GC()`** | A function that triggers a full collection synchronously. Rarely needed. |
| **`debug.SetGCPercent`** | Runtime equivalent of `GOGC`. Returns the previous value. |
| **`debug.SetMemoryLimit`** | Runtime equivalent of `GOMEMLIMIT`. Returns the previous value. |
| **`runtime.MemStats`** | A struct populated by `runtime.ReadMemStats` containing detailed heap and GC counters. |
| **`GODEBUG=gctrace=1`** | Environment variable that prints one line per GC cycle to stderr. The simplest GC observability tool. |

---

## Core Concepts

### The two questions a GC has to answer

Every garbage collector ever built has to make two decisions:

1. **When** do I collect?
2. **How much** memory am I willing to use to delay the answer to question 1?

`GOGC` is Go's answer to question 1. `GOMEMLIMIT` is Go's answer to question 2.

If you understand only one sentence about this file, make it this one:

> `GOGC` controls **when** GC starts. `GOMEMLIMIT` controls **how high memory may rise** before GC is forced to start earlier.

Everything else follows from that sentence.

### What `GOGC=100` actually means

The default is `GOGC=100`. After every GC cycle, the runtime measures the **live heap** — bytes still reachable. It then computes a **heap goal**:

```
heap_goal = live_heap * (1 + GOGC/100)
```

With `GOGC=100`:

```
heap_goal = live_heap * 2
```

So if the GC finishes and finds 80 MB of live data, the next GC is scheduled to start when the heap grows to 160 MB. The runtime watches the heap as your goroutines allocate; when the heap crosses the goal, GC begins.

Setting `GOGC=50`:

```
heap_goal = live_heap * 1.5
```

Same 80 MB live → next GC at 120 MB. Smaller growth allowance → GC fires more often → less memory used, more CPU spent on GC.

Setting `GOGC=200`:

```
heap_goal = live_heap * 3
```

Same 80 MB live → next GC at 240 MB. Larger growth allowance → GC fires less often → more memory used, less CPU on GC.

### `GOGC=off` is real but almost always wrong

`GOGC=off` disables the garbage collector entirely. The heap grows forever until the OS kills the process. There are two legitimate uses:

1. **Short-lived CLI tools** that run, allocate, and exit so quickly that GC is pure overhead.
2. **Diagnosing** allocation rates — you want to see all the garbage without it being cleaned up.

For long-running services, `GOGC=off` is a recipe for OOM. Do not ship it.

### `GOMEMLIMIT`: the soft ceiling

`GOMEMLIMIT` was added in Go 1.19. It changes the rules. Instead of relying only on the `GOGC` growth ratio, the runtime now also looks at total memory used and pulls collections forward if you are getting too close to the limit.

```
GOMEMLIMIT=512MiB
```

Means: "keep total Go runtime memory under 512 MiB, even if that means running GC more aggressively than `GOGC` alone would suggest."

It is *soft* — it is a target, not a hard cap enforced by the runtime. If memory pressure is genuinely above the limit (every byte is live), GC will fire constantly trying to reclaim, your CPU will spike, but the limit can still be crossed. The runtime never freezes your program just to honour the limit; it would rather burn CPU.

In containers, `GOMEMLIMIT` is the difference between a graceful response (high CPU, slow requests, you scale up) and a sudden OOM kill (process gone, requests dropped, alerts fire).

### The combined model: `GOGC` chooses when, `GOMEMLIMIT` chooses the ceiling

After Go 1.19, the heap goal is the **minimum** of two values:

1. The `GOGC`-derived goal: `live * (1 + GOGC/100)`
2. The `GOMEMLIMIT`-derived goal: a function of the memory limit and current overhead

Whichever is lower wins. So:

- With `GOGC=100` and no `GOMEMLIMIT`: behaves like classic Go. Heap doubles, then GCs.
- With `GOGC=100` and `GOMEMLIMIT=512MiB`: usually behaves like the default — *until* the heap gets close to 512 MiB. Then GC fires earlier, trading CPU for memory.
- With `GOGC=off` and `GOMEMLIMIT=512MiB`: GC only runs when memory pressure says it must. This is the recommended pattern for "container-aware" tuning in some shops.

### GC in Go is mostly concurrent, with short pauses

Modern Go GC (since 1.8) marks objects **concurrently** with your program. Your goroutines keep running. There are still short stop-the-world pauses, but they are measured in tens to hundreds of microseconds in healthy programs, not milliseconds.

The basic phases:

1. **STW 1 (start):** ~10–100 µs. Enable the write barrier. Pick the root set.
2. **Concurrent mark:** runs alongside goroutines. Walks reachable objects. Goroutines that allocate may have to "assist."
3. **STW 2 (mark termination):** ~10–100 µs. Finalise marking.
4. **Concurrent sweep:** memory is reclaimed lazily as the allocator needs it.

The pause times you should expect for a healthy service are under 1 ms total per cycle. If you see pauses of tens of milliseconds, something is wrong (huge stack scan, big finalizer queue, OS pressure).

### Allocation rate is the real lever

You can tune `GOGC` and `GOMEMLIMIT` all day, but the underlying truth is this: **the less garbage you produce, the less GC you pay for.** Allocating fewer objects, allocating on the stack instead of the heap (escape analysis), and reusing objects with `sync.Pool` all reduce GC pressure. Tuning `GOGC` is the steering wheel; reducing allocations is the engine.

---

## Real-World Analogies

### `GOGC` is the trash-can size

You have a kitchen with a trash can. `GOGC=100` means "let the can fill up to twice its 'just-emptied' weight before you walk it out." `GOGC=50` means "walk it out when it gets to 1.5× the empty weight." `GOGC=200` means "let it pile up to 3× before you take it out." Less walking, bigger smell.

### `GOMEMLIMIT` is the fire-marshal

The kitchen has a fire-marshal who says "this room can hold at most 512 lbs of trash, no matter what." If you ignore the regular schedule and let trash pile up, the marshal forces you to take it out anyway. The marshal doesn't replace your normal routine — they override it when things get out of hand.

### Concurrent mark is a librarian counting books while patrons keep reading

The library never closes. The librarian walks the shelves while patrons borrow and return books. To avoid losing track, the librarian asks patrons to drop returned books in a special bin (the write barrier). Twice during the count, the librarian holds up a hand for one second — that is the STW pause — to take a consistent snapshot.

### GC assist is "you spilled it, you help mop"

If one customer is spilling drinks faster than the bartender can wipe them up, the bartender hands the customer a towel. In Go, a goroutine that allocates very fast is forced to help mark, so allocation rate can never outpace GC.

---

## Mental Models

### Model 1: heap as an accordion

The heap expands as you allocate and snaps shut when GC runs. `GOGC` controls how far you let it expand each cycle. `GOMEMLIMIT` is a wall behind it — the accordion cannot push past that point without forcing GC to fire.

### Model 2: two governors on the same engine

Imagine the GC as an engine with two governors:

- A **growth governor** (`GOGC`): kicks in when the heap has grown past a percentage of the last live size.
- A **ceiling governor** (`GOMEMLIMIT`): kicks in when total memory approaches a limit.

The runtime starts GC when **either** governor says "now." Tuning is about deciding which governor you want in control most of the time.

### Model 3: a credit and a debit

Allocations are a debit on memory. Collections are a credit. `GOGC` decides how big the debt is allowed to get before you pay. `GOMEMLIMIT` decides the credit limit on the card.

### Model 4: the three regimes

Most Go services live in one of three regimes:

1. **CPU-bound, plenty of memory:** raise `GOGC` (200, 500, even higher), no `GOMEMLIMIT`. Pay memory, save CPU.
2. **Memory-bound, plenty of CPU:** lower `GOGC` (50, 25), no `GOMEMLIMIT`. Pay CPU, save memory.
3. **Container with a hard limit:** set `GOMEMLIMIT` to about 90% of the cgroup limit, leave `GOGC` at default or set very high. The runtime self-tunes.

If you remember one operational recipe, remember regime 3.

---

## Pros & Cons

### Pros of having these knobs

- **No code change required.** Tune by environment variable across deploys.
- **Containment.** `GOMEMLIMIT` keeps the runtime inside a memory budget that maps directly to your container's limit.
- **Two axes of control.** Time (`GOGC`) and space (`GOMEMLIMIT`) are independent. You can optimise either.
- **Observability built in.** `gctrace=1` and `runtime.MemStats` make it cheap to see what is happening.

### Cons / limits

- **They do not change allocation rate.** No amount of `GOGC` tuning will save you from a function that allocates 200 MB on every request.
- **`GOMEMLIMIT` is a target, not a hard cap.** If live data exceeds the limit, you still OOM.
- **Setting them wrong is worse than not setting them.** A misconfigured `GOMEMLIMIT` can cause GC death spirals — high CPU, no progress.
- **Only two knobs.** You cannot tune the young/old generations or change the algorithm. Go does not expose that.

---

## Use Cases

### When to leave the defaults alone

Most short-running CLIs, batch jobs, simple HTTP servers, and developer-machine tools. The default `GOGC=100` and no `GOMEMLIMIT` are fine.

### When to set `GOMEMLIMIT`

Any Go program that:

- Runs in a Docker / Kubernetes container with a memory limit.
- Shares a host with other processes and must stay within a memory budget.
- Has shown OOM kills under load.

### When to raise `GOGC`

A program that:

- Has CPU as the bottleneck and a healthy memory headroom.
- Spends measurable time in GC (visible in `gctrace` or `runtime/pprof`).
- Has large, long-lived data structures that the GC repeatedly scans for nothing.

### When to lower `GOGC`

A program that:

- Has memory as the bottleneck and plenty of CPU headroom.
- Has short-lived allocations that quickly become garbage.
- You want to keep RSS lower without setting a strict ceiling.

### When (rarely) to disable GC

Short-lived processes that allocate and exit, like a build tool or a compiler. `GOGC=off` here saves the cost of a final GC that no user will ever see.

---

## Code Examples

### Example 1: setting `GOGC` from the environment

```sh
GOGC=200 go run main.go
```

That's the whole change. The compiler does nothing different; the runtime reads the variable at startup.

### Example 2: setting `GOMEMLIMIT`

```sh
GOMEMLIMIT=512MiB go run main.go
```

Accepted units: `B`, `KiB`, `MiB`, `GiB`, `TiB`. The plain `K`, `M`, `G` SI suffixes are also accepted but powers-of-two suffixes are clearer in container contexts.

### Example 3: setting both at runtime

```go
package main

import (
    "fmt"
    "runtime/debug"
)

func main() {
    prev := debug.SetGCPercent(50)
    fmt.Println("previous GOGC:", prev)

    prevLimit := debug.SetMemoryLimit(512 << 20) // 512 MiB
    fmt.Println("previous GOMEMLIMIT:", prevLimit)
}
```

`SetGCPercent` returns the previous value. `SetMemoryLimit` returns the previous limit (in bytes; `-1` means no limit was set before, but the return is the previous bytes value or `math.MaxInt64` for "unset").

### Example 4: reading current state via `MemStats`

```go
package main

import (
    "fmt"
    "runtime"
)

func main() {
    var m runtime.MemStats
    runtime.ReadMemStats(&m)
    fmt.Printf("HeapAlloc:  %d MiB\n", m.HeapAlloc>>20)
    fmt.Printf("HeapInuse:  %d MiB\n", m.HeapInuse>>20)
    fmt.Printf("Sys:        %d MiB\n", m.Sys>>20)
    fmt.Printf("NumGC:      %d\n", m.NumGC)
    fmt.Printf("LastGC:     %d ns ago\n", m.LastGC)
}
```

`ReadMemStats` is not free — it takes a brief STW snapshot. Don't put it in a hot loop. Once per second from a metrics goroutine is fine.

### Example 5: triggering a GC explicitly

```go
package main

import (
    "runtime"
)

func main() {
    bigAllocation()
    runtime.GC() // explicit collection
}

func bigAllocation() {
    _ = make([]byte, 100<<20) // 100 MiB
}
```

This call blocks until a complete GC cycle finishes. **You should almost never do this.** The only legitimate uses are tests and benchmarks that need a stable baseline.

### Example 6: reading `gctrace` output

Run any Go program with:

```sh
GODEBUG=gctrace=1 go run main.go
```

You will see lines on stderr like:

```
gc 1 @0.012s 0%: 0.018+0.32+0.005 ms clock, 0.14+0.10/0.20/0.40+0.04 ms cpu, 4->4->1 MB, 5 MB goal, 0 MB stacks, 0 MB globals, 8 P
```

Junior-level reading:

- `gc 1` — first GC cycle.
- `@0.012s` — at 12 ms after program start.
- `0%` — GC consumed 0% of total CPU time so far.
- `4->4->1 MB` — heap was 4 MB at GC start, peaked at 4 MB, ended at 1 MB live.
- `5 MB goal` — the heap goal for the next GC.
- `8 P` — 8 processors active (matches `GOMAXPROCS`).

You don't need the full breakdown yet — the middle file dissects every field.

### Example 7: a container-friendly setup

```sh
# Container has 1 GiB memory limit
GOMEMLIMIT=900MiB GOGC=100 ./myapp
```

The 100 MiB headroom accounts for off-heap memory (goroutine stacks, runtime tables, cgo) that `GOMEMLIMIT` does not strictly control.

---

## Coding Patterns

### Pattern: read environment, expose runtime knobs

If you write a long-running service, give operators the option to override at runtime via a config endpoint:

```go
package main

import (
    "fmt"
    "net/http"
    "runtime/debug"
    "strconv"
)

func handler(w http.ResponseWriter, r *http.Request) {
    if g := r.URL.Query().Get("gogc"); g != "" {
        n, err := strconv.Atoi(g)
        if err != nil {
            http.Error(w, "bad gogc", http.StatusBadRequest)
            return
        }
        prev := debug.SetGCPercent(n)
        fmt.Fprintf(w, "GOGC: %d -> %d\n", prev, n)
    }
}
```

Lets you tune live without redeploying.

### Pattern: log `MemStats` periodically

```go
package main

import (
    "log"
    "runtime"
    "time"
)

func memReporter() {
    var m runtime.MemStats
    for range time.Tick(10 * time.Second) {
        runtime.ReadMemStats(&m)
        log.Printf("heap=%dMiB sys=%dMiB ngc=%d pause=%dus",
            m.HeapAlloc>>20, m.Sys>>20, m.NumGC, m.PauseNs[(m.NumGC+255)%256]/1e3)
    }
}
```

A one-line summary every 10 seconds is enough to spot trends.

### Pattern: budget your allocations before tuning

Before reaching for `GOGC`, ask: "can I avoid this allocation?" The answer is usually yes. `sync.Pool`, byte-slice reuse, and stack allocation (via simple, non-escaping functions) are cheaper than tweaking the collector.

---

## Clean Code

- **Do not hardcode `GOGC` or `GOMEMLIMIT` in source.** Use environment variables. Hardcoding makes the binary inflexible.
- **Document your defaults.** If your service expects `GOMEMLIMIT=80%`, write it in the README. The next operator should not have to guess.
- **Wrap `runtime.GC()` calls with comments.** If you really do need a manual GC, leave a comment explaining why so the next reader knows it's intentional.
- **Don't sprinkle `runtime.ReadMemStats` calls.** Keep it in one place — a metrics goroutine — so the cost is bounded.

---

## Product Use / Feature

### A real product flow: tuning a JSON-heavy API

You have an HTTP service that deserialises 20 KB JSON payloads and returns processed results. Under load it allocates 200 MB/s. GC fires every 200 ms with the default `GOGC=100`, eating 8% of CPU. P99 latency is 80 ms; you want 30 ms.

Options:

1. **Reduce allocations:** swap `encoding/json` for a streaming decoder, reuse buffers via `sync.Pool`. The biggest win is here.
2. **Raise `GOGC` to 200 or 500:** GC fires half as often. CPU spent in GC drops. But peak heap doubles.
3. **Set `GOMEMLIMIT`** to ensure the heap growth from (2) does not crash the container.

Together: less garbage, fewer GCs, hard ceiling. Tail latency drops because GC stops being the dominant pause source.

### A real product flow: a 256 MB memory container

You package your Go service in a Kubernetes pod with `limits.memory: 256Mi`. Without `GOMEMLIMIT`, the runtime happily lets the heap grow past 256 MB and the kernel OOM-kills the container. With `GOMEMLIMIT=220MiB`, the runtime collects more aggressively as memory rises and stays within budget. Restart count drops to zero.

---

## Error Handling

GC tuning does not produce explicit errors. You do not get an exception for "GOGC too low." But errors *do* surface from misconfiguration:

- **OOM kills**: visible in `dmesg` or container exit code 137. Caused by `GOMEMLIMIT` too high relative to the cgroup limit, or no `GOMEMLIMIT` at all.
- **Latency spikes**: visible as long pauses in `gctrace`. Caused by `GOGC=off` followed by a catch-up GC, or `GOMEMLIMIT` set so low the runtime is constantly collecting.
- **CPU saturation in GC**: `gctrace` shows GC consuming a large percentage of CPU. Caused by allocation rate outpacing collection capacity (the GC "death spiral").

Whenever a Go service has unexplained latency or memory issues, run with `GODEBUG=gctrace=1` first. It usually tells you immediately whether GC is involved.

---

## Security Considerations

GC tuning has limited security implications, but a few are worth knowing:

- **`GOMEMLIMIT` as a DoS shield.** Setting a sane `GOMEMLIMIT` limits how much memory a malicious caller can force you to allocate before the runtime pushes back via GC pressure. It is not a substitute for input validation, but it raises the floor.
- **`GOGC=off` is a denial-of-service vector.** A process with no GC can be made to consume all available memory by any caller who can trigger allocations. Never ship a public-facing service with `GOGC=off`.
- **Timing side channels.** Long GC pauses can leak information about allocation patterns. This is rarely exploited in practice, but if you are building a cryptographic service, be aware that GC pauses are observable.

---

## Performance Tips

- **Measure before tuning.** Set `GODEBUG=gctrace=1` first. Understand current behaviour. Don't guess.
- **Allocation reduction first, tuning second.** A 50% drop in allocation rate is worth more than any `GOGC` change.
- **Use `sync.Pool` for reusable buffers.** It reduces pressure on the GC without leaking memory.
- **Set `GOMEMLIMIT` in containers.** Always. Set it to ~90% of the container's hard memory limit.
- **Don't call `runtime.GC()` in production hot paths.** It blocks. It defeats the concurrent collector.
- **For batch jobs, consider `GOGC=200` or higher.** They run to completion; memory headroom is cheap.
- **For latency-critical servers, watch GC pauses, not GC frequency.** A small frequent GC may be better than a rare giant one.

---

## Best Practices

1. Leave the defaults until you have a measurement that says they are wrong.
2. In containers, set `GOMEMLIMIT` to ~90% of the memory limit.
3. Use environment variables — `GOGC` and `GOMEMLIMIT` — not source-code constants.
4. Run with `GODEBUG=gctrace=1` in staging to understand normal behaviour.
5. Use `pprof` to confirm GC is actually your bottleneck before tuning.
6. Document any non-default `GOGC`/`GOMEMLIMIT` in your repo's README.
7. Reduce allocations before tweaking the collector.
8. Reserve `runtime.GC()` for tests and benchmarks.
9. Don't mix `GOGC=off` and any non-trivial workload.
10. Recheck tuning after every Go version upgrade; GC behaviour evolves.

---

## Edge Cases & Pitfalls

### Pitfall 1: `GOMEMLIMIT` set higher than the cgroup limit

```sh
# Container has 512 MiB cgroup limit
GOMEMLIMIT=1GiB ./myapp   # WRONG
```

Go thinks it has 1 GiB. The kernel will OOM-kill at 512 MiB. The runtime cannot respect a limit it doesn't know about.

### Pitfall 2: `GOMEMLIMIT` set too low

```sh
GOMEMLIMIT=64MiB ./myapp
```

If live data is genuinely larger than 64 MiB, the runtime will GC constantly trying to keep below the limit. CPU spikes, throughput tanks, and you may *still* OOM if the limit is below the working set. Set the limit above the realistic live working set, not below.

### Pitfall 3: forgetting that `GOMEMLIMIT` is soft

`GOMEMLIMIT=512MiB` does not prevent the process from using 600 MiB. It only encourages GC to collect harder. If the working set genuinely needs 600 MiB, you'll see both high CPU and high memory.

### Pitfall 4: stack growth is not counted

`GOMEMLIMIT` accounts for the heap and runtime overhead. Goroutine stacks count, but cgo-allocated memory does not. A program that pulls in big C libraries needs a wider gap between `GOMEMLIMIT` and the cgroup limit.

### Pitfall 5: setting `GOGC` and `GOMEMLIMIT` together without thinking

If `GOMEMLIMIT` is doing the work, `GOGC` value matters less. A common pattern is `GOGC=off` plus a strict `GOMEMLIMIT` — meaning "GC only when memory pressure forces it." But this only works if your allocation pattern can tolerate the burstiness.

### Pitfall 6: `runtime.GC()` in a hot path

A library author thinks "I'll call `runtime.GC()` after each request to be tidy." Every request now blocks on a full collection. Throughput collapses. **Almost never call `runtime.GC()` in production code.**

### Pitfall 7: confusing `HeapAlloc` and `Sys`

`HeapAlloc` is the bytes used by reachable heap objects right now. `Sys` is the total memory mapped by the runtime from the OS, which includes freed-but-not-returned memory. RSS as the OS sees it is closer to `Sys`. Beginners often look at `HeapAlloc` and miss why the process is using so much.

---

## Common Mistakes

1. **Calling `runtime.GC()` to "fix" memory issues.** It just hides them. Find the leak.
2. **Setting `GOGC=10` to "be safe."** You will spend 50% of CPU in GC for no benefit.
3. **Treating `GOMEMLIMIT` as a hard cap.** It is a soft target.
4. **Not setting `GOMEMLIMIT` in containers.** Leads to OOM kills under load.
5. **Forgetting `GOMEMLIMIT` exists.** It was added in Go 1.19; older tutorials don't mention it.
6. **Hardcoding tuning in source.** Use environment variables.
7. **Tuning without measuring.** Guessing `GOGC=200` because someone on the internet said so.
8. **Ignoring allocation rate.** No tuning fixes a leaky function.
9. **Reading `MemStats` in a hot loop.** It has a STW cost.
10. **Believing GC pauses are big.** Modern Go GC pauses are sub-millisecond in healthy code.

---

## Common Misconceptions

### "Go has a generational GC."

No. Go uses a non-generational, concurrent, tri-colour mark-and-sweep GC. There is no young/old generation. The team has explored generational GC and concluded it does not pay off given Go's allocation patterns.

### "`GOGC=200` doubles the heap forever."

No. `GOGC=200` lets the heap grow to 3× the live size *between* GCs. After each GC, the live size resets the calculation. The heap does not grow without bound.

### "Disabling GC makes my program faster."

For sub-second CLIs, sometimes. For services, never — they OOM before the speedup matters.

### "`GOMEMLIMIT` replaces `GOGC`."

No. They cooperate. `GOMEMLIMIT` pulls collections forward when memory rises; `GOGC` still drives the steady-state pace.

### "GC pauses are the main GC cost."

In modern Go, no. The bigger cost is **CPU spent in concurrent mark and assist** — your goroutines slow down because they share cycles with the collector.

### "I need to call `runtime.GC()` before benchmarking."

For some benchmarks, yes — to start from a known clean state. For your application code, no.

### "Setting `GOGC=off` and a tight `GOMEMLIMIT` is a clever trick."

It can be — for some workloads it actually works well. But "clever" is rarely the right word for production tuning. Document it heavily if you do it.

---

## Tricky Points

### Trick 1: the heap goal can be below the live size

If `GOMEMLIMIT` is tight, the runtime may compute a goal lower than the current live heap. In that case GC is essentially always running. You'll see this in `gctrace` as 100%-style GC CPU. The fix is more memory, not more tuning.

### Trick 2: `debug.SetMemoryLimit(-1)` removes the limit

To check or remove the limit programmatically, `-1` is the sentinel.

```go
prev := debug.SetMemoryLimit(-1)
fmt.Println("previous limit:", prev)
```

### Trick 3: `debug.SetGCPercent(-1)` disables GC

The negative value is how you disable GC at runtime (equivalent to `GOGC=off`).

### Trick 4: GOMEMLIMIT applies to `runtime.MemStats.Sys`, not RSS

The Go runtime tracks bytes obtained from the OS. RSS may be higher (memory not yet returned) or lower (memory paged out). The limit is on the runtime's view, not on what `ps` shows.

### Trick 5: `gctrace` writes to stderr at every cycle

If you capture stderr to a file and run a high-throughput service, you can fill the disk. Use `gctrace=1` for debugging, not as a default in production. For ongoing observability, use `MemStats` or `runtime/metrics`.

### Trick 6: the runtime free-runs at startup

The first few GC cycles after process start use a default growth ratio because there's no live-size measurement yet. Tuning numbers stabilise after the heap reaches steady state.

### Trick 7: cgo allocations are invisible to GC

Memory allocated by C code is not tracked. `GOMEMLIMIT` does not control it. Programs heavy in cgo need explicit accounting.

---

## Test

A sanity test: write a short program that allocates a lot of garbage, then check that GC behaviour changes when you flip `GOGC`.

```go
package main

import (
    "fmt"
    "runtime"
    "time"
)

func churn() {
    for i := 0; i < 50; i++ {
        _ = make([]byte, 1<<20) // 1 MiB
    }
}

func main() {
    start := time.Now()
    var before, after runtime.MemStats
    runtime.ReadMemStats(&before)
    churn()
    runtime.ReadMemStats(&after)

    fmt.Printf("GC cycles during churn: %d\n", after.NumGC-before.NumGC)
    fmt.Printf("elapsed: %v\n", time.Since(start))
}
```

Run it three ways:

```sh
go run main.go
GOGC=50 go run main.go
GOGC=200 go run main.go
```

You should see more GC cycles at `GOGC=50` and fewer at `GOGC=200`. That confirms your mental model.

---

## Tricky Questions

1. **What does `GOGC=100` mean in plain English?**
   Run GC when the heap has grown by 100% since the last collection — i.e., doubled.

2. **What is the unit of `GOMEMLIMIT`?**
   Bytes, with optional suffixes (`B`, `KiB`, `MiB`, `GiB`, `TiB`). Powers of two, not powers of ten.

3. **Why is `GOMEMLIMIT` called a "soft" limit?**
   Because the runtime never freezes or refuses allocations to honour it. It only adjusts GC aggressiveness. If live data exceeds the limit, you still OOM.

4. **What happens if you set `GOGC=off` in a long-running server?**
   Memory grows unbounded until the OS kills the process.

5. **Is `runtime.GC()` ever appropriate?**
   Yes, in tests, benchmarks, or after a known one-off load (e.g., reading a giant config file). Not in steady-state production code.

6. **Why might tuning `GOGC` make no difference?**
   Because the bottleneck is allocation rate, not GC frequency. No tuning of when-to-collect helps if you allocate too much.

7. **Can `GOMEMLIMIT` cause CPU spikes?**
   Yes. If the limit is below the live working set, GC fires constantly trying to free memory that is genuinely needed — the "GC death spiral."

8. **What is GC assist?**
   The mechanism that forces fast-allocating goroutines to do some marking work themselves, so allocation never outpaces collection.

9. **What does `4->4->1 MB` in `gctrace` mean?**
   Heap was 4 MB at start of GC, 4 MB at end of mark, 1 MB live at end of cycle.

10. **What is the practical recommendation for a Go service in a 1 GiB container?**
    `GOMEMLIMIT=900MiB`. Default `GOGC`. Adjust only after measurement.

---

## Cheat Sheet

```
DEFAULTS
  GOGC          = 100        # double the heap before GC
  GOMEMLIMIT    = unset      # no ceiling

DISABLE
  GOGC=off                   # disable GC (don't, except CLIs)
  GOMEMLIMIT=-1              # remove limit (programmatic)

UNITS for GOMEMLIMIT
  B, KiB, MiB, GiB, TiB      # powers of 2
  K, M, G, T                 # powers of 10

RUNTIME EQUIVALENTS
  debug.SetGCPercent(n)      # n == GOGC value; -1 disables
  debug.SetMemoryLimit(n)    # n == bytes; math.MaxInt64 == unset
  runtime.GC()               # force a synchronous GC

OBSERVABILITY
  GODEBUG=gctrace=1          # one line per GC on stderr
  runtime.ReadMemStats(&m)   # detailed counters

CONTAINER RECIPE
  GOMEMLIMIT = 0.9 * cgroup_limit
  GOGC       = default (100)

THROUGHPUT RECIPE
  GOGC = 200..500
  GOMEMLIMIT unset

LATENCY RECIPE
  GOGC = default
  GOMEMLIMIT = tight, but above working set

EMERGENCY: GC DEATH SPIRAL
  symptom: 100% CPU, no progress
  cause:   GOMEMLIMIT below working set
  fix:     raise GOMEMLIMIT or reduce live data
```

---

## Self-Assessment Checklist

- [ ] I can explain what `GOGC=100` means without looking it up.
- [ ] I can write a one-liner `GOMEMLIMIT=512MiB` and understand the units.
- [ ] I know the three runtime functions: `SetGCPercent`, `SetMemoryLimit`, `GC`.
- [ ] I can read a `gctrace` line and identify start heap, end live, and goal.
- [ ] I know when *not* to call `runtime.GC()`.
- [ ] I can recite the container-tuning rule: `GOMEMLIMIT ≈ 0.9 × cgroup limit`.
- [ ] I know that `GOMEMLIMIT` is soft, not hard.
- [ ] I can explain why `GOGC=off` is dangerous for long-running services.
- [ ] I understand that reducing allocations beats tuning the collector.
- [ ] I know how to set both via environment variables and via runtime calls.

---

## Summary

`GOGC` and `GOMEMLIMIT` are Go's only GC tuning knobs, and they cover almost every real situation. `GOGC` is a percentage that decides how much the heap may grow before the next collection — default `100` means "double it." `GOMEMLIMIT` is a soft memory ceiling that pulls collections forward as memory approaches the limit. The two cooperate: whichever produces the earlier goal wins.

Modern Go GC is concurrent: marking happens while your goroutines run, with brief stop-the-world phases (sub-millisecond in healthy programs). High-allocation goroutines pay for their own pressure through GC assist. The biggest performance lever is not the tuning knobs but the allocation rate itself; reducing garbage produced is always cheaper than tuning when to collect.

In production, the most common useful tuning is to set `GOMEMLIMIT` to around 90% of a container's memory limit and otherwise leave defaults alone. Touch `GOGC` only when measurements show GC is the bottleneck. Never call `runtime.GC()` in a hot path. Always run `GODEBUG=gctrace=1` once in staging to see what your service does under load.

---

## What You Can Build

After this file you can:

- Configure any Go service to fit a container's memory budget.
- Diagnose a Go service that OOM-kills under load.
- Tune a Go batch job for maximum throughput on a machine with plenty of RAM.
- Read a `gctrace` log and explain it to a teammate.
- Write a metrics goroutine that reports heap and GC counters.
- Build a small admin endpoint that lets operators change `GOGC` at runtime.

---

## Further Reading

- The Go runtime documentation: `https://pkg.go.dev/runtime` and `https://pkg.go.dev/runtime/debug`
- The Go diagnostics guide: `https://go.dev/doc/diagnostics`
- The Go memory model section of the spec: `https://go.dev/ref/mem`
- The `runtime/metrics` package introduction (Go 1.16+)
- The Go 1.19 release notes — section on `GOMEMLIMIT`

---

## Related Topics

- `GOMAXPROCS` — sibling tuning knob for the scheduler
- `sync.Pool` — the standard way to reduce GC pressure
- Profiling with `pprof` — to identify whether GC is your real bottleneck
- Escape analysis — when allocations move from stack to heap
- Goroutine stacks — separate from the heap, contribute to `Sys`

---

## Diagrams & Visual Aids

### The heap-goal cycle

```
live_heap = 80 MiB        (after GC)
heap_goal = 80 * (1 + GOGC/100)
          = 160 MiB        (GOGC=100)

allocations push heap up:
80 -> 100 -> 120 -> 140 -> 160  trigger GC
                                  GC runs
                                  live -> 90 MiB
heap_goal = 90 * 2 = 180 MiB    next cycle
```

### `GOGC` vs `GOMEMLIMIT` combined

```
                     heap usage over time

     mem
      |
limit |---------- GOMEMLIMIT ----------
      |
      |   /\        /\         /\
goal2 |--/--\------/--\-------/--\---  (limit-derived)
      | /    \    /    \     /    \
goal1 |/------\--/------\---/------\-  (GOGC-derived)
      |        \/        \-/        \-
      +-----------------------------> time

   actual GC trigger = MIN(goal1, goal2)
```

### A `gctrace` line, annotated

```
gc 12 @1.234s 2%: 0.05+0.41+0.01 ms clock, ...
 |    |       |       |
 |    |       |       \-- STW1 + concurrent mark + STW2 wall-clock
 |    |       \-- GC CPU as % of total since start
 |    \-- seconds since program start
 \-- GC cycle number
```

### Allocation rate, GC frequency, memory

```
allocation -> heap rises -> hits goal -> GC -> live measured
                                         ^                |
                                         |________________| new goal
```

### Container tuning recipe

```
   cgroup limit: 1024 MiB
                 \
                  *  GOMEMLIMIT = 900 MiB (90%)
                  *  GOGC       = 100 (default)
                  *  headroom    = 124 MiB for stacks, cgo, runtime overhead
```

### The four phases of a GC cycle

```
   |--STW1--|------- concurrent mark -------|--STW2--|--- concurrent sweep ---|
       ~10-50us           tens to hundreds      ~10-100us       lazy
                          of ms (overlaps                       (no perceived
                          with goroutines)                       cost)

  start:  sweep terminate, enable write barrier
  mark:   walk reachable objects from roots; goroutines run; assists possible
  STW2:   mark termination, snapshot
  sweep:  pages freed back to allocator as needed
```

### Decision tree: which knob do I touch?

```
                  do I run in a container with a memory limit?
                            /                       \
                          yes                        no
                          /                          \
              set GOMEMLIMIT = 0.9 *           is allocation rate
                cgroup limit                  causing GC > 15% CPU?
                          \                          /        \
                           \                       yes          no
                            \                      /             \
                             check tail            raise         leave
                             latency               GOGC          defaults
                                                  (200..500)
```

### Memory accounting (what `Sys` includes)

```
   Sys = HeapSys + StackSys + MSpanSys + MCacheSys + GCSys + OtherSys + BuckHashSys
          |          |          |          |          |       |          |
          heap       goroutine  span       per-P      GC      misc       profiling
          pages      stacks     bookkeep.  caches     metadata           buckets
```

`HeapAlloc` is a strict subset: bytes in live objects inside `HeapInuse`. It is *not* equal to RSS, and dashboards that confuse them tell lies under load.

### `GOMEMLIMIT` in a Kubernetes pod (yaml)

```
spec:
  containers:
    - name: app
      image: my-app:1.0
      resources:
        limits:
          memory: "1Gi"
      env:
        - name: GOMEMLIMIT
          value: "900MiB"
        - name: GOGC
          value: "100"
```

This pattern is the single most common production tuning. Memorise it.

### Cycle-by-cycle progression with `GOGC=100`

```
   cycle  live (MiB)   goal (MiB)   trigger (MiB)
   1      10           20           ~18
   2      12           24           ~22
   3      11           22           ~20
   4      40           80           ~75    (workload grew)
   5      45           90           ~85
   ...
```

The runtime adjusts cycle to cycle based on the measured live size. The pacer aims for mark to finish near `goal`, not exactly at it.
