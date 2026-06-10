# equals / hashCode / toString Contracts — Professional

> **What?** Driving the contract across a team and a codebase: the vocabulary you use in code review, the static-analysis and ArchUnit rules that catch broken equality before review, mentoring without dogma, the team policy on IDE / Lombok-generated boilerplate vs records, and how to run a refactor sprint that converts a legacy `equals`-heavy module to records and `Objects.hash` without breaking serialisation, JPA, or the public API.
> **How?** Treat the contracts as a shared *language* — equal/hash/toString — not a checklist. Wire enforcement into CI where you can (SonarQube S1206, S2160; SpotBugs `EQ_*`; EqualsVerifier). In review, point at the specific clause that breaks, propose the smallest change. Mentor each junior with the find-bug they have already lived through.

---

## 1. Code-review vocabulary: name the clause

When you review a PR that touches `equals`, `hashCode`, or `toString`, the most useful thing you can do is name *which clause* is in danger and *which line* of the diff exposes it. "This is wrong" is noise; "this breaks symmetry between `Order` and `OrderRef`" is a review.

```java
// PR diff under review:
public class Customer {
    private final long id;
    private String email;
    @Override public boolean equals(Object o) {
        if (!(o instanceof Customer c)) return false;
        return id == c.id && email.equals(c.email);
    }
    @Override public int hashCode() {
        return Objects.hash(id, email);
    }
}
```

> **Reviewer:** This breaks the **consistency** clause. `email` is mutable (no `final`, has setter), so two consecutive `hashCode()` calls return different values if `email` changes between them. Once this object is in a `HashSet`, mutating `email` makes the set lose track of it. Either drop `email` from `equals`/`hashCode` (this is an entity — compare by `id` only), or make the class genuinely immutable (all fields `final`, no setters).

Contrast with:

> **Reviewer:** This breaks **symmetry** in the inheritance hierarchy. `RefundableOrder extends Order` adds a `refundDeadline` field to its `equals` body, but `Order.equals` uses `instanceof Order` — so `order.equals(refundable)` can be `true` while `refundable.equals(order)` is `false`. Either mark `Order` `final` (and reject the inheritance), or move the type guard to `getClass()` and accept the LSP cost.

Both reviews are short, both name a *specific clause*, both end with a concrete next step. That is the shape of useful equality-review feedback. Letters from the SOLID world ("violates LSP") are also fine — but the equality contract has its *own* five names, and using them precisely is faster.

The five clauses to keep on the tip of your tongue:

| Clause       | Failure mode in production                                            |
|--------------|------------------------------------------------------------------------|
| Reflexive    | `x.equals(x)` returns false — usually a buggy short-circuit early-out  |
| Symmetric    | `a.equals(b)` and `b.equals(a)` disagree — inheritance with new state  |
| Transitive   | `a==b`, `b==c`, but `a!=c` — three-way comparison via different rules  |
| Consistent   | Same pair compares differently across calls — mutable field in equals  |
| Non-null     | `x.equals(null)` throws or returns true — manual cast without instanceof |

And the `hashCode` clause: **equal objects must have equal hash codes.** That is the entire contract.

---

## 2. Static analysis: what tooling can catch

The contracts are unusually amenable to mechanical detection. Most teams under-use the available rules. Wire these into CI so reviewers can spend their attention on the harder cases.

**SonarQube** (the bread-and-butter):

- `java:S1206` — *"`equals(Object)` and `hashCode()` should be overridden in pairs"*. The single highest-yield rule. Catches the "I overrode `equals` but not `hashCode`" newcomer bug at PR time.
- `java:S2160` — *"Subclasses that add fields should override `equals`"*. Catches the silent half of the inheritance break: a subclass with new fields that *forgot* to override `equals`, so two instances differing only by the new field compare equal.
- `java:S2098` — *"`equals(Object)` should not be overloaded"*. Catches `public boolean equals(Customer c)` — a different method that compiles fine and silently breaks every code path that has `Object` references.
- `java:S2204` — *"`.equals()` should not be used to test the values of `Atomic` classes"*. Niche but valuable; `AtomicInteger.equals` is identity-equal, surprising callers who expect content equality.
- `java:S1210` — *"`Comparable.compareTo()` should not return Integer.MIN_VALUE"*. Drifts toward equality consistency.
- `java:S1244` — floating-point `==` rules.

**SpotBugs** catches semantic equality bugs:

- `EQ_DOESNT_OVERRIDE_EQUALS` — class has an `equals` that doesn't override `Object.equals` (wrong signature).
- `EQ_GETCLASS_AND_CLASS_CONSTANT` — `if (o.getClass() == MyClass.class)` instead of `getClass() == o.getClass()`; subtle, breaks under inheritance.
- `HE_EQUALS_NO_HASHCODE` — the same as Sonar S1206; one or the other catches it.
- `EQ_COMPARETO_USE_OBJECT_EQUALS` — `compareTo` and `equals` inconsistent.
- `EQ_UNUSUAL` — `equals` that takes a typed parameter (the overload bug).

**PMD** has `OverrideBothEqualsAndHashcode`, `CompareObjectsWithEquals`, `EqualsNull` — overlapping the above; pick one tool for this family and keep them aligned, or you end up with duplicate findings.

**ArchUnit** is the rule of last resort for domain-specific constraints. You can encode rules the standard tools can't:

```java
@ArchTest
static final ArchRule entities_compare_by_id =
    classes().that().resideInAPackage("..domain.entity..")
             .and().areAnnotatedWith(Entity.class)
             .should(haveAnEqualsMethodThatUsesOnly("id"));
// requires a custom ArchCondition; ~30 lines of glue, well worth it for large teams.
```

```java
@ArchTest
static final ArchRule value_objects_are_final_or_records =
    classes().that().resideInAPackage("..domain.value..")
             .should().beRecords()
             .orShould().haveModifier(JavaModifier.FINAL);
// Encodes "value classes don't permit subclassing".
```

The strongest combination for a domain layer:

1. SonarQube S1206 + S2160 + S2098 in CI, blocking merge.
2. SpotBugs `EQ_*` rules in CI, blocking merge.
3. EqualsVerifier in unit tests on every value class.
4. ArchUnit rule for "value-object package members are final or records".

This catches roughly 95% of equality bugs before they reach review. Reviewers spend their time on the design questions — entity vs value, `instanceof` vs `getClass()`, JPA-proxy compatibility — which no tool can decide.

---

## 3. Team policy: IDE generation, Lombok, records

A team must pick one default and enforce it. The realistic options:

**Option A — Records first, hand-written for the rest.** Every new value class is a record. Where records don't fit (JPA entities, framework constraints), hand-write the recipe in section 2 of [./middle.md](./middle.md). No Lombok. This is the modern default — fewest moving parts, contracts correct by construction.

**Option B — Lombok-first.** `@EqualsAndHashCode` and `@ToString` on every value class. Trades a annotation-processor dependency for terse code. Has known sharp edges:

- `@EqualsAndHashCode` defaults to `callSuper = false`, which silently produces a broken `equals` if the class extends another class with state. Always set `callSuper` explicitly or use `@EqualsAndHashCode(callSuper = true)` for subclasses.
- `@ToString` includes all fields by default, including those tagged with `@JsonIgnore` or holding secrets. Use `@ToString.Exclude` or `@ToString(of = {"id", "email"})`.
- Lombok processes annotations *after* `javac` parses; debuggers, code analysers, and IDE refactors sometimes lag behind. A "rename field" that misses Lombok-generated code is a silent break.
- Records were introduced partly to obsolete Lombok value classes. New code rarely benefits from `@Value` over `record`.

If your codebase already uses Lombok extensively, ripping it out is rarely worth the cost. The team policy is then: *new* value types are records, *legacy* Lombok types stay until they are touched for unrelated reasons, at which point they are migrated.

**Option C — IDE-generated `equals`/`hashCode`/`toString` everywhere.** The pre-records standard. Verbose but explicit. Works in every codebase from Java 8 up. The risk: the IDE generates `getClass()`-style type checks (IntelliJ default), which the team may not realise carries an LSP cost. Add a coding standard line: *"if the IDE inserts `getClass() != o.getClass()`, the reviewer asks whether the author chose `getClass()` or accepted it"*.

The senior anti-pattern: *mix all three styles in the same codebase* without a written policy. Reviewers spend time on "should this be a record?" / "should this be Lombok?" instead of on the actual design question. Pick one default per codebase and document it in the contributing guide.

---

## 4. Mentoring: anchor each clause to a real bug

Each of the five clauses has a *war story* the team will recognise. Use the war story; the abstract clause name lands afterwards.

