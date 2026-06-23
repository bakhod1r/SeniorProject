# Composing Methods — Tasks

> 12 hands-on exercises. For each: read the starting code, apply the named technique correctly, and check your output against the proposed solution sketch.

---

## How to use this file

1. Copy the snippet into your editor.
2. Apply the listed technique manually (don't use the IDE refactoring command — the goal is to internalize the steps).
3. Run any tests provided.
4. Compare against the solution sketch.

Difficulty: ⭐ easy → ⭐⭐⭐ involved.

---

## Task 1 ⭐ — Extract Method (Java)

A controller method does too much. Extract one helper.

```java
public String greet(User user) {
    String name;
    if (user.getFullName() != null && !user.getFullName().isBlank()) {
        name = user.getFullName();
    } else if (user.getEmail() != null) {
        name = user.getEmail().substring(0, user.getEmail().indexOf('@'));
    } else {
        name = "guest";
    }
    return "Hello, " + name + "!";
}
```

**Goal:** Extract a `displayName(User)` helper. After: `greet` is two lines.

<details><summary>Solution sketch</summary>

```java
public String greet(User user) {
    return "Hello, " + displayName(user) + "!";
}

private String displayName(User user) {
    if (user.getFullName() != null && !user.getFullName().isBlank()) {
        return user.getFullName();
    }
    if (user.getEmail() != null) {
        return user.getEmail().substring(0, user.getEmail().indexOf('@'));
    }
    return "guest";
}
```
</details>

---

## Task 2 ⭐ — Extract Variable (Python)

```python
def is_eligible(user, cart):
    return (user.country in {"US", "CA", "GB"}
            and cart.total > 50
            and not user.is_blocked
            and (user.signup_date.year < 2024 or user.email_verified))
```

**Goal:** Extract two named locals so the return reads as a sentence.

<details><summary>Solution sketch</summary>

```python
def is_eligible(user, cart):
    in_supported_country = user.country in {"US", "CA", "GB"}
    qualifies_by_legacy = user.signup_date.year < 2024 or user.email_verified
    return (in_supported_country
            and cart.total > 50
            and not user.is_blocked
            and qualifies_by_legacy)
```
</details>

---

## Task 3 ⭐ — Inline Temp (Go)

```go
func taxFor(o *Order) Money {
    rate := o.Region.TaxRate()
    return o.Subtotal().Times(rate)
}
```

**Goal:** Inline the temp.

<details><summary>Solution sketch</summary>

```go
func taxFor(o *Order) Money {
    return o.Subtotal().Times(o.Region.TaxRate())
}
```

(Only do this if `TaxRate()` is cheap and pure.)
</details>

---

## Task 4 ⭐⭐ — Replace Temp with Query (Java)

```java
class Invoice {
    private List<LineItem> items;
    private double currencyRate;

    double total() {
        double subtotal = 0;
        for (LineItem i : items) subtotal += i.price() * i.quantity();
        if (subtotal > 1000) {
            return subtotal * 0.95 * currencyRate;
        }
        return subtotal * currencyRate;
    }
}
```

**Goal:** Extract a `subtotal()` query method.

<details><summary>Solution sketch</summary>

```java
class Invoice {
    private List<LineItem> items;
    private double currencyRate;

    double total() {
        double s = subtotal();
        if (s > 1000) return s * 0.95 * currencyRate;
        return s * currencyRate;
    }

    private double subtotal() {
        double s = 0;
        for (LineItem i : items) s += i.price() * i.quantity();
        return s;
    }
}
```

Note: keep ONE local `s` in `total()` to avoid recomputing — important if the loop is non-trivial. The query is now reusable in other methods.
</details>

---

## Task 5 ⭐⭐ — Split Temporary Variable (Java)

```java
double calc(double height, double width) {
    double temp = 2 * (height + width);
    System.out.println("perimeter: " + temp);
    temp = height * width;
    System.out.println("area: " + temp);
    return temp;
}
```

**Goal:** Split `temp` into two named locals.

<details><summary>Solution sketch</summary>

```java
double calc(double height, double width) {
    final double perimeter = 2 * (height + width);
    System.out.println("perimeter: " + perimeter);
    final double area = height * width;
    System.out.println("area: " + area);
    return area;
}
```
</details>

---

## Task 6 ⭐⭐ — Remove Assignments to Parameters (Python)

```python
def discount(input_val, quantity, year_to_date):
    if input_val > 50:
        input_val -= 2
    if quantity > 100:
        input_val -= 1
    if year_to_date > 10000:
        input_val -= 4
    return input_val
```

**Goal:** Don't reassign `input_val`.

<details><summary>Solution sketch</summary>

```python
def discount(input_val, quantity, year_to_date):
    result = input_val
    if input_val > 50:
        result -= 2
    if quantity > 100:
        result -= 1
    if year_to_date > 10000:
        result -= 4
    return result
```
</details>

---

## Task 7 ⭐⭐ — Inline Method (Java)

```java
class Driver {
    int rating() {
        return moreThanFiveLateDeliveries() ? 2 : 1;
    }

    boolean moreThanFiveLateDeliveries() {
        return numberOfLateDeliveries > 5;
    }

    private int numberOfLateDeliveries;
}
```

**Goal:** Inline `moreThanFiveLateDeliveries` since it's a one-liner with no extra meaning.

<details><summary>Solution sketch</summary>

```java
class Driver {
    int rating() {
        return numberOfLateDeliveries > 5 ? 2 : 1;
    }

    private int numberOfLateDeliveries;
}
```

Caveat: only do this if `moreThanFiveLateDeliveries` is `private` and not overridden anywhere.
</details>

---

## Task 8 ⭐⭐⭐ — Replace Method with Method Object (Java)

```java
class Account {
    int gamma(int inputVal, int quantity, int yearToDate) {
        int importantValue1 = (inputVal * quantity) + delta();
        int importantValue2 = (inputVal * yearToDate) + 100;
        if ((yearToDate - importantValue1) > 100) {
            importantValue2 -= 20;
        }
        int importantValue3 = importantValue2 * 7;
        return importantValue3 - 2 * importantValue1;
    }

    int delta() { return 42; }
}
```

**Goal:** Promote `gamma` into a `Gamma` method object so each phase can be its own method.

<details><summary>Solution sketch</summary>

```java
class Gamma {
    private final Account account;
    private final int inputVal, quantity, yearToDate;
    private int importantValue1, importantValue2, importantValue3;

    Gamma(Account account, int iv, int q, int ytd) {
        this.account = account;
        this.inputVal = iv;
        this.quantity = q;
        this.yearToDate = ytd;
    }

    int compute() {
        importantValue1 = (inputVal * quantity) + account.delta();
        importantValue2 = (inputVal * yearToDate) + 100;
        adjust();
        importantValue3 = importantValue2 * 7;
        return importantValue3 - 2 * importantValue1;
    }

    private void adjust() {
        if ((yearToDate - importantValue1) > 100) importantValue2 -= 20;
    }
}

class Account {
    int gamma(int inputVal, int quantity, int yearToDate) {
        return new Gamma(this, inputVal, quantity, yearToDate).compute();
    }
    int delta() { return 42; }
}
```
</details>

---

## Task 9 ⭐⭐ — Substitute Algorithm (Python)

```python
def found_person(people):
    for p in people:
        if p == "Don": return "Don"
        if p == "John": return "John"
        if p == "Kent": return "Kent"
    return ""
```

**Goal:** Substitute with a clearer algorithm.

<details><summary>Solution sketch</summary>

```python
CANDIDATES = {"Don", "John", "Kent"}

def found_person(people):
    for p in people:
        if p in CANDIDATES:
            return p
    return ""
```

Stretch goal: make `CANDIDATES` a function parameter for testability.
</details>

---

## Task 10 ⭐⭐⭐ — Extract Method + Replace Temp with Query (Java)

A 60-line method with two phases.

```java
public Money price(Order order) {
    double subtotal = 0;
    for (LineItem li : order.items()) {
        subtotal += li.price() * li.qty();
    }
    if (order.customer().isLoyal()) subtotal *= 0.95;
    if (order.customer().country().equals("US")) subtotal *= 1.07;
    if (order.weight() > 5) subtotal += 10;
    return Money.of(subtotal);
}
```

**Goal:** Decompose into 3 query methods: `subtotal`, `loyaltyAdjusted`, `withTaxAndShipping`.

<details><summary>Solution sketch</summary>

```java
public Money price(Order order) {
    return Money.of(withTaxAndShipping(loyaltyAdjusted(subtotal(order), order), order));
}

private double subtotal(Order order) {
    double s = 0;
    for (LineItem li : order.items()) s += li.price() * li.qty();
    return s;
}

private double loyaltyAdjusted(double subtotal, Order order) {
    return order.customer().isLoyal() ? subtotal * 0.95 : subtotal;
}

private double withTaxAndShipping(double after, Order order) {
    double t = after;
    if (order.customer().country().equals("US")) t *= 1.07;
    if (order.weight() > 5) t += 10;
    return t;
}
```

Note: this version still mutates `t` — that's acceptable inside one helper. The orchestrator `price` is now a single composed expression.
</details>

---

## Task 11 ⭐⭐ — Extract Variable in TypeScript

```ts
function shouldShowPromo(user: User, cart: Cart, time: Date): boolean {
  return user.country === "US"
      && cart.items.length > 0
      && cart.total > 30
      && (time.getHours() >= 18 || time.getHours() < 6)
      && !user.optedOutOfPromos
      && user.signupDate < new Date("2024-01-01");
}
```

**Goal:** Three named locals. Make the return read as English.

<details><summary>Solution sketch</summary>

```ts
function shouldShowPromo(user: User, cart: Cart, time: Date): boolean {
  const isAfterHoursOrNight = time.getHours() >= 18 || time.getHours() < 6;
  const isLegacyUser = user.signupDate < new Date("2024-01-01");
  const cartIsEligible = cart.items.length > 0 && cart.total > 30;
  return user.country === "US"
      && cartIsEligible
      && isAfterHoursOrNight
      && !user.optedOutOfPromos
      && isLegacyUser;
}
```
</details>

---

## Task 12 ⭐⭐⭐ — Combined refactoring (Go)

A real-world hairball.

```go
func ComputeFee(order *Order, ctx *Context) (Money, error) {
    var fee Money
    if order.IsExpedited && ctx.User.Tier == "premium" {
        fee = Money{}
    } else if order.IsExpedited {
        fee = Money{Amount: 15, Currency: "USD"}
    } else {
        if order.Total.Amount > 100 {
            fee = Money{Amount: 5, Currency: "USD"}
        } else {
            fee = Money{Amount: 10, Currency: "USD"}
        }
    }
    if order.Region == "EU" {
        fee = Money{Amount: fee.Amount * 1.21, Currency: "EUR"}
    } else if order.Region == "CA" {
        fee = Money{Amount: fee.Amount * 1.05, Currency: "CAD"}
    }
    if order.IsGift {
        fee.Amount += 2
    }
    return fee, nil
}
```

**Goals:**
1. Extract `baseFee(order, ctx)`.
2. Extract `regionalAdjusted(fee, region)`.
3. Extract `withGiftFee(fee, isGift)`.
4. Compose them in `ComputeFee`.

<details><summary>Solution sketch</summary>

```go
func ComputeFee(order *Order, ctx *Context) (Money, error) {
    fee := baseFee(order, ctx)
    fee = regionalAdjusted(fee, order.Region)
    fee = withGiftFee(fee, order.IsGift)
    return fee, nil
}

func baseFee(order *Order, ctx *Context) Money {
    if order.IsExpedited && ctx.User.Tier == "premium" {
        return Money{}
    }
    if order.IsExpedited {
        return Money{Amount: 15, Currency: "USD"}
    }
    if order.Total.Amount > 100 {
        return Money{Amount: 5, Currency: "USD"}
    }
    return Money{Amount: 10, Currency: "USD"}
}

func regionalAdjusted(fee Money, region string) Money {
    switch region {
    case "EU":
        return Money{Amount: fee.Amount * 1.21, Currency: "EUR"}
    case "CA":
        return Money{Amount: fee.Amount * 1.05, Currency: "CAD"}
    default:
        return fee
    }
}

func withGiftFee(fee Money, isGift bool) Money {
    if !isGift {
        return fee
    }
    fee.Amount += 2
    return fee
}
```

Each helper is a pure function. Each is unit-testable without setting up full `Order`/`Context`.
</details>

---

## Self-check

After completing the tasks, you should be able to:

- ☑ Apply Extract Method without using IDE shortcuts.
- ☑ Distinguish Extract Variable, Extract Method, and Replace Temp with Query.
- ☑ Recognize when a method needs Method Object treatment.
- ☑ Avoid mutating parameters; introduce locals instead.
- ☑ Apply the Substitute Algorithm safely (with characterization tests).

---

## Next

- Spot the bug: [find-bug.md](find-bug.md)
- Optimize: [optimize.md](optimize.md)
- Review: [interview.md](interview.md)
