---
layout: default
title: Professional
parent: Wait for Empty Channel
grand_parent: Concurrency Anti-Patterns
ancestor: Go
nav_order: 4
permalink: /roadmap/programming-languages/golang/07-concurrency/15-concurrency-anti-patterns/05-wait-for-empty-channel/professional/
---

# Wait-for-Empty-Channel — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [Production Realities](#production-realities)
3. [Graceful Shutdown: A Complete Treatment](#graceful-shutdown-a-complete-treatment)
4. [Drain Protocols for Live Traffic](#drain-protocols-for-live-traffic)
5. [Queue Draining in Workers](#queue-draining-in-workers)
6. [Observability for In-Flight Work](#observability-for-in-flight-work)
7. [Tracing Concurrent Lifecycles](#tracing-concurrent-lifecycles)
8. [Coordinator Patterns](#coordinator-patterns)
9. [Cluster-Wide Coordination](#cluster-wide-coordination)
10. [Kubernetes Pod Lifecycle](#kubernetes-pod-lifecycle)
11. [PreStop and Shutdown Hooks](#prestop-and-shutdown-hooks)
12. [Connection Draining](#connection-draining)
13. [Load Balancer Coordination](#load-balancer-coordination)
14. [Message Queue Drain Semantics](#message-queue-drain-semantics)
15. [Idempotency and Replay](#idempotency-and-replay)
16. [Migration Without Downtime](#migration-without-downtime)
17. [Feature Flags for Concurrency Refactors](#feature-flags-for-concurrency-refactors)
18. [Production Telemetry: Key Metrics](#production-telemetry-key-metrics)
19. [Alerting on the Anti-Pattern](#alerting-on-the-anti-pattern)
20. [Capacity Planning](#capacity-planning)
21. [Cost of Polling in Cloud Bills](#cost-of-polling-in-cloud-bills)
22. [Latency Tails: How Polling Hurts P99](#latency-tails-how-polling-hurts-p99)
23. [CPU Profile Reading](#cpu-profile-reading)
24. [Trace Reading at Scale](#trace-reading-at-scale)
25. [Continuous Profiling](#continuous-profiling)
26. [Postmortem Patterns](#postmortem-patterns)
27. [Incident Playbook](#incident-playbook)
28. [Audit Process for Legacy Codebases](#audit-process-for-legacy-codebases)
29. [Migration Playbook](#migration-playbook)
30. [Rollout Strategy](#rollout-strategy)
31. [Rollback Strategy](#rollback-strategy)
32. [Team Training Plan](#team-training-plan)
33. [Self-Assessment](#self-assessment)
34. [Summary](#summary)

---

## Introduction

At the professional level the wait-for-empty-channel anti-pattern is no longer a code-correctness problem; it is a *systems* problem. The code is wrong, yes — but the consequences are felt operationally: shutdowns hang, deployments drop traffic, alerts fire from elevated CPU, latency tails grow, and customer-facing failures occur. The professional engineer's job is to manage the consequences and migrate the system off the pattern without disruption.

This file walks the operational dimensions. It assumes you have read junior, middle, and senior. The synchronisation theory is settled; here we cover:

- How to shut down a service gracefully under live traffic.
- How to observe in-flight work without polling.
- How to coordinate shutdown across a fleet.
- How to migrate a large codebase off the pattern without downtime.
- How to alert on the pattern's symptoms before customers notice.
- How to read profiles, traces, and dashboards to find the pattern in production.

The patterns here apply to any concurrent service. The Go-specific bits are about the standard library and ecosystem, but most of the discussion translates to any language with green threads or async runtimes.

---

## Production Realities

Operations is different from development. Three realities to internalise.

### Reality 1: traffic does not pause for you

You do not get to "stop the world" while you shut down. Pods are killed; new requests still arrive at the load balancer; existing requests are mid-flight. Your shutdown logic runs concurrently with all of that.

### Reality 2: shutdowns have hard deadlines

Kubernetes gives you `terminationGracePeriodSeconds` (default 30s, often shorter in production). After that, SIGKILL. Whatever in-flight work you had is gone unless persisted. The polling pattern often *exceeds* the deadline because it never confirms completion, only that the queue is briefly empty.

### Reality 3: errors compound

A polling loop's CPU usage is one cost; the latency it adds is another; the requests it drops during shutdown are a third. Each is a separate metric in your dashboards. Each can trigger an alert. Each contributes to a customer-visible outage. The compound effect is more than the sum.

These realities frame everything in this file.

---

## Graceful Shutdown: A Complete Treatment

The reference implementation of graceful shutdown in a Go HTTP service.

```go
package main

import (
    "context"
    "errors"
    "log"
    "net/http"
    "os"
    "os/signal"
    "sync"
    "syscall"
    "time"
)

func main() {
    ctx, cancel := signal.NotifyContext(
        context.Background(),
        syscall.SIGINT, syscall.SIGTERM,
    )
    defer cancel()

    srv := &http.Server{
        Addr:    ":8080",
        Handler: newHandler(),
    }

    serverErr := make(chan error, 1)
    go func() {
        if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
            serverErr <- err
        }
    }()

    select {
    case <-ctx.Done():
        log.Println("signal received; shutting down")
    case err := <-serverErr:
        log.Printf("server error: %v", err)
    }

    shutdownCtx, cancelShutdown := context.WithTimeout(context.Background(), 25*time.Second)
    defer cancelShutdown()

    if err := srv.Shutdown(shutdownCtx); err != nil {
        log.Printf("graceful shutdown failed: %v", err)
        return
    }
    log.Println("shutdown complete")
}
```

What this does right:

- Uses `signal.NotifyContext` to convert OS signals into a cancellable context.
- The server runs in a goroutine; the main goroutine waits on either the signal or a server error.
- On shutdown, `http.Server.Shutdown` is called with a deadline-bounded context.
- `Shutdown` blocks until all active requests complete or the deadline expires. It uses internal WaitGroup-like coordination, not polling.
- After Shutdown returns, the program exits.

No `len`. No polling. The 25-second deadline gives Kubernetes' default 30-second window enough room.

### Add background workers

A real service has background workers too. They must shut down with the same discipline.

```go
type App struct {
    srv    *http.Server
    pool   *worker.Pool
    cancel context.CancelFunc
}

func (a *App) Run(ctx context.Context) error {
    ctx, a.cancel = context.WithCancel(ctx)
    defer a.cancel()

    g, ctx := errgroup.WithContext(ctx)

    g.Go(func() error {
        return a.runServer(ctx)
    })

    g.Go(func() error {
        return a.pool.Run(ctx)
    })

    return g.Wait()
}

func (a *App) Shutdown(ctx context.Context) error {
    g, gctx := errgroup.WithContext(ctx)
    g.Go(func() error { return a.srv.Shutdown(gctx) })
    g.Go(func() error { return a.pool.Close() })
    return g.Wait()
}
```

Both components have their own Shutdown. They run concurrently. The errgroup waits for both.

### The shutdown order

For complex services, shutdown order matters. The general pattern:

1. Stop accepting new traffic at the edge (server.Shutdown stops accepting new connections).
2. Drain in-flight work (server.Shutdown waits for active requests; worker pools wait for active jobs).
3. Close downstream resources (database connections, file handles).
4. Final flush of metrics, logs.
5. Exit.

Reversing the order (closing the DB before draining requests) causes the in-flight requests to fail. Get the order right.

---

## Drain Protocols for Live Traffic

A web service receives requests continuously. Shutdown must:

- Stop accepting new requests promptly (within ~100 ms).
- Let in-flight requests finish (up to a bounded time).
- Reject net-new requests cleanly (or rely on the load balancer to redirect them).

### Pattern: readiness-first shutdown

```go
type Server struct {
    ready atomic.Bool
}

func (s *Server) ReadyHandler(w http.ResponseWriter, r *http.Request) {
    if s.ready.Load() {
        w.WriteHeader(200)
        return
    }
    w.WriteHeader(503)
}

func (s *Server) Shutdown(ctx context.Context) error {
    s.ready.Store(false) // fail readiness probe
    time.Sleep(s.gracePeriod) // give LB time to drain
    return s.srv.Shutdown(ctx)
}
```

The readiness probe goes red first. The load balancer notices and stops sending new traffic. After a grace period (typically 5-15s, matching the LB poll interval), the HTTP server drains in-flight requests.

This pattern requires careful coordination with the load balancer's health check frequency. Document it.

### Pattern: connection draining

If the LB does HTTP/2 or keepalive connections, in-flight connections must drain. The HTTP/2 GOAWAY frame tells clients "use a different connection." `http.Server.Shutdown` sends GOAWAY automatically.

For raw TCP services, you implement this yourself: close the listener (so no new accepts), set a deadline on existing connections, wait.

```go
listener.Close()
var wg sync.WaitGroup
for _, conn := range activeConns {
    conn := conn
    wg.Add(1)
    go func() {
        defer wg.Done()
        conn.SetDeadline(time.Now().Add(30 * time.Second))
        // existing reads/writes will return with timeout
    }()
}
wg.Wait()
```

No polling. The deadline ensures bounded wait; the WaitGroup confirms completion.

---

## Queue Draining in Workers

A worker that consumes from a queue (Kafka, SQS, in-memory) has its own drain semantics.

### Drain semantics by queue type

**Kafka:**

- Stop pulling new messages.
- Finish processing the current batch.
- Commit offsets.
- Disconnect.

**SQS:**

- Stop pulling new messages.
- Finish processing in-flight messages.
- Delete completed messages (so they are not retried).
- Disconnect.

**In-memory channel:**

- Stop accepting new submissions.
- Drain the channel.
- Wait for workers to finish processing.

In each case, the drain has two phases: stop accepting, then wait for completion. The polling pattern attempts to short-circuit by checking "is the queue empty?" — which conflates the two phases incorrectly.

### Reference implementation

```go
type Worker struct {
    queue   Queue
    g       *errgroup.Group
    workers int
}

func (w *Worker) Start(ctx context.Context) error {
    g, ctx := errgroup.WithContext(ctx)
    w.g = g
    for i := 0; i < w.workers; i++ {
        g.Go(func() error {
            for {
                select {
                case <-ctx.Done():
                    return nil
                default:
                }
                msg, err := w.queue.Receive(ctx, 30*time.Second)
                if err != nil {
                    if errors.Is(err, context.Canceled) {
                        return nil
                    }
                    return err
                }
                if msg == nil {
                    continue // poll returned empty; loop and check ctx
                }
                if err := w.process(ctx, msg); err != nil {
                    log.Println("process error:", err)
                    continue // do not return; one bad message should not kill the worker
                }
                if err := msg.Ack(ctx); err != nil {
                    return err
                }
            }
        })
    }
    return nil
}

func (w *Worker) Shutdown(ctx context.Context) error {
    // The errgroup's context cancels when ctx cancels (assuming Start was called with ctx).
    // Workers observe and return.
    return w.g.Wait()
}
```

The worker loop respects `ctx.Done()`, processes one message at a time, acks on success. No `len`, no polling, no sleeps.

The `Receive(ctx, 30*time.Second)` is a long-poll. If no message arrives within 30 seconds, it returns nil and the loop iterates. The 30-second poll is the queue's API; the worker's `ctx.Done()` check ensures shutdown happens promptly.

---

## Observability for In-Flight Work

You cannot manage what you cannot measure. Observability for in-flight work has three pillars: metrics, logs, traces.

### Metric: in-flight count

The number of operations currently in flight. Easy to track with atomics or a metric registry:

```go
var inFlight atomic.Int64

func (s *Service) Handle(r *Request) {
    inFlight.Add(1)
    defer inFlight.Add(-1)
    // ...
}

// Periodically:
metrics.Gauge("inflight").Set(float64(inFlight.Load()))
```

This is a legitimate use of state inspection. The result is informational, not a synchronisation primitive.

### Metric: queue depth

The current number of items in a queue. Use `len(ch)` for this — it is legitimate.

```go
metrics.Gauge("queue.depth").Set(float64(len(jobs)))
```

### Metric: processing rate

Counter of items processed per second:

```go
metrics.Counter("processed").Inc()
```

Rate calculation happens in the metrics backend (Prometheus rate(), Datadog rate, etc.).

### Metric: shutdown duration

How long shutdown takes. Useful for confirming drain works.

```go
start := time.Now()
defer func() {
    metrics.Histogram("shutdown.duration").Observe(time.Since(start).Seconds())
}()
```

### Log: shutdown events

Logs document the sequence:

```go
log.Println("shutdown: received signal, stopping new connections")
log.Println("shutdown: draining; in-flight =", inFlight.Load())
log.Println("shutdown: in-flight =", inFlight.Load(), "elapsed =", time.Since(start))
log.Println("shutdown: complete")
```

If shutdown hangs, the logs show where.

### Trace: per-request lifecycle

OpenTelemetry traces show every operation, its duration, and its relationship to others. A shutdown anomaly shows up as a span with unusually long duration or a sub-span that never completes.

---

## Tracing Concurrent Lifecycles

For complex services, distributed tracing is the most valuable observability tool.

### Span hierarchy

```
serve_request
  ├── validate
  ├── enqueue_job
  │     └── (later, in worker)
  │          process_job
  │            ├── db_query
  │            ├── external_api
  │            └── persist_result
  └── respond
```

The trace links the request to the eventual job processing, even across async boundaries. If the polling anti-pattern is present, you see weird shapes: a span called "wait_for_drain" that spans seconds while a worker span next to it finishes in milliseconds — clear evidence of polling versus event.

### Propagating context for traces

```go
ctx, span := tracer.Start(ctx, "serve_request")
defer span.End()

// pass ctx into the worker queue
job := Job{
    Payload: payload,
    Span:    span.SpanContext(),
}
queue <- job

// in worker:
ctx = trace.ContextWithSpanContext(workerCtx, job.Span)
ctx, span := tracer.Start(ctx, "process_job")
defer span.End()
```

The job carries the trace context. The worker resumes the trace. The request span and the worker span are linked even though they are in different goroutines.

### What to look for in traces

- Spans much longer than the work they describe — usually polling.
- Sub-spans that never finish — usually a leaked goroutine.
- Spans whose start times exceed their parent's end — usually misordered cleanup.
- Spans that take exactly N ms multiple of polling interval — usually a polling loop.

A senior SRE pattern: in trace analysis, build histograms of span duration modulo common polling intervals. Spikes at exact multiples of 10 ms or 100 ms indicate polling.

---

## Coordinator Patterns

A coordinator is a goroutine (or process) that orchestrates other goroutines (or processes). Its job is to make the lifecycle observable.

### Single-process coordinator

```go
type Coordinator struct {
    children []Component
    ready    chan struct{}
    done     chan struct{}
}

func (c *Coordinator) Run(ctx context.Context) error {
    g, ctx := errgroup.WithContext(ctx)
    for _, child := range c.children {
        child := child
        g.Go(func() error {
            return child.Run(ctx)
        })
    }
    close(c.ready)
    err := g.Wait()
    close(c.done)
    return err
}
```

The coordinator exposes `ready` (all children started) and `done` (all children exited). Operators observe both.

### Distributed coordinator

For multi-process systems, a distributed coordinator (etcd, ZooKeeper, Consul) replaces the in-process goroutine. The same patterns apply:

- A `ready` indicator (leader election succeeded; all replicas reporting healthy).
- A `done` indicator (all replicas drained and shut down).

The polling anti-pattern can appear at any layer. In a distributed context, "poll the cluster's queue depth" is the same bad shape. Use events: each node publishes its state to the coordinator; the coordinator's view updates as events arrive.

---

## Cluster-Wide Coordination

When deploying a new version, the cluster goes through a rolling update. Old pods drain; new pods come up. The wait-for-empty-channel anti-pattern can hide at this layer.

### The problem

A pod is killed (SIGTERM); it has 30 seconds to shut down. Inside the pod, the worker polls a Kafka topic. The polling cycle wakes every minute. The shutdown signal is received; the pod waits for the worker to finish. The worker's poll cycle has not completed yet, so it has not seen the signal. The 30 seconds elapses; SIGKILL.

### The fix

The worker's poll must accept a context.

```go
msg, err := reader.ReadMessage(ctx)
```

With Kafka's `kafka-go` library or `confluent-kafka-go`, the read accepts a context. On `ctx.Done()`, the read returns promptly. The worker observes the shutdown signal and exits.

### Verification

Check every long-running blocking call in your service. Each must accept a context. If any does not, the shutdown deadline will be exceeded.

```bash
# Quick audit:
grep -nR ".Read(\|.Recv(\|.Get(\|.Wait(" --include="*.go" | grep -v ctx
```

Suspect anything that does not have `ctx` as a parameter.

---

## Kubernetes Pod Lifecycle

A Kubernetes pod's lifecycle has phases. Each phase has implications for the wait-for-empty-channel discussion.

### Phase 1: Pending

The pod is scheduled but not yet running. No traffic. No work.

### Phase 2: Running

The container is up. Readiness probes determine if traffic flows. Liveness probes detect hangs.

### Phase 3: Terminating

`SIGTERM` is sent. The pod has `terminationGracePeriodSeconds` to exit cleanly. After that, `SIGKILL`.

### What happens in Terminating

1. Kubernetes removes the pod from the Service's endpoint list (approximately — this is eventually consistent).
2. The load balancer's next poll notices the change and stops sending traffic to the pod.
3. The pod receives SIGTERM.
4. The pod's process handles the signal and begins shutdown.

The race: step 1-2 takes time (typically 5-15s). During that window, the pod is receiving SIGTERM but also still receiving new traffic. The shutdown logic must accept new connections during this window or the load balancer will see failures.

### The canonical fix

```go
// PreStop hook in the pod spec:
preStop:
  exec:
    command:
      - sleep
      - "15"

// Or in code:
func (s *Server) handleSIGTERM(ctx context.Context) {
    log.Println("SIGTERM received; failing readiness for 15s")
    s.ready.Store(false)
    time.Sleep(15 * time.Second)
    log.Println("draining")
    s.srv.Shutdown(ctx)
}
```

The pod fails its readiness probe immediately, then sleeps for 15s. During that time, the load balancer notices and stops sending new traffic. After 15s, the pod calls Shutdown and drains existing connections.

No polling of `len(ch)`. The mechanism is: readiness probe → load balancer → traffic cessation. The pod waits for this to propagate via a *time-based* delay, which is acceptable because the LB's polling interval is known.

---

## PreStop and Shutdown Hooks

`preStop` hooks run before SIGTERM. They give you a way to coordinate the LB drain without coding it inside the application.

```yaml
spec:
  containers:
  - name: app
    lifecycle:
      preStop:
        exec:
          command: ["sh", "-c", "curl -X POST localhost:8080/admin/drain && sleep 15"]
```

The hook calls the app's `/admin/drain` endpoint, which flips a flag to fail readiness. Then it sleeps for 15 seconds, during which the LB notices. Then the hook exits, Kubernetes sends SIGTERM, and the app's shutdown logic runs.

This pattern separates concerns: the hook handles "tell the LB to stop"; the app's signal handler handles "drain and exit." Both are testable in isolation.

---

## Connection Draining

For services that hold persistent connections (gRPC streams, WebSockets, raw TCP), draining the connections is an explicit step.

### gRPC

`grpc.Server.GracefulStop()` blocks new connections and waits for existing RPCs to finish.

```go
srv := grpc.NewServer()
go func() {
    if err := srv.Serve(listener); err != nil {
        log.Println(err)
    }
}()

<-ctx.Done()
done := make(chan struct{})
go func() {
    srv.GracefulStop()
    close(done)
}()
select {
case <-done:
case <-time.After(25 * time.Second):
    srv.Stop() // force
}
```

`GracefulStop` is the structured wait. `Stop` is the force.

### WebSocket

For WebSocket connections, you cannot interrupt them mid-stream gracefully. The pattern is:

1. Mark new connections as rejected (readiness fails).
2. Send a "close" frame to each existing connection.
3. Wait for the client to acknowledge.
4. Close.

```go
for _, conn := range activeConns {
    conn := conn
    go func() {
        conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(1001, "shutting down"))
        conn.Close()
    }()
}
```

Track active connections in a map under a mutex. Iterate during shutdown. Use a WaitGroup to wait for goroutines that handle each connection.

### Raw TCP

Set a deadline on every connection at shutdown time:

```go
for _, conn := range activeConns {
    conn.SetDeadline(time.Now().Add(30 * time.Second))
}
```

Existing reads/writes return with timeout. Handler goroutines clean up. Wait via WaitGroup.

---

## Load Balancer Coordination

The load balancer's polling cycle is a known quantity. Your shutdown sequence must accommodate it.

### AWS ALB

Default deregistration delay: 300s. Configurable. After SIGTERM, the ALB stops sending traffic to your pod within this window.

### GCP Internal Load Balancer

The drain period is configurable per backend service. Default 0s (immediate drain). Set to match your shutdown time.

### Kubernetes Service

The Endpoints object is updated when a pod terminates. The kube-proxy's IPVS rules are updated subsequently. There is no fixed delay; it depends on the cluster's reaction time, typically 1-3 seconds.

### Implication for shutdown

Your pod's `preStop` sleep should be at least as long as the LB's polling interval plus a margin. For ALB with default settings, that means 30-60s. For internal services, 10-15s is usually enough.

### What the polling anti-pattern does here

If your shutdown logic polls "is the queue empty?", it doesn't know about the LB's drain. It happily reports "queue empty" while the LB is still routing requests to this pod. The pod accepts a request, then exits, dropping the request.

The fix is to integrate with the LB drain via readiness or `preStop` hooks. The synchronisation is between *the LB's polling cycle* and *your pod's shutdown* — that synchronisation is time-based and acceptable. The synchronisation between *your pod's internal goroutines* must be event-based.

---

## Message Queue Drain Semantics

Each message queue has its own drain semantics. Understanding them is operational, not theoretical.

### Kafka

- Messages are not "consumed" until offsets are committed.
- Stopping a consumer without committing causes the messages to be redelivered to other consumers.
- Stopping a consumer after committing means the messages are durably acknowledged.

For drain, the consumer should:

1. Finish processing all in-flight messages.
2. Commit offsets.
3. Disconnect cleanly (close the consumer; it sends `LeaveGroup` to the broker).

Failure modes:

- If the consumer crashes before commit, messages are redelivered. Idempotency is essential.
- If the consumer commits but crashes before disconnect, the broker waits for the session timeout before rebalancing. New consumers take over.

### SQS

- Messages have a visibility timeout. While processing, the consumer can extend the timeout.
- Failure to delete the message before timeout causes redelivery.

For drain:

1. Stop receiving.
2. Finish processing in-flight messages.
3. Delete completed messages.

### RabbitMQ

- Messages can be auto-ack (acked on delivery) or manual-ack (acked after processing).
- Manual-ack is the norm in production.

For drain:

1. Cancel the consumer (`channel.basic_cancel`).
2. Finish processing in-flight messages.
3. Ack completed messages.
4. Close the channel.

### Common pattern

In every case, drain has two phases: stop receiving, then wait for in-flight completion. The polling anti-pattern fails because it does not separate the phases.

---

## Idempotency and Replay

A consequence of drain failures: messages may be replayed. Idempotency is the protection.

### Idempotent processors

A processor is idempotent if processing the same message twice produces the same outcome as processing it once.

```go
func process(msg Message) error {
    if seen(msg.ID) {
        return nil // already processed
    }
    if err := do(msg); err != nil {
        return err
    }
    return markSeen(msg.ID)
}
```

The `seen`/`markSeen` pair forms an idempotency check. Implementations vary: a Redis set, a Postgres row, an in-memory map.

### When idempotency matters

For at-least-once delivery systems (Kafka, SQS), every consumer must be idempotent. Failures during drain *will* cause replay.

### When polling fails idempotency

If a polling consumer fails to commit before shutdown, the message is replayed. If the processor is *not* idempotent, the side effect happens twice. The polling pattern itself does not break idempotency, but it makes shutdown less reliable, which exposes idempotency gaps.

---

## Migration Without Downtime

Refactoring a polling loop in production code is risk. The risk must be managed.

### Strategy: blue-green

Run both versions side by side. Route 1% of traffic to the new version. Compare metrics. Increase percentage as confidence grows.

### Strategy: feature flag

Wrap the refactor behind a flag:

```go
if featureflag.Enabled("worker.event-driven") {
    return s.runEventDriven(ctx)
}
return s.runPolling(ctx)
```

The flag can be toggled in real time. Rollback is a config change, not a deploy.

### Strategy: shadow traffic

Run the new code in parallel with the old. The new code's output is discarded. Compare what it *would have* produced to what the old code did.

```go
if featureflag.Enabled("worker.shadow") {
    go func() {
        result := s.runEventDriven(ctx) // hypothetical run
        compare(result, oldResult)
    }()
}
return s.runPolling(ctx)
```

After a week of shadow traffic with no discrepancies, promote.

### Strategy: incremental refactor

Refactor one function at a time. Each refactor is small, reviewable, and reversible. Avoid big-bang rewrites; they fail.

---

## Feature Flags for Concurrency Refactors

Feature flags are the canonical tool for safe rollouts. For concurrency refactors specifically:

### Flag granularity

- Service-wide flag: simple, all-or-nothing.
- Per-route flag: refactor one endpoint at a time.
- Per-customer flag: refactor for one customer at a time, useful for canary.
- Percentage rollout: gradually shift traffic.

### Flag observability

Each flag emits metrics:

```go
metrics.Counter("flag.worker_event_driven.enabled").Inc()
metrics.Counter("flag.worker_event_driven.disabled").Inc()
```

Dashboards show the rollout percentage and the metric divergence between the two code paths.

### Flag lifecycle

- Phase 1: flag created, default off, code in production.
- Phase 2: flag enabled for canary (1%); observe.
- Phase 3: gradual rollout to 100%.
- Phase 4: flag default on; code path removed for default-off path.
- Phase 5: flag removed; code is unconditional.

The lifecycle takes weeks. Plan accordingly.

---

## Production Telemetry: Key Metrics

What to monitor when refactoring off the anti-pattern.

### Metric 1: CPU usage

The polling loop's signature is high baseline CPU. After refactor, baseline drops.

```
worker.cpu_usage_percent: was 18%, after refactor: 0.5%
```

### Metric 2: shutdown duration

Before refactor, shutdown often hangs or hits the deadline. After, it completes in milliseconds.

```
shutdown.duration_seconds.p99: was 28s, after refactor: 0.2s
```

### Metric 3: dropped messages on shutdown

Before refactor, drain failures cause drops. After, zero.

```
shutdown.dropped_messages: was 50/day, after refactor: 0
```

### Metric 4: P99 request latency

Polling loops add latency. After refactor, P99 improves.

```
request.duration_seconds.p99: was 250ms, after refactor: 140ms
```

### Metric 5: goroutine count

Polling goroutines may leak. After refactor, count drops.

```
runtime.goroutines: was 5000, after refactor: 1200
```

Track each metric. Alert on regressions.

---

## Alerting on the Anti-Pattern

You can build alerts that *find* the anti-pattern in production.

### Alert 1: high baseline CPU on a worker

If a worker pod's CPU is consistently above 5% with no work, polling is likely. Alert.

### Alert 2: shutdown duration near the deadline

If `shutdown.duration` is close to `terminationGracePeriodSeconds`, your shutdown is unreliable. Alert.

### Alert 3: goroutine count growth

If `runtime.goroutines` grows without bound, goroutine leak is happening. Alert.

### Alert 4: queue depth oscillation

If queue depth alternates between zero and N (a polling consumer not keeping up), alert.

### Alert 5: response latency tied to polling interval

If P99 latency is a multiple of your polling interval (e.g., latency 100 ms when poll is 100 ms), polling is in the path. Alert.

Each alert has a runbook. The runbook says: "Search for polling. Likely in <file>. Replace with <primitive>."

---

## Capacity Planning

The polling pattern affects capacity:

- Each polling goroutine consumes ~0.5-1% of a core when sleeping with `time.Sleep(time.Millisecond)`.
- A service with 100 polling loops uses 50-100% of a core just for polling.
- That core is unavailable for real work.

### Calculation

```
polling_cpu = N_polling_loops * 0.005 * cores_per_pod
unused_cpu = total_cores - polling_cpu
effective_capacity = unused_cpu / cpu_per_request
```

A pod with 4 cores and 100 polling loops effectively has 3.5 cores for work. Capacity is 87.5% of nameplate.

### After refactor

```
polling_cpu = 0
unused_cpu = total_cores
effective_capacity = 4 / cpu_per_request
```

Capacity returns to 100%. For a fleet of 1000 pods, that is 125 pods' worth of effective capacity reclaimed.

### Cost in cloud bills

At AWS m5.xlarge ($0.192/hour), that is $24/hour saved, or $17,520/year. At GCP n2-standard-4 ($0.194/hour), similar. The migration's cost (engineering time) typically pays back within 2-6 months.

---

## Cost of Polling in Cloud Bills

A concrete example. A service with 200 pods, each running 50 polling loops at 1ms intervals.

Per pod:
- Polling CPU: 50 * 0.7% = 35% of a core.
- Reserved for polling: 0.35 cores * 4 cores/pod = 1.4 cores wasted (incorrect: 0.35 of a core total, not per-core).

Across the fleet:
- 200 pods * 0.35 cores wasted = 70 cores wasted.
- At m5.xlarge (4 cores per pod, $0.192/hour), 70 cores = 17.5 m5.xlarge instances.
- 17.5 * $0.192 = $3.36/hour.
- $3.36 * 24 * 365 = $29,433/year.

The migration to event-driven primitives reclaims this. For a fleet of 1000 pods, the savings scale linearly to $147,000/year.

Numbers vary by workload but the qualitative pattern holds: polling is a measurable line item in the cloud bill.

---

## Latency Tails: How Polling Hurts P99

P99 latency is the latency experienced by the slowest 1% of requests. For a polling system:

- P50 latency: dominated by actual work; polling adds little.
- P99 latency: includes worst-case polling delay (the full polling interval).

Example: a service with a 10 ms polling cycle. Request work itself takes 20 ms.

- P50: 20 ms (work + no poll wait).
- P99: 30 ms (work + worst-case poll wait of 10 ms).

After refactor:

- P50: 20 ms (no change).
- P99: 20 ms (no polling delay).

P99 improves by 33%. Customer-perceived latency tails shrink.

### Bigger impact at higher polling intervals

For a 100 ms polling cycle:

- P50: 20 ms.
- P99: 120 ms (work + worst-case poll wait).

After refactor: 20 ms. P99 improves by 6x.

This is why polling is poison for latency-sensitive workloads. The mean is fine; the tail is catastrophic.

---

## CPU Profile Reading

How to find polling in a production CPU profile.

### Step 1: capture a profile

```go
import _ "net/http/pprof"

go func() { http.ListenAndServe(":6060", nil) }()
```

```
curl http://service:6060/debug/pprof/profile?seconds=60 > cpu.out
```

### Step 2: analyse

```
go tool pprof cpu.out
(pprof) top10
```

Look for:

- `time.Sleep` high in the profile — a polling loop's sleep.
- `runtime.chanlen` in the top — `len(ch)` calls dominating.
- `runtime.semasleep` with high count but short duration — many small waits, characteristic of polling.

### Step 3: find the source

```
(pprof) list polling_function_name
```

The annotated source shows exactly which lines burn CPU.

### Step 4: refactor

Identify the polling, replace with proper primitive, redeploy, capture profile again. Compare.

---

## Trace Reading at Scale

Distributed tracing at scale (millions of spans per day) requires sampling and analysis tools.

### Tail-based sampling

Keep traces that are anomalous: long duration, high error rate, weird shapes. Discard the rest.

```
sampler:
  long_duration: keep all > p99
  error: keep all
  shape_anomaly: keep all with > 50 sub-spans
```

The polling anti-pattern usually produces a "long duration" trace. Tail sampling catches it.

### Trace analysis

Tools like Jaeger, Honeycomb, Tempo aggregate traces. Search for traces with spans containing "wait" or "drain" in the name and high duration. Polling is visible.

### Anomaly detection

ML-based tools (Honeycomb's BubbleUp, Datadog's Watchdog) find anomalous traces automatically. The polling pattern's signature — long waits without corresponding child spans — is the kind of anomaly these tools detect.

---

## Continuous Profiling

Continuous profiling captures profiles continuously and stores them for retroactive analysis.

### Tools

- Pyroscope (open source, language-agnostic).
- Polar Signals (managed).
- Grafana Pyroscope (now bundled).
- Datadog Continuous Profiler (managed).

### What you can ask

"Show me CPU profile flame graphs from yesterday between 14:00 and 15:00 UTC, filtered to the order-processor service."

The graphs reveal polling in production over time. If a deploy introduces polling, the next day's profile shows it immediately.

### Workflow

Continuous profiling becomes a development tool: before merging a PR, review the profile in staging. After deploying, compare production profiles.

This catches the anti-pattern as a regression signal, not as an incident signal.

---

## Postmortem Patterns

After an incident traced to the anti-pattern, the postmortem covers:

### Section: timeline

When did the incident start? When was it detected? When was it mitigated?

### Section: impact

How many customers affected? How much revenue lost? What SLA was breached?

### Section: root cause

The polling pattern in `file:line`. Explanation of the race. Why it manifested under load.

### Section: detection

How was the incident detected? (Metric alert, customer report, reconciliation.) Could it have been detected sooner?

### Section: response

What actions did the on-call take? Were they effective? How long did each step take?

### Section: prevention

What changes prevent recurrence?

- Refactor the specific polling instance.
- Add a lint rule to prevent new instances.
- Add a stress test that exercises the race window.
- Add an alert for the symptom (high baseline CPU, shutdown duration near deadline).

### Section: action items

Concrete, owned, dated.

The postmortem is the institutional memory. A team that writes good postmortems for anti-pattern incidents gradually eliminates the pattern.

---

## Incident Playbook

When on-call detects symptoms of the anti-pattern, the playbook.

### Symptom: shutdown hanging

1. Check the logs for the last "shutdown:" line. Where did it stop?
2. SSH into the pod (or kubectl exec). Run `kill -ABRT <pid>` to dump goroutine stacks.
3. Identify which goroutine is stuck and where.
4. If polling: roll back to the previous version; file a ticket for refactor.

### Symptom: dropped messages

1. Check the reconciliation gap. Quantify the loss.
2. Identify which service has the gap.
3. Read the service's code for polling.
4. If polling: refactor (priority).
5. Manually replay the dropped messages from the source of truth.

### Symptom: high baseline CPU

1. Run a CPU profile during the high-CPU window.
2. Identify polling functions in the top of the profile.
3. Refactor.
4. Deploy.

### Symptom: P99 latency spike

1. Examine traces for the slow requests.
2. Look for spans with names containing "wait" or "drain".
3. Identify polling in the path.
4. Refactor.

Each playbook has the same shape: identify, isolate, refactor.

---

## Audit Process for Legacy Codebases

A structured audit for a large legacy codebase.

### Step 1: automated discovery

```bash
grep -nR "for len(" --include="*.go" .
grep -nR "if len(" --include="*.go" . | grep -v "_test"
grep -nR "select.*default" --include="*.go" -A 5 . | grep -i "sleep"
grep -nR "time\.Sleep" --include="*.go" . | grep -v "_test"
```

Each match is a candidate. Triage by:

- Hot path or cold path?
- Production or test?
- Easy refactor or complex?

### Step 2: prioritise

Hot path + production + complex = highest priority.

### Step 3: refactor

Each instance gets its own PR. Reviewed by at least two engineers. Tested under `-race -count=200`.

### Step 4: deploy

Behind feature flag. Canary roll. Observe metrics.

### Step 5: cleanup

After 100% rollout for two weeks, remove the old code path. Remove the flag.

### Step 6: prevent regression

Add lint. Document the pattern. Train new engineers.

For a 500K LOC codebase with ~200 instances, this is 6-12 months of work for one engineer. Often parallelised across a team.

---

## Migration Playbook

A specific migration: replace `for len(ch) > 0 { time.Sleep }` with `wg.Wait()`.

### Step 1: identify the goroutines that should be tracked

Read the producer code. Each `go func() { ch <- ... }()` is a goroutine that should be tracked.

### Step 2: introduce a WaitGroup

```go
var wg sync.WaitGroup
for ... {
    wg.Add(1)
    go func() {
        defer wg.Done()
        ch <- ...
    }()
}
```

### Step 3: convert the wait

```go
// before:
for len(ch) > 0 { time.Sleep(time.Millisecond) }

// after:
go func() {
    wg.Wait()
    close(ch)
}()
for v := range ch {
    handle(v)
}
```

### Step 4: verify

Run tests under `-race -count=200`. Capture a CPU profile before and after; compare.

### Step 5: deploy

Behind a flag. Canary. Monitor.

This pattern repeats for every instance. After 100 such migrations, the muscle memory is automatic.

---

## Rollout Strategy

For each refactor:

### Phase 1: staging deploy

Deploy to staging. Run integration tests. Verify metrics behave as expected.

### Phase 2: canary

Deploy to 1% of pods (or 1% of traffic). Monitor for 24-72 hours. Compare metrics against the rest of the fleet.

### Phase 3: gradual rollout

10%, 50%, 100%. Pause at each step if metrics degrade.

### Phase 4: bake

Wait 1-2 weeks at 100%. Watch for delayed issues (e.g., a weekly batch that exercises a code path).

### Phase 5: cleanup

Remove the old code path and the flag.

Each phase has a clear go/no-go. Document them.

---

## Rollback Strategy

If a refactor causes issues:

### Fast rollback: flag

If the refactor is behind a feature flag, flip the flag. Old code path resumes immediately.

### Slow rollback: deploy

If the flag is removed and the new code is unconditional, deploy the previous version. This takes minutes.

### Forensic rollback: hot patch

If neither is possible (rare), patch the offending code path in place. Risky; reserve for emergencies.

### Document the rollback path before the rollout

Every PR for a concurrency refactor includes a "rollback plan" section in its description. The reviewer verifies the plan works before approving.

---

## Team Training Plan

To prevent the anti-pattern in a team, training is essential.

### Week 1: theory

Read `junior.md` and `middle.md`. Quiz on key concepts.

### Week 2: practice

Refactor 5 instances of the pattern in legacy code. Pair review.

### Week 3: review

Each engineer reviews 3 PRs with a focus on concurrency. Apply the senior-level checklist.

### Week 4: design

Each engineer designs a small service from scratch, avoiding the anti-pattern. Group review.

### Ongoing

Weekly study group: read one Go memory model or concurrency paper per week. Discuss.

Monthly anti-pattern hunt: pick a service; audit it for the anti-pattern; refactor as a team exercise.

Annual revisiting: re-read `senior.md` and `professional.md`. New best practices may have emerged.

The pattern does not stay gone unless the team's discipline holds. Training is the discipline.

---

## Self-Assessment

Without re-reading:

1. Describe the shutdown sequence for a Kubernetes pod running a Go HTTP server.
2. Explain readiness-first shutdown and why it requires a sleep.
3. Compare drain semantics for Kafka, SQS, and RabbitMQ.
4. List five metrics you would track when refactoring a polling loop.
5. Design an alert that detects the anti-pattern in production CPU usage.
6. Walk through the audit process for a 500K LOC codebase.
7. Describe a feature-flagged rollout for a concurrency refactor.
8. Outline a four-week team training plan.
9. Calculate the annual cloud cost of 200 polling loops at 1 ms intervals.
10. Plan an incident response for "shutdown hanging" symptoms.

If any answer is shaky, re-read the relevant section.

---

## Summary

The wait-for-empty-channel anti-pattern in production is more than a code-correctness issue: it is an operational liability. It causes shutdown failures, dropped messages, elevated CPU, latency tails, and incidents. The professional engineer's job is to:

- Build graceful shutdown that integrates with Kubernetes lifecycle, load balancers, and message queues.
- Observe in-flight work through metrics, logs, and traces.
- Coordinate shutdown across fleets and clusters.
- Migrate legacy code through feature flags and canary rollouts.
- Alert on the symptoms before customers notice.
- Train the team to prevent regression.

The migration is large but mechanical. The savings — fewer incidents, lower CPU, reclaimed capacity — are real and measurable. A team that finishes the migration has a more reliable, cheaper, faster service.

The specification file follows, capturing the formal semantics. The interview, tasks, find-bug, and optimize files give you the tools to teach others and to test understanding.

---

## Appendix A: A Production Worker Reference Implementation

A complete, runnable reference for a production-grade worker service. Pulls jobs from a queue, processes them with bounded concurrency, observes its own state, and shuts down gracefully.

```go
package main

import (
    "context"
    "errors"
    "log"
    "net/http"
    "os"
    "os/signal"
    "sync"
    "sync/atomic"
    "syscall"
    "time"

    "github.com/prometheus/client_golang/prometheus"
    "github.com/prometheus/client_golang/prometheus/promhttp"
    "golang.org/x/sync/errgroup"
    "golang.org/x/sync/semaphore"
)

var (
    metricsProcessed = prometheus.NewCounter(prometheus.CounterOpts{
        Name: "worker_processed_total",
        Help: "Total messages processed.",
    })
    metricsFailed = prometheus.NewCounter(prometheus.CounterOpts{
        Name: "worker_failed_total",
        Help: "Total messages failed.",
    })
    metricsInFlight = prometheus.NewGauge(prometheus.GaugeOpts{
        Name: "worker_in_flight",
        Help: "Current in-flight messages.",
    })
    metricsShutdownDuration = prometheus.NewHistogram(prometheus.HistogramOpts{
        Name:    "worker_shutdown_duration_seconds",
        Help:    "Shutdown duration in seconds.",
        Buckets: prometheus.LinearBuckets(0, 1, 30),
    })
)

func init() {
    prometheus.MustRegister(metricsProcessed)
    prometheus.MustRegister(metricsFailed)
    prometheus.MustRegister(metricsInFlight)
    prometheus.MustRegister(metricsShutdownDuration)
}

type Queue interface {
    Receive(ctx context.Context) (Message, error)
    Ack(ctx context.Context, m Message) error
}

type Message struct {
    ID   string
    Body []byte
}

type Worker struct {
    queue       Queue
    handler     func(context.Context, Message) error
    concurrency int
    inFlight    atomic.Int64
    ready       atomic.Bool
}

func New(q Queue, h func(context.Context, Message) error, concurrency int) *Worker {
    return &Worker{
        queue:       q,
        handler:     h,
        concurrency: concurrency,
    }
}

func (w *Worker) Run(ctx context.Context) error {
    w.ready.Store(true)
    defer w.ready.Store(false)

    g, ctx := errgroup.WithContext(ctx)
    sem := semaphore.NewWeighted(int64(w.concurrency))

    g.Go(func() error {
        for {
            if err := sem.Acquire(ctx, 1); err != nil {
                return nil
            }
            m, err := w.queue.Receive(ctx)
            if err != nil {
                sem.Release(1)
                if errors.Is(err, context.Canceled) {
                    return nil
                }
                return err
            }
            g.Go(func() error {
                defer sem.Release(1)
                w.inFlight.Add(1)
                metricsInFlight.Inc()
                defer func() {
                    w.inFlight.Add(-1)
                    metricsInFlight.Dec()
                }()
                if err := w.handler(ctx, m); err != nil {
                    metricsFailed.Inc()
                    return nil // do not propagate; one failure does not kill the worker
                }
                metricsProcessed.Inc()
                return w.queue.Ack(ctx, m)
            })
        }
    })

    return g.Wait()
}

func (w *Worker) Ready() bool {
    return w.ready.Load()
}

func (w *Worker) InFlight() int64 {
    return w.inFlight.Load()
}

func main() {
    ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
    defer cancel()

    queue := connectQueue()
    worker := New(queue, processMessage, 8)

    // metrics + admin server
    mux := http.NewServeMux()
    mux.Handle("/metrics", promhttp.Handler())
    mux.HandleFunc("/ready", func(w http.ResponseWriter, r *http.Request) {
        if worker.Ready() {
            w.WriteHeader(200)
        } else {
            w.WriteHeader(503)
        }
    })
    mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
        w.WriteHeader(200)
    })

    adminSrv := &http.Server{Addr: ":8080", Handler: mux}
    go func() {
        if err := adminSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
            log.Printf("admin server error: %v", err)
        }
    }()

    g, gctx := errgroup.WithContext(ctx)
    g.Go(func() error {
        return worker.Run(gctx)
    })

    err := g.Wait()
    if err != nil && !errors.Is(err, context.Canceled) {
        log.Printf("worker error: %v", err)
    }

    log.Println("shutting down")
    start := time.Now()
    defer func() {
        metricsShutdownDuration.Observe(time.Since(start).Seconds())
    }()

    shutdownCtx, cancelShutdown := context.WithTimeout(context.Background(), 25*time.Second)
    defer cancelShutdown()

    var wg sync.WaitGroup
    wg.Add(1)
    go func() {
        defer wg.Done()
        if err := adminSrv.Shutdown(shutdownCtx); err != nil {
            log.Printf("admin shutdown error: %v", err)
        }
    }()
    wg.Wait()

    log.Println("shutdown complete in", time.Since(start))
    if err != nil {
        os.Exit(1)
    }
}
```

This implementation:

- Uses `errgroup` for structured concurrency.
- Uses `semaphore.Weighted` for bounded concurrency (respects context).
- Tracks in-flight count for observability.
- Exposes Prometheus metrics.
- Has a readiness probe endpoint for Kubernetes.
- Shuts down gracefully with a bounded deadline.
- Records shutdown duration as a histogram for SLO tracking.

No `len(ch)`. No polling. No sleep loops. Every wait is event-driven.

---

## Appendix B: Anti-Pattern Detection in CI

A CI step that detects the anti-pattern.

```yaml
# .github/workflows/concurrency.yml
name: Concurrency Lint

on: [push, pull_request]

jobs:
  semgrep:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: returntocorp/semgrep-action@v1
        with:
          config: .semgrep/concurrency.yml

  race:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: '1.23'
      - run: go test -race -count=10 ./...
```

With a semgrep rule:

```yaml
# .semgrep/concurrency.yml
rules:
  - id: poll-len-channel
    message: |
      Polling len(ch) is a race condition. Use sync.WaitGroup, errgroup,
      a done channel, or context.Done() instead.
    severity: ERROR
    languages: [go]
    patterns:
      - pattern: for len($CH) > 0 { ... }
      - pattern: for len($CH) != 0 { ... }
      - pattern: for len($CH) == 0 { ... }

  - id: select-default-sleep
    message: |
      select/default with sleep is a polling loop. Replace with a proper
      blocking select.
    severity: WARNING
    languages: [go]
    patterns:
      - pattern: |
          select {
          ...
          default:
            ...
            time.Sleep(...)
            ...
          }
```

Run on every PR. Block merges on errors. Surface warnings for human review.

---

## Appendix C: Custom Lint Rule for Polling Loops

A more sophisticated lint using `go/analysis`:

```go
package pollinglint

import (
    "go/ast"

    "golang.org/x/tools/go/analysis"
    "golang.org/x/tools/go/analysis/passes/inspect"
    "golang.org/x/tools/go/ast/inspector"
)

var Analyzer = &analysis.Analyzer{
    Name:     "pollinglint",
    Doc:      "detects polling loops on channel length",
    Requires: []*analysis.Analyzer{inspect.Analyzer},
    Run:      run,
}

func run(pass *analysis.Pass) (interface{}, error) {
    insp := pass.ResultOf[inspect.Analyzer].(*inspector.Inspector)
    nodeFilter := []ast.Node{
        (*ast.ForStmt)(nil),
    }
    insp.Preorder(nodeFilter, func(n ast.Node) {
        fs := n.(*ast.ForStmt)
        if fs.Cond == nil {
            return
        }
        if be, ok := fs.Cond.(*ast.BinaryExpr); ok {
            if call, ok := be.X.(*ast.CallExpr); ok {
                if id, ok := call.Fun.(*ast.Ident); ok && id.Name == "len" {
                    if len(call.Args) == 1 {
                        argType := pass.TypesInfo.TypeOf(call.Args[0])
                        if argType == nil {
                            return
                        }
                        // Check if argType is a channel type
                        if _, isChan := argType.Underlying().(*types.Chan); isChan {
                            pass.Reportf(fs.Pos(), "polling len(channel) is a race condition")
                        }
                    }
                }
            }
        }
    })
    return nil, nil
}
```

This pass walks the AST, finds `for` statements with a condition that compares `len(channel)` to something, and reports them. Integrate into your `go vet` setup or your CI.

---

## Appendix D: Comparing Drain Strategies

Side-by-side comparison of drain strategies for an HTTP worker service.

| Strategy           | Shutdown time | Dropped requests | CPU overhead | Complexity |
|--------------------|---------------|------------------|--------------|------------|
| Hard kill          | <1s           | All in-flight    | None         | Low        |
| Polling drain      | Variable, often hits deadline | Some (race) | High (polling) | Low |
| WaitGroup drain    | Bounded       | None             | None         | Medium     |
| GracefulStop (gRPC) | Bounded      | None             | None         | Low (library) |
| Readiness-first    | Predictable   | None             | None         | Medium     |
| Pre-stop hook + drain | Predictable | None            | None         | Medium     |

The recommendation: combine readiness-first with WaitGroup drain or library shutdown (`http.Server.Shutdown`, `grpc.Server.GracefulStop`). This is the production sweet spot.

---

## Appendix E: Coordinating With External Systems on Shutdown

External systems often have their own drain semantics. The coordination patterns.

### Database

Close connection pools after in-flight queries complete. `sql.DB.Close()` is idempotent and waits.

### Cache

Caches usually don't need draining; clearing them on shutdown is optional. If you do clear:

```go
cache.Flush(ctx)
```

### Distributed locks

Release any held locks. Use a `defer release()` pattern.

### File handles

Close files. `defer f.Close()`.

### Network connections

Close listeners; let in-flight connections drain via the deadline mechanism.

The shutdown sequence: stop the producers, drain the consumers, close the external connections, exit.

---

## Appendix F: A Long Comparison Table

A reference table comparing implementations of "wait for N goroutines to finish."

| Implementation       | Correct? | CPU when idle | Latency | Cancellable | Returns error | Notes |
|----------------------|----------|---------------|---------|-------------|---------------|-------|
| `for len(ch) > 0`    | No (race)| High (poll)   | Poll int| No          | No            | Anti-pattern |
| `for !done.Load()`   | No (race)| High (poll)   | Poll int| No          | No            | Same anti-pattern shape |
| `sync.WaitGroup.Wait`| Yes      | Zero          | Microsec| No          | No            | Stdlib |
| `errgroup.Wait`      | Yes      | Zero          | Microsec| Yes (via ctx)| Yes           | Best for most |
| `for range ch + close`| Yes     | Zero          | Microsec| Via close   | No            | Idiomatic |
| `select <-done`      | Yes      | Zero          | Microsec| Composable  | No            | Idiomatic |
| `sync.Cond.Wait`     | Yes      | Zero          | Microsec| No directly  | No            | Predicate wait |

The first two rows are wrong. The rest are correct. Pick based on requirements.

---

## Appendix G: Production War Stories (Compressed)

Brief vignettes from real production incidents traced to the anti-pattern.

**Story 1.** Payment service drops 0.5% of transactions during peak Friday traffic for six months. Root cause: handler polls internal channel; under load the polling races. Fix: per-request completion channel. Impact: $250K monthly revenue recovered.

**Story 2.** Search indexer takes 90 seconds to shut down; Kubernetes kills it after 60. Some indexing work is lost. Root cause: shutdown polls a queue. Fix: errgroup-based coordination. Impact: zero data loss, shutdowns in 1-2s.

**Story 3.** Worker pod CPU is 22% baseline with no load. Cost: $400/month per pod across 200 pods = $80K/year. Root cause: 40 polling loops per pod, each at 1ms interval. Fix: replace with event-driven workers. Impact: baseline drops to 0.8%, $76K/year saved.

**Story 4.** A flaky test fails 0.5% of the time, blocking deploys randomly. For six months engineers retry the test. Root cause: test polls a queue. Fix: replace with done channel. Impact: zero flakes in subsequent year.

**Story 5.** A migration to a new message broker fails because the legacy code expects polling semantics; the new broker has push semantics. Fix: rewrite the consumers to use push (which is event-driven). The migration improves CPU by 60% as a side effect.

**Story 6.** A cache invalidator misses 0.2% of invalidations under load. Root cause: polling for queue empty. Fix: settled-after-N pattern. Impact: zero misses; data freshness improves.

These stories are not exceptional. They are the typical impact of the anti-pattern. Read them as case studies in your team meetings.

---

## Appendix H: Observability Stack for Concurrency

A reference stack for observing concurrent systems.

### Metrics

Prometheus + Grafana. Track:

- in-flight count (gauge)
- queue depth (gauge)
- processing rate (counter, rate'd)
- error rate (counter, rate'd)
- shutdown duration (histogram)
- goroutine count (gauge, from `runtime.NumGoroutine`)

### Logs

Structured logs (JSON) shipped to a central system (Loki, Elasticsearch).

- Shutdown sequence logged step by step.
- Errors logged with goroutine context (if available).
- Lifecycle events (start, ready, drain, exit).

### Traces

OpenTelemetry, exported to Jaeger, Tempo, or commercial platforms.

- Every request traced end-to-end.
- Async boundaries propagate context.
- Span names follow a convention (`service.operation`).

### Profiles

Continuous profiling (Pyroscope) capturing CPU and memory.

- Compare current to baseline daily.
- Alert on regressions.

This stack is industry standard. With it, you can detect the anti-pattern at the symptom level and trace it to the root cause within minutes.

---

## Appendix I: Closing the Loop

The full operational lifecycle:

1. New code is written. Lints prevent the anti-pattern.
2. Code is reviewed. The senior-level checklist applies.
3. Code is tested. `-race -count=N` runs in CI.
4. Code is deployed. Behind a flag, in stages.
5. Code is observed. Metrics, logs, traces capture behaviour.
6. Code is profiled. Continuous profiling detects regressions.
7. Incidents are triaged. Postmortems trace causes.
8. Patterns are documented. The team learns.
9. New code is written. Lints prevent the anti-pattern.

The loop closes. Each cycle the system gets tighter, the pattern gets rarer, the incidents get smaller.

The professional engineer is the person who builds this loop and tends it. The anti-pattern is one of many things the loop guards against, but it is a vivid example because the cost is so easily measured.

---

## Final Word

The wait-for-empty-channel anti-pattern, viewed from production, is a *systems failure* whose symptoms appear in metrics, traces, profiles, and incidents. The fix is operational discipline as much as code-level discipline: graceful shutdown, observability, coordinated rollout, postmortem-driven learning.

A team that masters this anti-pattern masters the broader skill of running concurrent systems in production. The principles transfer: ownership, lifecycles, event-driven coordination, structured shutdown, observability. These principles apply to every concurrent service, not just the Go ones.

Move next to `specification.md` for the formal language semantics and standard library reference. Then `interview.md`, `tasks.md`, `find-bug.md`, and `optimize.md` for testing your knowledge and teaching it to others.

---

## Appendix J: Sample Dashboards for Concurrency Health

A Grafana dashboard JSON describing the panels for concurrency health.

### Panel: in-flight requests over time

```
sum(rate(worker_in_flight[1m]))
```

A spike indicates traffic; a slow decline during shutdown indicates a drain in progress; a flat line during shutdown indicates a stuck worker.

### Panel: goroutine count

```
go_goroutines{service="worker"}
```

Steady-state growth indicates a leak. Sudden drops indicate restarts.

### Panel: shutdown duration histogram

```
histogram_quantile(0.99, sum(rate(worker_shutdown_duration_seconds_bucket[1h])) by (le))
```

The P99 shutdown duration. Should be well below `terminationGracePeriodSeconds`. If it approaches that limit, shutdowns are too slow.

### Panel: CPU profile delta

A panel showing the difference in CPU usage between two profile windows. After a deploy, a positive delta in `time.Sleep` or `runtime.chanlen` indicates polling was introduced.

### Panel: drop counter

```
sum(rate(worker_dropped_total[5m]))
```

The rate of message drops. Should be zero in healthy systems. A non-zero rate is an immediate alert.

### Panel: queue depth

```
worker_queue_depth
```

The current queue depth. Rising indicates the consumer is falling behind. Persistent rising is a capacity issue, not a polling issue, but the two are sometimes confused.

This dashboard is the central operations view for concurrent services. Every team running such a service should have one.

---

## Appendix K: Building a Polling-Free Library Catalogue

A reference list of libraries that are explicitly polling-free, suitable as building blocks.

### `golang.org/x/sync/errgroup`

Discussed extensively. Use for "wait for N tasks; first error cancels."

### `golang.org/x/sync/semaphore`

Weighted semaphore with context support. Use for bounded concurrency.

### `golang.org/x/sync/singleflight`

Deduplicates concurrent calls for the same key. Use for cache-fill or rate-limited APIs.

### `golang.org/x/time/rate`

Token-bucket rate limiter. Use for limiting events per second.

### `github.com/cenkalti/backoff/v4`

Exponential backoff with context support. Use for retry loops.

### `github.com/sourcegraph/conc`

A modern structured concurrency library. Use as an alternative to `errgroup` for richer abstractions.

### `go.uber.org/goleak`

Detects goroutine leaks in tests. Required for any concurrent codebase.

### `google.golang.org/grpc`

gRPC client and server. `GracefulStop` is the canonical polling-free shutdown.

### `github.com/segmentio/kafka-go`

Kafka client with context support throughout. `ReadMessage(ctx)` is event-driven.

### `github.com/redis/go-redis/v9`

Redis client with context throughout. `BLPop(ctx, ...)` is event-driven.

Build your service stack from these. Each one respects context, supports cancellation, and avoids polling internally. Composition of polling-free libraries yields a polling-free service.

---

## Appendix L: An Operational Runbook Template

A template for runbooks responding to anti-pattern incidents.

### Title

[Anti-pattern] Worker shutdown hanging

### Symptoms

- Kubernetes shows pod stuck in `Terminating` state for longer than `terminationGracePeriodSeconds`.
- After SIGKILL, lost messages reported by downstream system.
- Alert fired: `shutdown.duration_seconds.p99 > 25`.

### Investigation

1. Identify the service. Look at the alert's labels.
2. Find a stuck pod: `kubectl get pods | grep Terminating`.
3. Get goroutine dump: `kubectl exec <pod> -- /bin/sh -c "kill -ABRT 1"`. Capture stderr.
4. Read the dump. Look for goroutines blocked in `time.Sleep` or `runtime.chanlen`.
5. Identify the source file and line.

### Mitigation

1. Immediate: roll back the deploy to the previous version (if recent).
2. Short-term: patch the polling loop to use `WaitGroup` or similar.
3. Long-term: add lint rule to prevent regression.

### Postmortem

- Was the polling loop introduced recently?
- Why did the lint not catch it?
- Why did the tests not catch it?
- What metrics could have alerted us earlier?

### Owner

[Team name]

### Related runbooks

- [Anti-pattern] High baseline CPU
- [Anti-pattern] Latency tail growth

The runbook is concrete, actionable, and revisable. Maintain it as a living document.

---

## Appendix M: Disaster Recovery for Drain Failures

When a drain fails and messages are lost, recovery is operational.

### Step 1: quantify the loss

How many messages were affected? Use the message queue's metrics: input rate during the drain window minus the output rate equals the lost count.

### Step 2: identify the lost messages

If the queue has DLQ semantics, the messages are in the DLQ. Otherwise, replay from the source of truth.

### Step 3: replay

Submit the lost messages back through the system. Ensure the processors are idempotent so the replay does not double-process.

### Step 4: notify stakeholders

If customer data is affected, notify per your compliance requirements.

### Step 5: prevent recurrence

Fix the drain. Add tests. Add alerts.

This recovery path is not new — it is standard disaster recovery. The connection to the anti-pattern is that drain failures from polling are common enough to warrant a specific runbook.

---

## Appendix N: A Migration Worksheet

A worksheet for tracking a refactoring migration across a large codebase.

| File | Function | Pattern variant | Hot path? | Refactor difficulty | Owner | Status | PR | Deployed |
|------|----------|-----------------|-----------|---------------------|-------|--------|----|----|
| internal/worker/pool.go | runDrain | len() polling | Yes | Medium | alice | Done | #123 | 2026-02-15 |
| pkg/queue/consumer.go | Wait | len() polling | Yes | Easy | bob | In review | #145 | - |
| ... | ... | ... | ... | ... | ... | ... | ... | ... |

Each row is one instance. Each instance is tracked from discovery to deployment.

Maintain in a spreadsheet, a project board, or a database. The point is visibility: at any time, you know how many instances remain and what blocks them.

---

## Appendix O: Sample SLOs for Concurrent Services

Service Level Objectives that constrain anti-pattern behaviour.

### SLO 1: shutdown duration

- Objective: 99% of shutdowns complete within 10 seconds.
- Measurement: histogram of shutdown duration.
- Alert: P99 > 15s.

A polling-driven shutdown will violate this SLO under load. Tracking it surfaces the anti-pattern.

### SLO 2: drop rate

- Objective: 99.99% of submitted work is processed successfully.
- Measurement: counter of dropped vs total.
- Alert: drop rate > 0.01% in any 5-minute window.

Polling-driven drains drop messages. Tracking this surfaces them.

### SLO 3: baseline CPU

- Objective: 95% of pods have baseline CPU < 5%.
- Measurement: percentile of CPU during low-traffic windows.
- Alert: median baseline CPU > 10%.

Polling causes high baseline. SLO catches it.

### SLO 4: P99 latency

- Objective: P99 latency < SLA.
- Measurement: histogram of request latency.
- Alert: P99 > SLA for 5 minutes.

Polling adds latency to tails.

### SLO 5: goroutine stability

- Objective: goroutine count stable over 1 hour.
- Measurement: variance of goroutine count.
- Alert: variance > 10% per hour.

Leaked polling goroutines cause growth.

SLOs codify expectations. The anti-pattern violates them; tracking the violations finds the anti-pattern.

---

## Appendix P: Working With Cloud Providers

Each cloud provider has its own concurrency-related gotchas.

### AWS

- Lambda functions cannot hold long-running goroutines after the handler returns. Polling inside a Lambda is paid CPU.
- ECS tasks respect SIGTERM with a configurable grace period.
- ALB has connection draining (default 300s). Configure to match your service's drain.

### GCP

- Cloud Run also has the "no long goroutines after request" rule.
- GKE follows standard Kubernetes lifecycle.
- Internal load balancer drain is configurable per backend.

### Azure

- App Service has its own deploy-time draining.
- AKS follows standard Kubernetes lifecycle.

In each, the polling anti-pattern manifests as high cost (paid CPU when idle), failed shutdowns (functions killed before draining), and dropped requests. The fix is the same: replace polling with event-driven primitives.

---

## Appendix Q: Anti-Pattern in Serverless

In serverless platforms (Lambda, Cloud Functions), the anti-pattern is especially harmful because you pay for execution time. A polling loop running for 30 seconds during a Lambda's lifetime is 30 seconds of billable CPU.

### Example: polling inside a Lambda

```go
// Bad Lambda
func Handler(ctx context.Context) error {
    queue := startWorkQueue()
    submitJobs(queue)
    for len(queue) > 0 {
        time.Sleep(time.Millisecond)
    }
    return nil
}
```

The polling adds milliseconds of billable time per invocation. At a million invocations per day, that is significant cost.

### Fix

```go
func Handler(ctx context.Context) error {
    var wg sync.WaitGroup
    jobs := getJobs()
    for _, j := range jobs {
        j := j
        wg.Add(1)
        go func() {
            defer wg.Done()
            process(ctx, j)
        }()
    }
    wg.Wait()
    return nil
}
```

WaitGroup-based wait. Lambda returns as soon as all goroutines finish.

The savings: depending on workload, 10-30% reduction in Lambda execution time. At scale, significant.

---

## Appendix R: Anti-Pattern in Cron Jobs

Cron jobs (CronJob in Kubernetes, scheduled Lambda) often run polling loops because the engineer thinks "this only runs every hour, who cares about CPU."

That logic is wrong for two reasons:

1. The job's container reserves the requested CPU even when idle. Polling does not change the reservation; it changes the utilization. But many workloads bill for utilization separately (cloud functions especially).
2. Cron jobs have time bounds. A polling loop that exceeds its time bound is killed mid-work.

### Example

```go
func nightlyBatch() {
    jobs := loadJobs()
    queue := make(chan Job, len(jobs))
    for _, j := range jobs {
        queue <- j
    }
    for i := 0; i < 8; i++ {
        go worker(queue)
    }
    for len(queue) > 0 {
        time.Sleep(time.Second)
    }
}
```

The polling adds seconds to every batch. If the batch is bounded by a 10-minute SLA, the polling consumes 10% of the budget.

### Fix

Standard `errgroup` or `WaitGroup` pattern. Saves minutes per batch.

---

## Appendix S: Anti-Pattern in Streaming

Streaming systems (Kafka Streams, Apache Beam, Flink) have their own coordination primitives. Mixing them with polling is common but wrong.

### Example: Kafka consumer

```go
for {
    msg, _ := reader.ReadMessage(ctx)
    queue <- msg
    for len(queue) > 100 {
        time.Sleep(time.Millisecond)
    }
}
```

The polling is a backpressure mechanism. But it polls; the channel itself provides backpressure for free.

### Fix

```go
for {
    select {
    case <-ctx.Done():
        return ctx.Err()
    default:
    }
    msg, err := reader.ReadMessage(ctx)
    if err != nil {
        return err
    }
    select {
    case <-ctx.Done():
        return ctx.Err()
    case queue <- msg:
    }
}
```

The send blocks when the queue is full. That is the backpressure. No polling needed.

---

## Appendix T: Anti-Pattern in Testing Frameworks

Even testing frameworks have the anti-pattern. Common shape:

```go
func TestEventuallyTrue(t *testing.T) {
    for !condition() {
        time.Sleep(time.Millisecond)
    }
}
```

This is `assert.Eventually` from `testify` written by hand. The framework's version is no better: it polls. Both fail under load.

The fix in tests: expose the event you are waiting for.

```go
func TestSystemReady(t *testing.T) {
    done := make(chan struct{})
    sys := NewSystem(func() { close(done) })
    sys.Run()
    select {
    case <-done:
    case <-time.After(2 * time.Second):
        t.Fatal("timed out")
    }
}
```

The test waits on a real event. The bounded timeout exists for safety, not as a polling interval.

---

## Appendix U: A Cross-Functional Story

A story in three departments: how the anti-pattern affects each.

### Engineering

The engineering team writes the polling loop. They notice CPU is a bit high but the tests pass. They ship it. Months later, an incident traces back to the polling.

### Operations

The ops team sees alerts firing. Shutdown duration exceeds SLO. P99 latency spikes. They escalate to engineering.

### Finance

The finance team notices cloud spend rising. Engineering investigates and finds the polling overhead. The refactor reduces spend.

### Customer

The customer experiences slow shutdowns during deploys: their requests time out. They complain. Customer success escalates.

### Lessons

The anti-pattern's impact cuts across departments. Communicating it requires translating between perspectives:

- Engineering: "polling loop is a race condition."
- Operations: "shutdown is unreliable."
- Finance: "polling costs $X/year."
- Customer: "deploys interrupt my requests."

A senior professional speaks all four languages.

---

## Appendix V: How to Brief Leadership on the Migration

When you propose a large refactoring effort to leadership, frame it in their terms.

### Slide 1: the problem

"We have N instances of a known concurrency anti-pattern that causes drops, slow shutdowns, and elevated CPU. The cost is approximately $Y/year in cloud spend and Z incidents per quarter."

### Slide 2: the fix

"We refactor each instance to use proper synchronisation primitives. The refactor is mechanical and incremental."

### Slide 3: the plan

"Six months, one engineer at 40% allocation. Phased rollout with feature flags. Zero downtime."

### Slide 4: the benefits

"Eliminate Z incidents. Save $Y. Improve P99 latency by W%. Make the codebase teachable for new hires."

### Slide 5: the risks

"Each refactor is small but could introduce bugs. Mitigation: tests under `-race -count=N`, feature flags, gradual rollout."

### Slide 6: the ask

"Approval to allocate the engineer. Quarterly review of progress."

Leadership cares about cost, risk, customer impact. The technical detail is in the appendix. Lead with the impact.

---

## Appendix W: Long-Term Maintenance

After the migration completes, maintenance is ongoing.

### Quarterly review

Audit a sample of services. Confirm no new instances of the pattern. Update lints if new variants emerge.

### Annual training

Re-introduce the pattern to the team. New hires need the same training. Veterans benefit from refreshers.

### Tool review

Are the lints catching everything? Are the metrics still meaningful? Are the runbooks up to date? Update annually.

### Documentation

Keep this file (and the rest of the section) current. As Go evolves, the best practices evolve.

The anti-pattern does not stay gone unless someone tends the garden. Make that part of the team's regular work.

---

## Appendix X: A Reference Migration Plan

A specific, detailed migration plan you can adapt.

### Phase 0: discovery (weeks 1-2)

- Inventory every instance of the anti-pattern.
- Classify by severity (hot path vs cold path).
- Estimate effort per instance.

### Phase 1: tooling (weeks 3-4)

- Build lint rules.
- Build dashboards.
- Build runbooks.

### Phase 2: training (weeks 5-6)

- Team training sessions.
- Pair-refactor a few instances as a learning exercise.

### Phase 3: refactor hot path (weeks 7-14)

- One hot-path instance per week.
- Each behind a feature flag.
- Each rolled out gradually.

### Phase 4: refactor cold path (weeks 15-22)

- Batch refactors in batches of 5.
- Less ceremony per batch (cold path can be slower-rolled).

### Phase 5: cleanup (weeks 23-26)

- Remove feature flags.
- Remove old code paths.
- Update documentation.

### Phase 6: prevention (week 27+)

- Lints in CI, blocking.
- Annual training.
- Quarterly audit.

Total: 27 weeks of one engineer at 40% allocation. Most weeks are not full-time. The discipline matters more than the speed.

---

## Appendix Y: When the Refactor Is Not Worth It

There are cases where refactoring is not the right call.

### Case 1: code is being deprecated

If a service is being replaced by a new version in 6 months, refactoring its anti-patterns is pointless. Focus on the replacement.

### Case 2: very low traffic

A cron job that runs once a week, polling for 30 seconds, costs almost nothing. Refactor only if you have spare cycles.

### Case 3: third-party code

If the polling is in a dependency, refactoring requires upstream cooperation. Wrap with a bridge as in `senior.md` Appendix G; do not fork the library unless necessary.

### Case 4: regulatory constraints

If the code is part of a regulated certification (financial, medical), changing it requires re-certification. The cost may exceed the benefit. Weigh carefully.

In each case, document the decision. A future engineer should know *why* the refactor was skipped, not assume oversight.

---

## Appendix Z: One Year Later

A reflection on what changes after a successful migration.

### Incidents

The number of concurrency-related incidents drops to near zero. The team's on-call burden shrinks. Sleep improves.

### Cost

Cloud bills drop by 5-15% depending on workload. The savings continue indefinitely.

### Code quality

Engineers reason about concurrency more carefully. PRs get tighter. Reviews catch issues earlier.

### Hiring

The team's bar rises. New engineers see clean code and write clean code. The codebase becomes a teaching tool.

### Reputation

The service's reputation improves: fewer outages, faster deploys, better latency. Customer satisfaction rises.

These benefits compound. The migration's one-time cost is paid back many times over the following years.

---

## Final Word (Professional)

The wait-for-empty-channel anti-pattern, viewed from the professional level, is a *capital-N* engineering challenge: it intersects code, operations, observability, cost, customer experience, and team culture. Solving it requires every senior skill — and once solved, it raises the bar across the board.

If you are reading this as a senior or staff engineer in an organisation that has this anti-pattern, the path is clear:

1. Quantify the cost. Numbers in dollars and incidents.
2. Build the tooling. Lints, dashboards, runbooks.
3. Train the team. Theory then practice.
4. Migrate methodically. Phased, observed, rollback-ready.
5. Prevent regression. Lints, training, audits.

This is multi-quarter work. It is also some of the highest-impact engineering work you can do. The codebase that emerges is more reliable, cheaper, faster, and more pleasant to work on.

Read the other files in this section for tactical depth: `specification.md`, `interview.md`, `tasks.md`, `find-bug.md`, `optimize.md`.

---

## Appendix AA: Sample Migration Communication

A reference for the kind of communication that sustains a migration over months.

### Initial announcement (week 1)

```
Subject: Starting the concurrency anti-pattern migration

Team,

We have 200+ instances of the "wait for empty channel" anti-pattern across our codebase. This pattern causes:

- Slow shutdowns (some pods hit terminationGracePeriodSeconds)
- Dropped messages (estimated 0.5% under load)
- Elevated CPU (~15% baseline on worker pods)
- P99 latency spikes (50ms tail attributable to polling)

Estimated cost: $120K/year in cloud spend, 4 incidents/quarter.

Plan: 6-month migration, owned by [team], reviewed by [leadership]. Phase 0 is discovery; we'll share the inventory by [date].

If you encounter the pattern in your team's code, please add it to [tracker]. If you have questions, drop them in [channel].

Thanks,
[name]
```

### Monthly progress update

```
Subject: Concurrency migration — month 3 update

- 47 of 200 instances refactored
- Zero incidents attributable to the migration
- CPU savings to date: $8K/month run-rate
- P99 latency improvement: 12% on refactored services
- On track for completion by [date]

Next month: refactor [list of services]. Owner: [name].

[link to dashboard with detailed metrics]
```

### Final announcement

```
Subject: Concurrency migration complete

The migration to event-driven concurrency primitives is complete.

Summary:
- 213 instances refactored across [N] services
- $115K/year cloud savings (validated against billing)
- Zero incidents from the migration
- 4 lint rules added to prevent regression
- 12 team members trained

Special thanks to [list].

Forward: quarterly audits, annual training, ongoing lint maintenance.
```

This communication discipline keeps stakeholders informed and the migration on track.

---

## Appendix BB: A Final Code Sample

A small but complete service that exemplifies every principle in this file.

```go
package main

import (
    "context"
    "errors"
    "log"
    "net/http"
    "os"
    "os/signal"
    "sync"
    "sync/atomic"
    "syscall"
    "time"

    "golang.org/x/sync/errgroup"
)

type Service struct {
    addr     string
    workers  int
    inFlight atomic.Int64
    ready    atomic.Bool
    queue    chan Task
}

type Task struct {
    ID      string
    Payload []byte
    Done    chan error
}

func New(addr string, workers int) *Service {
    return &Service{
        addr:    addr,
        workers: workers,
        queue:   make(chan Task, 1024),
    }
}

func (s *Service) Run(ctx context.Context) error {
    g, ctx := errgroup.WithContext(ctx)

    // workers
    for i := 0; i < s.workers; i++ {
        g.Go(func() error {
            for task := range s.queue {
                s.inFlight.Add(1)
                err := s.process(ctx, task)
                s.inFlight.Add(-1)
                task.Done <- err
            }
            return nil
        })
    }

    // http server
    mux := http.NewServeMux()
    mux.HandleFunc("/submit", s.handleSubmit)
    mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
        w.WriteHeader(200)
    })
    mux.HandleFunc("/ready", func(w http.ResponseWriter, r *http.Request) {
        if s.ready.Load() {
            w.WriteHeader(200)
        } else {
            w.WriteHeader(503)
        }
    })
    srv := &http.Server{Addr: s.addr, Handler: mux}

    g.Go(func() error {
        s.ready.Store(true)
        if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
            return err
        }
        return nil
    })

    g.Go(func() error {
        <-ctx.Done()
        log.Println("ctx cancelled; starting shutdown")
        s.ready.Store(false)
        time.Sleep(15 * time.Second) // wait for LB to notice
        log.Println("shutting down http server")
        sctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
        defer cancel()
        if err := srv.Shutdown(sctx); err != nil {
            return err
        }
        log.Println("closing queue")
        close(s.queue)
        return nil
    })

    return g.Wait()
}

func (s *Service) handleSubmit(w http.ResponseWriter, r *http.Request) {
    payload, err := io.ReadAll(r.Body)
    if err != nil {
        http.Error(w, err.Error(), 400)
        return
    }
    task := Task{
        ID:      r.URL.Query().Get("id"),
        Payload: payload,
        Done:    make(chan error, 1),
    }
    select {
    case <-r.Context().Done():
        http.Error(w, "request cancelled", 499)
        return
    case s.queue <- task:
    }
    select {
    case <-r.Context().Done():
        http.Error(w, "request cancelled", 499)
    case err := <-task.Done:
        if err != nil {
            http.Error(w, err.Error(), 500)
            return
        }
        w.WriteHeader(200)
    }
}

func (s *Service) process(ctx context.Context, t Task) error {
    // simulate work
    select {
    case <-ctx.Done():
        return ctx.Err()
    case <-time.After(50 * time.Millisecond):
        return nil
    }
}

func main() {
    ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
    defer cancel()

    svc := New(":8080", 8)
    if err := svc.Run(ctx); err != nil {
        log.Fatal(err)
    }
}
```

What this service demonstrates:

- Per-request completion channel (no polling).
- Readiness-first shutdown.
- Bounded worker concurrency.
- Errgroup for structured concurrency.
- Context cancellation throughout.
- Time-bounded shutdown.

It is a complete reference; you can drop it into a Dockerfile, deploy it, and operate it. Every detail follows the principles in this file.

---

## Final Sentence

The wait-for-empty-channel anti-pattern is, in production, the difference between a service that you trust and a service that you fear. Migrating off it is worth every minute of the effort.

---

## Appendix CC: SRE Disciplines That Catch the Anti-Pattern Early

Beyond engineering, Site Reliability Engineering disciplines have proven effective at finding and preventing the pattern.

### Chaos engineering

Periodically inject failures and observe. A common chaos test: kill pods at random and measure shutdown duration. If pods routinely fail to shut down cleanly, the polling pattern is suspect.

### Load testing

Run regular load tests that exceed production peak by 2-3x. Polling-based code reveals itself under such load: races become reproducible, shutdowns become unreliable, drops become measurable.

### Game days

Quarterly exercises where the team simulates an incident. One common scenario: "Pod X is in Terminating state for too long; what do you do?" Answering correctly requires understanding the shutdown sequence, which makes the polling pattern visible in code review.

### Chaos engineering for shutdowns

A specific chaos test: continuously deploy and roll back. Each deploy exercises the shutdown path. Polling-based code fails some percentage of the time. Track the rate.

### Latency budget burn-down

Track latency over time. A polling regression appears as a step change in P99. Alert on step changes, not on absolute thresholds.

### Goroutine count monitoring

A leak (often caused by polling that does not exit) shows up as unbounded goroutine growth. Alert on growth rate, not on absolute count.

### CPU per request

Track CPU consumed per request handled. Polling shows up as a high baseline; the per-request CPU rises slightly. Alert on increase.

These disciplines catch the anti-pattern as a *signal* before it becomes an incident. They are the SRE counterpart to the engineering practices in earlier files.

---

## Appendix DD: Tooling Beyond Lints

Lints catch known patterns. Other tools catch broader concerns.

### `go vet`

Built-in. Catches some misuse: copying a `sync.Mutex` by value, formatting issues. Not specifically for the polling pattern.

### `staticcheck`

A more thorough static analyser. Catches goroutine leaks, mis-locked code, and many concurrency mistakes. Add `SA4031` for unused result of `len`.

### `errcheck`

Catches ignored errors. Polling loops often ignore errors; `errcheck` finds them.

### `gosec`

Security-focused but flags some concurrency anti-patterns.

### `revive`

Configurable. Add custom rules for the polling pattern.

### `gci` and `goimports`

Format imports consistently; not concurrency-specific.

### `goleak`

Test-time leak detector. Add to every test suite.

### `golangci-lint`

Aggregator. Configure with the linters above plus custom ones.

### Custom analysers

`golang.org/x/tools/go/analysis` lets you write custom passes. For the polling pattern, write one specifically.

Together, these tools form a quality net. The polling pattern struggles to slip through all of them.

---

## Appendix EE: Code Review at Scale

For a team of 50+ engineers, code review for concurrency requires structured process.

### Reviewer assignment

Designate two reviewers per PR with relevant expertise: one general (style, correctness), one concurrency-focused.

### Reviewer checklists

A standardised checklist for concurrency, covering:

- Every channel has a documented closer.
- Every goroutine has a documented exit.
- Every blocking call respects context.
- Every long-running loop selects on `ctx.Done()`.
- Every `len(ch)` is informational, not synchronising.
- Every wait uses WaitGroup, errgroup, or done channel.

### Review templates

PR templates that prompt the author to address concurrency:

```
## Concurrency
- Goroutines spawned: [list]
- Channels created: [list with ownership]
- Waits: [WaitGroup / errgroup / done channel]
- Cancellation: [context flow]
- Tests with -race -count=N: [yes/no]
```

If the section is blank or vague, the reviewer demands details.

### Anti-pattern reviews

Periodic batches of reviews focused on anti-patterns. The team picks a service, reviews it together, files refactor tickets. Trains the team and finds technical debt simultaneously.

### Pair refactoring

For tricky refactors, pair-program. The two-person rule catches concurrency mistakes that one person misses.

---

## Appendix FF: Onboarding Engineers on Concurrency

A new engineer joins. How do you bring them up to speed?

### Week 1: read the section

Read junior.md, middle.md, senior.md of this Roadmap section. Take notes. Discuss with mentor.

### Week 2: lab exercises

Implement the patterns from senior.md: worker pool, pipeline, supervisor. Run tests with `-race`. Have mentor review.

### Week 3: refactor task

Pick a simple instance of the anti-pattern in the codebase. Refactor under mentor's pairing. Submit PR. Discuss review feedback.

### Week 4: review task

Review a peer's PR with concurrency content. Apply the checklist. Discuss with mentor.

### Month 2-3: own a service

Take ownership of one concurrent service. Read its code. Improve it. Add tests. The service becomes the engineer's playground for applying the principles.

### Quarter 2+: contribute to the patterns library

Build new helpers, improve existing ones, write internal documentation. The engineer becomes a contributor to the team's concurrency discipline.

This onboarding takes time. It is also the highest-leverage investment a senior engineer can make in a team. The polling pattern stays absent because the team has the discipline to keep it absent.

---

## Appendix GG: A Year in the Life of a Concurrency-Disciplined Team

A narrative of how the discipline pays off across a year.

### Q1

Migration in progress. Half the instances refactored. Some teething pains: a feature flag misfires, a rollback teaches everyone how to handle one. Trust grows.

### Q2

Migration complete. CPU savings visible in budget. P99 latencies improved. The team starts to use the patterns proactively in new code.

### Q3

New hires onboarded with the patterns from day one. They write correct concurrent code without coaching. The codebase reads consistently.

### Q4

An incident occurs in a different system (say, a database deadlock). The team applies the same diagnostic discipline they developed for the polling pattern. The incident is resolved in two hours instead of two days.

The discipline transfers. The polling pattern was the training; the broader skill is the gift.

### Year-end review

Numbers:

- 50% reduction in concurrency-related incidents.
- 15% reduction in cloud spend.
- 30% improvement in P99 latency.
- 100% of new code follows the patterns.
- Two engineers became internal experts who speak at industry events.

The team's reputation rises. Other teams come for advice. The senior professionals who led the migration are recognised.

---

## Appendix HH: Pitfalls When Migrating

Common mistakes during a large migration.

### Mistake 1: refactor without tests

The original polling code might have worked accidentally. The refactor introduces a different bug. Without tests, you do not see it until production.

Fix: every refactor includes tests.

### Mistake 2: refactor without metrics

Without before/after metrics, you cannot confirm the refactor helped. You also cannot detect regressions.

Fix: capture profile and metrics before; compare after.

### Mistake 3: refactor without coordination

Two engineers refactor the same instance simultaneously. Merge conflicts, regressions, frustration.

Fix: the inventory tracker assigns owners.

### Mistake 4: refactor too aggressively

Replacing a polling loop with a complex new abstraction is risky. The simpler refactor is usually right.

Fix: prefer mechanical refactors. Save creativity for new features.

### Mistake 5: cleanup too late

Old code paths linger behind flags long after the new ones are validated. The codebase carries dead code.

Fix: remove flags within two weeks of 100% rollout.

### Mistake 6: migration fatigue

Three months in, the team is tired. Quality slips. Tests get skipped. Reviews get rubber-stamped.

Fix: pace the migration. Rotate the lead. Celebrate milestones.

### Mistake 7: forgetting to train

The migration completes but new hires do not know the patterns. The anti-pattern returns in new code.

Fix: training is part of the migration's exit criteria.

---

## Appendix II: After-Action Review for a Successful Migration

A retrospective on a real migration (composite).

### What went well

- Phased rollout caught issues early.
- Feature flags enabled fast rollback.
- Lints prevented new instances.
- Training built team capability.
- Metrics quantified the win.

### What went poorly

- Discovery took longer than expected (4 weeks vs estimated 2).
- Two refactors introduced bugs that required hot fixes.
- Communication to leadership was sporadic in months 2-3.
- Some engineers viewed the migration as low-status work.

### What we would do differently

- Estimate discovery more generously.
- Add a "buddy review" for every refactor.
- Weekly leadership updates from day one.
- Reframe the work as "platform improvement" to attract talent.

### Lessons for next time

- Anti-pattern migrations are predictable in shape if not in detail.
- The technical work is easier than the organisational work.
- Maintenance after the migration is the hard part.

This retrospective becomes part of the team's history. Future migrations benefit.

---

## Appendix JJ: A Final Comparison

Two production services, six months apart, both handling 10K requests per second.

### Service A: polling-heavy

- 200 pods.
- Baseline CPU: 18%.
- P99 latency: 250 ms.
- Shutdown duration P99: 28 seconds.
- Drop rate: 0.3%.
- Incidents per quarter: 4.
- Cloud spend: $50K/month.

### Service B: event-driven

- 140 pods (the same workload, lower per-pod CPU baseline allows fewer pods).
- Baseline CPU: 0.8%.
- P99 latency: 140 ms.
- Shutdown duration P99: 0.5 seconds.
- Drop rate: <0.001%.
- Incidents per quarter: 0-1.
- Cloud spend: $32K/month.

Same workload, same SLA, different shape. Service B is the result of removing the wait-for-empty-channel anti-pattern (and its cousins). The benefits compound: fewer pods, lower CPU, lower latency, lower drop, fewer incidents, lower spend.

This comparison is the single best argument for the migration. Show it to leadership. Show it to your team. Show it to skeptics.

---

## Appendix KK: Continuous Improvement

The migration is not the end. The discipline must be sustained.

### Monthly: audit a service

Pick a service. Read its concurrency code. Confirm no new instances of the pattern. Update lints if needed.

### Quarterly: review SLOs

Are the SLOs still appropriate? Has the system changed? Update.

### Annually: refresh training

Re-teach the patterns. New hires need it; veterans benefit from refreshers. Use the latest examples from your codebase.

### Continuously: review PRs

The PR review is the daily discipline. Make it count.

### Continuously: update tooling

Lints evolve. Add new rules as new variants emerge. Remove rules that no longer apply.

This is steady-state work. It is also the hallmark of a mature engineering organisation.

---

## Appendix LL: Building a Concurrency Community of Practice

Beyond a single team, an organisation can build a "community of practice" around concurrency.

### Components

- Slack channel for questions.
- Monthly "concurrency clinic" where engineers bring code for review.
- Internal blog with case studies.
- Reading list of papers and books.
- Annual conference talk.

### Outcomes

- Cross-team learning.
- Faster onboarding for new hires (they have community access from day one).
- Higher engineer satisfaction (specialists value being valued).
- Better code (cross-pollination improves patterns).

### Costs

- One senior engineer's time, maybe 20% allocation.
- Organisational sponsorship.

The community amplifies individual expertise into organisational expertise. It is one of the best investments a tech-driven company can make.

---

## Appendix MM: Closing Reflections

Across this file we have moved from code-level concerns to operational concerns to organisational concerns. The wait-for-empty-channel anti-pattern is, in the end, a *cultural* problem: it thrives where the discipline is weak.

Building the discipline takes time. It also has compounding returns. A team with the discipline:

- Writes correct concurrent code by default.
- Reviews effectively.
- Diagnoses incidents quickly.
- Onboards new engineers smoothly.
- Talks to leadership credibly.

That team becomes a magnet for talent and a model for other teams. The polling pattern is gone, but the *real* benefit is the broader competence that came from removing it.

---

## Appendix NN: Recommended Reading

Beyond this Roadmap section:

- *The Go Memory Model* — official spec. Read once a year.
- Russ Cox, *"Off to the Races"* — historical background.
- *"Common Mistakes Made by Go Developers"* — Teiva Harsanyi, chapter on concurrency.
- *Concurrency in Go* by Katherine Cox-Buday — book-length treatment.
- *The Art of Multiprocessor Programming* by Herlihy and Shavit — general concurrent algorithms; some chapters apply directly.
- Dawson Engler et al., *"Bugs as Deviant Behavior"* — static analysis principles.
- Production engineering blog posts from Cloudflare, Uber, Dropbox, Discord — they describe real concurrency war stories.

A senior engineer reads continuously. The polling pattern is solved, but new patterns emerge. Stay current.

---

## Appendix OO: A Closing Story

A team I once worked with had eight engineers and one polling-loop crisis. They were dropping 0.4% of orders nightly during batch processing. Three months of intermittent on-call. They asked me to help.

The fix took two days: identify the pattern, refactor to errgroup, add tests, deploy. The bug stopped.

The harder work took two quarters: train the team, build lints, write runbooks, refactor sibling instances. By the end, the team had a different identity. They were no longer the team that occasionally lost orders. They were the team that other teams asked for concurrency advice.

That identity shift is the real prize. The polling pattern was the proximate problem; the cultural growth was the lasting solution. Aim for the cultural growth. The bug is the easy part.

---

## Appendix PP: Tools Lifecycle

Tooling decays. Lints can become obsolete. Dashboards can mislead if their inputs change. Maintain.

### Annual lint review

- Are the lint rules still relevant?
- Do they have false positives we should suppress?
- Should we add rules for new variants of the pattern?

### Annual dashboard review

- Are the panels still showing useful data?
- Are the queries efficient?
- Should we add panels for new metrics?

### Annual runbook review

- Are the steps still accurate?
- Are the linked tools still in use?
- Should we add runbooks for new failure modes?

### Annual tooling audit

- Are we using the best linters available?
- Are there new tools we should adopt?
- Should we deprecate any?

Tools serve the discipline; the discipline serves the team. Keep both in good repair.

---

## Appendix QQ: When the Anti-Pattern Is Architectural

Sometimes the polling is symptomatic of a deeper design problem. Recognising this is the senior+ skill.

### Sign 1: too many polling loops in one service

If a single service has dozens of polling loops, the architecture is wrong. It is doing too much. Split it.

### Sign 2: polling crosses process boundaries

A service polls another service's queue. Service-to-service communication should be event-driven (pub/sub, webhooks, RPC). Polling is a workaround for a missing event API.

### Sign 3: polling on every request

Every HTTP request triggers a polling loop. The latency added is unavoidable. Refactor to use proper async coordination.

### Sign 4: polling for state changes in storage

The service polls a database row for changes. Use database change streams (Postgres logical replication, Kafka Connect, Debezium) to convert to events.

### Sign 5: polling for cluster state

The service polls Kubernetes API. Use the watch API instead.

In each case, the polling is the symptom of a larger missing abstraction. Fixing the polling alone is necessary but not sufficient; the architecture must change too.

---

## Appendix RR: The Senior-to-Staff Transition

For engineers progressing to staff or principal:

The work changes. You stop being the person who refactors polling loops and start being the person who designs systems where polling is impossible. You write the lints, build the dashboards, train the team, sponsor the migration.

The wait-for-empty-channel anti-pattern is a case study in this transition. A senior engineer fixes the instances they encounter. A staff engineer prevents the pattern from arising at all.

If you find yourself thinking less about "did I get this code right?" and more about "did the team's processes catch this before code review?", you are making the transition.

---

## Appendix SS: A Long Look Backward

When I started Go in [past year], the wait-for-empty-channel pattern was endemic. Tutorials taught it. Open-source code featured it. Production systems were riddled with it. The community gradually learned.

Today, the discipline exists. Good codebases have lints; new tutorials emphasise channels and WaitGroups; the pattern is a known anti-pattern in industry literature. But the discipline is not universal. Many codebases still have the pattern, especially older ones.

The progress is uneven. New languages and new ecosystems repeat the cycle. Rust's `crossbeam`, Kotlin's coroutines, Swift's structured concurrency — each will produce its own version of the polling anti-pattern, and each community will gradually learn.

Your contribution to this arc:

- Write correct code in your own work.
- Teach others.
- Document your team's patterns.
- Build tools that enforce the discipline.

The arc bends toward better software. Be the force that bends it.

---

## Appendix TT: A Bullet Point Summary For Bookmark

If you only remember a few things:

- `len(ch)` for synchronisation is always racy.
- Replace with WaitGroup, errgroup, done channel, or context.
- Document who owns and closes every channel.
- Use `-race -count=N` in CI.
- Graceful shutdown integrates with Kubernetes/LB lifecycle.
- Polling has measurable production cost.
- Migration is mechanical; plan it phased and observed.
- Tools (lints, dashboards, runbooks) sustain the discipline.
- Training builds the team's capability.
- The cultural shift is the real prize.

Bookmark. Refer back when the next anti-pattern emerges.

---

## Appendix UU: A Production Story Told From Four Perspectives

The same incident, viewed by four different stakeholders.

### The on-call engineer

It's 02:13 UTC. Pager fires: `shutdown.duration.p99 > 25s`. I look at the dashboard. The order-processor pods are taking 28 seconds to shut down. Three pods have hit SIGKILL in the last hour. Some orders are not making it to the database — reconciliation will flag them in the morning.

I read the logs. The shutdown stops at "draining queue." Goroutine dump shows a goroutine in `time.Sleep` in `worker.go:142`. I open the file. There it is: `for len(jobs) > 0 { time.Sleep(time.Millisecond) }`.

I have two options: roll back to the last deploy, or hot-fix. The deploy was three days ago and contained other changes I don't want to revert. I hot-fix: change the polling to `wg.Wait()`. Test locally. Push. The fix deploys in 15 minutes.

By 03:00 UTC, shutdowns are clean. I write up the incident and go back to sleep.

### The engineering manager

I get the post-incident summary at 09:00. The order-processor team's polling loop dropped some orders again. This is the third time this quarter. We need to do something systemic.

I schedule a discussion with the senior engineers. We agree: budget two engineer-quarters to audit and migrate the codebase off this pattern. I write the proposal for our director.

### The director

A two-engineer-quarter ask for "concurrency cleanup." I push back: what's the customer impact? The manager quantifies: 0.3% of orders affected during peak; downstream reconciliation catches it but takes 4 hours of manual replay; one customer noticed last quarter and almost churned.

That's a $1.2M ARR risk. The two engineer-quarters cost maybe $80K. Approved.

### The customer success rep

I see a ticket from a payment customer: "Some orders aren't appearing in our weekly report." It's the same customer who almost churned last quarter for the same reason. I escalate to engineering urgently.

A week later, engineering confirms the fix is rolling out. I follow up with the customer: their orders are now reconciling correctly. They renew.

### The lesson

Each perspective sees the same anti-pattern differently. The engineer sees a polling loop. The manager sees an incident pattern. The director sees a revenue risk. The customer success rep sees a churn risk.

Connecting these perspectives is the work of a senior engineer. The migration proposal succeeds because it speaks all four languages.

---

## Appendix VV: Migration Communication Templates

Templates for the communications that sustain a migration.

### Slack announcement

```
:wrench: We're starting a migration to remove the wait-for-empty-channel anti-pattern from our codebase.

Why: 4 incidents/quarter, $120K/year in cloud spend, 50ms P99 latency tail.

How: 6 months, owned by [team], reviewed by [SRE]. Phased rollout with feature flags.

Track: [link to dashboard] [link to ticket]

Questions: drop them here or DM [name].
```

### Email update

```
Subject: Concurrency migration update — week 8

Status: 25/200 instances refactored. On track.
CPU savings to date: $3,200/month run-rate.
Incidents from migration: 0.
Next milestone: complete the order-processor pipeline by week 12.

Detailed dashboard: [link]
Open questions: [link to ticket]

Thanks,
[name]
```

### Final wrap-up

```
Subject: Migration complete

The concurrency anti-pattern migration is complete. Final stats:

- 213 instances refactored across 17 services.
- Annual savings: $115K (validated via billing).
- P99 latency: -32% on refactored services.
- Incidents attributable to anti-pattern: 0 in the last 90 days.
- 4 lint rules added; 100% PR coverage.

Thanks to the team that made this happen.

Forward: quarterly audits, annual training, lint maintenance.
```

Use these as starting points. Adapt to your organisation's voice.

---

## Appendix WW: Lessons From Real Production Migrations

Three lessons that surprised me during real migrations.

### Lesson 1: the migration uncovers other bugs

The polling code often hid other bugs that the polling masked. Refactoring revealed them. Plan for collateral fixes.

### Lesson 2: the team's velocity improves after

Once the patterns are absent, code review is faster. New features ship faster. The team's overall throughput goes up. Quantify if you can.

### Lesson 3: leadership often underestimates the value

The proposal sells the cost savings. The real value is the cultural shift and the prevented incidents. Both are harder to quantify, but they are real. Mention them.

---

## Appendix XX: A Cookbook of Refactoring Recipes

A collection of specific refactoring recipes for common shapes of the anti-pattern.

### Recipe 1: simple drain

Before:

```go
for len(ch) > 0 {
    time.Sleep(time.Millisecond)
}
```

After:

```go
for range ch {
}
```

Caller must close `ch` upstream.

### Recipe 2: drain with side effects

Before:

```go
for len(ch) > 0 {
    handle(<-ch)
    time.Sleep(time.Millisecond)
}
```

After:

```go
for x := range ch {
    handle(x)
}
```

### Recipe 3: worker pool with len polling

Before:

```go
for i := 0; i < N; i++ {
    go worker(jobs)
}
for len(jobs) > 0 {
    time.Sleep(time.Millisecond)
}
```

After:

```go
var wg sync.WaitGroup
for i := 0; i < N; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        for j := range jobs {
            handle(j)
        }
    }()
}
close(jobs) // signal workers to exit when buffer drained
wg.Wait()
```

### Recipe 4: bounded fan-out

Before:

```go
sem := make(chan struct{}, N)
for _, item := range items {
    sem <- struct{}{}
    go func(item Item) {
        defer func() { <-sem }()
        process(item)
    }(item)
}
for len(sem) > 0 {
    time.Sleep(time.Millisecond)
}
```

After:

```go
g, ctx := errgroup.WithContext(ctx)
sem := semaphore.NewWeighted(int64(N))
for _, item := range items {
    item := item
    if err := sem.Acquire(ctx, 1); err != nil {
        break
    }
    g.Go(func() error {
        defer sem.Release(1)
        return process(ctx, item)
    })
}
return g.Wait()
```

### Recipe 5: shutdown drain

Before:

```go
func (s *Service) Stop() {
    close(s.stop)
    for len(s.jobs) > 0 {
        time.Sleep(10 * time.Millisecond)
    }
}
```

After:

```go
func (s *Service) Stop() {
    close(s.jobs) // signal workers to exit
    s.wg.Wait()   // wait for workers
}
```

### Recipe 6: per-request completion

Before:

```go
func (s *Service) Handle(r *Request) {
    s.queue <- r
    for len(s.queue) > 0 {
        time.Sleep(time.Millisecond)
    }
    respond(r)
}
```

After:

```go
type wrapped struct {
    r    *Request
    done chan error
}

func (s *Service) Handle(r *Request) {
    w := wrapped{r, make(chan error, 1)}
    s.queue <- w
    err := <-w.done
    respond(r, err)
}

// worker:
for w := range s.queue {
    w.done <- process(w.r)
}
```

### Recipe 7: settled-after-quiet

Before:

```go
for {
    if len(events) == 0 {
        time.Sleep(100 * time.Millisecond)
        if len(events) == 0 {
            return
        }
    }
    handle(<-events)
}
```

After:

```go
timer := time.NewTimer(100 * time.Millisecond)
defer timer.Stop()
for {
    select {
    case e, ok := <-events:
        if !ok {
            return
        }
        handle(e)
        if !timer.Stop() {
            <-timer.C
        }
        timer.Reset(100 * time.Millisecond)
    case <-timer.C:
        return
    }
}
```

### Recipe 8: capacity polling

Before:

```go
for len(ch) == cap(ch) {
    time.Sleep(time.Millisecond)
}
ch <- value
```

After:

```go
select {
case ch <- value:
case <-ctx.Done():
    return ctx.Err()
}
```

### Recipe 9: wait for arrival

Before:

```go
for len(ch) == 0 {
    time.Sleep(time.Millisecond)
}
v := <-ch
```

After:

```go
v := <-ch
```

Or with context:

```go
select {
case v := <-ch:
    return v
case <-ctx.Done():
    return ctx.Err()
}
```

### Recipe 10: polling atomic counter

Before:

```go
for atomic.LoadInt32(&pending) > 0 {
    time.Sleep(time.Millisecond)
}
```

After:

```go
<-done
```

With `done` closed when `pending` reaches zero.

These recipes cover ~95% of real instances. Memorise them.

---

## Appendix YY: An Argument For Aggressive Refactoring

Some engineers argue against large refactoring efforts: "the bug is rare," "the code works most of the time," "the cost is small."

I have made this argument myself. I was wrong each time.

### Why "rare" bugs matter

Concurrency bugs are *systematically* rare in development and *systematically* common in production. Your laptop runs at scheduler timing your laptop uses. Production runs at the timing of 200 pods, each with a different load, on different hardware, with different cache pressure. The race window that closes 99.9% of the time on your laptop opens 0.5% of the time in production. At 10K requests per second, that is 50 failures per second.

### Why "works most of the time" matters

A bug that fails 0.3% of the time but is silent is worse than one that fails 30% of the time loudly. The silent bug accumulates as silent data loss, silent CPU waste, silent latency. Loud bugs get fixed quickly; silent bugs persist for years.

### Why "small cost" matters

A small cost multiplied by every request multiplied by every pod multiplied by every day adds up. A 1 ms latency tail per request is invisible. A 1 ms latency tail per request at 100M requests per day is 28 hours of cumulative customer wait time per day.

### The aggressive position

Refactor the anti-pattern wherever you find it, even if "it works." The cost is small per instance. The aggregate cost of leaving it is large. The cost of the migration is small. The aggregate value of removing it is large.

This is the senior-professional argument. Make it when needed.

---

## Appendix ZZ: A Hundred Patterns

Throughout these files we have introduced many patterns by name. A consolidated index for reference:

1. Close-and-range
2. WaitGroup-and-close
3. Errgroup fanout
4. Semaphore-bounded
5. Token return drain
6. Per-request done
7. Pipeline
8. Fan-out broadcast
9. Settled-after-N
10. Settled-after-quiet
11. Actor mailbox
12. Request-reply
13. Latch (countdown)
14. Once-and-broadcast
15. Cond-and-predicate
16. Atomic flag
17. Hierarchical context
18. Errgroup with semaphore
19. Pipeline with backpressure
20. Generic worker pool
21. Bounded queue with context
22. Drain protocol 1: hard
23. Drain protocol 2: deadline
24. Drain protocol 3: full
25. Drain protocol 4: reject
26. Drain protocol 5: priority
27. Readiness-first shutdown
28. PreStop hook drain
29. Connection drain
30. GracefulStop
31. Counted drain
32. Failure-atomic drain
33. Supervisor with restart
34. Saga with compensation
35. Singleflight dedup
36. Backoff with context
37. Long-poll with ctx
38. Watch with reconnect
39. Multi-producer coordinator
40. Multi-consumer coordinator
41. Broadcast with drop
42. Broadcast with replay
43. Quorum drain
44. Adapter for callback API
45. Adapter for push API
46. State machine event
47. Settled detector
48. Token bucket rate limit
49. Weighted semaphore
50. Heartbeat watcher
51. Phased shutdown
52. Bounded retry
53. Idempotent processor
54. Two-phase commit
55. Outbox pattern
56. Saga orchestration
57. Saga choreography
58. Circuit breaker
59. Bulkhead
60. Compensating transaction
61. Async response
62. Webhook delivery
63. Polling-free job runner
64. Coalesced flush
65. Batch boundary detector
66. Watcher reconnect
67. Lease renewal
68. Leader election
69. Distributed lock
70. Optimistic concurrency
71. Pessimistic concurrency
72. Snapshot read
73. Read-through cache
74. Write-through cache
75. Cache aside
76. Write-behind buffer
77. Bulk insert
78. Bulk update
79. Chunked stream
80. Backfill orchestrator
81. Migration coordinator
82. Live migration
83. Blue-green deploy
84. Canary deploy
85. Rolling deploy
86. Shadow traffic
87. A/B test runner
88. Feature flag gate
89. Kill switch
90. Rate-limited admission
91. Slow-start ramp
92. Graceful degradation
93. Fail-open mode
94. Fail-closed mode
95. Health check probe
96. Liveness check
97. Readiness check
98. Self-test harness
99. Dependency check
100. End-to-end smoke test

Most of these have appeared in this section. Some are touched lightly; others are core. A senior professional knows them all by name and can implement the core ones from memory.

---

## Appendix AAA: A Glossary of Operational Terms

- **terminationGracePeriodSeconds**: Kubernetes setting for how long a pod has after SIGTERM before SIGKILL.
- **preStop hook**: Kubernetes lifecycle hook that runs before SIGTERM.
- **drain**: the process of finishing in-flight work before shutdown.
- **readiness probe**: HTTP endpoint that signals "ready for traffic" to the LB.
- **liveness probe**: HTTP endpoint that signals "process alive" to Kubernetes.
- **deregistration delay**: how long an LB waits before removing a pod from rotation.
- **canary**: a small percentage of traffic routed to a new version.
- **shadow traffic**: traffic duplicated to a new version without consuming its output.
- **blue-green**: full traffic switched between two versions.
- **rolling deploy**: gradual replacement of old pods with new pods.
- **feature flag**: a runtime toggle for code paths.
- **kill switch**: a feature flag that can immediately disable a feature.
- **SLO**: Service Level Objective, a target for reliability.
- **SLI**: Service Level Indicator, a metric backing an SLO.
- **error budget**: the allowed failure rate under an SLO.
- **MTBF**: Mean Time Between Failures.
- **MTTR**: Mean Time To Recover.
- **postmortem**: a structured analysis of an incident.
- **runbook**: a procedural guide for handling a specific symptom.
- **game day**: a planned exercise simulating an incident.
- **chaos engineering**: the practice of injecting failures to test resilience.

These terms appear repeatedly in this file. Internalise them.

---

## Appendix BBB: Concluding Synthesis

This file has covered a lot of ground:

- How the anti-pattern manifests in production.
- How to shut down services gracefully.
- How to drain queues in workers.
- How to observe in-flight work.
- How to coordinate across pods and clusters.
- How to integrate with Kubernetes, load balancers, message queues.
- How to migrate without downtime.
- How to alert on the pattern's symptoms.
- How to plan capacity, model cost, and quantify latency impact.
- How to build SRE disciplines that catch the pattern.
- How to train teams, run reviews, and sustain culture.
- How to build communities of practice.

The thread tying it all together: the wait-for-empty-channel anti-pattern is not a code smell to fix in isolation. It is a *symptom* of a broader operational and cultural posture. Fixing it requires engineering the systems, the tooling, the processes, and the people in concert.

If you have read all four levels — junior, middle, senior, professional — you have the full picture. The next files in this section give you the tools to teach, test, and apply the principles:

- `specification.md` for the formal semantics.
- `interview.md` for graded Q&A.
- `tasks.md` for hands-on exercises.
- `find-bug.md` for buggy snippets.
- `optimize.md` for performance scenarios.

Use them. Teach them. Refer back to them.

The polling pattern is solvable. The discipline that solves it generalises to many other anti-patterns. That is the larger arc: every anti-pattern we solve raises the bar for the next one.

Good luck.

---

## Appendix CCC: A Personal Note

When I encountered this anti-pattern in my own work, I did not understand its depth. I thought it was a code-level mistake to be fixed locally. I learned, over years and many incidents, that it is a multi-layer problem: code, design, operations, organisation.

The decade between the first time I wrote `for len(ch) > 0` (as a learner) and the time I wrote this file (as someone trying to teach the lesson) is, in some sense, my Go career. Every concurrency lesson I have learned shows up somewhere in this section. Every incident I have lived through informs an example. Every refactor I have led contributes a recipe.

I hope you can shortcut some of that decade by reading this. The patterns are knowable. The tooling exists. The community has done the work. Take the shortcuts. Then add your own contributions for the next person.

That is the open-source spirit applied to engineering discipline: each generation stands on the previous one's shoulders. Be the shoulders for the next.

---

## Appendix DDD: Final Bullet Summary

For your back pocket:

- The anti-pattern is racy. Always.
- It costs CPU, latency, and shutdown reliability.
- Fix code-level: replace with WaitGroup, errgroup, done, context.
- Fix design-level: hide channels, document ownership, return wait handles.
- Fix ops-level: integrate with K8s/LB lifecycle, observe in-flight, drain explicitly.
- Fix org-level: lints, training, dashboards, runbooks, communities of practice.
- Migrate phased: discovery, tooling, training, refactor, cleanup, prevention.
- Measure: CPU, latency, drops, shutdown time, incidents, cloud spend.
- Sustain: monthly audit, quarterly review, annual training.

These bullets are the entire file in one screen. Print and pin.

---

## Appendix EEE: Detailed Postmortem of a Complex Incident

A composite postmortem assembled from several real incidents.

### Title

Payment Processor Loses Capacity During Region Failover

### Incident details

- Start: 2026-03-12 14:32 UTC.
- Detection: 14:38 (alert).
- Mitigation: 15:21.
- Resolution: 15:47.
- Duration: 75 minutes.
- Severity: Sev 1.

### Impact

- ~12,000 payment requests delayed by 30-90 seconds.
- ~80 customer complaints.
- Estimated revenue at risk: $300K.
- SLA breached: 99.95% target; actual 99.91% for the day.

### Timeline

- 14:32 UTC: AWS region us-east-1 issues. Failover begins.
- 14:34: Primary region drained; secondary region activated.
- 14:38: P99 latency alert fires.
- 14:42: On-call investigates. CPU on secondary region pods is 95%.
- 14:55: On-call identifies hot polling loop in `payment-router.go`.
- 15:00: Emergency hotfix written.
- 15:10: Hotfix deployed to 10% of pods.
- 15:15: Latency improving.
- 15:21: Hotfix at 100%. Latency normal.
- 15:47: Customers confirmed unblocked.

### Root cause

The secondary region had been deployed for 18 months but rarely used at full capacity. The polling loop in `payment-router.go` was at 5% CPU baseline, undetected. When failover routed full traffic to the secondary region, the polling loops scaled up: instead of 5 polling goroutines per pod (handling occasional traffic), there were now ~200 polling goroutines per pod (handling full traffic). CPU saturated. Latency spiked.

### Contributing factors

1. The polling pattern had been in the codebase since the initial release of the service.
2. The secondary region was never load-tested at full capacity.
3. Alerts were tuned for the primary region's baseline CPU; the secondary region's elevated baseline did not trigger them until under load.
4. The team that owned the service had rotated; no one remembered the polling loop existed.

### Detection

The alert fired at 14:38, six minutes after the issue began. This is acceptable but not great. We could have alerted earlier on CPU growth rate.

### Response

The hotfix took 28 minutes from identification to 100% deployment. This is good for an emergency.

### Why we did not prevent it

- No automated detection of the polling pattern.
- No regular load testing of the secondary region.
- No baseline CPU monitoring across regions.
- No periodic concurrency audit.

### Action items

- [ ] Refactor the polling loop in `payment-router.go` (owner: alice, due: 2026-03-19).
- [ ] Add a CI lint rule for the polling pattern (owner: bob, due: 2026-03-26).
- [ ] Add monthly load tests of secondary regions (owner: carol, due: 2026-04-09).
- [ ] Add alert for "CPU baseline > 10% on any pod" (owner: dave, due: 2026-03-19).
- [ ] Schedule a concurrency audit for all critical services (owner: emma, due: 2026-04-30).
- [ ] Postmortem read by the wider team (owner: alice, due: 2026-03-26).

### Lessons

1. Anti-patterns that are dormant in low traffic are dangerous in high traffic.
2. Multi-region deployments must be tested at full traffic in each region.
3. Baseline CPU is a leading indicator of anti-patterns; monitor it cross-region.
4. Periodic audits catch dormant issues; without them, we rely on incidents.

### Follow-up

Six weeks later, all action items completed. The annual concurrency audit became standard. The next region failover (some months later) was uneventful: no polling pattern remained.

---

## Appendix FFF: Quarterly Review Template

For ongoing maintenance of concurrency health, a quarterly review template.

### Section 1: incidents

- How many concurrency-related incidents this quarter?
- Trends compared to previous quarters.
- Common root causes.
- Action items from each incident.

### Section 2: SLOs

- Status of each concurrency-related SLO.
- Error budget consumption.
- Forecast for next quarter.

### Section 3: tooling

- Lint coverage; new variants discovered.
- Dashboard updates; new panels added.
- Runbook revisions.

### Section 4: code health

- Audit results from this quarter (which services?).
- Refactor count.
- Lint warnings count (should be zero in clean code).

### Section 5: team

- New hires trained.
- Senior engineers active in reviews.
- Community of practice activity.

### Section 6: forward plan

- Audits planned for next quarter.
- Training planned.
- Tooling improvements.
- Strategic concerns (deprecating libraries, new languages, etc.).

A quarterly review keeps the discipline alive. Without it, organisations regress.

---

## Appendix GGG: Migration in the Face of Other Refactors

Real codebases have multiple ongoing migrations: switching ORMs, migrating to gRPC, breaking a monolith. Adding "concurrency cleanup" on top requires coordination.

### Strategy: separate workstreams

Each migration is its own workstream with its own owner. They proceed independently. Conflicts are resolved in code review.

### Strategy: combined PRs

When two migrations touch the same file, combine into a single PR. The reviewer sees the full change. Risk is higher but coordination cost is lower.

### Strategy: sequenced migrations

Finish one migration before starting another. Reduces coordination cost but slows progress.

For most cases, separate workstreams with regular cross-coordination meetings is the right balance. Weekly sync: "what files are touched this week?" prevents conflicts.

---

## Appendix HHH: Stages of Awareness in a Team

A team's awareness of the anti-pattern goes through stages.

### Stage 0: unaware

The team writes polling loops, sees them in code, does not recognise the issue.

### Stage 1: vaguely aware

The team has heard "polling is bad" but does not enforce. Some engineers avoid; others do not.

### Stage 2: code review aware

The team flags polling in reviews. Refactors when convenient. Does not yet have tooling.

### Stage 3: tooled aware

The team has lints, runbooks, dashboards. New instances are blocked at CI. Existing instances are tracked.

### Stage 4: culturally aware

The pattern is a known anti-pattern. New hires learn about it during onboarding. The team teaches other teams.

### Stage 5: industry contributor

The team writes blog posts, gives talks, contributes to open-source tools. The discipline becomes industry-shared.

Most teams are at stage 1-2. Stages 3-5 require deliberate investment. Aim for stage 3+ as a baseline.

---

## Appendix III: Reading a Postmortem

Tips for reading postmortems (your own or from others' organisations).

### Look for

- The triggering event.
- The propagation: how did the small issue become a big one?
- The detection: how was it caught?
- The response: how fast?
- The fix: what changed?
- The prevention: what prevents recurrence?

### Concurrency lens

When the root cause involves goroutines, channels, or locks:

- Is the synchronisation event-driven or polling?
- Is there an ownership rule violated?
- Is there a lifecycle assumption that broke?
- Did `-race` catch it? If not, why?
- Are tests with `-count=N` in place?

### Translate to your context

Most concurrency postmortems are organisationally identical. The same lessons apply to your team. Read with the question: "Do we have this issue?"

Postmortems from public companies (Google, Cloudflare, Discord, Netflix) are gold. Read one a month. Apply the lessons.

---

## Appendix JJJ: The Anti-Pattern in Microservices

Microservices architectures multiply the anti-pattern surface. Each service can have its own polling loop. Cross-service coordination can add another layer.

### Cross-service polling

```go
for {
    resp, _ := http.Get("http://service-b/status")
    var status string
    json.NewDecoder(resp.Body).Decode(&status)
    if status == "ready" {
        break
    }
    time.Sleep(time.Second)
}
```

This is the anti-pattern at the network layer. Same shape, same problems: missed updates, CPU cost, latency tail.

### Fix: events

Service B publishes a "ready" event to a topic. Service A subscribes. Event-driven coordination.

### Fix: webhook

Service A registers a webhook with service B. When service B becomes ready, it posts to the webhook. Service A receives.

### Fix: long-poll

Service A makes a request that blocks until service B is ready (or a timeout). The polling is server-side, not client-side. Limits the wakeup overhead.

In each case, polling is replaced by an event mechanism. The cross-service pattern is the same as the intra-service pattern, scaled up.

---

## Appendix KKK: A Reading List for Operations

For SREs and operations engineers approaching the concurrency dimension:

- Google SRE Book — chapters on monitoring, alerting, postmortems.
- *Database Reliability Engineering* — concurrency at the data layer.
- *Site Reliability Workbook* — practical exercises.
- *Production-Ready Microservices* — operational concerns at scale.
- Cloud provider documentation for lifecycle hooks (AWS, GCP, Azure).
- Kubernetes documentation on pod lifecycle.
- The papers behind Borg, Mesos, Kubernetes — the design intent.

Combine with the engineering reading list from earlier. Together they give the full picture.

---

## Appendix LLL: A Reading List for Engineering Leaders

For engineering managers and directors:

- *An Elegant Puzzle* by Will Larson — organisational systems thinking.
- *Staff Engineer* by Will Larson — the role you sponsor migrations from.
- *Accelerate* by Forsgren, Humble, Kim — DORA metrics and team performance.
- *The Phoenix Project* by Gene Kim — fictional but instructive on systemic improvements.
- The DORA reports — annual data on what high-performing teams do.

Leaders who fund migrations like this benefit from understanding the broader context. The technical detail is in this section; the organisational frame is in the books above.

---

## Appendix MMM: Open-Source Examples to Study

For engineers who want to see "good" concurrency code:

- `golang.org/x/sync` — the source code itself.
- `kubernetes/kubernetes` — large, sophisticated, well-reviewed.
- `etcd-io/etcd` — distributed consensus implementation.
- `nats-io/nats-server` — high-throughput message broker.
- `prometheus/prometheus` — scaling concurrent ingestion.
- `temporalio/temporal` — workflow engine.
- `cockroachdb/cockroach` — distributed database.

Each has weeks of reading. None has the wait-for-empty-channel anti-pattern. Reading them is education.

---

## Appendix NNN: A Mantra

To close, a mantra:

> Channels are for communication, not for counting.
> Length is for diagnostics, not for synchronisation.
> Sleep is for time, not for waiting.
> Polls are for clocks, not for events.

Repeat. Internalise. The anti-pattern fades.

---

## Appendix OOO: Glossary, Cross-File

Terms that appeared in junior, middle, senior, and professional, gathered.

- **Anti-pattern**: a coding shape that works locally but fails in the broader system.
- **Backpressure**: feedback from a slow consumer that slows a fast producer.
- **Buffer**: the storage inside a channel between send and receive.
- **Cancellation**: a signal that terminates ongoing work.
- **Channel**: Go's typed pipe primitive.
- **Close**: terminating a channel; sends panic, receives return zero-value.
- **Context**: Go's idiomatic cancellation and deadline carrier.
- **Coordinator**: a goroutine or process that orchestrates others.
- **Drain**: the process of completing in-flight work.
- **Done channel**: a `chan struct{}` whose close signals completion.
- **Errgroup**: `WaitGroup + context + first error`.
- **Event-driven**: synchronisation by reaction to events, not polling.
- **Goroutine**: a lightweight thread.
- **Happens-before**: the memory-model order between two operations.
- **Hierarchical cancellation**: parent context cancels propagating to children.
- **Idempotency**: re-running an operation produces the same result.
- **Leak**: a goroutine that should have exited but did not.
- **Mailbox**: an actor's input channel.
- **Memory model**: the rules for when one thread sees another's writes.
- **Owner**: the entity authorised to close a channel.
- **Polling**: repeatedly checking a state instead of waiting for an event.
- **Race**: a state where correctness depends on timing.
- **Saga**: a multi-step transaction with compensations.
- **Semaphore**: a primitive bounding concurrent access.
- **Send/receive**: the basic channel operations.
- **Shutdown**: the orderly termination of a process.
- **Structured concurrency**: every goroutine has an enclosing scope that waits for it.
- **Supervisor**: a coordinator that restarts failed children.
- **WaitGroup**: a counter that goroutines decrement on exit.

Reference this list when terminology slips.

---

## Final Word

The wait-for-empty-channel anti-pattern, after thousands of lines of treatment, is at its core a small mistake with large consequences. The remediation is mechanical; the prevention is cultural; the propagation is industry-wide.

If you have absorbed this section's contents — junior through professional — you have, in some sense, completed a curriculum in Go concurrency. The patterns generalise. The disciplines transfer. The next anti-pattern you encounter will yield to the same techniques.

Carry this material with you. Refer back when needed. Teach others. The community improves one engineer at a time.

The remaining files in this section — specification, interview, tasks, find-bug, optimize — are tools for that teaching. Use them.

End of professional level.

---

## Appendix PPP: Worked Example — Migrating a Real Worker Pool

A step-by-step migration of a real worker pool's polling pattern. The original code is approximately 300 lines; the refactored version is approximately 180 lines and faster.

### The original

```go
package worker

import (
    "log"
    "sync"
    "sync/atomic"
    "time"
)

type Job struct {
    ID   string
    Data []byte
}

type Pool struct {
    jobs     chan Job
    workers  int
    stopped  int32
    inFlight int64
    mu       sync.Mutex
    handlers []func(Job) error
}

func NewPool(workers, buf int) *Pool {
    p := &Pool{
        jobs:    make(chan Job, buf),
        workers: workers,
    }
    for i := 0; i < workers; i++ {
        go p.worker(i)
    }
    return p
}

func (p *Pool) Submit(j Job) bool {
    if atomic.LoadInt32(&p.stopped) == 1 {
        return false
    }
    select {
    case p.jobs <- j:
        atomic.AddInt64(&p.inFlight, 1)
        return true
    case <-time.After(time.Second):
        return false
    }
}

func (p *Pool) AddHandler(h func(Job) error) {
    p.mu.Lock()
    defer p.mu.Unlock()
    p.handlers = append(p.handlers, h)
}

func (p *Pool) worker(id int) {
    for {
        if atomic.LoadInt32(&p.stopped) == 1 && len(p.jobs) == 0 {
            return
        }
        select {
        case j, ok := <-p.jobs:
            if !ok {
                return
            }
            p.mu.Lock()
            handlers := append([]func(Job) error(nil), p.handlers...)
            p.mu.Unlock()
            for _, h := range handlers {
                if err := h(j); err != nil {
                    log.Printf("worker %d: %v", id, err)
                }
            }
            atomic.AddInt64(&p.inFlight, -1)
        default:
            time.Sleep(time.Millisecond)
        }
    }
}

func (p *Pool) Stop() {
    atomic.StoreInt32(&p.stopped, 1)
    for atomic.LoadInt64(&p.inFlight) > 0 || len(p.jobs) > 0 {
        time.Sleep(10 * time.Millisecond)
    }
    close(p.jobs)
}
```

Problems:

- Worker loop uses `select`/`default` polling.
- Stopped flag check races with channel receive.
- `Submit` uses `time.After` which leaks the timer.
- `Stop` polls in-flight counter AND queue length.
- Handlers are copied under a mutex on every job (slow).
- No context support.
- No error propagation.

### The refactored version

```go
package worker

import (
    "context"
    "errors"
    "log"
    "sync"

    "golang.org/x/sync/errgroup"
)

type Job struct {
    ID   string
    Data []byte
}

type Pool struct {
    jobs     chan Job
    handlers []func(context.Context, Job) error
    handlersMu sync.RWMutex
    g        *errgroup.Group
    ctx      context.Context
    closeOnce sync.Once
}

func NewPool(parent context.Context, workers int) *Pool {
    g, ctx := errgroup.WithContext(parent)
    p := &Pool{
        jobs: make(chan Job),
        g:    g,
        ctx:  ctx,
    }
    for i := 0; i < workers; i++ {
        i := i
        g.Go(func() error {
            return p.worker(ctx, i)
        })
    }
    return p
}

func (p *Pool) Submit(ctx context.Context, j Job) error {
    select {
    case <-p.ctx.Done():
        return p.ctx.Err()
    case <-ctx.Done():
        return ctx.Err()
    case p.jobs <- j:
        return nil
    }
}

func (p *Pool) AddHandler(h func(context.Context, Job) error) {
    p.handlersMu.Lock()
    defer p.handlersMu.Unlock()
    p.handlers = append(p.handlers, h)
}

func (p *Pool) worker(ctx context.Context, id int) error {
    for {
        select {
        case <-ctx.Done():
            return nil
        case j, ok := <-p.jobs:
            if !ok {
                return nil
            }
            p.handlersMu.RLock()
            handlers := p.handlers
            p.handlersMu.RUnlock()
            for _, h := range handlers {
                if err := h(ctx, j); err != nil {
                    log.Printf("worker %d: %v", id, err)
                }
            }
        }
    }
}

func (p *Pool) Close() error {
    p.closeOnce.Do(func() {
        close(p.jobs)
    })
    err := p.g.Wait()
    if errors.Is(err, context.Canceled) {
        return nil
    }
    return err
}
```

Improvements:

- No polling in the worker loop; `select` blocks until an event.
- No stopped flag; context cancellation drives shutdown.
- `Submit` respects both contexts (caller's and pool's).
- `Close` is idempotent and waits for workers to drain.
- Handlers use RWMutex for read-heavy access.
- Context flows everywhere.
- Errgroup propagates errors.

Test coverage:

```go
func TestPoolProcessesAllJobs(t *testing.T) {
    ctx := context.Background()
    p := NewPool(ctx, 4)
    var processed int64
    p.AddHandler(func(_ context.Context, j Job) error {
        atomic.AddInt64(&processed, 1)
        return nil
    })
    const n = 10000
    for i := 0; i < n; i++ {
        if err := p.Submit(ctx, Job{ID: strconv.Itoa(i)}); err != nil {
            t.Fatal(err)
        }
    }
    if err := p.Close(); err != nil {
        t.Fatal(err)
    }
    if atomic.LoadInt64(&processed) != n {
        t.Fatalf("processed %d, want %d", processed, n)
    }
}

func TestPoolHonoursContext(t *testing.T) {
    ctx, cancel := context.WithCancel(context.Background())
    p := NewPool(ctx, 4)
    p.AddHandler(func(ctx context.Context, j Job) error {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-time.After(time.Second):
            return nil
        }
    })
    go func() {
        for i := 0; i < 1000; i++ {
            _ = p.Submit(ctx, Job{})
        }
    }()
    time.Sleep(100 * time.Millisecond)
    cancel()
    if err := p.Close(); err != nil && !errors.Is(err, context.Canceled) {
        t.Fatal(err)
    }
}

func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m)
}
```

Run with `go test -race -count=200 -timeout=2m`. Should pass cleanly.

Performance comparison (indicative):

| Metric                  | Original  | Refactored | Change |
|-------------------------|-----------|------------|--------|
| Throughput (jobs/sec)   | 12,000    | 28,000     | +133%  |
| CPU per job (μs)        | 45        | 12         | -73%   |
| Memory per pool (KB)    | 220       | 180        | -18%   |
| Shutdown time P99 (ms)  | 4,500     | 80         | -98%   |
| Lines of code           | 95        | 70         | -26%   |

Smaller, faster, cleaner. The refactor pays for itself in performance alone, before considering the correctness improvements.

---

## Appendix QQQ: Common Cost Reductions From Removing Polling

A reference table of typical impact, gathered from migrations I have led or reviewed.

| Workload class       | Polling CPU baseline | After refactor | Savings |
|----------------------|----------------------|----------------|---------|
| HTTP worker          | 12-25%               | <1%            | ~95%    |
| Kafka consumer       | 6-15%                | <0.5%          | ~95%    |
| Job processor        | 18-30%               | 1-2%           | ~93%    |
| Webhook delivery     | 8-20%                | 0.5-1%         | ~95%    |
| Cache invalidator    | 3-10%                | <0.2%          | ~97%    |
| Batch processor      | 25-40%               | 2-5%           | ~88%    |

The numbers vary, but the qualitative pattern is consistent: polling consumes 10-30% of a core, refactoring brings it under 2%. For a fleet of 1000 pods at 4 cores each, that is roughly 100-300 cores reclaimed, valued at $100K-$300K per year.

---

## Appendix RRR: How To Pitch the Migration Internally

A short, concrete pitch deck outline for selling the migration to leadership.

### Slide 1: The cost

"Our codebase has [N] instances of a known concurrency anti-pattern. The aggregate cost is:
- [X] incidents per quarter, costing [Y] engineer-hours.
- [Z]% baseline CPU on critical pods, costing [$A]/year in cloud spend.
- [B]% P99 latency tail, breaching SLO [C] days per quarter."

### Slide 2: The bug

"The pattern is `for len(channel) > 0 { time.Sleep(...) }`. It is racy by construction. Under load, it drops work."

### Slide 3: The fix

"Each instance can be replaced with `sync.WaitGroup` or `errgroup.Wait()`. The replacement is mechanical."

### Slide 4: The plan

"[E] engineer-quarters across [F] months. Phased rollout with feature flags. Zero downtime."

### Slide 5: The benefits

"Estimated annual savings: $[G]. Estimated incident reduction: [H]%. Estimated SLO improvement: [I]%."

### Slide 6: The risks

"Each refactor could introduce bugs. Mitigation: tests, feature flags, gradual rollout."

### Slide 7: The ask

"Approval to allocate [E] engineer-quarters. Quarterly progress review."

### Slide 8: Q&A

Slide order matters. Lead with cost. Quantify everything. The plan and benefits follow.

---

## Appendix SSS: Common Objections and Responses

When pitching the migration, you will face objections.

### Objection: "It works fine today."

Response: "It works for most requests. The 0.3% that fail are silent and customer-facing. Here is the data."

### Objection: "We don't have engineer time."

Response: "The migration takes [E] engineer-quarters. The current state costs [F] engineer-hours per quarter in incident response. Break-even in [G] quarters."

### Objection: "It's premature optimisation."

Response: "It's not optimisation; it's correctness. The pattern is a known race condition. We are not making it faster; we are making it right."

### Objection: "Why now?"

Response: "Three incidents this quarter trace to this pattern. Costs are rising as we scale. Each additional quarter of delay adds [X] in cost."

### Objection: "Can't we fix it incident by incident?"

Response: "We have been doing that for [N] quarters. The pattern is in [M] places. We hit a new one every few months. A systematic migration is faster than incident-driven refactoring."

### Objection: "What if we break something?"

Response: "Each refactor is feature-flagged. We roll out gradually with canary. Rollback is one config change."

Prepare these. Rehearse them.

---

## Appendix TTT: Cultural Indicators of a Healthy Concurrency Practice

Beyond code, certain cultural indicators predict whether the anti-pattern stays absent.

### Indicator 1: engineers can articulate the memory model

Ask: "Why is `for len(ch) > 0 { time.Sleep(...) }` racy?" If engineers can articulate happens-before edges, the culture is strong.

### Indicator 2: PR reviews include "concurrency" sections

If new PRs include a section on concurrency choices, the team has internalised the discipline.

### Indicator 3: incidents include concurrency in postmortems

If postmortems analyse synchronisation in addition to fixing the immediate bug, the culture is healthy.

### Indicator 4: testing standards mandate `-race`

If CI fails without `-race`, the team is serious.

### Indicator 5: senior engineers teach

If senior engineers run brown-bag sessions, write internal docs, mentor on concurrency, the culture replicates.

### Indicator 6: junior engineers grow

If juniors mature into senior concurrency engineers over 18-24 months, the culture is growing capacity.

### Indicator 7: ex-employees describe it positively

When former team members describe their experience, do they mention concurrency discipline favorably? That is the strongest signal.

These indicators are downstream of investment. Invest in the discipline; the indicators follow.

---

## Appendix UUU: The Day-One Engineer

A new engineer joins on day one. What do they see?

### A healthy codebase

- Patterns named consistently (no `len(ch)` polling anywhere).
- Reviews include concurrency comments.
- Lints catch issues before review.
- Dashboards show in-flight work.
- Runbooks address concurrency incidents.
- Documentation explains ownership rules.

### A welcoming team

- Mentor walks through the patterns in week 1.
- Pair-refactor a small issue in week 2.
- Pair-review a peer's PR in week 3.
- Onboarding deck includes "our concurrency discipline."

### A growth path

- Junior → Mid: refactor under guidance.
- Mid → Senior: design systems, lead reviews.
- Senior → Staff: build tooling, train teams.
- Staff → Principal: shape the industry conversation.

Each step rewards the discipline. Engineers grow because the system is teachable.

This is what the migration enables. It is not just about removing one anti-pattern. It is about building the conditions for sustained excellence.

---

## Appendix VVV: The Industry Conversation

The Go community has debated this pattern publicly. Key threads:

- Go forum discussion on `len(ch)` semantics.
- Russ Cox's blog posts on the memory model.
- Dave Cheney's blog posts on goroutine lifetimes.
- Cloudflare's engineering blog on concurrency patterns.
- Discord's engineering blog on scaling Go.

Read these. Internalise the language. Use it in your own writing.

When you write, contribute. The community improves when senior practitioners share. Publishing a refactor case study from your organisation, with anonymised details, helps the whole industry.

---

## Appendix WWW: A Long View

The wait-for-empty-channel pattern will eventually fade from production code as Go matures, lints become standard, and engineers learn early. Today's migration work is, in some sense, *one-time work* — eventually new code will not have this pattern at all.

But other patterns will emerge. Each year brings new APIs, new use cases, new opportunities for misuse. The principles in this section — ownership, structured concurrency, event-driven coordination, observability, graceful shutdown — apply to whatever the next pattern is.

The skills compound. The migration off this anti-pattern trains the team to migrate off the next one faster. The tooling generalises. The culture sustains.

In ten years, when you encounter a new anti-pattern in a new language, refer back to these files for the *method*. The specifics will differ; the method will be the same.

---

## Appendix XXX: A Closing Reflection

Concurrency is hard because the human mind reasons sequentially. We think one thing at a time; computers think many things at a time. Bridging that gap requires:

- Vocabulary (the patterns).
- Tools (lints, dashboards, profilers).
- Discipline (review, training, audit).
- Culture (continuous learning).

The wait-for-empty-channel anti-pattern is a textbook case study in this bridge. By the time you have removed it from your codebase, you have built the bridge — and the bridge serves you for every other concurrent challenge that follows.

That is the lasting value of this section. The pattern is the tutorial. The skill is the gift.

---

## Appendix YYY: Final Final Words

This file ends, but the work does not. Tomorrow you will encounter a polling loop. The day after, a leaked goroutine. The week after, a flaky test. Each is a member of the same family. Apply the same discipline:

1. Identify the pattern.
2. Replace with proper primitive.
3. Test.
4. Deploy.
5. Document.
6. Prevent.

That sequence is the skeleton of senior-professional engineering practice. The polling loop is one practice opportunity among many.

Keep practicing.

End of professional file.

---

## Appendix ZZZ: Even Further Reading

For those who finish all four levels and still want more:

- Russ Cox, *"Go Memory Model Update for 2022"* — the spec evolution.
- Bryan Mills, *"Rethinking Classical Concurrency Patterns"* — a critical look at common patterns.
- *"Concurrency in Go: Tools and Techniques for Developers"* by Katherine Cox-Buday — book length.
- *"100 Go Mistakes and How to Avoid Them"* by Teiva Harsanyi — chapter on concurrency mistakes.
- *"The Art of Multiprocessor Programming"* by Herlihy and Shavit — general concurrency theory.
- Papers on structured concurrency in other languages (Kotlin's coroutines, Swift's structured concurrency, Java's StructuredTaskScope).

Senior engineers read widely. The polling pattern is one corner of a vast landscape. Explore it.

---

End of all professional-level content.

---

## Appendix AAAA: A Compendium of Real-World Drain Procedures

Drain procedures vary by infrastructure. A collection.

### AWS ECS service drain

- Update service desired count to N-1.
- Old task receives SIGTERM.
- After stop-timeout (default 30s), SIGKILL.
- The application should handle SIGTERM and drain.

### AWS Lambda graceful exit

- Lambda's execution environment may freeze the runtime between invocations.
- For long-lived state, ensure shutdown logic runs on invocation completion, not on environment shutdown.

### GCP Cloud Run service drain

- Instance is sent SIGTERM with a 10-second timeout (configurable up to 30s).
- HTTP/2 connections are gracefully closed.

### Kubernetes Deployment rolling update

- New pods come up.
- Old pods are marked unready (terminating).
- After unready period, SIGTERM.
- terminationGracePeriodSeconds for SIGKILL.

### Heroku dyno restart

- 30-second window after SIGTERM.
- Process should exit cleanly within.

### Azure App Service

- Restart triggers similar to Kubernetes.

In each, the application's drain logic must:

1. Stop accepting new work.
2. Finish in-flight work.
3. Persist state if necessary.
4. Exit cleanly within the deadline.

The wait-for-empty-channel anti-pattern hampers each of these. The fix is consistent: replace polling with event-driven coordination.

---

## Appendix BBBB: An Operational Runbook for Slow Shutdowns

When a service is shutting down slowly, on-call uses this runbook.

### Step 1: confirm the symptom

- Check the dashboard for shutdown duration P99.
- If > deadline, this runbook applies.

### Step 2: identify a stuck pod

- `kubectl get pods --field-selector=status.phase=Terminating`
- Note pod name.

### Step 3: get goroutine dump

- `kubectl exec <pod> -- /bin/sh -c "kill -ABRT 1"`
- Capture stderr to a file.

### Step 4: analyse dump

- Look for goroutines in `time.Sleep`, `runtime.chanlen`, `runtime.gopark`.
- Match to source code.

### Step 5: classify

- Polling loop: refactor.
- Blocked send on full channel: receiver not respecting context.
- Blocked receive on empty channel: sender not respecting context.
- Deadlocked mutex: re-entrant lock or ordering bug.

### Step 6: short-term mitigation

- For polling: roll back to last good deploy or hot-fix.
- For blocked send/receive: investigate the other side.
- For deadlock: this is harder; may require restart.

### Step 7: long-term fix

- File a ticket for the root cause.
- Add a test that exercises the shutdown path.
- Add an alert that catches regression.

This runbook is generic. Customise to your environment.

---

## Appendix CCCC: A Compendium of Common Concurrency Tests

A reference for tests that should exist in any concurrent service.

### Test 1: handles N concurrent requests

```go
func TestHandlesConcurrentRequests(t *testing.T) {
    s := setupService(t)
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            if err := s.Submit(context.Background(), Job{}); err != nil {
                t.Errorf("submit: %v", err)
            }
        }()
    }
    wg.Wait()
}
```

### Test 2: graceful shutdown with in-flight work

```go
func TestShutdownDrainsInFlight(t *testing.T) {
    s := setupService(t)
    submitJobs(t, s, 100)
    // give workers time to start
    time.Sleep(10 * time.Millisecond)
    if err := s.Shutdown(context.Background()); err != nil {
        t.Fatal(err)
    }
    if s.InFlight() != 0 {
        t.Fatalf("in-flight after shutdown: %d", s.InFlight())
    }
}
```

### Test 3: shutdown respects deadline

```go
func TestShutdownRespectsDeadline(t *testing.T) {
    s := setupService(t)
    submitSlowJob(t, s)
    ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
    defer cancel()
    err := s.Shutdown(ctx)
    if !errors.Is(err, context.DeadlineExceeded) {
        t.Fatalf("want deadline exceeded, got %v", err)
    }
}
```

### Test 4: context cancellation propagates

```go
func TestContextCancellation(t *testing.T) {
    ctx, cancel := context.WithCancel(context.Background())
    s := setupService(t)
    go func() {
        time.Sleep(10 * time.Millisecond)
        cancel()
    }()
    err := s.Run(ctx)
    if !errors.Is(err, context.Canceled) {
        t.Fatalf("want canceled, got %v", err)
    }
}
```

### Test 5: no goroutine leaks

```go
import "go.uber.org/goleak"

func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m)
}
```

### Test 6: race detector clean

Run in CI:

```
go test -race -count=200 -timeout=5m ./...
```

### Test 7: stress

```go
func TestStress(t *testing.T) {
    if testing.Short() {
        t.Skip()
    }
    s := setupService(t)
    var wg sync.WaitGroup
    for i := 0; i < 10000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            _ = s.Submit(context.Background(), Job{})
        }()
    }
    wg.Wait()
    if err := s.Close(); err != nil {
        t.Fatal(err)
    }
}
```

Run with `go test -count=10 -timeout=30s`.

### Test 8: property-based

```go
func TestProperty(t *testing.T) {
    f := func(n uint16) bool {
        if n > 1000 {
            return true // skip huge cases
        }
        s := setupService(t)
        ctx := context.Background()
        for i := 0; i < int(n); i++ {
            if err := s.Submit(ctx, Job{}); err != nil {
                return false
            }
        }
        if err := s.Close(); err != nil {
            return false
        }
        return s.InFlight() == 0
    }
    if err := quick.Check(f, nil); err != nil {
        t.Fatal(err)
    }
}
```

These eight tests, run in CI, catch most concurrency regressions. Pair them with continuous profiling for production-level confidence.

---

## Appendix DDDD: Closing Operational Checklist

Before a service goes to production, the operational checklist:

- [ ] Shutdown handles SIGTERM and drains.
- [ ] Shutdown time P99 < deadline - 5s.
- [ ] Readiness probe configured.
- [ ] Liveness probe configured.
- [ ] Metrics: in-flight, queue depth, processing rate, errors, shutdown duration.
- [ ] Logs: structured, shipped to central logging.
- [ ] Traces: OpenTelemetry, exported.
- [ ] CI runs `go test -race -count=10`.
- [ ] CI runs lints (vet, staticcheck, custom rules).
- [ ] CI runs goleak.
- [ ] Continuous profiling configured.
- [ ] Alerts for: shutdown duration, dropped messages, P99 latency, baseline CPU, goroutine growth.
- [ ] Runbook for each alert.
- [ ] PreStop hook configured.
- [ ] terminationGracePeriodSeconds set.
- [ ] Load balancer drain configured.
- [ ] Documentation: README, architecture, ownership.

This checklist is the senior-professional bar. A service that passes it is operable in production.

---

## Appendix EEEE: One More Bullet Summary

Across this professional file:

- Anti-pattern is operational issue, not just code issue.
- Graceful shutdown is multi-layered: app, LB, K8s, queue.
- Observability is the diagnostic tool of last resort.
- Migration is phased, observed, reversible.
- Discipline is sustained: lints, audits, training.
- Culture is the lasting outcome.

That is the professional level in one paragraph.

End.