> **Mentor:** Remember the bulk-import job that lost 80% of its inserts last month? The repository was returning unsaved entities, every one of them with `id == null`, and our `hashCode` returned `id.hashCode()`. Every entity hashed to bucket `0` because `Objects.hash(null) == 0`. After save, the IDs were set, the hashes changed, and the dedup `HashSet` no longer recognised them. That is the **consistency clause** — `hashCode` cannot change for an object that lives in a hash-based collection. Use a stable hash (often `getClass().hashCode()` for JPA entities) or hash on a field that doesn't change.

> **Mentor:** Remember when our `BigDecimal`-keyed cache returned `null` for keys that "obviously" matched? `new BigDecimal("1.0").equals(new BigDecimal("1.00"))` is `false` because scales differ. That's the **`compareTo` vs `equals` inconsistency** — `BigDecimal` is documented as inconsistent on purpose, and `HashMap` uses `equals` while `TreeMap` uses `compareTo`. The fix in our codebase was a `Money` wrapper that normalises scale in the constructor.

> **Mentor:** Remember the customer-records bug where a renamed `Food` class started taxing food at the standard rate? The code did `switch (p.getClass().getSimpleName())` — equality on *strings derived from class names*, which is not equality at all. The IDE renamed the class, the string literal didn't move, and tax filings were wrong for six weeks. That's not the equality contract — it's the *anti*-contract — but it shows what happens when equality is encoded outside the type system.

Anchored mentoring beats abstract mentoring 10:1. The junior who watched their PR cause an incident has a permanent intuition about that clause. The junior who read the Javadoc has a vocabulary; the vocabulary becomes intuition only after pain.

---

## 5. Anti-patterns juniors will introduce

These appear in nearly every codebase. Recognise them early; intervene before they spread.

**The `equals(Customer c)` overload.**

```java
public class Customer {
    public boolean equals(Customer other) {        // does not override Object.equals!
        return this.id == other.id;
    }
}
```

`Object.equals` takes `Object`. A method with parameter `Customer` is an *overload* — Java picks it only when the static type is `Customer`. When the runtime calls `hashSet.contains(c)`, it invokes `Object.equals(Object)`, which is identity-equal. The bug is silent. Sonar S2098 catches it; require `@Override` annotation on every `equals` you write so the compiler refuses to compile the overload.

**The mutable entity with `equals`/`hashCode` on the email.**

```java
public class User {
    private String email;  // not final, has setter
    @Override public int hashCode() { return Objects.hash(email); }
}
```

Working fine until someone changes an email and the user vanishes from a session-tracking set. Always ask: "is this field stable for the lifetime of the object's membership in a hash-based collection?"

**The `toString` that leaks secrets.**

```java
@Override public String toString() {
    return "User[email=" + email + ", password=" + password + "]";
}
```

`toString` is called in every log line, every assertion failure, every debugger watch. Passwords end up in CI logs, error trackers, and Slack threads. Mandate a *redaction rule* — every field is presumed sensitive until proven otherwise. The audit team will thank you.

**The deep inheritance with `equals`.**

```java
class Animal { /* equals on name */ }
class Mammal extends Animal { /* equals on name + furColor */ }
class Cat extends Mammal { /* equals on name + furColor + whiskerLength */ }
```

Symmetry breaks between every pair of adjacent levels. Either flatten the hierarchy, mark each level `final` (impossible if you actually want inheritance), or remove `equals` from all but the bottom level. The cleanest cure is composition — a `Cat` *has* an `Animal` description rather than *being* one.

**The `equals` that handles null defensively.**

```java
public boolean equals(Object o) {
    if (o == null) return false;
    if (!(o instanceof Customer)) return false;
    /* ... */
}
```

`null instanceof Anything` is *already* `false`. The `if (o == null)` line is redundant. Not a bug, but it inflates `equals` bodies and obscures the type check. The cleanup is mechanical; flag it in review with one sentence.

**`@EqualsAndHashCode` without `callSuper`.**

```java
@Getter @Setter @EqualsAndHashCode  // missing callSuper
public class RefundableOrder extends Order { /* adds fields */ }
```

Lombok's default `callSuper = false` produces `equals` that *ignores* parent fields. If `Order` has equality-relevant state, every `RefundableOrder` with the same refund-deadline compares equal regardless of the underlying order. Always set `callSuper` explicitly. Tooling tip: configure Lombok with `lombok.equalsAndHashCode.callSuper = call` in `lombok.config` at the project root — this fails the build if `callSuper` is left at its default.

