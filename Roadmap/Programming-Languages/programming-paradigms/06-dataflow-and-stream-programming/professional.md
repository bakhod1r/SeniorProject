# Dataflow & Stream Programming — Professional Level

> **Roadmap:** [Programming Paradigms](../README.md) → Dataflow & Stream
> *At scale, the dataflow graph stops being a metaphor and becomes the deployment topology: each operator is a fleet of tasks on a cluster, each edge is a network shuffle, and the paradigm's old questions — ordering, determinism, backpressure — return wearing the names windowing, event-time, and exactly-once.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [The Beam/Dataflow Model: One Model, Many Runners](#the-beamdataflow-model-one-model-many-runners)
3. [Event-Time vs Processing-Time](#event-time-vs-processing-time)
4. [Windowing](#windowing)
5. [Watermarks, Lateness, and Triggers](#watermarks-lateness-and-triggers)
6. [Stateful Operators and Keyed State](#stateful-operators-and-keyed-state)
7. [Delivery Guarantees: Exactly-Once](#delivery-guarantees-exactly-once)
8. [The Graph as Deployment Topology](#the-graph-as-deployment-topology)
9. [Flow-Based Programming and Visual Dataflow](#flow-based-programming-and-visual-dataflow)
10. [Computation Graphs: TensorFlow / PyTorch](#computation-graphs-tensorflow--pytorch)
11. [Unix Philosophy at Scale](#unix-philosophy-at-scale)
12. [Common Mistakes](#common-mistakes)
13. [Summary](#summary)
14. [Further Reading](#further-reading)
15. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Dataflow as the foundation of production stream-processing and ML systems.**

Everything earlier was the paradigm in the small — a pipe, a generator, a channel graph on one machine. This page is the paradigm in the large, where it underpins the systems that process the world's event streams: **Apache Flink**, **Kafka Streams**, **Apache Beam** (and its Google Cloud Dataflow runner), and the **computation graphs** inside TensorFlow and PyTorch.

The remarkable thing is that *nothing conceptual changes*. A Flink job is still a directed graph of operators; tokens still flow along edges; nodes still fire on data; backpressure still throttles fast producers. What changes is that the graph is now **distributed and fault-tolerant**, which forces three questions the single-machine model could ignore:

1. **Time.** When events arrive out of order across a network, what does "the count over the last minute" even mean — the minute by the clock, or the minute the events *happened*?
2. **State.** An operator that aggregates must hold state across events; when it runs on 200 machines and one crashes, what happens to that state?
3. **Correctness under failure.** If a machine dies mid-stream and we replay, does each event get counted once, twice, or zero times?

The answers — **event-time + watermarks + windowing**, **keyed state + checkpointing**, and **exactly-once via checkpoint barriers** — are the professional vocabulary of dataflow. They're not new paradigm ideas; they're the old dataflow questions (ordering, determinism, backpressure) answered at distributed scale.

> **The professional mindset:** the dataflow graph is your *deployment artifact*. You reason about parallelism, state placement, network shuffles, failure recovery, and SLOs by reading the operator graph — the same way the junior page read a Unix pipe. The graph went from a teaching diagram to the thing you operate.

---

## The Beam/Dataflow Model: One Model, Many Runners

Apache Beam crystallized the modern model (from Google's *Dataflow* paper and its FlumeJava/MillWheel lineage) into four questions every streaming computation answers:

1. **What** are you computing? — the transformations (the operator graph: `Map`, `Filter`, `GroupByKey`, `Combine`).
2. **Where** in event-time? — the **windowing** (fixed, sliding, session windows).
3. **When** in processing-time do you emit results? — the **triggers** (at the watermark, early, on late data).
4. **How** do refinements relate? — **accumulation mode** (do late updates replace or add to earlier results?).

The deep idea is the **unification of batch and streaming**: a bounded dataset (batch) is just a stream that happens to end. The *same* pipeline code runs over a finite file or an infinite Kafka topic — only the windowing/triggering differs. Beam separates the **pipeline definition** (the dataflow graph you write) from the **runner** (Flink, Spark, Google Cloud Dataflow) that executes it. Write the graph once; choose where it runs. This is the dataflow paradigm's portability dividend: because the program *is* a graph of pure-ish operators, the same graph can be scheduled by any sufficiently capable engine.

```
   PCollection<Event> events = pipeline.apply(KafkaIO.read())   // source
       .apply(Window.into(FixedWindows.of(1 min)))               // WHERE in event-time
       .apply(WithKeys.of(Event::userId))                        // partition by key
       .apply(Count.perKey())                                    // stateful aggregate
       .apply(KafkaIO.write());                                  // sink
```

That snippet is a dataflow graph (`source → window → key → count → sink`) that runs identically on three different distributed engines. The paradigm is the abstraction layer.

---

## Event-Time vs Processing-Time

This is the single most important distinction in production stream processing, and it exists *because* events flow through a distributed graph over a network.

- **Event-time**: when the event *actually happened* — a timestamp baked into the event at its source (the moment the user clicked, the sensor sampled).
- **Processing-time**: when the event *arrives at the operator* — the wall-clock reading on the machine doing the work.

In a perfect world these are equal. In reality they diverge wildly: a mobile client buffers events offline for an hour, network paths differ, machines pause for GC, a partition lags. So events arrive **out of order and delayed** relative to when they happened.

Why it's decisive: imagine "count purchases per 1-minute window."

- **Processing-time windowing** counts whatever *arrived* in each wall-clock minute. It's simple and low-latency, but the result is *wrong and non-reproducible*: a network blip shifts events into the wrong window, and replaying the same data through a faster cluster gives different windows. The answer depends on infrastructure timing, not on the data.
- **Event-time windowing** counts events by *when they happened*, regardless of arrival. Replaying the same input always yields the same windows — **reproducible and correct** — which is the determinism property from the senior page (KPN), now applied to *time-bucketing* rather than merge order.

The catch: event-time requires knowing *when you've seen enough* of a window's events to emit a result — you can't wait forever for a straggler. That's what watermarks solve. The professional rule of thumb: **use event-time for correctness-critical analytics (billing, fraud, metrics); use processing-time only when you genuinely need "what's happening right now" and can tolerate timing-dependent results.**

---

## Windowing

Unbounded streams never end, but aggregates (`count`, `sum`, `avg`) need a *boundary*. **Windowing** slices an infinite stream into finite chunks you can aggregate over. Three standard shapes:

```
FIXED (tumbling) — adjacent, non-overlapping, equal size. Each event in exactly one window.
  │‒‒‒W1‒‒‒│‒‒‒W2‒‒‒│‒‒‒W3‒‒‒│        e.g. "count per 1-minute"

SLIDING — fixed size, overlapping by a slide interval. Each event in MULTIPLE windows.
  │‒‒‒‒‒W1‒‒‒‒‒│
        │‒‒‒‒‒W2‒‒‒‒‒│                e.g. "5-min average, updated every 1 min"
              │‒‒‒‒‒W3‒‒‒‒‒│

SESSION — gaps define boundaries; a window closes after N of inactivity. Data-driven size.
  │‒W1‒│        │‒‒‒‒W2‒‒‒‒│           e.g. "a user's browsing session" (close after 30 min idle)
   activity      gap       activity
```

- **Fixed/tumbling**: the default for periodic metrics ("requests per minute"). Each event lands in one window.
- **Sliding**: for smoothed, frequently-updated aggregates ("p99 latency over the last 5 minutes, recomputed every minute"). Events belong to several overlapping windows, so they cost more state.
- **Session**: windows are *defined by the data* — a burst of activity followed by a gap. The window size isn't fixed; it grows with activity and closes on idleness. This is **dynamic dataflow** (data-dependent boundaries) from the middle page, made concrete.

Windowing assigns each event to one or more windows *by its event-time*, and the windowing strategy plus the trigger together answer "what set of events do I aggregate, and when do I emit?"

---

## Watermarks, Lateness, and Triggers

Event-time windowing raises one unavoidable question: **a 12:00–12:01 window — when can I close it and emit the count, given an event timestamped 12:00:30 might still arrive at 12:05?** Waiting forever means never emitting; emitting immediately risks missing stragglers.

**Watermarks** are the answer. A watermark is the engine's assertion: *"I believe I have now seen all events with event-time ≤ T."* It's a moving estimate of event-time progress, derived from the timestamps actually flowing through (e.g., "max seen timestamp minus an allowed-lateness bound"). When the watermark passes the *end* of a window, the engine concludes that window is complete and **fires** it — emitting the result.

```
  events (by event-time): ──12:00:10──12:00:45──12:00:30──12:01:05──►
  watermark advances:                              ▲ watermark reaches 12:01:00
                                                   └─► window [12:00,12:01) FIRES
```

The watermark is a deliberate **trade-off knob between latency and completeness**:

- A **conservative** watermark (waits longer) catches more late events → more correct, higher latency.
- An **aggressive** watermark (advances quickly) emits sooner → lower latency, but more events arrive *after* their window closed.

**Late data** (events arriving after the watermark passed their window) is handled by policy: drop it, or keep window state around for an *allowed-lateness* period and re-fire with an updated result, or route it to a side output. **Triggers** generalize "when to emit": fire at the watermark (standard), fire *early* (speculative results before the window closes, for low-latency dashboards), and/or fire *late* (refinements when stragglers arrive). Triggers plus accumulation mode (replace vs accumulate) are how Beam lets you tune the latency/correctness/completeness trade-off per pipeline — the senior page's "latency vs completeness" dial, exposed as first-class configuration.

---

## Stateful Operators and Keyed State

Many operators are **stateless** (`map`, `filter`) and parallelize trivially. The interesting ones are **stateful**: a running count, a windowed aggregate, a stream-to-stream join, deduplication. State is what makes stream processing powerful — and what makes distribution hard.

**Keyed state is the central mechanism.** To parallelize a stateful operator across a cluster without locks, the engine **partitions the stream by key** (e.g., `userId`) and routes all events for a given key to the *same* task instance, which owns that key's state exclusively. So `Count.perKey()` over a billion users runs on 500 machines, each owning a disjoint key-range and its counts. No shared state, no locks — the **partitioning is the parallelization strategy**, exactly the "stateful nodes must be partitioned by key" point from the senior page, now load-bearing infrastructure.

```
   events ──(hash by userId)──┬──► task A : state for keys {u1,u4,u7,…}
                              ├──► task B : state for keys {u2,u5,u8,…}
                              └──► task C : state for keys {u3,u6,u9,…}
   each key's state lives in exactly one task → no contention, embarrassingly parallel
```

State must also **survive failure**. Flink (and similar) periodically **checkpoint** all operator state to durable storage (S3/HDFS). On a crash, the job restarts from the last checkpoint: state is restored and input is replayed from the corresponding source offset. The state backend (in-memory, RocksDB on local disk) is itself an engineering choice — RocksDB lets state exceed RAM at the cost of disk latency. The senior-page insight "where does the data wait?" becomes "where does the *state* live, and how is it recovered?"

---

## Delivery Guarantees: Exactly-Once

The hardest correctness property in distributed dataflow. The three levels:

- **At-most-once**: each event processed 0 or 1 times — fast, lossy, no replay. Acceptable only when occasional loss is fine.
- **At-least-once**: each event processed *≥ 1* times — on failure, replay may re-process. No loss, but **duplicates**, which corrupt any non-idempotent aggregate (a count is now too high).
- **Exactly-once**: each event affects the result *as if* processed exactly once, even across failures and replays. The gold standard for correctness-critical pipelines.

The subtlety professionals must articulate: **"exactly-once" rarely means each event is *physically* processed once.** Machines fail and replay *will* re-process events. It means **exactly-once *effect* on state and output** — duplicates are reprocessed but their effects are deduplicated/reconciled so the end result is correct.

Two mechanisms make it work:

1. **Consistent checkpoints (Chandy–Lamport snapshots).** Flink injects **checkpoint barriers** into the stream that flow through the operator graph like special tokens. When a barrier passes an operator, that operator snapshots its state; when the barrier reaches all sinks, the whole graph has a *globally consistent* snapshot at a precise stream position. On failure, restore all state to that snapshot and replay sources from the matching offsets — every operator rewinds to a mutually consistent point, so no event is double-counted *within* the pipeline. (This is the distributed-snapshot algorithm applied to a dataflow graph — and notice the barrier is just a special token riding the edges, pure dataflow.)
2. **Transactional / idempotent sinks.** The pipeline's *output* to the outside world must also be exactly-once. Either the sink is **idempotent** (writing the same key twice is harmless — an upsert) or it's **transactional** (Kafka transactions, two-phase commit), so output is committed only when the corresponding checkpoint commits. Without an exactly-once sink, exactly-once *internal* state still produces duplicate *external* effects on replay.

The professional caveat: exactly-once is **end-to-end** only if the source is replayable (Kafka offsets), the engine checkpoints consistently, *and* the sink is transactional or idempotent. Break any link and you're back to at-least-once. State this as a chain, not a checkbox.

---

## The Graph as Deployment Topology

At scale, the dataflow graph you wrote is *not* an abstraction the runtime discards — it **is the execution plan**. The runtime takes your **logical graph** (operators and edges) and expands it into a **physical graph**:

- Each operator becomes **N parallel tasks** (its parallelism), spread across worker machines/slots.
- Each edge becomes a **data-distribution pattern**: a **forward** (same task, in-memory, cheap) or a **shuffle/redistribute** (repartition by key across the network — expensive, the dominant cost). A `keyBy`/`GroupByKey` forces a network shuffle.
- Adjacent operators with compatible parallelism are **fused/chained** into one task (operator chaining) to avoid serialization between them — a real, automatic version of stream fusion.
- **Backpressure** is monitored per edge across the network; a slow downstream task propagates backpressure upstream through the credit-based flow control on its input channels — the bounded-buffer backpressure from the middle page, now spanning machines.

So operational reasoning *is* graph reasoning: throughput is gated by the slowest task; a hot key creates **data skew** (one task overloaded while others idle); a shuffle edge is where network and serialization cost concentrate; recovery time depends on state size per task. When you read a Flink/Spark job-graph UI, you're reading the dataflow paradigm's topology as the live operational picture — which is precisely why the paradigm scales: the dependency structure that constrains scheduling is *explicit in the edges*, so the engine can distribute, recover, and backpressure by inspecting the graph.

---

## Flow-Based Programming and Visual Dataflow

The paradigm also has a **visual** lineage worth knowing, because it shows up repeatedly in tools.

**Flow-Based Programming (FBP)**, formalized by J. Paul Morrison at IBM in the 1970s, treats software as a network of **black-box "processes"** exchanging fixed-format **"information packets"** over bounded, named connections — a near-exact KPN with explicit bounded buffers. Its defining traits: components are *reusable, independently developed black boxes*; the *graph (the "network")* is defined separately from the components; and connections have *bounded capacity* (built-in backpressure). **NoFlo** (JavaScript) is the best-known modern FBP toolkit, with a visual editor where you literally draw the graph.

This visual model recurs everywhere: **node-based editors** in Blender, Unreal Engine's Blueprints, Houdini, TouchDesigner, and Max/MSP; ETL tools like **Apache NiFi** and Node-RED; ML pipeline builders. The common thread is that **dataflow is the one paradigm that's natural to program by drawing**, because a graph of nodes-and-edges *is* a picture. For domains where the audience isn't traditional programmers (audio engineers, VFX artists, integration specialists), visual dataflow turns "write code" into "wire boxes" — a genuine accessibility win that imperative paradigms can't match.

---

## Computation Graphs: TensorFlow / PyTorch

Deep learning is dataflow, and recognizing this demystifies the frameworks.

A neural network's forward pass is a **computation graph**: tensors (data) flow through operations (matmul, conv, relu, softmax). The graph isn't incidental — it's *the* enabling structure:

- **Automatic differentiation** works *because* the graph records the data dependencies. Backpropagation is literally a traversal of the dataflow graph **in reverse**, applying the chain rule edge by edge. No graph, no autodiff.
- **Parallelism and device placement** come from the graph: independent nodes run concurrently; the framework places subgraphs on GPUs/TPUs and inserts the cross-device transfers — the "free parallelism from topology" and "edges-as-shuffles" ideas, applied to tensors.
- **Optimization** (operator fusion, constant folding, dead-node elimination) is graph rewriting — the same stream-fusion idea from the middle page.

The historical split mirrors the middle page's **static vs dynamic** dataflow exactly:

- **TensorFlow 1.x — static / "define-then-run":** build the entire graph first, then execute it. Fully analyzable and optimizable ahead of time (like SDF), but rigid and awkward to debug (you can't just print an intermediate value).
- **PyTorch / TF2 eager — dynamic / "define-by-run":** the graph is built on the fly as operations execute. Data-dependent control flow (a loop whose length depends on input) is trivial; debugging is normal Python — at some cost to whole-graph optimization (recovered via `torch.compile`/tracing).

That a senior ML engineer and a senior streaming engineer are both, fundamentally, *reasoning about dataflow graphs* is the payoff of seeing the paradigm clearly: the same SDF-vs-dynamic and graph-optimization concepts transfer across wildly different domains.

---

## Unix Philosophy at Scale

Step back and the lineage is unbroken: `cat | grep | sort` and a thousand-node Flink job are the *same paradigm* at different scales. The Unix philosophy — **small composable programs, each doing one thing, connected by streams** — is dataflow's founding culture, and the giant systems are its industrial descendants:

| Unix pipe | Distributed streaming |
|---|---|
| Small single-purpose program | A single operator (`map`, `filter`, `keyBy`) |
| The `\|` (OS pipe buffer) | A network edge with credit-based backpressure |
| Text stream of lines | Typed stream of records/events |
| Pipe buffer fills → writer blocks | Bounded channel full → upstream backpressured |
| Composition by rewiring pipes | Composition by wiring the operator graph |
| One machine | A cluster; operators fan out to tasks |

The professional takeaway: the instincts the junior page built on a one-liner — *small nodes, compose by wiring, let data drive, mind the buffer* — scale all the way up. What's added at scale is *time semantics* (event-time, watermarks), *durable state* (keyed state, checkpoints), and *correctness under failure* (exactly-once). The paradigm is constant; the engineering around distribution and fault-tolerance is what the professional level is *for*.

---

## Common Mistakes

- **Using processing-time where event-time is needed.** Processing-time windows are simple but give wrong, non-reproducible results under out-of-order/delayed events. For billing, metrics, or fraud, use event-time + watermarks.
- **Treating "exactly-once" as a checkbox.** It's an *end-to-end chain*: replayable source + consistent checkpoints + transactional/idempotent sink. Miss one link and you have at-least-once with duplicates corrupting aggregates.
- **Ignoring data skew.** A hot key (one `userId` with 90% of traffic) overloads one task while others idle, capping the whole job. Keyed parallelism only helps if keys distribute; mitigate with salting/pre-aggregation.
- **Unbounded state.** Session windows or joins without a timeout/TTL grow state forever → checkpoint times and memory explode. Always bound state with lateness/TTL/window expiry.
- **Watermark misconfiguration.** Too aggressive drops legitimate late data silently; too conservative inflates latency and pins window state. Tune from observed lateness distributions and monitor dropped-late-event counts.
- **Forgetting shuffle cost.** A casual `keyBy`/`GroupByKey` forces a full network repartition — often the dominant cost. Pre-aggregate before the shuffle; chain forward-able operators.
- **Assuming the visual FBP graph hides the hard parts.** Drawing boxes doesn't repeal backpressure, ordering, or state — NoFlo/NiFi graphs face the same dataflow trade-offs as code.

---

## Summary

At production scale the dataflow graph *becomes* the deployment topology: each operator expands to a fleet of tasks, each edge becomes a forward or a network **shuffle**, and backpressure spans machines via credit-based flow control. The **Beam/Dataflow model** unifies batch and streaming (a batch is a stream that ends) and separates the pipeline graph from the runner that executes it, answering *what / where-in-event-time / when-in-processing-time / how-refinements-relate*. The decisive distinction is **event-time vs processing-time**: event-time windowing is reproducible and correct under out-of-order delivery (the KPN determinism property applied to time-bucketing), while processing-time is simple but timing-dependent. **Windowing** (fixed, sliding, session) slices unbounded streams into aggregable chunks; **watermarks** assert event-time completeness and trigger window emission, trading latency against completeness, with **triggers** and **allowed lateness** tuning that dial. Stateful operators parallelize via **keyed state** — partition by key, each task owns a disjoint key-range, no locks — with **checkpoints** for fault tolerance. **Exactly-once** means exactly-once *effect*, achieved with consistent checkpoint-barrier snapshots (Chandy–Lamport) plus transactional/idempotent sinks, and only end-to-end if every link holds. **Flow-Based Programming** and node-based visual editors (NoFlo, NiFi, Blueprints) show dataflow is the paradigm natural to program by drawing, and **computation graphs** (TensorFlow/PyTorch) reveal deep learning as dataflow — autodiff is a reverse graph traversal, and the static-vs-dynamic split mirrors SDF-vs-dynamic exactly. Throughout, the Unix philosophy scales unbroken: small composable nodes, wire by graph, let data drive — with time semantics, durable state, and exactly-once added for the distributed world.

---

## Further Reading

- Akidau et al., *The Dataflow Model* (VLDB 2015) and the *Streaming 101 / 102* blog posts — the foundational what/where/when/how framing and event-time semantics.
- *Streaming Systems* by Akidau, Chernyak & Lax (O'Reilly) — the book-length treatment of windowing, watermarks, triggers, and exactly-once.
- Carbone et al., *Apache Flink: Stream and Batch Processing in a Single Engine* — checkpoint barriers, keyed state, and the unified model.
- J. Paul Morrison, *Flow-Based Programming* (2nd ed.) — the original FBP vision; pairs with the NoFlo project for the visual form.
- The TensorFlow / PyTorch autodiff docs — computation graphs and reverse-mode differentiation as a dataflow-graph traversal.

---

## Related Topics

- [`junior.md`](junior.md) · [`middle.md`](middle.md) · [`senior.md`](senior.md) — the paradigm from pipe to trade-offs.
- [`interview.md`](interview.md) — graded Q&A including event-time, windowing, and exactly-once.
- [05 — Reactive Programming](../05-reactive-programming/) — the time-varying-values cousin; Rx backpressure and operators.
- [07 — Actor Model & CSP](../07-actor-model-and-csp/) — message-passing concurrency; how stateful operators relate to actors.
- [11 — Event-Driven Programming](../11-event-driven-programming/) — events and handlers; the source side of many streams.
- [System Design → Data Streaming](../../../Architecture/system-design/15-data-streaming/) — Kafka, stream processing, lambda/kappa, and CDC at system scale.
- [Laziness & Streams](../../code-craft/functional-programming/12-laziness-and-streams/professional.md) — the FP roots of fusion and pull-based streams.
