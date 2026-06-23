# Dataflow & Stream Programming — Junior Level

> **Roadmap:** [Programming Paradigms](../README.md) → Dataflow & Stream
> *Stop asking "what does the program do next?" Start asking "where does the data go next?" — that single flip is the whole paradigm.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — A Program as a Graph of Data](#core-concept-1--a-program-as-a-graph-of-data)
5. [Core Concept 2 — The Pipeline You Already Use](#core-concept-2--the-pipeline-you-already-use)
6. [Core Concept 3 — Data Arrival Triggers Work](#core-concept-3--data-arrival-triggers-work)
7. [Core Concept 4 — Streams Are Lazy: Generators](#core-concept-4--streams-are-lazy-generators)
8. [The Same Pipeline, Drawn as a Graph](#the-same-pipeline-drawn-as-a-graph)
9. [Real-World Examples](#real-world-examples)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What is it, and why does it matter?**

Open a terminal and type this:

```bash
cat access.log | grep "ERROR" | sort | uniq -c
```

You just wrote a dataflow program. Four small programs, each doing one job, connected by pipes. Data flows left to right: `cat` reads lines, `grep` keeps the error lines, `sort` orders them, `uniq -c` counts duplicates. Nobody wrote a loop. Nobody said "first call grep, then call sort." You described a *path the data takes*, and the shell ran each stage as data became available.

That is **dataflow programming**: you build your program as a **graph of operations connected by the flow of data between them**, instead of as a list of steps a single thread executes top to bottom. The boxes (`grep`, `sort`) are *nodes*; the pipes between them are *edges* that carry data. A node does its work whenever data shows up on its input — there is no master script telling it when its turn is.

> **The mindset shift:** in normal imperative code, *control* drives the program — you decide the order and call things one after another. In dataflow, *data* drives the program — a stage runs because data arrived for it, not because the previous line of code finished. Flip your attention from "what happens next" to "where does this data go next."

This is one of the oldest and most practical paradigms you'll meet. It powers Unix pipes, spreadsheets, build systems, audio/video processing, and the giant data pipelines (Kafka, Flink, Spark) that move the internet's data around. Learn to *see* the graph, and a huge amount of software stops looking mysterious.

---

## Prerequisites

- **Required:** You can read basic code in one language (variables, loops, functions). Examples use **shell**, **Python**, and a little **Go**.
- **Required:** You've used a terminal and at least seen a command with a `|` pipe in it.
- **Helpful:** You've written a `for` loop that reads items one at a time and transforms each.
- **Helpful:** You've used a spreadsheet formula like `=A1+B1`. (That's dataflow too — you'll see why.)
- **Not required:** Any concurrency, streaming-systems, or graph-theory background. This page builds the intuition from the pipe up.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Dataflow** | A style where the program is a **graph**: nodes are operations, edges carry data, and a node runs when its inputs are ready. |
| **Stream** | A sequence of data items that arrives over time, one after another, possibly never-ending. |
| **Node (operator)** | A single operation in the graph — it takes input data, produces output data. |
| **Edge (channel/pipe)** | A connection that carries data from one node's output to the next node's input. |
| **Pipeline** | A simple straight-line dataflow graph: `A → B → C`, each stage feeding the next. |
| **Stage** | One node in a pipeline. |
| **Producer / Consumer** | A node that *emits* data (producer) and a node that *receives* it (consumer). Many nodes are both. |
| **Lazy** | Work happens only when its output is actually needed/pulled, not eagerly up front. |
| **Generator / iterator** | A language feature that produces a stream of values one at a time, on demand. |
| **Fan-out / fan-in** | One stream split to many consumers (fan-out); many streams merged into one (fan-in). |

> The two words to lock in now are **node** (an operation) and **edge** (the data path between operations). A dataflow program *is* nothing but nodes wired together by edges.

---

## Core Concept 1 — A Program as a Graph of Data

In the code you've written so far, a program is a list of instructions. The CPU has a "next line to run" pointer, and it marches down the list, jumping around for loops and `if`s. *Control flow* — the order of execution — is the thing you design.

Dataflow throws that away. Here a program is a **directed graph**:

- **Nodes** are operations (filter, double, sum, write-to-file).
- **Edges** are the channels that carry data from one node to the next.
- A node **fires** (does its work) when the data it needs is available on its input edges. When it's done, it pushes results onto its output edges, which may wake up the next node.

There is no single "next line" pointer. There is no central script saying "now run node 3." Each node is a little machine that says: *"When data arrives on my input, I transform it and pass it on."* The shape of the graph — who is wired to whom — *is* the program.

```
   numbers ──►[ keep evens ]──►[ double ]──►[ sum ]──► result
```

Read that as: numbers flow in, the "keep evens" node passes only even ones forward, "double" multiplies each by two, "sum" adds them up. The arrows are not "function call order" — they are *where the data goes*. If you handed this graph to a runtime, it could even run the three nodes on three different CPU cores at once, each chewing on data as it arrives, because the only thing connecting them is the data on the edges.

> **Key insight:** in dataflow, you wire up *what depends on what*, and the flow of data decides the order of execution for you. You design the **graph**; the runtime handles the **scheduling**.

---

## Core Concept 2 — The Pipeline You Already Use

The simplest, most common dataflow graph is a straight line — a **pipeline**. And you've been using one since the day you opened a terminal:

```bash
# Count the 5 most common IP addresses hitting your server.
cat access.log | cut -d' ' -f1 | sort | uniq -c | sort -rn | head -5
```

Six nodes, five edges:

```
 cat ──► cut ──► sort ──► uniq -c ──► sort -rn ──► head -5
(read)  (field) (group)  (count)    (rank)       (top 5)
```

Each stage:
- reads a **stream** of lines from its input,
- transforms it (extracts a field, sorts, counts…),
- writes a **stream** of lines to its output.

Three things make this dataflow and not just "calling functions in order":

1. **Each stage is independent.** `cut` knows nothing about `sort`. It just reads lines and writes lines. You can drop any stage out, or insert a new one, without touching the others. The contract between stages is only *the stream of data*.
2. **Stages run concurrently.** The shell starts all six programs at once. `cat` doesn't finish the whole file before `cut` starts — `cut` processes line 1 while `cat` is still reading line 2. Data flows through like water through connected pipes.
3. **The shape is the program.** Rewiring the pipe (changing the order, adding a stage) changes what the program does. You program by *connecting boxes*, not by writing control flow.

This is the famous **Unix philosophy**: write small programs that do one thing, read a stream of text, write a stream of text, and *compose them with pipes*. It is dataflow programming, fifty years old and still everywhere.

---

## Core Concept 3 — Data Arrival Triggers Work

Here is the heart of the paradigm, and the part that feels strange at first. Compare:

```python
# IMPERATIVE — control flow drives it. I decide the order, line by line.
data = read_file()          # step 1
data = [x for x in data if x.ok]   # step 2 — runs because step 1 finished
data = [transform(x) for x in data]  # step 3 — runs because step 2 finished
save(data)                  # step 4
```

Each line runs because the *previous line finished* — control hands off down the page. The trigger for step 3 is "step 2 returned."

```
# DATAFLOW — data availability drives it.
[read] ──► [filter] ──► [transform] ──► [save]
```

In the dataflow version, the `filter` node runs **because a record showed up on its input edge** — not because some line above it returned. The instant `read` emits a record, `filter` can fire on it. The instant `filter` emits, `transform` can fire. Records trickle through the graph as they become available. The trigger is *data arrival*, not *statement order*.

A spreadsheet makes this crystal clear. Type into three cells:

```
A1 = 10
B1 = 20
C1 = A1 + B1     ← this cell is a node; A1 and B1 are its inputs
```

`C1` shows `30`. Now change `A1` to `100`. You did not re-run anything. You did not call a function. `C1` *automatically* becomes `120` — because `A1` changed, the data on `C1`'s input changed, so `C1` fired again. The spreadsheet is a dataflow graph: cells are nodes, formulas are edges, and **a cell recomputes when its inputs change**. That is data-driven execution, and you've been relying on it without naming it.

> **Why this matters:** because nodes only react to their own inputs, you can reason about each node *in isolation* ("given this input, I produce that output") and let the graph handle ordering and concurrency. That local reasoning is dataflow's superpower — and, later, its main difficulty when graphs get big.

---

## Core Concept 4 — Streams Are Lazy: Generators

A pipeline carries a **stream** — items arriving one at a time, not a whole list sitting in memory. That's how `cat huge.log | grep X` works on a 50 GB file without 50 GB of RAM: lines flow through one at a time.

In code, the tool for "produce values one at a time, on demand" is the **generator** (Python) or **iterator**. A generator is a function that *pauses* and *yields* each value, then resumes when the next value is pulled:

```python
def read_lines(path):
    with open(path) as f:
        for line in f:
            yield line.rstrip("\n")     # emit one line, then pause

def keep_errors(lines):
    for line in lines:
        if "ERROR" in line:
            yield line                  # pass error lines downstream

def take_message(lines):
    for line in lines:
        yield line.split("] ", 1)[-1]   # drop the timestamp prefix

# Wire the nodes into a pipeline — NOTHING has run yet.
pipeline = take_message(keep_errors(read_lines("app.log")))

# Data only flows when we PULL from the end:
for msg in pipeline:        # each `for` step pulls one item all the way through
    print(msg)
```

Read what just happened. `read_lines`, `keep_errors`, and `take_message` are three **nodes**. Composing them (`take_message(keep_errors(...))`) **wires the graph** — but no file is read yet. Only when the final `for` loop **pulls** a value does the request travel back up the pipe: `take_message` asks `keep_errors` for a line, which asks `read_lines` for a line, which reads exactly one line from disk. One item flows all the way through, gets printed, and then the next pull happens.

This is **lazy, pull-based dataflow**:

- **Lazy** — no work happens until output is demanded. Build a pipeline over a billion-line file; if you only `take(5)`, only ~5 lines are ever read.
- **Streaming** — one item at a time, so memory stays flat no matter how big the input.
- **Composable** — each node is a tiny generator; you snap them together like Lego.

Generators are how you build Unix-style pipelines *inside* a program. Every modern language has them: Python's `yield`, JavaScript's `function*`, Java's `Stream`, Go's channels (next section). They are your everyday gateway into the dataflow paradigm.

---

## The Same Pipeline, Drawn as a Graph

Most real dataflow programs aren't a single straight line — they **branch and merge**. Drawing the graph is the clearest way to understand them. Here's an order-processing flow as a **flow-based-programming (FBP) graph**:

```
                         ┌──────────────┐
   raw orders  ─────────►│  parse JSON  │
                         └──────┬───────┘
                                │ orders
                                ▼
                         ┌──────────────┐
                         │   validate   │
                         └──┬────────┬──┘
                  valid ✓   │        │   invalid ✗
                            ▼        ▼
                  ┌──────────────┐  ┌──────────────┐
                  │ enrich w/ DB │  │  log + drop  │
                  └──────┬───────┘  └──────────────┘
                         │ enriched
                         ▼
                  ┌──────────────┐
                  │ write to DB  │
                  └──────────────┘
```

Trace the data, not the code:

- A raw order arrives → flows into **parse JSON** → out comes a structured order.
- It flows into **validate**, which has *two* output edges: valid orders go one way, invalid ones go another. This is a **branch** (fan-out).
- Valid orders flow to **enrich w/ DB** then **write to DB**. Invalid ones flow to **log + drop**.

Notice there's no `if/else` written as control flow — the *graph itself* encodes the routing. The `validate` node simply emits each order onto the correct output edge, and the data flows where the wires lead. To change the behavior, you **rewire the graph**: insert a "deduplicate" node on the valid path, or add a second writer, and nothing else changes. This is **Flow-Based Programming** — you build software by drawing and connecting boxes, and tools like NoFlo even let you do it visually. The picture *is* the program.

---

## Real-World Examples

| Thing you've used | The dataflow in it |
|---|---|
| Unix pipe `a \| b \| c` | The canonical pipeline — stages connected by streams of bytes/lines. |
| A spreadsheet | Cells are nodes; formulas are edges; a cell recomputes when inputs change. |
| `make` / build systems | Files are nodes, dependencies are edges; rebuild a node when its inputs change. |
| A music/video editor's effect chain | Audio samples flow through filters: gain → reverb → compressor → output. |
| A CI/CD pipeline | Build → test → package → deploy, each stage feeding artifacts to the next. |
| Spark / Flink / Kafka pipelines | Big-data dataflow at scale — billions of records flowing through operator graphs. |
| TensorFlow / PyTorch model | A *computation graph* — tensors flow through math operations. |
| React's "UI = f(state)" | Data (state) flows down through components to produce the rendered output. |

You're surrounded by dataflow. This page just gives you the lens to *name* it.

---

## Mental Models

- **Water through pipes.** Nodes are machines on a factory floor; edges are pipes carrying material between them. Pour data in one end; each machine processes whatever flows to it and pushes the result down its output pipe. Nobody shouts "now machine 3's turn" — material arriving *is* the signal.
- **The assembly line.** Each worker (node) does one job on each item passing by, then hands it to the next worker. Items flow down the belt; workers operate in parallel on different items at the same time. That parallelism comes for free from the shape.
- **The spreadsheet.** The friendliest dataflow engine on Earth. Cells with formulas recompute automatically when their inputs change. If you understand why `C1` updates when `A1` changes, you understand data-driven execution.
- **Plumbing vs script.** Imperative programming is a *script* an actor reads top to bottom. Dataflow is *plumbing* — you lay the pipes, then let the water find its way. You design the layout, not the sequence.

---

## Common Mistakes

- **Reading the graph as call order.** The arrows mean "data goes here next," *not* "this function is called, then that one." All nodes can be live at once, processing different items. Don't mentally single-step it like a `for` loop.
- **Thinking the whole list flows at once.** In a streaming pipeline, items flow through **one at a time**. `cat big | grep X` doesn't load the file — it streams lines. Expecting a giant in-memory list defeats the point.
- **Forgetting laziness means "nothing ran yet."** Building a generator pipeline does *no work*. If you never pull from the end, your filter and transform never execute. Beginners are surprised when a `map`/generator "didn't run" — it's waiting to be consumed.
- **Putting side effects inside a lazy stage.** If a node prints or writes to a DB but lives in a lazy pipeline that's never fully consumed, the side effect silently doesn't happen (or happens at a surprising time). Keep side effects at the *consuming* end.
- **Making one node do five jobs.** The power of dataflow is small, single-purpose nodes you can rewire. A node that parses *and* validates *and* enriches *and* saves is just imperative code wearing a costume — you lose the composability.
- **Confusing dataflow with "just concurrency."** Concurrency is a *benefit* dataflow enables (independent nodes can run in parallel), not its definition. The definition is *data-dependency-driven execution* — that's true even single-threaded.

---

## Test Yourself

1. In your own words: in dataflow, what causes a node to run? (Contrast with what causes a line of imperative code to run.)
2. In `cat f | grep X | sort`, name the nodes and the edges. What flows along the edges?
3. Why doesn't `cat huge.log | grep ERROR` load the whole file into memory?
4. A Python generator pipeline is built but never iterated. How much work runs? Why?
5. Explain why a spreadsheet is a dataflow program. What are the nodes and edges?
6. In the order-processing graph above, the `validate` node has two output edges. What paradigm idea does that replace, that you'd normally write as control flow?

> Try each before reading on. If #1 or #5 is fuzzy, re-read [Data Arrival Triggers Work](#core-concept-3--data-arrival-triggers-work).

---

## Cheat Sheet

```
DATAFLOW = program as a GRAPH of data dependencies.
  nodes  = operations          edges = data channels (pipes/streams)
  a node FIRES when its inputs are available — DATA drives execution,
  not statement order.

PIPELINE = the simplest graph: a straight line  A ──► B ──► C
  Unix:  cat | grep | sort | uniq -c     ← you've used this forever

CONTROL FLOW vs DATAFLOW
  imperative: line runs because the PREVIOUS LINE finished  (control drives)
  dataflow:   node runs because DATA ARRIVED on its input   (data drives)
  spreadsheet: C1 recomputes when A1 changes  ← data-driven, no loop written

STREAMS ARE LAZY (generators / iterators)
  build pipeline  → nothing runs yet
  pull from end   → ONE item flows all the way through, on demand
  benefit: flat memory on huge/infinite inputs; only compute what you use

GRAPHS BRANCH (fan-out) and MERGE (fan-in)
  the WIRING encodes routing — rewire the graph, not the code

KEEP NODES SMALL & SINGLE-PURPOSE  → composable, parallelizable
```

---

## Summary

**Dataflow programming** models a program as a **directed graph**: nodes are operations, edges carry data between them, and a node runs **when data arrives on its inputs** — not when the previous line of code finishes. This is the opposite trigger from imperative code: *data* drives execution, not *control*. You've used it for years without naming it: Unix pipes (`cat | grep | sort`), spreadsheets (cells recompute when inputs change), build systems, and media effect chains are all dataflow. The simplest graph is a **pipeline** — a straight line of stages each transforming a **stream** of items flowing through one at a time, which is why pipes handle giant files on tiny memory. **Generators/iterators** are how you build these pipelines in code: lazy, pull-based, composable nodes. Real graphs **branch and merge**, encoding routing in their wiring instead of in `if/else` control flow. The skill you're building is to *see the graph*: ask "where does this data go next?" and a huge swath of software — from your terminal to Spark — suddenly makes sense.

---

## Further Reading

- *The Art of Unix Programming* by Eric S. Raymond — the philosophy of pipes and composable, stream-processing tools; the original dataflow culture.
- *Flow-Based Programming* by J. Paul Morrison — the book that named FBP; software as a network of black-box processes exchanging data.
- The Python docs on **generators and `yield`** — your hands-on gateway to building lazy streaming pipelines.
- Try it: open a terminal and build a six-stage pipe to find your most-used shell commands: `history | awk '{print $2}' | sort | uniq -c | sort -rn | head`.

---

## Related Topics

- [`middle.md`](middle.md) — the execution model: push vs pull, backpressure, bounded buffers, Go-channel pipelines, fan-out/fan-in.
- [`senior.md`](senior.md) — trade-offs: free parallelism vs hard global reasoning, deadlocks, determinism, and when dataflow wins.
- [`professional.md`](professional.md) — stream-processing systems (Flink, Kafka Streams, Beam), windowing, event-time, and computation graphs.
- [05 — Reactive Programming](../05-reactive-programming/) — values that change over time; the close cousin of dataflow.
- [07 — Actor Model & CSP](../07-actor-model-and-csp/) — the message-passing concurrency that Go channels come from.
- [Laziness & Streams](../../code-craft/functional-programming/12-laziness-and-streams/junior.md) — lazy evaluation and streams in depth.
- [01 — Overview & Taxonomy](../01-overview-and-taxonomy/) — where dataflow sits on the paradigm map.
