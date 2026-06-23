# Bloaters — Find the Bug

> 12 buggy snippets where the bug is hidden inside a Bloater. Find it first; the fix often involves refactoring the smell.

---

## Bug 1 — Long Method hides a fall-through (Java)

```java
public double calculateShipping(Order order, Customer customer) {
    double weight = 0;
    for (OrderItem item : order.getItems()) {
        weight += item.getWeight();
    }
    
    double base = 5.99;
    if (weight > 50) base = 24.99;
    else if (weight > 10) base = 12.99;
    
    if (order.getCouponCode() != null && order.getCouponCode().equals("FREESHIP")) {
        base = 0;
    }
    
    if (customer.getTier() == Tier.GOLD) {
        base = base * 0.9;
    } else if (customer.getTier() == Tier.PLATINUM) {
        base = base * 0.8;
    } else if (customer.getTier() == Tier.DIAMOND) {
        base = base * 0.7;
    }
    
    if (order.getShippingAddress().getCountry().equals("US")) {
        return base;
    } else if (order.getShippingAddress().getCountry().equals("CA")) {
        return base * 1.5;
    } else {
        return base * 2.5;
    }
}
```

**Where is the bug?**

<details><summary>Hint</summary>

The `FREESHIP` coupon zeroes out the shipping. But what does the next block do?
</details>

<details><summary>Diagnosis</summary>

After `base = 0` from `FREESHIP`, the **loyalty tier multiplier** still runs. `0 * 0.9` is still `0`, no harm. But then the **international shipping multiplier** also runs. Still `0` — no immediate harm.

But wait — there's a subtler issue. If a Diamond customer in Canada uses `FREESHIP`, they pay `$0`. Fine. But if a Diamond customer (no `FREESHIP`) ships internationally with `weight > 50`: `24.99 * 0.7 * 2.5 = $43.73`. That's correct. **However**, the order of multipliers depends on the `if` order — if a future engineer reorders the blocks, the multiplications still produce the same result (multiplication is associative). So far, so good.

**The actual bug:** the loyalty tier discount applies to `FREESHIP` orders silently. If a marketing campaign tracks "tier discount applied" via a side channel (e.g., logs, metrics), every `FREESHIP` order falsely reports a tier discount applied. That metric is wrong.

**Why it hid:** the method is too long for anyone to notice that "free" still goes through the discount block. Extract Method makes the phases visible; one phase clearly shouldn't apply if shipping is already zero.

**Fix:**

```java
public double calculateShipping(Order order, Customer customer) {
    if (hasFreeShippingCoupon(order)) {
        return 0; // short-circuit — no further discounts apply
    }
    double base = baseShippingForWeight(weight(order));
    base = applyLoyaltyDiscount(base, customer);
    base = applyInternationalSurcharge(base, order.getShippingAddress());
    return base;
}
```
</details>

---

## Bug 2 — Primitive Obsession hides a unit error (Python)

```python
def calculate_fuel_required(distance, vehicle_efficiency):
    """
    distance: kilometers
    vehicle_efficiency: liters per 100 km
    Returns: liters of fuel required
    """
    return (distance / 100) * vehicle_efficiency


# Caller (in another file):
miles_to_destination = 250  # miles, from a US-based map provider
mpg = 30                     # miles per gallon
fuel = calculate_fuel_required(miles_to_destination, mpg)
print(f"Need {fuel:.1f} liters")
```

**Where is the bug?**

<details><summary>Diagnosis</summary>

The function expects km and L/100km. The caller passes miles and mpg. Result: meaningless. The user gets a confidently wrong "liters" number based on miles and MPG.

This is **Primitive Obsession**: `distance: float` doesn't say "km"; `vehicle_efficiency: float` doesn't say "L/100km." The function and caller speak different units, and Python's type system can't catch it.

**Fix:** value types with units.

