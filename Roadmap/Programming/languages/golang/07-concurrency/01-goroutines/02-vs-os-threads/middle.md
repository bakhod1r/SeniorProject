# Goroutines vs OS Threads — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Numbers You Should Know](#numbers-you-should-know)
3. [The `M:N` Model in Detail](#the-mn-model-in-detail)
4. [How a Blocking Syscall Is Handed Off](#how-a-blocking-syscall-is-handed-off)
5. [The Netpoller — Network I/O Without Threads](#the-netpoller--network-io-without-threads)
6. [Cgo and Thread Costs](#cgo-and-thread-costs)
7. [`LockOSThread` in Practice](#lockosthread-in-practice)
8. [Tuning `GOMAXPROCS`](#tuning-gomaxprocs)
9. [Containers, cgroups, and `GOMAXPROCS`](#containers-cgroups-and-gomaxprocs)
10. [Goroutine Identity vs Thread Identity](#goroutine-identity-vs-thread-identity)
11. [Signals and Threads](#signals-and-threads)
12. [Comparing Goroutines to Other Languages' Concurrency](#comparing-goroutines-to-other-languages-concurrency)
13. [Diagnostics — Counting Threads and Goroutines](#diagnostics--counting-threads-and-goroutines)
14. [Performance Gotchas](#performance-gotchas)
15. [Best Practices for Established Codebases](#best-practices-for-established-codebases)
16. [Self-Assessment](#self-assessment)
17. [Summary](#summary)

---

## Introduction

At junior level you learned that goroutines are user-space, threads are kernel-space, and the runtime multiplexes one onto the other. At middle level you start *applying* that knowledge: choosing `GOMAXPROCS` correctly in containers, diagnosing thread-count anomalies, recognising cgo-induced M storms, and knowing when `LockOSThread` is the right hammer.

After this file you will:

- Reason about why a Go service uses N threads under load and predict that N.
- Know what happens to the thread pool when goroutines block in syscalls.
- Tune `GOMAXPROCS` for containers, NUMA boxes, and mixed workloads.
- Spot performance regressions caused by cgo, signals, or thread starvation.
- Use `runtime/trace` and `pprof` to see goroutine-vs-thread behaviour.

---

## Numbers You Should Know

Order-of-magnitude figures for a modern x86-64 Linux machine, Go 1.22+:

| Operation | Goroutine | OS thread |
|---|---|---|
| Create + first-yield | ~200–1 000 ns | ~5 000–50 000 ns |
| Context switch (user-space) | ~100–300 ns | n/a |
| Context switch (kernel-mediated) | ~1 000 ns (cgo / syscall) | ~1 000–10 000 ns |
| Initial stack | 2 KB | 8 MB on Linux (mmaped, lazy-paged) |
| Hard upper bound (memory) | Millions | A few thousand to tens of thousands |
| Hard upper bound (cores) | n/a (concurrency, not parallelism) | One thread per core, fully parallel |

These are not promises. They depend on kernel version, CPU, and Go version. Measure on your hardware.

A practical heuristic:

- **For pure CPU work**: number of useful Ms ≈ number of cores ≈ `GOMAXPROCS`. Spawning more goroutines does not help.
- **For blocking I/O**: number of Ms is *less* than the number of in-flight requests (because the netpoller handles waiters); thread count rises only with cgo and non-net syscalls.

---

## The `M:N` Model in Detail

Go is an **M:N scheduler**: M goroutines mapped onto N OS threads, where typically M ≫ N.

Three runtime entities (mnemonic: G = goroutine, M = machine = OS thread, P = processor context):

```
G (goroutine)   ── unit of work, ~2 KB stack
P (processor)   ── scheduler context; holds a runqueue, GC state, defer pool
M (machine)     ── OS thread
```

Scheduling invariants:

1. To execute Go code, an M must hold a P.
2. The number of Ps is fixed at `GOMAXPROCS`.
3. The number of Ms is dynamic; the runtime spawns and parks them as needed.
4. Goroutines live in a P's local runqueue (LRQ) primarily; overflow goes to the global runqueue (GRQ).
5. Idle Ps "steal" half the goroutines from a busy P's LRQ when their own is empty.

```
            GRQ (global runqueue)
             |
   +---------|-----------+----------+
   |         |           |          |
   P0        P1          P2         P3       <- count = GOMAXPROCS
   |         |           |          |
  LRQ        LRQ         LRQ        LRQ
   |         |           |          |
   M-a       M-b         M-c        M-d      <- attached Ms
                                              + extras parked / in syscall
```

This separation matters because:

- Most scheduler operations are **lock-free** on the P-local queue (no global mutex).
- Work stealing happens when a P empties, balancing load with minimal coordination.
- Blocking syscalls hand the P off to a fresh M, keeping the queue active.

The full GMP design is covered in [10-scheduler-deep-dive](../../10-scheduler-deep-dive/) — at middle level you should understand the layering well enough to read scheduler traces.

---

## How a Blocking Syscall Is Handed Off

A *blocking syscall* is one where the kernel may not return for a while: `read`, `write`, `open` of a slow device, `connect`, `accept`, `flock`. Linux non-network I/O does not go through the netpoller — it goes straight into the kernel.

When a goroutine calls a blocking syscall:

1. The runtime's `entersyscall()` is called (instrumented by the compiler/runtime).
2. The current M detaches from its P. The P is now *idle* with a non-empty runqueue.
3. The M makes the syscall. It is now stuck in the kernel.
4. If there is a `G` waiting and no idle M, the runtime spawns or unparks an M and attaches it to the orphaned P. That M starts running goroutines.
5. When the syscall returns, the original M tries to re-attach to a P. If one is available, fine. If not, the M parks itself (returns to the M pool) and the goroutine is put on the global runqueue to be resumed later.

```
Step 0:  M1 attached to P0. G42 calls read(fd).
Step 1:  runtime.entersyscall() — M1 detaches from P0.
Step 2:  M1 enters the kernel (blocked).
         P0 is idle with a runqueue full of pending goroutines.
Step 3:  sysmon notices P0 is idle. It pulls an M from the M-pool
         (or spawns a new one via clone(2)). Call it M5.
Step 4:  M5 attaches to P0. Resumes scheduling other goroutines.
Step 5:  Eventually, kernel completes read. M1 returns from the syscall.
Step 6:  runtime.exitsyscall() — M1 tries to grab a P.
         If P available: M1 attaches, runs G42 to continue.
         If no P:        M1 parks itself; G42 goes to a runqueue.
```

The consequence: a Go program may have **more Ms than `GOMAXPROCS`**, because some Ms are blocked in syscalls. `top` will reflect that.

### Threshold for handoff: 20 µs

The runtime does not detach the P immediately. For very short syscalls (< ~20 µs), the M just runs them quickly. For longer ones, `sysmon` (a runtime monitor running every ~20 µs) sees the M is still in `_Psyscall` state and forcibly hands off the P.

### Why is this important at middle level?

Two consequences you will encounter:

1. **Thread count grows under heavy blocking I/O.** A workload calling `read` on many slow files spawns Ms proportional to in-flight syscalls.
2. **The Go scheduler is not "free" if you abuse syscalls.** Each handoff is more expensive than a goroutine context switch.

For network I/O, see the next section — that path is much cheaper.

---

## The Netpoller — Network I/O Without Threads

Network reads, network writes, and timer waits go through the **netpoller**, a runtime component that uses non-blocking I/O plus `epoll` (Linux), `kqueue` (BSD/macOS), or `IOCP` (Windows).

When a goroutine calls `conn.Read`:

1. The runtime sets the underlying fd non-blocking (once, on first use).
2. The runtime calls `read`. If data is ready, it returns immediately.
3. If not, the runtime registers the fd with the netpoller and *parks the goroutine*. No M is held by the parked G.
4. The netpoller goroutine — running on one M — calls `epoll_wait` periodically (or continuously, depending on activity).
5. When `epoll_wait` says the fd is ready, the netpoller unparks the goroutine.
6. The goroutine is placed on a runqueue. Some M picks it up and `read` retries (it will succeed this time).

Effect: 50 000 idle WebSocket connections cost ~50 000 goroutines and ~one M. The M handling `epoll_wait` is *the same M as any other* — there is no dedicated netpoller thread (one of the Ms takes turns handling it, called from the scheduler).

```go
// Pseudocode for what happens under the hood of conn.Read
func (conn *netConn) Read(p []byte) (int, error) {
    for {
        n, err := nonblockingRead(conn.fd, p)
        if err == nil { return n, nil }
        if !errors.Is(err, syscall.EAGAIN) { return n, err }
        // EAGAIN: not ready. Park.
        netpoll.waitFor(conn.fd, 'r')   // park goroutine, return when fd ready
    }
}
```

The blocking-style `conn.Read` you write in Go is the cheap-and-friendly API on top of an event loop. Best of both worlds.

### What can use the netpoller?

- Sockets (TCP, UDP, Unix domain).
- Pipes (sometimes).
- Disk I/O? **No.** Linux `epoll` on regular files is broken — always returns "ready" — so disk reads are not netpolled. They go through the blocking syscall path.
- File watchers (`inotify`) — depends on the implementation.

This is why a server reading from a 10 GB log file may spike thread count, but a server with 50 000 idle TCP connections does not.

---

## Cgo and Thread Costs

A cgo call (`C.some_function()`) holds an M for its entire duration. Why:

- A C function may block, may store thread-local state, may interact with signal masks. The Go runtime cannot safely interrupt or move it.
- During the cgo call, the M is in a special state (`_Pcgo`). It is detached from its P (so other goroutines can run) but cannot be reused.
- When the cgo call returns, the M tries to re-attach to a P; if none is available, the M parks.

### The M-creation storm

If many goroutines simultaneously call into C and each call blocks for a while:

```go
for i := 0; i < 100; i++ {
    go C.slow_call()  // each holds an M for, say, 50 ms
}
```

For 50 ms, the runtime needs 100 Ms to keep 100 cgo calls in flight. If only `GOMAXPROCS + a few` Ms exist, the runtime calls `clone(2)` to create more. Thread count grows from ~10 to ~100 in milliseconds.

Recovery: after the calls return, Ms park. The runtime keeps a small pool of parked Ms (free Ms) to reuse but eventually destroys excess.

### Cgo overhead per call

Even a tiny cgo call costs ~100–200 ns of overhead just for the M-state transition. For a hot loop, batch as much C work into a single cgo call as possible:

```go
// Bad: 1M cgo calls
for _, x := range xs {
    C.process_one(C.int(x))
}

// Good: 1 cgo call
C.process_many((*C.int)(unsafe.Pointer(&xs[0])), C.int(len(xs)))
```

### When cgo is unavoidable

A few mitigations:

- Pool the C resources (open files, contexts) so each Go goroutine does not have to create one.
- Use `runtime.LockOSThread` if the C library is thread-affine, to avoid migration costs.
- Profile with `runtime/trace`; cgo state changes show up as separate events.

---

## `LockOSThread` in Practice

`runtime.LockOSThread()` pins the calling goroutine to the OS thread it is currently running on. Subsequent calls to `UnlockOSThread()` (the same number) release the pin.

Use cases (in order of frequency):

1. **Thread-local C library state.** OpenGL contexts, GnuTLS sessions, some database client libraries (older Oracle OCI), CUDA contexts.
2. **OS APIs that are thread-scoped.** Linux `setns` (namespace switching), `unshare`, `prctl(PR_SET_NAME)`, `setpriority`, `sched_setaffinity`.
3. **Signal handling on a specific thread.** Rare but real.
4. **Profiling.** `runtime/pprof.SetGoroutineLabels` can be combined with pinning to get a single thread of execution that is easier to read in `perf`.

### Example: switching Linux namespaces

```go
func enterNetworkNamespace(fd int) error {
    // setns must be called on the thread that you want to switch.
    // Pin the goroutine so it never moves.
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    return syscall.Setns(fd, syscall.CLONE_NEWNET)
}
```

If you forget `LockOSThread`, the goroutine may run on M1 when you call `Setns` (switching M1's namespace), then drift to M2 before the next syscall — which is in a different namespace. Programs that need namespace switching almost always pin.

### Cost of `LockOSThread`

- The pinned goroutine occupies its M exclusively. The runtime cannot move it.
- If the pinned goroutine blocks, that M is unusable for other Go work.
- If too many goroutines are pinned, you can deadlock: every M is held by a pinned goroutine, and `GOMAXPROCS` Ms have no P to run on.

Use sparingly; one or two pinned goroutines per process is typical.

### `UnlockOSThread` semantics

```go
runtime.LockOSThread()
runtime.LockOSThread()  // counter = 2
runtime.UnlockOSThread() // counter = 1, still pinned
runtime.UnlockOSThread() // counter = 0, unpinned
```

Match each `Lock` with an `Unlock`. If the goroutine exits while still pinned, the runtime *may destroy the M* (does so when it cannot safely reuse the thread).

---

## Tuning `GOMAXPROCS`

Defaults are usually right, but you may need to tune:

| Situation | Recommended value |
|---|---|
| Bare metal, dedicated machine | Default (`NumCPU`). |
| Container with CPU limit, Go ≥ 1.16 on Linux | Default (runtime reads cgroup v1/v2 quota). |
| Container with CPU limit, Go < 1.16 or non-Linux | Use `go.uber.org/automaxprocs`. |
| Mixed CPU-bound + I/O-bound workload | Default; the netpoller and syscall handoff handle the I/O. |
| Latency-critical, very low concurrency | `GOMAXPROCS=1` can reduce tail latency by avoiding cross-core cache effects. |
| Embarrassingly parallel CPU work | `GOMAXPROCS=NumCPU`. More does not help. |
| Wide NUMA box (≥ 32 cores) | Profile; sometimes a lower value reduces cross-socket cache traffic. |

### Reading and setting

```go
import "runtime"

n := runtime.GOMAXPROCS(0)  // read
runtime.GOMAXPROCS(4)       // set to 4
```

Set early — before any work spawns — to avoid runtime reshuffling.

### Environment

```bash
GOMAXPROCS=4 ./my-server
```

Honoured by the runtime at startup. Overrides the default.

### Heuristic: never set above `NumCPU`

`GOMAXPROCS > NumCPU` means more Ps than cores. Some of them sit idle (no M to attach to), and the kernel context-switches Ms more than necessary. Almost always a regression.

### Heuristic: set below `NumCPU` when sharing the box

A Go service co-tenanted on a 32-core machine with three other Go services: each at `GOMAXPROCS=8` is sometimes better than each at `GOMAXPROCS=32`. The scheduler does not coordinate across processes; you must.

---

## Containers, cgroups, and `GOMAXPROCS`

The most common production bug at middle level: Go service in Kubernetes pod with `cpu: 500m`, but `runtime.GOMAXPROCS(0)` returns `64` (the node count).

### Pre-Go 1.16 / 1.16 / 1.17 / 1.18

| Version | Behaviour |
|---|---|
| ≤ 1.15 | Ignores cgroup quota. `NumCPU` returns node CPU count. |
| 1.16 | First version to read cgroup v1 CPU quota on Linux. Partial. |
| 1.18 | Reads cgroup v2 quota. Modern containers (k8s ≥ 1.25) use v2. |
| ≥ 1.18 | Treats fractional quotas correctly: `cpu: 500m` → `GOMAXPROCS=1` (rounded up from 0.5). |

If you cannot upgrade Go, use the Uber library:

```go
import _ "go.uber.org/automaxprocs"
```

It reads the cgroup at `init` time and sets `GOMAXPROCS` accordingly. Print a log line if you want to confirm.

### Symptoms of mis-tuning

- Latency spikes during bursts (scheduler thrash).
- High CPU usage with low throughput.
- GC pause variability.
- Inconsistent throughput across pods.

Always log `runtime.GOMAXPROCS(0)` at startup. It is a one-line change that catches container-bound surprises.

---

## Goroutine Identity vs Thread Identity

Threads have OS identity (TID, visible in `/proc/<pid>/task/`). Goroutines do not.

The Go runtime does maintain an internal `goid`, but does not expose it via a public API. Reasons:

- Goroutines were designed to *not* be addressable from outside. Cancellation is cooperative via `context.Context`. Identification would enable broken patterns ("send a kill to goroutine 47").
- Goroutine pools recycle G structs; `goid` is not stable across runs.

### How to identify a goroutine in your own program

For logging, use `context.Context` to carry a request ID. Do not chase `goid`. There are unofficial hacks (`runtime.Stack` parsing) but they are fragile and slow.

```go
// Good
func handle(ctx context.Context, req Request) {
    log.Printf("[%s] handling", req.ID)
}

// Bad (don't do this)
func goid() uint64 { /* parse runtime.Stack output */ }
```

### Thread identity

Sometimes you do need thread identity (for `gettid()` to call a kernel API). Use `syscall.Gettid()` after `runtime.LockOSThread`:

```go
runtime.LockOSThread()
tid := syscall.Gettid()
// tid is stable as long as you stay pinned.
```

---

## Signals and Threads

POSIX signals can be delivered to any thread of a multi-threaded process. The Go runtime installs handlers that route signals into Go via `os/signal.Notify`. From the application's perspective, signals look like channel sends.

### Two flavours of signal

| Type | Examples | Behaviour |
|---|---|---|
| Synchronous | SIGSEGV, SIGFPE, SIGBUS | Delivered to the thread that caused them. The Go runtime turns these into runtime panics (or crashes). |
| Asynchronous | SIGINT, SIGTERM, SIGHUP | Delivered to "some" thread of the process. Go routes them through `signal.Notify`. |

You can normally ignore the per-thread aspect and just use `signal.Notify(ch, sig)`.

### When the per-thread aspect matters

If you call a C library that installs its own signal handlers, those handlers run on whichever thread received the signal. If they depend on thread-local state, you must pin or arrange handler delivery on a specific thread. This is exotic and rare.

### `SIGURG` and async preemption

Go 1.14+ uses `SIGURG` internally for asynchronous goroutine preemption. If your C library uses `SIGURG`, it conflicts. Workarounds:

- Change the C library to use a different signal.
- Run with `GODEBUG=asyncpreemptoff=1` (disables async preemption; not recommended for production).

---

## Comparing Goroutines to Other Languages' Concurrency

| Model | Language | M:N? | Cost | Notes |
|---|---|---|---|---|
| OS threads | C, C++, Java pre-21 | 1:1 | High | Familiar, kernel-managed. |
| OS threads + futures | Java, C# | 1:1 | High | Thread pool reduces creation cost. |
| Coroutines (cooperative) | Python `asyncio`, JS | N:1 typically | Very low | Single-thread; CPU-bound work blocks all. |
| Stackful coroutines | Lua, Boost.Coroutine | N:1 | Very low | No preemption. |
| Goroutines | Go | M:N | Very low | Preemptive (since 1.14), runtime-scheduled. |
| Virtual threads | Java 21+ (Project Loom) | M:N | Very low | Like goroutines: cheap, parked on blocking. |
| Green threads | Erlang processes | M:N | Very low | Strict isolation: no shared memory between processes. |
| Async/await | Rust, JS, Python, C# | varies | low | Compile-time transformation to state machines. |

Goroutines are closest to **Java virtual threads** (Loom) and **Erlang processes**, with the caveat that Go shares memory (Erlang does not).

### When to prefer goroutines

- High concurrency over high parallelism.
- Blocking-style code is desirable.
- Network-heavy workloads.

### When to prefer something else

- True hard real-time → low-level C/Rust with priority threads.
- Strict isolation (one bad task does not kill peers) → Erlang/Elixir.
- Web frontend → JS async/await.

---

## Diagnostics — Counting Threads and Goroutines

### Goroutine count

```go
import "runtime"
fmt.Println(runtime.NumGoroutine())
```

For a stack trace of every goroutine:

```go
import (
    "bytes"
    "runtime"
)

buf := make([]byte, 1<<20)
n := runtime.Stack(buf, true)
os.Stderr.Write(buf[:n])
```

Production: use `net/http/pprof`:

```bash
curl localhost:6060/debug/pprof/goroutine?debug=2 > goroutines.txt
```

### Thread count (Linux)

```bash
cat /proc/$(pgrep my-server)/status | grep Threads
# Threads: 11
```

Or:

```bash
ls /proc/$(pgrep my-server)/task | wc -l
```

Per-thread CPU:

```bash
top -H -p $(pgrep my-server)
```

### Thread count (Go runtime)

There is no public API. Workarounds:

- Read `/proc/self/status` from inside the program on Linux.
- Use `runtime.ReadMemStats` and `runtime/debug` for indirect signs.
- `runtime/metrics` exposes `/sched/threads:threads` since Go 1.21:

```go
import "runtime/metrics"

samples := []metrics.Sample{{Name: "/sched/gomaxprocs:threads"}}
metrics.Read(samples)
fmt.Println("gomaxprocs:", samples[0].Value.Uint64())
```

Future-proof your monitoring by going through `runtime/metrics`.

### Scheduler trace

```bash
GODEBUG=schedtrace=1000 ./my-server
```

Prints one line per second:

```
SCHED 1000ms: gomaxprocs=4 idleprocs=2 threads=11 spinningthreads=0 needspinning=0 idlethreads=5 runqueue=0 [0 0 0 0]
```

- `threads=11`: total Ms (not just runnable).
- `idlethreads=5`: parked Ms in the pool.
- `runqueue=0 [0 0 0 0]`: global runqueue + per-P queues.

Add `scheddetail=1` for per-G/P/M detail. Useful but very chatty.

---

## Performance Gotchas

### Gotcha 1: spurious thread growth from `os/exec`

`os.exec.Cmd.Run` uses `fork+exec`. On Linux, the runtime is careful: it has special code to do the fork without breaking the runtime state. But the *post-fork child* briefly has all the parent's Ms.

Symptom: thread count visible in `ps` looks weird during `exec` spikes.

Usually harmless. If you `exec` aggressively, profile.

### Gotcha 2: cgo storms

Covered above. Symptom: thread count climbs to hundreds during steady-state.

Mitigation: batch C calls; pin to a single goroutine that processes a queue.

### Gotcha 3: file I/O parks Ms

Non-network blocking I/O does not use the netpoller. Reading a 10 GB file in 100 goroutines spawns ~100 Ms.

Mitigation: bound the parallelism of file I/O via a semaphore. Disk parallelism is rarely > 4–8 useful anyway.

### Gotcha 4: GC writes can stall a goroutine

The Go GC is concurrent but has *stop-the-world (STW)* phases of ~100 µs–1 ms. During STW, every goroutine pauses. This is unrelated to threading but often confused with scheduler issues.

### Gotcha 5: `LockOSThread` causes scheduler imbalance

A pinned goroutine that does little work still occupies an M. With `GOMAXPROCS=4` and 4 long-pinned goroutines, the runtime has no Ms left for other work.

Mitigation: minimise pinned goroutines; offload work to non-pinned ones via channels.

### Gotcha 6: `runtime.Gosched` is rarely useful

A leftover from pre-1.14 era. With async preemption, the scheduler interrupts you when it needs to. Calling `Gosched` in tight loops adds overhead.

### Gotcha 7: misreading `top`

`top` shows threads, not goroutines. A Go server with `Threads: 12` is normal regardless of goroutine count.

---

## Best Practices for Established Codebases

1. **Log `GOMAXPROCS` at startup.** One line. Catches all cgroup misconfigurations.
2. **Run cgo-heavy code in a bounded pool** — never "1 cgo call per request" without bounding.
3. **Pair every `LockOSThread` with a documented reason** in the source comment.
4. **Track thread count as a metric** (`/sched/threads:threads` since Go 1.21). Alarm if it exceeds a sane threshold.
5. **Avoid `runtime.Gosched` in production code.** Tests sometimes need it; production rarely.
6. **Use `context.Context` for cancellation across goroutines.** Do not try to cancel a goroutine via signals or other thread-level mechanisms.
7. **Never assume thread identity is stable** unless you have called `LockOSThread`.
8. **Prefer the netpoller (network) to blocking syscalls when you have a choice** — abstractions like `net.Pipe` are netpoller-backed.

---

## Self-Assessment

- [ ] I can describe the M:N model and the role of G, M, and P.
- [ ] I know how the runtime handles a blocking syscall (P handoff).
- [ ] I know how the netpoller makes network I/O cheap.
- [ ] I can predict thread count for a typical Go server and explain spikes.
- [ ] I know when to use `LockOSThread` and when not to.
- [ ] I can tune `GOMAXPROCS` in a container (or know that Go 1.16+ does it automatically on Linux).
- [ ] I know that cgo calls hold an M and how that can lead to M-creation storms.
- [ ] I know that signal handlers run on "some" thread and how Go routes them via `signal.Notify`.
- [ ] I can read `GODEBUG=schedtrace=1000` output.
- [ ] I prefer `context.Context` for cancellation over any thread-level mechanism.

---

## Summary

The middle-level view of goroutines vs threads is about *applying* the layered model in real code:

- The Go scheduler is an M:N scheduler with three abstractions (G, M, P). Most operations are P-local and lock-free.
- Blocking syscalls trigger a P handoff: the M is parked in the kernel, a fresh M takes over the P, and goroutine scheduling continues. Thread count may briefly exceed `GOMAXPROCS`.
- Network I/O (and timers) goes through the **netpoller**, which uses non-blocking syscalls + `epoll`/`kqueue`. 50 000 idle connections cost zero extra threads.
- **Cgo** is the main source of M-creation storms; bound your cgo concurrency.
- **`LockOSThread`** is the explicit pin needed for OS- or library-thread-local state. Use sparingly.
- **`GOMAXPROCS`** in containers: trust Go 1.16+ on Linux; otherwise use `automaxprocs`.
- Goroutines have no public identity. Use `context.Context` for tracing and cancellation.

The senior level adds architectural decisions: choosing between a Go service, a thread-pool service, and an event-loop service; cross-language interop patterns; and surviving thread-level failures (cgo segfaults, signal masks, fork/exec) in long-running production systems.
