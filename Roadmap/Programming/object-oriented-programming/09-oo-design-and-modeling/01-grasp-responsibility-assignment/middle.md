# GRASP — Middle

> **What?** This file takes the nine patterns from `junior.md` and puts them to work on one running example — a point-of-sale (POS) checkout, the same domain Larman uses throughout *Applying UML and Patterns*. You'll watch each responsibility get assigned, defended, and occasionally re-assigned as the evaluators (Low Coupling, High Cohesion) push back.
> **How?** Design proceeds one responsibility at a time. For each, we name the candidate owner, the GRASP pattern that nominates it, and the evaluator check that confirms or vetoes it. By the end you'll have a feel for the *rhythm* of GRASP reasoning, which matters far more than memorising the nine names.

---

## 1. The running domain: a POS checkout

A cashier scans items into a sale, the system records line items, computes the total (with tax and discounts), takes a payment, and persists the receipt. The domain nouns: `Sale`, `SaleLineItem`, `Product` (a catalogue entry, here `ProductDescription`), `Payment`, `Register` (the terminal), `Store`.

We'll assign every interesting responsibility and show the GRASP reasoning out loud.

---

## 2. "Create a SaleLineItem" — Creator vs. a free-floating factory

A scan event produces a line item. Who creates it?

- **Candidate (Creator):** `Sale`, because it *aggregates* `SaleLineItem`s.
- **Evaluator (High Cohesion):** `Sale` already owns "the set of things bought in this sale", so adding a line is squarely its job.
- **Evaluator (Low Coupling):** the caller (a controller) only needs to know `Sale.addLineItem(...)`; it never touches `SaleLineItem`'s constructor.

```java
public class Sale {
    private final List<SaleLineItem> items = new ArrayList<>();

    // Creator: Sale aggregates line items, so Sale creates them.
    public void addLineItem(ProductDescription desc, int quantity) {
        items.add(new SaleLineItem(desc, quantity));
    }
}
```

Now contrast a case where Creator points *elsewhere*. Suppose a `Payment` needs an `AuthorizationCode` built by calling an external gateway with retry logic. `Payment` has the *initializing data* (amount, card) — Creator nominates it — but actually building the code involves network I/O and retries. High Cohesion vetoes putting that on `Payment`. The work goes to a Pure Fabrication, `PaymentGateway`. **Creator is the default; the evaluators decide when the default is wrong.**

---

## 3. "Compute the sale total" — Information Expert, applied recursively

Who computes `total()`? The data is split across three levels — `Sale` holds line items, each `SaleLineItem` holds quantity and a `ProductDescription`, each `ProductDescription` holds a price. Information Expert applies at *each* level, producing a chain of small experts:

```java
public record ProductDescription(String id, String name, BigDecimal price) {}

public class SaleLineItem {
    private final ProductDescription desc;
    private final int quantity;

    public SaleLineItem(ProductDescription desc, int quantity) {
        this.desc = desc; this.quantity = quantity;
    }
    // Expert: line item knows its quantity and its product's price.
    public BigDecimal subtotal() {
        return desc.price().multiply(BigDecimal.valueOf(quantity));
    }
}

public class Sale {
    private final List<SaleLineItem> items = new ArrayList<>();
    // Expert: Sale knows its line items, so it sums their subtotals.
    public BigDecimal total() {
        return items.stream()
                    .map(SaleLineItem::subtotal)
                    .reduce(BigDecimal.ZERO, BigDecimal::add);
    }
}
```

Notice the shape: `Sale.total()` doesn't reach into `SaleLineItem`'s internals — it asks each line item for its `subtotal()`, and each line item asks its `ProductDescription` for its `price()`. **Information Expert applied recursively produces a "do it yourself" object graph** where each object answers about its own data. This is also the Law of Demeter holding naturally (see [../../03-design-principles/03-law-of-demeter/](../../03-design-principles/03-law-of-demeter/)) — nobody reaches two dots deep into another object's fields.

---

