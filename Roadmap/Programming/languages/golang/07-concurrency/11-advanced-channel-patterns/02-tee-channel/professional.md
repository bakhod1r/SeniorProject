# Tee-Channel — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [Tee as an Architectural Decision](#tee-as-an-architectural-decision)
3. [Designing Pipelines That Outgrow Tee](#designing-pipelines-that-outgrow-tee)
4. [Migrating Tee to a Hub Without a Big-Bang Rewrite](#migrating-tee-to-a-hub-without-a-big-bang-rewrite)
5. [Cross-Process Tee and the Broker Boundary](#cross-process-tee-and-the-broker-boundary)
6. [Capacity Planning and SLOs](#capacity-planning-and-slos)
7. [Runbook for Tee-Backed Pipelines](#runbook-for-tee-backed-pipelines)
8. [Code Review Heuristics](#code-review-heuristics)
9. [Summary](#summary)

---

## Introduction

Tee is a four-line primitive. The professional concerns around tee are not about the primitive at all; they are about the systems built on top of it. This file is short on Go code and long on judgement: when tee is the right structural choice, how to keep that choice valid as the system grows, and how to operate it.

The frame for this file: assume tee is in your production stack. You did not write it; it was there before you. Now you own it. What do you need to know?

---

## Tee as an Architectural Decision

A team chooses tee, often implicitly, when they want:

1. Two sinks with *coupled* delivery semantics. Either both keep up or both slow down.
2. A *static* topology that does not change at runtime.
3. *Local-process* duplication, not cross-machine fanout.
4. The smallest amount of code that can plausibly work.

The tradeoffs the team is accepting, often without realising:

- They have foreclosed adding a third consumer without code change.
- They have made the pipeline's throughput depend on the slowest of the two consumers.
- They have made a per-consumer outage observable as global slowness.
- They have committed to in-process delivery, which means the pipeline cannot be scaled horizontally without restructuring.

These trade-offs are correct for many systems. They are also the genesis of most "the system worked fine for two years and now it doesn't scale" stories.

When you inherit a tee-based pipeline, your first question should be: *did the original authors choose this for these reasons, or did they choose it because it was the closest primitive to hand?* The right tee is a deliberate decision. An accidental tee is a refactor waiting to happen.

---

## Designing Pipelines That Outgrow Tee

Tee outgrows itself along three axes:

### Axis 1: Number of consumers

A second team wants to consume the same stream. Now you have three consumers. Chained tee works mechanically but reads poorly and propagates latency. By the time someone asks for a *fourth* consumer, you should be migrating to a hub.

Plan ahead by abstracting the duplication behind an interface:

```go
type Stream[T any] interface {
    Subscribe() (<-chan T, func())
}
```

Implement it first as a fixed-2 tee. When you swap to a hub, callers do not change.

### Axis 2: Independence of failure

The product manager says "if the analytics pipeline is down, please do not stop ingesting payments." Coupled tee no longer matches the SLA. Either lossy-asymmetric tee (cheap; loses analytics during outages) or a hub with per-subscriber drop policy (more flexible; more code).

### Axis 3: Throughput

The stream rate doubles every quarter. At 5 M/sec the channel-based tee saturates a core. Sharded tee (multiple tees, hash-partitioned input) or SPMC ring fanout becomes necessary. Architectural change, not a tweak.

A useful exercise: write the names of every consumer of your tee on a whiteboard. Draw an arrow from each to a square labelled "is allowed to slow down the producer." Consumers without an arrow are wrongly on tee.

---

## Migrating Tee to a Hub Without a Big-Bang Rewrite

Migration plan when tee has outgrown itself:

1. **Define the new interface first.** A `Hub[T]` with `Subscribe()` and `Publish()`.
2. **Implement the hub.** Use the broadcast pattern as the template (see [`06-broadcast-pattern/senior.md`](../../05-concurrency-patterns/06-broadcast-pattern/senior.md)).
3. **Add a tee-compatible adapter.** A small shim that exposes `Tee(done, in) (a, b)` but is internally backed by the hub.
4. **Roll the adapter into one consumer at a time.** Each consumer subscribes to the hub through the adapter; old call sites stay as `Tee(...)`.
5. **Once all consumers are subscribed via the hub, retire the adapter.** Now you have a single hub-backed pipeline.

The key move is the adapter. It lets you swap the implementation behind a familiar API and avoid a big-bang rewrite. Test the adapter against the same test suite that exercised the tee.

A subtle point: the hub has different cancellation semantics than tee. Tee couples cancellation; the hub does not. When you migrate, audit any code that relied on "if one consumer panics, the other also stops" — that contract no longer holds.

---

## Cross-Process Tee and the Broker Boundary

Tee is in-process. Across processes the analogue is a message broker with fanout:

- **Kafka**: consumer groups. Two groups reading the same topic each see every message.
- **NATS**: subjects with multiple subscribers.
- **AWS SNS / SQS fanout**: SNS topic with two SQS subscriptions.
- **Google Pub/Sub**: multiple subscriptions on one topic.
- **RabbitMQ**: fanout exchange.

The Go-side tee usually feeds *one* of these brokers, and the duplication happens broker-side. Reasons to keep tee in Go and not push it to the broker:

- Low-latency requirements; broker hops add tens of milliseconds.
- Both consumers live in the same binary; broker is overkill.
- The duplication is for diagnostic or debug paths that should not consume broker capacity.

Reasons to push duplication to the broker:

- Consumers live in separate processes or services.
- Consumers must survive producer restarts.
- Independent rate limits or back-pressure policies per consumer are required.
- Durability of the duplicate is required.

In practice you see hybrid pipelines: one tee in-process feeds Kafka and a local index, with Kafka providing further fanout to other services. The Go tee handles the *first* duplication; Kafka handles the *rest*.

---

## Capacity Planning and SLOs

Treat tee like any pipeline stage and put an SLO on it.

### SLOs to consider

- **End-to-end latency from `in` receive to second-output delivery**, p99. Typically a few ms in well-tuned systems. If tail latency spikes, one consumer is misbehaving.
- **Drift between output counts** (lossy variant). Acceptable steady-state drift is determined by the consumer; absolute counts must converge once load stabilises.
- **Goroutine count.** Should be constant. Growth is a leak.
- **Throughput.** Bench it during change windows.

### Headroom

If your tee tops out at 5 M/sec and you currently push 2 M/sec, you have 2.5x headroom. Plan to migrate to a sharded tee or SPMC ring at 3 M/sec, not 5 M/sec — leave time to roll out and stabilise.

### Cardinality of consumers

Each subscriber on the hub side scales linearly. On the tee side, the constant is 1 (chained tees scale logarithmically with N). If you anticipate N > 5, plan the migration before the third subscriber.

---

## Runbook for Tee-Backed Pipelines

When tee misbehaves in production, the playbook:

### Alert: tee output drift

1. Check both consumers' liveness. If one is down, the other should still be running normally only if you are using the asymmetric lossy variant.
2. If symmetric tee, both consumers are coupled. Find the slow one with goroutine dumps (`pprof goroutine`).
3. Apply the slow consumer's degradation playbook (cache invalidation, queue drain, restart).
4. Confirm tee throughput recovers; output counts re-converge.

### Alert: goroutine count growing

1. Take a goroutine snapshot.
2. Look for stuck `selectgo` calls inside the tee goroutine. Frequent: a downstream consumer leaked its receive goroutine but the tee output still has back-pressure.
3. Identify the consumer side that is not draining. Fix root cause; tee itself is not buggy.

### Alert: drop rate elevated (lossy variant)

1. Check drop counter for both consumers if both are lossy; usually only one is.
2. Look at downstream consumer's processing latency. A spike usually corresponds to GC, dependency outage, or sudden traffic increase.
3. If sustained, evaluate whether to raise buffer size, switch to a hub with shared back-pressure, or accept the loss.

### Incident: tee deadlocks at shutdown

1. Verify `defer close(out1); defer close(out2)` is the first line of the tee goroutine.
2. Verify `done` is being signalled (not `nil`).
3. Verify no consumer is holding a buffered channel full.
4. If a deadlock is reproducible, attach `delve` and dump the goroutine stack. The wedge is almost always in a consumer, not in tee itself.

---

## Code Review Heuristics

When reviewing a PR that uses tee:

1. **Why tee and not fan-out?** If the answer is "because it broadcasts," confirm both consumers need every value.
2. **Why tee and not a hub?** If N might grow, prefer the hub today; cheap to switch later.
3. **Symmetric or asymmetric?** Symmetric is the default; asymmetric is justified by a written reason in the PR.
4. **Is `done` wired to a real cancellation source?** Not a goroutine-local `chan struct{}` that nothing closes.
5. **Are both outputs consumed?** A discarded output is a bug.
6. **Is the payload safe to alias?** If pointer-typed, the contract should be in a comment.
7. **Test coverage:** at minimum, correctness, cancellation, and (for non-lossy) backpressure.
8. **Observability:** counters or logs sufficient to detect drift in production.

A PR that adds tee without addressing items 1-3 should be sent back. A PR that adds tee in a hot path without items 4-6 is a future incident.

---

## Tee as a Documentation Practice

A frequently-overlooked professional concern: tee is invisible in most architecture diagrams. Teams draw "request → processor; request → audit" as two parallel arrows and forget that a single Go source feeds both via a tee. When the audit consumer slows and the processor slows in lockstep, the on-call engineer staring at the diagram has nothing to point to.

Make tee visible:

- **Architecture diagrams.** Draw the tee as an explicit T-shape. Label it with the variant (symmetric, buffered, lossy).
- **Runbooks.** Include "the audit branch and the processor are coupled via tee. If one slows, the other slows. Detected via metric divergence between input rate and either output rate."
- **Code.** Comment the tee site with the rationale: "Symmetric tee chosen because audit consistency is a regulatory requirement; both sinks must move together."

Hidden tees are responsible for a disproportionate number of "why is X slow when Y is the broken thing?" incidents. The cure is documentation, not removal.

---

## Tee in Multi-Tenant Systems

A system that processes streams for multiple tenants has a choice: one tee per tenant (clean isolation, high goroutine count) or one shared tee (lower goroutine count, shared blast radius).

Per-tenant tee:

```go
type tenantPipeline struct {
    audit  <-chan Event
    biz    <-chan Event
    cancel func()
}

func newTenant(parent context.Context, events <-chan Event) *tenantPipeline {
    ctx, cancel := context.WithCancel(parent)
    a, b := Tee(ctx, events)
    return &tenantPipeline{audit: a, biz: b, cancel: cancel}
}
```

Shared tee:

```go
audit, biz := Tee(ctx, multiplexedEvents)
// Each consumer is itself multi-tenant aware.
```

The per-tenant form scales with tenant count: goroutines, channels, and memory grow linearly. The shared form is constant. Choose based on:

- **Tenant count and lifecycle.** A handful of long-lived tenants: per-tenant is fine. Thousands of short-lived tenants: shared.
- **Failure isolation.** Per-tenant tee means one tenant's slow consumer does not affect others. Shared tee couples all tenants.
- **Throughput per tenant.** Many low-rate tenants: shared. Few high-rate tenants: per-tenant.

This decision tends to be made at design time and is expensive to revisit. Think about it before writing the first tee.

---

## Tee in Test Environments

Production-grade pipelines deserve production-grade test environments. Tee shows up in tests in three ways:

### As a system-under-test

Test the tee itself: correctness, cancellation, backpressure, drop semantics for lossy variants. See [tasks.md](tasks.md) and [specification.md](specification.md).

### As a test fixture

Tee a test data stream into the system-under-test and into a captured slice for assertions. This is the "intercept" pattern. The fixture lives outside the system, the system is unchanged.

### As an integration-test scaffold

Tee a live production stream into a shadow service for testing-in-production scenarios. The lossy asymmetric variant is critical here — the shadow service must not impact production. Drop counters and alerts on the lossy branch are mandatory.

---

## Summary

Professionally, tee is a small primitive whose right place is at the *boundary between two static, coupled sinks in one process*. Every step away from that — three sinks, independent failure, cross-process, dynamic membership — is a step toward a hub. Tee's value is that it makes the simple case beautifully simple. Tee's risk is that it makes the simple case so simple that teams keep using it past its design envelope.

Inherit a tee-based pipeline, ask whether the original choice still fits, plan migrations early, instrument heavily, and document the coupling. Once those four habits are in place, tee fades back into the background where it belongs.
