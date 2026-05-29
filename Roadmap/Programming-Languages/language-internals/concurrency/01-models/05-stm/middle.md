# STM — Middle Level

> **Topic:** [STM](README.md)
> **Focus:** conflict detection, composition, datatypes, condition waiting

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

At the junior level you learned that Software Transactional Memory (STM) wraps
shared-state mutations in transactions that either commit atomically or appear
never to have happened. That mental model is enough to get started, but it
leaves the most interesting questions unanswered. How does the runtime know
that two transactions conflict? Why is `retry` more than a fancy spin loop?
Why can a Haskell transaction return an `STM Int` but not an `IO Int`? Why do
Clojure programmers reach for `atom` ninety percent of the time and `ref` only
when they need coordinated updates?

This middle-level guide answers those questions. We will look at the
implementation building blocks (read sets, write sets, validation, commit
protocols), the composition primitives (`orElse`, `retry`, nested
transactions), and the family of STM datatypes that ride on top of `TVar` —
`TMVar`, `TChan`, `TQueue`, `TArray`. Along the way we will compare Haskell's
type-enforced isolation with Clojure's runtime discipline and Scala's
library-driven approach. By the end you should be able to write non-trivial
STM code that composes well, waits efficiently, and avoids the most common
performance traps.

A word of warning before we start: STM trades raw throughput for clarity. It
is at its best when correctness under contention is hard and performance is
secondary. It is at its worst when transactions are large, side-effecting, or
when contention is so heavy that the optimistic retry loop never stabilises.
Knowing where the line sits is what separates a middle-level STM user from a
junior one.

---

## Prerequisites

Before working through this document you should be comfortable with:

- The junior STM document — atomicity, isolation, the basic `TVar` API,
  `atomically` as the boundary between pure and effectful code.
- Optimistic concurrency control. If you have ever used a database with
  `SELECT ... FOR UPDATE` versus a version-column `UPDATE ... WHERE version
  = ?` you already know the spectrum we are working in.
- Compare-and-swap (CAS). Single-cell atomic state is the building block; STM
  generalises it to multiple cells.
- Lock-based concurrency — at minimum the mental model of mutexes, condition
  variables (wait/notify), and the kind of bugs they produce.
- Some functional programming background. We will look at Haskell, Clojure,
  and Scala code. You do not have to be fluent in any of them, but you should
  recognise `let`, `do`, `let*`, and `for`.

If any of these feel shaky, take a detour through the
[concurrency models index](../README.md) and the
[locks and CAS topics](../03-locking/README.md) before continuing.

---

## Glossary

| Term | Definition |
| --- | --- |
| Read set | The collection of transactional variables a transaction has read, with the version observed at read time. |
| Write set | The collection of transactional variables a transaction intends to write, held in a thread-local buffer until commit. |
| Validation | The phase at commit time where the runtime checks that every variable in the read set still has the version that was observed. |
| Commit | The phase where the runtime atomically applies the write set, bumping the version of each written variable. |
| Optimistic concurrency | A strategy that lets transactions run without locks and detects conflicts only at commit. |
| Pessimistic concurrency | A strategy that acquires locks up front to prevent conflicts from happening. |
| `retry` | An STM primitive that aborts the current transaction and re-runs it later, when one of its read variables has changed. |
| `orElse` | An STM primitive that runs an alternative transaction if the first one calls `retry`. |
| `TVar` | The basic transactional variable in Haskell STM; a mutable cell with a version counter. |
| `TMVar` | A transactional version of `MVar`; either empty or full, useful for handoffs. |
| `TChan` | An unbounded transactional channel; producers and consumers compose via STM. |
| `TQueue` | A faster, single-reader/single-writer-friendly unbounded queue. |
| `ref` | Clojure's STM-managed reference cell, updated only inside `dosync`. |
| `atom` | Clojure's CAS-based single-cell mutable state; not part of STM. |
| `var` | Clojure's dynamic, thread-local-rebindable variable; unrelated to STM. |
| Conflict | Two transactions touch overlapping data such that one cannot commit without invalidating the other's read set. |
| Restart | A transaction's abort-and-re-run cycle triggered by validation failure or `retry`. |
| Idempotent | A computation that produces the same observable result when repeated. STM transactions must be idempotent because they may run many times. |
| Granularity | The choice of how much state lives behind a single TVar — many small ones versus one big one. |
| Live lock | A condition where transactions keep aborting one another and none make progress. |

---

## Core Concepts

### Conflict detection algorithms — read set / write set tracking

