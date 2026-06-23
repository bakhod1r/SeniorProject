# OO Metrics — the CK Suite — Find the Smell

> Each item shows code or a metrics report. Read it, decide **what design smell the metrics reveal** (or whether the metric is *misleading* you), then reveal the diagnosis and fix. The skill being trained is *reading metrics correctly* — including knowing when a high number is fine and a low number is a trap.

---

## 1. The god-class signature

```
class,                  wmc, dit, noc, cbo, rfc, lcom4
com.acme.OrderManager,  94,  1,   0,   22,  168, 6
```

**What do these numbers say?**

<details><summary>Diagnosis</summary>

WMC 94 (huge), CBO 22 (very high), RFC 168 (enormous response set), LCOM4 6 (six independent class-clusters inside one file). All the size/coupling/cohesion metrics elevated *together* — the textbook **god class** signature. DIT/NOC are flat, so it's not an inheritance problem.

**Fix:** the LCOM4 = 6 is the lever — it tells you there are six cohesive method groups. Split along those field-groups into six focused classes (e.g. `OrderValidator`, `OrderPricer`, `OrderPersistence`, ...), each pulling its slice of dependencies, which drops CBO per resulting class. Confirm by reading. See [god class](../../07-antipatterns-and-code-smells/01-god-class/).
</details>

---

## 2. LCOM looks great — but the design is bad

```java
public class ReportService {
    private final Context ctx;                 // a god-object holding everything
    public ReportService(Context c) { this.ctx = c; }

    public void daily()   { ctx.load(); ctx.compute(); ctx.email(); }
    public void weekly()  { ctx.load(); ctx.aggregate(); ctx.email(); }
    public void monthly() { ctx.load(); ctx.summarize(); ctx.email(); }
}
```

LCOM4 = 1 (every method touches `ctx`). **Is this cohesive?**

<details><summary>Diagnosis</summary>

**No — LCOM is fooled by a god-field.** Every method touches the single `ctx` field, so the cohesion graph is one connected component → LCOM4 = 1 → "cohesive". But the real cohesion lives in `Context`, which is the actual god object; `ReportService` is a thin shell whose methods share *nothing meaningful*. The metric measures *field access*, and one shared field defeats it.

**Fix:** inspect what `ctx` actually bundles; it's almost certainly several responsibilities (loading, computing, emailing) crammed into one parameter object to dodge the coupling count. Break `Context` apart and inject the real collaborators. The lesson: **LCOM4 = 1 is necessary but not sufficient for cohesion** — always read the field too.
</details>

---

## 3. High CBO that's actually fine

```
class,                cbo, wmc, rfc, lcom4
com.acme.AppWiring,   31,  4,   12,  1
```

CBO 31 — alarming? **Investigate.**

<details><summary>Diagnosis</summary>

CBO 31 is high, but WMC 4, RFC 12, LCOM4 1 are all *low*. This is a **composition root / wiring class** — it `new`s up 31 collaborators and hands them to each other. High coupling is its *job*; it's the one place coupling is supposed to concentrate so the rest of the code stays decoupled.

**Verdict: not a smell.** Flagging it wastes the team's attention. **Fix the dashboard, not the class:** tag composition roots / configuration as exempt so genuine CBO outliers stand out. A metric without exemptions cries wolf and loses the team's trust.
</details>

---

## 4. CC moved, complexity didn't

A reviewer demanded every method be CC ≤ 5. The author complied:

```java
public Decision evaluate(Request r) {          // was CC 9, now CC 1
    return s1(r);
}
private Decision s1(Request r){ return r.a() ? s2(r) : s3(r); }  // CC 2
private Decision s2(Request r){ return r.b() ? deny() : s4(r); } // CC 2
private Decision s3(Request r){ return r.c() ? s4(r) : allow(); }// CC 2
private Decision s4(Request r){ return r.d() ? deny() : allow();}// CC 2
```

The gate passes. **Better?**

<details><summary>Diagnosis</summary>

**No — Goodhart in action.** Per-method CC dropped, but total complexity is unchanged (still the same decision tree), and now it's *worse*: scattered across five methods, RFC went **up**, the logic is harder to follow in one place, and there are five names to invent for fragments that aren't real concepts. The metric was a target, so it got gamed.

**Fix:** revert the fragmentation. If the original `evaluate` was genuinely too complex, the right move is a *table/strategy* that removes branches, not a re-labeling that hides them. And drop the per-method CC *gate* — make it advisory. Gating syntactic metrics produces this every time.
</details>

---

## 5. Deep hierarchy hiding a refused bequest

```
class,            dit, noc, wmc, rfc
com.acme.PdfNode, 6,   0,   18,  40
```

DIT 6. **What might the metric be hinting at?**

<details><summary>Diagnosis</summary>

DIT 6 alone isn't conclusive, but it's a flag to inspect the hierarchy. Reading the chain reveals `PdfNode` extends `RenderNode` extends `Node` extends `Element`... and `PdfNode` **overrides three inherited methods to throw `UnsupportedOperationException`** — it inherited an interface it can't honour. That's a **refused bequest**: deep inheritance used where the child rejects part of the parent's contract (a Liskov violation).

**Fix:** the depth itself isn't the bug; the *misfit* is. Pull the rejected methods out of the base (segregate the interface), or replace inheritance with composition so `PdfNode` only takes what it needs. DIT was the breadcrumb; refused-bequest is the smell. See [refused bequest](../../07-antipatterns-and-code-smells/04-refused-bequest/) and the [fragile base class problem](../../03-design-principles/06-fragile-base-class-problem/).
</details>

---

## 6. Zone of pain package

```
package,            ca,  ce, A,    I,    D
com.acme.util,      72,  1,  0.0,  0.01, 0.99
```

**Read this package's position.**

