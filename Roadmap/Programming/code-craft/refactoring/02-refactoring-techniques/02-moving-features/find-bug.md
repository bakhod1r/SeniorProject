# Moving Features — Find the Bug

> 12 snippets where a Moving Features refactoring was applied **wrongly**. Spot the issue.

---

## Bug 1 — Move Method that loses identity (Java)

**Original:**

```java
class Account {
    private double balance;
    public boolean canWithdraw(double amount) {
        return balance >= amount;
    }
}
```

**"Moved":**

```java
class WithdrawalPolicy {
    public boolean canWithdraw(Account a, double amount) {
        return a.balance >= amount;   // ❌
    }
}
```

<details><summary>Bug</summary>

`balance` is `private`. The "moved" method can't see it. Either expose `balance` (likely the wrong fix — breaks encapsulation), or pass it as a parameter, or revert.

**Fix:** Move was inappropriate. `canWithdraw` uses `balance` only — it belongs on `Account`. Don't Move Method when the only data is on the source.

Or, if you really need the policy elsewhere, pass `balance`:

```java
public boolean canWithdraw(double balance, double amount) { return balance >= amount; }
```
</details>

---

## Bug 2 — Move Field that breaks an invariant (Java)

```java
class Account {
    private double balance;
    public void deposit(double amount) {
        if (amount < 0) throw new IllegalArgumentException();
        balance += amount;
    }
}
```

**"Moved":** Field moved to `BalanceHolder`.

```java
class BalanceHolder {
    public double balance;   // ❌ public for "ease"
}
class Account {
    private BalanceHolder balanceHolder = new BalanceHolder();
    public void deposit(double amount) {
        if (amount < 0) throw new IllegalArgumentException();
        balanceHolder.balance += amount;
    }
}
```

<details><summary>Bug</summary>

`balance` is now public — anyone can mutate it without going through `deposit`. The negative-amount check is bypassable.

**Fix:** Encapsulate.

```java
class BalanceHolder {
    private double balance;
    public double get() { return balance; }
    public void add(double amount) {
        if (amount < 0) throw new IllegalArgumentException();
        balance += amount;
    }
}
class Account {
    private BalanceHolder balanceHolder = new BalanceHolder();
    public void deposit(double amount) { balanceHolder.add(amount); }
}
```

Lesson: Move Field must preserve encapsulation, not break it for convenience.
</details>

---

## Bug 3 — Extract Class that creates a circular reference (Java)

```java
class Order {
    private List<LineItem> items;
    public Money total() { /* iterates items */ }
}
```

**"Refactored":**

```java
class OrderTotals {
    private final Order order;     // ❌
    public OrderTotals(Order o) { this.order = o; }
    public Money total() { /* uses order.items */ }
}
class Order {
    private List<LineItem> items;
    private OrderTotals totals = new OrderTotals(this);   // ❌
    public Money total() { return totals.total(); }
}
```

<details><summary>Bug</summary>

`Order` and `OrderTotals` reference each other. Garbage collection eventually cleans up, but:
- Test setup is harder (constructing one needs the other).
- Serialization can infinite-loop.
- Conceptually, they're not really separate classes.

**Fix:** If `OrderTotals` is just a method on `items`, it doesn't need an `Order` reference. Pass items directly:

```java
class OrderTotals {
    public static Money totalOf(List<LineItem> items) { /* ... */ }
}
class Order {
    private List<LineItem> items;
    public Money total() { return OrderTotals.totalOf(items); }
}
```

Or, if `OrderTotals` truly needs more from Order, the Extract was the wrong move — leave the method on Order.
</details>

---

## Bug 4 — Inline Class that drops validation (Java)

**Original:**

```java
class Email {
    private final String value;
    public Email(String v) {
        if (!v.contains("@")) throw new IllegalArgumentException();
        this.value = v;
    }
    public String value() { return value; }
}
class Person {
    private Email email;
    public void setEmail(String e) { this.email = new Email(e); }
}
```

**"Inlined":**

```java
class Person {
    private String email;
    public void setEmail(String e) { this.email = e; }   // ❌ no validation
}
```

<details><summary>Bug</summary>

The Inline removed the validation that lived in `Email`'s constructor. Now any string, including invalid ones, sets the email.

**Fix:** Don't Inline a value object that holds an invariant. Either keep `Email` or move validation into `Person.setEmail`:

```java
public void setEmail(String e) {
    if (!e.contains("@")) throw new IllegalArgumentException();
    this.email = e;
}
```