Every STM transaction maintains two thread-local data structures while it
runs: a read set and a write set. The read set is a map from transactional
variable to the version observed when the variable was read. The write set is
a map from variable to the new value the transaction wants to install. Neither
is published to other threads until commit time.

When the transaction calls `readTVar`, the runtime looks the variable up in
the write set first (so a transaction sees its own writes) and falls back to
the shared cell otherwise, recording the variable and its version in the read
set. When the transaction calls `writeTVar`, the runtime simply updates the
write set; the shared cell is untouched.

At commit, the runtime walks the read set and checks that every observed
version is still current. If yes, it acquires the necessary commit locks (in
some canonical order to avoid deadlock), updates the shared cells from the
write set, bumps each version, and releases. If any version has moved on,
the transaction is invalidated and re-run from the beginning with a fresh
read and write set.

This is essentially multi-cell optimistic concurrency control. It is the same
algorithm databases use for serialisable snapshot isolation, just scaled down
to memory cells.

### Optimistic vs pessimistic concurrency

STM is optimistic by default. It assumes conflicts are rare, runs transactions
without locks, and only catches conflicts at commit. The win is that readers
never block writers and writers never block readers — until commit time, and
even there only briefly.

Pessimistic concurrency takes the opposite bet: acquire a lock before reading
or writing and hold it for the duration of the critical section. This avoids
restarts but creates contention and risks deadlock if locks are taken in
inconsistent orders. STM trades that contention for the cost of restarts. The
trade pays off when contention is moderate and transactions are short.

A middle-level practitioner notices the curve. If you can keep transactions
under a microsecond and conflict probability under a few percent, STM is hard
to beat. As either number rises, the optimistic bet starts losing.

### Composing transactions — `orElse`, `retry`

The reason STM transactions compose so cleanly is that they are values, not
side effects. An `STM a` action can be combined with another `STM b` action
without committing in between, and the runtime treats the combination as a
single atomic unit.

`retry` aborts the current transaction and instructs the runtime to re-run
it later, when one of the variables in its read set has changed. It is the
STM equivalent of a condition variable's `wait`, but it requires no manual
signalling, because the runtime already tracks which variables were read.

`orElse a b` runs `a`. If `a` commits, the result is `a`'s. If `a` calls
`retry`, the runtime discards `a`'s side effects within the transaction and
runs `b` instead. If both call `retry`, the union of their read sets is used
to decide when to wake up. This gives you a clean way to express "try this,
or that, or block until something changes" without any of the awkwardness of
select-style polling.

### What you cannot do inside (I/O, side effects)

The fundamental rule of STM is that a transaction may execute many times. It
will be retried on conflict, retried on `retry`, possibly retried for no
reason at all (some implementations restart transactions speculatively). For
this to be safe, the body of a transaction must be idempotent.

Pure computations are trivially idempotent. Reading and writing TVars is
idempotent because writes go to the buffer. What is not idempotent is
external side effects: writing to a file, sending a network packet, launching
a missile, calling `print`. Performing one of those inside a transaction
means it might happen zero, one, or many times.

Haskell enforces this with types. The `STM` monad does not have a
`MonadIO` instance. There is no `liftIO :: IO a -> STM a`. Inside
`atomically`, you simply cannot type-check code that performs `IO`. This is
one of the headline benefits of doing STM in a pure functional language: the
type system makes the unsafe pattern impossible to express by accident.

Clojure and Scala lack that enforcement. Their STM libraries document the
rule but rely on the programmer to follow it. A `dosync` block that calls
`(println ...)` will compile, run, and very occasionally print the line
twice. The bug is silent until contention is high enough to trigger restarts.

### Conditions and waiting — `retry` blocks until read-set value changes

The classic condition-variable pattern looks like:

```
lock.lock()
while (!condition) {
    cond.await()
}
do_something()
lock.unlock()
```

The bugs around this pattern are infamous: lost wakeups when the signaller
runs before the waiter, spurious wakeups that require the `while` loop,
forgetting to hold the lock when calling `signal`, calling `notify` instead
of `notifyAll` and starving a waiter.

STM's `retry` collapses the entire pattern into one line:

```haskell
atomically $ do
    x <- readTVar v
    when (not (condition x)) retry
    doSomething x
```

The runtime knows which variables you read (that is what the read set is
for), so it knows which variables it must observe to decide whether to wake
you. When any of them changes, it tries your transaction again. There is no
condition variable, no signaller, no lost wakeups, no spurious wakeups.

### STM datatypes — `TVar`, `TMVar`, `TChan`, `TQueue`