```python
from dataclasses import dataclass

@dataclass(frozen=True)
class Distance:
    km: float
    @classmethod
    def from_miles(cls, miles): return cls(km=miles * 1.60934)

@dataclass(frozen=True)
class FuelEfficiency:
    liters_per_100km: float
    @classmethod
    def from_mpg(cls, mpg): return cls(liters_per_100km=235.215 / mpg)

@dataclass(frozen=True)
class Volume:
    liters: float

def calculate_fuel_required(distance: Distance, efficiency: FuelEfficiency) -> Volume:
    return Volume(liters=(distance.km / 100) * efficiency.liters_per_100km)

# Caller:
fuel = calculate_fuel_required(
    Distance.from_miles(250),
    FuelEfficiency.from_mpg(30),
)
```

The conversion happens at the boundary; the function can never receive bad units.
</details>

---

## Bug 3 — Large Class hides a stale field (Go)

```go
type GameSession struct {
    SessionID    string
    PlayerID     string
    StartedAt    time.Time
    LastActivity time.Time
    Score        int
    Level        int
    InventoryV1  []Item // legacy, before 2.0
    InventoryV2  map[ItemID]int
    Achievements map[string]bool
    Cosmetics    []Cosmetic
    Friends      []string
    Settings     Settings
    LastLevelUp  time.Time
    PauseStart   time.Time
    IsPaused     bool
    // ... 30 more fields
}

func (g *GameSession) AddItem(item Item) {
    g.InventoryV2[item.ID]++
}

func (g *GameSession) CountItems() int {
    total := 0
    for _, item := range g.InventoryV1 {
        total += item.Quantity
    }
    return total
}
```

**Where is the bug?**

<details><summary>Diagnosis</summary>

`AddItem` writes to `InventoryV2`. `CountItems` reads from `InventoryV1` (the legacy field). After a 2.0 migration, no one updates `InventoryV1` — `CountItems` always returns 0 (or the pre-migration count, frozen).

**Why it hid:** the struct has 40+ fields. The two methods are 15 lines apart. No reader notices that one says `V1`, the other `V2`.

**Fix:** Extract Class — `Inventory` type with one source of truth.

```go
type Inventory struct {
    items map[ItemID]int
}

func (inv *Inventory) Add(item Item) { inv.items[item.ID]++ }
func (inv *Inventory) Count() int {
    total := 0
    for _, qty := range inv.items {
        total += qty
    }
    return total
}

type GameSession struct {
    SessionID    string
    PlayerID     string
    Inventory    *Inventory
    // ...
}
```

The bug becomes structurally impossible — there's no `V1` to read from.
</details>

---

## Bug 4 — Long Parameter List wrong-order bug (Java)

```java
public class TransferService {
    public void transfer(String fromAccount, String toAccount, BigDecimal amount) {
        accountRepository.debit(fromAccount, amount);
        accountRepository.credit(toAccount, amount);
        auditLog.record("TRANSFER", fromAccount, toAccount, amount);
    }
}

// Test:
@Test
void testTransfer() {
    transferService.transfer("BOB", "ALICE", new BigDecimal("100"));
    assertEquals(new BigDecimal("100"), accountRepository.balance("ALICE"));
    assertEquals(new BigDecimal("-100"), accountRepository.balance("BOB"));
}

// Production caller (added later):
public void refundOrder(Order order, Customer customer) {
    transferService.transfer(
        order.getMerchantAccount().getId(),
        customer.getAccountId(),
        order.getRefundAmount()
    );
}
```

**Where is the bug?**

<details><summary>Diagnosis</summary>

In `refundOrder`, the *merchant* is `from` and the *customer* is `to`. That's correct: the merchant's money goes back to the customer. But look at the parameter list: are we sure `merchantAccountId` should be the first arg?

The signature is `transfer(String fromAccount, String toAccount, BigDecimal amount)`. We're passing `merchant, customer, amount`. Money flows **from merchant to customer**. That looks right.

But wait — three months ago, a different engineer wrote `chargeOrder`:

```java
public void chargeOrder(Order order, Customer customer) {
    transferService.transfer(
        order.getMerchantAccount().getId(),  // (!)
        customer.getAccountId(),
        order.getTotalAmount()
    );
}
```

