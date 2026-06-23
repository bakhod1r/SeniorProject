# SOLID Principles — Practice Tasks

Eight exercises that force each SOLID letter to bite. Most are refactors of code that *compiles fine* but breaks the moment a stakeholder asks for the next reasonable change. Domains are drawn from systems you will plausibly meet: loan disbursement, ride dispatch, claims processing, warehouse robotics, healthcare, and fleet management.

Work each task in three passes: (1) read the snippet and name the smell using the SOLID vocabulary, (2) sketch the new shape on paper before touching the keyboard, (3) write code and a small test that would have caught the original problem.

---

## Task 1 — SRP: split a `ReportingManager`

```java
public class ReportingManager {
    private final Connection db;
    private final SmtpClient smtp;

    public ReportingManager(Connection db, SmtpClient smtp) {
        this.db = db;
        this.smtp = smtp;
    }

    public void runDailyLoanReport(LocalDate day) throws Exception {
        // 1. Query loan disbursements for the day
        var rows = new ArrayList<DisbursementRow>();
        try (var st = db.prepareStatement(
                "SELECT id, borrower, amount FROM disbursements WHERE day = ?")) {
            st.setObject(1, day);
            var rs = st.executeQuery();
            while (rs.next()) {
                rows.add(new DisbursementRow(
                        rs.getLong("id"),
                        rs.getString("borrower"),
                        rs.getBigDecimal("amount")));
            }
        }

        // 2. Format as CSV
        var csv = new StringBuilder("id,borrower,amount\n");
        for (var r : rows) csv.append(r.id()).append(',')
                              .append(r.borrower()).append(',')
                              .append(r.amount()).append('\n');

        // 3. Write to disk
        Files.writeString(Path.of("/var/reports/loans-" + day + ".csv"),
                          csv.toString());

        // 4. Email the operations team
        smtp.send("ops@bank.example",
                  "Loan disbursements " + day,
                  "See attached CSV.",
                  csv.toString().getBytes(StandardCharsets.UTF_8));

        // 5. Mark each row as "reported"
        try (var st = db.prepareStatement(
                "UPDATE disbursements SET reported = true WHERE day = ?")) {
            st.setObject(1, day);
            st.executeUpdate();
        }
    }
}
```

**Objective.** Identify every reason this class would be edited, then split it so each new class has exactly one.

**Constraints.**
- No method longer than ~15 lines after the refactor.
- `ReportingManager` (or its replacement coordinator) should contain only orchestration, no SQL, no I/O, no formatting.
- The five concerns to separate cleanly: querying disbursements, CSV formatting, file writing, email sending, marking rows as reported.

**Acceptance criteria.**
- A reader can name each new class's single reason to change in one sentence.
- Changing the CSV column order does not touch the class that runs the SQL.
- Changing the recipient address does not touch the class that writes files.
- A unit test for the formatter runs without any `Connection` or SMTP mock.
- The coordinator class has no `import java.sql.*` and no `import javax.mail.*`.

---

## Task 2 — OCP: rebuild `ShippingCalculator` without the switch

```java
public class ShippingCalculator {

    public BigDecimal cost(String carrier, BigDecimal weightKg, String zone) {
        return switch (carrier) {
            case "GROUND" -> BigDecimal.valueOf(3.50)
                    .add(weightKg.multiply(BigDecimal.valueOf(0.90)));
            case "EXPRESS" -> BigDecimal.valueOf(8.00)
                    .add(weightKg.multiply(BigDecimal.valueOf(1.40)));
            case "OVERNIGHT" -> BigDecimal.valueOf(18.00)
                    .add(weightKg.multiply(BigDecimal.valueOf(2.10)))
                    .add("INTL".equals(zone) ? BigDecimal.valueOf(12.00) : BigDecimal.ZERO);
            case "FREIGHT" -> weightKg.compareTo(BigDecimal.valueOf(50)) > 0
                    ? BigDecimal.valueOf(45.00).add(weightKg.multiply(BigDecimal.valueOf(0.30)))
                    : BigDecimal.valueOf(60.00);
            default -> throw new IllegalArgumentException("Unknown carrier " + carrier);
        };
    }
}
```

**Objective.** Make adding a new carrier (say, `DRONE`) a matter of writing *one* new file and registering it, without editing `ShippingCalculator`.