---

## 6. The refactor sprint — converting a legacy module to records

You inherit a module — say `billing` — where every value class is a hand-written, 60-line Java bean with getters, setters, an `equals` from 2008, and a `toString` showing 12 fields. The migration target is records. You do *not* rewrite the world; you carve the migration into one-class-per-PR.

The phased plan:

1. **Inventory.** `grep -rl "public boolean equals(Object" src/main/java/com/acme/billing` → list of candidates. Filter out JPA entities (cannot be records) and framework base classes.
2. **EqualsVerifier on every survivor.** Add a test that runs `EqualsVerifier.forClass(X.class).verify()`. Most pass; the failures are *existing* bugs the migration will surface. Fix them before changing shape.
3. **Per-class migration PRs.** Convert one class at a time. Each PR shows:
   - The before/after of the class.
   - The unit test (EqualsVerifier) still passing.
   - A `git grep` of references to setters that no longer exist (records have no setters).
4. **Boundary checks.** For each migrated class, audit:
   - **Serialisation.** Records are `Serializable` if you mark them so; the default `writeObject` mechanism works. Schema-wise, JSON/Jackson 2.12+ handle records correctly with `@JsonCreator` discovered by reflection.
   - **JPA.** Records *cannot* be JPA entities. They can be `@Embeddable` value types with extra ceremony, but the easier move is: keep entities as classes, convert their *value-object fields* to records.
   - **Builder code.** If the class had a builder, the record's canonical constructor often replaces it. For more than 4-5 fields, keep a small builder as a static nested record.
   - **Subclasses.** Records are `final`. If a class is subclassed in production, you cannot migrate it as-is. Convert the *intent* — usually a sealed interface over records is the right replacement.
   - **Mutable callers.** Find code that did `obj.setX(...)` — that now must rebuild via `new Obj(...)` or a `with`-style helper.

> **Senior to team:** This sprint converts the 14 value classes in `billing.domain.value`. Each goes through EqualsVerifier first, then becomes a record, then the call sites stop calling setters (we add a small `withAmount(...)` where needed). Entities stay as classes. We don't touch the API package. Exit criterion: the 14 classes are records, the test suite is green, no production setter call remains.

The strangler fig variant for `equals`/`hashCode` is to leave the *old* class in place, add a *new* record next to it, migrate one caller per PR to the record, and delete the old class when its call count reaches zero. Useful when the old class is exported across a module boundary that you cannot edit atomically.

---

## 7. The contract test base — EqualsVerifier as a team contract

EqualsVerifier (Jan Ouwens) deserves its own subsection because it is the single largest leverage in this domain.

```java
@Test
void equalsHashCodeContract() {
    EqualsVerifier.forClass(Money.class).verify();
}
```

One line. It checks:

- Reflexivity, symmetry, transitivity, consistency, non-nullity.
- `hashCode` agreement with `equals`.
- Mutable fields in `equals` (warns with `Warning.NONFINAL_FIELDS`).
- Subclass equality patterns (`getClass()` vs `instanceof`).
- `cachedHashCode` correctness.
- JPA's `@Id` handling (via `forClass(...).withOnlyTheseFields("id")`).

Make EqualsVerifier mandatory for every value class. The team standard:

```java
public abstract class EqualsContractTest<T> {
    protected abstract Class<T> classUnderTest();
    @Test void equalsContract() {
        EqualsVerifier.forClass(classUnderTest()).verify();
    }
}

class MoneyEqualsTest extends EqualsContractTest<Money> {
    @Override protected Class<Money> classUnderTest() { return Money.class; }
}
```

For records the test is *still* worth running — it catches mistakes in *custom* `equals` overrides (records allow you to override the generated method, which is a great way to break it).

For JPA entities, EqualsVerifier needs configuration:

```java
EqualsVerifier.forClass(Order.class)
    .withOnlyTheseFields("id")
    .suppress(Warning.SURROGATE_KEY)
    .verify();
```

The `SURROGATE_KEY` suppression is the JPA pattern: equality is by surrogate (database-assigned) ID, which is null until persistence. The test confirms the entity behaves correctly under that contract.

---

## 8. `toString` policy — readability, redaction, no exceptions

`toString` has no JDK-mandated contract, so it is the responsibility of the team to *write one*. A useful policy fits on a sticky note:

1. **Includes the simple class name** unless the type is a domain primitive (`Money`, `Email`) where the value reads cleanly without the name.
2. **Includes every field that helps the on-call engineer**.
3. **Excludes every field that is sensitive**. Mandatory redactions: passwords, password hashes, tokens, social security numbers, full credit-card numbers, full IBANs in some regions. Conditional redactions: email addresses, names, addresses (depending on regulatory regime). Mark these with `@ToString.Exclude` (Lombok) or omit by hand.
4. **Never throws**. Wrap risky fields with `Objects.toString(field, "<null>")` or a try/catch that returns a placeholder.
5. **Never iterates a large structure**. For collections, log size, not contents: `roles(n=" + roles.size() + ")` rather than `roles=" + roles`.
6. **Stable format**. Logs and metrics often parse `toString` output downstream; changing the format silently breaks them. Treat the format as semi-public.

A reusable redaction helper:

```java
public final class Mask {
    private Mask() {}
    public static String email(String e) {
        if (e == null) return "<null>";
        int at = e.indexOf('@');
        return at < 2 ? "***" : e.charAt(0) + "***" + e.substring(at);
    }
    public static String secret(String s) {
        return s == null ? "<null>" : "***";
    }
    public static String tail4(String s) {
        return s == null ? "<null>" : "***" + s.substring(Math.max(0, s.length() - 4));
    }
}
```

Then in domain types:

```java
@Override public String toString() {
    return "User[id=" + id
         + ", email=" + Mask.email(email)
         + ", cardLast4=" + Mask.tail4(cardNumber) + "]";
}
```

This is policy, not specification. Write it down once, enforce in review.

---

## 9. Quick rules

- [ ] In review, name **the clause** that fails (reflexive / symmetric / transitive / consistent / non-null), not just "equals is wrong".
- [ ] Wire SonarQube `S1206`, `S2160`, `S2098` plus SpotBugs `EQ_*` rules into CI; block merge on findings.
- [ ] Mandate `EqualsVerifier` on every value class in the test suite.
- [ ] Pick a team default: **records-first** (modern), Lombok-first (legacy), or IDE-generated (universal). Document the choice; don't mix without a written policy.
- [ ] Lombok `@EqualsAndHashCode`: set `callSuper` explicitly. Configure `lombok.config` to fail the build on the default.
- [ ] Every override carries `@Override`. The compiler catches the `equals(Customer)` overload bug.
- [ ] Mentor by anchoring each clause to a real incident the team lived through.
- [ ] `toString` policy: class name + fields, redact secrets, never throw, never iterate large structures.
- [ ] Refactor legacy modules to records one class per PR, behind EqualsVerifier tests. Don't rewrite the world.
- [ ] JPA entities: `equals` by `id` only, stable `hashCode` (`getClass().hashCode()`), EqualsVerifier with `withOnlyTheseFields("id")`.

---

## 10. What's next

| Topic                                                          | File              |
|----------------------------------------------------------------|-------------------|
| The contracts in plain English with one example                | `junior.md`        |
| Mechanical recipe, hash quality, records                       | `middle.md`        |
| Inheritance, proxies, classloaders, sealed types               | `senior.md`        |
| JLS sections, JEP 395, `Objects` utility class                 | `specification.md` |
| Ten buggy snippets and their runtime symptoms                  | `find-bug.md`      |
| Allocation cost of `Objects.hash`, hash caching, JIT           | `optimize.md`      |
| Hands-on refactors                                             | `tasks.md`         |
| Interview Q&A                                                  | `interview.md`     |

Related sections:

- [../../03-design-principles/06-fragile-base-class-problem/](../../03-design-principles/06-fragile-base-class-problem/) — the canonical FBCP scenario is inherited `equals`.
- [../05-immutability-and-defensive-copying/](../05-immutability-and-defensive-copying/) — structural cure for mutable-equals bugs.
- [../../03-design-principles/02-composition-over-inheritance/](../../03-design-principles/02-composition-over-inheritance/) — alternative to inheriting a parent's `equals`.

---

**Memorize this:** the equality contract is a shared vocabulary, not a checklist. Your job as a senior is to make code review *short* by naming the failing clause precisely, to push enforcement into Sonar / SpotBugs / EqualsVerifier where the contract is mechanically detectable, to mentor by anchoring each clause to a felt incident, to set a team default for records vs Lombok vs IDE generation, and to migrate legacy by one-class PRs behind EqualsVerifier tests. The clauses are prompts; the judgement is yours.
