# Coupling & Cohesion Metrics — Senior Level

> **Roadmap:** [Code Quality Metrics](../README.md) → Coupling & Cohesion Metrics
> *The middle page taught you to measure one class's afferent/efferent coupling and to read LCOM. This page is about the architecture: Martin's package metrics and the Main Sequence, how to find cycles and layering violations in a 4,000-module dependency graph, why two files that never `import` each other can still be the most tightly coupled pair in the system, and connascence as the taxonomy that finally makes "coupling" precise.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Martin's Package Metrics — Instability and Abstractness](#martins-package-metrics--instability-and-abstractness)
4. [The Main Sequence and Distance D](#the-main-sequence-and-distance-d)
5. [SDP and SAP — The Principles That Motivate the Metrics](#sdp-and-sap--the-principles-that-motivate-the-metrics)
6. [Dependency Structure Matrices and the Module Graph](#dependency-structure-matrices-and-the-module-graph)
7. [Cycles, SCCs, and the Big Ball of Mud Signature](#cycles-sccs-and-the-big-ball-of-mud-signature)
8. [Temporal Coupling — The Empirical Complement](#temporal-coupling--the-empirical-complement)
9. [Cohesion Beyond LCOM](#cohesion-beyond-lcom)
10. [Connascence — A Finer-Grained Coupling Taxonomy](#connascence--a-finer-grained-coupling-taxonomy)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **The metrics and structural analyses a senior engineer uses to reason about coupling and cohesion at the scale of packages, modules, and the whole dependency graph — not one class at a time.**

By the middle level you can compute afferent coupling (Ca), efferent coupling (Ce), and fan-in/fan-out for a single unit, and you can read an LCOM score. That is the *local* view. The senior jump is to the *global* one: you now look at a dependency graph with thousands of nodes and ask which way the arrows should point, which components are load-bearing and must stay stable, which are cyclically entangled and therefore can't be built, tested, or deployed independently, and where the architecture has quietly decayed into a "big ball of mud."

Robert C. Martin's package metrics give you the quantitative spine for this. Instability and abstractness, plotted against the **Main Sequence**, turn "is this dependency healthy?" into a coordinate you can compute and trend. But structural metrics see only `import`/`#include`/`using` edges — and the most expensive coupling in a real system is often *invisible* to them: two files with no shared symbol that nonetheless change together in 80% of commits. That is **temporal (logical) coupling**, and it is the empirical complement to everything structural. We finish with **connascence** — the taxonomy that decomposes "coupling" into kinds you can rank by strength, so "reduce coupling" becomes a concrete, ordered set of moves rather than a slogan.

---

## Prerequisites

- **Required:** You've internalized [middle.md](middle.md) — Ca/Ce, fan-in/fan-out, LCOM, the difference between content/common/control/stamp/data coupling.
- **Required:** Comfort with directed graphs: cycles, strongly connected components, topological sort, transitive closure.
- **Helpful:** You've felt a real cyclic dependency — two packages that won't compile apart, or a test you couldn't write because the unit dragged half the system in with it.
- **Helpful:** Basic familiarity with reading `git log` history; we use it for temporal coupling.

---

## Martin's Package Metrics — Instability and Abstractness

Martin's insight (from *Designing Object-Oriented C++ Applications* and later *Clean Architecture*) is that the *package* — or component, the deployable/releasable unit — is the right granularity for dependency management, and that two numbers characterize a package's position in the dependency graph.

Reuse the coupling counts from middle.md, now scoped to a package boundary:

- **Ca — Afferent coupling:** the number of classes *outside* this package that depend on classes *inside* it. Arrows pointing **in**. These are your *responsibilities* — who you'd break if you changed.
- **Ce — Efferent coupling:** the number of classes *inside* this package that depend on classes *outside* it. Arrows pointing **out**. These are your *dependencies* — who can break you.

From these comes the first key metric:

```
Instability   I = Ce / (Ca + Ce)        I ∈ [0, 1]
```

- **I = 0** — *maximally stable*. Nothing this package depends on (Ce = 0); many things depend on it (Ca > 0). It is hard to change because change ripples outward to every dependent. Think of a core domain library or a logging interface.
- **I = 1** — *maximally unstable*. It depends on others (Ce > 0) but nothing depends on it (Ca = 0). It is easy to change because no one is downstream. Think of `main`, a top-level application module, an executable's entry point.

"Stable" here is **not a value judgment** — it means *resistant to change*, in the mechanical sense that many things would have to move if it moved. A stable package isn't "good"; it's *load-bearing*, and that status carries an obligation we'll get to in SDP. Instability is, deliberately, a measure of *how easy it is to change a component without forcing other components to change* — purely a function of which way the arrows point.

The second metric captures the *nature* of a package, not its position:

```
Abstractness  A = Na / Nc               A ∈ [0, 1]
              Na = number of abstract types (abstract classes + interfaces)
              Nc = total number of types in the package
```

- **A = 0** — entirely concrete. All implementation, no abstractions to extend.
- **A = 1** — entirely abstract. All interfaces and abstract classes, zero implementation.

```bash
# JDepend (Java) computes Ca, Ce, I, A, D per package directly:
jdepend -file report.txt src/

# NDepend (.NET) and ndepend-style queries expose the same as CQLinq metrics.
# For C/C++, Lakos-style "level numbers" and tools like Understand or lattix
# compute the analogous component-level coupling.
```

> **Key insight:** Ca, Ce, and I are properties of a node's *position in the dependency graph* — they say nothing about the code inside. A is the property of the code's *content*. Martin's whole framework is the claim that these two, plotted against each other, must satisfy a relationship — and that's the Main Sequence.

---

## The Main Sequence and Distance D

Here is the argument that ties abstractness to instability. Consider the two pathological corners of the I–A plane:

- **A = 0, I = 0** — *maximally stable AND maximally concrete*. Everyone depends on it, and it's all rigid implementation with no abstractions to extend. You can't change it (too many dependents) and you can't extend it (nothing is abstract). Martin names this corner the **Zone of Pain**. Concrete, heavily-depended-upon code — a giant utility class everyone imports, a schema struct hard-wired across the system — lives here. (Note: stable + concrete is only painful if the package is *volatile*. Genuinely stable concrete things like `String` or `std::vector` sit in this corner and are fine precisely because they never change. The pain is for things that *want* to change but can't.)

- **A = 1, I = 1** — *maximally abstract AND maximally unstable*. It's all interfaces, but nothing depends on it. Abstractions no one uses. Martin names this corner the **Zone of Uselessness**. Dead abstractions, speculative interfaces with zero implementers and zero callers, live here.

Both corners are bad, and they sit at opposite ends of a diagonal. The *good* region is the line connecting the other two corners — (A=0, I=1) and (A=1, I=0):

```
 A
 1 ┌────────────────────────────●  ← Zone of Uselessness (A=1, I=1)
   │ ╲                        ╱     all abstract, nobody depends on it
   │   ╲      (good)        ╱
   │     ╲    region      ╱
   │       ╲  near the  ╱
   │         ╲  line  ╱       MAIN SEQUENCE:  A + I = 1
   │           ╲    ╱
   │  Zone of    ╲╱
   │  Pain      ╱  ╲
 0 ●──────────╱────╲──────────────┐
   0                              1  I
   (A=0, I=0)                  (A=0, I=1)
   stable + concrete          unstable + concrete
   — painful if volatile      — fine: apps, leaf modules
```

That diagonal is the **Main Sequence**, defined by:

```
A + I = 1
```

It encodes a balance: **a package should be abstract in proportion to how stable it is.** A maximally stable package (I → 0) should be maximally abstract (A → 1) — because if everyone depends on it, you want them depending on *abstractions* they can't break, and which can be extended without modifying the stable core (this is exactly the Open/Closed Principle and the Dependency Inversion Principle at component scale). A maximally unstable package (I → 1) should be concrete (A → 0) — it's a leaf, it does real work, no one extends it, abstractions there are just ceremony.

The **Distance from the Main Sequence** quantifies how far a package strays from this balance:

```
D = | A + I − 1 |              D ∈ [0, 1]     (0 = on the line, ideal)
```

(Martin originally wrote `D` normalized as `|A + I − 1| / √2` — the perpendicular distance — but the perpendicular and the simpler `|A + I − 1|` are monotonically equivalent; tools almost universally report the normalized form, often called **D'**, in [0, 1].)

D is the single most useful Martin metric in practice because it's a one-number health score per component with a clear interpretation:

- **D ≈ 0** — the package's abstractness matches its stability. Healthy.
- **D → 1** — the package is in (or near) a zone. Either stable-and-concrete (heading into Pain) or unstable-and-abstract (heading into Uselessness).

```bash
# A typical JDepend gate, conceptually:
#   for each package: assert D < 0.5   (or trend D over releases)
# NDepend equivalent (CQLinq):
#   warnif count > 0 from a in Application.Assemblies
#   where a.DistanceFromMainSequence > 0.3 select a
```

> **Key insight:** The Main Sequence turns a *design heuristic* ("depend on stable abstractions") into a *coordinate*. You don't need to argue about whether a component is well-placed — you compute (I, A), plot it, and read its distance from the line. The two zones aren't arbitrary scolding; they're the two ways the abstract/stable balance can break.

**What D predicts, and its limits.** D reliably flags *structural* design smells: a concrete god-package everyone depends on (Zone of Pain) is genuinely rigid, and a cloud of unused interfaces (Zone of Uselessness) is genuinely waste. But D has real blind spots a senior must hold in mind:

- It counts *types*, so `A` is gameable — split one fat concrete class into ten and `Nc` changes; add empty marker interfaces and `Na` rises without improving anything. A is a *ratio of type kinds*, not a measure of whether the abstractions are good.
- It is blind to *intra-package* quality. A package can sit perfectly on the Main Sequence (D = 0) and still be an unmaintainable mess inside — high cyclomatic complexity, zero cohesion, untested. D is about a package's *relationship to the graph*, nothing about its internals.
- "Abstract type" is language- and convention-dependent. In Go (structural interfaces), Python (duck typing, ABCs), or Rust (traits), "count the abstract types" is fuzzier than in Java/C#, so A and therefore D are less crisp.

Use D as a *radar for components worth inspecting*, never as a grade.

---

## SDP and SAP — The Principles That Motivate the Metrics

The metrics aren't arbitrary; they're the operational form of two component-design principles. Knowing the principles is what lets you act on a bad number instead of just reporting it.

**The Stable Dependencies Principle (SDP): depend in the direction of stability.**

> A component should only depend on components *more stable than itself* (lower I).

Formally: for an edge A → B, you want `I(A) ≥ I(B)`. Dependencies should flow from less-stable (volatile, high-I) components toward more-stable (low-I) ones. The rationale is mechanical: if a volatile component depends on a stable one, changes to the volatile thing don't disturb the stable thing, and the stable thing rarely changes so it rarely forces the volatile one to. But if you invert it — a *stable* component depending on a *volatile* one — then every change to the volatile thing ripples up into the thing everyone else depends on. You've made an unstable foundation, and the instability propagates through the whole dependency graph.

An **SDP violation** is an edge A → B where `I(A) < I(B)` — a more-stable component depending on a less-stable one. These are exactly the dependencies worth hunting: they're how a "stable" core gets secretly destabilized. The metric makes them computable: compute I for every node, then scan every edge for the inequality.

**The Stable Abstractions Principle (SAP): a component should be as abstract as it is stable.**

> Stable components should be abstract (so they can be extended without modification); unstable components should be concrete.

SAP is *exactly the Main Sequence*, restated as a principle: `A ≈ 1 − I`. It exists to resolve the tension SDP creates. SDP says "depend on stable things," but if the stable things are *concrete*, you've just built the Zone of Pain — a rigid, undependable-upon-safely core. SAP completes it: make the stable things *abstract*, so depending on them means depending on interfaces (which don't change and can be extended), satisfying the **Dependency Inversion Principle** at the component level. SDP + SAP together are the architectural form of DIP: high-level policy and low-level detail both depend on abstractions, and the abstractions are exactly where the stability concentrates.

```
SDP:  edges should point toward LOWER instability     (I decreases along arrows)
SAP:  stability should come WITH abstractness         (A ≈ 1 − I)
together ⇒ Dependency Inversion at component scale: depend on stable abstractions
```

> **Key insight:** I tells you which way arrows *should* point (SDP); A tells you what a stable node *should be made of* (SAP); D measures the combined failure. When you see a high-D component, the principles tell you the fix: if it's stable-and-concrete (Zone of Pain), introduce abstractions and invert the dependency so callers depend on an interface; if it's unstable-and-abstract (Zone of Uselessness), the abstraction is speculative — delete it or find it a real implementer and caller.

---

## Dependency Structure Matrices and the Module Graph

Plotting individual components on the Main Sequence tells you about nodes. To reason about the *shape of the whole graph* — layering, cycles, where the architecture's seams are — the senior tool is the **Dependency Structure Matrix (DSM)**, drawn from Don Steward's design-structure-matrix work and popularized for software by Lattix and Sonargraph.

A DSM is the **adjacency matrix of the dependency graph, with the same ordering on rows and columns.** Rows and columns are the modules; cell (i, j) is non-empty (often the *count* of dependencies) if module in row i depends on module in column j (conventions vary; we'll use *row depends on column*). The power of the DSM is that **graph structure becomes visual matrix structure:**

```
        A   B   C   D   E          Interpretation
    A [     5           ]          A depends on B (5 refs)
    B [             3   ]          B depends on D
    C [ 2       2       ]          C depends on A and on C? no — on A, D
    D [                 ]          D depends on nothing  ← stable (I=0)
    E [ 1   1   1   1   ]          E depends on everyone ← unstable (I high)
```

The two readings every senior should be able to do at a glance:

1. **A strict layering shows as a triangular matrix.** If you can order the modules so that *all* dependencies fall on one side of the diagonal (say, strictly below it — every module depends only on modules ordered after it), the system is **acyclically layered**. The topological sort *is* that ordering. A perfectly layered architecture has an all-below-diagonal (lower-triangular) DSM, and a topo-sort exists. This is the visual proof of "no cycles."

2. **A dependency *above* the diagonal (in the lower-triangular convention) is a back-edge — a layering violation or a cycle.** Once you've ordered modules into intended layers, any mark on the wrong side of the diagonal is a dependency pointing the "wrong way" through your layers — UI depending on something that depends back on UI, or a low layer reaching up into a high one. The DSM makes these pop out as marks where there should be none.

```
Layered (good): lower-triangular        Cyclic/violations (bad): marks above diagonal
        A  B  C  D                               A  B  C  D
    A [             ]                        A [    X        ]   A→B
    B [ X           ]                        B [          X  ]   B→D
    C [ X  X        ]                        C [ X           ]   C→A
    D [ X  X  X     ]                        D [    X        ]   D→B  ← B↔D cycle, C→A back-edge
    all deps below diagonal ⇒ topo-sortable   marks both sides ⇒ no clean layering
```

DSM tools add two more moves on top of this:

- **Partitioning** automatically reorders rows/columns to push as many marks as possible below the diagonal, *revealing* the natural layering and surfacing the residual cycles you can't order away. (Reordering to minimize above-diagonal marks is itself NP-hard in general; tools use heuristics.)
- **Aggregation** lets you collapse a subtree (a whole package's sub-packages) into a single cell, so you can analyze a 4,000-class system at the 50-component level, then drill in. This hierarchical view is what makes DSMs usable at architecture scale where a node-link diagram would be an unreadable hairball.

> **Key insight:** A DSM is just the adjacency matrix, but ordering it turns architecture into geometry. **Below-diagonal-only = layered and acyclic = good. Marks on both sides = cycles and layering violations = the architecture has no clean topological order.** It's the most information-dense view of a dependency graph that still fits on a screen.

---

## Cycles, SCCs, and the Big Ball of Mud Signature

The single most damaging structural property a module graph can have is a **dependency cycle**. Martin's **Acyclic Dependencies Principle (ADP)** states it bluntly: *the dependency graph of components must be a DAG — no cycles.* The reason is operational, not aesthetic:

- **You can't build or test the cyclic group independently.** If A depends on B and B depends on A, you cannot compile, version, or test either alone — they are effectively *one* unit that has been lied about as two. The cycle defeats the entire point of having separate components.
- **The cycle is the unit of change.** A change anywhere in a cycle can force a re-test (and a re-release) of *everything* in the cycle. Three packages in a cycle behave, for every practical purpose, as one big package — but without the honesty of being one.

Formally, **cycles correspond to Strongly Connected Components (SCCs)** of the dependency graph: a maximal set of nodes where every node is reachable from every other. A cyclic dependency *is* an SCC of size > 1. The senior's structural-analysis workhorse is therefore SCC detection:

```python
# Tarjan's algorithm: find all SCCs in one linear-time DFS pass.  O(V + E).
# Any SCC with len > 1 is a dependency cycle — the thing to break.
import networkx as nx

g = nx.DiGraph()                       # build from import edges
for src, dst in import_edges:
    g.add_edge(src, dst)

cycles = [scc for scc in nx.strongly_connected_components(g) if len(scc) > 1]
for c in sorted(cycles, key=len, reverse=True):
    print(f"cycle of {len(c)} modules: {sorted(c)}")

# Condensing the graph by SCC yields the DAG of "super-nodes" — your true layering.
dag = nx.condensation(g)               # collapses each SCC to one node; result is acyclic
```

Once you have the SCCs, two metrics quantify the damage:

- **SCC size distribution.** A healthy architecture: every SCC has size 1 (the condensed graph equals the original — a clean DAG). A decaying one: a few small 2–3 node cycles. A **big ball of mud**: one giant SCC containing a large fraction of all modules — meaning most of the codebase is one tangled, mutually-dependent blob with no internal structure you can build or reason about separately.

- **Propagation cost / cumulative dependency.** Compute the **transitive closure** and ask: on average, how many modules does a change to one module potentially reach? In MacCormack/Baldwin/Rusnak's *core periphery* analysis, this is the **propagation cost** — the density of the transitive-closure matrix. A low propagation cost means changes stay local; a high one (a large, dense transitive closure) is the quantitative signature of a tightly-coupled, mud-like architecture. John Lakos's *Large-Scale C++ Software Design* makes the same argument with **levelization** and **Cumulative Component Dependency (CCD)**: sum, over all components, of the number of components each depends on (transitively, including itself). A binary tree of N components has CCD ≈ N·log N; a fully cyclic blob has CCD ≈ N². The ratio of actual CCD to the ideal (the **Normalized CCD**) is a single number for "how levelizable is this system."

**The big ball of mud signature**, then, is a *cluster* of correlated symptoms — recognize it as a pattern, not a single number:
1. one dominant SCC swallowing a large share of modules,
2. high propagation cost / NCCD ≫ 1 (most changes reach most of the system),
3. a DSM that can't be made triangular (marks on both sides no matter how you reorder),
4. and — the empirical tell from the next section — pervasive temporal coupling across modules that have no structural reason to be related.

> **Key insight:** Cycles aren't a style nit; an SCC of size > 1 is a set of components that *are secretly one component*. Break cycles by **dependency inversion** (introduce an interface in the more-stable component and have the other depend on it — the arrow flips) or by **extracting** the shared reason-to-cycle into a new component both depend on. Condense by SCC and you recover the DAG that tells you the real, build-able layering.

---

## Temporal Coupling — The Empirical Complement

Every metric so far reads *structure* — `import`, `#include`, `using`, call edges. But structure misses an entire dimension of coupling. Consider two files with **no shared symbol, no import, nothing the compiler or a DSM can see** — and yet, across the last 2,000 commits, whenever one changed, the other changed in the *same commit* 85% of the time. They are coupled. The compiler just can't see it, and neither can any structural metric.

This is **temporal coupling** (also *logical coupling* or *change coupling*), and it is the empirical complement to structural coupling. It's mined from version-control history rather than source: parse `git log`, and for every pair of files (or modules) count how often they co-occur in commits.

```
Degree of temporal coupling between files X and Y:

           commits that touched BOTH X and Y
  TC(X,Y) = ─────────────────────────────────       (a confidence / Jaccard-style ratio)
           commits that touched X OR Y

  (often reported as the conditional "% of X's commits that also touched Y",
   alongside the absolute shared-commit count so rare pairs don't dominate.)
```

```bash
# Crude temporal-coupling sketch from git: pairs of files that co-change a lot.
git log --name-only --pretty=format:%H --since="1 year ago" \
  | awk 'NF==1{c=$0;next}{print c,$0}' \
  | sort \
  | ... # group by commit, emit file pairs, count co-occurrences, divide by per-file totals
# In practice use code-maat (Tornhill) or CodeScene, which do exactly this rigorously:
#   maat -l logfile.log -c git2 -a coupling
```

Why this matters so much to a senior:

- **It catches coupling that crosses every architectural boundary you drew.** Copy-paste duplication, a shared implicit protocol (file A writes a format file B parses), a feature smeared across a controller + a template + a config + a migration — none of these create an `import` edge, all of them create change coupling. Temporal coupling finds them; structural metrics never will.
- **It catches *missing* abstraction.** If `OrderService` and `OrderValidator` always change together, that's plausibly correct (they're one concept). But if `OrderService` and `ShippingLabelPdfRenderer` always change together with no import between them, you've found a hidden dependency — likely a leaked concept or an implicit contract that *should* be made explicit (a shared type, an event) so the coupling becomes visible and managed.
- **It is predictive.** Co-change is one of the strongest empirical predictors of where defects cluster, which is precisely why it anchors the next topic. Two structurally-clean files that always change together are a *risk*, because a developer touching one and forgetting the other introduces an inconsistency bug.

The deep point: **structural coupling is what the code says; temporal coupling is what the code does.** They disagree constantly. A pair can be structurally coupled but never co-change (a stable dependency — fine). A pair can be structurally independent but always co-change (hidden coupling — dangerous, *invisible to every metric in the first half of this page*). The senior reads both and pays special attention to the disagreements.

> **Key insight:** Files that change together are coupled — even with zero shared code. Temporal coupling is the only lens that sees copy-paste, implicit contracts, and smeared-out features, because it measures *behavior over time* instead of *structure at an instant*. The full treatment — mining it, the churn × complexity hotspot, and using it to prioritize — is [04 — Code Churn & Hotspots](../04-code-churn-and-hotspots/senior.md).

---

## Cohesion Beyond LCOM

Cohesion is "how related are the things inside this module?" The junior/middle tiers gave you **LCOM** (Lack of Cohesion of Methods, Chidamber & Kemerer). At the senior level you need to know *why LCOM is criticized*, what the better interpretations are, and where the metric runs out.

**Recall the connectivity interpretation.** The most defensible LCOM variant — **LCOM4** (Hitz & Montazeri) — models a class as a graph: nodes are methods and fields; draw an edge between two methods if they access a common field, or between a method and a field it accesses, or between two methods if one calls the other. **LCOM4 = the number of connected components of that graph.**

```
LCOM4 = number of connected components in the method/field access graph

  LCOM4 = 1   one connected blob   → cohesive (every method ties into the rest)
  LCOM4 = 2   two disjoint islands → the class is really TWO classes glued together
  LCOM4 = k   k independent groups → split into k classes
```

This is the *useful* reading: **LCOM4 > 1 is a concrete refactoring signal** — the connected components are literally the classes you'd extract. A class where `{a(), b(), fieldX}` form one island and `{c(), d(), fieldY}` form another has two unrelated responsibilities welded together; the metric hands you the cut.

**Why LCOM is noisy and criticized.** Despite that, treat *any* LCOM number with suspicion:

- **The original C&K LCOM (LCOM1/2) is badly behaved.** It's defined as (pairs of methods sharing no field) − (pairs sharing ≥1 field), floored at 0. It produces *zero* for many obviously non-cohesive classes (any sharing cancels it out), can't distinguish wildly different structures, and isn't normalized — so its absolute value is nearly meaningless. Henderson-Sellers' LCOM* (LCOM5) normalizes to [0, 1] but has its own degenerate cases.
- **It conflates "uses a field" with "is conceptually related."** Two methods can be deeply related conceptually yet share no field (they delegate to collaborators); LCOM calls them disconnected. Conversely, a single shared utility field (a logger, a config) can artificially *connect* otherwise-unrelated methods, hiding genuine non-cohesion. **Constructors and simple accessors** that touch every field can collapse LCOM4 to 1 and mask the problem entirely — many tools exclude them for this reason.
- **It's a syntactic proxy for a semantic property.** Cohesion is ultimately about *concepts*, and field-access graphs are a crude stand-in for "do these things belong to one idea."

**Semantic cohesion** is the response to that last point. Instead of field access, measure conceptual relatedness from the *text* — identifiers, comments, types — using information retrieval. **C3 (Conceptual Cohesion of Classes)** applies Latent Semantic Indexing to method bodies: methods that talk about the same domain vocabulary are cohesive even if they share no field. Modern variants use code embeddings. Semantic cohesion catches the case structural LCOM misses — a class whose methods all concern "invoicing" but reach that concern through different collaborators — at the cost of being fuzzier and tool-heavy.

> **Key insight:** Prefer **LCOM4 (connected components)** over the original LCOM — it's the one with an actionable interpretation: the component count *is* the number of classes to split into. But never gate on an LCOM number: it's a syntactic proxy that's blind to delegation and fooled by shared utility fields. Use it to *find candidates*, then judge cohesion the way it's actually defined — by **concept** — which is what semantic cohesion tries (imperfectly) to automate.

---

## Connascence — A Finer-Grained Coupling Taxonomy

The classic coupling taxonomy (content > common > control > stamp > data, from middle.md) is coarse and structural. **Connascence** — coined by Meilir Page-Jones in *What Every Programmer Should Know About Object-Oriented Design* — is a richer framework that asks a sharper question: *two pieces of code are connascent if changing one requires changing the other to keep the system correct.* It then classifies that relationship along **three independent axes**, which is what makes it a *tool* rather than a vocabulary.

**Axis 1 — Strength (static, then dynamic, weakest to strongest):** how hard the coupling is to discover and refactor. The **static** forms (visible in the source, detectable by tooling) are weaker than the **dynamic** forms (manifest only at runtime), because static connascence is local and toolable while dynamic connascence is spooky-action-at-a-distance.

```
STATIC  (visible in source — weaker, refactor toward these)
  CoN  Connascence of Name      both must agree on a NAME (call a method by its name)
  CoT  Connascence of Type      both must agree on a TYPE (a param's type)
  CoM  Connascence of Meaning   both must agree on the MEANING of a value
                                  (0 = inactive, 1 = active — a magic number/convention)
  CoP  Connascence of Position  both must agree on ORDER (positional args; tuple layout)
  CoA  Connascence of Algorithm both must agree on an ALGORITHM
                                  (hash on both sides; a checksum; a serialization format)
─────────────────────────────────────────────────────────────────────────
DYNAMIC (only at runtime — stronger, the dangerous ones)
  CoE  Connascence of Execution order  operations must happen in a certain ORDER
                                        (must call open() before read())
  CoTm Connascence of Timing           timing matters (a race; a timeout; sleep-then-check)
  CoV  Connascence of Value            several values must change TOGETHER to stay valid
                                        (start < end; replicas of a constant; a sum-to-100)
  CoI  Connascence of Identity         must refer to the SAME instance
                                        (two refs that must point at one shared object)
```

The strength ordering matters because it gives **refactoring a direction**: when you must couple, *prefer weaker (more static, higher in the list) connascence.* The canonical move: replace **Connascence of Position** (positional arguments — caller and callee silently coupled on order) with **Connascence of Name** (named/keyword arguments, or a parameter object — coupled only on names, which the compiler checks). You haven't removed coupling; you've *downgraded its strength* into a form that's local and tool-checkable.

**Axis 2 — Locality:** how far apart the connascent elements are. The *same* kind of connascence is far more acceptable inside one function or class than across module or service boundaries. Connascence of Meaning between two lines of one method is trivial; the same Connascence of Meaning between a producer service and a consumer service (both hardcoding that `status == 3` means "shipped") is a latent production incident. **Stronger connascence is tolerable only at short locality.** This is the axis that connects connascence back to encapsulation: good module boundaries *contain* strong connascence and expose only weak connascence across the boundary.

**Axis 3 — Degree:** how many elements are bound by the connascence. Two call sites agreeing on an argument order is low degree; *two hundred* call sites all positionally coupled to one signature is high degree — the same kind of connascence, but the cost of changing it scales with the count. Degree is what turns a tolerable coupling into an unrefactorable one.

These combine into a single, usable rule:

```
PAGE-JONES' GUIDELINES:
  1. Minimize OVERALL connascence by encapsulating into well-bounded units.
  2. Minimize connascence that CROSSES boundaries (locality):
        strong connascence across a boundary is the real danger.
  3. Within a boundary, convert STRONG connascence to WEAKER forms
        (e.g. Position → Name; Meaning → Type via an enum).
```

This is *why* the framework is more useful than "reduce coupling": it tells you which coupling is worst (strong + remote + high-degree) and which direction to push it (toward static, local, low-degree). It subsumes a lot of received wisdom: "don't use magic numbers" is *Connascence of Meaning, kill it with a named constant or enum (→ Type)*; "prefer keyword args" is *Position → Name*; "encapsulate" is *keep strong connascence at short locality*; a microservice sharing an implicit status-code convention with its consumers is *Connascence of Meaning at the worst possible locality with high degree* — exactly the kind that surfaces as **temporal coupling** with no `import` between the services.

> **Key insight:** Connascence makes "coupling" a *measurable, rankable* property along three axes — strength (static→dynamic), locality, degree. The senior move isn't "remove coupling" (impossible) but **"keep strong connascence local, and where it must be remote, weaken its form."** It's the finest-grained coupling lens we have, and it explains *why* the same dependency can be harmless in one place and catastrophic in another.

---

## Mental Models

- **Instability is a property of arrows, abstractness a property of contents.** I = Ce/(Ca+Ce) says only which way the dependency edges point; A = Na/Nc says only what kinds of types live inside. The Main Sequence (A + I = 1) is the claim that these two must *match*: be abstract in proportion to how depended-upon you are.

- **The two zones are the two ways the balance breaks.** Stable + concrete = Zone of Pain (rigid, can't change, can't extend). Unstable + abstract = Zone of Uselessness (abstractions nobody uses). D = |A + I − 1| measures how far you've slid toward either.

- **An SCC of size > 1 is components lying about being separate.** A dependency cycle is a set of modules that *are* one module — you can't build, test, or release them apart. Condense by SCC to recover the real DAG; break cycles with dependency inversion.

- **A DSM is architecture as geometry.** Order the adjacency matrix into layers: below-diagonal-only means acyclic and topo-sortable (good); marks on both sides mean cycles and layering violations (the architecture has no clean order).

- **Structural coupling is what the code says; temporal coupling is what it does.** The compiler sees imports; history sees co-change. Their *disagreements* — files that change together with no shared symbol — are the coupling no static metric can find, and often the most expensive.

- **Coupling has a strength gradient (connascence).** Not all coupling is equal: static < dynamic, local < remote, low-degree < high-degree. You don't eliminate coupling; you push it toward the weak, local, low-degree corner.

---

## Common Mistakes

1. **Reading "stable" as "good" and "unstable" as "bad."** Instability is mechanical — resistance to change because of inbound dependents. `main` *should* be maximally unstable (I=1); a core abstraction *should* be stable (I=0). The error is treating I as a quality grade instead of a position in the graph.

2. **Gaming abstractness.** Because A = Na/Nc counts types, you can move D by splitting concrete classes or adding empty marker interfaces — improving the number while improving nothing. A measures *kinds of types*, not whether the abstractions are real.

3. **Treating D as a grade per file.** D measures a component's *relationship to the dependency graph*. A package can sit exactly on the Main Sequence (D=0) and be an untested, high-complexity mess inside. D flags components to *inspect*, never assigns a quality score.

4. **Tolerating "small" cycles.** A two-package cycle is still an SCC: those two packages can't be built, versioned, or tested independently. There is no benign cycle in a component graph — break it (dependency inversion or extract-the-shared-reason), don't rationalize it.

5. **Believing structural metrics see all coupling.** Ca/Ce, I, A, DSMs — all read only declared dependencies. Copy-paste, implicit file-format contracts, and features smeared across layers create *zero* structural edges and enormous temporal coupling. If you only measure structure, you're blind to a whole class of the worst coupling.

6. **Gating on raw LCOM.** The original C&K LCOM is unnormalized and returns 0 for many non-cohesive classes; accessors and constructors collapse even LCOM4 to 1. Use LCOM4's connected-components *as a candidate finder*, then judge cohesion by concept — don't fail a build on an LCOM threshold.

7. **Saying "reduce coupling" without naming the connascence.** "Too coupled" isn't actionable. "Connascence of Position across a service boundary at degree 40" is — it tells you the kind (Position), the danger (remote locality), the scale (degree), and the fix (→ Name, or contain it). Diagnose the *kind* of coupling before prescribing.

---

## Test Yourself

1. A package has Ca = 20, Ce = 0. Compute I. Is it stable or unstable, and what *obligation* does that place on it (which principle, and what should it be made of)?
2. Define the Main Sequence and the Distance D. What do the two endpoints of the line represent, and what are the two zones the line avoids?
3. State the Stable Dependencies Principle as an inequality on I, and describe what an SDP *violation* edge looks like and why it's dangerous.
4. You have a DSM you've ordered into intended layers. What does a mark *above* the diagonal mean (lower-triangular convention), and how is a clean layered architecture's DSM shaped?
5. Two files share no import but co-change in 80% of commits that touch either. Name this kind of coupling, explain why no structural metric detects it, and give two real causes.
6. Why is LCOM4 preferable to the original C&K LCOM, and what concrete refactoring does an LCOM4 of 3 suggest? Name one way LCOM4 can be fooled.
7. A caller and callee are coupled on positional argument order across a module boundary, at 60 call sites. Classify this on connascence's three axes and give the standard refactor.

<details>
<summary>Answers</summary>

1. **I = Ce/(Ca+Ce) = 0/(20+0) = 0** — maximally **stable** (everyone depends on it, it depends on nothing; hard to change because change ripples to all 20 dependents). By the **Stable Abstractions Principle**, a stable component should be **abstract** (A → 1) — made of interfaces/abstract types — so its many dependents depend on extensible abstractions they can't break. Stable + concrete would put it in the Zone of Pain.

2. **Main Sequence: A + I = 1** — the line where abstractness balances stability. **D = |A + I − 1|** (normalized to [0,1]), the distance from that line; 0 is ideal. Endpoints: **(A=0, I=1)** = unstable, concrete leaf (apps, `main` — fine) and **(A=1, I=0)** = stable, abstract core (interfaces everyone depends on — fine). The two avoided corners: **Zone of Pain** (A=0, I=0: stable + concrete = rigid) and **Zone of Uselessness** (A=1, I=1: abstract + nobody depends on it = waste).

3. **SDP:** for every edge A → B, `I(A) ≥ I(B)` — depend only on things at least as stable as yourself. A **violation** is an edge where `I(A) < I(B)`: a *more-stable* component depending on a *less-stable* one. Dangerous because every change to the volatile dependency ripples up into the stable component (and thus into everything that depends on *it*) — you've put an unstable foundation under the things that are supposed to be solid.

4. A mark above the diagonal is a **back-edge** — a dependency pointing the "wrong way" through your layers, i.e. a **layering violation or part of a cycle** (a higher/earlier-ordered module being depended on by a lower one, or mutual dependency). A clean layered, acyclic architecture has a **lower-triangular** DSM: every dependency falls below the diagonal, which is exactly the existence of a topological sort.

5. **Temporal (logical / change) coupling.** No structural metric (Ca/Ce, I, DSM) detects it because there is **no declared dependency** — no import, no shared symbol — for the compiler or a static analyzer to see; it's only visible in *version-control history* (co-change frequency). Causes: copy-paste duplication; an **implicit contract** (file A writes a format file B parses); a single feature **smeared** across controller + template + config + migration; parallel data structures that must be kept in sync.

6. **LCOM4 = number of connected components** of the method/field access graph — it's **normalized to a meaningful integer with an actionable interpretation**, unlike the original C&K LCOM (unnormalized, returns 0 for many non-cohesive classes, can't distinguish structures). **LCOM4 = 3** means the class is really **three independent classes** glued together — split it along the three connected components. It's **fooled** by methods that touch every field (constructors, accessors) or a shared utility field (a logger), which artificially connect otherwise-unrelated method groups into one component.

7. **Connascence of Position** (the *kind*/strength — a static form, but a strong one), **remote locality** (it crosses a module boundary — the dangerous combination), **degree 60** (60 bound call sites — expensive to change). Standard refactor: **convert Position → Name** — use named/keyword arguments or introduce a **parameter object**, so caller and callee are coupled only on field *names* (compiler-checked, reorder-safe) instead of silent positional order.

</details>

---

## Cheat Sheet

```
MARTIN'S PACKAGE METRICS (per package/component)
  Ca  afferent  = #external classes depending ON this   (arrows IN  → responsibilities)
  Ce  efferent  = #classes here depending on OUTSIDE     (arrows OUT → dependencies)
  I   = Ce/(Ca+Ce)      ∈[0,1]  0=max STABLE (hard to change)  1=max UNSTABLE (leaf)
  A   = Na/Nc           ∈[0,1]  abstract types / total types
  D   = |A + I − 1|     ∈[0,1]  distance from Main Sequence;  0 = ideal

MAIN SEQUENCE & ZONES
  line:  A + I = 1      (be abstract in proportion to how depended-upon you are)
  Zone of Pain        A=0,I=0  stable+concrete   → rigid (introduce abstractions, invert dep)
  Zone of Uselessness A=1,I=1  abstract+unused   → waste (delete or give it a real user)

PRINCIPLES
  SDP  depend toward stability:  edge A→B ⇒ I(A) ≥ I(B)   (violation: I(A) < I(B))
  SAP  stable ⇒ abstract:  A ≈ 1 − I     (SDP + SAP = Dependency Inversion at scale)
  ADP  the component dependency graph MUST be a DAG (no cycles)

DEPENDENCY STRUCTURE MATRIX (DSM)
  adjacency matrix, same order rows/cols;  cell(i,j) = i depends on j
  lower-triangular only        ⇒ acyclic & layered (topo-sort exists)   GOOD
  marks above diagonal         ⇒ back-edges = cycles / layering violations  BAD
  partition (reorder) to reveal layers;  aggregate to view at component scale

CYCLES
  cycle ⇔ SCC of size > 1   (find via Tarjan, O(V+E));  condense graph ⇒ real DAG
  big ball of mud = one giant SCC + high propagation cost (dense transitive closure)
  Lakos CCD: Σ transitive deps;  NCCD = CCD/ideal;  high NCCD = un-levelizable
  break cycles by: dependency INVERSION (flip an edge via interface) or EXTRACT shared core

TEMPORAL (LOGICAL) COUPLING  — from git history, not source
  TC(X,Y) = co-change commits / (commits touching X or Y)
  finds coupling with NO import: copy-paste, implicit contracts, smeared features
  → ../04-code-churn-and-hotspots/  (mining, churn×complexity hotspot, prioritizing)

COHESION
  LCOM4 = # connected components of method/field graph
          1 = cohesive;  k = split into k classes  (better than C&K LCOM1/2)
          fooled by constructors/accessors/shared logger field
  semantic cohesion (C3 / LSI / embeddings) = relatedness by VOCABULARY, not field access

CONNASCENCE  (changing one forces changing the other)
  STRENGTH (static→dynamic): Name < Type < Meaning < Position < Algorithm
                             | Execution < Timing < Value < Identity
  LOCALITY: strong connascence OK if local, dangerous across boundaries
  DEGREE:   #elements bound;  high degree = expensive to change
  RULE: keep strong connascence LOCAL; across boundaries WEAKEN it (Position→Name)
```

---

## Summary

- **Martin's package metrics** characterize a component by its position and content: **Instability I = Ce/(Ca+Ce)** (0 = maximally stable/load-bearing, 1 = maximally unstable/leaf) and **Abstractness A = Na/Nc**. "Stable" is mechanical resistance to change, not a quality judgment.
- **The Main Sequence (A + I = 1)** says a component should be abstract in proportion to how depended-upon it is. **Distance D = |A + I − 1|** scores the imbalance; the two corners it avoids are the **Zone of Pain** (stable + concrete = rigid) and the **Zone of Uselessness** (abstract + unused = waste). D is a radar for components to inspect, never a grade — A is gameable and D is blind to intra-package quality.
- **SDP** (depend toward stability: `I(A) ≥ I(B)`) and **SAP** (`A ≈ 1 − I`) are the principles behind the metrics; together they are **Dependency Inversion at component scale**. **ADP** demands the component graph be a DAG.
- **DSMs** turn the adjacency matrix into geometry — lower-triangular means acyclic and layered; marks on both sides mean cycles and layering violations. **Cycles are SCCs of size > 1** (find with Tarjan, condense to recover the real DAG); the **big ball of mud** is one giant SCC with high propagation cost.
- **Temporal coupling** — co-change mined from version history — is the empirical complement that sees what structure can't: copy-paste, implicit contracts, smeared features, with *no* import edge between them.
- **Cohesion beyond LCOM:** prefer **LCOM4** (connected components = classes to split into) over the noisy original; ultimately cohesion is about *concept*, which **semantic cohesion** tries to capture. **Connascence** makes coupling rankable along **strength × locality × degree** — the senior move is to keep strong connascence local and weaken it where it must cross boundaries.

You can now read a dependency graph the way a senior does — as positions, zones, layers, cycles, and co-change patterns — and prescribe the *specific* structural move each pathology needs. The next tier, [professional.md](professional.md), is about operating these analyses across an organization: gating, trending, and driving real architectural change without turning the metric into the target.

---

## Further Reading

- *Clean Architecture* — Robert C. Martin. The component-coupling chapters: SDP, SAP, ADP, the Main Sequence, and D, with the original derivation.
- *What Every Programmer Should Know About Object-Oriented Design* — Meilir Page-Jones. The source of connascence and its three axes (strength, locality, degree).
- *Large-Scale C++ Software Design* — John Lakos. Levelization, the acyclic-physical-dependency argument, and Cumulative Component Dependency (CCD/NCCD).
- *Software Design X-Rays* and *Your Code as a Crime Scene* — Adam Tornhill. Temporal/change coupling and behavioral analysis mined from version control (`code-maat`, CodeScene).
- "Exploring the Structure of Complex Software Designs" — MacCormack, Rusnak, Baldwin. DSMs, propagation cost, and the core-periphery / modularity analysis of real codebases.
- Hitz & Montazeri, "Measuring Coupling and Cohesion in Object-Oriented Systems" — the LCOM4 connectivity definition and its critique of C&K LCOM.
- Marcus & Poshyvanyk, "The Conceptual Cohesion of Classes" (C3) — semantic cohesion via Latent Semantic Indexing.

---

## Related Topics

- [junior.md](junior.md) · [middle.md](middle.md) · [professional.md](professional.md) — the rest of this topic's tier set (concepts and per-class Ca/Ce/LCOM at the lower tiers; org-scale operation at professional).
- [04 — Code Churn & Hotspots](../04-code-churn-and-hotspots/senior.md) — temporal coupling in full: mining co-change, the churn × complexity hotspot, why history out-predicts a static snapshot.
- [01 — Cyclomatic & Cognitive Complexity](../01-cyclomatic-and-cognitive-complexity/senior.md) — the *within-module* complexity that D and LCOM are blind to; the other axis of the hotspot.
- [Technical Debt Management](../../technical-debt-management/) — what to actually *do* about a high-D component or a giant SCC: prioritizing, justifying, and paying down the structural debt these metrics surface.