**Constraints.**
- Replace the `String carrier` parameter with a polymorphic type.
- The calculator must remain useful as a single object that callers ask for prices — don't push the entire decision back onto the caller.
- Each carrier strategy should be independently unit-testable.

**Acceptance criteria.**
- A new `Carrier` implementation can be added with zero edits to `ShippingCalculator`.
- The compiler — not a runtime `default` branch — tells you when something is wrong (hint: prefer a sealed interface if the set is known, or a registry if the set is open).
- Each carrier's price formula lives in exactly one place.
- A test adds a fake `Carrier` returning a constant and confirms it flows through.

---

## Task 3 — LSP: the subclass that strengthens preconditions

```java
public class RideRequestQueue {
    /**
     * Enqueue a request. Accepts any non-null request with a non-null pickup point.
     */
    public void enqueue(RideRequest req) {
        Objects.requireNonNull(req);
        Objects.requireNonNull(req.pickup());
        store(req);
    }
    protected void store(RideRequest req) { /* ... */ }
}

public class PriorityRideQueue extends RideRequestQueue {
    /**
     * Same as parent — but rejects requests without a pre-assigned tier.
     */
    @Override
    public void enqueue(RideRequest req) {
        Objects.requireNonNull(req);
        Objects.requireNonNull(req.pickup());
        if (req.tier() == null) {
            throw new IllegalArgumentException("tier required for priority queue");
        }
        store(req);
    }
}
```

A dispatcher does:

```java
RideRequestQueue queue = pickQueue(); // sometimes returns PriorityRideQueue
queue.enqueue(new RideRequest(pickup, /* tier */ null));
```

**Objective.** Spot the LSP violation, then fix the design.

**Constraints.**
- Do not weaken the parent's contract just to make the subclass legal.
- Do not add a runtime `instanceof` check in the dispatcher.

**Acceptance criteria.**
- After the fix, any code holding a `RideRequestQueue` reference can pass a tier-less request without surprises.
- A test that previously threw at runtime when a `PriorityRideQueue` was hidden behind the parent reference no longer compiles, or no longer hits the failing call site.
- You can articulate which contract the subclass was strengthening (preconditions) and which direction LSP permits movement (preconditions may *weaken*, postconditions may *strengthen*).
- Two plausible fixes are documented: (a) make `PriorityRideQueue` not extend `RideRequestQueue`, exposing it as its own type; (b) lift tier-validation into the request type itself so neither queue rejects on null.

---

## Task 4 — ISP: split the fat `Connector`

```java
public interface Connector {
    void connect(URI endpoint);
    void disconnect();

    void publishClaim(Claim c);              // used by claim adjusters
    Claim fetchClaim(String claimId);        // used by claim adjusters

    void publishMetric(String name, double v); // used by ops dashboard
    List<Metric> readMetrics(Instant since);   // used by ops dashboard

    void rotateCredentials();                // used only by the security agent
    AuditLog tailAudit(int n);               // used only by the security agent
}
```

Three callers exist in the claims-processing system:

- `ClaimAdjusterApp` — uses only `connect/disconnect`, `publishClaim`, `fetchClaim`.
- `OpsDashboard` — uses only `connect/disconnect`, `publishMetric`, `readMetrics`.
- `SecurityAgent` — uses only `connect/disconnect`, `rotateCredentials`, `tailAudit`.

**Objective.** Refactor the interface so each caller depends only on the methods it uses.

**Constraints.**
- The connection lifecycle (`connect`, `disconnect`) is shared by all three — decide once where it lives and justify the choice.
- A single concrete `BrokerConnector` class can still implement everything; it's the *interfaces* that segregate, not the implementations.

**Acceptance criteria.**
- `ClaimAdjusterApp` compiles without any reference to `publishMetric`, `rotateCredentials`, or `tailAudit`.
- A test double for the adjuster path mocks only two or three methods, not seven.
- A new caller type (say, a billing exporter) can pick the interfaces it needs without inheriting unused ones.
- No interface has a method that any of its implementers throws `UnsupportedOperationException` from.

---

## Task 5 — DIP: invert `RewardService` away from MySQL

