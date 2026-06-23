# Feature Envy — Tasks

Eight exercises. Do them in order. Each task gives starting code (envious) and a goal. Use the Lanza & Marinescu metrics to verify your fix: target **ATFD ≤ 5**, **LAA ≥ 1/3**, sensible **FDP**. Apply Fowler's Move Method and Extract Method refactorings.

---

## Task 1 — Account balance after fees

**Starting code.**

```java
public class AccountReportService {
    public BigDecimal netBalance(Account a) {
        BigDecimal gross = a.getDeposits().stream()
            .map(Deposit::getAmount).reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal withdrawn = a.getWithdrawals().stream()
            .map(Withdrawal::getAmount).reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal fees = a.getFeeSchedule().monthlyFee()
            .multiply(BigDecimal.valueOf(a.getMonthsOpen()));
        return gross.subtract(withdrawn).subtract(fees);
    }
}
```

**Goal.** Move computation into `Account`. Service becomes one line.

---

## Task 2 — Discount eligibility check

**Starting code.**

```java
public class DiscountChecker {
    public boolean qualifiesForLoyaltyDiscount(Customer c) {
        return c.getYearsActive() >= 5
            && c.getTotalSpent().compareTo(BigDecimal.valueOf(10_000)) >= 0
            && c.getStatus() == CustomerStatus.ACTIVE
            && !c.getFlags().contains(CustomerFlag.SUSPENDED);
    }
}
```

**Goal.** Push to `Customer.qualifiesForLoyaltyDiscount()`. Remove `DiscountChecker` entirely (or keep as an empty registration point).

---

## Task 3 — Order shipping decision

**Starting code.**

```java
public class ShippingDecider {
    public ShippingMethod decide(Order order) {
        BigDecimal weight = order.getItems().stream()
            .map(i -> i.getProduct().getWeight().multiply(BigDecimal.valueOf(i.getQuantity())))
            .reduce(BigDecimal.ZERO, BigDecimal::add);
        if (weight.compareTo(BigDecimal.valueOf(50)) > 0) return ShippingMethod.FREIGHT;
        if (order.getDestination().isInternational()) return ShippingMethod.INTERNATIONAL_AIR;
        if (order.isPriority()) return ShippingMethod.OVERNIGHT;
        return ShippingMethod.STANDARD;
    }
}
```

**Goal.** Add `LineItem.weight()`, `Order.totalWeight()`, `Order.preferredShippingMethod()`. Decider keeps no logic.

---

## Task 4 — Salary report row

**Starting code.**

```java
public class SalaryRow {
    public String render(Employee e) {
        BigDecimal annual = e.getMonthlySalary().multiply(BigDecimal.valueOf(12));
        BigDecimal tax = annual.multiply(e.getTaxBracket().getRate());
        BigDecimal net = annual.subtract(tax);
        return String.format("%s | %.2f | %.2f", e.getFullName(), annual, net);
    }
}
```

**Goal.** Two refactorings — annual/net computation onto `Employee`; row rendering stays in `SalaryRow` but consumes a `CompensationSummary` value object returned by `Employee`.

---

## Task 5 — Cart price with promo

**Starting code.**

```java
public class CartPricingService {
    public Money price(Cart cart, PromoCode promo) {
        Money sub = Money.ZERO;
        for (CartItem item : cart.getItems()) {
            sub = sub.plus(item.getProduct().getPrice().times(item.getQuantity()));
        }
        if (promo.isApplicableTo(cart) && promo.getPercentOff() > 0) {
            sub = sub.times(BigDecimal.ONE.subtract(BigDecimal.valueOf(promo.getPercentOff()).divide(BigDecimal.valueOf(100))));
        }
        return sub;
    }
}
```

**Goal.** `CartItem.lineTotal()`, `Cart.subtotal()`, `PromoCode.apply(Money)`. Service composes: `promo.apply(cart.subtotal())`.

---

## Task 6 — Risk score on a domain service

**Starting code.**

