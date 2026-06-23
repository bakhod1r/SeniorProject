# CSP Model — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [Primary Sources](#primary-sources)
3. [CSP Notation Reference](#csp-notation-reference)
4. [How Go's Channels Implement CSP Semantics](#how-gos-channels-implement-csp-semantics)
5. [Channel Operations in the Go Spec](#channel-operations-in-the-go-spec)
6. [Channel Operations in the Memory Model](#channel-operations-in-the-memory-model)
7. [Related Formalisms](#related-formalisms)
8. [References](#references)

---

## Introduction

This file collects formal definitions, primary sources, and authoritative references for the CSP model and its Go implementation. The vocabulary used informally elsewhere is given precise statements here, traced to primary documentation.

---

## Primary Sources

### Hoare's 1978 paper

C. A. R. Hoare, *Communicating Sequential Processes*, Communications of the ACM 21(8), pp. 666–677, August 1978.

The founding paper. Introduced sequential processes communicating exclusively through synchronous channels with named events. Compact (12 pages), readable, and still relevant.

Available online: <https://www.cs.cmu.edu/~crary/819-f09/Hoare78.pdf>

### Hoare's 1985 book

C. A. R. Hoare, *Communicating Sequential Processes*, Prentice-Hall International, 1985.

The full book-length treatment. Covers traces, failures, divergences, and refinement. Out of print but available as PDF: <http://www.usingcsp.com/cspbook.pdf>

A 2004 updated edition is available as *Communicating Sequential Processes* (UsingCSP.com).

### Roscoe's textbook

A. W. Roscoe, *The Theory and Practice of Concurrency*, Prentice-Hall, 1997. Updated 2010 as *Understanding Concurrent Systems*.

The most thorough modern treatment of CSP, including refinement checking with FDR.

### Go documentation

- Effective Go — *Concurrency*: <https://go.dev/doc/effective_go#concurrency>
- The Go Programming Language Specification — *Channel types* and *Send / Receive statements*: <https://go.dev/ref/spec#Channel_types>
- The Go Memory Model — *Channel communication*: <https://go.dev/ref/mem>
- Rob Pike, *Share Memory By Communicating*: <https://go.dev/blog/codelab-share>
- Sameer Ajmani, *Go Concurrency Patterns: Pipelines and cancellation*: <https://go.dev/blog/pipelines>

---

## CSP Notation Reference

A reference for reading CSP-M papers and texts.

### Processes

- `STOP` — process that does nothing (deadlocked).
- `SKIP` — process that terminates successfully.
- `DIV` — divergent process (infinite internal events).

### Prefix and recursion

- `a -> P` — engage in event `a`, then behave as `P`.
- `P = a -> P` — recursive definition: `P` does `a` and becomes `P` again.
- `mu p. (a -> p)` — formal recursion operator.

### Choice

- `P [] Q` — external choice; the environment picks.
- `P |~| Q` — internal (nondeterministic) choice; the process picks.
- `a -> P [] b -> Q` — common pattern: choice based on which event happens.

### Communication

- `c!v` — send value `v` on channel `c`.
- `c?x` — receive value into variable `x` on channel `c`.
- `c!v -> P` — send `v`, then `P`.
- `c?x -> P` — receive into `x`, then `P` (where `P` may use `x`).

### Composition

- `P ; Q` — sequential: `P` runs, terminates with `SKIP`, then `Q`.
- `P || Q` — alphabetised parallel: synchronise on shared events.
- `P [| A |] Q` — partial parallel: synchronise only on events in set `A`.
- `P ||| Q` — interleave: no synchronisation, events from either.

### Hiding and renaming

- `P \ A` — hide events in set `A` (make them internal).
- `P [[ a <- b ]]` — rename event `a` to `b`.

### Termination

- `P ; Q` only sequentially composes if `P` can `SKIP`.

### Refinement

- `P [= Q` — `Q` refines `P` (every behaviour of `Q` is a behaviour of `P`).
- `P [F= Q` — failures refinement.
- `P [FD= Q` — failures-divergences refinement.

---

## How Go's Channels Implement CSP Semantics

Go does not implement pure CSP. The differences are deliberate.

### What Go retains from CSP

- **Goroutines as processes.** Each goroutine is a sequential program.
- **Channels as communication primitives.** First-class typed channels.
- **Synchronous communication option.** Unbuffered channels rendezvous.
- **External choice.** `select` corresponds to CSP's `[]`.
- **No shared identities.** Goroutines do not have public identities; channels are anonymous.

### What Go adds

- **Buffered channels.** Asynchronous communication with bounded buffers.
- **Closing.** Channels can be closed; receivers detect closure.
- **Directional channel types.** `chan<- T` and `<-chan T`.
- **Channels as values.** Channels can be passed in channels (π-calculus mobility).
- **`nil` channels.** Block forever; used as `select`-disabling sentinels.
- **`default` in `select`.** Non-blocking variants.

### What Go does not provide

- **Formal refinement checking.** No tool integration with FDR or similar.
- **Synchronous-only constraint.** Buffered channels relax the synchronisation discipline.
- **Process algebra at the type level.** No language enforcement of CSP discipline.
- **Hierarchical naming.** Goroutines have no public names or hierarchical addresses.
- **Crash isolation.** A panic in any goroutine, unrecovered, kills the program.

These differences are pragmatic. Go's channels are easier to use than pure CSP's; they trade away formal cleanliness for ergonomic accessibility.

---

## Channel Operations in the Go Spec

From `https://go.dev/ref/spec`:

### Channel types

> A channel provides a mechanism for concurrently executing functions to communicate by sending and receiving values of a specified element type. The value of an uninitialized channel is `nil`.
>
> The optional `<-` operator specifies the channel direction, *send* or *receive*. If no direction is given, the channel is bidirectional.

### Send statements

> A send statement sends a value on a channel. The channel expression's core type must be a channel, the channel direction must permit send operations, and the type of the value to be sent must be assignable to the channel's element type.
>
> ```
> SendStmt = Channel "<-" Expression .
> Channel = Expression .
> ```
>
> Both the channel and the value expression are evaluated before communication begins. Communication blocks until the send can proceed.

### Receive operator

> For an operand `ch` whose core type is a channel, the value of the receive operation `<-ch` is the value received from the channel `ch`. The channel direction must permit receive operations, and the type of the receive operation is the element type of the channel. The expression blocks until a value is available.
>
> A receive expression used in an assignment or initialization of the special form
> ```
> x, ok = <-ch
> x, ok := <-ch
> var x, ok = <-ch
> ```
> yields an additional untyped boolean result reporting whether the communication succeeded. The value of `ok` is `true` if the value received was delivered by a successful send operation to the channel, or `false` if it is a zero value generated because the channel is closed and empty.

### Close

> The built-in function `close` records that no more values will be sent on the channel. It is an error if `ch` is a receive-only channel. Sending to or closing a closed channel causes a run-time panic. Closing the nil channel also causes a run-time panic. After calling `close`, and after any previously sent values have been received, receive operations will return the zero value for the channel's type without blocking.

### Select statements

> A "select" statement chooses which of a set of possible send or receive operations will proceed. It looks similar to a "switch" statement but with the cases all referring to communication operations.
>
> ```
> SelectStmt = "select" "{" { CommClause } "}" .
> CommClause = CommCase ":" StatementList .
> CommCase   = "case" ( SendStmt | RecvStmt ) | "default" .
> RecvStmt   = [ ExpressionList "=" | IdentifierList ":=" ] RecvExpr .
> RecvExpr   = Expression .
> ```
>
> Execution of a "select" statement proceeds in several steps:
>
> 1. For all the cases in the statement, the channel operands of receive operations and the channel and right-hand-side expressions of send statements are evaluated exactly once, in source order, upon entering the "select" statement. The result is a set of channels to receive from or send to, and the corresponding values to send.
>
> 2. If one or more of the communications can proceed, a single one that can proceed is chosen via a uniform pseudo-random selection. Otherwise, if there is a default case, that case is chosen. If there is no default case, the "select" statement blocks until at least one of the communications can proceed.

These three sections — Channel types, Send/Receive statements, Select statements — together define the Go channel semantics.

---

## Channel Operations in the Memory Model

From `https://go.dev/ref/mem` (2022 revision):

> A send on a channel is *synchronised before* the completion of the corresponding receive from that channel.
>
> The *k*th receive on a channel with capacity *C* is *synchronised before* the completion of the (*k*+*C*)th send from that channel.
>
> The closing of a channel is *synchronised before* a receive that returns because the channel is closed.

These three rules connect channel operations to the happens-before relation. The practical consequence: communicating via a channel implies memory ordering. Anything written before a send is visible after the corresponding receive.

```go
var x int
done := make(chan struct{})

go func() {
    x = 42         // write
    close(done)    // synchronisation
}()

<-done             // happens-after the close
fmt.Println(x)     // prints 42 — guaranteed
```

The `close(done)` is synchronised-before the `<-done`. The write to `x` happens-before the close (sequential within the goroutine). Transitively, the write to `x` is visible after `<-done`.

This is why CSP-discipline code is race-free: every shared write is followed by a channel operation that establishes happens-before for any reader.

---

## Related Formalisms

### CCS (Milner, 1980)

A. J. R. G. Milner, *A Calculus of Communicating Systems*, Lecture Notes in Computer Science 92, Springer-Verlag, 1980.

A different process algebra, structurally similar to CSP. Synchronisation is on events rather than channels.

### π-calculus

Robin Milner, Joachim Parrow, David Walker, *A Calculus of Mobile Processes*, Information and Computation 100(1), 1992.

Extends CCS with channel mobility. The most flexible model in the family. Go's ability to send a channel through a channel matches this.

### Join calculus

Cédric Fournet and Georges Gonthier, *The Reflexive CHAM and the Join-Calculus*, POPL 1996.

Asynchronous, more elegant for asynchronous communication. Implemented in Polyphonic C# and JoCaml.

### Linear types and session types

A type system for concurrent communication, ensuring that channels are used according to a declared protocol. Implemented in research languages (Wadler's *Propositions as Sessions*) and proposed for Go and Rust.

---

## References

- C. A. R. Hoare, *Communicating Sequential Processes*, CACM 21(8), 1978.
- C. A. R. Hoare, *Communicating Sequential Processes*, Prentice-Hall, 1985. PDF: <http://www.usingcsp.com/cspbook.pdf>
- A. W. Roscoe, *The Theory and Practice of Concurrency*, Prentice-Hall, 1997.
- A. W. Roscoe, *Understanding Concurrent Systems*, Springer, 2010.
- Robin Milner, *A Calculus of Communicating Systems*, Springer, 1980.
- Robin Milner, Joachim Parrow, David Walker, *A Calculus of Mobile Processes*, Information and Computation, 1992.
- Cédric Fournet and Georges Gonthier, *The Reflexive CHAM and the Join-Calculus*, POPL 1996.
- The Go Programming Language Specification: <https://go.dev/ref/spec>
- The Go Memory Model: <https://go.dev/ref/mem>
- Rob Pike, *Concurrency is not Parallelism*: <https://go.dev/blog/waza-talk>
- Rob Pike, *Share Memory By Communicating*: <https://go.dev/blog/codelab-share>
- Sameer Ajmani, *Go Concurrency Patterns: Pipelines and cancellation*: <https://go.dev/blog/pipelines>
- FDR4 (refinement checker): <https://www.cs.ox.ac.uk/projects/fdr/>
- Katherine Cox-Buday, *Concurrency in Go*, O'Reilly, 2017.
