# Shotgun Surgery - Tasks

> Eight exercises. Each one starts from real code that exhibits shotgun surgery and asks you to consolidate. Validation criteria are explicit so you can self-check. A worked solution sketch follows for Exercise 1; the others are yours to drive.

## How to use

Work in a scratch repo (`git init`) so you can run `git log` analyses on your own commits. Time-box each exercise to 30-60 minutes. Compare your file count before and after - the metric to beat is "files touched to add one new variant."

## Exercise 1 - Enum-driven calculation tax

**Given.** Three classes (`PriceCalculator`, `ShippingCalculator`, `LoyaltyPoints`) each switch on `OrderType { STANDARD, PREMIUM, BULK }`.

**Task.** Add a fourth variant `GIFT` such that future variants require editing only one file.

**Validation.**

| Check                                                                  | Pass / Fail |
|------------------------------------------------------------------------|-------------|
| Adding a fifth variant touches exactly 1 file                          |             |
| All existing unit tests still pass without modification to test logic  |             |
| No `switch` on `OrderType` remains in the calculator classes           |             |
| `OrderType` does not import any calculator class (no circular dep)     |             |

## Exercise 2 - Validation rule consolidation

**Given.** Four endpoints (create user, update user, create order, update profile) each inline-validate email and phone format.

**Task.** Centralize so a change to email rules (e.g., allow + addressing) requires editing one place.

**Validation.**

| Check                                                                       | Pass / Fail |
|-----------------------------------------------------------------------------|-------------|
| Email rule changed in exactly one source file                               |             |
| Each endpoint expresses validation declaratively or via a value object      |             |
| Invalid email never reaches business logic - rejected at the boundary       |             |
| Unit tests added for the email value object cover null, empty, missing @    |             |

## Exercise 3 - Logging format migration

**Given.** ~30 logger call sites using positional format strings.

**Task.** Migrate to structured logging (JSON or MDC). The migration script / change must not require touching every call site.

**Validation.**

| Check                                                                | Pass / Fail |
|----------------------------------------------------------------------|-------------|
| Output format switchable via configuration, not code change          |             |
| Call sites use a typed event API rather than raw format strings      |             |
| One central place defines the output structure                       |             |
| Future field additions to the log schema do not touch call sites     |             |

## Exercise 4 - DTO / Entity / Mapper cluster

**Given.** A `User` entity, `UserCreateRequest`, `UserUpdateRequest`, `UserResponse`, and a hand-written `UserMapper`. All five files change when a field is added.

**Task.** Reduce the cluster so that adding `dateOfBirth` is a 1-2 file change.

**Validation.**

| Check                                                                     | Pass / Fail |
|---------------------------------------------------------------------------|-------------|
| Adding `dateOfBirth` touches at most 2 source files (entity + migration)  |             |
| OpenAPI spec regenerates without manual edits                             |             |
| Field can be required on create but optional on update                    |             |
| Test fixtures do not need per-DTO updates                                 |             |

Hint: MapStruct or Lombok `@SuperBuilder` plus a shared base record.

## Exercise 5 - Feature flag scattergun

**Given.** A boolean feature flag `new-checkout` checked in 12 places across the checkout flow.

**Task.** Refactor so the flag is consulted at most twice (composition root and a single guard), and removing the flag later is a one-file deletion.

**Validation.**

| Check                                                                     | Pass / Fail |
|---------------------------------------------------------------------------|-------------|
| `featureFlags.isEnabled("new-checkout")` appears in at most 2 source files|             |
| Both code paths can be exercised by injecting different implementations   |             |
| Removing the flag is a single PR that deletes one strategy                |             |

## Exercise 6 - Event versioning consolidation

**Given.** Five consumers of `OrderPlaced` each have `if (event.version() == 1) ... else if (version == 2) ...` branches.

**Task.** Introduce an upcaster chain so each consumer only handles the latest version.

**Validation.**

| Check                                                                | Pass / Fail |
|----------------------------------------------------------------------|-------------|
| Consumers contain no version branching                               |             |
| Adding V3 requires writing one new upcaster, zero consumer changes   |             |
| Historical events replay correctly through the upcaster chain        |             |
| Upcaster chain is unit-tested independently of consumers             |             |

