---
layout: default
title: Cleanup Ordering — Senior
parent: Cleanup Ordering
grand_parent: Cancellation Deep
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/20-cancellation-deep/03-cleanup-ordering/senior/
---

# Cleanup Ordering — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros-cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Architecture Patterns](#architecture-patterns)
11. [Clean Code](#clean-code)
12. [Production Considerations](#production-considerations)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Engineering](#performance-engineering)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases-pitfalls)
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
29. [Diagrams & Visual Aids](#diagrams-visual-aids)

---

## Introduction
> Focus: "How does cleanup ordering scale across a large codebase? How do I design resource hierarchies that compose? How do `defer`, `AfterFunc`, and shutdown choreography interact at the architecture level?"

A junior writes `defer f.Close()` and feels clever. A middle-level engineer writes the closure that propagates the close error and pairs `AfterFunc` with `stop()`. A senior engineer designs the *system* around these primitives. They decide which package owns which resource, which goroutine cleans up which state, how a 500-line shutdown sequence stays correct as teams add new components year over year.

At the senior level, cleanup is no longer a per-function concern. It is an architectural one. You think about:

- **Resource hierarchies that cross package boundaries.** Who closes the shared metrics exporter? Whose responsibility is the connection pool?
- **Shutdown choreography in services with dozens of components.** The order matters for correctness. How do you make it readable, testable, and resilient to growth?
- **Cleanup that interacts with panic recovery, supervisor patterns, and crash-only design.** When does panic-during-cleanup matter? When does it not?
- **The interaction between `context.AfterFunc`, the runtime's defer machinery, and the Go scheduler.** You know enough to read the source.
- **Design discipline that makes cleanup composable.** Every new component plugs into the same recipe.

This file assumes you internalised the junior and middle files. You should already be writing `defer cancel()`, `defer stop()`, named returns, and cancel-drain-close shutdown without thinking. The senior level builds on top.

---

## Prerequisites

- **Required:** Full comfort with the junior and middle files of this sub-topic.
- **Required:** Experience building or maintaining a Go service with at least five components (HTTP server, database, cache, logger, metrics).
- **Required:** Awareness of supervisor patterns, structured concurrency, and graceful shutdown SLOs.
- **Required:** Comfort with `errgroup`, signal handling, and the `slog` structured logger.
- **Helpful:** Experience reading the Go standard library's `net/http`, `database/sql`, `context`, and `runtime` packages.
- **Helpful:** Familiarity with `go vet`, `staticcheck`, and `errcheck` linting passes.

If you have ever spent a week debugging "the service hangs on SIGTERM," you have the right level of scar tissue.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Resource hierarchy** | The dependency graph between resources owned by a service. Used to derive release order. |
| **Shutdown choreography** | The script of cancel-drain-close steps across components. May be linear, parallel, or staged. |
| **Supervisor** | A goroutine that restarts crashed workers. In Go, often built with `errgroup` plus a retry loop. |
| **Structured concurrency** | The discipline that a function does not return until all goroutines it spawned have exited. Enforced manually in Go (no language primitive). |
| **Crash-only design** | An architecture where the only intentional shutdown is "crash" — no graceful path. Simplifies reasoning at the cost of state. |
| **Saga** | A sequence of operations with compensating actions. Cleanup-on-failure is the local equivalent inside a single process. |
| **Lifecycle manager** | A component that owns the start/stop of other components, often with explicit `Start(ctx)` and `Stop(ctx)` methods. |
| **Cancel cascade** | The propagation of cancel signals down a tree of derived contexts. |
| **Graceful period** | The time window between SIGTERM and forced termination (often controlled by Kubernetes' `terminationGracePeriodSeconds`). |
| **Drain interval** | The time spent allowing in-flight work to finish before closing resources. |
| **Open-coded defer** | A compiler optimisation that inlines defers into the function body. Free in the common case. |
| **Defer pool** | The runtime's per-P pool of `_defer` records for heap-allocated defers. Reduces allocation pressure. |
| **`runtime.deferproc` / `runtime.deferreturn`** | The runtime entry points for heap-allocated defers. The compiler emits calls to these when open-coding is not applicable. |

---

## Core Concepts

### Concept 1: Cleanup as a contract

At the senior level, cleanup is part of every component's *contract*. When you design a new component, you ask:

- What resources does it own?
- What is its `Close`/`Stop`/`Shutdown` method's signature?
- Is it idempotent?
- Does it block until cleanup completes, or return immediately?
- Does it accept a context for deadline control?
- Does it return errors? What kinds?
- Can it be called from a goroutine other than the one that created it?

Codify these decisions. Document them. Test them. The contract is what lets your component compose with others.

A typical senior-level contract:

```go
// Service is a long-lived component.
//
// Lifecycle:
//   - NewService(cfg) creates a new instance.
//   - Start(ctx) begins background work; returns when ready or on failure.
//   - Stop(ctx) initiates shutdown; returns when shutdown is complete or ctx expires.
//
// Stop is idempotent and safe to call from any goroutine.
// Stop returns any errors encountered during shutdown, joined with errors.Join.
// Stop is non-blocking; the actual shutdown work happens in the goroutine that called Start.
type Service struct { /* ... */ }
```

This contract is rigorous enough that any caller can use the service without reading its source.

### Concept 2: The owner-releases rule

A core principle of cleanup design: the goroutine (or component) that *creates* a resource is the one that *releases* it. Passing a resource to another goroutine usually means transferring ownership; the receiver now owns the release.

Violations create ambiguity:

```go
// AMBIGUOUS: who closes f?
func handler(f *os.File) {
    go process(f)
    // does handler close f, or does process?
}
```

Make the contract explicit:

```go
// process owns f; it must close f before returning.
func process(f *os.File) {
    defer f.Close()
    // ...
}
```

In code comments and in API names, encode ownership. `consumes`/`takes ownership of` are useful phrases. The standard library does this: `bufio.NewReader(r)` *uses* `r` but does not own it; `io.MultiReader(rs...)` does not own its inputs; `tar.NewReader(r)` does not own `r`.

### Concept 3: The composition rule for shutdown

Imagine you have three components: A, B, C. A depends on B; B depends on C. Their `Shutdown` order is A → B → C.

Now you compose them into a parent component, S. S's shutdown should *not* re-implement the order — it should delegate:

```go
func (s *S) Shutdown(ctx context.Context) error {
    var errs []error
    if err := s.a.Shutdown(ctx); err != nil { errs = append(errs, err) }
    if err := s.b.Shutdown(ctx); err != nil { errs = append(errs, err) }
    if err := s.c.Shutdown(ctx); err != nil { errs = append(errs, err) }
    return errors.Join(errs...)
}
```

Each component's `Shutdown` is responsible for releasing its own resources, not its dependencies'. This composition keeps the code linear, even as you add more components.

### Concept 4: The shutdown context

Always pass a *fresh* context to shutdown methods, with a *deadline*. Not the cancelled signal context.

```go
// good
shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
defer cancel()
s.Shutdown(shutdownCtx)

// bad: shutdown gets immediately-cancelled context
ctx, _ := signal.NotifyContext(context.Background(), syscall.SIGTERM)
<-ctx.Done()
s.Shutdown(ctx)
```

Why? Because the shutdown context is the budget for *graceful* shutdown — the window during which we try to drain in-flight work. The signal context is *already cancelled* by the time you're shutting down. Using it would tell every component "you have zero time to drain."

Some components, like `http.Server.Shutdown`, treat a cancelled context as "abort immediately, drop in-flight requests." Others might block forever waiting for non-cancellable work. Either way, give them a fresh deadline.

### Concept 5: Cleanup that survives panics

In Go, a panic propagates up the goroutine's call stack, running deferred calls. An unrecovered panic terminates the program — including all other goroutines. For long-running services, this is too brittle. Senior design wraps every goroutine in a top-level recover:

```go
func supervise(name string, run func() error) error {
    defer func() {
        if r := recover(); r != nil {
            slog.Error("panic", "worker", name, "value", r, "stack", debug.Stack())
        }
    }()
    return run()
}

go func() {
    for {
        if err := supervise("worker-1", workerLoop); err != nil {
            slog.Error("worker exited", "err", err)
        }
        // optionally restart, or exit
    }
}()
```

The recover catches anything the worker panics on, including panics from the worker's own deferred cleanups. Without this, a single panic in any defer can kill the process.

But beware: recover catches the *first* panic in flight. If the deferred cleanup itself panics, the recover catches *its* panic, losing the original. For diagnostic purposes, log both:

```go
defer func() {
    if r := recover(); r != nil {
        slog.Error("recovered", "value", r, "stack", debug.Stack())
    }
}()

defer func() {
    if err := closer.Close(); err != nil {
        slog.Error("close failed", "err", err)
    }
}()
```

These two defers are independent. If `closer.Close` panics, the recover catches it. The order matters: the recover must be registered *first* (so it pops last, after the close).

### Concept 6: Choreographed shutdown across goroutines

Real services have many goroutines: HTTP handlers, worker pools, background timers, leader-election heartbeats, metric flushers. Each has its own lifecycle. Coordinating their shutdown is a design problem, not a code problem.

The standard pattern is:

1. **Signal.** A SIGTERM closes the root context.
2. **Propagate.** Components observe the closed context via their own derived contexts.
3. **Drain.** Each component stops accepting new work; finishes in-flight; signals done.
4. **Wait.** A central coordinator (`wg.Wait`) blocks until every component has signalled done.
5. **Close.** Resources are released in dependency order.

The senior-level question is: where does the coordinator live, and how does it know about every component?

Two approaches:

- **Hierarchical.** A top-level `Service` owns sub-components. Each sub-component has its own internal coordinator. The top-level's `Shutdown` calls each sub-component's `Shutdown` in order. Errors propagate up.
- **Flat registry.** A `LifecycleManager` knows about every component. Components register themselves at startup. The manager's `Shutdown` runs them in LIFO of registration. Simpler but less type-safe.

Both work. Choose based on your codebase's culture.

### Concept 7: `AfterFunc` at scale

For services with thousands of contexts, `AfterFunc` has performance implications.

- Each registration allocates a small struct and adds to the context's callback list.
- On cancel, each callback starts a new goroutine.
- Long-lived parent contexts accumulate callbacks; if you register without calling `stop`, they linger until the parent dies.

Senior-level use:

- Register `AfterFunc` only when you need its specific semantics (cleanup that outlives the function).
- Always call `stop()` (via defer) when you no longer need the callback.
- For high-frequency cancellation, profile: AfterFunc startup can dominate.
- Consider a single AfterFunc that fans out to many cleanups, rather than many AfterFuncs.

### Concept 8: The role of `runtime.SetFinalizer`

Finalizers run when an object is garbage-collected. They are *not* a replacement for `Close`. Their proper use:

- **Debugging aid.** Set a finalizer that panics if `Close` was not called. Catches missing-close bugs in tests. *Remove* the finalizer in production code (it has GC cost and can mask bugs).
- **Last-resort safety net.** For libraries with a long history of users forgetting to close. The Go standard library uses finalizers on `*os.File` to close the file descriptor at GC time if `Close` was forgotten. This prevents FD leaks but is not a substitute for the user calling `Close`.

The big caveat: finalizers run at unpredictable times during GC. They cannot reliably run cleanup that has timing constraints (e.g., flushing a buffer before the program exits).

---

## Real-World Analogies

### Decommissioning a power plant

Closing a power plant is a multi-week choreographed shutdown. Steps run in dependency order: stop generating electricity (signal), let the turbines spin down (drain), cool the reactor (close in stages). Skipping a step can cause physical damage. Software shutdown lacks the physical risk but otherwise mirrors the discipline.

### Closing down a hospital wing

A hospital wing closes in phases: stop admitting patients (cancel), transfer current patients (drain), shut down equipment in inverse dependency order (close — life support last, decorative lights first). A service's shutdown has the same phases. The patients are in-flight requests.

### A symphony's coda

The end of a symphony is choreographed: instruments fade in reverse of how they entered. The conductor cues each section to stop. A senior engineer designs shutdown the same way: each component takes its cue at the right moment.

### A research lab closing for the holidays

The lab does not just turn off the lights. Equipment is parked, samples are stored, the freezer is checked, the lab notebook is closed. The order is dictated by what depends on what: samples *before* freezer power, notebook *before* lights. Service shutdown is the lab closing — every component has its parking procedure.

---

## Mental Models

### Model 1: The dependency DAG

Every component in your service depends on zero or more others. Drawing the DAG (directed acyclic graph) makes the release order obvious: topological sort, with most-dependent first.

```
        ┌────────────────┐
        │   HTTP server  │  most dependent
        └─────┬──────────┘
              │
        ┌─────▼──────────┐
        │   handler      │
        └─────┬──────────┘
              │
   ┌──────────┼─────────┐
   │          │         │
┌──▼───┐ ┌────▼──┐ ┌────▼──┐
│  db  │ │ cache │ │ queue │
└──┬───┘ └────┬──┘ └────┬──┘
   │          │         │
   └─────┬────┴─────────┘
         │
    ┌────▼───────────┐
    │ logger / metrics │  least dependent
    └─────────────────┘

Release order: HTTP → handler → db/cache/queue → logger/metrics
```

In a real service, the DAG has many more nodes. The principle scales.

### Model 2: Phases and gates

Imagine shutdown as a series of *gates*. Each gate has a deadline. Components must pass through their gate within the deadline; if they do not, they are forcefully closed.

```
Gate 1: Stop accepting new work    (deadline: instant)
Gate 2: Drain in-flight work       (deadline: 25s)
Gate 3: Close stateful resources   (deadline: 5s)
```

If a component fails to pass gate 2 by its deadline, the orchestrator moves on. Resources leak, but the service shuts down. The cost of the leak is bounded; the cost of hanging is not.

### Model 3: A finite state machine per component

Each component has a state machine:

```
created ──[Start]──► running ──[Stop signal]──► draining ──[done]──► stopped
                         │                          │
                         └──[panic]──► crashed      └──[timeout]──► force-stopped
```

The senior engineer designs the state machine deliberately. Each transition has a contract. The cleanup runs at one specific transition (running → draining → stopped). Other transitions (crash, force-stop) have their own cleanup paths.

### Model 4: Cleanup as a tree, not a list

Defers form a stack (LIFO), but a multi-component service has a *tree* of cleanups: each component owns a sub-tree. The top-level shutdown traverses the tree post-order: visit children first, then visit the node.

```
root.Shutdown:
   for each child:
      child.Shutdown      // post-order: children first
   close my own resources // then myself
```

The tree's shape mirrors the component hierarchy. The traversal is post-order. The result is correct release order without any centralised list.

### Model 5: Cleanup as transactional rollback

Every operation a component does can be paired with a compensating operation that undoes it. Cleanup is the *suffix* of compensating operations for all completed steps. Defer's LIFO order naturally implements this: each defer is the compensating action for the work that preceded it.

For systems that span processes (distributed sagas), the same principle applies at a larger scale. Within a single process, defers and `AfterFunc` are the local saga compensators.

---

## Pros & Cons

### Pros of design-level cleanup discipline

- **Predictable shutdown.** A service that shuts down in 30 seconds every time is operationally sound. One that sometimes hangs is not.
- **No leaks.** Goroutines, FDs, connections, all released. Long-running services do not slowly degrade.
- **Easier debugging.** When something goes wrong, you know the shutdown order. You can find the offending component.
- **Composability.** New components plug into the existing recipe. No surprises.
- **SLO-friendly.** Bounded shutdown time. Bounded request loss. Bounded data loss.

### Cons of strict cleanup design

- **More code.** Each component has Start, Stop, doc comments, tests. More lines than a "just leak it" approach.
- **More state.** Each component tracks its lifecycle. Bugs in the state machine are real.
- **Harder to test.** Lifecycle tests are inherently slower than unit tests (they involve actual start/stop). They are still essential.
- **Cognitive load.** Junior engineers may not immediately grasp why every component needs the same structure. Education and consistency help.

The cost is worth paying for any service that runs for more than a few minutes at a time.

---

## Use Cases

Senior-level cleanup ordering applies whenever:

- Your service has more than a handful of components.
- Components have dependency relationships.
- The service must shut down gracefully under SIGTERM.
- The service has SLOs around shutdown time or request loss.
- The service runs in Kubernetes / a managed environment with a `terminationGracePeriod`.
- The service has long-lived state (caches, queues, connections) that needs explicit close.
- You have on-call rotations and want shutdown logs to be diagnostic.

If your service is a five-minute batch job that exits cleanly, you do not need this level of design. If it is a production service that runs for weeks, you do.

---

## Code Examples

### Example 1: A LifecycleManager

```go
package lifecycle

import (
    "context"
    "errors"
    "fmt"
    "sync"
)

type Component interface {
    Name() string
    Start(ctx context.Context) error
    Stop(ctx context.Context) error
}

type Manager struct {
    mu         sync.Mutex
    components []Component
    started    bool
}

func (m *Manager) Add(c Component) {
    m.mu.Lock()
    defer m.mu.Unlock()
    if m.started {
        panic("cannot add after Start")
    }
    m.components = append(m.components, c)
}

func (m *Manager) Start(ctx context.Context) error {
    m.mu.Lock()
    m.started = true
    components := m.components
    m.mu.Unlock()

    for i, c := range components {
        if err := c.Start(ctx); err != nil {
            // unwind already-started components
            stopCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
            defer cancel()
            for j := i - 1; j >= 0; j-- {
                _ = components[j].Stop(stopCtx)
            }
            return fmt.Errorf("start %s: %w", c.Name(), err)
        }
    }
    return nil
}

func (m *Manager) Stop(ctx context.Context) error {
    m.mu.Lock()
    components := m.components
    m.mu.Unlock()

    var errs []error
    for i := len(components) - 1; i >= 0; i-- {
        if err := components[i].Stop(ctx); err != nil {
            errs = append(errs, fmt.Errorf("stop %s: %w", components[i].Name(), err))
        }
    }
    return errors.Join(errs...)
}
```

This is a complete, generic lifecycle manager. Components register; Start runs them in order; on partial failure, unwinds in reverse; Stop runs them in reverse of registration. `errors.Join` accumulates failures.

In a real service, you would extend it: parallel start where possible, configurable timeouts per component, instrumentation, etc.

### Example 2: A panic-safe goroutine launcher

```go
package supervisor

import (
    "context"
    "fmt"
    "log/slog"
    "runtime/debug"
)

func Go(ctx context.Context, name string, run func(context.Context) error) <-chan error {
    done := make(chan error, 1)
    go func() {
        defer close(done)
        defer func() {
            if r := recover(); r != nil {
                slog.Error("goroutine panic",
                    "name", name,
                    "value", r,
                    "stack", string(debug.Stack()))
                done <- fmt.Errorf("%s: panic: %v", name, r)
            }
        }()
        if err := run(ctx); err != nil {
            done <- fmt.Errorf("%s: %w", name, err)
        }
    }()
    return done
}
```

A spawned goroutine that:
- Logs and converts panics into errors
- Closes its done channel on exit (so callers can `select`)
- Carries the goroutine's name in error wrapping for diagnostics

A real supervisor would add restart-on-error, exponential backoff, jittered retries. The structure above is the foundation.

### Example 3: Parallel shutdown with `errgroup`

```go
package main

import (
    "context"
    "fmt"
    "time"

    "golang.org/x/sync/errgroup"
)

type Closer interface {
    Close(ctx context.Context) error
}

func parallelShutdown(ctx context.Context, closers []Closer) error {
    g, ctx := errgroup.WithContext(ctx)
    for _, c := range closers {
        c := c
        g.Go(func() error { return c.Close(ctx) })
    }
    return g.Wait()
}

type fakeCloser struct {
    name string
    d    time.Duration
}

func (f *fakeCloser) Close(ctx context.Context) error {
    select {
    case <-time.After(f.d):
        fmt.Println("closed", f.name)
        return nil
    case <-ctx.Done():
        return fmt.Errorf("%s: %w", f.name, ctx.Err())
    }
}

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
    defer cancel()
    closers := []Closer{
        &fakeCloser{name: "a", d: 30 * time.Millisecond},
        &fakeCloser{name: "b", d: 50 * time.Millisecond},
        &fakeCloser{name: "c", d: 200 * time.Millisecond},
    }
    if err := parallelShutdown(ctx, closers); err != nil {
        fmt.Println("error:", err)
    }
}
```

When components do not depend on each other, parallel shutdown saves time. The errgroup cancels the context on first error and waits for all. `c` is the only one that times out.

Note: parallel shutdown is only safe for *independent* components. If `a` depends on `b`, sequential shutdown is required.

### Example 4: A component with full lifecycle

```go
package worker

import (
    "context"
    "errors"
    "fmt"
    "sync"
)

type Worker struct {
    name    string
    in      chan string
    done    chan struct{}
    cancel  context.CancelFunc
    wg      sync.WaitGroup
    once    sync.Once
    stopErr error
}

func New(name string, buffer int) *Worker {
    return &Worker{
        name: name,
        in:   make(chan string, buffer),
        done: make(chan struct{}),
    }
}

func (w *Worker) Name() string { return w.name }

func (w *Worker) Start(ctx context.Context) error {
    ctx, cancel := context.WithCancel(ctx)
    w.cancel = cancel
    w.wg.Add(1)
    go w.loop(ctx)
    return nil
}

func (w *Worker) loop(ctx context.Context) {
    defer w.wg.Done()
    defer close(w.done)
    for {
        select {
        case <-ctx.Done():
            // drain
            for {
                select {
                case m := <-w.in:
                    fmt.Println(w.name, "drain:", m)
                default:
                    return
                }
            }
        case m := <-w.in:
            fmt.Println(w.name, "process:", m)
        }
    }
}

func (w *Worker) Submit(s string) error {
    select {
    case w.in <- s:
        return nil
    case <-w.done:
        return errors.New("worker stopped")
    }
}

func (w *Worker) Stop(ctx context.Context) error {
    w.once.Do(func() {
        w.cancel()
        select {
        case <-w.done:
            w.stopErr = nil
        case <-ctx.Done():
            w.stopErr = fmt.Errorf("%s: %w", w.name, ctx.Err())
        }
    })
    return w.stopErr
}
```

A full-featured worker:
- Idempotent `Stop` via `sync.Once`
- Honors the shutdown context's deadline
- Drains in-flight work on cancel
- `Submit` fails after stop (channel send would otherwise block forever)
- Records the stop error for repeated `Stop` calls to return

This is what a senior-level component looks like. Every behaviour is intentional.

### Example 5: Wiring components into a service

```go
package main

import (
    "context"
    "fmt"
    "os"
    "os/signal"
    "syscall"
    "time"

    "myapp/lifecycle"
    "myapp/worker"
)

func main() {
    ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
    defer stop()

    var m lifecycle.Manager
    m.Add(worker.New("worker-1", 10))
    m.Add(worker.New("worker-2", 10))
    m.Add(worker.New("worker-3", 10))

    startCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
    defer cancel()
    if err := m.Start(startCtx); err != nil {
        fmt.Println("start failed:", err)
        os.Exit(1)
    }

    <-ctx.Done()
    fmt.Println("shutdown signal")

    stopCtx, cancel2 := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel2()
    if err := m.Stop(stopCtx); err != nil {
        fmt.Println("stop errors:", err)
    } else {
        fmt.Println("clean shutdown")
    }
}
```

`main` is short. It wires components into the manager, starts, waits for SIGTERM, stops. Adding a new component is one `m.Add` call. The cleanup ordering is encoded in the manager, not in main.

### Example 6: A test that validates shutdown

```go
package worker_test

import (
    "context"
    "runtime"
    "testing"
    "time"

    "myapp/worker"
)

func TestWorkerCleanShutdown(t *testing.T) {
    before := runtime.NumGoroutine()

    w := worker.New("test", 10)
    if err := w.Start(context.Background()); err != nil {
        t.Fatal(err)
    }
    for i := 0; i < 10; i++ {
        w.Submit("item")
    }

    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()
    if err := w.Stop(ctx); err != nil {
        t.Fatal(err)
    }

    time.Sleep(10 * time.Millisecond) // give the runtime a moment

    after := runtime.NumGoroutine()
    if after > before {
        t.Errorf("goroutine leak: before=%d after=%d", before, after)
    }
}
```

The test asserts that after `Stop`, the goroutine count returns to baseline. A worker that leaks fails the test. CI catches it. This kind of test is non-negotiable for production components.

### Example 7: AfterFunc-driven cleanup with proper synchronisation

```go
package main

import (
    "context"
    "fmt"
    "sync"
    "time"
)

type Connection struct {
    closed chan struct{}
    once   sync.Once
}

func NewConnection() *Connection {
    return &Connection{closed: make(chan struct{})}
}

func (c *Connection) Close() {
    c.once.Do(func() { close(c.closed) })
}

func (c *Connection) IsClosed() bool {
    select {
    case <-c.closed:
        return true
    default:
        return false
    }
}

func use(ctx context.Context, conn *Connection) {
    cleanupDone := make(chan struct{})
    stop := context.AfterFunc(ctx, func() {
        defer close(cleanupDone)
        fmt.Println("cleanup: closing connection")
        conn.Close()
    })
    defer func() {
        if stop() {
            // the AfterFunc was deregistered before firing
            close(cleanupDone)
        }
        <-cleanupDone // wait for cleanup to finish, either way
    }()

    select {
    case <-time.After(100 * time.Millisecond):
        fmt.Println("work completed")
    case <-ctx.Done():
        fmt.Println("work cancelled")
    }
}

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
    defer cancel()
    conn := NewConnection()
    use(ctx, conn)
    fmt.Println("conn closed?", conn.IsClosed())
}
```

This example shows the careful dance to wait for the AfterFunc callback. The deferred `stop()` returns true if the callback never ran (so we close `cleanupDone` ourselves). Otherwise the callback closes it. Either way, `<-cleanupDone` synchronises before the function returns. This is the canonical pattern when you need both *cleanup-on-cancel* and *cleanup-is-complete-before-return*.

### Example 8: A staged shutdown coordinator

```go
package main

import (
    "context"
    "errors"
    "fmt"
    "log/slog"
    "time"
)

type Stage struct {
    Name string
    Run  func(ctx context.Context) error
}

type Coordinator struct {
    stages []Stage
}

func (c *Coordinator) Stage(name string, run func(ctx context.Context) error) {
    c.stages = append(c.stages, Stage{Name: name, Run: run})
}

func (c *Coordinator) Shutdown(ctx context.Context) error {
    var errs []error
    for _, s := range c.stages {
        start := time.Now()
        if err := s.Run(ctx); err != nil {
            slog.Error("stage failed", "stage", s.Name, "elapsed", time.Since(start), "err", err)
            errs = append(errs, fmt.Errorf("%s: %w", s.Name, err))
        } else {
            slog.Info("stage done", "stage", s.Name, "elapsed", time.Since(start))
        }
    }
    return errors.Join(errs...)
}

func main() {
    var c Coordinator
    c.Stage("stop-listener", func(ctx context.Context) error { time.Sleep(10 * time.Millisecond); return nil })
    c.Stage("drain-requests", func(ctx context.Context) error { time.Sleep(50 * time.Millisecond); return nil })
    c.Stage("close-db", func(ctx context.Context) error { time.Sleep(20 * time.Millisecond); return nil })
    c.Stage("flush-tracer", func(ctx context.Context) error { time.Sleep(15 * time.Millisecond); return nil })

    ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
    defer cancel()
    if err := c.Shutdown(ctx); err != nil {
        fmt.Println("errors:", err)
    } else {
        fmt.Println("clean")
    }
}
```

A simple staged coordinator. Each stage is named and timed. Logs go to slog. Errors are joined. The shutdown context is shared across all stages — if it expires mid-stage, the stage's `Run` should observe and abort.

### Example 9: Cleanup with `context.WithCancelCause` for error reporting

```go
package main

import (
    "context"
    "errors"
    "fmt"
)

var (
    errDiskFull = errors.New("disk full")
    errAborted  = errors.New("user aborted")
)

func work(ctx context.Context) error {
    select {
    case <-ctx.Done():
        cause := context.Cause(ctx)
        switch {
        case errors.Is(cause, errDiskFull):
            return fmt.Errorf("cleanup: disk-full path: %w", cause)
        case errors.Is(cause, errAborted):
            return fmt.Errorf("cleanup: abort path: %w", cause)
        default:
            return fmt.Errorf("cleanup: generic: %w", ctx.Err())
        }
    }
}

func main() {
    ctx, cancel := context.WithCancelCause(context.Background())
    go func() { cancel(errDiskFull) }()
    fmt.Println(work(ctx))
}
```

The cleanup branches on the *cause* of cancellation. Different cleanup paths for different errors. Without `WithCancelCause`, you would lose this information after cancel.

### Example 10: A `Service` type with all the trimmings

```go
package main

import (
    "context"
    "errors"
    "fmt"
    "log/slog"
    "sync"
    "time"
)

type Service struct {
    name    string
    mu      sync.Mutex
    started bool
    stopped bool
    stopOnce sync.Once
    stopErr  error
    cancel   context.CancelFunc
    done     chan struct{}
}

func New(name string) *Service { return &Service{name: name, done: make(chan struct{})} }

func (s *Service) Name() string { return s.name }

func (s *Service) Start(ctx context.Context) error {
    s.mu.Lock()
    defer s.mu.Unlock()
    if s.started {
        return errors.New("already started")
    }
    s.started = true
    ctx, cancel := context.WithCancel(ctx)
    s.cancel = cancel
    go s.run(ctx)
    return nil
}

func (s *Service) run(ctx context.Context) {
    defer close(s.done)
    defer func() {
        if r := recover(); r != nil {
            slog.Error("service panic", "name", s.name, "value", r)
        }
    }()

    t := time.NewTicker(50 * time.Millisecond)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            slog.Info("service stopping", "name", s.name)
            return
        case <-t.C:
            // do periodic work
        }
    }
}

func (s *Service) Stop(ctx context.Context) error {
    s.stopOnce.Do(func() {
        s.mu.Lock()
        if !s.started {
            s.mu.Unlock()
            s.stopErr = errors.New("not started")
            return
        }
        cancel := s.cancel
        s.stopped = true
        s.mu.Unlock()

        cancel()
        select {
        case <-s.done:
        case <-ctx.Done():
            s.stopErr = fmt.Errorf("%s: timeout: %w", s.name, ctx.Err())
        }
    })
    return s.stopErr
}

func main() {
    s := New("test")
    if err := s.Start(context.Background()); err != nil {
        fmt.Println(err); return
    }
    time.Sleep(120 * time.Millisecond)
    ctx, cancel := context.WithTimeout(context.Background(), time.Second)
    defer cancel()
    if err := s.Stop(ctx); err != nil {
        fmt.Println(err); return
    }
    fmt.Println("clean")
    // double-stop is safe and returns the same result
    if err := s.Stop(ctx); err != nil {
        fmt.Println("second stop:", err)
    }
}
```

Every behaviour is deliberate:
- `Start` is one-shot (returns error on second call).
- `Stop` is idempotent via `sync.Once`; subsequent calls return the cached `stopErr`.
- `run` has a top-level recover for panic safety.
- The ticker is properly stopped via defer.
- Stop honors the shutdown context's deadline.

This is the senior-level template. Copy it. Modify it for your specific component. The structure is the contract.

---

## Architecture Patterns

### Pattern 1: Hierarchical component tree

Services are trees of components. Each component has children. Shutdown is post-order traversal of the tree.

```
Service (root)
├── HTTP Server
│   └── Handler
│       ├── AuthMiddleware
│       └── RateLimitMiddleware
├── WorkerPool
│   └── Worker [×N]
└── Infrastructure
    ├── Database
    ├── Cache
    ├── Logger
    └── Metrics
```

Each node's `Shutdown` calls `Shutdown` on its children (post-order), then releases its own resources. The root's `Shutdown` triggers the whole tree.

Implementation: each component owns a slice of child components and a `Shutdown(ctx)` method that iterates them. No central registry needed.

### Pattern 2: Flat registry

Alternative to the tree: every component registers itself with a central manager. The manager owns the shutdown order.

```
Manager.Register(component)
Manager.Shutdown(ctx) → run all components in LIFO of registration
```

Simpler than the tree. Harder to enforce dependency order: components must register in the right order (which is, conveniently, the order they are created if you wire dependencies before registering).

### Pattern 3: Two-phase shutdown

Phase 1: signal-only. All components get a "prepare to shut down" call. They stop accepting new work. They drain in-flight.

Phase 2: close. All components get a "close" call. They release resources.

This pattern separates "stop work" from "release resources." Useful when work-stopping is fast but release is slow, or when you want all components to stop *together* before any begins to close.

```go
for _, c := range components { c.Drain(ctx) }
for _, c := range components { c.Close(ctx) }
```

### Pattern 4: Per-component supervisor

Each component is supervised by a goroutine that restarts it on crash. The supervisor itself has a shutdown method that stops restarting.

```go
type Supervisor struct {
    create func() Runnable
    cancel context.CancelFunc
    done   chan struct{}
}

func (s *Supervisor) Run(ctx context.Context) {
    ctx, s.cancel = context.WithCancel(ctx)
    defer close(s.done)
    for {
        r := s.create()
        if err := r.Run(ctx); err != nil {
            if errors.Is(err, context.Canceled) {
                return
            }
            slog.Error("supervised crashed; restarting", "err", err)
        }
    }
}

func (s *Supervisor) Stop(ctx context.Context) error {
    s.cancel()
    select {
    case <-s.done:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

The supervisor's Run loop creates a new Runnable on each iteration, runs it, and either returns (on context cancel) or restarts (on any other error). Stop cancels the context.

### Pattern 5: Cleanup as event handlers

Treat cleanup as event-driven. Components register handlers for events like "context cancelled" or "service shutting down." A dispatcher fires them in order.

```go
type Dispatcher struct {
    handlers []func()
}

func (d *Dispatcher) On(event Event, fn func()) {
    d.handlers = append(d.handlers, fn)
}

func (d *Dispatcher) Emit() {
    for i := len(d.handlers) - 1; i >= 0; i-- {
        d.handlers[i]()
    }
}
```

Similar to `context.AfterFunc` but allows multiple events and explicit ordering.

### Pattern 6: Cleanup co-located with acquisition

Each acquisition site immediately registers its cleanup. The cleanup may be a defer, an AfterFunc, or a registration with a manager.

```go
func openDB(ctx context.Context, mgr *Manager) *DB {
    db := connect()
    mgr.Register("db", func(ctx context.Context) error { return db.Close() })
    return db
}
```

The caller does not need to remember to close. The manager owns the order.

This is sometimes called "resource scoping." It is the senior-level evolution of `defer Close()` — same locality, but cross-scope.

### Pattern 7: Tree of contexts mirrors tree of components

Each component has its own context, derived from its parent. Cancellation flows top-down via the context tree. Cleanup flows bottom-up via the component tree.

```
ctx (root)
├── ctx-http
│   └── ctx-handler
└── ctx-workers
    ├── ctx-worker-1
    ├── ctx-worker-2
```

When `ctx` is cancelled, all descendants are too. Each component watches its own context and reacts. Cleanup runs in each component's own `Stop` method.

---

## Clean Code

### 1. One responsibility per Stop method

A `Stop` that does ten things is hard to test and hard to debug. Each component's `Stop` does its own cleanup. Composition does the rest.

### 2. Explicit ordering in code, not in implicit defer

When ordering matters for correctness, write it explicitly. Do not rely on the reader to count defers and unwind them mentally. A four-line block with named steps reads better than four defers.

```go
// good: explicit
if err := server.Stop(ctx); err != nil { errs = append(errs, err) }
if err := workers.Stop(ctx); err != nil { errs = append(errs, err) }
if err := db.Close(); err != nil { errs = append(errs, err) }
```

vs

```go
// fine for one function, but not for a 30-step shutdown
defer db.Close()
defer workers.Stop(ctx)
defer server.Stop(ctx)
```

The former is more maintainable at scale.

### 3. Document the shutdown order

Every service's main.go or its lifecycle manager should have a comment that lists the shutdown order and the reasoning.

### 4. Single source of truth for graceful period

Define a single constant or config value for "how long do we allow for graceful shutdown?" Reference it from every component. Avoid a maze of magic numbers.

### 5. Tests are part of the contract

Every component with a `Stop` method should have at least one test that asserts:
- After Stop, no goroutines leak.
- After Stop, repeat Stop is safe and returns the same error.
- Stop honors its context deadline.

These tests are non-negotiable for production.

---

## Production Considerations

### Kubernetes and `terminationGracePeriodSeconds`

Kubernetes sends SIGTERM to your pod, then waits for `terminationGracePeriodSeconds` (default 30s) before SIGKILL. Your shutdown SLO must fit inside that window — minus some margin for the kubelet's own work.

A typical setup:
- `terminationGracePeriodSeconds: 60`
- Graceful shutdown budget: 30s
- Margin: 30s

The 30s budget is wired into the shutdown context's timeout. If your shutdown takes longer, you get SIGKILL'd and lose state.

### Health-check coordination

When SIGTERM arrives:
1. Mark the service as "not ready" (so Kubernetes stops routing traffic).
2. Wait a short period (5s) for the load balancer to notice.
3. Begin actual shutdown.

Step 1 is a common mistake: people skip it and lose requests during the "in-flight" window.

### Logs during shutdown

Shutdown is the period when ops engineers most need clear logs. Every component should log:
- Start of its Stop
- End of its Stop
- Any errors

Use `slog` with structured fields: component name, elapsed time, error.

### Metrics during shutdown

Emit metrics:
- `shutdown_duration_seconds{component="db"}`
- `shutdown_errors_total{component="db"}`
- `shutdown_inflight_at_signal{}`

These metrics let you tune the graceful period over time.

### Crash dump on cleanup failure

If shutdown fails (timeout or error), consider writing a crash dump (`runtime.Stack`) before exiting. Lets you diagnose stuck shutdowns post-mortem.

### Replayable shutdown tests

In CI, run a "soak test" that starts the service, sends some load, sends SIGTERM, and asserts:
- Service exited within the graceful period.
- No request loss.
- All resources released (check FDs with `/proc/PID/fd` or equivalent).

These tests catch regressions that unit tests miss.

---

## Error Handling

### Error categories in cleanup

- **Recoverable.** A retry, even within the same shutdown, might succeed. Use `retry.Do` with backoff.
- **Fatal-for-this-component.** This component cannot shut down cleanly. Log and move on.
- **Fatal-for-shutdown.** A component crucial for the rest of shutdown failed. Skip the rest, log loudly, exit non-zero.

In practice, most cleanup errors are category 2: log and move on. Avoid category 1 (retries during shutdown burn the time budget). Category 3 is rare but important.

### Error wrapping

Always wrap shutdown errors with the component name:

```go
return fmt.Errorf("shutdown %s: %w", c.Name(), err)
```

The caller can `errors.Is` the underlying cause and still see which component failed.

### `errors.Join` for multi-component shutdown

When shutdown of multiple components produces multiple errors, join them:

```go
var errs []error
for _, c := range components {
    if err := c.Stop(ctx); err != nil {
        errs = append(errs, err)
    }
}
return errors.Join(errs...)
```

The caller can iterate the joined error with a custom function, or call `errors.Is` to check for specific causes.

### Panic during shutdown

A panic in a Stop method must not crash the entire shutdown. Wrap each Stop call:

```go
func safeStop(c Component, ctx context.Context) (err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("stop %s: panic: %v", c.Name(), r)
        }
    }()
    return c.Stop(ctx)
}
```

Then iterate components calling `safeStop`. The panic is converted to an error; shutdown continues.

---

## Security Considerations

### Audit logs at shutdown

Log every shutdown event with timestamps. Ops teams use these to investigate "service went down at 14:32 UTC" reports.

### Secret zeroing

If a service holds secrets in memory, zero them during shutdown:

```go
func (s *Service) Stop(ctx context.Context) error {
    defer s.zeroSecrets()
    // ... usual shutdown ...
}

func (s *Service) zeroSecrets() {
    for i := range s.apiKeys {
        for j := range s.apiKeys[i] {
            s.apiKeys[i][j] = 0
        }
    }
}
```

Why? In case the process is core-dumped or its memory is inspected after exit. Defense in depth.

### Sensitive cleanup blocks

Some cleanup must run regardless of panics. Use `defer` inside a `defer recover` to ensure it runs:

```go
defer func() {
    defer s.eraseSecrets() // outer defer; runs even if inner panics
    if r := recover(); r != nil {
        slog.Error("recover", "value", r)
    }
}()
```

The `eraseSecrets` is the outermost guard; it runs after the recover handles any panic.

### Shutdown as an attack surface

A poorly-designed shutdown can be a denial-of-service vector. If an attacker can trigger SIGTERM (e.g., via a control endpoint), they can take the service down. Restrict shutdown signals to trusted sources. Use signed control plane requests if cluster orchestration is not enough.

### Half-open connections

During the drain phase, connections that are in-flight may be left in an inconsistent state if the peer is malicious (e.g., never sends end-of-request). Use deadlines aggressively: every in-flight read/write should have one.

---

## Performance Engineering

### Defer cost at scale

Open-coded defers are nearly free (Go ≥ 1.14). Heap-allocated defers cost a small allocation (~64 bytes) and a linked-list traversal. For most services, the cost is negligible.

If profiling shows defer cost as significant:
- Make sure the compiler is open-coding (no defers in loops, ≤ 8 defers per function).
- Move defers out of inner loops.
- Use manual cleanup if absolutely necessary.

### AfterFunc cost

Each AfterFunc registration is a small struct allocation and an atomic operation. The callback firing is one goroutine creation. Cost: a few μs.

For services that create thousands of contexts per second, profile. If AfterFunc dominates, batch cleanups: one AfterFunc per context that fans out to multiple cleanup actions.

### Goroutine cost during shutdown

Cancel-storm scenarios (10,000 contexts cancelled at once) can spawn 10,000 AfterFunc goroutines. If each does I/O, the system can fall over.

Options:
- Use a worker pool for cleanup work (the AfterFunc just enqueues into a channel).
- Rate-limit cleanup operations.
- Coalesce cleanups: one AfterFunc on the parent context, not per-child.

### Memory churn during shutdown

A graceful shutdown that allocates aggressively (e.g., for error wrapping) can hit the GC at the wrong moment. Pre-allocate shutdown buffers when possible. Avoid expensive operations during shutdown.

### Lock contention during shutdown

Components that hold a global lock and try to release it during shutdown can serialise everything. Profile lock contention; reduce critical sections; consider per-shard locks for components that need them.

### Profiling shutdown

Use `runtime/pprof` to profile the shutdown sequence in test environments. The shutdown profile is different from steady-state — different code paths, different allocations. Treat it as its own performance target.

---

## Best Practices

- **One Stop method per component, with a well-defined contract.**
- **Idempotent Stop via `sync.Once`.**
- **Pass a shutdown context with a deadline, not the cancelled trigger context.**
- **Document the shutdown order explicitly.**
- **Test shutdown paths in CI (goroutine leak assertions, soak tests).**
- **Use `errors.Join` to surface all cleanup failures.**
- **Wrap each Stop call with panic recovery during multi-component shutdown.**
- **Log structured shutdown events (slog with component name and elapsed time).**
- **Emit shutdown metrics for ops tuning.**
- **Mark the service as not-ready before beginning shutdown.**
- **Coordinate with Kubernetes' terminationGracePeriodSeconds.**
- **Use `signal.NotifyContext` for SIGTERM handling.**
- **Use `context.AfterFunc` only when defer cannot do the job.**
- **Compose components hierarchically; let each manage its children.**

---

## Edge Cases & Pitfalls

### Pitfall 1: Components that ignore the shutdown context

If your component's Stop method does work that does not respect the passed context, the deadline is meaningless. Always plumb the context through every blocking operation.

### Pitfall 2: Cyclic shutdown dependencies

A depends on B; B depends on A. Cannot shut down either first. Either break the cycle (refactor) or use a two-phase shutdown.

### Pitfall 3: Goroutines spawned during shutdown

A component that spawns a goroutine *during* its Stop method needs to wait for that goroutine before returning. Otherwise the goroutine outlives the shutdown.

### Pitfall 4: Stop called before Start

Common in tests. Decide your contract: error, no-op, or panic. Document it.

### Pitfall 5: Two callers to Stop simultaneously

If Stop is not designed for concurrent invocation, two callers can race. Use `sync.Once` to make it safe.

### Pitfall 6: Late-arriving SIGTERM during shutdown

If the user presses Ctrl-C twice, you get two SIGINTs. The first triggers graceful shutdown; the second should force exit. `signal.NotifyContext` does not handle this directly; build your own:

```go
sigs := make(chan os.Signal, 1)
signal.Notify(sigs, syscall.SIGINT, syscall.SIGTERM)

<-sigs
slog.Info("graceful shutdown")
go func() {
    <-sigs
    slog.Warn("forced exit")
    os.Exit(1)
}()

// proceed with graceful shutdown
```

### Pitfall 7: AfterFunc registered on a long-lived context

Each registration accumulates. Long-lived parent contexts can hold thousands of callbacks. Always call `stop()` when no longer needed.

### Pitfall 8: Recursive Stop calls

A component's Stop that internally calls `parent.Stop` (which then calls `child.Stop` again) creates a recursion. Use the `sync.Once` to break the cycle.

### Pitfall 9: Shutdown that depends on external services

If your shutdown calls an external API (e.g., deregister from a service registry), it might hang. Wrap with a deadline. Failure to deregister is usually acceptable; failure to shut down is not.

### Pitfall 10: Test setup leaks

Tests that start components but do not stop them leak goroutines. Use `t.Cleanup(func() { svc.Stop(ctx) })` to ensure cleanup. The goroutine leak detector catches the rest.

---

## Common Mistakes

### Mistake 1: Re-using the signal context for shutdown

```go
// BUG
ctx, _ := signal.NotifyContext(context.Background(), syscall.SIGTERM)
<-ctx.Done()
service.Stop(ctx) // ctx is already cancelled!
```

The context is cancelled by SIGTERM. Passing it to Stop means "you have zero time." Use a fresh context with a deadline.

### Mistake 2: Forgetting to call Stop on sub-components

A composite component owns sub-components. Its Stop must call each sub's Stop. Easy to forget when adding a new sub.

### Mistake 3: Holding a lock during slow shutdown

```go
// BUG: serialises all shutdown
func (s *S) Stop(ctx context.Context) error {
    s.mu.Lock()
    defer s.mu.Unlock()
    return s.slowShutdown(ctx)
}
```

The lock is held for the entire shutdown. If two goroutines try Stop, they serialise. Use `sync.Once` instead.

### Mistake 4: Not handling Stop errors

```go
// BUG
defer s.Stop(context.Background())
```

The error is dropped. Shutdown failures are silent. Log them at minimum.

### Mistake 5: Stop that returns immediately without waiting

```go
// BUG
func (s *S) Stop(ctx context.Context) error {
    s.cancel()
    return nil // does not wait for the worker goroutine to exit
}
```

The contract says "Stop returns when shutdown is complete." Wait for the goroutine. Otherwise the caller's `defer wg.Wait()` (or equivalent) is bypassed.

### Mistake 6: Shutting down infrastructure before workers

```go
// BUG
db.Close()
workers.Stop(ctx) // workers try to query DB, panic
```

Order matters. Workers depend on DB. Stop workers first.

### Mistake 7: AfterFunc that races with Stop

```go
// BUG
stop := context.AfterFunc(ctx, func() {
    s.Close() // races with the explicit Stop path
})
defer stop()
defer s.Stop(ctx)
```

If both Close and Stop run, they race. Make Close idempotent, or pick one.

---

## Common Misconceptions

> "Shutdown should be fast."

Sometimes. For services with no state, yes. For services with cached data, in-flight requests, or pending writes, the shutdown must be *correct first*, fast second. A 30-second graceful shutdown that saves 10MB of data is better than a 1-second crash.

> "If I use defer, I do not need a Stop method."

For long-lived services, defer alone is insufficient. A defer fires when its function exits — which is the moment the program is about to die. By then it is too late to do proper drain. You need a Stop method that runs *before* the moment of exit.

> "errgroup handles cleanup."

errgroup handles goroutine lifecycle. Cleanup of resources owned by those goroutines is still your job. errgroup helps coordinate but does not free files, close connections, or flush buffers.

> "I do not need to test shutdown."

You do. Shutdown is where most operational pain lives. Untested shutdown is shipping a known-broken feature.

> "AfterFunc is a panacea for context-based cleanup."

AfterFunc is one tool. It has specific semantics (new goroutine, no waiting, one-shot). Use it where it fits; defer or explicit Stop is often clearer.

---

## Tricky Points

- **`context.AfterFunc` vs `context.WithCancelCause`.** AfterFunc reads `ctx.Done()`; cause is separate metadata. Cleanup can use `context.Cause(ctx)` to read the cause inside the callback.
- **Defer in a return-and-then statement.** `return fn()` evaluates `fn()` *before* defers run. If `fn` panics, the defer still runs.
- **`runtime.Goexit` vs `panic`.** Goexit ends the goroutine cleanly, running defers. Panic is more dramatic but also runs defers (until recovered or until program terminates).
- **`os.Exit` from a panic handler.** If your top-level recover decides to exit, defers below it do *not* run. Be deliberate.
- **`sync.Pool` and finalisers.** A pooled object can have a finaliser, but it runs at GC, not at Put. Do not use finalisers for resource release on Pool objects.
- **Cleanup order vs initialization order.** Cleanup is reverse of initialization. Encode both in the same place to make symmetry obvious.

---

## Test

Predict the output. Then run it.

```go
package main

import (
    "context"
    "fmt"
    "sync"
    "time"
)

func main() {
    var wg sync.WaitGroup
    defer wg.Wait()

    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    wg.Add(1)
    go func() {
        defer wg.Done()
        defer fmt.Println("g1 cleanup")
        <-ctx.Done()
    }()

    wg.Add(1)
    go func() {
        defer wg.Done()
        defer fmt.Println("g2 cleanup")
        time.Sleep(20 * time.Millisecond)
    }()

    time.Sleep(10 * time.Millisecond)
    fmt.Println("main: ready to exit")
}
```

Expected output (with some ordering tolerance between g1/g2 cleanup):

```
main: ready to exit
g2 cleanup
g1 cleanup
```

Reasoning:
- `wg.Wait` is registered first (pops last). `cancel` is registered second (pops first at function exit).
- `main` prints `ready to exit`.
- `main` returns: `cancel` fires (signals g1); `wg.Wait` then blocks.
- g2 was already sleeping; finishes its sleep, prints `g2 cleanup`, decrements wg.
- g1 unblocks from `ctx.Done`, prints `g1 cleanup`, decrements wg.
- `wg.Wait` returns; `main` finally exits.

The interleaving of g1/g2 might vary depending on which finishes first. The key insight: `defer wg.Wait()` is what makes `main` wait for the goroutines; without it, `main` would exit, and the goroutines' defers might not run.

---

## Tricky Questions

**Q1.** In a hierarchical Stop tree, does each level need its own panic recovery?

**A.** Yes. A panic at any level should not abort the rest of the shutdown. Wrap each Stop call with a recover, or use a `safeStop` helper.

**Q2.** Can I shut down components in parallel?

**A.** Only if they are independent. If A depends on B, A must finish stopping before B starts. For independent components (e.g., logger and metrics), parallel shutdown saves time. Use `errgroup`.

**Q3.** What is the right shutdown order: HTTP server first, or workers first?

**A.** Depends on the design. Typical: HTTP first (stop accepting), then workers (drain queued work), then DB (close connections). The principle is "most-user-facing first, most-foundational last."

**Q4.** Should Stop block or return immediately?

**A.** Block. The contract should be "when Stop returns, the component is fully stopped." Returning early forces the caller to poll, which is error-prone. Use the context deadline for bounded blocking.

**Q5.** Why use `sync.Once` for Stop instead of a boolean flag?

**A.** `sync.Once` provides memory-barrier semantics: the body of `Do` is visible to all subsequent callers. A boolean flag without a lock has data races. Use `sync.Once` (or a mutex) for correctness.

**Q6.** How do I handle a Stop that legitimately needs to be called from inside another goroutine's defer?

**A.** Carefully. Make sure the goroutine has not already been stopped (idempotent). Make sure the call does not deadlock (the goroutine should not wait for itself). Often, a "request shutdown" channel is cleaner: the defer signals the channel; a dedicated shutdown goroutine drains it.

**Q7.** Why does `signal.NotifyContext` make sense?

**A.** It creates a context that cancels on the named signals. Composes naturally with the rest of context-based code. The returned `stop` function deregisters the signal handler.

**Q8.** When should I use `context.AfterFunc` instead of `defer`?

**A.** When cleanup must outlive the registering function or run in a separate goroutine. For function-scoped cleanup, prefer `defer`.

**Q9.** What is the right error to return when Stop times out?

**A.** `context.DeadlineExceeded`, wrapped with the component name. Example: `fmt.Errorf("%s: %w", c.Name(), ctx.Err())`.

**Q10.** Is it safe to call `defer s.Stop(ctx)` at the top of `main`?

**A.** Yes, but you must be careful: `ctx` is evaluated *immediately* (at the defer line). If `ctx` is later cancelled, the deferred call still uses the original. Often you want a fresh shutdown context, so build it explicitly:

```go
defer func() {
    stopCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()
    _ = s.Stop(stopCtx)
}()
```

---

## Cheat Sheet

```
SENIOR CLEANUP CHECKLIST
========================
Per-component:
  [ ] Idempotent Stop via sync.Once
  [ ] Stop respects passed context deadline
  [ ] Stop returns error wrapped with component name
  [ ] Top-level defer recover() in long-lived goroutines
  [ ] Resources released in dependency order

Per-service:
  [ ] Hierarchical or registry-based lifecycle manager
  [ ] Fresh shutdown context, not the cancelled signal context
  [ ] Signal handling via signal.NotifyContext
  [ ] Graceful period coordinated with Kubernetes
  [ ] Mark not-ready before shutdown begins
  [ ] errors.Join for multi-component failures
  [ ] Each Stop call wrapped with panic recovery
  [ ] Structured logs (slog) for each shutdown step
  [ ] Metrics for shutdown duration and errors

Per-test:
  [ ] Goroutine leak assertion after Stop
  [ ] Double-Stop returns same result safely
  [ ] Stop honors deadline (times out as expected)
  [ ] Soak test for end-to-end shutdown

Anti-patterns to avoid:
  [ ] Stop that returns immediately without waiting
  [ ] Reusing the SIGTERM context for shutdown
  [ ] Holding a lock across slow shutdown
  [ ] AfterFunc without a deferred stop()
  [ ] Cleanup that depends on external services with no deadline
```

---

## Self-Assessment Checklist

- [ ] I can design a `LifecycleManager` from scratch.
- [ ] I know when to use a tree of components vs a flat registry.
- [ ] I can explain why `defer cancel()` pops first in a typical service shutdown.
- [ ] I understand the trade-offs between sequential and parallel component shutdown.
- [ ] I have written at least one production service with a tested shutdown path.
- [ ] I know how to size the graceful period for a Kubernetes deployment.
- [ ] I can read a senior colleague's Stop method and identify its contract.
- [ ] I know when to use `runtime.SetFinalizer` (almost never).
- [ ] I have used `context.WithCancelCause` and `context.Cause` in real code.
- [ ] I can explain why two-phase shutdown (drain, then close) is sometimes worth it.

---

## Summary

At the senior level, cleanup ordering is architecture. The defer stack and AfterFunc primitive are still the building blocks, but the design discipline shifts: every component has a contract, every shutdown step has a deadline, every error path is logged. The result is a service that shuts down predictably in 30 seconds, releases all its resources, and lets ops engineers sleep at night.

The professional file dives into the runtime: how `defer` is actually implemented, what open-coded defers look like in assembly, how `context.AfterFunc` registers callbacks, and how to reason about cleanup performance at the level of CPU cache lines and memory barriers.

---

## What You Can Build

- A complete production service with full lifecycle management
- A generic LifecycleManager library used across many services
- A test harness that asserts no goroutine leaks across all tests
- A shutdown coordinator that handles Kubernetes signal propagation
- A panic-safe goroutine launcher with structured logging
- A two-phase shutdown system for a service with complex dependencies

---

## Further Reading

- The `golang.org/x/sync/errgroup` source
- `net/http.Server.Shutdown` source
- `context` package source (especially `cancelCtx` and `propagateCancel`)
- "Structured Concurrency" by Roman Elizarov (Kotlin's approach, applicable in principle)
- "Crash-Only Software" by George Candea and Armando Fox
- Go runtime source: `runtime/panic.go` for defer implementation
- Go release notes for 1.14 (open-coded defers), 1.21 (AfterFunc), 1.22 (loop variable scope)

---

## Related Topics

- `01-cooperative-vs-force` — when cancellation is observed by goroutines
- `02-partial-cancellation` — cancellation of subsets of work and the cleanup that follows
- Supervisor patterns (Erlang-inspired, applied to Go)
- The Errors-and-Panics track on panic recovery and structured error handling
- The Observability track on shutdown metrics and logs

---

## Diagrams & Visual Aids

### A hierarchical service tree

```
                    Service
                  /    |    \
              HTTP  Workers  Infra
              /     /  \      |  \  \
          Handlers W1  W2   DB Cache Logger Metrics

Shutdown order: post-order traversal
  Handlers -> HTTP -> W1 -> W2 -> Workers -> DB -> Cache -> Logger -> Metrics -> Infra -> Service
```

### A flat registry

```
Manager.Register(A)
Manager.Register(B)
Manager.Register(C)

Manager.Shutdown:
  C.Stop()  (LIFO)
  B.Stop()
  A.Stop()
```

### Two-phase shutdown

```
Phase 1: signal-drain
   Service.Drain
     HTTP.Drain
     Workers.Drain
     DB.Drain
   wait for all to settle

Phase 2: close
   Service.Close
     HTTP.Close
     Workers.Close
     DB.Close
```

### Supervisor with restart

```
Supervisor.Run:
   loop:
      r = create()
      err = r.Run(ctx)
      if ctx.Done: break
      log restart; continue
   return

Supervisor.Stop:
   cancel ctx
   wait for Run to return
```

### Shutdown timeline

```
t=0    SIGTERM received
       │
t=0    mark not-ready (health check fails)
       │
t=5    LB stops routing
       │
t=5    HTTP.Stop begins (drain in-flight)
       │
t=20   HTTP.Stop done
       │
t=20   Workers.Stop begins
       │
t=25   Workers.Stop done
       │
t=25   DB.Close, Cache.Close
       │
t=27   Logger.Flush, Metrics.Flush
       │
t=28   Service exits
       │
t=60   Kubernetes SIGKILL (never reached)
```

### Defer order in a service shutdown

```
Registered (top to bottom):
  defer logger.Close
  defer metrics.Close
  defer db.Close
  defer cache.Close
  defer workers.Stop
  defer httpServer.Shutdown
  defer cancel
  defer stop(signalNotify)

Popped at exit (bottom to top):
  stop(signalNotify)
  cancel
  httpServer.Shutdown
  workers.Stop
  cache.Close
  db.Close
  metrics.Close
  logger.Close
```

LIFO unwinding gives the correct release order if you registered in correct acquisition order.

---

## Closing Notes

This file walked through the senior-level discipline of cleanup design: contracts, hierarchies, choreography, panic safety, observability, and operational integration. With these tools, you can design a Go service whose shutdown is as reliable as its steady-state behaviour.

The professional file is next. It descends into the runtime — open-coded defers, the `_defer` record layout, how `context.AfterFunc` interacts with the scheduler, the cost of cleanup at the level of CPU instructions. Read it once for completeness; come back to it when you need to diagnose performance problems at the deepest layer.

---

## Extended Case Studies

The rest of this file walks through three extended case studies from real-world Go service design. Each focuses on a different aspect of cleanup ordering: large-service shutdown, distributed worker coordination, and panic recovery under load.

### Case Study A: Migrating a 50-component service to staged shutdown

Imagine inheriting a Go monolith with 50 components and no shutdown discipline. SIGTERM arrives; main returns; some goroutines exit cleanly; many do not. In-flight requests get truncated. The team's symptom: "the service loses 0.5% of requests on every deploy."

#### The diagnosis

Run the service in a test harness. Send 100 requests. Send SIGTERM. Inspect:

- Are any requests returning truncated responses?
- Are connections closed in the middle of writes?
- Are background jobs interrupted mid-update?
- Are metrics for in-flight requests still nonzero after main returns?

The team finds:
- HTTP server's listener closes before in-flight handlers finish.
- Database connections are GC'd mid-query (no explicit close).
- A worker goroutine that batches metrics never flushes its buffer.
- A leader-election heartbeat continues for 30 seconds after main returns, because nothing cancels it.

#### The fix, step by step

**Step 1: Introduce a LifecycleManager.** Every component implements `Start(ctx) error` and `Stop(ctx) error`. Register them at startup in dependency order. Add a Shutdown method to the manager that runs Stop in reverse.

**Step 2: Migrate components one at a time.** For each, identify what it owns. Wrap creation with a `Start` method that returns when the component is ready. Wrap teardown with `Stop` that drains in-flight work and releases resources.

**Step 3: Adopt the shutdown context pattern.** SIGTERM cancels a root context (signal context). A shutdown context with a 30s deadline is derived from `context.Background()` (not from the cancelled signal context).

**Step 4: Wire the manager's Shutdown.** Call it after the signal context fires. Log every step. Emit metrics.

**Step 5: Test it.** Run a soak test: start the service, send 1000 requests, send SIGTERM. Assert that all responses complete successfully and no goroutines leak.

#### The result

After the migration, the team measures:
- Request loss on deploy: 0% (down from 0.5%)
- Mean shutdown time: 8 seconds
- 99th percentile shutdown time: 22 seconds (well within the 30s budget)
- Goroutine leaks per deploy: 0

The migration took six weeks. Each component's Stop method was 10–40 lines. The total code added: about 2000 lines. The total bugs found and fixed: 12. The team estimates the change paid for itself within a month.

#### Lessons

- **Migration is incremental.** You do not need to redesign everything at once. One component at a time.
- **Tests are everything.** Without the soak test, regressions creep in. With it, they get caught in CI.
- **Documentation matters.** Each component's Stop method has a doc comment explaining its order and dependencies. New engineers can read it.
- **The cost is small.** 2000 lines added; thousands of dollars in lost revenue per deploy prevented.

### Case Study B: Distributed worker pool with backpressure

A workflow engine processes 100,000 jobs per second across 10 worker nodes. Each node runs a Go service with:

- A queue consumer (reads jobs from Kafka)
- A worker pool (processes jobs)
- A result publisher (sends results to Kafka)
- A health-check endpoint
- A metrics exporter

When a node is decommissioned (SIGTERM), it must:

1. Stop accepting new jobs (immediately).
2. Finish jobs currently in the worker pool.
3. Publish results for finished jobs.
4. Acknowledge Kafka offsets.
5. Close Kafka connections.
6. Shut down the health-check and metrics endpoints.

If any step is skipped, jobs are duplicated (consumer re-reads them on the next node), results are lost, or metrics are silently dropped.

#### The cleanup ordering

```
consumer.Pause()        // step 1: no new jobs
workers.Drain(ctx)      // step 2: finish in-flight
publisher.Flush(ctx)    // step 3: publish all results
consumer.Commit()       // step 4: ack offsets
consumer.Close()        // step 5: close Kafka
healthCheck.Stop()      // step 6a
metrics.Flush(ctx)      // step 6b
metrics.Close()
```

Each step depends on the previous: workers cannot drain if the consumer is still feeding them new jobs; publisher cannot flush results for jobs not yet processed; offsets cannot be committed for results not yet published.

#### The implementation

```go
package main

import (
    "context"
    "errors"
    "fmt"
    "sync"
    "time"
)

type Pipeline struct {
    consumer  *Consumer
    workers   *WorkerPool
    publisher *Publisher
    health    *HealthCheck
    metrics   *Metrics

    stopOnce sync.Once
    stopErr  error
}

func (p *Pipeline) Stop(ctx context.Context) error {
    p.stopOnce.Do(func() {
        var errs []error

        // Step 1: pause consumer
        if err := p.consumer.Pause(ctx); err != nil {
            errs = append(errs, fmt.Errorf("pause: %w", err))
        }

        // Step 2: drain workers
        if err := p.workers.Drain(ctx); err != nil {
            errs = append(errs, fmt.Errorf("drain: %w", err))
        }

        // Step 3: flush publisher
        if err := p.publisher.Flush(ctx); err != nil {
            errs = append(errs, fmt.Errorf("flush: %w", err))
        }

        // Step 4: commit offsets
        if err := p.consumer.Commit(ctx); err != nil {
            errs = append(errs, fmt.Errorf("commit: %w", err))
        }

        // Step 5: close consumer
        if err := p.consumer.Close(ctx); err != nil {
            errs = append(errs, fmt.Errorf("close consumer: %w", err))
        }

        // Steps 6a/6b: health and metrics in parallel (independent)
        var wg sync.WaitGroup
        wg.Add(2)
        var healthErr, metricsErr error
        go func() {
            defer wg.Done()
            healthErr = p.health.Stop()
        }()
        go func() {
            defer wg.Done()
            metricsErr = p.metrics.Flush(ctx)
            if metricsErr == nil {
                metricsErr = p.metrics.Close()
            }
        }()
        wg.Wait()
        if healthErr != nil {
            errs = append(errs, fmt.Errorf("health: %w", healthErr))
        }
        if metricsErr != nil {
            errs = append(errs, fmt.Errorf("metrics: %w", metricsErr))
        }

        p.stopErr = errors.Join(errs...)
    })
    return p.stopErr
}

// (Stub types so the snippet compiles)
type Consumer struct{}
func (c *Consumer) Pause(ctx context.Context) error  { return nil }
func (c *Consumer) Commit(ctx context.Context) error { return nil }
func (c *Consumer) Close(ctx context.Context) error  { return nil }
type WorkerPool struct{}
func (w *WorkerPool) Drain(ctx context.Context) error { return nil }
type Publisher struct{}
func (p *Publisher) Flush(ctx context.Context) error { return nil }
type HealthCheck struct{}
func (h *HealthCheck) Stop() error { return nil }
type Metrics struct{}
func (m *Metrics) Flush(ctx context.Context) error { return nil }
func (m *Metrics) Close() error                    { return nil }

func main() {
    p := &Pipeline{
        consumer:  &Consumer{},
        workers:   &WorkerPool{},
        publisher: &Publisher{},
        health:    &HealthCheck{},
        metrics:   &Metrics{},
    }
    ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()
    if err := p.Stop(ctx); err != nil {
        fmt.Println(err)
    }
}
```

Each step is explicit. Errors are joined. The two final independent steps run in parallel. The whole Pipeline.Stop is idempotent via `sync.Once`. The contract is documented.

#### Lessons

- **Some steps must be sequential.** Steps 1–5 have explicit dependencies. They must run in order.
- **Some steps are independent.** Steps 6a/6b can run in parallel. errgroup or manual goroutines work.
- **Each step has its own deadline.** The shared ctx provides one global deadline; if a step takes too long, the rest are short-circuited.
- **Idempotency matters.** Multiple shutdown signals can arrive. `sync.Once` makes Stop safe.

### Case Study C: Panic recovery in a high-throughput service

A high-throughput service handles 10,000 requests per second. Some requests trigger panics in user-provided plugins. The current behaviour: a single panic crashes the entire service.

The team wants to:

1. Recover from panics in request handlers.
2. Log the panic with full context.
3. Return a 500 to the client.
4. Continue serving other requests.
5. Emit a metric for panic frequency.
6. Not leak resources from the panicked request.

#### The implementation

```go
package main

import (
    "fmt"
    "log/slog"
    "net/http"
    "runtime/debug"
)

func recoveryMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        defer func() {
            if rec := recover(); rec != nil {
                slog.Error("panic in handler",
                    "value", rec,
                    "path", r.URL.Path,
                    "method", r.Method,
                    "stack", string(debug.Stack()))
                panicCounter.Inc()
                http.Error(w, "internal error", http.StatusInternalServerError)
            }
        }()
        next.ServeHTTP(w, r)
    })
}

