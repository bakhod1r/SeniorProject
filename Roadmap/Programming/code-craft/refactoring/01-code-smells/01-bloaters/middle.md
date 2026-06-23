# Bloaters — Middle Level

> Focus: "Why?" and "When?" — real-world triggers, trade-offs, and how Bloaters appear in production codebases.

---

## Table of Contents

1. [Why Bloaters happen in real codebases](#why-bloaters-happen-in-real-codebases)
2. [Real-world cases for Long Method](#real-world-cases-for-long-method)
3. [Real-world cases for Large Class](#real-world-cases-for-large-class)
4. [Real-world cases for Primitive Obsession](#real-world-cases-for-primitive-obsession)
5. [Real-world cases for Long Parameter List](#real-world-cases-for-long-parameter-list)
6. [Real-world cases for Data Clumps](#real-world-cases-for-data-clumps)
7. [Trade-offs: when NOT to refactor a Bloater](#trade-offs-when-not-to-refactor-a-bloater)
8. [Migration vs. live system](#migration-vs-live-system)
9. [Comparison with related smells](#comparison-with-related-smells)
10. [Bloaters across paradigms](#bloaters-across-paradigms)
11. [Review questions](#review-questions)

---

## Why Bloaters happen in real codebases

Bloaters are **never written from scratch**. They emerge over time. Three forces drive their growth:

### 1. The path of least resistance

When you're adding "just one more thing," editing the existing method is trivially easier than creating a new one. The IDE shows the cursor at line 217 of an already-380-line method; you write 12 more lines and ship. Repeat 30 times across 30 PRs and the method is 700 lines.

### 2. "Who knows enough to split it?"

After a method has lived in the codebase for two years, the engineers who wrote each section have left. The current owner doesn't feel confident about what each phase needs. Splitting risks breaking something subtle. Inertia wins.

### 3. Tests that lock in the bloater

A common pattern: a 400-line method has *one* integration test that drives the whole flow. Splitting the method into helpers requires writing new tests for each helper, which the team treats as "extra work for no business value." So the method grows.

> **Real-world consequence:** Bloaters are the most common form of technical debt in legacy systems. They are also the least visible — there's no compiler warning for "this method is 500 lines."

---

## Real-world cases for Long Method

### Case 1 — The legacy `processOrder()` in e-commerce

**Setting:** A mid-size e-commerce platform's `OrderService.processOrder()` started at 50 lines in 2019. By 2024, it was 800 lines, called from 12 places, and listed 14 parameters.

**Symptoms:**
- New engineers spent 2–3 days "understanding processOrder" before being productive.
- 60% of production incidents touched `processOrder`.
- Adding a "buy now, pay later" payment option required a 200-line change inside the method, plus 7 new conditional branches.

**Triggering refactor:** A bug where loyalty points were awarded *before* fraud check rejection — meaning rejected orders earned points anyway.

**Fix:** Extract Method on every named phase, then Replace Method with Method Object turned the whole flow into an `OrderProcessor` class with one phase per method. The 14-parameter signature collapsed to a 3-parameter constructor. Total change: ~1,500 lines moved, ~300 new lines, all existing tests still passing.

### Case 2 — A Spring Boot `@RestController` method

**Setting:** Java microservice. Endpoint `POST /api/v1/customers/{id}/orders` had a controller method that did:
1. Authentication check (15 lines)
2. Authorization check (20 lines)
3. Request validation (40 lines)
4. Idempotency token check (30 lines)
5. Business logic (200 lines)
6. Response mapping (50 lines)
7. Audit logging (25 lines)

**Why it grew:** every cross-cutting concern was added inline because "Spring filters/interceptors are too magic for the team."

**Fix:** Most phases moved to filters and `@Aspect` advisors. The controller method ended up at 12 lines.

### Case 3 — A React component's `render()` (pre-hooks)

**Setting:** A class component with a 600-line `render()` method building a complex form. Every conditional UI variant lived inline.

**Why it grew:** product kept adding "show this section only when user has feature X."

**Fix:** Extract Method per section, then convert each extracted method into a sub-component. The original `render()` ended at 30 lines, mostly composition.

### When Long Method genuinely is OK

- **Simple linear data transformation:** a 100-line method that's a single `map`-`filter`-`reduce` chain operating on one type. Extracting helpers buys nothing.
- **Generated code:** code emitted by a parser generator, IDL compiler, or schema tool. Don't refactor — regenerate.
- **Interpretive loops:** a 200-line `switch` over instruction codes in a VM bytecode interpreter. Extracting one method per opcode adds dispatch overhead and makes the code harder to read, not easier.

---

## Real-world cases for Large Class

### Case 1 — The `User` god class

Almost every project has it: a `User` class that owns identity, authentication, authorization, profile, preferences, billing, notifications, social graph, audit history, and feature flags. Originally 6 fields; now 80+ fields and 200+ methods.

**Triggering refactor:** GDPR. "Right to be forgotten" required deleting only certain user data — but the team had no clear seam between PII and non-PII.

**Fix:** Extract Class along the lines of GDPR data classifications. `UserIdentity`, `UserPreferences` (anonymizable), `BillingProfile` (regulated), `SocialGraph` (other-user-owned). The `User` class became a coordinator over these.

### Case 2 — The `OrderManager` service

**Setting:** A backend service named `OrderManager` accumulated every method involving orders: `createOrder`, `cancelOrder`, `refundOrder`, `shipOrder`, `trackOrder`, `notifyCustomer`, `chargeCard`, `updateInventory`, `applyDiscount`, `validateAddress`, `calculateTax`, ...

**Why:** "It's all about orders, right?"

**Fix:** Split by *responsibility*, not *subject*: `OrderCreation`, `OrderCancellation`, `OrderShipping`, `RefundProcessing`, etc. Each becomes a small class with 3–5 cohesive methods.

### Case 3 — A framework's "everything" class

Old enterprise frameworks have 5,000-line classes named `Helper`, `Util`, or `Manager`. Often the cure isn't Extract Class — it's deleting the class entirely and moving methods to the types they actually operate on (Move Method).

### When Large Class is OK

- **Generated code:** an ORM-generated entity with 100 fields might be a Bloater on the surface but is fine to leave alone — you're not maintaining it by hand.
- **DTOs / wire types:** a class that *is* the wire format for an API often legitimately has 30 fields. The "class" is a record, not a behavior carrier.

---

## Real-world cases for Primitive Obsession

### Case 1 — The string ID disaster

**Setting:** Internal microservice. `String userId`, `String orderId`, `String productId` — all strings. A bug in 2023: an engineer accidentally passed `productId` where `userId` was expected. The compiler accepted it. Production accepted it. The system tried to look up "product P-1234" as a user and threw an obscure 500.

**Fix:** Replace Data Value with Object: `UserId`, `OrderId`, `ProductId` as distinct types. The compiler now refuses the swap. Effort: ~3 days. Bugs prevented: estimated 1–2 per quarter.

### Case 2 — Money as `double`

**Setting:** A financial reporting tool used `double` for all currency amounts. After a year, totals stopped matching: floating-point rounding errors accumulated.

**Fix:** Replace `double` with a `Money` value object backed by `BigDecimal` (Java) / `Decimal` (Python) / a fixed-point integer (Go). Currency tracking added. Equality and arithmetic moved into the type.

> **Rule of thumb:** Never use floating point for money. If you see `double` or `float64` for currency, you've found Primitive Obsession with a guaranteed correctness bug.

### Case 3 — Address as `String[]`

**Setting:** A legacy import job represented addresses as arrays: `["123 Main St", "Apt 4", "Springfield", "IL", "62701"]`. Every consumer indexed by position.

**Symptoms:** Optional fields broke positional indexing. Adding a country at the end broke every consumer that expected `[4]` to be ZIP. International addresses with different field orders couldn't be represented.

**Fix:** `Address` class with named fields, optional country, validation. The import job became simpler, not more complex.

### When Primitive Obsession is OK

- **Internal-only, single-use values:** a one-off script's `int retryCount`. Don't introduce a `RetryCount` class.
- **Truly opaque blobs:** a `String` that is genuinely just "any text" with no rules. (But verify — most "free-form strings" turn out to have rules.)
- **Performance-critical hot paths:** a value object adds an allocation per use. In a tight loop processing millions of records per second, this might matter — measure first (see [`professional.md`](professional.md) for the cost analysis).

---

## Real-world cases for Long Parameter List

### Case 1 — The `createUser` evolution

```
2019: createUser(name, email)                                        // 2 params
2020: createUser(name, email, phone)                                 // 3 params
2021: createUser(name, email, phone, address, dob)                   // 5 params
2022: createUser(name, email, phone, address, dob, referredBy)       // 6 params
2023: createUser(name, email, phone, address, dob, referredBy, marketingOptIn, smsOptIn, source)  // 9 params
2024: createUser(...) — 14 parameters, 6 of them optional with null defaults
```

**Pain point in 2024:** every call site has to pass 14 args, half of them `null`. New optional fields require touching 80+ call sites. PR diff is unreadable.

**Fix:** Introduce Parameter Object: `UserRegistration`. Add Builder pattern. Call sites set only the fields they care about.

### Case 2 — The boolean flag explosion

```java
report.generate(true, false, true, true, false, false, true, false);
```

What does any of that mean? The signature looked like:

```java
generate(
    boolean includeCharts, boolean includeRawData, boolean compress,
    boolean emailOnComplete, boolean retryOnFail, boolean useCache,
    boolean async, boolean watermark
)
```

**Fix:** Replace Parameter with Explicit Methods (`generateAsync()` vs `generateSync()`) for the meaningful behavioral splits, and an `Options` object for the configuration toggles.

### Case 3 — The "passing the same object's fields" anti-pattern

```java
// Caller has a `customer` object. The callee needs three of its fields.
processOrder(customer.getName(), customer.getEmail(), customer.getAddress(), order);
```

**Fix:** Preserve Whole Object — `processOrder(customer, order)`. The callee can pull what it needs.

> **Counter-rule:** Don't apply Preserve Whole Object if it forces the callee to depend on a much bigger interface. If the callee only needs `email`, passing the entire `customer` couples them to every change in `Customer`. In that case, Introduce Parameter Object with just the needed fields, or extract a smaller view interface.

---

## Real-world cases for Data Clumps

### Case 1 — `(latitude, longitude)` pair

**Setting:** Logistics platform. Every method that took a location took two `double` parameters: `latitude` and `longitude`.

```java
distanceBetween(double lat1, double lon1, double lat2, double lon2)
findNearestStore(double lat, double lon)
isInDeliveryZone(double lat, double lon, String zoneId)
```

A bug: an intern swapped `lat` and `lon` in a new method. The system silently calculated wrong routes for two days.

**Fix:** `Coordinate(latitude, longitude)`. Methods became `distanceBetween(Coordinate, Coordinate)`. Swap impossible.

### Case 2 — `(startDate, endDate)` pair

Every reporting method took `(LocalDate from, LocalDate to)`. Validation that `from ≤ to` was duplicated in every method (and missing in some).

**Fix:** `DateRange(from, to)` value object — validates in constructor, methods become `report.byPeriod(DateRange)`.

### Case 3 — `(currency, amount)` pair

A payment system passed `String currency, BigDecimal amount` to every method. The smell: two values that always travel together, with hidden invariants (currency is one of {USD, EUR, GBP}; amount uses a currency-specific decimal precision).

**Fix:** `Money(amount, Currency)`. Currency becomes an enum or value object. Arithmetic enforces same-currency or explicit conversion.

---

## Trade-offs: when NOT to refactor a Bloater

Not every bloater needs an immediate fix. Three legitimate reasons to leave one alone:

### 1. The cost is hidden, not real

If a Long Method ships once a year and isn't in the change-prone area, refactoring it is ceremonial. Spend the time on the bloater that's modified weekly.

### 2. The team doesn't have the test coverage

Refactoring without tests is rolling dice. If a 600-line method has no tests, write **characterization tests** (capturing current behavior) *before* extracting anything. This is slow but safer than refactoring blind.

### 3. Performance constraints

A value object replaces an `int` with a small heap-allocated object. In a hot loop running 100M times per second, this can dominate the cost. Profile before refactoring; consider value-class options (Java records, Kotlin inline classes, Go named types — see [`professional.md`](professional.md)).

> **Honest distinction:** "I don't have time" is rarely a real reason — Bloaters cost more in maintenance than the refactor would. "I don't have test coverage" *is* a real reason, but it implies "I should write tests before refactoring," not "I should leave the bloater forever."

---

## Migration vs. live system

Refactoring Bloaters in a **migration** (e.g., rewriting one service from scratch) is straightforward — design the new code without the smells.

Refactoring in a **live system** is harder. Three patterns help:

### Strangler fig

Wrap the bloater in a new interface. Direct new callers to the new interface. Migrate old callers one at a time. Eventually the bloater is unreachable; delete it.

### Branch by abstraction

Introduce an abstraction (interface) over the bloater's behavior. Provide two implementations: the old (delegates to bloater) and the new (refactored). Switch one caller at a time via a feature flag.

### Mikado method

Identify the desired refactoring; attempt it; record everything that breaks; revert. Now you have a tree of prerequisite refactorings. Apply them bottom-up. The bloater's refactor becomes a series of small, safe changes instead of one big one.

---

## Comparison with related smells

| Bloater | Often co-occurs with | Disambiguation |
|---|---|---|
| Long Method | [Switch Statements](../02-oo-abusers/junior.md), [Comments](../04-dispensables/junior.md) | If the long method is mostly a switch, the smell is Switch Statements. If it's mostly compensatory comments, the smell is Comments. |
| Large Class | [Divergent Change](../03-change-preventers/junior.md) | A Large Class that's changed for many reasons is also Divergent Change. The cures (Extract Class) are the same. |
| Primitive Obsession | Data Clumps, [Switch Statements](../02-oo-abusers/junior.md) | Type codes (`int RED = 0`) are both Primitive Obsession AND a switch statement waiting to happen. |
| Long Parameter List | Data Clumps, [Feature Envy](../05-couplers/junior.md) | If three of the parameters are always passed together from one object, it's Data Clumps + Feature Envy — caller should send the whole object. |
| Data Clumps | Primitive Obsession | Both signal a missing concept; Data Clumps emphasizes grouping, Primitive Obsession emphasizes type. |

---

## Bloaters across paradigms

### OOP (Java, C#, C++)

Bloaters of all five kinds appear naturally — the language encourages classes-with-state, which is exactly the substrate that bloats. Standard cures (Extract Method, Extract Class, value objects) directly apply. IDE refactor commands automate the mechanics.

### Dynamic OOP (Python, Ruby, JavaScript)

Long Method and Long Parameter List appear identically. Primitive Obsession is more pronounced — duck typing means a `dict` or a `tuple` often plays the role of a class for a long time. Python's `@dataclass` is the easiest cure. Mypy + strict checking catches type-swap bugs that the runtime silently allows.

### Functional (Haskell, OCaml, Scala, Clojure)

- **Long Method:** appears as a long `let`/`where` chain or a deeply nested function. The cure is the same: extract.
- **Large Class:** N/A in pure FP — but **Large Module** is the same smell with the same cure.
- **Primitive Obsession:** *less* common. Strong type systems push you toward `newtype` (Haskell), `opaque types` (OCaml), or value classes (Scala) early.
- **Long Parameter List:** common; cure is currying (partial application) or record types.
- **Data Clumps:** appears as repeated tuples; cure is named record types.

### Go

- **Long Method / Long Function:** same smell.
- **Large Class:** appears as Large Struct. Same cure (split + composition via embedding).
- **Primitive Obsession:** Go's named types (`type UserID string`) are extremely cheap and idiomatic — there's no excuse to use raw `string`.
- **Long Parameter List:** common; cure is functional options or a config struct.
- **Data Clumps:** appears identically; cure is the same (named struct).

---

## Review questions

1. **A method is 500 lines but performs a single linear pass over data. Refactor or leave alone?**
   Probably leave alone. The smell is about cognitive overload from *unrelated phases*. A single-purpose loop is fine no matter the line count. But check: are there 500 lines of *boilerplate* (logging, defensive checks) that could move to wrappers? That's a different smell.

2. **A class has 50 fields but they're all generated from a database schema. Smell?**
   Not really — generated code isn't yours to refactor. If the *uses* of the class are bloated (every method takes the whole 50-field object), refactor the uses, not the class.

3. **Why is `(currency, amount)` a stronger Data Clump than `(firstName, lastName)`?**
   Both are pairs that travel together. But `(currency, amount)` has *invariants* — you can't add USD to EUR without conversion. `Money` enforces them. `(firstName, lastName)` rarely has invariants (one is empty? two middle names?), so the case for `Name` is weaker — though still valid.

4. **A method has 4 parameters, all required, all distinct concepts (`User user, Order order, PaymentMethod pm, EmailRecipient cc`). Long Parameter List?**
   Borderline. Four is the upper limit of "fine." If you can show that callers consistently have all four nearby and never use a subset, leave alone. If you find yourself constantly grouping these for testing or for passing to subordinate calls, introduce a parameter object.

5. **My team has a rule: "no method longer than 30 lines." Is that a good rule?**
   Mostly helpful, occasionally harmful. The rule catches real Long Methods. But it also encourages "reach 28 lines, extract one fragment regardless of fit, ship." That introduces poorly-named helpers — sometimes worse than a 35-line method. Treat the rule as a smoke alarm, not a strict bound.

6. **Why is Primitive Obsession often described as "the king of smells"?**
   Because it underlies Long Parameter List (raw fields instead of objects) and Data Clumps (raw fields traveling together) and partly Long Method (no value-type behavior to extract into). Fix Primitive Obsession early and other smells get easier — sometimes vanish.

7. **A `Customer` class has 25 fields but all of them are used in most methods. Refactor?**
   Examine "used in most methods" carefully. Often what's actually true: most methods use a *small subset*; the union of subsets covers most fields. That's still Large Class. Map field-to-method usage; if the matrix is sparse, split.

8. **What signals "boolean parameter is wrong" specifically?**
   The boolean toggles *behavior* (different control flow), not *data* (a flag that flows through unchanged). `enabled: bool` flowing into a setter is fine. `archived: bool` that switches the method between archive-mode and live-mode behavior is wrong — make `archive()` and `live()` distinct methods.

9. **A method takes `(String email, String phone)` — both optional, at least one required. Refactor?**
   Yes. The invariant ("at least one") is invisible in the signature. Introduce a `ContactPoint` sealed type with `EmailContact` and `PhoneContact` variants. The signature documents the rule.

10. **When does Extract Class cause more harm than Large Class?**
    When the extracted class has poor cohesion — e.g., extracting `CustomerHelper` because "it has helper-like methods" buys nothing. Extract Class is right when the extracted methods *and* fields go together; if you're extracting only methods, you're really doing Move Method and the original class wasn't actually Large.

---

> **Next:** [senior.md](senior.md) — architectural impact, tooling, CI integration, large-codebase migration patterns.
