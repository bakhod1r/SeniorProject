# STM — Professional Level

> **Topic:** [STM](README.md)
> **Focus:** history, ecosystem, migration, effect systems, the future

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

The professional level pulls back from the mechanics of any single STM implementation and looks at STM as a thirty-year arc inside concurrent programming. We will trace it from Shavit and Touitou's 1995 paper through Composable Memory Transactions, observe where it succeeded, where it stalled, and where its ideas were absorbed by something else. We will design a library that exposes STM as part of its public API, examine what it costs the team that owns the library, and rehearse the migration story for an organization that adopted STM and outgrew it. Finally, we will tie STM to the modern conversation about effect systems — algebraic effects in Eff and Koka, the new effect handlers in OCaml 5 — and ask whether STM is still the right abstraction or whether it is becoming one effect among many.

This is the level where you stop asking "how do I write a transaction" and start asking "should this team be writing transactions at all, and if they shouldn't, what do I migrate them to". It is also the level where you read papers, not blog posts, because the interesting questions about STM were answered in the literature and the answers are subtle.

---

## Prerequisites

You should have completed the junior, middle, and senior levels for STM, and you should be comfortable with the senior material in lock-free programming, memory models, and the language-internals chapter on Haskell's runtime. Some familiarity with the theory of linearizability, serializability, and snapshot isolation from the database world will help, as will a passing acquaintance with algebraic effects and effect handlers. You do not need to have implemented an STM, but you should have read at least one production STM implementation end to end at the senior level.

A practical prerequisite that is easy to overlook: you should have personally maintained a concurrent codebase in production for at least a release cycle. The professional questions about STM are not "is this construct correct" but "is this construct going to be maintainable in eighteen months when the team has rotated and the load has tripled", and those questions only become real when you have lived through the cycle once.

---

## Glossary

- **Composable Memory Transactions:** the 2005 paper by Harris, Marlow, Peyton Jones, and Herlihy that established Haskell's `STM` monad as the canonical composable STM design. The contribution is not STM itself but the composability — `orElse` and `retry` as first-class primitives that let transactions be combined.
- **Algebraic effects:** a programming-language feature in which side effects are described as algebraic operations with handlers, so the same operation can be interpreted differently depending on context. STM can be reframed as one effect among many in a language with effect handlers.
- **Effect handler:** the dynamically-scoped interpreter for an algebraic effect. In OCaml 5, `try ... with effect Op k -> ...` installs a handler for the effect `Op`; the continuation `k` lets the handler resume the computation.
- **HTM (Hardware Transactional Memory):** transactional memory implemented in the CPU — Intel TSX, IBM Power TM. The 1993 Herlihy and Moss proposal pre-dates STM by two years and is the older idea.
- **Hybrid TM:** a system that uses HTM when available and falls back to STM when HTM aborts or is unavailable. The pragmatic deployment story for transactional memory in C and C++.
- **Snapshot isolation:** a transaction-isolation level used by many databases (PostgreSQL, Oracle) in which each transaction reads from a consistent snapshot taken at start time. STM implementations that use multi-version concurrency control (MVCC) provide something very similar.
- **Write skew:** an anomaly permitted by snapshot isolation but forbidden by serializability — two transactions read overlapping data and each writes to a disjoint subset, yet their combined effect violates an invariant that holds in every serial schedule. STM systems that use snapshot semantics inherit this anomaly.
- **Effect system:** a static type-system feature that tracks which side effects each function may perform. Haskell's `IO` and `STM` types are simple effect markers; full effect systems like Koka's track much finer distinctions.
- **GHC:** the Glasgow Haskell Compiler, the production Haskell implementation, the only place where Composable Memory Transactions ship as a first-class feature in a widely deployed language.

---

## Core Concepts

### History and theory — Shavit & Touitou 1995, Harris & Fraser 2003, Composable Memory Transactions, Herlihy & Moss 1993

The earliest published proposal for transactional memory is Herlihy and Moss's 1993 paper "Transactional Memory: Architectural Support for Lock-Free Data Structures". It describes a hardware design — new CPU instructions to begin, abort, and commit a small transaction. The proposal predates STM. The motivation was not "make concurrent programming easier for application developers" but "give kernel and library writers a primitive that subsumes compare-and-swap and load-linked/store-conditional and works for multi-location updates". The paper is the intellectual root of every later transactional system.

Two years later, in 1995, Nir Shavit and Dan Touitou published "Software Transactional Memory" in PODC. Their key observation was that the transactional semantics of Herlihy and Moss did not actually require hardware — you could implement them entirely in software at the cost of bookkeeping per memory location. Their algorithm required transactions to declare their read and write sets in advance, which made it impractical for general use but established the design space. Shavit and Touitou were not trying to popularize STM for application code; they were trying to show that the hardware proposal could be expressed in software.

The next major step came in 2003 with Harris and Fraser's "Language Support for Lightweight Transactions". This paper did three things. First, it removed the requirement to declare read and write sets in advance — transactions could be dynamic. Second, it integrated the transactional construct with a programming language (Java), with a syntactic `atomic` block that compiled to STM operations. Third, it carefully measured overhead and showed that STM was within a small factor of fine-grained locking for a range of workloads. It is the paper that made STM look practical.

The paper that made STM influential for the programming-languages community is the 2005 "Composable Memory Transactions" by Harris, Marlow, Peyton Jones, and Herlihy. Its contribution is composability. Prior STM designs let you write atomic blocks, but they did not let you combine atomic blocks. If you had `atomic { withdrawFrom(a) }` and `atomic { depositTo(b) }`, you could not turn them into a single atomic transfer without rewriting both. The Haskell `STM` monad — with `retry` for blocking and `orElse` for choice — fixes this. You can write small `STM` actions, you can sequence them with `>>=`, and the result is itself an `STM` action that runs atomically when wrapped in `atomically`. That is the property that turned STM from "a research idea that beats locks on microbenchmarks" into "a primitive that changes how you decompose concurrent programs".

Composable Memory Transactions also introduced the typed restriction that an `STM` action cannot perform `IO`. This restriction is not a footnote — it is the reason Haskell's STM is sound. Once you allow arbitrary side effects inside a transaction, the system has to either log and undo them (expensive and not always possible — you cannot un-send a network packet) or abandon serializability. By exposing `STM` and `IO` as distinct types and giving no function the signature `STM a -> IO a` except `atomically`, the language statically rules out the problem. This is the architectural lesson the rest of the industry never quite learned.

### Why STM didn't take over — overhead, I/O constraints, marginal wins over fine-grained locks

STM had a moment between roughly 2005 and 2010 when several industrial labs believed it would replace locks. Intel, Sun, and Microsoft all had research projects. Sun's Rock processor had hardware TM in its early silicon. Intel shipped TSX in Haswell in 2013. STM libraries appeared for Java, C#, C++, Scala. The hype peaked, then receded.

Three things happened. First, the overhead turned out to be persistent rather than asymptotic. Read and write barriers around every transactional memory access cost cycles. For workloads where the critical sections were small and contention was moderate — exactly the case where STM was supposed to shine — fine-grained locking was already fast enough, and the additional cost of STM's bookkeeping was not justified. The benchmarks that showed STM winning often did so by comparing against a coarse-grained lock that nobody would actually deploy.

Second, the I/O constraint turned out to be more painful in practice than it looked in theory. In an environment where every interesting operation eventually talks to a database or a network, a construct that forbids I/O inside its atomic block requires the programmer to restructure code so that I/O happens outside transactions and the transactional state is updated in a separate step. This is a fine design, but it is the same design you would use with locks, so the conceptual simplification — "just wrap it in `atomic` and forget about locks" — does not actually apply to the typical line of business code.

