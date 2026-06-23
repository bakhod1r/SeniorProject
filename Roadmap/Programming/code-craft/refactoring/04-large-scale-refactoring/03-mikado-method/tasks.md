# The Mikado Method — Tasks

> **Source:** Ola Ellnestam & Daniel Brolund, *The Mikado Method* (Manning, 2014)

Build Mikado graphs for real tangles. Try each before reading the solution. A "correct" graph isn't unique — what matters is: goal is checkable, prerequisites are real dependencies, leaves are done first, and you'd revert on every red.

---

## Task 1 — Write a Mikado goal

For each fuzzy intention, rewrite it as a proper Mikado goal (checkable, binary, *what* not *how*), or say why it isn't ready to start.

a) "Improve the logging."
b) "Make `InvoiceService` testable."
c) "Decouple the UI from the database."

<details><summary>Solution</summary>

a) Not ready — "improve" is unmeasurable. Sharpen to e.g. *"All logging in `payments` goes through the `Logger` interface; no direct `System.out` / `printStackTrace` calls remain."*

b) Almost — "testable" is fuzzy. Make the *mechanism* checkable: *"`InvoiceService` receives its `Clock`, `TaxTable`, and `InvoiceRepository` via constructor; it has no `static`/`new` calls to those collaborators."* Now you can verify it and unit-test with fakes.

c) Too big as one goal — it's a program. Cut into shippable goals: *"`OrderView` reads order data only through `OrderQuery` (no direct `Connection`/SQL in the view layer),"* then repeat per view. Each is a tractable Mikado exercise.
</details>

---

## Task 2 — First attempt, first graph

Given:

```java
class ReportJob {
    void run() {
        Data d = Database.INSTANCE.load();      // global singleton
        String csv = new CsvFormatter().format(d);
        Mailer.INSTANCE.send(csv);              // another global
    }
}
```

**Goal:** *`ReportJob` receives `Database`, `Mailer`, and `CsvFormatter` via its constructor; no `*.INSTANCE` inside `ReportJob`.* Do the naive attempt in your head, list what breaks, draw the first graph.

<details><summary>Solution</summary>

Naive attempt: add a constructor `ReportJob(Database db, Mailer m, CsvFormatter f)` and use fields. Breaks: every site that does `new ReportJob()` (the no-arg constructor is gone), and you've coupled three migrations into one. First graph:

```
[~] GOAL: ReportJob takes Database, Mailer, CsvFormatter via ctor; no INSTANCE
   ├── [ ] A: ReportJob reads db from injected field (keep INSTANCE default via overloaded ctor)
   ├── [ ] B: ReportJob reads mailer from injected field (overloaded ctor default)
   ├── [ ] C: ReportJob takes CsvFormatter via field (overloaded ctor default)
   └── [ ] D: All callers of `new ReportJob()` pass the three collaborators
```

Revert. A/B/C are independent leaves (use Parallel Change: add overloaded ctor defaulting to `INSTANCE`/`new`, switch body to field, commit). D becomes a clean leaf only after A–C, then remove the temporary defaults in the root step.
</details>

---

## Task 3 — A leaf that's secretly a branch

Continuing Task 2, you attempt leaf **A** ("ReportJob reads db from injected field") but discover `Database.INSTANCE.load()` is *also* called inside `CsvFormatter` (it lazily fetches lookup tables), and `Database` has no interface — it's a concrete class with a private constructor. Redraw A.

<details><summary>Solution</summary>

A was not a leaf. Revert and expand:

```
[~] A: ReportJob reads db from injected field
   ├── [ ] A1: Extract `DatabaseGateway` interface that `Database` implements
   └── [ ] A2: CsvFormatter takes db via parameter (stop calling Database.INSTANCE inside it)
```

