# GC Tuning in Production — Middle Level
> **Topic:** [GC Tuning in Production](README.md)
> **Focus:** The knobs and the mechanisms behind them — heap sizing, generations, the JVM and Go control levers, and reading a GC log.

---

## Table of Contents
- [Introduction](#introduction)
- [Prerequisites](#prerequisites)
- [Glossary](#glossary)
- [Core Concepts](#core-concepts)
- [The JVM Knobs](#the-jvm-knobs)
- [The Go Knobs](#the-go-knobs)
- [Reading a GC Log](#reading-a-gc-log)
- [Mental Models](#mental-models)
- [Code Examples](#code-examples)
- [Pros & Cons](#pros--cons)
- [Coding Patterns](#coding-patterns)
- [Best Practices](#best-practices)
- [Edge Cases & Pitfalls](#edge-cases--pitfalls)
- [Summary](#summary)

---

## Introduction

The junior tier established the trade-off triangle (latency / throughput / footprint) and the two big levers: reduce allocation, and size the heap. This tier turns those into concrete knobs you can set and logs you can read. We focus on the two runtimes you are most likely to operate: the **JVM** and **Go**. They sit at opposite ends of a philosophy spectrum — the JVM gives you dozens of knobs; Go deliberately gives you about two — and seeing both teaches the mechanism better than either alone.

The goal here is not to memorize flags. It is to understand *what each knob moves* in the triangle, so that when you read "we set `-XX:MaxGCPauseMillis=50`," you know what it costs.

## Prerequisites

- The junior tier: the triangle, allocation rate, STW pauses, why bigger heaps collect less often, why averages lie.
- Basic command-line comfort: setting environment variables, passing JVM flags.
- A rough idea that objects have *lifetimes*: most die young, some live a long time. This "generational hypothesis" underpins everything below.

## Glossary

- **Generational GC** — a design that splits the heap by object age. New objects go in the **young generation**; survivors are promoted to the **old (tenured) generation**. Based on the empirical fact that *most objects die young*.
- **Minor GC** — a collection of just the young generation. Cheap and frequent.
- **Major / Full GC** — a collection that includes the old generation (and often everything). Expensive and rare; the thing you want to avoid.
- **Promotion** — moving an object that survived enough minor GCs from young to old.
- **Pacer** — the part of a concurrent collector that decides *when* to start a GC so it finishes before the heap runs out. Go's GC is paced by `GOGC`/`GOMEMLIMIT`.
- **GC target / heap goal** — the heap size at which the next collection is triggered.
- **Concurrent collector** — one that does most of its marking/sweeping while your app runs, minimizing STW.
- **Humongous object (G1)** — an object so large it spans one or more whole G1 regions; handled specially.
- **Metaspace (JVM)** — off-heap memory for class metadata; a separate pool from the object heap.

## Core Concepts

### The generational hypothesis

Measure almost any program and you find: the overwhelming majority of objects become garbage almost immediately (loop temporaries, request-scoped buffers, intermediate strings), while a small minority live a long time (caches, connection pools, long-lived config).

Generational collectors exploit this. They put new allocations in a small **young generation** and collect it often and cheaply (a **minor GC**), because most of it is already dead by the time they look. The rare survivors get **promoted** to the **old generation**, which is collected far less frequently. This is why the young/old split and the sizes of each gen are central tuning knobs.

### Heap goal / pacing — when does a collection trigger?

A collector doesn't run on a clock; it runs based on **how full the heap is**. Conceptually:

> Start a GC when the live heap has grown by some target factor since the last collection.

Make that factor large → collect rarely, use more memory, longer-but-fewer pauses. Make it small → collect often, use less memory, more frequent (possibly shorter) pauses. This single dial — expressed as `GOGC` in Go, and indirectly via heap sizing and pause targets in the JVM — is the heart of frequency tuning.

### Concurrency costs throughput

Old collectors did everything in one big STW pause. Modern ones (G1, ZGC, Shenandoah, Go's collector) do most of the work *concurrently*, slashing pause time. But concurrency isn't free: the collector competes with your app for CPU, and it needs **write barriers** — small bookkeeping snippets the compiler inserts around pointer writes so the GC can track changes while the app runs. Those barriers add a few percent of overhead on every pointer store.

So the trade is explicit: **concurrent collectors buy short pauses by spending throughput and a bit of memory.** That is the latency-vs-throughput edge of the triangle, made mechanical.

## The JVM Knobs

The JVM exposes many flags. These are the ones that matter in practice.

**Heap sizing — the most important pair:**

```bash
-Xms4g   # initial heap size
-Xmx4g   # maximum heap size
```

**Set `-Xms` equal to `-Xmx` in production.** If they differ, the JVM grows and shrinks the heap, and every resize can trigger a full GC and commits/uncommits OS pages — jitter you don't want. Pinning them removes that whole class of surprise and pre-commits the memory.

**Choosing a collector:**

```bash
-XX:+UseG1GC          # G1: the balanced default (and default since JDK 9)
-XX:+UseParallelGC    # Parallel: max throughput, longer STW — great for batch
-XX:+UseSerialGC      # Serial: single-threaded, tiny heaps / containers
-XX:+UseZGC           # ZGC: sub-millisecond pauses on huge heaps
-XX:+UseShenandoahGC  # Shenandoah: same goal, concurrent compaction
```

(Senior tier covers *which* to pick; here, know they exist and are mutually exclusive.)

**G1 pause target:**

```bash
-XX:MaxGCPauseMillis=200   # a *goal*, not a guarantee
```

G1 tries to keep pauses under this by collecting the heap in chunks (regions) and doing only as much per pause as fits the budget. Set it too low and G1 collects tiny slices very often — frequency and overhead rise. It is a soft hint, not a hard SLA.

**Young/old generation sizing:**

```bash
-XX:NewRatio=2        # old:young size ratio (2 => young is 1/3 of heap)
-XX:MaxNewSize=1g     # cap on young gen
```

A larger young gen means minor GCs are rarer but each scans more; it also delays promotion (good — fewer survivors reach old gen). With G1 you usually let it auto-size and avoid hard-pinning these.

**Container awareness:**

```bash
-XX:MaxRAMPercentage=75.0   # size the heap as % of *container* memory
```

Prefer this to a hard `-Xmx` in Kubernetes so the heap scales with the pod's limit. Modern JVMs (10+) read cgroup limits, so they see the *container's* memory, not the host's — but you must still leave headroom for non-heap memory (see pitfalls).

**GC logging (turn this on everywhere):**

```bash
-Xlog:gc*:file=/var/log/app/gc.log:time,uptime,level,tags:filecount=5,filesize=20m
```

**Metaspace** (class metadata, off-heap) has its own cap:

```bash
-XX:MaxMetaspaceSize=256m
```

Unbounded by default; a class-loading leak (e.g. dynamic proxies, frequent redeploys) can exhaust it and cause `OutOfMemoryError: Metaspace` even with a healthy object heap.

## The Go Knobs

Go takes the opposite stance: **few knobs by design.** Its collector is a concurrent, non-generational, non-compacting mark-sweep tuned for sub-millisecond STW. You mostly set two things.

**`GOGC` — the heap-growth target (the pacer):**

```bash
GOGC=100   # default: trigger GC when the heap doubles since the last live set
```

`GOGC=100` means "let the heap grow to 2× the live set before collecting." Raise it (`GOGC=200`, `GOGC=400`) to collect less often at the cost of more memory — a classic throughput-for-footprint trade. Lower it (`GOGC=50`) to collect more often and stay leaner. Set `GOGC=off` to disable GC entirely (only for short-lived batch jobs).

**`GOMEMLIMIT` — the soft memory limit (Go 1.19+):**

```bash
GOMEMLIMIT=3500MiB   # keep total Go memory under ~3.5 GiB
```

This is the modern, correct way to keep Go from OOMing in a container. It is a *soft* limit: as the heap approaches it, the GC runs more aggressively to stay under it, even overriding `GOGC`. Combined with `GOGC=off` or a high `GOGC`, the idiom becomes: *"collect lazily for throughput, but never blow past the memory ceiling."* This single feature retired the old **ballast trick** (allocating a large dummy `[]byte` to fake a bigger heap and trick the pacer into collecting less). Don't use ballast in new code.

**The GC trace:**

```bash
GODEBUG=gctrace=1 ./server
```

That's essentially the toolkit. Go's philosophy is that the runtime should do the right thing with almost no tuning, and in practice `GOGC` + `GOMEMLIMIT` cover the vast majority of cases.

## Reading a GC Log

You cannot tune what you cannot read. Two examples.

**A Go `gctrace` line:**

```
gc 142 @8.201s 2%: 0.018+1.9+0.005 ms clock, 0.30+0.42/1.8/0+0.085 ms cpu, 24->25->13 MB, 25 MB goal, 8 P
```

Decode the load-bearing fields:
- `gc 142` — the 142nd GC since start.
- `@8.201s` — time since program start.
- `2%` — fraction of total CPU spent on GC since start. **This is your throughput cost.** Single digits = healthy.
- `0.018+1.9+0.005 ms clock` — the three GC phases (STW sweep termination + concurrent mark + STW mark termination). The two STW numbers (0.018 and 0.005 ms) are your **pause times** — sub-millisecond, as designed.
- `24->25->13 MB` — heap **before → after-mark → live** for this cycle. Live set is 13 MB.
- `25 MB goal` — the pacer's trigger size for next time (~2× live, since `GOGC=100`).
- `8 P` — number of processors (Ps) available.

What to watch: the `%` creeping up (throughput problem), the goal climbing without the live set climbing (allocation churn), or STW numbers spiking (rare in Go — investigate).

**A G1 log line (`-Xlog:gc`):**

```
[12.345s][info][gc] GC(57) Pause Young (Normal) (G1 Evacuation Pause) 512M->96M(2048M) 8.231ms
```

- `GC(57)` — the 57th collection.
- `Pause Young (Normal)` — a minor GC. (You'd see `Pause Full` for the expensive kind — a red flag if frequent.)
- `512M->96M(2048M)` — heap **before → after (total heap)**. 512 MB collapsed to 96 MB, so most of that 512 was garbage. Healthy.
- `8.231ms` — the pause duration. Compare against your `MaxGCPauseMillis` goal.

The skills: identify **minor vs full**, read **before→after** to judge how much was garbage, and read the **duration** against your pause budget.

## Mental Models

**Model 1: "Knobs move you *along* the triangle, code moves the triangle itself."** Flags rebalance who pays. Reducing allocation shrinks the whole problem. Reach for code first.

**Model 2: "Frequency vs. cost-per-collection."** Almost every heap-sizing knob trades *how often* the GC runs against *how big* each run is. Bigger heap / higher `GOGC` → rarer but larger collections.

**Model 3: "Young gen is a sieve."** Minor GCs filter out the flood of short-lived garbage cheaply; only survivors cost you (promotion + eventual old-gen GC). Keep objects dying in the young gen.

## Code Examples

**A production JVM flag set for a latency service (G1):**

```bash
java \
  -Xms4g -Xmx4g \
  -XX:+UseG1GC \
  -XX:MaxGCPauseMillis=100 \
  -XX:InitiatingHeapOccupancyPercent=45 \
  -XX:+ParallelRefProcEnabled \
  -Xlog:gc*:file=/var/log/app/gc.log:time,uptime,tags:filecount=5,filesize=20m \
  -jar service.jar
```

**A production JVM flag set for a batch job (max throughput):**

```bash
java -Xms8g -Xmx8g -XX:+UseParallelGC -jar etl.jar
# Long pauses are fine here; we want plates off the pass, not smooth latency.
```

**Go service env (the modern container idiom):**

```bash
GOGC=200 GOMEMLIMIT=3500MiB GODEBUG=gctrace=1 ./server
# Collect lazily (throughput) but never exceed ~3.5 GiB (OOM safety).
```

## Pros & Cons

**Many knobs (JVM):**
- Pro: precise control; you can hit aggressive SLOs.
- Con: easy to mis-tune; flag interactions are subtle; cargo-culting is rampant.

**Few knobs (Go):**
- Pro: hard to get badly wrong; the runtime self-tunes.
- Con: when you *do* need fine control, the ceiling is lower; you fix problems in code instead.

## Coding Patterns

- **Object pooling / buffer reuse** (`sync.Pool` in Go, reused `byte[]`/`ThreadLocal` buffers in Java) to cut allocation rate on hot paths.
- **Preallocate to known size** (`make([]T, 0, n)`, `new ArrayList<>(n)`) so growth doesn't churn the heap.
- **Avoid boxing in hot loops** (autoboxing `Integer` in Java creates garbage; prefer primitives / value types).
- **Stream instead of materialize**: process records one at a time rather than building a giant intermediate collection.

## Best Practices

- **`-Xms == -Xmx`** in production. Always.
- **Prefer `MaxRAMPercentage` / `GOMEMLIMIT`** over hard sizes in containers.
- **Turn on GC logging by default**, with rotation. It's nearly free and priceless during an incident.
- **Use `GOMEMLIMIT`, not ballast.** Ballast is a historical hack.
- **Treat `MaxGCPauseMillis` as a goal, not a contract.** Don't set it absurdly low.
- **Change one knob, re-measure**, keep a record of before/after percentiles and GC%.

## Edge Cases & Pitfalls

- **Container memory ≠ heap.** Your `-Xmx` or `GOMEMLIMIT` covers the *object heap*, but the process also uses thread stacks, metaspace/code cache, native buffers, and the GC's own structures. Set the heap *below* the container limit (leave 20–30% headroom) or you'll be OOMKilled despite the heap looking fine.
- **Humongous allocations in G1.** Objects larger than half a G1 region are "humongous," allocated straight into old-gen-like regions, and can fragment the heap and trigger more frequent collections. Large byte arrays are the usual culprit.
- **Metaspace leaks** masquerade as memory problems but never touch the object heap — caused by class-loader churn (frequent redeploys, dynamic proxies, scripting engines).
- **`MaxGCPauseMillis` set too low** backfires: G1 collects ever-smaller slices ever more often, raising overhead and sometimes *missing* the target anyway.
- **`GOGC` too high without `GOMEMLIMIT`** → the heap balloons until the container kills you. Always pair an aggressive `GOGC` with a memory limit.

## Summary

Tuning knobs move you *along* the triangle; they don't escape it. On the **JVM**, the load-bearing knobs are heap sizing (`-Xms`=`-Xmx`), collector choice (`UseG1GC`/`UseParallelGC`/`UseZGC`), the G1 pause goal (`MaxGCPauseMillis`), generation sizing, and container-aware `MaxRAMPercentage` — all observable through `-Xlog:gc*`. On **Go**, you mostly set `GOGC` (heap-growth/frequency) and `GOMEMLIMIT` (the soft memory ceiling that retired the ballast hack), observed through `GODEBUG=gctrace=1`. The decisive skills at this tier are **reading a GC log** — minor vs full, before→after, pause duration, GC% — and remembering that **container memory is not the heap**, so always leave headroom.
