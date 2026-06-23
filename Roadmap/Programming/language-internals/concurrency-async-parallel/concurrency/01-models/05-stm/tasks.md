# STM — Hands-On Tasks

> **Topic:** [STM](README.md)

---

## Introduction

Software Transactional Memory (STM) brings database-style optimistic
concurrency into shared-memory programming. Instead of locks, you describe
a block as a transaction reading and writing memory cells (TVars / refs);
the runtime guarantees all reads and writes commit atomically, or the
whole transaction rolls back and retries. This eliminates deadlock, lock
ordering, and half-applied state at the cost of conflict detection and
occasional retries.

These exercises walk from "hello world" up through the algorithmic core
real implementations use. Warm-Up shows the API in three ecosystems
(Haskell STM, Clojure refs, Scala STM). Core drills shipping patterns —
bounded queues, conditional consumers, the `retry` / `orElse`
composition. Advanced opens the hood: a simplified TL2, a reproduced
retry storm, benchmarks vs locks. Capstone ships realistic systems — a
ledger, an inventory service, a decision memo.

Work in order. Try every task without hints first. The self-check is
what you should demonstrate or argue before moving on.

---

## Table of Contents

- [Warm-Up](#warm-up)
- [Core](#core)
- [Advanced](#advanced)
- [Capstone](#capstone)
- [Related Topics](#related-topics)

---

## Warm-Up

These tasks build muscle memory for STM APIs across three languages.

### Task 1: Atomic Counter in Haskell STM

**Problem.** Create a `TVar Int` initialized to zero. Spawn 1,000 worker
threads that each increment it 1,000 times inside `atomically`. Print the
final value, which must be exactly 1,000,000.

**Constraints.**
- Use `Control.Concurrent.STM` only — no `MVar`, no `atomicModifyIORef`.
- Each increment is its own transaction.
- Use `async` (or an MVar barrier) to wait for completion.

**Hints (try without first).**
- `newTVarIO`, `readTVar`, `writeTVar`, `atomically`, `modifyTVar'`.
- `replicateConcurrently_` is the cleanest barrier.

**Self-check.**
- [ ] Output is exactly 1,000,000 across ten runs.
- [ ] You can explain why removing `atomically` would lose updates.
- [ ] You can describe what the STM runtime does on a conflict.

---

### Task 2: Two-Account Transfer

**Problem.** Model two accounts as `TVar Int`. Write `transfer :: TVar
Int -> TVar Int -> Int -> STM ()` that debits and credits atomically.
Run 10,000 concurrent random transfers and verify the total is invariant.

**Constraints.**
- The transfer is a single transaction — no intermediate "in flight" state.
- Don't pre-check balance outside the transaction; source may go negative.

**Hints (try without first).**
- `modifyTVar'` is shorter than read+write.
- Capture the initial sum before the workload starts.

**Self-check.**
- [ ] Final sum equals initial sum on every run.
- [ ] You can explain why locks need a fixed lock order to avoid
      deadlock and STM does not.

---

### Task 3: Clojure `dosync` + `alter`

**Problem.** Reproduce Task 2 in Clojure with `ref`, `dosync`, and
`alter`. Run transfers across `pmap` or a thread pool. Verify the
invariant.

**Constraints.**
- Use `alter`, not `ref-set` — you want commute-friendly semantics.
- No `commute` here; you want to feel the difference later.

**Hints (try without first).**
- `(ref 1000)` to construct.
- `(dosync (alter from - amount) (alter to + amount))`.

**Self-check.**
- [ ] Invariant holds.
- [ ] You can explain Clojure's MVCC-style ref history and what
      `:min-history` / `:max-history` configure.

---

### Task 4: Scala STM Atomic Block

**Problem.** Using `scala-stm` (or Cats Effect STM), implement the
transfer scenario. Compare ergonomics with Haskell and Clojure.

**Constraints.**
- Use `Ref` and `atomic { implicit txn => ... }`.
- Prefer `Ref#transform` / `update` over read+write.

**Hints (try without first).**
- `Ref(0)` constructs; `ref() = newValue` writes; `ref()` reads inside a txn.

**Self-check.**
- [ ] You can name two differences between scala-stm and Haskell STM
      (e.g. side-effect handling, exception model).

---

### Task 5: Condition Retry — Wait Until Funded

**Problem.** Extend Task 2 with `withdraw :: TVar Int -> Int -> STM ()`
that calls `retry` when balance is insufficient. Drive it from a
producer that deposits periodically and a consumer that withdraws.

**Constraints.**
- Consumer must not poll. It must block on `retry`.
- Producer wakes the consumer just by committing a deposit transaction.

**Hints (try without first).**
- `retry :: STM a`; `check :: Bool -> STM ()` is sugar for `unless b retry`.

**Self-check.**
- [ ] You can explain which TVars the runtime registers the blocked
      transaction against, and what wakes it.
- [ ] CPU usage while blocked is effectively zero.

---

### Task 6: `orElse` — Try Two Sources

**Problem.** Two queues `qA` and `qB` (each `TVar [Int]`). Write
`takeEither :: TVar [Int] -> TVar [Int] -> STM Int` taking the head of
whichever is non-empty, preferring `qA`. If both empty, block until one
becomes non-empty.

**Constraints.**
- Use `orElse`. Do not poll, do not branch on `null` outside STM.
- Each branch must call `retry` when empty.

**Hints (try without first).**
- `orElse :: STM a -> STM a -> STM a`; left branch's effects discarded on retry.

**Self-check.**
- [ ] You can explain why `orElse` is impossible to express with locks
      without re-checking conditions.

---

### Task 7: Lift a Pure Data Structure

**Problem.** Wrap any persistent (immutable) map in a single `TVar`.
Expose `insert`, `lookup`, `delete` as STM actions. Run with 100
concurrent workers.

**Constraints.**
- The TVar holds the whole map. No per-key TVars.
- Operations are single transactions.

**Hints (try without first).**
- `Data.Map.Strict` in Haskell; `PersistentHashMap` in Clojure.

**Self-check.**
- [ ] You can predict and measure how throughput degrades as worker
      count grows (single-TVar contention).
- [ ] You can argue when this is acceptable vs needing finer-grained TVars.

---

## Core

These are the patterns you ship. The `retry` / `orElse` composition is
the reason STM is more expressive than locks.

### Task 8: Bounded Queue via STM

**Problem.** Implement a bounded FIFO with capacity `N`. `enqueue`
blocks when full, `dequeue` blocks when empty. Drive with multiple
producers and consumers; verify per-producer FIFO order.

**Constraints.**
- The queue state is a single TVar (list / `Seq` / two-list amortized).
- Blocking uses `retry`, not sleep loops.

**Hints (try without first).**
- Cache length in its own TVar to avoid recomputing.
- `Data.Sequence.Seq` gives O(1) cons and snoc.

**Self-check.**
- [ ] Producers block exactly when at capacity; consumers when empty.
- [ ] You can describe the wakeup path: which TVar write unblocks which retry.

---

### Task 9: `retry` + `orElse` Composition

**Problem.** Build a `select`-like primitive: given `[STM a]`, run the
first whose guard does not `retry`, or block if all retry. Use it to
multiplex over four queues.

**Constraints.**
- Implementation must be `foldr1 orElse`.
- Composed transaction commits exactly the winning branch's effects.

**Hints (try without first).**
- `orElse` is left-biased.
- Empty input is a programming error, not `retry`.

**Self-check.**
- [ ] You can write a Go-channel-`select` analogue in ten lines.
- [ ] You can articulate why this is impossible in lock libraries without
      inversion of control.

---

### Task 10: Conditional Dequeue with Predicate

**Problem.** Extend Task 8 with `dequeueWhen :: (a -> Bool) -> STM a`
removing the first matching element, or blocking until one exists.

**Constraints.**
- Must not consume non-matching elements.
- Must wake only when a matching element arrives.

**Hints (try without first).**
- Walk the sequence, partition, rebuild.
- Whole-sequence reads are fine — STM tracks the read set.

**Self-check.**
- [ ] You can explain why this is hard with condition variables and easy with STM.
- [ ] You can describe read-set growth and its impact on throughput.

---

### Task 11: Dining Philosophers via STM

**Problem.** Five philosophers, five forks as `TVar (Maybe
PhilosopherId)`. A philosopher eats by picking up both adjacent forks
in a single transaction. Run for one minute; verify no starvation and
no deadlock.

**Constraints.**
- One transaction acquires *both* forks. No two-step acquisition.
- No global fork ordering (the classic trick must not be necessary).

**Hints (try without first).**
- `Just` means held; `retry` if either fork is held.

**Self-check.**
- [ ] You can explain why STM eliminates deadlock without fork ordering.
- [ ] You can measure fairness (eat counts per philosopher) and discuss it.

---

### Task 12: Linked List with Per-Node Refs

**Problem.** Singly-linked list where each node is `TVar (Node a)` with
`Node a = Cons a (TVar (Node a)) | Nil`. Provide `insertSorted`,
`delete`, `contains`. Run mixed read/write workloads.

**Constraints.**
- Each operation is one transaction.
- Operations on disjoint parts commit concurrently.

**Hints (try without first).**
- Walk inside `STM`, accumulating reads into the transaction's read set.

**Self-check.**
- [ ] You can describe when two `insert`s conflict vs commit in parallel.
- [ ] You can identify the "long read set" problem when traversal races
      with head insertions.

---

### Task 13: Conditional Consumer with TVar Status

**Problem.** Job queue where each job has status `Pending | Running |
Done | Failed`. A worker pool picks `Pending`, atomically flips to
`Running`, processes outside STM, then flips to `Done` or `Failed`.

**Constraints.**
- Pick must atomically transition Pending → Running for exactly one worker.
- Side-effectful processing happens *outside* the transaction.
- Monitoring reads see consistent snapshots.

**Hints (try without first).**
- `readTVarIO` for monitoring (snapshot, no transaction).
- Worker picks via `dequeueWhen (\j -> status j == Pending)`.

**Self-check.**
- [ ] No two workers ever run the same job.
- [ ] You can explain why side effects belong outside the transaction.

---

### Task 14: Bank Reconciliation

**Problem.** Ledger of 50 accounts. Run random transfers concurrently
with a reconciliation transaction that reads all 50 balances and writes
their sum to an audit TVar. Verify the audit value is consistent with
some sequential ordering of transfers.

**Constraints.**
- Reconciliation reads all 50 TVars.
- Transfers continue while reconciliation runs.
- Use STM's snapshot semantics; no locks.

**Hints (try without first).**
- Expect reconciliation to abort and retry under contention; measure it.

**Self-check.**
- [ ] You can describe the "long-running transaction starves" mode.
- [ ] You can identify two mitigations (read-only optimization or
      periodic-checkpoint snapshot).

---

### Task 15: STM-Backed Pub-Sub

**Problem.** Broadcast channel: producers publish, N subscribers each
read every message in order. Each subscriber has its own cursor;
messages are GC'd once all subscribers pass them.

**Constraints.**
- A subscribed read blocks (`retry`) when cursor is at head.
- Publish is a single transaction.
- GC happens lazily on publish or read.

**Hints (try without first).**
- A `TVar` of (pending list + last index); subscribers as `TVar Int` cursors.

**Self-check.**
- [ ] Slow subscribers don't block publishers (or you have a bounded policy).
- [ ] You can describe the memory profile under a slow subscriber.

---

### Task 16: Read-Only Transaction Optimization

**Problem.** Add a read-only `contains` to Task 12 that does not
register for retry on conflicts — it simply re-runs. Measure throughput
improvement under read-heavy workload.

**Constraints.**
- Read-only path must not record into any write set.
- Correctness must hold: no torn reads, no stale "not found".

**Hints (try without first).**
- GHC STM auto-detects read-only transactions. Verify with profiling.

**Self-check.**
- [ ] You can name two STM implementations and how each handles this.

---

### Task 17: STM-Friendly Cache

**Problem.** In-process cache with `get`, `put`, `invalidate`. Single
TVar wrapping a persistent map. Add "single-flight": if two threads
`get` the same missing key, only one loads, the other waits.

**Constraints.**
- Single-flight uses STM, not a separate lock.
- Cache remains consistent under heavy concurrent reads and invalidations.

**Hints (try without first).**
- In-flight entries are `Pending (TVar (Maybe v))` in the map.
- Waiters `retry` on `Nothing` and wake when the loader writes `Just v`.

**Self-check.**
- [ ] No duplicate loads under contention.
- [ ] Invalidation during a load is handled cleanly with a documented policy.

---

## Advanced

These tasks open the hood. You implement, measure, and analyze.

### Task 18: Toy TL2 Implementation

**Problem.** Implement a simplified TL2 STM. Provide `Ref`, `atomic`,
`read`, `write`. Use a global version clock, per-location version
stamps, read-set validation at commit, and a write-set held-locks
phase.

**Constraints.**
- Reads record location + version seen.
- Writes go to a thread-local write set; locations are modified only at commit.
- Commit: lock write set, validate read set, bump clock, install writes
  with new version, release locks. Abort on validation failure.

**Hints (try without first).**
- Global clock is one atomic counter.
- Per-location lock + version share a 64-bit word: low bit lock, high bits version.
- Read validation: current version ≤ my read version and not locked by others.

**Self-check.**
- [ ] Two non-conflicting transactions commit in parallel.
- [ ] A read-write conflict aborts the loser and it retries.
- [ ] You can explain why reading a write-locked location must abort
      even when the visible value is consistent.

---

### Task 19: Reproduce a Retry Storm, Then Fix It

**Problem.** Construct a scenario where a "long" transaction (touching
N TVars) repeatedly aborts because short transactions keep mutating
its read set. Make it deterministic. Then fix it.

**Constraints.**
- Reproducer must show at least 10 aborts per successful commit.
- Fix must not be "use a lock" — keep STM and apply a real mitigation.

**Hints (try without first).**
- Mitigations: split the long transaction into idempotent chunks; add
  an explicit serialization TVar; back off with jitter on abort.

**Self-check.**
- [ ] You can show before/after metrics: aborts per commit, p99 latency.
- [ ] You can articulate the trade-off between read-set size and conflicts.

---

### Task 20: Snapshot-Isolation Linked List

**Problem.** Extend Task 12 to support snapshot-isolation reads
(consistent point-in-time view while writers commit). Compare a
copy-on-write whole-list TVar versus per-node TVars with read-set
tracking.

**Constraints.**
- Both implementations pass identical correctness tests.
- Benchmark both under a 95%/5% read/write workload.

**Hints (try without first).**
- Copy-on-write: TVar of an immutable list, writers replace the whole thing.
- Per-node: STM snapshot semantics already give this; read-set growth is the cost.

**Self-check.**
- [ ] You can predict and measure crossover points.
- [ ] You can explain which design Clojure refs match and which Haskell STM matches.

---

### Task 21: Benchmark STM vs Locks Under Varying Contention

**Problem.** Build a benchmark harness running the same workload
(counter, bounded queue, linked list) under three backends: mutex,
STM, lock-free atomics. Sweep contention from 1 worker to 4×cores.
Plot throughput and p99 latency.

**Constraints.**
- Same data structure semantics across backends.
- Sweep at least four contention levels.
- Measure throughput and tail latency.

**Hints (try without first).**
- Pin threads to cores. Warmup before measurement.
- Watch for allocator/GC interference (JVM/CLR).

**Self-check.**
- [ ] You can identify ranges where STM beats locks and where it loses.
- [ ] You can explain *why* in terms of cache behavior, abort cost, lock convoying.

---

### Task 22: Nested Transactions

**Problem.** Implement `subatomically :: STM a -> STM (Either Abort a)`
in your toy TL2 from Task 18. The inner can abort independently
without aborting the outer. Use it for "try this, fall back to that"
distinct from `orElse`.

**Constraints.**
- Outer sees inner's writes only on inner commit.
- Outer's read set must include inner's reads (otherwise isolation breaks).

**Hints (try without first).**
- Inner subtxn has its own write set; merge on commit, discard on abort.

**Self-check.**
- [ ] You can articulate the difference between `orElse` and a nested subtxn.
- [ ] Aborted inner subtxn leaks no reads or writes.

---

### Task 23: Multi-Version Concurrency in STM

**Problem.** Replace single-version TVars in your toy TL2 with bounded
version history (say, 4 versions). Read-only transactions pick an
old-enough version and never abort. Measure impact on read-mostly
workloads.

**Constraints.**
- Version history is bounded; old versions are GC'd when no live
  transaction can read them.
- Write-write conflicts still abort.

**Hints (try without first).**
- Track each transaction's start timestamp; read-only reads the latest
  version with timestamp ≤ its start. This is Clojure's design.

**Self-check.**
- [ ] Read-only transactions effectively never abort.
- [ ] You can predict and measure memory overhead.

---

### Task 24: STM with Side Effects via I/O Hooks

**Problem.** Design a "deferred side effect" mechanism: the transaction
queues side effects to run *only if* it commits. Implement it on toy
TL2 or on Haskell STM with a `TVar [IO ()]`.

**Constraints.**
- Side effects don't run on aborted transactions.
- Side effects run after commit, before the caller resumes.
- Exceptions in side effects don't undo the commit.

**Hints (try without first).**
- `onCommit :: IO () -> STM ()` enqueues into a thread-local list; an
  outer wrapper runs them after commit succeeds.

**Self-check.**
- [ ] You can describe two real systems (one DB, one STM library) with
      this pattern and how they spell it.

---

### Task 25: Visible Read Tracking

**Problem.** In a toy STM, implement "visible reads": when transaction
A reads, transaction B about to write must explicitly invalidate A.
Compare with invisible-read TL2 on a many-readers / rare-writers
workload.

**Constraints.**
- Visible reads require per-location reader sets; document the bookkeeping cost.
- Aborts on the reader are triggered by the writer's commit, not at the
  reader's own commit.

**Hints (try without first).**
- Per-location: a list (or bitmap) of currently-reading transactions.

**Self-check.**
- [ ] You can identify which workloads visible reads win and lose.
- [ ] You can explain why TL2 and most production STMs choose invisible reads.

---

## Capstone

These are larger, design-heavy exercises. Treat them as small projects.

### Capstone A: Financial Ledger Library

**Problem.** Build a realistic financial ledger on STM. Support
accounts with balance + currency; multi-leg postings (debit-credit
balances to zero per currency); idempotency keys against double-posting;
audit log of committed entries; queryable balance-as-of-time.

**Constraints.**
- Every posting is a single STM transaction.
- Audit log appended atomically with balance updates.
- Idempotency-key check happens inside the transaction.
- Provide a stress test running 10k concurrent postings verifying totals.

**What "done" looks like.** A reviewer reads your code in 30 minutes
and understands the data model. Your stress test passes. You have a
throughput benchmark and a written description of failure modes (long
transactions, audit-log contention) and scaling next steps. You can
defend why STM is the right tool here vs a relational DB or event-
sourced design — including the case where it isn't.

**Hints (try without first).**
- A "transaction" in your domain is *not* the same as one in STM —
  name them carefully (`Posting` vs `atomically`).
- Idempotency: `TVar (Set IdempotencyKey)` checked at posting start.
- Audit log: `TVar (Seq Entry)` appended in the same atomically block.

**Self-check.**
- [ ] Invariants hold under stress.
- [ ] You have a benchmark and a written analysis.
- [ ] You can explain contention hotspots and what you'd shard at scale.

---

### Capstone B: Inventory Reservation Service

**Problem.** Service holding inventory counts per SKU. Support
`reserve(sku, qty, ttl)`, `confirm(reservationId)`, `release(reservationId)`.
Reservations expire automatically. All operations atomic; available
count never goes negative.

**Constraints.**
- Reservations tracked in STM.
- Expiry sweeper releases stale reservations atomically.
- Service exposes HTTP or gRPC; the transactional core is STM-internal.

**What "done" looks like.** Two concurrent reservations for the last
unit and exactly one wins. Expired reservation returns to the pool
atomically. Load test under realistic SKU fan-out (long tail + a few
hot SKUs). A design note on multi-node scaling — correctly noting STM
gives single-node atomicity, not distributed atomicity.

**Hints (try without first).**
- Per-SKU TVar of `(available, Map ReservationId (Qty, Expiry))`.
- Sweeper is one periodic transaction per SKU, or a global expiry index.
- Don't run HTTP handlers inside `atomically` — commit, then respond.

**Self-check.**
- [ ] No oversell under any concurrency.
- [ ] Expiry sweeper doesn't starve under load.
- [ ] You can describe the path to scaling beyond one node.

---

### Capstone C: "Should We Use STM?" Decision Memo

**Problem.** Pick a realistic codebase — backend service, game server,
financial system. Write a 1500-2000 word memo titled "Should we use
STM for X?" Identify one concrete subsystem, characterize its
concurrency requirements, evaluate STM against alternatives (mutexes,
channels, actors, lock-free), recommend an answer with justification.

**Constraints.**
- Memo names a specific subsystem and a specific data structure or invariant.
- Quantifies: throughput needed, contention, transaction duration,
  read/write ratio.
- Considers operational concerns: language support, debugging,
  observability, team familiarity.
- Ends with a clear recommendation and one paragraph on "what we'd
  reconsider if X changed."

**What "done" looks like.** A senior engineer reads it and says "I
could take this to design review." It doesn't handwave. It doesn't say
"STM is good because composable" without showing where the composition
pays off here. It names at least one failure mode that would bite the
team and one operational cost (e.g. "GHC STM is great but our service
is in Go where the mature STM library is unmaintained").

**Hints (try without first).**
- The honest answer is often "no" — a good memo can recommend against STM.
- Concrete numbers beat adjectives. "200 transfers/sec peak" beats "high".

**Self-check.**
- [ ] Recommendation has a defensible quantitative argument.
- [ ] You consider at least three alternatives.
- [ ] You name at least one operational risk.

---

### Capstone D: Compare Two STM Implementations Side-by-Side

**Problem.** Pick two STM implementations from different ecosystems
(e.g. GHC STM + Clojure refs, or scala-stm + a Rust STM crate).
Implement the same non-trivial workload (e.g. multi-account ledger
with audit log) in both. Compare on API ergonomics, performance under
three contention profiles, debugging support, and ecosystem integration.

**Constraints.**
- Same observable behavior across both.
- Same workload methodology.
- Report includes at least three numerical comparisons and one
  qualitative comparison per axis.

**What "done" looks like.** The report is useful to a team choosing
between the two for a real project. It names ecosystem-specific
surprises (Clojure's `commute` vs `alter`, Haskell's `unsafeIOToSTM`,
scala-stm's implicit txn). Benchmark code is committed and reproducible.

**Hints (try without first).**
- Same workload = same operation counts, same data shape, same invariants.
- Don't compare on different hardware; pin both to the same machine.

**Self-check.**
- [ ] Numbers are reproducible.
- [ ] Qualitative claims are backed by code references.
- [ ] You'd be comfortable presenting the report.

---

## Sample Solutions

Sketches for selected tasks. Intentionally not complete — fill in the gaps.

### Sample Solution: Task 1 (Haskell atomic counter)

```haskell
import Control.Concurrent.STM
import Control.Concurrent.Async (replicateConcurrently_)
import Control.Monad (replicateM_)

main :: IO ()
main = do
  counter <- newTVarIO (0 :: Int)
  replicateConcurrently_ 1000 $
    replicateM_ 1000 $
      atomically $ modifyTVar' counter (+1)
  finalValue <- readTVarIO counter
  print finalValue   -- 1000000
```

`modifyTVar'` is strict; the non-strict version can build thunks under
contention. `readTVarIO` is a snapshot read with no transaction overhead.

---

### Sample Solution: Task 6 (`orElse` choice)

```haskell
import Control.Concurrent.STM

takeEither :: TVar [Int] -> TVar [Int] -> STM Int
takeEither qA qB = takeFrom qA `orElse` takeFrom qB
  where
    takeFrom q = do
      xs <- readTVar q
      case xs of
        []    -> retry
        (h:t) -> do writeTVar q t; return h
```

The left branch's `retry` causes the runtime to try the right branch.
If both retry, the composed transaction blocks on the union of both
TVars — a write to either wakes it.

---

### Sample Solution: Task 8 (bounded queue, sketch)

```haskell
import Control.Concurrent.STM
import qualified Data.Sequence as Seq
import Data.Sequence (Seq, (|>))

data BQueue a = BQueue
  { bqContents :: TVar (Seq a)
  , bqCapacity :: Int
  }

newBQueue :: Int -> STM (BQueue a)
newBQueue cap = do
  c <- newTVar Seq.empty
  return $ BQueue c cap

enqueue :: BQueue a -> a -> STM ()
enqueue (BQueue c cap) x = do
  s <- readTVar c
  if Seq.length s >= cap
    then retry
    else writeTVar c (s |> x)

dequeue :: BQueue a -> STM a
dequeue (BQueue c _) = do
  s <- readTVar c
  case Seq.viewl s of
    Seq.EmptyL    -> retry
    h Seq.:< rest -> do writeTVar c rest; return h
```

For production, cache the length in its own TVar to avoid O(log n)
length on every transaction.

---

### Sample Solution: Task 18 (toy TL2, structural sketch)

```
GlobalClock = atomic u64
Ref<T> { versionAndLock: atomic u64; value: T }   // hi 63 = version, lo 1 = lock
ThreadLocal { readVersion; readSet: Map; writeSet: Map }

atomic(block):
  loop:
    tl.readVersion = GlobalClock.load()
    tl.readSet.clear(); tl.writeSet.clear()
    result = run(block)
    if commit(): return result
    backoff()

read(ref):
  if ref in tl.writeSet: return tl.writeSet[ref]
  v1 = ref.versionAndLock.load()
  if locked(v1) or version(v1) > tl.readVersion: abort()
  value = ref.value
  v2 = ref.versionAndLock.load()
  if v1 != v2: abort()
  tl.readSet[ref] = version(v1); return value

write(ref, x): tl.writeSet[ref] = x

commit():
  for ref in tl.writeSet: tryLock(ref) or abort()
  writeVersion = GlobalClock.fetchAdd(1) + 1
  for (ref, _) in tl.readSet:
    cur = ref.versionAndLock.load()
    if version(cur) > tl.readVersion or (locked(cur) and not lockedByMe(cur)):
      releaseAllLocks(); return false
  for (ref, x) in tl.writeSet:
    ref.value = x
    ref.versionAndLock.store(writeVersion << 1)
  return true
```

Real TL2 adds subtlety (read-after-write, opacity, nesting); this is
the core algorithm.

---

If you can do all of these, you have the STM foundation that a strong
senior engineer would expect.

---

## Related Topics

- [STM — Specification](specification.md)
- [STM — Junior](junior.md)
- [STM — Middle](middle.md)
- [STM — Senior](senior.md)
- [STM — Professional](professional.md)
- [STM — Optimize](optimize.md)
- [STM — Find Bug](find-bug.md)
- [STM — Interview](interview.md)
- Sibling models in this directory:
  - [Threads & Shared Memory](../01-threads-shared-memory/README.md)
  - [Message Passing](../02-message-passing/README.md)
  - [Actor Model](../03-actor-model/README.md)
  - [Async / Event Loop](../04-async-event-loop/README.md)
  - [Dataflow & Reactive](../06-dataflow-reactive/README.md)