<details><summary>Diagnosis</summary>

Ca 72 (everyone depends on it), Ce 1 → I ≈ 0.01 (maximally **stable**). A = 0.0 (entirely **concrete**). D = 0.99 — deep in the **zone of pain**. It's a concrete utility 72 classes depend on, so you can't change it without risking 72 breakages, and you can't extend it without modifying it (no abstractions to implement). Worst-placed package in the system, and the numbers said so before you opened a file.

**Fix:** extract interfaces for the heavily-used types so dependents bind to abstractions (raises A, moves it up toward the main sequence), and split the grab-bag `util` into cohesive packages so the dependency fan-in spreads out. See [`optimize.md`](optimize.md). Also: a package literally named `util` is a [cohesion](../../03-design-principles/04-cohesion-and-coupling/) red flag.
</details>

---

## 7. A data class the metrics call "simple"

```
class,            wmc, cbo, rfc, lcom4
com.acme.Account, 2,   0,   2,   1
```

The numbers are pristine. **Anything wrong?**

<details><summary>Diagnosis</summary>

Maybe. WMC 2, CBO 0, RFC 2 — almost no behaviour. If `Account` is a record / DTO that's *meant* to be data, this is fine. But if it has 15 fields with only getters/setters and *all the account logic lives in an `AccountService`*, this is an **anemic domain model**: data and the behaviour that belongs with it have been split apart, and the low metrics are *hiding* a design problem (the behaviour is somewhere else, inflating that class's metrics instead).

**Fix:** if it's a domain entity, move behaviour back onto it (Tell-Don't-Ask). The lesson: **low metrics aren't automatically good** — near-zero WMC on a class that *should* have behaviour is its own smell. See [anemic domain model](../../07-antipatterns-and-code-smells/02-anemic-domain-model/).
</details>

---

## 8. Feature envy invisible to CBO

```java
public class InvoicePrinter {
    public String format(Invoice inv) {
        var c = inv.customer();
        return c.title() + " " + c.firstName() + " " + c.lastName()
             + "\n" + c.street() + ", " + c.city() + " " + c.zip()
             + "\n" + c.country().name();
    }
}
```

CBO is only 2 (`Invoice`, `Customer`). **Does the low number mean low coupling?**

<details><summary>Diagnosis</summary>

**No — CBO counts coupled *classes*, not coupling *strength*.** `format` calls **eight** methods on `Customer` and zero on its own class. CBO sees one coupled class (`Customer`); the reality is intense **feature envy** — this method wants to live on `Customer`. The connascence is high (name connascence to eight `Customer` methods) but CBO can't see it.

**Fix:** move the formatting (or an `addressBlock()` accessor) onto `Customer`, or give `Customer` a `formattedName()`. Then `InvoicePrinter` asks once instead of reaching eight times. The lesson: a low CBO can still hide strong, concentrated coupling — read *which* methods are called, not just *how many classes*. See [feature envy](../../07-antipatterns-and-code-smells/03-feature-envy/).
</details>

---

## 9. The shotgun-surgery hub

```
class,                 cbo, fanin, fanout, wmc
com.acme.Constants,    0,   140,   0,      1
com.acme.OrderStatus,  3,   88,    2,      6
```

`Constants` has fan-in 140. **Smell or not?**

<details><summary>Diagnosis</summary>

`Constants` (fan-in 140, fan-out 0) is *stable* and only dangerous if it **changes often** — a constants holder that rarely changes is fine despite huge fan-in. The one to watch is **`OrderStatus`** if it changes frequently: high fan-in on a *churny* class means every change forces edits across 88 dependents — the engine of **shotgun surgery**. Fan-in alone is inconclusive; **fan-in × churn** is the real signal.

**Fix:** for the churny high-fan-in class, stabilize its interface (encapsulate the status transitions behind methods so adding a status doesn't ripple), or invert the dependency. Don't touch the stable `Constants`. See [shotgun surgery](../../07-antipatterns-and-code-smells/06-shotgun-surgery/).
</details>

---

## 10. Averages hiding the tail

A manager reports: "Average CBO across the codebase is 4.1 — well within range. We're healthy." **Believe it?**

<details><summary>Diagnosis</summary>

**No.** Metric distributions are heavily right-skewed: most classes are small/low-coupling, a long tail is extreme. A mean of 4.1 is fully compatible with twenty `OrderManager`-class monsters at CBO 25+ dragging nothing visible in the average. The mean is the wrong statistic.

**Fix:** report the **95th percentile and the worst-20**, not the mean. The defects and the refactoring ROI live entirely in the tail; the average is decoration. Any dashboard leading with means is misleading the team.
</details>

---

## 11. The size confound

```
class,            wmc, cbo, rfc
com.acme.BigForm, 60,  18,  120
```

Three metrics all high — three separate problems? **Reason about it.**

<details><summary>Diagnosis</summary>

Probably **one** problem measured three ways. WMC, CBO, and RFC are strongly correlated with class *size* (El Emam 2001) — a big class scores high on all three almost mechanically. Treating this as "high on three independent metrics → triple evidence" is double-counting. The discriminating question is **size-adjusted**: is it *more* coupled/branchy than a class of its size usually is?

**Fix:** normalize — e.g. CBO-per-method or RFC-per-method. If those are *also* high, it's genuinely worse than its size predicts (real smell). If they're average-for-its-size, the only problem is that it's big — split it, and the per-metric numbers fall out naturally. Don't tell three stories where the data tells one.
</details>

---

**The through-line:** metrics are *prompts to read code*, never verdicts. A high number can be fine (composition root, stable constants, big-but-cohesive), a low number can hide a smell (god-field LCOM, anemic data class, feature envy under low CBO), and several high numbers are often one fact (size). Read the report, then read the file — and when they disagree, the file wins.
