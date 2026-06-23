# Feature Envy — Find the Bug

Ten realistic scenarios. Each one is code that compiles and runs, but contains Feature Envy — a method living in the wrong class, reaching across boundaries for data it should not own. Read the snippet, diagnose, then apply the fix. The diagnoses use the Lanza & Marinescu metrics (ATFD, FDP, LAA) and Fowler's Move Method refactoring (*Refactoring*, 2nd ed., chapter 8).

---

## Scenario 1 — The shipping calculator

```java
public class ShippingService {
    public BigDecimal calculate(Order order) {
        BigDecimal weight = BigDecimal.ZERO;
        for (LineItem item : order.getItems()) {
            weight = weight.add(item.getProduct().getWeight()
                .multiply(BigDecimal.valueOf(item.getQuantity())));
        }
        BigDecimal base = weight.multiply(BigDecimal.valueOf(2.5));
        if (order.getDestination().isInternational()) base = base.multiply(BigDecimal.valueOf(3));
        return base;
    }
}
```

**Diagnosis.** ATFD = 5 (items, product.weight, quantity, destination, isInternational); LAA ≈ 0. Service does no own-state work. SonarJava S3398 flags this.

**Fix.** Add `lineWeight()` to `LineItem`, `totalWeight()` to `Order`, and `BigDecimal shippingCost()` on `Order` that uses `Destination.isInternational`. Service becomes a thin caller.

---

## Scenario 2 — The notification builder

```java
public class NotificationBuilder {
    public String build(User user) {
        return "Dear " + user.getFirstName() + " " + user.getLastName()
            + ", your account at " + user.getEmail()
            + " was created on " + user.getCreatedAt().format(DateTimeFormatter.ISO_DATE)
            + ".";
    }
}
```

**Diagnosis.** Five distinct `User` attributes, zero local state. The builder is a vehicle for envy.

**Fix.** Two legitimate paths. (a) Add `User.greeting()` that builds the personalised header. (b) Keep `NotificationBuilder` but accept a `UserDisplayView` value object that exposes `fullName()`, `email()`, `accountCreatedLine()`. The builder then composes intent, not strings from foreign fields.

---

## Scenario 3 — The double-getter chain

```java
public class CheckoutValidator {
    public boolean canCheckout(Order order) {
        return order.getCustomer().getAddress().getCountry().getCode().equals("US")
            && order.getCustomer().getPaymentMethod().getStatus() == PaymentStatus.VERIFIED
            && order.getCustomer().getCart().getItems().size() > 0;
    }
}
```

**Diagnosis.** Train wreck plus Feature Envy. Three two-hop reaches into `Customer`, then deeper. Violates Law of Demeter (PMD `LawOfDemeter`).

**Fix.** Add `Customer.isCheckoutReady()` returning the boolean composed of `address.isInUS()`, `paymentMethod.isVerified()`, `cart.hasItems()`. The validator becomes `customer.isCheckoutReady()`. Push each predicate down to the class that owns the data.

---

## Scenario 4 — The report formatter

```java
public class EmployeeReport {
    public String format(Employee e) {
        BigDecimal annual = e.getSalary().getMonthlyAmount()
            .multiply(BigDecimal.valueOf(12));
        BigDecimal bonus = annual.multiply(e.getPerformanceRating().getMultiplier());
        return e.getName() + " | " + annual + " | " + bonus;
    }
}
```

**Diagnosis.** Logic computes annual salary and bonus — this is `Employee` (or `Salary`) responsibility. The formatter envies both.

**Fix.** `Salary.annualAmount()`, `Employee.annualCompensation()` returning `Money` that includes bonus. The report calls those methods and concatenates strings only.

---

## Scenario 5 — The cart total

```java
public class CartController {
    @GetMapping("/cart/total")
    public Money total(@AuthenticationPrincipal User user) {
        Cart cart = cartRepo.findByUser(user);
        Money sum = Money.ZERO;
        for (CartItem item : cart.getItems()) {
            sum = sum.plus(item.getProduct().getPrice().times(item.getQuantity()));
        }
        return sum;
    }
}
```

**Diagnosis.** Controllers must not compute totals. ATFD = 4 on `Cart`/`CartItem`/`Product`. IntelliJ "Feature envy" flags it immediately.

**Fix.** `CartItem.lineTotal()`, then `Cart.total()`. Controller becomes one line: `cartRepo.findByUser(user).total()`.

---

## Scenario 6 — The PDF renderer that knows too much

```java
public class InvoicePdfRenderer {
    public byte[] render(Invoice inv) {
        PdfDoc doc = new PdfDoc();
        doc.write("Invoice #" + inv.getNumber());
        doc.write("Customer: " + inv.getCustomer().getName());
        for (LineItem li : inv.getLines()) {
            doc.write(li.getDescription() + " x " + li.getQuantity()
                + " @ " + li.getUnitPrice() + " = "
                + li.getUnitPrice().multiply(BigDecimal.valueOf(li.getQuantity())));
        }
        return doc.bytes();
    }
}
```

