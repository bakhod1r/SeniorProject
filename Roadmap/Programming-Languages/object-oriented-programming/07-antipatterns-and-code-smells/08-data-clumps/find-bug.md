# Data Clumps — Find the Bug

> Ten scenarios pulled from real Java services. For each: the symptom, the diagnosis, and the fix. Read one a day for two weeks; on day fifteen you will spot clumps in your own pull requests before submitting them.

Every example deliberately compiles. The bug is design-level, not syntactic. The lens is Fowler, *Refactoring*, 2nd ed. (2018), ch. 3, sharpened with DDD Value Object discipline.

---

## Scenario 1 — Clumpy method signature, silent bug

```java
public Receipt charge(BigDecimal amount, String currencyCode, String customerId) { ... }

// Call site, written at 11pm:
receipts.charge(new BigDecimal("100.00"), customerId, currencyCode);
```

**Symptom.** Customer charged in currency `"CUST-9381"`. Production incident.

**Diagnosis.** Three primitives, all assignable to `String` (after autoboxing). Compiler cannot distinguish `currencyCode` from `customerId`. Classic clump.

**Fix.** Extract `Money(amount, Currency)` and a `CustomerId` tiny type. Signature becomes `charge(Money, CustomerId)`. Compiler refuses to swap them.

---

## Scenario 2 — JPA entity with clumpy fields

```java
@Entity
public class Order {
    @Id Long id;
    BigDecimal totalAmount;
    String totalCurrency;
    BigDecimal taxAmount;
    String taxCurrency;
    BigDecimal shippingAmount;
    String shippingCurrency;
}
```

**Symptom.** A migration job sets `taxAmount` but forgets `taxCurrency`, leaving `null`. Downstream reports crash on `NullPointerException`.

**Diagnosis.** `(BigDecimal, String)` appears three times in one entity — PRC = 3. The fields belong together but the schema does not enforce it.

**Fix.** Three `@Embeddable` Money objects: `total`, `tax`, `shipping`. The compact constructor of `Money` rejects null currency. The migration cannot leave the entity in a half-set state — either both columns flow in, or the entity refuses to construct.

---

## Scenario 3 — Date range as two parameters

```java
public List<Reservation> findOverlapping(LocalDate start, LocalDate end) {
    return reservations.stream()
        .filter(r -> !r.getEnd().isBefore(start) && !r.getStart().isAfter(end))
        .toList();
}
```

**Symptom.** QA reports occasional "no overlap" results when start equals end and equals a known reservation date.

**Diagnosis.** Two `LocalDate` parameters with an implicit `start <= end` invariant. Nothing enforces it. Callers occasionally pass them swapped; the filter then matches nothing.

**Fix.** `DateRange` VO with compact-constructor invariant `end >= start`. Method becomes `findOverlapping(DateRange range)`. Swap is impossible.

---

## Scenario 4 — Repeated DTO with parallel fields

```java
public class CustomerCreateRequest {
    public String street;
    public String city;
    public String postalCode;
    public String country;
    public String shippingStreet;
    public String shippingCity;
    public String shippingPostalCode;
    public String shippingCountry;
}
```

**Symptom.** Half of the customers in production have a billing country of `"US"` and a shipping country of empty string. Reports treat them as international.

**Diagnosis.** `Address` clump duplicated with a prefix. The shipping fields were added later; the validator was never updated to require the country.

**Fix.** Two `Address` fields: `billingAddress` and `shippingAddress`. Validation lives once, inside the VO.

---

## Scenario 5 — Constructor with five primitives

```java
public Coordinate(double latitude, double longitude, double altitude,
                  double accuracyMeters, long timestampEpochMillis) { ... }

new Coordinate(41.31, 69.24, 0.0, 5.0, System.currentTimeMillis());
```

**Symptom.** A bug report says points appear in the Atlantic Ocean. The team eventually finds a call site that passed `(longitude, latitude, ...)`.

**Diagnosis.** Two latitude/longitude doubles are a textbook clump. `(double, double)` repeats across `distance`, `bearing`, `inside`, and `nearest`.

**Fix.** `GeoPoint(Latitude lat, Longitude lng)` where `Latitude` and `Longitude` are tiny types validating their range. Order is enforced by name.

---

## Scenario 6 — Stringly-typed time interval

```java
public Page<Event> search(String fromIso, String toIso, String timezone) { ... }
```

