# Organizing Data — Tasks

> 12 hands-on exercises.

---

## Task 1 ⭐ — Replace Magic Number with Symbolic Constant (Java)

```java
double finalPrice(double base) {
    return base * 1.07 + 5;
}
```

What is `1.07`? What is `5`?

<details><summary>Solution</summary>

```java
private static final double SALES_TAX_RATE = 1.07;
private static final double SHIPPING_FEE = 5;

double finalPrice(double base) {
    return base * SALES_TAX_RATE + SHIPPING_FEE;
}
```
</details>

---

## Task 2 ⭐ — Encapsulate Field (Java)

```java
class Account {
    public double balance;
}
```

<details><summary>Solution</summary>

```java
class Account {
    private double balance;
    public double balance() { return balance; }
    public void deposit(double amount) {
        if (amount < 0) throw new IllegalArgumentException();
        balance += amount;
    }
}
```
</details>

---

## Task 3 ⭐ — Replace Data Value with Object (Python)

```python
class Order:
    def __init__(self, customer_email):
        self.customer_email = customer_email   # primitive
```

<details><summary>Solution</summary>

```python
@dataclass(frozen=True, slots=True)
class Email:
    value: str
    def __post_init__(self):
        if "@" not in self.value:
            raise ValueError("invalid email")

class Order:
    def __init__(self, email: Email):
        self.email = email
```
</details>

---

## Task 4 ⭐⭐ — Replace Type Code with Enum (Java)

```java
class Order {
    public static final int DRAFT = 0;
    public static final int SUBMITTED = 1;
    public static final int SHIPPED = 2;
    private int status;
}
```

<details><summary>Solution</summary>

```java
enum OrderStatus { DRAFT, SUBMITTED, SHIPPED }

class Order {
    private OrderStatus status = OrderStatus.DRAFT;
    public OrderStatus status() { return status; }
}
```
</details>

---

## Task 5 ⭐⭐ — Replace Type Code with Subclasses (Java)

```java
class Employee {
    static final int ENGINEER = 0, SALESMAN = 1;
    int type;
    double commission;
    double monthlyPay() {
        if (type == ENGINEER) return 5000;
        return 3000 + commission;
    }
}
```

<details><summary>Solution</summary>

```java
abstract class Employee {
    abstract double monthlyPay();
}
class Engineer extends Employee { double monthlyPay() { return 5000; } }
class Salesman extends Employee {
    private double commission;
    Salesman(double c) { this.commission = c; }
    double monthlyPay() { return 3000 + commission; }
}
```
</details>

---

## Task 6 ⭐⭐ — Encapsulate Collection (Java)

```java
class Customer {
    public List<Order> orders = new ArrayList<>();
}
```

<details><summary>Solution</summary>

```java
class Customer {
    private final List<Order> orders = new ArrayList<>();
    public List<Order> orders() { return Collections.unmodifiableList(orders); }
    public void addOrder(Order o) {
        if (orders.contains(o)) return;
        orders.add(o);
    }
    public void removeOrder(Order o) { orders.remove(o); }
}
```
</details>

---

## Task 7 ⭐⭐ — Replace Array with Object (Java)

```java
String[] row = {"Alice", "Engineer", "30"};
System.out.println(row[0] + " - " + row[1] + ", " + row[2]);
```

<details><summary>Solution</summary>

Use a record (Java 14+):
```java
record Employee(String name, String title, int age) {}
Employee row = new Employee("Alice", "Engineer", 30);
System.out.println(row.name() + " - " + row.title() + ", " + row.age());
```
</details>

---

## Task 8 ⭐⭐⭐ — Change Bidirectional to Unidirectional (Java)

```java
class Order {
    private Customer customer;
}
class Customer {
    private Set<Order> orders = new HashSet<>();
}
```

If `customer.orders` is rarely used and a repository exists, drop it.

<details><summary>Solution</summary>

```java
class Order {
    private final Customer customer;
    Order(Customer c) { this.customer = c; }
    public Customer customer() { return customer; }
}
class Customer {
    public List<Order> orders(OrderRepository repo) {
        return repo.findByCustomer(this);
    }
}
```
</details>

---

## Task 9 ⭐⭐ — Replace Subclass with Fields (Java)

```java
abstract class Person {
    abstract boolean isMale();
    abstract char code();
}
class Male extends Person { boolean isMale() { return true; } char code() { return 'M'; } }
class Female extends Person { boolean isMale() { return false; } char code() { return 'F'; } }
```