```java
public class CreditRiskAssessor {
    public int score(LoanApplication app) {
        int score = 0;
        if (app.getApplicant().getCreditScore() < 600) score += 30;
        if (app.getApplicant().getDebtToIncome() > 0.4) score += 25;
        if (app.getAmount().compareTo(BigDecimal.valueOf(100_000)) > 0) score += 20;
        if (app.getApplicant().getEmploymentMonths() < 12) score += 15;
        if (app.getCollateral() == null) score += 10;
        return score;
    }
}
```

**Goal.** This is a legitimate domain service — it composes two aggregates (`Applicant`, `LoanApplication`). Push the sub-predicates to the owner classes (e.g. `Applicant.hasLowCreditScore()`), but keep the scoring composition here. Document the choice.

---

## Task 7 — Mapper hiding in a controller

**Starting code.**

```java
@RestController
public class ProductController {
    @GetMapping("/products/{id}")
    public ProductDto get(@PathVariable Long id) {
        Product p = repo.findById(id).orElseThrow();
        ProductDto dto = new ProductDto();
        dto.setId(p.getId());
        dto.setName(p.getName());
        dto.setPrice(p.getPrice().toString());
        dto.setInStock(p.getStockQuantity() > 0);
        dto.setCategory(p.getCategory().getName());
        return dto;
    }
}
```

**Goal.** Extract a `ProductMapper` (or MapStruct interface). Controller becomes two lines.

---

## Task 8 — Train wreck in validator

**Starting code.**

```java
public class OrderValidator {
    public boolean isValid(Order order) {
        return order.getCustomer().getAddress().getZip() != null
            && !order.getCustomer().getAddress().getZip().isBlank()
            && order.getCustomer().getPaymentMethod().getCard().getExpiryDate().isAfter(LocalDate.now())
            && order.getItems().stream().allMatch(i -> i.getProduct().isAvailable());
    }
}
```

**Goal.** Eliminate the train wrecks. Push predicates: `Address.hasZip()`, `PaymentMethod.isUsable()`, `LineItem.isAvailable()`, `Order.isValid()`. Validator delegates.

---

## Validation table

After each task verify:

| Check | Expected after fix |
|-------|-------------------|
| ATFD of envious method | ≤ 5 |
| LAA of envious method | ≥ 1/3 |
| FDP of envious method | ≤ 5 |
| SonarJava S3398 warnings | 0 on touched methods |
| IntelliJ "Feature envy" | Not flagged |
| Original tests pass | Yes (no behaviour change) |
| New methods on entity have unit tests | Yes |
| No new circular dependencies | Verified by `mvn dependency:analyze` or jdeps |

---

## Worked solution sketch — Task 1

Starting point: `AccountReportService.netBalance` has ATFD = 4 (deposits, withdrawals, feeSchedule, monthsOpen) and LAA = 0.

Step 1 — Extract Method on the gross sum into a local method, then move to `Account.totalDeposits()`.

```java
public class Account {
    public BigDecimal totalDeposits() {
        return deposits.stream().map(Deposit::getAmount)
            .reduce(BigDecimal.ZERO, BigDecimal::add);
    }
    public BigDecimal totalWithdrawals() {
        return withdrawals.stream().map(Withdrawal::getAmount)
            .reduce(BigDecimal.ZERO, BigDecimal::add);
    }
    public BigDecimal accumulatedFees() {
        return feeSchedule.monthlyFee()
            .multiply(BigDecimal.valueOf(monthsOpen));
    }
    public BigDecimal netBalance() {
        return totalDeposits().subtract(totalWithdrawals()).subtract(accumulatedFees());
    }
}
```

Step 2 — Service collapses:

```java
public class AccountReportService {
    public BigDecimal netBalance(Account a) {
        return a.netBalance();
    }
}
```

At this point you may even delete `AccountReportService` and have callers go directly to `Account`. The service was a pure envy host with no other responsibilities.

Step 3 — Verify. ATFD on `Account.netBalance` is 0 (own state only). LAA = 1.0. Tests still green. SonarJava silent.

Apply the same three-step pattern to every other task: extract the envious chunks, move them to the owner, simplify the caller, verify metrics and tests.
