---
layout: default
title: Senior
parent: Graceful Shutdown
grand_parent: Production Patterns
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/18-production-patterns/04-graceful-shutdown/senior/
---

# Graceful Shutdown — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Architecting Shutdown as a Phase Machine](#architecting-shutdown-as-a-phase-machine)
3. [The Fleet Perspective](#the-fleet-perspective)
4. [Readiness Gates and LB Choreography](#readiness-gates-and-lb-choreography)
5. [Coordinated Shutdown Across Services](#coordinated-shutdown-across-services)
6. [Observability at Scale](#observability-at-scale)
7. [Tail-Latency Engineering of Drain](#tail-latency-engineering-of-drain)
8. [Failure Modes and Recovery](#failure-modes-and-recovery)
9. [Pre-Stop Hooks: Patterns and Pitfalls](#pre-stop-hooks-patterns-and-pitfalls)
10. [Force-Kill Mechanics: What `SIGKILL` Actually Does](#force-kill-mechanics-what-sigkill-actually-does)
11. [Resource Reclamation Beyond Sockets](#resource-reclamation-beyond-sockets)
12. [State Machines for Shutdown Coordination](#state-machines-for-shutdown-coordination)
13. [Designing for Long-Lived Connections](#designing-for-long-lived-connections)
14. [Pipeline Drain Patterns](#pipeline-drain-patterns)
15. [Cross-Service Idempotency for Drain](#cross-service-idempotency-for-drain)
16. [Architectural Smells](#architectural-smells)
17. [Service Mesh Considerations](#service-mesh-considerations)
18. [Cost and Trade-Off Analysis](#cost-and-trade-off-analysis)
19. [Closing Thoughts](#closing-thoughts)

---

## Introduction

At junior level you learned the recipe: signal handler, `Shutdown`, deadline, fallback. At mid level you learned the system: multiple subsystems, dependency order, time budgets, K8s cooperation. At senior level the question changes again. It is not "how do I make this one program shut down well" but "how do I design a fleet of services that collectively shut down and roll over without observable customer impact?"

This file is about:

- The **phase machine** as an architectural primitive: shutdown as an ordered series of states with explicit transitions, observable timings, and timeouts.
- The **fleet perspective**: deploys, rolling updates, autoscaling — how do many simultaneous shutdowns interact? What pathologies emerge at scale?
- **LB choreography**: getting clean handoffs between application drain and load balancer behaviour. The five-second window where a misstep costs you 200ms of 503s on a customer dashboard.
- **Observability at scale**: a shutdown SLO. Histograms of drain time. Alerts on slow drains. Traces that pinpoint the stuck dependency.
- **Failure modes**: what happens when a single dependency is slow during shutdown across the whole fleet. What happens when `SIGKILL` is the steady state.
- **Cost analysis**: longer `terminationGracePeriodSeconds` means slower rollbacks. Faster shutdown means more force-closes. Drawing the trade-off curve.

The senior engineer's job is not to type the right 15 lines into `main`. It is to know that the 15 lines exist, to know what they don't cover, and to design the surrounding system so the missing pieces are accounted for elsewhere.

---

## Architecting Shutdown as a Phase Machine

A shutdown is a small state machine. Naming the states makes the design explicit, the observability easier, and the failure modes obvious.

```
       READY
         │  SIGTERM
         v
       DRAINING
         │  readiness flipped, LB notified
         v
       CLOSING_INBOUND
         │  HTTP + gRPC + listener drained
         v
       STOPPING_BACKGROUND
         │  workers, queue consumers, refreshers exited
         v
       FLUSHING_OUTBOUND
         │  Kafka flushed, traces exported, logs flushed
         v
       RELEASING_RESOURCES
         │  DB closed, Redis closed, file handles released
         v
       EXITED
```

Seven states, six transitions. Each transition has an entry-action and a maximum duration. The whole machine has a total deadline. A failure at any transition triggers a fallback path.

### Why states matter

- **Observability.** Logs say "transitioning DRAINING → CLOSING_INBOUND". Dashboards show histograms of time-in-state.
- **Debugging.** When shutdown hangs, you know exactly which state it is stuck in.
- **Composition.** New shutdown work fits into an existing state, not a new one.
- **Testing.** Each transition can be tested in isolation.

### Implementing the phase machine

```go
type State int

const (
    StateReady State = iota
    StateDraining
    StateClosingInbound
    StateStoppingBackground
    StateFlushingOutbound
    StateReleasingResources
    StateExited
)

func (s State) String() string {
    return [...]string{"ready", "draining", "closing_inbound",
        "stopping_background", "flushing_outbound",
        "releasing_resources", "exited"}[s]
}

type ShutdownMachine struct {
    state      atomic.Int32
    startedAt  atomic.Int64
    transitions []Transition
}

type Transition struct {
    From, To  State
    MaxBudget time.Duration
    Run       func(context.Context) error
}

func (m *ShutdownMachine) Run(ctx context.Context, total time.Duration) error {
    m.startedAt.Store(time.Now().UnixNano())
    overall, cancel := context.WithTimeout(ctx, total)
    defer cancel()

    for _, t := range m.transitions {
        if State(m.state.Load()) != t.From {
            return fmt.Errorf("invalid state %v for transition", State(m.state.Load()))
        }
        log.Printf("transitioning %s -> %s", t.From, t.To)
        metrics.PhaseStarted.WithLabelValues(t.To.String()).Inc()
        start := time.Now()

        phaseCtx, phaseCancel := context.WithTimeout(overall, t.MaxBudget)
        err := t.Run(phaseCtx)
        phaseCancel()
        dur := time.Since(start)
        metrics.PhaseDuration.WithLabelValues(t.To.String()).Observe(dur.Seconds())

        if err != nil {
            metrics.PhaseFailed.WithLabelValues(t.To.String()).Inc()
            log.Printf("phase %s failed: %v (took %v)", t.To, err, dur)
            // strategy: log and continue, or fail-fast — depends on phase
            if t.To == StateClosingInbound || t.To == StateExited {
                continue // best-effort phases
            }
            return err
        }
        m.state.Store(int32(t.To))
        log.Printf("entered %s in %v", t.To, dur)
    }
    return nil
}
```

The machine is parameterised by transitions. Each transition has its own budget. The overall machine has a total budget. Phase failures are logged but the machine continues — partial drain is better than no drain.

### Building the transitions

```go
machine.transitions = []Transition{
    {
        From: StateReady, To: StateDraining, MaxBudget: 5 * time.Second,
        Run: func(ctx context.Context) error {
            ready.Store(false)
            select {
            case <-time.After(readyDelay):
            case <-ctx.Done():
            }
            return nil
        },
    },
    {
        From: StateDraining, To: StateClosingInbound, MaxBudget: 15 * time.Second,
        Run: func(ctx context.Context) error {
            eg, ectx := errgroup.WithContext(ctx)
            eg.Go(func() error {
                if err := apiSrv.Shutdown(ectx); err != nil {
                    _ = apiSrv.Close()
                    return err
                }
                return nil
            })
            eg.Go(func() error {
                return drainGRPC(ectx, grpcSrv)
            })
            return eg.Wait()
        },
    },
    {
        From: StateClosingInbound, To: StateStoppingBackground, MaxBudget: 5 * time.Second,
        Run: func(ctx context.Context) error {
            cancelWorkers() // workers' ctx is cancelled here
            return workers.Wait(ctx)
        },
    },
    // ... and so on
}
```

This is more verbose than a flat `errgroup`. The verbosity is the *point*: each phase is explicitly listed, sized, and ordered. New phases slot in. Time budgets are visible. Observability is automatic.

### State exposure

Expose the current state on the `/healthz` or `/readyz` endpoint:

```go
mux.HandleFunc("/healthz/state", func(w http.ResponseWriter, _ *http.Request) {
    fmt.Fprintln(w, State(machine.state.Load()))
})
```

Now during a hang, on-call engineers can `curl http://pod:8080/healthz/state` and see what phase it is stuck in.

### Per-state SLOs

```
slo:
  phase_draining_p99: 5s
  phase_closing_inbound_p99: 12s
  phase_stopping_background_p99: 4s
  phase_total_p99: 25s
  phase_total_p999: 30s
```

A single phase regression triggers a clear SLO violation. The SLO is the contract.

---

## The Fleet Perspective

A single pod's shutdown is interesting. A fleet of 1000 pods rolling over is a different problem.

### Pathology 1: Synchronised drain spike

When a deploy starts, K8s rolls pods in batches (configurable; default 25% at a time). At each batch, many pods enter DRAINING at the same second. If they all hit the same downstream during drain (Kafka flush, DB write), the downstream sees a synchronised burst.

The fix is to *desynchronise*: each pod adds random jitter before starting drain, on top of any `preStop` sleep.

```go
jitter := time.Duration(rand.Int63n(int64(500 * time.Millisecond)))
time.Sleep(readyDelay + jitter)
```

100ms–500ms of jitter spreads the burst over the LB-propagation window.

### Pathology 2: LB lag during fast rollouts

If the deploy rolls out faster than the LB's endpoint-update propagation, traffic can be routed to a pod that has already drained. Concretely: pod X drains in 25 seconds, exits. Pod Y replaces it. The LB still thinks pod X is healthy (its health-check probe was 4 seconds ago, and the propagation takes 5 seconds). Two seconds of "connection refused" errors.

Mitigations:

- **Slow the deploy.** Add a `minReadySeconds: 10` to the deployment. Pod waits 10 seconds after readiness before old pods are deleted.
- **Pre-readiness check.** Have the new pod wait for an external LB check to pass before considering itself ready.
- **Hold the listener open during drain.** The pod refuses *application-level* requests (returns 503) but keeps the TCP listener open until the LB has officially removed it.

### Pathology 3: Cascade during regional outage

A region becomes unhealthy. K8s drains all pods. The remaining region absorbs the traffic. If the remaining region is sized for 50% capacity, it gets 100% — and may go down too. Now the global service is down.

This is a capacity-planning problem more than a shutdown problem. But it intersects with shutdown: a clean drain of region A still puts the load on region B. Capacity must be provisioned with this in mind.

### Pathology 4: Slow drain monopolises capacity

If 10% of pods take 25 seconds to drain (and the other 90% drain in 1 second), during a rolling deploy the "slow tail" of pod drains dominates total deploy time. Fast pods cycle quickly; slow pods hold up the line.

Diagnostic: histogram of `shutdown_duration_seconds`. If the p99 is 5x the p50, you have a slow-tail problem.

Fix: identify what causes the tail. Usually one of:

- A specific request type that takes a long time (e.g., reports, exports).
- A specific dependency that occasionally hangs.
- A long-running stream that holds the connection.

Each gets its own fix. Senior engineers know to look at this histogram first.

### Pathology 5: Cascading SIGKILLs during incidents

In an incident where the underlying problem is "service is slow," the orchestrator may SIGKILL pods because their shutdowns time out. The SIGKILLs cause more in-flight failures, which cause more retries, which load the service further. The slowness compounds.

Mitigation: have the orchestrator detect "many SIGKILLs lately" and *slow down* the restart rate, or pause deploys entirely. Argo Rollouts, Spinnaker, and other deployment platforms support this.

---

## Readiness Gates and LB Choreography

The shutdown / LB-drain handoff is delicate. Done well, no customer notices a deploy. Done badly, every deploy is a small incident.

### The five layers of the handoff

1. **Application** decides it is draining (signal arrived). Internal state flips.
2. **`/readyz`** returns 503. The application is no longer claiming readiness.
3. **kubelet probe** notices the 503. Probe period × failure threshold determines how fast this happens. Default: 10s × 3 = 30s. Tuned for shutdown: 1s × 2 = 2s.
4. **K8s API server** receives the readiness change. Endpoints object updated.
5. **kube-proxy / Service controller** propagates the update to iptables / IPVS. Traffic stops being routed to this pod.

Step 3 and step 5 are the slow ones. With aggressive tuning, the full propagation is 2–5 seconds. Without tuning, 30+ seconds.

The `readyDelay` (or `preStop` sleep) must be at least the propagation time. Otherwise you start refusing requests before the LB stops sending them.

### Tuning readiness probe for fast detection

```yaml
readinessProbe:
  httpGet:
    path: /readyz
    port: 8080
  initialDelaySeconds: 1
  periodSeconds: 1
  failureThreshold: 2
  successThreshold: 1
```

`failureThreshold: 2` and `periodSeconds: 1` means: 2 consecutive failures, 1 second apart. Detection takes 2 seconds.

Make sure your `/readyz` handler is fast and never blocks. A slow `/readyz` adds to detection time.

### The 503 vs RST trade-off

When draining, the choice is:

- **503 (application-level).** TCP connection still established. Client sees an HTTP error.
- **RST (connection reset).** TCP layer rejects. Client sees a connection error.

503 is friendlier: clients can retry on a 503; many SDKs do. RST is harder to retry because the request never made it.

A well-behaved drain *prefers* 503 over RST. This means:

- During the readiness-flip phase, return 503 for all requests.
- During the `Shutdown` phase, the listener is still accepting but rejecting? No — `Shutdown` closes the listener. After listener close, the OS-level RST is what clients see.

The right model: flip readiness early, give the LB time to remove the pod, *then* close the listener. The window between readiness-503 and listener-close should cover the LB's removal latency.

### `preStop` hook patterns

The most common `preStop`:

```yaml
lifecycle:
  preStop:
    exec:
      command: ["/bin/sh", "-c", "sleep 5"]
```

The sleep lets the LB notice readiness has flipped (which it does in response to `/readyz` returning 503) before SIGTERM is delivered.

A more sophisticated `preStop`:

```yaml
lifecycle:
  preStop:
    httpGet:
      path: /admin/prestop
      port: 8080
```

The application implements `/admin/prestop`:

```go
mux.HandleFunc("/admin/prestop", func(w http.ResponseWriter, _ *http.Request) {
    ready.Store(false)
    log.Println("preStop: readiness flipped")
    time.Sleep(5 * time.Second)
    w.WriteHeader(http.StatusOK)
})
```

This way the readiness flip happens *inside* `preStop`, before SIGTERM. The application's signal handler then proceeds straight to the actual drain — no `readyDelay` needed because preStop already covered it.

### Diagnosing handoff failures

The signature symptom: a spike of 502 / 503 errors at deploy time, concentrated in a 1–5 second window per pod.

Investigation:

1. Plot `http_request_total{status="503"}` over time. The spike should align with deploys.
2. Plot `pod_status_change` events. The 503 should start *after* readiness flips and *before* listener closes.
3. If the 503 starts *before* readiness flips, application is rejecting too early.
4. If the 503 ends *after* listener closes, LB is still routing — too late.

Each of these has a different fix. The senior engineer knows to look here first.

---

## Coordinated Shutdown Across Services

A monolithic service shuts down on its own. A microservice ecosystem must shut down with awareness of its peers.

### The retry problem

Service A calls service B. B is rolling its pods. B's pod #1 is draining. A's request lands on B's pod #1 just as it begins shutdown. B returns 503. A retries — and the retry might land on another B pod that is also draining.

Mitigation:

- **A retries.** SDKs should retry on 503 with exponential backoff. This is the most important property.
- **B drains slowly.** With a small fleet, B's drains stagger. With a large fleet and slow rollouts, drains are sparse.
- **Idempotency.** A's retries must be safe; B's handlers must handle retries.

### Circuit breakers and drain

A's circuit breaker for B may trip during B's deploys (5xx rate spikes). Tripping the breaker for 30 seconds is fine — it lets B's deploy complete. But if the breaker's window is shorter than the deploy, the breaker may oscillate (open / closed / open) during the deploy, which is worse than steady state.

Set the circuit breaker's window to be at least one full deploy duration. For most services, 60 seconds is enough.

### Health-aware load balancers

Modern LBs (Envoy, NGINX Plus) can mark backends as "unhealthy" not just by probe failure but by *response code patterns*. If a backend returns 503 to many requests, the LB stops routing to it without waiting for the next probe.

This is called "panic mode" in Envoy. It gives faster reaction to drains and dramatic capacity changes.

### Cascading deploys

In a service graph, the order of deploys matters. Deploying service A (front-end) first while B (downstream) is also deploying means A is talking to half-drained B pods. The combined drop in capacity (A losing pods + B losing pods) can spike error rates.

Mitigations:

- **Sequential deploys.** Deploy B first; let it fully roll out; deploy A. Adds deploy time.
- **Surge capacity.** During deploys, keep extra pods alive. K8s `maxSurge` allows this.
- **Region isolation.** Deploy to one region at a time; the other regions absorb the load.

Most teams use surge capacity. `maxSurge: 25%` means 25% extra pods exist during the deploy, absorbing the drain.

---

## Observability at Scale

A fleet of 1000 pods produces 1000 shutdowns per deploy. Observing them at scale requires aggregation, not per-pod inspection.

### Key dashboards

1. **Shutdown duration histogram.** p50, p90, p99, p999 over time. Watch the tail.
2. **Force-close rate.** `shutdown_force_close_total` over `shutdown_started_total`. Should be near zero.
3. **Per-phase duration histograms.** Where does the time go?
4. **In-flight at shutdown.** Distribution of "how many requests in flight when SIGTERM arrives." High values indicate slow handlers.
5. **5xx during deploys.** Should be flat. A bump at deploy time is a regression.

### Alerting rules

- `shutdown_force_close_total / shutdown_started_total > 0.01` over 1 hour: 1% of shutdowns are force-closing. Page.
- `shutdown_duration_seconds_p99 > 25s`: drain time is dangerously close to the K8s budget.
- `phase_duration_seconds{phase="closing_inbound"}_p99 > 15s`: HTTP drain is slow; likely a stuck handler.
- `inflight_at_shutdown_p99 > N`: many requests caught mid-flight; suggests bursty traffic or slow handlers.

### Tracing shutdown spans

When using OpenTelemetry, a span per phase produces a flame graph of the shutdown. In Datadog APM or Honeycomb, the flame is immediately searchable: "show me shutdowns where phase=closing_inbound > 10s."

```go
tracer := otel.Tracer("shutdown")
ctx, span := tracer.Start(ctx, "shutdown")
defer span.End()

for _, t := range transitions {
    _, phaseSpan := tracer.Start(ctx, "phase."+t.To.String())
    err := t.Run(phaseCtx)
    if err != nil { phaseSpan.RecordError(err) }
    phaseSpan.End()
}
```

The trace is exported on every shutdown, even successful ones. Looking at a slow shutdown means filtering traces by `duration > 10s` and reading the flame graph.

### Logs as a timeline

A structured log line per state transition, with deploy and pod IDs:

```json
{"ts":"2026-05-15T12:00:05Z","level":"info","msg":"shutdown phase entered",
 "deploy":"abc123","pod":"checkout-7d","from":"ready","to":"draining"}
```

Aggregated by log platform (Loki, Splunk, Datadog Logs), these tell the story of every deploy. A single SQL-like query: "show me pods where the draining phase took > 10 seconds" returns the outliers.

### A simple shutdown SLO

```
target: 99.9% of shutdowns complete within 25 seconds.
error_budget: 0.1% per month.
```

If your error budget burns, deploys are unsafe and engineering effort focuses on shutdown until the budget recovers. This is "SLOs as policy" — a senior-level discipline.

---

## Tail-Latency Engineering of Drain

The p50 shutdown is usually fine. The p99 is what hurts. A small fraction of slow drains cause most of the operational pain.

### Tail-driven analysis

Plot `shutdown_duration_seconds` by percentile. Often you see:

- p50: 3 seconds
- p90: 5 seconds
- p99: 18 seconds
- p999: 28 seconds (right at the cliff)

The p999 is 1 in 1000. If you deploy 100 pods/day, you hit it every 10 days. The p999 sets the operational risk.

To shrink the tail:

1. **Per-handler timeouts.** Cap every handler at, say, 10 seconds. No single handler can take 25 seconds.
2. **Cancellable I/O.** Every I/O takes `ctx`. No `time.Sleep` or `time.After` without `select`.
3. **Aggressive defaults.** Short keepalive idle, short ReadHeaderTimeout, short WriteTimeout. Slow clients don't hold drain.
4. **Limit stream durations.** Streaming responses cap at, say, 60 seconds. After that, the server proactively closes.
5. **Backpressure on inflight.** If inflight > N, return 503 immediately. Prevents pile-up before shutdown.

Each of these compresses the tail. Combined, they can bring p999 from 28 seconds to 5 seconds.

### Per-handler budget design

Instead of one global `Shutdown` budget, give each *handler type* its own budget.

```go
type handlerSpec struct {
    timeout time.Duration
}

handlers := map[string]handlerSpec{
    "/api/users":        {timeout: 5 * time.Second},
    "/api/checkout":     {timeout: 30 * time.Second}, // payment processing
    "/api/export":       {timeout: 60 * time.Second}, // large exports
    "/api/stream":       {timeout: 0},                // streaming, special-case
}
```

Express in middleware:

```go
func timeoutMiddleware(timeout time.Duration) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            if timeout > 0 {
                ctx, cancel := context.WithTimeout(r.Context(), timeout)
                defer cancel()
                r = r.WithContext(ctx)
            }
            next.ServeHTTP(w, r)
        })
    }
}
```

Now the `/api/export` handler can take 60 seconds while `/api/users` is capped at 5. The global drain budget is 25 seconds — but `/api/export` already has a per-handler budget of 60 seconds, so it won't reach the global drain unless it's blocked beyond its own budget too.

Realistic shutdown: short-handler requests drain first, long-handler requests get force-closed at the drain deadline. Acceptable trade-off if `/api/export` is rare.

### Identifying which handler is the slow tail

Instrument per-handler shutdown latency:

```go
defer func(start time.Time, path string) {
    metrics.HandlerDurationDuringShutdown.WithLabelValues(path).
        Observe(time.Since(start).Seconds())
}(time.Now(), r.URL.Path)
```

The dashboard reveals which path is the long tail. Usually it is one specific endpoint. Fix it (timeout, refactor) and the tail collapses.

---

## Failure Modes and Recovery

A shutdown can fail in many ways. Senior engineers anticipate each.

### Failure 1: Signal not received

The container is not PID 1, or PID 1 does not forward signals. SIGTERM goes to PID 1 (a shell) and is not forwarded to the Go binary.

Symptom: pod reaches `terminationGracePeriodSeconds` then SIGKILLed.

Fix: use `exec` in entrypoint (`ENTRYPOINT ["/app/server"]`) or a proper init system (tini) that forwards signals.

### Failure 2: Signal received but handler not registered

`signal.Notify` was called but the channel is full or unbuffered. The signal is dropped.

Symptom: same as #1 — pod reaches grace period and is killed.

Fix: use `signal.NotifyContext` (auto-buffered) or `make(chan os.Signal, 1)`.

### Failure 3: `Shutdown` blocks indefinitely

A handler runs forever (infinite loop or external dependency hang). `Shutdown` waits up to the deadline. If the deadline is `context.Background()`, it waits forever.

Symptom: shutdown never completes.

Fix: always bound `Shutdown` with `context.WithTimeout`. Always have a `Close` fallback.

### Failure 4: `Close` does not close

`http.Server.Close` is documented to close active connections. But it does not cancel hijacked connections (WebSockets), and it does not signal blocked goroutines elsewhere in the program.

Symptom: process hangs even after `Close`.

Fix: explicitly close WebSocket registries, cancel goroutine contexts, etc.

### Failure 5: Deadlock between phases

Phase 1 holds a mutex. Phase 2 tries to acquire it. The phases serialise.

Symptom: shutdown takes much longer than expected; each phase appears to wait on the previous.

Fix: avoid shared mutexes in shutdown paths. Or release before entering shutdown.

### Failure 6: Panic in shutdown

A `defer` calls into code that panics. The panic propagates; remaining defers may or may not run depending on placement.

Symptom: partial cleanup; resource leaks visible in subsequent runs.

Fix: wrap risky shutdown code in `defer recover()`. Log panics but continue.

```go
func safe(fn func()) {
    defer func() {
        if r := recover(); r != nil {
            log.Printf("panic in shutdown: %v", r)
        }
    }()
    fn()
}

safe(func() { kafka.Close() })
safe(func() { redis.Close() })
safe(func() { db.Close() })
```

### Failure 7: Resource leak across runs

A test starts and stops a server many times. Each iteration leaks a file descriptor or a goroutine.

Symptom: tests pass individually but fail when run in sequence; "too many open files."

Fix: `defer stop()` after every `signal.NotifyContext`. Verify with `runtime.NumGoroutine()` in tests.

### Recovery strategy: "best-effort partial drain"

A senior pattern: if a phase fails, log loudly and continue. Better to drain 80% than to hang on the slow 20%.

```go
for _, t := range transitions {
    if err := runPhase(ctx, t); err != nil {
        log.Printf("phase %s failed: %v; continuing", t.To, err)
        metrics.PhaseFailed.WithLabelValues(t.To.String()).Inc()
    }
}
```

The risk: a failed phase may leave subsequent phases in an inconsistent state. Mitigation: each phase's run function must be independent — it cannot depend on the previous phase having fully completed.

---

## Pre-Stop Hooks: Patterns and Pitfalls

`preStop` is more powerful than just `sleep 5`. Used well, it is the cleanest way to coordinate application and orchestrator.

### Pattern: HTTP preStop

```yaml
lifecycle:
  preStop:
    httpGet:
      path: /admin/prestop
      port: 8080
```

The application handles the request:

```go
mux.HandleFunc("/admin/prestop", func(w http.ResponseWriter, _ *http.Request) {
    log.Println("preStop hook fired")
    machine.MoveTo(StateDraining) // explicit state transition
    time.Sleep(readyDelay)
    w.WriteHeader(http.StatusOK)
})
```

Benefits:

- Application controls the readyDelay.
- preStop response time is visible in K8s events.
- The handler can do other work: notify upstream, log to APM, etc.

### Pattern: exec preStop with cleanup script

```yaml
lifecycle:
  preStop:
    exec:
      command:
      - /bin/sh
      - -c
      - |
        echo "draining" > /tmp/draining
        sleep 5
```

The application can check `/tmp/draining` to determine state. Useful for legacy applications that cannot easily implement HTTP endpoints.

### Pitfall: preStop blocking forever

K8s will wait for the preStop to complete *up to `terminationGracePeriodSeconds`*. If preStop hangs, SIGTERM is *never* sent. The pod is SIGKILLed at the deadline.

Symptom: process exits abruptly without any drain logs.

Mitigation: cap preStop duration explicitly. `sleep 5` is bounded; an HTTP call without a timeout is not.

### Pitfall: preStop runs in the same container

`preStop` runs in the container. If the container is busy (e.g., 100% CPU on a request burst), the preStop may not run promptly. Setting reasonable CPU requests/limits helps.

### Pitfall: preStop after readiness change is racy

Theoretically: K8s removes the pod from endpoints *first*, then runs preStop. In practice the order is "approximate" because the endpoints update propagates through controllers asynchronously.

If your service depends on the endpoint being removed before preStop, add explicit wait logic in the application's signal handler too. Belt and braces.

---

## Force-Kill Mechanics: What `SIGKILL` Actually Does

When `SIGKILL` lands, your process is gone in microseconds. Understanding what survives and what doesn't is the senior-level skill.

### What dies immediately

- The process's memory.
- Goroutines, threads, all stack state.
- File handles (the kernel closes them, but does not call your `defer file.Close()`).
- Network sockets (RST is sent to the other end).
- Mapped memory regions.

### What might survive

- Buffered writes in the kernel that are already flushed. Data that hit the OS's write buffer before SIGKILL is still flushed to disk.
- Connections in the kernel's listen queue (other clients can connect to the next process bound to the same port).
- IPC objects (Unix sockets, shared memory) — until the kernel cleans them up.

### What is definitely lost

- In-memory buffers (your application's log buffer, metrics buffer).
- In-flight HTTP responses (clients see connection reset).
- Active database transactions (rolled back).
- Mid-transit Kafka messages (producer's buffer, never sent).

### Implications

- **Don't rely on `defer` after SIGKILL.** Use `flush` calls in your shutdown path, before the SIGKILL window.
- **Don't store critical state in memory only.** Persist regularly.
- **Make every operation idempotent.** A SIGKILL during an operation leaves the system in a partially-applied state.

### How to make SIGKILL rare

- Keep `Shutdown` deadline well under `terminationGracePeriodSeconds`. Margin matters.
- Cap per-handler latencies. No handler should run for more than half the shutdown budget.
- Monitor `shutdown_force_close_total`; alert if non-zero.

A well-engineered service should see SIGKILL only in true emergencies (node failure, kernel issue). Daily operations should produce zero SIGKILLs.

---

## Resource Reclamation Beyond Sockets

The classic shutdown story is about sockets. Real services have more.

### File handles

Open files (logs, config files, data files) should be closed. The OS closes them anyway on process exit, but explicit close ensures buffered writes flush.

### Memory-mapped files

`mmap`'d regions are released on process exit. If you have writes pending, `Msync` first.

### Subprocesses

If your service spawns subprocesses (`exec.Cmd`), they may outlive the parent. Track and kill them in shutdown:

```go
type ProcessRegistry struct {
    mu        sync.Mutex
    processes []*exec.Cmd
}

func (r *ProcessRegistry) Add(c *exec.Cmd) {
    r.mu.Lock()
    defer r.mu.Unlock()
    r.processes = append(r.processes, c)
}

func (r *ProcessRegistry) KillAll(timeout time.Duration) {
    r.mu.Lock()
    procs := append([]*exec.Cmd(nil), r.processes...)
    r.mu.Unlock()

    for _, p := range procs {
        if p.Process != nil {
            _ = p.Process.Signal(syscall.SIGTERM)
        }
    }

    done := make(chan struct{})
    go func() {
        for _, p := range procs {
            _ = p.Wait()
        }
        close(done)
    }()

    select {
    case <-done:
    case <-time.After(timeout):
        for _, p := range procs {
            if p.Process != nil {
                _ = p.Process.Kill() // SIGKILL
            }
        }
    }
}
```

### Tempfiles

If your service creates tempfiles, clean them up in shutdown.

```go
defer os.RemoveAll(tempDir)
```

Or use `os.MkdirTemp` and track for cleanup.

### External locks

If your service holds a distributed lock (Redis, etcd), release it in shutdown. Otherwise the lock persists for the TTL, blocking other instances from acquiring it.

```go
defer lock.Release(context.Background())
```

### DNS cache entries (rare)

Some clients cache DNS forever. If the next instance needs the same name resolved, this is fine. Rarely a shutdown concern.

### Memory profiling and pprof endpoints

The pprof goroutines are managed by the runtime; they exit on `os.Exit`. No special handling needed.

---

## State Machines for Shutdown Coordination

The phase machine from earlier was simple — linear states. For complex services, a richer state machine helps.

### States that branch

Some services have optional phases. For example, "if there's a running export, wait for it" — but the wait is only relevant if an export is in progress.

```
ENTRY
  ├── (no export running) → SKIP_EXPORT_WAIT
  └── (export running) → WAIT_FOR_EXPORT → SKIP_EXPORT_WAIT
SKIP_EXPORT_WAIT → CLOSING_INBOUND → ...
```

The conditional branch is just an `if` in code, but having it as an explicit state in the machine makes observability easier.

### Substates

A "draining inbound" phase has substates for HTTP drain and gRPC drain that run in parallel.

```
CLOSING_INBOUND
  ├── HTTP_DRAINING (parallel)
  └── GRPC_DRAINING (parallel)
  → both done → next phase
```

Track each substate's timing independently. The dashboard shows which is the slower of the two.

### Retry-on-failure states

Some phases benefit from retry. "Flush Kafka producer" might fail because of a network blip. Retry with backoff:

```go
for attempt := 0; attempt < 3; attempt++ {
    if err := producer.Flush(ctx); err == nil {
        break
    }
    select {
    case <-time.After(time.Duration(attempt+1) * time.Second):
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

The retries fit in the phase budget. If the phase budget exhausts, move on; some Kafka messages will be lost.

### Roll-back states

Some shutdowns can roll back: "we were going to drain, but the upstream said 'wait'." The pod un-flips readiness and goes back to READY.

This is rare. Most shutdowns are one-way. But scenarios where it matters: graceful kill-switch tests, partial deploys where one pod is told to rejoin the pool, etc.

If you support roll-back, the state machine is more complex. Most teams don't bother; SIGTERM is interpreted as "definitely shutting down" and roll-back is not supported.

---

## Designing for Long-Lived Connections

WebSockets, SSE, gRPC streams, raw TCP — all keep connections open for minutes or hours. Graceful shutdown for these is fundamentally different from request-response.

### Strategy 1: Send a close-soon notification

The client subscribes to a special "control channel." On shutdown, send a "reconnect please" event.

```go
type CloseSoonEvent struct {
    Reason string `json:"reason"`
    GraceSecs int `json:"grace_secs"`
}
```

Clients respect this by reconnecting. With many replicas, the new connection lands on a different pod. The current pod's connections drain naturally as clients move.

### Strategy 2: Active close with reconnect hint

Server actively closes the connection with a status code hinting at reconnect.

For WebSockets:

```go
conn.WriteControl(websocket.CloseMessage,
    websocket.FormatCloseMessage(1001, "server going away"),
    time.Now().Add(time.Second))
```

Status 1001 ("going away") tells the client this is not an error; reconnect.

For gRPC streams, close the stream with a status like `Unavailable` and clients reconnect.

### Strategy 3: Long deadlines

If you cannot send a hint (legacy clients), the shutdown waits for connections to naturally end. Acceptable if your stream durations are bounded; problematic if they are unbounded.

### Strategy 4: Hand off connections to a new pod

Rare in K8s; common in dedicated systems. The current pod tells the LB "for this client, route to pod B from now on." Requires explicit LB cooperation (e.g., Envoy's hot restart).

Most teams use strategy 1 or 2. Strategy 4 is for specialised environments.

### Implementation: a registry-based drain

```go
type StreamRegistry struct {
    mu      sync.RWMutex
    streams map[string]*Stream
}

type Stream struct {
    ID     string
    Close  func() error
    Inform func() error
}

func (r *StreamRegistry) Drain(ctx context.Context) error {
    r.mu.RLock()
    items := make([]*Stream, 0, len(r.streams))
    for _, s := range r.streams {
        items = append(items, s)
    }
    r.mu.RUnlock()

    // Send "going away" to all
    for _, s := range items {
        _ = s.Inform()
    }

    // Wait for client-driven disconnects
    deadline := time.Now().Add(20 * time.Second)
    for time.Now().Before(deadline) {
        r.mu.RLock()
        count := len(r.streams)
        r.mu.RUnlock()
        if count == 0 {
            return nil
        }
        select {
        case <-ctx.Done():
            break
        case <-time.After(500 * time.Millisecond):
        }
    }

    // Force-close stragglers
    r.mu.RLock()
    items = items[:0]
    for _, s := range r.streams {
        items = append(items, s)
    }
    r.mu.RUnlock()
    for _, s := range items {
        _ = s.Close()
    }
    return nil
}
```

This is a two-phase drain inside the long-lived connection world: inform (cooperative), wait, force-close. The shape is identical to HTTP `Shutdown` / `Close`; only the units differ.

---

## Pipeline Drain Patterns

Many Go services are pipelines: stage 1 reads, stage 2 transforms, stage 3 writes. Draining a pipeline correctly is its own subtopic.

### Linear pipeline

```
INPUT → stage1 → stage2 → stage3 → OUTPUT
```

Drain by closing the input. Each stage `range`s over its input; when the channel closes, the stage processes remaining work and closes its output. The drain propagates downstream naturally.

```go
func stage(ctx context.Context, in <-chan T, out chan<- U) {
    defer close(out)
    for {
        select {
        case <-ctx.Done():
            return
        case v, ok := <-in:
            if !ok { return }
            out <- transform(v)
        }
    }
}
```

On shutdown, the *source* of the pipeline observes `ctx.Done()` and stops producing. Its output channel is closed. Downstream stages drain their inputs and exit.

### Fan-out / fan-in pipeline

```
INPUT → splitter → worker1, worker2, worker3 → joiner → OUTPUT
```

Draining a fan-out is a generalisation. The splitter observes cancellation, stops producing, closes worker inputs. Workers drain their channels. The joiner closes its output once all workers are done.

```go
func fanIn(ins []<-chan T, out chan<- T) {
    var wg sync.WaitGroup
    for _, in := range ins {
        wg.Add(1)
        go func(in <-chan T) {
            defer wg.Done()
            for v := range in {
                out <- v
            }
        }(in)
    }
    go func() { wg.Wait(); close(out) }()
}
```

After the workers' inputs close, the workers' `range` ends, the goroutines exit, `wg.Wait()` returns, the output is closed. The drain propagates.

### Cyclic pipeline (rare)

If your pipeline has cycles, drain is harder. Cancellation cannot propagate around a cycle. You need explicit "shutdown" messages or a separate cancellation context.

Most well-designed pipelines are acyclic. If yours has a cycle, consider refactoring.

### Batched stages

If a stage processes work in batches (e.g., insert 100 rows at a time), the partial batch at shutdown is a special case. Options:

- **Flush the partial batch.** Insert what you have.
- **Discard the partial batch.** Pretend it didn't arrive; the previous stage's work is lost.
- **Re-queue the partial batch.** Put it back somewhere for next time.

For idempotent writes, flushing is best. For non-idempotent, re-queue is best.

---

## Cross-Service Idempotency for Drain

A frequent senior-level concern: drains across services interact with retries. The cure is idempotency.

### What is "idempotent"

An operation is idempotent if executing it N times has the same effect as executing it once. `SET x = 5` is idempotent; `INCR x` is not.

If service A calls service B with an idempotency key, B can detect "I already processed this" and return the previous response. Retries become safe.

### Idempotency in HTTP

The convention is an `Idempotency-Key` header:

```
POST /api/charge
Idempotency-Key: 7b1c-1234-5678-90ab
Content-Type: application/json

{ "amount": 100.00 }
```

Server stores: "this key → this response." Retries return the same response.

The key must be unique per logical operation. Generate it on the client, persist it, send it with retries.

### Idempotency in async messaging

Kafka messages include a unique ID. Consumers deduplicate by ID before processing.

In Kafka producers, the `enable.idempotence: true` setting ensures each message is delivered exactly once (within a session). Combined with consumer-side deduplication, this gives end-to-end idempotency.

### Idempotency and shutdown

The connection: during shutdown, requests in-flight may be retried by clients. Without idempotency, retries cause duplication. With idempotency, retries are safe.

Senior services design idempotency for *every* state-changing endpoint. The combination of idempotency + graceful shutdown produces "no observable disruption during deploys."

---

## Architectural Smells

A few patterns that, when seen, suggest deeper shutdown problems.

### Smell: Hard-coded sleeps in shutdown code

```go
time.Sleep(10 * time.Second)
```

A magic number suggests the engineer tried different values until one worked. Better: derive the number from a probe interval or measured latency.

### Smell: Many `time.After` calls in `select`

```go
select {
case <-time.After(time.Second):
case <-ctx.Done():
}
```

Each `time.After` creates a timer that survives even if the select exits early. Repeated use leaks. Use `time.NewTimer` with explicit `Stop`.

### Smell: `os.Exit` after `Shutdown`

```go
_ = srv.Shutdown(ctx)
os.Exit(0)
```

`os.Exit` skips all deferred cleanup. Why is it here? Sometimes because main is otherwise blocked, sometimes by habit. Either is a smell.

### Smell: Two separate signal handlers

```go
go handleSignals1()
go handleSignals2()
```

One should be enough. Multiple handlers race for the same signal.

### Smell: Different shutdown deadlines in different code paths

```go
func main() {
    // ...
    srv.Shutdown(ctx5)  // 5 second deadline
}

func handleErr() {
    // ...
    srv.Shutdown(ctx30) // 30 second deadline
}
```

The deadlines disagree. Centralise.

### Smell: Closing channels in random places

```go
close(events)
```

Channel ownership unclear. Multiple closers cause panic. Refactor to "single owner."

### Smell: `select` with default in a hot loop

```go
for {
    select {
    case <-ctx.Done():
        return
    default:
        process()
    }
}
```

This is a busy-wait. Replace with blocking on a channel.

### Smell: `panic` in shutdown code

```go
panic(err)
```

Unrecovered panic in shutdown propagates and may skip subsequent cleanup. Log and continue.

### Smell: Shutdown blocking on `Wait()`/`Lock()` indefinitely

```go
wg.Wait()
mu.Lock()
```

No deadline. If something hangs, shutdown hangs.

---

## Service Mesh Considerations

Service meshes (Istio, Linkerd) sit between services as sidecars. They affect shutdown.

### Sidecar lifetimes

Istio's `envoy` sidecar shares the pod lifecycle. When the pod is terminating, both your container and envoy receive SIGTERM. If envoy exits before your application, in-flight requests cannot egress.

Fix: configure envoy to drain *after* your application via `holdApplicationUntilProxyStarts` and a `preStop` hook on envoy.

### mTLS handshake during drain

The sidecar handles mTLS. During the drain window, the sidecar may close the listener, terminating in-flight handshakes. Some 503s come from this even if your app is fine.

Fix: tune envoy's drain settings. Most service mesh installations have sane defaults; verify they match your application's expectations.

### Tracing through the mesh

The mesh injects tracing headers. Your shutdown spans should propagate them so the trace shows the full request path even during drain.

### Load balancing within the mesh

Mesh LB is more aware than naive K8s Service routing. Envoy can see "this pod is draining" sooner because it sees the 503 responses directly. Helpful.

### Cost

Service meshes add per-request latency (often 1–3 ms) and per-pod resource cost. Many teams adopt them for security and observability and accept the cost. Some don't. For shutdown specifically, mesh helps with LB coordination but adds shutdown complexity.

---

## Cost and Trade-Off Analysis

Senior engineering is about trade-offs. The shutdown choices have specific costs.

### Cost: longer `terminationGracePeriodSeconds`

Pros: more time for drain, more lenient to slow handlers.
Cons: slower rolling deploys. Rollback takes longer if a bad version needs to be killed quickly.

Numbers: increase from 30s to 60s. A deploy of 100 pods, rolled 25% at a time (25 batches), takes 25 × 30s = 12.5 minutes longer. Across the year, hundreds of hours of operator wait.

### Cost: shorter drain deadline

Pros: faster shutdowns, faster deploys.
Cons: more force-closes; more in-flight requests dropped.

Numbers: 25s → 10s drain budget. If p99 handler latency is 8s, p999 latency is 15s. Now 0.1% of shutdowns force-close. At 100 deploys/day, that is 10 force-closes/day.

### Cost: more shutdown observability

Pros: faster diagnosis, smaller MTTR for drain issues.
Cons: more metric cardinality, more log volume, more tracing overhead.

Numbers: a phase histogram per service costs ~7 series per phase. With 5 phases and 100 services, that is 3,500 series — negligible in any production metric system.

### Cost: idempotency keys

Pros: retries are safe; graceful drains do not cause duplicates.
Cons: storage for keys (typically 24h TTL); slight per-request latency for dedup lookup.

Numbers: 1,000 RPS × 86,400 seconds × 24 hours = 86 million keys per day. At 100 bytes per key, 8.6 GB. Free with Redis; non-trivial elsewhere.

### Cost: `preStop` hook

Pros: cleaner LB coordination; readyDelay outside application code.
Cons: 5 extra seconds per pod shutdown. For 100-pod deploy with 25% rolling, 25 batches × 5s = 2 minutes longer.

### Cost: per-handler timeouts

Pros: bounded tail latency; faster drains.
Cons: long-running operations fail; client retries needed.

Numbers: setting `WriteTimeout: 60s` on a server that occasionally streams 5-minute exports causes the export to fail. Client must reconnect and request the export again, or you must use a different mechanism (signed-URL download from object storage).

The senior engineer presents these trade-offs explicitly and chooses based on the service's needs.

---

## Closing Thoughts

At senior level, the graceful shutdown story is no longer about code. It is about *architecture*: states, phases, contracts, observability, fleet behaviour, costs. The code patterns from junior and middle are the means; the architecture is the end.

A team that has internalised the senior layer treats shutdown as a first-class system concern, with SLOs, runbooks, postmortems, and dedicated review. Their deploys are observably clean. Their dashboards have no error spikes at deploy time. Their on-call rotation does not page during normal deploys.

That is the bar. The professional file (next) goes one level deeper, into kernel signal delivery, container runtime internals, and the precise mechanics of `SIGKILL` and `Shutdown` at the OS and Go-runtime level.

---

## Appendix: Phase Machine Production Example

A full production-quality phase machine, ready to drop into a real service.

```go
package shutdown

import (
    "context"
    "fmt"
    "log"
    "sync/atomic"
    "time"
)

// State is the current shutdown state.
type State int32

const (
    StateReady State = iota
    StateDraining
    StateClosingInbound
    StateStoppingBackground
    StateFlushingOutbound
    StateReleasingResources
    StateExited
)

var stateNames = []string{
    "ready", "draining", "closing_inbound",
    "stopping_background", "flushing_outbound",
    "releasing_resources", "exited",
}

func (s State) String() string { return stateNames[s] }

// Phase is one step in the shutdown sequence.
type Phase struct {
    Name      string
    Target    State
    MaxBudget time.Duration
    BestEffort bool
    Run       func(ctx context.Context) error
}

// Machine coordinates shutdown phases.
type Machine struct {
    state    atomic.Int32
    phases   []Phase
    started  atomic.Int64
    observer Observer
}

// Observer is the interface for shutdown metrics/logging.
type Observer interface {
    OnPhaseStart(name string)
    OnPhaseEnd(name string, duration time.Duration, err error)
    OnComplete(totalDuration time.Duration, err error)
}

// New creates a machine with the given phases.
func New(phases []Phase, obs Observer) *Machine {
    return &Machine{phases: phases, observer: obs}
}

// Run executes all phases sequentially within the total budget.
func (m *Machine) Run(parentCtx context.Context, total time.Duration) error {
    m.started.Store(time.Now().UnixNano())
    overall, cancel := context.WithTimeout(parentCtx, total)
    defer cancel()

    start := time.Now()
    defer func() {
        m.observer.OnComplete(time.Since(start), nil)
    }()

    for _, p := range m.phases {
        m.observer.OnPhaseStart(p.Name)
        phaseStart := time.Now()

        phaseCtx, phaseCancel := context.WithTimeout(overall, p.MaxBudget)
        err := safe(func() error { return p.Run(phaseCtx) })
        phaseCancel()

        dur := time.Since(phaseStart)
        m.observer.OnPhaseEnd(p.Name, dur, err)

        if err != nil && !p.BestEffort {
            return fmt.Errorf("phase %s failed: %w", p.Name, err)
        }
        m.state.Store(int32(p.Target))
    }
    return nil
}

// State returns the current state.
func (m *Machine) State() State { return State(m.state.Load()) }

func safe(fn func() error) (err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("panic in shutdown phase: %v", r)
        }
    }()
    return fn()
}

// LogObserver is a simple stdout observer.
type LogObserver struct{}

func (LogObserver) OnPhaseStart(name string) {
    log.Printf("shutdown phase started: %s", name)
}

func (LogObserver) OnPhaseEnd(name string, dur time.Duration, err error) {
    if err != nil {
        log.Printf("shutdown phase ended: %s (%v) error: %v", name, dur, err)
    } else {
        log.Printf("shutdown phase ended: %s (%v)", name, dur)
    }
}

func (LogObserver) OnComplete(total time.Duration, err error) {
    if err != nil {
        log.Printf("shutdown complete with error in %v: %v", total, err)
    } else {
        log.Printf("shutdown complete in %v", total)
    }
}
```

Usage:

```go
phases := []shutdown.Phase{
    {Name: "ready_off", Target: shutdown.StateDraining, MaxBudget: 5 * time.Second,
        Run: func(ctx context.Context) error {
            ready.Store(false)
            select {
            case <-time.After(readyDelay):
            case <-ctx.Done():
            }
            return nil
        }},
    {Name: "drain_http", Target: shutdown.StateClosingInbound, MaxBudget: 15 * time.Second,
        Run: func(ctx context.Context) error {
            if err := apiSrv.Shutdown(ctx); err != nil {
                _ = apiSrv.Close()
                return err
            }
            return nil
        }},
    {Name: "stop_workers", Target: shutdown.StateStoppingBackground, MaxBudget: 5 * time.Second,
        Run: func(ctx context.Context) error {
            cancelWorkers()
            return workers.Wait(ctx)
        }, BestEffort: true},
    {Name: "flush_kafka", Target: shutdown.StateFlushingOutbound, MaxBudget: 3 * time.Second,
        Run: func(ctx context.Context) error {
            return producer.Flush(ctx)
        }, BestEffort: true},
    {Name: "close_resources", Target: shutdown.StateReleasingResources, MaxBudget: 2 * time.Second,
        Run: func(ctx context.Context) error {
            producer.Close()
            rdb.Close()
            db.Close()
            return nil
        }, BestEffort: true},
}

machine := shutdown.New(phases, shutdown.LogObserver{})
<-rootCtx.Done()
_ = machine.Run(context.Background(), 30*time.Second)
```

This is a production-grade scaffold. Adapt the phases to your service.

---

## Appendix: Common Senior-Level Review Comments

A handful of phrases a senior reviewer uses on shutdown PRs:

- *"Where is the SLO for this phase?"*
- *"What is the rollback story if this drain hangs in production?"*
- *"What does the trace look like for a slow shutdown?"*
- *"Has this been chaos-tested?"*
- *"How does this interact with `terminationGracePeriodSeconds`?"*
- *"What happens if SIGTERM arrives at second 5 of a 10-second handler?"*
- *"Show me the metrics this emits."*
- *"What happens if the LB does not notice readiness for 30 seconds?"*

Anticipating these in your PR description saves a round-trip.

---

## Appendix: A One-Line Diagnosis Cheat Sheet

| Symptom | Likely cause |
|---|---|
| Pods consistently take ~30 seconds to terminate | `terminationGracePeriodSeconds` reached; force-killed |
| 5xx spike at deploy time | LB-readiness handoff timing wrong |
| Some pods drain fast, some slow | Slow handler tail; profile per-endpoint latencies |
| Connection resets during deploys | Listener closed before LB removed pod |
| "Database is closed" errors during deploys | DB closed before HTTP drain finished |
| Lost metrics at end of pod lifetime | Metrics exporter not flushed before exit |
| Lost Kafka messages at deploy | Producer not flushed; idempotency missing |
| pprof showing leaked goroutines after shutdown | Goroutines not observing rootCtx |
| Sentry events lost | `sentry.Flush` not called |

A senior engineer reads this table mentally on every shutdown incident.

---

## Extended Discussion: Shutdown as a Contract

Treat shutdown as a contract between layers:

- The **application** promises to drain within X seconds of SIGTERM.
- The **orchestrator** promises not to SIGKILL within those X seconds.
- The **load balancer** promises to remove the endpoint within Y seconds of readiness flipping.
- The **client** promises to retry on 503.

Each promise is testable. Each is a small SLO. Violations produce specific incidents.

### Writing the contract down

A simple Markdown file in the service's repo:

```markdown
# Shutdown Contract

- terminationGracePeriodSeconds: 35
- preStop sleep: 5s
- Application shutdown budget: 25s
- Per-handler timeout: 15s
- LB removal latency target: <5s after readiness flip
- Retry policy: clients should retry on 503/504 with exponential backoff
```

Reviewed quarterly. Updated when timing changes. Shared with downstream-service owners.

### Testing the contract

A test for each promise:

- *Application drains within 25s*: integration test with simulated SIGTERM.
- *LB removes endpoint within 5s*: synthetic test that flips readiness and times the next 200-response from a different pod.
- *Clients retry on 503*: SDK contract test.

When all contract tests pass, deploys are safe. When one fails, the corresponding promise is broken; fix it.

---

## Extended Discussion: Chaos Engineering for Shutdown

Beyond simple unit tests, chaos engineering for shutdown:

### Scenario: Brutal SIGKILL

```go
func TestSIGKILLBehavior(t *testing.T) {
    cmd := startServer(t)
    // ... start request that takes 10s ...
    require.NoError(t, cmd.Process.Signal(syscall.SIGKILL))
    err := cmd.Wait()
    // Process must exit immediately
    require.Error(t, err) // signal: killed
    // Database should NOT have committed the in-flight transaction
    require.Empty(t, queryDB(t, "incomplete transactions"))
}
```

### Scenario: SIGTERM immediately followed by SIGKILL

```go
func TestSIGTERMThenSIGKILL(t *testing.T) {
    cmd := startServer(t)
    require.NoError(t, cmd.Process.Signal(syscall.SIGTERM))
    time.Sleep(1 * time.Second)
    require.NoError(t, cmd.Process.Signal(syscall.SIGKILL))
    // Verify partial-drain semantics; some requests should have completed
}
```

### Scenario: Many SIGTERMs

```go
func TestMultipleSIGTERMs(t *testing.T) {
    cmd := startServer(t)
    for i := 0; i < 10; i++ {
        require.NoError(t, cmd.Process.Signal(syscall.SIGTERM))
    }
    // First should trigger drain; subsequent should be no-ops
    err := cmd.Wait()
    require.NoError(t, err)
}
```

### Scenario: Network failure during drain

A mock downstream that returns errors at drain time. The drain should still complete; the in-flight requests using the downstream should fail with structured errors, not hang.

### Scenario: Disk full during drain

Some shutdown code writes a state file. Simulate disk full and verify the drain still completes (the state file is best-effort, not load-bearing).

### Scenario: OOM during drain

Memory pressure during shutdown. The Go runtime triggers GC, which adds latency. Drain may be slower; should still complete.

Each scenario is a chaos test. Each is unlikely but possible in production. Each that passes is one less surprise on-call.

---

## Extended Discussion: Shutdown for Stateful Services

Stateful services (databases, caches, message brokers) have stricter shutdown requirements.

### Replication lag

A read-replica should drain only after it has caught up with the primary. Otherwise the replica may serve stale reads after restart.

```go
func waitForReplicationCaughtUp(ctx context.Context) error {
    deadline := time.Now().Add(20 * time.Second)
    for time.Now().Before(deadline) {
        lag, err := replicationLag(ctx)
        if err != nil { return err }
        if lag < 100*time.Millisecond {
            return nil
        }
        select {
        case <-time.After(100 * time.Millisecond):
        case <-ctx.Done():
            return ctx.Err()
        }
    }
    return errors.New("replication did not catch up")
}
```

This is added as an early phase in the shutdown machine: "wait until caught up" before "drain inbound."

### Leader election

If the pod is the leader of a cluster (etcd, Consul, Kafka controller), it should *step down* before shutting down. Otherwise the cluster has a temporarily missing leader.

```go
if isLeader() {
    log.Println("stepping down as leader")
    if err := stepDown(ctx); err != nil {
        log.Printf("step down failed: %v", err)
    }
}
```

The step-down is another early phase.

### In-memory state persistence

A cache may have dirty entries. Flush them to persistent storage during shutdown:

```go
cache.FlushAll(ctx) // write all dirty entries to backing store
```

After flush, the cache can be safely closed.

### Snapshot before exit

Some stateful services snapshot on shutdown for fast startup:

```go
if err := snapshotter.Take(ctx); err != nil {
    log.Printf("snapshot failed: %v", err)
}
```

The snapshot is loaded on next startup, skipping the slow rebuild.

### Stateful shutdown observations

Stateful shutdowns are usually slower than stateless. 30-second budgets may be insufficient; databases sometimes need 60–120 seconds. `terminationGracePeriodSeconds` must accommodate. The trade-off in slow deploys is accepted because data integrity is non-negotiable.

---

## Extended Discussion: Multi-Process Shutdown

Some Go services run multiple processes (parent + children, supervisor + workers). Shutdown coordination is more complex.

### Pattern: Process supervisor

The supervisor process holds shared state (listener, file handles) and spawns workers. On SIGTERM, the supervisor:

1. Stops accepting new work (closes listener or stops calling Receive).
2. Sends SIGTERM to all worker processes.
3. Waits for workers to exit (with deadline).
4. SIGKILLs surviving workers.
5. Closes shared state.
6. Exits.

In Go, this looks like:

```go
type Supervisor struct {
    workers []*exec.Cmd
}

func (s *Supervisor) Shutdown(ctx context.Context) error {
    // Send SIGTERM to all
    for _, w := range s.workers {
        if w.Process != nil {
            _ = w.Process.Signal(syscall.SIGTERM)
        }
    }
    // Wait with deadline
    done := make(chan struct{})
    go func() {
        for _, w := range s.workers {
            _ = w.Wait()
        }
        close(done)
    }()
    select {
    case <-done:
        return nil
    case <-ctx.Done():
        for _, w := range s.workers {
            if w.Process != nil {
                _ = w.Process.Kill()
            }
        }
        return ctx.Err()
    }
}
```

### Pattern: Hot-restart server (graceful binary replacement)

Some services replace their binary without dropping connections. The supervisor `exec`s the new binary and passes the listening socket via inherited file descriptor. The new binary picks up new connections; the old binary drains existing ones and exits.

This pattern is used by HAProxy, nginx, and Go libraries like `cloudflare/tableflip`. Implementation is intricate; most teams use K8s rolling updates instead.

### Pattern: Goroutine-per-connection in supervisor mode

The supervisor uses a `goroutine` (not a separate process) per connection. The shutdown is the standard graceful-shutdown story; no multi-process complexity.

This is the *normal* Go server pattern. Multi-process complications are usually only relevant when calling into C code, integrating with legacy systems, or implementing hot-restart.

---

## Extended Discussion: Shutdown Observability Anti-Patterns

A few patterns to avoid in shutdown observability.

### Anti-pattern: Logging only on success

```go
if err := srv.Shutdown(ctx); err != nil {
    // no log
}
log.Println("shutdown complete")
```

The "complete" log fires both on success and on error. The error path is silent. Always log the error too.

### Anti-pattern: Untimed phases

```go
log.Println("draining HTTP")
srv.Shutdown(ctx)
log.Println("HTTP drained")
```

No duration. Add `time.Since(start)` to every phase log.

### Anti-pattern: Metrics without labels

```go
metrics.ShutdownDuration.Observe(d.Seconds())
```

A single histogram. Cannot diagnose per-phase. Add `phase` label.

### Anti-pattern: Logging at wrong level

```go
log.Println("shutdown phase failed:", err)
```

Should be `log.Error` or similar. Aggregators filter by level; `Println` is the lowest.

### Anti-pattern: Per-pod-per-deploy metrics in a counter

```go
metrics.ShutdownPodID.WithLabelValues(podID).Inc()
```

Cardinality explosion. Pod IDs are ephemeral. Use a hash bucket or omit.

### Anti-pattern: Sampling traces uniformly

If you sample 1% of traces, you sample 1% of shutdown traces — which is too few for diagnosis. Either trace 100% of shutdowns or include shutdown traces in a "high-priority" sampling rule.

---

## Extended Discussion: Architectural Decision Records

Senior engineers write Architectural Decision Records (ADRs) for non-trivial decisions. Shutdown decisions deserve ADRs.

### Example ADR

```
ADR-007: Shutdown Strategy

Status: Accepted
Date: 2026-04-12

Context:
The checkout service is being deployed to production. We need a shutdown
strategy that handles SIGTERM gracefully and minimises customer impact.

Decision:
- Implement signal.NotifyContext at top of main.
- Use a phase machine with 6 phases: ready_off, drain_http, drain_grpc,
  stop_workers, flush_outbound, close_resources.
- Total budget 25 seconds; per-phase budgets sum to 25s with 1s margin.
- Set terminationGracePeriodSeconds=30 in K8s manifest.
- Use preStop hook with sleep 3 for LB-removal-grace.
- Emit metrics: shutdown_started, shutdown_phase_duration{phase}, ...
- Emit traces: one span per phase.
- Integration test: process exits within 5s of SIGTERM with in-flight requests
  completing.

Consequences:
- Deploys take 30s longer per batch (due to TGPS and preStop).
- Operations cost ~7 metric series per service.
- Adds ~150 LOC of shutdown coordination code.
- Reduces deploy-time error rate from 0.4% to <0.01%.

Alternatives considered:
1. No graceful shutdown. Rejected because of payment double-charge risk.
2. Longer terminationGracePeriodSeconds (60s). Rejected because deploys
   become too slow.
3. Custom hot-restart via exec. Rejected as too complex for marginal benefit.
```

ADRs document the *why*, not just the *what*. Six months later, when someone asks "why is our shutdown budget 25 seconds?", the ADR has the answer.

---

## Extended Discussion: Designing for Operability

Operability is the senior engineer's product. A service that is easy to operate during shutdown is easier to operate in general.

### Operability principles

1. **Predictability.** Same input produces same shutdown behaviour. No randomness in deadlines.
2. **Visibility.** Every transition is logged, metric'd, traced.
3. **Recoverability.** A failed shutdown can be diagnosed and the next deploy fixed.
4. **Bounded behaviour.** Worst-case shutdown time is known and bounded.
5. **Documented.** A runbook exists for shutdown failures.

### Runbook example

```
RUNBOOK: Slow Shutdown

Symptoms:
- Pod stays in Terminating state for >25 seconds
- Alert: shutdown_duration_seconds_p99 > 25s

Diagnosis:
1. Get logs from terminating pod: kubectl logs <pod> --previous
2. Look for "shutdown phase entered" lines; identify which phase is slow.
3. If "drain_http" is slow: check inflight requests at shutdown start.
4. If "drain_workers" is slow: check what workers are stuck on (likely
   slow downstream).
5. If "flush_outbound" is slow: Kafka or tracing exporter is slow.

Mitigation:
- Slow phase: increase that phase's budget if total < 30s.
- Stuck handler: identify endpoint, reduce its per-handler timeout.
- Slow downstream: open ticket with downstream owners; circuit-breaker if
  available.

Permanent fix:
- File ticket for the slow component.
- Add chaos test for this scenario.
- Update SLO if root cause cannot be fixed.
```

A runbook turns an incident response from "improvise" to "follow the steps."

### Drill the runbook

Quarterly, simulate a slow downstream and run the runbook. Verify the diagnosis steps work. Update the runbook based on what you learn.

---

## Extended Discussion: Long-Term Trends and Evolution

Shutdown patterns have evolved over the years. Watching the trends helps plan for the next 3–5 years.

### Trend 1: Mesh-managed lifecycle

Service meshes increasingly handle drain on behalf of the application. Envoy's `gateway.drain` and similar features let the mesh tell the app "stop sending, we are draining you" before the app sees SIGTERM. The application's drain becomes simpler — flush state, exit.

### Trend 2: Serverless / function-as-a-service

In FaaS environments (Lambda, Cloud Functions), shutdown is invisible to user code. The platform handles it. Graceful shutdown becomes a runtime concern, not an application concern.

For Go developers, this means: more code is becoming serverless; the graceful-shutdown skills remain relevant for the long-running services that *are* still in pods.

### Trend 3: WASM and edge computing

WebAssembly runtimes (Cloudflare Workers, Vercel Edge, Fastly Compute@Edge) have different lifecycle models. There is no SIGTERM; the runtime cycles isolates. Graceful shutdown patterns apply only to the runtime, not to user code.

### Trend 4: Better Go runtime support

Go's `signal.NotifyContext` in 1.16, `context.WithCancelCause` in 1.20, `context.AfterFunc` in 1.21 — each iteration makes the patterns cleaner. Expect more in coming versions.

### Trend 5: SLO-driven engineering

The maturity of SLOs and error budgets makes shutdown-as-a-contract more concrete. Quantified shutdown SLOs are increasingly common.

### What stays the same

- Signal-based shutdown will remain the universal pattern in non-FaaS, non-WASM environments.
- The two-phase model (stop accepting, wait for in-flight) is universal.
- The need for deadlines is universal.
- The choreography with load balancers will always be subtle.

A senior engineer's job is to know which patterns are evolving and which are bedrock.

---

## Extended Discussion: Q&A With a Hiring Manager

A hiring manager interviewing a senior candidate on shutdown:

**Q. What is the worst-case shutdown latency in your current service?**

A. p99 is 8 seconds; p999 is 22 seconds. We have a 25-second budget. We are 3 seconds away from force-close at p999.

**Q. What is the dominant phase in that p999?**

A. HTTP drain. We have one endpoint, `/export`, that occasionally takes 18 seconds to complete because of downstream latency.

**Q. How would you bring the p999 down?**

A. Three options. First, per-handler timeout on `/export` of 10 seconds; clients retry. Second, async export — return a job ID immediately, client polls. Third, increase `terminationGracePeriodSeconds` to 40 seconds (slower deploys). We chose async export.

**Q. What happens if `Shutdown` errors?**

A. We call `Close` as fallback. The error is logged and metric'd. Active connections see RST instead of clean close. Customers retry. The metric `shutdown_force_close_total` is on a dashboard.

**Q. What about WebSockets?**

A. We have a separate registry. On shutdown, we send each WebSocket a "going away" frame, then wait 5 seconds for client-initiated close. Stragglers are force-closed.

**Q. How do you test all of this?**

A. Integration test that asserts clean exit in 5 seconds. Chaos test that simulates a slow downstream and asserts force-close fires. Synthetic test in staging that runs hourly and reports drain duration.

This is the conversation a senior is expected to have. Practice it.

---

## Extended Discussion: When Shutdown Goes Wrong at Scale

A composite story of a real-world shutdown failure at scale.

### The setup

A team runs a fleet of 500 pods of a checkout service. Each handles 100 RPS. Daily deploys, 25% rolling. Average drain time: 3 seconds.

### The incident

Tuesday morning, a deploy triggers a 5xx spike. 2% of requests fail for 5 minutes during the deploy. Customer support sees a wave of tickets.

### Investigation

1. Logs show "shutdown phase entered: drain_http" but no corresponding "drained" message.
2. `shutdown_duration_seconds` p99 jumps from 3s to 28s during the deploy.
3. Drilling in: `phase_duration_seconds{phase="drain_http"}` p99 jumps to 25s.
4. Inspecting individual pods: in-flight requests at shutdown rose from ~5 to ~200.

### Root cause

A downstream service deployed at the same time. Its drain was slow, causing back-pressure on checkout requests. Checkout handlers blocked waiting for the downstream. When SIGTERM arrived on checkout, the in-flight handlers (still waiting on the downstream) had not returned. `Shutdown` waited up to 25 seconds.

The downstream's deploy was unrelated to checkout's; the teams didn't know they were deploying simultaneously.

### Fix

1. **Short-term:** Set a deploy mutex; one service deploys at a time.
2. **Medium-term:** Add a downstream timeout in checkout (10 seconds). Handlers fail fast if downstream is slow.
3. **Long-term:** Add a "deploy compatibility" check; if downstream is mid-deploy, checkout's deploy waits.

### Lessons

- A service's shutdown is not isolated; it depends on downstream behaviour.
- Per-handler timeouts protect drain from cascading slowness.
- Cross-team deploy coordination matters.

The senior engineer who diagnoses this incident files three tickets for the three fixes and writes a postmortem. The on-call rotation does not see this incident again.

---

## Extended Discussion: Performance Budgets for Shutdown

Senior engineering budgets time across phases. Here is a representative budget:

| Phase | Budget | Notes |
|---|---|---|
| ready_off + readyDelay | 3s | LB propagation |
| drain_http | 15s | Drain in-flight requests |
| drain_grpc | 15s | Parallel with drain_http |
| stop_workers | 5s | After inbound drains |
| flush_outbound | 3s | Kafka, traces |
| close_resources | 1s | DB, Redis |
| Margin | 3s | For unexpected slowness |
| **Total** | **30s** | Within K8s default |

Each phase has its own deadline. Each can be tuned independently. The total is locked.

### Tuning the budget

If `drain_http` p99 grows from 8s to 12s, the budget for it (currently 15s) is still OK. If it grows to 18s, you blow the budget and force-close. Either:

- Reduce inbound request rate or per-handler latency.
- Increase the phase budget (steal from another phase).
- Increase total budget and `terminationGracePeriodSeconds`.

The first is usually correct: a regression in handler latency is bad regardless of shutdown.

### Sub-budgets within a phase

For `drain_http`, you can have a deadline for "wait for natural drain" (12s) and a separate margin for "force close fallback" (3s):

```go
ctx, cancel := context.WithTimeout(parent, 12*time.Second)
err := srv.Shutdown(ctx)
cancel()
if err != nil {
    _ = srv.Close()
    // 3 seconds margin for Close to take effect
}
```

The 3-second margin doesn't appear in any visible deadline; it just gives the next phase a chance to start.

### Budget visibility

Make the budget visible:

```go
log.Printf("shutdown budget: total=%v phase_drain_http=%v phase_drain_grpc=%v",
    totalBudget, httpBudget, grpcBudget)
```

Operators on a slow shutdown can see the budgets at a glance.

---

## Extended Discussion: Best Practices Codified

A senior engineer codifies best practices in linters, templates, and review checklists.

### Custom linter rules

`golangci-lint` allows custom analysers. Useful shutdown-specific rules:

- Flag `srv.Shutdown(context.Background())` — unbounded context.
- Flag `signal.Notify` without `defer signal.Stop`.
- Flag goroutines that don't accept `ctx`.
- Flag `os.Exit` in code other than `main`.

### Templates

Service templates (often via `cookiecutter` or similar) bundle a known-good `main.go` with graceful shutdown built in. New services inherit it; they don't reinvent.

```
template/cmd/server/main.go    # canonical shutdown skeleton
template/internal/shutdown/    # phase machine implementation
template/.github/workflows/    # CI with shutdown integration test
```

### Code review checklist

A repo `CODE_REVIEW.md`:

```markdown
For PRs that touch `main.go`, `signal`, or `Shutdown`:

- [ ] signal.NotifyContext or signal.Notify+defer signal.Stop
- [ ] Shutdown has context.WithTimeout
- [ ] Fallback to Close on error
- [ ] errors.Is(err, http.ErrServerClosed) check
- [ ] Background goroutines accept and observe ctx
- [ ] DB/Redis/etc closed after Shutdown returns
- [ ] Metrics emitted at each phase
- [ ] Integration test covers shutdown
```

Reviewers literally check each box.

---

## Extended Discussion: The Senior Engineer's Daily Habits

A condensed list of habits that turn senior-level shutdown knowledge into operational excellence.

1. **Read every shutdown log.** Each morning, glance at the previous deploy's shutdown logs. Look for outliers.
2. **Track the dashboard.** A weekly review of shutdown dashboards. P99 trending up is a red flag.
3. **Run integration tests locally.** Before pushing PRs, exercise the shutdown path manually.
4. **File tickets for tail-latency outliers.** A 30-second p999 shutdown is a ticket, not a curiosity.
5. **Mentor.** Junior engineers learn from seeing senior engineers care about shutdown.
6. **Document.** Update the runbook when something new appears.
7. **Postmortem.** After every shutdown incident, write a postmortem. Include action items.
8. **Tune.** Quarterly, review timeouts and budgets in light of measured latencies.

These habits compound. A team where every engineer practices them ships clean deploys forever.

---

## Extended Discussion: Trade-offs in Drain Granularity

How fine-grained should drain phases be? Too coarse: hard to debug, hard to optimise. Too fine: maintenance burden, log noise.

### Coarse: one phase

```go
func shutdown(ctx context.Context) error {
    return drainEverything(ctx)
}
```

Hard to debug. "Shutdown took 25 seconds" but where?

### Fine: ten phases

```go
phases := []Phase{
    "ready_off", "wait_lb_propagation", "drain_http_idle",
    "drain_http_active", "drain_grpc_idle", "drain_grpc_active",
    "stop_workers_signal", "stop_workers_wait", "flush_kafka",
    "close_db",
}
```

Excellent observability. Tedious to maintain.

### Sweet spot: 5–7 phases

The phase machine in this file uses 6 phases. Enough granularity for diagnosis; not so much that the overhead is felt.

### Adjusting based on service complexity

A simple service may need only 3 phases (drain_http, flush, close). A complex service with multiple inbound + outbound surfaces benefits from 6–7. Choose based on the service.

---

## Extended Discussion: Migrating a Legacy Service to Graceful Shutdown

A real concern at senior level: a legacy service has no graceful shutdown. How do you add it?

### Steps

1. **Measure baseline.** What is the current deploy error rate? What is the current shutdown duration (probably 0 — the process is SIGKILLed)?
2. **Add minimum viable.** PR #1: `signal.NotifyContext`, `Shutdown`, deadline, `Close` fallback. Smallest possible change.
3. **Add readiness.** PR #2: `/readyz`, atomic flag, K8s manifest update.
4. **Add metrics.** PR #3: shutdown counters, phase histograms.
5. **Identify slow paths.** Once metrics are flowing, watch deploys. Tail-latency outliers are PR-worthy.
6. **Add chaos test.** PR #4: integration test for shutdown.
7. **Iterate.** Each subsequent PR fixes one issue revealed by metrics.

### Common surprises

- Long-lived connections that no one knew about.
- Background goroutines spawned by libraries that don't accept context.
- Code paths that call `os.Exit` somewhere deep.
- Database transactions that span request boundaries.

Each surprise becomes a PR.

### Timeline

Typical: 2–4 weeks to bring a legacy Go service from "no graceful shutdown" to "deploy-error-rate <0.01%." Bigger services (with stateful behaviour, custom protocols) can take months.

The senior engineer drives this migration. The deploy error rate drop is the visible value.

---

## Extended Discussion: When `Shutdown` is the Wrong Tool

A short list of situations where `http.Server.Shutdown` is not the right approach.

### Situation 1: Stateful socket protocols

If your TCP server speaks a custom protocol (not HTTP), `http.Server.Shutdown` doesn't apply. You manage the listener and connections yourself. The pattern is the same in spirit: stop accepting, drain in-flight, deadline-bounded.

### Situation 2: gRPC

Use `grpc.Server.GracefulStop`, not `http.Server.Shutdown`. The mechanics are similar but the APIs differ.

### Situation 3: Long-poll / SSE without HTTP/2

These are special cases of HTTP, but the long-lived nature complicates drain. Combine `Shutdown` with explicit signals to streaming handlers.

### Situation 4: Embedded servers

If your "server" is just a `net.Listener` accepting raw connections, you manage `Close` and per-connection contexts yourself. There is no built-in graceful path.

### Situation 5: Servers behind unix sockets

The graceful pattern is similar but unix sockets have their own quirks (mode bits, file removal on shutdown). Pay attention to the lifecycle of the socket file itself.

---

## Extended Discussion: Cross-Language Considerations

Many Go services live in polyglot environments. A few notes on cross-language shutdown behaviour.

### Python / Java services

Most modern frameworks have graceful shutdown built in: FastAPI, Flask with proper deployment, Spring Boot. The signal handling is similar.

### Node.js

`process.on('SIGTERM', ...)` is the equivalent. The HTTP server has a `close()` method that stops accepting new connections; existing connections are not interrupted. Node's drain is similar to Go's `Shutdown`.

### Rust

`tokio` provides cancellation tokens, similar to context cancellation. The pattern is the same: signal, propagate, drain.

### Older systems

Some legacy C++ / C# / Perl services may not have built-in graceful shutdown. Adding it can be a significant project.

The takeaway: every language has analogues to Go's pattern. The principles transfer. Senior engineers reason about shutdown across the polyglot stack.

---

## Extended Discussion: Final Senior-Level Checklist

A condensed checklist for the senior engineer's design review.

- [ ] Shutdown is a documented phase machine.
- [ ] Each phase has a budget; sum to total budget.
- [ ] Total budget is less than `terminationGracePeriodSeconds`.
- [ ] Readiness flips early; LB has time to remove pod.
- [ ] preStop hook exists (or readyDelay in code).
- [ ] Metrics: `shutdown_started`, `shutdown_duration`, `phase_duration{phase}`, `force_close_total`.
- [ ] Logs: structured, one line per phase transition, with duration.
- [ ] Traces: span per phase (if tracing is enabled).
- [ ] WebSocket / hijacked connections have their own drain path.
- [ ] Long-lived streams have shutdown awareness via `serviceCtx`.
- [ ] Database, Redis, Kafka closed *after* application drain.
- [ ] Idempotency keys on state-changing endpoints.
- [ ] Per-handler timeouts to bound the tail.
- [ ] Chaos test for slow downstream.
- [ ] Chaos test for SIGKILL after partial drain.
- [ ] Integration test in CI.
- [ ] Runbook for slow-shutdown alerts.
- [ ] Postmortem template for shutdown incidents.
- [ ] ADR documenting the shutdown strategy.

A service that passes all 18 items is mature. Most services start at 5; bringing them to 18 is the senior engineer's project.

---

## Closing Summary

Senior-level shutdown engineering is about:

- **Phases** as a design primitive.
- **Fleet behaviour** as the unit of analysis.
- **LB choreography** as the coordination story.
- **Observability** as the diagnostic layer.
- **Trade-offs** as the conscious decision.
- **Operability** as the product.
- **Contracts** as the discipline.

A senior engineer treats shutdown not as a feature but as an *aspect* of system design that touches every layer. The next file goes one level deeper, into the kernel and runtime mechanics that make all of this possible.

---

## Appendix: Architecture Patterns Catalogue

A library of named patterns the senior engineer reaches for.

### Pattern: Phased Shutdown

State machine of phases. Already covered in detail. The foundational pattern.

### Pattern: Two-Server Architecture

API server + admin server on different ports. Admin server stays up longer to expose /healthz, /metrics, /debug. API server drains first.

```go
adminSrv := &http.Server{Addr: ":8090", Handler: adminMux}
apiSrv := &http.Server{Addr: ":8080", Handler: apiMux}

go adminSrv.ListenAndServe()
go apiSrv.ListenAndServe()

<-rootCtx.Done()
// Drain API first; admin stays up for observability
_ = apiSrv.Shutdown(ctx)
// ... other drain ...
_ = adminSrv.Shutdown(ctx) // last
```

### Pattern: Readiness-Sentinel

A separate process or container watches an external signal (file, HTTP endpoint, K8s API) and flips the application's readiness when it sees the signal. The application's signal handler just drains; the readiness is managed externally.

Useful when the application's signal handler is slow to start (cold-start scenarios) or when readiness must be tied to external state (database lag, cluster state).

### Pattern: Bulkhead Drain

In a fan-out service that calls multiple downstreams, each downstream's drain is independent. Failure in one doesn't block others.

```go
eg, ectx := errgroup.WithContext(ctx)
eg.Go(func() error { return downstreamA.Close(ectx) })
eg.Go(func() error { return downstreamB.Close(ectx) })
eg.Go(func() error { return downstreamC.Close(ectx) })
_ = eg.Wait() // partial failures are tolerated
```

### Pattern: Async Drain Trigger

Drain can be triggered not just by SIGTERM but by an admin endpoint:

```go
mux.HandleFunc("/admin/drain", func(w http.ResponseWriter, r *http.Request) {
    if !checkAdminAuth(r) {
        http.Error(w, "unauthorized", 401)
        return
    }
    go func() { triggerShutdown() }()
    w.WriteHeader(http.StatusAccepted)
})
```

Useful for testing, for manual drains during maintenance, and for orchestration systems that prefer HTTP over signals.

### Pattern: Drain on Health Failure

If a self-health-check (e.g., DB ping) fails persistently, the pod drains itself rather than serving bad requests.

```go
go func() {
    failures := 0
    for {
        time.Sleep(10 * time.Second)
        if err := db.PingContext(rootCtx); err != nil {
            failures++
            if failures >= 3 {
                log.Println("DB unhealthy; self-draining")
                cancel()
                return
            }
        } else {
            failures = 0
        }
    }
}()
```

The next pod is healthier; the operation continues. Self-healing.

### Pattern: Drain Ramp-Down

Instead of binary "draining or not," gradually reduce capacity:

```go
type Throttle struct {
    rate atomic.Int64
}

func (t *Throttle) Allow() bool {
    // probabilistic admission
    return rand.Int63n(100) < t.rate.Load()
}

// At shutdown:
for i := 100; i > 0; i -= 10 {
    t.rate.Store(int64(i))
    time.Sleep(500 * time.Millisecond)
}
```

The capacity ramps down smoothly. Useful in special cases; usually overkill.

### Pattern: External Coordinator

A separate service ("deployment coordinator") instructs many instances to shut down with timing. Each instance reports its drain status; the coordinator advances the deploy. Used by Spinnaker, Argo Rollouts, and similar.

### Pattern: Hot Spare

A new instance is fully ready before the old one is asked to drain. The drain is leisurely because there is no capacity pressure. Standard in K8s rolling updates with `maxSurge`.

---

## Appendix: Deep Dive Into K8s Pod Termination

A more detailed look at the exact sequence inside K8s.

### Step-by-step

1. `kubectl delete pod` (or rolling update or HPA scale-down) triggers the API server.
2. API server marks the pod `Terminating`. `deletionTimestamp` set on the pod object.
3. EndpointController and EndpointSliceController observe the pod state. Endpoints are updated to remove this pod.
4. Updated Endpoints propagate to kube-proxy (or service mesh) on each node.
5. kube-proxy reconfigures iptables/IPVS. New connections stop landing on this pod. (May take 0.5–5 seconds.)
6. kubelet on the pod's node sees the terminating state. Runs preStop hook if defined.
7. After preStop returns (or immediately if no hook), kubelet sends SIGTERM to PID 1 in each container.
8. Kubelet starts a timer of `terminationGracePeriodSeconds`.
9. If the container exits within the timer, the kubelet cleans up and reports `Terminated`.
10. If the timer fires, kubelet sends SIGKILL.

### Notes

- Step 2 and step 5 are NOT synchronised. Step 6 may begin before step 5 completes.
- preStop blocks step 7. If preStop is slow, SIGTERM is delayed.
- The total time from "marked terminating" to "container exited" is at most `terminationGracePeriodSeconds + preStop time`.

### Implications for design

- Endpoint removal latency is not under your control. Plan for 1–5 seconds.
- preStop lets you control the application-level handoff with the LB.
- SIGTERM-to-SIGKILL is the hard budget; design within it.

---

## Appendix: Coordinated Operator Maintenance

Rare but important: scheduled maintenance windows where operators want to drain a cluster or region.

### Pattern: maintenance mode

An admin endpoint enables maintenance:

```
POST /admin/maintenance/enter
```

The endpoint:

1. Flips readiness to false (LB stops sending traffic).
2. Logs a "maintenance entered" event.
3. Starts a configurable drain (or just sets the flag and waits for natural drain).

A symmetric `/admin/maintenance/exit` flips readiness back. Useful for:

- Pre-deploy validation: drain one pod, run tests against it.
- Database failover: drain pods that depend on the failing primary.
- Network upgrade: drain pods on the affected nodes.

### Pattern: planned drain via the orchestrator

`kubectl drain <node>` evacuates all pods from a node. Each pod's grace period is respected. Used during node upgrades or cordoning.

The graceful-shutdown design must also handle `kubectl drain`. The mechanics are identical to a deploy (SIGTERM with grace period); the trigger is different.

### Pattern: graceful database failover

If your service depends on a database that is about to fail over, the right action is to drain all dependent pods first.

The orchestration:

1. Operator triggers maintenance on the database.
2. Database controller notifies all dependent pods.
3. Dependent pods enter drain.
4. After all are drained, database failover proceeds.
5. New pods come up against the new primary.

This is choreography across services. It works when each service has a clear "drain on demand" API.

---

## Appendix: A Library for Phased Shutdown

A small library codifying the senior patterns. Drop into any service.

```go
// Package shutdown provides phased, observable, deadline-bounded shutdown.
package shutdown

import (
    "context"
    "errors"
    "fmt"
    "log"
    "sync"
    "sync/atomic"
    "time"
)

// State of the shutdown machine.
type State int32

const (
    StateReady State = iota
    StateDraining
    StateExited
)

// PhaseFunc runs one phase.
type PhaseFunc func(ctx context.Context) error

// Phase is one step.
type Phase struct {
    Name       string
    MaxBudget  time.Duration
    BestEffort bool
    Run        PhaseFunc
}

// Manager coordinates phases.
type Manager struct {
    mu     sync.Mutex
    phases []Phase
    state  atomic.Int32
    obs    Observer
}

// Observer receives shutdown events.
type Observer interface {
    PhaseStart(name string)
    PhaseEnd(name string, dur time.Duration, err error)
}

// NewManager creates an empty manager.
func NewManager(obs Observer) *Manager {
    if obs == nil { obs = noopObserver{} }
    return &Manager{obs: obs}
}

// Add appends a phase.
func (m *Manager) Add(p Phase) {
    m.mu.Lock()
    defer m.mu.Unlock()
    m.phases = append(m.phases, p)
}

// State returns the current state.
func (m *Manager) State() State { return State(m.state.Load()) }

// Run executes all phases sequentially within the total budget.
func (m *Manager) Run(parent context.Context, total time.Duration) error {
    if !m.state.CompareAndSwap(int32(StateReady), int32(StateDraining)) {
        return errors.New("shutdown already in progress or complete")
    }
    defer m.state.Store(int32(StateExited))

    overall, cancel := context.WithTimeout(parent, total)
    defer cancel()

    var allErrs []error
    for _, p := range m.phases {
        if overall.Err() != nil {
            return overall.Err()
        }
        m.obs.PhaseStart(p.Name)
        start := time.Now()
        phaseCtx, phaseCancel := context.WithTimeout(overall, p.MaxBudget)
        err := safeRun(p.Run, phaseCtx)
        phaseCancel()
        m.obs.PhaseEnd(p.Name, time.Since(start), err)
        if err != nil && !p.BestEffort {
            return fmt.Errorf("phase %s: %w", p.Name, err)
        }
        if err != nil {
            allErrs = append(allErrs, fmt.Errorf("%s: %w", p.Name, err))
        }
    }
    return errors.Join(allErrs...)
}

func safeRun(fn PhaseFunc, ctx context.Context) (err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("panic: %v", r)
        }
    }()
    return fn(ctx)
}

type noopObserver struct{}

func (noopObserver) PhaseStart(string)                          {}
func (noopObserver) PhaseEnd(string, time.Duration, error)      {}

// LogObserver writes log lines.
type LogObserver struct{}

func (LogObserver) PhaseStart(name string) {
    log.Printf("shutdown phase: %s", name)
}

func (LogObserver) PhaseEnd(name string, dur time.Duration, err error) {
    if err != nil {
        log.Printf("shutdown phase %s ended in %v: %v", name, dur, err)
    } else {
        log.Printf("shutdown phase %s ended in %v", name, dur)
    }
}
```

### Using the library

```go
import "example.com/myservice/internal/shutdown"

mgr := shutdown.NewManager(shutdown.LogObserver{})

mgr.Add(shutdown.Phase{
    Name: "ready_off", MaxBudget: 5 * time.Second,
    Run: func(ctx context.Context) error {
        ready.Store(false)
        select {
        case <-time.After(3 * time.Second):
        case <-ctx.Done():
        }
        return nil
    },
})

mgr.Add(shutdown.Phase{
    Name: "drain_http", MaxBudget: 15 * time.Second,
    Run: func(ctx context.Context) error {
        if err := apiSrv.Shutdown(ctx); err != nil {
            _ = apiSrv.Close()
            return err
        }
        return nil
    },
})

// ... more phases ...

<-rootCtx.Done()
if err := mgr.Run(context.Background(), 30*time.Second); err != nil {
    log.Printf("shutdown error: %v", err)
}
```

Clean, observable, testable.

---

## Appendix: Connecting Shutdown to On-Call Practice

A senior engineer connects shutdown engineering to operational practice.

### Page templates for shutdown alerts

A PagerDuty alert for "shutdown duration p99 > 25s":

```
TITLE: Slow Shutdown in <service>

CONTEXT:
- Shutdown duration p99 has exceeded 25 seconds.
- We are 5 seconds away from terminationGracePeriodSeconds.
- 0.5% of recent shutdowns force-closed.

RUNBOOK:
- Check the latest deploy logs for the affected pods.
- Inspect phase_duration metrics: which phase is slow?
- If drain_http is slow: check inflight requests at shutdown.
- See runbook: <link>

IMMEDIATE ACTIONS:
- Hold the next deploy until investigated.
- File ticket with the team that owns the slow downstream (if applicable).
```

### Incident drill

Quarterly, simulate a slow shutdown and run the team through the runbook. Common findings:

- Runbook is out of date.
- Some dashboards have been renamed.
- A new team owns the downstream and doesn't know the old runbook.
- The on-call rotation has a new junior who hasn't seen the dashboard.

Each finding is a small fix. Drilling keeps the response sharp.

### Postmortem template

After a shutdown incident:

```markdown
# Postmortem: Slow Shutdown in checkout-service

Date: <date>
Severity: <SEV-X>

## Summary
[1-2 sentences]

## Impact
- Error rate: <X>% for <Y> minutes
- Customers affected: <count>
- Revenue impact: <if known>

## Timeline
- HH:MM Detection
- HH:MM Diagnosis
- HH:MM Mitigation applied
- HH:MM Resolution confirmed

## Root cause
[detailed]

## Contributing factors
[detailed]

## Action items
- [ ] Short-term: <item> [owner] [due]
- [ ] Medium-term: <item> [owner] [due]
- [ ] Long-term: <item> [owner] [due]

## Lessons learned
[bullets]
```

Postmortems are the senior engineer's primary mechanism for systemic improvement.

---

## Appendix: Glossary for Architectural Discussions

A vocabulary for senior-level shutdown conversations.

| Term | Meaning |
|---|---|
| Phase | A named, bounded step in the shutdown sequence. |
| Phase Machine | A state machine where states are phases and transitions have budgets. |
| Drain | The act of refusing new work while completing existing work. |
| Drain Budget | The maximum time allowed for a drain phase. |
| Force-Close | Brutal termination of connections when graceful drain times out. |
| Readiness Gate | A condition (probe) that determines whether traffic should be routed. |
| LB Choreography | The coordinated dance between application drain and LB endpoint removal. |
| Connection Hijack | An HTTP handler taking over the underlying TCP socket (WebSocket, HTTP/2 raw). |
| In-Flight Request | A request whose handler has started but not yet returned. |
| Cooperative Drain | Drain that depends on handlers observing cancellation; opposite is forceful. |
| Forceful Drain | Drain that closes connections without waiting for handlers. |
| Bulkhead | Isolation pattern; one component's failure doesn't propagate to others. |
| Hot Spare | A new instance fully ready before old one drains; eliminates capacity pressure. |
| Drain Contract | Documented promises about drain timing and behaviour. |
| Drain SLO | Service Level Objective quantifying drain quality. |
| Force-Close Rate | Fraction of shutdowns that exceed the drain deadline. |
| Per-Handler Timeout | Maximum duration for an individual request handler. |
| LB Propagation Latency | Time from readiness flip to LB stopping new traffic. |

A vocabulary lets senior engineers talk precisely about the architecture.

---

## Appendix: How Senior Engineers Mentor on Shutdown

A few ways to share senior knowledge with the team.

### Pairing

When a junior writes a new service, pair on the `main.go`. Walk through each line. Explain the *why*, not just the *what*. The junior sees the pattern; the team standardises.

### Code review

Comments on PRs are mentoring opportunities:

- *"Why is `Shutdown` called with `context.Background()`? See <ADR-007>."*
- *"This goroutine doesn't observe `ctx`. What if SIGTERM arrives mid-loop?"*
- *"Have we measured how long the slow path takes? Worth adding a metric."*

Each comment is a teaching moment.

### Internal talks

A 30-minute talk on "Graceful Shutdown in Our Services" once a year. Covers the patterns, the SLO, the dashboards, the runbook. New hires watch the recording.

### Templates

The team's service template includes the canonical shutdown pattern. New services inherit it. The template is the most-effective teaching tool.

### Postmortems

Postmortems are written for the team's future selves. Each shutdown incident becomes a story; the story becomes a runbook entry; the runbook becomes a checklist; the checklist becomes a linter rule.

---

## Appendix: When a Senior Says "It's Not Worth It"

Sometimes the right senior call is "we don't need this complexity."

### "We don't need a phase machine"

For a 3-component service, a flat `errgroup` is enough. The phase machine is overkill.

### "We don't need a chaos test for SIGKILL"

If you have never hit `terminationGracePeriodSeconds`, the SIGKILL path is exercised by chaos testing in K8s itself.

### "We don't need a separate `/readyz`"

If your LB only checks `/healthz`, then readiness vs liveness is academic. Use one endpoint and flip its response based on state.

### "We don't need traces for shutdown"

For a low-volume service, logs are enough. Traces add cost without benefit.

### "We don't need a separate library"

For a single service, inline the shutdown code in `main`. Extract only when 3+ services would share it.

The senior engineer knows when *not* to add complexity. Discipline matters as much as knowledge.

---

## Appendix: Multi-Cluster Shutdown Considerations

Some services run in many clusters (regions, environments, partitions). The shutdown story scales up.

### Per-cluster autonomy

Each cluster's pods shut down on their own. No cross-cluster coordination needed for individual pod shutdowns.

### Cross-cluster traffic shifting

When a cluster goes offline (for maintenance or in an incident), traffic shifts to other clusters. The "shifting" is a separate concern from individual pod shutdown.

A simple example: GCP global LB with regional backends. Each backend is a regional K8s service. Health checks per region. If a region fails, traffic moves to other regions.

The pod-level graceful shutdown ensures clean handoffs. The cluster-level traffic shift ensures global continuity.

### Disaster recovery

In a true regional outage, pod-level graceful shutdown doesn't matter — the pods are gone. The recovery is cluster-level: bring up replacements elsewhere.

Senior engineers think about both layers: per-pod shutdown for daily operations, cluster-level continuity for incidents.

### Multi-tenancy and shutdown

For services serving multiple tenants, shutdown of one tenant's resources shouldn't affect another tenant. Bulkheads matter.

```go
// Per-tenant shutdown isolation
type TenantBucket struct {
    handlers map[string]*http.Server
}

func (b *TenantBucket) Drain(tenant string, ctx context.Context) error {
    srv, ok := b.handlers[tenant]
    if !ok { return nil }
    return srv.Shutdown(ctx)
}
```

This is overkill for most services. Worth knowing the pattern exists.

---

## Appendix: Mythology and Misconceptions

A few senior-level myths to dispel.

### Myth: "Graceful shutdown takes 30 seconds"

In a well-tuned service, p50 shutdown is 1–3 seconds. Only the tail approaches 30. If p50 is 25 seconds, something is wrong.

### Myth: "Shutdown is the same as Close"

`Shutdown` waits; `Close` kills. They are different APIs with different contracts. Confusing them produces bugs.

### Myth: "Force-close is bad"

Force-close after a failed graceful drain is the *correct* fallback. The graceful drain is the goal; force-close is the safety net. Both are healthy.

### Myth: "We don't need shutdown — we just run in K8s"

K8s gives you 30 seconds before SIGKILL. Without graceful shutdown, in-flight requests fail every deploy. K8s does not save you.

### Myth: "Idempotency replaces graceful shutdown"

Idempotency makes retries safe. Graceful shutdown reduces the *need* for retries. Both are valuable; neither replaces the other.

### Myth: "WebSockets can't be drained gracefully"

They can. Send a close frame, wait, force-close. The pattern is the same; only the unit differs.

### Myth: "Stateful services can't have graceful shutdown"

They can. The drain is more complex (replication lag, state persistence), but the pattern applies.

### Myth: "Drain longer than 30 seconds is fine"

It's fine *if your `terminationGracePeriodSeconds` accommodates it*. Set the orchestrator's expectation; don't fight it.

---

## Appendix: A Comprehensive Question to Test Senior-Level Mastery

Try answering this in 5 minutes.

> Design the shutdown architecture for a checkout service that:
> - Handles 1000 RPS at peak.
> - Calls 3 downstream services per request (auth, payment, inventory).
> - Has 100 replicas across 3 K8s clusters.
> - Has p99 request latency of 200ms.
> - Has rare p999 outliers at 5 seconds (slow downstream).
> - Runs Kafka producer for "order created" events.
> - Uses Postgres and Redis.
> - Deploys daily, rolling 25% at a time.
>
> What is your terminationGracePeriodSeconds? Drain budget? Per-handler timeout? Readiness probe configuration? Metrics? Tests? Document the trade-offs.

A senior answers something like:

- `terminationGracePeriodSeconds: 35` (drain budget 25s + preStop 5s + margin 5s).
- Drain budget 25s, split: ready_off 3s, drain_http 12s, drain_workers 5s, flush_kafka 3s, close_outbound 2s.
- Per-handler timeout 10s (caps the slow p999 within drain budget).
- Readiness probe: `periodSeconds: 1`, `failureThreshold: 2`. 2-second detection.
- preStop: `sleep 5` for LB removal.
- Metrics: standard set. Plus per-downstream latency to diagnose slow tail.
- Tests: integration test for clean exit; chaos test for slow downstream during drain.
- Trade-off: 35s grace period × 25 batches = 14 minutes longer deploys, but error rate drops from 0.4% to 0.01%. Worth it.

The discussion of trade-offs is the senior-level marker.

---

## Appendix: The Senior Engineer's Habit of Pre-Mortem

Before deploying a new service, run a pre-mortem:

> "It is six months from now. This service has had a major incident. What was the cause?"

For shutdown-related pre-mortems, brainstorm:

- "A handler hung indefinitely; the pod was SIGKILLed every deploy."
- "Kafka producer was slow to flush; messages were lost at deploy time."
- "preStop hook hit a timeout; SIGTERM was never delivered."
- "Downstream went down during deploy; cascading failure."
- "Database close raced with in-flight queries; pool exhausted errors."

Each pre-mortem hazard becomes a design item:

- Per-handler timeouts.
- Kafka flush budget + idempotency.
- preStop with bounded duration.
- Circuit breaker on downstreams.
- DB close after server drain.

Pre-mortems are cheap and prevent expensive post-mortems.

---

## Appendix: How to Convince Stakeholders to Invest in Shutdown

Selling shutdown engineering up the chain:

### Quantify

"Our deploy error rate is 0.4%. Each deploy causes 4000 failed requests. We deploy 5 times a day. That is 20 000 daily failed requests due to shutdown alone."

### Compare

"After graceful shutdown is implemented, this drops to <100 failed requests per day. A 200x reduction."

### Estimate effort

"Implementation: 1 week. Maintenance: ~2 hours/quarter. Tests: 0.5 day to write, runs in CI."

### Compare to alternatives

"Alternative: blue/green deploys with manual cutover. Effort: months. Maintenance: significant. Reduces error rate similarly but adds operational complexity."

### Cite benchmark

"Industry standard is graceful shutdown for any service with >10 RPS. Our service does 1000 RPS."

Most stakeholders sign off after this conversation. The senior engineer is the one who can have it.

---

## Appendix: Skills Beyond Shutdown That Senior Engineers Need Here

A short list of related skills the shutdown problem touches:

- **Distributed systems.** Cross-service coordination, retries, idempotency.
- **Networking.** TCP semantics, connection lifecycle, OS-level signals.
- **Container orchestration.** K8s pod lifecycle, kubelet, kube-proxy.
- **Observability.** Metrics, logs, traces; designing for diagnosability.
- **Architecture.** State machines, contracts, bulkheads.
- **Operations.** Runbooks, postmortems, on-call practice.
- **Trade-off analysis.** Quantifying costs and benefits.
- **Mentoring.** Sharing the knowledge with junior engineers.

A senior with deep shutdown skills has deep skills in all of these. Shutdown is a microcosm of distributed-systems engineering.

---

## Closing: The Senior Engineer's Test

You are a senior on graceful shutdown if you can:

- Open any Go service's `main.go` and identify shutdown bugs within 60 seconds.
- Build a phase machine from scratch in 30 minutes.
- Diagnose a slow shutdown in production from logs and metrics in 5 minutes.
- Write a runbook for the team's on-call rotation.
- Make a trade-off decision (e.g., longer grace period vs faster deploys) and defend it.
- Mentor a junior through their first graceful-shutdown implementation.

If any of these is uncertain, return to the relevant section. The senior file is dense; absorbing it takes multiple passes.

The professional file goes one level deeper: kernel-level signal delivery, container runtime semantics, force-kill mechanics, and the runtime internals that make Go's shutdown story possible.

---

## Appendix: A Long Detour Through Real Production Patterns

A collection of patterns observed in actual production systems, with the rationale for each.

### Pattern A — The "warm shutdown"

Some services pre-compute the in-flight state and persist it to disk before exiting. On restart, the state is loaded and the service resumes near-instantly.

Useful for services with long warm-up times: search indexes, ML inference servers, caches with expensive precomputation.

The shutdown adds:

```go
mgr.Add(shutdown.Phase{
    Name: "persist_warm_state", MaxBudget: 10 * time.Second,
    Run: func(ctx context.Context) error {
        return warmState.Persist(ctx, "/var/warm-state.bin")
    },
    BestEffort: true,
})
```

On startup:

```go
if data, err := os.ReadFile("/var/warm-state.bin"); err == nil {
    warmState.Restore(data)
} else {
    warmState.RebuildFromScratch() // slow
}
```

Trade-off: persistence adds shutdown time; saves startup time. For frequent restarts, the math works out.

### Pattern B — The "two-phase commit drain"

A service that writes to multiple stores (DB + cache + search) needs to ensure either all writes succeed or none. During drain, the in-flight writes are at risk of partial commit.

The solution is two-phase commit: write to a "pending" log, commit to all stores, mark the log entry "done." On restart, scan the log for pending entries and replay or roll back.

```go
type WriteLog struct {
    file *os.File
}

func (l *WriteLog) Pending() ([]Entry, error) {
    // ... scan file for entries marked "pending"
}

func (l *WriteLog) Append(e Entry) error {
    // ... write entry with state "pending"
}

func (l *WriteLog) MarkDone(id string) error {
    // ... mark entry "done"
}
```

On shutdown, the log is flushed to disk:

```go
mgr.Add(shutdown.Phase{
    Name: "flush_write_log", MaxBudget: 2 * time.Second,
    Run: func(ctx context.Context) error {
        return writeLog.Flush(ctx)
    },
})
```

This pattern adds operational complexity but ensures correctness under partial-shutdown scenarios.

### Pattern C — The "graceful binary swap"

For services that cannot tolerate downtime, the binary is swapped without dropping connections. The old binary forks (via `exec`) and passes the listening socket to the new binary via file descriptor. The old binary drains its existing connections; the new accepts new ones.

```go
// Old binary, on receiving SIGHUP
if isHotRestartRequested() {
    listenerFD := getListenerFD()
    newBinaryPath, _ := os.Executable()
    env := append(os.Environ(), fmt.Sprintf("LISTENER_FD=%d", listenerFD))
    cmd := exec.Command(newBinaryPath, os.Args[1:]...)
    cmd.Env = env
    cmd.ExtraFiles = []*os.File{listenerFile}
    if err := cmd.Start(); err != nil { return err }
    // Continue serving until existing connections drain
    drainAndExit()
}

// New binary, on startup
if fd := os.Getenv("LISTENER_FD"); fd != "" {
    f := os.NewFile(uintptr(fdNum), "listener")
    ln, _ := net.FileListener(f)
    // ... use ln as the server listener
}
```

`cloudflare/tableflip` is the most common Go library for this. Used by services that cannot rely on K8s rolling updates (typically very high-traffic edge services).

### Pattern D — The "drain coordinator service"

For a fleet of services with complex interdependencies, a central "drain coordinator" knows the order. Each service reports its drain status; the coordinator advances the deploy.

```
Coordinator: "Service A, drain."
Service A: "Drained."
Coordinator: "Service B, drain."
Service B: "Drained."
...
```

This pattern is used by some large-scale orchestration systems. For most teams, K8s + readiness probes is enough.

### Pattern E — The "graceful self-replacement"

A pod detects it is about to be terminated (via `terminationGracePeriodSeconds` or by polling the K8s API). It pre-emptively starts a new pod and transfers state before draining. Used by some stateful services.

Complex; rare. Worth knowing exists.

---

## Appendix: A Day in the Life of a Senior Engineer (Shutdown Edition)

### 09:00 — Morning checks

Glance at the shutdown dashboard. P99 looks normal. Force-close rate is 0. Move on.

### 10:30 — PR review

A junior submits a new service. Their `main.go` is missing `signal.NotifyContext`. Comment: "We rely on graceful shutdown for all services; see <internal docs link>. Suggest adding the standard pattern."

### 13:00 — Incident response

Slow deploy alert. P99 shutdown jumped to 28 seconds. Investigation:

- Grep deploy logs: find the slow phase.
- It's `drain_http`. Spike of in-flight requests at shutdown.
- Cross-reference: the `/export` endpoint has p999 latency of 20 seconds today.
- File ticket: "/export needs per-handler timeout. Or async pattern."

Mitigation: extend deploy budget by 5s. Plan: implement the fix this week.

### 14:30 — Design review

A team is building a new ML inference service. Long-running streams. They ask: how should shutdown work?

Sketch:

- Streaming handlers observe both `r.Context()` and `serviceCtx`.
- On shutdown, send "going away" to all active streams.
- Wait 10 seconds for client-driven close.
- Force-close stragglers.
- terminationGracePeriodSeconds: 30 (mostly idle drain).

Two-page design doc.

### 16:00 — Mentoring

A junior asks: "Why does my background goroutine not exit on shutdown?"

Walk through: they took `context.Background()` instead of the service-wide `ctx`. Show how to fix. Discuss the rule: "every goroutine accepts a `ctx`."

### 17:00 — End of day

Update the runbook with what was learned from the incident. Commit it. Done.

This is a typical day. Shutdown engineering is part operational discipline, part code, part mentorship. Senior engineers do all three.

---

## Appendix: A Reading Reflection

After reading this senior file, reflect:

- Which patterns are you using today?
- Which would you want to introduce?
- Which trade-offs would you make differently?
- What questions remain?

The reading is most useful when applied. Pick one pattern; implement it in a service this week. The pattern will stick because you used it.

---

## Appendix: Connecting to Other Senior Skills

Graceful shutdown sits in the middle of many senior-level skills:

- **Distributed systems.** Cross-service coordination during deploys.
- **Cloud-native architecture.** K8s lifecycle, service mesh.
- **Observability.** Metrics, logs, traces designed for diagnosability.
- **Resilience engineering.** Circuit breakers, idempotency, retry policies.
- **Capacity planning.** Surge capacity, regional failover.
- **Operations.** Runbooks, on-call, postmortems.
- **Software design.** State machines, contracts, separation of concerns.

A senior engineer treats shutdown as a window into all of these. Mastery of shutdown correlates with mastery of system design more broadly.

---

## Appendix: A Final Code Sample — The Whole Story

For reference, the complete senior-grade shutdown pattern in one place. About 200 lines including comments.

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

    "golang.org/x/sync/errgroup"

    "example.com/myservice/internal/db"
    "example.com/myservice/internal/kafka"
    "example.com/myservice/internal/redis"
    "example.com/myservice/internal/server"
    "example.com/myservice/internal/shutdown"
    "example.com/myservice/internal/workers"
)

const (
    shutdownBudget      = 25 * time.Second
    readyDelay          = 3 * time.Second
    perHandlerTimeout   = 10 * time.Second
    httpDrainBudget     = 12 * time.Second
    grpcDrainBudget     = 12 * time.Second
    workerDrainBudget   = 5 * time.Second
    kafkaFlushBudget    = 2 * time.Second
    resourceCloseBudget = 1 * time.Second
)

func main() {
    if err := run(); err != nil {
        log.Fatalf("fatal: %v", err)
    }
}

func run() error {
    cfg, err := loadConfig()
    if err != nil {
        return fmt.Errorf("config: %w", err)
    }

    rootCtx, stopSig := signal.NotifyContext(context.Background(),
        syscall.SIGINT, syscall.SIGTERM)
    defer stopSig()

    var ready atomic.Bool
    ready.Store(true)

    // Dependencies (opened in order; closed in reverse).
    database, err := db.Open(rootCtx, cfg.DBURL)
    if err != nil {
        return fmt.Errorf("db: %w", err)
    }

    cache, err := redis.Open(rootCtx, cfg.RedisURL)
    if err != nil {
        return fmt.Errorf("redis: %w", err)
    }

    producer, err := kafka.NewProducer(cfg.KafkaBrokers)
    if err != nil {
        return fmt.Errorf("kafka: %w", err)
    }

    apiSrv := server.NewAPI(cfg, database, cache, producer, &ready, perHandlerTimeout)
    grpcSrv, grpcLis, err := server.NewGRPC(cfg, database)
    if err != nil {
        return fmt.Errorf("grpc: %w", err)
    }
    metricsSrv := server.NewMetrics(cfg)
    workersMgr := workers.New(cfg, database, cache, producer)

    // Phase machine.
    mgr := shutdown.NewManager(shutdown.LogObserver{})
    mgr.Add(shutdown.Phase{
        Name: "ready_off", MaxBudget: readyDelay + time.Second,
        Run: func(ctx context.Context) error {
            ready.Store(false)
            log.Println("readiness flipped to draining")
            select {
            case <-time.After(readyDelay):
            case <-ctx.Done():
            }
            return nil
        },
    })
    mgr.Add(shutdown.Phase{
        Name: "drain_inbound", MaxBudget: httpDrainBudget,
        Run: func(ctx context.Context) error {
            eg, ectx := errgroup.WithContext(ctx)
            eg.Go(func() error {
                if err := apiSrv.Shutdown(ectx); err != nil {
                    _ = apiSrv.Close()
                    return err
                }
                return nil
            })
            eg.Go(func() error {
                done := make(chan struct{})
                go func() { grpcSrv.GracefulStop(); close(done) }()
                select {
                case <-done:
                    return nil
                case <-ectx.Done():
                    grpcSrv.Stop()
                    return ectx.Err()
                }
            })
            return eg.Wait()
        },
    })
    mgr.Add(shutdown.Phase{
        Name: "stop_workers", MaxBudget: workerDrainBudget, BestEffort: true,
        Run: func(ctx context.Context) error {
            return workersMgr.Stop(ctx)
        },
    })
    mgr.Add(shutdown.Phase{
        Name: "flush_kafka", MaxBudget: kafkaFlushBudget, BestEffort: true,
        Run: func(ctx context.Context) error {
            return producer.Flush(ctx)
        },
    })
    mgr.Add(shutdown.Phase{
        Name: "close_resources", MaxBudget: resourceCloseBudget, BestEffort: true,
        Run: func(ctx context.Context) error {
            _ = producer.Close()
            _ = cache.Close()
            _ = database.Close()
            _ = metricsSrv.Shutdown(ctx)
            return nil
        },
    })

    // Run servers in parallel.
    g, gctx := errgroup.WithContext(rootCtx)
    g.Go(func() error {
        log.Printf("API listening on %s", cfg.APIAddr)
        if err := apiSrv.ListenAndServe(); err != nil &&
            !errors.Is(err, http.ErrServerClosed) {
            return fmt.Errorf("api: %w", err)
        }
        return nil
    })
    g.Go(func() error {
        log.Printf("gRPC listening on %s", cfg.GRPCAddr)
        if err := grpcSrv.Serve(grpcLis); err != nil {
            return fmt.Errorf("grpc: %w", err)
        }
        return nil
    })
    g.Go(func() error {
        log.Printf("metrics listening on %s", cfg.MetricsAddr)
        if err := metricsSrv.ListenAndServe(); err != nil &&
            !errors.Is(err, http.ErrServerClosed) {
            return fmt.Errorf("metrics: %w", err)
        }
        return nil
    })
    g.Go(func() error {
        return workersMgr.Run(gctx)
    })

    g.Go(func() error {
        <-gctx.Done()
        log.Printf("shutdown signal: %v", gctx.Err())
        if err := mgr.Run(context.Background(), shutdownBudget); err != nil {
            log.Printf("shutdown error: %v", err)
            return err
        }
        return nil
    })

    return g.Wait()
}
```

This is production-grade. Every concept from this file is present: phase machine, observable transitions, deadline-bounded phases, parallel inbound drain, sequential outbound drain, fallback close, structured logging, dependency-injected components.

A team that copies this pattern across all its Go services has standardised on a robust lifecycle. Onwards to professional.md, where we look under the hood at how all of this works in the runtime and the kernel.

---

## Appendix: Senior-Level Summary

The senior level treats graceful shutdown as a *design discipline*:

- Phase machines, not ad-hoc code.
- Contracts, not implicit promises.
- SLOs, not vague targets.
- Runbooks, not tribal knowledge.
- Postmortems, not blame.
- Mentoring, not gatekeeping.

The senior engineer is not the person who knows the most about `Shutdown`'s implementation. The senior engineer is the person who treats shutdown as one part of a larger system and designs the whole accordingly. Every line of this file is in service of that perspective.

---

## Appendix: Common Senior Interview Questions

A round of senior-level interview questions on graceful shutdown.

### Q. Walk me through what happens between `kubectl delete pod` and the pod actually exiting.

A 5-step answer minimum: pod marked Terminating, endpoints updated, kube-proxy propagates, preStop runs, SIGTERM delivered, application drains, kubelet observes exit. Bonus: discuss the unsynchronised nature of endpoint updates vs SIGTERM.

### Q. Your service has a 2-second p999 shutdown. Why might that be a problem?

If `terminationGracePeriodSeconds=30`, 2-second p999 is fine. But: what about p9999? What about cold start? Senior answer: tail percentiles matter for capacity planning; p99 alone is insufficient.

### Q. Design a phase machine for a service of your choice.

Senior describes 5–7 phases with budgets, observability, fallbacks. Asks about per-phase deadlines and total deadlines.

### Q. How do you test shutdown?

Multiple test layers: unit (worker stops on cancel), integration (process exits cleanly), chaos (slow downstream, OOM, double SIGTERM). Bonus: CI integration; metrics for drain duration.

### Q. What is the relationship between liveness and readiness during shutdown?

Liveness stays UP. Readiness flips DOWN. Conflating them causes kubelet restarts mid-drain. Bonus: discuss startup probes.

### Q. What is `terminationGracePeriodSeconds`? How do you choose it?

K8s timer between SIGTERM and SIGKILL. Choose: (drain budget) + (preStop sleep) + (margin). Discuss trade-off: longer = slower deploys; shorter = more force-closes.

### Q. How do you drain a WebSocket?

Hijacked connection. Not in `http.Server`'s tracking. Maintain a registry. On shutdown, send close frame, wait for client-initiated close (with deadline), force-close stragglers. Bonus: link to `RegisterOnShutdown`.

### Q. What is the difference between `Shutdown` and `Close`?

`Shutdown` is cooperative (waits for handlers). `Close` is forceful (interrupts connections). `Close` is the fallback when `Shutdown` times out.

### Q. Your `Shutdown` is taking 25 seconds; what do you do?

Investigate: which phase? If `drain_http`: which handler? If a specific handler is slow: cap it with per-handler timeout. Bonus: discuss tail-latency engineering.

### Q. How do you handle long-lived streams during shutdown?

Send "going away" hint; wait for client reconnect; force-close stragglers. Link `r.Context()` to `serviceCtx`. Discuss browser vs server reconnect logic.

### Q. What is idempotency's role in graceful shutdown?

Allows retries to be safe. Without idempotency, retries on 503 cause duplication. Graceful shutdown reduces retries; idempotency ensures any retries are safe.

### Q. Walk me through `http.Server.Shutdown`'s internal logic.

State flips. Listeners close. Idle connections close. Polling loop on active connections (500ms polling). Returns nil or ctx.Err.

### Q. What is a "preStop" hook? When do you need one?

Runs before SIGTERM. Common use: sleep N seconds for LB to remove endpoint. Alternative: implement readyDelay in code.

### Q. How do you observe shutdown in production?

Metrics: started, phase duration, force-close rate. Logs: structured per phase. Traces: span per phase. SLOs: p99 < X seconds.

### Q. Your service depends on a downstream that frequently has slow drains. How do you protect yourself?

Per-request timeout to downstream. Circuit breaker. Idempotency. Local fallback / cache.

A senior can answer all of these in 60 seconds each. Practice them aloud.

---

## Appendix: A Senior-Level Code Smell Walkthrough

Read this code and find the smells.

```go
func main() {
    sigCh := make(chan os.Signal)
    signal.Notify(sigCh, syscall.SIGTERM)

    srv := &http.Server{Addr: ":8080", Handler: mux}

    db, _ := sql.Open("postgres", os.Getenv("DB_URL"))
    defer db.Close()

    go func() {
        log.Fatal(srv.ListenAndServe())
    }()

    go func() {
        for {
            doPolling()
            time.Sleep(5 * time.Second)
        }
    }()

    <-sigCh
    srv.Shutdown(context.Background())
    os.Exit(0)
}
```

Smells (senior should spot all of these in 30 seconds):

1. `make(chan os.Signal)` — unbuffered. First signal may be dropped.
2. Only `SIGTERM` caught — Ctrl+C (`SIGINT`) not caught.
3. No `defer signal.Stop` — leaks the channel.
4. `defer db.Close()` before `srv.Shutdown` — handlers may use closed DB during drain.
5. `log.Fatal(srv.ListenAndServe())` — `http.ErrServerClosed` would trigger fatal.
6. Polling goroutine ignores `ctx` — doesn't exit on shutdown.
7. `time.Sleep` not cancellable — adds up to 5s drain delay.
8. `srv.Shutdown(context.Background())` — unbounded, no deadline.
9. No fallback `Close`.
10. `os.Exit(0)` — skips deferred `db.Close`.

Ten smells in a 20-line snippet. Common in real code.

The senior asks: "Can you rewrite this cleanly?" Watches the candidate type. Notes which smells they spot without prompting.

---

## Appendix: Senior Engineering Books and Talks

Recommended reading for deepening senior-level shutdown understanding:

- *Site Reliability Engineering* (Google) — chapters on graceful degradation, error budgets.
- *Release It!* (Michael Nygard) — stability patterns including circuit breakers, bulkheads.
- *Designing Data-Intensive Applications* (Martin Kleppmann) — consistency, replication, partial failure.
- *Distributed Systems Observability* (Cindy Sridharan) — metrics, logs, traces.
- Talks: GopherCon talks on lifecycle management; KubeCon talks on pod lifecycle.

A weekend with each adds depth. Senior engineers build a personal library over years.

---

## Appendix: A Final Architectural Vignette

You join a new company. Day one. Your service is unfamiliar; your team is unfamiliar; your stack is unfamiliar. The on-call rotation expects you to start in three weeks.

Your first technical investment: read the shutdown code of the team's flagship service. In 30 minutes, you learn:

- How they structure `main.go`.
- Their conventions for phase machines (or lack thereof).
- Their metrics and logging style.
- Their K8s manifest patterns.
- Their assumptions about downstream behaviour.

Shutdown is a microcosm of the team's engineering practice. A team with mature shutdown patterns has mature engineering practice generally. A team without — has *room for improvement*.

Your first PR: a small improvement to the shutdown of one service. Bug fix, metric addition, runbook entry. Visible value, low risk, learns the codebase.

Your first quarter: drive the team's shutdown patterns toward the "18-item checklist" above. Mentor juniors. Reduce deploy error rate.

This is how senior engineers earn their keep. Shutdown is just the lens through which they apply broader skills.

---

## Appendix: Concluding the Senior File

The senior file is dense. Read it twice. Apply one pattern this week.

The vocabulary is now yours: phases, contracts, SLOs, choreography, bulkheads, drains, force-close, runbook, postmortem, ADR. Use it precisely.

The patterns are now yours: phase machine, two-server, readiness-sentinel, bulkhead drain, hot spare. Implement them where they fit.

The habits are now yours: morning dashboard checks, PR reviews with shutdown lens, postmortems for shutdown incidents, mentorship of juniors. Develop them.

Onwards to professional.md, where we leave architecture and design behind and dive into the runtime mechanisms that make all of this work — or, occasionally, do not.

---

## Appendix: Quick Reference Sheets

For laminated-card-by-the-desk reference.

### Sheet 1: Phase Machine

```
Phase: name, max_budget, best_effort, run(ctx)
Manager: state, phases[], obs
Run(parent, total): for each phase { phase_ctx; safe_run; metrics }
```

### Sheet 2: K8s Lifecycle

```
delete -> Terminating -> endpoints updated -> preStop -> SIGTERM
-> grace_timer -> SIGKILL (if alive)
```

### Sheet 3: Five-Layer LB Handoff

```
App -> /readyz -> kubelet probe -> API server -> kube-proxy -> client
```

### Sheet 4: Time Budget

```
total = ready_off + drain_http + stop_workers + flush + close + margin
total < terminationGracePeriodSeconds
```

### Sheet 5: Failure Modes

```
Signal not received: PID 1 / unbuffered channel
Shutdown blocks: unbounded ctx / stuck handler
Close doesn't help: hijacked connection / blocked goroutine
Resource leak: forgotten defer cancel / forgotten signal.Stop
```

Print, laminate, keep visible.

---

## Appendix: Final Words

You have read perhaps 80 pages worth of senior-level material on graceful shutdown. That is intense. It reflects how much depth there is in something that *looks* like "call `Shutdown` and you're done."

The right takeaway: graceful shutdown is not a 15-line pattern. It is a system-design discipline. The 15 lines are the bottom of the iceberg. The 18-item checklist is the visible iceberg. The cultural practice of mentorship, runbooks, postmortems, and ADRs is the rest of the iceberg.

A senior engineer who has internalised this file ships services that deploy cleanly forever. The customers do not notice the engineering. That is the point.

Onwards.

---

## Appendix: A Compendium of Cross-References

The senior file refers to many concepts across the Roadmap. For quick navigation:

- **Channels and context.** Mid-level concurrency patterns. Heavy use here.
- **`errgroup`.** Mid-level concurrency. The default coordination primitive.
- **Goroutines and lifetimes.** Senior-level concurrency. Underlies "every goroutine accepts ctx."
- **Production patterns.** This whole section. Shutdown is one of several.
- **K8s lifecycle.** Operations-level. Surrounds shutdown.
- **Observability.** Cross-cutting. Metrics, logs, traces.
- **API design.** Per-handler timeouts touch API design.
- **Distributed systems.** Idempotency, retries, circuit breakers.

A senior engineer fluent in all of these has the toolkit to design any service for clean operations. Shutdown is one pillar of many.

---

## Appendix: The Senior Engineer's Hippocratic Oath for Shutdown

Half in jest, half serious:

1. *I will not write a goroutine without a stop strategy.*
2. *I will not call `Shutdown` without a deadline.*
3. *I will not catch `SIGTERM` without testing the path.*
4. *I will not close a database before the server drains.*
5. *I will not `os.Exit` from a handler.*
6. *I will log every transition with timing.*
7. *I will emit metrics for every phase.*
8. *I will document the trade-offs in an ADR.*
9. *I will mentor juniors to do the same.*
10. *I will treat shutdown as a first-class system concern, not a footnote.*

A team where every senior engineer takes this oath has clean deploys.

---

## Appendix: Reading List Specific to Senior Shutdown Topics

- Kelsey Hightower's "Kubernetes" talks — pod lifecycle, networking.
- "The Tail at Scale" by Dean & Barroso — tail latency engineering.
- "Hints for Computer System Design" by Butler Lampson — general design principles.
- "How Complex Systems Fail" by Richard Cook — applies to shutdowns and other system events.
- Specific GitHub issues in the Go runtime tracker on signal handling — for the truly curious.

A weekend with each adds depth. Career-long reading habit.

---

## Appendix: A Future Direction

Where is graceful shutdown going?

- **Standardisation.** The patterns in this file will become library-level (more shutdown libraries, fewer hand-rolled `main`s).
- **Observability maturation.** More tools will produce shutdown-specific traces and dashboards.
- **AI-assisted diagnosis.** Anomaly detection on shutdown patterns; automatic ticket creation.
- **Cleaner mesh integration.** Service meshes will handle more of the LB-drain coordination.
- **Better runtime support.** Go's `context` package will continue evolving.

Senior engineers stay current with these trends and adapt their patterns. The principles remain; the implementations evolve.

---

## Truly Final Words

If you have read this far, you have invested hours in graceful shutdown. The investment compounds: every Go service you touch from now on will be a little better for it.

The professional file is next. It is shorter and deeper, focused on the kernel signals and runtime internals that underlie everything in this file. If you have time, read it. If not, the senior level is enough for 95% of production engineering.

Go forth, deploy cleanly, and may your shutdowns always be graceful.

---

## Appendix: A Senior-Level Cookbook of Specific Drain Patterns

For each common backend technology, the exact drain pattern senior engineers use.

### Postgres connection pool

```go
mgr.Add(shutdown.Phase{
    Name: "close_db", MaxBudget: 5 * time.Second, BestEffort: true,
    Run: func(ctx context.Context) error {
        return db.Close() // blocks until in-use conns returned
    },
})
```

`database/sql.DB.Close` is synchronous. With long-running queries, it may exceed your phase budget; the `BestEffort: true` lets us continue.

### Redis (go-redis)

```go
mgr.Add(shutdown.Phase{
    Name: "close_redis", MaxBudget: 1 * time.Second, BestEffort: true,
    Run: func(ctx context.Context) error {
        return rdb.Close() // fire-and-forget
    },
})
```

`go-redis.Close` doesn't wait for in-flight commands. Most Redis ops are sub-millisecond, so this is usually fine.

### Kafka producer (sarama)

```go
mgr.Add(shutdown.Phase{
    Name: "flush_kafka", MaxBudget: 5 * time.Second,
    Run: func(ctx context.Context) error {
        return producer.Close() // waits for pending msgs
    },
})
```

`sarama.SyncProducer.Close` flushes. Use this *before* closing other dependencies the producer might touch.

### Kafka consumer (sarama)

```go
mgr.Add(shutdown.Phase{
    Name: "stop_kafka_consumer", MaxBudget: 5 * time.Second,
    Run: func(ctx context.Context) error {
        consumer.Cancel() // your wrapper
        return consumer.Wait(ctx) // wait for partitions to commit
    },
})
```

The "commit offsets before exit" step is critical for "process at least once" semantics. Without it, you reprocess messages on next startup.

### NATS

```go
mgr.Add(shutdown.Phase{
    Name: "drain_nats", MaxBudget: 5 * time.Second, BestEffort: true,
    Run: func(ctx context.Context) error {
        return nc.Drain() // NATS-specific drain
    },
})
```

NATS has a built-in `Drain` method that flushes and unsubscribes cleanly.

### RabbitMQ (amqp091-go)

```go
mgr.Add(shutdown.Phase{
    Name: "close_amqp", MaxBudget: 2 * time.Second, BestEffort: true,
    Run: func(ctx context.Context) error {
        return ch.Close() // closes channel; conn closed separately
    },
})
```

Two-step: close channel, then connection.

### MongoDB (mongo-driver)

```go
mgr.Add(shutdown.Phase{
    Name: "close_mongo", MaxBudget: 5 * time.Second, BestEffort: true,
    Run: func(ctx context.Context) error {
        return mongoClient.Disconnect(ctx)
    },
})
```

`Disconnect` accepts a context, which is rare and welcome.

### Elasticsearch / OpenSearch

Most clients don't have a `Close` method; they rely on `http.Client`'s underlying transport. Closing idle connections is sufficient.

### S3 / Object storage

Stateless HTTP. No special drain needed beyond closing the HTTP client's idle connections.

### OpenTelemetry SDK

```go
mgr.Add(shutdown.Phase{
    Name: "shutdown_telemetry", MaxBudget: 5 * time.Second, BestEffort: true,
    Run: func(ctx context.Context) error {
        if err := tp.Shutdown(ctx); err != nil { return err }
        if err := mp.Shutdown(ctx); err != nil { return err }
        return nil
    },
})
```

Tracer provider and meter provider both have `Shutdown` methods that flush.

### Sentry

```go
defer sentry.Flush(2 * time.Second) // at top of main
```

Place as a defer in `main`; runs at process exit.

### Custom file writers / log buffers

```go
mgr.Add(shutdown.Phase{
    Name: "flush_logs", MaxBudget: 1 * time.Second, BestEffort: true,
    Run: func(ctx context.Context) error {
        return logger.Sync() // zap/zerolog have Sync
    },
})
```

Log libraries with buffered writes need a final flush. Otherwise the last few log lines may be lost.

### Connections to external APIs

`http.Client` has no `Close`. The underlying `Transport.CloseIdleConnections()` releases keep-alives.

```go
mgr.Add(shutdown.Phase{
    Name: "close_http_clients", MaxBudget: 1 * time.Second, BestEffort: true,
    Run: func(ctx context.Context) error {
        externalAPIClient.Transport.(*http.Transport).CloseIdleConnections()
        return nil
    },
})
```

Optional; the process exit closes all sockets.

### Pprof / debug endpoints

No special drain needed. The pprof goroutines exit when the process exits.

### File handles

`defer f.Close()` at open time. The deferred close runs in `main`'s return path.

---

## Appendix: Bridging Senior and Professional

The senior file ended on architecture and design. The professional file dives into runtime mechanics. The bridge is:

- *Why* are signals delivered the way they are? (Kernel design.)
- *How* does Go intercept them without affecting user code? (Runtime internals.)
- *What* exactly does `Shutdown` do at the syscall level? (`Listener.Close`, `Conn.Close`, etc.)
- *What* is the cost of these operations? (Performance characteristics.)
- *What* changes between Go versions? (Version-specific behaviour.)

These are the questions a professional engineer asks. The senior engineer designs the system; the professional engineer optimises and debugs it at the lowest levels.

Both perspectives matter. Most teams need a senior; some teams need a professional. Knowing which is your role is the meta-skill.

---

## Truly, Truly Final Words

Three thousand seven hundred lines on graceful shutdown. The depth is justified because shutdown is the place where a *huge* fraction of production problems hide. Get it right and a thousand subtle bugs vanish.

Read this file twice. Apply one pattern this week. Mentor one colleague next month. The compounding returns are real.

Onwards. The professional file awaits.

---

## Appendix: Sample SLO Document for Shutdown

A complete SLO document, ready to adapt for your service.

```
# Shutdown SLO — checkout-service

Owner: platform-team
Last reviewed: 2026-05-15

## Objective

99.9% of pod shutdowns complete cleanly within 25 seconds.

## Measurement

- shutdown_started_total
- shutdown_force_close_total
- shutdown_duration_seconds (histogram)

Compute monthly:
  clean_shutdowns = shutdown_started_total - shutdown_force_close_total
  rate = clean_shutdowns / shutdown_started_total
  p99_duration = histogram_quantile(0.99, shutdown_duration_seconds)

## Error budget

0.1% per month. With ~10000 shutdowns/month, budget = 10 force-closes.

## Action when budget is consumed

- Halt non-emergency deploys.
- Investigate root cause.
- Apply fix.
- Resume deploys after budget reset.

## Burn rate alerts

- Slow burn (2x rate): page weekday business hours.
- Fast burn (10x rate): page immediately.

## Related dashboards

- Shutdown overview: <link>
- Per-phase breakdown: <link>
- Postmortems: <link>
```

A page-and-a-half. Reviewed quarterly. Updated when reality changes.

---

## Appendix: After-Action Review Template

For after a shutdown-related incident:

```
# After-Action Review — Incident YYYY-MM-DD

## What was the impact?

[customer-facing impact, error rate, duration]

## What happened?

[5-minute timeline summary]

## Why did it happen?

[root cause + contributing factors]

## What worked?

[detection, communication, mitigation]

## What didn't?

[gaps, false leads, missing tools]

## Action items

| # | Item | Owner | Due | Status |
|---|------|-------|-----|--------|
| 1 | ... | ... | ... | ... |

## Lessons

[generalisable insights]
```

Senior engineers run AARs. They are the team's primary learning loop.

---

## Final Final Word

Senior-level graceful shutdown is a long topic because senior-level engineering is a long topic. This file does not "teach" graceful shutdown — that was the junior file. This file teaches *how to think* about graceful shutdown as a senior engineer. The thinking is portable: it applies to many other system-design problems.

Carry the thinking forward.