func panickyHandler(w http.ResponseWriter, r *http.Request) {
    if r.URL.Path == "/panic" {
        panic("controlled panic")
    }
    fmt.Fprintln(w, "ok")
}

type counter struct{ n int }
func (c *counter) Inc() { c.n++ }
var panicCounter = &counter{}

func main() {
    mux := http.NewServeMux()
    mux.HandleFunc("/", panickyHandler)
    mux.HandleFunc("/panic", panickyHandler)
    h := recoveryMiddleware(mux)

    _ = http.ListenAndServe(":0", h)
}
```

The recovery middleware is the outermost layer. Every request goes through it. A panic in any handler is caught, logged, metric-counted, and a 500 returned. The service continues.

#### But what about deferred cleanups in the panicked handler?

The handler's defers run *before* the recovery middleware's recover (because defers fire on panic, before propagating up). So:

```go
func handlerWithCleanup(w http.ResponseWriter, r *http.Request) {
    f, _ := os.CreateTemp("", "req-*")
    defer f.Close()
    defer os.Remove(f.Name())

    if r.URL.Path == "/panic" {
        panic("controlled")
    }
    // ...
}
```

When the handler panics:
1. Handler's `defer os.Remove(f.Name())` runs.
2. Handler's `defer f.Close()` runs.
3. Panic propagates to middleware.
4. Middleware's `defer recover` runs, catches the panic, logs.
5. Handler returns; client gets 500.

The handler's resources are released *before* the recovery sees the panic. This is exactly the right order.

#### Lessons

- **Recovery middleware is composable.** Every component can have its own recovery layer.
- **Defers run before propagation.** The panicked function's cleanup is intact.
- **Panic ≠ crash.** With proper recovery, panics are recoverable errors. Use them sparingly (idiomatic Go prefers errors), but when they happen, recover gracefully.
- **Metrics on panics.** Emit a counter. Alert if the rate spikes. Panics are signals of bugs.

---

## Deeper Patterns

### Pattern: Cleanup with explicit ordering tokens

When defer's LIFO is not sufficient (e.g., parallel cleanup with priority), use explicit ordering tokens:

```go
type orderedCleanup struct {
    priority int
    fn       func() error
}

