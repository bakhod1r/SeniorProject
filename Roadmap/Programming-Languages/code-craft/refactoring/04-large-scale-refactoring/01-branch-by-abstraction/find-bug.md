# Branch by Abstraction — Find the Bug

> **Source:** Paul Hammant, "Branch by Abstraction"; Jez Humble & David Farley, *Continuous Delivery*

Each scenario shows Branch by Abstraction *misapplied*. Diagnose the flaw, then read the fix. These are the failure modes that turn a safe technique into a liability.

---

## Bug 1 — The leaked old implementation

A migration to `StorageEngineOrderRepository` is "done," but a teammate keeps hitting stale data in one feature.

```java
public class OrderService {
    private final OrderRepository repo;   // injected abstraction — good
    public OrderService(OrderRepository repo) { this.repo = repo; }
    public Order place(Order o) { repo.save(o); return repo.findById(o.id()); }
}

public class OrderReportJob {
    private final JdbcOrderDao dao = new JdbcOrderDao(DataSource.get());  // <-- !!
    public Report run() { return summarize(dao.findByCustomer(42)); }
}
```

**Diagnose.** Phase 2 was incomplete. `OrderReportJob` never got routed through the abstraction — it still names the concrete *old* class directly and self-instantiates it. After cutover, `OrderService` reads from the new store while the report job reads from the old one. The old impl *leaked* past the seam, so two code paths see two different stores.

<details><summary>Fix</summary>

1. Route `OrderReportJob` through the abstraction, exactly as Phase 2 prescribes:
```java
public class OrderReportJob {
    private final OrderRepository repo;
    public OrderReportJob(OrderRepository repo) { this.repo = repo; }
    public Report run() { return summarize(repo.findByCustomer(42)); }
}
```
2. Move the wiring to the composition root so this client gets the *same* selected impl as everyone else.
3. **Prevention:** before flipping the flag (Phase 4), confirm the *only* place naming the concrete old class is the composition root. A grep for `new JdbcOrderDao` / `JdbcOrderDao ` returning more than one hit means Phase 2 isn't finished. Don't flip until the seam is the single point of control.
</details>

---

## Bug 2 — The abstraction that was never removed

A year after a successful migration, a new hire is baffled:

```java
public interface PaymentGatewayPort { Receipt charge(Charge c); }

public class StripePaymentGateway implements PaymentGatewayPort { /* the only impl */ }

// composition root
PaymentGatewayPort gw = flags.isEnabled("use-stripe-gateway")
        ? new StripePaymentGateway(stripe)
        : new StripePaymentGateway(stripe);   // <-- both branches identical!
```

**Diagnose.** Phase 5 was skipped. The old impl is gone, so both branches of the ternary now construct the *same* class. The flag `use-stripe-gateway` does nothing, the ternary is dead, and the interface has exactly one implementation. This is pure migration cruft masquerading as design. Worse, the dead flag is a trap — someone might "toggle" it during an incident expecting it to mean something.

<details><summary>Fix</summary>