```java
public class RewardService {

    private final MysqlDataSource ds = new MysqlDataSource();

    public RewardService() {
        ds.setURL("jdbc:mysql://prod-db:3306/loyalty");
        ds.setUser("rewards");
        ds.setPassword(System.getenv("DB_PASS"));
    }

    public int pointsFor(long customerId) {
        try (var c = ds.getConnection();
             var st = c.prepareStatement(
                "SELECT SUM(points) FROM ledger WHERE customer_id = ?")) {
            st.setLong(1, customerId);
            try (var rs = st.executeQuery()) {
                return rs.next() ? rs.getInt(1) : 0;
            }
        } catch (SQLException e) {
            throw new RuntimeException(e);
        }
    }

    public void award(long customerId, int points, String reason) {
        try (var c = ds.getConnection();
             var st = c.prepareStatement(
                "INSERT INTO ledger (customer_id, points, reason) VALUES (?, ?, ?)")) {
            st.setLong(1, customerId);
            st.setInt(2, points);
            st.setString(3, reason);
            st.executeUpdate();
        } catch (SQLException e) {
            throw new RuntimeException(e);
        }
    }
}
```

**Objective.** Invert the dependency so `RewardService` knows nothing about MySQL, JDBC, or connection URLs.

**Constraints.**
- The high-level policy (how points are computed, what counts as a valid award) stays in `RewardService`.
- Storage details (SQL, connection pooling, credentials) move below an abstraction owned by the service's package.
- Use constructor injection with `final` fields; no field-level `new`, no service locator.

**Acceptance criteria.**
- A unit test can substitute an in-memory `RewardLedger` and verify `award` then `pointsFor` returns the expected sum, with zero JDBC on the classpath of the test module.
- Switching from MySQL to Postgres is a one-class change.
- Searching the file `RewardService.java` for `jdbc`, `mysql`, `Connection`, `PreparedStatement` returns no hits.
- The abstraction's method names speak the domain (`creditPoints`, `totalFor`), not the technology (`insertRow`, `executeQuery`).

---

## Task 6 — SRP + DIP: refactor a god service

```java
public class WarehouseOrderService {

    private final HikariDataSource db = new HikariDataSource(/* hard-coded config */);
    private final OkHttpClient http = new OkHttpClient();
    private final Logger log = LoggerFactory.getLogger(WarehouseOrderService.class);

    public void place(Order order) throws Exception {
        // 1. validate
        if (order.lines().isEmpty()) throw new IllegalArgumentException("empty");
        for (var line : order.lines()) {
            if (line.quantity() <= 0) throw new IllegalArgumentException("qty<=0");
        }

        // 2. check stock by calling the inventory HTTP API directly
        var req = new Request.Builder()
                .url("http://inventory.internal/stock?sku=" + order.lines().get(0).sku())
                .build();
        try (var resp = http.newCall(req).execute()) {
            var available = Integer.parseInt(resp.body().string());
            if (available < order.lines().get(0).quantity()) {
                throw new IllegalStateException("out of stock");
            }
        }

        // 3. write to DB via raw JDBC
        try (var c = db.getConnection();
             var st = c.prepareStatement(
                 "INSERT INTO orders (id, customer, total) VALUES (?, ?, ?)")) {
            st.setString(1, order.id());
            st.setString(2, order.customer());
            st.setBigDecimal(3, order.total());
            st.executeUpdate();
        }

        // 4. enqueue a pick task by posting to RabbitMQ via raw AMQP
        try (var conn = new ConnectionFactory().newConnection();
             var ch = conn.createChannel()) {
            ch.basicPublish("warehouse", "pick", null,
                            order.id().getBytes(StandardCharsets.UTF_8));
        }

        // 5. fire-and-forget email
        Runtime.getRuntime().exec(new String[]{"sendmail", order.customer()});

        log.info("placed order {}", order.id());
    }
}
```

**Objective.** Two letters at once. Split responsibilities (SRP) *and* invert each external boundary (DIP) so the service depends only on abstractions it owns.

**Constraints.**
- The class becomes a coordinator at most ~30 lines long.
- Each external system (inventory API, database, message queue, mailer) lives behind a domain-shaped interface (`StockChecker`, `OrderRepository`, `PickTaskQueue`, `CustomerNotifier`).
- Validation rules become their own object that does not touch any I/O.
- No constructor performs I/O (no `new HikariDataSource()` inside the service).

