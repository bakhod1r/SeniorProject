# Syscall Handling — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Architecting Around Syscall Cost](#architecting-around-syscall-cost)
3. [Bounded I/O Pools as a First-Class Pattern](#bounded-io-pools-as-a-first-class-pattern)
4. [Cgo Worker Pools and Affinity](#cgo-worker-pools-and-affinity)
5. [`LockOSThread` in Long-Running Services](#lockosthread-in-long-running-services)
6. [Netpoller-Friendly Designs](#netpoller-friendly-designs)
7. [Choosing Between Buffered Reads and Direct Syscalls](#choosing-between-buffered-reads-and-direct-syscalls)
8. [VDSO Awareness and Cross-Platform Reality](#vdso-awareness-and-cross-platform-reality)
9. [The M Pool: Sizing, Caps, and Failure Modes](#the-m-pool-sizing-caps-and-failure-modes)
10. [Interaction with the Garbage Collector](#interaction-with-the-garbage-collector)
11. [Signal Handling Under Syscall Load](#signal-handling-under-syscall-load)
12. [Containers, cgroups, and Syscall Behaviour](#containers-cgroups-and-syscall-behaviour)
13. [Observability in Production](#observability-in-production)
14. [Architectural Patterns I Reach For](#architectural-patterns-i-reach-for)
15. [Things I Have Learned the Hard Way](#things-i-have-learned-the-hard-way)
16. [Self-Assessment](#self-assessment)
17. [Summary](#summary)

---

## Introduction

The senior view of syscall handling is architectural. You stop tracing individual functions and start asking: "given that file I/O holds an M, that cgo holds an M, and that the netpoller is the only free lunch — how should this service be structured?"

You write services with explicit bounds on concurrent syscalls. You isolate cgo into pools so its M footprint is predictable. You measure thread count as a first-class metric and alarm when it drifts. You read scheduler traces during incident response.

This page is the bridge from "I understand the mechanism" to "I design systems that respect the mechanism." It assumes the middle-level material and adds the production decisions on top.

---

## Architecting Around Syscall Cost

Three syscall properties dominate service design:

1. **Network I/O is concurrency-cheap**: 10 000 connections cost 10 000 goroutines and ~10 threads. Stack memory dominates (~2 KB per goroutine ≈ 20 MB total).
2. **File I/O and other blocking syscalls hold an M**: at most ~`disk parallelism` (8 on a typical SSD) make sense in parallel. More just queues in the kernel.
3. **Cgo is expensive per call (~100 ns) and per M held**: amortize via batching; bound concurrency to a small pool.

A pattern that follows: a typical Go service has three "lanes":

```
          +------------------+
          |  HTTP handlers   |  many goroutines, mostly netpoller
          |  (50000)         |
          +--------+---------+
                   |
       +-----------+-----------+
       |                       |
       v                       v
+------+--------+     +--------+----------+
| File I/O      |     | Cgo / native      |
| semaphore=8   |     | workers (16)      |
+------+--------+     +--------+----------+
       |                       |
       v                       v
   (disk)                  (libfoo)
```

The HTTP handlers spawn freely; the file I/O and cgo lanes are bounded. Each lane has its own metrics: queue depth, latency, throughput.

This shape comes up again and again. The wider the front end, the more important the bounds on the bottom-of-stack lanes.

---

## Bounded I/O Pools as a First-Class Pattern

Implementing a file-I/O pool with backpressure:

```go
type fileIO struct {
    sem chan struct{}
}

func newFileIO(n int) *fileIO {
    return &fileIO{sem: make(chan struct{}, n)}
}

func (p *fileIO) Read(ctx context.Context, path string) ([]byte, error) {
    select {
    case p.sem <- struct{}{}:
    case <-ctx.Done():
        return nil, ctx.Err()
    }
    defer func() { <-p.sem }()
    return os.ReadFile(path)
}
```

Three properties:

- **Bounded concurrency**: never more than `n` Ms in syscalls.
- **Context-aware**: callers can abandon if too slow.
- **Drop-in**: replaces `os.ReadFile` with a method.

Sizing `n`:

- Spinning rust: 1–4 (limited by seek time).
- SATA SSD: 4–8.
- NVMe SSD: 16–64.
- Network filesystem: 4–16 (depends on bandwidth-delay product).

Measure tail latency under load. If p99 goes up sharply at higher `n`, you have saturated the underlying device. Back off.

### Variations

- **Per-mountpoint pool**: separate pools for `/data` and `/tmp` if they are on different devices.
- **Priority queues**: critical I/O bypasses the semaphore; background scans wait.
- **Adaptive sizing**: increase `n` while p99 is acceptable, decrease when it isn't.

This pattern subsumes most uses of `sync.WaitGroup` for I/O: instead of spawning N goroutines and waiting, you accept N requests and meter them.

---

## Cgo Worker Pools and Affinity

For services that call into C heavily (encoders, ML inference, hardware drivers), the cgo cost is the main scaling problem. Naive design:

```go
http.HandleFunc("/encode", func(w, r) {
    out := C.encode(input)
    w.Write(out)
})
```

Under 1000 RPS with 50 ms encode time, this spawns ~50 Ms. Each call also pays:

- ~100 ns of cgo overhead (negligible per call, expensive at high rate).
- M creation cost if the pool is exhausted (~5 µs).
- Context-switch cost if the M migrates between cores.

A worker-pool design:

```go
type encoder struct {
    work chan encodeJob
    n    int
}

type encodeJob struct {
    input []byte
    done  chan encodeResult
}

func newEncoder(n int) *encoder {
    e := &encoder{work: make(chan encodeJob, n*4), n: n}
    for i := 0; i < n; i++ {
        go e.worker()
    }
    return e
}

func (e *encoder) worker() {
    runtime.LockOSThread() // pin to one M
    defer runtime.UnlockOSThread()
    for job := range e.work {
        out := C.encode(unsafe.Pointer(&job.input[0]), C.int(len(job.input)))
        job.done <- encodeResult{out: out}
    }
}

func (e *encoder) Encode(ctx context.Context, input []byte) ([]byte, error) {
    job := encodeJob{input: input, done: make(chan encodeResult, 1)}
    select {
    case e.work <- job:
    case <-ctx.Done():
        return nil, ctx.Err()
    }
    select {
    case r := <-job.done:
        return r.out, nil
    case <-ctx.Done():
        return nil, ctx.Err()
    }
}
```

Properties:

- Fixed number of Ms (`n` workers + `LockOSThread`).
- Predictable thread count.
- Backpressure via channel-full semantics.
- C library can use thread-local state safely (each worker is pinned).

Sizing: typically `n` ≈ number of CPU cores for CPU-bound C work; higher if the C work is I/O-bound itself.

### Trade-offs

- **Latency**: queue depth adds latency. Tune buffer size.
- **Loss of preemption**: pinned goroutines doing long cgo calls cannot be preempted. Async preemption does not work in cgo.
- **C library compatibility**: some C libraries (e.g., signal-using ones) require pinning. Most do not, but pinning is safe.

We expand pin/cgo interactions in [professional.md](professional.md).

---

## `LockOSThread` in Long-Running Services

`LockOSThread` is the right call for:

1. **Thread-local OS state**: `setns`, `setpriority`, `sched_setaffinity`, OpenGL contexts, CUDA, GPU drivers in general.
2. **C library thread affinity**: any library that documents "must be called from the same thread that initialised it".
3. **Long-lived workers in a cgo pool** (as above).

It is the *wrong* call for:

- Tagging goroutines with thread IDs for tracing — use context.Context instead.
- "Affinity" optimisation when none is actually needed.
- Avoiding races where a better fix exists.

### Patterns

**Lock-on-entry, unlock-on-exit, never panic:**

```go
func criticalSection(fn func()) {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    fn()
}
```

**Pinned worker that survives panics:**

```go
func worker() {
    runtime.LockOSThread()
    defer func() {
        if r := recover(); r != nil {
            // Log; do not unlock — let the M die with the panic.
            log.Printf("worker panic: %v", r)
        } else {
            runtime.UnlockOSThread()
        }
    }()
    forever()
}
```

If a pinned worker panics, you usually do *not* want the M reused — its OS-level state may be corrupt. Leaving the lock in place causes the runtime to destroy the M, which is the safer behaviour.

**Multiple locks (counter semantics):**

```go
runtime.LockOSThread()    // counter = 1
runtime.LockOSThread()    // counter = 2 (still pinned)
runtime.UnlockOSThread()  // counter = 1 (still pinned)
runtime.UnlockOSThread()  // counter = 0 (unpinned)
```

Useful for nested helper functions. Match calls carefully or the goroutine outlives its lock and the runtime destroys the M as a precaution.

---

## Netpoller-Friendly Designs

Whenever you have a choice between a netpoller-backed primitive and a blocking-syscall one, choose the netpoller-backed one. Examples:

| Goal | Netpoller-friendly | Avoid |
|---|---|---|
| Sleep | `time.After`, `time.Sleep` | A loop calling `syscall.Nanosleep` (real syscall) |
| Wait on multiple events | `select` | A C-style polling loop |
| IPC | TCP, Unix sockets, `net.Pipe` | Named pipes opened as regular files |
| Timeouts | `context.WithTimeout` plus `<-ctx.Done()` | `time.AfterFunc` with manual cancellation |
| Cron-like | `time.Ticker` | `time.Sleep` in a loop with `time.Now()` comparisons |

### Connection pooling

For services that talk to backend databases or remote APIs, connection pooling is essential. Each idle connection costs ~2 KB of goroutine stack (if you have a goroutine watching it) plus ~one fd. The netpoller absorbs unlimited fds.

A typical pool:

```go
type pool struct {
    dial    func(context.Context) (net.Conn, error)
    conns   chan net.Conn
    max     int
}

func (p *pool) Get(ctx context.Context) (net.Conn, error) {
    select {
    case c := <-p.conns:
        return c, nil
    default:
    }
    return p.dial(ctx)
}

func (p *pool) Put(c net.Conn) {
    select {
    case p.conns <- c:
    default:
        c.Close() // pool full
    }
}
```

Sized for typical load + 2× headroom. The netpoller handles the rest.

### Streaming vs request/response

Streaming services (gRPC streaming, WebSocket, SSE) have one long-lived goroutine per connection, all parked in the netpoller. Cheap. Request/response services have many short-lived goroutines but the same netpoller behaviour. Both scale to hundreds of thousands of connections per process.

---

## Choosing Between Buffered Reads and Direct Syscalls

Each syscall costs:

- ~100 ns of `entersyscall`/`exitsyscall` bookkeeping.
- Whatever the kernel itself takes (~1 µs for cached reads).
- Possibly a handoff (~few µs).

For files, buffering pays for itself almost always:

```go
// Slow: a syscall per byte (or per small read)
f, _ := os.Open("data.txt")
defer f.Close()
var buf [1]byte
for {
    n, err := f.Read(buf[:])
    if n == 0 || err != nil { break }
    process(buf[0])
}

// Fast: ~one syscall per ~4 KB
f, _ := os.Open("data.txt")
defer f.Close()
r := bufio.NewReader(f)
for {
    b, err := r.ReadByte()
    if err != nil { break }
    process(b)
}
```

The `bufio.Reader` makes ~one `read(2)` per 4 KB. The unbuffered version makes one per byte. For a 1 MB file: 256 syscalls vs ~1 million. The unbuffered version triggers handoffs all over.

Same for writes — buffer through `bufio.Writer` and flush periodically.

### When NOT to buffer

- Large reads that you do once (`os.ReadFile` already reads the whole file in a few large syscalls).
- Network reads where you control message framing — `bufio.Reader` can hide a slow producer behind a buffer, increasing latency.

Measure. The bufio buffer is cheap (~4 KB per stream) but the latency trade-off is real.

---

## VDSO Awareness and Cross-Platform Reality

VDSO is a Linux thing. On other platforms:

| Platform | "Fast time" mechanism | Cost |
|---|---|---|
| Linux | VDSO `clock_gettime` | ~20 ns |
| macOS | `mach_absolute_time` | ~40 ns |
| Windows | `QueryPerformanceCounter` | ~50 ns (with TSC) to ~1 µs (with HPET) |
| FreeBSD | VDSO `clock_gettime` | ~25 ns |
| Containers without VDSO | real syscall | ~300 ns |

The Go runtime adapts. `time.Now()` is fast on all the major platforms — but only if the kernel exposes a fast mechanism. Some hardened or unusual containers hide the VDSO; check before assuming.

### Production gotcha: clock skew

VDSO reads from a shared memory page that the kernel updates. Under heavy NTP correction (e.g., chrony stepping the clock), the page can change rapidly. Two `time.Now()` calls a few ns apart can return values 1 ms apart. Use `time.Since` carefully if accuracy < 1 ms matters.

Use `runtime.nanotime()` for monotonic measurement (it ignores wall-clock adjustments). Wrap in `time.Now()` only for human-readable output.

---

## The M Pool: Sizing, Caps, and Failure Modes

The runtime maintains a pool of parked Ms in `sched.midle`. Behaviour:

- When an M finishes work and has no P, it parks in `sched.midle`.
- The pool has no explicit size; Ms accumulate until killed.
- The runtime kills excess Ms occasionally (specifics in [professional.md](professional.md)).

**Hard cap**: `runtime.SetMaxThreads(n)` (default 10 000). If you exceed it, the runtime panics with `runtime: program exceeds N-thread limit`.

```go
import "runtime/debug"
debug.SetMaxThreads(20000) // raise to 20k
```

Why would you exceed 10 000?

- Uncontrolled cgo concurrency.
- Forgotten `runtime.LockOSThread`s.
- A library that spawns its own threads via cgo.

The cap exists to fail fast rather than thrash the kernel.

**Soft pressure**: at ~`GOMAXPROCS * 10` Ms, the runtime spawns less eagerly. There are no exposed tunables.

### What "thread leak" looks like

In `top`: thread count climbs minute by minute, never drops. CPU spent in kernel grows. The Go program may otherwise look healthy.

Diagnosis steps:

1. `cat /proc/<pid>/status | grep Threads` — confirm leak.
2. Capture `runtime.Stack(true)` — see what goroutines are doing.
3. Search for `LockOSThread` calls in your code and dependencies; ensure each has a matching unlock.
4. Bound cgo concurrency.
5. If you cannot find the cause, profile `entersyscall`/`exitsyscall` hot paths via pprof.

---

## Interaction with the Garbage Collector

Syscalls and GC interact at three points:

**1. GC stop-the-world (STW) waits for syscalling Ms.**

When GC needs to STW, it waits for all running goroutines to reach a "safe point" (function prologue or back-edge). Goroutines in syscalls are *already* at a safe point — they cannot be inside Go code by definition. So GC can proceed without preempting them.

**2. Goroutines in cgo may delay GC.**

A cgo call holds the M and runs C code. C code cannot be preempted. If GC starts and a cgo call is in flight for 100 ms, the GC may finish before the call returns (if the goroutine is at a safe point at the moment of stop). But the cgo goroutine cannot scan its stack during GC because the stack is in C code.

The runtime handles this by scanning the goroutine's Go-side stack only — the part before the cgo call. C-allocated memory is invisible to GC.

**3. Returning from syscall during GC.**

When `exitsyscall` runs during a GC mark phase, the goroutine must do a write barrier check. This is cheap (~few ns) and transparent.

For most code, you do not have to think about GC-syscall interaction. For latency-sensitive systems doing lots of cgo, profile both GC pauses and cgo durations together.

---

## Signal Handling Under Syscall Load

Signals can be delivered to any thread of the process. The Go runtime handles them as follows:

- **Synchronous signals** (`SIGSEGV`, `SIGFPE`, `SIGBUS`) are delivered to the thread that caused them. The runtime turns them into Go panics if they come from Go code.
- **Asynchronous signals** (`SIGINT`, `SIGTERM`) are delivered to some thread and routed through `signal.Notify` to your registered channel.
- **`SIGURG`** is used by the runtime for async preemption. Application code should not handle it.
- **`SIGPROF`** is used by the CPU profiler.

When many Ms are in syscalls, signal delivery can be uneven. A signal delivered to an M stuck in `read(2)` does *not* interrupt the syscall (unless `SA_RESTART` is not set, which the runtime explicitly sets). The signal handler runs *after* the syscall returns.

For application signal handling (`SIGTERM` graceful shutdown), this is usually fine — the runtime routes the signal to the signal-handling goroutine, which can run on any free M.

But: if your service has all Ms in syscalls, signal delivery may be slightly delayed. Rare.

---

## Containers, cgroups, and Syscall Behaviour

In Kubernetes / containerd:

- **CPU limits** affect `GOMAXPROCS` via cgroup v2 (Go 1.16+ Linux). Set correctly per pod.
- **Thread limits** (`pid.max` in cgroups, RLIMIT_NPROC) cap your M count. Default usually high enough but watch out:
  - K8s pods have a default `pids.max` of ~4096 (varies). A cgo storm can hit this.
  - Containers with `--init=true` (tini) eat one pid slot.
- **Memory limits** affect M creation indirectly: each thread reserves ~8 MB virtual + ~16 KB resident. 10 000 Ms = ~80 GB virtual + ~160 MB resident.

Diagnose pid limits with:

```bash
cat /proc/$(pgrep myprogram)/limits
cat /sys/fs/cgroup/pids.max
```

In production, log thread count regularly and alarm at thresholds (e.g., > 200 = investigate).

### Container syscall overhead

Some container runtimes add seccomp filters that reject certain syscalls or check arguments. This adds ~50–200 ns per syscall. For a syscall-heavy workload, can be ~5% overhead. Profile with `perf` if suspicious.

---

## Observability in Production

Minimal observability for syscall behaviour:

- **Thread count metric**: scrape `/proc/self/status` or use Linux's prometheus node_exporter per-pid. Alarm if > some baseline + 50%.
- **`/sched/threads:threads`** (Go 1.21+) via `runtime/metrics`. Native, no parsing.
- **Goroutine count metric**: `runtime.NumGoroutine()`. Should be in same order as in-flight work; growing without bound = leak.
- **GOMAXPROCS metric**: log on startup. Catch container misconfigurations.
- **`/sched/latencies:seconds`** (Go 1.20+): histogram of time goroutines spend on runqueues. If this grows, scheduler is contended.

Periodically dump scheduler trace via `runtime/trace` for offline analysis.

For incident response:

- `curl localhost:6060/debug/pprof/goroutine?debug=2` — text dump of all goroutines.
- `curl localhost:6060/debug/pprof/threadcreate` — where new Ms were created from.
- `GODEBUG=schedtrace=1000` (start with this env if you can restart the process).

`pprof.threadcreate` is gold: it tells you which call sites caused M creation. If 50% of M creations come from one cgo callsite, you know where to bound.

---

## Architectural Patterns I Reach For

**1. Fan-in worker pool for cgo.**

One goroutine per worker, all pinned. Channel of jobs. Backpressure via channel-full.

**2. Bounded I/O semaphore.**

Buffered channel sized to disk parallelism. All file I/O passes through it.

**3. Netpoller-first design.**

Whenever talking to other processes, use TCP/Unix sockets, not named pipes or regular files. Use `select` on channels with `ctx.Done()` for cancellation.

**4. Single dispatcher for shared external state.**

If a service talks to a single external resource (a database, an Elasticsearch cluster), funnel all calls through a small worker pool. Per-request goroutines do their work, then hand off to the pool.

**5. Drop-in cancellation.**

Every blocking operation has a `context.Context` variant. Cancellation propagates without holding threads.

**6. Profile-driven thread sizing.**

Start with a guess (cores, disk parallelism, etc.). Measure tail latency under load. Adjust. Don't guess and walk away.

---

## Things I Have Learned the Hard Way

- **A `panic` in a `LockOSThread`'d goroutine can destroy an M.** Sometimes that is what you want (safety), sometimes it leaks. Test it.
- **`runtime.NumCPU()` on a container often returns the host's CPU count**, not the container's quota. Use `runtime.GOMAXPROCS(0)` for actual parallelism.
- **`os/exec.Cmd.Run` creates a new process**, which on Linux uses `fork+exec`. Briefly, the child has all the parent's Ms. Mostly harmless but can confuse `ps` output.
- **`pids.max` in containers is low by default.** Cgo-heavy services can exhaust it under load and the runtime panics. Raise via pod spec or via `debug.SetMaxThreads`.
- **DNS lookups go through cgo on some platforms** (macOS by default; Linux with `cgo` resolver). Each lookup holds an M. Use `GODEBUG=netdns=go` to force the pure-Go resolver for predictable behaviour.
- **`signal.Notify` channels are easy to deadlock.** If the channel is unbuffered and the receiver is slow, signals are dropped. Use buffered channels with at least 1 slot.
- **`runtime.GC()` does *not* park goroutines in syscalls.** It just initiates GC. Don't use it to "drain" pending work.

---

## Self-Assessment

- [ ] I can design a service that bounds syscall concurrency without losing throughput.
- [ ] I know when to pin goroutines with `LockOSThread` and when not to.
- [ ] I can describe the cgo M-creation storm and its mitigations.
- [ ] I can identify netpoller-friendly vs blocking-syscall code in a code review.
- [ ] I can size a cgo or file-I/O worker pool from first principles.
- [ ] I know the M-pool dynamics: how Ms are created, parked, killed.
- [ ] I know `runtime.SetMaxThreads` and when to raise it.
- [ ] I know that cgo + GC interact via the system stack and that GC can scan only Go-side state.
- [ ] I can read pprof/threadcreate to identify M-creation hot spots.
- [ ] I can architect for graceful degradation under container resource limits.

---

## Summary

The senior view of syscall handling is about **deliberate design** under the constraints the runtime imposes. Network I/O is the only truly cheap concurrency primitive; everything else holds an M per in-flight call. So:

- File I/O is bounded by a semaphore.
- Cgo runs in pinned worker pools.
- `LockOSThread` is used carefully and reviewed in code review.
- Thread count, goroutine count, and `GOMAXPROCS` are first-class metrics.
- Containers' `pids.max` and CPU quota are configured correctly.
- VDSO is used implicitly (`time.Now()`) without surprises.
- `pprof.threadcreate` is the go-to tool for M-creation diagnosis.

At professional level we go into the runtime source: the exact code paths of `entersyscall`, `exitsyscall`, sysmon's `retake`, and the per-platform thread creation routines. You will be able to read and modify the runtime itself.
