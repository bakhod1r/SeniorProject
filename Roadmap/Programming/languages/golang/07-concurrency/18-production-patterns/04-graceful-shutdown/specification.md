---
layout: default
title: Specification
parent: Graceful Shutdown
grand_parent: Production Patterns
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/18-production-patterns/04-graceful-shutdown/specification/
---

# Graceful Shutdown — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [Go Language Spec References](#go-language-spec-references)
3. [`os/signal` Package Contract](#ossignal-package-contract)
4. [`context` Package Contract](#context-package-contract)
5. [`net/http.Server.Shutdown` Contract](#nethttpservershutdown-contract)
6. [Kubernetes Pod Lifecycle Specification](#kubernetes-pod-lifecycle-specification)
7. [UNIX Signal Specification](#unix-signal-specification)
8. [Version Compatibility](#version-compatibility)
9. [Undefined or Implementation-Specific Behaviour](#undefined-or-implementation-specific-behaviour)
10. [References](#references)

---

## Introduction

This file collects the normative contracts for graceful shutdown in Go. The contracts come from three sources:

- The Go standard library documentation (`pkg.go.dev`).
- The Kubernetes documentation (`kubernetes.io/docs`).
- The POSIX/Linux specification for signals.

Where the documentation is ambiguous, this file notes the de facto behaviour observed in the Go source (1.21+). The aim is precision; user-facing patterns are in the level files.

---

## Go Language Spec References

The Go language specification (`go.dev/ref/spec`) does not directly mention graceful shutdown. Relevant indirect concepts:

- **Goroutines.** "When the function terminates, its goroutine also terminates."
- **Channels.** "Closing a channel after the last send completes, that lets receivers detect closure."
- **`defer` statement.** "A deferred function's invocation is executed immediately before the surrounding function returns."

None of these are shutdown-specific; they are foundational mechanisms used by shutdown patterns.

The spec also defines `select` semantics (random selection among ready cases) which is critical for shutdown-aware code.

---

## `os/signal` Package Contract

From `pkg.go.dev/os/signal`:

### `func Notify(c chan<- os.Signal, sig ...os.Signal)`

> Notify causes package signal to relay incoming signals to c. If no signals are provided, all incoming signals will be relayed to c. Otherwise, just the provided signals will.
>
> Package signal will not block sending to c: the caller must ensure that c has sufficient buffer space to keep up with the expected signal rate.
>
> It is allowed to call Notify multiple times with the same channel: each call expands the set of signals sent to that channel.

Key normative points:

- Signal delivery is **non-blocking**. A full channel **silently drops** the signal.
- The caller is responsible for buffer sizing.
- Multiple calls accumulate signals.

### `func Stop(c chan<- os.Signal)`

> Stop causes package signal to stop relaying incoming signals to c. It undoes the effect of all prior calls to Notify using c.

After `Stop`, the channel no longer receives signals. The runtime's reference count for the registered signals is decremented; if it drops to zero, the signal's handling reverts to default.

### `func NotifyContext(parent context.Context, signals ...os.Signal) (ctx context.Context, stop context.CancelFunc)`

Added in Go 1.16.

> NotifyContext returns a copy of the parent context that is marked done (its Done channel is closed) when one of the listed signals arrives, when the returned stop function is called, or when the parent context's Done channel is closed, whichever happens first.
>
> The stop function unregisters the signal behavior, which, like signal.Reset, may restore the default behavior for a given signal.

Normative points:

- The returned context is a derived context.
- It is cancelled on first signal arrival.
- `stop` deregisters and may restore default behaviour.
- Multiple signals are coalesced — only first triggers cancellation; the rest are dropped.

### `func Reset(sig ...os.Signal)`

> Reset undoes the effect of any prior calls to Notify for the provided signals. If no signals are provided, all signal handlers will be reset.

`Reset` is more drastic than `Stop`. It resets the process-wide handling.

### `func Ignored(sig os.Signal) bool`

> Ignored reports whether sig is currently ignored.

---

## `context` Package Contract

From `pkg.go.dev/context`:

### `Context interface`

> A Context carries a deadline, a cancellation signal, and other values across API boundaries.

Methods:

- `Deadline() (deadline time.Time, ok bool)` — returns the time after which work should be cancelled.
- `Done() <-chan struct{}` — returns a channel that is closed when work should be cancelled.
- `Err() error` — returns nil if Done is not yet closed; otherwise, returns a non-nil error.
- `Value(key any) any` — returns the value associated with key.

### `func WithCancel(parent Context) (Context, CancelFunc)`

> WithCancel returns a copy of parent with a new Done channel. The returned context's Done channel is closed when the returned cancel function is called or when the parent context's Done channel is closed, whichever happens first.

Cancel is idempotent. Calling cancel multiple times is safe.

### `func WithTimeout(parent Context, timeout time.Duration) (Context, CancelFunc)`

> WithTimeout returns WithDeadline(parent, time.Now().Add(timeout)).

The returned context is cancelled when the timeout elapses OR cancel is called OR parent is cancelled, whichever happens first.

### `func WithDeadline(parent Context, d time.Time) (Context, CancelFunc)`

Same as `WithTimeout` but with absolute time.

### `func WithCancelCause(parent Context) (Context, CancelCauseFunc)`

Added in Go 1.20.

> WithCancelCause behaves like WithCancel but returns a CancelCauseFunc instead of a CancelFunc. Calling cancel with a non-nil error ("the cause") records that error in ctx; it can then be retrieved by calling Cause(ctx).

Useful for richer cancellation diagnostics.

### `func AfterFunc(ctx Context, f func()) (stop func() bool)`

Added in Go 1.21.

> AfterFunc arranges to call f in its own goroutine after ctx is done.

Useful for "run cleanup when context is cancelled" without spawning a goroutine yourself.

---

## `net/http.Server.Shutdown` Contract

From `pkg.go.dev/net/http#Server.Shutdown`:

> Shutdown gracefully shuts down the server without interrupting any active connections. Shutdown works by first closing all open listeners, then closing all idle connections, and then waiting indefinitely for connections to return to idle and then shut down. If the provided context expires before the shutdown is complete, Shutdown returns the context's error, otherwise it returns any error returned from closing the Server's underlying Listener(s).
>
> When Shutdown is called, Serve, ListenAndServe, and ListenAndServeTLS immediately return ErrServerClosed. Make sure the program doesn't exit and waits instead for Shutdown to return.
>
> Shutdown does not attempt to close nor wait for hijacked connections such as WebSockets. The caller of Shutdown should separately notify such long-lived connections of shutdown and wait for them to close, if desired.
>
> Once Shutdown has been called on a server, it may not be reused; future calls to methods such as Serve will return ErrServerClosed.

Normative points:

- Shutdown closes listeners immediately.
- Idle connections close immediately.
- Active connections are allowed to finish.
- Hijacked connections are NOT tracked or waited for.
- `ListenAndServe` returns `http.ErrServerClosed` after `Shutdown` is called.
- A server cannot be reused after `Shutdown`.

### `func (srv *Server) Close() error`

> Close immediately closes all active net.Listeners and any connections in state StateNew, StateActive, or StateIdle. For a graceful shutdown, use Shutdown.
>
> Close does not attempt to close (and does not even know about) any hijacked connections, such as WebSockets.
>
> Close returns any error returned from closing the Server's underlying Listener(s).

Normative points:

- Close is brutal: interrupts all active connections.
- Hijacked connections are not tracked.

### `func (srv *Server) RegisterOnShutdown(f func())`

> RegisterOnShutdown registers a function to call on Shutdown. This can be used to gracefully shutdown connections that have undergone NPN/ALPN protocol upgrade or that have been hijacked. This function should start protocol-specific graceful shutdown, but should not wait for shutdown to complete.

Normative point: hooks are fire-and-forget. `Shutdown` does NOT wait for them.

### `http.ErrServerClosed`

```go
var ErrServerClosed = errors.New("http: Server closed")
```

Returned by `ListenAndServe`, `ListenAndServeTLS`, and `Serve` after `Shutdown` or `Close`.

### `http.Server.BaseContext` and `http.Server.ConnContext`

Added in Go 1.13.

```go
BaseContext func(net.Listener) context.Context
ConnContext func(ctx context.Context, c net.Conn) context.Context
```

- `BaseContext` provides the base context for all new requests on a listener.
- `ConnContext` modifies the context for each new connection.

Setting `BaseContext` to return your application's root context makes all handlers' `r.Context()` cancellable by your shutdown logic.

---

## Kubernetes Pod Lifecycle Specification

From `kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/`:

### Termination of pods

> Kubernetes will not terminate Pods immediately. Rather, Kubernetes follows a graceful termination sequence that allows Pods to perform cleanup before being terminated.

The sequence:

1. The user sends a delete command to the API server.
2. The pod is marked Terminating.
3. The kubelet detects the change.
4. The kubelet runs the `preStop` hook (if defined).
5. The kubelet sends SIGTERM to PID 1 in each container.
6. The kubelet waits for `terminationGracePeriodSeconds`.
7. If the container has not exited, the kubelet sends SIGKILL.
8. The kubelet cleans up.

### `terminationGracePeriodSeconds`

> Optional duration in seconds the pod needs to terminate gracefully. May be decreased in delete request. Value must be non-negative integer. The value zero indicates stop immediately via the kill signal (no opportunity to shut down). If this value is nil, the default grace period will be used instead. The grace period is the duration in seconds after the processes running in the pod are sent a termination signal and the time when the processes are forcibly halted with a kill signal. Set this value longer than the expected cleanup time for your process. Defaults to 30 seconds.

Default: 30. Set explicitly for clarity.

### `preStop` hook

> PreStop is called immediately before a container is terminated due to an API request or management event such as liveness/startup probe failure, preemption, resource contention, etc. The handler is not called if the container crashes or exits.

Hook types:

- `exec`: runs a command in the container.
- `httpGet`: makes an HTTP GET request to the container.

The hook's execution time counts against `terminationGracePeriodSeconds`.

### Readiness probe

> If the readiness probe fails, the endpoints controller removes the Pod's IP address from the endpoints of all Services that match the Pod.

During shutdown, flipping readiness to fail causes the pod to be removed from Service endpoints. Existing connections continue; new requests stop landing on this pod.

### Liveness probe

> Many applications running for long periods of time eventually transition to broken states, and cannot recover except by being restarted. Kubernetes provides liveness probes to detect and remedy such situations.

Liveness should NOT fail during shutdown. Failure triggers a container restart.

---

## UNIX Signal Specification

From POSIX (`pubs.opengroup.org/onlinepubs/9699919799/`):

### Signal definitions

| Name | Number (typical) | Default Action |
|---|---|---|
| SIGHUP | 1 | Terminate |
| SIGINT | 2 | Terminate |
| SIGQUIT | 3 | Terminate + Core |
| SIGABRT | 6 | Terminate + Core |
| SIGKILL | 9 | Terminate (uncatchable) |
| SIGSEGV | 11 | Terminate + Core |
| SIGPIPE | 13 | Terminate |
| SIGALRM | 14 | Terminate |
| SIGTERM | 15 | Terminate |
| SIGCHLD | 17 | Ignore |
| SIGCONT | 18 | Continue (if stopped) |
| SIGSTOP | 19 | Stop (uncatchable) |
| SIGTSTP | 20 | Stop |
| SIGUSR1 | 30 | Terminate |
| SIGUSR2 | 31 | Terminate |

### `sigaction(2)`

The POSIX-specified API for installing signal handlers. Go's runtime uses this.

### Realtime signals (`SIGRTMIN`–`SIGRTMAX`)

> Real-time signals are different from standard signals: they can be queued, they carry data, and they are delivered in order of priority.

Go does not expose realtime signals via `os/signal`. They are reserved for runtime use.

### Signal masks

Each thread has a signal mask. Signals in the mask are blocked from delivery to that thread.

`sigprocmask(2)` modifies the mask. Go's runtime sets masks on its threads.

---

## Version Compatibility

### Go 1.7 and earlier

`http.Server.Shutdown` does not exist. Use third-party packages.

### Go 1.8

`Shutdown` added. `RegisterOnShutdown` added.

### Go 1.13

`BaseContext` and `ConnContext` added to `http.Server`.

### Go 1.14

Async preemption via SIGURG. Don't subscribe to SIGURG.

### Go 1.16

`signal.NotifyContext` added.

### Go 1.20

`context.WithCancelCause`, `context.WithDeadlineCause`.

### Go 1.21

`context.AfterFunc`, more robust scheduler.

### Go 1.22

Loop variable scoping change. Useful for goroutine-in-loop patterns.

### Go 1.23+

Iterators (`range func`). Not directly relevant but useful for shutdown utilities.

---

## Undefined or Implementation-Specific Behaviour

A few areas where the spec is loose or implementation-defined:

### Polling interval in `Shutdown`

The 500ms upper bound is a constant in `net/http`. Not specified externally. May change.

### Order of `OnShutdown` callbacks

Callbacks run in their own goroutines; order is non-deterministic. The spec does not promise any order.

### Signal coalescing

The spec says signals "may be coalesced." In practice, standard signals coalesce; realtime signals do not.

### Channel ordering in `signal.Notify`

If multiple channels are registered for the same signal, the order they receive the signal is not specified. In practice, it depends on map iteration order in Go.

### Hijacked connection lifecycle

After `Hijack`, the spec says the server "doesn't even know about" the connection. No further guarantees.

### `runtime.NumGoroutine()` during shutdown

Returns the current count, but the count is a snapshot. By the time you read it, the count may differ.

### `os.Exit` and asynchronous goroutines

`os.Exit` terminates the process immediately. No spec guarantee about what happens to goroutines.

### Container PID 1 signal forwarding

Not specified by K8s. Depends on the container init. Best practice: ensure your binary is PID 1 or use a forwarding init.

---

## References

### Go standard library

- `pkg.go.dev/os/signal`
- `pkg.go.dev/context`
- `pkg.go.dev/net/http`
- `pkg.go.dev/golang.org/x/sync/errgroup`

### Go source

- `src/os/signal/`
- `src/runtime/signal_unix.go`
- `src/runtime/sigqueue.go`
- `src/context/context.go`
- `src/net/http/server.go`

### Kubernetes

- `kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/`
- `kubernetes.io/docs/concepts/containers/container-lifecycle-hooks/`
- `kubernetes.io/docs/tasks/configure-pod-container/`

### POSIX / Linux

- `man 7 signal`
- `man 2 sigaction`
- `man 2 kill`
- IEEE Std 1003.1-2017 (POSIX)

### Container runtimes

- `containerd.io/docs`
- `github.com/opencontainers/runc`
- `github.com/krallin/tini`
- `github.com/Yelp/dumb-init`

### Service mesh

- `istio.io/docs`
- `linkerd.io/docs`
- `envoyproxy.io/docs`

### Related Go Roadmap files

- [Goroutines](../../01-goroutines/01-overview/) — foundational concurrency.
- [Context](../../05-context/) — cancellation primitive.
- [Channels](../../02-channels/) — synchronisation primitive.
- [Production patterns](../../) — broader context.

A working knowledge of each reference is the foundation of professional-level mastery.

---

## Appendix: Detailed Function Signatures

For quick reference:

```go
// os/signal
func Notify(c chan<- os.Signal, sig ...os.Signal)
func Stop(c chan<- os.Signal)
func NotifyContext(parent context.Context, signals ...os.Signal) (ctx context.Context, stop context.CancelFunc)
func Reset(sig ...os.Signal)
func Ignored(sig os.Signal) bool

// context
type Context interface {
    Deadline() (deadline time.Time, ok bool)
    Done() <-chan struct{}
    Err() error
    Value(key any) any
}
func Background() Context
func TODO() Context
func WithCancel(parent Context) (Context, CancelFunc)
func WithCancelCause(parent Context) (Context, CancelCauseFunc)
func WithTimeout(parent Context, timeout time.Duration) (Context, CancelFunc)
func WithDeadline(parent Context, d time.Time) (Context, CancelFunc)
func AfterFunc(ctx Context, f func()) (stop func() bool)
func Cause(c Context) error

// net/http
type Server struct {
    Addr              string
    Handler           Handler
    TLSConfig         *tls.Config
    ReadTimeout       time.Duration
    ReadHeaderTimeout time.Duration
    WriteTimeout      time.Duration
    IdleTimeout       time.Duration
    MaxHeaderBytes    int
    ConnState         func(net.Conn, ConnState)
    BaseContext       func(net.Listener) context.Context
    ConnContext       func(ctx context.Context, c net.Conn) context.Context
    ErrorLog          *log.Logger
}
func (srv *Server) ListenAndServe() error
func (srv *Server) ListenAndServeTLS(certFile, keyFile string) error
func (srv *Server) Serve(l net.Listener) error
func (srv *Server) ServeTLS(l net.Listener, certFile, keyFile string) error
func (srv *Server) Shutdown(ctx context.Context) error
func (srv *Server) Close() error
func (srv *Server) RegisterOnShutdown(f func())
func (srv *Server) SetKeepAlivesEnabled(v bool)

// errgroup
type Group struct{}
func WithContext(ctx context.Context) (*Group, context.Context)
func (g *Group) Go(f func() error)
func (g *Group) TryGo(f func() error) bool  // Go 1.20+
func (g *Group) Wait() error
func (g *Group) SetLimit(n int)  // Go 1.20+
```

These signatures are the bedrock. Memorise them.

---

## Appendix: Signal Constants

```go
// from syscall package, on UNIX
const (
    SIGABRT = Signal(0x6)
    SIGALRM = Signal(0xe)
    SIGBUS  = Signal(0x7)
    SIGCHLD = Signal(0x11)
    SIGCONT = Signal(0x12)
    SIGFPE  = Signal(0x8)
    SIGHUP  = Signal(0x1)
    SIGILL  = Signal(0x4)
    SIGINT  = Signal(0x2)
    SIGIO   = Signal(0x1d)
    SIGIOT  = Signal(0x6)
    SIGKILL = Signal(0x9)
    SIGPIPE = Signal(0xd)
    SIGPROF = Signal(0x1b)
    SIGPWR  = Signal(0x1e)
    SIGQUIT = Signal(0x3)
    SIGSEGV = Signal(0xb)
    SIGSTKFLT = Signal(0x10)
    SIGSTOP = Signal(0x13)
    SIGSYS  = Signal(0x1f)
    SIGTERM = Signal(0xf)
    SIGTRAP = Signal(0x5)
    SIGTSTP = Signal(0x14)
    SIGTTIN = Signal(0x15)
    SIGTTOU = Signal(0x16)
    SIGURG  = Signal(0x17)
    SIGUSR1 = Signal(0xa)  // varies by platform
    SIGUSR2 = Signal(0xc)
    SIGVTALRM = Signal(0x1a)
    SIGWINCH = Signal(0x1c)
    SIGXCPU = Signal(0x18)
    SIGXFSZ = Signal(0x19)
)
```

For graceful shutdown, the relevant constants are `SIGINT`, `SIGTERM`, and `SIGHUP`.

---

## Appendix: Behaviour Matrix

A reference table for each Go feature:

| Feature | Go 1.7 | 1.8 | 1.13 | 1.14 | 1.16 | 1.20 | 1.21 |
|---|---|---|---|---|---|---|---|
| `http.Server.Shutdown` | - | yes | yes | yes | yes | yes | yes |
| `RegisterOnShutdown` | - | yes | yes | yes | yes | yes | yes |
| `BaseContext` | - | - | yes | yes | yes | yes | yes |
| `ConnContext` | - | - | yes | yes | yes | yes | yes |
| Async preemption | - | - | - | yes | yes | yes | yes |
| `signal.NotifyContext` | - | - | - | - | yes | yes | yes |
| `WithCancelCause` | - | - | - | - | - | yes | yes |
| `AfterFunc` | - | - | - | - | - | - | yes |
| `errgroup.SetLimit` | - | - | - | - | - | yes | yes |
| `errgroup.TryGo` | - | - | - | - | - | yes | yes |

A service targeting 1.21+ has the cleanest API. Older versions still work but require more boilerplate.

---

## Appendix: Container Runtime Compatibility

Common container runtimes and their support for graceful behaviour:

| Runtime | preStop | SIGTERM forwarding | Notes |
|---|---|---|---|
| containerd | yes | depends on PID 1 | Most common in K8s |
| CRI-O | yes | depends on PID 1 | RHEL/OpenShift default |
| Docker (with shim) | yes | depends on PID 1 | Legacy |
| podman | yes | depends on PID 1 | Daemonless alternative |
| gVisor | yes | yes | Sandboxed; extra latency |
| Kata | yes | yes | VM-based; extra latency |

All support the basic K8s lifecycle hooks. Signal forwarding always depends on container PID 1.

---

## Appendix: Error Types

Errors specific to graceful shutdown:

- `http.ErrServerClosed`: returned by `ListenAndServe` after `Shutdown`/`Close`. Always check with `errors.Is`.
- `context.Canceled`: returned by `ctx.Err()` after `cancel()`.
- `context.DeadlineExceeded`: returned by `ctx.Err()` after deadline passes.

```go
errors.Is(err, context.DeadlineExceeded) // shutdown deadline reached
errors.Is(err, http.ErrServerClosed)     // normal shutdown
errors.Is(err, context.Canceled)         // explicit cancel
```

---

## Appendix: API Stability Notes

These APIs are stable and unlikely to change:

- `os/signal.Notify`, `Stop`
- `os/signal.NotifyContext` (since 1.16)
- `context.WithCancel`, `WithTimeout`, `WithDeadline`
- `http.Server.Shutdown`, `Close`, `RegisterOnShutdown`
- `errgroup.Group.Go`, `Wait`

These are evolving:

- `context.WithCancelCause` (since 1.20)
- `context.AfterFunc` (since 1.21)
- `errgroup.SetLimit` (since 1.20)

Stable APIs are safe to depend on. Evolving APIs may gain features but should not break.

---

## Appendix: A Final Reading Guide

For deepest understanding, in order:

1. `pkg.go.dev/os/signal` — start here.
2. `pkg.go.dev/context` — the cancellation primitive.
3. `pkg.go.dev/net/http#Server` — the HTTP server.
4. `kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/` — K8s lifecycle.
5. `man 7 signal` (UNIX) — signal mechanics.
6. The Go source (paths listed above) — the implementation.

A weekend reading these — and the level files — leaves you with comprehensive command of the topic.

