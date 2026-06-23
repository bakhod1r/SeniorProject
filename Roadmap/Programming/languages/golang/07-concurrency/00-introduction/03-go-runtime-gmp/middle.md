# Go Runtime GMP — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Run Queues in Detail](#run-queues-in-detail)
3. [Work Stealing Protocol](#work-stealing-protocol)
4. [Syscalls and the M Pool](#syscalls-and-the-m-pool)
5. [The Network Poller](#the-network-poller)
6. [Sysmon Responsibilities](#sysmon-responsibilities)
7. [Preemption Modes](#preemption-modes)
8. [GOMAXPROCS Tuning in Practice](#gomaxprocs-tuning-in-practice)
9. [The Scheduler's Effect on Latency](#the-schedulers-effect-on-latency)
10. [Diagnosing Scheduler Issues](#diagnosing-scheduler-issues)
11. [Self-Assessment](#self-assessment)
12. [Summary](#summary)

---

## Introduction

At junior level you learned the G, M, P alphabet and the basic flow: M holds P, P feeds G's, M's steal when local queues empty. At middle level we open the hood: queue layout, stealing details, syscall protocol, netpoll integration, preemption mechanics, and the practical decisions you make in production.

You do not need to read the runtime source for this. But you should be able to read a scheduler trace, reason about why a particular goroutine is stuck, and tune `GOMAXPROCS` thoughtfully. After this you will:

- Describe the per-P run queue layout (256-slot ring + overflow).
- Walk through the work-stealing algorithm step by step.
- Reason about syscall behaviour: when the M is blocked, when it is not, what `sysmon` does.
- Use `GODEBUG` knobs effectively.
- Choose `GOMAXPROCS` for containerised, multi-tenant, or NUMA environments.
- Identify scheduler-induced latency in your service.

---

## Run Queues in Detail

Each P has two structures for runnable goroutines:

### Local run queue

A 256-slot ring buffer (`runq` in the `p` struct). Lock-free for the owning M: push and pop are CAS operations. Other M's can steal from it but use the same primitives.

```
runq: [G1] [G2] [G3] [G4] ... [G256]
        ^                            ^
       head                         tail
```

Pushes go to the tail; the owning M pops from the head. Stealers pop from the head too (FIFO from the steal point).

### Local run-next slot

A single slot (`runnext` in `p`) reserved for the most recently spawned goroutine.

When you do `go f()`, the new goroutine is placed in `runnext`, not in `runq`. The current M will pick it up next, before going back to `runq`. This is the "spawn locality" optimisation: a freshly spawned goroutine tends to be related to the current work, so running it next maximises cache locality.

If `runnext` is already occupied, the previous occupant is moved to `runq`.

### Global run queue

A single global queue (`sched.runq`) protected by a lock. Used when:

- A P's local queue is full (overflow goes to the global queue).
- A goroutine becomes runnable from an M with no P (e.g., after a syscall returns).
- Sysmon takes G's from idle P's to redistribute.

The scheduler tries to avoid touching the global queue (it requires the global lock). M's check it only periodically — once every 61 schedule iterations, by `(sched.schedtick % 61) == 0`.

### When goroutines move

A new G goes to:

- `p.runnext` (most common).
- `p.runq` (if `runnext` is full).
- Global queue (if `runq` is also full, i.e., > 256 in flight on one P).

A blocked G goes to:
- A waiting state, tracked by whatever blocked it (channel's wait queue, mutex's wait queue, netpoll's poll list).

When unblocked, the G goes to:
- The waker's P's `runq` if there is space.
- The global queue otherwise.

---

## Work Stealing Protocol

When an M finishes its current G and the P's local queue is empty, the M tries (in order):

### 1. Check global queue

`runqget` — try to take a few G's from the global queue. The `M` takes up to `min(globalSize/GOMAXPROCS + 1, capacity)`, moving them into the local queue.

### 2. Check netpoll

If no other M is currently polling, try a non-blocking netpoll. Returns any ready goroutines.

### 3. Try to steal from another P

`findrunnable` picks 4 random P's and tries to steal half their queue each. Steal target is half of the victim's queue to balance load.

The exact algorithm:

```
for i := 0; i < 4; i++ {
    victim := random P
    if !victim.runq.empty() {
        n := min(victim.runq.len() / 2, 256)
        steal n G's from victim.runq.head
        put them in local runq
        return one to run
    }
}
```

After 4 attempts, if no steal succeeded, fall through to checking netpoll blockingly and then parking.

### 4. Blocking netpoll

`netpoll(true)` — block on `epoll_wait` (or platform equivalent) until I/O is ready. Returns any newly runnable goroutines.

### 5. Park the M

If all the above fail, the M parks itself. `sched.nmidle++`. When a goroutine becomes runnable somewhere else, the scheduler wakes a parked M.

### Why steal half, not one?

Stealing one G means the stealer has to come back to the same victim repeatedly. Half is enough to give the stealer significant local work and reduces back-and-forth.

### Why pick randomly?

Round-robin would create patterns under contention; random spreads pressure evenly.

---

## Syscalls and the M Pool

A syscall is a call into the OS kernel. Some syscalls block (e.g., `read` on a regular file, `accept` on a non-listening socket). The M making the syscall is blocked too.

### Cooperative entry

Before a syscall, the runtime calls `entersyscall`:

1. Save state.
2. Mark the M as "in syscall."
3. Detach the P from the M? Not yet. The P stays attached during a short syscall.

### sysmon retake

If `sysmon` notices an M has been in a syscall for more than 20 µs (default), it forcibly detaches the P:

1. `sysmon` sets the P to "idle" or hands it to another waiting M.
2. The original M continues its syscall without a P.

### Exit

When the syscall returns, the runtime calls `exitsyscall`:

1. If the M's P is still attached (fast path, short syscall): just continue with that P.
2. Else (P was retaken): try to acquire any free P; if none, the current G is put on the global queue and the M parks.

### M pool

M's are pooled. After a syscall-driven detach, the original M:

- Acquires another P if available, continues running.
- Else parks. Stays in the pool. Reused for future syscalls.

The pool prevents unbounded M creation. In stable state, the M count equals `GOMAXPROCS + concurrent-syscall-count + a few`.

### When to worry

For network I/O — not at all. Network reads are handled by netpoll, not syscalls.

For file I/O — yes. Each blocking file read may temporarily consume an M. Under heavy file I/O load, the M count can spike.

For Cgo — yes. Cgo calls hold M's for their entire duration.

---

## The Network Poller

The network poller is the key to Go's I/O concurrency story.

### How it works

When you call `conn.Read(buf)` on a `net.Conn`:

1. The underlying file descriptor is set to non-blocking.
2. `read()` syscall is attempted. If it returns immediately with data, fine.
3. If it returns `EAGAIN` (would block), the runtime:
   - Registers the FD in epoll for read events.
   - Parks the goroutine.
   - Returns to the scheduler.
4. The M continues running other goroutines.
5. When the FD becomes readable, epoll notifies the runtime.
6. The runtime wakes the parked goroutine.
7. The goroutine's M picks it up; `Read` retries the syscall, this time getting data.

From the user's perspective, `conn.Read(buf)` looks synchronous. The runtime does the asynchronous dance.

### Why this matters

Without netpoll, each blocked socket would consume an M (an OS thread). 10 000 idle WebSocket connections = 10 000 threads = OS thread exhaustion.

With netpoll, those 10 000 goroutines are parked, consuming only ~2 KB stack each. The M's are free to run active goroutines.

### Cost

Netpoll is cheap. Registering an FD is one syscall; epoll_wait is fast. Per-event cost is comparable to other event-loop systems (libuv, Tokio).

### Limitations

- File I/O does not go through netpoll on most platforms. It is a real syscall.
- Cgo I/O bypasses netpoll. The M is held.
- DNS resolution sometimes uses syscalls (depending on resolver).
- Very high-rate I/O (millions of events/sec) may hit netpoll limits.

---

## Sysmon Responsibilities

`sysmon` is a special M that runs without a P. It is started once at runtime initialisation and runs forever. Its loop wakes up periodically (every ~20 µs initially, backing off to 10 ms when idle) to perform:

### Retake P's from blocked syscalls

If an M has been in a syscall for more than 20 µs, sysmon detaches its P and gives it to another (parked or newly created) M.

### Preempt long-running goroutines

If a G has been running on its M for more than 10 ms, sysmon sets `g.preempt = true`. The next scheduling check (or an async-preemption signal) will switch to another G.

In Go 1.14+, sysmon also sends a `SIGURG` signal to the M, forcing asynchronous preemption regardless of the G's cooperation.

### Force-park M's

If an M has been spinning (looking for work) for too long without finding any, sysmon parks it to reduce CPU usage.

### Trigger garbage collection

If the GC heuristic decides a cycle should start, sysmon kicks it off if no other M has done so.

### Poll the network

When all M's are busy and netpoll has not been done recently, sysmon does a quick non-blocking poll to wake any I/O-ready goroutines.

### Run finalisers

If finalizers are pending, sysmon ensures the finalizer goroutine runs.

Sysmon's design — a P-less M acting as a watchdog — is what lets the scheduler stay responsive even under adversarial workloads.

---

## Preemption Modes

A goroutine can be preempted in three ways:

### 1. Cooperative (at function entry)

The Go compiler inserts a check at each function entry: is `g.preempt` set? If so, yield. This is the original preemption mechanism (Go 1.0–1.13).

Limitation: a tight loop with no function calls is uninterruptible.

### 2. Asynchronous (since Go 1.14)

Sysmon sends `SIGURG` to an M whose G has been running too long. The signal handler examines the G's PC, finds a safe point (one of the runtime's signal-safe points), and yields.

Asynchronous preemption requires:
- Signals (works on Unix; on Windows, via APC).
- The runtime knowing all stack frames (so it can deduce the safe point).

This makes Go 1.14+ effectively preemptive for almost all code.

### 3. Voluntary (`runtime.Gosched`)

Explicit yield. Rarely needed in modern Go.

### What preemption does

When preempted, the G is moved from running to runnable (back on the queue). Another G takes the M. The preempted G will run again when the scheduler picks it up.

### Preemption and `LockOSThread`

A goroutine locked to its OS thread is still preemptible (the scheduler can switch in another G on the same thread). But the locking goroutine will only resume on that thread.

---

## GOMAXPROCS Tuning in Practice

The default (`runtime.NumCPU()`) is usually right. Cases where you might tune:

### Containers without proper CPU reporting

Docker may not report cgroup CPU limits to the Go runtime, especially older Docker + older Go. Symptoms:

- `runtime.NumCPU()` returns host's logical CPU count, not the container's quota.
- Goroutines compete for time slices in the container; scheduler thinks it has more cores than it does.
- Throughput degrades; latency rises.

Fix:
- Go 1.21+ detects cgroup CPU quota natively (`GOMAXPROCS` defaults match).
- Earlier Go versions: use `github.com/uber-go/automaxprocs` to set `GOMAXPROCS` from cgroup info at startup.

### Multi-tenant servers

If your Go service runs on a host with other Go services, you may want to cap `GOMAXPROCS` below `NumCPU` to avoid hogging. Each service competes only for its allocated cores.

### NUMA tuning

On multi-socket servers, you may run one Go process per socket, each with `GOMAXPROCS` = local cores. Use `numactl --cpunodebind=N --membind=N` to keep memory local. The Go runtime is NUMA-unaware, so this is per-process partitioning.

### CPU-bound benchmarking

For reproducible benchmarks, set `GOMAXPROCS` explicitly:

```bash
GOMAXPROCS=1 go test -bench .
```

To compare single-core vs multi-core behaviour.

### Avoid setting it in libraries

A library that calls `runtime.GOMAXPROCS(...)` clobbers the caller's setting. Don't.

### Programmatic tuning

```go
runtime.GOMAXPROCS(4)
```

The returned value is the previous setting. Setting to 0 returns current without changing.

---

## The Scheduler's Effect on Latency

The scheduler affects request latency in subtle ways:

### Long preemption

In Go pre-1.14, a tight loop could starve other goroutines until the next safe point (function call). Latency spikes.

In Go 1.14+, async preemption fires every ~10 ms, so latency spikes are capped at ~10 ms even under bad citizenship.

### GC stop-the-world (STW)

Garbage collection has a brief STW phase (~100 µs in modern Go for typical heaps). All goroutines pause. Latency-sensitive services notice; high-traffic services have it factored into their P99.

### Scheduler queueing

Under heavy load, a goroutine waiting on a busy P's queue waits behind others. If `runq` is full and the global queue is being drained slowly, latency grows.

### Syscall blocking

A blocking syscall in a request handler:
- Holds an M.
- Sysmon may retake the P (good — other goroutines keep running).
- But the request itself is stuck until the syscall returns.

### Channel ops on contended channels

A `select` on many channels, each contended, has overhead. The scheduler must lock all channels, choose, unlock, possibly park.

### M creation

If all M's are busy and a new one is needed (e.g., new goroutine, syscall in progress), the runtime creates one. M creation is `clone()` — a syscall — costing tens of microseconds.

To avoid surprises, keep an eye on `sched.gomaxprocs`, `sched.nmsys`, and `sched.nmidle` via `runtime/metrics`.

---

## Diagnosing Scheduler Issues

### Symptom: high latency under load

Possible causes:

- GC pause too long. Look at `runtime.MemStats.PauseTotalNs`.
- Insufficient P's. Try increasing `GOMAXPROCS`.
- Long-running goroutines blocking others (rare in 1.14+).
- Contention on a hot channel or mutex.

Diagnostic:

```bash
go test -trace trace.out -bench .
go tool trace trace.out
```

The trace shows per-P timelines: gaps mean idle, clusters mean contention.

### Symptom: goroutine count exploding

Cause: leak. Some goroutine spawns more without exit.

Diagnostic:

```bash
curl http://localhost:6060/debug/pprof/goroutine?debug=1 > goroutines.txt
```

Look for many goroutines at the same call stack. That is the leak source.

### Symptom: high CPU but low throughput

Possible causes:

- Lock contention. Use `runtime.SetMutexProfileFraction(1)` and `pprof -mutex`.
- False sharing on shared data.
- GC pressure. Reduce allocation.
- Lots of context switches. Use `go tool trace` and look at switch density.

### Symptom: throughput plateaus despite more cores

Possible causes:

- Amdahl: too much serial work.
- Memory bandwidth saturation.
- Lock or atomic contention.
- Inter-core cache invalidation (false sharing).
- Network or disk bottleneck.

Profile, identify, fix.

### Symptom: container performance worse than host

Almost always `GOMAXPROCS` mismatch with CPU quota. Fix with `automaxprocs` or Go 1.21+.

---

## Self-Assessment

- [ ] I can describe the structure of a P's local run queue.
- [ ] I can walk through the work-stealing algorithm.
- [ ] I know what happens when a goroutine calls a blocking syscall.
- [ ] I know what netpoll does and why it matters.
- [ ] I can list at least three things sysmon does.
- [ ] I can describe the difference between cooperative and asynchronous preemption.
- [ ] I have set `GOMAXPROCS` explicitly with a reason.
- [ ] I have read a `GODEBUG=schedtrace` output and explained what it says.
- [ ] I have diagnosed a scheduler-related performance issue.
- [ ] I have used `go tool trace` to look at scheduler behaviour.

---

## Summary

The Go scheduler is built on layered mechanisms: per-P local run queues for cache-friendly distribution, work stealing for load balancing, the global queue as a fallback, the network poller for I/O concurrency, and sysmon for background maintenance. Each goroutine flows through the system: spawned into a `runnext` slot or queue, run on an M holding a P, possibly stolen, possibly preempted, possibly parked on I/O, eventually exited.

`GOMAXPROCS` is the dial that controls how many P's exist. Defaults work in 90% of cases; containers and multi-tenant servers occasionally need tuning. Modern Go (1.14+) handles tight CPU loops via async preemption; older versions can be starved.

For diagnosis, your tools are `GODEBUG=schedtrace`, `pprof goroutine`, `runtime.NumGoroutine`, and `go tool trace`. They show scheduler state, goroutine distribution, and the timeline of events.

The senior view (next file) treats the scheduler as a system-design constraint. The professional view dives into the runtime internals — `g`, `m`, `p` structs, sysmon details, async preemption — for those who need to peek inside.