**Diagnosis.** Line subtotal arithmetic is `LineItem` responsibility. Renderer envies it.

**Fix.** Add `LineItem.lineTotal()` and `LineItem.describe()` returning a `String` ready to print. Renderer asks the line for its rendered text; PDF formatting remains here.

---

## Scenario 7 — The risk classifier

```java
public class LoanRiskClassifier {
    public RiskLevel classify(LoanApplication app) {
        int score = 0;
        if (app.getApplicant().getCreditScore() < 600) score += 3;
        if (app.getApplicant().getAnnualIncome().compareTo(BigDecimal.valueOf(30_000)) < 0) score += 2;
        if (app.getAmount().compareTo(app.getApplicant().getAnnualIncome().multiply(BigDecimal.valueOf(5))) > 0) score += 4;
        return score >= 5 ? RiskLevel.HIGH : score >= 2 ? RiskLevel.MEDIUM : RiskLevel.LOW;
    }
}
```

**Diagnosis.** Mostly reading `Applicant` fields. ATFD = 3 on `Applicant`, FDP = 2.

**Fix.** This one is borderline. The classifier IS a domain rule, and risk rules legitimately compose multiple aggregates. Two options:
- Keep as a **Domain Service** (DDD), accept the envy as concentrated and named.
- Move sub-rules: `Applicant.hasLowCreditScore()`, `Applicant.hasLowIncome()`, and `LoanApplication.exceedsIncomeMultiple(int)`. Classifier becomes a small adder. Prefer this if the rules will grow.

---

## Scenario 8 — The audit logger

```java
public class AuditLogger {
    public void logChange(User actor, Order order) {
        log.info("user={} role={} dept={} changed order={} status={} total={}",
            actor.getEmail(), actor.getRole().getName(), actor.getDepartment().getName(),
            order.getId(), order.getStatus(), order.getTotal());
    }
}
```

**Diagnosis.** ATFD = 6 across two classes. But the logger's *job* is to read identifying data and write it.

**Fix.** Introduce `AuditContext` value object with `actorDescription()` and `targetDescription()`. Build it at the call site. Logger logs the rendered strings. This is the **Concentrated Envy** legitimate case from the professional file.

---

## Scenario 9 — The price calculator with cycles

```java
public class PriceEngine {
    public Money price(Product p, Customer c) {
        Money base = p.getBasePrice();
        Money afterTier = base.times(c.getLoyaltyTier().getDiscount());
        Money afterCategory = afterTier.times(p.getCategory().getMarkup());
        Money afterRegion = afterCategory.times(c.getRegion().getTaxRate());
        return afterRegion;
    }
}
```

**Diagnosis.** Equal envy on `Product` and `Customer` — ATFD = 4, FDP = 2, LAA = 0.

**Fix.** This is the legitimate **multi-aggregate coordinator** case. Either:
- Promote `PriceEngine` to a **Domain Service** with a clear interface; keep envy concentrated here.
- Or model `PricingContext(product, customer)` value object with a `finalPrice()` method.

Do *not* try to move pricing into `Product` or `Customer` — it belongs to neither alone.

---

## Scenario 10 — The DTO assembler hiding in a service

```java
public class UserService {
    public UserResponse toResponse(User user) {
        UserResponse r = new UserResponse();
        r.setId(user.getId().toString());
        r.setName(user.getFirstName() + " " + user.getLastName());
        r.setEmail(user.getEmail().toString().toLowerCase());
        r.setJoined(user.getCreatedAt().toLocalDate().toString());
        r.setActive(user.getStatus() == UserStatus.ACTIVE);
        return r;
    }
}
```

**Diagnosis.** Six `User` attribute reads. Looks envious, and it is. But `UserService` is the wrong host. The fix is **not** to move it onto `User`.

**Fix.** Extract a `UserResponseMapper` (or use MapStruct). Concentrated envy in a mapper is the design. Polluting domain entities with response-format knowledge is worse than the envy itself.

---

## Memorize this

Diagnose Feature Envy by counting distinct foreign attribute accesses (ATFD) and checking the centre of gravity (LAA). Fix with **Move Method** to the dominant provider, or **Extract Method** if the envious chunk is local. Three cases where envy is acceptable: multi-aggregate coordinators (domain services), DTO mappers, and audit/logging contexts — keep the envy named and concentrated, do not let it leak into entities. Train wrecks (`a.getB().getC().getD()`) are envy plus Law of Demeter violations; push predicates down to the class that owns the data.
