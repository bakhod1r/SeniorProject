# Simplifying Conditionals — Tasks

> 12 hands-on exercises.

---

## Task 1 ⭐ — Decompose Conditional (Java)

```java
double charge(int quantity, Date date) {
    if (date.before(SUMMER_START) || date.after(SUMMER_END)) {
        return quantity * winterRate + winterServiceCharge;
    }
    return quantity * summerRate;
}
```

<details><summary>Solution</summary>

```java
double charge(int quantity, Date date) {
    if (notSummer(date)) return winterCharge(quantity);
    return summerCharge(quantity);
}
private boolean notSummer(Date d) { return d.before(SUMMER_START) || d.after(SUMMER_END); }
private double winterCharge(int q) { return q * winterRate + winterServiceCharge; }
private double summerCharge(int q) { return q * summerRate; }
```
</details>

---

## Task 2 ⭐ — Replace Nested Conditional with Guard Clauses (Java)

```java
double pay(Employee e) {
    double result;
    if (e.isDead()) {
        result = deadAmount();
    } else if (e.isSeparated()) {
        result = separatedAmount();
    } else if (e.isRetired()) {
        result = retiredAmount();
    } else {
        result = normalPay(e);
    }
    return result;
}
```

<details><summary>Solution</summary>

```java
double pay(Employee e) {
    if (e.isDead()) return deadAmount();
    if (e.isSeparated()) return separatedAmount();
    if (e.isRetired()) return retiredAmount();
    return normalPay(e);
}
```
</details>

---

## Task 3 ⭐ — Consolidate Conditional Expression (Python)

```python
def disability_amount(seniority, months_disabled, is_part_time):
    if seniority < 2: return 0
    if months_disabled > 12: return 0
    if is_part_time: return 0
    return calculate()
```

<details><summary>Solution</summary>

```python
def disability_amount(seniority, months_disabled, is_part_time):
    if not_eligible(seniority, months_disabled, is_part_time):
        return 0
    return calculate()

def not_eligible(seniority, months_disabled, is_part_time):
    return seniority < 2 or months_disabled > 12 or is_part_time
```
</details>

---

## Task 4 ⭐⭐ — Consolidate Duplicate Conditional Fragments (Java)

```java
if (isSpecialDeal()) {
    total = price * 0.95;
    send();
} else {
    total = price * 0.98;
    send();
}
```

<details><summary>Solution</summary>

```java
double rate = isSpecialDeal() ? 0.95 : 0.98;
total = price * rate;
send();
```
</details>

---

## Task 5 ⭐⭐ — Replace Conditional with Polymorphism (Java)

```java
class Bird {
    String type;   // "European", "African", "NorwegianBlue"
    boolean isNailed;

    double getSpeed() {
        switch (type) {
            case "European": return baseSpeed();
            case "African": return baseSpeed() - loadFactor() * numberOfCoconuts();
            case "NorwegianBlue": return isNailed ? 0 : baseSpeed(voltage());
            default: throw new IllegalStateException();
        }
    }
}
```

<details><summary>Solution</summary>

```java
abstract class Bird {
    abstract double getSpeed();
    double baseSpeed() { /* ... */ }
}
class European extends Bird {
    double getSpeed() { return baseSpeed(); }
}
class African extends Bird {
    private double loadFactor;
    private int numberOfCoconuts;
    double getSpeed() { return baseSpeed() - loadFactor * numberOfCoconuts; }
}
class NorwegianBlue extends Bird {
    private boolean isNailed;
    private double voltage;
    double getSpeed() { return isNailed ? 0 : baseSpeed(voltage); }
    double baseSpeed(double v) { /* uses voltage */ }
}
```
</details>

---

## Task 6 ⭐⭐ — Introduce Null Object (Java)

```java
Customer c = order.getCustomer();
String name;
if (c == null) name = "guest";
else name = c.getName();

Plan plan;
if (c == null || c.getPlan() == null) plan = freePlan();
else plan = c.getPlan();
```

<details><summary>Solution</summary>

```java
class NullCustomer extends Customer {
    @Override public String getName() { return "guest"; }
    @Override public Plan getPlan() { return new FreePlan(); }
}

Customer c = order.getCustomer();   // never null
String name = c.getName();
Plan plan = c.getPlan();
```

Make `Order.getCustomer()` return NullCustomer when missing.
</details>

---

## Task 7 ⭐⭐ — Remove Control Flag (Java)

```java
boolean found = false;
for (int i = 0; i < people.length && !found; i++) {
    if (people[i].equals("Don")) {
        sendAlert();
        found = true;
    }
    if (people[i].equals("John")) {
        sendAlert();
        found = true;
    }
}
```

<details><summary>Solution</summary>

```java
for (String person : people) {
    if (person.equals("Don") || person.equals("John")) {
        sendAlert();
        return;
    }
}
```
</details>

---

## Task 8 ⭐⭐ — Introduce Assertion (Java)

```java
double getExpenseLimit() {
    return (expenseLimit != NULL_EXPENSE) ? expenseLimit : primaryProject.memberExpenseLimit();
}
```

<details><summary>Solution</summary>

```java
double getExpenseLimit() {
    assert expenseLimit != NULL_EXPENSE || primaryProject != null;
    return (expenseLimit != NULL_EXPENSE) ? expenseLimit : primaryProject.memberExpenseLimit();
}
```

Better, for production:

```java
double getExpenseLimit() {
    if (expenseLimit == NULL_EXPENSE) {
        Objects.requireNonNull(primaryProject, "Either expenseLimit or primaryProject must be set");
        return primaryProject.memberExpenseLimit();
    }
    return expenseLimit;
}
```
</details>