In `chargeOrder`, the **customer** should pay the **merchant**: money flows from customer to merchant. But this code passes `(merchant, customer, amount)`. Money flows backward — merchant pays the customer their order total.

**Why it hid:** two `String` parameters with no type distinction. The compiler accepts any order. Tests didn't catch it because the test uses easy-to-distinguish names like `"BOB"` and `"ALICE"`; production uses opaque IDs.

**Fix:** typed accounts + named "from/to" or named methods.

```java
final class AccountId {
    private final String value;
    public AccountId(String value) { this.value = value; }
}

public class TransferService {
    public void transferFromTo(AccountId from, AccountId to, Money amount) { ... }
}
```

Even better — eliminate the order question entirely with named methods:

```java
public void debit(AccountId account, Money amount) { ... }
public void credit(AccountId account, Money amount) { ... }
public void transfer(AccountId from, AccountId to, Money amount) {
    debit(from, amount);
    credit(to, amount);
}
```

Now `chargeOrder` reads as: `customerAccount.transferTo(merchantAccount, total)` — direction is unambiguous.
</details>

---

## Bug 5 — Data Clumps + lat/lon swap (Python)

```python
def find_stores_within(km, customer_lat, customer_lon, store_locations):
    nearby = []
    for store in store_locations:
        d = haversine(store.lat, store.lon, customer_lat, customer_lon)
        if d <= km:
            nearby.append(store)
    return nearby

def haversine(lat1, lon1, lat2, lon2):
    # standard implementation
    ...

# Caller:
city_lat, city_lon = (-73.9857, 40.7484)  # Empire State Building... or is it?
nearby = find_stores_within(5, city_lat, city_lon, all_stores)
```

**Where is the bug?**

<details><summary>Diagnosis</summary>

`(-73.9857, 40.7484)` — the first number is the **longitude** of the Empire State Building, the second is the **latitude**. The caller assigned them to variables named `city_lat, city_lon` in the wrong order.

`find_stores_within` is called with `(city_lat, city_lon)` which actually contain `(lon, lat)`. Inside `haversine`, this swaps two arguments. Result: stores located by reflecting NYC across the equator, then across the prime meridian. Likely no stores nearby; the customer thinks "no stores in your area."

**Why it hid:** four loose `float` parameters. Names guide nothing — Python doesn't enforce. A `Coordinate` value object refuses ambiguous construction:

```python
@dataclass(frozen=True)
class Coordinate:
    lat: float
    lon: float
    def __post_init__(self):
        if not -90 <= self.lat <= 90:
            raise ValueError(f"lat out of range: {self.lat}")
        if not -180 <= self.lon <= 180:
            raise ValueError(f"lon out of range: {self.lon}")
```

The constructor would have *raised* for `Coordinate(lat=-73.9857, lon=40.7484)` because `-73.9857` is a valid latitude but `40.7484` is also a valid longitude — so this particular swap doesn't trigger. **Not all swaps are catchable.** But the named fields at the construction site (`Coordinate(lat=40.7484, lon=-73.9857)`) make the swap visible to any reviewer.

For complete safety, use **distinct types** (Latitude, Longitude as `NewType`s in Python or named types in Go/Kotlin) so swap is a compile error.
</details>

---

## Bug 6 — Long Method silently skips a step (Go)

```go
func ProcessOrder(o *Order, c *Customer) error {
    // validate
    if o == nil || c == nil {
        return errors.New("nil order or customer")
    }
    if len(o.Items) == 0 {
        return errors.New("empty order")
    }
    
    // calculate prices
    o.Subtotal = 0
    for _, item := range o.Items {
        o.Subtotal += item.UnitPrice * float64(item.Quantity)
    }
    
    // apply tax
    if c.State == "CA" {
        o.Tax = o.Subtotal * 0.0875
    } else if c.State == "NY" {
        o.Tax = o.Subtotal * 0.08
    } else {
        o.Tax = o.Subtotal * 0.06
    }
    
    o.Total = o.Subtotal + o.Tax
    
    // charge customer
    txnID, err := paymentGateway.Charge(c.PaymentMethod, o.Total)
    if err != nil {
        return err
    }
    o.PaymentTxnID = txnID
    
    // ship it
    trackingNumber, err := shippingService.Ship(c.Address, o.Items)
    if err != nil {
        return err
    }
    o.TrackingNumber = trackingNumber
    
    // notify
    return notifyCustomer(c.Email, o)
}
```

