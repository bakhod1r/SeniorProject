# When Object Thinking Fails — Middle

> **What?** The junior page named the *categories* of problem where Object Thinking misfires. This page goes one level deeper: we put the three real contenders — behavior-first OO, functional pipelines, and data-oriented arrays — side by side on the *same* concrete task, look at what each one costs, and then build the muscle of moving between them: extracting pure functions, wrapping side-effectful boundaries around a pure core, using records as bridges, and refactoring a god `*Service` into pure logic plus a thin adapter.
> **How?** Read each paradigm comparison as "same problem, three lenses". Notice that the question is rarely "which is correct" but "which is honest about the data, the load, and the change pressure". Then internalize the four rules at the end so paradigm selection becomes a 30-second decision, not a 30-minute debate.

---

## 1. The same task, three paradigms

Concrete task: **"Find the maximum temperature per region from a stream of ~1,000,000 sensor readings."** Each reading is a `(stationId, regionCode, timestampMillis, celsius)`. We need a `Map<String, Double>` of `regionCode -> maxCelsius`.

### 1a. Behavior-first OO

```java
final class Region {
    private final String code;
    private double currentMax = Double.NEGATIVE_INFINITY;
    Region(String code) { this.code = code; }
    void record(Reading r) { if (r.celsius() > currentMax) currentMax = r.celsius(); }
    double max() { return currentMax; }
}

final class RegionRegistry {
    private final Map<String, Region> regions = new HashMap<>();
    void ingest(Reading r) {
        regions.computeIfAbsent(r.regionCode(), Region::new).record(r);
    }
    Map<String, Double> snapshot() {
        var out = new HashMap<String, Double>();
        regions.forEach((k, v) -> out.put(k, v.max()));
        return out;
    }
}
```

Each `Region` is a stateful agent that remembers its hottest reading. The `RegionRegistry` routes incoming data. Reads naturally; mutates internal state.

### 1b. Functional (Stream)

```java
Map<String, Double> maxByRegion = readings.stream()
    .collect(Collectors.groupingBy(
        Reading::regionCode,
        Collectors.mapping(Reading::celsius,
            Collectors.reducing(Double.NEGATIVE_INFINITY, Double::max))));
```

No `Region` class. No mutation visible at the call site. The shape of the computation — *group by, then reduce* — is right there in the type. Easy to parallelize with `.parallelStream()` because the reducer is associative.

### 1c. Data-oriented (primitive arrays)

```java
// inputs already loaded as parallel primitive arrays
String[] regionCodes;       // length 1_000_000
double[] celsius;           // length 1_000_000
String[] distinctRegions;   // small, e.g. 50
int[] regionIndex;          // length 1_000_000, index into distinctRegions

double[] maxPerRegion = new double[distinctRegions.length];
Arrays.fill(maxPerRegion, Double.NEGATIVE_INFINITY);

for (int i = 0; i < celsius.length; i++) {
    int r = regionIndex[i];
    double c = celsius[i];
    if (c > maxPerRegion[r]) maxPerRegion[r] = c;
}
```

No objects, no boxing, no map lookups. One sequential pass over two flat arrays. The hot loop is a few machine instructions; the JIT will vectorize parts of it.

All three are correct. They are not equally costly.

---

## 2. Bench-style cost comparison

A rough mental model — measure before you trust the numbers, but the ordering rarely changes:

| Aspect                  | OO version (1a)                          | Stream version (1b)                    | DoD version (1c)                       |
| ----------------------- | ---------------------------------------- | -------------------------------------- | -------------------------------------- |
| Allocations per reading | 0 (after warmup) + 1 `Region` per region | small per-element box for `Double::max`| 0                                      |
| Map lookups             | 1 per reading                            | 1 per reading                          | 0                                      |
| Cache locality          | poor (objects on heap)                   | poor                                   | excellent (sequential array)           |
| Parallelization         | manual (synchronize `Region`)            | `.parallelStream()` for free           | manual but cheap (split index ranges)  |
| Lines of domain code    | ~20                                      | 4                                      | 8 hot + setup                          |
| Cognitive surface       | classes, methods, encapsulation          | one collector chain                    | indices, arrays, no naming             |
| Testability             | mock-free, but stateful                  | trivial, pure                          | trivial, pure                          |

