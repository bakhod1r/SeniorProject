# The Mikado Method — Senior

> **Source:** Ola Ellnestam & Daniel Brolund, *The Mikado Method* (Manning, 2014)

At senior level the method stops being "how do I refactor this class" and becomes a tool for **steering large changes across a codebase and a team**: parallelizing work, reading the emerging graph as an architectural X-ray, and — the underrated skill — knowing when to *stop*.

---

## 1. Very large refactorings

The method's superpower at scale is that it converts an intimidating, unbounded change into a stream of small, independently-shippable, independently-reviewable commits. But scale introduces failure modes the small case hides.

**Decompose the goal before you draw a single node.** A month-long migration ("replace the homegrown ORM with JPA") is not one Mikado goal — it's a *program* of goals. The senior move is to identify a sequence of **independently valuable, independently shippable goals**, each of which is a tractable Mikado exercise: "`UserRepository` reads through the JPA adapter," then "`OrderRepository`…", etc. Each completes green-to-green and merges; the program advances even if it pauses for weeks.

**Use the first attempt as a feasibility probe.** On a big change, the very first naive attempt against the real goal is reconnaissance. If it surfaces a handful of named prerequisites, the change is tractable. If it surfaces a sprawling, circular, "everything depends on everything" mess, you've learned — in twenty minutes — that the change has an architectural blocker that no amount of leaf-clearing will dissolve (§3). That's a cheap, early, *good* failure.

**Bound the graph.** A healthy large graph is **wide and shallow** — many independent leaves under a few intermediate branches. A graph that is **deep and narrow** (a long chain of single-child prerequisites) is a smell: it means the change is one long sequential dependency with no parallelism and no early shippable value. Consider whether the goal can be re-cut so more work is independent.

---

## 2. Parallelizing graph branches across a team

A wide graph is a **work-assignment board**. Independent leaves (and independent subtrees) can be handed to different people simultaneously — the graph *is* the dependency analysis that tells you what's safe to parallelize.

**The rules that keep parallel Mikado from collapsing:**

- **Assign whole subtrees, not random leaves.** Give one engineer the `ShippingCalc` subtree and another the `PricingRule` subtree. Subtrees that don't share nodes don't share merge conflicts. Crossing subtree boundaries mid-task is where parallel work tangles.
- **Shared leaves are coordination points.** When a node blocks several subtrees (a true DAG join — e.g. "introduce the `Config` interface"), *one* person does it first and everyone rebases on the result. Treat shared leaves as serialization barriers; do them before fanning out.
- **Every leaf still commits green to trunk.** Because each cleared leaf is shippable, parallel branches integrate continuously instead of in one terrifying merge. This is the same discipline as the sibling *Keeping the System Shippable* topic — trunk never breaks, so N people can refactor the same module without a multi-day integration freeze.
- **The graph is the daily standup.** "Which leaves are done, which are in flight, what's newly discovered" is a complete status report. New prerequisites discovered by one engineer get drawn on the shared graph and may unblock or block others — surface them immediately.

> Parallelizing a *swamp* is impossible — there's no clean baseline to branch from and no way to know what's independent. The Mikado Graph is precisely the artifact that makes a deep refactoring a parallelizable problem at all.

**When NOT to parallelize:** if the graph is deep-and-narrow (§1) there's nothing independent to split; adding people just creates merge contention. And if the graph is still rapidly *growing*, the dependency picture isn't stable enough to assign — wait until it starts shrinking.

---

## 3. When the graph reveals an architectural problem

This is the most valuable and least appreciated output of the method: **the shape of the graph is a measurement of your architecture's coupling.** You set out to refactor; you end up with a diagnosis.

Patterns to read:

- **A node that reappears under almost every branch** is a *pervasive dependency* — usually a global, a god object, an ambient singleton, or a leaky cross-cutting concern. The graph is telling you this thing is wired into everything. That's not a refactoring step; it's an architectural finding worth its own initiative.
- **A cycle** (you recurse into a prerequisite and eventually rediscover an ancestor as *its* prerequisite) means there's a **circular dependency** in the design. You cannot resolve it leaf-first because there is no leaf — the cycle has to be *broken* first, typically by introducing an abstraction or inverting a dependency (the sibling *Branch by Abstraction* topic, or a dependency-inversion seam). Until the cycle is broken, the Mikado loop will spin.
- **Explosive width on the first attempt** means the goal sits behind dozens of independent dependencies — the abstraction you're trying to introduce is *missing* and everything currently reaches across the gap directly. The finding: you need a seam (Adapter/Facade) before the migration is even sensible.
- **A graph that won't stop growing** is the strongest signal that the goal is mis-scoped *or* that there's structural rot the goal can't paper over.

The senior response is to treat these as **inputs to architecture decisions, not just refactoring steps.** Capture the finding ("`Config.INSTANCE` is referenced from 47 sites across 9 modules; it is the single largest coupling point") and feed it into planning. The graph you built is the evidence.

---

## 4. Knowing when to stop

Three distinct "stops," each a senior judgment call:

**Stop and ship the partial result.** Because every commit is green, you can *stop at any leaf boundary* and the work-to-date is valuable and releasable. If the remaining leaves are low-value or the cost/benefit has flipped, banking the progress and closing the effort is legitimate — not a failure. The remaining graph is your documented backlog.

**Stop and re-scope.** If the graph reveals the goal was too big or hides an architectural blocker (§3), stop *executing* and go *re-plan*. Splitting one impossible goal into three tractable ones is progress, even though no code changed this hour.

**Stop and choose a different strategy.** Sometimes the graph shows the dependencies are so dense and so deeply entangled that the revert/re-attempt cost dwarfs a different approach — e.g. a **Strangler** around the whole module (the sibling *Strangler at Code Level* topic), building new alongside old rather than untangling in place; or a **spike-and-stabilize** where you explore on a throwaway branch and then rewrite the slice cleanly. The Mikado Graph is what *justifies* that pivot to stakeholders: "here is the dependency map; untangling it in place is N leaves of risk; strangling it is cheaper."

> The discipline of revert keeps you honest about progress: you can never *fool yourself* into thinking a swamp is "almost done." Either a leaf is committed and green, or it isn't done. That clarity is exactly what lets you make a clean stop decision.

**When NOT to keep going:** when the marginal leaf no longer buys real value, when the graph is still growing after serious effort (re-scope, don't grind), or when a structural blocker means leaf-first can never reach the root (break the cycle / change strategy first).

---

## 5. Reading a graph: a worked diagnosis

```
[~] GOAL: ReportingService takes a ReportRepository (no static DB access)
   ├── [~] A: PdfRenderer takes Repository
   │     └── [ ] X: Config interface extracted          <-- also under B and C
   ├── [~] B: CsvRenderer takes Repository
   │     └── [ ] X: Config interface extracted          <-- shared
   └── [~] C: Scheduler takes Repository
         ├── [ ] X: Config interface extracted          <-- shared (3rd time)
         └── [ ] Y: Scheduler ↔ ReportingService cycle broken
```

Two findings jump out. **X ("extract `Config` interface") is shared across all three branches** — do it first, once, as a serialization barrier, then fan A/B/C out to three engineers. **Y is a cycle** — `Scheduler` depends on `ReportingService` which (via C) depends on `Scheduler`; no leaf-first order resolves that, so Y must be broken with a seam *before* C is reachable. A junior would grind on A/B/C in parallel and keep hitting X conflicts and the Y wall. The senior reads the graph, sequences X → (A‖B‖C with Y's seam) and pre-empts both.

---

## 6. Next

- **professional.md** — the economics, estimation from a partial graph, stakeholder communication, tooling, and the psychology of revert.
- The sibling *Strangler at Code Level* and *Branch by Abstraction* topics, the usual strategic alternatives when the graph reveals a structural blocker.
- **[Refactoring to Behavioral Patterns](../../03-refactoring-to-patterns/04-behavioral/junior.md)** and **[Couplers code smells](../../01-code-smells/05-couplers/junior.md)** for naming the coupling the graph exposes.