Third, the win over fine-grained locking was marginal, and marginal wins do not justify the cost of retraining a team, retooling debugging, and accepting an unfamiliar runtime profile. STM made certain hard things easier — composable transactions across multiple data structures, for example — but most production code did not need those hard things often enough to pay for them.

Intel deprecated TSX in 2021. GCC's `__transaction_atomic` extension was removed from active development. Sun's Rock was cancelled. The hardware push collapsed first; the software libraries followed. STM did not disappear, but it became a tool for specific problems rather than a general replacement for locks.

### Where STM lives today — Haskell (active), Clojure (active but small role), Scala (declining), GCC (deprecated)

The honest map of where STM is used in production in the late 2020s is short.

Haskell's STM, in the `stm` package, is alive and well. Every concurrent Haskell program of significant size uses it for shared state. It is in the standard library distribution, it has had no major API change since 2007, and it is one of the features that defines the language's concurrency story. The bus factor is high, the implementation has been audited by a generation of GHC contributors, and the runtime integration with green threads and the scheduler is mature.

Clojure's `ref` and `dosync` are still in the language, still maintained, but their role has shrunk. Most idiomatic Clojure code uses `atom` for single-cell state and `core.async` channels for coordination. Refs and STM are used when you genuinely need to coordinate two or more cells transactionally, which is rare in practice. The community treats STM as one tool among several rather than the default. Rich Hickey's original presentation of Clojure put STM near the centre; the community gradually decentralized it.

Scala's `scala-stm`, derived from work by Bronson, Chafi, and Olukotun, is still available, still works, but is rarely chosen for new projects. The Scala concurrency conversation moved to `Future`, then to ZIO and Cats Effect — IO monads with their own concurrency primitives, none of which is STM. The `scala-stm` library exists in maintenance mode.

GCC's `__transaction_atomic` extension was an early attempt to bring STM to C++. It was based on a draft proposal for C++ transactional memory that never standardized. The implementation is still in GCC but is unmaintained, has known soundness gaps in interaction with C++ exceptions, and is not recommended for new code. Clang has no equivalent.

Java had several research STMs — Deuce, Multiverse, ScalaSTM — none of which achieved production adoption. C# had STM.NET inside Microsoft Research; it was cancelled. The .NET concurrency story is now `Task`, channels, and immutable collections.

