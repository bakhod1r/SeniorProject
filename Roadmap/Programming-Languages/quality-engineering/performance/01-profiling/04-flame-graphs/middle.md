# Flame Graphs — Middle Level

> **Roadmap:** [Profiling](../README.md) → Flame Graphs
> *The junior page taught you to recognise a flame graph. This page makes you fluent: how the picture is built from a plain-text "folded stack" file, why icicle graphs are upside down, how the same shape means different things when the metric changes from CPU to allocations to blocking time, and how to read an optimization's before/after as a single coloured diff.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Folded Stacks — the Text Format Underneath Every Flame Graph](#folded-stacks--the-text-format-underneath-every-flame-graph)
4. [How the Picture Is Built — Collapse, Count, Draw](#how-the-picture-is-built--collapse-count-draw)
5. [Flame vs Icicle — Which Way Is Up](#flame-vs-icicle--which-way-is-up)
6. [The Metric Is Pluggable — CPU, Alloc, Off-CPU, Locks](#the-metric-is-pluggable--cpu-alloc-off-cpu-locks)
7. [Reading Patterns — Shapes and What They Mean](#reading-patterns--shapes-and-what-they-mean)
8. [Differential Flame Graphs — Verifying an Optimization](#differential-flame-graphs--verifying-an-optimization)
9. [Merging Stacks Correctly — Recursion and Inlining](#merging-stacks-correctly--recursion-and-inlining)
10. [Worked Example — Capture, Fold, Flame, Read the Hot Path](#worked-example--capture-fold-flame-read-the-hot-path)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **How is a flame graph actually built, and how do I read every member of the family fluently?**

At the junior level a flame graph is a picture you can point at: the wide boxes are the expensive ones. That's true and useful, but it can't yet explain *why* every profiler in every language can emit the same picture, *why* pprof and Chrome draw the root at the top while `flamegraph.pl` draws it at the bottom, or *why* the most valuable flame graph in a latency investigation is often the one that shows code **doing nothing** — waiting on a lock, a disk, a network socket.

The answers come from three ideas the picture hides. First, every flame graph is rendered from a dead-simple intermediate format — the **folded stack** — a line of text per unique call path with a count on the end. Second, that count is a *pluggable metric*: swap CPU samples for allocation bytes or off-CPU nanoseconds and the rendering code doesn't change, only the meaning does. Third, the *shape* is a vocabulary — a wide plateau, a thousand thin children, a recursive tower each describe a specific, nameable performance pathology. This page makes all three concrete with the actual format and the actual tool commands, so you stop pointing at flame graphs and start reading them.

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and can state that width = share of the metric and height = stack depth.
- **Required:** You've captured at least one CPU profile — see [../01-cpu-profiling/middle.md](../01-cpu-profiling/middle.md).
- **Helpful:** A working command line with `perf` (Linux) or Go's `pprof`, plus a browser for [Speedscope](https://www.speedscope.app).
- **Helpful:** You know the difference between *flat* (self) and *cumulative* (total) time from a tabular profiler.

---

## Folded Stacks — the Text Format Underneath Every Flame Graph

A flame graph is not a data format; it's a *rendering* of one. The format every tool in the family consumes is the **folded stack** (also called "collapsed stacks"), and it is almost insultingly simple: one line per unique stack, frames separated by semicolons from root to leaf, then a space and an integer count.

```
main;run;handleRequest;parseJSON;scanString 412
main;run;handleRequest;parseJSON;skipWhitespace 88
main;run;handleRequest;queryDB;net.Read 1530
main;run;handleRequest;render;bytes.Buffer.Write 240
main;run;gc;markObjects 95
```

That's it. Each line says "this exact call path was observed 412 times" (or held 1530 samples, or allocated 240 KB — the unit is whatever you fed in). The leftmost frame is the root of every stack; the rightmost is where the CPU actually was at the moment of the sample. The whole expressive flame-graph picture is just this text, drawn.

Because the format is this trivial, it is the universal interchange of the profiling world. Any profiler that can walk a stack can emit it, and any flame-graph renderer can read it. This is precisely why "learn to read a flame graph once, use it in every language" holds: the picture is language-agnostic *because the format it's built from is*.

> **Key insight:** The folded stack is the flame graph's "object file" — the plain, tool-neutral intermediate that decouples *who collected the data* (perf, async-profiler, pprof, your own sampler) from *who draws it* (flamegraph.pl, Speedscope, FlameScope). Master this format and a flame graph stops being magic: it's a `sort | uniq -c` over stacks, rendered as rectangles.

---

## How the Picture Is Built — Collapse, Count, Draw

A profiler doesn't capture a flame graph. It captures a *pile of raw stacks* — one full stack trace per timer tick (say, 99 times a second). Turning that pile into the picture is a three-step pipeline, and seeing the steps demystifies the whole thing.

**Step 1 — Collapse.** Take every raw sample and flatten its stack into one semicolon-joined line. A 50-frame deep sample becomes one string `frame0;frame1;...;frame49`. Two samples caught in the *same* call path produce the *same* string.

**Step 2 — Count.** Run the equivalent of `sort | uniq -c` over those strings. Identical stacks merge into a single folded line with their total count. This is the "folding" the name refers to — collapsing N identical stacks into one line with `N` on the end.

```
raw samples                          folded
─────────────                        ──────
a;b;c                                a;b;c 3      ← three identical stacks merged
a;b;c            ─── collapse ──►    a;b;d 1
a;b;c                                a;e   1
a;b;d
a;e
```

**Step 3 — Draw.** Walk the folded lines and build a tree: a frame's rectangle width is proportional to the sum of counts of every line passing through it; its children sit on the level above (or below — see the next section). Siblings are sorted alphabetically, *not* by time — there is **no time axis**; the x-position of a box is meaningless, only its width matters.

That last point trips up almost everyone at first: a flame graph looks like a timeline and is not one. Two adjacent boxes are not "before and after"; they're just two functions that happened to sort next to each other. Width is the only quantitative axis.

> **Key insight:** A flame graph is `collapse → count → draw`. The "count" step is set-based, which is *why* the x-axis carries no time information: identical stacks from completely different moments are merged into one box. If you need to see behaviour *over wall-clock time*, you need a different tool (FlameScope, next sections) — the flame graph deliberately threw that axis away to gain clarity.

---

## Flame vs Icicle — Which Way Is Up

The "flame" name comes from Brendan Gregg's original orientation: **root at the bottom, leaves at the top**, so the hot leaf functions flicker along the top edge like flames. Wide base, narrowing towers.

```
FLAME (root at bottom)               ICICLE (root at top)
                                     ┌──────────────────────────────┐
        ┌────┐                       │            main              │
   ┌────┤scan├────┐                  ├───────────────┬──────────────┤
   │ parseJSON    │  ┌─────┐         │  handleRequest│     gc       │
   ├──────────────┴──┤query│         ├───────┬───────┴──────────────┤
   │  handleRequest   │ DB │         │parseJSON│   queryDB          │
   ├──────────────────┴────┤         ├─────────┼────────────────────┤
   │         main          │         │  scan   │   net.Read         │
   └───────────────────────┘         └─────────┴────────────────────┘
   leaves on top, root at bottom     root on top, leaves hang down
```

An **icicle graph** is the same data flipped vertically: **root at the top, leaves hanging down** like icicles. It is *not* a different visualisation — same folded stacks, same widths, same tree, drawn upside down. The choice is pure convention, and it splits the ecosystem:

- **Icicle (root at top):** Go's `pprof -http` flame view, Chrome/V8 DevTools performance panel, and most browser-based tools. Reading top-down matches "start at `main`, drill into callees."
- **Flame (root at bottom):** Brendan Gregg's classic `flamegraph.pl` SVGs, and most `perf`-derived images. Reading bottom-up matches "what's actually executing right now is on top."

Speedscope offers both and even a third "left-heavy" layout. The practical consequence: when someone shares a graph, *check the orientation first*. "The big box at the top" means the **root** in pprof/Chrome (almost always `main` or the runtime entry — not interesting) but means a **hot leaf** in a classic flame graph (very interesting). Misreading orientation is the single most common way people chase the wrong frame.

---

## The Metric Is Pluggable — CPU, Alloc, Off-CPU, Locks

Here is the leverage that makes flame graphs more than a CPU toy: **the count on each folded line is just a number, and you can put any per-stack quantity there.** The renderer neither knows nor cares what the unit is. Swap the collector and the same picture answers a completely different question.

| Metric | What the count means | Captured by | Answers |
|---|---|---|---|
| **CPU samples** | times this stack was on-CPU at a timer tick | `perf record`, async-profiler `-e cpu`, Go CPU profile | "Where is the CPU burning cycles?" |
| **Allocations** | bytes (or objects) allocated on this stack | Go `-alloc_space`, async-profiler `-e alloc`, jemalloc | "What is creating garbage / heap pressure?" |
| **Off-CPU time** | nanoseconds this stack spent **blocked** (not running) | `perf sched`/`offcputime` (bcc), async-profiler `-e wall` | "What am I **waiting** on — locks, disk, network?" |
| **Lock contention** | time blocked on a specific mutex | async-profiler `-e lock`, Go block/mutex profile | "Which lock is serialising my threads?" |

The under-used hero of this table is the **off-CPU flame graph**. A CPU flame graph can only show you code that is *running* — by construction it is blind to a thread that is parked waiting for a database response, because a sleeping thread consumes zero CPU samples. If your service spends 200 ms per request and 180 ms of that is waiting on a downstream call, a CPU flame graph will look nearly *empty* and you'll conclude "the code is fast" — which is true and completely beside the point.

```
CPU flame graph of a slow handler        Off-CPU flame graph of the SAME handler
(mostly idle — code isn't the problem)   (the 180 ms of waiting, finally visible)
                                          ┌──────────────────────────────────┐
   ┌──┐                                   │           handleRequest           │
   │..│ tiny                              ├────────────────────┬──────────────┤
   └──┘                                   │  db.Query (epoll)  │ cache.Get    │
                                          │   net.Read  150ms  │  net 30ms    │
                                          └────────────────────┴──────────────┘
```

The off-CPU graph captures *where threads go to sleep and how long they stay there*, so blocking dominates the picture. For latency problems — as opposed to throughput/CPU problems — it is usually the *more* informative graph, and almost nobody reaches for it first.

> **Key insight:** "Flame graph" names a *visualisation*, not a *measurement*. CPU is just the default fuel. When an investigation is about **latency** ("why is p99 slow?") rather than **cost** ("why is CPU at 90%?"), the right move is often to change the metric to off-CPU or lock time — same picture, the answer that CPU sampling structurally cannot give you.

---

## Reading Patterns — Shapes and What They Mean

Fluency is pattern recognition. A handful of silhouettes recur across every flame graph, and each names a specific pathology. (Sketches below use classic flame orientation — hot leaves on top.)

**Wide plateau on top = a hot leaf.** A single wide box at the very top, sitting on a narrow stack, means one function is itself burning the metric (high *self*/flat cost). This is the dream: optimize that one function and the plateau shrinks.

```
   ┌──────────────────────────┐
   │      crc32_checksum      │  ← 38% self time. Optimize THIS.
   ├──────────────────────────┤
   │        writeBlock        │
   └──────────────────────────┘
```

**Wide box with many thin children = death by a thousand cuts.** A frame is wide (lots of *cumulative* time) but its top is a picket fence of narrow children, none individually significant. No single hot leaf — the cost is *spread* across many small callees. Optimizing any one child barely moves the total; you must attack the caller (call it less, batch it) or accept it.

```
   ┌─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┐
   │.│.│.│.│.│.│.│.│.│.│.│.│.│  ← 50 thin children, ~1% each
   ├─┴─┴─┴─┴─┴─┴─┴─┴─┴─┴─┴─┴─┤
   │   serializeEveryField    │  ← attack the CALLER, not a child
   └──────────────────────────┘
```

**A recursive tower = self-call recursion.** The *same* frame name repeats up a tall, often slightly-narrowing column. Recursive descent (a parser, a tree walk). The interesting question is the total width of the tower, not any one level — and whether it should be iterative.

```
   ┌──────┐
   │ walk │
   ├──────┤
   │ walk │  ← same name repeating up = recursion
   ├──────┤
   │ walk │
   └──────┘
```

**A framework frame dominating, your code thin = you're a thin client.** The wide regions are all library/runtime/ORM frames and *your* functions are slivers. Your logic isn't the cost — the framework is. The lever is usually configuration or call-frequency (caching, batching, a lighter codec), not rewriting your sliver.

> **Key insight:** Width tells you *how much*, but the **shape** tells you *what kind* and therefore *what to do*. A wide plateau says "optimize this function." A wide box over thin children says "this function is innocent — call its parent less." Reading only width, you'd attack both the same way and fail on the second.

---

## Differential Flame Graphs — Verifying an Optimization

You changed something and the benchmark is 12% faster. *Where* did the 12% come from — and did anything get *worse* that the net number is hiding? A **differential flame graph** answers this by rendering the *delta* between two profiles (before and after) as one coloured picture.

The convention, from Gregg's `difffolded.pl`: take two folded files, compute the per-stack difference, and colour each box by how its count changed — **red = got worse (more samples after), blue = got better (fewer samples after)**, intensity scaled to the size of the change. The frame layout is the union of both profiles, so frames that appeared or vanished still show up.

```bash
# capture before, make the change, capture after — same workload both times
perf record -F 99 -g -- ./app-before > /dev/null
perf script | stackcollapse-perf.pl > before.folded
# ... apply optimization, rebuild ...
perf record -F 99 -g -- ./app-after  > /dev/null
perf script | stackcollapse-perf.pl > after.folded

# render the delta (after relative to before)
difffolded.pl before.folded after.folded | flamegraph.pl > diff.svg
```

Reading it: a big **blue** box exactly over the function you optimized is the proof you wanted — that's where the time left. A surprise **red** box is the regression you didn't know you caused: maybe your new caching path shifted cost into `hashKey`, or you traded CPU for a new allocation that GC now pays for. The net benchmark number could be +12% while a red tower quietly warns that one path doubled.

> **Key insight:** A single profile shows you where time *is*; a differential shows you where time *moved*. "Faster on the benchmark" is a scalar that can hide a regression — the diff graph turns your optimization into a falsifiable claim: *blue where you expected, and no unexplained red.* Always diff with the **same workload** on both sides, or the colours are noise.

A caveat: differential flame graphs assume the two runs are comparable. Different input, a noisy machine, or a different sample count makes the colours meaningless. Normalise the workload and, ideally, the total sample count before reading anything into the reds and blues.

---

## Merging Stacks Correctly — Recursion and Inlining

The `collapse → count` step sounds trivial until two realities of real code make "are these two stacks the same?" genuinely hard. Get the merging wrong and the picture lies.

**Recursion.** A recursive function appears many times in a single stack: `parse;parse;parse;parse;scan`. Each level is a distinct frame *in that one sample*, so the folded line legitimately contains the name repeated. That's correct — but it means a deeply recursive call path produces a tall, narrow tower, and naive tooling can *over-count* if it merges recursive frames into one. Good renderers (Speedscope, modern flamegraph.pl) keep the recursion visible as a tower; some offer a "merge recursion" toggle that collapses the tower into one box so you can see the *total* recursive cost at a glance. Know which mode you're in: the tower and the merged box describe the same time differently.

**Inlining.** The optimizer routinely *inlines* a small callee into its caller, so the function that exists in your source has **no stack frame** at runtime — the CPU is literally executing the caller's frame. A naive profile then attributes the cost to the caller and the inlined function *vanishes from the graph*, leaving you searching for a function that the hardware no longer has frames for.

```
source:           runtime stack after inlining:
  hot()             ┌─────────────────────┐
    └ tiny()        │  hot  (tiny inlined) │  ← tiny() has no frame; its cost
                    └─────────────────────┘     shows up as hot()'s self time
```

The fix is tool support: `perf` with debug info can *reconstruct* inlined frames (`perf script --inline`), and Go/async-profiler annotate inlined frames so they reappear in the graph, often marked. Without that, two traps follow: (1) a function you "know" is hot is missing — because it was inlined into its caller; (2) a caller looks like it has surprising *self* time that is really its inlined children. When a frame's self time looks too high to explain, suspect inlining before you suspect the profiler is broken.

> **Key insight:** "Collapse identical stacks" hides two hard questions. Recursion makes a name legitimately repeat — don't merge it away unless you mean to. Inlining makes a real function *disappear* from the stack entirely — its cost gets charged to its caller. Both distort the shape, and both are *toolchain* problems: enable inline reconstruction and pick a recursion mode deliberately, or you'll read a picture that quietly misattributes time.

---

## Worked Example — Capture, Fold, Flame, Read the Hot Path

Take a Go HTTP service that feels slow under load. The full loop — capture, fold, render, read — in one pass.

```bash
# 1. CAPTURE a 30s CPU profile from the live service's pprof endpoint
go tool pprof -raw -output=cpu.pb.gz \
  "http://localhost:6060/debug/pprof/profile?seconds=30"

# 2a. RENDER directly with pprof's built-in icicle view (root at top)
go tool pprof -http=:8080 cpu.pb.gz       # opens browser → "Flame Graph" tab

# 2b. OR convert to folded stacks and use the classic flame toolchain
go tool pprof -raw cpu.pb.gz | stackcollapse-go.pl > cpu.folded
flamegraph.pl cpu.folded > cpu.svg        # root at bottom
```

Open the folded file directly — it's just text, and skimming it is often faster than the picture for a first pass:

```
main.main;http.serve;app.handleOrder;json.Marshal;reflect.Value.Field 2210
main.main;http.serve;app.handleOrder;db.Query;net.Read              480
main.main;http.serve;app.handleOrder;json.Marshal;mapassign         390
main.main;http.serve;app.handleOrder;app.validate                   120
runtime.gcBgMarkWorker;runtime.scanobject                           640
```

Now **read the hot path**. Sum by leaf-ward frame: `json.Marshal` appears with 2210 + 390 = **2600** of ~4440 samples — roughly **59%** of CPU is in JSON marshalling, and most of *that* is `reflect.Value.Field`. That's a classic signature: reflection-based encoding is the bottleneck, not your business logic (`app.validate` is a rounding error at 120). Note also `gcBgMarkWorker` at 640 (~14%) — GC is doing real work, hinting the marshalling is also allocating heavily.

Two leads, ranked by the graph:

1. **Replace reflection-based `json.Marshal`** on the hot struct with generated marshalling (e.g. `easyjson`/`ffjson`) or a hand-written encoder — directly attacks the 59% plateau.
2. **The GC at 14%** is a downstream symptom; an allocation flame graph (change the metric — see [../03-allocation-profiling/middle.md](../03-allocation-profiling/middle.md)) would confirm the marshaller is the allocator too, and fixing #1 likely shrinks both boxes at once.

Then **prove it** with a differential: capture `after.folded` under the *same* load, run `difffolded.pl before.folded after.folded | flamegraph.pl`, and confirm a deep **blue** region over `json.Marshal` with **no new red** elsewhere. That diff is the difference between "the benchmark went up" and "I know exactly where the time went and that I caused no regression."

---

## Mental Models

- **A flame graph is `sort | uniq -c` over stacks, drawn as rectangles.** Collapse each stack to a line, count duplicates, draw widths from the counts. Once you see the folded text behind the picture, nothing about it is mysterious.

- **The x-axis is a lie if you read it as time.** Width is the only quantitative axis; horizontal position is just alphabetical sort order. Two adjacent boxes are not "before and after" — they merged samples from all of time. For wall-clock behaviour, reach for FlameScope, not a flame graph.

- **The metric is a dial, not a fixed unit.** CPU is the default, but the same renderer draws allocations, off-CPU blocking, or lock time. Choosing the metric to match the *question* (cost vs latency) is half the skill.

- **Shape names the pathology; width only measures it.** Plateau = hot leaf (optimize it). Wide-over-thin-children = death by a thousand cuts (attack the caller). Tower = recursion. Framework-dominant = thin client. The lever differs per shape.

- **A differential shows where time *moved*, not where it *is*.** One profile finds the bottleneck; the diff (blue=better, red=worse) verifies your fix and exposes the regression a scalar benchmark hides.

---

## Common Mistakes

1. **Reading horizontal position as time.** A flame graph has no time axis — boxes are sorted alphabetically. "This ran, then that ran" is never something a flame graph tells you. If you need a timeline, use FlameScope or a tracing tool.

2. **Confusing the root with a hot frame because you ignored orientation.** In pprof/Chrome (icicle, root at top) the big top box is usually `main` and meaningless; in a classic flame graph (root at bottom) the big top box is a hot *leaf* and very meaningful. Check which way is up *first*.

3. **Optimizing a wide *cumulative* box that has no hot leaf.** A wide frame whose top is a picket fence of thin children has no single hot function inside it. Rewriting any one child does nothing — you must call the wide frame *less*, or batch it. (This is the "it's 50%, I'll optimize it" trap: 50% *cumulative* is not 50% *self*.)

4. **Using a CPU flame graph for a latency problem.** A blocked thread burns zero CPU samples, so a CPU graph is blind to waiting. If p99 is high but the CPU graph looks idle, you need an **off-CPU** graph — the code isn't slow, it's *waiting*, and only off-CPU shows on what.

5. **Diffing two incomparable profiles.** A differential is meaningful only if both runs used the same workload and roughly the same sample count. Different input or a noisy machine makes the reds and blues random. Normalise before reading colours.

6. **Trusting a graph where inlining hid frames.** If a function you *know* is hot is missing, or a caller has impossible self time, the optimizer inlined a callee and the cost got reattributed. Re-capture with inline reconstruction (`perf script --inline`, or the language's inline-aware mode) before concluding.

---

## Test Yourself

1. What is a *folded stack*, and why is it the reason "learn flame graphs once, use them everywhere" is true?
2. A flame graph looks like a timeline. Why is reading its x-axis as time wrong, and what *is* the x-position?
3. Someone shares a flame graph with a huge box labelled `main` at the very top. Are they likely looking at a flame or an icicle graph, and is that box interesting?
4. Your service's p99 latency is 300 ms but its CPU flame graph is nearly empty. What kind of flame graph do you capture next, and why will it look completely different?
5. A frame is wide but its top edge is a row of 40 thin children. Why does optimizing any single child fail to help, and what should you do instead?
6. You optimized a function; the differential flame graph shows the expected blue box over it but also a new red tower elsewhere. What does the red mean, and why might the net benchmark still look like a win?

<details>
<summary>Answers</summary>

1. A folded stack is one line of text per unique call path — frames joined by `;` from root to leaf, then a space and a count. It's the tool-neutral intermediate format every profiler emits and every renderer reads, which decouples collection from drawing — so the *picture* is language-agnostic because the *format* is.
2. There is no time axis. Boxes are sorted **alphabetically**, and identical stacks from any moment are merged into one box during the count step — so x-position carries no temporal meaning. Only *width* (share of the metric) is quantitative.
3. An **icicle** graph (root at top — pprof/Chrome convention). The top box is the root (`main`), so it's *not* interesting; the interesting frames hang *below* it. In a classic flame graph the top box would instead be a hot leaf.
4. An **off-CPU** flame graph. A blocked thread consumes zero CPU samples, so CPU sampling is structurally blind to waiting; off-CPU captures time spent *parked* (locks, disk, network), which is where the 300 ms actually goes.
5. The cost is *spread* (high cumulative, low per-child self time) — "death by a thousand cuts." No single child is significant, so optimizing one moves nothing. Attack the **caller**: call it less, batch the work, or change the algorithm that fans out into the children.
6. The red tower is a **regression** — that path got *worse* (more samples after your change), e.g. cost shifted into a new code path. The net benchmark can still be positive if the blue savings outweigh the red, but the red is a real cost you introduced and should understand, not a number to bury.

</details>

---

## Cheat Sheet

```
FOLDED STACK FORMAT (what every tool consumes)
  root;frame;frame;leaf  COUNT      ← one line per unique stack, ; = call edge
  pipeline:  raw stacks → collapse → sort|uniq -c → draw rectangles

ORIENTATION (check FIRST)
  flame    root at BOTTOM, hot leaves on top   flamegraph.pl, perf SVGs
  icicle   root at TOP,    leaves hang down     pprof -http, Chrome DevTools
  → big TOP box = hot leaf (flame) OR root/main, ignore (icicle)

METRIC IS PLUGGABLE (same picture, different question)
  cpu      where cycles burn        perf, async-profiler -e cpu, Go CPU
  alloc    what makes garbage       Go -alloc_space, async-profiler -e alloc
  off-cpu  what you WAIT on         offcputime (bcc), async-profiler -e wall
  lock     which mutex serialises   async-profiler -e lock, Go block/mutex
  → latency problem? use OFF-CPU, not CPU (sleeping threads = 0 CPU samples)

SHAPES → ACTION
  wide plateau on top          hot leaf        → optimize THIS function
  wide box, many thin children death-by-cuts   → attack the CALLER (batch/less)
  same name repeating up       recursion       → consider iterative; watch total
  framework wide, you thin     thin client     → config/caching, not your code

DIFFERENTIAL  (verify an optimization)
  difffolded.pl before.folded after.folded | flamegraph.pl
  blue = better (fewer after)   red = worse (more after)
  → same workload + sample count both sides, or colours are noise

GENERATE
  perf record -F 99 -g -- ./app; perf script | stackcollapse-perf.pl | flamegraph.pl
  cargo flamegraph                            (Rust, wraps perf + flamegraph.pl)
  go tool pprof -http=:8080 cpu.pb.gz         (Go, icicle in browser)
  async-profiler -e cpu -f out.html PID       (JVM, flame/icicle HTML)
  speedscope cpu.folded                       (browser, flame/icicle/left-heavy)

GOTCHAS
  x-axis ≠ time (alphabetical sort)   |   cumulative ≠ self time
  inlining hides frames → perf script --inline / inline-aware mode
  recursion = legit repeated frames → pick merge-recursion mode deliberately
```

---

## Summary

- A flame graph is a *rendering* of **folded stacks** — one line of text per unique call path (`root;...;leaf COUNT`). That trivial, tool-neutral format is why the visualisation is language-agnostic and why every profiler can feed every renderer.
- The picture is built by **collapse → count → draw**: flatten each stack to a line, merge identical lines with `sort | uniq -c`, draw widths from counts. The count step is set-based, which is *why the x-axis carries no time* — only width is quantitative.
- **Icicle** (root at top: pprof, Chrome) and **flame** (root at bottom: flamegraph.pl, perf) are the same data flipped. Check orientation first, or you'll mistake the root for a hot frame.
- The metric is **pluggable** — CPU, allocations, off-CPU blocking, lock contention all render identically. For *latency* problems the **off-CPU** graph is the one that shows what CPU sampling structurally cannot: what you're *waiting* on.
- **Shape** names the pathology: plateau = hot leaf (optimize it), wide-over-thin-children = death by a thousand cuts (attack the caller), tower = recursion, framework-dominant = thin client.
- A **differential** flame graph (blue=better, red=worse) verifies an optimization by showing where time *moved* — proving your fix landed and exposing the regression a scalar benchmark hides. Merging must respect **recursion** (legit repeats) and **inlining** (vanished frames) or the picture misattributes time.

---

## Further Reading

- *Flame Graphs* — Brendan Gregg, `brendangregg.com/flamegraphs.html`. The canonical resource: invention, variants (off-CPU, differential, icicle), and the original Perl toolchain.
- *Systems Performance* (Brendan Gregg), 2nd ed. — the profiling and flame-graph chapters, with off-CPU analysis treated as a first-class technique.
- [Speedscope](https://github.com/jlfwong/speedscope) — interactive in-browser flame/icicle/left-heavy viewer; its README explains the folded format and the three layouts well.
- [FlameScope](https://github.com/Netflix/flamescope) — Netflix's tool for the *time* axis flame graphs throw away: a subsecond heatmap you click into to generate a flame graph for a chosen window.
- `man perf-script`, `pprof --help`, and the async-profiler README — the primary sources for the capture/fold commands above.

---

## Related Topics

- [junior.md](junior.md) — recognising a flame graph and the width = time, height = depth basics this page builds on.
- [senior.md](senior.md) — continuous profiling, flame graphs across a fleet, and folding pipelines at scale.
- [../01-cpu-profiling/middle.md](../01-cpu-profiling/middle.md) — capturing the CPU profiles that the most common flame graphs visualise.
- [../03-allocation-profiling/middle.md](../03-allocation-profiling/middle.md) — the same visualisation with allocations as the metric, for chasing heap pressure and GC cost.
