# Yo-Yo Problem — Senior

> **What?** The Yo-Yo Problem is a comprehension antipattern where reading a single method forces the reader to bounce up and down a deep inheritance chain to assemble the actual runtime behavior. Every level contributes a fragment — a super call, an override, a hook — and no single file tells the whole story.

> **How?** Senior engineers treat the Yo-Yo Problem as a *cognitive load* problem, not just a style preference. They measure it with DIT (Depth of Inheritance Tree), correlate it with bug density, and refactor using a disciplined sequence: inline trivial overrides, flatten via composition, then replace Template Method with Strategy.

---

## 1. The cognitive load research behind yo-yo reading

Studies on program comprehension (Sweller's cognitive load theory applied to code by Siegmund, Peitek, and others using fMRI) consistently show:

- **Working memory holds 4–7 items.** Each hop up an inheritance chain consumes one slot to track "where am I, what did I override, what did the parent do".
- **Method dispatch resolution is *intrinsic load*.** It cannot be eliminated by familiarity; even experts pay the cost.
- **Yo-yo navigation breaks chunking.** Readers cannot form a stable mental model of "what this method does" because the answer is distributed.

Empirical correlations (from Basili, Briand, Melo 1996 and later replications):
- Classes with **DIT > 3** have measurably higher defect density.
- Methods that override and call `super` across **more than 2 levels** are 2–3x more likely to be involved in bugs touching inheritance.

Senior takeaway: when you feel the urge to scroll up to a parent class for the third time in one debugging session, that is the antipattern signaling itself. Trust the signal.

---

## 2. Relationship to the Fragile Base Class Problem

The Yo-Yo Problem and the [Fragile Base Class Problem](../../03-design-principles/02-composition-over-inheritance/) are two faces of the same dysfunction:

| Aspect | Yo-Yo Problem | Fragile Base Class |
|---|---|---|
| Primary symptom | Hard to *read* | Hard to *change* |
| Who suffers | The reader | The base-class author |
| Trigger | Behavior split across N classes | Subclass depends on internal calls of base |
| Fix direction | Flatten or compose | Seal, document, or compose |

They reinforce each other: deep hierarchies make the base fragile (more subclasses observing more internal calls), and a fragile base discourages flattening (you cannot safely move code up or down).

A senior engineer who sees one should immediately check for the other.

---

## 3. Template Method overuse — the most common yo-yo source

The Template Method pattern (GoF) is correct when:
1. The algorithm skeleton is genuinely fixed.
2. There are exactly 2–3 well-named extension points.
3. The hierarchy is **one level deep** (abstract base + concrete leaves).

It becomes a yo-yo when:
- Subclasses themselves become abstract templates for further subclasses.
- Hooks call other hooks, which call other hooks.
- The skeleton itself is overridden "just this once" in one leaf.

```java
// Yo-yo Template Method — DO NOT do this
abstract class Report {
    public final String render() {
        return header() + body() + footer();
    }
    protected abstract String header();
    protected String body() { return defaultBody(); }
    protected abstract String defaultBody();
    protected String footer() { return ""; }
}

abstract class TabularReport extends Report {
    @Override protected String header() { return tableHeader(); }
    protected abstract String tableHeader();
    @Override protected String defaultBody() { return rows(); }
    protected abstract String rows();
}

class SalesReport extends TabularReport {
    @Override protected String tableHeader() { return "Sales"; }
    @Override protected String rows() { return fetchSales(); }
    @Override protected String footer() { return "Generated " + now(); }
    private String fetchSales() { /* ... */ return ""; }
    private String now() { return ""; }
}
```

To understand what `new SalesReport().render()` produces, the reader must visit three files and reconstruct six method calls in order. That is the yo-yo.

---

## 4. Refactoring sequence — three steps in order

Senior engineers do not jump to "replace inheritance with composition" as the first move. Apply this sequence:

### Step 1 — Inline trivial overrides

If an override does nothing or just delegates, delete it. IntelliJ: `Refactor → Inline Method` (Ctrl+Alt+N / Cmd+Alt+N).

```java
// Before
class B extends A { @Override void doThing() { super.doThing(); } }
// After
class B extends A { } // override deleted
```

This often collapses 5-level chains to 2-level chains with no behavior change.

### Step 2 — Flatten via composition for behavior, keep inheritance for type

If subclasses differ only in a handful of values or small behaviors, extract those into a small strategy object and pass them to a single concrete class.

```java
// Before: SalesReport extends TabularReport extends Report
// After:
final class Report {
    private final ReportFormat format;
    Report(ReportFormat format) { this.format = format; }
    public String render() {
        return format.header() + format.body() + format.footer();
    }
}

interface ReportFormat {
    String header();
    String body();
    String footer();
}

final class SalesFormat implements ReportFormat { /* 3 methods, one file */ }
```

Now `new Report(new SalesFormat()).render()` is readable in one file.

### Step 3 — Replace Template Method with Strategy

When the skeleton itself varies, promote the skeleton to a function and pass it as a strategy. This is the GoF "Replace Inheritance with Delegation" move applied at the algorithm level.

```java
final class Report {
    private final Supplier<String> header;
    private final Supplier<String> body;
    private final Supplier<String> footer;
    // constructor + render() that just concatenates
}
```

---

## 5. IntelliJ tools every senior should use weekly

| Tool | Shortcut (mac / win) | What it reveals |
|---|---|---|
| Type Hierarchy | Ctrl+H / Ctrl+H | Full ancestor + descendant tree of a class — instantly shows DIT and NOC |
| Method Hierarchy | Ctrl+Shift+H / Ctrl+Shift+H | Every override of a method across the hierarchy — instantly shows yo-yo paths |
| Call Hierarchy | Ctrl+Alt+H / Ctrl+Alt+H | All callers of a method, recursively |
| Structural Search | Edit → Find → Search Structurally | Find all `super.x()` calls inside overrides of `x()` |

The Type Hierarchy view with the "Supertypes Hierarchy" filter set to "Subtypes Hierarchy" is the fastest way to spot a class with DIT > 3 — you scroll and visually count the indentation depth.

The Method Hierarchy view is the yo-yo detector: when you see an override that calls `super` and is itself overridden by another class that also calls `super`, you have a confirmed yo-yo chain.

---

## 6. Quick rules

1. **DIT > 3 is a refactoring trigger.** Not "maybe", a trigger. Investigate every class above that line.
2. **Never override and call `super` more than once in a chain.** If level 3 needs to call level 2 which calls level 1, replace with composition.
3. **Final classes by default.** Make every concrete class `final` unless you have a written reason for it to be extended.
4. **One Template Method per hierarchy, max.** If you find a second template inside a subclass, split the hierarchy.
5. **Inline before you flatten.** Trivial overrides hide the real depth — remove them first to see the truth.
6. **Read with IntelliJ open.** If understanding a method requires the Type Hierarchy view, the design has already failed.
7. **Sealed types for closed hierarchies.** Java 17+ `sealed` makes the hierarchy explicit and bounded, which kills the worst yo-yos.

---

## 7. When inheritance still wins

Senior engineers do not crusade against inheritance. Use it when:
- The hierarchy models a true *is-a* relationship that the type system enforces (e.g., `IOException extends Exception`).
- The hierarchy is shallow (DIT ≤ 2) and **sealed** to a known set of subtypes.
- Subclasses share *structural* identity — fields, invariants — not just behavior fragments.

The yo-yo problem only emerges when inheritance is used to *share code* rather than to *model types*. That distinction is the whole game.

---

## 8. What's next

| Topic | Why |
|---|---|
| [Fragile Base Class Problem](../06-fragile-base-class-problem/) | The change-time twin of the yo-yo |
| [Refused Bequest](../05-refused-bequest/) | Subclasses ignoring inherited behavior often hide inside yo-yo chains |
| [Composition Over Inheritance](../../../03-design-principles/02-composition-over-inheritance/) | The structural fix for yo-yo and fragile base together |
| [Template Method (design patterns)](../../../15-design-patterns-in-go/) | The pattern most commonly misused into a yo-yo |
| [SOLID — LSP](../../../03-design-principles/01-solid-principles/) | Yo-yo chains routinely violate Liskov substitution |

---

**Memorize this:** The Yo-Yo Problem is a cognitive load tax measured by DIT and revealed by IntelliJ's Method Hierarchy. Fix it in three steps — inline trivial overrides, flatten with composition, replace Template Method with Strategy — and never write a hierarchy deeper than three levels without a written justification.
