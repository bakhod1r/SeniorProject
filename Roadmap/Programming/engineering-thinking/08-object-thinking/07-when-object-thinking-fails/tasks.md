# When Object Thinking Fails — Tasks

> Eight exercises. Each gives a problem, a starting snippet, and several paradigm options. **Pick one (sometimes two)** and **justify in three sentences**, then refactor or redesign. The point is not to find "the right answer" — it is to articulate *why* a paradigm fits, and to feel the friction when it does not. Time-box yourself: 20–40 minutes per task. Task 1 has a worked solution at the bottom — try first, then compare.

---

## Task 1 — CSV importer: OO vs functional stream

You are given a CSV file of bank transactions. Each row has `date,amount,memo`. You must produce a list of `Transaction` values, skipping rows whose memo is blank.

**Starting snippet:**

```java
public class TransactionImporter {
    private final CsvParser parser = new CsvParser();
    private final TransactionMapper mapper = new TransactionMapper();
    private final MemoFilter filter = new MemoFilter();
    public List<Transaction> importFrom(Path file) throws IOException {
        List<String> lines = Files.readAllLines(file);
        List<CsvRow> rows = parser.parseAll(lines);
        List<CsvRow> filtered = filter.keepNonBlankMemo(rows);
        return mapper.toTransactions(filtered);
    }
}
```

**Options:**

- A. Keep the OO structure; clean up the three helper classes.
- B. Collapse into a single static method using `Stream<String>`.
- C. Functional core + thin imperative shell (file I/O outside, transform pure).

**Constraint:** Pick one paradigm and justify in three sentences. Then implement it in at most 25 lines.

**Acceptance:**

- [ ] No class has more than one public method; blank-memo rows are skipped.
- [ ] Parsing errors surface as a typed result, not a silent skip.
- [ ] You can explain in one sentence why this code does not need an aggregate.

---

## Task 2 — Game tick loop with 100k entities

You have 100,000 game entities. Each tick (60 times per second) you must update positions from velocities. The current design uses deep inheritance and virtual dispatch.

**Starting snippet:**

```java
abstract class GameObject {
    double x, y, vx, vy;
    abstract void update(double dt);
}
class Enemy extends GameObject {
    @Override void update(double dt) { x += vx * dt; y += vy * dt; }
}
class Projectile extends GameObject {
    @Override void update(double dt) { x += vx * dt; y += vy * dt; }
}
void tick(List<GameObject> world, double dt) {
    for (GameObject g : world) g.update(dt);
}
```

**Options:**

- A. Keep OO, but flatten the hierarchy and seal it.
- B. Move to an ECS sketch: `int` entity ids + parallel arrays for `x, y, vx, vy`.
- C. Data-oriented Structure-of-Arrays without entity ids (raw `double[]` columns).

**Constraint:** Pick one paradigm and justify in three sentences, focusing on cache locality, allocation pressure, and inlining.

**Acceptance:**

- [ ] Position update touches contiguous memory; no per-tick allocation on the hot path.
- [ ] You can add a "health" component to *some* entities without touching the physics loop.
- [ ] You measured (or at least estimated) the expected speedup vs the OO version.

---

## Task 3 — Currency conversion service

You need to convert amounts between currencies using a rates map. The current code is a Spring `@Service` with private state.

**Starting snippet:**

```java
@Service
public class CurrencyConversionService {
    private Map<String, BigDecimal> rates = new HashMap<>();
    public void setRates(Map<String, BigDecimal> rates) { this.rates = rates; }
    public BigDecimal convert(BigDecimal amount, String from, String to) {
        BigDecimal fromRate = rates.get(from);
        BigDecimal toRate = rates.get(to);
        return amount.multiply(toRate).divide(fromRate, 4, RoundingMode.HALF_UP);
    }
}
```

**Options:**

- A. Keep it as a service, but make `rates` immutable and inject via constructor.
- B. Replace with a pure static function `convert(amount, from, to, rates)`.
- C. Model `Money` as a value type with `convertedTo(Currency, Rates)`.

**Constraint:** Pick one paradigm and justify in three sentences. If you pick C, also explain when B would have been enough.

**Acceptance:**

- [ ] No mutable global state; tests do not need a Spring context.
- [ ] Rounding rules are explicit, not hidden in a setter.
- [ ] You can answer: "what is the identity of this object?" — and if you cannot, you have your answer.

---

## Task 4 — ETL aggregation

You must read a Parquet file of clickstream events, group by `userId`, count events, and write the result to another Parquet file.

**Starting snippet:**

