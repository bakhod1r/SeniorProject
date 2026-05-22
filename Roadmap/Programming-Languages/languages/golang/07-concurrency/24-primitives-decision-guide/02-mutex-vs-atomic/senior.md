---
layout: default
title: Mutex vs Atomic — Senior
parent: Mutex vs Atomic
grand_parent: Primitives Decision Guide
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/24-primitives-decision-guide/02-mutex-vs-atomic/senior/
---

# Mutex vs Atomic — Senior

[← Back](../)

## Table of Contents
1. [What this file is](#what-this-file-is)
2. [A production decision framework](#a-production-decision-framework)
3. [Refactor 1 — hot counter, mutex to atomic](#refactor-1--hot-counter-mutex-to-atomic)
4. [Refactor 2 — read-mostly cache, RWMutex to atomic snapshot](#refactor-2--read-mostly-cache-rwmutex-to-atomic-snapshot)
5. [Refactor 3 — sharded atomics for write-heavy counters](#refactor-3--sharded-atomics-for-write-heavy-counters)
6. [When atomics are a trap](#when-atomics-are-a-trap)
7. [API design: don't leak your synchronization](#api-design-dont-leak-your-synchronization)
8. [The ABA problem](#the-aba-problem)
9. [Observing atomics in production](#observing-atomics-in-production)
10. [Anti-patterns at scale](#anti-patterns-at-scale)
11. [Cheat sheet](#cheat-sheet)
12. [Self-assessment checklist](#self-assessment-checklist)
13. [Summary](#summary)
14. [Further reading](#further-reading)

---

## What this file is
Middle level taught the rules; this file is about *changing* code under load and defending the change. Every refactor below comes with the signal that justifies it and the measurement that confirms it. The senior skill is not "knowing atomics" — it is knowing when the switch is worth the loss of clarity, and proving it.

---

## A production decision framework

Before replacing a mutex with an atomic, all of these must be true:

1. **Profiling names this lock.** The mutex profile or a flame graph shows real time spent here, not a guess.
2. **The protected state is one word, or can be made one word** (via `atomic.Pointer` to an immutable snapshot).
3. **The clarity cost is acceptable.** Atomics are harder to read and audit; the win must be measurable.
4. **You have a benchmark** that reproduces the contention and shows the improvement.

If any is false, keep the mutex. A correct, readable mutex beats a clever atomic that a future maintainer will misread.

---

## Refactor 1 — hot counter, mutex to atomic

**Before** — a request counter on the hot path:

```go
type Metrics struct {
    mu       sync.Mutex
    requests int64
}
func (m *Metrics) Inc()        { m.mu.Lock(); m.requests++; m.mu.Unlock() }
func (m *Metrics) Get() int64  { m.mu.Lock(); defer m.mu.Unlock(); return m.requests }
```

The mutex profile shows 18% of wall time in `Metrics.Inc` under 32 concurrent handlers.

**After:**

```go
type Metrics struct {
    requests atomic.Int64
}
func (m *Metrics) Inc()       { m.requests.Add(1) }
func (m *Metrics) Get() int64 { return m.requests.Load() }
```

| Metric | Before | After |
|---|---|---|
| `Inc` ns/op (32 goroutines) | 105 | 7 |
| Mutex-profile share | 18% | 0% |

The change is safe because `requests` is a single word with no companion invariant. Confirmed with `-race` and the benchmark above.

---

## Refactor 2 — read-mostly cache, RWMutex to atomic snapshot

**Before** — a routing table read on every request, updated every few minutes:

```go
type Router struct {
    mu     sync.RWMutex
    routes map[string]Handler
}
func (r *Router) Lookup(p string) Handler {
    r.mu.RLock(); defer r.mu.RUnlock()
    return r.routes[p]
}
func (r *Router) Update(m map[string]Handler) {
    r.mu.Lock(); r.routes = m; r.mu.Unlock()
}
```

Even `RLock` costs an atomic CAS on a shared reader counter; at 100k req/s across cores, that line shows up in the profile.

**After** — publish an immutable map behind a pointer:

```go
type Router struct {
    routes atomic.Pointer[map[string]Handler]
}
func (r *Router) Lookup(p string) Handler {
    m := *r.routes.Load()
    return m[p] // map read of an immutable map: race-free
}
func (r *Router) Update(m map[string]Handler) {
    r.routes.Store(&m) // m must never be mutated after this
}
```

Readers now do a single pointer load — no shared counter to contend on. The invariant that makes this safe: `Update` always installs a *fresh* map and never mutates a published one. Document that contract loudly, because nothing in the type enforces it.

---

## Refactor 3 — sharded atomics for write-heavy counters

A single `atomic.Int64` incremented by 64 cores still contends on one cache line. For write-heavy aggregate counters, shard per-core and sum on read.

```go
const shards = 64

type Counter struct {
    cells [shards]struct {
        v atomic.Int64
        _ [56]byte // pad to a cache line
    }
}

func (c *Counter) Add(delta int64) {
    idx := runtime_procPin() % shards // or hash of goroutine; see note
    c.cells[idx].v.Add(delta)
}

func (c *Counter) Sum() (total int64) {
    for i := range c.cells {
        total += c.cells[i].v.Load()
    }
    return
}
```

Writes scatter across cache lines (fast, scalable); reads pay O(shards). This is exactly the trade-off `expvar` and many metrics libraries make. Use it only when a single atomic is measurably the bottleneck — it triples the code and makes `Sum` non-atomic (an acceptable approximation for metrics).

---

## When atomics are a trap

- **The "just one more field" creep.** A counter grows a companion field over time. The atomic that was correct becomes a latent race. Re-audit the one-word rule whenever a struct gains a field.
- **Lock-free data structures.** A lock-free queue or map is a research-grade artifact. Unless you are writing infrastructure with a benchmark suite and the memory model memorized, use a mutex-protected structure or an existing library.
- **Atomics as "fast mutexes".** They are not a drop-in. The semantics differ; the audit burden is higher. Reach for them to solve a *measured* contention problem, not preemptively.

---

## API design: don't leak your synchronization

A package's public API should not reveal whether it uses a mutex or an atomic. Expose methods, not fields.

```go
// Good: caller can't tell (or depend on) the mechanism.
func (s *Stats) Requests() int64 { return s.requests.Load() }

// Bad: exposes the atomic, locks you into it forever, invites misuse.
type Stats struct {
    Requests atomic.Int64 // callers may copy the struct → broken
}
```

Critically, **types containing `sync.Mutex` or `atomic` values must not be copied** after first use. `go vet` catches copies of `sync` types. Return pointers, store pointers, and document "do not copy".

---

## The ABA problem

A CAS checks that a value is *unchanged*, not that nothing *happened*. If a value goes A → B → A between your `Load` and `CompareAndSwap`, the CAS succeeds even though the world changed underneath you. For plain counters this is harmless. For pointer-swapping lock-free structures it is a classic bug; the fix is a tagged pointer (version counter packed with the pointer) — another reason to prefer mutex-protected structures unless you have proven need.

---

## Observing atomics in production

- **`expvar`** publishes atomic counters at `/debug/vars` for free.
- **Mutex/block profiles** (`runtime.SetMutexProfileFraction`, `SetBlockProfileRate`) reveal contention that a switch to atomics would relieve — and confirm it's gone afterward.
- **`go test -race` in CI** is non-negotiable; it catches the atomic/plain mixing that code review misses.

---

## Anti-patterns at scale
1. **Copying a struct with an atomic/mutex field** — silently breaks synchronization; `go vet` flags it.
2. **A global single atomic counter hit by every core** — false sharing of one line; shard it.
3. **Lock-free structures hand-rolled** without a benchmark suite and memory-model proof.
4. **Atomic flags publishing data without a documented happens-before contract** — readers may see torn companion state.
5. **Premature atomic optimization** with no profile to justify the readability cost.

---

## Cheat sheet

| Signal | Action |
|---|---|
| Mutex profile names a single-word counter | switch to `atomic.Int64` |
| `RLock` on hot read path of read-mostly data | `atomic.Pointer[T]` snapshot |
| One atomic counter contends across many cores | shard + pad |
| Struct grew a second field | re-audit; likely needs a mutex now |
| Need pointer-swap lock-free structure | prefer a library or mutex; beware ABA |
| Public API | expose methods, never the atomic/mutex field |

---

## Self-assessment checklist
- [ ] I can list the four preconditions before replacing a mutex with an atomic.
- [ ] I can migrate a hot counter and a read-mostly cache, with measurements.
- [ ] I can build a sharded, cache-line-padded counter and explain the trade-off.
- [ ] I know why `go vet` flags copies of sync/atomic types.
- [ ] I can explain the ABA problem and when it bites.
- [ ] I design APIs that hide the synchronization mechanism.

---

## Summary
At senior level the question is never "atomic or mutex?" in the abstract — it is "does the profile justify trading this mutex's clarity for an atomic's speed, and can I prove the win?" Replace mutexes with atomics only on profiled hot paths, only when state is one word or an immutable snapshot, and only with a benchmark in hand. Shard hot counters, pad against false sharing, hide the mechanism behind methods, never copy a sync-bearing struct, and keep `-race` in CI. When a struct grows a field, the old atomic may have quietly become a race — re-audit.

---

## Further reading
- The Go Memory Model — https://go.dev/ref/mem
- `sync/atomic` docs and `atomic.Pointer` — https://pkg.go.dev/sync/atomic
- `expvar` package — https://pkg.go.dev/expvar
- Maurice Herlihy & Nir Shavit, *The Art of Multiprocessor Programming* (ABA, lock-free theory)
- Dmitry Vyukov, 1024cores.net (false sharing, lock-free design)

---

[← Back](../)
