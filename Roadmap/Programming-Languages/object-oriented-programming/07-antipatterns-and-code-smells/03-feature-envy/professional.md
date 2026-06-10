# Feature Envy — Professional

At the professional level, Feature Envy is not just a method-shaped problem. It becomes an architectural symptom that infects layers, bounded contexts, and module boundaries. The fix changes where logic lives, which changes who depends on whom, which changes deployment, testing, and team ownership. This file covers three architectural variants, detection in CI, and ArchUnit rules that prevent regression.

## 1. Service Layer envy — the anemic domain model symptom

The most common large-scale Feature Envy in Java is the **Anemic Domain Model** (Fowler, 2003). Entities expose only getters and setters; all behavior lives in `Service` classes that pull data out, compute, and push results back. Every service method is envy-shaped.

```java
// Anemic entity — pure data bag
public class Invoice {
    private List<LineItem> items;
    private Customer customer;
    private LocalDate issuedAt;
    // getters + setters only
}

// Service class doing all the work — envy at scale
public class InvoiceService {
    public Money calculateTotal(Invoice invoice) {
        Money subtotal = Money.ZERO;
        for (LineItem item : invoice.getItems()) {
            subtotal = subtotal.plus(item.getUnitPrice().times(item.getQuantity()));
        }
        Money discount = subtotal.times(invoice.getCustomer().getDiscountRate());
        Money tax = subtotal.minus(discount).times(invoice.getCustomer().getTaxRate());
        return subtotal.minus(discount).plus(tax);
    }
}
```

Every line of `calculateTotal` touches data on `Invoice`, `LineItem`, or `Customer`. The service envies all three. The fix is **Move Method** systematically until services orchestrate, not compute.

```java
public class Invoice {
    public Money total() {
        Money subtotal = items.stream()
            .map(LineItem::lineTotal)
            .reduce(Money.ZERO, Money::plus);
        return customer.applyDiscountAndTax(subtotal);
    }
}
```

Now `InvoiceService` becomes a thin coordinator — load, call `invoice.total()`, persist. That is the legitimate role of a service.

## 2. DTO envy — mapping logic in the wrong place

Modern Java codebases swim in DTOs: API requests, API responses, persistence entities, internal value objects. Mapping between them is fertile ground for Feature Envy.

The typical mistake is putting mapping logic inside a controller or service that envies the DTO's fields.

```java
// Bad — controller envies UserRegisterRequest internals
@PostMapping("/users")
public ResponseEntity<UserDto> register(@RequestBody UserRegisterRequest req) {
    User user = new User();
    user.setEmail(req.getEmail().toLowerCase().trim());
    user.setFirstName(capitalize(req.getFirstName()));
    user.setLastName(capitalize(req.getLastName()));
    user.setFullName(req.getFirstName() + " " + req.getLastName());
    // ... 20 more lines of envy
}
```

The fix has two legitimate destinations:

1. A dedicated **Mapper** (MapStruct, manual mapper class) — mapping is now its own concern, not envy.
2. A **factory method** on the domain entity that consumes the DTO.

```java
public class User {
    public static User fromRegistration(UserRegisterRequest req) {
        return new User(
            Email.of(req.getEmail()),
            PersonName.of(req.getFirstName(), req.getLastName())
        );
    }
}
```

Now the controller calls `User.fromRegistration(req)` and the envy is gone. The domain object owns its own construction rules.

## 3. Cross-aggregate envy in DDD

In Domain-Driven Design, aggregates are consistency boundaries. Each aggregate must protect its invariants and expose intent-revealing methods. **Cross-aggregate Feature Envy is a design smell that violates aggregate boundaries.**

```java
// Bad — Order aggregate reaches into Customer aggregate's internals
public class Order {
    public boolean canBeShipped(Customer customer) {
        return customer.getAddress().getCountry().isInShippingZone()
            && customer.getSubscriptionTier().getLevel() >= 2
            && !customer.getBlockedRegions().contains(this.destination);
    }
}
```

Here `Order` envies `Customer`'s address, subscription, and blocked regions. The correct design moves the decision into `Customer`, or extracts a **Domain Service** that coordinates two aggregates without either of them owning the other's data.

```java
public class ShippingEligibilityService {
    public boolean isEligible(Order order, Customer customer) {
        return customer.allowsShippingTo(order.destination());
    }
}
```

`Customer.allowsShippingTo` keeps its data private. The service composes without envy.

