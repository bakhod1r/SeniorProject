# Organizing Data — Find the Bug

> 12 refactors with hidden bugs.

---

## Bug 1 — Encapsulate Field, mutable internal state still leaks (Java)

```java
class Order {
    private List<Item> items = new ArrayList<>();
    public List<Item> getItems() { return items; }   // ❌
}
```

<details><summary>Bug</summary>

Returns the internal list. Caller can `.add()`, breaking invariants.

**Fix:** Encapsulate Collection.

```java
public List<Item> getItems() { return Collections.unmodifiableList(items); }
public void addItem(Item i) { items.add(i); }
```
</details>

---

## Bug 2 — Replace Magic Number with Wrong Constant (Java)

```java
private static final double TAX = 1.07;
double total(double base) { return base + TAX; }   // ❌
```

<details><summary>Bug</summary>

`1.07` was a *multiplier* (7% tax → multiply by 1.07). The constant name `TAX` is fine, but the formula was changed from `base * 1.07` to `base + TAX`. Behavior changed.

**Fix:** Don't change the formula during a "rename":

```java
double total(double base) { return base * TAX; }
```

Or rename to be explicit: `TAX_MULTIPLIER = 1.07`.
</details>

---

## Bug 3 — Replace Data Value with Object, lost equality (Java)

```java
class Email {
    private final String value;
    public Email(String v) { value = v; }
}
Map<Email, Customer> byEmail = new HashMap<>();
byEmail.put(new Email("a@b.com"), c);
byEmail.get(new Email("a@b.com"));   // null
```

<details><summary>Bug</summary>

`Email` doesn't override `equals`/`hashCode`. Different instances are unequal.

**Fix:** Use a record, or override:

```java
public record Email(String value) {}
```
</details>

---

## Bug 4 — Replace Type Code with Class but DB still INT (Java)

```java
enum Status { ACTIVE, INACTIVE }
class Account {
    private Status status;   // enum in Java
}
```

DB schema:
```sql
status INT NOT NULL  -- 0, 1, 2 (CANCELLED was added recently)
```

ORM mapper: `Account.status = Status.values()[row.getInt("status")]`.

<details><summary>Bug</summary>

Recently a third row value `2` (`CANCELLED`) was added to the DB but not the enum. `Status.values()[2]` throws `ArrayIndexOutOfBoundsException`. Or worse, if you use `Status.valueOf(name)`, you get a different mapping bug.

**Fix:** Map explicitly with a code field:

```java
enum Status {
    ACTIVE(0), INACTIVE(1), CANCELLED(2);
    private final int code;
    Status(int code) { this.code = code; }
    public int code() { return code; }
    public static Status fromCode(int c) {
        for (Status s : values()) if (s.code == c) return s;
        throw new IllegalArgumentException("Unknown status code: " + c);
    }
}
```

Lesson: Never rely on enum ordinal for persistence.
</details>

---

## Bug 5 — Replace Type Code with Subclasses but JSON serialization breaks (Java)

```java
abstract class Animal { abstract String speak(); }
class Dog extends Animal { String speak() { return "Woof"; } }
class Cat extends Animal { String speak() { return "Meow"; } }
```

JSON deserialization: `objectMapper.readValue(json, Animal.class)` — Jackson can't instantiate abstract Animal.

<details><summary>Bug</summary>

Without polymorphic type info, Jackson doesn't know which subclass to make.

**Fix:** Annotate.

```java
@JsonTypeInfo(use = Id.NAME, property = "kind")
@JsonSubTypes({@Type(value = Dog.class, name = "dog"), @Type(value = Cat.class, name = "cat")})
abstract class Animal { ... }
```

Or, for pure data, use a sealed interface + pattern matching (Java 17+) and a custom deserializer.
</details>

---

## Bug 6 — Change Bidirectional to Unidirectional drops cascade (Java + JPA)

```java
@Entity
class Customer {
    @OneToMany(mappedBy = "customer", cascade = CascadeType.ALL, orphanRemoval = true)
    private Set<Order> orders;
}
@Entity
class Order { @ManyToOne private Customer customer; }
```

Refactor: drop `Customer.orders`.

<details><summary>Bug</summary>

`CascadeType.ALL` and `orphanRemoval` were on the dropped side. Now removing a Customer no longer removes its Orders, leaving orphans in the DB. Also: the test that "deleting customer removes orders" silently passes because the test set up data the wrong way.

**Fix:** Either keep the bidir for cascade purposes, or implement the cascade explicitly:

```java
public void deleteCustomer(Customer c) {
    orderRepo.deleteByCustomer(c);
    customerRepo.delete(c);
}
```
</details>

---

## Bug 7 — Encapsulate Collection with `unmodifiableList` over mutable backing (Java)

```java
class Cart {
    private final List<Item> items = new ArrayList<>();
    public List<Item> getItems() { return Collections.unmodifiableList(items); }
    public void add(Item i) { items.add(i); }
}

List<Item> view = cart.getItems();
cart.add(new Item());      // modifies underlying list
view.size();               // reflects the change!
```

<details><summary>Bug</summary>

