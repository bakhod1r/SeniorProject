---
layout: default
title: Batching Stages
parent: Pipeline Production Patterns
grand_parent: Go
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/19-pipeline-production-patterns/04-batching-stages/
---

# Batching Stages

[← Back](../)

Batching is the production multiplier of every pipeline stage that touches a remote service, a disk, a database, or a CPU-vectorised kernel. A batching stage sits between two channels, accumulates items until a size or time trigger fires, flushes the micro-batch downstream (or to a sink), and must do all of that while still respecting cancellation, end-of-stream markers, and back-pressure. The trade-offs — async vs sync flush, batch size vs latency, accumulator goroutine vs select-loop, jittered ticker vs aligned ticker — decide whether your pipeline survives spikes or melts at the first traffic burst.

The core engineering tension is captured in two numbers per item: `size` and `wait`. If you flush only on size, a slow tail of traffic sits in the accumulator forever and latency goes unbounded. If you flush only on time, you waste the bandwidth amplification that batching exists to provide. A correct batching stage uses both triggers, plus a third — the *end-of-stream marker* propagated from upstream cancellation or input-channel close — so the last partial batch is never lost on shutdown.

A correct accumulator stage in Go is almost always a single goroutine wrapped around a `select` over: the input channel, a `*time.Timer` (or `*time.Ticker`), and a `context.Done()` channel. The buffer is a slice with a fixed cap reused across flushes. The output side is either a synchronous send to the next stage's channel (back-pressure preserved) or an async dispatch onto a small worker pool (throughput at the cost of bounded loss-on-crash and harder ordering). Both shapes have legitimate production homes; this folder teaches when to pick which.

## Sub-pages

- [junior.md](junior.md) — What a micro-batch is, the size/time trigger pair, the accumulator stage skeleton, why naked range-over-channel is not enough, the first-time pitfalls (forgotten flush on close, leaked ticker, captured loop variable in the batch slice)
- [middle.md](middle.md) — Designing the trigger select-loop, ticker vs timer (and how to reset a timer correctly), flush-on-cancellation, end-of-stream flush on input-channel close, when to split into a separate flusher goroutine, buffer reuse with `s = s[:0]`
- [senior.md](senior.md) — Async vs sync flush trade-offs, bounded in-flight flushes, partial-failure handling (per-item vs whole-batch), back-pressure preservation across the boundary, batch ordering guarantees under async dispatch, shutdown-flush correctness proofs
- [professional.md](professional.md) — Multi-tier accumulators (L1/L2 batching), adaptive batch sizing based on downstream latency feedback, jittered timers to avoid herd flushes across instances, allocation-free buffer reuse with object pools, queue-theory framing (Little's law on `wait × λ = items_in_flight`), SLO-driven trigger tuning
- [specification.md](specification.md) — Channel semantics under timer fires, `context` cancellation guarantees, end-of-stream marker conventions (closed-channel sentinel vs `done`-context), ordering invariants of `select` under multiple ready cases
- [interview.md](interview.md) — Interview questions from "why batch?" to staff-level trigger-tuning and back-pressure-vs-async-flush trade-offs
- [tasks.md](tasks.md) — Build a batching DB writer, a size-or-time trigger, an end-of-stream flush, a bounded async-flush variant
- [find-bug.md](find-bug.md) — Lost-batch on shutdown, leaked timer, stuck flush on cancellation, mis-ordered async flush, double-close of output channel
- [optimize.md](optimize.md) — Reuse buffers across flushes, tune the trigger pair to the SLO, switch to bounded async flush, drop ticker stops in tight inner loops, batch-of-batches for very small items

## What you will be able to do after this folder

- Write a correct accumulator stage with a size/time/cancellation trigger triad in under five minutes.
- Argue convincingly whether a given pipeline should flush synchronously or asynchronously, and bound the worst case for each.
- Choose between `*time.Timer` and `*time.Ticker`, reset a timer safely, and explain why the naive reset pattern races.
- Recognise the four most common bugs — lost final batch, leaked timer, captured slice header, double-close — and fix them on sight.
- Tune trigger parameters against an SLO using a back-of-envelope queue-theoretic model, not guesswork.

## Where this sits in the pipeline-patterns ladder

Batching is the third leg of the pipeline-production tripod, after error propagation (folder 01) and cancellation propagation (folder 02), and before fan-in/fan-out coordination (folder 05). It is rarely a standalone topic in real code: the batching stage almost always sits between a fan-out producer and a fan-in consumer, and its correctness under cancellation depends on the contracts established in folder 02. Read the prerequisites first if you have not internalised "every stage must flush its last partial batch on `ctx.Done()`."

## Vocabulary you will use throughout

- **Micro-batch** — a small, in-memory group of items (typically 8 to a few thousand) accumulated for a short window (typically 1 ms to a few hundred ms) before being passed to the next stage as a single unit.
- **Accumulator** — the goroutine that owns the in-flight slice and runs the `select` over input, timer, and cancellation.
- **Size trigger** — the rule "flush when `len(batch) >= maxSize`."
- **Time trigger** — the rule "flush when `time.Since(firstItemTime) >= maxWait`," typically implemented with a `*time.Timer` that is reset on each successful flush.
- **Cancellation trigger** — the rule "flush whatever you have when `ctx.Done()` fires, then exit," ensuring no partial batch is lost on shutdown.
- **End-of-stream marker** — the signal that no more items will ever arrive on the input channel. In Go, this is almost always the input channel being closed.
- **Async flush** — handing the completed batch to a separate goroutine (or worker pool) so the accumulator can continue accepting new items without waiting on downstream latency.
- **Sync flush** — the accumulator itself blocks on the downstream send (or the I/O call) before resuming. Slower but preserves back-pressure and ordering.
- **Back-pressure** — the upstream slowdown induced when a downstream stage cannot accept new work. Sync flush preserves it naturally; async flush requires explicit in-flight bounding.

## Recommended reading order

1. `junior.md` first if you have never written an accumulator before.
2. `middle.md` next for the triple-trigger select-loop, which is the canonical pattern.
3. `senior.md` once you understand the canonical pattern and want to make production trade-offs.
4. `professional.md` last, for staff-level capacity-planning and adaptive control.
5. `specification.md` and `interview.md` are reference material — consult as needed.
6. `tasks.md`, `find-bug.md`, `optimize.md` are exercises — work them after reading the corresponding tier.
