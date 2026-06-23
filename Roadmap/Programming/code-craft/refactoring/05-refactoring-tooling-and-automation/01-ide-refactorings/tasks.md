# IDE & Automated Refactorings — Tasks

> **Source:** Martin Fowler, *Refactoring* (2nd ed.); JetBrains IntelliJ IDEA & ReSharper refactoring docs

Each task gives a *before* and a *target shape*. Name the exact automated refactoring(s), in order, that get you there — then check the worked solution. The skill being drilled is *recognizing which mechanical refactoring matches the gap*, and sequencing them. Assume you have tests; run them after each step.

---

## Task 1 — Tame a magic condition

```java
if (date.before(SUMMER_START) || date.after(SUMMER_END)) {
    charge = quantity * winterRate + winterServiceCharge;
} else {
    charge = quantity * summerRate;
}
```

**Target:** the condition reads as a named concept, and both branches are named.

<details><summary>Solution</summary>

1. **Extract Variable** on `date.before(SUMMER_START) || date.after(SUMMER_END)` → `boolean isNotSummer`.
2. **Extract Method** on each branch body → `winterCharge(quantity)` / `summerCharge(quantity)`.

```java
boolean notSummer = date.before(SUMMER_START) || date.after(SUMMER_END);
charge = notSummer ? winterCharge(quantity) : summerCharge(quantity);
```
Keystrokes: `⌘⌥V`, then `⌘⌥M` twice. Each step compiles and keeps tests green.
</details>

---

## Task 2 — Move behavior to the data it envies

```java
class Customer {
    private Discount discount;
    double finalPrice(double base) {
        return base - base * discount.rate() - discount.flatOff();
    }
}
```
`finalPrice` reads only `Discount` state — classic Feature Envy ([`../../01-code-smells/05-couplers/middle.md`](../../01-code-smells/05-couplers/middle.md)).

**Target:** the pricing math lives on `Discount`.

<details><summary>Solution</summary>

1. **Move Method** `finalPrice` to `Discount`, passing `base` as a parameter (IntelliJ `F6`). The engine rewrites the call site to `customer.discount.finalPrice(base)` / delegates.
2. Optionally **Rename** to `apply(double base)`.

```java
class Discount {
    double apply(double base) { return base - base * rate() - flatOff(); }
}
```
</details>

---

## Task 3 — Thread a hard-coded value out to the caller

```java
class Report {
    String header() { return format("ACME Corp", LocalDate.now()); }
}
```

**Target:** the company name is supplied by the caller, not baked in.

<details><summary>Solution</summary>

**Introduce Parameter** on the literal `"ACME Corp"` → `String company`. The engine adds the parameter and updates every caller to pass `"ACME Corp"` (which you then change at the real call sites). Use Change Signature (`⌘F6`) if you also want to reorder.

```java
String header(String company) { return format(company, LocalDate.now()); }
```
**When NOT to:** if `header()` is invoked reflectively/by a framework, those callers won't be updated — verify.
</details>

---

## Task 4 — Deduplicate identical members across siblings

```java
class Cat extends Animal { String name; String describe() { return "cat " + name; } }
class Dog extends Animal { String name; String describe() { return "dog " + name; } }
```

**Target:** `name` lives once on `Animal`; `describe()` stays subclass-specific.

<details><summary>Solution</summary>

**Pull Up Field** `name` into `Animal` (do it from one subclass; the engine removes both). Leave `describe()` alone — it genuinely differs. See [`../../02-refactoring-techniques/06-dealing-with-generalization/tasks.md`](../../02-refactoring-techniques/06-dealing-with-generalization/tasks.md).

```java
class Animal { String name; }
class Cat extends Animal { String describe() { return "cat " + name; } }
class Dog extends Animal { String describe() { return "dog " + name; } }
```
**When NOT to:** if `describe()` were identical too, you'd **Pull Up Method** as well. It isn't — don't force it.
</details>

---

## Task 5 — Decouple callers from a concrete type

```java
class OrderService {
    private final StripeGateway gateway;     // concrete; tests can't substitute
    void pay(Order o) { gateway.charge(o.total()); }
}
```

**Target:** `OrderService` depends on a role, so a fake can be injected in tests.

<details><summary>Solution</summary>

1. **Extract Interface** on `StripeGateway` exposing `charge(...)` → `PaymentGateway`.
2. Let the IDE **change usages** to the interface where only `charge` is used → the field type becomes `PaymentGateway`.

```java
interface PaymentGateway { void charge(Money amount); }
class StripeGateway implements PaymentGateway { ... }
class OrderService {
    private final PaymentGateway gateway;
    void pay(Order o) { gateway.charge(o.total()); }
}
```
See [`../../02-refactoring-techniques/06-dealing-with-generalization/tasks.md`](../../02-refactoring-techniques/06-dealing-with-generalization/tasks.md).
**When NOT to:** don't extract if nothing — not even a test double — needs the second implementation; that's speculative generality.
</details>

---

## Task 6 — Collapse a pointless helper, then re-shape

```java
int rating(Driver d) { return wasGood(d) ? 2 : 1; }
boolean wasGood(Driver d) { return d.numberOfLateDeliveries() < 5; }
```
`wasGood` adds nothing and the name is vaguer than the expression.

