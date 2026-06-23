# Tuning `GOMAXPROCS` — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [What `GOMAXPROCS` Actually Is](#what-gomaxprocs-actually-is)
3. [The Default Value](#the-default-value)
4. [`NumCPU` vs Physical Cores](#numcpu-vs-physical-cores)
5. [Reading the Current Value](#reading-the-current-value)
6. [Setting via Environment Variable](#setting-via-environment-variable)
7. [Setting via `runtime.GOMAXPROCS`](#setting-via-runtimegomaxprocs)
8. [Why Three Ways to Set It?](#why-three-ways-to-set-it)
9. [Concurrency vs Parallelism, One More Time](#concurrency-vs-parallelism-one-more-time)
10. [What Happens When You Pick Too Low a Number](#what-happens-when-you-pick-too-low-a-number)
11. [What Happens When You Pick Too High a Number](#what-happens-when-you-pick-too-high-a-number)
12. [Goroutines Are Not Threads — A Reminder](#goroutines-are-not-threads--a-reminder)
13. [The "I Need More Threads" Antipattern](#the-i-need-more-threads-antipattern)
14. [Containers — The Most Common Trap](#containers--the-most-common-trap)
15. [The cgroup-Aware History You Should Know](#the-cgroup-aware-history-you-should-know)
16. [`go.uber.org/automaxprocs` in One Page](#gouberorgautomaxprocs-in-one-page)
17. [CPU-Bound vs I/O-Bound — Two Different Worlds](#cpu-bound-vs-io-bound--two-different-worlds)
18. [A Tiny Demo: Spinning N Goroutines](#a-tiny-demo-spinning-n-goroutines)
19. [Watching the Effect of GOMAXPROCS](#watching-the-effect-of-gomaxprocs)
20. [Logging `GOMAXPROCS` at Startup](#logging-gomaxprocs-at-startup)
21. [Reading `GODEBUG=schedtrace`](#reading-godebugschedtrace)
22. [When to Touch GOMAXPROCS as a Junior](#when-to-touch-gomaxprocs-as-a-junior)
23. [What `runtime.GOMAXPROCS(n)` Returns](#what-runtimegomaxprocsn-returns)
24. [A Word About `runtime.NumCPU`](#a-word-about-runtimenumcpu)
25. [Common Mistakes](#common-mistakes)
26. [Other Languages, Briefly](#other-languages-briefly)
27. [A Mental Checklist Before Changing GOMAXPROCS](#a-mental-checklist-before-changing-gomaxprocs)
28. [Self-Assessment](#self-assessment)
29. [Summary](#summary)

---

## Introduction

`GOMAXPROCS` is the single Go runtime knob that even brand-new Go programmers run into within their first month. The reason is twofold. First, it appears in every blog post about scheduling. Second, it almost always defaults to the right value, so people who fiddle with it usually make things worse, not better. The goal of this junior file is to give you enough mental scaffolding that you know what the knob does, what the default is, when you should leave it alone, and when an experienced engineer might reach for it.

A few promises and one warning.

**Promises.** After reading this file you will:

- Explain what `GOMAXPROCS` controls without resorting to vague phrases like "parallelism".
- Read `GOMAXPROCS` from any running Go program in one line of code.
- Set `GOMAXPROCS` through the environment, through code, or through `automaxprocs`.
- Recognise the symptoms of a Go service that has the wrong `GOMAXPROCS` for its container.
- Read one line of `GODEBUG=schedtrace=1000` output without panicking.

**Warning.** Until you have profiled a real service and have a clear performance hypothesis, the right number to put into `GOMAXPROCS` is *whatever the default already chose*. Tuning without measurement is how production incidents start. Treat this section as background knowledge, not as a license to override defaults on day one.

---

## What `GOMAXPROCS` Actually Is

In the G-M-P model (covered in the [01-gmp-model](../01-gmp-model/) section), the runtime maintains three kinds of structs:

- `g` — a goroutine.
- `m` — an OS thread.
- `p` — a "processor" or scheduling context. A `p` holds a local runqueue, a small heap cache for the GC, and a few other per-context state pieces. To execute Go code, an `m` must hold a `p`.

`GOMAXPROCS` sets **the number of `p` structs** the runtime allocates. Because an `m` needs a `p` to run user code, and there are only `GOMAXPROCS` `p` structs to go around, **at most `GOMAXPROCS` OS threads can be running Go code in parallel at any instant**.

That last sentence has two important qualifiers.

1. **"Running Go code"** — not "existing". The number of `m` structs (i.e., OS threads in the process) can exceed `GOMAXPROCS` when some are blocked in syscalls, blocked in cgo, or parked waiting for work. `GOMAXPROCS` only bounds the number that are *simultaneously running compiled Go*.
2. **"At any instant"** — not "in total". You can have a million goroutines in flight; only `GOMAXPROCS` of them touch a CPU at the same moment.

So `GOMAXPROCS` is not a "thread cap" or a "goroutine cap" — it is a **parallelism cap on Go user code**.

---

## The Default Value

Since **Go 1.5 (August 2015)**, the default is `runtime.NumCPU()`. Before 1.5, the default was `1`, which made all Go programs effectively sequential unless the programmer explicitly opted into multi-core. Russ Cox flipped the default in 1.5 because eight years of Go experience had shown almost everyone wanted `NumCPU` anyway, and the cost (for the rare program that wanted sequential execution) was trivial to opt back into.

`runtime.NumCPU()` returns the number of logical CPUs that the process *can use*. On a typical Linux x86-64 server this is `nproc`. On a Mac M-series chip it counts both performance and efficiency cores. On Windows it returns the logical processor count visible to the process.

A subtle point: `NumCPU()` returns CPUs the OS says are available, not CPUs you are *allowed* to use. On bare metal these usually match. In containers they often do not — which is why the cgroup-awareness changes in Go 1.16 and 1.18 are so important. We will return to this.

---

## `NumCPU` vs Physical Cores

`NumCPU` returns **logical** CPUs, which on x86-64 with hyper-threading enabled is twice the **physical** core count. A 16-core box with HT shows up as `NumCPU() == 32`.

Should you care? Usually no. Hyper-threading is real parallelism for many workloads — two threads on the same physical core share some functional units, but they also share L1/L2 caches, which can help if the workload has good locality. The default of `GOMAXPROCS=32` on such a machine is reasonable.

When it matters: for workloads that saturate the SIMD/floating-point units (`compute-bound` numeric code), the two logical CPUs on one physical core fight for the same FPU and you get less-than-2× speedup. On such workloads, setting `GOMAXPROCS` to the **physical** core count sometimes beats the default. This is rare and you should measure before doing it.

---

## Reading the Current Value

The Go API is one line:

```go
package main

import (
    "fmt"
    "runtime"
)

func main() {
    fmt.Println("GOMAXPROCS:", runtime.GOMAXPROCS(0))
    fmt.Println("NumCPU:    ", runtime.NumCPU())
}
```

`runtime.GOMAXPROCS(n)` is a getter-setter hybrid: it sets the value to `n` if `n > 0`, and always returns the **previous** value. Passing `0` is therefore the idiomatic read.

If you want to see this without writing code, the `GODEBUG=schedtrace=1000` environment variable prints one scheduler summary per second, starting with `gomaxprocs=N`. We will look at that output later.

---

## Setting via Environment Variable

The runtime checks the `GOMAXPROCS` environment variable at startup. If set, it parses as an integer and uses that value instead of the default.

```bash
GOMAXPROCS=4 ./my-server
```

This is the cleanest way to override at deployment time without modifying source. Kubernetes manifests, systemd units, and Docker run commands all support setting env vars trivially.

A few rules:

- The value must be a positive integer; non-integers and zero are ignored (the runtime falls back to the default).
- Values larger than `runtime.NumCPU()` are accepted but usually counterproductive — see [What Happens When You Pick Too High a Number](#what-happens-when-you-pick-too-high-a-number).
- A leading `+`, scientific notation, or other unusual formats are not parsed — keep it to a plain decimal integer.

---

## Setting via `runtime.GOMAXPROCS`

The same function that reads also writes:

```go
import "runtime"

prev := runtime.GOMAXPROCS(8) // set to 8, returns previous
_ = prev
```

A few things to know:

- This is **not** a free call. Internally it can trigger `procresize`, which is a stop-the-world operation. At startup it is cheap because no goroutines are running yet; mid-program it pauses every other goroutine briefly.
- Set early — ideally before `main()` does any meaningful work — to keep the pause invisible.
- A common pattern is to call it once at the top of `main()` (or in `init()` of a package imported only by `main`).

If you need to change `GOMAXPROCS` dynamically based on observed load, you can, but it is rare and incurs an STW each time. We will revisit at the [senior level](senior.md).

---

## Why Three Ways to Set It?

Why does the runtime accept an environment variable, a code call, and (via third-party libraries) a cgroup-derived value? Because they fit different needs.

| Mechanism | Best for | Visibility | Risk |
|---|---|---|---|
| `GOMAXPROCS` env var | Operators tuning deployments without rebuilding | Visible in `env`, manifests | Forgotten env vars travel between environments |
| `runtime.GOMAXPROCS(n)` | Code that must compute the right value | Hidden in source | Easy to commit a constant that becomes wrong in containers |
| `automaxprocs` import | Containerised services on older Go | Visible from import list | Runs at init — order matters |

The general guidance: prefer the **default** unless you have a measurement; if you must override, prefer the **env var** for visibility; reach for code only when you are computing the value dynamically.

---

## Concurrency vs Parallelism, One More Time

This terminology trips juniors up, so a quick reminder.

- **Concurrency** is the *structure* of a program — multiple logical threads of control that may interleave. Goroutines provide concurrency. You can have a concurrent program on a single-core machine.
- **Parallelism** is the *execution* of multiple things at the same instant on different physical CPUs. Parallelism requires multiple cores and `GOMAXPROCS > 1`.

`GOMAXPROCS=1` removes parallelism but does **not** remove concurrency. Goroutines still exist, still get scheduled, still yield to each other. They just never run truly simultaneously. Some debugging tricks (e.g., reproducing data races in deterministic order) actually rely on `GOMAXPROCS=1`.

---

## What Happens When You Pick Too Low a Number

If you set `GOMAXPROCS=1` on a 16-core machine running a CPU-heavy workload:

- Only one core is used. Throughput is roughly 1/16 of potential.
- The other 15 cores sit idle.
- Latency increases under load because goroutines pile up on the one P.
- Scheduler overhead per goroutine is *lower* — no cross-P stealing, no spinning — but the total wall-clock penalty is enormous.

If you set `GOMAXPROCS=4` on a 16-core machine running mixed CPU + I/O work:

- CPU-bound goroutines bottleneck on 4 cores.
- I/O-bound goroutines mostly do not care — they spend most of their time parked, freeing up the P.
- For a typical web service, this is sometimes acceptable; the netpoller is doing the heavy lifting and CPU is not the bottleneck.

The general rule: **too low costs throughput on CPU-bound paths**. Below `NumCPU` only makes sense if you are sharing the box with other CPU-hungry processes or if you have measured that lower values reduce tail latency.

---

## What Happens When You Pick Too High a Number

If you set `GOMAXPROCS=128` on a 16-core machine:

- The runtime allocates 128 P structs. Memory cost: small (~a few KB per P).
- At most 16 of those 128 Ps can have an M running on a real CPU at any moment, because the kernel only has 16 cores.
- The other 112 Ps are idle most of the time. They sit in the idle-P list.
- Worse: when an M finishes its work, it may try to spin looking for work on the 128 Ps before parking. More Ps means more spinning. Spinning means more CPU burnt by the runtime, not by your code.
- Worse still: work-stealing scans more Ps. Each scheduler decision is slightly slower.

`GOMAXPROCS > NumCPU` almost always **hurts** performance. Even by a few percent. It is one of the easiest wins to undo when you inherit a codebase with a hard-coded inflated value.

---

## Goroutines Are Not Threads — A Reminder

A common confusion: "if `GOMAXPROCS=8`, I should spawn 8 goroutines for parallelism, right?"

No. You spawn as many goroutines as your problem naturally has. Goroutines are cheap. `GOMAXPROCS` is the parallelism cap; the runtime time-slices your goroutines onto that many threads automatically.

If you have:

- 1 000 incoming HTTP requests per second, spawn ~1 000 goroutines per second. Do not throttle yourself to 8.
- A `for i := 0; i < 1_000_000; i++ { go work(i) }` loop that does pure CPU work, **do** throttle — but using a worker pool, not by tuning `GOMAXPROCS`. The pool bounds memory and queue depth; `GOMAXPROCS` bounds parallelism.

Keep these two knobs separate in your head. `GOMAXPROCS` is for the runtime; pool size is for your design.

---

## The "I Need More Threads" Antipattern

You will sometimes hear: "my service is slow, let me bump `GOMAXPROCS` to 128 to give it more threads."

This is wrong on two counts.

1. `GOMAXPROCS` does not control how many OS threads exist. The runtime creates threads as needed (one per blocked syscall, plus a small reserve). Raising `GOMAXPROCS` does not let more syscalls run concurrently.
2. If the service is slow because of contention or GC or downstream latency, more Ps will not help. They might make it worse by adding scheduler overhead.

If you find yourself reaching for `GOMAXPROCS` as a knob, stop and profile first. The fix is almost always elsewhere.

---

## Containers — The Most Common Trap

This is the single most important concept in the junior file.

Imagine a Kubernetes pod with:

```yaml
resources:
  limits:
    cpu: "500m"
    memory: "512Mi"
```

The pod is scheduled on a node with 64 CPUs. The container runtime configures **cgroups** to enforce the 500m (half a CPU) limit. The kernel does not stop the process from *seeing* 64 CPUs, but it will throttle CPU usage if the process tries to use more than 0.5 cores.

Now Go starts up. What does `runtime.NumCPU()` return?

- On Go ≤ 1.15: **64**. The runtime did not know about cgroups. `GOMAXPROCS` defaulted to 64.
- On Go 1.16 – 1.17 with cgroup v1: **1** (rounded up from 0.5). Better.
- On Go ≥ 1.18 with cgroup v2: **1**. The full picture.

With `GOMAXPROCS=64` in a pod limited to 0.5 CPU, what happens? The runtime spawns 64 Ps. It happily schedules goroutines onto all of them. The kernel sees the pod exceeding its quota and **throttles** — pauses the process for milliseconds at a time. The scheduler has no idea this is happening. To Go internals it looks like random ~100 ms stalls. To users it looks like p99 latency randomly spikes.

This is the single most common production bug in containerised Go services.

---

## The cgroup-Aware History You Should Know

A short timeline of how Go's container-awareness evolved:

| Go version | What changed |
|---|---|
| 1.0 – 1.4 | `GOMAXPROCS` default = 1. Containers did not exist yet (the issue did not exist). |
| 1.5 | Default = `runtime.NumCPU()`. Cgroups appeared in Linux but Go ignored them. |
| 1.6 – 1.15 | Same. By 2018, Kubernetes was widespread and many services ran with `GOMAXPROCS` set to the node count. Latency suffered. |
| 1.16 (Feb 2021) | The Go runtime started honouring **cgroup v1** CPU quotas on Linux. `NumCPU()` would return `ceil(quota / period)`. |
| 1.18 (Mar 2022) | Added **cgroup v2** support. Modern Kubernetes (≥ 1.25) uses cgroup v2 by default. |
| 1.21+ | Refinements; behaviour is now reliable on every modern Linux container runtime. |

If your service is running on Go ≥ 1.18 on Linux, **trust the default**. If it is running on an older Go, or on a non-Linux container (rare but real), use `automaxprocs`.

---

## `go.uber.org/automaxprocs` in One Page

For services that cannot be on a recent Go, Uber published a small library that reads cgroup quotas at startup and calls `runtime.GOMAXPROCS` with the correct value.

```go
package main

import (
    _ "go.uber.org/automaxprocs"
    "fmt"
    "runtime"
)

func main() {
    fmt.Println("GOMAXPROCS after automaxprocs:", runtime.GOMAXPROCS(0))
}
```

The blank import is enough — the library registers an `init()` that does the work. It logs one line at startup like `maxprocs: Updating GOMAXPROCS=1: determined from CPU quota`.

Why use it if Go ≥ 1.16 already does this?

- Belt-and-braces for code that may run on older Go or in unusual sandboxes.
- It logs unambiguously what value it chose, which is useful for ops.
- It works in some non-cgroup Linux environments where Go's heuristics give a worse answer.

If you control the deployment and use Go ≥ 1.18 + Linux + cgroup v2, you do not strictly need it. Many shops still include it for the log line alone.

---

## CPU-Bound vs I/O-Bound — Two Different Worlds

Knowing your workload character determines whether `GOMAXPROCS` matters at all.

**CPU-bound** — every goroutine spends most of its time in compiled Go code: image processing, JSON marshalling at high rate, cryptography, numeric work.

- `GOMAXPROCS` directly bounds throughput.
- The right value is "physical cores you can use".
- Going higher than `NumCPU` hurts. Going much lower hurts proportionally.

**I/O-bound** — every goroutine spends most of its time waiting: HTTP servers calling other services, database clients, message queue consumers.

- `GOMAXPROCS` matters far less. While a goroutine waits on the netpoller, the P is free to run another.
- A web service with 10 000 concurrent requests does fine with `GOMAXPROCS=4` if each request is mostly waiting on downstream.
- Going higher than `NumCPU` still hurts (scheduler overhead).

Most real services are a mix. The right baseline is `GOMAXPROCS = NumCPU` (the default). The most important rule is *do not exceed* `NumCPU`.

---

## A Tiny Demo: Spinning N Goroutines

To see `GOMAXPROCS` in action, run a CPU-heavy program with different values:

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
    "time"
)

func busy() {
    x := 0.0
    for i := 0; i < 1_000_000_000; i++ {
        x += float64(i) * 0.0000001
    }
    _ = x
}

func main() {
    fmt.Printf("GOMAXPROCS=%d NumCPU=%d\n", runtime.GOMAXPROCS(0), runtime.NumCPU())
    start := time.Now()
    var wg sync.WaitGroup
    for i := 0; i < 8; i++ {
        wg.Add(1)
        go func() { defer wg.Done(); busy() }()
    }
    wg.Wait()
    fmt.Println("elapsed:", time.Since(start))
}
```

Try:

```bash
GOMAXPROCS=1 go run main.go
GOMAXPROCS=2 go run main.go
GOMAXPROCS=4 go run main.go
GOMAXPROCS=8 go run main.go
```

On an 8-core machine you should see the elapsed time roughly halve each time you double `GOMAXPROCS`, until you hit `NumCPU`. Beyond that, no further improvement.

This is the simplest reproducible benchmark. Keep it in your toolbox.

---

## Watching the Effect of GOMAXPROCS

On Linux, `top -H -p $(pgrep mybinary)` shows per-thread CPU usage. Run the previous demo with `GOMAXPROCS=4` and you should see 4 threads each at ~100% CPU. With `GOMAXPROCS=1` you see 1 thread at 100% and others idle.

Note that the number of threads (Ms) the OS sees may be larger than `GOMAXPROCS` — extra Ms are sitting parked or in syscalls. The number that are *runnable on a CPU* is what tracks `GOMAXPROCS`.

---

## Logging `GOMAXPROCS` at Startup

A single line at startup will save you many debugging sessions.

```go
package main

import (
    "log"
    "runtime"
)

func main() {
    log.Printf("startup: GOMAXPROCS=%d NumCPU=%d GOOS=%s",
        runtime.GOMAXPROCS(0), runtime.NumCPU(), runtime.GOOS)
    // ... rest of main
}
```

The first time someone deploys your service into a cgroup-limited pod, they will see exactly what the runtime decided. If it does not match what they expected, they know where to look. Make this a non-negotiable.

If you use `automaxprocs`, it already prints a similar line. Still useful to add your own — it tells you the *final* value after all init code has run.

---

## Reading `GODEBUG=schedtrace`

Run a Go program with:

```bash
GODEBUG=schedtrace=1000 ./my-server
```

You will see a line every 1 000 ms:

```
SCHED 1000ms: gomaxprocs=4 idleprocs=2 threads=11 spinningthreads=0 needspinning=0 idlethreads=5 runqueue=0 [0 0 0 0]
```

Decoding:

- `gomaxprocs=4` — what `runtime.GOMAXPROCS(0)` would return.
- `idleprocs=2` — 2 of 4 Ps have no work right now.
- `threads=11` — total OS threads in the process. Includes parked ones, syscall-blocked ones, etc.
- `spinningthreads=0` — Ms actively scanning for work right now. High spinning is a sign of mismatch.
- `idlethreads=5` — Ms parked in the M-pool.
- `runqueue=0 [0 0 0 0]` — global runqueue length, then per-P queue lengths.

Two patterns to recognise immediately as a junior:

1. `idleprocs=0, runqueue>>0`: scheduler is saturated. `GOMAXPROCS` is small or cores are oversubscribed.
2. `idleprocs ≈ gomaxprocs, threads ≫ gomaxprocs`: lots of Ms parked, system is mostly idle, threads are leftover from past bursts.

We will dig into this much more in [senior.md](senior.md). For now, recognise the format.

---

## When to Touch GOMAXPROCS as a Junior

To put a sharp line under it: as a junior, the situations where you should change `GOMAXPROCS` are:

1. The default is wrong in your container (older Go without cgroup support). Fix with `automaxprocs` or upgrade.
2. A code review reveals a hard-coded `runtime.GOMAXPROCS(N)` that does not match reality. Remove it or fix it.
3. You are intentionally building a sequential demo for teaching. `GOMAXPROCS=1` is fine.

If your situation is "the service is slow and I want to try bumping GOMAXPROCS", do not. Profile first.

---

## What `runtime.GOMAXPROCS(n)` Returns

This catches juniors writing tests:

```go
prev := runtime.GOMAXPROCS(4) // returns previous, NOT new value
```

So:

```go
// Wrong: prev is the OLD value, not 4
fmt.Println("set to", prev)

// Right
runtime.GOMAXPROCS(4)
current := runtime.GOMAXPROCS(0)
fmt.Println("now at", current)
```

Useful pattern for tests:

```go
func TestWithFixedProcs(t *testing.T) {
    prev := runtime.GOMAXPROCS(2)
    defer runtime.GOMAXPROCS(prev)
    // test body
}
```

Always restore the previous value. Tests in parallel must coordinate.

---

## A Word About `runtime.NumCPU`

`runtime.NumCPU()` and `runtime.GOMAXPROCS(0)` are different.

- `NumCPU()` — how many CPUs the OS reports as usable. Cgroup-aware since 1.16/1.18. **Does not** change if you call `runtime.GOMAXPROCS`.
- `GOMAXPROCS(0)` — the current parallelism cap. Set by the runtime at startup (from `NumCPU` by default) or by the user.

A common pattern:

```go
n := runtime.NumCPU()
runtime.GOMAXPROCS(n)
```

This is redundant on Go ≥ 1.5 — the default is already `NumCPU`. Sometimes you see it as a defensive belt-and-braces for old code paths or as a way to override an inherited env var.

---

## Common Mistakes

| Mistake | What goes wrong | Fix |
|---|---|---|
| `runtime.GOMAXPROCS(100)` "for headroom" | More Ps than cores, spin overhead, scheduler bloat | Remove the line, trust the default |
| Setting `GOMAXPROCS=1` "to avoid races" | Throughput collapses; races still possible (logical bugs) | Use `-race` and fix the root cause |
| Ignoring container CPU limits | Throttling causes random latency spikes | Upgrade Go ≥ 1.18 or use `automaxprocs` |
| Changing `GOMAXPROCS` repeatedly at runtime | Each call is STW; pile up = visible latency | Set once at startup |
| Confusing `NumCPU` with physical cores | HT cores counted as separate; FPU-bound workloads under-perform | Measure; use physical count only when justified |
| Setting `GOMAXPROCS` higher when CPU is the bottleneck | No effect — you cannot exceed core count | Profile and find the real bottleneck |

---

## Other Languages, Briefly

A quick comparison to anchor the concept across ecosystems.

| Language | Equivalent knob | Default | Container-aware? |
|---|---|---|---|
| Go | `GOMAXPROCS` | `NumCPU()` since 1.5; cgroup-aware since 1.16/1.18 | Yes, on Linux |
| Java | `Runtime.availableProcessors()`; thread-pool sizing | Returns `nproc` or cgroup-aware count since JDK 8u191 / JDK 10 | Yes |
| Rust + Tokio | `tokio::runtime::Builder::worker_threads(n)` | `num_cpus::get()` | Manual — needs explicit cgroup detection |
| Node.js | `--max-old-space-size`, `cluster` module | Single-thread by default | Single-thread; cgroup affects memory, not workers |
| Python (asyncio) | One thread by default; `concurrent.futures.ThreadPoolExecutor` | Manual | Manual |

Go's defaults are among the most container-friendly. Java caught up around 2018. Rust + Tokio leaves it to the user. Node.js sidesteps the question by being single-threaded for JS.

---

## A Mental Checklist Before Changing GOMAXPROCS

Before you reach into the runtime, answer these:

1. Have I logged the current value at startup? What is it?
2. Is the service CPU-bound or I/O-bound? How do I know?
3. Is the process running in a container with a CPU limit? What does the cgroup file say (`/sys/fs/cgroup/cpu.max` on cgroup v2)?
4. What does `GODEBUG=schedtrace=1000` show? Are Ps idle, or saturated?
5. Have I profiled CPU usage with `pprof`? Where is the time going?
6. If I change `GOMAXPROCS`, what is my hypothesis for *why* throughput or latency should change?

If you cannot answer all six, do not touch the knob. Profile, log, then decide.

---

## Self-Assessment

- [ ] I can explain what `GOMAXPROCS` does in one sentence.
- [ ] I know the default since Go 1.5 is `runtime.NumCPU()`.
- [ ] I know that cgroup v1 awareness arrived in Go 1.16 and cgroup v2 in 1.18.
- [ ] I can read the current value with `runtime.GOMAXPROCS(0)`.
- [ ] I can set the value via env var or via `runtime.GOMAXPROCS`.
- [ ] I know why setting `GOMAXPROCS > NumCPU` is usually a regression.
- [ ] I can identify the symptom "throttled by cgroup with too-high GOMAXPROCS" in a service.
- [ ] I have used `go.uber.org/automaxprocs` or know when to use it.
- [ ] I always log `GOMAXPROCS` at startup in services I write.
- [ ] I distinguish concurrency from parallelism; I know one needs `GOMAXPROCS > 1` and the other does not.

---

## Summary

`GOMAXPROCS` is a small but consequential knob. It sets how many `P` structs the Go runtime allocates, which in turn caps how many OS threads can run Go user code in parallel at once. The default, since Go 1.5, is `runtime.NumCPU()` — and since Go 1.16/1.18 that default has been honest about container CPU quotas on Linux.

For a junior engineer the rules are simple:

- **Trust the default** unless you can prove it is wrong with a measurement.
- **Use `automaxprocs`** or upgrade Go if you are on an older runtime in containers.
- **Log it at startup**, always.
- **Never raise above `NumCPU`** without a measurable reason.
- **Never confuse it with goroutine count** — they are different concepts.

In the [middle](middle.md) file you will learn to recognise the symptoms of mis-tuning, dive into the container internals, and understand why I/O-bound workloads care less than CPU-bound ones. In [senior](senior.md) you will put a production policy around it: log lines, metrics, alerts, and benchmark-driven sweeps. In [professional](professional.md) you will read the actual `procresize` function in the Go runtime and understand the STW cost of a runtime resize. For now, keep it simple: leave the default alone, log what it is, and move on.