**Where is the bug?**

<details><summary>Diagnosis</summary>

If `paymentGateway.Charge` succeeds but `shippingService.Ship` fails, the function returns the shipping error. **The customer was charged but no shipment was created.** No refund is issued.

**Why it hid:** the long method's linear flow makes it look like "one transaction." It's not — these are separate distributed steps with no rollback. Extract Method makes the phases distinct objects; a transaction-level coordinator would handle rollback explicitly:

```go
func ProcessOrder(o *Order, c *Customer) error {
    if err := validate(o, c); err != nil {
        return err
    }
    if err := calculatePricing(o, c); err != nil {
        return err
    }
    txn, err := charge(c.PaymentMethod, o.Total)
    if err != nil {
        return err
    }
    if err := ship(o, c.Address); err != nil {
        // ROLLBACK the charge — shipping failed.
        if refundErr := refund(txn); refundErr != nil {
            // alert ops; we have an inconsistent state
            return fmt.Errorf("ship failed AND refund failed: %v / %v", err, refundErr)
        }
        return err
    }
    return notifyCustomer(c.Email, o)
}
```

The Long Method hid the missing rollback. Splitting forces you to think about each phase's failure semantics.
</details>

---

## Bug 7 — Primitive Obsession allows negative money (Java)

```java
public class Account {
    private double balance;
    
    public void deposit(double amount) {
        balance += amount;
    }
    
    public boolean withdraw(double amount) {
        if (balance >= amount) {
            balance -= amount;
            return true;
        }
        return false;
    }
}

// Caller (intern's first commit):
account.deposit(-500);  // accidentally negative
```

**Where is the bug?**

<details><summary>Diagnosis</summary>

`deposit(-500)` reduces the balance by $500 with no rejection. The signature accepts any `double` — including negatives, NaN, infinity.

**Fix:** introduce `Money` value type that refuses negative or NaN values at construction:

```java
public final class Money {
    private final BigDecimal amount;
    
    public Money(BigDecimal amount) {
        if (amount == null) throw new NullPointerException();
        if (amount.signum() < 0) throw new IllegalArgumentException("negative money");
        this.amount = amount;
    }
    
    public Money add(Money other) { return new Money(amount.add(other.amount)); }
}
```

Now `account.deposit(new Money(new BigDecimal("-500")))` throws at construction, before any side effect.

Bonus: `double` is wrong for money anyway (rounding error). The fix solves two problems at once.
</details>

---

## Bug 8 — Boolean parameter inverted (Python)

```python
def send_notification(user, message, send_email=True, send_sms=False, send_push=False, urgent=False, allow_quiet_hours=True):
    if send_email and (urgent or not user.is_in_quiet_hours() or not allow_quiet_hours):
        email_service.send(user.email, message)
    ...

# Caller:
send_notification(user, "Critical: account compromised", True, True, True, True, True)
```

**Where is the bug?**

<details><summary>Diagnosis</summary>

The last argument is `allow_quiet_hours=True`. The caller wanted "send urgently, ignore quiet hours" — but `allow_quiet_hours=True` means "respect quiet hours." The intern reading "True True True True True" assumed "everything True = full force notification."

**Why it hid:** Long Parameter List of booleans. The semantics of each boolean is invisible at the call site.

**Fix:** Replace Parameter with Explicit Methods + Parameter Object.

```python
@dataclass(frozen=True)
class NotificationChannels:
    email: bool = False
    sms: bool = False
    push: bool = False
    
@dataclass(frozen=True)
class NotificationPolicy:
    urgent: bool = False
    bypass_quiet_hours: bool = False  # renamed: positive sense

def send_notification(
    user, 
    message, 
    channels: NotificationChannels,
    policy: NotificationPolicy = NotificationPolicy(),
):
    ...

# Caller — meaning is obvious:
send_notification(
    user,
    "Critical: account compromised",
    NotificationChannels(email=True, sms=True, push=True),
    NotificationPolicy(urgent=True, bypass_quiet_hours=True),
)
```
</details>

