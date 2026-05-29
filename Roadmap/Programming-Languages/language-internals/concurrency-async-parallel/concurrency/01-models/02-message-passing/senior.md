# Message-Passing Concurrency — Senior Level

> **Topic:** [Message-Passing](README.md)
> **Focus:** distributed message passing, delivery semantics, backpressure architectures

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Code Examples](#code-examples)
8. [Pros & Cons](#pros--cons)
9. [Use Cases](#use-cases)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Best Practices](#best-practices)
13. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
14. [Common Mistakes](#common-mistakes)
15. [Tricky Points](#tricky-points)
16. [Test Yourself](#test-yourself)
17. [Tricky Questions](#tricky-questions)
18. [Cheat Sheet](#cheat-sheet)
19. [Summary](#summary)
20. [What You Can Build](#what-you-can-build)
21. [Further Reading](#further-reading)
22. [Related Topics](#related-topics)
23. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

At the senior level, message passing is no longer just a concurrency primitive — it is the unifying lens through which the entire distributed-systems stack is interpreted. A goroutine writing to a channel, an Akka actor sending an envelope to a sibling, a Kafka producer publishing to a topic, and an HTTP service invoking a downstream microservice are all instances of the same shape: a sender deposits a self-contained value in a queue, and one or more receivers take it off. The differences are not philosophical but operational: latency, durability, ordering, redelivery, and how loudly the system fails when a queue fills up.

Once you accept this unification, the hard questions become uniform across in-process channels and cross-datacenter brokers. What happens when the receiver is slower than the sender? What ordering does the channel preserve under retries? When the receiver dies mid-message, who notices, who restarts it, and what does the next message see when the worker comes back? These are not Kafka problems or Erlang problems — they are message-passing problems, and the answers form a small toolbox of patterns that recur at every layer.

This senior chapter assumes you have written and debugged actor systems or CSP-style programs at scale. We focus on what separates a system that survives a Black Friday spike from one that collapses: explicit delivery semantics, deliberate ordering guarantees, mailbox overflow policy, supervised failure, and observable backpressure. We work through Erlang/OTP, Akka, Go, and the broker-as-mailbox view in parallel so you can transfer intuition between them and design the right shape for your problem.

---

## Prerequisites

- Comfortable with junior/middle material on channels, actors, mailboxes, and select-style multiplexing.
- Working knowledge of at least one of: Erlang/Elixir/OTP, Akka (JVM), or Go concurrency.
- Familiarity with at least one message broker (Kafka, RabbitMQ, NATS, SQS, Pulsar) at the level of writing a producer and consumer.
- Comfort with TCP, sockets, and HTTP — message-passing systems sit on top of them.
- Conceptual understanding of distributed-systems basics: CAP, FLP impossibility, idempotency, leader election.
- Some exposure to backpressure, flow control, and reactive-streams concepts is helpful but not required.

---

## Glossary

| Term | Meaning |
|------|---------|
| **At-most-once** | Messages may be lost but never duplicated. |
| **At-least-once** | Messages are never lost but may be duplicated; receiver must be idempotent. |
| **Exactly-once** | Each message takes effect exactly once end-to-end. Achievable only with transactional or idempotent endpoints, not in raw networking. |
| **FIFO per producer** | Two messages from the same producer arrive at the consumer in send order; messages from different producers may interleave. |
| **Total order** | A single global sequence on which all observers agree. |
| **Causal order** | If A causes B then everyone sees A before B; concurrent messages may be reordered. |
| **Mailbox** | The queue belonging to a single receiver (actor, goroutine, partition, consumer). |
| **Backpressure** | A signal from a slow consumer that propagates upstream and slows the producer. |
| **Bounded vs unbounded** | Whether the mailbox has a fixed capacity. Unbounded mailboxes hide problems; they do not solve them. |
| **Supervisor** | A process whose job is to start, monitor, and restart children according to a strategy. |
| **Let it crash** | Erlang philosophy: handle expected errors, crash on unexpected ones, let the supervisor recover. |
| **Sticky state** | A worker that holds session/state for a particular key; routing must be consistent. |
| **Stateless worker** | Any worker can handle any message; load balancing is trivial. |
| **Shard key** | The field used to route a message to a specific partition or worker. |
| **Consumer group** | A set of consumers cooperating to read all partitions of a topic, each partition owned by one consumer at a time. |
| **Watermark** | A high/low threshold on mailbox occupancy that triggers backpressure or recovery. |
| **Poison message** | A message that always causes the handler to fail; without isolation it can deadlock progress. |
| **Dead-letter queue (DLQ)** | A side channel for messages that exceeded retry budget. |
| **Idempotency key** | A token attached to a message so duplicates can be detected and discarded. |

---

## Core Concepts

### 1. The Unification: In-Process, Network, and Broker

Message passing has three operational dialects that share one logical shape.

| Dialect | Channel | Receiver | Failure mode |
|---------|---------|----------|--------------|
| In-process | Go channel, Akka mailbox, Erlang process queue | Goroutine / actor | Crash, leak, deadlock |
| Network | TCP socket, HTTP request, gRPC stream | Server process | Timeout, partition, retry storm |
| Broker | Kafka topic, NATS subject, SQS queue, RabbitMQ exchange | Consumer group | Lag, rebalance, redelivery |

The crucial observation: all three implement *send-and-forget* semantics with a queue in between. They differ in *durability* (does the queue survive a crash), *latency* (microseconds, milliseconds, or hundreds of ms), *visibility* (can other consumers see the same message), and *ordering* (per-producer, per-partition, or unordered). When you change the dialect — say, replace an in-process channel with Kafka — you are not changing the program shape; you are changing the queue's properties. Most senior bugs come from forgetting which properties changed.

### 2. Delivery Semantics

Three textbook semantics, plus a fourth practical one.

| Semantic | What you give up | What you gain | Implementation |
|----------|------------------|---------------|----------------|
| **At-most-once** | Reliability | Simplicity, low latency | Fire-and-forget; no acks |
| **At-least-once** | Idempotency burden on consumer | No data loss | Retry until acked |
| **Exactly-once** | Performance, scope | One-shot semantics | Transactional broker + idempotent sink |
| **Effectively-once** | None (in practice) | The "good enough" | At-least-once delivery + idempotent consumer |

Pure exactly-once across a network is impossible in the general case (FLP-style result for asynchronous networks with crashes). What systems like Kafka call "exactly-once" is at-least-once on the wire combined with transactional offsets and idempotent producers — strong guarantees within the Kafka boundary, but the moment you write to an external system the property is only as strong as that sink's deduplication.

The practical default is **effectively-once**: design at-least-once delivery and make consumers idempotent through dedup tables, content-addressed writes, or upserts keyed by a stable idempotency key.

### 3. Ordering Guarantees

Ordering is the second axis of confusion after delivery semantics.

| Order | Definition | Cost |
|-------|------------|------|
| **No order** | Receivers see any permutation. | None. |
| **FIFO per producer** | Two messages from the same producer arrive in send order. | Single TCP connection or per-key partitioning. |
| **FIFO per partition / key** | Within a shard, order is preserved. | Shard key must be chosen carefully. |
| **Total order** | All observers agree on one global sequence. | Single broker, leader election, or atomic broadcast (expensive). |
| **Causal order** | Causes precede effects; concurrent events may reorder. | Vector clocks or session tokens. |

The trap: developers often assume FIFO and design without partition keys, then are surprised when retries reorder messages, partitions rebalance, or a duplicate arrives weeks later. The discipline is to write down which ordering you need *per message type*, not for the system as a whole.

### 4. Mailbox Overflow Strategies

Every mailbox has a capacity, even unbounded ones (RAM is finite). The interesting question is what happens at the boundary.

| Strategy | Behavior | Used by | Operational consequence |
|----------|----------|---------|--------------------------|
| **Block sender** | Producer pauses until space frees up. | Bounded Go channels, Akka with `BoundedMailbox` | Natural backpressure; risk of cascading stalls. |
| **Drop newest** | Discard incoming. | UDP-like systems, metrics pipelines | Loss is silent; recent updates lost first. |
| **Drop oldest** | Discard the head of the mailbox. | Telemetry sinks, last-value cache | Loss is silent; old context lost first. |
| **Fail the sender** | Return an error / throw immediately. | RPC frameworks with bounded inflight | Forces caller to handle backpressure explicitly. |
| **Redirect / spill** | Write to disk or DLQ. | Kafka producer batch, RabbitMQ overflow-to-disk | Latency spike; capacity becomes elastic but slow. |

The choice is not technical — it is a product decision. A trading system probably wants `fail the sender`; a metrics agent probably wants `drop oldest`; a payment processor probably wants `block + DLQ`. The wrong default is "unbounded queue" because it defers the choice until the system OOMs at 3 AM.

### 5. Sticky State vs Stateless Workers

Two workload shapes drive different routing strategies.

- **Stateless worker:** any worker may handle any message. Use round-robin or random load balancing. Adding capacity is trivial. Example: image transcoding, stateless HTTP handlers.
- **Sticky-state worker:** the worker holds in-memory state for a key (a user session, a chat room, an order book). The router must deliver every message for that key to the same worker. Example: gaming sessions, IoT device twins, per-user rate limiters.

Sticky workers are routed by **shard key**, which is hashed (typically consistent-hashed) onto worker IDs. Adding capacity requires rebalancing, and rebalancing is where most bugs live: who owns the key during the handover, what happens to in-flight messages, how does the new owner reconstruct state?

### 6. The Erlang Way: Supervisor Trees and "Let It Crash"

Erlang/OTP is the elder statesman of message passing. The model has three pillars:

1. **Tiny processes.** Hundreds of thousands of lightweight processes per node, each with its own mailbox.
2. **Supervisor trees.** Every process is owned by a supervisor that knows how to restart it. Supervisors themselves are supervised, forming a tree rooted at the application.
3. **Let it crash.** Code handles only the errors it can act on. Unexpected failures terminate the process; the supervisor restarts it from a known-good state. The result is that defensive programming inside business code is rare.

Restart strategies are explicit. `one_for_one` restarts only the failed child; `one_for_all` restarts all siblings (when they share state); `rest_for_one` restarts the failed child and everything that depends on it. These strategies encode failure dependencies that would otherwise live in tangled try/catch blocks.

### 7. Akka and the JVM Revival

Akka ported the actor model to the JVM and added cluster sharding, persistence, and streams. Key senior-level differences from Erlang:

- **Untyped vs typed actors.** Modern Akka Typed encodes the message protocol in the type system, eliminating an entire class of "received unexpected message" bugs.
- **Cluster sharding.** Entities (sticky-state actors) are distributed across the cluster by key; Akka manages location transparency and rebalancing.
- **Persistence (event sourcing).** Actors persist events; on restart they replay them to rebuild state. This is the bridge between message passing and durable storage.
- **Backpressure-aware Streams.** Akka Streams (a Reactive Streams implementation) gives you composable, backpressured pipelines on top of actors.

### 8. Go CSP in Production

Go's `chan` + `select` + `goroutine` is the lightweight workhorse. Senior patterns:

- **Goroutine-per-connection.** Cheap: a goroutine costs ~2 KB at start. You can hold 100k+ connections per process if state per connection is small.
- **Worker pool with bounded channel.** Bound concurrency by the channel buffer size; backpressure is automatic.
- **Fan-out / fan-in with `select`.** Multiplex multiple channels in one goroutine; deterministic shutdown by closing a `done` channel.
- **Leak avoidance.** Every goroutine you start must have a documented termination condition. The dominant leak shape is a goroutine blocked on a send to a channel no one reads.

The Go runtime offers no supervisor abstraction; teams build their own with `errgroup`, context cancellation, and explicit lifecycle code. This is power-and-responsibility: more flexible than OTP, but easier to get wrong.

### 9. Backpressure Architectures

Backpressure is the hard-won lesson of every queue-driven system: an unconstrained producer plus a slow consumer equals OOM. The toolkit:

- **Reactive Streams (JVM standard).** A four-method protocol (`onSubscribe`, `onNext`, `onError`, `onComplete`) with explicit `request(n)` for demand signaling.
- **Project Reactor / RxJava.** Reactive Streams implementations with operator libraries. Flux/Mono on Reactor; Observable/Flowable on RxJava.
- **Akka Streams.** Graph-based, fully backpressured by construction. Each stage requests N items from upstream.
- **Go-style implicit backpressure.** A bounded channel naturally blocks the producer when full. Less ceremony, no demand signal — the buffer is the signal.

### 10. Services Architecture as Message Passing

A microservice that exposes an HTTP API is, structurally, an actor: it has a mailbox (the listening socket plus an inbound queue), it processes one request at a time per worker, and it sends messages (downstream calls, broker publishes). All the actor concepts apply:

- **Mailbox overflow** = queue saturation, connection refused, 503.
- **Supervisor** = orchestrator (Kubernetes, Nomad) restarting failed pods.
- **Sticky state** = session affinity, consistent hashing on user ID.
- **Backpressure** = HTTP 429, gRPC `RESOURCE_EXHAUSTED`, slow downstream propagating upstream.

Once you make this analogy explicit, microservice debates ("should this be sync or async?") become message-passing debates ("what delivery semantics does this need? what's the ordering? what's the overflow policy?").

### 11. Diagnostic Tools

| Concern | Tooling |
|---------|---------|
| Mailbox depth | Akka mailbox-size metrics; custom Go channel-len gauges; Kafka consumer lag |
| Goroutine inventory | `runtime.NumGoroutine()`, `pprof goroutine`, `expvar` |
| Actor state | Akka Cinnamon, Erlang `observer`, Lightbend Telemetry |
| Distributed tracing | OpenTelemetry traces across producer → broker → consumer |
| Logs | Structured logs with correlation IDs threaded through every message |
| Heap | Memory profilers; mailbox-bound entries are a top leak source |

The senior reflex: never run a queue in production without monitoring its depth and the age of its oldest item.

### 12. Mailbox-as-Database: The Kafka Analogy

Kafka deliberately collapses the distinction between queue and log. A topic is a durable, replayable, partitioned mailbox. This unlocks patterns invisible to traditional queues:

- **Replay.** Consumers can rewind their offset and reprocess history.
- **Multiple consumer groups.** The same topic feeds many independent pipelines without copying.
- **Event sourcing.** The topic is the source of truth; state is derived by replaying messages.
- **Compacted topics.** A topic acts like a key-value store, retaining only the latest value per key.

When you view actor mailboxes through this lens, the question "should I persist this mailbox?" becomes well-defined: persist whenever you would want to recover state by replaying recent messages.

---

## Real-World Analogies

| Domain | Analogy |
|--------|---------|
| Postal service | Letters in a mailbox; sender never blocks on receiver. |
| Restaurant kitchen | Order tickets on a rail; cooks pull the next, no shared state. |
| Hospital triage | Mailbox is the waiting room; priority routes critical patients first. |
| Airport ATC | Pilots send brief, ordered messages; controllers ack; lost ack means resend. |
| Newspaper delivery | One topic (the paper), many subscribers (consumer groups), each with its own bookmark. |
| Voicemail | Asynchronous; receiver processes when ready; full mailbox is a real failure mode. |
| Customs queue | Bounded, single-server; arrivals beyond capacity are diverted or held outside. |
| Toll booth | Backpressure: traffic stalls behind the slowest lane until you open more. |
| Library reserve shelf | Sticky state: a held book belongs to one patron until released. |
| Court docket | Total order required; one clerk maintains the canonical sequence. |
| Fire drill | Supervisor strategy: kill subprocesses, restart from known-good state. |
| Surgery handoff | Explicit ownership transfer; in-flight context must not be lost. |

---

## Mental Models

1. **Every queue has four properties.** Capacity, ordering, durability, and overflow policy. Write them down before writing the code.
2. **No silent dropping.** If messages can be lost, the loss should be observable: a counter, a log, or a DLQ. Silent drops are debt.
3. **Idempotency is the universal escape hatch.** When in doubt, design the consumer to tolerate duplicates. It is cheaper than chasing exactly-once.
4. **Crashes are messages too.** A process death is an event observed by its supervisor; model failures as messages on a supervision channel.
5. **Backpressure must reach the source.** A queue absorbs short bursts but cannot fix a permanent rate mismatch. The pressure has to propagate to the producer, the client, or the user.
6. **The shard key chooses your future.** Once data is keyed by user ID, you cannot reshard without pain. Pick the key on day one.
7. **Mailboxes are inventory.** Treat queue depth like warehouse inventory: too low means under-utilization, too high means hidden problems.
8. **Distributed actor = local actor + lies.** The wire adds partial failure; pretend it doesn't exist and you will be punished.

---

## Code Examples

### 1. Reliable Request/Response with Retries, Dedup, and Timeouts (Go)

This is the canonical "send a message over an unreliable channel and get one effective reply" pattern. The sender retries with exponential backoff; the receiver dedups via an idempotency key.

```go
package reliable

import (
	"context"
	"errors"
	"fmt"
	"math/rand"
	"sync"
	"time"
)

// Request is what the client sends. The IdempotencyKey is the contract:
// the server promises to apply the side effect at most once per key.
type Request struct {
	IdempotencyKey string
	Payload        string
}

type Response struct {
	Key    string
	Result string
}

// Server holds a dedup table keyed by IdempotencyKey. A real impl would
// use Redis or a database with TTL on the key.
type Server struct {
	mu       sync.Mutex
	seen     map[string]Response
	failRate float64 // simulated flakiness
}

func NewServer(failRate float64) *Server {
	return &Server{seen: make(map[string]Response), failRate: failRate}
}

func (s *Server) Handle(req Request) (Response, error) {
	s.mu.Lock()
	if r, ok := s.seen[req.IdempotencyKey]; ok {
		s.mu.Unlock()
		// Duplicate: return the cached response. This is what makes
		// at-least-once delivery effectively-once.
		return r, nil
	}
	s.mu.Unlock()

	// Simulate flaky network / service.
	if rand.Float64() < s.failRate {
		return Response{}, errors.New("transient failure")
	}

	resp := Response{Key: req.IdempotencyKey, Result: "processed:" + req.Payload}

	s.mu.Lock()
	s.seen[req.IdempotencyKey] = resp
	s.mu.Unlock()
	return resp, nil
}

// Client retries with exponential backoff + jitter, bounded by ctx.
func Send(ctx context.Context, srv *Server, req Request) (Response, error) {
	const maxAttempts = 6
	backoff := 50 * time.Millisecond

	for attempt := 1; attempt <= maxAttempts; attempt++ {
		// Per-attempt deadline so a single hang does not eat the whole budget.
		attemptCtx, cancel := context.WithTimeout(ctx, 200*time.Millisecond)
		resCh := make(chan struct {
			r   Response
			err error
		}, 1)

		go func() {
			r, err := srv.Handle(req)
			resCh <- struct {
				r   Response
				err error
			}{r, err}
		}()

		select {
		case <-attemptCtx.Done():
			cancel()
			// Treat as transient; loop.
		case out := <-resCh:
			cancel()
			if out.err == nil {
				return out.r, nil
			}
			// Else: retry.
		}

		// Exponential backoff with full jitter (Marc Brooker's recipe).
		sleep := time.Duration(rand.Int63n(int64(backoff)))
		select {
		case <-ctx.Done():
			return Response{}, ctx.Err()
		case <-time.After(sleep):
		}
		backoff *= 2
		if backoff > 2*time.Second {
			backoff = 2 * time.Second
		}
	}
	return Response{}, fmt.Errorf("exhausted retries for key %s", req.IdempotencyKey)
}
```

Key points:

- The **idempotency key is the dedup contract.** The server is the source of truth for whether a key has been seen.
- **Per-attempt timeout** prevents one hang from consuming the entire request budget.
- **Full jitter backoff** avoids thundering herds.
- The whole pattern works the same shape whether the transport is HTTP, gRPC, NATS, or a Kafka request/response topic.

### 2. Supervisor Hierarchy Restarting a Failing Worker (Erlang)

Erlang's `gen_server` + `supervisor` showcases "let it crash" without ceremony.

```erlang
%% worker.erl — a worker that may crash on bad input.
-module(worker).
-behaviour(gen_server).
-export([start_link/1, do/2]).
-export([init/1, handle_call/3, handle_cast/2, terminate/2]).

start_link(Name) ->
    gen_server:start_link({local, Name}, ?MODULE, [], []).

do(Name, Msg) ->
    gen_server:cast(Name, Msg).

init([]) ->
    %% State is the count of processed messages — lost on crash, by design.
    {ok, 0}.

handle_cast({process, Data}, Count) ->
    case Data of
        poison -> exit(poisoned);             %% Let it crash.
        _      -> io:format("worker handled ~p (total ~p)~n",
                            [Data, Count + 1]),
                  {noreply, Count + 1}
    end.

handle_call(_, _, S) -> {reply, ok, S}.
terminate(Reason, _) -> io:format("worker dying: ~p~n", [Reason]).
```

```erlang
%% sup.erl — a one_for_one supervisor that resurrects the worker.
-module(sup).
-behaviour(supervisor).
-export([start_link/0, init/1]).

start_link() ->
    supervisor:start_link({local, ?MODULE}, ?MODULE, []).

init([]) ->
    SupFlags = #{strategy => one_for_one,
                 intensity => 5,    %% max 5 restarts ...
                 period => 10},     %% ... in 10 seconds before giving up.
    Child = #{id => worker,
              start => {worker, start_link, [worker]},
              restart => permanent,
              shutdown => 2000,
              type => worker},
    {ok, {SupFlags, [Child]}}.
```

Usage:

```erlang
1> {ok, _} = sup:start_link().
2> worker:do(worker, {process, hello}).         %% prints, count -> 1
3> worker:do(worker, {process, poison}).        %% crash + auto restart
4> worker:do(worker, {process, again}).         %% new worker, count -> 1
```

Notice the discipline: the worker has no try/catch for the poison case. The supervisor *is* the error handler. If poison messages exceed `intensity` in `period`, the supervisor itself fails, and *its* supervisor decides what to do — failure cascades upward through the tree until a level can handle it.

### 3. Akka (Scala) Equivalent

```scala
import org.apache.pekko.actor.typed._
import org.apache.pekko.actor.typed.scaladsl._

object Worker {
  sealed trait Cmd
  final case class Process(data: String) extends Cmd
  case object Poison extends Cmd

  def apply(): Behavior[Cmd] = Behaviors.setup { ctx =>
    Behaviors.receiveMessage {
      case Process(d) =>
        ctx.log.info(s"worker handled $d")
        Behaviors.same
      case Poison =>
        throw new RuntimeException("poisoned")
    }
  }
}

object Sup {
  def apply(): Behavior[Worker.Cmd] = Behaviors.setup { ctx =>
    val supervised = Behaviors
      .supervise(Worker())
      .onFailure[RuntimeException](
        SupervisorStrategy.restart.withLimit(5, 10.seconds)
      )
    ctx.spawn(supervised, "worker")
    Behaviors.empty
  }
}
```

The protocol is type-safe (`sealed trait Cmd`), supervision is composable, and the restart policy mirrors Erlang's `intensity/period`.

### 4. Go Service Handling 100k Connections via Goroutines + Channels

A pattern recurring in chat servers, IoT gateways, and game backends.

```go
package gateway

import (
	"context"
	"log"
	"net"
	"sync"
	"time"
)

// Hub broadcasts messages to all connected clients. Each client owns one
// goroutine for reads and one for writes; the hub owns a single fan-out
// goroutine. Communication is by channels, not shared state.
type Hub struct {
	register   chan *Client
	unregister chan *Client
	broadcast  chan []byte
	clients    map[*Client]struct{}
}

type Client struct {
	conn net.Conn
	send chan []byte // bounded outbound mailbox per client
	hub  *Hub
}

func NewHub() *Hub {
	return &Hub{
		register:   make(chan *Client, 256),
		unregister: make(chan *Client, 256),
		broadcast:  make(chan []byte, 1024),
		clients:    make(map[*Client]struct{}),
	}
}

// Run is the hub's actor loop. It is the single owner of `clients`.
func (h *Hub) Run(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case c := <-h.register:
			h.clients[c] = struct{}{}
		case c := <-h.unregister:
			if _, ok := h.clients[c]; ok {
				delete(h.clients, c)
				close(c.send) // signal writer to stop
			}
		case msg := <-h.broadcast:
			for c := range h.clients {
				select {
				case c.send <- msg:
					// fast path
				default:
					// Slow client: bounded mailbox is full. Choose the
					// overflow policy explicitly. Here: drop the client.
					delete(h.clients, c)
					close(c.send)
				}
			}
		}
	}
}

func (c *Client) readPump() {
	defer func() { c.hub.unregister <- c }()
	buf := make([]byte, 4096)
	for {
		c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		n, err := c.conn.Read(buf)
		if err != nil {
			return
		}
		// Non-blocking publish: if the hub is overloaded we drop.
		select {
		case c.hub.broadcast <- append([]byte(nil), buf[:n]...):
		default:
			log.Printf("broadcast queue full, dropping")
		}
	}
}

func (c *Client) writePump() {
	defer c.conn.Close()
	for msg := range c.send { // closed by hub on unregister
		c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
		if _, err := c.conn.Write(msg); err != nil {
			return
		}
	}
}

func Serve(ctx context.Context, ln net.Listener, h *Hub) error {
	var wg sync.WaitGroup
	go h.Run(ctx)
	for {
		conn, err := ln.Accept()
		if err != nil {
			wg.Wait()
			return err
		}
		c := &Client{conn: conn, send: make(chan []byte, 64), hub: h}
		h.register <- c
		wg.Add(2)
		go func() { defer wg.Done(); c.readPump() }()
		go func() { defer wg.Done(); c.writePump() }()
	}
}
```

This is two actors per client (read pump, write pump) plus one hub actor. With ~8 KB of stack per goroutine and a 64-slot send buffer per client, 100k connections cost ~1.6 GB plus the in-flight bytes. The hub's `default:` branches encode the overflow policy explicitly: drop the slow client, drop the broadcast. Replace those with "block" only if you understand the cascading consequence.

### 5. Backpressure Failure Mode and Fix (Go)

The classic incident: an unbounded queue grows until OOM.

```go
// BROKEN: producer always wins; consumer falls behind silently.
func leakyPipeline(in <-chan Event, sink func(Event)) {
	queue := make(chan Event, 1<<30) // "effectively unbounded"
	go func() {
		for e := range queue {
			sink(e) // slow!
		}
	}()
	for e := range in {
		queue <- e // never blocks; memory grows
	}
}
```

Failure mode: under sustained overload, `queue` grows past available RAM. The process is OOM-killed; on restart, in-flight state is lost.

```go
// FIXED: bounded queue + observable overflow policy.
func boundedPipeline(ctx context.Context, in <-chan Event, sink func(Event),
	dropped *expvar.Int, latency *expvar.Float) {

	queue := make(chan Event, 1024) // bounded
	go func() {
		for e := range queue {
			start := time.Now()
			sink(e)
			latency.Set(time.Since(start).Seconds())
		}
	}()

	for {
		select {
		case <-ctx.Done():
			close(queue)
			return
		case e, ok := <-in:
			if !ok {
				close(queue)
				return
			}
			select {
			case queue <- e:
				// Fast path.
			case <-time.After(50 * time.Millisecond):
				// Slow path: backpressure window expired. Decide policy.
				dropped.Add(1)
				// Optionally: write to a DLQ, return 429 upstream, etc.
			}
		}
	}
}
```

The fixed version makes three things explicit: capacity (1024), how long the producer is willing to wait (50 ms), and what happens on overflow (`dropped` counter, optional DLQ). Now the system has a known failure mode that ops can alert on.

---

## Pros & Cons

| Aspect | Pros | Cons |
|--------|------|------|
| Isolation | No shared mutable state; race conditions become impossible. | State reconstruction after failure is more work. |
| Scalability | Workers scale horizontally; queues absorb bursts. | Mailbox depth becomes a new failure mode. |
| Reasoning | Each actor is a single-threaded state machine. | Distributed effects (ordering, redelivery) are subtle. |
| Failure | "Let it crash" replaces defensive programming. | Requires supervisor discipline and protocols. |
| Cross-language | Works across networks, brokers, and processes uniformly. | Schema evolution becomes a project. |
| Observability | Queue depth and mailbox metrics are first-class. | Cardinality of metrics explodes with actor count. |
| Latency | Async hides high-latency I/O. | Tail latency is dominated by queue waits, which are hard to bound. |
| Throughput | Pipelined, lock-free per actor. | Coordination across actors (e.g., transactions) is expensive. |

---

## Use Cases

- **Real-time systems:** chat, gaming, collaborative editing, financial market feeds.
- **IoT gateways:** millions of device twins as sticky-state actors.
- **Stream processing:** Kafka Streams, Flink, Spark Streaming.
- **Microservices:** every HTTP/gRPC service is an actor at scale.
- **Distributed databases:** internal coordination via Raft/Paxos message passing.
- **Workflow engines:** Temporal, Cadence, AWS Step Functions persist messages as steps.
- **Telephony / VOIP:** Erlang's home turf; per-call processes.
- **Event-sourced systems:** events are messages; state is a fold.
- **CDC pipelines:** Debezium → Kafka → consumers as a message-passing topology.
- **Notification fanout:** SES, push notifications, webhooks.

---

## Coding Patterns

1. **Bounded mailbox + explicit overflow policy.** Always.
2. **Idempotency key on every state-changing message.**
3. **Ack-then-commit.** Process a message, persist the result, then commit the offset / ack.
4. **At-least-once delivery + idempotent consumer = effectively-once.**
5. **Supervised tree with restart limits.** No infinite restart loops.
6. **Saga pattern.** Long-running transactions as a sequence of compensating messages.
7. **Outbox pattern.** Write business state and outbound message in the same DB transaction; a relay publishes them to the broker.
8. **Inbox pattern.** Persist incoming messages before acking; replay on restart.
9. **Sharded actors.** Route by consistent hash on a key; one owner per key at a time.
10. **Dead-letter queue.** Capture poison messages instead of stalling progress.
11. **Backoff with jitter.** Exponential with full or decorrelated jitter.
12. **Circuit breaker.** Stop sending to a failing downstream; let it recover.
13. **Bulkhead.** Per-tenant or per-priority mailbox to prevent one noisy tenant from starving others.
14. **Watermark-based flow control.** High watermark pauses producer; low watermark resumes.
15. **Heartbeat actor.** Periodic self-message to detect liveness.

---

## Clean Code

- **One message type per responsibility.** Sealed protocols beat `Any`/`Object` mailboxes.
- **No primitive obsession.** `UserId(String)` not `String`; the type system carries the intent.
- **Pure handlers.** The actor's `receive` should be a function of `(state, msg) -> (state, effects)`.
- **Effects at the edges.** Network calls, DB writes, log statements happen in dedicated child actors or after the state transition, not in the middle of it.
- **Mailbox capacity is a first-class config.** Surface it in the actor's constructor.
- **Document the failure model.** Every actor's docstring should answer: "what kinds of messages can crash me, and what does the supervisor do?"
- **No God actors.** When a single actor handles many message types and grows past ~200 lines, split it.
- **Avoid `ask` when `tell` will do.** Request/response over actors adds latency and timeouts; reserve it for true RPC.

---

## Best Practices

| Area | Practice |
|------|----------|
| Delivery | Default to at-least-once; design consumers to be idempotent. |
| Ordering | State the required order per message type, not for the system. |
| Capacity | Set every mailbox bound from a capacity model, not a guess. |
| Overflow | Choose drop, block, fail, or DLQ explicitly per queue. |
| Retries | Bound by attempts AND total budget; jitter always. |
| Timeouts | Per-attempt and end-to-end. Never share a single timeout. |
| Idempotency | Idempotency keys with a TTL; persist in a dedup store. |
| Supervision | Restart with backoff and limits; surface escalation. |
| Observability | Track queue depth, oldest age, processing latency, dead-letters. |
| Tracing | Propagate trace IDs through messages and broker headers. |
| Schema | Versioned, evolvable formats (Protobuf, Avro, JSON Schema). |
| Backpressure | Make it propagate to the source; do not hide it in a buffer. |
| Testing | Property-test for reordering and duplication. |
| Deployment | Rolling restarts assume idempotent consumers; verify. |
| Capacity planning | Plan for redelivery storms after broker incidents. |

---

## Edge Cases & Pitfalls

1. **Unbounded mailbox + slow consumer.** OOM eventually. The default capacity should never be "infinite."
2. **Retry storm on outage.** Every client retries simultaneously when the downstream recovers. Add jitter and circuit breakers.
3. **Poison message blocking progress.** Without a DLQ, one bad message can stall a partition forever.
4. **Reordering after retry.** At-least-once with parallel consumers reorders messages. If you need order, partition by key and process serially per partition.
5. **Mailbox starvation.** A noisy tenant fills a shared mailbox; quiet tenants get no service. Bulkhead by tenant.
6. **Sticky-state failover.** When the owner dies, who replays the state? Without persistence, "sticky" actors lose data on crash.
7. **Cluster split-brain.** Two halves of the cluster both think they own the same shard. Use a fencing token or external coordinator.
8. **Rebalancing storms.** A consumer group rebalance during deploy can pause processing for seconds. Tune `session.timeout.ms`, use cooperative rebalancing.
9. **Slow ack chain.** Producer waits for broker, broker waits for consumer, consumer waits for DB. End-to-end latency is the sum.
10. **Off-by-one offsets.** Committing offsets before processing causes data loss; after processing without dedup causes duplicates. Choose deliberately.
11. **Cross-region replication lag.** A consumer in the secondary region sees stale data. Make this explicit in the API.
12. **Goroutine leaks from blocked sends.** A goroutine blocked on `ch <- x` where no one will ever read is a permanent leak; pprof goroutine count grows monotonically.
13. **Mailbox metrics with high cardinality.** One Prometheus series per actor instance can blow up the TSDB. Aggregate by role.
14. **Message size growth.** A schema field added today becomes a 10 KB blob in a year. Watch broker bytes-per-message.

---

## Common Mistakes

- Treating exactly-once as a checkbox the broker provides.
- Using broker features (Kafka transactions) without idempotent sinks.
- Logging on every message in a hot path — log volume becomes the bottleneck.
- Sharing a single timeout for the whole retry budget.
- Using actor `ask` for everything, recreating synchronous bottlenecks.
- Hand-rolling a supervisor instead of using the framework's.
- Building "exactly-once" by deduping in memory without persistence.
- Persisting every event in a queue without compaction or retention policy.
- Allowing actors to share mutable state via closures.
- Choosing a shard key (e.g., timestamp) that creates hot partitions.
- Forgetting to propagate cancellation contexts through async hops.
- Conflating mailbox capacity with broker partition count.
- Adding a metric per actor instance instead of per actor class.
- Treating broker rebalances as exceptional rather than routine.

---

## Tricky Points

- **Exactly-once requires control of both endpoints.** The broker can offer transactional writes, but if the consumer writes to a side system, dedup must happen there.
- **FIFO is per producer, not global.** A consumer reading from one partition sees ordered messages from each producer, but interleaved across producers.
- **Backpressure latency vs throughput trade.** Tight backpressure pauses the producer often, hurting throughput; loose backpressure increases tail latency. There is no free lunch.
- **Restart policy interacts with state.** `one_for_all` resets siblings; if a sibling held in-memory cache, you just dropped it.
- **Mailbox size and processing time interact.** A mailbox holding 1000 messages, each taking 100 ms, is a 100-second tail.
- **At-least-once and ordering conflict.** Retries reorder. Per-key partitioning is the usual fix.
- **Idempotency keys need lifetime.** Forever is impossible; choose a TTL longer than max retry budget.
- **Outbox + CDC = guaranteed publish.** Without it, "transactional" publishes are subtly broken.
- **Cooperative rebalancing reduces stop-the-world.** Worth the upgrade for Kafka clients.
- **Backpressure across protocol boundaries.** HTTP/2 has flow control, gRPC inherits it, but HTTP/1.1 does not — the buffer is the TCP socket.

---

## Test Yourself

1. Why is "exactly-once" delivery impossible in the general case, and what is the practical alternative?
2. Sketch how at-least-once + idempotent consumer achieves effectively-once. What does the idempotency store look like?
3. Compare `one_for_one`, `one_for_all`, and `rest_for_one` supervisor strategies. When is each appropriate?
4. You have a Kafka topic with 12 partitions and 4 consumers in a group. Add a fifth consumer — what happens?
5. Why does an unbounded Go channel hide problems rather than solve them?
6. Design a sticky-state actor system for chat rooms across 100 nodes. How do you route messages? How does a failed node hand off rooms?
7. Explain how the outbox pattern eliminates the "wrote to DB but failed to publish" failure.
8. How does Akka Typed prevent the "received unexpected message" class of bugs?
9. Your service receives a poison message that always crashes the worker. Without a DLQ, what happens? With one?
10. A retry storm follows a downstream outage. List four independent techniques to absorb it.
11. How do you detect a goroutine leak from blocked sends in production?
12. Why is `timestamp` a bad shard key for a write-heavy table?
13. What is the difference between FIFO per producer and total order? Which can Kafka give you per partition?
14. How does Reactive Streams' `request(n)` differ from a bounded Go channel as a backpressure mechanism?

---

## Tricky Questions

**Q1: A senior engineer claims Kafka offers "exactly-once delivery." How do you respond?**
Kafka offers exactly-once *semantics within Kafka*: idempotent producers prevent duplicate appends, transactions atomically commit writes and offsets across partitions and groups. The moment a consumer writes to a non-Kafka sink (a database, an email, an external API) the property holds only if that sink is idempotent. The phrase is true with a footnote; in practice we design for effectively-once everywhere.

**Q2: Your event-sourced system uses `tell` for everything. Latency is fine, but a customer reports a missing operation. How do you investigate?**
Tell is fire-and-forget; there is no automatic confirmation. Investigation: (1) Did the message land in the broker? Check producer logs for the correlation ID. (2) Was it persisted? Check the partition for the event. (3) Was it consumed? Check consumer offsets and DLQ. (4) Was it processed but the result lost? Check the dedup table and downstream effect store. The fix is usually adding an outbox to guarantee the publish, plus a metric on producer-broker ack latency.

**Q3: Akka cluster sharding is rebalancing 10k entities, and your service is paused for 30 seconds. Why?**
During rebalancing, the new owner reads the entity's persisted state before serving messages. With slow persistence (large state, cold cache, journal contention), each rebalance involves I/O proportional to entity count. Mitigations: smaller entity state, snapshots, batched journal reads, cooperative rebalancing, and avoiding deploys during peak.

**Q4: Your Go service holds 80k connections and OOMs at 3 AM. What's your first hypothesis?**
A slow-client buffer growing without bound, or a goroutine leak from blocked sends. Confirm with `pprof goroutine` (count over time), `pprof heap` (top objects), and check the size of any per-client queue. Common cause: the writePump's send channel has unbounded capacity, so a stalled client accumulates messages.

**Q5: Two consumers in the same group are processing the same partition's messages. What is broken?**
This violates Kafka's invariant of one consumer per partition per group. Possible causes: a stuck rebalance leaving zombie consumers, two clients sharing the same `group.id` from different deployments, or a broker misconfiguration. Fix: identify both consumers via metrics, stop the zombie, audit deployment for duplicate group IDs.

**Q6: Why might "let it crash" be a bad idea in a system that holds large in-memory caches?**
A crash discards the cache; subsequent requests miss and overload the downstream. The Erlang answer is to separate the volatile state (process state) from the durable cache (an ETS table or external store). The supervisor restarts the process; the cache survives.

**Q7: A team uses unbounded actor mailboxes "to avoid backpressure." What goes wrong, and what would you propose?**
Backpressure does not vanish; it relocates. The producer keeps sending, the mailbox grows, GC pressure increases, the actor's processing time slows due to large queues, latency spikes, and eventually the JVM OOMs. Propose bounded mailboxes with a `Block` or `Fail` strategy, expose the backpressure to the upstream via overflow events, and add SLO-aligned alerts on mailbox depth.

**Q8: How does the saga pattern relate to message passing?**
A saga is a long-running business transaction modeled as a sequence of messages. Each step has a forward action and a compensating action. Failure mid-saga triggers compensation messages flowing backward. The whole pattern lives entirely in the message-passing world — no distributed two-phase commit needed.

**Q9: You need total order across all events globally. Kafka, Akka, or Erlang?**
None gives you cheap total order by default. Use a single-partition Kafka topic for low throughput, or a consensus layer (Raft) for higher correctness needs. Question the requirement: most "global order" needs are actually per-key order. If you truly need it, accept the throughput cost.

**Q10: How would you debug a 200 ms p99 latency that only appears under load?**
Profile each hop of the message path: producer batch wait, network, broker fsync, consumer wait, processing, downstream call. Frequent culprits at p99: GC pauses, mailbox buildup during bursts, lock contention on shared state, head-of-line blocking from one slow message in a partition. Capture mailbox depth and oldest-message-age over time.

---

## Cheat Sheet

```
+-----------------------------------------------------------------------------+
|  MESSAGE-PASSING SENIOR CHEAT SHEET                                         |
+-----------------------------------------------------------------------------+
|                                                                             |
|  DELIVERY            ORDER             OVERFLOW          FAILURE            |
|  --------            -----             --------          -------            |
|  at-most-once        none              block sender      let it crash       |
|  at-least-once       FIFO/producer     drop newest       supervisor restart |
|  exactly-once*       FIFO/partition    drop oldest       circuit breaker    |
|    *only within      total order       fail sender       bulkhead           |
|     a boundary       causal            redirect/DLQ      retry+jitter       |
|                                                                             |
|  RULES OF THUMB                                                             |
|  --------------                                                             |
|  1. Default to at-least-once + idempotent consumer.                         |
|  2. Bound every mailbox. Pick overflow policy on day one.                   |
|  3. Per-key partitioning to preserve order.                                 |
|  4. Outbox pattern for "DB + publish" atomicity.                            |
|  5. Inbox pattern for "consume + commit" without loss.                      |
|  6. Idempotency key on every state-changing message.                        |
|  7. Per-attempt and end-to-end timeouts. Never share them.                  |
|  8. Jitter on every retry.                                                  |
|  9. Dead-letter queue for poison messages.                                  |
|  10. Backpressure must reach the source.                                    |
|                                                                             |
|  THE QUEUE QUARTET (write these for every queue you design)                 |
|  -------------------                                                        |
|     Capacity   ?     Ordering    ?    Durability   ?    Overflow    ?       |
|                                                                             |
|  DIAGNOSTICS                                                                |
|  -----------                                                                |
|  - Mailbox depth + age of oldest item                                       |
|  - Goroutine / actor count over time                                        |
|  - DLQ size and growth                                                      |
|  - Consumer lag, rebalance frequency                                        |
|  - Tail latency (p99, p99.9), not just averages                             |
|                                                                             |
+-----------------------------------------------------------------------------+
```

---

## Summary

At the senior level, message passing is the unifying view of concurrency from an in-process channel to a cross-datacenter broker. The mechanics are the same — a sender deposits, a receiver picks up — but the operational properties differ: durability, ordering, latency, overflow, and failure handling. Mastering the model means writing down those properties explicitly for every queue in your system.

The delivery-semantics ladder (at-most-once, at-least-once, exactly-once) is the starting point. Exactly-once on the wire is impossible; the practical answer is at-least-once plus idempotent consumers, which gives effectively-once everywhere. Ordering is per producer or per partition; total order is expensive and usually unnecessary. Mailbox overflow is a policy choice — block, drop, fail, or redirect — that must be deliberate, never default.

Failure handling separates beginners from veterans. Erlang's "let it crash" plus supervisor trees, Akka's typed actors with persistence, and Go's hand-rolled lifecycle with `context` and `errgroup` are different surfaces over the same idea: small isolated processes, owned by something that knows how to restart them, communicating through queues. Backpressure must propagate from the slow consumer all the way back to the user; a buffer that hides backpressure is a deferred outage.

The senior reflex: when designing any system, ask the four questions for every queue — capacity, ordering, durability, overflow — and the three questions for every actor — what kills me, who restarts me, what state survives. If you can answer all seven for every component, your system will absorb spikes, survive partial failures, and remain debuggable at 3 AM.

---

## What You Can Build

- A reliable webhook delivery service with at-least-once semantics, idempotent receivers, and observable DLQ.
- A 100k-connection chat or IoT gateway in Go using goroutines and bounded channels.
- An event-sourced order system on Kafka with the outbox pattern, replay, and compaction.
- A cluster-sharded session service on Akka with persistence and rolling restarts.
- A telecom-grade call manager on Erlang/OTP with supervisor trees per call.
- A backpressured ETL pipeline using Akka Streams or Project Reactor.
- A saga orchestrator coordinating long-running transactions across microservices.
- A distributed job queue with priority, retry, and DLQ on RabbitMQ or NATS JetStream.
- A real-time multiplayer game backend with per-room sticky actors.
- A monitoring agent that drops oldest metrics under pressure with bounded buffers.

---

## Further Reading

- *Programming Erlang* — Joe Armstrong. The source.
- *Reactive Messaging Patterns with the Actor Model* — Vaughn Vernon.
- *Designing Data-Intensive Applications* — Martin Kleppmann, chapters 4, 9, 11.
- *Enterprise Integration Patterns* — Hohpe and Woolf. The vocabulary.
- *Kafka: The Definitive Guide* — Narkhede, Shapira, Palino.
- Akka documentation: cluster sharding, persistence, streams.
- The Go memory model and `golang.org/wiki/LearnConcurrency`.
- Marc Brooker's blog on jitter and timeouts.
- Reactive Streams specification (`reactive-streams.org`).
- Pat Helland, "Life Beyond Distributed Transactions."

---

## Related Topics

- [Shared-Memory Concurrency](../01-shared-memory/README.md)
- [Actor Model](../03-actor-model/README.md)
- [CSP & Channels](../04-csp-channels/README.md)
- [Distributed Systems Fundamentals](../../../../../Distributed-Systems/01-fundamentals/README.md)
- [Kafka Architecture](../../../../../Distributed-Systems/messaging/kafka/README.md)
- [Backpressure & Flow Control](../../06-backpressure/README.md)
- [Supervisor Patterns](../../07-supervision/README.md)
- [Idempotency & Exactly-Once](../../../../../Distributed-Systems/semantics/idempotency/README.md)

---

## Diagrams & Visual Aids

### A. The Unified Message-Passing Shape

```
   PRODUCER                  QUEUE / MAILBOX                CONSUMER
   --------                  ---------------                --------

   [send] ----------------> [ m1 | m2 | m3 | ... ] ------> [ receive ]
                              ^              ^
                              |              |
                          capacity        overflow
                          ordering        policy
                          durability
```

### B. Delivery Semantics Ladder

```
    at-most-once       at-least-once       effectively-once       exactly-once
    -----------        -------------       ----------------       ------------
    fire & forget      retry+ack           at-least-once +        transactional
    may lose           may dup             idempotent sink        end-to-end
    [P]-> ...->[C]     [P]<-ack->[C]       [P]<-ack->[C]+[dedup]  (rare)
```

### C. Overflow Policy Decision Tree

```
                +------------------------+
                | mailbox full event     |
                +-----------+------------+
                            |
        +-------------------+-------------------+
        |                   |                   |
   "no loss"           "no latency"        "bounded memory"
   block sender        drop newest         fail sender
   (backpressure)      (telemetry)         (caller handles)
        |                   |                   |
        +-------+-----------+-----------+-------+
                |                       |
          "elastic"               "audit trail"
          spill to disk           redirect to DLQ
```

### D. Supervisor Tree

```
                   [ application ]
                          |
                  [ root supervisor ]
                  /        |        \
            [ db sup ] [ http sup ] [ worker sup ]
              |            |              |
           [ pool ]   [ listener ]   [ worker x N ]
                                       (one_for_one)
```

### E. Backpressure Flow

```
   SOURCE              STAGE 1            STAGE 2          SINK (slow)
   ------              -------            -------          ----------
   produce  --req(8)-->  buffer  --req(4)-->  buffer  --req(2)--> consume
            <--demand---           <--demand---          <--demand--

   Demand signal travels UPSTREAM; data travels DOWNSTREAM.
   No buffer grows unbounded because no stage emits without demand.
```

### F. Outbox Pattern

```
   +--------------------------------------------+
   |          single DB transaction             |
   |  +-------------+        +---------------+  |
   |  | business    |        | outbox row    |  |
   |  | row update  |        | (event blob)  |  |
   |  +-------------+        +-------+-------+  |
   +-------------------------------- | ---------+
                                     v
                          [ relay process ] -- publish --> [ broker ]
                                     ^                            |
                                     +----- ack & delete <--------+
```

### G. Sticky-State Sharding

```
   incoming message with key="user-42"
                  |
                  v
         +--------+--------+
         | consistent hash |
         +--------+--------+
                  |
   shard ring:   ... [N1] ... [N2] ... [N3] ... [N4] ...
                                |
                                v
                       [ entity actor for user-42 ]
                            (single owner)
```

### H. Effectively-Once via Dedup

```
   producer ----m(key=K)----> broker ----m(key=K)----> consumer
                                                          |
                                                          v
                                                  +---------------+
                                                  | dedup store   |
                                                  |  key K seen?  |
                                                  +-------+-------+
                                                          |
                                          yes <-----------+----------> no
                                          drop                       apply effect,
                                          (return cached result)     record K, ack
```