Complete Phase 5:
1. Delete the flag `use-stripe-gateway` and the ternary; wire directly: `PaymentGatewayPort gw = new StripePaymentGateway(stripe);`
2. **Keep** `PaymentGatewayPort` — a payment gateway is a genuine external-I/O boundary that aids testing and a future provider swap. (If it had been pointless scaffolding, you'd inline it.)
3. **Prevention:** give every migration flag an owner and an expiry date at birth; a CI lint that fails on stale migration flags would have caught this a year ago. See [professional.md](professional.md).
</details>

---

## Bug 3 — The two implementations drifted

A bug ("discount applied twice") was reported, fixed, verified, and closed. Two weeks later it's back — but only sometimes.

```java
// OLD impl — patched when the bug was reported
public class LegacyPricing implements PricingEngine {
    public Money price(Cart c) { return c.subtotal().minus(discountOnce(c)); }  // fixed
}
// NEW impl — behind the flag, NOT patched
public class RulesPricing implements PricingEngine {
    public Money price(Cart c) { return c.subtotal().minus(discount(c)).minus(discount(c)); } // still double!
}

PricingEngine pricing = flags.percentage("use-rules-pricing", 30)  // 30% of traffic
        ? new RulesPricing(rules) : new LegacyPricing();
```

**Diagnose.** Classic coexistence-window drift. During the migration both implementations are alive. The bug fix landed in the old impl only; the new impl (serving 30% of traffic) still double-applies the discount. The bug "comes back" precisely for the flagged-in 30%. The instant-rollback property is also compromised: flipping back hides the new bug but the two paths are now genuinely inconsistent.

<details><summary>Fix</summary>

1. Apply the same fix to `RulesPricing`. Add a regression test that runs against **both** implementations (parameterized) so a single test guards the shared contract.
2. **Prevention — keep the window short and review for it.** While both impls live, code review must ask "does this change need to land in both?" Better, shadow-compare reads (`ComparingPricingEngine`, see [tasks.md](tasks.md) Task 7) — the mismatch metric would have fired the moment the fix landed in only one impl.
</details>

---

## Bug 4 — Shadowing a write path

A team shadow-runs the new persistence layer to "build confidence" before cutover:

```java
public class ComparingOrderRepository implements OrderRepository {
    private final OrderRepository oldImpl, newImpl;
    @Override public void save(Order o) {
        oldImpl.save(o);
        newImpl.save(o);                      // <-- "just for comparison"
    }
    @Override public Order findById(long id) {
        Order a = oldImpl.findById(id);
        Order b = newImpl.findById(id);       // compare
        if (!a.equals(b)) metrics.increment("mismatch");
        return a;
    }
}
```

Soon, support reports duplicate orders and inconsistent state.

**Diagnose.** Shadowing only works for **idempotent reads**. Here `save` is a *write* — the comparing wrapper now writes every order to **both** stores. The new store accumulates real data the migration plan never accounted for, the two stores diverge under concurrent traffic, and a rollback can't undo what was already written to the new store. The author treated a side-effecting method like a pure one.

<details><summary>Fix</summary>

1. Remove the shadow from `save`. Only `findById`/`findByCustomer` (reads) may be shadow-compared.
2. Treat the write-path swap as what it is — a **data migration**, not a free comparison. Options: dual-write with an explicit reconciliation/backfill plan and the old store authoritative until cutover; or migrate reads first (validated by shadowing) and writes last with a deliberate consistency strategy.
3. **Prevention:** the rule is "shadow reads, never writes." The flag rolls back code, not data — see the write-path caveat in [professional.md](professional.md).
</details>

---

## Bug 5 — The leaky contract

The seam was supposed to hide the implementation, but the new impl is riddled with `instanceof`:

```java
public interface OrderRepository {
    Order findById(long id) throws SQLException;   // <-- old tech leaked into the contract
}

public class StorageEngineOrderRepository implements OrderRepository {
    @Override public Order findById(long id) throws SQLException {
        try { return client.fetch(id); }
        catch (StorageException e) { throw new SQLException(e); }  // faking JDBC errors!
    }
}

// client
try { repo.findById(id); }
catch (SQLException e) { if (e.getMessage().contains("ORA-")) retry(); }  // <-- Oracle-specific!
```

**Diagnose.** The seam leaks the *old* technology's accidents. The interface declares `throws SQLException`, forcing the new (non-JDBC) impl to wrap its native errors in a fake `SQLException`. Worse, a client branches on an Oracle error code string. The abstraction doesn't actually abstract — it codifies JDBC, so the "new" impl can never be clean and clients stay coupled to the old technology.

<details><summary>Fix</summary>

1. Redefine the contract in **semantic, technology-neutral** terms: `Order findById(long id)` throwing a domain exception like `OrderLookupException` (unchecked or a custom type), not `SQLException`.
2. Replace the client's `ORA-` string check with a meaningful signal (e.g., a `TransientFailureException` the contract defines, which each impl maps its native transient errors to).
3. **Prevention:** define the seam by *what clients semantically need*, not by mirroring the old class's signatures. If the interface mentions a specific technology's types, it's the wrong seam. See [senior.md](senior.md) on choosing the seam.
</details>

---

## Bug 6 — Abandoned migration, both impls half-alive

A scan of the codebase finds:

```java
PricingEngine pricing = flags.percentage("rules-pricing-v2", 40) ? new RulesPricingV2(...) : new LegacyPricing();
```

The flag has sat at 40% for eight months. `RulesPricingV2` has three `// TODO: handle bulk discounts` comments. The original author left the company.

**Diagnose.** The migration was started but never finished — stuck mid-Phase-4 indefinitely. 40% of traffic runs an *incomplete* implementation (the TODOs are real gaps), 60% runs the old one, the two have surely drifted over eight months, and nobody owns it. This is the worst-case economics: you pay the continuous coexistence cost *forever* and carry an unfinished impl in production. It has recreated the long-lived-branch problem in flag form.

<details><summary>Fix</summary>

Decide deliberately — don't leave it limping:
- **If the new impl is the right direction:** assign an owner, finish the TODOs, complete the validation, ramp to 100%, then do Phase 5 (delete old impl + flag). Set a hard completion date.
- **If it's not worth finishing:** *roll back* — flip to 0%, delete `RulesPricingV2` and the flag, keep `LegacyPricing`. A clean single implementation beats a perpetual half-migration.

**Prevention:** track migrations to completion like projects with a "done = Phase 5" definition and a flag expiry date; cap in-flight migrations per team. See [senior.md](senior.md) and [professional.md](professional.md). Never start a Branch by Abstraction you aren't resourced to finish.
</details>

---

## Next

- [optimize.md](optimize.md) — turn rough situations into the right phased plan.
- Back to [middle.md](middle.md) (pitfalls) · [professional.md](professional.md) (flag lifecycle, rollback) · [tasks.md](tasks.md)
