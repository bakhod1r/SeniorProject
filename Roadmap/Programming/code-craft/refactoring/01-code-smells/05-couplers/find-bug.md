# Couplers — Find the Bug

> 12 buggy snippets where Couplers hide bugs.

---

## Bug 1 — Message Chain NPE (Java)

```java
String city = customer.getOrder().getShippingAddress().getCity().toUpperCase();
```

If `customer` has no current order, `getOrder()` returns null. Or `getShippingAddress()` returns null for international orders. Or `getCity()` returns null. Result: NPE somewhere in the chain.

<details><summary>Diagnosis</summary>

The chain doesn't handle nulls. Each link assumes the previous returned non-null. The caller can't easily defend without `Optional` chaining.

**Fix:** Hide Delegate with `Optional`:

```java
class Customer {
    public Optional<String> shippingCity() {
        return Optional.ofNullable(currentOrder)
            .flatMap(Order::shippingAddressOptional)
            .map(Address::getCity);
    }
}

// Caller:
String city = customer.shippingCity().map(String::toUpperCase).orElse("UNKNOWN");
```

The Optional chain is still chain-like, but each step explicitly handles null. Or, defaults at the data layer ensure non-null:

```java
class Customer {
    private Order currentOrder = Order.EMPTY;  // null object
    public String shippingCity() {
        return currentOrder.shippingCity();  // EMPTY returns "UNKNOWN"
    }
}
```
</details>

---

## Bug 2 — Feature Envy bug (Java)

```java
class Order {
    public BigDecimal subtotal;
    public BigDecimal taxRate;
}

class TaxCalculator {
    public BigDecimal applyTax(Order order) {
        BigDecimal tax = order.subtotal.multiply(order.taxRate);
        order.subtotal = order.subtotal.add(tax);  // mutates!
        return order.subtotal;
    }
}

// Caller:
BigDecimal final1 = calculator.applyTax(order);
BigDecimal final2 = calculator.applyTax(order);  // calls again
// final2 != final1 — order.subtotal got tax applied twice
```

<details><summary>Diagnosis</summary>

`TaxCalculator` mutates `Order.subtotal` (Feature Envy + Inappropriate Intimacy). Calling twice double-applies tax. The bug is invisible because `order.subtotal` isn't named `subtotalIncludingTax` after the first call.

**Fix:** put tax computation on Order, return derived value, don't mutate.

```java
class Order {
    private final BigDecimal subtotal;
    private final BigDecimal taxRate;
    
    public BigDecimal totalIncludingTax() {
        return subtotal.add(subtotal.multiply(taxRate));
    }
}

// Caller calls totalIncludingTax() — pure function, idempotent.
```
</details>

---

## Bug 3 — Middle Man eats exception (Java)

```java
class StripeWrapper {
    private final Stripe stripe;
    
    public ChargeResult charge(BigDecimal amount, Card card) {
        try {
            return stripe.charge(amount, card);
        } catch (Exception e) {
            return ChargeResult.failure();  // swallows all exceptions
        }
    }
}
```

A bug in `Stripe.charge` (e.g., NetworkException) becomes "failure" — caller never knows what went wrong. Logs are silent.

<details><summary>Diagnosis</summary>

The Middle Man wrapper added "value" — exception swallowing — which destroys diagnostic information. Cure: don't swallow without logging; or just delete the wrapper entirely.

**Fix:**

```java
class StripeWrapper {
    private final Stripe stripe;
    
    public ChargeResult charge(BigDecimal amount, Card card) {
        try {
            return stripe.charge(amount, card);
        } catch (NetworkException e) {
            log.error("Stripe network failure", e);
            throw new ChargeFailedException("network", e);
        } catch (CardDeclinedException e) {
            return ChargeResult.declined(e.getReason());
        }
    }
}
```

Specific exceptions get specific handling. Network errors propagate; card declines become results. No silent swallowing.
</details>

---

## Bug 4 — Inappropriate Intimacy via shared mutable state (Python)

```python
class Cart:
    def __init__(self):
        self.items = []
        self.shared_state = {}

class Discount:
    def apply(self, cart):
        cart.shared_state["discount"] = self.calculate(cart)

class Tax:
    def apply(self, cart):
        discount = cart.shared_state.get("discount", 0)  # depends on Discount
        # ... applies tax minus discount
```

If `Tax.apply` runs before `Discount.apply`, tax is applied without discount. Order-dependent bug. The shared_state dict is implicit coupling.

<details><summary>Diagnosis</summary>

`Cart.shared_state` is intimate — `Discount` and `Tax` both reach into it, with implicit ordering requirements. Without ordering, bugs.

**Fix:** explicit pipeline, no shared mutable state:

```python
@dataclass(frozen=True)
class CartCalculation:
    subtotal: Decimal
    discount: Decimal
    tax: Decimal
    total: Decimal

def calculate_cart(cart):
    subtotal = sum_lines(cart.items)
    discount = compute_discount(subtotal, cart)
    taxable = subtotal - discount
    tax = compute_tax(taxable, cart)
    total = taxable + tax
    return CartCalculation(subtotal, discount, tax, total)
```

Each step is explicit; data flows linearly; no shared state.
</details>

---

## Bug 5 — Bidirectional association out of sync (Java)

```java
class Department {
    private List<Employee> employees = new ArrayList<>();
    
    public void add(Employee e) {
        employees.add(e);
        // forgot: e.setDepartment(this)
    }
}

class Employee {
    private Department department;
    
    public void setDepartment(Department d) { this.department = d; }
}

// Usage:
Employee alice = new Employee();
department.add(alice);

System.out.println(alice.getDepartment());  // null!
```

<details><summary>Diagnosis</summary>

Bidirectional intimacy — Department.add must keep Employee.department in sync, but doesn't. Employee thinks it has no department.

**Fix:** Change Bidirectional Association to Unidirectional. Either:

(a) Department owns the relationship; Employee.getDepartment() looks up via lookup service.
(b) Employee owns the relationship; Department.employees() is computed via filter.
(c) If both must be in sync, encapsulate the pair:

```java
class EmploymentRecord {
    private final Department department;
    private final Employee employee;
    
    public EmploymentRecord(Department d, Employee e) {
        this.department = d;
        this.employee = e;
    }
}

// All employment changes go through EmploymentRecord — both sides stay consistent.
```
</details>

---

## Bug 6 — Hidden chain breaks (Java)

```java
class Customer {
    public String getDeliveryCity() {
        return getCurrentOrder().getShippingAddress().getCity();
    }
}

// Test:
Customer c = new Customer();
c.getDeliveryCity();  // NPE — currentOrder is null
```

<details><summary>Diagnosis</summary>

Hide Delegate moved the chain into `Customer.getDeliveryCity()` but didn't add null safety. The chain still breaks; now the breakage is *inside* the abstraction.

**Fix:** the cure for Message Chain isn't just packaging — it must include null-safety:

```java
public Optional<String> getDeliveryCity() {
    return Optional.ofNullable(currentOrder)
        .flatMap(Order::shippingAddressOptional)
        .map(Address::getCity);
}
```

Or use Null Object pattern:

```java
private Order currentOrder = Order.NONE;  // Null Object

public String getDeliveryCity() {
    return currentOrder.shippingCity();  // NONE returns ""
}
```
</details>

---

## Bug 7 — Feature Envy bypasses validation (Java)

```java
class Account {
    public BigDecimal balance;  // public, mutable
    
    public boolean withdraw(BigDecimal amount) {
        if (balance.compareTo(amount) < 0) return false;
        balance = balance.subtract(amount);
        return true;
    }
}

class Helper {
    public void recharge(Account a, BigDecimal amount) {
        a.balance = a.balance.add(amount);  // bypasses any validation
        a.balance = a.balance.subtract(amount.multiply(new BigDecimal("0.01")));  // 1% fee
    }
}

// Bug: if amount is negative, balance goes down — but Helper allows it.
// Account.withdraw checks; Helper.recharge doesn't.
```

<details><summary>Diagnosis</summary>

Helper has Feature Envy — operates on Account's data. Helper bypasses Account's validation. Negative amounts → silent withdrawals.

**Fix:** Move Method to Account; encapsulate balance.

```java
class Account {
    private BigDecimal balance;  // private now
    
    public boolean withdraw(BigDecimal amount) {
        if (amount.signum() <= 0) throw new IllegalArgumentException();
        if (balance.compareTo(amount) < 0) return false;
        balance = balance.subtract(amount);
        return true;
    }
    
    public void recharge(BigDecimal amount) {
        if (amount.signum() <= 0) throw new IllegalArgumentException();
        BigDecimal fee = amount.multiply(new BigDecimal("0.01"));
        balance = balance.add(amount).subtract(fee);
    }
}
```

Validation happens once on Account; helpers can't bypass.
</details>

---

## Bug 8 — Inappropriate Intimacy via inheritance (Java)

```java
class BaseService {
    protected DataSource dataSource;
    protected ExecutorService executor;
    
    protected void init() {
        // setup
    }
}

class CustomerService extends BaseService {
    public Customer find(Long id) {
        // Uses dataSource directly (intimate)
        try (Connection c = dataSource.getConnection();
             PreparedStatement ps = c.prepareStatement("SELECT * FROM customers WHERE id = ?")) {
            ps.setLong(1, id);
            // ...
        } catch (SQLException e) { throw new RuntimeException(e); }
    }
}
```

Later, `BaseService.init` is changed to lazily initialize `dataSource`. `CustomerService.find` is called before `init` — NPE.

<details><summary>Diagnosis</summary>

Subclass intimately accesses parent's protected fields. Changes to parent's init order break subclasses unpredictably.

