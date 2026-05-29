# STM — Interview Questions

> **Topic:** [STM](README.md)

---

## Introduction

Software Transactional Memory (STM) is a concurrency control mechanism that borrows the transactional abstraction from databases and applies it to shared in-memory state. Instead of acquiring locks to protect critical sections, a thread runs a block of code optimistically against transactional variables; on commit the runtime either atomically publishes all writes or detects a conflict and retries the block from the beginning. The model is appealing because composition of transactional blocks remains correct — a property notoriously hard to achieve with hand-written lock hierarchies, where lock ordering, deadlock avoidance, and invariant preservation each demand discipline that does not scale across modules.

Interview questions on STM probe whether a candidate understands the model deeply enough to use it well and reject it where it does not fit. STM is not a universal hammer: it forbids I/O inside transactions because the runtime may execute the body any number of times; it pays a real overhead in bookkeeping; and certain workloads (write-heavy contention on the same variable, long transactions that interact with many cells) starve or thrash. A strong answer separates the theoretical guarantee (snapshot isolation or serializability, depending on the implementation) from the practical engineering envelope (which Haskell, Clojure, Scala, and GCC each implement differently).

This file collects roughly seventy questions ranging from foundational ("what is STM?") through language-specific ("how does Haskell's `retry` interact with `orElse`?") to design scenarios and runnable coding exercises. Each answer is written for a candidate at the senior or staff level: enough depth to teach, enough rigor to defend the answer under follow-up. The "Tricky" section calls out the failure modes that catch even experienced engineers — write skew, retry storms, accidental I/O inside `dosync`, and the subtleties of nested aborts.

The point of practising these questions is not to memorise; it is to internalise the small set of invariants — atomicity, isolation, no side effects, composable retry — that make STM behave the way it does. Once those invariants click, every concrete question reduces to applying them.

## Table of Contents

