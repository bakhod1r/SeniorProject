# Dispensables — Practice Tasks

> 12 hands-on exercises across 6 Dispensables, with full solutions.

---

## Task 1 — Comments → self-explanatory code (Java)

**Problem:** replace comments with extracted methods.

```java
public BigDecimal computeFinalPrice(Item item, Customer c) {
    // Step 1: get base price
    BigDecimal price = item.getBasePrice();
    
    // Step 2: apply category discount
    if (item.getCategory() == Category.BOOK) {
        price = price.multiply(new BigDecimal("0.95"));
    }
    
    // Step 3: apply customer tier discount
    if (c.getTier() == Tier.GOLD) {
        price = price.multiply(new BigDecimal("0.90"));
    }
    
    // Step 4: apply tax
    price = price.multiply(new BigDecimal("1.0875"));
    
    return price;
}
```

**Solution:**

```java
public BigDecimal computeFinalPrice(Item item, Customer c) {
    BigDecimal price = item.getBasePrice();
    price = applyCategoryDiscount(price, item);
    price = applyTierDiscount(price, c);
    price = applyTax(price);
    return price;
}

private BigDecimal applyCategoryDiscount(BigDecimal price, Item item) {
    return item.getCategory() == Category.BOOK
        ? price.multiply(new BigDecimal("0.95"))
        : price;
}

private BigDecimal applyTierDiscount(BigDecimal price, Customer c) {
    return c.getTier() == Tier.GOLD
        ? price.multiply(new BigDecimal("0.90"))
        : price;
}

private BigDecimal applyTax(BigDecimal price) {
    return price.multiply(new BigDecimal("1.0875"));
}
```

---

## Task 2 — Extract Method for Duplicate Code (Python)

**Problem:** eliminate duplication.

```python
def compute_order_totals(orders):
    total = 0
    for o in orders:
        line_total = o.unit_price * o.quantity
        if o.discount: line_total *= (1 - o.discount)
        total += line_total
    return total

def compute_quote_totals(quotes):
    total = 0
    for q in quotes:
        line_total = q.unit_price * q.quantity
        if q.discount: line_total *= (1 - q.discount)
        total += line_total
    return total
```

**Solution:**

```python
def compute_total(items):
    return sum(line_total(i) for i in items)

def line_total(item):
    raw = item.unit_price * item.quantity
    return raw * (1 - item.discount) if item.discount else raw

# Usage:
total = compute_total(orders)  # or quotes
```

---

## Task 3 — Inline Class (Java)

**Problem:** inline the trivial wrapper.

```java
class TaxRate {
    private final BigDecimal rate;
    public TaxRate(BigDecimal rate) { this.rate = rate; }
    public BigDecimal applyTo(BigDecimal amount) {
        return amount.multiply(rate);
    }
}

class Order {
    public BigDecimal computeTax(BigDecimal subtotal) {
        return new TaxRate(new BigDecimal("0.0875")).applyTo(subtotal);
    }
}
```

**Solution:**

```java
class Order {
    private static final BigDecimal TAX_RATE = new BigDecimal("0.0875");
    
    public BigDecimal computeTax(BigDecimal subtotal) {
        return subtotal.multiply(TAX_RATE);
    }
}
```

`TaxRate` is gone. The constant lives where it's used.

---

## Task 4 — Move Method (Anemic to Rich Domain) (Java)

**Problem:** move logic from service onto domain class.

```java
class Order {
    public OrderStatus status;
    public LocalDate placedAt;
    public BigDecimal total;
    // only getters/setters
}

class OrderService {
    public boolean canCancel(Order o) {
        return o.getStatus() == OrderStatus.PENDING ||
               o.getStatus() == OrderStatus.CONFIRMED;
    }
    public boolean isOverdue(Order o) {
        return o.getStatus() == OrderStatus.SHIPPED &&
               o.getPlacedAt().isBefore(LocalDate.now().minusDays(7));
    }
    public boolean isHighValue(Order o) {
        return o.getTotal().compareTo(new BigDecimal("1000")) > 0;
    }
}
```

**Solution:**

```java
class Order {
    private OrderStatus status;
    private LocalDate placedAt;
    private BigDecimal total;
    // ... constructors, accessors
    
    public boolean canCancel() {
        return status == OrderStatus.PENDING || status == OrderStatus.CONFIRMED;
    }
    public boolean isOverdue() {
        return status == OrderStatus.SHIPPED &&
               placedAt.isBefore(LocalDate.now().minusDays(7));
    }
    public boolean isHighValue() {
        return total.compareTo(new BigDecimal("1000")) > 0;
    }
}
```

