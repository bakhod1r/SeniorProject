# Bloaters — Practice Tasks

> 12 hands-on exercises across the five Bloaters. Every task: problem, hint, full solution. At least 4 in each language (Java / Python / Go).

---

## Task 1 — Long Method (Java)

**Problem:** Refactor `processInvoice` so that the top-level method reads as a recipe of named phases. Keep behaviour identical. All tests must still pass.

```java
class InvoiceProcessor {
    public BigDecimal processInvoice(Invoice invoice, Customer customer, String couponCode) {
        // validate
        if (invoice == null) throw new IllegalArgumentException("invoice is null");
        if (invoice.getLines().isEmpty()) throw new IllegalStateException("invoice has no lines");
        if (customer == null) throw new IllegalArgumentException("customer is null");

        // subtotal
        BigDecimal subtotal = BigDecimal.ZERO;
        for (InvoiceLine line : invoice.getLines()) {
            BigDecimal lineTotal = line.getUnitPrice().multiply(BigDecimal.valueOf(line.getQuantity()));
            if (line.getCategory() == Category.BOOK) {
                lineTotal = lineTotal.multiply(new BigDecimal("0.95"));
            }
            subtotal = subtotal.add(lineTotal);
        }

        // discount
        BigDecimal discount = BigDecimal.ZERO;
        if ("SAVE10".equals(couponCode)) {
            discount = subtotal.multiply(new BigDecimal("0.10"));
        }
        if (customer.getTier() == Tier.GOLD) {
            discount = discount.add(subtotal.multiply(new BigDecimal("0.05")));
        }

        // tax
        BigDecimal taxable = subtotal.subtract(discount);
        BigDecimal taxRate = customer.getState().equals("CA")
            ? new BigDecimal("0.0875")
            : new BigDecimal("0.07");
        BigDecimal tax = taxable.multiply(taxRate);

        return subtotal.subtract(discount).add(tax);
    }
}
```

**Hint:** Use Extract Method. Each comment block (`// validate`, `// subtotal`, `// discount`, `// tax`) wants to be a method.

**Solution:**

```java
class InvoiceProcessor {
    public BigDecimal processInvoice(Invoice invoice, Customer customer, String couponCode) {
        validate(invoice, customer);
        BigDecimal subtotal = computeSubtotal(invoice);
        BigDecimal discount = computeDiscount(subtotal, customer, couponCode);
        BigDecimal tax = computeTax(subtotal.subtract(discount), customer);
        return subtotal.subtract(discount).add(tax);
    }

    private void validate(Invoice invoice, Customer customer) {
        if (invoice == null) throw new IllegalArgumentException("invoice is null");
        if (invoice.getLines().isEmpty()) throw new IllegalStateException("invoice has no lines");
        if (customer == null) throw new IllegalArgumentException("customer is null");
    }

    private BigDecimal computeSubtotal(Invoice invoice) {
        return invoice.getLines().stream()
            .map(this::lineTotal)
            .reduce(BigDecimal.ZERO, BigDecimal::add);
    }

    private BigDecimal lineTotal(InvoiceLine line) {
        BigDecimal total = line.getUnitPrice().multiply(BigDecimal.valueOf(line.getQuantity()));
        return line.getCategory() == Category.BOOK
            ? total.multiply(new BigDecimal("0.95"))
            : total;
    }

    private BigDecimal computeDiscount(BigDecimal subtotal, Customer customer, String couponCode) {
        BigDecimal coupon = "SAVE10".equals(couponCode)
            ? subtotal.multiply(new BigDecimal("0.10"))
            : BigDecimal.ZERO;
        BigDecimal loyalty = customer.getTier() == Tier.GOLD
            ? subtotal.multiply(new BigDecimal("0.05"))
            : BigDecimal.ZERO;
        return coupon.add(loyalty);
    }

    private BigDecimal computeTax(BigDecimal taxable, Customer customer) {
        BigDecimal rate = "CA".equals(customer.getState())
            ? new BigDecimal("0.0875")
            : new BigDecimal("0.07");
        return taxable.multiply(rate);
    }
}
```

---

## Task 2 — Primitive Obsession (Java)

**Problem:** `transferMoney(String fromAccountId, String toAccountId, BigDecimal amount, String currency)` — replace the parameters with appropriate value objects. Make it impossible to swap account IDs by mistake at compile time.

**Hint:** Three value objects: `AccountId`, `Money` (which knows its currency).

**Solution:**

