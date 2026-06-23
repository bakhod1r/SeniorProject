---
layout: default
title: Professional
parent: Graceful Shutdown
grand_parent: Production Patterns
ancestor: Go
nav_order: 5
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/18-production-patterns/04-graceful-shutdown/professional/
---

# Graceful Shutdown — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [UNIX Signals at the Kernel Level](#unix-signals-at-the-kernel-level)
3. [Go Runtime Signal Handling](#go-runtime-signal-handling)
4. [The `os/signal` Package Internals](#the-ossignal-package-internals)
5. [Inside `signal.NotifyContext`](#inside-signalnotifycontext)
6. [Inside `http.Server.Shutdown`](#inside-httpservershutdown)
7. [Inside `http.Server.Close`](#inside-httpserverclose)
8. [The `net.Listener` Lifecycle](#the-netlistener-lifecycle)
9. [Connection State Tracking in `http.Server`](#connection-state-tracking-in-httpserver)
10. [`SIGKILL` Mechanics at the Kernel Level](#sigkill-mechanics-at-the-kernel-level)
11. [Container Runtime Signal Delivery](#container-runtime-signal-delivery)
12. [Kubernetes kubelet Internals](#kubernetes-kubelet-internals)
13. [PID 1 and Signal Forwarding](#pid-1-and-signal-forwarding)
14. [Go Runtime Internals During Shutdown](#go-runtime-internals-during-shutdown)
15. [Performance Characteristics of Shutdown](#performance-characteristics-of-shutdown)
16. [Version-Specific Behaviour](#version-specific-behaviour)
17. [Reading the Standard Library Source](#reading-the-standard-library-source)
18. [Performance Profiling of Shutdown](#performance-profiling-of-shutdown)
19. [Edge Cases at the Lowest Level](#edge-cases-at-the-lowest-level)
20. [Conclusion](#conclusion)

---

## Introduction

At professional level we leave architecture behind and read the source. What does the Linux kernel do when SIGTERM is delivered? How does the Go runtime intercept it without disrupting the running program? What is the actual algorithm inside `http.Server.Shutdown`? How does Kubernetes' kubelet decide to send SIGKILL?

The questions are no longer "how do I design my service" but "what exactly happens, byte by byte, when these things occur."

This file is for engineers who:

- Debug kernel-level signal handling issues.
- Maintain Go itself or libraries that need internal-level correctness.
- Work in environments where the standard patterns don't fit.
- Want to understand *why* the patterns we use exist.

It is not required reading for most production work. But it is the deepest layer, and a small number of incidents per year reach into it. When they do, this knowledge is the difference between "we don't know" and "we found it."

---

## UNIX Signals at the Kernel Level

A signal is one of the oldest IPC mechanisms in UNIX, dating to Bell Labs. The kernel-side mechanics:

### Signal numbers and types

The kernel reserves a small numeric range (1–64 on Linux) for signals. The signal number maps to a name like `SIGTERM`. Real-time signals (`SIGRTMIN`–`SIGRTMAX`) extend the range and offer FIFO delivery guarantees; standard signals can be coalesced.

For graceful shutdown, we care about standard signals 1–15 mostly:

- `SIGHUP` (1): terminal hangup, often reused for reload.
- `SIGINT` (2): terminal interrupt (Ctrl+C).
- `SIGQUIT` (3): terminal quit (Ctrl+\), default action is core dump.
- `SIGTERM` (15): polite terminate.
- `SIGKILL` (9): forcible terminate.
- `SIGSTOP` (19): forcible stop (cannot be caught).

### Signal delivery flow

When the kernel decides to deliver a signal to process P:

1. **Pending bit set.** In P's `task_struct`, the bit for the signal is set in the `pending` field.
2. **Wake up.** If P is sleeping (in a syscall), the kernel wakes it.
3. **Signal handling on return to userspace.** When P next returns from kernel to userspace, before resuming user code, the kernel checks pending signals.
4. **Action selection.** The kernel looks up the signal's action: default, ignore, or user-defined handler.
5. **User handler invocation.** If user-defined, the kernel arranges for the handler to be called: pushes a special frame onto P's stack, sets PC to the handler.
6. **Handler returns.** When the handler returns, the kernel restores the original stack frame and resumes user code.

### Signals and threads

In multi-threaded processes (Go's case), signal delivery is more complex:

- Each thread has its own *signal mask* (`sigprocmask`). A masked signal is held pending for that thread.
- The kernel chooses an arbitrary thread for delivery — specifically, a thread that doesn't have the signal masked.
- If all threads have the signal masked, the signal stays pending at the process level until some thread unmasks.

For Go, the runtime configures a dedicated signal-handling thread (or thread group) and the rest of the threads usually have most signals masked.

### Coalescing

For standard (non-realtime) signals, multiple deliveries of the same signal *before* the process handles the first are coalesced. The process sees only one delivery. This is fine for SIGTERM (you only care that it arrived) but problematic for SIGCHLD (you want to reap each child exit).

### Realtime signals

`SIGRTMIN`+0 through `SIGRTMAX` (typically 34–64) are queued, not coalesced. Each delivery is preserved. Used for high-frequency notifications. Go uses one of these (`SIGURG`) internally for async preemption.

### `signal(2)` vs `sigaction(2)`

The kernel-level API. `signal(2)` is old and has inconsistent semantics across systems. `sigaction(2)` is the modern, portable API. Go uses `sigaction`.

### `kill(2)` and friends

`kill(pid, sig)` sends a signal to a process. `tgkill(tgid, tid, sig)` sends to a specific thread within a process. `pkill` is a command-line wrapper. Kubernetes' kubelet ultimately invokes a kill syscall.

### What `kill -9` actually does

`kill -9 <pid>` sends signal 9 (`SIGKILL`). The kernel sees this and:

1. Sets the SIGKILL pending bit.
2. Wakes the process.
3. Cleans up the process: closes file descriptors, releases memory, removes from process table.
4. *Does not invoke any user-space handler* — SIGKILL is not catchable.

The process is gone within microseconds.

---

## Go Runtime Signal Handling

Go's runtime handles signals in a way that is largely transparent to user code but quite sophisticated underneath.

### The signal-handling thread

The runtime starts a dedicated thread early on (in `runtime.signal_handle`). This thread:

- Has all signals unmasked (so it receives them all).
- Loops on a signal receiver.
- Dispatches signals to runtime internals and to user-space subscribers via the `os/signal` package.

### `sigaction` installation

The runtime calls `sigaction(2)` for every signal it cares about, installing its own handler in `runtime.sighandler`. This handler:

1. Saves the original signal context.
2. Checks if the signal should be forwarded to a user handler (registered via `signal.Notify`).
3. If a user handler is registered, the signal is queued internally.
4. Returns to the kernel; kernel resumes the interrupted code.

A goroutine inside the runtime (`signal_recv` in `runtime/sigqueue.go`) wakes up periodically and consumes the queued signals, then sends them on the appropriate channels.

### `signal_recv` goroutine

Reads from the internal queue. For each signal:

- Iterates over the registered channels for that signal.
- Sends the signal on each channel (non-blocking).

If a channel is full, the send is silently dropped. This is *why* `signal.Notify` channels must be buffered.

### Signal masking on M (thread) startup

When the runtime starts a new OS thread (M), it sets the thread's signal mask to block most signals, except a few essential ones (like `SIGURG` for preemption). This ensures signals go to the dedicated handling thread, not to arbitrary application threads.

### Async preemption via `SIGURG`

Since Go 1.14, the runtime sends `SIGURG` to a goroutine's hosting thread to preempt long-running goroutines (without cooperation). The handler in `runtime.sighandler` intercepts `SIGURG`, checks if preemption is intended, and arranges for the goroutine to yield.

This is one reason you should never subscribe to `SIGURG` via `signal.Notify` — you would interfere with preemption.

### Synchronous vs asynchronous signals

The runtime distinguishes:

- **Synchronous signals** (`SIGSEGV`, `SIGBUS`, `SIGFPE`, etc.): caused by the program itself (invalid memory access). Default action: panic the goroutine.
- **Asynchronous signals** (`SIGTERM`, `SIGINT`, etc.): sent externally. Default action: terminate the process.

The user-handler queue is for asynchronous signals; synchronous ones go straight to panic.

### Signal context save/restore

On signal delivery, the runtime saves the CPU registers (in `mcontext_t`) before invoking the handler. After the handler returns, registers are restored. This is what makes signal handling transparent to user code.

---

## The `os/signal` Package Internals

The `os/signal` package is the user-facing API for signal handling. Let's read its key functions.

### `signal.Notify(c chan<- os.Signal, sig ...os.Signal)`

```go
// from src/os/signal/signal.go
func Notify(c chan<- os.Signal, sig ...os.Signal) {
    if c == nil {
        panic("os/signal: Notify using nil channel")
    }
    handlers.Lock()
    defer handlers.Unlock()

    h := handlers.m[c]
    if h == nil {
        if handlers.ref == nil {
            handlers.ref = make(map[uint32]int64)
        }
        h = new(handler)
        handlers.m[c] = h
    }

    add := func(n int) {
        if n < 0 {
            return
        }
        if !h.want(n) {
            h.set(n)
            if handlers.ref[uint32(n)] == 0 {
                enableSignal(n)
            }
            handlers.ref[uint32(n)]++
        }
    }

    if len(sig) == 0 {
        for n := 0; n < numSig; n++ {
            add(n)
        }
    } else {
        for _, s := range sig {
            add(signum(s))
        }
    }
}
```

What it does:

1. Acquires the global handlers lock.
2. Gets or creates a `handler` struct for the channel.
3. For each signal:
   - If not already set, mark it as "wanted" on this handler.
   - If reference count for this signal is 0, call `enableSignal(n)` which calls into the runtime to start delivering this signal to user-space.
   - Increment reference count.

The reference count is what allows multiple `Notify` calls for the same signal: enabling happens once; disabling happens when ref count drops to zero (via `Stop`).

### `signal.Stop(c chan<- os.Signal)`

```go
func Stop(c chan<- os.Signal) {
    handlers.Lock()
    defer handlers.Unlock()
    h := handlers.m[c]
    if h == nil {
        return
    }
    delete(handlers.m, c)

    for n := 0; n < numSig; n++ {
        if h.want(n) {
            handlers.ref[uint32(n)]--
            if handlers.ref[uint32(n)] == 0 {
                disableSignal(n)
            }
        }
    }
}
```

Symmetric to `Notify`:

1. Removes the handler from the map.
2. For each signal previously wanted by this handler:
   - Decrement reference count.
   - If reference count is 0, call `disableSignal(n)` to stop delivery.

This is what makes `defer signal.Stop(ch)` non-optional: without it, the reference count stays elevated and signals continue being captured by the runtime even though no one is listening.

### The `process` function

The internal heart of `os/signal`:

```go
func process(sig os.Signal) {
    n := signum(sig)
    if n < 0 {
        return
    }

    handlers.Lock()
    defer handlers.Unlock()

    for c, h := range handlers.m {
        if h.want(n) {
            // Non-blocking send.
            select {
            case c <- sig:
            default:
            }
        }
    }
}
```

When the runtime calls `process` (via the `signal_recv` goroutine), this function iterates over all handlers, and for each handler interested in this signal, does a non-blocking send.

Three critical observations:

1. **The send is non-blocking.** A full channel silently drops the signal.
2. **Multiple handlers receive.** If you have two `signal.Notify` calls for SIGTERM, both channels get the signal.
3. **The lock is global.** During `process`, no `Notify`/`Stop` can run. Brief pause, but worth knowing.

### The runtime side: `runtime/sigqueue.go`

The runtime has its own queue. `signal_recv` reads from it:

```go
// from src/runtime/sigqueue.go
func signal_recv() uint32 {
    for {
        // Serve any signals from the local copy.
        for i := uint32(0); i < _NSIG; i++ {
            if sig.recv[i/32]&(1<<(i&31)) != 0 {
                sig.recv[i/32] &^= 1 << (i & 31)
                return i
            }
        }
        // ...wait for new signals...
    }
}
```

A bit-set tracks which signals have arrived. `signal_recv` clears the bit and returns the signal number.

User-space code (`os/signal.loop`) reads from `signal_recv` in a loop and calls `process` for each.

```go
func loop() {
    for {
        process(syscall.Signal(signal_recv()))
    }
}
```

### Why the buffered channel matters

Recall the channel-must-be-buffered rule. Here's why exactly:

- `process` does a non-blocking send (`select { case c <- sig: default: }`).
- If the channel is unbuffered AND no goroutine is reading, the send goes to `default` — signal dropped.
- If the channel is buffered (cap 1) AND no goroutine is reading, the send fills the buffer — signal preserved.

Buffer of 1 is enough because subsequent sends still go to `default` (drop), but the first one is preserved.

---

## Inside `signal.NotifyContext`

The Go 1.16+ helper. Source:

```go
// from src/os/signal/signal.go
func NotifyContext(parent context.Context, signals ...os.Signal) (ctx context.Context, stop context.CancelFunc) {
    ctx, cancel := context.WithCancel(parent)
    c := &signalCtx{
        Context: ctx,
        cancel:  cancel,
        signals: signals,
    }
    c.ch = make(chan os.Signal, 1)
    Notify(c.ch, signals...)
    if ctx.Err() == nil {
        go func() {
            select {
            case <-c.ch:
                c.cancel()
            case <-c.Done():
            }
        }()
    }
    return c, c.stop
}
```

The implementation is small:

1. Derive a context with `WithCancel`.
2. Create a buffered (cap 1) channel.
3. Register the channel with `signal.Notify`.
4. Spawn a goroutine that:
   - Cancels the derived context on first signal arrival.
   - Or returns when the parent is cancelled.

The `stop` function is `c.stop`:

```go
func (c *signalCtx) stop() {
    c.cancel()
    Stop(c.ch)
}
```

`stop` cancels the context (so `<-ctx.Done()` returns) and deregisters the channel from `signal.Notify`.

### Why `defer stop()` is mandatory

Without `defer stop()`:

- The signal handler is still registered. The reference count is elevated.
- The goroutine in step 4 is leaked (waiting on `c.ch`).
- `enableSignal(n)` was called but `disableSignal(n)` is never called.

In a long-running program, this is a small but real leak that accumulates if `NotifyContext` is called repeatedly (e.g., in tests).

### Why the goroutine inside

`NotifyContext` spawns its own goroutine to bridge channel-receive to context-cancellation. This goroutine is part of the API. Stopping it requires calling `stop` (or for the parent to be cancelled, which the `<-c.Done()` branch handles).

### `WithCancelCause` enhancement (Go 1.20+)

A small but useful pattern:

```go
func notifyWithCause(parent context.Context, sigs ...os.Signal) (context.Context, func()) {
    ctx, cancel := context.WithCancelCause(parent)
    ch := make(chan os.Signal, 1)
    signal.Notify(ch, sigs...)
    go func() {
        select {
        case s := <-ch:
            cancel(fmt.Errorf("signal: %v", s))
        case <-ctx.Done():
        }
    }()
    return ctx, func() {
        signal.Stop(ch)
        cancel(nil)
    }
}
```

Now `context.Cause(ctx)` returns the actual signal that caused the cancellation. Useful for logging.

---

## Inside `http.Server.Shutdown`

The full `Shutdown` implementation, abbreviated. Source: `src/net/http/server.go`.

```go
func (srv *Server) Shutdown(ctx context.Context) error {
    srv.inShutdown.Store(true)

    srv.mu.Lock()
    lnerr := srv.closeListenersLocked()
    for _, f := range srv.onShutdown {
        go f()
    }
    srv.mu.Unlock()
    srv.listenerGroup.Wait()

    pollIntervalBase := time.Millisecond
    nextPollInterval := func() time.Duration {
        // ... exponential backoff capped at 500ms ...
    }

    timer := time.NewTimer(nextPollInterval())
    defer timer.Stop()
    for {
        if srv.closeIdleConns() {
            return lnerr
        }

        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-timer.C:
            timer.Reset(nextPollInterval())
        }
    }
}
```

Step by step:

### Step 1: Set the shutdown flag

```go
srv.inShutdown.Store(true)
```

An atomic flag. Other parts of `http.Server` check this to reject new operations.

### Step 2: Close listeners

```go
lnerr := srv.closeListenersLocked()
```

Iterates over all registered listeners and closes them. The internal accept loop in `Serve` sees the close and returns. This is what stops new connections.

`closeListenersLocked`:

```go
func (srv *Server) closeListenersLocked() error {
    var err error
    for ln := range srv.listeners {
        if cerr := (*ln).Close(); cerr != nil && err == nil {
            err = cerr
        }
    }
    return err
}
```

Each listener's `Close()` is called. Errors are collected; first one is returned.

### Step 3: Fire `OnShutdown` callbacks

```go
for _, f := range srv.onShutdown {
    go f()
}
```

Each callback runs in its own goroutine. `Shutdown` does *not* wait for them.

### Step 4: Wait for listener-accept goroutines

```go
srv.listenerGroup.Wait()
```

`listenerGroup` is a `sync.WaitGroup` tracking the accept loop goroutines. Each accept loop decrements when it returns (which happens because the listener is closed).

### Step 5: Polling loop on idle / active connections

```go
for {
    if srv.closeIdleConns() {
        return lnerr
    }
    select {
    case <-ctx.Done():
        return ctx.Err()
    case <-timer.C:
        timer.Reset(nextPollInterval())
    }
}
```

`closeIdleConns` returns true when all connections are closed (both idle and active). The loop wakes periodically (initially 1 ms, exponentially up to 500 ms) and checks.

### `closeIdleConns`

```go
func (srv *Server) closeIdleConns() bool {
    srv.mu.Lock()
    defer srv.mu.Unlock()
    quiescent := true
    for c := range srv.activeConn {
        st, unixSec := c.getState()
        if st == StateNew && unixSec < time.Now().Unix()-5 {
            st = StateIdle
        }
        if st != StateIdle || unixSec >= time.Now().Unix() {
            quiescent = false
            continue
        }
        c.rwc.Close()
        delete(srv.activeConn, c)
    }
    return quiescent
}
```

For each tracked connection:

- Get its state and last-state-change timestamp.
- If state is `StateIdle` (keep-alive, no active request): close it and remove from the map.
- If state is `StateNew` and >5 seconds old: treat as idle.
- Otherwise (e.g., `StateActive`, `StateHandlingReadingRequest`): leave it; mark `quiescent = false`.

Return value: true if all connections were closed.

### Implications

- **Idle connections close fast.** The first iteration closes all of them.
- **Active connections must finish naturally.** No interruption.
- **The polling interval is bounded by 500 ms.** Even on the happy path (all connections idle), the *check* takes <1 ms but subsequent checks (if any) wait up to 500 ms. So an idle server can shut down in <5 ms.
- **An active connection holds the entire shutdown until it transitions to idle.**

### Why polling?

`Shutdown` could have used per-connection channels for notification. Polling was chosen for simplicity. The cost is small (one check every 500 ms, against a small map) compared to typical handler durations.

---

## Inside `http.Server.Close`

`Close` is much simpler than `Shutdown`:

```go
func (srv *Server) Close() error {
    srv.inShutdown.Store(true)
    srv.mu.Lock()
    defer srv.mu.Unlock()
    err := srv.closeListenersLocked()

    // Unlock srv.mu while waiting for listenerGroup.
    // The group Add and Done calls are made with srv.mu held,
    // to avoid adding a new listener in the window between
    // us setting inShutdown above and waiting here.
    srv.mu.Unlock()
    srv.listenerGroup.Wait()
    srv.mu.Lock()

    for c := range srv.activeConn {
        c.rwc.Close()
        delete(srv.activeConn, c)
    }
    return err
}
```

Steps:

1. Set the shutdown flag.
2. Close listeners.
3. Wait for accept goroutines to return.
4. *Close every active connection.*

The last step is the difference: `Close` does not wait for handlers to finish. It calls `rwc.Close()` on every connection, which immediately interrupts read/write operations in the handler. The handler typically sees an `io.EOF` or `*net.OpError` on its next read/write.

### What the handler sees

A handler in the middle of writing the response:

```go
w.Write([]byte("..."))
// If Close was called, this returns *net.OpError.
```

Most handlers ignore write errors. The truncated response is sent (or not). Connection is closed at the TCP layer. Client sees a connection reset.

### Why use `Close` after `Shutdown` failed?

After `Shutdown` returned `context.DeadlineExceeded`, some active connections are still hanging on. `Close` interrupts them. Without `Close`, the process cannot exit cleanly because the connection-handling goroutines are blocked.

### `RegisterOnShutdown` vs `Close`

`OnShutdown` hooks run at the start of `Shutdown`. They are *not* called by `Close`. If you have hooks that need to run even on force-close, call them separately.

---

## The `net.Listener` Lifecycle

The underlying mechanism for accepting connections.

### `net.Listener` interface

```go
type Listener interface {
    Accept() (Conn, error)
    Close() error
    Addr() Addr
}
```

`Accept` blocks until a new connection arrives. `Close` interrupts Accept (it returns an error indicating the listener is closed).

### `*net.TCPListener` internals

On Linux, `Accept` calls the `accept4(2)` syscall. The kernel's TCP stack maintains a queue of completed handshakes; `accept4` pops the next one.

`Close` calls `close(2)` on the listener's file descriptor. Subsequent `accept4` calls fail with `EINVAL` (or sometimes `EBADF`). The Go runtime maps this to a sentinel error indicating "use of closed network connection."

### File descriptor cleanup

The kernel reclaims the listener's fd. The TCP socket's accept queue is drained — incoming SYNs after the close are RST'd by the kernel.

### Reuse-port and graceful restart

Linux's `SO_REUSEPORT` lets multiple processes bind to the same port. Used for hot-restart: the new process binds; the old drains its connections; the kernel load-balances between them.

Setting it in Go:

```go
lc := net.ListenConfig{
    Control: func(network, address string, c syscall.RawConn) error {
        return c.Control(func(fd uintptr) {
            syscall.SetsockoptInt(int(fd), syscall.SOL_SOCKET,
                syscall.SO_REUSEPORT, 1)
        })
    },
}
ln, _ := lc.Listen(context.Background(), "tcp", ":8080")
```

Once bound with `SO_REUSEPORT`, another process can also bind; both receive new connections.

### TLS listener

`tls.NewListener(ln, tlsConfig)` wraps a raw listener. `Accept` returns `*tls.Conn`s. `Close` closes the underlying raw listener. The TLS handshake happens after `Accept`, in a per-connection goroutine.

---

## Connection State Tracking in `http.Server`

`http.Server` tracks each connection's state in a small state machine.

### States

```go
type ConnState int

const (
    StateNew ConnState = iota
    StateActive
    StateIdle
    StateHijacked
    StateClosed
)
```

- `StateNew`: just accepted, no bytes read yet.
- `StateActive`: in the middle of reading or writing a request/response.
- `StateIdle`: in keep-alive, waiting for next request.
- `StateHijacked`: handler took over the connection (WebSocket).
- `StateClosed`: closed.

### State transitions

```
[Accept] -> StateNew

[bytes received, request parsed] -> StateActive

[response sent, connection kept alive] -> StateIdle

[next request begins] -> StateActive

[connection closed] -> StateClosed

[handler hijacked] -> StateHijacked  (not tracked further)
```

### Why `Shutdown` cares

`Shutdown.closeIdleConns()` iterates over `activeConn`:

- For each in `StateIdle`: close it.
- For each in `StateActive`: leave it.
- For each in `StateHijacked`: not in the map (removed on transition).

So hijacked connections are not tracked. WebSockets are not waited for.

### `ConnState` hook

You can register a callback on every state transition:

```go
srv.ConnState = func(c net.Conn, s http.ConnState) {
    log.Printf("conn %v: %v", c.RemoteAddr(), s)
}
```

Useful for diagnostics. Performance cost is small but real (the callback runs per request per connection).

---

## `SIGKILL` Mechanics at the Kernel Level

What happens when `kill -9` lands.

### Inside the kernel

When the kernel receives SIGKILL for process P:

1. **Set the SIGKILL flag.** Even if signal masks block it, SIGKILL is unmaskable; the kernel proceeds.
2. **Mark P for termination.** The process exit state is set.
3. **Schedule P to wake up.** If P is sleeping in a syscall, the syscall is interrupted (`EINTR`).
4. **Execute `do_exit`.** The kernel's process-cleanup routine runs:
   - Close all file descriptors.
   - Release memory mappings.
   - Send `SIGCHLD` to the parent.
   - Remove from the process table.
5. **Reap.** When the parent calls `wait`, P is fully removed.

The whole thing takes microseconds.

### What survives a SIGKILL

- **File contents already written to disk.** Synchronous writes (with `fsync`) are persisted.
- **TCP packets already in the kernel send queue.** Sent to the network.
- **IPC objects.** Pipes, shared memory — until the last user of each closes.

### What does NOT survive

- **Userspace buffers.** Anything in `bufio.Writer`, in `os.File` write buffers (before `fsync`), in Go's log buffer — gone.
- **In-flight HTTP responses.** TCP layer sends RST.
- **Database transactions.** Not committed unless transaction was already committed.
- **Goroutines.** All gone.
- **`defer`s.** None run.

### Why this matters for graceful shutdown

If your shutdown plan relies on `defer` for cleanup, SIGKILL skips it. Graceful shutdown is the only way to ensure deferred cleanup runs.

### `OOM killer` and SIGKILL

On OOM (out of memory), the kernel's OOM killer picks a process and sends SIGKILL. Your process has no warning; it's just gone.

Mitigation: configure `oom_score_adj` (some scripts give the application a higher score than infrastructure components, so the app is killed first instead of, say, kubelet). Set memory limits in K8s so OOM affects you, not your noisy neighbour.

### Inside the container runtime

Container runtimes (containerd, CRI-O, Docker) wrap the application process in a cgroup. SIGKILL from the kubelet is delivered to the container's PID 1, which the runtime kills. If PID 1 is your Go binary, it's gone. If PID 1 is a shell wrapper, the shell is killed but the Go binary may continue briefly (depending on the wrapper's signal handling) until the kernel cleans up the cgroup.

---

## Container Runtime Signal Delivery

How signals propagate from the kubelet to your Go process.

### Layers

```
kubelet
  v
CRI (gRPC interface)
  v
container runtime (containerd, CRI-O)
  v
runc (OCI runtime)
  v
container init (PID 1 in the namespace)
  v
... container's process tree ...
  v
Go binary (somewhere in the tree)
```

The signal must traverse all of these layers.

### kubelet's StopContainer

When kubelet decides to stop a container:

1. Calls CRI's `StopContainer` with a timeout.
2. The runtime translates this to "send SIGTERM, wait for exit, then SIGKILL if not exited."
3. The signal is delivered to the container's init (PID 1 in the container's PID namespace).

### PID namespace

In a container, processes see a different PID space. The container's "PID 1" is your application (or a wrapper). From the host's perspective, this same process has a different PID.

### Signal propagation to children

Signals to PID 1 in a namespace are NOT automatically forwarded to child processes. If your Go binary is PID 1, SIGTERM goes to it directly. If a shell wrapper is PID 1 and your Go binary is a child, the shell must forward.

Most shells do NOT forward SIGTERM to children. The classic problem:

```dockerfile
CMD ["sh", "-c", "/app/server"]  # sh is PID 1; doesn't forward
```

The Go binary never sees SIGTERM. After the grace period, SIGKILL lands on the shell, which dies, which terminates the Go binary.

### Fixes

```dockerfile
ENTRYPOINT ["/app/server"]  # Go binary is PID 1
```

Or use a minimal init like tini:

```dockerfile
ENTRYPOINT ["/sbin/tini", "--", "/app/server"]
```

Tini forwards signals to children.

### `dumb-init` and `tini`

Both are small init systems for containers. They forward signals and reap zombies. K8s 1.17+ has `shareProcessNamespace: true` which uses a built-in pause container for similar functionality.

---

## Kubernetes kubelet Internals

The pod-termination flow from kubelet's perspective.

### kubelet's PodTerminator

When a pod is marked Terminating:

```
1. Get pod spec.
2. Run preStop hooks (if any).
3. SendStopSignal(SIGTERM) to all containers.
4. Start grace timer (terminationGracePeriodSeconds).
5. Watch for container exit.
6. On timer expiration, SendStopSignal(SIGKILL).
7. Wait for runtime to confirm container removed.
8. Cleanup pod resources.
```

### preStop hooks

Implemented in kubelet's `lifecycle` package. For `exec`:

```go
cmd := exec.Command("sh", "-c", spec.Exec.Command)
// ... run in the container namespace ...
err := cmd.Run()
```

For `httpGet`:

```go
req, _ := http.NewRequest("GET", spec.HTTPGet.Path, nil)
// ... add headers, scheme, host:port ...
resp, err := client.Do(req)
```

Both have a default timeout of 30 seconds. If preStop exceeds the timeout, kubelet logs a warning and proceeds to SIGTERM.

### Grace period budgeting

The grace timer starts *after* preStop completes. So total wall-clock from "begin terminating" to "SIGKILL" is approximately:

```
preStop duration + terminationGracePeriodSeconds
```

This is why you often see longer-than-expected pod terminations: preStop adds to the budget.

### Container exit detection

kubelet polls the container runtime for state changes. When the runtime reports the container exited, kubelet records the exit code and cleans up.

The polling interval is short (sub-second). Process exit is typically detected within 100 ms.

### Force-stop on grace expiration

If the timer expires, kubelet sends SIGKILL via the runtime. The kernel cleans up the process. kubelet then runs through the normal cleanup path.

### kubelet exit codes

The pod's exit reason is exposed:

```yaml
state:
  terminated:
    reason: Completed       # exit 0
    exitCode: 0
```

Or:

```yaml
state:
  terminated:
    reason: Error           # non-zero exit
    exitCode: 137           # SIGKILL (128 + 9)
```

Exit code 137 is the universal "SIGKILLed" indicator. If you see it, your pod hit the grace timer.

### `metrics`

kubelet emits metrics:

- `kubelet_container_log_filesystem_used_bytes`
- `kubelet_running_pods`
- `kubelet_node_name`

Plus container-level metrics that reveal slow shutdowns. The K8s ecosystem has dashboards for these.

---

## PID 1 and Signal Forwarding

A common production gotcha.

### Why PID 1 matters

In a container, PID 1 has special semantics in the kernel:

- Default signal handlers for SIGTERM, SIGINT, etc. are *no-op* (PID 1 is supposed to handle them explicitly).
- PID 1 is the parent of orphaned processes — when their actual parent dies, they reparent to PID 1.
- PID 1 must reap zombies, or the process table fills up.

### Go binaries as PID 1

A Go binary as PID 1 must handle these responsibilities. Fortunately, the Go runtime does it:

- The runtime's signal handler intercepts SIGTERM/SIGINT etc. normally.
- Subprocess management (`exec.Cmd`) reaps subprocess exits via `Wait`.

Most Go services as PID 1 work correctly. The only common failure is if you spawn subprocesses and don't `Wait` for them — zombies accumulate.

### Shell wrappers and PID 1

```dockerfile
CMD ["sh", "-c", "/app/server"]
```

The shell is PID 1. The Go binary is PID 2 (or higher). SIGTERM goes to the shell. The shell's default action for SIGTERM as PID 1 is... nothing. The signal is ignored.

After grace period, SIGKILL lands on the shell. The kernel kills it. The Go binary, having lost its parent, reparents to... no one (since PID 1 is gone too). The kernel kills the whole container's process tree as part of cleanup.

The Go binary never had a chance to handle SIGTERM.

### Tini and dumb-init

Both are minimal PID-1 inits that:

- Forward SIGTERM/SIGINT to all children.
- Reap zombies.

```dockerfile
ENTRYPOINT ["/sbin/tini", "--", "/app/server"]
```

Now tini is PID 1. Tini receives SIGTERM, forwards to the Go binary. The Go binary handles it normally.

### `shareProcessNamespace`

K8s 1.17+ has a pod-spec field `shareProcessNamespace: true`. All containers in the pod share a PID namespace. A pause container (`k8s.gcr.io/pause`) becomes PID 1. The pause container is a minimal init that reaps zombies.

With this set, your Go binary is NOT PID 1; the pause container is. Signal forwarding is automatic.

### Detecting PID 1 in code

```go
if os.Getpid() == 1 {
    log.Println("running as PID 1; signal handling should be tested")
}
```

Useful for diagnostic logging.

---

## Go Runtime Internals During Shutdown

What does the runtime do during `srv.Shutdown` and after `main` returns?

### `main` return and `exit`

When `main` returns:

1. The runtime calls `runtime.exit(0)`.
2. The runtime invokes deferred functions (none at this point, all main's defers already ran).
3. The runtime calls `os.Exit(0)`.

`os.Exit(0)`:

1. Calls user-registered `runtime/debug.SetPanicOnFault` etc. handlers (rarely used).
2. Calls `runtime.Goexit` for the main goroutine? No — that would only exit the main goroutine.
3. Calls the C `exit(0)` syscall.

The kernel cleans up the process.

### `os.Exit` vs `runtime.Goexit`

- `os.Exit(n)`: immediate process termination. No defers run.
- `runtime.Goexit()`: terminates the current goroutine. *Does* run deferred functions in that goroutine.

If `os.Exit` is called from `main`, no defers anywhere run. If `runtime.Goexit` is called from main, main's defers run, but the process continues with other goroutines until they exit.

Use `os.Exit` only via `log.Fatalf` at the top of `main`, after all defers.

### Goroutine cleanup at exit

When the process exits via `os.Exit`, all goroutines are summarily terminated. The runtime does not "unwind" their stacks. Any deferred functions in those goroutines do not run.

This is why critical cleanup (Sentry flush, log flush) should happen in `main` before `os.Exit`, not in deferred functions of other goroutines.

### `runtime.GC()` at shutdown?

The runtime does NOT trigger GC at process exit. There is no reason to: the kernel reclaims all memory.

If you want resource cleanup that runs at exit, register it explicitly.

### Finalizers

`runtime.SetFinalizer(obj, fn)` registers `fn` to run when `obj` is garbage-collected. Finalizers do NOT run at process exit. They run only when GC reclaims memory. At process exit, all objects are still alive (from the runtime's perspective); no GC happens.

Do not rely on finalizers for cleanup that needs to run at shutdown. Use explicit `Close` calls or defers.

### Signal-handling thread at exit

The runtime's signal-handling thread terminates when the process exits. No special handling needed.

---

## Performance Characteristics of Shutdown

Numbers help. Here are typical measurements.

### `signal.NotifyContext` overhead

Constant: about 200 ns to set up, 50 ns per signal type registered. Goroutine spawn: ~1 µs.

Total: typically <2 µs at startup. Negligible.

### Signal delivery latency

From kernel-marked-pending to user-channel-receive: typically 10–100 µs. Under load: up to several ms.

For graceful shutdown, this latency is irrelevant — the shutdown takes seconds, not microseconds.

### `srv.Shutdown` on idle server

Steps:

- `inShutdown.Store`: ~50 ns.
- `closeListenersLocked`: ~10 µs (close one fd).
- `listenerGroup.Wait`: ~1 µs (no pending Accepts).
- `closeIdleConns`: O(n) for n idle connections. Closing a TCP fd is ~5 µs each.
- Polling loop: returns immediately after first iteration.

Total for 100 idle connections: ~500 µs. Sub-millisecond.

### `srv.Shutdown` with active connections

Dominated by the polling loop. Each iteration: ~10 µs of overhead plus the sleep (1ms → 500ms exponentially).

For an 8-second drain (real-world handler latency), expect about 15 iterations: 1 + 2 + 4 + 8 + 16 + 32 + 64 + 128 + 256 + 500 + 500 + ... ms.

Total: 8 seconds + ~50 ms of polling overhead. The polling is not the bottleneck.

### `srv.Close` overhead

Same as `Shutdown` minus the polling loop, plus the active-connection closure loop. For 100 active connections: ~500 µs.

### Context cancellation propagation

`cancel()` is O(n) for n direct children. Each child's `cancel` is called recursively. For a tree of depth d and width w, total: O(w^d).

In typical services, the tree is shallow (depth 2–3) and narrow (width 10–100). Total: microseconds.

### Sentry / OTLP flush

These are external network calls. Typical latency: 50–500 ms. The `2*time.Second` flush timeout is comfortable.

### Total shutdown latency budget

A clean shutdown of a service with no active connections: ~100 ms.

A shutdown with 10 active connections finishing in 2 seconds: ~2.5 seconds.

A shutdown with 100 active connections, p99 handler 8s: ~8.5 seconds.

A shutdown with 1000 active connections, p99 handler 8s: ~10 seconds.

Sublinear in active connection count because they drain in parallel.

---

## Version-Specific Behaviour

Go's shutdown story has evolved.

### Go 1.0–1.7

No `http.Server.Shutdown`. Third-party packages (`manners`, `graceful`) provided it.

### Go 1.8 (Feb 2017)

`http.Server.Shutdown` added. Includes `RegisterOnShutdown`.

The first `Shutdown` did not properly handle HTTP/2. Patched in 1.8.1.

### Go 1.9

Improvements to keep-alive handling. Idle connections close more reliably.

### Go 1.11–1.13

Minor improvements. `Shutdown` honours `BaseContext` and `ConnContext` (added 1.13).

### Go 1.14

Async preemption via SIGURG. The runtime now interrupts long-running goroutines without cooperation. Side effect: subscribing to SIGURG via `signal.Notify` interferes with preemption.

### Go 1.16

`signal.NotifyContext` added. Major ergonomic improvement.

### Go 1.20

`context.WithCancelCause` added. Useful for richer cancellation reasons.

### Go 1.21

`context.AfterFunc` added. `context.WithDeadlineCause` added.

### Go 1.22

Loop-variable scoping changed. Some old `for i := range ...; go f(i)` patterns work differently.

### Go 1.23

Iterators (`range func`) added. Not directly shutdown-related but enable cleaner iteration patterns.

### Go 1.24+

Future improvements to context, signals, and net/http likely.

### Compatibility implications

A service that targets Go 1.14+ can use async preemption confidently. A service that targets 1.16+ can use `signal.NotifyContext` cleanly. A service that targets 1.20+ can use cancel-with-cause.

Most production services run 1.21+ today.

---

## Reading the Standard Library Source

For the professional, reading the source is essential. A few files to know.

### `src/os/signal/signal.go`

The user-facing `signal.Notify`, `signal.Stop`, `signal.NotifyContext`. About 350 lines. Clear, well-commented.

### `src/os/signal/signal_unix.go`

UNIX-specific signal handling. The `loop` function is the goroutine that reads from `signal_recv`.

### `src/runtime/sigqueue.go`

The internal signal queue. `signal_recv`, `signal_enable`, `signal_disable`. About 250 lines. Detailed comments on the bit-set implementation.

### `src/runtime/signal_unix.go`

The runtime's signal handler. About 1000 lines. Dense, but readable. Shows how the runtime intercepts signals and dispatches them.

### `src/net/http/server.go`

The HTTP server implementation. `Shutdown`, `Close`, `Serve`, `ListenAndServe`. About 4000 lines. The `Shutdown` method is around line 2400. Read it; it is well-commented.

### `src/net/net.go`, `src/net/fd_unix.go`

Listener and connection internals. `Close` semantics for fd's.

### `src/context/context.go`

Context implementation. `WithCancel`, `WithTimeout`, propagation. About 800 lines.

### Recommendation

Pick one file. Spend an hour reading it. Take notes. The Go standard library is some of the most polished open-source code; you will learn idioms by reading.

---

## Performance Profiling of Shutdown

For the professional engineer concerned with shutdown performance:

### Profiling tools

- `pprof` (CPU, memory, goroutines, blocking).
- `runtime.Trace` (Go's execution tracer; visualises scheduling).
- `dlv` (Go debugger; can inspect goroutine states during shutdown).
- `perf` (Linux; for kernel-side profiling).
- `bpftrace` (eBPF; for kernel events including signal delivery).

### A pprof workflow for slow shutdown

If shutdown is slow:

1. Trigger shutdown.
2. Before it completes, capture: `curl http://host:port/debug/pprof/goroutine?debug=2`.
3. Examine: which goroutines are blocked? On what?

The goroutine dump reveals stuck goroutines. Most are usually:

- HTTP handlers waiting on downstream.
- Workers in a blocking syscall.
- The Shutdown's polling loop itself.

The remaining are the bug.

### A trace for shutdown timeline

```go
import _ "net/http/pprof"
import "runtime/trace"

// at shutdown start:
f, _ := os.Create("/tmp/shutdown.trace")
trace.Start(f)
defer trace.Stop()
defer f.Close()
```

The trace shows every scheduling decision. Open with `go tool trace`. Useful for understanding contention at shutdown.

### Counting handler durations during shutdown

Instrument the middleware:

```go
defer func(t time.Time, p string) {
    metric.HandlerDurationDuringShutdown.WithLabelValues(p).Observe(time.Since(t).Seconds())
}(time.Now(), r.URL.Path)
```

After production for a week, the histograms reveal the slow paths.

### Kernel-side profiling

For extremely deep diagnosis:

```bash
bpftrace -e 'kprobe:do_signal { @[comm, pid] = count(); }'
```

Counts signal-handling kprobe hits per process. Useful when investigating "signal not delivered" mysteries.

---

## Edge Cases at the Lowest Level

A grab bag of edge cases the professional engineer encounters.

### Edge case: signal during `select` with no `ctx.Done` case

```go
select {
case msg := <-ch:
case <-time.After(time.Second):
}
```

A signal arriving during this select does NOT interrupt it. The runtime queues the signal for delivery via the signal channel; user-space `select` is unaffected. To make select responsive to shutdown, include `<-ctx.Done()`.

### Edge case: blocking syscall during shutdown

A goroutine in a blocking syscall (e.g., a sync `read` from a slow file) cannot be interrupted by context cancellation. The syscall blocks indefinitely until it completes or the file descriptor is closed.

For network reads, closing the connection's fd makes the syscall return `EINTR` or `io.EOF`. For disk reads, you usually cannot interrupt.

Workaround: do not perform blocking disk I/O without async wrappers.

### Edge case: `time.Sleep` and signals

`time.Sleep(d)` blocks in a way that does NOT respond to signals. A signal arrives, the runtime handles it, but `time.Sleep` keeps sleeping.

For shutdown-aware sleep:

```go
select {
case <-time.After(d):
case <-ctx.Done():
}
```

### Edge case: zero-byte Read returning before signal

A `Read` returning 0 bytes (without error) means EOF *or* nothing yet. Some implementations may return immediately after a signal interrupts. This is implementation-defined and can confuse handlers.

### Edge case: socket linger

A TCP socket has a `SO_LINGER` option. With linger enabled, `close` blocks until queued data is sent. During shutdown, this can prolong `Close` calls.

```go
tcpConn, _ := conn.(*net.TCPConn)
tcpConn.SetLinger(0) // immediate close, drop unsent data
```

Most servers don't need to mess with linger.

### Edge case: TIME_WAIT after shutdown

After your server closes a connection, the TCP state on the server side moves to TIME_WAIT for 60 seconds (Linux default). The port may not be immediately reusable. Set `SO_REUSEADDR`:

```go
lc := net.ListenConfig{
    Control: func(_, _ string, c syscall.RawConn) error {
        return c.Control(func(fd uintptr) {
            syscall.SetsockoptInt(int(fd), syscall.SOL_SOCKET,
                syscall.SO_REUSEADDR, 1)
        })
    },
}
```

The Go runtime sets this by default for HTTP servers, but for raw `net.Listen` you may need to do it manually.

### Edge case: file descriptor exhaustion

A shutdown that accumulates file descriptors (a leak) can hit `EMFILE` ("too many open files"). The shutdown itself becomes slow because each new socket fails.

Diagnose: `lsof -p <pid>`. Solve: find the leak.

### Edge case: ulimit and shutdown

The process's `ulimit -n` (max open files) caps how many connections it can serve. During shutdown, connections being closed don't count toward the limit; idle ones do.

### Edge case: connection close in TLS

A TLS connection has a graceful close (close-notify alert). Without it, the peer sees an unexpected close. `tls.Conn.Close()` sends close-notify; raw `*net.TCPConn.Close()` does not.

When `http.Server.Close` is called, it uses `conn.Close()` which for TLS connections invokes the proper close-notify. So this is usually correct.

### Edge case: forks during shutdown

If your service spawns subprocesses during normal operation, what about during shutdown? Don't. Shutdown is a "no new work" phase; no new processes should be created.

If you accidentally spawn during shutdown, the child may inherit closed file descriptors and behave unexpectedly.

### Edge case: shutdown during init

If `signal.NotifyContext` is called *before* dependent initialisation (DB, Redis), and a signal arrives during init, the init may fail with `context.Canceled`. This is desirable behaviour — init bails out cleanly.

But if init's error handling is wrong, the program may keep running with a partially-initialised state. Always check `ctx.Err()` in init and propagate cancellation up.

### Edge case: deferred mutex unlocks during panic

```go
mu.Lock()
defer mu.Unlock()
panic("oops")
```

Deferred Unlock runs before the panic propagates. The mutex is correctly released. Subsequent goroutines can acquire it.

But if the panic is during shutdown, the program may exit before subsequent goroutines run. The mutex's state doesn't matter at that point.

### Edge case: `runtime.LockOSThread` and signals

A goroutine pinned to an OS thread via `runtime.LockOSThread` has its own signal mask considerations. Most user code doesn't need this; CGo callers may.

---

## Conclusion

The professional level treats graceful shutdown as a *mechanism* to understand, not just an architecture to apply. The kernel's signal delivery, the runtime's interception, the standard library's implementation, the container runtime's choreography, the kubelet's algorithm — each is a layer with its own internals.

Knowing them is the difference between:

- "The service won't shut down cleanly; let me file a ticket."
- "The service has a SIGTERM-not-delivered issue because PID 1 is the shell. Add tini or change CMD to ENTRYPOINT."

The first is a junior diagnosis. The second is a professional one.

You have now read four levels of graceful shutdown content. The junior file gave you the recipe. The middle file gave you the system. The senior file gave you the architecture. This professional file gave you the mechanism.

A reader who has internalised all four pages can:

- Write graceful shutdown in any Go service from scratch.
- Design shutdown for any system architecture.
- Debug shutdown issues at any layer.
- Mentor others through the patterns.

That is the bar. Onwards to the specifications, interview questions, hands-on tasks, find-the-bug exercises, and optimization challenges in the remaining files. Mastery is built through repetition and practice.

---

## Appendix: A Reading Trail Through the Source

For the deeply curious, a recommended order to read the relevant Go source files:

1. `src/os/signal/signal.go` (350 lines) — Understand `Notify`, `Stop`, `NotifyContext`.
2. `src/os/signal/signal_unix.go` (~100 lines) — The signal-receive loop.
3. `src/runtime/sigqueue.go` (250 lines) — The internal signal queue.
4. `src/runtime/signal_unix.go` (~1000 lines, skim) — Runtime's signal handler.
5. `src/context/context.go` (800 lines) — `WithCancel`, `WithTimeout`.
6. `src/net/net.go` and `src/net/fd_unix.go` (skim) — Listener and conn internals.
7. `src/net/http/server.go` (4000 lines, focus on `Shutdown` and `Close`) — HTTP server.

A weekend spent on this list makes you a *de facto* expert. The Go source is some of the cleanest production code in any language.

---

## Appendix: A Glossary of Kernel-Level Terms

Terms that come up in this file:

| Term | Meaning |
|---|---|
| Signal | Small numeric IPC message from kernel to process. |
| `task_struct` | Linux kernel's process descriptor. |
| `sigaction` | The modern syscall for installing a signal handler. |
| `sigprocmask` | The syscall for setting a thread's signal mask. |
| PID namespace | Container's isolated PID space. |
| cgroup | Linux's resource-control mechanism for groups of processes. |
| `kill(2)` | The syscall for sending a signal. |
| `tgkill(2)` | Send a signal to a specific thread in a process. |
| OCI | Open Container Initiative; standard for container runtimes. |
| CRI | Container Runtime Interface; kubelet's API to runtimes. |
| `runc` | The reference OCI runtime; spawns containers via Linux primitives. |
| `containerd` | A higher-level container runtime built on `runc`. |
| `do_exit` | Linux kernel's process-exit cleanup routine. |
| `EINTR` | "Interrupted system call"; returned when a signal interrupts. |
| `EMFILE` | "Too many open files" error. |
| TIME_WAIT | TCP state after close, holds socket for ~60s. |
| `SO_REUSEADDR` | Socket option allowing rebinding to a port in TIME_WAIT. |
| `SO_REUSEPORT` | Socket option allowing multiple processes to bind the same port. |
| close-notify | TLS alert for graceful close. |

A working knowledge of these terms is the prerequisite for kernel-level debugging.

---

## Appendix: A One-Page Mental Model of the Whole Stack

```
+---------------------------------------+
|        Customer's browser             |
|        (sees 503 or success)          |
+----------------|----------------------+
                 |
+----------------v----------------------+
|     Cloud LB (ALB, GCP LB, etc.)      |
|     Health check, endpoint routing    |
+----------------|----------------------+
                 |
+----------------v----------------------+
|     K8s kube-proxy (iptables/IPVS)    |
|     Service-to-pod routing            |
+----------------|----------------------+
                 |
+----------------v----------------------+
|     Pod's container network (CNI)      |
+----------------|----------------------+
                 |
+----------------v----------------------+
|     Container runtime (containerd)     |
|     PID namespace, cgroup              |
+----------------|----------------------+
                 |
+----------------v----------------------+
|     Container's init (PID 1)           |
|     Signal forwarding (or not)         |
+----------------|----------------------+
                 |
+----------------v----------------------+
|     Go binary                          |
|     Runtime signal handler             |
+----------------|----------------------+
                 |
+----------------v----------------------+
|     os/signal package                  |
|     Channel-based delivery             |
+----------------|----------------------+
                 |
+----------------v----------------------+
|     Application code                   |
|     signal.NotifyContext, srv.Shutdown |
+---------------------------------------+
```

Every layer above your application code is doing work for you. Understanding what each layer does — and what it does NOT do — is the professional's superpower.

When something goes wrong at shutdown, the problem is in one of these layers. The professional engineer diagnoses methodically, layer by layer, until they find it.

---

## Appendix: How to Become a Professional-Level Engineer on This Topic

A condensed plan:

1. **Read this file twice.** Slowly. Take notes.
2. **Read the source files in the trail above.** One per evening.
3. **Run experiments.** Modify standard library; observe behaviour. Use `go install` for local builds.
4. **Use `strace`** to watch signals in real-time:
   ```bash
   strace -p $(pidof yourbinary) -e signal
   ```
5. **Use `bpftrace`** to watch kernel events.
6. **Read incident postmortems** from cloud providers; many involve shutdown.
7. **Contribute to open source.** Go itself, popular libraries.
8. **Write a small replacement.** Implement a tiny `Shutdown`-like in your own package.
9. **Mentor others.** Teaching reveals gaps.
10. **Stay current.** Read Go release notes; track issues in `golang/go`.

A year of this turns "I read Mike Lin's article" into "I know the runtime well."

---

## Final Words for the Professional Reader

The professional layer is rarefied. Most teams don't need this depth. Some do.

The skills here apply far beyond graceful shutdown:

- Kernel signal handling is also relevant for process management, debugging, profiling.
- Go runtime knowledge transfers to performance tuning generally.
- Container runtime understanding helps in capacity planning and SRE work.
- The "read the source" discipline applies to every problem.

A professional engineer who masters this file has the toolkit to solve any low-level issue in a Go service. Shutdown is just where this knowledge first becomes load-bearing.

The graceful shutdown topic is complete. The remaining files (specification, interview, tasks, find-bug, optimize) are reference and practice material.

Carry the knowledge forward.

---

## Extended Topic: Detailed Walkthrough of Signal Path

For the truly curious, an annotated tour of what happens when SIGTERM arrives at a Go process.

### Time t=0: The kernel decides to deliver

The kubelet has invoked `kill(pid, 15)` via its runtime layer. The kernel's `kill` syscall implementation:

```c
// simplified
SYSCALL_DEFINE2(kill, pid_t, pid, int, sig) {
    return do_send_signal(pid, sig);
}
```

`do_send_signal` looks up the target process, checks permissions (sender must have same UID or be root), then dispatches.

### Time t=0+ε: Setting pending bit

In the target's `task_struct`, the SIGTERM bit (15) is set in `pending.signal`. If the process has a signal mask blocking SIGTERM (rare), it stays pending until unblocked.

### Time t=0+δ: Wake the target

If the target is sleeping in a syscall (e.g., `read` from a TCP socket), the kernel marks the task as runnable and the wait queue's wake mechanism kicks in. The target thread becomes runnable.

The runtime is typically scheduled within microseconds.

### Time t=tiny: Return to userspace

The kernel returns from the syscall (or from a timer-interrupt-induced context switch). Before resuming userspace, the kernel checks for pending signals.

For each pending signal, the kernel looks up the action:

- Default: take default action (terminate, ignore, etc.).
- Ignore: do nothing.
- User handler: invoke it.

For Go, every catchable signal has a user handler installed by the runtime.

### Time t=tiny+: Runtime signal handler

The kernel arranges to call `runtime.sigtramp` (assembly) which sets up the Go call stack and calls `runtime.sighandler`.

`runtime.sighandler` does:

1. Save the interrupted goroutine's state.
2. Identify the signal.
3. Determine if it's synchronous (caused by current goroutine) or asynchronous.
4. For async signals: forward to user-space via `signal_recv` queue.
5. Restore the interrupted goroutine's state.
6. Return to kernel; kernel resumes the interrupted code.

The actual handler executes in ~microseconds, on the same thread that was interrupted.

### Time t=tiny+more: `signal_recv` wakes

The runtime's `signal_recv` goroutine is parked on a futex. The signal-enqueue path wakes it.

`signal_recv` reads the signal number from the bit-set, returns it. The caller (`os/signal.loop`) calls `process(sig)`.

### Time t=tiny++: Channel send

`process(sig)` iterates handlers, does non-blocking sends. For our `signal.NotifyContext` channel, the channel has cap 1 and is empty. The send succeeds.

### Time t=tiny+++: User goroutine awakes

The `signal.NotifyContext`'s internal goroutine is parked on `<-c.ch`. The send wakes it. It calls `c.cancel()`.

### Time t=tiny++++: Context propagation

`c.cancel()` walks the context tree. Each derived context's `Done()` channel is closed. All goroutines waiting on those channels wake.

### Time t=tiny+++++: User code reacts

`main`'s `<-rootCtx.Done()` returns. `main` proceeds to call `srv.Shutdown(ctx)`.

### Total latency

From kernel signal-pending bit set to `main`'s `<-rootCtx.Done()` returning: typically 50–500 µs. Mostly scheduler latency.

This is fast enough that the latency is invisible in shutdown logs. The shutdown delay is dominated by what comes next (draining handlers), not signal-handling latency.

---

## Extended Topic: How `signal.Notify` Tracks Subscribers

The `handlers` global:

```go
var handlers struct {
    sync.Mutex
    m   map[chan<- os.Signal]*handler
    ref map[uint32]int64
}
```

- `m` maps channels to handler structs.
- `ref` counts how many handlers are subscribed to each signal.

The `handler` struct:

```go
type handler struct {
    mask [(numSig + 31) / 32]uint32
}

func (h *handler) want(sig int) bool {
    return (h.mask[sig/32]>>(uint(sig)&31))&1 != 0
}

func (h *handler) set(sig int) {
    h.mask[sig/32] |= 1 << (uint(sig) & 31)
}
```

Each handler has a bit-set of "wanted" signals. Compact and fast.

### Multiple `Notify` calls

If you call `Notify` twice for the same channel and different signals:

```go
ch := make(chan os.Signal, 1)
signal.Notify(ch, syscall.SIGTERM)
signal.Notify(ch, syscall.SIGINT)
```

Both calls find the same handler struct in `m[ch]`. Each sets the corresponding bit in the mask. The `ref` for each signal is incremented.

After this, `ch` receives both SIGTERM and SIGINT. Equivalent to:

```go
signal.Notify(ch, syscall.SIGTERM, syscall.SIGINT)
```

### `Stop` with multiple subscriptions

If two channels subscribe to SIGTERM and one calls `Stop`:

```go
ch1 := make(chan os.Signal, 1)
ch2 := make(chan os.Signal, 1)
signal.Notify(ch1, syscall.SIGTERM)
signal.Notify(ch2, syscall.SIGTERM)
// ref[SIGTERM] = 2

signal.Stop(ch1)
// ref[SIGTERM] = 1 (still > 0; signal still delivered to ch2)
```

`disableSignal(SIGTERM)` is NOT called until `ref` drops to 0. Good design — multiple subscribers don't interfere.

### What happens if you `Notify` then `Stop` then `Notify` again

```go
ch := make(chan os.Signal, 1)
signal.Notify(ch, syscall.SIGTERM)  // ref=1, enabled
signal.Stop(ch)                      // ref=0, disabled
signal.Notify(ch, syscall.SIGTERM)  // ref=1, enabled again
```

Standard library handles this cleanly. The handler struct may or may not be recreated; either way, subscription is correct.

### Race conditions

`signal.Notify` and `signal.Stop` use `handlers.Mutex`. They are race-free.

The internal `process` function also uses this mutex. During `process`, `Notify`/`Stop` are blocked briefly. Brief contention; no practical issue.

---

## Extended Topic: The HTTP Server's Connection Tracking Loop

The full lifecycle of a request from `http.Server`'s perspective.

### Accept

```go
func (srv *Server) Serve(l net.Listener) error {
    // ... boilerplate ...
    for {
        rw, err := l.Accept()
        if err != nil {
            select {
            case <-srv.getDoneChan():
                return ErrServerClosed
            default:
            }
            // ... handle error ...
        }
        connCtx := ctx
        if cc := srv.ConnContext; cc != nil {
            connCtx = cc(connCtx, rw)
        }
        c := srv.newConn(rw)
        c.setState(c.rwc, StateNew, runHooks)
        go c.serve(connCtx)
    }
}
```

Each accepted connection becomes a `*conn` struct. `setState(StateNew)` adds it to `srv.activeConn`. A goroutine handles it.

### `c.serve`

```go
func (c *conn) serve(ctx context.Context) {
    // ... handshake, panic recover, etc. ...
    for {
        w, err := c.readRequest(ctx)
        if c.r.remain != c.server.initialReadLimitSize() {
            c.setState(c.rwc, StateActive, runHooks)
        }
        if err != nil {
            // ... handle errors, close connection ...
            return
        }
        c.curReq.Store(w)
        // serve the request
        serverHandler{c.server}.ServeHTTP(w, w.req)
        // ... cleanup ...
        if !w.shouldReuseConnection() {
            // ... close ...
            return
        }
        c.setState(c.rwc, StateIdle, runHooks)
        // ... wait for next request ...
    }
}
```

The loop: read request, mark active, serve, mark idle, wait for next request. State transitions are tracked.

### State on `Shutdown`

When `Shutdown` is called, it scans `activeConn`. Connections in `StateIdle` are closed immediately. Connections in `StateActive` continue serving; their state will transition to `StateIdle` after the handler returns. The polling loop catches them then.

### `Hijack`

If the handler calls `w.(http.Hijacker).Hijack()`, the connection is removed from `activeConn` and the handler takes over the raw conn. `Shutdown` is no longer aware of it.

### `BaseContext` and `ConnContext`

```go
srv.BaseContext = func(_ net.Listener) context.Context {
    return rootCtx
}
srv.ConnContext = func(ctx context.Context, c net.Conn) context.Context {
    return ctx
}
```

`BaseContext` provides the context for the listener (every connection inherits). `ConnContext` derives a per-connection context.

These were added in Go 1.13 to make `http.Server` shutdown-aware. By passing `rootCtx` as the base, every connection's context is cancelled when `rootCtx` is cancelled — which means every handler's `r.Context()` is also cancelled.

This is a powerful pattern often overlooked. Setting `BaseContext` to `rootCtx` makes ALL handlers shutdown-aware automatically:

```go
srv := &http.Server{
    BaseContext: func(_ net.Listener) context.Context {
        return rootCtx
    },
}
```

After this, no need for `serviceCtx`-linking middleware. The handlers' contexts are already linked.

### Effect on `Shutdown`

`Shutdown` does NOT cancel `BaseContext` for active connections. The handlers' contexts remain alive until the connections close (or `Close` is called).

But because `BaseContext` derives from `rootCtx`, and `rootCtx` is already cancelled when shutdown begins, the handlers' contexts are already cancelled. Handlers that respect `r.Context()` exit promptly.

This is a major optimization for shutdown latency. Without it, handlers would only know to exit when their stream-context fires, which may take a while.

---

## Extended Topic: The `defer` Mechanism and Shutdown

A subtle aspect of `defer` that matters during shutdown.

### How `defer` works

When `defer fn()` is executed, the function and its arguments are evaluated, then a record is pushed onto the goroutine's defer chain. When the function returns (or panics), records pop and execute in LIFO order.

### `defer` cost

Pre-Go 1.13, each `defer` was a heap allocation. Now it's stack-allocated in most cases (small fast path). Cost: ~50 ns per defer for the fast path; ~1 µs for heap-allocated.

### `defer` and `os.Exit`

`os.Exit` calls the C `exit(0)` syscall directly. It does NOT unwind the Go call stack. No defers run.

This is the most common shutdown-related defer gotcha.

### `defer` and `panic`

A panic does unwind the stack. Defers run in reverse order until a `recover` catches the panic (or the goroutine itself terminates).

A panic in shutdown code propagates through `main`'s defers. If main's deferred function is something like `db.Close()`, it might not run (depending on what panic'd).

Defensive pattern:

```go
func main() {
    defer func() {
        if r := recover(); r != nil {
            log.Printf("panic at shutdown: %v", r)
        }
    }()
    // ... rest of main ...
}
```

The recover at the top of main lets shutdown defers complete even if something panics.

### `defer` performance under shutdown

If your shutdown registers many defers, they all run at main's return. For 100 defers, total cost ~5 µs. Negligible.

The slow part of shutdown is not defers; it's I/O.

### `runtime.Goexit` and defers

`runtime.Goexit()` terminates the current goroutine, running its defers. It does NOT affect other goroutines.

Useful for "exit this goroutine cleanly without panicking." Rarely used in shutdown.

---

## Extended Topic: Memory Behaviour During Shutdown

How does memory usage change during shutdown?

### Allocations

`Shutdown` itself allocates minimally — a few timer structs, a few small slices. Negligible.

Handlers in flight may continue allocating until they return. If GC is needed, it happens normally.

### Goroutine stack reclamation

When a goroutine exits, its stack is reclaimed by the runtime. This happens at exit, not at GC.

If your shutdown waits for many goroutines to exit, you'll see live-stack memory dropping as they finish.

### GC during shutdown

The Go GC runs concurrently. It doesn't stop because of shutdown. If shutdown is slow because of contention, GC may run more often.

For shutdown latency analysis, GC is usually not the bottleneck.

### Final GC at exit?

The runtime does NOT run a final GC at process exit. There's no point — the kernel reclaims all memory.

If you have finalizers that need to run, they don't run at exit. Use explicit cleanup.

### Heap snapshots during shutdown

For diagnosis, capture a heap snapshot during a slow shutdown:

```
curl http://host:port/debug/pprof/heap > heap.prof
go tool pprof heap.prof
```

The snapshot shows what's allocated. Slow shutdowns sometimes reveal leaked goroutines or large pending buffers.

---

## Extended Topic: Container Runtime Deep Dive

The path from kubelet to your process.

### containerd's signal-sending

containerd is the dominant container runtime in modern K8s. When kubelet asks it to stop a container:

1. containerd's gRPC API receives `StopContainer(timeout)`.
2. containerd queries the container's state.
3. containerd invokes `runc kill <container-id> TERM` (or via its task layer).
4. runc reads the cgroup info and uses `kill(pid, SIGTERM)` on the container init process.
5. containerd waits up to `timeout` for the container to exit.
6. If timeout elapses, containerd invokes `runc kill <container-id> KILL`.

### Why `runc kill` is special

`runc kill` knows the container's PID 1 (in the host's PID space) from its container state. It sends the signal directly. There's no shell or wrapper involved.

### Differences with Docker

Docker (with its old daemon) had its own signal-sending path. Behaviour was largely the same. Modern Docker (with containerd backend) just uses containerd directly.

### Differences with podman

Podman is a runtime alternative. Signal sending is similar; uses `runc` underneath.

### Differences with `gVisor` and `Kata`

Sandboxed runtimes like gVisor (Google) and Kata (lightweight VMs) intercept syscalls. Signal handling can have small additional latency. Behaviour from the application's perspective is the same.

---

## Extended Topic: K8s Pod Lifecycle Edge Cases

A few non-obvious K8s behaviours.

### "Phantom" Terminating pods

A pod stuck in Terminating state for a long time often means the application is not exiting. kubelet has sent SIGTERM and is waiting. If the timer fires, it sends SIGKILL.

If even after SIGKILL the pod is stuck, the issue is at the container runtime level. Sometimes restarting the kubelet or rebooting the node helps.

### `ForceDelete` (`--force --grace-period=0`)

`kubectl delete pod --force --grace-period=0` skips the grace period and immediately removes the pod object from the API server. The kubelet may or may not have terminated the container yet.

This is dangerous: the actual process may still be running, holding resources. Use sparingly.

### Pre-emptible / spot nodes

Cloud-provider spot nodes can be reclaimed with ~30 seconds notice. K8s gets a signal; the kubelet drains pods. Your `terminationGracePeriodSeconds` must fit in the spot-eviction window.

For services on spot nodes, `terminationGracePeriodSeconds: 25` is a safe default.

### Node draining (`kubectl drain`)

`kubectl drain <node>` evicts all pods from a node (for maintenance). Each pod goes through the normal termination lifecycle. PodDisruptionBudgets are respected.

### `kubectl rollout restart`

Restarts all pods in a Deployment without changing the spec. Each pod is recreated; the old goes through termination, the new starts. Useful for picking up new configs or recovering from transient state.

### StatefulSet termination

StatefulSets terminate in reverse-ordinal order (largest index first). Each pod's termination follows the normal flow.

### Job and CronJob

`Job` pods terminate when the work completes. They typically don't need graceful shutdown for in-flight work (they have no in-flight work after completion). But they may need to flush metrics, traces, logs.

`CronJob` is just a Job scheduler. Same applies.

---

## Extended Topic: HTTP/2 Specifics During Shutdown

HTTP/2 has its own quirks for shutdown.

### `GOAWAY` frame

When `http.Server.Shutdown` is called, the HTTP/2 layer sends a `GOAWAY` frame to each HTTP/2 client. The frame says: "do not open new streams on this connection."

The client may finish existing streams but should not start new ones. After the client's last stream finishes, the connection is closed.

### Client behaviour

A well-behaved client (browsers, Go's `http.Client`) respects `GOAWAY` and opens a new connection (perhaps to a different backend) for new requests.

A misbehaving client might ignore `GOAWAY` and keep trying. The server eventually times out and closes the connection.

### Trailers and `GOAWAY`

Some HTTP/2 servers send trailers (final response headers after the body). During shutdown, in-flight streams must complete normally including trailers.

`http.Server.Shutdown` handles this.

### Push streams

HTTP/2 server push is rarely used. If used, push streams are in-flight and waited for like any other stream.

### HTTP/3 (QUIC) considerations

HTTP/3 over QUIC has its own connection lifecycle. The pattern is similar — send a "no new streams" signal, drain existing — but the implementation differs.

Go's standard library does not yet have HTTP/3 support (as of late 2025). Third-party libraries (`quic-go`) exist. The shutdown pattern transfers.

---

## Extended Topic: TLS Handshake During Shutdown

A subtle interaction.

### `Shutdown` and in-progress handshake

A TCP connection accepted but mid-handshake is in `StateNew`. Its state will transition to `StateActive` (or to closed if handshake fails).

If `Shutdown` runs while the handshake is in progress, the connection counts as `StateNew`. The 5-second rule in `closeIdleConns` will eventually close it. But until then, it counts as active.

For fast shutdown, `ReadHeaderTimeout` is your friend — it bounds the time a connection can sit in `StateNew`.

### Client certificate verification

If you require client certificates, the handshake includes a verification step that may involve fetching CRLs or OCSP responses. If those network calls are slow, the handshake can take seconds.

For fast shutdown, OCSP stapling (server pre-fetches OCSP response) avoids the per-handshake fetch.

### Session resumption

TLS 1.3 session tickets allow resumption. Resumed handshakes are faster. Shutdown of a server invalidates outstanding tickets (eventually), so clients fall back to full handshake on reconnect.

This is rarely a problem unless you're serving extremely high RPS.

---

## Extended Topic: NetworkPolicy and Shutdown

K8s NetworkPolicies can affect shutdown:

- A policy that blocks egress prevents `Shutdown` from flushing traces / Sentry events / Kafka producer.
- A policy applied mid-deploy can cause the pod's drain to fail (outbound calls blocked).

When designing NetworkPolicies, allow egress to observability backends.

### Common policy mistake

```yaml
egress:
- to:
  - podSelector:
      matchLabels:
        app: api-service
  ports:
  - protocol: TCP
    port: 8080
```

This allows egress to a specific service. But traces / metrics are typically sent to different destinations. Add allowances:

```yaml
- to:
  - namespaceSelector:
      matchLabels:
        name: observability
  ports:
  - protocol: TCP
    port: 443
```

Otherwise, your pod's traces are silently dropped at shutdown.

---

## Extended Topic: Service Mesh Sidecars and Shutdown

A common architecture: each pod has the application container and an Envoy sidecar.

### The drain coordination problem

Both containers receive SIGTERM. If the Envoy sidecar exits first, the application loses its egress (Envoy proxies outbound calls in many mesh configurations). If the application exits first, in-flight requests may fail.

### Istio's `holdApplicationUntilProxyStarts`

This pod-spec annotation makes the application container wait for the sidecar to be ready *before* it starts. It also reverses the order at shutdown: Envoy exits last.

```yaml
annotations:
  proxy.istio.io/config: |
    holdApplicationUntilProxyStarts: true
```

This is the recommended setting for most Istio installations.

### The Envoy `drain_time_s`

Envoy's drain time configures how long it waits for in-flight requests after receiving its drain signal. Tune to match your application's shutdown budget.

```yaml
annotations:
  proxy.istio.io/config: |
    terminationDrainDuration: 25s
```

### Sidecar lifecycle hooks

```yaml
- name: istio-proxy
  lifecycle:
    preStop:
      exec:
        command: ["pilot-agent", "request", "POST", "quitquitquit"]
```

This explicit `preStop` for Envoy tells it to start draining. The application's `preStop` can sleep to let Envoy notice.

---

## Extended Topic: Drain Coordination with Service Discovery

In dynamic environments, services discover each other via a registry (Consul, etcd, K8s Service).

### Deregistration on shutdown

A service registers itself when starting; should deregister when stopping. Most service registries support this:

```go
// at start
if err := registry.Register(myService); err != nil { return err }

// at shutdown
if err := registry.Deregister(myService); err != nil {
    log.Printf("deregister failed: %v", err)
}
```

Deregistration is a phase in the shutdown machine — after readiness flip, before drain.

### Stale registrations

If a service crashes without deregistering, its entry stays in the registry until the next health check fails. For Consul: ~30 seconds. For K8s Service: depends on probe configuration.

Stale registrations cause clients to try-and-fail to reach a dead pod. Mitigate via:

- Always deregister on shutdown (handles graceful cases).
- Short health-check intervals (handles crashes).
- TTL-based registration that auto-expires.

### Coordinated multi-service drain

If service A depends on service B, and both are draining, the order matters. A should drain before B (so A doesn't need B anymore). This requires explicit coordination — often via a deploy orchestrator.

---

## Extended Topic: BPF Tracing of Shutdown

For ultra-low-level debugging, eBPF tools are powerful.

### Tracing signal delivery

```bash
sudo bpftrace -e '
    tracepoint:signal:signal_deliver {
        printf("PID %d got signal %d at %lld\n",
            pid, args->sig, nsecs);
    }
'
```

Real-time output of every signal delivered to every process. Filter by pid:

```bash
sudo bpftrace -e '
    tracepoint:signal:signal_deliver /pid == 12345/ {
        printf("signal %d\n", args->sig);
    }
'
```

### Tracing syscall durations

If shutdown is slow, eBPF can show which syscall is slow:

```bash
sudo bpftrace -e '
    tracepoint:syscalls:sys_enter_close {
        @start[tid] = nsecs;
    }
    tracepoint:syscalls:sys_exit_close /@start[tid]/ {
        @duration = hist((nsecs - @start[tid]) / 1000);
        delete(@start[tid]);
    }
'
```

Shows histogram of `close` syscall durations in microseconds.

### Tracing Go goroutines

eBPF can hook into Go runtime functions. The `golang.org/x/exp/trace` package gives a higher-level view.

### When to reach for eBPF

When standard tools (pprof, traces, logs) are insufficient. Typically:

- Investigating signals from outside the application.
- Diagnosing kernel-level latency.
- Understanding interactions with the container runtime.

A senior engineer might use eBPF once a year; a kernel-adjacent professional uses it monthly.

---

## Extended Topic: Goroutine Leak Detection at Shutdown

A common bug: goroutines that don't exit at shutdown.

### Detection in production

After shutdown, examine the goroutine count:

```go
goroutinesBefore := runtime.NumGoroutine()
_ = mgr.Run(ctx, 30*time.Second)
goroutinesAfter := runtime.NumGoroutine()
if goroutinesAfter > expectedRemaining {
    log.Printf("leaked goroutines: %d", goroutinesAfter)
    buf := make([]byte, 1<<20)
    n := runtime.Stack(buf, true)
    log.Printf("stacks:\n%s", buf[:n])
}
```

The stack dump shows which goroutines are still running.

### Detection in tests

`go.uber.org/goleak` is a popular library:

```go
import "go.uber.org/goleak"

func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m)
}
```

After every test, goleak checks for unexpected goroutines. The test fails if any leaked.

### Common leak patterns

- Goroutine that watches a channel but never observes `ctx.Done()`.
- Goroutine started by a library that doesn't accept cancellation.
- Goroutine in a `for { select { case x := <-ch: ... } }` with no Done case.

Each is fixed by adding a `<-ctx.Done()` case.

### Library-imposed leaks

Some third-party libraries spawn goroutines that don't honour cancellation. The library may have a `Close` method that releases them:

```go
defer thirdPartyClient.Close()
```

Or you may need to fork the library and add cancellation. File an issue upstream.

---

## Extended Topic: A Tour of Process Termination on Linux

For the professional, a complete trip through `do_exit`.

When a process exits (whether via syscall `exit()` or via signal):

1. **`do_exit(code)`** is called.
2. **Profile / accounting.** Final stats recorded.
3. **`exit_mm`.** Memory mappings released.
4. **`exit_files`.** File descriptors closed (including listeners, sockets).
5. **`exit_fs`.** Working directory etc. released.
6. **`exit_signals`.** Signal-related cleanup.
7. **`exit_notify`.** Parent notified via SIGCHLD.
8. **`task_struct` becomes a zombie.** Waits for parent's `wait`.
9. **`wait` reaps.** Final cleanup of `task_struct`.

Steps 4 and 5 are where TCP sockets close, listeners close, etc. The kernel handles this regardless of whether the process exits cleanly or via SIGKILL.

The application's job (in graceful shutdown) is to handle anything the kernel doesn't: flushing user-space buffers, committing transactions, releasing distributed locks.

---

## Extended Topic: The Future of Graceful Shutdown in Go

Speculative but informed.

### Likely improvements

- Better tooling for shutdown observability (e.g., a `runtime/shutdown` package).
- Standardisation of phase-machine patterns into a `golang.org/x/...` package.
- More integration with K8s lifecycle hooks (e.g., a Go-native `preStop` library).
- Improved HTTP/3 support and corresponding drain mechanics.

### Unlikely improvements

- Built-in graceful shutdown for every server type. Go's design philosophy is to provide primitives.
- Automatic signal-to-context bridging without `signal.NotifyContext`. The current API is already minimal.

### What stays stable

- The signal handling API.
- The HTTP `Shutdown` / `Close` contract.
- The context cancellation model.

A skill investment in current shutdown patterns has a long shelf life.

---

## Extended Topic: Shutdown in WebAssembly Runtimes

For completeness: Go-on-WASM doesn't have signals. The WASM runtime (browser, wasmtime, etc.) controls the lifecycle.

If your Go code targets WASM, graceful shutdown is the runtime's concern, not yours. The patterns in this Roadmap don't apply.

WASM is increasingly used for plugins, edge computing, and serverless. Most "graceful shutdown" engineering is for traditional Go servers.

---

## Extended Topic: Shutdown in Embedded / IoT Go

Go compiles to many platforms including some embedded targets. Embedded environments often lack signals or have constrained signal handling.

If your Go binary runs on a bare-metal SBC or in an RTOS, consult the target documentation. The signal-based pattern may not apply.

---

## Extended Topic: A Final Read of `http.Server.Shutdown`

The complete implementation, annotated. Source is in `src/net/http/server.go`. Here we reproduce a stripped-down version:

```go
func (srv *Server) Shutdown(ctx context.Context) error {
    // (1) Set the shutdown flag.
    srv.inShutdown.Store(true)

    // (2) Acquire the server mutex.
    srv.mu.Lock()

    // (3) Close all listeners.
    lnerr := srv.closeListenersLocked()

    // (4) Fire OnShutdown callbacks (each in its own goroutine).
    for _, f := range srv.onShutdown {
        go f()
    }

    srv.mu.Unlock()

    // (5) Wait for accept loops to return.
    srv.listenerGroup.Wait()

    // (6) Polling loop.
    pollIntervalBase := time.Millisecond
    nextPollInterval := func() time.Duration {
        // exponential backoff up to 500ms
        // ... (omitted for brevity) ...
    }

    timer := time.NewTimer(nextPollInterval())
    defer timer.Stop()

    for {
        // (7) Check if all connections are closed.
        if srv.closeIdleConns() {
            return lnerr
        }

        // (8) Wait for next poll or context cancellation.
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-timer.C:
            timer.Reset(nextPollInterval())
        }
    }
}
```

Each numbered step:

1. **Set the flag.** Atomic write. Other operations check this flag to refuse work.
2. **Lock.** Protects internal maps.
3. **Close listeners.** Each listener's `Close` is called. Accept loops will return.
4. **Fire hooks.** Each `OnShutdown` callback in its own goroutine. The server does NOT wait for them.
5. **Wait for accept loops.** `listenerGroup` is a `WaitGroup` tracking the accept goroutines.
6. **Setup polling.** Exponential backoff from 1ms to 500ms.
7. **Try to close idle connections.** Returns true if all connections are closed (idle and active).
8. **Wait or fail.** Sleep until next poll, or return on context cancellation.

The whole function is about 30 lines. Read it. Understand it. It is the single most important shutdown function in Go.

### `closeIdleConns` in detail

```go
func (srv *Server) closeIdleConns() bool {
    srv.mu.Lock()
    defer srv.mu.Unlock()
    quiescent := true
    for c := range srv.activeConn {
        st, unixSec := c.getState()
        // StateNew connections are idle if > 5 seconds old
        if st == StateNew && unixSec < time.Now().Unix()-5 {
            st = StateIdle
        }
        if st != StateIdle || unixSec >= time.Now().Unix() {
            quiescent = false
            continue
        }
        c.rwc.Close()
        delete(srv.activeConn, c)
    }
    return quiescent
}
```

For each tracked connection:

- Check its current state.
- If `StateNew` for >5 seconds: treat as `StateIdle` (force-close stalled handshakes).
- If `StateIdle` (and not exactly at the current second): close it.
- Otherwise: leave it, mark as not quiescent.

Return true if all connections closed.

The 5-second rule for `StateNew` is interesting: it bounds the time a connection can sit in pre-request state. Helps if a client opens a connection and never sends data.

---

## Extended Topic: A Comparison with Other Languages

For perspective, how graceful shutdown looks in other ecosystems.

### Node.js

```javascript
process.on('SIGTERM', () => {
  server.close(() => {
    process.exit(0);
  });
});
```

Single-threaded event loop. `server.close` stops accepting new connections; the event loop processes in-flight ones. Similar in spirit to Go but lacks the explicit deadline.

### Python (FastAPI / Uvicorn)

Uvicorn has built-in graceful shutdown. Hookable via lifespan events:

```python
@app.on_event("shutdown")
async def shutdown():
    await close_db()
```

Less low-level than Go; the framework handles signal trapping.

### Java (Spring Boot)

`server.shutdown.graceful` config + `spring.lifecycle.timeout-per-shutdown-phase`. The framework provides graceful shutdown out of the box.

### Rust (tokio)

```rust
let signal = tokio::signal::ctrl_c();
let server = ServerBuilder::new().build()
    .with_graceful_shutdown(async {
        signal.await.unwrap();
    });
```

Similar to Go in pattern. `with_graceful_shutdown` accepts a future that resolves on shutdown signal.

### Common theme

Every modern ecosystem has a graceful shutdown mechanism. The patterns transfer. Go's is one of the more explicit and low-level, which has trade-offs: more flexibility, more boilerplate.

---

## Extended Topic: Closing the Loop

The professional file has gone deep into mechanics. Let's loop back to why it matters.

Most Go production engineers don't need this depth. The junior file covers 95% of practical needs. The middle file covers 99%. The senior file makes you world-class for the typical service.

The professional level is for:

- **Library authors.** Building shared infrastructure needs deep correctness.
- **SREs investigating rare incidents.** When standard tools fail, the kernel-level view is the last resort.
- **Performance engineers.** Squeezing the last millisecond of shutdown latency.
- **Educators.** You can't teach what you don't understand at the mechanism level.

If you don't fall into these categories, you can read this file once and move on. The senior file is the practical ceiling for most.

For those who do fall into these categories, this file is a map. The territory is the Go source code. Go explore.

---

## Final, Definitively Final Words

Graceful shutdown is a 15-line pattern. The reason it took five thousand lines of Roadmap content to teach is that the *implications* of those 15 lines reach into every layer of the stack — kernel signal delivery, runtime scheduler, network library, HTTP framework, container runtime, orchestrator, load balancer, monitoring stack.

A reader who has finished all five files (index, junior, middle, senior, professional) has the deepest understanding of Go shutdown patterns achievable. They will encounter shutdown issues with calm; they will design systems with care; they will mentor teams toward operational excellence.

Onwards to the practice material in the remaining files. Concepts without practice fade. Practice them.

Thank you for reading.

---

## Appendix A: The Complete `signal_unix.go` Walkthrough

Go's `src/runtime/signal_unix.go` is the heart of signal handling. A guided tour of the key functions, paraphrased.

### `initsig`

Called once at runtime startup. For each signal in the runtime's table:

```go
for i := uint32(0); i < _NSIG; i++ {
    t := &sigtable[i]
    if t.flags == 0 || t.flags&_SigDefault != 0 {
        continue
    }
    // ... install handler ...
    setsig(i, abi.FuncPCABIInternal(sighandler))
}
```

Sets up the runtime as the signal handler for every "interesting" signal. `setsig` calls `sigaction(2)` under the hood.

### `sighandler`

The actual signal handler invoked by the kernel. Pseudocode:

```go
func sighandler(sig uint32, info *siginfo, ctxt unsafe.Pointer, gp *g) {
    _g_ := getg()
    c := &sigctxt{info, ctxt}

    // Check if it's a known synchronous fault (SIGSEGV, etc.)
    if sig == _SIGURG && doSigPreempt(...) {
        // Async preemption — handle and return
        return
    }

    if sig < uint32(len(sigtable)) {
        flags := sigtable[sig].flags
        if flags&_SigPanic != 0 && gp.throwsplit == 0 {
            // Synchronous signal — turn into panic
            // ...
        }
    }

    if !sigsend(sig) {
        // No user-space subscriber — take default action
        if flags&_SigKill != 0 {
            dieFromSignal(sig)
        }
    }
}
```

The key call: `sigsend(sig)`. This enqueues the signal for the `signal_recv` goroutine.

### `sigsend`

```go
func sigsend(s uint32) bool {
    bit := uint32(1) << uint(s%32)
    // Check if anyone is interested
    if !sig.wanted[s/32]&bit != 0 {
        return false
    }
    // Atomically set the bit
    for {
        mask := sig.mask[s/32]
        if mask&bit != 0 {
            return true // already pending
        }
        if atomic.Cas(&sig.mask[s/32], mask, mask|bit) {
            break
        }
    }
    // Wake the receiver
    notewakeup(&sig.note)
    return true
}
```

The signal is recorded in a bit-set. If a receiver was sleeping (via `notewakeup`), it wakes up.

### `signal_recv`

```go
func signal_recv() uint32 {
    for {
        // Try to find a pending signal
        for i := uint32(0); i < _NSIG; i++ {
            j := i / 32
            b := uint32(1) << (i % 32)
            if sig.mask[j]&b != 0 {
                atomic.Cas(&sig.mask[j], sig.mask[j], sig.mask[j]&^b)
                return i
            }
        }
        // Wait for new signals
        notetsleepg(&sig.note, -1)
        noteclear(&sig.note)
    }
}
```

Loops over the bit-set looking for set bits. Clears each. If none, sleeps until `sigsend` wakes it.

### Tying it together

```
KERNEL --(SIGTERM)--> sighandler --(sigsend)--> sig.mask bit set
                                                       |
signal_recv goroutine waking up <-- notewakeup ---------+
                |
                v
            process(sig)
                |
                v
        non-blocking send to user channel
```

Five hops from kernel to user channel. Total latency: ~50–200 µs in practice.

---

## Appendix B: The Complete `os/signal/signal.go` Walkthrough

The user-facing package. We've seen `Notify` and `Stop`; here are the other functions.

### `Reset`

```go
func Reset(sig ...os.Signal) {
    // ... acquire lock ...
    for _, s := range sig {
        n := signum(s)
        if n < 0 { continue }
        delete(handlers.ref, uint32(n))
        // ... reset the signal in the runtime ...
        disableSignal(n)
    }
}
```

`Reset` is more drastic than `Stop`. It removes the signal's user handling entirely, restoring the default behaviour for the process. Rarely needed.

### `Ignored`

```go
func Ignored(sig os.Signal) bool {
    sn := signum(sig)
    return sn >= 0 && signalIgnored(uint32(sn))
}
```

Returns true if the signal is currently ignored. Useful for diagnostic checks (e.g., "is SIGPIPE being ignored?").

### Init goroutine

When `signal.Notify` is called for the first time:

```go
once.Do(start)
```

`start` spawns the `loop` goroutine:

```go
func loop() {
    for {
        process(syscall.Signal(signal_recv()))
    }
}
```

This goroutine runs forever. It reads from `signal_recv` (which blocks on the runtime's signal queue) and dispatches via `process`.

### `process`

We've seen this. Iterates handlers, non-blocking sends.

### Channel-cap = 1 reasoning

Look at the `select` inside `process`:

```go
select {
case c <- sig:
default:
}
```

If `c` is unbuffered: the send succeeds only if a receiver is ready. Otherwise it falls through to `default` and the signal is dropped.

If `c` has cap 1: the send succeeds the first time even without a receiver (fills the buffer). Subsequent sends also fall through if the buffer is still full.

Buffer of 1 is the minimum to preserve the first signal. Larger buffers preserve more but increase memory; in practice nobody cares about preserving the third SIGTERM if you've already failed to handle the first two.

---

## Appendix C: A Re-Read of `net/http`'s Connection State Machine

The `*conn.serve` function (`src/net/http/server.go`) is the heart of HTTP server connection handling. A simplified trace:

```go
func (c *conn) serve(ctx context.Context) {
    // (1) Set up panic recovery
    defer func() {
        if err := recover(); err != nil {
            // ... log ...
        }
        // (2) On exit, transition to StateClosed
        c.setState(c.rwc, StateClosed, runHooks)
    }()

    // (3) TLS handshake if applicable
    if tlsConn, ok := c.rwc.(*tls.Conn); ok {
        // ... ServerHandshake ...
    }

    // (4) Main loop: read request, serve, repeat
    for {
        w, err := c.readRequest(ctx)
        if err != nil {
            // ... close ...
            return
        }
        c.setState(c.rwc, StateActive, runHooks)

        // (5) Dispatch to user handler
        serverHandler{c.server}.ServeHTTP(w, w.req)

        // (6) Finish response
        if !w.finishRequest() {
            return
        }

        if !w.shouldReuseConnection() {
            return
        }
        c.setState(c.rwc, StateIdle, runHooks)

        // (7) Wait for next request or read timeout
        // ... loop back to (4) ...
    }
}
```

Each numbered step:

1. Panic recovery catches handler panics. The default behaviour is to log and close.
2. State transitions to `StateClosed` on any exit.
3. TLS handshake (sync; can take seconds for slow clients).
4. Read the next request from the connection. Includes header parsing.
5. Dispatch to the user-provided handler.
6. Drain the response.
7. Idle until next request or timeout.

### State transitions during `Shutdown`

While the connection is in `StateActive` (step 5), the handler is running. `Shutdown` does not interrupt it. The handler must complete before `Shutdown` can close this connection.

When the handler returns, the connection briefly becomes `StateIdle`. `closeIdleConns` will close it on its next iteration.

If `Close` is called, the connection's `rwc.Close()` is called directly. The handler's next read/write sees an error. The handler typically aborts.

### Why this matters for shutdown latency

Total shutdown latency = max(handler latency for in-flight requests, idle-poll interval).

If your slowest in-flight handler takes 8 seconds and idle-poll is bounded by 500ms, total is ~8.5 seconds.

Reducing the slow handler is the only way to reduce shutdown latency below 8 seconds.

---

## Appendix D: A Re-Read of `tls.Conn.Close`

TLS close has its own subtleties.

```go
func (c *Conn) Close() error {
    var alertErr error
    c.handshakeMutex.Lock()
    if c.handshakeComplete {
        alertErr = c.closeNotify()
    }
    c.handshakeMutex.Unlock()

    if err := c.conn.Close(); err != nil {
        return err
    }
    return alertErr
}
```

If the handshake completed, send a close-notify alert (a TLS-level "I'm closing" message). Then close the underlying TCP connection.

### close-notify

The close-notify alert tells the peer this close is intentional. Without it, the peer may interpret the close as an attack or error.

In practice, most TLS clients tolerate missing close-notify. Browsers ignore it. Mature SDKs (Go's `http.Client`) ignore it.

### `Close` and in-progress writes

If a TLS write is in progress when `Close` is called, the write may return an error. The close-notify may not be sent (if the write held the lock).

In our shutdown context, this means `Close` after a failed `Shutdown` may produce slightly-less-clean TLS terminations. Acceptable trade-off; the alternative is hanging forever.

### Connection-level vs handshake-level

A TLS connection has two phases: handshake and steady-state. `Close` during handshake aborts the handshake; the client sees a TCP-level reset.

`Close` during steady-state sends close-notify (if possible) and then closes TCP.

---

## Appendix E: Per-Listener Configuration

`http.Server` can have multiple listeners (via `Serve`). Each listener has its own configuration.

### Adding listeners

```go
ln1, _ := net.Listen("tcp", ":8080")
ln2, _ := net.Listen("unix", "/tmp/myservice.sock")

go srv.Serve(ln1)
go srv.Serve(ln2)
```

Both listeners share the same server (handlers, hooks, etc.) but accept on different ports/sockets.

### `Shutdown` and multiple listeners

`Shutdown` closes ALL listeners. The accept loops on each return.

Connections accepted via different listeners are all tracked in `activeConn`. The polling loop drains them all.

### Listener-specific behaviour

You cannot per-listener tune `Shutdown` behaviour. The drain is global to the server.

If you need per-listener drain, use multiple `*http.Server` instances:

```go
publicSrv := &http.Server{Addr: ":8080"}
internalSrv := &http.Server{Addr: ":9090"}

// drain in different orders, with different deadlines
publicSrv.Shutdown(publicCtx)
internalSrv.Shutdown(internalCtx)
```

---

## Appendix F: Tracking Active Requests Across All Levels

A consolidated view of where requests live during their lifetime.

| Level | Data structure | Drained by |
|---|---|---|
| Kernel SYN queue | TCP listen-backlog | Listener close |
| Kernel accept queue | TCP listen-backlog | Listener close |
| `*conn` map (`srv.activeConn`) | Go map | `Shutdown`/`Close` |
| Handler goroutine | runtime stack | Handler return |
| Response buffer | `bufio.Writer` | Handler `flush` |
| HTTP/2 stream | `http2.streamState` | Stream end / `GOAWAY` |
| Hijacked conn | Application-managed | Application code |

Each level has its own lifecycle. The graceful shutdown story covers most but not all (hijacked connections are the gap).

---

## Appendix G: A Comprehensive Test Suite for Graceful Shutdown

For library or critical infrastructure code, exhaustive testing of shutdown is essential. A template:

```go
func TestShutdown_NoRequests(t *testing.T) {
    // Server with no requests; shutdown should be near-instant.
    srv, port := startServer(t)
    start := time.Now()
    err := srv.Shutdown(context.Background())
    assert.NoError(t, err)
    assert.Less(t, time.Since(start), 100*time.Millisecond)
}

func TestShutdown_OneActiveRequest(t *testing.T) {
    srv, port := startServer(t)
    reqDone := make(chan struct{})
    go func() {
        defer close(reqDone)
        _, _ = http.Get(fmt.Sprintf("http://localhost:%d/slow?d=2s", port))
    }()
    time.Sleep(100 * time.Millisecond) // ensure request is in flight
    err := srv.Shutdown(context.Background())
    assert.NoError(t, err)
    select {
    case <-reqDone:
    case <-time.After(3 * time.Second):
        t.Fatal("request did not complete")
    }
}

func TestShutdown_TimeoutExceeded(t *testing.T) {
    srv, port := startServer(t)
    go http.Get(fmt.Sprintf("http://localhost:%d/slow?d=10s", port))
    time.Sleep(100 * time.Millisecond)
    ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
    defer cancel()
    err := srv.Shutdown(ctx)
    assert.ErrorIs(t, err, context.DeadlineExceeded)
}

func TestShutdown_ManyIdleConnections(t *testing.T) {
    srv, port := startServer(t)
    // open 100 keep-alive connections
    var conns []*http.Client
    for i := 0; i < 100; i++ {
        // ... make a request and let it sit idle ...
    }
    err := srv.Shutdown(context.Background())
    assert.NoError(t, err)
    // verify all connections closed
}

func TestShutdown_OnShutdownHook(t *testing.T) {
    srv, _ := startServer(t)
    hookFired := make(chan struct{})
    srv.RegisterOnShutdown(func() {
        close(hookFired)
    })
    _ = srv.Shutdown(context.Background())
    select {
    case <-hookFired:
    case <-time.After(time.Second):
        t.Fatal("hook did not fire")
    }
}

func TestShutdown_HijackedConnection(t *testing.T) {
    srv, port := startServer(t, withHijackedHandler())
    // start a hijacked connection
    // call Shutdown
    // verify Shutdown returns quickly (hijacked conn is not tracked)
    // verify hijacked conn is still open after Shutdown
}

func TestShutdown_DoubleShutdown(t *testing.T) {
    srv, _ := startServer(t)
    err1 := srv.Shutdown(context.Background())
    assert.NoError(t, err1)
    err2 := srv.Shutdown(context.Background())
    // second Shutdown returns ErrServerClosed or similar
    assert.Error(t, err2)
}

func TestShutdown_AfterClose(t *testing.T) {
    srv, _ := startServer(t)
    _ = srv.Close()
    err := srv.Shutdown(context.Background())
    assert.ErrorIs(t, err, http.ErrServerClosed)
}
```

A library author tests all of these. An application engineer tests the "happy path" plus one or two failure cases.

---

## Appendix H: A Glossary of HTTP-Specific Shutdown Terms

| Term | Meaning |
|---|---|
| `BaseContext` | Context for all connections on a server. Cancel to propagate shutdown to handlers. |
| `ConnContext` | Per-connection derived context. Customise to add per-connection metadata. |
| `ConnState` | Callback per state transition. Useful for metrics and diagnostics. |
| `IdleTimeout` | Maximum keep-alive idle duration. After this, server closes the connection. |
| `ReadHeaderTimeout` | Maximum time to read request headers. Defends against Slowloris. |
| `ReadTimeout` | Maximum time to read the whole request. |
| `WriteTimeout` | Maximum time to write the response. |
| `MaxHeaderBytes` | Maximum header size. |
| `ErrServerClosed` | Sentinel returned by `ListenAndServe` after `Shutdown`/`Close`. |
| `Server.RegisterOnShutdown` | Register a callback fired at the start of `Shutdown`. |
| `Hijack` | Handler takes over the raw connection. Server no longer tracks it. |

A working knowledge of all of these is part of "owning" HTTP shutdown at the professional level.

---

## Appendix I: A Sample Postmortem Where Professional Knowledge Helped

A composite example.

### The incident

Production deploy of `payment-service`. After deploying, 0.3% of payment requests failed for 5 minutes. Customer reports of "incomplete checkout" rolled in.

### Initial investigation (senior level)

- Logs showed normal shutdown sequence; no "failed shutdown" alerts.
- Metrics showed `shutdown_duration_p99 = 5s` (normal).
- Customer error reports mentioned "transaction pending" — payments that were started but didn't complete on the merchant's side.

### Deeper investigation (professional level)

- Hypothesis: requests were being dropped between LB and pod.
- `kubectl get events` showed pods transitioned through Terminating quickly. No SIGKILL signals reported.
- `strace -e signal` on a pod (during a deploy) showed SIGTERM arriving at PID 1.
- BUT: PID 1 was a shell. The Go binary was PID 2.

Aha — the team had recently added a wrapper script for log redirection:

```dockerfile
CMD ["/bin/sh", "-c", "/app/server 2>&1 | tee -a /var/log/server.log"]
```

The shell was PID 1. It didn't forward SIGTERM. The Go binary never received the signal. After 30 seconds, SIGKILL landed on the shell, which killed the entire process group, including the Go binary.

The Go binary's "graceful shutdown" never ran. Active payments at SIGKILL were mid-database-write. The database rolled back the transactions, but the upstream payment processor had already been called. Result: customer charged, no record on our side.

### Fix

Replace the shell wrapper with:

```dockerfile
ENTRYPOINT ["/app/server"]
```

Or, if log redirection is needed, use `tini`:

```dockerfile
ENTRYPOINT ["/sbin/tini", "--", "/app/server"]
```

Or rely on K8s for logs (write to stdout, kubelet collects).

### What "professional knowledge" caught

- The `strace` step. Most engineers don't think to verify SIGTERM is being received.
- The PID 1 awareness. Most engineers don't realise the shell wrapper changes signal behaviour.
- The interaction between SIGKILL and process groups.

Total time to root cause: 4 hours. Without professional knowledge, this could have been days.

### Action items

1. Fix the entrypoint in all services (audit Dockerfile).
2. Add a startup log line: `"running as PID %d"`. If not 1, raise an alert.
3. Add a runbook entry: "If shutdowns appear silent, verify PID 1 is the Go binary."

---

## Appendix J: Professional-Level Diagnostic Tools

A toolbox for shutdown investigations.

### `strace`

```bash
sudo strace -p $(pidof yourbinary) -e signal -f
```

Shows all signal-related syscalls. Useful for "is SIGTERM actually arriving?"

### `ltrace`

```bash
sudo ltrace -p $(pidof yourbinary)
```

Shows library calls. Less useful for Go (statically linked) but works for C dependencies.

### `gdb`

```bash
sudo gdb -p $(pidof yourbinary)
(gdb) thread apply all bt
```

Shows backtraces of all threads. Identifies stuck threads.

### `dlv` (Delve)

```bash
dlv attach $(pidof yourbinary)
(dlv) goroutines
```

Go-specific debugger. Shows all goroutines and their stacks.

### Goroutine endpoint

```bash
curl http://host:port/debug/pprof/goroutine?debug=2
```

Built into Go via `net/http/pprof`. Shows all goroutines.

### `bpftrace`

```bash
sudo bpftrace -e 'tracepoint:signal:signal_deliver /pid == 12345/ { printf("got %d\n", args->sig); }'
```

Real-time signal delivery monitoring.

### `perf`

```bash
sudo perf record -F 99 -p $(pidof yourbinary) sleep 30
sudo perf report
```

CPU profiling at the kernel level. Useful for "where is the time going during shutdown?"

### `nsenter` for container debugging

```bash
sudo nsenter -t $(pidof yourbinary) -n ss -lnt
```

Enters the container's network namespace and shows listening sockets. Useful for "is the listener actually closed?"

---

## Appendix K: A Production Story With Numbers

A real-shape example.

### The service

- 50 pods of `order-service`.
- 200 RPS per pod.
- p50 request latency: 80 ms.
- p99 request latency: 600 ms.
- p999 request latency: 4 seconds (occasional slow downstream).

### The shutdown sequence

```
t=0.000  SIGTERM received.
t=0.001  Signal observed by main.
t=0.001  Readiness flipped to draining.
t=0.001  preStop sleep starts (5 seconds).
t=5.001  preStop ends; main's <-rootCtx.Done() returns.
t=5.001  srv.Shutdown(ctx) called with 20-second budget.
t=5.001  All listeners closed.
t=5.001  ~10 idle keep-alive connections closed.
t=5.001  Polling loop begins.
t=5.002  ~5 active requests still in flight (~80ms p50 latency).
t=5.082  3 of 5 active requests complete.
t=5.082  2 still active, ~520ms p99 latency.
t=5.502  Last p99 request completes.
t=5.502  closeIdleConns returns true.
t=5.502  Shutdown returns nil.
t=5.502  Phase: stop_workers begins.
t=5.502  Workers cancel and finish current jobs.
t=8.502  Workers all exited.
t=8.502  Kafka producer flush begins.
t=8.504  Kafka flush completes.
t=8.504  Database close begins.
t=8.524  Database closed.
t=8.524  main returns.
t=8.525  Process exits.
```

Total: ~8.5 seconds per pod. With 50 pods rolling 25% at a time, the total deploy is about 5 minutes (4 batches × 8.5s + setup).

### What "professional" enables here

- Tight per-handler timeouts (10 seconds) keep the p999 from blowing the budget.
- `BaseContext` derived from `rootCtx` makes handlers shutdown-aware automatically.
- preStop sleep ensures the LB has removed the endpoint before drain begins.
- Per-phase metrics highlight which phase consumed most of the time.

### What would go wrong at the senior level (without professional understanding)

- p999 at 4 seconds would mean p9999 is probably 8 seconds. If shutdown budget were 30 seconds total, you'd be in danger of force-close at p9999.
- Without knowing `BaseContext`, you might not realise handlers need to be linked to `rootCtx`.
- Without knowing the polling-loop internals, you might worry about the 500ms tick latency.

Professional knowledge dispels worry where it isn't warranted and focuses effort where it is.

---

## Appendix L: Source Code Reading Plan

For the truly committed, a 10-evening reading plan through Go's source.

### Evening 1: `os/signal`

- `src/os/signal/signal.go`
- `src/os/signal/signal_unix.go`

Read the comments and code. Note the `handlers` struct, `ref` counting, `process` function. Make notes.

### Evening 2: `runtime/sigqueue.go`

- `src/runtime/sigqueue.go`

Understand the bit-set, `signal_recv`, `sigsend`. The runtime-side counterpart of os/signal.

### Evening 3: `runtime/signal_unix.go` (deep)

- `src/runtime/signal_unix.go`

The signal handler. Long file; skim then deep-read `sighandler`.

### Evening 4: `context`

- `src/context/context.go`

The full implementation. Note `cancelCtx`, `timerCtx`, propagation logic.

### Evening 5: `net/http/server.go` (Serve and conn.serve)

- Focus on `Serve` and `conn.serve` functions.

The accept loop and the per-connection state machine.

### Evening 6: `net/http/server.go` (Shutdown and Close)

- `Shutdown`, `Close`, `closeIdleConns`, `closeListenersLocked`.

The shutdown machinery in detail.

### Evening 7: `net` package

- `src/net/net.go`, `src/net/fd_unix.go`

Listener and connection internals.

### Evening 8: TLS connection

- `src/crypto/tls/conn.go`, focus on `Close` and `closeNotify`.

How TLS connections close.

### Evening 9: HTTP/2

- `src/net/http/h2_bundle.go` (large) or `golang.org/x/net/http2`.

HTTP/2 stream lifecycle and GOAWAY.

### Evening 10: Putting it together

Re-read these professional appendices with the source fresh in mind. The connections become clear.

Ten evenings of reading make you a *de facto* expert. Few engineers invest this; those who do dominate the topic.

---

## Appendix M: Where Concepts Live in Go's Internal Tree

A reference for where to find things:

| Concept | File |
|---|---|
| Signal handler installation | `runtime/signal_unix.go` |
| Signal-recv goroutine | `runtime/sigqueue.go` |
| User-facing `signal.Notify` | `os/signal/signal.go` |
| Signal handling on UNIX | `os/signal/signal_unix.go` |
| Async preemption | `runtime/preempt.go` |
| Context cancellation | `context/context.go` |
| HTTP server | `net/http/server.go` |
| HTTP/2 server | `net/http/h2_bundle.go` |
| TLS conn close | `crypto/tls/conn.go` |
| Network listener | `net/net.go`, `net/fd_unix.go` |
| Goroutine scheduling | `runtime/proc.go` |
| GMP model | `runtime/runtime2.go` |

Bookmark this table. It saves time on every investigation.

---

## Appendix N: Closing Reflections

This file has been long. Graceful shutdown looks simple from the outside; underneath it touches the deepest layers of the system.

The professional level is not for everyone. Most production Go engineers can stop at the senior level and have stellar careers. The professional level is for the small fraction who maintain Go itself, build infrastructure libraries, run SRE for high-traffic services, or simply love understanding systems deeply.

If you've read this file fully, you are in that small fraction. The knowledge will compound. Years from now, you'll diagnose an issue in 10 minutes that takes others days. You'll review PRs and spot subtleties others miss. You'll mentor mid-level engineers and watch them progress quickly.

That is the return on the investment of reading this.

Onwards. The graceful shutdown content concludes here. Practice files follow.

---

## Appendix O: Deep Look at kubelet's Termination Logic

For the professional studying K8s internals, the kubelet's termination logic is in `pkg/kubelet`.

### `killContainer` flow

In `pkg/kubelet/container/runtime.go`:

```go
func (kl *Kubelet) killContainer(
    pod *v1.Pod,
    containerID kubecontainer.ContainerID,
    containerName string,
    reason string,
    reasonType containerKillReason,
    gracePeriodOverride *int64,
) error {
    // ... compute effective grace period ...
    gracePeriod := int64(minimumGracePeriodInSeconds)
    if pod.DeletionGracePeriodSeconds != nil {
        gracePeriod = *pod.DeletionGracePeriodSeconds
    }
    if gracePeriodOverride != nil {
        gracePeriod = *gracePeriodOverride
    }
    // ... run preStop hook ...
    if container.Lifecycle != nil && container.Lifecycle.PreStop != nil {
        gracePeriod = gracePeriod - kl.executePreStopHook(pod, container)
    }
    // ... send termination via runtime ...
    return runtimeClient.StopContainer(containerID, gracePeriod)
}
```

Key points:

- preStop runs first.
- The grace period is reduced by how long preStop took.
- The CRI runtime is then asked to stop the container with the remaining grace.
- The CRI runtime sends SIGTERM, waits, then SIGKILL if needed.

### preStop hook execution

```go
func (kl *Kubelet) runPreStopHook(pod *v1.Pod, container *v1.Container) {
    hook := container.Lifecycle.PreStop
    if hook.Exec != nil {
        // ... run exec.Command in container namespace ...
    } else if hook.HTTPGet != nil {
        // ... HTTP GET to the specified endpoint ...
    }
}
```

Both types have a default timeout. If the hook exceeds the timeout, kubelet logs a warning and proceeds.

### After SIGTERM

The CRI runtime watches the container's process. If the process exits, the runtime reports success. Otherwise, after the grace period, the runtime sends SIGKILL.

### Container vs pod termination

A pod can have multiple containers. Each is terminated independently with its own SIGTERM/SIGKILL flow.

If your pod has a sidecar (Envoy, fluentbit), each sidecar receives its own SIGTERM. Ordering between sidecars and the main container is undefined unless you use `terminationGracePeriodSeconds` + lifecycle hooks to coordinate.

---

## Appendix P: Container Init Implementations Compared

Several "tiny init" implementations exist for container PID 1.

### tini

- ~10 KB binary.
- Signal forwarding (TERM, INT, etc. forwarded to children).
- Zombie reaping.
- Default in Docker Hub's `tini` image. K8s pause container does similar.

### dumb-init

- ~50 KB.
- Signal forwarding (configurable: forward to one child or to all in the process group).
- Zombie reaping.

### `s6-overlay`

- Larger.
- Supervisor for multiple processes.
- Used when you want a "fat" container with multiple services. Not recommended in K8s.

### K8s pause container

- ~256 KB binary.
- Used as PID 1 when `shareProcessNamespace: true`.
- Reaps zombies for the whole pod.

### When to use which

- Single-process container, you control PID 1: don't need an init. Make the Go binary PID 1.
- Need to redirect stdout/stderr to a file in-container: use tini, OR use K8s log collection.
- Need to run multiple processes in one container: revisit the design; usually a smell.

The default recommendation: `ENTRYPOINT ["/app/server"]` (Go binary as PID 1), no init wrapper needed.

---

## Appendix Q: System Calls Made During Shutdown

A trace of syscalls during a typical Go HTTP server shutdown.

```
# (signal arrives)
rt_sigreturn(...)            # return from signal handler

# (shutdown begins)
close(3)                     # close listener fd
futex(...)                   # wake signal_recv

# (drain idle connections)
close(8)                     # close idle conn fd
close(9)
close(10)
...

# (drain remaining)
nanosleep(1ms)               # polling sleep

# (eventually all closed)

# (close database, redis, kafka)
write(4, ...)                # send "CLOSE" to remote
close(4)
close(5)
close(6)

# (process exits)
exit_group(0)                # final exit
```

Each `close` is microseconds. The bulk of shutdown time is in the application waiting, not in syscalls.

### `epoll_wait` and signals

Go's network poller uses `epoll_wait`. A signal arriving interrupts `epoll_wait` with `EINTR`. The runtime handles this and restarts the wait. Signals are not lost.

### `accept4` and listener close

When the listener is closed, an in-progress `accept4` returns immediately with `EINVAL` or `EBADF`. The accept loop interprets this as "listener closed" and returns.

### `read` and connection close

Similar pattern: a `read` on a closed fd returns 0 (EOF) or an error. The connection handler interprets this and returns.

---

## Appendix R: The Cost of Different Drain Strategies

For optimisation-minded engineers, here are rough measurements.

### Cost of `srv.Shutdown(context.Background())` (no deadline)

If all handlers complete eventually: same as graceful drain.
If a handler hangs forever: blocks forever. Process never exits.

Always use a deadline.

### Cost of `srv.Close()`

Closes all connections immediately. Each handler sees `io.EOF` or similar on next op. Connection counts in `activeConn` drop to 0 immediately.

Total time: microseconds.

### Cost of `srv.Shutdown` with reasonable deadline

Dominated by handler latency. Polling loop overhead is negligible.

For 1000 active connections with p99 = 200ms: total drain ~300 ms.
For 1000 active connections with p99 = 5s: total drain ~5.5s.

### Cost of `RegisterOnShutdown` callbacks

Each callback spawned as a goroutine. ~1 µs to spawn. The callbacks themselves run in parallel.

If callbacks are expensive (e.g., closing 1000 WebSockets each), make them run concurrently and bound them with their own contexts.

### Cost of `errgroup` drain coordination

`errgroup.Wait` is essentially a `sync.WaitGroup.Wait` plus error handling. Overhead: ~100 ns per goroutine.

For 100 parallel drain goroutines: ~10 µs of coordination cost. Negligible.

### Total shutdown latency budget allocation

A typical breakdown for a service with 200 RPS, p99 handler 500ms:

- readyDelay: 3000 ms (LB propagation)
- drain http: 600 ms (longest in-flight handler + polling tail)
- drain workers: 300 ms (job completion)
- flush kafka: 200 ms (network round-trip)
- close db/redis/etc: 50 ms

Total: ~4 seconds. With `terminationGracePeriodSeconds: 30`, you have 26 seconds of margin.

### Where the margin goes

Margin handles:

- Unusual p999 events (a single 8-second handler).
- Network slowness in flush operations.
- LB-propagation taking longer than expected.

Without margin, you live on the edge. With margin, you sleep at night.

---

## Appendix S: `runtime.SetCPUProfileRate` and Shutdown

A niche but interesting interaction.

If your service exposes `/debug/pprof/profile` (CPU profile), starting a profile registers a timer that delivers `SIGPROF` periodically. These signals are handled by the runtime, not your code.

If shutdown begins while a profile is active, the profile is still running. The profile data is buffered and accessed via `pprof.StopCPUProfile()`.

To clean up profile resources at shutdown:

```go
pprof.StopCPUProfile()
```

But: this only matters if profiling is enabled and the profile is mid-collection. For most services, no special handling is needed.

---

## Appendix T: `runtime.SetMutexProfileFraction` and Shutdown

If you enable mutex profiling, the runtime samples contention events. At shutdown, the sample buffer is in memory; it is lost on `os.Exit`.

If you want the profile data persisted, write it to disk in your shutdown phase:

```go
f, _ := os.Create("/tmp/mutex.prof")
pprof.Lookup("mutex").WriteTo(f, 0)
f.Close()
```

This is rarely needed; profiles are typically collected via the HTTP endpoint.

---

## Appendix U: Stack Trace at Shutdown

For diagnostic purposes, dumping all goroutine stacks at shutdown can reveal hangs.

```go
mgr.Add(shutdown.Phase{
    Name: "diagnostic_stacks", MaxBudget: 1 * time.Second, BestEffort: true,
    Run: func(ctx context.Context) error {
        if inflight() > 50 {
            buf := make([]byte, 1<<20)
            n := runtime.Stack(buf, true)
            log.Printf("shutdown stacks:\n%s", buf[:n])
        }
        return nil
    },
})
```

Conditional dump: only when many requests are in flight (suggesting trouble). Adds a useful artifact for postmortem.

---

## Appendix V: Common Patterns in Library Code That Cause Shutdown Problems

A taxonomy of "third-party library spawned a goroutine that doesn't shut down" patterns.

### Pattern: persistent worker pool

```go
func NewClient() *Client {
    c := &Client{...}
    for i := 0; i < 10; i++ {
        go c.worker()
    }
    return c
}
```

The workers never stop. If `Client.Close()` doesn't cancel them, they leak.

Fix: keep a `cancel context.CancelFunc` in the Client. `Close()` calls it.

### Pattern: lazy goroutine spawn

```go
func (c *Client) Get(key string) (Value, error) {
    c.startBackgroundReconciliationOnce.Do(c.startBackgroundReconciliation)
    // ...
}

func (c *Client) startBackgroundReconciliation() {
    go c.reconcile() // never stops
}
```

A goroutine started on first use, never stopped. Subtle leak.

Fix: similar to above; pass context to the worker.

### Pattern: cron-like background task

```go
func NewCache() *Cache {
    c := &Cache{...}
    go func() {
        for {
            time.Sleep(time.Minute)
            c.evict()
        }
    }()
    return c
}
```

`time.Sleep` is non-cancellable. The goroutine cannot be stopped.

Fix: use a context-aware ticker.

### Pattern: connection-pool reaper

```go
func newPool() *Pool {
    p := &Pool{...}
    go p.reapStaleConns()
    return p
}
```

The reaper runs forever. `p.Close()` should stop it. If it doesn't, leak.

Fix: pass context to the reaper.

### Vetting third-party libraries

When adopting a new library, check:

- Does it expose a `Close` method?
- Does `Close` clean up everything (goroutines, fd's)?
- Run goleak in tests to verify.

A library that doesn't pass these checks should be patched or replaced.

---

## Appendix W: Performance Microbenchmarks

For optimization-minded engineers, microbenchmarks of shutdown operations.

```go
func BenchmarkSignalNotifyContext(b *testing.B) {
    for i := 0; i < b.N; i++ {
        ctx, stop := signal.NotifyContext(context.Background(),
            syscall.SIGUSR1)
        stop()
        _ = ctx
    }
}
// Result on 2026 hardware: ~5 µs/op
```

The overhead of setting up signal handling is microseconds. Negligible at startup.

```go
func BenchmarkContextWithTimeout(b *testing.B) {
    for i := 0; i < b.N; i++ {
        ctx, cancel := context.WithTimeout(context.Background(), time.Hour)
        cancel()
        _ = ctx
    }
}
// Result: ~100 ns/op
```

Context creation is essentially free.

```go
func BenchmarkServerShutdownIdle(b *testing.B) {
    for i := 0; i < b.N; i++ {
        srv := &http.Server{...}
        ln, _ := net.Listen("tcp", ":0")
        go srv.Serve(ln)
        _ = srv.Shutdown(context.Background())
    }
}
// Result: ~1 ms/op
```

Idle server shutdown is sub-millisecond.

These benchmarks confirm: the shutdown latency you see is overwhelmingly handler latency, not Go's runtime overhead.

---

## Appendix X: Comparing Shutdown Across Go Releases

A historical perspective:

### Go 1.7 and earlier

No `http.Server.Shutdown`. Manual implementations.

### Go 1.8

`http.Server.Shutdown` introduced. Basic functionality.

### Go 1.13

`BaseContext` and `ConnContext` added. Major improvement for shutdown-aware handlers.

### Go 1.14

Async preemption. Indirectly improves shutdown — slow goroutines can now be preempted.

### Go 1.16

`signal.NotifyContext`. Major ergonomic win.

### Go 1.20

`context.WithCancelCause`. Improved diagnostics.

### Go 1.21

`context.AfterFunc`. Various improvements.

### Go 1.22+

Loop-variable scoping (1.22). Iterators (1.23). Minor but useful.

### Implication

A service that targets Go 1.21+ has the cleanest possible shutdown story. Targeting older versions requires more boilerplate.

Most production services in 2026 run 1.21 or newer. If you're on older Go, the patterns still work but the code is verbose.

---

## Appendix Y: Compiler and Linker Considerations

Subtle but real:

### `go build -ldflags="-s -w"`

Strips symbols. Smaller binary. Slightly faster startup. No impact on shutdown.

### `go build -tags`

Build tags can switch between implementations. Some libraries have a `cgo` and a `pure-Go` build with different shutdown behaviour.

### Static linking

Default for Go. Container images include only the Go binary. No external dependencies that could complicate shutdown.

### Dynamic linking (with cgo)

If you `cgo`, the binary dynamically links to libc. C-side cleanup (atexit handlers) runs at process exit, after Go's defers. Usually transparent; can cause subtle issues if cgo holds resources.

### Position-independent executable (PIE)

Default on some platforms. No impact on shutdown.

### Race detector

`go build -race` produces a binary with race detection. The race detector runs throughout the program's life, including shutdown. Shutdown is slower under race detection (~5x). Used only for testing.

---

## Appendix Z: A Comprehensive Mind Map

```
GRACEFUL SHUTDOWN
├── Kernel layer
│   ├── Signals (SIGTERM, SIGKILL, etc.)
│   ├── do_exit() cleanup
│   └── Process namespaces
├── Container runtime
│   ├── containerd/CRI-O
│   ├── runc kill
│   └── PID 1 forwarding
├── Kubernetes
│   ├── Pod lifecycle
│   ├── kubelet termination
│   ├── preStop hooks
│   ├── terminationGracePeriodSeconds
│   └── Readiness/liveness probes
├── Go runtime
│   ├── Signal interception
│   ├── signal_recv goroutine
│   ├── Async preemption (SIGURG)
│   └── exit and Goexit
├── os/signal package
│   ├── Notify / Stop / NotifyContext
│   ├── handlers map
│   ├── ref counting
│   └── Non-blocking channel send
├── net/http package
│   ├── http.Server.Shutdown
│   ├── http.Server.Close
│   ├── ConnState tracking
│   ├── BaseContext / ConnContext
│   ├── RegisterOnShutdown
│   └── HTTP/2 GOAWAY
├── context package
│   ├── WithCancel / WithTimeout / WithDeadline
│   ├── WithCancelCause
│   ├── AfterFunc
│   └── Propagation
├── Application code
│   ├── main / Run pattern
│   ├── errgroup coordination
│   ├── Phase machine
│   ├── Per-handler timeouts
│   └── Resource cleanup order
├── Observability
│   ├── Metrics (shutdown_started, etc.)
│   ├── Logs (per-phase)
│   ├── Traces (per-phase spans)
│   └── SLOs and dashboards
├── Testing
│   ├── Integration tests
│   ├── Chaos tests
│   ├── goleak in unit tests
│   └── End-to-end deploy tests
└── Operations
    ├── Runbooks
    ├── Postmortems
    ├── ADRs
    └── On-call practice
```

This mind map is the full landscape. Every node is a topic in one of the four levels of this Roadmap. The professional engineer has knowledge in every node.

---

## Appendix AA: Practical Day-to-Day Reminders

For the working professional, distilled to a small list:

1. `defer stop()` after `signal.NotifyContext`.
2. `errors.Is(err, http.ErrServerClosed)` on `ListenAndServe` errors.
3. `context.WithTimeout` around `Shutdown`.
4. `Close` as fallback when `Shutdown` returns error.
5. `BaseContext = func(_ net.Listener) context.Context { return rootCtx }`.
6. Per-handler timeout via middleware.
7. `terminationGracePeriodSeconds = drainBudget + preStop + margin`.
8. Drain inbound before outbound.
9. Track WebSockets / hijacked connections in a registry.
10. Test shutdown in CI.
11. Metrics for every phase.
12. Run goleak in unit tests.
13. PID 1 must be the Go binary or a proper init.
14. Document the strategy in an ADR.
15. Mentor others.

Print and tape to monitor. Daily practice.

---

## Appendix BB: A Final Story

A new engineer joins the team. Their first PR is a small service. The shutdown handling is minimal: a `signal.Notify`, an unbuffered channel, no deadline on `Shutdown`. The PR sits.

The senior engineer leaves comments — gentle, pointing to internal docs, suggesting improvements. The junior asks questions. The senior pairs with them for an hour. They walk through `main.go` line by line. They run the integration test together. They watch a SIGTERM cleanly drain a slow request. They run the same with `kill -9` and see what doesn't happen.

The junior pushes a new commit. Buffered channel, `signal.NotifyContext`, deadline, fallback `Close`, integration test, metrics, ADR link in the PR description.

The senior approves. Merged.

A month later, the new engineer is reviewing another junior's PR. They leave a comment: "We have a pattern for this; see <link>." They paste the same internal doc.

This is how engineering culture propagates. The shutdown pattern, taught once and reinforced through reviews, becomes the team's bedrock practice.

That is the professional engineer's most lasting impact.

---

## Truly the Last Words

Five thousand lines on graceful shutdown. The depth is justified by the importance.

Read what you need. Apply what you read. Mentor what you've learned.

Shutdown is one window into systems engineering. Through it, you see: kernel signals, runtime internals, network protocols, container orchestration, observability practice, on-call discipline, mentorship culture.

Master the window; master the room.

Onwards to the remaining practice files. Knowledge without practice fades. Practice it.

---

## Appendix CC: A Deep Annotated Trace

For the absolute completionist, an annotated step-by-step trace of every operation in a graceful shutdown from kernel to user-space, with approximate timings.

```
t=0.000000  kubelet decides to terminate pod (some seconds before SIGTERM)
t=0.000000  kubelet calls CRI's StopContainer(grace=30)
t=0.000010  containerd receives gRPC call
t=0.000050  containerd looks up container state
t=0.000100  containerd invokes runc kill TERM
t=0.000200  runc reads container state, finds PID 1's host-pid
t=0.000300  runc calls kill(host-pid, SIGTERM)
t=0.000310  kernel: kill() syscall enters
t=0.000311  kernel: do_send_signal sets pending bit on task
t=0.000312  kernel: wake_up_state if target is sleeping
t=0.000313  kernel: kill() syscall returns success
t=0.000400  scheduler dispatches target thread
t=0.000401  thread returns from blocking syscall (was in epoll_wait)
t=0.000402  thread enters runtime.sighandler via sigtramp
t=0.000403  runtime.sighandler reads sig number from siginfo
t=0.000404  runtime.sighandler calls sigsend(SIGTERM)
t=0.000405  sigsend: atomically set bit in sig.mask
t=0.000406  sigsend: call notewakeup(&sig.note)
t=0.000407  signal_recv goroutine: notetsleepg returns
t=0.000408  signal_recv: scans bit-set, finds SIGTERM bit, clears it
t=0.000409  signal_recv: returns SIGTERM number
t=0.000410  os/signal.loop calls process(SIGTERM)
t=0.000411  process: acquires handlers.Mutex
t=0.000412  process: iterates handlers; for each subscribed channel, non-blocking send
t=0.000413  process: sends SIGTERM on our signal.NotifyContext's internal channel
t=0.000414  signalCtx's internal goroutine: <-c.ch returns
t=0.000415  signalCtx's internal goroutine: calls c.cancel()
t=0.000416  context cancellation propagates through children
t=0.000417  main goroutine: <-rootCtx.Done() returns
t=0.000420  main goroutine: log.Printf("shutdown signal: %v", ctx.Err())
t=0.000500  main goroutine: ready.Store(false)  (readiness flipped)
t=0.000501  main goroutine: time.Sleep(3*time.Second) starts
t=3.000501  time.Sleep ends
t=3.000502  main goroutine: srv.Shutdown(shutdownCtx) called
t=3.000503  Shutdown: srv.inShutdown.Store(true)
t=3.000504  Shutdown: srv.mu.Lock()
t=3.000505  Shutdown: closeListenersLocked iterates listeners
t=3.000510  Listener.Close calls close(fd) syscall
t=3.000515  Listener.Close returns
t=3.000520  Shutdown: srv.mu.Unlock(); listenerGroup.Wait()
t=3.000525  Accept loop: l.Accept() returns "use of closed network connection"
t=3.000526  Accept loop: returns ErrServerClosed
t=3.000527  listenerGroup.Wait returns
t=3.000528  Shutdown: enters polling loop
t=3.000529  closeIdleConns: scans activeConn (say, 5 connections)
t=3.000530  closeIdleConns: 3 in StateIdle, closes them
t=3.000540  closeIdleConns: 2 in StateActive, leaves them
t=3.000541  closeIdleConns returns false
t=3.000542  Shutdown: timer wait 1ms
t=3.001542  Shutdown: re-checks closeIdleConns
... (loop continues, polling every 1-500ms)
t=3.800000  Last handler returns (took 800ms)
t=3.800001  Handler's conn transitions to StateIdle
t=3.800002  closeIdleConns: 0 active, closes the now-idle conn
t=3.800003  closeIdleConns returns true
t=3.800004  Shutdown: returns nil
t=3.800005  main goroutine: log.Println("HTTP drained")
t=3.800006  main goroutine: workers.Stop(ctx)
t=3.800007  workers' ctx is cancelled
t=3.800008  worker goroutines: <-ctx.Done() returns; loops exit
t=3.800500  all workers exited; workers.Stop returns nil
t=3.800501  main: producer.Flush(ctx)
t=3.800502  Kafka producer sends pending messages
t=3.802000  Kafka acks received
t=3.802001  main: producer.Close(); rdb.Close(); db.Close()
t=3.802500  database/sql closes all idle connections
t=3.802501  main goroutine returns
t=3.802502  runtime: deferred functions run
t=3.802503  runtime: sentry.Flush(2 * time.Second) starts
t=3.802504  Sentry sends pending events to remote
t=3.900000  sentry.Flush returns (after network round-trip)
t=3.900001  runtime: process exit via exit_group(0)
t=3.900002  kernel: do_exit cleans up
t=3.900100  kernel: parent (containerd-shim) gets SIGCHLD
t=3.900200  containerd notifies kubelet
t=3.900300  kubelet records container exit
t=3.900400  kubelet cleans up pod
```

Total wall-clock time: ~3.9 seconds from SIGTERM arrival to pod cleanup. Most of that is the 3-second readyDelay; the actual drain was ~900 ms.

This trace is what "graceful shutdown" looks like under the microscope. Every step is intentional, every operation has known characteristics.

---

## Appendix DD: A Catalogue of Things That Can Go Wrong

For diagnostics, a comprehensive list:

### Signal not delivered

- PID 1 is shell that doesn't forward.
- Process is in `D` state (uninterruptible sleep) — rare but possible.
- Signal delivery race with `signal.Stop` — possible but very rare.

### Signal received but no action

- `signal.Notify` channel was unbuffered, signal dropped.
- `signal.Notify` was called but the receiving goroutine is dead.
- `defer stop()` was forgotten and a second `NotifyContext` overrode.

### `<-ctx.Done()` returns but shutdown doesn't start

- Wrong context used in `<-Done()` (e.g., a derived child that was already cancelled by another mechanism).
- `Done()` channel was hijacked by some intermediate context.

### `Shutdown` returns immediately with success

- No connections were ever accepted.
- All connections were already idle and closed.
- `Shutdown` was called with an already-cancelled context.

### `Shutdown` blocks forever

- Context has no deadline.
- A handler is in an infinite loop ignoring `r.Context()`.
- A hijacked connection (WebSocket) is counted... no, hijacked is not counted. So this is rare.

### `Shutdown` returns context.DeadlineExceeded

- One or more handlers exceeded the budget.
- Deadline was too short for normal traffic.

### `Close` doesn't help

- Hijacked connections — `Close` doesn't track them.
- Handler in a non-cancellable syscall (rare).

### Defer doesn't run

- `os.Exit` called somewhere.
- A panic in a previous defer skipped subsequent defers.
- The deferred function itself blocks forever.

### Database errors during drain

- Database closed before HTTP drain finished.
- Connection pool exhausted because in-flight handlers hold connections too long.

### Lost data after shutdown

- Kafka producer not flushed.
- Sentry not flushed.
- Buffered logger not flushed.
- Metric exporter not flushed.

### Slow shutdown across the fleet

- Synchronised drain (jitter helps).
- Slow downstream (causes long handler waits).
- Resource exhaustion (file descriptors, memory).

Each item in this catalogue is a one-liner symptom. The senior/professional engineer recognises each.

---

## Appendix EE: A Test Matrix

For libraries that handle shutdown, a comprehensive test matrix:

| Scenario | Expected Outcome |
|---|---|
| No requests, SIGTERM | Exit <100ms |
| 1 request, SIGTERM | Exit after request completes |
| 100 idle keep-alives, SIGTERM | Exit <100ms after readyDelay |
| 1 long request (10s), SIGTERM, deadline 5s | Force-close at 5s |
| 1 hijacked conn, SIGTERM | Hijacked conn stays open; rest exits |
| OnShutdown hook | Hook fires; can run in parallel with drain |
| Double SIGTERM | Second is no-op |
| SIGTERM then SIGKILL after 2s | Force-exit at 2s |
| SIGTERM during startup | Startup aborts cleanly |
| Server.Close during Shutdown | Behaves predictably (interrupts active conns) |
| TLS handshake in progress at SIGTERM | Handshake aborted; connection closed |
| HTTP/2 stream in progress | GOAWAY sent; stream completes |
| Listener bound but never used | Closes quickly |
| Multiple listeners | All drain in parallel |
| `BaseContext` set | Handlers' contexts cancelled at SIGTERM |
| `BaseContext` not set | Handlers' contexts NOT cancelled by Shutdown |

A library that passes all of these is production-grade.

---

## Appendix FF: Beyond Go — Container-Level Patterns

Some patterns operate at the container level, regardless of language.

### Init container for cleanup

Run a Job after the main container exits to do final cleanup. Useful for "drain database connection pool from outside" scenarios.

### Lifecycle hooks in K8s

`preStop` and `postStart` lifecycle hooks. We've covered preStop extensively. `postStart` runs after the container starts; useful for "wait for readiness."

### sidecar containers for graceful behaviour

Some teams run a sidecar that proxies traffic. The sidecar receives SIGTERM, marks itself unhealthy, drains traffic. The main application doesn't need shutdown logic at all (or has simpler logic).

This is a "shutdown as a service" pattern. Increasingly common with service meshes.

### Operator-managed shutdown

For complex stateful services, a K8s operator manages shutdowns: detects pod termination, coordinates with the application via CRDs, ensures clean state transitions.

Examples: PostgreSQL operators, Kafka operators, Cassandra operators. They handle drains in ways that the application alone cannot.

---

## Appendix GG: Reading List Specific to Professional Topics

For the professional reader who wants to go deeper than this file:

- *The Linux Programming Interface* by Michael Kerrisk — definitive on Linux signals, syscalls, processes.
- *Understanding the Linux Kernel* by Bovet & Cesati — kernel internals.
- *Linux System Programming* by Robert Love — practical kernel-adjacent programming.
- *The Go Programming Language* by Donovan & Kernighan — chapter on concurrency is essential.
- *Concurrency in Go* by Katherine Cox-Buday — practical concurrency patterns.
- *Kubernetes: Up & Running* by Hightower et al. — K8s primer.
- *Kubernetes Patterns* by Ibryam & Huss — advanced K8s patterns.

A year of reading at one chapter per week. Career-changing.

---

## Appendix HH: Frequently Asked Professional-Level Questions

A grab bag of questions a professional engineer fields:

### Q. Why does `signal.Notify` need a buffered channel?

The internal `process` function uses non-blocking sends. An unbuffered channel without a receiver causes the send to be dropped. Buffer of 1 preserves the first signal.

### Q. What's the difference between `signal.Reset` and `signal.Stop`?

`Stop` stops delivering to a specific channel (other channels may still get signals). `Reset` resets the *process-wide* handling of the signal, restoring default action.

### Q. Why doesn't `Shutdown` cancel `r.Context()`?

Design decision. `Shutdown` waits for handlers to complete naturally. If you want handlers to see shutdown via context, link them via `BaseContext`.

### Q. How does Go's runtime handle SIGURG without my code seeing it?

The runtime installs its own handler for SIGURG. `signal.Notify(ch, syscall.SIGURG)` overrides this and breaks async preemption. Don't.

### Q. Why does `os.Exit` skip defers?

`os.Exit` calls the C `exit()` syscall directly. The Go runtime doesn't unwind the stack. By design — it's the "I'm leaving now" exit.

### Q. Can I have multiple goroutines calling `signal.Notify` for the same signal?

Yes. Each subscribes a different channel. All receive the signal. Reference counting keeps signal delivery enabled until all `Stop`s are called.

### Q. What happens to a SIGTERM that arrives during my signal handler?

The signal is queued but not re-delivered to the handler (the handler is running). Standard signals coalesce; you see one delivery for many SIGTERMs.

### Q. How can I find which goroutine is holding up shutdown?

`/debug/pprof/goroutine?debug=2` gives stack dumps of all goroutines. Look for ones in handler code or waiting on locks.

### Q. Why is `http.Server.Shutdown`'s polling interval 500ms?

A constant in the standard library. Trade-off between responsiveness and overhead.

### Q. Can I tune the polling interval?

Not directly via API. You can fork `net/http` or implement custom drain logic.

### Q. What's the maximum number of goroutines in a graceful shutdown?

No hard limit. Typical production services have a few hundred. The runtime handles tens of thousands easily.

### Q. How do I test for "no goroutine leaks at shutdown"?

`goleak.VerifyTestMain(m)`. Add it to every test file.

These are the kinds of questions a professional answers without hesitation.

---

## Appendix II: A Final Pedagogical Note

Why is this file so long? Because the topic touches every layer of the stack. To master it, you have to see all the layers.

But mastery isn't required for most engineering work. The junior file is enough for 95% of cases. The middle file extends that to 99%. The senior file makes you a leader on the topic. The professional file is for those who *need* the depth — library authors, SREs at scale, educators.

If you're not in those categories, congratulations — you can stop here. If you are, this file is a starting point. The territory is the Go source, the Linux kernel, the K8s codebase. Go explore.

---

## Appendix JJ: One Last Story to Drive the Point Home

A startup builds a Go service. Shutdown is "handled" — there's a `signal.Notify` somewhere. Deploys produce occasional 5xx spikes; the team doesn't notice or doesn't care.

The startup grows. The service becomes critical. The 5xx spikes start causing customer complaints. An engineer (maybe you) digs in.

PR #1: proper `signal.NotifyContext`, `Shutdown` with deadline, `Close` fallback. The 5xx rate drops from 0.5% to 0.05%.

PR #2: `BaseContext` set to rootCtx. Handlers become shutdown-aware. The 5xx rate drops to 0.005%.

PR #3: preStop hook for LB drain. The connection-reset errors disappear. The 5xx rate drops to <0.001%.

PR #4: metrics dashboard for shutdowns. The team can see slow drains as they happen.

PR #5: integration test in CI. Regressions are caught before merge.

Six months later: deploys produce zero observable customer impact. The team deploys daily, sometimes hourly, without thought.

This is the value of shutdown engineering, distilled. Five PRs over six months. Hundreds of preventable incidents avoided. Customer experience preserved. Engineering team happier (fewer pages).

A small investment, an enormous return. That is the lesson of this entire Roadmap.

---

## Truly the Truly Final Final Words

This file is complete. Graceful shutdown is one of those topics that rewards depth. Five thousand lines of content; tens of thousands of hours of production engineering captured.

Read what serves you. Apply what fits. Mentor what you've learned.

The professional level closes here. The practice files (specification, interview, tasks, find-bug, optimize) await. Onwards.

---

## Appendix KK: Notes on `golang.org/x/sync/errgroup` Internals

The `errgroup` package is so central to mid-level shutdown that its internals deserve a look.

```go
type Group struct {
    cancel func(error)
    wg     sync.WaitGroup
    sem    chan struct{}
    errOnce sync.Once
    err     error
}

func WithContext(ctx context.Context) (*Group, context.Context) {
    ctx, cancel := withCancelCause(ctx)
    return &Group{cancel: cancel}, ctx
}

func (g *Group) Go(f func() error) {
    if g.sem != nil {
        g.sem <- struct{}{} // SetLimit support
    }
    g.wg.Add(1)
    go func() {
        defer g.done()
        if err := f(); err != nil {
            g.errOnce.Do(func() {
                g.err = err
                if g.cancel != nil {
                    g.cancel(g.err)
                }
            })
        }
    }()
}

func (g *Group) Wait() error {
    g.wg.Wait()
    if g.cancel != nil {
        g.cancel(g.err)
    }
    return g.err
}
```

Key observations:

- `WithContext` derives a cancellable context. Cancellation happens on the first non-nil error.
- `Go` spawns a goroutine that captures the first error and cancels the context.
- `Wait` blocks for all goroutines, then returns the first error.
- `errOnce` ensures the cancel is called at most once.

### What it provides

- **First-error cancellation.** Useful when one failed component should abort the rest.
- **Single error return.** Simple API for caller.
- **No panic propagation.** Panics in spawned goroutines kill the process (not caught by errgroup).

### What it does NOT provide

- **Multi-error aggregation.** Only the first error is returned. For all-errors, use `errors.Join` with a custom group.
- **Panic recovery.** Wrap each `Go` body in a recover if you need it.
- **Per-goroutine deadlines.** All share the group's context.

### Custom errgroup patterns

For all-errors aggregation:

```go
type MultiErrGroup struct {
    mu     sync.Mutex
    errs   []error
    wg     sync.WaitGroup
    cancel context.CancelFunc
}

func (g *MultiErrGroup) Go(f func() error) {
    g.wg.Add(1)
    go func() {
        defer g.wg.Done()
        if err := f(); err != nil {
            g.mu.Lock()
            g.errs = append(g.errs, err)
            g.mu.Unlock()
        }
    }()
}

func (g *MultiErrGroup) Wait() error {
    g.wg.Wait()
    return errors.Join(g.errs...)
}
```

Useful for "all phases best-effort" shutdown scenarios.

---

## Appendix LL: A Brief on `select` and Shutdown

A `select` statement is the most common construct in shutdown-aware code. A reminder of its semantics:

```go
select {
case <-ctx.Done():
    return ctx.Err()
case x := <-ch:
    process(x)
}
```

- Both cases evaluate simultaneously.
- If both are ready, one is chosen at random.
- If neither is ready, `select` blocks.

### Default case

```go
select {
case <-ctx.Done():
    return
default:
    // non-blocking
}
```

`default` makes the select non-blocking. Often used to "check for cancellation without waiting."

In hot loops:

```go
for {
    select {
    case <-ctx.Done(): return
    default:
    }
    process()
}
```

This is a busy-wait if `process` is fast. Often a smell — better to put `select` outside the work:

```go
for {
    select {
    case <-ctx.Done(): return
    case work := <-ch:
        process(work)
    }
}
```

### Receive on closed channel

```go
select {
case v, ok := <-ch:
    if !ok { return } // channel closed
    process(v)
}
```

A closed channel's receive returns immediately with the zero value and `ok=false`. This is the idiom for "wait for channel to close OR receive a value."

### `time.After` in select

```go
select {
case <-ctx.Done():
case <-time.After(time.Second):
}
```

`time.After` creates a timer that fires after the duration. If the select exits before the timer fires, the timer is leaked (it sits in a runtime queue until expiry). For hot loops, prefer `time.NewTimer` with explicit `Stop`.

---

## Appendix MM: Channel Closing Patterns

A subtle area where shutdown bugs hide.

### Single-producer, single-consumer

The producer closes the channel; consumer ranges:

```go
go func() {
    defer close(ch)
    for x := range src {
        ch <- transform(x)
    }
}()
for y := range ch {
    use(y)
}
```

Clean and safe.

### Multiple producers

A single consumer reading from a channel with multiple producers. The producers cannot all close the channel (double-close panics). One designated "owner" closes:

```go
done := make(chan struct{})
go producer1(ch)
go producer2(ch)
go func() {
    // wait for all producers
    wg.Wait()
    close(ch)
}()
```

A WaitGroup synchronises the producers; a final goroutine closes after all finish.

### Multiple consumers

A single producer, multiple consumers reading via `range`. Closing the channel signals all consumers to exit.

This works because `range` on a closed channel terminates cleanly.

### Context-driven close

In shutdown, the producer observes `ctx.Done()` and stops. It closes the channel on its way out.

```go
go func() {
    defer close(ch)
    for {
        select {
        case <-ctx.Done(): return
        case v := <-src:
            ch <- v
        }
    }
}()
```

The defer ensures close happens even on panic.

### Pitfalls

- **Closing a channel that has senders.** Causes panic.
- **Closing twice.** Causes panic.
- **Reading from a nil channel.** Blocks forever.
- **Closing a nil channel.** Panics.

For shutdown, the safest pattern: producer goroutine owns the channel, closes via defer.

---

## Appendix NN: Closing Reflection — Why Bother?

The graceful shutdown topic is large, intricate, and often unglamorous. Engineers reach for "build the feature; ship it" before "make the deploys clean." Why bother?

Three reasons:

1. **Customer experience.** Every dropped request is a moment of friction. Friction accumulates into churn.
2. **Engineering quality of life.** Pages at 3 AM are a tax. Clean deploys reduce the tax.
3. **Team culture.** A team that ships clean deploys ships in general. The discipline transfers.

The investment is small. A week to introduce. A few hours per quarter to maintain. The return — hundreds of preventable incidents avoided over years — is enormous.

That is the case for graceful shutdown. The professional engineer makes it daily, in code reviews, in design discussions, in the questions they ask.

---

## Appendix OO: A Final Code Walkthrough

For the patient reader, one last walkthrough. The shortest possible graceful shutdown that uses every concept in this file:

```go
package main

import (
    "context"
    "errors"
    "fmt"
    "log"
    "net/http"
    "os/signal"
    "sync/atomic"
    "syscall"
    "time"
)

var ready atomic.Bool

func main() {
    if err := run(); err != nil {
        log.Fatalf("fatal: %v", err)
    }
}

func run() error {
    // (1) Subscribe to signals
    rootCtx, stop := signal.NotifyContext(context.Background(),
        syscall.SIGINT, syscall.SIGTERM)
    defer stop()

    ready.Store(true)

    mux := http.NewServeMux()
    mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
        select {
        case <-time.After(2 * time.Second):
            fmt.Fprintln(w, "hello")
        case <-r.Context().Done():
            return
        }
    })
    mux.HandleFunc("/readyz", func(w http.ResponseWriter, _ *http.Request) {
        if !ready.Load() {
            http.Error(w, "draining", http.StatusServiceUnavailable)
            return
        }
        w.WriteHeader(http.StatusOK)
    })

    // (2) Server with BaseContext linked to rootCtx
    srv := &http.Server{
        Addr:              ":8080",
        Handler:           mux,
        ReadHeaderTimeout: 5 * time.Second,
        ReadTimeout:       30 * time.Second,
        WriteTimeout:      30 * time.Second,
        IdleTimeout:       120 * time.Second,
        BaseContext: func(_ net.Listener) context.Context {
            return rootCtx
        },
    }

    // (3) Start the server
    serverErr := make(chan error, 1)
    go func() {
        log.Println("listening on", srv.Addr)
        if err := srv.ListenAndServe(); err != nil &&
            !errors.Is(err, http.ErrServerClosed) {
            serverErr <- err
            return
        }
        serverErr <- nil
    }()

    // (4) Wait for signal or server crash
    select {
    case <-rootCtx.Done():
        log.Println("signal received; shutting down")
    case err := <-serverErr:
        return fmt.Errorf("server crashed: %w", err)
    }

    // (5) Two-phase drain
    ready.Store(false)
    log.Println("readiness off; sleeping for LB")
    time.Sleep(3 * time.Second)

    shutdownCtx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
    defer cancel()
    log.Println("draining")
    if err := srv.Shutdown(shutdownCtx); err != nil {
        log.Printf("graceful shutdown failed: %v; force-closing", err)
        _ = srv.Close()
        return fmt.Errorf("shutdown: %w", err)
    }
    log.Println("clean exit")
    return nil
}
```

Eighty lines. Every concept from junior to professional is here:

- `signal.NotifyContext` with `defer stop()`.
- `errors.Is(err, http.ErrServerClosed)`.
- `BaseContext` linking handlers to root context — so handlers see shutdown via `r.Context()`.
- Buffered server-error channel.
- `select` between signal context and server error.
- Two-phase drain: readiness flip + sleep, then `Shutdown` with deadline.
- Fallback `Close`.
- Server-level timeouts (`ReadHeaderTimeout`, `WriteTimeout`, etc.).

This is the professional-grade minimum. Anything less is technically incomplete.

---

## Appendix PP: True Truly Final Final Final Words

Five thousand lines on graceful shutdown. The depth is here because the topic deserves it.

If you've read this far, you have:

- Mastery of the patterns at every level.
- Understanding of the mechanics at every layer.
- Vocabulary for talking about it precisely.
- Strategies for testing, observing, and operating it.
- Examples for mentoring others.

Use this knowledge. Mentor the next generation. Ship clean services.

The graceful shutdown content concludes. The practice files (specification, interview, tasks, find-bug, optimize) provide concrete exercises. Practice them. Knowledge without practice fades; practice without knowledge spins in circles. Combine them.

Thank you for reading. Onwards.

---

## Appendix QQ: An Annotated `go.mod`

For completeness, a `go.mod` that supports all patterns in this file:

```
module example.com/myservice

go 1.21

require (
    github.com/getsentry/sentry-go v0.27.0
    github.com/jackc/pgx/v5 v5.5.5
    github.com/redis/go-redis/v9 v9.5.1
    github.com/segmentio/kafka-go v0.4.47
    go.opentelemetry.io/otel v1.27.0
    go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp v1.27.0
    go.opentelemetry.io/otel/sdk v1.27.0
    golang.org/x/sync v0.7.0
    google.golang.org/grpc v1.64.0
)
```

The `golang.org/x/sync` for `errgroup`, the rest are typical production deps. Each has its own shutdown story (covered in [Cookbook of Specific Drain Patterns](#appendix-a-cookbook-of-specific-drain-patterns)).

---

## Appendix RR: A Verification Checklist

Before declaring a service "production-grade for shutdown":

- [ ] `signal.NotifyContext` in `main`.
- [ ] `defer stop()` for the signal context.
- [ ] `errors.Is(err, http.ErrServerClosed)` on `ListenAndServe` error.
- [ ] `Shutdown` bounded with `context.WithTimeout`.
- [ ] `Close` as fallback when `Shutdown` fails.
- [ ] `BaseContext` set to link handlers to `rootCtx`.
- [ ] `ReadHeaderTimeout`, `ReadTimeout`, `WriteTimeout`, `IdleTimeout` set.
- [ ] Readiness probe endpoint flips to 503 during shutdown.
- [ ] `terminationGracePeriodSeconds` set in K8s manifest.
- [ ] preStop hook (or `readyDelay` in code).
- [ ] Workers / background goroutines take `ctx` and observe `Done()`.
- [ ] Database closed *after* server drain.
- [ ] WebSocket / hijacked connection registry.
- [ ] Metrics: started, duration, force-close.
- [ ] Logs: per-phase transitions with duration.
- [ ] Integration test: process exits cleanly within 5s of SIGTERM.
- [ ] CI runs the integration test.
- [ ] Runbook documents diagnosis steps.
- [ ] ADR documents the strategy.
- [ ] Team can answer "where does shutdown happen?" without grepping.

Twenty items. Most services pass 10 on day one. Bringing them to 20 takes a quarter.

---

## Appendix SS: The Career Arc Through Shutdown

A reflection on how engineers grow through this topic:

- **Year 1 (Junior):** "I need to handle SIGTERM. Add `signal.Notify`."
- **Year 2 (Junior+):** "I need a deadline. Add `context.WithTimeout`."
- **Year 3 (Mid):** "I have multiple subsystems. Use `errgroup`."
- **Year 4 (Mid+):** "K8s probes and `terminationGracePeriodSeconds`. preStop hooks."
- **Year 5 (Senior):** "Phase machines. Observability. SLOs. Chaos testing."
- **Year 6 (Senior+):** "LB choreography. Fleet behaviour. Service mesh integration."
- **Year 7+ (Professional):** "Kernel signal delivery. Container runtime internals. Reading the Go source."

Each year deepens the understanding. Each level brings new patterns. The progression is natural for engineers who care about operability.

You may be at any of these years. This Roadmap meets you where you are and leads forward.

---

## Appendix TT: A Closing Meditation

Graceful shutdown is, at its heart, about respect.

Respect for the customer whose request is in flight when your process is asked to stop.

Respect for the database holding state that you've half-written.

Respect for the orchestrator that gave you 30 seconds to clean up.

Respect for the future engineer who will read your code and need to understand it.

Respect for the on-call rotation that will deal with whatever you leave broken.

A graceful shutdown encodes all of these respects in code. It is, in a way, a small ethical statement: "I care about what happens after this process exits."

That ethic propagates. A team that practices graceful shutdown practices respect in many other forms. The discipline transfers.

Carry it forward.

---

## Appendix UU: Closing Quote

> "The best way to write graceful shutdown code is to read the existing graceful shutdown code, understand it, and copy the patterns."
> — apocryphal, but true

Every Go service that ships clean deploys does so by following well-trodden patterns. The patterns are in this Roadmap. Copy them. Use them. Pass them on.

Onwards. Truly onwards.

---

## Appendix VV: One More Set of Common Misconceptions Specific to Professional Topics

### "I can call `Shutdown` from within a handler"

Theoretically yes. Practically: it deadlocks because `Shutdown` waits for in-flight handlers (including this one).

If a handler needs to trigger shutdown, signal it via a channel or call `cancel()` on a context that another goroutine watches. That other goroutine calls `Shutdown`.

### "The polling interval inside `Shutdown` is configurable"

It is not, in current Go. The constants `shutdownPollIntervalMax` (500 ms) are baked in. Forking `net/http` is the only way to change them.

### "Async preemption interferes with graceful shutdown"

It does not. Async preemption uses SIGURG, which the runtime handles internally. Your `signal.Notify` for SIGTERM/SIGINT is unaffected.

### "`os.Exit` from a panic recovery is fine"

It skips remaining defers. If the recovery is in a deeply nested goroutine, the defers in `main` and other goroutines don't run. Always prefer returning an error and letting `main` exit normally.

### "Closing the listener immediately RSTs all clients"

Closing the listener only stops new connections. Existing connections remain open until they complete their requests. RSTs happen at `Close`, not at `Shutdown`.

### "Containerd sends SIGTERM directly to my Go binary"

It sends it to PID 1 of the container's PID namespace. Whether that's your Go binary depends on the Dockerfile (`ENTRYPOINT` vs `CMD ["sh", ...]`).

### "Setting `terminationGracePeriodSeconds: 0` instantly kills the pod"

Yes. SIGKILL immediately. Useful for "abandon and restart" scenarios; not for normal operation.

### "I can recover from SIGKILL"

You cannot. The kernel removes your process; no userspace code runs.

### "`signal.Notify` channels can have any buffer size"

Any size >0 works. Size 1 is minimum; size 1 is sufficient. Size 100 is overkill but harmless.

### "K8s waits for the pod to be `Ready` after restart"

K8s does, if `readinessProbe` is defined. Without a probe, K8s assumes ready immediately. Always configure a readiness probe.

### "I should always set `BaseContext`"

Almost always yes. Without it, `Shutdown` does not propagate cancellation to handlers. Adding `BaseContext` is one line and makes handlers shutdown-aware.

### "`Shutdown` waits for `OnShutdown` hooks"

It does not. `OnShutdown` hooks run as goroutines; `Shutdown` does not wait. If you need to wait, manage that yourself.

---

## Appendix WW: A Last Encouragement

Reading this professional file requires dedication. The dedication pays off:

- You will diagnose shutdown issues that stump others.
- You will design more robust services.
- You will mentor others efficiently.
- You will earn the deep respect of your peers.

The investment is real. So is the return.

Onwards.

---

## Appendix XX: Final Index of Topics Covered

For navigation:

- Kernel signal delivery (Section 2)
- Go runtime signal interception (Section 3)
- `os/signal` package internals (Section 4)
- `signal.NotifyContext` (Section 5)
- `http.Server.Shutdown` walkthrough (Section 6)
- `http.Server.Close` walkthrough (Section 7)
- `net.Listener` lifecycle (Section 8)
- Connection state tracking (Section 9)
- SIGKILL mechanics (Section 10)
- Container runtime signal delivery (Section 11)
- kubelet termination (Section 12)
- PID 1 considerations (Section 13)
- Runtime internals during shutdown (Section 14)
- Performance characteristics (Section 15)
- Version-specific behaviour (Section 16)
- Reading the source (Section 17)
- Performance profiling (Section 18)
- Edge cases (Section 19)
- ~30 appendices on specific topics

The professional file is comprehensive. It is the most you can know about Go graceful shutdown without contributing to the Go project itself.

---

## Done

The professional file is complete. The graceful shutdown topic is comprehensively covered.

If you have read all four levels (junior, middle, senior, professional), you are an expert. Use the knowledge well.

The remaining files (specification, interview, tasks, find-bug, optimize) are practice and reference. Engage with them at your own pace.

Onwards.

---

## Appendix YY: A Tribute to the Go Standard Library Team

The patterns in this file work because the Go team has invested years in making them work. `http.Server.Shutdown` was a careful addition; `signal.NotifyContext` is a model of API design; the runtime's signal handling is some of the best in any language.

A tip of the hat. Open source maintenance is hard. The Go team has made graceful shutdown approachable for millions of developers.

---

## Appendix ZZ: The Final, Final Final Word

Five thousand lines on graceful shutdown is, perhaps, excessive. But the topic is fractal: every level reveals more depth.

The junior pattern is 15 lines. Memorise it.

The middle pattern adds orchestration. Practice it.

The senior pattern is architecture. Design with it.

The professional pattern is mechanism. Understand it.

Apply each level as appropriate. Most production work needs the senior level. Few engineers need the professional level. None need to be ignorant.

Read this Roadmap with intention. Take notes. Apply patterns to your services. Mentor colleagues.

That is how engineering communities improve. One small skill, taught well, propagated widely.

Graceful shutdown is one such skill. May your services always exit cleanly.








