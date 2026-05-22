---
layout: default
title: Decision Tree — Middle
parent: Decision Tree
grand_parent: Primitives Decision Guide
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/24-primitives-decision-guide/04-decision-tree/middle/
---

# Decision Tree — Middle

[← Back](../)

## Table of Contents
1. [What this file assumes](#what-this-file-assumes)
2. [The tree, with the reasoning behind each branch](#the-tree-with-the-reasoning-behind-each-branch)
3. [Branch 1: single value → atomics](#branch-1-single-value--atomics)
4. [Branch 2: shared structure → mutex](#branch-2-shared-structure--mutex)
5. [Branch 3: ownership transfer → channel](#branch-3-ownership-transfer--channel)
6. [Branch 4: one-shot signal → close](#branch-4-one-shot-signal--close)
7. [Branch 5: wait for a condition → Cond or channel](#branch-5-wait-for-a-condition--cond-or-channel)
8. [Branch 6: bounded concurrency → semaphore](#branch-6-bounded-concurrency--semaphore)
9. [Branch 7: run-once → sync.Once family](#branch-7-run-once--synconce-family)
10. [Worked examples](#worked-examples)
11. [Common middle-level mistakes](#common-middle-level-mistakes)
12. [Cheat sheet](#cheat-sheet)
13. [Self-assessment checklist](#self-assessment-checklist)
14. [Summary](#summary)
15. [Further reading](#further-reading)

---

## What this file assumes
You can use each primitive in isolation. What you may still lack is the *reflex* to pick the right one quickly. This file turns the junior-level tree into a reasoned framework: not just "which node", but "why that node and not its neighbor".

---

## The tree, with the reasoning behind each branch

```
What are you synchronizing?
├─ One word (counter/flag/pointer)? ........... ATOMIC
├─ A multi-field structure (map/slice/struct)?  MUTEX (RWMutex if read-dominated)
├─ Handing a value from one goroutine to one?   CHANNEL
├─ Telling many goroutines "go/stop" once? ..... close(chan struct{}) / context
├─ Waiting for an arbitrary condition? ......... channel if value-based, else Cond
├─ Limiting concurrency to N? .................. semaphore (buffered chan / x/sync)
└─ Running init exactly once? .................. sync.Once / OnceFunc / OnceValue
```

First match wins. The branches are ordered by how cheap and how unambiguous the answer is.

---

## Branch 1: single value → atomics
If every operation reads/writes exactly one word and there's no companion invariant, use `sync/atomic`. Counters, flags, and immutable-snapshot pointers live here. The moment a second field must change in lockstep, leave this branch for the mutex branch.

```go
var requests atomic.Int64
requests.Add(1)
```

---

## Branch 2: shared structure → mutex
A map, slice, or struct with several fields that must stay mutually consistent needs a `sync.Mutex`. Promote to `sync.RWMutex` only when reads dominate *and* the read critical section does real work (not a single load — see the mutex-vs-atomic page).

```go
type Cache struct {
    mu sync.Mutex
    m  map[string][]byte
}
```

---

## Branch 3: ownership transfer → channel
When a value moves from producer to consumer and the producer should forget about it afterward, a channel models the handoff and the synchronization in one construct.

```go
jobs := make(chan Job)
jobs <- j      // producer hands off
j := <-jobs    // consumer takes ownership
```

The distinguishing question vs the mutex branch: *are you sharing access to state, or transferring ownership of a value?* Sharing → mutex. Transferring → channel.

---

## Branch 4: one-shot signal → close
To tell many goroutines "stop now" or "you may start", close a `chan struct{}`. A closed channel makes every receive return immediately, so all waiters wake at once. For cancellation that propagates across API boundaries, use `context.Context` (a closed channel underneath).

```go
done := make(chan struct{})
// waiters: <-done
close(done) // wakes them all, once
```

A closed channel cannot be reopened — if you need a repeatable gate, that's the `Cond` branch.

---

## Branch 5: wait for a condition → Cond or channel
"Block until X is true." If X is "a value is available," use a channel. If X is an arbitrary predicate over shared state with no value handoff (config reloaded, gate reopened), use `sync.Cond` with `Broadcast`. Default to the channel; justify the `Cond`.

---

## Branch 6: bounded concurrency → semaphore
To cap concurrent work at N, use a counting semaphore: a buffered `chan struct{}` of capacity N, or `golang.org/x/sync/semaphore` when you need weighted acquisition or context-aware blocking.

```go
sem := make(chan struct{}, N)
sem <- struct{}{}        // acquire
go func() { defer func(){ <-sem }(); work() }()
```

`errgroup.Group.SetLimit(N)` (x/sync) combines this with error propagation and is often the cleanest choice for "run these tasks, at most N at a time, stop on first error."

---

## Branch 7: run-once → sync.Once family
Lazy initialization that must happen exactly once: `sync.Once` historically, or the Go 1.21 helpers `sync.OnceFunc`, `sync.OnceValue`, `sync.OnceValues`, which are more direct and harder to misuse.

```go
var cfg = sync.OnceValue(func() Config { return loadConfig() })
c := cfg() // loads once; subsequent calls return the cached value
```

---

## Worked examples

**"Count cache hits."** One word, no companion invariant → atomic. `atomic.Int64`.

**"A request-scoped cache shared by handlers."** Multi-field map → mutex (`map + sync.Mutex`); RWMutex if reads vastly dominate and lookups are non-trivial.

**"Fan out 10k URLs, max 50 in flight, stop on first error."** Bounded concurrency + error propagation → `errgroup` with `SetLimit(50)`.

**"Load the GeoIP database once, lazily."** Run-once with a value → `sync.OnceValue`.

**"Broadcast shutdown to all workers."** One-shot signal to many → `close(done)` or `context` cancellation.

**"Pause/resume a worker pool repeatedly."** Repeatable gate, many waiters, no value handoff → `sync.Cond` + `Broadcast` (wrapped).

---

## Common middle-level mistakes
1. **Mutex where a channel fits** (and vice versa) — confusing "share state" with "transfer ownership".
2. **Atomic where two fields must agree** — the one-word rule violated.
3. **A fresh channel for a one-shot broadcast** when `close(done)` is simpler.
4. **Hand-rolled semaphore + WaitGroup + error channel** when `errgroup.SetLimit` does all three.
5. **`sync.Once` boilerplate** where `sync.OnceValue` is cleaner (Go 1.21+).
6. **`RWMutex` reflexively** without confirming reads dominate and sections are non-trivial.

---

## Cheat sheet

| Need | Primitive |
|---|---|
| Counter / flag / snapshot ptr | `atomic.*` |
| Shared map/slice/struct | `sync.Mutex` / `RWMutex` |
| Value handoff | channel |
| One-shot broadcast | `close(chan struct{})` / context |
| Bounded concurrency | `chan struct{}` / `errgroup.SetLimit` |
| Run once | `sync.Once` / `OnceFunc` / `OnceValue` |
| Arbitrary predicate wait | channel, else `sync.Cond` |

---

## Self-assessment checklist
- [ ] I can walk the tree from memory and justify each branch.
- [ ] I can distinguish "share state" (mutex) from "transfer ownership" (channel).
- [ ] I reach for `errgroup.SetLimit` for bounded fan-out with errors.
- [ ] I use the `sync.OnceValue` family over raw `sync.Once`.
- [ ] I default to channels for condition waits and justify any `Cond`.
- [ ] I can map five real tasks to the correct primitive without hesitation.

---

## Summary
The decision tree is a sequence of questions, ordered cheapest-and-clearest first: one word → atomic; multi-field state → mutex; value handoff → channel; one-shot broadcast → close/context; bounded concurrency → semaphore/errgroup; run-once → the OnceValue family; arbitrary wait → channel, else Cond. The two questions that resolve most ambiguity are "how many words must change together?" (atomic vs mutex) and "am I sharing access or transferring ownership?" (mutex vs channel).

In `senior.md` we apply the tree to whole-system design: composing primitives across subsystem boundaries, choosing under measured contention, and the API consequences of each choice.

---

## Further reading
- "Go Concurrency Patterns" — https://go.dev/blog/pipelines
- `golang.org/x/sync/errgroup` — https://pkg.go.dev/golang.org/x/sync/errgroup
- `sync` package overview — https://pkg.go.dev/sync
- Bryan C. Mills, "Rethinking Classical Concurrency Patterns"

---

[← Back](../)