If you run this on 1M rows, the DoD version typically beats the OO version by **5–20×** on warm JIT. The stream is usually within 1.5× of the OO loop. None of this matters for 10K rows.

**The rule:** pick the paradigm by where the *cost* lives. If the cost is *time-per-row × rows*, DoD wins. If the cost is *reasoning-per-line of business code*, OO or FP wins.

---

## 3. Extracting a pure function from a behavior-first object

A common refactoring: an OO class is fine for *holding state* but its *decision logic* is pure. Pull the pure part out as a `static` function and the class shrinks to a thin shell.

Before — a fraud-rule object that mixes state and decision:

```java
final class FraudCheck {
    private final List<Transaction> history;
    private final Clock clock;
    FraudCheck(List<Transaction> history, Clock clock) { this.history = history; this.clock = clock; }

    boolean isSuspicious(Transaction candidate) {
        Instant now = clock.instant();
        long last5min = history.stream()
            .filter(t -> Duration.between(t.at(), now).toMinutes() < 5).count();
        return last5min > 10 || candidate.amount().isGreaterThan(Money.of(10_000));
    }
}
```

After — the decision is pure, the object only carries collaborators:

```java
final class FraudRules {
    private FraudRules() {}
    static boolean isSuspicious(Transaction candidate, List<Transaction> recent5min, Money limit) {
        return recent5min.size() > 10 || candidate.amount().isGreaterThan(limit);
    }
}

final class FraudCheck {
    private final TransactionHistory history;
    private final Clock clock;
    FraudCheck(TransactionHistory history, Clock clock) { ... }

    boolean isSuspicious(Transaction t) {
        var recent = history.within(clock.instant().minus(Duration.ofMinutes(5)));
        return FraudRules.isSuspicious(t, recent, Money.of(10_000));
    }
}
```

`FraudRules.isSuspicious` is now a pure function: same inputs, same output, no clock, no I/O, no list mutation. You can unit-test it with two `List.of(...)` calls. The `FraudCheck` object survives, but its job is reduced to *fetching data and calling the pure rule*. This is the most common shape of "object-thinking-with-functional-core" in modern Java.

---

## 4. Functional core, imperative shell — concretely

Bernhardt's pattern adapted to Java looks like a sandwich: at the *outside* you have an imperative method that talks to the database, the clock, the network; at the *inside* you have one or more pure functions; in between sit small domain records.

```java
// --- Functional core: zero I/O, zero clocks, zero mutation ---
public record DiscountInput(Cart cart, Customer customer, LocalDate today) {}
public record DiscountOutput(Money total, List<String> appliedCodes) {}

public final class DiscountCore {
    private DiscountCore() {}
    public static DiscountOutput apply(DiscountInput in) {
        var subtotal = in.cart().lines().stream()
            .map(LineItem::lineTotal).reduce(Money.ZERO, Money::plus);
        var codes = new ArrayList<String>();
        Money total = subtotal;
        if (in.customer().tier() == Tier.GOLD) { total = total.times(0.90); codes.add("GOLD-10"); }
        if (in.today().getDayOfWeek() == DayOfWeek.TUESDAY) { total = total.times(0.95); codes.add("TUESDAY-5"); }
        return new DiscountOutput(total, List.copyOf(codes));
    }
}

// --- Imperative shell: all the I/O, none of the math ---
public final class CheckoutController {
    private final CartRepo carts;       private final CustomerRepo customers;
    private final Clock clock;          private final OrderRepo orders;

    public Order checkout(UUID cartId) {
        var cart = carts.byId(cartId);                       // I/O
        var customer = customers.byId(cart.customerId());    // I/O
        var today = LocalDate.now(clock);                    // time
        var out = DiscountCore.apply(                        // pure
            new DiscountInput(cart, customer, today));
        var order = Order.from(cart, out);
        orders.save(order);                                  // I/O
        return order;
    }
}
```

