# Select Statement — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [Grammar](#grammar)
3. [Semantics](#semantics)
4. [Channel Operation Types](#channel-operation-types)
5. [Default Case](#default-case)
6. [Empty Select](#empty-select)
7. [Nil Channels in Select](#nil-channels-in-select)
8. [Closed Channels in Select](#closed-channels-in-select)
9. [Evaluation Order](#evaluation-order)
10. [Selection Algorithm](#selection-algorithm)
11. [Memory Model Implications](#memory-model-implications)
12. [Compiler Lowering](#compiler-lowering)
13. [Runtime Implementation Notes](#runtime-implementation-notes)
14. [Reflection Equivalent](#reflection-equivalent)
15. [Conformance Examples](#conformance-examples)
16. [References](#references)

---

## Introduction

This document is the formal reference for Go's `select` statement. It paraphrases and cross-references the Go Programming Language Specification, with additions covering the runtime contract, memory model implications, and the `reflect.Select` API. Quotations from the spec are marked; everything else is implementation detail or summary written for clarity.

---

## Grammar

From the Go specification (Go 1.22+, unchanged in essence since Go 1.0):

```
SelectStmt = "select" "{" { CommClause } "}" .
CommClause = CommCase ":" StatementList .
CommCase   = "case" ( SendStmt | RecvStmt ) | "default" .
RecvStmt   = [ ExpressionList "=" | IdentifierList ":=" ] RecvExpr .
RecvExpr   = Expression .
SendStmt   = Channel "<-" Expression .
Channel    = Expression .
```

A `select` statement consists of zero or more `CommClause`s. Each clause is either a `case` followed by a send statement or a receive expression, or `default`. At most one `default` clause may appear in a single `select`.

A `RecvExpr` must syntactically be a receive expression, that is, of the form `<-channelExpression`.

A `SendStmt` must syntactically be a send statement, of the form `channelExpression <- valueExpression`.

A `CommClause` is followed by a `StatementList`, which is the body executed when the clause is chosen.

---

## Semantics

The Go Programming Language Specification (excerpt, paraphrased and condensed):

> Execution of a "select" statement proceeds in several steps:
>
> 1. For all the cases in the statement, the channel operands of receive operations and the channel and right-hand-side expressions of send statements are evaluated exactly once, in source order, upon entering the "select" statement. The result is a set of channels to receive from or send to, and the corresponding values to send. Any side effects in that evaluation will occur irrespective of which (if any) communication operation is selected to proceed. Expressions on the left-hand side of a `RecvStmt` with a short variable declaration or assignment are not yet evaluated.
> 2. If one or more of the communications can proceed, a single one that can proceed is chosen via a uniform pseudo-random selection. Otherwise, if there is a default case, that case is chosen. If there is no default case, the "select" statement blocks until at least one of the communications can proceed.
> 3. Unless the selected case is the default case, the respective communication operation is executed.
> 4. If the selected case is a `RecvStmt` with a short variable declaration or an assignment, the left-hand side expressions are evaluated and the received value (or values) are assigned.
> 5. The statement list of the selected case is executed.

The key consequences of this:

- The right-hand side of a send case is evaluated up front, even if that case is not chosen.
- A receive case's left-hand side (the variable declaration or assignment target) is evaluated only if its case is chosen.
- "Uniform pseudo-random selection" is a defining feature, not an implementation accident.
- An empty `select` (`select {}`) has no clauses, so no case can ever proceed and no `default` exists; therefore it blocks forever.

---

## Channel Operation Types

A communication clause must specify exactly one channel operation:

| Form | Meaning | Ready when |
|------|---------|------------|
| `case <-ch:` | Receive, value discarded | Channel has a value, has a sender waiting, or is closed |
| `case v := <-ch:` | Receive, value captured | Same as above |
| `case v, ok := <-ch:` | Receive with closed-detection | Same as above; `ok=false` if closed and empty |
| `case ch <- v:` | Send | Buffer has space, or a receiver is waiting |
| `default:` | Default | Always considered "ready" (lowest priority) |

The channel expression and the value expression in a send case are evaluated exactly once when the `select` is entered, in source order across all cases.

---

## Default Case

A `default` clause is selected if and only if no other case can proceed at the moment the `select` statement is evaluated.

- A `select` may contain at most one `default` clause.
- A `select` containing only a `default` clause is equivalent to executing the body of that clause; the `select` machinery is not engaged.
- A `select` with a `default` never blocks.

This is the only mechanism in `select` to express "if nothing is ready, do something else."

---

## Empty Select

`select {}` is a valid `select` statement with zero communication clauses and no default. By the rules above:

- No case can proceed (there are none).
- There is no default.
- Therefore the statement blocks indefinitely.

This is sometimes called "select hang" and is the idiomatic Go way to keep a goroutine alive forever (typically `main` of a daemon whose work is done by other goroutines).

The Go runtime parks the goroutine on no channel and does not consume CPU.

---

## Nil Channels in Select

The specification says that "communication on a nil channel ... blocks forever" both for sends and receives. Inside a `select`, a case whose channel is nil is therefore never ready — it cannot fire.

This has a practical consequence: assigning `nil` to a channel variable used as a `select` case effectively disables that case for as long as the variable is nil. Restoring the original channel re-enables it. This is an officially supported pattern.

```go
var ch chan int = nil
select {
case <-ch: // never selected while ch is nil
case <-other:
}
```

A `select` containing only nil-channel cases and no default blocks forever.

---

## Closed Channels in Select

A closed channel:

- A receive on a closed channel always returns immediately with the zero value of the channel's element type, and `ok` is `false`.
- A send on a closed channel panics.

Inside a `select`:

- A receive case on a closed channel is **always ready** and will repeatedly fire if executed in a loop without breaking out.
- A send case on a closed channel, **if selected**, panics.

Selection itself is independent of whether sending would panic; the runtime considers the send case "ready" if either the channel has buffer space or has a waiting receiver. A closed channel has neither in the usual sense, but the runtime's check for whether the case can proceed will detect closedness and trigger a panic on commit.

---

## Evaluation Order

Within a single `select`:

1. **Channel expressions** in every clause are evaluated in source order.
2. **Value expressions** (right-hand side of send cases) are evaluated in source order, immediately after the channel expressions.
3. The receive-side variable declarations or assignments (`v := <-ch` or `v = <-ch`) are **not** evaluated unless the corresponding case is chosen.

This means a `case ch <- f():` will always invoke `f()`, even if some other case is chosen. Side effects in `f()` happen regardless. By contrast, `case v := <-ch: use(v)` does not call any function on `ch` beyond the receive itself, and `use(v)` runs only if this case wins.

---

## Selection Algorithm

The spec says "uniform pseudo-random." The runtime implementation is:

1. Compute the set of cases ready to proceed.
2. If the set is empty:
   - If `default` is present, choose `default`.
   - Otherwise block (see "Selection Algorithm — Blocking" below).
3. If the set has one element, choose it.
4. If the set has more than one, choose uniformly at random.

### Selection Algorithm — Blocking

When no case is ready and there is no default:

1. Acquire locks on every channel referenced by the cases, in canonical order (sorted by channel address).
2. Re-check readiness under the locks. If a case became ready, run it.
3. Otherwise enqueue a `sudog` (waiter) on every channel's wait queue.
4. Release the locks in reverse order.
5. Park the goroutine.
6. When woken (by some peer making a case ready), the runtime identifies which case fired, dequeues the goroutine's `sudog`s from the other channels, and returns control to the case body.

The two-pass random shuffle plus address-sorted locking ensure both fairness and freedom from internal deadlock between concurrent selects.

---

## Memory Model Implications

The Go memory model says: a send on a channel happens before the corresponding receive completes, and a close of a channel happens before a receive that returns zero because the channel is closed.

`select` does not weaken these guarantees. The case that runs establishes the happens-before edge for the data exchanged through that case. Cases that did not run establish no edges.

In particular:

- If your goroutine reads a shared variable after the receive case fires, and the variable was written by the sender before the send, that read is well-defined.
- If your goroutine reads a shared variable after the `default` case fires, no synchronisation has occurred, and the read may be a data race relative to any concurrent writer.

---

## Compiler Lowering

The Go compiler lowers `select` according to its shape:

| Shape | Lowering |
|-------|----------|
| `select {}` | Direct call to `runtime.block`. |
| Only `default` | Inline body of `default`. |
| One non-default case, no default | Direct call to the appropriate `chansend`/`chanrecv`. |
| One non-default case + default | Non-blocking variant: `selectnbsend` / `selectnbrecv`. |
| ≥2 non-default cases (with or without default) | Build `scase` array on the stack and call `runtime.selectgo`. |

The first four shapes do not invoke `selectgo` and have minimal overhead. Only the last shape pays the full `select` cost.

You can confirm by reading `go build -gcflags=-S` output; absence of `runtime.selectgo` confirms the optimised lowering applied.

---

## Runtime Implementation Notes

Source: `src/runtime/select.go` (and `chan.go`).

Key types and functions:

- **`scase`** — small struct with `c *hchan`, `elem unsafe.Pointer`, and (in older versions) a kind tag. The kind is now encoded by which array slot it occupies (sends and receives are split).
- **`selectgo(cas0, order0, ncases int, ...)`** — the entry point.
- **`pollorder`** — `uint16` array of indices, shuffled randomly.
- **`lockorder`** — `uint16` array sorted by channel address.

Algorithm sketch:

```
for i := 0; i < ncases; i++ {
    j := fastrandn(uint32(i+1))
    pollorder[i] = pollorder[j]
    pollorder[j] = uint16(i)
}
sort lockorder by channel address

walk pollorder; if any case is ready, jump to commit
acquire locks in lockorder
walk pollorder again; if ready, dequeue and commit
otherwise: enqueue sudog on every channel; release locks; park
on wakeup: identify firing case; dequeue from others; commit
```

The randomisation uses per-P `fastrand` state — no global lock.

---

## Reflection Equivalent

The `reflect` package exposes a dynamic select via `reflect.Select`:

```go
func Select(cases []SelectCase) (chosen int, recv Value, recvOK bool)

type SelectCase struct {
    Dir  SelectDir       // SelectSend, SelectRecv, SelectDefault
    Chan Value           // channel
    Send Value           // value to send (for SelectSend)
}
```

Semantics match the spec's `select`: uniform pseudo-random choice among ready cases; default chosen if no other is ready; blocks if no default and no other ready. The cost is significantly higher than a static `select` due to interface boxing and per-call slice allocation.

---

## Conformance Examples

### Empty select blocks

```go
package main

func main() {
    select {} // never returns
}
```

A conforming implementation must not return from `select{}`.

### Default with no other ready

```go
ch := make(chan int)
select {
case <-ch:
    panic("ch was empty; should not fire")
default:
    // must run
}
```

### Send-RHS evaluation always happens

```go
counter := 0
incr := func() int { counter++; return 0 }

ch1 := make(chan int, 1)
ch2 := make(chan int, 1)
ch1 <- 7

select {
case v := <-ch1:
    _ = v
case ch2 <- incr():
    _ = 0
}

// counter is 1 even though the send case did not run
```

### Random selection over many runs

```go
a := make(chan int, 1)
b := make(chan int, 1)
counts := map[int]int{}
for i := 0; i < 10000; i++ {
    a <- 1
    b <- 1
    select {
    case <-a:
        counts[0]++
    case <-b:
        counts[1]++
    }
}
// Expect both counts within ~10% of 5000
```

### Closed receive case fires immediately

```go
ch := make(chan int)
close(ch)
select {
case v, ok := <-ch:
    if ok {
        panic("expected closed")
    }
default:
    panic("closed receive case should have been ready")
}
```

### Send on closed panics

```go
ch := make(chan int, 1)
close(ch)
select {
case ch <- 1: // PANIC
default:
}
```

A conforming implementation panics here even though `default` is present, because the send case was selected before the runtime fully validated the closed state. (In practice the runtime checks closure as part of committing the send and panics on commit.)

### Nil channel case never fires

```go
var ch chan int
select {
case <-ch:
    panic("nil channel case should never fire")
case <-time.After(50 * time.Millisecond):
    // expected
}
```

---

## References

- The Go Programming Language Specification — *Select statements* (golang.org/ref/spec#Select_statements)
- The Go Memory Model (go.dev/ref/mem) — channel and close happens-before edges
- `src/runtime/select.go` — `selectgo` implementation
- `src/runtime/chan.go` — `hchan`, `sudog`, `chansend`, `chanrecv`, `closechan`
- `reflect` package documentation — `Select`, `SelectCase`, `SelectDir`
- *Go Concurrency Patterns* (Pike, Google IO 2012) — original motivation
- *Advanced Go Concurrency Patterns* (Cox, 2013) — fan-in, nil channels in select
