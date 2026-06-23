# Syscall Handling — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [What Is a Syscall, in One Paragraph](#what-is-a-syscall-in-one-paragraph)
3. [The Question the Runtime Has to Answer](#the-question-the-runtime-has-to-answer)
4. [The Two Paths at a Glance](#the-two-paths-at-a-glance)
5. [Path A: Network — the Netpoller](#path-a-network--the-netpoller)
6. [Path B: Blocking Syscalls — the Handoff](#path-b-blocking-syscalls--the-handoff)
7. [Why a Blocked File Read Does Not Stall the Program](#why-a-blocked-file-read-does-not-stall-the-program)
8. [Pictures: Before, During, After a Syscall](#pictures-before-during-after-a-syscall)
9. [Words You Need: G, M, P, Syscall, Handoff](#words-you-need-g-m-p-syscall-handoff)
10. [The Cost of a Handoff in Plain Terms](#the-cost-of-a-handoff-in-plain-terms)
11. [Your First Demo: Many File Reads](#your-first-demo-many-file-reads)
12. [Your Second Demo: Many Network Reads](#your-second-demo-many-network-reads)
13. [Why the Netpoller Is Cheap and File I/O Is Not](#why-the-netpoller-is-cheap-and-file-io-is-not)
14. [Cgo as a Special Kind of Syscall](#cgo-as-a-special-kind-of-syscall)
15. [What sysmon Is Doing in the Background](#what-sysmon-is-doing-in-the-background)
16. [What "Fast Syscalls" Are](#what-fast-syscalls-are)
17. [What `LockOSThread` Has To Do With This](#what-lockosthread-has-to-do-with-this)
18. [Common Beginner Confusions](#common-beginner-confusions)
19. [Reading `GODEBUG=schedtrace`](#reading-godebugschedtrace)
20. [Counting Threads vs Goroutines](#counting-threads-vs-goroutines)
21. [Mini Experiments You Can Run Right Now](#mini-experiments-you-can-run-right-now)
22. [What Happens on Different Operating Systems](#what-happens-on-different-operating-systems)
23. [Tiny Mental Model](#tiny-mental-model)
24. [Worked Walkthrough: One `os.ReadFile` Call](#worked-walkthrough-one-osreadfile-call)
25. [Worked Walkthrough: One `conn.Read` Call](#worked-walkthrough-one-connread-call)
26. [Pitfalls That Already Cost Engineers Sleep](#pitfalls-that-already-cost-engineers-sleep)
27. [Glossary](#glossary)
28. [Self-Check](#self-check)
29. [Summary](#summary)

---

## Introduction

When you write `data, err := os.ReadFile("config.json")` in Go, your goroutine quietly asks the operating system for the file. The kernel reads from disk — perhaps slowly — and gives the bytes back. While that happens, the rest of your program keeps running. Other goroutines accept HTTP requests, do work, finish, and exit. Nothing stalls.

That smoothness is not free. Behind the line of code, the Go runtime is making several decisions: should it keep the OS thread blocked alongside the kernel? Or should it set the thread free to run other goroutines? Should it hand the work off to a different thread? At what cost?

This page is your first tour of how those decisions are made. By the end you will know:

- That Go has **two different paths** for syscalls — one cheap (the netpoller, used for sockets) and one slightly expensive (handoff, used for files and other blocking calls).
- Why the scheduler can keep running goroutines even while a thread is stuck in the kernel.
- The basic shape of `entersyscall` and `exitsyscall`.
- Why cgo costs you a thread, and roughly how much.
- How to count threads vs goroutines in your own programs.

You do not need to read runtime source for this level. We will name the functions and draw the pictures; the implementation details show up at middle and professional levels.

---

## What Is a Syscall, in One Paragraph

A **system call** (syscall) is the formal way a user-space program asks the kernel to do something it cannot do itself: open a file, write to a socket, allocate memory, fork a process. The CPU has a special instruction (`syscall` on x86-64, `svc` on ARM64) that switches the CPU into kernel mode, runs kernel code, and switches back. Until the kernel returns, the thread that made the call is paused in kernel space.

Why does this matter for Go? Because **a paused thread cannot run goroutines**. If your program has one thread and that thread is parked in `read`, no Go code runs anywhere. Multi-threaded programming was invented partly to fix this: while one thread waits in the kernel, another runs application code. The Go scheduler automates that handoff so you do not have to think about it.

---

## The Question the Runtime Has to Answer

When a goroutine makes a syscall, the Go runtime must answer:

> "Should the OS thread carrying this goroutine stay attached to its scheduling context (the P), or should it let the P go so another thread can use it?"

The answer depends on **how long the syscall will take**.

| Syscall type | Expected duration | Best strategy |
|---|---|---|
| `getpid()`, `gettimeofday()` | nanoseconds | Stay on the thread; do not bother handing off. |
| `read()` from disk, `connect()` to remote host | microseconds to seconds | Hand off the P; let another thread run goroutines. |
| Network `read()` on a socket | could be hours (idle conn) | Do not block at all — register with the netpoller and park the goroutine. |

The runtime cannot perfectly predict each call, so it picks defaults that work well for each *kind* of call:

- **Networking** (sockets) is special-cased through the **netpoller**. The thread is *never* blocked.
- **Everything else** uses **entersyscall / exitsyscall**. The thread may block, but the P can move to another thread.

The next sections expand both paths.

---

## The Two Paths at a Glance

```
        +---------------------------+
        | Goroutine does a syscall  |
        +-------------+-------------+
                      |
        +-------------v-------------+
        | Is the fd a network fd?   |
        +-------+--------+----------+
                |        |
              YES        NO
                |        |
+---------------v--+   +-v-----------------------------+
|    Netpoller     |   |   entersyscall / exitsyscall   |
|------------------|   |--------------------------------|
| - fd set         |   | - M flags G as in syscall      |
|   non-blocking   |   | - M detaches from P            |
| - if EAGAIN,     |   | - M enters kernel (blocked)    |
|   park the G     |   | - sysmon hands P to fresh M    |
|   on the fd      |   | - kernel returns               |
| - M is FREE to   |   | - M tries to re-attach to a P  |
|   run other Gs   |   | - if none free, M parks        |
+------------------+   +--------------------------------+
```

The key difference: in the netpoller path, **the M is never blocked in the kernel**. In the handoff path, the M *is* blocked, but the P is rescued.

---

## Path A: Network — the Netpoller

For TCP, UDP, Unix domain sockets, and similar network fds, the runtime uses non-blocking I/O underneath. When you write:

```go
n, err := conn.Read(buf)
```

…the runtime translates it roughly to:

```go
for {
    n, err := nonblockingRead(conn.fd, buf)
    if err == nil {
        return n, nil
    }
    if !errors.Is(err, syscall.EAGAIN) {
        return n, err
    }
    // Data not ready yet — park the goroutine.
    netpoll.waitFor(conn.fd, READ)
    // Goroutine wakes up here when the fd is readable.
}
```

While the goroutine is parked:

- It is not on any CPU.
- It is not on any OS thread.
- It is sitting in a runtime data structure indexed by file descriptor.

On a separate occasion, an M checks `epoll_wait(2)` (Linux) or `kqueue(2)` (macOS/BSD) or `GetQueuedCompletionStatus` (Windows). The kernel says: "fd 7 is now readable." The runtime finds the parked goroutine for fd 7 and puts it back on a runqueue. Some M picks it up and the `Read` resumes.

The win: **one M can babysit a million sockets**. There is no "one thread per connection" — the netpoller is a level of indirection that breaks that link.

This is why a Go server with 100 000 idle WebSocket connections has *the same thread count* as one with 100 idle connections. The 99 900 difference lives only as goroutines in a hash table.

---

## Path B: Blocking Syscalls — the Handoff

Now the boring-but-important case. File I/O, `open`, `flock`, `connect` (the actual connect — before any data flows), and many cgo calls do not have an `EAGAIN`-friendly version, or it is not portable. They simply *block in the kernel*.

When the goroutine reaches such a call, the runtime calls `runtime.entersyscall()`:

1. It marks the current G as "in syscall" (`_Gsyscall`).
2. It detaches the M from its P. The P is now standalone — `_Psyscall`.
3. The M proceeds to make the actual syscall. It is now stuck in the kernel.

Now the P is sitting idle with possibly a queue of pending goroutines. The runtime would like another M to come pick it up.

A background goroutine called **sysmon** wakes up every ~20 µs and checks: are there Ps in `_Psyscall` state for more than 10 µs? If so, it forcibly hands the P off to another M (creating one via `clone(2)` if necessary). Pending goroutines on that P start running on the new M.

When the original syscall eventually returns, `runtime.exitsyscall()` runs:

- Try to grab back the original P (might still be there if the syscall was fast).
- If not, try to grab any free P.
- If no P is free, **park the M**. The G goes onto a runqueue and will resume later when some P is available.

The cost of the handoff is real but small: creating or waking an M takes a few microseconds. For a 10 ms file read it is invisible. For a 100 ns operation it would be ridiculous — which is why short syscalls do *not* trigger handoff (sysmon waits 10 µs before handing off).

---

## Why a Blocked File Read Does Not Stall the Program

This is the punchline of the whole page. Here is what happens when one goroutine reads a slow file:

```go
go func() {
    data, _ := os.ReadFile("/mnt/slow-nfs/huge.bin") // blocks 5 seconds
    process(data)
}()

go func() {
    for {
        time.Sleep(100 * time.Millisecond)
        fmt.Println("tick")
    }
}()
```

What you see: "tick" continues to print every 100 ms, regardless of the file read.

What is happening behind the scenes:

1. The file-reading goroutine calls into `entersyscall` → its M detaches from its P → its M is now stuck in `read(2)` for 5 seconds.
2. Sysmon notices within ~20 µs that this P is in `_Psyscall` and the syscall has been going for > 10 µs.
3. Sysmon hands the P off to another M (either an idle one or a freshly cloned one).
4. That new M happily runs `time.Sleep` and `fmt.Println` for the printer goroutine, hundreds of times.
5. After 5 seconds the disk returns. The original M emerges from `read(2)`, runs `exitsyscall`, and tries to re-attach.

Result: at most a few microseconds of "no goroutine runs" *during the handoff*, but otherwise the program keeps doing useful work. This is exactly what you want.

---

## Pictures: Before, During, After a Syscall

```
BEFORE: M1 is running G42 with P0 attached.

   [P0] ── [M1] ── G42 (running)
   [P1] ── [M2] ── G19 (running)


CALL: G42 calls os.ReadFile (a blocking syscall).
       entersyscall() runs.

   [P0] (Psyscall, detached)
                ── M1 (kernel) ── G42 (Gsyscall)
   [P1] ── [M2] ── G19


SYSMON: Sysmon hands off P0 to M3 (freshly spawned).

   [P0] ── [M3] ── G55 (just picked up from P0's runqueue)
                M1 (kernel) ── G42 (still in syscall)
   [P1] ── [M2] ── G19


RETURN: read(2) returns. exitsyscall() runs.
       M1 tries to re-attach to a P. None free; M1 parks.

   [P0] ── [M3] ── G55
   [P1] ── [M2] ── G19
   (M1 parked in M-pool, G42 on runqueue)


RESUME: Some P picks up G42 later and continues running it.

   [P0] ── [M3] ── G42 (resumed after read)
```

Three Ms used; only two Ps. That extra M (M1) appears in `top` and in `/proc/<pid>/status`. This is normal.

---

## Words You Need: G, M, P, Syscall, Handoff

Quick refresher (full details in [01-gmp-model](../01-gmp-model/)):

| Word | Meaning |
|---|---|
| **G** (goroutine) | A unit of Go work, ~2 KB stack to start, owned by the runtime. |
| **M** (machine) | An OS thread. Created via `clone(2)` on Linux. |
| **P** (processor) | A scheduling context. The runtime has `GOMAXPROCS` of them. To run Go code, an M must hold a P. |
| **Syscall** | A request from user space to the kernel. Two flavours in Go: netpoller-friendly (sockets) and not (everything else). |
| **Handoff** | When a P is moved from one M to another, usually because the first M is stuck in the kernel. |
| **Netpoller** | The runtime subsystem that uses `epoll`/`kqueue`/`IOCP` to park goroutines on file descriptors without holding a thread. |
| **sysmon** | A background goroutine that runs on its own thread, monitors the runtime, and triggers handoffs. |
| **`_Psyscall`** | The P state used while its former M is in a syscall. |
| **`_Gsyscall`** | The G state used while a goroutine is in a syscall. |
| **VDSO** | A small piece of kernel code mapped into every process for syscalls so fast they do not need a real mode switch. |

Keep these handy. We use them throughout the next pages.

---

## The Cost of a Handoff in Plain Terms

A syscall handoff is **not free**, but it is much cheaper than what it saves you from. Order-of-magnitude (Linux, modern x86-64, Go 1.22+):

| Operation | Cost |
|---|---|
| The actual `entersyscall` bookkeeping | ~100 ns |
| Sysmon noticing a slow syscall | up to 20 µs (one sysmon period) |
| Creating a brand new M with `clone(2)` | ~5–50 µs |
| Waking an already-parked M from `sched.midle` | ~1 µs |
| `exitsyscall` re-attach (fast path) | ~50 ns |
| `exitsyscall` slow path (M parks) | ~1 µs |

The expensive part is *creating* an M from scratch. Once Ms exist and are parked in the pool, handoff is cheap. This is why steady-state Go servers do not spawn new threads — the M pool absorbs the load.

Compare to **not having handoff at all**: a single slow file read would freeze every other goroutine running on that thread until the read finished. With handoff, only the syscalling G pauses.

---

## Your First Demo: Many File Reads

This program reads 100 files in parallel and prints how many OS threads got spawned.

```go
package main

import (
    "fmt"
    "os"
    "runtime"
    "sync"
    "time"
)

func main() {
    runtime.GOMAXPROCS(4)
    fmt.Println("Starting threads (approx):", threadCount())

    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            _, _ = os.ReadFile("/etc/hostname") // small but is a syscall
        }()
    }
    wg.Wait()

    time.Sleep(200 * time.Millisecond)
    fmt.Println("Ending threads (approx):", threadCount())
}

func threadCount() int {
    data, _ := os.ReadFile("/proc/self/status")
    // crude parse: find "Threads:" line
    for i := 0; i+8 < len(data); i++ {
        if string(data[i:i+8]) == "Threads:" {
            j := i + 9
            for j < len(data) && data[j] == ' ' {
                j++
            }
            k := j
            for k < len(data) && data[k] >= '0' && data[k] <= '9' {
                k++
            }
            n := 0
            for _, c := range data[j:k] {
                n = n*10 + int(c-'0')
            }
            return n
        }
    }
    return -1
}
```

Run it on Linux. You will typically see thread count jump from ~5 (startup) to somewhere in the range 10–20, then drop back as Ms park. With longer or slower syscalls, the jump is larger.

This is the M pool in action. The runtime created threads to handle the spike, kept them around briefly, and is willing to reuse them.

---

## Your Second Demo: Many Network Reads

Now compare against network I/O:

```go
package main

import (
    "fmt"
    "net"
    "os"
    "runtime"
    "sync"
    "time"
)

func main() {
    runtime.GOMAXPROCS(4)

    // Start a tiny echo server.
    ln, _ := net.Listen("tcp", "127.0.0.1:0")
    go func() {
        for {
            c, err := ln.Accept()
            if err != nil {
                return
            }
            go func(c net.Conn) {
                buf := make([]byte, 64)
                for {
                    n, err := c.Read(buf)
                    if err != nil {
                        return
                    }
                    c.Write(buf[:n])
                }
            }(c)
        }
    }()

    fmt.Println("Starting threads:", threadCount())

    var wg sync.WaitGroup
    for i := 0; i < 5000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            c, err := net.Dial("tcp", ln.Addr().String())
            if err != nil {
                return
            }
            defer c.Close()
            c.Write([]byte("hello"))
            buf := make([]byte, 64)
            c.Read(buf)
            time.Sleep(500 * time.Millisecond)
        }()
    }
    wg.Wait()
    fmt.Println("Peak threads roughly:", threadCount())
}

func threadCount() int { /* same as before */ return -1 }
```

Even with 5 000 simultaneous TCP connections, the thread count typically stays under 20. The netpoller is doing the heavy lifting. The 5 000 goroutines park on file descriptors and consume only their stacks plus a small runtime structure.

This is the empirical demonstration of the netpoller vs blocking-syscall distinction.

---

## Why the Netpoller Is Cheap and File I/O Is Not

Two questions you will be asked early in your Go career:

> "Why can't Go's netpoller handle disk I/O the same way?"

> "Why is `epoll` not enough for files?"

The simple answer: **on Linux, `epoll` lies about regular files.** It always reports them as "ready", because the kernel's view is that disk reads "never block long". But of course, they do block — disk seeks, NFS, slow USB drives. The kernel's `epoll` model is just not designed for that.

So Go takes the pragmatic path. Sockets, pipes, and similar fds *do* support `EAGAIN` and integrate with `epoll`. Files do not, so Go falls back to the older "block-in-thread" model with handoff.

Result:

- Network connections: ~1 M per `GOMAXPROCS`, thousands of Gs each.
- File I/O: 1 M per *in-flight* read or write.

The follow-up question:

> "What about `io_uring`?"

`io_uring` (Linux 5.1+) could in principle do for files what `epoll` does for sockets. Go's runtime does not use it yet (as of Go 1.22), though discussions exist. For now, file I/O is in the handoff path.

---

## Cgo as a Special Kind of Syscall

When your Go code calls a C function via cgo (`C.foo()`), the Go runtime treats it like a syscall:

- `entersyscall` is invoked (or a close variant) before the C call.
- The M detaches from its P.
- The C function runs on the M's *system stack* (`g0` stack), not a goroutine stack.
- When C returns, `exitsyscall` runs and the M tries to re-attach.

So a cgo call holds an M for its entire duration. If you call `C.slow_compute()` 100 times in parallel and each takes 50 ms, you briefly have 100 Ms.

Why not just keep the P and let C run? Because:

- C can call `pthread_*` functions, install signal handlers, touch thread-local storage. The Go runtime cannot safely steal the thread back.
- C may itself block in a kernel syscall, with no `entersyscall` notification.

So cgo is conservative: hold the thread.

This is the main reason **cgo-heavy services often have surprising thread counts**. Bounding cgo concurrency (running calls through a worker pool, not one-per-request) is the fix.

We expand cgo in [01-goroutines/02-vs-os-threads](../../01-goroutines/02-vs-os-threads/) and again at middle/senior of this page.

---

## What sysmon Is Doing in the Background

You will see the name *sysmon* (system monitor) repeatedly. It is a goroutine that the runtime starts at program init and that runs on its own M without a P. Sysmon's job, every 20 µs to 10 ms:

1. **Preemption**: notice goroutines that have been running too long and send them a preempt signal.
2. **Syscall handoff**: notice Ps in `_Psyscall` for more than 10 µs and hand them off to fresh Ms.
3. **Network polling**: occasionally call `netpoll` to flush ready fds.
4. **Background tasks**: trigger GC, scavenge memory, etc.

For this page, the relevant duty is #2. Without sysmon, the syscall handoff would simply not happen — and your file-reading program would block all other goroutines on that P.

You can see sysmon's effect with `GODEBUG=schedtrace=1000`: thread count fluctuates as sysmon hands off Ps.

---

## What "Fast Syscalls" Are

Not every syscall blocks. Some are so fast that going through `entersyscall`/`exitsyscall` is overkill.

Linux exposes the **VDSO** (Virtual Dynamic Shared Object): a small region of kernel code mapped into every user process. Calls like `gettimeofday`, `clock_gettime`, `getcpu`, and `time` are *implemented in VDSO*. They run entirely in user space — no mode switch, no kernel entry. They are not real syscalls.

Go's runtime takes advantage. `time.Now()` calls `clock_gettime`, which on Linux is a VDSO call. It costs ~20 ns. There is no `entersyscall` around it — the runtime knows it never blocks.

| Call | Path |
|---|---|
| `time.Now()` | VDSO. No handoff. |
| `runtime.nanotime()` | VDSO via `clock_gettime`. |
| `getpid` | Used to be a syscall; now cached. |
| `read` on a non-network fd | Real syscall. `entersyscall` + handoff. |
| `read` on a socket | Netpoller path; no `entersyscall`. |
| C cgo call | `entersyscall` (special variant). |

The reason this matters: people sometimes worry that `time.Now()` is expensive in tight loops. On modern Linux it is not — it is a VDSO call.

---

## What `LockOSThread` Has To Do With This

`runtime.LockOSThread` pins the calling goroutine to its current M. The pinning matters for syscalls in two ways:

1. **A locked M doing a syscall is even more expensive.** The M cannot be reused. The runtime cannot reassign the locked G to a different M afterwards. The handoff mechanism still works for the P, but the M sits in the kernel and can serve only its locked G when it returns.
2. **OS-level identity is preserved.** If you call `setns` or `prctl` from a locked goroutine, those calls modify the current thread. Without locking, your next syscall might land on a different thread and behave differently.

Junior takeaway: locking is fine for one or two goroutines per process. Locking many goroutines creates many Ms that cannot be recycled. We cover this in detail at middle and senior levels.

---

## Common Beginner Confusions

**"Goroutines are running on a thread, so a syscall blocks the goroutine, right?"**

Yes — the goroutine is paused. The thread (M) is also paused in the kernel. But other goroutines on other threads keep running. That is the magic.

**"Doesn't `GOMAXPROCS=1` mean my whole program blocks during a syscall?"**

No. `GOMAXPROCS=1` means one **P**. But Ms are independent. A syscall detaches the P from the M; another M (or a brand-new one) picks up the P. With `GOMAXPROCS=1`, only one goroutine runs Go code at a time, but other goroutines still make progress while one is in a syscall.

**"Why is my Go server using 50 threads? I only have `GOMAXPROCS=8`."**

You are seeing the M pool, plus Ms parked in cgo, plus the sysmon thread, plus possibly an `os/exec` thread. Normal.

**"My program is doing lots of `time.Now()`. Should I cache it?"**

Probably not. `time.Now()` is a VDSO call on Linux, ~20 ns. Caching it adds complexity and can introduce stale-time bugs.

**"Does cgo always block an M?"**

Yes, for the duration of the call. If your C code never blocks, the M is just running C instead of Go. But the M is unavailable for other Go work.

---

## Reading `GODEBUG=schedtrace`

Run a Go program with:

```bash
GODEBUG=schedtrace=1000 ./myprogram
```

You get one line per second (units in ms in the var name, here every 1000 ms):

```
SCHED 1004ms: gomaxprocs=4 idleprocs=2 threads=11 spinningthreads=0
              needspinning=0 idlethreads=5 runqueue=0 [0 0 0 0]
```

Decoding:

- `gomaxprocs=4`: 4 Ps configured.
- `idleprocs=2`: 2 Ps are idle (no M attached).
- `threads=11`: 11 Ms exist (running or parked).
- `idlethreads=5`: 5 Ms are parked in the pool.
- `runqueue=0 [0 0 0 0]`: global runqueue and per-P queues.

If you see `threads` climbing without bound, you have an M leak — likely caused by cgo, `LockOSThread`, or long-running blocking syscalls. We diagnose this in [find-bug.md](find-bug.md).

---

## Counting Threads vs Goroutines

Three different numbers, often confused:

```go
runtime.NumGoroutine()          // count of Gs
runtime.GOMAXPROCS(0)            // count of Ps
// Threads: read /proc/self/status on Linux
```

On a healthy server, expect:

- Goroutines: thousands to millions.
- Threads: tens.
- `GOMAXPROCS`: cores (or container quota).

If goroutines explode, you have a leak. If threads explode, you have a syscall or cgo storm. Different problems; different fixes.

---

## Mini Experiments You Can Run Right Now

**Experiment 1**: Print thread count every 100 ms while spawning slow file reads. Watch the count rise.

**Experiment 2**: Replace the file reads with `time.Sleep(100*time.Millisecond)`. Thread count stays low (time.Sleep is in the netpoller-ish path; it parks the G without holding an M).

**Experiment 3**: Spawn 1000 goroutines that do `_ = <-time.After(1 * time.Second)`. Thread count stays low; the runtime's timer integrates with the netpoller.

**Experiment 4**: Run with `GODEBUG=schedtrace=100` to see scheduler internals at 100 ms granularity.

**Experiment 5**: Spawn a goroutine that does `runtime.LockOSThread()` and then `time.Sleep(10*time.Second)`. Watch thread count: that M is unrecoverable for 10 seconds.

These take 5 minutes each and pay enormous dividends in intuition.

---

## What Happens on Different Operating Systems

The high-level model is the same everywhere, but the names change:

| Concept | Linux | macOS | Windows |
|---|---|---|---|
| Create thread | `clone(2)` | `bsdthread_create` | `CreateThread` |
| Netpoller backend | `epoll` | `kqueue` | IOCP |
| Fast time | VDSO `clock_gettime` | `mach_absolute_time` | `QueryPerformanceCounter` |
| Send preempt signal | `tgkill(SIGURG)` | `pthread_kill` | thread suspend/resume |

You do not need to memorise these — the runtime hides them. But knowing they exist is useful when reading source. For example, `runtime/os_linux.go` is the Linux thread code; `runtime/os_darwin.go` is the macOS equivalent.

---

## Tiny Mental Model

If you remember nothing else from this page:

1. **Network I/O is free of thread cost** because the netpoller parks goroutines on fds without holding an M.
2. **Other blocking syscalls do hold an M** but the runtime hands off the P so other goroutines keep running.
3. **Cgo calls hold an M** the same way blocking syscalls do.
4. **Sysmon** is what makes the handoff happen, every 20 µs.
5. **Thread count > `GOMAXPROCS` is normal** because Ms in syscalls don't count toward the active set.

Carry these five facts and you will rarely be wrong at this level.

---

## Worked Walkthrough: One `os.ReadFile` Call

Let's trace `data, err := os.ReadFile("/etc/hostname")` step by step.

```go
// os/file.go (paraphrased)
func ReadFile(name string) ([]byte, error) {
    f, err := Open(name)
    if err != nil { return nil, err }
    defer f.Close()
    return io.ReadAll(f)
}
```

`Open` calls `syscall.Open` → `entersyscall` → kernel `openat(2)` → `exitsyscall`. Total: ~10–50 µs typically.

`io.ReadAll(f)` loops calling `f.Read(buf)` which calls `syscall.Read` → `entersyscall` → kernel `read(2)` → `exitsyscall`.

For each syscall:

1. Goroutine's M flags `_Gsyscall`, detaches from P.
2. P goes `_Psyscall`.
3. M enters kernel.
4. If kernel returns in < 10 µs: M comes back, fast-path re-attaches to oldp.
5. If kernel takes > 10 µs: sysmon hands oldp off to another M. When M returns, slow-path parks M or fights for any P.

For `/etc/hostname` (a few bytes, file is in page cache), the whole call typically completes in microseconds, almost all in the fast path. For a 10 GB file on slow disk, sysmon hands off many times.

---

## Worked Walkthrough: One `conn.Read` Call

```go
// net/net.go (paraphrased)
func (c *conn) Read(b []byte) (int, error) {
    // ... safety checks ...
    n, err := c.fd.Read(b)
    // ... error wrap ...
    return n, err
}

// internal/poll/fd_unix.go (paraphrased)
func (fd *FD) Read(p []byte) (int, error) {
    for {
        n, err := syscall.Read(fd.Sysfd, p)
        if err == nil { return n, nil }
        if err == syscall.EAGAIN && fd.pd.pollable() {
            if err = fd.pd.waitRead(fd.isFile); err == nil {
                continue
            }
        }
        return n, err
    }
}
```

`syscall.Read` on a non-blocking socket returns immediately. Two outcomes:

- **Data is ready**: returns `n > 0`. No parking. Goroutine continues.
- **No data**: returns `EAGAIN`. `fd.pd.waitRead` parks the G against the fd in the netpoller. M is free to run other Gs.

When the kernel marks the fd ready (epoll), the netpoller wakes the parked G. The loop iterates; the next `syscall.Read` succeeds.

Note: this path never goes through `entersyscall`. The syscall itself is fast (returns immediately with `EAGAIN`), so there is no need.

This is what makes 50 000 idle connections almost free.

---

## Pitfalls That Already Cost Engineers Sleep

- **Doing file I/O in tight inner loops with thousands of goroutines.** The M pool explodes. Bound concurrency with a semaphore (≤ disk parallelism, typically 4–8).
- **Doing cgo calls in tight inner loops.** Same problem; one M per in-flight call.
- **Calling `LockOSThread` and forgetting to unlock.** That M can never be reused; thread count climbs forever.
- **Mistaking thread count for goroutine count.** `top` shows threads; pprof shows goroutines. Different.
- **Believing `epoll` works on regular files on Linux.** It does not.
- **Worrying about `time.Now()` performance without measuring.** It's a VDSO call; ~20 ns. Move on.

We make each of these into a debugging exercise in [find-bug.md](find-bug.md).

---

## Glossary

- **Syscall**: A request from user space to the kernel.
- **Netpoller**: Runtime subsystem using `epoll`/`kqueue`/`IOCP` to park goroutines on fds.
- **Handoff**: Moving a P from one M to another.
- **Entersyscall**: Runtime function called before a blocking syscall.
- **Exitsyscall**: Runtime function called after the syscall returns.
- **`_Psyscall`**: P state during a syscall.
- **`_Gsyscall`**: G state during a syscall.
- **Sysmon**: Background goroutine on its own thread doing periodic scheduler tasks.
- **VDSO**: Virtual Dynamic Shared Object; kernel code in user space.
- **Cgo**: Go's mechanism for calling C code; each call holds an M.
- **`LockOSThread`**: Runtime call to pin a goroutine to its current M.
- **Spin / spinning M**: An M actively looking for goroutines to run.

---

## Self-Check

- [ ] I can name the two paths a syscall takes through the Go runtime.
- [ ] I know that network I/O uses the netpoller and does not hold an M.
- [ ] I know that file I/O (and most other syscalls) holds an M for the duration of the syscall.
- [ ] I know that sysmon hands off the P after ~10 µs.
- [ ] I know `_Psyscall` is the P state during a syscall.
- [ ] I know cgo calls behave like blocking syscalls — they hold an M.
- [ ] I know VDSO calls like `time.Now()` bypass the handoff machinery.
- [ ] I know that `LockOSThread` makes the M unrecyclable for the locked goroutine's lifetime.
- [ ] I can count threads vs goroutines from inside a Go program.
- [ ] I can read a `GODEBUG=schedtrace` line at a basic level.

---

## Summary

A syscall is the boundary between Go code and the kernel. The Go scheduler treats sockets and files very differently: sockets ride the netpoller, parking goroutines without holding an OS thread; files (and most other syscalls) detach the P from the M and let sysmon hand the P off to a fresh M after ~10 µs. The result is that a single slow file read does not stall the rest of the program, and 50 000 idle TCP connections cost roughly one thread.

The cost of all this magic is small but real: a handoff is a few microseconds, M creation is tens, and the M pool can hold dozens of parked threads. Programs that misuse the mechanism — unbounded cgo, `LockOSThread` with no unlock, many concurrent slow file reads — see thread counts climb and CPU spend on context-switching instead of work.

At middle level we walk through `entersyscall`/`exitsyscall` field by field, see how sysmon's handoff logic is implemented, and dig into cgo and `LockOSThread` interactions.

---

## Appendix A: A Story to Anchor the Mental Model

Imagine the Go scheduler as a small restaurant.

- **Goroutines (G)** are customers placing orders.
- **Ps** are tables — a fixed number, set by `GOMAXPROCS`.
- **Ms** are waiters — the runtime can hire more, but each one costs money.
- **Syscalls** are kitchen orders that take time.
- **Sysmon** is the floor manager who watches the dining room.

A simple meal (a customer who only reads a memory cache) needs no syscalls. The waiter stays at the table the whole time.

A complicated meal (a customer who needs a file read from disk) means the waiter has to go to the kitchen. The waiter could wait there until the food is ready, but the table sits empty. Instead, the floor manager (sysmon) tells the waiter to leave their tray at the table and take another order somewhere else. Another waiter picks up the tray when the food is ready.

A network meal is different. The waiter places the order with the kitchen but does not wait. The kitchen has a bell that rings when any meal is ready. One waiter (the netpoller) listens for the bell and tells the right waiter to come back. This way, hundreds of customers can have orders in the kitchen and only a few waiters are needed.

A cgo meal is special. The waiter has to personally cook the meal in the kitchen. They cannot help other customers until they finish. If many such meals come in at once, the restaurant hires more waiters — sometimes too many. So the restaurant manager (you, the developer) puts a sign at the entrance: "no more than 32 cgo meals at once."

Carry this picture in your head. It is approximate, but it captures the essentials.

---

## Appendix B: How `time.Sleep` Avoids the Trap

You might wonder: `time.Sleep(1 * time.Second)` looks like it should block the M for a second. Doesn't it?

No. `time.Sleep` is implemented via the runtime's timer system, which is netpoller-integrated. When you call `time.Sleep`:

1. The goroutine adds a timer to the timer heap.
2. The goroutine parks (via `gopark`). The M is free.
3. When the timer fires (the netpoller wakes up at the right time), the goroutine is put back on a runqueue.
4. Some M picks it up and the `Sleep` returns.

Result: 10 000 goroutines doing `time.Sleep(1 * time.Second)` cost ~10 000 entries in the timer heap and ~few Ms of overhead. Not 10 000 threads. This is why patterns like:

```go
for {
    doWork()
    time.Sleep(10 * time.Millisecond)
}
```

…are perfectly fine even with many goroutines.

Compare to `runtime.Gosched()`, which does *not* sleep — it just yields the current P to other runnable goroutines. Different mechanism entirely.

---

## Appendix C: Things You Might See in Production

When you ssh into a Go server in production, you might see:

```bash
$ ps -L -p $(pgrep myserver) | head
  PID   LWP TTY      TIME CMD
12345 12345 ?    00:00:01 myserver
12345 12346 ?    00:00:00 myserver
12345 12347 ?    00:00:02 myserver
12345 12348 ?    00:00:00 myserver
12345 12349 ?    00:00:00 myserver
...
```

Each `LWP` is a thread. They all share the PID `12345`. This is normal — a Go process is one process with many threads.

```bash
$ cat /proc/12345/status | grep Threads
Threads: 12
```

12 threads is a healthy number for a small service.

```bash
$ top -H -p 12345
```

Shows CPU per thread. You will see a few threads near the top doing the bulk of the work; many threads near 0% CPU. The 0% ones are parked Ms.

```bash
$ curl localhost:6060/debug/pprof/goroutine?debug=2 | wc -l
3500
```

3500 lines of goroutine stack traces. Divide by ~7 (lines per goroutine) = ~500 goroutines. Healthy.

These are the diagnostics you will use *every day* as a Go engineer. Practice them.

---

## Appendix D: Common Misunderstandings

**"Goroutines are lightweight threads."**

This is the marketing phrase. It is approximately right but it hides the layering. Goroutines are *units of work* scheduled by the Go runtime onto OS threads. They are much lighter than threads (2 KB stack vs 8 MB), more numerous (millions vs thousands), and not directly visible to the kernel.

**"The Go runtime is the same as the JVM."**

The Go runtime has some similarities to a JVM: managed memory, GC, runtime scheduling. But it is much smaller (~50 kloc vs ~millions), statically linked into every binary (no separate JRE), and has different scheduling semantics (M:N preemptive vs platform-dependent).

**"`GOMAXPROCS=1` means single-threaded."**

It means one P (one execution context for Go code). The process can still have multiple Ms, including Ms in syscalls. So your program is single-threaded *for Go execution* but multi-threaded overall.

**"The netpoller is a separate thread."**

Sort of. There is no dedicated "netpoller thread". Instead, any M can call `netpoll` (which calls `epoll_wait`) when it has nothing else to do. The result is that the netpoller's work is spread across whichever Ms have downtime.

**"A panic in a goroutine kills the whole program."**

Yes — unless recovered. The runtime treats an unhandled panic as fatal. This is a Go design choice (in contrast to Erlang's "let it crash" with per-process isolation). Always recover at goroutine boundaries you care about.

---

## Appendix E: Where to Look Next

After this page, the recommended reading order is:

1. [middle.md](middle.md) — walks through `entersyscall`/`exitsyscall` step by step.
2. [01-goroutines/02-vs-os-threads](../../01-goroutines/02-vs-os-threads/) — refresh on threads vs goroutines.
3. [10-scheduler-deep-dive/01-gmp-model](../01-gmp-model/) — solid GMP foundation.
4. [tasks.md](tasks.md) — run the experiments.
5. [find-bug.md](find-bug.md) — see real production failures.
6. Once comfortable: [senior.md](senior.md) and [professional.md](professional.md) for the deep dive.

Do not skip the experiments. Reading about syscall handoff is fine; *seeing* thread count climb on your own laptop is what cements the understanding.

---

## Appendix F: Quick Reference Card

Tape this to your wall:

```
SYSCALL DECISION TREE
=====================

Is it a network call (socket, pipe set non-blocking)?
  YES -> netpoller. No M held. G parks on fd.
  NO  -> Is it a VDSO call (time.Now, getpid cached)?
           YES -> just runs. No syscall machinery.
           NO  -> entersyscall path. M held in kernel.
                  P detached. Sysmon may hand off after 10 µs.

THREAD COUNT FORMULA (rough)
============================
threads ≈ GOMAXPROCS                  (active Ms)
        + Ms_in_blocking_syscalls     (file I/O, etc.)
        + Ms_in_cgo                   (one per concurrent cgo call)
        + idle_Ms_in_pool             (typically a few)
        + locked_Ms                   (one per LockOSThread'd goroutine)
        + sysmon (1)
        + GC workers (a few)

WHEN TO BE WORRIED
==================
- threads growing without bound      -> M leak (LockOSThread / cgo)
- threads > 200 at steady state      -> unbounded I/O or cgo
- threads spike during burst         -> consider bounding
- goroutines growing without bound   -> goroutine leak (not M leak)
- p99 latency rises with concurrency -> contention or saturated I/O

KEY DEBUGGING COMMANDS
======================
cat /proc/$(pgrep prog)/status | grep Threads   # thread count
curl localhost:6060/debug/pprof/goroutine?debug=2  # goroutines
curl localhost:6060/debug/pprof/threadcreate    # where Ms were created
GODEBUG=schedtrace=1000 ./prog                  # scheduler trace
go tool trace trace.out                          # graphical trace
```

That is the entire syscall-handling story at junior level, fit on one page.

---

## Appendix G: Frequently Asked Beginner Questions

**Q: I am calling `os.ReadFile` in 1000 goroutines and my program is slow. Why?**

A: File reads each hold an M. With 1000 in flight, the runtime spawns up to ~1000 Ms, most of which sit in the kernel queueing for the disk. The disk cannot service them in parallel anyway. Add a semaphore to bound concurrency to ~8 (or disk parallelism on your hardware).

**Q: Does Go support `async/await`?**

A: No, and intentionally. Go's design is that you write blocking-style code (`conn.Read(buf)`) and the runtime makes it cheap via the netpoller. You do not annotate functions with `async`. The result is simpler code than async/await languages.

**Q: Is there a way to `select` on a file descriptor like in C?**

A: Not directly via `select` in Go. But the netpoller does this internally. For non-network fds, you can wrap them with `os.NewFile` and use `SetReadDeadline` + `Read` to get timeout behaviour.

**Q: How do I know if my fd is netpoller-backed?**

A: If it came from the `net` package (`net.Conn`, `net.Listener`), yes. If it came from `os` (regular file), no. If you created it yourself with `syscall.Socket` + `os.NewFile`, you need to call `syscall.SetNonblock(fd, true)` and access it via `net.FileConn` or similar — otherwise it goes through the blocking path.

**Q: Why does my program have so many threads even when idle?**

A: After a burst of activity, Ms park in the pool. They are not actively running, but they are still threads from the kernel's perspective. The runtime keeps them around to avoid the cost of creating new ones when load returns. Most idle Ms cost only some virtual memory; resident memory per parked M is small.

**Q: Can I use `runtime.GC()` to force a clean state?**

A: It triggers GC but does not "drain" pending syscalls or park unused Ms. Avoid in production code; the runtime's adaptive GC is usually better.

**Q: What is the difference between `gopark` and `entersyscall`?**

A: `gopark` is user-space parking — the goroutine sleeps on a runtime data structure (channel queue, lock waiter list, netpoller entry). No syscall. The M is free to run other goroutines. `entersyscall` is for actual kernel syscalls — the M is going into the kernel and cannot run goroutines until it returns. `gopark` is much cheaper.

**Q: Why does my CPU profiler show time in `runtime.mcall`?**

A: `mcall` is the entry to scheduler code (switching to the M's g0 stack). It is called during context switches between goroutines. A lot of time there suggests heavy context switching — maybe many short-lived goroutines, or many syscalls causing handoff.

**Q: Why does my service create new threads when I haven't changed anything?**

A: Load spikes. Even small bursts (1.5× baseline) can spawn a few new Ms briefly. They park afterward. As long as the count is bounded, this is fine.

**Q: Should I worry about `runtime.SetMaxThreads`?**

A: Default 10000. If you never approach that, no. If you do, you have an unbounded concurrency bug; fix that first.

---

## Appendix H: A Note on Cross-Platform Behaviour

The syscall handling described here is uniform across Linux, macOS, Windows, and the BSDs in terms of *behaviour*. The implementation differs:

- **Thread creation**: Linux uses `clone(2)` directly, macOS uses `pthread_create`, Windows uses `CreateThread`.
- **Netpoller backend**: epoll on Linux, kqueue on BSD/macOS, IOCP on Windows.
- **Signal delivery**: POSIX semantics on Unix, completion ports on Windows.

For application code, these differences are invisible. You write `os.ReadFile` and the runtime picks the right path. You can switch between platforms without code changes.

The one exception: **DNS resolution via cgo** is a macOS default (`netdns=cgo`) and a Linux option. On macOS, you may see cgo-based DNS holding Ms; on Linux you usually do not unless explicitly configured.

---

## Appendix I: Reading the Go Runtime Source (Optional)

If you are curious, the runtime source is in your Go installation:

```bash
$ go env GOROOT
/usr/local/go
$ ls /usr/local/go/src/runtime/
```

Key files for the syscall path:

- `proc.go` — `entersyscall`, `exitsyscall`, `sysmon`, `handoffp`.
- `netpoll.go` — netpoller core.
- `netpoll_epoll.go` (Linux), `netpoll_kqueue.go` (BSD/macOS).
- `cgocall.go` — cgo entry/exit.

You do not need to read these as a junior. But knowing they exist — and that they are just Go code, not magic — is comforting. You can always go look.

Try this: find the function `func sysmon()` in `proc.go`. Read the surrounding 30 lines. See the call to `retake`. That is the line that triggers your syscall handoff.

This kind of "I know where it lives, even if I have not read it cover to cover" understanding is what separates a competent Go programmer from a passenger.

---

## Appendix J: Last Practical Tips

Before moving on to middle level, make sure you can:

1. **Identify** in a code review whether a function will hold an M (file I/O? cgo?) or use the netpoller (network? timer?).
2. **Run** a Go program with `GODEBUG=schedtrace=1000` and read the output.
3. **Count** threads vs goroutines on your laptop.
4. **Explain** to a colleague why their unbounded `go func() { os.ReadFile(...) }()` loop is creating threads.
5. **Recognise** that `LockOSThread` is for thread-affine OS APIs and not for general concurrency control.

If you can do those five things, you have mastered the junior level. Move on to [middle.md](middle.md) for the next layer.