`DiscountCore.apply` is testable with a dozen fixtures and zero mocks. `CheckoutController` is mostly wiring. The shell *uses* OO (`CartRepo`, `OrderRepo`, `Order`) because that's where identity and lifecycle live; the core is a pure record-in, record-out function because that's where math lives.

---

## 5. Wrap-vs-pierce: OO at the boundary, pure inside

A useful image: the **boundary** of your module is where types like `Repository`, `Controller`, `Notifier`, and `Clock` live — these are *roles*, OO at its best. Inside the boundary, calculations should be pure functions over records, not chains of `service.foo(service.bar(...))`.

```
HTTP request -> [ Imperative shell: repos, clocks, mailers ]
                            |
                            v
                [ Functional core: records in -> records out ]
                            |
                            v
                [ Save / notify / respond ]
```

You **wrap** the pure core with OO; you don't let OO **pierce** into the math. The mistake junior developers make is the opposite: a `PriceCalculator` that takes a `Clock`, a `Repo`, a `Logger`, and an `EventBus`, and inside its `compute()` method does *all three at once*. That object is impossible to test without four mocks. The wrap-vs-pierce discipline avoids that whole class of pain.

---

## 6. Records as bridges between OO and FP

Java records (since 16) are the cleanest bridge between Object Thinking and functional style. They are immutable by default, have value semantics (equals/hashCode by components), can implement interfaces and host compact constructors for validation, and are deconstructable by pattern matching.

```java
public record Reading(String stationId, String regionCode,
                      long timestampMillis, double celsius) {
    public Reading {
        if (celsius < -273.15) throw new IllegalArgumentException("below absolute zero");
    }
    public Instant at() { return Instant.ofEpochMilli(timestampMillis); }
}
```

A `Reading` is small, immutable, validated at construction, and carries one tiny method (`at()`) that is a pure projection. It does not *do* anything domain-level — it is the perfect input to a pure function like `DiscountCore.apply`. Records slot naturally into `Collectors.groupingBy(Reading::regionCode, ...)` chains and `switch (r) { case Reading(var s, var rc, var t, var c) -> ... }` deconstructions.

The rule that emerges: **records carry data across paradigm boundaries**; behavior-rich classes are reserved for things with identity and lifecycle.

---

## 7. Refactor case study — god `*Service` to pure + adapter

A common before-state in a Spring service codebase:

```java
@Service
class ReportService {
    @Autowired SalesRepo sales;     @Autowired CustomerRepo customers;
    @Autowired Clock clock;         @Autowired ExcelWriter excel;
    @Autowired Mailer mailer;

    public void sendMonthlyReport(UUID accountId) {
        var month = YearMonth.now(clock).minusMonths(1);
        var rows = sales.between(accountId, month.atDay(1), month.atEndOfMonth());
        var customer = customers.byId(accountId);
        var byProduct = new HashMap<String, BigDecimal>();
        for (var r : rows) byProduct.merge(r.productCode(), r.amount(), BigDecimal::add);
        var top5 = byProduct.entrySet().stream()
            .sorted((a, b) -> b.getValue().compareTo(a.getValue())).limit(5).toList();
        mailer.send(customer.email(), "Monthly report " + month,
            excel.render(top5, customer, month));
    }
}
```

This method does everything: time, I/O, aggregation, formatting, email. It is impossible to unit-test the aggregation without spinning up half the application context.

After — split into a pure core and a thin adapter:

```java
// 1. Pure data
public record SalesRow(String productCode, BigDecimal amount) {}
public record ReportInput(List<SalesRow> rows, Customer customer, YearMonth month) {}
public record ReportOutput(List<Map.Entry<String, BigDecimal>> top5,
                           Customer customer, YearMonth month) {}

// 2. Pure function: testable with List.of(...)
public final class ReportCore {
    private ReportCore() {}
    public static ReportOutput compute(ReportInput in) {
        var byProduct = in.rows().stream().collect(Collectors.groupingBy(
            SalesRow::productCode,
            Collectors.reducing(BigDecimal.ZERO, SalesRow::amount, BigDecimal::add)));
        var top5 = byProduct.entrySet().stream()
            .sorted(Map.Entry.<String, BigDecimal>comparingByValue().reversed())
            .limit(5).toList();
        return new ReportOutput(top5, in.customer(), in.month());
    }
}

// 3. Thin adapter: I/O only
@Service
class ReportService {
    private final SalesRepo sales;     private final CustomerRepo customers;
    private final Clock clock;         private final ExcelWriter excel;
    private final Mailer mailer;
    // constructor injection omitted

    public void sendMonthlyReport(UUID accountId) {
        var month = YearMonth.now(clock).minusMonths(1);
        var rows = sales.between(accountId, month.atDay(1), month.atEndOfMonth());
        var output = ReportCore.compute(
            new ReportInput(rows, customers.byId(accountId), month));   // pure
        mailer.send(output.customer().email(),
            "Monthly report " + month, excel.render(output));
    }
}
```

Testing `ReportCore.compute` is now a 10-line JUnit method with three `SalesRow`s and an assertion on `top5`. The `ReportService` shrinks to wiring — exactly where mocks belong, and they are now used to verify *that we called the mailer*, not to fake out aggregation logic.

---

## 8. Pitfalls when changing paradigms

- **Paradigm wars on the team.** "Streams are unreadable" vs "loops are old-school" — both stances are aesthetic, not technical. Decide per file what is *clearer for the next reader*, not what is more fashionable.
- **Premature DoD.** Flattening domain objects into parallel `String[]`/`double[]` arrays before you have a benchmark is the classic mistake. Until a profiler points at allocation or cache misses, the OO version is fine.
- **"Everything is a function" excess.** A 12-argument static method with a `Map<String, Object> options` parameter is a class in disguise with worse type safety. Extract a record for the input.
- **Stream-chain spaghetti.** A `.stream().map().filter().map().flatMap().collect()` chain spanning 40 lines and three lambdas is imperative code in poor disguise. Extract intermediate records and named helper methods.
- **Pure-then-impure middle.** A "pure" function that accepts a `Repository` and calls it inside is *not pure*. The dependency arrow must point *in*: data flows in as a record, results flow out as a record.
- **Records as anemic domain hubs.** A record is fine as a DTO or as the input/output of a pure function. Turning the whole domain into 80 records and one `*Service` is just the anemic-domain anti-pattern with newer syntax.

---

## 9. Quick paradigm-selection rules

A 30-second decision tree for picking the paradigm of a new module:

- **Identity, lifecycle, invariants spanning fields?** → Object Thinking. `Order`, `Account`, `Reservation`.
- **Input → transform → output, no state?** → Functional (streams/records). CSV import, report aggregation.
- **Millions of small items in a hot loop?** → Data-oriented. Profile first; reach for primitive arrays second.
- **Crossing a wire (HTTP/Kafka/file)?** → Records as DTOs at the boundary; map to/from domain inside.
- **I/O-heavy orchestration?** → Imperative shell with OO collaborators (repos, clocks, mailers).
- **Computational kernel inside a domain object?** → Extract a static pure function; let the object delegate to it.

Two healthy questions before adding a class: *Does this thing have **identity** that outlives one call?* and *Are there **invariants** spanning its fields that must hold together?* If both answers are no, it is data — make it a record. If both are yes, it is an aggregate — make it a behavior-first class. If only one is yes, you are usually one refactoring away from clarity.

---

## 10. What's next

| Topic                                                              | File              |
| ------------------------------------------------------------------ | ----------------- |
| JVM mechanics: ECS, Valhalla value classes, Loom, escape analysis  | `senior.md`        |
| Driving paradigm choices on a team without dogma                   | `professional.md`  |
| Hands-on "pick the paradigm" exercises                             | `tasks.md`         |
| Interview Q&A on paradigm trade-offs                               | `interview.md`     |

---

**Memorize this:** Three paradigms, one codebase, one rule — keep behavior-first OO where there is *identity and invariants*, drop to *records and pure functions* in the middle where there is just math, and reach for *flat primitive arrays* only where a profiler proves you have to. Records bridge OO and FP; the imperative shell wraps the pure core; the god service dies. That is what mature paradigm selection in modern Java looks like.
