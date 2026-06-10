# Feature Envy — Junior

> **What?** *Feature Envy* is a code smell where a method on class `A` is more interested in the data of class `B` than in its own. The method keeps reaching across the boundary — calling getter after getter on `B`, doing arithmetic on `B`'s fields, then maybe storing the result somewhere on `A`. The behaviour clearly belongs *with* `B`'s data, but it's sitting on `A`. Martin Fowler named the smell in *Refactoring: Improving the Design of Existing Code* (1999).
> **How?** When reviewing a method, count how many `this.` accesses it makes versus how many `other.getX()` calls it makes on a single foreign object. If the foreign calls dominate, the method is envious of `B`'s features — and the fix, almost always, is to move the method to where the data lives.

---

## 1. The smell in one sentence

A method belongs *next to the data it uses most*. When a method on `Order` spends three lines pulling values out of a `Customer` and one line touching its own fields, it's living in the wrong class. The cure is *Move Method* — pick up the method and drop it onto `Customer`. The fix is mechanical, the payoff is immediate: less coupling between the two classes, fewer getters on the public surface, and behaviour that's now polymorphic on `Customer` instead of being trapped in an `if` somewhere.

This is the most common, most easily fixed code smell in Java. It's also the smell that signals a deeper problem — *anaemic domain models*, *Tell Don't Ask* violations, *Law of Demeter* breaks — so learning to spot Feature Envy is a gateway into half of the other OO antipatterns.

---

## 2. The classic example

```java
// Smelly — Order is envious of Customer
public class Order {
    private final Customer customer;
    private final List<LineItem> items;

    public BigDecimal calculatePriceForCustomer() {
        BigDecimal subtotal = items.stream()
                .map(LineItem::lineTotal)
                .reduce(BigDecimal.ZERO, BigDecimal::add);

        BigDecimal discount = BigDecimal.ZERO;
        if (customer.getMembershipTier().equals("GOLD")) {
            discount = subtotal.multiply(new BigDecimal("0.15"));
        } else if (customer.getMembershipTier().equals("SILVER")) {
            discount = subtotal.multiply(new BigDecimal("0.10"));
        }
        if (customer.getLoyaltyPoints() > 1000) {
            discount = discount.add(new BigDecimal("5.00"));
        }
        if (customer.getYearsActive() > 5) {
            discount = discount.add(new BigDecimal("2.50"));
        }

        return subtotal.subtract(discount);
    }
}
```

Count the foreign calls: `customer.getMembershipTier()` (twice), `customer.getLoyaltyPoints()`, `customer.getYearsActive()`. Four reaches into `Customer`, plus a `switch`-shaped decision tree over `Customer`'s state. The method is sitting on `Order`, but every interesting line is reading `Customer`. That is textbook Feature Envy.

The first warning sign was the *name*: `calculatePriceForCustomer`. When a method is named *for* another class, you're already losing — the name is admitting where the behaviour belongs.

---

## 3. The fix — Move Method

The refactoring is Fowler's classic *Move Method*. Pick up the discount calculation, drop it onto `Customer`, leave `Order` calling a single short method:

```java
public class Customer {
    private String membershipTier;
    private int loyaltyPoints;
    private int yearsActive;

    public BigDecimal discountOn(BigDecimal subtotal) {
        BigDecimal discount = BigDecimal.ZERO;
        if ("GOLD".equals(membershipTier)) {
            discount = subtotal.multiply(new BigDecimal("0.15"));
        } else if ("SILVER".equals(membershipTier)) {
            discount = subtotal.multiply(new BigDecimal("0.10"));
        }
        if (loyaltyPoints > 1000) {
            discount = discount.add(new BigDecimal("5.00"));
        }
        if (yearsActive > 5) {
            discount = discount.add(new BigDecimal("2.50"));
        }
        return discount;
    }
}

public class Order {
    private final Customer customer;
    private final List<LineItem> items;

    public BigDecimal totalPrice() {
        BigDecimal subtotal = items.stream()
                .map(LineItem::lineTotal)
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        return subtotal.subtract(customer.discountOn(subtotal));
    }
}
```

Five things just happened, and only one of them was "the code moved":

1. `Customer` no longer needs `getMembershipTier`, `getLoyaltyPoints`, or `getYearsActive` on its public API — the only outside use was that envious method, which is now inside.
2. The discount rules can change without touching `Order`. SRP improved.
3. A `Customer` subtype (say, `EmployeeCustomer`) can override `discountOn` polymorphically. OCP improved.
4. The method name says *what it does* (`discountOn`), not *who it's for* (`forCustomer`).
5. Tests for discount logic now construct a `Customer` and assert directly — no `Order`, no items, no irrelevant scaffolding.

---

## 4. How to spot it in code review

You don't need a tool for the first pass. Open the file, find a method, and run this checklist:

- **Count `other.getX()` calls** on the same foreign object. Three or more is suspicious; five or more is almost certainly Feature Envy.
- **Count `this.field` accesses.** If the foreign count exceeds the local count, the method is envious.
- **Read the method name.** Names containing `For`, `Of`, or another class's name (`calculateForCustomer`, `priceOf`, `summaryOfAccount`) often advertise the smell.
- **Look at parameter lists.** A method that takes a single object parameter and reads it heavily is a candidate to be moved onto that parameter's class.

IntelliJ IDEA flags this under *Analyze → Run Inspection by Name → "Feature Envy"*. SonarJava raises rule **S3398** (`Methods should not have too many parameters`) and related cohesion rules (`S1448`, `S3776`) that often correlate with Feature Envy in practice.

---

## 5. A second example — `Address` envy

