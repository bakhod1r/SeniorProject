# Syscall Handling — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [The `entersyscall` / `exitsyscall` Flow](#the-entersyscall--exitsyscall-flow)
3. [Sysmon's 10 µs Handoff Trigger](#sysmons-10-µs-handoff-trigger)
4. [Network vs Blocking: Side-by-Side Comparison](#network-vs-blocking-side-by-side-comparison)
5. [The Netpoller at the API Boundary](#the-netpoller-at-the-api-boundary)
6. [The `_Psyscall` State](#the-_psyscall-state)
7. [Fast Path vs Slow Path in `exitsyscall`](#fast-path-vs-slow-path-in-exitsyscall)
8. [Cgo as a Special Syscall](#cgo-as-a-special-syscall)
9. [`entersyscallblock`: the "I Will Definitely Block" Variant](#entersyscallblock-the-i-will-definitely-block-variant)
10. [VDSO Fast Calls](#vdso-fast-calls)
11. [`LockOSThread` Meets Syscalls](#lockosthread-meets-syscalls)
12. [What File I/O Actually Does on Linux](#what-file-io-actually-does-on-linux)
13. [Thread Count Prediction for Real Workloads](#thread-count-prediction-for-real-workloads)
14. [Reading Scheduler Traces](#reading-scheduler-traces)
15. [Profiling Syscall-Heavy Code](#profiling-syscall-heavy-code)
16. [Common Anti-Patterns and Their Fixes](#common-anti-patterns-and-their-fixes)
17. [Self-Assessment](#self-assessment)
18. [Summary](#summary)

---

## Introduction

At middle level you stop using the runtime as a black box and start *predicting* its behaviour. Given a piece of code, you can say: "this will spawn N Ms under load", "this will hand off P every iteration", "this will not scale past 8 concurrent calls". You can read scheduler traces and pprof output and tell whether the syscall path is the bottleneck.

This page builds on the [junior overview](junior.md). We now walk through `entersyscall`/`exitsyscall` with enough detail that you could implement a simplified version. We compare network and blocking paths in concrete tables. And we dig into cgo because it is the most common source of thread-count surprises in production.

---

## The `entersyscall` / `exitsyscall` Flow

The Go compiler inserts calls to `runtime.entersyscall` before each blocking syscall and `runtime.exitsyscall` after. This is done in the assembly stubs in `runtime/sys_linux_amd64.s` (and the other arch/OS pairs). When you write:

```go
n, err := syscall.Read(fd, buf)
```

…the generated code is approximately:

```
entersyscall()
// CPU switches to kernel mode via SYSCALL instruction
read(2)
// kernel returns
exitsyscall()
```

### `entersyscall` step-by-step

1. **Save the goroutine's PC and SP.** The runtime stores `gp.syscallpc` and `gp.syscallsp` for later inspection (e.g., by sysmon or by stack traces).
2. **Mark the G as in-syscall.** `casgstatus(gp, _Grunning, _Gsyscall)`.
3. **Detach the P from the M.** `pp.m = 0; m.p = 0; m.oldp = pp`.
4. **Mark the P as in-syscall.** `atomic.Store(&pp.status, _Psyscall)`.
5. **Notify sysmon if asleep.** If `sched.sysmonwait` is set, wake sysmon so it can monitor the handoff.

After `entersyscall`, the M proceeds into the kernel via the actual SYSCALL instruction. The P is now sitting "with" the M (referenced via `oldp`) but flagged as available for handoff.

### `exitsyscall` step-by-step

When the kernel returns:

1. **Try the fast path.** `exitsyscallfast(oldp)`:
   - If `oldp` is still in `_Psyscall` state (no handoff happened): CAS it back to `_Prunning`, re-attach. Done.
   - If `oldp` is now `_Pidle` (handed off but not yet picked up): try to grab any P. If the runtime has a hint that we should resume on `oldp`, prefer it.
2. **Fast path succeeded?** Mark `_Gsyscall` → `_Grunning`. Return; goroutine resumes normally.
3. **Fast path failed?** Take the slow path: `mcall(exitsyscall0)`.
   - The G is put on a runqueue (preferring oldp if it exists).
   - The M parks itself in the M pool.
   - Eventually another M picks up the G and continues it.

The fast path is the common case for short syscalls. The slow path triggers when sysmon already handed off — typically because the syscall took > 10 µs.

### Why the dance?

The whole point is to **release the P** so other goroutines can run. The M is necessarily stuck in the kernel for the duration of the syscall — there is nothing the runtime can do about that. But the P (and its runqueue of pending goroutines) can be rescued.

This is the core insight of the Go scheduler: P is the unit of "permission to run Go code", and Ps can be moved between Ms.

---

## Sysmon's 10 µs Handoff Trigger

`sysmon` is launched at startup as a special goroutine with its own M (no P). It loops:

```go
// runtime/proc.go (paraphrased)
func sysmon() {
    for {
        usleep(delay)
        now := nanotime()
        // ... preempt checks ...
        retake(now)
    }
}
```

Inside `retake`:

```go
for i := 0; i < len(allp); i++ {
    pp := allp[i]
    s := pp.status
    if s == _Psyscall {
        // P has been in syscall. How long?
        t := int64(pp.syscalltick)
        if pp.syscallwhen + 10*1000 < now { // 10 µs threshold
            if atomic.Cas(&pp.status, _Psyscall, _Pidle) {
                handoffp(pp)
            }
        }
    }
}
```

The threshold is **10 microseconds**. If a P has been in `_Psyscall` longer than that, sysmon CAS-flips it to `_Pidle` and calls `handoffp(pp)`.

### What `handoffp` does

`handoffp` decides whether to park the P or hand it to an M:

```go
func handoffp(pp *p) {
    // Has runnable work?
    if !runqempty(pp) || sched.runqsize != 0 {
        startm(pp, true)  // spin up an M for this P
        return
    }
    // GC needed?
    if gcBlackenEnabled != 0 && gcMarkWorkAvailable(pp) {
        startm(pp, true)
        return
    }
    // Has cgocalls in progress that need polling?
    // ... other special cases ...
    // Otherwise: put P on idle list.
    pidleput(pp)
}
```

`startm(pp, spinning)` either wakes a parked M from `sched.midle` or calls `newm` (which calls `clone(2)`) to create a new one. The new M starts at `mstart` and immediately enters the scheduler loop, where it picks `pp` and starts running goroutines from `pp.runq`.

### Why 10 µs?

A balance:

- **Lower threshold** (say, 1 µs): more aggressive handoff. Better latency for waiting goroutines on the P. But more M creation and handoff overhead.
- **Higher threshold** (say, 100 µs): cheaper. But a P that is "almost done with its syscall" might never get handed off, even if other goroutines on its runqueue are starving.

10 µs is roughly: "long enough that handoff overhead is justified, short enough that the P does not sit idle for many cycles."

You can sometimes affect this with `GODEBUG=schedtrace` and the older (deprecated) flags, but in modern Go the threshold is fixed.

---

## Network vs Blocking: Side-by-Side Comparison

The single most useful diagram in this entire page:

| Property | Network (netpoller) | Blocking syscall (handoff) |
|---|---|---|
| Entry point | `internal/poll.FD.Read` etc. | `syscall.Read` directly |
| Underlying syscall | `read` on non-blocking fd, returns `EAGAIN` if not ready | `read` on regular fd, blocks until ready |
| `entersyscall` called? | No | Yes |
| M held during wait? | No (goroutine parks via `gopark`) | Yes (M is in kernel) |
| P handed off? | N/A (M was never blocked) | Yes, by sysmon, after 10 µs |
| Wakeup mechanism | `epoll_wait`/`kqueue`/`IOCP` poll | Kernel returns from syscall |
| Cost per "wait" | ~zero (one entry in netpoller table) | One M held + handoff machinery |
| Scales to | Millions of fds | Bounded by M count (effectively thousands) |
| Example calls | `conn.Read`, `conn.Write`, `<-chan` (timer), `<-time.After` | `os.Open`, `os.ReadFile`, `os.exec.Cmd.Run`, `syscall.Flock`, `unix.Setns` |
| GOOS-specific implementation | `epoll` (Linux), `kqueue` (BSD/macOS), `IOCP` (Windows) | Direct `syscall(2)` |
| Bypass available? | Yes, on edge cases — read non-blocking yourself | Yes, but rare — most code uses the standard library |
| Scheduler dilemma | None — M is free | Trade off: hand off the P (cost) vs let it sit idle (latency) |

The takeaway: **prefer netpoller-backed APIs whenever you have a choice**. Network sockets, pipes (sometimes), and timers go through the netpoller. Files, signals, and most cgo calls do not.

---

## The Netpoller at the API Boundary

Standard-library APIs that use the netpoller (you do not have to do anything):

- `net.Conn.Read`/`Write` (TCP, UDP, Unix sockets)
- `net.Listener.Accept`
- `os.Pipe` reads on Unix when fd is set non-blocking (caveat: standard `os.File` does not always set non-blocking on pipes; YMMV)
- `time.After`, `time.Sleep`, `time.NewTimer` (the runtime's timer heap is netpoller-integrated)
- `<-chan` is netpoller-integrated when timeouts/timers are involved

Standard-library APIs that go through the blocking syscall path:

- `os.File.Read`/`Write` on regular files
- `os.Open`, `os.Create`, `os.Remove`
- `os/exec.Cmd.Run`, `Cmd.Wait`
- `syscall.*` on regular fds
- `unix.Flock`, `unix.Setns`, etc.

There is a small gray zone: some character devices, named pipes, and ttys *can* be set non-blocking and would integrate with the netpoller, but the standard library's `os.File` does not always set them up that way. If you have a use case for non-blocking file fds (rare), you can call `syscall.SetNonblock` and use the polling APIs directly.

### The hidden netpoller call sites

```
internal/poll/fd_unix.go: FD.Read       -> ignoringEINTRIO -> syscall.Read (non-blocking)
                                        -> EAGAIN          -> fd.pd.waitRead
                                        -> waitRead        -> runtime_pollWait
                                        -> runtime_pollWait-> netpollblock
                                        -> netpollblock    -> gopark
```

By the time you arrive at `gopark`, the goroutine is going to sleep. The M is free. `gopark` is the runtime's universal "stop this G" primitive — used by channels, locks, timers, and the netpoller.

---

## The `_Psyscall` State

A P has these states (from `runtime/runtime2.go`):

```go
const (
    _Pidle     = iota // no M attached
    _Prunning         // M attached, running Go code
    _Psyscall         // M attached but in a syscall
    _Pgcstop          // halted for GC
    _Pdead            // unused / decommissioned (rare)
)
```

`_Psyscall` is the *only* state where the P is "attached" to an M that is unable to run Go code. The runtime treats it specially:

- Sysmon checks for `_Psyscall` Ps and may hand them off.
- Work stealing skips `_Psyscall` Ps for stealing from (the M might come back any moment).
- GC accounting treats them as in-progress.

When `exitsyscall` runs, the P transitions:

- `_Psyscall` → `_Prunning` (fast path: re-attach succeeded).
- `_Psyscall` → `_Pidle` → `_Prunning` (sysmon already handed off; new M picked up).

When the syscalling M parks (slow path with no P available), the P does not change because the P has already moved on to another M.

---

## Fast Path vs Slow Path in `exitsyscall`

`exitsyscall` lives in `runtime/proc.go`. Two paths:

### Fast path (`exitsyscallfast`)

```go
func exitsyscallfast(oldp *p) bool {
    // Try oldp first.
    if oldp != nil && oldp.status == _Psyscall {
        if atomic.Cas(&oldp.status, _Psyscall, _Pidle) {
            // We won the race. Reacquire as our P.
            acquirep(oldp)
            return true
        }
    }
    // oldp is gone. Try sched.pidle.
    if sched.pidle != 0 {
        var ok bool
        systemstack(func() {
            ok = exitsyscallfast_pidle()
        })
        if ok {
            return true
        }
    }
    return false
}
```

This runs entirely in user space, no scheduler entry needed. ~50–100 ns.

### Slow path (`exitsyscall0`)

```go
func exitsyscall0(gp *g) {
    casgstatus(gp, _Gsyscall, _Grunnable)
    dropg()
    var pp *p
    if schedEnabled(gp) {
        pp, _ = pidleget(0)
    }
    if pp == nil {
        globrunqput(gp)
    } else if atomic.Load(&sched.sysmonwait) != 0 {
        atomic.Store(&sched.sysmonwait, 0)
        notewakeup(&sched.sysmonnote)
    }
    if pp != nil {
        acquirep(pp)
        execute(gp, false)
    }
    if mp.lockedg != 0 {
        // We are pinned to a G.
        stoplockedm()
        execute(gp, false)
    }
    stopm()
    schedule()
}
```

The G is requeued (preferring local runqueue if a P is available; otherwise global). The M parks via `stopm`. Eventually another M picks up the G.

Cost: ~1 µs of bookkeeping plus the cost of waking another M to pick up the G.

### When does fast fail?

Mostly when sysmon hands off `oldp` before `exitsyscall` runs. That requires the syscall to take > 10 µs *and* sysmon's poll to fire in that window. For a `read` on a fast SSD, this rarely happens. For a `read` from a network filesystem or a slow disk, it happens routinely.

---

## Cgo as a Special Syscall

Each cgo call (`C.foo()`) is structurally similar to a syscall but with extras. The runtime wraps it in `runtime.cgocall`:

```go
func cgocall(fn, arg unsafe.Pointer) int32 {
    // ... gp setup ...
    mp.incgo = true
    mp.ncgo++
    entersyscall()
    errno := asmcgocall(fn, arg)
    // C function returned
    exitsyscall()
    mp.incgo = false
    return errno
}
```

So cgo:

1. Marks the M as "in cgo" (`m.incgo = true`).
2. Calls `entersyscall` — same as a regular syscall: P detaches, can be handed off.
3. Calls `asmcgocall(fn, arg)` (assembly), which switches to the M's `g0` system stack and calls the C function.
4. C function runs. Could take 1 ns, could take 1 hour.
5. When C returns, `exitsyscall` runs — same fast/slow path logic.

### Differences from a regular syscall

- **Different stack.** C runs on the M's `g0` stack (separate from goroutine stacks), so stack growth is irrelevant during the call. C must not allocate Go memory.
- **Signal handling.** Signals delivered during a cgo call go through the Go signal handler if installed; this can cause weird interactions.
- **GC.** Memory pointed to by Go that crosses into C must be pinned (Go 1.17+ with `runtime.Pinner`); otherwise GC may move it. Pre-pinned versions used `cgo.Handle`.

### M-creation storm

Many cgo calls in parallel == many Ms held. If your service does `C.compress(buf)` once per request and each takes 50 ms:

- 100 RPS, 50 ms per call → 5 concurrent calls average → 5 Ms held.
- 1000 RPS → 50 Ms held.
- 10 000 RPS → 500 Ms held. Each M is ~8 MB of stack reservation, ~few KB resident. Total: tens of MB of thread state, plus context-switch cost.

Mitigations:

- **Bound cgo concurrency** with a semaphore.
- **Batch** multiple Go work units into one cgo call.
- **Move cgo to a goroutine pool** so calls reuse the same Ms.

We expand this in [senior.md](senior.md) and [optimize.md](optimize.md).

### Cgo and `LockOSThread`

A locked goroutine doing cgo holds its M exclusively, *and* that M is in cgo, *and* the P is detached. So:

- The P is recyclable (good).
- The M is unavailable for other Go work after the cgo call returns (because of the lock).
- If the locked G exits while still locked, the M is destroyed by the runtime.

For long-lived locked goroutines (e.g., OpenGL render thread, CUDA worker), this is the desired behaviour.

---

## `entersyscallblock`: the "I Will Definitely Block" Variant

`runtime.entersyscallblock` is the optimistic-pessimistic cousin of `entersyscall`. It is used when the runtime *knows* the syscall will block for a while. Calls:

- `runtime.notetsleep` (with infinite wait)
- `runtime.semasleep`
- Some signal-related blocking calls

The difference: `entersyscallblock` immediately hands off the P (via `handoffp`) instead of waiting for sysmon to do it 10 µs later. This is a small latency win when you know the syscall will be slow.

```go
func entersyscallblock() {
    gp := getg()
    // ... save state ...
    casgstatus(gp, _Grunning, _Gsyscall)
    // Pre-emptively hand off the P.
    pp := gp.m.p.ptr()
    pp.syscalltick++
    pp.m = 0
    gp.m.p = 0
    gp.m.oldp.set(pp)
    handoffp(pp) // do not wait for sysmon
    // Now make the syscall.
}
```

When this matters: a `select` on a channel with no ready cases parks via `entersyscallblock` (effectively), so other goroutines get the P immediately rather than waiting 10 µs for sysmon. The runtime is quite careful about which paths use which variant.

You will rarely call `entersyscallblock` from your own code (the runtime calls it for you on internal blocking primitives). But knowing it exists explains why some blocking operations have zero handoff latency.

---

## VDSO Fast Calls

The **VDSO** (Virtual Dynamic Shared Object) is a small shared library that the Linux kernel maps into every process's address space. It contains user-mode implementations of a few syscalls that can be answered without entering kernel mode:

| Syscall | VDSO? | Implementation |
|---|---|---|
| `clock_gettime` | Yes | Reads a shared memory page where the kernel writes the current time. |
| `gettimeofday` | Yes | Same. |
| `getcpu` | Yes | Reads from a per-CPU shared page. |
| `time` | Yes | Coarse version of gettimeofday. |
| `read`, `write`, `open` | No | Real syscalls. |

The Go runtime detects the VDSO at startup and uses the VDSO entries directly. For example, `runtime.nanotime` calls `clock_gettime(CLOCK_MONOTONIC)` via VDSO, which takes ~20 ns. No `entersyscall` is invoked because there is nothing to enter — the call never touches the kernel.

### Why this matters at middle level

You will see `time.Now()` and `time.Since()` used liberally in production code. People sometimes worry about their cost. On modern Linux, the cost is ~20 ns — comparable to a function call. On older kernels or unusual platforms (FreeBSD without VDSO, some VMs), the cost could be ~1 µs. Measure if it matters.

Other implications:

- Profiling: VDSO calls are invisible to `strace`. They look like ordinary user-mode code.
- Containers: the VDSO must be present and accessible. Some hardened containers strip it. In that case `time.Now()` falls back to a real syscall.

---

## `LockOSThread` Meets Syscalls

`runtime.LockOSThread` pins the calling goroutine to its M. Combined with syscalls:

**Case 1: Locked G does a fast syscall.**

The M enters and exits the kernel quickly. The P may or may not be handed off (depends on duration). When the syscall returns, the M re-attaches and continues with the locked G. Standard behaviour.

**Case 2: Locked G does a slow syscall.**

The M is in the kernel for a long time. The P is handed off. When the M returns:

- `exitsyscall` tries to re-attach. It must find a P for the locked G.
- If no P available, the M parks. The locked G goes back on a runqueue.
- The locked G can *only* be resumed by its locked M. So the runqueue waits for that M to wake up.

This can deadlock under pressure. Imagine `GOMAXPROCS=4` and 4 goroutines all locked to Ms in slow syscalls. There are 4 Ms in the kernel, 0 Ms available to run other goroutines. The 4 Ps are sitting idle (sysmon handed them off, but no M to take them up). Other goroutines starve.

In practice this rarely happens because:

- Few goroutines call `LockOSThread`.
- The runtime spawns Ms aggressively (up to a hard cap of 10000 Ms by default; see `runtime.SetMaxThreads`).

But it is a real failure mode for OpenGL apps or services that lock many goroutines.

**Case 3: Locked G does a netpoller-friendly call.**

`net.Conn.Read` from a locked goroutine: the G parks via the netpoller. The M is now free of work. But the M cannot pick up other goroutines because it is locked. So the M sits idle — bad use of a thread.

This is rarely a good combination. If you lock a G, do not have it block on the network unless you have a specific reason.

---

## What File I/O Actually Does on Linux

Tracing `os.ReadFile` on Linux:

```
os.ReadFile -> os.Open -> sys.openat
                              -> entersyscall
                              -> SYSCALL openat
                              -> exitsyscall

os.ReadFile -> io.ReadAll -> file.Read -> sys.read
                                            -> entersyscall
                                            -> SYSCALL read
                                            -> exitsyscall
                            (repeat until EOF)

os.ReadFile -> file.Close -> sys.close
                              -> entersyscall
                              -> SYSCALL close
                              -> exitsyscall
```

Each syscall is a potential handoff point. For a small file in the page cache, every syscall returns in ~1 µs and the fast path of `exitsyscall` is always taken. No handoff happens. Thread count does not change.

For a large file from cold disk:

- `openat` is usually fast (metadata cached).
- The first `read` takes ~5–50 ms (disk seek). Sysmon hands off the P. Another M comes in.
- Subsequent `read`s are faster (readahead). May or may not trigger handoff.

This is why a workload reading 1000 small files behaves very differently from one reading 100 huge ones. The first does little handoff; the second triggers it constantly.

### `O_NONBLOCK` on regular files

You can open a regular file with `O_NONBLOCK`, but on Linux this is essentially a no-op for the read path. The kernel ignores `O_NONBLOCK` on regular files for `read`/`write`. So you cannot route file I/O through the netpoller this way.

`io_uring` (kernel 5.1+) would solve this, but the Go runtime does not use it yet.

---

## Thread Count Prediction for Real Workloads

A useful exercise: given a workload description, predict the thread count.

**Workload A: HTTP server with 5 000 concurrent connections, no cgo, no file I/O.**

- 5 000 goroutines parked in the netpoller.
- ~ `GOMAXPROCS` Ms doing work + maybe 1–2 idle Ms + sysmon + GC.
- Expected: 10–20 threads.

**Workload B: Same server but each request reads a 10 KB file from disk.**

- 5 000 concurrent reads. If reads take ~1 ms, ~5 simultaneous reads in flight on average.
- 5 Ms in kernel + ~`GOMAXPROCS` running + idle Ms + sysmon.
- Expected: 15–25 threads.

**Workload C: Same server but each request makes a 50 ms cgo call.**

- 5 000 concurrent cgo calls. 50 ms each → up to 5 000 Ms briefly.
- Without bounding, you could see hundreds-to-thousands of threads.
- With a semaphore limiting cgo concurrency to N=32: ≤ 32 Ms in cgo + ~`GOMAXPROCS` + idle.
- Expected: 40–60 threads.

**Workload D: 100 goroutines that all call `LockOSThread` and sleep 1 second.**

- 100 locked Ms, all parked.
- Expected: 100+ threads. Memory pressure rises (each thread is ~8 MB virtual + ~few KB resident).

**Workload E: Mostly idle service with occasional bursts.**

- Threads grow during bursts, shrink during idle. The M pool keeps up to ~64 parked Ms by default.
- Expected steady-state: 5–10 threads; bursty: 30–100.

You will get pretty good at this prediction with practice. The runtime is consistent.

---

## Reading Scheduler Traces

`GODEBUG=schedtrace=1000` gives you one line per second:

```
SCHED 1004ms: gomaxprocs=4 idleprocs=2 threads=11 spinningthreads=0 
              needspinning=0 idlethreads=5 runqueue=0 [0 2 0 0]
```

Each field:

| Field | Meaning |
|---|---|
| `gomaxprocs` | Number of Ps (`GOMAXPROCS`). |
| `idleprocs` | Ps in `_Pidle`. |
| `threads` | Total Ms (running + parked + in-syscall). |
| `spinningthreads` | Ms actively looking for work. |
| `needspinning` | Whether the runtime wants more spinning Ms. |
| `idlethreads` | Ms in the M pool (parked, available). |
| `runqueue` | Length of global runqueue. |
| `[a b c d]` | Per-P local runqueue lengths. |

If `threads` is much higher than `gomaxprocs + 5`, you have Ms in syscalls or cgo. Healthy.

If `threads` grows without bound, you have an M leak. Investigate cgo and `LockOSThread`.

Add `scheddetail=1` for very verbose output (every G, M, P with state). Use sparingly — gigabytes of logs on a busy server.

---

## Profiling Syscall-Heavy Code

Tools for diagnosing syscall behaviour:

### `go tool trace`

```bash
# Capture a trace
import "runtime/trace"
trace.Start(file)
// ... do work ...
trace.Stop()

# View
go tool trace trace.out
```

In the UI you can see per-goroutine timelines. Look for:

- "Syscall" segments (yellow). Long segments = slow syscalls.
- "Sched wait" (green). Time a G spent waiting for a P after exitsyscall.
- "GC" (red). Unrelated but visible.

### `pprof`

```bash
go tool pprof http://localhost:6060/debug/pprof/goroutine
```

In the interactive prompt: `top`, `tree`, `web`. Goroutines stuck in syscalls show up as `runtime.entersyscall` -> `runtime.read` -> `syscall.Syscall`. Many such goroutines = file I/O bottleneck.

### `strace`

```bash
strace -p $(pgrep myprogram) -c
```

Counts syscalls per type. If `read` dominates with 90% of time, you are file-bound. If `epoll_wait` dominates, you are network-bound (typical).

### `perf top -p <pid>`

Shows hot functions per thread. `runtime.entersyscall` showing up = lots of syscalls. `runtime.findrunnable` showing up = scheduler overhead.

---

## Common Anti-Patterns and Their Fixes

**Anti-pattern: Unbounded file I/O concurrency.**

```go
// Bad
for _, path := range paths {
    go func(p string) {
        data, _ := os.ReadFile(p)
        process(data)
    }(path)
}
```

If `paths` has 10 000 entries and each file takes 10 ms to read, you briefly have ~100 Ms in syscalls. Fix with a semaphore:

```go
sem := make(chan struct{}, 8) // disk parallelism ~ 8
for _, path := range paths {
    sem <- struct{}{}
    go func(p string) {
        defer func() { <-sem }()
        data, _ := os.ReadFile(p)
        process(data)
    }(path)
}
```

**Anti-pattern: Unbounded cgo concurrency.**

```go
// Bad
http.HandleFunc("/process", func(w, r) {
    result := C.expensive_call(input) // 100 ms
    w.Write(result)
})
```

Under load, thousands of Ms. Fix:

```go
var cgoSem = make(chan struct{}, 32)

http.HandleFunc("/process", func(w, r) {
    cgoSem <- struct{}{}
    defer func() { <-cgoSem }()
    result := C.expensive_call(input)
    w.Write(result)
})
```

**Anti-pattern: `LockOSThread` without explicit unlock.**

```go
// Bad
go func() {
    runtime.LockOSThread()
    forever() // never returns; M stuck
}()
```

If `forever()` returns or panics, the runtime tries to clean up but may destroy the M. Always:

```go
go func() {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread() // even if we don't expect to return
    forever()
}()
```

**Anti-pattern: Mixing `LockOSThread` with network I/O.**

```go
// Bad
runtime.LockOSThread()
defer runtime.UnlockOSThread()
conn.Read(buf) // parks G; M sits idle locked
```

Either don't lock, or don't do network calls from locked goroutines.

**Anti-pattern: Tiny cgo calls in hot loops.**

```go
// Bad: 1M cgo calls, each costing ~200 ns of overhead
for _, x := range xs {
    C.process_one(C.int(x))
}

// Good: 1 cgo call
C.process_many((*C.int)(unsafe.Pointer(&xs[0])), C.int(len(xs)))
```

---

## Self-Assessment

- [ ] I can walk through `entersyscall` and `exitsyscall` step by step.
- [ ] I know the 10 µs sysmon threshold and what it does.
- [ ] I can describe the netpoller vs blocking-syscall path differences without referring to notes.
- [ ] I know what `_Psyscall` state is and when a P enters/leaves it.
- [ ] I can predict thread count for a given workload.
- [ ] I know cgo holds an M for each call and how to bound it.
- [ ] I know about `entersyscallblock` and when the runtime uses it.
- [ ] I know VDSO calls bypass the syscall machinery.
- [ ] I can read `GODEBUG=schedtrace` output and diagnose anomalies.
- [ ] I can identify the main syscall anti-patterns and propose fixes.

---

## Summary

At middle level the syscall machinery becomes legible. Every blocking call goes through `entersyscall` (detach P, mark `_Psyscall`) and `exitsyscall` (fast path: reacquire `oldp`; slow path: park M). Sysmon polls every ~20 µs and forcibly hands off Ps stuck in syscalls for > 10 µs.

Network I/O bypasses the whole machinery: the netpoller uses non-blocking syscalls + `epoll`/`kqueue`/`IOCP` to park goroutines on file descriptors without holding any M. This is why 50 000 idle TCP connections cost no more thread state than 50.

Cgo behaves like a blocking syscall: each call holds an M. Bounding cgo concurrency is the most common production fix. `LockOSThread` interacts poorly with syscalls (the locked M cannot be recycled) and should be used sparingly.

VDSO calls (`time.Now()`, `clock_gettime`) do not touch the syscall path at all — they run entirely in user mode.

The senior level builds on this with production patterns: bounded I/O pools, cgo handoff strategies, and the architectural decisions that shape syscall behaviour across a service.