func (s *Service) Register(priority int, fn func() error) {
    s.cleanups = append(s.cleanups, orderedCleanup{priority, fn})
}

func (s *Service) RunCleanups() error {
    sort.SliceStable(s.cleanups, func(i, j int) bool {
        return s.cleanups[i].priority > s.cleanups[j].priority
    })
    var errs []error
    for _, c := range s.cleanups {
        if err := c.fn(); err != nil {
            errs = append(errs, err)
        }
    }
    return errors.Join(errs...)
}
```

Higher priority runs first. Useful when components register cleanups from many places.

### Pattern: Cleanup with cancellable phases

Each phase has its own context, derived from the parent shutdown context with a per-phase deadline:

```go
func (s *Service) Shutdown(parent context.Context) error {
    phase1, c1 := context.WithTimeout(parent, 5*time.Second)
    defer c1()
    s.drain(phase1)

    phase2, c2 := context.WithTimeout(parent, 10*time.Second)
    defer c2()
    s.close(phase2)

    return nil
}
```

If `parent` expires, both phases short-circuit immediately. If a phase has its own budget, it can take up to that budget before being cut off.

### Pattern: Cleanup with retries

Some cleanups (e.g., flushing metrics to a remote backend) can succeed on retry:

```go
func retryFlush(ctx context.Context, flush func() error, retries int) error {
    for i := 0; i < retries; i++ {
        if err := flush(); err == nil {
            return nil
        }
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-time.After(time.Duration(1<<i) * 100 * time.Millisecond):
        }
    }
    return errors.New("flush failed after retries")
}
```

Exponential backoff with context-bounded retry. Use sparingly; cleanup that retries can eat the entire graceful budget.

### Pattern: Cleanup with circuit breaker

If a downstream service is consistently failing, your cleanup that calls it will hang and timeout for the entire graceful period. A circuit breaker short-circuits after a few failures:

```go
type Breaker struct {
    failures int
    open     bool
}

