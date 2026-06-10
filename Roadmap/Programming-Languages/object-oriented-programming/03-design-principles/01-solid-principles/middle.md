# SOLID Principles — Middle

> **What?** One worked refactor per letter on realistic domains — loan, refund, claim, reservation, warehouse, healthcare — and a combined cleanup of a class that breaks several letters at once.
> **How?** Each section shows a faulty starting class, names the smell, and walks through the smallest change that removes it without over-engineering. Read the diff, not just the principle.

---

## 1. Why one example per letter beats abstract definitions

Junior-level SOLID lists definitions. Middle-level SOLID is *transformations*: I had this class, the smell was X, I applied principle Y, the result is the diff below. Until you can perform the transformation on your own code, the letters are slogans.

Every section follows the same rhythm: a real domain class, the concrete pain, then the smallest refactor that buys back changeability. None of the refactors introduce a framework or a new dependency — SOLID is a sketching tool, the heavy lifting is structural.

---

## 2. SRP — breaking up a god `OrderManager` (loan domain)

Suppose a lending platform has a `LoanManager`. It started small. A year later:

```java
public class LoanManager {
    private final Connection db;
    private final SmtpClient mail;

    public void apply(LoanApplication a) {
        if (a.amount().signum() <= 0) throw new IllegalArgumentException("amount");
        if (a.term() < 6 || a.term() > 60) throw new IllegalArgumentException("term");

        BigDecimal monthly = a.amount().multiply(new BigDecimal("0.015"));
        BigDecimal total = monthly.multiply(BigDecimal.valueOf(a.term()));

        try (PreparedStatement ps = db.prepareStatement(
                "INSERT INTO loans (borrower, amount, term, total) VALUES (?, ?, ?, ?)")) {
            ps.setLong(1, a.borrowerId());
            ps.setBigDecimal(2, a.amount());
            ps.setInt(3, a.term());
            ps.setBigDecimal(4, total);
            ps.executeUpdate();
        } catch (SQLException e) { throw new RuntimeException(e); }

        mail.send(a.borrowerEmail(), "Loan approved", "Total payable: " + total);
    }
}
```

Four stakeholders edit this class: risk (validation), finance (interest formula), data (schema), and marketing (email copy). Four reasons to change.

Refactor into focused collaborators:

```java
public record LoanApplication(long borrowerId, String borrowerEmail,
                              BigDecimal amount, int term) {}

public class LoanValidator {
    public void validate(LoanApplication a) {
        if (a.amount().signum() <= 0) throw new IllegalArgumentException("amount");
        if (a.term() < 6 || a.term() > 60) throw new IllegalArgumentException("term");
    }
}

public class InterestCalculator {
    public BigDecimal totalPayable(LoanApplication a) {
        return a.amount().multiply(new BigDecimal("0.015"))
                         .multiply(BigDecimal.valueOf(a.term()));
    }
}

public interface LoanRepository { void save(LoanApplication a, BigDecimal total); }
public interface LoanNotifier  { void approved(LoanApplication a, BigDecimal total); }

public class LoanService {
    private final LoanValidator validator;
    private final InterestCalculator interest;
    private final LoanRepository repo;
    private final LoanNotifier notifier;
    /* constructor omitted */

    public void apply(LoanApplication a) {
        validator.validate(a);
        BigDecimal total = interest.totalPayable(a);
        repo.save(a, total);
        notifier.approved(a, total);
    }
}
```

`apply` is now a four-line story. Each collaborator has one stakeholder, and tests can mock any of them in isolation.

---

## 3. OCP — replacing a type-code switch with sealed types (refund domain)

A returns service handles refund channels by string code:

```java
public class RefundProcessor {
    public void refund(String channel, BigDecimal amount, String reference) {
        switch (channel) {
            case "CARD"   -> reverseCardAuthorization(reference, amount);
            case "WALLET" -> creditWallet(reference, amount);
            case "BANK"   -> issueBankTransfer(reference, amount);
            case "STORE_CREDIT" -> addStoreCredit(reference, amount);
            default -> throw new IllegalArgumentException("unknown: " + channel);
        }
    }
}
```

Every new channel forces edits to a class that already works for four. The risk of breaking `CARD` while adding `CRYPTO` is non-zero.

Modern Java fits this perfectly via sealed interfaces and pattern matching:

```java
public sealed interface RefundChannel
        permits CardChannel, WalletChannel, BankChannel, StoreCreditChannel {
    void refund(BigDecimal amount, String reference);
}

public final class CardChannel   implements RefundChannel { /* reverse auth */ }
public final class WalletChannel implements RefundChannel { /* credit wallet */ }
// ... bank, store-credit

public class RefundProcessor {
    public void refund(RefundChannel channel, BigDecimal amount, String reference) {
        channel.refund(amount, reference);
    }
}
```

Adding `CryptoChannel` is one new file plus one line in `permits`. The compiler also refuses to forget a case in any pattern-matching switch over `RefundChannel` — OCP's payoff without the openness-of-classic-strategy where anyone could add a rogue implementation.

---

## 4. LSP — fixing a subclass that throws (claim/list domain)

An insurance claims module exposes a list of evidence files. To "protect" it, someone wrote:

```java
public class FrozenEvidenceList<T> extends ArrayList<T> {
    public FrozenEvidenceList(Collection<? extends T> src) { super(src); }
    @Override public boolean add(T t)         { throw new UnsupportedOperationException(); }
    @Override public boolean remove(Object o) { throw new UnsupportedOperationException(); }
    @Override public T set(int i, T e)        { throw new UnsupportedOperationException(); }
}

void attachToClaim(Claim c, List<Evidence> evidence) {
    evidence.add(new Evidence("audit-trail.pdf"));   // boom for FrozenEvidenceList
    c.assignEvidence(evidence);
}
```

`FrozenEvidenceList` *is-a* `ArrayList` by inheritance but *isn't* one by contract — it narrows the parent's behaviour in ways callers can't see. The fix is not to extend the mutable type at all:

```java
public final class FrozenEvidenceList<T> implements Iterable<T> {
    private final List<T> items;
    public FrozenEvidenceList(Collection<? extends T> src) { this.items = List.copyOf(src); }
    public T get(int i)           { return items.get(i); }
    public int size()             { return items.size(); }
    public Iterator<T> iterator() { return items.iterator(); }
    public Stream<T> stream()     { return items.stream(); }
}
```

The parameter type now tells the caller whether mutation is allowed. The general rule: a subtype may *strengthen* postconditions and *weaken* preconditions, never the reverse. Throwing where the parent didn't is strengthening preconditions in disguise — "you can only call me on instances that happen to be the base class".

---

## 5. ISP — splitting a fat `BookingRepository` (reservation domain)

A hotel system has one repository all clients depend on:

```java
public interface BookingRepository {
    Booking findById(long id);
    List<Booking> findByGuest(long guestId);
    List<Booking> findOverlapping(LocalDate from, LocalDate to);
    void save(Booking b);
    void cancel(long id);
    void archiveOlderThan(LocalDate cutoff);
    BookingReport monthlyReport(YearMonth ym);
    void exportToWarehouse(LocalDate cutoff);
}
```

Three callers use it: a reception screen reads and saves, a nightly job archives and exports, a finance dashboard wants only the monthly report. Every caller pulls in methods it doesn't use, every test double mocks methods nobody cares about, and a change to `exportToWarehouse` recompiles the reception screen.

Split by *the role each caller plays*:

```java
public interface BookingReader {
    Booking findById(long id);
    List<Booking> findByGuest(long guestId);
    List<Booking> findOverlapping(LocalDate from, LocalDate to);
}
public interface BookingWriter {
    void save(Booking b);
    void cancel(long id);
}
public interface BookingArchive {
    void archiveOlderThan(LocalDate cutoff);
    void exportToWarehouse(LocalDate cutoff);
}
public interface BookingReports {
    BookingReport monthlyReport(YearMonth ym);
}
```

The JDBC class implements all four; nobody is forced to. The reception screen depends on `BookingReader` + `BookingWriter`, the nightly job on `BookingArchive`, the dashboard on `BookingReports`. Notice the interfaces are grouped *by role*, not *by method count* — ISP doesn't require one method per interface; `BookingReader` has three, and a reader uses all three.

---

## 6. DIP — inverting a service that imports a Postgres driver (healthcare domain)

A patient-records service depends on a concrete driver:

