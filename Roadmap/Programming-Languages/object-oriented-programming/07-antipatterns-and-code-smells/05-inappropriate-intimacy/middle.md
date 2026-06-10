# Inappropriate Intimacy — Middle

> **What?** Five concrete refactoring moves that remove Inappropriate Intimacy: Move Method, Move Field, Extract Class, Hide Delegate, and Change Bidirectional Association to Unidirectional. Each one is shown on a realistic domain with a faulty starting pair, a named smell, and the smallest diff that fixes it.
> **How?** When you see two classes sharing state, the question is never "should I refactor?" but "*which* refactor?". This file is the decision tree: read the symptom, match it to the move, apply the diff, run the tests.

---

## 1. Symptoms first, refactor second

Inappropriate Intimacy shows up in five recognisable shapes. Each shape has one canonical refactoring move. Naming the shape before reaching for the refactor saves you from doing the wrong cleanup — splitting a cohesive pair, or merging two classes that should have been separated differently.

| Symptom                                                  | Canonical move                              |
|----------------------------------------------------------|---------------------------------------------|
| Method on `A` uses fields of `B` more than its own       | **Move Method** to `B`                      |
| Field on `A` is only ever read/written by `B`            | **Move Field** to `B`                       |
| Two classes share a cluster of state nobody else touches | **Extract Class** for the shared cluster    |
| Callers walk `a.b().c().d()` getter chains               | **Hide Delegate**: expose `a.d()` directly  |
| `A` holds `B` *and* `B` holds `A`, no clear owner        | **Change Bidirectional to Unidirectional**  |

The rest of this file is one section per move with a real example.

---

## 2. Move Method — `Order` doing `Customer`'s work

Reservation system. `Order` has a method that mostly reads `Customer`:

```java
public class Order {
    private final Customer customer;
    private final List<LineItem> items;

    public BigDecimal discountedTotal() {
        BigDecimal raw = items.stream()
                              .map(LineItem::price)
                              .reduce(BigDecimal.ZERO, BigDecimal::add);
        // All of the discount logic is about the customer:
        if (customer.getTier() == Tier.GOLD)        return raw.multiply(new BigDecimal("0.90"));
        if (customer.loyaltyYears() >= 5)           return raw.multiply(new BigDecimal("0.95"));
        if (customer.hasActivePromoCode())          return raw.subtract(customer.promoAmount());
        return raw;
    }
}
```

`discountedTotal` uses one piece of `Order` (`items` to compute `raw`) and four pieces of `Customer` (tier, loyalty years, promo flag, promo amount). The method is *envious* of `Customer` — and to satisfy that envy, `Customer` exposes four getters that exist only for this one method.

Move the discount calculation onto `Customer`:

```java
public class Customer {
    public BigDecimal discountOn(BigDecimal raw) {
        if (tier == Tier.GOLD)         return raw.multiply(new BigDecimal("0.90"));
        if (loyaltyYears() >= 5)       return raw.multiply(new BigDecimal("0.95"));
        if (hasActivePromoCode())      return raw.subtract(promoAmount());
        return raw;
    }
}

public class Order {
    public BigDecimal discountedTotal() {
        BigDecimal raw = items.stream()
                              .map(LineItem::price)
                              .reduce(BigDecimal.ZERO, BigDecimal::add);
        return customer.discountOn(raw);
    }
}
```

`Customer` can now keep `tier`, `loyaltyYears`, and `hasActivePromoCode` *private*. `Order` no longer knows the discount rules. The class that owns the data owns the calculation — that's Tell, Don't Ask in one move.

---

## 3. Move Field — `Customer.lastOrderTotal` belongs to `Order`

Same domain, different smell. Look at this innocent-looking field:

```java
public class Customer {
    private BigDecimal lastOrderTotal;     // updated only by Order.recalculate()
    public BigDecimal getLastOrderTotal() { return lastOrderTotal; }
}

public class Order {
    private final Customer customer;
    private BigDecimal total;

    public void recalculate() {
        total = computeTotal();
        customer.lastOrderTotal = total;    // package-private write across classes
    }
}
```

