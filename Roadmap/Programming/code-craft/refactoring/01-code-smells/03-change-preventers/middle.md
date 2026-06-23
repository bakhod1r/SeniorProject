# Change Preventers — Middle Level

> Focus: real-world cases of Divergent Change, Shotgun Surgery, and Parallel Inheritance Hierarchies.

---

## Table of Contents

1. [Why Change Preventers happen](#why-change-preventers-happen)
2. [Real-world cases for Divergent Change](#real-world-cases-for-divergent-change)
3. [Real-world cases for Shotgun Surgery](#real-world-cases-for-shotgun-surgery)
4. [Real-world cases for Parallel Inheritance Hierarchies](#real-world-cases-for-parallel-inheritance-hierarchies)
5. [Diagnosis from git history](#diagnosis-from-git-history)
6. [Trade-offs: when scattering is right](#trade-offs-when-scattering-is-right)
7. [Cross-cutting concerns vs Shotgun Surgery](#cross-cutting-concerns-vs-shotgun-surgery)
8. [Comparison with related smells](#comparison-with-related-smells)
9. [Review questions](#review-questions)

---

## Why Change Preventers happen

Three patterns produce Change Preventers:

### 1. Wrong abstraction boundaries

The first cut into modules / classes was made before the team understood the domain. Six months later, real change patterns reveal that the cuts are wrong — but the cuts are now load-bearing in the codebase.

### 2. Layers that mirror each other

Many architectures have multiple representations of the same concept (domain object, DTO, ORM entity, API schema, validation schema, test fixture). Each was born "because the layer needed it" — but each evolves independently. Change one, you have to change them all.

### 3. Service-by-aggregate, not service-by-use-case

A `CustomerService` accumulates everything customer-related. A `CustomerService` *should* be split by what callers do (`Onboarding`, `Identity`, `Notifications`) — not by data type.

---

## Real-world cases for Divergent Change

### Case 1 — `User` god service in a SaaS app

**Setting:** B2B SaaS with `UserService` (Java Spring). Started at 5 methods (CRUD). After 4 years: 187 methods covering identity, authentication, authorization, profile, preferences, notifications, billing, social graph, audit, feature flags, GDPR, and impersonation.

**Symptoms:**
- 22 different engineers had recent commits in `UserService.java`.
- Merge conflicts daily.
- New engineers needed 1 week to understand `UserService` before being productive.
- A change to "billing email" surfaces as a ripple in 4 unrelated tests because they all instantiate `UserService` with mock collaborators.

**Refactor:** Extract Class along reasons-to-change boundaries — 11 services, each owning a coherent area:

```
UserIdentityService           // create, rename, profile
UserAuthService               // password, MFA, session
UserAuthorizationService      // roles, permissions
UserPreferencesService        // settings
UserNotificationService       // channels, opt-in
UserBillingService            // payment methods, subscriptions
UserSocialService             // friends, followers
UserAuditService              // activity log
UserFeatureFlagService        // flag overrides per user
UserGdprService               // export, delete, anonymize
UserImpersonationService      // admin login-as-user
```

Each service owns one or two database tables, has 5-15 methods, can be modified independently. Merge conflicts dropped 80%.

### Case 2 — A controller that grew too smart

**Setting:** `OrderController` in a Spring Boot service. 1,200 lines across 30 endpoints. Each endpoint had business logic inline (validation, pricing, fulfillment, persistence).

**Why:** the team treated the controller as "the place orders happen."

**Refactor:**
- Move business logic to `OrderApplicationService` classes (one per use case: `PlaceOrder`, `RefundOrder`, `CancelOrder`, ...).
- Controller becomes thin: parse, call service, format response.

Now changing pricing logic touches `PricingService`. Changing order routing touches `RoutingService`. Each service has a small, cohesive interface.

### Case 3 — Frontend god component

The same smell in the frontend: a `<UserProfile>` component with 20 props, handling editing, avatar uploads, password changes, friend management, notification settings. Cure: split into `<ProfileEditor>`, `<AvatarUpload>`, `<PasswordChanger>`, etc.

---

## Real-world cases for Shotgun Surgery

### Case 1 — The DTO/Entity/Schema scatter

**Setting:** A Spring Boot + GraphQL service. Each domain concept had:
- `Customer.java` — domain class
- `CustomerEntity.java` — JPA `@Entity`
- `CustomerDto.java` — REST DTO
- `CustomerInputDto.java` — REST input DTO
- `CustomerOutputDto.java` — REST response DTO
- `CustomerType.java` — GraphQL type
- `CustomerInput.java` — GraphQL input type
- `CustomerMapper.java` — manual mappers between all of the above
- `customer-schema.graphql`
- `CustomerFixture.java` — test fixture

Adding "country" required editing 10 files. PRs were huge; reviewers couldn't tell at a glance whether the change was correctly applied to all 10.

**Refactor:**
1. Establish `Customer.java` as single source of truth (fields, validation).
2. Generate JPA entity, DTO, GraphQL type from it (use MapStruct + a build-time generator).
3. The graphql schema is generated from the Java type.

After: adding "country" is a one-line change to `Customer.java`; the rest is regenerated.

**Trade-off:** code generation introduces build-time complexity. Teams unfamiliar with annotation processors may push back. The win must justify it — typically yes for a 10+-engineer codebase, sometimes no for a small project.

### Case 2 — Cross-microservice schema scatter

**Setting:** 8 microservices each had their own definition of `Order`. Slightly different fields. Mappers between services translated.

**Refactor:** introduce a `.proto` file as the single source of truth. Each service generates its `Order` type from the proto. Adding a field is a proto edit + service regenerations + a coordinated deploy.

This is **schema-driven development** — the architectural answer to Shotgun Surgery across services.

### Case 3 — Logging at every method

**Setting:** every method in the codebase started with `logger.info("Entering MethodX")` and ended with `logger.info("Exiting MethodX")`. To change logging format, every method had to be edited.

This is "Shotgun Surgery for logging" — but the *cause* is different. The cure isn't extracting a logging class (it already exists); it's **AOP** or **middleware** (Spring AOP, Servlet filters, decorators). Cross-cutting concerns are not Shotgun Surgery — see below.

---

## Real-world cases for Parallel Inheritance Hierarchies

### Case 1 — Domain model + serializer hierarchy

**Setting:** Each domain class had a corresponding `*Serializer`:

```
User       ↔ UserSerializer
Order      ↔ OrderSerializer
Product    ↔ ProductSerializer
Customer   ↔ CustomerSerializer
```

Adding `Invoice` required adding both `Invoice` and `InvoiceSerializer`.

**Refactor 1:** put serialization on the domain class.

```java
class User {
    public String serialize() { ... }
}
```

**Refactor 2 (often better):** use a generic serializer (Jackson, Gson) that uses reflection / annotations. The "serializer hierarchy" disappears entirely; serialization is configuration on the domain class.

### Case 2 — Repository per entity

```
class UserRepository extends JpaRepository<User, UserId> { ... }
class OrderRepository extends JpaRepository<Order, OrderId> { ... }
class CustomerRepository extends JpaRepository<Customer, CustomerId> { ... }
```

This is parallel hierarchy by design (Spring Data JPA's pattern). Adding an entity requires adding a repository.

**Is this a smell?** Not really — Spring Data autogenerates the repository implementations from interfaces. The repository "class" is essentially a `record` from the framework's perspective. The parallelism is structural and free.

### Case 3 — Pricer, Validator, Formatter for each domain class

```
PaymentPricer    PaymentValidator    PaymentFormatter
SubscriptionPricer ...
RefundPricer ...
```

Three parallel hierarchies. Adding a payment kind = 4 new classes.

**Refactor:** put the operations on the payment kind itself.

```java
sealed interface Payment permits Cash, Card, Crypto {
    BigDecimal price();
    void validate();
    String format();
}
```

Single source of truth per payment kind.

---

## Diagnosis from git history

Both Divergent Change and Shotgun Surgery leave fingerprints in `git log`:

### Divergent Change diagnostic

```bash
git log --since='6 months ago' --pretty=format:'%s' -- path/to/UserService.java | sort | uniq -c | sort -nr
```

If the commit messages cover many unrelated topics ("Add billing", "Fix avatar upload", "Improve session timeout"), the file has Divergent Change.

### Shotgun Surgery diagnostic

```bash
git log --since='6 months ago' --pretty=format:'==COMMIT==%n%H' --name-only | awk '/^==COMMIT==/{commit=$0} /^[^=]/{count[$0]++; pairs[commit][$0]=1}' | ...
```

(Or use a tool like `code-maat` by Adam Tornhill.) The output: pairs of files often changed together. If `Customer.java` and `CustomerDto.java` and `CustomerEntity.java` always change in the same PRs, that's Shotgun Surgery.

### Hotspot detection

Adam Tornhill's "your code as a crime scene" approach: combine **change frequency** × **complexity** × **co-change**. Files in the top 5% are the most fertile ground for refactoring — usually carrying multiple smells.

---

## Trade-offs: when scattering is right

Not all scattering is Shotgun Surgery. Legitimate reasons to spread something across files:

### 1. Different lifecycles

The domain `Order` and the persisted `OrderEntity` may legitimately differ:
- `Order` evolves with business rules.
- `OrderEntity` evolves with database schema.

Coupling them means schema migrations affect domain code. Decoupling means a translation layer (mapper) exists. The mapper is the price of independent evolution.

### 2. Different security profiles

A `UserDto` exposed via API must omit fields like `passwordHash`. The "scatter" between `User` and `UserDto` enforces a security boundary — it's a feature, not a smell.

### 3. Different consumer needs

Public API DTO ≠ internal admin DTO ≠ analytics export DTO. They share concept but expose different views. Extract a "view" or "projection" type per audience; mappers stay tiny.

> **Distinguishing rule:** if changes to one place *almost always* require changes to another place to remain consistent, the scatter is Shotgun Surgery (cure: consolidate). If changes to one place are *legitimately independent*, the scatter is appropriate (cure: keep as-is, accept the mapper).

---

## Cross-cutting concerns vs Shotgun Surgery

**Cross-cutting concerns** (logging, security, transactions, auditing, retries) appear in many methods by design. They're not Shotgun Surgery — they're a recognized architectural pattern.

**Cures (not refactoring):**
- **AOP** (Spring AOP, AspectJ): aspects intercept method calls and apply cross-cutting logic.
- **Middleware** (Express, Koa, ASP.NET, Spring Filter chain): wrap requests with shared logic.
- **Decorators** (Python, TypeScript): function-level wrapping.
- **Annotations / attributes**: declarative application of cross-cutting concerns.

If your "Shotgun Surgery" is really logging or security spread across methods, **don't extract**, don't refactor — apply AOP.

---

## Comparison with related smells

| Change Preventer | Often co-occurs with | Disambiguation |
|---|---|---|
| Divergent Change | Large Class (Bloaters) | Large Class is the structural symptom; Divergent Change is the change-pattern symptom. Same root cause, same cure (Extract Class). |
| Shotgun Surgery | Duplicate Code (Dispensables), Feature Envy (Couplers) | If many places change together because they have duplicated logic, the underlying smell is Duplicate Code; cure: Extract Method/Class. If they change together because logic that should live on A lives in B, that's Feature Envy + Move Method. |
| Parallel Inheritance | Refused Bequest (OO Abusers) | Parallel hierarchies often have one tree where some leaves refuse the parent's contract. Both flag inheritance overuse. |

---

## Review questions

1. **A class has Divergent Change. The team plans to "just be more disciplined." Will it work?**
   No. Discipline doesn't address the structural problem. The class is a magnet for changes because it's where related logic lives. Without splitting it, the next addition will land there too — discipline or not.

2. **`code-maat` shows 5 files always change together. Always a smell?**
   Not always. Investigate *why*. If the changes are due to duplicated logic across the files, it's Shotgun Surgery (cure: consolidate). If due to a cross-cutting concern, that's expected (cure: AOP). If due to legitimately independent layers (domain + DTO + entity), accept the trade-off.

3. **A controller has `@Transactional` on every method. Refactor or accept?**
   Accept (this is a cross-cutting concern, applied via Spring's AOP). Or extract to a class-level `@Transactional` annotation — same effect, less repetition.

4. **My team uses MapStruct to generate mappers. Was that worth it?**
   Usually yes for medium-to-large teams. Manual mappers grow inconsistently and miss fields silently. Generated mappers fail at compile time when fields don't match. Trade-off: a build-time annotation processor in the toolchain. For small projects, manual mappers (kept tiny) are fine.

5. **`git log` shows my file modified in PRs about 4 unrelated topics. Definitely Divergent Change?**
   Probably. But check: are the commits genuinely unrelated, or do they all touch a *legitimate* facade (an API boundary class that was always supposed to coordinate features)? Boundary classes appear in many features; that's their job. Internal classes appearing in many features is the smell.

6. **What's the architectural form of Shotgun Surgery?**
   Many microservices need to be updated together for one logical change. Often a sign of misdrawn service boundaries. Cure: redraw the boundaries; consolidate the chatty services or extract the shared concern into its own service.

7. **Parallel Inheritance — Bridge pattern vs Move Method?**
   Bridge when the second hierarchy is a *genuinely independent axis* of variation (e.g., Vehicle × RentalRegion → 2D matrix). Move Method when the second hierarchy is *redundant* — its variations mirror the first 1:1.

8. **"We accept Shotgun Surgery in exchange for layer independence." Valid?**
   Sometimes. Layer independence has costs (mapper code) and benefits (legal/security boundaries, independent deployment). Validate the benefit is real. If the only reason for separate `Order` / `OrderDto` / `OrderEntity` is "we always do it this way," consolidate.

9. **A monolith has 0 Divergent Change but lots of Shotgun Surgery. What does that suggest?**
   The class boundaries are too narrow / the responsibilities are too scattered. Probably an over-engineered class hierarchy with many tiny classes that should be merged.

10. **Microservices reduce Divergent Change but introduce other smells. Which?**
    Often: Shotgun Surgery (one feature change requires editing 5 services), distributed Long Method (one workflow spread across 5 services), Alternative Classes (each service has its own definition of `Customer`). Microservices are not a free lunch — they trade one smell for others. Pick architectures based on team and change patterns, not faith.

---

> **Next:** [senior.md](senior.md) — architectural Change Preventers, code generation, hotspot analysis.
