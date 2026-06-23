---
layout: default
title: Or-Done-Channel Pattern
parent: Advanced Channel Patterns
grand_parent: Concurrency
ancestor: Go
nav_order: 1
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/11-advanced-channel-patterns/01-or-done-channel/
---

# Or-Done-Channel

The **or-done-channel** pattern wraps a stream channel together with a cancellation signal, producing a new channel that closes when *either* the original stream ends *or* the cancellation fires — whichever happens first. It turns an "unkillable" `for v := range ch` loop into a cancellable one without sprinkling `select` statements throughout the pipeline.

The pattern was popularised by Katherine Cox-Buday in *Concurrency in Go* (O'Reilly, 2017), where it appears alongside `tee`, `bridge`, and `or` as a vocabulary for composable channel pipelines.

## Why this matters

A long pipeline of channel stages is easy to write, but every stage that uses `range ch` becomes a hidden goroutine leak the moment an upstream consumer disappears. `or-done-channel` is a tiny, reusable adapter — usually fewer than fifteen lines — that fixes the leak everywhere it is applied. It is the simplest member of a family of *channel combinators*, and learning it well prepares you for the rest.

## What you will learn

- The leak that motivates the pattern.
- The naive `select`-based fix and why it does not scale.
- The generic `orDone` adapter and how to compose it.
- How `context.Context` covers the same idea in modern code, and when each is right.
- Edge cases: nil channels, double cancellation, buffered streams.
