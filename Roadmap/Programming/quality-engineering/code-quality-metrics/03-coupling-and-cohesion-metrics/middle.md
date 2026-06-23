# Coupling & Cohesion Metrics — Middle Level

> **Roadmap:** [Code Quality Metrics](../README.md) → Coupling & Cohesion Metrics
> *The junior page taught the intuition: low coupling, high cohesion. This page makes both measurable — the classic coupling/cohesion ladders, the fan-in/fan-out counts (Ca/Ce), the Chidamber & Kemerer suite, and LCOM4, the metric that tells you a class is secretly two classes.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [The Coupling Ladder — Six Kinds, Worst to Best](#the-coupling-ladder--six-kinds-worst-to-best)
4. [The Cohesion Ladder — Seven Kinds, Worst to Best](#the-cohesion-ladder--seven-kinds-worst-to-best)
5. [Afferent and Efferent Coupling — Ca and Ce](#afferent-and-efferent-coupling--ca-and-ce)
6. [The CK Suite — CBO, RFC, DIT, NOC](#the-ck-suite--cbo-rfc-dit-noc)
7. [LCOM and LCOM4 — Cohesion as a Graph](#lcom-and-lcom4--cohesion-as-a-graph)
8. [How the Tools Actually Compute This](#how-the-tools-actually-compute-this)
9. [Worked Example — Ca/Ce on a Module Graph, LCOM4 on a Class](#worked-example--cace-on-a-module-graph-lcom4-on-a-class)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What are the named coupling/cohesion metrics, and how do I compute each one by hand?**

At the junior level, "low coupling, high cohesion" is a slogan you can nod along to but not *count*. You can feel that a 400-line `UserManager` is doing too much and that a function reaching into another module's global is a bad smell — but feeling isn't a number, and a number is what survives a code review, a CI gate, or an argument about which class to split first.

This page replaces the feeling with arithmetic. There are two halves. First, the **classic taxonomies** — coupling and cohesion each come in *kinds*, arranged on a ladder from worst to best; naming the rung you're on is half the diagnosis. Second, the **computable metrics** — afferent/efferent coupling (`Ca`/`Ce`), the Chidamber & Kemerer object-oriented suite (CBO, RFC, DIT, NOC), and **LCOM4**, which models a class as a graph and tells you, mechanically, when it should be two classes. Every one of these is something you can compute with a pencil, which is the point: if you can compute it by hand, you understand what the tool is reporting, and you know exactly where it lies.

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and can explain *why* low coupling and high cohesion are desirable.
- **Required:** Comfortable reading a class with fields and methods (any OO language; examples here are language-neutral).
- **Helpful:** You've seen a dependency graph or import graph for a real project.
- **Helpful:** A rough sense of "connected components" in a graph — we'll define it, but prior exposure helps.

---

## The Coupling Ladder — Six Kinds, Worst to Best

**Coupling** is the degree to which one module depends on the internals of another. Structured-design theory (Stevens, Myers & Constantine, 1974) ranks it on a ladder. The lower the rung, the harder the two modules are to change independently. From **worst to best**:

| Rung | Kind | Two modules are coupled by… | One-line example |
|---|---|---|---|
| 1 (worst) | **Content** | one reaching *inside* the other and modifying its internals | Module A writes directly to module B's private variable / jumps into B's code |
| 2 | **Common** | sharing global mutable state | A and B both read and write the same global config object |
| 3 | **Control** | one passing a flag that dictates the other's control flow | `render(thing, isPreview=true)` where the flag picks a code path inside `render` |
| 4 | **Stamp** | passing a whole record when only a field is needed | `applyDiscount(order)` when it only ever touches `order.total` |
| 5 | **Data** | passing only the scalar data actually required | `applyDiscount(total, rate)` — exactly what's used, nothing more |
| 6 (best) | **(no coupling)** | not depending on each other at all | two modules that never reference one another |

The practical reading: **content and common coupling are bugs waiting to happen** — a change in one module silently breaks the other with no compiler warning. **Control coupling** is the classic "boolean parameter" smell; the flag means the caller knows too much about the callee's internals. **Stamp vs data** is subtler — stamp coupling passes a fat object, creating a dependency on its *whole shape* (rename a sibling field and unrelated callers may break), whereas data coupling depends only on the scalars it genuinely uses.

> **Key insight:** The ladder isn't academic trivia — it's a *refactoring direction*. Every rung up is a known move: replace a global with a parameter (common → data), replace a boolean flag with two methods (control → none), pass the field instead of the record (stamp → data). When you name the rung, you've named the fix.

---

## The Cohesion Ladder — Seven Kinds, Worst to Best

**Cohesion** is the degree to which the elements *inside* a single module belong together. Same source, same ranking idea, opposite goal: you want to climb *high*. From **worst to best**:

| Rung | Kind | The module's elements are grouped because… | One-line example |
|---|---|---|---|
| 1 (worst) | **Coincidental** | no meaningful relationship at all | a `Utils` class holding `parseDate`, `sendEmail`, and `sqrt` |
| 2 | **Logical** | they're the same *category* of thing, selected by a flag | one `handleIO(mode)` doing read OR write OR seek by mode |
| 3 | **Temporal** | they happen at the same *time* | a `startup()` that opens the DB, loads config, and warms a cache |
| 4 | **Communicational** | they operate on the same *data* | report code that computes a total and formats that same total |
| 5 | **Sequential** | one's output is the next's input | `parse() → validate() → transform()` chained on one payload |
| 6 (best) | **Functional** | they all contribute to exactly *one* well-defined task | a `computeSalesTax(amount, region)` that does only that |

(Some texts list a seventh rung, *procedural* — grouped by order of execution but on different data — between temporal and communicational. The exact count varies; the *direction* doesn't.)

The reading: **coincidental cohesion is the `Utils`/`Helpers`/`Common` dumping ground** — a class with no theme. **Logical cohesion** is the boolean-parameter smell seen from inside (the flag *selects* which unrelated thing to do). The top three rungs — communicational, sequential, functional — are all "good enough"; **functional** is the target: a module that does one thing has one reason to change, which is the Single Responsibility Principle stated in cohesion terms.

> **Key insight:** Coupling and cohesion are two sides of one coin. Low cohesion *forces* high coupling: a class doing three unrelated jobs must be touched by three unrelated callers and reaches into three unrelated areas. Raise cohesion (split the class along its real responsibilities) and coupling usually falls out of the system on its own. Optimize cohesion first; coupling often follows.

---

## Afferent and Efferent Coupling — Ca and Ce

The ladders are qualitative — you read code and name a rung. The next metrics are **quantitative**: counts you compute from the dependency graph, no judgement required. They were popularized by Robert C. Martin for *packages*, but the same counting applies to any node (class, module, file).

For a unit **X**:

- **Afferent coupling `Ca`** = the number of units **that depend on X** (incoming edges, **fan-in**). "How many things would break if I change X?"
- **Efferent coupling `Ce`** = the number of units **X depends on** (outgoing edges, **fan-out**). "How many things can break X?"

The mnemonic that survives interviews: **A**fferent = **A**rriving (pointing *at* you); **E**fferent = **E**xiting (pointing *out*). Equivalently, `Ca` is fan-in, `Ce` is fan-out.

These two numbers carry different meanings. **High `Ca`** marks a unit as *important and rigid*: lots of code leans on it, so it's expensive and risky to change — exactly what you want for stable abstractions (interfaces, core domain types) and exactly what you fear for volatile ones. **High `Ce`** marks a unit as *dependent and fragile*: it touches many things, so many things can break it, and it's hard to test in isolation.

From the pair, Martin derives **instability**:

```
I = Ce / (Ca + Ce)        range 0..1
```

`I = 0` (only incoming edges) means *maximally stable* — hard to change, depended upon. `I = 1` (only outgoing edges) means *maximally unstable* — easy to change, depends on others. Neither extreme is "bad" by itself; the design rule (the *Stable Dependencies Principle*) is that dependencies should flow **from unstable units toward stable ones** — volatile code may lean on stable code, but stable code should not lean on volatile code. The full treatment of instability, abstractness, and the "main sequence" is the [senior page](senior.md); here, the takeaway is that `Ca` and `Ce` are just edge counts you can read straight off a graph.

> **Key insight:** `Ca` and `Ce` turn "this module feels central / feels fragile" into two integers you can put in a PR comment. A class with `Ca = 40` is not one you refactor casually — forty call sites are watching. A class with `Ce = 30` is not one you can unit-test without a mountain of mocks. The counts tell you *which kind* of caution applies before you touch the code.

---

## The CK Suite — CBO, RFC, DIT, NOC

Chidamber & Kemerer (1994) defined the canonical object-oriented metrics suite. Four of the six are about coupling and the inheritance structure that drives it; every OO quality tool reports them.

- **CBO — Coupling Between Objects.** The number of *other classes* a class is coupled to, counting **both** directions (classes it uses **and** classes that use it), where "coupled" means it calls a method or accesses a field of the other. CBO is essentially the undirected coupling degree of the class. **High CBO** → hard to reuse, hard to test, sensitive to ripple changes. (Contrast with `Ce`, which counts only outgoing dependencies; CBO is bidirectional.)

- **RFC — Response For a Class.** The size of the **response set**: the methods of the class itself *plus* every distinct method those methods call (the first level out). It measures how much can execute in response to a message to an object of this class. **High RFC** → more paths, harder to test and debug, because invoking one method can trigger a large cascade.

- **DIT — Depth of Inheritance Tree.** The length of the path from a class up to the root of its inheritance hierarchy. **Deep DIT** → more inherited behavior to reason about, more fragile-base-class risk; a method's real behavior is scattered up the chain. Shallow is generally easier to understand; very deep hierarchies are a known maintainability hazard.

- **NOC — Number Of Children.** The count of *immediate* subclasses of a class. **High NOC** → the class is a heavily-leveraged base; a change to it ripples into many subclasses, so it needs careful design and thorough tests. High NOC can also signal misuse of inheritance where composition would serve better.

A useful pairing: **DIT** is how *deep* you sit in a hierarchy; **NOC** is how *wide* your subtree fans out directly below you. The other two CK metrics, WMC (Weighted Methods per Class) and LCOM (cohesion), sit elsewhere — WMC is really a complexity metric (see [01 — Cyclomatic & Cognitive Complexity](../01-cyclomatic-and-cognitive-complexity/middle.md)), and LCOM is the cohesion metric we treat next.

> **Key insight:** The CK suite is *structural*, not behavioral — it reads the static shape of your classes (calls, fields, inheritance edges) without running anything. That's its strength (cheap, deterministic, computable from the AST) and its limit: a class can have perfect CK numbers and still be wrong code. Use CK to find *candidates* — high CBO, high RFC, deep DIT — then read the class. The number nominates; a human convicts.

---

## LCOM and LCOM4 — Cohesion as a Graph

Cohesion was the qualitative ladder above; **LCOM (Lack of Cohesion of Methods)** is the attempt to make it a number. *Lack* — so **higher is worse**, the opposite polarity of every other "good" intuition, which trips people up constantly.

The original CK LCOM compared pairs of methods that shared fields versus pairs that didn't — but it produced ugly, hard-to-interpret values (and often just 0). The version worth knowing is **LCOM4** (Hitz & Montazeri), because it has a clean, mechanical definition and an actionable output.

**LCOM4 is a connected-components count.** Build an undirected graph for one class:

- **Nodes:** the class's methods (and, in some formulations, its fields).
- **Edges:** connect two methods if they **access a common field**, or if one **calls the other**.

Then **LCOM4 = the number of connected components** in that graph.

The interpretation is the whole point:

- **LCOM4 = 1** → every method is tied, directly or transitively, to the others through shared state. The class hangs together. *Cohesive.*
- **LCOM4 = 0** → the class has no methods (or none touch state) — degenerate.
- **LCOM4 ≥ 2** → the methods split into ≥ 2 islands that share *nothing*. The class is really *N* classes wearing one name. **Each component is a clean extraction boundary** — split it and your coupling and cohesion both improve in one move.

That last line is why LCOM4 is the cohesion metric to internalize: it doesn't just score the class, it *hands you the cut lines*. A `UserManager` with one cluster of methods touching `email`/`passwordHash` and another touching `cartItems`/`cartTotal` reports LCOM4 = 2 — and the two components are literally the `Account` and the `Cart` you should extract.

> **Key insight:** LCOM4 ≥ 2 is one of the few metrics that is *prescriptive*, not just descriptive. Most metrics say "this looks risky, go investigate." LCOM4 says "this class is exactly these N independent groups — here are the seams." Treat LCOM4 > 1 as a standing invitation to split along the components, and re-measure: each extracted class should come out at LCOM4 = 1.

---

## How the Tools Actually Compute This

You almost never count by hand in anger — you do it once to understand, then let a tool do it at scale. The mechanism is the same across all of them: **parse the code into a graph, then count edges and components.** What differs is the unit and the ecosystem.

- **JDepend** (Java) — the original `Ca`/`Ce`/instability/abstractness reporter, operating at the **package** level. Reads compiled `.class` files, builds the package dependency graph, prints `Ca`, `Ce`, `I`, `A`, and distance-from-main-sequence. The reference implementation of the Martin metrics.
- **Structure101** — commercial; visualizes the dependency graph and, crucially, finds **cycles** and "tangles." Strong at *showing* coupling structure (and architectural violations) rather than just tabulating it.
- **NDepend** (.NET) — the heavyweight: computes CBO-style coupling, `Ca`/`Ce`, instability/abstractness, LCOM/LCOM-HS, and lets you *query* the dependency graph with CQLinq (e.g. "find types with `Ce > 50` and LCOM > 0.8"). Treats metrics as a queryable database.
- **dependency-cruiser** (JavaScript/TypeScript) — works at the **module/file** level on the `import`/`require` graph; you write rules ("nothing in `core/` may depend on `ui/`", "no cycles") and it fails the build on violations. Coupling-as-policy for the JS world.
- **SonarQube** — computes a broad metric set across many languages and folds coupling/cohesion signals into its quality model and ratings; the dashboards in [06 — Code Health Dashboards](../06-code-health-dashboards/middle.md) are largely SonarQube/CodeScene-style aggregations of exactly these numbers.

The unifying idea: every one of these tools is doing the pencil-and-paper procedure from the next section — extract the graph, count fan-in/fan-out, count connected components — just faster and over millions of lines.

---

## Worked Example — Ca/Ce on a Module Graph, LCOM4 on a Class

### Part 1 — Compute `Ca` and `Ce` on a module graph

Take a five-module dependency graph. An arrow `A → B` means **A depends on B** (A imports/calls B):

```
   Auth ───────► Logging
     │             ▲
     ▼             │
   Orders ──► DB ──┘
     │
     ▼
   Email
```

Edge list: `Auth→Logging`, `Auth→Orders`, `Orders→DB`, `Orders→Email`, `DB→Logging`.

Count, per module, **incoming edges = `Ca` (fan-in)** and **outgoing edges = `Ce` (fan-out)**:

| Module | Depends on (out → `Ce`) | Depended on by (in → `Ca`) | `Ca` | `Ce` | `I = Ce/(Ca+Ce)` |
|---|---|---|---|---|---|
| **Auth** | Logging, Orders | — | 0 | 2 | 1.00 |
| **Orders** | DB, Email | Auth | 1 | 2 | 0.67 |
| **DB** | Logging | Orders | 1 | 1 | 0.50 |
| **Email** | — | Orders | 1 | 0 | 0.00 |
| **Logging** | — | Auth, DB | 2 | 0 | 0.00 |

How to read this in seconds:

- **Logging** has `Ca = 2, Ce = 0`, `I = 0` → *maximally stable*. Two modules lean on it and it leans on nothing. Exactly what you want for a foundational utility — and a sign you must **not** make it depend on anything volatile.
- **Auth** has `Ca = 0, Ce = 2`, `I = 1` → *maximally unstable*. Nothing depends on it; it depends on others. Fine for a top-level entry point that's expected to change freely.
- **DB** sits at `I = 0.50` — balanced, and a candidate to watch: a stable-ish thing (`Ca = 1`) that still reaches out (`Ce = 1`).

The dependency direction here is healthy: edges flow from less-stable modules (`Auth`, `Orders`) toward the most-stable one (`Logging`). If `Logging → Auth` existed, a stable module would depend on a volatile one — a *Stable Dependencies Principle* violation, and the kind of thing dependency-cruiser or NDepend would flag.

### Part 2 — Compute LCOM4 on a class

Here is a class that looks like one thing and is actually two. Fields and the methods that touch them:

```
class UserAccount {
  // fields
  email, passwordHash          // (authentication state)
  cartItems, cartTotal         // (shopping-cart state)

  login()        -> reads email, passwordHash
  changePassword()-> reads/writes passwordHash, email
  addToCart()    -> reads/writes cartItems, cartTotal
  checkout()     -> reads cartItems, cartTotal
}
```

Build the LCOM4 graph. Nodes are the four methods; draw an edge between any two methods that **share a field** (or call each other):

- `login` and `changePassword` both touch `email`/`passwordHash` → **edge**.
- `addToCart` and `checkout` both touch `cartItems`/`cartTotal` → **edge**.
- No method in the first pair shares a field with either method in the second pair → **no edges across**.

```
   login ── changePassword          addToCart ── checkout
   └──── component A ────┘          └──── component B ────┘
```

**Connected components: 2 → LCOM4 = 2.** The class is two disjoint islands. LCOM4 ≥ 2 is the signal: **split it**. The components hand you the exact seams — extract `Credentials { email, passwordHash; login(); changePassword() }` and `Cart { cartItems, cartTotal; addToCart(); checkout() }`.

Re-measure after the split: each new class has all its methods sharing its fields → one component each → **LCOM4 = 1** apiece. You moved two classes from "cohesion: coincidental-to-logical" up to "functional," and you did it by following a number, not a hunch.

(One real-world caveat the tools handle: a single utility method that every other method calls — or one field everything touches, like a logger — can artificially glue all components into one, hiding a genuine split. When LCOM4 says 1 but the class still smells like two things, check for a "connector" method or god-field that's bridging otherwise-independent clusters.)

---

## Mental Models

- **Coupling is the wiring between boxes; cohesion is the wiring inside a box.** You want sparse wires between boxes and dense wires inside each one. Every metric here measures one or the other: `Ca`/`Ce`/CBO count the wires *between*; LCOM4 counts how many separate *bundles* of wiring you accidentally crammed into one box.

- **`Ca` is how scary you are to change; `Ce` is how easily others scare you.** High fan-in = important and rigid (many watchers). High fan-out = fragile and untestable (many dependencies). They are different risks and call for different caution.

- **LCOM4 is a "how many classes is this really?" counter.** It returns the number of independent responsibility-islands hiding in one class. `1` means one. `2+` means you've stapled that many classes together — and it tells you where the staples are.

- **The metric nominates; the human convicts.** CK numbers and `Ca`/`Ce` find *candidates* from the static shape of the code. None of them prove a class is bad — they point you at the ones worth reading. A clean number is permission to look elsewhere, not a certificate of quality.

---

## Common Mistakes

1. **Reading LCOM as "more is better."** It's *Lack* of Cohesion — higher is **worse**. LCOM4 = 1 is the goal; LCOM4 = 5 means five classes in a trench coat. People invert this constantly and "optimize" the wrong direction.

2. **Swapping `Ca` and `Ce`.** Afferent = **A**rriving (incoming, fan-in, who depends on me). Efferent = **E**xiting (outgoing, fan-out, who I depend on). Mix them up and your instability `I = Ce/(Ca+Ce)` inverts and every conclusion flips.

3. **Treating CBO and `Ce` as the same number.** CBO counts coupling in **both** directions (uses *and* used-by); `Ce` counts only outgoing. They answer different questions and will not match.

4. **Confusing stamp and data coupling.** Passing a whole `order` object when only `order.total` is used is **stamp** coupling — it ties the caller to the object's full shape. Passing `total` is **data** coupling. "It's just a parameter" hides a real difference in what you depend on.

5. **Chasing low coupling while ignoring cohesion.** You can drive coupling down by smearing one responsibility across many anemic classes — low CBO, terrible design. Fix cohesion first (split by responsibility); healthy coupling usually follows. Optimizing coupling in isolation produces shrapnel.

6. **Believing deep inheritance is free.** A high DIT means a method's real behavior is scattered up the chain; "it has no code in this class" doesn't mean it has no behavior. Deep hierarchies score poorly on DIT for a reason — reason about the whole chain, not just the leaf.

---

## Test Yourself

1. Order the coupling ladder from worst to best and give a one-line example of the worst and the best rung.
2. A function takes a `boolean isAdmin` flag that selects between two code paths inside it. Which coupling rung is that, and what's the standard refactor?
3. Define `Ca` and `Ce` in one sentence each, and write the instability formula.
4. A class has `Ca = 30, Ce = 2`. Is it stable or unstable, and what does that imply about changing it?
5. What does LCOM4 = 3 tell you, and what's your next action?
6. How does CBO differ from `Ce`?

<details>
<summary>Answers</summary>

1. Worst → best: **content > common > control > stamp > data > none**. Worst (content): module A writes directly into module B's private variable. Best (none): two modules that never reference each other (or, of the *real* couplings, **data** — passing only the scalars actually needed).
2. **Control coupling** — the caller passes a flag that dictates the callee's control flow. Standard refactor: replace the boolean parameter with **two separate methods** (or polymorphism), so the caller picks behavior by *which method it calls*, not by a flag.
3. **`Ca`** (afferent) = the number of units that depend on this unit (incoming edges / fan-in). **`Ce`** (efferent) = the number of units this unit depends on (outgoing edges / fan-out). Instability **`I = Ce / (Ca + Ce)`**, range 0..1.
4. `I = 2/32 ≈ 0.06` → **stable** (low instability). Thirty units depend on it, so it's expensive and risky to change — touch it only with strong tests and a clear reason; it's exactly where breaking changes are most costly.
5. The class splits into **3 connected components** that share no state — it's really three classes fused together. Next action: **extract along the three components**, then re-measure (each should come out at LCOM4 = 1). Watch for a connector method/field that might be artificially gluing components.
6. **CBO** counts coupling in *both* directions — classes this class uses **and** classes that use it. **`Ce`** counts only *outgoing* dependencies (classes this one uses). CBO ≥ `Ce` in general.

</details>

---

## Cheat Sheet

```
COUPLING LADDER (worst → best)
  content  > common > control > stamp > data > none
  inside-B   global   flag      whole   scalar  no
  internals  state    drives    record  only    dep
                       flow      passed

COHESION LADDER (worst → best)
  coincidental > logical > temporal > communicational > sequential > functional
  unrelated      flag-     same       same data         pipe          one
                 selected   time                         (out→in)      job

FAN-IN / FAN-OUT
  Ca  afferent = Arriving = incoming = fan-in  = who depends on ME
  Ce  efferent = Exiting  = outgoing = fan-out = who I depend on
  I  = Ce / (Ca + Ce)     0 = stable (rigid, depended-on)
                          1 = unstable (volatile, depends on others)
  rule: depend in the direction of stability (unstable → stable)

CK SUITE
  CBO  coupling between objects   both directions   high = hard to reuse/test
  RFC  response for a class       own + called      high = hard to test
  DIT  depth of inheritance       distance to root  deep = fragile base risk
  NOC  number of children         direct subclasses high = wide ripple

LCOM4 = number of connected components in the (method↔shared-field) graph
  1   cohesive  (goal)
  ≥2  split it — each component is an extraction boundary
  watch: a connector method/god-field can fake LCOM4 = 1

TOOLS:  JDepend (Java pkg Ca/Ce) · NDepend (.NET, queryable) ·
        Structure101 (cycles/tangles) · dependency-cruiser (JS rules) ·
        SonarQube (multi-lang, ratings)
```

---

## Summary

- **Coupling** ranks on a ladder — **content > common > control > stamp > data > none**, worst to best — and each rung up is a known refactor (kill the global, kill the flag, pass the field not the record).
- **Cohesion** ranks on a ladder too — **coincidental > logical > temporal > communicational > sequential > functional**, worst to best — and **functional** (one job, one reason to change) is the target. Low cohesion forces high coupling, so fix cohesion first.
- **`Ca`** (afferent / fan-in / who depends on me) and **`Ce`** (efferent / fan-out / who I depend on) are edge counts off the dependency graph. **Instability `I = Ce/(Ca+Ce)`** says whether a unit is rigid-and-depended-on or volatile-and-dependent; dependencies should flow toward stability.
- The **CK suite** — **CBO** (bidirectional coupling), **RFC** (response set), **DIT** (inheritance depth), **NOC** (direct children) — reads the static shape of classes to nominate refactoring candidates. It nominates; humans convict.
- **LCOM4** models a class as a graph (methods linked by shared fields/calls) and counts **connected components**. `1` = cohesive; **`≥ 2` = split it**, with each component handing you an exact extraction seam.
- **Tools** (JDepend, NDepend, Structure101, dependency-cruiser, SonarQube) all do the same pencil procedure — build the graph, count fan-in/fan-out and components — at scale.

---

## Further Reading

- *Structured Design* — Yourdon & Constantine. The origin of the coupling and cohesion ladders; still the clearest treatment of the rungs.
- "A Metrics Suite for Object Oriented Design" — Chidamber & Kemerer (1994). The primary source for CBO, RFC, DIT, NOC, WMC, and LCOM.
- *Agile Software Development: Principles, Patterns, and Practices* — Robert C. Martin. `Ca`/`Ce`, instability, abstractness, and the main sequence (the senior-page material).
- "Measuring Coupling and Cohesion in Object-Oriented Systems" — Hitz & Montazeri. The paper behind LCOM4's connected-components definition.
- JDepend and NDepend documentation — the reference computations for these metrics on real codebases.

---

## Related Topics

- [01 — Cyclomatic & Cognitive Complexity](../01-cyclomatic-and-cognitive-complexity/middle.md) — the *intra*-method complexity numbers (and where WMC, the CK suite's complexity metric, belongs).
- [06 — Code Health Dashboards](../06-code-health-dashboards/middle.md) — how SonarQube/CodeScene aggregate exactly these coupling/cohesion numbers into ratings and trends.
- [Refactoring](../../../code-craft/refactoring/) — the mechanics of *acting* on a bad number: extract class along LCOM4 components, break dependencies to lower coupling.
- [senior.md](senior.md) — instability vs abstractness, the main sequence, package design principles, and where these metrics break down at scale.
