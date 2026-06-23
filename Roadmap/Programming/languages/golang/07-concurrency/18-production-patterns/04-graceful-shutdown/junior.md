---
layout: default
title: Junior
parent: Graceful Shutdown
grand_parent: Production Patterns
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/18-production-patterns/04-graceful-shutdown/junior/
---

# Graceful Shutdown — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros and Cons](#pros-and-cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use and Feature](#product-use-and-feature)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases and Pitfalls](#edge-cases-and-pitfalls)
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
29. [Diagrams and Visual Aids](#diagrams-and-visual-aids)

---

## Introduction
> Focus: "How do I make my Go program stop cleanly when someone presses Ctrl+C, when a deployment script restarts it, or when Kubernetes asks it to go away?"

A **graceful shutdown** is the act of bringing a program from "running and accepting work" down to "exited" in an orderly way: every request that was already in flight is allowed to finish, every open file or connection is closed, every buffered byte is flushed, and only then does the process terminate. The opposite is a *hard kill* — the program disappears mid-sentence, half-written rows stay in the database, partial responses arrive at clients, and somewhere a downstream queue is still holding a half-processed message.

For a small command-line script this distinction barely matters. For an HTTP server, a background worker, a database client, or any program you intend to deploy more than once, it is the single most important property of a "production-ready" program. The reason is simple: real systems get restarted. Often. Deploys, rolling upgrades, autoscaling, crash-loop backoffs, manual operator action — all produce a signal that tells your program "you have a few seconds, then I will end you." A graceful program uses those seconds well; an ungraceful one drops 5xx errors on its way out.

This file teaches the minimum vocabulary and the smallest concrete recipes:

- What a signal is and which ones matter (`SIGINT`, `SIGTERM`, `SIGKILL`).
- How to catch a signal in Go using `os/signal.Notify` and the newer `signal.NotifyContext`.
- What `context.Context` is, and how it carries the word "stop" from one place to many goroutines.
- How `http.Server.Shutdown` differs from `http.Server.Close`.
- How to combine those tools into a clean, copy-pastable `main` function for a small web service.

You do not need to know about Kubernetes lifecycle hooks, multi-server orchestration, `errgroup`, or the details of UNIX signal masks yet. Those come in the middle, senior, and professional files. This level is about the first time you write a `main` that you would not be embarrassed to deploy.

By the end of this file you will be able to:

- Press Ctrl+C in your terminal and see your server log "shutting down" rather than just disappear.
- Send `kill -TERM <pid>` from a deploy script and have the same effect.
- Write code that gives in-flight HTTP requests up to 30 seconds to finish.
- Avoid the three most common beginner mistakes: forgetting to `signal.Stop`, using `os.Exit` mid-handler, and blocking forever on a closed channel.

---

## Prerequisites

- **Required:** Go 1.16 or newer. `signal.NotifyContext` was added in Go 1.16 and is the recommended modern entry point. Go 1.21+ is best because of small `context` improvements.
- **Required:** Familiarity with `goroutines` and `channels`. You should be comfortable with `go f()`, `ch := make(chan T)`, and the basics of `select`.
- **Required:** A simple `net/http` server. If you have written `http.ListenAndServe(":8080", nil)` before, you have what you need.
- **Helpful:** Knowing what a UNIX signal is. If you have run `kill -9 <pid>` or pressed Ctrl+C, you have used signals.
- **Helpful:** A passing familiarity with `context.Context`. We re-introduce it here, but a five-minute look at `pkg.go.dev/context` first will help.
- **Not required:** Kubernetes, Docker, systemd, or any specific orchestration system. We mention them briefly; junior-level shutdowns work the same in any environment.

If you can write the four-line "hello-world" HTTP server and run it from a terminal, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Signal** | A small numeric message the operating system sends to a process. Used for everything from "user pressed Ctrl+C" to "you have used too much CPU." On Linux there are 30+, but for graceful shutdown only a handful matter. |
| **SIGINT** | Signal 2. "Interrupt." Sent by the terminal when the user presses Ctrl+C. The default action is to terminate the process. You can catch it. |
| **SIGTERM** | Signal 15. "Terminate." The polite "please stop" signal. Sent by `kill <pid>` with no flags, by systemd, by Docker, and by Kubernetes as the first step of pod termination. The default action is to terminate, but you can catch it. |
| **SIGKILL** | Signal 9. "Kill." The unstoppable terminator. You cannot catch, block, or ignore it. The kernel just removes your process. Sent as the *last resort* if you do not exit in time. |
| **SIGHUP** | Signal 1. "Hangup." Historically meant "the terminal disconnected." Many daemons reuse it to mean "reload configuration." Not strictly a shutdown signal, but worth recognising. |
| **`os/signal` package** | The Go standard library package for asking the runtime to deliver signals to your code as channel values rather than as the default behaviour. |
| **`signal.Notify(ch, sigs...)`** | Registers channel `ch` to receive any signal in `sigs`. After this call, `SIGTERM` etc. no longer terminate the program; they appear as values on `ch`. |
| **`signal.NotifyContext(parent, sigs...)`** | The 1.16+ ergonomic helper: returns a derived context that is *cancelled* when any of the given signals arrives. Replaces a lot of boilerplate. |
| **Graceful shutdown** | The process of stopping a server while letting in-flight work finish. For HTTP servers in Go, the canonical method is `(*http.Server).Shutdown(ctx)`. |
| **Drain** | The act of refusing new work while letting existing work finish. A drained server returns 503 (or doesn't accept connections) to new clients while still completing in-flight requests. |
| **`context.Context`** | The Go standard interface for carrying cancellation and deadlines across API boundaries. A cancelled context is the universal "stop now" signal that goroutines should watch. |
| **`context.WithCancel`** | Creates a derived context plus a `cancel()` function. Calling `cancel()` causes `ctx.Done()` to close and `ctx.Err()` to return `context.Canceled`. |
| **`context.WithTimeout`** | Creates a derived context that cancels automatically after a duration. Used to put a maximum time budget on shutdown. |
| **`http.Server.Shutdown(ctx)`** | The method that gracefully stops an `http.Server`: closes listeners, then waits for active connections to become idle. Bounded by `ctx`'s deadline. |
| **`http.Server.Close()`** | Hard close — interrupts active connections immediately. Use only if `Shutdown` itself times out. |
| **In-flight request** | A request whose handler has started but not yet returned. The whole point of graceful shutdown is to let these finish. |
| **PID** | Process ID. The number the operating system uses to identify your process. Required by the `kill` command. |
| **`terminationGracePeriodSeconds`** | The Kubernetes setting (default 30 seconds) that controls how long the kubelet waits between sending `SIGTERM` and falling back to `SIGKILL`. You touch this briefly here and in detail at the middle/senior level. |

---

## Core Concepts

### A process does not naturally know "it is time to stop"

A long-running program — a web server, a worker, a daemon — has no built-in clock. It runs forever, or until something external interrupts it. That "something external" is almost always a *signal* delivered by the operating system.

The default behaviour of most fatal signals is to terminate the process immediately, with no cleanup. To take advantage of a signal — to use the moment it arrives as an opportunity to clean up — you must explicitly ask the runtime to *deliver it to your code* rather than acting on it directly. In Go, that ask is `signal.Notify` or, more often these days, `signal.NotifyContext`.

```go
ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
defer stop()
```

After this line, pressing Ctrl+C (which sends `SIGINT`) or running `kill <pid>` (which sends `SIGTERM`) no longer kills the program. Instead, the `ctx` value is *cancelled*. Anywhere your code calls `<-ctx.Done()` or checks `ctx.Err()`, it now sees the cancellation. That is the trigger you use to start your shutdown sequence.

### Signals you can catch and signals you cannot

There are exactly two signals you cannot catch: **`SIGKILL`** (signal 9) and **`SIGSTOP`** (signal 19). The kernel acts on them directly and your process never sees them. Every other signal can be intercepted.

For graceful shutdown, the signals that matter are:

| Signal | Number | Source | What it means |
|--------|--------|--------|---------------|
| `SIGINT` | 2 | Terminal Ctrl+C | "User wants to stop." Catch it. |
| `SIGTERM` | 15 | `kill <pid>`, K8s, systemd, Docker | "Please exit." Catch it. |
| `SIGKILL` | 9 | `kill -9`, K8s timeout | "You are gone." Cannot catch. |
| `SIGHUP` | 1 | Terminal close, configured reload | "Reload" or "hang up." Often reused. |
| `SIGQUIT` | 3 | Terminal Ctrl+\\ | "Dump core and exit." Often left alone. |

The minimum viable shutdown handler catches `SIGINT` and `SIGTERM`. Catching `SIGTERM` is what makes the program work in a production environment; catching `SIGINT` is what makes it work on your laptop.

### The two-phase shape of every graceful shutdown

Every shutdown, no matter the program, has two phases:

1. **Stop accepting new work.** New requests are rejected, new jobs are not dequeued, new connections are not opened. This is sometimes called "drain start" or "begin shedding."
2. **Wait for in-flight work to finish, with a deadline.** The currently running handlers, jobs, and connections are allowed to finish, but only for a bounded time. If they do not finish within the budget, force-kill what is left.

Phase 1 alone is not enough — you would still have to wait somehow. Phase 2 alone is not enough — without phase 1, new work keeps arriving and you never reach idle. The two-phase pattern is what gives you both correctness and bounded latency.

In Go's HTTP world, `http.Server.Shutdown(ctx)` implements *both* phases in one call. It stops the listener (phase 1) and then waits for active handlers (phase 2). The deadline comes from the `ctx` you pass in.

### `http.Server.Shutdown` vs `http.Server.Close`

```go
// Graceful: lets in-flight requests finish, up to ctx's deadline.
srv.Shutdown(ctx)

// Brutal: yanks the rug, every active connection is interrupted.
srv.Close()
```

`Shutdown` returns `nil` when all listeners are closed and all idle and active connections have finished, or returns `ctx.Err()` if the context is cancelled or its deadline is reached. The usual pattern is to call `Shutdown` first; if it returns a non-nil error (typically `context.DeadlineExceeded`), fall back to `Close` so the process can exit at all.

### `context.Context` is the messenger

A typical small program has a server, plus a handful of background goroutines (a metrics flusher, a queue consumer, a cache refresher). When the signal arrives, *every* one of these needs to be told to stop. The universally idiomatic way to broadcast that message in Go is `context.Context`.

```go
ctx, cancel := context.WithCancel(context.Background())
go startMetricsLoop(ctx)
go startQueueConsumer(ctx)
go startCacheRefresher(ctx)
// later, when a signal arrives:
cancel() // every goroutine sees ctx.Done() close
```

Each goroutine watches `ctx.Done()` in its main loop and returns when it fires. We will see the full pattern in [Code Examples](#code-examples).

### The deadline rule: never wait forever

A graceful shutdown that has no upper bound is no better than no shutdown at all. If your `Shutdown` call can block for an hour because one handler is stuck on a misbehaving downstream, Kubernetes (or your operator) will eventually `SIGKILL` your process anyway — usually right in the middle of *something else*. The right pattern is:

```go
shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
defer cancel()
if err := srv.Shutdown(shutdownCtx); err != nil {
    log.Printf("graceful shutdown failed: %v; forcing close", err)
    _ = srv.Close()
}
```

The 30-second figure is conventional: it is the default `terminationGracePeriodSeconds` in Kubernetes, which is the wider time budget your process is operating inside.

### Where to handle the signal: in `main`, not in handlers

There is exactly one place in any program where the signal subscription belongs: the top-level `main` function (or a single supervising function it calls). Subscribing in multiple places is a recipe for confusion, double cancellation, and missed signals. The pattern is:

- `main` calls `signal.NotifyContext` once.
- `main` passes the returned context down to everything that may need to be cancelled.
- Goroutines and handlers do not subscribe to signals themselves; they only observe `ctx.Done()`.

---

## Real-World Analogies

### A retail store closing time

The store closes at 9:00 PM. At 8:50, an announcement plays: "the store will close in ten minutes; please bring your purchases to the register." At 9:00, the front doors are locked — no new customers may enter, but everyone already inside still gets to check out. At 9:15, the staff politely escort the last few customers who are still browsing toward the exit. At 9:30, the lights go out.

That is graceful shutdown. The announcement is the readiness probe flipping to "not ready." The locked door is the stopped listener. The 15 minutes of grace are the `Shutdown` deadline. The escort is the force-close fallback. The lights going out is `os.Exit`.

### A pilot landing an aircraft after a fuel warning

When the warning light comes on, the pilot does not immediately cut the engine. They reduce throttle, stop accepting new altitude changes from air traffic control, complete the current approach, and land. The 30 seconds between the warning and the touchdown are the equivalent of `terminationGracePeriodSeconds`. The "do not accept further course changes" is the listener close. The "complete the current approach" is the in-flight request drain. The "land" is `os.Exit(0)`.

### A bartender at last call

"Last call" is announced ten minutes before close. Bartender stops accepting new drink orders (drain), but still pours and serves the drinks already ordered (in-flight requests). When everyone has finished and paid, the doors lock and the lights go out. If a customer is still nursing a drink at closing time, the bartender politely takes it away (force-close after deadline). The whole choreography is bounded — there is no scenario where last call lasts forever.

### A restaurant during a power outage warning

The power company calls: "we will cut power in fifteen minutes." The kitchen stops accepting new orders. The wait staff finish serving the dishes already in progress. The cashiers process payments. Anything not finished by minute fifteen will not be finished tonight at all. This is the time-bounded shutdown model — you do not get to negotiate for more time.

---

## Mental Models

### Model 1: The signal is the only asynchronous trigger in `main`

In most small Go programs, `main` is largely synchronous: configure, start, wait, stop. The *one* asynchronous event in that lifecycle is "a signal arrives." Treat it as such: subscribe to it at the top of `main`, block on it in the middle of `main`, and trigger shutdown when it returns.

```go
func main() {
    cfg := loadConfig()
    srv := buildServer(cfg)

    ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
    defer stop()

    go func() { _ = srv.ListenAndServe() }()

    <-ctx.Done() // the only asynchronous wait in main

    shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()
    _ = srv.Shutdown(shutdownCtx)
}
```

Read top to bottom, this main does the four things every server main does: configure, start serving, wait for stop, drain.

### Model 2: A context is a chain that cancels from the top

Picture a tree of contexts:

```
                  ctx (from signal.NotifyContext)
                 /         |               \
            serverCtx   workerCtx        cacheCtx
              /              \                  \
       requestCtx          taskCtx           refreshCtx
```

When the signal arrives, `ctx` is cancelled, and every descendant context is cancelled too. Every goroutine that watches `ctx.Done()` — directly or through a derived context — observes the cancellation and unwinds. This is the same chain-of-cancellation pattern you already use for request timeouts; shutdown just cancels at the root.

### Model 3: Two clocks, not one

When a shutdown begins, two clocks start. The first is the *program's* shutdown deadline (the `context.WithTimeout` you control). The second is the *environment's* deadline — the OS, the orchestrator, the operator — which will SIGKILL you eventually if you do not exit. Your clock must always be *shorter* than theirs. If Kubernetes will SIGKILL after 30 seconds, your `Shutdown` deadline should be 25 seconds, not 30. Give yourself a margin.

### Model 4: Phase 1 (drain) is for the network; phase 2 (wait) is for the goroutines

Phase 1 is about the *network surface*: stop the listener, stop the dequeue, stop the cron tick. Phase 2 is about *in-flight work*: every request handler, every worker job, every refresh loop has to either notice the cancellation and exit, or run to natural completion. Both phases have to happen, in that order, every time.

---

## Pros and Cons

### Pros

- **No dropped requests.** Clients in the middle of a request still get their response. This shows up in your error rate as a flat zero instead of a 5xx spike at every deploy.
- **No data corruption.** Half-written database rows, half-acknowledged queue messages, and half-flushed files are avoided.
- **Predictable deploys.** Rolling updates do not produce a noisy alert storm. Your team can deploy at 4 PM Friday without dread.
- **Observability.** The shutdown is a deliberate event you can log and time, instead of a silent disappearance.
- **Cooperation with orchestrators.** Kubernetes, systemd, Docker all assume the program will exit cleanly on `SIGTERM`. Cooperating gets you smoother behaviour everywhere.

### Cons

- **More code.** A program that handles a signal, drains, and exits is longer than one that does not. The boilerplate is real, even if small.
- **More test surface.** You now have to test "what happens when I cancel mid-request." Unit tests cover the happy path; integration tests cover the drain.
- **Edge cases.** Stuck handlers, slow downstreams, partial commits — all become *your* problem. With a hard kill, the OS handled it.
- **Latency on shutdown.** A graceful shutdown is by definition slower than a hard kill. In a deploy with 100 pods, a 20-second drain per pod (if not parallelised) is 33 minutes of restart time.
- **Possible to get wrong.** A buggy graceful shutdown that hangs forever is *worse* than no graceful shutdown at all. We will see plenty of examples.

---

## Use Cases

- **HTTP API servers.** The most common case. One `http.Server`, one signal handler, one `Shutdown` call. Drop your error rate to zero across deploys.
- **gRPC servers.** Same pattern, but with `grpc.Server.GracefulStop()` instead of `http.Server.Shutdown`.
- **Background workers.** A queue consumer that processes messages and acks them. Graceful shutdown means "finish the message in hand, do not pull a new one."
- **Cron-like schedulers.** A program that ticks every minute. Shutdown means "stop the tick, let the current iteration finish."
- **Daemons reading from sockets.** A long-poll consumer, a websocket gateway, a TCP relay. Shutdown means "close the listener, close idle clients, wait for active clients with a deadline."
- **Local CLI tools that own a server.** Even a `go run` program that you Ctrl+C should clean up: close DB connections, flush logs, save state.
- **Tests.** When `t.Cleanup` fires at the end of a test, the test server it started should shut down — graceful shutdown is the same machinery.

---

## Code Examples

### Example 1 — The minimum viable graceful HTTP server

```go
package main

import (
    "context"
    "errors"
    "log"
    "net/http"
    "os/signal"
    "syscall"
    "time"
)

func main() {
    mux := http.NewServeMux()
    mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
        time.Sleep(2 * time.Second) // simulate slow work
        w.Write([]byte("hello\n"))
    })

    srv := &http.Server{
        Addr:    ":8080",
        Handler: mux,
    }

    // Step 1: subscribe to shutdown signals
    ctx, stop := signal.NotifyContext(context.Background(),
        syscall.SIGINT, syscall.SIGTERM)
    defer stop()

    // Step 2: start serving in a goroutine
    go func() {
        log.Println("listening on :8080")
        if err := srv.ListenAndServe(); err != nil &&
            !errors.Is(err, http.ErrServerClosed) {
            log.Fatalf("server error: %v", err)
        }
    }()

    // Step 3: wait for a signal
    <-ctx.Done()
    log.Println("shutdown signal received")

    // Step 4: drain with a deadline
    shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()
    if err := srv.Shutdown(shutdownCtx); err != nil {
        log.Printf("graceful shutdown failed: %v; forcing close", err)
        _ = srv.Close()
    }
    log.Println("server exited cleanly")
}
```

This file is the smallest "production-shaped" Go HTTP server. Press Ctrl+C while a request is in flight; the request still completes, the log line "server exited cleanly" prints, and the process exits with status 0.

### Example 2 — Why `errors.Is(err, http.ErrServerClosed)` matters

`srv.ListenAndServe()` always returns a non-nil error. After a successful `Shutdown`, it returns the sentinel `http.ErrServerClosed`. If you log that as an error, you will spam your logs every shutdown. The idiom is:

```go
if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
    log.Fatalf("server error: %v", err)
}
```

If you forget the check, you will see "http: Server closed" as an ERROR-level line every deploy — confusing, and a noisy alert source.

### Example 3 — Manually with `signal.Notify` (older style)

`signal.NotifyContext` is the modern way. For completeness, the pre-1.16 idiom looked like this:

```go
sigCh := make(chan os.Signal, 1)
signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
defer signal.Stop(sigCh)

go func() { _ = srv.ListenAndServe() }()

<-sigCh
shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
defer cancel()
_ = srv.Shutdown(shutdownCtx)
```

Two things to notice. First, the channel is buffered (`make(chan os.Signal, 1)`) — `signal.Notify` is non-blocking and drops signals if the channel is full. A buffered channel makes sure the first signal is never dropped. Second, `defer signal.Stop(sigCh)` is required to deregister the channel, otherwise the runtime keeps a reference and the channel is never garbage-collected.

Both `signal.NotifyContext` and the manual form work fine. New code should prefer `NotifyContext` for ergonomics.

### Example 4 — A background goroutine that also shuts down

Most real services have more than just an HTTP server. Here is a typical background goroutine joined to the same lifecycle:

```go
func main() {
    ctx, stop := signal.NotifyContext(context.Background(),
        syscall.SIGINT, syscall.SIGTERM)
    defer stop()

    srv := &http.Server{Addr: ":8080", Handler: buildMux()}

    go runHTTP(srv)
    go runMetricsFlusher(ctx)
    go runQueueConsumer(ctx)

    <-ctx.Done()
    shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()
    _ = srv.Shutdown(shutdownCtx)
}

func runMetricsFlusher(ctx context.Context) {
    t := time.NewTicker(10 * time.Second)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            log.Println("metrics flusher exiting")
            return
        case <-t.C:
            flushMetrics()
        }
    }
}
```

Notice: each background goroutine takes a `ctx` and watches its `Done()` channel. The `select` pattern is universal — every long-running goroutine in Go looks like this.

### Example 5 — Why `time.Sleep` in a goroutine is a shutdown problem

```go
// BAD
func runRefresher(ctx context.Context) {
    for {
        if ctx.Err() != nil { return }
        refresh()
        time.Sleep(10 * time.Second) // not cancellable!
    }
}
```

`time.Sleep` does not observe `ctx`. If the signal arrives one second after the sleep started, the goroutine sleeps for the remaining nine seconds before noticing. Multiply by every refresher in your program and your shutdown takes ten seconds longer than it should.

The fix is `time.NewTicker` (or `time.After` in a `select`, with care):

```go
func runRefresher(ctx context.Context) {
    t := time.NewTicker(10 * time.Second)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            refresh()
        }
    }
}
```

### Example 6 — A `cancel()` you forget to call

```go
ctx, cancel := context.WithCancel(parent)
go doWork(ctx)
// forgot to call cancel() — leaks!
```

Every `context.WithCancel` returns a `cancel` function that *must* be called. Forgetting it leaks the internal context tree until the parent is cancelled. The idiom is always `defer cancel()` immediately after the call:

```go
ctx, cancel := context.WithCancel(parent)
defer cancel()
go doWork(ctx)
```

For `signal.NotifyContext`, the returned `stop` function plays the same role. Always `defer stop()`.

### Example 7 — The shape of a complete `main`

Putting it together:

```go
func main() {
    if err := run(); err != nil {
        log.Fatalf("fatal: %v", err)
    }
}

func run() error {
    cfg := mustLoadConfig()
    db, err := openDB(cfg.DBURL)
    if err != nil {
        return fmt.Errorf("open db: %w", err)
    }
    defer db.Close()

    srv := newServer(cfg, db)

    ctx, stop := signal.NotifyContext(context.Background(),
        syscall.SIGINT, syscall.SIGTERM)
    defer stop()

    serverErr := make(chan error, 1)
    go func() {
        if err := srv.ListenAndServe(); err != nil &&
            !errors.Is(err, http.ErrServerClosed) {
            serverErr <- err
            return
        }
        serverErr <- nil
    }()

    select {
    case <-ctx.Done():
        log.Println("signal received; shutting down")
    case err := <-serverErr:
        return fmt.Errorf("server crashed: %w", err)
    }

    shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()
    if err := srv.Shutdown(shutdownCtx); err != nil {
        _ = srv.Close()
        return fmt.Errorf("shutdown: %w", err)
    }
    return nil
}
```

The split between `main` and `run` is a small idiom that pays off: `main` calls `os.Exit` through `log.Fatalf`, but all the deferred cleanup runs inside `run`. Without this split, a `log.Fatalf` inside `main` skips deferred `db.Close()`.

### Example 8 — Catching `SIGHUP` for reload

This is not strictly graceful shutdown, but it uses the same machinery and is a common follow-up question:

```go
sigCh := make(chan os.Signal, 1)
signal.Notify(sigCh, syscall.SIGHUP, syscall.SIGINT, syscall.SIGTERM)

for {
    s := <-sigCh
    switch s {
    case syscall.SIGHUP:
        log.Println("reloading config")
        reloadConfig()
    case syscall.SIGINT, syscall.SIGTERM:
        log.Println("shutting down")
        return
    }
}
```

`SIGHUP` is reused by many daemons (`nginx`, `postgres`, `rsyslog`) to mean "reload." It is fine to do the same in Go.

---

## Coding Patterns

### Pattern: `signal.NotifyContext` for new code

Use it. It is the simplest correct way to wire a signal to a cancellation tree.

```go
ctx, stop := signal.NotifyContext(context.Background(),
    syscall.SIGINT, syscall.SIGTERM)
defer stop()
```

The returned `stop` function deregisters the signal handler and releases internal resources. Always `defer stop()`.

### Pattern: pass `ctx` everywhere

Every goroutine, every long-running call, every blocking I/O should accept a `ctx`. This is the lingua franca of cancellation in Go.

```go
go runWorker(ctx, q)
db.QueryContext(ctx, "...")
http.NewRequestWithContext(ctx, "GET", url, nil)
```

If a function takes a `ctx`, it can be cancelled. If it does not, it cannot. That simple rule is enough.

### Pattern: separate "stop the source" from "drain the sink"

Stopping the listener is a one-line call. Draining the connections is the slow part. Treat them as two steps in the code, even if you call them through one `Shutdown` call.

```go
log.Println("draining listener")
shutdownCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
defer cancel()
if err := srv.Shutdown(shutdownCtx); err != nil {
    log.Printf("drain timed out: %v", err)
    _ = srv.Close()
}
log.Println("drained")
```

### Pattern: a tiny `runErr` wrapper

A neat trick for keeping `main` short:

```go
type errCh chan error

func startHTTP(srv *http.Server) errCh {
    out := make(errCh, 1)
    go func() {
        if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
            out <- err
        }
        close(out)
    }()
    return out
}
```

In `main`:

```go
errs := startHTTP(srv)
select {
case <-ctx.Done():
case err := <-errs:
    log.Printf("server error: %v", err)
}
```

This pattern generalises: each subsystem starts in its goroutine and returns an `errCh`. `main` selects on `ctx.Done()` plus all `errCh`s.

### Pattern: a wait-for-all pattern with `sync.WaitGroup`

For a small number of background goroutines:

```go
var wg sync.WaitGroup
wg.Add(2)
go func() { defer wg.Done(); runMetrics(ctx) }()
go func() { defer wg.Done(); runQueueConsumer(ctx) }()

<-ctx.Done()
shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
defer cancel()
_ = srv.Shutdown(shutdownCtx)

done := make(chan struct{})
go func() { wg.Wait(); close(done) }()
select {
case <-done:
case <-shutdownCtx.Done():
    log.Println("background goroutines did not exit in time")
}
```

The dance with `done` is the standard way to put a timeout on `wg.Wait`, which has no timeout method of its own.

### Pattern: never `os.Exit` mid-handler

Calling `os.Exit` skips all `defer`s and kills every goroutine instantly. Reserve it for `log.Fatalf` at the very top of `main` (or `main` itself, after all defers).

```go
// BAD inside a handler
if err := critical(); err != nil {
    log.Fatalf("...") // skips defers, drops in-flight requests
}

// OK
if err := critical(); err != nil {
    return err
}
```

---

## Clean Code

### Keep `main` short

A well-shaped `main` for a service is rarely longer than 30 lines: parse args, build dependencies, start the server, wait, shut down. Everything else lives in helper functions. If `main` is 200 lines long, you have a maintenance problem.

### Name the lifecycle stages

`bootstrap`, `start`, `serve`, `shutdown`, `cleanup`. Naming these in your code makes the lifecycle visible. Reviewers can follow the flow without re-reading.

### One signal subscription point

Subscribing to signals in two places is a recipe for confusion. Centralise it in `main` (or a top-level `Run` function). Pass the resulting context down.

### Logs are the timeline

Log at every transition: "server starting," "signal received," "draining," "drained," "exited." When a deploy goes wrong at 3 AM, these log lines tell the on-call engineer exactly which step hung.

```go
log.Println("server starting on :8080")
// ...
log.Println("signal received; draining")
// ...
log.Println("drained; exiting")
```

### Make the deadline a named constant

`30*time.Second` sprinkled across the codebase is harder to tune than `const ShutdownTimeout = 30 * time.Second`.

```go
const ShutdownTimeout = 30 * time.Second

shutdownCtx, cancel := context.WithTimeout(context.Background(), ShutdownTimeout)
defer cancel()
```

### Test the shutdown path

A small integration test that spins up the server, sends `SIGTERM`, and asserts the process exits within X seconds is the cheapest defence against future regressions.

---

## Product Use and Feature

Graceful shutdown is the kind of feature your users *do not notice when it works* and *complain loudly about when it does not*. The most visible places its absence shows up:

- **Deploy spikes in error rate.** Every rolling update produces a brief 5xx spike. The on-call dashboard graphs jump every deploy. Customers may not notice individually but support tickets accumulate.
- **Payment double-charges and other "did it commit or not" bugs.** A hard kill mid-handler leaves the database row committed but the response never sent. The client retries; the merchant gets two charges.
- **Background-job duplication.** A worker pulled a job, was killed mid-processing, the job goes back on the queue, and another worker re-processes it. Idempotency saves you only if you have it.
- **Hung integration tests.** A test starts a server, sends a request, ends — but the server is still running, holding ports, blocking the next test.

A team that has not yet adopted graceful shutdown will recognise these symptoms. The fix is rarely complicated; the hard part is convincing everyone to do it consistently.

### Feature flags and shutdown

Some teams gate behaviour behind a feature flag service. The flag client itself is a long-running goroutine that polls. When shutdown begins, this client must also stop, or you will see "leaking goroutine" warnings in the logs at the end of each run. The pattern is the same: take a context, watch its `Done()`, return.

### Observability

A few metrics that pay for themselves:

- `shutdown_started` (counter) — increments when the signal fires.
- `shutdown_duration_seconds` (histogram) — observes the time from signal to exit.
- `inflight_requests_at_shutdown_start` (gauge) — useful for diagnosing slow drains.
- `inflight_requests_at_shutdown_end` (gauge) — non-zero means force-close happened.

These show up in the next pages; at the junior level, *any* log message at start and end of shutdown is enough.

---

## Error Handling

### What can fail during shutdown

1. `srv.Shutdown(ctx)` returns `context.DeadlineExceeded` — the drain did not finish in time.
2. `srv.Shutdown(ctx)` returns a `*net.OpError` — a network error closing one of the listeners.
3. A handler panics during drain — it should still complete (with `panic` recovered by the default `http.Server` recover, but check your middleware).
4. A background goroutine ignores the context and keeps running — leak.
5. `os.Exit` is called somewhere in the chain — bypasses every `defer`.

### A robust shutdown error path

```go
shutdownCtx, cancel := context.WithTimeout(context.Background(), ShutdownTimeout)
defer cancel()

err := srv.Shutdown(shutdownCtx)
switch {
case err == nil:
    log.Println("graceful shutdown complete")
case errors.Is(err, context.DeadlineExceeded):
    log.Println("shutdown deadline exceeded; forcing close")
    _ = srv.Close()
default:
    log.Printf("shutdown error: %v; forcing close", err)
    _ = srv.Close()
}
```

### Do not panic in shutdown code

Panics in shutdown are catastrophic — they propagate up, skip your remaining defers, and leave resources dangling. Wrap risky shutdown steps in `recover` if they call into third-party code that may panic:

```go
defer func() {
    if r := recover(); r != nil {
        log.Printf("panic during shutdown: %v", r)
    }
}()
```

---

## Security Considerations

### Signals can be sent by anyone with the right privileges

On UNIX, a signal can be sent by any process with the same UID (or by root). A malicious actor with shell access to your container has free rein anyway, but the principle matters: do not rely on signals as a *security* mechanism. They are a *coordination* mechanism.

### Do not log secrets at shutdown

Shutdown is a good time to dump state for diagnostics. It is *not* a good time to log the database password, the API key, or the JWT signing secret. Sanitise carefully.

### Mid-shutdown is when many TOCTOU bugs surface

"Time of check, time of use" bugs can be triggered by a shutdown that races with a request. If `shutdown` flips a global flag and a handler checks it but then keeps going, there is a brief window where the handler is operating after shutdown has begun. Defensive coding helps: pass the context through, do not rely on shared booleans.

### Avoid letting clients escalate to slow-loris-during-shutdown

A malicious client that keeps a connection open with no progress can prolong your `Shutdown` until the deadline. The drain timeout is your defence; configure `ReadHeaderTimeout`, `ReadTimeout`, `WriteTimeout` on the `http.Server` to ensure handlers do not wait forever for slow clients.

```go
srv := &http.Server{
    Addr:              ":8080",
    Handler:           mux,
    ReadHeaderTimeout: 5 * time.Second,
    ReadTimeout:       30 * time.Second,
    WriteTimeout:      30 * time.Second,
    IdleTimeout:       120 * time.Second,
}
```

---

## Performance Tips

### Shorter drain = faster deploys

A typical shutdown takes the longer of (a) the slowest in-flight handler and (b) your shutdown deadline. Reducing per-handler tail latency (e.g. via per-request timeouts) makes shutdown faster.

### Drain in parallel where possible

If you have multiple subsystems to shut down — HTTP server, gRPC server, worker pool — start their shutdowns concurrently, then wait for all to finish. We will see the `errgroup` pattern at the middle level. For now, simple `WaitGroup` + goroutines is enough.

### Closing idle connections does not require waiting

`http.Server.Shutdown` immediately closes idle connections (keep-alives with no active request). It only waits on connections with active handlers. If your server has 1000 idle keep-alives and 5 active handlers, shutdown is fast.

### Avoid heavy allocation in shutdown handlers

The shutdown path is not a place to allocate megabytes of buffers or start new goroutines. Keep it simple. Logging, closing files, calling `cancel()` — that is the whole vocabulary.

### `cancel()` is cheap; call it eagerly

`context.CancelFunc` is idempotent. Calling it twice is a no-op. Calling it always (via `defer cancel()`) is the safe default.

---

## Best Practices

1. **Use `signal.NotifyContext` for new code.** It is the modern, less-error-prone API.
2. **Always `defer stop()` / `defer cancel()` after `NotifyContext` / `WithCancel` / `WithTimeout`.** Forgetting to deregister is a slow leak.
3. **Subscribe to signals in `main` only.** Never in a library, never in a handler.
4. **Catch at minimum `SIGINT` and `SIGTERM`.** Anything less and your program will not work in a typical container environment.
5. **Bound `Shutdown` with `context.WithTimeout`.** Never call `Shutdown` with a `context.Background()`.
6. **Log start, signal, drain, exit.** Four lines, every program.
7. **Treat `http.ErrServerClosed` as success, not error.** `errors.Is` makes this explicit.
8. **Fall back to `Close` if `Shutdown` times out.** Always have a Plan B.
9. **Wrap `main` body in a helper that returns `error`.** Lets you `defer` cleanup safely.
10. **Pass `ctx` to every goroutine.** No exceptions for "this one is short."
11. **Use named constants for timeouts.** `const ShutdownTimeout = 30 * time.Second`.
12. **Run a goroutine leak test.** A simple test that asserts `runtime.NumGoroutine` returns to baseline catches forgotten cancellations.
13. **Never `os.Exit` mid-handler.** Reserve it for `log.Fatalf` at the top of `main`.
14. **Configure `Server` timeouts.** `ReadTimeout`, `WriteTimeout`, `IdleTimeout` keep slow clients from prolonging shutdown.
15. **Drain in parallel** if you have more than one subsystem.

---

## Edge Cases and Pitfalls

### Pitfall 1 — Signal arrives before `Notify` is registered

If `signal.Notify` is called after the signal has already arrived (because some other startup code is slow), the first delivery is lost. The fix is to register the handler as early as possible in `main`, before any heavyweight initialisation.

### Pitfall 2 — `signal.Notify` channel is unbuffered

If the channel passed to `signal.Notify` is unbuffered and your code is not currently reading it, the signal is *dropped*. Always use a buffered channel of size 1 (or use `NotifyContext`, which handles this for you).

### Pitfall 3 — `<-ctx.Done()` in a loop without re-checking

```go
for {
    select {
    case <-ctx.Done():
        return
    case msg := <-msgs:
        process(msg) // long-running, doesn't observe ctx
    }
}
```

`process` itself must observe `ctx`, or the loop is "shutdown-aware" only at the message boundary.

### Pitfall 4 — `Shutdown` returns before background goroutines exit

`http.Server.Shutdown` returns when the HTTP layer is drained. It does *not* wait for your background goroutines (metrics flushers, queue consumers, refresh loops). Those need their own join.

### Pitfall 5 — Calling `Shutdown` more than once

`http.Server.Shutdown` returns `http.ErrServerClosed` on subsequent calls. Safe but useless. Make sure only one shutdown path can execute.

### Pitfall 6 — Calling `srv.ListenAndServe` after `Shutdown`

Restart attempts on the same `*http.Server` after `Shutdown` fail with `http.ErrServerClosed`. Build a new `*http.Server` to restart.

### Pitfall 7 — Forgotten `signal.Stop`

Channels passed to `signal.Notify` retain a reference in the runtime until `signal.Stop` is called. Forgetting it leaks the channel. `signal.NotifyContext`'s `stop` function does this for you.

### Pitfall 8 — Catching too many signals

Catching `SIGQUIT`, `SIGUSR1`, `SIGCHLD`, and so on, "just in case," interferes with debugging tools (`SIGQUIT` dumps stacks) and subprocess management. Catch only what you handle.

### Pitfall 9 — Handlers that block on locks

A handler holding a database connection from a small pool can deadlock during shutdown if the pool is closed before the handler finishes. Close the database *after* the HTTP server is drained.

### Pitfall 10 — `panic` in a goroutine you do not own

A panic in any goroutine takes the whole process down. During shutdown, a panic in a worker that was already shutting down can mask the real shutdown sequence. Recover at the top of every goroutine you spawn.

---

## Common Mistakes

### Mistake 1 — Using `os.Exit(0)` instead of returning from `main`

`os.Exit` skips all `defer`s. Any open file, DB connection, or buffered logger you were going to flush gets dropped. The fix is to return from `main` (or via `run() error`) and let normal cleanup happen.

```go
// BAD
func main() {
    setup()
    serve()
    os.Exit(0) // skips defers
}

// GOOD
func main() {
    setup()
    serve()
    // implicit return — defers run
}
```

### Mistake 2 — Calling `signal.Notify` with an unbuffered channel

```go
// BAD
ch := make(chan os.Signal) // size 0
signal.Notify(ch, syscall.SIGINT)

// GOOD
ch := make(chan os.Signal, 1)
signal.Notify(ch, syscall.SIGINT)
```

### Mistake 3 — Forgetting `errors.Is(err, http.ErrServerClosed)`

```go
// BAD
if err := srv.ListenAndServe(); err != nil {
    log.Fatalf("server: %v", err) // fires on every clean shutdown
}

// GOOD
if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
    log.Fatalf("server: %v", err)
}
```

### Mistake 4 — Calling `Shutdown` with `context.Background()`

```go
// BAD — unbounded
_ = srv.Shutdown(context.Background())

// GOOD
ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
defer cancel()
_ = srv.Shutdown(ctx)
```

### Mistake 5 — Treating Ctrl+C as if it were `SIGKILL`

Ctrl+C is `SIGINT`. It is catchable. Treat it the same as `SIGTERM`. If your program disappears immediately on Ctrl+C, you have not wired the signal correctly.

### Mistake 6 — Goroutine that ignores context

```go
// BAD
go func() {
    for {
        doWork()
        time.Sleep(5 * time.Second)
    }
}()

// GOOD
go func() {
    t := time.NewTicker(5 * time.Second)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            doWork()
        }
    }
}()
```

### Mistake 7 — Closing the database before shutting down the HTTP server

```go
// BAD — handlers still using db will panic
defer db.Close()
_ = srv.Shutdown(ctx) // handlers may still be running

// GOOD — close db after Shutdown returns
_ = srv.Shutdown(ctx)
db.Close()
```

### Mistake 8 — Using global state for "is shutting down"

```go
// BAD
var shuttingDown bool
// any goroutine checks; nothing writes safely

// GOOD
// pass context.Context; observe ctx.Err()
```

### Mistake 9 — Subscribing to signals in a handler

```go
// BAD — every request reinstalls a signal handler
func handler(w http.ResponseWriter, r *http.Request) {
    sigCh := make(chan os.Signal, 1)
    signal.Notify(sigCh, syscall.SIGTERM) // !!
}
```

This not only leaks but breaks the centralised signal handling.

### Mistake 10 — Not actually testing shutdown

The first test you should write for a new server is: "start the server, send `SIGTERM`, assert it exits within N seconds." Without this test, regressions slip in unnoticed.

---

## Common Misconceptions

### Misconception 1 — "`Ctrl+C` always kills the program immediately"

Not if you wire `SIGINT` to your shutdown logic. The default action is to kill, but `signal.Notify` overrides that. Pressing Ctrl+C twice while a server is draining sends two SIGINTs; many programs interpret the second one as "now I really mean it" and exit hard.

### Misconception 2 — "`SIGKILL` can be caught with the right tricks"

It cannot. The kernel handles `SIGKILL` and `SIGSTOP` itself; your process never sees them.

### Misconception 3 — "`Shutdown` waits for all goroutines in the program"

No. `http.Server.Shutdown` waits only for the goroutines servicing HTTP connections on that server. Your background workers, your metrics flusher, your queue consumer — all are separate. You must wait for them yourself.

### Misconception 4 — "`os.Exit(0)` is the same as `return`"

`os.Exit` immediately terminates the process. No `defer`s run, no deferred `cancel()`, no flushed log buffer. `return` from `main` runs all deferred work first.

### Misconception 5 — "The runtime cancels contexts automatically on signal"

No. The runtime does not know about your contexts. You wire them yourself via `signal.NotifyContext` or by calling `cancel()` after receiving from a `signal.Notify` channel.

### Misconception 6 — "I do not need a deadline because my handlers are fast"

Fast on the happy path, perhaps. The shutdown deadline protects against unknowns: a downstream that has just become slow, a database lock that is stuck, a malicious slow client. Always set a deadline.

### Misconception 7 — "K8s will give me as much time as I need"

It will not. `terminationGracePeriodSeconds` defaults to 30. After that, `SIGKILL`. You can raise it (with consequences for upgrade speed), but never plan as if it is infinite.

### Misconception 8 — "Graceful shutdown is for HTTP only"

Every long-running program needs it. CLI tools that maintain state, daemons that consume from queues, file watchers, schedulers — all benefit. The pattern is the same; only the "drain" step differs.

---

## Tricky Points

### Tricky 1 — `signal.Notify` does not replace, it appends

If two parts of your program call `signal.Notify(chA, syscall.SIGTERM)` and `signal.Notify(chB, syscall.SIGTERM)`, both channels receive every SIGTERM. This is sometimes useful, sometimes surprising.

### Tricky 2 — `signal.Reset` versus `signal.Stop`

`signal.Stop(ch)` stops delivering to *that channel*. `signal.Reset(sig...)` resets the *signal* back to its default behaviour for the whole process. They are not interchangeable.

### Tricky 3 — `http.Server.RegisterOnShutdown` is for custom hooks

You can register a callback that runs at the start of `Shutdown`:

```go
srv.RegisterOnShutdown(func() {
    log.Println("custom shutdown hook fired")
})
```

Useful for closing custom WebSocket connections or other resources tracked outside the standard library.

### Tricky 4 — Hijacked connections are not drained

If your handler calls `http.ResponseWriter.Hijack` (WebSockets, HTTP/2 push, etc.), those connections are out of `http.Server`'s tracking and `Shutdown` will not wait for them. You must wait for them yourself.

### Tricky 5 — Read deadlines and `Shutdown`

A connection in the middle of reading a request when `Shutdown` is called will still finish reading (up to `ReadTimeout`). Setting an aggressive `ReadTimeout` shortens the drain.

### Tricky 6 — Two-stage drain for upstream proxies

If your service is behind a load balancer, the LB needs time to mark it unhealthy before you start refusing connections. The convention is: on `SIGTERM`, flip readiness to "not ready," wait a few seconds for the LB to notice, *then* start `Shutdown`. The LB stops routing new traffic during those seconds. We will see this at middle level.

---

## Test

A graceful shutdown is testable. Here is a small integration test that demonstrates the pattern:

```go
package main_test

import (
    "context"
    "net/http"
    "os"
    "os/exec"
    "syscall"
    "testing"
    "time"
)

func TestGracefulShutdown(t *testing.T) {
    cmd := exec.Command("go", "run", "./cmd/server")
    cmd.Stdout = os.Stdout
    cmd.Stderr = os.Stderr
    if err := cmd.Start(); err != nil {
        t.Fatalf("start: %v", err)
    }
    defer cmd.Process.Kill() // safety net

    // give the server a moment to bind the port
    time.Sleep(500 * time.Millisecond)

    // start a request that the server will sleep on for 2s
    go func() {
        req, _ := http.NewRequestWithContext(context.Background(),
            "GET", "http://localhost:8080/slow", nil)
        _, _ = http.DefaultClient.Do(req)
    }()

    time.Sleep(100 * time.Millisecond)
    if err := cmd.Process.Signal(syscall.SIGTERM); err != nil {
        t.Fatalf("signal: %v", err)
    }

    done := make(chan error, 1)
    go func() { done <- cmd.Wait() }()

    select {
    case err := <-done:
        if err != nil {
            t.Fatalf("server exited with error: %v", err)
        }
    case <-time.After(5 * time.Second):
        t.Fatal("server did not exit within 5 seconds")
    }
}
```

A unit-test-shaped variant uses `httptest.NewServer` and calls `srv.Shutdown` directly — both forms have value.

### What the test asserts

- The server exits with status 0 (graceful).
- The exit happens within 5 seconds — well under the 30-second deadline.
- (Optional, with more assertion code) the in-flight request returned 200, not a connection error.

---

## Tricky Questions

**Q1.** *What is the difference between `signal.Notify` and `signal.NotifyContext`?*

`Notify` delivers signals as channel values; you must drain the channel and manage cancellation yourself. `NotifyContext` wraps `Notify` and ties the signal to context cancellation; you observe `ctx.Done()` instead of reading the channel. New code should prefer `NotifyContext`.

**Q2.** *Why does my program ignore Ctrl+C?*

Either you have not called `signal.Notify` / `signal.NotifyContext` at all, or you called it on a channel you never read from. The default action of `SIGINT` is to terminate; once you intercept it, you take ownership of what happens.

**Q3.** *Why does `http.Server.Shutdown` return immediately even when requests are still in flight?*

It does not, if used correctly. If it returns immediately, you are passing it a context that is already cancelled. Pass it a context with a fresh `WithTimeout`.

**Q4.** *Can I call `Shutdown` from inside a handler?*

You can, but it deadlocks because `Shutdown` waits for in-flight handlers to finish. Trigger shutdown from `main`, not from a handler. If a handler must trigger shutdown (e.g., a `/admin/shutdown` endpoint), it should write to a channel that `main` is reading on, and `main` then calls `Shutdown`.

**Q5.** *Why does my program shut down only after the goroutine I'm leaking exits?*

It does not — that is a misconception. A leaked goroutine does not prevent process exit. `main` returning is enough. The leak shows up only when you observe `runtime.NumGoroutine` or in `pprof`. If your process appears stuck, your `main` is blocked, not your goroutines.

**Q6.** *What happens if `SIGTERM` arrives during startup, before the server is ready?*

`signal.NotifyContext` is set up first; the context is cancelled as soon as the signal arrives. Your code should be written to bail out of startup if `ctx.Err() != nil` at any point. A startup that ignores cancellation is itself a graceful-shutdown bug.

---

## Cheat Sheet

```go
// Minimum-viable graceful HTTP server

ctx, stop := signal.NotifyContext(context.Background(),
    syscall.SIGINT, syscall.SIGTERM)
defer stop()

srv := &http.Server{Addr: ":8080", Handler: mux}
go func() {
    if err := srv.ListenAndServe(); err != nil &&
        !errors.Is(err, http.ErrServerClosed) {
        log.Fatalf("server: %v", err)
    }
}()

<-ctx.Done()

shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
defer cancel()
if err := srv.Shutdown(shutdownCtx); err != nil {
    _ = srv.Close()
}
```

**Signals to catch:** `SIGINT`, `SIGTERM`. Optionally `SIGHUP` for reload.

**Signals to never expect:** `SIGKILL`, `SIGSTOP` — uncatchable.

**Two phases of shutdown:** stop accepting + drain in-flight.

**The deadline:** always `context.WithTimeout`, never `context.Background()`.

**The fallback:** `srv.Close()` after `Shutdown` returns an error.

**The trap:** `time.Sleep` does not observe context. Use `time.NewTicker` in a `select`.

**The error to swallow:** `http.ErrServerClosed` is the *success* return from `ListenAndServe` after `Shutdown`.

---

## Self-Assessment Checklist

After reading this file, you should be able to answer "yes" to each of these:

- [ ] I can name three signals that matter for graceful shutdown and one that cannot be caught.
- [ ] I can write a minimal HTTP server that exits cleanly on Ctrl+C.
- [ ] I know why `errors.Is(err, http.ErrServerClosed)` is not just decoration.
- [ ] I know why `signal.Notify` requires a buffered channel.
- [ ] I can name the two phases of every shutdown.
- [ ] I know why `Shutdown` needs a context with a deadline.
- [ ] I know what `Close` does that `Shutdown` does not, and when to call it.
- [ ] I know why `os.Exit` mid-handler is a bug.
- [ ] I know why every background goroutine should accept a `context.Context`.
- [ ] I know that `Shutdown` does not wait for non-HTTP goroutines.

If three or more are uncertain, re-read the corresponding sections.

---

## Summary

Graceful shutdown in Go boils down to four steps, expressible in less than 20 lines:

1. **Subscribe** to `SIGINT` and `SIGTERM` with `signal.NotifyContext`.
2. **Start** your server (and any background goroutines) in their own goroutines, all sharing the resulting context.
3. **Wait** in `main` for the context to be cancelled (`<-ctx.Done()`).
4. **Drain** with `http.Server.Shutdown` bounded by `context.WithTimeout`, falling back to `Close` on timeout.

If you do exactly these four things, your program will deploy cleanly, restart cleanly, and survive the daily life of a Kubernetes cluster without dropping requests or corrupting state.

What follows in [middle.md](./middle.md) is the scaling-up of this pattern: multiple servers, dependency ordering, parallel drain, observability, and tighter cooperation with orchestrators.

---

## What You Can Build

With the pattern in this file you can write:

- A production-shaped HTTP API that survives `kubectl rollout restart` without errors.
- A small TCP echo server that closes connections cleanly on Ctrl+C.
- A queue consumer that finishes the current job before exiting.
- A CLI server (e.g., a local dashboard) that quits cleanly when the operator closes the terminal.
- A test helper that spins up and tears down a server per test.
- A "fake downstream" for integration tests, with graceful shutdown so the test runs quickly.

---

## Further Reading

- Go standard library: `os/signal` (`pkg.go.dev/os/signal`)
- Go standard library: `net/http.Server.Shutdown` (`pkg.go.dev/net/http#Server.Shutdown`)
- Go standard library: `context` (`pkg.go.dev/context`)
- Go blog: "Subtests and Sub-benchmarks" (only tangentially related, but shows the `t.Cleanup` pattern used in shutdown tests)
- Kubernetes: pod termination lifecycle (`kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/`)
- Dave Cheney: "Never start a goroutine without knowing how it will stop" (`dave.cheney.net`)

---

## Related Topics

- [Goroutines](../../01-goroutines/01-overview/) — the unit of execution being stopped.
- [Channels](../../02-channels/) — the original cancellation primitive; still useful.
- [Context](../../05-context/) — the modern cancellation primitive.
- [Worker pools](../../06-patterns/) — common pattern that needs careful shutdown.
- [HTTP server patterns](../../../08-stdlib/01-net-http/) — the place where most shutdowns live.
- [Kubernetes pod lifecycle](../../18-production-patterns/05-kubernetes-lifecycle/) — the wider context for your shutdown deadline.

---

## Diagrams and Visual Aids

### Diagram 1 — The shutdown timeline

```
time -->

 t=0    SIGTERM arrives
        |
        v
 t=0    main: <-ctx.Done() returns
        signal.NotifyContext cancels ctx
        |
        v
 t=0    srv.Shutdown(shutdownCtx) called
        |
        +--- listener closed (no new conns)
        +--- idle keep-alives closed
        +--- active handlers continue
        |
        v
 t=2.3  last active handler returns
        Shutdown returns nil
        |
        v
 t=2.3  main returns; deferred cleanup runs
        process exits with status 0
```

### Diagram 2 — Signals vs cancellation

```
   OS sends SIGTERM
        |
        v
   Go runtime intercepts (because of signal.NotifyContext)
        |
        v
   context.Context is cancelled
        |
        +---> every goroutine watching ctx.Done() observes the cancel
        +---> srv.Shutdown is triggered in main
        +---> background workers exit their loops
```

### Diagram 3 — The two clocks

```
              0s        25s       30s
              |---------|---------|
   your code    drain   |   margin |
              |         |          |
   the runtime: SIGTERM | the orchestrator: SIGKILL would land
```

### Diagram 4 — `Shutdown` internals (simplified)

```
Shutdown(ctx):
  set state = shuttingDown
  for each listener:
     close(listener)   // no new connections
  for each idle connection:
     close(c)          // closed immediately
  while activeConnCount > 0:
     wait on ctx.Done() or activeConnCount == 0
  if ctx.Done():
     return ctx.Err()
  return nil
```

This is the spirit, not the literal source. The actual implementation in `net/http/server.go` is the authoritative reference.

### Diagram 5 — The minimal `main` shape

```
main()
  +-- signal.NotifyContext(...)         <-- subscribe
  +-- go srv.ListenAndServe()           <-- serve
  +-- <-ctx.Done()                      <-- wait
  +-- ctx, _ = context.WithTimeout(...) <-- bound
  +-- srv.Shutdown(ctx)                 <-- drain
  +-- return                             <-- exit
```

Five lines of real flow, every production Go server has them. The rest of this Roadmap is how to scale that shape to harder situations.

---

## Extended Walk-Through: Building a Graceful Server From Scratch

The earlier examples show the result. This section walks through the construction step by step, in the order a junior developer should encounter the problem.

### Step 1 — Start with the un-graceful version

The simplest HTTP server in Go is two lines:

```go
package main

import "net/http"

func main() {
    http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
        w.Write([]byte("hello\n"))
    })
    http.ListenAndServe(":8080", nil)
}
```

Run it. Press Ctrl+C. The program disappears instantly. No log line, no opportunity to flush, no cleanup. If a request was mid-flight, the client sees a connection reset. This is the baseline we improve upon.

### Step 2 — Move from `http.ListenAndServe` to an explicit `*http.Server`

To call `Shutdown` you need a handle to the server. The package-level `http.ListenAndServe` builds an `*http.Server` internally and hides it. Replace it with an explicit one:

```go
srv := &http.Server{
    Addr:    ":8080",
    Handler: handler,
}
log.Fatal(srv.ListenAndServe())
```

Now `srv` is in scope. `Shutdown` and `Close` are methods on it.

### Step 3 — Move `ListenAndServe` into a goroutine

`ListenAndServe` blocks forever (or until something stops it). To do *anything else* in `main` while the server is running, you need to put it in a goroutine:

```go
go func() {
    if err := srv.ListenAndServe(); err != nil &&
        !errors.Is(err, http.ErrServerClosed) {
        log.Fatalf("server: %v", err)
    }
}()
```

The reason for the `errors.Is` check is subtle. `ListenAndServe` returns *some* error after `Shutdown` is called — specifically `http.ErrServerClosed`. That is the *success path*. Logging it as an error would produce confusing logs.

### Step 4 — Subscribe to signals before doing anything else

Signal subscription should happen as early as possible in `main`. If a `SIGTERM` arrives before you have called `signal.Notify`, the default action takes over — the process is killed.

```go
ctx, stop := signal.NotifyContext(context.Background(),
    syscall.SIGINT, syscall.SIGTERM)
defer stop()
```

The `defer stop()` is not optional. It releases the registration and returns the runtime's internal state to default. Without it, the runtime holds a reference and the goroutine running the signal pump never exits — visible in `runtime.NumGoroutine` at exit.

### Step 5 — Block in `main` until the signal arrives

After starting the server, `main` has nothing else to do. The simplest way to keep `main` alive is to wait on the context:

```go
<-ctx.Done()
```

This blocks until `ctx` is cancelled — either because the signal arrived (the desired path) or because some other code called `stop()` early (an edge case worth handling).

### Step 6 — Construct a deadline-bounded shutdown context

Once the signal has arrived, you want to call `Shutdown(ctx)` — but the original `ctx` has *already been cancelled*. Passing it to `Shutdown` would cause `Shutdown` to return immediately with `context.Canceled`. You need a *new* context with a *future* deadline:

```go
shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
defer cancel()
```

Important detail: the parent of `shutdownCtx` is `context.Background()`, not the already-cancelled `ctx`. If you did `context.WithTimeout(ctx, ...)`, the new context inherits the cancellation and is already done.

### Step 7 — Call `Shutdown` and fall back to `Close`

```go
if err := srv.Shutdown(shutdownCtx); err != nil {
    log.Printf("graceful shutdown failed: %v; forcing close", err)
    _ = srv.Close()
}
```

`Shutdown` is the primary path. If it returns `context.DeadlineExceeded` (the deadline elapsed) or any other error, `Close` is the brutal fallback. `Close` interrupts active connections, but at least your process can finally exit.

### Step 8 — Final cleanup with deferred functions

After `Shutdown` returns, `main` reaches its closing brace. Any deferred functions registered earlier (closing the database, flushing logs, closing files) now run. This is why the `run() error` idiom matters: if `main` itself defers cleanup, a `log.Fatalf` somewhere bypasses it.

Putting the steps together gives the file in [Example 1](#code-examples). That seven-step recipe is the basis of every production Go HTTP server.

---

## Anatomy of the Default `http.Server.Shutdown`

It is worth understanding what `Shutdown` actually does, in plain English, because it informs almost every decision you make about timeouts, hijacked connections, and middleware.

When `Shutdown(ctx)` is called:

1. The internal state of the server flips to `srvShuttingDown`. Any subsequent `ListenAndServe` calls on the same server return `http.ErrServerClosed`.
2. All registered `OnShutdown` callbacks run in their own goroutines.
3. All listeners are closed. The `accept` loop returns. No new connections will be accepted.
4. For each connection currently held by the server, if it is **idle** (no active request, in `StateIdle`), it is closed immediately.
5. For each connection currently **active** (in the middle of a request), the server waits. The wait is a loop that polls every 500 ms (a constant in `net/http`).
6. The loop returns nil when no more active or idle connections exist.
7. The loop returns `ctx.Err()` if the context fires before all connections finish.

A few consequences:

- A connection in keep-alive but with no active request is closed immediately. You do not pay anything for many idle clients.
- A connection in the middle of a long handler delays shutdown until the handler returns (or until the deadline).
- A connection that has been `Hijack`ed (WebSockets, etc.) is *out of the server's tracking* and is neither closed nor waited for. You must clean these up yourself.
- The 500 ms polling means you cannot expect sub-second exit times even on the happy path.

---

## A Deeper Look at `signal.NotifyContext`

The function signature is:

```go
func NotifyContext(parent context.Context, signals ...os.Signal) (ctx context.Context, stop context.CancelFunc)
```

What it does, paraphrased:

1. Allocates a child context derived from `parent`.
2. Calls `signal.Notify` on an internal channel for each signal in `signals`.
3. Starts an internal goroutine that, on receiving any of those signals, calls the child context's `cancel`.
4. Returns the child context and a `stop` function that, when called, undoes the registration and cancels the goroutine.

There is one moderately important detail: the `stop` function is a `CancelFunc`. Calling it cancels the context (just like a normal `WithCancel`). This is useful: in tests you can call `stop()` to simulate a signal arriving.

```go
ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT)
// ... in a test:
stop() // pretend SIGINT happened
<-ctx.Done() // unblocks immediately
```

The internal goroutine continues to listen for signals until `stop()` is called. Forgetting to `defer stop()` leaks both the goroutine and the channel registration.

---

## How Signals Are Delivered Internally

This is a hint at the professional-level content, but the basics help here.

When a signal arrives at the Go process:

1. The kernel writes the signal into the per-thread pending-signal mask of an arbitrary thread.
2. That thread enters the runtime's signal handler.
3. The runtime stashes the signal in a small buffer.
4. A dedicated goroutine — `signal_recv` — wakes up and reads from that buffer.
5. For each subscriber registered with `signal.Notify`, the signal is sent to that subscriber's channel.

Key consequences:

- Signal delivery is *asynchronous*. There can be a small delay between the kernel marking the signal and your code observing it. Usually microseconds; can be longer under load.
- Multiple signals of the same kind can be coalesced. If 100 `SIGCHLD` arrive in a microsecond, you may observe one. This is fine for `SIGTERM` (you only care that it arrived) but matters for `SIGCHLD` (reaping subprocesses).
- If a signal arrives while the runtime is in a critical section, delivery is delayed until the runtime returns to a safe point.

The practical takeaway: do not rely on signal *count*. Rely on signal *occurrence*.

---

## A Full, Annotated, Reusable Skeleton

Below is a skeleton you can copy into a new project. It is intentionally verbose so each line can be explained.

```go
package main

import (
    "context"
    "errors"
    "fmt"
    "log"
    "net/http"
    "os/signal"
    "sync"
    "syscall"
    "time"
)

// ShutdownTimeout is the maximum amount of time we give in-flight
// work to drain after a shutdown signal arrives. Should be smaller
// than the orchestrator's kill timeout (Kubernetes default: 30s).
const ShutdownTimeout = 25 * time.Second

// readyDelay is how long we wait between flipping readiness off and
// closing the listener. Lets a fronting load balancer notice we are
// no longer serving and stop sending us new traffic.
const readyDelay = 3 * time.Second

func main() {
    if err := run(); err != nil {
        log.Fatalf("fatal: %v", err)
    }
}

func run() error {
    // ----- 1. set up signal handler --------------------------------
    rootCtx, stop := signal.NotifyContext(context.Background(),
        syscall.SIGINT, syscall.SIGTERM)
    defer stop()

    // ----- 2. build the server ------------------------------------
    mux := http.NewServeMux()
    var ready atomicBool
    ready.Store(true)

    mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
        w.WriteHeader(http.StatusOK)
    })
    mux.HandleFunc("/readyz", func(w http.ResponseWriter, r *http.Request) {
        if !ready.Load() {
            http.Error(w, "draining", http.StatusServiceUnavailable)
            return
        }
        w.WriteHeader(http.StatusOK)
    })
    mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
        // simulate work
        select {
        case <-time.After(200 * time.Millisecond):
            fmt.Fprintln(w, "hello")
        case <-r.Context().Done():
            // client gave up
            return
        }
    })

    srv := &http.Server{
        Addr:              ":8080",
        Handler:           mux,
        ReadHeaderTimeout: 5 * time.Second,
        ReadTimeout:       30 * time.Second,
        WriteTimeout:      30 * time.Second,
        IdleTimeout:       120 * time.Second,
    }

    // ----- 3. start the server ------------------------------------
    serverErr := make(chan error, 1)
    go func() {
        log.Printf("server listening on %s", srv.Addr)
        if err := srv.ListenAndServe(); err != nil &&
            !errors.Is(err, http.ErrServerClosed) {
            serverErr <- err
            return
        }
        serverErr <- nil
    }()

    // ----- 4. wait for shutdown signal ----------------------------
    select {
    case <-rootCtx.Done():
        log.Printf("shutdown signal received: %v", rootCtx.Err())
    case err := <-serverErr:
        return fmt.Errorf("server failed: %w", err)
    }

    // ----- 5. drain in two stages ---------------------------------
    // 5a. flip readiness so load balancers stop sending us traffic
    ready.Store(false)
    log.Println("readiness off; waiting for load balancer to notice")
    time.Sleep(readyDelay)

    // 5b. close listener and drain in-flight requests
    shutdownCtx, cancel := context.WithTimeout(context.Background(), ShutdownTimeout)
    defer cancel()
    log.Println("draining listener")
    if err := srv.Shutdown(shutdownCtx); err != nil {
        log.Printf("graceful shutdown failed: %v; forcing close", err)
        _ = srv.Close()
        return fmt.Errorf("shutdown: %w", err)
    }
    log.Println("server exited cleanly")
    return nil
}

// atomicBool is a tiny helper used here to avoid pulling in
// sync/atomic.Bool which is Go 1.19+; for Go 1.16-1.18 we use sync.
type atomicBool struct {
    mu sync.RWMutex
    v  bool
}

func (a *atomicBool) Load() bool {
    a.mu.RLock()
    defer a.mu.RUnlock()
    return a.v
}

func (a *atomicBool) Store(v bool) {
    a.mu.Lock()
    defer a.mu.Unlock()
    a.v = v
}
```

This 90-line file is a complete, deployable HTTP server skeleton. Read it twice. Most production Go services start as something close to this.

### Walk-through of the skeleton

- **Constants at the top.** `ShutdownTimeout` and `readyDelay` are named. A future reviewer can find and tune them without grepping.
- **`run() error` separation.** `main` only calls `log.Fatalf`. All real logic is in `run`, where `defer` works.
- **`/healthz` vs `/readyz`.** Health is "I am alive"; readiness is "send me traffic." During shutdown we flip readiness to false. Liveness stays true (we are still alive, just draining).
- **The `select` between `rootCtx.Done()` and `serverErr`.** Either path is a reason to begin shutdown: a signal arrived, or the server crashed on its own.
- **Two-stage drain.** `readyDelay` then `Shutdown`. The first stage is what makes the LB stop routing; the second is the actual drain.
- **Tight `Server` timeouts.** Prevent slow clients from prolonging shutdown.

---

## Why "Three Seconds" for `readyDelay`?

The exact number depends on your load balancer's health check interval. A few examples:

| Load balancer | Default check interval | Recommended `readyDelay` |
|---|---|---|
| Kubernetes `Service` with kube-proxy iptables | ~1s | 2–3s |
| AWS ALB | 5s | 10s |
| GCP HTTP(S) LB | 5s | 10s |
| Envoy / Istio | 1–5s | 3–5s |
| HAProxy | 2s | 5s |

The principle: `readyDelay` should be at least one full probe interval, plus one or two seconds of margin. If your LB checks every 5 seconds, 3 is not enough; bump it to 10. The total budget must still fit in `ShutdownTimeout` *and* the orchestrator's `terminationGracePeriodSeconds`.

A `readyDelay` of zero (no delay) means the LB may still be sending you traffic during the drain, which causes connection resets for those clients.

---

## What Happens If You Get Shutdown Wrong: a Catalogue

If the signal handler is missing, the program dies instantly on SIGTERM. Clients with active connections see `connection reset by peer`. Any database transactions in progress are rolled back when the connection drops.

If `signal.Stop` is forgotten, the runtime keeps a reference to the signal channel. The channel is never garbage-collected. Each restart of the same process within a test suite leaks a channel.

If `http.ErrServerClosed` is logged as an error, your alerting fires on every successful shutdown. The on-call engineer learns to ignore it. The day a real error appears, they ignore that too.

If the shutdown context has no deadline, a single stuck handler can block the process forever. Kubernetes eventually `SIGKILL`s, with worse consequences than a clean drain would have produced.

If the database is closed before `Shutdown` returns, in-flight handlers hit "connection refused" or "use of closed connection" errors mid-request. Some return 500 to the client; some panic.

If `os.Exit(0)` is called from inside a handler, all goroutines die instantly. Other handlers in-flight produce truncated responses. Deferred cleanups skipped.

If you forget to bound your background goroutines with `ctx.Done()`, the program may exit (because `main` returns) but the leaked goroutines are visible in tests and pprof.

If two parts of your program call `Shutdown` concurrently, behaviour is well-defined (second call is a no-op) but you may be surprised by what the *first* call did. Centralise shutdown in `main`.

If you catch `SIGQUIT` accidentally, you lose the ability to use `kill -3` for a stack dump. Useful debugging tool gone.

If you catch every signal "just to be safe," you may interfere with `runtime.Stack` traces, with subprocess management (`SIGCHLD`), or with parent-process notifications (`SIGHUP`).

---

## Practical Exercises

A few small exercises to internalise the patterns. Solutions are in [tasks.md](./tasks.md).

### Exercise A — Make Ctrl+C work

Take the un-graceful baseline (two-line server). Modify it so:

- Pressing Ctrl+C logs "shutting down" and exits.
- Pressing Ctrl+C while a 3-second handler is running waits for the handler to finish.
- Run `time` on the program with and without an in-flight request; verify the timings.

### Exercise B — Add a background ticker

Add a goroutine that prints "tick" every 5 seconds. Make sure it stops when shutdown begins. Show that the program exits within a second of the signal.

### Exercise C — Test it

Write a small Go test (or a shell script) that:

- Starts the server in a subprocess.
- Issues a request that takes 2 seconds.
- Sends `SIGTERM` 200 ms in.
- Asserts the request completes successfully *and* the process exits cleanly.

### Exercise D — Force a slow client

Use `curl --limit-rate 10` to start a slow request. Send `SIGTERM`. Confirm that the shutdown deadline (set short for the experiment, say 2 seconds) elapses and the fallback `Close` runs.

### Exercise E — Verify the LB-readiness pattern

Wire a `/readyz` endpoint that flips to 503 on shutdown. From a second terminal, run a loop hitting `/readyz` every 100 ms. Send `SIGTERM`. Observe the 200 → 503 transition before the listener closes.

---

## Frequently Asked, Genuinely Asked, Questions

### "Should I catch `SIGKILL`?"

You cannot. Stop trying. Ask why you wanted to — usually it is because something is taking too long and getting killed, and you wanted a chance to flush. The right answer is to shorten that something or raise `terminationGracePeriodSeconds`.

### "Should I catch `os.Interrupt` or `syscall.SIGINT`?"

`os.Interrupt` is the cross-platform alias. On UNIX it equals `syscall.SIGINT`. On Windows there is no real signal mechanism; `os.Interrupt` is what `Ctrl+C` produces in the console. If you want portability, use `os.Interrupt`. If you only run on Linux, `syscall.SIGINT` is equally fine.

### "Does `signal.Notify(ch, syscall.SIGTERM)` block on send if `ch` is full?"

No. The runtime uses a non-blocking send. If the channel is full, the signal is dropped. This is why the channel must be buffered: `cap >= 1` ensures the first signal is never lost.

### "Why does Go not give me one `WaitForSignal` function?"

It used to be less ergonomic. `signal.NotifyContext` (Go 1.16+) is essentially that function. For 95% of programs, that is what you want.

### "What if my server is also a gRPC server?"

gRPC's `grpc.Server` has a `GracefulStop()` method that does the same as `http.Server.Shutdown` but for gRPC connections. The pattern is identical: receive the signal, call `GracefulStop`, with a deadline you enforce yourself (gRPC's `GracefulStop` has no built-in deadline).

### "What about WebSockets?"

WebSockets are hijacked connections. `http.Server.Shutdown` does *not* track them. You must keep your own list of active WebSocket connections and close them in your shutdown handler.

```go
srv.RegisterOnShutdown(func() {
    closeAllWebSockets() // your own function
})
```

### "Should I close the database in `main`'s defer or after `Shutdown`?"

After `Shutdown`. Otherwise, in-flight handlers may try to use the database after it is closed, producing errors visible to clients.

### "Is `signal.NotifyContext` safe to call before `main` is fully initialised?"

Yes. The earlier the better. There is no race; the runtime is ready as soon as `main` starts.

### "What is the simplest production-ready pattern?"

```go
ctx, stop := signal.NotifyContext(context.Background(),
    syscall.SIGINT, syscall.SIGTERM)
defer stop()
go func() {
    if err := srv.ListenAndServe(); err != nil &&
        !errors.Is(err, http.ErrServerClosed) {
        log.Fatalf("server: %v", err)
    }
}()
<-ctx.Done()
shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
defer cancel()
_ = srv.Shutdown(shutdownCtx)
```

Memorise this. Type it. Test it. The middle-level file shows how to scale it.

---

## A Note on Cross-Platform Behaviour

### Linux / macOS

Full signal support. Use `syscall.SIGINT`, `syscall.SIGTERM`, etc. directly. The kernel delivers signals as expected.

### Windows

Windows does not really have signals in the UNIX sense. The runtime simulates `os.Interrupt` for Ctrl+C in the console. `syscall.SIGTERM` exists in the `syscall` package but is mostly a no-op — Windows services use the Service Control Manager, not signals, to request shutdown. If you must run a Go service on Windows, the `kardianos/service` package or `golang.org/x/sys/windows/svc` is the way to integrate with the SCM.

For cross-platform code, use `os.Interrupt` and accept that "graceful shutdown on Windows" looks different (and is mostly the SCM's `Stop` callback rather than a signal).

### FreeBSD / OpenBSD / NetBSD

Same as Linux for the relevant signals. Some non-portable signals (`SIGUSR1`, `SIGUSR2`) exist; do not rely on them in cross-BSD code.

---

## Recap: Build Your Mental Library

Before moving to middle.md, make sure you have *internalised* (not just read):

- The shape of the minimum graceful main.
- The role of `signal.NotifyContext` and why `defer stop()` is mandatory.
- The two-phase model: drain the listener, then wait on handlers.
- The deadline rule: bound `Shutdown` with `context.WithTimeout`.
- The fallback rule: call `Close` if `Shutdown` fails.
- The `errors.Is(err, http.ErrServerClosed)` check on `ListenAndServe`'s return.
- The "no `os.Exit` mid-handler" rule.
- The "pass `ctx` to every goroutine" rule.
- The "close the database *after* the server" rule.
- The "test the shutdown path" rule.

Each of these is a five-second mental check you can run on any Go service you read or write. Together they are 80% of what "production-ready" means for the lifecycle layer of a Go program.

---

## Worked Example: A Tiny Job Worker

The HTTP examples above are the most common case. Many Go programs are not HTTP servers, they are workers that pull from a queue. The graceful-shutdown shape for a worker is structurally identical; only the "stop accepting" step looks different.

```go
package main

import (
    "context"
    "log"
    "os/signal"
    "syscall"
    "time"
)

type Job struct{ ID int }

func main() {
    ctx, stop := signal.NotifyContext(context.Background(),
        syscall.SIGINT, syscall.SIGTERM)
    defer stop()

    jobs := make(chan Job)
    go produceJobs(ctx, jobs) // fake queue producer

    done := make(chan struct{})
    go func() {
        defer close(done)
        runWorker(ctx, jobs)
    }()

    <-ctx.Done()
    log.Println("shutdown signal received; waiting for in-flight job")

    shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()
    select {
    case <-done:
        log.Println("worker exited cleanly")
    case <-shutdownCtx.Done():
        log.Println("worker did not exit in time; forcing exit")
    }
}

func produceJobs(ctx context.Context, out chan<- Job) {
    defer close(out)
    for id := 0; ; id++ {
        select {
        case <-ctx.Done():
            return
        case out <- Job{ID: id}:
        }
    }
}

func runWorker(ctx context.Context, in <-chan Job) {
    for j := range in {
        processJob(ctx, j)
    }
}

func processJob(ctx context.Context, j Job) {
    select {
    case <-ctx.Done():
        return
    case <-time.After(500 * time.Millisecond):
        log.Printf("processed job %d", j.ID)
    }
}
```

Note the symmetry with the HTTP version:

| HTTP version | Worker version |
|---|---|
| `signal.NotifyContext` | `signal.NotifyContext` |
| `srv.ListenAndServe()` in goroutine | `runWorker(ctx, jobs)` in goroutine |
| `<-ctx.Done()` | `<-ctx.Done()` |
| `srv.Shutdown(shutdownCtx)` | producer returns when ctx done, channel closes, worker exits naturally |
| `defer cancel()` on shutdown ctx | `defer cancel()` on shutdown ctx |

The "stop accepting new work" phase is replaced by the producer returning. The "drain in-flight" phase is the worker finishing its current job and the `range` loop exiting. Same machinery, different surface.

---

## When Multiple Servers Live in One Process

Some services expose two or three different listeners — for example, an HTTP API on `:8080` and a metrics server on `:9090`. Each is its own `*http.Server` and needs its own `Shutdown`. The basic pattern:

```go
api := &http.Server{Addr: ":8080", Handler: apiMux}
metrics := &http.Server{Addr: ":9090", Handler: metricsMux}

go func() {
    if err := api.ListenAndServe(); err != nil &&
        !errors.Is(err, http.ErrServerClosed) {
        log.Printf("api: %v", err)
    }
}()
go func() {
    if err := metrics.ListenAndServe(); err != nil &&
        !errors.Is(err, http.ErrServerClosed) {
        log.Printf("metrics: %v", err)
    }
}()

<-ctx.Done()
shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
defer cancel()

var wg sync.WaitGroup
wg.Add(2)
go func() { defer wg.Done(); _ = api.Shutdown(shutdownCtx) }()
go func() { defer wg.Done(); _ = metrics.Shutdown(shutdownCtx) }()
wg.Wait()
```

Two things to notice. First, the shutdowns run in parallel — there is no reason to drain them serially. Second, they share the same `shutdownCtx`, so they share a single deadline. If the API drain is slow, the metrics drain still respects the same 30-second budget.

Mid-level files show the `errgroup` form of this same pattern, which is more ergonomic.

---

## Putting It All Together: A Project Layout

A typical small Go service has this structure:

```
myservice/
  cmd/
    server/
      main.go         <-- thin entry point: parse flags, call run()
  internal/
    server/
      server.go       <-- New() and Run() functions
      shutdown.go     <-- shutdown helpers
    config/
    db/
    queue/
  go.mod
```

`main.go`:

```go
package main

import (
    "log"

    "example.com/myservice/internal/server"
)

func main() {
    if err := server.Run(); err != nil {
        log.Fatalf("fatal: %v", err)
    }
}
```

`internal/server/server.go`:

```go
package server

import (
    "context"
    "errors"
    "log"
    "net/http"
    "os/signal"
    "syscall"
    "time"
)

const ShutdownTimeout = 25 * time.Second

func Run() error {
    ctx, stop := signal.NotifyContext(context.Background(),
        syscall.SIGINT, syscall.SIGTERM)
    defer stop()

    srv, cleanup, err := buildServer()
    if err != nil {
        return err
    }
    defer cleanup()

    serverErr := make(chan error, 1)
    go func() {
        if err := srv.ListenAndServe(); err != nil &&
            !errors.Is(err, http.ErrServerClosed) {
            serverErr <- err
            return
        }
        serverErr <- nil
    }()

    select {
    case <-ctx.Done():
        log.Println("signal received; shutting down")
    case err := <-serverErr:
        return err
    }

    shutdownCtx, cancel := context.WithTimeout(context.Background(), ShutdownTimeout)
    defer cancel()
    if err := srv.Shutdown(shutdownCtx); err != nil {
        _ = srv.Close()
        return err
    }
    return nil
}
```

This layout cleanly separates concerns. `cmd/server/main.go` does no logic, only error printing. `internal/server/server.go` owns the lifecycle. `internal/server/shutdown.go` (not shown) holds helpers like `awaitWithTimeout`.

A reviewer can follow `Run()` end-to-end and see all four lifecycle stages in 30 lines.

---

## Reading Other People's Shutdown Code

To wrap up the junior file, here is a brief tour of how to *read* shutdown code in a real codebase you have just joined.

### What to look for

1. **Where is `signal.NotifyContext` called?** If nowhere, the program has no shutdown handling. That is a finding.
2. **Where is `srv.Shutdown` called?** Should be in `main` or a top-level `Run`. If it is inside a handler, raise an eyebrow.
3. **Is there a `time.WithTimeout` around `Shutdown`?** If not, the program can hang forever at shutdown. Add one.
4. **Is `errors.Is(err, http.ErrServerClosed)` checked?** If not, the logs are noisy on every restart.
5. **Are background goroutines passed a `ctx` derived from the signal context?** If they take `context.Background()` instead, they ignore shutdown.
6. **Are databases / queues closed *after* `Shutdown` returns?** If before, you have a race.

### Smells

- A `defer os.Exit(0)` anywhere. Skips defers.
- A `log.Fatalf` inside a deferred function. Skips other defers.
- A signal handler installed inside a handler. Centralisation is broken.
- A `select` on `time.After` without a `defer t.Stop()`. Leaks a timer.
- A `for { ... }` with no `<-ctx.Done()` arm. Probably leaks the goroutine.
- Multiple distinct signal subscriptions to `SIGTERM`. Confusing and rarely intentional.

If you see five of these in a codebase, you have just identified your first "production hardening" project.

---

## Where to Go Next

After this file, the natural sequence is:

1. [middle.md](./middle.md) — multiple servers, dependency order, `errgroup`, time budgets, real patterns.
2. [senior.md](./senior.md) — architecture: phase machines, observability, LB drain, K8s patterns.
3. [professional.md](./professional.md) — kernel-level signal delivery, container runtime internals, force-kill internals.
4. [tasks.md](./tasks.md) — practice the patterns until they are muscle memory.
5. [find-bug.md](./find-bug.md) — see what goes wrong and how to spot it.
6. [optimize.md](./optimize.md) — tune for tail latency and faster deploys.

The junior file ends here. You should now be able to write a graceful HTTP server skeleton without consulting the documentation, and recognise the same pattern in any code review.

---

## Appendix A: Every Signal You Are Likely to Meet

For reference, here is the complete table of UNIX signals you may encounter while running a Go service, with notes on whether they matter for shutdown.

| # | Name | Default | Catchable | Typical source | Used for shutdown? |
|---|------|---------|-----------|----------------|---------------------|
| 1 | SIGHUP | terminate | yes | terminal close, deliberate `kill -1` | sometimes (config reload) |
| 2 | SIGINT | terminate | yes | Ctrl+C | yes |
| 3 | SIGQUIT | core+terminate | yes | Ctrl+\\ | no (debug dump) |
| 6 | SIGABRT | core+terminate | yes | `abort()` in C, runtime fatal | no |
| 9 | SIGKILL | terminate | NO | `kill -9`, OOM killer, K8s timeout | no (the *result* of shutdown failure) |
| 11 | SIGSEGV | core+terminate | yes | invalid memory access | no |
| 13 | SIGPIPE | terminate | yes | write to closed pipe | no (Go runtime handles it) |
| 14 | SIGALRM | terminate | yes | `setitimer(2)` | no |
| 15 | SIGTERM | terminate | yes | `kill <pid>`, systemd, Docker, K8s | yes |
| 17 | SIGCHLD | ignore | yes | child process exit | no (subprocess management) |
| 18 | SIGCONT | resume | yes | `kill -CONT` | no |
| 19 | SIGSTOP | stop | NO | `kill -STOP` | no |
| 20 | SIGTSTP | stop | yes | Ctrl+Z | no |
| 23 | SIGURG | ignore | yes | TCP urgent data, also used by Go runtime for preemption | no |
| 28 | SIGWINCH | ignore | yes | terminal resize | no |
| 30 | SIGUSR1 | terminate | yes | user-defined | sometimes (reload, dump) |
| 31 | SIGUSR2 | terminate | yes | user-defined | sometimes |

Notes:

- `SIGURG` is used internally by Go since 1.14 for *asynchronous preemption*. The runtime delivers it to itself constantly. Never subscribe to it; you will confuse the scheduler.
- `SIGPIPE` is also handled internally by Go's runtime — failed writes return errors, never crash.
- `SIGCHLD` only matters if you spawn child processes (`exec.Cmd`). Most servers do not.
- `SIGUSR1` and `SIGUSR2` are sometimes used for "reload configuration without restart" or "dump diagnostics" — choose convention based on your fleet.

---

## Appendix B: A Short History of Graceful Shutdown in Go

Go did not always have `http.Server.Shutdown` or `signal.NotifyContext`. The patterns evolved.

### Go 1.0 (2012)

`http.ListenAndServe` was the only API. No shutdown method existed. If you wanted graceful shutdown you had to write a custom listener that tracked active connections by intercepting `Accept`. Third-party packages like `manners` and `graceful` filled the gap.

### Go 1.8 (2017)

`http.Server.Shutdown` landed. The third-party packages became unnecessary for most users. The pattern of "signal goroutine + Shutdown" became standard.

### Go 1.16 (2021)

`signal.NotifyContext` added. The boilerplate of "make a channel, call Notify, read from it" collapsed into one line.

### Go 1.20+ (2023+)

`context.WithCancelCause`, `context.WithDeadlineCause`, and `context.AfterFunc` made the cancellation machinery richer. Useful for "I want to know *why* a shutdown was triggered" — logged as a cause string instead of a generic `context.Canceled`.

```go
ctx, cancel := context.WithCancelCause(parent)
// later
cancel(errors.New("SIGTERM received"))
// elsewhere
context.Cause(ctx) // returns the error you passed
```

These are nice-to-have, not load-bearing. The junior-level patterns work without them.

---

## Appendix C: How `terminationGracePeriodSeconds` Interacts With Your Code

Kubernetes is the most common environment for Go services in 2026. The kubelet's pod-termination algorithm, simplified:

1. The pod is marked Terminating. Removal from Service endpoints begins.
2. `preStop` hook (if any) runs in the container.
3. `SIGTERM` is delivered to the container's PID 1.
4. A timer starts: `terminationGracePeriodSeconds` (default 30s).
5. When the timer elapses, if the container is still running, `SIGKILL` is delivered.

Your Go code lives between steps 3 and 5. The whole drain — including any `readyDelay` you have — must fit in that window.

A typical timeline for a well-behaved Go service:

```
t=0         SIGTERM arrives in container
t=0         signal.NotifyContext cancels ctx
t=0..3      readyDelay: /readyz returns 503 to LB probes
t=3         srv.Shutdown begins
t=3..28     in-flight handlers drain
t=28..30    cleanup (close DB, flush logs)
t=30        process exits cleanly
```

Note that 30 seconds is *the wall*. If a single handler takes 35 seconds, you will be SIGKILLed. The solution is either to lower that handler's worst-case latency or raise `terminationGracePeriodSeconds`. Both have trade-offs; the senior file covers them.

---

## Appendix D: Glossary of Related K8s Concepts

For when you read deployment YAML and want to know what each line does to your shutdown:

| Field | What it means for your Go process |
|---|---|
| `terminationGracePeriodSeconds: 30` | Time between SIGTERM and SIGKILL. |
| `lifecycle.preStop.exec.command` | Run *before* SIGTERM. Often a `sleep 5` to give LB time to notice. |
| `lifecycle.preStop.httpGet.path` | Make an HTTP call to your own endpoint before SIGTERM. |
| `readinessProbe.httpGet.path` | Endpoint the kubelet probes to decide if you should be in the Service endpoints. |
| `livenessProbe.httpGet.path` | Endpoint the kubelet probes to decide if the container should be restarted. Different from readiness. |
| `startupProbe` | Disable other probes until this passes. Useful for slow-starting services. |

When in doubt, set `terminationGracePeriodSeconds` to (your ShutdownTimeout) + 5–10 seconds of margin. Senior-level patterns use the `preStop` sleep to coordinate with the LB more precisely.

---

## Appendix E: Quick Reference — When To Use Which API

| You want to... | Use... |
|---|---|
| Catch SIGTERM in a new program | `signal.NotifyContext(ctx, syscall.SIGINT, syscall.SIGTERM)` |
| Catch a signal in pre-1.16 Go | `signal.Notify(ch, ...)` + `defer signal.Stop(ch)` |
| Drain an `http.Server` | `srv.Shutdown(ctx)` with `context.WithTimeout` |
| Force-close an `http.Server` | `srv.Close()` (use as fallback only) |
| Drain a `grpc.Server` | `srv.GracefulStop()` |
| Force-close a `grpc.Server` | `srv.Stop()` |
| Cancel a goroutine tree | `cancel()` on a `context.WithCancel` |
| Bound a wait by deadline | `context.WithTimeout` or `context.WithDeadline` |
| Run a callback at shutdown | `srv.RegisterOnShutdown(fn)` |
| Wait for `sync.WaitGroup` with timeout | turn `wg.Wait()` into a goroutine that closes a channel; `select` on that and a `ctx` |

---

## Appendix F: Memorisation Drills

Some patterns deserve to live in muscle memory. Here are three to drill until you can type them blindfolded.

### Drill 1 — Signal subscription

```go
ctx, stop := signal.NotifyContext(context.Background(),
    syscall.SIGINT, syscall.SIGTERM)
defer stop()
```

### Drill 2 — Bounded server shutdown

```go
shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
defer cancel()
if err := srv.Shutdown(shutdownCtx); err != nil {
    _ = srv.Close()
}
```

### Drill 3 — `ListenAndServe` in a goroutine with proper error check

```go
go func() {
    if err := srv.ListenAndServe(); err != nil &&
        !errors.Is(err, http.ErrServerClosed) {
        log.Fatalf("server: %v", err)
    }
}()
```

Type each of these from memory five times. Test yourself by writing a complete `main` without looking. The patterns are short, well-defined, and worth the practice.

---

## Appendix G: How to Talk About This in a Code Review

When reviewing PRs, here are concise comments you can leave (and that you may receive yourself):

- *"This `signal.Notify` is missing `defer signal.Stop`. Prefer `signal.NotifyContext` and `defer stop()`."*
- *"`srv.Shutdown` is called with `context.Background()`. Wrap it in `context.WithTimeout` so a stuck handler does not block the process forever."*
- *"`ListenAndServe`'s error is logged with `Fatalf`. After `Shutdown`, that returns `http.ErrServerClosed` which is the *normal* exit. Add `errors.Is` to skip it."*
- *"This goroutine takes `context.Background()`. It will never observe shutdown. Take the same `ctx` as the rest of the program."*
- *"`db.Close()` is deferred before `srv.Shutdown()` is called. Handlers in flight will hit a closed pool. Defer `db.Close` after the shutdown call."*
- *"`os.Exit(0)` inside the handler skips deferred cleanup. Return an error and let `main` exit normally."*

A team that internalises these patterns produces services that survive ten years of operations without surprises. That is the bar to aim for.

---

## Appendix H: The Smallest Test You Can Run Right Now

Save this as `gs_test.go` in a small project alongside the minimal server:

```go
package main_test

import (
    "context"
    "io"
    "net/http"
    "os/exec"
    "syscall"
    "testing"
    "time"
)

func TestServerShutsDownCleanly(t *testing.T) {
    cmd := exec.Command("go", "run", ".")
    if err := cmd.Start(); err != nil {
        t.Fatalf("start: %v", err)
    }
    defer cmd.Process.Kill()

    if !waitForPort(t, "localhost:8080", 2*time.Second) {
        t.Fatal("server never bound port")
    }

    resp, err := http.Get("http://localhost:8080/")
    if err != nil {
        t.Fatalf("GET: %v", err)
    }
    _, _ = io.Copy(io.Discard, resp.Body)
    _ = resp.Body.Close()

    if err := cmd.Process.Signal(syscall.SIGTERM); err != nil {
        t.Fatalf("signal: %v", err)
    }

    done := make(chan error, 1)
    go func() { done <- cmd.Wait() }()
    select {
    case err := <-done:
        if err != nil {
            t.Fatalf("server exited with error: %v", err)
        }
    case <-time.After(5 * time.Second):
        t.Fatal("server did not exit within 5s")
    }
}

func waitForPort(t *testing.T, addr string, d time.Duration) bool {
    t.Helper()
    deadline := time.Now().Add(d)
    for time.Now().Before(deadline) {
        ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
        req, _ := http.NewRequestWithContext(ctx, "GET", "http://"+addr+"/", nil)
        resp, err := http.DefaultClient.Do(req)
        cancel()
        if err == nil {
            _ = resp.Body.Close()
            return true
        }
        time.Sleep(50 * time.Millisecond)
    }
    return false
}
```

This test is the contract: "graceful shutdown works." If it ever fails, you have regressed something important. Run it on every PR.

---

## Appendix I: A One-Page Mental Map

If you take only one image from this file, take this one.

```
SIGTERM arrives at PID 1
   |
   v
signal.NotifyContext --> ctx is cancelled
   |                       |
   |                       v
   |               every <-ctx.Done() wakes
   |
   v
main: <-ctx.Done() returns
   |
   v
flip readiness to "not ready"   (let LB notice)
   |
   v
sleep readyDelay (e.g. 3s)
   |
   v
ctx2 = WithTimeout(Background(), 25s)
   |
   v
srv.Shutdown(ctx2)
   |   |
   |   +--- success: nil  ----------> return from main
   |
   +--- failure: ctx.Err() ----------> srv.Close()
                                       return from main
```

Memorise this. It is the entire junior-level mental model of graceful shutdown.

---

## Final Word

Graceful shutdown is a small surface area but a high-leverage skill. A team that writes its first Go service with proper shutdown handling on day one avoids an entire class of production incidents over the years that follow. A team that bolts shutdown handling on later, after an outage, learns it the hard way.

You have now read the junior file. The pattern is small enough to memorise and important enough to insist on in every Go service you ever write. Onwards to [middle.md](./middle.md).

---

## Appendix J: Real-World Cautionary Tales (Condensed)

Below are short fictionalised composites of real incidents. Each illustrates one specific shutdown failure mode and what to learn from it.

### Tale 1 — The payment service that double-charged

A payment service handled `POST /charge`. Each request inserted a row in `payments`, then called the upstream card processor, then returned the charge ID. The service shipped without graceful shutdown. During a deploy, several pods were killed with `SIGKILL` mid-handler. The database commit had already happened; the call to the processor had also happened; but the response never reached the client. The client retried. The processor charged the card again.

**Root cause.** Two: no graceful shutdown to let `POST /charge` finish, and no idempotency key to deduplicate retries. Either alone would have prevented the issue.

**Fix.** Both. Graceful shutdown was added in one PR; idempotency keys followed in a second. Errors during deploy dropped from 0.4% to 0.001%.

**Lesson.** Even with graceful shutdown, retries cause duplication. Idempotency keys are the second line of defence. Together they are bulletproof.

### Tale 2 — The metrics flush that disappeared

A service exported metrics via StatsD. Internally, an `*Aggregator` collected counters in memory and flushed them every 10 seconds via UDP. On `SIGTERM`, the program exited immediately. The 0–9 seconds of metrics between the last flush and exit were lost. Over months, the team noticed the dashboards "blinked" — gauges that should have stayed constant briefly dropped near deploy time.

**Root cause.** The aggregator's flush goroutine was never told to drain on shutdown.

**Fix.** Pass `ctx` into the aggregator. Watch `ctx.Done()`. On cancellation, do one final flush before returning.

```go
case <-ctx.Done():
    a.flush() // last gasp
    return
```

**Lesson.** Any in-memory buffer with a periodic flush is a shutdown failure mode. Always drain explicitly.

### Tale 3 — The Kubernetes pod that took 90 seconds to die

A team set `terminationGracePeriodSeconds: 120` because "we want to be safe." Their service's `Shutdown` deadline was `context.Background()` — unbounded. One handler had a bug that called a downstream that occasionally hung for two minutes. Every deploy, some pods drained slowly. Total deploy time went from 90 seconds to 15 minutes. Operations complained.

**Root cause.** No upper bound on `Shutdown`. A single stuck handler held the whole pod hostage.

**Fix.** `context.WithTimeout(30*time.Second)`. Now a stuck handler is force-closed after 30s. The bug in the handler was also fixed, but the bound on `Shutdown` was the immediate intervention.

**Lesson.** `terminationGracePeriodSeconds` is *the upper bound*. Your code's deadline must be tighter. The orchestrator's clock is *not* a substitute for yours.

### Tale 4 — The leaked WebSocket goroutines

A chat service used WebSockets. Each connection hijacked the HTTP connection and ran two goroutines: a reader and a writer. On shutdown, `srv.Shutdown(ctx)` returned almost instantly — the hijacked connections were *not* tracked by the server. The reader and writer goroutines kept running. The pod exited (because main returned), but in tests `runtime.NumGoroutine()` was 1000 at shutdown.

**Root cause.** Hijacked connections are out of `http.Server`'s graceful-shutdown tracking.

**Fix.** Maintain a registry of active WebSocket connections. Register an `OnShutdown` callback that iterates the registry and sends each WebSocket a close frame, then waits.

```go
srv.RegisterOnShutdown(func() {
    ws.CloseAll(5 * time.Second)
})
```

**Lesson.** `http.Server.Shutdown` is not magic. Anything outside its built-in tracking is your responsibility.

### Tale 5 — The signal handler that wasn't

A service had:

```go
sigCh := make(chan os.Signal)
signal.Notify(sigCh, syscall.SIGTERM)
<-sigCh
```

Unbuffered channel. Most of the time, this worked: the runtime delivered the signal exactly when main was reading from `sigCh`. Occasionally, a `SIGTERM` arrived a microsecond before main reached the receive. The runtime's non-blocking send dropped the signal. The pod ignored SIGTERM. After 30 seconds, `SIGKILL` arrived. The team did not notice because the symptoms looked the same as a slow drain.

**Root cause.** Unbuffered signal channel.

**Fix.** `make(chan os.Signal, 1)`. Or just switch to `signal.NotifyContext`.

**Lesson.** Read the `signal.Notify` documentation carefully. The buffered-channel requirement is the #1 footgun in pre-1.16 code.

### Tale 6 — The `os.Exit(0)` deep in a library

A team integrated a third-party library that, on a particular error, called `os.Exit(0)`. The library considered "exit cleanly on configuration error" to be a feature. When this happened during a request, the entire pod exited, every other in-flight request was dropped, no defers ran. The team only discovered the cause when they ran `grep -rn 'os\.Exit' vendor/`.

**Root cause.** Library called `os.Exit` from inside library code.

**Fix.** Wrapped the library calls in a recover (which does not help against `os.Exit`, but you can intercept `panic`). The real fix was to *not use that library*. They migrated to one that returned errors instead of exiting.

**Lesson.** `os.Exit` is your prerogative as the application author. No library should call it. Audit dependencies.

### Tale 7 — The metrics endpoint that never drained

A service had two listeners: API on 8080 and metrics on 9090. The signal handler called `apiSrv.Shutdown(ctx)` but forgot to call `metricsSrv.Shutdown(ctx)`. The API drained cleanly; the metrics server kept serving until the process exited (which it did when main returned, after the API drained). Prometheus saw the gap as "scrape failure" and dashboards showed a discontinuity at every deploy.

**Root cause.** Only one of two servers was drained.

**Fix.** Add the second `Shutdown` call in the existing handler.

**Lesson.** Every listener in a process needs its own drain. Audit the count.

---

## Appendix K: Final Self-Check

If you can write the following from memory, in a fresh editor, with no references, you have absorbed the junior file. Try it now.

A program that:

1. Listens on `:8080`.
2. Has one handler that takes a `?duration=2s` query parameter and sleeps that long before responding "ok".
3. Exits cleanly within 30 seconds of `SIGTERM`, allowing in-flight requests to finish.
4. Logs "shutting down" when the signal arrives and "exited" before returning.
5. Falls back to `Close` if `Shutdown` times out.

If you get stuck, re-read [Example 1](#code-examples). If it comes out without consulting it, you are ready for middle.md.

---

## Appendix L: Reading the `net/http` Source

A short paid-attention reading of `net/http/server.go` is one of the best investments a Go developer can make. The methods to start with:

- `func (srv *Server) Shutdown(ctx context.Context) error`
- `func (srv *Server) Close() error`
- `func (srv *Server) closeListenersLocked() error`
- `func (srv *Server) closeIdleConns() bool`
- `func (c *conn) setState(state ConnState)`

You will see:

- `srv.mu` is a `sync.Mutex` guarding state. Shutdown takes the lock for moments at a time.
- `srv.listeners` is a `map[*net.Listener]struct{}`. Each `ListenAndServe` registers, each `Shutdown` closes.
- `srv.activeConn` is a `map[*conn]struct{}` of in-flight connections. `closeIdleConns` filters by state.
- The 500 ms polling loop in `Shutdown` is literally `time.NewTicker(shutdownPollIntervalMax)`.

A 30-minute read makes you faster at reasoning about shutdown bugs because you know exactly what each method *does* (not just what it claims to do).

---

## Appendix M: Common Misuses of `context.Context` During Shutdown

`context.Context` is so flexible that beginners use it in ways the package author would discourage.

### Misuse 1 — Storing the cancel function in a struct field

```go
type Worker struct {
    cancel context.CancelFunc // bad
}
```

This is technically legal but a smell. The whole point of `context.WithCancel` is that the caller owns the cancellation. Putting `cancel` in a struct field invites multiple callers, double-cancel races, and unclear ownership. The recommended shape:

```go
// caller code
ctx, cancel := context.WithCancel(parent)
defer cancel()
w := NewWorker(ctx)
```

`Worker` itself does not need to know about cancel; it only watches `ctx`.

### Misuse 2 — Passing `nil` for context

```go
// bad
srv.Shutdown(nil)
```

The runtime will panic dereferencing nil. Pass `context.TODO()` if you genuinely have no context yet — but you almost always do.

### Misuse 3 — Storing context in a struct

```go
type Server struct {
    ctx context.Context // smell
}
```

The Go docs explicitly discourage this. Contexts flow through call stacks, not through long-lived struct fields. Pass `ctx` as a function argument; let the struct hold the long-lived state.

### Misuse 4 — Using `context.Background()` for shutdown

```go
// bad
srv.Shutdown(context.Background()) // unbounded!
```

If you do not bound shutdown, you cede the deadline to the orchestrator (which uses `SIGKILL`, the worst kind of deadline).

### Misuse 5 — Forgetting `defer cancel()`

```go
ctx, cancel := context.WithCancel(parent)
// ... no defer cancel() ...
go work(ctx)
```

`vet` will warn you. Address the warning.

---

## Appendix N: A One-Hour Practice Plan

If you have one hour and want to internalise this material:

- **0–10 min.** Type [Example 1](#code-examples) from memory. Run it. Press Ctrl+C with no request running. Then again with a slow request running. Observe the difference.
- **10–20 min.** Add a background ticker goroutine. Make it stop on `ctx.Done()`. Verify with `runtime.NumGoroutine()` that it exits.
- **20–35 min.** Add two listeners (API + metrics). Shut both down on signal. Use `sync.WaitGroup`.
- **35–50 min.** Write the integration test from [Appendix H](#appendix-h-the-smallest-test-you-can-run-right-now). Run it. Force a regression (remove `signal.NotifyContext`) and watch it fail.
- **50–60 min.** Read `net/http/server.go`'s `Shutdown` method. Trace through what happens line by line. You will understand the 500 ms polling, the `OnShutdown` hooks, and the listener-close loop.

An hour spent like this is worth weeks of unstructured reading.

---

## Appendix O: Closing Thoughts

You have read a long file. The pattern itself is short — fewer than 20 lines of code in `main`. Why the length?

Because every junior developer learns these patterns by colliding with the pitfalls. The unbuffered channel, the missing `errors.Is`, the unbounded context, the forgotten `defer stop()`, the `os.Exit` deep in a library — each is a one-line mistake, and each costs hours of debugging when you meet it for the first time.

The goal of this file was to compress those hours into one document. If you remember nothing else, remember the eight-line pattern in [Cheat Sheet](#cheat-sheet) and the rule "test that your shutdown works." Together they prevent 90% of the production incidents you would otherwise face.

Onwards, then, to middle.md, where we scale this pattern to real services with multiple dependencies, careful ordering, and observability.

---

## Appendix P: A Glossary You Can Quote in Interviews

These short definitions are what interviewers expect to hear if they ask "explain X" in a junior-level shutdown question.

**Signal.** A small numeric message the kernel delivers to a process. Used for asynchronous notifications. The kernel chooses an arbitrary thread to handle it; in Go, the runtime delivers it through a buffered channel to your code via `os/signal`.

**SIGTERM.** The default polite-stop signal, value 15. Sent by `kill <pid>`, by systemd, by Docker, and by Kubernetes. Catchable; default action is to terminate. The signal you must handle in production.

**SIGINT.** The terminal-interrupt signal, value 2. Sent by Ctrl+C. Catchable. The signal you handle for laptop development.

**SIGKILL.** The unstoppable terminator, value 9. The kernel removes your process; you never see it. Sent as a last resort.

**`context.Context`.** Go's standard interface for carrying cancellation and deadlines across API boundaries. Conventionally the first argument of any blocking or potentially-long-running function.

**`signal.NotifyContext`.** Returns a context that is cancelled when any of the listed signals arrives. The 1.16+ idiom for graceful shutdown.

**`http.Server.Shutdown`.** Gracefully closes the server: stops accepting new connections, waits for in-flight handlers (bounded by the context's deadline). Returns nil on success, `ctx.Err()` on timeout.

**`http.Server.Close`.** Forces an immediate shutdown: interrupts active connections. Use as fallback when `Shutdown` times out.

**`http.ErrServerClosed`.** Sentinel error returned by `ListenAndServe` after `Shutdown` or `Close`. Indicates success, not failure. Check with `errors.Is`.

**Drain.** The state of a server that has stopped accepting new work but is still serving in-flight work.

**`terminationGracePeriodSeconds`.** Kubernetes pod-spec field controlling the time between `SIGTERM` and `SIGKILL`. Default 30. Your shutdown budget must fit inside it.

**`preStop` hook.** Kubernetes lifecycle hook that runs *before* SIGTERM is delivered. Often used to insert a delay so the load balancer notices the readiness change before traffic stops.

**Readiness probe.** Kubernetes-level health check that decides whether to include the pod in Service endpoints. During shutdown, flip readiness to false first; the LB removes the pod from rotation before you start refusing connections.

**Liveness probe.** Different from readiness; the kubelet restarts the container if liveness fails. Should remain "alive" throughout a clean shutdown (you are still serving in-flight requests).

---

## Appendix Q: A Last Look at the Architecture

The diagram below summarises the relationships between the major components in a graceful-shutdown story.

```
                +-------------------+
                |  Operator / Kube  |
                |  (sends SIGTERM)  |
                +---------+---------+
                          |
                          v
                +-------------------+
                |  Linux kernel     |
                |  marks signal     |
                |  pending on Pn    |
                +---------+---------+
                          |
                          v
                +-------------------+
                |  Go runtime       |
                |  signal_recv      |
                |  goroutine        |
                +---------+---------+
                          |
                          v
                +-------------------+
                |  signal.Notify    |
                |  channel          |
                +---------+---------+
                          |
                          v
                +-------------------+
                |  context cancel   |
                |  in user code     |
                +---------+---------+
                          |
                          v
                +-------------------+
                |  main: <-Done()   |
                |  returns          |
                +---------+---------+
                          |
                          v
                +-------------------+        +-------------------+
                |  flip /readyz to  |  -->   |  load balancer    |
                |  503; sleep N s   |        |  drains traffic   |
                +---------+---------+        +-------------------+
                          |
                          v
                +-------------------+
                |  srv.Shutdown(ctx)|
                |  bounded by 25s   |
                +---------+---------+
                          |
                          v
                +-------------------+
                |  close DB, queues |
                |  in reverse order |
                +---------+---------+
                          |
                          v
                +-------------------+
                |  process exits    |
                |  with status 0    |
                +-------------------+
```

Every arrow represents a moment where you, as the program author, decide what happens. The kernel and the runtime do their part automatically; the user-code arrows are yours. Get them right and the whole chain runs smoothly. Miss any one and the process either drops requests, hangs, or gets SIGKILLed.

---

## Appendix R: A Friendly Sermon

Graceful shutdown is one of those topics where mediocre code "works most of the time" and the costs of failure are paid by your users, not by you. The 0.1% of requests that produce a 5xx during a deploy do not show up on your laptop, do not fail your unit tests, do not page you at 3 AM — until they do.

Make the small upfront investment. Wire `signal.NotifyContext` in `main`. Bound `Shutdown` with `context.WithTimeout`. Check `errors.Is(err, http.ErrServerClosed)`. Pass `ctx` to every goroutine. Add a one-line integration test that asserts your process exits cleanly within 5 seconds of `SIGTERM`. Five minutes of work that prevents months of operational pain.

That is the entire junior-level message. The rest of this Roadmap builds on it.

---

## Appendix S: A Working Multi-File Example

Below is a complete working project skeleton organised across files, in the layout described in [Putting It All Together](#putting-it-all-together-a-project-layout). Each file is short; together they form a deployable starting point.

### `go.mod`

```
module example.com/myservice

go 1.21
```

### `cmd/server/main.go`

```go
package main

import (
    "log"

    "example.com/myservice/internal/server"
)

func main() {
    if err := server.Run(); err != nil {
        log.Fatalf("fatal: %v", err)
    }
}
```

### `internal/server/server.go`

```go
package server

import (
    "context"
    "errors"
    "fmt"
    "log"
    "net/http"
    "os/signal"
    "sync"
    "syscall"
    "time"
)

const (
    listenAddr      = ":8080"
    shutdownTimeout = 25 * time.Second
    readyDelay      = 3 * time.Second
)

func Run() error {
    ctx, stop := signal.NotifyContext(context.Background(),
        syscall.SIGINT, syscall.SIGTERM)
    defer stop()

    s := newServer()

    serverErr := make(chan error, 1)
    go func() {
        log.Printf("server listening on %s", listenAddr)
        if err := s.http.ListenAndServe(); err != nil &&
            !errors.Is(err, http.ErrServerClosed) {
            serverErr <- err
            return
        }
        serverErr <- nil
    }()

    select {
    case <-ctx.Done():
        log.Printf("signal received: %v", ctx.Err())
    case err := <-serverErr:
        return fmt.Errorf("server crashed: %w", err)
    }

    return s.shutdown()
}

type server struct {
    http  *http.Server
    ready *atomicBool
}

func newServer() *server {
    var ready atomicBool
    ready.Store(true)
    mux := http.NewServeMux()
    mux.HandleFunc("/", handleRoot)
    mux.HandleFunc("/healthz", handleHealthz)
    mux.HandleFunc("/readyz", func(w http.ResponseWriter, r *http.Request) {
        if !ready.Load() {
            http.Error(w, "draining", http.StatusServiceUnavailable)
            return
        }
        w.WriteHeader(http.StatusOK)
    })

    return &server{
        http: &http.Server{
            Addr:              listenAddr,
            Handler:           mux,
            ReadHeaderTimeout: 5 * time.Second,
            ReadTimeout:       30 * time.Second,
            WriteTimeout:      30 * time.Second,
            IdleTimeout:       120 * time.Second,
        },
        ready: &ready,
    }
}

func (s *server) shutdown() error {
    s.ready.Store(false)
    log.Println("readiness off; waiting for load balancer")
    time.Sleep(readyDelay)

    shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
    defer cancel()

    log.Println("draining listener")
    if err := s.http.Shutdown(shutdownCtx); err != nil {
        log.Printf("graceful shutdown failed: %v; forcing close", err)
        _ = s.http.Close()
        return fmt.Errorf("shutdown: %w", err)
    }
    log.Println("server exited cleanly")
    return nil
}

func handleRoot(w http.ResponseWriter, r *http.Request) {
    fmt.Fprintln(w, "hello")
}

func handleHealthz(w http.ResponseWriter, r *http.Request) {
    w.WriteHeader(http.StatusOK)
}

type atomicBool struct {
    mu sync.RWMutex
    v  bool
}

func (a *atomicBool) Load() bool {
    a.mu.RLock()
    defer a.mu.RUnlock()
    return a.v
}

func (a *atomicBool) Store(v bool) {
    a.mu.Lock()
    defer a.mu.Unlock()
    a.v = v
}
```

Build, run, send `SIGTERM`. The output should look something like:

```
2026/05/15 12:00:00 server listening on :8080
2026/05/15 12:00:05 signal received: context canceled
2026/05/15 12:00:05 readiness off; waiting for load balancer
2026/05/15 12:00:08 draining listener
2026/05/15 12:00:08 server exited cleanly
```

Total shutdown time: ~3 seconds (most of which is the `readyDelay`). In-flight requests during those 3 seconds finish; new requests after the readiness flip are 503'd.

That is the entire pattern. Memorise it, copy it into your next project, and you will have done what this junior file set out to teach.