Lesson: encapsulated invariants are *the* signal that a class isn't lazy.
</details>

---

## Bug 5 — Hide Delegate that causes a NullPointerException (Java)

```java
class Person {
    private Department department;
    public Person manager() { return department.getManager(); }
}
```

`department` may be null (maybe not assigned yet).

<details><summary>Bug</summary>

The original `john.getDepartment().getManager()` exposed the null at the first hop — caller could check. The new `john.manager()` hides which step is null. If `department` is null, the caller gets NPE without context.

**Fix:** Decide:
1. `department` should never be null — enforce in constructor:
   ```java
   public Person(Department d) {
       this.department = Objects.requireNonNull(d);
   }
   ```
2. Or, be explicit:
   ```java
   public Optional<Person> manager() {
       return department == null ? Optional.empty() : Optional.ofNullable(department.getManager());
   }
   ```

Lesson: Hide Delegate hides the *path*, but null/error semantics still matter. Make them explicit.
</details>

---

## Bug 6 — Remove Middle Man that breaks a security boundary (Java)

```java
class CustomerService {
    private CustomerRepository repo;
    public Customer findByEmail(String email) {
        if (!isAuthorized()) throw new SecurityException();
        return repo.findByEmail(email);
    }
}
```

**"Refactored":** "We have too many delegates — expose the repo."

```java
class CustomerService {
    private CustomerRepository repo;
    public CustomerRepository repo() { return repo; }   // ❌
}

// Caller:
service.repo().findByEmail(email);   // ❌ bypasses authorization
```

<details><summary>Bug</summary>

The "Middle Man" was actually an authorization layer. Exposing the repo lets callers skip the auth check.

**Fix:** Don't Remove Middle Man on a wrapper that adds policy. The wrapper has a real job: enforcing authorization, logging, audit, rate limiting, transaction boundaries.

Lesson: A "Middle Man" that does anything beyond forward calls is not a Middle Man. Read carefully before removing.
</details>

---

## Bug 7 — Move Method that breaks a transaction boundary (Java)

```java
@Service
class OrderService {
    @Transactional
    public void place(Order o) {
        validate(o);
        saveItems(o);
        chargePayment(o);
    }
}
```

**"Refactored":** "Move the methods to their own services."

```java
@Service
class OrderService {
    public void place(Order o) {
        validationService.validate(o);
        itemService.saveItems(o);
        paymentService.chargePayment(o);
    }
}
```

<details><summary>Bug</summary>

`@Transactional` is gone (or scoped wrong). Each `Service` method may have its own `@Transactional`, but the orchestration crosses transactions — partial failure is now possible (items saved, payment fails, no rollback).

