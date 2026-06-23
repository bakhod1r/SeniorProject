# Moving Features Between Objects — Tasks

> 12 hands-on exercises. Apply the named technique correctly, check against the solution sketch.

---

## Task 1 ⭐ — Move Method (Java)

```java
class Account {
    private AccountType type;
    private double daysOverdrawn;

    double overdraftCharge() {
        if (type.isPremium()) {
            double r = 10;
            if (daysOverdrawn > 7) r += (daysOverdrawn - 7) * 0.85;
            return r;
        }
        return daysOverdrawn * 1.75;
    }
}
```

**Goal:** Move `overdraftCharge` to `AccountType`. The body uses `type.isPremium()` more than anything on `Account`.

<details><summary>Solution sketch</summary>

```java
class AccountType {
    private boolean premium;
    public boolean isPremium() { return premium; }
    public double overdraftCharge(double daysOverdrawn) {
        if (premium) {
            double r = 10;
            if (daysOverdrawn > 7) r += (daysOverdrawn - 7) * 0.85;
            return r;
        }
        return daysOverdrawn * 1.75;
    }
}
class Account {
    private AccountType type;
    private double daysOverdrawn;
    double overdraftCharge() { return type.overdraftCharge(daysOverdrawn); }
}
```
</details>

---

## Task 2 ⭐ — Move Field (Python)

```python
class Account:
    def __init__(self, type_, balance, interest_rate):
        self.type = type_
        self.balance = balance
        self.interest_rate = interest_rate  # belongs on type

    def interest(self, days):
        return self.interest_rate * self.balance * days / 365
```

**Goal:** Move `interest_rate` to `AccountType`. (Assume `AccountType` exists.)

<details><summary>Solution sketch</summary>

```python
class AccountType:
    def __init__(self, name, interest_rate):
        self.name = name
        self.interest_rate = interest_rate

class Account:
    def __init__(self, type_, balance):
        self.type = type_
        self.balance = balance

    def interest(self, days):
        return self.type.interest_rate * self.balance * days / 365
```
</details>

---

## Task 3 ⭐ — Hide Delegate (Java)

```java
class Person {
    private Department department;
    public Department getDepartment() { return department; }
}
class Department {
    private Person manager;
    public Person getManager() { return manager; }
}

// Caller:
Person mgr = john.getDepartment().getManager();
```

**Goal:** Hide the delegate so callers say `john.manager()`.

<details><summary>Solution sketch</summary>

```java
class Person {
    private Department department;
    public Person manager() { return department.getManager(); }
}

// Caller:
Person mgr = john.manager();
```
</details>

---

## Task 4 ⭐⭐ — Extract Class (Java)

```java
class Person {
    private String name;
    private String areaCode;
    private String number;

    public String getName() { return name; }
    public String getAreaCode() { return areaCode; }
    public void setAreaCode(String c) { areaCode = c; }
    public String getNumber() { return number; }
    public void setNumber(String n) { number = n; }
    public String formattedNumber() { return "(" + areaCode + ") " + number; }
}
```

**Goal:** Extract a `TelephoneNumber` class.

<details><summary>Solution sketch</summary>

```java
class TelephoneNumber {
    private String areaCode;
    private String number;
    public String getAreaCode() { return areaCode; }
    public void setAreaCode(String c) { areaCode = c; }
    public String getNumber() { return number; }
    public void setNumber(String n) { number = n; }
    public String formatted() { return "(" + areaCode + ") " + number; }
}
class Person {
    private String name;
    private TelephoneNumber phone = new TelephoneNumber();
    public String getName() { return name; }
    public TelephoneNumber phone() { return phone; }
    public String formattedNumber() { return phone.formatted(); }
}
```
</details>

---

## Task 5 ⭐⭐ — Inline Class (Java)

```java
class Email {
    private String value;
    public String get() { return value; }
    public void set(String v) { value = v; }
}
class Person {
    private Email email = new Email();
    public Email getEmail() { return email; }
}
```

`Email` adds nothing — no validation, no formatting.

**Goal:** Inline.

<details><summary>Solution sketch</summary>

```java
class Person {
    private String email;
    public String getEmail() { return email; }
    public void setEmail(String e) { email = e; }
}
```
</details>

---

## Task 6 ⭐⭐ — Remove Middle Man (Java)

```java
class Person {
    private Department department;
    public Person manager() { return department.manager(); }
    public String departmentName() { return department.name(); }
    public List<Project> projects() { return department.projects(); }
    public int teamSize() { return department.size(); }
    public Currency currency() { return department.currency(); }
}
```

5 forwarders. Likely Middle Man.

**Goal:** Expose `department` and let callers traverse.

<details><summary>Solution sketch</summary>

```java
class Person {
    private Department department;
    public Department department() { return department; }
}

// Callers:
john.department().manager();
john.department().name();
```

Trade-off: callers now know about `Department`. Acceptable when Department is a stable concept.
</details>

---

## Task 7 ⭐⭐ — Introduce Foreign Method (Java)

```java
Date today = new Date();
Date tomorrow = new Date(today.getYear(), today.getMonth(), today.getDate() + 1);
```

`Date` (the legacy class) doesn't have a `nextDay` method.

**Goal:** Introduce `DateUtils.nextDay(Date)`.

<details><summary>Solution sketch</summary>

```java
public final class DateUtils {
    private DateUtils() {}
    public static Date nextDay(Date d) {
        return new Date(d.getYear(), d.getMonth(), d.getDate() + 1);
    }
}

// Caller:
Date tomorrow = DateUtils.nextDay(today);
```

Bonus: prefer `LocalDate.now().plusDays(1)` from `java.time` if you can migrate.
</details>

