---
layout: default
title: Index
parent: Exponential Backoff
grand_parent: Time-Based Concurrency
ancestor: Go
nav_order: 1
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/16-time-based-concurrency/04-exponential-backoff/
---

# Exponential Backoff with Jitter

[← Back](../)

Exponential backoff with jitter is the discipline of retrying a failed operation at intervals that grow geometrically and are randomised so that a fleet of clients does not all retry in lockstep. It is the difference between a transient blip that self-heals and a "thundering herd" outage where every client repeatedly hammers a degraded server until it fails for good. Done correctly, it combines three ideas: an exponential growth law (`base * 2^attempt`), a cap to keep delays bounded, and a randomisation strategy (full, equal, or decorrelated jitter) that decorrelates retries across clients.

In Go, exponential backoff sits at the intersection of three primitives you have already met: `time.Sleep` / `time.Timer`, the `context.Context` deadline-and-cancel mechanism, and goroutine-safe random sources. The implementation is not difficult — the subtlety lies in the *policy*: when do you retry, when do you give up, how do you cooperate with a circuit breaker, and how do you avoid retry storms that turn a server brown-out into a server blackout.

This section starts with the bare arithmetic of "double the wait each time" and ends with production-grade retry budgets, deadline propagation, and observability hooks used at AWS, Google, and Stripe.

## Sub-pages

- [junior.md](junior.md) — Why retry at all, the naive constant backoff, the `base * 2^n` formula, and a first working example with `time.Sleep`
- [middle.md](middle.md) — Jitter strategies (full, equal, decorrelated), max-cap, context cancellation, and the idea of a retry budget
- [senior.md](senior.md) — The math of thundering herds, the AWS architecture-blog formulas, deadline propagation, idempotency requirements, and retry storms
- [professional.md](professional.md) — Production: `cenkalti/backoff`, integration with `net/http` and gRPC clients, circuit breaker + backoff composition, metrics and tracing, real postmortems
- [specification.md](specification.md) — Reference: precise formulas for each jitter variant, `math/rand` vs `crypto/rand` trade-offs, `time.Sleep` vs `time.Timer`, integration with `context.WithTimeout`
- [interview.md](interview.md) — 30-40 interview questions and answers ranging from "what is jitter" to "how would you tune retry-budget at scale"
- [tasks.md](tasks.md) — 15-20 hands-on exercises: implement each jitter strategy, retry an HTTP client, build a generic retrier, integrate with `context`
- [find-bug.md](find-bug.md) — 10-12 bug-finding snippets with overflow on `1 << attempt`, missing jitter, infinite retry loops, ignored `ctx.Done()`
- [optimize.md](optimize.md) — 8-10 optimisation scenarios: reducing thundering herd, batching retries, sharing a `*rand.Rand` safely, avoiding `time.Sleep` allocations

## How to read this section

If you have never retried a failing HTTP call programmatically, start at `junior.md` and read through `middle.md`. The two together give you enough to write correct retry code for almost any internal service. If you already write retry loops and just want the math, skip to `senior.md`. If you are operating a high-traffic system and need to integrate backoff with circuit breakers, distributed tracing, and retry budgets, the `professional.md` file is where the real material lives — the earlier pages are pedagogical scaffolding.

The reference file (`specification.md`) is short and dense; treat it as a cheat sheet you return to. The `tasks.md`, `find-bug.md`, and `optimize.md` files are practice: do them before claiming you know the topic.

## Where this fits in the Roadmap

This is the fourth topic under **Time-Based Concurrency**. It assumes you already know:

- `time.Sleep`, `time.Timer`, `time.Ticker` (topics 01–03 in this subsection)
- `context.Context` cancellation and deadlines (topic 13 in the broader concurrency track)
- Basic goroutine patterns and channel-based coordination

It pairs naturally with the next topics: circuit breakers, rate limiters, and deadline propagation in distributed systems. You will see those patterns referenced throughout — exponential backoff is one ingredient of a resilient client, not the whole recipe.