In Haskell, the standard `stm` package ships a small zoo of transactional
containers built on top of `TVar`:

- `TVar a` — single mutable cell, the atomic building block.
- `TMVar a` — a cell that is either empty or full. `takeTMVar` retries
  on empty, `putTMVar` retries on full. Useful for one-shot handoffs and
  semaphores.
- `TChan a` — unbounded FIFO. Multiple readers, multiple writers.
  Implemented as two TVars (read pointer, write pointer) wrapping a linked
  list of `TVar` cells.
- `TQueue a` — same shape as `TChan` but optimised: a pair of plain
  lists wrapped in two TVars. Cheaper enqueue/dequeue at the cost of
  losing the broadcast trick `TChan` supports via `dupTChan`.
- `TBQueue a` — a bounded variant that retries when full or empty.
  Natural backpressure.
- `TArray i a` — array of mutable cells, each a TVar.

All of these compose. You can read from a `TQueue`, write to a `TMVar`,
and update a `TVar` in one transaction and the runtime treats it as a single
atomic unit.

### Clojure's refs vs atoms vs vars

Clojure exposes three flavours of mutable reference, and confusion between
them is a common middle-level stumble:

- **`ref`** — STM-managed. Updated only inside `dosync`. Multiple refs can
  be updated in a single transaction; the runtime guarantees atomicity and
  isolation.
- **`atom`** — single-cell CAS. Updated with `swap!`. There is no
  transaction; the update function may run many times. Atoms do not
  coordinate with each other. Use them when one cell is enough.
- **`var`** — dynamic binding, threaded with `binding`. Not a concurrency
  primitive at all. The `binding` form lets you rebind a var for the dynamic
  extent of a block, useful for things like `*out*`.

The rule of thumb: reach for `atom` first. Only switch to `ref` when you
need two cells to change together.

### Validate-and-commit cycle, restart on validation failure

To make the commit step concrete, here is the sequence the runtime walks
through when `atomically tx` finishes its body:

1. Acquire the commit lock for each variable in the write set, in a
   canonical order (usually pointer address).
2. Walk the read set and check that every variable's version matches what
   was observed during execution.
3. If validation passes: write each variable's new value, bump its version,
   release the commit locks, return the result.
4. If validation fails: release the commit locks, discard the read and write
   sets, run the transaction body again with a fresh slate.

Step 4 is the restart. It is invisible from outside: callers see a single
atomic effect (possibly delayed). The body may have run many times; only the
last run's effect is observable.

### Granularity — fine vs coarse TVars

Choosing how much state lives in a single TVar is a recurring middle-level
decision. The extremes are:

- One big TVar holding the entire data structure. Every read touches it;
  every write conflicts with every other write. Simple to reason about,
  terrible under contention.
- One TVar per logical cell. Reads and writes that touch disjoint cells
  never conflict. More allocation, more pointer chasing.

The right answer depends on access patterns. A counter is one TVar. A queue
is two TVars (head and tail) plus per-node TVars only if you want
fine-grained dequeue. A hash map is often one TVar per bucket. A bank with a
million accounts is one TVar per account.

A useful heuristic: minimise the read set of the average transaction. If
your transactions repeatedly read a TVar they never write, that TVar is a
bottleneck the moment writers appear.

### Common middle bugs — long transactions, non-idempotent side effects, retry storms

Three failure modes account for most middle-level STM bugs:

- **Long transactions.** A transaction that runs for a millisecond touches
  many variables and has a high chance of being invalidated by some
  concurrent commit. It re-runs, runs long again, is invalidated again, and
  starves. Keep transactions short.
- **Non-idempotent side effects.** A `println` inside `dosync`, a counter
  incremented via a `java.util.concurrent.atomic.AtomicLong` from a `ref`
  transaction, a log line written to disk. All of them may happen zero or
  multiple times. Move them outside the transaction.
- **Retry storms.** A naive `retry` pattern where many waiters share a
  single triggering TVar can produce a thundering herd: one write wakes
  every waiter, they all run, only one commits, the others retry, and so
  on. Partition the wait condition, or batch wakeups.

---

## Real-World Analogies

- **Git rebase under load.** You clone, hack, push. If the upstream has
  moved, the push is rejected (validation failure). You rebase and push
  again (restart). Long-running branches conflict more often than short
  ones. Side effects you performed during the rebase (deploying to staging,
  emailing a colleague) cannot be rolled back — keep them outside the
  rebase.