```java
final class AccountId {
    private final String value;
    public AccountId(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("AccountId cannot be blank");
        }
        this.value = value;
    }
    public String value() { return value; }
}

enum Currency { USD, EUR, GBP, JPY }

final class Money {
    private final BigDecimal amount;
    private final Currency currency;

    public Money(BigDecimal amount, Currency currency) {
        if (amount == null || currency == null) {
            throw new IllegalArgumentException();
        }
        if (amount.signum() < 0) {
            throw new IllegalArgumentException("Money cannot be negative");
        }
        this.amount = amount;
        this.currency = currency;
    }
    
    public Money add(Money other) {
        if (this.currency != other.currency) {
            throw new IllegalStateException("Cannot add different currencies");
        }
        return new Money(this.amount.add(other.amount), currency);
    }
    public BigDecimal amount() { return amount; }
    public Currency currency() { return currency; }
}

class TransferService {
    public void transfer(AccountId from, AccountId to, Money amount) { /* ... */ }
}

// Now: `transfer(amountObject, fromId, toId)` is a compile error.
// `transfer(fromId, toId, amountObject)` works.
```

---

## Task 3 — Long Parameter List (Python)

**Problem:** Refactor `create_user` to use a parameter object. Use `@dataclass`.

```python
def create_user(
    first_name: str,
    last_name: str,
    email: str,
    phone: str,
    address_line_1: str,
    address_line_2: str | None,
    city: str,
    state: str,
    zip_code: str,
    country: str,
    marketing_opt_in: bool,
    sms_opt_in: bool,
    referral_source: str | None,
):
    ...
```

**Hint:** Notice the Data Clump (`address_*`) — extract `Address`. Notice the boolean flags — group into `MarketingPreferences`.

**Solution:**

```python
from dataclasses import dataclass
from typing import Optional

@dataclass(frozen=True)
class Address:
    line_1: str
    city: str
    state: str
    zip: str
    country: str = "US"
    line_2: Optional[str] = None

@dataclass(frozen=True)
class MarketingPreferences:
    email_opt_in: bool = False
    sms_opt_in: bool = False
    referral_source: Optional[str] = None

@dataclass(frozen=True)
class UserRegistration:
    first_name: str
    last_name: str
    email: str
    phone: str
    address: Address
    marketing: MarketingPreferences = field(default_factory=MarketingPreferences)

def create_user(registration: UserRegistration):
    ...
```

---

## Task 4 — Large Class (Python)

**Problem:** Refactor this class. It has at least three responsibilities mixed together.

```python
class Order:
    def __init__(self, customer_id, items):
        self.customer_id = customer_id
        self.items = items
        self.status = "PENDING"
        self.tracking_number = None
        self.shipping_carrier = None
        self.shipping_address = None
        self.payment_method = None
        self.payment_token = None
        self.payment_status = None
        self.refund_amount = 0
        self.refund_reason = None
    
    def add_item(self, item): ...
    def remove_item(self, item): ...
    def calculate_total(self): ...
    
    def charge(self): ...
    def refund(self, amount, reason): ...
    def is_paid(self): ...
    
    def ship(self, carrier, tracking): ...
    def mark_delivered(self): ...
    def is_shipped(self): ...
```

**Hint:** Extract `Payment`, `Shipment` — the `Order` should coordinate, not own all the details.

**Solution:**

```python
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Optional, List

@dataclass
class Payment:
    method: Optional[str] = None
    token: Optional[str] = None
    status: str = "UNPAID"
    refund_amount: Decimal = Decimal(0)
    refund_reason: Optional[str] = None
    
    def charge(self): ...
    def refund(self, amount: Decimal, reason: str): ...
    def is_paid(self) -> bool:
        return self.status == "PAID"

@dataclass
class Shipment:
    address: Optional[Address] = None
    carrier: Optional[str] = None
    tracking_number: Optional[str] = None
    delivered: bool = False
    
    def ship(self, carrier: str, tracking: str): ...
    def mark_delivered(self): self.delivered = True
    def is_shipped(self) -> bool:
        return self.tracking_number is not None

@dataclass
class Order:
    customer_id: str
    items: List["LineItem"] = field(default_factory=list)
    status: str = "PENDING"
    payment: Payment = field(default_factory=Payment)
    shipment: Shipment = field(default_factory=Shipment)
    
    def add_item(self, item): self.items.append(item)
    def remove_item(self, item): self.items.remove(item)
    def calculate_total(self) -> Decimal:
        return sum(i.subtotal for i in self.items)
```

---

## Task 5 — Data Clumps (Go)