func (b *Breaker) Call(fn func() error) error {
    if b.open {
        return errors.New("circuit open")
    }
    if err := fn(); err != nil {
        b.failures++
        if b.failures > 3 {
            b.open = true
        }
        return err
    }
    b.failures = 0
    return nil
}
```

In shutdown, wrap external cleanup calls with the breaker. After three failures, skip the rest. Save the time budget for cleanups that might succeed.

### Pattern: Cleanup with priority queue

For services with many cleanups of varying urgency:

```go
type Priority int

const (
    PriorityCritical Priority = iota
    PriorityHigh
    PriorityNormal
    PriorityLow
)

type registry struct {
    cleanups map[Priority][]func() error
}

func (r *registry) Add(p Priority, fn func() error) {
    r.cleanups[p] = append(r.cleanups[p], fn)
}

func (r *registry) Run(ctx context.Context) error {
    var errs []error
    for _, p := range []Priority{PriorityCritical, PriorityHigh, PriorityNormal, PriorityLow} {
        for _, fn := range r.cleanups[p] {
            if ctx.Err() != nil {
                return errors.Join(append(errs, ctx.Err())...)
            }
            if err := fn(); err != nil {
                errs = append(errs, err)
            }
        }
    }
    return errors.Join(errs...)
}
```

Critical cleanups run first. If the context expires mid-Critical, the rest is skipped. Useful when graceful budgets are tight.

---

## More on `context.AfterFunc`

### When does AfterFunc fire?

The callback runs in a new goroutine when `ctx.Done()` is closed. The closure happens when:

- A parent context is cancelled (cascades).
- The context has a deadline that passes.
- A `cancel` function is invoked (with or without a cause).

The runtime guarantees the callback runs at most once, even with thousands of cancel calls.

### When does AfterFunc not fire?

- If `stop()` was called before the context was done and returned `true`.
- If the context is never done (e.g., `context.Background()`).
- If the process exits before the goroutine has a chance to run (rare; usually shutdown signals).

### How does AfterFunc interact with `context.AfterFunc(ctx, fn1); context.AfterFunc(ctx, fn2)`?

Two independent callbacks. Both fire on cancel. Each gets its own goroutine. The order between them is unspecified.

### What happens if I call AfterFunc on a done context?

The callback is scheduled immediately for execution in a new goroutine. It does not run *synchronously*; the runtime hands it to the scheduler. So:

```go
ctx, cancel := context.WithCancel(context.Background())
cancel()
context.AfterFunc(ctx, func() { fmt.Println("scheduled") })
// "scheduled" may or may not print before the next line
```

### Can the AfterFunc callback access `ctx`?

Yes — by closure. The callback is just a function; it can capture the context variable and read `context.Cause(ctx)` to find out why it ran.

### Can I deregister an AfterFunc from inside another AfterFunc?

Yes. The two callbacks are independent goroutines. One can call the other's `stop`. Be careful about ordering: `stop()` returns false if the callback has already started, so you cannot reliably prevent it from running.

### What's the difference between AfterFunc and a goroutine that selects on ctx.Done()?

```go
// AfterFunc
stop := context.AfterFunc(ctx, fn)
defer stop()