- **Restaurant reservation system.** Two clerks check availability for the
  same table at the same time and both promise it to a customer. A
  pessimistic system locks the table the moment one clerk opens its page.
  An optimistic system lets both check, and at confirmation time refuses
  the slower clerk. STM is the optimistic clerk.

- **Optimistic locking in your favourite ORM.** Hibernate's
  `@Version` annotation, ActiveRecord's `lock_version`, Mongo's update
  with `_id` and `version` — all the same algorithm STM uses, just at a
  different scale.

- **Air-traffic control vs taxi dispatch.** Air traffic is pessimistic: a
  plane gets a slot, nobody else uses that slot. Taxi dispatch in a busy
  city is optimistic: many drivers see the request, the first to accept
  wins, the others are told to move on.

---

## Mental Models

**Model 1: STM as a database transaction with memory cells.** Every
`atomically` is a `BEGIN ... COMMIT`. Reads observe a consistent snapshot.
Writes go to a buffer. Validation at commit checks no one else changed your
read set. This model gets the semantics right and is the one to use when
explaining STM to someone who knows SQL.

**Model 2: STM as a multi-cell CAS.** Atomic CAS gives you a single-cell
optimistic update. STM gives you the same thing across many cells, with the
read set as the "expected version" vector and the write set as the
"new values" vector. This is the right model when reasoning about
performance.

**Model 3: STM as a tiny declarative language.** A value of type `STM a`
is a description of what to do, not a doing of it. You can build, combine,
and pass these descriptions around like any other value. `atomically`
finally runs one. This is the right model when designing APIs.

**Model 4: `retry` as a smarter `wait`.** Where condition variables make
you specify both the predicate and the channel, STM lets you specify only
the predicate. The runtime infers the channel from the read set. Whenever
you reach for a condvar, ask whether the predicate is expressible as a TVar
read.

---

## Code Examples

### Example 1: Haskell STM queue with `TQueue`

A bounded producer-consumer pipeline using `TBQueue`. Backpressure is
automatic: producers retry when the queue is full, consumers retry when it
is empty. No lock, no condvar, no signal.

```haskell
{-# LANGUAGE NumericUnderscores #-}

module Main where

import Control.Concurrent       (forkIO, threadDelay)
import Control.Concurrent.STM
import Control.Monad            (forM_, forever, replicateM_)

-- | A bounded transactional queue with capacity 8.
type Job = Int

producer :: TBQueue Job -> Int -> IO ()
producer q producerId = forM_ [1 .. 20] $ \i -> do
    let job = producerId * 100 + i
    atomically $ writeTBQueue q job        -- retries when queue is full
    putStrLn $ "producer " ++ show producerId ++ " enqueued " ++ show job
    threadDelay 50_000

consumer :: TBQueue Job -> Int -> IO ()
consumer q consumerId = forever $ do
    job <- atomically $ readTBQueue q      -- retries when queue is empty
    putStrLn $ "consumer " ++ show consumerId ++ " processed " ++ show job
    threadDelay 120_000                    -- consumers are slower than producers

main :: IO ()
main = do
    q <- atomically $ newTBQueue 8
    -- two producers, three consumers
    forM_ [1, 2]    $ \i -> forkIO (producer q i)
    forM_ [1, 2, 3] $ \i -> forkIO (consumer q i)
    threadDelay 5_000_000                  -- let it run for five seconds
```

A few things to notice:

- `writeTBQueue` and `readTBQueue` are `STM` actions, not `IO`. They
  block by calling `retry`, not by holding a lock.
- The capacity of 8 is the backpressure boundary. Producers slow down when
  consumers fall behind, automatically.
- The `putStrLn` calls happen outside `atomically`. Inside the transaction
  there is no I/O — Haskell's type system would not let us put it there.

### Example 2: Clojure linked list with `ref`

A simple singly-linked list where insertion and removal are transactional.
Multiple threads can mutate the list concurrently; STM serialises conflicts.

```clojure
(ns stm-list.core)

(defn make-list []
  {:head (ref nil) :size (ref 0)})

(defn lst-push! [lst v]
  (dosync
    (let [head @(:head lst)
          node {:val v :next head}]
      (ref-set (:head lst) node)
      (alter (:size lst) inc))))

(defn lst-pop! [lst]
  (dosync
    (let [head @(:head lst)]
      (when head
        (ref-set (:head lst) (:next head))
        (alter (:size lst) dec)
        (:val head)))))

(defn lst-size [lst]
  @(:size lst))

(defn -main [& _]
  (let [lst (make-list)
        writers (doall
                  (for [i (range 4)]
                    (future
                      (dotimes [j 250]
                        (lst-push! lst (+ (* i 1000) j))))))
        readers (doall
                  (for [_ (range 2)]
                    (future
                      (dotimes [_ 500]
                        (lst-pop! lst)))))]
    (run! deref writers)
    (run! deref readers)
    (println "final size" (lst-size lst))))
```

