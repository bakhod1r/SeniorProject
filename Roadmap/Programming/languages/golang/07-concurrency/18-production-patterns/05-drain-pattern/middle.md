---
layout: default
title: Middle — Drain Pattern
parent: Drain Pattern
grand_parent: Production Patterns
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/18-production-patterns/05-drain-pattern/middle/
---

# Drain Pattern — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [The Three Phases In Practice](#the-three-phases-in-practice)
4. [Designing The Drainable Interface](#designing-the-drainable-interface)
5. [Idle-Wait Drains](#idle-wait-drains)
6. [Deadline-Bounded Drain Designs](#deadline-bounded-drain-designs)
7. [Drain vs Hard Stop — Decision Frame](#drain-vs-hard-stop-decision-frame)
8. [HTTP Server Drain](#http-server-drain)
9. [gRPC Drain](#grpc-drain)
10. [Worker Pool Drain](#worker-pool-drain)
11. [Queue Consumer Drain](#queue-consumer-drain)
12. [Drain With errgroup](#drain-with-errgroup)
13. [Composing Drains](#composing-drains)
14. [Testing Drain](#testing-drain)
15. [Observability For Drain](#observability-for-drain)
16. [Pitfalls At The Middle Level](#pitfalls-at-the-middle-level)
17. [Patterns That Often Help](#patterns-that-often-help)
18. [Patterns That Often Hurt](#patterns-that-often-hurt)
19. [Comparative Languages](#comparative-languages)
20. [Mid-Level Cheat Sheet](#mid-level-cheat-sheet)
21. [Self-Assessment Checklist](#self-assessment-checklist)
22. [Summary](#summary)
23. [Further Reading](#further-reading)

---

## Introduction
> Focus: "I can drain one goroutine. How do I drain a real service with HTTP, workers, queues, and downstreams — and how do I prove it works?"

At the junior level you learned the recipe: stop intake, wait for in-flight, close downstream. At the middle level you learn to apply that recipe across the whole shape of a service: an HTTP API that calls a worker pool that publishes to Kafka that writes to Postgres. Each layer has its own drain, and they must compose in the right order. You also learn to test drain — not just hope it works.

After reading this file you will:

- Design a `Drainable` interface and use it across components.
- Build idle-wait and deadline-bounded drains correctly.
- Drain HTTP, gRPC, worker pools, queue consumers.
- Compose multiple drains with proper ordering.
- Use `errgroup` to coordinate startup and shutdown of N goroutines.
- Write tests that simulate `SIGTERM` and assert clean drain.
- Emit the right metrics so production drains are observable.
- Avoid the dozen most common mid-level pitfalls.

---

## Prerequisites

- The junior page on drain.
- Comfort with `context.Context` and its propagation rules.
- Familiarity with `sync.WaitGroup`, `sync.Once`, and channels.
- Some experience with HTTP servers and at least one message-queue library (Kafka, NATS, RabbitMQ, Redis).
- Awareness of `golang.org/x/sync/errgroup`.

---

## The Three Phases In Practice

The three steps — stop intake, wait, close — generalise to phases. A typical mid-size service has:

- **Phase 0 (pre-drain).** Flip readiness. Log the start of drain.
- **Phase 1 (stop intake).** Close HTTP listener, pause queue consumer, stop scheduling new jobs.
- **Phase 2 (wait in-flight).** Block until handlers, workers, and in-flight jobs finish — bounded by deadline.
- **Phase 3 (flush).** Flush async producers (Kafka, log shippers, metrics). They have their own buffers.
- **Phase 4 (close downstream).** Close database pools, Redis clients, file handles.
- **Phase 5 (post-drain).** Log the end of drain, the duration, the count of force-cancellations.

Each phase has its own time budget. The total of all phases must fit inside the orchestrator's grace period.

### A worked sequence

```go
type Drainable interface {
	Drain(ctx context.Context) error
}

func drainAll(ctx context.Context, in []Drainable) error {
	for _, d := range in {
		if err := d.Drain(ctx); err != nil {
			return fmt.Errorf("drain %T: %w", d, err)
		}
	}
	return nil
}

// main:
order := []Drainable{httpServer, workerPool, kafkaProducer, dbPool}
if err := drainAll(drainCtx, order); err != nil {
	log.Printf("drain error: %v", err)
}
```

The slice expresses the order. Reorder by editing the slice; do not entangle drain semantics into each component.

---

## Designing The Drainable Interface

A small interface goes a long way:

```go
type Drainable interface {
	Drain(ctx context.Context) error
}
```

What it means:

- The implementer must stop accepting new work *before* returning.
- It blocks until either in-flight work is done, or `ctx` expires.
- It returns `ctx.Err()` on timeout, or another error for transient failures.
- It is safe to call exactly once. Multiple calls may panic or no-op.

A larger interface for richer cases:

```go
type StartableDrainable interface {
	Start(ctx context.Context) error
	Drain(ctx context.Context) error
}
```

`Start` is non-blocking; it spawns goroutines and returns. `Drain` is the cleanup. The lifecycle is symmetric.

### Naming conventions

- `Drain` — graceful, may take time.
- `Stop` — hard cancel, returns quickly.
- `Close` — release resources.

Some libraries combine these. Pick names that match your team's existing code, and document the semantics in the package doc comment.

### Returning errors

Drain errors fall into three buckets:

1. **Deadline-related.** `context.DeadlineExceeded`. Common; not actionable.
2. **Transient.** "Could not flush Kafka buffer." Logged; investigated.
3. **Programmer.** "Drain called before Start." Should panic.

Use `errors.Is` to dispatch on bucket 1; log buckets 2 and 3 with full context.

---

## Idle-Wait Drains

Sometimes there is no clean "drain me" signal — new work can keep arriving from internal sources even after external intake stops. An idle-wait drain handles this by declaring the system drained when it has been idle for a configurable quiet period.

```go
type IdleWaiter struct {
	inFlight atomic.Int64
	closed   atomic.Bool
}

func (w *IdleWaiter) Enter() bool {
	if w.closed.Load() {
		return false
	}
	w.inFlight.Add(1)
	return true
}

func (w *IdleWaiter) Exit() { w.inFlight.Add(-1) }

func (w *IdleWaiter) WaitIdle(ctx context.Context, quietFor time.Duration) error {
	w.closed.Store(true)
	lastBusy := time.Now()
	t := time.NewTicker(20 * time.Millisecond)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-t.C:
			if w.inFlight.Load() == 0 {
				if time.Since(lastBusy) >= quietFor {
					return nil
				}
			} else {
				lastBusy = time.Now()
			}
		}
	}
}
```

`quietFor` is the silence the system must exhibit before declaring drained. Use longer values (200ms–1s) when work can be re-enqueued internally; shorter values (50ms) when intake stops cleanly.

### When to prefer idle-wait

- Job pipelines where stages can re-emit downstream.
- Saga-like flows where a transaction is many small steps.
- Systems with timer-driven internal events.

### When to prefer wait-group

- Bounded job sets.
- Request/response flows where in-flight count is exact.

---

## Deadline-Bounded Drain Designs

A deadline-bounded drain combines a wait with `context.WithTimeout`. Two structural choices:

### Single deadline for the whole drain

```go
drainCtx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
defer cancel()
_ = httpServer.Drain(drainCtx)
_ = workerPool.Drain(drainCtx)
_ = db.Close()
```

If `httpServer.Drain` takes 24 seconds, `workerPool.Drain` has only 1 second left. This is *intentional* — the deadline is the total budget. If you want more time, raise the budget.

### Per-phase deadline

```go
phaseCtx := func(d time.Duration) (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), d)
}

httpCtx, c := phaseCtx(10 * time.Second); _ = httpServer.Drain(httpCtx); c()
poolCtx, c := phaseCtx(10 * time.Second); _ = workerPool.Drain(poolCtx); c()
```

Each phase gets its own budget. Easier to debug ("HTTP drain has its own 10 seconds; if it failed, only HTTP is to blame"). Worse for total wall-clock control.

Mix the two: a top-level deadline plus per-phase budgets derived from the same root.

```go
total, cancel := context.WithTimeout(context.Background(), 25*time.Second)
defer cancel()
httpCtx, _ := context.WithTimeout(total, 10*time.Second)
poolCtx, _ := context.WithTimeout(total, 10*time.Second)
```

If `httpCtx` is bounded by both 10s and the parent's remaining time, the tighter bound wins.

---

## Drain vs Hard Stop — Decision Frame

Not every program should drain. Use this frame to decide:

| Question | Yes → drain | No → consider hard stop |
|----------|-------------|------------------------|
| Does the program have in-flight work with side effects? | drain | hard stop ok |
| Are side effects idempotent under retry? | hard stop may be ok | drain |
| Is the orchestrator's grace period generous (≥10s)? | drain | hard stop may be needed |
| Is the program a test / CLI / one-shot? | hard stop ok | n/a |
| Is the work latency much shorter than grace period? | drain | drain |
| Are you reacting to corruption? | hard stop | hard stop |

A mature service may switch modes at runtime: drain on normal `SIGTERM`, hard stop on a "panic" signal or detected corruption.

### Hard stop done right

A "hard stop" is not unmanaged exit — it is a fast, intentional exit:

```go
log.Println("hard stop")
os.Exit(1)
```

The exit code matters. Use `0` only for clean shutdowns; `1` or specific codes for forced exits. Orchestrators alert on non-zero exit codes.

---

## HTTP Server Drain

The canonical Go HTTP drain uses `http.Server.Shutdown`:

```go
ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
defer cancel()
if err := srv.Shutdown(ctx); err != nil {
	log.Printf("http shutdown: %v", err)
}
```

What `Shutdown` does:

1. Closes all listeners (no new connections).
2. Closes all idle keep-alive connections.
3. Waits for active requests to finish.
4. Returns nil on success, `ctx.Err()` on timeout.

What `Shutdown` does *not* do:

- Notify active clients that a shutdown is in progress (they continue normally).
- Cancel hijacked or WebSocket connections (you must do that yourself).
- Wait for `Server.RegisterOnShutdown` hooks to complete (they run concurrently).

### Hijacked connections

WebSocket and SSE connections are typically hijacked. `Shutdown` does not close them. You must keep your own registry:

```go
type WS struct {
	mu    sync.Mutex
	conns map[*websocket.Conn]struct{}
}

func (w *WS) Register(c *websocket.Conn) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.conns[c] = struct{}{}
}

func (w *WS) Unregister(c *websocket.Conn) {
	w.mu.Lock()
	defer w.mu.Unlock()
	delete(w.conns, c)
}

func (w *WS) DrainAll(ctx context.Context) {
	w.mu.Lock()
	for c := range w.conns {
		_ = c.WriteControl(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseGoingAway, "server shutdown"),
			time.Now().Add(time.Second),
		)
	}
	w.mu.Unlock()
	// optional: wait for them to close
}
```

Call `DrainAll` *before* `srv.Shutdown` so clients see the close frame and the server's drain is shorter.

### Custom shutdown ordering

`http.Server.RegisterOnShutdown` lets you hook into the shutdown:

```go
srv.RegisterOnShutdown(func() {
	log.Println("server is shutting down: stop background flushes")
})
```

The hook runs concurrently with the shutdown logic. Use it for *side actions*, not as the primary drain logic.

### TLS, h2c, h3

The drain semantics are the same for TLS (`ListenAndServeTLS` + `Shutdown`) and h2c via the `h2c` package. For HTTP/3 via QUIC (e.g. `quic-go`), the library has its own `CloseGracefully` semantics — read its docs.

---

## gRPC Drain

`grpc-go` exposes `Server.GracefulStop`:

```go
done := make(chan struct{})
go func() {
	srv.GracefulStop()
	close(done)
}()

select {
case <-done:
	log.Println("grpc graceful stop complete")
case <-ctx.Done():
	srv.Stop() // hard stop
	<-done
}
```

`GracefulStop` waits for in-flight RPCs to finish. `Stop` (no graceful) cancels them. The pattern above is "graceful with deadline": try graceful, fall back to hard stop on timeout.

### Streaming RPCs

A streaming RPC may run for hours. `GracefulStop` waits for it. To bound this, propagate the drain context into stream handlers:

```go
func (s *Server) BigStream(stream pb.Service_BigStreamServer) error {
	ctx := stream.Context()
	for {
		select {
		case <-ctx.Done():
			return status.FromContextError(ctx.Err()).Err()
		case msg := <-source:
			if err := stream.Send(msg); err != nil {
				return err
			}
		}
	}
}
```

When the server starts to shut down, the stream context is cancelled, the handler returns, the stream closes.

### Multi-server

For services exposing both HTTP and gRPC, drain them concurrently:

```go
g, _ := errgroup.WithContext(ctx)
g.Go(func() error { return httpSrv.Shutdown(drainCtx) })
g.Go(func() error { grpcSrv.GracefulStop(); return nil })
_ = g.Wait()
```

The two drains run in parallel; the overall drain takes the maximum of the two, not the sum.

---

## Worker Pool Drain

A worker pool with a job channel:

```go
type Pool struct {
	jobs    chan Job
	workers int
	wg      sync.WaitGroup
	closed  atomic.Bool
	mu      sync.Mutex
}

func NewPool(workers, buf int) *Pool {
	return &Pool{jobs: make(chan Job, buf), workers: workers}
}

func (p *Pool) Start(ctx context.Context, handler func(context.Context, Job)) {
	for i := 0; i < p.workers; i++ {
		p.wg.Add(1)
		go func() {
			defer p.wg.Done()
			for {
				select {
				case <-ctx.Done():
					return
				case j, ok := <-p.jobs:
					if !ok {
						return
					}
					handler(ctx, j)
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
	p.jobs <- j
	return nil
}

func (p *Pool) Drain(ctx context.Context) error {
	p.mu.Lock()
	if p.closed.CompareAndSwap(false, true) {
		close(p.jobs)
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

Key points:

- `closed` is atomic for the fast path in `Submit`.
- `mu` guards the close; double-close is prevented with `CompareAndSwap`.
- `Drain` blocks on the wait group with a deadline.
- The handler receives the *start* context, not the *drain* context. The start context is the one cancelled when the service shuts down.

### Dynamic pool sizing

A drain that shrinks a pool sends a sentinel to N workers:

```go
type sentinelJob struct{}
func (p *Pool) Shrink(n int) {
	for i := 0; i < n; i++ {
		p.jobs <- sentinelJob{}
	}
}
```

Workers detect the sentinel and exit. The wait group reflects the new size.

---

## Queue Consumer Drain

Consumers of message queues — Kafka, NATS, RabbitMQ, Redis lists, SQS — share a pattern:

1. Stop fetching new messages.
2. Process the messages already fetched.
3. Acknowledge / commit offsets.
4. Disconnect.

The complication is offset / ack semantics. Acknowledging too early loses messages on a crash; too late causes duplicates.

### Kafka with `segmentio/kafka-go`

```go
reader := kafka.NewReader(kafka.ReaderConfig{ /* ... */ })
defer reader.Close() // important: closes connections cleanly

for {
	m, err := reader.FetchMessage(ctx)
	if err != nil {
		break
	}
	if err := process(ctx, m); err != nil {
		log.Printf("process: %v", err)
		continue
	}
	if err := reader.CommitMessages(ctx, m); err != nil {
		log.Printf("commit: %v", err)
	}
}
```

On `ctx` cancellation, `FetchMessage` returns immediately. Any uncommitted message is left for the next consumer to re-read. This is at-least-once delivery — the application must be idempotent.

For the drain, we cancel the context, let `FetchMessage` return, and let any in-flight `process` finish (because we share the *outer* context with the loop, not the inner). To improve this, separate the contexts:

```go
fetchCtx, fetchCancel := context.WithCancel(rootCtx)
processCtx := rootCtx // not cancelled during drain

for {
	m, err := reader.FetchMessage(fetchCtx)
	if err != nil {
		break
	}
	_ = process(processCtx, m)
	_ = reader.CommitMessages(processCtx, m)
}
```

On drain: `fetchCancel()` stops new fetches. The loop drains any prefetched messages (the library buffers internally), processes them, commits them, then exits cleanly.

### NATS

```go
nc, _ := nats.Connect(...)
sub, _ := nc.Subscribe(...)

// drain:
_ = sub.Drain() // stops receiving, processes pending
_ = nc.Drain()  // closes connection
```

NATS bakes the pattern into the library: `Drain()` is the right name.

### RabbitMQ

```go
ch.Cancel(consumerTag, false) // stop delivery
// process the channel of deliveries until empty
ch.Close()
```

The consumer tag identifies the subscription. Cancelling stops further deliveries; in-flight messages must still be ack'd or nack'd.

### Redis lists

```go
// poll loop:
for {
	select {
	case <-ctx.Done():
		return
	default:
		val, err := client.BLPop(ctx, time.Second, "queue").Result()
		// handle val
	}
}
```

Drain by cancelling `ctx`; the `BLPop` returns on context error. There are no offsets to commit; the message was already removed from the list.

---

## Drain With errgroup

`golang.org/x/sync/errgroup` wraps a wait group with error propagation:

```go
g, gCtx := errgroup.WithContext(rootCtx)
g.Go(func() error { return server.Run(gCtx) })
g.Go(func() error { return worker.Run(gCtx) })
g.Go(func() error { return consumer.Run(gCtx) })

if err := g.Wait(); err != nil {
	log.Printf("group: %v", err)
}
```

If any goroutine returns an error, `gCtx` is cancelled. The other goroutines see it and drain. `Wait` returns the first error.

This is the cleanest way to run multiple long-lived goroutines in a service. Pair it with `signal.NotifyContext` for the top-level:

```go
ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
defer cancel()

g, gCtx := errgroup.WithContext(ctx)
g.Go(func() error { return server.Run(gCtx) })
g.Go(func() error { return worker.Run(gCtx) })

<-gCtx.Done()
drainCtx, dcancel := context.WithTimeout(context.Background(), 25*time.Second)
defer dcancel()

_ = server.Drain(drainCtx)
_ = worker.Drain(drainCtx)
_ = g.Wait()
```

The two contexts have different roles: `gCtx` signals "stop running"; `drainCtx` bounds the drain. Keep them separate.

---

## Composing Drains

Composition often goes wrong. Three rules:

1. **Drain in the opposite order of construction.** If A depends on B, drain A before B. The reverse leaves A talking to a closed B.
2. **Each drainable manages its own subtree.** A worker pool drains its own workers; the parent service does not reach in.
3. **Pass the drain context, not a fresh one.** Components must share the deadline.

A useful pattern is a `Lifecycle` struct that owns the ordering:

```go
type Lifecycle struct {
	starters []func(context.Context) error
	drains   []func(context.Context) error
}

func (l *Lifecycle) Add(start, drain func(context.Context) error) {
	l.starters = append(l.starters, start)
	l.drains = append(l.drains, drain)
}

func (l *Lifecycle) Run(ctx context.Context) error {
	for _, s := range l.starters {
		if err := s(ctx); err != nil {
			return err
		}
	}
	return nil
}

func (l *Lifecycle) Drain(ctx context.Context) error {
	for i := len(l.drains) - 1; i >= 0; i-- {
		if err := l.drains[i](ctx); err != nil {
			log.Printf("drain step %d: %v", i, err)
		}
	}
	return nil
}
```

`Add` registers a pair; `Drain` walks them in reverse. This is the simplest dependency-aware drainer.

For more complex graphs (where A and B are siblings but C depends on both), use a DAG drainer with topological sort.

---

## Testing Drain

A drain you do not test is a drain that breaks silently. Test these properties:

### 1. Drain completes within budget on empty system

```go
func TestDrainEmptyFast(t *testing.T) {
	svc := New()
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	if err := svc.Drain(ctx); err != nil {
		t.Fatalf("expected nil, got %v", err)
	}
}
```

### 2. Drain waits for in-flight

```go
func TestDrainWaitsForInFlight(t *testing.T) {
	svc := New()
	ctx := context.Background()
	svc.Start(ctx, 1)
	done := make(chan struct{})
	svc.Submit(func() {
		time.Sleep(50 * time.Millisecond)
		close(done)
	})
	dctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	_ = svc.Drain(dctx)
	select {
	case <-done:
	default:
		t.Fatal("in-flight job did not complete")
	}
}
```

### 3. Drain honours deadline

```go
func TestDrainHonoursDeadline(t *testing.T) {
	svc := New()
	ctx := context.Background()
	svc.Start(ctx, 1)
	svc.Submit(func() { time.Sleep(time.Hour) }) // hung
	dctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	err := svc.Drain(dctx)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("expected deadline exceeded, got %v", err)
	}
}
```

### 4. Drain rejects new submissions

```go
func TestDrainRejectsSubmissions(t *testing.T) {
	svc := New()
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	go svc.Drain(ctx)
	time.Sleep(10 * time.Millisecond)
	if err := svc.Submit(func(){}); err == nil {
		t.Fatal("expected error on submit after drain")
	}
}
```

### 5. Drain is idempotent

```go
func TestDrainIdempotent(t *testing.T) {
	svc := New()
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	_ = svc.Drain(ctx)
	if err := svc.Drain(ctx); err != nil {
		t.Fatalf("second drain: %v", err)
	}
}
```

### 6. No goroutine leaks

Use `go.uber.org/goleak` or count manually:

```go
func TestNoLeaksAfterDrain(t *testing.T) {
	before := runtime.NumGoroutine()
	svc := New()
	ctx := context.Background()
	svc.Start(ctx, 4)
	dctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	_ = svc.Drain(dctx)
	time.Sleep(50 * time.Millisecond) // let goroutines fully exit
	if after := runtime.NumGoroutine(); after > before {
		t.Errorf("leak: before=%d after=%d", before, after)
	}
}
```

Always run drain tests with `-race`. Race detector catches more drain bugs than any other testing strategy.

---

## Observability For Drain

Three categories of telemetry:

### Metrics

- `drain_duration_seconds{component}` (histogram).
- `drain_in_flight_at_start{component}` (gauge / summary).
- `drain_force_cancelled_total{component}` (counter).
- `drain_calls_total{result=success|deadline|error}` (counter).

### Logs

Structured logs with the component name, start time, duration, error:

```go
log.With(
	"component", "worker_pool",
	"in_flight_start", n,
	"duration_ms", time.Since(start).Milliseconds(),
).Info("drain complete")
```

### Traces

Each drain phase as a span. A drain trace looks like a Gantt chart of stages.

```go
ctx, span := tracer.Start(ctx, "drain.http")
defer span.End()
```

Set span attributes for `in_flight_start` and the result. A failed drain shows up red in the trace UI.

---

## Pitfalls At The Middle Level

### Forgetting to close the inbound channel

A worker pool whose `Drain` does not close `p.jobs` blocks forever waiting on `range p.jobs`. Always close the channel.

### Closing the channel from the wrong goroutine

If two goroutines both close the channel, the second panics. Use `sync.Once` or `atomic.CompareAndSwap` to guarantee single close.

### Mixing intake context with drain context

If you derive the drain context from the cancelled root context, the drain has zero time.

```go
// wrong
drainCtx := context.WithTimeout(rootCtx, 25*time.Second)
```

Once `rootCtx` is cancelled, `drainCtx` is also cancelled — the timeout is moot.

```go
// right
drainCtx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
```

### Drain without health-check flip

The LB keeps sending traffic to a draining pod. Drain stays busy with new work. The deadline expires before in-flight reaches zero. Always flip readiness first.

### Stopping the HTTP server before workers

If workers receive jobs via HTTP, stopping the HTTP server is fine first — but workers handling background jobs (cron-like) should drain first if HTTP responses depend on them.

### Not bounding sub-drains

A top-level drain budget of 25s with a sub-drain of `context.Background()` (no timeout) means a single hung sub-component can block forever. Always derive sub-contexts from the drain context.

### Async producers without `Flush`

A Kafka producer that buffers writes must `Flush` during drain. Otherwise messages in the buffer are lost.

```go
defer producer.Close()
if err := producer.Flush(drainCtx); err != nil {
	log.Printf("flush: %v", err)
}
```

### Closing the database before workers exit

Workers holding connections panic on use after close. Drain workers first.

### Drain on a `nil` channel

Closing a nil channel panics. Defensive coding:

```go
if p.jobs != nil {
	close(p.jobs)
}
```

But better: initialise it in the constructor.

### Drain that does not propagate cancellation

A drain that closes a channel but does not cancel the context leaves workers stuck on long sleeps. Combine both signals.

---

## Patterns That Often Help

### Functional options

```go
func WithDrainDeadline(d time.Duration) Option {
	return func(s *Server) { s.drainDeadline = d }
}
```

Per-environment drain budgets. Production gets 25s; tests get 100ms.

### `chan struct{}` for signalling

A done channel is cheaper than a wait group when you only need "wait until x":

```go
done := make(chan struct{})
go func() {
	work()
	close(done)
}()
<-done
```

### `sync.Once` for single-shot drain

```go
type Server struct {
	once sync.Once
}

func (s *Server) Drain(ctx context.Context) error {
	var err error
	s.once.Do(func() { err = s.drain(ctx) })
	return err
}
```

Idempotent drain: callable from any number of places.

### Drain hooks

```go
type Server struct {
	beforeDrain []func()
	afterDrain  []func()
}

func (s *Server) OnBeforeDrain(f func()) { s.beforeDrain = append(s.beforeDrain, f) }
```

Lets components register clean-up that runs at the right moment.

---

## Patterns That Often Hurt

- **Drain inside a handler.** A handler calling `srv.Shutdown` deadlocks (the handler is holding the WaitGroup that Shutdown is waiting on).
- **Goroutines that never exit.** A `for { ... }` with no context check leaks past drain.
- **Calls to `os.Exit` from goroutines.** Skips drain entirely.
- **A `defer wg.Wait()` in `main`.** If `Wait` blocks forever, `main` never returns.
- **Long `time.Sleep` instead of `select` with `<-ctx.Done`.** Goroutine cannot drain on schedule.

---

## Comparative Languages

| Stack | Drain primitive | Notes |
|-------|-----------------|-------|
| Go `net/http` | `Server.Shutdown(ctx)` | Bounded by context. |
| Go gRPC | `Server.GracefulStop()` | No context; manual deadline. |
| Java | `ExecutorService.shutdown` + `awaitTermination` | Two-step. |
| Node.js | `server.close(cb)` | Single callback. |
| Python `asyncio` | `Server.close()` + `wait_closed()` | Coroutine-friendly. |
| Erlang | `gen_server` shutdown spec | First-class. |

The conceptual model is universal; only the API surface differs.

---

## Mid-Level Cheat Sheet

```text
1. Define Drainable interface; implement it on every long-lived component.
2. signal.NotifyContext at the top; errgroup for parallel run.
3. Per-component Drain(ctx) with deadline propagation.
4. Order drains by dependency: outer first, inner last.
5. Test drain with empty, in-flight, hung, and double-call cases.
6. Emit drain metrics; alert on force-cancellations.
```

```go
type Drainable interface{ Drain(context.Context) error }

func Run(ctx context.Context, ds ...Drainable) error {
	<-ctx.Done()
	dctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	for i := len(ds) - 1; i >= 0; i-- {
		if err := ds[i].Drain(dctx); err != nil {
			log.Printf("drain %T: %v", ds[i], err)
		}
	}
	return nil
}
```

---

## Self-Assessment Checklist

- [ ] I can design a `Drainable` interface and apply it across components.
- [ ] I know when to use `errgroup` and how to wire it to a signal context.
- [ ] I can drain HTTP, gRPC, worker pool, and queue consumer.
- [ ] I can choose between idle-wait and wait-group based drains.
- [ ] I can express drain order via a `Lifecycle` registry.
- [ ] I can write five different kinds of drain test.
- [ ] I emit drain metrics and alert on force-cancellations.
- [ ] I avoid the dozen pitfalls listed above.

---

## Summary

The middle level of drain is about *composition*. One drain is easy. Five drains in the right order with shared deadline and metrics — that takes real care. The patterns in this file (`Drainable`, `Lifecycle`, `errgroup`, per-phase context) are the building blocks of every well-shut-down Go service. Master them and you can write systems that deploy four times a day with zero downtime.

---

## Further Reading

- The `net/http` package source for `Server.Shutdown` internals.
- The `grpc-go` source for `GracefulStop`.
- The `golang.org/x/sync/errgroup` documentation.
- Kubernetes documentation on `terminationGracePeriodSeconds` and `preStop` hooks.
- The `segmentio/kafka-go` `Reader` and `Writer` documentation, especially `Close` semantics.

---

## Extended Example: A Full Mid-Sized Service

Below is a complete mid-sized service that exercises every concept in this file. It is roughly the shape of a real microservice: HTTP for synchronous requests, a worker pool for async jobs, a Kafka producer for events, a Postgres connection.

```go
package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"golang.org/x/sync/errgroup"
	_ "github.com/lib/pq"
)

type Producer interface {
	Send(ctx context.Context, key string, value []byte) error
	Flush(ctx context.Context) error
	Close() error
}

type FakeProducer struct {
	buf   chan []byte
	wg    sync.WaitGroup
	closed atomic.Bool
}

func NewFakeProducer() *FakeProducer {
	p := &FakeProducer{buf: make(chan []byte, 1024)}
	p.wg.Add(1)
	go p.run()
	return p
}

func (p *FakeProducer) run() {
	defer p.wg.Done()
	for v := range p.buf {
		time.Sleep(5 * time.Millisecond)
		_ = v
	}
}

func (p *FakeProducer) Send(ctx context.Context, key string, value []byte) error {
	if p.closed.Load() {
		return errors.New("producer closed")
	}
	select {
	case p.buf <- value:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (p *FakeProducer) Flush(ctx context.Context) error {
	for len(p.buf) > 0 {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(10 * time.Millisecond):
		}
	}
	return nil
}

func (p *FakeProducer) Close() error {
	if p.closed.CompareAndSwap(false, true) {
		close(p.buf)
	}
	p.wg.Wait()
	return nil
}

type Job struct{ ID int }

type Pool struct {
	jobs    chan Job
	wg      sync.WaitGroup
	closed  atomic.Bool
	mu      sync.Mutex
	prod    Producer
}

func NewPool(prod Producer, buf int) *Pool {
	return &Pool{jobs: make(chan Job, buf), prod: prod}
}

func (p *Pool) Start(ctx context.Context, n int) {
	for i := 0; i < n; i++ {
		p.wg.Add(1)
		go p.run(ctx, i)
	}
}

func (p *Pool) run(ctx context.Context, id int) {
	defer p.wg.Done()
	for {
		select {
		case <-ctx.Done():
			return
		case j, ok := <-p.jobs:
			if !ok {
				return
			}
			_ = p.prod.Send(ctx, fmt.Sprintf("job-%d", j.ID), []byte("done"))
		}
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
	p.jobs <- j
	return nil
}

func (p *Pool) Drain(ctx context.Context) error {
	p.mu.Lock()
	if p.closed.CompareAndSwap(false, true) {
		close(p.jobs)
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

type App struct {
	pool     *Pool
	prod     Producer
	db       *sql.DB
	draining atomic.Bool
}

func (a *App) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/ready", func(w http.ResponseWriter, r *http.Request) {
		if a.draining.Load() {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
	})
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	mux.HandleFunc("/enqueue", func(w http.ResponseWriter, r *http.Request) {
		if a.draining.Load() {
			http.Error(w, "draining", http.StatusServiceUnavailable)
			return
		}
		_ = a.pool.Submit(Job{ID: int(time.Now().Unix())})
		fmt.Fprintln(w, "enqueued")
	})
	return mux
}

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	prod := NewFakeProducer()
	pool := NewPool(prod, 64)
	app := &App{pool: pool, prod: prod}

	pool.Start(ctx, 4)

	srv := &http.Server{Addr: ":8080", Handler: app.Handler()}
	g, _ := errgroup.WithContext(ctx)
	g.Go(func() error {
		err := srv.ListenAndServe()
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	})

	<-ctx.Done()
	log.Println("drain: start")
	start := time.Now()

	app.draining.Store(true)
	time.Sleep(2 * time.Second)

	dctx, dcancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer dcancel()

	if err := srv.Shutdown(dctx); err != nil {
		log.Printf("http: %v", err)
	}
	if err := pool.Drain(dctx); err != nil {
		log.Printf("pool: %v", err)
	}
	if err := prod.Flush(dctx); err != nil {
		log.Printf("flush: %v", err)
	}
	if err := prod.Close(); err != nil {
		log.Printf("prod close: %v", err)
	}
	_ = g.Wait()
	log.Printf("drain: complete in %s", time.Since(start))
}
```

Pay attention to the order in the drain block: HTTP first (no new requests), then pool (workers exit before producer is closed), then producer flush, then producer close. The wait at the end (`g.Wait`) catches any straggler error from the listener.

This template scales from "internal hackathon project" to "core production service" with only minor changes (real Kafka client, real Postgres, real metrics). The skeleton is correct.

---

## Appendix A: Designing a Drain-Aware Library

If you publish a Go library that owns goroutines (a queue client, a metrics shipper, a websocket gateway), bake in drain from the start. A clean drain-aware library API looks like:

```go
// Run starts the library's goroutines. Blocks until ctx is cancelled or
// an unrecoverable error occurs. Returns nil on graceful shutdown.
func (c *Client) Run(ctx context.Context) error

// Drain waits for in-flight operations to complete, bounded by ctx.
// Safe to call exactly once. After Drain returns, no further Run or
// Drain calls succeed.
func (c *Client) Drain(ctx context.Context) error
```

Document both functions thoroughly. State explicitly:

- The thread-safety of each method.
- Whether `Drain` is required after `Run` returns.
- What happens if `Drain` deadline is exceeded.
- Whether the library has its own internal deadlines beyond `ctx`.

Libraries that lie about drain ("call `Close()` and we'll figure it out") are the source of countless production incidents. Be precise.

### Anti-example: a library that does not expose drain

```go
type BadClient struct{ /* ... */ }
func NewBadClient() *BadClient { /* spawns goroutines internally */ }
func (b *BadClient) Stop() { /* unspecified what happens */ }
```

`Stop` is ambiguous: is it cooperative? Is it forced? Does it wait? No way to bound it. No way to detect a stuck shutdown. The library is unusable in production.

### Better example

```go
type GoodClient struct{ /* ... */ }
func NewGoodClient(opts ...Option) *GoodClient { /* no goroutines yet */ }
func (g *GoodClient) Start(ctx context.Context) error { /* spawns */ }
func (g *GoodClient) Drain(ctx context.Context) error { /* waits */ }
```

Two distinct lifecycle hooks. Both take context. Both have documented semantics. Caller is in control.

---

## Appendix B: Drain Phases in Detail

Let's expand the phase model from earlier into a detailed reference.

### Phase 0 — Pre-drain

This phase is *optional but valuable*. Run it before any blocking work.

- Log the start of drain with a timestamp and current in-flight counters.
- Emit a `drain_started_total` metric.
- Set a tracing span attribute so logs and traces correlate.
- Optionally, send an "I am shutting down" event to a control plane.

```go
func (s *Server) preDrain() {
	s.logger.Info("drain started",
		"in_flight", s.inflight.Load(),
		"workers", s.workers,
	)
	metrics.DrainStarted.Inc()
}
```

### Phase 1 — Stop intake

This phase flips the gate. After it returns, no new work enters the system.

- Set the `draining` flag.
- Wait for the readiness probe propagation window.
- Close the HTTP listener (or pause the queue consumer).

The wait for readiness is the most commonly skipped step. Without it, the LB keeps routing requests during drain and you cannot reach steady-state in-flight count of zero.

### Phase 2 — Wait in-flight

This phase blocks until the system is idle.

- Wait on the in-flight WaitGroup or the in-flight counter.
- Bounded by the drain context's deadline.
- Return `context.DeadlineExceeded` if the deadline fires.

Most drain bugs hide here. Either the wait is unbounded, or the in-flight count is wrong (someone forgot a `Done`), or there is a goroutine that does not honour the context.

### Phase 3 — Flush

Async producers and write-behind caches have internal buffers. This phase asks them to flush.

- Kafka producer flush.
- Metrics flush.
- Log shipper flush.

Each has its own deadline. Stack them inside the drain budget; if one runs over, the next gets less time. Track this with a "budget remaining" helper:

```go
func remaining(ctx context.Context) time.Duration {
	d, ok := ctx.Deadline()
	if !ok {
		return time.Hour // pretend infinite
	}
	r := time.Until(d)
	if r < 0 {
		return 0
	}
	return r
}
```

Log the remaining budget at each phase boundary. It is gold during incident review.

### Phase 4 — Close downstream

This is the last phase. Closing here is safe because nothing else is using the resources.

- Database connection pool close.
- Redis client close.
- File handles.
- OpenTelemetry exporters.

Order matters: drain consumers of the database before closing the database, drain Kafka producers before closing Kafka connections, etc.

### Phase 5 — Post-drain

Optional cleanup before exit.

- Final flush of structured logs.
- Emit `drain_complete_total` metric.
- Return from `main` (which exits the process).

```go
defer func() {
	log.Sync()
	log.Info("drain complete", "duration_ms", elapsed.Milliseconds())
}()
```

`log.Sync` flushes any buffered logs (some loggers buffer for performance).

---

## Appendix C: A Tour of Mid-Level Anti-Patterns

### Anti-pattern: `done := make(chan bool)`

A `chan bool` for signalling is a code smell. The value never carries information. Use `chan struct{}`:

```go
done := make(chan struct{})
close(done) // signal
<-done       // wait
```

`struct{}` is zero-size; the compiler optimises better.

### Anti-pattern: Blocking on a context outside a select

```go
<-ctx.Done() // fine at the top of a function
```

This is OK. But inside a loop with other channels, always `select`:

```go
select {
case <-ctx.Done():
	return
case j := <-jobs:
	process(j)
}
```

A bare `<-ctx.Done()` inside a loop is an unconditional exit point.

### Anti-pattern: `time.Sleep(d)` to wait for drain

```go
time.Sleep(5 * time.Second)
```

This does not wait for drain; it just adds latency. The system may have drained in 200ms, or still be working after 5s. Use `WaitGroup.Wait` with a deadline.

### Anti-pattern: A drain that calls `panic` on error

```go
func (s *Server) Drain(ctx context.Context) {
	if err := s.cleanup(); err != nil {
		panic(err)
	}
}
```

Panic in drain leaves the process in an undefined state. Return errors. Log them. Continue draining the rest. The principle: drain is best-effort; one component's failure should not stop the others from cleaning up.

### Anti-pattern: Drain that holds a global lock

A drain that takes a global mutex used in the hot path will serialise the world. Acquire fine-grained locks; release them quickly.

### Anti-pattern: Drain that re-derives signal handling

```go
func (s *Server) Drain(ctx context.Context) error {
	signal.Notify(...) // wrong
}
```

Signal handling belongs at the top level. Components consume contexts; they do not catch signals.

---

## Appendix D: Drain and Streaming

Drain interacts badly with streams that have no natural end. Three strategies:

### Strategy 1: Send a poison pill

A sentinel message tells the consumer "no more after this." The consumer processes the pill and exits.

```go
const poison = "__END__"

go func() {
	for msg := range stream {
		if msg == poison {
			return
		}
		handle(msg)
	}
}()

// drain:
stream <- poison
```

Works for one consumer. For N, send N pills.

### Strategy 2: Close the source channel

If the source supports it, closing terminates the `range` loop:

```go
close(stream)
```

Cleaner but requires the closer to own the channel. Multiple producers complicate this.

### Strategy 3: Context cancellation

If the consumer is selecting on the channel and a context:

```go
for {
	select {
	case msg := <-stream:
		handle(msg)
	case <-ctx.Done():
		return
	}
}
```

Cancellation terminates without modifying the channel. Best when the channel might still receive values from other senders.

In production, often a combination: cancel the context, drain remaining items from the channel for a bounded time, then return.

```go
cancel()
deadline := time.After(2 * time.Second)
for {
	select {
	case msg := <-stream:
		handle(msg)
	case <-deadline:
		return
	default:
		return
	}
}
```

---

## Appendix E: Drain and Backpressure

Backpressure and drain are related: both involve telling upstream to slow or stop. During drain, you want **maximum** backpressure — refuse all new work.

A drain-aware producer respects backpressure:

```go
func produce(ctx context.Context, out chan<- Job) {
	for i := 0; ; i++ {
		select {
		case <-ctx.Done():
			return
		case out <- Job{ID: i}:
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(10 * time.Millisecond):
		}
	}
}
```

Two `select` blocks: one for the send, one for the pacing wait. Each is interruptible.

Without the second select, a paused producer (the `time.Sleep`) cannot drain. With it, drain is responsive.

---

## Appendix F: Drain in a Multi-Process Service

A single Go binary may spawn child processes — for sandbox, plugin, or scaling reasons. Drain across process boundaries is harder.

### Forward signals to children

```go
cmd := exec.Command("./worker")
cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
cmd.Start()

// on parent drain:
_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM)
cmd.Wait()
```

`Setpgid` puts the child in its own process group; the negative PID sends the signal to the whole group.

### Use a pipe for explicit drain message

Some services prefer in-band shutdown over signals. Send a "drain now" message on a pipe; the child reads it and exits gracefully.

### Use a supervisor

For complex multi-process services, a supervisor (systemd, supervisord, custom) handles drain orchestration. Children only need to drain themselves on `SIGTERM`.

---

## Appendix G: Drain and Timeouts at Different Layers

A request flows through layers: client → LB → server → handler → worker → database. Each layer has its own timeout:

- Client: HTTP client timeout (e.g. 30s).
- LB: idle and request timeouts.
- Server: read/write/idle timeouts.
- Handler: context deadline.
- Worker: per-job deadline.
- Database: statement timeout.

During drain, the server's drain deadline interacts with all of these. A request that arrived 25 seconds before drain may have a remaining client timeout of 5s — finishing it before the drain deadline is comfortable. A request that arrived 1 second before drain has 29s — but the drain deadline is 25s, so it will be cut off.

The takeaway: **drain deadline should be longer than typical request handling time, but shorter than the orchestrator grace period**. The window is usually 20–30 seconds.

---

## Appendix H: Verifying Drain Under Load

Drain works on quiet test systems. Drain under load is where the patterns break.

### Method 1: Synthetic load with `vegeta`

```bash
echo "GET http://localhost:8080/work" | vegeta attack -rate=500 -duration=60s | tee result.bin &
PID=$!
sleep 20
kill -TERM $PID_OF_GO_SERVICE
wait $PID
vegeta report < result.bin
```

Observe the report for 5xx errors. A clean drain has zero.

### Method 2: Inject a slow handler

Add a `/slow` endpoint that takes 10s. Send a few requests. Trigger drain at second 2. Verify the requests complete with 200, not 5xx.

### Method 3: Goroutine count tracking

```go
before := runtime.NumGoroutine()
// run service for 1 minute under load
// drain
time.Sleep(100 * time.Millisecond)
after := runtime.NumGoroutine()
require.LessOrEqual(t, after, before+2)
```

Allow a couple of leaked goroutines for the test harness itself.

### Method 4: pprof during drain

Take a goroutine pprof at the start of drain and at the end. Diff them. Any goroutine present in both is suspect.

---

## Appendix I: Real-World Mid-Sized Patterns

### Pattern: drainable HTTP middleware

```go
type DrainMiddleware struct {
	draining atomic.Bool
	wg       sync.WaitGroup
}

func (d *DrainMiddleware) Wrap(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if d.draining.Load() {
			http.Error(w, "draining", http.StatusServiceUnavailable)
			return
		}
		d.wg.Add(1)
		defer d.wg.Done()
		next.ServeHTTP(w, r)
	})
}

func (d *DrainMiddleware) Drain(ctx context.Context) error {
	d.draining.Store(true)
	done := make(chan struct{})
	go func() { d.wg.Wait(); close(done) }()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
```

Wrap your handler tree with this. The middleware tracks in-flight HTTP requests independently of `Server.Shutdown`, useful when you have non-HTTP background goroutines that should not block HTTP drain.

### Pattern: drainable scheduled jobs

```go
type Scheduler struct {
	ticker   *time.Ticker
	stop     chan struct{}
	wg       sync.WaitGroup
	draining atomic.Bool
}

func New(interval time.Duration) *Scheduler {
	return &Scheduler{ticker: time.NewTicker(interval), stop: make(chan struct{})}
}

func (s *Scheduler) Start(job func(context.Context), ctx context.Context) {
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		for {
			select {
			case <-s.stop:
				return
			case <-ctx.Done():
				return
			case <-s.ticker.C:
				if s.draining.Load() {
					return
				}
				job(ctx)
			}
		}
	}()
}

func (s *Scheduler) Drain(ctx context.Context) error {
	s.draining.Store(true)
	close(s.stop)
	s.ticker.Stop()
	done := make(chan struct{})
	go func() { s.wg.Wait(); close(done) }()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
```

A cron-like scheduler that stops ticking and waits for the in-flight tick to finish.

### Pattern: drainable connection accept loop

```go
type Server struct {
	ln       net.Listener
	conns    sync.Map
	wg       sync.WaitGroup
	closed   atomic.Bool
}

func (s *Server) Serve(ctx context.Context) error {
	for {
		c, err := s.ln.Accept()
		if err != nil {
			if s.closed.Load() {
				return nil
			}
			return err
		}
		s.wg.Add(1)
		s.conns.Store(c, struct{}{})
		go func() {
			defer s.wg.Done()
			defer s.conns.Delete(c)
			defer c.Close()
			s.handle(ctx, c)
		}()
	}
}

func (s *Server) Drain(ctx context.Context) error {
	s.closed.Store(true)
	_ = s.ln.Close()
	done := make(chan struct{})
	go func() { s.wg.Wait(); close(done) }()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		// force-close stragglers
		s.conns.Range(func(k, _ any) bool {
			_ = k.(net.Conn).Close()
			return true
		})
		<-done
		return ctx.Err()
	}
}
```

A raw TCP server drain. Useful for custom protocols. Note the force-close on deadline expiry — connections still must be closed, even if their handlers refused to exit.

---

## Appendix J: When Drain Cannot Be Implemented Cleanly

Some libraries simply cannot drain. Examples:

- Old database drivers without context support.
- C bindings via cgo that block indefinitely.
- Third-party SaaS clients with no exposed deadline.

For these, *isolate* the un-drainable component:

- Run it in a separate goroutine that you can leak on shutdown.
- Set a max time for it; if exceeded, give up and force-exit.
- Wrap it with a context-aware adapter that polls.

A common pattern: spawn the call, watch the context, return whichever comes first:

```go
func adaptable(ctx context.Context, slowCall func() (T, error)) (T, error) {
	type res struct {
		v T
		err error
	}
	ch := make(chan res, 1)
	go func() {
		v, err := slowCall()
		ch <- res{v, err}
	}()
	select {
	case r := <-ch:
		return r.v, r.err
	case <-ctx.Done():
		var zero T
		return zero, ctx.Err()
	}
}
```

The slowCall goroutine may still leak — that is the trade-off. At shutdown, the OS reclaims memory anyway.

---

## Appendix K: Drain Anti-Cheat — Reading For Real Behaviour

A frequent code review finding: a drain that looks correct in the static structure but lies. Tips for catching this:

### Tip 1: Trace a worker's exit path

Pick a worker. Follow every code path. Where does it `return`? Is each `return` reachable on drain?

### Tip 2: Mock a hung worker

Add `time.Sleep(time.Hour)` to a worker. Run the drain. If it does not honour the deadline, the drain is broken.

### Tip 3: Check `Submit` after `Drain`

```go
go svc.Drain(ctx)
time.Sleep(10*time.Millisecond)
err := svc.Submit(...)
// Should be: error or panic, depending on contract
```

If `Submit` accepts work during drain, the system has a race.

### Tip 4: Count `Add` and `Done`

For each `wg.Add(n)`, there should be exactly n `Done` calls reachable. A static count usually works.

### Tip 5: Search for `os.Exit`

`grep -rn 'os.Exit' .` Any hit outside `main` is suspicious.

### Tip 6: Search for `time.Sleep`

Long sleeps without a context check are drain killers.

### Tip 7: Search for `for {`

Infinite loops without exit conditions are leaks waiting to happen.

---

## Appendix L: A Vocabulary of Drain Bugs

Each bug has a name. Knowing the names speeds up incident triage.

| Bug | Symptom |
|-----|---------|
| **Eager close** | Channel closed while producers still active. Panic. |
| **Double close** | Same channel closed twice. Panic. |
| **Unbounded wait** | `Wait` with no deadline. Process hangs past grace period. |
| **Lost cancel** | `cancel` function not deferred. Context leak. |
| **Detached goroutine** | Goroutine has no exit on context. Leak. |
| **Stale flag** | `draining` flag set but not checked. New work accepted. |
| **Premature LB drop** | Health-check flips before listener stops. Brief 502s. |
| **Late LB drop** | Listener stops before health-check flips. Long 502s. |
| **Order swap** | DB closed before workers drain. Workers panic. |
| **Bucket overflow** | Drain budget exhausted in earlier phase. Later phases skipped. |
| **Fresh context** | Inner call uses `context.Background` instead of drain context. Unbounded. |

When debugging, name the bug. It clarifies the fix.

---

## Appendix M: A 30-Minute Drain Audit

A 30-minute checklist to apply to any Go service before shipping:

1. (3 min) Does `main` call `signal.NotifyContext`? Is the signal list correct?
2. (3 min) Is there a `Drain` or `Shutdown` for every long-lived component?
3. (5 min) Is each drain bounded by a context deadline?
4. (5 min) Is the drain order correct (outer first)?
5. (3 min) Is the readiness endpoint wired to drain state?
6. (3 min) Is there a sleep for readiness propagation?
7. (3 min) Are async producers flushed before close?
8. (3 min) Is there a metric for drain duration?
9. (2 min) Are tests verifying drain (empty + hung + double-call)?

A failing answer to any of these means there is fixable work. Done in 30 minutes for a typical 1000-line service.

---

## Appendix N: Long-Running Operations Across Drain Boundary

Some operations are inherently long: video transcoding, ML inference batches, ZIP unpacks. These cannot fit inside a 25-second drain.

Options:

1. **Decline new ones at drain start.** In-flight ones finish; new ones go to the next pod.
2. **Snapshot and resume.** Checkpoint state to a database. Next pod picks up where this one left off.
3. **Hand off to a dedicated long-running pod type.** Web pods do not handle long jobs; only worker pods do, with longer grace periods.

The choice is architectural. The drain pattern accommodates each but does not solve them.

---

## Appendix O: Common Mid-Level Patterns Recap

| Pattern | Use case |
|---------|----------|
| `Drainable` interface | Multiple components, single drain API. |
| `errgroup` + `signal.NotifyContext` | Top-level run+drain orchestration. |
| Idle-wait | Systems with internal re-emission. |
| Wait-group | Bounded job sets. |
| `sync.Once` for `Drain` | Idempotent drain. |
| Per-component deadline | Isolation; easier debugging. |
| Shared root deadline | Total budget control. |
| Health-flip + sleep | Smooth LB transitions. |
| `Flush` before `Close` | Async producers. |
| Reverse-of-construction order | Dependency-aware drain. |

Internalise all ten. They show up over and over.

---

## Final Summary

The middle level of drain is the discipline of *systemic shutdown*: across components, across processes, across phases, across deadlines. The tools are simple — `context`, `WaitGroup`, `errgroup`, `Once` — but applying them in the right order, with the right deadlines, with the right metrics, is what separates "code that drains in dev" from "code that drains in prod under load." Practise the patterns above until they are habits. Then move on to senior.

---

## Appendix P: A Larger Worked Scenario — Drain Across A Distributed Cluster

Consider a cluster of N pods behind a load balancer, all running the same Go service. A rolling deploy replaces the pods one at a time. Each pod's drain is local, but the overall rollout depends on each drain finishing within the grace period.

### Failure case 1: drain too long

Pod 1 receives `SIGTERM`. Its drain takes 35 seconds (deadline was 25, but some workers ignored cancellation). Kubernetes sends `SIGKILL` at 30 seconds. The pod exits with non-zero code. The rollout pauses. The remaining pods still serve traffic; the deploy stalls.

Fix: identify the workers that ignored cancellation. Either bound their work or drop them from the in-flight wait.

### Failure case 2: drain too short

Pod 1's drain deadline is 5 seconds. The P99 handler is 800ms, but during deploy load shifts and P99 spikes to 6 seconds. Drain timeout fires. 30% of in-flight requests fail. Customers see 500s.

Fix: raise the deadline. Verify with synthetic load.

### Failure case 3: drain works but LB lag is long

Pod 1 drains in 200ms. Pod 2 (the replacement) is not ready until 5 seconds later. During those 5 seconds, traffic falls on the remaining N-1 pods. They might be overloaded if N is small.

Fix: ensure readiness checks pass quickly on the replacement, or set `maxUnavailable=0` in the deploy spec so the replacement is healthy before the old one drains.

### Failure case 4: thundering herd on retries

When pod 1 drains, in-flight requests get 503. Clients retry. The N-1 pods get extra traffic. If clients all retry at the same time, you get a thundering herd.

Fix: clients should retry with jitter. Server can also return a `Retry-After` header.

### Failure case 5: state migration during drain

Pod 1 has a leader role for some shard. On drain, leadership must transfer. If the new leader is not elected in time, the shard is unavailable.

Fix: integrate leader election with drain. The drain triggers `releaseLeadership()` before stopping the listener.

These five scenarios are the bread and butter of mid-to-senior drain debugging. Recognise each shape; practise the fix.

---

## Appendix Q: Drain and Configuration

A drain has surprisingly many tunables:

- `drain_deadline` — total budget.
- `readiness_propagation_sleep` — wait for LB to notice.
- `http_drain_deadline` — sub-budget for HTTP.
- `worker_drain_deadline` — sub-budget for workers.
- `producer_flush_deadline` — sub-budget for async producers.
- `force_close_on_deadline` — boolean: hard-close connections on deadline?
- `metrics_flush_deadline` — sub-budget for metrics shipper.

Expose these as environment variables. Production sets them based on the orchestrator's grace period. Tests set them small.

```go
type DrainConfig struct {
	Total          time.Duration `env:"DRAIN_TOTAL"     envDefault:"25s"`
	Readiness      time.Duration `env:"DRAIN_READINESS" envDefault:"2s"`
	HTTPDeadline   time.Duration `env:"DRAIN_HTTP"      envDefault:"20s"`
	WorkerDeadline time.Duration `env:"DRAIN_WORKER"    envDefault:"15s"`
}
```

Defaults should be safe for production. Tests override.

---

## Appendix R: Drain in CI

Drain is testable in CI. A typical job:

```bash
go build -o ./service ./cmd/service
./service &
PID=$!
sleep 2
# warm up
curl http://localhost:8080/work &
curl http://localhost:8080/work &
curl http://localhost:8080/work &
sleep 0.5
kill -TERM $PID
START=$(date +%s%N)
wait $PID
END=$(date +%s%N)
DURATION=$(( (END - START) / 1000000 ))
echo "drain took ${DURATION}ms"
if [ $DURATION -gt 5000 ]; then
	echo "drain too slow"
	exit 1
fi
```

A 100-line test catches regressions before they reach production.

---

## Appendix S: A Discussion of `Server.Shutdown` Internals

`net/http.Server.Shutdown` is worth reading. Key fragments (paraphrased from the Go source):

1. Set `srv.inShutdown = true` atomically.
2. Close all listeners.
3. Loop:
   - Close idle keep-alive connections.
   - If active connections == 0, return nil.
   - Wait 100ms (with `time.NewTimer`) or until `ctx` is done.

The 100ms poll interval is hard-coded. For most services, that is fine. For very latency-sensitive shutdowns, you might write your own server.

The active-connection count is maintained by `srv.activeConn` — a `map[*conn]struct{}` protected by a mutex. Each accepted connection adds itself; each closed one removes itself.

Hijacked connections (WebSocket) are *not* tracked in `activeConn`. That is why `Server.Shutdown` does not wait for them.

`Server.RegisterOnShutdown` hooks run concurrently with `Shutdown`, but `Shutdown` does not wait for them. If you need to wait, do it yourself.

This level of understanding pays off the day a drain misbehaves and you have to read source to diagnose.

---

## Appendix T: Drain in Stream Processors

A stream processor (Kafka Streams-style, in Go) drains by checkpointing state.

```go
type Processor struct {
	in    <-chan Message
	state State
	wg    sync.WaitGroup
}

func (p *Processor) Run(ctx context.Context) error {
	for {
		select {
		case <-ctx.Done():
			return p.Checkpoint(ctx)
		case m, ok := <-p.in:
			if !ok {
				return p.Checkpoint(ctx)
			}
			p.state.Update(m)
		}
	}
}

func (p *Processor) Checkpoint(ctx context.Context) error {
	// flush state to durable storage
	return p.state.Save(ctx)
}
```

The drain is "process whatever you have, then checkpoint." Next pod starts from the checkpoint, no double processing.

Checkpoint failure during drain is critical. Log loudly; alert.

---

## Appendix U: A Long Drain Decision Tree

```text
SIGTERM received?
├── Yes:
│   ├── Are we in safe state to drain?
│   │   ├── Yes:
│   │   │   ├── Flip readiness
│   │   │   ├── Sleep for LB propagation
│   │   │   ├── Drain components in reverse order
│   │   │   └── Exit 0
│   │   └── No (corruption, panic, etc.):
│   │       ├── Log emergency
│   │       └── Exit 1
│   └── (always log signal received)
└── No (e.g., spontaneous error in main loop):
    ├── Treat as drain trigger
    └── Cancel root context
```

Print this. Pin it on your monitor.

---

## Appendix V: A Common Reviewer Conversation

**Reviewer:** "Your drain catches `SIGTERM` but not `SIGINT`. Is that intentional?"

**You:** "Production sends `SIGTERM`. Local dev sends `SIGINT` via Ctrl+C. Without `SIGINT`, dev users cannot test drain locally. I added both."

**Reviewer:** "Why is the drain deadline hard-coded to 25 seconds?"

**You:** "It is configurable via `DRAIN_TOTAL` env var. 25 seconds is the safe default for Kubernetes' 30-second grace period — 5 seconds of buffer."

**Reviewer:** "The producer flush takes 5 seconds, the HTTP drain takes 20, the worker drain takes 10. Total is 35. How does that fit in 25?"

**You:** "They are sequential and share the same context. If HTTP takes 20, worker has 5 remaining, producer has the rest. The 35-second 'total' is upper bound; in practice each phase finishes much faster."

**Reviewer:** "What if HTTP drain hangs?"

**You:** "HTTP drain has its own sub-deadline of 20s derived from the root. If it hits 20s, `Shutdown` returns `context.DeadlineExceeded`. We log and move on. Worker drain still gets the remaining budget."

**Reviewer:** "What about hijacked WebSocket connections?"

**You:** "We maintain our own registry. Before `Shutdown`, we send close frames to all of them. They have a couple of seconds to disconnect cleanly. After the deadline, we force-close."

**Reviewer:** "Looks good. Ship it."

A good drain code review is short because the code is correct. A long review is a sign the drain has structural issues.

---

## Appendix W: A Lab Exercise

Spend an afternoon doing this:

1. Implement a mid-sized service (HTTP + workers + Redis publisher).
2. Add drain to each component.
3. Wire them with `errgroup` and `signal.NotifyContext`.
4. Write five drain tests (empty, in-flight, hung, double-call, no-leaks).
5. Add metrics for drain duration.
6. Trigger drain via `kill -TERM` and observe logs.
7. Run under `vegeta` at 500 RPS; trigger drain; verify zero 5xx.

You will hit at least two real bugs along the way — that is the lesson.

---

## Appendix X: A Diagram of Component Drain Interactions

```text
        +----------------------+
        |     signal.Notify     |
        +----------+-----------+
                   │
                   ▼
        +----------------------+
        |       main()         |
        +----+-----+-----------+
             │     │
        ┌────┘     └────┐
        ▼               ▼
 +-------------+   +-------------+
 | HTTP Server |   | Worker Pool |
 +------+------+   +------+------+
        │                │
        │                ▼
        │         +-------------+
        │         |  Producer   |
        │         +------+------+
        │                │
        ▼                ▼
        +----------------+
        |   Database     |
        +----------------+

Drain order (reverse): Database closes last.
HTTP first, Workers second, Producer third, DB last.
```

The arrows are dependency direction. Drain happens up the arrows (downstream drains first).

---

## Appendix Y: Drain and the Health Endpoint Detail

The `/ready` endpoint should be a one-line read of an atomic:

```go
func (a *App) ready(w http.ResponseWriter, r *http.Request) {
	if a.draining.Load() {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	w.WriteHeader(http.StatusOK)
}
```

It should not check the database, the queue, or anything else. Two reasons:

1. **Performance.** The LB hits this endpoint often. A slow probe leads to cascading failures.
2. **Correctness.** Readiness is about traffic admission, not about deep health. A pod can be ready even if a non-critical dependency is degraded.

For deep health, use a separate `/health` or `/health/deep` endpoint that the operator hits manually.

---

## Appendix Z: One Final Practical Tip

Always log the drain duration:

```go
start := time.Now()
defer func() { log.Printf("drain duration: %s", time.Since(start)) }()
```

That single line — placed at the start of your drain function — saves countless hours of debugging. The duration tells you whether the drain is healthy or degrading over time. Add it now.

---

## Appendix AA: Drain Variations Across Workload Types

### CPU-bound workloads

For tight CPU loops, drain via cooperative cancellation only works if the loop checks the context periodically.

```go
func crunch(ctx context.Context, data []int) {
	for i, v := range data {
		if i%1024 == 0 {
			select {
			case <-ctx.Done():
				return
			default:
			}
		}
		_ = process(v)
	}
}
```

Without the periodic check, the loop runs to completion regardless of drain. The interval (1024 here) trades latency vs check overhead.

Go 1.14+ has asynchronous preemption that stops goroutines without cooperation, but it preempts goroutines, not work. The context still needs to be checked for the goroutine to exit cleanly.

### I/O-bound workloads

Most Go services are I/O-bound. The `select` on `<-ctx.Done()` and the I/O channel handles drain naturally:

```go
select {
case <-ctx.Done():
	return
case b := <-ioCh:
	process(b)
}
```

When ctx fires, the goroutine exits without finishing the pending I/O. The I/O upstream sees the connection close.

### Mixed workloads

A pipeline of CPU + I/O stages needs both patterns: I/O stages cancel via context, CPU stages periodically check context. The slowest stage to react becomes the bottleneck of drain.

---

## Appendix BB: Pattern Library — Drainable Building Blocks

A short catalogue of reusable drainable building blocks:

### Ticker

```go
type Ticker struct {
	period time.Duration
	fn     func(context.Context)
	wg     sync.WaitGroup
}

func (t *Ticker) Start(ctx context.Context) {
	t.wg.Add(1)
	go func() {
		defer t.wg.Done()
		tk := time.NewTicker(t.period)
		defer tk.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-tk.C:
				t.fn(ctx)
			}
		}
	}()
}

func (t *Ticker) Drain(ctx context.Context) error {
	done := make(chan struct{})
	go func() { t.wg.Wait(); close(done) }()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
```

### Batcher

```go
type Batcher struct {
	in       chan Item
	maxSize  int
	flushDur time.Duration
	flush    func(context.Context, []Item) error
	wg       sync.WaitGroup
}

func (b *Batcher) Start(ctx context.Context) {
	b.wg.Add(1)
	go func() {
		defer b.wg.Done()
		buf := make([]Item, 0, b.maxSize)
		timer := time.NewTimer(b.flushDur)
		defer timer.Stop()
		for {
			select {
			case <-ctx.Done():
				if len(buf) > 0 {
					_ = b.flush(context.Background(), buf)
				}
				return
			case item := <-b.in:
				buf = append(buf, item)
				if len(buf) >= b.maxSize {
					_ = b.flush(ctx, buf)
					buf = buf[:0]
					timer.Reset(b.flushDur)
				}
			case <-timer.C:
				if len(buf) > 0 {
					_ = b.flush(ctx, buf)
					buf = buf[:0]
				}
				timer.Reset(b.flushDur)
			}
		}
	}()
}
```

Notice: on drain, the batcher flushes its remaining buffer using a fresh `context.Background()`. That is a design choice — if the drain context expired, the buffer would not flush at all. Using a fresh context lets the flush attempt complete even past the drain deadline. The trade-off is more total wall-clock time.

### Throttler

```go
type Throttler struct {
	in    chan Work
	out   chan Work
	rate  time.Duration
	wg    sync.WaitGroup
}

func (t *Throttler) Start(ctx context.Context) {
	t.wg.Add(1)
	go func() {
		defer t.wg.Done()
		defer close(t.out)
		tk := time.NewTicker(t.rate)
		defer tk.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-tk.C:
				select {
				case <-ctx.Done():
					return
				case w := <-t.in:
					select {
					case <-ctx.Done():
						return
					case t.out <- w:
					}
				}
			}
		}
	}()
}
```

The nested selects ensure context cancellation is honoured at every blocking point.

### Fan-out

```go
type FanOut struct {
	in   chan Work
	outs []chan Work
	wg   sync.WaitGroup
}

func (f *FanOut) Start(ctx context.Context) {
	f.wg.Add(1)
	go func() {
		defer f.wg.Done()
		for _, out := range f.outs {
			defer close(out)
		}
		for {
			select {
			case <-ctx.Done():
				return
			case w := <-f.in:
				for _, out := range f.outs {
					select {
					case <-ctx.Done():
						return
					case out <- w:
					}
				}
			}
		}
	}()
}
```

### Fan-in

```go
type FanIn struct {
	ins  []<-chan Work
	out  chan Work
	wg   sync.WaitGroup
}

func (f *FanIn) Start(ctx context.Context) {
	for _, in := range f.ins {
		f.wg.Add(1)
		go func(c <-chan Work) {
			defer f.wg.Done()
			for w := range c {
				select {
				case <-ctx.Done():
					return
				case f.out <- w:
				}
			}
		}(in)
	}
	go func() {
		f.wg.Wait()
		close(f.out)
	}()
}
```

Each of these blocks can be composed into a pipeline. Each respects drain. Pipelines built from drainable blocks drain cleanly without bespoke wiring.

---

## Appendix CC: Drain in Long-Lived gRPC Streams

```go
func (s *Service) BigStream(stream pb.Service_BigStreamServer) error {
	ctx := stream.Context()
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return status.FromContextError(ctx.Err()).Err()
		case <-ticker.C:
			if err := stream.Send(&pb.Item{ /* ... */ }); err != nil {
				return err
			}
		case <-s.shuttingDown:
			// proactive close: server is shutting down
			return status.Error(codes.Unavailable, "server shutting down")
		}
	}
}
```

Two cancellation channels: the stream context (cancelled by gRPC machinery during `GracefulStop`) and a service-level `shuttingDown` channel (closed at the start of drain). The second lets us close streams *before* the gRPC server begins its drain — useful for very long streams.

---

## Appendix DD: Drain in Pub/Sub Subscribers

NATS, Google Pub/Sub, Redis Pub/Sub all share a pattern: a subscription delivers messages to a handler. Drain stops new deliveries and waits for in-flight ones to ack.

```go
type Sub struct {
	handler func(context.Context, Message) error
	wg      sync.WaitGroup
	draining atomic.Bool
}

func (s *Sub) onMessage(msg Message) {
	if s.draining.Load() {
		_ = msg.Nack() // let another consumer take it
		return
	}
	s.wg.Add(1)
	defer s.wg.Done()
	if err := s.handler(context.Background(), msg); err != nil {
		_ = msg.Nack()
		return
	}
	_ = msg.Ack()
}

func (s *Sub) Drain(ctx context.Context) error {
	s.draining.Store(true)
	done := make(chan struct{})
	go func() { s.wg.Wait(); close(done) }()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
```

The pattern: flag flip, in-flight wait, deadline bound. Nack pending messages so another consumer can pick them up.

---

## Appendix EE: Drain in HTTP Client Connection Pools

`http.Client` reuses connections. On shutdown, you usually do not need to drain HTTP clients — outstanding requests are bounded by the per-request timeout. But if you want to be tidy:

```go
client.CloseIdleConnections()
```

`CloseIdleConnections` only closes idle ones; active ones continue. The transport closes them when their responses complete.

For a fully drainable client, wrap `http.Client` with your own tracking:

```go
type DrainableClient struct {
	c       *http.Client
	inFlight sync.WaitGroup
}

func (d *DrainableClient) Do(req *http.Request) (*http.Response, error) {
	d.inFlight.Add(1)
	defer d.inFlight.Done()
	return d.c.Do(req)
}

func (d *DrainableClient) Drain(ctx context.Context) error {
	done := make(chan struct{})
	go func() { d.inFlight.Wait(); close(done) }()
	select {
	case <-done:
		d.c.CloseIdleConnections()
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
```

---

## Appendix FF: Drain Tracing With OpenTelemetry

A trace of a drain helps post-mortem analysis.

```go
import "go.opentelemetry.io/otel"

func (a *App) Drain(ctx context.Context) error {
	tracer := otel.Tracer("app")
	ctx, span := tracer.Start(ctx, "drain")
	defer span.End()

	{
		_, s := tracer.Start(ctx, "drain.flip-readiness")
		a.draining.Store(true)
		s.End()
	}

	{
		_, s := tracer.Start(ctx, "drain.propagation-sleep")
		time.Sleep(2 * time.Second)
		s.End()
	}

	{
		c, s := tracer.Start(ctx, "drain.http")
		err := a.srv.Shutdown(c)
		if err != nil {
			s.RecordError(err)
		}
		s.End()
	}

	// ... etc

	return nil
}
```

Each phase is a child span. The trace UI shows a Gantt chart. Slow phases are obvious.

---

## Appendix GG: Drain and Garbage Collection

Drain may temporarily increase memory usage: pending requests are still in memory, plus the new tracking structures. After drain completes, memory should drop close to baseline (modulo what was already idle).

If memory does not drop, you likely have a leak — a goroutine still alive, holding references. Use `pprof` to inspect.

A practical tip: take a heap profile before and after drain in a test. Diff them. Anything that grew is a candidate leak.

```bash
go test -memprofile=mem.before ...
# trigger drain
go test -memprofile=mem.after ...
go tool pprof -base=mem.before mem.after
```

---

## Appendix HH: Drain and Connection Caching

A common production pattern is to cache outbound HTTP/gRPC clients. On drain, close them after workers are done.

```go
type ClientCache struct {
	mu sync.Mutex
	m  map[string]*http.Client
}

func (c *ClientCache) CloseAll() {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, cl := range c.m {
		cl.CloseIdleConnections()
	}
	c.m = nil
}
```

Call `CloseAll` after worker drain. Earlier, and your workers' requests fail mid-flight.

---

## Appendix II: Drain and Sidecar Containers

Service mesh sidecars (Envoy, Linkerd) need to drain too. The pattern in Kubernetes:

1. Application container starts drain on `SIGTERM`.
2. Application finishes drain, exits.
3. Sidecar finishes draining (it may still have in-flight proxied requests).
4. Pod terminates.

If the application exits before the sidecar, the sidecar has no upstream — but it may still need to drain its own state (metrics, traces). The orchestrator must give it time.

Configure the sidecar's `preStop` hook to sleep for the grace period. Or use Istio's `EXIT_ON_ZERO_ACTIVE_CONNECTIONS`.

---

## Appendix JJ: Final Practical Drill

A 90-minute self-drill:

1. (15 min) Write a worker pool with drain from scratch. No copy-paste.
2. (15 min) Add an HTTP layer that submits to the pool.
3. (15 min) Wire `signal.NotifyContext`. Test with `kill -TERM`.
4. (15 min) Add a deadline. Test with a `time.Sleep(time.Hour)` job.
5. (15 min) Add `/ready`. Test it flips on drain.
6. (15 min) Add a metric for drain duration. Verify it emits.

90 minutes. If you can do this end-to-end without copying, you have internalised the mid-level drain pattern. That is the bar.

---

## Appendix KK: Drain and Feature Flags

Some teams use feature flags to enable or disable drain at runtime. Useful for incident response:

```go
if featureflag.Enabled("graceful_drain") {
	_ = svc.Drain(ctx)
} else {
	os.Exit(0)
}
```

When a drain has a known bug, the operator flips the flag to fall back to hard stop until the bug is fixed. Better than rolling back the entire binary.

The downside: the feature flag is one more thing to test. Treat it like any other code path.

---

## Appendix LL: Drain in Multi-Tenant Services

A service that handles many tenants in one binary should treat each tenant's drain as a unit. On drain:

1. Stop accepting new tenants.
2. For each active tenant, drain that tenant's in-flight work.
3. Close shared resources.

```go
type Tenant struct {
	id       string
	inFlight sync.WaitGroup
}

func (s *Service) Drain(ctx context.Context) error {
	s.tenants.Range(func(_, v any) bool {
		t := v.(*Tenant)
		// drain in parallel
		go func() {
			done := make(chan struct{})
			go func() { t.inFlight.Wait(); close(done) }()
			select {
			case <-done:
			case <-ctx.Done():
			}
		}()
		return true
	})
	// ... wait for all tenants
	return nil
}
```

Per-tenant drains run in parallel; the overall drain ends when the slowest tenant finishes (or deadline).

---

## Appendix MM: Drain and Service Mesh

In a service mesh (Istio, Linkerd), drain involves the sidecar proxy as well as the application. The application drain alone is not enough — the proxy may still hold connections.

Recommended order:

1. Application receives `SIGTERM`.
2. Application flips readiness off.
3. Sleep for propagation (longer in service mesh, often 5-10s).
4. Application drains its in-flight requests.
5. Application exits.
6. Mesh sidecar drains its proxied connections.
7. Sidecar exits.
8. Pod terminates.

The exact mechanism varies by mesh. Read your mesh's drain documentation; sometimes you need `terminationDrainDuration` settings.

---

## Appendix NN: Drain Pattern One-Page Summary

```text
Components needed:
1. signal.NotifyContext at top of main.
2. Each long-lived component has Start(ctx) and Drain(ctx).
3. errgroup or wait group to coordinate.
4. Per-phase deadline budget.
5. Health endpoint reflecting drain state.
6. Metrics for drain duration.

Order:
1. Receive signal.
2. Flip readiness.
3. Sleep for LB propagation.
4. Drain HTTP (no new requests).
5. Drain workers (queue drains, workers exit).
6. Flush async producers.
7. Close downstream (DB, Redis, etc.).
8. Return from main, exit 0.

Pitfalls to avoid:
- No deadline.
- Wrong context (derived from cancelled parent).
- Double close.
- Drain without health flip.
- Long sleep without context check.
- Goroutine without exit path.
- Async producer without flush.
- Drain DB before drain workers.
```

Print this. Tape it next to the junior cheat sheet.

---

## Appendix OO: Going Beyond Mid-Level

When you can:

- Design a drain order for a service of 6+ components without thinking.
- Diagnose a stuck drain from a goroutine dump.
- Choose the right deadline for a new service based on traffic patterns.
- Lead a code review that catches drain bugs in 10 minutes.

You are ready for [senior.md](senior.md). Senior covers supervisor patterns, two-phase shutdown, drain across cluster boundaries, and the architecture of drain-friendly systems.