**Acceptance criteria.**
- The service's constructor lists four collaborators plus the validator; everything is `final`.
- A test that places a valid order uses four in-memory fakes and asserts each was invoked in order.
- Adding retry around the message queue is a wrapper around `PickTaskQueue`, not an edit to the service.
- The string `jdbc`, `http`, `amqp`, and `sendmail` do not appear in `WarehouseOrderService.java`.

---

## Task 7 — LSP + ISP: a hierarchy of health-monitoring devices

You are designing a model for hospital bedside devices. The current proposal:

```java
public interface BedsideDevice {
    void powerOn();
    void powerOff();

    HeartRate readHeartRate();
    Spo2 readSpo2();
    BloodPressure readBloodPressure();
    Temperature readTemperature();

    void infuse(Drug d, double mlPerHour);   // for IV pumps
    void deliverShock(int joules);           // for defibrillators
}
```

Concrete devices in the ward:
- `PulseOximeter` — reads SpO2 only.
- `ThermometerProbe` — reads temperature only.
- `MultiparameterMonitor` — reads heart rate, SpO2, blood pressure, temperature.
- `IvPump` — infuses; reads nothing.
- `Defibrillator` — delivers shocks; reads heart rate.

A nurse's tablet does:

```java
BedsideDevice d = wardRegistry.findByBedId("ICU-3");
HeartRate hr = d.readHeartRate(); // crashes if d is a ThermometerProbe
```

**Objective.** Re-design the type hierarchy so (a) no subclass is forced to "implement" methods it cannot honour (ISP), and (b) any code holding a reference to a base type can call every method on it safely (LSP).

**Constraints.**
- Split the fat `BedsideDevice` into role interfaces (`PowerCycle`, `HeartRateSource`, `Spo2Source`, `BpSource`, `TemperatureSource`, `Infuser`, `Shocker`).
- Compose concrete devices by implementing the roles they actually fulfil.
- The nurse's tablet must ask for the *capability*, not for `BedsideDevice`: e.g. `Optional<HeartRateSource> hrs = wardRegistry.find(bedId, HeartRateSource.class);`.

**Acceptance criteria.**
- A `ThermometerProbe` cannot be passed to a method that expects a `HeartRateSource` — caught at compile time.
- Replacing a `MultiparameterMonitor` with any other `HeartRateSource` doesn't break the tablet's heart-rate path.
- No implementation throws `UnsupportedOperationException` from any method it declares.
- A new device type (say, a `CapnographyProbe` that reads CO2) plugs in by declaring one new `Co2Source` interface and one new class — no edits to existing devices.

---

## Task 8 — OCP + DIP: a pricing-engine plugin point

Fleet management charges customers per vehicle per day, but each customer signs a different deal: flat rate, tiered by mileage, surge by region, loyalty discount stacked on top, etc. Today the team edits `PricingEngine.priceFor(...)` for every new deal. You are asked to design the plugin point.

```java
public class PricingEngine {

    public Money priceFor(Lease lease, UsagePeriod period) {
        // 90 lines of if/else over lease.contractType(), lease.region(),
        // lease.customer().tier(), period.mileage(), etc.
        // every new contract adds a branch.
    }
}
```

**Objective.** Design an extensible pricing engine that (a) accepts new pricing rules without modification (OCP) and (b) does not know about the concrete sources of input data — mileage feeds, regional surge tables, loyalty levels — which are owned by other teams (DIP).

**Constraints.**
- Introduce a `PricingRule` abstraction with one method: `Money apply(PricingContext ctx, Money runningTotal)`.
- Rules are *composed* in an order that the engine receives from outside; the engine does not hard-code which rules apply.
- `PricingContext` is built from collaborators — `MileageFeed`, `SurgeTable`, `LoyaltyLookup` — that are interfaces in the pricing package, with their implementations injected.
- The engine accepts a `List<PricingRule>` at construction; ordering is the caller's responsibility (and is testable).