A1 is the real leaf — an interface extraction is non-breaking (Parallel Change / Branch by Abstraction). Do A1, commit; then A2 (now possible because there's a type to inject), commit; then A becomes a clean leaf. **Note:** A1 is likely *shared* — `Mailer` and the formatter migrations may also need their own interfaces, so check whether A1 is really "extract gateway interfaces for all three globals" and reused under B and C.
</details>

---

## Task 4 — Spot the cycle

You're migrating to constructor injection and your graph looks like this after several attempts:

```
[~] GOAL: Scheduler takes JobRunner via ctor
   └── [~] P: JobRunner takes Scheduler via ctor (it calls scheduler.reschedule())
         └── [ ] ?: Scheduler takes JobRunner via ctor   <-- this is the GOAL again
```

What has the graph revealed, and how do you proceed?

<details><summary>Solution</summary>

A **circular dependency**: `Scheduler` needs `JobRunner` and `JobRunner` needs `Scheduler`. Leaf-first can't resolve it — there is no leaf, the recursion loops back to an ancestor. You must **break the cycle** before the Mikado loop can make progress. Options, each a new leaf that replaces P's bad child:

- Introduce an abstraction one side depends on (e.g. `JobRunner` takes a `Rescheduler` interface that `Scheduler` implements) — dependency inversion / Branch by Abstraction.
- Or pass the dependency via a method/setter (`runner.setScheduler(this)`) instead of the constructor, removing the construction-time cycle.

New graph node: `[ ] Break Scheduler↔JobRunner cycle by introducing Rescheduler interface`. That becomes the first leaf; the original goal is reachable afterward.
</details>

---

## Task 5 — Build the full graph and order it

Tangle: `PriceCalculator` is used by `Cart`, `OrderConfirmation`, and `AdminReport`. It reads tax rates from a global `Settings.INSTANCE` and currency rates from a `static FxRates.lookup()`.

**Goal:** *`PriceCalculator` takes a `Settings` and an `FxRates` via constructor; no static/global access inside it.* Draw the graph, mark shared nodes, and give a leaf execution order.

<details><summary>Solution</summary>

```
[~] GOAL: PriceCalculator takes Settings + FxRates via ctor; no global/static access
   ├── [ ] S1: PriceCalculator reads taxRate from injected Settings field   (overloaded ctor)
   ├── [ ] S2: PriceCalculator reads fx from injected FxRates field          (overloaded ctor)
   ├── [ ] X : FxRates has an instance API (wrap static lookup())            <-- prereq of S2
   ├── [ ] C1: Cart constructs PriceCalculator with collaborators
   ├── [ ] C2: OrderConfirmation constructs PriceCalculator with collaborators
   └── [ ] C3: AdminReport constructs PriceCalculator with collaborators
```

Dependencies: S2 depends on **X** (you can't inject `FxRates` until it has an instance form). C1–C3 depend on S1+S2 being injectable. Order:

1. **X** (wrap the static — non-breaking, add instance method delegating to `static`), commit.
2. **S1**, then **S2** (Parallel Change: overloaded ctor defaulting to `Settings.INSTANCE` / a default `FxRates`), commit each.
3. **C1, C2, C3** — independent, parallelizable across people now that injection is possible, commit each.
4. **Root:** remove the temporary default constructor and any remaining global reads, switch all callers to the real collaborators. Commit. Goal reached.

Every step shipped green.
</details>

---

## Task 6 — Decide: Mikado or not?

For each, say whether you'd run the Mikado loop or do something else, and why.

a) Rename `getCustomerName()` to `getFullName()` across 30 call sites.
b) Replace the entire homegrown persistence layer with JPA across ~200 classes, dependencies unknown.
c) Extract a 4-line block into a private method in one class.
d) Migrate `BillingModule` to a new tax engine where the build takes 9 minutes and each test run needs a seeded DB.

<details><summary>Solution</summary>

a) **Not Mikado.** Known scope, mechanical — your IDE's Rename does it safely in one shot. A graph is pure ceremony.

b) **Mikado — but as a *program* of goals**, not one goal. Decompose into per-repository goals ("`UserRepository` reads through the JPA adapter"), each a tractable Mikado exercise that ships independently. One giant goal would grow forever.

c) **Not Mikado.** Trivial, known, one green step — Extract Method via the IDE.

d) **Spike first, then Mikado** (or reconsider). The 9-minute build makes the revert/re-attempt loop expensive, so a tight Mikado cycle is painful. Run a time-boxed throwaway spike to *discover* the dependency graph cheaply, draw it, throw the spike away, then execute the leaves against trunk. If the graph reveals dense entanglement, evaluate a Strangler around `BillingModule` instead.
</details>

---

## Task 7 — Repair a broken process

A teammate's notes:

> "Started migrating `AuthService` off the session singleton. Attempted the goal, 6 things broke, started fixing them. Two days in, 23 files changed, nothing compiles, found 4 more breaks. No graph drawn — kept it in my head."

Diagnose every method violation and prescribe the recovery.

<details><summary>Solution</summary>

Violations: (1) **didn't revert** — started fixing on red instead of recording + reverting → built a swamp; (2) **no graph** — "in my head" loses the dependency knowledge the moment it gets complex; (3) **goal-too-big / no decomposition** likely (the swamp keeps spawning breaks); (4) **no clean baseline** now exists.

Recovery: **`git stash` or branch-and-park the broken work** (don't delete — it's the only record of what was learned). Return to the last green commit. Now run the method properly: write a checkable goal, attempt naively, *draw* the 6 breaks as nodes, **revert**, recurse leaf-first, commit each non-breaking leaf. The parked branch can be mined for the prerequisites already discovered, but its *code* is discarded — re-do it green, leaf by leaf.
</details>
