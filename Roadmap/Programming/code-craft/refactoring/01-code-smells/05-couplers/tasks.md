# Couplers — Practice Tasks

> 12 hands-on exercises across the four Couplers, with full solutions.

---

## Task 1 — Feature Envy (Java)

**Problem:** move the method to where it belongs.

```java
class Order {
    private List<LineItem> items;
    public List<LineItem> getItems() { return items; }
}

class LineItem {
    private BigDecimal unitPrice;
    private int quantity;
    public BigDecimal getUnitPrice() { return unitPrice; }
    public int getQuantity() { return quantity; }
}

class ReportGenerator {
    public BigDecimal totalForLine(LineItem item) {
        return item.getUnitPrice().multiply(BigDecimal.valueOf(item.getQuantity()));
    }
}
```

**Solution:**

```java
class LineItem {
    private BigDecimal unitPrice;
    private int quantity;
    
    public BigDecimal subtotal() {
        return unitPrice.multiply(BigDecimal.valueOf(quantity));
    }
}

// ReportGenerator no longer needs totalForLine — callers use item.subtotal().
```

---

## Task 2 — Hide Delegate for Message Chain (Java)

**Problem:** hide the chain.

```java
String city = customer.getCurrentOrder().getShippingAddress().getCity();
```

**Solution:**

```java
class Customer {
    public String shippingCity() {
        return currentOrder.shippingCity();
    }
}

class Order {
    public String shippingCity() {
        return shippingAddress.city();
    }
}

// Caller:
String city = customer.shippingCity();
```

---

## Task 3 — Remove Middle Man (Java)

**Problem:** the wrapper does pure forwarding.

```java
class CustomerWrapper {
    private final Customer customer;
    
    public String getName() { return customer.getName(); }
    public String getEmail() { return customer.getEmail(); }
    public String getPhone() { return customer.getPhone(); }
    public LocalDate getDob() { return customer.getDob(); }
    public String getCountry() { return customer.getCountry(); }
}
```

**Solution:** delete `CustomerWrapper`. Use `Customer` directly.

If the wrapper was meant to add behavior in the future, defer creation until that future arrives.

---

## Task 4 — Tell, Don't Ask (Python)

**Problem:** caller does the work.

```python
def withdraw(account, amount, audit_log):
    if account.balance >= amount:
        account.balance -= amount
        audit_log.record("withdraw", account.id, amount)
        return True
    return False
```

**Solution:**

```python
class Account:
    def withdraw(self, amount, audit_log) -> bool:
        if self.balance < amount:
            return False
        self.balance -= amount
        audit_log.record("withdraw", self.id, amount)
        return True

# Caller:
account.withdraw(100, audit_log)
```

---

## Task 5 — Inappropriate Intimacy via subclass (Java)

**Problem:** subclass reaches into parent's protected fields.

```java
abstract class Form {
    protected List<Field> fields = new ArrayList<>();
    protected Map<String, String> data = new HashMap<>();
    protected ValidationError currentError;
}

class LoginForm extends Form {
    public void submit() {
        // Direct field manipulation
        data.put("username", currentUser());
        data.put("token", generateToken());
        if (data.get("token") == null) {
            currentError = new ValidationError("token failed");
        }
    }
}
```

**Solution: composition + accessors.**

```java
class FormState {
    private final List<Field> fields = new ArrayList<>();
    private final Map<String, String> data = new HashMap<>();
    private ValidationError error;
    
    public void setField(String name, String value) { data.put(name, value); }
    public String getField(String name) { return data.get(name); }
    public void recordError(ValidationError e) { this.error = e; }
}

class LoginForm {
    private final FormState state;
    
    public LoginForm() { this.state = new FormState(); }
    
    public void submit() {
        state.setField("username", currentUser());
        state.setField("token", generateToken());
        if (state.getField("token") == null) {
            state.recordError(new ValidationError("token failed"));
        }
    }
}
```

The intimacy is gone — `LoginForm` uses `FormState` via methods, not direct fields.

---

## Task 6 — Move Method (Go)

**Problem:**

```go
type Order struct {
    Items []LineItem
}

type Calculator struct{}

func (c *Calculator) ComputeTotal(o *Order) float64 {
    total := 0.0
    for _, item := range o.Items {
        total += item.UnitPrice * float64(item.Quantity)
    }
    return total
}
```

**Solution:**

```go
type Order struct {
    Items []LineItem
}

func (o *Order) Total() float64 {
    total := 0.0
    for _, item := range o.Items {
        total += item.UnitPrice * float64(item.Quantity)
    }
    return total
}

// Calculator removed. Caller: order.Total()
```

---

## Task 7 — Demeter compliance (Java)

**Problem:** rewrite to comply with Demeter's law.

```java
class TaxCalculator {
    public BigDecimal calculate(Order order) {
        return order.getCustomer().getAddress().getCountry().getTaxRate().multiply(order.getSubtotal());
    }
}
```

**Solution:**

```java
class TaxCalculator {
    public BigDecimal calculate(Order order) {
        return order.taxRate().multiply(order.subtotal());
    }
}

class Order {
    public BigDecimal taxRate() { return customer.taxRate(); }
}

class Customer {
    public BigDecimal taxRate() { return address.taxRate(); }
}

class Address {
    public BigDecimal taxRate() { return country.getTaxRate(); }
}
```

Each level talks to its immediate neighbor. The chain is hidden behind the methods.

---

## Task 8 — Eliminate bidirectional intimacy (Python)

**Problem:**

```python
class Department:
    def __init__(self):
        self.employees = []
    
    def add(self, employee):
        self.employees.append(employee)
        employee._department = self  # ! reaches into employee
    
    def remove(self, employee):
        self.employees.remove(employee)
        employee._department = None

class Employee:
    def __init__(self):
        self._department = None
    
    def transfer_to(self, new_department):
        if self._department:
            self._department.employees.remove(self)  # ! reaches into department
        new_department.employees.append(self)
        self._department = new_department
```

