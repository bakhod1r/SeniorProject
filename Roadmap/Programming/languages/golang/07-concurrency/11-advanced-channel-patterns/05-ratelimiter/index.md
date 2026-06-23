---
layout: default
title: Rate Limiter Patterns
parent: Advanced Channel Patterns
grand_parent: Concurrency
ancestor: Go
nav_order: 5
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/11-advanced-channel-patterns/05-ratelimiter/
---

# Rate Limiter

A **rate limiter** caps how often an operation may execute over a window of time. It is the throttle valve that keeps your service from drowning a downstream API, from being overwhelmed by a misbehaving client, or from spending money in a runaway loop. In Go the simplest rate limiter is a buffered channel paired with `time.Ticker`; the production-grade one is `golang.org/x/time/rate.Limiter`.

This section covers both, plus the four canonical algorithms — **token bucket**, **leaky bucket**, **fixed window**, and **sliding window** — and the distributed variants you need once a single process is no longer the only consumer of the resource you are protecting.

## Why this matters

Without rate limiting, your service is a loaded gun pointed at every dependency it has. A retry storm, a runaway cron job, or a single noisy tenant will hammer a database, exhaust an API quota, or blow through a third-party bill in minutes. A rate limiter is the cheapest insurance policy you can write: a few dozen lines of code that keep the rest of the system standing.

## What you will learn

- The channel-and-ticker rate limiter, line by line.
- `time.Tick` vs `time.NewTicker` — and the silent leak the former causes.
- Token bucket, leaky bucket, fixed window, sliding window — when each fits.
- `golang.org/x/time/rate.Limiter`: `Allow`, `Wait`, `Reserve`, burst, lazy fill.
- HTTP middleware shapes (`httprate`, `ulule/limiter`) and per-tenant policies.
- Distributed limiting with Redis (`redis_rate`, leaky-bucket Lua scripts).
- Hardening: hierarchical limiters, graceful degradation, observability.