---

## Task 8 ⭐⭐⭐ — Introduce Local Extension (Java)

You've collected 6 foreign methods on `Date` in `DateUtils`. Promote to `MfDate`.

```java
public final class DateUtils {
    public static Date nextDay(Date d) { ... }
    public static Date previousDay(Date d) { ... }
    public static boolean isWeekend(Date d) { ... }
    public static boolean isBetween(Date d, Date a, Date b) { ... }
    public static int daysBetween(Date a, Date b) { ... }
    public static String formatIso(Date d) { ... }
}
```

**Goal:** Wrap `Date` as `MfDate` with these 6 methods.

<details><summary>Solution sketch</summary>

```java
public final class MfDate {
    private final Date original;
    public MfDate(Date d) { this.original = d; }

    public MfDate nextDay() { return new MfDate(/* ... */); }
    public MfDate previousDay() { return new MfDate(/* ... */); }
    public boolean isWeekend() { /* ... */ }
    public boolean isBetween(MfDate a, MfDate b) { /* ... */ }
    public int daysBetween(MfDate other) { /* ... */ }
    public String formatIso() { /* ... */ }

    public Date asDate() { return original; }
}
```

Modern alternative: just use `java.time.LocalDate` directly.
</details>

---

## Task 9 ⭐⭐⭐ — Move Method via Move Field first (Java)

```java
class Account {
    private double interestRate;
    private double balance;
    private AccountType type;

    double yearlyInterest() {
        return interestRate * balance;
    }
}
```

`interestRate` belongs on `AccountType`. Move it, then move `yearlyInterest`.

<details><summary>Solution sketch</summary>

Step 1: Move Field.
```java
class AccountType {
    private double interestRate;
    public double interestRate() { return interestRate; }
}
class Account {
    private double balance;
    private AccountType type;
    double yearlyInterest() { return type.interestRate() * balance; }
}
```

Step 2: Move Method (now `yearlyInterest` is essentially `type.interestRate * balance`; arguably stays on `Account` since it uses `balance`). If the test were "uses type more than self," and balance moved too:

Better outcome: **leave `yearlyInterest` on `Account`** — it uses `balance` (Account's own field). The Move was the field, and that's enough.

Lesson: Move Field is often the only refactoring needed. Verify before chaining moves.
</details>

---

## Task 10 ⭐⭐ — Hide Delegate followed by Remove Middle Man (Java)

You started with `john.getDepartment().manager()`. Over time, you Hid 8 delegate methods (`manager`, `name`, `size`, `currency`, `projects`, `head`, `secretary`, `budget`). Now `Person` has all 8 forwarders.

**Goal:** Reverse — Remove Middle Man — because `Department` has stabilized as a concept.

<details><summary>Solution sketch</summary>

```java
class Person {
    private Department department;
    public Department department() { return department; }
}
```

Migrate callers: `john.manager()` → `john.department().manager()`.

Lesson: Hide Delegate and Remove Middle Man are pendulum swings. The right amount depends on how stable the delegate's API is and how widely callers rely on either form.
</details>

---

## Task 11 ⭐⭐⭐ — Extract Class then Inline a leftover wrapper (Java)

```java
class Order {
    private String customerName;
    private String customerEmail;
    private String customerAddress;
    private List<LineItem> items;
    private Money total;
}
```

Step 1: Extract `Customer`.
Step 2: After extraction, you have `Customer { name; email; address }`. Suppose later you decide `address` deserves its own class with validation. Extract `Address` from `Customer`.
Step 3: After Address extraction, suppose `email` was a thin `EmailAddress { String value }` wrapper from a previous experiment — Inline it.

<details><summary>Solution sketch</summary>

```java
class Address {
    private String line1, city, postalCode, country;
    public String formatted() { /* ... */ }
}

class Customer {
    private String name;
    private String email;     // primitive, after Inline Class on EmailAddress
    private Address address;
}

class Order {
    private Customer customer;
    private List<LineItem> items;
    private Money total;
}
```

Total lessons:
- Extract Class clusters cohesive fields.
- After several rounds of refactoring, some intermediates may go away (Inline Class).
- It's normal to oscillate.
</details>

---

## Task 12 ⭐⭐⭐ — Move Method to break a Train Wreck (Go)

```go
fmt.Println(order.GetCustomer().GetAddress().GetCity().ToUpper())
```

**Goal:** Hide each delegate and end up with `order.CustomerCityUpper()` (or a cleaner equivalent).

<details><summary>Solution sketch</summary>

```go
type Order struct { customer *Customer }
func (o *Order) CustomerCityUpper() string { return o.customer.AddressCityUpper() }

type Customer struct { address *Address }
func (c *Customer) AddressCityUpper() string { return c.address.CityUpper() }

type Address struct { city string }
func (a *Address) CityUpper() string { return strings.ToUpper(a.city) }
```

Caller:
```go
fmt.Println(order.CustomerCityUpper())
```

Each link in the chain hides its inner detail — the caller no longer crosses 4 type boundaries.

Trade-off: each class grows a delegating method. Worth it when the chain repeats; overkill if it appears once.
</details>

---

## Self-check

- ☑ I can apply Move Method confidently when feature envy appears.
- ☑ I can decide between Hide Delegate and Remove Middle Man.
- ☑ I can Extract Class along a clear field cluster.
- ☑ I can recognize when a wrapper is genuinely lazy and Inline it.
- ☑ I can write Foreign Methods / Local Extensions in my language of choice.

---

## Next

- Spot the bug: [find-bug.md](find-bug.md)
- Optimize: [optimize.md](optimize.md)
- Recap: [interview.md](interview.md)