// Manual
go func() {
    <-ctx.Done()
    fn()
}()
```

Functionally similar. Differences:

- AfterFunc allows deregistration via `stop`. The manual version would need a separate signal channel.
- AfterFunc does not run if you `stop` it in time. The manual version runs unconditionally.
- AfterFunc uses runtime machinery (efficient). The manual version is a goroutine the runtime always schedules.

Prefer AfterFunc when you want deregistration semantics. Use manual goroutines when you have additional logic (e.g., a select with multiple cases).

---

## A Worked Example: Migrating to AfterFunc

Suppose you have legacy code:

```go
func runWith(ctx context.Context) {
    done := make(chan struct{})
    go func() {
        <-ctx.Done()
        cleanup()
        close(done)
    }()
    // ... work ...
    <-done
}
```

Each call spawns an extra goroutine. With AfterFunc:

```go
func runWith(ctx context.Context) {
    cleanupDone := make(chan struct{})
    stop := context.AfterFunc(ctx, func() {
        defer close(cleanupDone)
        cleanup()
    })
    defer func() {
        if stop() {
            close(cleanupDone) // deregistered; close ourselves
        }
        <-cleanupDone
    }()
    // ... work ...
}
```

Slightly more verbose but avoids the always-running goroutine. Useful when you have many short-lived contexts; the savings add up.

---

## Cleanup Across Process Boundaries

A single Go process's cleanup is one half of the story. In distributed systems, cleanup also crosses process boundaries:

- **Service registry deregistration.** On shutdown, tell the registry "I'm gone."
- **Leader election release.** If you're the leader, release the lock so another node can take over.
- **Sticky session migration.** Hand off any sticky-session state to another node.
- **Snapshot of in-memory state.** Save state to disk or a remote store, so the next instance can resume.

Each of these is a cleanup operation, but it requires a network call. Tag them with deadlines. Make them resilient to failure (a deregistration that fails is acceptable; the registry will eventually mark the node unhealthy).

```go
func (s *Service) Shutdown(ctx context.Context) error {
    var errs []error

    // local cleanup
    if err := s.localStop(ctx); err != nil {
        errs = append(errs, err)
    }

    // distributed cleanup (best-effort)
    cctx, cancel := context.WithTimeout(ctx, 5*time.Second)
    defer cancel()
    if err := s.registry.Deregister(cctx); err != nil {
        slog.Warn("deregister failed", "err", err) // log but do not include in errs
    }
    if err := s.leader.Release(cctx); err != nil {
        slog.Warn("leader release failed", "err", err)
    }

    return errors.Join(errs...)
}
```

Local cleanup failures matter (they affect this process). Distributed cleanup failures are warnings (they affect the cluster, but the cluster can heal).

---

## Comparison with Other Languages

### Java

Java has `try-with-resources` (similar to `defer`) and `finally` blocks. Cleanup is statically scoped. No equivalent to `context.AfterFunc` — instead, you typically use `ScheduledExecutorService`.

Compared to Go: Java's exception handling is more uniform. Go's panic recovery is opt-in. Both have lock-pair patterns.

### Rust

Rust has `Drop`, which runs deterministically when a value goes out of scope (RAII). Order is reverse of construction. No need for explicit defer.

Compared to Go: Rust's compile-time ownership rules prevent many of Go's cleanup bugs. Go's runtime tools (AfterFunc, panic, recover) are more flexible but require discipline.

### Erlang / OTP

Erlang has supervisors that restart crashed processes. Cleanup is implicit: a crashed process releases its memory, the supervisor starts a fresh one. No explicit close.

Compared to Go: Erlang's approach handles "let it crash" naturally. Go can imitate it with supervisor patterns, but the discipline is manual.

### Python

Python has `with` statements (context managers) and `__del__` finalizers. Async Python (asyncio) has `async with` and `asyncio.shield`.

Compared to Go: Python's `with` is similar to `defer`. Python's async cancellation is roughly analogous to Go's context.

---

## Migration Patterns

### Migrating from no cleanup to disciplined cleanup

1. Audit the codebase: find all resource acquisitions (`os.Open`, `db.Conn`, `http.Get`, etc.).
2. For each, identify where it should be released.
3. Add `defer Close()` (with error handling).
4. Run the full test suite. Look for FD leaks (use `lsof` or `/proc/PID/fd`).
5. Add a soak test: long-running test that asserts no resource growth over time.

### Migrating from boolean flags to context

1. Find every function that takes a `stop chan struct{}` or a `cancel bool`.
2. Replace with `context.Context`. Plumb it through.
3. Update tests to use `context.WithTimeout` instead of timers.
4. Run `go vet`; fix any `lostcancel` warnings.

### Migrating from manual sync to errgroup

1. Find every place that uses `sync.WaitGroup` for "wait for goroutines, propagate errors."
2. Replace with `errgroup.WithContext`.
3. Test that cancellation propagates correctly (first error cancels the group).

### Migrating from in-line cleanup to component-based

1. Identify "components" — types with their own state and lifecycle.
2. Give each a `Start` and `Stop` method.
3. Move resource acquisition into `Start`, release into `Stop`.
4. Wire components into a manager.
5. Test the lifecycle: start, run, stop, no leaks.

---

## A Larger Self-Test

Read the following code carefully. Predict what it prints. Then run it.

```go
package main