**Symptom.** Daylight-saving transitions produce off-by-one-hour results. Different callers pass `"Asia/Tashkent"` and `"UTC+5"`; one parses, the other doesn't.

**Diagnosis.** Three Strings, all about one concept: a time window. PRC across the controller is 4.

**Fix.** `TimeWindow(ZonedDateTime from, ZonedDateTime to)` with a compact-constructor invariant and a static `parse` factory that handles the input format once.

---

## Scenario 7 — Pair of IDs as parallel arrays

```java
public void transfer(List<String> sourceAccountIds, List<String> targetAccountIds,
                     List<BigDecimal> amounts, List<String> currencies) { ... }
```

**Symptom.** A batch of 100 transfers; one had a list of 99 currencies. Result: ninety-nine successful transfers and one with currency `null` mapped to USD by a fallback. Cross-currency leak in production.

**Diagnosis.** Four parallel collections, each a column of an implicit row type. Any length mismatch silently corrupts data.

**Fix.** `record TransferLine(AccountId source, AccountId target, Money amount)`; the method takes `List<TransferLine>`. Length mismatches are impossible.

---

## Scenario 8 — Mutable VO masquerading as a Value Object

```java
public class Money {
    private BigDecimal amount;
    private Currency currency;
    public void setAmount(BigDecimal a) { this.amount = a; }
    public void setCurrency(Currency c) { this.currency = c; }
}
```

**Symptom.** A shared `Money` instance held by an `Order` is mutated by a discount service. Other orders that referenced the same instance see their totals change.

**Diagnosis.** Calling it `Money` does not make it a VO. Setters expose mutable state; aliasing causes spooky-action-at-a-distance.

**Fix.** Convert to `record Money(BigDecimal amount, Currency currency)`. Replace `money.setAmount(x)` with `money = money.withAmount(x)` — i.e., assign a new instance.

---

## Scenario 9 — Builder hiding a clump

```java
ShipmentRequest req = ShipmentRequest.builder()
    .originStreet("...").originCity("...").originPostalCode("...").originCountry("...")
    .destinationStreet("...").destinationCity("...").destinationPostalCode("...").destinationCountry("...")
    .weightKg(2.5).lengthCm(30).widthCm(20).heightCm(15)
    .build();
```

**Symptom.** A new dev forgets `.originCountry`. The builder happily returns an object with `null`. Validation fires only at the carrier API, 3 minutes later, in a background worker. Logs blame the wrong service.

**Diagnosis.** Builder API is fluent but the clumps live underneath — `Address` and `Dimensions` are still latent.

**Fix.** Builder takes `Address` and `Dimensions` VOs. Construction-time validation catches missing fields immediately, at the call site.

---

## Scenario 10 — Persisted clump split across columns

```sql
CREATE TABLE booking (
    id BIGINT PRIMARY KEY,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    -- no CHECK constraint
    ...
);
```

```java
@Entity public class Booking {
    @Id Long id;
    LocalDate startDate;
    LocalDate endDate;
}
```

**Symptom.** Reporting query `WHERE end_date - start_date < 0` returns thousands of rows from before the application-side validation was added. The historical data is corrupted.

**Diagnosis.** The schema knows nothing about the invariant. The clump exists in both Java and SQL.

**Fix.**
1. Embed `DateRange` in the `Booking` entity (`@Embeddable`).
2. Add `CHECK (end_date >= start_date)` to the table.
3. Migrate offending rows or quarantine them; never trust an unenforced invariant.

The bug is not just in code — it is in the database. A VO without a matching DB constraint is a half-solution.

---

## Cross-cutting patterns

- **Compiler can't tell `String` from `String`.** Tiny types or VOs make the compiler your reviewer.
- **Null in one half of a clump.** If two fields must be set together, the type system must require it. Two separate columns / two separate parameters / two separate fields will eventually drift.
- **Parallel collections.** Always a clump. Always. Replace with `List<Row>`.
- **Builder fluency hides clumps.** Builders are not a substitute for a Value Object; they sit on top of one.
- **Database constraints matter.** Application-only validation is half of the fix; the schema must agree.

---

## What's next

- `../07-primitive-obsession/find-bug.md` — overlapping bug catalogue from the primitive-type angle.
- `../../06-anemic-domain-model/find-bug.md` — what happens when the VOs are extracted but stay behaviorless.
- `./optimize.md` — performance properties of the records you just extracted.