**Solution: unidirectional + service.**

```python
class Department:
    def __init__(self):
        self.employees = []

class Employee:
    def __init__(self):
        pass  # no back-reference

class HRService:
    def transfer(self, employee, from_dept, to_dept):
        from_dept.employees.remove(employee)
        to_dept.employees.append(employee)
    
    def department_of(self, employee, all_departments):
        for d in all_departments:
            if employee in d.employees:
                return d
        return None
```

Each class has a clean responsibility. The `HRService` coordinates without intimate access.

---

## Task 9 — Refactor away Middle Man (Go)

**Problem:**

```go
type ClientWrapper struct {
    real *http.Client
}

func (w *ClientWrapper) Get(url string) (*http.Response, error) {
    return w.real.Get(url)
}

func (w *ClientWrapper) Post(url string, body io.Reader) (*http.Response, error) {
    return w.real.Post(url, "application/json", body)
}

func (w *ClientWrapper) Put(url string, body io.Reader) (*http.Response, error) {
    return w.real.Do(...)
}
// ... 10 more straight forwards
```

**Solution:** delete the wrapper. If you need to add behavior (like default headers), make a constructor:

```go
func NewClient() *http.Client {
    return &http.Client{
        Timeout: 30 * time.Second,
        Transport: &headerInjectingTransport{
            base: http.DefaultTransport,
            headers: map[string]string{"User-Agent": "MyApp/1.0"},
        },
    }
}
```

The "wrapper" is now configuration on `*http.Client` itself. No new type.

---

## Task 10 — Convert ask to tell (Java)

**Problem:**

```java
public boolean canSubmit(Order order) {
    if (order.getItems().isEmpty()) return false;
    if (order.getCustomer() == null) return false;
    if (order.getCustomer().getEmail() == null) return false;
    if (order.getTotal().compareTo(BigDecimal.ZERO) <= 0) return false;
    return true;
}
```

**Solution:**

```java
class Order {
    public boolean canBeSubmitted() {
        return !items.isEmpty()
            && customer != null
            && customer.hasEmail()
            && total.signum() > 0;
    }
}

class Customer {
    public boolean hasEmail() {
        return email != null && !email.isBlank();
    }
}
```

Each class encapsulates its own readiness check. Caller asks one question, not five.

---

## Task 11 — Identify the Couplers (Java)

**Problem:** find all Couplers in this code.

```java
class Cart {
    public List<Item> items;        // public!
    public Customer customer;
    
    public BigDecimal total;
}

class CheckoutHelper {
    public BigDecimal computeTotal(Cart cart) {
        BigDecimal total = BigDecimal.ZERO;
        for (Item item : cart.items) {
            total = total.add(item.price.multiply(BigDecimal.valueOf(item.qty)));
        }
        return total;
    }
    
    public String getCustomerCity(Cart cart) {
        return cart.customer.profile.address.city;
    }
    
    public boolean isVip(Cart cart) {
        return cart.customer.tier.value > 1000;
    }
}
```

**Solution:**

| Smell | Where |
|---|---|
| **Inappropriate Intimacy** | All fields on Cart are public; `CheckoutHelper` reaches in directly |
| **Feature Envy** | `computeTotal`, `isVip` operate on Cart's data — should be methods on Cart |
| **Message Chain** | `cart.customer.profile.address.city` |

**Cures combined:**

```java
class Cart {
    private final List<Item> items;
    private final Customer customer;
    
    public BigDecimal total() {
        return items.stream()
            .map(Item::subtotal)
            .reduce(BigDecimal.ZERO, BigDecimal::add);
    }
    
    public String shippingCity() {
        return customer.shippingCity();
    }
    
    public boolean isVip() {
        return customer.isVip();
    }
}

class Item {
    public BigDecimal subtotal() {
        return price.multiply(BigDecimal.valueOf(qty));
    }
}

class Customer {
    public String shippingCity() {
        return profile.shippingCity();
    }
    public boolean isVip() {
        return tier.isVip();
    }
}

// CheckoutHelper deleted (or reduced to genuine cross-class coordination).
```

---

## Task 12 — Architectural Coupler (System Design)

**Problem:** describe a service architecture and its Coupler smells.

```
[Web App] → [API Gateway] → [User Service] → [Profile Service] → [Database]
                                          ↓
                                   [Notification Service] → [Database]
                                                           ↓
                                                    [Audit Service]
```

The User Service makes 3 synchronous downstream calls per request. The Notification Service writes to its own DB and also calls Audit Service.

**Smells:**

- **Message Chain at architectural level:** API Gateway → User → Profile → DB is a 4-hop chain.
- **Inappropriate Intimacy if Notification & User share a database** (not stated, but a common anti-pattern).
- **Middle Man if API Gateway only forwards** without auth, rate-limit, or transformation.

**Cures:**

- **Reduce chain depth:** can the User Service include Profile data in its response by querying the DB directly? (If they're in the same bounded context.) Or, expose Profile data via events that User Service subscribes to.
- **Async the Audit:** Notification publishes an event; Audit subscribes. Notification's response time is no longer dependent on Audit.
- **Verify Gateway value-add:** if it does auth + rate-limiting, keep. If pure forwarding, cut.

After:

```
[Web App] → [API Gateway (auth, rate-limit)] → [User Service]
                                          ↓ events
                                   [Notification Service]
                                          ↓ events  
                                    [Audit Service]
```

Sync chain depth: 2. The rest is asynchronous.

---

> **Next:** [find-bug.md](find-bug.md) — bugs hiding in Coupler code.
