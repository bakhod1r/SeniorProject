# Data Clumps — Tasks

> Eight exercises, increasing in difficulty. Each one asks you to detect, justify, refactor, and verify.
>
> Work through them in order. The validation table at the bottom tells you whether your solution is acceptable. One worked solution sketch is included at the end to anchor expectations.

---

## How to attempt each exercise

For every task, deliver:

1. **Detection** — name the clump, list the types and the methods where PRC >= 3.
2. **Refactor** — extract one or more VOs, prefer records (JEP 395), enforce invariants in the compact constructor.
3. **Tests** — at least one test that would fail before the refactor and pass after.
4. **Architectural guard** — an ArchUnit rule or comment explaining how you would prevent regression.

---

## Exercise 1 — The textbook trio

```java
public class PricingService {
    public BigDecimal taxFor(BigDecimal amount, String currency, String country) { ... }
    public BigDecimal discountFor(BigDecimal amount, String currency, String customerTier) { ... }
    public Receipt charge(BigDecimal amount, String currency, String accountId) { ... }
}
```

Extract the obvious VO. Bonus: explain why `country`, `customerTier`, and `accountId` are *not* part of the same clump.

---

## Exercise 2 — Two clumps in one class

```java
public class Trip {
    LocalDate startDate;
    LocalDate endDate;
    double originLat;
    double originLng;
    double destinationLat;
    double destinationLng;
}
```

Identify both clumps. Extract appropriate VOs with the relevant invariants. State the invariants explicitly in the compact constructors.

---

## Exercise 3 — Parallel collections

```java
public class GradeBook {
    private List<String> studentIds = new ArrayList<>();
    private List<String> courseIds = new ArrayList<>();
    private List<Integer> scores = new ArrayList<>();

    public void record(String studentId, String courseId, int score) {
        studentIds.add(studentId);
        courseIds.add(courseId);
        scores.add(score);
    }
}
```

Refactor to eliminate the parallel-list anti-pattern. Add a test that demonstrates the prior bug class (inconsistent list lengths) cannot occur.

---

## Exercise 4 — JPA embeddable

Given:

```java
@Entity
public class Customer {
    @Id Long id;
    String shippingStreet;
    String shippingCity;
    String shippingZip;
    String shippingCountry;
    String billingStreet;
    String billingCity;
    String billingZip;
    String billingCountry;
}
```

Extract an `Address` `@Embeddable` (or a record-backed embeddable on Hibernate 6.2+). Migrate the schema if your DB supports `ALTER ... ADD CHECK`; otherwise document the migration plan. Demonstrate that loading and saving still works through a JUnit integration test or Testcontainers setup.

---

## Exercise 5 — The currency mismatch bug

Build on Exercise 1. Add a test that calls `taxFor` with two different currencies in the same business operation:

```java
service.charge(new BigDecimal("100"), "USD", "acct-1");
service.refund(new BigDecimal("100"), "EUR", "acct-1");
```

Make this test fail by extending the `Money` VO with a `convert(ExchangeRate)` method, and force callers through it.

---

## Exercise 6 — Stringly-typed time window

Given:

```java
public List<Event> search(String fromIso, String toIso, String timezone) { ... }
```

Replace with a `TimeWindow(ZonedDateTime from, ZonedDateTime to)` VO. Add a static `parse(String fromIso, String toIso, String zone)` factory. Show in tests that a daylight-saving boundary now produces deterministic results.

---

## Exercise 7 — ArchUnit guard

Pick the codebase you used for any of the previous exercises. Write an ArchUnit rule that fails the build if any method in the domain package accepts `(BigDecimal, Currency)` as separate parameters. Run it. Confirm it fires on the unrefactored code and passes after refactor.

---

## Exercise 8 — Production case: a half-anemic VO

```java
public record Address(String street, String city, String postalCode, String country) {}
```

