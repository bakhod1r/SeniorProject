# Couplers — Middle Level

> Real-world cases, trade-offs, and when *not* to refactor.

---

## Table of Contents

1. [Why Couplers happen](#why-couplers-happen)
2. [Real-world cases for Feature Envy](#real-world-cases-for-feature-envy)
3. [Real-world cases for Inappropriate Intimacy](#real-world-cases-for-inappropriate-intimacy)
4. [Real-world cases for Message Chains](#real-world-cases-for-message-chains)
5. [Real-world cases for Middle Man](#real-world-cases-for-middle-man)
6. [Demeter's Law in practice](#demeters-law-in-practice)
7. [Tell, Don't Ask](#tell-dont-ask)
8. [When to keep loose vs tight coupling](#when-to-keep-loose-vs-tight-coupling)
9. [Comparison with related smells](#comparison-with-related-smells)
10. [Review questions](#review-questions)

---

## Why Couplers happen

### 1. Anemic Domain Model

When data classes have no behavior, all the work has to happen elsewhere — services that reach into the data. Feature Envy emerges.

### 2. Layered architectures pushed too far

Strict separation between "model" and "service" forces every operation across boundaries. Methods in services live a layer away from the data they touch. Each operation envies the model.

### 3. Refactoring debt

A class was once cohesive; it grew. Now half its responsibilities still live in helpers from when it was smaller. Helpers reach in via getters — Feature Envy or Inappropriate Intimacy.

### 4. Over-eager Hide Delegate

A team aggressively adds delegate methods (`person.getDepartmentName()`) to avoid Message Chains. Years later, the wrapper has hundreds of forwards — Middle Man.

---

## Real-world cases for Feature Envy

### Case 1 — Service classes drowning in getters

A `OrderService` with 30 methods, each starting with `order.getX(); order.getY(); order.getZ();` then doing computations.

**Cure:** Move the computations onto Order. Often: 30 methods reduce to 10 meaningful service methods, the rest moved.

### Case 2 — Reporter classes

```java
class CustomerReporter {
    public String formatName(Customer c) { return c.getFirst() + " " + c.getLast(); }
    public int age(Customer c) { return Period.between(c.getDob(), now()).getYears(); }
    public String label(Customer c) { return formatName(c) + " (" + age(c) + ")"; }
}
```

All these methods belong on `Customer`. The Reporter is a facade — but it's a Feature Envy facade. Move methods to Customer; delete the Reporter.

### Case 3 — When Feature Envy is justified

A `PaymentProcessor` that operates on multiple data types (`Card`, `Order`, `Customer`):

```java
boolean canCharge(Card card, Order order, Customer customer) {
    return card.isValid()
        && order.totalsValid()
        && customer.isInGoodStanding()
        && card.getRiskScore() + order.getRiskScore() + customer.getRiskScore() < THRESHOLD;
}
```

The method coordinates *three* objects equally. It belongs on neither Card, Order, nor Customer — it's a coordinator. Leave on `PaymentProcessor`.

> **Rule:** the destination of a Move Method should be the class whose data is *primarily* used. If the method uses 3+ classes' data equally, no single class deserves it.

---

## Real-world cases for Inappropriate Intimacy

### Case 1 — Manager + helper duo

`OrderManager` and `OrderUtils` reach into each other's package-private state to coordinate an operation. Refactoring `OrderManager` breaks `OrderUtils` and vice versa.

**Cure:** consolidate — they're really one concept split into two for stylistic reasons. Inline OrderUtils into OrderManager.

### Case 2 — Subclass over-coupled to parent

```java
class BasePage {
    protected String title;
    protected List<Section> sections;
    protected Map<String, Object> attributes;
    protected User currentUser;
}

class CheckoutPage extends BasePage {
    public void render() {
        this.title = "Checkout";
        this.sections.add(...);
        this.attributes.put(...);
        // accesses 4 protected fields directly
    }
}
```

The subclass reaches into 4 protected fields. Each is mutable. Tight coupling.

**Cure:** make fields private with proper setters/getters; or use composition (CheckoutPage *has* a Page, not *is* a Page).

### Case 3 — Bidirectional association

```java
class Department {
    List<Employee> employees;
    public void addEmployee(Employee e) {
        employees.add(e);
        e.setDepartment(this);  // mutual reference
    }
}

class Employee {
    Department department;
    public void setDepartment(Department d) {
        if (this.department != null) {
            this.department.employees.remove(this);  // intimate access
        }
        this.department = d;
    }
}
```

Both sides need to maintain consistency; both reach into each other.

**Cure:** Change Bidirectional Association to Unidirectional — keep only one side, derive the other when needed (e.g., Department has employees; Employee.department() does a lookup).

---

## Real-world cases for Message Chains

### Case 1 — UI navigation

```javascript
// Bad
document.getElementById("form")
        .querySelector(".section.checkout")
        .querySelector("input[name=email]")
        .value
```

The path is fragile — any HTML restructuring breaks it.

**Cure:** named accessors that hide the path:

```javascript
// In a CheckoutForm wrapper:
class CheckoutForm {
    get email() {
        return this.element.querySelector("input[name=email]").value;
    }
}

// Caller:
checkoutForm.email
```

### Case 2 — Domain model navigation

```java
order.getCustomer().getDefaultAddress().getCity().getCountry().getTaxRules().applyTo(amount)
```

5 chained calls. Likely a `null` lurking somewhere — and impossibly fragile.

**Cure:** build up named methods at appropriate levels:

```java
class Order {
    public BigDecimal applyTax(BigDecimal amount) {
        return customer.applyTax(amount);
    }
}

class Customer {
    public BigDecimal applyTax(BigDecimal amount) {
        return defaultAddress.applyTax(amount);
    }
}

// Caller:
order.applyTax(amount);
```

Each link hides the next. The chain becomes a delegation tree.

### Case 3 — When the chain is OK

```java
// LINQ-style streams in Java 8+
list.stream()
    .filter(x -> x.isActive())
    .map(Customer::getName)
    .sorted()
    .collect(toList());
```

Each call returns the same stream; the chain is the API. Not a smell.

---

## Real-world cases for Middle Man

### Case 1 — Service wrapper with no value

```java
class CustomerService {
    private final CustomerRepository repo;
    
    public Customer getById(Long id) { return repo.findById(id).orElse(null); }
    public List<Customer> getAll() { return repo.findAll(); }
    public Customer save(Customer c) { return repo.save(c); }
    public void delete(Long id) { repo.deleteById(id); }
}
```

`CustomerService` only forwards. Why does it exist? Sometimes "because we need a service layer." That's the smell — the layer adds nothing.

**Cure:** delete `CustomerService`. Have controllers use `CustomerRepository` directly. *Or*: add the value the service should add (validation, caching, business rules) and keep it.

### Case 2 — Wrapping an external library

```java
class OurHttpClient {
    private final ApacheHttpClient apache;
    
    public Response get(String url) { return apache.get(url); }
    public Response post(String url, byte[] body) { return apache.post(url, body); }
    public Response put(String url, byte[] body) { return apache.put(url, body); }
    // ... 20 more straight forwards
}
```

Pure pass-through. The Apache client is fine on its own.

**Cure:** delete the wrapper. *Or*: if the goal was "isolate from a library we may swap," that's a real value-add — but verify the goal is real (have you ever swapped HTTP clients?). If yes, accept the wrapper. If not, delete.

### Case 3 — Legitimate facades

```java
class PaymentFacade {
    private final StripeApi stripe;
    private final PaypalApi paypal;
    private final InternalLedger ledger;
    private final FraudDetection fraud;
    
    public PaymentResult charge(Money amount, Card card) {
        // Coordinate fraud check, route to provider, record in ledger
        // 30 lines of orchestration
    }
}
```

This is a *real* facade — it simplifies a complex subsystem. Each method has logic. Not a Middle Man smell.

---

## Demeter's Law in practice

"Talk only to your immediate friends." A method should call:

1. Itself.
2. Its fields.
3. Its parameters.
4. Objects it created locally.

Not: friends-of-friends, parameters-of-parameters' children, etc.

### Strict vs pragmatic

A *strict* application forbids `a.b.c` chains entirely. *Pragmatic* application focuses on object navigation: `a.getCustomer().getName()` is a chain through someone else's object; `stream.filter().map()` is a fluent API on an immutable.

### Builder + Demeter

Builders look like Demeter violations (`builder.setX().setY().setZ().build()`) but are explicitly designed for chaining. The chained type is the same builder, not a navigation through different objects.

### Java records and Demeter

Java records expose components: `point.x()`, `point.y()`. Calling `point.x()` is fine (records are designed as data carriers; their components are the API). Going further (`point.x().getSomething()`) starts the chain.

---

## Tell, Don't Ask

A heuristic for cure:

```java
// Ask
if (account.getBalance() >= amount) {
    account.setBalance(account.getBalance() - amount);
    audit.log("withdraw", account.getId(), amount);
}

// Tell
account.withdraw(amount, audit);
```

The "ask" version is Feature Envy — the caller does the work the account should do. The "tell" version pushes the work to the data; the caller's responsibility shrinks to "what" not "how."

---

## When to keep loose vs tight coupling

**Loose coupling (cure for Couplers):**
- Easier to test in isolation.
- Easier to change without breaking unrelated code.
- Standard advice for most code.

**Tight coupling (sometimes appropriate):**
- Performance-critical inner loops where method dispatch matters.
- Internal helpers within a single small bounded context where the coupling is *understood and stable*.
- Tight teams with shared mental models — the cost of "intimate" classes is low when both classes are owned by the same engineer.

> Coupling is a *gradient*, not binary. Aim for loose coupling at module/service boundaries; accept tighter coupling within a tightly-scoped class cluster.

---

## Comparison with related smells

| Coupler | Often co-occurs with | Disambiguation |
|---|---|---|
| Feature Envy | Data Class (Dispensables), Long Method (Bloaters) | Data Class causes Feature Envy — fix data first. Long Method may have envious sub-fragments — extract them, then move. |
| Inappropriate Intimacy | Refused Bequest (OO Abusers) | When inheritance forces intimate access to parent's internals, both smells apply. |
| Message Chains | Primitive Obsession (Bloaters) | When values that should be objects (Address, Email) live as primitives buried in chains. |
| Middle Man | Lazy Class, Speculative Generality (Dispensables) | A Middle Man often coexists with Lazy Class — the wrapper barely justifies its existence. |

---

## Review questions

1. **A method `Total(Order, Customer)` uses 6 fields of Order, 1 of Customer. Move where?**
   To Order (where most of the data is). Customer becomes a parameter to the new `Order.totalFor(Customer)`.

2. **Tell, Don't Ask — opposite of Feature Envy?**
   Yes, in spirit. Feature Envy *is* asking for data and acting on it. Tell, Don't Ask is the principle: tell the data to do the work itself.

3. **`order.customer.address.city` — 3 chained calls. Smell?**
   Yes. Cure: `order.shippingCity()`. Each call hides the next.

4. **A facade has 30 methods, all simple forwards. Middle Man or Facade?**
   If they really only forward, Middle Man. If the facade *simplifies* the API (e.g., 30 forwards aggregate 100 underlying methods), it's a legitimate facade — pure forwarding here is wrong; consolidate.

5. **Inappropriate Intimacy in a parent/child hierarchy — pattern?**
   Subclass reads/writes parent's protected fields heavily. Cure: refactor parent to expose narrow methods; subclass uses methods, not fields. Or replace with composition.

6. **Demeter's Law forbids ALL chains?**
   Strict reading: yes. Pragmatic: focuses on object navigation, allows fluent APIs and DTO chains. Most teams adopt the pragmatic version.

7. **A `Customer.fullName()` that calls `firstName + " " + lastName` — Feature Envy of Customer?**
   No — `fullName` is on Customer, using its own fields. That's the right place.

8. **Middle Man for security/auditing — smell?**
   No, that's an interceptor. The "value" added is the security check / audit trail. Pure forwarding without value-add is the smell.

9. **Bidirectional association — when to keep?**
   When both sides genuinely query the relationship (employees query their department; departments query their employees). When only one side is queried, change to unidirectional — reduces intimacy.

10. **A class delegates only 5 of 50 methods. Middle Man?**
    No. The other 45 add value. The 5 forwards are minor. The smell needs *most* methods to be pure forwards.

---

> **Next:** [senior.md](senior.md) — architecture-level, design principles, tooling.
