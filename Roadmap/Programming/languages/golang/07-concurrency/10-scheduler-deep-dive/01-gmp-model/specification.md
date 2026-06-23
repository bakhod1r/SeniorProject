# The G-M-P Model — Specification

[← Back to index](index.md)

## Table of Contents
1. [Purpose of This Page](#purpose-of-this-page)
2. [The User-Facing Contract](#the-user-facing-contract)
3. [G State Invariants](#g-state-invariants)
4. [M State Invariants](#m-state-invariants)
5. [P State Invariants](#p-state-invariants)
6. [Runqueue Invariants](#runqueue-invariants)
7. [`newproc` Contract](#newproc-contract)
8. [`schedule` Contract](#schedule-contract)
9. [`findrunnable` Contract](#findrunnable-contract)
10. [`gopark` / `goready` Contract](#gopark--goready-contract)
11. [Idle List Contract](#idle-list-contract)
12. [Spinning M Contract](#spinning-m-contract)
13. [Memory Model Implications](#memory-model-implications)
14. [References](#references)

---

## Purpose of This Page

This page extracts the *formal contract* of the G-M-P scheduler — the invariants every Go runtime implementation must preserve and the user-visible promises that follow from them. It is the answer to "what are the rules?" in a single document. Read it after `professional.md`; it pre-supposes you have seen the structs and the function names.

References are to the Go runtime source pinned to Go 1.22 and to publicly observable Go program behavior. The Go Language Specification does not define the scheduler; it only requires the *behavior* (channel semantics, the happens-before relations of the Memory Model). The scheduler is an implementation choice that satisfies those rules.

---

## The User-Facing Contract

From a user-program perspective, the runtime guarantees:

1. **`go f()` starts a goroutine**. The function `f` begins execution concurrently with the caller. The caller does not wait. The new goroutine sees the values of arguments evaluated at the call site, before scheduling.

2. **Eventual execution**. If a goroutine is runnable and `GOMAXPROCS >= 1`, it will eventually run, assuming the program does not terminate first. There is no absolute upper bound on the delay, but the runtime makes a best-effort to schedule fairly.

3. **Bounded user-code parallelism**. At any moment, at most `GOMAXPROCS` goroutines are *executing user code simultaneously*. (System goroutines like sysmon and GC workers run on Ms without holding Ps and do not count against this cap.)

4. **No starvation under cooperative yielding**. A goroutine that yields (via channels, `time.Sleep`, `runtime.Gosched`, syscalls) cannot starve. The scheduler picks runnable goroutines fairly.

5. **No starvation under non-cooperative loops** (Go 1.14+). A goroutine running a tight CPU loop without function calls is preempted asynchronously after ~10 ms by sysmon.

6. **Deadlock detection**. If every goroutine in the process is parked, the runtime reports `fatal error: all goroutines are asleep - deadlock!`.

7. **`runtime.GOMAXPROCS(0)` reads, `runtime.GOMAXPROCS(n)` sets**. Setting triggers `stopTheWorld` followed by `procresize`.

8. **Stack growth is transparent**. A goroutine's stack can grow up to a configurable limit (default 1 GiB on 64-bit). The user never sees stack-overflow errors except when exceeding that limit.

---

## G State Invariants

The G's `atomicstatus` field is one of:

| Status | Description |
|---|---|
| `_Gidle` | Allocated, not yet initialized. |
| `_Grunnable` | Ready to run; on a runqueue. |
| `_Grunning` | Currently executing on an M with a P. |
| `_Gsyscall` | Its M is in a syscall. |
| `_Gwaiting` | Parked on some primitive's wait queue. |
| `_Gdead` | Terminated; in a free pool. |
| `_Gcopystack` | Stack being copied. |
| `_Gpreempted` | Suspended by async preemption. |

May have `_Gscan` bit OR'd in during stack scanning.

**Invariant G1** — Status atomicity:

All status transitions use atomic CAS. No code observes a stale status without a memory barrier.

**Invariant G2** — Triangle while running:

If `g.atomicstatus == _Grunning`, then:
- `g.m != nil`
- `g.m.curg == g`
- `g.m.p != nil`

**Invariant G3** — Exclusive queue residence:

A G in `_Grunnable` state is in *exactly one* of:
- a P's `runnext` slot,
- a P's `runq` ring buffer,
- `sched.runq` (the global queue).

Never in two of those simultaneously. Never in none.

**Invariant G4** — Exclusive wait residence:

A G in `_Gwaiting` state is in *exactly one* primitive's wait queue (e.g., an `hchan.recvq`, `hchan.sendq`, `sync.Mutex` wait list, timer heap, or netpoll set).

**Invariant G5** — No-park-while-locked:

A G holding a runtime-internal lock (anything in `lockrank.go`) cannot call `gopark`. Doing so would deadlock the runtime.

**Invariant G6** — Status during stack scan:

If `g.atomicstatus & _Gscan != 0`, the G is being scanned by GC. Other code that wants to manipulate the G must wait or use `castogscanstatus`.

---

## M State Invariants

M has no numeric status field, but several boolean and pointer fields together encode state.

**Invariant M1** — Idle M is unbound:

If `m` is in `sched.midle`, then `m.p == 0` and `m.curg == nil`.

**Invariant M2** — Spinning M has a P:

If `m.spinning == true`, then `m.p != 0`. (Spinning means actively looking for work; you can't look without a slot.)

**Invariant M3** — Spinning M has nothing to do:

If `m.spinning == true`, the P's local runqueue is empty *and* the M is in `findrunnable`. Once it finds work, it leaves the spinning state via `resetspinning`.

**Invariant M4** — In-syscall M has no P:

If `m.curg.atomicstatus == _Gsyscall`, then `m.p == 0` (the P was released to a hint slot `nextp` for fast re-attach, or handed off to another M by sysmon).

**Invariant M5** — In-cgo M:

If `m.incgo == true`, the M is executing C code via cgo. Its P is released. Sysmon does *not* count this M as "blocked in syscall" for retake purposes.

**Invariant M6** — LockOSThread reciprocity:

If `g.lockedm != 0`, the M referenced by `lockedm` is the only M that may run `g`. Reciprocally, `m.lockedg == g`. Together they form a fixed pair until `UnlockOSThread`.

**Invariant M7** — `nmspinning` bound:

`sched.nmspinning <= GOMAXPROCS / 2` always. The bound is preserved by the CAS in `wakep` and by `findRunnable`'s entry check.

---

## P State Invariants

P's `status` field is one of `_Pidle`, `_Prunning`, `_Psyscall`, `_Pgcstop`, `_Pdead`.

**Invariant P1** — `_Prunning` reciprocity:

If `p.status == _Prunning`, then `p.m != 0` and `p.m.p == p`.

**Invariant P2** — Idle P is unbound:

If `p.status == _Pidle`, then `p.m == 0` and `p` is in the `sched.pidle` list.

**Invariant P3** — `_Psyscall` transient:

`p.status == _Psyscall` means its M is in a syscall. The P is *not* in `sched.pidle`, but it can be claimed by sysmon and moved to `_Pidle` if the syscall lasts too long.

**Invariant P4** — `_Pgcstop` only during STW:

`p.status == _Pgcstop` only during a stop-the-world phase. Transition out happens at restart-the-world.

**Invariant P5** — `_Pdead` after shrinking:

`p.status == _Pdead` only if `procresize` shrunk `GOMAXPROCS` below this P's id. Caches are drained; the struct is retained for potential re-growth.

**Invariant P6** — Idle bitmask consistency:

`sched.idlepMask` bit `i` is 1 iff `allp[i].status == _Pidle`.

---

## Runqueue Invariants

The local runqueue is a 256-slot ring with atomic head/tail.

**Invariant R1** — Count bound:

`runqtail - runqhead <= 256` always (modular subtraction on `uint32`).

**Invariant R2** — Single-producer tail:

Only the owning P's M may advance `runqtail`. Other Ms read it (for stealing) but do not write.

**Invariant R3** — Multi-consumer head:

Multiple Ms may advance `runqhead` via CAS: the owning M (for `runqget`) and stealing Ms (for `runqsteal`).

**Invariant R4** — Memory ordering:

`runqtail` is written with `StoreRel`, read with `LoadAcq`. `runqhead` is read with `LoadAcq`, advanced with `CasRel`. This provides happens-before from "put a G into the slot" to "pop it for execution."

**Invariant R5** — `runnext` exclusivity:

`runnext`, if non-zero, points to a G in `_Grunnable` state that is *not* in `runq`. Stealing `runnext` requires CAS.

**Invariant R6** — Overflow path:

If `runqput` would overflow the LRQ, `runqputslow` moves half of the LRQ plus the new G to the GRQ atomically under `sched.lock`.

**Invariant R7** — Global runq protected by `sched.lock`:

`sched.runq` is a linked list of `_Grunnable` Gs. All accesses are under `sched.lock`. Batch operations (push or pop multiple at once) amortise lock cost.

---

## `newproc` Contract

**Pre-conditions**:
- `fn` is a valid `*funcval` (non-nil).
- The calling G is in `_Grunning` and has an attached M with a P.

**Effects**:
1. Allocate or reuse a G (from `pp.gFree` or `malg`).
2. Initialize the G's stack so calling `gogo` runs `fn`.
3. Set the G's status to `_Grunnable`.
4. Place the G in `pp.runnext` (displacing previous occupant to `pp.runq`).
5. If `pp.runq` is full, overflow half to GRQ.
6. Call `wakep` to try to start additional parallelism.

**Post-conditions**:
- A new G exists in `_Grunnable`.
- The new G is in exactly one runqueue (most often `runnext`).
- The calling G is unchanged.

**Failure modes**:
- `fn == nil` → `fatal("go of nil func value")`.
- Allocation failure (extreme OOM) → standard runtime OOM panic.

---

## `schedule` Contract

**Pre-conditions**:
- Caller is running on `g0` of an M with an attached P.
- Caller holds no runtime locks (`mp.locks == 0`).
- Caller is not in cgo (`mp.incgo == false`).

**Effects**:
- Picks the next runnable G per the priority order:
  1. Locked G if `mp.lockedg != 0`.
  2. GRQ every 61st iteration (fairness sip).
  3. `pp.runnext`, then `pp.runq`.
  4. `findRunnable`'s search (global, netpoll, steal, park).
- Calls `execute(gp, inheritTime)` which jumps into `gp` via `gogo`.

**Post-conditions**:
- The function does not return. Control resumes only when the executed G yields or terminates.

---

## `findrunnable` Contract

**Search order** (must be preserved):

1. Local runqueue (in case of late arrival).
2. Global runqueue (one G or a batch).
3. Network poller (non-blocking).
4. Spinning steal — random walk of other Ps, up to 4 passes.
5. GC mark workers if mark phase is active.
6. Global runqueue once more (re-check).
7. Park M on `m.park`.

**Pre-conditions**:
- Caller has an attached P.
- Caller's local runqueue is empty.

**Effects**:
- Either returns a G in `_Grunnable` (transitioned to `_Grunning` by the eventual `execute`), or parks the M until woken.

**Post-conditions**:
- If a G is returned, the M is no longer spinning (or `resetspinning` was called).
- If the M parks, its P is on `sched.pidle`.

---

## `gopark` / `goready` Contract

**`gopark`**:

**Pre-conditions**:
- Caller is in `_Grunning`.
- `unlockf`, if non-nil, must not panic.
- Caller has set up the wait queue entry (e.g., enqueued a `sudog`) *before* calling `gopark`.

**Effects**:
1. Transition status to `_Gwaiting` with the given `reason`.
2. Detach from the M (`mp.curg = nil`).
3. Call `unlockf(gp, lock)` if non-nil; if it returns false, re-mark `_Grunnable` and resume (spurious wake).
4. Enter the scheduler loop (`schedule`).

**Post-conditions**:
- The G is no longer running; its registers are saved.
- Until `goready` is called for this G, it does not progress.

**`goready`**:

**Pre-conditions**:
- Target G is in `_Gwaiting`.

**Effects**:
1. Transition status to `_Grunnable`.
2. Place in current P's `runnext` (since `next=true`).
3. Call `wakep` to start parallelism if applicable.

**Post-conditions**:
- The G is in exactly one runqueue.
- Its eventual execution is guaranteed (subject to `GOMAXPROCS >= 1`).

---

## Idle List Contract

**`sched.midle`**:

- A singly-linked list of parked Ms, linked via `m.schedlink`.
- Protected by `sched.lock`.
- Invariant: every M in the list has `m.blocked == true` and is sleeping on `m.park`.

**`sched.pidle`**:

- A singly-linked list of unbound Ps, linked via `p.link`.
- Protected by `sched.lock`.
- Invariant: every P in the list has `p.status == _Pidle` and `p.m == 0`.

**`sched.npidle` / `sched.nmidle`**:

- Atomic counts that mirror the list lengths.
- Used for fast "are there idle resources?" checks without taking the lock.

---

## Spinning M Contract

**Definition**: an M is spinning if `m.spinning == true`. Spinning Ms are counted in `sched.nmspinning`.

**Entry conditions**:
- Caller is in `findrunnable`.
- `2 * sched.nmspinning < gomaxprocs - sched.npidle`.

**Exit conditions**:
- Caller found work → `resetspinning` decrements the counter.
- Caller decides to park → decrements the counter, then calls `stopm`.

**Bound**: `sched.nmspinning <= GOMAXPROCS / 2`.

**Wake reciprocity**: `wakep` only proceeds if `nmspinning == 0`. This avoids waking multiple Ms when one spinner will find the work.

---

## Memory Model Implications

The Go Memory Model specifies happens-before relations between Go-level events. The scheduler's atomic protocol must support these:

**Channel send happens-before receive**: A channel send and its corresponding receive synchronise. Implementation requirement: the write of the value to the channel buffer (or sudog) happens-before the read by the receiver. The release/acquire pattern on the channel's lock provides this.

**`go f()` happens-before f() runs**: All operations the spawning goroutine performed before `go f()` are visible to `f()`. Implementation requirement: `newproc1`'s CAS to `_Grunnable` is a release; `execute`'s read of the status is an acquire.

**`time.Sleep(0)` synchronizes via the scheduler**: This is not a memory model guarantee but a runtime behavior: a `Sleep(0)` is treated like `Gosched`, and after the resume the goroutine sees all memory written by other goroutines.

The runqueue atomics (`StoreRel`/`LoadAcq` on `runqhead`/`runqtail`) provide the necessary happens-before between push and pop. Specifically: enqueue a G on P1, P2 steals it, P2 executes — all writes performed by the enqueuing goroutine before `runqput` are visible to the executing G after `execute`.

---

## References

- **Go Language Specification** — <https://go.dev/ref/spec>. Does not formally define the scheduler, but constrains observable behavior.
- **Go Memory Model** — <https://go.dev/ref/mem>. The happens-before rules the scheduler must implement.
- **Dmitry Vyukov, *Scalable Go Scheduler Design*** (2012) — <https://docs.google.com/document/d/1TTj4T2JO42uD5ID9e89oa0sLKhJYD0Y_kqxDv3I3XMw/edit>. The G-M-P proposal.
- **Dmitry Vyukov, *Go Preemptive Scheduler Design*** — follow-up on preemption.
- **`runtime/HACKING.md`** in the Go source tree — internal documentation for runtime contributors.
- **`runtime/runtime2.go`** and **`runtime/proc.go`** — the implementation.
- **`runtime/lockrank.go`** — the formal lock rank order.

The Vyukov proposal predates `_Gpreempted`, `_Psyscall`'s current semantics, and the async-preemption signal, but the core G-M-P shape it described is the same as today's runtime.
