---
layout: default
title: Send/Receive Flow
parent: Channel Internals
grand_parent: Concurrency
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/09-channel-internals/04-send-receive-flow/
---

# Send/Receive Flow

[← Back](../)

A single arrow in Go source — `ch <- v` or `v := <-ch` — turns into a real function call into `runtime/chan.go`. From the moment the compiler lowers your arrow to the moment your goroutine resumes with a value (or panics, or sees `ok == false`), there is a precise sequence of steps: lock the channel, look at the wait queues, possibly copy a value directly to another goroutine's stack, possibly park yourself on a queue, possibly drop a value into a ring buffer slot, possibly panic. This subsection traces that sequence end to end for every combination of buffered/unbuffered, sender-first/receiver-first, open/closed, and shows where the famous "direct handoff" of Go channels actually happens — and where it does not.

## Sub-pages

- [junior.md](junior.md) — A first walk through one send and one receive, with diagrams and small examples
- [middle.md](middle.md) — `chansend1`, `chanrecv1`, `chanrecv2`, the fast paths and the slow paths
- [senior.md](senior.md) — Direct handoff vs buffer hop, sudog lifecycle, race detector hooks
- [professional.md](professional.md) — Read `runtime/chan.go` line by line: every branch, every lock, every `gopark` and `goready`
- [specification.md](specification.md) — The contract `chansend` and `chanrecv` must satisfy, and the memory model implications
- [interview.md](interview.md) — From "what does `<-ch` do" to "explain the direct handoff invariant"
- [tasks.md](tasks.md) — Instrument and reproduce the send/receive flow, measure the two latency regimes
- [find-bug.md](find-bug.md) — Bugs that come from misunderstanding which path the runtime took
- [optimize.md](optimize.md) — Make the flow faster: direct handoff, buffer sizing, contention reduction
