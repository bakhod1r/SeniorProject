# Inappropriate Intimacy — Find the Bug

Ten realistic bugs caused by classes knowing too much about each other. For each: the symptom, the diagnostic technique, and a concrete fix. All snippets are Java with JPA / Jackson / Lombok where relevant.

## Scenario 1 — JPA bidirectional `toString()` causes `StackOverflowError`

```java
@Entity @Data
class Order {
    @Id Long id;
    @OneToMany(mappedBy = "order") List<OrderLine> lines;
}
@Entity @Data
class OrderLine {
    @Id Long id;
    @ManyToOne Order order;
}
```

**Symptom.** `log.info("{}", order)` blows the stack.

**Diagnosis.** Lombok `@Data` generates `toString()` that includes every field. `Order.toString()` prints `lines`, each `OrderLine.toString()` prints `order`, which prints `lines`...

**Fix.** Exclude back-references from `toString` and `equals`:

```java
@Entity @ToString(exclude = "lines") @EqualsAndHashCode(of = "id")
class Order { ... }

@Entity @ToString(exclude = "order") @EqualsAndHashCode(of = "id")
class OrderLine { ... }
```

Better: stop using `@Data` on entities — use `@Getter` plus explicit `equals`/`hashCode`/`toString`.

## Scenario 2 — Jackson serialization infinite loop on bidirectional relation

Same model as above, exposed through Spring MVC:

```java
@GetMapping("/orders/{id}")
public Order get(@PathVariable Long id) { return repo.findById(id).orElseThrow(); }
```

**Symptom.** Response never finishes; eventually `JsonMappingException: Infinite recursion (StackOverflowError)`.

**Diagnosis.** Jackson walks `Order.lines` -> each `OrderLine.order` -> `lines` -> ...

**Fix.**

```java
@Entity
class Order {
    @OneToMany(mappedBy = "order")
    @JsonManagedReference
    List<OrderLine> lines;
}
@Entity
class OrderLine {
    @ManyToOne
    @JsonBackReference
    Order order;
}
```

Or — preferred — return a DTO that contains only the data the API needs, and never expose the entity directly.

## Scenario 3 — Equals/hashCode infinite recursion across two entities

```java
class Person {
    String name;
    Company employer;
    @Override public boolean equals(Object o) {
        return o instanceof Person p && Objects.equals(employer, p.employer);
    }
    @Override public int hashCode() { return Objects.hash(employer); }
}
class Company {
    String name;
    Person ceo;
    @Override public boolean equals(Object o) {
        return o instanceof Company c && Objects.equals(ceo, c.ceo);
    }
    @Override public int hashCode() { return Objects.hash(ceo); }
}
```

**Symptom.** `someSet.add(person)` -> `StackOverflowError` when CEO is set.

**Diagnosis.** Mutual reference in identity: `Person.equals` calls `Company.equals` which calls `Person.equals`.

**Fix.** Identity belongs to identifiers, not to associations. Compare by a stable id or by a primitive natural key:

```java
class Person {
    final UUID id;
    @Override public boolean equals(Object o) {
        return o instanceof Person p && id.equals(p.id);
    }
    @Override public int hashCode() { return id.hashCode(); }
}
```

## Scenario 4 — Package-private leakage across modules

```java
// com.shop.billing.internal
class Discount { /* package-private */
    BigDecimal rate;
}
// com.shop.catalog
class PricingTester {
    void test() {
        var d = new com.shop.billing.internal.Discount(); // compiles only if same package or...
    }
}
```

**Symptom.** Refactor of `Discount` breaks `catalog`. There is no `public` declaration anywhere, yet `catalog` depends on it.

**Diagnosis.** `PricingTester` was placed into `com.shop.billing.internal` by mistake (different module, same package name pre-JPMS), so package-private access works. Two modules share a package — classic intimacy through the package boundary.

**Fix.**

1. Move `PricingTester` back to `com.shop.catalog`.
2. Add `module-info.java` with `exports com.shop.billing.api;` only — splitting a package across modules is then forbidden by JPMS.
3. Add an ArchUnit test: `noClasses().that().resideInAPackage("com.shop.catalog..").should().dependOnClassesThat().resideInAPackage("com.shop.billing.internal..")`.

## Scenario 5 — Internal class exposed by accident through a return type

```java
public class ReportService {
    public InternalReportBuilder builder() { return new InternalReportBuilder(); }
}
class InternalReportBuilder { /* package-private */
    public void addRow(Row r) { ... }
}
```

**Symptom.** Compiles, but consumers cannot use the returned object except by reflection — or, worse, they make `InternalReportBuilder` public "to fix the warning" and now every detail leaks.

**Diagnosis.** `javac -Xlint:exports` warns: "exported method returns non-exported type". A non-public type is reachable through a public API.

**Fix.** Either make the return type itself a published interface, or return a value object that hides the builder:

```java
public class ReportService {
    public Report build(ReportRequest req) { ... }   // returns a published DTO
}
```