`Customer` carries a field nobody on `Customer` writes. `Order` writes a field nobody on `Order` reads back. The field is on the *wrong class*.

Move it:

```java
public class Order {
    private BigDecimal total;
    public BigDecimal total() { return total; }

    public void recalculate() {
        this.total = computeTotal();
    }
}

public class Customer {
    private final List<Order> orders;
    public Optional<BigDecimal> lastOrderTotal() {
        return orders.isEmpty()
            ? Optional.empty()
            : Optional.of(orders.get(orders.size() - 1).total());
    }
}
```

`lastOrderTotal` becomes *derived* from `Order` instead of stored on `Customer`. The package-private write disappears. `Customer` no longer carries data it doesn't compute, and `Order` no longer reaches into a sibling class.

---

## 4. Extract Class — when two classes share a state cluster

Healthcare billing system. `Patient` and `Insurance` evolved with a tangle of shared fields about *coverage*:

```java
public class Patient {
    private String name;
    private String dob;
    private Insurance insurance;
    String policyNumber;        // package-private — Insurance reads this
    LocalDate coverageStart;    // ditto
    LocalDate coverageEnd;      // ditto
    BigDecimal deductibleMet;   // updated by both classes
}

public class Insurance {
    private String provider;
    private Patient patient;

    public boolean covers(LocalDate when, BigDecimal amount) {
        return when.isAfter(patient.coverageStart)
            && when.isBefore(patient.coverageEnd)
            && patient.deductibleMet.add(amount).compareTo(deductibleCap()) <= 0;
    }
}
```

Neither `policyNumber`, `coverageStart`, `coverageEnd`, nor `deductibleMet` are really *about the patient*. They're about a *coverage policy* that links a patient to an insurance provider. The shared state has its own identity — extract it:

```java
public final class Coverage {
    private final String policyNumber;
    private final LocalDate start;
    private final LocalDate end;
    private BigDecimal deductibleMet;

    public boolean covers(LocalDate when, BigDecimal amount, BigDecimal cap) {
        return !when.isBefore(start)
            && !when.isAfter(end)
            && deductibleMet.add(amount).compareTo(cap) <= 0;
    }
    public void applyDeductible(BigDecimal amount) {
        this.deductibleMet = deductibleMet.add(amount);
    }
}

public class Patient {
    private String name;
    private String dob;
    private Coverage coverage;
}

public class Insurance {
    private String provider;
    private BigDecimal deductibleCap;
    public boolean covers(Coverage c, LocalDate when, BigDecimal amount) {
        return c.covers(when, amount, deductibleCap);
    }
}
```

`Coverage` now *owns* its state. Neither `Patient` nor `Insurance` reaches into the other. The check that used to live across both classes now lives on the class that has the right data. Extract Class is the right move when the *shared cluster has a name*.

---

## 5. Hide Delegate — collapse a getter chain

A pickup-and-delivery dispatch service:

```java
public class Driver {
    private final Vehicle vehicle;
    public Vehicle getVehicle() { return vehicle; }
}
public class Vehicle {
    private final FuelTank fuelTank;
    public FuelTank getFuelTank() { return fuelTank; }
}
public class FuelTank {
    private final BigDecimal litres;
    public BigDecimal getLitres() { return litres; }
}

// Caller, somewhere far away:
if (driver.getVehicle().getFuelTank().getLitres().compareTo(MIN) < 0) {
    refuelQueue.add(driver);
}
```

The caller is intimate with the entire chain `Driver → Vehicle → FuelTank`. Renaming `FuelTank.getLitres()` to `getRemainingLitres()` ripples to every caller that walked the graph.

Hide the delegates — expose what the caller actually needs:

```java
public class Driver {
    private final Vehicle vehicle;
    public boolean needsRefuel(BigDecimal threshold) {
        return vehicle.needsRefuel(threshold);
    }
}
public class Vehicle {
    private final FuelTank fuelTank;
    public boolean needsRefuel(BigDecimal threshold) {
        return fuelTank.litres().compareTo(threshold) < 0;
    }
}

// Caller becomes:
if (driver.needsRefuel(MIN)) refuelQueue.add(driver);
```

Two refactor steps, three classes touched, dozens of call sites de-coupled from the internal structure. `FuelTank` is now free to expose litres in millilitres, kilograms, or as a `FuelLevel` enum without breaking any caller. Hide Delegate is the Law-of-Demeter cure in refactor form.

---

## 6. Change Bidirectional Association to Unidirectional

Fleet management. `Vehicle` and `Driver` evolved with mutual references:

```java
public class Vehicle {
    private Driver currentDriver;
    public void assignTo(Driver d) {
        this.currentDriver = d;
        d.setVehicle(this);
    }
}
public class Driver {
    private Vehicle vehicle;
    public void setVehicle(Vehicle v) { this.vehicle = v; }
    public Vehicle getVehicle() { return vehicle; }
}
```

Now ask: who *owns* the relationship?

- A driver may drive different vehicles over time — driver is not "owned by" a vehicle.
- A vehicle has exactly one current driver — vehicle is the owner of "current assignment".

Make the relationship unidirectional from `Vehicle` to `Driver`:

```java
public class Vehicle {
    private Driver currentDriver;
    public void assignTo(Driver d) { this.currentDriver = d; }
    public Optional<Driver> currentDriver() {
        return Optional.ofNullable(currentDriver);
    }
}

public class Driver {
    private final String name;
    public Driver(String name) { this.name = name; }
    // No back-reference.
}
```

"What if I need to ask `driver.getVehicle()`?" — Ask the *fleet repository*, which knows the current state:

```java
public class FleetRepository {
    public Optional<Vehicle> currentVehicleOf(Driver d) {
        return vehicles.stream()
                       .filter(v -> v.currentDriver().filter(c -> c.equals(d)).isPresent())
                       .findFirst();
    }
}
```

The lookup is rare; the storage cost of a back-reference (and the maintenance cost of keeping it in sync) is constant. Trading occasional traversal for permanent decoupling is almost always the right call.

---

## 7. Combined refactor — a banking pair that breaks every shape

```java
// package com.acme.bank;
public class Account {
    String iban;                    // package-private
    BigDecimal balance;             // package-private
    Customer owner;                 // package-private
    List<Transaction> transactions; // package-private

    public void debit(BigDecimal amount) {
        balance = balance.subtract(amount);
        owner.totalSpent = owner.totalSpent.add(amount);   // back-write
        owner.lastTxnIban = iban;                          // back-write
    }
}

public class Customer {
    String name;
    String email;
    List<Account> accounts;
    BigDecimal totalSpent;
    String lastTxnIban;

    public void closeAccount(Account a) {
        accounts.remove(a);
        a.balance = BigDecimal.ZERO;                        // mutates Account
        a.transactions.clear();                             // and again
    }
}
```

Smells stacked on top of each other: **package-private leakage** (every field), **bidirectional writes** (debit writes `Customer`, close writes `Account`), **fields on the wrong class** (`totalSpent`, `lastTxnIban`), **bidirectional references** (`Account.owner` + `Customer.accounts`).

Cleanup in four moves:

```java
// 1. Move Field: totalSpent and lastTxnIban don't belong on Customer.
//    They are derived from the customer's accounts.

// 2. Move Method: balance changes belong on Account.
public final class Account {
    private final String iban;
    private BigDecimal balance;
    private final List<Transaction> transactions = new ArrayList<>();

    public void debit(BigDecimal amount) {
        if (amount.signum() <= 0) throw new IllegalArgumentException();
        balance = balance.subtract(amount);
        transactions.add(new Transaction(amount.negate(), Instant.now()));
    }
    public BigDecimal balance() { return balance; }
    public String iban() { return iban; }
}

// 3. Change Bidirectional to Unidirectional: Customer owns the list,
//    Account no longer carries an `owner` back-reference.
public final class Customer {
    private final String name;
    private final List<Account> accounts = new ArrayList<>();

    public void closeAccount(Account a) {
        accounts.remove(a);   // close is just removing from the list
    }
    public BigDecimal totalSpent() {
        return accounts.stream()
                       .flatMap(a -> a.recentTransactions().stream())
                       .filter(t -> t.amount().signum() < 0)
                       .map(t -> t.amount().abs())
                       .reduce(BigDecimal.ZERO, BigDecimal::add);
    }
}

// 4. All fields are now private. Move Account and Customer into
//    separate packages — compilation still passes.
```

Each move targets one smell. After the four steps, both classes can be tested independently, moved across packages, and changed without dragging the other along.

---

## 8. Refactor sequence — bottom-up

When you face a pair like the banking example, do *not* try to fix everything in one PR. The order that minimises rework:

1. **Move Field** first. Misplaced fields are usually root causes — fixing them often eliminates the methods that needed the bidirectional access.
2. **Move Method** next. Now that fields live in the right place, methods that *envy* their new home become obvious.
3. **Extract Class** if a *third* concept emerges (like `Coverage`). Don't extract speculatively.
4. **Hide Delegate** to clean up callers that still walk the graph.
5. **Change Bidirectional to Unidirectional** last — by this point one side often has nothing useful left to know about the other anyway.

Doing these in reverse order leaves you fighting compile errors and broken tests. Bottom-up is calmer.

---

## 9. Mistakes when removing intimacy

**Merging too aggressively.** Inline Class is sometimes the right answer — two classes that are *truly* one concept should be one class. But the cure for intimacy is usually *separation*, not *merger*. Reach for Move Method/Field first; merge only if every method on `A` ends up on `B`.

**Adding a "Facade" that knows everyone.** A class that wraps both `Order` and `Customer` and exposes their combined API is not Hide Delegate — it's God Class in the making. Hide Delegate moves *one* method through *one* class, not all methods through a new central one.

**Converting bidirectional to "both unidirectional".** Some refactors end up with `A` knowing `B` *and* `B` knowing `A` through different methods, just hidden. That's still bidirectional; the smell hasn't moved.

**Replacing fields with `protected` getters.** This is intimacy with extra steps. Subclasses now have the same private access via inheritance. If the data shouldn't be exposed, don't expose it through inheritance either.

---

## 10. Quick rules

- [ ] If a method on `A` reads more from `B` than from `A`, move it to `B`.
- [ ] If a field on `A` is only written by `B`, move it to `B`.
- [ ] If a cluster of shared state has a real name, Extract Class.
- [ ] If callers chain getters across three levels, Hide Delegate.
- [ ] If two classes hold references to each other, decide who owns the relationship and drop the other side.
- [ ] Refactor field → method → extract → hide → break-cycle, in that order.
- [ ] Never use `protected` to "fix" intimacy — that's the same smell with inheritance overhead.

---

## 11. What's next

| Topic                                                          | File              |
|----------------------------------------------------------------|-------------------|
| Information hiding, encapsulation breaks, detection            | `senior.md`        |
| Modular boundaries with JPMS and ArchUnit                      | `professional.md`  |
| CBO/MPC metrics and JLS access rules                           | `specification.md` |
| Bidirectional JPA, serialization cycles, internal exposure     | `find-bug.md`      |
| Fetch-join cost, equals/hashCode recursion                     | `optimize.md`      |
| Practice refactors                                             | `tasks.md`         |
| Interview Q&A                                                  | `interview.md`     |

---

**Memorize this:** Inappropriate Intimacy has five faces — wandering methods (Move Method), wandering fields (Move Field), nameable shared clusters (Extract Class), getter chains (Hide Delegate), and unclear ownership (Change Bidirectional to Unidirectional). Name the face you see, apply the matching move, and refactor bottom-up: fields first, methods next, structure last.