## 4. "Handle the enterItem system event" — Controller

A system event — the cashier scanning an item — arrives from the UI. Who receives it?

GRASP's Controller pattern offers two flavours:

- **Facade controller:** one object representing the whole system or a root entity (`Register`, `Store`).
- **Use-case controller:** one object per use case (`ProcessSaleHandler`).

```java
// Use-case controller: handles all system events of "process sale".
public class ProcessSaleHandler {
    private final ProductCatalog catalog;
    private Sale currentSale;

    public ProcessSaleHandler(ProductCatalog catalog) { this.catalog = catalog; }

    public void makeNewSale()              { currentSale = new Sale(); }
    public void enterItem(String id, int qty) {
        ProductDescription desc = catalog.find(id);   // delegate lookup
        currentSale.addLineItem(desc, qty);           // delegate to the Sale
    }
    public BigDecimal endSale()            { return currentSale.total(); }
}
```

**Which flavour?** Larman's rule of thumb: use a facade controller when there are few system events; switch to use-case controllers when one facade would become bloated (low cohesion) or when different use cases need different state. The deciding evaluator is High Cohesion — if `Register` would handle *processSale* and *returnItem* and *closeRegister* and *manageInventory*, split it into use-case controllers.

The cardinal rule, regardless of flavour: **the controller delegates; it does not compute.** Every line in `enterItem` above is a delegation. The moment you see business arithmetic in a controller, cohesion has slipped.

---

## 5. "Apply a discount" — Polymorphism + Protected Variations together

Discounts vary: percentage off, buy-one-get-one, loyalty-tier, seasonal. This *will* change — Protected Variations says wrap it; Polymorphism says how.

```java
// Protected Variations: a stable interface around a volatile concept.
public interface DiscountStrategy {
    BigDecimal apply(Sale sale, BigDecimal subtotal);
}

// Polymorphism: each variation is its own type. Adding one edits nothing existing.
public final class PercentageDiscount implements DiscountStrategy {
    private final BigDecimal pct;
    public PercentageDiscount(BigDecimal pct) { this.pct = pct; }
    public BigDecimal apply(Sale sale, BigDecimal subtotal) {
        return subtotal.multiply(BigDecimal.ONE.subtract(pct));
    }
}
public final class NoDiscount implements DiscountStrategy {
    public BigDecimal apply(Sale sale, BigDecimal subtotal) { return subtotal; }
}
```

This is the GoF **Strategy** pattern — and that's the point: *GoF patterns are GRASP patterns made concrete.* Strategy = Polymorphism + Protected Variations + Pure Fabrication. The named GoF pattern is the recurring solution; the GRASP patterns are the *forces* that justify it. When a reviewer asks "why Strategy here?", the answer is "Protected Variations around discount logic, implemented via Polymorphism."

---

## 6. "Persist the sale" — Pure Fabrication and Indirection

Information Expert tempts you to put `save()` on `Sale` — it has the data. Low Coupling vetoes: `Sale` would couple to JDBC. So you fabricate:

```java
// Pure Fabrication: SaleRepository has no real-world counterpart.
// Indirection: it's an interface mediating between domain and database.
public interface SaleRepository {
    void save(Sale sale);
    Optional<Sale> findById(SaleId id);
}

public class JdbcSaleRepository implements SaleRepository {
    private final DataSource ds;
    public JdbcSaleRepository(DataSource ds) { this.ds = ds; }
    public void save(Sale sale) { /* all SQL coupling concentrated HERE */ }
    public Optional<Sale> findById(SaleId id) { /* ... */ }
}
```

Two patterns at once: **Pure Fabrication** (the `SaleRepository` concept is invented for design cleanliness) and **Indirection** (the interface mediates between `Sale` and the database driver so neither knows the other). This is also the **Repository** pattern from DDD — see [../../08-tactical-ddd/](../../08-tactical-ddd/) if that section is populated; the GRASP justification is what makes the pattern more than cargo-culting.

---

## 7. The evaluators are continuous, not pass/fail