**Fix:** Either keep `@Transactional` at the orchestrator (`OrderService.place`) and ensure inner services participate (Spring's `Propagation.REQUIRED`), or use a saga pattern for genuinely distributed transactions.

```java
@Service
class OrderService {
    @Transactional
    public void place(Order o) {
        validationService.validate(o);
        itemService.saveItems(o);
        paymentService.chargePayment(o);
    }
}
```

Lesson: Move Method must respect cross-cutting concerns: transactions, security, observability.
</details>

---

## Bug 8 — Extract Class with a static dependency that breaks tests (Java)

```java
class OrderService {
    public Money tax(Order o) {
        return TaxCalculator.calculate(o);   // static
    }
}
```

**"Refactored":**

```java
class TaxComputation {
    public Money compute(Order o) { return TaxCalculator.calculate(o); }   // still static
}
class OrderService {
    public Money tax(Order o) { return new TaxComputation().compute(o); }
}
```

<details><summary>Bug</summary>

The Extract did nothing useful — the static dependency on `TaxCalculator` is still there, hidden one level down. Tests can't mock `TaxCalculator`.

**Fix:** Inject the dependency.

```java
class TaxComputation {
    private final TaxCalculator calculator;
    public TaxComputation(TaxCalculator c) { this.calculator = c; }
    public Money compute(Order o) { return calculator.calculate(o); }
}
```

Lesson: Extract Class without addressing dependency injection wastes the move. The point is to enable test isolation; use the move to fix the static.
</details>

---

## Bug 9 — Hide Delegate with thread-safety issue (Java)

```java
class Person {
    private Department department;
    public synchronized Person manager() { return department.getManager(); }
}
```

`Department.getManager` was originally not synchronized. Now `Person.manager` is.

<details><summary>Bug</summary>

Acquiring `Person`'s lock before reading `Department`'s state may cause lock-order issues with other code that locks `Department` then `Person`. Classic deadlock pattern.

**Fix:** Don't synchronize Hide Delegate methods unless the original chain was synchronized. If Department had its own concurrency model, leave it intact:

```java
class Person {
    private final Department department;     // final after construction
    public Person manager() { return department.getManager(); }   // no synchronized
}
```

Lesson: Locking is a load-bearing concern. Refactoring must preserve the locking discipline.
</details>

---

## Bug 10 — Move Method that introduces N+1 query (Python)

```python
class User:
    def __init__(self, user_id, db):
        self.user_id = user_id
        self.db = db
        self.profile = db.get_profile(user_id)  # one query

    def display_name(self):
        return self.profile.name
```

**"Moved":** `display_name` to `Profile`.

```python
class Profile:
    def display_name(self, user_id, db):
        profile = db.get_profile(user_id)   # ❌ refetches
        return profile.name
```

<details><summary>Bug</summary>

The "moved" method re-queries the database every call instead of using the already-loaded profile.

**Fix:** Don't move when the source has cached state. Or move correctly — pass the loaded profile:

```python
class Profile:
    def __init__(self, name, ...):
        self.name = name

    def display_name(self):
        return self.name
```

User holds Profile, Profile owns the method.
</details>

---

## Bug 11 — Extract Class duplicating mutable state (Go)

```go
type Order struct {
    items []Item
    total Money
}

func (o *Order) AddItem(it Item) {
    o.items = append(o.items, it)
    o.total = o.total.Plus(it.Price)
}
```

**"Refactored":**

```go
type Totals struct {
    total Money
}

type Order struct {
    items  []Item
    totals Totals
}

func (o *Order) AddItem(it Item) {
    o.items = append(o.items, it)
    o.totals.total = o.totals.total.Plus(it.Price)
}

func (o *Order) Total() Money {
    return o.totals.total   // ❌ but who else holds totals?
}

// External code:
totals := order.totals    // copies the struct (Go value semantics)
totals.total = Money{}    // doesn't affect order.totals.total
```

<details><summary>Bug</summary>

Go struct values copy on assignment. The "extracted" Totals was meant to be referenced, but external code holding `totals` gets a snapshot. Updates desync.

**Fix:** Use a pointer if the totals must be shared, or recompute on demand (no stored total):

```go
func (o *Order) Total() Money {
    var t Money
    for _, it := range o.items { t = t.Plus(it.Price) }
    return t
}
```

Lesson: Go's value semantics are different from Java's reference semantics — Extract Class must consider whether you want a copy or a shared reference.
</details>

---

## Bug 12 — Inline Class breaks a polymorphism site (Java)

```java
abstract class Notification { abstract void send(); }
class EmailNotification extends Notification { void send() { ... } }
class SmsNotification extends Notification { void send() { ... } }

// Caller:
List<Notification> queue = ...;
for (Notification n : queue) n.send();
```

**"Refactored":** "EmailNotification is small — inline its body into the caller."

```java
for (Notification n : queue) {
    if (n instanceof EmailNotification) {
        // inlined body
    } else if (n instanceof SmsNotification) {
        n.send();
    }
}
```

<details><summary>Bug</summary>

Inline Class on a polymorphism point regresses to instanceof / type-code checks. You've reintroduced the [Switch Statements](../../01-code-smells/02-oo-abusers/junior.md) smell.

**Fix:** Don't inline polymorphism points. Keep `EmailNotification.send()`:

```java
for (Notification n : queue) n.send();
```

Lesson: classes that exist *because of polymorphism* are not lazy — they're the abstraction.
</details>

---

## Patterns of bugs

| Bug | Root cause |
|---|---|
| Move method, lose access to private | Method depended on encapsulated state |
| Move field, expose mutation | Forgot to wrap with accessors |
| Circular reference | Extracted child needs parent |
| Inline value object | Lost invariants |
| Hide delegate, NPE | Hidden null path |
| Remove middle man through security | Wrapper had a real job |
| Move method, transaction lost | Cross-cutting concerns |
| Extract class, static dep | Didn't fix what made the move worth doing |
| Move, N+1 query | Lost the cache |
| Extract Go struct, value copy | Reference vs. value semantics |
| Inline polymorphism | Reintroduced switch |

---

## Next

- [optimize.md](optimize.md) — performance pitfalls
- [tasks.md](tasks.md) — practice clean refactors
- [interview.md](interview.md) — review