---

## Bug 9 — Stale duplicated logic across two methods (Java)

```java
class PriceCalculator {
    public BigDecimal computeOrderTotal(Order order) {
        BigDecimal total = BigDecimal.ZERO;
        for (OrderLine line : order.getLines()) {
            BigDecimal lineTotal = line.getUnitPrice()
                .multiply(BigDecimal.valueOf(line.getQuantity()));
            if (line.getCategory() == Category.BOOK) {
                lineTotal = lineTotal.multiply(new BigDecimal("0.95"));
            }
            total = total.add(lineTotal);
        }
        return total;
    }
    
    public BigDecimal computeQuoteTotal(Quote quote) {
        BigDecimal total = BigDecimal.ZERO;
        for (QuoteLine line : quote.getLines()) {
            BigDecimal lineTotal = line.getUnitPrice()
                .multiply(BigDecimal.valueOf(line.getQuantity()));
            total = total.add(lineTotal);  // <-- no book discount!
        }
        return total;
    }
}
```

**Where is the bug?**

<details><summary>Diagnosis</summary>

`computeOrderTotal` applies a 5% book discount; `computeQuoteTotal` does not. Customers receive quotes for $X and orders for $0.95X — they're charged less than quoted, every time, on book purchases.

**Why it hid:** Duplicate Code disguised as "two slightly different methods." Both methods are 7 lines of nearly identical loops; the difference is one missing line. Extract Method would catch this:

```java
private BigDecimal lineTotal(LineLike line) {
    BigDecimal raw = line.getUnitPrice().multiply(BigDecimal.valueOf(line.getQuantity()));
    return line.getCategory() == Category.BOOK
        ? raw.multiply(new BigDecimal("0.95"))
        : raw;
}

public BigDecimal computeOrderTotal(Order order) {
    return order.getLines().stream().map(this::lineTotal).reduce(BigDecimal.ZERO, BigDecimal::add);
}

public BigDecimal computeQuoteTotal(Quote quote) {
    return quote.getLines().stream().map(this::lineTotal).reduce(BigDecimal.ZERO, BigDecimal::add);
}
```

Now the discount lives in one place. Both methods use it.
</details>

---

## Bug 10 — Field shadowed by extracted class (Go)

```go
type Customer struct {
    Name    string
    Address Address
    
    // legacy fields (not removed yet during migration)
    Street, City, State, Zip string
}

type Address struct {
    Street, City, State, Zip string
}

func (c *Customer) ShippingLabel() string {
    return fmt.Sprintf("%s\n%s\n%s, %s %s", c.Name, c.Street, c.City, c.State, c.Zip)
}

func UpdateAddress(c *Customer, newAddress Address) {
    c.Address = newAddress
}
```

**Where is the bug?**

<details><summary>Diagnosis</summary>

`UpdateAddress` writes `c.Address`. `ShippingLabel` reads from `c.Street`, `c.City`, etc. — the **old** fields. After updating address, the shipping label still uses the pre-update address. Returns wrong shipping data.

**Why it hid:** the Large Struct kept old fields "for safety during migration." Both old and new exist; each method touches one set or the other; tests likely test setters but not the cross-field consistency.

**Fix:** delete the old fields. Use the new struct exclusively. If "safety during migration" is needed, do it via a clear migration step (read old, write new, then a follow-up that removes old) — not by leaving stale duplicates.

```go
type Customer struct {
    Name    string
    Address Address
}

func (c *Customer) ShippingLabel() string {
    return fmt.Sprintf("%s\n%s\n%s, %s %s",
        c.Name, c.Address.Street, c.Address.City, c.Address.State, c.Address.Zip)
}
```
</details>

---

## Bug 11 — Shared mutable state inside Long Method (Python)