**Rule of thumb:** if a method on aggregate A reads three or more fields from aggregate B, either move the logic into B, or extract a domain service.

## 4. Detection in CI

Manual code review catches some envy, but professional teams automate detection. Three tool categories matter.

**Static analysis platforms:**
- **NDepend** (commercial, .NET-first but supports Java via plugins) — rule `AvoidMethodsWithTooManyForeignAccess`.
- **Structure101** — visualises feature envy through coupling graphs and provides "leaky abstraction" diagnostics.
- **JArchitect** — Java-specific equivalent of NDepend, with built-in `FeatureEnvyMethods` query.
- **SonarQube/SonarJava** — rule **S3398** ("methods should not access fields of other classes excessively") flags candidate envy.
- **PMD** — `GodClass` and `LawOfDemeter` rules catch related shapes.
- **IntelliJ IDEA** — built-in inspection "Feature envy" under "Class metrics" group.

**Architectural fitness functions:**

ArchUnit lets you encode rules that fail the build when crossed. Two practical rules for Feature Envy at the architectural level:

```java
@ArchTest
static final ArchRule services_should_not_call_getters_in_bulk =
    methods().that().areDeclaredInClassesThat().resideInAPackage("..service..")
        .should(new ArchCondition<JavaMethod>("call no more than 3 getters of any single domain class") {
            @Override
            public void check(JavaMethod method, ConditionEvents events) {
                Map<JavaClass, Long> getterCalls = method.getMethodCallsFromSelf().stream()
                    .filter(call -> call.getTarget().getName().startsWith("get"))
                    .collect(Collectors.groupingBy(
                        call -> call.getTargetOwner(),
                        Collectors.counting()));
                getterCalls.forEach((cls, count) -> {
                    if (count > 3) {
                        events.add(SimpleConditionEvent.violated(method,
                            method.getFullName() + " calls " + count + " getters on " + cls.getName()));
                    }
                });
            }
        });

@ArchTest
static final ArchRule controllers_should_not_use_domain_setters =
    noClasses().that().resideInAPackage("..web..")
        .should().callMethodWhere(target(name().startsWith("set"))
            .and(target(owner(resideInAPackage("..domain..")))));
```

The first rule directly targets the envy heuristic — "more than three getters of the same class". The second prevents controllers from manipulating domain state, which is where envy enters the persistence boundary.

## 5. Trend metrics, not point checks

A single envy method is normal. Professional teams track the **trend**:

- Count of methods flagged by S3398 per release.
- Average ATFD (Access To Foreign Data) per service package.
- Ratio of domain methods to service methods. A healthy ratio rises as the codebase matures.

Plot these on dashboards next to coverage and complexity. Rising envy counts predict rising defect rates and slowing feature throughput.

## 6. When envy is acceptable — professional judgement

Three legitimate cases where envy is the right answer:

1. **Visitors and double dispatch** — the visitor by design reads the visited object's state. Move Method would defeat the pattern.
2. **DTO mappers** — a mapper class exists precisely to read foreign data. Concentrating envy in one place is the design.
3. **Cross-context anti-corruption layers (ACLs)** — an ACL translating between bounded contexts reads foreign data from the other context. That envy is the boundary's job.

In all three cases the envy is **named**, **isolated**, and **expected**. Uncontrolled envy scattered through services is the problem.

## Quick rules

- Anemic domain model is Feature Envy at architectural scale.
- Mapping logic belongs in mappers or factory methods, not controllers.
- Cross-aggregate envy is an aggregate boundary violation — move logic or add a domain service.
- Enforce with SonarJava S3398, IntelliJ inspections, and ArchUnit fitness functions.
- Track envy trends across releases, not just point-in-time counts.
- Visitors, mappers, and ACLs are legitimate concentrated envy.

## What's next

After this file move to `specification.md` to learn the precise metrics (ATFD, FDP, LAA) Lanza and Marinescu defined for objective envy detection. Then `find-bug.md` for hands-on diagnosis, `optimize.md` for performance angles, `tasks.md` for practice, and `interview.md` for interview-ready answers.

## Memorize this

Feature Envy at the professional level is an architectural symptom. Anemic services, DTO mappers in controllers, and cross-aggregate reaches are all envy. Fix with Move Method, factory methods, and domain services. Detect with SonarJava S3398, JArchitect, and ArchUnit fitness functions. Track the trend across releases — rising envy predicts rising defect rates. Visitors, mappers, and ACLs are the only places concentrated envy is by design.
