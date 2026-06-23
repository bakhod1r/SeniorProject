---
layout: default
title: Partial Cancellation — Junior
parent: Partial Cancellation
grand_parent: Cancellation Deep
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/20-cancellation-deep/02-partial-cancellation/junior/
---

# Partial Cancellation — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros--cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use](#product-use)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
18. [Common Mistakes](#common-mistakes)
19. [Common Misconceptions](#common-misconceptions)
20. [Tricky Points](#tricky-points)
21. [Test](#test)
22. [Tricky Questions](#tricky-questions)
23. [Cheat Sheet](#cheat-sheet)
24. [Self-Assessment Checklist](#self-assessment-checklist)
25. [Summary](#summary)
26. [What You Can Build](#what-you-can-build)
27. [Further Reading](#further-reading)
28. [Related Topics](#related-topics)
29. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction
> Focus: "I have a request context. The request is over. But I still need to log it. How?"

In Go, the usual pattern is this. The HTTP handler receives `r.Context()`. It passes that context into every database call, every outbound HTTP call, every cache lookup. When the client disconnects, the context is cancelled and every operation below it stops cleanly. That is *full* cancellation, and it works beautifully most of the time.

Then one day you write code that should *not* stop when the request ends. The two textbook examples:

1. **Logging the response after it has been sent.** You want to write the audit log entry. The handler has returned. Its context is now cancelled. If your audit logger uses that same context, the cancellation will tear down the database insert mid-write.
2. **Firing a metric or a span at the end of a request.** The OpenTelemetry exporter, the StatsD client, the slow-query logger — these all want to push data after the parent operation has completed. If they share the cancelled context, the push fails.

Before Go 1.21 you had two awkward workarounds. The first was to use `context.Background()`, which throws away every value the request context carries (trace IDs, user IDs, deadlines, request IDs, anything else attached with `context.WithValue`). The second was to wrap a custom `Context` type that copied values but ignored cancellation. Both are easy to get wrong. The custom wrapper in particular is the kind of code that ten people in a company write ten slightly different ways, and one of those versions has a subtle bug where calling `Value` on it crashes with a nil pointer dereference.

Go 1.21 added `context.WithoutCancel`:

```go
ctx := context.WithoutCancel(parent)
```

The returned context **keeps every value** from the parent (trace ID, user ID, request ID, span context, anything else attached with `context.WithValue`) but **drops the cancellation signal and the deadline**. It is no longer connected to the parent's lifetime. You can use it to run work that must outlive the request, while still keeping the request's identity attached.

This file teaches you:

- What "partial cancellation" means at the simplest level
- The exact API and semantics of `context.WithoutCancel`
- The "detached cleanup" pattern — the single most common reason to use it
- When *not* to use it (because every detached goroutine that you forget to bound is a leak)
- How it interacts with `Done()`, `Err()`, deadlines, and values
- The relationship between detached contexts and graceful shutdown
- Common mistakes new Go programmers make when they first reach for this tool

You do not need to know about `WithCancelCause`, `AfterFunc`, or the internals of `cancelCtx` yet. Those come at the middle, senior, and professional levels. This file is about the moment you realise "this work should not die when the request dies" and you reach for the right tool.

### A short story to motivate the chapter

A small e-commerce company switched to Go in 2024. Their team built a clean HTTP server. Every handler received `r.Context()` and threaded it through. The code was beautiful — until the audit team complained that one in every twenty orders had no corresponding audit row. The pattern was always the same: a customer placed an order, saw the success page, and the order was in the database. But the audit table had no row, so compliance reporting was broken.

The bug was a single line in `placeOrder`:

```go
func placeOrder(ctx context.Context, o Order) error {
    if err := db.InsertOrder(ctx, o); err != nil {
        return err
    }
    go auditOrder(ctx, o) // <- bug
    return nil
}
```

The audit goroutine used the request context. When the response went out and the client closed the connection, `ctx` was cancelled. The audit goroutine's database call saw a cancelled context and bailed out. One in twenty requests was fast enough that the cancellation beat the audit insert.

The fix was three characters: `WithoutCancel`. The audit goroutine was detached. The bug disappeared.

This file is the story behind those three characters.

---

## Prerequisites

- **Required:** Comfort with `context.Context` basics — knowing how `WithCancel`, `WithTimeout`, and `WithValue` are used in handler code.
- **Required:** Go 1.21 or newer. `context.WithoutCancel` does not exist on older versions. Check with `go version`.
- **Required:** Familiarity with goroutines and `defer`. You should be able to read `go func() { defer cleanup(); ... }()` without confusion.
- **Helpful:** Some experience writing HTTP handlers in Go. Most examples in this file are framed as handler code.
- **Helpful:** Awareness that an HTTP request's `r.Context()` is cancelled when the client disconnects or when the response has been fully written.
- **Helpful:** Knowledge of what `defer` does and how `defer cancel()` is the idiomatic pairing for `WithTimeout`.

If you have ever written `ctx, cancel := context.WithTimeout(parent, 5*time.Second)` in a handler and used the result, you are ready.

If you have *not* used `context.Context` before, read the package documentation first. The whole point of this chapter is what you do *after* you have learned context — partial cancellation is an extension, not a replacement.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Partial cancellation** | The pattern of cancelling some descendants of a context while letting others continue. The opposite of "all-or-nothing" tree cancellation. |
| **`context.WithoutCancel`** | Added in Go 1.21. Returns a derived context that inherits all values from its parent but is *not* cancelled when the parent is. Has no deadline. Its `Done()` channel is `nil`. |
| **Detached subtask** | A goroutine started inside a request handler that intentionally outlives the request. Logging, metrics, span export, cache warm-up. |
| **Scoped context** | A context whose lifetime is bounded to a specific subtask, often via `WithCancel` or `WithTimeout`, independent of the request context. |
| **Cancellation signal** | The fact that `ctx.Done()` is closed and `ctx.Err()` returns a non-nil error. This is what `WithoutCancel` discards. |
| **Context value** | An immutable key-value pair attached with `context.WithValue`. `WithoutCancel` preserves all values. |
| **Background context** | `context.Background()` — the empty root context. Has no values, no deadline, never cancelled. The wrong tool when you want to keep values. |
| **`context.TODO()`** | A placeholder that behaves like `Background()` but signals "I have not decided what context to use here." Not useful for partial cancellation. |
| **Cleanup that must outlive the request** | Work that, by design, must not be aborted by the client disconnecting. Audit logs, payment receipts, metric emission. |
| **`ctx.Done()`** | A channel that is closed when the context is cancelled. For a `WithoutCancel` context, this returns `nil` — and receiving from a `nil` channel blocks forever, which is exactly the desired behaviour. |
| **`ctx.Err()`** | Returns a non-nil error once the context is cancelled. For a `WithoutCancel` context, returns `nil` always (until you cancel a downstream wrapper). |
| **`ctx.Deadline()`** | Returns the absolute time the context will be cancelled. For a `WithoutCancel` context, returns `(time.Time{}, false)` — no deadline. |
| **Graceful shutdown** | The pattern of waiting for in-flight work to complete before exiting the process. Detached work must be tracked or it is lost at shutdown. |
| **Goroutine leak** | A goroutine that runs forever, holding memory and resources. Detaching context without bounding the work is the easiest way to create one. |
| **Fan-out** | Spawning multiple goroutines from one parent. Each may or may not need partial cancellation. |
| **Trace ID** | A unique identifier for a distributed-tracing trace. Usually attached as a context value. Preserved across `WithoutCancel`. |
| **Request ID** | A unique identifier for one server request. Usually attached as a context value. Preserved across `WithoutCancel`. |
| **`WithCancelCause`** | Go 1.20+ variant of `WithCancel` that lets you attach an error explaining the cancellation. Interacts with `WithoutCancel`. |
| **`AfterFunc`** | Go 1.21+ helper that runs a function in its own goroutine when a context is cancelled. Pairs with `WithoutCancel` for shutdown hooks. |

---

## Core Concepts

### A context tree, normally

When a request arrives at an HTTP server, the runtime creates a root context for it. As your handler dispatches work — to a database, to an outbound HTTP service, to a cache — each function call typically derives a *child* context:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    user, err := loadUser(ctx, userID)       // child of ctx
    items, err := loadCart(ctx, userID)      // child of ctx
    order, err := placeOrder(ctx, user, items) // child of ctx
    writeResponse(w, order)
}
```

`loadUser`, `loadCart`, and `placeOrder` may each create further children. Together they form a tree. When `r.Context()` is cancelled — because the client disconnected or because the response has been fully written and the server tears the connection down — every node in that tree is cancelled. Goroutines blocked in `ctx.Done()` wake up; pending I/O is aborted; cleanup runs.

This is the right default. Most of the time, when the request is gone, the work for it is wasted. The customer is not going to see your response, so loading their cart is wasted effort. The customer's database transaction will not commit, so reading the next row is wasted effort. Cancellation prevents wasted work.

### What "partial" means

Sometimes you want a *branch* of the tree that keeps running even after the trunk is gone. Picture the same handler with an audit log:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    order, err := placeOrder(ctx, ...)
    writeResponse(w, order)
    // After this point, ctx is about to be cancelled.
    auditLog(ctx, order) // BUG: this may be cut off mid-write
}
```

The bug is subtle. If the server writes the response and the connection closes, `ctx` is cancelled. The `auditLog` call started reading from `ctx.Done()` and was about to be aborted just as it dialled the database. The audit row is lost.

The fix:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    order, err := placeOrder(ctx, ...)
    writeResponse(w, order)
    detached := context.WithoutCancel(ctx)
    go auditLog(detached, order)
}
```

The `auditLog` goroutine now runs with a context that has every value from the request (`user_id`, `trace_id`) but is not cancelled when the request finishes. It will run to completion, write the audit row, and return.

That is partial cancellation in one sentence. The handler's context tree gets cancelled. The audit branch — which is no longer a child of the handler's context, just a sibling that borrows the parent's values — keeps going.

### What `WithoutCancel` does, mechanically

`context.WithoutCancel(parent)` returns a `Context` such that:

- `ctx.Value(key)` returns whatever `parent.Value(key)` would have returned. Lookups walk the parent chain on every call.
- `ctx.Done()` returns `nil`. A receive on a `nil` channel blocks forever, so any code that does `<-ctx.Done()` will simply wait forever (which is what you want — you do not want this context to fire cancellation).
- `ctx.Err()` returns `nil`. Always.
- `ctx.Deadline()` returns `(time.Time{}, false)`. There is no deadline.

It does *not* prevent you from layering further cancellation on top:

```go
detached := context.WithoutCancel(ctx)
withTimeout, cancel := context.WithTimeout(detached, 30*time.Second)
defer cancel()
auditLog(withTimeout, order)
```

This is the proper pattern for "I want to outlive the request, *but* I do not want this audit write to hang forever if the database is down." The detached context establishes "I am no longer tied to the request." The `WithTimeout` then re-establishes a bounded lifetime that belongs to the audit task itself.

### Why this is not just `context.Background()` plus values

A natural first reaction is: why not pass `context.Background()` into the audit function, and then re-attach the values I care about?

```go
auditCtx := context.WithValue(context.Background(), traceKey, traceID)
go auditLog(auditCtx, order)
```

This works, but it falls apart in real codebases:

1. You have to know every key the downstream code will need. Trace ID, user ID, request ID, tenant ID, deadline policy, billing tier, A/B-test bucket. Forget one and the audit row is missing data.
2. Library code that you do not own may look up keys you do not know about. The OpenTelemetry SDK, the OpenCensus span, the logging middleware. Their keys are unexported types you cannot enumerate.
3. The number of keys grows over time. Every refactor risks forgetting one.

`WithoutCancel` solves all three. It transparently preserves the entire value chain — known keys, unknown keys, library keys — without you having to enumerate them. It says "give me everything except the lifetime."

### Detached does not mean unbounded

The single biggest mistake with `WithoutCancel` is to detach work and then forget to bound it. The point of cancellation is to prevent forever-running goroutines. A detached goroutine that never finishes is a leak. *Always* combine `WithoutCancel` with one of:

- `context.WithTimeout(detached, ...)`
- `context.WithDeadline(detached, ...)`
- A clear and bounded operation that always returns (a single insert, a single HTTP POST with timeout)
- A supervisor that tracks all detached goroutines and waits for them at shutdown

If you cannot point to the line of code that ensures the goroutine returns, you have a leak.

### The "outlive the request, but die at shutdown" pattern

A common variant: detached cleanup must survive request cancellation but must not survive *process* shutdown. The handler does not own the process lifetime, so it cannot embed it in the context tree directly. The pattern is to combine a process-wide context (kept in the server struct) with `WithoutCancel`:

```go
type Server struct {
    processCtx context.Context // cancelled at shutdown
    audit      AuditClient
}

func (s *Server) handler(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    // ... do request work ...

    // Detach from the request, but stay bound to the process.
    audit := mergeValuesIntoLifetime(ctx, s.processCtx)
    go s.audit.Write(audit, ...)
}
```

`mergeValuesIntoLifetime` is not a stdlib function — it is conceptual. Real implementations of it use `WithoutCancel` plus a manual goroutine that watches both `processCtx.Done()` and the operation. We will see real code for it at the middle level. At junior level, just remember: process-bounded cleanup needs more than `WithoutCancel`.

### Reading the standard library prose

The official documentation for `context.WithoutCancel` says:

> WithoutCancel returns a copy of parent that is not canceled when parent is canceled. The returned context returns no Deadline or Err, and its Done channel is nil. Calling Cause on the returned context returns nil.

Every clause in that sentence is meaningful and worth memorising:

- "copy of parent" — values are preserved.
- "not canceled when parent is canceled" — the cancellation signal is dropped.
- "no Deadline or Err" — those two methods always return zero values.
- "Done channel is nil" — receives on it block forever.
- "Calling Cause on the returned context returns nil" — even if the parent had a cause, the detached context does not propagate it. This is sometimes surprising.

### The lifecycle of a detached goroutine

Picture the timeline:

```
t=0    request arrives, handler begins
t=10ms handler does the main work
t=20ms response written, handler returns
t=21ms HTTP server cancels r.Context()
t=22ms downstream goroutines holding r.Context() begin to unwind
t=30ms detached audit goroutine finishes the database insert and returns
t=31ms detached metric goroutine finishes its emit and returns
```

The detached goroutines do not even notice that step at `t=21ms`. They are working with their own context, which has no `Done()` channel to close. They just run to completion as they would normally.

This is the desired behaviour. The cleanup is *deliberately* decoupled from the request lifecycle. It is part of the system's correctness, not the user's view of the system.

---

## Real-World Analogies

**The takeaway box at a restaurant.** You finish your meal and leave. The server still has to clear the table, wash the dishes, and update the inventory. Your departure does not cancel their cleanup. `WithoutCancel` is the kitchen's relationship to your visit: they know what you ordered (the values) but they do not stop working when you walk out the door.

**A package delivery and the receipt.** The driver hands you the box and drives away. The receipt — the record that the delivery happened — must still be filed even after the truck has left. The truck cannot wait for the warehouse to acknowledge the filing.

**The wedding photographer.** The ceremony ends. Guests leave. The photographer keeps editing the photos for two weeks. The wedding's "cancellation" (everyone going home) does not cancel the photo edit.

**An office and the cleaning crew.** Office hours end at 6 PM. The cleaning crew comes in at 7 PM and cleans the same floors people were working on. They use the same building (the same context values — the location, the access codes) but they do not stop because employees stopped working.

**The accountant's books.** A sale happens, the customer leaves, but the accountant still records the sale in the ledger. The customer's departure does not cancel the recording.

**A doctor's visit and the medical record.** The patient leaves the appointment, but the doctor still has to dictate notes, update the chart, and possibly call in a prescription. The patient's exit does not cancel the recordkeeping.

**A taxi and the fare receipt.** The passenger pays and gets out. The driver still has to log the trip in the company app. The passenger's exit does not cancel the logging.

**A flight and the maintenance crew.** The plane lands, passengers disembark, but the maintenance crew still inspects the aircraft, refuels it, and prepares it for the next flight. The passengers' departure does not cancel the inspection.

---

## Mental Models

### Model 1: The two-axis context

Think of a context as carrying two independent things:
- **Identity** — values like trace ID, user ID, deadline policy.
- **Liveness** — am I still wanted? (`Done()` and `Err()`.)

Normal derivation (`WithCancel`, `WithTimeout`, `WithValue`) couples them: a child inherits both. `WithoutCancel` *decouples* them: identity passes through, liveness does not.

This is the same pattern as `WithValue` decoupling values from liveness — but in reverse. `WithValue` adds identity without changing liveness; `WithoutCancel` drops liveness without changing identity.

### Model 2: The tree with a fence

The context tree is a tree. `WithoutCancel` plants a fence between a node and its descendants. Cancellation signals coming down the tree hit the fence and stop. Values pass through the fence freely.

```
parent (will be cancelled)
  |
  +-- regular child (cancelled too)
  |
  +-- [fence: WithoutCancel]
       |
       +-- detached child (NOT cancelled)
```

When `parent` is cancelled, the regular child is cancelled. The fence blocks the signal, so the detached child continues.

### Model 3: The U-bend

Picture the request context as water flowing down. Every child receives the flow. A `WithoutCancel` context is a U-bend in the plumbing: water (cancellation) cannot flow past it from upstream, but small particles (values) still drift through.

### Model 4: The fork in the road

The request is a road. At a certain point you fork off — `WithoutCancel` is the fork. The main road continues and ends in a cliff (cancellation). The side road that you took at the fork continues over a different terrain, unaffected by what happens to the main road.

### Model 5: The umbilical cord cut

The detached context is a child that has cut the umbilical cord with the parent. It carries the parent's blood type (values), but the parent's heart can stop and the child lives on.

---

## Pros & Cons

**Pros:**
- Trivial API. One function call.
- Preserves request identity (trace ID, user ID) without manual copying.
- No risk of accidentally re-introducing cancellation — the contract is explicit.
- Officially blessed by the standard library since Go 1.21; no need for hand-rolled wrappers.
- Plays well with `WithCancel`, `WithTimeout`, `WithValue` layered on top.
- Inspectable behaviour: `Done()` returns `nil`, which is easy to assert in tests.

**Cons:**
- Easy to leak goroutines if you forget to bound the detached work.
- Hides the fact that you have "left" the request lifetime, which can be confusing in stack traces and tracing systems.
- Does not solve the "outlive request, die at shutdown" problem on its own.
- Pre-1.21 codebases that need backporting must roll their own equivalent.
- `Cause` of the parent does not propagate. If you rely on `context.Cause`, the detached context loses that information.

---

## Use Cases

### Audit logging
Write the record after the response, with full trace context attached. The classic motivation.

### Metric emission
Push a histogram observation or counter increment after the request finishes.

### Cache repopulation
A request fetched stale data; kick off a background refresh that should not be cancelled when the request ends.

### Span export
OpenTelemetry exporters often need to flush spans after the request handler returns; the export call needs the parent's trace ID but not its lifetime.

### Fire-and-forget notifications
A webhook delivery that the user should not wait for, but that must reliably attempt to deliver.

### Email confirmation
The user signed up; the email confirmation goes out asynchronously and must not be cancelled by the signup request ending.

### Search index update
A write to the primary database succeeded; updating the search index is a separate operation that can outlive the request.

### Slow-query log emission
Detect a slow query during the request; emit the log entry after the response has been sent.

### Distributed tracing flush
Some tracing libraries buffer spans and flush them at request end. The flush itself must not be cancelled.

### Side-effect retries
A side-effect failed during the request; retry it in the background, detached, with its own deadline.

---

## Code Examples

### Example 1: The basic detached audit log

```go
package main

import (
	"context"
	"fmt"
	"net/http"
	"time"
)

type ctxKey string

const userKey ctxKey = "user"

func handler(w http.ResponseWriter, r *http.Request) {
	ctx := context.WithValue(r.Context(), userKey, "alice")
	fmt.Fprintln(w, "ok")
	detached := context.WithoutCancel(ctx)
	go audit(detached)
}

func audit(ctx context.Context) {
	user, _ := ctx.Value(userKey).(string)
	// Pretend to write to a database.
	time.Sleep(100 * time.Millisecond)
	fmt.Println("audit:", user)
}

func main() {
	http.HandleFunc("/", handler)
	_ = http.ListenAndServe(":8080", nil)
}
```

The audit goroutine reads `userKey` from the detached context. Even if the client disconnects immediately after receiving "ok", the audit still runs and logs `alice`.

### Example 2: Detached *and* bounded

```go
package main

import (
	"context"
	"fmt"
	"time"
)

type Event struct{ ID string }

func audit(parent context.Context, event Event) {
	ctx := context.WithoutCancel(parent)
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := insert(ctx, event); err != nil {
		fmt.Println("audit failed:", err)
	}
}

func insert(ctx context.Context, ev Event) error {
	// Simulated insert respecting ctx.
	select {
	case <-time.After(50 * time.Millisecond):
		fmt.Println("inserted", ev.ID)
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func main() {
	parent, cancel := context.WithCancel(context.Background())
	cancel() // parent already cancelled — would have killed the insert
	audit(parent, Event{ID: "e1"})
}
```

The detach severs the request link; the timeout adds a fresh 5-second budget owned by `audit`. Without the timeout, a hung database could keep this goroutine alive forever.

### Example 3: A wrong way and the fix

```go
// WRONG
func handlerWrong(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	go audit(ctx, Event{}) // audit() sees ctx cancelled mid-write
}

// RIGHT
func handlerRight(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	detached := context.WithoutCancel(ctx)
	go audit(detached, Event{})
}
```

### Example 4: Preserving an arbitrary value

```go
package main

import (
	"context"
	"fmt"
)

type traceKey struct{}

func handler() {
	ctx := context.WithValue(context.Background(), traceKey{}, "trace-1234")
	ctx, cancel := context.WithCancel(ctx)
	cancel() // simulate request end

	detached := context.WithoutCancel(ctx)
	go func() {
		tid, _ := detached.Value(traceKey{}).(string)
		fmt.Println("background trace:", tid)
	}()
}

func main() {
	handler()
	select {}
}
```

The detached context still carries `trace-1234` even though the parent has been cancelled.

### Example 5: Verifying Done() returns nil

```go
package main

import (
	"context"
	"fmt"
)

func main() {
	parent, cancel := context.WithCancel(context.Background())
	detached := context.WithoutCancel(parent)
	cancel()
	fmt.Println("parent.Err():", parent.Err())     // context canceled
	fmt.Println("detached.Err():", detached.Err()) // <nil>
	if detached.Done() == nil {
		fmt.Println("detached.Done() is nil — receive would block forever")
	}
}
```

This makes the asymmetry explicit. After `cancel()`, the parent is dead; the detached is fine.

### Example 6: Layering a deadline on a detached context

```go
package main

import (
	"context"
	"fmt"
	"time"
)

func main() {
	parent, cancel := context.WithCancel(context.Background())
	defer cancel()

	detached := context.WithoutCancel(parent)
	limited, cancel2 := context.WithTimeout(detached, 50*time.Millisecond)
	defer cancel2()

	cancel() // cancel parent
	fmt.Println("limited.Err() right away:", limited.Err()) // <nil>

	time.Sleep(75 * time.Millisecond)
	fmt.Println("limited.Err() after timeout:", limited.Err()) // context deadline exceeded
}
```

Parent cancellation does not affect `limited`. The 50 ms timer does.

### Example 7: A handler with audit and metric

```go
package main

import (
	"context"
	"fmt"
	"net/http"
	"time"
)

type Audit struct{}
type Metric struct{}

func (Audit) Write(ctx context.Context)  { time.Sleep(20 * time.Millisecond); fmt.Println("audit done") }
func (Metric) Emit(ctx context.Context) { time.Sleep(10 * time.Millisecond); fmt.Println("metric done") }

var audit Audit
var metric Metric

func handler(w http.ResponseWriter, r *http.Request) {
	fmt.Fprintln(w, "ok")
	detached := context.WithoutCancel(r.Context())
	go audit.Write(detached)
	go metric.Emit(detached)
}
```

Two detached side-effects sharing the same detached context. Each is independent.

### Example 8: A handler that joins a WaitGroup before exit

```go
package main

import (
	"context"
	"net/http"
	"sync"
)

type Server struct {
	wg sync.WaitGroup
}

func (s *Server) detached(parent context.Context, fn func(context.Context)) {
	s.wg.Add(1)
	d := context.WithoutCancel(parent)
	go func() {
		defer s.wg.Done()
		fn(d)
	}()
}

func (s *Server) handler(w http.ResponseWriter, r *http.Request) {
	s.detached(r.Context(), func(ctx context.Context) {
		// background work using values from the request
	})
}

func (s *Server) Shutdown() { s.wg.Wait() }
```

This is the seed of the supervised pattern; we will revisit it at the middle level.

### Example 9: Detached cleanup that respects shutdown

```go
package main

import (
	"context"
	"fmt"
	"net/http"
	"sync"
	"time"
)

type Server struct {
	processCtx context.Context
	wg         sync.WaitGroup
}

func (s *Server) handler(w http.ResponseWriter, r *http.Request) {
	fmt.Fprintln(w, "ok")
	s.wg.Add(1)
	d := context.WithoutCancel(r.Context())
	go func() {
		defer s.wg.Done()
		select {
		case <-time.After(50 * time.Millisecond):
			fmt.Println("audit:", d.Value("user"))
		case <-s.processCtx.Done():
			fmt.Println("shutting down — audit aborted")
		}
	}()
}
```

A detached goroutine listens on `processCtx.Done()` for shutdown. It outlives the request but dies on process shutdown.

### Example 10: The wrong way with Background()

```go
// SUBTLY WRONG
func handlerLossy(w http.ResponseWriter, r *http.Request) {
	fmt.Fprintln(w, "ok")
	go audit(context.Background()) // <-- trace ID and user ID are gone
}
```

Compare with:

```go
// RIGHT
func handlerKeepsValues(w http.ResponseWriter, r *http.Request) {
	fmt.Fprintln(w, "ok")
	go audit(context.WithoutCancel(r.Context())) // <-- values preserved
}
```

The difference is invisible until your tracing system shows audit rows without trace IDs.

---

## Coding Patterns

### Pattern: Detach-then-bound

Whenever you detach, immediately bound:

```go
detached := context.WithoutCancel(parent)
ctx, cancel := context.WithTimeout(detached, deadline)
defer cancel()
```

Two lines. Internalise them as one idiom.

### Pattern: Helper function

If your codebase does this in many handlers, factor it:

```go
func DetachedWithTimeout(parent context.Context, d time.Duration) (context.Context, context.CancelFunc) {
    return context.WithTimeout(context.WithoutCancel(parent), d)
}
```

Then every detached call site becomes one line:

```go
ctx, cancel := DetachedWithTimeout(r.Context(), 30*time.Second)
defer cancel()
go audit(ctx, event)
```

### Pattern: Detached goroutine with WaitGroup

If the process needs to wait for detached work before exiting, register the goroutine with a wait group:

```go
type Server struct {
    wg sync.WaitGroup
}

func (s *Server) detachedDo(parent context.Context, fn func(context.Context)) {
    s.wg.Add(1)
    detached := context.WithoutCancel(parent)
    go func() {
        defer s.wg.Done()
        fn(detached)
    }()
}

func (s *Server) Shutdown() {
    s.wg.Wait()
}
```

`Shutdown` blocks until every detached goroutine has finished. This avoids losing in-flight audit logs at process exit.

### Pattern: Detached fan-out

A handler dispatches three side-effects, none of which should block the response:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    writeResponse(w)
    detached := context.WithoutCancel(r.Context())
    go audit(detached)
    go emitMetric(detached)
    go warmCache(detached)
}
```

Each goroutine gets its own copy of the detached context (it is safe to share — contexts are immutable). Bound each one internally.

### Pattern: Detached supervisor

A single goroutine collects work from a channel and processes it with detached contexts:

```go
type Supervisor struct {
    in chan func(context.Context)
}

func (s *Supervisor) Run(processCtx context.Context) {
    for {
        select {
        case job := <-s.in:
            d := context.WithoutCancel(processCtx)
            ctx, cancel := context.WithTimeout(d, 5*time.Second)
            job(ctx)
            cancel()
        case <-processCtx.Done():
            return
        }
    }
}
```

The supervisor owns the lifetime of all detached work and shuts down cleanly when the process context is cancelled.

### Pattern: Detached retry loop

Some cleanup must succeed eventually. A retry loop with detached context:

```go
func retryAudit(parent context.Context, ev Event) {
    d := context.WithoutCancel(parent)
    for i := 0; i < 5; i++ {
        ctx, cancel := context.WithTimeout(d, 2*time.Second)
        err := writeAudit(ctx, ev)
        cancel()
        if err == nil {
            return
        }
        time.Sleep(time.Duration(i+1) * time.Second)
    }
}
```

Each attempt has its own timeout; all attempts share the detached parent.

### Pattern: Detached single-flight

If multiple requests in flight may each want to trigger the same cleanup (say, a cache refresh), gate the cleanup behind a `singleflight.Group` keyed on the resource. Only one detached goroutine runs.

---

## Clean Code

- Name detached contexts with a clearly different identifier. `detached`, `bgCtx`, `outliveCtx`. Never reuse `ctx` for both the request-bound and the detached context in the same scope.
- Wrap the pattern in a helper. Repeating `context.WithoutCancel(parent)` ten times across a file makes the code noisy.
- Document at the function level that a function expects a detached context, when relevant: "audit takes a context that outlives the request."
- Resist the urge to use `context.Background()` as a shortcut. It throws away identity (trace IDs, user IDs) that you almost always want.
- Group detached work close to where it is launched. The reader should be able to see the detach and the goroutine side by side.

A clean handler reads like this:

```go
func (s *Server) handler(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    order, err := s.placeOrder(ctx, /* ... */)
    if err != nil {
        http.Error(w, err.Error(), 500)
        return
    }
    s.writeResponse(w, order)

    // Detached side-effects: trace propagated, lifetime independent.
    detached := context.WithoutCancel(ctx)
    s.scheduleAudit(detached, order)
    s.scheduleMetric(detached, order)
}
```

The `detached := context.WithoutCancel(ctx)` line is a clear signal to the reader that the next two operations are intentionally not bound to the request.

---

## Product Use

A product feature where partial cancellation matters: **read receipts in a chat app**. When a user closes the conversation view, the request that loaded messages ends. But the side-effect — marking the messages as read — must still run. Cancelling the read-receipt write when the user closes the view would leave messages perpetually unread. Detach the read-receipt write from the request; it is owned by the message delivery system, not by the user's request.

Another example: **payment success notification**. The user pays, the response is sent, the email confirmation goes out asynchronously. The email send must outlive the request — but it must not outlive process shutdown without being flushed first.

A third: **fraud-detection logging**. A high-risk transaction triggers a detailed fraud report. The report generation involves multiple downstream calls and can take 10 seconds. The user does not wait for it; the response is returned immediately. The fraud report runs in a detached goroutine.

A fourth: **subscription event publishing**. A user upgrades their plan. The response is sent. A detached goroutine publishes an event to Kafka announcing the upgrade. Downstream services (billing, analytics, notifications) subscribe.

---

## Error Handling

Errors in detached goroutines have no caller to return to. Three options:

1. **Log and continue.** The detached work is best-effort; log at warn level and move on.
2. **Send to a supervisor.** A central errors channel collected by the supervisor goroutine.
3. **Persist for retry.** Write the failed event to a durable retry queue; a background worker drains it.

Never `panic` from a detached goroutine without a `recover`. A panic in a goroutine takes down the whole program, and detached goroutines run after the request — losing the entire server because of a malformed audit row is a poor trade.

```go
func audit(ctx context.Context, ev Event) {
    defer func() {
        if r := recover(); r != nil {
            log.Printf("audit panicked: %v", r)
        }
    }()
    // ... write the audit row ...
}
```

Wrap every detached goroutine in `defer recover`. It is one of those rules you only learn after losing a production server to a JSON marshalling panic in an audit log.

A more structured approach: pass detached work through a single entry point that adds recovery, logging, and bounded retries:

```go
func (s *Server) launchDetached(parent context.Context, name string, fn func(context.Context) error) {
    detached := context.WithoutCancel(parent)
    s.wg.Add(1)
    go func() {
        defer s.wg.Done()
        defer func() {
            if r := recover(); r != nil {
                log.Printf("%s panicked: %v", name, r)
            }
        }()
        if err := fn(detached); err != nil {
            log.Printf("%s failed: %v", name, err)
        }
    }()
}
```

Every handler that wants detached work calls `s.launchDetached(ctx, "audit", auditFn)` and gets recovery, logging, and lifetime tracking for free.

---

## Security Considerations

- Detached contexts retain values. If the parent had sensitive values (a user impersonation token, an admin flag), they propagate. Be deliberate about which values cross the detach boundary.
- A detached context that never finishes is a resource leak. An attacker who can trigger many request endpoints each spawning unbounded detached work has a DoS vector. Always bound detached work.
- Audit and security logs should be especially robust. Wrap them in retries and a timeout, and consider writing to a local buffer that a separate flusher processes — losing audit rows because the database is briefly slow is worse than serving a request slowly.
- Be careful about which credentials live in context values that propagate across the detach boundary. A short-lived per-request token might be reused by a detached goroutine after the token has expired.

A specific anti-pattern to avoid:

```go
ctx := context.WithValue(r.Context(), tokenKey{}, perRequestToken)
detached := context.WithoutCancel(ctx)
go someTask(detached) // <-- still has perRequestToken even though request is over
```

If `perRequestToken` had a short TTL keyed to the request, the detached goroutine may try to use it after expiration. Either issue a fresh token for the detached work, or rotate the value in the detached context.

---

## Performance Tips

- `context.WithoutCancel` allocates one tiny struct. The cost is negligible compared to spawning a goroutine.
- Do *not* create a detached context inside a hot path expecting reuse. Each call returns a new wrapper. The cost is small but not zero.
- The bigger cost is spawning a goroutine per detached task. For very high-frequency events, batch them in a channel-backed worker rather than `go func()` per event.
- Avoid deep value chains on the detached context. Every `ctx.Value(key)` walks the chain from the deepest wrapper up. A detached context that wraps a request context with twelve `WithValue` layers will be slower to look up values than a flat one.

For a service with very high traffic, the per-request detached pattern can be replaced with a queue-and-worker pattern:

```go
type AuditQueue struct {
    in chan Event
    wg sync.WaitGroup
}

func (q *AuditQueue) Run(processCtx context.Context) {
    for ev := range q.in {
        ctx, cancel := context.WithTimeout(processCtx, 2*time.Second)
        _ = writeAudit(ctx, ev)
        cancel()
    }
}

func (q *AuditQueue) Enqueue(ev Event) { q.in <- ev }
```

The handler enqueues without spawning a goroutine. A fixed number of consumer goroutines drain the queue. This is faster at scale but loses the per-event isolation that the spawning pattern provides.

---

## Best Practices

- Always pair `WithoutCancel` with a timeout or a deadline downstream.
- Use a `sync.WaitGroup` (or an errgroup at a higher level) to track detached goroutines that must be drained on shutdown.
- Never pass `context.Background()` to deeply nested code when you have a request context — you lose the trace ID. Use `WithoutCancel`.
- Document that a function operates on a detached context whenever the caller could be surprised.
- Wrap detached goroutines in `defer recover` to prevent a single error from taking down the server.
- Test that your detached cleanup actually runs after request cancellation — easy to get wrong, easy to verify.
- Prefer one helper function in your codebase that centralises the detach-and-bound-and-recover pattern.

A bad-best-practice anti-pattern: do not pass `r.Context()` directly into a `go` statement. Always introduce a named intermediate variable so the reader sees the detach:

```go
// Hard to see what is happening:
go audit(context.WithoutCancel(r.Context()), event)

// Clearer:
ctx := context.WithoutCancel(r.Context())
go audit(ctx, event)
```

---

## Edge Cases & Pitfalls

- **`ctx.Done()` returns nil.** Code that does `select { case <-ctx.Done(): ... }` blocks forever on the detached context. That is the point, but it is a surprise the first time.
- **`ctx.Deadline()` returns no deadline.** Even if the parent had a deadline, the detached context does not.
- **`ctx.Err()` is always nil** unless you layer another cancellation context on top. If your code expects `Err()` to fire eventually, you must add one.
- **Calling `WithoutCancel` on an already-cancelled context still works.** You get a working detached context with the parent's values, even though the parent is dead. This is intentional.
- **Detached children are NOT detached.** `WithoutCancel` only detaches the immediate context. If you then call `WithCancel(detached)` and cancel that, the descendants of *that* node are cancelled.
- **`context.Cause` does not propagate across the detach boundary.** If the parent was cancelled with `WithCancelCause(ctx, myErr)`, calling `context.Cause(detached)` returns `nil`, not `myErr`.
- **A library function deep in the stack may observe a `nil` `Done()` and act surprised.** Older libraries may assume `Done()` is non-nil. Most newer code handles this fine.
- **Tests that check `ctx.Err()` will find `nil`.** Be deliberate about your test assertions.
- **`select { case <-ctx.Done(): default: }` on a detached context always takes the default branch.** This can be useful for "skip work if cancelled" idioms, but on a detached context it means the cancellation-aware branch is dead code.

---

## Common Mistakes

- Forgetting the timeout. `go audit(context.WithoutCancel(ctx))` with `audit` doing a database insert with no timeout is a leak waiting to happen.
- Using `context.Background()` for detached work. Loses the trace ID; you regret it the first time you debug production.
- Cancelling `r.Context()` manually expecting it to also cancel detached work. It will not.
- Storing the detached context in a long-lived struct field. The values stored in it are tied to *that one request*. Using them on the next request is a bug.
- Detaching the wrong context — for example, detaching a `WithTimeout` child instead of the request context. The detached context still inherits values, so the result is functionally correct, but if the detached child's parent has additional values (like the per-database deadline), they too are inherited, which may be surprising.
- Using a detached context inside a chained call expecting cancellation to flow through. It does not.
- Calling `cancel()` on the result of `WithoutCancel` (you cannot — there is no cancel function).
- Detaching twice (e.g., `WithoutCancel(WithoutCancel(parent))`). Legal but pointless. The result is one level deeper but semantically identical to a single detach.

---

## Common Misconceptions

- **"`WithoutCancel` is a way to avoid context altogether."** No — it preserves values, only the cancellation is dropped.
- **"It is a memory leak."** Not by itself. It is a tiny wrapper struct. The leak comes from goroutines that use it forever.
- **"It exists because the team forgot how `context.Background()` works."** They did not. `WithoutCancel` solves a different problem: preserving values while dropping cancellation. `Background()` drops both.
- **"It cancels its parent."** No. The parent is unaffected by the detached child.
- **"It blocks indefinitely if you call `Done()`."** It returns `nil`. Calling receive on `nil` is what blocks indefinitely.
- **"It is the same as `context.WithCancel` followed by never cancelling."** No. `WithCancel` returns a context with a non-nil `Done()` channel. `WithoutCancel` returns one with a `nil` `Done()`.

---

## Tricky Points

- The detached context will not be garbage-collected until *every* goroutine holding a reference exits. A long-running detached goroutine holds the request's values in memory for as long as it lives.
- `WithoutCancel` does *not* preserve the parent's `Cause`. If the parent was cancelled with `WithCancelCause` and `cause := errors.New("specific")`, the detached context's `context.Cause(detached)` returns `nil`. Cause information is part of the cancellation signal, and the cancellation signal is what `WithoutCancel` drops.
- Inside the standard library, `WithoutCancel` is implemented by a sentinel that `propagateCancel` recognises and treats as "do not propagate." It is not a flag on a normal `cancelCtx`. We cover the internals at the professional level.
- A detached context whose parent has not yet been cancelled is fully functional, but `parent` is no longer "useful" from the detached context's point of view — values are still looked up through it, but cancellation cannot affect the detached side.
- The detach is one-way. There is no API to re-attach a detached context to a different parent's lifetime. You can layer cancellation on it but not "merge" it back.

---

## Test

```go
package main

import (
	"context"
	"testing"
	"time"
)

func TestWithoutCancelPreservesValues(t *testing.T) {
	type key struct{}
	parent := context.WithValue(context.Background(), key{}, "v")
	parent, cancel := context.WithCancel(parent)
	cancel()
	d := context.WithoutCancel(parent)
	if got := d.Value(key{}); got != "v" {
		t.Fatalf("want v, got %v", got)
	}
	if d.Err() != nil {
		t.Fatalf("expected nil err on detached, got %v", d.Err())
	}
	if d.Done() != nil {
		t.Fatalf("expected nil Done channel, got %v", d.Done())
	}
}

func TestWithoutCancelCanBeLayered(t *testing.T) {
	parent, cancel := context.WithCancel(context.Background())
	cancel()
	d := context.WithoutCancel(parent)
	d2, cancel2 := context.WithTimeout(d, 10*time.Millisecond)
	defer cancel2()
	select {
	case <-d2.Done():
		// good — the timeout fired on its own clock
	case <-time.After(100 * time.Millisecond):
		t.Fatal("timeout never fired")
	}
}

func TestDetachedSurvivesParentCancel(t *testing.T) {
	parent, cancel := context.WithCancel(context.Background())
	d := context.WithoutCancel(parent)
	cancel()
	if d.Err() != nil {
		t.Fatal("detached should not be cancelled when parent is")
	}
}

func TestWithoutCancelDeadlineEmpty(t *testing.T) {
	parent, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	d := context.WithoutCancel(parent)
	if _, ok := d.Deadline(); ok {
		t.Fatal("detached should have no deadline")
	}
}
```

---

## Tricky Questions

**Q. What does `<-ctx.Done()` do on a context returned by `WithoutCancel`?**
Blocks forever. The `Done()` channel is `nil`, and a receive on `nil` blocks. Code that relies on `Done()` firing must use a different signal.

**Q. Does `WithoutCancel(ctx)` make a deep copy of values?**
No. Values are still looked up through the parent chain at call time. The detached context is a thin wrapper. It does not "snapshot" the parent.

**Q. If I cancel a `WithCancel(WithoutCancel(parent))`, what is cancelled?**
The inner `WithCancel` context and all its descendants. The detached `WithoutCancel` context is unaffected (and unaffectable from this direction).

**Q. Is `WithoutCancel` the same as `context.Background()` with values copied?**
Functionally similar; structurally different. `Background()` is rooted and has no parent. `WithoutCancel` is rooted in the *parent*'s value tree, so future value lookups walk through the parent chain.

**Q. When the parent is garbage-collected, what happens to the detached context's values?**
The detached context holds a pointer to the parent. As long as the detached context is reachable, the parent is reachable too. So the values do not disappear — but they also do not get refreshed; the parent is immutable anyway.

**Q. Can two goroutines share a single `WithoutCancel` result safely?**
Yes. Contexts are immutable and safe for concurrent use. Spawning ten goroutines each holding the same detached context is the normal way.

**Q. What if I call `WithoutCancel(context.Background())`?**
You get a context that is effectively `context.Background()` — no values, no deadline, never cancelled. Pointless but harmless.

**Q. Does `WithoutCancel` allocate?**
Yes. One small struct on the heap, every call.

---

## Cheat Sheet

```
// API
detached := context.WithoutCancel(parent) // Go 1.21+

// Always bound it
ctx, cancel := context.WithTimeout(detached, d)
defer cancel()

// Detached invariants
detached.Done() == nil    // receive blocks forever
detached.Err()  == nil    // forever (until layered cancellation)
detached.Deadline() -> (zero, false)
detached.Value(k) == parent.Value(k) // values preserved
context.Cause(detached) == nil // even if parent had a cause
```

---

## Self-Assessment Checklist

- I can name the Go version that introduced `context.WithoutCancel` (1.21).
- I can explain why `<-detached.Done()` blocks forever.
- I can write a handler that runs detached audit logging without leaking goroutines.
- I know the difference between `context.Background()` and `context.WithoutCancel(parent)`.
- I know when *not* to use `WithoutCancel` (when the work should die with the request).
- I know that `Cause` is not propagated across the detach boundary.
- I always pair detach with a timeout or some other lifetime bound.
- I always wrap detached goroutines with `defer recover()`.

---

## Summary

Partial cancellation is the discipline of letting some descendants of a context outlive the parent. Go 1.21's `context.WithoutCancel` is the simplest tool: it preserves all values from the parent, drops the cancellation signal and the deadline, and lets the detached subtree run on its own. The classic use is detached cleanup — audit logs, metric emission, span export — that must finish after the request has returned. Always bound detached work with a timeout, always recover panics in detached goroutines, and never use `context.Background()` as a shortcut when you have a parent context with useful values.

Once you can see "detached vs request-bound" as two clearly distinct lifetimes that share values, partial cancellation feels natural. Until then, it feels like a strange escape hatch. Practice it on three or four real handler examples, run the tests above, and the intuition will click.

---

## What You Can Build

- A small HTTP server that audits every request after the response is written, surviving client disconnects.
- A metrics middleware that emits histogram observations from a detached goroutine, preserving the request's trace ID.
- A cache-warmer that detects stale entries during a request and kicks off a background refresh, detached from the request.
- A fire-and-forget webhook system: a request triggers an outbound HTTP POST that runs in the background with its own retry loop and timeout.
- A graceful-shutdown helper that tracks every detached goroutine spawned by handlers and waits for them at process exit.

---

## Further Reading

- The `context` package documentation for `WithoutCancel`.
- The Go 1.21 release notes — the section announcing `WithoutCancel`, `AfterFunc`, and `WithDeadlineCause`.
- The proposal at `https://github.com/golang/go/issues/40221`.
- The official Go blog post on context, which predates `WithoutCancel` but explains the value/lifetime split clearly.

---

## Related Topics

- Cooperative cancellation
- `context.WithCancelCause`
- `context.AfterFunc`
- Graceful shutdown
- Tracing context propagation
- Goroutine lifecycle management

---

## Diagrams & Visual Aids

### The fence

```
parent ──cancel──> child A (dies)
   │
   └── WithoutCancel ─── detached ───> child B (lives)
                                    
when cancel happens on parent:
  child A: Done() closes, Err() = canceled
  detached and child B: unaffected
```

### Lifetime grid

```
                | parent.Done | detached.Done | child of detached.Done |
parent cancel   | closed      | nil (open)    | nil (open, unless...)  |
detached layered timeout | closed | nil (open) | closes when timer fires |
process exit    | closed      | nil (open)    | depends                |
```

### The three contexts a handler sees

```
r.Context()                — request-bound
context.WithoutCancel(...) — detached from request
process server ctx         — bound to process lifetime
```

Most handlers only need the first two; servers that handle graceful shutdown need all three.

---

## Deeper Walkthrough: Reading the Source

The `WithoutCancel` function is implemented in `src/context/context.go` in the Go standard library. The relevant part is short. The function returns a `withoutCancelCtx` wrapper struct that embeds the parent and overrides `Done`, `Err`, and `Deadline`:

```go
type withoutCancelCtx struct {
    c Context
}

func (withoutCancelCtx) Deadline() (deadline time.Time, ok bool) { return }
func (withoutCancelCtx) Done() <-chan struct{}                   { return nil }
func (withoutCancelCtx) Err() error                              { return nil }
func (w withoutCancelCtx) Value(key any) any                     { return value(w, key) }
```

This is the entire essence of partial cancellation. Three methods return zero values; one method delegates value lookup back through the parent. The wrapper is *not* registered as a child for cancellation propagation. That is the magic that breaks the chain.

Notice what is *not* there. There is no `cancel` function. There is no `Done` channel that could ever be closed. The wrapper does not even hold a reference to a cancellation primitive of its own. It is, deliberately, an end of the cancellation chain.

### Why the magic works

When you call `context.WithCancel(detached)`, the internal `propagateCancel` function walks up the chain looking for a cancellable ancestor to register with. When it reaches the `withoutCancelCtx`, it stops — there is no cancellation to propagate from. The cancellation context for the *new* `WithCancel` becomes its own root.

This is why detaching is durable: you cannot accidentally un-detach. Even if some downstream code wraps the detached context in more layers, the cancellation chain remains broken at the `withoutCancelCtx` boundary.

### Comparing the four "no cancel" recipes

There are four ways to build a context that ignores cancellation:

1. `context.Background()` — empty, no parent, no values.
2. `context.TODO()` — same as `Background`, but a different name.
3. Manual wrapper: copy the parent and override `Done()` to return `nil`. (Pre-1.21 backport.)
4. `context.WithoutCancel(parent)` — built-in, preserves values.

Numbers 1 and 2 lose values. Number 3 is bug-prone. Number 4 is the canonical answer.

---

## Detailed Walkthrough: A Realistic Handler

Let us build up a realistic order-placement handler step by step, applying partial cancellation as we go.

### Step 1: The naive handler

```go
package main

import (
	"context"
	"encoding/json"
	"net/http"
)

type Order struct {
	ID     string
	UserID string
	Total  float64
}

func placeOrderHandler(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var ord Order
	if err := json.NewDecoder(r.Body).Decode(&ord); err != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	if err := insertOrder(ctx, ord); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	_ = json.NewEncoder(w).Encode(ord)
}
```

This handler ignores all the side-effects we want for production: audit, metrics, notifications. Let us add them.

### Step 2: Add audit, naively

```go
func placeOrderHandler(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var ord Order
	if err := json.NewDecoder(r.Body).Decode(&ord); err != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	if err := insertOrder(ctx, ord); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	_ = json.NewEncoder(w).Encode(ord)
	auditOrder(ctx, ord) // <-- still using request ctx
}
```

The bug: `auditOrder` is called synchronously, but after the response is written. If the client disconnects between `Encode` and `auditOrder`, `ctx` is cancelled and the audit fails. Also, the user waits for the audit to complete before the response is finalised.

### Step 3: Spawn a goroutine, still wrong

```go
go auditOrder(ctx, ord) // <-- still using request ctx
```

Now the user does not wait. But the goroutine still uses `ctx`. The audit may be cancelled mid-write.

### Step 4: Detach the goroutine

```go
go auditOrder(context.WithoutCancel(ctx), ord)
```

Better. The goroutine survives request cancellation. But it has no timeout — if the database hangs, the goroutine hangs.

### Step 5: Detach and bound

```go
audCtx := context.WithoutCancel(ctx)
audCtx, cancel := context.WithTimeout(audCtx, 5*time.Second)
go func() {
    defer cancel()
    auditOrder(audCtx, ord)
}()
```

Now the goroutine has a 5-second budget. Note `defer cancel()` is inside the goroutine because the goroutine owns the timeout.

### Step 6: Wrap in a helper

```go
go s.detached(ctx, "audit", func(c context.Context) error {
    return auditOrder(c, ord)
})
```

The helper does the detach, the timeout, the recovery, the logging, and the wait-group registration. The handler is back to one line per side-effect.

### Step 7: Track for graceful shutdown

The server struct has a `sync.WaitGroup`. The helper adds to it. Shutdown waits on it.

```go
func (s *Server) Shutdown(ctx context.Context) error {
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

The shutdown function waits for all detached goroutines, or for its own deadline, whichever comes first.

---

## Detailed Walkthrough: A Test Suite for Partial Cancellation

It is unusual to write tests for code that uses `WithoutCancel` directly, because the function is in the standard library and works. But it is worth writing tests for the *behaviour* you depend on, so that a future refactor cannot quietly break partial cancellation.

### Test 1: Detached context preserves a value

```go
func TestDetachedKeepsValue(t *testing.T) {
    type key struct{}
    parent := context.WithValue(context.Background(), key{}, "v")
    d := context.WithoutCancel(parent)
    if d.Value(key{}) != "v" {
        t.Fatal("value lost")
    }
}
```

### Test 2: Detached context survives parent cancellation

```go
func TestDetachedSurvivesParentCancel(t *testing.T) {
    parent, cancel := context.WithCancel(context.Background())
    d := context.WithoutCancel(parent)
    cancel()
    if d.Err() != nil {
        t.Fatal("detached should not be cancelled")
    }
}
```

### Test 3: Detached goroutine completes after parent cancel

```go
func TestDetachedGoroutineCompletes(t *testing.T) {
    parent, cancel := context.WithCancel(context.Background())
    d := context.WithoutCancel(parent)
    done := make(chan struct{})
    go func() {
        time.Sleep(50 * time.Millisecond)
        if d.Err() == nil {
            close(done)
        }
    }()
    cancel()
    select {
    case <-done:
        // good
    case <-time.After(time.Second):
        t.Fatal("goroutine did not complete after parent cancel")
    }
}
```

### Test 4: Timeout layered on detached context fires

```go
func TestTimeoutOnDetachedFires(t *testing.T) {
    parent, cancel := context.WithCancel(context.Background())
    defer cancel()
    d := context.WithoutCancel(parent)
    ctx, cancel2 := context.WithTimeout(d, 10*time.Millisecond)
    defer cancel2()
    select {
    case <-ctx.Done():
        // good
    case <-time.After(100 * time.Millisecond):
        t.Fatal("timeout did not fire")
    }
}
```

### Test 5: Helper function does all the things

```go
func TestDetachedWithTimeout(t *testing.T) {
    type key struct{}
    parent := context.WithValue(context.Background(), key{}, "v")
    parent, cancel := context.WithCancel(parent)
    cancel()
    ctx, cancel2 := DetachedWithTimeout(parent, 50*time.Millisecond)
    defer cancel2()
    if ctx.Value(key{}) != "v" {
        t.Fatal("value lost")
    }
    if ctx.Err() != nil {
        t.Fatal("should not be cancelled yet")
    }
}
```

---

## Detailed Walkthrough: A Realistic Webhook Delivery

A webhook system is an excellent showcase for partial cancellation. The user pays. The response is sent. The downstream service is notified via a webhook. The notification must run even if the user closes the browser. It must have a deadline. It must retry on failure. It must not crash the server on panic. It must be drained at shutdown.

```go
package webhook

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"
)

type Delivery struct {
	URL     string
	Payload any
}

type Service struct {
	client  *http.Client
	wg      sync.WaitGroup
	process context.Context
}

func New(processCtx context.Context) *Service {
	return &Service{
		client:  &http.Client{Timeout: 10 * time.Second},
		process: processCtx,
	}
}

func (s *Service) Send(parent context.Context, d Delivery) {
	s.wg.Add(1)
	ctx := context.WithoutCancel(parent)
	go func() {
		defer s.wg.Done()
		defer func() {
			if r := recover(); r != nil {
				fmt.Println("webhook panic:", r)
			}
		}()
		s.deliver(ctx, d)
	}()
}

func (s *Service) deliver(ctx context.Context, d Delivery) {
	delays := []time.Duration{0, time.Second, 5 * time.Second, 30 * time.Second}
	for i, delay := range delays {
		if delay > 0 {
			select {
			case <-time.After(delay):
			case <-s.process.Done():
				return
			}
		}
		c, cancel := context.WithTimeout(ctx, 5*time.Second)
		err := s.attempt(c, d)
		cancel()
		if err == nil {
			return
		}
		if i == len(delays)-1 {
			fmt.Println("webhook gave up:", d.URL, err)
		}
	}
}

func (s *Service) attempt(ctx context.Context, d Delivery) error {
	body, err := json.Marshal(d.Payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, "POST", d.URL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 500 {
		return fmt.Errorf("server error %d", resp.StatusCode)
	}
	return nil
}

func (s *Service) Drain(ctx context.Context) error {
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

This single file demonstrates every junior-level pattern in this chapter:

- `context.WithoutCancel(parent)` to detach from the request.
- `s.process` to bind to the process lifetime.
- `context.WithTimeout` per attempt to bound each network call.
- `select` with `s.process.Done()` to abort retries on shutdown.
- `defer s.wg.Done()` and `defer recover()` for safety.
- `Drain` to wait for all in-flight webhooks at shutdown.

A junior-level engineer who can read and write this file has internalised partial cancellation.

---

## Detailed Walkthrough: Three Common Anti-Patterns and Fixes

### Anti-pattern 1: Detaching but not bounding

```go
// BAD
go writeAudit(context.WithoutCancel(r.Context()), event)
```

If `writeAudit` is a database insert with no internal timeout, this goroutine may live for the rest of the process. On a busy server, a database hiccup leaves you with thousands of these.

**Fix:**

```go
detached, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), 5*time.Second)
go func() { defer cancel(); writeAudit(detached, event) }()
```

### Anti-pattern 2: Detaching but throwing away values

```go
// BAD
go writeAudit(context.Background(), event) // trace ID, user ID gone
```

Audit rows lose their trace IDs. Now you cannot correlate them with the request traces.

**Fix:**

```go
go writeAudit(context.WithoutCancel(r.Context()), event)
```

### Anti-pattern 3: Detaching without recovery

```go
// BAD
go writeAudit(context.WithoutCancel(r.Context()), event)
```

If `writeAudit` panics — perhaps on a malformed event — the entire process exits. A panic in any goroutine, recovered or not, takes down Go programs that do not catch it.

**Fix:**

```go
go func() {
    defer func() {
        if r := recover(); r != nil {
            log.Printf("audit panic: %v", r)
        }
    }()
    writeAudit(context.WithoutCancel(r.Context()), event)
}()
```

---

## Detailed Walkthrough: The Pre-1.21 World

Before Go 1.21, you had to hand-roll partial cancellation. Here is what a pre-1.21 codebase typically did:

```go
// Pre-1.21 — works on every version of Go.
type withoutCancel struct{ parent context.Context }

func (w withoutCancel) Deadline() (time.Time, bool) { return time.Time{}, false }
func (w withoutCancel) Done() <-chan struct{}       { return nil }
func (w withoutCancel) Err() error                  { return nil }
func (w withoutCancel) Value(k any) any             { return w.parent.Value(k) }

func WithoutCancel(parent context.Context) context.Context {
    return withoutCancel{parent: parent}
}
```

This is the seed of `context.WithoutCancel`. The standard-library version added support in `propagateCancel` to recognise this wrapper specially when descendants try to subscribe to cancellation. The hand-rolled version skips that, but for most use cases the result is the same.

If you are maintaining a codebase that targets Go 1.18 or 1.20 and you want partial cancellation, copy the above snippet into a small internal package and use it everywhere. When you upgrade to 1.21+, replace the call sites with `context.WithoutCancel` and delete the package. The behaviour will be identical.

A subtle but important difference: the hand-rolled version does not propagate `Cause` either, but it also does not have a sentinel that `context.WithCancel`'s `propagateCancel` recognises. In the rare case where you mix `WithCancel` and the hand-rolled detach, you may see subtle differences in how cancellation propagation walks the chain. For 99% of code, this never matters.

---

## Detailed Walkthrough: When NOT to Use `WithoutCancel`

There are three classes of code where `WithoutCancel` is the wrong tool:

### Class 1: Work that should die with the request

If the work is for the user — loading their cart, rendering their HTML, computing their search results — cancellation is correct. Detaching wastes server resources on output the user will never see.

A common mistake: a junior engineer reads about `WithoutCancel`, thinks "ah, this prevents context errors!", and starts wrapping every database call with it. The result is a server that does not back off when clients disconnect. The fix is to step back and ask: does the user benefit from this completing?

### Class 2: Work that has no values to preserve

If you are calling a top-level helper that does not need the request context at all — a metrics emitter, a periodic flush — you should use a long-lived background context, not a detached request context. Detaching from a request that is irrelevant is wasted indirection.

### Class 3: Work that must inherit the deadline

Sometimes you want a different-lifetime task that still has *a* deadline — a fan-out where each branch can fail independently, but the whole operation has a budget. For this, prefer `WithCancel` or `WithTimeout` from the parent. `WithoutCancel` is "give me an open-ended budget"; if you want a different budget, use the appropriate API.

---

## Frequently Asked: When Should I Use `WithoutCancel` vs `WithCancel`?

| You want                                                    | Use                          |
|-------------------------------------------------------------|------------------------------|
| Work that dies when the parent dies                          | (no derivation needed)       |
| Work that has its own cancellation, separate from parent     | `WithCancel(parent)`         |
| Work with a deadline, but cancelled if parent cancels        | `WithTimeout(parent, d)`     |
| Work that survives parent cancel, preserves values           | `WithoutCancel(parent)`      |
| Work that survives parent cancel, has its own deadline       | `WithTimeout(WithoutCancel(parent), d)` |
| Work that survives parent cancel, dies at process shutdown   | manual: detach + processCtx  |

Memorise this table. It covers every real use case at junior level.

---

## A Final Junior-Level Caution

`WithoutCancel` is one of those APIs that, once you know it, you want to use everywhere. Resist the urge. The default — that cancellation flows from request to descendants — is the right default. Use `WithoutCancel` only where you have a clear answer to "why must this outlive the request?"

Every time you reach for `WithoutCancel`, ask:

1. Will this work be wasted if the request is cancelled? If yes, do not detach.
2. Is the user waiting for the result? If yes, do not detach.
3. Is this side-effect part of the system's correctness, not the user's view? If yes, consider detaching.
4. Will the detached work complete in bounded time? If no, you need a timeout.
5. Could this detached work crash on bad input? If yes, you need `recover`.

When the answer to all five is satisfying, detach. Otherwise, keep using the request context.

---

## Ten Detached-Task Recipes You Can Steal

Below are ten copy-pasteable recipes for the most common detached-task shapes at junior level. Each is self-contained and Go-compiles as written (assuming the appropriate imports).

### Recipe 1: Plain detached audit insert

```go
func recordAudit(parent context.Context, ev AuditEvent) {
    ctx := context.WithoutCancel(parent)
    ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
    defer cancel()
    if err := db.InsertAudit(ctx, ev); err != nil {
        log.Printf("audit: %v", err)
    }
}
```

### Recipe 2: Fire-and-forget HTTP POST

```go
func notify(parent context.Context, url string, body []byte) {
    ctx := context.WithoutCancel(parent)
    ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
    defer cancel()
    req, _ := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(body))
    resp, err := http.DefaultClient.Do(req)
    if err != nil {
        log.Printf("notify: %v", err)
        return
    }
    resp.Body.Close()
}
```

### Recipe 3: Counter increment

```go
func bumpCounter(parent context.Context, key string) {
    ctx := context.WithoutCancel(parent)
    ctx, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
    defer cancel()
    _ = metrics.Inc(ctx, key)
}
```

### Recipe 4: Detached span flush

```go
func flushSpan(parent context.Context, span Span) {
    ctx := context.WithoutCancel(parent)
    ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
    defer cancel()
    _ = tracer.Export(ctx, span)
}
```

### Recipe 5: Cache warm-up

```go
func warmCache(parent context.Context, key string) {
    ctx := context.WithoutCancel(parent)
    ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
    defer cancel()
    if err := cache.Refresh(ctx, key); err != nil {
        log.Printf("warm %s: %v", key, err)
    }
}
```

### Recipe 6: Email queue enqueue

```go
func enqueueEmail(parent context.Context, e Email) {
    ctx := context.WithoutCancel(parent)
    ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
    defer cancel()
    if err := emailQueue.Enqueue(ctx, e); err != nil {
        log.Printf("enqueue email: %v", err)
    }
}
```

### Recipe 7: Background log flush

```go
func flushLogs(parent context.Context, entries []LogEntry) {
    ctx := context.WithoutCancel(parent)
    ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
    defer cancel()
    _ = logShipper.Send(ctx, entries)
}
```

### Recipe 8: Detached retry on failure

```go
func recordWithRetry(parent context.Context, ev Event) {
    ctx := context.WithoutCancel(parent)
    for i := 0; i < 3; i++ {
        c, cancel := context.WithTimeout(ctx, 2*time.Second)
        err := db.Insert(c, ev)
        cancel()
        if err == nil {
            return
        }
        time.Sleep(time.Duration(i+1) * 500 * time.Millisecond)
    }
}
```

### Recipe 9: Detached cleanup using `AfterFunc`

```go
func scheduleCleanup(parent context.Context, fn func()) {
    detached := context.WithoutCancel(parent)
    context.AfterFunc(detached, fn) // fn runs only when detached is cancelled
}
```

This is rarely useful because the detached context is never cancelled. It is shown here so you recognise the anti-pattern: `AfterFunc` on a detached context will never fire. Pair it with `WithTimeout` if you want it to fire after a delay.

### Recipe 10: Detached compute and store

```go
func deriveAndStore(parent context.Context, in []byte) {
    ctx := context.WithoutCancel(parent)
    ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
    defer cancel()
    out := expensiveCompute(in)
    if err := store.Put(ctx, out); err != nil {
        log.Printf("store: %v", err)
    }
}
```

---

## Demystifying Three Common Confusions

### Confusion 1: "But I never call `cancel` on the detached context, so it leaks?"

No. The detached context itself is a tiny struct; it does not "leak" any resource. What can leak is the *goroutine* you spawned using it. The context is fine — the goroutine is the thing to bound.

### Confusion 2: "`WithoutCancel` returns no cancel func, so how do I cancel it?"

You cannot. That is the point. If you want cancellation, layer it on:

```go
detached := context.WithoutCancel(parent)
ctx, cancel := context.WithCancel(detached)
// now you have a cancel func again
```

The inner `cancel` only cancels `ctx`, not `detached`.

### Confusion 3: "Does `WithoutCancel` block the request from completing?"

No. The request handler returns immediately after spawning the detached goroutine. The detached work runs in its own goroutine, independent of the request. Spawning costs about 2 microseconds.

---

## What "Cleanup That Must Outlive the Request" Actually Looks Like in Production

Here is what production code typically wants for cleanup-that-outlives-the-request:

- A bounded operation (timeout per attempt).
- Bounded retries.
- A bounded total time budget (otherwise retries can drag on).
- Recovery from panics.
- Logging of failures.
- A way to drain at shutdown.
- A metric for the success rate.

Putting it all together:

```go
type Detached struct {
    process context.Context
    wg      sync.WaitGroup
}

func (d *Detached) Run(parent context.Context, name string, op func(context.Context) error) {
    d.wg.Add(1)
    ctx := context.WithoutCancel(parent)
    go func() {
        defer d.wg.Done()
        defer func() {
            if r := recover(); r != nil {
                log.Printf("%s panic: %v", name, r)
                metrics.Inc("detached_panic", "name", name)
            }
        }()
        c, cancel := context.WithTimeout(ctx, 30*time.Second)
        defer cancel()
        for attempt := 0; attempt < 3; attempt++ {
            select {
            case <-d.process.Done():
                return
            default:
            }
            err := op(c)
            if err == nil {
                metrics.Inc("detached_success", "name", name)
                return
            }
            time.Sleep(time.Duration(attempt+1) * 200 * time.Millisecond)
        }
        log.Printf("%s gave up", name)
        metrics.Inc("detached_giveup", "name", name)
    }()
}

func (d *Detached) Drain(ctx context.Context) error {
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

A handler uses it like this:

```go
func (s *Server) handler(w http.ResponseWriter, r *http.Request) {
    fmt.Fprintln(w, "ok")
    s.detached.Run(r.Context(), "audit", func(ctx context.Context) error {
        return db.InsertAudit(ctx, ev)
    })
}
```

A 200-line file becomes a 10-line handler.

---

## Reading the Go 1.21 Release Notes

The Go 1.21 release notes have a short section for `WithoutCancel`. The exact wording, from `go.dev/doc/go1.21`:

> The new `WithoutCancel` function returns a copy of a context that is not canceled when the original context is canceled.

That is it. One sentence. The rest of context-related news in 1.21 is about `WithDeadlineCause` and `AfterFunc`. Together these three additions completed Go's cancellation story: you can cancel with a cause, you can outlive the parent, and you can hook a callback to a cancellation event without writing a goroutine.

---

## Some Quirks You Will Encounter

- `context.WithoutCancel(nil)` panics. Always pass a non-nil parent. (`go vet` flags this.)
- The returned context implements `context.Context` but is *not* equal to the parent. `detached == parent` is false. `detached.Value(k) == parent.Value(k)` is true.
- The returned context has a different `fmt.Sprint` representation: `context.WithoutCancel(parent)`. This is sometimes useful for debugging.
- Some logging libraries try to log the entire context. They will print "WithoutCancel" as part of the chain.
- In tests, you can fake `WithoutCancel` by writing your own wrapper. Few tests need to.

---

## Mini-Project: The Audit-Logging Middleware

A real, complete mini-project you can build to internalise the pattern.

Goal: an HTTP middleware that, after every request, writes an audit entry. The audit entry must include the request's trace ID and user ID. It must survive client disconnect. It must time out after 5 seconds. It must not crash the server on panic.

Specification:

- Define a middleware `Audit(next http.Handler) http.Handler`.
- The middleware wraps the response writer to capture the status code and bytes written.
- After `next.ServeHTTP` returns, spawn a detached goroutine.
- The detached goroutine builds an `AuditEntry` from the captured data and writes it.

Solution:

```go
type AuditEntry struct {
    TraceID    string
    UserID     string
    Path       string
    Status     int
    Bytes      int
    DurationMS int64
    Time       time.Time
}

type captureWriter struct {
    http.ResponseWriter
    status int
    bytes  int
}

func (c *captureWriter) WriteHeader(s int) { c.status = s; c.ResponseWriter.WriteHeader(s) }
func (c *captureWriter) Write(b []byte) (int, error) {
    n, err := c.ResponseWriter.Write(b)
    c.bytes += n
    return n, err
}

func Audit(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        start := time.Now()
        cw := &captureWriter{ResponseWriter: w, status: 200}
        next.ServeHTTP(cw, r)

        entry := AuditEntry{
            TraceID:    traceIDFromCtx(r.Context()),
            UserID:     userIDFromCtx(r.Context()),
            Path:       r.URL.Path,
            Status:     cw.status,
            Bytes:      cw.bytes,
            DurationMS: time.Since(start).Milliseconds(),
            Time:       time.Now(),
        }

        ctx := context.WithoutCancel(r.Context())
        ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
        go func() {
            defer cancel()
            defer func() {
                if rc := recover(); rc != nil {
                    log.Printf("audit panic: %v", rc)
                }
            }()
            _ = writeAudit(ctx, entry)
        }()
    })
}
```

You can drop this middleware into any net/http server. It demonstrates every pattern in the chapter in fewer than 50 lines.

---

## What Comes Next

This file covered the *what* and the *most common how* of partial cancellation. The middle-level file covers:

- Scoped contexts: how to give one branch of a fan-out its own cancellation.
- The difference between `WithoutCancel`, `WithTimeout`, and `WithDeadline` when applied at different points.
- Detached subtasks within a larger orchestration.
- Cancelling one branch of an errgroup without cancelling the others.
- The interaction with `singleflight`, `sync.Once`, and other coordination primitives.

The senior-level file covers:

- The architecture of detached cleanup across a service.
- Supervised detached goroutines as a building block.
- The integration with graceful shutdown and process-lifetime contexts.
- The interaction with distributed tracing and span lifecycle.
- The relationship to structured concurrency proposals.

The professional-level file covers:

- The internals of `withoutCancelCtx`, `propagateCancel`, and the sentinel key trick.
- The exact API contracts for `Cause`, `AfterFunc`, and `WithCancelCause` and their interaction with `WithoutCancel`.
- How the runtime sees the context tree from inside `context.go`.
- Comparisons with cancellation primitives in other languages and runtimes.

If junior-level material feels comfortable, move to middle. If it still feels strange, build the mini-project above and run all five tests. The intuition becomes automatic after about a dozen real call sites.

---

## Extended Comparison: Five Cancellation Modes

To cement the mental model, compare five concrete ways to derive a child context. Each has different propagation behaviour. The table is followed by a worked example for each.

| Derivation                              | Parent cancel → child? | Child cancel → parent? | Inherits values? |
|-----------------------------------------|------------------------|------------------------|------------------|
| `WithCancel(parent)`                    | yes                    | no                     | yes              |
| `WithTimeout(parent, d)`                | yes                    | no                     | yes              |
| `WithDeadline(parent, t)`               | yes                    | no                     | yes              |
| `WithValue(parent, k, v)`               | yes                    | no                     | yes              |
| `WithoutCancel(parent)`                 | **no**                 | no                     | yes              |

The last row is the odd one out. Every other derivation says "I am a child of the parent and I inherit its lifetime." `WithoutCancel` says "I am a sibling of the parent that happens to look up values through it."

### Worked example 1: `WithCancel`

```go
parent, cancel := context.WithCancel(context.Background())
child, _ := context.WithCancel(parent)
cancel()
// child.Err() != nil immediately
```

### Worked example 2: `WithTimeout`

```go
parent, cancel := context.WithCancel(context.Background())
child, _ := context.WithTimeout(parent, time.Hour)
cancel()
// child.Err() != nil immediately (cancellation, not deadline)
```

### Worked example 3: `WithDeadline`

```go
parent, cancel := context.WithCancel(context.Background())
child, _ := context.WithDeadline(parent, time.Now().Add(time.Hour))
cancel()
// child.Err() != nil immediately
```

### Worked example 4: `WithValue`

```go
parent, cancel := context.WithCancel(context.Background())
child := context.WithValue(parent, "k", "v")
cancel()
// child.Err() != nil immediately — value contexts inherit parent's cancellation
```

### Worked example 5: `WithoutCancel`

```go
parent, cancel := context.WithCancel(context.Background())
child := context.WithoutCancel(parent)
cancel()
// child.Err() == nil — the cancel did not propagate
```

Internalise the difference between the last two. `WithValue` keeps the parent's lifetime. `WithoutCancel` discards it.

---

## A Deep-Dive Aside: Why `Done()` Returns `nil` Instead of an Always-Open Channel

A natural design alternative would be: `WithoutCancel` returns an *always-open* channel (one that is never closed). Such a channel would behave the same way in a `select` — receives would block forever. So why does the standard library return `nil` instead?

Two reasons:

1. **Allocation cost.** Returning `nil` is free. Allocating a real channel costs ~96 bytes. Multiplied across every detached context, this would add up.
2. **Detectability.** `ctx.Done() == nil` is a clean signal that this context never fires cancellation. Some library code can use it to skip cancellation-related setup entirely (e.g., not start a watcher goroutine).

This is one of those choices that looks weird until you understand the rationale. Once you do, it becomes obvious: `nil` is the correct sentinel for "no cancellation channel."

A small caveat: code that does

```go
select {
case <-ctx.Done():
    // cancellation
default:
}
```

works fine on a detached context — the default branch is always taken. But code that does

```go
case <-ctx.Done(): doStuff()
```

without a default branch will block forever on a detached context. This is sometimes the right behaviour (a cancellation watchdog that should run forever) and sometimes a bug.

---

## Yet Another Look at the "Values Without Lifetime" Idea

Think about what a context actually represents. A context carries:

- A trace ID
- A user ID
- A request ID
- Maybe a tenant ID, a billing tier, an A/B-test bucket
- A deadline policy
- A cancellation token

The first six are *identity*. They describe what request this is. The last two are *lifetime*. They describe how long this work has to live.

Most operations want both: "I am operating on behalf of this request, and I should stop when the request stops." But occasionally an operation wants only identity: "I am operating on behalf of this request, but my lifetime is my own."

Audit logging is the canonical example. Audit rows are tied to a specific request — they need the trace ID, the user ID. But their *lifetime* is independent of the request — they need to survive the user closing their browser.

`WithoutCancel` is the language-level expression of "identity without lifetime." It is one of those rare additions that makes a previously-clunky idiom suddenly clean.

---

## Worked Example: Migrating a Codebase from Hand-Rolled to `WithoutCancel`

Imagine a Go 1.20 codebase with a small internal helper:

```go
// package internal/ctxutil
package ctxutil

import (
    "context"
    "time"
)

type DetachContext struct{ parent context.Context }

func (d DetachContext) Deadline() (time.Time, bool) { return time.Time{}, false }
func (d DetachContext) Done() <-chan struct{}       { return nil }
func (d DetachContext) Err() error                  { return nil }
func (d DetachContext) Value(k any) any             { return d.parent.Value(k) }

func Detach(parent context.Context) context.Context { return DetachContext{parent: parent} }
```

Used like this throughout the codebase:

```go
go audit(ctxutil.Detach(r.Context()), event)
```

When the team upgrades to Go 1.21, the migration is mechanical:

```bash
# Replace import.
goimports -r 'ctxutil.Detach -> context.WithoutCancel' ./...

# Or by hand:
grep -rl 'ctxutil.Detach' . | xargs sed -i 's/ctxutil\.Detach/context.WithoutCancel/g'

# Remove the now-unused package.
rm -rf internal/ctxutil
```

After the migration, every call site reads `context.WithoutCancel(r.Context())`. The standard library has subsumed the helper. The codebase is cleaner.

---

## A Tour of Detached-Cleanup Real-World Examples

The patterns in this chapter show up in many real services. Below are sketches of how four kinds of system use them.

### A payments service

```go
func (s *PaymentService) Charge(parent context.Context, req ChargeRequest) (*Receipt, error) {
    receipt, err := s.gateway.Process(parent, req)
    if err != nil {
        return nil, err
    }

    // Detached: receipt logged regardless of caller cancellation.
    s.detached.Run(parent, "receipt_log", func(ctx context.Context) error {
        return s.db.InsertReceipt(ctx, receipt)
    })

    // Detached: webhook sent to merchant regardless of caller cancellation.
    s.detached.Run(parent, "merchant_webhook", func(ctx context.Context) error {
        return s.webhooks.Send(ctx, req.MerchantID, receipt)
    })

    return receipt, nil
}
```

### A search service

```go
func (s *SearchService) Search(parent context.Context, q Query) (Results, error) {
    res, err := s.engine.Query(parent, q)
    if err != nil {
        return nil, err
    }

    // Detached: query log written regardless of caller cancellation.
    s.detached.Run(parent, "query_log", func(ctx context.Context) error {
        return s.log.Record(ctx, q, res)
    })

    // Detached: if the index is stale, kick off a refresh.
    if res.Stale {
        s.detached.Run(parent, "index_refresh", func(ctx context.Context) error {
            return s.engine.Refresh(ctx, q.Index)
        })
    }

    return res, nil
}
```

### A chat service

```go
func (s *ChatService) ReadMessages(parent context.Context, threadID string) ([]Message, error) {
    msgs, err := s.store.List(parent, threadID)
    if err != nil {
        return nil, err
    }

    // Detached: read receipts must be recorded even if the user closes the view.
    s.detached.Run(parent, "read_receipts", func(ctx context.Context) error {
        return s.store.MarkRead(ctx, threadID, msgs)
    })

    return msgs, nil
}
```

### A photo-upload service

```go
func (s *PhotoService) Upload(parent context.Context, in Upload) (*Photo, error) {
    photo, err := s.storage.Put(parent, in)
    if err != nil {
        return nil, err
    }

    // Detached: thumbnail generation can happen after response.
    s.detached.Run(parent, "thumbnail", func(ctx context.Context) error {
        return s.thumb.Generate(ctx, photo)
    })

    // Detached: face-detection (analytics) does not block the response.
    s.detached.Run(parent, "face_detect", func(ctx context.Context) error {
        return s.faces.Analyze(ctx, photo)
    })

    return photo, nil
}
```

Notice the pattern across all four: the *primary* operation uses the parent context (so it is cancelled when the caller cancels), and the *side-effects* are detached. Each side-effect is named, has its own logging, and is independently tracked.

---

## A Subtle Performance Note

`WithoutCancel` is a thin wrapper. Looking up a value on it walks one extra hop up the chain. For typical context depths (3–10 layers), this is undetectable. But if you have a hot path that calls `ctx.Value(k)` thousands of times per request, and you use a detached context wrapping a deeply-nested one, the extra hop adds up.

Workaround: cache the value at the point of detachment.

```go
type auditCtx struct {
    context.Context
    traceID string
    userID  string
}

func newAuditCtx(parent context.Context) *auditCtx {
    return &auditCtx{
        Context: context.WithoutCancel(parent),
        traceID: traceIDFromCtx(parent),
        userID:  userIDFromCtx(parent),
    }
}
```

The detached goroutine can then use `auditCtx.traceID` directly without walking the chain.

This is overkill for most code. Mention it for completeness.

---

## More Practice Snippets

### Snippet A: Toggle behaviour based on cancellation

```go
func work(ctx context.Context) {
    if ctx.Err() != nil {
        return // already cancelled — bail
    }
    // ... do work ...
}
```

If you pass a detached context, the `ctx.Err()` check always passes (returns nil) and the work proceeds. If you pass a cancelled context, the work is skipped. Useful for "skip if already cancelled" idioms.

### Snippet B: Multiplexed cancellation

```go
func waitForEither(processCtx, opCtx context.Context) {
    select {
    case <-processCtx.Done():
        // shutdown
    case <-opCtx.Done():
        // op timeout
    }
}
```

The detached `opCtx` has a nil `Done()`. So the `select` only fires on `processCtx.Done()`. This is sometimes the right thing (use process-only cancellation) and sometimes a bug (you forgot the op has no own cancellation).

### Snippet C: Per-goroutine recovery wrapper

```go
func safeGo(name string, fn func()) {
    go func() {
        defer func() {
            if r := recover(); r != nil {
                log.Printf("%s panic: %v", name, r)
            }
        }()
        fn()
    }()
}
```

A reusable wrapper. Then:

```go
safeGo("audit", func() { audit(detached, event) })
```

---

## Build Yourself A Tiny Library

To make the patterns reusable across your services, factor out a tiny library:

```go
// package detached
package detached

import (
    "context"
    "log"
    "sync"
    "time"
)

type Pool struct {
    process context.Context
    wg      sync.WaitGroup
}

func NewPool(processCtx context.Context) *Pool {
    return &Pool{process: processCtx}
}

func (p *Pool) Go(parent context.Context, name string, timeout time.Duration, fn func(context.Context) error) {
    p.wg.Add(1)
    ctx := context.WithoutCancel(parent)
    if timeout > 0 {
        var cancel context.CancelFunc
        ctx, cancel = context.WithTimeout(ctx, timeout)
        // Note: cancel will be called in the goroutine.
        _ = cancel
        go p.runWithCancel(name, ctx, cancel, fn)
        return
    }
    go p.run(name, ctx, fn)
}

func (p *Pool) run(name string, ctx context.Context, fn func(context.Context) error) {
    defer p.wg.Done()
    defer recoverPanic(name)
    if err := fn(ctx); err != nil {
        log.Printf("detached %s: %v", name, err)
    }
}

func (p *Pool) runWithCancel(name string, ctx context.Context, cancel context.CancelFunc, fn func(context.Context) error) {
    defer p.wg.Done()
    defer cancel()
    defer recoverPanic(name)
    if err := fn(ctx); err != nil {
        log.Printf("detached %s: %v", name, err)
    }
}

func recoverPanic(name string) {
    if r := recover(); r != nil {
        log.Printf("detached %s panic: %v", name, r)
    }
}

func (p *Pool) Drain(ctx context.Context) error {
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

Half a page of code. Every detached call in your codebase becomes:

```go
pool.Go(r.Context(), "audit", 5*time.Second, func(ctx context.Context) error {
    return writeAudit(ctx, ev)
})
```

This is the kind of internal library that pays for itself within a week.

---

## A Long Word on `context.AfterFunc`

Go 1.21 also introduced `context.AfterFunc`. Many people confuse it with `WithoutCancel`. They are *not* related, but they are sometimes used together.

`AfterFunc(ctx, f)` registers `f` to run in its own goroutine when `ctx` is cancelled. It returns a stop function that cancels the registration.

Combining the two is a clean way to schedule cleanup on cancellation:

```go
func handle(ctx context.Context) {
    // Schedule cleanup that runs when the request is cancelled.
    stop := context.AfterFunc(ctx, func() {
        c := context.WithoutCancel(ctx) // detach for the cleanup
        // ... cleanup work ...
        _ = c
    })
    defer stop()

    // ... main work ...
}
```

The cleanup runs only if `ctx` is cancelled. The cleanup itself uses a detached context, because if the request context is cancelled, the cleanup must not be cancelled too.

This is one of the rare cases where `AfterFunc` and `WithoutCancel` work together. Most code uses one or the other.

---

## Wrap-Up

A junior-level engineer who has read this file should now:

- Know that `context.WithoutCancel` exists, what version added it, and what its signature looks like.
- Be able to write a handler that spawns a detached audit goroutine without leaking.
- Know the four cancellation derivations and how they differ in lifetime propagation.
- Be able to read and write the detach-bound-recover pattern by muscle memory.
- Know when *not* to use partial cancellation.

That is the entire curriculum at junior level. The middle, senior, and professional levels expand on patterns, architecture, and internals.

---

## Appendix A: Twenty More Worked Examples

These are smaller snippets, each demonstrating one fact about `WithoutCancel`. Read them like flashcards.

### Example A1

```go
func A1() {
    p, c := context.WithCancel(context.Background())
    d := context.WithoutCancel(p)
    c()
    fmt.Println(p.Err(), d.Err()) // context canceled <nil>
}
```

### Example A2

```go
func A2() {
    p := context.WithValue(context.Background(), "k", 1)
    d := context.WithoutCancel(p)
    fmt.Println(d.Value("k")) // 1
}
```

### Example A3

```go
func A3() {
    d := context.WithoutCancel(context.Background())
    fmt.Println(d.Done() == nil) // true
}
```

### Example A4

```go
func A4() {
    d := context.WithoutCancel(context.Background())
    _, ok := d.Deadline()
    fmt.Println(ok) // false
}
```

### Example A5

```go
func A5() {
    p, c := context.WithTimeout(context.Background(), 10*time.Millisecond)
    defer c()
    d := context.WithoutCancel(p)
    time.Sleep(20 * time.Millisecond)
    fmt.Println(p.Err(), d.Err()) // context deadline exceeded <nil>
}
```

### Example A6

```go
func A6() {
    p, c := context.WithCancelCause(context.Background())
    c(fmt.Errorf("boom"))
    d := context.WithoutCancel(p)
    fmt.Println(context.Cause(p), context.Cause(d)) // boom <nil>
}
```

### Example A7

```go
func A7() {
    d := context.WithoutCancel(context.Background())
    d2, c := context.WithCancel(d)
    c()
    fmt.Println(d2.Err()) // context canceled
    fmt.Println(d.Err())  // <nil>
}
```

### Example A8

```go
func A8() {
    p, _ := context.WithCancel(context.Background())
    d := context.WithoutCancel(p)
    d2, c := context.WithTimeout(d, 5*time.Millisecond)
    defer c()
    <-d2.Done()
    fmt.Println(d2.Err()) // context deadline exceeded
}
```

### Example A9

```go
func A9() {
    d := context.WithoutCancel(context.Background())
    select {
    case <-d.Done():
        fmt.Println("unreachable")
    default:
        fmt.Println("default taken") // this
    }
}
```

### Example A10

```go
func A10() {
    p, c := context.WithCancel(context.Background())
    c()
    d := context.WithoutCancel(p) // detach after parent cancelled
    fmt.Println(d.Err())          // <nil>
}
```

### Example A11

```go
func A11() {
    d1 := context.WithoutCancel(context.Background())
    d2 := context.WithoutCancel(d1)
    fmt.Println(d1 == d2) // false (different structs)
}
```

### Example A12

```go
func A12() {
    p := context.WithValue(context.Background(), "a", 1)
    p = context.WithValue(p, "b", 2)
    d := context.WithoutCancel(p)
    fmt.Println(d.Value("a"), d.Value("b")) // 1 2
}
```

### Example A13

```go
func A13() {
    p, _ := context.WithCancel(context.Background())
    d := context.WithoutCancel(p)
    fmt.Println(fmt.Sprint(d)) // context.WithoutCancel(...)
}
```

### Example A14

```go
func A14() {
    d := context.WithoutCancel(context.TODO())
    fmt.Println(d.Err()) // <nil>
}
```

### Example A15

```go
func A15() {
    // Both cancel and timeout layered.
    d := context.WithoutCancel(context.Background())
    d, cancel := context.WithTimeout(d, time.Hour)
    defer cancel()
    d, cancel2 := context.WithCancel(d)
    defer cancel2()
    cancel2()
    fmt.Println(d.Err()) // context canceled
}
```

### Example A16

```go
func A16() {
    p := context.Background()
    d := context.WithoutCancel(p)
    // Without cancel, both behave the same way under <-Done().
    select {
    case <-d.Done():
    case <-time.After(time.Millisecond):
        fmt.Println("default") // this
    }
}
```

### Example A17

```go
func A17() {
    p, _ := context.WithCancel(context.Background())
    d := context.WithoutCancel(p)
    if d.Done() == p.Done() {
        fmt.Println("same channel")
    } else {
        fmt.Println("different") // this — d.Done() is nil
    }
}
```

### Example A18

```go
func A18() {
    p := context.WithValue(context.Background(), "k", "v")
    d := context.WithoutCancel(p)
    p = nil // does not affect d — d still holds the parent
    fmt.Println(d.Value("k")) // v
}
```

### Example A19

```go
func A19() {
    p, c := context.WithCancel(context.Background())
    d := context.WithoutCancel(p)
    c()
    runtime.GC()
    // d is still usable; the parent is reachable via d.
    fmt.Println(d.Err()) // <nil>
}
```

### Example A20

```go
func A20() {
    // The detach is one-way: there is no API to re-attach.
    p, c := context.WithCancel(context.Background())
    d := context.WithoutCancel(p)
    // Nothing you can do here will make c() cancel d.
    c()
    fmt.Println(d.Err()) // <nil>
}
```

---

## Appendix B: A Short Reading Plan

If you want to go beyond this file, read in this order:

1. Re-read the `context` package documentation top to bottom.
2. Read the Go 1.20 release notes section on `WithCancelCause`.
3. Read the Go 1.21 release notes section on `WithoutCancel`, `WithDeadlineCause`, `AfterFunc`.
4. Read the actual source of `withoutCancelCtx` in `src/context/context.go`.
5. Read three or four real-world middleware libraries (chi, echo) and look for how they handle detached cleanup.
6. Look at OpenTelemetry's Go SDK for how it exports spans — they wrestle with exactly this problem.
7. Move on to the middle.md file in this section.

By the time you finish step 6, you will have seen the patterns in this file in the wild a dozen times. The middle file will then feel like a natural extension rather than a new topic.

---

## Appendix C: A Glossary of Adjacent Terms

- **Backpressure** — slowing down upstream producers when downstream consumers are saturated. Independent of partial cancellation.
- **Bulkhead** — isolating a failure domain so one failure does not cascade. Detached work is a form of bulkhead.
- **Saga** — a sequence of operations with compensating actions on failure. Detached operations can be saga steps.
- **Outbox** — a durable buffer for events that must be delivered eventually. Detached work often writes to an outbox.
- **Dead-letter queue** — a queue for failed events. Detached retries that exhaust their budget can write here.
- **Idempotent** — an operation safe to retry. Detached retries should be idempotent.

These terms appear in middle and senior material. Look them up if you have not encountered them.

---

## Appendix D: Pitfalls Specific to net/http

- `r.Context()` is cancelled when the client disconnects *or* when the response has been fully written. Either trigger is enough.
- Some middlewares wrap `r.Context()` with their own `WithCancel`. Detaching from the outer wrapper detaches from the right ancestor.
- HTTP/2 server push and trailers can keep the context alive longer than you expect. Test on real protocols.
- gRPC server contexts have similar semantics; `WithoutCancel` works the same way.

---

## Appendix E: A Pop Quiz

Test yourself before moving to the middle-level file. Answers are at the very end.

1. What is the signature of `context.WithoutCancel`?
2. Does it preserve values?
3. Does it preserve the deadline?
4. What does `ctx.Done()` return on a detached context?
5. What does `ctx.Err()` return?
6. Does `context.Cause(detached)` return the parent's cause?
7. If I call `cancel()` on the result of `WithCancel(WithoutCancel(parent))`, what happens?
8. Is `WithoutCancel(parent)` the same as `context.Background()` with values copied?
9. Can I detach an already-cancelled context?
10. What is the most common bug when adopting `WithoutCancel`?

### Answers

1. `func WithoutCancel(parent Context) Context`.
2. Yes.
3. No.
4. `nil`.
5. `nil`.
6. No.
7. The inner context is cancelled; the detached one is not.
8. Functionally similar; structurally different — `Background()` has no parent.
9. Yes.
10. Spawning a detached goroutine with no internal timeout, leaking when the downstream hangs.

If you got all ten right, move on. If you missed any, re-read the relevant section.

---

## A Final Note

`WithoutCancel` is one of those quiet, useful additions to the standard library that does not look revolutionary but solves a real problem that every production Go programmer had been working around. Most of the time, you will not need it. But on the day you do, the difference between knowing it and not knowing it is the difference between a clean five-line fix and an hour of hand-rolling a wrapper that someone else will have to maintain.

Use it sparingly, bound the detached work, recover from panics, and you have all the partial cancellation tools you need at this level.

---

## Appendix F: Reasoning About Garbage Collection

A subtle concern at junior level is: does detaching a context hold the parent in memory?

Yes. The `withoutCancelCtx` wrapper holds a reference to its parent. As long as the detached context is reachable, so is the parent. As long as the parent is reachable, so are its values.

In practice this matters when:

1. A detached goroutine is very long-running.
2. The parent context held large values (a giant cached response, a buffer).

A detached goroutine that holds a context referencing a 100 MB cached response keeps that 100 MB alive for the entire lifetime of the goroutine. If the goroutine runs for minutes, that is fine. If it runs for hours, you have an effective memory leak.

The fix is to extract what you need at the point of detachment and not pass the full context any further than necessary:

```go
// Instead of:
go process(detached, /* uses ctx.Value("response") */)

// Do:
resp, _ := detached.Value("response").(*Response)
go processCopy(resp)
```

This is rarely necessary, but it is worth knowing about.

---

## Appendix G: How `WithoutCancel` Relates to `errgroup`

The `golang.org/x/sync/errgroup` package wraps a context with cancellation that propagates to all subtasks. If one subtask fails, all are cancelled. This is sometimes too aggressive — you may want one failing subtask to be logged but for the others to continue.

The standard way is *not* to use `errgroup.WithContext` but to use `errgroup.Group` directly. But for detached operations that should not participate in the errgroup's cancellation:

```go
g, ctx := errgroup.WithContext(parent)
g.Go(func() error { return fetchA(ctx) })
g.Go(func() error { return fetchB(ctx) })

// This audit must run independent of the errgroup's cancellation.
detached := context.WithoutCancel(ctx)
go writeAudit(detached, event)

err := g.Wait()
```

The errgroup cancels `ctx` on the first failure. The detached audit is unaffected.

We will see more sophisticated patterns at the middle level.

---

## Appendix H: A Short Test of Understanding

Below are five small code snippets. For each, predict what is printed before running it.

### Snippet 1

```go
parent, c := context.WithCancel(context.Background())
d := context.WithoutCancel(parent)
c()
fmt.Println(d.Err())
```

### Snippet 2

```go
d := context.WithoutCancel(context.Background())
d, c := context.WithTimeout(d, time.Millisecond)
defer c()
time.Sleep(10 * time.Millisecond)
fmt.Println(d.Err())
```

### Snippet 3

```go
p := context.WithValue(context.Background(), "k", "v")
d := context.WithoutCancel(p)
fmt.Println(d.Value("k"))
```

### Snippet 4

```go
parent, c := context.WithCancelCause(context.Background())
c(errors.New("nope"))
d := context.WithoutCancel(parent)
fmt.Println(context.Cause(parent), context.Cause(d))
```

### Snippet 5

```go
d := context.WithoutCancel(context.Background())
select {
case <-d.Done():
    fmt.Println("done")
case <-time.After(time.Millisecond):
    fmt.Println("timeout")
}
```

### Expected output

1. `<nil>`
2. `context deadline exceeded`
3. `v`
4. `nope <nil>`
5. `timeout`

If any surprise you, scroll back to the matching section and re-read it.

---

## Appendix I: A Quick Decision Flowchart

When you have a side-effect in a handler, use this flowchart:

```
Should this work survive the client disconnecting?
  No  → use r.Context() directly
  Yes → use context.WithoutCancel(r.Context())
        Does it have a natural bound (a quick insert, a single HTTP call)?
          Yes → no timeout needed, but consider one for safety
          No  → wrap with WithTimeout
        Could it panic on bad input?
          Yes → defer recover()
          No  → still defer recover() — it costs nothing
        Should the process wait for it on shutdown?
          Yes → register in a WaitGroup or supervisor
          No  → spawn unsupervised
```

Print this flowchart and keep it next to your desk for a week. After ten real decisions, it becomes second nature.

---

## Closing Words for Junior Engineers

The transition from "I know goroutines and channels" to "I can write production-grade detached work" is one of the bigger leaps in Go. `WithoutCancel` is one tool of many. Master this one — really, deeply, until you do not have to think about it — and the next steps (errgroups, supervisors, structured concurrency) are easier.

The single piece of advice that summarises this entire file: **detached work is a deliberate choice, not a default. When you detach, you take on responsibility for bounding the work. The standard library cannot bound it for you.**

Welcome to partial cancellation. The next file in this section dives into scoped contexts, fanout, and the choice between `WithoutCancel`, `WithTimeout`, and `WithDeadline` at different nodes of the tree.


