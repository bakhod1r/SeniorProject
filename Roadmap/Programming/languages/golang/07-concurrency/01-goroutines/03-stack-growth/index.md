---
layout: default
title: Goroutine Stack Growth
parent: Goroutines
grand_parent: Concurrency
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/01-goroutines/03-stack-growth/
---

# Goroutine Stack Growth

[← Back](../)

A goroutine is famously cheap because it starts life with a *tiny* stack — around 2 KB since Go 1.4. That small footprint is what lets a single Go process hold hundreds of thousands of concurrent goroutines on a normal laptop. The catch is that no compiler can know in advance how much stack a function will need; recursion, large local arrays, and deep call chains all consume space. Go's answer is a runtime mechanism called *copy-and-grow*: when a goroutine's stack overflows, the runtime allocates a new, larger one, copies the live frames, fixes up the pointers, and resumes execution as if nothing happened. The same mechanism, run in reverse during garbage collection, can shrink a stack that has become wastefully large. Understanding how this works — the cost of growth, the role of `morestack`, the prologue check the compiler inserts on every function, the 1 GB hard limit, and the history that took Go from segmented stacks (1.0–1.2) to copying stacks (1.3+) — turns "goroutines are cheap" into a precise, operationally useful fact.

## Sub-pages

- [junior.md](junior.md) — The 2 KB starting stack, why it works, copy-and-grow in one picture, deep recursion as the canonical overflow, and the first `runtime: goroutine stack exceeds` panic you will see
- [middle.md](middle.md) — Growth and shrink mechanics, the stack-growth check in every function prologue, stack split history, cost of growth, `runtime/debug.SetMaxStack`, and when "cheap" stops being cheap
- [senior.md](senior.md) — Architecture: deep recursion vs iteration trade-offs, stack-heavy workloads, large frames, recursive descent parsers, JSON parsers, web frameworks that touch the stack every request
- [professional.md](professional.md) — Internals: `morestack`, `newstack`, `stackalloc`, `stackpool`, `stackcache`, copying mechanics, pointer fix-up via stack maps, GC integration, and how to read `runtime/stack.go`
- [specification.md](specification.md) — What the Go spec and runtime documentation say about stacks, `runtime/debug.SetMaxStack` semantics, `GODEBUG` knobs, release notes for stack-related changes, and references
- [interview.md](interview.md) — Junior through staff questions on stack size, growth mechanism, costs of recursion, why goroutines beat threads on memory, and how to instrument stack usage
- [tasks.md](tasks.md) — Hands-on exercises measuring initial stack size, observing growth, forcing growth deliberately, watching shrink in `runtime.MemStats`, and capping with `SetMaxStack`
- [find-bug.md](find-bug.md) — Bug-finding exercises around runaway recursion, accidentally deep call chains, stack overflow in real-world code (JSON, regex, recursive descent), and stack-related panics that masquerade as memory leaks
- [optimize.md](optimize.md) — Optimization exercises: converting recursion to iteration, sizing frames, pre-allocating to avoid growth, reading pprof's stack samples, and reducing per-goroutine memory in high-concurrency services
