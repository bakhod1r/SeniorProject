# Dataflow & Stream Programming — Middle Level

> **Roadmap:** [Programming Paradigms](../README.md) → Dataflow & Stream
> *The graph is easy to draw. The hard questions are: who pulls whom, what happens when a fast node feeds a slow one, and how big are the pipes between them?*

---

## Table of Contents

1. [Introduction](#introduction)
2. [The Execution Model: Firing Rules](#the-execution-model-firing-rules)
3. [Push vs Pull Pipelines](#push-vs-pull-pipelines)
4. [Lazy vs Eager Streams](#lazy-vs-eager-streams)
5. [Backpressure and Bounded Buffers](#backpressure-and-bounded-buffers)
6. [Building a Pipeline with Go Channels](#building-a-pipeline-with-go-channels)
7. [Fan-Out / Fan-In](#fan-out--fan-in)
8. [Static vs Dynamic Dataflow (SDF)](#static-vs-dynamic-dataflow-sdf)
9. [Relation to Spreadsheets and Reactive](#relation-to-spreadsheets-and-reactive)
10. [Common Mistakes](#common-mistakes)
11. [Summary](#summary)
12. [Further Reading](#further-reading)
13. [Related Topics](#related-topics)

---

## Introduction

> Focus: **How does it actually work, and what are the moving parts?**

At the junior level a pipeline is "boxes connected by pipes." That intuition is correct but it hides every interesting engineering decision. The moment you build a real one, questions appear that the picture doesn't answer:

- A node fires "when its inputs are available" — but *who decides* it's time? Does the producer push, or does the consumer pull?
- A node that doubles numbers is instant; the node downstream writes each to a slow database. The fast node will bury the slow one. What stops it?
- The pipes between nodes — are they infinite? If not, how big, and what happens when one fills up?

This page answers those. We'll nail the **firing rule** (what makes a node run), the **push vs pull** axis (the direction of control), **backpressure** (how a slow consumer throttles a fast producer), and **bounded buffers** (why the pipe size is one of your most important tuning knobs). Then we'll build a concrete concurrent pipeline with **Go channels**, add **fan-out/fan-in**, and finish with the classification (**static vs dynamic** dataflow) that decides how analyzable your graph is.

> **The mindset shift from junior:** a dataflow graph isn't just a shape — it's a *system of producers and consumers running at different speeds, connected by buffers of finite size*. Engineering dataflow is mostly about matching those speeds without deadlocking, starving, or blowing up memory.

---

## The Execution Model: Firing Rules

The defining rule of dataflow: **a node fires when its firing condition is met — typically, when a value is present on each of its required input edges.** When it fires, it consumes those inputs, computes, and produces values on its output edges. No central program counter; the *availability of data* is the schedule.

Make the rule precise with a tiny adder node:

```
   a ──►┐
        ├──►[ + ]──► sum
   b ──►┘
```

The `+` node's firing rule: *"fire when there is a token on edge `a` AND a token on edge `b`."* It then consumes one from each and emits one `sum`. If only `a` has a value, it waits. This is the **token** model: data items ("tokens") sit on edges; a node fires when its input edges hold enough tokens, consuming and producing them per its rules.

Three consequences fall out immediately:

1. **Order is derived, not declared.** You never wrote "run the adder now." It ran because both inputs arrived. The runtime schedules based on data availability — possibly running independent nodes simultaneously.
2. **A node is a pure-ish local function.** It looks only at its inputs and produces outputs. This locality is what lets the runtime reorder, parallelize, and distribute nodes freely.
3. **Cycles are dangerous.** If node A's input needs node B's output and vice versa with no initial token to break the tie, neither can fire. Hold that thought — it's the deadlock you'll meet in the senior page.

Different firing rules give different flavors: an **adder** needs one token on every input; a **merge** node fires when *any* input has a token (nondeterministic — whichever arrives first); a **select/switch** routes based on a control token. The firing rule is the personality of the node.

---

## Push vs Pull Pipelines

"Data flows from A to B" leaves out the crucial question: **who initiates the transfer?** There are two answers, and every dataflow system picks one (or both).

**Pull (demand-driven / lazy).** The *consumer* drives. The end of the pipeline asks for a value, which propagates the request backward: each node, when asked, asks *its* upstream for what it needs. Python generators are pull-based — nothing happens until the final `for` loop pulls. Iterators, Java `Stream`, and database cursors are pull.

```
[source] ◄──ask── [filter] ◄──ask── [map] ◄──ask── consumer
       ──value──►        ──value──►       ──value──►
```

**Push (data-driven / eager-ish).** The *producer* drives. A source emits a value and hands it forward; each node, on receiving input, processes it and hands the result downstream. Unix pipes are push-ish (a producer writes, the OS buffers); reactive `Observable`s, Kafka consumers, and event streams are push. The classic Reactive `onNext(value)` call *is* a push.

```
[source] ──push──► [filter] ──push──► [map] ──push──► consumer
```

The difference is **who controls the rate**:

| | Pull (demand-driven) | Push (data-driven) |
|---|---|---|
| Driver | Consumer asks | Producer emits |
| Natural for | Finite/bounded data, one consumer, laziness | Live/unbounded events, multiple consumers, fan-out |
| Rate control | Automatic — producer can't outrun a slow consumer (it's only asked for what's needed) | **Problematic** — a fast producer can overwhelm a slow consumer ⇒ needs *backpressure* |
| Examples | Generators, iterators, Java Stream, SQL cursors | Rx Observables, Kafka, SSE/WebSocket feeds, Unix pipe (OS-buffered) |

The headline insight: **pull pipelines get backpressure for free** — a slow consumer simply pulls slowly, so the producer naturally idles. **Push pipelines do not** — a producer that emits faster than the consumer can handle will pile up data unless you *add* a backpressure mechanism. That's the next section, and it's the single most common source of real-world dataflow bugs.

---

## Lazy vs Eager Streams

A closely related axis: **does a stage do its work up front (eager) or only when its result is demanded (lazy)?**

```python
# EAGER — each stage fully materializes a list before the next starts.
data    = read_all(path)                  # whole file in memory
errors  = [l for l in data if "ERR" in l] # whole filtered list in memory
msgs    = [parse(l) for l in errors]      # whole parsed list in memory
top5    = msgs[:5]                         # we needed... 5. We built all of them.
```

```python
# LAZY — a generator pipeline; work flows item-by-item, on demand.
data   = read_lines(path)                 # generator — nothing read yet
errors = (l for l in data if "ERR" in l)  # generator
msgs   = (parse(l) for l in errors)       # generator
top5   = list(itertools.islice(msgs, 5))  # pulls exactly 5 items through the whole chain
```

The eager version reads the entire file, filters everything, parses everything — then throws almost all of it away to keep 5. The lazy version pulls exactly 5 items end-to-end: it reads roughly as many lines as needed to find 5 errors, parses 5, and stops. Same result; wildly different cost.

Laziness buys you three things that matter in dataflow:

- **Flat memory.** No stage holds the whole dataset — one item flows through at a time. This is what makes infinite/unbounded streams possible at all.
- **Short-circuiting.** Downstream demand (`take(5)`, `findFirst`) can stop upstream work early. Eager stages can't — they're already done.
- **Fusion potential.** A lazy chain can sometimes be *fused* by the runtime into a single pass, avoiding intermediate collections (Java Streams, Rust iterators do this).

The cost of laziness: **side effects become deferred and order-sensitive** (a lazy `map` with a `print` won't run until consumed), and stack traces through chained generators are harder to read. Eager is simpler to reason about and debug; lazy is essential for large or infinite streams. Most real systems mix them — lazy through the transform stages, eager at a deliberate "collect here" boundary.

> See [Laziness & Streams](../../code-craft/functional-programming/12-laziness-and-streams/middle.md) for the FP treatment of exactly this trade-off.

---

## Backpressure and Bounded Buffers

This is the concept that separates people who've *drawn* pipelines from people who've *run* them in production.

**The problem.** In a push pipeline, suppose `produce` emits 1,000,000 records/sec and `writeToDB` handles 1,000/sec. Where do the other 999,000 records/sec go? If the pipe between them is an **unbounded buffer**, they accumulate — memory grows until the process OOM-crashes. The fast producer is starving the system by running too well.

**The fix: backpressure.** Backpressure is the mechanism by which a slow consumer signals upstream *"slow down, I'm full."* The producer then blocks or slows until the consumer catches up. The system's throughput settles at the rate of its **slowest stage** — which is exactly correct: you cannot durably go faster than your slowest component, and pretending otherwise just buffers the difference until you run out of memory.

**Bounded buffers** are how backpressure is usually implemented. Instead of an infinite pipe, each edge is a queue of fixed capacity (say, 100 items):

- Producer tries to put an item → if the buffer is **full**, the `put` *blocks* until the consumer takes one. That blocking *is* the backpressure signal, propagated automatically.
- Consumer tries to take an item → if the buffer is **empty**, the `take` *blocks* until the producer adds one (this prevents busy-waiting and starvation).

```
producer ──►[ buffer: ▓▓▓▓░░░░ cap=8 ]──► consumer
              full?  → producer blocks (backpressure)
              empty? → consumer blocks (wait for data)
```

The buffer size is a **latency vs throughput knob**:

- **Small buffer** (even 0 — unbuffered/synchronous): tight coupling, low memory, low latency, but stages stall on each other often — less slack to absorb bursts.
- **Large buffer**: absorbs bursts (a sudden spike doesn't stall the producer), better average throughput, *but* more memory and **more latency** (an item can sit in a long queue before being processed), and it *hides* a chronically slow consumer until the buffer finally fills.

Backpressure is built into pull systems for free (you only get asked for what you can handle) and must be *engineered* into push systems. Reactive Streams (the JVM spec behind RxJava/Project Reactor) exists almost entirely to add demand-based backpressure to a push model — the consumer calls `request(n)` to say "I can take n more." Kafka does it with consumer pull + offsets. TCP does it with its receive window. The pattern is everywhere because the problem is universal.

---

## Building a Pipeline with Go Channels

Go is one of the cleanest languages for hand-building dataflow, because channels *are* bounded buffers with built-in backpressure, and goroutines *are* concurrent nodes. A channel of capacity *N* is exactly the bounded buffer from above; sending on a full channel blocks (backpressure), receiving from an empty one blocks (wait).

A pipeline stage is: a goroutine that reads from an input channel, transforms, and writes to an output channel.

```go
// Node 1 — SOURCE: emit ints, then close the channel to signal "done".
func generate(nums ...int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)               // closing signals end-of-stream downstream
        for _, n := range nums {
            out <- n                    // blocks if the consumer is slow → backpressure
        }
    }()
    return out
}

// Node 2 — TRANSFORM: read in, square, write out.
func square(in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for n := range in {            // `range` ends when `in` is closed
            out <- n * n
        }
    }()
    return out
}

// Node 3 — SINK: read to exhaustion.
func main() {
    for r := range square(generate(1, 2, 3, 4)) {  // wire: generate ──► square ──► main
        fmt.Println(r)                              // 1 4 9 16
    }
}
```

Read the dataflow properties straight off the code:

- **Channels are the edges.** Each `<-chan int` is a typed pipe. The graph is `generate ──► square ──► main`.
- **Goroutines are the nodes**, each running concurrently. `generate` can be producing `3` while `square` is squaring `2` and `main` is printing `1`. That parallelism is free from the structure.
- **`close(out)` is the end-of-stream token.** A `for range` over a channel loops until the channel is closed — that's how "the stream ended" flows downstream.
- **Backpressure is automatic.** Use `make(chan int, 100)` for a buffered (looser-coupled) edge or `make(chan int)` for an unbuffered (lock-step) one. Either way, a full channel blocks the sender — the bounded-buffer behavior, for free.

This is **Communicating Sequential Processes (CSP)** wearing a dataflow hat: independent processes connected by channels. (More on CSP in [07 — Actor Model & CSP](../07-actor-model-and-csp/).) The relevant point here is that Go gives you correct backpressure and concurrent nodes with almost no ceremony — building the *same* pipeline safely in a thread+queue language takes far more code.

---

## Fan-Out / Fan-In

Straight-line pipelines are limited by their slowest stage. If `square` were expensive, the whole pipeline crawls at one core's speed. **Fan-out / fan-in** is the dataflow pattern for parallelizing a single stage across workers.

- **Fan-out**: one input stream feeds *N* identical worker nodes (split the work).
- **Fan-in**: the *N* workers' outputs merge back into one stream (collect the results).

```
                      ┌──► [ worker 1 ] ──┐
   source ──► (split) ┼──► [ worker 2 ] ──┼──► (merge) ──► sink
                      └──► [ worker 3 ] ──┘
        fan-out (one→many)            fan-in (many→one)
```

In Go, fan-out is just starting several goroutines that read the *same* input channel; Go's runtime hands each value to whichever worker is free, automatically load-balancing:

```go
// FAN-OUT: 3 workers all read `in`; the runtime distributes values among them.
in := generate(/* lots of work items */)
c1, c2, c3 := square(in), square(in), square(in)   // 3 concurrent workers on one input

// FAN-IN: merge the 3 result streams into one.
func merge(cs ...<-chan int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    for _, c := range cs {
        wg.Add(1)
        go func(c <-chan int) {        // one forwarder goroutine per input
            defer wg.Done()
            for v := range c { out <- v }
        }(c)
    }
    go func() { wg.Wait(); close(out) }()  // close `out` only after ALL inputs drain
    return out
}

for r := range merge(c1, c2, c3) { use(r) }
```

Two things to internalize:

1. **Fan-out gives you parallelism without changing the node's logic.** `square` didn't change; you just ran three copies. This is dataflow's headline win: parallelism is a *wiring* decision, not a rewrite.
2. **Fan-in is usually nondeterministic in order.** `merge` emits values in whatever order the workers finish, which depends on timing. If you need the *original order* preserved, you must tag items with sequence numbers and reorder — order is *not* free across a parallel fan-out. (This is the determinism question the senior page tackles via Kahn Process Networks.)

---

## Static vs Dynamic Dataflow (SDF)

Not all dataflow graphs are equally analyzable. The key classification — from the signal-processing world, where dataflow has been formalized for decades — is by **how predictable the data rates are**.

**Synchronous Dataflow (SDF).** Every node consumes and produces a *fixed, known* number of tokens per firing. A node might consume 2 inputs and produce 1 output, *always*. Because the rates are constant and known at compile time, the runtime can:

- compute a **static schedule** ahead of time (the exact firing order),
- size every buffer *exactly* so it never overflows or underflows,
- guarantee no deadlock and bounded memory — all *before running*.

SDF is the bedrock of DSP toolchains (audio/video filter graphs, software-defined radio, LabVIEW): predictable, hard-real-time, provably bounded. The price is rigidity — you can't have data-dependent routing.

**Dynamic dataflow.** Token rates depend on the *data*. A `filter` node consumes 1 input but produces 0 *or* 1 outputs depending on a predicate; a `switch` routes a token down one of two edges based on its value. Now the schedule can't be precomputed — it depends on runtime values. Dynamic dataflow is far more expressive (it's Turing-complete; SDF with only fixed rates is not), but you lose the static guarantees: buffer sizes and deadlock-freedom can no longer be proven in general.

| | Synchronous (SDF) | Dynamic |
|---|---|---|
| Token rates | Fixed, known ahead of time | Data-dependent |
| Scheduling | Static, computed once | Runtime, demand/availability-driven |
| Buffer sizing | Provably bounded | May be unbounded in general |
| Expressiveness | No data-dependent control | Full (conditionals, loops) |
| Used in | DSP, hard real-time, LabVIEW | Spark/Flink, general stream processors |

Most general-purpose stream systems (Flink, Spark, Kafka Streams) are dynamic — they need data-dependent routing and filtering. The trade-off you're seeing is the recurring one: **constrain the model (SDF) to get strong guarantees, or generalize it (dynamic) to get expressiveness and lose the proofs.**

---

## Relation to Spreadsheets and Reactive

Dataflow has two close cousins worth placing precisely, because interviewers and codebases blur them.

**Spreadsheets are the purest mainstream dataflow.** Cells are nodes; formulas declare the edges (`C1 = A1 + B1` makes `A1`,`B1 → C1`). The engine maintains a **dependency graph**, topologically sorts it, and on any change recomputes exactly the downstream cells that depend on the changed cell — no more. It's pull-ish (recompute on demand) with push-like change propagation, and it's *declarative*: you state the relationships, the engine schedules. If you've ever wondered why a spreadsheet feels effortless, it's because it's a tuned dataflow runtime you never have to configure.

**Reactive programming is dataflow over *time-varying* values.** A reactive `Observable`/signal is a node whose value changes as new events push through. `total = price.map(p => p * qty)` wires a dataflow edge; when `price` emits a new value, `total` recomputes and pushes downstream — exactly the spreadsheet's "recompute on input change," generalized to event streams. The overlap is huge; the usual distinction:

- **Dataflow (this topic)** emphasizes the *graph of operators and the data moving through it* — often for throughput/transformation (ETL, media, big-data pipelines). The data is the focus.
- **Reactive ([05](../05-reactive-programming/))** emphasizes *values that change over time and propagation of those changes* — often for UIs and event handling. The change-over-time is the focus.

They're the same core idea (data-dependency-driven computation) viewed through different lenses, which is why RxJava, Flink, and a spreadsheet all feel related. Backpressure is the shared hard problem all three must solve once data *pushes*.

---

## Common Mistakes

- **Using unbounded buffers/queues "to be safe."** An unbounded queue doesn't prevent overload — it *delays* the crash and converts it into an OOM under load. Bound your buffers; let backpressure do its job.
- **Assuming push pipelines have backpressure.** They don't, by default. If you `Observable.fromIterable(hugeSource)` into a slow subscriber without a backpressure strategy, you'll buffer or drop. Pull pipelines get it free; push pipelines must add it.
- **Forgetting to close/signal end-of-stream.** In Go, a consumer `range`-ing a channel that's never closed blocks forever; a fan-in that closes `out` before all inputs drain loses data or panics. End-of-stream is a real token you must propagate.
- **Expecting order across a fan-out.** Parallel workers finish out of order; fan-in interleaves nondeterministically. If you need ordering, carry sequence numbers and reorder — don't assume.
- **Sizing buffers by feel.** Buffer size trades latency for throughput and *hides* slow consumers. Pick it from the burst size and latency budget, then measure; a buffer that's "big enough to never block" is usually a memory leak waiting for load.
- **Cyclic dependencies with no initial token.** A feedback edge where A needs B and B needs A, with nothing to break the cycle, deadlocks — no node can fire first. (Senior page: how Kahn networks and initial tokens handle legitimate cycles.)

---

## Summary

A dataflow node's **firing rule** — usually "a token on each required input" — replaces the program counter: *data availability* schedules execution, and that locality is what enables free parallelism. The first big axis is **push vs pull**: pull (generators, iterators) is consumer-driven and gets **backpressure for free**; push (Rx, Kafka, events) is producer-driven and must *engineer* backpressure or risk unbounded buffering and OOM. **Lazy** streams flow one item at a time on demand (flat memory, short-circuiting, fusion) versus **eager** stages that materialize each step. **Backpressure** — a slow consumer signaling "slow down" upstream — is normally implemented with **bounded buffers**, whose size is a latency-vs-throughput knob that also determines how much burst you can absorb. **Go channels** give you concurrent nodes and correct backpressure almost for free; **fan-out/fan-in** parallelizes a stage by wiring (not rewriting) it, at the cost of losing order. Finally, **synchronous dataflow (SDF)** with fixed token rates buys static schedules and provably-bounded buffers, while **dynamic** dataflow trades those proofs for data-dependent expressiveness — the constrain-for-guarantees vs generalize-for-power trade-off that recurs through the whole paradigm. Spreadsheets and reactive programming are the same core idea seen from different angles.

---

## Further Reading

- *Concurrency in Go* by Katherine Cox-Buday — the canonical treatment of channel pipelines, fan-out/fan-in, and the `done`-channel cancellation idiom used above.
- The Go blog, **"Go Concurrency Patterns: Pipelines and cancellation"** — the source material for safe stage construction and end-of-stream handling.
- *Reactive Streams* specification (reactive-streams.org) — how demand-based backpressure (`request(n)`) is added to a push model.
- Lee & Messerschmitt, *Synchronous Data Flow* (1987) — the foundational paper on SDF, static scheduling, and bounded buffers.

---

## Related Topics

- [`junior.md`](junior.md) — the pipeline intuition, the graph model, generators, and data-driven execution.
- [`senior.md`](senior.md) — trade-offs, deadlocks, determinism (Kahn Process Networks), debugging graphs, and when dataflow wins.
- [`professional.md`](professional.md) — Flink/Kafka Streams/Beam, windowing, event-time, exactly-once, and computation graphs.
- [05 — Reactive Programming](../05-reactive-programming/) — dataflow over time-varying values; backpressure in Rx.
- [07 — Actor Model & CSP](../07-actor-model-and-csp/) — the CSP model behind Go channels.
- [Laziness & Streams](../../code-craft/functional-programming/12-laziness-and-streams/middle.md) — lazy vs eager pipelines and fusion, from the FP side.
- [System Design → Data Streaming](../../../Architecture/system-design/15-data-streaming/) — these pipelines at distributed scale.
