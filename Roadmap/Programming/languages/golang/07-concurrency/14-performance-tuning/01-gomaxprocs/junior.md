# `GOMAXPROCS` Performance Tuning — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [What This File Is and Is Not](#what-this-file-is-and-is-not)
3. [The Performance Mental Model in One Page](#the-performance-mental-model-in-one-page)
4. [Throughput vs Latency — Two Different Curves](#throughput-vs-latency--two-different-curves)
5. [Your First Sweep — One Hour, One Command](#your-first-sweep--one-hour-one-command)
6. [Reading the Throughput Curve](#reading-the-throughput-curve)
7. [Reading the Latency Curve](#reading-the-latency-curve)
8. [`GOMAXPROCS=1` vs Cores — The Canonical Demo](#gomaxprocs1-vs-cores--the-canonical-demo)
9. [Why CPU-Bound Code Peaks at `NumCPU`](#why-cpu-bound-code-peaks-at-numcpu)
10. [Why I/O-Bound Code *Also* Peaks at `NumCPU`](#why-iobound-code-also-peaks-at-numcpu)
11. [The Netpoller in Two Paragraphs](#the-netpoller-in-two-paragraphs)
12. [The Cost of Going Too High](#the-cost-of-going-too-high)
13. [The Cost of Going Too Low](#the-cost-of-going-too-low)
14. [Containers — The One Place Defaults Used to Lie](#containers--the-one-place-defaults-used-to-lie)
15. [`automaxprocs` in One Page](#automaxprocs-in-one-page)
16. [Logging `GOMAXPROCS` at Startup](#logging-gomaxprocs-at-startup)
17. [A Tiny Web Service to Practise On](#a-tiny-web-service-to-practise-on)
18. [Driving Load With `wrk` and `hey`](#driving-load-with-wrk-and-hey)
19. [Recording Numbers You Will Actually Trust](#recording-numbers-you-will-actually-trust)
20. [Why You Should Not Tune On Your Laptop Alone](#why-you-should-not-tune-on-your-laptop-alone)
21. [When `GOMAXPROCS < NumCPU` Is Correct](#when-gomaxprocs--numcpu-is-correct)
22. [When `GOMAXPROCS > NumCPU` Is Almost Never Correct](#when-gomaxprocs--numcpu-is-almost-never-correct)
23. [Per-Tenant `GOMAXPROCS` Is Not a Thing](#per-tenant-gomaxprocs-is-not-a-thing)
24. [How Production Engineers Actually Set It](#how-production-engineers-actually-set-it)
25. [The Mental Checklist Before Touching It](#the-mental-checklist-before-touching-it)
26. [Common Junior Mistakes](#common-junior-mistakes)
27. [Cross-References to the Internals](#cross-references-to-the-internals)
28. [Self-Assessment](#self-assessment)
29. [Summary](#summary)

---

## Introduction

This is the junior-level guide to **performance tuning** of `GOMAXPROCS`. It is the natural sequel to the scheduler-internals chapter at `10-scheduler-deep-dive/03-gomaxprocs-tuning/junior.md`, which covered the *what* and *how* of the knob. This file covers the *why* — specifically, why the default is almost always the right answer for performance, what happens to throughput and latency curves when you deviate from it, and how to convince yourself with numbers rather than blog-post folklore.

A new Go engineer is exposed to `GOMAXPROCS` in three contexts, more or less in this order. The first is when someone on the team mentions a Kubernetes incident in which a service was running with the host's CPU count instead of the pod's quota; the second is when a colleague suggests "let's try bumping `GOMAXPROCS`" as a fix for slow performance; the third is when an interviewer asks "what does `GOMAXPROCS` control and when would you change it?". This file aims to make you competent in all three.

The promise: by the end of this page you will be able to run a `GOMAXPROCS` sweep on a service of your choice, read the throughput and latency curves it produces, and explain to a peer why the curve looks the way it does. You will not yet be qualified to write the fleet-wide policy that governs `GOMAXPROCS` across hundreds of services — that arrives at senior level — but you will have the measurement habit that all the higher-level decisions depend on.

A warning, in line with the scheduler-internals page: do not change `GOMAXPROCS` based on this guide alone. Change it based on measurement. This guide tells you *how to measure*. It is not a license to add `runtime.GOMAXPROCS(8)` to your `main()` because a tutorial told you to.

---

## What This File Is and Is Not

This file is **about performance**. It assumes you already know:

- What `GOMAXPROCS` is — the cap on parallel execution of Go user code.
- That the default has been `NumCPU()` since Go 1.5.
- That `runtime.GOMAXPROCS(0)` reads the current value.
- That the value can be set via the `GOMAXPROCS` environment variable.

If any of those are new, read `the scheduler-internals junior.md` first; it is the prerequisite for this page.

This file is **not** going to re-explain G-M-P, `procresize()`, or how cgroup files are parsed. Those are internals. Here we treat the runtime as a black box with a single knob and ask: how do we measure the effect of that knob on the metric our service cares about?

This file is **also not** a substitute for profiling. `GOMAXPROCS` is one of several runtime knobs (alongside `GOGC`, `GOMEMLIMIT`, and a handful of `GODEBUG` flags), and on most well-written services it is not even the most important. If your service is slow because it allocates 200 MB/s, no `GOMAXPROCS` value will save you. We will come back to this when we look at sweep results that show no change at all.

---

## The Performance Mental Model in One Page

Hold this model in your head while reading the rest of the file.

A Go service has, at any moment, some number of **runnable goroutines** waiting for CPU. The runtime keeps `GOMAXPROCS` slots — the `P` structs — in which goroutines can actually execute. The runtime scheduler moves goroutines between slots, parks them when they block on I/O or channels, and wakes them when their dependencies become ready.

There are two distinct ways `GOMAXPROCS` affects performance.

**1. The parallelism ceiling.** No matter how many goroutines you create, at most `GOMAXPROCS` of them are running user-mode Go code at the same instant. If your work is CPU-bound and you have 16 cores but `GOMAXPROCS=4`, you have left 12 cores idle. Throughput cannot exceed 4× single-core throughput.

**2. The scheduling overhead.** The scheduler is not free. Every `P` runs a runqueue, periodically steals from siblings, occasionally spins to find work. The cost per `P` is small but non-zero. With 128 `P`s on a machine where 4 cores are actually available, you pay scheduling overhead for 124 idle `P`s. Worse, those `P`s spin briefly when looking for work, contending for memory bandwidth and cache lines.

The optimal `GOMAXPROCS` for performance is the value that **maxes out usable parallelism** without **paying for parallelism you cannot use**. On a 16-core box with no cgroup limits, that is 16. In a pod with `cpu: 2`, that is 2. The default after Go 1.18 picks this for you — most of the time.

Everything in this file is a corollary of that single observation. The interesting cases — NUMA, I/O-bound services, co-tenancy — are explained as deviations from this baseline.

---

## Throughput vs Latency — Two Different Curves

When you sweep `GOMAXPROCS` against a workload, you get two curves, not one. Both matter, and they almost never peak at the same place.

**Throughput** (requests per second, jobs per minute) typically rises until `GOMAXPROCS = effective core count` and then plateaus, often with a slight regression beyond. The shape is roughly:

```
RPS
 |
 |              ___________
 |           __/           \___
 |        __/                  \____
 |     __/
 |   _/
 |  /
 +-----------------------------------> GOMAXPROCS
 1  2  4  8  16 32 64 128
```

**Latency** under load is more complex. At low `GOMAXPROCS`, latency rises because goroutines queue. At medium `GOMAXPROCS`, latency falls because everyone gets a slot. At high `GOMAXPROCS`, latency can rise again because the scheduler does more cross-P work and because the netpoller's wake-up sequence touches more `P`s.

The two curves diverge most sharply on **mixed CPU+I/O workloads**: throughput might prefer `NumCPU+1` (the extra `P` covers one always-blocked thread), but latency under high concurrency prefers `NumCPU` exactly (less contention on wake-up). For tail latency (p99) the gap is wider still.

When tuning, always plot both. Picking a value that maximises throughput while regressing p99 is almost never what you want for a user-facing service.

---

## Your First Sweep — One Hour, One Command

The point of this section is to get you running a real sweep before the theory. Save this file as `cpu_server.go`:

```go
package main

import (
    "crypto/sha256"
    "log"
    "net/http"
    "runtime"
)

func handler(w http.ResponseWriter, r *http.Request) {
    h := sha256.New()
    buf := make([]byte, 4096)
    for i := 0; i < 64; i++ {
        h.Write(buf)
    }
    _, _ = w.Write(h.Sum(nil))
}

func main() {
    log.Printf("startup: GOMAXPROCS=%d NumCPU=%d",
        runtime.GOMAXPROCS(0), runtime.NumCPU())
    http.HandleFunc("/", handler)
    log.Fatal(http.ListenAndServe(":8080", nil))
}
```

Install [`wrk`](https://github.com/wg/wrk) — a small HTTP load generator. Run a sweep:

```bash
for n in 1 2 4 8 16; do
    GOMAXPROCS=$n ./cpu_server &
    pid=$!
    sleep 1
    echo "=== GOMAXPROCS=$n ==="
    wrk -t8 -c64 -d10s http://localhost:8080/
    kill "$pid"
    wait "$pid" 2>/dev/null
    sleep 1
done
```

You will see throughput climb from `GOMAXPROCS=1` to a peak around `GOMAXPROCS = NumCPU`, then plateau or regress slightly. This is the canonical CPU-bound shape, and you have just produced it without any theory. Congratulations — you are now ahead of every engineer who tunes by intuition.

---

## Reading the Throughput Curve

Now look at the numbers. A typical 8-core laptop produces something like:

| `GOMAXPROCS` | Requests/sec | Speedup vs `=1` |
|---|---|---|
| 1 | 12 000 | 1.00× |
| 2 | 23 500 | 1.96× |
| 4 | 45 200 | 3.77× |
| 8 | 78 100 | 6.51× |
| 16 | 76 400 | 6.37× |

Three observations:

1. **Speedup is sublinear.** Going from 1 to 8 cores delivered 6.5×, not 8×. The gap is Amdahl's law — some part of every request is single-threaded (allocator, garbage collector, runtime bookkeeping). On heavily allocating code, the gap is larger.
2. **Peak is at `NumCPU`.** Going from 8 to 16 lost 2% throughput. The extra `P`s gave nothing because there were no spare cores; they just added overhead.
3. **The curve is *flat*, not pointed.** This is important. Around the optimum, throughput is insensitive to `GOMAXPROCS`. A value of 7 or 9 would be nearly identical. The runtime is forgiving. You do not have to nail the value exactly.

Knowing that the curve is flat around the optimum is a load-bearing fact for production policy: it means slight over- or under-sizing is not catastrophic. Catastrophe lives at the extremes (`1` on a 16-core box, `128` in a pod with `cpu: 1`).

---

## Reading the Latency Curve

Now look at the p99 line that `wrk` also prints (or compute it from `--latency`). On the same 8-core laptop:

| `GOMAXPROCS` | p50 (ms) | p99 (ms) |
|---|---|---|
| 1 | 5.3 | 28.7 |
| 2 | 2.7 | 15.1 |
| 4 | 1.4 | 8.4 |
| 8 | 0.8 | 5.2 |
| 16 | 0.9 | 6.1 |

Two observations to add to the throughput ones:

1. **Latency drops faster than throughput rises** at low `GOMAXPROCS`. Doubling from 1 to 2 cut p99 in half, but throughput only doubled. The reason: queueing. With one `P`, requests pile up behind each other; with two, half of them no longer queue.
2. **Latency *rises* past the optimum**, even when throughput is flat. The extra `P`s cost p99 because they introduce more cross-P stealing and more spinning, which the runtime accounts for. The effect is small here (5.2 → 6.1) but on more spread-out hardware (NUMA, big core counts) it can be substantial.

Latency-sensitive services should treat the optimum more conservatively. If p99 plateaus at `GOMAXPROCS = 6` on an 8-core box, prefer 6 over 8 — you get the latency win at almost no throughput cost. The senior-level file goes into this in depth.

---

## `GOMAXPROCS=1` vs Cores — The Canonical Demo

The single most pedagogically useful sweep is just `GOMAXPROCS=1` vs `GOMAXPROCS=NumCPU` on a CPU-bound workload. It is the demo every Go engineer should run once.

Save this:

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
    "time"
)

func cpuWork(iters int) {
    x := 0
    for i := 0; i < iters; i++ {
        x ^= i*1103515245 + 12345
    }
    _ = x
}

func main() {
    fmt.Printf("GOMAXPROCS=%d NumCPU=%d\n",
        runtime.GOMAXPROCS(0), runtime.NumCPU())

    const goroutines = 16
    const work = 50_000_000

    start := time.Now()
    var wg sync.WaitGroup
    wg.Add(goroutines)
    for i := 0; i < goroutines; i++ {
        go func() {
            defer wg.Done()
            cpuWork(work)
        }()
    }
    wg.Wait()
    fmt.Printf("elapsed: %v\n", time.Since(start))
}
```

Run twice on an 8-core machine:

```bash
GOMAXPROCS=1 go run main.go
# elapsed: 4.2s

GOMAXPROCS=8 go run main.go
# elapsed: 0.6s
```

A ~7× speedup. Not 8× — Amdahl again — but a clean demonstration that the runtime is doing exactly what you would hope: actually running goroutines in parallel.

If you ever doubt that `GOMAXPROCS` does what it claims, run this. The result is so stark it ends arguments. Many engineers have built intuition for `GOMAXPROCS` on top of this one experiment.

---

## Why CPU-Bound Code Peaks at `NumCPU`

The reason is mechanical. Each `P` represents one slot in which a thread can execute user-mode Go. A CPU-bound goroutine, by definition, sits in a `P` until preempted. If you have 16 CPU-bound goroutines and 8 `P`s, only 8 are running at a time; the other 8 are queued.

Therefore the maximum useful `GOMAXPROCS` for a CPU-bound workload is the number of cores that can actually run the threads in parallel. On bare metal, that is `NumCPU()`. In a container, it is the cgroup quota (which `NumCPU()` returns on Go ≥ 1.18). Beyond that, extra `P`s simply do not have cores to run on; they end up time-slicing the same physical cores, which adds context-switch cost without adding throughput.

Why not exactly `2 × NumCPU` or `NumCPU + 1`? Because Go does not block in syscalls on user CPU work. A CPU-bound goroutine never frees its `P` for I/O. It releases only when preempted (every ~10 ms by the scheduler) or when it yields voluntarily. Extra `P`s are wasted for pure CPU work.

There is one subtle exception: garbage collection. The GC runs in parallel and steals CPU time from `P`s for its own work. On extremely allocation-heavy services, an extra `P` can help by giving GC headroom — but this is exotic, hard to measure, and dwarfed by GC tuning (`GOGC`, `GOMEMLIMIT`).

For 99% of CPU-bound services: `GOMAXPROCS = NumCPU()`.

---

## Why I/O-Bound Code *Also* Peaks at `NumCPU`

This trips up juniors. The intuition says "I/O code spends most of its time blocked, so I should use more `P`s to keep CPUs busy". The Go runtime makes this intuition wrong, and the reason is the **netpoller**.

In Go, an I/O-bound goroutine does not occupy a `P` while it waits for a socket. It calls into the runtime, which moves the goroutine off its `P`, parks it on the netpoller's wait list, and frees the `P` to run something else. When the netpoller sees the FD become ready, it puts the goroutine back on a runqueue.

This is fundamentally different from a thread-pool model (Java's classic NIO, Python's `concurrent.futures.ThreadPoolExecutor`), where an I/O-blocked thread really sits idle. In those models you size the thread pool to be larger than the core count because you expect many threads to be parked at any moment. In Go, parked goroutines do not occupy `P`s, so the core-count sizing is right even for heavy I/O workloads.

There is a corollary: setting `GOMAXPROCS > NumCPU` does not help I/O-bound code either. You can pack a million simultaneous HTTP connections into a Go service with `GOMAXPROCS = NumCPU` and the netpoller handles them all. The bottleneck becomes CPU (parsing, allocating, copying) — which is where `NumCPU` is the right answer.

---

## The Netpoller in Two Paragraphs

The netpoller is the runtime's epoll/kqueue/IOCP bridge. When a goroutine performs an operation on a `net.Conn`, `net.PacketConn`, or similar, the runtime sets the FD non-blocking and registers it with the OS poller. The goroutine is then parked. The runtime's poller thread (one `M` dedicated to it, separate from `P` accounting) waits on the OS poller and, when an FD becomes ready, wakes the parked goroutine by putting it onto a runqueue.

The consequence for `GOMAXPROCS` is enormous. The cost of an idle TCP connection in Go is roughly 4–8 KB of memory for the goroutine stack and a slot on the netpoller's wait list — no thread, no `P`. You can therefore support hundreds of thousands of connections on a single `P`, provided your CPU work per packet is small. This is why Go web servers routinely outperform Java thread-per-request servers on the same core count: the CPU is not multiplexed with idle threads.

For our `GOMAXPROCS` story, the takeaway is: **I/O does not need parallelism beyond cores**. Set `GOMAXPROCS = NumCPU` and trust the netpoller.

---

## The Cost of Going Too High

What does "too high `GOMAXPROCS`" cost, concretely?

1. **Cross-P stealing.** When a `P` runs out of work, it scans other `P`s' runqueues and steals half their goroutines. With more `P`s, each steal scans more memory and is less likely to find work, so spend more time spinning.
2. **Spin time.** A `P` that finds no work to steal will spin for a short window before parking, hoping new work appears. With many `P`s this spinning competes for memory bandwidth — relevant on NUMA boxes and dense servers.
3. **More garbage to collect.** Each `P` carries a per-`P` cache (mcache) for the allocator. More `P`s = more caches = more memory used and slightly more GC overhead.
4. **More OS threads.** Each `P` corresponds to at most one currently-running `M`. Idle `M`s are kept in a pool, but creating them is not free. Pathologically high `GOMAXPROCS` creates a swarm of `M`s.
5. **Higher tail latency under load.** The scheduler has more work units to balance. The cost is small per scheduling decision but adds up under high concurrency.

In numbers: on a 16-core box, raising `GOMAXPROCS` from 16 to 64 on a CPU-bound workload typically loses 2–10% throughput and 5–20% p99 latency. From 64 to 256 the loss is worse. The runtime is designed for `GOMAXPROCS = NumCPU`, and the further you deviate, the more rough edges you hit.

---

## The Cost of Going Too Low

What does "too low `GOMAXPROCS`" cost?

1. **Idle cores.** The most obvious cost: physical CPUs that could be doing work, sitting at 0% utilisation.
2. **Queueing latency.** With fewer `P`s, more goroutines wait their turn. Tail latency rises sharply once you have more runnable goroutines than `P`s — the classic queueing-theory behaviour.
3. **Throughput cap.** Throughput is bounded by `GOMAXPROCS × per-core throughput`. If your service can do 10 k req/s per core and you set `GOMAXPROCS=2` on an 8-core box, you cap throughput at 20 k req/s — a quarter of your hardware.
4. **CPU underutilisation reported as "saturation".** This is a fun one: monitoring will show CPU at, say, 25%, but the service still queues requests. Operators think "we have plenty of CPU" and miss the root cause.

The classic too-low scenario is a pre-1.16 service running in a Kubernetes pod with `cpu: 4` on a 64-core node. `runtime.NumCPU()` returned 64 (the node count), the operator added `runtime.GOMAXPROCS(2)` "to be safe", and the service ran at 1/32 of capacity in production. The right answer was 4.

---

## Containers — The One Place Defaults Used to Lie

The default `GOMAXPROCS = NumCPU()` is correct only if `NumCPU()` returns the **usable** core count. On bare metal, it does. In containers, before Go 1.18, it did not — `NumCPU()` returned the host's CPU count, not the container's quota.

The damage:

- A 64-core host running a pod with `cpu: 2` would default to `GOMAXPROCS = 64`. The runtime spun up 64 `P`s; the kernel throttled the process to 2 CPUs via CFS. The result: 62 idle `P`s spinning, requests queueing waiting for the two real cores, p99 latency 10× expected, CFS throttling visible in cAdvisor metrics.

Go 1.16 added cgroup v1 awareness; Go 1.18 added cgroup v2. From Go 1.18 onwards, on Linux, `NumCPU()` returns the cgroup-derived quota. The bug is largely solved for new services.

But: many services run older Go. Some run on platforms where cgroup detection does not work (some custom container runtimes, FreeBSD, Windows containers). For these, the community solution is the `automaxprocs` library.

The internals of cgroup parsing live in `the scheduler chapter's middle.md`. For tuning, the headline is: **on Go ≥ 1.18 Linux, the default is correct in containers; on older Go, use `automaxprocs`.**

---

## `automaxprocs` in One Page

`go.uber.org/automaxprocs` is a small library that, when imported with the blank identifier, runs an `init()` function which reads the cgroup CPU quota at startup and calls `runtime.GOMAXPROCS()` accordingly. It is the de-facto fix for pre-1.18 Go in containers, and still useful on Go 1.18+ for its logging and for environments where the runtime's detection is incomplete.

Usage is a single import:

```go
package main

import (
    _ "go.uber.org/automaxprocs"
    // ...
)

func main() {
    // GOMAXPROCS is already set by automaxprocs init.
}
```

On startup, the library prints a log line like:

```
2026/04/15 12:34:56 maxprocs: Updating GOMAXPROCS=2: determined from CPU quota of 2.00
```

If no cgroup quota exists, it does nothing. If you explicitly set `GOMAXPROCS` in the environment, it respects that (or, depending on version, warns).

The relationship with the Go runtime: `automaxprocs` runs *before* your `main()` because it is in an `init()`. The runtime has already set `GOMAXPROCS = NumCPU()` by then. `automaxprocs` overrides — a small STW happens (procresize), invisible to your code.

When do you still need it on Go 1.18+? Three cases:

1. **You want the log line.** The runtime does not log its choice; `automaxprocs` does. The log is the cheapest insurance against misconfiguration ever.
2. **You are on a Go version that has the cgroup bug fixed only partially.** Some early Go 1.18.x had quirks; the library smooths them out.
3. **You are on a non-Linux container runtime** where the Go runtime's detection does not apply.

Otherwise, on modern Go you can skip the library and rely on the runtime. Most teams keep it anyway because the cost is one import.

---

## Logging `GOMAXPROCS` at Startup

The single most important production hygiene measure for `GOMAXPROCS` is to log its resolved value at startup. The cost is one line of code. The benefit is that every incident report can answer "what was `GOMAXPROCS` set to?" without anyone having to log into the pod.

```go
package main

import (
    "log"
    "runtime"
)

func main() {
    log.Printf("startup: GOMAXPROCS=%d NumCPU=%d Version=%s",
        runtime.GOMAXPROCS(0), runtime.NumCPU(), runtime.Version())
    // ...
}
```

A more disciplined version emits this as both a log line and a metric (Prometheus gauge `process_gomaxprocs`). The metric is what alerts fire on. The log is what humans read after the alert wakes them up.

If you remember nothing else from this page: **log `GOMAXPROCS` at startup**. The number of production incidents caused by a value no one knew about is the largest single category I have personally seen.

---

## A Tiny Web Service to Practise On

To do meaningful tuning you need a service whose behaviour you understand. Here is one tuned to be a generic "moderately CPU + moderately I/O" stand-in.

```go
package main

import (
    "crypto/sha256"
    "encoding/hex"
    "io"
    "log"
    "net/http"
    "runtime"
    "time"
)

func handler(w http.ResponseWriter, r *http.Request) {
    // Simulated I/O wait (e.g. waiting on a downstream).
    time.Sleep(2 * time.Millisecond)

    // CPU work: hash some bytes.
    body, _ := io.ReadAll(io.LimitReader(r.Body, 4096))
    h := sha256.New()
    for i := 0; i < 32; i++ {
        h.Write(body)
    }
    sum := h.Sum(nil)

    w.Header().Set("Content-Type", "text/plain")
    _, _ = w.Write([]byte(hex.EncodeToString(sum)))
}

func main() {
    log.Printf("startup: GOMAXPROCS=%d NumCPU=%d",
        runtime.GOMAXPROCS(0), runtime.NumCPU())
    http.HandleFunc("/", handler)
    log.Fatal(http.ListenAndServe(":8080", nil))
}
```

This handler does about 0.5 ms of CPU work and 2 ms of simulated I/O per request. It is a useful microcosm because both kinds of work are present, so the optimal `GOMAXPROCS` is non-trivially a function of both.

---

## Driving Load With `wrk` and `hey`

Two load generators are enough for junior-level tuning:

- **`wrk`** — fast, scriptable, accurate. Good for sustained load.
- **`hey`** — simpler, prints percentiles by default. Good for quick checks.

A typical sweep invocation:

```bash
for n in 1 2 4 8 12 16 32; do
    GOMAXPROCS=$n ./tinyserver &
    pid=$!
    sleep 1
    echo "=== GOMAXPROCS=$n ==="
    wrk -t8 -c128 -d20s --latency http://localhost:8080/ \
        | tee "results/gmp-$n.txt"
    kill "$pid"
    wait "$pid" 2>/dev/null
    sleep 1
done
```

A few tips:

- **Run for at least 20 seconds** per setting. JIT-style warmup is not a thing in Go, but the GC needs a few cycles to settle.
- **Drive from another machine** if you can. On the same machine, load generator and server fight for cores.
- **Match concurrency (`-c`) to expected production load**, not to `GOMAXPROCS`. The latter is the variable you are sweeping; the former is the workload signature.
- **Repeat three times** and take the median. Single runs vary by 5–10% even on quiet hardware.

---

## Recording Numbers You Will Actually Trust

A junior mistake is to run a sweep, eyeball the output, and commit a change. By the next morning you cannot remember which number came from which setting and whether you ran the load generator on the same machine.

Get into the habit of:

1. **One results file per run**, named with timestamp + setting.
2. **A README or notes file** that records: hardware, Go version, kernel, load generator, sweep parameters, date.
3. **A script that reproduces the sweep** — `sweep.sh` in your repo.
4. **A summary table** in a `RESULTS.md` you commit to the repo.

A minimal `sweep.sh`:

```bash
#!/bin/bash
set -euo pipefail
mkdir -p results
for n in 1 2 4 8 16; do
    GOMAXPROCS=$n ./tinyserver &
    pid=$!
    sleep 1
    wrk -t8 -c64 -d20s --latency http://localhost:8080/ \
        > "results/gmp-$n.txt"
    kill "$pid"; wait "$pid" 2>/dev/null
    sleep 1
done
grep -H 'Requests/sec\|99%' results/*
```

This habit alone separates engineers who tune from engineers who guess.

---

## Why You Should Not Tune On Your Laptop Alone

Your laptop is the worst place to tune `GOMAXPROCS`. Here is why:

- **Thermal throttling.** Laptop CPUs sustain peak only for seconds. After 30 s they slow down. A 60 s sweep produces an unfair late curve.
- **macOS/ARM specifics.** M-series chips have performance and efficiency cores. The runtime sees them all in `NumCPU`. Performance differs depending on which cores get scheduled.
- **Other apps.** Your browser, Slack, an editor — all eat CPU. The sweep sees an unstable baseline.
- **Different hardware than production.** A 12-core MacBook is not a 32-core Linux server. NUMA, cache topology, and I/O paths differ.

If you must tune on a laptop, do it for *learning the methodology*, not for picking a production value. Always re-run the sweep on the target environment before committing.

The senior-level file covers running sweeps in CI, which is the right answer for fleet-level tuning.

---

## When `GOMAXPROCS < NumCPU` Is Correct

Almost the only legitimate reason to set `GOMAXPROCS` below `NumCPU` is **co-tenancy**: you share the box with another CPU-hungry process and you want to leave headroom.

Examples:

- A sidecar container alongside your main service in a Kubernetes pod, where both should fit in the pod's CPU quota.
- A Go service running on a developer's machine, where the developer also runs an IDE and a database in the background.
- A service intentionally limited to one socket on a NUMA machine to keep memory access local (more on this at middle level).

The headroom you leave depends on the cohabitant's appetite. If the sidecar uses 1 CPU on average and you have a 4-core pod, `GOMAXPROCS=3` for the main service is reasonable. If you can talk to the orchestrator and split CPU between the two containers cleanly, do that and use `NumCPU` per container.

If you do not have a co-tenant, `GOMAXPROCS < NumCPU` is almost always wrong.

---

## When `GOMAXPROCS > NumCPU` Is Almost Never Correct

People reach for `GOMAXPROCS > NumCPU` in three common scenarios. All three are mistaken.

1. **"More threads = more performance for I/O."** As covered in the netpoller section, this is wrong: the netpoller already handles I/O without consuming `P`s. Adding `P`s does nothing for I/O.
2. **"My code calls C and blocks."** This is closer to correct but still usually mis-applied. Cgo calls *do* consume an `M` that is detached from its `P` while blocked, so heavy cgo can mean more `M`s than `P`s. But `GOMAXPROCS` does not cap `M`s — the runtime creates them as needed. The actual fix is the unrelated `runtime/debug.SetMaxThreads()` cap, plus avoiding cgo where possible.
3. **"For headroom."** This is the most common, most superstitious reason. There is no headroom to be had — extra `P`s do not buffer load; they add overhead.

The one *technically* legitimate case is heavily allocation-bound code where you want to give GC more parallel mark workers, but the runtime sizes GC workers from `GOMAXPROCS` and the relationship is not "more is better". This is professional-level territory.

For juniors: do not set `GOMAXPROCS` above `NumCPU`. Ever. If you think you have a case, you do not.

---

## Per-Tenant `GOMAXPROCS` Is Not a Thing

A common request from multi-tenant SaaS architects: "Can I give tenant A more CPU than tenant B by setting `GOMAXPROCS` higher for A's goroutines?"

No. `GOMAXPROCS` is **process-wide**. It applies equally to every goroutine in the process. There is no API for per-goroutine, per-package, or per-tenant `P` allocation. The only way to give one tenant more CPU than another is to run them in separate processes.

There are workaround patterns:

- **CPU pinning per OS thread.** You can use `runtime.LockOSThread()` and `taskset`/CPU affinity to bias certain threads to certain cores. Crude, rarely worth it.
- **Quotas at the application layer.** Rate-limit each tenant's request flow. This bounds CPU usage but does not give an absolute `P` allocation.
- **Separate processes.** The clean answer. One process per tenant (or tenant pool), each with its own `GOMAXPROCS` set appropriately, isolated by container or `cgroup`.

If you find yourself wishing for per-tenant `GOMAXPROCS`, you are likely past what a shared Go process should do. Split it.

---

## How Production Engineers Actually Set It

In practice, three patterns dominate:

1. **Default + log.** Trust Go 1.18+ to do the right thing in containers. Log the resolved value at startup. Alert if it deviates from expected. This is the modern norm.
2. **`automaxprocs` + log.** Same, but with the third-party library for older Go or extra safety. Common in fleets that span multiple Go versions.
3. **Explicit env var.** `GOMAXPROCS` is set in the Kubernetes manifest or systemd unit, derived from the CPU quota by the deployment tooling. Used when teams want full visibility in the manifest, or when running on platforms where automatic detection is unreliable.

Almost no one calls `runtime.GOMAXPROCS(N)` with a constant `N` in production code. If you see this in a code review, ask why. The answer should reference a specific measurement, not folklore.

---

## The Mental Checklist Before Touching It

Before changing `GOMAXPROCS` (or recommending a change), run through this list:

1. **Have I measured?** If no, stop. Measure first.
2. **What is the current value?** Read it from logs or `runtime.GOMAXPROCS(0)`.
3. **What is `NumCPU()`?** Read it from logs.
4. **Are they equal?** If yes and the service runs in a container, are cgroup limits set? If they are not equal, why?
5. **What workload am I tuning for — throughput or latency?** Different curves, different optima.
6. **Have I run a sweep across at least 5 settings, three repeats each?** If not, my numbers are noise.
7. **Do I have before/after metrics from production-shape load?** If not, my numbers are guesses.
8. **Have I checked for CFS throttling?** If yes (`container_cpu_cfs_throttled_periods_total > 0`), my CPU quota is too low — `GOMAXPROCS` is the wrong knob, raise the quota.

If you cannot answer at least items 1–4 with a clear yes, do not change `GOMAXPROCS`.

---

## Common Junior Mistakes

A non-exhaustive list, all of which I have personally seen in production:

1. **Hard-coding `GOMAXPROCS` to a magic number.** "I read on Stack Overflow that 4 is good." It is not.
2. **Setting `GOMAXPROCS` higher to "give more parallelism" for I/O.** Netpoller already handles it.
3. **Tuning on a laptop, deploying to a 64-core server.** Different optima, different curves.
4. **Running the load generator on the same machine as the service.** Both fight for cores; the sweep is junk.
5. **Single-run measurement.** Noise dominates. Always 3+ repeats.
6. **Ignoring p99.** "Throughput is fine!" Yes, while every other request takes 200 ms.
7. **Tuning before profiling.** If the service is bottlenecked on the DB, no `GOMAXPROCS` value helps.
8. **Forgetting to remove a debug `runtime.GOMAXPROCS(2)` left from local testing.**
9. **Mixing the env var and the API call.** The API call wins. Surprising in incident response.
10. **Not logging the resolved value at startup.** Now no one knows what it was.

---

## Cross-References to the Internals

For everything this page deliberately does *not* explain, the canonical references are:

- `10-scheduler-deep-dive/01-gmp-model` — what `P` actually is.
- `10-scheduler-deep-dive/03-gomaxprocs-tuning/junior.md` — the env var, the API, defaults.
- `10-scheduler-deep-dive/03-gomaxprocs-tuning/middle.md` — cgroup files, `automaxprocs` source.
- `10-scheduler-deep-dive/03-gomaxprocs-tuning/professional.md` — `procresize`, STW.
- [01-goroutines/02-vs-os-threads](../../../01-goroutines/02-vs-os-threads/) — why goroutines are not threads, netpoller in depth.
- `10-scheduler-deep-dive/05-work-stealing` — what cross-P stealing actually costs.

This page is the **performance** view. Those pages are the **mechanism** view. Together they should give you a complete picture.

---

## Self-Assessment

You are done with this file when you can do all of the following without looking anything up:

1. Run a `GOMAXPROCS` sweep over five values on a sample service and produce a results table.
2. Read the resulting throughput and p99 curves and identify the optimum for each.
3. Explain in two sentences why CPU-bound and I/O-bound Go code both peak at `GOMAXPROCS = NumCPU`.
4. Name two concrete costs of `GOMAXPROCS > NumCPU` and two concrete costs of `GOMAXPROCS < NumCPU`.
5. Describe the role of `automaxprocs` and when it is still needed on Go 1.18+.
6. State the production hygiene rule: log `GOMAXPROCS` at startup, alert on misconfiguration.
7. Explain why per-tenant `GOMAXPROCS` is not a thing and what the alternative is.
8. List three reasons a sweep on your laptop will lie about production.

If you can do all of these, move on to [middle.md](middle.md), which covers sweep methodology in depth, NUMA, and container-CFS interactions.

---

## Summary

`GOMAXPROCS` is the parallelism cap on Go user code. The default is `NumCPU()`, which on Go ≥ 1.18 honours cgroup quotas on Linux. For performance:

- **CPU-bound workloads** peak at `GOMAXPROCS = NumCPU`.
- **I/O-bound workloads** also peak at `GOMAXPROCS = NumCPU`, because the netpoller frees `P`s for blocked goroutines.
- **Too high** costs throughput and latency via scheduling overhead, cross-P stealing, and spin time.
- **Too low** wastes cores and queues requests, raising p99 sharply.
- **Containers** were the historical trap; modern Go closes most of it, `automaxprocs` closes the rest.
- **Log the value at startup**, always. Most incidents start with "we didn't know what it was set to".

Tune by measurement, not folklore. The throughput curve is flat around the optimum; the latency curve is more sensitive — both matter.

Move on to [middle.md](middle.md) for sweep methodology, NUMA, and container interactions in depth.
