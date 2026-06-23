# Goroutines vs OS Threads — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Picking a Concurrency Model for a New Service](#picking-a-concurrency-model-for-a-new-service)
3. [The Three-Tier Model: Goroutines, Threads, Processes](#the-three-tier-model-goroutines-threads-processes)
4. [Cross-Language Interop](#cross-language-interop)
5. [Containers and `GOMAXPROCS` in Production](#containers-and-gomaxprocs-in-production)
6. [Architecting for the Netpoller](#architecting-for-the-netpoller)
7. [Surviving cgo at Scale](#surviving-cgo-at-scale)
8. [Thread-Pinning Strategies](#thread-pinning-strategies)
9. [NUMA, Cache Lines, and Goroutines](#numa-cache-lines-and-goroutines)
10. [Signal Handling Architecture](#signal-handling-architecture)
11. [Failure Modes That Wear a Goroutine Disguise](#failure-modes-that-wear-a-goroutine-disguise)
12. [Observability Architecture](#observability-architecture)
13. [Capacity Planning](#capacity-planning)
14. [Migrating from a Threaded System to Go](#migrating-from-a-threaded-system-to-go)
15. [When a Threaded Language Is Still the Right Choice](#when-a-threaded-language-is-still-the-right-choice)
16. [Self-Assessment](#self-assessment)
17. [Summary](#summary)

---

## Introduction

At senior level, the question is no longer "what is a goroutine" but "given a problem, what is the right concurrency unit, and how do I scale and observe a system built on it?" Goroutines vs OS threads is not an abstract distinction — it shapes the latency curve, the memory ceiling, the operational toolkit, and the language interop story of every service you build.

After this you will be able to:

- Choose between Go, a thread-pool language (Java/C#/Rust), and a process-per-request language (Erlang) based on workload shape.
- Design a Go service so that thread count is bounded and predictable under load.
- Manage cgo cost as a first-class architectural concern, not a footnote.
- Use `LockOSThread` with intent — knowing every consequence.
- Build observability that distinguishes goroutine-level from thread-level problems.

---

## Picking a Concurrency Model for a New Service

Goroutines are not always the right answer. A senior decision-maker matches workload shape to model:

| Workload shape | Best fit | Why |
|---|---|---|
| 100 000 concurrent network connections, low CPU per request | **Go (goroutines)** | Netpoller + cheap goroutines. JVM virtual threads (Loom) are equivalent. |
| Compute-heavy: image resize, ML inference, batch processing | Threads or processes (Rust, C++, JVM) | CPU-bound; cheap goroutines bring no value, and Go's GC can be a tax. |
| Soft-real-time: trading, low-latency RPC (< 1 ms tail) | Threads with priority pinning (Rust, C++) | Go's scheduler does not expose RT priorities; GC pauses bite. |
| Hard-real-time: audio DSP, motion control | RT OS + C/Rust | No GC, no green threads. |
| Embarrassingly parallel batch (one node, many cores) | Threads or processes; Go is fine if memory budget allows | Either works. Go's ergonomics often win at scale. |
| Massive isolation: one task must not corrupt peers | Erlang or container-per-task | Goroutines share memory; one corrupt goroutine can poison the others. |
| Distributed system (many machines) | Go + RPC; Erlang for soft-realtime | Within-machine choice is one decision; across-machine is another. |
| High-concurrency stateful logic with deadlock risk | Erlang (strict isolation) or Go with discipline | Both work; Erlang is harder to mis-use. |

### Anti-patterns

- "We're using Go because it's fast." Go is fast in many domains but not all. CPU-bound numeric code is often slower than C, Rust, or even Java with JIT.
- "We're using Go to get parallelism for free." Goroutines give *concurrency* for free. *Parallelism* requires multiple cores and CPU-bound goroutines actually running on those cores; for that, your code must be free of contention.
- "Goroutines mean we don't need a worker pool." Unbounded `go f()` per input is a leak engine. Even goroutines need bounds.

### The seasoned heuristic

Use Go for **I/O-bound, high-concurrency, mid-CPU** services. Use threaded languages for **CPU-bound or RT-critical** code. Use processes for **isolation-critical** systems.

---

## The Three-Tier Model: Goroutines, Threads, Processes

A robust system architecture often uses all three:

```
Process boundary (kernel-enforced isolation)
└── Threads (kernel-scheduled, parallelism units)
    └── Goroutines (runtime-scheduled, concurrency units)
```

### When to use each

| Tier | Use for |
|---|---|
| **Process** | Strong isolation (security, fault isolation, address-space separation). Heavyweight; switch is microseconds. Used for: workers that may crash, untrusted code, language interop with disjoint runtimes. |
| **Thread** | CPU parallelism, OS-thread-affine operations, real-time priority. Switch is microseconds; create is microseconds. Used for: dedicated I/O loops, GPU contexts, JNI callbacks. |
| **Goroutine** | High concurrency, blocking-style I/O, fine-grained tasks. Switch is nanoseconds. Used for: per-request handlers, fan-out, pipelines. |

### Composing the tiers

A typical mature Go service:

- One process (or multiple replicas behind a load balancer).
- 8–16 threads (one M per `GOMAXPROCS`, plus a few extras for sysmon, GC workers, netpoller).
- 1 000–100 000 goroutines (one per request, plus pools, plus background tickers).

You rarely deal directly with thread count. You design for goroutine count, and the runtime sizes threads.

### When you should care about thread count

- **cgo-heavy workloads**: each in-flight cgo call holds an M. Thread count tracks cgo concurrency.
- **Disk I/O at scale**: non-network blocking syscalls hold Ms.
- **Misconfigured `GOMAXPROCS`** in a container: too many runnable Ps lead to thread thrash.

Otherwise, trust the runtime.

---

## Cross-Language Interop

Goroutines are a Go-only abstraction. When integrating with other languages, you cross back to threads.

### Calling C from Go

- Each `C.foo()` call holds an M. See `cgo` discussion at middle level.
- For thread-affine C libraries (OpenGL, GUI toolkits), pin with `LockOSThread`.
- Architectural pattern: a **single owner goroutine** that pins itself and processes a channel of work. C library is only ever touched by that goroutine.

```go
type GPUSession struct {
    in  chan Work
    out chan Result
}

func NewGPUSession() *GPUSession {
    s := &GPUSession{in: make(chan Work), out: make(chan Result)}
    go func() {
        runtime.LockOSThread()
        defer runtime.UnlockOSThread()
        C.create_context()
        defer C.destroy_context()
        for w := range s.in {
            res := C.run(w.cdata())
            s.out <- Result{res}
        }
    }()
    return s
}
```

This pattern:

- Isolates thread-local C state in one goroutine.
- Avoids `LockOSThread` proliferation.
- Provides a goroutine-friendly API to the rest of the program.

### Calling Go from C

`go build -buildmode=c-archive` or `c-shared` produces a library callable from C. The Go runtime spins up inside the C process. Some caveats:

- The first call into the Go shared library spawns Go-side threads (Ms). Thread count of the C process grows.
- The C process's signal handlers may collide with Go's `SIGURG` (used for async preemption). Coordinate via `signal.Notify`.
- Each Go call holds the calling thread for the call duration plus Go runtime scheduling — a few microseconds of overhead per call.

### Java + Go via JNI

Possible but exotic. The JNI thread has C ABI; you call into a Go shared library; the Go runtime starts a Go scheduler. Memory model gets thorny: Java memory model + Go memory model + the JNI thread-attach rules.

### Recommendation

For cross-language interop, design **process-level** boundaries (RPC, gRPC, message queue) before reaching for in-process binding. Threads cross process boundaries cleanly; goroutines do not.

---

## Containers and `GOMAXPROCS` in Production

Earlier sections covered the basics. At senior level, you set policy.

### Policy 1: log `GOMAXPROCS` at startup

```go
log.Printf("go=%s GOMAXPROCS=%d NumCPU=%d",
    runtime.Version(), runtime.GOMAXPROCS(0), runtime.NumCPU())
```

This single line has saved more incidents than any other piece of code in a typical production Go service.

### Policy 2: enforce minimum Go version

Below 1.16 on Linux, cgroup CPU quotas are ignored. Make Go 1.18+ a hard requirement, then trust the runtime.

### Policy 3: explicit override only when measured

If you set `GOMAXPROCS` manually, write a comment with the benchmark data and date. Otherwise revert.

### Policy 4: alert on thread count

Track `/sched/threads:threads` (runtime/metrics) or `/proc/<pid>/status:Threads` from a sidecar. Alarm if a process suddenly grows past, say, 50 threads — likely a cgo storm.

### Policy 5: throttle cgo concurrency

If your service has cgo paths, bound the parallelism:

```go
var cgoSlots = make(chan struct{}, 8)

func cgoCall(arg int) {
    cgoSlots <- struct{}{}        // acquire
    defer func() { <-cgoSlots }() // release
    C.work(C.int(arg))
}
```

8 in-flight cgo calls = at most ~8 Ms held in C. Without this, every request that does cgo can spawn its own M.

### Policy 6: pre-warm pools

`sync.Pool` and goroutine pools accumulate cost on first use. For latency-critical services, warm them at startup. Otherwise the first 1 000 requests pay the bill.

---

## Architecting for the Netpoller

The netpoller is what makes Go great for network services. Architect to use it:

### Do

- Use the standard library `net` package directly. It is netpoller-backed.
- Treat one goroutine per connection as the default. The netpoller scales.
- Trust `http.Server` defaults; do not pool connections "to save threads" — connections do not cost threads.

### Don't

- Wrap network I/O in cgo. The cgo path bypasses the netpoller; you pay an M.
- Use `syscall.Read` directly on a socket. Bypasses the netpoller.
- Convert disk I/O to "look like network" hoping to use the netpoller. Disk I/O is not netpolled (epoll on regular files is broken).

### The 50K-connection design

```
Listener accepts -> handler goroutine
Handler reads request via netpoller (parked while waiting)
Handler dispatches to business logic
Business logic uses errgroup for parallel downstream calls
Each downstream is also netpolled
```

Memory footprint: ~2 KB stack × 50 000 = 100 MB. Thread footprint: ~10. CPU: only when actively processing.

### Long-poll / SSE / WebSocket

The netpoller pattern is unmatched for long-lived connections. 100 000 idle WebSocket clients are routine for a Go server with 4 GB of RAM.

### Limits

- File descriptor limit: each connection is an fd. Set `ulimit -n` to ~200K for a server intending to serve 100K connections (account for keep-alive and TLS handshakes).
- Ephemeral port range: outgoing connections are limited; bind to multiple source IPs or use SO_REUSEADDR.
- Kernel memory: each socket costs a few KB of kernel memory regardless of language.

The netpoller solves the *userland* thread cost. Kernel costs remain.

---

## Surviving cgo at Scale

The cgo cost model is the senior topic most people get wrong.

### Cost components

Per cgo call:

- ~50–200 ns for the M state transition.
- M held for the call duration. If the C function takes 100 ms, that M is unavailable for 100 ms.
- Potential M creation if all Ms are busy.

For a service doing 10 K cgo calls per second, each 1 ms:

- Average in-flight: 10 Ms held.
- Thread count grows to ~10 + GOMAXPROCS + extras.

If the C function takes 100 ms:

- Average in-flight: 1 000 Ms held.
- Most Linux systems can sustain this, but it is on the edge.

### Architecture patterns

#### Pattern A: bound cgo concurrency with a semaphore

Shown above. Caps the M count.

#### Pattern B: single owner pinned goroutine

Shown in the "Calling C from Go" section. Reduces cgo cost (no M-state transitions; the pinned thread is always the same one), at the cost of serialising the C calls.

#### Pattern C: subprocess

For very expensive or fragile C work, spawn a child process and communicate via IPC. The Go service does not hold the cgo Ms; the child's crash does not kill the Go process. Used by `chromedp` for browser automation, by many crypto sidecar designs.

```go
cmd := exec.Command("./c-worker")
stdin, _ := cmd.StdinPipe()
stdout, _ := cmd.StdoutPipe()
cmd.Start()
// Write requests to stdin; read replies from stdout.
```

#### Pattern D: batch

If the C library supports batched APIs, send 1 000 items per call instead of 1 000 calls of 1 item each. Saves ~1 000× the cgo overhead.

#### Pattern E: WebAssembly

For new code, sometimes embedding a WASM module is cheaper than cgo. Wazero or wasmtime-go embed a WASM VM in pure Go — no cgo, no M cost. Slower than native but predictable.

### Operational signals

- Watching thread count is the cheapest detector of cgo regressions.
- `runtime/trace` shows cgo as separate event types; visualise to find storms.
- `pprof block` profile picks up cgo calls held >10 ms.

---

## Thread-Pinning Strategies

`LockOSThread` pins one goroutine to one M. Senior-level use:

### Strategy 1: minimise pinned goroutines

Each pinned goroutine consumes an M permanently. For `GOMAXPROCS=4`, three pinned goroutines plus normal work means only one M for ~all other Go code. Plan accordingly.

### Strategy 2: pin once at the boundary

Don't pin and unpin per call. Pin a single goroutine that handles all calls into the thread-affine library, serially or via a queue.

### Strategy 3: never pin a "main loop" without explicit reason

`runtime.LockOSThread` in `main` (or `init`) means `main` is pinned. The other goroutines run on the remaining Ms. This is right for some programs (OpenGL apps where the main thread is the GL thread); wrong otherwise.

### Strategy 4: combine with goroutine labels

Pinned goroutines are often "the GUI thread" or "the GPU thread." Tag them so they are easy to find in profiles:

```go
go func() {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    pprof.SetGoroutineLabels(pprof.WithLabels(
        context.Background(),
        pprof.Labels("role", "gpu-worker"),
    ))
    workLoop()
}()
```

### Strategy 5: document every `LockOSThread`

Source comment explaining why pinning is needed. Future maintainers (and you, six months later) will appreciate it.

---

## NUMA, Cache Lines, and Goroutines

Goroutines float between threads, threads float between cores (unless pinned). On NUMA boxes (multi-socket), this can hurt:

- A goroutine that runs on core 0 (socket 0) and then on core 32 (socket 1) loses its L1, L2, and last-level cache locality.
- Synchronisation primitives bouncing between sockets pay extra cache-line latency (~100 ns vs ~10 ns intra-socket).

### Symptoms

- Throughput on a 64-core box is not 16× higher than on a 4-core box.
- CPU utilisation is high but throughput is mediocre.
- `perf stat -e cache-misses,LLC-load-misses` shows high cache traffic.

### Mitigations (senior tooling)

1. **Use `GOMAXPROCS` ≤ cores per socket.** A 64-core machine with 4 sockets of 16 cores: try `GOMAXPROCS=16` and run 4 replicas, each bound to a NUMA node.
2. **NUMA-aware deployment.** `numactl --cpunodebind=0 --membind=0 ./my-go-server`. Reduces cross-socket traffic for that replica.
3. **Avoid contended global state.** Shard work by NUMA node. Each goroutine touches state local to its node.
4. **Profile cache misses.** Go's runtime does not have built-in NUMA telemetry; use `perf` or `intel-vtune`.

### When NUMA is irrelevant

Most services on cloud VMs (≤16 vCPU) are single-NUMA-node. Don't optimise for NUMA without measuring.

---

## Signal Handling Architecture

At senior level you handle signals deliberately, not by accident:

### Design pattern

```go
func main() {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    sigCh := make(chan os.Signal, 1)
    signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
    go func() {
        s := <-sigCh
        log.Printf("received %v; shutting down", s)
        cancel() // cascade cancellation
    }()

    if err := server.Run(ctx); err != nil {
        log.Fatal(err)
    }
}
```

`cancel()` ripples through all goroutines that hold `ctx`. Combined with `errgroup.WithContext`, the entire tree shuts down cleanly.

### Why this works without `LockOSThread`

Go installs signal handlers process-wide. Whichever thread the kernel delivers the signal to, the Go runtime's handler funnels it through `signal.Notify`. You don't need to pin.

### Exceptions

- If you call a C library that installs its own signal handlers, conflicts arise. Configure the C library to ignore signals Go uses (especially `SIGURG`).
- If your program has *no* `signal.Notify`, the runtime's defaults apply: `SIGINT`/`SIGTERM` print stack and exit.
- For `SIGCHLD` (child process exit), use `os/exec` rather than direct signal handling.

### `SIGURG` and async preemption

Go 1.14+ uses `SIGURG` internally. Don't trap `SIGURG` unless you know what you are doing. If your C library uses `SIGURG`, set `GODEBUG=asyncpreemptoff=1` — but accept the regression in preemption behaviour.

---

## Failure Modes That Wear a Goroutine Disguise

Looking like a goroutine bug, actually a thread bug:

### Symptom: thread count climbs

Diagnosis path: cgo (most common), file I/O at scale, `syscall.Read` on a non-net fd, `LockOSThread` proliferation, fork bomb.

### Symptom: latency p99 spikes correlate with `top` showing single-thread saturation

Diagnosis: `GOMAXPROCS=1` accidentally (env var leak), or one pinned goroutine on a single core busy-looping.

### Symptom: program freezes on `GOMAXPROCS=1` (old Go)

Pre-1.14: tight loop with no function calls is uninterruptible. Upgrade or insert `runtime.Gosched()`.

### Symptom: process dies under load but no panic

Likely a syscall failed in a way the runtime cannot survive. Check kernel logs (`dmesg`). OOM kill, signal, or cgo segfault.

### Symptom: process survives a goroutine "crash"

A `panic()` recovered by `defer recover()` is *not* a crash; it is by-design. But if you see thousands of recover events, the system is silently broken.

### Symptom: signals are not delivered

Either you installed a handler in C that captures them first, or the signal is `SIGURG` (used by Go internally). Audit `signal.Notify` channels.

### Symptom: a goroutine that was supposed to be killed survives a `context.Cancel`

The goroutine is in a tight loop with no `select { case <-ctx.Done() }`. Or it is blocked in a cgo call (cgo calls don't observe `ctx.Done` — you must check before/after).

---

## Observability Architecture

The senior observability stack for goroutines and threads:

### Metric layer

| Metric | Source | Purpose |
|---|---|---|
| Goroutine count | `runtime.NumGoroutine()` | Leak detection (sustained rise) |
| Thread count | `runtime/metrics /sched/threads:threads` (Go 1.21+) or `/proc/<pid>/status` | Cgo storm / syscall pressure |
| GOMAXPROCS | `runtime.GOMAXPROCS(0)` | Config sanity |
| GC pause | `runtime.ReadMemStats` or `runtime/metrics` | Tail latency root-cause |
| Scheduler latency | `runtime/trace` flame graph | Hot lock or starvation |

Export to Prometheus / Datadog / OTLP. Alert on:

- Goroutine count > 10× baseline.
- Thread count > 50 (or other org-specific threshold).
- Scheduler latency p99 > 10 ms.

### Trace layer

`runtime/trace` (the runtime trace, not the user-level `runtime/trace.Span`) is the most powerful tool you have:

```go
f, _ := os.Create("trace.out")
trace.Start(f)
defer trace.Stop()
// ... do some work ...
```

Then `go tool trace trace.out` opens a UI showing every goroutine, every M, every P, every syscall over time. Look for:

- Long syscall blocks.
- Cgo events clustered.
- Goroutines waiting for a P to be available.
- GC stop-the-world pauses.

### Log layer

Tag each request with a request ID. Use `context.Context` to propagate. When a goroutine logs, include the request ID. This is *the* way to follow a request across goroutines, because goroutines have no public ID.

### pprof labels

```go
ctx = pprof.WithLabels(ctx, pprof.Labels("tenant", tenantID, "endpoint", path))
pprof.SetGoroutineLabels(ctx)
```

Goroutine pprof shows labels. You can filter "show me only goroutines for tenant X" — invaluable when isolating noisy neighbours.

---

## Capacity Planning

Predicting how many goroutines and threads you will run:

### Goroutine budget

For a request-handling service:

- 1 per active connection (server-side and client-side).
- 1–3 per request (handler + downstream fetches).
- N for the background pool (workers, tickers).

If you expect 50 000 concurrent users at 1 connection each plus 2 in-flight downstream fetches: 50 000 + 100 000 + N ≈ 150 000 + N goroutines.

Memory: ~2 KB × 150 000 = 300 MB on stacks alone. Plus closures, heap allocations per request. Plan ~5–10× the bare stack number — so 1.5–3 GB for goroutine-related state.

### Thread budget

For pure Go code (no cgo, no heavy file I/O): `GOMAXPROCS + 10` threads is normal.

For cgo-heavy code: estimate `cgo concurrency × average cgo duration / scheduler interval` — but in practice bound it with a semaphore.

For file I/O: 1 M per concurrent blocking read. Bound concurrency to ~ disk parallelism (4–8).

### CPU budget

`GOMAXPROCS` is the upper bound on Go-code-running threads. Real CPU utilisation is `GOMAXPROCS × (running fraction)`, where `running fraction` is what fraction of the time Go code is actually running on each M (vs parked, in GC, in syscall). Profile to measure.

### Sizing your VM / container

- For network-heavy services: pick a VM where memory budget covers your goroutine memory. CPU is secondary.
- For CPU-heavy services: pick a VM where vCPUs covers your `GOMAXPROCS` workload. Memory may be smaller.
- For latency-sensitive: bigger VM with fewer replicas often beats smaller VMs with more replicas (less cross-host coordination).

---

## Migrating from a Threaded System to Go

A common senior task: rewrite a Java/Python/C++ service in Go. Lessons learned:

### Lesson 1: don't translate threads 1:1 to goroutines

A Java service with a 200-thread pool might become a Go service with no explicit pool, just `go f()` per request. The instinct to recreate the pool 1:1 is wrong; it adds back the cost you came to Go to avoid.

### Lesson 2: rethink synchronisation

Java's `synchronized` and Python's `threading.Lock` often guard data that, in Go, could be owned by a single goroutine with a channel. Locks have their place, but a port "lock for lock" misses the chance to use CSP idioms.

### Lesson 3: cgo to ease the migration tempts but bites later

Wrapping the old C++ in cgo to speed migration: tempting. Plan to delete it. Each cgo path is a future debugging session.

### Lesson 4: profiling tools change

Profilers for Java (JProfiler, async-profiler), Python (`cProfile`, `py-spy`), and C++ (`perf`, VTune) have Go analogues but the workflow differs. Train the team on `pprof`, `runtime/trace`, and `go test -bench`.

### Lesson 5: GC tuning is new

A Java team is used to JVM GC tuning (`-Xmx`, `G1GC`, etc.). Go's GC tuning is much simpler (`GOGC`, `GOMEMLIMIT`) but the team must learn it. Set up GC dashboards.

### Lesson 6: cancellation semantics differ

Java `Future.cancel(true)` (interrupting threads) is a known minefield. Go's `context.Context` is cooperative. The migrated service needs *all long-running code* to respect `ctx.Done()`, which often is a non-trivial refactor.

---

## When a Threaded Language Is Still the Right Choice

A senior engineer is comfortable saying "Go is not right for this." Cases:

- **Hard real-time** (audio, motion control): no GC, no green threads.
- **Extreme CPU performance** (BLAS, encryption fast paths): SIMD-heavy C++/Rust beats Go for now.
- **Massive isolation requirements** (multi-tenant code execution sandbox): Erlang/BEAM, or process-per-tenant.
- **GPU compute as the primary workload**: CUDA in C++, or pure Python with deep frameworks; Go has nascent GPU support.
- **Embedded / no-OS**: no Go runtime; use C/Rust.
- **Existing investment**: a team with 10 years of Java expertise and no Go expertise rewriting in Go is rarely net-positive within a 6-month window.

The thread vs goroutine distinction shows up in every decision: "can this work cheaply hold many connections?" "can this work be paused without thread cost?" "is the latency floor of a goroutine context switch acceptable?"

---

## Self-Assessment

- [ ] I can articulate a workload-shape-to-language matrix.
- [ ] I have intentionally chosen between Go, JVM Loom, Erlang, and a threaded language for a real project.
- [ ] I have set up monitoring that distinguishes goroutine count from thread count.
- [ ] I have bound cgo concurrency with a semaphore in a production service.
- [ ] I have used `LockOSThread` exactly once or twice in my career, and can explain why each time.
- [ ] I have configured `GOMAXPROCS` correctly in a Kubernetes pod or equivalent container.
- [ ] I have used `runtime/trace` to find a scheduler bottleneck.
- [ ] I have designed a NUMA-aware deployment (or know why I do not need to).
- [ ] I have a written runbook for "thread count spiked above X."
- [ ] I have a coherent answer for "why are we using Go for this service?"

---

## Summary

The senior-level view of goroutines vs OS threads is that you treat them as **different tools at different layers**, not as competing primitives:

- **Goroutine** is the unit of concurrency for your business logic. Cheap. Many.
- **Thread** is the unit the runtime asks the kernel for. Few. Bounded.
- **Process** is the unit of isolation. Use for security, fault containment, language interop.

Senior decisions:

1. Match concurrency model to workload — Go for I/O-heavy, threads for CPU-heavy, processes for isolation.
2. Make thread count a monitored metric.
3. Bound cgo concurrency; never let it grow unbounded.
4. Use `LockOSThread` only when forced — and document each use.
5. Set `GOMAXPROCS` correctly in containers (or trust Go 1.16+ to do it).
6. Design observability across the layers (goroutine count, thread count, scheduler latency, GC pause).
7. Architect for the netpoller for network services — it is the secret weapon.
8. Plan capacity in terms of goroutine memory + thread count + CPU.

The professional level digs further into runtime internals: how the runtime spawns Ms via `clone(2)`, how the netpoller integrates with the scheduler, how signal handlers route, and how the runtime trace produces its data.