**Fix:** parent provides controlled access:

```java
class BaseService {
    private DataSource dataSource;  // private
    
    protected DataSource dataSource() {
        if (dataSource == null) initialize();
        return dataSource;
    }
}

class CustomerService extends BaseService {
    public Customer find(Long id) {
        try (Connection c = dataSource().getConnection(); ...) { ... }
    }
}
```

Subclass calls a method (which encapsulates initialization). Parent's internal lifecycle is hidden.

Better: use composition (BaseService not extended; injected as a collaborator).
</details>

---

## Bug 9 — Demeter cure misuses generics (Java)

```java
// Trying to hide a chain:
class Wrapper<T> {
    public <R> R chain(Function<T, R> fn) {
        return fn.apply(value);
    }
    private final T value;
}

// Usage:
Wrapper<Customer> w = new Wrapper<>(customer);
String city = w.chain(c -> c.getOrder().getAddress().getCity());
```

<details><summary>Diagnosis</summary>

Misguided "Hide Delegate" via generic chain. The chain is still inside the lambda; the wrapper provides no real abstraction. Worse, lambda capture issues and stack traces become harder to debug.

**Fix:** Hide Delegate is not "wrap everything in a generic." It's "add named methods at appropriate levels." The right fix is concrete delegate methods on `Customer` (like `customer.shippingCity()`), not a generic lambda runner.
</details>

---

## Bug 10 — Middle Man caching causes stale data (Java)

```java
class CachedUserRepository {
    private final UserRepository real;
    private final Map<Long, User> cache = new HashMap<>();
    
    public User findById(Long id) {
        return cache.computeIfAbsent(id, real::findById);
    }
    
    public User save(User user) {
        return real.save(user);
        // forgot: cache.put(user.getId(), user) or cache.remove(user.getId())
    }
}
```

After saving an updated user, future `findById` returns the stale cached version.

<details><summary>Diagnosis</summary>

The wrapper added caching (a real value-add), but inconsistently — read path uses cache, write path bypasses it. Bug.

**Fix:** invalidate on write.

```java
public User save(User user) {
    User saved = real.save(user);
    cache.put(saved.getId(), saved);
    return saved;
}

public void delete(Long id) {
    real.deleteById(id);
    cache.remove(id);
}
```

Or, better — use a real cache library (Caffeine, Guava) that handles invalidation properly.
</details>

---

## Bug 11 — Architectural Message Chain bug (Multi-service)

A chain of services: `OrderService → InventoryService → WarehouseService → StockDB`.

`OrderService` calls `InventoryService.reserve(itemId, qty)`.
`InventoryService` calls `WarehouseService.checkStock(itemId)`, then `WarehouseService.reserve(itemId, qty)`.
`WarehouseService` reads/writes `StockDB`.

A user places an order. `InventoryService.reserve` calls `checkStock` (returns 5 available). Before `reserve`, another user's request also calls `checkStock` (also returns 5). Both then call `reserve(qty=5)`. Both succeed. Inventory goes negative.

<details><summary>Diagnosis</summary>

Distributed Message Chain with race condition. The check-then-act pattern across services is non-atomic.

**Fix:** atomic operations.

(a) **Optimistic concurrency control** at WarehouseService: `reserve(itemId, qty, expectedAvailable)` — returns failure if available has changed.

(b) **Pessimistic locking** at StockDB: `SELECT ... FOR UPDATE` to lock the row during the reservation transaction.

(c) **Single-call** `tryReserve(itemId, qty)` at WarehouseService — returns success/failure atomically. The check-then-act becomes server-side atomic.

The chain itself isn't the bug; the *non-atomic check-then-act across the chain* is. Cure by making it atomic at the right level.
</details>

---

## Bug 12 — Tell, Don't Ask gone wrong (Java)

```java
class Email {
    private final String value;
    public Email(String value) {
        if (!isValid(value)) throw new IllegalArgumentException();
        this.value = value;
    }
    
    public boolean isValid() {  // also a method "for caller convenience"
        return isValid(value);
    }
    
    private static boolean isValid(String v) {
        return v != null && v.contains("@");
    }
}

// Caller:
Email email = new Email(input);  // throws if invalid
if (email.isValid()) {  // always true; constructor enforces
    // ...
}
```

<details><summary>Diagnosis</summary>

`Email.isValid()` is *always* true (constructor enforces validity). The method is dead code that confuses readers.

**Fix:** Tell, Don't Ask done right means *don't expose the question* if the answer is constant. Delete `isValid()`.

If the caller wants to attempt construction without throwing, provide a factory:

```java
public static Optional<Email> tryParse(String raw) {
    return isValid(raw) ? Optional.of(new Email(raw)) : Optional.empty();
}
```

Now the *question* is asked once, at the boundary; valid Email instances always exist.
</details>

---

> **Next:** [optimize.md](optimize.md) — inefficient cures.