`OrderService` retains only operations that genuinely cross multiple domain objects.

---

## Task 5 — Delete Dead Code (Java)

**Problem:** identify and delete dead code.

```java
public class OrderProcessor {
    private static final boolean LEGACY_MODE = false;
    
    public void processOrder(Order o) {
        if (LEGACY_MODE) {
            legacyProcess(o);
            return;
        }
        modernProcess(o);
    }
    
    @Deprecated
    private void legacyProcess(Order o) {
        // 200 lines of pre-2020 logic
    }
    
    private void modernProcess(Order o) {
        // Current logic
    }
    
    // chargeViaPaypalOld(o);  // commented 2 years ago
    
    private boolean checkPaymentLegacy(Order o) {  // not called anywhere
        return o.getStatus() == OrderStatus.PAID;
    }
}
```

**Solution:**

```java
public class OrderProcessor {
    public void processOrder(Order o) {
        modernProcess(o);
    }
    
    private void modernProcess(Order o) {
        // Current logic
    }
}
```

Deleted: `LEGACY_MODE` constant (always false), `legacyProcess` (unreachable), commented call (irrelevant), `checkPaymentLegacy` (no callers). Git remembers if needed.

---

## Task 6 — Collapse Hierarchy (Speculative Generality) (Java)

**Problem:** the abstract class has only one subclass.

```java
abstract class Notification {
    protected String to;
    protected String content;
    
    public abstract void send();
}

class EmailNotification extends Notification {
    public void send() {
        emailService.send(to, content);
    }
}

// No other subclass — used in only one place.
```

**Solution:**

```java
class EmailNotification {
    private String to;
    private String content;
    
    public EmailNotification(String to, String content) {
        this.to = to;
        this.content = content;
    }
    
    public void send() {
        emailService.send(to, content);
    }
}
```

Hierarchy collapsed. If a second notification kind appears later, *then* extract a base class.

---

## Task 7 — Form Template Method (Duplicate Code in Hierarchy) (Java)

**Problem:** two subclasses have similar logic with one varying step.

```java
class CsvReport {
    public void generate(Data d) {
        validate(d);
        Output out = serializeCsv(d);
        save(out);
        notify(out);
    }
    private Output serializeCsv(Data d) { ... }
    // validate, save, notify identical to JsonReport
}

class JsonReport {
    public void generate(Data d) {
        validate(d);
        Output out = serializeJson(d);
        save(out);
        notify(out);
    }
    private Output serializeJson(Data d) { ... }
}
```

**Solution (Form Template Method):**

```java
abstract class Report {
    public final void generate(Data d) {
        validate(d);
        Output out = serialize(d);
        save(out);
        notify(out);
    }
    
    protected abstract Output serialize(Data d);
    
    private void validate(Data d) { ... }
    private void save(Output out) { ... }
    private void notify(Output out) { ... }
}

class CsvReport extends Report {
    protected Output serialize(Data d) { ... }
}
class JsonReport extends Report {
    protected Output serialize(Data d) { ... }
}
```

The varying step is the abstract method; the template (in the parent) is shared. Cures Duplicate Code.

---

## Task 8 — Encapsulate Field (Data Class) (Python)

**Problem:** convert from public-fields style to behavior-rich.

```python
class Account:
    def __init__(self):
        self.balance = 0
        self.transactions = []

# Usage scattered:
account.balance += 100
account.transactions.append({"type": "deposit", "amount": 100})

account.balance -= 50
account.transactions.append({"type": "withdraw", "amount": 50})
```

**Solution:**

```python
class Account:
    def __init__(self):
        self._balance = 0
        self._transactions = []
    
    @property
    def balance(self):
        return self._balance
    
    def deposit(self, amount):
        self._balance += amount
        self._transactions.append({"type": "deposit", "amount": amount})
    
    def withdraw(self, amount):
        if amount > self._balance:
            raise InsufficientFundsError()
        self._balance -= amount
        self._transactions.append({"type": "withdraw", "amount": amount})
    
    def history(self):
        return list(self._transactions)
```

The class enforces invariants (no overdraft) and keeps balance + transaction-log consistent.

---

## Task 9 — Substitute Algorithm (Duplicate Code with Different Implementations) (Java)

**Problem:**

