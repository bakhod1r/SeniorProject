# Panic & Recovery — Middle Level

> **Topic:** [Panic & Recovery Roadmap](README.md)
> **Focus:** The one pattern you *should* recover with — **recover-at-the-boundary**. Per-request and per-worker isolation. Logging and reporting a panic instead of swallowing it. Rust's `catch_unwind`. And the discipline of never letting a recovered panic vanish silently.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [The Recover-at-Boundary Pattern](#the-recover-at-boundary-pattern)
8. [HTTP Middleware Recovery — Per Language](#http-middleware-recovery--per-language)
9. [Per-Worker Isolation in a Pool](#per-worker-isolation-in-a-pool)
10. [Goroutine and Thread Panics Are Not Auto-Contained](#goroutine-and-thread-panics-are-not-auto-contained)
11. [Rust `catch_unwind`](#rust-catch_unwind)
12. [Logging and Reporting a Recovered Panic](#logging-and-reporting-a-recovered-panic)
13. [Never Swallow a Panic](#never-swallow-a-panic)
14. [Code Examples](#code-examples)
15. [Pros & Cons](#pros--cons)
16. [Use Cases](#use-cases)
17. [Coding Patterns](#coding-patterns)
18. [Clean Code](#clean-code)
19. [Best Practices](#best-practices)
20. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
21. [Common Mistakes](#common-mistakes)
22. [Tricky Points](#tricky-points)
23. [Test Yourself](#test-yourself)
24. [Tricky Questions](#tricky-questions)
25. [Cheat Sheet](#cheat-sheet)
26. [Summary](#summary)
27. [What You Can Build](#what-you-can-build)
28. [Further Reading](#further-reading)
29. [Related Topics](#related-topics)
30. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> Focus: **There is exactly one situation where recovering from a panic is routinely correct — the boundary. Learn it precisely, and learn why everywhere else is still wrong.**

At junior level the rule was simple: *default to letting it crash; don't recover defensively.* That rule is right, and it survives intact at this level. But it has one famous, important exception.

Imagine a web server. A single bad request triggers a `nil` dereference deep in one handler. Without intervention, that panic unwinds all the way to `main` and **kills the entire process** — dropping the thousands of *other* in-flight requests that did nothing wrong. That's an absurd blast radius: one malformed request takes down the whole service. The fix is the **recover-at-boundary pattern**: a thin layer wrapped around each request that catches the panic, logs it, reports it, returns a `500` to *that one* client, and lets the server keep serving everyone else.

The same shape appears anywhere you have **isolated units of work**: HTTP requests, queue-worker jobs, cron tasks, gRPC calls, actor messages. Each unit is independent, so a failure in one *should not* propagate to the others. You install one recover boundary per unit. Inside that boundary, the panic discipline is unchanged — you still don't recover; you let bugs surface. The boundary is the *only* recover point.

This page teaches you to install that boundary correctly in Go, Java, Python, and Node; to do the same with Rust's `catch_unwind`; to **log and report** the panic so it isn't lost (the whole point — a recovered panic that nobody investigates is still a bug, just a hidden one); and to recognize the failure mode where the "isolation" was an illusion and the recovery left you with corrupt shared state.

> 🎓 **Why this matters at middle level:** The difference between a junior and a mid-level engineer here is *precision*. The junior either recovers nowhere (one bad request kills prod) or recovers everywhere (every bug is hidden). The mid-level engineer recovers in exactly one place — the boundary — does it correctly (log, report, return error, contain), and lets everything inside stay fail-fast.

---

## Prerequisites

- **Required:** All of [`junior.md`](junior.md) — the two-layer model, unwinding, `defer`/`recover`, "when a program should crash."
- **Required:** You can write an HTTP handler / middleware in at least one of Go, Java/Spring, Python/Flask/FastAPI, or Node/Express.
- **Required:** You know what a goroutine / thread / worker pool is, and that they run concurrently.
- **Helpful:** Familiarity with structured logging — see [Logging — Middle](../logging/middle.md).
- **Helpful:** Exposure to a crash-reporting tool (Sentry, Rollbar). See [Crash Reporting](../crash-reporting/README.md).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Boundary** | A point where independent units of work meet shared infrastructure — the natural place (and *only* good place) to recover from a panic. |
| **Recover-at-boundary** | Installing exactly one recovery point per isolated unit (request, job, task), so a panic in one unit fails *that* unit, not the whole process. |
| **Middleware** | A wrapper around a request handler that runs before/after it — the standard home for the recover boundary in web servers. |
| **Per-request isolation** | The property that one request's failure cannot affect another request. The premise that makes boundary recovery safe. |
| **Worker pool** | A fixed set of long-lived workers pulling jobs off a queue. A panic in a job must not kill the worker (or the pool). |
| **`catch_unwind`** | (Rust) `std::panic::catch_unwind` — catches an unwinding panic at a boundary. The Rust analogue of a recover. |
| **`UnwindSafe`** | (Rust) A marker trait `catch_unwind` requires, signalling that data isn't left in a broken state if a panic crosses the boundary. |
| **`Thread.UncaughtExceptionHandler`** | (Java) A hook that runs when a thread dies from an uncaught exception — the JVM's per-thread boundary. |
| **`recover()` re-panic** | Recovering, inspecting, deciding the state is too damaged, and panicking again to crash on purpose. |
| **Swallowing** | Recovering/catching a panic and doing *nothing* with it — the cardinal sin of this level. |
| **Fingerprint** | A stable identity for a panic (file:line + type) used to group identical crashes in a reporter. See [Crash Reporting](../crash-reporting/middle.md). |

---

## Core Concepts

### 1. Recover Only Where Work Is Isolated

The recover-at-boundary pattern is safe *only* because each unit of work is independent. One HTTP request doesn't share mutable state with another; one queue job is independent of the next. That independence is what lets you discard a failed unit without poisoning the rest. If your "units" secretly share mutable state (a global cache mid-mutation, a held lock), recovery is *not* safe — you'll keep running on corruption.

### 2. The Boundary Is Infrastructure, Not Business Logic

The recover lives in the *framework layer* — the middleware, the worker loop, the dispatcher — not scattered through your handlers. Business code stays fail-fast. There is **one** recover per boundary, written once, reused everywhere. If you find a `recover()` inside business logic, it's almost certainly wrong.

### 3. A Recovered Panic Must Be Logged AND Reported

Recovering is only half the job. The other half is making sure the bug gets *fixed*. That means: log the panic with its stack at `error` level, increment a metric, and send it to your crash reporter. A boundary that recovers silently is *worse* than no boundary, because now the server survives and nobody ever learns the handler is broken.

### 4. Recovery Is Not Forgiveness

Catching a panic doesn't make the underlying bug go away. The handler still has a nil-deref. Tomorrow's identical request panics again. Recovery buys you **availability** (the server lives) at the cost of **one failed request** — it does not buy you correctness. You still owe a fix.

### 5. Goroutine/Thread Panics Escape Your Boundary

This is the trap that catches everyone. Your HTTP middleware recover protects the request goroutine. But if your handler *spawns a new goroutine* and *that* panics, your middleware can't see it — the new goroutine has its own stack. It crashes the whole process. **Every** goroutine/thread you spawn needs its *own* recover, or it's an unguarded blast radius.

### 6. Sometimes the Right Move After Recover Is to Re-Panic

Recovery gives you a *decision point*, not an obligation to continue. You can recover, inspect the damage, decide the process is in an unsafe state (a lock was held, shared state half-mutated), log it, and then `panic` again — crashing deliberately and cleanly rather than limping on corrupted. Recovering and re-panicking is a legitimate, sometimes-correct pattern.

---

## Real-World Analogies

| Concept | Analogy |
|---|---|
| Recover-at-boundary | A restaurant tosses one burnt steak and remakes it — it doesn't close the kitchen for every mistake. |
| Per-request isolation | Hotel rooms — a flooded bathroom in 204 doesn't soak 205, so you can fix 204 without evacuating the floor. |
| Boundary is infrastructure | The fire door is built into the *building*, not carried by each guest. |
| Swallowing a panic | A smoke alarm someone disconnected because it kept going off — the fire still happens, now silently. |
| Logging+reporting the panic | The remade steak comes with an incident slip the chef reviews at close — so the burner gets fixed. |
| Goroutine panic escaping | You child-proofed the living room, but the toddler wandered into the *garage* (a new goroutine) you forgot about. |
| Re-panic after recover | The pilot evaluates a warning light, decides the plane isn't safe, and *deliberately* aborts the takeoff. |
| `catch_unwind` boundary | A blast shield around the test rig — an explosion is contained to the rig, not the whole lab. |

---

## Mental Models

### Model 1: "Bulkheads on a Ship"

A ship survives a hull breach because it's divided into watertight **bulkhead** compartments — one floods, the rest stay dry, the ship floats. Boundary recovery makes each request/worker a bulkhead: one floods (panics), the rest keep running, the process floats. The whole design depends on the bulkheads actually being watertight — i.e., the units actually being isolated. A "bulkhead" with a hole in it (shared mutable state) sinks the ship anyway.

### Model 2: "The Net Goes at the Bottom of the Cliff"

You don't string safety nets across every ledge of a climb — you put *one* at the bottom, at the boundary between "the dangerous part" and "the safe ground." One net (the middleware), catching falls from anywhere above it (any handler), depositing the climber safely (return 500) without ending the expedition (the server). Nets sprinkled at every ledge just hide which ledge people keep falling off.

### Model 3: "Recover = Convert Panic to Error at the Edge"

The cleanest way to think about boundary recovery: it *translates* a Layer-2 panic back into a Layer-1 error **right at the system's edge**, where there's finally someone (the HTTP framework) who can respond sanely (send a 500, NACK the message). Inside, it's a panic. At the edge, it becomes "this request failed." The recover is a one-way translation gate, and it lives only at the gate.

---

## The Recover-at-Boundary Pattern

The pattern has four obligations. Skip any one and you've done it wrong.

```text
   ┌──────────────────────── THE BOUNDARY ────────────────────────┐
   │                                                              │
   │   1. CATCH    recover() / catch / catch_unwind the panic     │
   │   2. LOG      error-level log WITH the stack trace           │
   │   3. REPORT   metric++ and send to crash reporter            │
   │   4. CONTAIN  fail THIS unit only:                           │
   │                 • HTTP  → return 500                          │
   │                 • worker→ NACK/dead-letter the job, keep loop │
   │                 • task  → mark task failed, continue          │
   │                                                              │
   └──────────────────────────────────────────────────────────────┘
            inside this boundary: STILL fail-fast, NO recover
```

1. **Catch** — stop the unwind at the boundary.
2. **Log** — at `error` level, *with the stack trace*. A panic logged without its stack is nearly useless.
3. **Report** — bump a counter (so you can alert on panic rate) and forward to a crash reporter (so the bug gets a ticket).
4. **Contain** — fail *only* this unit. Return an error to this request; dead-letter this job; mark this task failed. The pool, the server, the loop survive.

If you do 1 and 4 but not 2 and 3, you've built a **silent swallower** — the worst outcome, because the bug now hides behind a surviving server forever.

---

## HTTP Middleware Recovery — Per Language

### Go — `net/http` recovery middleware

```go
package main

import (
	"log/slog"
	"net/http"
	"runtime/debug"
)

// Recover wraps a handler so a panic in it fails ONE request, not the server.
func Recover(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				// 2. LOG with stack. 3. REPORT (metric + reporter).
				stack := debug.Stack()
				slog.Error("panic recovered in handler",
					"panic", rec,
					"method", r.Method,
					"path", r.URL.Path,
					"stack", string(stack),
				)
				panicsTotal.Inc()                 // metric for alerting
				report.Capture(rec, stack, r)     // send to Sentry/etc.

				// 4. CONTAIN: this request fails, others are unaffected.
				w.WriteHeader(http.StatusInternalServerError)
				_, _ = w.Write([]byte("internal server error\n"))
			}
		}()
		next.ServeHTTP(w, r) // 1. the panic (if any) unwinds into the defer above
	})
}

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/boom", func(w http.ResponseWriter, r *http.Request) {
		var p *int
		_ = *p // nil dereference → panic, caught by Recover, server keeps running
	})
	// Wrap the whole mux once. Every route gets the boundary.
	http.ListenAndServe(":8080", Recover(mux))
}
```

> The standard library's `net/http` server already recovers panics *per connection* to avoid killing the process — but it does **not** log a stack or return a clean 500, and it aborts the response mid-stream. You still want your own middleware for proper logging, reporting, and a controlled response.

### Java / Spring — a global exception boundary

```java
// Spring MVC: one place that turns any uncaught throwable into a 500 + log + report.
@RestControllerAdvice
public class PanicBoundary {

    private static final Logger log = LoggerFactory.getLogger(PanicBoundary.class);

    @ExceptionHandler(Throwable.class) // catch even RuntimeExceptions/Errors at the edge
    public ResponseEntity<String> handle(Throwable t, HttpServletRequest req) {
        // 2. LOG with stack (SLF4J includes it when you pass the throwable).
        log.error("uncaught throwable on {} {}", req.getMethod(), req.getRequestURI(), t);
        // 3. REPORT
        Sentry.captureException(t);
        panicCounter.increment();
        // 4. CONTAIN: this request → 500. Others unaffected (each runs on its own thread).
        return ResponseEntity.status(500).body("internal server error");
    }
}
```

Spring's servlet model already isolates requests on separate threads, so one request's uncaught exception doesn't end the JVM. The `@RestControllerAdvice` is the boundary where you log, report, and respond.

### Python / Flask — an error handler boundary

```python
import logging, traceback
from flask import Flask, jsonify

app = Flask(__name__)
log = logging.getLogger(__name__)

@app.errorhandler(Exception)  # the boundary: any uncaught Exception in a view
def handle_uncaught(e):
    # 2. LOG with stack.  3. REPORT.
    log.error("uncaught exception in view", exc_info=True)
    sentry_sdk.capture_exception(e)
    panics_total.inc()
    # 4. CONTAIN: this request → 500. Flask isolates requests, so others are fine.
    return jsonify(error="internal server error"), 500

@app.get("/boom")
def boom():
    return {}["missing"]  # KeyError → caught by the boundary, server keeps serving
```

Note: this catches `Exception`, *not* `BaseException` — so `KeyboardInterrupt` and `SystemExit` still propagate correctly, exactly as the junior level warned.

### Node / Express — error-handling middleware

```js
const express = require("express");
const app = express();

app.get("/boom", (req, res) => {
  const obj = null;
  res.json(obj.value); // TypeError → forwarded to the error middleware below
});

// The boundary: Express routes errors (and sync throws) here.
// (For async handlers, wrap them or use express-async-errors so rejections reach this.)
app.use((err, req, res, next) => {
  // 2. LOG with stack.  3. REPORT.
  console.error("uncaught error", { method: req.method, path: req.path, stack: err.stack });
  Sentry.captureException(err);
  panicsTotal.inc();
  // 4. CONTAIN
  res.status(500).json({ error: "internal server error" });
});

app.listen(8080);
```

> Express only routes *synchronous* throws (and `next(err)`) to error middleware. An *async* handler that rejects bypasses it and becomes an `unhandledRejection` — which can crash the process. Use `express-async-errors`, or `try/catch … next(err)` in every async route. This is the Node version of "goroutine panics escape your boundary."

---

## Per-Worker Isolation in a Pool

A worker pool pulls jobs off a queue. One poisoned job must fail *that job* — not kill the worker, and definitely not kill the pool. The recover goes *inside the loop, around each job*.

```go
func (w *Worker) Run(jobs <-chan Job) {
	for job := range jobs {
		w.process(job) // each call recovers internally — a bad job can't kill the loop
	}
}

func (w *Worker) process(job Job) {
	defer func() {
		if rec := recover(); rec != nil {
			slog.Error("panic processing job",
				"job_id", job.ID, "panic", rec, "stack", string(debug.Stack()))
			report.Capture(rec, debug.Stack(), job)
			job.DeadLetter() // 4. CONTAIN: route the poison job aside, keep consuming
		}
	}()
	w.handle(job) // a panic here unwinds into the defer, not into Run's loop
}
```

The critical structural detail: the `recover` must wrap **each job**, *inside* the loop. A common bug is putting `defer recover()` at the top of `Run` — then the *first* panic recovers, but the `for range` loop has already been unwound past, so the worker stops consuming and silently dies. **Recover per job, not per worker lifetime.**

```text
   WRONG                                RIGHT
   ─────                                ─────
   func Run(jobs) {                     func Run(jobs) {
     defer recover()  ← too high          for job := range jobs {
     for job := range jobs {                process(job)  ← recover INSIDE
       handle(job)                        }                  process()
     }                                  }
   }                                    one bad job → that job fails,
   one bad job → loop dies,             loop keeps consuming
   worker stops forever
```

---

## Goroutine and Thread Panics Are Not Auto-Contained

Repeat after the runtime: **a recover only catches panics in its own goroutine/thread.** This is the single most common production-down mistake in this topic.

```go
func badHandler(w http.ResponseWriter, r *http.Request) {
	// The middleware's recover protects THIS goroutine.
	go func() {
		// But this is a NEW goroutine. The middleware can't see it.
		doAsyncWork() // if this panics → WHOLE PROCESS DIES, despite the middleware
	}()
	w.Write([]byte("accepted"))
}
```

The fix: every spawned goroutine gets its own recover. Wrap it in a helper so you can't forget.

```go
// Go runs fn in a goroutine that recovers, logs, and reports its own panics.
func Go(fn func()) {
	go func() {
		defer func() {
			if rec := recover(); rec != nil {
				slog.Error("panic in spawned goroutine",
					"panic", rec, "stack", string(debug.Stack()))
				report.Capture(rec, debug.Stack(), nil)
			}
		}()
		fn()
	}()
}

// usage: Go(doAsyncWork)  — now an async panic is contained, logged, reported.
```

Java has the same trap and the same fix via `Thread.UncaughtExceptionHandler`:

```java
Thread.setDefaultUncaughtExceptionHandler((thread, throwable) -> {
    log.error("uncaught in thread {}", thread.getName(), throwable);
    Sentry.captureException(throwable);
});
// Or per-thread:
var t = new Thread(task);
t.setUncaughtExceptionHandler((th, ex) -> log.error("worker died", ex));
```

Python threads: an uncaught exception in a `threading.Thread` prints a traceback but does *not* propagate to the main thread (and won't crash the process by default). Use `threading.excepthook` (3.8+) to centralize logging/reporting so those failures aren't lost.

---

## Rust `catch_unwind`

Rust's panics, by default, **unwind** — which means you can catch them at a boundary with `std::panic::catch_unwind`. This is the Rust equivalent of the recover-at-boundary pattern, used for exactly the same reason: stop a worker/request panic from tearing down the whole thread/process.

```rust
use std::panic::{self, AssertUnwindSafe};

fn handle_job(job: Job) {
    // The boundary: catch a panic from job processing so one bad job
    // doesn't unwind out and kill the worker thread.
    let result = panic::catch_unwind(AssertUnwindSafe(|| {
        process(job) // may panic! / .unwrap() on None / index OOB
    }));

    match result {
        Ok(()) => {} // normal completion
        Err(payload) => {
            // 2. LOG  3. REPORT  4. CONTAIN
            let msg = payload
                .downcast_ref::<&str>().map(|s| s.to_string())
                .or_else(|| payload.downcast_ref::<String>().cloned())
                .unwrap_or_else(|| "non-string panic".into());
            tracing::error!(panic = %msg, "recovered panic in job");
            dead_letter(job);
        }
    }
}
```

Two Rust-specific things you must know now:

1. **`catch_unwind` requires `UnwindSafe`.** The closure's captures must be `UnwindSafe` — a compile-time signal that a panic crossing the boundary won't leave data half-mutated and observable. When you *know* the boundary is safe (e.g. you discard the closure's state on panic), `AssertUnwindSafe` overrides the check. Reaching for `AssertUnwindSafe` without thinking is how you reintroduce the corruption bug.
2. **`catch_unwind` does NOT work if the program is compiled with `panic = "abort"`.** With abort, a panic terminates the process instantly — there is no unwind to catch. Many production Rust binaries set `panic = "abort"` (smaller binaries, no unwind tables). On those, `catch_unwind` is a no-op safety-wise. You'll go deep on this trade-off at the [senior](senior.md) and [professional](professional.md) levels.

> Rust idiom: `catch_unwind` is for **boundaries** (FFI edges, thread/worker isolation, test harnesses), not for control flow. Recoverable failures still use `Result`/`?`. Don't use `catch_unwind` to "handle" a `None`; use `match`/`?`.

---

## Logging and Reporting a Recovered Panic

The recover is worthless if the panic disappears. Three signals, every time:

| Signal | Why | How |
|---|---|---|
| **Log line (`error` level, with stack)** | So you can read what happened during an incident | `slog.Error(..., "stack", debug.Stack())`, `log.error(..., exc_info=True)`, `log.error(msg, throwable)` |
| **Metric (`panics_total` counter)** | So you can *alert* on a rising panic rate before users complain | Prometheus counter, `panicsTotal.Inc()` |
| **Crash reporter capture** | So each unique panic becomes a *ticket* with a stack, deduplicated by fingerprint | `Sentry.captureException`, `report.Capture(...)` — see [Crash Reporting](../crash-reporting/middle.md) |

A subtlety: **capture the stack at the moment of recovery**, not later. By the time control returns from your handler, the stack that panicked has already unwound — `debug.Stack()` called too late shows the recovery site, not the crash site. In Go, call `debug.Stack()` *inside* the deferred recover function. In Java/Python the throwable/traceback object carries the original stack, so you can log it whenever, but still log it immediately.

> Don't log the raw `recover()` value alone — `panic("boom")` recovers as the string `"boom"` with *no* stack unless you grab `debug.Stack()` yourself. A reporter wants both the value and the stack.

---

## Never Swallow a Panic

The anti-pattern, in every language:

```go
defer func() { recover() }()                 // Go: swallows silently
```
```python
try: risky()
except Exception: pass                        # Python: swallows silently
```
```java
try { risky(); } catch (Throwable t) {}       // Java: swallows silently (and catches Error!)
```
```js
try { risky(); } catch (e) {}                 // JS: swallows silently
```

Every one of these recovers and does *nothing*. The bug is now invisible *and* the program keeps running on whatever broken state caused the panic. This is strictly worse than not recovering at all, because:

- Without recovery, the process crashes → you find out immediately → you fix it.
- With silent recovery, the process survives → you never find out → the bug corrupts data quietly for weeks.

The rule has no exceptions at this level: **if you recover, you log and report. If you're not going to log and report, don't recover.**

---

## Code Examples

### A complete, correct Go boundary helper used three ways

```go
package boundary

import (
	"log/slog"
	"runtime/debug"
)

// Guard runs fn, recovering+logging+reporting any panic, and reports whether
// a panic occurred so the caller can CONTAIN appropriately.
func Guard(ctx string, fn func()) (panicked bool) {
	defer func() {
		if rec := recover(); rec != nil {
			panicked = true
			stack := debug.Stack()
			slog.Error("recovered panic", "where", ctx, "panic", rec, "stack", string(stack))
			report.Capture(rec, stack, ctx) // metric + reporter inside Capture
		}
	}()
	fn()
	return false
}
```

```go
// HTTP boundary
func handler(w http.ResponseWriter, r *http.Request) {
	if boundary.Guard("GET /order", func() { serveOrder(w, r) }) {
		w.WriteHeader(http.StatusInternalServerError)
	}
}

// Worker boundary
for job := range jobs {
	job := job
	if boundary.Guard("job:"+job.ID, func() { handle(job) }) {
		job.DeadLetter()
	}
}

// Spawned-goroutine boundary
go func() { boundary.Guard("async:reindex", reindex) }()
```

One helper, three boundaries, all four obligations met (catch, log, report, contain). The business code inside (`serveOrder`, `handle`, `reindex`) stays completely fail-fast — no `recover` anywhere in it.

### Re-panic when the state is unsafe

```go
defer func() {
	if rec := recover(); rec != nil {
		slog.Error("panic while holding the ledger lock", "panic", rec, "stack", string(debug.Stack()))
		report.Capture(rec, debug.Stack(), nil)
		// We panicked mid-mutation while holding a lock. The shared ledger may be
		// half-written. Continuing is unsafe — crash deliberately for a clean restart.
		panic(rec) // re-panic: availability is not worth corrupting the ledger
	}
}()
mutateLedgerUnderLock() // if this panics mid-write, recover-then-re-panic
```

Recovering does not commit you to continuing. When isolation is *not* real — shared state was being mutated, a lock was held — the correct move is to log, report, and re-panic for a clean crash. Better one restart than a corrupted ledger.

---

## Pros & Cons

| Technique | Pros | Cons |
|---|---|---|
| Recover-at-boundary (HTTP/worker) | One bad unit fails alone; server/pool survives; clean 500/NACK | Only safe if units are truly isolated; easy to forget to log/report |
| One recover helper, reused | Consistent log+report+contain everywhere; can't forget a step | Must remember to *use* it on every boundary and every spawned goroutine |
| Per-goroutine/thread recover | Contains async panics that escape the request boundary | Easy to forget; one missed spawn = process-wide blast radius |
| Rust `catch_unwind` | Boundary recovery with compile-time unwind-safety check | No-op under `panic = "abort"`; `AssertUnwindSafe` can mask real corruption |
| Re-panic after recover | Crashes cleanly when isolation is an illusion (held lock, shared mutation) | Loses availability for that unit — correct only when state is unsafe |
| Java `UncaughtExceptionHandler` | Catches thread deaths the request boundary misses | Runs *after* the thread is already dying; can't resume it |

---

## Use Cases

- **Web server, one handler nil-derefs.** Recover in middleware → 500 for that request, server keeps serving. Log + report so the handler gets fixed.
- **Queue worker hits a poison message.** Recover per job → dead-letter that message, keep consuming. Alert if the dead-letter rate spikes.
- **Cron/scheduled task panics.** Recover around the task body → mark this run failed, let the scheduler fire the next run normally.
- **gRPC interceptor.** Same as HTTP middleware — recover in a server interceptor, return `codes.Internal`, keep the server up.
- **Handler spawns a background goroutine.** That goroutine needs its *own* recover — the request boundary can't reach it.
- **Mutating shared state under a lock panics.** Recover, log, report, then **re-panic** — the isolation premise is broken, so crash clean.
- **Rust thread pool / FFI boundary.** `catch_unwind` so a panic doesn't unwind across a thread or an FFI edge (the latter is undefined behavior — see [professional](professional.md)).

---

## Coding Patterns

### Pattern: the four-obligation boundary (catch, log, report, contain)

Never write a recover that does fewer than all four. If you're tempted to skip log+report, don't recover at all.

### Pattern: recover *per job*, not *per worker lifetime*

```go
for job := range jobs {          // loop survives
    func() {
        defer recoverLogReport() // boundary is HERE, around one job
        handle(job)
    }()
}
```

### Pattern: a `SafeGo` wrapper so you can't forget goroutine recovery

```go
func SafeGo(fn func()) { go func() { defer recoverLogReport(); fn() }() }
// Ban raw `go fn()` in code review for anything that can panic. Use SafeGo.
```

### Pattern: convert panic → typed error at the boundary (Go)

```go
func Call(fn func() error) (err error) {
	defer func() {
		if rec := recover(); rec != nil {
			err = fmt.Errorf("panic: %v\n%s", rec, debug.Stack()) // becomes a normal error
		}
	}()
	return fn()
}
```

Useful when the caller's contract is "return an error" — the boundary translates the panic into the error the caller expects, *with* the stack attached.

---

## Clean Code

- **Exactly one recover per boundary**, written in infrastructure code, reused. No `recover()` in business logic.
- **Every recover logs (with stack) and reports.** No silent `recover()`, no `except Exception: pass`, no empty `catch`.
- **Every spawned goroutine/thread is launched through a recovering wrapper** (`SafeGo`, a guarded thread factory). Ban raw `go fn()`/`new Thread(fn)` for panic-prone work in review.
- **Recover catches the request-layer types, not the abort-layer ones** — `Exception` not `BaseException` in Python; don't catch `Error` in Java unless you re-throw.
- **Capture the stack at recovery time**, not later, or you'll log the recovery site instead of the crash site.
- **If isolation is an illusion (shared mutation, held lock), re-panic** rather than continue.

---

## Best Practices

1. **Install the boundary once, at the framework layer.** Wrap the whole mux / the worker loop / the interceptor — don't repeat it per route.
2. **Recover per unit of isolated work** (per request, per job), never per long-lived loop/worker.
3. **Always log+report a recovered panic.** Metric for alerting, reporter for ticketing, log with stack for the incident.
4. **Give every goroutine/thread its own recover.** The request boundary does not reach a goroutine you spawned.
5. **Keep business logic fail-fast.** The boundary is the *only* recover point; inside it, let bugs surface.
6. **Re-panic when the state is unsafe.** Held locks and half-mutations mean a clean crash beats limping on.
7. **In Rust, use `catch_unwind` only at real boundaries**, mind `UnwindSafe`, and remember it's inert under `panic = "abort"`.
8. **Return a generic 500 to the client; keep the detail in logs/reporter.** Never leak a stack trace in an HTTP response.

---

## Edge Cases & Pitfalls

- **`defer recover()` at the top of a worker loop kills the loop on first panic** — the `for range` is already unwound. Recover *inside* the loop body.
- **A panic in a spawned goroutine ignores the parent's recover** and crashes the process. Every goroutine needs its own.
- **Express async handlers bypass error middleware** — a rejected promise becomes an `unhandledRejection`. Wrap async routes.
- **`recover()` called outside a `defer`, or in a different goroutine, returns `nil`** and does nothing. It must be in a deferred function in the panicking goroutine.
- **Capturing the stack too late** logs the recovery site. Grab `debug.Stack()` inside the deferred function.
- **Rust `catch_unwind` under `panic = "abort"`** can't catch anything — the process aborts first. Check your `Cargo.toml` profile.
- **`AssertUnwindSafe` silences a real warning.** If the closure mutates shared state and panics mid-way, you've recovered into corruption.
- **Catching `Throwable`/`BaseException` at the boundary** can swallow `OutOfMemoryError`/`SystemExit`. Catch the request-layer type, and if you must catch broadly, re-throw the abort-layer ones.

---

## Common Mistakes

1. **Silent recover** — recovering with no log and no report. Worse than not recovering; the bug hides behind a living server.
2. **Recover per worker lifetime instead of per job** — the worker silently dies after the first panic.
3. **Forgetting goroutine/thread recovers** — an async panic crashes the whole process despite a perfect request boundary.
4. **Recover sprinkled in business logic** — every bug hidden, the boundary discipline destroyed.
5. **Treating recovery as a fix** — the handler still has the bug; tomorrow's identical request panics again. Recovery buys availability, not correctness.
6. **Continuing after recovering from a panic that held a lock or half-mutated shared state** — now the whole process runs on corruption. Re-panic instead.
7. **Leaking the stack trace to the client** in the 500 response — information disclosure; keep detail server-side.
8. **Using `catch_unwind` for control flow** instead of `Result`/`?` — wrong tool; and it's inert under abort.
9. **Catching `BaseException`/`Throwable`** at the boundary and swallowing exit/OOM signals.

---

## Tricky Points

- **`net/http` already recovers per connection**, but ugly (no clean response, no stack log). Your middleware exists to do it *properly*, not to enable recovery.
- **A recovered panic and a returned error should look identical to the client** — both are a 500. The difference is purely internal (one had a stack trace and a reporter ticket).
- **`recover()` only returns non-nil during an active panic.** Code that calls `recover()` on the happy path always gets `nil` — that's why the `if r := recover(); r != nil` idiom exists.
- **Re-panicking preserves the original panic value** if you `panic(rec)`, but **loses the original stack** — the new panic's stack starts at the re-panic site. Log the original stack *before* re-panicking.
- **Rust's `catch_unwind` returns `Result<T, Box<dyn Any>>`** — the panic payload is type-erased. You `downcast_ref::<&str>()`/`::<String>()` to read the message, and often can't get more than that.
- **Java `@RestControllerAdvice` catching `Throwable`** will also catch `Error` subtypes; that's usually fine for *one request* (return 500), but if the `Error` is `OutOfMemoryError`, the JVM may be doomed regardless — don't pretend a 500 fixed it.
- **Python's `threading.excepthook` vs `sys.excepthook`** — thread exceptions go to the former (3.8+), main-thread to the latter. Wire both if you want all panics reported.

---

## Test Yourself

1. Write a Go HTTP middleware that recovers, logs the stack, increments a counter, and returns 500. Trigger it with a `nil` deref and confirm the server stays up for a second request.
2. Take a worker loop with `defer recover()` at the top. Explain why it dies after the first poison job, then fix it to recover per job.
3. Spawn a goroutine inside an HTTP handler that panics. Show that the middleware does *not* catch it and the process dies. Then fix it with a per-goroutine recover.
4. In Rust, wrap a panicking closure in `catch_unwind`. Then set `panic = "abort"` in `Cargo.toml` and show the catch no longer fires.
5. List the four obligations of a recover boundary. For each, say what breaks if you skip it.
6. Write a recover that *re-panics* when it detects a lock was held. Explain when this is the correct choice over continuing.
7. For Flask and Express, show why catching `Exception` (not `BaseException`) and handling async rejections, respectively, matter for correct boundary behavior.

---

## Tricky Questions

**Q1: When is recovering from a panic actually correct?**

At a **boundary** around an isolated unit of work — an HTTP request, a queue job, a scheduled task — where one unit's failure shouldn't take down the rest. You catch, log (with stack), report, and contain (fail that unit only). Anywhere business logic isn't isolated, recovery is wrong.

**Q2: Why is a silent `recover()` worse than no recover at all?**

Without recovery the process crashes and you find the bug immediately. With a silent recover the process survives on broken state, you never learn the handler is defective, and the bug corrupts data quietly for weeks. Surviving + hidden is worse than crashing + visible.

**Q3: My HTTP middleware recovers panics. Why did a panic still crash my whole server?**

Almost certainly the panic was in a **goroutine your handler spawned**. A recover only catches its own goroutine's panics. The spawned goroutine had no recover, so it unwound to the top and killed the process. Give every spawned goroutine its own recover.

**Q4: Where exactly does the recover go in a worker pool — around the loop or around the job?**

Around the **job**, inside the loop. If you recover around the whole loop, the first panic unwinds past the `for range` and the worker stops consuming forever. Per-job recovery lets the loop survive each poison message.

**Q5: Does `catch_unwind` always catch a Rust panic?**

No. Only when panics **unwind** (the default). Under `panic = "abort"` (common in production for smaller binaries), a panic terminates the process instantly and `catch_unwind` never runs. Also, the closure must be `UnwindSafe` (or wrapped in `AssertUnwindSafe`).

**Q6: I recovered a panic that happened while holding a mutex. Should I continue?**

Usually no. If you panicked mid-mutation while holding a lock, shared state may be half-written and the lock's invariants broken. The safe move is to log, report, and **re-panic** — crash cleanly for a fresh restart rather than serve corrupt data. (In Rust, the lock would be *poisoned* — covered at [senior](senior.md)/[professional](professional.md).)

**Q7: What's the minimum a recover must do?**

Catch, **log with the stack**, **report** (metric + crash reporter), and **contain** (fail only this unit). If you won't do the log+report, don't recover — let it crash so the bug stays visible.

---

## Cheat Sheet

```text
┌──────────────────────── PANIC & RECOVERY — MIDDLE CHEAT SHEET ────────────────────────┐
│                                                                                       │
│  THE ONE GOOD RECOVER: at a BOUNDARY around isolated work                             │
│    HTTP request │ queue job │ cron task │ gRPC call │ spawned goroutine               │
│                                                                                       │
│  FOUR OBLIGATIONS (skip none)                                                         │
│    1 CATCH    recover / catch / catch_unwind                                          │
│    2 LOG      error level, WITH the stack (capture at recover time!)                  │
│    3 REPORT   metric++  +  crash-reporter capture                                     │
│    4 CONTAIN  fail THIS unit: 500 / NACK / mark-failed; pool & server live            │
│                                                                                       │
│  PER LANGUAGE                                                                         │
│    Go      middleware: defer recover() → log+report → 500                             │
│    Java    @RestControllerAdvice(Throwable) → log+report → 500                        │
│    Python  @app.errorhandler(Exception)  (NOT BaseException)                          │
│    Node    error middleware (wrap async routes!)                                      │
│    Rust    catch_unwind(AssertUnwindSafe(...))  (inert under panic=abort)             │
│                                                                                       │
│  WORKER POOL                                                                          │
│    recover PER JOB, inside the loop — NOT per worker lifetime                         │
│                                                                                       │
│  THE BIG TRAP                                                                         │
│    recover catches ONLY its own goroutine/thread.                                     │
│    every  go fn()  / new Thread(fn)  needs its OWN recover.                           │
│                                                                                       │
│  WHEN ISOLATION IS FAKE (held lock, shared mutation): RE-PANIC, don't continue        │
│                                                                                       │
│  NEVER:  recover(){} · except: pass · catch(Throwable){} · catch(e){}                 │
│          → silent swallow = bug hidden behind a living server                         │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Summary

- There is **one routinely-correct place to recover from a panic: the boundary** around an isolated unit of work (request, job, task). Everywhere else, stay fail-fast.
- A boundary recover has **four obligations: catch, log (with stack), report (metric + reporter), contain (fail this unit only)**. Skip any and it's done wrong.
- **A silent recover is worse than none** — the process survives on broken state and the bug hides forever.
- **Recover per job, not per worker lifetime** — a top-of-loop recover kills the loop on the first panic.
- **Recover only catches its own goroutine/thread.** Every spawned goroutine/thread needs its own recover — this is the top production-down mistake.
- **Rust's `catch_unwind`** is the boundary tool: minds `UnwindSafe`, and is **inert under `panic = "abort"`**.
- **Recovery buys availability, not correctness.** The bug is still there; the boundary just stops one bad unit from taking down everything.
- When **isolation is an illusion** (held lock, half-mutated shared state), **re-panic** for a clean restart instead of continuing on corruption.
- Install the boundary **once, in infrastructure**; keep business logic free of `recover`. Return a generic 500 to clients, keep the stack in logs and the reporter.

---

## What You Can Build

- A **reusable boundary helper** (`Guard`/`SafeGo` in Go, an Express error middleware, a Spring `@RestControllerAdvice`, a Flask error handler) that does all four obligations — then wire it into a tiny demo server and prove a `nil`-deref request returns 500 while the next request succeeds.
- A **"poison job" worker-pool demo**: a pool that dead-letters a panicking job and keeps consuming, with a metric counting poison jobs. Then break it (recover at top of loop) to *show* the worker silently dying.
- A **goroutine-leak-vs-crash demo**: an HTTP handler that spawns a panicking goroutine, showing the process dies despite the middleware — then the `SafeGo` fix.
- A **Rust `catch_unwind` toggle**: the same worker compiled with `panic = "unwind"` (catch fires) and `panic = "abort"` (process dies), side by side, to internalize the difference.
- A **lint/review checklist**: "no raw `go fn()`/`new Thread`," "no silent recover," "recover logs+reports," "recover per job." Add a CI grep for `recover()` followed by `}` with nothing between.

---

## Further Reading

- **The Go Blog — "Defer, Panic, and Recover"** — <https://go.dev/blog/defer-panic-and-recover>
- **`net/http` source — connection-level panic recovery** — read how the stdlib already recovers (and why you still want your own). <https://pkg.go.dev/net/http>
- **Rust std — `std::panic::catch_unwind`** — <https://doc.rust-lang.org/std/panic/fn.catch_unwind.html> and `UnwindSafe` — <https://doc.rust-lang.org/std/panic/trait.UnwindSafe.html>
- **Java — `Thread.UncaughtExceptionHandler`** — <https://docs.oracle.com/javase/8/docs/api/java/lang/Thread.UncaughtExceptionHandler.html>
- **Python — `threading.excepthook`** — <https://docs.python.org/3/library/threading.html#threading.excepthook>
- **Express — error handling** — <https://expressjs.com/en/guide/error-handling.html> (and the `express-async-errors` package).
- **Sentry docs — capturing panics/exceptions** — per-language SDKs. See [Crash Reporting — Middle](../crash-reporting/middle.md).

---

## Related Topics

- **Previous level:** [junior.md](junior.md) — the two-layer model, unwinding, `defer`/`recover` basics, when to crash.
- **Senior level:** [senior.md](senior.md) — fail-fast vs resilience, abort vs unwind, crash-only design, supervision, panic propagation across goroutines/threads/async tasks.
- **Professional level:** [professional.md](professional.md) — unwinding internals & cost, `panic = "abort"`, async-signal-safety, FFI/unwind UB, poisoned locks, resilient worker pools.
- **Interview prep:** [interview.md](interview.md)
- **Practice:** [tasks.md](tasks.md)

**Sibling diagnostic topics:**

- [Crash Reporting — Middle](../crash-reporting/middle.md) — the "report" obligation: fingerprinting, deduping, and ticketing recovered panics.
- [Error Handling — Middle](../error-handling/middle.md) — wrapping and propagating Layer-1 errors; the boundary translates panics back into these.
- [Logging — Middle](../logging/middle.md) — structured error-level logging with correlation IDs for the "log" obligation.
- [Debugging — Middle](../debugging/middle.md) — reading the stack a recovered panic captured.

**Cross-roadmap links:**

- [Middleware Pattern](../../code-craft/coding-patterns/README.md) — the request-pipeline shape the recover boundary plugs into.

---

## Diagrams & Visual Aids

### The Boundary Contains the Blast Radius

```text
   WITHOUT a boundary                       WITH a boundary
   ─────────────────                        ───────────────
   req → handler → PANIC                     req → [boundary] → handler → PANIC
                    │                                  │                    │
                    ▼  unwinds to main                 │  recover catches   │
              PROCESS DIES                             ▼                    │
        (all in-flight requests dropped)         500 to THIS client  ◄──────┘
                                                 server keeps serving everyone else
                                                 + log(stack) + metric + reporter
```

### Recover Only Sees Its Own Goroutine

```text
   request goroutine                     spawned goroutine
   ┌───────────────────┐                 ┌───────────────────┐
   │ [middleware recover]                │  (no recover!)     │
   │   handler()        │   go func() →  │  doAsyncWork()     │
   │     spawns ────────┼───────────────►│     PANIC          │
   │   returns 500 ok   │                │       │            │
   └───────────────────┘                 └───────┼───────────┘
        protected                                ▼
                                          unwinds to top → PROCESS DIES
   Fix: give the spawned goroutine its OWN recover (SafeGo).
```

### Recover Per Job vs Per Worker

```text
   PER WORKER (wrong)                    PER JOB (right)
   ┌──────────────────┐                  ┌──────────────────────┐
   │ defer recover()  │                  │ for job := range q {  │
   │ for job := range q│                 │   func(){             │
   │   handle(job) ────┼─ PANIC          │     defer recover()   │
   │ }                 │   │              │     handle(job) ──────┼─ PANIC
   └──────────────────┘   ▼              │   }()                 │   │
   loop unwound, worker DEAD             │ }  ◄── loop continues ◄───┘
                                         └──────────────────────┘
```