---

## Task 9 ⭐⭐⭐ — Decision Table (Java)

A 50-line tier function:

```java
String tier(double spend, int years) {
    if (years > 10 && spend > 5000) return "GOLD";
    if (spend > 2000) return "GOLD";
    if (years > 5 && spend > 500) return "SILVER";
    if (spend > 500) return "SILVER";
    if (years > 3) return "BRONZE";
    if (spend > 100) return "BRONZE";
    return "NONE";
}
```

<details><summary>Solution</summary>

```java
record Rule(java.util.function.BiPredicate<Double, Integer> match, String tier) {}

private static final List<Rule> RULES = List.of(
    new Rule((spend, years) -> years > 10 && spend > 5000, "GOLD"),
    new Rule((spend, years) -> spend > 2000, "GOLD"),
    new Rule((spend, years) -> years > 5 && spend > 500, "SILVER"),
    new Rule((spend, years) -> spend > 500, "SILVER"),
    new Rule((spend, years) -> years > 3, "BRONZE"),
    new Rule((spend, years) -> spend > 100, "BRONZE")
);

String tier(double spend, int years) {
    return RULES.stream()
        .filter(r -> r.match.test(spend, years))
        .findFirst()
        .map(Rule::tier)
        .orElse("NONE");
}
```

Now adding a tier is one line in the list.
</details>

---

## Task 10 ⭐⭐⭐ — State Pattern (Java)

```java
class Order {
    String status;   // "DRAFT", "SUBMITTED", "SHIPPED"
    void cancel() {
        if (status.equals("DRAFT")) status = "CANCELLED";
        else if (status.equals("SUBMITTED")) { refund(); status = "CANCELLED"; }
        else if (status.equals("SHIPPED")) throw new IllegalStateException();
    }
    void refund() { /* ... */ }
}
```

<details><summary>Solution</summary>

```java
interface OrderStatus {
    void cancel(Order o);
    String name();
}

class Draft implements OrderStatus {
    public void cancel(Order o) { o.setStatus(new Cancelled()); }
    public String name() { return "DRAFT"; }
}
class Submitted implements OrderStatus {
    public void cancel(Order o) { o.refund(); o.setStatus(new Cancelled()); }
    public String name() { return "SUBMITTED"; }
}
class Shipped implements OrderStatus {
    public void cancel(Order o) { throw new IllegalStateException(); }
    public String name() { return "SHIPPED"; }
}
class Cancelled implements OrderStatus {
    public void cancel(Order o) {}
    public String name() { return "CANCELLED"; }
}

class Order {
    private OrderStatus status = new Draft();
    public void setStatus(OrderStatus s) { this.status = s; }
    public void cancel() { status.cancel(this); }
    public void refund() { /* ... */ }
}
```
</details>

---

## Task 11 ⭐⭐ — Sealed Types + Pattern Matching (Java 21+)

```java
abstract class Shape {}
class Circle extends Shape { double r; }
class Square extends Shape { double side; }

double area(Shape s) {
    if (s instanceof Circle c) return Math.PI * c.r * c.r;
    if (s instanceof Square sq) return sq.side * sq.side;
    throw new IllegalStateException();
}
```

<details><summary>Solution</summary>

```java
sealed interface Shape permits Circle, Square {}
record Circle(double r) implements Shape {}
record Square(double side) implements Shape {}

double area(Shape s) {
    return switch (s) {
        case Circle c -> Math.PI * c.r() * c.r();
        case Square sq -> sq.side() * sq.side();
    };  // exhaustive — adding a Triangle is a compile error here
}
```
</details>

---

## Task 12 ⭐⭐⭐ — Combined refactoring (Python)

```python
def process(order):
    if order is not None:
        if order.status == "draft":
            if order.customer is not None:
                if order.total > 0:
                    if order.customer.is_active:
                        if order.shipping_address is not None:
                            return submit(order)
                        else:
                            raise ValueError("no shipping address")
                    else:
                        raise ValueError("inactive customer")
                else:
                    raise ValueError("zero total")
            else:
                raise ValueError("no customer")
        else:
            raise ValueError("not draft")
    else:
        raise ValueError("null order")
```

Apply 3+ techniques.

<details><summary>Solution</summary>

```python
def process(order):
    if order is None: raise ValueError("null order")
    if order.status != "draft": raise ValueError("not draft")
    if order.customer is None: raise ValueError("no customer")
    if order.total <= 0: raise ValueError("zero total")
    if not order.customer.is_active: raise ValueError("inactive customer")
    if order.shipping_address is None: raise ValueError("no shipping address")
    return submit(order)
```

Even cleaner — use a validator chain or assertions:

```python
def process(order):
    validate(order)
    return submit(order)

def validate(order):
    require(order is not None, "null order")
    require(order.status == "draft", "not draft")
    require(order.customer is not None, "no customer")
    require(order.total > 0, "zero total")
    require(order.customer.is_active, "inactive customer")
    require(order.shipping_address is not None, "no shipping address")

def require(cond, msg):
    if not cond:
        raise ValueError(msg)
```

Applied: Replace Nested with Guard Clauses + Decompose Conditional + Introduce Assertion (via require()).
</details>

---

## Self-check

- ☑ I can flatten nested conditionals with guard clauses.
- ☑ I can identify when polymorphism replaces a switch.
- ☑ I can pick between Null Object, Optional, and throwing.
- ☑ I can introduce assertions appropriately.
- ☑ I can convert a chain of ifs into a decision table.

---

## Next

- [find-bug.md](find-bug.md) — wrong refactors
- [optimize.md](optimize.md) — perf
- [interview.md](interview.md) — review