```python
class StatsTracker:
    def __init__(self):
        self.total = 0
        self.count = 0
    
    def process(self, items):
        # filter
        items = [x for x in items if x is not None]
        # sum
        for x in items:
            self.total += x
        # count
        self.count += len(items)
        # average  <-- bug?
        avg = self.total / self.count
        # report
        print(f"Average: {avg}")

# Usage:
tracker = StatsTracker()
tracker.process([1, 2, 3, 4, 5])  # avg: 3.0
tracker.process([10, 20, 30])      # avg: ?
```

**Where is the bug?**

<details><summary>Diagnosis</summary>

`self.total` and `self.count` accumulate across calls (the class is meant to track stats *across* calls). But the `avg` computed inside `process` uses the **running totals** — `(1+2+3+4+5+10+20+30) / 8 = 75/8 = 9.375`, not `60/3 = 20` (the average of the second batch).

If the user expected "average of *this* batch," the code is wrong. If they expected "running average," the code is right but the variable name `avg` doesn't say so.

**Why it hid:** the Long Method mixes per-call computation with cumulative state. Three responsibilities tangled (filter, accumulate, compute, report) and the `avg = self.total / self.count` line straddles them. Extract Method (or split the class entirely):

```python
@dataclass
class BatchResult:
    sum: int
    count: int
    
    @property
    def average(self): return self.sum / self.count if self.count else 0

class StatsTracker:
    def __init__(self):
        self.cumulative = BatchResult(0, 0)
    
    def process(self, items):
        valid = [x for x in items if x is not None]
        batch = BatchResult(sum=sum(valid), count=len(valid))
        self.cumulative = BatchResult(
            sum=self.cumulative.sum + batch.sum,
            count=self.cumulative.count + batch.count,
        )
        return batch  # caller knows whether they want batch or running
```

Now "this batch's average" and "running average" are explicit and named.
</details>

---

## Bug 12 — Boolean trap in API (Go)

```go
type User struct {
    Name      string
    Email     string
    Validated bool
    Active    bool
    Banned    bool
}

func (u *User) CanLogin() bool {
    return u.Validated && u.Active && !u.Banned
}

func CreateUser(name, email string, validated, active, banned bool) *User {
    return &User{Name: name, Email: email, Validated: validated, Active: active, Banned: banned}
}

// Test fixture:
testUser := CreateUser("Alice", "alice@x.com", true, true, false)
// Different test, written 6 months later by a different person:
testUser2 := CreateUser("Bob", "bob@x.com", true, false, true)
```

**Where is the bug?**

<details><summary>Diagnosis</summary>

`CreateUser("Bob", "bob@x.com", true, false, true)` — what state is Bob in?

- `validated=true` ✓
- `active=false` ✗
- `banned=true` ✗

This makes sense for some test ("Bob is a banned, inactive user"). Or does the test author think the third arg is `active` and the fourth is `banned`? Hard to tell — the args are positional booleans.

The author probably meant "Bob is validated and *not yet* active, awaiting activation." If the order is mistakenly remembered as `(name, email, validated, banned, active)`, the test creates a *banned active* user — semantically nonsense.

**Why it hid:** boolean trap. Three booleans in a row, distinguishable only by parameter order — invisible at the call site.

**Fix:** model the user state as an enum/sealed type, not three independent booleans.

```go
type UserState int
const (
    PendingValidation UserState = iota
    Validated
    Active
    Banned
    Deleted
)

func (s UserState) CanLogin() bool {
    return s == Active
}

type User struct {
    Name  string
    Email string
    State UserState
}

func CreateUser(name, email string, state UserState) *User {
    return &User{Name: name, Email: email, State: state}
}

// Tests:
alice := CreateUser("Alice", "alice@x.com", Active)
bob   := CreateUser("Bob", "bob@x.com", PendingValidation)
```

Three booleans encoded "user state" — but most combinations are nonsensical (`Validated=false, Active=true` — active without validation?). The enum forbids invalid states by construction.
</details>

---

> **Next:** [optimize.md](optimize.md) — inefficient implementations of Bloater fixes that look correct but have subtle performance issues.