This record is immutable and value-equal, yet anemic. Add three pieces of behavior that justify its existence as a VO rather than a struct:

1. A factory or compact-constructor invariant that validates `country` against ISO-3166 alpha-2.
2. A formatting method `formatPostalLabel()` returning a multi-line string suitable for printing.
3. A `withCountry(String)` method that returns a new instance (and a test for non-mutation).

State explicitly which DDD principle each addition supports.

---

## Validation table

| Exercise | Acceptable solution must contain                                       | Bonus markers                              |
|----------|-------------------------------------------------------------------------|--------------------------------------------|
| 1        | `Money` record, compact constructor, currency non-null check           | Justifies why other params are not clumps  |
| 2        | `DateRange` + `GeoPoint`, both with invariants                          | `GeoPoint` with `Latitude`/`Longitude` tiny types |
| 3        | `List<GradeEntry>` replacing three parallel lists                       | Test asserts no parallel-length divergence |
| 4        | `Address` embeddable, both fields use same VO                           | Integration test with Testcontainers       |
| 5        | Currency mismatch caught at *type* level, not runtime                   | `ExchangeRate` VO introduced               |
| 6        | `TimeWindow` VO; DST test produces identical results across two runs   | `parse` factory handles offset and zone IDs|
| 7        | ArchUnit rule fires on the bad code, passes on the good code            | Rule documented in `package-info.java`     |
| 8        | All three behaviors present, with tests                                 | One private factory + one static factory   |

If your solution misses an item from the "must contain" column, revise before moving on.

---

## Worked solution sketch — Exercise 2

**Detection.** Method-level PRC is low (the class itself is small), but the field-group PRC across `Trip`, the `TripRepository.findByOriginCity`, and the `RouteCalculator.distance` methods is >= 3 for the `(double lat, double lng)` tuple. Similarly, `(LocalDate start, LocalDate end)` appears in `Trip`, `Booking`, and `Invoice`.

**Refactor.**

```java
public record Latitude(double value) {
    public Latitude { if (value < -90 || value > 90) throw new IllegalArgumentException(); }
}

public record Longitude(double value) {
    public Longitude { if (value < -180 || value > 180) throw new IllegalArgumentException(); }
}

public record GeoPoint(Latitude lat, Longitude lng) {
    public GeoPoint {
        Objects.requireNonNull(lat);
        Objects.requireNonNull(lng);
    }
    public double distanceTo(GeoPoint other) { /* Haversine */ }
}

public record DateRange(LocalDate start, LocalDate end) {
    public DateRange {
        Objects.requireNonNull(start);
        Objects.requireNonNull(end);
        if (end.isBefore(start)) throw new IllegalArgumentException();
    }
    public long days() { return ChronoUnit.DAYS.between(start, end) + 1; }
}

public class Trip {
    DateRange when;
    GeoPoint origin;
    GeoPoint destination;
}
```

**Tests.**

```java
@Test void rejects_swapped_dates() {
    assertThrows(IllegalArgumentException.class,
        () -> new DateRange(LocalDate.of(2026, 5, 20), LocalDate.of(2026, 5, 19)));
}

@Test void latitude_out_of_range() {
    assertThrows(IllegalArgumentException.class, () -> new Latitude(91.0));
}
```

**Architectural guard.** ArchUnit rule:

```java
@ArchTest
static final ArchRule no_lat_lng_pairs =
    noMethods().that().areDeclaredInClassesThat().resideInAPackage("..domain..")
        .should().haveRawParameterTypes(double.class, double.class);
```

False positives (e.g., a `Range(double, double)` for non-geographic values) are silenced by class-level allow-list, not by weakening the rule.

---

## What's next

- `../07-primitive-obsession/tasks.md` — overlapping exercises focused on type-level errors.
- `../../06-anemic-domain-model/tasks.md` — exercises pushing behavior onto extracted VOs.
- `./interview.md` — twenty interview-style questions to consolidate the topic.