import (
    "context"
    "fmt"
    "sync"
    "time"
)

type Component struct {
    name    string
    started bool
    stopped bool
    mu      sync.Mutex
    wg      sync.WaitGroup
    cancel  context.CancelFunc
    once    sync.Once
}

func (c *Component) Start(ctx context.Context) error {
    c.mu.Lock()
    defer c.mu.Unlock()
    if c.started {
        return fmt.Errorf("%s: already started", c.name)
    }
    c.started = true
    ctx, c.cancel = context.WithCancel(ctx)
    c.wg.Add(1)
    go func() {
        defer c.wg.Done()
        defer fmt.Println(c.name, "exit")
        <-ctx.Done()
    }()
    fmt.Println(c.name, "start")
    return nil
}

func (c *Component) Stop(ctx context.Context) error {
    var err error
    c.once.Do(func() {
        c.cancel()
        done := make(chan struct{})
        go func() {
            c.wg.Wait()
            close(done)
        }()
        select {
        case <-done:
            fmt.Println(c.name, "stopped")
        case <-ctx.Done():
            err = fmt.Errorf("%s: %w", c.name, ctx.Err())
        }
    })
    return err
}

func main() {
    a := &Component{name: "A"}
    b := &Component{name: "B"}
    c := &Component{name: "C"}

    rootCtx := context.Background()
    _ = a.Start(rootCtx)
    _ = b.Start(rootCtx)
    _ = c.Start(rootCtx)

    time.Sleep(10 * time.Millisecond)

    stopCtx, cancel := context.WithTimeout(context.Background(), time.Second)
    defer cancel()

    // Stop in reverse order
    if err := c.Stop(stopCtx); err != nil {
        fmt.Println(err)
    }
    if err := b.Stop(stopCtx); err != nil {
        fmt.Println(err)
    }
    if err := a.Stop(stopCtx); err != nil {
        fmt.Println(err)
    }
    fmt.Println("main done")
}
```

Predicted output:

```
A start
B start
C start
C exit
C stopped
B exit
B stopped
A exit
A stopped
main done
```

Reasoning: each component starts, the goroutines block on Done. After 10ms, main stops them in reverse order (C, B, A). Each Stop cancels the context, the goroutine exits, the wait returns. `defer fmt.Println(c.name, "exit")` runs *before* the wait returns because the goroutine's defer fires when *it* returns.

Output may have minor ordering variations because of scheduling, but the overall pattern is stable.

---

## Final Thoughts

The senior level of cleanup ordering is about discipline. Every component you write has the same shape. Every shutdown follows the same recipe. Every test asserts the same properties. The result is a service that is *predictable* in a domain where unpredictability costs money.

The professional file dives into the runtime to show *how* defer and AfterFunc are actually implemented. That knowledge is rarely needed, but it is the ground truth — and it matters when you are debugging a memory profile or asking "why is my AfterFunc registration taking 200ns?"

Reaching for the professional file is the right move when:

- You are profiling a hot path and defer shows up.
- You are debugging a goroutine scheduler issue.
- You are writing a library that wraps `context.AfterFunc` and want to understand its costs.
- You are a runtime contributor.

Otherwise, the discipline of the senior file is enough.

---

## Appendix: A Senior's Reading List

- Russ Cox, "Cancellation, context, and plumbing" (Go blog)
- Sameer Ajmani, "Go Concurrency Patterns: Context" (talk)
- Bryan Mills, "Rethinking Classical Concurrency Patterns" (talk)
- The Go 1.21 release notes (`context.AfterFunc`, `slog`, `errors.Join`)
- The Go runtime source: `runtime/panic.go`, `runtime/proc.go`
- The `errgroup` source (small, readable)
- The `context` package source (slightly larger; worth reading once)

---

## Appendix: Common Code Smells in Cleanup

| Smell | Why it's bad | Fix |
|-------|-------------|-----|
| `defer f.Close()` with no error handling | Lost data on write | Named-return pattern |
| Many defers in a single function | Hard to read; potential ordering bugs | Extract helpers |
| Goroutine without recovery | Crash on first panic | `defer recover()` at top |
| Stop method without `sync.Once` | Race on double-stop | Wrap in `sync.Once` |
| Stop that takes no context | No deadline; can hang forever | Add `ctx context.Context` |
| AfterFunc without `defer stop()` | Memory leak; unexpected fires | Always defer stop |
| Cleanup that depends on shared mutable state | Races during shutdown | Lock, or use channels |
| Shutdown that re-uses signal context | Zero shutdown budget | Use fresh context with deadline |
| Many `if err != nil; cleanup` blocks | Repetitive; error-prone | Use defer |
| Cleanup that retries forever | Eats graceful budget | Bounded retries + circuit breaker |

Recognise these smells; fix them; document the fix in your team's wiki.

---

## Appendix: Sample Stop Method Doc Comment

```go
// Stop initiates a graceful shutdown of the Service.
//
// Stop is idempotent and safe to call from any goroutine. Subsequent calls
// after the first return the same error as the first call.
//
// Stop respects the passed context's deadline. If the context expires before
// shutdown completes, Stop returns a wrapped context.DeadlineExceeded.
//
// Stop performs the following operations in order:
//   1. Cancels the internal context, signalling all goroutines to exit.
//   2. Waits for the worker goroutine to complete (up to ctx deadline).
//   3. Closes the underlying database connection.
//   4. Releases any held locks.
//
// Stop returns the first non-nil error encountered, or nil on full success.
// Multiple errors are joined with errors.Join.
//
// Stop must not be called before Start. Calling Stop on an unstarted Service
// returns an error.
func (s *Service) Stop(ctx context.Context) error { /* ... */ }
```

Every exported Stop should have this level of detail. Future maintainers (and reviewers, and ops engineers) will thank you.

---

## Appendix: Common Stop Signatures

| Signature | When to use |
|-----------|------------|
| `Close() error` | Resources with no graceful drain (files, simple closers) |
| `Close(ctx context.Context) error` | Resources with deadline-bounded close (network connections) |
| `Stop(ctx context.Context) error` | Long-lived components with drain semantics |
| `Shutdown(ctx context.Context) error` | Top-level services (`http.Server.Shutdown`) |
| `Done() <-chan struct{}` | Components that signal completion via channel |

Choose based on the component's needs. `Close` is the most common; `Shutdown` is reserved for the outermost component.

---

The senior file ends here. Take a break. The professional file is where the runtime hides its secrets.

---

## Architecture Deep Dive: Production-Grade Lifecycle Framework

For teams that maintain multiple services, building a shared lifecycle framework pays compound dividends. This section walks through the design of such a framework — what to put in it, what to leave out, and how to evolve it.

### Goals of a lifecycle framework

1. **Uniformity.** Every service follows the same shutdown discipline.
2. **Observability.** Every shutdown event is logged with structure.
3. **Testability.** Lifecycle tests are easy to write.
4. **Extensibility.** New component types plug in without framework changes.
5. **Failure handling.** Crashes during startup and shutdown are recoverable.

### Non-goals

- Replacing the standard library. We use `context`, `errgroup`, `sync` as building blocks.
- Imposing dependency injection frameworks. The lifecycle is composed manually.
- Solving distributed concerns. Cross-service coordination is out of scope.

### The core interface

```go
// Component is the unit of lifecycle management.
// Implementations must be safe for concurrent use of Start and Stop.
type Component interface {
    // Name returns the component's identifier for logs and metrics.
    Name() string

    // Start initiates the component. It returns when the component is
    // either fully started or has failed to start. Start is called at
    // most once per Component instance.
    Start(ctx context.Context) error

    // Stop initiates a graceful shutdown of the component. It returns
    // when shutdown is complete or when ctx expires. Stop is idempotent.
    Stop(ctx context.Context) error
}
```

This is the minimum. Some frameworks add `Ready() <-chan struct{}` for ready checks; some add `Health() error` for health endpoints. Start small.

### The manager

```go
type Manager struct {
    mu         sync.Mutex
    components []Component
    state      managerState
    startErrs  []error
    stopErrs   []error
    startedTo  int // index of last started component
}

type managerState int

const (
    stateInit managerState = iota
    stateStarting
    stateRunning
    stateStopping
    stateStopped
)

func (m *Manager) Add(c Component) {
    m.mu.Lock()
    defer m.mu.Unlock()
    if m.state != stateInit {
        panic("lifecycle: Add called after Start")
    }
    m.components = append(m.components, c)
}

func (m *Manager) Start(ctx context.Context) error {
    m.mu.Lock()
    if m.state != stateInit {
        m.mu.Unlock()
        return errors.New("lifecycle: already started")
    }
    m.state = stateStarting
    components := m.components
    m.mu.Unlock()

    for i, c := range components {
        startCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
        err := c.Start(startCtx)
        cancel()
        if err != nil {
            // unwind started components
            stopCtx, stopCancel := context.WithTimeout(context.Background(), 30*time.Second)
            defer stopCancel()
            for j := i - 1; j >= 0; j-- {
                _ = components[j].Stop(stopCtx)
            }
            m.mu.Lock()
            m.state = stateStopped
            m.mu.Unlock()
            return fmt.Errorf("lifecycle: start %s: %w", c.Name(), err)
        }
        m.mu.Lock()
        m.startedTo = i
        m.mu.Unlock()
    }

    m.mu.Lock()
    m.state = stateRunning
    m.mu.Unlock()
    return nil
}

func (m *Manager) Stop(ctx context.Context) error {
    m.mu.Lock()
    if m.state == stateStopping || m.state == stateStopped {
        m.mu.Unlock()
        return errors.New("lifecycle: already stopping or stopped")
    }
    m.state = stateStopping
    components := m.components
    startedTo := m.startedTo
    m.mu.Unlock()

    var errs []error
    for i := startedTo; i >= 0; i-- {
        if err := components[i].Stop(ctx); err != nil {
            errs = append(errs, fmt.Errorf("stop %s: %w", components[i].Name(), err))
        }
    }

    m.mu.Lock()
    m.state = stateStopped
    m.mu.Unlock()
    return errors.Join(errs...)
}
```

This manager:
- Tracks state through a small FSM (init, starting, running, stopping, stopped).
- Limits start/stop to one each (`stateStarting` once, `stateStopping` once).
- Unwinds partial starts on failure.
- Stops in reverse of start order.
- Joins multiple stop errors.

### Instrumentation hooks

```go
type Hooks struct {
    OnStartBegin func(name string)
    OnStartEnd   func(name string, err error, elapsed time.Duration)
    OnStopBegin  func(name string)
    OnStopEnd    func(name string, err error, elapsed time.Duration)
}

func (m *Manager) WithHooks(h Hooks) *Manager { m.hooks = h; return m }
```

The framework calls these hooks at each transition. Production deployments wire them to slog and Prometheus:

```go
mgr.WithHooks(Hooks{
    OnStartBegin: func(name string) {
        slog.Info("starting", "component", name)
    },
    OnStartEnd: func(name string, err error, elapsed time.Duration) {
        slog.Info("started", "component", name, "elapsed", elapsed, "err", err)
        startDuration.WithLabelValues(name).Observe(elapsed.Seconds())
    },
    // ... similar for stop ...
})
```

Hooks are optional but transform debugging.

### Testing utilities

```go
// MockComponent is a Component for testing.
type MockComponent struct {
    name        string
    startErr    error
    stopErr     error
    startDelay  time.Duration
    stopDelay   time.Duration
    startCount  atomic.Int32
    stopCount   atomic.Int32
}

func (m *MockComponent) Name() string { return m.name }

func (m *MockComponent) Start(ctx context.Context) error {
    m.startCount.Add(1)
    select {
    case <-time.After(m.startDelay):
    case <-ctx.Done():
        return ctx.Err()
    }
    return m.startErr
}

func (m *MockComponent) Stop(ctx context.Context) error {
    m.stopCount.Add(1)
    select {
    case <-time.After(m.stopDelay):
    case <-ctx.Done():
        return ctx.Err()
    }
    return m.stopErr
}
```

Tests use MockComponents to verify lifecycle ordering, error propagation, deadline handling. The framework owns the test fixtures.

### A typical lifecycle test

```go
func TestManagerStopsInReverseOrder(t *testing.T) {
    var order []string
    var mu sync.Mutex
    record := func(name string) {
        mu.Lock()
        defer mu.Unlock()
        order = append(order, name)
    }

    var m Manager
    m.WithHooks(Hooks{
        OnStopBegin: func(name string) { record(name) },
    })
    m.Add(&MockComponent{name: "A"})
    m.Add(&MockComponent{name: "B"})
    m.Add(&MockComponent{name: "C"})

    ctx := context.Background()
    if err := m.Start(ctx); err != nil {
        t.Fatal(err)
    }
    if err := m.Stop(ctx); err != nil {
        t.Fatal(err)
    }

    if !reflect.DeepEqual(order, []string{"C", "B", "A"}) {
        t.Errorf("wrong order: %v", order)
    }
}
```

A few lines of test. The framework's invariant — reverse-order stop — is verified.

### Anti-patterns the framework prevents

The framework structure makes some bugs literally impossible:

- **Forgetting to Stop a component.** Manager tracks it; Stop iterates all components.
- **Stopping in the wrong order.** Manager hard-codes reverse order.
- **Adding components after Start.** Add panics if state is past init.
- **Double-Stop.** state FSM prevents re-entry.
- **Forgetting to log a transition.** Hooks fire automatically.

This is the design value of a small framework: not the code it adds, but the bugs it prevents.

---

## Architecture Deep Dive: Cleanup in Long-Running Background Tasks

Many services have background tasks — periodic syncs, scheduled batch jobs, lazy refreshes. Their cleanup design differs from request-scoped work.

### The lifecycle

A background task usually:

1. **Starts** at service startup.
2. **Runs periodically** for the lifetime of the service.
3. **Stops** during shutdown.

Implementation:

```go
type PeriodicTask struct {
    name     string
    interval time.Duration
    run      func(ctx context.Context) error

    cancel context.CancelFunc
    done   chan struct{}
    once   sync.Once
}

func (t *PeriodicTask) Start(parent context.Context) error {
    ctx, cancel := context.WithCancel(parent)
    t.cancel = cancel
    t.done = make(chan struct{})
    go t.loop(ctx)
    return nil
}

func (t *PeriodicTask) loop(ctx context.Context) {
    defer close(t.done)
    defer func() {
        if r := recover(); r != nil {
            slog.Error("periodic task panic", "task", t.name, "value", r)
        }
    }()

    ticker := time.NewTicker(t.interval)
    defer ticker.Stop()

    for {
        select {
        case <-ctx.Done():
            return
        case <-ticker.C:
            if err := t.run(ctx); err != nil {
                slog.Error("periodic task run", "task", t.name, "err", err)
            }
        }
    }
}

