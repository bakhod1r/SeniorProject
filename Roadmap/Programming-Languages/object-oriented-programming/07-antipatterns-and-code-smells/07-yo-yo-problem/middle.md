# Yo-Yo Problem — Middle

> **What?** A catalogue of yo-yo *symptoms* you can spot in code, in IDE behaviour, and in pull requests — followed by a set of mechanical refactors that flatten the hierarchy without breaking callers.
> **How?** Each section names a symptom, shows the suspect code, demonstrates the IDE/test trace that confirms it, and then walks through one refactor: extract collaborators, inline trivial overrides, replace inheritance with delegation, or collapse Template Method hooks.

---

## 1. Six symptoms of a yo-yo in the wild

Junior-level yo-yo detection is "the hierarchy looks deep". Middle-level detection is *naming the specific symptom* you're seeing. Each of the six below has a different mechanical cure.

| #  | Symptom                                                                                  | Where you notice it                                |
| -- | ---------------------------------------------------------------------------------------- | -------------------------------------------------- |
| 1  | "Go to declaration" takes more than four hops to reach the real body                     | IDE navigation                                     |
| 2  | A stack trace lists 5+ methods of the same conceptual call, alternating parent/child     | Logs, debugger                                     |
| 3  | Understanding one feature requires touching six or more files                            | Code review diff size                              |
| 4  | A subclass's only purpose is to call `super.x()` and add one line                        | `git blame` shows tiny class with single override  |
| 5  | New subclass author can't tell which hooks to override without trial and error           | New-hire onboarding pain                           |
| 6  | Type hierarchy view (IntelliJ *Ctrl-H*) shows more than 4 levels of abstract classes     | IDE hierarchy panel                                |

If two or more of these are true for the same call path, you have a yo-yo. Pick the cure that fits the symptom.

---

## 2. Symptom 1 — the IDE 10-hop trace

The cleanest signal is **"navigate to declaration"** in your IDE. Open a leaf class, click on a method that the leaf overrides, press *Ctrl-Alt-B* in IntelliJ (or *Cmd-Alt-B* on macOS). You expect to land in one or two places. If the popup lists six candidates, count how many of them are `abstract` — every abstract entry is a yo-yo level.

```java
// Leaf class — looks fine on its own.
public final class CsvSalaryReport extends AbstractDeductionsReport {
    @Override protected void renderRow(SalaryRow row, StringBuilder out) {
        out.append(row.employeeId()).append(',');
        out.append(row.gross()).append(',');
        out.append(row.netAfterDeductions()).append('\n');
    }
}
```

Now *Ctrl-Alt-B* on `renderRow`. The popup shows it overrides a method introduced four levels up in `AbstractTabularReport`. *Ctrl-B* on `super.renderRow(...)` (if there were one) — you'd land somewhere in the middle of the chain. To know what `netAfterDeductions()` ultimately does, you must climb the hierarchy through `SalaryReport → DeductionsReport → AbstractDeductionsReport → AbstractTabularReport → AbstractReport`.

**Cure (preview):** extract the row-rendering responsibility into a `RowRenderer` strategy, drop the depth from five to two.

---

## 3. Symptom 2 — the alternating stack trace

A debugger or exception stack trace shows the yo-yo as an *alternating* pattern: child, parent, child, parent.

```
java.lang.IllegalStateException: amount below floor
  at com.acme.E.validateExtra(E.java:14)
  at com.acme.B.validate(B.java:11)
  at com.acme.A.process(A.java:8)
  at com.acme.C.doStep(C.java:18)
  at com.acme.D.before(D.java:22)
  at com.acme.E.main(E.java:24)
  at com.acme.D.after(D.java:28)
  at com.acme.A.finish(A.java:14)
  at com.acme.D.cleanup(D.java:32)
  at com.acme.E.cleanup(E.java:30)
```

Reading this trace bottom-up to understand the failure means hopping classes nine times. The smell is not the *length* of the trace — many real systems have long traces — it is that every frame is in the *same hierarchy*, not in different collaborators.

A healthy trace through three collaborators looks like:

```
  at com.acme.Validator.validate(Validator.java:14)
  at com.acme.Step.run(Step.java:18)
  at com.acme.Finisher.finish(Finisher.java:24)
  at com.acme.Processor.process(Processor.java:10)
```

Four frames, four classes, no yo-yo. The structure of the trace mirrors the structure of the design.

---

## 4. Symptom 3 — "one feature, six files"

A request comes in: "When a salary report is generated for an external auditor, prepend a regulatory header line." You estimate it's a two-line change. You open the codebase. The change requires:

- editing `AbstractReport.header()` to accept an optional prefix,
- editing `AbstractTabularReport.header()` to forward the prefix to `super`,
- editing `AbstractDeductionsReport.header()` to honour the prefix,
- editing `SalaryReport.header()` to set the prefix when called via the "external" path,
- editing `CsvSalaryReport.header()` to escape commas in the prefix,
- editing the caller that decides "external" vs "internal".

Six files for one logical change. That is the **shotgun-surgery** consequence of a deep yo-yo. Every concept (header, footer, row, finish) has been smeared across the chain so that no single class fully owns it.

**Cure (preview):** consolidate the header concept into a single `ReportHeader` collaborator. The caller hands a configured `ReportHeader` to the report at construction. One file changes per concept.

---

## 5. Symptom 4 — "the only-purpose-is-super subclass"

Run `git log -L:'class B'` over a year of history. The class has had three commits total: the initial creation, a rename, and one comment fix. The class itself is ten lines:

```java
public abstract class B extends A {
    @Override protected void validate() {
        super.validate();
        validateExtra();
    }
    protected abstract void validateExtra();
}
```

`B` exists to introduce one hook (`validateExtra`) that exactly one subclass implements. The hook itself doesn't represent a stable concept — it's just "the place E adds its check". Two yo-yo files, no semantic gain.

**Mechanical cure — inline:**

```java
public final class E extends A {
    @Override protected void validate() {
        super.validate();
        if (somethingSpecificToE()) throw new IllegalStateException();
    }
    private boolean somethingSpecificToE() { /* ... */ }
}
```

`B` disappears. One file deleted, depth drops by one, the leaf still expresses the same intent — but the intent now lives entirely in one place.

When to *keep* an intermediate abstract class: when more than one direct subclass legitimately uses the hook. Two callers is the minimum that justifies the intermediate level.

---

## 6. Symptom 5 — "which hooks must I override?"