```java
import org.postgresql.ds.PGSimpleDataSource;     // low-level detail leaking into the domain

public class PatientRecordService {
    private final PGSimpleDataSource ds;
    public PatientRecordService(PGSimpleDataSource ds) { this.ds = ds; }

    public Optional<PatientRecord> findByNationalId(String nid) {
        try (Connection c = ds.getConnection();
             PreparedStatement ps = c.prepareStatement(
                "SELECT * FROM patient_records WHERE national_id = ?")) {
            ps.setString(1, nid);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? Optional.of(mapRow(rs)) : Optional.empty();
            }
        } catch (SQLException e) { throw new RuntimeException(e); }
    }
}
```

The domain knows Postgres, JDBC types, and a SQL dialect. Migrate to a document DB and the domain class rewrites.

Invert the arrow:

```java
public interface PatientRecordRepository {
    Optional<PatientRecord> findByNationalId(String nid);
    void save(PatientRecord r);
}

public class PatientRecordService {
    private final PatientRecordRepository repo;
    public PatientRecordService(PatientRecordRepository repo) { this.repo = repo; }
    public Optional<PatientRecord> lookup(String nid) { return repo.findByNationalId(nid); }
}

// In an adapter package, not in the domain package:
public class PostgresPatientRecordRepository implements PatientRecordRepository {
    private final DataSource ds;
    /* constructor + JDBC bodies */
}
```

The domain now owns the abstraction (`PatientRecordRepository` sits next to `PatientRecordService`); the Postgres class is a detail that *depends on* the domain. Tests substitute a `Map<String, PatientRecord>`-backed implementation. The Postgres import is confined to one adapter file.

---

## 7. Combined refactor — a warehouse class that breaks four letters

```java
public class WarehouseManager {
    private final OracleConnection oracle;
    public WarehouseManager(OracleConnection o) { this.oracle = o; }

    public void process(String kind, Object payload) {
        if (kind.equals("RESTOCK")) {
            Restock r = (Restock) payload;
            oracle.exec("UPDATE stock SET qty = qty + " + r.qty()
                       + " WHERE sku = '" + r.sku() + "'");
            sendEmail("ops@warehouse", "restocked " + r.sku());
        } else if (kind.equals("SHIP")) {
            Shipment s = (Shipment) payload;
            oracle.exec("UPDATE stock SET qty = qty - " + s.qty()
                       + " WHERE sku = '" + s.sku() + "'");
        }
    }
}
```

Smells: **SRP** (validates, persists, notifies in one method), **OCP** (adding `RETURN` edits the if-chain), **ISP** (callers stuck with `process(String, Object)` can pass the wrong kind), **DIP** (concrete `OracleConnection` wired into the domain).

Cleanup in four moves:

```java
// 1. Replace stringly typed dispatch with a sealed command (OCP):
public sealed interface WarehouseCommand permits Restock, Shipment, ReturnReceipt {}
public record Restock(String sku, int qty)       implements WarehouseCommand {}
public record Shipment(String sku, int qty)      implements WarehouseCommand {}
public record ReturnReceipt(String sku, int qty) implements WarehouseCommand {}

// 2. Invert storage (DIP) and split notifications (ISP + SRP):
public interface StockRepository { void adjust(String sku, int delta); }
public interface OpsNotifier     { void restocked(String sku, int qty); }

// 3. One handler per command (SRP):
public class RestockHandler {
    private final StockRepository stock;
    private final OpsNotifier ops;
    /* constructor omitted */
    public void handle(Restock r) {
        stock.adjust(r.sku(), +r.qty());
        ops.restocked(r.sku(), r.qty());
    }
}
// ShipmentHandler and ReturnHandler are analogous.

// 4. A thin dispatcher; exhaustiveness checked by javac:
public class WarehouseDispatcher {
    private final RestockHandler restock;
    private final ShipmentHandler ship;
    private final ReturnHandler returns;
    /* constructor omitted */
    public void execute(WarehouseCommand cmd) {
        switch (cmd) {
            case Restock r       -> restock.handle(r);
            case Shipment s      -> ship.handle(s);
            case ReturnReceipt r -> returns.handle(r);
        }
    }
}
```

Each move corresponds to one letter; doing them together yields a class set where every future change has an obvious home.

---

## 8. SOLID with records, sealed types, and functional interfaces

Modern Java collapses ceremony around several letters:

| Feature             | Letter it serves                  | Why                                                                 |
|---------------------|-----------------------------------|---------------------------------------------------------------------|
| `record`            | SRP                               | Value carriers have one job: hold values. Final, immutable, equal-by-fields. |
| `sealed`            | OCP + LSP                         | You decide the closed set; exhaustiveness is compile-checked; no rogue subtype can break contracts. |
| `Function<T,R>` etc.| ISP + DIP                         | One-method abstractions; pass behaviour without inventing an interface. |
| `record` + `interface` | DIP                            | Implement an abstraction with a zero-boilerplate immutable adapter. |

A small example combining several:

```java
public sealed interface DiscountRule permits PercentOff, FixedAmountOff, FreeShipping {
    BigDecimal apply(BigDecimal subtotal);
}
public record PercentOff(BigDecimal rate)    implements DiscountRule {
    public BigDecimal apply(BigDecimal s) { return s.multiply(BigDecimal.ONE.subtract(rate)); }
}
public record FixedAmountOff(BigDecimal off) implements DiscountRule {
    public BigDecimal apply(BigDecimal s) { return s.subtract(off).max(BigDecimal.ZERO); }
}
public record FreeShipping(BigDecimal save)  implements DiscountRule {
    public BigDecimal apply(BigDecimal s) { return s.subtract(save).max(BigDecimal.ZERO); }
}
```

OCP for free (new rule = new record), LSP for free (records are `final`), SRP for free (each rule is one calculation), no DIP concern because there is no infrastructure inside a rule.

---

## 9. Mistakes that come from over-applying SOLID

**Over-segregation.** Splitting a five-method repository into five interfaces because "ISP" produces five files and zero callers that benefit. The unit of segregation is a *caller role*, not a method.

**Premature abstraction.** Wrapping every collaborator in an interface before there is a second implementation. You pay the indirection tax (jump-to-definition lands on the interface, reading flow takes two clicks) and never collect the benefit. Introduce the interface when a second impl appears or a test needs a fake at a real boundary.

**"I-prefixed everything."** `IOrderService`, `IRepository`, `ILogger` is a smell, not a discipline. The interface is the *abstraction*; the implementation is the variation. Name the interface for the role (`OrderService`), the implementation for the variation (`JpaOrderService`, `InMemoryOrderService`).

**Treating SRP as line count.** A 400-line `PricingEngine` for a real legal regime is fine if it has one stakeholder. A 30-line class that prints and saves is not.

**Inheriting just to reuse code.** Every `extends` introduces LSP risk. If you only want code reuse, compose; inheritance is for *is-a* relationships where substitution must hold.

**Wrapping inert types in DIP.** Don't introduce `IString`, `IUuid`, `ILocalDate`. DIP is for *interesting boundaries* — I/O, time, randomness, network, persistence, external systems.

---

## 10. Quick rules

- [ ] If you can name two stakeholders who would edit the same class for different reasons, split (SRP).
- [ ] If adding the next variant means editing the dispatch instead of adding a class, polymorphism or sealed types are missing (OCP).
- [ ] If a subclass narrows behaviour (throws, returns differently, requires more), the inheritance is wrong, not the parent (LSP).
- [ ] If callers mock methods they don't call, the interface is too wide for them (ISP).
- [ ] If a domain file imports a driver, a client, or a vendor SDK, the arrow is pointing the wrong way (DIP).
- [ ] Refactor one letter at a time; don't try to score all five in a single PR.
- [ ] Records, sealed types, and functional interfaces remove a lot of historical SOLID ceremony — use them.

---

## 11. What's next

| Topic                                                          | File              |
|----------------------------------------------------------------|-------------------|
| Edge cases, anti-patterns, "SOLIDified to death"               | `senior.md`        |
| Driving SOLID across a team and a codebase                     | `professional.md`  |
| JLS/JVMS hooks relevant to SOLID idioms                        | `specification.md` |
| Silent SOLID violations and their runtime symptoms             | `find-bug.md`      |
| JIT, dispatch, allocation: the cost of SOLID idioms            | `optimize.md`      |
| Hands-on refactors                                             | `tasks.md`         |
| Interview Q&A                                                  | `interview.md`     |

---

**Memorize this:** every SOLID fix is a *transformation* — name the smell, point at the letter, make the smallest move that removes it, stop. Records replace value-carrier SRP boilerplate; sealed types replace OCP-switch boilerplate; constructor injection replaces DIP framework ceremony. The principles are sketching tools, not laws — apply the one that names the smell in front of you.
