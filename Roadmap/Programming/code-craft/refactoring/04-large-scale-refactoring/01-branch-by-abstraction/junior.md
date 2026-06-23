# Branch by Abstraction — Junior

> **Source:** Paul Hammant, "Branch by Abstraction"; Jez Humble & David Farley, *Continuous Delivery*

You need to replace a big, load-bearing piece of your system — the data layer, the HTTP client, the pricing engine. The naïve plan is: create a Git branch, rip the old thing out, plug the new thing in, and merge weeks later. That plan fails for the same reason every time: while you were gone, twenty other people kept changing trunk, and now your merge is a war.

**Branch by Abstraction** is the technique that lets you make that same large change *without ever leaving trunk*. You introduce a seam — an abstraction — that both the old and new implementations can live behind. Then you migrate gradually, commit by commit, keeping the build green the entire time. The word "branch" here is a metaphor: you branch *in the code* (two implementations behind one interface), not in version control.

---

## Table of Contents

1. [What it is](#1-what-it-is)
2. [Why it beats a long-lived feature branch](#2-why-it-beats-a-long-lived-feature-branch)
3. [Real-world analogy: replacing a bridge](#3-real-world-analogy-replacing-a-bridge)
4. [The five phases](#4-the-five-phases)
5. [Worked example: swapping the persistence layer](#5-worked-example-swapping-the-persistence-layer)
   - [Phase 1 — Introduce the abstraction](#phase-1--introduce-the-abstraction)
   - [Phase 2 — Route clients through it](#phase-2--route-clients-through-it)
   - [Phase 3 — Build the new impl behind a flag](#phase-3--build-the-new-impl-behind-a-flag)
   - [Phase 4 — Flip the flag](#phase-4--flip-the-flag)
   - [Phase 5 — Remove the old impl (and maybe inline)](#phase-5--remove-the-old-impl-and-maybe-inline)
6. [Relationship to feature flags](#6-relationship-to-feature-flags)
7. [Cousins: Strangler and Parallel Change](#7-cousins-strangler-and-parallel-change)
8. [When NOT to use it](#8-when-not-to-use-it)
9. [Mini glossary](#9-mini-glossary)
10. [Review questions](#10-review-questions)
11. [Next](#11-next)

---

## 1. What it is

Branch by Abstraction is a recipe for swapping out a component while keeping the whole system shippable on trunk at *every single commit*. The recipe in one breath:

> Put an abstraction between the clients and the thing you want to replace. Build the replacement behind the same abstraction. Switch over. Delete the old thing.

The key insight is the **seam**. A seam is a place where you can change behavior without editing the code on either side of it — Michael Feathers' term. An interface is the most familiar kind of seam in Java. Once both implementations sit behind one interface, swapping them is a matter of choosing which one to instantiate, and that choice can be a one-line change (or a feature-flag lookup).

Nothing about this is exotic. You already know interfaces and dependency injection. Branch by Abstraction is the *discipline* of using them to stage a big change as a sequence of small, safe, individually-shippable steps.

---

## 2. Why it beats a long-lived feature branch

Picture two ways to replace the persistence layer.

**The feature-branch way.** You cut `feature/new-persistence`, work for three weeks, and the whole time trunk keeps moving. Every day your branch drifts further. When you finally merge, you face a giant diff nobody can review properly, conflicts in files you never touched, and a "big bang" cutover where the new code goes live all at once. If it breaks in production, your rollback is "revert the merge" — itself a huge, scary change.

**The branch-by-abstraction way.** Every commit lands on trunk and stays releasable. Each PR is small enough to review in fifteen minutes. The old and new implementations coexist, so you cut over by flipping a flag — and roll back by flipping it back. Reviewers see the change arrive in digestible pieces instead of one indigestible lump.

| Concern | Long-lived branch | Branch by Abstraction |
|---|---|---|
| Merge | One painful big-bang merge | Nothing to merge — always on trunk |
| Trunk health | Diverges silently | Green at every commit |
| Review | One enormous diff | Many small PRs |
| Cutover | All at once | Flip a flag |
| Rollback | Revert a giant merge | Flip the flag back |
| Visibility | Hidden until merge | Whole team sees it evolve |

This is why Branch by Abstraction is a cornerstone of **trunk-based development**: it makes "everyone commits to trunk every day" compatible with "we are making a change too big to finish in a day."

---

## 3. Real-world analogy: replacing a bridge

A city needs to replace an old bridge that thousands of cars cross daily. They do **not** close the old bridge, demolish it, and tell everyone to wait six months. That is the feature-branch approach, and the city would riot.

Instead:

1. They build a temporary structure that traffic can use either bridge through — call it the on-ramp that can point either way. *(the abstraction)*
2. They route all traffic onto the on-ramp, still feeding the old bridge underneath. *(clients use the abstraction; old impl behind it)*
3. They build the new bridge right next to the old one, while traffic keeps flowing. *(new impl behind the same abstraction)*
4. One night, they switch the on-ramp to feed the new bridge. *(flip the flag)*
5. Once the new bridge proves stable, they demolish the old one, and eventually remove the temporary on-ramp too. *(remove old impl, maybe inline)*

At no point does traffic stop. That is the whole point.

---

## 4. The five phases

Here are the five phases as **numbered, behavior-preserving steps**. "Behavior-preserving" means the system does exactly the same thing before and after each step — you are restructuring, not changing what the program does (until the deliberate flip in Phase 4).

1. **Introduce an abstraction layer** in front of the component you want to replace. Define an interface (or a thin wrapper) that captures what clients actually need. Make the *existing* implementation conform to it. No client uses it yet. *Behavior unchanged.*
2. **Refactor existing clients to use the abstraction.** One client at a time, replace direct calls to the old component with calls through the abstraction. The old implementation is what sits behind it, so output is identical. *Behavior unchanged.*
3. **Build the new implementation behind the same abstraction.** Write a second class implementing the interface. Wire it so it can be selected — usually via a feature flag — but keep it OFF by default. The new code is shippable but dormant. *Behavior unchanged.*
4. **Switch clients to the new implementation.** Flip the flag (often gradually: internal users, then 1%, then 100%). This is the *one* deliberate behavior change, and it is reversible by flipping back. *Behavior intentionally swapped, reversibly.*
5. **Remove the old implementation** once the new one is trusted. Delete the old class, delete the flag, and delete the now-dead branches. Optionally **inline the abstraction** if it was scaffolding rather than a permanent design improvement. *Behavior unchanged; codebase simplified.*

Every phase is a series of small commits, each landing on green trunk. You can pause between any two phases for days or weeks — the system is shippable throughout.

> **When NOT to (preview):** if the change is small enough to do in one safe commit, skip all of this and just do it. Branch by Abstraction is overhead that pays off only for changes too large to land atomically. See [section 8](#8-when-not-to-use-it).

---

## 5. Worked example: swapping the persistence layer

A team has an `OrderService` that talks directly to a hand-rolled JDBC data-access class. They want to move to a new repository backed by a different storage engine. We will follow all five phases. Watch the **interface evolve** as it earns its shape.

### Starting point (before anything)

```java
// The old, concrete data access — clients call it directly.
public class JdbcOrderDao {
    private final DataSource ds;
    public JdbcOrderDao(DataSource ds) { this.ds = ds; }

    public Order findById(long id) { /* raw JDBC */ return /* ... */ null; }
    public void save(Order order)  { /* raw JDBC */ }
    public List<Order> findByCustomer(long customerId) { /* raw JDBC */ return List.of(); }
}

// A client, coupled directly to the concrete class.
public class OrderService {
    private final JdbcOrderDao dao;                       // <-- concrete dependency
    public OrderService(JdbcOrderDao dao) { this.dao = dao; }

    public Order placeOrder(Order order) {
        dao.save(order);                                  // <-- direct call
        return dao.findById(order.id());
    }
}
```

The problem: `OrderService` (and a dozen other classes) name `JdbcOrderDao` directly. There is no seam to swap at.

### Phase 1 — Introduce the abstraction

**Goal:** create an interface that captures what clients need, and make the *old* class implement it. Change nothing else.

```java
// NEW: the seam. Named for the role, not the technology.
public interface OrderRepository {
    Order findById(long id);
    void save(Order order);
    List<Order> findByCustomer(long customerId);
}

// The OLD class now implements it. (Often: extract interface via IDE.)
public class JdbcOrderDao implements OrderRepository {
    // ...body unchanged...
}
```

Numbered steps:

1. Use your IDE's **Extract Interface** refactoring on `JdbcOrderDao` to generate `OrderRepository` with the methods clients use.
2. Run the full test suite. Nothing should change — `JdbcOrderDao` still does the work, it just now also satisfies an interface.
3. Commit. Trunk is green; the system is identical to before.

> This is exactly Fowler's *Extract Interface*. See [Dealing with Generalization](../../02-refactoring-techniques/06-dealing-with-generalization/junior.md) for the mechanics.

### Phase 2 — Route clients through it

**Goal:** every client depends on `OrderRepository`, not on `JdbcOrderDao`. The concrete class is still wired in by the composition root, so behavior is identical.

```java
public class OrderService {
    private final OrderRepository repo;                   // <-- now the abstraction
    public OrderService(OrderRepository repo) { this.repo = repo; }

    public Order placeOrder(Order order) {
        repo.save(order);
        return repo.findById(order.id());
    }
}

// Composition root (wiring) — still hands over the old impl.
OrderRepository repo = new JdbcOrderDao(dataSource);
OrderService service = new OrderService(repo);
```

Numbered steps:

1. Change `OrderService`'s field and constructor type from `JdbcOrderDao` to `OrderRepository`. The call sites (`repo.save`, `repo.findById`) are unchanged.
2. Repeat for each client, **one commit per client** if there are many. Small PRs.
3. The only place that still mentions `JdbcOrderDao` is the composition root (the `new JdbcOrderDao(...)`). That is exactly the single point of control you want.
4. Run tests after each client. Green throughout. Commit.

### Phase 3 — Build the new impl behind a flag

**Goal:** write the replacement as a *second* implementation of the same interface. Ship it dark — present in the binary, but not yet used.

```java
// NEW implementation, same interface.
public class StorageEngineOrderRepository implements OrderRepository {
    private final StorageEngineClient client;
    public StorageEngineOrderRepository(StorageEngineClient client) { this.client = client; }

    @Override public Order findById(long id) { /* new impl */ return /* ... */ null; }
    @Override public void save(Order order)  { /* new impl */ }
    @Override public List<Order> findByCustomer(long customerId) { /* new impl */ return List.of(); }
}

// Composition root chooses which impl, driven by a flag.
OrderRepository repo = flags.isEnabled("use-new-order-repo")
        ? new StorageEngineOrderRepository(storageClient)
        : new JdbcOrderDao(dataSource);                   // default = OLD
OrderService service = new OrderService(repo);
```

Numbered steps:

1. Write `StorageEngineOrderRepository`. Give it its own unit and integration tests — test it *directly*, independent of the flag.
2. Add the flag `use-new-order-repo`, defaulting to **false**. Wire the selection in the composition root only.
3. Run the suite with the flag off (must match old behavior) and again with it on (exercises the new impl). Both green.
4. Commit. The new code is on trunk, shippable, and dormant. Nobody's behavior changed.

### Phase 4 — Flip the flag

**Goal:** make clients use the new implementation, gradually and reversibly.

Numbered steps:

1. Enable `use-new-order-repo` for internal/test traffic. Watch dashboards (error rate, latency, data correctness).
2. Roll out to a small percentage of real traffic (e.g. 1%), then ramp: 5% → 25% → 100%. (See [professional.md](professional.md) for the rollout/rollback playbook.)
3. If anything looks wrong, **flip the flag off** — instant rollback to the proven old path. Diagnose, fix, retry.
4. Once 100% is stable for long enough to trust, the new implementation is the one doing the work.

This is the only step that changes behavior, and it is the safest possible way to do so: incremental and instantly reversible.

### Phase 5 — Remove the old impl (and maybe inline)

**Goal:** delete what you no longer need so the next reader isn't confused by two ways to do one thing.

```java
// Composition root, after cleanup — no flag, no old impl.
OrderRepository repo = new StorageEngineOrderRepository(storageClient);
OrderService service = new OrderService(repo);
```

Numbered steps:

1. Delete `JdbcOrderDao` and its tests. The compiler confirms nothing else references it.
2. Delete the `use-new-order-repo` flag and the branching code in the composition root.
3. Decide whether to **keep or inline the abstraction.** Keep `OrderRepository` if it's a genuine, useful boundary (it usually is for persistence — it aids testing and future swaps). Inline it if it was pure scaffolding that now just adds an indirection nobody benefits from.
4. Run the suite. Commit. The change is complete, and trunk was green the entire journey.

> **Leaving the abstraction behind is the most common failure.** A flag that's never removed and an interface with a single implementation are *debt*, not design. See [middle.md](middle.md).

---

## 6. Relationship to feature flags

Branch by Abstraction needs a **switch**, and a feature flag is the most flexible kind. The abstraction is the seam; the flag is the lever that chooses which implementation the seam exposes.

- For a **trivial** swap you might not need a runtime flag at all — a one-line change in the composition root, deployed normally, is enough.
- For anything customer-facing you almost always want a runtime flag so you can ramp traffic and roll back in seconds without a redeploy.

The flag is **temporary**. It exists only to manage the cutover in Phase 4 and must be deleted in Phase 5. A flag that outlives its migration is a textbook source of configuration debt. Flag lifecycle and hygiene are covered in [middle.md](middle.md) and [professional.md](professional.md).

---

## 7. Cousins: Strangler and Parallel Change

These three techniques are a family. They share a philosophy — *change incrementally while staying shippable* — but operate at different scales.

- **Parallel Change (a.k.a. Expand/Contract)** is the same idea applied to a *smaller* unit, typically a single method or a published interface: add the new form (expand), migrate callers, remove the old form (contract). Branch by Abstraction is essentially Parallel Change applied to a whole *component*. See [Parallel Change](../02-parallel-change-expand-contract/junior.md).
- **The Strangler pattern** wraps an *entire legacy application or subsystem* and replaces it piece by piece from the outside, with new functionality intercepting calls until the old system can be retired. Branch by Abstraction works *inside* one codebase at the component level; Strangler often works at the *system/service* boundary. The code-level version is its sibling: [Strangler at code level](../04-strangler-at-code-level/junior.md).

Rough scale ladder: **Parallel Change** (method/interface) → **Branch by Abstraction** (component) → **Strangler** (whole system).

The **Mikado Method** is the complementary *planning* technique — it helps you discover the dependency graph of a large change so you know what to abstract first. See [Mikado Method](../03-mikado-method/junior.md).

---

## 8. When NOT to use it

Branch by Abstraction is overhead. Use it only when the overhead buys you something.

- **The change is small enough to land atomically.** If you can swap the thing in one safe, reviewable, behavior-preserving commit, *just do that.* Don't erect scaffolding for a thirty-minute job.
- **The abstraction would be permanent cruft.** If the only reason the interface exists is the migration, and it adds indirection nobody will ever benefit from afterward, plan to inline it in Phase 5 — or reconsider whether a simpler approach fits.
- **There is no good seam yet.** If clients are tangled directly into the old component with no clean boundary, you may need to *first* do ordinary refactoring (extract methods, break dependencies) to create a seam. Branch by Abstraction assumes you can name what clients need; if you can't yet, that's prerequisite work. The book *Working with Legacy Code* is the canonical reference for creating seams in tangled code.
- **You won't finish.** The dangerous middle state is "two implementations, both half-alive." If you can't commit to reaching Phase 5, you'll leave the codebase worse than you found it. Only start if you'll finish.

---

## 9. Mini glossary

- **Abstraction layer** — the interface (or thin wrapper) that both old and new implementations satisfy; the seam clients depend on.
- **Seam** — a place where you can alter behavior without editing either side of it (Michael Feathers). An interface is a seam.
- **Composition root** — the single place where concrete classes are wired together (where `new` is called). The one spot that chooses old vs. new.
- **Feature flag / toggle** — a runtime switch that selects behavior. Here, it picks which implementation the abstraction exposes.
- **Trunk-based development** — everyone integrates into one shared mainline frequently; long-lived branches are avoided.
- **Behavior-preserving** — a change that leaves the program's observable behavior identical (the definition of a refactoring).
- **Dark / dormant code** — code that ships in the binary but isn't exercised yet (Phase 3).
- **Big-bang cutover** — switching everything to the new implementation at once; the thing Branch by Abstraction lets you avoid.

---

## 10. Review questions

1. Why is "branch" a misleading word for this technique? What actually branches?
2. List the five phases in order. Which single phase deliberately changes behavior, and why is that step safe?
3. What is a "seam," and what is the most common kind of seam in Java?
4. In the persistence example, after Phase 2, which is the *only* file that still mentions the concrete `JdbcOrderDao`? Why is that desirable?
5. Give two concrete reasons Branch by Abstraction beats a three-week feature branch for a large change.
6. What role does a feature flag play, and what must happen to it in Phase 5?
7. Name one situation where you should *not* use Branch by Abstraction, and say what to do instead.
8. How does this technique relate to Parallel Change and to the Strangler pattern in terms of scale?

---

## 11. Next

- [middle.md](middle.md) — when to apply, trade-offs, variations, and pitfalls (flag hygiene, abandoned abstractions).
- [senior.md](senior.md) — judgment at scale and sequencing multiple efforts.
- [professional.md](professional.md) — economics, flag lifecycle, observability, and the rollback playbook.
- [interview.md](interview.md) — questions and model answers.
- [tasks.md](tasks.md) — hands-on exercises.
- [find-bug.md](find-bug.md) — diagnose misapplied Branch by Abstraction.
- [optimize.md](optimize.md) — turn rough "before" situations into clean phased plans.

Related: [Parallel Change](../02-parallel-change-expand-contract/junior.md) · [Mikado Method](../03-mikado-method/junior.md) · [Strangler at code level](../04-strangler-at-code-level/junior.md) · [Keeping the system shippable](../05-keeping-the-system-shippable/junior.md) · [Strategy pattern](../../../design-patterns/03-behavioral/08-strategy/junior.md) · [Adapter pattern](../../../design-patterns/02-structural/01-adapter/junior.md)
