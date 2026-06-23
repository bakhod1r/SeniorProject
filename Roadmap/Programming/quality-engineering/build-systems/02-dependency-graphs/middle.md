# Dependency Graphs — Middle Level

> **Roadmap:** [Build Systems](../README.md) → Dependency Graphs
> *The junior page drew the graph. This page builds the machinery: how `make` derives the graph from rules, how headers get tracked automatically, why timestamps lie, and how independent nodes run in parallel along the critical path.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Formalizing the DAG and Topological Sort](#formalizing-the-dag-and-topological-sort)
4. [How Make Computes the Graph from Rules](#how-make-computes-the-graph-from-rules)
5. [The Header-Dependency Problem and How to Solve It](#the-header-dependency-problem-and-how-to-solve-it)
6. [Why Timestamps Lie — Clock Skew, touch, and Friends](#why-timestamps-lie--clock-skew-touch-and-friends)
7. [Content Hashes as the Alternative](#content-hashes-as-the-alternative)
8. [Parallel Scheduling and the Critical Path](#parallel-scheduling-and-the-critical-path)
9. [Correctly vs Incorrectly Specified Dependencies](#correctly-vs-incorrectly-specified-dependencies)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **How is the graph actually computed, and what makes incremental rebuilds correct (or wrong)?**

At the junior level the graph was a hand-drawn picture and "the build figures out an order." That's true but it skips every part that bites you in practice: *Where does the graph come from?* (You never drew it — `make` derived it.) *How does it know `main.o` depends on `config.h`* when nothing in your `Makefile` says so? *Why does a build pass on your laptop and rebuild-everything on the CI machine?*

This page answers those by getting precise. We'll define the DAG and topological sort formally, trace exactly how `make` turns rules into a graph and decides what's stale, fix the header-dependency hole with real compiler flags (`-MMD -MP`), expose the ways timestamps mislead you, contrast that with content-hash builds, and show how the graph's shape sets a hard floor on build time via the **critical path**.

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md): nodes, edges, DAG, topological order, incremental rebuild, timestamps vs hashes, diamond, cycle.
- **Required:** Comfortable reading a basic `Makefile` and running `make`.
- **Helpful:** You've used `gcc`/`clang` from the command line and seen `#include`.
- **Helpful:** A rough sense of multi-core parallelism (`make -j`).

---

## Formalizing the DAG and Topological Sort

A build graph is a directed graph **G = (V, E)** where:

- **V** (vertices/nodes) = the build targets and source files.
- **E** (edges) = ordered pairs. We'll write an edge as `target → prerequisite` ("target *needs* prerequisite"). Some tools draw the arrow the other way; pick one and be consistent. Here, **arrows point from a thing to what it depends on.**

The graph must be **acyclic**: following edges can never return to the start. The formal reason is a theorem:

> **A directed graph has a valid topological ordering if and only if it is acyclic.**

A **topological ordering** is a linear sequence of all nodes such that for every edge `u → v`, `v` appears *before* `u` in the sequence (every dependency comes before the thing that needs it). Two classic algorithms compute one:

- **Kahn's algorithm** — repeatedly emit any node with no unbuilt dependencies (in-degree zero in the "needs" sense), remove it, repeat. If you get stuck with nodes remaining, those nodes form a **cycle** — this *is* the cycle-detection mechanism.
- **DFS-based** — depth-first search, emitting each node *after* all its dependencies; a back-edge encountered during the DFS signals a cycle.

Two graph terms you'll use constantly:

- **Fan-out** of a node = how many things *depend on it* (its out-degree in the dependents direction). A header included by 200 files has fan-out 200 — change it and 200 things rebuild.
- **Fan-in** of a node = how many things *it depends on*. The final link step has high fan-in (it needs every `.o`).

```
   high fan-out (change → many rebuild)        high fan-in (waits for many)
        config.h ──► a.o                              a.o ──┐
                ──► b.o                                b.o ──┼──► app
                ──► c.o ... (×200)                     c.o ──┘
```

Build systems run a topological sort *every invocation* to (a) detect cycles and (b) produce a legal schedule. Modern tools don't materialize a full linear list — they walk the graph on demand — but the guarantee is identical: nothing is built before its prerequisites.

---

## How Make Computes the Graph from Rules

You never hand `make` a graph. You hand it **rules**, and `make` *derives* the graph by connecting each rule's target to its prerequisites.

A rule is `target: prerequisites` followed by a recipe (tab-indented commands):

```makefile
app: main.o parse.o util.o          # app NEEDS these three (3 edges)
	gcc main.o parse.o util.o -o app

main.o: main.c                      # main.o NEEDS main.c (1 edge)
	gcc -c main.c -o main.o

parse.o: parse.c
	gcc -c parse.c -o parse.o

util.o: util.c
	gcc -c util.c -o util.o
```

When you run `make app`, `make`:

1. **Builds the graph** by linking each target to its prerequisites — that colon-separated list on the left/right is literally the edge list.
2. **Walks it depth-first from the goal** (`app`), recursing into prerequisites before the target — a topological traversal.
3. **Decides staleness per node** using its rule: *a target is out of date if it doesn't exist, or if any prerequisite is **newer** (by mtime) than the target.* This is `make`'s entire change-detection model.
4. **Runs the recipe** only for stale targets, in dependency order.

So the rebuild decision at each node is one comparison:

```
  for target T with prerequisites P1, P2, ...:
      if T missing  OR  any Pi.mtime > T.mtime:
          run T's recipe       (T becomes "now", newer than its prereqs)
      else:
          skip                 (T is up to date)
```

**Pattern rules** (`%.o: %.c`) and automatic variables (`$@` = target, `$<` = first prerequisite, `$^` = all prerequisites) let you avoid writing one rule per file:

```makefile
%.o: %.c
	gcc -c $< -o $@          # $< = the .c, $@ = the .o
```

This generates the same per-file edges, derived on demand. The graph is implicit in the rule *patterns*; `make` instantiates it as it walks.

> **Key insight:** the colon in a `make` rule *is* an edge declaration. `make` is a graph engine whose graph you describe declaratively (targets and their prerequisites) rather than imperatively (a list of commands). Everything `make` does is "topologically walk this derived graph, and at each node compare mtimes."

---

## The Header-Dependency Problem and How to Solve It

Look again at the rule:

```makefile
main.o: main.c
	gcc -c main.c -o main.o
```

It says `main.o` depends on `main.c`. But `main.c` does `#include "config.h"` — so `main.o` *truly* depends on `config.h` too. **Nothing in the rule records that edge.** Edit `config.h`, run `make`, and `make` sees `main.c` unchanged, so it **does not rebuild `main.o`** → you run stale code. This is the single most important correctness hole in naive `make`: the graph is *missing edges* for headers.

You could write them by hand:

```makefile
main.o: main.c config.h types.h    # tedious, and WRONG the moment includes change
```

Nobody maintains that correctly. The robust solution is to make the **compiler** tell you the real dependencies — it already parses every `#include`, so it knows them exactly. GCC/Clang emit them with `-M` family flags:

```bash
gcc -MMD -MP -c main.c -o main.o
```

- **`-MMD`** — as a side effect of compiling, write a dependency file `main.d` listing every header `main.c` pulled in (the `MM` variant skips system headers like `<stdio.h>`; use `-MD` to include them).
- **`-MP`** — also emit a dummy phony target for each header. This prevents a `No rule to make target 'old.h'` error after you *delete* a header that some `.d` file still references.

`main.d` contains a generated `make` rule:

```makefile
main.o: main.c config.h types.h
```

You then **include** these generated rules back into your `Makefile` so the edges become part of the graph:

```makefile
CFLAGS += -MMD -MP

%.o: %.c
	gcc $(CFLAGS) -c $< -o $@

-include $(OBJS:.o=.d)        # pull in main.d, parse.d, ... (the leading - ignores
                              # missing .d files on the very first build)
```

Now the graph is complete: edit `config.h` and every `.o` whose `.d` lists it is correctly marked stale and rebuilt. The flow is self-correcting — the *first* build generates the `.d` files; every subsequent build reads them. This is exactly how mature C/C++ `Makefile`s avoid stale builds, and it's the mechanism behind the junior page's "missing edge → stale build" warning.

> **Key insight:** the only thing that *truly* knows your dependencies is the compiler, because it's the thing that reads the `#include`s. Hand-written dependency lists rot; compiler-generated `.d` files stay correct for free. Any build system that tracks header deps does some version of this — capturing the compiler's view of what it actually read.

---

## Why Timestamps Lie — Clock Skew, touch, and Friends

`make`'s "newer than" rule is fast and usually right, but it's a *proxy* for "the content changed," and proxies leak. Real failure modes:

- **Clock skew (the classic NFS / CI killer).** Files built on machine A (clock at 10:05) land on a shared filesystem; machine B's clock reads 10:02. Now an *older* source can look *newer* than a freshly built output, or vice versa, scrambling every rebuild decision. `make` even warns: `Clock skew detected. Your build may be incomplete.` Distributed and networked builds are where this bites hardest.

- **`touch` and copies.** `touch foo.c` updates mtime with zero content change → spurious rebuild of everything downstream. Conversely, restoring a file from backup or `git checkout` can set mtime to the *checkout* time, making outputs look stale or fresh incorrectly. `cp` without `-p` resets mtimes; `cp -p` preserves them — and the choice silently changes what rebuilds.

- **Coarse timestamp resolution.** Some filesystems store mtime at 1-second (or 2-second, on old FAT) granularity. Edit a file and rebuild its output within the same second and the two share a timestamp — `make`'s `>` is not satisfied, so it may **skip a needed rebuild**. Fast builds on coarse-mtime filesystems can silently go stale.

- **Equal timestamps.** If a prerequisite and target have *identical* mtime, `make` treats the target as up to date (it uses strictly-newer). Unzipping a tarball that sets all files to the same time can produce exactly this.

- **mtime is per-file, not content-aware.** Rewriting a file with identical bytes (a formatter that changes nothing, a `git checkout` of the same content) still bumps mtime → rebuild work for a no-op change.

```
  EXPECTATION                         REALITY with mtime
  "newer source ⇒ stale output"       only if clocks agree and resolution is fine
  "same content ⇒ no rebuild"         FALSE — touch/checkout bump mtime
  "rebuilt ⇒ now up to date"          usually, unless clock went backwards
```

The fix isn't to abandon timestamps everywhere — they're cheap and adequate for single-machine local builds — but to *know their failure modes* and to switch to content hashing where correctness across machines matters ([senior.md](senior.md), [07 — Build Caching](../07-build-caching/middle.md)).

---

## Content Hashes as the Alternative

Instead of "is the prerequisite newer?", a hash-based build asks "**is the prerequisite's content different from what I used last time?**" It records a fingerprint (e.g. SHA-256, or a fast hash like BLAKE3) of each input and compares.

```
  build N:   parse.c → hash 0xAB12   (recorded alongside parse.o)
  build N+1: parse.c → hash 0xAB12   → identical → SKIP (mtime irrelevant)
             parse.c → hash 0xCD34   → different → REBUILD
```

What this buys over timestamps:

- **`touch`-proof.** Touching a file doesn't change its content hash, so no spurious rebuild.
- **Clock-skew-proof.** No clocks involved; correctness doesn't depend on machine times agreeing — essential for distributed and cached builds.
- **Undo-proof / checkout-proof.** Revert a file to a previous state and the hash matches a previous build → no rebuild.
- **Enables early cutoff.** Because you can hash *outputs* too, you can stop a rebuild from propagating when a step produces identical output (covered in [senior.md](senior.md)).

The cost: **you have to read and hash every input** (mtime is metadata; hashing reads bytes). Build systems mitigate this by caching hashes keyed on mtime+size — only re-hash a file whose mtime *did* move, getting hashing's correctness with near-mtime speed. Bazel, Buck2, and most modern systems work this way.

| | Timestamps (`make`) | Content hashes (`bazel`, `ninja` restat, etc.) |
|---|---|---|
| Question asked | "prerequisite newer?" | "content different?" |
| Cost | Cheap (stat metadata) | Reads bytes (mitigated by mtime-keyed cache) |
| `touch` triggers rebuild | Yes (spurious) | No |
| Survives clock skew | No | Yes |
| Cross-machine caching | Unsafe | Safe |

---

## Parallel Scheduling and the Critical Path

The graph has *many* valid topological orders precisely because nodes that don't depend on each other can be built **simultaneously**. `make -j N` runs up to `N` recipes in parallel, scheduling any node whose prerequisites are all already built.

```makefile
# main.o, parse.o, util.o are independent → all three can run at once
make -j4 app
#   t0: start main.o, parse.o, util.o in parallel (independent leaves)
#   t1: all three .o done → start app (it depended on all of them)
```

But parallelism has a hard floor: the **critical path** — the longest chain of dependent nodes. No amount of cores compresses a chain `A → B → C → D` below "time(A)+time(B)+time(C)+time(D)", because each must wait for the previous.

```
  A(2s) ─► B(2s) ─► C(2s) ─► D(2s)        critical path = 8s
  E(1s) ─┘                                E is off the path; doesn't extend it
  ── with infinite cores, total build ≥ 8s (the longest dependency chain) ──
```

Practical consequences:

- **`-j` only helps the parts that are independent.** A long thin graph (everything depends on the previous thing) barely speeds up no matter how many cores you throw at it.
- **The link step is a common bottleneck** — high fan-in, runs last, depends on everything, can't start until the final `.o` is done. It often *is* the tail of the critical path.
- **Reducing the critical path** (e.g. breaking a god-header that serializes compilation, or splitting a monolithic target) often beats adding cores. Graph *shape*, not just core count, governs wall-clock time — see [10 — Build Performance](../10-build-performance/middle.md).

A correct `-j` build also depends on a *correct graph*: if an edge is missing, two recipes that secretly share a file can run concurrently and corrupt each other's output (a **race**). Parallelism turns a latent missing-edge bug into a flaky, nondeterministic failure — which is why under-specified dependencies are far more dangerous under `-j`.

---

## Correctly vs Incorrectly Specified Dependencies

The graph is only as good as the edges you declare. Two ways to get it wrong, with opposite symptoms:

**Under-specified (missing edge) — the dangerous one.** You depend on something but didn't declare it.

```
  Real:     parse.o needs parse.c AND schema.h
  Declared: parse.o needs parse.c
  Symptom:  edit schema.h → parse.o NOT rebuilt → STALE build, wrong behaviour
            under -j: a race if two steps touch the same undeclared file → FLAKY
```

Under-specification is insidious because the build *looks* faster and *usually* works — until the one time the missing input changes, and then you ship a bug that "rebuilding" doesn't fix (only a clean rebuild does). The `-MMD -MP` machinery above exists specifically to eliminate this for headers.

**Over-specified (extra edge) — the wasteful one.** You declared a dependency you don't actually have.

```
  Real:     parse.o needs parse.c
  Declared: parse.o needs parse.c AND every-header-in-the-repo
  Symptom:  edit ANY header → parse.o rebuilds needlessly → slow, but CORRECT
```

Over-specification is safe (never stale) but slow (rebuilds too much). The "declare everything depends on everything" anti-pattern is the extreme: every change becomes a full rebuild, defeating the point of incrementality.

```
                    under-specified              over-specified
  correctness       BROKEN (stale, flaky)        fine (never stale)
  speed             fast (until it's wrong)       slow (wasted rebuilds)
  how to detect     "rebuild didn't fix it"       "everything rebuilds always"
```

The goal is **exactly the real edges**: every true dependency declared, no false ones. Compiler-generated `.d` files get this right for C/C++ headers; for everything else, the discipline of declaring precise inputs (and, in modern systems, *enforcing* it by sandboxing the build so undeclared inputs are invisible) is what keeps the graph honest. Senior systems make this enforceable; see [senior.md](senior.md).

> **Key insight:** under-specification trades correctness for speed (silently); over-specification trades speed for correctness (visibly). Given a choice with no enforcement, over-specify — a slow correct build beats a fast wrong one. Better: use tooling that derives or enforces the *exact* edges so you don't have to choose.

---

## Mental Models

- **`make` is a graph interpreter, not a script runner.** You declare edges (`target: prereqs`); `make` topologically walks them and, at each node, compares mtimes. Once you see it as "walk the DAG, compare clocks," its every behaviour is predictable.

- **The compiler is the only honest source of header edges.** Hand-maintained dependency lists rot; `-MMD` captures exactly what the compiler `#include`d. Trust the tool that actually read the files.

- **Timestamps are a fast lie; hashes are a slow truth.** mtime is a cheap proxy for "content changed" that leaks under skew, `touch`, and coarse resolution. Hashing reads bytes — more expensive, but it answers the real question.

- **The critical path is the speed limit.** Cores parallelize *width*; nothing parallelizes *depth*. The longest dependency chain is your floor. To go faster, shorten the chain, not just add cores.

- **A missing edge is a time bomb; an extra edge is a tax.** The bomb (under-spec) goes off silently and rarely. The tax (over-spec) is paid loudly every build. Prefer the tax until you can eliminate both with precise/enforced deps.

---

## Common Mistakes

1. **Not tracking header dependencies.** Writing `main.o: main.c` and stopping. Edit `config.h`, nothing rebuilds, you debug stale code for an hour. Add `-MMD -MP` and `-include $(DEPS)`.

2. **Hand-writing header dependency lists.** They go out of date the instant someone adds or removes an `#include`. Generate them from the compiler instead.

3. **Trusting mtime across machines.** On NFS/CI/distributed builds, clock skew silently corrupts rebuild decisions. Watch for `Clock skew detected`; move to content hashing for cross-machine correctness.

4. **Assuming `-j` is always safe.** `make -j` only produces correct output if the graph is complete. A missing edge becomes a *race* under parallelism — intermittent, machine-dependent failures that vanish under `-j1`. "Works with `-j1`, fails with `-j8`" almost always means a missing dependency.

5. **Confusing parallelism width with critical-path depth.** Adding cores to a long-thin graph does nearly nothing. Profile the critical path before buying a bigger machine.

6. **Over-specifying "to be safe" forever.** Declaring broad dependencies stops stale builds but makes every change a near-full rebuild. It's a stopgap, not a solution — tighten the edges or use a system that derives them.

---

## Test Yourself

1. State the theorem connecting cycles and topological order. How is cycle *detection* a by-product of computing a topological sort?
2. In a `make` rule `app: main.o parse.o`, where is the graph? What exactly does `make` compare to decide if `app` is stale?
3. `main.c` includes `config.h`, but the `Makefile` only says `main.o: main.c`. What goes wrong, and what do `-MMD` and `-MP` each do to fix it?
4. Give two concrete situations where `make`'s timestamp rule makes the *wrong* rebuild decision.
5. What question does a content-hash build ask instead of "is the prerequisite newer?", and name two failure modes it eliminates.
6. A graph is one long chain `A→B→C→D→E`, each step 1s. How much faster is `make -j8` than `make -j1`? Why?
7. You declared *fewer* edges than truly exist (under-specified). What are the two symptoms — one for serial builds, one for `-j`?

<details>
<summary>Answers</summary>

1. **A directed graph has a topological ordering iff it is acyclic.** Running Kahn's algorithm, you repeatedly remove a node with no remaining dependencies; if nodes remain but none qualify, those nodes form a **cycle** — so the algorithm *detects* the cycle as the case where it can't make progress.
2. The graph is the rule itself: the colon makes `main.o` and `parse.o` prerequisites (edges) of `app`. `make` compares the **mtime of `app`** against the mtimes of `main.o` and `parse.o`; if `app` is missing or any prerequisite is *newer*, `app` is stale.
3. The edge `main.o → config.h` is missing, so editing `config.h` doesn't rebuild `main.o` → **stale build**. `-MMD` makes the compiler emit `main.d` listing the real header deps (skipping system headers); `-MP` adds phony targets for each header so deleting a header doesn't break the build with `No rule to make target`.
4. Any two of: **clock skew** (source from a faster-clocked machine looks newer/older incorrectly); **`touch`** (bumps mtime with no content change → spurious rebuild); **coarse mtime resolution** (source and output land in the same second → needed rebuild skipped); **equal timestamps from an unzip** → target wrongly treated as up to date.
5. "**Is the content different** from what I used last time?" (compares a hash). It eliminates **`touch`-triggered rebuilds** and **clock-skew errors** (also undo/checkout no-op rebuilds, and enables cross-machine caching).
6. **Barely any faster** — the chain is the **critical path**; each step waits for the previous, so total time ≈ 5s regardless of `-j`. Parallelism only helps *independent* nodes, and a pure chain has none.
7. Serial: editing the undeclared input doesn't rebuild its dependent → **stale build / wrong behaviour that rebuilding doesn't fix**. Under `-j`: two steps that secretly share the undeclared file can run concurrently → a **race / flaky, nondeterministic failure**.

</details>

---

## Cheat Sheet

```
GRAPH FORMALISM
  G=(V,E)   edge target→prereq ("needs")   must be acyclic
  topo order exists  IFF  graph is acyclic        (cycle = no order)
  fan-out = #dependents (change → this many rebuild)
  fan-in  = #dependencies (this waits for this many)

MAKE'S MODEL
  rule:  target: prereqs   <tab>recipe
  the COLON is the edge.  $@=target  $<=first prereq  $^=all prereqs
  stale if:  target missing  OR  any prereq.mtime > target.mtime

HEADER DEPS (the critical fix)
  gcc -MMD -MP -c main.c -o main.o      # emit main.d with real header deps
    -MMD : write .d (skip system headers; -MD includes them)
    -MP  : phony target per header (survives deleted headers)
  Makefile:  CFLAGS += -MMD -MP
             -include $(OBJS:.o=.d)      # leading - tolerates first-build absence

TIMESTAMPS LIE WHEN
  clock skew (NFS/CI)   touch   coarse mtime resolution   equal mtimes
  → "Clock skew detected. Your build may be incomplete."

HASHES ASK "content different?"  (touch-proof, skew-proof, cacheable; cost: read bytes)

PARALLELISM
  make -j N        run N recipes at once (independent nodes)
  critical path = longest dependency chain = HARD floor on wall time
  cores parallelize WIDTH, never DEPTH
  missing edge + -j  →  RACE (flaky; "works -j1, fails -j8")

EDGE CORRECTNESS
  under-specified (missing) → STALE / FLAKY  (fast but wrong)
  over-specified  (extra)   → WASTED rebuilds (slow but correct)
  goal: exactly the real edges (compiler-derived, or enforced/sandboxed)
```

---

## Summary

- A build graph is a **DAG**; a **topological order** exists *iff* it's acyclic, and the sorting algorithm (Kahn's / DFS) *is* the cycle detector. **Fan-out** predicts how much a change rebuilds; **fan-in** predicts what a node waits on.
- `make` doesn't take a graph — it **derives** one from `target: prerequisites` rules (the colon is the edge), topologically walks it from the goal, and at each node decides staleness by one comparison: *target missing or any prerequisite newer (mtime)*.
- The naive header hole — `main.o: main.c` omits `config.h` — causes **stale builds**. The fix is compiler-generated dependency files: **`-MMD -MP`** plus **`-include $(DEPS)`**, so the graph carries the exact `#include` edges the compiler actually saw.
- **Timestamps are a cheap proxy that lies** under clock skew, `touch`, copies, and coarse resolution. **Content hashes** ask "is the content different?" instead — touch-proof, skew-proof, and safe to cache across machines, at the cost of reading bytes (mitigated by mtime-keyed hash caches).
- **`make -j N`** parallelizes independent nodes, but the **critical path** (longest dependency chain) is a hard floor that no core count beats. Under `-j`, a **missing edge becomes a race** — the classic "works at `-j1`, flaky at `-j8`."
- **Under-specified** dependencies trade correctness for speed (silent stale/flaky builds); **over-specified** trade speed for correctness (wasted rebuilds). Aim for the *exact* edges — derived or enforced — so you don't have to choose.

Next: [senior.md](senior.md) — under/over-approximation as a correctness model, dynamic dependencies discovered during the build, early cutoff and content-addressed graphs, and operating a build graph at monorepo scale.

---

## Further Reading

- [GNU Make manual — "Generating Prerequisites Automatically"](https://www.gnu.org/software/make/manual/html_node/Automatic-Prerequisites.html) — the canonical `-M`/`-include` recipe.
- *Recursive Make Considered Harmful* (Peter Miller, 1998) — why splitting the graph across recursive `make` invocations breaks incrementality; a foundational read.
- *Build Systems à la Carte* (Mokhov, Mitchell, Peyton Jones) — formalizes rebuild strategies (dirty-bit vs verifying traces) and minimality; the rigorous treatment of this page's themes.
- `man gcc` — the `-M`, `-MM`, `-MMD`, `-MP`, `-MF`, `-MT` family in full.

---

## Related Topics

- [01 — Build Fundamentals](../01-build-fundamentals/middle.md) — translation units explain *why* a header edits its includers' graph nodes.
- [03 — Make and Descendants](../03-make-and-descendants/middle.md) — Ninja and others that take this graph model further.
- [07 — Build Caching](../07-build-caching/middle.md) — content hashing extended to reuse outputs across machines.
- [10 — Build Performance](../10-build-performance/middle.md) — critical-path analysis and shaping the graph for speed.
- [senior.md](senior.md) — approximation/correctness, dynamic deps, early cutoff, and monorepo-scale graphs.
