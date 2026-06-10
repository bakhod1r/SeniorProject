# equals / hashCode / toString Contracts — Senior

> **What?** The hard cases: how `equals` interacts with inheritance (the Point/ColoredPoint dilemma), the canonical `getClass()`-vs-`instanceof` debate that Joshua Bloch settles in *Effective Java* Item 10, equality across JPA/Hibernate proxies, equality across classloaders (OSGi, Tomcat hot reload, sealed module graphs), mixin types and "compatible" equality, and what happens when `equals` and `Comparable` disagree about what "equal" means.
> **How?** By treating equality not as a function on bits but as an *invariant relation* on the type. Decide whether subclassing is allowed *before* you write the relation. If subclasses can add equality-relevant state, the relation cannot be symmetric — that is a structural fact, not a coding error. The honest senior moves: prefer `final` value classes (or records), prefer composition over inheritance for "adds state" relationships, accept `getClass()` when you must allow open inheritance, and always test the contract with EqualsVerifier across the *whole* hierarchy.

---

## 1. Why inheritance breaks equality — the structural fact

There is a theorem buried in the `equals` contract: **you cannot extend an instantiable value class with a new equality-relevant field and preserve the symmetric, transitive contract.** This is not a Java limitation, it is a logical consequence of the five clauses. Every Java equality bug involving inheritance is a re-discovery of this theorem.

The canonical illustration is `Point` and `ColoredPoint`:

```java
public class Point {
    private final int x, y;
    public Point(int x, int y) { this.x = x; this.y = y; }

    @Override public boolean equals(Object o) {
        if (!(o instanceof Point p)) return false;
        return x == p.x && y == p.y;
    }
    @Override public int hashCode() { return Objects.hash(x, y); }
}

public class ColoredPoint extends Point {
    private final Color color;
    public ColoredPoint(int x, int y, Color color) { super(x, y); this.color = color; }

    @Override public boolean equals(Object o) {
        if (!(o instanceof ColoredPoint cp)) return false;
        return super.equals(o) && color.equals(cp.color);
    }
    @Override public int hashCode() { return Objects.hash(super.hashCode(), color); }
}
```

Now consider three points:

```java
Point        p   = new Point(1, 2);
ColoredPoint cp1 = new ColoredPoint(1, 2, RED);
ColoredPoint cp2 = new ColoredPoint(1, 2, BLUE);
```

- `p.equals(cp1)` is `true` — `cp1 instanceof Point` matches, and the coordinates agree. The parent's `equals` doesn't know about color.
- `cp1.equals(p)` is `false` — `p` is not an instance of `ColoredPoint`.
- Symmetry is broken.

Suppose we "fix" it by making `Point.equals` also reject if `getClass()` differs. Then `p.equals(cp1)` is `false`, symmetric, *but* a different problem appears the first time a third party writes their own `Point` subclass with no extra state — say `LabeledPoint extends Point` where the label is a UI decoration that does not participate in equality. Now their points and ours never compare equal, even when the user intends them to. Substitutability (LSP) is dead.

Try the opposite fix — *liberalise* the parent's `equals` to compare only coordinates, even against `ColoredPoint`. Now:

```java
ColoredPoint cp1 = new ColoredPoint(1, 2, RED);
Point        p   = new Point(1, 2);
ColoredPoint cp2 = new ColoredPoint(1, 2, BLUE);

cp1.equals(p);  // false — different class
p.equals(cp2);  // true  — Point ignores color
// transitivity: cp1 == p, p == cp2, so cp1 == cp2 should hold — but it doesn't.
```

Transitivity is dead. No matter which way you wiggle the implementation, *one of the five clauses* breaks the moment a subclass adds equality-relevant state. This is the structural fact.

The senior conclusion is the same as Bloch's: **avoid the situation**. Either the class is `final` and inheritance is impossible, or subclasses do not add equality-relevant state, or you accept `getClass()` semantics and pay the LSP cost. Pretending the contract holds is the worst option, because the failures are subtle and corrupt hash-based collections silently.

