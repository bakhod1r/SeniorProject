# The Mikado Method — Junior

> **Source:** Ola Ellnestam & Daniel Brolund, *The Mikado Method* (Manning, 2014)

You want to make one change. You make it. The compiler explodes with twelve errors. You fix the first one — and that breaks three more. An hour later you have forty files open, nothing compiles, you've forgotten what you were originally trying to do, and you're afraid to `git stash` because you're not sure you can get back. This is the **refactoring swamp**, and almost every developer has drowned in it at least once.

The Mikado Method is a disciplined way to make large, deep changes *without* ever entering that swamp. Its central trick sounds backwards the first time you hear it: **when your change breaks the build, you throw the change away.** You don't fix it. You revert to a clean, working state — and instead you write down *what would have needed to be true* for your change to work. Then you go make those things true, one at a time, from the bottom up.

This file teaches the method from scratch: the analogy it's named after, the exact loop you run, the graph you draw, and a full worked example you can follow line by line.

---

## Table of Contents

1. [The pick-up-sticks analogy](#1-the-pick-up-sticks-analogy)
2. [The Mikado Goal](#2-the-mikado-goal)
3. [The core loop](#3-the-core-loop)
4. [The Mikado Graph notation](#4-the-mikado-graph-notation)
5. [Why "revert on red" matters](#5-why-revert-on-red-matters)
6. [Worked example: removing a global dependency](#6-worked-example-removing-a-global-dependency)
7. [How the graph grows and shrinks](#7-how-the-graph-grows-and-shrinks)
8. [Relationship to other techniques](#8-relationship-to-other-techniques)
9. [When NOT to use the Mikado Method](#9-when-not-to-use-the-mikado-method)
10. [Glossary](#10-glossary)
11. [Review questions](#11-review-questions)
12. [Next](#12-next)

---

## 1. The pick-up-sticks analogy

*Mikado* is a children's game (you may know it as "pick-up-sticks"). A bundle of thin sticks is dropped on the table into a tangled pile. One special stick — the **Mikado** — is worth the most. To win, you must remove the Mikado stick. But there's a rule: **you may only pick up a stick if you can do so without moving any other stick.** Disturb the pile and your turn ends.

So you can't just grab the Mikado. It's pinned under others. You look at the pile and ask: *what is lying on top of the Mikado, holding it down?* You remove those first — but they're often pinned too, so you remove *their* blockers first, and so on. You work from the **outside in**, from the **freely removable sticks** toward the prize.

Now map that onto code:

| Pick-up-sticks | Refactoring |
| --- | --- |
| The Mikado stick (the prize) | Your **goal** — the change you actually want |
| A stick pinning the Mikado | A **prerequisite** — something that must change first |
| "Can I lift this without disturbing others?" | "Can I make this change without breaking the build?" |
| A freely removable stick | A **leaf** — a change with no further prerequisites |
| Your turn ending because you moved a stick | The build going **red** — you must revert |

The whole method is: *find the goal, discover what pins it, and clear the pins from the leaves inward — never disturbing the working pile.*

---

## 2. The Mikado Goal

A **Mikado Goal** is the concrete end-state you want, written so unambiguously that anyone could tell whether you've reached it. It is the **root** of your graph.

Good goals are observable and binary — done or not done:

- *"`OrderService` no longer reads from the global `Config.INSTANCE` singleton; it receives a `Config` via its constructor."*
- *"The `legacy.billing` package compiles against the new `Money` type instead of `double`."*
- *"`ReportGenerator` has no static dependency on the database; it takes a `ReportRepository` interface."*

Bad goals are vague and unmeasurable: *"clean up the config code"*, *"make billing better"*, *"reduce coupling."* You can't tell when you're done, so you can't tell when to commit, and the graph can't have a root.

> **The goal is the *what*, never the *how*.** "Remove the singleton" is a goal. "Add a constructor parameter, then update 14 call sites, then delete the field" is a *plan* — and the whole point of the method is that you don't yet know the plan. The graph *is* the plan, discovered by experiment.

**When NOT to:** if you can't phrase the goal as a checkable end-state in one sentence, you're not ready to start. Split it, or spend time understanding the code first. A fuzzy goal produces a fuzzy graph and a refactoring that never feels finished.

---

## 3. The core loop

Here is the entire method as a numbered procedure. Read it once now; the worked example in §6 walks through it concretely.

1. **Set a Mikado Goal.** Write it at the root of an empty graph. Make sure the build is green and committed before you touch anything.
2. **Attempt the change naively.** Just *try* to reach the goal directly, as if nothing else were in the way. Type the change you wish were possible.
3. **Observe what breaks.** Compile. Run the tests. The compiler errors and test failures are not annoyances — they are **information**. They are telling you exactly what the code depends on.
4. **Note each break as a prerequisite.** For every distinct thing that broke, add a child node to the graph: *"before the goal can work, **this** must be true."* Don't fix anything yet — just record it.
5. **REVERT to green.** Throw your attempt away (`git checkout .`, `git reset --hard`, or undo). Return to the last working, committed state. The graph keeps everything you learned; the code keeps working.
6. **Recurse, leaf-first.** Pick a prerequisite that has *no children* yet — a **leaf**. Go to step 2 *for that prerequisite* (attempt it naively, observe breaks, note its own prerequisites, revert). Keep going until you find a leaf whose change breaks *nothing*.
7. **A non-breaking leaf is real work.** When a leaf change compiles and keeps the tests green, **don't revert it — commit it.** That prerequisite is now permanently true. Cross it off the graph and walk back up: re-attempt its parent (which may now be a non-breaking leaf itself).

You repeat 6–7, climbing up the graph, until the root — your goal — is itself a non-breaking change. Then you make it, commit, and you're done.

The rhythm is: **try → learn → revert → try a smaller thing → commit when it's safe → climb.**

---

## 4. The Mikado Graph notation

The **Mikado Graph** is a dependency tree drawn on paper, a whiteboard, or in a text file. It has three pieces:

- **The Goal** sits at the **root** (often drawn with a double box or at the top).
- **Prerequisites** hang off the goal as **children**: "to do the parent, first do me."
- **Leaves** are prerequisites with no children — these are the things you can attempt *right now*.

A simple ASCII form, goal at the top, prerequisites indented beneath their parent:

```
[GOAL] OrderService takes Config via constructor (no singleton)
   └── Prereq A: ShippingCalc takes Config via constructor
   └── Prereq B: PricingRule takes Config via constructor
   └── Prereq C: OrderServiceFactory builds Config and passes it in
```

The crucial reading rule: **arrows / indentation mean "depends on" — you execute leaves first and the goal last.** This is the opposite of a normal to-do list. The thing drawn deepest gets done soonest.

A node has a state. A common convention:

```
[ ] not done yet
[~] tried, has prerequisites below (a branch, not a leaf)
[x] done and committed
```

You'll see the graph drawn either **top-down** (goal at top, dependencies below — used in this file) or **bottom-up** (goal at the bottom of the page, leaves at the top — as in the original book, so you literally start at the top of the page). Both encode the same tree. Pick one and stay consistent.

---

## 5. Why "revert on red"

Reverting your work the moment the build breaks is the rule that surprises everyone, and it is the rule that makes the method *work*. Three reasons:

**1. The system stays shippable at all times.** Between every committed step the code compiles and the tests pass. There is never a moment where you couldn't ship, hand off, or be interrupted. Compare the swamp, where you might be three days into a change with nothing that runs — if priorities shift, that work is stranded.

**2. It prevents the half-broken WIP swamp.** When you "just push through" a breaking change, each fix tends to spawn new breaks, and you accumulate a growing front of broken code that you can no longer reason about. Reverting caps the blast radius: you only ever hold *one small experiment* in your head at a time.

**3. It makes the *true* dependency tree visible.** When you fix-as-you-go, you never find out what *really* blocked what — the dependencies blur together into one big mess. By attempting, recording, and reverting, each break is observed in isolation against a clean baseline. The graph you end up with is an accurate map of the real coupling in the system, which is itself enormously valuable (see senior.md).

> **The hardest part is psychological.** Deleting code that "almost works" feels like throwing away progress. It isn't — the *knowledge* is captured in the graph. The code was always cheap to recreate; the knowledge of what depends on what is the expensive thing, and you keep it.

**When NOT to:** if a single naive attempt reveals the *entire* small dependency set and you can fix it all in a few minutes with green tests, reverting is pure overhead — just finish it (see §9).

---

## 6. Worked example: removing a global dependency

We have an `OrderService` that reaches out to a global singleton, `Config.INSTANCE`, deep inside its logic. Hidden global state like this makes the class impossible to test in isolation and impossible to run with two configurations. **Our goal: `OrderService` should receive its `Config` through its constructor, and nothing should touch `Config.INSTANCE` anymore.**

Starting code (green, committed):

```java
public class OrderService {
    public Receipt checkout(Cart cart) {
        ShippingCalc shipping = new ShippingCalc();
        PricingRule pricing = new PricingRule();
        Money total = pricing.price(cart).plus(shipping.cost(cart));
        return new Receipt(total);
    }
}

public class ShippingCalc {
    public Money cost(Cart cart) {
        // reaches into the global singleton
        double rate = Config.INSTANCE.getShippingRate();
        return Money.of(cart.weight() * rate);
    }
}

public class PricingRule {
    public Money price(Cart cart) {
        double tax = Config.INSTANCE.getTaxRate();   // also global
        return cart.subtotal().times(1 + tax);
    }
}
```

### Iteration 1 — attempt the goal naively, observe, revert

**Step 2 (attempt):** We change `OrderService` to take a `Config` and try to thread it through:

```java
public class OrderService {
    private final Config config;
    public OrderService(Config config) { this.config = config; }

    public Receipt checkout(Cart cart) {
        ShippingCalc shipping = new ShippingCalc(config); // wishful: pass config
        PricingRule pricing  = new PricingRule(config);   // wishful: pass config
        Money total = pricing.price(cart).plus(shipping.cost(cart));
        return new Receipt(total);
    }
}
```

**Step 3 (observe):** The compiler complains:

```
error: ShippingCalc() — constructor ShippingCalc(Config) is undefined
error: PricingRule()  — constructor PricingRule(Config) is undefined
error: OrderServiceFactory.java:14 — OrderService() now requires an argument
```

**Step 4 (note prerequisites):** Three distinct things must be true before the goal works. Draw them as children:

```
[~] GOAL: OrderService takes Config via constructor; no Config.INSTANCE
   ├── [ ] A: ShippingCalc takes Config via constructor (stop using INSTANCE)
   ├── [ ] B: PricingRule takes Config via constructor (stop using INSTANCE)
   └── [ ] C: OrderServiceFactory builds Config and passes it to OrderService
```

**Step 5 (REVERT):** `git checkout .` — `OrderService` is back to its original singleton-using form. The build is green again. We have learned three prerequisites and broken nothing.

### Iteration 2 — recurse into leaf A

**Step 6:** Pick leaf **A** (`ShippingCalc`). Attempt it naively:

```java
public class ShippingCalc {
    private final Config config;
    public ShippingCalc(Config config) { this.config = config; }

    public Money cost(Cart cart) {
        double rate = config.getShippingRate();   // no more INSTANCE
        return Money.of(cart.weight() * rate);
    }
}
```

**Observe:** This breaks the *one* place that constructs `ShippingCalc` — inside `OrderService.checkout`, `new ShippingCalc()` no longer compiles. That's a new prerequisite, but notice: it's the *same* work the goal already needs (passing config into `ShippingCalc`). Rather than nest it, we recognize A can't be a clean leaf on its own while the caller still uses the no-arg constructor.

A practical move the book endorses: **keep the old constructor temporarily** so the change is non-breaking. We *add* a Config-taking constructor without removing the old one:

```java
public class ShippingCalc {
    private final Config config;
    public ShippingCalc() { this(Config.INSTANCE); }        // keeps old callers green
    public ShippingCalc(Config config) { this.config = config; }

    public Money cost(Cart cart) {
        double rate = config.getShippingRate();
        return Money.of(cart.weight() * rate);
    }
}
```

**Observe:** Compiles. Tests green. Nothing else changed. **A is now a non-breaking leaf.**

**Step 7 (COMMIT):** Commit this. Mark A done. The graph shrinks:

```
[~] GOAL: OrderService takes Config via constructor; no Config.INSTANCE
   ├── [x] A: ShippingCalc takes Config via constructor      ✅ committed
   ├── [ ] B: PricingRule takes Config via constructor
   └── [ ] C: OrderServiceFactory builds Config and passes it in
```

### Iteration 3 — leaf B, then leaf C, then the root

Repeat the identical move for **B** (`PricingRule`): add an overloaded constructor that defaults to `Config.INSTANCE`, switch the body to use the field, commit. Mark B done.

```
[~] GOAL: OrderService takes Config via constructor; no Config.INSTANCE
   ├── [x] A: ShippingCalc ✅
   ├── [x] B: PricingRule  ✅
   └── [ ] C: OrderServiceFactory builds Config and passes it in
```

Now **C** (the factory). Attempt it: build a `Config` and pass it into `OrderService`. But `OrderService` doesn't *take* a Config yet — so to make C non-breaking, we again add an overloaded `OrderService` constructor that defaults to `Config.INSTANCE`. Commit. Mark C done.

```
[~] GOAL: OrderService takes Config via constructor; no Config.INSTANCE
   ├── [x] A ✅   ├── [x] B ✅   └── [x] C ✅
```

**The root is now a leaf.** Every prerequisite is true. Re-attempt the goal: make `OrderService.checkout` pass `config` into `new ShippingCalc(config)` and `new PricingRule(config)`, and have the factory pass a real `Config` in. Finally, delete the temporary default constructors and any remaining `Config.INSTANCE` reads. Compile — green. Tests — green. **Commit. Goal reached.**

Final state: no class touches `Config.INSTANCE`; configuration flows in explicitly from one place. Crucially, **every intermediate commit shipped a working system.** If your manager had pulled you off this task after Iteration 2, the code would still be correct and releasable — just not finished.

---

## 7. How the graph grows and shrinks

The graph is alive. Watch its size over a session:

**It grows** every time a naive attempt reveals new prerequisites — children sprout under the node you were attempting. Early on, the graph balloons outward as you discover how tangled the code really is. A node that you thought was a leaf often turns out to be a branch with three children of its own.

**It shrinks** every time you commit a non-breaking leaf — that node is crossed off. As leaves disappear, their parents become the new leaves, and you work upward. Near the end, the graph collapses quickly: clearing the last leaf under a node turns that node into a leaf, which you clear, exposing *its* parent, and so on up to the root.

A useful mental picture of one full lifecycle:

```
phase 1: discover            phase 2: execute leaf-first       phase 3: collapse
                             
   [GOAL]                       [GOAL]                            [GOAL] ✅
    ├─A                          ├─A ✅                             done
    │  ├─A1                       │  ├─A1 ✅
    │  └─A2                       │  └─A2 ✅
    └─B                          └─B ✅
   (growing wider)            (leaves turn green, bottom-up)    (root finally clears)
```

If the graph *only ever grows* and never starts shrinking, that's a warning sign: usually the goal is too big, or you've found an architectural knot (see senior.md). If it shrinks but you keep re-discovering the same prerequisite, your reverts may be too coarse — you're re-attempting things you already learned.

---

## 8. Relationship to other techniques

The Mikado Method doesn't replace your other tools — it organizes *when* you reach for them.

- **Branch by Abstraction** (sibling topic *Branch by Abstraction*) is a specific tactic for swapping one implementation for another behind a stable interface while keeping things shippable. It often shows up *as a prerequisite node* inside a Mikado Graph: "introduce an abstraction layer in front of the old database" is exactly the kind of leaf the method tells you to do first.

- **Parallel Change (expand / contract)** — the sibling *Parallel Change* topic — is the very pattern we used in §6: adding an overloaded constructor (expand), migrating callers, then deleting the old one (contract). Mikado tells you the *order*; parallel change tells you how to make each step non-breaking.

- **Characterization tests** are your safety net. Before you Mikado your way through tangled code, you want tests that pin the current behavior so a green build actually *means* "behavior unchanged." This is the heart of the *working-with-legacy-code* discipline (Michael Feathers): get the code under test, then refactor. Mikado assumes you can observe "red vs green" reliably — characterization tests are what make that observation trustworthy.

- The actual edits inside each node are ordinary refactorings. See **[Moving Features Between Objects](../../02-refactoring-techniques/02-moving-features/junior.md)** and **[Simplifying Conditionals](../../02-refactoring-techniques/04-simplifying-conditionals/junior.md)** for the mechanics. When a node's goal is "introduce a seam," patterns like **[Adapter](../../../design-patterns/02-structural/01-adapter/junior.md)** and **[Facade](../../../design-patterns/02-structural/05-facade/junior.md)** are common.

---

## 9. When NOT to use the Mikado Method

The method earns its keep on **large, deep changes where the dependency graph is unknown**. Outside that zone it's overhead.

- **Small, known-scope refactors.** If you can see the whole change in your head and finish it in one green-to-green step, just do it with normal TDD. Renaming a method, extracting a function, inlining a variable — your IDE does these safely in one shot. Drawing a graph for them is ceremony.

- **When repeated reverting costs more than a spike.** If each attempt is genuinely expensive to set up and tear down (slow builds, heavy environment, costly fixtures), the constant revert cycle can dominate. An alternative is a **spike**: explore on a throwaway branch *just to learn the dependencies*, draw the graph from what you saw, throw the spike away, then execute cleanly. You still get the graph; you pay the exploration cost once.

- **When behavior is changing, not just structure.** Mikado is a *refactoring* method — it assumes "green build" means "still correct." If you're also changing what the code *does*, the green/red signal no longer cleanly maps to "did I preserve behavior," and the discipline loses its meaning. Separate the behavior change from the restructuring first.

- **When there are no tests and you can't get any cheaply.** Without a reliable red/green signal, "revert on red" has nothing to react to. Get a characterization-test net first (or at minimum a compiler that catches the breaks), or you're flying blind.

---

## 10. Glossary

- **Mikado** — the prize stick in pick-up-sticks; here, your end goal.
- **Mikado Goal** — the concrete, checkable end-state you want; the root of the graph.
- **Mikado Graph** — the dependency tree: goal at the root, prerequisites as children, leaves done first.
- **Prerequisite** — something that must be true before its parent change can succeed; a child node.
- **Leaf** — a prerequisite with no children of its own; the only kind of node you can attempt right now.
- **Naive attempt** — making the change as if nothing blocked it, purely to *learn* what breaks.
- **Revert on red** — throwing away your attempt the moment the build breaks, returning to the last green state.
- **Non-breaking change** — an edit that compiles and keeps the tests green; the only kind you commit.
- **Swamp / WIP swamp** — the half-broken, ever-growing state you fall into by fixing-as-you-go instead of reverting.

---

## 11. Review questions

1. In pick-up-sticks, why can't you grab the Mikado stick first? What's the code equivalent?
2. State the seven steps of the core loop from memory. Which step do people skip, and what happens when they do?
3. Why is a leaf the *only* node you're allowed to attempt at any given moment?
4. You make a naive attempt and the build breaks in three places. What do you do *immediately* — and what do you definitely *not* do?
5. Give three concrete reasons "revert on red" keeps you out of the swamp.
6. In the §6 example, why did we add an *overloaded* constructor instead of just replacing the old one? Which sibling technique is that?
7. Describe the shape of the graph at three points: just after the first attempt, halfway through, and just before completion.
8. Name two situations where you should *not* use the Mikado Method, and say what you'd do instead.
9. How do characterization tests relate to the "green build = behavior preserved" assumption the method relies on?
10. Your graph keeps growing and never starts shrinking. Give two possible causes.

---

## 12. Next

- **[Parallel Change / Expand–Contract](../../02-refactoring-techniques/02-moving-features/junior.md)** for the non-breaking-edit mechanics each node relies on. *(Also see the sibling Parallel Change and Branch by Abstraction topics, which often appear as nodes inside a Mikado graph.)*
- **middle.md** — drawing and maintaining the graph in practice, leaf selection, and the version-control workflow that makes reverting cheap.
- **[Refactoring to Behavioral Patterns](../../03-refactoring-to-patterns/04-behavioral/junior.md)** for the kinds of target structures your goals often aim at.