func (t *PeriodicTask) Stop(ctx context.Context) error {
    var err error
    t.once.Do(func() {
        t.cancel()
        select {
        case <-t.done:
        case <-ctx.Done():
            err = ctx.Err()
        }
    })
    return err
}
```

Three things to note:

1. **The recover.** A panic in `run` does not kill the program; it logs and the task exits its loop. If you want auto-restart, wrap the body in a supervisor loop.
2. **The ticker.** Always `defer ticker.Stop()` — otherwise the ticker's internal goroutine leaks.
3. **The done channel.** Stop blocks until the loop exits, with deadline.

### Variations

- **Multiple periodic tasks share a manager.** Group them in a single component.
- **Task that runs *once* on shutdown.** Use `defer task()` at the end of `loop` so it runs before exit. Pair with a fresh shutdown context (not the cancelled one).
- **Task with backoff on error.** Track consecutive failures; increase interval; cap at a max.
- **Task that adapts interval.** Move ticker into the loop body so each iteration recomputes the next delay.

### Anti-pattern: task that ignores the parent context

```go
// BAD
func (t *PeriodicTask) loop() {
    for range time.Tick(t.interval) { // never stops
        t.run(context.Background())   // never cancellable
    }
}
```

`time.Tick` returns a channel that is never closed; the loop runs forever. `context.Background()` provides no cancellation. The result: a task that survives shutdown.

The fix is the original `loop` above. The cost: a handful of extra lines.

---

## Architecture Deep Dive: Cleanup in HTTP Middleware

HTTP middleware wraps handlers. Each middleware can add its own cleanup. The ordering matters.

### A typical middleware stack

```go
mux := http.NewServeMux()
mux.HandleFunc("/", handler)

// outer-to-inner: recovery, tracing, auth, rate-limit, logging
h := recoveryMiddleware(
        tracingMiddleware(
            authMiddleware(
                rateLimitMiddleware(
                    loggingMiddleware(mux)))))

http.ListenAndServe(":8080", h)
```

When a request arrives:
- `recoveryMiddleware` is the outermost. Its `defer recover()` catches anything below.
- `tracingMiddleware` starts a span; its `defer span.End()` ends it.
- `authMiddleware` may set a request context value.
- `rateLimitMiddleware` may acquire a token; `defer token.Release()`.
- `loggingMiddleware` logs the request/response.

Each middleware's defers run when *its* handler returns. The order is LIFO: inner defers fire first, outer defers fire last.

For a request that panics:
1. Handler panics.
2. Logging middleware's defers run (log "error", whatever).
3. Rate-limit middleware's defers run (release token).
4. Auth middleware's defers run.
5. Tracing middleware's defers run (end span — span captures the panic).
6. Recovery middleware's recover fires, catches the panic, writes 500.

The order is *correct by construction*: each middleware cleans up what *it* set up. No cross-middleware coordination required.

### Anti-pattern: cleanup in the wrong middleware

```go
// BAD: rate-limit middleware tries to end the span
func rateLimitMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        // ...
        defer span.End() // span was started by tracing middleware!
    })
}
```

Each middleware owns its own setup and teardown. Cross-ownership is a bug.

### Pattern: middleware that needs deferred cleanup of a request-scoped resource

```go
func tempFileMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        f, err := os.CreateTemp("", "req-*")
        if err != nil {
            http.Error(w, err.Error(), 500); return
        }
        defer os.Remove(f.Name())
        defer f.Close()

        ctx := context.WithValue(r.Context(), tempFileKey, f)
        next.ServeHTTP(w, r.WithContext(ctx))
    })
}
```

The temp file's two cleanups (`os.Remove` and `f.Close`) are registered in the middleware. They run when the middleware function returns — which is *after* `next.ServeHTTP` finishes. LIFO order: `f.Close()` first (registered last), then `os.Remove` (registered second-to-last).

This is the canonical pattern for per-request resources.

---

## Architecture Deep Dive: Cleanup in Pipeline Stages

Pipelines (producer → processor → consumer) have cleanup considerations specific to channel-based composition.

### The "close from sender" rule

Only the sender of a channel should close it. The receiver must not close. This rule is universal in Go and especially important during cleanup.

```go
// good: sender closes
func produce(ctx context.Context) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for i := 0; ; i++ {
            select {
            case <-ctx.Done():
                return
            case out <- i:
            }
        }
    }()
    return out
}
```

Sender closes via `defer close(out)`. Receiver iterates with `for x := range out`. Clean.

### Multiple senders, one receiver

If many goroutines send to one channel, none of them should close it (closing while another is sending = panic). Instead, use a coordinator that waits for all senders and closes once:

```go
out := make(chan int)
var wg sync.WaitGroup
for _, src := range sources {
    wg.Add(1)
    go func(s Source) {
        defer wg.Done()
        for v := range s.Read() {
            select {
            case out <- v:
            case <-ctx.Done():
                return
            }
        }
    }(src)
}
go func() {
    wg.Wait()
    close(out)
}()
```

The coordinator goroutine runs `defer close(out)`-style logic after all senders are done. Standard fan-in pattern.

### Drain on context cancel

If the receiver stops consuming, senders block. To unblock senders during cleanup, the receiver should drain:

```go
func consume(ctx context.Context, in <-chan int) {
    for {
        select {
        case <-ctx.Done():
            // drain
            go func() { for range in {} }()
            return
        case v := <-in:
            process(v)
        }
    }
}
```

The drain goroutine continues to consume from `in` until the channel closes. Senders are unblocked; their goroutines exit; the channel eventually closes; the drain goroutine exits.

### Cleanup order in pipelines

The order matters: senders close *after* their work; receivers exit *when their input closes*. This is a chain reaction:

```
cancel context
   ↓
producer goroutine notices, defers close(out)
   ↓
consumer's range loop terminates
   ↓
consumer's defer cleanup() runs
```

The order is implicit in the pipeline structure. Bugs occur when you try to manually close channels or short-circuit the chain — usually because the original design did not handle cancellation.

---

## More Production Considerations

### Profiling shutdown latency

Add a "shutdown time" histogram to your metrics. Plot the distribution over weeks. Alerts on the 99th percentile creeping up.

Sample histogram buckets: 100ms, 500ms, 1s, 5s, 10s, 30s.

If you see the 99th approach 30s, you have a problem. Investigate:
- Is one component slow to stop?
- Is the graceful budget shrinking?
- Is some external dependency hanging?

### Coordinating shutdown across multiple replicas

In Kubernetes, multiple replicas of your service may shut down simultaneously. If they share a downstream dependency (e.g., a leader-election lock), they should not all release the lock simultaneously — the next leader has to immediately acquire it.

Patterns:
- **Stagger.** Each replica adds a small jitter before beginning shutdown.
- **Coordinator.** A separate coordinator service tells replicas when to release.
- **Eventual consistency.** Tolerate brief "no leader" windows; the system heals.

### Cleanup that requires network calls

External calls during cleanup are risky:
- The remote service may be slow or unavailable.
- Network can have variable latency.
- TLS handshakes add 100ms+ on cold starts.

Best practices:
- Use short deadlines for external cleanup calls (5–10s).
- Log failures but do not block shutdown on them.
- Make the remote operation idempotent: if it fails, the system can re-cleanup on next start.

### Cleanup that requires disk flushes

If your service writes data, ensure it is durable before exit:
- `f.Sync()` for files (calls fsync).
- Database `Commit` (with the right isolation level).
- Flush of any buffered writers (`bufio.Writer.Flush`).

Order: flush user-level buffers → `Sync` → close.

### Restart loops

If your service crashes within seconds of starting, Kubernetes will enter CrashLoopBackoff. Diagnose by:
- Reading the last few seconds of logs.
- Checking startup metrics (was Start ever called?).
- Adding a panic recovery in main itself.

Cleanup is part of restart loops: if shutdown is broken, the service may not be able to release state, leading to startup failures.

---

## Self-Reflective Tooling

A senior team builds tools that automate the discipline:

- **Lint rules.** Custom staticcheck or go-vet rules that enforce "every Component has a Stop method," "every channel has at most one closer," etc.
- **Code generation.** Generate Stop methods from struct fields tagged with `cleanup:"close"`.
- **Test scaffolding.** Boilerplate tests for every Component, generated.
- **Shutdown simulator.** A tool that runs your service through synthetic shutdown scenarios.

These tools cost time to build but pay off across years.

---

## Beyond Process Boundaries: Distributed Cleanup

Real systems have multiple processes that coordinate. Cleanup in this world means:

- **Deregistering from service discovery.** Consul, etcd, Kubernetes API.
- **Releasing distributed locks.** ZooKeeper, etcd lease, Redis lock.
- **Migrating ownership.** Hand off leadership to another replica.
- **Persisting state.** Save to a database before exit.

Each of these is a cleanup operation but with cross-process semantics. The same principles apply:
- Order: most-dependent first.
- Deadlines: bounded.
- Idempotence: safe to retry.
- Logging: structured.

The Go primitives extend naturally. `context.AfterFunc` works the same way. `errgroup` coordinates multiple distributed cleanups. The discipline is the same.

---

## Closing — For Real This Time

A senior engineer working on cleanup ordering does not write more code than a junior — they write *better-designed* code. The components have contracts. The shutdowns have order. The errors are logged. The tests assert invariants. The whole system is composable.

When you have internalised this, your services do not lose requests on deploy. Your ops engineers do not wake up at 3am because a shutdown hung. Your bills are predictable because you do not leak resources. The discipline pays.

The professional file is for when you want to know exactly *how* Go implements these primitives at the runtime level. Most senior engineers can skim it once and never need to come back. A few — runtime contributors, deep performance specialists — return to it often. Choose based on your role.

This is the end of the senior level. From here, you either: (a) take what you have learned and apply it; (b) descend into the runtime; or (c) build the tools and frameworks that let your team apply it without thinking. All three are good outcomes.

---

## Bonus Section: Cleanup Ordering Across Open-Source Projects

To anchor the senior-level thinking in concrete reality, here are short critiques of how a few well-known Go projects approach cleanup ordering. These are not exhaustive — they are pointers to read further on your own.

### `net/http` — `Server.Shutdown`

The pattern is canonical:

1. Close listeners (no new connections).
2. Walk all idle connections; close them.
3. Wait for active connections to finish, up to the context deadline.
4. Return — caller is responsible for any additional cleanup.

The implementation is in `net/http/server.go`. The use of `sync.Mutex` to guard the active-connection list, `context.Context` for the deadline, and `chan struct{}` to signal completion is textbook senior-level Go.

Lesson: even the standard library follows the cancel-then-drain pattern. There is no shortcut.

### `database/sql` — `DB.Close`

The DB connection pool's `Close` method:

1. Marks the pool as closed (no new connections).
2. Closes all idle connections.
3. Active connections close themselves when returned to the pool.

The pool can be partially closed while connections are still in use. Drivers must implement their own cleanup when `Close` is called on a returned connection. This is a delegation pattern — the pool does not micromanage; each connection's `Close` handles its own state.

Lesson: cleanup composition. The pool composes connection cleanups; each connection composes statement cleanups; etc.

### `etcd` — `Server.Stop`

etcd's server has a multi-stage shutdown:

1. Stop the Raft node (no more proposals).
2. Wait for in-flight Raft messages.
3. Close the gRPC servers (no new requests).
4. Wait for in-flight gRPC requests.
5. Close the storage backend.
6. Close logger and other infrastructure.

Each stage has its own context deadline. Each is logged. The implementation is in `server/etcdserver/server.go`. It is one of the most extensive shutdown sequences in open-source Go.

Lesson: large services have many stages. Each stage has its own deadline and logs.

### `containerd` — `Server.Stop`

containerd's daemon shuts down by:

1. Stopping the gRPC server (immediate, with grace period).
2. Stopping all plugins in reverse-startup order.
3. Closing infrastructure (db, namespaces).

The plugin lifecycle is the interesting part: each plugin has its own `Stop` method, and the server calls them in reverse of registration. This is exactly the LifecycleManager pattern.

Lesson: plug-in based architectures benefit massively from lifecycle management.

### `consul` — agent shutdown

Consul's agent has cleanup spread across many components: server, client, services, checks, ACLs, KV store. Each has its own Stop method. The agent's Shutdown coordinates them via a central manager.

Notably, Consul also handles the "leadership transfer" case: if this agent is the leader, it tries to transfer leadership before stopping. If it cannot, it crashes the cluster's leadership election (briefly) until another agent wins.

Lesson: distributed cleanup includes "release leadership" as a step.

---

## Bonus Section: Cleanup Ordering and Crash-Only Software

The "crash-only" school of thought (Candea & Fox) argues that graceful shutdown is wasted effort: every shutdown should look like a crash. Restart logic must be robust to crashes; if it is, graceful shutdown is redundant.

The Go community's practice is somewhere in between:

- We want graceful shutdown for *deploys* (so we don't lose requests).
- We accept crash-only for *unexpected failures* (because we cannot do anything else).
- Our restart logic handles both: idempotent state, idempotent operations, idempotent cleanup.

So even with great shutdown discipline, your service must handle the case where shutdown was skipped (because of SIGKILL, OOM, hardware failure). Idempotent operations are the safety net.

Idempotent design principles:
- **Operations are commutative or associative** where possible.
- **State is reconstructable** from logs or external sources.
- **Side effects are tracked**: if a side effect was applied, applying it again does nothing.
- **Cleanup is recoverable**: if cleanup was interrupted, the next startup can complete it.

A senior engineer designs for both: graceful when possible, crash-safe always.

---

## Bonus Section: Cleanup in Mixed Sync/Async Code

Some Go services have a mix of synchronous and asynchronous work. Cleanup ordering is trickier.

### Pattern: defer for sync, channels for async

```go
func handler(w http.ResponseWriter, r *http.Request) {
    // sync resources: defer
    f, _ := os.CreateTemp("", "req-*")
    defer f.Close()
    defer os.Remove(f.Name())

    // async work: tracked via channel
    asyncDone := make(chan struct{})
    go func() {
        defer close(asyncDone)
        backgroundWork(r.Context())
    }()

    // sync work
    syncWork(f)

    // wait for async if necessary
    select {
    case <-asyncDone:
    case <-r.Context().Done():
        // cancelled; let the goroutine clean up on its own
    }
}
```

Sync resources use `defer`. Async resources are coordinated via channels. The handler returns when both are done (or when the request is cancelled).

### Pattern: fan-out with bounded concurrency

```go
func processBatch(ctx context.Context, items []Item) error {
    g, ctx := errgroup.WithContext(ctx)
    sem := make(chan struct{}, 10) // concurrency limit

    for _, item := range items {
        item := item
        sem <- struct{}{}
        g.Go(func() error {
            defer func() { <-sem }()
            return process(ctx, item)
        })
    }
    return g.Wait()
}
```

The semaphore limits concurrency. The `defer <-sem` releases the slot. Errgroup waits for all and propagates the first error. Cleanup ordering is implicit.

### Pattern: async work that outlives the function

```go
func startBackground(parent context.Context) {
    ctx, cancel := context.WithCancel(parent)
    // do NOT defer cancel here — we want the goroutine to outlive us
    go func() {
        defer cancel() // cancel when goroutine exits
        backgroundLoop(ctx)
    }()
}
```

The goroutine outlives `startBackground`. The `cancel` is deferred *inside* the goroutine, so it fires when the goroutine returns. The parent context can still cancel everything if needed.

But beware: if `startBackground` is called many times without proper coordination, you can leak goroutines. Use a manager.

---

## Bonus Section: Cleanup Patterns for Tests

Tests have their own cleanup discipline. The senior engineer:

- Uses `t.Cleanup` for test-scoped resources. It runs LIFO at test end.
- Uses `t.TempDir` for temp dirs. Cleaned up automatically.
- Avoids `os.Exit` in tests (skips defers and `t.Cleanup`).
- Validates no goroutine leaks via `goleak` or similar.
- Validates no FD leaks in long-running tests.

```go
func TestComplexShutdown(t *testing.T) {
    defer goleak.VerifyNone(t)

    s, err := NewService(...)
    if err != nil { t.Fatal(err) }
    t.Cleanup(func() {
        ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
        defer cancel()
        if err := s.Stop(ctx); err != nil {
            t.Error(err)
        }
    })

    // ... test logic ...
}
```

The `goleak` package catches leaked goroutines. `t.Cleanup` ensures Stop runs even if the test fails. Together, they make every test a goroutine-leak detector.

---

## Bonus Section: Cleanup Patterns for Benchmarks

Benchmarks have a similar pattern but with subtleties around `b.N`:

```go
func BenchmarkService(b *testing.B) {
    s, _ := NewService(...)
    b.Cleanup(func() {
        ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
        defer cancel()
        s.Stop(ctx)
    })

    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        s.Process(item)
    }
}
```

`b.ResetTimer` excludes setup time. `b.Cleanup` runs after the benchmark — its cost is *not* counted. This is the right pattern for benchmarking work that has setup/teardown costs.

---

## Bonus Section: A Glossary of Go-Specific Cleanup Terms

This file uses many terms. A consolidated glossary:

| Term | Definition |
|------|-----------|
| **`_defer` record** | The runtime's per-deferred-call data structure. Holds function pointer, args, link to next defer. |
| **Open-coded defer** | A defer that the compiler inlines into the function body. Free in the common case. Available since Go 1.14. |
| **Heap defer** | A defer record allocated on the heap, linked into the goroutine's defer chain. Used for defers inside loops or beyond the open-coded budget. |
| **Goroutine local defer chain** | The runtime's per-goroutine linked list of pending defers, used for heap defers. |
| **Defer pool** | A per-P pool that recycles `_defer` records to reduce allocation. |
| **`context.AfterFunc`** | Go 1.21+ primitive. Registers a callback that runs in a new goroutine when a context is cancelled. |
| **`stop` function** | Returned by `AfterFunc`. Deregisters the callback. Returns false if the callback has already started. |
| **`context.WithCancelCause`** | Go 1.20+. Like `WithCancel` but the cancel function takes an error (the "cause"). Visible via `context.Cause`. |
| **`context.Cause`** | Go 1.20+. Returns the specific cause of cancellation, or `ctx.Err()` if no cause was set. |
| **`signal.NotifyContext`** | Returns a context cancelled on receipt of the named signals. Replaces manual signal handling in main. |
| **`errgroup.Group`** | The `golang.org/x/sync/errgroup` package. Goroutine team with first-error semantics. |
| **`errgroup.WithContext`** | Returns a Group plus a context that is cancelled on first error. Standard for coordinated goroutine teams. |
| **`sync.OnceFunc`** | Go 1.21+. Wraps a function so it runs at most once. Useful for idempotent close. |
| **`runtime.SetFinalizer`** | Schedules a function to run when an object is GC'd. Last-resort cleanup mechanism. |
| **`runtime.NumGoroutine`** | Returns the current number of goroutines. Useful for leak detection. |
| **Cancel cascade** | Propagation of cancel signals down a tree of derived contexts. |
| **Graceful period** | The window between SIGTERM and forced termination. |
| **Drain interval** | The portion of the graceful period spent finishing in-flight work. |
| **Lifecycle manager** | A component that owns the Start/Stop of other components. |
| **`t.Cleanup`** | Test-scoped cleanup. Runs LIFO at test end, including across helpers. |
| **`goleak`** | A third-party package that detects goroutine leaks in tests. |
| **`http.Server.Shutdown`** | The standard library's graceful HTTP shutdown. Stops listener, waits for in-flight, returns. |

---

## Bonus Section: Reading Production Logs

A well-instrumented shutdown produces logs like:

```
2026-05-15T10:23:00 INFO signal received signal=SIGTERM
2026-05-15T10:23:00 INFO marking not-ready
2026-05-15T10:23:05 INFO beginning shutdown deadline=30s
2026-05-15T10:23:05 INFO stopping component=http
2026-05-15T10:23:25 INFO stopped  component=http elapsed=20s
2026-05-15T10:23:25 INFO stopping component=workers
2026-05-15T10:23:28 INFO stopped  component=workers elapsed=3s
2026-05-15T10:23:28 INFO stopping component=db
2026-05-15T10:23:29 INFO stopped  component=db elapsed=1s
2026-05-15T10:23:29 INFO clean shutdown
```

You can see:
- Total shutdown time: 24 seconds (within 30s budget).
- HTTP took 20 seconds (probably had long-lived connections; reasonable).
- Workers and DB were fast.
- No errors.

A bad shutdown might look like:

```
2026-05-15T10:23:00 INFO signal received
2026-05-15T10:23:00 INFO beginning shutdown deadline=30s
2026-05-15T10:23:00 INFO stopping component=http
2026-05-15T10:23:30 ERROR shutdown timed out
2026-05-15T10:23:30 FATAL force-killing process
```

HTTP never finished. Either there is a request that never times out, or `Shutdown` did not respect the context. Time to investigate.

Reading shutdown logs is a senior skill. Train your eye for the typical patterns; spot anomalies quickly.

---

## Bonus Section: A Mental Model for Designing Shutdown

When designing a new service's shutdown:

1. **List every long-lived resource.** Goroutines, file descriptors, network connections, in-memory state.
2. **Draw the dependency graph.** Which resources depend on which?
3. **Define the order.** Topological sort. Most-dependent first.
4. **Assign deadlines.** How long is acceptable per step? Sum to total budget.
5. **Identify which steps can be parallel.** Independent steps run in parallel.
6. **Identify which steps have retry-on-error.** Network calls; flush-style.
7. **Write the Stop method.** One per component.
8. **Wire the manager.** One central coordinator.
9. **Test.** Soak test with goroutine leak detection.
10. **Measure.** Production metrics on shutdown time and errors.

This is a recipe. Apply it consistently across services. The result is a portfolio of services that all shut down the same way — and ops engineers can debug any of them with the same tools.

---

## Bonus Section: Wrapping Up Cleanup Across the Goroutine Lifetime

A goroutine has phases. Each has its own cleanup considerations:

- **Spawn.** The goroutine is created. Its parent passes any necessary resources (context, channels). No cleanup yet.
- **Run.** The goroutine does work. Resources may be acquired and released within. `defer` handles per-function cleanup.
- **Cancel.** The context's `Done` channel closes. The goroutine should observe and begin shutdown.
- **Drain.** The goroutine consumes any remaining buffered work.
- **Cleanup.** The goroutine releases its own resources. `defer`s fire.
- **Exit.** The goroutine returns. The runtime cleans up its stack.

Each phase has specific tools:
- Spawn: `go func() { ... }()`
- Run: `defer`, `sync.Mutex`, etc.
- Cancel: `select { case <-ctx.Done() }`
- Drain: explicit drain loop or `for range ch {}`
- Cleanup: `defer`, including `defer wg.Done()`
- Exit: nothing; the runtime handles it.

A senior engineer designs every goroutine with all six phases in mind. The result is goroutines that exit cleanly, every time, even under stress.

---

## Bonus Section: Cleanup and the `runtime.Stack` Snapshot

When debugging a hung shutdown, capture a stack dump:

```go
import (
    "os"
    "os/signal"
    "runtime"
    "syscall"
)

