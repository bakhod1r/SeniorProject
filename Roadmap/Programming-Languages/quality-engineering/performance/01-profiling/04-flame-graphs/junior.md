# Flame Graphs — Junior Level

> **Roadmap:** [Profiling](../README.md) → Flame Graphs
> *A profiler gives you ten thousand stack samples. A flame graph is the one picture that lets a human read them — but only if you read the width and ignore almost everything else your eye is drawn to.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — What the Axes Actually Mean](#core-concept-1--what-the-axes-actually-mean)
5. [Core Concept 2 — Width Is the Only Thing That Matters](#core-concept-2--width-is-the-only-thing-that-matters)
6. [Core Concept 3 — Self Time vs Total Width](#core-concept-3--self-time-vs-total-width)
7. [Core Concept 4 — Finding the Thing to Optimize](#core-concept-4--finding-the-thing-to-optimize)
8. [Core Concept 5 — Generating Your First Flame Graph](#core-concept-5--generating-your-first-flame-graph)
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

> Focus: **How do I read a flame graph without lying to myself?**

A profiler does one boring thing thousands of times: every few milliseconds it freezes your program and writes down the current call stack — "right now we're in `compress`, which was called by `writeChunk`, called by `handleUpload`, called by `main`." After a few seconds you have *tens of thousands* of these snapshots. That pile of stacks is the raw truth about where your program spends its time. It is also completely unreadable as a list.

A **flame graph** is the picture that makes that pile readable. Brendan Gregg invented it for exactly this: take all those stacks, stack them visually, and let the *width* of each box show how often that function appeared in the samples. A function that showed up in half the snapshots gets a box half the screen wide. One glance and the hot spots jump out.

But flame graphs trip up almost every beginner the same way. The picture is colorful, it has tall spiky towers, and it *looks* like a timeline — so people read the colors, chase the tallest tower, and assume left-to-right means "first to last." All three instincts are wrong, and each one sends you optimizing code that was never slow.

This page teaches you to read a flame graph correctly: what the two axes mean, why **width is the only signal that matters**, the difference between a function's *own* time and its *total* time, and how to spot the one box actually worth your attention. By the end you'll generate a real one in Go and read it without fooling yourself.

> **The mindset shift:** your eye wants to read a flame graph like a chart — follow the colors, climb to the top, scan left to right in time order. Unlearn all of it. **Read the width. Ignore the color. Ignore the height. Left-to-right is alphabetical, not chronological.** A wide box is expensive; everything else is decoration.

---

## Prerequisites

- **Required:** You can write and run a small program in at least one language (examples use **Go**, with notes for others).
- **Required:** You've used a terminal to run a command and open a file in a browser.
- **Helpful:** You know what a *call stack* is — that `a()` calling `b()` calling `c()` forms a stack of frames. If not, the [CPU Profiling](../01-cpu-profiling/junior.md) page introduces it.
- **Helpful:** You've stared at a profiler's output before and thought "okay, but *where do I look*?" That feeling is exactly what this page fixes.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Sample** | One snapshot of the call stack, taken at a regular interval (e.g. every 10 ms). |
| **Stack / call stack** | The chain of functions currently active: `main → handle → parse`. |
| **Frame** | One function in a stack — drawn as one box in the graph. |
| **Flame graph** | A picture of many stacks merged, where **box width = share of samples**. |
| **Width** | How much of the total time (or samples) a box represents. The signal. |
| **Self time (flat)** | Time spent *inside a function itself*, not in the functions it called. |
| **Total time (cumulative)** | A function's self time **plus** all the time spent in its children. |
| **Hot** | Appears in many samples — i.e. wide. "Hot function" = expensive function. |
| **Plateau** | A wide box, especially near the top — a function doing a lot of real work. |
| **Icicle graph** | A flame graph drawn upside down (root at top). Same rules, flipped. |

---

## Core Concept 1 — What the Axes Actually Mean

A flame graph has two axes, and getting them straight is half the battle.

- **Y-axis (vertical) = stack depth.** The bottom box is where every stack starts (often `main`). Each box sitting *on top of* another box is a function **called by** the box beneath it. Up = deeper into the call chain.
- **X-axis (horizontal) = share of samples (≈ share of time).** A box's **width** is the fraction of all samples in which that function was on the stack. Full screen width = 100% of the captured time. **The x-axis is NOT time order.** It does not run from "start of program" on the left to "end" on the right.

Here is a small one. Read it bottom-up: `main` is always running, so it spans the full width. It split its time between two children, and one of them dominates.

```
   ┌──────────┐
   │ compress │                          ← narrow: a little time here
┌──┴──────────┴───────────────────┐  ┌──┐
│            encode                │  │io│   ← "encode" is WIDE: most time is here
├──────────────────────────────────┴──┤
│                main                  │   ← full width = 100% of samples
└──────────────────────────────────────┘
```

Read it as: `main` ran the whole time (of course — it's the program). Of that time, `encode` took the big slice and `io` took a sliver. Inside `encode`, a small part went to `compress`. The wide box (`encode`) is where the time went.

Notice three things this picture does **not** tell you:

1. **Order in time.** `io` is drawn to the right of `encode`, but that doesn't mean it ran *after* `encode`. Children are usually sorted **alphabetically**, left to right, purely so the same program produces the same-looking graph every run. Left/right carries no meaning.
2. **Anything from the colors.** If this were rendered, `encode` and `io` would be different colors — but the color is just there so adjacent boxes don't blur together. It is (almost always) random.
3. **Anything from the height.** A tall narrow tower is *deep recursion or deep nesting*, not slowness.

> **Key insight:** Two of the three things your eye notices first — **color and horizontal position** — are noise. The third — **height** — tells you call *depth*, not cost. The one dimension that encodes cost is **width**. Train yourself to see width first and treat the rest as decoration.

---

## Core Concept 2 — Width Is the Only Thing That Matters

This is the single rule that makes flame graphs useful. Everything else is a corollary.

**A box's width is proportional to how much time (how many samples) was spent there.** Wide = expensive. Narrow = cheap. That's it.

So your reading procedure is almost embarrassingly simple:

1. Find the **widest** boxes.
2. Among those, find the widest one that is **your code** (not the runtime or a framework).
3. That's your first optimization target. Start there.

Let the corollaries fall out:

- **"It's tall, so it's slow" — false.** A 20-box-high tower that is *one pixel wide* accounts for almost none of your runtime. Deep ≠ slow. Height is call depth. You can have a tower 30 frames tall that the CPU visits 0.1% of the time. Ignore it.
- **"It's red/orange, so it's the problem" — false.** Standard flame graphs use a warm random palette ("flame" colors) purely for contrast. Red is not "hot" and blue is not "cold" unless a *specific tool* says so (some differential graphs do — Concept covered later). Default color = meaningless.
- **"It's on the left, so it ran first" — false.** Left-to-right is alphabetical sorting, not a clock. Two halves of a graph are not "before and after."

A useful sanity check: scan along any single horizontal level. The widths of all boxes at that level should add up to (at most) the width of their shared parent — because together they're slices of the parent's time. If a child looks wider than its parent, you're misreading which box sits on which.

> **Key insight:** The whole skill of reading a flame graph compresses to four words: **wide boxes cost time.** A wide box near the top — a *plateau* — is a function doing real work right where the CPU keeps landing. That plateau, if it's your code, is almost always the thing to fix.

---

## Core Concept 3 — Self Time vs Total Width

Here is the distinction that separates people who read flame graphs correctly from people who waste a day "optimizing `main`."

Every box has two different "amounts of time," and confusing them is the most expensive beginner mistake.

- **Total time (cumulative)** = the box's **full width**. It includes the function itself **and everything it called**. `main` is always 100% wide because *everything* happens inside `main` — but `main` itself does basically nothing; it just calls other things.
- **Self time (flat)** = the work done **inside that function alone**, *not* counting its children. On the graph, a function's self time is the part of its width that has **no box stacked on top of it** — the exposed "tip."

Picture it. `encode` is wide, but most of its width has `compress` and `huffman` stacked on top — meaning `encode` spent that time *waiting on its children*. Only the small exposed sliver of `encode` with nothing above it is `encode`'s own work:

```
        ┌──────────┐┌─────────┐
        │ compress ││ huffman │          ← children of encode (their own work)
┌───────┴──────────┴┴─────────┴──┬──────┐
│            encode               │self! │   ← exposed tip = encode's SELF time
├─────────────────────────────────┴──────┤
│                  main                   │   ← 100% wide, but ~0 self time
└─────────────────────────────────────────┘
```

Why this matters: optimizing a function only helps if it has meaningful **self time**. `main` is 100% wide and 0% useful to optimize — there's nothing *in* `main` to speed up; it just delegates. The real work is in the boxes whose **tips are exposed and wide**: `compress`, `huffman`, and `encode`'s own sliver.

The classic trap: you see `processRequest` is 60% wide and triumphantly decide to optimize it. But if 59% of that width is `database.Query` stacked on top, then `processRequest` itself does almost nothing — the time is in the database call, and *that's* what you'd need to address (cache it, batch it, index it). You'd have spent a day micro-optimizing a function whose own cost was 1%.

> **Key insight:** Width tells you **where the time is**; the **exposed top edge** tells you **whose fault it is**. A wide box with a tall stack on top is a *router* (it spends its time in children — fix the children). A wide box with an exposed flat top is a *worker* (it spends time itself — fix it directly). "`main` is 100% wide" is meaningless precisely because `main` has zero exposed top.

---

## Core Concept 4 — Finding the Thing to Optimize

Put Concepts 2 and 3 together and you get a repeatable procedure. No intuition, no guessing.

**Step 1 — Look only at width.** Squint. Literally. Blur your eyes until colors vanish and only the *shape* remains. The widest regions are where your time lives.

**Step 2 — Find the wide *plateaus*.** A plateau is a wide box with little or nothing stacked on top — it has large self time, so it's doing real work, not delegating. These are your prime suspects. A wide box with a tall tower on top is just passing time down to its children; climb up the tower to find the actual plateau.

**Step 3 — Skip framework and runtime boxes.** You'll often see wide boxes named `runtime.mallocgc`, `runtime.gcBgMarkWorker`, `net/http.(*conn).serve`, `syscall.read`, or `java.util.HashMap.get`. These are the language runtime, the HTTP server, GC, or the standard library. You usually can't (and shouldn't first) rewrite those. **Look for the widest box that is *your* code.** Often the runtime box is a *symptom*: lots of `mallocgc` means *your* code allocates too much — so the fix is in your allocating function, not in the GC.

**Step 4 — Click to zoom.** In an interactive viewer, click a box: it expands to fill the width so you can study its children in detail. This is how you drill into a wide-but-busy subtree without going cross-eyed. Click the root (or press "Reset Zoom") to come back out.

**Step 5 — Form a hypothesis, then confirm with the flat view.** Most tools also offer a sortable **list** ("Top" / "flat" view) ranked by self time. Use the flame graph to *understand the shape* and the list to *confirm the numbers*. They're two views of the same data; agreement between them is your safety check.

A worked example. You profile a service and see this shape:

```
                         ┌──────────────┐
                         │ json.Marshal │            ← WIDE plateau, your call path
┌────────┐ ┌────────────┴──────────────┴──────┐ ┌──┐
│ decode │ │            handleReport            │ │gc│
├────────┴─┴────────────────────────────────────┴─┴──┤
│                       serveHTTP                      │
└──────────────────────────────────────────────────────┘
```

Reading: `serveHTTP` is 100% (it's the server loop — *skip it*, no exposed top). `handleReport` is wide but most of its width is `json.Marshal` stacked on top — so `handleReport` itself is cheap; the time is in `json.Marshal`. `json.Marshal` is a wide plateau and it's effectively *your* cost (you chose to serialize a huge object). **Target: reduce what you're marshalling** — paginate the response, drop unused fields, or cache the serialized blob. The narrow `decode` and `gc` boxes are rounding error; leave them.

> **Key insight:** "What should I optimize?" has a mechanical answer: **the widest plateau that belongs to your code.** Width picks the *region*, the exposed top picks the *function*, and the "is this mine or the runtime's?" filter picks the *target*. You are not looking for the tallest, the reddest, or the leftmost — only the widest-that's-yours.

---

## Core Concept 5 — Generating Your First Flame Graph

Reading beats theory. Go ships a profiler and a built-in flame-graph viewer, so it's the fastest path to a real graph. (Notes for other languages follow.)

**The smallest possible Go example.** Save this as `main.go` — it deliberately wastes CPU in one obvious function so the graph has a clear hot spot:

```go
package main

import (
	"os"
	"runtime/pprof"
)

func slow() int { // the obvious hot spot — lots of self time
	sum := 0
	for i := 0; i < 500_000_000; i++ {
		sum += i % 7
	}
	return sum
}

func main() {
	f, _ := os.Create("cpu.prof")
	pprof.StartCPUProfile(f) // begin sampling the call stack
	defer pprof.StopCPUProfile()

	_ = slow()
}
```

Build, run, and open the flame graph in your browser:

```bash
go run main.go                 # runs the program; writes cpu.prof
go tool pprof -http=:8080 cpu.prof
#  → opens a browser. Choose  View ▸ Flame Graph
```

You'll see `main` along the bottom at full width and a fat `main.slow` plateau filling almost the entire graph — because that's where ~all the CPU went. That fat box *is* the lesson: width = time, and the widest plateau that's your code is exactly what you'd optimize. Hover any box for its exact percentage; click it to zoom.

**The even-faster way (real services).** If your Go program already imports `net/http/pprof`, you don't need to edit code at all — grab a live 30-second profile and view it:

```bash
go tool pprof -http=:8080 'http://localhost:6060/debug/pprof/profile?seconds=30'
#  hit your service with traffic during those 30 seconds, then read the flame graph
```

**Other languages — same picture, different tool:**

```bash
# Rust:    one command, builds + profiles + emits flamegraph.svg
cargo flamegraph

# Linux, any native program: the original toolchain
perf record -g ./myprogram          # record stacks
perf script | stackcollapse-perf.pl | flamegraph.pl > out.svg

# Anything: drop a profile into Speedscope (https://speedscope.app)
#  — a browser flame-graph viewer that reads pprof, perf, Chrome, and more
```

**Speedscope** deserves a special mention: it's a free in-browser viewer where you drag-and-drop a profile file and immediately get a flame graph, with a handy **"Sandwich"** view that lists functions by self time — perfect for the "confirm with the flat view" step from Concept 4. When a tool can export a profile but has no good built-in viewer, Speedscope is the universal fallback.

> **Key insight:** You don't need fancy tooling to start — `go tool pprof -http` is one command and gives you a clickable flame graph in the browser. The fastest way to stop fearing flame graphs is to generate one for code whose hot spot you already *know*, confirm the fat box lands where you expected, and let that calibrate your eye.

---

## Real-World Examples

**1. The "I optimized `main` and nothing got faster" story.** A junior dev profiles a slow CLI, sees `main` is 100% wide, and spends an afternoon "optimizing `main`." Nothing improves — because `main` had ~0 self time; it just called other functions. The wide boxes *stacked on top of* `main` were the real work. Lesson: 100% width on the bottom box is meaningless; look for **exposed plateaus**, not the widest box.

**2. The GC red herring.** A team sees `runtime.mallocgc` and `runtime.gcBgMarkWorker` eating 35% of the graph and concludes "Go's garbage collector is too slow." It wasn't. The GC was busy because *their* `parseLine` function allocated a fresh slice on every one of millions of iterations. The fix wasn't the runtime — it was reusing a buffer in *their* code, which made the wide GC boxes shrink on their own. Lesson: a wide *runtime* box is often a **symptom** of your code's behavior; trace up to find the cause.

**3. The 60% function that did nothing.** An engineer reports "`handleRequest` is 60% of CPU, let's rewrite it." On closer reading, 58 of those 60 points were `db.Query` stacked on top — the actual cost was an un-indexed database call. Rewriting `handleRequest` would have saved 2%. Adding an index cut the whole 58%. Lesson: **total width** (`handleRequest`'s 60%) is not **self time**; the exposed top edge told the real story.

---

## Mental Models

- **A flame graph is a population census, not a timeline.** Each sample is one "person" reporting which function they were standing in. A wide box just means *lots of people were standing there* — it says nothing about *when*. Stop reading it left-to-right like a movie.

- **Width = the bill; the exposed top = who ordered it.** A wide box tells you a lot of money was spent in that subtree. The part of the box with nothing on top tells you the function *itself* spent it, rather than passing the tab to a child. Optimize the orderer, not the waiter who relayed the order.

- **Plateaus, not peaks.** Your eye is drawn to tall peaks (deep stacks). Flip it: hunt for wide *plateaus* — broad flat tops. A plateau is a function genuinely grinding on real work. A peak is just a deep call chain that may cost almost nothing.

- **Color is wallpaper.** Unless a tool explicitly defines a color meaning (e.g. red = "got slower" in a differential graph), treat color exactly like wallpaper: it makes the room look nice and tells you nothing about the plumbing.

---

## Common Mistakes

1. **"It's tall, so it's slow."** Height is **call depth**, not cost. A 25-frame-tall tower one pixel wide is ~0% of your runtime. Read width; a deep narrow tower is almost always irrelevant.

2. **Reading the colors.** Default flame-graph colors are random warm tones chosen for contrast. Red is not "hot," blue is not "cold." Color means nothing unless the specific tool documents that it does.

3. **Reading left-to-right as time order.** Boxes are sorted **alphabetically**, not chronologically. The left half is not "earlier" and the right half is not "later." There is no time axis.

4. **Confusing total width with self time.** A function being 60% wide does **not** mean it's worth optimizing. If its width is mostly children stacked on top, *it* costs almost nothing — fix the children. Look for the **exposed top edge**.

5. **"Optimize the widest box."** The widest box is usually `main` / `serveHTTP` / the event loop — pure delegation, zero self time, nothing to optimize. Find the widest box **with an exposed top that is your code**.

6. **Blaming the runtime.** Wide `mallocgc`, GC, or `syscall` boxes are frequently *symptoms* of your code (too many allocations, too many tiny reads). Trace **up** from the runtime box to the application function causing it, and fix that.

7. **Profiling a toy load.** A flame graph only reflects the work you actually exercised. Profiling an idle server or a trivial input produces a graph that looks nothing like production. Capture under realistic load (e.g. the 30-second live profile), or you'll optimize the wrong plateau.

---

## Test Yourself

1. What does the **width** of a box represent? What does the **height** (its position up the stack) represent?
2. Is the x-axis a timeline? If `io` is drawn to the right of `encode`, did `io` run after `encode`? Why or why not?
3. In a default flame graph, what does a **red** box mean?
4. `main` is 100% wide. Why is it almost always pointless to "optimize `main`"?
5. Define **self time** vs **total time**. On the graph, how do you spot a function's self time by eye?
6. You see `runtime.mallocgc` taking 30% of the width. Should you go rewrite the garbage collector? What should you actually do?
7. Write the one command that opens a Go CPU profile (`cpu.prof`) as a flame graph in your browser.

<details>
<summary>Answers</summary>

1. **Width** = the share of samples/time spent with that function on the stack (i.e. cost). **Height/position** = stack depth — a box sits on top of the function that called it. Width = cost; height = call depth.
2. **No, it is not a timeline.** `io` being to the right of `encode` means nothing about order — children are sorted **alphabetically** for a stable layout. There is no time axis; left/right is not before/after.
3. **Nothing.** Default colors are random warm tones for visual contrast only. Color carries no meaning unless the specific tool defines one (e.g. a differential graph).
4. Because `main` has ~0 **self time** — it's 100% wide only because *everything* runs inside it, but it just delegates to other functions. There's nothing *in* `main` to speed up; the real work is in the boxes stacked on top of it.
5. **Self time** = work done inside the function alone, excluding its children. **Total time** = self time **plus** all children (the box's full width). By eye, self time is the part of the box with **nothing stacked on top of it** — the exposed top edge.
6. **No.** A wide `mallocgc` box is usually a **symptom** of *your* code allocating too much. Trace up to the application function doing the allocating and reduce allocations there (reuse buffers, avoid per-iteration allocations); the GC box shrinks on its own.
7. `go tool pprof -http=:8080 cpu.prof` (then choose **View ▸ Flame Graph**).

</details>

---

## Cheat Sheet

```
THE AXES
  Y (vertical)   = stack depth. Box on top is CALLED BY the box below.
  X (horizontal) = share of samples ≈ share of TIME.  NOT a timeline.

THE ONE RULE
  WIDTH = cost.  Wide = expensive, narrow = cheap.  Read width first.

WHAT TO IGNORE
  color    → random contrast, meaningless by default
  height   → call DEPTH, not cost ("tall ≠ slow")
  left↔right→ ALPHABETICAL order, not chronological

SELF vs TOTAL
  total time = box's FULL width  (function + all its children)
  self time  = the EXPOSED TOP edge (work done in the function itself)
  "main is 100% wide" = meaningless (0 self time, pure delegation)

FIND THE TARGET (in order)
  1. squint → find the widest regions
  2. find wide PLATEAUS (wide box, little stacked on top = real work)
  3. skip runtime/framework boxes (mallocgc, gc, serveHTTP, syscall)
  4. pick the widest plateau that is YOUR code
  5. click to zoom in; confirm numbers in the flat/Top list

GENERATE ONE
  Go:    go tool pprof -http=:8080 cpu.prof        # View ▸ Flame Graph
  Go live: go tool pprof -http=:8080 'http://host:6060/debug/pprof/profile?seconds=30'
  Rust:  cargo flamegraph                          # → flamegraph.svg
  perf:  perf record -g ./prog; perf script | stackcollapse-perf.pl | flamegraph.pl > out.svg
  Any:   drag a profile into https://speedscope.app  (Sandwich view = self time)
```

---

## Summary

- A **flame graph** turns thousands of stack **samples** into one readable picture. **Y-axis = stack depth** (a box is called by the box beneath it); **x-axis = share of time**, and it is **not a timeline**.
- **Width is the only thing that matters.** Wide = expensive. **Color is random** (ignore it), **height is call depth** not cost (ignore "it's tall so it's slow"), and **left-to-right is alphabetical** not chronological (ignore order).
- **Self time vs total time** is the make-or-break distinction. A box's **full width** is *total* (it + all children); the **exposed top edge** is *self* (its own work). "`main` is 100% wide" is meaningless because `main` has zero self time — it only delegates.
- To find what to optimize: **the widest plateau that is your own code.** Skip runtime/framework boxes; a wide `mallocgc` is usually a *symptom* of your allocations, not the GC's fault.
- Generate one in one command — `go tool pprof -http=:8080 cpu.prof` — or drop any profile into **Speedscope**. Calibrate your eye on code whose hot spot you already know.

You can now read a flame graph without lying to yourself: width over color, plateaus over peaks, self time over total. The next pages turn that reading skill into action — capturing good profiles ([CPU Profiling](../01-cpu-profiling/junior.md)), reading allocation flame graphs ([Allocation Profiling](../03-allocation-profiling/junior.md)), and the richer variants (differential and off-CPU graphs) in [Flame Graphs — Middle](middle.md).

---

## Further Reading

- [Brendan Gregg — Flame Graphs](https://www.brendangregg.com/flamegraphs.html) — the canonical resource from the person who invented them. Bookmark it.
- [Speedscope](https://speedscope.app) — drag-and-drop, in-browser flame-graph viewer; reads pprof, `perf`, Chrome, and more. The universal fallback viewer.
- [Go Blog — Profiling Go Programs](https://go.dev/blog/pprof) — the official walkthrough of `pprof`, including the flame-graph view.
- [`flamegraph-rs/flamegraph`](https://github.com/flamegraph-rs/flamegraph) — `cargo flamegraph`: one command from Rust source to an SVG flame graph.
- The [middle.md](middle.md) of this topic — differential flame graphs (before/after), off-CPU flame graphs (what's *blocking*), and icicle layouts.

---

## Related Topics

- [01 — CPU Profiling](../01-cpu-profiling/junior.md) — how to *capture* the CPU profile that a flame graph visualizes.
- [03 — Allocation Profiling](../03-allocation-profiling/junior.md) — the same picture, but width = bytes/objects allocated instead of CPU time.
- [Flame Graphs — Middle](middle.md) — differential and off-CPU flame graphs, icicle layouts, and reading cumulative vs flat at scale.