```java
public class ClickstreamAggregator {
    private final EventReader reader;
    private final UserCountAccumulator accumulator;
    private final ParquetWriter writer;
    public void run(Path in, Path out) {
        List<Event> events = reader.readAll(in);
        Map<String, Long> counts = accumulator.accumulate(events);
        writer.writeCounts(out, counts);
    }
}
```

**Options:**

- A. Stream-based pipeline: `Files → Stream<Event> → groupingBy → counting → write`.
- B. Push the aggregation into SQL or Spark and keep only a 30-line driver in Java.
- C. Keep the OO structure but make each helper a pure function on a record.

**Constraint:** Pick one paradigm and write a 30-line implementation. Justify in three sentences why this work does **not** belong in a behavior-rich domain model.

**Acceptance:**

- [ ] Implementation fits in 30 lines including imports; no hidden mutable state.
- [ ] If 10 GB does not fit in memory, your design still works (streaming or partitioned).
- [ ] You can name two reasons why anthropomorphizing an event row would be silly.

---

## Task 5 — JSON DTO + rich aggregate boundary

The HTTP layer receives a JSON body for placing an order. The domain has a rich `Order` aggregate with invariants. You must design the conversion layer between them.

**Starting snippet:**

```java
// Wire-level:
public class PlaceOrderRequest {
    public String customerId;
    public List<LineItemDto> items;
    public ShippingAddressDto address;
}
// Domain (invariants: items non-empty, address valid, customer known):
public final class Order {
    private final OrderId id;
    private final CustomerId customer;
    private final List<LineItem> items;
    private final ShippingAddress address;
}
// Today, the controller does:
@PostMapping("/orders")
public ResponseEntity<?> place(@RequestBody PlaceOrderRequest req) {
    Order order = new Order(/* ... copy-paste mapping ... */);
    return ResponseEntity.ok(orderService.place(order));
}
```

**Options:**

- A. DTOs stay anemic records; a separate `OrderAssembler` maps DTO to aggregate.
- B. Give the DTO a `toDomain()` method.
- C. Use a single static factory `Order.fromRequest(req, CustomerRepo)` on the aggregate.

**Constraint:** Pick one paradigm and justify in three sentences. Then redesign the DTO + boundary in code. The DTO must remain *trivially serializable*.

**Acceptance:**

- [ ] DTO is a `record` with no behavior beyond validation annotations.
- [ ] Mapping logic lives in exactly one place; the aggregate cannot be constructed with invalid data.
- [ ] You can explain why a DTO is not an "agent" that can "place itself".

---

## Task 6 — God-service with mixed logic

A 600-line `PaymentService` does network calls, computes fees, applies discounts, writes audit logs, and emits events. You must extract pure functions and identify what legitimately stays OO.

**Starting snippet:**

```java
@Service
public class PaymentService {
    private final BankClient bank;
    private final AuditLog audit;
    private final DiscountRepo discounts;
    private final EventBus events;
    public PaymentResult pay(PaymentRequest req) {
        var rate = bank.fetchRate(req.currency());
        var fee = req.amount().multiply(new BigDecimal("0.015"));
        var discount = discounts.activeFor(req.customerId());
        var net = req.amount().subtract(fee).subtract(discount.amount());
        audit.write("attempt", req);
        var resp = bank.charge(req.customerId(), net);
        audit.write("result", resp);
        events.publish(new Paid(req.id(), net));
        return new PaymentResult(resp.txnId(), net);
    }
}
```

**Options:**

- A. Extract `computeNet(amount, fee, discount)` and `feeFor(amount)` as pure functions; keep I/O in the service.
- B. Build a `Money` value type with `withFee`, `withDiscount`; service shrinks to orchestration.
- C. Full functional core + imperative shell: `Payment.decide(request, rate, discount)` returns a sealed result; service interprets it.

**Constraint:** Pick **two** paradigms (one for the core, one for the shell) and justify each in three sentences. Refactor the snippet accordingly.

**Acceptance:**

- [ ] No pure function in the core touches `bank`, `audit`, `events`, or `discounts`; the shell is the only place that does I/O.
- [ ] You can unit-test the fee/discount/net logic with zero mocks.
- [ ] You named at least one piece of logic that *deserves* to stay in an aggregate.

---

## Task 7 — Pricing engine

You are pricing tickets. There are exactly four ticket kinds: `Standard`, `Discounted`, `Group`, `Free`. Each has its own pricing rule. New kinds are added once or twice a year and require careful review.

**Starting snippet:**

