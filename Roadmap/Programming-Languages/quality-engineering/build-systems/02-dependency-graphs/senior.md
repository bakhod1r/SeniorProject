# Dependency Graphs — Senior Level

> **Roadmap:** [Build Systems](../README.md) → Dependency Graphs
> *The middle page made the graph correct. This page makes it a formal correctness model: approximation as the central tradeoff, dependencies discovered during the build, early cutoff on content-addressed outputs, and querying a graph too large to picture.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Approximation: the One Tradeoff Behind All the Others](#approximation-the-one-tradeoff-behind-all-the-others)
4. [Minimal Incremental Correctness](#minimal-incremental-correctness)
5. [Dynamic Dependencies — Discovered During the Build](#dynamic-dependencies--discovered-during-the-build)
6. [Early Cutoff and Content-Addressed Graphs](#early-cutoff-and-content-addressed-graphs)
7. [Newer-Than vs Content-Addressed — Two Build Philosophies](#newer-than-vs-content-addressed--two-build-philosophies)
8. [The Build Graph at Monorepo Scale](#the-build-graph-at-monorepo-scale)
9. [Querying the Graph — bazel query and buck query](#querying-the-graph--bazel-query-and-buck-query)
10. [How a Bad Graph Causes Flaky and Stale Builds](#how-a-bad-graph-causes-flaky-and-stale-builds)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What does it mean for an incremental build to be *correct*, and how do real systems guarantee it at scale?**

The middle page treated under/over-specification as "bugs to avoid." At the senior level it's the *organizing principle*: every dependency graph is an **approximation** of the true set of inputs, and the entire design space — timestamps vs hashes, static vs dynamic deps, sandboxing, early cutoff — is about controlling the *direction* and *cost* of that approximation.

This page reframes the graph as a correctness contract. We'll define minimal incremental correctness, handle dependencies that aren't known until the build runs (the awkward general case `make` can't model), explain Bazel/Buck's early-cutoff trick that prunes rebuilds even when an input *did* change, contrast `make`'s "newer-than" world with the content-addressed world, and confront the operational reality: a graph with millions of nodes that no one can draw, only *query*.

---

## Prerequisites

- **Required:** [middle.md](middle.md) — topological sort, `make`'s mtime model, `-MMD -MP` header tracking, timestamps-vs-hashes, critical path, under/over-specification.
- **Required:** Working knowledge of at least one build system beyond `make` (Bazel, Buck2, or Ninja).
- **Helpful:** Exposure to a monorepo or a build graph large enough that you couldn't enumerate it by hand.
- **Helpful:** [07 — Build Caching](../07-build-caching/senior.md) for content-addressed storage.

---

## Approximation: the One Tradeoff Behind All the Others

There is a *true* set of inputs for every build action — the exact bytes that, if changed, would change the output. Call it **T**. The graph you declare encodes a *believed* set, **D**. Correctness is entirely about how **D** relates to **T**:

```
  D ⊇ T  (over-approximation)  : every real input is declared (maybe extras too)
                                 → CORRECT (never stale), possibly SLOW (rebuilds on extras)

  D ⊉ T  (under-approximation) : at least one real input is undeclared
                                 → UNSAFE: that input can change with no rebuild → STALE

  D = T  (exact)               : declared set equals true set
                                 → CORRECT and MINIMAL — the ideal
```

This single relation explains every earlier rule:

- "Over-specifying is safe but slow" = **D ⊋ T**: a superset, correct but rebuilds on irrelevant changes.
- "Missing edges cause stale builds" = **D ⊉ T**: a real input is missing, so its change is invisible.
- The whole goal of `-MMD` is to drive C/C++ header deps toward **D = T**.

The crucial asymmetry: **over-approximation costs *time*; under-approximation costs *correctness*.** A slow build is annoying; a silently stale build ships wrong binaries. So when a system *cannot* prove **D = T**, the only safe fallback is **D ⊇ T** (over-approximate), never **D ⊊ T**. This is why hermetic, sandboxed builds matter: they make undeclared inputs *physically invisible* to the action, converting "I hope I declared everything" into "the build *cannot* read anything I didn't declare" — turning under-approximation from a silent risk into an immediate, loud failure.

> **Key insight:** you don't choose "correct or fast." You choose *which approximation* and *how you bound its error*. Sandboxing + content hashing lets a system aim for **D = T** while *guaranteeing* it never falls below **T**. That guarantee — not the speed — is the real reason Bazel-class systems exist.

---

## Minimal Incremental Correctness

What does it mean for an incremental build to be *correct*? The contract:

> **An incremental build is correct if, for every change to the inputs, the resulting outputs are byte-identical to those a full clean build from the same inputs would have produced.**

In other words: *incrementality must be invisible in the result.* The only thing it's allowed to change is *time*, never *output*.

A build is additionally **minimal** if it rebuilds *only* the actions whose transitive inputs actually changed — no more. Correctness and minimality are independent axes:

```
                 minimal?            correct?
  always rebuild  no (max work)      yes
  make (mtime)    approx-minimal     yes IF deps fully declared; else NO
  bazel (hash)    minimal + early cutoff   yes (sandbox enforces D⊇T)
  broken graph    "minimal"          NO  (stale — the dangerous quadrant)
```

The dangerous quadrant is *minimal but incorrect*: it does little work and produces wrong output. That's exactly a under-approximated graph — it confidently skips the rebuild that mattered.

Achieving both correctness and minimality requires the build to *verify*, not assume, that an action's inputs are unchanged. The rigorous framing (from *Build Systems à la Carte*) distinguishes:

- **Dirty-bit** rebuilders (`make`): trust a per-node "is it dirty?" proxy (mtime). Fast, but only as correct as the proxy.
- **Verifying-trace** rebuilders (Bazel, Shake): record the *hashes* of the exact inputs an action consumed; rebuild iff a current input hash differs from the trace. Correct by construction *given* the recorded inputs are complete — which sandboxing guarantees.

The trace is the key upgrade: instead of comparing clocks, the build remembers "last time, action X consumed inputs with these hashes and produced this output." If the inputs hash the same now, the output is reusable — even from another machine, another day, another developer.

---

## Dynamic Dependencies — Discovered During the Build

`make` requires the graph to be **static**: every edge must be known *before* any recipe runs. But many real dependencies are only knowable *after* a tool runs. Examples:

- A **C compiler** discovers which headers it includes only by parsing the source (which is exactly why `-MMD` emits the deps *as a side effect of compiling* — the deps come *out* of the action, they weren't known going in).
- A **code generator** reads a schema and emits N files whose names depend on the schema's contents.
- A **bundler/linker** following `import`/`require` discovers the transitive set only by traversing.

These are **dynamic dependencies** (a.k.a. monadic dependencies): the set of inputs depends on the *value* of other inputs, not just their identity. A purely static graph can't express them; it can only over-approximate ("depend on the whole schema directory") or under-approximate ("guess the outputs") — both bad.

How real systems handle them:

- **`make` (two-pass / restat).** Run once, capture discovered deps into `.d` files, *include them on the next run*. The first build is necessarily over-cautious; subsequent builds are accurate. This is the `-MMD` + `-include` dance — a manual dynamic-dependency mechanism.
- **Ninja.** Native support via `depfile` (read a compiler-emitted `.d` after the action) and the `deps` database (Ninja stores discovered deps in `.ninja_deps`, avoiding re-parsing). Ninja explicitly models "deps discovered during the build."
- **Bazel.** Actions declare inputs up front, but features like **tree artifacts** (a directory whose contents aren't known until built), **include scanning**, and **`ctx.actions.run` with discovered inputs** let the graph expand during execution while staying hermetic — the sandbox ensures nothing undeclared sneaks in.
- **Shake / Buck2.** First-class dynamic dependencies (`need` can be called *after* inspecting a value), which is the clean theoretical solution: the graph is built *as the build runs*, not strictly before.

```
  STATIC graph (make's ideal):   know all edges → topo sort → execute
  DYNAMIC reality:               execute action → action REVEALS new edges → schedule them
```

> **Key insight:** the compiler-emitted `.d` file you met at middle level is not a `make` convenience — it's `make`'s *workaround for being a static-graph engine in a dynamic-graph world*. Recognizing "this dependency is only knowable after running the tool" tells you immediately whether a build system can model it correctly or is forced to approximate.

---

## Early Cutoff and Content-Addressed Graphs

Here's a rebuild that `make` *always* does but is often *unnecessary*. Edit a comment in `util.c`. `make` recompiles `util.o` (correct — `util.c` changed), then **relinks `app`** because `util.o`'s mtime is now newer. But the comment didn't change the *generated code* — `util.o` may be byte-identical to before. Relinking was pure waste, and so was rebuilding everything *downstream* of `app`.

**Early cutoff** (a.k.a. **early termination**) stops the rebuild from propagating when an action's *output* is unchanged, even though its *input* changed:

```
  util.c  changed (comment edit)
     │  hash differs → rebuild util.o
     ▼
  util.o  REBUILT, but output hash == previous output hash
     │  ← EARLY CUTOFF: downstream inputs are unchanged
     ▼
  app     NOT relinked (its input util.o is byte-identical to last time)
```

The mechanism requires **content-addressing the outputs**: after rebuilding `util.o`, hash it; if the hash equals the previously recorded one, the change *does not propagate* — every downstream action sees an unchanged input and is skipped. This is impossible with pure mtime (the rebuilt file is always "newer"), which is why early cutoff is a hallmark of hash-based systems: **Bazel, Buck2, and Shake** all do it.

Ninja approximates it with **`restat = 1`**: after running a rule, Ninja re-stats the output; if the mtime *didn't* advance (the rule didn't actually rewrite the file — e.g. a no-op codegen or a `cmp`-guarded copy), downstream is not rebuilt. It's mtime-based early cutoff, and it's why Ninja rules for generators often pair with a "write-only-if-changed" wrapper.

The payoff compounds along the critical path: cutting a rebuild at `util.o` prunes the *entire downstream subtree*. On a large graph, early cutoff routinely turns "I touched a comment, 4000 actions rebuilt" into "12 actions rebuilt, rest cut off."

---

## Newer-Than vs Content-Addressed — Two Build Philosophies

`make` and Bazel are not "the same idea, one fancier." They model the graph on fundamentally different axioms.

| | `make` — *newer-than* | Bazel/Buck2 — *content-addressed* |
|---|---|---|
| Identity of a build step | the **output path** | the **hash of (action + all input contents)** |
| "Up to date" means | output mtime ≥ all input mtimes | an entry exists for this exact input hash |
| Where results live | in place, on this filesystem | in a **content-addressed cache** (local + remote) |
| Reuse across machines | unsafe (mtimes don't travel) | **safe** — same input hash ⇒ same output, anywhere |
| Early cutoff | no (rebuilt = newer) | yes (output hash compared) |
| Dynamic deps | manual (`.d` + `-include`) | modeled (declared/discovered, sandboxed) |
| Correctness basis | trust the clock | verify the content trace |

The content-addressed model treats a build action as a **pure function**: `output = f(action_definition, hash(inputs))`. If two builds — on two machines, a year apart — present the same `f` and the same input hashes, they *must* yield the same output, so the output can be **fetched from a cache instead of recomputed**. This is what makes remote caching and remote execution possible ([07 — Build Caching](../07-build-caching/senior.md)): the graph isn't "files newer than other files," it's "a content-addressed memoization table keyed on the transitive input hashes."

`make`'s model can't do this because its key is a *mutable path with a clock*, not an *immutable content hash*. Two machines' `app` files are "the same path" but carry different mtimes and possibly different bytes — there's nothing to safely share. The shift from path+mtime to content-hash *is* the leap from single-machine incremental builds to org-wide cached builds.

> **Key insight:** "make is local and slow, Bazel is distributed and fast" is the symptom, not the cause. The cause is the *identity model*: a path-keyed mtime graph is inherently local and unshareable; a content-keyed hash graph is inherently global and cacheable. Everything else follows from that one choice.

---

## The Build Graph at Monorepo Scale

In a monorepo (Google, Meta, large companies' internal trees) the build graph has **millions of nodes**. You cannot draw it, hold it in your head, or enumerate it. This changes what "working with the graph" means:

- **Two graph levels.** Bazel distinguishes the **target graph** (coarse: libraries, binaries, tests — what you write in `BUILD` files) from the **action graph** (fine: individual compile/link/codegen commands, expanded from targets). The target graph is for humans; the action graph is what actually executes. Many performance questions are really "how does my one target expand into thousands of actions?"
- **Loading/analysis is itself expensive.** Before any action runs, the tool must *load* (parse `BUILD` files), *analyze* (configure rules into the action graph), then *execute*. On a huge graph, analysis time dominates small builds — which is why Bazel keeps a warm daemon (the server) holding the analyzed graph in memory across invocations.
- **Visibility rules constrain edges.** At scale, an *unrestricted* graph rots into a hairball where everything can depend on everything. Bazel's `visibility` and Buck's visibility lists make edges *require permission*: a target can only depend on another if allowed. This is dependency-graph governance — it keeps the graph's structure aligned with intended architecture rather than whatever `import` someone typed.
- **Coarse edges trade precision for tractability.** At the BUILD-file level you depend on a *target* (a whole library), not individual files. This is deliberate over-approximation: editing any file in `//lib:util` rebuilds everything that depends on `//lib:util`, even if only one consumer used the one function you changed. Finer granularity would be more minimal but explode the graph's size. The art is target sizing — small enough for good incrementality, large enough to keep the graph manageable.

The practical upshot: at monorepo scale you stop *reading* the graph and start *querying* it.

---

## Querying the Graph — bazel query and buck query

When the graph is too big to see, you ask it questions in a query language. These are the senior engineer's instruments for graph debugging and impact analysis.

```bash
# What does //app:server depend on, transitively?
bazel query 'deps(//app:server)'

# Who depends ON //lib:auth?  (reverse deps — the blast radius of changing it)
bazel query 'rdeps(//..., //lib:auth)'

# WHY does //app:server depend on //lib:legacy?  (show a dependency path)
bazel query 'somepath(//app:server, //lib:legacy)'
# ...or every path:
bazel query 'allpaths(//app:server, //lib:legacy)'

# Which tests are affected by editing //lib:auth?  (CI test selection)
bazel query 'kind(test, rdeps(//..., //lib:auth))'

# Visualize a subgraph
bazel query 'deps(//app:server)' --output graph | dot -Tsvg > deps.svg
```

Buck2 mirrors this (`buck2 cquery`, `buck2 uquery`, `rdeps`, `somepath`) and adds **`aquery`** to inspect the *action* graph — the actual commands, their inputs/outputs, and arguments:

```bash
bazel aquery 'deps(//app:server)'      # the concrete actions: compile/link command lines
buck2 aquery 'inputs(//app:server)'    # exact files an action consumes
```

Two queries earn their keep daily:

- **`rdeps` (reverse deps) = the blast radius.** Before touching a widely-used library, `rdeps` tells you exactly what you might break and what CI will rebuild. It's the fan-out from [middle.md](middle.md), made queryable. **Affected-test selection** in CI is literally `kind(test, rdeps(//..., <changed targets>))` — only run tests downstream of the change, the single biggest CI cost lever ([10 — Build Performance](../10-build-performance/senior.md)).
- **`somepath` = "why on earth does X depend on Y?"** When a tiny tool drags in a 200MB dependency, `somepath` prints the chain so you can find and cut the offending edge.

> **Key insight:** at scale, the dependency graph stops being a thing you *configure* and becomes a thing you *interrogate*. `deps`/`rdeps`/`somepath`/`aquery` are to the build graph what `EXPLAIN` is to a SQL query — the difference between guessing why the build does what it does and *knowing*.

---

## How a Bad Graph Causes Flaky and Stale Builds

A wrong graph fails in two opposite, both-nasty ways. Diagnosing which you have is half the fix.

**Under-approximation → stale + flaky.** A missing edge means a real input can change without triggering a rebuild:

- *Stale*: the output keeps using old logic; "rebuilding" doesn't fix it because the build sees nothing dirty. Only `make clean` / `bazel clean` "fixes" it — which is the tell. **If `clean` fixes a bug that incremental can't, you have a missing edge.**
- *Flaky under parallelism/caching*: two actions that share an undeclared file race under `-j`, or a cached output is reused when it shouldn't be because the cache key omitted the undeclared input. The failure appears on some machines/orders and not others — the worst kind to debug, because it's nondeterministic. Hermetic sandboxing is the structural cure: it makes the undeclared read *fail loudly the first time* instead of silently corrupting later.

**Over-approximation → slow + noisy.** Extra edges mean innocuous changes trigger huge rebuilds:

- A `BUILD` target that globs `**/*.h` depends on every header; touch any one and the whole target (and its `rdeps`) rebuilds. Correct, but it makes incrementality worthless and floods CI with rebuilds, eroding trust ("the build always rebuilds everything, so I stopped expecting it to be fast").
- A "junk-drawer" target everyone depends on becomes a graph chokepoint: high fan-out means *any* change to it invalidates half the graph. This is a *cohesion* problem expressed in the build graph (see Mental Models).

Diagnostic table:

```
  SYMPTOM                                  LIKELY CAUSE             FIX
  clean fixes it, incremental doesn't      missing edge (under)    declare/derive the dep; sandbox
  fails at -j8, passes at -j1              missing edge → race     same; enforce hermeticity
  cache hit gave wrong output              cache key missing input fix action's declared inputs
  trivial edit rebuilds the world          over-broad edge/glob    split target; narrow inputs
  one target's change invalidates half     high-fan-out chokepoint refactor: break the god-target
```

The graph is a *correctness artifact*. Flaky and stale builds are almost never "the build tool is buggy" — they're "the declared graph **D** doesn't equal the true graph **T**," in one direction or the other.

---

## Mental Models

- **The graph is an approximation with a safe direction.** **D ⊇ T** (over) wastes time; **D ⊊ T** (under) breaks correctness. When you can't be exact, *over*-approximate — a slow build is recoverable, a silently stale one isn't.

- **An action is a pure function; the cache is its memo table.** `output = f(action, hash(inputs))`. Content-addressing turns "rebuild" into "look up f's result; recompute only on a miss." This is the entire basis of cross-machine reuse.

- **`make`'s `.d` files are a static engine faking dynamic deps.** Any "discover deps by running the tool" pattern is a dynamic dependency. Knowing that tells you whether a tool models it or merely approximates.

- **Early cutoff prunes subtrees, not just nodes.** Stopping a rebuild at one node because its *output* didn't change saves *everything downstream*. The win is the pruned subtree, which is why it scales superlinearly.

- **`clean` fixing a bug is a diagnosis, not a fix.** It means the incremental graph is under-approximated — a real input isn't declared. Find the missing edge; don't make `clean` a habit.

- **A high-fan-out node is a coupling smell.** A target half the repo depends on is the build-graph image of a god-class. Its blast radius (`rdeps`) is your architecture's coupling, made measurable.

---

## Common Mistakes

1. **Treating "correct or fast" as the choice.** The real choice is *which approximation* and *how its error is bounded*. Hermetic + hashed builds get fast *and* correct by enforcing **D ⊇ T** while aiming at **D = T**.

2. **Modeling a dynamic dependency as a static one by guessing.** Hard-coding the outputs of a code generator, or depending on a whole directory, is a guess that's either stale (too narrow) or wasteful (too broad). Use the tool's depfile/tree-artifact/discovered-inputs mechanism.

3. **Expecting early cutoff without content-addressed outputs.** On `make`/plain mtime, a rebuilt file is *always* newer, so the change always propagates. Early cutoff needs output hashing (Bazel) or `restat` + write-if-changed (Ninja).

4. **Globbing inputs too broadly in BUILD files.** `glob(["**/*"])` over-approximates the graph, making incrementality and `rdeps`-based test selection nearly useless. Declare precise inputs.

5. **Habitually running `clean` to "fix" weird builds.** It masks a missing edge (under-approximation). The bug will recur. Diagnose the omitted input instead.

6. **Reasoning about a monorepo graph from memory.** You can't. Use `bazel query`/`buck query` (`deps`, `rdeps`, `somepath`, `aquery`). Guessing the blast radius at scale is how you ship a 40-minute CI rebuild.

7. **Ignoring visibility rules as bureaucracy.** Unconstrained edges let the graph rot into a hairball. Visibility *is* dependency-graph governance; it keeps **D** structured like your intended architecture.

---

## Test Yourself

1. Define over- and under-approximation of a build graph in terms of sets **D** (declared) and **T** (true). Which is safe when you can't be exact, and why?
2. State the correctness contract for an incremental build in one sentence. What is the "minimal but incorrect" quadrant, and what graph error produces it?
3. Give a concrete dynamic dependency and explain why a strictly-static graph engine (`make`) cannot model it without approximating. How does the `-MMD`/`-include` pattern work around it?
4. What is early cutoff? Walk through editing a comment in `util.c` and show where the rebuild gets pruned. Why can't plain `make` do this?
5. Why can a content-addressed build (Bazel) reuse a result across machines while `make` cannot? Frame it in terms of *identity* (what keys a build result).
6. You're about to change a heavily-used library. Write the `bazel query` that tells you the blast radius, and the one that selects only the affected tests.
7. A bug disappears after `bazel clean` but `--keep_going` incremental builds keep reproducing it. What category of graph error is this, and what's the structural fix?

<details>
<summary>Answers</summary>

1. **D** = declared input set, **T** = true input set. **Over-approximation: D ⊇ T** (declared ≥ true) — correct but maybe slow. **Under-approximation: D ⊊ T** — a real input is undeclared, so its change is invisible → stale. When you can't be exact, **over-approximate**, because the error costs *time* (recoverable) rather than *correctness* (ships wrong output).
2. An incremental build is correct iff its outputs are **byte-identical to a clean build from the same inputs**. The "minimal but incorrect" quadrant does little work but produces wrong output — caused by **under-approximation** (a missing edge), which confidently skips the rebuild that mattered.
3. E.g. **a C compile discovering which headers it `#include`s** — knowable only by parsing the source, i.e. by running the action. A static engine must either over-approximate (depend on all headers) or under-approximate (depend on none → stale). `-MMD` emits the real deps *as a side effect* of compiling into `.d`; `-include $(DEPS)` folds them into the graph on the *next* run — a two-pass workaround.
4. **Early cutoff** stops a rebuild from propagating when an action's *output* is unchanged despite a changed input. Editing a comment: `util.c` hash differs → rebuild `util.o`; but `util.o`'s output hash equals last time's → **cut off** → `app` is *not* relinked. Plain `make` can't: the rebuilt `util.o` is always *newer* by mtime, so the change always propagates.
5. Identity. `make` keys a result on a **mutable path + mtime**, which doesn't travel between machines. Bazel keys it on the **hash of (action + input contents)** — an immutable content address. Same key ⇒ same output by construction, so the result is fetchable from a shared cache anywhere.
6. Blast radius: `bazel query 'rdeps(//..., //lib:thelib)'`. Affected tests: `bazel query 'kind(test, rdeps(//..., //lib:thelib))'`.
7. **Under-approximation** — a missing edge / undeclared input — so incremental never marks the affected action dirty, while `clean` forces a full rebuild that happens to be correct. Structural fix: **declare the missing input** (or derive it via depfiles) and **enforce hermeticity (sandboxing)** so undeclared reads fail loudly instead of going stale.

</details>

---

## Cheat Sheet

```
APPROXIMATION (D=declared, T=true inputs)
  D ⊇ T  over   → CORRECT, maybe slow      (safe fallback)
  D ⊊ T  under  → STALE/FLAKY              (never acceptable)
  D = T  exact  → correct + minimal        (the goal; sandboxing keeps you ≥ T)

INCREMENTAL CORRECTNESS
  correct  = outputs byte-identical to a clean build
  minimal  = rebuild only actions whose transitive inputs changed
  danger quadrant = minimal-but-incorrect = under-approximated graph

REBUILDER KINDS (à la Carte)
  dirty-bit   (make)  : trust mtime proxy        → correct only if deps complete
  verify-trace(bazel) : compare recorded input HASHES → correct by construction

DYNAMIC DEPS (knowable only after running the tool)
  make   : .d + -include   (two-pass, over-cautious first build)
  ninja  : depfile + .ninja_deps; restat=1 for mtime early cutoff
  bazel  : declared/discovered inputs, tree artifacts, hermetic sandbox
  shake/buck2 : first-class (need after inspecting a value)

EARLY CUTOFF
  rebuild node → hash its OUTPUT → unchanged ⇒ DON'T propagate (prune subtree)
  needs content-addressed outputs; make can't (rebuilt = newer)

IDENTITY MODEL = the real make-vs-bazel difference
  make  : key = output PATH + mtime   → local, unshareable
  bazel : key = hash(action+inputs)   → global, cacheable, cross-machine

QUERY THE GRAPH (when too big to see)
  bazel query 'deps(//x)'                  what x needs
  bazel query 'rdeps(//..., //x)'          BLAST RADIUS of changing x
  bazel query 'somepath(//x,//y)'          WHY x depends on y
  bazel query 'kind(test, rdeps(//...,X))' affected tests (CI selection)
  bazel aquery 'deps(//x)'                 the actual ACTIONS/commands

BAD-GRAPH DIAGNOSIS
  clean fixes it / -j8 flaky      → missing edge (under) → declare + sandbox
  trivial edit rebuilds world     → over-broad glob/edge → split target
  one node invalidates half       → high-fan-out chokepoint → refactor
```

---

## Summary

- Every build graph is an **approximation** of the true input set. **D ⊇ T** (over) is correct but slow; **D ⊊ T** (under) is stale/flaky. The asymmetry — time vs correctness — means you *always* over-approximate when you can't be exact, and use **sandboxing** to make undeclared inputs invisible so you stay ≥ **T**.
- **Incremental correctness** means outputs identical to a clean build; **minimality** means rebuilding only what truly changed. The lethal quadrant is *minimal but incorrect* — an under-approximated graph. Verifying-trace rebuilders (hash the exact inputs an action consumed) are correct by construction; dirty-bit rebuilders (mtime) are only as correct as their proxy.
- **Dynamic dependencies** (headers, codegen outputs, traversed imports) are knowable only by running the tool. Static engines like `make` fake them with the `.d` + `-include` two-pass; Ninja/Bazel/Buck2 model them natively while staying hermetic.
- **Early cutoff** prunes a rebuild — and its entire downstream subtree — when an action's *output* is byte-identical despite a changed input. It requires content-addressed outputs (Bazel/Buck2) or `restat` + write-if-changed (Ninja); plain `make` can't, because a rebuilt file is always newer.
- The real `make`-vs-Bazel divide is the **identity model**: path+mtime (local, unshareable) vs hash-of-(action+inputs) (global, cacheable). Content-addressing makes a build action a pure function and the cache its memo table — the foundation of cross-machine reuse.
- At **monorepo scale** the graph is millions of nodes split into a target graph (human) and action graph (executed), governed by **visibility** rules, and *queried* (`deps`/`rdeps`/`somepath`/`aquery`) rather than read. `rdeps` is the blast radius and the basis of affected-test CI selection.
- A **bad graph** causes stale/flaky (under-approximation — *`clean` fixes it* is the tell) or slow/noisy builds (over-approximation — broad globs, high-fan-out chokepoints). Flaky builds are almost always **D ≠ T**, not a buggy tool.

Next: [professional.md](professional.md) — operating these graphs in production: debugging "why did/didn't this rebuild?", graph hygiene at org scale, and incrementality as a CI cost lever.

---

## Further Reading

- *Build Systems à la Carte* (Mokhov, Mitchell, Peyton Jones, ICFP 2018) — the formal framework: rebuilders, schedulers, minimality, early cutoff. The senior reference for this entire topic.
- [Bazel — "Query how-to"](https://bazel.build/query/quickstart) and [aquery docs](https://bazel.build/query/aquery) — the query languages above, with real examples.
- *Build in the Cloud: Accurate and Repeatable Builds* (Google Engineering blog) — content-addressing and remote execution from the team that ships it at the largest scale.
- [Ninja manual — "depfile" and "restat"](https://ninja-build.org/manual.html) — how Ninja models discovered deps and mtime early cutoff.

---

## Related Topics

- [01 — Build Fundamentals](../01-build-fundamentals/senior.md) — what the compile/link actions the graph schedules actually do.
- [03 — Make and Descendants](../03-make-and-descendants/senior.md) — Ninja, Bazel, Buck2 as graph engines.
- [07 — Build Caching](../07-build-caching/senior.md) — content-addressed storage and remote caching built on this identity model.
- [10 — Build Performance](../10-build-performance/senior.md) — critical-path optimization and affected-test selection via `rdeps`.
- [professional.md](professional.md) — operating, debugging, and governing these graphs at org scale.