**Problem:** Extract a struct for the `(latitude, longitude)` pair. Update all method signatures.

```go
package main

func DistanceBetween(lat1, lon1, lat2, lon2 float64) float64 { ... }
func IsInZone(lat, lon float64, zoneID string) bool { ... }
func FindNearestStore(lat, lon float64) Store { ... }
func RouteFromTo(fromLat, fromLon, toLat, toLon float64) Route { ... }
```

**Hint:** A `Coordinate` struct prevents `lat`/`lon` swap bugs and gives the type a place to host helpers.

**Solution:**

```go
package main

type Coordinate struct {
    Lat, Lon float64
}

func (c Coordinate) DistanceTo(other Coordinate) float64 { ... }

func DistanceBetween(a, b Coordinate) float64 {
    return a.DistanceTo(b)
}

func IsInZone(c Coordinate, zoneID string) bool { ... }
func FindNearestStore(c Coordinate) Store { ... }
func Route(from, to Coordinate) Route { ... }

// Bonus: a builder for safety at the call site.
func NewCoordinate(lat, lon float64) (Coordinate, error) {
    if lat < -90 || lat > 90 {
        return Coordinate{}, fmt.Errorf("invalid latitude: %f", lat)
    }
    if lon < -180 || lon > 180 {
        return Coordinate{}, fmt.Errorf("invalid longitude: %f", lon)
    }
    return Coordinate{Lat: lat, Lon: lon}, nil
}
```

---

## Task 6 — Long Method (Python)

**Problem:** This function is doing too much. Refactor.

```python
def render_invoice_pdf(invoice, customer, output_path, watermark=None):
    # build context
    context = {
        "invoice_number": invoice.number,
        "date": invoice.date.strftime("%Y-%m-%d"),
        "customer_name": f"{customer.first_name} {customer.last_name}",
        "customer_address": (
            f"{customer.address.line_1}\n{customer.address.city}, "
            f"{customer.address.state} {customer.address.zip}"
        ),
        "items": [
            {
                "description": line.description,
                "quantity": line.quantity,
                "unit_price": f"${line.unit_price:.2f}",
                "subtotal": f"${line.subtotal:.2f}",
            }
            for line in invoice.lines
        ],
        "subtotal": f"${invoice.subtotal:.2f}",
        "tax": f"${invoice.tax:.2f}",
        "total": f"${invoice.total:.2f}",
    }
    
    # render
    template = env.get_template("invoice.html")
    html = template.render(**context)
    
    # convert to pdf
    with open(output_path, "wb") as f:
        pdf = HTML(string=html).write_pdf()
        f.write(pdf)
    
    # watermark
    if watermark:
        from PyPDF2 import PdfReader, PdfWriter
        reader = PdfReader(output_path)
        writer = PdfWriter()
        for page in reader.pages:
            page.merge_page(create_watermark_page(watermark))
            writer.add_page(page)
        with open(output_path, "wb") as f:
            writer.write(f)
```

**Hint:** Three phases: build context, render HTML to PDF, optionally watermark.

**Solution:**

```python
def render_invoice_pdf(invoice, customer, output_path, watermark=None):
    context = build_invoice_context(invoice, customer)
    render_html_to_pdf(context, output_path)
    if watermark:
        apply_watermark(output_path, watermark)


def build_invoice_context(invoice, customer):
    return {
        "invoice_number": invoice.number,
        "date": invoice.date.strftime("%Y-%m-%d"),
        "customer_name": format_full_name(customer),
        "customer_address": format_address(customer.address),
        "items": [format_line(line) for line in invoice.lines],
        "subtotal": format_currency(invoice.subtotal),
        "tax": format_currency(invoice.tax),
        "total": format_currency(invoice.total),
    }


def format_full_name(customer):
    return f"{customer.first_name} {customer.last_name}"


def format_address(address):
    return f"{address.line_1}\n{address.city}, {address.state} {address.zip}"


def format_line(line):
    return {
        "description": line.description,
        "quantity": line.quantity,
        "unit_price": format_currency(line.unit_price),
        "subtotal": format_currency(line.subtotal),
    }


def format_currency(value):
    return f"${value:.2f}"


def render_html_to_pdf(context, output_path):
    template = env.get_template("invoice.html")
    html = template.render(**context)
    with open(output_path, "wb") as f:
        f.write(HTML(string=html).write_pdf())


def apply_watermark(pdf_path, watermark):
    from PyPDF2 import PdfReader, PdfWriter
    reader = PdfReader(pdf_path)
    writer = PdfWriter()
    for page in reader.pages:
        page.merge_page(create_watermark_page(watermark))
        writer.add_page(page)
    with open(pdf_path, "wb") as f:
        writer.write(f)
```