## Exercise 7 - Sealed event hierarchy

**Given.** An `OrderEvent` abstract class with subclasses `OrderPlaced`, `OrderShipped`, `OrderCancelled`. A handler does `if (e instanceof OrderPlaced) ... else if ...`.

**Task.** Convert to sealed types + exhaustive pattern matching so missing branches fail at compile time.

**Validation.**

| Check                                                                    | Pass / Fail |
|--------------------------------------------------------------------------|-------------|
| `OrderEvent` is `sealed` with explicit `permits` clause                  |             |
| Adding a new subtype causes a compile error in handlers until handled    |             |
| Switch expression uses pattern matching, not `instanceof` + cast         |             |
| At least one test verifies exhaustiveness with a new variant             |             |

## Exercise 8 - Mining your own git history

**Given.** Your scratch repo from earlier exercises (or any small project of yours).

**Task.** Use the CodeMaat CLI or a custom `git log` script (see `specification.md`) to extract the top-5 coupled file pairs. For the top pair, write a one-page refactoring proposal that would drop their coupling below 30%.

**Validation.**

| Check                                                                  | Pass / Fail |
|------------------------------------------------------------------------|-------------|
| Coupling report generated and saved to the repo                        |             |
| Top pair clearly identified with percentage                            |             |
| Refactoring proposal names the Fowler move (e.g., `Extract Class`)     |             |
| Proposal estimates the new files-per-change for the next feature       |             |

---

## Worked solution sketch - Exercise 1

Starting code (abbreviated):

```java
public enum OrderType { STANDARD, PREMIUM, BULK }

public class PriceCalculator {
    public double price(Order o, double base) {
        return switch (o.getType()) {
            case STANDARD -> base * 1.0;
            case PREMIUM  -> base * 0.9;
            case BULK     -> base * 0.8;
        };
    }
}
// ShippingCalculator, LoyaltyPoints similarly.
```

Step 1: identify the change axis. Adding a variant means adding three numbers (price factor, shipping, loyalty multiplier). Co-located data, scattered access.

Step 2: move data onto the enum.

```java
public enum OrderType {
    STANDARD(1.0, 5.00, 1),
    PREMIUM (0.9, 0.00, 3),
    BULK    (0.8, 15.00, 2);

    private final double priceFactor;
    private final double shippingFee;
    private final int loyaltyMultiplier;

    OrderType(double pf, double sf, int lm) {
        this.priceFactor = pf;
        this.shippingFee = sf;
        this.loyaltyMultiplier = lm;
    }

    public double priceFactor()    { return priceFactor; }
    public double shippingFee()    { return shippingFee; }
    public int    loyaltyMultiplier() { return loyaltyMultiplier; }
}
```

Step 3: collapse calculators to data lookups.

```java
public class PriceCalculator {
    public double price(Order o, double base) { return base * o.getType().priceFactor(); }
}
public class ShippingCalculator {
    public double fee(Order o) { return o.getType().shippingFee(); }
}
public class LoyaltyPoints {
    public int points(Order o, double total) { return (int) (total * o.getType().loyaltyMultiplier()); }
}
```

Step 4: add `GIFT`.

```java
public enum OrderType {
    STANDARD(1.0, 5.00, 1),
    PREMIUM (0.9, 0.00, 3),
    BULK    (0.8, 15.00, 2),
    GIFT    (0.0, 0.00, 0);   // <- only edit
    // ctor and getters unchanged
}
```

One file. Calculators unchanged. All three validation criteria pass.

Step 5: if behavior diverges further (e.g., loyalty points become a non-linear function), promote to a sealed interface:

```java
public sealed interface OrderType permits Standard, Premium, Bulk, Gift {
    double priceFactor();
    double shippingFee();
    int loyaltyPoints(double total);
}
```

Same change radius for new variants - one file per variant - but now arbitrary behavior, not just data.

The pattern across all eight exercises: name the change axis, move data or behavior to live next to it, replace conditional with polymorphism or data lookup. Fowler's three moves (`Move Function`, `Extract Class`, `Replace Conditional with Polymorphism`) cover ~90% of shotgun-surgery refactors in real codebases.
