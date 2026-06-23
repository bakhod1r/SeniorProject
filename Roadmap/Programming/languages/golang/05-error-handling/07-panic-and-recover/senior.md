# panic and recover — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Panic as a System Design Concern](#panic-as-a-system-design-concern)
3. [The Panic Boundary Pattern](#the-panic-boundary-pattern)
4. [Goroutine Supervision](#goroutine-supervision)
5. [Panic-to-Error Translation Layers](#panic-to-error-translation-layers)
6. [When Libraries Should Panic](#when-libraries-should-panic)
7. [Stack Trace Strategy at Scale](#stack-trace-strategy-at-scale)
8. [Panics, Telemetry, and Alerting](#panics-telemetry-and-alerting)
9. [Recovery and Application Lifecycle](#recovery-and-application-lifecycle)
10. [Recover and Resource Safety](#recover-and-resource-safety)
11. [Panics Across Service Boundaries](#panics-across-service-boundaries)
12. [Designing for the Unrecoverable](#designing-for-the-unrecoverable)
13. [Architectural Patterns](#architectural-patterns)
14. [Anti-Patterns at Scale](#anti-patterns-at-scale)
15. [Summary](#summary)
16. [Further Reading](#further-reading)

---

## Introduction
> Focus: "How to architect?" and "How to operate at scale?"

At senior level, panic stops being a per-function decision and becomes a **system property**. You decide which boundaries catch panics, which goroutines run with recover supervisors, how panic stack traces flow into observability, and which kinds of panic should trigger an alert versus simply log and continue. The decisions you make here affect availability and the on-call experience for every engineer using the system.

This file is about the architecture, operations, and policy of panic — not the keystrokes.

---

## Panic as a System Design Concern

The senior question is not "what happens when this code panics?" but "what happens to the *system* when something panics?"

Five system-level questions to answer for any service:

1. **Where are panic boundaries?** Every long-lived goroutine and every public-API entry point should be a boundary or sit behind one.
2. **What is recovered, what is not?** Not every panic should be recovered — some indicate corruption that should crash the process so a healthy peer takes over.
3. **What does a recovered panic produce?** Log line, metric increment, alert trigger, error response.
4. **What feedback flows back to development?** Stack trace plus context flowing to issue tracking.
5. **Can a panicked process safely keep running?** A panic during a write transaction may have left state inconsistent. Maybe the right move is to crash and let the next process restart cleanly.

A naive approach is "wrap everything in recover and log." That approach hides corruption: you recover the panic, your service keeps running with broken invariants, and the next request misbehaves. A senior approach is *intentional* — recover where the data is local and the cost is bounded, crash where state may be corrupted.

---

## The Panic Boundary Pattern

A **panic boundary** is a layer in the architecture where panics from below are caught, handled, and not propagated further. Typical boundaries:

- HTTP middleware (per-request boundary).
- gRPC interceptor (per-RPC boundary).
- Goroutine launcher (per-goroutine boundary).
- Worker pool dispatch loop (per-task boundary).
- main (last-resort boundary; rarely useful).

The key property: **inside the boundary, code is allowed to panic** (because it will be caught); **outside the boundary, panics are unexpected** (a panic that escapes is a bug in the boundary itself).

Implementation:

```go
func PanicBoundary(name string, fn func()) {
    defer func() {
        if r := recover(); r != nil {
            metrics.Inc("panic", "boundary", name)
            log.Printf("panic in %s: %v\n%s", name, r, debug.Stack())
        }
    }()
    fn()
}
```

Every long-lived goroutine should run inside one of these:

```go
go PanicBoundary("worker.Process", func() {
    for task := range queue {
        process(task)
    }
})
```

The boundary catches panics from *that* goroutine, no others.

Strict version: re-panic on unknown values, only handle your own:

```go
defer func() {
    if r := recover(); r != nil {
        if pe, ok := r.(*PanicWithContext); ok {
            log.Printf("expected panic: %v", pe)
            return
        }
        // unexpected — let it crash and reveal the bug
        panic(r)
    }
}()
```

This conservative pattern keeps boundaries from masking corruption.

---

## Goroutine Supervision

Long-lived background goroutines (workers, schedulers, listeners) need supervisors that:

1. Recover panics.
2. Log the panic with stack trace.
3. Optionally restart the goroutine.
4. Apply backoff to avoid restart loops.

Sketch:

```go
func Supervise(name string, work func() error) {
    backoff := time.Second
    for {
        err := safeRun(name, work)
        if err == nil {
            return
        }
        log.Printf("supervisor %s: %v; restarting in %v", name, err, backoff)
        time.Sleep(backoff)
        if backoff < time.Minute {
            backoff *= 2
        }
    }
}

func safeRun(name string, work func() error) (err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("%s panicked: %v\n%s", name, r, debug.Stack())
        }
    }()
    return work()
}
```

This is the equivalent of Erlang's "let it crash, supervise the restart." Go does not have OTP, but the pattern translates.

Caveat: do not blindly restart goroutines that hold locks or open files. A panic mid-operation may leave shared state inconsistent. Either design the work to be idempotent (and short-lived) or accept that some panics should crash the process.

---

## Panic-to-Error Translation Layers

A clean architecture often looks like:

```
[external API] <- error -> [translation layer] <- panic+error -> [internal logic]
```

Internal code panics on impossible states; the translation layer catches and converts to errors. This is the same pattern you see in `database/sql` (some drivers panic, the package returns errors), in templating (template engines panic; the wrapper returns errors), in reflection-heavy libraries.

Implementation:

```go
package api

func (s *Server) Handle(req Request) (Response, error) {
    defer func() {
        if r := recover(); r != nil {
            switch v := r.(type) {
            case *internal.UserError:
                // expected internal panic
                metrics.Inc("internal_user_panic")
                // err captured via named return below
            default:
                metrics.Inc("internal_unexpected_panic")
                log.Printf("unexpected panic: %v\n%s", r, debug.Stack())
            }
        }
    }()
    return s.handle(req)
}
```

This is *not* a substitute for proper error returns inside the internal code. It is a safety net for panics that *do* leak — runtime panics, third-party panic, unforeseen impossible states.

Done well, this pattern provides a clean external API while letting internal code stay terse with panic-style assertions.

Done badly, it becomes the equivalent of a Java try/catch wrapping all business logic — expensive, opaque, and hiding bugs.

---

## When Libraries Should Panic

If you publish a Go library, your panic policy is part of the API contract. Three conventions:

### Convention A: never panic from public API

The strictest and most common. Public functions return errors; private helpers may panic on internal pre-condition violations, but those panics should not escape unless the library itself has a bug.

### Convention B: panic on programmer errors only

Panic if the *caller* violated documented preconditions: passing nil to a function that says "must be non-nil," or calling methods in the wrong order. Document this clearly.

```go
// Add adds x to the queue. Panics if q is nil.
func (q *Queue) Add(x int) {
    if q == nil {
        panic("Queue.Add: nil receiver")
    }
    q.items = append(q.items, x)
}
```

### Convention C: `MustX` companion functions

Provide both `Parse(s) (T, error)` and `MustParse(s) T`. Callers with static input use the Must variant; callers with dynamic input use the error variant. The standard library uses this for `regexp`, `template`, `tabwriter`, etc.

A library should pick one convention and document it. Mixing without documentation makes callers afraid of every function call.

---

## Stack Trace Strategy at Scale

In production, you will have panics. Stack traces are your primary debugging signal. Senior decisions:

### Where to capture

Capture **once**, at the boundary closest to the original panic. A re-panic that re-captures loses precision (the stack is now shallower).

### What format

`runtime/debug.Stack()` produces a multi-line text trace. Structured loggers can capture it as a single field:

```go
slog.Error("panic recovered",
    "panic", fmt.Sprint(r),
    "stack", string(debug.Stack()),
    "request_id", reqID,
)
```

### How much

For low-rate services, full stack on every panic is fine. For high-rate services, sample: log every panic but include full stack only on the first N per minute, then a summary.

### Symbolication

Stack traces are line numbers in source files. Make sure your build artifacts retain debug info. Stripping symbols (e.g., `-ldflags="-s -w"`) makes panic traces less useful.

### Where to send

- Logs (always).
- Error tracking (Sentry, Honeycomb, etc.) for grouping and alerting.
- Metrics (just a counter incremented on every recovered panic).

---

## Panics, Telemetry, and Alerting

A panic in production is a signal worth tracking:

```go
metrics.NewCounter("service_panics_total",
    "label1", "boundary",
    "label2", "panic_type",
)
```

Tag with:
- The boundary that caught it (`http_handler`, `worker.foo`, `goroutine.bar`).
- The kind of value (`runtime`, `error`, `string`).
- Optionally, a sanitized one-line summary.

Alerting policies:

- **Sustained panic rate** — more than X per minute means something is broken; page on-call.
- **First-ever panic of a kind** — log it loudly, file a ticket; do not page (one-offs happen).
- **Panic in goroutine that does not have a supervisor** — usually a process crash, captured by exit-code monitoring instead.

The key insight: panics are not just bugs to fix; they are observability data. A change in panic rate often indicates a deploy regression before users notice.

---

## Recovery and Application Lifecycle

Some panics deserve recovery; others deserve a process crash. The senior decision:

| Panic source | Recovery strategy |
|--------------|-------------------|
| One bad request in HTTP handler | Recover, return 500, continue serving |
| Panic in metrics scraper | Recover, log, continue |
| Panic during DB write transaction | Crash, let supervisor restart with clean state |
| Panic during cache update | Recover, log, drop the cache entry |
| Panic in cleanup defer | Crash; cleanup failed, state is unknown |
| Panic in reading a config file at startup | Crash; cannot recover |
| Panic indicating data corruption | Crash; do not propagate corruption |

The rule: recover when the bad state is **local and bounded** (a single request, a single task). Crash when the bad state is **shared and ambiguous** (the database, the cache, the lock state).

A naive blanket recover makes a service that runs forever in a broken state.

---

## Recover and Resource Safety

Panics interact with resources via `defer`:

```go
func process(task Task) error {
    db, err := openTx()
    if err != nil { return err }
    defer db.Rollback() // safe rollback on panic too

    if err := work(db, task); err != nil {
        return err
    }
    return db.Commit()
}
```

This is correct: on panic, `Rollback` runs. On normal return, `Commit` runs first, and then `Rollback` runs (no-op on a committed tx in most drivers — verify with your DB).

Things to be careful about:

1. **Locks held during panic.** `defer mu.Unlock()` runs and releases. Good. But note: the data the lock protected may be in an inconsistent state. Other goroutines holding the same lock will see partial updates.
2. **Goroutines spawned by the panicking function.** They keep running with no idea that their parent panicked. Use a context to signal them.
3. **Network connections.** `defer conn.Close()` runs, but if you were mid-write, peers may see a half-truncated message.
4. **In-flight work.** Panics during a transaction with side effects (HTTP calls, message publishes) may have side effects already committed externally.

Designing for panic safety means thinking about the *invariants* your code maintains, not just the cleanup. A panic between "deduct money" and "credit money" leaves your accounting broken even if all the defers run.

---

## Panics Across Service Boundaries

Distributed systems introduce a harder question: what happens when a service panics mid-RPC?

A gRPC server that panics during a unary RPC:
- The interceptor catches it (if you have a recover interceptor; standard practice).
- The client sees a generic Internal error.
- The connection stays open; subsequent calls work.

A gRPC server that panics during a streaming RPC:
- Same recover, but partial data has already been sent to the client.
- The client must handle "stream ended unexpectedly with internal error."

An HTTP server (default `net/http`):
- Goes one further: net/http already has a recover in its goroutine, **but** it just logs and closes the connection.
- A custom recover middleware lets you return a clean 500.

For exactly-once semantics across panics, the pattern is:
- All side effects through idempotent operations keyed by request ID.
- Persisted state changes wrapped in transactions that abort on panic.
- Retries from clients are safe because the work was either done fully or not at all.

A senior engineer makes this pattern explicit. A junior engineer hopes nothing panics.

---

## Designing for the Unrecoverable

Some panics signal that the *process* is broken, not just the request:

- Concurrent map write detected by the runtime (`fatal error: concurrent map writes`) — this is *not* a normal panic and `recover` cannot catch it.
- Stack overflow (extremely deep recursion).
- Out of memory (depending on form).
- Some data races detected by the race detector in tests.

These are **runtime fatal errors**, distinct from panics. They terminate the process unconditionally. The right response is process-level: a supervisor restarts the process, an orchestrator schedules a new pod, a load balancer drains the bad instance.

If you catch yourself thinking "I want to recover from a fatal error," you are in the wrong layer. Move the boundary outward — to the OS, the orchestrator, the load balancer.

---

## Architectural Patterns

### Pattern: Per-request panic isolation

Every request runs inside a recover boundary. One bad input cannot crash the service.

### Pattern: Long-lived goroutine supervisor

Workers, listeners, schedulers wrapped in a supervisor that recovers, logs, and restarts with backoff.

### Pattern: Two-tier recovery

An inner boundary catches expected internal panics (your library's own); an outer boundary catches unknown panics. The two-tier design separates "expected emergency" from "unexpected crash."

### Pattern: Crash-only software

Embrace process crashes as a recovery mechanism. Design every component to start cleanly from any state. Use orchestration (Kubernetes, systemd) to restart. This is the pattern Erlang champions and that modern container deployments often use de facto.

### Pattern: Panic-allergic public API

Wrap every public function in a recover that converts to error. Internally use panic freely for assertions. Externally, callers see only errors. Used by parsers and template engines.

---

## Anti-Patterns at Scale

- **Blanket recover at main**: catches every panic, hides crashes that should reveal bugs.
- **Recover without telemetry**: panics happen, no one knows, the system rots.
- **Goroutines without supervisors**: one panic in a worker crashes the service.
- **Panic with rich data that ends up in user-facing logs**: leaks PII or schema info.
- **Catching `fatal error`-style runtime aborts** by reading source: you cannot, and trying makes the code more confusing.
- **Recovering from panics caused by your own code's invariant violations**: that is a bug; recovering masks it. Crash, fix, redeploy.

---

## Summary

At senior level, panic stops being a per-function decision and becomes an architecture concern. You define panic boundaries (HTTP, gRPC, goroutine, task), you decide which panics deserve recovery and which deserve a crash, you wire telemetry so panics are visible, and you accept that some panics indicate that the process itself should die so a healthy peer can take over. The senior question is not "did I check this error?" but "does my service stay correct when this entire class of catastrophic failure happens in production?"

---

## Further Reading

- [The Go Blog: Defer, Panic, and Recover](https://go.dev/blog/defer-panic-and-recover)
- [Don't panic — Dave Cheney](https://dave.cheney.net/2012/01/18/why-go-gets-exceptions-right)
- [Erlang's "Let It Crash" Philosophy (Joe Armstrong PhD thesis)](https://erlang.org/download/armstrong_thesis_2003.pdf)
- [Crash-only Software (HotOS '03)](https://www.usenix.org/legacy/events/hotos03/tech/full_papers/candea/candea.pdf)
- [Google SRE Book — Embracing Risk](https://sre.google/sre-book/embracing-risk/)
