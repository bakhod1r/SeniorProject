# Refactoring Toward Behavioral Patterns — Junior Level

> **Source:** Joshua Kerievsky, *Refactoring to Patterns* (Addison-Wesley, 2004); [refactoring.guru/design-patterns/behavioral-patterns](https://refactoring.guru/design-patterns/behavioral-patterns)

Behavioral patterns are about **who does what, when, and how objects talk to each other**. Creational patterns answer "how do I make an object?" and structural patterns answer "how do I compose objects?" — behavioral patterns answer "how is *responsibility* distributed and how does *control flow*?"

You almost never sit down and decide "today I will build a Strategy." Instead, your code grows a smell — a sprawling conditional, a method that does five unrelated things depending on a flag, two methods that are 90% identical — and the *cure* for that smell happens to be a named behavioral pattern. This is Kerievsky's central insight: **patterns are destinations you refactor *toward*, reached by small behavior-preserving steps, not blueprints you impose up front.**

This file teaches the three most common journeys a junior engineer will take:

1. **Replace Conditional Logic with Strategy** — the flagship.
2. **Replace State-Altering Conditionals with State**.
3. **Form Template Method**.

Each is presented as: the **smell** that triggers it → the **motivation** → **numbered mechanical steps** that preserve behavior → **before/after code** → the **pattern you arrive at** → **when NOT to** do it.

---

## Table of Contents

- [The mindset: smell first, pattern second](#the-mindset-smell-first-pattern-second)
- [A real-world analogy](#a-real-world-analogy)
- [Refactoring 1 — Replace Conditional Logic with Strategy](#refactoring-1--replace-conditional-logic-with-strategy)
- [Refactoring 2 — Replace State-Altering Conditionals with State](#refactoring-2--replace-state-altering-conditionals-with-state)
- [Refactoring 3 — Form Template Method](#refactoring-3--form-template-method)
- [Smell → Refactoring table](#smell--refactoring-table)
- [Strategy vs State vs Template Method — quick contrast](#strategy-vs-state-vs-template-method--quick-contrast)
- [Mini glossary](#mini-glossary)
- [Review questions](#review-questions)
- [Next](#next)

---

## The mindset: smell first, pattern second

Two non-negotiable rules frame everything below.

**Rule 1 — Behavior preservation.** A refactoring must not change what the program *does*, only how it is *organized*. After every step the tests must still pass. If you change behavior, that's a feature change, not a refactoring — do it separately. This is why each refactoring below is a *numbered sequence of small steps*: small steps keep you in a working state, so a failing test points at the one tiny change you just made.

**Rule 2 — Let the smell lead.** Don't ask "where can I use Strategy?" Ask "what is wrong with this code?" The smell tells you which pattern is the cure:

- A `switch`/`if-else` that chooses **an algorithm** → **Strategy**.
- A `switch`/`if-else` that chooses **behavior based on the object's mode/lifecycle** *and rewires future transitions* → **State**.
- Two methods with the **same skeleton, different steps** → **Template Method**.

The difference between Strategy and State is subtle and trips up nearly everyone — we'll nail it down precisely below.

---

## A real-world analogy

Think of a **GPS navigation app**.

- **Strategy** is the *route-mode selector*: Drive, Walk, Bike, Public Transit. Each is a different *algorithm* for computing a route over the same map. You pick one; the app delegates the whole "compute route" job to it. Swapping Walk for Bike changes the calculation but not *who* the app is. The user chooses freely and the modes don't decide among themselves.

- **State** is the *trip lifecycle*: `Idle → Routing → Navigating → Arrived`. Each state not only behaves differently (in `Navigating`, "recalculate" re-routes; in `Idle`, "recalculate" does nothing) but also **decides the next state** ("arrive at destination" moves `Navigating → Arrived`). The object's behavior and its *future* both depend on its current mode, and the modes hand control to one another.

- **Template Method** is the *fixed trip skeleton* every mode shares: `acquireGPS() → planRoute() → renderTurns() → announce()`. The skeleton never changes; only `planRoute()` and `announce()` differ between Drive and Walk. You write the skeleton once and let each mode fill in the blanks.

Hold this analogy; we'll map code onto it.

---

## Refactoring 1 — Replace Conditional Logic with Strategy

### Starting smell

A single method's core behavior is selected by a conditional over **which algorithm to run**. The conditional is stable in *shape* but keeps growing new branches, and each branch is a self-contained calculation. Symptoms: a long `switch` on a "type" string, branches that don't share local variables, and a sinking feeling every time a new case is added.

```java
// BEFORE — a shipping-cost calculator that grows a branch per carrier.
public class ShippingCostCalculator {

    public double calculate(Order order, String carrier) {
        double weight = order.totalWeightKg();
        double distance = order.distanceKm();

        if (carrier.equals("FLAT")) {
            return 9.99;

        } else if (carrier.equals("WEIGHT_BASED")) {
            double cost = weight * 2.5;
            if (weight > 20) cost *= 0.9;          // bulk discount
            return cost;

        } else if (carrier.equals("DISTANCE_BASED")) {
            double cost = 5.0 + distance * 0.12;
            if (distance > 500) cost += 15.0;      // long-haul surcharge
            return cost;

        } else if (carrier.equals("EXPEDITED")) {
            return weight * 2.5 + distance * 0.30 + 25.0;

        } else {
            throw new IllegalArgumentException("Unknown carrier: " + carrier);
        }
    }
}
```

Every new carrier edits this class, the method is hard to test branch-by-branch, and the `else throw` is a code smell announcing "this should have been polymorphism."

### Motivation

The branches are **interchangeable algorithms**. The Strategy pattern names this exactly: extract each algorithm into its own object behind a common interface, then *select* the object instead of *branching* on a string. Benefits: each strategy is independently testable, adding a carrier means adding a class (Open/Closed), and the calculator no longer knows the carriers exist.

> Strategy as a pattern: [`../../../design-patterns/03-behavioral/08-strategy/junior.md`](../../../design-patterns/03-behavioral/08-strategy/junior.md). Here we focus on *how to get there mechanically*.

### Mechanical steps

1. **Create the Strategy interface.** Give it one method matching the conditional's job, with the data the branches need as parameters.
2. **Create one concrete strategy per branch.** Copy a branch body into its `calculate`, verbatim. Don't clean up yet — preserve behavior first.
3. **Replace the branch body with a delegation** *one branch at a time*: in the old method, instead of running the branch, instantiate the strategy and call it. Run tests after each branch.
4. **Replace the conditional itself with selection.** Introduce a factory/map from the selector key to a strategy. The old `if-else` collapses to a lookup.
5. **Push selection to the caller (optional, recommended).** Once callers can pass a strategy directly, the string key and the factory may disappear entirely.
6. **Clean up inside each strategy** now that it's isolated and tested.

### After

```java
// Step 1: the interface — one job, all inputs explicit.
public interface ShippingStrategy {
    double calculate(Order order);
}

// Step 2: one class per former branch.
public final class FlatRateShipping implements ShippingStrategy {
    public double calculate(Order order) { return 9.99; }
}

public final class WeightBasedShipping implements ShippingStrategy {
    public double calculate(Order order) {
        double cost = order.totalWeightKg() * 2.5;
        if (order.totalWeightKg() > 20) cost *= 0.9;
        return cost;
    }
}

public final class DistanceBasedShipping implements ShippingStrategy {
    public double calculate(Order order) {
        double cost = 5.0 + order.distanceKm() * 0.12;
        if (order.distanceKm() > 500) cost += 15.0;
        return cost;
    }
}

public final class ExpeditedShipping implements ShippingStrategy {
    public double calculate(Order order) {
        return order.totalWeightKg() * 2.5 + order.distanceKm() * 0.30 + 25.0;
    }
}
```

```java
// Step 4: selection by lookup, not branching. The conditional is gone.
public class ShippingCostCalculator {

    private static final Map<String, ShippingStrategy> STRATEGIES = Map.of(
        "FLAT",           new FlatRateShipping(),
        "WEIGHT_BASED",   new WeightBasedShipping(),
        "DISTANCE_BASED", new DistanceBasedShipping(),
        "EXPEDITED",      new ExpeditedShipping()
    );

    // Step 5: the cleanest form — callers pass the strategy, no key, no map.
    public double calculate(Order order, ShippingStrategy strategy) {
        return strategy.calculate(order);
    }

    // Bridge for callers that still hold a string key (e.g. from config/DB).
    public double calculate(Order order, String carrier) {
        ShippingStrategy s = STRATEGIES.get(carrier);
        if (s == null) throw new IllegalArgumentException("Unknown carrier: " + carrier);
        return s.calculate(order);
    }
}
```

The stateless strategies above are safely shared as singletons in the map — that's the common, correct case. **(Warning: if a strategy held mutable per-call state, sharing one instance across threads would be a bug — see [find-bug.md](find-bug.md).)**

### When NOT to

- **The branches share lots of local state.** If branches read/write the same locals and weave together, extracting them forces awkward parameter passing. Untangle the method first (Extract Method) before reaching for Strategy.
- **There are exactly two stable branches that will never grow.** A plain `if/else` is clearer and cheaper than two classes plus an interface. Strategy earns its keep when variants multiply or must be swapped/configured at runtime.
- **The selection is about the object's *mode/lifecycle*, not algorithm choice.** That's State, not Strategy (next).

---

## Refactoring 2 — Replace State-Altering Conditionals with State

### Starting smell

A class carries a `status`/`mode` field, and **many methods branch on it**. Worse, the branches not only *behave* differently per status, they also *change* the status — transition logic is smeared across every method, and it's impossible to see the state machine because it doesn't exist in one place.

```java
// BEFORE — a document with status logic scattered across methods.
public class Document {
    private String status = "DRAFT";   // DRAFT | MODERATION | PUBLISHED | ARCHIVED

    public void publish(User user) {
        if (status.equals("DRAFT")) {
            if (user.isAdmin()) {
                status = "PUBLISHED";
            } else {
                status = "MODERATION";
            }
        } else if (status.equals("MODERATION")) {
            if (user.isAdmin()) {
                status = "PUBLISHED";
            }
            // non-admins: silently do nothing — is that intended? unclear.
        } else if (status.equals("PUBLISHED")) {
            throw new IllegalStateException("Already published");
        } else if (status.equals("ARCHIVED")) {
            throw new IllegalStateException("Cannot publish an archived doc");
        }
    }

    public void archive() {
        if (status.equals("PUBLISHED")) {
            status = "ARCHIVED";
        } else if (status.equals("DRAFT")) {
            status = "ARCHIVED";
        } else {
            throw new IllegalStateException("Cannot archive from " + status);
        }
    }
    // ... render(), canEdit(), etc., each with its own status switch
}
```

The transitions form a graph, but nobody can see it. Adding a state means editing *every* method. Invalid transitions are easy to introduce and hard to spot.

### Motivation

Make the state machine **explicit**: one class per status, each knowing its own behavior *and* its own legal transitions. The `Document` delegates to its current state object; transitions become `this.state = next`. The graph of states becomes readable, and an illegal transition is the *absence* of a method override — a single place to look.

> State as a pattern, with the full transition-ownership discussion: [`../../../design-patterns/03-behavioral/07-state/junior.md`](../../../design-patterns/03-behavioral/07-state/junior.md).

### Mechanical steps

1. **Create a state interface (or abstract base)** with one method per operation that branches on status (`publish`, `archive`, …). Give the base a sensible default — usually "throw illegal transition" — so each concrete state only overrides what's legal.
2. **Create one state class per status value.** Move the matching branch from each method into the right state class.
3. **Add a `context` reference.** Each state needs to ask the `Document` to switch states: `doc.changeState(new Published())`. Pass the `Document` into the state method (or hold a back-reference).
4. **Replace the field's type.** `String status` becomes `DocumentState state`. Initialize it to the starting state.
5. **Delegate.** Each `Document` method becomes a one-liner: `state.publish(this, user)`. The conditionals vanish.
6. **Make illegal transitions explicit** via the base class default, instead of scattered `else throw`.

### After

```java
public abstract class DocumentState {
    // Default: every transition is illegal unless a state opts in.
    public void publish(Document doc, User user) { illegal("publish"); }
    public void archive(Document doc)            { illegal("archive"); }

    private void illegal(String op) {
        throw new IllegalStateException(op + " not allowed in " + getClass().getSimpleName());
    }
}

public final class Draft extends DocumentState {
    @Override public void publish(Document doc, User user) {
        doc.changeState(user.isAdmin() ? new Published() : new Moderation());
    }
    @Override public void archive(Document doc) { doc.changeState(new Archived()); }
}

public final class Moderation extends DocumentState {
    @Override public void publish(Document doc, User user) {
        if (user.isAdmin()) doc.changeState(new Published());
        // non-admins: explicitly a no-op, and now that intent is documented here.
    }
}

public final class Published extends DocumentState {
    @Override public void archive(Document doc) { doc.changeState(new Archived()); }
    // publish() falls through to base -> "already published" illegal transition.
}

public final class Archived extends DocumentState {
    // Both publish() and archive() are illegal -> base class handles it.
}
```

```java
public class Document {
    private DocumentState state = new Draft();

    void changeState(DocumentState next) { this.state = next; }

    public void publish(User user) { state.publish(this, user); }
    public void archive()          { state.archive(this); }
}
```

Now the whole state machine reads off the class list, each transition lives in exactly one place, and an unhandled operation is *automatically* an illegal transition rather than a silently-missing branch.

### When NOT to

- **Only one or two methods branch on a simple two-value flag.** A boolean and an `if` is fine; four state classes would be ceremony.
- **The "states" don't drive transitions.** If selection is just "pick behavior" with no lifecycle and no transition logic, you want **Strategy**, not State. The tell for State is: *the chosen object decides what comes next.*
- **You need persisted/audited transitions with guards and side effects across many entities.** At that scale consider a dedicated state-machine library rather than hand-rolled classes.

---

## Refactoring 3 — Form Template Method

### Starting smell

Two (or more) sibling methods — often in sibling subclasses, or two near-duplicate methods in one class — share the **same overall sequence of steps** but differ in a few specific steps. The duplication is structural: same skeleton, different filling.

```java
// BEFORE — two report generators that are 80% identical.
public class HtmlReport {
    public String generate(List<Sale> sales) {
        StringBuilder sb = new StringBuilder();
        sb.append("<html><body>");                    // header  (differs)
        sb.append("<h1>Sales Report</h1>");
        double total = 0;
        for (Sale s : sales) {                          // body loop (SAME)
            sb.append("<p>").append(s.item())
              .append(": ").append(s.amount()).append("</p>");
            total += s.amount();
        }
        sb.append("<strong>Total: ").append(total).append("</strong>");
        sb.append("</body></html>");                    // footer (differs)
        return sb.toString();
    }
}

public class CsvReport {
    public String generate(List<Sale> sales) {
        StringBuilder sb = new StringBuilder();
        sb.append("item,amount\n");                     // header (differs)
        double total = 0;
        for (Sale s : sales) {                          // body loop (SAME structure)
            sb.append(s.item()).append(",").append(s.amount()).append("\n");
            total += s.amount();
        }
        sb.append("TOTAL,").append(total).append("\n"); // footer (differs)
        return sb.toString();
    }
}
```

The iteration-and-accumulate skeleton is duplicated. Fix a bug in the total logic and you must fix it twice.

### Motivation

Pull the **invariant skeleton** up into one place and let subclasses supply only the **varying steps**. The skeleton method — the *template method* — calls abstract "primitive operations" that subclasses implement. Duplication of the algorithm's shape drops to zero; the differences become small, named, overridable methods.

> Template Method as a pattern, including the Hollywood Principle ("don't call us, we'll call you"): [`../../../design-patterns/03-behavioral/09-template-method/junior.md`](../../../design-patterns/03-behavioral/09-template-method/junior.md).

### Mechanical steps

1. **Line the methods up** and mark each line as *same* or *differs*. (The comments above are exactly this step done by hand.)
2. **Extract each "differs" region into its own method** in *each* class, with identical signatures. Now both `generate` methods are line-for-line identical except for which helpers they call.
3. **Pull the now-identical `generate` up** into a common abstract superclass.
4. **Declare the varying helpers abstract** in the superclass.
5. **Make the original classes extend the superclass**, keeping only their helper overrides.
6. Run tests after each pull-up; behavior is preserved throughout.

### After

```java
public abstract class Report {
    // The template method: the skeleton, fixed for all subclasses. Made final
    // so subclasses cannot accidentally override the algorithm's shape.
    public final String generate(List<Sale> sales) {
        StringBuilder sb = new StringBuilder();
        appendHeader(sb);
        double total = 0;
        for (Sale s : sales) {
            appendRow(sb, s);
            total += s.amount();
        }
        appendFooter(sb, total);
        return sb.toString();
    }

    // Primitive operations — the "differs" parts. Subclasses fill these in.
    protected abstract void appendHeader(StringBuilder sb);
    protected abstract void appendRow(StringBuilder sb, Sale s);
    protected abstract void appendFooter(StringBuilder sb, double total);
}

public class HtmlReport extends Report {
    protected void appendHeader(StringBuilder sb) {
        sb.append("<html><body><h1>Sales Report</h1>");
    }
    protected void appendRow(StringBuilder sb, Sale s) {
        sb.append("<p>").append(s.item()).append(": ").append(s.amount()).append("</p>");
    }
    protected void appendFooter(StringBuilder sb, double total) {
        sb.append("<strong>Total: ").append(total).append("</strong></body></html>");
    }
}

public class CsvReport extends Report {
    protected void appendHeader(StringBuilder sb) { sb.append("item,amount\n"); }
    protected void appendRow(StringBuilder sb, Sale s) {
        sb.append(s.item()).append(",").append(s.amount()).append("\n");
    }
    protected void appendFooter(StringBuilder sb, double total) {
        sb.append("TOTAL,").append(total).append("\n");
    }
}
```

The skeleton lives once. A new format (`PdfReport`) is three small methods — and physically *cannot* get the iteration or total logic wrong because it doesn't own them.

### When NOT to

- **The variation is best composed, not inherited.** Template Method bakes the variation into a subclass hierarchy. If you want to mix-and-match varying steps at *runtime*, pass them in as **Strategy** objects (or lambdas) instead — favor composition over inheritance. (See the Strategy-vs-Template contrast in [middle.md](middle.md) and [interview.md](interview.md).)
- **The skeleton isn't actually stable.** If the *sequence* itself differs between siblings (not just the steps), forcing a shared template creates a leaky, hook-riddled superclass.
- **Only one subclass exists.** Don't form a template "in case" a second variant appears. Wait for the duplication to be real.

---

## Smell → Refactoring table

| Smell you observe | Behavioral refactoring | Pattern you arrive at | Covered in |
|---|---|---|---|
| `switch`/`if-else` selecting an **algorithm** | Replace Conditional Logic with Strategy | Strategy | junior |
| Methods branch on a `status` field **and** flip that field | Replace State-Altering Conditionals with State | State | junior |
| Two methods, same skeleton, different steps | Form Template Method | Template Method | junior |
| Giant `switch(actionCode)` dispatching work | Replace Conditional Dispatcher with Command | Command | [middle.md](middle.md) |
| Repeated `if (x != null)` before every use | Introduce Null Object | Null Object | [middle.md](middle.md) |
| Class hard-codes calls to specific dependents | Replace Hard-Coded Notifications with Observer | Observer | [middle.md](middle.md) |
| Accumulation logic spread over a heterogeneous structure | Move Accumulation to Visitor | Visitor | [senior.md](senior.md) |
| A method builds a result into a local across sub-steps | Move Accumulation to Collecting Parameter | (Collecting Parameter) | [senior.md](senior.md) |
| Ad-hoc string/flag mini-language accreting | Replace Implicit Language with Interpreter | Interpreter | [senior.md](senior.md) |
| A chain of `if` handlers, each maybe handling, maybe passing on | (form a) Chain of Responsibility | Chain of Responsibility | [senior.md](senior.md) |

---

## Strategy vs State vs Template Method — quick contrast

All three replace conditionals with polymorphism, so they're easy to confuse. The distinction is *what varies and who's in charge*:

| | Strategy | State | Template Method |
|---|---|---|---|
| **What varies** | The whole algorithm | Behavior per lifecycle mode | A few steps inside a fixed algorithm |
| **Who selects** | The client, freely, anytime | The states themselves drive transitions | The subclass, chosen at construction |
| **Swaps at runtime?** | Yes — set a new strategy | Yes — but *internally*, on transition | No — fixed by the subclass instance |
| **Key tell** | "Pick how to do X" | "X's behavior depends on its mode, and the mode changes itself" | "Same shape, different blanks" |
| **Composition vs inheritance** | Composition | Composition | Inheritance |

If you set the object once and let the client change it → Strategy. If the object reassigns itself based on events → State. If the only variation is a couple of steps inside a stable sequence → Template Method.

---

## Mini glossary

- **Behavior-preserving** — a code change that leaves observable behavior identical; the defining property of a refactoring.
- **Smell** — a surface symptom (long conditional, duplicated skeleton) hinting at a deeper structural problem.
- **Strategy** — an interchangeable algorithm wrapped in an object behind a common interface.
- **State (pattern)** — an object representing a lifecycle mode that encapsulates both per-mode behavior and the transitions to other modes.
- **Template Method** — a method defining an algorithm's skeleton, deferring specific steps to overridable "primitive operations."
- **Primitive operation** — the abstract, subclass-supplied step a template method calls.
- **Context** — in State/Strategy, the object that holds and delegates to the current state/strategy.
- **Open/Closed Principle** — open for extension (add a class), closed for modification (don't edit existing code). Strategy/State/Command help you reach it.
- **Delegation** — forwarding a method call to another object instead of doing the work inline; the mechanism behind all three patterns here.

---

## Review questions

1. What single property must hold true after *every* step of a refactoring, and why does that property justify taking small steps?
2. You see `if (type.equals("A")) … else if (type.equals("B")) …` selecting a computation. Which refactoring applies, and what is the first mechanical step?
3. Give the one-sentence test that distinguishes **Strategy** from **State**.
4. In Form Template Method, why is the template method commonly marked `final`?
5. Why does giving the State base class a default "throw illegal transition" method *reduce* bugs compared to scattered `else throw` branches?
6. Name two situations where you should *not* replace a conditional with Strategy.
7. In the State example, where does the transition `Moderation → Published` live, and why is that better than the original?
8. Template Method uses inheritance; Strategy uses composition. Give a concrete reason you'd prefer Strategy even when both could work.

---

## Next

- **[middle.md](middle.md)** — Replace Conditional Dispatcher with Command, Introduce Null Object, Replace Hard-Coded Notifications with Observer; Strategy vs State vs polymorphism.
- **[senior.md](senior.md)** — Move Accumulation to Visitor / Collecting Parameter, Interpreter, Chain of Responsibility, double dispatch, pattern interplay.
- **[professional.md](professional.md)** — Runtime cost: virtual dispatch, allocation, Observer leaks, when conditionals win.
- **[interview.md](interview.md)** — Q&A drills on these distinctions.
- **[tasks.md](tasks.md)** · **[find-bug.md](find-bug.md)** · **[optimize.md](optimize.md)** — hands-on practice.
- Siblings: **[../01-when-to-refactor-to-patterns/junior.md](../01-when-to-refactor-to-patterns/junior.md)** · **[../05-refactoring-away-from-patterns/junior.md](../05-refactoring-away-from-patterns/junior.md)**.
- Technique cross-link: **[Replace Conditional with Polymorphism / Introduce Null Object](../../02-refactoring-techniques/04-simplifying-conditionals/junior.md)**.
