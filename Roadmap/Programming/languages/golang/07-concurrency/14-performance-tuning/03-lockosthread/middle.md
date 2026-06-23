# `LockOSThread` Performance — Middle Level

> This page assumes you have read the junior page on this topic and the semantics coverage in [01-goroutines/02-vs-os-threads](../../01-goroutines/02-vs-os-threads/). At the middle level, your job is to design the pinning around the workload — to pick patterns, build cost models, and decide where pinning sits inside a real service.

## Table of Contents

1. [The Middle-Level Question](#the-middle-level-question)
2. [Single-Owner Goroutine: the Canonical Pattern](#single-owner-goroutine-the-canonical-pattern)
3. [Channel-of-Work Geometry](#channel-of-work-geometry)
4. [Bounded Pool of Pinned Workers](#bounded-pool-of-pinned-workers)
5. [cgo Amortisation: the Quantified Case](#cgo-amortisation-the-quantified-case)
6. [Pinning + GOMAXPROCS: Budgeting the M](#pinning--gomaxprocs-budgeting-the-m)
7. [Lifecycle: Start, Drain, Stop](#lifecycle-start-drain-stop)
8. [Backpressure and the Pinned Worker](#backpressure-and-the-pinned-worker)
9. [Reply Channels: Allocation and Reuse](#reply-channels-allocation-and-reuse)
10. [Cancellation Semantics for Pinned Work](#cancellation-semantics-for-pinned-work)
11. [Recovering from Panics in a Pinned Worker](#recovering-from-panics-in-a-pinned-worker)
12. [Measuring the Pinned M: `runtime/metrics`](#measuring-the-pinned-m-runtimemetrics)
13. [When Pinning Hurts More Than It Helps](#when-pinning-hurts-more-than-it-helps)
14. [Anti-Pattern: Per-Request Pinning](#anti-pattern-per-request-pinning)
15. [Anti-Pattern: Pinning the `main` Goroutine "Just In Case"](#anti-pattern-pinning-the-main-goroutine-just-in-case)
16. [Pinning and `sync.Pool`](#pinning-and-syncpool)
17. [Pinning and the Race Detector](#pinning-and-the-race-detector)
18. [Diagnostic Recipes](#diagnostic-recipes)
19. [Summary](#summary)

---

## The Middle-Level Question

At junior level, the question is "what does `LockOSThread` do?" At middle level, the question is "given a workload, where does pinning fit in the design — if at all?"

The middle-level engineer designs the boundary. Pinning becomes a property of one component (a worker, a pool, a manager), and the rest of the program talks to it via channels. Most of the cost reasoning collapses to "we paid the price of one M to gain a thread-affine resource." The rest is engineering hygiene: lifecycle, backpressure, cancellation.

This page is a pattern catalog with measurements. Skim the patterns first; pick the one that matches your workload; then dig into the measurement section to verify the cost.

---

## Single-Owner Goroutine: the Canonical Pattern

The most general pattern. One goroutine, pinned, owning one thread-affine resource (or simply benefiting from cgo TLS amortisation). All callers communicate through channels.

```go
package gpu

/*
#include "cuda_stub.h"
*/
import "C"

import "runtime"

type Job struct {
    Input []float32
    Reply chan Result
}

type Result struct {
    Output []float32
    Err    error
}

type Worker struct {
    in chan Job
}

func New() *Worker {
    w := &Worker{in: make(chan Job, 32)}
    started := make(chan struct{})
    go w.loop(started)
    <-started
    return w
}

func (w *Worker) Submit(j Job) Result {
    reply := make(chan Result, 1)
    j.Reply = reply
    w.in <- j
    return <-reply
}

func (w *Worker) Close() {
    close(w.in)
}

func (w *Worker) loop(started chan struct{}) {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()

    if rc := C.cuda_init(); rc != 0 {
        close(started)
        return
    }
    defer C.cuda_shutdown()
    close(started)

    for job := range w.in {
        out, err := w.process(job.Input)
        job.Reply <- Result{Output: out, Err: err}
    }
}

func (w *Worker) process(in []float32) ([]float32, error) {
    // call into C with stable TLS
    return nil, nil
}
```

What this gives you:

- **Initialisation runs on the pinned thread**, so per-thread resources (CUDA context, GL context, namespace) are bound to the right place.
- **`started` synchronises caller and worker.** The caller only returns from `New` once the worker is ready, so the first `Submit` is safe.
- **Cleanup runs on the pinned thread** as well (via `defer`), so the resource is released by the same thread that created it — required by most thread-affine APIs.
- **The pinning is invisible to callers.** Anyone in the program holds a `*Worker` and calls `Submit`. They do not know an M is locked down.

Variants:

- If the resource is one per process (one GPU, one HSM session), use exactly one worker.
- If you can split work across multiple resources (multiple GPUs), use one worker per resource (next pattern).

---

## Channel-of-Work Geometry

The choice of channel buffer and reply channel allocation is where this pattern gets nuanced.

**Buffered or unbuffered?**

- Unbuffered (`make(chan Job)`): each `Submit` blocks until the worker receives the job. This is the simplest backpressure: callers slow down naturally when the worker is busy.
- Buffered (`make(chan Job, N)`): callers can dump N jobs into the queue before they block. Good if calls come in bursts and the worker is fast.

A typical heuristic: buffer = number of producers, or 2× the worker's throughput-per-tick. Too large a buffer hides latency problems; too small forces context switching on every submit.

**Reply per job, or shared reply?**

- Per-job (`reply := make(chan Result, 1)`): each Submit allocates a small channel. Garbage-collected after use. ~100 ns of allocation cost.
- Shared (one `out` channel for all replies): allocation-free but couples Submit ordering to a single consumer. Awkward when many goroutines call Submit.

For request-handling services where Submit is called from goroutines that wait synchronously for a reply, **per-job reply channels with buffer 1** is the right default. The buffer-of-1 lets the worker send without blocking even if the caller hasn't yet read.

```go
func (w *Worker) Submit(j Job) Result {
    reply := make(chan Result, 1)
    j.Reply = reply
    w.in <- j
    return <-reply
}
```

Allocation cost: one channel + small struct, maybe 200 bytes, GC'd promptly. Cheap compared to the pinning itself.

---

## Bounded Pool of Pinned Workers

When you have N replicable resources (N GPUs, N HSMs, N namespaces), build a bounded pool of pinned workers — one per resource — and a dispatcher that load-balances.

```go
type Pool struct {
    workers []*Worker
    next    atomic.Uint64
}

func NewPool(n int) *Pool {
    p := &Pool{workers: make([]*Worker, n)}
    for i := 0; i < n; i++ {
        p.workers[i] = New()
    }
    return p
}

func (p *Pool) Submit(j Job) Result {
    idx := p.next.Add(1) % uint64(len(p.workers))
    return p.workers[idx].Submit(j)
}
```

Round-robin is a fine default. Variants:

- **Least-loaded.** Track queue depth per worker; pick the lightest.
- **Affinity.** Hash a job ID to a worker so the same job always lands on the same resource (useful for cache warmth on the worker).
- **Sticky-on-failure.** Retry on a different worker if one fails (e.g., GPU OOM).

The total M cost is `N` plus the runtime's baseline (`GOMAXPROCS + a few`). If you have 4 GPUs and `GOMAXPROCS=8`, expect ~12–16 threads under load. That is reasonable.

---

## cgo Amortisation: the Quantified Case

The clearest performance argument for pinning is cgo: when a single goroutine makes many cgo calls per second, pinning saves the per-call M-acquisition cost.

Skeleton benchmark:

```go
package main

/*
#include <stdint.h>
static int64_t add(int64_t a, int64_t b) { return a + b; }
*/
import "C"

import (
    "runtime"
    "testing"
)

func BenchmarkCgoUnpinned(b *testing.B) {
    var sum C.int64_t
    for i := 0; i < b.N; i++ {
        sum = C.add(sum, 1)
    }
    _ = sum
}

func BenchmarkCgoPinned(b *testing.B) {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    var sum C.int64_t
    for i := 0; i < b.N; i++ {
        sum = C.add(sum, 1)
    }
    _ = sum
}
```

Run with `go test -bench=. -cpu=1,4`. Typical numbers on Linux x86_64 with Go 1.21:

```
BenchmarkCgoUnpinned-1   10000000   140 ns/op
BenchmarkCgoPinned-1     20000000    70 ns/op
BenchmarkCgoUnpinned-4   10000000   180 ns/op
BenchmarkCgoPinned-4     20000000    80 ns/op
```

Pinning halved the per-call cost when cgo dominates the workload. The reason is that the unpinned case may hand off the P and re-acquire it on each call; the pinned case keeps everything stable.

In real services the relative savings shrink because the C function itself takes longer than the bookkeeping. A C function that takes 10 µs sees pinning save ~50 ns — 0.5%. A C function that takes 100 ns sees ~50% savings.

The decision rule:

> Pin cgo workers when the C function is **comparable in cost** to the cgo overhead. Otherwise the savings are noise and the M cost is not justified.

---

## Pinning + GOMAXPROCS: Budgeting the M

Each pinned goroutine retires one M. The runtime compensates by growing more Ms, but the *effective* `GOMAXPROCS` for non-pinned work drops.

A planning rule:

```
effective_gomaxprocs = GOMAXPROCS - pinned_goroutines
```

If `effective_gomaxprocs` is less than 1, your service is unable to make progress on non-pinned work without scheduler thrash. Raise `GOMAXPROCS` or reduce pin count.

A worked example. You have:

- A 4-CPU container (`GOMAXPROCS=4`).
- 2 pinned goroutines for GPU workers.

Effective `GOMAXPROCS` for HTTP handlers, GC, sysmon, and everything else is 2. The runtime spawns extra Ms, but the kernel only has 4 cores to schedule them on. You will see Ms competing for CPU, with `top -H` showing 6–10 threads all wanting CPU and getting CFS-throttled.

The fix: raise the container's CPU limit to 6 (give the pinned workers their own cores) or reduce the pin count.

For the senior page we develop this into a fleet policy. At middle level, the rule of thumb is enough.

---

## Lifecycle: Start, Drain, Stop

A pinned worker has three lifecycle phases:

1. **Start.** Goroutine begins, calls `LockOSThread`, initialises per-thread resources, then signals readiness.
2. **Run.** Processes work from the channel.
3. **Stop.** Either via channel close (graceful) or via a signal (immediate).

A robust worker:

```go
type Worker struct {
    in   chan Job
    done chan struct{}
}

func New(ctx context.Context) (*Worker, error) {
    w := &Worker{
        in:   make(chan Job, 32),
        done: make(chan struct{}),
    }
    errCh := make(chan error, 1)
    go w.loop(ctx, errCh)
    if err := <-errCh; err != nil {
        return nil, err
    }
    return w, nil
}

func (w *Worker) loop(ctx context.Context, errCh chan<- error) {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    defer close(w.done)

    if err := initResource(); err != nil {
        errCh <- err
        return
    }
    defer releaseResource()
    errCh <- nil

    for {
        select {
        case <-ctx.Done():
            return
        case j, ok := <-w.in:
            if !ok {
                return
            }
            j.Reply <- process(j)
        }
    }
}

func (w *Worker) Close(ctx context.Context) error {
    close(w.in)
    select {
    case <-w.done:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

What this captures:

- **Constructor returns an error.** Initialisation failures don't leak a goroutine.
- **`ctx` cancels mid-run** for forced shutdown.
- **`Close` waits for drain** with its own timeout.
- **`UnlockOSThread` is deferred.** Even if `initResource` fails, the lock unwinds cleanly.
- **`done` is closed** so other code can wait for full shutdown.

This is the boilerplate worth having a generic version of in any service with multiple pinned workers.

---

## Backpressure and the Pinned Worker

A pinned worker processes one job at a time. If submitters are faster than the worker, the channel fills and submitters block. That is the natural backpressure.

Three options for handling overload:

1. **Block submitters** (the default). Simple, correct, and forces callers to slow down. Risky if the caller holds a critical lock or is on the request hot path.
2. **Drop excess** with a non-blocking send:
   ```go
   select {
   case w.in <- j:
   default:
       return ErrBusy
   }
   ```
3. **Time-bounded submit:**
   ```go
   select {
   case w.in <- j:
       return <-reply
   case <-time.After(50 * time.Millisecond):
       return ErrTimeout
   }
   ```

Option 3 is the right default for service APIs: it converts pin-pool saturation into a fast client-visible error instead of a long tail of slow responses. Wire it through `context.Context` so it composes with request deadlines:

```go
func (w *Worker) SubmitCtx(ctx context.Context, j Job) (Result, error) {
    reply := make(chan Result, 1)
    j.Reply = reply
    select {
    case w.in <- j:
    case <-ctx.Done():
        return Result{}, ctx.Err()
    }
    select {
    case r := <-reply:
        return r, nil
    case <-ctx.Done():
        return Result{}, ctx.Err()
    }
}
```

Now upstream timeouts cascade naturally into pinned-worker congestion handling.

---

## Reply Channels: Allocation and Reuse

If your service does millions of calls per second through pinned workers, the per-call reply-channel allocation can show up in pprof's `alloc_objects` view. Mitigations:

- **`sync.Pool` for reply channels.** Reusable, GC-pressure-light.
- **Pre-allocate per-caller.** Each long-lived caller owns one reply channel; jobs include a reference.
- **Shared return queue.** One worker → one reply channel; the caller is identified inside the reply.

Be careful: a pooled reply channel must never be reused while a prior reply is still in flight. The buffer-of-1 + per-submit allocation is robust because it eliminates that race; reuse needs careful synchronisation.

The general rule: **fix allocation only if pprof confirms it matters**. For most services, the cost is invisible.

---

## Cancellation Semantics for Pinned Work

A subtle point: the C call inside a pinned worker does not observe `ctx.Done()`. Once `C.process()` starts, it runs to completion. If `ctx` is cancelled, the worker can drop the result but not stop the C call.

Patterns:

- **C call is short.** Just let it finish. Drop the reply if `ctx` is cancelled by the caller.
  ```go
  reply := process(j)
  select {
  case j.Reply <- reply:
  case <-j.Ctx.Done():
      // caller gave up; drop reply
  }
  ```
- **C call is long but interruptible.** Some libraries expose a `cancel()` function. Build a side channel:
  ```go
  go func() {
      <-j.Ctx.Done()
      C.cancel(j.handle)
  }()
  ```
- **C call is long and not interruptible.** Hard. You can't pull a Go goroutine out of cgo. Either accept the worst-case latency or move the work to a subprocess (kill-able).

For thread-affine APIs that don't expose cancellation (OpenGL, most legacy crypto), accept the worst-case. Plan the pin pool size to cap concurrent in-flight work.

---

## Recovering from Panics in a Pinned Worker

A panic inside the pinned worker terminates the goroutine, which terminates the M (because of pinning), which leaves the process with one fewer worker. Without recovery, repeated panics drain the pool.

A defensive worker recovers per-iteration:

```go
func (w *Worker) loop() {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    initResource()
    defer releaseResource()

    for j := range w.in {
        func() {
            defer func() {
                if r := recover(); r != nil {
                    j.Reply <- Result{Err: fmt.Errorf("panic: %v", r)}
                }
            }()
            j.Reply <- process(j)
        }()
    }
}
```

The inner closure scopes the recover so a panic in `process` doesn't kill the worker. Note: `recover()` does *not* call `UnlockOSThread`, and that is desired — we want to stay pinned for the next iteration.

If the C library leaves the thread in an unsafe state after a panic (broken context, dangling resources), recovery is dangerous; you should let the worker die and spawn a replacement. Document the invariant per library.

---

## Measuring the Pinned M: `runtime/metrics`

Two metrics are essential for pinning analysis.

```go
import "runtime/metrics"

var samples = []metrics.Sample{
    {Name: "/sched/threads:threads"},
    {Name: "/sched/latencies:seconds"},
}

func report() {
    metrics.Read(samples)
    threads := samples[0].Value.Uint64()
    lat := samples[1].Value.Float64Histogram()
    fmt.Println("threads:", threads, "p99 sched latency:", percentile(lat, 0.99))
}
```

`/sched/threads:threads` is the M count. Plot it over time and overlay pinned-worker counts; the relationship should be roughly `baseline + pins`.

`/sched/latencies:seconds` is a histogram of how long runnable Gs wait before getting a P. If pinning saturates `GOMAXPROCS`, this rises. Alert on p99 > 5 ms.

Export both to your monitoring stack. The two together tell you whether your pinning budget is fitting inside the host's CPU.

---

## When Pinning Hurts More Than It Helps

Cases where the M cost is not paid for:

- **Few cgo calls per request.** Per-request cgo is rare enough that pin amortisation is invisible. Skip.
- **`GOMAXPROCS=1` workloads.** Every pin retires the only M; the service grinds to a halt. Don't pin in a single-CPU container without raising `GOMAXPROCS` first.
- **Bursty workloads.** A worker idle 99% of the time still retires an M. Cost-per-job is high.
- **Workers that mostly call Go code.** Pinning a Go-only loop loses scheduler flexibility for no benefit.
- **Stateless work.** If the worker doesn't hold per-thread state, you can use a regular goroutine and let the scheduler optimise.

The litmus test: *what would break if this goroutine ran on a different M each call?* If the answer is "nothing measurable," don't pin.

---

## Anti-Pattern: Per-Request Pinning

A common mistake:

```go
func handle(w http.ResponseWriter, r *http.Request) {
    go func() {
        runtime.LockOSThread()
        defer runtime.UnlockOSThread()
        // ... do C call ...
    }()
}
```

At 10K RPS, this spawns and destroys 10K pinned goroutines per second. Each pin creates an M (the runtime may reuse, but in practice churn is high), and each Unlock-by-exit destroys it. You burn the equivalent of one CPU core on `clone(2)`/`pthread_exit` syscalls.

Always prefer a long-lived pool of pinned workers serving a channel of work over per-request pins.

---

## Anti-Pattern: Pinning the `main` Goroutine "Just In Case"

```go
func main() {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    server.Run()
}
```

This pins the goroutine that runs `main`. Everything else in the program is unpinned and scheduled normally, but the `main` goroutine sits on its own M doing nothing but waiting for the server to return. One M wasted forever.

Worse, if any cleanup logic in `main` is followed by a graceful shutdown, the pinned M is now the one doing the cleanup — and on Linux that may matter for signal handling (Go installs handlers process-wide, but the *delivery thread* of a synchronous signal can matter for some setups).

The right pattern: pin only the goroutine that *needs* to be pinned. `main` should be free.

The single legitimate case for pinning `main` is OpenGL on macOS, where the GL context must be on the *main* thread of the process. There, `runtime.LockOSThread` is called in `init` (with the `runtime` package's `Goexit`/`LockOSThread` semantics) and the GL loop runs in `main`.

---

## Pinning and `sync.Pool`

`sync.Pool` has per-P caches. When a goroutine on M3 puts an object into the pool, it lands in P3's cache. When another goroutine retrieves on the same P, it gets the object. Cross-P retrieves are slower (a steal).

A pinned goroutine that puts and gets from a `sync.Pool` always uses the same P-cache. This is mildly beneficial for locality. But the cost of the pin is far higher than the cache-friendliness gain; don't pin to optimise pool access.

Conversely: if your pinned worker uses a `sync.Pool` and *other goroutines* also use the same pool, items the worker puts back will be cached on its P, and other workers might steal them. This is fine, just unsurprising.

---

## Pinning and the Race Detector

`-race` instruments memory accesses. It does not change the meaning of `LockOSThread`. A pinned goroutine still accesses its own stack and shared memory; races between the pinned goroutine and others are detected normally.

Pinning makes the race detector's work slightly easier in some cases: if the pinned goroutine is the only writer to a piece of memory and channels are used for handoff, the race detector confirms no race occurs. But there is no special interaction.

One thing to watch: cgo code is not instrumented by `-race`. If your pinned worker mainly delegates to C and the C code races with Go code, the race detector can't see it. Verify cgo invariants by other means.

---

## Diagnostic Recipes

When investigating a pinning-related performance issue, these checks usually identify the problem.

**Recipe 1: Is the thread count what you expect?**

```bash
cat /proc/$(pgrep myservice)/status | grep Threads
```

If `Threads:` is much higher than `GOMAXPROCS + 3–5 + pinned_workers`, something is leaking Ms (cgo storm, file I/O burst, accidental per-request pin).

**Recipe 2: Are the pinned goroutines doing work?**

```bash
GODEBUG=scheddetail=1,schedtrace=1000 ./myservice 2>&1 | head -50
```

Look for Ms whose `curg=<id>` does not change across samples. That M is glued to one G — i.e., pinned. Confirm those IDs match your worker goroutines.

**Recipe 3: Is scheduler latency rising?**

```go
import "runtime/metrics"

var s = []metrics.Sample{{Name: "/sched/latencies:seconds"}}
metrics.Read(s)
h := s[0].Value.Float64Histogram()
// derive p99
```

Compare to baseline. A rise after introducing pinning suggests you saturated `GOMAXPROCS`.

**Recipe 4: Is the pinned worker the bottleneck or its M's CPU?**

`top -H -p $(pgrep myservice)` shows per-thread CPU. If one thread is at 100% and the rest are idle, the pinned worker is CPU-bound and the rest of the program is starving for work; consider sharding.

**Recipe 5: Are cgo calls dominating?**

`go tool pprof -lines http://localhost:6060/debug/pprof/profile?seconds=30` then `top` will list functions with `_cgo_` prefix near the top if so. The right fix is often batching the cgo calls, not pinning.

---

## Summary

Middle-level pinning is about pattern selection and lifecycle. The patterns:

- **Single owner goroutine** for one resource.
- **Bounded pool of pinned workers** for N replicable resources.
- **Channel of work** with per-job reply channels for cleanest API.

The lifecycle:

- Start with a readiness signal.
- Run with explicit cancellation (context + channel close).
- Stop with a drain-or-timeout policy.

The budget:

- Each pinned goroutine retires one M; effective `GOMAXPROCS` drops by the same amount.
- Plan `effective_gomaxprocs ≥ 1`, preferably ≥ 2 for healthy scheduling.

The anti-patterns:

- Per-request pinning (use a pool).
- Pinning `main` "just in case" (waste of an M).
- Pinning to "speed up" Go-only code (scheduler is better than your pin).

The measurements:

- `runtime/metrics /sched/threads:threads` for M count.
- `runtime/metrics /sched/latencies:seconds` for scheduler health.
- pprof + `GODEBUG=scheddetail` for finding which Ms are pinned.

The senior page builds on these: real production architectures (OpenGL/CUDA fleets, namespace switching, signal-handler ownership), capacity planning at scale, and the cost of preempting pinned goroutines via `tgkill`.