A new engineer wants to add a `JsonSalaryReport`. They extend `AbstractDeductionsReport`. The compiler insists they implement `renderRow`. They do. They run a test — `NullPointerException` at `header.formatTimestamp()`, because they forgot that `JsonSalaryReport` should also override `header()` (the parent's default uses CSV formatting).

This is the **inheritance discoverability problem**: nothing in the IDE tells the subclass author *which* hooks they should also consider overriding. The compiler only enforces `abstract` methods; everything else is silent.

A practical mitigation (not a refactor) is **mark every hook explicitly**: use `final` for methods that must not be overridden, `abstract` for methods that must be, and avoid leaving "optional default" methods around without doc comments. But this only patches the symptom — the real cure is to reduce the hook surface by flattening the chain.

```java
// Make the contract explicit:
public abstract class AbstractTabularReport {
    /** Subclasses MUST implement. */
    protected abstract void renderRow(Row r, StringBuilder out);

    /** Subclasses MAY override; default emits a CSV header. */
    protected void header(StringBuilder out) { out.append("id,name,amount\n"); }

    /** Subclasses MUST NOT override (final). */
    public final String render(List<Row> rows) { /* template body */ }
}
```

Explicit `final` and `abstract` markers convert what was an oral tradition into a compile-time contract.

---

## 7. Symptom 6 — Type Hierarchy view confirms depth

In IntelliJ, with the leaf class focused, press *Ctrl-H* to open the **Type Hierarchy** tool window. Switch to "Supertypes" view. Count levels from the leaf to `Object`.

For typical Java application code, healthy depth is **2 or 3** (your class extends one domain abstract class, which extends `Object`, possibly with one extra level). Five or more is a structural alarm; the leaf isn't a *kind of* the chain so much as a *position within* it.

Framework classes (e.g., Spring's `AbstractCrudRepository` chain) can legitimately be deeper, because each level captures a real reuse axis used by hundreds of subclasses. The rule "depth ≤ 3" is for application code that you and your team own.

---

## 8. Refactor 1 — extract Template Method into Strategy

The most common yo-yo source is *Template Method gone deep*. The mechanical cure is to replace inheritance with a strategy collaborator.

```java
// Before — five-level Template Method:
abstract class A { /* defines process() with hooks step1(), step2() */ }
abstract class B extends A { /* overrides step1() with extra logic */ }
abstract class C extends B { /* splits step2() into pre/main/post hooks */ }
abstract class D extends C { /* fills pre/post defaults */ }
final  class E extends D    { /* fills step1-extra, main, cleanup */ }
```

```java
// After — one concrete coordinator, three strategy interfaces:
public final class Processor {
    private final Validator validator;
    private final Step step;
    private final Finisher finisher;

    public Processor(Validator v, Step s, Finisher f) {
        this.validator = v;
        this.step = s;
        this.finisher = f;
    }

    public void process() {
        validator.validate();
        step.run();
        finisher.finish();
    }
}

public interface Validator { void validate(); }
public interface Step      { void run(); }
public interface Finisher  { void finish(); }
```

Five classes become one coordinator + N small implementations. Each strategy has one job. Adding a new behaviour means writing a new implementation of one interface, not subclassing four levels.

---

## 9. Refactor 2 — collapse trivial chains

When a multi-level chain has only *one* leaf, you don't need a hierarchy at all — collapse it into one class.

```java
// Before:
abstract class Tax { protected abstract BigDecimal base(); }
abstract class IncomeTax extends Tax { /* + bracket logic */ }
final  class CountryATax extends IncomeTax { @Override protected BigDecimal base() { ... } }

// After:
public final class CountryATax {
    public BigDecimal compute() { /* inline everything */ }
}
```

The "abstraction" served no current purpose — only one concrete existed. Inheritance for a single-implementation case is dead weight. When (and if) a second country's tax shows up, *then* extract a strategy.

---

## 10. Refactor 3 — preserve the chain, document the contract

Some hierarchies are deep for legitimate reuse reasons (e.g., a framework you ship to many consumers). You can't always flatten. In those cases, *document the override contract* so callers and subclassers don't have to yo-yo.

```java
/**
 * Lifecycle order:
 *   1. {@link #validate()} (default: noop; overridable)
 *   2. {@link #before()}   (default: noop; overridable)
 *   3. {@link #main()}     (MUST override)
 *   4. {@link #after()}    (default: noop; overridable)
 *   5. {@link #finish()}   (default: noop; overridable, but call super)
 *
 * Do NOT override {@link #process()}. It is final.
 */
public abstract class AbstractLifecycle {
    public final void process() { /* template */ }
    protected void   validate() { }
    protected void   before()   { }
    protected abstract void main();
    protected void   after()    { }
    protected void   finish()   { }
}
```

When you must keep depth, replace the implicit yo-yo with explicit documentation and explicit `final`/`abstract` markers. The reader still navigates the chain — but the navigation is *guided*.

---

## 11. The expand-document-flatten progression

A practical migration playbook for an existing yo-yo:

1. **Expand the documentation first.** Mark every hook `abstract` or default + comment. Mark `final` everything the framework promises is final. This is non-breaking; it makes the contract visible.
2. **Identify the single-leaf intermediates.** Any `abstract class X` with exactly one direct concrete subclass is a candidate for inlining.
3. **Inline them.** Remove the intermediate; copy its hook implementations into the leaf. Tests should still pass.
4. **Now look at the remaining chain.** If depth is still > 3, identify the hook *clusters* — groups of related hooks that always travel together. Extract each cluster into a collaborator interface.
5. **Flatten by composition.** Replace the chain's top-level `process()` with a coordinator that calls collaborators.

The order matters: documenting first prevents you from removing a class that turns out to be load-bearing for a hidden contract.

---

## 12. Quick rules

- [ ] If "go to declaration" takes 5+ hops in your IDE, you have a yo-yo.
- [ ] If an intermediate `abstract` class has exactly one subclass, inline it.
- [ ] If a feature change touches 6+ files in the same hierarchy, the chain is too tightly coupled.
- [ ] Prefer composition over Template Method for any new variation point.
- [ ] Cap application-code inheritance depth at 3; mark frameworks separately.
- [ ] Make every hook in a base class `abstract`, `final`, or documented as default.

---

## 13. What's next

| Topic                                                            | File              |
| ---------------------------------------------------------------- | ----------------- |
| Cognitive load research, Fragile Base Class link                 | `senior.md`        |
| Spring/Servlet chains, ArchUnit DIT rules                        | `professional.md`  |
| DIT/NOC metrics, PMD rule references                             | `specification.md` |
| 10 yo-yo bugs with diagnoses                                     | `find-bug.md`      |
| Virtual dispatch costs at depth, JIT inlining limits             | `optimize.md`      |
| Exercises                                                        | `tasks.md`         |
| Interview Q&A                                                    | `interview.md`     |

Related smells: [Fragile Base Class Problem](../../03-design-principles/06-fragile-base-class-problem/), [Composition over Inheritance](../../03-design-principles/02-composition-over-inheritance/), [Refused Bequest](../04-refused-bequest/).

---

**Memorize this:** The Yo-Yo Problem has six recognisable symptoms — IDE hop count, alternating stack frames, six-file features, only-purpose-is-super subclasses, undiscoverable hooks, and deep hierarchy views. Match the symptom to the cure: inline trivial layers, extract Template Method into Strategy, or — if you must keep the chain — document the override contract explicitly.