A beginner reads "Low Coupling" as a binary gate. It isn't — it's a *gradient* you minimise. Consider three designs for "notify the customer":

```java
// Design A — tightest coupling: Sale calls the vendor SDK directly.
class Sale { void notifyCustomer() { TwilioApi.send(...); } }

// Design B — looser: an injected concrete Notifier.
class Sale { Sale(SmsNotifier n) {...}  void notifyCustomer() { n.send(...); } }

// Design C — loosest: an injected interface (Indirection + DIP).
class Sale { Sale(Notifier n) {...}  void notifyCustomer() { n.notify(...); } }
```

Each step lowers coupling — but it also adds indirection, which has its own cost (more types, more wiring, harder to follow). GRASP doesn't say "always pick C". It says *be aware of the coupling you're buying* and pay for indirection only where variation is predicted. For a one-off internal tool, B may be the right cost/benefit. For a system where the SMS vendor will surely change, C earns its keep.

---

## 8. How the nine patterns layer in a real design

Walking the POS example top-to-bottom, here's the order GRASP patterns typically fire:

| Step | Responsibility | Pattern(s) | Evaluator check |
| --- | --- | --- | --- |
| 1 | Receive `enterItem` | Controller | cohesion: one use case per handler |
| 2 | Create `SaleLineItem` | Creator | coupling: caller doesn't touch ctor |
| 3 | Compute `subtotal` / `total` | Information Expert (recursive) | cohesion: data + behaviour together |
| 4 | Vary discount logic | Polymorphism + Protected Variations | coupling: new types don't edit old |
| 5 | Persist the sale | Pure Fabrication + Indirection | coupling: domain ⊥ database |
| 6 | Talk to payment gateway | Pure Fabrication + Indirection | coupling: domain ⊥ vendor SDK |

The five "where does it go" patterns place responsibilities; the two evaluators veto bad placements; Indirection and Protected Variations install the boundaries the vetoes demand. **That loop — place, evaluate, decouple — is the entire method.**

---

## 9. GRASP vs. the frameworks you already use

Modern frameworks bake GRASP in, which is why they feel "right":

- **Spring `@Service` / `@Repository`** — Pure Fabrications, named.
- **Spring `@Controller` / `@RestController`** — the Controller pattern (keep them thin!).
- **JPA `EntityManager` / repositories** — Indirection + Pure Fabrication around persistence.
- **Strategy/Factory beans** — Polymorphism + Protected Variations wired by the container.
- **`@ConfigurationProperties`** — Protected Variations around configuration that varies per environment.

When you understand the GRASP reasoning, the framework annotations stop being magic and become *named instances of forces you can reason about*.

---

## 10. Quick rules

- [ ] Place a responsibility with a "where" pattern, then *immediately* check it against Low Coupling and High Cohesion.
- [ ] Controllers delegate; if a controller computes, cohesion has slipped — push logic to the experts.
- [ ] Information Expert applies recursively — build "do-it-yourself" object graphs, not god objects that reach into everyone's fields.
- [ ] When the expert would couple to infrastructure, fabricate a class (Repository/Service/Gateway).
- [ ] GoF patterns are GRASP patterns made concrete; cite the GRASP force, not just the pattern name.
- [ ] Buy Indirection only where variation is predicted — it has a real readability cost.

---

## 11. What's next

`senior.md` covers the tensions — when Information Expert and Low Coupling genuinely conflict, when Pure Fabrication tips into anemic domain, and the history that explains why GRASP and SOLID say overlapping things. `professional.md` turns this into review practice; `optimize.md` measures the coupling reductions; `find-bug.md` makes you spot misassignments cold.

---

**Memorize this:** GRASP design is a loop, not a checklist — **place** a responsibility with Information Expert / Creator / Controller / Polymorphism, **evaluate** it against Low Coupling and High Cohesion, and **decouple** with Pure Fabrication / Indirection / Protected Variations where the evaluators demand it. Every GoF pattern you reach for is that loop's recurring output.