```java
public BigDecimal price(Ticket t, Context ctx) {
    if (t.kind() == TicketKind.STANDARD)   return ctx.basePrice();
    if (t.kind() == TicketKind.DISCOUNTED) return ctx.basePrice().multiply(new BigDecimal("0.8"));
    if (t.kind() == TicketKind.GROUP)      return ctx.basePrice().multiply(new BigDecimal("0.7"))
                                                                 .multiply(BigDecimal.valueOf(t.partySize()));
    if (t.kind() == TicketKind.FREE)       return BigDecimal.ZERO;
    throw new IllegalStateException();
}
```

**Options:**

- A. Sealed interface `Ticket` with a pattern-matched `switch` returning the price.
- B. Polymorphism: `Ticket.price(Context)` overridden in each subtype.
- C. Strategy pattern with a `Map<TicketKind, PricingStrategy>`.

**Constraint:** Pick one paradigm and justify in three sentences. Discuss how each option behaves when you add a fifth ticket kind, and which option you would choose if pricing rules were *uploaded by admins at runtime* instead of fixed in code.

**Acceptance:**

- [ ] Adding a fifth kind causes a compile error in exactly the places you must update (closed-set case); no `if/else` chain over an enum survives.
- [ ] You can explain when "polymorphism" is just a heavier `switch`.
- [ ] You can explain when Strategy is overkill.

---

## Task 8 — Recognize a misapplied OO design

A junior engineer wrote a `ConfigManager` because "everything should be a class". It exposes setters, has a thread to "refresh itself", and is injected everywhere.

**Starting snippet:**

```java
@Component
public class ConfigManager {
    private String dbUrl;
    private int connectionTimeoutMs;
    private boolean featureXEnabled;
    private final ScheduledExecutorService refresher;
    public ConfigManager() {
        this.refresher = Executors.newSingleThreadScheduledExecutor();
        this.refresher.scheduleAtFixedRate(this::reload, 0, 30, TimeUnit.SECONDS);
    }
    public synchronized String getDbUrl() { return dbUrl; }
    public synchronized void setDbUrl(String v) { this.dbUrl = v; }
    // ...same shape for the other six fields...
    private synchronized void reload() { /* reads YAML, sets fields */ }
}
```

**Options:**

- A. Replace with an immutable `record Config(String dbUrl, int connectionTimeoutMs, boolean featureXEnabled)` plus a separate `ConfigLoader` that returns a new `Config` on reload.
- B. Keep the manager but freeze its fields after construction (no setters).
- C. Push refresh out to the platform (e.g., Spring's `@RefreshScope`) and keep only a record.

**Constraint:** Pick one paradigm and justify in three sentences. Identify two concrete bugs that the current design enables (hint: mid-flight inconsistency across fields, lock contention on every read) and explain how your redesign prevents them.

**Acceptance:**

- [ ] No setters survive; readers see a consistent snapshot of the whole config, never a torn read across fields.
- [ ] Refresh logic lives in exactly one place and returns a *new* config value.
- [ ] You can articulate in one sentence why "Manager" in a class name is a smell.

---

## Worked solution sketch — Task 1

The honest answer is option **C**: functional core, imperative shell. Three-sentence justification: (1) the data has no identity, no lifecycle, and no invariant beyond "memo is not blank" — nothing to anthropomorphize; (2) file I/O is a side effect, so isolating it in a shell keeps the transform testable without disk; (3) the OO version's three helper classes exist only to hide a five-line pipeline.

Sketch:

```java
public final class TransactionImporter {
    private TransactionImporter() {}
    // Pure core — testable with an in-memory stream of strings.
    static List<Transaction> parse(Stream<String> lines) {
        return lines
            .map(CsvRow::parse)
            .filter(r -> !r.memo().isBlank())
            .map(Transaction::from)
            .toList();
    }
    // Imperative shell — owns the file handle and the error boundary.
    public static List<Transaction> importFrom(Path file) throws IOException {
        try (Stream<String> lines = Files.lines(file)) { return parse(lines); }
    }
    record CsvRow(String date, String amount, String memo) {
        static CsvRow parse(String line) {
            String[] cols = line.split(",", -1);
            return new CsvRow(cols[0], cols[1], cols[2]);
        }
    }
}
```

Notes: `CsvRow` and `Transaction` are records (data crossing a boundary); `parse` takes a `Stream<String>` so tests skip the disk; no `Parser`/`Mapper`/`Filter`/`Pipeline`/`Factory`. If `Transaction` later grows a "reject negative amounts" rule, that rule lives on the value type — the importer stays a pipeline.

---

**Memorize this:** Picking the paradigm is part of the design. When you can articulate in three sentences why functional, data-oriented, or imperative fits *this* problem better than OO, you are doing the work that the previous six subsections were preparing you for — the work of using Object Thinking *deliberately*, not by default.
