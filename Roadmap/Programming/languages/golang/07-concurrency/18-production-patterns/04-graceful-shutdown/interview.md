---
layout: default
title: Interview
parent: Graceful Shutdown
grand_parent: Production Patterns
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/18-production-patterns/04-graceful-shutdown/interview/
---

# Graceful Shutdown — Interview Questions

> Practice questions ranging from junior to staff-level. Each has a model answer, common wrong answers, and follow-up probes.

---

## Junior

### Q1. What is graceful shutdown?

**Model answer.** Graceful shutdown is the process of stopping a long-running program (typically a server) in an orderly way: existing requests are allowed to finish, resources are properly closed, and the process exits cleanly. The opposite is a "hard kill" where the process is terminated immediately with no cleanup, potentially dropping in-flight requests and leaving inconsistent state.

**Common wrong answers.**
- "Shutdown that takes a long time." (No — it's about cleanliness, not duration.)
- "Shutdown with logging." (Logs are nice but not the core point.)

**Follow-up.** *Why does it matter?* — Without graceful shutdown, deploys cause 5xx error spikes; customers see broken responses; the database may have partial writes.

---

### Q2. What is the difference between SIGTERM and SIGKILL?

**Model answer.** SIGTERM (signal 15) is a polite "please stop" signal. Your process can catch it and handle it by initiating cleanup. SIGKILL (signal 9) is unstoppable — the kernel terminates your process immediately. SIGKILL cannot be caught, blocked, or ignored.

**Follow-up.** *When does Kubernetes send SIGKILL?* — After `terminationGracePeriodSeconds` elapses without the container exiting. Effectively, "you had your chance to exit cleanly; now you're gone."

---

### Q3. Write the minimum Go code to handle Ctrl+C cleanly.

**Model answer.**

```go
ctx, stop := signal.NotifyContext(context.Background(),
    syscall.SIGINT, syscall.SIGTERM)
defer stop()

go func() { _ = srv.ListenAndServe() }()

<-ctx.Done()
shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
defer cancel()
_ = srv.Shutdown(shutdownCtx)
```

**Follow-up.** *Why is the channel for `signal.Notify` buffered?* — Because `signal.Notify`'s internal send is non-blocking; an unbuffered channel without a receiver drops the signal. `signal.NotifyContext` handles this internally.

---

### Q4. What does `http.Server.Shutdown` do?

**Model answer.** It (1) closes the listeners so no new connections arrive, (2) closes idle keep-alive connections immediately, and (3) waits for active connections (those serving a request) to finish, up to the provided context's deadline. Returns nil on success or the context's error on timeout.

**Follow-up.** *What does `http.Server.Close` do differently?* — `Close` is brutal: it immediately closes all connections including active ones. Active handlers see their reads/writes fail. Use as fallback when `Shutdown` times out.

---

### Q5. What is `http.ErrServerClosed`?

**Model answer.** It is the error returned by `ListenAndServe` (and `Serve`, `ListenAndServeTLS`) *after* `Shutdown` or `Close` has been called. It indicates a successful shutdown, not a failure. The idiom:

```go
if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
    log.Fatalf("server: %v", err)
}
```

Without the `errors.Is` check, every clean shutdown logs an error.

---

## Middle

### Q6. Why must you bound `Shutdown` with a deadline?

**Model answer.** Without a deadline, `Shutdown` waits forever for in-flight handlers to finish. A single stuck handler can prevent the process from exiting. With a deadline (`context.WithTimeout`), `Shutdown` returns `context.DeadlineExceeded` after the budget elapses, and you can fall back to `Close` to force-terminate active connections.

The deadline must also be shorter than `terminationGracePeriodSeconds`, otherwise Kubernetes will SIGKILL you before your graceful shutdown finishes.

**Follow-up.** *What is the typical deadline?* — 25–30 seconds, matched to `terminationGracePeriodSeconds: 30` minus a few seconds of margin.

---

### Q7. How do you ensure background goroutines exit during shutdown?

**Model answer.** Each background goroutine should accept a `context.Context` and watch its `Done()` channel:

```go
func runWorker(ctx context.Context) {
    ticker := time.NewTicker(5 * time.Second)
    defer ticker.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-ticker.C:
            doWork()
        }
    }
}
```

When the root context (from `signal.NotifyContext`) is cancelled, the goroutine observes `Done()` and returns.

**Follow-up.** *What if the goroutine uses `time.Sleep` instead of `time.NewTicker`?* — `time.Sleep` is not cancellable. The goroutine would sleep until the sleep ends, ignoring the context. Use `time.NewTicker` (or `select` with `time.After`).

---

### Q8. Walk me through what happens between `kubectl delete pod` and the pod exiting.

**Model answer.**

1. API server marks the pod Terminating.
2. EndpointController removes the pod from Service endpoints.
3. kube-proxy propagates the update; new traffic stops landing on the pod.
4. kubelet runs the `preStop` hook (if any).
5. kubelet sends SIGTERM to PID 1 in each container.
6. kubelet starts the `terminationGracePeriodSeconds` timer.
7. The application observes the signal and drains.
8. If the application exits before the timer, kubelet cleans up.
9. If the timer expires, kubelet sends SIGKILL.

**Follow-up.** *Steps 2 and 5 are not synchronised. What's the implication?* — The pod may receive traffic for a few seconds after SIGTERM if step 2 hasn't fully propagated. Hence `preStop sleep N` or `readyDelay` in code, to give endpoint removal time to propagate.

---

### Q9. Your service has HTTP, gRPC, workers, and a database. In what order do they shut down?

**Model answer.** Reverse order of startup:

1. Flip readiness to 503 (LB stops routing).
2. Wait briefly (LB drain).
3. Drain HTTP and gRPC servers (in parallel).
4. Stop background workers (after inbound drained).
5. Flush Kafka producer, traces, logs.
6. Close database, Redis, etc.

The rule: each component shut down before its dependencies. Don't close the database while handlers are still using it.

**Follow-up.** *Can you drain HTTP and gRPC in parallel?* — Yes; they don't depend on each other. Use `errgroup`.

---

### Q10. What is the role of `BaseContext` on `http.Server`?

**Model answer.** `BaseContext` provides the base context for all connections accepted by the server. Each request's `r.Context()` is derived from it. If you set `BaseContext` to your application's root context, every handler can observe shutdown via `r.Context()`:

```go
srv := &http.Server{
    BaseContext: func(_ net.Listener) context.Context {
        return rootCtx
    },
}
```

Without this, handlers are oblivious to shutdown; only `Shutdown`'s polling waits for them to complete naturally.

---

## Senior

### Q11. Design a phase machine for graceful shutdown.

**Model answer.** A phase machine breaks shutdown into named, time-bounded steps:

```
Ready → Draining → ClosingInbound → StoppingBackground → FlushingOutbound → ReleasingResources → Exited
```

Each phase has a `MaxBudget`. The whole machine has a total budget (e.g., 25s) that bounds all phases. Best-effort phases are allowed to fail without aborting the machine.

Implementation: a slice of `Phase` structs, run sequentially within an overall `context.WithTimeout`. Per-phase observability via metrics and logs.

**Follow-up.** *What's the benefit over a flat `errgroup`?* — Each phase is explicitly named, sized, and ordered. Failures are localised. Observability is automatic.

---

### Q12. How do you handle WebSockets in graceful shutdown?

**Model answer.** WebSockets are hijacked connections — `http.Server.Shutdown` does NOT track them. You must maintain your own registry:

```go
type WSRegistry struct {
    mu    sync.Mutex
    conns map[*websocket.Conn]struct{}
}

func (r *WSRegistry) CloseAll(ctx context.Context) error {
    // send close frame to each, wait with deadline, force-close stragglers
}
```

Register via `RegisterOnShutdown` or call from your shutdown coordinator.

**Follow-up.** *What close code do you send?* — 1001 ("going away"). Tells clients to reconnect.

---

### Q13. Why do deploys sometimes cause 5xx spikes despite graceful shutdown?

**Model answer.** Several possibilities:

1. **LB propagation lag.** Endpoint removal hasn't propagated when the pod starts refusing connections. Mitigation: `preStop` sleep or `readyDelay`.
2. **PID 1 issue.** Container init doesn't forward SIGTERM. Mitigation: `ENTRYPOINT` directly to the binary, or use tini.
3. **Unbounded `Shutdown`.** Stuck handler causes deadline exceeded; force-close drops requests.
4. **Background goroutines not joined.** Process exits but background work was incomplete.
5. **DB closed before drain.** Handlers in-flight see "connection closed" errors.

Each has its own diagnostic path.

**Follow-up.** *How do you confirm which it is?* — Logs, metrics, traces. Look at the timeline: when did 503s start? When did pod terminate? What was the shutdown phase progression?

---

### Q14. What is `terminationGracePeriodSeconds` and how do you choose it?

**Model answer.** It is the K8s pod spec field controlling the timer between SIGTERM delivery and SIGKILL. Default 30 seconds. Choose it as:

```
terminationGracePeriodSeconds = preStop sleep + shutdownBudget + margin
```

For typical service: `5 + 20 + 5 = 30`. Set explicitly even if matching default, for clarity.

**Follow-up.** *Trade-off of increasing it?* — Slower deploys. With 100 pods rolling 25% at a time, each batch's worst case is `terminationGracePeriodSeconds` long. Doubling it doubles deploy time.

---

### Q15. How do you observe and monitor shutdown in production?

**Model answer.** Three layers:

1. **Metrics.** `shutdown_started`, `shutdown_duration_seconds`, `phase_duration_seconds{phase}`, `force_close_total`. Dashboards on each.
2. **Logs.** Structured per-phase: "phase X started," "phase X ended in Y duration."
3. **Traces.** A span per phase. Flame graphs reveal the slow phases.

Plus an SLO: "99.9% of shutdowns complete within 25 seconds." Alerts on burn rate.

**Follow-up.** *Why per-phase metrics rather than just total?* — Total tells you "shutdown was slow." Per-phase tells you "the drain_http phase was slow because of in-flight uploads." Different fixes.

---

## Staff / Principal

### Q16. Design the graceful shutdown architecture for a service with these constraints: 1000 RPS, 100 pods, daily deploys, p999 request latency 5s, downstream calls to 3 services, Kafka producer, Postgres + Redis.

**Model answer.**

- `terminationGracePeriodSeconds: 35`
- `preStop`: `sleep 5` (LB drain)
- Shutdown budget: 25s
  - readyDelay: 3s
  - drain HTTP: 12s
  - drain workers: 5s
  - flush Kafka: 2s
  - close DB/Redis: 1s
  - margin: 2s
- Per-handler timeout: 10s (caps the p999 tail)
- `BaseContext` set to root context
- Circuit breaker on downstream calls
- Idempotency keys on state-changing endpoints
- Metrics for each phase
- Integration test in CI
- Chaos test for slow downstream

Trade-off: longer `terminationGracePeriodSeconds` means slower deploys, but with surge capacity and rolling 25%, total deploy time is manageable.

**Follow-up.** *What if one of the downstreams becomes unavailable during shutdown?* — Circuit breaker should already be tripped. Handlers fail fast (within the per-handler timeout). Drain completes within budget.

---

### Q17. Your team is migrating a legacy Go service from no graceful shutdown to fully graceful. How do you sequence the work?

**Model answer.** Five-PR plan:

1. **PR 1 (minimum viable).** `signal.NotifyContext`, `Shutdown` with deadline, `Close` fallback, `errors.Is` check. Reduces 5xx rate from 0.5% to 0.05%.
2. **PR 2 (readiness).** Add `/readyz` flip on shutdown. Add `preStop` hook or `readyDelay`. Eliminates connection resets.
3. **PR 3 (observability).** Metrics, logs, traces per phase. Visibility into slow drains.
4. **PR 4 (tests).** Integration test that asserts clean exit. Chaos test for slow downstream. Adds to CI.
5. **PR 5 (tuning).** Based on metrics: per-handler timeouts, `BaseContext`, tuned `terminationGracePeriodSeconds`. Brings 5xx to <0.001%.

Each PR is small, independently reviewable, ships incremental value.

---

### Q18. How do you handle long-lived connections (SSE, gRPC streams) during shutdown?

**Model answer.** Send a "going away" hint, wait for client-driven close, force-close stragglers.

For SSE: include a "close-soon" event in the stream.
For gRPC: close the stream with `Unavailable` status; clients reconnect.

Link `stream.Context()` to the service context so handlers observe shutdown.

**Follow-up.** *What about WebSockets across many pods?* — A pod's WebSockets close. Clients reconnect, likely to another pod. Distribute the reconnections via jitter to avoid thundering herd.

---

### Q19. A senior engineer's PR has the following code. What do you say?

```go
func main() {
    sigCh := make(chan os.Signal)
    signal.Notify(sigCh, syscall.SIGTERM)
    go srv.ListenAndServe()
    <-sigCh
    srv.Shutdown(context.Background())
}
```

**Model answer.** Five issues:

1. Unbuffered channel — signal may be dropped.
2. Missing `SIGINT` — Ctrl+C doesn't work for development.
3. No `defer signal.Stop` — leaks the registration.
4. No `errors.Is(err, http.ErrServerClosed)` check on `ListenAndServe`.
5. `Shutdown(context.Background())` — unbounded; a stuck handler blocks forever.

**Follow-up.** *Suggest the rewrite.* — `signal.NotifyContext`, `defer stop`, server in goroutine with error check, `Shutdown` with `WithTimeout`, fallback `Close`.

---

### Q20. How does Go's runtime intercept signals without breaking user code?

**Model answer.** The runtime installs its own signal handler via `sigaction(2)` for every signal it cares about. When the kernel delivers a signal:

1. The kernel pushes a frame on the thread's stack and calls `runtime.sigtramp`.
2. `sigtramp` calls `runtime.sighandler`.
3. `sighandler` examines the signal:
   - Synchronous (SIGSEGV, etc.): convert to a goroutine panic.
   - Asynchronous (SIGTERM, etc.): enqueue for `signal_recv` goroutine.
4. `sighandler` returns.
5. Kernel resumes the interrupted code.

The `signal_recv` goroutine wakes, drains the queue, calls `process(sig)` from `os/signal`. `process` does non-blocking sends to user channels.

Total latency from kernel-to-user-channel: ~50–200 µs.

---

## Behavioural

### Q21. Tell me about a time you debugged a shutdown issue.

**Model answer template.** Describe: the symptom (e.g., 5xx spike at deploys), the investigation (logs, metrics, traces), the root cause (e.g., PID 1 was a shell), the fix (e.g., `ENTRYPOINT`), the impact (e.g., 5xx rate dropped 10x).

A senior engineer has at least one such story.

---

### Q22. How would you mentor a junior engineer on graceful shutdown?

**Model answer.** Pair-program on their first PR. Walk through `main.go` line by line. Run their integration test. Show them the `errors.Is` idiom, the `defer stop()` requirement, the deadline rule. Leave a comment on every shutdown-related PR thereafter.

The goal is to make the patterns muscle memory, not just knowledge.

---

### Q23. Your service's shutdown was working but now occasionally times out. What do you do?

**Model answer.**

1. Look at the metrics. Has p99 shutdown duration regressed? Which phase?
2. Look at recent deploys. Did anything change in the slow phase?
3. Look at downstream services. Are any slower than before?
4. Look at request patterns. Has any specific endpoint's latency grown?
5. Reproduce locally. Run the integration test; if it fails, you can iterate fast.
6. File a ticket. Track the investigation.
7. Mitigate first (e.g., increase budget temporarily), fix later (root cause).
8. Postmortem afterwards.

---

## Final Tips

For interview preparation:

- **Practice writing shutdown code.** Type the patterns from memory.
- **Read the Go source.** `net/http/server.go`, `os/signal/signal.go`.
- **Understand the K8s lifecycle.** Read the pod lifecycle doc end to end.
- **Know your trade-offs.** Be ready to discuss `terminationGracePeriodSeconds` choices, deadline vs force-close, etc.
- **Have a story.** A real-world debugging or design story is the senior-level test.

Good interviews are conversations. Ask questions back. Show curiosity. Demonstrate the patterns through anecdote.

Best of luck.

---

## Additional Bonus Questions

### Q24. Explain `signal.NotifyContext` to someone who knows `signal.Notify`.

**Model answer.** `signal.NotifyContext` is sugar around `signal.Notify`. It internally creates a buffered channel, calls `Notify`, and bridges channel-receive to context-cancellation via an internal goroutine. The result: you get a `context.Context` that is cancelled on the first signal arrival, plus a `stop` function that deregisters.

The ergonomic win: instead of manually wiring `make(chan os.Signal, 1)`, `signal.Notify`, `<-ch`, you just write `<-ctx.Done()`. Cleaner.

---

### Q25. What is the relationship between `r.Context()`, `BaseContext`, and `rootCtx`?

**Model answer.** Tree:

```
rootCtx (from signal.NotifyContext)
  |
  BaseContext (function returning rootCtx, set on http.Server)
    |
    ConnContext (per-connection)
      |
      r.Context() (per-request, derived from conn context)
```

When `rootCtx` cancels (signal), every derived context cancels too. Handlers observing `r.Context()` see the cancellation.

Without `BaseContext`, the handler's context is `context.Background()` plus request lifetime — no shutdown awareness.

---

### Q26. How does `errgroup.WithContext` differ from manual `WaitGroup` + channel?

**Model answer.** `errgroup.WithContext` provides:

1. **Shared cancellation.** First non-nil error cancels the group's context. Other goroutines see the cancellation.
2. **Single error return.** First error returned from `Wait`.
3. **Simpler API.** No manual `WaitGroup.Add(1)` / `defer Done()` boilerplate.

Manual `WaitGroup` + channel can replicate this with more code. For shutdown coordination, `errgroup` is the conventional choice.

---

### Q27. Walk me through the internals of `signal.Notify`.

**Model answer.**

1. Acquires `handlers.Mutex`.
2. Looks up the channel in `handlers.m`; creates a `handler` struct if new.
3. For each signal: set the bit in the handler's mask. If `handlers.ref[sig]` is 0, call `enableSignal(sig)` (which calls the runtime). Increment ref.
4. Releases mutex.

The runtime's `enableSignal` installs the signal at the OS level (via `sigaction`). After this, the signal is delivered to the runtime's signal handler, which queues it for `signal_recv`, which dispatches via `process`.

The reference counting allows multiple subscribers without conflict.

---

### Q28. A handler is in a TLS handshake at SIGTERM. What happens?

**Model answer.** The connection is in `StateNew` (handshake hasn't completed yet). `closeIdleConns` has a special rule: connections in `StateNew` for more than 5 seconds are treated as idle and closed.

If the handshake is fast (<5s), the connection transitions to `StateActive` on first request, then `StateIdle` after, then is closed by `closeIdleConns`.

If the handshake hangs, after 5 seconds the connection is force-closed, the handshake fails, the client sees a TCP-level reset.

`ReadHeaderTimeout` helps cap handshake-related delays.

---

### Q29. What happens during a shutdown when `BaseContext` is NOT set?

**Model answer.** The handler's `r.Context()` is derived from `context.Background()` plus the connection's lifetime. It is NOT cancelled when shutdown begins. The handler runs until natural completion.

`Shutdown` waits for the handler via its polling loop. If the handler ignores nothing, the deadline eventually fires and `Shutdown` returns. Then `Close` (if called as fallback) interrupts the connection at the socket level; the handler's next read/write fails.

With `BaseContext` linked to `rootCtx`, handlers can proactively bail out, making shutdown faster.

---

### Q30. Explain "best-effort" phases in a shutdown machine.

**Model answer.** A "best-effort" phase is one where failure is logged but the overall shutdown continues. Examples: flushing Kafka, exporting traces, closing Redis. These are nice-to-have; the absence of clean cleanup doesn't compromise the next deploy.

Non-best-effort phases (e.g., the HTTP drain itself, the database close) abort the shutdown machine on failure — though even then, the process exits, just with a logged error.

The distinction is operational: best-effort failures get logged and observed but don't trigger alerts; non-best-effort failures may trigger postmortems.

---

### Q31. How would you instrument a production service for shutdown observability?

**Model answer.** Three categories:

**Counters and Gauges:**
- `shutdown_started_total{service}`
- `shutdown_force_close_total{service}`
- `inflight_requests_at_shutdown_start{service}` (gauge sampled at start)

**Histograms:**
- `shutdown_duration_seconds{service}`
- `phase_duration_seconds{service,phase}`
- `handler_duration_during_shutdown_seconds{service,path}`

**Logs:**
- Per-phase transition with start/end timestamps and duration.

**Traces:**
- A span per phase.

**Dashboards:**
- Total duration p50/p90/p99.
- Per-phase breakdown.
- Force-close rate vs total shutdowns.

**Alerts:**
- p99 total duration > 25s.
- Force-close rate > 1%.

---

### Q32. What's the most subtle shutdown bug you've ever encountered?

**Model answer template.** "We had a service that worked fine in staging but consistently failed deploys in production. After days of investigation: in production, we had a `CMD ["sh", "-c", "/app/server | tee /var/log/app.log"]`. The shell was PID 1. SIGTERM went to the shell, which did NOT forward to the Go binary. After 30 seconds, SIGKILL hit the shell. The Go binary never had a chance to run its graceful shutdown. Fix: switch to `ENTRYPOINT ["/app/server"]` and configure K8s logs via stdout/stderr."

Stories like this are gold in senior interviews.

---

### Q33. Describe a `preStop` hook design for a service with custom drain logic.

**Model answer.** Use an HTTP preStop hook:

```yaml
lifecycle:
  preStop:
    httpGet:
      path: /admin/prestop
      port: 8080
```

Implementation:

```go
mux.HandleFunc("/admin/prestop", func(w http.ResponseWriter, _ *http.Request) {
    log.Println("preStop: flipping readiness")
    ready.Store(false)
    log.Println("preStop: notifying upstream")
    notifyUpstreamDraining()
    log.Println("preStop: waiting for LB propagation")
    time.Sleep(5 * time.Second)
    w.WriteHeader(http.StatusOK)
})
```

The hook is called *before* SIGTERM. By the time SIGTERM arrives, readiness has been flipped, upstream has been notified, and the LB has had 5 seconds to remove the endpoint.

Benefit: visible in K8s events; explicit and debuggable.

---

### Q34. How does `context.WithCancelCause` help in shutdown?

**Model answer.** `WithCancelCause` lets you attach an `error` to the cancellation, retrievable via `context.Cause(ctx)`. In shutdown, you can attach the cause of the cancellation:

```go
ctx, cancel := context.WithCancelCause(parent)
go func() {
    s := <-sigCh
    cancel(fmt.Errorf("signal: %v", s))
}()

// elsewhere
log.Printf("ctx done; cause: %v", context.Cause(ctx))
```

The log shows "signal: terminated" or similar, instead of the generic "context canceled."

Helpful for postmortems: which signal was it? Did a self-health-check cancel? Did a deploy-coordinator cancel?

---

### Q35. Final question: in one sentence, what is graceful shutdown?

**Model answer.** "Graceful shutdown is the orderly transition of a long-running program from serving traffic to exited, allowing in-flight work to complete, resources to be released, and observers to see a clean exit — bounded by a deadline."

A senior engineer can recite this. A staff engineer can compress it to four words: "exit cleanly, on time."

---

## Final Tips on Interview Performance

- **Speak from experience.** Concrete examples trump abstract knowledge.
- **Discuss trade-offs.** Every choice has costs. Articulate them.
- **Ask clarifying questions.** "What's the typical RPS?" "What's the SLO?"
- **Be ready to write code.** Type-test yourself: can you write the canonical pattern in 30 seconds?
- **Know your bugs.** Be ready to discuss bugs you've shipped and learned from.

Good luck.

---

## A Final Note

Practice these questions out loud, in front of a mirror or a study partner. The act of explaining a concept reveals gaps. Interviews are conversations; rehearse the conversation, not just the answers.

Onwards to mastery.

