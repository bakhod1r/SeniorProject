# equals / hashCode / toString — Interview Q&A

20 questions covering definitions, the five clauses, snippet critiques, modern Java features (records, sealed types, pattern `instanceof`), and the traps senior interviewers love — mutable equality, classloader equality, JPA proxies, `BigDecimal` scale, `Comparable` consistency.

---

## Q1. What are the five clauses of the `equals` contract?

From the Javadoc of `java.lang.Object.equals`:

1. **Reflexive** — `x.equals(x)` is `true` for any non-null `x`.
2. **Symmetric** — `x.equals(y)` is `true` iff `y.equals(x)` is `true`.
3. **Transitive** — if `x.equals(y)` and `y.equals(z)`, then `x.equals(z)`.
4. **Consistent** — repeated calls return the same result, provided no field used in the comparison changes.
5. **Non-null** — `x.equals(null)` is `false`, never throws.

Plus the agreement rule with `hashCode`: **equal objects must have equal hash codes** (the converse is not required — collisions are allowed). These five clauses plus the hashCode rule form the entire contract.

**Trap:** Candidates forget "non-null" because `null instanceof Anything` is `false` automatically — they think they don't need to handle it. They are correct *if* they use `instanceof`; they fail if they cast manually.

---

## Q2. Why must you override `hashCode` whenever you override `equals`?

Because the rule "equal objects must have equal hash codes" links them. If `equals` returns `true` for two structurally identical objects but `hashCode` (inherited from `Object`) returns identity-based integers that differ, the contract is broken. The consequence is silent: `HashSet` allows duplicates of value-equal objects (they hash to different buckets), `HashMap.get` returns `null` for keys that `equals` says match. SonarQube `S1206` and SpotBugs `EQ_DOESNT_OVERRIDE_HASHCODE` catch this exact bug.

**Follow-up:** "What about overriding `hashCode` without `equals`?" Legal — the inherited `Object.equals` is identity-based, and identity-equal objects necessarily have equal hash codes (the same value, computed once and cached in the header). But it's a code smell; usually means someone planned to override `equals` and forgot.

---

## Q3. Critique this snippet from a contracts standpoint.

```java
public class Customer {
    private String email;
    public boolean equals(Customer other) {
        return this.email.equals(other.email);
    }
    public int hashCode() { return email.hashCode(); }
}
```

Four bugs:

1. **`equals(Customer)` is an overload, not an override.** `Object.equals` takes `Object`. Code that holds `Customer` as `Object` (every collection lookup) calls the inherited `Object.equals`, which is identity-equal. Add `@Override` — the compiler refuses the typed parameter form.
2. **Mutable field in `equals`.** `email` has no `final` modifier; if a setter exists or the field is later mutated, the consistency clause breaks for any `Customer` in a hash-based collection.
3. **NPE risk.** `this.email.equals(other.email)` throws if `this.email` is null. Use `Objects.equals(email, other.email)`.
4. **No null/type guard.** No `instanceof` check. Passing a `String` to the (non-overridden) `equals(Customer)` is a compile error, but if someone fixes that and casts manually, the cast will throw.

The fixed version:

```java
public final class Customer {
    private final String email;
    public Customer(String email) { this.email = Objects.requireNonNull(email); }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof Customer c)) return false;
        return email.equals(c.email);
    }
    @Override public int hashCode() { return email.hashCode(); }
}
```

---

## Q4. What does mutability do to a hash-based collection?

If a field used by `hashCode` mutates after the object is put in a `HashSet` or `HashMap`, the object's bucket-of-record (computed at put time) no longer matches the bucket the set looks in (computed at lookup time). The object becomes *invisible to the collection that contains it*. `contains` returns `false`, `remove` no-ops, `add` succeeds and creates a second logical copy. No exception fires; the bug is silent and looks like a "lost record" data corruption.

The cure is structural: don't put mutable fields in `equals`/`hashCode`, or make the class genuinely immutable (`final` fields, no setters — records do this by construction).

**Follow-up:** "Is there a corner case where mutable `equals` is OK?" Only when the object is *never* used in a hash-based collection. That is a contract you cannot enforce; the safe rule is never.

---

## Q5. What does a record give you for free?

The compiler generates:

- A canonical constructor matching the components.
- A public accessor per component (`x()`, not `getX()`).
- `equals(Object)` — `instanceof`-based, comparing every component.
- `hashCode()` — combining every component, equivalent to `Objects.hash(...)`.
- `toString()` — `Name[comp1=value1, comp2=value2]`.
- The class is implicitly `final`; components are implicitly `final`.

JEP 395 (Java 16) made records final. They are the modern default for value classes. You cannot extend a record. You cannot add instance fields beyond the components. The auto-generated `equals` and `hashCode` satisfy all five clauses by construction.

```java
public record Point(int x, int y) {}
```

That single line is equivalent to roughly 25 lines of hand-written code.

**Follow-up:** "When would you not use a record?" JPA entities (cannot extend `AbstractEntity`; need no-arg constructors; mutable lifecycle), classes with non-component fields, classes that need to extend a framework superclass, classes with truly mutable equality (which you should reconsider).

---

## Q6. Explain the `instanceof` vs `getClass()` debate in `equals`.

Two type-guard styles:

```java
// instanceof style — substitutable
if (!(o instanceof Point p)) return false;

// getClass() style — strict-class
if (o == null || o.getClass() != getClass()) return false;
```

`instanceof` permits subclasses to compare equal to their parent (if they don't add equality-relevant state). LSP-friendly. Recommended by Joshua Bloch when subclasses do *not* add fields to `equals`. `getClass()` strictly requires the same runtime class. Symmetric in the face of inheritance with new state, but kills LSP — a `Point` and a `ColoredPoint` are never equal, even when intent says they should be.

The structural fact: **you cannot satisfy all five clauses with `instanceof` if a subclass adds equality-relevant state.** Either the class is `final` (or a record — no inheritance), or you use `getClass()` (kills LSP), or you accept the symmetry/transitivity break.

**Trap:** Saying "always `instanceof`" or "always `getClass()`" without naming the trade-off. Strong candidates name the structural fact and pick deliberately.

---

## Q7. What's wrong with `equals` on JPA entities by default?

Two issues:

**`getClass()` breaks across proxies.** Hibernate generates runtime subclasses (`Order$$EnhancerByHibernate_...`) for lazy loading. `entityManager.getReference(Order.class, 42L)` returns a proxy; `entityManager.find(Order.class, 42L)` returns a real entity. Their `Class` objects differ. `getClass()` comparison rejects them as unequal even when they wrap the same row.

**The `id` is null before persist.** If `equals`/`hashCode` use `id`, two unsaved entities both have `null` ids — they hash to `0` and compare equal under `Objects.equals(null, null)`. After persist, ids are assigned, hashes change, and entities stored in a `HashSet` migrate buckets — the set loses them.

The pragmatic recipe:

```java
@Override public boolean equals(Object o) {
    if (this == o) return true;
    if (!(o instanceof Order order)) return false;
    return id != null && id.equals(order.id);   // unsaved entities never equal anything but themselves
}
@Override public int hashCode() {
    return getClass().hashCode();   // stable hash across the lifecycle, low diversity
}
```

`instanceof` for proxy compatibility, `id != null &&` to avoid null-equals-null traps, constant hash for lifecycle stability.

**Follow-up:** "What's the cost of `getClass().hashCode()` as the hash?" Every entity of the same class hashes to the same bucket; large collections of one entity type degrade. The trade is correctness over speed, since `id` cannot be the basis of a stable hash for unsaved entities.

---

## Q8. What's the `BigDecimal` scale trap?

`BigDecimal.equals` is scale-sensitive:

```java
new BigDecimal("1.0").equals(new BigDecimal("1.00"));      // false — scales differ
new BigDecimal("1.0").compareTo(new BigDecimal("1.00"));   // 0     — same value
```

`HashMap` uses `equals`; `TreeMap` uses `compareTo`. The same `BigDecimal` key behaves differently in the two collections — the hash map misses, the tree map hits. The bug is silent.

Two cures:

1. **Normalise scale in the constructor** of your value class — `amount.setScale(currency.getDefaultFractionDigits(), RoundingMode.HALF_EVEN)`. Every stored `BigDecimal` has a canonical scale; `equals` works.
2. **Use `compareTo` for value comparisons** and avoid `BigDecimal` directly as a `HashMap` key.

The senior posture: don't expose `BigDecimal` as a public field of a domain type. Wrap it in `Money`, `Quantity`, etc., normalise at construction, expose typed operations.

---

## Q9. Should `compareTo` always agree with `equals`?

The `Comparable` Javadoc *strongly recommends* it: a class is *consistent with `equals`* iff `a.compareTo(b) == 0` iff `a.equals(b)`. Inconsistency is *allowed* (the Javadoc is recommendation, not requirement), but it breaks the contracts of sorted collections (`TreeMap`, `TreeSet`), which use `compareTo` even though their interfaces (`Map`, `Set`) are defined in terms of `equals`.

`BigDecimal` is famously inconsistent (Q8). For your own `Comparable` types, document any deliberate inconsistency in the Javadoc. The cleanest move: keep them consistent, and don't `extends Comparable` on classes where ordering is ambiguous.

```java
public record Version(int major, int minor, int patch) implements Comparable<Version> {
    @Override public int compareTo(Version o) {
        int c = Integer.compare(major, o.major);
        if (c != 0) return c;
        c = Integer.compare(minor, o.minor);
        if (c != 0) return c;
        return Integer.compare(patch, o.patch);
    }
}
```

The record's auto-generated `equals` agrees with this `compareTo` — same components, same ordering, consistent.

---

## Q10. What is "classloader equality"?

Two `Class` objects loaded by different classloaders are *different types*, even when their bytecode is identical. `c1.equals(c2)` is identity-based on `Class` — different classloaders mean different `Class` instances, so the comparison returns `false`.

Two instances of "the same" class loaded by different classloaders:

```java
Object m1 = loaderA.loadClass("com.acme.Money").getConstructor(...).newInstance(...);
Object m2 = loaderB.loadClass("com.acme.Money").getConstructor(...).newInstance(...);
m1.equals(m2);   // false — `m2 instanceof Money` is false on m1's side
```

Common in OSGi, Tomcat hot reload, JPMS layers, plugin systems. The symptom is a `ClassCastException` with identical class names in the message. The cure is architectural: share the value type through a parent classloader, or serialise across the boundary (round-trip lands in one classloader).

**Follow-up:** "Can I fix it in `equals`?" No. Even if both sides used reflection to compare components, the moment a third party calls `equals(Object)`, the JVM dispatches through *one* classloader's `Money` definition — the other side fails the `instanceof` check structurally.

---

## Q11. Critique this `hashCode`.

```java
@Override public int hashCode() { return 1; }
```

Contract-correct (the Javadoc says "unequal objects *may* have equal hashes"). Performance-catastrophic — every key hashes to bucket 1. `HashMap` becomes a glorified `LinkedList`; `put` and `get` are O(n) instead of O(1). In a million-entry map, lookups are ~20,000× slower than necessary.

The fix: `Objects.hash(field1, field2, ...)` or hand-written `31 * h + field` arithmetic. SonarQube doesn't have a rule for this exact case (constant hash is permissible by contract), but code review must catch it.

**Follow-up:** "Is `return getClass().hashCode()` the same?" Almost — `getClass().hashCode()` is constant per class but at least varies across types. For a single-entity-type collection, the distribution is the same as `return 1`. The choice is justified for JPA entities (Q7) where stability across the lifecycle trumps diversity.

---

## Q12. How does a record's `equals` compare `Double.NaN` fields?

`Float.NaN == Float.NaN` is `false`, but `Float.compare(Float.NaN, Float.NaN)` is `0`. The Javadoc for `Float.equals` mirrors `compare` — two `Float` boxes of `NaN` *are* equal under `equals`. Records use `Float.compare` / `Double.compare` for floating-point components, so:

```java
public record Position(double lat, double lng) {}

new Position(Double.NaN, 0).equals(new Position(Double.NaN, 0));   // true!
```

This satisfies the reflexive clause (a NaN-bearing instance equals itself) and matches `Float.equals` / `Double.equals` semantics. If you hand-wrote `equals` with `==` on `double` fields, reflexivity would break for NaN. Always use `Double.compare` for floating-point.

**Follow-up:** "What about `-0.0 == 0.0`?" `==` says `true`; `Double.compare(-0.0, 0.0)` says `-1`. Records use `compare` → they are *not* equal. Subtle but correct.

---

## Q13. Why is `toString` not really part of the contract?

`Object.toString` has no normative behaviour beyond "return a string representation". The Javadoc says "It is recommended that all subclasses override this method", and that "a concise but informative representation that is easy for a person to read" is the goal. No format is mandated; no consistency is required; throwing is allowed (though unwise — `toString` is called from stack traces).

Practical conventions (not contract):

1. Include the class name (unless the type is a domain primitive like `Money`).
2. Include the field values that aid debugging.
3. Redact sensitive fields (passwords, tokens, PII).
4. Don't throw.
5. Don't iterate large structures; log size instead.

Records auto-generate a sensible default (`Name[c1=v1, c2=v2]`). Override only to redact or to provide a domain-specific format.

---

## Q14. Can a lambda be used as a `HashMap` key?

You can put one in, but you cannot look it up by equality.

```java
Runnable a = () -> System.out.println("hi");
Runnable b = () -> System.out.println("hi");

map.put(a, "x");
map.get(b);   // null — Object.equals on lambdas is identity-based.
```

JLS §15.27.4 leaves lambda equality unspecified. In practice, every lambda expression evaluation may produce a distinct object; `invokedynamic` is free to cache or not. The JDK does *not* compare lambda bodies. The cure: give the behaviour an explicit name (an `enum` or a named class implementing the functional interface), and use *that* as the key.

```java
public enum DiscountRule implements Function<Money, Money> { ... }
Map<DiscountRule, Stats> stats = new EnumMap<>(DiscountRule.class);
```

Enums have identity-equal `equals` *and* singleton-per-name semantics, so they make perfect map keys.

---

## Q15. Walk through a `HashMap.put` after a `hashCode` change.

```java
HashMap<Customer, Order> orders = new HashMap<>();
Customer c = new Customer("alice@old.example");    // hashCode H_old
orders.put(c, someOrder);                          // stored in bucket H_old % cap
c.setEmail("alice@new.example");                   // hashCode now H_new
orders.get(c);                                     // looks in bucket H_new % cap — empty
```

Step by step:

1. `put` computes `c.hashCode()` = `H_old`, picks bucket `H_old % capacity`, stores entry there.
2. `c.setEmail(...)` mutates the field used in `hashCode`. The map has no notification mechanism.
3. `get(c)` computes `c.hashCode()` = `H_new`, picks bucket `H_new % capacity` (almost certainly different), looks for the entry — finds nothing.

The entry still exists in the map, hashed under the old bucket. It is now *unreachable* by lookup. `iterator()` will still find it; `containsKey` will not. Bug is silent.

The fix is structural: don't mutate fields used in `hashCode`, or — better — don't have mutable fields in `hashCode`. Records prevent this by construction.

---

## Q16. How do sealed types and records combine for equality?

A sealed interface over records gives you a closed hierarchy where every leaf is a `final` record with auto-generated equality:

```java
public sealed interface Payment permits Card, Bank, Crypto {}
public record Card(String last4, String network)        implements Payment {}
public record Bank(String iban)                          implements Payment {}
public record Crypto(String address, String currency)   implements Payment {}
```

Properties:

- Each leaf is `final`; no inheritance-based equality bugs.
- Auto-generated `equals` is per-record; two different `Payment` types are never equal.
- Pattern-match `switch` over `Payment` is *exhaustive* (compiler error if a case is missing).
- The closed set is documented in the `permits` clause — the full equality model is one source location.

This is the modern Java default for closed-set equality. It collapses the `instanceof`-vs-`getClass()` debate (sealed records have no inheritance to disagree with), the symmetry/transitivity break (each leaf compares to itself only), and the OCP question (adding a `Payment` variant is a deliberate edit to the `permits` clause).

**Follow-up:** "When would you not use this pattern?" When the closed-set assumption fails (third parties can add types), or when the hierarchy is deep (sealed types over sealed types get unwieldy beyond two levels).

---

## Q17. What does `EqualsVerifier` give you?

A one-line test that checks all five `equals` clauses plus `hashCode` agreement plus several edge cases:

```java
@Test void equalsContract() {
    EqualsVerifier.forClass(Money.class).verify();
}
```

It tests:

- Reflexivity, symmetry, transitivity, consistency, non-null.
- `hashCode` agreement with `equals`.
- Mutable fields in `equals` (warns with `NONFINAL_FIELDS`).
- `instanceof` vs `getClass()` distribution across subclasses.
- Cached `hashCode` correctness.
- JPA surrogate-key patterns (`SURROGATE_KEY` suppression).
- Transient fields (with `withIgnoredFields`).

It is the single highest-yield testing investment for a domain layer. Wire it into every value class's test class; expand the team's coding standards to require it.

**Follow-up:** "What suppressions do you commonly use?" `SURROGATE_KEY` for JPA entities (ID-only equality), `NONFINAL_FIELDS` for legacy classes with setters, `STRICT_INHERITANCE` for hierarchies where `getClass` is intentional, `NULL_FIELDS` when nullable fields are accepted by design.

---

## Q18. What changes in modern Java (16+) for these contracts?

Three features:

- **JEP 395 — Records.** Auto-generates `equals`/`hashCode`/`toString` from components. Final, immutable, no inheritance — contracts correct by construction.
- **JEP 394 — Pattern matching for `instanceof`.** `o instanceof Money m` binds the variable `m` only inside the `true` branch. Null-safe (`null instanceof T` is always false). Removes the boilerplate cast.
- **JEP 409 — Sealed classes.** Closed hierarchies; combined with records, dissolves the inheritance/equality debate. Pattern-match `switch` over sealed types is exhaustive at compile time.

Pre-Java 16, hand-written value classes were ~25 lines (constructor, accessors, `equals`, `hashCode`, `toString`). Post-Java 16, the same value is one record declaration. Pre-Java 16, `equals` bodies had a cast on a separate line from the `instanceof` check (and could lie — Bug 1 in [./find-bug.md](./find-bug.md)). Post-Java 16, the pattern variable makes that bug impossible.

**Follow-up:** "What's coming?" JEP 401 (preview) value classes — identity-free types where equality is *only* by content. Records were a stepping stone; value classes complete the picture.

---

## Q19. When can you intentionally violate the contracts?

Almost never. The contracts are *correctness*; violations produce silent collection corruption, lost lookups, double-charges. Three corner cases where breaking is defensible:

1. **`hashCode` caching that returns the same value as before.** Not a violation — the cache returns the contract-required answer faster. Always legal.
2. **Mutable equality where the object never enters a hash-based collection.** Hard to enforce; safer to write the object without overridden `equals` and rely on identity.
3. **A second equality method for performance.** Add `sameOrder(other)` for hot-path identity-shaped checks; keep `equals` honest. Don't override `equals` to mean something different from the contract.

Performance is *not* a valid reason to break the contracts. Cache the hash, hand-write the chain, use `IdentityHashMap` — never change what equality *means*.

**Trap:** "I needed it to be fast" is the most common rationalisation for broken `hashCode`. Profile first; optimisation comes from caching or restructuring, never from violating the meaning.

---

## Q20. The Point/ColoredPoint problem — the canonical interview question

> You have `class Point { x, y }` and `class ColoredPoint extends Point { x, y, color }`. Write `equals` so that:
> - Two `Point`s are equal iff their coordinates match.
> - Two `ColoredPoint`s are equal iff their coordinates *and* color match.
> - The five clauses hold.

The answer is **you can't**. This is the structural fact: open inheritance + new equality-relevant state in the subclass breaks at least one of symmetry or transitivity for *any* implementation. Bloch proves it in Item 10 of *Effective Java*.

The senior moves:

1. **Make `Point` `final`** (or a record). `ColoredPoint` is not a subclass — it is a separate type that *has* a `Point`. Composition over inheritance.
2. **Use `getClass()`** in `Point.equals`. `Point` and `ColoredPoint` are *never* equal; LSP is dead but symmetry holds.
3. **Re-model as a sealed interface over records:**

```java
public sealed interface Point2D permits Point, ColoredPoint {}
public record Point(int x, int y)                    implements Point2D {}
public record ColoredPoint(int x, int y, Color color) implements Point2D {}
```

Now `Point` and `ColoredPoint` are *sibling* types, neither extends the other; equality is per-record and the structural problem dissolves.

The candidate who says "you can't" and explains why is stronger than the candidate who hands you a code sample that "looks right" but breaks under inspection.

---

**Use this list:** rotate one question from each clause (Q1, Q4, Q15), one from inheritance (Q6, Q20), one from modern Java (Q5, Q16, Q18), one from real-world traps (Q7, Q8, Q10). Strong candidates apply the contracts as judgement, not ritual — they cite the Javadoc, recognise the structural facts, and know when records collapse the entire problem.
