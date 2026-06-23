---
layout: default
title: Deadlock
parent: Deadlock Livelock Starvation
grand_parent: Concurrency
ancestor: Go
nav_order: 1
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/08-deadlock-livelock-starvation/01-deadlock/
---

# Deadlock in Go

A **deadlock** is a state in which two or more goroutines are blocked forever, each waiting for a resource that another holds. The program does not crash, does not progress, and does not consume CPU. It just stops.

Go is one of the few mainstream languages whose runtime can sometimes detect deadlock automatically. When *every* goroutine in the program is parked at the same time, the runtime aborts with `fatal error: all goroutines are asleep - deadlock!` and a full stack dump. That detector is brutal but narrow — it only fires when the whole program is stuck. Production deadlocks, where a healthy server has fifty goroutines and only three of them are deadlocked over a pair of mutexes, are invisible to it.

This subsection is about both kinds. It explains the **Coffman conditions** that make any deadlock possible, the Go-specific patterns that produce them (channel-without-sender, mutex-inversion, `WaitGroup.Wait` without `Done`, context not propagated), the tools you use to find them (stack dump, `pprof goroutine`, `go vet`, `goleak`, timeouts in tests), and the disciplines that prevent them (lock-order rank, timeouts on `Acquire`, context propagation, structured concurrency).

After this subsection you should be able to:

- Read `fatal error: all goroutines are asleep` and immediately know which channel or lock is the culprit.
- Distinguish whole-program deadlock from partial deadlock and reach for the right tool for each.
- Reproduce, diagnose, and fix mutex lock-inversion deadlocks in seconds, not hours.
- Write tests that detect deadlocks deterministically using timeouts and `goleak`.
- Design a system with a documented lock ordering so deadlock becomes impossible by construction.

Files in this subsection: [junior](junior.md), [middle](middle.md), [senior](senior.md), [professional](professional.md), [specification](specification.md), [interview](interview.md), [tasks](tasks.md), [find-bug](find-bug.md), [optimize](optimize.md).