Notes:

- The `:head` and `:size` refs are coordinated. A push that bumped the head
  but not the size would expose a torn state to a concurrent `lst-size`.
  Wrapping both in one `dosync` makes them update together.
- No call to `(println ...)` lives inside `dosync`. Logging belongs after
  commit.
- `alter` reads and writes the ref through a function. `ref-set` overwrites
  unconditionally. Pick the one that reflects intent.

### Example 3: Scala STM bank with conditional retry

Using Scala STM (`scala-stm` library). A bank where transfers retry until
the source account has enough funds, rather than failing.

```scala
import scala.concurrent.stm._
import java.util.concurrent.Executors
import scala.concurrent.{ExecutionContext, Future}

case class Account(id: Int, balance: Ref[Long])

object BankSTM {
  def transfer(from: Account, to: Account, amount: Long): Unit =
    atomic { implicit txn =>
      if (from.balance() < amount) retry        // wait for a deposit
      from.balance() = from.balance() - amount
      to.balance()   = to.balance()   + amount
    }

  def deposit(acc: Account, amount: Long): Unit =
    atomic { implicit txn =>
      acc.balance() = acc.balance() + amount
    }

  def main(args: Array[String]): Unit = {
    val alice = Account(1, Ref(100L))
    val bob   = Account(2, Ref(0L))

    implicit val ec: ExecutionContext =
      ExecutionContext.fromExecutor(Executors.newFixedThreadPool(4))

    // Bob will wait until Alice has 500 to send.
    val transferF = Future { transfer(alice, bob, 500L) }

    // Alice's account is topped up in two installments.
    Future { Thread.sleep(200); deposit(alice, 300L) }
    Future { Thread.sleep(400); deposit(alice, 200L) }

    Thread.sleep(1000)
    println(s"alice=${atomic { implicit t => alice.balance() }}")
    println(s"bob=${atomic   { implicit t => bob.balance()   }}")
  }
}
```

Notice how `transfer` does not have to be wrapped in a polling loop. The
`retry` call blocks the transaction until the read set (in this case
`from.balance`) changes. When the deposit lands, the transfer is retried,
sees enough money, and commits.

---

## Pros & Cons

**Pros**

- Composability — small transactions combine into bigger ones without
  changing their internal locking discipline.
- Declarative waiting — `retry` makes condition logic short and obvious.
- No deadlocks (in well-designed implementations) — there are no locks to
  acquire in the wrong order.
- Type-enforced isolation in Haskell — the compiler rejects I/O in
  transactions.
- Optimistic reads — read-heavy workloads scale almost linearly.

**Cons**

- Restart cost — long or contended transactions may retry many times.
- Side-effect discipline — the programmer must keep transaction bodies
  pure, with type help only in Haskell.
- Memory overhead — every TVar carries a version counter and a wait queue.
- Library maturity varies — Haskell's `stm` is rock solid; Scala STM is
  small but stable; Java's Multiverse is abandoned; Clojure's STM is good
  but rarely the day-to-day choice.
- Hard to reason about under heavy contention — the abort/retry loop is
  invisible to most monitoring tools.

---

## Use Cases

- Coordinating a small number of in-memory cells that must change together
  (bank accounts, inventory ledgers, scoreboards).
- Producer-consumer pipelines with backpressure (`TBQueue`).
- Implementing condition-variable-like waits without the bug-prone
  primitive (`retry` on a status TVar).
- Sharing a small in-memory graph or list that mutates from multiple
  threads with simple invariants.
- Coordinating cancellation and timeouts (`orElse` with a `registerDelay`
  TVar).

Poor fits:

- Long-running batch computations that read and write thousands of cells.
- Code that performs unavoidable I/O at every step (use an actor or a
  message queue instead).
- Single-cell counters (use a CAS atomic).

---

## Coding Patterns

### Read-modify-write on a single TVar

```haskell
incrementBy :: TVar Int -> Int -> STM ()
incrementBy v n = modifyTVar' v (+ n)
```

Use `modifyTVar'` (strict) when the function is cheap and pure. The
strictness avoids building up thunks that resolve at commit and cause the
transaction to take longer than expected.

### Wait until a predicate holds

