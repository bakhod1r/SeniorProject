---
layout: default
title: Junior — Drain Pattern
parent: Drain Pattern
grand_parent: Production Patterns
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/18-production-patterns/05-drain-pattern/junior/
---

# Drain Pattern — Junior Level

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
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use / Feature](#product-use-feature)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
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
> Focus: "What is draining? Why can't I just call `os.Exit(0)`? How do I make sure my service finishes its work before it stops?"

A **drain** is the controlled emptying of a system: water from a tub, fuel from a tank, requests from a server. In Go services, **draining** is the act of telling your program "do not accept new work" while letting the work already in progress finish. Then, and only then, do you actually exit.

The drain pattern is the opposite of a **hard stop**. A hard stop is what happens when you press Ctrl+C twice or call `os.Exit(0)`: the operating system tears your process down immediately. Any goroutine that was mid-database-write gets cut off. Any HTTP response that was half-sent disappears. Any Kafka message your consumer was processing but had not committed gets re-delivered to a different consumer — possibly causing a duplicate side effect like a double charge on a credit card.

A graceful drain avoids all of that. It gives in-flight work a chance to land safely on disk, in the network, or in the next service. It is one of the most important production patterns in Go, and yet it is missed in almost every tutorial.

After reading this file you will:

- Know what draining means in plain English
- Understand the difference between hard stop and graceful drain
- Be able to drain a simple worker goroutine using a context and a `sync.WaitGroup`
- Know what a deadline-bounded drain is and why you need one
- Recognise the three pieces of every drain: stop intake, wait for in-flight, close downstream
- See your first integration with `signal.Notify` and `os.Interrupt`
- Understand why a drain is often the difference between a clean rolling deploy and a customer-facing incident

You do not need to know about Kafka rebalances, complex supervisor trees, or two-phase shutdown protocols yet. Those live in middle, senior, and professional. This file is about the smallest, most useful version of the drain pattern — the one you will reach for on day one of any real service.

---

## Prerequisites

- **Required:** Go 1.21 or newer. Run `go version` to check.
- **Required:** Comfort with goroutines and channels at the basic level. You should know what `go f()` does and how to send and receive on a channel.
- **Required:** Awareness of `context.Context`. You do not have to know every method; knowing that a context can be cancelled is enough.
- **Required:** A `main()` function and the ability to run `go run main.go`.
- **Helpful:** Familiarity with `sync.WaitGroup`. We will use it in every example.
- **Helpful:** A vague memory of `os.Signal` from operating systems class. We will explain `SIGTERM` and `SIGINT` from scratch.

If you can write a program that spawns three goroutines, sends them work on a channel, and waits for them with a `WaitGroup`, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Drain** | The act of letting in-flight work complete while refusing new work. The system "empties" before stopping. |
| **Quiesce** | A near-synonym for drain, common in distributed systems: make the system idle by stopping intake. |
| **Hard stop** | Immediate termination. `os.Exit`, `kill -9`, or a crash. No graceful cleanup. |
| **Graceful shutdown** | A shutdown that includes drain. Stop intake, finish work, close resources, exit zero. |
| **In-flight work** | Tasks that have been accepted but not yet finished. A drain waits for these. |
| **Deadline-bounded drain** | A drain with a maximum time budget. After the deadline, remaining work is abandoned or force-cancelled. |
| **Idle-wait** | The phase where intake is closed and the program just waits for workers to report "I am done." |
| **`SIGTERM`** | The polite Unix "please stop" signal. Kubernetes sends this on pod termination. Always handled, never ignored. |
| **`SIGINT`** | The Ctrl+C signal. Same intent as `SIGTERM` for most servers. |
| **`SIGKILL`** | The impolite "stop now" signal. Cannot be handled by the program. The kernel terminates the process. |
| **Termination grace period** | The time a process is given between `SIGTERM` and the kernel's `SIGKILL`. Kubernetes default is 30 seconds. |
| **`context.WithCancel`** | Returns a context that can be cancelled by calling its `cancel` function. The signal to "stop intake." |
| **`context.WithTimeout`** | A context that auto-cancels after a duration. The bound on a drain deadline. |
| **`sync.WaitGroup`** | Counter for goroutines. `Add` before spawn, `Done` on exit, `Wait` to block until zero. |

---

## Core Concepts

### Drain is three steps, always in this order

Every drain, no matter how complex, breaks down into the same three steps:

1. **Stop accepting new work.** Close the inbound channel, return 503 from the HTTP listener, pause the queue consumer. New requests are politely refused or queued upstream for the next pod.
2. **Wait for in-flight work to finish.** The workers that already have a task on their plate continue. You block until they are all done.
3. **Close downstream resources.** Database connections, Kafka producers, file handles. Only after every worker has reported "no more work in my hands."

Skip step 1 and you keep adding work even as you try to stop. Skip step 2 and you cut off live requests. Skip step 3 and you leak file descriptors and corrupt state. The order matters.

### Drain needs a deadline

If you wait forever for in-flight work, one hung worker will keep your pod alive forever. Kubernetes will eventually run out of patience and send `SIGKILL` — and now you are back to a hard stop, except you also missed the chance to flush whatever you could have flushed.

The fix is a **deadline-bounded drain**: "give workers up to 25 seconds to finish; after that, cancel their contexts and force them to exit." The deadline is shorter than the platform's grace period (30 seconds in Kubernetes) so you have time to clean up resources before the kernel arrives.

### Drain is not just for shutdown

The drain pattern shows up in more places than you might think:

- **Rolling deploys** — when a new version of your pod is starting, the old one drains before exiting.
- **Kafka rebalances** — when partitions are reassigned, a consumer drains the in-flight messages from the partitions it is about to lose.
- **Worker pool resize** — shrinking a pool drains the workers being removed.
- **Database failover** — connections to the old primary drain before being routed to the new primary.

The mechanics are similar in every case: stop intake, wait, close.

### Hard stop is sometimes correct

The drain pattern is the default for stateful or side-effecting services. But there are times when a hard stop is the right call:

- **Read-only services with idempotent retries.** If a load balancer will retry on the next pod, dropping the in-flight request costs almost nothing.
- **Tests.** A test process exiting on `os.Exit(1)` after a failure is normal.
- **Detected corruption.** If you discover your own state is bad, stopping fast prevents the corruption from spreading.

Knowing when *not* to drain is part of using the pattern well.

---

## Real-World Analogies

### A coffee shop closing for the night

It is 9:55 PM. The shop closes at 10:00. The barista turns the "Open" sign to "Closed" — no new customers walk in. Three customers are already at the counter; the barista finishes their drinks. At 10:05 the last drink is handed over. The barista locks the door, turns off the espresso machine, and goes home.

That is a drain. The "Closed" sign is step 1. Finishing the three drinks is step 2. Locking the door and turning off the machine is step 3. The 10-minute deadline (call it the grace period) is the bound. If a customer's order was somehow taking 30 minutes, the barista would still leave at 10:05 — that is the deadline kicking in.

A hard stop would be: at 9:55 the barista drops three half-made drinks on the counter, walks out, locks the door. The customers are upset, the espresso is wasted, the cups have to be thrown out tomorrow.

### A factory line ending a shift

The conveyor belt feeding raw parts is stopped first. The line workers keep assembling whatever is already on the belt. Once the belt is empty and every part has been assembled or set aside, the workers turn off the machines and leave.

The conveyor belt is your inbound queue. The workers are your goroutines. Turning off the belt is closing your channel. Letting them finish the parts on the belt is the drain wait. Turning off the machines is closing your database connections.

### An elevator at end of service

A maintenance elevator going out of service at midnight does not just stop. It refuses new floor-button presses (no new work) and then finishes the trip it is on (in-flight work). Only at the lobby does it park itself and the doors stay open. If somebody had been frantically pressing buttons for a thirty-third floor, that request is cancelled at the deadline — the elevator parks and the technician walks them out.

---

## Mental Models

### The funnel model

Think of your service as a funnel. Requests pour in the top, flow through the goroutines in the middle, and exit at the bottom into a database or another service. A drain is closing the top of the funnel — no new pour — and waiting for the funnel to empty from the bottom up. The drain is over when the funnel is dry.

### The bucket-brigade model

Imagine a chain of people passing buckets of water. When the brigade ends, the first person stops scooping — no new buckets enter the chain. Each person passes whatever bucket they are holding to the next. Once the buckets reach the end and there is nothing left in anyone's hands, the brigade is over.

This maps well onto pipelined services: HTTP server → worker pool → database. The first stage drains first; each subsequent stage drains as its upstream empties.

### The two-clock model

Every drain has two clocks running.

- **Worker clock** — how long it actually takes the workers to finish.
- **Deadline clock** — how long you are willing to wait.

A drain ends when either clock reaches zero. If the worker clock reaches zero first, you did a "clean drain" — every task finished. If the deadline clock reaches zero first, you did a "forced drain" — some tasks were cancelled. Production drains aim to almost always be clean drains, but a forced drain is still better than an unbounded wait followed by `SIGKILL`.

---

## Pros & Cons

### Pros

- **Zero data loss on rolling deploys.** Every accepted request gets a response. Every accepted Kafka message gets committed.
- **Predictable shutdown time.** With a deadline, you know the maximum cost of a drain.
- **Customer-friendly.** Users do not see a 502 in the middle of their checkout because your old pod went away.
- **Plays well with orchestrators.** Kubernetes, Nomad, ECS all assume `SIGTERM` will be handled this way.
- **Compose-friendly.** Drains chain naturally: server drains, then pool drains, then DB closes.

### Cons

- **More code.** A non-draining service is shorter. The drain adds a context, a wait group, a signal handler, a deadline.
- **Race-prone if done casually.** Closing a channel that someone is still sending to is a panic. Order of operations matters.
- **Untested in most codebases.** Most teams never simulate a drain in CI; the first real test is a production deploy.
- **Hides slow shutdowns.** If your drain takes 25 seconds every deploy and nobody notices, you have a leak you do not see.

---

## Use Cases

- **HTTP API servers.** Drain before exit so in-flight responses are completed.
- **Kafka consumers.** Commit offsets for fully processed messages before releasing partitions.
- **Worker pools.** Let queued jobs in the channel be picked up and processed before the pool dies.
- **Cron-like job runners.** A long-running job that took the lock should finish before the next pod takes over.
- **WebSocket gateways.** Close existing sessions politely, refuse new ones.
- **gRPC servers.** `GracefulStop` is the gRPC drain primitive.
- **Background batch flushers.** A buffer that flushes every 5 seconds should flush one last time on shutdown.

---

## Code Examples

### Example 1: The smallest possible drain

A worker reads from a channel and processes items. We want it to stop accepting new items and finish what is in the channel before exiting.

```go
package main

import (
	"fmt"
	"sync"
	"time"
)

func worker(id int, in <-chan int, wg *sync.WaitGroup) {
	defer wg.Done()
	for item := range in {
		time.Sleep(100 * time.Millisecond) // simulate work
		fmt.Printf("worker %d done with %d\n", id, item)
	}
	fmt.Printf("worker %d exiting\n", id)
}

func main() {
	in := make(chan int, 10)
	var wg sync.WaitGroup

	for i := 1; i <= 3; i++ {
		wg.Add(1)
		go worker(i, in, &wg)
	}

	for i := 1; i <= 5; i++ {
		in <- i
	}

	// Drain step 1: stop accepting new work.
	close(in)

	// Drain step 2: wait for in-flight work.
	wg.Wait()

	// Drain step 3: nothing to close in this toy example.
	fmt.Println("clean shutdown")
}
```

Closing `in` tells every worker "no more items, exit when the channel is drained." `wg.Wait()` blocks until all three workers call `wg.Done`. The output ends with `clean shutdown` and the process exits with code 0.

### Example 2: Adding a context for cancellation

Closing a channel is fine for "no more work coming," but sometimes you want to also tell workers "stop what you are doing." For that we add a `context.Context`.

```go
package main

import (
	"context"
	"fmt"
	"sync"
	"time"
)

func worker(ctx context.Context, id int, in <-chan int, wg *sync.WaitGroup) {
	defer wg.Done()
	for {
		select {
		case <-ctx.Done():
			fmt.Printf("worker %d cancelled\n", id)
			return
		case item, ok := <-in:
			if !ok {
				fmt.Printf("worker %d done\n", id)
				return
			}
			time.Sleep(50 * time.Millisecond)
			fmt.Printf("worker %d processed %d\n", id, item)
		}
	}
}

func main() {
	ctx, cancel := context.WithCancel(context.Background())
	in := make(chan int, 5)
	var wg sync.WaitGroup

	for i := 1; i <= 3; i++ {
		wg.Add(1)
		go worker(ctx, i, in, &wg)
	}

	for i := 1; i <= 4; i++ {
		in <- i
	}
	close(in)

	// Wait for natural drain.
	wg.Wait()
	cancel() // tidy up the context

	fmt.Println("done")
}
```

Here the workers exit either because the channel closes (clean drain) or because the context is cancelled (forced drain). On a normal shutdown the channel close wins; on an emergency the cancel wins.

### Example 3: Drain with a deadline

A real service caps the drain time. If workers do not finish in 5 seconds, we force-cancel and exit anyway.

```go
package main

import (
	"context"
	"fmt"
	"sync"
	"time"
)

func slowWorker(ctx context.Context, id int, in <-chan int, wg *sync.WaitGroup) {
	defer wg.Done()
	for {
		select {
		case <-ctx.Done():
			fmt.Printf("worker %d cancelled at deadline\n", id)
			return
		case item, ok := <-in:
			if !ok {
				return
			}
			select {
			case <-time.After(2 * time.Second):
				fmt.Printf("worker %d finished %d\n", id, item)
			case <-ctx.Done():
				fmt.Printf("worker %d gave up on %d\n", id, item)
				return
			}
		}
	}
}

func main() {
	in := make(chan int, 10)
	for i := 1; i <= 8; i++ {
		in <- i
	}
	close(in)

	drainCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var wg sync.WaitGroup
	for i := 1; i <= 2; i++ {
		wg.Add(1)
		go slowWorker(drainCtx, i, in, &wg)
	}

	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()

	select {
	case <-done:
		fmt.Println("clean drain")
	case <-drainCtx.Done():
		fmt.Println("drain deadline exceeded, forcing exit")
		<-done // still wait for goroutines to actually return
	}
}
```

This is the canonical deadline-bounded drain. Notice that even after the deadline fires we still wait on `done`. We do not abandon the goroutines; we let them see the cancelled context and exit. Otherwise we would leak.

### Example 4: Drain on `SIGTERM`

In a real service the drain is triggered not by `main` choosing to stop, but by an external signal.

```go
package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"
)

func runWorker(ctx context.Context, in <-chan int, wg *sync.WaitGroup) {
	defer wg.Done()
	for {
		select {
		case <-ctx.Done():
			return
		case item, ok := <-in:
			if !ok {
				return
			}
			time.Sleep(200 * time.Millisecond)
			fmt.Printf("processed %d\n", item)
		}
	}
}

func main() {
	in := make(chan int, 100)

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)

	rootCtx, cancelRoot := context.WithCancel(context.Background())
	defer cancelRoot()

	var wg sync.WaitGroup
	for i := 0; i < 3; i++ {
		wg.Add(1)
		go runWorker(rootCtx, in, &wg)
	}

	// Producer goroutine.
	go func() {
		i := 0
		for {
			select {
			case <-rootCtx.Done():
				close(in)
				return
			case in <- i:
				i++
				time.Sleep(50 * time.Millisecond)
			}
		}
	}()

	<-stop
	fmt.Println("signal received, draining")

	cancelRoot()

	drained := make(chan struct{})
	go func() { wg.Wait(); close(drained) }()

	select {
	case <-drained:
		fmt.Println("clean drain")
	case <-time.After(10 * time.Second):
		fmt.Println("drain timed out")
	}
}
```

Press Ctrl+C and the producer stops, the channel closes, the workers finish what is in their hand, and the program exits.

### Example 5: HTTP server drain

`net/http` has a built-in drain via `Server.Shutdown`. It stops accepting new connections and waits for in-flight requests to finish, up to the deadline of the context you pass.

```go
package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/slow", func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(3 * time.Second)
		fmt.Fprintln(w, "done")
	})

	srv := &http.Server{Addr: ":8080", Handler: mux}

	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			fmt.Println("server error:", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	fmt.Println("draining HTTP server")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		fmt.Println("shutdown error:", err)
	}
	fmt.Println("server stopped")
}
```

If `/slow` is mid-request when the signal arrives, the server lets it finish (3 seconds) before exiting. New requests get connection refused because the listener is closed. After 10 seconds, anything still hanging is force-closed.

### Example 6: Drain with idle-wait

Sometimes there is no neat channel to close — work arrives unpredictably and you must wait until the system has been idle for a while.

```go
package main

import (
	"fmt"
	"sync/atomic"
	"time"
)

type Service struct {
	inFlight atomic.Int64
}

func (s *Service) Handle() {
	s.inFlight.Add(1)
	defer s.inFlight.Add(-1)
	time.Sleep(100 * time.Millisecond)
}

func (s *Service) Drain(idle, deadline time.Duration) {
	end := time.Now().Add(deadline)
	for time.Now().Before(end) {
		if s.inFlight.Load() == 0 {
			time.Sleep(idle)
			if s.inFlight.Load() == 0 {
				return
			}
		}
		time.Sleep(50 * time.Millisecond)
	}
}

func main() {
	s := &Service{}
	for i := 0; i < 5; i++ {
		go s.Handle()
	}
	s.Drain(200*time.Millisecond, 5*time.Second)
	fmt.Println("drained")
}
```

The idle-wait pattern is "be idle for at least 200ms before declaring drained." It is useful for systems where new work can arrive even after intake is supposedly closed (think: in-process retries).

### Example 7: Refusing new work during drain

A handler that returns 503 once the service is draining.

```go
package main

import (
	"net/http"
	"sync/atomic"
)

type App struct {
	draining atomic.Bool
}

func (a *App) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if a.draining.Load() {
			http.Error(w, "shutting down", http.StatusServiceUnavailable)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (a *App) StartDrain() {
	a.draining.Store(true)
}
```

`StartDrain` is called as the first action of your shutdown handler — before you even call `Server.Shutdown`. This is important if your load balancer keeps sending requests for a moment after `SIGTERM` (most do, briefly).

### Example 8: Tracking in-flight count by hand

The pattern from example 6 wrapped into a reusable type.

```go
package main

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"time"
)

type Drainer struct {
	inFlight atomic.Int64
	closed   atomic.Bool
	mu       sync.Mutex
}

func (d *Drainer) Enter() error {
	if d.closed.Load() {
		return errors.New("draining")
	}
	d.inFlight.Add(1)
	if d.closed.Load() {
		d.inFlight.Add(-1)
		return errors.New("draining")
	}
	return nil
}

func (d *Drainer) Exit() {
	d.inFlight.Add(-1)
}

func (d *Drainer) Drain(ctx context.Context) error {
	d.closed.Store(true)
	for d.inFlight.Load() > 0 {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(20 * time.Millisecond):
		}
	}
	return nil
}
```

The `Enter`/`Exit` pair is the bookend of every request. `Drain` closes intake and polls until the counter reaches zero.

---

## Coding Patterns

### Pattern: the shutdown function returns

In Go, the idiomatic way to express drain is "the function that started the workers also stops them." A `Run` method takes a context and returns when everything has drained:

```go
func (s *Server) Run(ctx context.Context) error {
	// start workers ...
	<-ctx.Done()
	// drain ...
	return nil
}
```

The caller passes a cancellable context. Cancelling it triggers the drain.

### Pattern: errgroup for drain

`golang.org/x/sync/errgroup` lets you wait on a set of goroutines and capture the first error:

```go
import "golang.org/x/sync/errgroup"

g, ctx := errgroup.WithContext(ctx)
g.Go(func() error { return server.Run(ctx) })
g.Go(func() error { return consumer.Run(ctx) })
if err := g.Wait(); err != nil { /* one died, others see ctx cancellation */ }
```

When any goroutine returns an error, the group context is cancelled and the others see it as a drain signal.

### Pattern: split shutdown into phases

Phase 1: refuse new work. Phase 2: wait for in-flight. Phase 3: close downstream. Implement each as a method:

```go
func (s *Server) Drain(ctx context.Context) error {
	s.StopIntake()
	if err := s.WaitInFlight(ctx); err != nil { return err }
	return s.CloseDownstream()
}
```

This is straightforward to test, easy to reason about, and easy to extend.

---

## Clean Code

- **Name the context.** `drainCtx`, `shutdownCtx` — never just `ctx` if the context's job is to bound a drain.
- **Always defer the cancel.** Even after a clean drain, `cancel()` should run. `defer cancel()` right after `WithTimeout`.
- **Keep `main` shallow.** `main` wires signal handling and starts components. The drain logic lives in the components.
- **Pass context, do not store it.** A struct that stores a context will keep that context alive longer than expected. Pass it through `Run`/`Drain` parameters.
- **One drain per component.** Do not let the HTTP server reach into the worker pool to drain it. Each component drains itself and exposes a `Drain(ctx) error`.
- **Log timings.** A `log.Printf("drain took %s", time.Since(start))` after every drain is gold during incident reviews.

---

## Product Use / Feature

Imagine a checkout service that emits a `payment.completed` event to Kafka. Without drain: a rolling deploy interrupts a checkout half-way; the payment is captured but the event is never sent. The downstream "send a receipt email" service never runs. The customer is charged and gets no email.

With drain: the pod receives `SIGTERM`, marks itself draining (so the LB stops routing new checkouts to it), finishes the three in-flight checkouts (including emitting their events), and exits. Zero stuck payments, zero missing emails, no Sunday-evening pager.

The drain pattern is what makes "we deploy four times a day" boring.

---

## Error Handling

A drain has its own family of errors:

- **`context.DeadlineExceeded`** — drain ran out of time. Common, expected, worth logging with the number of in-flight items that did not finish.
- **`context.Canceled`** — drain context was cancelled before completion. Usually means a second signal arrived (operator pressed Ctrl+C twice) and you should now exit fast.
- **`net.ErrClosed`** — listener already closed. Often safe to ignore; surface only at debug level.
- **Worker errors after drain start** — drop into a side-buffer and log. They are post-mortem evidence, not actionable.

Wrap them with `fmt.Errorf("drain server: %w", err)` so a top-level log shows the chain.

---

## Security Considerations

- **Do not skip drain to recover from a security incident.** If you suspect compromise, hard stop is correct — drain might exfiltrate.
- **Do not log message bodies during drain.** A panic log on a half-processed message can leak PII into logs.
- **Health-check spoofing.** A draining pod that still says "healthy" can be picked by a malicious caller to keep it alive. Always flip the health endpoint to "draining" before the work signal.

---

## Performance Tips

- **Drain time is on the deploy critical path.** A 30-second drain across 50 pods adds up.
- **Idle-wait with a long poll is cheaper than busy-wait.** 20–50ms sleep between checks is fine.
- **Use `sync.WaitGroup` over atomic counters where possible.** `Wait` blocks; you do not have to poll.
- **Avoid global locks during drain.** A worker waiting for a mutex held by a drainer is the recipe for a missed deadline.
- **Pre-size buffered channels.** If a channel is the intake buffer, do not let it grow forever during drain — that just adds work.

---

## Best Practices

- Always handle `SIGTERM` *and* `SIGINT` in production binaries.
- Always cap drain time with a context deadline.
- Always flip a "draining" flag before stopping the listener — so health checks turn unhealthy first.
- Always log start and end of drain with timings.
- Always test drain with `kill -TERM` in your dev environment, not just Ctrl+C.
- Never call `os.Exit` from a library — only `main` decides exit.
- Never use a goroutine pool without an explicit `Stop`/`Drain` method.

---

## Edge Cases & Pitfalls

- **Sending on a closed channel.** Panics. The producer must check the drain flag before sending.
- **Double close of a channel.** Panics. Use `sync.Once` or a "done" channel to guarantee single close.
- **A worker that re-enqueues to itself.** During drain, the channel may already be closed. Either drain before resignaling or have a "stop accepting" gate.
- **`select` with a `default` case in a worker.** If every case is blocking and `default` fires immediately, your "drain wait" becomes a CPU spin.
- **`time.After` in a hot loop.** Creates a timer every iteration. Use `time.NewTimer` and reset it.
- **A nil channel in a `select`.** Blocks forever. Useful trick for disabling a case — but easy to do by accident during drain.

---

## Common Mistakes

1. **Forgetting to call `cancel`.** Even if context auto-expires, calling `cancel` releases resources earlier.
2. **Calling `Shutdown` from inside a handler.** A handler running on the server cannot wait for the server to stop. Trigger drain from outside.
3. **Logging on every poll iteration.** A drain that polls every 20ms and logs every poll produces 50 log lines per second of drain.
4. **Closing the inbound channel from a goroutine that is itself an inbound producer.** Race against other producers.
5. **Using `select` without a `<-ctx.Done()` case in workers.** No way to force exit on deadline.
6. **Drain timeout shorter than the slowest operation.** A 1-second drain on a service whose median handler is 800ms drops 30% of requests every deploy.

---

## Common Misconceptions

- **"`os.Exit` is fine, the OS cleans up."** It does not flush your application buffers, commit your Kafka offsets, or send your final HTTP response.
- **"`defer` runs on `SIGTERM`."** Only if you handle the signal yourself. Without `signal.Notify`, your program is killed and no defers run.
- **"A graceful shutdown means no errors."** A drain can still emit errors (deadline exceeded, partial flush). Graceful means "as good as we could do," not "perfect."
- **"Buffered channels are enough for drain."** Buffering helps absorb spikes; it does not by itself implement drain. You still need close + wait.
- **"WaitGroup waits forever."** It waits until the counter is zero. If you never call `Done`, it waits forever — that is a bug, not a feature.

---

## Tricky Points

### `Wait` on a `WaitGroup` whose count was never incremented

Returns immediately. That is sometimes desirable (no workers spawned) but can hide a bug where you forgot `Add`. Always pair `wg.Add(1)` and `defer wg.Done()` tightly.

### Closing a channel from a producer that may still have buffered sends

`close` is safe even if there are buffered items; the receiver can still read them. What is *not* safe is sending after close. Producers must check a stop signal before sending.

### `context.Background` versus a fresh context for the drain

For the *root* of a server, `context.Background` is correct. For the drain phase, `context.WithTimeout(context.Background(), drainBudget)` — note we do *not* derive from the cancelled service context, because that context is already cancelled and the drain would have zero time.

### `signal.Notify` with an unbuffered channel

If the signal arrives before your code reaches `<-stop`, the runtime drops it. Always pass a buffered channel (`make(chan os.Signal, 1)`).

### Health endpoints during drain

Most load balancers do not stop sending traffic the instant you call `Shutdown`. There is a propagation delay. Flip the health endpoint to "draining" first, sleep for the LB's check interval (often 5 seconds), then start the server drain.

---

## Test

```go
package drain_test

import (
	"context"
	"sync/atomic"
	"testing"
	"time"
)

type Counter struct{ n atomic.Int64 }

func (c *Counter) Add()  { c.n.Add(1) }
func (c *Counter) Done() { c.n.Add(-1) }
func (c *Counter) Load() int64 { return c.n.Load() }

func TestDrainWaitsForInFlight(t *testing.T) {
	c := &Counter{}
	c.Add()

	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()

	go func() {
		time.Sleep(50 * time.Millisecond)
		c.Done()
	}()

	for c.Load() > 0 {
		select {
		case <-ctx.Done():
			t.Fatal("drain deadline exceeded")
		case <-time.After(10 * time.Millisecond):
		}
	}
}

func TestDrainHonoursDeadline(t *testing.T) {
	c := &Counter{}
	c.Add()

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	done := false
	for c.Load() > 0 && !done {
		select {
		case <-ctx.Done():
			done = true
		case <-time.After(5 * time.Millisecond):
		}
	}
	if !done {
		t.Fatal("expected deadline to fire")
	}
}
```

Run with `go test -race ./...`. The first test proves drain waits for in-flight to clear; the second proves the deadline actually bounds the wait.

---

## Tricky Questions

**Q1.** What is the difference between `close(ch)` and cancelling a context?
**A.** `close(ch)` signals "no more values," and receivers see `ok=false`. Cancelling a context signals "stop what you are doing," and goroutines see `<-ctx.Done()`. Drain often uses both: close to say "done with input," cancel to say "abort current work."

**Q2.** Why is a deadline necessary?
**A.** Because some work never finishes. Without a bound, a hung handler can keep your pod alive past the grace period — and the kernel will `SIGKILL` it anyway, undoing any progress you had made on the drain.

**Q3.** What happens if the LB still sends traffic after `Shutdown` is called?
**A.** Those connections may be accepted briefly (depending on socket state) but the server will not start new request goroutines after `Shutdown` is called. The LB will get connection refused on subsequent attempts. To smooth the transition, mark the service unhealthy first, wait a moment, then call `Shutdown`.

**Q4.** Should I drain before or after closing my database?
**A.** Drain first, close database after. The drain is the consumer of the database; closing it first cancels the in-flight work.

**Q5.** What is the simplest way to detect a goroutine leak post-drain?
**A.** Call `runtime.NumGoroutine` before and after. If the post-drain number is much higher than the baseline, you have a leak.

---

## Cheat Sheet

```text
DRAIN = STOP_INTAKE -> WAIT_INFLIGHT -> CLOSE_DOWNSTREAM
Always bound the wait with a deadline.
SIGTERM -> drain. SIGKILL -> too late.
Health endpoint flips first, listener stops second.
Test with kill -TERM in dev. Verify with /metrics in prod.
```

```go
ctx, cancel := signal.NotifyContext(ctx, os.Interrupt, syscall.SIGTERM)
defer cancel()

go server.Run(ctx)
<-ctx.Done()

drainCtx, drainCancel := context.WithTimeout(context.Background(), 25*time.Second)
defer drainCancel()
_ = server.Drain(drainCtx)
```

---

## Self-Assessment Checklist

- [ ] I can explain the three steps of a drain in one sentence each.
- [ ] I can write a worker that exits cleanly on a closed channel.
- [ ] I can write a worker that exits on a cancelled context.
- [ ] I can combine both in a `select` block.
- [ ] I can wire `signal.Notify` to a context and use it to trigger drain.
- [ ] I can bound a drain with `context.WithTimeout`.
- [ ] I can use `http.Server.Shutdown` and explain what it does.
- [ ] I can describe the difference between `SIGTERM`, `SIGINT`, and `SIGKILL`.
- [ ] I can identify the most common pitfall: sending on a closed channel.

---

## Summary

The drain pattern is the discipline of stopping a service in three steps: refuse new work, wait for in-flight work, close downstream resources. Every step is bounded by a deadline so a hung worker cannot block the whole shutdown. The pattern is built on three Go primitives: `context` for cancellation and deadlines, `sync.WaitGroup` for tracking in-flight goroutines, and `signal.Notify` for catching the OS shutdown signal. With those three pieces and a clear sense of order, you can shut down any Go service cleanly enough to roll out new versions four times a day without paging anyone.

---

## What You Can Build

- A worker pool with `Start`, `Submit`, and `Drain(ctx)` methods.
- An HTTP API server that returns 200 from `/healthz` until it starts draining, then 503.
- A CLI tool that processes a list of files and supports Ctrl+C to "finish the current file, skip the rest."
- A batch job runner that flushes its buffer on exit.
- A simple message-queue consumer (Redis list, NATS, RabbitMQ) that drains on signal.

---

## Further Reading

- The `net/http` package documentation for `Server.Shutdown`.
- The Go blog post "Go Concurrency Patterns: Context."
- The `golang.org/x/sync/errgroup` package documentation.
- Kubernetes documentation on pod lifecycle, especially the termination grace period.
- The `signal` package documentation, especially `signal.NotifyContext`.

---

## Related Topics

- [Graceful Shutdown](../../03-graceful-shutdown/)
- [Context Cancellation](../../../06-context/)
- [Worker Pools](../../../12-worker-pool/)
- [Signal Handling](../../04-signal-handling/)
- [Kafka Consumer Patterns](../../06-kafka-consumers/)

---

## Diagrams & Visual Aids

```text
                   ┌─────────────┐
                   │   SIGTERM    │
                   └──────┬──────┘
                          │
                          ▼
                ┌───────────────────┐
                │ 1. Stop Intake     │  (close listener / channel / flag)
                └─────────┬─────────┘
                          │
                          ▼
                ┌───────────────────┐
                │ 2. Wait In-Flight  │  (WaitGroup.Wait, bounded by deadline)
                └─────────┬─────────┘
                          │
                          ▼
                ┌───────────────────┐
                │ 3. Close Downstream│  (DB, Kafka, files)
                └─────────┬─────────┘
                          │
                          ▼
                       exit 0
```

```text
Time ──────────────────────────────────────────────►

intake  ████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░  (stops at SIGTERM)
work-1  ░░░░████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░
work-2  ░░░░░░██████████░░░░░░░░░░░░░░░░░░░░░░░░
work-3  ░░░░░░░░░░██████████████░░░░░░░░░░░░░░░░  (still running)

SIGTERM ▲                  ▲ deadline
        │                  │
        │←──── drain ──────│
```

The first diagram is the pipeline of phases. The second is a time-series view: intake stops the instant the signal arrives; individual workers finish at their own pace; the deadline puts a hard cap on how long we wait.

---

## Extended Walkthrough: Building Drain From Scratch

To really internalise the drain pattern, let us build it from nothing. We start with a service that does not handle shutdown at all. Then we add each piece, one at a time, watching what happens.

### Step 0 — A service that ignores shutdown

```go
package main

import (
	"fmt"
	"time"
)

func main() {
	jobs := make(chan int, 5)

	go func() {
		for j := range jobs {
			time.Sleep(500 * time.Millisecond)
			fmt.Printf("processed %d\n", j)
		}
	}()

	for i := 1; ; i++ {
		jobs <- i
		time.Sleep(100 * time.Millisecond)
	}
}
```

Run this and press Ctrl+C. The output stops mid-sentence. The worker may have been mid-`Sleep` when the program died. No defers ran. The channel is leaked, the goroutine is leaked, the OS reclaims memory but no application-level cleanup happened.

This is the baseline. We will not ship this.

### Step 1 — Catch the signal

The smallest change: tell the runtime "I want to know about `SIGINT` and `SIGTERM`."

```go
package main

import (
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	jobs := make(chan int, 5)

	go func() {
		for j := range jobs {
			time.Sleep(500 * time.Millisecond)
			fmt.Printf("processed %d\n", j)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)

	go func() {
		for i := 1; ; i++ {
			jobs <- i
			time.Sleep(100 * time.Millisecond)
		}
	}()

	<-stop
	fmt.Println("got signal")
}
```

Now Ctrl+C prints `got signal` and exits. But the worker did not finish what it was doing. The drain is still missing.

### Step 2 — Tell the worker to stop

We need a way to say "no more work." The classic way is to close the input channel.

```go
package main

import (
	"fmt"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"
)

func main() {
	jobs := make(chan int, 5)
	var wg sync.WaitGroup

	wg.Add(1)
	go func() {
		defer wg.Done()
		for j := range jobs {
			time.Sleep(500 * time.Millisecond)
			fmt.Printf("processed %d\n", j)
		}
		fmt.Println("worker exit")
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)

	done := make(chan struct{})
	go func() {
		i := 1
		for {
			select {
			case <-done:
				return
			case jobs <- i:
				i++
				time.Sleep(100 * time.Millisecond)
			}
		}
	}()

	<-stop
	fmt.Println("draining")
	close(done)
	close(jobs)
	wg.Wait()
	fmt.Println("clean exit")
}
```

Now the sequence is: signal arrives, we tell the producer to stop, we close the jobs channel, the worker drains what is left in the buffer, prints `worker exit`, the wait group unblocks, and we print `clean exit`.

This is already a working drain. Read it twice. The pieces are: a stop channel, a producer that checks the stop channel before each send, a closeable input channel, a wait group around the worker, and a final `Wait` in main.

### Step 3 — Add a deadline

What if the worker is hung? We bound the wait.

```go
done := make(chan struct{})
go func() { wg.Wait(); close(done) }()

select {
case <-done:
	fmt.Println("clean drain")
case <-time.After(5 * time.Second):
	fmt.Println("drain timed out; some work was lost")
}
```

We do not block on `wg.Wait` directly; we wrap it in a goroutine that closes a channel when done, then `select` on that against a timer. This is a Go idiom you will use many times.

### Step 4 — Add a cancellation context

If the worker is doing a long operation (say, an HTTP call to a slow backend), we want a way to cancel that operation, not just signal "no more work." Enter `context`.

```go
package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"
)

func worker(ctx context.Context, jobs <-chan int, wg *sync.WaitGroup) {
	defer wg.Done()
	for {
		select {
		case <-ctx.Done():
			fmt.Println("worker cancelled")
			return
		case j, ok := <-jobs:
			if !ok {
				fmt.Println("jobs closed")
				return
			}
			select {
			case <-time.After(500 * time.Millisecond):
				fmt.Printf("processed %d\n", j)
			case <-ctx.Done():
				fmt.Printf("abandoned %d\n", j)
				return
			}
		}
	}
}

func main() {
	jobs := make(chan int, 10)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	var wg sync.WaitGroup
	wg.Add(1)
	go worker(ctx, jobs, &wg)

	go func() {
		for i := 1; ; i++ {
			select {
			case <-ctx.Done():
				close(jobs)
				return
			case jobs <- i:
				time.Sleep(80 * time.Millisecond)
			}
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	fmt.Println("draining")

	drainCtx, drainCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer drainCancel()

	done := make(chan struct{})
	go func() { wg.Wait(); close(done) }()

	select {
	case <-done:
		fmt.Println("clean drain")
	case <-drainCtx.Done():
		fmt.Println("force cancelling")
		cancel()
		<-done
	}
}
```

Look carefully at the worker. It has two `select` blocks. The outer one waits for either a job or cancellation. The inner one waits for the per-job timer or cancellation. Without the inner block, a long job would not be interruptible. This nested `select` is one of the most useful patterns in Go.

### Step 5 — Refactor into a service

The pattern above is correct but messy in `main`. Let us extract it.

```go
package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"
)

type Service struct {
	jobs chan int
	wg   sync.WaitGroup
}

func New() *Service {
	return &Service{jobs: make(chan int, 16)}
}

func (s *Service) Start(ctx context.Context, workers int) {
	for i := 0; i < workers; i++ {
		s.wg.Add(1)
		go s.run(ctx, i)
	}
}

func (s *Service) Submit(j int) bool {
	select {
	case s.jobs <- j:
		return true
	default:
		return false
	}
}

func (s *Service) Drain(ctx context.Context) error {
	close(s.jobs)
	done := make(chan struct{})
	go func() { s.wg.Wait(); close(done) }()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (s *Service) run(ctx context.Context, id int) {
	defer s.wg.Done()
	for {
		select {
		case <-ctx.Done():
			return
		case j, ok := <-s.jobs:
			if !ok {
				return
			}
			select {
			case <-time.After(200 * time.Millisecond):
				fmt.Printf("worker %d done %d\n", id, j)
			case <-ctx.Done():
				return
			}
		}
	}
}

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	svc := New()
	svc.Start(ctx, 3)

	go func() {
		for i := 1; ; i++ {
			if !svc.Submit(i) {
				time.Sleep(10 * time.Millisecond)
				continue
			}
			select {
			case <-ctx.Done():
				return
			case <-time.After(50 * time.Millisecond):
			}
		}
	}()

	<-ctx.Done()

	drainCtx, drainCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer drainCancel()
	if err := svc.Drain(drainCtx); err != nil {
		fmt.Println("drain error:", err)
	}
	fmt.Println("done")
}
```

Now `main` does only three things: derive a signal-bound context, start the service, and drain on cancellation. The service exposes `Start`, `Submit`, and `Drain`. This is roughly what production Go services look like.

### Step 6 — Track in-flight count externally

Sometimes you cannot rely on `WaitGroup` alone — for example, in an HTTP server where requests are managed by `net/http`. You can track in-flight count yourself with an atomic counter.

```go
type Tracker struct {
	inFlight atomic.Int64
	closed   atomic.Bool
}

func (t *Tracker) Enter() bool {
	if t.closed.Load() {
		return false
	}
	t.inFlight.Add(1)
	if t.closed.Load() {
		t.inFlight.Add(-1)
		return false
	}
	return true
}

func (t *Tracker) Exit() { t.inFlight.Add(-1) }

func (t *Tracker) Drain(ctx context.Context) error {
	t.closed.Store(true)
	tk := time.NewTicker(10 * time.Millisecond)
	defer tk.Stop()
	for t.inFlight.Load() > 0 {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-tk.C:
		}
	}
	return nil
}
```

The double-check inside `Enter` handles the race where `closed.Store` happens between the first `Load` and the `Add`.

### Step 7 — Verify with a test

```go
func TestServiceDrain(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	svc := New()
	svc.Start(ctx, 2)

	for i := 0; i < 10; i++ {
		svc.Submit(i)
	}

	dctx, dcancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer dcancel()
	if err := svc.Drain(dctx); err != nil {
		t.Fatalf("drain failed: %v", err)
	}
}
```

Run with `go test -race -count=10`. If anything is wrong — a missing `Done`, a missing close, a goroutine leak — `-race` will tell you. Running 10 times catches flakiness.

---

## Worked Example: A File-Processing CLI With Drain

Let us walk through a complete small program. The program reads a list of file paths from stdin, processes them concurrently, and supports Ctrl+C with a graceful drain.

```go
package main

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"
)

type Result struct {
	Path string
	N    int
	Err  error
}

func processFile(ctx context.Context, path string) Result {
	select {
	case <-ctx.Done():
		return Result{Path: path, Err: ctx.Err()}
	case <-time.After(300 * time.Millisecond):
	}
	f, err := os.Open(path)
	if err != nil {
		return Result{Path: path, Err: err}
	}
	defer f.Close()
	scanner := bufio.NewScanner(f)
	n := 0
	for scanner.Scan() {
		n++
		if ctx.Err() != nil {
			return Result{Path: path, N: n, Err: ctx.Err()}
		}
	}
	return Result{Path: path, N: n, Err: scanner.Err()}
}

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	in := make(chan string, 8)
	out := make(chan Result, 8)
	var wg sync.WaitGroup

	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for p := range in {
				select {
				case <-ctx.Done():
					out <- Result{Path: p, Err: ctx.Err()}
					return
				case out <- processFile(ctx, p):
				}
			}
		}()
	}

	go func() {
		scanner := bufio.NewScanner(os.Stdin)
		for scanner.Scan() {
			path := scanner.Text()
			select {
			case <-ctx.Done():
				close(in)
				return
			case in <- path:
			}
		}
		close(in)
	}()

	go func() {
		wg.Wait()
		close(out)
	}()

	for r := range out {
		if r.Err != nil {
			fmt.Printf("FAIL %s: %v\n", r.Path, r.Err)
		} else {
			fmt.Printf("OK   %s: %d lines\n", r.Path, r.N)
		}
	}
	fmt.Println("done")
}
```

Things to notice:

1. **`signal.NotifyContext`** turns Ctrl+C into context cancellation. We never read from a signal channel directly.
2. **The producer (`stdin` reader)** writes to `in` with a `select` against `<-ctx.Done()`. On cancellation it closes `in`.
3. **The workers** range over `in`. When `in` closes, they exit. Each worker passes `ctx` into `processFile`, so a long file is interruptible.
4. **The closer goroutine** waits on `wg` and then closes `out`. This is the safe pattern for "close output channel after all senders are done."
5. **The consumer (`main`)** ranges over `out` and prints results. When `out` is closed it exits.

If the user presses Ctrl+C halfway through, every worker sees the context cancel. The current files are abandoned (or marked with `context.Canceled`). The output channel closes; `main` prints `done` and exits cleanly.

That is a real, idiomatic, drainable Go program in about 70 lines.

---

## A Closer Look at `signal.NotifyContext`

`signal.NotifyContext`, added in Go 1.16, is the modern idiom for "convert a signal into a context cancellation." Before it existed, you had to make a signal channel, start a goroutine to read it, and call `cancel` from there. Now it is one line.

```go
ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
defer cancel()
```

Behaviour:

- The first matching signal cancels the context. Subsequent signals are ignored by the `NotifyContext` machinery but you can install your own handler for "if a second signal arrives, exit immediately."
- The `cancel` function detaches the signal handler (important: leaving it attached past the lifetime of the context means the runtime keeps a reference).
- It does not block. The signal-handling goroutine is spawned internally.

When *not* to use it: if your service needs to behave differently for `SIGINT` versus `SIGTERM`, or if you need to handle `SIGHUP` for config reload separately. In those cases, fall back to `signal.Notify` with a channel and dispatch manually.

---

## The Health-Check Dance

Almost every Kubernetes deployment has a liveness probe and a readiness probe. Drain interacts with these:

- **Liveness** says "is this pod alive enough to keep running?" During drain, liveness should stay green — you do not want Kubernetes to kill you while you are draining.
- **Readiness** says "is this pod ready for new traffic?" The moment drain begins, readiness should flip red. That tells the service mesh / load balancer to stop sending you new traffic.

In Go, that looks like:

```go
var draining atomic.Bool

http.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
})

http.HandleFunc("/ready", func(w http.ResponseWriter, r *http.Request) {
	if draining.Load() {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	w.WriteHeader(http.StatusOK)
})
```

When the signal arrives, the first thing your shutdown handler does is `draining.Store(true)`. Then it sleeps for one or two readiness intervals so the LB has time to notice. Then it triggers the actual drain.

```go
<-ctx.Done()
draining.Store(true)
time.Sleep(2 * time.Second) // let readiness propagate
_ = server.Drain(drainCtx)
```

This is a small detail with a big impact: skipping the sleep means 5xx errors during every deploy.

---

## When Drain Is Not Enough

A drain handles "the process is going away." It does not handle:

- **Connection draining at L4.** A TCP connection that is keep-alived may carry traffic for a long time. The LB must close it; the application cannot.
- **Database failover.** The database client must be drainable separately.
- **Long-lived WebSockets.** A drain typically does not yank an active WebSocket; you must send a close frame and let the client reconnect to a different pod.
- **Pending writes to caches.** A write-behind cache may have buffered updates the drain does not know about.

The drain pattern is the *first* line of clean shutdown. For complex systems you also need orchestration-level patterns: pre-stop hooks, longer grace periods, two-phase quiesce.

---

## Things That Look Like Drain But Are Not

- **`http.Server.Close`** — closes connections *immediately*, not gracefully. It is a hard stop. Use `Shutdown`, not `Close`.
- **`cancel()` alone** — cancels the context but does not wait. You still need a `Wait` somewhere.
- **`time.Sleep(30 * time.Second)`** — adding a sleep before exit does not drain. It just delays the hard stop.
- **`runtime.GC()` before exit** — runs the garbage collector, which has nothing to do with drain.

Each of these has its uses, but none of them is drain. If you see one of them in a "graceful shutdown" PR, ask questions.

---

## A Note on Panics During Drain

If a worker panics during the drain, the deferred `wg.Done` runs (good), but the panic still propagates and crashes the program (bad). Wrap your worker bodies in `recover`:

```go
func (s *Service) safeRun(ctx context.Context) {
	defer s.wg.Done()
	defer func() {
		if r := recover(); r != nil {
			log.Printf("worker panic: %v", r)
		}
	}()
	// ...
}
```

This is sometimes called the "panic firewall." It is especially important during drain, when you absolutely do not want a single bad message to kill the whole orderly shutdown.

---

## Drain in Long-Polling APIs

A long-polling endpoint holds a request open for, say, 30 seconds. If your drain deadline is 25 seconds, the handler will be force-cancelled. To stay graceful:

```go
func longPoll(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	// Either an event arrives, or the context is cancelled.
	select {
	case event := <-eventCh:
		json.NewEncoder(w).Encode(event)
	case <-ctx.Done():
		w.WriteHeader(http.StatusNoContent) // tell client to retry
	}
}
```

`r.Context()` is cancelled by `Server.Shutdown` when its drain deadline expires. The handler should respond with something the client can recover from (204 No Content, 503, or a structured "please retry" body).

---

## Drain Order Within One Process

For a typical service with HTTP, a worker pool, and a Kafka producer, the drain order is:

1. Mark readiness unhealthy.
2. Sleep for the readiness propagation window.
3. Stop the HTTP server (drains in-flight HTTP).
4. Close the worker pool intake; wait for workers.
5. Flush the Kafka producer.
6. Close the database.
7. Exit zero.

If you flip steps 4 and 5, you may flush events that workers were still going to emit. If you flip 5 and 6, you might lose Kafka messages because the producer cannot reach the broker after the DB-backed offset store closes.

This order is service-specific but the principle is universal: **drain from the entry point inward to the persistence layer.** Customers come in via HTTP; their state lands in the database. Drain in that direction.

---

## More Coding Examples

### A queue consumer with drain

```go
package main

import (
	"context"
	"fmt"
	"sync"
	"time"
)

type Message struct {
	ID   int
	Body string
}

type Consumer struct {
	in chan Message
	wg sync.WaitGroup
}

func NewConsumer(buf int) *Consumer {
	return &Consumer{in: make(chan Message, buf)}
}

func (c *Consumer) Start(ctx context.Context, workers int) {
	for i := 0; i < workers; i++ {
		c.wg.Add(1)
		go c.run(ctx, i)
	}
}

func (c *Consumer) Submit(ctx context.Context, m Message) error {
	select {
	case c.in <- m:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (c *Consumer) Drain(ctx context.Context) error {
	close(c.in)
	done := make(chan struct{})
	go func() { c.wg.Wait(); close(done) }()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (c *Consumer) run(ctx context.Context, id int) {
	defer c.wg.Done()
	for {
		select {
		case <-ctx.Done():
			return
		case m, ok := <-c.in:
			if !ok {
				return
			}
			c.handle(ctx, id, m)
		}
	}
}

func (c *Consumer) handle(ctx context.Context, id int, m Message) {
	select {
	case <-time.After(150 * time.Millisecond):
		fmt.Printf("[%d] %d -> %s\n", id, m.ID, m.Body)
	case <-ctx.Done():
		fmt.Printf("[%d] cancelled %d\n", id, m.ID)
	}
}
```

This is a re-usable pattern. `Consumer` has the four methods every drainable thing should have: `Start`, `Submit`, `Drain`, and an internal `run` per worker. You can wire it into a `main` with `signal.NotifyContext` and have a complete service in under 50 lines of glue code.

### Drain with a single-shot `sync.Once`

If your drain can be triggered from more than one place (signal handler, internal error, parent context), you want exactly-once semantics:

```go
type Server struct {
	once   sync.Once
	onDrain func()
}

func (s *Server) StartDrain() {
	s.once.Do(s.onDrain)
}
```

Calling `StartDrain` twice runs the drain logic exactly once. This prevents double-close panics.

### Producer that respects backpressure during drain

A producer should not keep pushing work into a channel that is closing.

```go
func producer(ctx context.Context, out chan<- int) {
	for i := 0; ; i++ {
		select {
		case <-ctx.Done():
			return
		case out <- i:
		}
	}
}
```

The `select` ensures the producer notices cancellation even when the channel is full. Without the `select`, a slow consumer plus a cancellation would leave the producer blocked indefinitely on the send.

---

## Walking Through a Failure

Let us look at a real bug. The code below has the right shape but a subtle defect.

```go
func (s *Service) Drain() {
	close(s.in)
	s.wg.Wait()
}

func (s *Service) Submit(j int) {
	s.in <- j
}
```

Question: what is wrong?

Answer: `Submit` does not check whether `s.in` is closed. If `Drain` runs while another goroutine is calling `Submit`, that `Submit` panics with `send on closed channel`. The fix is to gate `Submit` with a flag or to coordinate close with a sync primitive that callers can see.

```go
type Service struct {
	in     chan int
	closed atomic.Bool
	mu     sync.Mutex
	wg     sync.WaitGroup
}

func (s *Service) Submit(j int) error {
	if s.closed.Load() {
		return errors.New("draining")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed.Load() {
		return errors.New("draining")
	}
	s.in <- j
	return nil
}

func (s *Service) Drain() {
	s.mu.Lock()
	s.closed.Store(true)
	close(s.in)
	s.mu.Unlock()
	s.wg.Wait()
}
```

The combination of an atomic for the fast path and a mutex for the close is the standard "publish then close" pattern. The atomic check is cheap on the hot path; the mutex ensures the close cannot interleave with a send.

---

## Putting It All Together

A complete production-quality "smallest drainable service" template:

```go
package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
)

type Service struct {
	in        chan int
	wg        sync.WaitGroup
	closed    atomic.Bool
	mu        sync.Mutex
	draining  atomic.Bool
}

func New(buf int) *Service { return &Service{in: make(chan int, buf)} }

func (s *Service) Start(ctx context.Context, n int) {
	for i := 0; i < n; i++ {
		s.wg.Add(1)
		go s.run(ctx, i)
	}
}

func (s *Service) Submit(j int) error {
	if s.closed.Load() {
		return errors.New("closed")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed.Load() {
		return errors.New("closed")
	}
	s.in <- j
	return nil
}

func (s *Service) Drain(ctx context.Context) error {
	s.draining.Store(true)
	s.mu.Lock()
	s.closed.Store(true)
	close(s.in)
	s.mu.Unlock()

	done := make(chan struct{})
	go func() { s.wg.Wait(); close(done) }()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (s *Service) IsDraining() bool { return s.draining.Load() }

func (s *Service) run(ctx context.Context, id int) {
	defer s.wg.Done()
	for {
		select {
		case <-ctx.Done():
			return
		case j, ok := <-s.in:
			if !ok {
				return
			}
			fmt.Printf("[%d] %d\n", id, j)
			time.Sleep(100 * time.Millisecond)
		}
	}
}

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	svc := New(64)
	svc.Start(ctx, 4)

	mux := http.NewServeMux()
	mux.HandleFunc("/ready", func(w http.ResponseWriter, r *http.Request) {
		if svc.IsDraining() {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
	})
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	srv := &http.Server{Addr: ":8080", Handler: mux}
	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			fmt.Println("http:", err)
		}
	}()

	go func() {
		for i := 0; ; i++ {
			if err := svc.Submit(i); err != nil {
				return
			}
			time.Sleep(50 * time.Millisecond)
		}
	}()

	<-ctx.Done()
	fmt.Println("draining")

	time.Sleep(2 * time.Second) // readiness propagation

	drainCtx, drainCancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer drainCancel()

	if err := svc.Drain(drainCtx); err != nil {
		fmt.Println("svc drain:", err)
	}
	if err := srv.Shutdown(drainCtx); err != nil {
		fmt.Println("http drain:", err)
	}
	fmt.Println("exit")
}
```

This is a useful template. It has the readiness flip, the propagation sleep, the service drain, the HTTP drain, and a bounded deadline. Copy it, modify it, ship it. The middle and senior pages will expand on every piece — for now, you have the smallest version of every idea.

---

## More Edge Cases to Know

### A second `SIGTERM` during drain

A standard practice is: the first signal triggers graceful drain; the second signal triggers immediate exit. Implementation:

```go
stop := make(chan os.Signal, 1)
signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
<-stop
go func() {
	<-stop
	os.Exit(1)
}()
// drain ...
```

### Drain when there is nothing to drain

If your service is idle when the signal arrives, drain should complete almost instantly. Verify that your drain code returns immediately on an empty system — a `for inFlight > 0` loop with a 100ms tick will still take 100ms even when in-flight is already zero. A pre-check saves the wait.

### Drain across forked subprocesses

If your service spawns child processes, you need to forward `SIGTERM`. Children do not automatically see the signal unless you pass it along.

### Drain with a buffered intake of zero

An unbuffered channel blocks the producer on every send. During drain that is actually convenient: the producer naturally stops when no worker is available to receive.

---

## A Worked Mental Exercise

Imagine a service handling 1000 requests per second. Each request takes a median of 50 ms and a P99 of 2 seconds. You set a drain deadline of 5 seconds.

- At the moment of `SIGTERM`, there are about 50 in-flight requests (1000 × 0.05s).
- Within 50 ms, the median half is done.
- Within 2 seconds, the P99 is done.
- Within 5 seconds, all requests should be done with margin.

So 5 seconds is a comfortable budget. But: 1000 × 0.05 only holds if the LB stops sending traffic immediately. If readiness propagation takes 5 seconds, you keep accepting new traffic *during* drain. That can blow past your deadline.

The lesson: drain budget must include time for traffic to actually stop arriving. Flip readiness first, sleep, then drain.

---

## Closing Thoughts

The drain pattern is short to explain and easy to get nearly right. It is the small details — the readiness flip, the propagation sleep, the deadline that bounds the wait, the atomic-plus-mutex pattern that guards the close — that separate a service that drains and a service that *says* it drains. Read this file twice. Write the file-processing CLI from scratch with no copy-paste. Then move on to the middle page, where we go from one service to many.

---

## Appendix A: Frequently Asked Beginner Questions

### Why not just call `runtime.Goexit()` to stop a goroutine?

`runtime.Goexit()` stops the current goroutine, running its deferred calls. It is symmetric to `os.Exit` but only for one goroutine. It does not coordinate with other goroutines and does not signal anyone. Drain is about coordination — `Goexit` does not help.

### Can I drain by setting a global flag and having workers check it?

You can, and many people do, but checking a flag in a tight loop adds a load on every iteration. A `<-ctx.Done()` channel inside a `select` is just as cheap and integrates naturally with timeouts. Prefer the context.

### Should every channel be closed during drain?

Only channels you own. The rule of thumb: the goroutine that creates a channel is responsible for closing it (if it should be closed at all). For receive-only channels (you do not own the close), drain by watching the context.

### What about `os.Exit(0)` after drain?

In a `main` function, simply returning is enough — Go exits 0. Calling `os.Exit(0)` skips deferred functions in `main`. If you have deferred logger flushes, prefer `return`.

### How long should the drain deadline be?

Slightly less than the orchestrator's grace period. Kubernetes defaults to 30 seconds, so 25 seconds is a good drain budget — leaving 5 seconds for resource close and process exit. If your handlers' P99 latency is over 25 seconds, raise the grace period in the pod spec.

### Why do my tests pass but drain leaks in production?

Production traffic patterns differ. Tests usually have a small, finite job set. Production may have constant new work arriving for several seconds after `SIGTERM` (LB lag). Test with synthetic traffic and ramp it during drain.

### Is `select { case <-ctx.Done(): default: }` a good way to check for cancellation?

It works but is a hint, not a guarantee. If the work between checks is long, you can miss the cancellation. Prefer `select` cases that block — the goroutine will be woken when either side fires.

---

## Appendix B: A Hand-Run Through The Drain

Suppose your service has these goroutines at the moment `SIGTERM` arrives:

- `g1` — HTTP listener accepting connections
- `g2..g6` — five HTTP request handlers in flight
- `g7..g10` — four background workers processing the job channel
- `g11` — Kafka producer flushing every second
- `g12` — metrics writer

Step-by-step:

1. `signal.NotifyContext`'s internal goroutine receives `SIGTERM`. It cancels the root context.
2. `main` unblocks on `<-ctx.Done()`.
3. `main` calls `svc.SetDraining(true)`. Readiness flips to 503.
4. `main` sleeps 2 seconds. During this time the LB notices and stops sending new traffic.
5. `main` calls `srv.Shutdown(drainCtx)`. The listener closes (so `g1` exits after its loop iteration). Active handlers `g2..g6` keep running.
6. As `g2..g6` finish their responses, they return. `Shutdown` notices the active counter reach zero and returns nil.
7. `main` calls `svc.Drain(drainCtx)`. The job channel is closed. `g7..g10` finish whatever they are holding and exit when the channel drains.
8. `main` calls `kafka.Flush(drainCtx)`. `g11` flushes the producer's buffer.
9. `main` calls `db.Close()`. Pooled connections shut down.
10. `main` returns from main. Go runtime exits with code 0.

Total elapsed: a few hundred ms in the happy path. Up to 25 seconds in the worst case (drain deadline). The 5-second pad inside Kubernetes' 30-second grace period gives us room to be late.

---

## Appendix C: A Glossary of Related Terms

| Term | Meaning |
|------|---------|
| **Lameduck mode** | Old SRE term for "I am no longer accepting new work but still finishing what I have." Synonym for drain. |
| **Cordoning** | Kubernetes' term for marking a node unschedulable. Equivalent to setting a pod to "draining." |
| **Connection draining** | Layer 4 LB feature: existing TCP connections continue, new connections are not opened. |
| **Drain timeout** | The deadline on the drain wait. |
| **Soft stop** | Synonym for graceful drain. |
| **Hard stop** | Synonym for `SIGKILL` / `os.Exit`. |
| **Quiet period** | The idle time after intake stops, before declaring drained. Used in idle-wait drains. |
| **Readiness gate** | Kubernetes feature to add custom readiness conditions; can be flipped during drain. |
| **Preempt** | To force a goroutine to stop. Drain prefers cooperative cancel, not preempt. |
| **Reconciliation** | In Kafka/control-plane systems, the act of re-aligning state. Drains happen during reconciliation. |
| **Throttling** | Limiting intake rate. A drain is a throttle that goes to zero. |
| **Backpressure** | Telling upstream to slow down. Drain is the most extreme form of backpressure. |

---

## Appendix D: A 50-Line Reference Card

```go
package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"
)

type Worker struct {
	in chan int
	wg sync.WaitGroup
}

func NewWorker(buf int) *Worker { return &Worker{in: make(chan int, buf)} }

func (w *Worker) Start(ctx context.Context, n int) {
	for i := 0; i < n; i++ {
		w.wg.Add(1)
		go func() {
			defer w.wg.Done()
			for {
				select {
				case <-ctx.Done():
					return
				case j, ok := <-w.in:
					if !ok {
						return
					}
					_ = j // do work
				}
			}
		}()
	}
}

func (w *Worker) Drain(ctx context.Context) error {
	close(w.in)
	done := make(chan struct{})
	go func() { w.wg.Wait(); close(done) }()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	w := NewWorker(16)
	w.Start(ctx, 4)
	<-ctx.Done()
	dctx, dcancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer dcancel()
	if err := w.Drain(dctx); err != nil {
		fmt.Println("drain:", err)
	}
}
```

Print this. Tape it to a wall. Every drainable Go service is a variation of those 50 lines.

---

## Final Checklist Before You Move On

You should leave this page able to:

- Articulate the three steps of drain in 30 seconds.
- Write a drainable worker pool from memory.
- Wire `signal.NotifyContext` into `main`.
- Bound any wait with `context.WithTimeout`.
- Flip a readiness flag before stopping the listener.
- Explain why a 1-second drain on a 2-second handler is a bug.
- Recognise the "send on closed channel" panic and know how to avoid it.

If any of these still feel shaky, write a small program that demonstrates the concept and run it under `go test -race`. The patterns become muscle memory after three or four iterations.

---

## Appendix E: Drain Vocabulary in Other Stacks

Reading code from other ecosystems sharpens your sense of drain in Go. A short tour:

- **Java** — `ExecutorService.shutdown()` is "stop accepting new tasks; finish queued ones." `shutdownNow()` is the force-cancel. `awaitTermination(timeout, unit)` is the bounded wait. These map almost one-to-one to close-channel, cancel-context, and wait-with-deadline.
- **Node.js** — `server.close(cb)` stops accepting new connections; the callback fires when existing ones close. There is no native "in-flight worker" concept because Node is single-threaded, but worker threads have a `terminate()` analogous to force-cancel.
- **Erlang/OTP** — Supervisors have `shutdown` strategies: `brutal_kill` (hard stop), an integer ms (graceful with deadline), or `infinity` (unbounded wait). Erlang made drain a first-class supervisor decision decades before it became fashionable.
- **Akka** — `CoordinatedShutdown` runs registered tasks in phases, each with its own deadline. Each phase is essentially a drain step.
- **Kubernetes** — `preStop` hook + `terminationGracePeriodSeconds`. The container's `preStop` is your readiness flip and propagation sleep; the grace period is your drain deadline.

Cross-stack vocabulary helps when reading post-mortems written by other teams. "We lost messages because our `shutdownNow` was too eager" is a sentence whose meaning you should recognise instantly.

---

## Appendix F: A Reading Plan

If you finish this page and want to keep going at the junior level (before moving to middle), read in this order:

1. The Go blog post on `context` (especially the section on cancellation).
2. The `net/http` documentation for `Server.Shutdown` and `Server.RegisterOnShutdown`.
3. The `os/signal` package documentation, focusing on `NotifyContext`.
4. The `sync` package, especially `WaitGroup` and `Once`.

Allocate one evening per item. Run every example in the docs. Modify them. Break them on purpose to see the error messages.

---

## Appendix G: A Mini Q&A With An Imaginary Reviewer

**Reviewer:** "I see you close the channel inside `Drain`. What if `Submit` is called concurrently?"

**You:** "Yes, that is the race I mentioned. I use a mutex around the close and a flag check in `Submit`. The flag is atomic to keep the hot path cheap. The mutex is acquired only on close, not on every send."

**Reviewer:** "Why bother with the atomic at all if you have the mutex?"

**You:** "Two reasons. First, the atomic lets `Submit` reject quickly without acquiring the lock — useful under load. Second, after close I want `IsDraining` to be observable from monitoring code without contending on the mutex."

**Reviewer:** "Why a buffered signal channel?"

**You:** "Because `signal.Notify` is non-blocking. If the signal arrives before `<-stop` is reached and the channel is unbuffered, the runtime drops the signal. A buffer of one is enough."

**Reviewer:** "Why a separate `drainCtx` instead of using the cancelled root context?"

**You:** "The root context is already cancelled when we enter drain — so `<-rootCtx.Done()` returns immediately, which gives us zero time. The drain needs its own deadline."

**Reviewer:** "Is `time.Sleep(2 * time.Second)` for readiness propagation magic?"

**You:** "It is configuration. The 2 seconds is roughly two readiness-probe intervals. If our probes run every 1 second, two of them is enough for the LB to mark us out of rotation. We could make this configurable per environment."

---

## Appendix H: A Final Worked Example — Drain a Counter Service

Let us close with a complete, runnable mini-service that increments a counter on each HTTP request and drains on `SIGTERM`. It demonstrates every concept on this page.

```go
package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
)

type Counters struct {
	mu     sync.Mutex
	values map[string]int64
}

func NewCounters() *Counters { return &Counters{values: make(map[string]int64)} }

func (c *Counters) Inc(name string, delta int64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.values[name] += delta
}

func (c *Counters) Snapshot() map[string]int64 {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := make(map[string]int64, len(c.values))
	for k, v := range c.values {
		out[k] = v
	}
	return out
}

type App struct {
	counters  *Counters
	draining  atomic.Bool
	inflight  sync.WaitGroup
}

func NewApp() *App { return &App{counters: NewCounters()} }

func (a *App) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", a.health)
	mux.HandleFunc("/ready", a.ready)
	mux.HandleFunc("/inc", a.inc)
	mux.HandleFunc("/snap", a.snap)
	return a.middleware(mux)
}

func (a *App) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if a.draining.Load() && r.URL.Path != "/healthz" && r.URL.Path != "/ready" {
			http.Error(w, "draining", http.StatusServiceUnavailable)
			return
		}
		a.inflight.Add(1)
		defer a.inflight.Done()
		next.ServeHTTP(w, r)
	})
}

func (a *App) health(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
}

func (a *App) ready(w http.ResponseWriter, r *http.Request) {
	if a.draining.Load() {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	w.WriteHeader(http.StatusOK)
}

func (a *App) inc(w http.ResponseWriter, r *http.Request) {
	name := r.URL.Query().Get("name")
	if name == "" {
		http.Error(w, "name required", http.StatusBadRequest)
		return
	}
	time.Sleep(200 * time.Millisecond) // simulate slow work
	a.counters.Inc(name, 1)
	fmt.Fprintln(w, "ok")
}

func (a *App) snap(w http.ResponseWriter, r *http.Request) {
	snap := a.counters.Snapshot()
	for k, v := range snap {
		fmt.Fprintf(w, "%s=%d\n", k, v)
	}
}

func (a *App) StartDrain() { a.draining.Store(true) }

func (a *App) WaitInFlight(ctx context.Context) error {
	done := make(chan struct{})
	go func() { a.inflight.Wait(); close(done) }()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	app := NewApp()
	srv := &http.Server{
		Addr:    ":8080",
		Handler: app.Routes(),
	}

	go func() {
		log.Println("listening on :8080")
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("listen: %v", err)
		}
	}()

	<-ctx.Done()
	log.Println("signal received, beginning drain")

	app.StartDrain()
	time.Sleep(2 * time.Second)

	drainCtx, drainCancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer drainCancel()

	if err := app.WaitInFlight(drainCtx); err != nil {
		log.Printf("in-flight wait: %v", err)
	}

	if err := srv.Shutdown(drainCtx); err != nil {
		log.Printf("server shutdown: %v", err)
	}

	log.Println("clean exit")
}
```

Walk through this with a partner if you can. Every function maps to a paragraph above. The `middleware` flips 503 once `draining` is true (so `inc` and `snap` are refused but the health endpoints still work). The `inflight` wait group bounds the drain. The 2-second sleep is the readiness propagation pad. The 25-second deadline is the drain budget.

You can copy this file into any project and adapt it. It is intentionally small, but it is *not* a toy — it embodies all the practical bits a junior developer needs to ship a drainable Go service in production.

---

## Appendix I: An Anti-Example

For completeness, here is what a junior developer often writes first:

```go
func main() {
	go server()
	go worker()
	select{} // block forever
}
```

Why is this bad?

- `select{}` blocks but does not catch signals — the OS still kills the process.
- No way to drain `server` or `worker`.
- No way to surface errors.
- No way to exit cleanly from a test.

The fix is the template from earlier in this file. Build a habit of always starting with `signal.NotifyContext` and a `Drain` method. Even toy scripts benefit.

---

## Appendix J: Drain in Tests vs Production

In tests:

- The drain context is short (50ms–500ms).
- The signal is simulated by calling `cancel()` directly.
- You assert that the drain completes within the deadline.

In production:

- The drain context is long (25 seconds default).
- The signal is real (`SIGTERM` from the orchestrator).
- You measure the actual drain duration and alert when it approaches the deadline.

Both code paths should use the same `Drain(ctx)` method. The only difference is who calls it and with what context. This is one of the reasons we always parameterise drain by `context.Context` rather than hard-coding the timeout.

---

## Appendix K: Drain and `defer`

A common junior question: "Will my `defer`s run if I get `SIGTERM`?"

Answer: **only if you handle the signal yourself.** Without `signal.Notify`, the runtime is killed mid-step, and no `defer`s in any goroutine run. With `signal.Notify` (or `signal.NotifyContext`), control returns to your `main` function, and `defer`s in `main` and in any goroutine that exits normally as part of the drain will run.

This is why **every** production binary needs `signal.NotifyContext`. The cost is two lines; the benefit is your `defer` statements actually doing their job.

---

## Appendix L: Common Mistakes Walkthrough

Let us walk through a few buggy snippets and fix them.

**Buggy:**

```go
go func() {
	for j := range in {
		do(j)
	}
}()
// later:
close(in)
os.Exit(0)
```

Bug: `os.Exit(0)` does not wait. The goroutine is killed mid-`do(j)`. Fix: use a `WaitGroup` and `Wait` before returning from `main`.

**Buggy:**

```go
ctx, cancel := context.WithTimeout(parent, 5*time.Second)
defer cancel()
go work(ctx)
return
```

Bug: `defer cancel()` cancels the context as soon as the caller returns — before `work` has a chance to do anything. Fix: do not defer cancel if the goroutine outlives the function, OR wait for the goroutine.

**Buggy:**

```go
go func() {
	<-stop
	cancel()
	os.Exit(0)
}()
```

Bug: `os.Exit(0)` immediately after `cancel()` does not give anyone time to react. Fix: wait for in-flight to drain before exit.

**Buggy:**

```go
func (s *Service) Drain() {
	close(s.in)
	for s.inflight > 0 {
		// spin
	}
}
```

Bug: busy-wait pegs a CPU at 100%. Fix: sleep between checks, or use a `WaitGroup`.

**Buggy:**

```go
for {
	msg := <-ch
	go handle(msg)
}
```

Bug: spawns unbounded goroutines; cannot be drained. Fix: use a fixed pool of workers reading from `ch`.

---

## Appendix M: Mental Picture for the Pattern

Picture three concentric rings.

- **Outer ring** — the orchestrator (Kubernetes, systemd). It owns the grace period.
- **Middle ring** — your `main` function and signal handler. It owns the drain deadline.
- **Inner ring** — your services and workers. They own their `Drain` methods.

Time flows from outside in: signal arrives at the outer ring, propagates through main, then commands the inner ring to stop. Resources close from inside out: workers exit, then connections close, then main returns, then the process dies.

If a worker is hung, the inner ring fails to honour its deadline. The middle ring's deadline forces it. If even that fails, the outer ring's grace period expires and `SIGKILL` is sent. Each ring is a safety net for the one inside it.

Understanding this picture is the difference between writing drain code by rote and designing drain into a system.

---

## Appendix N: Practice Exercises Recap

You will see these again on the [tasks.md](tasks.md) page in more detail. As warmup:

1. Write a worker that prints "hello" every second and drains on Ctrl+C.
2. Modify the worker to drain in at most 3 seconds.
3. Add an HTTP `/ready` endpoint that flips to 503 during drain.
4. Add a `WaitGroup` so the program does not exit until the worker has logged "exit."
5. Simulate a hung worker (`time.Sleep(1 * time.Hour)`) and confirm the deadline forces exit.

Spend 10 minutes per exercise. The total cost is one hour, and at the end you can write drain code without thinking.

---

## Appendix O: Where to Look for Drain Bugs in Existing Code

If you inherit a Go service and want to audit its drain behaviour, look at:

1. **`main.go`** — does it use `signal.NotifyContext` or `signal.Notify`?
2. **`Server.Shutdown`** — is it called? Is the context bounded?
3. **Worker types** — do they have a `Drain` or `Stop` method?
4. **`WaitGroup` usage** — is every `Add` matched with a `Done` (defer)?
5. **`os.Exit`** — anywhere outside of `main` is suspect.
6. **Goroutine spawns** — does each one have an exit path?
7. **Health endpoints** — do they reflect drain state?

A 30-minute audit on these seven points usually reveals at least one issue in a service that has not been intentionally drained.

---

## Appendix P: One Last Reminder

Drain is the difference between "we deploy at midnight to be safe" and "we deploy whenever." Every team that ships often invests in drain. Every team that does not, lives with deploy fear. This pattern is one of the highest leverage things you can learn in your first year of Go. Master it now; spend the rest of your career not paging anyone on deploy day.

---

## Appendix Q: Drain Patterns in The Wild — A Mini Tour

Even at the junior level, it helps to peek at how real projects implement drain. Below is a curated list (read these slowly, do not memorise):

- **`net/http`** — `Server.Shutdown` in `net/http/server.go`. Notice the `srv.inShutdown` atomic, the `closeIdleConns` loop, and the `time.Ticker` polling for active connections.
- **`grpc-go`** — `Server.GracefulStop`. Similar idea: refuse new RPCs, wait for in-flight ones to finish, then close transports.
- **`segmentio/kafka-go`** — `Reader.Close` flushes uncommitted offsets and shuts down the fetcher.
- **`nats.io/nats.go`** — `Conn.Drain()` is literally named after this pattern. It stops subscribers, waits for the message buffer to empty, then closes the connection.

Each library uses the same recipe: a "draining" flag, a wait, and a deadline. Spotting this recipe in foreign code base is a skill — it confirms you understand the pattern at the level the library authors do.

---

## Appendix R: Pitfalls When Combining Drain With Other Patterns

### Drain + Retry

If a worker retries on failure with exponential backoff, a single retry may exceed the drain deadline. Solutions:

- Pass the drain context into the retry loop; abort retries when context is cancelled.
- Lower the retry ceiling during drain.

### Drain + Circuit Breaker

A breaker that opens during drain may interfere with the final flush of buffered work. Either bypass the breaker for drain-only operations or accept that some work will not flush.

### Drain + Caching

A write-behind cache holds dirty entries. Drain must flush them. Wire `cache.Flush(ctx)` into your drain sequence after the in-flight wait.

### Drain + Goroutine Pools

Pools with their own queues need their own `Drain`. The pool's `Drain` closes its task channel and waits for its workers; the parent service's drain calls the pool's drain.

### Drain + WebSockets

Long-lived WebSocket goroutines do not drain quickly. Send a close frame ("server is going away") and let the client reconnect. Do not block drain waiting for socket goodbye round-trips.

### Drain + Timers

If a goroutine is blocked on `time.Sleep(time.Hour)`, it will not wake during drain. Replace `time.Sleep` with a `select` on `<-ctx.Done()` and a timer.

```go
// bad
time.Sleep(time.Hour)

// good
select {
case <-time.After(time.Hour):
case <-ctx.Done():
	return
}
```

### Drain + Connection Pools

Database pool `Close` (e.g. `*sql.DB.Close`) waits for in-use connections to be returned. If your goroutines have not released their connections, the pool will block indefinitely. Drain workers first, then close the pool.

---

## Appendix S: A Concept Map

```text
                     ┌────────────────────┐
                     │   Signal Handling   │
                     └──────────┬─────────┘
                                │ triggers
                                ▼
                     ┌────────────────────┐
                     │   Drain Pattern     │
                     └─────┬──────┬───────┘
                           │      │
            uses           │      │      coordinates
            ▼              │      │              ▼
    ┌──────────────┐       │      │     ┌──────────────┐
    │   Context    │       │      │     │ WaitGroup    │
    └──────────────┘       │      │     └──────────────┘
                           │      │
                  guards   │      │   times
                           ▼      ▼
                     ┌────────────────────┐
                     │   Deadline (Timer)  │
                     └────────────────────┘
```

Drain sits at the centre, pulling on context cancellation, wait groups, and deadlines. The signal handler is the trigger. Everything else is plumbing.

---

## Appendix T: A Personal Practice Plan

If you are new to Go and reading this, here is a one-week plan to internalise the drain pattern:

- **Day 1.** Read this entire file. Do exercises 1–3 from Appendix N.
- **Day 2.** Write the file-processing CLI from scratch without looking at the example. Run it with `-race`.
- **Day 3.** Add an HTTP server to the CLI. Wire `/ready` and `/healthz` correctly. Drain on signal.
- **Day 4.** Add a Kafka-like in-process queue. Drain it as part of shutdown.
- **Day 5.** Audit an existing service (your own or open-source). Find one drain bug.
- **Day 6.** Read [middle.md](middle.md). Note any concept that surprises you.
- **Day 7.** Practice. Pair-program drain code with a friend. Explain it out loud.

A week of focused practice puts drain firmly in your tool belt. You will pull it out so often it becomes invisible.

---

## Appendix U: Three Drain Code Smells to Watch For

1. **A `Stop()` method without a deadline parameter.** Means the caller cannot bound the wait. Add `Stop(ctx context.Context) error`.
2. **A goroutine started inside a constructor.** The lifetime is now hidden. Prefer explicit `Start(ctx)` so callers manage drain.
3. **A `for { ... }` loop without a `<-ctx.Done()` case.** No exit path. The most common goroutine leak source.

If a code review catches any of these, push back: "this looks like it cannot drain. How do we stop it?"

---

## Appendix V: Drain and Logging

During drain, log every transition:

```go
log.Println("drain: started")
log.Println("drain: readiness=503")
log.Println("drain: server.Shutdown")
log.Printf("drain: complete in %s", time.Since(start))
```

These four lines are sometimes the only evidence you have when investigating a slow deploy. Make them structured (`slog` or `zap`) so they are searchable.

Do not log per-task during drain — you will drown in noise. Log totals and durations.

---

## Appendix W: Drain and Metrics

Three metrics, every drainable service should emit:

- `drain_duration_seconds` (histogram) — how long the drain took.
- `drain_inflight_at_start` (gauge) — number of in-flight tasks when drain began.
- `drain_force_cancelled_total` (counter) — number of tasks abandoned at deadline.

Alert on `drain_force_cancelled_total > 0` over a deploy. A single missed task is a data integrity event worth investigating.

---

## Appendix X: A Long-Form Story

Picture a team three months into running their first Go service in production. They are deploying weekly. Each deploy, a few customers complain about strange errors — orders that "went through" but never arrived in the warehouse system. The engineers blame the orchestrator, then the network, then the database.

Eventually, a senior engineer pulls up the deploy logs and notices the service exits 200ms after `SIGTERM`. "That cannot be right," she says. "Our handler P99 is 800ms." They look at `main.go`. There is no `Shutdown`, no `WaitGroup`, no signal handling. A handler in flight at deploy time is interrupted in the middle of writing to Kafka but after writing to the database. The next pod picks up the request via retry — but it has already been processed once, so it is rejected as a duplicate. The customer's order sits in the database with no downstream notification.

They add the drain template from this page. The complaints stop. Next quarter, they deploy thirty-eight times. Nobody pages anyone.

That story has played out at every company that ships Go in production. You can either learn the drain pattern now and skip the story, or live it and learn it the hard way. Reading this far means you are choosing the first option. Use the templates. Adapt them. Ship.

---

## Appendix Y: Going Backwards — When To Remove Drain

Drain code is not free. It adds latency to shutdown and complexity to `main`. For some services, the cost is not worth it:

- **Pure read replicas.** A read-only proxy with no state and idempotent retries can hard-stop without harm.
- **Stateless transformations.** A pipeline stage that just reformats data and forwards it — losing a single in-flight item is fine if upstream retries.
- **Ephemeral workers.** A short-lived job runner that finishes its task and exits — drain is unnecessary.

Even for these, signal handling is still useful: log the shutdown, emit a final metric. Just skip the wait-for-in-flight step.

The mature view: drain is a tool, not a religion. Apply it where it pays.

---

## Appendix Z: Closing Words

You now have, in one file, the entire junior-level mental model of drain in Go. You have read about its three steps, its deadline, its signals, its order, its interactions with health checks, its pitfalls, and its idiomatic Go implementations. You have seen complete runnable examples.

Continue with [middle.md](middle.md) when you can write the drain template from memory and you understand every line of the long worked example in Appendix H. There is no shame in spending a week here. The pattern returns dividends for years.

---

## Appendix AA: A Final Detailed Walkthrough

Let us trace what actually happens, instruction by instruction, when our reference template receives `SIGTERM`. This level of detail will help you debug a drain that goes wrong.

The kernel delivers `SIGTERM` to the process. The Go runtime's signal-handling thread (configured by `signal.Notify` internally) writes the signal value into the channel registered with `signal.NotifyContext`. Inside that helper, a goroutine reads the signal and calls the cancel function of the context. The cancel function flips an atomic, closes the `Done` channel, and wakes anyone selecting on `<-ctx.Done()`.

Our `main` was blocked on `<-ctx.Done()`. It unblocks and proceeds to `app.StartDrain()`. `StartDrain` does `draining.Store(true)`. From this point on, any HTTP request entering the middleware sees the flag, returns 503, and exits without touching downstream work.

`main` then calls `time.Sleep(2 * time.Second)`. During this time, requests arriving from connections that the LB has not yet closed are refused at the middleware. The LB sees the 503 on `/ready` (probably within 1 second) and removes the pod from rotation.

`main` then creates `drainCtx` with a 25-second deadline. This is the wall-clock budget for everything that follows.

`main` calls `app.WaitInFlight(drainCtx)`. Inside, we start a goroutine that calls `app.inflight.Wait()` and closes a `done` channel when it returns. The main goroutine `select`s on `done` and `drainCtx.Done()`.

Suppose at this moment there are 3 in-flight handlers. Each is in the middle of a `time.Sleep(200 * time.Millisecond)` call simulating slow work. As each finishes, it returns from the handler, the deferred `inflight.Done()` runs, and the wait-group counter drops by one. When the counter hits zero, `inflight.Wait` returns, the helper goroutine closes `done`, and the main `select` takes the `<-done` branch.

`WaitInFlight` returns nil. `main` proceeds to `srv.Shutdown(drainCtx)`. `Shutdown` immediately closes the listener (so no new connections), then enters a loop that waits for active connections to close. Because we already waited for our middleware's in-flight count, most connections are already idle and closed quickly. `Shutdown` returns nil.

`main` logs `clean exit` and returns. Go's runtime runs any deferred calls in `main`, then exits with code 0. The orchestrator sees the process exit with code 0 within the grace period and marks the pod terminated cleanly.

Total elapsed: roughly 2 seconds (the propagation sleep) plus the maximum handler latency. On a healthy service this is well under 5 seconds.

Now consider the unhappy path: a handler is hung on a stuck downstream call. `inflight.Wait` does not return. The `select` waits. At the 25-second mark, `drainCtx.Done` fires. `WaitInFlight` returns `context.DeadlineExceeded`. `main` logs the error and proceeds anyway. `srv.Shutdown(drainCtx)` is called with an already-cancelled context, so it returns `context.DeadlineExceeded` immediately. `main` logs and returns. The OS sees the process exit. The stuck handler's goroutine is killed by the runtime exit.

Was that drain "clean"? Not entirely — one request did not get a response. But it was bounded, observable, and survivable. The metric `drain_force_cancelled_total` increments, alerting fires, and an engineer investigates the stuck handler tomorrow morning. That is the right shape for a production drain.

---

## Appendix BB: A Note On Determinism

Drain timing is non-deterministic. Two consecutive drains on the same code may take 200ms and 2 seconds, depending on which handlers happened to be active. For tests, this is annoying — assertions on exact drain duration are flaky.

The fix: assert on *bounds*, not exact values.

```go
start := time.Now()
err := svc.Drain(drainCtx)
elapsed := time.Since(start)
if err != nil {
	t.Fatalf("drain: %v", err)
}
if elapsed > 500*time.Millisecond {
	t.Errorf("drain too slow: %s", elapsed)
}
```

A "drain too slow" failure indicates a bug worth investigating. A "drain too fast" assertion is rarely useful.

---

## Appendix CC: How Drain Failure Manifests in Production

When drain is broken, you will see these symptoms in production:

- **Spike in 5xx errors during deploys.** Customers hit half-closed listeners.
- **Duplicate side effects.** Half-processed messages get retried and run twice.
- **Random missing messages.** In-flight work was lost.
- **Goroutine leaks.** `runtime.NumGoroutine` climbs slowly.
- **Slow rollbacks.** A drain that should take 5 seconds takes 30, blocking the next deploy step.

If you see any of these on deploy days, audit drain first.

---

## Appendix DD: A Quick Recap In One Page

| Step | Code | Purpose |
|------|------|---------|
| 1 | `signal.NotifyContext` | Catch `SIGTERM`. |
| 2 | `<-ctx.Done()` | Wait for the signal. |
| 3 | `draining.Store(true)` | Flip readiness. |
| 4 | `time.Sleep(2 * time.Second)` | LB propagation. |
| 5 | `context.WithTimeout` | Drain budget. |
| 6 | `svc.Drain(drainCtx)` | Wait for workers. |
| 7 | `srv.Shutdown(drainCtx)` | Drain HTTP. |
| 8 | `db.Close()` | Close downstream. |
| 9 | `return` from main | Exit zero. |

Memorise that sequence. It is the spine of every production Go service.

---

## Appendix EE: One Last Worked Bug

A team reports: "Our drain is fast, but the database connection pool keeps holding connections after drain ends." Investigate.

The most likely cause: a goroutine that uses a database connection inside its work but does not check the drain context. When drain fires, the context is cancelled, but the goroutine is mid-query. The query returns an error (`context.Canceled`), but the goroutine retries — using a *new* context — and ties up the connection again. Meanwhile, drain finishes but `db.Close` blocks waiting for those connections.

Fix:

1. Propagate the drain context into the query, not a fresh one.
2. On `context.Canceled`, exit the goroutine instead of retrying.

```go
res, err := db.QueryContext(drainCtx, ...)
if errors.Is(err, context.Canceled) {
	return // do not retry
}
```

This is a textbook case of drain context discipline. The drain context must flow all the way down to the lowest call. Any goroutine that swaps in its own fresh context breaks the chain.

---

## Appendix FF: The Last Word

The drain pattern is a Go-flavoured expression of an old idea: orderly retreat. The Romans called it `receptus`. The Royal Navy calls it "striking colours." Computer scientists call it "graceful shutdown." Whatever the name, the discipline is the same: stop accepting work, finish what you have, then leave cleanly.

You now have the tools. Apply them on day one of your next Go project. Apply them retroactively to existing projects. Apply them at every layer — handler, worker, service, system. When in doubt, ask: *what happens if I receive `SIGTERM` right now?* If the answer is "I don't know," there is more drain work to do.

Welcome to production-quality Go.