---

## 2. `getClass()` vs `instanceof` — the canonical debate

The two writable styles for the type guard:

```java
// instanceof style (Bloch's choice for value classes that allow extension):
if (!(o instanceof Point p)) return false;

// getClass() style (the textbook way to keep symmetry under open inheritance):
if (o == null || o.getClass() != getClass()) return false;
```

**Arguments for `instanceof`.** It is *substitutable*. If `ColoredPoint extends Point` and `ColoredPoint` does not override `equals` to add state, a `ColoredPoint` equals a `Point` with the same coordinates — and code holding `Point` references doesn't care which concrete is on either side. This is Liskov-friendly. Bloch makes this the default in *Effective Java*, item 10, with the caveat that subclasses must not add equality-relevant state.

**Arguments for `getClass()`.** It is *symmetric in the presence of equality-relevant state in subclasses*. A `Point` and a `ColoredPoint` are categorically different classes, so they are categorically not equal — and any subclass that adds new state can compare its own class only. The cost: LSP is dead. Code that holds a `Point` reference cannot treat the two as interchangeable for equality purposes — the result depends on the runtime class.

**The honest middle ground.** Both styles are correct for *different design intents*.

- If your class is `final` (recommended, and what records give you), the two styles are equivalent. Use `instanceof` for the pattern variable.
- If your class allows open inheritance but you can *guarantee subclasses don't add equality-relevant state* (an enforced convention, ideally checked by ArchUnit or in code review), use `instanceof`. Document the constraint in the Javadoc.
- If your class allows open inheritance *and* subclasses may add equality-relevant state, use `getClass()`. You give up LSP for symmetry. Make peace with it.

```java
/**
 * Two-dimensional point. Equality is defined by coordinates only.
 * <p>
 * Subclasses MUST NOT add equality-relevant state. Subclasses that need
 * additional fields should not override {@code equals} or {@code hashCode}.
 */
public class Point {
    /* ... uses instanceof ... */
}
```

The IDE-generated `equals` defaults to `getClass()` in IntelliJ and Eclipse, which is the *safer* choice when the IDE has no knowledge of the type's design intent. Reviewers should ask: did the author *choose* `getClass()`, or did the IDE pick it for them?

---

## 3. Mixin types and "compatible" equality

Java sometimes allows two structurally different types to compare equal through a *compatible equality* design. The JDK's `java.util.List` is the canonical example:

```java
List<Integer> a = List.of(1, 2, 3);
List<Integer> b = new ArrayList<>(a);
List<Integer> c = new LinkedList<>(a);

a.equals(b);   // true
a.equals(c);   // true
b.equals(c);   // true
```

`AbstractList` documents the equality contract: two `List` instances are equal iff they have the same size and corresponding elements are equal. Concrete `List` implementations are expected to inherit this. The `instanceof List` check in `AbstractList.equals` is doing *exactly the LSP-friendly thing* — it accepts any `List`, regardless of class.

The same pattern appears in `Set`, `Map`, `LocalDate`, `BigInteger`, and (deliberately) `Number` *does not* — `Long.equals(Integer)` is `false`, even when both wrap `42`. The `Number` hierarchy explicitly *refuses* compatible equality across subtypes, because the underlying numeric types differ.

Senior takeaway: **compatible equality is a designed-in property**, not an accident. When you choose `instanceof` for the type guard, you are *opting in* to compatible equality. When you choose `getClass()`, you are *opting out*. Either is correct; only one is right for your domain.

Records, by being `final`, never have compatible-equality questions. That is part of why they are the right default.

---

## 4. JPA / Hibernate proxies — the classloader chimera

JPA persistence providers create *proxy subclasses* of your entities at runtime to support lazy loading:

```java
@Entity
public class Order {
    @Id private Long id;
    /* equals, hashCode, toString */
}

// What Hibernate hands you when you call em.getReference(Order.class, 42L):
class Order$$EnhancerByHibernate extends Order { /* ... lazy-load hooks ... */ }
```

The proxy is a runtime-generated subclass of `Order`. Now consider two equality strategies in `Order`:

**Strategy A — `getClass()` guard.**

```java
public boolean equals(Object o) {
    if (this == o) return true;
    if (o == null || getClass() != o.getClass()) return false;
    Order that = (Order) o;
    return Objects.equals(id, that.id);
}
```

When you compare a loaded `Order` (real class) to a `getReference()` proxy (subclass), `getClass()` differs and they are *never equal* — even when they wrap the same row. This is a notorious Hibernate footgun.

**Strategy B — `instanceof` guard.**

```java
public boolean equals(Object o) {
    if (this == o) return true;
    if (!(o instanceof Order that)) return false;
    return Objects.equals(id, that.id);
}
```

The proxy *is* an `Order` by inheritance, so the check passes. The two compare equal. This is the strategy Hibernate documentation recommends.

But there is a *second* problem with JPA entities — the ID is null before the entity is persisted. If you put a new (id == null) entity into a `HashSet`, its `hashCode` is whatever `Objects.hash(null)` returns (= 0), and *every* unsaved entity hashes to bucket 0. After saving, the entity's ID becomes non-null, and `hashCode` changes — the bucket changes — the set can no longer find it.

The pragmatic JPA recipe:

```java
@Entity
public class Order {
    @Id @GeneratedValue private Long id;

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof Order that)) return false;
        return id != null && id.equals(that.id);
    }

    @Override
    public int hashCode() {
        // Stable hash before AND after persistence:
        // - id is null pre-persist -> hash on the class itself (cheap, stable, low diversity but fine)
        // - id is set post-persist -> the same hash continues to apply if you keep this constant
        return getClass().hashCode();   // or a constant; trades diversity for stability
    }
}
```

Returning a constant `hashCode` is a deliberate trade. Diversity vanishes (every order goes to the same bucket), but the entity's hash never changes regardless of when you set the ID, so a `HashSet` containing unsaved entities continues to work after they are saved. For collections with many entities at once, switch to `id`-based hash *and* never put entities into a hash-based collection until they are persisted.

The senior summary: **JPA entities require equality designed against the proxy and the lifecycle, not against the fields**. The default `equals` from your IDE is wrong for entities. The right one looks above; many teams encode it in a base `AbstractEntity` class to avoid hand-rolling.

---

## 5. Equality across classloaders

Two objects from different classloaders are *different types* even when their bytecode is identical. This happens in:

- **OSGi bundles** — each bundle has its own classloader.
- **Tomcat / application-server hot reload** — the reloaded webapp gets a fresh classloader; old references still point to the previous one.
- **JPMS layers** (JEP 261) — `ModuleLayer` can host parallel definitions of the same module.
- **`URLClassLoader`-based plugin systems**.

The exact symptom:

```java
Class<?> c1 = loaderA.loadClass("com.acme.Money");
Class<?> c2 = loaderB.loadClass("com.acme.Money");
c1 == c2;        // false — different Class objects
c1.equals(c2);   // false — Class.equals is identity
```

Two `Money` instances from `c1` and `c2`:

```java
Object m1 = c1.getConstructor(BigDecimal.class, Currency.class).newInstance(...);
Object m2 = c2.getConstructor(BigDecimal.class, Currency.class).newInstance(...);

m1.equals(m2);
```

Behaviour depends on how `Money.equals` is written:

- **`instanceof Money`** — when the call runs on `m1`, the bytecode for `Money` was loaded by `c1`. The reference `m2` was instantiated from `c2`'s `Money`. `m2 instanceof Money` (the `c1` version) is *false* — they are different types. `m1.equals(m2)` is `false`.
- **`getClass() == m2.getClass()`** — same answer; the two `Class` objects are different.