```haskell
waitUntil :: TVar a -> (a -> Bool) -> STM a
waitUntil v p = do
    x <- readTVar v
    if p x then return x else retry
```

This is the canonical `retry` pattern. The runtime parks the transaction
until `v` is written.

### Try-then-fallback

```haskell
takeOrSentinel :: TQueue a -> a -> STM a
takeOrSentinel q sentinel =
    readTQueue q `orElse` return sentinel
```

`orElse` discards the side effects of the first branch's transactional
state if it calls `retry` (it had none here, since `readTQueue` only
modifies its own read set), then runs the second branch.

### Bounded retry with timeout

```haskell
import Control.Concurrent.STM.TVar (registerDelay)

withTimeout :: Int -> STM a -> IO (Maybe a)
withTimeout micros action = do
    delay <- registerDelay micros
    atomically $
        (Just <$> action) `orElse` (do
            timedOut <- readTVar delay
            if timedOut then return Nothing else retry)
```

`registerDelay` returns a `TVar Bool` that flips to `True` after the
given number of microseconds. Combined with `orElse`, you have a
transactional timeout.

### Compound update across multiple TVars

```clojure
(defn transfer [from to amount]
  (dosync
    (alter from - amount)
    (alter to   + amount)))
```

Two updates, one transaction. Either both happen or neither does.

### Snapshot read

```clojure
(defn snapshot [lst]
  (dosync
    {:head @(:head lst)
     :size @(:size lst)}))
```

A consistent snapshot is just a transaction that does nothing but read.

---

## Clean Code

- **Transactions are values; name them.** A top-level `transferTx ::
  Account -> Account -> Money -> STM ()` is easier to compose, test, and
  document than the same logic inlined in `atomically`.
- **Keep `atomically` at the top of your stack.** Define `STM` actions
  in your domain layer and call `atomically` at the IO boundary. This
  makes the side-effect frontier explicit.
- **One responsibility per transaction.** A transaction that does too
  many things has a big read set and is contended. Split where the
  business logic naturally splits.
- **Prefer `modifyTVar'` over `readTVar` + `writeTVar`.** It is shorter
  and prevents an accidental write of a stale value.
- **Avoid `unsafePerformIO` inside transactions.** Yes, it exists. No,
  you cannot use it to log. The runtime will run your transaction many
  times and your "log" will be lies.

---

## Best Practices

- Keep transactions short. Sub-microsecond if you can. A long transaction
  is a contention magnet.
- Move I/O outside `atomically`. Build the value inside, perform the
  effect outside.
- Use bounded queues (`TBQueue`) for backpressure rather than unbounded
  ones (`TQueue`) for production code.
- Minimise the read set. Every variable you read is one more place a
  concurrent writer can invalidate you.
- Prefer `atom` to `ref` in Clojure when one cell is enough. Pay for STM
  only when you need it.
- Use `orElse` to express "try, or try, or wait" rather than polling
  loops with `Thread.sleep`.
- Document transaction boundaries in the type signature. `STM a` and
  `IO a` carry meaning; do not coerce between them silently.
- Profile contention. If you cannot tell which TVar is contended, you
  cannot fix it.

---

## Edge Cases & Pitfalls

- **Empty transactions.** `atomically (return ())` is legal but pointless.
  Some test suites use it as a memory barrier; do not rely on that
  behaviour.
- **Nested `atomically`.** Haskell's `atomically` cannot be nested
  (the type system rejects it). Clojure's `dosync` can be nested and
  the inner one joins the outer. Scala STM joins as well.
- **Aborted transactions in Clojure.** `dosync` may run a transaction
  many times. Side effects in the body (Java method calls, etc.) may
  execute many times. The fix is to move them out, not to mark them
  "do not retry".
- **TVars holding lazy thunks.** A TVar of `Int` that has had `+1`
  applied to it ten thousand times without forcing holds a giant thunk.
  Reading it will be slow. Use `modifyTVar'`.
- **Read set explosion.** A transaction that walks a long linked list of
  TVars has a read set proportional to list length. Any write to any node
  invalidates the whole transaction.
- **Starvation.** A long transaction can be invalidated repeatedly by
  short ones. Haskell GHC has heuristics to prioritise long-running
  transactions, but the best fix is to make them shorter.
- **Subtle visibility bugs in Clojure with `commute`.** `commute` does
  not enforce ordering with respect to other writers. Use only when the
  function is commutative; otherwise use `alter`.

---

## Common Mistakes

- Putting a `println` inside `dosync` or `atomically`. The log line is
  not transactional and may print multiple times.
