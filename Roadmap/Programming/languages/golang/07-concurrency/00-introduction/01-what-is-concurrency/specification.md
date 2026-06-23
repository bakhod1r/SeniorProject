# What is Concurrency — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [Definitions: Concurrency, Parallelism, Asynchrony](#definitions-concurrency-parallelism-asynchrony)
3. [Concurrency in the Go Specification](#concurrency-in-the-go-specification)
4. [Concurrency in the Go Memory Model](#concurrency-in-the-go-memory-model)
5. [Concurrency in the Runtime Package](#concurrency-in-the-runtime-package)
6. [Historical and Theoretical Sources](#historical-and-theoretical-sources)
7. [Seminal Papers and Books](#seminal-papers-and-books)
8. [Standards and Specifications Outside Go](#standards-and-specifications-outside-go)
9. [References](#references)

---

## Introduction

This file collects formal definitions, primary sources, and references. The vocabulary used informally elsewhere in this section is given precise statements here, traced to their authoritative sources.

---

## Definitions: Concurrency, Parallelism, Asynchrony

### Concurrency

**Definition (Rob Pike, 2012):** "Concurrency is the composition of independently executing computations." [Pike, *Concurrency is not Parallelism*]

**Definition (Joe Armstrong, Erlang):** "Concurrency is a way to organize a program so that we can naturally describe many things happening at once." [Armstrong, *Programming Erlang*]

**Definition (Dijkstra, 1968):** "Cooperating sequential processes" — multiple sequential programs that interact through shared state or messages.

Concurrency is a *property of the program*: the program is structured as multiple independent computations.

### Parallelism

**Definition (Rob Pike, 2012):** "Parallelism is the simultaneous execution of (possibly related) computations."

Parallelism is a *property of the execution*: at a given instant, more than one computation is making progress on physical hardware.

### Asynchrony

A computation is **asynchronous** when its caller does not wait for it to complete. Asynchrony is a property of an interface, not of computation. The caller continues; the callee finishes some time later.

Asynchrony is often used to *implement* concurrency: an asynchronous I/O call lets the program issue many I/Os without waiting.

### Independence

Two computations are **independent** if neither's correctness depends on the other's order of execution. Independence is a necessary condition for safely parallelising them.

---

## Concurrency in the Go Specification

From `https://go.dev/ref/spec#Go_statements`:

> A "go" statement starts the execution of a function call as an independent concurrent thread of control, or *goroutine*, within the same address space.

Key normative facts:

1. A goroutine is a "concurrent thread of control" — concurrent, not necessarily parallel.
2. Goroutines share the **same address space**. All globals, heap, and function values are shared.
3. The `go` keyword takes a function call expression. Arguments are evaluated in the calling goroutine.
4. Function values and parameters are evaluated *before* the goroutine starts.
5. Return values are discarded.

The spec does not mention OS threads. The mapping from goroutines to threads is an implementation detail of the runtime.

---

## Concurrency in the Go Memory Model

The Go Memory Model (`https://go.dev/ref/mem`, revised 2022) defines:

> *The Go memory model specifies the conditions under which reads of a variable in one goroutine can be guaranteed to observe values produced by writes to the same variable in a different goroutine.*

Key normative content:

1. **No guarantees without synchronisation.** Reads in one goroutine may observe writes from another in any order, including "not at all," unless synchronisation establishes a happens-before relation.
2. **Synchronisation primitives** that establish happens-before include: channel send/receive, mutex lock/unlock, once.Do, atomic operations (since 2022), and goroutine creation / completion.
3. **The race detector** is the official tool for finding data races. A program with a data race is considered broken.

The 2022 revision strengthened atomic operations to provide sequential consistency. Earlier versions left this implementation-defined.

See [04-memory-model](../04-memory-model/) for in-depth coverage.

---

## Concurrency in the Runtime Package

From `pkg.go.dev/runtime`:

### `runtime.GOMAXPROCS`

```go
func GOMAXPROCS(n int) int
```

> GOMAXPROCS sets the maximum number of CPUs that can be executing simultaneously and returns the previous setting. If n < 1, it does not change the current setting. This call will go away when the scheduler improves.

Note the spec phrasing: "may execute simultaneously" — not "must" and not "always." The scheduler can use fewer.

Default since Go 1.5: `runtime.NumCPU()`.

### `runtime.NumGoroutine`

```go
func NumGoroutine() int
```

> NumGoroutine returns the number of goroutines that currently exist.

Includes the main goroutine, system goroutines (GC, sysmon, network poller helpers), and user-spawned goroutines.

### `runtime.NumCPU`

```go
func NumCPU() int
```

> NumCPU returns the number of logical CPUs usable by the current process. The set of available CPUs is checked by querying the operating system at process startup.

On Linux, respects cgroup CPU limits since Go 1.5 partially, fully since Go 1.18 (via the `GOMAXPROCS` automation efforts).

### `runtime.Gosched`

```go
func Gosched()
```

> Gosched yields the processor, allowing other goroutines to run. It does not suspend the current goroutine, so execution resumes automatically.

Rarely needed in modern Go.

### `runtime.LockOSThread` / `runtime.UnlockOSThread`

```go
func LockOSThread()
func UnlockOSThread()
```

Pin a goroutine to its OS thread. Used for thread-local state in foreign libraries (e.g., OpenGL contexts, certain system calls that require thread identity).

---

## Historical and Theoretical Sources

### Dijkstra, 1965: Cooperating Sequential Processes

The first paper to systematically describe concurrent programming. Introduced semaphores, the dining philosophers problem, and the discipline of reasoning about interleaved executions.

### Hoare, 1978: Communicating Sequential Processes

The CSP paper. Defined a process algebra in which independent sequential processes communicate by passing values through synchronous channels. Influenced Occam, Erlang, and Go.

> "Input and output are basic primitives of programming. Parallel composition of communicating sequential processes is a fundamental program structuring method."

Go inherits the **channel** abstraction and the **share by communicating** philosophy from CSP, though Go's channels are buffered and asynchronous in ways CSP's are not. See [02-csp-model](../02-csp-model/) for details.

### Hewitt, Bishop, Steiger, 1973: A Universal Modular Actor Formalism

The actor model. An actor is an independent computation that sends messages to other actors. Erlang and Akka are the most prominent implementations. Different from CSP in that actors have identities and message queues (mailboxes), whereas CSP channels are anonymous and synchronous.

### Lamport, 1974: A New Solution of Dijkstra's Concurrent Programming Problem

Introduced the **bakery algorithm**, a lock-free mutual exclusion algorithm using only atomic reads and writes. Foundational for understanding what synchronisation requires.

### Lamport, 1978: Time, Clocks, and the Ordering of Events in a Distributed System

The "happens-before" relation. The basis of every modern memory model, including Go's. Read the paper at least once.

### Amdahl, 1967: Validity of the Single-Processor Approach

The original paper on the speedup formula. Read it; it is short and prescient.

### Gustafson, 1988: Reevaluating Amdahl's Law

The counter-argument: in practice, problem size grows with hardware. Sets out the "weak scaling" perspective.

---

## Seminal Papers and Books

### Books

- **Robert L. Bocchino Jr. et al., *A Type and Effect System for Deterministic Parallel Java*** — formal foundations for safe concurrency.
- **Paul Butcher, *Seven Concurrency Models in Seven Weeks*** — survey of threads, locks, actors, CSP, software transactional memory, lambda calculus, GPU programming.
- **Maurice Herlihy and Nir Shavit, *The Art of Multiprocessor Programming*** — the canonical textbook on shared-memory concurrent algorithms.
- **Joe Armstrong, *Programming Erlang*** — Erlang's actor model, distilled.
- **Katherine Cox-Buday, *Concurrency in Go*** — Go-specific concurrency patterns.

### Papers

- Dijkstra, *Solution of a Problem in Concurrent Programming Control*, CACM 1965 — Dekker's algorithm.
- Lamport, *How to Make a Multiprocessor Computer that Correctly Executes Multiprocess Programs*, IEEE TC 1979 — sequential consistency.
- Boehm, *Threads Cannot be Implemented as a Library*, PLDI 2005 — why language-level concurrency support matters.
- Adve and Boehm, *Memory Models: A Case for Rethinking Parallel Languages and Hardware*, CACM 2010 — modern memory model survey.

### Online

- Rob Pike, *Concurrency is not Parallelism*, Heroku Waza 2012: <https://go.dev/blog/waza-talk>
- Sameer Ajmani, *Advanced Go Concurrency Patterns*, Google I/O 2013: <https://go.dev/talks/2013/advconc.slide>
- Dmitry Vyukov, *Scalable Go Scheduler Design Doc*: <https://go.dev/s/go11sched>

---

## Standards and Specifications Outside Go

### POSIX Threads (pthread)

The 1995 IEEE 1003.1c standard defined a thread API for Unix. Most languages have FFI-level bindings to pthreads, but their semantics differ subtly. Go does not use pthreads at the application level; the runtime uses underlying OS threads internally (often via `clone()` on Linux).

### C++ memory model (since C++11)

Introduced `std::memory_order_*` for fine-grained atomic operations. More expressive than Go's atomic (which is essentially `std::memory_order_seq_cst` for all operations) but harder to use correctly.

### Java memory model (JSR 133, 2004)

The first widely deployed formal memory model for a mainstream language. Defined happens-before semantics for `volatile`, `synchronized`, and `Thread.start/join`. Heavily influenced Go's memory model.

### x86 memory model (TSO)

The x86 architecture provides Total Store Order: reads may be reordered relative to earlier writes to the same processor, but writes are seen in program order across processors. Cheaper than full sequential consistency.

### ARM memory model

Much weaker than x86. Most operations may be reordered; explicit fences are needed. Go's runtime inserts fences where the memory model demands.

---

## References

- The Go Programming Language Specification: <https://go.dev/ref/spec>
- The Go Memory Model (2022): <https://go.dev/ref/mem>
- Go runtime package docs: <https://pkg.go.dev/runtime>
- Effective Go: <https://go.dev/doc/effective_go>
- Go FAQ on concurrency: <https://go.dev/doc/faq#csp>
- Dmitry Vyukov, *Scalable Go Scheduler Design*: <https://go.dev/s/go11sched>
- Rob Pike, *Concurrency is not Parallelism*: <https://go.dev/blog/waza-talk>
- Tony Hoare, *Communicating Sequential Processes*, CACM 21(8), 1978.
- Edsger Dijkstra, *Cooperating Sequential Processes*, EWD 123, 1965.
- Carl Hewitt et al., *A Universal Modular Actor Formalism for Artificial Intelligence*, IJCAI 1973.
- Leslie Lamport, *Time, Clocks, and the Ordering of Events in a Distributed System*, CACM 21(7), 1978.
- Gene Amdahl, *Validity of the Single-Processor Approach to Achieving Large-Scale Computing Capabilities*, AFIPS 1967.
- John Gustafson, *Reevaluating Amdahl's Law*, CACM 31(5), 1988.
- Sarita Adve and Hans-J. Boehm, *Memory Models: A Case for Rethinking Parallel Languages and Hardware*, CACM 53(8), 2010.
