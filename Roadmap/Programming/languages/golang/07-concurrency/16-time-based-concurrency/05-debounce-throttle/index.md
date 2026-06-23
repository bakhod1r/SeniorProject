---
layout: default
title: Index
parent: Debounce and Throttle
grand_parent: Time-Based Concurrency
ancestor: Go
nav_order: 1
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/16-time-based-concurrency/05-debounce-throttle/
---

# Debounce and Throttle

[← Back](../)

Debounce and throttle are two complementary tools for taming bursty event streams. They sit at the intersection of three big topics — channels, timers, and rate-limiting — and they show up everywhere: from the search box on a web page that fires a request on every keystroke, to a backend that sends a hundred metric updates per second to a system that prefers one per minute, to a logger that would otherwise dump ten thousand identical lines into stdout when a downstream service falls over.

The two techniques solve different problems but are often confused. A **debouncer** waits for silence. After the last event in a burst it counts down a quiet period and only then fires. If another event arrives during the quiet period, the countdown restarts. Debouncing collapses a burst of events into exactly one trigger and is the right choice when only the most recent value matters and you can afford to wait. A **throttler** enforces a maximum rate. It lets events through at a fixed pace and drops, queues, or blocks the rest. Throttling is the right choice when downstream systems have a hard budget — N requests per second to an API, M log lines per minute to disk, K WebSocket messages per peer.

Go gives you a generous set of building blocks for both. `time.AfterFunc` and `time.Timer.Reset` form the heart of a debouncer. `time.Ticker` and `time.After` are the simplest throttle. The standard library extension `golang.org/x/time/rate` provides a production-grade token bucket that combines burst capacity with a steady refill rate, integrates with `context.Context`, and reuses internal state so it allocates almost nothing per call. Behind every implementation lives the same trio — a channel, a timer, and a `select` — and the trio's order decides whether your throttle starves senders, leaks goroutines, or accidentally turns into a debouncer when the load shifts.

This subsection treats debounce and throttle as one family because in practice you reach for them in the same situations. You will learn the leading, trailing, and "both" variants of debounce; the token-bucket and sliding-window flavours of throttle; how to express each on top of channels and `select`; and how to combine the two so a UI button can debounce clicks while the server-side handler throttles requests.

## Sub-pages

- [junior.md](junior.md) — Debounce vs throttle: when to use which, the simplest implementations with `time.AfterFunc` and `time.Ticker`, and the first bugs you will hit
- [middle.md](middle.md) — Leading, trailing, and both variants; cancellable debouncers; `rate.Limiter` for throttling; real keystroke and HTTP request streams
- [senior.md](senior.md) — Token-bucket and leaky-bucket math, sliding-window throttling, distributed rate limits with Redis, and the hidden cost of `time.Now`
- [professional.md](professional.md) — API rate-limit handling, UI event debouncing in real systems, log throttling, observability, integration with circuit breakers, and post-mortems from real outages
- [specification.md](specification.md) — Reference: the `rate.Limiter` API, token-bucket math, formal debounce/throttle definitions, and the standard library surface
- [interview.md](interview.md) — Interview Q&A from junior to staff: definitions, edge cases, design, and trade-offs
- [tasks.md](tasks.md) — Hands-on exercises: implement a debouncer, a leaky bucket, a sliding window, and a distributed throttle
- [find-bug.md](find-bug.md) — Snippets with real bugs: debouncers that never fire, throttles that leak goroutines, and races inside `Reset`
- [optimize.md](optimize.md) — Performance scenarios: coalesce events, reduce allocations, switch debounce → throttle, and amortise `time.Now`

## How to read this subsection

If you have never written a debouncer, start at `junior.md`, run every snippet, and stop after the first throttle example. If you have built one but it leaked, jump to `find-bug.md` and `middle.md`. If you are designing a public API with rate limits, the `senior.md` and `professional.md` files are where the real engineering lives. The `interview.md`, `tasks.md`, `find-bug.md`, and `optimize.md` files are practice surfaces — use them after the prose to lock the knowledge in.

## Where this sits in the wider Roadmap

This page is the fifth and final entry under **Time-Based Concurrency**. The earlier pages — tickers, `AfterFunc`, timer leaks, and exponential backoff — give you all the primitive moves. Debounce and throttle compose those primitives into the patterns that actually ship in production. After this page the Roadmap moves on to broader concurrency topics: context cancellation, errgroups, and pipelines. The skills you build here will reappear there, because nearly every real pipeline contains at least one rate-limited stage.
