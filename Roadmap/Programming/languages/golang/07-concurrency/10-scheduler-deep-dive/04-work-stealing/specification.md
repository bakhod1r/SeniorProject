# Work Stealing — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [Invariants](#invariants)
3. [Liveness Properties](#liveness-properties)
4. [Safety Properties](#safety-properties)
5. [Memory Order](#memory-order)
6. [Bounded Capacities](#bounded-capacities)
7. [Fairness Guarantees](#fairness-guarantees)
8. [What Is Not Guaranteed](#what-is-not-guaranteed)
9. [Standards and References](#standards-and-references)
10. [Summary](#summary)

---

## Introduction

The Go language specification says nothing about scheduling. The Go *runtime* makes a set of operational guarantees that user code can rely on. This page catalogues those guarantees as they apply to work stealing. Some are documented in `runtime/HACKING.md`; some are implicit in the test suite; some are folklore stabilised by long use.

Throughout, "M", "G", "P", "LRQ", "GRQ" are as defined in the junior page.

---

## Invariants

### I1: A G is on at most one runqueue at a time

A runnable G occupies exactly one slot: either a P's LRQ, the GRQ, or a P's `runnext`. It is never on two queues simultaneously. The runtime's `runqput`, `runqget`, `runqsteal`, `globrunqput`, and `globrunqget` collectively enforce this.

Consequence: stealing is a *move*, not a copy. The thief removes from the victim's LRQ before pushing to its own. A G cannot be run by two Ms.

### I2: A running G is on no runqueue

When G is `_Grunning`, it lives in `m.curg`, not in any queue. Stealers cannot interact with it.

### I3: LRQ owner pushes to tail, thieves pull from head

Only the P's bound M writes `runqtail`. Any M may CAS `runqhead`. The two indices never alias except when the queue is empty (head == tail).

### I4: Thieves take ceil((tail - head) / 2)

The amount stolen is `n = (t - h) - (t - h) / 2`. For `t - h == 0`, `n = 0` (skip). For `t - h == 1`, `n = 1` (take the only G). For `t - h == 2`, `n = 1`. For `t - h == k`, `n = ceil(k/2)`.

### I5: At least one M is spinning while work exists

The runtime maintains: if `runqsize + Σ(p.LRQ.size for p in allp) > 0`, then `nmspinning > 0` (modulo brief transitions). `wakep` is the mechanism that enforces this.

### I6: `nmspinning <= GOMAXPROCS`

A spinning M holds a P. The number of spinners is bounded by the number of Ps.

### I7: A locked G stays on its M

If `g.lockedm != 0`, the G can only run on `g.lockedm`. The scheduler skips locked Gs when other Ms look at the LRQ. The locked G's M will eventually be picked.

### I8: `runnext` steals only on the fourth round

`stealWork` calls `runqsteal` with `stealRunNextG = (i == stealTries - 1)`. The first three of four rounds leave `runnext` alone.

### I9: `sched.lock` is the only mutex in the steal hot path

LRQ stealing is lock-free. The GRQ requires `sched.lock`. No other mutex is acquired during `findRunnable`'s normal flow.

### I10: All Gs visible after a successful steal are `_Grunnable`

The runtime guarantees that any G pushed to an LRQ is `_Grunnable` before the push. Stealers can run a stolen G without further status manipulation (the caller transitions to `_Grunning` via `execute`).

---

## Liveness Properties

### L1: Work conservation (eventual)

If any P has runnable work, eventually some idle P will steal it. "Eventually" is bounded by:

- A spinning M's rotation interval (~25 ns per P checked).
- The 4-round limit on a spin attempt.
- `wakep`'s call to start a spinner if none exists.

In the worst case, a parked M is woken via `wakep`, transitions to spinning, finds the work, and runs it. The total bound is on the order of microseconds.

**Caveat**: `LockOSThread`-pinned Gs and cgo'd Gs are not subject to this property. They run on their bound M only.

### L2: Sysmon-driven liveness

Sysmon runs every 20 μs to 10 ms. It:

- Preempts long-running Gs (so they re-enter the runqueue and are stealable).
- Detaches Ps from long-running syscalls (so the P becomes available for stealing).
- Calls `wakep` if work exists and no spinner is alive.

These ensure that no "stuck" condition can persist for more than ~10 ms.

### L3: `findRunnable` always terminates

`findRunnable` is not an infinite loop — it either returns a G or parks the M. Park is a terminal state until woken. The `goto top` is reached only after `stopm()`, which itself blocks on a futex.

### L4: No starvation of GRQ

The 1-in-61 rule guarantees that GRQ work is consumed at a rate of at least 1 G per 61 schedule() calls per P. With GOMAXPROCS Ps, GRQ consumption rate is at least GOMAXPROCS/61 Gs per schedule cycle.

---

## Safety Properties

### S1: No double-run

A G runs on at most one M at any instant. The status `_Grunning` is held by exactly one M (the `curg` pointer). Steals do not change `_Grunnable` to `_Grunning`; only `execute` does, and `execute` is called by a single M after taking the G.

### S2: No lost work

Every `runqput` is paired with exactly one `runqget` (or `runqsteal`). The accounting via `runqhead` and `runqtail` is monotonic; no G is dropped.

**Caveat**: a G whose status is corrupted via `unsafe` may be lost. The runtime cannot defend against `unsafe` misuse.

### S3: No double-free of P

A P is in exactly one of: bound to an M (`p.status != _Pidle`), or on `sched.pidle`. Transitions are guarded by `sched.lock`.

### S4: `runqsteal` is wait-free for the owner

The owner's `runqput` does not retry due to thief activity. The CAS in `runqgrab` modifies `runqhead`; the owner only writes `runqtail`. The two never CAS the same field.

### S5: `runqgrab` is non-blocking

If the CAS fails, the thief retries. The retry can lose to other thieves, but progress is guaranteed (one of the contenders will succeed each iteration).

---

## Memory Order

Go's runtime uses acquire-release atomics for LRQ access. Specifically:

- `runqput`:
  - `pp.runq[t%256] = gp` (plain store)
  - `atomic.StoreRel(&pp.runqtail, t+1)` (release-store)

- `runqget`:
  - `t := atomic.LoadAcq(&pp.runqtail)` (acquire-load)
  - then read `pp.runq[...]` safely

- `runqgrab`:
  - `atomic.LoadAcq(&pp.runqhead)`
  - `atomic.LoadAcq(&pp.runqtail)`
  - read `pp.runq[...]`
  - `atomic.CasRel(&pp.runqhead, h, h+n)` (release-CAS)

**Guarantee**: a G pushed by the owner is fully visible (status, links, all fields) to any thief that observes the updated `runqtail`. The release on `runqtail` synchronises with the acquire by the thief.

This is the standard SPSC/SPMC queue memory model from the literature. The Go runtime relies on Go's memory model providing these orderings (Go 1.19+ formalised this).

---

## Bounded Capacities

| Quantity | Bound | Reason |
|---|---|---|
| LRQ slots | 256 | Compile-time constant `len(p.runq)` |
| GRQ slots | unbounded | Linked list |
| `nmspinning` | `GOMAXPROCS` | One M per P, at most |
| Steal attempts per `stealWork` call | `4 × (GOMAXPROCS - 1)` | 4 rounds × all other Ps |
| Steal size per attempt | `len(victim.runq) / 2 = 128` | Half of full LRQ |
| `wakep` cost | O(1) | Single CAS + optional `startm` |

The LRQ being bounded is critical: it ensures cache locality and predictable memory footprint. When it overflows, `runqputslow` moves to the unbounded GRQ — accepting one slow path for the rare overflow case.

---

## Fairness Guarantees

### F1: No P-level starvation under work-conservation

If P0 always has work, P1's spinner will eventually steal from P0 (random victim selection ensures P0 is picked roughly 1 in `GOMAXPROCS-1` attempts).

### F2: No G-level starvation under preemption

Async preemption ensures any G runs for at most ~10 ms before re-entering a runqueue. Stealing then redistributes.

### F3: No GRQ starvation

The 1-in-61 rule.

### F4: No `runnext` starvation

The fourth round of `stealWork` steals `runnext`. A `runnext` G is delayed by at most 4 stealing rounds × `usleep(3)` = ~12 μs before becoming stealable.

### F5: No netpoll starvation

Phase 5 of `findRunnable` checks netpoll on every call. The `lastpoll` timestamp ensures fresh data. Additionally, a parked M doing `stopm` is woken on netpoll readiness via the netpoll-blocking-M mechanism (one M is allowed to block in `epoll_wait` long-term).

### Fairness counter-example: priority

Go does *not* support goroutine priority. All Gs are equal in the runqueues. If you need priority, implement it at the application layer (e.g., separate channels for high-/low-priority work).

---

## What Is Not Guaranteed

### NG1: Which P a G runs on

User code cannot predict the P. A G created on P0 may run on any P after the first steal.

### NG2: Order of execution between Gs

The runtime does not guarantee that Gs run in creation order. `runnext` may reorder; stealing may reorder; netpoll Gs are unordered.

### NG3: Steal latency

The 1 μs typical latency is empirical, not guaranteed. Under heavy contention or pathological scheduling, latency can spike to milliseconds.

### NG4: `GOMAXPROCS` is exactly the parallelism cap

`GOMAXPROCS` caps the number of Ps, which caps the number of user-Go-code-running Ms at any instant. But other Ms (sysmon, GC workers, M-pool) exist. Total OS thread count may be `GOMAXPROCS + 4` or more.

### NG5: Spinning Ms are always present

If `nmspinning` is 0, that may be a transient state during a transition. Do not rely on `nmspinning > 0`.

### NG6: `runqsteal` always succeeds when victim has work

The CAS in `runqgrab` can lose to other thieves. The thief retries, but if many thieves contend on the same victim, individual attempts may fail repeatedly. Eventual success is guaranteed; per-attempt success is not.

---

## Standards and References

- Robert D. Blumofe and Charles E. Leiserson, *Scheduling Multithreaded Computations by Work Stealing*, Journal of the ACM 46(5), 1999. The theoretical foundation. Proves the T_1/P + O(T_∞) bound.
- Matteo Frigo, Charles E. Leiserson, Keith H. Randall, *The Implementation of the Cilk-5 Multithreaded Language*, PLDI 1998. Engineering details, including the THE protocol.
- Dmitry Vyukov, *Scalable Go Scheduler Design Doc*, 2012. The Go 1.1 redesign. Available at `https://golang.org/s/go11sched`.
- Go runtime `src/runtime/HACKING.md`. Lock ranks, invariants, debugging notes.
- Go memory model document, `https://go.dev/ref/mem`. Acquire-release semantics for `sync/atomic`.
- POSIX `pthreads` — Ms map to POSIX threads. Stealing operates above the thread boundary.
- C11/C++11 memory model. Go's atomics align with the acquire-release primitives from these standards.

---

## Summary

Work stealing in Go is governed by a small set of invariants:

- Each runnable G is in exactly one runqueue location.
- Stealing is half-take from a random victim, lock-free via CAS.
- `nmspinning` is maintained to be ≥ 1 while work exists.
- The 1-in-61 rule prevents GRQ starvation.
- Async preemption + sysmon keep work-conservation real.
- Memory order via acquire-release atomics on `runqhead`/`runqtail`.
- The LRQ is bounded (256); overflow goes to the unbounded GRQ.

What is guaranteed: liveness, no double-run, no lost work, eventual fairness. What is not: a specific P for a G, exact ordering, steal latency upper bound under contention.

These invariants are enforced by the runtime source. They are stable contracts that user code can rely on across Go versions (1.14+ at least).
