# Refactoring Toward Structural Patterns — Middle Level

> **Source:** Joshua Kerievsky, *Refactoring to Patterns* (Addison-Wesley, 2004); [refactoring.guru/design-patterns/structural-patterns](https://refactoring.guru/design-patterns/structural-patterns)

The [junior file](junior.md) covered the two flagship structural refactorings (Decorator, Composite) on a single class. This file handles the cases that span **multiple** classes or **multiple** APIs: a uniformity smell where single-vs-collection is special-cased everywhere, duplicated tree code across siblings, and the two faces of Adapter. For each, the question is not "is the pattern nice?" but "does this refactoring pay for itself *here*?"

---

## Contents

- [Replace One/Many Distinctions with Composite](#replace-onemany-distinctions-with-composite)
- [Extract Composite](#extract-composite)
- [Extract Adapter](#extract-adapter)
- [Unify Interfaces with Adapter](#unify-interfaces-with-adapter)
- [Decision: Decorator vs. subclassing](#decision-decorator-vs-subclassing)
- [Decision: Adapter vs. rewriting the client](#decision-adapter-vs-rewriting-the-client)
- [Next](#next)

---

## Replace One/Many Distinctions with Composite

> Pattern reference: [Composite](../../../design-patterns/02-structural/03-composite/junior.md).

### Starting smell

A class supports both a *single* thing and a *collection* of things, and every method has two code paths — one for the singular case, one for the plural. The two paths drift apart over time.

```java
// SMELL: every method forks on "one product" vs "many products"
public class Order {
    private Product singleProduct;          // set when ordering one
    private List<Product> products;         // set when ordering many

    public BigDecimal total() {
        if (products != null) {
            BigDecimal sum = BigDecimal.ZERO;
            for (Product p : products) sum = sum.add(p.price());
            return sum;
        } else {
            return singleProduct.price();
        }
    }

    public boolean containsRestricted() {
        if (products != null) {
            return products.stream().anyMatch(Product::isRestricted);
        } else {
            return singleProduct.isRestricted();
        }
    }
    // ...and so on, every method doubled
}
```

### Motivation

The "one" case is just the "many" case with one element. The fork exists only because someone optimized the common single-item path early and then had to keep both alive. Each new method pays the doubling tax, and the two branches can disagree (a bug fixed in the plural path but not the singular).

The cure: make the **single** item satisfy the **same interface** as a collection, so callers stop distinguishing. A leaf (one `Product`) and a composite (a group of products) both answer `price()` and `isRestricted()`.

### Mechanical steps

1. **Pick the unifying interface.** It's whatever clients actually call — `price()`, `isRestricted()`. Name it `LineItem`.
2. **Make the singular type implement it.** `Product implements LineItem` — it's the leaf.
3. **Create the composite.** `ProductGroup implements LineItem`, holding `List<LineItem>`; its `price()` sums children, `isRestricted()` ORs children.
4. **Collapse the fork.** Replace the two fields (`singleProduct`, `products`) with **one** `LineItem root`. Each `Order` method now calls `root.price()` — no branching.
5. **Migrate construction.** Ordering one product stores the `Product` directly as the root; ordering many wraps them in a `ProductGroup`.
6. **Run tests** for both the one-item and many-item paths; outputs must match.
7. **Delete the dead singular branches.**

### After

```java
public interface LineItem {
    BigDecimal price();
    boolean isRestricted();
}

public class Product implements LineItem { /* leaf: returns own price/flag */ }

public class ProductGroup implements LineItem {
    private final List<LineItem> items = new ArrayList<>();
    public void add(LineItem item) { items.add(item); }
    @Override public BigDecimal price() {
        return items.stream().map(LineItem::price)
                    .reduce(BigDecimal.ZERO, BigDecimal::add);
    }
    @Override public boolean isRestricted() {
        return items.stream().anyMatch(LineItem::isRestricted);
    }
}

public class Order {
    private final LineItem root;            // ONE field, no fork
    public Order(LineItem root) { this.root = root; }
    public BigDecimal total() { return root.price(); }
    public boolean containsRestricted() { return root.isRestricted(); }
}
```

A single product and a group are now interchangeable, and `Order`'s methods are one line each. Nesting falls out for free: a `ProductGroup` can contain another `ProductGroup`.

### When NOT to

- **The single and many cases genuinely differ.** If ordering one product triggers different *business* behavior (different tax, different shipping) than ordering many, the fork encodes a real rule, not accidental duplication. Don't erase it.
- **The collection is never nested and never empty.** If "many" is always a flat, non-empty list, a plain `List<Product>` with helper methods may be clearer than a Composite that advertises recursion you never use.

---

## Extract Composite

> Pattern reference: [Composite](../../../design-patterns/02-structural/03-composite/junior.md).

### Starting smell

Two or more sibling classes **each** implement their own child-management and tree-traversal code, and that code is nearly identical. The duplication is a *Duplicated Code* smell (see [dispensables](../../01-code-smells/04-dispensables/junior.md)) located specifically in tree plumbing.

```java
// SMELL: two siblings duplicate the same children-handling code
public class Department {
    private final List<Department> subDepartments = new ArrayList<>();
    public void add(Department d) { subDepartments.add(d); }
    public int headcount() {
        int n = directStaff();
        for (Department d : subDepartments) n += d.headcount();
        return n;
    }
    protected int directStaff() { /* ... */ return 0; }
}

public class Project {
    private final List<Project> subProjects = new ArrayList<>();   // SAME plumbing
    public void add(Project p) { subProjects.add(p); }
    public int totalTasks() {
        int n = directTasks();
        for (Project p : subProjects) n += p.totalTasks();          // SAME shape
        return n;
    }
    protected int directTasks() { /* ... */ return 0; }
}
```

### Motivation

`Department` and `Project` are different *domains*, but their tree machinery — the children list, `add`, the "sum my own + recurse over children" loop — is the same. That machinery is what a Composite encapsulates. Extracting it removes the duplication and gives both a tested, single place for tree logic.

### Mechanical steps

1. **Find the common tree operations.** Both have: a children list, `add`, and an aggregate-over-children method.
2. **Create an abstract Composite superclass**, parameterized over the node type. It owns `List<T> children`, `add`, and a *template* aggregation method that calls an abstract `ownContribution()`.
3. **Pull up the children list and `add`** from each sibling into the superclass. Delete the duplicated fields.
4. **Pull up the recursive aggregation**, expressing the per-node part via the abstract hook each subclass overrides.
5. **Run tests** after each pull-up; behavior must not change.
6. **Reduce subclasses to their domain difference** (`directStaff` vs `directTasks`).

### After

```java
// Extracted Composite superclass: tree plumbing lives once
public abstract class CompositeNode<T extends CompositeNode<T>> {
    private final List<T> children = new ArrayList<>();
    public void add(T child) { children.add(child); }

    // Template aggregation: shared recursion, abstract per-node hook
    public int aggregate() {
        int sum = ownContribution();
        for (T child : children) sum += child.aggregate();
        return sum;
    }
    protected abstract int ownContribution();
}

public class Department extends CompositeNode<Department> {
    @Override protected int ownContribution() { return directStaff(); }
    private int directStaff() { /* ... */ return 0; }
}

public class Project extends CompositeNode<Project> {
    @Override protected int ownContribution() { return directTasks(); }
    private int directTasks() { /* ... */ return 0; }
}
```

The recursive walk and child storage now exist **once**. A bug fixed there is fixed for both; a third tree-shaped class costs only an `ownContribution()`.

### When NOT to

- **The "duplication" is shallow.** If the two siblings only *look* similar but their traversal semantics differ (one needs pre-order, one post-order; one short-circuits, one doesn't), forcing a shared superclass creates a leaky abstraction riddled with hooks. Two clear classes beat one tangled base.
- **Inheritance is already overloaded.** If `Department` and `Project` need *different* superclasses for other reasons, extracting a Composite *base* fights single-inheritance. Prefer composition: extract a `TreeStructure<T>` helper object both classes *hold*, rather than *extend*.

---

## Extract Adapter

> Pattern reference: [Adapter](../../../design-patterns/02-structural/01-adapter/junior.md).

### Starting smell

One class adapts to **several** external APIs or versions, switching on a flag or version field inside many methods. It has become a polyglot translator with a `switch` at the top of everything.

```java
// SMELL: one class juggles multiple library versions via conditionals
public class PaymentClient {
    private final String version;           // "v1" or "v2"
    private final LegacyGateway v1;
    private final ModernGateway v2;

    public PaymentClient(String version, LegacyGateway v1, ModernGateway v2) {
        this.version = version; this.v1 = v1; this.v2 = v2;
    }

    public String charge(int cents) {
        if (version.equals("v1")) {
            return v1.doPayment(cents / 100.0);            // dollars
        } else {
            return v2.submitCharge(cents).getReference();  // cents + object result
        }
    }

    public boolean refund(String ref) {
        if (version.equals("v1")) {
            return v1.reverse(ref) == 0;
        } else {
            return v2.refundCharge(ref).isOk();
        }
    }
}
```

### Motivation

Each `if (version...)` repeats the same branch shape, and the two gateways' quirks (dollars vs. cents, return-code vs. result-object) bleed into every method. Adding a third gateway multiplies the conditionals. The fix is **one Adapter per adaptee**: each adapter speaks the *client's* interface and hides one library's quirks behind it. The version flag disappears — polymorphism replaces it.

### Mechanical steps

1. **Define the target interface** the client wants: `Gateway { String charge(int cents); boolean refund(String ref); }`.
2. **Create one adapter per version.** `LegacyGatewayAdapter implements Gateway`, wrapping `LegacyGateway` and translating cents↔dollars and codes↔booleans. `ModernGatewayAdapter` does the same for v2.
3. **Move each conditional branch into its adapter.** The `v1` branch of `charge()` becomes the body of `LegacyGatewayAdapter.charge()`.
4. **Replace the flag with the interface.** `PaymentClient` now holds a single `Gateway` and calls it directly — no `version` field, no `if`.
5. **Run tests** for each version; behavior identical.
6. **Choose the adapter at construction**, not inside the methods.

### After

```java
public interface Gateway {
    String charge(int cents);
    boolean refund(String ref);
}

public class LegacyGatewayAdapter implements Gateway {
    private final LegacyGateway adaptee;
    public LegacyGatewayAdapter(LegacyGateway adaptee) { this.adaptee = adaptee; }
    @Override public String charge(int cents) { return adaptee.doPayment(cents / 100.0); }
    @Override public boolean refund(String ref) { return adaptee.reverse(ref) == 0; }
}

public class ModernGatewayAdapter implements Gateway {
    private final ModernGateway adaptee;
    public ModernGatewayAdapter(ModernGateway adaptee) { this.adaptee = adaptee; }
    @Override public String charge(int cents) { return adaptee.submitCharge(cents).getReference(); }
    @Override public boolean refund(String ref) { return adaptee.refundCharge(ref).isOk(); }
}

public class PaymentClient {
    private final Gateway gateway;          // no version flag anywhere
    public PaymentClient(Gateway gateway) { this.gateway = gateway; }
    public String charge(int cents) { return gateway.charge(cents); }
    public boolean refund(String ref) { return gateway.refund(ref); }
}
```

### When NOT to

- **Only one adaptee, and it's stable.** If there's a single external API with no versions, you may not need an Adapter object at all — a couple of private translation methods suffice. Don't manufacture a flag-free design for a problem with no flags.
- **The branches share heavy logic.** If the per-version code is 90% identical and only 10% differs, an Adapter per version duplicates the 90%. Consider a template method or a small strategy for just the differing 10% instead.

---

## Unify Interfaces with Adapter

The other use of Adapter: not picking among versions, but making **one** existing class fit an interface a client demands — without changing the class (you may not own it) and without changing the client.

### Starting smell

```java
// Client is written against this interface:
interface DataSource { byte[] read(); }

// But the only available class offers a different shape:
class S3Blob { byte[] fetchObject(String key) { /* ... */ return new byte[0]; } }
```

You cannot make the client call `fetchObject`, and you cannot rename `S3Blob`'s method (third-party). Bridge the gap with an Adapter.

### Mechanical steps

1. **Write an adapter implementing the client interface** (`DataSource`).
2. **Hold the adaptee** (`S3Blob`) and any fixed parameters (the key) as fields.
3. **Implement each target method** by translating to the adaptee's API.
4. **Inject the adapter** where the client expected a `DataSource`.

```java
public class S3DataSource implements DataSource {
    private final S3Blob blob;
    private final String key;
    public S3DataSource(S3Blob blob, String key) { this.blob = blob; this.key = key; }
    @Override public byte[] read() { return blob.fetchObject(key); }
}
```

Now `S3Blob` satisfies `DataSource` with neither side modified.

### When NOT to

- **You own both sides and they'll converge.** If you control the client *and* the class, and the interfaces will permanently align, just refactor one to match the other. An Adapter that exists only to paper over a name you could rename is dead weight — that is exactly what [Refactoring Away From Patterns](../05-refactoring-away-from-patterns/junior.md) would later remove.

---

## Decision: Decorator vs. subclassing

Both add behavior to a component. Choose by these axes:

| Question | Lean Decorator | Lean Subclassing |
| --- | --- | --- |
| Do behaviors **combine** in many orders/counts? | Yes — `N` decorators give `2^N` combos with `N` classes | No — fixed combos |
| Must behavior be added/removed **at runtime**? | Yes — wrap/unwrap dynamically | No — type fixed at compile time |
| Is the combination **closed and small**? | — | Yes — one subclass per combo is fine |
| Do you need to override **structure**, not just behavior? | No — decorator can't change the type | Yes — subclass can add fields/methods |

The classic trap subclassing falls into is **class explosion**: `WindowWithBorder`, `WindowWithScrollbar`, `WindowWithBorderAndScrollbar`... Decorator turns that multiplicative blow-up into additive layers. But Decorator can't be the answer when callers need to *downcast to a richer type* — wrapping hides the concrete type behind the component interface.

---

## Decision: Adapter vs. rewriting the client

When a client and a class don't fit, you have two moves: insert an **Adapter**, or **rewrite the client** to call the class directly.

- **Adapter when:** you don't own the class (third-party), the mismatch is local, multiple adaptees must look alike, or you want to keep the client testable against a clean interface.
- **Rewrite the client when:** you own both sides, there is exactly one adaptee, the interfaces will stay aligned, and the Adapter would only add a layer of indirection with no second implementation behind it. An Adapter justifies itself when there's *more than one* thing on its far side — or a real ownership boundary it crosses.

---

## Next

- [junior.md](junior.md) — Decorator and Composite basics; smell→refactoring table.
- [senior.md](senior.md) — Composite + Visitor, Decorator ordering & invariants, Bridge, Proxy, Flyweight; interface design.
- [professional.md](professional.md) — Performance & memory of structural indirection.
- [interview.md](interview.md) — Interview Q&A.
- [tasks.md](tasks.md) — Hands-on exercises.
- [find-bug.md](find-bug.md) — Diagnose broken structural patterns.
- [optimize.md](optimize.md) — Propose (or reject) structural refactorings.
