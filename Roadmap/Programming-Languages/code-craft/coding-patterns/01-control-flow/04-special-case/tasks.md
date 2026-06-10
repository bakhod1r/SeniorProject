# Special Case — Practice Tasks

> **Category:** [Control-Flow Patterns](../README.md) — return a dedicated object for a recurring exceptional condition instead of branching for it at every call site.

10 practice tasks with full Go, Java, Python solutions.

---

## Table of Contents

1. [Task 1: UnknownCustomer](#task-1-unknowncustomer)
2. [Task 2: MissingProduct in a Cart](#task-2-missingproduct-in-a-cart)
3. [Task 3: GuestUser Permissions](#task-3-guestuser-permissions)
4. [Task 4: Multiple Special Cases Behind One Interface](#task-4-multiple-special-cases)
5. [Task 5: Repository Returns the Special Case](#task-5-repository-returns-the-special-case)
6. [Task 6: Parameterized Special Case with Value Equality](#task-6-parameterized-special-case)
7. [Task 7: Refactor Sentinel Branches to Special Case](#task-7-refactor-sentinel-branches)
8. [Task 8: No-Op Writes on a Special Case](#task-8-no-op-writes)
9. [Task 9: Observable Special Case](#task-9-observable-special-case)
10. [Task 10: Sealed Hierarchy with Exhaustive Switch](#task-10-sealed-hierarchy)

---

## Task 1: UnknownCustomer

Return an `UnknownCustomer` that bills to "occupant" on the basic plan.

### Java

```java
public class Customer {
    private final String name;
    private final Plan plan;
    public Customer(String name, Plan plan) { this.name = name; this.plan = plan; }
    public String name()       { return name; }
    public Plan plan()         { return plan; }
    public boolean isUnknown() { return false; }
}

public final class UnknownCustomer extends Customer {
    public static final UnknownCustomer INSTANCE = new UnknownCustomer();
    private UnknownCustomer() { super("occupant", Plan.BASIC); }
    @Override public boolean isUnknown() { return true; }
}
```

### Python

```python
from dataclasses import dataclass

@dataclass(frozen=True)
class Customer:
    name: str
    plan: str
    @property
    def is_unknown(self) -> bool: return False

class UnknownCustomer(Customer):
    def __init__(self): super().__init__(name="occupant", plan="BASIC")
    @property
    def is_unknown(self) -> bool: return True

UNKNOWN_CUSTOMER = UnknownCustomer()
```

### Go

```go
type Customer interface {
    Name() string
    Plan() string
    IsUnknown() bool
}

type unknownCustomer struct{}

func (unknownCustomer) Name() string    { return "occupant" }
func (unknownCustomer) Plan() string    { return "BASIC" }
func (unknownCustomer) IsUnknown() bool { return true }

var Unknown Customer = unknownCustomer{}
```

---

## Task 2: MissingProduct in a Cart

A cart line for a removed SKU should render as "Unavailable item" at price 0.

### Python

```python
@dataclass(frozen=True)
class Product:
    sku: str
    name: str
    price: float

class MissingProduct(Product):
    def __init__(self, sku: str):
        super().__init__(sku=sku, name="Unavailable item", price=0.0)

def line_total(product: Product, qty: int) -> float:
    return product.price * qty   # 0 for MissingProduct, no branch
```

### Java

```java
public class Product {
    final String sku, name;
    final BigDecimal price;
    Product(String sku, String name, BigDecimal price) { this.sku = sku; this.name = name; this.price = price; }
}

public final class MissingProduct extends Product {
    public MissingProduct(String sku) { super(sku, "Unavailable item", BigDecimal.ZERO); }
}

BigDecimal lineTotal = product.price.multiply(BigDecimal.valueOf(qty));  // 0 if missing
```

---

## Task 3: GuestUser Permissions

A `GuestUser` has no permissions and the default locale.

### Go

```go
type User interface {
    DisplayName() string
    Can(action string) bool
    Locale() string
}

type guest struct{}

func (guest) DisplayName() string    { return "Guest" }
func (guest) Can(string) bool        { return false }   // no permissions
func (guest) Locale() string         { return "en-US" }

var Guest User = guest{}

// Caller never branches:
if currentUser.Can("delete") {
    delete()
}
```

### Python

```python
class GuestUser:
    display_name = "Guest"
    locale = "en-US"
    def can(self, _action: str) -> bool: return False

GUEST = GuestUser()
```

---

## Task 4: Multiple Special Cases Behind One Interface

Model `Subscription` as active, unknown, or suspended.

### Java

```java
public interface Subscription {
    String banner();
    boolean canStream();
}

public final class ActiveSubscription implements Subscription {
    private final LocalDate renews;
    public ActiveSubscription(LocalDate renews) { this.renews = renews; }
    public String banner()     { return "Renews " + renews; }
    public boolean canStream() { return true; }
}

public final class UnknownSubscription implements Subscription {
    public static final UnknownSubscription INSTANCE = new UnknownSubscription();
    private UnknownSubscription() {}
    public String banner()     { return "Subscribe to start watching"; }
    public boolean canStream() { return false; }
}

public final class SuspendedSubscription implements Subscription {
    private final String reason;
    public SuspendedSubscription(String reason) { this.reason = reason; }
    public String banner()     { return "On hold: " + reason; }
    public boolean canStream() { return false; }
}
```

---

## Task 5: Repository Returns the Special Case

Centralize the decision so callers never branch.

### Go

```go
func (r *Repo) Find(userID string) Subscription {
    row, ok := r.db[userID]
    switch {
    case !ok:
        return UnknownSubscription
    case row.Status == StatusHold:
        return suspended{reason: row.HoldReason}
    default:
        return active{renews: row.RenewsOn}
    }
}
```

### Python

```python
def find(user_id: str) -> Subscription:
    row = db.get(user_id)
    if row is None:           return UNKNOWN_SUBSCRIPTION
    if row.status == "HOLD":  return SuspendedSubscription(row.hold_reason)
    return ActiveSubscription(row.renews_on)
```

---

## Task 6: Parameterized Special Case with Value Equality

Two `MissingProduct`s for different SKUs must compare unequal.

### Python

```python
@dataclass(frozen=True)   # frozen dataclass gives value equality + hashability
class MissingProduct:
    sku: str
    name: str = "Unavailable item"
    price: float = 0.0

assert MissingProduct("a") != MissingProduct("b")   # distinct SKUs
assert MissingProduct("a") == MissingProduct("a")
```

### Java

```java
public record MissingProduct(String sku) implements ProductView {
    public String name()       { return "Unavailable item"; }
    public BigDecimal price()  { return BigDecimal.ZERO; }
    // record gives equals()/hashCode() by sku automatically
}
```

---

## Task 7: Refactor Sentinel Branches to Special Case

### Before (Java)

```java
Customer c = repo.find(id);                       // may be null
String name = (c == null) ? "occupant" : c.name();
Plan plan   = (c == null) ? Plan.BASIC  : c.plan();
boolean tax = (c == null) ? false       : c.isTaxExempt();
```

### After

```java
// Repository:
public Customer find(String id) {
    Row r = db.query(id);
    return (r == null) ? UnknownCustomer.INSTANCE : new Customer(r.name(), r.plan());
}

// Call site — branches gone:
Customer c = repo.find(id);
String name = c.name();        // "occupant" if unknown
Plan plan   = c.plan();        // BASIC
boolean tax = c.isTaxExempt(); // false
```

---

## Task 8: No-Op Writes on a Special Case

Writes against an unknown customer must refuse, not silently drop.

### Python

```python
class UnknownCustomer:
    name = "occupant"
    plan = "BASIC"
    is_unknown = True

    def change_email(self, _new: str) -> None:
        raise PermissionError("cannot modify an unknown customer")
```

### Go

```go
type unknownCustomer struct{}

func (unknownCustomer) ChangeEmail(string) error {
    return errors.New("cannot modify an unknown customer")
}
```

---

## Task 9: Observable Special Case

Count special-case returns so they can't silently mask corruption.

### Java

```java
public Customer find(String id) {
    Row r = db.query(id);
    if (r == null) {
        metrics.counter("customer.unknown").increment();   // alert on spikes
        return UnknownCustomer.INSTANCE;
    }
    return new Customer(r.name(), r.plan());
}
```

### Python

```python
def find(customer_id: str) -> Customer:
    row = db.get(customer_id)
    if row is None:
        metrics.incr("customer.unknown")
        return UNKNOWN_CUSTOMER
    return Customer(row.name, row.plan)
```

---

## Task 10: Sealed Hierarchy with Exhaustive Switch

Use a closed hierarchy so adding a case breaks non-exhaustive switches.

### Java (17+)

```java
public sealed interface Shipment
        permits Pending, InTransit, Delivered, Unknown {
    String eta();
}

public record Unknown() implements Shipment {
    public String eta() { return "No tracking available"; }
}

// Default caller — works for Unknown too:
label.setText(shipment.eta());

// Branching caller — compiler enforces all cases:
Color color = switch (shipment) {
    case Pending p   -> GRAY;
    case InTransit t -> BLUE;
    case Delivered d -> GREEN;
    case Unknown u   -> LIGHT_GRAY;
};
```

### Python (`match`)

```python
match shipment:
    case Pending():   color = "gray"
    case InTransit(): color = "blue"
    case Delivered(): color = "green"
    case Unknown():   color = "lightgray"
    case _:           raise AssertionError("unhandled shipment type")
```

---

## Practice Tips

1. **Share stateless special cases** as singletons — don't allocate per call.
2. **Name by meaning** (`GuestUser`, `MissingProduct`), never `NullX`.
3. **Centralize the decision** in the repository/factory.
4. **Make writes refuse**, not silently no-op, unless a no-op is genuinely correct.
5. **Instrument** special-case returns to catch corruption masquerading as "unknown."

---

[← Interview](interview.md) · [Control Flow](../README.md) · [Roadmap](../../../README.md) · **Next:** [Find-Bug](find-bug.md)