---

## Task 7 — Primitive Obsession (Go)

**Problem:** Replace primitives with named types where appropriate. Make the API harder to misuse.

```go
package billing

func ChargeCustomer(customerID string, amount float64, currency string) error { ... }
```

**Hint:** Three smells: `customerID` is a stringly-typed ID; `amount` is a `float64` (don't use floats for money); `currency` is a free-form string.

**Solution:**

```go
package billing

type CustomerID string

type Currency string
const (
    USD Currency = "USD"
    EUR Currency = "EUR"
    GBP Currency = "GBP"
)

func (c Currency) IsValid() bool {
    switch c {
    case USD, EUR, GBP:
        return true
    }
    return false
}

// Money in minor units (cents) to avoid floating-point error.
type Money struct {
    MinorUnits int64
    Currency   Currency
}

func NewMoney(majorUnits, minorUnits int64, currency Currency) (Money, error) {
    if !currency.IsValid() {
        return Money{}, fmt.Errorf("invalid currency: %s", currency)
    }
    if minorUnits < 0 || minorUnits >= 100 {
        return Money{}, fmt.Errorf("minor units out of range: %d", minorUnits)
    }
    return Money{MinorUnits: majorUnits*100 + minorUnits, Currency: currency}, nil
}

func ChargeCustomer(customer CustomerID, amount Money) error { ... }
```

---

## Task 8 — Large Class (Java)

**Problem:** This class has 6 distinct responsibilities. Extract them.

```java
class GameCharacter {
    // identity
    private String name;
    private int level;
    private long experiencePoints;
    
    // stats
    private int strength, dexterity, constitution, intelligence, wisdom, charisma;
    
    // health
    private int currentHp, maxHp, currentMp, maxMp;
    
    // inventory
    private List<Item> backpack;
    private int gold;
    
    // equipment
    private Item helmet, chest, legs, boots, mainHand, offHand;
    
    // combat
    private boolean inCombat;
    private List<StatusEffect> activeEffects;
    private long lastAttackTime;
    
    // 60+ methods...
}
```

**Hint:** Six clusters → six classes. Result: a `GameCharacter` that *has* an `Identity`, `Stats`, `HealthBar`, `Inventory`, `Equipment`, `CombatState`.

**Solution:**

```java
record Identity(String name, int level, long experiencePoints) {}

record Stats(int strength, int dexterity, int constitution,
             int intelligence, int wisdom, int charisma) {}

class HealthBar {
    private int currentHp, maxHp, currentMp, maxMp;
    public void takeDamage(int dmg) { currentHp = Math.max(0, currentHp - dmg); }
    public void heal(int amount) { currentHp = Math.min(maxHp, currentHp + amount); }
    public boolean isDead() { return currentHp == 0; }
    // ...
}

class Inventory {
    private final List<Item> backpack = new ArrayList<>();
    private int gold;
    public void addItem(Item item) { backpack.add(item); }
    public boolean spend(int amount) {
        if (gold < amount) return false;
        gold -= amount;
        return true;
    }
}

class Equipment {
    private Item helmet, chest, legs, boots, mainHand, offHand;
    public void equip(EquipSlot slot, Item item) { /* ... */ }
}

class CombatState {
    private boolean inCombat;
    private List<StatusEffect> activeEffects = new ArrayList<>();
    private long lastAttackTime;
    public boolean canAttack(long now, long cooldownMs) { return now - lastAttackTime > cooldownMs; }
}

class GameCharacter {
    private final Identity identity;
    private Stats stats;
    private final HealthBar health;
    private final Inventory inventory;
    private final Equipment equipment;
    private final CombatState combat;
}
```

---

## Task 9 — Long Parameter List → Functional Options (Go)

**Problem:** Convert this 9-parameter function into Go's idiomatic functional options pattern.

```go
func NewServer(
    host string,
    port int,
    tlsEnabled bool,
    certPath string,
    keyPath string,
    readTimeout time.Duration,
    writeTimeout time.Duration,
    maxConnections int,
    handler http.Handler,
) *Server {
    ...
}
```

**Hint:** Required: `host`, `port`, `handler`. Everything else: optional via `Option`.

**Solution:**

```go
package server

import (
    "net/http"
    "time"
)

type Server struct {
    host           string
    port           int
    handler        http.Handler
    tls            *TLSConfig
    readTimeout    time.Duration
    writeTimeout   time.Duration
    maxConnections int
}

type TLSConfig struct {
    CertPath, KeyPath string
}

type Option func(*Server)

func WithTLS(cert, key string) Option {
    return func(s *Server) {
        s.tls = &TLSConfig{CertPath: cert, KeyPath: key}
    }
}

func WithReadTimeout(d time.Duration) Option {
    return func(s *Server) { s.readTimeout = d }
}

func WithWriteTimeout(d time.Duration) Option {
    return func(s *Server) { s.writeTimeout = d }
}

func WithMaxConnections(n int) Option {
    return func(s *Server) { s.maxConnections = n }
}

func NewServer(host string, port int, handler http.Handler, opts ...Option) *Server {
    s := &Server{
        host:    host,
        port:    port,
        handler: handler,
        // sensible defaults:
        readTimeout:    10 * time.Second,
        writeTimeout:   10 * time.Second,
        maxConnections: 1000,
    }
    for _, opt := range opts {
        opt(s)
    }
    return s
}

// Usage:
// s := NewServer("localhost", 8080, mux, WithTLS("/etc/cert", "/etc/key"), WithMaxConnections(5000))
```

---

## Task 10 — Data Clumps + Primitive Obsession (Java)

**Problem:** Identify two smells and fix both at once.

```java
class FlightSearch {
    public List<Flight> search(
        String fromAirportCode, String fromCity, String fromCountry,
        String toAirportCode, String toCity, String toCountry,
        LocalDate departureDate, LocalDate returnDate,
        int adultCount, int childCount, int infantCount,
        String cabinClass
    ) { ... }
}
```

**Hint:** Two clumps (origin/destination location) plus two value concepts (passenger count, cabin class). Both Data Clumps and Primitive Obsession (`String cabinClass`).

**Solution:**

```java
record Airport(String code, String city, String country) {
    public Airport {
        if (code == null || code.length() != 3) {
            throw new IllegalArgumentException("Airport code must be 3 letters");
        }
    }
}

record DateRange(LocalDate from, LocalDate to) {
    public DateRange {
        if (to.isBefore(from)) throw new IllegalArgumentException("Return before departure");
    }
}

record PassengerCount(int adults, int children, int infants) {
    public PassengerCount {
        if (adults < 1) throw new IllegalArgumentException("At least one adult required");
        if (infants > adults) throw new IllegalArgumentException("Each infant needs an adult");
    }
}

enum CabinClass { ECONOMY, PREMIUM_ECONOMY, BUSINESS, FIRST }

record FlightSearchRequest(
    Airport origin,
    Airport destination,
    DateRange travelDates,
    PassengerCount passengers,
    CabinClass cabin
) {}

class FlightSearch {
    public List<Flight> search(FlightSearchRequest request) { ... }
}
```

---

## Task 11 — Replace Method with Method Object (Java)

**Problem:** This long method has 8 local variables that interact heavily. Plain Extract Method would force passing 8 parameters around. Use Replace Method with Method Object instead.

```java
class StatisticsAnalyzer {
    public Stats analyze(double[] data) {
        int n = data.length;
        double sum = 0, sumSq = 0, min = Double.POSITIVE_INFINITY, max = Double.NEGATIVE_INFINITY;
        int positiveCount = 0, negativeCount = 0;
        for (double x : data) {
            sum += x;
            sumSq += x * x;
            if (x < min) min = x;
            if (x > max) max = x;
            if (x > 0) positiveCount++;
            if (x < 0) negativeCount++;
        }
        double mean = sum / n;
        double variance = (sumSq / n) - mean * mean;
        double stdDev = Math.sqrt(variance);
        double median = computeMedian(data);
        // ... 50 more lines computing percentiles, mode, kurtosis ...
        return new Stats(n, mean, stdDev, min, max, positiveCount, negativeCount, median /* + more */);
    }
}
```

**Hint:** Create an `Analysis` class. Move `data`, `n`, `sum`, `sumSq`, `min`, `max`, `positiveCount`, `negativeCount` into fields. Each phase becomes a method on the new class.

**Solution:**

```java
class StatisticsAnalyzer {
    public Stats analyze(double[] data) {
        return new Analysis(data).compute();
    }
}

class Analysis {
    private final double[] data;
    private final int n;
    private double sum, sumSq, min, max;
    private int positiveCount, negativeCount;

    Analysis(double[] data) {
        this.data = data;
        this.n = data.length;
        this.min = Double.POSITIVE_INFINITY;
        this.max = Double.NEGATIVE_INFINITY;
    }

    public Stats compute() {
        accumulate();
        double mean = sum / n;
        double stdDev = Math.sqrt(sumSq / n - mean * mean);
        double median = computeMedian();
        // ... percentiles, mode, kurtosis as separate methods ...
        return new Stats(n, mean, stdDev, min, max, positiveCount, negativeCount, median);
    }

    private void accumulate() {
        for (double x : data) {
            sum += x;
            sumSq += x * x;
            if (x < min) min = x;
            if (x > max) max = x;
            if (x > 0) positiveCount++;
            if (x < 0) negativeCount++;
        }
    }

    private double computeMedian() { ... }
    // ... other computations as methods, all sharing the analysis state
}
```

---

## Task 12 — Bloater audit (Python — open-ended)

**Problem:** Below is a real-looking class. List **every Bloater** you can identify and write a one-line plan for fixing each.

```python
class CustomerRecord:
    def __init__(
        self,
        first_name, last_name, middle_name, suffix,
        email, phone_home, phone_work, phone_mobile,
        addr_line_1, addr_line_2, addr_city, addr_state, addr_zip, addr_country,
        bill_line_1, bill_line_2, bill_city, bill_state, bill_zip, bill_country,
        ssn, dob, drivers_license, passport_number,
        bank_account, bank_routing, credit_card, credit_expiry, credit_cvv,
        orders, support_tickets, login_history, audit_log,
        marketing_email, marketing_sms, marketing_push, marketing_referral,
        loyalty_tier, loyalty_points, loyalty_joined,
        is_active, is_premium, is_internal, is_test, created_at, updated_at,
        last_login, last_purchase, last_support_contact,
    ):
        # 50 lines of self.x = x
        ...
    
    def update_email(self, new_email):
        # 30 lines: validation, normalization, audit log, send confirmation, ...
        ...
    
    def calculate_lifetime_value(self):
        # 80 lines: sum of orders, refunds, discounts, projected future, churn risk, ...
        ...
    
    def detect_fraud(self):
        # 200 lines: 14 heuristics inline
        ...
```

**Solution:**

| Bloater | Where | Fix |
|---|---|---|
| Long Parameter List | `__init__` | Group: `PersonName`, `ContactInfo`, `Address`, `BillingAddress` (or alias to `Address`), `IdentityDocs`, `PaymentMethod`, `MarketingPreferences`, `LoyaltyStatus`, `Flags`, `Timestamps`. Constructor takes ~10 grouped objects, not 50 raw fields. |
| Data Clumps × 2 | `addr_*`, `bill_*` (same fields twice) | Extract `Address` class; both shipping and billing use it. |
| Data Clumps | `phone_*` | Extract `PhoneBook` (multiple numbers with labels) or accept that phones are a list of `(label, number)`. |
| Primitive Obsession | `ssn`, `dob`, `drivers_license`, `passport_number`, `credit_card`, `email`, `phone_*` | Each becomes a value object with validation. PII types should be separate to support data classification (GDPR). |
| Large Class | `CustomerRecord` | Extract: `Identity`, `ContactInfo`, `Addresses`, `Documents`, `PaymentMethods`, `OrderHistory`, `SupportHistory`, `MarketingPreferences`, `LoyaltyAccount`, `Flags`, `AuditTimestamps`. |
| Long Method | `update_email` (30 lines doing 5 things) | Extract: validate, normalize, audit, notify, persist. |
| Long Method | `calculate_lifetime_value` (80 lines, multiple sub-calcs) | Extract per sub-calculation; consider Replace Method with Method Object. |
| Long Method | `detect_fraud` (200 lines, 14 heuristics) | Extract one method per heuristic. Better: each heuristic is a `FraudRule` object; `detect_fraud` runs `[rule.check(record) for rule in rules]`. (This sets up the [Strategy](../../../design-patterns/03-behavioral/08-strategy/junior.md) pattern.) |

**Order of attack** (recommended):

1. Extract value objects (`Email`, `SSN`, `DOB`, etc.) — fixes Primitive Obsession.
2. Extract `Address` — fixes Data Clumps.
3. Replace Method with Method Object on `detect_fraud`.
4. Extract Class on the `CustomerRecord` clusters.
5. Re-examine `__init__`: it should now take ~10 grouped objects, no Long Parameter List.

---

> **Next:** [find-bug.md](find-bug.md) — buggy snippets where Bloater-related issues hide.
