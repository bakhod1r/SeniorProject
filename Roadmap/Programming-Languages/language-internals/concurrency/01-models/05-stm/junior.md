# Software Transactional Memory (STM) — Junior Level

> **Topic:** [STM](README.md)
> **Focus:** atomic blocks, retry, composability

---

## Table of Contents

- [Introduction](#introduction)
- [Prerequisites](#prerequisites)
- [Glossary](#glossary)
- [Core Concepts](#core-concepts)
- [Real-World Analogies](#real-world-analogies)
- [Mental Models](#mental-models)
- [Code Examples](#code-examples)
- [Pros & Cons](#pros--cons)
- [Use Cases](#use-cases)
- [Coding Patterns](#coding-patterns)
- [Clean Code](#clean-code)
- [Best Practices](#best-practices)
- [Edge Cases & Pitfalls](#edge-cases--pitfalls)
- [Common Mistakes](#common-mistakes)
- [Tricky Points](#tricky-points)
- [Test Yourself](#test-yourself)
- [Tricky Questions](#tricky-questions)
- [Cheat Sheet](#cheat-sheet)
- [Summary](#summary)
- [What You Can Build](#what-you-can-build)
- [Further Reading](#further-reading)
- [Related Topics](#related-topics)
- [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

Software Transactional Memory, almost always abbreviated to **STM**, is a
concurrency control model that lets you reason about shared state the same way
you reason about a database transaction. Instead of grabbing a lock, mutating a
variable, and remembering to release the lock, you wrap a block of memory
operations in `atomically { ... }` (Haskell) or `(dosync ...)` (Clojure) and let
the runtime worry about whether the operations interfered with another thread.

The mental shift is small but powerful. With locks you say, *"While I hold this
mutex, nobody else may touch the balance."* With STM you say, *"Run this block;
if anyone else touched the same memory between my first read and my last write,
throw my work away and run it again."* The runtime detects the conflict at
commit time, rolls back your partial changes, and re-executes the block. From
the caller's point of view the block either happened completely or not at all,
exactly like a SQL `BEGIN; ... COMMIT;` pair.

STM is not new. The idea goes back to Shavit and Touitou's 1995 paper
*"Software Transactional Memory"*, but the model only entered the mainstream
when Tim Harris, Simon Marlow, Simon Peyton Jones, and Maurice Herlihy
published *"Composable Memory Transactions"* in 2005 and shipped GHC's STM
monad. Rich Hickey put a similar idea — refs and `dosync` — at the core of
Clojure in 2007, and Scala received `scala-stm` shortly afterwards.

For a junior engineer the most important thing to learn is *why STM exists at
all*. Locks have a famous problem: they do not compose. If `transfer` calls
`withdraw` and `deposit`, and each of those locks its own account, then
combining them into a single atomic operation requires you to invent a new
locking protocol — and very likely deadlock yourself. STM removes that whole
class of bugs because two atomic blocks can be combined into a bigger atomic
block with no extra machinery: nesting an `atomically` inside another
`atomically` just extends the transaction.

This file walks through the model gently. You will see why STM is best
described as *"ACID for memory"*, what `retry` and `orElse` actually do, how
the runtime keeps a per-thread *transaction log*, why Haskell's type system
forbids `IO` inside a transaction, and what the trade-offs are versus locks,
actors, and channels. Once you can read a Haskell `atomically` block or a
Clojure `dosync` form and predict exactly what happens, you have the junior
mental model down.

We will keep the math out. The middle, senior, and professional pages dig into
the algorithm — TL2, multi-version concurrency control, contention managers —
but here we only need three intuitions: *optimistic*, *log-based*, and
*composable*.

---

## Prerequisites

Before STM clicks, you should be comfortable with:

- **Threads and shared mutable state.** What a data race is and why two
  threads writing the same `int` is dangerous.
- **Locks at a basic level.** `synchronized`, `Mutex`, `Lock`. Enough to
  understand what *holding* a lock means and how *deadlock* happens.
- **The idea of a database transaction.** `BEGIN`, `COMMIT`, `ROLLBACK`. The
  ACID acronym — at least atomicity, consistency, and isolation.
- **First-class functions.** STM blocks are *values* in Haskell and Clojure;
  you pass them around, compose them, and run them.
- **Pure vs side-effecting code.** Haskell's STM monad relies on this; the
  whole point is that an STM action has no observable side effect until commit.

If you have written `synchronized(account) { account.balance -= amount; }` in
Java and felt the urge to ask *"what if someone calls `transfer(A,B)` and
`transfer(B,A)` at the same time?"*, you are ready.

---

## Glossary

| Term | Meaning |
| --- | --- |
| `atomically` | Haskell function `atomically :: STM a -> IO a` that runs an STM block as one indivisible unit. |
| `TVar` | Haskell's *transactional variable* — a mutable cell that may only be read or written inside an STM transaction. |
| `ref` | Clojure's coordinated reference, the equivalent of a `TVar`. Created with `(ref initial-value)`. |
| `retry` | Haskell STM combinator that aborts the current transaction and re-runs it when one of its read variables changes. |
| `orElse` | Haskell combinator that tries one STM action and, if it `retry`s, runs an alternative. Enables composable choice. |
| `dosync` | Clojure macro that delimits a transaction. Everything inside runs atomically. |
| `alter` | Clojure function that updates a `ref` inside a `dosync` by applying a function to its current value. |
| Snapshot | The consistent view of `TVar` / `ref` values that a transaction observes; all reads appear to happen at one instant in time. |
| Conflict | Two transactions touched overlapping memory and at least one of them wrote, so one must abort and retry. |
| Optimistic concurrency | The strategy of assuming no conflict, doing the work, then checking at commit time — the opposite of pessimistic locking. |

---

## Core Concepts

### 1. The `atomically { ... }` block

The fundamental primitive is an *atomic block*. In Haskell:

```haskell
atomically $ do
  balance <- readTVar account
  writeTVar account (balance - 100)
```

In Clojure:

```clojure
(dosync
  (alter account - 100))
```

In Scala (`scala-stm`):

```scala
atomic { implicit txn =>
  account() = account() - 100
}
```

Inside the block you may freely read and write *transactional variables*. The
runtime guarantees that, from any other thread's point of view, either the
whole block happened or none of it did. There is no observable intermediate
state. If another thread interferes, your block is silently re-run from the
top.

That last sentence carries a lot of weight. It means *the code in the block
must be safe to run more than once*. Printing, sending an email, launching a
missile — these are not safe to retry. We will return to this.

### 2. Automatic retry on conflict

When you commit the transaction, the runtime compares the *read set* (every
`TVar` you read) with the current state of memory. If anything you read has
changed, the commit fails, your tentative writes are discarded, and the block
restarts. This is **optimistic concurrency**: assume nobody will conflict, do
the work, validate at the end.

Compare this to a database `SERIALIZABLE` transaction. The database does the
same thing — runs you under the assumption that you are alone, then aborts you
if it cannot serialize your transaction with everybody else's.

### 3. Composability — the headline feature

Locks famously *do not compose*. Suppose you have:

```text
withdraw(a, n)  // locks a, mutates a
deposit(b, n)   // locks b, mutates b
```

Combining them into `transfer(a, b, n)` is dangerous. If two threads call
`transfer(a, b, n)` and `transfer(b, a, n)` in opposite orders, you deadlock.
There is no library-level way to fix this — the caller must impose a global
locking order on every account.

With STM, the same composition is trivial:

```haskell
transfer a b n = atomically $ do
  withdraw a n
  deposit  b n
```

`withdraw` and `deposit` are themselves STM actions, and putting them inside
one `atomically` extends the transaction to cover both. There is no second
lock to acquire, no order to choose, and no deadlock to worry about. *That* is
composability.

### 4. ACID for memory

Read this analogy slowly; it is the single best mental model for STM.

| Database transaction | STM block |
| --- | --- |
| `BEGIN`               | enter `atomically` |
| `SELECT balance`      | `readTVar account` |
| `UPDATE accounts`     | `writeTVar account ...` |
| Serializable isolation | snapshot consistency |
| `COMMIT` may fail     | commit retries automatically |
| `ROLLBACK`            | runtime throws away the log |

The big difference: the database commits *to disk*, STM commits *to RAM*; the
database checks conflicts using locks or MVCC, STM uses an in-process log.

### 5. Optimistic concurrency

Locks are *pessimistic*: take the lock first, do the work later. STM is
*optimistic*: do the work assuming you are alone, validate at the end. This is
fast under low contention (no synchronization on the hot path) and graceful
under high contention (only the loser retries, the winner keeps going), but it
*does* waste work if conflicts are frequent. You will see this trade-off many
times.

### 6. Deadlock-free by construction

Because there are no locks, there is no lock-ordering problem and therefore no
deadlock. A transaction either commits, aborts (and retries), or — if you
explicitly call `retry` — blocks until one of its read variables changes.
That is it. There is no thread waiting forever on a lock that another thread
forgot to release.

You can still write *livelock* (two transactions that keep conflicting forever),
and you can still cause *starvation* under bad contention managers, but the
classic four-thread, four-lock deadlock is impossible.

### 7. The `retry` mechanic

Sometimes you want to wait until the world changes. For example, an empty
queue should block consumers until a producer adds something. In STM:

```haskell
takeBuffer :: TVar [a] -> STM a
takeBuffer buf = do
  xs <- readTVar buf
  case xs of
    []     -> retry
    (x:rs) -> do writeTVar buf rs
                 return x
```

`retry` aborts the current transaction *and tells the runtime to re-run it only
when one of the `TVar`s it has read has changed*. The runtime is smart: the
thread is suspended (no busy-loop), and is woken when a producer writes to
`buf`. From the caller's point of view, `takeBuffer` simply blocks until data
arrives.

Clojure does not have a built-in `retry` combinator but supports the same
effect via `ensure` and version checks; `scala-stm` exposes it as
`retry()` inside an `atomic` block.

### 8. `orElse` — composable choice

If you have two STM actions, `a` and `b`, you can write `a `orElse` b`:
*try `a`; if it `retry`s, throw away its effects and try `b` instead.* This
gives you composable *choice*, something locks cannot offer at all. Example:

```haskell
readEither :: TVar (Maybe a) -> TVar (Maybe a) -> STM a
readEither x y = readJust x `orElse` readJust y
```

You ask for whichever variable has data first, with no priority inversion and
no special protocol.

### 9. Languages and runtimes

- **Haskell (GHC) STM** — the canonical implementation. `STM a` is a monad;
  `atomically :: STM a -> IO a`. The compiler statically forbids `IO` inside
  an STM block, which keeps transactions retry-safe.
- **Clojure refs** — `(ref ...)`, `(dosync ...)`, `(alter ...)`, `(commute
  ...)`, `(ensure ...)`. Hickey designed refs as one of four reference types
  (vars, atoms, refs, agents); refs are the *coordinated* one.
- **Scala `scala-stm`** — independent library by Nathan Bronson; runs on the
  JVM, integrates with `Future`, exposes `atomic`, `Ref`, `retry`, `orAtomic`.
- **C/C++ STM** — there are research libraries (TL2, NOrec, McRT-STM) and a
  withdrawn `transactional_memory` TS, but nothing mainstream.
- **Intel TSX / hardware TM** — a related but distinct topic; covered at
  professional level.

### 10. STM vs locks vs actors vs channels

| Model | Shared state? | Communication | Composes? | Deadlock-prone? |
| --- | --- | --- | --- | --- |
| Locks | Yes | Direct mutation | No | Yes |
| STM | Yes | Direct mutation inside transactions | Yes | No |
| Actors | No (each actor private) | Async messages | Messages only | Indirectly (mailbox cycles) |
| Channels (CSP) | No | Sync/async messages | Yes (select) | Yes (closed channel) |

STM is the only model in the table that keeps *shared mutable state* but still
composes safely. That is its sweet spot.

### 11. Trade-offs at a glance

- **Pros:** safety, composability, deadlock-freedom, clean code.
- **Cons:** runtime overhead (transaction log, validation), wasted work under
  high contention, *no I/O allowed inside a transaction* (because the block
  can retry — you cannot un-send an email), garbage collector pressure from
  cloning, and the need for runtime/compiler support.

---

## Real-World Analogies

| Analogy | How it maps |
| --- | --- |
| **Database transaction** | `atomically` is `BEGIN`; reads are `SELECT`; writes are `UPDATE`; commit checks for conflicts; on conflict you `ROLLBACK` and try again. The strongest analogy and the one to keep in your head. |
| **ATM withdrawal** | You ask the ATM for $100. It checks your balance, decides the amount is available, dispenses cash, deducts the balance. If your account was modified between read and write (your spouse withdrew at the same time), the transaction must be replayed to see the new balance. STM gives you the same guarantee for in-memory accounts. |
| **Git rebase** | You work on your branch as if no one else exists. At push time the server checks whether main moved; if it did, you rebase and try again. Optimistic concurrency control, exactly like STM. |
| **Whiteboard with carbon paper** | Each thread writes on its own carbon copy. At commit, you check that the original board has not changed since you started; if it has not, your changes are applied; if it has, you tear up your copy and start over. |

---

## Mental Models

**Model 1 — "ACID for memory."** A transaction is atomic, consistent, isolated,
and durable enough for RAM. Once you internalize this, almost every STM
behavior follows.

**Model 2 — "Optimistic with a log."** Imagine each transaction keeping a
diary: every `TVar` it read goes into a *read log*, every write goes into a
*write log*. Other threads see nothing. At commit time the runtime checks
whether the read log is still consistent with current memory. If yes, apply
the write log. If no, throw the diary away and start over.

**Model 3 — "Compose by nesting."** Two transactions can be made into one by
nesting their `atomically` blocks. The outer transaction subsumes the inner —
the inner does not commit independently. That is composability in one line.

**Model 4 — "`retry` is a 'wake me when ...' subscription."** When you call
`retry`, the runtime suspends your thread and subscribes it to changes on the
`TVar`s you read. Any write to one of them wakes you. This is more efficient
than spinning.

**Model 5 — "No I/O because we may run twice."** Anything that touches the
outside world cannot be undone, so the type system (Haskell) or the
documentation (Clojure, Scala) refuses to let it run inside a transaction.

---

## Code Examples

### Example 1 — Haskell STM bank transfer

```haskell
{-# LANGUAGE ScopedTypeVariables #-}

module Bank where

import Control.Concurrent       (forkIO, threadDelay)
import Control.Concurrent.STM   (STM, TVar, atomically, newTVarIO,
                                 readTVar, writeTVar, retry)
import Control.Monad            (replicateM_)

type Account = TVar Int

-- | Deduct an amount from an account, blocking until funds are available.
withdraw :: Account -> Int -> STM ()
withdraw acc amount = do
  balance <- readTVar acc
  if balance < amount
    then retry                        -- block until balance changes
    else writeTVar acc (balance - amount)

-- | Add an amount to an account.
deposit :: Account -> Int -> STM ()
deposit acc amount = do
  balance <- readTVar acc
  writeTVar acc (balance + amount)

-- | Composable transfer. Either both sides happen, or neither does.
transfer :: Account -> Account -> Int -> STM ()
transfer from to amount = do
  withdraw from amount
  deposit  to   amount

main :: IO ()
main = do
  alice <- newTVarIO 1000
  bob   <- newTVarIO 1000

  -- Spawn 10 concurrent transfers Alice -> Bob.
  replicateM_ 10 $ forkIO $ do
    atomically (transfer alice bob 100)

  -- Spawn 10 concurrent transfers Bob -> Alice.
  replicateM_ 10 $ forkIO $ do
    atomically (transfer bob alice 100)

  threadDelay 200000                  -- let them finish
  a <- atomically (readTVar alice)
  b <- atomically (readTVar bob)
  putStrLn ("Alice: " ++ show a)      -- always 1000
  putStrLn ("Bob:   " ++ show b)      -- always 1000
```

Look at `transfer`. Two sub-operations, no lock order, no deadlock, atomic.
The `retry` inside `withdraw` means an overdraft attempt waits until somebody
deposits. The compiler statically forbids `putStrLn` inside `atomically` —
proof that the block is replay-safe.

### Example 2 — Clojure refs and `dosync`

```clojure
(ns bank.core
  (:require [clojure.core :as c]))

(def alice (ref 1000))
(def bob   (ref 1000))

(defn transfer
  "Move amount from src to dst atomically.
   Both refs are updated or neither is."
  [src dst amount]
  (dosync
    (when (< @src amount)
      (throw (IllegalStateException. "insufficient funds")))
    (alter src - amount)
    (alter dst + amount)))

;; Fire 20 concurrent transfers in both directions.
(defn -main []
  (let [workers (concat
                  (repeatedly 10 #(future (transfer alice bob 100)))
                  (repeatedly 10 #(future (transfer bob alice 100))))]
    (doseq [w workers] @w))
  (println "Alice:" @alice)            ; always 1000
  (println "Bob:  " @bob))             ; always 1000
```

`dosync` is the atomic block. `alter` reads the current value of the ref,
applies the function, and stages the new value in the transaction log. If
another transaction wins the race, `dosync` automatically restarts. Note that
`println` inside `dosync` would be a bug — it might fire multiple times on
retry.

### Example 3 — Scala (`scala-stm`)

```scala
import scala.concurrent.stm._

object Bank {
  // Ref[Int] is the Scala equivalent of TVar Int / ref.
  val alice: Ref[Int] = Ref(1000)
  val bob:   Ref[Int] = Ref(1000)

  def transfer(src: Ref[Int], dst: Ref[Int], amount: Int): Unit =
    atomic { implicit txn =>
      if (src() < amount) retry        // block until funds appear
      src() = src() - amount
      dst() = dst() + amount
    }

  def main(args: Array[String]): Unit = {
    import scala.concurrent.ExecutionContext.Implicits.global
    import scala.concurrent.{Await, Future}
    import scala.concurrent.duration._

    val tasks = (1 to 10).map(_ => Future(transfer(alice, bob, 100))) ++
                (1 to 10).map(_ => Future(transfer(bob, alice, 100)))
    Await.result(Future.sequence(tasks), 5.seconds)

    println(s"Alice: ${atomic { implicit t => alice() }}")  // 1000
    println(s"Bob:   ${atomic { implicit t => bob() }}")    // 1000
  }
}
```

The `implicit txn` is the *transaction handle*. `src()` reads the ref through
the transaction; `src() = ...` writes through the transaction. `retry`
suspends until a refs the transaction read changes.

### Example 4 — Composable choice with `orElse`

```haskell
import Control.Concurrent.STM

-- Take from whichever queue has data first.
takeFromEither :: TVar [a] -> TVar [a] -> STM a
takeFromEither q1 q2 = takeBuffer q1 `orElse` takeBuffer q2
  where
    takeBuffer q = do
      xs <- readTVar q
      case xs of
        []     -> retry
        (h:t)  -> do writeTVar q t
                     return h
```

If `q1` is empty, `takeBuffer q1` calls `retry`, the runtime throws away its
work and tries `takeBuffer q2`. If both are empty, the whole block blocks
until *either* queue is written to. Try writing that with two `Condition`
variables — it is painful and error-prone.

---

## Pros & Cons

**Pros**

- *Composability.* You can take two STM actions and combine them into a bigger
  atomic action with no extra protocol.
- *No deadlocks of the classic lock-ordering kind.*
- *Clean code.* The reading code looks almost sequential — `withdraw`,
  `deposit`, done.
- *Optimistic.* Reader-heavy workloads scale linearly in many implementations.
- *`retry` and `orElse` are clean abstractions* for "wait for state change" and
  "try this, otherwise that".

**Cons**

- *Runtime overhead.* Every read goes through a log; every commit revalidates.
- *Wasted work under high contention.* Two long transactions hitting the same
  cell will repeatedly abort each other.
- *No I/O allowed inside a transaction.* This is by design but it surprises
  newcomers.
- *Needs runtime support.* You cannot retrofit STM into a language whose
  compiler does not cooperate; Haskell, Clojure, and Scala give it to you,
  most others do not.
- *Memory overhead for the log.* Long transactions with thousands of writes
  consume real memory.

---

## Use Cases

- **Bank/account-style code** where small, related changes must happen
  together (the canonical example).
- **In-memory caches and indexes** with concurrent readers and occasional
  writers.
- **Game state** — moving an entity from one cell to another atomically.
- **Workflow engines** where step transitions update multiple records.
- **Coordinating shared collections** (queues, sets) without writing a custom
  lock-free algorithm.
- **Composable concurrent libraries** where you want users to extend your
  primitives without learning your lock graph.

STM is *not* a fit for:

- I/O-heavy code (file writes, network calls) — those cannot retry.
- Single-writer workloads — a plain `Atom` (Clojure) or `IORef` (Haskell)
  with CAS is cheaper.
- Sub-microsecond hot paths — the log overhead matters.

---

## Coding Patterns

**Pattern 1 — Keep the block small.** The longer the transaction, the higher
the chance of a conflict and the more work to throw away.

**Pattern 2 — Push I/O outside.**

```haskell
result <- atomically (doPureWork)
log result                           -- I/O lives here
```

**Pattern 3 — Use `retry` for "wait until ready".** Far cleaner than spinning
on a flag.

**Pattern 4 — Use `orElse` for "try A then B".** Avoids manual try/catch
ladders.

**Pattern 5 — Encapsulate transactional operations in functions that return
STM, not `IO`.** That way callers can compose them.

**Pattern 6 — Prefer `commute` over `alter` in Clojure when order does not
matter.** `commute` lets the runtime apply your function more efficiently
because it does not need to lock the ref's order.

**Pattern 7 — Validate invariants inside the transaction.** Checking
`balance >= 0` at the end of the transaction guarantees no thread ever sees
a negative balance.

---

## Clean Code

- Name your STM actions like business operations: `transfer`, `enqueue`,
  `markCompleted`. The fact that they return `STM a` instead of `IO a` is a
  signal that they compose.
- Keep each transactional function focused on one logical change. Compose
  larger workflows from smaller pieces using `do` notation.
- Resist the temptation to put logging or metrics inside the block. Move them
  to a wrapper that runs after `atomically` succeeds.
- Document which `TVar`s belong together. Even though STM removes the lock-
  ordering problem, *humans* still benefit from knowing *"these three refs
  represent one logical entity"*.
- Treat retries as expected, not as errors. Do not log every retry; you will
  drown.

---

## Best Practices

1. **Never perform I/O inside a transaction.** In Haskell the compiler
   enforces this; in Clojure and Scala it is a rule you must follow.
2. **Keep transactions short.** Long transactions are conflict magnets and
   waste CPU on retries.
3. **Use `retry` instead of polling.** It is more efficient and clearer.
4. **Prefer `commute` (Clojure) for commutative updates** like increment,
   accumulator append.
5. **Avoid mixing STM and explicit locks.** It is doable but fragile; let the
   runtime own concurrency control.
6. **Profile under realistic contention.** STM shines under low to moderate
   contention; high contention may need redesign (per-key refs, sharding).
7. **Initialize refs/TVars once, at startup.** Creating them on the hot path
   is allocation overhead.
8. **Be careful with side-effecting library calls** even outside STM if the
   library uses thread-local state.

---

## Edge Cases & Pitfalls

- **Side effects inside transactions.** Sending an email twice because the
  transaction retried is a classic horror story.
- **Live retry loops.** Two long transactions that always overlap can starve
  each other; many runtimes ship a *contention manager* but you should still
  avoid the pattern.
- **Reading mutable state outside STM.** Mixing a plain `IORef` with a
  `TVar` defeats isolation; reads of the `IORef` are not in the log.
- **Stale snapshots.** Inside a long transaction, an early read may become
  stale before commit; the runtime aborts, but if you have observed the value
  *outside* (printing, etc.) you've leaked the stale read.
- **Large transactions.** Million-write transactions are slow to commit and
  hold a huge log; break them up.
- **Surprising blocking.** `retry` blocks the *calling thread*; if the caller
  expects non-blocking behavior, wrap in `orElse return Nothing`.
- **Exception inside a transaction.** In Haskell, exceptions abort the
  transaction — partial writes vanish. In Clojure, exceptions thrown from
  `dosync` propagate and abort the txn. Make sure you understand which is
  which in your runtime.

---

## Common Mistakes

1. *Printing inside `dosync`* — gets called multiple times on retry.
2. *Modifying an external file inside `atomically`* — type error in Haskell;
   bug in Clojure/Scala.
3. *Using STM for single-writer counters* — overkill; a CAS-based atom is
   faster.
4. *Holding open resources (database handles, sockets)* across the
   transaction — they must be acquired outside.
5. *Treating retry as an error* — it is normal, not a bug.
6. *Doing CPU-heavy work inside the block* — every retry pays the cost.
7. *Calling `dosync` inside an `atom`'s `swap!`* — anti-pattern; pick one
   reference type per coordination problem.
8. *Mixing locks and refs* on the same data — undefined behavior in practice.

---

## Tricky Points

- **`commute` vs `alter`.** Both update a Clojure ref, but `commute` tells
  the runtime *"my function is commutative; reorder me if it helps"*. Use it
  for counters; avoid it where order matters.
- **`ensure` in Clojure.** Prevents another transaction from changing a ref
  you have read without yourself writing it — needed when your decision
  depends on a ref that you only *read*.
- **`orElse` semantics.** `orElse a b` only falls back to `b` if `a` calls
  `retry`; if `a` throws an exception, the exception propagates.
- **Why `STM` is a different monad from `IO`.** It is so the compiler can
  enforce that no `IO` action sneaks in.
- **Nested `atomically` in Haskell.** Not allowed at the type level — you
  cannot call `atomically` from inside an STM block; you compose by simply
  not wrapping. The middle level covers the reason.
- **Clojure refs and history.** Refs keep a small history of values to help
  long-running readers avoid retry; this is tunable.

---

## Test Yourself

1. What does `atomically` do that `synchronized` cannot?
2. Why is STM said to *compose*?
3. Explain optimistic concurrency in two sentences.
4. What is the read set and the write set of a transaction?
5. Why does Haskell's type system forbid `IO` inside `STM`?
6. What does `retry` do? When does the runtime wake the thread back up?
7. What is `orElse` and why is it special?
8. Why can STM deadlock-free programs still *livelock*?
9. Give a workload where STM is a bad fit.
10. Sketch a Clojure `transfer` between two refs. Where does `dosync` go?

---

## Tricky Questions

1. You see two transactions repeatedly abort each other. List three things you
   could change in the code to reduce contention.
2. Can a Haskell STM block call `error "boom"`? What happens to its writes?
3. Why is `orElse a (return Nothing)` a common idiom?
4. How would you implement a bounded blocking queue using only `TVar` and the
   STM combinators shown here?
5. Why is it usually wrong to *log every retry*?
6. A junior asks *"why not just use `synchronized` on the bank account?"*.
   Give a one-paragraph answer they will understand.
7. You need to send an email *after* a transaction commits. Where do you put
   the call? Why?
8. Can two threads simultaneously commit different transactions that touch the
   same `TVar`? Justify.
9. What is the difference between `alter` and `commute` in Clojure, and when
   is using `commute` actually wrong?
10. Suppose a transaction reads 10,000 `TVar`s and writes 1. What is likely
    to dominate its cost?

---

## Cheat Sheet

```text
ATOMIC BLOCK
  Haskell : atomically $ do { ... }
  Clojure : (dosync ...)
  Scala   : atomic { implicit t => ... }

TRANSACTIONAL VAR
  Haskell : TVar a   -> readTVar, writeTVar, newTVar, newTVarIO
  Clojure : ref      -> deref / @ref, alter, commute, ensure
  Scala   : Ref[A]   -> ref(), ref() = ...

WAIT FOR CHANGE
  Haskell : retry
  Clojure : (no direct equivalent; use a watcher + condition)
  Scala   : retry

CHOICE
  Haskell : a `orElse` b
  Scala   : a orAtomic b

RULES OF THUMB
  - keep blocks small
  - no I/O inside
  - retry is normal, not an error
  - prefer commute when order does not matter
  - profile contention before optimizing
```

---

## Summary

Software Transactional Memory takes the *transaction* abstraction from
databases and applies it to memory. You wrap a block of reads and writes in
`atomically` (or `dosync`, or `atomic`), the runtime gives you a consistent
snapshot of the world, you do your work, and at commit time the runtime
validates and either applies your changes or transparently retries the block.

The killer feature is *composability*. Locks famously do not compose: every
time you combine two locked operations you risk a new deadlock. STM blocks
nest trivially — two atomic actions joined into one atomic action *just work*.
This is why Haskell, Clojure, and Scala all picked STM as a high-level
concurrency primitive when they were designed.

The cost is runtime overhead and the rule that *no I/O is allowed inside a
transaction*, because the block may run multiple times. Haskell's type system
enforces it; Clojure and Scala leave it as a contract you must honor.

For a junior engineer the takeaway is short: *STM = ACID for memory, plus
composability, minus deadlocks*. When you find yourself writing nested locks,
worrying about lock ordering, or building bespoke wait/notify mechanisms, STM
is likely the cleaner answer — at least in any language that gives it to you.

---

## What You Can Build

- A safe **in-memory bank ledger** where every transfer is automatically
  atomic.
- A **concurrent priority queue** with composable `enqueue`, `dequeue`, and
  `peek` operations.
- A **chat-room presence service** where joining and leaving update both a
  set of users and a count, atomically.
- A **simple workflow engine** where transitioning between states updates
  several refs in one transaction.
- A **toy multi-player game world** with thousands of cells; entities move
  atomically between cells using STM.
- A **read-mostly cache** with occasional invalidations, sharing a `TVar Map`
  between many threads.

---

## Further Reading

- Harris, Marlow, Peyton Jones, Herlihy — *Composable Memory Transactions*
  (PPoPP 2005). The paper that introduced Haskell STM and gave STM its
  composability story.
- Simon Peyton Jones — *"Beautiful Concurrency"* in *Beautiful Code*
  (O'Reilly, 2007). The most readable introduction to Haskell STM.
- Rich Hickey — *Clojure Refs and Transactions* on
  [clojure.org](https://clojure.org/reference/refs).
- Shavit & Touitou — *Software Transactional Memory* (PODC 1995). The
  original paper.
- Nathan Bronson — *scala-stm* documentation and design notes.
- *Haskell Wiki — STM* and the `stm` package on Hackage.

---

## Related Topics

- [Middle level](middle.md) — implementation: transaction logs, conflict
  detection algorithms, GHC's STM internals.
- [Senior level](senior.md) — TL2, NOrec, lazy version validation,
  contention managers, integration with HTM.
- [Professional level](professional.md) — STM in production systems,
  benchmarking, hybrid TM, when *not* to use STM.
- [Interview](interview.md) — common interview questions on STM.
- [Find a bug](find-bug.md) — debugging exercises for STM code.
- [Tasks](tasks.md) — hands-on exercises.
- [Shared memory model](../01-shared-memory/junior.md) — the substrate STM
  abstracts over.
- [Race conditions](../../05-race-conditions/junior.md) — the class of bug
  STM eliminates.
- [Deadlock detection](../../06-deadlock-detection/junior.md) — the class of
  bug STM makes impossible by construction.

---

## Diagrams & Visual Aids

### Transaction life cycle

```text
        +------------------+
   T1   |  BEGIN tx        |
        |  read-set = {}   |
        |  write-set = {}  |
        +------------------+
                 |
                 v
        +------------------+        +-------------------+
        |  read TVar x     | -----> | read-set += {x}   |
        |  read TVar y     |        | read-set += {y}   |
        |  write TVar x = 5|        | write-set += {x}  |
        +------------------+        +-------------------+
                 |
                 v
        +------------------+
        |  COMMIT          |
        |  validate(R-set) |
        +------------------+
           /            \
       valid           invalid
          |              |
          v              v
   apply writes      discard, retry
```

### Optimistic vs pessimistic

```text
Pessimistic (locks):                Optimistic (STM):

   T1                                  T1
   acquire(L_x)                        read x, y       (log only)
   read x                              write x = 5    (log only)
   write x = 5                         COMMIT
   release(L_x)                        validate read log
                                       if ok -> apply, else -> retry
```

### `retry` waiting on a `TVar`

```text
   Thread A (consumer)              Thread B (producer)

   atomically:
     xs <- readTVar buf
     case xs of                          ...
       []     -> retry  <--- sleeps      atomically:
                                          writeTVar buf [42]
                                          COMMIT
                       <--- woken up
     restart transaction
       xs = [42]
       return head, write tail
```

### `orElse` flow

```text
   atomically (a `orElse` b)

         +----+      retry?      +----+
         | a  | ---------------> | b  |
         +----+                  +----+
            |                       |
        commit                  commit / retry
```

### STM vs locks for `transfer`

```text
With locks:
   thread 1: lock A -> lock B -> work -> unlock B -> unlock A
   thread 2: lock B -> lock A -> ...  -->  DEADLOCK

With STM:
   thread 1: atomically (read A, read B, write A, write B)
   thread 2: atomically (read B, read A, write B, write A)
   conflict at commit -> one retries -> both succeed
```

### Memory model — a single `TVar`

```text
   +-----------+        log of T1: read v=10, write v=11
   | TVar v=10 |
   +-----------+        log of T2: read v=10, write v=12
        ^
        | commit check: head still v=10? yes -> T1 wins
        | T2: head now v=11? mismatch -> T2 retries
```

---

End of junior page. Continue to [middle.md](middle.md) for the transaction
log algorithm, conflict detection details, and how the runtime keeps the
illusion of atomic commits.