- [Conceptual / Foundational](#conceptual--foundational)
- [Language-Specific](#language-specific)
- [Tricky / Trap](#tricky--trap)
- [System / Design Scenarios](#system--design-scenarios)
- [Coding Questions](#coding-questions)
- [Behavioral](#behavioral)
- [What I'd Ask a Candidate Now](#what-id-ask-a-candidate-now)
- [Cheat Sheet](#cheat-sheet)
- [Further Reading](#further-reading)
- [Related Topics](#related-topics)

---

## Conceptual / Foundational

### Q: What is Software Transactional Memory?

STM is a concurrency control technique where blocks of code execute as memory transactions over a set of transactional variables. Inside a transaction the runtime records every read and every tentative write into a per-thread log. At commit time the runtime validates the read set against the current values in shared memory: if nothing the transaction read has changed, the writes are applied atomically; otherwise the log is discarded and the block re-executes from the start. The programmer writes sequential-looking code; the runtime supplies atomicity and isolation.

The model is analogous to database transactions but operates over heap cells (TVars in Haskell, refs in Clojure) instead of rows. Because the runtime owns conflict detection and retry, the programmer is freed from designing lock orders or worrying about which mutex protects which field. The cost paid for that freedom is bookkeeping overhead and a requirement that transaction bodies be replayable.

### Q: What does it mean to say STM gives "ACID for memory"?

The phrase emphasises that STM provides three of the four ACID properties for in-memory state: Atomicity (all writes commit or none do), Consistency (invariants checked at the boundary of a transaction hold), and Isolation (other threads cannot observe partial states of a transaction). Durability does not apply because the variables live in volatile memory. The analogy is helpful because most programmers already understand transactions in a database context, and STM lets them re-use that mental model for shared heap data.

A nuance is that the isolation level differs by implementation. Haskell's STM offers serializability via optimistic concurrency with read validation; Clojure's refs offer multiversion concurrency control yielding snapshot isolation by default and serializable consistency for transactions that use `ensure`. The candidate should not say "STM is serializable" without qualifying which STM.

### Q: Compare optimistic and pessimistic concurrency, and place STM on that spectrum.

Pessimistic concurrency assumes contention is likely and prevents conflicts in advance by taking locks before touching shared state; readers and writers may block each other depending on lock type. Optimistic concurrency assumes contention is rare and lets transactions proceed without coordination, validating at commit and rolling back on conflict. STM is fundamentally optimistic: a transaction runs to completion in a private log, then atomically attempts to publish. If another transaction has invalidated the read set, the current attempt aborts and re-runs.

The implication is that STM performs well under low to moderate contention and poorly under heavy write contention on the same cell, where transactions keep aborting each other. A senior answer notes that hybrid systems exist — for example, escalating to a global lock after N retries — and that workload analysis must precede the choice between optimistic STM and pessimistic locking.

### Q: Why is STM composable while locks are not?

Composability means combining two correct concurrent operations yields a third correct operation without reasoning about the internals. With locks this fails: calling `withdraw(a)` and `deposit(b)` separately each acquires its own lock; composing them into `transfer(a, b)` requires acquiring both locks in some agreed global order to avoid deadlock, which forces every module to know about every other module's locks. With STM, `atomically (withdraw a >> deposit b)` is correct by construction because the runtime merges the inner transactions into a single atomic block; conflicts are detected uniformly and there is no lock order to violate.

The composability story is the single strongest argument for STM. It is what lets libraries publish transactional primitives that callers can stitch together without coordination. Locks force a global protocol; STM lets each module remain local.

### Q: Why is I/O forbidden inside an STM transaction?

The runtime may execute the body of a transaction zero, one, or many times: zero if it is aborted before any commit attempt, one in the happy path, and many under contention or via the `retry` primitive. Any side effect that escapes the heap — printing to a terminal, sending a network packet, writing a file — would be performed each time the body ran, producing duplicates, partial messages, or worse. Haskell encodes this prohibition in its type system: the `STM` monad is distinct from `IO`, and the only way to perform `IO` is to first commit via `atomically`, which lifts a successful transaction into the `IO` monad exactly once.

Languages without that type-level guarantee, notably Clojure and Scala, rely on programmer discipline. The convention is to compute the result inside the transaction and emit any side effects only after `dosync` returns. Violating this in Clojure is a common source of bugs (see Tricky section).

### Q: How does an STM runtime detect a conflict?

At commit, the runtime walks the read set captured during execution. For each TVar in the set it compares the version stamp (or the value, depending on implementation) observed at read time with the current stamp in shared memory. If any stamp has advanced, another transaction has written a cell this one read, and the current commit aborts; the log is discarded, the body re-runs. If all stamps match, the runtime atomically swings the new values in via compare-and-swap on a global lock or via a fine-grained per-cell mechanism.

Implementations differ in granularity. GHC uses a coarse global version counter for fast commits at the cost of higher false-positive abort rates under contention. Some research STMs use per-cell ownership records. The trade is between commit throughput on uncontended workloads and abort behaviour on contended ones.

### Q: What are the retry semantics of STM?

When a transaction aborts because of a conflict, the runtime automatically re-executes the body from the beginning with a fresh log. This automatic retry is invisible to user code: the programmer writes a single sequential block and trusts that on commit either everything succeeded or the runtime is trying again. In Haskell there is also a programmer-visible `retry` primitive that explicitly aborts the current transaction and asks the runtime to re-run only when one of the TVars read so far has changed; this is the basis for blocking on conditions without spinning.

The runtime tracks the read set precisely enough to register the calling thread as a waiter on every TVar in that set, then suspends until any one of them is written. This is far more efficient than a busy retry loop and is one of STM's most elegant features.

### Q: What is the `orElse` choice operator and what is it for?

`orElse a b` runs transaction `a`; if `a` calls `retry`, the runtime discards `a`'s effects, runs `b`, and uses `b`'s outcome instead. Only if both branches retry does the composed transaction itself retry. This gives a clean way to express "try this, fall back to that" without inventing ad hoc state or exceptions. The two classic uses are non-blocking variants of operations ("try to pop a queue, otherwise return Nothing") and waiting on the first of several conditions ("wait for either a timeout TVar or a data TVar to be ready").

`orElse` is a fundamentally STM-only construct: it has no analogue in a lock-based world because there is no general way to undo arbitrary side effects after the fact. The runtime can undo a transactional retry because the log was never committed.

### Q: What is the write skew anomaly?

Write skew is a concurrency anomaly possible under snapshot isolation but not under serializability. Two transactions each read overlapping data, each makes a decision based on what they read, and each writes a disjoint subset; their writes do not conflict directly but the combined effect violates an invariant that depended on both transactions seeing each other's writes. The classic example is the "two doctors on call" scenario: each doctor checks that at least one other doctor is on call before going off; if both check simultaneously, both see one other, both go off, and the invariant "at least one on call" is broken.

STM implementations that provide snapshot isolation (Clojure refs without `ensure`) are susceptible. Programmers must promote the read to a read-with-conflict using `ensure` (Clojure) or by also writing the read cells. Haskell's STM, being serializable, does not have this anomaly.

### Q: Snapshot isolation versus serializability — which does STM provide?

Snapshot isolation guarantees each transaction sees a consistent snapshot of memory taken at its start; concurrent transactions whose writes touch disjoint cells can both commit even if their reads overlapped. Serializability guarantees the outcome of executing the transactions concurrently is equivalent to some sequential ordering of them; write skew cannot occur. Both rule out dirty reads and lost updates but they differ on more subtle interleavings.

Clojure's refs default to snapshot isolation and offer `ensure` to obtain serializability on demand for specific reads. Haskell STM and Scala's `scala-stm` provide full serializability via read-set validation. The choice involves cost: serializability requires tracking and validating the entire read set, while snapshot isolation can validate only the write set, leading to fewer aborts under read-heavy workloads.

### Q: What is "transactional memory in hardware" (HTM) and how does it relate to STM?

HTM is hardware support for transactions: special CPU instructions (Intel TSX, IBM Power TM, ARM TME) begin a transaction, the cache tracks reads and writes, and a commit instruction atomically publishes all changes if no other core touched the cache lines involved. STM is the software analogue, implemented entirely in user-space runtimes, with no hardware support required. HTM is faster on uncontended short transactions but has hard limits on transaction size (cache capacity) and forbids many operations (system calls, certain instructions). STM is slower per transaction but unbounded in size and freely allows any non-I/O code.

The practical pattern in research and some production systems is hybrid TM: try HTM first, fall back to STM on hardware abort. The candidate should know HTM exists and that pure STM is the realistic default for application code in Haskell, Clojure, and Scala today.

### Q: What are the typical overheads of STM?

Each transactional read pays the cost of a log lookup (to honour the snapshot view) and a log append; each write appends to the log. Commit pays the cost of validating the read set and atomically publishing the write set. Compared to a single uncontended lock acquisition, an STM transaction is materially heavier: order-of-magnitude papers cite 2x to 10x slowdown on micro-benchmarks. As contention rises, STM degrades by aborting and retrying, which amplifies the cost. Lock-based code degrades by serializing threads, which can be cheaper if contention is moderate.

The senior framing is that STM's overhead buys composability and freedom from deadlock; whether that price is worth it depends on the workload and the team's ability to maintain a lock-based design.

### Q: Can STM deadlock or livelock?

STM cannot deadlock in the traditional sense because there are no locks held across transactional boundaries; the runtime always makes progress by aborting one side of a conflict. STM can livelock: two transactions repeatedly conflict, each abort and retry, each abort the other again, and no transaction commits. Most production runtimes mitigate livelock with exponential backoff on abort or by escalating to a coarse lock after a threshold of retries. Long-running transactions can also be starved by a steady stream of short ones that keep invalidating the long read set.

A careful answer distinguishes deadlock (impossible) from livelock and starvation (possible but mitigable) and names the standard runtime mitigations.

### Q: What kinds of programs are not a good fit for STM?

STM is poor for high-contention single-cell hot spots (every thread incrementing the same counter), long transactions that touch many cells in a constantly mutated graph, and any operation that must perform side effects atomically with state changes (writing to a socket as part of "send and record"). For counters, a CAS loop is simpler and faster. For long transactions over hot data, a coarse lock or a queue-based actor is more predictable. For atomic state-plus-IO, message-passing or an outbox pattern is the right fit.

A good rule is to reach for STM when invariants span multiple cells and you need composability; reach for simpler primitives otherwise.

### Q: How does STM relate to database transactions historically and conceptually?

STM was explicitly inspired by database transactions: the ACID concept, optimistic concurrency control with read-set validation, and snapshot isolation all transfer from the database literature into STM. The original 1995 paper by Herlihy and Moss on transactional memory framed the work as applying database insights to multiprocessor cache coherence. Later work by Harris and Fraser (2003) and the Composable Memory Transactions paper (2005) refined STM into the form Haskell adopted.

The conceptual difference is that database transactions persist across machines and survive crashes (the D in ACID); STM transactions live and die within a process and provide only AIC. Both share the core engineering trade-off: more isolation costs more in bookkeeping and aborts. Senior candidates draw the parallel naturally and use database mental models to reason about STM.

### Q: What is "early release" in STM, and why is it controversial?

Early release is a primitive in some research STMs that lets a transaction declare it no longer needs a particular cell in its read set, removing that cell from validation at commit. The use case is iterating a data structure where early items are not relevant by the end. It can dramatically reduce abort rates for long traversals.

The controversy is that early release breaks the invariant that the transaction observed a consistent snapshot of all its reads; the programmer must prove the read it released does not constrain the writes it performed. This is exactly the reasoning STM was supposed to eliminate. Production STMs (Haskell, Clojure, Scala) do not expose early release. Knowing the concept demonstrates familiarity with the research literature.

---

## Language-Specific

### Q: How does Haskell's STM monad enforce correctness?

In Haskell, transactional code has type `STM a` rather than `IO a`. The two monads are distinct and there is no function `STM a -> IO a` accessible inside `STM`; the only escape is `atomically :: STM a -> IO a`, which is callable only from `IO`. This means a function in `STM` cannot perform file I/O, network calls, or any other side effect — the type system forbids it at compile time. The same mechanism prevents nested `atomically` (you cannot run `IO` inside `STM`, so you cannot run `atomically` inside `STM`), eliminating a whole class of nesting confusion.

The TVar, TMVar, TQueue, and TChan families live in `STM`; reading and writing them is a transactional action. The runtime guarantees the body of `atomically` runs as a single transaction with isolation against other `atomically` calls. Composing transactions is straightforward monadic sequencing: `atomically (do x <- readTVar a; writeTVar b (x+1))`.

### Q: How do `retry` and `orElse` work together in Haskell STM?

`retry` aborts the current transaction and asks the runtime to suspend the thread until at least one TVar in the read set is written; the runtime then re-runs the body. `orElse t1 t2` first attempts `t1`; if `t1` calls `retry`, its writes are discarded and `t2` is run; if `t2` also retries, the composed transaction itself retries on the union of both read sets. The combination lets you express "block until any of these conditions is true" by composing `retry`-using actions with `orElse`.

The senior detail is that the read set for blocking includes every TVar touched in any branch tried, so the wake-up is precise; a thread is not woken spuriously by writes to unrelated cells.

### Q: What is a TQueue and how is it implemented?

A `TQueue a` is an unbounded FIFO queue with transactional read and write operations. The standard implementation uses two TVars holding lists: a read end (consumers pop from the head) and a write end (producers cons to the head, semantically pushing to the tail). When the read end is empty, the consumer reverses the write end into the read end and proceeds. This dual-list design amortises operations to O(1) per push and pop. `readTQueue` calls `retry` when both lists are empty, blocking until a producer commits a write.

The implementation showcases STM idioms: separate TVars for separate concerns to minimise read-set overlap between producers and consumers; `retry` for blocking; and atomic transitions that swap lists without locks.

### Q: How do Clojure refs and `dosync` work?

A Clojure ref holds an immutable value and supports transactional mutation via `dosync`. Inside `dosync`, `ref-set`, `alter`, and `commute` mutate refs; the runtime uses MVCC to give the transaction a consistent snapshot, then commits if no other transaction has invalidated the writes. `alter` and `ref-set` cause the transaction to retry if the underlying ref changed after it was read; `commute` is a commutative update that can be re-ordered with other commutes, reducing contention. `ensure` adds a ref to the read set without writing it, providing serializability for that read.

Because Clojure does not have a type system to forbid I/O inside `dosync`, the convention "no side effects inside" is enforced by code review and habit. The runtime will, however, retry side effects along with the transaction body, producing duplicates if the convention is broken.

### Q: What is `commute` in Clojure and when do you use it?

`commute` is a transactional update for commutative operations — operations whose order does not affect the final result, such as addition, multiplication, set union. When you `commute` a ref, the transaction records the function but does not constrain its position relative to other commutes; at commit, the runtime applies all queued commutes in some order on the latest value, with no conflict among commutes. The result is that two transactions both incrementing the same counter via `commute` never abort each other; both commit successfully and both increments apply.

The trade is that you do not see the value the function will be applied to during the transaction, so you cannot make decisions based on it. Use `commute` for "blind" updates like counters and accumulators; use `alter` when the decision depends on the current value.

### Q: How does scala-stm differ from Haskell STM?

`scala-stm` provides `Ref`, `atomic`, and `retry` similar to Haskell, but it operates within the JVM and has no type-level guarantee against side effects. The library uses `atomic { implicit txn => ... }` to mark transactional blocks; reads and writes go through the implicit `InTxn` token. Like Haskell, `scala-stm` is serializable and supports `retry` and `orElse`. Unlike Haskell, an undisciplined developer can perform IO inside `atomic`, and the runtime will replay it on retry.

The library was extracted from research on integrating STM into JVM languages; it is mature but less widely adopted than the Haskell or Clojure variants. Its main advantage is interoperability with existing Scala and Java code.

### Q: How does GCC's `__transaction` work?

GCC implements transactional memory extensions for C and C++ via `__transaction_atomic { ... }` and `__transaction_relaxed { ... }` blocks. The compiler instruments memory accesses inside the block to use the runtime's STM library (or hardware TM where available). The model supports rollback on conflict, automatic retry, and limited support for irrevocable actions (which serialize the transaction with a global lock so they can be safely performed). The work was driven by the C++ TM specification effort, which ultimately did not standardise in C++ but remains available as a GCC extension.

Senior context: HTM faded somewhat after the TSX side-channel disclosures and the C++ TM TS was deprecated. Today GCC's `__transaction` is more an experimental capability than a production target; serious systems-level TM in C++ tends to use Intel's TSX directly or research libraries.

### Q: Difference between `__transaction_atomic` and `__transaction_relaxed`?

`__transaction_atomic` is a strict transactional block: only TM-safe code may be called inside it. Calling a function whose body has not been instrumented for TM is a compile error. `__transaction_relaxed` is permissive: it allows calling un-instrumented code by falling back to a global lock (irrevocable mode) when the transaction enters such code. The relaxed form is more practical because real codebases mix transactional and non-transactional functions; the atomic form is safer because it catches dangerous calls at compile time.

The trade is rigor versus integration cost. A senior systems engineer would note that the relaxed form's fallback can cause surprising serialisation in production, and so deserves the same observability treatment as any other coarse lock.

### Q: How does Haskell STM compose with `MVar` and other concurrency primitives?

`STM` and `MVar` live in different worlds: `MVar` operations are in `IO`, not `STM`, so they cannot appear inside `atomically`. The way they compose is sequentially: a transaction commits, returns a value, and the calling `IO` code then takes or puts an `MVar` based on that value. If you need transactional-style coordination, use `TMVar` (the STM equivalent) instead.

The candidate should know that `TVar`, `TMVar`, `TChan`, `TQueue`, and friends form a coherent STM ecosystem, while `MVar`, `IORef`, and `Chan` form a separate IO-based ecosystem. Mixing them is a smell — pick one model per subsystem.

---

## Tricky / Trap

### Q: A Clojure developer puts `(println "transferred")` inside `dosync`. What is wrong?

`dosync` may re-run the body multiple times under contention. Each retry executes the println, so the user sees "transferred" possibly two, three, or more times even though only one transfer was committed. Worse, if the transaction aborts and never commits, the println still runs at least once and lies about a transfer that did not happen. The fix is to compute the result inside `dosync` and emit the side effect after the `dosync` form returns: `(let [result (dosync ...)] (println "transferred"))`.

Naive thinking is that `dosync` "looks atomic" so anything inside it must happen atomically with the commit. The correct mental model is that the body is a recipe the runtime may replay; only ref mutations are managed by the runtime, everything else escapes.

### Q: Two threads increment the same counter via STM at high rate; throughput collapses. What is happening?

This is a retry storm. Each transaction reads the counter, computes `n+1`, and tries to write; whichever commits first invalidates all others, which abort and retry; on retry they read the new value and conflict again. The contention is total because every transaction touches the single hot cell. Throughput becomes worse than a single-threaded loop because each thread pays log overhead repeatedly without making progress.

The remedies are workload-dependent: use Clojure's `commute` (allows commutative updates without conflict), use a CAS-loop primitive (much cheaper than STM for a single cell), or shard the counter into N cells and aggregate. The mistake is reaching for STM when a single cell needs many updates per second; STM rewards transactions that span multiple cells with infrequent conflict.

### Q: A long transaction over a frequently mutated map repeatedly aborts. Why and how do you fix it?

Long transactions hold a large read set, and the more cells they read, the higher the chance some other transaction writes one of them and forces a retry. If other writers are steady and the long transaction is long, it may never commit — starvation. Naive intuition is that "the runtime should be fair"; STM runtimes are not fair to long transactions by default.

The fix is structural: break the long transaction into smaller pieces if semantics allow; or move that workload to a coarse lock that the runtime cannot abort; or batch updates such that the long transaction's read set is decoupled from the high-frequency writers. Some runtimes offer priorities or escalation to a global lock after N aborts; Haskell does not have this built in.

### Q: Two transactions appear to write disjoint fields of two refs, but you still observe an invariant violation. What anomaly is this?

Write skew. Each transaction reads both refs, makes a decision based on what they both contain, then writes only one. The runtime sees no read-write conflict because the writes do not overlap with what the other read; under snapshot isolation (Clojure's default), both commit. The combined effect breaks the invariant that depended on each transaction observing the other's writes.

Naive intuition is "I have STM, so my invariants hold." The fix is to promote the read into a conflict: in Clojure, call `ensure` on the refs you read but do not write; in Haskell, write back the same value to bring the cell into the write set; or write the cells in a single transaction that does observe a combined view. The lesson is that snapshot isolation is not serializability.

### Q: You have one TVar holding a record with two fields. Two transactions update disjoint fields and conflict. Why?

STM tracks conflicts at the granularity of the TVar, not its fields. Both transactions read and write the same TVar, so they conflict, even though they conceptually update unrelated parts. Naive thinking is that the runtime should be smart enough to see disjoint field accesses; it is not, because the TVar holds an opaque value that the runtime cannot decompose.

The fix is to split the record into two TVars, one per field. This is a recurring design pattern in STM: keep TVars small and orthogonal so unrelated updates do not conflict. The trade is that operations that span both fields now require a transaction over two cells, but those operations were already inherently multi-step.

### Q: Inside an STM transaction you call a helper that begins another transaction. What happens?

Definitions of "nested" vary by implementation, but the dominant model in Haskell is that you cannot call `atomically` inside `STM`; the type system prevents it. Transactional helpers are simply `STM` actions composed into the outer transaction, sharing its log. There is no nested commit and no nested retry boundary; an abort by the helper aborts the outer transaction.

In Clojure, `dosync` nesting is permitted and the inner `dosync` joins the outer transaction rather than starting a new one. Naive thinking is that the inner `dosync` is a save-point you can roll back to; it is not, and an abort propagates to the outermost transaction. Programmers who design around nested save-points will be surprised; the model is single-level transactions with composition.

### Q: You add logging inside a Haskell `STM` block and it fails to compile. Why is that good?

Logging means calling something like `putStrLn`, which lives in `IO`. The compile error confirms the type system is doing its job: there is no path from `STM` to `IO` except through `atomically`, and the runtime forbids `atomically` from inside `STM`. The error message guides you to either remove the logging or restructure: compute the data inside the transaction and emit the log after commit.

The reason this is "good" rather than "annoying" is that the alternative — silently performing logging multiple times across retries — is a bug that the type system has prevented at compile time, before it could hit production.

### Q: Two transactions both `commute` the same Clojure ref with non-commutative operations. What goes wrong?

`commute` is named for the algebraic property; the runtime does not check whether your function actually commutes. If you `commute` with a non-commutative operation (string concatenation, subtraction, list cons), the runtime applies the queued operations in some order at commit, and the result depends on the order. You may see one transaction's effect lost or applied in a different position than expected.

The fix is to use `alter` for non-commutative updates so the runtime enforces serialization, or to genuinely use commutative operations with `commute`. The trap is the name: `commute` promises throughput, but only if your operation truly commutes.

### Q: A transaction calls `retry` but never wakes up. What might be wrong?

`retry` registers the calling thread as a waiter on every TVar in its read set; the thread wakes when any of those TVars is written. If your transaction reads no TVars before calling `retry` — perhaps it computed a condition from a constant — the read set is empty, the runtime has nothing to wake on, and the thread blocks indefinitely. Newer Haskell runtimes detect the empty-read-set case and throw an exception; older ones would silently block.

Naive thinking is that `retry` will be woken when "something changes"; the runtime needs a specific set of cells to watch. The fix is to read the relevant TVars (even values you do not use directly) so the runtime registers waiters.

### Q: How does an STM transaction interact with thrown exceptions?

In Haskell, an exception thrown inside `atomically` aborts the transaction (discards its log) and re-raises the exception in `IO`. Writes are not committed, which is usually the right behaviour: if your transaction body crashed mid-way, you do not want a partial state published. If you specifically need to commit some writes before re-raising, you must restructure to catch the exception inside `STM` (via `catchSTM`) and decide what to do.

The trap is assuming exceptions inside a transaction roll back the same way as in a database — they do, but the runtime cannot un-do any IO that escaped (which is why IO is forbidden in the first place). In Clojure the situation is similar but enforced only by convention.

### Q: A Scala team using `scala-stm` reports random duplicate emails sent. Diagnose.

Almost certainly someone called `sendEmail` inside `atomic`. `scala-stm`, like Clojure, cannot prevent IO inside transactions; under contention the runtime retries and the email send is repeated. The duplicates are not random in cause — they correlate with contention bursts — but they look random because they occur per-thread under load.

The fix is to extract the IO out of the transaction: collect the messages inside `atomic`, return them as the transaction's result, and send after commit. A senior recommendation is to wrap email sending in an explicit outbox pattern where the transaction writes an outgoing-message ref and a separate worker consumes it post-commit.

### Q: Why might a transaction commit successfully but an invariant fail later?

The transaction respects atomicity within itself, but invariants spanning multiple transactions are not the runtime's concern. If your design assumes transaction A always happens before transaction B and you do not enforce that with explicit dependencies (such as B reading a TVar that A writes), B can run before A and break the invariant. Naive thinking is that "atomic" means "ordered"; it does not. STM gives atomicity per transaction, not ordering across them.

The fix is to encode ordering in the data: B should `retry` until the TVar A would write reaches the expected value. This is the use case for `retry` as a coordination primitive.

### Q: A developer wraps a single `readTVar` in `atomically` to read consistently. Is anything wrong?

It is correct but heavy-handed. A single `readTVar` inside `atomically` pays log overhead for a single read; a plain `readTVarIO` reads the TVar's current value without bookkeeping. The latter is preferable when you only need a snapshot value, not a transactional read. The trap is the mental model that every TVar access must be transactional; it is only required when you read multiple cells and need a consistent view.

The senior nuance is that `readTVarIO` is a non-transactional read with no ordering guarantee against concurrent writers — fine for a snapshot, not fine for a decision that depends on the value being current.

### Q: An STM design uses one giant TVar holding the entire application state. Why is this a bad idea?

Every transaction touches the giant TVar, so every transaction conflicts with every other. STM degenerates into a global lock with extra overhead. You get neither composability (everything is the same cell) nor scalability (no concurrent writes possible). Naive thinking is "STM handles consistency, so one big cell is simpler"; it is, but you have abandoned the entire point of optimistic concurrency.

The fix is to decompose state into orthogonal TVars whose updates rarely overlap. The design discipline of "small TVars, fine grain" is to STM what "small mutexes, fine grain" is to lock-based concurrency.

### Q: When does `orElse` make a wrong choice?

`orElse a b` runs `b` only if `a` calls `retry`; if `a` succeeds, `b` is never tried. If you wanted "try both and pick the better outcome", `orElse` is not the operator. The trap is reading `orElse` as parallel composition; it is sequential fall-back. If you really need to evaluate both and choose, you must run both in separate transactions (with their own commit semantics) and reconcile externally.

The senior framing is that `orElse` composes blocking behaviour, not optimization. It is the right tool for "block on any of these channels", not for "find the best value among these branches".

### Q: A function reads a TVar twice in one transaction and gets different values. Is that possible?

No, and yes — depending on which language. Within a single Haskell `STM` transaction, reading the same `TVar` twice always yields the same value because the runtime serves reads from the transaction's log if previously read. The transaction has a consistent view of memory. In Clojure with refs, the same holds within a `dosync`: reading the same ref twice yields the same value within the transaction's snapshot.

The trap is mental confusion with non-transactional reads. `readTVarIO` in Haskell is not transactional and can return different values on each call; a candidate confused about transactional versus non-transactional reads will produce buggy code. The model is "transactions see a snapshot; the snapshot does not change mid-transaction."

### Q: You profile and find 70% of CPU time in STM bookkeeping. What does that suggest?

Either the transactions are too small (overhead amplified per transaction) or contention is high enough that the runtime is spending most of its work aborting. For small transactions the fix is often to consolidate work or use non-transactional primitives where possible. For contention the fix is to reduce sharing or shard hot cells.

A naive reading is "STM is slow, replace it"; the senior reading is "STM is being used outside its sweet spot." Without diagnosing which sub-case is at play, swapping models risks porting the same design problem to a different runtime.

### Q: A transaction reads a TVar via `readTVarIO` and then enters `atomically`. What guarantees do you have?

None across the boundary. The value read via `readTVarIO` is a snapshot at that instant; by the time the transaction begins, the value could have changed. If the transaction's logic depends on that value, it must re-read inside `atomically` to bring the read into the transaction's read set. Naive code that uses the `readTVarIO` value as input to a decision inside `atomically` is racy.

The fix is to either pass the value as a parameter and re-validate it inside the transaction, or to read the TVar inside the transaction directly. The pattern is "external reads are hints; transactional reads are facts."

---

## System / Design Scenarios

### Q: Design a bank-ledger system that transfers funds between accounts atomically and reports balances consistently.

Model each account as a `TVar Money`. The transfer operation reads both source and destination balances, validates the source has sufficient funds, and writes both new balances in a single transaction. Reporting a consistent snapshot of multiple accounts is a transaction that reads each `TVar` and returns the collected values; STM guarantees the snapshot is consistent. Audit logging happens after the transaction commits, in `IO`, with the transaction returning the values to log.

Senior considerations: split account balance and account metadata into separate TVars so balance updates do not conflict with name changes; consider per-currency sharding if the system is global; use `retry` for "wait until enough funds are available" semantics if you want blocking transfers.

### Q: Design an inventory reservation system where reservations may compete for the same SKU.

Each SKU has a `TVar Int` for available stock and a `TVar [Reservation]` for active reservations. A reservation transaction reads the available count, validates it is sufficient, decrements it, and appends to the reservation list. Releasing a reservation reverses the operation. Under STM, two clients reserving the last unit will both attempt the transaction; one wins, the other's read set is invalidated, and on retry it sees zero stock and either fails or `retry`s to wait for restock.

For high contention on a hot SKU, consider sharding inventory across cells representing batches: 100 cells of 10 units each instead of one cell of 1000 units. This reduces conflict at the cost of slightly more complex logic for finding a non-empty shard.

### Q: Design a concurrent doubly-linked list supporting safe insertion and removal under STM.

Each node holds two `TVar (Maybe Node)` references (previous and next). Insertion between two nodes A and B reads A.next, B.prev, validates they still point to each other, then writes A.next = newNode, B.prev = newNode, newNode.prev = A, newNode.next = B — all within a single transaction. Removal of node X reads X.prev and X.next, validates linkage, then writes prev.next = X.next and next.prev = X.prev.

The pattern showcases STM's strength: complex pointer updates that would require careful lock ordering in a lock-based design are written as straight-line code, and the runtime handles conflict detection. The cost is that any modification to the list, even at distant ends, conflicts because the runtime sees overlapping TVar reads when traversing.

### Q: Design a scheduler that picks jobs from a priority queue with multiple workers.

Implement the priority queue as a `TVar (Map Priority [Job])`. Each worker runs a transaction that reads the map, picks the highest-priority job, removes it from the map, and returns it; if the map is empty, the transaction `retry`s, blocking until a producer adds a job. Producers run a transaction that inserts a job at its priority.

Under contention, workers will retry each other; the throughput limit is roughly the rate at which the map can be mutated transactionally. For higher throughput, shard the queue by priority class (one TVar per class) so workers on different priorities never conflict.

### Q: Design a conditional consumer that blocks until either data is available or a timeout expires.

Combine two transactions with `orElse`. The first reads a data TVar and `retry`s if no data; the second reads a timeout TVar and `retry`s until it is set true. `orElse data timeout` blocks until one branch succeeds. A separate IO action sets the timeout TVar after the desired duration.

This pattern is far cleaner than the lock-based equivalent (which requires condition variables, signals, and careful design to avoid lost wake-ups). It also demonstrates `orElse`'s real strength: composing two independently-blocking operations into one that blocks on either.

### Q: Design a pub-sub system where multiple subscribers each receive every message exactly once.

For each subscriber maintain a `TVar [Message]` (or a `TQueue Message`). The publisher's transaction iterates over subscribers and appends the message to each. The subscriber reads its own queue and `retry`s when empty. Each subscriber observes its own ordered, complete sequence of messages.

For high subscriber counts the publisher transaction becomes large and may abort frequently; consider sharding subscribers into groups and publishing to each group in its own transaction (giving up cross-subscriber atomicity, which is usually acceptable for pub-sub).

### Q: Design a generational cache where reads are cheap and bulk invalidation is atomic.

Hold a `TVar Generation` for the current generation number and `TVar (Map Key (Generation, Value))` for entries. Reads check the entry's generation against the current generation; equal means live, lower means stale. Bulk invalidation increments the generation in a single transactional write, atomically making all entries stale. Inserts write with the current generation; cleanup is opportunistic, not part of invalidation.

The design exploits STM's strength on rare large operations (bulk invalidation) and avoids contention on common ones (reads, which can use `readTVarIO`).

### Q: Design a distributed lease system implemented in-process with STM.

A `TVar (Map LeaseId (Owner, Expiry))` holds active leases. Acquiring a lease is a transaction that checks the map for an existing valid lease, returns its owner if so, or writes a new lease with a future expiry. Releasing removes the entry. Renewal updates the expiry. A background thread periodically transactionally sweeps expired leases.

STM is appropriate because the data structure is naturally a single shared map with low-to-moderate contention. For higher contention, shard the lease map by lease ID hash so unrelated leases do not conflict.

### Q: Design a session manager that issues, refreshes, and revokes session tokens.

Keep `TVar (Map SessionId Session)` for active sessions. Issuance is a transaction that generates a fresh ID (from a separate `TVar Int` counter) and inserts a session record. Refresh reads the session, validates expiry, and writes an extended expiry. Revocation removes the session. Background cleanup transactionally removes expired sessions in batches to bound transaction size.

The senior consideration is bounding the cleanup transaction: a sweep over a million sessions inside one transaction creates a huge read set vulnerable to abort. Cleanup should iterate in chunks of N, committing each chunk separately, accepting that the system is briefly mid-cleanup. This is the same chunking discipline used in database batch jobs.

---

## Coding Questions

### Q: Implement a bounded TQueue in Haskell with `enqueue` blocking when full.

```haskell
import Control.Concurrent.STM

data BTQueue a = BTQueue
  { capacity :: Int
  , size     :: TVar Int
  , content  :: TQueue a
  }

newBTQueue :: Int -> STM (BTQueue a)
newBTQueue cap = do
  s <- newTVar 0
  c <- newTQueue
  return (BTQueue cap s c)

enqueueB :: BTQueue a -> a -> STM ()
enqueueB q x = do
  n <- readTVar (size q)
  when (n >= capacity q) retry
  writeTVar (size q) (n + 1)
  writeTQueue (content q) x

dequeueB :: BTQueue a -> STM a
dequeueB q = do
  x <- readTQueue (content q)
  modifyTVar' (size q) (subtract 1)
  return x
```

`enqueue` blocks on `retry` until size drops below capacity; `dequeue` uses the underlying `TQueue`'s natural blocking when empty. The size counter is itself a TVar so producers and consumers compose atomically.

### Q: Implement a Clojure transactional linked-list insert.

```clojure
(defrecord Node [value prev next])

(defn make-list []
  {:head (ref nil) :tail (ref nil)})

(defn insert-after! [list node value]
  (dosync
    (let [new-node (->Node value (ref node) (ref (deref (:next node))))
          old-next (deref (:next node))]
      (alter (:next node) (constantly new-node))
      (when old-next
        (alter (:prev old-next) (constantly new-node)))
      (when (= node @(:tail list))
        (alter (:tail list) (constantly new-node)))
      new-node)))
```

All linkage updates happen inside `dosync`; the runtime guarantees no other transaction sees a partial state. Note the absence of side effects inside the transaction; if logging is needed, return the new node and log after.

### Q: Implement a Scala bank transfer using scala-stm.

```scala
import scala.concurrent.stm._

class Account(initial: BigDecimal) {
  val balance: Ref[BigDecimal] = Ref(initial)
}

def transfer(from: Account, to: Account, amount: BigDecimal): Boolean =
  atomic { implicit txn =>
    if (from.balance() < amount) false
    else {
      from.balance() = from.balance() - amount
      to.balance() = to.balance() + amount
      true
    }
  }
```

The implicit `txn` token threads through ref accesses. The transaction is serializable; under contention the runtime retries automatically. Audit logging happens after the call returns based on the boolean result.

### Q: Implement a retry-until-condition pattern in Haskell.

```haskell
import Control.Concurrent.STM

awaitValue :: TVar Int -> Int -> STM ()
awaitValue var target = do
  current <- readTVar var
  when (current /= target) retry

-- usage:
-- atomically (awaitValue counter 100)
```

`awaitValue` blocks the calling thread until the TVar reaches the target. The runtime registers the thread as a waiter on `var`; any write to `var` wakes the thread, which re-checks the condition. This pattern replaces condition variables in lock-based designs and is composable via `orElse`.

### Q: Implement `orElse` to wait for either data or timeout.

```haskell
import Control.Concurrent.STM
import Control.Concurrent
import Control.Monad

withTimeout :: TVar (Maybe a) -> Int -> IO (Maybe a)
withTimeout dataVar microseconds = do
  timeoutVar <- atomically (newTVar False)
  _ <- forkIO $ do
    threadDelay microseconds
    atomically (writeTVar timeoutVar True)
  atomically $
    (do d <- readTVar dataVar
        case d of
          Just x  -> return (Just x)
          Nothing -> retry)
    `orElse`
    (do t <- readTVar timeoutVar
        if t then return Nothing else retry)
```

The transaction tries to read data; if absent, it `retry`s; `orElse` falls back to reading the timeout; if not yet set, that too `retry`s. The combined transaction blocks until either branch succeeds, demonstrating the canonical use of `orElse` for waiting on the first of multiple conditions.

### Q: Implement a Clojure read-only consistent snapshot of multiple refs.

```clojure
(defn snapshot [& refs]
  (dosync
    (doseq [r refs] (ensure r))
    (mapv deref refs)))
```

`ensure` adds each ref to the transaction's read set without writing it, guaranteeing serializability for the read. The snapshot is then a vector of values, all observed as they were at a single instant in the transaction's view. Without `ensure`, snapshot isolation might allow another transaction to commit changes that make the values inconsistent across refs.

### Q: Implement an STM-based reentrant counter that supports increment and check-and-reset atomically.

```haskell
import Control.Concurrent.STM

newtype Counter = Counter (TVar Int)

newCounter :: STM Counter
newCounter = Counter <$> newTVar 0

increment :: Counter -> STM ()
increment (Counter v) = modifyTVar' v (+1)

checkAndReset :: Counter -> Int -> STM Bool
checkAndReset (Counter v) threshold = do
  n <- readTVar v
  if n >= threshold
    then writeTVar v 0 >> return True
    else return False
```

`checkAndReset` runs the read, comparison, and conditional write atomically. Under contention, multiple callers may race; STM guarantees exactly one observes the threshold-crossing transition. The pattern composes with other transactions, so callers can stitch this into larger atomic blocks.

---

## Behavioral

### Q: Tell me about a time you reached for STM and it was the right choice.

The interviewer is probing judgement: STM is not the default and a senior should justify its use. A good answer names a system where invariants spanned multiple cells (a ledger, a scheduler with priorities, a coordinated state machine), where a lock-based design had become tangled or had recently produced a deadlock, and where the team was comfortable enough with the language's STM to commit to it. Mention metrics — abort rates, latency under contention, lines of code removed compared to the lock version.

The strongest answers acknowledge alternative designs considered (actor model, fine-grained locks) and explain why STM won on the specific dimensions that mattered. Avoid the trap of "we used STM because it's cool."

### Q: Tell me about a time you tried STM and it was the wrong choice.

Equally important: senior engineers know when their default is wrong. A common story is a high-throughput counter or rate-limiter where STM thrashed under contention and a CAS loop or sharded design was faster by an order of magnitude. Another is a system where transactions accidentally grew large and started starving, prompting a rewrite into smaller transactions or message-passing.

A good answer admits the misjudgement, names the symptoms that flagged it (abort rate, P99 latency, throughput cliff), and describes the migration path. Demonstrating the ability to back out of a design choice is as valuable as the original choice.

### Q: How do you teach STM to a team that has only used locks?

Start with the composability story, because that is the property locks lack and the one teams feel the pain of. Show a transfer-between-accounts example in both styles: the lock-based version requires lock ordering and lookup, the STM version is two reads and two writes. Then introduce the invariants the runtime enforces (atomicity, isolation, replayability) and the rule that follows from replayability (no IO inside transactions).

Cover the tricky bits in writing: write skew under snapshot isolation, retry storms on hot cells, the cost of large transactions. Pair-program through a small project to expose the team to the design patterns. The hardest part is unlearning the lock-acquire-release rhythm; that is more about habit than concept.

### Q: A colleague proposes wrapping every shared variable in a TVar "for safety." How do you respond?

This is the STM equivalent of "make everything synchronized in Java." Wrapping every variable individually does not buy safety because the safety comes from grouping related variables into a transaction. Single-cell access through a TVar pays log overhead for no isolation benefit beyond what a CAS or `readTVarIO` would give.

Coach the colleague toward "design the transaction boundaries based on invariants, then choose TVars to support them." The point of STM is grouping; granularity matters. The right response is collaborative — they are trying to be careful, and the response should reinforce that instinct while redirecting it.

### Q: Describe a debugging session for a livelock in an STM system.

Walk through a real or plausible scenario: throughput collapsed under load, profiler showed the runtime spending most of its time aborting and re-running transactions on a small set of cells. Identifying the hot cells was a matter of instrumenting the transactional layer with abort counters per TVar; once the contention pattern was visible, the fix was to shard the hot data or convert blind updates to `commute`.

The senior point is that STM bugs often hide as performance bugs, not correctness bugs. The transactions are individually correct; the system is just thrashing. Diagnosing this needs profiling and abort-rate metrics, not a debugger.

### Q: When have you migrated code from STM to something else?

A realistic story: a service used STM for a workload that grew over time into a single hot data structure with hundreds of writers per second. Abort rates climbed past 30%, P99 latency spiked, and adding shards did not help because every operation touched the global structure. The migration was to an actor model: a single thread owned the structure and processed messages from a queue.

The lesson is that STM excels at low-to-moderate contention with cross-cell invariants and degrades at single-cell hot spots. Recognising when a design has slid out of STM's sweet spot is part of senior judgement.

### Q: How do you decide between STM and message-passing for a new design?

Both avoid lock hierarchies and both can implement composable concurrent systems. STM is preferable when multiple producers and consumers need to read and update overlapping state with low contention; message-passing is preferable when there is a clear owner of state and the workload naturally serialises through that owner. STM is also preferable when the language has type-level support for transactional purity (Haskell); message-passing is more natural in languages without it.

A senior answer also considers the team: STM has a steeper learning curve, message-passing maps onto familiar queue patterns. The right answer for the org may be the simpler one the team can maintain.

### Q: How do you communicate STM's costs to stakeholders?

Translate from runtime metrics to user-visible outcomes. Higher abort rate means lower effective throughput per CPU; longer transactions mean tail-latency variance. Stakeholders care about throughput, latency, and capacity headroom. Frame STM's trade as "we paid X% throughput on the hot path to make the invariants impossible to violate; the alternative was a lock-based design we estimate would have produced one outage per quarter."

The honest framing is that STM is a tool, not magic. A senior engineer talks about trade-offs in language stakeholders can act on: cost of an engineer-week of lock debugging versus cost of an STM library overhead.

### Q: What is the longest-lasting STM-related bug you have fixed, and what made it hard?

A strong answer describes a bug where correctness was preserved but performance silently degraded as load grew, or a bug where snapshot isolation allowed a write-skew anomaly only visible under specific concurrent timing. The hardness came from two things: STM bugs often look like flakiness rather than determinism, and the fix may require restructuring data layout, not patching code.

Discuss how you found it (abort metrics, deliberate stress testing, formal modelling of the invariant) and what you did to prevent recurrence (additional invariant assertions, monitoring on abort rates, documentation of the design constraint). Senior engineers turn one debugging session into a permanent improvement in the system's observability.

---

## What I'd Ask a Candidate Now

### Q: Why is `atomically` in Haskell only callable from IO, not STM?

If `atomically` were callable from `STM`, it would let the programmer nest transactions, and the inner transaction could perform IO via its own `atomically`. The whole no-IO-in-STM guarantee would unravel. By restricting `atomically` to `IO`, the type system enforces that STM is purely transactional and IO happens only after a successful commit. The candidate should reach this conclusion from first principles: replay safety requires no escape from `STM` into `IO`.

A bonus is noting that this restriction is what makes Haskell's STM stand out: the type system encodes the no-IO rule, removing a whole class of bugs that Clojure and Scala can only detect by convention.

### Q: Why might a serializable STM produce fewer aborts in practice than a snapshot-isolation STM?

It sounds counterintuitive — serializability is the stronger guarantee, so should produce more aborts. The answer is that snapshot-isolation STMs (Clojure default) only conflict on write-write overlaps; serializable STMs (Haskell, Scala) conflict on read-write overlaps. In a read-heavy workload with rare writes, serializable STMs conflict more. In a write-heavy workload, the difference is smaller, but snapshot-isolation STMs admit anomalies (write skew) that serializable ones do not.

The candidate should be able to explain this trade and recognise that "fewer aborts" is not always a virtue: the aborts may be exactly what was needed to preserve an invariant.

### Q: Sketch the design of a TQueue with one writer and many readers under STM. Where do conflicts arise?

The writer appends; readers pop. If the queue is implemented as a single TVar holding a list, every reader and the writer touch that one cell, producing maximum contention. If it is implemented as two TVars (read end, write end), the writer only touches the write end and readers only touch the read end (until the read end is empty and they steal from the write end). Conflicts then occur only at the steal moment, not on every push or pop.

The candidate should arrive at the dual-list design and discuss the amortised cost. Bonus points for mentioning `retry` for blocking reads on empty queues.

### Q: Two transactions both want to remove the head of a queue. What does STM do?

Both transactions read the queue's head TVar and prepare a write removing the head. One commits first; the other's read set is invalidated and it aborts and retries. On retry it observes the new head, removes it, and commits. The result is that both transactions succeed but they obtain different items, exactly as a serial execution would have produced.

The candidate should articulate this without confusion. The behaviour is the foundation of STM's correctness story: optimistic execution plus validated commit yields the same effect as serial execution at the cost of occasional retries.

### Q: How would you instrument an STM system to diagnose poor scaling?

Add counters per TVar (or per transaction kind) tracking commit attempts, successful commits, aborts, and retries. Compute abort ratios; high ratios on a small set of TVars identify hot cells. Track transaction sizes (read-set cardinality) and durations; long large transactions are starvation risks. Combine with end-to-end latency metrics to correlate STM behaviour with user-visible outcomes.

The candidate should think like an SRE: define metrics, expose them via Prometheus or equivalent, and tie them to product impact. Mere knowledge of STM internals is not enough; the candidate must know how to make those internals observable.

### Q: Is STM compatible with garbage collection? Why does the question matter?

STM relies on per-thread logs of references; while a transaction is in flight, those references are reachable and the GC must keep their targets alive. After commit or abort, logs are released and unreferenced objects become collectable. Implementations must coordinate carefully so the GC sees a consistent view of the heap including in-flight logs; otherwise objects could be collected mid-transaction.

The candidate should recognise that STM and GC are deeply entwined and that GHC's STM works because GHC's GC understands STM's structures. In a non-GC environment (C++), STM implementations have to manage memory manually for logs, which is one reason TM in C++ has been hard to standardise.

### Q: Design a pattern for "STM plus IO" where both must succeed or neither happens.

The honest answer is that strict atomicity across STM and IO is not achievable in general — you cannot un-send a packet. The pragmatic pattern is the outbox: the STM transaction writes a record into an outbox TVar, the transaction commits, and a worker thread reads the outbox and performs the IO. If the IO fails, the worker can retry or escalate. This decouples STM's atomicity from the IO's eventually-consistent semantics.

The candidate should reach this answer naturally and explicitly name the trade: you get at-least-once IO instead of exactly-once, and the system needs idempotency at the IO layer to avoid duplicates. Senior candidates discuss the related pattern (transactional outbox in distributed systems) and connect STM to broader engineering wisdom.

### Q: How would you teach a junior to design transaction boundaries correctly?

Begin with the invariant: what property must hold before and after the operation? List the cells the invariant constrains; those cells go in one transaction. Cells outside that set should be in separate transactions or in non-transactional storage. Then check the resulting transaction for size — too many cells means high abort risk and long replays.

Coach the junior to write the invariant in a comment above the transaction. If they cannot state the invariant clearly, they have not thought hard enough about what the transaction is for. Concrete examples (bank transfer's "no money lost" invariant, queue's "no item duplicated" invariant) ground the abstraction.

---

## Cheat Sheet

| Concept | Description |
| --- | --- |
| TVar (Haskell) | Transactional variable; read/write in STM monad |
| Ref (Clojure) | Transactional reference; mutated in dosync |
| Ref (scala-stm) | Transactional reference; accessed in atomic block |
| atomically | Lifts STM action into IO; the commit boundary |
| dosync | Clojure equivalent of atomically |
| retry | Aborts current transaction; blocks until read-set changes |
| orElse | Tries left branch; falls back to right on retry |
| alter | Clojure: read-modify-write with conflict detection |
| commute | Clojure: commutative update that avoids conflicts |
| ensure | Clojure: adds ref to read set for serializability |
| Snapshot isolation | Transactions see consistent snapshot; write skew possible |
| Serializability | Outcome equivalent to some serial order; no write skew |
| Read set | TVars read during transaction; validated at commit |
| Write set | TVars written during transaction; published atomically |
| Conflict | Another transaction wrote a TVar in this transaction's read set |
| Retry storm | High contention causing transactions to repeatedly abort |
| Write skew | Anomaly under snapshot isolation; invariant violated by disjoint writes |
| TQueue | Transactional FIFO queue; blocks readers when empty |
| Outbox pattern | Write to TVar in transaction; perform IO post-commit |
| HTM | Hardware transactional memory; CPU-level support |

### Quick decision rules

| If you need | Use |
| --- | --- |
| Atomic update of one cell with frequent contention | CAS loop, not STM |
| Atomic update of multiple cells with low contention | STM |
| Composable concurrent libraries | STM |
| Side effects atomic with state | Outbox pattern, not STM |
| Block until condition | STM with retry |
| Block until any of N conditions | STM with orElse over retries |
| Single owner of state | Actor/message-passing |
| Snapshot of multiple refs | Clojure dosync with ensure, Haskell STM |
| Counter-style commutative update | Clojure commute, sharded counter, or atomic int |

### Common traps

- IO inside a transaction (executes per retry; duplicate effects)
- One giant TVar (all transactions conflict)
- One TVar with multi-field record (disjoint field updates conflict)
- Long transactions over hot data (starvation)
- Snapshot isolation without ensure (write skew)
- Retry storm on single hot cell (replace with CAS or sharding)
- `commute` with non-commutative operation (wrong result)
- Empty read set before retry (thread never wakes)

## Further Reading

- Composable Memory Transactions — Harris, Marlow, Peyton Jones, Herlihy (2005)
- Beautiful Concurrency — Simon Peyton Jones, chapter in Beautiful Code (2007)
- Programming Clojure — Stuart Halloway, on refs and transactions
- The Joy of Clojure — Fogus and Houser, chapter on concurrency
- Functional Programming for the Real World — Petricek and Skeet, STM chapter
- Transactional Memory, 2nd Edition — Harris, Larus, Rajwar
- A Comprehensive Strategy for Contention Management in STM — Spear et al.
- Scala-STM documentation — nbronson.github.io/scala-stm
- GHC STM source — `libraries/stm` in the GHC repository
- The TL2 algorithm — Dice, Shalev, Shavit (2006)
- The transactional memory wars — papers analyzing why hardware TM faded

## Related Topics

- [STM README](README.md)
- [Concurrency models overview](../README.md)
- [Lock-based concurrency](../../02-synchronization/README.md)
- [Actor model](../04-actors/README.md)
- [Async-await and futures](../03-async/README.md)
- [Memory models and happens-before](../../03-memory-model/README.md)
- [Lock-free programming](../../04-lock-free/README.md)
- [Haskell concurrency](../../../languages/haskell/concurrency/README.md)
- [Clojure concurrency primitives](../../../languages/clojure/concurrency/README.md)
- [Database transaction isolation](../../../../databases/transactions/README.md)
- [Optimistic concurrency control](../../../../databases/concurrency-control/README.md)