func init() {
    sigs := make(chan os.Signal, 1)
    signal.Notify(sigs, syscall.SIGUSR1)
    go func() {
        for range sigs {
            buf := make([]byte, 1<<20)
            n := runtime.Stack(buf, true)
            os.Stderr.Write(buf[:n])
        }
    }()
}
```

Send SIGUSR1 to the process; get a full stack trace. Look for goroutines stuck in `Wait`, `Read`, or `Lock` calls. Identify the cleanup that is blocked.

This is a debugging tool, not a regular feature. Use it when shutdown is mysterious.

---

## Bonus Section: When Cleanup Is Optional

Not every resource requires explicit cleanup. The Go runtime cleans up:
- Goroutine stacks (when the goroutine exits).
- Heap allocations (during GC).
- Channels (when unreferenced).
- Mutexes (when unreferenced).
- Timers (when unreferenced AND the timer has fired, in newer Go versions).

The runtime does *not* clean up:
- Open file descriptors. (Though finalizers on `*os.File` help in development.)
- Network connections.
- Database transactions.
- Background goroutines that block on channels.
- AfterFunc callbacks waiting on long-lived contexts.

For runtime-managed resources, you can sometimes skip cleanup in short-lived programs. For OS-managed resources, always clean up. The cost is small; the upside is correctness.

---

## Bonus Section: A Note on Style

There are many "right" ways to write cleanup in Go. The senior-level question is not "what is the absolutely correct pattern" but "what is consistent across my team and codebase?"

Pick a style. Document it. Enforce it via linters or code review. The team's cohesion is more valuable than the marginal difference between two equally valid patterns.

Example team styles:

- "Always use named returns for functions with deferred close that could fail."
- "Always defer `cancel()` immediately after `context.WithCancel/WithTimeout`."
- "Use `errors.Join` for multi-cleanup errors, not `multierror.Append`."
- "Components have a `Stop(ctx context.Context) error` method, not `Close`."

None of these is universally correct. All of them are correct for a team that picks them and sticks to them.

---

## Bonus Section: A Postcard from the Future

In a few years, Go may add language-level structured concurrency (similar to Kotlin's `coroutineScope` or Rust's `scoped_thread`). When that happens, some of the manual coordination this file describes will be subsumed by the language.

Until then: discipline, frameworks, and tests are the senior engineer's tools. Master them; teach them; build with them.

---

That is the senior file. Truly the end. The professional file picks up the runtime side; the specification, interview, tasks, find-bug, and optimize files cover the rest of the curriculum.

---

## Appendix: A Compact Recipe Card for Senior Engineers

```
SHUTDOWN CHECKLIST (per service)
================================
[ ] Signal handling via signal.NotifyContext
[ ] Fresh shutdown context, context.Background() with deadline
[ ] LifecycleManager owns all components
[ ] Components listed in dependency order (acquired first → released last)
[ ] Mark not-ready before shutdown begins
[ ] Wait 5s for LB to drain
[ ] Stop each component in reverse order
[ ] Each Stop wrapped with panic recovery (safeStop helper)
[ ] errors.Join collects all stop errors
[ ] Structured logs (slog) per step with elapsed time
[ ] Metrics: shutdown_duration_seconds{component=}
[ ] Soak test in CI asserts: no goroutine leak, all responses ok

PER COMPONENT
=============
[ ] Stop(ctx) signature
[ ] Idempotent via sync.Once
[ ] Honors ctx deadline
[ ] Stops in dependency order internally
[ ] Returns wrapped error
[ ] Has tests: goroutine leak, double-stop, deadline timeout

DOCUMENTATION
=============
[ ] Doc comment on Stop with order, idempotency, error contract
[ ] Architecture doc with shutdown order
[ ] Runbook with "what to look at if shutdown hangs"
```

Print this. Tape it next to your monitor. Refer to it before every new service goes to production.

---

## Appendix: An End-to-End Worked Example

For one final concrete example, here is a small but complete service that brings together the senior-level patterns. Read it carefully; every line is deliberate.

```go
package main

import (
    "context"
    "errors"
    "fmt"
    "log/slog"
    "net/http"
    "os"
    "os/signal"
    "sync"
    "syscall"
    "time"
)

// Component is the lifecycle interface.
type Component interface {
    Name() string
    Start(ctx context.Context) error
    Stop(ctx context.Context) error
}

// Manager orchestrates components.
type Manager struct {
    mu      sync.Mutex
    items   []Component
    started bool
    stopped bool
}

func (m *Manager) Add(c Component) {
    m.mu.Lock()
    defer m.mu.Unlock()
    m.items = append(m.items, c)
}

func (m *Manager) Start(ctx context.Context) error {
    m.mu.Lock()
    m.started = true
    items := m.items
    m.mu.Unlock()
    for i, c := range items {
        start := time.Now()
        if err := c.Start(ctx); err != nil {
            slog.Error("start failed", "component", c.Name(), "err", err)
            for j := i - 1; j >= 0; j-- {
                _ = items[j].Stop(context.Background())
            }
            return fmt.Errorf("start %s: %w", c.Name(), err)
        }
        slog.Info("started", "component", c.Name(), "elapsed", time.Since(start))
    }
    return nil
}

func (m *Manager) Stop(ctx context.Context) error {
    m.mu.Lock()
    if m.stopped {
        m.mu.Unlock()
        return nil
    }
    m.stopped = true
    items := m.items
    m.mu.Unlock()
    var errs []error
    for i := len(items) - 1; i >= 0; i-- {
        start := time.Now()
        if err := safeStop(items[i], ctx); err != nil {
            errs = append(errs, fmt.Errorf("stop %s: %w", items[i].Name(), err))
            slog.Error("stop failed", "component", items[i].Name(), "elapsed", time.Since(start), "err", err)
        } else {
            slog.Info("stopped", "component", items[i].Name(), "elapsed", time.Since(start))
        }
    }
    return errors.Join(errs...)
}

func safeStop(c Component, ctx context.Context) (err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("panic in %s.Stop: %v", c.Name(), r)
        }
    }()
    return c.Stop(ctx)
}

// HTTPComponent wraps an http.Server.
type HTTPComponent struct {
    server *http.Server
    done   chan struct{}
    once   sync.Once
    err    error
}

func NewHTTP(addr string, h http.Handler) *HTTPComponent {
    return &HTTPComponent{server: &http.Server{Addr: addr, Handler: h}, done: make(chan struct{})}
}

func (c *HTTPComponent) Name() string { return "http" }

func (c *HTTPComponent) Start(ctx context.Context) error {
    go func() {
        defer close(c.done)
        if err := c.server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
            slog.Error("listen", "err", err)
        }
    }()
    return nil
}

func (c *HTTPComponent) Stop(ctx context.Context) error {
    c.once.Do(func() {
        c.err = c.server.Shutdown(ctx)
        <-c.done
    })
    return c.err
}

// LoggerComponent is a placeholder for an async logger.
type LoggerComponent struct{ once sync.Once }

func (l *LoggerComponent) Name() string                    { return "logger" }
func (l *LoggerComponent) Start(ctx context.Context) error { return nil }
func (l *LoggerComponent) Stop(ctx context.Context) error {
    var err error
    l.once.Do(func() {
        time.Sleep(10 * time.Millisecond) // simulate flush
        slog.Info("logger flushed")
    })
    return err
}

func main() {
    ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
    defer stop()

    var m Manager
    m.Add(&LoggerComponent{}) // started first → stopped last
    m.Add(NewHTTP(":0", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        fmt.Fprintln(w, "hello")
    })))

    startCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
    if err := m.Start(startCtx); err != nil {
        slog.Error("start", "err", err)
        cancel()
        os.Exit(1)
    }
    cancel()

    <-ctx.Done()
    slog.Info("signal received")

    stopCtx, cancelStop := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancelStop()
    if err := m.Stop(stopCtx); err != nil {
        slog.Error("stop errors", "err", err)
        os.Exit(1)
    }
    slog.Info("clean shutdown")
}
```

This is roughly 130 lines of code. It includes:
- A `Component` interface.
- A `Manager` with idempotent Start/Stop, panic-safe stop, structured logging, ordering.
- Two example components: HTTP server and async logger.
- A `main` that wires signal handling, manager, and the shutdown context properly.

In production, you would add:
- Health-check endpoints.
- Metrics emission.
- Per-component deadlines.
- More components (DB, cache, etc.).
- Tests.

But the skeleton is here. Every senior Go service has something like this at its core.

---

## A Concluding Encouragement

Cleanup ordering can feel like bureaucratic overhead. Every service the same. Every test the same. Every doc comment the same.

That sameness is the point. Engineering at scale is not about novel solutions; it is about *repeated correctness*. A senior Go engineer's superpower is to make every service shut down the same way, and to make that way obviously right.

When you can read a colleague's service and immediately know how shutdown works because it follows the team's pattern; when you can write a new service in an afternoon because the lifecycle is boilerplate from a template; when your ops team never wakes up because of a leak — that is the senior-level outcome.

The professional file is for those who want to know how Go itself implements the primitives. But for most senior engineers, the discipline of this file is the destination.

Good luck. Build well.