## Scenario 6 — Cascade orphan storm from intimate associations

```java
@Entity
class Course {
    @OneToMany(mappedBy = "course", cascade = CascadeType.ALL, orphanRemoval = true)
    Set<Enrollment> enrollments;
}
@Entity
class Student {
    @OneToMany(mappedBy = "student", cascade = CascadeType.ALL, orphanRemoval = true)
    Set<Enrollment> enrollments;
}
```

**Symptom.** Removing one student deletes the course's enrollment, which then orphan-removes from the course's set, which triggers further deletes — production deletes far more rows than expected.

**Diagnosis.** Two aggregates both own the same join entity. `Enrollment` is intimate with both sides; ownership is unclear.

**Fix.** Pick one aggregate root for `Enrollment`. The other side has `cascade = {}` and no `orphanRemoval`. Typically `Enrollment` belongs to `Student` (registrations) or to `Course` (rosters) — not both.

## Scenario 7 — Lombok `@EqualsAndHashCode` on a JPA entity with associations

```java
@Entity @EqualsAndHashCode
class Author {
    @Id Long id;
    @OneToMany(mappedBy = "author") List<Book> books;
}
```

**Symptom.** Adding `Author` to a `HashSet` triggers a lazy-load of `books`, sometimes outside a transaction → `LazyInitializationException`. With initialised collections, the operation is `O(n)` because the hash includes the whole book list.

**Diagnosis.** `@EqualsAndHashCode` defaults include every field, including the lazy collection.

**Fix.**

```java
@Entity @EqualsAndHashCode(onlyExplicitlyIncluded = true)
class Author {
    @EqualsAndHashCode.Include @Id Long id;
    @OneToMany(mappedBy = "author") List<Book> books;
}
```

## Scenario 8 — Test reaching into production internals via reflection

```java
@Test
void rateApplied() {
    var calc = new TaxCalculator();
    var f = TaxCalculator.class.getDeclaredField("regionalRate");
    f.setAccessible(true);
    f.set(calc, new BigDecimal("0.20"));
    assertEquals("12.00", calc.compute(60).toString());
}
```

**Symptom.** Test passes today. After renaming `regionalRate` to `rate`, the test compiles and still runs — but silently sets the wrong field via a now non-existent path (or NoSuchFieldException is caught somewhere up the stack).

**Diagnosis.** The test is intimate with private structure of production code.

**Fix.** Inject the rate through a constructor; the test sets it the same way production does.

```java
class TaxCalculator {
    private final BigDecimal rate;
    public TaxCalculator(BigDecimal rate) { this.rate = rate; }
}
```

## Scenario 9 — N+1 fetch caused by bidirectional intimacy with default-eager `@ManyToOne`

```java
@Entity class OrderLine {
    @ManyToOne Order order;   // EAGER by default
    @ManyToOne Product product; // EAGER by default
}
```

**Symptom.** Loading 200 order lines runs 401 queries.

**Diagnosis.** Default-eager `@ManyToOne` walks both back-references on every fetch.

**Fix.**

```java
@ManyToOne(fetch = FetchType.LAZY) Order order;
@ManyToOne(fetch = FetchType.LAZY) Product product;
```

Add an explicit `join fetch` for the read paths that genuinely need the parents. Long-term: break the bidirectional link if `OrderLine` never actually needs `Order` outside persistence.

## Scenario 10 — Two services reaching into each other's caches

```java
class UserService {
    final Map<Long, User> cache = new ConcurrentHashMap<>();
    User load(Long id) { ... }
}
class AuditService {
    private final UserService users;
    void onEvent(Event e) {
        users.cache.remove(e.userId());   // public field
    }
}
```

**Symptom.** Stale users sometimes appear after audit events, sometimes do not. Cache invalidation is unreliable.

**Diagnosis.** `AuditService` is reaching into the *internal field* of `UserService`. The cache is part of `UserService`'s implementation; `AuditService` should not know it exists. As soon as `UserService` adds a second-level cache or a TTL store, the invalidation breaks.

**Fix.** Expose intent, not state:

```java
class UserService {
    private final Map<Long, User> cache = new ConcurrentHashMap<>();
    public void invalidate(long id) { cache.remove(id); }
}
class AuditService {
    void onEvent(Event e) { users.invalidate(e.userId()); }
}
```

Even better: publish a `UserChangedEvent` and let `UserService` invalidate its own cache when it consumes the event. The two services no longer know each other at all.

## Memorize this

- Bidirectional JPA associations are infinite-recursion machines for `toString`, `equals`, and Jackson — always exclude back-references.
- Identity (`equals`/`hashCode`) belongs to identifiers, never to associations.
- Two modules sharing a package is hidden Inappropriate Intimacy; JPMS makes the boundary real.
- A public method returning a non-published type is a leak the compiler will only warn about under `-Xlint:exports`.
- Tests that touch private fields by reflection are intimate; tests should reach in the same way production code does.
- Cache invalidation between services is a code smell — replace it with events or with `invalidate` methods owned by the cache holder.