```java
// Smelly — PostalLabel is envious of Address
public class PostalLabel {
    public String render(Address addr, String recipient) {
        StringBuilder sb = new StringBuilder();
        sb.append(recipient).append('\n');
        sb.append(addr.getStreet()).append(' ').append(addr.getHouseNumber()).append('\n');
        if (addr.getApartment() != null) {
            sb.append("Apt ").append(addr.getApartment()).append('\n');
        }
        sb.append(addr.getCity()).append(", ").append(addr.getRegion());
        sb.append(' ').append(addr.getPostalCode()).append('\n');
        sb.append(addr.getCountry().toUpperCase());
        return sb.toString();
    }
}
```

Seven foreign calls, zero local state. `PostalLabel.render` is almost entirely an `Address` formatter.

```java
// Refactored — Address knows how to format itself
public class Address {
    // fields ...

    public String multiLine() {
        StringBuilder sb = new StringBuilder();
        sb.append(street).append(' ').append(houseNumber).append('\n');
        if (apartment != null) sb.append("Apt ").append(apartment).append('\n');
        sb.append(city).append(", ").append(region).append(' ').append(postalCode).append('\n');
        sb.append(country.toUpperCase());
        return sb.toString();
    }
}

public class PostalLabel {
    public String render(Address addr, String recipient) {
        return recipient + "\n" + addr.multiLine();
    }
}
```

`PostalLabel.render` becomes one line. `Address` exposes one nice method instead of seven raw getters. Anyone needing the multi-line address representation — packing slip, invoice, return label — calls `Address.multiLine()` directly.

---

## 6. Why getters are not free

Newcomers often think "I'll just expose getters, the consumer can do whatever they want with the data." That sounds polite, but it's how Feature Envy compounds. Each getter is an invitation to write *more* envious code in *another* class. Two months later you have five classes all reading `Customer.getMembershipTier()`, all duplicating the same `switch` over the tier values.

The Tell-Don't-Ask heuristic (Andy Hunt and Dave Thomas, *The Pragmatic Programmer*, 1999) is the slogan: instead of *asking* an object for data and acting on it, *tell* the object what you want done. `customer.discountOn(subtotal)` is telling. `if (customer.getTier().equals("GOLD")) ...` is asking — and it leaks the tier representation into every caller.

```java
// Asking — every caller knows about the tier enum
if (customer.getTier() == Tier.GOLD || customer.getTier() == Tier.PLATINUM) {
    grantAccess();
}

// Telling — Customer owns the rule
if (customer.hasPremiumAccess()) {
    grantAccess();
}
```

The second form is *one* place where premium-access logic lives. Add "diamond tier" later — one edit on `Customer`, every caller unchanged.

---

## 7. The exceptions — when the smell is wrong

Not every method full of foreign calls is envious. Three cases that look like Feature Envy but aren't:

**Pure mappers and projectors.** A `OrderToDtoMapper.toDto(Order o)` legitimately reads everything off the `Order`. That's the *purpose* of a mapper. Moving the mapping back onto `Order` would couple the domain to the DTO format — exactly what you wanted to avoid. Mappers live at the edge of the domain on purpose.

**Visitors.** A `Visitor` pattern is *defined* by visiting another object's data. The envy is the design, not an accident.

**Service-layer orchestration** *of a single step*. A `CheckoutService.process(Cart c)` that pulls a few values off `Cart` to coordinate `Inventory`, `Payment`, `Shipping` is doing orchestration, not envy. It reads from `Cart` to *route* the call, not to *compute* something about `Cart`.

The smell is when behaviour about `B`'s data sits on `A`. Pure I/O, pure mapping, and orchestration aren't behaviour about the data — they're behaviour about *what to do with the data*.

---

## 8. Refactorings in Fowler's catalogue

Fowler lists three closely related moves you'll use to fix Feature Envy:

| Refactoring         | When to use                                                    |
| ------------------- | -------------------------------------------------------------- |
| **Move Method**     | The whole method belongs on the other class. Most common fix.  |
| **Extract Method**  | Only part of the method is envious — extract that part first.  |
| **Move Method** (after Extract) | Then move the extracted piece to where its data lives. |

The two-step *Extract + Move* is what you reach for when a 30-line method has a 10-line envy-block inside an otherwise-local method. Don't move the whole method — extract the envious piece, then move just that.

---

## 9. Quick rules

- [ ] More foreign `getX()` calls than local `this.` accesses → move the method.
- [ ] Method name contains `For`, `Of`, or another class's name → suspect.
- [ ] Method takes one object parameter and reads it heavily → candidate for `Move Method`.
- [ ] Long chain of `customer.getAddress().getCity().getRegion()...` → Law of Demeter violation, often co-occurs.
- [ ] Caller has to know about an internal enum or tier to do anything → telling, not asking.

---

## 10. What's next

| Topic                                                              | File              |
| ------------------------------------------------------------------ | ----------------- |
| Detection patterns, refactoring catalogue, Tell-Don't-Ask in depth | `middle.md`        |
| Legitimate envy (Strategy, Visitor), IntelliJ + SonarJava in depth | `senior.md`        |
| Architectural variants — anaemic services, DTOs, DDD aggregates    | `professional.md`  |
| Metrics — ATFD, FDP, LAA — Lanza & Marinescu thresholds            | `specification.md` |
| 10 numbered scenarios — diagnose and fix                           | `find-bug.md`      |
| Performance angles — getter chains, JIT inlining, cache locality   | `optimize.md`      |
| 8 exercises with worked solutions                                  | `tasks.md`         |
| Interview Q&A                                                      | `interview.md`     |

---

**Memorize this:** a method belongs *next to the data it uses most*. Count foreign getter calls; if they outnumber `this.` accesses, the method is envious — *Move Method* until that's no longer true.
