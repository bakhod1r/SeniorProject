---
layout: default
title: Handshaking
parent: Advanced Channel Patterns
grand_parent: Concurrency
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/11-advanced-channel-patterns/06-handshaking/
---

# Handshaking

A **handshake** in Go is a coordinated exchange between two (or more) goroutines that uses channels not to carry a payload but to carry an *agreement*: "I am ready," "you may proceed," "I have stopped," "give me more work." Where a fire-and-forget signal is one-way — sender closes a channel, anyone watching learns the news — a handshake is a paired transaction: one side asks, the other side acknowledges, and only after the acknowledgement do both sides advance.

This section catalogues the canonical handshake patterns: the "started" channel that lets a parent wait for a child to finish setting up, the stop/stopped pair that turns graceful shutdown into a synchronous call, the request/ack loop that creates backpressure, the N-way startup barrier, and the more exotic `chan chan T` rendezvous that hands a goroutine a private reply channel for the answer. Each pattern compiles to a handful of channel operations, but together they form the synchronisation alphabet you need to build reliable lifecycle management.

## Why this matters

A program made of unsynchronised goroutines is a program with a startup race in act one and a shutdown race in act three. Handshakes give you the synchronisation points you need to assert ordering: the HTTP server has finished binding the listener before the test sends its first request, the worker has flushed its buffer before the main goroutine returns, the leader has stepped down before the follower takes over. They are the difference between "it works on my machine" and "it works in production."

## Sub-pages

- [Junior](junior.md) — what a handshake is, started channels, stop/stopped pairs, reply channels embedded in request structs.
- [Middle](middle.md) — bidirectional handshakes, `chan chan T`, the rendezvous pattern, comparison with `sync.Cond` and mutexes.
- [Senior](senior.md) — graceful shutdown handshakes, N-way startup barriers, supervisor patterns, deadlock and leak hazards.
- [Professional](professional.md) — production examples: worker-pool health-check handshakes, leader-election promotion ack, distributed handshake analogues.
- [Specification](specification.md) — Go memory model rules for channel handshakes, close-as-broadcast, references to Pike's "Go Concurrency Patterns".
- [Interview](interview.md) — 20+ questions from intern to staff on handshake design.
- [Tasks](tasks.md) — exercises: implement started-channel patterns, request/ack loops, stop/stopped pairs with deadlines.
- [Find the Bug](find-bug.md) — short snippets where the handshake goes wrong; identify the defect.
- [Optimize](optimize.md) — performance trade-offs between channel-of-channels, req/ack, and done channels.
