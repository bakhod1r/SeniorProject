# Dependency Graphs — Junior Level

> **Roadmap:** [Build Systems](../README.md) → Dependency Graphs
> *A build is not a to-do list you run top to bottom. It's a web of "this needs that" — and once you can see the web, you understand why a one-line change sometimes rebuilds everything and sometimes rebuilds nothing.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — A Build Is a Graph, Not a List](#core-concept-1--a-build-is-a-graph-not-a-list)
5. [Core Concept 2 — Nodes, Edges, and the DAG](#core-concept-2--nodes-edges-and-the-dag)
6. [Core Concept 3 — Topological Order: a Valid Build Schedule](#core-concept-3--topological-order-a-valid-build-schedule)
7. [Core Concept 4 — Incremental Rebuilds: Only Redo What's Affected](#core-concept-4--incremental-rebuilds-only-redo-whats-affected)
8. [Core Concept 5 — How the Build Knows What Changed](#core-concept-5--how-the-build-knows-what-changed)
9. [Core Concept 6 — The Diamond and Why Cycles Are Illegal](#core-concept-6--the-diamond-and-why-cycles-are-illegal)
10. [Real-World Examples](#real-world-examples)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Why does a build behave like a web of dependencies instead of a straight line?**

In [Build Fundamentals](../01-build-fundamentals/junior.md) you learned that compilation is split per file so the build can recompile only what changed. This page is about the *map* that makes that possible: the **dependency graph**.

Here's the puzzle that the graph explains. You change one comment in one file and `make` rebuilds *half the project*. The next time you change a different file and it rebuilds *one thing in two seconds*. Same command, wildly different behaviour. It isn't random and it isn't a bug — the build system is reading a map of what-depends-on-what and rebuilding exactly the things downstream of your change.

Once you can picture that map — boxes for the things being built, arrows for "needs," and the rule that the arrows can never form a loop — almost every confusing build behaviour becomes predictable. You'll know *before you run it* roughly how much will rebuild, and *why* a missing arrow on the map is the reason your program runs old code even though you "definitely rebuilt it."

> **The mindset shift:** stop reading a build as "do step 1, then step 2, then step 3." Start reading it as "here are the things that must exist, here's what each one needs first, now figure out a safe order." The build system does that figuring-out for you — but only if the map is correct.

---

## Prerequisites

- **Required:** You've read [Build Fundamentals — junior](../01-build-fundamentals/junior.md): you know compile vs link and what an object file is.
- **Required:** You can write and run a multi-file program in some compiled language (examples use **C**).
- **Helpful:** You've run `make` at least once, even if you didn't understand the `Makefile`.
- **Helpful:** You've been surprised by a build rebuilding "too much" or "too little."

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Target** | A thing the build produces or aims to produce (an object file, a binary, a test result). |
| **Dependency / prerequisite** | Something a target *needs to exist first* before it can be built. |
| **Node** | One box in the graph — usually one target. |
| **Edge** | One arrow — "this target depends on that one." |
| **Graph** | The whole picture: all the boxes and arrows together. |
| **DAG** | *Directed Acyclic Graph* — a graph where arrows have a direction and never form a loop. A build graph is always a DAG. |
| **Topological order** | A safe build order: build a thing only *after* everything it depends on. |
| **Incremental build** | Rebuilding only the parts affected by a change, reusing the rest. |
| **Stale** | An output that's out of date — older than something it depends on, but not rebuilt. |
| **Downstream / dependents** | The things that depend *on* a given node (they're affected when it changes). |
| **Upstream / dependencies** | The things a given node depends *on*. |

---

## Core Concept 1 — A Build Is a Graph, Not a List

Imagine a small program made of three source files: `main.c`, `parse.c`, and `util.c`. To produce the final program `app`, the build must:

- compile each `.c` into a `.o` (`main.o`, `parse.o`, `util.o`)
- link the three `.o` files into `app`

If you wrote that as a flat list of commands, you'd have to *manually* pick an order, and you'd have to *manually* decide which steps to skip when only one file changed. That doesn't scale and it's error-prone.

Instead, the build system thinks of it as a picture of dependencies:

```
        main.o ──┐
                 │
       parse.o ──┼──►  app          (app NEEDS all three .o files)
                 │
        util.o ──┘

  main.c ──► main.o                  (main.o NEEDS main.c)
  parse.c ──► parse.o
  util.c ──► util.o
```

Read each arrow as **"needs"**: `app` needs `main.o`, `parse.o`, `util.o`; `main.o` needs `main.c`; and so on. Put it all together:

```
  main.c ──► main.o ──┐
  parse.c ─► parse.o ─┼──► app
  util.c ──► util.o ──┘
```

This picture is the **dependency graph**. The build system builds the graph *first*, in its head, before running a single command. Everything else — what order to build in, what to skip, what to do in parallel — is just *reading this picture correctly*.

> **Key insight:** the order of lines in a `Makefile` doesn't decide the build order. The *arrows* do. The build system reads the graph and figures out an order that respects every "needs." This is the single biggest difference between a build system and a shell script: a script runs commands in the order you wrote them; a build system runs them in the order the *graph* demands.

---

## Core Concept 2 — Nodes, Edges, and the DAG

Three words make the picture precise.

- **Node** — a box. Usually a file the build produces or consumes: `main.c`, `main.o`, `app`.
- **Edge** — an arrow. `main.o → main.c` means "to build `main.o`, you first need `main.c`."
- **Directed** — the arrows point one way. "`app` needs `main.o`" is *not* the same as "`main.o` needs `app`." Dependencies have a direction.

Put together, the build graph is a **DAG: Directed Acyclic Graph**. Let's unpack the name:

- **Directed** — arrows have a direction (needs → needed).
- **Acyclic** — *no loops*. You can never follow the arrows and end up back where you started.
- **Graph** — boxes connected by arrows.

Why must it be *acyclic*? Because a loop would mean "A needs B, and B needs A." To build A you'd first need B; to build B you'd first need A. Neither can ever go first. The build is stuck forever. We'll come back to this in [Core Concept 6](#core-concept-6--the-diamond-and-why-cycles-are-illegal).

A couple of useful directions to name:

- **Upstream / dependencies:** what a node *points to* — what it needs. `app`'s upstream is the three `.o` files.
- **Downstream / dependents:** what *points to* a node — who needs it. `main.c`'s downstream is `main.o`, and through it, `app`.

```
   upstream (needed first)            downstream (affected by a change)
        main.c   ─────────────────►   main.o   ─────────────────►   app
        ^ if you build this, you      ^ this must be rebuilt        ^ and so must this
          don't need anything           when main.c changes
```

Knowing which direction is which is the whole game. "What do I need to build first?" → follow arrows *upstream*. "What breaks / must rebuild if I change this?" → follow arrows *downstream*.

---

## Core Concept 3 — Topological Order: a Valid Build Schedule

Given the graph, the build system needs a **build order**: a sequence in which every node is built *only after* everything it depends on. That ordering is called a **topological order** (or *topological sort*).

The rule is simple: **a node can only be built once all of its dependencies are already built.** Leaves first (source files, which depend on nothing), then the things that depend on them, then the things that depend on *those*, all the way up to the final program.

For our example:

```
  main.c   parse.c   util.c       ← level 0: source files, depend on nothing
     │        │         │
     ▼        ▼         ▼
  main.o   parse.o   util.o        ← level 1: each needs only its own .c
     └────────┼─────────┘
              ▼
             app                   ← level 2: needs all three .o files
```

A valid order is: build the three `.o` files (in any order — they don't depend on each other), then build `app`. Examples of valid orders:

```
main.o, parse.o, util.o, app        ✓
util.o, main.o, parse.o, app        ✓   (the three .o can go in any order)
app, main.o, ...                    ✗   (app built before its .o files exist — illegal)
```

There can be **many** valid topological orders, because nodes that don't depend on each other (`main.o`, `parse.o`, `util.o`) can go in any relative order. That freedom is important — it's exactly what lets the build do several of them **at the same time** (parallelism), which you'll meet in [middle.md](middle.md).

> **Key insight:** there's usually no single "correct" order — only orders that are *valid* (respect every dependency) and orders that are *invalid*. The build system's job is to produce *some* valid order. The "many valid orders" property is not a detail; it's the basis for speed, because independent nodes can run in parallel.

---

## Core Concept 4 — Incremental Rebuilds: Only Redo What's Affected

Here's the payoff. Because the build system has the graph, it doesn't have to rebuild everything every time. When a file changes, it rebuilds **only that file's downstream** — the nodes you reach by following arrows *out* from the change — and reuses everything else.

Change `parse.c`. Follow the arrows downstream:

```
  parse.c  ✎ (changed)
     │
     ▼
  parse.o  ← must rebuild (it depends on parse.c)
     │
     ▼
   app     ← must rebuild (it depends on parse.o)
```

`main.o` and `util.o`? **Untouched.** Nothing they depend on changed, so their existing output is still valid. The build reuses them as-is. So the rebuild after editing `parse.c` is: recompile `parse.o`, relink `app`. Two steps, not four.

Now change `util.c` instead:

```
  util.c ✎ → util.o (rebuild) → app (rebuild)
  main.o, parse.o : reused
```

And if you change `main.c`, `parse.c`, **and** `util.c` all at once, then all three `.o` files are downstream of a change, so all three recompile and `app` relinks — the full build. That's why "I changed one tiny thing" can rebuild a lot or a little: it depends entirely on **how much sits downstream of what you touched**.

This is the core promise of a build system: **never redo work whose inputs didn't change.** The graph is what makes it safe to skip the rest.

> **Why this is the whole point:** without the graph you have two bad options — rebuild *everything* every time (correct but painfully slow) or rebuild by hand (fast but you'll forget something and ship stale output). The dependency graph gives you the best of both: rebuild the minimum, and rebuild it *correctly*, automatically.

---

## Core Concept 5 — How the Build Knows What Changed

The graph tells the build *what depends on what*. But to do an incremental build, it also needs to answer a second question: **did this input actually change?** There are two common strategies, and the difference matters.

**Strategy 1 — Timestamps (what `make` uses).** Every file has a "last modified" time. The rule: *a target is out of date if any of its dependencies is **newer** than the target itself.*

```
  parse.c   modified at 10:05   ← newer
  parse.o   modified at 10:00   ← older  →  parse.o is STALE, rebuild it
```

After rebuilding `parse.o`, its timestamp becomes "now," which is newer than `parse.c`, so it's considered up to date again. This is cheap (just compare two numbers) and it's what `make` has done for decades.

**Strategy 2 — Content hashes (what Bazel and others use).** Instead of "when was it last touched," ask "*what is its content*?" Take a fingerprint (a hash) of the file's contents. If the fingerprint is the same as last time, the content is identical — even if the timestamp changed — so **don't rebuild.**

```
  parse.c   hash abc123  (same as last build)  →  no rebuild, content is identical
  parse.c   hash def456  (different)            →  content changed, rebuild
```

Why does the difference matter? Two everyday situations:

- You `touch parse.c` (update its timestamp without changing a byte). **Timestamps say "rebuild"** — the file looks newer. **Hashes say "skip"** — the content is unchanged. Hashing avoids a pointless rebuild.
- You edit a file, then undo the edit so it's byte-for-byte what it was. **Timestamps say "rebuild" forever** (the timestamp moved). **Hashes say "skip"** the moment the content matches a previous build.

For now, the takeaway is just this: **"changed" can mean "newer timestamp" or "different contents," and which definition your build uses explains a lot of its behaviour.** The middle and senior pages go deep on the trade-offs.

> **Key insight:** the graph answers *what's connected*; the change-detection strategy answers *what's dirty*. You need both to do a correct incremental build. A build that gets the graph right but mis-detects changes will either rebuild too much (wasting time) or too little (shipping stale output).

---

## Core Concept 6 — The Diamond and Why Cycles Are Illegal

Two shapes show up constantly. Knowing them by name makes graphs easy to reason about.

**The diamond.** Suppose `D` depends on both `B` and `C`, and *both* `B` and `C` depend on `A`:

```
        A
       / \
      B   C
       \ /
        D
```

`A` has **two paths** to `D` (via `B` and via `C`). A naive builder might build `A` *twice* — once for B's sake, once for C's. A real build system is smarter: it builds **each node exactly once**, no matter how many things depend on it. When it's time to build `B`, it builds `A` (if not already built). When it's time to build `C`, `A` is already done, so it's reused. `A` is built **once**; `D` waits for both `B` and `C`.

This "shared dependency, built once" pattern is the **diamond problem**, and "build each node exactly once" is the rule that solves it. It's everywhere: a logging library used by ten modules is compiled once, not ten times.

**The cycle (illegal).** Now suppose someone wires up `A → B → C → A`:

```
      A ──► B
      ▲     │
      │     ▼
      └───  C
```

To build `A` you need `B`. To build `B` you need `C`. To build `C` you need `A`. To build `A` you need `B`… There is **no node you can start with**, because every node is waiting on another. There's no valid topological order. The build can't even begin.

That's why **cycles are illegal** in a build graph, and why build tools *detect* them and refuse to run:

```bash
make
# make: Circular A <- C dependency dropped.
```

A cycle in your build graph almost always means a *design* mistake — two things that genuinely need each other should probably be one thing, or the dependency between them should only go one way. The error is the build system telling you your "needs" arrows formed a loop, and loops can't be scheduled.

> **Key insight:** the diamond is *fine and common* (a shared dependency, built once); the cycle is *fatal and forbidden* (no valid order exists). The word "acyclic" in DAG is not academic pedantry — it's the precise property that guarantees a build order can always be found.

---

## Real-World Examples

**1. The "why did changing a comment rebuild everything?" mystery.** A junior edits a comment in `config.h`, a header included by nearly every `.c` file. Every file that includes it is *downstream* of the change, so every one recompiles. The comment changed nothing meaningful — but the build, using timestamps, sees the header as newer than every object that depends on it, and faithfully rebuilds them all. The graph behaved perfectly; the *header* was just connected to everything. (This is the file/header dependency problem, covered in [middle.md](middle.md).)

**2. The "I rebuilt but it's still running old code" trap.** Someone adds a `#include "newfeature.h"` to `main.c` but the build's graph doesn't know `main.o` now depends on `newfeature.h`. They edit `newfeature.h`, rebuild, and the bug persists — because the build never learned about that arrow, so it never marked `main.o` as needing a rebuild. A **missing edge** produces a **stale build**. The fix is making the build track header dependencies correctly.

**3. The shared library built once.** A project has a `libcommon` used by `service-a`, `service-b`, and the test suite — a textbook diamond. The build compiles `libcommon` a single time and hands the same artifact to all three consumers. Without the "build each node once" rule, it'd compile the same library three times and the build would be three times slower for no reason.

---

## Mental Models

- **The graph is a recipe's dependency map.** You can't ice a cake before you bake it; you can't bake it before you mix the batter. The arrows say "needs first." Topological order is *a valid cooking order*. Independent steps (boil water, preheat oven) can happen at the same time — that's parallelism.

- **Incremental build = "what's downstream of the splash?"** Drop a pebble (a change) into the graph. The ripples travel *downstream*, along the arrows out of the changed node. Everything the ripple touches must rebuild; everything it doesn't touch is reused.

- **Timestamps answer "newer?", hashes answer "different?"** A timestamp build asks "is the source newer than the output?" A hash build asks "is the content actually different from last time?" Same goal (find what's dirty), different question — and the difference shows up the moment you `touch` a file.

- **A cycle is a circular IOU.** A owes B, B owes C, C owes A. Nobody can pay first because everyone's waiting on someone else. The only fix is to break the loop — make at least one of those debts go away.

---

## Common Mistakes

1. **Thinking the `Makefile` runs top-to-bottom like a script.** It doesn't. The build reads the *graph* of dependencies and picks a valid order. Reordering rules in the file usually changes nothing about what runs.

2. **Forgetting to declare a dependency (a missing edge).** If `main.o` really uses `newfeature.h` but the build doesn't know it, editing the header won't trigger a rebuild — and you'll run stale code. Missing edges are the #1 cause of "I rebuilt but nothing changed."

3. **Adding too many dependencies (extra edges).** The opposite error: declaring that everything depends on everything. It's "safe" (you'll never be stale) but it rebuilds far too much, so every change feels like a full rebuild.

4. **Expecting a one-line change to rebuild one thing.** How much rebuilds depends on how much is *downstream* of what you touched. Edit a leaf with few dependents → tiny rebuild. Edit a header everything includes → huge rebuild. Both are correct.

5. **Creating a cycle and being confused by "circular dependency."** If two targets need each other, there's no valid order. The build refuses. The fix is to break the loop, not to fight the build tool.

6. **Trusting `touch` to "force" exactly what you expect.** On a timestamp build, `touch`ing a file marks it (and its downstream) for rebuild even though the content is identical — handy sometimes, surprising other times.

---

## Test Yourself

1. In one sentence, what does an *edge* (arrow) in a build dependency graph mean?
2. What does "DAG" stand for, and why must a build graph be *acyclic*?
3. You change `util.c`. Using the graph in this page, exactly which targets get rebuilt and which are reused?
4. Name two reasons a one-line change might rebuild a *lot* of the project.
5. A build uses timestamps. You run `touch main.c` without editing it. What happens, and would a content-hash build do the same?
6. `D` depends on `B` and `C`; both depend on `A`. How many times is `A` built, and what is that shape called?
7. You added `#include "log.h"` to `parse.c`, edited `log.h`, rebuilt — and the old behaviour persists. What's the most likely cause?

<details>
<summary>Answers</summary>

1. An arrow `X → Y` means **"X needs Y first"** — Y is a dependency (prerequisite) of X, and X must be built only after Y exists/is up to date.
2. **Directed Acyclic Graph.** It must be acyclic because a cycle ("A needs B, B needs A") has *no valid starting point* — no topological order exists, so the build can never begin.
3. `util.c → util.o → app`. So **`util.o` and `app` rebuild**; **`main.o` and `parse.o` are reused** (nothing they depend on changed).
4. (a) You changed something with **many downstream dependents** — e.g. a widely-included header, so every file that includes it recompiles. (b) You changed **several files at once**, so multiple branches of the graph are dirty.
5. Timestamps make `main.c` look **newer** than `main.o`, so `main.o` (and its downstream) rebuild even though no byte changed. A **content-hash build would skip it** — the contents are identical, so the fingerprint matches and nothing is dirty.
6. **`A` is built exactly once** (reused for whichever of `B`/`C` is built second). The shape is the **diamond**.
7. A **missing edge**: the build's graph doesn't record that `parse.o` depends on `log.h`, so editing `log.h` never marks `parse.o` (or `app`) as stale. You need correct header-dependency tracking.

</details>

---

## Cheat Sheet

```
THE GRAPH
  node  = a thing the build produces/uses (main.c, main.o, app)
  edge  = "X needs Y"   (arrow points to the dependency)
  DAG   = Directed Acyclic Graph: arrows have direction, never loop

DIRECTIONS
  upstream   = what a node NEEDS        → follow to build first
  downstream = what NEEDS a node        → follow to find what rebuilds

BUILD ORDER
  topological order = build a node only AFTER all its dependencies
  many valid orders exist → independent nodes can run in parallel

INCREMENTAL REBUILD
  change a file → rebuild only its DOWNSTREAM, reuse everything else
  small change ≠ small rebuild: depends on how much is downstream

CHANGE DETECTION
  timestamps : dep NEWER than target?      (make)   cheap; touch triggers rebuild
  hashes     : content DIFFERENT?          (bazel)  skips touch/undo no-op rebuilds

TWO SHAPES
  diamond  A←B, A←C, D←B, D←C   → A built ONCE   (fine, common)
  cycle    A→B→C→A              → NO valid order (illegal, build refuses)

FAILURE MODES
  missing edge → STALE build (rebuilt too little; runs old code)
  extra  edge  → WASTED work (rebuilt too much)
```

---

## Summary

- A build is a **dependency graph**, not a linear script. **Nodes** are the things being built; **edges** ("needs" arrows) connect a target to its dependencies. The build reads this graph *first*, then decides what to do.
- The graph is always a **DAG** — *Directed Acyclic Graph*. Directed because dependencies point one way; acyclic because a loop has no valid starting point.
- A **topological order** is any build order that builds each node only after its dependencies. Many valid orders exist, which is what makes parallelism possible.
- An **incremental rebuild** rebuilds only what's **downstream** of a change and reuses everything else. How much rebuilds depends entirely on how much sits downstream of what you touched.
- To know what's dirty, builds use **timestamps** ("is a dependency newer?", like `make`) or **content hashes** ("is the content different?", like Bazel). The choice explains a lot of behaviour, including how `touch` is treated.
- The **diamond** (a shared dependency built exactly once) is common and fine. A **cycle** is illegal — no order exists — so build tools detect and reject it.
- **Missing edges** cause stale builds (you run old code); **extra edges** cause wasted rebuilds. A correct graph is the difference between fast *and* trustworthy.

Next: [middle.md](middle.md) makes this formal — how `make` actually computes the graph from rules, how headers get tracked automatically, and how independent nodes run in parallel.

---

## Further Reading

- *Managing Projects with GNU Make* (Robert Mecklenburg) — Chapters 1–2 introduce dependency rules and the graph model in plain terms.
- [GNU Make manual — "How Make Works"](https://www.gnu.org/software/make/manual/html_node/How-Make-Works.html) — the official, short explanation of prerequisites and rebuild decisions.
- *Build Systems à la Carte* (Mokhov, Mitchell, Peyton Jones) — academic but the introduction's graph framing is the clearest in the field; skim section 1.
- The [middle.md](middle.md) of this topic — formal topological sort, header tracking, and parallel scheduling.

---

## Related Topics

- [01 — Build Fundamentals](../01-build-fundamentals/junior.md) — *why* compilation is split per file (the reason the graph has separate `.o` nodes).
- [03 — Make and Descendants](../03-make-and-descendants/junior.md) — the tool that popularized timestamp-based graph builds.
- [07 — Build Caching](../07-build-caching/junior.md) — reusing build outputs *across* machines, the next step beyond incremental.
- [10 — Build Performance](../10-build-performance/junior.md) — making the graph build fast (parallelism, avoiding wasted work).