- Reaching for `ref` when an `atom` would do. STM is heavyweight; CAS
  is cheap.
- Building one giant TVar for the whole world. Every transaction
  conflicts with every other.
- Using a polling loop with `Thread.sleep` because the developer did
  not know about `retry`.
- Calling `retry` inside an `atomic` block as a way of "saying try
  again later" without realising that the runtime will not wake the
  transaction until a read-set TVar changes.
- Catching exceptions inside a Haskell `STM` block and swallowing them,
  thereby committing inconsistent state.
- Holding references to TVars in long-lived caches without thinking about
  what happens when readers stop reading them.

---

## Tricky Points

- **`retry` does not consume CPU.** It parks the thread on the read set's
  wait queues. When any of those TVars is written, the thread is woken.
  This is a runtime feature, not a polling loop.
- **`orElse` composes commutatively up to its first commit.** `a
  `orElse` b` runs `b` only if `a` retries. `b` is not run in parallel
  with `a`. The order matters when both are commit-able.
- **Validation may be partial.** Some implementations use opacity
  algorithms that detect inconsistent read sets mid-transaction and abort
  early, rather than waiting for commit.
- **Haskell's STM is single-machine only.** Distributed STM is a
  research area and not what `stm` provides.
- **Commit is not free.** Validating the read set takes time proportional
  to its size. A transaction that reads a thousand TVars pays for that
  every commit.
- **`commute` in Clojure runs the function once at commit.** It does not
  retry. Use it when the operation is commutative and you can prove the
  current value is irrelevant to other transactions.

---

## Test Yourself

1. What two thread-local data structures does an STM transaction maintain
   while running?
2. Walk through what happens when `atomically` commits, step by step.
3. Why does Haskell's type system forbid `IO` inside `STM`?
4. What is the difference between `retry` and `orElse`?
5. Why is a `print` call inside `dosync` a bug, not a feature?
6. How does the runtime know when to wake a transaction that called
   `retry`?
7. When would you choose `atom` over `ref` in Clojure? When the reverse?
8. What is the cost of having a very large read set per transaction?
9. Sketch a transactional bounded queue using two TVars. What is the
   minimum number of TVars you need?
10. Why is `modifyTVar'` usually preferred over `readTVar` + `writeTVar`?
11. What does `registerDelay` return and what is it used for?
12. Why is STM a poor fit for transactions that perform I/O?

---

## Tricky Questions

1. A transaction reads TVar `a`, writes TVar `b`, then reads TVar `c`.
   Which variables are in the read set? Which in the write set?
2. Two transactions both increment the same counter. They start at the
   same time. What is the worst-case number of restarts before both
   commit?
3. Suppose `tx1` runs for one second and reads ten TVars. `tx2` runs
   for one microsecond and writes one of those TVars every millisecond.
   How often will `tx1` succeed?
4. Why can't you express "transactionally write to stdout" in Haskell?
   What workaround do real programs use?
5. Two threads each `retry` on a different predicate over the same TVar.
   A third thread writes the TVar. How many wakeups happen? Which ones
   commit?
6. You have a thousand-account bank. You implement transfer as a single
   transaction over two account TVars. A reporting thread sums all
   thousand TVars in one transaction. What happens during steady transfer
   traffic?
7. Inside `dosync`, you call a function that itself calls `dosync`.
   What happens at runtime? How does this differ from Haskell?
8. Why does `commute` in Clojure not retry on conflict, while `alter`
   does?
9. You profile your STM-heavy code and see 30% of CPU spent on read-set
   validation. What can you do?
10. A junior teammate replaces every `atom` in the codebase with a `ref`
    "for safety". What problems are they likely to introduce?

---

## Cheat Sheet

```text
ATOMICITY
  read set       observed (var, version) pairs
  write set      buffered (var, new value) pairs
  commit         lock writes -> validate reads -> publish -> release
  abort/restart  on validation failure or retry call

WAITING
  retry          park transaction; wake on any read-set write
  orElse a b     run a; if a retries, run b
  registerDelay  TVar Bool that flips after N microseconds

DATATYPES (Haskell)
  TVar a         one mutable cell
  TMVar a        full/empty handoff
  TChan a        unbounded broadcast queue
  TQueue a       unbounded FIFO (faster than TChan)
  TBQueue a      bounded FIFO with backpressure
  TArray i a     array of TVars

CLOJURE
  ref            STM coordinated cell
  atom           CAS single cell
  var            dynamic binding (not concurrency)
  dosync         start transaction
  alter          (f cur args) write new value
  ref-set        overwrite unconditionally
  commute        commit-only write; no retry

PITFALLS
  no IO inside transaction
  short transactions only
  small read sets only
  modifyTVar' over read+write
  one atom is cheaper than one ref
  retry is parking, not polling
```

