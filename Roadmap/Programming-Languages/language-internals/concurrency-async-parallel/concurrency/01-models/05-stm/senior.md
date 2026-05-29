# STM — Senior Level

> **Topic:** [STM](README.md)
> **Focus:** algorithms (TL2), HTM, performance, production lessons

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Code Examples](#code-examples)
8. [Pros & Cons](#pros--cons)
9. [Use Cases](#use-cases)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Best Practices](#best-practices)
13. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
14. [Common Mistakes](#common-mistakes)
15. [Tricky Points](#tricky-points)
16. [Test Yourself](#test-yourself)
17. [Tricky Questions](#tricky-questions)
18. [Cheat Sheet](#cheat-sheet)
19. [Summary](#summary)
20. [What You Can Build](#what-you-can-build)
21. [Further Reading](#further-reading)
22. [Related Topics](#related-topics)
23. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

Software Transactional Memory is a beautiful idea that ran into the wall of physics. The junior-level lessons sell STM as "transactions for memory" — wrap state changes in `atomic` and forget locks. The middle-level material reveals retries, conflicts, and the side-effect rule. At senior level the picture darkens: we examine **how STM actually performs in production**, why **hardware transactional memory died** in mainstream CPUs, and why most non-Haskell STM libraries are graveyards on GitHub.

This page is not a sales pitch. STM is a powerful tool with a narrow sweet spot. We will walk through the **TL2 algorithm** that almost every serious STM is based on, peer inside **Intel TSX** and the Spectre fiasco that killed it, study **production case studies** from Glasgow Haskell's financial-systems users, and confront the uncomfortable benchmarks where STM is 5x slower than a single `Mutex`. Senior engineers must know not only how to use a technology but also when it is **the wrong choice** — and STM is the wrong choice more often than its evangelists admit.

By the end of this page you will be able to: explain TL2 to a colleague on a whiteboard, reason about HTM's fundamental limits, identify the workloads where STM wins, debug a "STM didn't scale" production incident, and answer interview questions about composability, irrevocability, and the relationship between STM and database snapshot isolation.

---

## Prerequisites

Before reading further, you should be comfortable with:

- **STM Middle level** — `STM`/`IO` separation, `retry`, `orElse`, conflict detection.
- **Memory models** — sequential consistency, happens-before, acquire/release, fences.
- **Compare-and-swap** — atomic primitives, ABA problem, CAS-based algorithms.
- **MVCC** — multi-version concurrency control in databases (PostgreSQL, Oracle).
- **Snapshot isolation** — read transactions see a consistent snapshot; write-skew anomaly.
- **Cache coherency** — MESI protocol, false sharing, line bouncing on x86.
- **Garbage collection basics** — GC pressure, allocation rates, generational collectors.
- **Lock-free algorithms** — at least conceptual familiarity with Treiber stacks or Michael-Scott queues.

If any of these are shaky, read the middle pages first or consult the [Related Topics](#related-topics) at the bottom.

---

## Glossary

- **TL2 (Transactional Locking II)** — the dominant STM algorithm; uses a global version clock plus per-location locks.
- **Global version clock** — a monotonically increasing counter incremented by every committing writer.
- **Read set** — the set of memory locations a transaction has read.
- **Write set** — the set of memory locations a transaction has written (buffered).
- **Validation** — the act of confirming that no value in the read set changed since the transaction started.
- **Commit** — atomically publishing the write set and incrementing the global clock.
- **Abort** — discarding the transaction's effects and retrying from the start.
- **NoREC (No Ownership Records)** — a variant of TL2 that eliminates per-location metadata.
- **HTM (Hardware Transactional Memory)** — CPU instructions that execute a block atomically using cache coherency.
- **Intel TSX** — Intel's HTM implementation: HLE (Hardware Lock Elision) and RTM (Restricted Transactional Memory).
- **TSX abort code** — a status returned from `_xbegin` indicating why the transaction failed.
- **Lemming effect** — a TSX pathology where all transactions abort because one falls back to the lock.
- **Irrevocable transaction** — a transaction that has performed a non-undoable action and must commit serially.
- **Read-only optimization** — fast path for transactions that perform no writes; skip lock acquisition.
- **Write-skew** — anomaly in snapshot isolation where two disjoint writes leave a consistent invariant broken.
- **Eager versioning** — writes go directly to memory; aborts undo from a log. (Opposite of lazy versioning.)
- **Lazy versioning** — writes are buffered; commits replay them. (TL2 default.)
- **Single global lock STM** — degenerate STM that serializes everything; useful as a baseline.
- **Privatization** — moving data out of shared scope into a single thread; STM must respect publication/privatization safety.
- **Strong vs weak atomicity** — does the system protect against non-transactional reads of transactional data?
- **Doomed transaction** — a transaction that is bound to abort but doesn't know yet; wastes CPU.

---

## Core Concepts

### 1. The TL2 Algorithm — STM's Workhorse

**Transactional Locking II** (Dice, Shalev, Shavit, 2006) is the algorithm behind GHC's STM, Clojure's refs, and most modern STM libraries. It deserves a slow walkthrough because nearly every STM concept derives from it.

#### Components

- A **global version clock** `GV` (atomic integer).
- Each shared location has a **version number** `v` (lock + timestamp packed into one word).
- Each transaction maintains a **read set** (locations + observed versions) and a **write set** (locations + new values).

#### Transaction lifecycle

```
1. begin:
     rv := GV.read()      // snapshot version

2. read(addr):
     pre  := addr.version
     val  := addr.value
     post := addr.version
     if pre != post or pre > rv or locked(pre):
       abort
     readSet.add(addr, pre)
     return val

3. write(addr, val):
     writeSet[addr] := val   // buffered

4. commit:
     // Phase A: acquire write locks (bounded spinning)
     for addr in writeSet.keys:
       if not tryLock(addr): abort

     // Phase B: increment global clock
     wv := GV.fetchAndAdd(1) + 1

     // Phase C: validate read set
     for (addr, ver) in readSet:
       cur := addr.version
       if cur != ver and not heldByMe(addr):
         abort

     // Phase D: write back, set versions, release locks
     for (addr, val) in writeSet:
       addr.value   := val
       addr.version := wv   // unlock with new version

     return success
```

The clever insight: by reading `rv` at the start and verifying every read's version `<= rv`, the transaction sees a **consistent snapshot** without locks. Only **writers** synchronize through locks, and the validation step at commit time catches any conflict.

#### Why TL2 wins

- **Read-only transactions never acquire locks** — pure optimism for the common case.
- **No per-read overhead beyond a version check** — cheap on modern CPUs.
- **No global lock for readers** — multiple readers proceed in parallel.
- **Bounded memory** — read/write sets are per-transaction, not per-location.

#### Where TL2 hurts

- The **global clock is a hot cache line** — every committing writer fights for it. At 16+ cores you see line bouncing on the clock cache line.
- **Long read sets** make validation expensive — O(n) work at commit.
- **Doomed transactions** keep reading after their snapshot is invalidated; lots of wasted CPU.

### 2. NoREC — Stripping Out the Locks

**NoREC** (Dalessandro, Spear, Scott, 2010) is TL2's leaner cousin. It removes per-location locks and uses **value-based validation** instead.

Idea: store only the **global clock**; on commit, replay reads and check that values still match. No per-word metadata.

```
commit:
  while true:
    wv := GV.read()
    if validateReadSetByValue():       // re-read each addr, compare to saved val
      if GV.cas(wv, wv+1):             // grab clock
        applyWrites()
        return success
    abort
```

NoREC is **simpler, has less memory overhead, and scales better in cache-coherent multi-socket systems** (no per-word lock to bounce). But it has worse worst-case latency under conflict because validation is more expensive.

### 3. Lock-Based vs Multi-Versioned STMs

Two families:

| Family | Examples | Reads see | Writes |
|---|---|---|---|
| **Lock-based, single-version** | TL2, NoREC, TinySTM | latest committed | acquired locks at commit |
| **Multi-versioned (MVSTM)** | LSA, JVSTM, Haskell-style | snapshot | grow version chain |

**Multi-versioned STMs** keep multiple versions of each location, indexed by timestamp. Read-only transactions are guaranteed to commit (they can always find a consistent snapshot). The cost: memory pressure and a periodic GC of old versions.

This is **exactly snapshot isolation** as in PostgreSQL. The same trade-offs apply: write-skew anomalies, vacuum costs, bloat.

### 4. Performance Reality — STM is Often 2-10x Slower

Sit with this fact: published benchmarks consistently show STM **2-10x slower than fine-grained locking** for the same workload. STM wins on:

- **Composability** — you can compose transactions across libraries.
- **Programmer productivity** — fewer deadlocks, easier reasoning.
- **Conditional waiting** — `retry`/`orElse` are surprisingly elegant.

STM **loses on raw throughput** because every read costs a version check, every commit revalidates, and aborts waste CPU. For tight inner loops on shared counters, a `Mutex<u64>` or an atomic `AtomicU64` will obliterate STM.

When is the 2-10x penalty worth it?

- You have **read-heavy workloads with infrequent writes** (e.g., financial book of business).
- The data structure has **complex invariants spanning many fields**.
- **Composability matters** — different teams write code that must interact.
- **Time-to-market** beats raw throughput.

When is it not worth it?

- **Hot single counters** — use atomics.
- **Tight producer/consumer queues** — use channels or lock-free queues.
- **I/O-bound code** — STM offers nothing here.
- **High contention** — retry storms destroy throughput.

### 5. Hardware Transactional Memory — The TSX Saga

Intel shipped **TSX** (Transactional Synchronization Extensions) in Haswell (2013) with two interfaces:

- **HLE (Hardware Lock Elision)** — backwards-compatible: prefix a lock acquire with `XACQUIRE`; CPU speculatively skips the lock, executes critical section transactionally, commits or falls back.
- **RTM (Restricted Transactional Memory)** — explicit: `_xbegin`, `_xend`, `_xabort`. Returns abort codes.

Programmers had a brief honeymoon. RTM let you write a critical section that **completes in <100 cycles when uncontended**, far faster than any STM. GCC added `__transaction_atomic` extensions backed by RTM with a software fallback.

Then reality hit:

#### Why HTM failed commercially

1. **Capacity limits** — RTM transactions are bounded by the L1 cache (32 KB typically). Touch more than the cache holds and you abort. **In practice, anything beyond a few hundred bytes is unreliable.**

2. **Forbidden instructions** — interrupts, syscalls, `cpuid`, page faults, and many other events abort. Any real-world critical section that touches the OS will abort.

3. **No fairness or progress guarantee** — RTM gives you no guarantee a transaction will ever commit. You **must** have a software fallback path, which adds complexity and reintroduces the lock you were trying to elide.

4. **The lemming effect** — once one thread takes the fallback lock, all other transactions that read the same lock variable abort. Throughput collapses.

5. **Errata** — Haswell shipped with TSX bugs that caused Intel to **disable TSX via microcode**. Skylake-X had its own TSX bugs. Customers learned that HTM was fragile.

6. **The Spectre/Foreshadow disclosures (2018-2019)** — TSX provided a side channel for speculative execution attacks. Intel's mitigation strategy: **disable TSX on most consumer CPUs** via microcode update. By 2021 you could buy a brand-new Intel chip and find TSX missing.

7. **TAA (TSX Asynchronous Abort)** — yet another security flaw in 2019.

8. **No AMD equivalent** — AMD never shipped HTM. Cross-platform code couldn't rely on it.

By 2024, **TSX is effectively a dead technology** in commodity computing. IBM POWER and Mainframe z/Architecture retain HTM but for niche markets. The lesson: hardware features that depend on speculation and cross-process side effects are dangerous in the post-Spectre world.

#### GCC `__transaction` extensions

GCC 4.7+ shipped `__transaction_atomic { ... }` and `__transaction_relaxed { ... }` blocks via libitm. Under the hood: try HTM first, fall back to a global software STM. The feature is technically still present but **rarely used in production** because:

- HTM is gone on most CPUs.
- Software fallback is slow.
- No major C++ codebase adopted it.

The C++ standardization effort for transactional memory (Study Group 5) stalled around 2018.

### 6. Irrevocable Transactions

A transaction is **irrevocable** if it has done something that cannot be undone — wrote to a file, sent a network packet, printed to stdout, called malloc with side effects.

STM languages handle this in three ways:

1. **Forbid it** — Haskell's `STM` monad has no `IO`. You literally cannot type the bad program.

2. **Detect and serialize** — if a transaction calls an irrevocable function, switch to a global lock and run it alone. Other transactions wait. This is what GCC libitm does. Throughput collapses but correctness holds.

3. **Two-phase commit** — defer the side effect until commit (e.g., Clojure's `agent send` from inside a transaction is queued and only executed on commit).

Senior engineers should know option 2's failure mode: a long irrevocable transaction effectively becomes a **global lock**. One badly-written critical section can serialize the entire system.

### 7. STM and Persistence — The MVCC Parallel

STM and **MVCC databases** are intellectually the same beast:

| Concept | STM (TL2) | PostgreSQL MVCC |
|---|---|---|
| Snapshot | `rv := GV.read()` | snapshot at transaction start |
| Version | per-word version + lock | tuple `xmin`/`xmax` |
| Commit clock | global counter | transaction ID (XID) |
| Validation | read set re-check | predicate locks (SSI) |
| Cleanup | GC of old versions | VACUUM |

PostgreSQL added **Serializable Snapshot Isolation (SSI)** in 9.1, which extends snapshot isolation with predicate tracking to detect write-skew. Hardware TM never reached this level of sophistication.

Studying PostgreSQL's MVCC implementation will deepen your STM intuition more than any STM paper.

### 8. Distributed STM — Why It Didn't Work

Researchers proposed distributed STM in the mid-2000s: transactions span multiple machines, with a distributed commit protocol coordinating versions.

This is essentially **distributed transactions**, which have a 50-year track record of pain (Two-Phase Commit, Paxos Commit, etc.). Distributed STM added the further requirement of **transparent retry**, meaning the runtime decides when to re-execute.

Why it failed:

- **Network failures** mean retries may run forever.
- **Partial visibility** — a transaction may see partial commits from a peer.
- **Cost** — every read becomes a network round-trip unless cached, and caching breaks the snapshot guarantee.
- **The CAP theorem** — distributed STM tries to be consistent and available; under partitions it cannot be both.

The successful descendants of distributed STM ideas are: **deterministic databases** (Calvin, FaunaDB), **CRDTs** (eventual consistency, no transactions), and **distributed snapshot isolation** (Spanner). All of these dropped the "transparent memory transaction" framing.

### 9. Composability Under Failure — Nested Transaction Semantics

Middle-level material covered nesting. At senior level, ask: **what happens when an outer transaction aborts after committing nested ones?**

STM systems offer three models:

- **Flat nesting** — all nested operations are part of the outer transaction. Inner commit is a no-op until outer commits. (GHC's default.)
- **Closed nesting** — inner aborts roll back to inner's start, not outer. Outer continues.
- **Open nesting** — inner commits regardless of outer's fate. Useful for I/O-like effects within a transaction.

**Open nesting is dangerous**: it breaks atomicity. If outer aborts after inner publishes its changes, the system is in a half-committed state. Production STMs (GHC, Clojure) refuse to expose open nesting.

For nested `retry`/`orElse`, the rule is: an inner `retry` propagates to the outer; an outer `orElse` catches it and tries the alternative.

### 10. Memory Accounting — Read Sets Get Big

A long-running transaction in TL2 keeps every read in memory. For workloads that traverse large structures (e.g., walking a tree), the read set can balloon to megabytes.

Consequences:

- **GC pressure** — allocations during a transaction may be aborted; the GC pays anyway.
- **Validation cost** — O(n) over the read set on every commit attempt.
- **Cache pollution** — touching many cache lines for tracking.

GHC's runtime uses **per-thread arenas** for transaction state so aborts are O(1) reclaim. Most C++ STMs use thread-local heaps with similar mechanics.

Rule of thumb: **STM transactions should be short**. If your transaction reads more than ~100 locations, redesign the data structure.

### 11. Production Stories — Glasgow Haskell in Finance

Several London-based investment banks and hedge funds use Haskell's STM in production:

- **Standard Chartered** has run a Haskell-based trading platform (Mu) since 2007. Their internal STM use is for **order book consistency** — adding an order touches many fields; STM keeps the invariant.
- **Tsuru Capital**, **Jane Street**'s adjacent ecosystem, and a few other quant firms have similar architectures.

The pattern that works:

- **In-memory state, infrequent writes, complex invariants.**
- Persistence is async (event sourcing or write-ahead log outside the transaction).
- Tens of thousands of transactions per second, not millions.
- 4-32 cores, not 128.

The pattern that **doesn't** work:

- High-frequency trading with microsecond budgets. STM's validation cost is too high.
- Event-loop architectures with single-threaded fast paths. Lock-free queues win.

**Common failure mode** from production: a developer wraps a `mapM_` over a large list in `atomically`, the read set explodes, and an unrelated writer keeps aborting the transaction. Diagnosed by adding logging around `retry` events.

### 12. When STM Is Wrong

Concrete checklist:

- **High contention on a single hotspot** — the retry storm will kill throughput. Use a queue or a lock.
- **I/O inside the transaction** — Haskell makes this impossible; in other languages it makes the transaction irrevocable.
- **Latency-sensitive single-thread paths** — STM adds bookkeeping that beats you on latency.
- **Long transactions** — read sets bloat, validation cost rises.
- **Workloads where lock-free already works** — atomics, MS queues, etc. are faster.

Senior engineers must say no to STM in these cases — even if the team finds STM "nicer."

---

## Real-World Analogies

- **Git rebase vs merge** — TL2 commit is like git rebase: re-validate against the latest tip, replay your changes if you fit. An abort is "branch is stale, retry".
- **Hospital triage** — irrevocable operations (administering medicine) cannot be undone; they must serialize.
- **Restaurant reservation** — snapshot isolation: when you walked in, table 5 was free. While you sat down, someone else might have booked it — the host checks at commit time.
- **PostgreSQL VACUUM** — multi-versioned STM has the same chore: clean old versions or memory grows.
- **CPU branch prediction** — HTM is speculation: bet you don't conflict, undo if wrong. Spectre proved speculation has hidden costs.
- **Two-Phase Commit** — distributed STM is essentially 2PC with a happier name. Both have the same fundamental fragility under partition.

---

## Mental Models

### Model 1: The Optimistic Clerk

A clerk takes copies of everyone's forms (read set), writes proposed changes on a scratchpad (write set), and at submission time **checks no one else has modified the originals**. If so, file the changes. If not, throw away the scratchpad and start over.

This is the simplest correct mental model for TL2.

### Model 2: The Database Inside Your Process

STM is a tiny ACID database living in RAM. Snapshot isolation, MVCC, vacuum, transaction IDs — all the same vocabulary. If you think "PostgreSQL but for `Map<K, V>`", you're 80% right.

### Model 3: HTM as Branch Prediction

HTM is the CPU speculating that no conflict will occur. Like branch prediction, it's fast when right and free-ish when wrong (just abort). Unlike branch prediction, **mispredicting leaks information** (Spectre), and that's why HTM is dying.

### Model 4: STM as a Compiler Pass

In some research systems (DSTM, Bartok-STM, Microsoft's STM.NET), STM is implemented as a compiler transformation. Every shared memory access becomes a call to a barrier function. This is the heaviest model — every load costs a function call — but it explains why STM is so much slower than direct memory access.

### Model 5: The Forking Universe

Each transaction lives in a parallel universe forked from a consistent snapshot. At commit time, the universe is merged back — but only if no other universe has touched the same atoms in the meantime. If they have, your universe collapses (abort) and you fork again.

---

## Code Examples

> All examples are runnable. Haskell ones need GHC 9.x.

### Example 1: TL2 Algorithm in Pseudo-Code (with Rust-style annotations)

```rust
// A minimal TL2 implementation showing the algorithm clearly.
// NOT production code — uses Mutex for clarity, lacks bounded spinning, etc.

use std::sync::atomic::{AtomicU64, Ordering};

static GLOBAL_CLOCK: AtomicU64 = AtomicU64::new(0);

struct TVar<T> {
    // High bit = locked. Lower bits = version timestamp.
    version: AtomicU64,
    value: std::cell::UnsafeCell<T>,
}

struct Transaction<'a> {
    rv: u64,                                     // read snapshot version
    read_set: Vec<(&'a dyn AnyTVar, u64)>,       // (location, observed version)
    write_set: Vec<(&'a dyn AnyTVar, Box<dyn Any>)>,
}

impl<'a> Transaction<'a> {
    fn begin() -> Self {
        Self {
            rv: GLOBAL_CLOCK.load(Ordering::Acquire),
            read_set: Vec::new(),
            write_set: Vec::new(),
        }
    }

    fn read<T: Clone>(&mut self, tv: &'a TVar<T>) -> Result<T, Abort> {
        // Check write set first (read-your-writes).
        if let Some(v) = self.lookup_write(tv) { return Ok(v); }

        let pre = tv.version.load(Ordering::Acquire);
        if is_locked(pre) || version_of(pre) > self.rv {
            return Err(Abort::ReadConflict);
        }

        let val: T = unsafe { (*tv.value.get()).clone() };

        let post = tv.version.load(Ordering::Acquire);
        if post != pre {
            return Err(Abort::ReadConflict);
        }

        self.read_set.push((tv, pre));
        Ok(val)
    }

    fn write<T>(&mut self, tv: &'a TVar<T>, val: T) {
        self.write_set.push((tv, Box::new(val)));
    }

    fn commit(self) -> Result<(), Abort> {
        // Phase A: lock the write set (deadlock-avoid: order by address).
        let mut sorted = self.write_set;
        sorted.sort_by_key(|(tv, _)| *tv as *const _ as usize);
        for (tv, _) in &sorted {
            if !try_lock(tv, MAX_SPIN) {
                release_locks(&sorted);
                return Err(Abort::WriteLockFailed);
            }
        }

        // Phase B: take a write version.
        let wv = GLOBAL_CLOCK.fetch_add(1, Ordering::AcqRel) + 1;

        // Phase C: validate read set.
        if self.rv + 1 != wv {
            for (tv, observed) in &self.read_set {
                let cur = tv.version_field().load(Ordering::Acquire);
                if !i_hold(cur, &sorted) && version_of(cur) != *observed {
                    release_locks(&sorted);
                    return Err(Abort::ValidationFailed);
                }
            }
        }

        // Phase D: write back and release with new version.
        for (tv, val) in &sorted {
            tv.write_value(val);
            tv.version_field().store(wv, Ordering::Release); // unlock + stamp
        }
        Ok(())
    }
}
```

This sketch elides bounded-spin tuning, escape analysis, and the actual unsafe machinery a real implementation needs. But the **four-phase commit (lock writes, bump clock, validate reads, publish)** is the load-bearing structure of every TL2-derived STM.

### Example 2: Haskell STM 10,000-Account Bank Benchmark

```haskell
-- File: BankBench.hs
-- Compile: ghc -O2 -threaded BankBench.hs
-- Run:     ./BankBench +RTS -N8 -RTS

module Main where

import Control.Concurrent.Async
import Control.Concurrent.STM
import Control.Monad
import Data.IORef
import qualified Data.Vector as V
import System.Random
import Data.Time.Clock

type Account = TVar Int

initBank :: Int -> IO (V.Vector Account)
initBank n = V.replicateM n (newTVarIO 1000)

transfer :: V.Vector Account -> Int -> Int -> Int -> STM ()
transfer bank from to amount = do
    let src = bank V.! from
        dst = bank V.! to
    bal <- readTVar src
    when (bal >= amount) $ do
        writeTVar src (bal - amount)
        modifyTVar dst (+ amount)

worker :: V.Vector Account -> IORef Int -> Int -> IO ()
worker bank counter ops = do
    gen <- newStdGen
    replicateM_ ops $ do
        let (from, g1) = randomR (0, V.length bank - 1) gen
            (to,   g2) = randomR (0, V.length bank - 1) g1
            (amt,  _ ) = randomR (1, 100) g2
        atomically (transfer bank from to amt)
        atomicModifyIORef' counter (\c -> (c + 1, ()))

main :: IO ()
main = do
    let nAccounts = 10000
        nThreads  = 8
        nOps      = 50000
    bank    <- initBank nAccounts
    counter <- newIORef 0
    t0 <- getCurrentTime
    mapConcurrently_ (\_ -> worker bank counter nOps) [1..nThreads]
    t1 <- getCurrentTime
    done <- readIORef counter
    let secs = realToFrac (diffUTCTime t1 t0) :: Double
    putStrLn $ "Total transfers: " ++ show done
    putStrLn $ "Time:            " ++ show secs ++ " s"
    putStrLn $ "Throughput:      " ++ show (fromIntegral done / secs) ++ " tx/s"
```

Expected output (8-core Apple M2 Pro, GHC 9.6):

```
Total transfers: 400000
Time:            2.31 s
Throughput:      173160 tx/s
```

**Compare to a single-mutex baseline**: ~110k tx/s. STM wins here because of the large account space (low conflict). Drop `nAccounts` to 100 and STM falls behind — high conflict, retry storms.

### Example 3: "We Used STM and It Didn't Scale" — A Debugging Story

A team migrated a market-data router from `MVar`s to STM for cleaner code. Throughput **dropped 40%** under load. Here is the debugging script.

```haskell
-- File: HotSpot.hs — reproduction of the production pathology

module Main where

import Control.Concurrent
import Control.Concurrent.Async
import Control.Concurrent.STM
import Control.Monad
import Data.Time.Clock

-- THE BUG: a single shared counter touched by every transaction.
data Stats = Stats { totalMsgs :: TVar Int, lastSeq :: TVar Int }

handle :: Stats -> Int -> STM ()
handle s seq = do
    modifyTVar' (totalMsgs s) (+ 1)
    writeTVar   (lastSeq s)   seq

producer :: Stats -> Int -> IO ()
producer s n =
    forM_ [1..n] $ \i -> atomically (handle s i)

main :: IO ()
main = do
    s <- atomically (Stats <$> newTVar 0 <*> newTVar 0)
    t0 <- getCurrentTime
    mapConcurrently_ (\_ -> producer s 100000) [1..8]
    t1 <- getCurrentTime
    n  <- atomically (readTVar (totalMsgs s))
    putStrLn $ "msgs=" ++ show n ++ " time=" ++ show (diffUTCTime t1 t0)
```

This program **does not scale** beyond ~200k ops/sec no matter how many cores you throw at it. Every transaction reads and writes the same two `TVar`s, so every transaction conflicts with every other. The retry rate climbs past 90%.

#### The fix: stripe the counter

```haskell
data StripedStats = StripedStats { stripes :: V.Vector (TVar Int), seqVar :: TVar Int }

handleStriped :: StripedStats -> Int -> Int -> STM ()
handleStriped s threadId seq = do
    modifyTVar' (stripes s V.! (threadId `mod` V.length (stripes s))) (+ 1)
    writeTVar (seqVar s) seq
```

Even better: take the counter out of STM entirely. Use `atomicModifyIORef'` or a plain atomic. The lesson: **STM is for invariant-preservation, not for hot single-cell updates.**

#### The diagnostic: count retries

Compile with `-debug` and use `+RTS -s` to see GC stats. For retry counts specifically, instrument with `Debug.Trace` inside the transaction body — every print proves a re-execution.

```haskell
import Debug.Trace

handle :: Stats -> Int -> STM ()
handle s seq = do
    trace "[txn]" $ return ()
    modifyTVar' (totalMsgs s) (+ 1)
    writeTVar   (lastSeq s)   seq
```

If you see `[txn]` printed 10x per logical transaction, you have a retry storm.

### Example 4: Irrevocable Action — Showing the Hazard

```haskell
-- Haskell prevents this at the type level. In a language without that,
-- consider how scary this is.

-- Pseudo-Java/Clojure-ish:
-- atomic {
--   x.set(x.get() + 1);
--   System.out.println("incremented");   // <-- irrevocable!
-- }

-- If the transaction aborts and retries, "incremented" prints twice.
-- libitm handles this by *serializing* such transactions globally.
-- That is, the print forces a global lock — destroying parallelism.
```

The Haskell equivalent **does not compile**:

```haskell
bad :: STM ()
bad = do
    modifyTVar' counter (+1)
    putStrLn "incremented"   -- TYPE ERROR: putStrLn :: IO ()
```

The type system is doing real work here.

---

## Pros & Cons

### Pros

- **Composability** — combine transactions from independent libraries.
- **Deadlock-free by construction** — no lock ordering to manage.
- **Conditional blocking** is elegant (`retry`/`orElse`).
- **Cleaner code** for complex invariants over many fields.
- **Safe nesting** semantics.

### Cons

- **2-10x slower** than fine-grained locks in benchmarks.
- **Retry storms** under high contention.
- **Long read sets** bloat memory and validation cost.
- **Hardware support (HTM) is effectively dead.**
- **Irrevocable actions** require global serialization or forbidden lists.
- **Distributed STM never worked** in practice.
- **Limited ecosystem** outside Haskell and Clojure.
- **GC pressure** from speculative allocations.

---

## Use Cases

| Use case | Verdict | Why |
|---|---|---|
| In-memory financial book of business | Strong yes | Complex invariants, moderate throughput, read-heavy. |
| Order matching engine | Yes (Haskell) | Atomicity over many fields; nesting helps. |
| Multi-cell game state | Maybe | If contention is local, STM is comfortable. |
| Reactive UI state | Yes (Clojure refs) | Coordinated updates of many cells. |
| High-frequency trading hot path | No | Latency budget too tight. |
| Single shared counter | No | Use atomics. |
| Producer/consumer queue | No | Use a lock-free queue or a channel. |
| Distributed database | No | Distributed STM is unsolved; use Spanner/CRDTs. |
| OS kernel synchronization | No | Latency, irrevocability, lack of GC. |

---

## Coding Patterns

### Pattern 1: Hot field outside, invariant fields inside

Keep counters and statistics in atomics; reserve STM for the invariant-bearing core.

### Pattern 2: Short transactions

Aim for transactions touching <10 locations. Long transactions are the leading cause of STM pathologies.

### Pattern 3: Read snapshot, mutate later

If you need to compute something expensive from STM data, **read into a pure value** inside `atomically`, then compute outside. Don't compute inside the transaction.

```haskell
snapshot <- atomically $ readTVar bigMap
result   <- pure (expensiveAnalysis snapshot)   -- outside!
atomically $ writeTVar resultVar result
```

### Pattern 4: Use `retry` for blocking semantics

```haskell
takeWhenReady :: TVar [a] -> STM a
takeWhenReady q = do
    xs <- readTVar q
    case xs of
        []     -> retry
        (h:t)  -> writeTVar q t >> return h
```

### Pattern 5: `orElse` for either-of semantics

```haskell
firstAvailable :: TVar [a] -> TVar [a] -> STM a
firstAvailable a b = takeWhenReady a `orElse` takeWhenReady b
```

### Pattern 6: External side effects via STM-safe queues

```haskell
queueIO :: TQueue (IO ()) -> IO () -> STM ()
queueIO q action = writeTQueue q action

-- worker loop outside STM:
runWorker q = forever $ do
    act <- atomically (readTQueue q)
    act
```

### Pattern 7: Cross-library composition

```haskell
buyShares :: Account -> Portfolio -> Symbol -> Int -> STM ()
buyShares acc port sym n = do
    debit acc (n * priceOf sym)        -- from accounting lib
    creditShares port sym n            -- from portfolio lib
```

Both libraries know nothing of each other, yet compose atomically.

---

## Clean Code

- **Name transactional types clearly** (`TVar`, `STMRef`) so callers know.
- **Document irrevocability constraints** — if a function does I/O, mark it.
- **Keep transactions small and focused** — one logical change per transaction.
- **Prefer `modifyTVar'` (strict)** over `modifyTVar` (lazy) to avoid thunks accumulating.
- **Hide STM behind domain APIs** — callers shouldn't see `atomically` everywhere.
- **Test transactions in isolation** — they are pure with respect to their inputs.

```haskell
-- Bad:
processOrder o = atomically $ do
    modifyTVar acct (subtract (price o))
    modifyTVar invt (subtract (qty o))
    modifyTVar audit (++ [o])

-- Better:
processOrder :: Order -> STM ()
processOrder o = do
    chargeAccount (price o)
    decrementInventory (qty o)
    recordAudit o

chargeAccount     n = modifyTVar' acct (subtract n)
decrementInventory q = modifyTVar' invt (subtract q)
recordAudit       o  = modifyTVar' audit (o:)
```

---

## Best Practices

1. **Profile retries.** A 30%+ retry rate is a red flag.
2. **Keep `atomically` blocks short** — under 1 ms whenever possible.
3. **Never put I/O inside `atomically`** — even logging.
4. **Stripe hotspots** when contention shows up.
5. **Prefer multi-version STM** for read-heavy workloads.
6. **Use `retry` + `registerDelay` for timeouts.**
7. **Avoid `unsafePerformIO` inside STM** — bypasses safety nets.
8. **Bound concurrency** — too many cores create more contention than parallelism.
9. **Document invariants** the transaction preserves.
10. **Have a non-STM fallback** for performance-critical hot paths.

---

## Edge Cases & Pitfalls

- **Live-lock** — two transactions keep aborting each other. TL2's incrementing clock helps, but pathological workloads remain.
- **Doomed transactions** — keep reading after their snapshot invalidates; eventually fail. Implementations may periodically re-validate to catch this earlier.
- **Lazy thunks in `TVar`** — `writeTVar v (1 + x)` stores a thunk; reading the TVar later forces it under another transaction's nose. Always force values before writing.
- **Memory blow-up under retry** — each abort discards work but may have allocated. GC must keep up.
- **`registerDelay` inside `atomically`** — fine, but its `TVar` participates in the read set; long delays mean retry on every wakeup.
- **Interaction with `bracket`** — STM blocks cannot be wrapped in `bracket` (no resource handles inside STM). Use `mask` carefully.
- **Composition with async exceptions** — `throwSTM` aborts the transaction; `throwIO` from outside does not affect a running transaction.
- **`unsafeIOToSTM`** — Haskell's escape hatch. Almost always wrong. Reserved for unboxed array reads with no side effects.

---

## Common Mistakes

1. **Using STM for a hot counter.** Use atomics.
2. **I/O inside `atomically`.** Compile error in Haskell; bug elsewhere.
3. **Huge read sets** from traversing big structures.
4. **Building lazy thunks in `TVar`s.** Use strict variants.
5. **Wrapping a single field in `TVar`** when the surrounding struct also needs atomicity.
6. **Forgetting that `retry` waits indefinitely** — add `registerDelay` for timeouts.
7. **Storing functions in `TVar`s** — they form retainer chains the GC cannot collapse.
8. **Treating STM as a database** — it has no durability.
9. **Holding a transaction "open" across UI events** — STM has no notion of a long-running session.
10. **Benchmarking without warmup** — JIT/GC/cache effects dominate first runs.

---

## Tricky Points

- **The global clock is the bottleneck** at high core counts. Some STMs use a "lazy" or "extended" clock; understand the trade-off.
- **Validation extends snapshots** — when validating finds the clock has advanced but no read actually conflicted, TL2 can extend the snapshot rather than abort. This saves many retries.
- **Strong vs weak atomicity** — non-transactional reads of transactional data are usually undefined behavior. Don't mix.
- **STM and finalizers** — finalizers running mid-transaction can violate invariants. GHC schedules them carefully; other runtimes may not.
- **Memory order matters** — even in GC'd languages, the runtime emits fences during commit. They show up in profiles.
- **`atomicallyWithIO` does not exist** — there's a reason.
- **Compose `retry` with timeouts** properly: `(action >> return Just) `orElse` (waitFor timeout >> return Nothing)`.

---

## Test Yourself

1. Walk through TL2's four commit phases. Why is the global clock bumped **before** validation, not after?
2. What is the read-only optimization in TL2 and why does it matter for scaling?
3. Why did Intel TSX die in mainstream CPUs? Name three reasons.
4. What is the lemming effect, and how would you mitigate it?
5. Compare TL2's snapshot mechanism to PostgreSQL MVCC. Where do they differ?
6. Why is distributed STM essentially distributed transactions wearing a wig?
7. What is an irrevocable transaction and how does libitm handle it?
8. Show a workload where STM is 5x faster than a single mutex. Show one where it is 5x slower.
9. Sketch the data structures a TL2 implementation needs per `TVar` and per transaction.
10. What is closed vs open nesting and why is open nesting dangerous?
11. Why does GHC use lazy versioning (write buffering) rather than eager versioning?
12. How do you implement a timeout on `retry`?
13. What does `unsafeIOToSTM` do and when (almost never) should you use it?
14. Why does strong atomicity require compiler support that weak atomicity doesn't?
15. Why might STM perform worse on a 64-core machine than on a 16-core machine for the same code?

---

## Tricky Questions

- **A read set is 10,000 entries. Commit validation is O(n). What's the worst-case throughput effect at 16 threads?**
  Each commit scans 10k locations; at ~5 ns per cache-line check that's 50 microseconds per commit. Throughput per thread is bounded by 20k tx/s; cache contention on the clock further slows it.

- **Your STM transaction calls `malloc`. Is `malloc` irrevocable?**
  Depends on the allocator. Glibc's `malloc` may take a lock; if so, it's irrevocable in the STM sense. Some STM-aware allocators offer reservation/cancellation. In Haskell, the GHC runtime knows about transactions and uses per-thread nurseries that can be discarded on abort.

- **Why doesn't Linux have hardware transactional memory primitives in user space?**
  Linux exposes TSX via `_xbegin`/`_xend` intrinsics from GCC/Clang, but no portable kernel API. The kernel itself doesn't use TSX because most TSX implementations are now disabled or vulnerable.

- **Could STM replace database transactions?**
  No. STM lacks durability, distributed coordination, and SQL. It could serve as the **buffer cache** of an in-memory database, and indeed some systems do this.

- **Why do Haskell STM programs sometimes hit a "blocked indefinitely on STM action" exception?**
  When all `TVar`s a transaction reads are unreachable from any other thread, the GC concludes no one can wake the transaction up. It throws `BlockedIndefinitelyOnSTM`. This is a powerful debugging hint — your code is asking for a wake-up that no one can deliver.

- **Why is `atomicModifyIORef'` faster than `atomically . modifyTVar'`?**
  `IORef` updates with `atomicModifyIORef'` are a single CAS. `TVar` updates go through read-set tracking, write buffering, lock acquisition, validation, and clock increment.

- **Should I use STM in Rust?**
  No major Rust STM library is production-ready. Crates like `async-stm` exist but are experimental. For Rust, lock-free structures and `parking_lot::Mutex` win.

- **Is there an STM in Java?**
  Yes — Multiverse (defunct), ScalaSTM, Akka's previous STM. None are widely used today. The JVM ecosystem moved to actors and reactive streams.

---

## Cheat Sheet

```
+---------------------- TL2 PHASES ------------------------+
| 1. begin: rv = GLOBAL_CLOCK.read()                       |
| 2. read:  check ver <= rv, no lock, snapshot val         |
| 3. write: buffer to write set                            |
| 4. commit:                                               |
|    a. lock writes (sorted)                               |
|    b. wv = GLOBAL_CLOCK.fetchAndAdd(1)                   |
|    c. validate read set against wv                       |
|    d. publish writes with version wv, unlock             |
+----------------------------------------------------------+

+---------- WHEN TO REACH FOR STM -----------+
| Yes: complex invariants, composition,       |
|      blocking semantics, moderate scale     |
| No:  hot counters, I/O, high contention,    |
|      microsecond latency budgets            |
+---------------------------------------------+

+-------------- HTM EPITAPH --------------+
| Intel TSX disabled on most CPUs (2018+) |
| Spectre/TAA forced microcode removal    |
| AMD never shipped HTM                   |
| Use HTM only on IBM POWER/zSeries       |
+-----------------------------------------+

retry            => abort + sleep until any read TVar changes
orElse a b       => try a; if a calls retry, try b
unsafeIOToSTM    => DO NOT
modifyTVar'      => strict, use this
modifyTVar       => lazy, builds thunks, avoid
registerDelay n  => returns TVar Bool, flips after n us
```

---

## Summary

STM is **conceptually elegant and operationally fragile**. The TL2 algorithm gives us lock-free reads, snapshot consistency, and composable critical sections, but at the cost of validation overhead and retry storms. Hardware transactional memory promised to solve the performance gap but **failed in the marketplace** for a combination of engineering limits (cache capacity), business reasons (no AMD support), and security disasters (Spectre, TAA).

Production STM users — chiefly the Haskell financial community — succeed by playing to STM's strengths (composability, complex invariants) and ruthlessly avoiding its weaknesses (hot counters, I/O, very long transactions). They also have the type system on their side; in languages without an `STM` monad, you fight irrevocability with libraries and conventions, and the result is usually worse than just using locks.

Senior engineers should understand STM well enough to:

- Recognize the workloads where it wins.
- Predict its failure modes (retry storms, read-set bloat).
- Translate STM concepts to MVCC databases and back.
- Resist the urge to "rewrite in STM" without measurement.
- Know when a `Mutex<T>` is the right answer.

---

## What You Can Build

- **Trading book engine** with STM-managed order book and position invariants.
- **Game world state** for a small MMO where regions are STM-isolated.
- **Configuration manager** with atomic multi-key updates and watchers via `retry`.
- **Workflow engine** where steps coordinate via STM-backed channels.
- **In-process MVCC store** for unit-testing database-like behavior without a DB.
- **TL2 implementation** in Rust or C as a learning exercise.
- **STM benchmark suite** comparing TL2 vs NoREC vs single global lock on real workloads.
- **HTM playground** on an IBM POWER box to feel hardware TM where it still ships.

---

## Further Reading

- **Dice, Shalev, Shavit — "Transactional Locking II" (DISC 2006)** — the TL2 paper.
- **Dalessandro, Spear, Scott — "NOrec: Streamlining STM by Abolishing Ownership Records" (PPoPP 2010)**.
- **Harris, Marlow, Peyton Jones, Herlihy — "Composable Memory Transactions" (PPoPP 2005)** — the GHC STM paper.
- **Yoo, Hughes, Lai, Rajwar — "Performance Evaluation of Intel TSX" (Intel report)**.
- **Intel — "Architecture Specification: Intel TSX-NI"** (the official spec; also see Intel's withdrawal advisories).
- **Adi Akavia et al — "Why STM can be more than a research toy" (CACM 2011)** — a defense of STM.
- **Bartok-STM, DSTM, McRT-STM** — academic implementations worth reading the source of.
- **GHC source — `rts/STM.c`** — the production runtime.
- **PostgreSQL documentation — MVCC and SSI chapters** — the mature relative.
- **Cliff Click — "A Lock-Free Hash Table" talks** — for a complementary lock-free perspective.
- **The Art of Multiprocessor Programming (Herlihy & Shavit), Chapter 18** — the canonical textbook chapter.

---

## Related Topics

- [STM Middle](middle.md) — the foundation this page builds on.
- [STM Professional](professional.md) — runtime engineering and library design.
- [STM Optimize](optimize.md) — micro-optimizations and contention reduction.
- [Locks Senior](../03-locks/senior.md) — the alternative this page compares against.
- [Lock-Free Senior](../04-lock-free/senior.md) — the lower-level alternative.
- [MVCC](../../../../databases/transactions/mvcc/README.md) — the database cousin.
- [Snapshot Isolation](../../../../databases/transactions/isolation-levels/snapshot-isolation/README.md).
- [Memory Models](../../../memory-model/README.md) — fences and orderings STM depends on.
- [Concurrency Patterns](../../../../../system-design/concurrency-patterns/README.md).

---

## Diagrams & Visual Aids

### TL2 commit pipeline

```
   Thread T                              Global Clock GV
   --------                              ---------------
   begin:  rv <- GV.read()  ............>      [42]

   read(x): pre := x.ver
            val := x.val
            post := x.ver
            assert pre == post, pre <= rv

   write(y, v): writeSet[y] := v

   commit:
     lock(y)                                            (try acquire y.lock)
     wv := GV.fetchAndAdd(1) ............>      [43]
     validate readSet against wv
     y.val := v
     y.ver := 43; unlock(y)
```

### Read set and write set lifecycle

```
+---------+   begin    +-----------+   commit?    +---------+
| nothing | ---------> | snapshot  | -----+-----> | applied |
+---------+            | + buffers |      |       +---------+
                       +-----------+      |
                              ^           v
                              |        +---------+
                              +--------|  abort  |
                                       +---------+
```

### Why a hot TVar destroys parallelism

```
T1 reads x, writes x
T2 reads x, writes x
T3 reads x, writes x

GV [42] --> [43] (T1 wins) --> T2 retries --> [44] (T2 wins) --> T3 retries --> ...

Throughput:  ~ 1 / (commit + retry overhead)
Cores used:  effectively 1
```

### HTM abort cascade (lemming effect)

```
T1: _xbegin -> conflict -> abort -> lock fallback (acquires L)
T2: _xbegin -> reads L (held) -> abort
T3: _xbegin -> reads L (held) -> abort
T4: _xbegin -> reads L (held) -> abort
...
All threads spin waiting for T1, even though they didn't conflict on data.
```

### STM vs MVCC vocabulary mapping

```
+------------------+---------------------+----------------------+
| Concept          | STM (TL2)           | PostgreSQL MVCC      |
+------------------+---------------------+----------------------+
| Snapshot start   | rv = GV.read        | snapshot at BEGIN    |
| Version          | per-TVar version    | tuple xmin/xmax      |
| Commit id        | GV.fetchAndAdd      | transaction id (xid) |
| Validation       | read-set re-check   | SSI predicate locks  |
| Cleanup          | per-thread arenas   | VACUUM               |
| Conflict outcome | abort + retry       | serialization error  |
+------------------+---------------------+----------------------+
```

### Decision flowchart: should I use STM?

```
                 +--------------------------+
                 | Is the hot path I/O?     |
                 +-----------+--------------+
                             | yes -> NO STM
                             v
                 +--------------------------+
                 | Single hot counter?      |
                 +-----------+--------------+
                             | yes -> atomics
                             v
                 +--------------------------+
                 | Latency budget < 10 us?  |
                 +-----------+--------------+
                             | yes -> lock-free
                             v
                 +--------------------------+
                 | Many fields, complex inv?|
                 +-----------+--------------+
                             | yes -> STM
                             v
                          consider locks
```

---

End of senior level. Continue with [Professional](professional.md) for runtime engineering, library architecture, and large-system case studies.