The pattern is consistent: STM survives in languages whose runtime was designed around it (Haskell, Clojure) and stalled or declined in languages where it was retrofitted (Scala, Java, C++, C#). The implication for an architect choosing a language for a new project is direct — if you want STM, you choose Haskell or Clojure; if you choose another language, plan to use other primitives.

### Designing a library that exposes STM — API ergonomics, error model, debuggability

If you are writing a library in Haskell or Clojure whose public API exposes STM, you are committing the consumer to a programming model. There are a few choices to make consciously.

First, do you expose `STM` actions in your API, or do you wrap them in `IO` actions that perform `atomically` internally? Exposing `STM` is more composable — the consumer can combine your action with their own state inside a single transaction. Wrapping in `IO` hides the implementation but commits to a fixed transaction boundary. The Haskell convention is to expose both — a `Foo.STM` module with `STM`-typed functions and a `Foo` module with `IO`-typed wrappers — so the consumer can pick the level they need. This is the design used by `stm-containers` and `focus`.

Second, what is your error model? `STM` does not have exceptions in the usual sense — `throwSTM` exists and behaves transactionally, but the consumer must know whether an exception inside your library's `STM` action aborts the whole enclosing transaction (it does) and whether your library's invariants hold after an aborted transaction (they should, automatically, because abort discards writes). The error story is part of the API and must be documented.

Third, debuggability. A consumer who sees one of your transactions retrying repeatedly needs to know why. Your library should expose hooks or metrics that let the consumer count retries, measure transaction durations, and attribute contention to specific actions. The professional library does not just provide correct STM — it provides observable STM, because production teams need to know when something is going wrong long before users complain.

Fourth, the contract about `unsafeIOToSTM` (or its equivalent in other STM implementations). Your library should never use it. If it does, that is a leak of `IO` into `STM`, and every transaction containing your action becomes potentially non-atomic. Document the prohibition, ban it in code review, and consider a CI lint that rejects PRs containing the call.

### STM and effect systems — algebraic effects, Eff, Koka, OCaml 5 effects — modern alternative

A theme of modern programming-language research is that side effects should be first-class objects in the type system, distinguished by name, and interpreted by handlers that are dynamically installed in the call tree. This is the algebraic-effects view, developed by Plotkin, Power, and Pretnar in the 2000s and shipped in production-grade form in Koka (Microsoft Research) and OCaml 5.

In an effect-system language, STM is not a special primitive built into the runtime; it is a handler for a `State` or `Transactional` effect. The user writes code that operates on transactional state with named operations — `read`, `write`, `retry`, `orElse` — and the handler installed at the boundary of the transaction interprets those operations against whatever underlying implementation the runtime provides. The implementation could be a classical STM with a global clock; it could be a fine-grained lock implementation; it could be a hardware-TM-backed implementation; it could be a single-threaded interpreter for testing. The user's code does not change.

This is the architectural shift. STM as a feature is a commitment to a particular implementation embedded in the language's runtime. STM as an effect is a commitment to an API contract, leaving the implementation pluggable. The latter is much more flexible — you can change implementations, you can mock for testing, you can compose with other effects (logging, tracing, retry policy) by stacking handlers. The cost is that effect-system programming has its own learning curve, the type signatures get involved, and the performance story is still being worked out.

OCaml 5's effect handlers, shipped in 2022, are the first time algebraic effects have been available in a mainstream production language with a mature ecosystem. The community has used them to build concurrency primitives — fibers, async I/O, structured concurrency — but as of the late 2020s, no production-quality STM-on-effects library has emerged. The implementation is plausible — Eio, OCaml's async library, uses effects this way — but STM specifically has not been a priority.

The professional view is: if you are starting a research project in 2026 to design the next generation of concurrent programming, you almost certainly start from effect handlers and treat STM as one possible handler. If you are starting a production project today, you use the STM that ships with your language and watch the effect-systems space.

### Comparison to lock-free programming — STM as "automatic lock-free for the programmer"

A useful way to frame STM is as automatic lock-free programming. A lock-free data structure uses CAS loops, hazard pointers, epoch-based reclamation, and a careful argument about progress and linearizability. It is correct by construction only in the hands of an expert, it does not compose, and a small mistake produces a heisenbug that survives in production for years. STM gives you, automatically, the same progress property (at least one thread makes progress at any time, no thread holds a lock that prevents others) and the same correctness story (transactions are serializable), but you write straight-line code.

The cost is that the automation is generic. A hand-written lock-free skip list outperforms an STM-based skip list by a factor of two to five on most benchmarks, because the hand-written version exploits the structure of the data. STM cannot — it sees only reads and writes to memory cells and does not know they belong to a skip list. The trade-off is the classic one between general tools and specialized tools.

For most application code, the STM trade-off is the right one — programmer productivity beats peak throughput. For library code that will be called from thousands of places, the lock-free trade-off may be worth it — peak throughput compensates for the cost of writing it once. The professional engineer picks consciously, and does not assume one answer for everything.

### STM and database isolation analogy — snapshot isolation vs serializability, write skew anomaly

The database community has been thinking about transactional isolation for forty years, and the vocabulary is portable. STM systems can usefully be classified by which isolation level they provide.

Haskell's STM provides serializability — every committed schedule is equivalent to some serial schedule. The implementation uses a global commit lock at commit time to make this property hold. Clojure's STM provides snapshot isolation by default — each transaction sees a consistent snapshot but two concurrent transactions that read overlapping data and write disjoint data may both commit. To get serializability in Clojure you must use `ensure`, which forces a transaction to acquire a read lock on a ref, preventing concurrent modification.

Snapshot isolation is famously vulnerable to the write-skew anomaly. Consider a hospital scheduling system that requires at least one doctor to be on call. Two doctors, Alice and Bob, are both on call. Each, concurrently, runs a transaction that checks "is there at least one other doctor on call" and, seeing the other, removes themselves. Under serializability one transaction commits and the other aborts on retry; under snapshot isolation both can commit, leaving no doctor on call. The invariant — at least one on call — is violated.

If your STM provides snapshot isolation rather than serializability — Clojure does — then you must be alert to write skew. The fix is to explicitly read-lock anything you depend on but don't modify. In Clojure, this is `(ensure ref)`. In databases, it is `SELECT ... FOR UPDATE`. The vocabulary is portable, and the solutions look the same.

### Migrating off STM — when production team finds it doesn't scale, what's the path out

Suppose your team adopted STM three years ago, built the core of your product around it, and now finds that under load the transaction-abort rate is climbing and the throughput ceiling is too low. What is the migration path?

The first option is fine-grained locks. You replace each transactional data structure with a hand-coded version that uses mutexes at the granularity of individual entries or buckets. This is the path that gives the most predictable performance. The cost is that you lose composability — coordinating across two locked structures requires lock-ordering discipline and a deadlock prevention argument that your team must internalize. The migration is feasible but expensive.

The second option is actors or message-passing. Each piece of shared state becomes an actor that owns its data and processes messages serially. There is no shared mutation, so there is no contention to manage. The cost is latency — operations that were one transaction become a request-response message exchange — and the conceptual shift, which is large.

The third option is immutable persistent data structures with a single coordination point. The state becomes a single atomic reference to an immutable data structure. Updates produce a new structure and CAS the reference. Reads are lock-free against the immutable snapshot. This is Clojure's `atom` model and also the React/Redux model in front-end JavaScript. It scales well if your updates can be expressed as functions of the previous state and if reads vastly outnumber writes.

The fourth option, less common but worth knowing, is to shard the state — partition the data so that each piece is owned by a single thread, and route operations to the owning thread. This is what Redis, single-threaded databases, and many high-performance servers do. It eliminates contention by eliminating sharing, at the cost of giving up some workload flexibility.

The right migration depends on access pattern. Read-heavy with rare writes: immutable persistent structures. Write-heavy with disjoint partitions: sharding. Write-heavy with arbitrary cross-cutting writes and a small team: fine-grained locks. Write-heavy with cross-cutting writes and a large team that values isolation: actors. There is no single answer.

The thing not to do is migrate piecemeal. STM and locks do not compose — half the system in transactions and half in locks gives you neither the composability of STM nor the predictable performance of locks. Migrate a coherent subsystem at a time, behind a clean boundary, and either commit or roll back the migration before starting the next one.

### Anti-patterns: I/O inside transactions, very long transactions, retry storms hidden behind metrics

Three anti-patterns deserve a dedicated discussion because they appear in real codebases and a professional engineer should know how to spot them.

I/O inside transactions is forbidden in Haskell by the type system but allowed in Clojure, where `ref` operations live inside the JVM and the `dosync` macro cannot prevent the body from calling arbitrary functions. A Clojure transaction that performs HTTP requests or database writes will re-perform those operations on every retry, which is at best wasteful and at worst incorrect. The fix is discipline — review for impure calls inside `dosync`, lint for them if possible, and document the prohibition.

Very long transactions are the next anti-pattern. A transaction that touches a thousand cells and runs for a hundred milliseconds will conflict with almost everything and will retry often. The same logic split into ten small transactions will conflict with much less. The fix is to ask, for each transaction, "what is the minimal atomic unit", and to keep transactions to that scope. Cross-transaction invariants that span multiple small transactions should be re-checked at higher levels, not enforced by extending the transaction.

Retry storms hidden behind metrics are the subtlest. STM systems retry silently when transactions conflict. From the outside, the system looks like it is running fine — throughput is non-zero, latencies are stable on average. But internally, every transaction is retrying five times, the abort-to-commit ratio is five-to-one, and a small bump in load will tip the system over. The fix is observability — every STM library should expose abort counts, retry counts, and transaction durations as metrics, and your dashboards should show them next to throughput and latency. Without this, you cannot see the cliff approaching.

### The future — async + STM, distributed STM, STM in seL4 / real-time

STM's current research frontier is small but interesting.

Async-STM integration is an active question in Haskell. The existing `STM` monad does not interact with async I/O — you cannot `await` a network read inside a transaction. There are proposals to extend STM with async hooks, but the soundness story is delicate, and no proposal has crossed into the standard library.

Distributed STM has been proposed many times and shipped nowhere. The problem is that the latency of a distributed commit (cross-machine round trip) is comparable to the latency of a database transaction (cross-machine round trip), and at that point you would just use a database. The thing distributed STM might add — sub-transaction composability across machines — has not turned out to motivate enough use cases.

STM in real-time systems is interesting because STM's progress guarantee is similar to wait-freedom in a way that locks do not match — a high-priority transaction can preempt a lower-priority one without inverting priorities. seL4, the formally verified microkernel, does not use STM (it is too small and disciplined to need it), but there is research interest in real-time STM for systems that need predictable concurrency without locks.

For most professional engineers, the future of STM is going to look like its present: a competent tool inside Haskell and Clojure, an interesting idea referenced in PL papers, and a feature flag in the design space of any new language. It is not going to displace locks in C, and it is not going to displace channels in Go.

---

## Real-World Analogies

A national rail timetable. STM is a system in which each train's schedule is a transaction. The transactions are composed — a passenger journey is a sequence of train transactions — and the system rejects compositions that are infeasible. The professional question is not "how do we run more trains" but "is the timetable model the right abstraction for the next decade of network growth, or should we move to a continuously-updated dynamic dispatch model". This is the kind of question you ask about STM in a mature codebase. The answer is usually "keep the timetable for the high-volume backbone and use dynamic dispatch for the peripheral routes", which is exactly the layered approach mature STM users adopt — STM at the core where composition matters, simpler primitives at the edges where it does not.

A surgery booking system. Snapshot isolation lets two surgeons each see "the OR is free at 3pm" and each book it. Serializability prevents the double-booking. Write skew is the analogue of two surgeons each booking different ORs based on stale knowledge of who is on call. The hospital that migrated from snapshot to serializable isolation in its booking system did so because the human cost of write skew became unacceptable, not because the throughput became unacceptable. STM systems sometimes go through the same evolution. The cost of the migration was new contention — operations that had silently overlapped now had to serialize — but the team accepted it because correctness mattered more than throughput at the relevant operating point.

The architectural arc of public-key cryptography. PKI was supposed to be the universal solution to authentication on the internet. It did not become universal — it became a tool that lives in specific places (TLS, code signing, some federation protocols) while other places used different approaches (passwords, OAuth, SSH keys). STM had the same arc: it was supposed to be the universal solution to shared-memory concurrency, it became a tool that lives in specific places, and other approaches occupy the rest of the design space. This is not failure — it is the normal evolution of a technology from "the answer to everything" to "a good answer to some things". The professional engineer reads this arc not as cynicism but as realism, and plans accordingly.

A monorepo's build system. The team that builds Bazel-style hermetic builds and the team that builds incremental Make-style builds are making opposite trade-offs — generality versus speed — and either can be right depending on the codebase. STM versus fine-grained locks is the same trade. The professional engineer does not pick once and for all; they pick per project, and they are honest about why. A team that picks STM because they like the paper has made the wrong kind of decision; a team that picks STM because their workload has composable atomicity needs and moderate contention has made the right kind of decision.

The evolution of garbage collection. In 1995, mainstream programmers wrote `malloc`/`free`. GC was a research feature with overhead so visible it disqualified the technology from serious use. Twenty years later, GC is the default and `malloc`/`free` is the niche. The migration happened because hardware got faster, the algorithms got better, and the cost of manual memory management — bugs, leaks, security holes — became unbearable as systems grew. STM has not followed the same arc. The cost of manual locking did not become unbearable, the algorithms did not improve enough, and the hardware did not subsume the overhead. The lesson is that a technology's success depends on whether the alternatives get worse faster than it gets better, and for STM the alternatives did not get worse fast enough.

A city's emergency-services dispatch. When the city has one dispatcher coordinating all units, it is simple but does not scale. When the city has many dispatchers operating independently it scales but loses cross-cutting coordination. The middle architecture — regional dispatchers that own their patch and a thin coordination layer for inter-regional incidents — mirrors the actor-plus-coordinator pattern many systems land on after migrating off STM. The migration is not from one model to another but from one coordination scope to another, and the trick is choosing where the boundary lies.

---

## Mental Models

STM is a design philosophy first and a runtime feature second. The runtime can be replaced — and over the next decade it will likely be reframed as one effect handler among many — but the design philosophy of "specify atomic intent declaratively, let the system handle conflict" is durable. When you reason about STM at the professional level, reason about the philosophy, not the implementation, because the implementation will change.

The world is divided into problems where STM is the right answer, problems where it is the wrong answer, and problems where it does not matter. The job is to know which is which, and the way you know is by asking what the contention pattern is, what the invariants are, and what the team's skills are. There is no decision tree that works for every project — there is a small set of questions that, asked honestly, lead to the right answer. Most of the questions are about the team and the workload, not about the technology, which is the usual pattern for serious architectural decisions.

Composability is the feature that distinguishes STM from locks, and it is the feature that will be ported into whatever replaces STM. If a future system has composable atomic blocks, it has inherited STM's core idea regardless of what its runtime looks like. If it does not have composable atomic blocks, it is a lock-based system in different clothing. This is the right lens for reading new concurrency proposals — ignore the syntax, ignore the runtime, and ask whether you can take two atomic blocks written independently and combine them into one atomic block with no rewrite. If yes, STM's intellectual heritage is in the proposal. If no, it is something else.

The arc of any concurrency abstraction is: research idea, hype peak, niche adoption, stable role. STM is at "stable role". HTM is at "niche adoption with question marks". Effect handlers are at "research idea with industrial interest". Channels and actors are at "stable role" too. The professional engineer reads the arc, not the marketing. The arc tells you what is safe to bet a five-year project on; the marketing tells you what your conference talks should be about. Both have their place, but the arc is what matters for production.

A useful mental model for the migration question is the half-life of an abstraction. Locks have been around since the 1960s and have a half-life measured in decades — they will be in production code for the foreseeable future. STM has been mainstream for twenty years and has a half-life measured in maybe a decade — it will continue to be supported but will not grow. Effect handlers are new and have an indeterminate half-life — they could be the future or they could be a footnote. When you bet on an abstraction for a system that will run for ten years, weight the half-life against the win. STM still wins in places where the composability advantage is large enough to justify the bet on its medium half-life. It does not win where the advantage is small.

The cost-of-change model. Every concurrency abstraction has a cost when you adopt it and a cost when you change it. Adoption cost includes training, tooling, and the redesign of the system to fit the model. Change cost includes the migration to another model and the discovery that some invariants you relied on are not portable. STM has a moderate adoption cost in languages designed for it and a high adoption cost in languages where it is retrofitted. It has a high change cost because composable atomicity is not portable to lock-based or actor-based systems. Both costs matter and both must be paid honestly when planning.

---

## Code Examples

### Designing a financial ledger library in Haskell STM

We design a small ledger library that exposes a clean STM-based API. The library tracks accounts, balances, and entries; it offers single-account operations and multi-account transfers; it is composable so that a consumer can write higher-level transactions that combine ledger operations with their own state.

```haskell
{-# LANGUAGE GeneralizedNewtypeDeriving #-}

-- | Ledger.STM — the composable STM-typed API.
module Ledger.STM
  ( Ledger
  , Account
  , AccountId
  , Amount
  , LedgerError(..)
  , newLedger
  , openAccount
  , balance
  , deposit
  , withdraw
  , transfer
  , transactionHistory
  ) where

import Control.Concurrent.STM
import Control.Monad (unless, when)
import Data.Map.Strict (Map)
import qualified Data.Map.Strict as Map
import Data.Sequence (Seq, (|>))
import qualified Data.Sequence as Seq
import Data.Word (Word64)

-- | An amount in the smallest currency unit (cents, satoshi, etc).
newtype Amount = Amount { unAmount :: Word64 }
  deriving (Eq, Ord, Show, Num)

-- | A stable account identifier.
newtype AccountId = AccountId { unAccountId :: Word64 }
  deriving (Eq, Ord, Show)

-- | A single ledger entry — credit or debit on an account.
data Entry = Entry
  { entryAccount :: !AccountId
  , entryDelta   :: !Integer   -- positive credit, negative debit
  , entrySeq     :: !Word64
  } deriving (Eq, Show)

-- | An account is a balance plus a tail of entries.
data Account = Account
  { acctBalance :: !(TVar Integer)
  , acctEntries :: !(TVar (Seq Entry))
  }

-- | The ledger is a map from id to account plus an entry counter.
data Ledger = Ledger
  { ledgerAccounts :: !(TVar (Map AccountId Account))
  , ledgerNextSeq  :: !(TVar Word64)
  , ledgerNextId   :: !(TVar Word64)
  }

-- | Errors are values, not exceptions, so consumer composes them.
data LedgerError
  = NoSuchAccount AccountId
  | InsufficientFunds AccountId Integer Amount
  deriving (Eq, Show)

newLedger :: STM Ledger
newLedger = Ledger
  <$> newTVar Map.empty
  <*> newTVar 0
  <*> newTVar 1

openAccount :: Ledger -> STM AccountId
openAccount l = do
  i <- readTVar (ledgerNextId l)
  writeTVar (ledgerNextId l) (i + 1)
  bal <- newTVar 0
  ents <- newTVar Seq.empty
  let aid = AccountId i
  modifyTVar' (ledgerAccounts l) (Map.insert aid (Account bal ents))
  return aid

-- | Internal lookup that aborts the transaction if the account is missing.
--   Returning Either keeps the error in the type so callers can compose.
lookupAccount :: Ledger -> AccountId -> STM (Either LedgerError Account)
lookupAccount l aid = do
  m <- readTVar (ledgerAccounts l)
  return $ case Map.lookup aid m of
    Just a  -> Right a
    Nothing -> Left (NoSuchAccount aid)

balance :: Ledger -> AccountId -> STM (Either LedgerError Integer)
balance l aid = do
  ea <- lookupAccount l aid
  case ea of
    Left err -> return (Left err)
    Right a  -> Right <$> readTVar (acctBalance a)

-- | Append an entry and update the balance in one STM step.
applyEntry :: Ledger -> Account -> AccountId -> Integer -> STM ()
applyEntry l a aid delta = do
  s <- readTVar (ledgerNextSeq l)
  writeTVar (ledgerNextSeq l) (s + 1)
  modifyTVar' (acctBalance a) (+ delta)
  modifyTVar' (acctEntries a) (|> Entry aid delta s)

deposit :: Ledger -> AccountId -> Amount -> STM (Either LedgerError ())
deposit l aid amt = do
  ea <- lookupAccount l aid
  case ea of
    Left err -> return (Left err)
    Right a  -> do
      applyEntry l a aid (toInteger (unAmount amt))
      return (Right ())

withdraw :: Ledger -> AccountId -> Amount -> STM (Either LedgerError ())
withdraw l aid amt = do
  ea <- lookupAccount l aid
  case ea of
    Left err -> return (Left err)
    Right a  -> do
      b <- readTVar (acctBalance a)
      let d = toInteger (unAmount amt)
      if b < d
        then return (Left (InsufficientFunds aid b amt))
        else do
          applyEntry l a aid (negate d)
          return (Right ())

-- | Transfer is the composable case: it is itself an STM action,
--   it commits both sides or neither, and the consumer can nest it
--   inside a larger transaction (e.g. updating a journal as well).
transfer :: Ledger -> AccountId -> AccountId -> Amount -> STM (Either LedgerError ())
transfer l from to amt = do
  ew <- withdraw l from amt
  case ew of
    Left err -> return (Left err)
    Right () -> deposit l to amt

transactionHistory :: Ledger -> AccountId -> STM (Either LedgerError (Seq Entry))
transactionHistory l aid = do
  ea <- lookupAccount l aid
  case ea of
    Left err -> return (Left err)
    Right a  -> Right <$> readTVar (acctEntries a)
```

And the `IO`-wrapped layer the consumer is likely to use most of the time:

```haskell
-- | Ledger — the IO-wrapped public surface for simple consumers.
module Ledger
  ( module Ledger.STM
  , atomicallyTransfer
  ) where

import Control.Concurrent.STM
import Ledger.STM

atomicallyTransfer :: Ledger -> AccountId -> AccountId -> Amount -> IO (Either LedgerError ())
atomicallyTransfer l from to amt = atomically (transfer l from to amt)
```

The design decisions worth noting. Errors are returned as `Either`, not thrown — this lets the consumer compose error-producing actions inside a larger transaction without rolling back the whole thing on a recoverable error. The library exposes both `STM`-typed actions (for composition) and at least one `IO`-typed convenience wrapper. There is no `unsafeIOToSTM` anywhere. The `Account` type contains `TVar`s rather than being a single `TVar (Balance, Entries)` — this allows fine-grained conflict detection so that two transactions touching different fields of the same account do not conflict. The history is a `Seq` so that appends are O(1) and the rebuild after retry is cheap.

A consumer can compose this with their own state easily:

```haskell
-- consumer-side: pay invoice and mark it paid in our journal,
-- both atomically or neither.
payInvoice :: Ledger -> Journal -> InvoiceId -> AccountId -> AccountId -> Amount -> STM (Either LedgerError ())
payInvoice ledger journal invId from to amt = do
  result <- transfer ledger from to amt
  case result of
    Left err -> return (Left err)
    Right () -> do
      markPaid journal invId   -- consumer's STM action
      return (Right ())
```

That last property — being able to thread the ledger's transactional action into the consumer's transactional action and have the whole thing be one transaction — is the value that STM provides over a lock-based ledger library.

### "We tried STM and switched to fine-grained locks" — a retrospective

The other professional code example is a retrospective. Suppose your team wrote a real-time market data aggregator in Clojure. The core was a registry of instruments, each instrument had a recent-trades buffer, and a few cross-cutting operations updated multiple instruments at once. The team chose `ref` and `dosync` because the cross-cutting operations seemed to call for it.

Original Clojure (sketch):

```clojure
(def registry (ref {}))

(defn add-instrument [sym]
  (dosync
    (alter registry assoc sym
           {:trades (ref [])
            :stats  (ref {:vwap 0.0 :count 0})})))

(defn record-trade [sym trade]
  (dosync
    (let [inst (get @registry sym)]
      (when inst
        (alter (:trades inst) conj trade)
        (alter (:stats inst)
               (fn [s]
                 (let [n (inc (:count s))]
                   {:vwap (/ (+ (* (:vwap s) (:count s)) (* (:price trade) (:size trade)))
                             n)
                    :count n})))))))

(defn cross-update [trades-by-sym]
  (dosync
    (doseq [[sym ts] trades-by-sym
            t ts]
      (record-trade sym t))))
```

In production, two things went wrong. The `cross-update` transactions, which touched many instruments, conflicted constantly with single-instrument `record-trade` transactions, leading to a high retry rate during peak hours. And under load the abort-to-commit ratio for `cross-update` reached fifteen-to-one, which meant most of the CPU spent on cross-updates was wasted work. Throughput hit a ceiling well below the team's target.

The migration was to fine-grained locks per instrument and a discipline that `cross-update` acquired the per-instrument locks in symbol order to avoid deadlock. The cross-cutting atomicity was given up — the new code is "per-instrument atomic" rather than "across-instruments atomic", and the team accepted that a cross-update is observable mid-stream by readers. This was a real semantic loss, but the team judged it acceptable because no consumer of the data was actually reading at the granularity that would notice.

Result Clojure (sketch):

```clojure
(def registry (atom {}))

(defn add-instrument [sym]
  (swap! registry assoc sym
         {:lock   (java.util.concurrent.locks.ReentrantLock.)
          :trades (atom [])
          :stats  (atom {:vwap 0.0 :count 0})}))

(defn record-trade [sym trade]
  (when-let [inst (get @registry sym)]
    (let [lock (:lock inst)]
      (.lock lock)
      (try
        (swap! (:trades inst) conj trade)
        (swap! (:stats inst)
               (fn [s]
                 (let [n (inc (:count s))]
                   {:vwap (/ (+ (* (:vwap s) (:count s)) (* (:price trade) (:size trade)))
                             n)
                    :count n})))
        (finally (.unlock lock))))))

(defn cross-update [trades-by-sym]
  (let [syms (sort (keys trades-by-sym))   ; canonical lock order
        insts (map (fn [s] [s (get @registry s)]) syms)]
    (doseq [[s inst] insts] (when inst (.lock (:lock inst))))
    (try
      (doseq [[sym ts] trades-by-sym
              t ts]
        (when-let [inst (get @registry sym)]
          (swap! (:trades inst) conj t)
          (swap! (:stats inst) update-stats t)))
      (finally
        (doseq [[s inst] (reverse insts)] (when inst (.unlock (:lock inst))))))))
```

The lessons the team wrote up. The STM choice was driven by `cross-update`'s need for atomicity, but the consumers did not actually require that atomicity — the team had over-specified. The retry-rate problem was invisible until late because the abort metrics were not on the dashboard. The migration was straightforward only because the team had kept the data structures small and the operations short — a sprawling STM codebase would have been much harder to migrate. And once on locks, the team could profile and tune in ways they could not on STM, where the retry behaviour was opaque.

This is the kind of retrospective that should go in your engineering wiki when STM is used, kept current, and consulted before every architectural decision. It does not say STM is bad. It says STM is a trade and the trade should be re-evaluated as the system grows.

---

## Pros & Cons

Pros at the professional level. STM's intellectual contribution — composable atomic blocks with a typed effect distinction — has shaped how a generation of programming-language designers think about concurrency, and that influence is durable. STM in Haskell is production-quality and is the right tool for medium-complexity Haskell concurrency. STM in Clojure is production-quality and is the right tool when transactional invariants span multiple cells. The discipline of separating transactional state from I/O is good engineering practice regardless of whether you use STM specifically. The retry-and-block pattern is genuinely composable and gives clean code for blocking coordinators (bounded queues, semaphores, etc.). STM forces programmers to write side-effect-free transactional logic, which has portable benefits for testability — the same logic can be exercised in single-threaded tests without the runtime, because it is just pure state transformation.

Cons at the professional level. STM does not have the industry momentum that channels, actors, or async-await have, so adopting it commits you to a smaller community and fewer hires who know it. Its overhead is non-trivial and persistent. It does not interoperate cleanly with async I/O. Its semantics — snapshot vs serializable, exception handling, retry composition — are subtle enough that you need a senior engineer reviewing transactional code. Migration off STM is feasible but expensive once the codebase is large. The runtime cost is observability — without good metrics on retry and abort, you cannot tell when STM is about to fail under load. The hiring story is real: a team that uses STM extensively has a narrower funnel of candidates who can be productive on day one, and the onboarding ramp is longer than for channels or actors.

The honest summary is that STM is a tool with a known shape, known limits, and a known cost. Use it where it fits. Don't use it where it doesn't. Don't expect the broader industry to catch up — that expectation peaked fifteen years ago and is not going to. The mature posture is to treat STM the way you would treat any technical bet: with eyes open, with metrics in place, and with a migration path identified before you need it.

---

## Use Cases

Use STM at the professional level for Haskell or Clojure systems where multiple data structures need to update atomically together, where the team is fluent in the language's STM idioms, and where contention is moderate. Use it for in-process work queues, coordination primitives, registries with cross-cutting invariants, and small databases. Use it as the API surface of a library that needs to be composable with the consumer's state. Use it for game engines or simulation kernels where many parallel actors update shared state at moderate scale. Use it for orchestration logic in build systems and CI runners, where small transactional state changes coordinate larger workflows.

Do not use STM as the cross-machine consistency mechanism — that is a database's job. Do not use STM as the only synchronization mechanism in a system that also has substantial I/O — split the I/O out. Do not use STM in performance-critical inner loops — use lock-free or specialised structures. Do not adopt STM in a language that retrofitted it (Scala, Java, C++) when the rest of the ecosystem moved on. Do not use STM as the persistence layer for anything that must survive a process restart — it is in-memory only. Do not use STM where you would otherwise use a database transaction, expecting the same durability or cross-machine guarantees, because it provides neither.

A useful heuristic for the use-case question is to enumerate, at design time, every operation that will mutate shared state, and to ask of each: does this operation atomically span multiple cells in a way that the consumer cares about? If the answer is yes for more than two or three operations, STM is a reasonable choice. If the answer is yes for one or two operations, you can usually handle those with a coarser lock and keep the rest of the system simpler. If the answer is no for all operations, you are picking STM out of preference, not necessity, and the preference may not survive the maintenance cycle.

---

## Coding Patterns

The library pattern: expose `STM` actions for composability and `IO` wrappers for convenience, never `unsafeIOToSTM`, document the error model explicitly, and ship metrics for retry and abort counts. The retrospective pattern: when a system outgrows STM, migrate a coherent subsystem at a time behind a clean boundary, do not migrate piecemeal. The instrumentation pattern: every STM transaction in a long-running service is wrapped in a thin metrics layer that counts commits, aborts, and durations, and the dashboard shows the ratio next to throughput. The composition pattern: use `orElse` for choice between transactional strategies and `retry` for blocking, do not implement those by hand on top of `IO`.

The boundary pattern: identify the boundary between transactional state and the outside world, give it a name in the architecture, and ensure every flow crosses it exactly once. I/O happens on one side, STM on the other, and the boundary is the only place where data crosses. This pattern keeps the no-IO-in-transactions rule from leaking into your team's daily life — they think about the boundary, not about the rule.

The split-state pattern: when a transactional cell holds a record with multiple independent fields, split it into multiple cells, one per field. This reduces false sharing — two transactions that update different fields no longer conflict. The cost is a small amount of bookkeeping; the benefit can be a large reduction in retries.

The phantom-read pattern: when a transaction's correctness depends on a fact that it read but did not write (for example "there exists at least one other doctor on call"), explicitly write to the cells you read so that the conflict detection sees them. This is the manual fix for write skew under snapshot isolation and the right pattern when you cannot upgrade your isolation level.

---

## Clean Code

Clean STM at the professional level looks like: small named `STM` actions; explicit `Either` for recoverable errors; no `IO` (Haskell) or impure calls (Clojure) inside transactions; transactions that read only what they need and write only what they must; metrics around the `atomically` boundary; a public API that exposes both `STM` and `IO` layers; documentation that names the isolation level you provide; code review that flags long transactions and impure calls; and tests that exercise concurrent paths under deliberate contention. None of this is exotic. It is the engineering hygiene that any concurrency primitive needs to be safe in production.

The naming convention is also part of clean code. In Haskell, a function that returns `STM a` should be named `something` (no suffix), and a function that returns `IO a` and uses `atomically` internally should be named `somethingIO` or `atomicallySomething`. Consumers reading code can then tell at a glance which layer they are in. The same convention applies in Clojure: a function intended to be called inside `dosync` should be documented as such, and its name or namespace should signal it.

The documentation convention. Every public STM action should have a docstring that names: the cells it reads, the cells it writes, whether it can `retry`, whether it can throw, and whether it is composable with other actions. This is information the consumer needs to use the API correctly, and it cannot be recovered from the type alone — the type `STM a` does not tell you which cells the action touches. Treat the docstring as part of the API contract.

---

## Best Practices

Adopt STM only in languages where it ships natively. Expose a composable `STM` API plus an `IO` wrapper for libraries. Instrument every `atomically` boundary with commit/abort counters. Document your isolation level and write-skew exposure. Forbid `unsafeIOToSTM` in code review. Migrate off STM as one coherent subsystem when contention metrics warrant. Treat STM as one tool, not a paradigm. Read at least one of the canonical papers — Composable Memory Transactions, Harris & Fraser 2003 — before designing a new library that uses STM. Watch the effect-systems space for the next generation of this idea.

Keep transactions small. The single biggest correlate of STM performance failure in production is transaction size — long transactions touch more cells, conflict with more concurrent transactions, and retry more often. A transaction that does more than ten cell accesses or more than a hundred microseconds of work should be examined critically.

Maintain a migration runbook. Even if you have no plan to migrate off STM today, write down what the migration would look like — which subsystem first, which target, what the metrics threshold would be — so that when the time comes the team is not improvising. This is part of operational maturity, not pessimism.

Hire and onboard with STM in mind. A team that uses STM extensively needs every engineer to understand the model within their first month. Plan the onboarding curriculum accordingly: paper, language tutorial, internal codebase tour, paired transaction review. Without this, STM knowledge stays concentrated in a few engineers, and the bus factor becomes a liability.

---

## Edge Cases & Pitfalls

A library that exposes only `IO` wrappers around `STM` actions silently destroys composability — the consumer cannot include your action in a larger transaction. A library that exposes `STM` without wrapping `IO` versions forces every consumer to learn STM even for trivial uses. The professional solution is both layers.

Snapshot isolation vs serializability is a runtime property, not a syntactic one. Clojure programs that rely on `dosync` without `ensure` can silently exhibit write skew under load that does not show up in tests. The fix is a code review checklist: every `dosync` that reads to make a decision must `ensure` the refs it reads.

STM aborts are silent. A system can run for months with a fifteen-to-one abort-to-commit ratio and look healthy in throughput metrics. The first sign of trouble is a sudden cliff when load increases ten percent. Without abort metrics, you cannot see this coming.

`unsafeIOToSTM` in Haskell breaks every soundness property the type system promised. A single use in a library leaks into every transaction that uses the library. Even if you "know what you're doing", reviewers six months later will not.

Migration tests that pass in single-threaded mode will fail under load on the new locking design if lock ordering is wrong. Migration off STM is a concurrency change and needs the same testing rigour as the original concurrency design.

Long-lived `TVar` references in caches can pin memory in ways that are hard to track. A transactional cache that allocates one `TVar` per cached entry and never deallocates them grows unboundedly, even if the underlying data is reclaimable. The fix is to evict entries explicitly and to use weak references or bounded structures rather than naive open-ended growth.

GHC's STM is fair within a generation but not strictly fair across generations. A high-traffic `TVar` that is constantly being modified can starve a transaction that wants to retry on it — every time the waiting transaction is woken, the value changes again before it can commit. The pattern is rare but appears in heavily loaded coordination structures. The workaround is to batch updates or to introduce a back-off in the producer.

---

## Common Mistakes

Adopting STM in a language without first-class support because a blog post said it was the future. Assuming STM scales linearly with cores when contention scales superlinearly. Hiding I/O inside transactions in Clojure where the type system cannot stop it. Writing one giant transaction because it is convenient and then being surprised by retry storms. Conflating snapshot isolation with serializability and ignoring write skew. Not measuring the abort rate. Migrating off STM piecemeal so the codebase is half locked and half transactional for years. Confusing the academic paper's microbenchmarks with the production workload's actual contention profile.

Treating STM as a replacement for a real database. STM is in-memory, process-local, and non-durable. A team that built a "ledger" on STM and lost a week of transactions when the process crashed had made a category mistake — STM is for in-process coordination, not for persistent state. Treating STM as a magic wand that solves all concurrency problems. STM solves some problems and creates others. The team that says "we'll just use STM" without analyzing the workload is not engineering, it is shopping.

---

## Tricky Points

The contention story is the trickiest part of operating STM. Two transactions conflict if their read sets and write sets overlap in a way that violates serializability, but this is decided at commit time, not at start time, and the system silently re-runs aborted transactions. A program with a fifteen-to-one abort ratio computes the same answer as a program with a one-to-one ratio, but at fifteen times the CPU cost. There is no static analysis that catches this — only metrics in production.

The interaction between STM and exceptions is also tricky. In Haskell, an exception inside a transaction aborts the transaction (writes are discarded) and propagates out of `atomically`. This is generally what you want, but it means transactions cannot be used as a redo mechanism — you cannot catch the exception, retry the transaction with different inputs, and expect the system to do the right thing. The retry has to be at a higher level.

The interaction between STM and async I/O is the trickiest of all in modern Haskell. The community has not settled on a way to await an I/O event inside a transaction without breaking the no-IO rule. Workarounds — write a thread that watches the I/O, signals a `TVar`, and lets a transaction `retry` on that `TVar` — are awkward but unavoidable.

The composition of `orElse` and `retry` is subtle. `orElse a b` tries `a` first, and only tries `b` if `a` calls `retry`. It does not try `b` if `a` throws an exception. So the choice operator is a choice between retry conditions, not between exception conditions, and the consumer must know this. The mental model "if the first one fails, try the second" is wrong in the exception case.

The interaction between STM and time is also tricky. A transaction cannot read the current time and expect that to be part of its consistent snapshot — `getCurrentTime` is `IO`, not `STM`, and reading it inside a transaction would violate the no-IO rule. Time-based decisions must be made at the `atomically` boundary, with the result threaded in as data. This forces a particular code structure that some teams find awkward.

---

## Test Yourself

1. State the difference between snapshot isolation and serializability, and give an example of a workload where the difference matters.
2. Why is `unsafeIOToSTM` always wrong in a library API?
3. What does Composable Memory Transactions contribute that prior STM work did not?
4. When should a library expose both `STM` and `IO` versions of its operations?
5. What is the migration cost of moving a Clojure system from `ref`/`dosync` to per-cell locks?
6. Which language ecosystems still use STM in production today, and which abandoned it?
7. What is the relationship between STM and algebraic effects, and where does OCaml 5 fit?
8. How would you instrument a Haskell STM transaction for production observability?
9. Give one anti-pattern that is harder to spot in Clojure than in Haskell, and explain why.
10. What does write skew look like in a hospital scheduling system, and how do you prevent it under snapshot isolation?

---

## Tricky Questions

What would have happened if Intel TSX had not had the silicon errata that delayed its production deployment by years? Would STM have a different role today? Plausibly the hybrid TM story would have gone further, but the I/O constraint would still have limited STM's adoption, so the long-term trajectory is probably similar — slower decline, same destination.

If your team is starting a green-field concurrent system in 2026, in a language where STM is available, when do you choose it over the alternatives? When the data is small, the operations span multiple cells transactionally, and the team is already fluent. Otherwise lean on channels, actors, or immutable structures.

Could effect handlers in OCaml 5 produce a competitive STM implementation in the next three years? Technically yes, performance-wise unclear, ecosystem-wise unlikely as a priority. The OCaml community is focused on async I/O over effects, not on STM over effects. Someone will publish a research paper; nobody will deploy it widely.

Why does the Clojure community treat STM as one tool among several while the Haskell community treats it as the default concurrency mechanism? Two reasons. The Haskell type system enforces the no-IO rule, making STM safer to use as a default. And Clojure has multiple high-quality concurrency primitives (`atom`, `agent`, `core.async`), so STM has natural alternatives in idiomatic code. Haskell has fewer alternatives at the same level of polish, so STM occupies more design space.

Is there a credible STM revival on the horizon? Not in the short term. The next concurrency story is structured concurrency plus async, possibly mediated by effect handlers. STM is not central to that story. It will continue to exist in its current niches, and that is the realistic forecast.

---

## Cheat Sheet

History: Herlihy & Moss 1993 (HTM), Shavit & Touitou 1995 (STM), Harris & Fraser 2003 (dynamic STM with language integration), Harris et al. 2005 (Composable Memory Transactions).

Ecosystem: Haskell active; Clojure active but de-centred; Scala declining; Java/C# stalled; GCC deprecated.

Library design: expose `STM` and `IO` layers; ban `unsafeIOToSTM`; instrument commit/abort; document isolation level.

Migration paths off STM: fine-grained locks; actors; immutable persistent structures; sharding. Pick by access pattern.

Anti-patterns: I/O in transactions; very long transactions; retry storms hidden behind metrics.

Effect systems: STM as a handler; Koka and OCaml 5 are the production-grade effect-system languages today; no widely-deployed STM-on-effects yet.

Snapshot vs serializable: Haskell STM is serializable; Clojure default is snapshot; write skew is the cost of snapshot.

The future: incremental — async + STM, distributed STM, real-time STM — none likely to be transformative in the next five years.

---

## Summary

STM at the professional level is a story of an idea that arrived with a hardware proposal in 1993, was reformulated in software in 1995, was made dynamic and practical in 2003, and was made composable in 2005. It rose, hyped through 2010, settled into two language ecosystems, and is now a competent tool used where it fits. The intellectual contribution — composable atomic blocks distinguished from I/O at the type level — is durable and will be reincarnated in future effect-system languages. The runtime story is mature and unlikely to expand. The migration story off STM is real, well-understood, and should be planned before adoption rather than after the crisis.

The professional engineer reads the papers, understands the trade-off, picks the right tool per project, instruments for abort metrics, and is ready to migrate when the trade changes. None of this is glamorous. All of it is the work that keeps systems running for a decade.

The summary in one sentence. STM is a competent, well-understood, language-specific concurrency tool whose intellectual influence exceeds its industrial footprint, and the professional posture toward it is informed selection — adopt where the composability advantage is real, instrument for the failure modes, migrate when the workload outgrows it, and watch the effect-systems space for its successor.

---

## What You Can Build

A production-quality Haskell library exposing an `STM` API with composable error handling, ready to be used by other teams in your organization. A retrospective document for your engineering wiki on a Clojure STM system that migrated to fine-grained locks, including the metrics that triggered the migration and the steps taken. A monitoring dashboard for a Haskell service that surfaces STM abort ratios per major transaction type and alerts on cliffs. A migration plan for a hypothetical system from `dosync`/`ref` to immutable persistent state with `atom`, with a phased rollout and a rollback path. A position paper, internal or external, on when your organization will and will not adopt STM, written so that engineers three years from now have the same answer.

A prototype STM-on-effects implementation in OCaml 5, demonstrating that the abstraction can be expressed as a handler over the new effects feature, even if production-grade performance is not yet there. A teaching workshop for new hires that introduces STM by way of a small composable example and walks them through the contention failure modes with intentional load tests. An internal RFC that argues for or against adopting STM in a specific new service, weighing the workload's transactional needs against the team's skills and the language's support, with concrete metrics to revisit the decision twelve months in.

---

## Further Reading

- Herlihy and Moss, "Transactional Memory: Architectural Support for Lock-Free Data Structures", ISCA 1993 — the origin paper, hardware focus.
- Shavit and Touitou, "Software Transactional Memory", PODC 1995 — the software reformulation.
- Harris and Fraser, "Language Support for Lightweight Transactions", OOPSLA 2003 — dynamic STM in Java.
- Harris, Marlow, Peyton Jones, Herlihy, "Composable Memory Transactions", PPoPP 2005 — the paper that made STM influential in PL design.
- Larus and Rajwar, "Transactional Memory", Synthesis Lectures 2007 — book-length survey of the field at its peak.
- Cascaval, Blundell, et al., "Software Transactional Memory: Why Is It Only a Research Toy?", CACM 2008 — the famous skeptical critique.
- Plotkin and Pretnar, "Handlers of Algebraic Effects", ESOP 2009 — foundations of effect handlers.
- Leijen, "Type Directed Compilation of Row-Typed Algebraic Effects", POPL 2017 — Koka's effect system.
- Dolan, Sivaramakrishnan, Madhavapeddy, "Bounding Data Races in Space and Time", PLDI 2018 — OCaml's memory model on the way to effects.
- The `stm` package documentation on Hackage — the canonical Haskell STM reference.
- The Clojure refs and transactions guide on clojure.org — the canonical Clojure STM reference.

---

## Related Topics

- [Junior STM](junior.md) — the introduction to the topic.
- [Middle STM](middle.md) — the implementation-level details.
- [Senior STM](senior.md) — the runtime-level deep dive.
- [Lock-Free Programming](../../README.md) — the alternative STM partially automates.
- [Memory Models](../../README.md) — the substrate STM is built on.
- [Effect Systems and Algebraic Effects](../../README.md) — the modern successor framework.
- [Database Isolation Levels](../../README.md) — the parent discipline whose vocabulary STM borrows.
- [Actors and Message Passing](../../README.md) — one migration target.
- [Immutable Persistent Data Structures](../../README.md) — another migration target.

---

## Final Notes for the Professional Reader

If you have read this page in order, you now hold a complete picture: the historical arc from Herlihy and Moss to Composable Memory Transactions, the ecosystem map showing where STM is alive and where it has receded, the design rules for libraries that expose STM, the migration paths off STM when a system outgrows it, and the relationship between STM and the emerging effect-systems landscape. The thread connecting all of this is that STM is neither a failure nor a panacea — it is a mature, bounded tool whose costs and benefits are understood and whose successor framework is being built right now in OCaml 5 and Koka.

The professional posture is informed neutrality. Do not advocate for STM because the paper is elegant; do not dismiss STM because the industry never adopted it widely. Both stances are unprofessional. Instead, evaluate the workload, the language, the team, and the operational risk; choose the tool that fits; instrument for the failure modes; and revisit the decision when the workload changes. This is the posture that produces systems that work in production for a decade, and it is the posture this page has tried to teach.

---

## Diagrams & Visual Aids

A timeline showing 1993 (Herlihy & Moss HTM), 1995 (Shavit & Touitou STM), 2003 (Harris & Fraser dynamic STM), 2005 (Composable Memory Transactions), 2008 (CACM skeptical critique), 2013 (Intel TSX shipped), 2021 (Intel TSX deprecated), 2022 (OCaml 5 effect handlers ship), with the rise and decline of hype overlaid as a curve.

A two-by-two matrix with axes "language designed around STM" / "STM retrofitted" and "active production use" / "declining or abandoned". Haskell sits in (designed for, active). Clojure sits in (designed for, active). Scala-STM sits in (retrofitted, declining). Java STMs sit in (retrofitted, abandoned). GCC STM sits in (retrofitted, abandoned).

A migration-path diagram showing four arrows out of a central "STM" node, to "fine-grained locks" (predictable perf, lost composability), "actors" (no shared state, higher latency), "immutable + atom" (lock-free reads, function-of-state updates), and "sharding" (no contention, no cross-shard atomicity). Each arrow is labelled with the workload property that motivates it.

A flowchart for "should I use STM in this project" with four decision diamonds: (1) is the language Haskell or Clojure? (no -> use channels or actors); (2) does the transactional unit span multiple cells? (no -> use atom or single ref); (3) is contention moderate? (no -> use fine-grained locks or sharding); (4) is the team fluent in STM idioms? (no -> use simpler primitives, plan to learn). Yes on all four -> use STM.

A diagram showing the architecture of an effect-handler-based STM, where the user program emits abstract `Read`, `Write`, `Retry`, `OrElse` effects and a handler installed at the `atomically` boundary interprets them against any chosen runtime — classical STM, hardware TM, locks, or single-threaded mock for tests — illustrating how STM-as-effect decouples API from implementation.

A sequence diagram of the typical contention failure mode: many transactions running concurrently, all eventually aborting and restarting, with a heat map showing CPU time spent on doomed work as a fraction of total CPU. The diagram explains why throughput appears stable until a sudden cliff: the system runs harder and harder on aborted work as load grows, until it cannot keep up at all.

A layered architecture diagram for a service that uses STM internally but exposes a non-STM public API. The layers are: HTTP handlers (IO), service layer (IO with calls into `atomically`), domain layer (STM-typed actions), and state (TVars). The diagram makes visible that STM lives inside a boundary, that the boundary is named, and that everything outside the boundary is conventional non-STM code. This is the architectural pattern professional STM users converge on.
