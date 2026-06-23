---
layout: default
title: Professional
parent: Cooperative vs Forced
grand_parent: Cancellation Deep
ancestor: Go
nav_order: 5
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/20-cancellation-deep/01-cooperative-vs-force/professional/
---

# Cooperative vs Forced Cancellation — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Runtime Model](#the-runtime-model)
3. [Why the Runtime Cannot Force-Cancel a Goroutine](#why-the-runtime-cannot-force-cancel-a-goroutine)
4. [Preemption vs Cancellation](#preemption-vs-cancellation)
5. [Anatomy of Async Preemption](#anatomy-of-async-preemption)
6. [The Scheduler and Blocking Syscalls](#the-scheduler-and-blocking-syscalls)
7. [`context.Context` Implementation](#context-context-implementation)
8. [The Cost of Cancellation](#the-cost-of-cancellation)
9. [Signal Delivery and Threading](#signal-delivery-and-threading)
10. [CGO Internals and Cancellation](#cgo-internals-and-cancellation)
11. [`LockOSThread` Internals](#lockosthread-internals)
12. [Forced Cancellation Beyond Go](#forced-cancellation-beyond-go)
13. [Cancellation Propagation Through netpoller](#cancellation-propagation-through-netpoller)
14. [Cancellation in `database/sql`](#cancellation-in-database-sql)
15. [Cancellation in `net/http`](#cancellation-in-net-http)
16. [Cancellation in `os/exec`](#cancellation-in-os-exec)
17. [Building Custom Cancellable Primitives](#building-custom-cancellable-primitives)
18. [Runtime Trace and Cancellation](#runtime-trace-and-cancellation)
19. [Comparisons with Other Languages](#comparisons-with-other-languages)
20. [Future Directions](#future-directions)
21. [Summary](#summary)

---

## Introduction

The professional file is about *why* and *how* the Go runtime implements its cancellation story the way it does. We descend below the `context` API into:

- The G/M/P scheduler and where cancellation can and cannot reach
- The mechanics of async preemption and why it is *not* cancellation
- The implementation of `context.Context` (with annotated source pointers)
- Signal delivery semantics on Linux, macOS, and Windows
- The cgo state machine and the cost of crossing into C
- `runtime.LockOSThread` internals: thread affinity, signal targeting, and the M lifecycle
- Comparisons with `pthread_cancel`, `Thread.interrupt`, `CancellationToken`, structured-concurrency proposals
- Where the design might evolve

This file expects you to be comfortable reading `runtime/proc.go` and `runtime/signal_*.go`, to know the basic GMP terminology, and to have shipped at least one production Go service under load.

---

## The Runtime Model

### G, M, P recap

- **G**: a goroutine. A struct containing a stack, PC, scheduling state, and a few pointers.
- **M**: a machine — an OS thread. Runs Gs.
- **P**: a logical processor. Owns local run-queues, mcache, etc. Bound to an M while that M is executing Go code.

A G is in one of these states (simplified):

- `_Gidle`, `_Grunnable` (in some run queue, waiting for an M)
- `_Grunning` (currently on an M)
- `_Gsyscall` (in a syscall; M is "borrowed" for the duration)
- `_Gwaiting` (blocked on a channel, mutex, etc.)
- `_Gdead` (finished)

Cancellation operates at the Go level: it influences how a `_Grunnable` or `_Gwaiting` G unblocks. It does *not* directly manipulate G state from outside the G's own execution.

### The runqueue, the netpoller, and the timer heap

When a G calls `<-ctx.Done()` and the context is not yet cancelled, the G enters `_Gwaiting` on the channel. The runtime puts it on the channel's wait queue and releases the M. When `cancel()` is called, the channel is closed, and the wait queue is drained: each waiting G is moved back to `_Grunnable` and put on the run queue.

This is *cooperative*: no force is applied. The cancelled G simply gets a chance to run again.

The netpoller works similarly. When a G calls `conn.Read`, the runtime issues a non-blocking read; if no data is available, the G parks waiting for an epoll/kqueue/IOCP event. When the FD becomes ready (or is closed), the runtime moves the G back to runnable.

The timer heap parks Gs that called `time.Sleep` etc.; when the timer fires, the G is moved to runnable.

In all three cases, "becoming runnable" is the cancellation mechanism. The G chose to wait; it gets woken up.

---

## Why the Runtime Cannot Force-Cancel a Goroutine

### Reason 1: a goroutine may hold the M

When a G is running on an M, the M's program counter is in the G's code. To "stop" the G, the runtime would need to:

1. Take the M off the CPU.
2. Make the M not return to the G's code.
3. Mark the G as dead.
4. Run the G's deferred functions.

Step 4 requires running G's deferred functions *as if* the G ran them. But the deferred functions may need state that is currently locked, in a partially-constructed state, or otherwise unsafe to touch.

### Reason 2: critical sections must be respected

If a G is holding a `sync.Mutex` and the runtime "kills" it, the mutex is permanently locked. Other Gs deadlock. There is no `Mutex.Unlock` API that one G can call on another. Go's mutexes are not robust against ownership transfer.

The same is true of `sync.RWMutex`, `sync.WaitGroup` (its internal counter), and many `runtime` internal locks.

### Reason 3: signal-based "stop here" is brittle

You could in principle send a signal to the OS thread, capture the G's state, mark it dead. This is roughly what `pthread_cancel` does on POSIX. The history of `pthread_cancel` is full of bugs:

- Cancellation points in glibc are inconsistent across versions.
- Cancellation in the middle of `malloc` can leak memory or corrupt heap state.
- Cancellation in signal handlers is undefined.
- Mixed C/C++ destructors do not run on cancellation.

Java's `Thread.stop` was deprecated for similar reasons. The Go team explicitly chose to avoid these failure modes.

### Reason 4: the abstraction would leak

If `goroutine.Kill()` existed, every Go program would have to consider: "could my goroutine be killed mid-defer?" The answer would be "yes," because nothing in the language prevents it. Every critical section, every cleanup path would have to handle "I was killed before I could clean up" as a possible state.

The cooperative model eliminates this. A goroutine returns at points it chose; cleanup happens reliably; reasoning is local.

### Reason 5: cancellation across address spaces would still need cooperation

Even if Go had `goroutine.Kill()`, it would not solve cancellation across the cgo boundary, into the kernel, or to another process. Those require cooperation anyway. Adding a kill API to the language would buy little while adding much fragility.

---

## Preemption vs Cancellation

### What preemption is

The scheduler may preempt a G — take it off its M and put it back on the run queue — for fairness. Pre-1.14: only at function-call safe points (the prologue checks `g.preempt` and may yield). Post-1.14: asynchronously, via signals.

Preemption gives the *scheduler* the right to interrupt; the G is *not* terminated, just paused. It resumes later.

### What cancellation is

Cancellation is a *signal* that the G should stop running its work and return. The G must observe the signal and decide to return. No interruption of execution flow; only a flag in memory and a channel close.

### Why they are different

| Aspect | Preemption | Cancellation |
|---|---|---|
| Initiator | The scheduler | User code (via `cancel()`) |
| Effect | G is paused | G is requested to return |
| Mechanism | Stack switch / signal | Channel close |
| Resumes? | Yes, later | No (or yes, if you ignore) |
| Visibility to G | Invisible | Explicit `<-ctx.Done()` |
| Affects state? | Saves and restores G's state | Does not touch G's state |

A preempted G resumes exactly where it left off. A cancelled G — if it observes — returns from its function and is gone.

### Async preemption is sometimes mistaken for forced cancellation

Some developers, on first reading that Go 1.14 added async preemption, expected it to mean "the runtime can now kill goroutines." It does not. Async preemption inserts a *pause point* anywhere in the G's code, including inside tight loops. The G is moved to runnable. The next time it runs, it continues. It does not "exit" in any sense.

---

## Anatomy of Async Preemption

### Pre-1.14 cooperative preemption

The compiler inserts a check at function entry:

```go
// At the start of every Go function:
if g.preempt {
    runtime.morestack_noctxt() // may yield
}
```

If the G has been requested to yield (set by sysmon), `morestack` notices and parks the G. This works only at function-entry points. A tight loop without function calls never sees `g.preempt`.

### Go 1.14 async preemption (issue 24543)

The runtime sends a signal (`SIGURG` on Linux/macOS) to the M running a G that has overstayed its welcome. The signal handler examines the PC; if it is at a "safe" point (i.e., the compiler emits enough metadata for the runtime to know the state of the stack), it sets up the G to resume at a runtime helper that yields cleanly.

The signal handler does not yield directly. It rewrites the G's PC to enter `runtime.asyncPreempt`, which records state, calls `runtime.gopreempt_m`, and parks the G. The M is then free to pick another G.

### Safe points and stack maps

Async preemption requires that the runtime know the live pointers on the stack at the PC where the signal arrived. The Go compiler emits stack maps for "asynchronously preemptible" points. As of Go 1.14, most code is async-preemptible.

Exceptions:

- Some runtime functions (the scheduler itself, parts of the GC) are *not* preemptible.
- Cgo code is not preemptible.
- The very first few instructions of a function (before stack setup) are not preemptible.

Async preemption with stack maps is one of the more elegant pieces of the Go runtime.

### Why this matters for cancellation

Async preemption ensures the *scheduler* is fair. It does not deliver cancellation. A G in a tight CPU loop will be preempted regularly (so other Gs get to run) but will *not* observe `<-ctx.Done()` unless the loop explicitly checks.

If you read this and think "but the runtime sends signals to my M; can I piggyback for cancellation?" — the answer is: yes, in principle, with `LockOSThread`, but it is very tricky. See the LockOSThread section.

---

## The Scheduler and Blocking Syscalls

### `_Gsyscall` state

When a G calls a syscall, it transitions to `_Gsyscall`. The M is "donated" to the syscall: the kernel may block the thread; Go's runtime is OK with that because the M is no longer running Go code on its P.

The runtime's `sysmon` (system monitor) goroutine watches for Ms in syscalls. If a syscall takes longer than 10–20 ms, sysmon hands off the P to another M (or spawns one) so other Gs can run. The original M is left to wait for its syscall to return.

### Cancellation and syscalls

Cancellation cannot reach a G in `_Gsyscall`. The G is inside the kernel; the runtime cannot interrupt it. The escape hatches:

1. **Set a deadline on the FD.** The kernel returns the syscall with EAGAIN/timeout. The G observes the error and returns.
2. **Close the FD from another goroutine.** The kernel returns the syscall with EBADF or similar. The G observes the error.
3. **Send a signal to the M.** The signal interrupts the syscall (which returns EINTR). The G's runtime wrapper handles this. Note: by default, Go's signal handlers re-issue the syscall on EINTR for most signals; you may need `SA_RESTART` semantics off, or a non-restartable signal.

### `runtime/internal/syscall` boundary

Go's syscall wrappers (in `runtime/sys_linux_amd64.s` etc.) check for thread-state transitions. They call `entersyscall` before and `exitsyscall` after. These manage P donation, stack management, and async-preempt safety.

User-level packages like `os/exec` and `database/sql` interact with this via standard `syscall` calls.

### The netpoller

Network I/O is special. Instead of a blocking syscall per Read/Write, Go uses an OS-level event mechanism (epoll/kqueue/IOCP). The G:

1. Calls `Read` on a non-blocking FD.
2. Gets EAGAIN.
3. The runtime registers the FD with the poller and parks the G.
4. When the poller signals the FD ready, the runtime wakes the G.

Cancellation reaches this G via the channel mechanism (the parking is logically equivalent to `<-someChannel`). But more importantly, *closing the FD* unparks the G with an error.

This is why the idiom "close the connection to cancel a Read" works.

---

## `context.Context` Implementation

### Source

Implementation lives in `src/context/context.go`. The core types:

```go
type Context interface {
    Deadline() (deadline time.Time, ok bool)
    Done() <-chan struct{}
    Err() error
    Value(key any) any
}
```

Three concrete implementations:

1. `emptyCtx` — used by `Background()` and `TODO()`. `Done()` returns nil, `Err()` returns nil, `Value()` returns nil. Singleton.
2. `cancelCtx` — has a `done` channel (lazily created), an `err` field, and a `children` map.
3. `timerCtx` — embeds `cancelCtx` and adds a `timer` and a `deadline`.
4. `valueCtx` — has a key and value, plus a parent.

### `cancelCtx` core

```go
type cancelCtx struct {
    Context
    mu       sync.Mutex
    done     atomic.Value // of chan struct{}
    children map[canceler]struct{}
    err      error
    cause    error
}

func (c *cancelCtx) Done() <-chan struct{} {
    d := c.done.Load()
    if d != nil {
        return d.(chan struct{})
    }
    c.mu.Lock()
    defer c.mu.Unlock()
    d = c.done.Load()
    if d == nil {
        d = make(chan struct{})
        c.done.Store(d)
    }
    return d.(chan struct{})
}
```

Lazy creation of `done`: many contexts are created and never observed. Saves a channel allocation.

### `cancel` propagation

```go
func (c *cancelCtx) cancel(removeFromParent bool, err, cause error) {
    c.mu.Lock()
    if c.err != nil {
        c.mu.Unlock()
        return // already cancelled
    }
    c.err = err
    c.cause = cause
    d, _ := c.done.Load().(chan struct{})
    if d == nil {
        c.done.Store(closedchan) // global closed chan singleton
    } else {
        close(d)
    }
    for child := range c.children {
        child.cancel(false, err, cause)
    }
    c.children = nil
    c.mu.Unlock()
    if removeFromParent {
        removeChild(c.Context, c)
    }
}
```

Atomic: under one mutex, set error, close done, cancel children. No partial states are visible.

### `propagateCancel`

When you create `WithCancel(parent)`, the new context registers itself as a child of `parent` (if `parent` is cancellable). If `parent` cancels, it iterates its children and cancels each. This is the *push* model.

For non-cancellable parents (`Background`, `TODO`, or a `valueCtx` whose ultimate parent is `Background`), no registration is needed. `Done()` returns nil; you can never observe cancellation through them.

### `WithValue` is a linked list, not a map

Each `WithValue(parent, k, v)` creates a `valueCtx` with one pair. Lookups walk the chain.

```go
type valueCtx struct {
    Context
    key, val any
}

func (c *valueCtx) Value(key any) any {
    if c.key == key {
        return c.val
    }
    return c.Context.Value(key)
}
```

Implication: deep chains of `WithValue` make `Value` lookups linear. In practice, chains are shallow.

### `WithCancelCause` (Go 1.20)

Adds a `cause` field. When `cancel(err)` is called, `cause = err`. `context.Cause(ctx)` returns the cause (walking up to find the topmost ancestor's cause). `ctx.Err()` still returns the standard `Canceled`/`DeadlineExceeded`.

### `AfterFunc` (Go 1.21)

```go
stop := context.AfterFunc(ctx, func() {
    // runs in a new goroutine on cancellation
})
```

Internally registers a callback on the context's cancellation. Cheaper than spawning a long-lived goroutine that waits on `<-ctx.Done()`. `stop()` removes the callback.

### `WithoutCancel`

Returns a context that has the parent's values but doesn't cancel. Useful for background work that should outlive the request but keep trace IDs etc.

### Cost analysis

- `Background()`/`TODO()`: zero alloc (singleton).
- `WithCancel(parent)`: ~1 alloc for the struct, ~1 alloc for the channel if/when `Done` is called.
- `WithTimeout(parent, d)`: same as `WithCancel` plus a `time.Timer` alloc.
- `WithValue(parent, k, v)`: one alloc.
- `WithCancelCause(parent)`: same as `WithCancel`.

Total: small. Each `ctx.Done()` call after the first is free (returns the cached channel).

---

## The Cost of Cancellation

### Channel-receive cost

A non-cancelled `<-ctx.Done()` (in a `select` with `default`) is a few nanoseconds. The channel is empty; the receive returns false; the `default` branch runs.

A cancelled `<-ctx.Done()` reads from a closed channel: also a few nanoseconds, but returns true.

### `ctx.Err()` cost

After Go 1.21, `ctx.Err()` does an atomic load of the error field. ~1–2 ns. Cheaper than `<-ctx.Done()` if you only want to check, not wait.

### Tree walk cost

`WithCancel(WithCancel(WithCancel(Background())))` is a 3-deep chain. When you cancel the outer, it walks down. When you observe `Done()` on the innermost, it returns the innermost's own channel — no walk per observation.

But `ctx.Value()` walks up the entire chain each time. Deep value chains cost.

### Cancellation propagation cost

Cancelling a parent with N children: O(N) calls to child `cancel`. Each is similar work. Typical N is small (a few children); not a concern.

### Comparison to `pthread_cancel`

`pthread_cancel` requires:

- Cancellation points in libc.
- Cleanup handlers (`pthread_cleanup_push`) for resources.
- Coordination with `pthread_setcancelstate`.

Cost per cancellation point: ~10–50 ns (atomic load + branch). Comparable to Go's `<-ctx.Done()`.

The cost is similar; the difference is *reliability* and *programmability*. Go's model is simpler.

---

## Signal Delivery and Threading

### POSIX signal semantics recap

Signals can be:

- **Process-directed**: e.g., `kill(pid, sig)` — delivered to any thread in the process that has not blocked the signal.
- **Thread-directed**: e.g., `pthread_kill(tid, sig)` — delivered to a specific thread.
- **Synchronous**: e.g., `SIGSEGV` from a bad pointer dereference — delivered to the thread that caused it.

Go's runtime sets up signal handlers via `signal.Notify`. By default, common signals (`SIGINT`, `SIGTERM`) are caught and delivered to the `signal.Notify` channel.

### Go's signal handler

Located in `runtime/signal_*.go`. When the OS delivers a signal:

1. The kernel switches the thread to a signal-handler stack.
2. The Go signal handler runs.
3. It examines the signal and the current G.
4. Most signals are forwarded to the user channel via `signal.Notify`.
5. Some signals (`SIGURG` for async preempt) are handled internally.
6. The handler returns; the kernel resumes the thread at the saved PC.

### Async preempt signal

Go uses `SIGURG` (on Linux/macOS). The handler:

```go
func sigPreempt(sig uint32, info *siginfo, ctxt unsafe.Pointer) {
    if !canPreempt(g) {
        return
    }
    // rewrite the saved PC to enter asyncPreempt
}
```

The reason for `SIGURG` is that it is rarely used by user code; choosing it minimises conflicts.

### Signal handlers and cgo

When cgo code is running, the M is in C. The Go runtime cannot run a Go signal handler there safely. The runtime sets up an *alternate signal stack* (`sigaltstack`) so the handler can run, but it then defers the actual work until the M returns to Go.

If your cgo code is in a long-running loop, the signal arrives but cannot deliver cancellation. The handler returns; the C code continues. This is why async preemption does not affect cgo.

### Signal masks and threading

Each OS thread has its own signal mask. Go takes care of setting the right masks on each M. Custom signal-handling code (e.g., `runtime.LockOSThread` plus `pthread_kill`) must be aware of the masks.

### Windows: no POSIX signals

Windows has a different mechanism. The Go runtime uses `SuspendThread`/`SetThreadContext` for async preemption: the runtime suspends the thread, rewrites its IP, and resumes it. The effect is the same as the signal-based approach on POSIX.

---

## CGO Internals and Cancellation

### The cgo state machine

A cgo call goes through:

1. **`entersyscall`**: G transitions from `_Grunning` to `_Gsyscall`. The M's P is detached (potentially handed to another M).
2. **`cgocall`**: the M switches to the system stack, calls the C function.
3. **C runs**: arbitrary C code; runtime cannot interrupt.
4. **C returns**.
5. **`exitsyscall`**: G transitions back to `_Grunning`. The M tries to re-acquire its P; if not available, parks the G on the run queue.

Throughout step 3, the M is dedicated to the C call. No cancellation can reach the G.

### Pinning and unpinning

`runtime.cgocall` pins the G to its M for the duration of the C call. The M cannot be repurposed; the G cannot be migrated. This is necessary because C code may rely on thread-local storage, signal masks, etc.

### Reverse cgo (C → Go callback)

If C calls into Go (via `//export`), the Go side runs *on the same M*. Cancellation reaches normally during the Go portion. But the original C call still blocks the M.

If the callback panics, the panic propagates through C (which has no notion of panic). Behaviour is undefined; the Go runtime tries its best but it may crash.

### Cancellation strategies for cgo

The senior file covered the high level. Implementation details:

1. **Cancel flag in C, polled by C loop**:
   ```c
   static atomic_int cancel_flag = 0;
   ```
   Go sets it; C polls. Cooperative cancellation across the boundary.

2. **Signal the M from another goroutine**:
   ```go
   // The G running C is on a specific M with a specific tid.
   tid := getThreadID(g) // requires LockOSThread + Gettid
   syscall.Tgkill(syscall.Getpid(), tid, syscall.SIGUSR2)
   ```
   The C code must install a handler that sets a flag or `longjmp`s. Fragile.

3. **Run in a subprocess**:
   ```go
   exec.CommandContext(ctx, "cgo-helper").Run()
   ```
   Process isolation. Cancellation kills the subprocess. Slower per call, but bounded.

### `runtime/cgo` internals

The `runtime/cgo` package handles thread-state management for cgo calls. Notable functions:

- `cgocall(fn, arg)`: enter C from Go.
- `cgocallback(g, ctx)`: enter Go from C (used for callbacks).
- `_cgo_release_context(ctx)`: tear-down for callback context.

Reading these in the source clarifies why cancellation cannot reach cgo.

---

## `LockOSThread` Internals

### What the call does

```go
func LockOSThread()
```

Sets a flag on the G: "do not migrate me." The scheduler honours this. When the G is descheduled, it must be rescheduled on the same M. If the M is busy, the G waits.

### Why one might use it

1. **OpenGL contexts** are thread-local; must call all GL functions from the same thread.
2. **Windows GUI APIs** are thread-affine.
3. **POSIX TLS (`__thread`)** values are per-thread.
4. **`pthread_kill` targeting**: you need a stable thread ID.
5. **Lock-step with C++ destructors**: stack-affine cleanup.

### Side effects

- The M cannot run any other G while this G is on it.
- If the locked G calls into C, the M is doubly committed: locked by Go *and* in C.
- If the G *exits without `UnlockOSThread`*, the M is also terminated (so the OS thread doesn't outlive its only G).

### Targeted signal delivery

```go
runtime.LockOSThread()
defer runtime.UnlockOSThread()

tid := unix.Gettid() // syscall.Gettid on Linux

// Save tid to a struct accessible from another goroutine.
// Another goroutine can now: unix.Tgkill(pid, tid, sig)
```

This is the only Go-supported way to direct a signal at a specific G. The signal handler must be installed at the runtime level; coordinating with Go's signal handlers is tricky.

### `UnlockOSThread` and balance

The pair must balance. `LockOSThread` increments a counter; `UnlockOSThread` decrements. Only when the counter is zero is the G unlocked. Multiple Lock calls (e.g., reentrant) work.

### Interaction with `runtime.GOMAXPROCS`

`LockOSThread` does *not* increase GOMAXPROCS or pin a P. The G is bound to an M, but the M's P can still be donated when the G blocks. Subtle.

---

## Forced Cancellation Beyond Go

### Process-level: `os.Exit`

```go
os.Exit(1)
```

Calls `exit(1)` on Unix, `ExitProcess` on Windows. The OS reaps all threads in the process. No deferred functions run. No cleanup. Use as last resort.

### Process-level: panic with no recover

A panic propagates up through the goroutine's call stack. If unrecovered, the runtime prints a stack dump and calls `exit(2)`. Deferred functions in the panicking G run (during the unwind). Other Gs do not get a chance to defer.

### Killing your own subprocess

```go
cmd.Process.Kill() // sends SIGKILL on Unix
```

Bypasses any cgo or cooperative mechanism. The subprocess dies; any work it was doing is lost.

### Container or cgroup kill

If running under Kubernetes/containerd, `docker kill` or `kubectl delete pod` ultimately sends `SIGKILL` to PID 1 in the container after a grace period.

### Hardware: power off, reset, kernel panic

The ultimate force: there is no software-level mechanism to recover from these. Design for at-least-once semantics, transactional state, durable storage.

---

## Cancellation Propagation Through netpoller

### How a `Read` becomes parkable

```go
// net.conn.Read user code
n, err := conn.Read(buf)
```

Internally:

```go
func (c *netFD) Read(p []byte) (n int, err error) {
    n, err = c.pfd.Read(p)
    // ...
}

func (fd *FD) Read(p []byte) (int, error) {
    // ... non-blocking syscall ...
    n, err := syscall.Read(fd.Sysfd, p)
    if err == syscall.EAGAIN && fd.pd.pollable() {
        if err = fd.pd.waitRead(fd.isFile); err == nil {
            continue
        }
    }
    // ...
}
```

`waitRead` parks the G on the poll descriptor's "read wait" entry. The G state becomes `_Gwaiting`.

When the FD becomes readable, the netpoller wakes the G. When the FD is closed, the netpoller wakes the G with an error.

### How `conn.Close` propagates cancellation

`Close` invalidates the FD in the poll descriptor. The runtime wakes all waiting Gs with `ErrFileClosing`. The user code sees `use of closed network connection`.

This is why "close the resource to cancel" works: the netpoller wakes the parked G with an error.

### Context-aware Read?

`net.Conn` does *not* take a context. But `net.Dialer.DialContext` does, and `http.Request` carries one.

For an in-flight `Read`, the way to honour context is:

```go
go func() {
    <-ctx.Done()
    conn.Close()
}()
n, err := conn.Read(buf)
```

The watcher goroutine observes the context and closes the connection. The blocked `Read` returns with an error.

### Future direction: `net.Conn` with context

Periodic proposals to add `ReadContext` to `net.Conn` have not landed (as of 1.22) because the existing pattern works and Conn's interface is intentionally minimal. The conventional approach is the close-on-cancel pattern.

---

## Cancellation in `database/sql`

### `QueryContext` lifecycle

```go
rows, err := db.QueryContext(ctx, "SELECT ...")
```

Flow:

1. `sql.DB` acquires a `*driverConn` from the pool.
2. Driver's `QueryContext` runs the query.
3. If `ctx` is cancelled during the query:
   - The driver's `Cancel` method (if implemented) is called.
   - The driver sends a "cancel query" command to the server.
   - The server stops processing.
   - The driver returns `ctx.Err()`.

### Driver responsibilities

Drivers implementing `driver.QueryerContext` and `driver.ExecerContext` are expected to honour context. The `database/sql` package will spawn a watcher goroutine that calls the driver's `cancel` on context cancellation if the driver does not natively integrate.

PostgreSQL's `lib/pq` and `pgx` implement context natively. MySQL drivers vary. SQLite drivers typically use signals or `sqlite3_interrupt`.

### Connection state on cancel

When a query is cancelled mid-flight, the connection may be in an indeterminate state. Most drivers discard the connection rather than risk reusing it with partial result state. This is correct but means cancelled queries are not free.

### Partial side effects

```go
ctx, cancel := context.WithTimeout(parent, 100*time.Millisecond)
defer cancel()
_, err := db.ExecContext(ctx, "INSERT INTO logs VALUES (...)")
```

If the insert is sent to the server and the connection times out before the response, *the insert may or may not have committed*. Treat cancellation paths as "happened or not, you cannot tell."

Use idempotent operations or explicit transactions to handle this.

---

## Cancellation in `net/http`

### Server-side

`http.Server` calls handlers in a goroutine per request. The request's context (`r.Context()`) is cancelled when:

- The client closes the connection.
- The server's `Shutdown` is called.
- The request's `http.Server.WriteTimeout` is exceeded.

Handlers should propagate `r.Context()` to all downstream calls.

### `Shutdown` semantics

```go
func (srv *Server) Shutdown(ctx context.Context) error
```

Flow:

1. Stop listening on the accept socket (no new connections).
2. For each idle keep-alive connection, close it.
3. For each in-flight request, wait for it to finish.
4. If `ctx` expires before all are finished, return `ctx.Err()`. Some connections may still be in flight.

`Shutdown` is cooperative; if handlers ignore `r.Context()`, `Shutdown` waits indefinitely (until ctx cancels).

### Client-side

`http.Client` honours the request's context:

```go
req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
resp, err := http.DefaultClient.Do(req)
```

On context cancellation: the client closes the underlying connection. Any in-flight `Read` on the response body returns an error. The connection is not returned to the pool.

### `http.Transport.CancelRequest` (deprecated)

In old Go, you cancelled a request by calling `tr.CancelRequest(req)`. Deprecated in favour of context. Do not use in new code.

### Response body and context

```go
resp, err := http.DefaultClient.Do(req.WithContext(ctx))
// ...
n, err := resp.Body.Read(buf)
```

The body's `Read` honours the request's context: if `ctx` cancels mid-read, the connection is closed and `Read` returns an error.

---

## Cancellation in `os/exec`

### `CommandContext` flow

```go
cmd := exec.CommandContext(ctx, "long-running")
err := cmd.Run()
```

Flow:

1. `Run` starts the process.
2. A goroutine watches `ctx.Done()`.
3. On cancellation, the goroutine calls `cmd.Cancel()`.
4. Default `Cancel` is `cmd.Process.Kill()` (sends SIGKILL on Unix).
5. The process dies; `Run` returns.

### Custom cancellation (Go 1.20+)

```go
cmd.Cancel = func() error {
    return cmd.Process.Signal(syscall.SIGTERM) // gentler first
}
cmd.WaitDelay = 5 * time.Second // escalate after 5s if SIGTERM didn't work
```

`WaitDelay` is a grace budget: after `Cancel` is called, wait this long for the process to exit. If it does not, `Run` returns even if the process is still running (and force-closes the pipes).

### Killing a process group

```go
cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
// later:
syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL) // negative pid = process group
```

Useful for subprocesses that spawn their own children. Without this, killing only the parent leaves children orphaned.

---

## Building Custom Cancellable Primitives

### Cancellable mutex

```go
type CtxMutex struct {
    ch chan struct{}
}

func NewCtxMutex() *CtxMutex { return &CtxMutex{ch: make(chan struct{}, 1)} }

func (m *CtxMutex) Lock(ctx context.Context) error {
    select {
    case m.ch <- struct{}{}:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}

func (m *CtxMutex) Unlock() { <-m.ch }
```

Cost: ~50–100 ns per lock under no contention, vs ~25 ns for `sync.Mutex`. Use when cancellable acquire matters.

### Cancellable RWMutex

Considerably more complex. Most implementations use a counter protected by a mutex, plus channels for cancellable wait. Probably not worth writing from scratch; use a library or accept that read locks are not cancellable.

### Cancellable wait-group

```go
type CtxWaitGroup struct {
    counter atomic.Int64
    cond    chan struct{} // closed when counter reaches 0
    mu      sync.Mutex
}

func (w *CtxWaitGroup) Add(delta int) {
    w.counter.Add(int64(delta))
}

func (w *CtxWaitGroup) Done() {
    if w.counter.Add(-1) == 0 {
        w.mu.Lock()
        if w.cond != nil {
            close(w.cond)
        }
        w.mu.Unlock()
    }
}

func (w *CtxWaitGroup) Wait(ctx context.Context) error {
    w.mu.Lock()
    if w.counter.Load() == 0 {
        w.mu.Unlock()
        return nil
    }
    if w.cond == nil {
        w.cond = make(chan struct{})
    }
    cond := w.cond
    w.mu.Unlock()

    select {
    case <-cond:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

Caveats: this is not fully equivalent to `sync.WaitGroup`. Reuse semantics (calling `Wait` then `Add` again) are tricky. Use only when needed.

### Cancellable channel send

```go
func SendCtx[T any](ctx context.Context, ch chan<- T, v T) error {
    select {
    case ch <- v:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

Trivial wrapper; useful in code where the send pattern is repeated.

### Cancellable semaphore

```go
type CtxSemaphore struct {
    ch chan struct{}
}

func NewCtxSemaphore(n int) *CtxSemaphore {
    return &CtxSemaphore{ch: make(chan struct{}, n)}
}

func (s *CtxSemaphore) Acquire(ctx context.Context) error {
    select {
    case s.ch <- struct{}{}:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}

func (s *CtxSemaphore) Release() { <-s.ch }
```

`golang.org/x/sync/semaphore` is the standard implementation; it supports weighted acquires too.

---

## Runtime Trace and Cancellation

### `runtime/trace`

```go
import "runtime/trace"

trace.Start(f)
defer trace.Stop()
```

Records every G transition, syscall, sched event, GC pause. View with `go tool trace trace.out`.

For cancellation diagnostics:

- See when each G observed `<-ctx.Done()`.
- Measure the delay between `cancel()` and G exit.
- Identify Gs that never exit (still in `_Gwaiting` at the end of the trace).

### `pprof` and goroutine leaks

```bash
go tool pprof http://localhost:6060/debug/pprof/goroutine
```

Run in your service. Look for goroutines stuck on `<-ctx.Done()` long after cancellation. If they exist, they are blocked on something else (a lock, a syscall) and cancellation cannot reach them.

### Custom trace tasks (Go 1.21+)

```go
ctx, task := trace.NewTask(ctx, "loadUser")
defer task.End()
trace.Log(ctx, "id", id)
```

Tasks tie operations together in the trace. When a task is cancelled, you can see the entire sub-tree of work it spawned.

---

## Comparisons with Other Languages

### Java

- `Thread.interrupt()` sets a flag and unparks the thread from `wait`/`sleep`/`join`. Comparable to context cancellation: the thread must observe `Thread.interrupted()` or wait on an interruptible method.
- `Thread.stop()` was deprecated for the same reasons Go avoids `goroutine.Kill`.
- `ExecutorService.shutdownNow()` interrupts all running tasks. Cooperative.
- Java's `CompletableFuture` has no built-in cancellation propagation; you must wire it manually.

Go's `context` is conceptually similar to Java's interrupt model, plus a tree structure for propagation.

### .NET

- `CancellationToken` is essentially Go's context.
- `CancellationTokenSource.Cancel()` is `cancel()`.
- Cooperative; every async method takes a token.
- The standard library is more uniform in honouring tokens than Go's (every async method takes one), partly because async/await syntax made it natural.

Go's `context` is slightly older than `CancellationToken` and the designs are similar.

### Rust

- Async cancellation in Rust is "drop the future." When you drop a `Future`, any work it represents is cancelled.
- This works because Rust's borrow checker ensures resources are released on drop.
- Tokio's `tokio::select!` macro is comparable to Go's `select`.
- The "drop to cancel" model is in some ways stronger than Go's: a leaked future is harder to construct.

### Python

- `asyncio.Task.cancel()` injects a `CancelledError` into the task at the next await point. Cooperative.
- `threading.Thread` has no native cancel; you set a flag.
- The `concurrent.futures.Future.cancel()` only cancels if the future hasn't started.

Python's task cancellation is similar to Go's context cancellation, but the cancel-as-exception model means uncaught cancels propagate as errors.

### Erlang/Elixir

- Processes can be killed with `exit(pid, kill)`. Force-cancel by default.
- This works because Erlang processes share no memory; killing one cannot corrupt others.
- Recovery is via supervision trees: a killed process is restarted.

Erlang's model is the *opposite* of Go's: force is the default. The OTP design relies on small isolated processes; the cost of restart is low.

### Goroutines vs threads vs actors

| Model | Cancellation | Cost |
|---|---|---|
| OS threads | Cooperative via flags; pthread_cancel is fragile | High |
| Java threads | Cooperative via interrupt | High |
| Goroutines | Cooperative via context | Low |
| .NET tasks | Cooperative via CancellationToken | Low |
| Rust futures | Drop-based | Very low |
| Erlang processes | Forceful (exit signals) | Low |

Go's choice is in the "low cost, cooperative" quadrant — typical for modern async runtimes.

---

## Future Directions

### Standard structured concurrency

Proposals to add structured concurrency to the standard library (similar to `errgroup` but standardised) periodically circulate. As of Go 1.22, no concrete plans.

### `iter` and context

The `range over func` feature (Go 1.23) brings iterators. Whether iterators integrate with context cancellation is an open design question.

### `synctest` (experimental)

`testing/synctest` (Go 1.24) gives a deterministic scheduler for tests. Useful for testing cancellation paths without real timing concerns.

### CGO and cancellation

No realistic prospect of cgo becoming cancellable. The cost of altering the cgo state machine would be huge; the audience is small.

### `context.Context` evolution

Recent additions: `WithCancelCause`, `AfterFunc`, `WithoutCancel`. Likely more conveniences over time; the core API is stable.

---

## Summary

The cooperative cancellation model in Go is not just a library choice — it is a runtime-level commitment. The runtime cannot force a goroutine to stop because:

- Goroutines may hold locks, be mid-defer, or be inside cgo.
- Forced cancellation in other languages (`pthread_cancel`, `Thread.stop`) has been a source of bugs for decades.
- The cost of cooperation is low and the simplicity payoff is high.

`context.Context` implements cancellation as a tree of cancellable nodes, with `Done()` returning a channel that closes on cancellation and `Err()` returning the reason. Propagation is push-based: the parent cancels, then iterates its children. The cost is small enough to be invisible in most code.

Forced cancellation in Go is reserved for process-level operations: `os.Exit`, unrecovered panics, subprocess kill, and the close-the-resource escape hatch. Per-goroutine force is impossible by design and unlikely ever to change.

The deepest pitfall is cgo: once a goroutine enters C, no cancellation mechanism can reach it short of killing the process or, in carefully designed code, signalling a flag the C code polls. Subprocess isolation is the safest pattern.

`runtime.LockOSThread` is the bridge between Go's cooperative world and the OS's signal-based threading world. It allows targeted signal delivery to a specific G, at the cost of an M dedicated to that G. Use only when nothing else works.

With this understanding, you can debug cancellation problems at any level: from a single `<-ctx.Done()` that doesn't fire, to a `Shutdown` that hangs, to a cgo call that survives every attempt to stop it. The runtime is not opaque; it is a system you can reason about.