---

## Summary

A middle-level grasp of STM rests on understanding three things. First, the
optimistic algorithm: every transaction keeps a private read set and write
set, validates the read set at commit, applies the write set atomically, and
restarts from scratch on conflict. Second, the composition primitives:
`retry` parks a transaction until its read set changes, `orElse` falls
back to an alternative, and both compose under `atomically` because
transactions are values, not effects. Third, the family of datatypes that
ride on `TVar` — `TMVar`, `TChan`, `TQueue`, `TBQueue` in Haskell,
plus their cousins in Clojure and Scala — which let you express
producer-consumer, handoff, and condition-wait patterns without ever
touching a lock or a condvar.

The tradeoffs are real. STM trades raw throughput for clarity, makes I/O
inside transactions impossible (in Haskell) or unsafe (everywhere else),
and pays a cost proportional to read-set size at every commit. It rewards
short transactions, fine-grained TVars, and side-effect-free bodies.
Knowing where these limits bite is the difference between a programmer who
reaches for STM reflexively and one who reaches for it with intent.

---

## What You Can Build

With middle-level STM you can confidently build:

- A multi-producer multi-consumer pipeline with bounded backpressure.
- An in-memory inventory or ledger with strict invariants across cells.
- A transactional cache that coordinates eviction, insertion, and read
  statistics in one place.
- A small scheduler that uses `orElse` and `registerDelay` for timeouts.
- A connection pool where checkout, checkin, and capacity changes are
  transactional.
- A leaderboard or game state with consistent multi-cell updates.
- A simple message-broker mailbox per client with `TMVar` and `TChan`.

---

## Further Reading

- *Beautiful Concurrency*, Simon Peyton Jones — the classic introductory
  essay on Haskell STM.
- *Composable Memory Transactions*, Harris, Marlow, Peyton Jones,
  Herlihy — the foundational STM paper.
- *Transactional Memory*, Larus and Rajwar — book-length survey.
- Rich Hickey's *Are We There Yet?* talk — design rationale for Clojure
  refs vs atoms vs agents vs vars.
- `scala-stm` documentation, especially the section on transactional
  resource handles.
- Tim Harris's research pages on opacity and progress guarantees in STM.

---

## Related Topics

- [STM senior level](senior.md)
- [Locks and condition variables](../03-locking/README.md)
- [Atomic operations and CAS](../04-atomics/README.md)
- [Actors](../06-actors/README.md) — a different answer to the same
  problem
- [Message passing](../07-message-passing/README.md)
- [Database transactions](../../../databases/transactions/README.md) for
  the prior art STM borrows from

---

## Diagrams & Visual Aids

### Validate-and-commit cycle

```
+----------+    BEGIN     +----------------+    COMMIT    +-----------+
|  client  |------------->|  transaction   |------------->|  shared   |
| atomic { |              |  body (pure)   |   validate   |  TVars    |
|   ...    |              |  read set R    |   apply W    |           |
| }        |              |  write set W   |              |           |
+----------+              +----------------+              +-----------+
                                  |                              ^
                                  | validation fails             |
                                  +------------------------------+
                                       restart with fresh R,W
```

### `retry` wait flow

```
transaction reads TVars {a, b, c}, calls retry
   |
   v
runtime parks thread on wait queues of a, b, c
   |
   v   another thread writes b
   |
   v
runtime wakes the parked thread
   |
   v
transaction re-runs with fresh read set
```

### `orElse` decision tree

```
atomically (txA `orElse` txB)
   |
   +--- txA runs
   |     |
   |     +-- commits -> done
   |     |
   |     +-- calls retry -> roll back txA's writes
   |             |
   |             v
   |          txB runs
   |             |
   |             +-- commits -> done
   |             |
   |             +-- calls retry -> wait on union of read sets,
   |                                then re-run from txA
```

### Granularity choice

```
COARSE (one TVar holds whole map)
+----------+  every writer conflicts with every reader
| TVar Map |  reads cheap, writes serialise
+----------+

FINE (one TVar per bucket)
+--+--+--+--+--+--+--+--+
|T0|T1|T2|T3|T4|T5|T6|T7|  reads and writes to different buckets
+--+--+--+--+--+--+--+--+  do not conflict; more allocation
```