```java
class StringUtils {
    // Two ways to check palindrome — pick one
    public static boolean isPalindrome1(String s) {
        for (int i = 0; i < s.length() / 2; i++) {
            if (s.charAt(i) != s.charAt(s.length() - 1 - i)) return false;
        }
        return true;
    }
    
    public static boolean isPalindrome2(String s) {
        return s.equals(new StringBuilder(s).reverse().toString());
    }
}
```

**Solution:**

```java
class StringUtils {
    public static boolean isPalindrome(String s) {
        for (int i = 0; i < s.length() / 2; i++) {
            if (s.charAt(i) != s.charAt(s.length() - 1 - i)) return false;
        }
        return true;
    }
    // Faster (no allocation, early exit). Drop isPalindrome2.
}
```

Pick based on performance, readability, or both. Delete the loser.

---

## Task 10 — Remove Speculative Hooks (Java)

**Problem:** the workflow has unused hooks.

```java
abstract class Workflow {
    protected void preProcess() {}      // 0 subclasses override
    protected void postProcess() {}     // 0 subclasses override
    protected void onError(Exception e) {}  // 0 subclasses override
    protected void onCancel() {}        // 0 subclasses override
    
    public final void run() {
        preProcess();
        try {
            execute();
            postProcess();
        } catch (Exception e) {
            onError(e);
            throw e;
        }
    }
    
    protected abstract void execute();
}
```

**Solution:**

```java
abstract class Workflow {
    public final void run() {
        execute();  // simple
    }
    
    protected abstract void execute();
}
```

If a hook is needed in the future, add it then. Speculative hooks accumulate cognitive load without payback.

---

## Task 11 — Eliminate Lazy package (Go)

**Problem:**

```go
package taxcalc

import "math/big"

type Calculator struct {
    rate *big.Float
}

func NewCalculator(rate *big.Float) *Calculator {
    return &Calculator{rate: rate}
}

func (c *Calculator) Apply(amount *big.Float) *big.Float {
    out := new(big.Float)
    return out.Mul(amount, c.rate)
}

// One function, used in one place.
```

**Solution:**

```go
package main

func ApplyTax(amount, rate *big.Float) *big.Float {
    out := new(big.Float)
    return out.Mul(amount, rate)
}

// Or just inline at the call site:
// out := new(big.Float).Mul(amount, taxRate)
```

The package was overhead. Promote the function to where it's used or just inline.

---

## Task 12 — Audit a method for all Dispensables (Java)

**Problem:** find every Dispensable.

```java
class CustomerProcessor {
    
    // CustomerProcessor processes customers. (1)
    
    private static final boolean USE_LEGACY = false;  // (2)
    
    /**
     * Process the customer. Step 1: validate. Step 2: enrich. Step 3: save.
     */ // (3)
    public void process(Customer c) {
        // validate
        if (c == null) throw new IllegalArgumentException();
        if (c.getName() == null) throw new IllegalArgumentException();
        
        // enrich
        c.setProcessedAt(LocalDateTime.now());
        
        // save
        if (USE_LEGACY) {
            legacySave(c);  // (2 cont)
        } else {
            modernSave(c);
        }
    }
    
    private void legacySave(Customer c) { /* dead */ }  // (4)
    
    /** @deprecated */ public void processOld(Customer c) {}  // (5)
    
    // Maybe future: a hook for processing
    protected void preProcess(Customer c) {}  // (6)
}
```

**Solution:**

| Issue | Smell | Cure |
|---|---|---|
| (1) Useless class-purpose comment | Comments | Delete |
| (2) `USE_LEGACY = false` | Dead Code | Delete the constant + the legacy branch |
| (3) Method-level Javadoc as step list | Comments (what-comments) | Delete; extract `validate`, `enrich`, `save` methods |
| (4) `legacySave` | Dead Code | Delete |
| (5) `processOld` deprecated method | Dead Code (likely) | Delete after deprecation period |
| (6) `preProcess` empty hook | Speculative Generality | Delete |

After cleanup:

```java
class CustomerProcessor {
    public void process(Customer c) {
        validate(c);
        enrich(c);
        save(c);
    }
    
    private void validate(Customer c) {
        if (c == null) throw new IllegalArgumentException();
        if (c.getName() == null) throw new IllegalArgumentException();
    }
    
    private void enrich(Customer c) {
        c.setProcessedAt(LocalDateTime.now());
    }
    
    private void save(Customer c) {
        modernSave(c);
    }
    
    private void modernSave(Customer c) { ... }
}
```

Or further, if `modernSave` is the only save: rename to `save` and delete the indirection.

---

> **Next:** [find-bug.md](find-bug.md) — bugs hiding in dispensable code.