This is *by design*: the JVM forbids cross-classloader type confusion, and equality reflects that. The bug surfaces as:

```
java.lang.ClassCastException: com.acme.Money cannot be cast to com.acme.Money
```

Identical class names, same source, different `Class` objects, no cast across the boundary.

The senior cure: **don't try to compare instances across classloaders for value equality**. If you must, serialise on one side and deserialise on the other (a round-trip lands you back inside one classloader); or have both sides depend on a *shared parent classloader* that loads the value type once. In OSGi, this is what the system bundle does for `java.lang.*`; for your own value types, expose them through a shared API bundle.

When you hit a `ClassCastException` with two identical class names in the message, classloader equality is the diagnosis. The fix is architectural, never a tweak to `equals`.

---

## 6. `Comparable` and `equals` — when they should agree

`Comparable<T>.compareTo` defines a total order; `equals` defines equivalence. The two are *not* required to agree, but the `Comparable` Javadoc strongly recommends that `compareTo(b) == 0` iff `a.equals(b)`. A class where they disagree is called *inconsistent with equals*, and a few JDK classes are deliberately inconsistent:

```java
new BigDecimal("1.0").equals(new BigDecimal("1.00"));      // false — scales differ
new BigDecimal("1.0").compareTo(new BigDecimal("1.00"));   // 0     — same value
```

This produces a famous bug: `BigDecimal` keys in a `HashMap` and a `TreeMap` behave differently.

```java
Map<BigDecimal, String> hash = new HashMap<>();
Map<BigDecimal, String> tree = new TreeMap<>();

hash.put(new BigDecimal("1.0"), "x");
tree.put(new BigDecimal("1.0"), "x");

hash.get(new BigDecimal("1.00"));   // null — HashMap uses equals (different scales)
tree.get(new BigDecimal("1.00"));   // "x" — TreeMap uses compareTo (== 0)
```

Same code path, two different answers depending on the collection. If you write your own `Comparable` types, **keep them consistent with `equals`** unless you have a domain reason not to. Record components with `Comparable<T>` fields combine cleanly when both agree. When they disagree, document the inconsistency in the Javadoc and pick a single collection style for your code path.

---

## 7. `compareTo` and floating-point equality

The same trap appears on `Comparable<Double>`. `Double.NaN.compareTo(Double.NaN)` is `0`, *not* "not comparable". `Double.equals` mirrors this — two `Double` boxes of `NaN` are equal under `Double.equals`, even though `Double.NaN == Double.NaN` is `false`. The Javadoc resolves the inconsistency between `==` and `equals` deliberately, in favour of the contract.

```java
Double a = Double.NaN;
Double b = Double.NaN;
a == b;          // false (primitive comparison via unboxing)
a.equals(b);     // true
```

Senior takeaway: when wrapping floating-point fields in a value class, use `Double.compare` and `Double.equals` (not `==`), and document that `NaN` compares equal to itself. Records do this correctly out of the box.

---

## 8. Records, sealed types, and exhaustive equality

JEP 395 records gave us correct `equals`/`hashCode`/`toString` for free. JEP 409 sealed types let us model closed hierarchies where equality has clear, exhaustive semantics:

```java
public sealed interface Shape permits Circle, Square, Triangle { }
public record Circle(double radius)            implements Shape { }
public record Square(double side)              implements Shape { }
public record Triangle(double base, double h)  implements Shape { }
```

Two `Shape`s are equal iff they are the same record class *and* their components agree — which the compiler enforces because each subtype is a record. No `instanceof` vs `getClass()` debate; the sealed hierarchy and record finality collapse it.

The combined idiom resolves several of the senior problems at once:

- **Symmetry / transitivity** under inheritance — vacuous, because each leaf is `final` and there is no shared `equals` to inherit.
- **Compatible vs strict equality** — strict, by construction.
- **Pattern-match exhaustiveness** — the compiler refuses to forget a case in any `switch` over `Shape`.

```java
public static double area(Shape s) {
    return switch (s) {
        case Circle c     -> Math.PI * c.radius() * c.radius();
        case Square sq    -> sq.side() * sq.side();
        case Triangle t   -> 0.5 * t.base() * t.h();
    };
}
```

For value-shaped domain types, the sealed-interface-over-records pattern is the modern senior default. It replaces the entire `instanceof`-vs-`getClass()` literature with a one-line definition.

---

## 9. `equals` on collections that contain themselves

A `List<Object>` that contains itself recurses forever:

```java
List<Object> a = new ArrayList<>();
a.add(a);
a.equals(new ArrayList<>(a));   // StackOverflowError
```

The JDK does not protect against this — `AbstractList.equals` walks elements naively. It is rare in production but appears in tests and in graph-shaped domains. The cures:

- **Don't build cyclic value structures.** Mutable graphs are usually entity-shaped; compare by identifier, not by content.
- **Use an explicit visitor with a cycle-detection set** when you must compare cyclic graphs.
- **Make graph nodes entities** with stable IDs, not values.

The senior posture: cyclic equality is a *design smell*. If you find yourself writing `IdentityHashSet`-based cycle detection inside `equals`, your model is wrong.

---

## 10. `equals` on lambdas and method references

```java
Runnable a = () -> System.out.println("hi");
Runnable b = () -> System.out.println("hi");

a.equals(b);   // false — identity equality
```

Lambdas and method references have *unspecified* equality semantics (JLS §15.27.4). In practice, every lambda expression evaluation may produce a distinct object; the JDK's `invokedynamic` site is free to cache instances or not. **Never use a lambda as a key in a `HashMap` or expect `Function.equals` to compare implementations** — it cannot work.

If you need a key for a behavioural strategy, give it an explicit name:

```java
public enum DiscountRule implements Function<Money, Money> {
    LOYALTY_10 { public Money apply(Money m) { /* ... */ } },
    NONE       { public Money apply(Money m) { return m; } }
}

Map<DiscountRule, Stat> stats = new EnumMap<>(DiscountRule.class);   // enum equality is fine
```

This is one of the few places where the *abstraction* (a function) is the wrong shape for the contract you need (equality-based bookkeeping). Make it a type, give it a name, get equality for free.

---

## 11. Decorators / wrappers — when "equal underneath" is wrong

A common smell: an `OrderRepository` decorated by `LoggingOrderRepository` and `RetryingOrderRepository`. Should the three be equal when they share the same underlying store?

```java
public final class LoggingOrderRepository implements OrderRepository {
    private final OrderRepository delegate;
    /* equals + hashCode by delegate? or by identity? */
}
```

Two design choices:

- **Identity equality.** Default `Object.equals`. The wrapper is a behaviour, not a value; two wrapped instances are different things.
- **Delegate equality.** `equals` compares the delegate. Used when the wrapper is *transparent* — a `Set` of wrappers wants no duplicates even if some are wrapped and some aren't.

Either can be correct; the senior move is to *decide explicitly* and document it. For collection-shaped wrappers (`Collections.unmodifiableList(...)`), the JDK chose *delegate equality* — `Collections.unmodifiableList(list).equals(list)` is `true`. For service-shaped wrappers (an HTTP client wrapper), identity is usually right.

Most production decorator stacks should *not* be put into `HashSet`s at all. The set-of-decorators question is usually a sign that the decorator stack is escaping its lifecycle.

---

## 12. Mutable `equals` — when it might actually be defensible

The middle file's rule was "never put mutable fields in `equals`". The senior caveat: there is exactly one situation where mutable equality is defensible — when *no instance ever leaves the construction site*, i.e., the object is never used as a key in any hash-based collection, never shared between threads, never inserted into any `Set`. A short-lived builder may be one such case:

```java
public class QueryBuilder {
    private String table;
    private List<String> columns = new ArrayList<>();
    private List<Predicate> wheres = new ArrayList<>();

    public QueryBuilder table(String t)            { this.table = t; return this; }
    public QueryBuilder select(String c)           { columns.add(c); return this; }
    public QueryBuilder where(Predicate p)         { wheres.add(p); return this; }

    public Query build() { /* ... */ return new Query(...); }
    // No equals/hashCode override. Identity is the right semantics.
}
```

Notice the *absence* of `equals` — the builder simply doesn't override it, so identity-equal is its semantics. Mutable `equals` only "works" by not existing. The instant someone overrides `equals` for a builder, the contract breaks under any code path that uses it as a key.

The senior rule remains: if the class is mutable *and* has overridden `equals`, that combination is almost always a bug. The defensible exception above is "mutable, no `equals` override".

---

## 13. Quick rules

- [ ] Inheritance + new equality-relevant state = *no* symmetric, transitive `equals` is possible. Accept the structural fact.
- [ ] Default to `final` value classes (or records). The `instanceof` vs `getClass()` debate disappears.
- [ ] For open hierarchies that *guarantee* subclasses don't add equality-relevant state, use `instanceof` and *document the constraint in Javadoc*.
- [ ] For open hierarchies where subclasses may add state, use `getClass()` and give up LSP-substitutability for equality.
- [ ] JPA entities: compare by `id` *only after persistence*; return a stable `hashCode` (often `getClass().hashCode()`) so unsaved entities don't migrate buckets.
- [ ] Cross-classloader equality is *defined* to be false. Don't fight it; share the type via a parent classloader or serialise across the boundary.
- [ ] `compareTo` should agree with `equals`; deliberate inconsistencies (`BigDecimal`) bite in `HashMap` vs `TreeMap`.
- [ ] Records + sealed types + pattern matching collapse most of the senior literature for new code. Use them as the default.
- [ ] Never key a `HashMap` on a lambda or method reference; their `equals` is identity.
- [ ] Decorators: pick *identity* or *delegate* equality explicitly; document the choice.
- [ ] Mutable + overridden `equals` is almost always a bug. Mutable + no `equals` override is fine.

---

## 14. What's next

| Topic                                                       | File              |
| ----------------------------------------------------------- | ----------------- |
| Code-review vocabulary, ArchUnit/Sonar rules, mentoring     | `professional.md`  |
| JLS sections, JEP 395, `Objects` utility class              | `specification.md` |
| Ten buggy snippets and their runtime symptoms               | `find-bug.md`      |
| Allocation, hash caching, JIT instanceof chains             | `optimize.md`      |
| Hands-on refactors                                          | `tasks.md`         |
| Interview Q&A                                               | `interview.md`     |

Related sections:

- [../../03-design-principles/06-fragile-base-class-problem/](../../03-design-principles/06-fragile-base-class-problem/) — inheriting from a parent that overrode `equals` is the canonical FBCP scenario.
- [../../03-design-principles/02-composition-over-inheritance/](../../03-design-principles/02-composition-over-inheritance/) — the structural cure for the Point/ColoredPoint dilemma.
- [../05-immutability-and-defensive-copying/](../05-immutability-and-defensive-copying/) — the cure for mutable-equals bugs.

---

**Memorize this:** equality is a *structural relation*, not a function on fields. The Point/ColoredPoint theorem says inheritance + added equality state breaks symmetry — so either disallow the inheritance (`final`/record), disallow the added state (Javadoc constraint with `instanceof`), or accept that strict-class equality (`getClass()`) costs LSP. Records + sealed types collapse the entire debate for new code. JPA proxies, classloaders, `Comparable` consistency, and decorator equality are all variants of the same question — what is the *intent* of equality here, and which contract does that intent imply?