**Target:** the trivial helper is gone; the condition is inline and clear.

<details><summary>Solution</summary>

**Inline Method** `wasGood` (`⌘⌥N`). The engine replaces the call with the body and deletes the method (since it's now unused).

```java
int rating(Driver d) { return d.numberOfLateDeliveries() < 5 ? 2 : 1; }
```
This is the inverse of Extract — see [`../../02-refactoring-techniques/01-composing-methods/tasks.md`](../../02-refactoring-techniques/01-composing-methods/tasks.md).
**When NOT to:** if `wasGood` were called from many places or overridden in a subclass, inlining duplicates/changes behavior — the IDE warns.
</details>

---

## Task 7 — Encapsulate a leaky field set

```java
public class TimeRange {
    public LocalTime start;
    public LocalTime end;
}
// callers do:  range.start = t;   if (range.end.isBefore(x)) ...
```

**Target:** fields are private, all access goes through accessors, so you can later add validation in one place.

<details><summary>Solution</summary>

**Encapsulate Field** on `start` and `end` (`⌥⌘` or via Refactor This). The engine makes them private, generates getters/setters, and rewrites every `range.start = t` → `range.setStart(t)` and every read → `range.getEnd()`.

```java
public class TimeRange {
    private LocalTime start, end;
    public LocalTime getStart() { return start; }
    public void setStart(LocalTime v) { start = v; }
    public LocalTime getEnd() { return end; }
    public void setEnd(LocalTime v) { end = v; }
}
```
**When NOT to:** if `start`/`end` are serialized by field name, the accessor route may change the serialized form — check first (see [find-bug.md](find-bug.md)).
</details>

---

## Task 8 — Bundle a recurring parameter clump

```java
double quote(double amount, String currency, double taxRate, String taxRegion) { ... }
// called the same way in 12 places, always currency+region together
```

**Target:** the related parameters travel as one object; signature is cleaner.

<details><summary>Solution</summary>

**Introduce Parameter Object** on `currency`/`taxRegion` (and possibly `taxRate`) → a `TaxContext` (or similar) record. The engine creates the type and rewrites all 12 call sites.

```java
record Money(double amount, String currency) {}
double quote(Money money, TaxContext tax) { ... }
```
See [`../../02-refactoring-techniques/05-simplifying-method-calls/tasks.md`](../../02-refactoring-techniques/05-simplifying-method-calls/tasks.md).
**When NOT to:** if the params don't actually clump together meaningfully, a parameter object just adds a hollow wrapper — group only genuinely-cohesive params.
</details>

---

## Task 9 — Split a god method via a chain

```java
void checkout(Cart cart) {
    // 1) validate stock (15 lines)
    // 2) compute totals (20 lines)
    // 3) charge payment (10 lines)
    // 4) send confirmation (8 lines)
}
```

**Target:** four named steps; the bodies are independently testable.

<details><summary>Solution</summary>

Four **Extract Method** operations, one per block (`⌘⌥M` each), each producing a named method and threading the needed locals as params/returns. Run tests after *each* extraction.

```java
void checkout(Cart cart) {
    validateStock(cart);
    Totals totals = computeTotals(cart);
    chargePayment(cart, totals);
    sendConfirmation(cart, totals);
}
```
If a block writes two locals both used later, the IDE refuses — that's a sign the seam is wrong; adjust the boundary or introduce a small result object first. See [`../../02-refactoring-techniques/01-composing-methods/tasks.md`](../../02-refactoring-techniques/01-composing-methods/tasks.md).
</details>

---

## Task 10 — The one the IDE *can't* finish

```java
@Entity
class Account {
    private String acctNo;   // <- you want to rename to accountNumber
}
// elsewhere:
//   @Query("select a from Account a where a.acctNo = :n")  -- JPQL string
//   "acctNo" appears in a Jackson @JsonProperty-less DTO mapping
//   a Thymeleaf template: th:text="${account.acctNo}"
```

**Target:** the Java field is `accountNumber` everywhere it can be — and you correctly identify what the IDE leaves stale.

<details><summary>Solution</summary>

1. **Rename** `acctNo` → `accountNumber` (`⇧F6`). The engine fixes Java code references and the getter/setter.
2. The engine **cannot** fix: the **JPQL string** `a.acctNo`, the **Thymeleaf** `account.acctNo` (template), and any **JSON wire name** if it was field-derived. Those are string/cross-language references.
3. For each: either grep the old string and fix manually under a test, or decouple — add `@Column(name="acct_no")` and `@JsonProperty("acctNo")` so the *external* names stay stable while the symbol renames freely. Fix the JPQL by hand and add an integration test that runs the query; fix the template and add a rendering test.

**Lesson:** this is the boundary case from [professional.md](professional.md) — the IDE refactoring is *step one*, and the remaining work needs a codemod or manual care plus tests ([`../02-codemods-and-ast-transforms/tasks.md`](../02-codemods-and-ast-transforms/tasks.md), [`../03-automated-safety-nets/tasks.md`](../03-automated-safety-nets/tasks.md)).
</details>