`unmodifiableList` is a *view*, not a copy. The caller may iterate `view` while another thread / call mutates `items`, causing `ConcurrentModificationException`.

**Fix:** Defensive copy if the consumer doesn't expect mutation:

```java
public List<Item> getItems() { return List.copyOf(items); }
```

Or document clearly that the view reflects current state and isn't safe across mutations.
</details>

---

## Bug 8 — Change Value to Reference: registry holds garbage (Java)

```java
class Customer {
    private static final Map<String, Customer> registry = new HashMap<>();
    public static Customer named(String n) {
        return registry.computeIfAbsent(n, Customer::new);
    }
}
```

<details><summary>Bug</summary>

`registry` is static — never garbage collected. Every Customer ever created stays in memory forever.

**Fix:** Use weak references or a proper repository.

```java
private static final Map<String, WeakReference<Customer>> registry = new ConcurrentHashMap<>();
```

Or, more typically: use a `CustomerRepository` that hits the database. Static singletons of mutable state are usually wrong.
</details>

---

## Bug 9 — Replace Subclass with Fields collapsing real polymorphism (Java)

```java
abstract class PaymentMethod { abstract void process(Money m); }
class CreditCard extends PaymentMethod { void process(Money m) { /* talks to Stripe */ } }
class PayPal extends PaymentMethod { void process(Money m) { /* talks to PayPal API */ } }
```

"Refactor": collapse into fields.

```java
class PaymentMethod {
    private final String type;   // "CREDIT", "PAYPAL"
    void process(Money m) {
        if (type.equals("CREDIT")) /* Stripe */;
        else if (type.equals("PAYPAL")) /* PayPal */;
    }
}
```

<details><summary>Bug</summary>

You introduced a Switch Statements smell to "fix" subclasses. The fields encode different *behavior*, which is exactly when subclasses are right.

**Fix:** Revert. Replace Subclass with Fields applies only when behavior is the same.
</details>

---

## Bug 10 — Self Encapsulate Field but accessor is public (Java)

```java
class Account {
    private double balance;
    public double balance() { return balance; }   // ❌ accessible to all
    public void deposit(double a) {
        balance += a;   // direct field, not via accessor
    }
}
```

<details><summary>Bug</summary>

The "Self Encapsulate" half wasn't done — `deposit` still uses the field directly. So if subclasses override `balance()`, `deposit` doesn't see the override.

Also, `balance()` is public — anyone can read it. Was that the intent?

**Fix:** Use the accessor everywhere internally.

```java
public void deposit(double a) {
    setBalance(balance() + a);
}
protected void setBalance(double b) { this.balance = b; }
```
</details>

---

## Bug 11 — Replace Array with Object loses iteration order (Python)

```python
# Old:
row = ("Alice", "Eng", 30, "NYC", "USA")
for cell in row: print(cell)
```

```python
# New:
@dataclass
class Employee:
    name: str
    title: str
    age: int
    city: str
    country: str

emp = Employee("Alice", "Eng", 30, "NYC", "USA")
# How to iterate?
for cell in emp: print(cell)   # ❌ TypeError: object is not iterable
```

<details><summary>Bug</summary>

`Employee` isn't iterable. Code that depended on tuple iteration breaks.

**Fix:** If iteration is required, override `__iter__` or use `dataclasses.astuple(emp)`:

```python
from dataclasses import astuple
for cell in astuple(emp): print(cell)
```

Lesson: Replace Array with Object intentionally removes positional access. If callers used positions, plan their migration.
</details>

---

## Bug 12 — Replace Magic Number with floating-point precision loss (Java)

```java
double rate = 1.0 / 3.0;
double third = amount * rate;
```

```java
private static final double ONE_THIRD = 0.333;   // ❌
double third = amount * ONE_THIRD;
```

<details><summary>Bug</summary>

The "named constant" lost precision. `0.333` is not equal to `1.0/3.0`. For a payroll calculation over a year, the drift compounds.

**Fix:** Either compute the constant at field init, or use `BigDecimal` for money:

```java
private static final double ONE_THIRD = 1.0 / 3.0;
// or
private static final BigDecimal ONE_THIRD = BigDecimal.ONE.divide(new BigDecimal(3), 30, RoundingMode.HALF_UP);
```

Lesson: Replace Magic Number with Symbolic Constant should be **value-preserving**, not value-approximating.
</details>

---

## Patterns

| Bug | Root cause |
|---|---|
| Leaked mutable list | Skipped Encapsulate Collection |
| Wrong formula in rename | Refactor changed behavior |
| Lost equality on value object | Forgot equals/hashCode (use record) |
| Type code mismatch DB | Persistence still raw |
| Polymorphic deser broken | Missed Jackson type info |
| Lost cascade | ORM-specific bidir was load-bearing |
| Concurrent mod via view | View ≠ copy |
| Static registry leak | No GC for static map |
| Collapsing real polymorphism | Field-based switch ≠ subclass |
| Field accessed directly internally | Self Encapsulate not applied |
| Lost iteration | Class isn't iterable like tuple |
| Precision loss in constant | Approximate constant |

---

## Next

- [optimize.md](optimize.md) — perf
- [tasks.md](tasks.md) — practice
- [interview.md](interview.md) — review