<details><summary>Solution</summary>

```java
class Person {
    private final boolean male;
    private final char code;
    private Person(boolean male, char code) { this.male = male; this.code = code; }
    public static Person createMale() { return new Person(true, 'M'); }
    public static Person createFemale() { return new Person(false, 'F'); }
    public boolean isMale() { return male; }
    public char code() { return code; }
}
```
</details>

---

## Task 10 ⭐⭐⭐ — Replace Type Code with State (Java)

An order has DRAFT → SUBMITTED → SHIPPED transitions. Each status has different behavior for `cancel()`. Replace the type code with State.

<details><summary>Solution</summary>

```java
interface OrderStatus {
    void cancel(Order order);
    String name();
}
class DraftStatus implements OrderStatus {
    public void cancel(Order o) { o.setStatus(new CancelledStatus()); }
    public String name() { return "DRAFT"; }
}
class SubmittedStatus implements OrderStatus {
    public void cancel(Order o) {
        o.refund();
        o.setStatus(new CancelledStatus());
    }
    public String name() { return "SUBMITTED"; }
}
class ShippedStatus implements OrderStatus {
    public void cancel(Order o) {
        throw new IllegalStateException("Can't cancel shipped order");
    }
    public String name() { return "SHIPPED"; }
}
class CancelledStatus implements OrderStatus {
    public void cancel(Order o) {}
    public String name() { return "CANCELLED"; }
}

class Order {
    private OrderStatus status = new DraftStatus();
    public void setStatus(OrderStatus s) { this.status = s; }
    public void cancel() { status.cancel(this); }
    public void refund() { ... }
}
```
</details>

---

## Task 11 ⭐⭐⭐ — Change Reference to Value (Java)

```java
class Currency {
    private final String code;
    public Currency(String code) { this.code = code; }
    public String code() { return code; }
}

// somewhere:
Currency a = new Currency("USD");
Currency b = new Currency("USD");
// a.equals(b) is false (default Object.equals)
```

Make `Currency` a value object.

<details><summary>Solution</summary>

```java
public record Currency(String code) {
    public Currency {
        Objects.requireNonNull(code);
        if (code.length() != 3) throw new IllegalArgumentException();
    }
}
```

Or pre-Java 14:

```java
class Currency {
    private final String code;
    public Currency(String code) {
        this.code = Objects.requireNonNull(code);
        if (code.length() != 3) throw new IllegalArgumentException();
    }
    public String code() { return code; }
    @Override public boolean equals(Object o) {
        return o instanceof Currency c && c.code.equals(code);
    }
    @Override public int hashCode() { return code.hashCode(); }
    @Override public String toString() { return code; }
}
```
</details>

---

## Task 12 ⭐⭐⭐ — Combined: Encapsulate + Replace Data Value + Replace Type Code (Python)

```python
class User:
    def __init__(self):
        self.email = ""           # public, primitive
        self.role = 0             # 0=guest, 1=member, 2=admin
        self.preferences = []     # public mutable list
```

Apply 3 refactorings: Encapsulate Field, Replace Data Value with Object, Replace Type Code with Class.

<details><summary>Solution</summary>

```python
from enum import Enum
from dataclasses import dataclass, field

class Role(Enum):
    GUEST = "guest"
    MEMBER = "member"
    ADMIN = "admin"

@dataclass(frozen=True, slots=True)
class Email:
    value: str
    def __post_init__(self):
        if "@" not in self.value:
            raise ValueError("invalid email")

class User:
    def __init__(self, email: Email, role: Role = Role.GUEST):
        self._email = email
        self._role = role
        self._preferences: list[str] = []

    @property
    def email(self) -> Email:
        return self._email

    @property
    def role(self) -> Role:
        return self._role

    @property
    def preferences(self) -> tuple[str, ...]:
        return tuple(self._preferences)

    def add_preference(self, p: str) -> None:
        if p not in self._preferences:
            self._preferences.append(p)
```
</details>

---

## Self-check

- ☑ I can replace primitives with proper types.
- ☑ I can pick between enum, subclass, and State for type codes.
- ☑ I can encapsulate fields and collections.
- ☑ I can decide value vs. reference semantics.
- ☑ I can convert bidirectional associations to unidirectional and back.

---

## Next

- [find-bug.md](find-bug.md) — wrong refactors.
- [optimize.md](optimize.md) — perf pitfalls.
- [interview.md](interview.md) — review.
