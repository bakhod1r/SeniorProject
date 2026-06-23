---
layout: default
title: Specification — Drain Pattern
parent: Drain Pattern
grand_parent: Production Patterns
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/18-production-patterns/05-drain-pattern/specification/
---

# Drain Pattern — Specification Reference

## Table of Contents
1. [Scope](#scope)
2. [Go Standard Library — `net/http`](#go-standard-library-nethttp)
3. [Go Standard Library — `os/signal`](#go-standard-library-ossignal)
4. [Go Standard Library — `context`](#go-standard-library-context)
5. [Go Standard Library — `sync`](#go-standard-library-sync)
6. [Go Extended Library — `errgroup`](#go-extended-library-errgroup)
7. [gRPC — `Server.GracefulStop`](#grpc-servergracefulstop)
8. [Kafka Rebalance Protocol](#kafka-rebalance-protocol)
9. [Kubernetes — Pod Lifecycle](#kubernetes-pod-lifecycle)
10. [Operating System Signals](#operating-system-signals)
11. [Bibliography](#bibliography)

---

## Scope

This page collects authoritative references for drain-related primitives in Go and the surrounding ecosystem. It is intentionally short — formal text rather than tutorial. For application, see junior.md through professional.md.

---

## Go Standard Library — `net/http`

### `Server.Shutdown(ctx context.Context) error`

From the official `net/http` documentation:

> Shutdown gracefully shuts down the server without interrupting any active connections. Shutdown works by first closing all open listeners, then closing all idle connections, and then waiting indefinitely for connections to return to idle and then shut down. If the provided context expires before the shutdown is complete, Shutdown returns the context's error, otherwise it returns any error returned from closing the Server's underlying Listener(s).

> When Shutdown is called, Serve, ListenAndServe, and ListenAndServeTLS immediately return ErrServerClosed. Make sure the program doesn't exit and waits instead for Shutdown to return.

Key implementation details (from `src/net/http/server.go`):

- `Shutdown` sets `srv.inShutdown` atomically to true.
- Calls `srv.closeListenersLocked()`.
- Calls `srv.closeIdleConns()` in a loop with a polling ticker (~500ms).
- Returns when `srv.numListeners` reaches zero and all connections are closed, or when `ctx.Done()` fires.

### `Server.RegisterOnShutdown(f func())`

> RegisterOnShutdown registers a function to call on Shutdown. This can be used to gracefully shutdown connections that have undergone ALPN protocol upgrade or that have been hijacked.

Registered functions run concurrently with the shutdown logic, not before or after.

### `Server.Close() error`

> Close immediately closes all active net.Listeners and any connections in state StateNew, StateActive, or StateIdle. For a graceful shutdown, use Shutdown.

`Close` is the hard-stop counterpart to `Shutdown`. Use only when you cannot wait.

### `http.ErrServerClosed`

Sentinel error returned by `Serve`, `ListenAndServe`, and `ListenAndServeTLS` after `Shutdown` or `Close` has been called.

---

## Go Standard Library — `os/signal`

### `signal.Notify(c chan<- os.Signal, sig ...os.Signal)`

> Notify causes package signal to relay incoming signals to c. If no signals are provided, all incoming signals will be relayed to c. Otherwise, just the provided signals will.

> Package signal will not block sending to c: the caller must ensure that c has sufficient buffer space to keep up with the expected signal rate.

The recommended pattern is a channel buffered to at least 1.

### `signal.NotifyContext(parent context.Context, signals ...os.Signal) (context.Context, context.CancelFunc)`

Available since Go 1.16. From the documentation:

> NotifyContext returns a copy of the parent context that is marked done (its Done channel is closed) when one of the listed signals arrives, when the returned stop function is called, or when the parent context's Done channel is closed, whichever happens first.

> The stop function unregisters the signal behavior, which, like signal.Reset, may restore the default behavior for a given signal.

This is the recommended idiom for "convert signal to context."

### `signal.Stop(c chan<- os.Signal)`

Removes channel from receiving any further signals.

---

## Go Standard Library — `context`

### `context.WithCancel(parent Context) (ctx Context, cancel CancelFunc)`

> WithCancel returns a copy of parent with a new Done channel. The returned context's Done channel is closed when the returned cancel function is called or when the parent context's Done channel is closed, whichever happens first.

> Canceling this context releases resources associated with it, so code should call cancel as soon as the operations running in this Context complete.

### `context.WithTimeout(parent Context, timeout time.Duration) (Context, CancelFunc)`

> WithTimeout returns WithDeadline(parent, time.Now().Add(timeout)).

> Canceling this context releases resources associated with it, so code should call cancel as soon as the operations running in this Context complete.

For drain, `WithTimeout(context.Background(), drainBudget)` is standard.

### `context.WithDeadline(parent Context, d time.Time) (Context, CancelFunc)`

Like `WithTimeout` but with absolute time.

### Context errors

- `context.Canceled` — cancel was called.
- `context.DeadlineExceeded` — deadline passed.

`errors.Is(err, context.DeadlineExceeded)` is the canonical drain timeout check.

---

## Go Standard Library — `sync`

### `sync.WaitGroup`

> A WaitGroup waits for a collection of goroutines to finish. The main goroutine calls Add to set the number of goroutines to wait for. Then each of the goroutines runs and calls Done when finished. At the same time, Wait can be used to block until all goroutines have finished.

> Note that calls with a positive delta that occur when the counter is zero must happen before a Wait. Calls with a positive delta, or calls with a negative delta that start when the counter is greater than zero, may happen at any time.

For drain, pair `wg.Add(1)` with `defer wg.Done()`. `wg.Wait()` must be bounded by a deadline.

### `sync.Once`

> Once is an object that will perform exactly one action.

Useful for idempotent `Drain` methods.

### `sync.Mutex`

Standard mutex. For drain, used to gate the close-channel operation against concurrent submits.

### `sync/atomic`

Used for the `draining` flag and in-flight counter. `atomic.Bool` (Go 1.19+) is the modern type.

---

## Go Extended Library — `errgroup`

From `golang.org/x/sync/errgroup`:

> Package errgroup provides synchronization, error propagation, and Context cancellation for groups of goroutines working on subtasks of a common task.

### `errgroup.WithContext(ctx context.Context) (*Group, context.Context)`

> WithContext returns a new Group and an associated Context derived from ctx. The derived Context is canceled the first time a function passed to Go returns a non-nil error or the first time Wait returns, whichever occurs first.

### `(*Group).Go(f func() error)`

> Go calls the given function in a new goroutine. It blocks until the new goroutine can be added without the number of active goroutines in the group exceeding the configured limit. The first call to return a non-nil error cancels the group's context, if the group was created by calling WithContext. The error will be returned by Wait.

### `(*Group).Wait() error`

> Wait blocks until all function calls from the Go method have returned, then returns the first non-nil error (if any) from them.

---

## gRPC — `Server.GracefulStop`

From `google.golang.org/grpc`:

> GracefulStop stops the gRPC server. It stops the server from accepting new connections and RPCs and blocks until all the pending RPCs are finished.

`Stop` is the hard counterpart:

> Stop stops the gRPC server. It immediately closes all open connections and listeners. It cancels all active RPCs on the server side and the corresponding pending RPCs on the client side will get notified by connection errors.

`GracefulStop` does not take a context. To bound it:

```go
done := make(chan struct{})
go func() { srv.GracefulStop(); close(done) }()
select {
case <-done:
case <-ctx.Done():
	srv.Stop()
	<-done
}
```

---

## Kafka Rebalance Protocol

Apache Kafka rebalance protocol (KIP-429 for cooperative incremental rebalance):

- Eager rebalance: all consumers stop, give up all partitions, receive new assignments.
- Cooperative rebalance: only partitions being moved stop; others continue.

Consumer hooks (across libraries):

- `onPartitionsRevoked(partitions)` — called before partitions are revoked.
- `onPartitionsAssigned(partitions)` — called after partitions are assigned.
- `onPartitionsLost(partitions)` — called for abruptly lost partitions.

`onPartitionsRevoked` is the drain hook for that partition's in-flight work.

Configuration:

- `session.timeout.ms` — coordinator declares consumer dead after this period.
- `heartbeat.interval.ms` — how often consumer heartbeats.
- `max.poll.interval.ms` — max time between `poll()` calls.

Drain budget must be less than `session.timeout.ms`.

---

## Kubernetes — Pod Lifecycle

From the Kubernetes documentation on pod termination:

> When the API server receives a request to terminate a Pod, the pod is set to the "Terminating" state. The kubelet sees this and starts the shutdown process.

> The kubelet sends `SIGTERM` to the main process inside each container. The containers have time equal to the pod's `terminationGracePeriodSeconds` (default 30) to shut down. After this period, the kubelet sends `SIGKILL`.

### `terminationGracePeriodSeconds`

Pod spec field. Default 30. Maximum (practical) is bound by the worker node's kubelet config.

### `preStop` Lifecycle Hook

> PreStop hooks are useful when your application gracefully shuts itself down upon receiving `SIGTERM`. A common pattern is to use a `preStop` hook to perform some action that should happen before sending `SIGTERM`, such as flipping a readiness flag.

PreStop runs before `SIGTERM` is sent. The grace period includes both preStop and SIGTERM phases.

### `PodDisruptionBudget`

Limits the number of pods that can be voluntarily disrupted simultaneously. Useful for ensuring drain does not exceed cluster capacity tolerance.

---

## Operating System Signals

POSIX signals relevant to drain:

- `SIGTERM` (15) — request termination. Handlers can catch and drain. **The primary drain trigger.**
- `SIGINT` (2) — keyboard interrupt (Ctrl+C). Same intent as SIGTERM for most servers.
- `SIGKILL` (9) — force kill. **Cannot be caught.**
- `SIGHUP` (1) — terminal hangup. Conventionally used for config reload.
- `SIGUSR1`, `SIGUSR2` — user-defined. Sometimes used for diagnostic dumps or graceful drain.

Go represents these as `os.Signal` values. `syscall.SIGTERM`, `os.Interrupt`, etc.

A handler does not run for `SIGKILL` or `SIGSTOP`. These are uncatchable by design.

---

## Bibliography

- The Go Programming Language Specification, Sections on `select`, `go` statements, and channel close semantics.
- The `net/http` package documentation, particularly `Server.Shutdown`.
- The `os/signal` package documentation, particularly `NotifyContext`.
- The `context` package documentation.
- The `golang.org/x/sync/errgroup` package.
- KIP-429: Cooperative Incremental Rebalance Protocol (Apache Kafka Improvement Proposal).
- Kubernetes documentation: "Pod Lifecycle" and "Termination of Pods."
- POSIX.1-2017 specification, signal handling.
- Heroku Dyno Lifecycle: the original SIGTERM-then-SIGKILL-with-30s-grace pattern that influenced cloud orchestrators.
- "Erlang/OTP Design Principles" — for the supervisor patterns adapted in Go.

---

## Recommended Defaults

Production-ready Go service defaults:

| Setting | Default | Rationale |
|---------|---------|-----------|
| Signal handling | `signal.NotifyContext(..., os.Interrupt, syscall.SIGTERM)` | Idiomatic |
| Grace period | 30 seconds | Kubernetes default |
| Drain budget | 25 seconds | Grace - 5s margin |
| Readiness propagation sleep | 2 seconds | Typical LB poll interval |
| HTTP drain timeout | 20 seconds | Within drain budget |
| Worker drain timeout | 15 seconds | Within HTTP drain |
| Producer flush timeout | 5 seconds | Quick |
| Database close timeout | 5 seconds | Quick |

Adjust per workload characteristics. These are starting points.

---

## Test Specification

Recommended test cases for any drain implementation:

1. **Drain on empty system completes within 100ms.**
2. **Drain on system with in-flight work waits for completion.**
3. **Drain honours context deadline (returns DeadlineExceeded).**
4. **Drain rejects new work submissions.**
5. **Drain is idempotent (second call is safe).**
6. **No goroutine leaks after drain completes.**
7. **Drain logs duration and outcome.**
8. **Drain emits required metrics.**

All tests run with `-race` to catch concurrency bugs.

---

## Conclusion

This page is the reference. The other pages are application. Together they cover the drain pattern in depth.

For specific library versions and APIs, always consult the library's own documentation; the references here are stable but may not reflect the latest minor version.

---

## Drain-Related API Summary Table

| Language/Library | Function | Returns context error on timeout |
|------------------|----------|---------------------------------|
| Go stdlib `net/http` | `Server.Shutdown(ctx)` | Yes |
| Go stdlib `os/signal` | `signal.NotifyContext` | Yes (via context) |
| gRPC Go | `Server.GracefulStop()` | No |
| sarama | `client.Close()` | No |
| franz-go | `client.Close()` | No |
| segmentio/kafka-go | `reader.Close()` | No |
| confluent-kafka-go | `consumer.Close()` | No |
| nats.go | `sub.Drain()`, `nc.Drain()` | No |
| pulsar-client-go | `consumer.Close()` | No |
| aws-sdk-go-v2 | per-client `Close` | Often yes |
| google.golang.org/cloud/pubsub | `Receive` ctx cancel | Yes (via ctx) |
| database/sql | `db.Close()` | No (blocks) |
| go-redis | `client.Close()` | No |

Use this as a reference when integrating drain across libraries. Libraries without context support need manual wrapping.

---

## Standard Drain Contract

A normalised drain contract for Go libraries should specify:

1. The function takes `context.Context` as the first parameter.
2. The function returns `error` (nil on success).
3. The function blocks until drain completes or the context expires.
4. On context expiry, the function returns `ctx.Err()`.
5. The function is safe to call exactly once.
6. After the function returns, the component is unusable.

Libraries that follow this contract compose well. Those that do not need adapters.

---

## Reference Implementations

### Reference: Drainable Worker Pool

```go
type Pool struct {
	queue    chan Job
	wg       sync.WaitGroup
	closed   atomic.Bool
	mu       sync.Mutex
}

func NewPool(buf int) *Pool {
	return &Pool{queue: make(chan Job, buf)}
}

func (p *Pool) Start(ctx context.Context, n int) {
	for i := 0; i < n; i++ {
		p.wg.Add(1)
		go func() {
			defer p.wg.Done()
			for {
				select {
				case <-ctx.Done():
					return
				case j, ok := <-p.queue:
					if !ok {
						return
					}
					_ = process(ctx, j)
				}
			}
		}()
	}
}

func (p *Pool) Submit(j Job) error {
	if p.closed.Load() {
		return errors.New("pool closed")
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed.Load() {
		return errors.New("pool closed")
	}
	p.queue <- j
	return nil
}

func (p *Pool) Drain(ctx context.Context) error {
	p.mu.Lock()
	if p.closed.CompareAndSwap(false, true) {
		close(p.queue)
	}
	p.mu.Unlock()
	done := make(chan struct{})
	go func() { p.wg.Wait(); close(done) }()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
```

### Reference: Top-Level main with drain

```go
func main() {
	ctx, cancel := signal.NotifyContext(context.Background(),
		os.Interrupt, syscall.SIGTERM)
	defer cancel()

	pool := NewPool(64)
	pool.Start(ctx, 4)

	srv := &http.Server{Addr: ":8080", Handler: handler(pool)}
	go func() {
		_ = srv.ListenAndServe()
	}()

	<-ctx.Done()

	drainCtx, drainCancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer drainCancel()

	_ = srv.Shutdown(drainCtx)
	_ = pool.Drain(drainCtx)
}
```

### Reference: Drain test

```go
func TestPoolDrain(t *testing.T) {
	p := NewPool(8)
	p.Start(context.Background(), 2)

	for i := 0; i < 10; i++ {
		require.NoError(t, p.Submit(Job{ID: i}))
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	require.NoError(t, p.Drain(ctx))

	require.Error(t, p.Submit(Job{}))
}
```

---

## Glossary For The Specification

| Term | Meaning |
|------|---------|
| Drain | Stop accepting new work; wait for in-flight to complete; close resources. |
| Hard stop | Immediate termination without drain. |
| Grace period | Time given by orchestrator between SIGTERM and SIGKILL. |
| Drain budget | Time allocated for drain within the grace period. |
| In-flight | Work that has been accepted but not yet completed. |
| Quiesce | Pre-drain hint phase; bias system toward completion. |
| Readiness flip | Marking the service as not-ready for new traffic. |
| Propagation sleep | Wait for load balancer to notice readiness change. |
| Force-cancel | Abort in-flight work when deadline expires. |
| Idempotent drain | Drain that is safe to call multiple times. |
| Drainable | Interface or contract for components that support drain. |
| Lifecycle | Orchestration of start and drain across components. |
| Supervisor | Goroutine coordinator (often based on errgroup). |
| Cooperative rebalance | Kafka rebalance that does not pause all consumers. |
| Eager rebalance | Kafka rebalance where all consumers pause and re-receive. |
| Exactly-once semantics (EOS) | Kafka feature combining idempotent producer + transactional commits. |
| Static membership | Kafka group membership that persists across consumer restarts. |
| GOAWAY | HTTP/2 frame indicating no new streams; existing streams may finish. |

---

## A Note On Versions

This specification reflects:

- Go 1.22+ (current at the time of writing).
- Kubernetes 1.28+.
- Kafka 3.5+ with cooperative rebalance.
- gRPC-Go 1.60+.

For older versions, some APIs differ. Notably:

- Go versions before 1.16 lack `signal.NotifyContext`. Use `signal.Notify` + a goroutine.
- Go versions before 1.18 lack generics. Use interface assertions.
- Kubernetes before 1.21 has different `preStop` semantics.
- Kafka before 2.4 has only eager rebalance.

Always consult the version-specific documentation for production.

---

## References To Code

For the canonical implementation in the Go standard library, see:

- `$GOROOT/src/net/http/server.go` — `Server.Shutdown`.
- `$GOROOT/src/os/signal/signal.go` — `signal.Notify` and `NotifyContext`.
- `$GOROOT/src/context/context.go` — `WithCancel`, `WithTimeout`.

For external libraries:

- `golang.org/x/sync/errgroup/errgroup.go` — `Group` and `WithContext`.
- `google.golang.org/grpc/server.go` — `GracefulStop`.

Reading these sources is recommended for deep understanding.

---

## Conclusion

This page is the technical reference. For application of these primitives, see junior.md through professional.md. For practice, see tasks.md, find-bug.md, optimize.md.

The drain pattern is built on a small number of primitives. Mastering this short reference is part of mastering the pattern.

---

## Errata

If you find errors in this specification, or APIs have evolved, please file an issue in the Roadmap repository.

---

## Appendix: Method Signatures Cheat Sheet

```go
// net/http
func (srv *Server) Shutdown(ctx context.Context) error
func (srv *Server) Close() error
func (srv *Server) RegisterOnShutdown(f func())

// os/signal
func Notify(c chan<- os.Signal, sig ...os.Signal)
func NotifyContext(parent context.Context, signals ...os.Signal) (context.Context, context.CancelFunc)
func Stop(c chan<- os.Signal)

// context
func WithCancel(parent Context) (Context, CancelFunc)
func WithTimeout(parent Context, timeout time.Duration) (Context, CancelFunc)
func WithDeadline(parent Context, d time.Time) (Context, CancelFunc)
var Canceled error
var DeadlineExceeded error

// sync
func (wg *WaitGroup) Add(delta int)
func (wg *WaitGroup) Done()
func (wg *WaitGroup) Wait()
func (o *Once) Do(f func())
func (b *atomic.Bool) Load() bool
func (b *atomic.Bool) Store(v bool)
func (b *atomic.Bool) CompareAndSwap(old, new bool) (swapped bool)

// golang.org/x/sync/errgroup
func WithContext(ctx context.Context) (*Group, context.Context)
func (g *Group) Go(f func() error)
func (g *Group) Wait() error
func (g *Group) SetLimit(n int)

// google.golang.org/grpc
func (s *Server) GracefulStop()
func (s *Server) Stop()
```

Print and reference.

---

## Appendix: Signal Value Reference

```go
import (
	"os"
	"syscall"
)

// Catchable
os.Interrupt   // SIGINT, Ctrl+C
syscall.SIGTERM // standard polite termination
syscall.SIGHUP  // conventionally config reload
syscall.SIGUSR1 // user-defined; sometimes for graceful drain
syscall.SIGUSR2 // user-defined

// Not catchable
syscall.SIGKILL // force kill
syscall.SIGSTOP // force pause
```

Go's `os.Interrupt` is platform-independent for `SIGINT`. Other signals use `syscall`.

---

## Appendix: Common Pitfalls In The Spec

Bugs traced to misreading the spec:

1. Expecting `Server.Close` to be graceful (it is not).
2. Expecting `signal.Notify` with an unbuffered channel to never miss signals (it can).
3. Expecting `Context.Err()` to be nil after deadline expiry (it returns the error).
4. Expecting `WaitGroup` to be safe to reuse after `Wait` returns (it is, but with rules).
5. Expecting `Server.Shutdown` to wait for hijacked connections (it does not).

Read the spec carefully when in doubt.

---

## Appendix: Spec Conformance Tests

A library or service claims conformance to "the drain pattern" if it passes:

1. `Drain(ctx)` is implemented on each long-lived component.
2. `Drain` blocks until in-flight is complete or `ctx` expires.
3. `Drain` returns `ctx.Err()` on timeout.
4. After `Drain`, the component rejects new work.
5. `Drain` is safe to call exactly once.
6. No goroutines leak after `Drain`.
7. `signal.NotifyContext` is used at the top level.
8. The drain deadline is bounded.
9. Health-check endpoints reflect drain state.
10. Drain metrics are emitted.

Ten points. Use as a checklist.

---

End of specification.


