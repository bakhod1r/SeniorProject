---
layout: default
title: Generator Pattern
parent: Advanced Channel Patterns
grand_parent: Concurrency
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/11-advanced-channel-patterns/04-generator/
---

# Generator Pattern

A **generator** in Go is a function that returns `<-chan T` and feeds the caller a stream of values from a private goroutine. It is the canonical *source* stage of every channel-based pipeline: turn a slice, a file, an HTTP paginator, or an infinite sequence into a receive-only channel that the rest of the program can `range` over.

The shape is always the same: create an output channel, spawn one goroutine that sends values and `defer close`s the channel, return the receive-only end. What changes is the source of values (finite slice, file scanner, REST paginator, infinite counter) and the cancellation story (none, `done`, `context.Context`).

## Why this matters

A generator is where a pipeline begins and where most goroutine leaks are born. Forget to close the channel and consumers hang forever; forget the cancellation case and the producer leaks when the consumer bails out early; mix value production with side effects and the stage becomes untestable. Get this one pattern right and the rest of your concurrent code becomes composable: feed the generator into fan-out, fan-in, tee, bridge, or rate-limiter without rewriting the producer.

## What you will learn

- The canonical generator template and its three rules.
- Generic generators with `func[T any]`.
- Cancellable generators using `done <-chan struct{}` and `context.Context`.
- Infinite generators (natural numbers, ticks, polling) without leaks.
- Channel generators vs Go 1.23 `range`-over-func iterators.
- Composing generators into fan-out, fan-in, tee, and bridge.
- Real-world generators: line scanners, REST paginators, file walkers.