**Acceptance criteria.**
- A new pricing rule (say, "weekend surcharge") is added as one new class implementing `PricingRule`; the engine is untouched.
- A test wires three trivial rules (`+10 flat`, `+2 per mile`, `-5% loyalty discount`) with in-memory feeds, and asserts the running total after each step.
- The engine has no `if (lease.contractType() == ...)` anywhere.
- Reordering rules changes the price predictably; the test demonstrates this on at least two orderings.
- Swapping `MileageFeed` from a database-backed implementation to one reading from a CSV requires zero edits inside `PricingEngine` or any `PricingRule`.

---

## Validation

| Task | How to verify the fix |
|------|-----------------------|
| 1 | Each new class can be unit-tested with no `Connection` or SMTP mock — only the coordinator wires them. |
| 2 | Add a `DroneCarrier` in a separate file; existing tests still pass and `ShippingCalculator` is unchanged. |
| 3 | A method that takes `RideRequestQueue` and passes a tier-less request must never throw at runtime regardless of which subtype it received. |
| 4 | Search each caller's source for the unused method names — there should be no hits. |
| 5 | The test classpath has no JDBC driver; the service still builds and runs the happy path. |
| 6 | The string `jdbc`, `http`, `amqp`, `sendmail` does not appear in `WarehouseOrderService.java`. |
| 7 | `nurseTablet.heartRateOf(deviceId)` returns `Optional.empty()` for a `ThermometerProbe`; it does not throw. |
| 8 | Adding a "weekend surcharge" rule is a single new file; the engine binary is identical to before. |

---

## Worked solution sketch — Task 5 (DIP for `RewardService`)

```java
// 1. The abstraction lives WITH the high-level policy.
public interface RewardLedger {
    int totalFor(long customerId);
    void creditPoints(long customerId, int points, String reason);
}

// 2. The service depends only on the abstraction.
public final class RewardService {
    private final RewardLedger ledger;
    public RewardService(RewardLedger ledger) { this.ledger = ledger; }

    public int pointsFor(long customerId) {
        return ledger.totalFor(customerId);
    }

    public void award(long customerId, int points, String reason) {
        if (points <= 0) throw new IllegalArgumentException("points must be positive");
        if (reason == null || reason.isBlank()) throw new IllegalArgumentException("reason required");
        ledger.creditPoints(customerId, points, reason);
    }
}

// 3. The detail lives in an adapter module, separate from the service.
public final class JdbcRewardLedger implements RewardLedger {
    private final DataSource ds;
    public JdbcRewardLedger(DataSource ds) { this.ds = ds; }

    @Override public int totalFor(long customerId) {
        try (var c = ds.getConnection();
             var st = c.prepareStatement(
                "SELECT COALESCE(SUM(points), 0) FROM ledger WHERE customer_id = ?")) {
            st.setLong(1, customerId);
            try (var rs = st.executeQuery()) {
                rs.next();
                return rs.getInt(1);
            }
        } catch (SQLException e) {
            throw new LedgerAccessException(e);
        }
    }

    @Override public void creditPoints(long customerId, int points, String reason) {
        try (var c = ds.getConnection();
             var st = c.prepareStatement(
                "INSERT INTO ledger (customer_id, points, reason) VALUES (?, ?, ?)")) {
            st.setLong(1, customerId);
            st.setInt(2, points);
            st.setString(3, reason);
            st.executeUpdate();
        } catch (SQLException e) {
            throw new LedgerAccessException(e);
        }
    }
}

// 4. Tests use an in-memory implementation — no JDBC required.
final class InMemoryRewardLedger implements RewardLedger {
    private final Map<Long, Integer> totals = new HashMap<>();
    @Override public int totalFor(long id) { return totals.getOrDefault(id, 0); }
    @Override public void creditPoints(long id, int p, String r) {
        totals.merge(id, p, Integer::sum);
    }
}
```

Notice three things in the sketch:
1. The interface name reads as domain language (`creditPoints`, `totalFor`), not infrastructure (`insert`, `select`).
2. `RewardService` is `final` and has no fields apart from the injected collaborator — its lifecycle is trivial.
3. The exception thrown from the adapter is the *service's* exception type, not `SQLException`. The abstraction owns its own failure vocabulary; otherwise the caller still has to know about JDBC.

---

**Memorize this:** SOLID problems do not show up as compiler errors — they show up the second time you are asked to change something. Each task above gives you that "second time" up front. If, after the refactor, the next plausible change touches *one* class instead of five, you have applied the right letters.
