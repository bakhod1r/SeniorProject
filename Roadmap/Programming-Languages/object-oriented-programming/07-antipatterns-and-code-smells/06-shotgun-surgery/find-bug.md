# Shotgun Surgery - Find the Bug

> Ten concrete Java scenarios where shotgun surgery is the underlying smell. Each has a snippet, a diagnosis pointing at the change radius, and a fix that consolidates the change to a single site. Style mirrors Fowler in `Refactoring` (2nd ed., ch. 3) - name the smell, name the remedy.

---

## Scenario 1: Scattered enum switch cases

```java
// PriceCalculator.java
switch (order.getType()) {
    case STANDARD: return base * 1.0;
    case PREMIUM:  return base * 0.9;
    case BULK:     return base * 0.8;
}

// ShippingCalculator.java
switch (order.getType()) {
    case STANDARD: return 5.00;
    case PREMIUM:  return 0.00;
    case BULK:     return 15.00;
}

// LoyaltyPoints.java
switch (order.getType()) {
    case STANDARD: return total * 1;
    case PREMIUM:  return total * 3;
    case BULK:     return total * 2;
}
```

**Diagnosis.** Adding a new `OrderType.GIFT` forces edits in three (or thirty) files. Classic shotgun surgery driven by an enum.

**Fix.** Move behavior onto the enum or introduce a `Strategy`. With enum methods:

```java
public enum OrderType {
    STANDARD(1.0, 5.00, 1),
    PREMIUM (0.9, 0.00, 3),
    BULK    (0.8, 15.00, 2);

    private final double priceFactor;
    private final double shipping;
    private final int loyaltyMultiplier;
    /* ctor + getters */
}
```

Adding `GIFT` is now one file. Better: a sealed interface `OrderType` with one record per variant when behavior diverges further.

---

## Scenario 2: Duplicated validation across DTOs

```java
public void createOrder(OrderRequest r) {
    if (r.email() == null || !r.email().contains("@")) throw new BadRequest("email");
    if (r.zip() == null || r.zip().length() != 5)      throw new BadRequest("zip");
    /* ... */
}

public void updateAccount(AccountRequest r) {
    if (r.email() == null || !r.email().contains("@")) throw new BadRequest("email");
    if (r.zip() == null || r.zip().length() != 5)      throw new BadRequest("zip");
}

public void registerUser(RegisterRequest r) {
    if (r.email() == null || !r.email().contains("@")) throw new BadRequest("email");
}
```

**Diagnosis.** When the email rule changes (RFC 5322, leading-dot rule, plus-addressing), every endpoint must change.

**Fix.** Extract `Email` and `ZipCode` as value objects with construction-time validation, or use Bean Validation (`@Email`, `@Pattern`) on the DTO records. One rule change, one file.

---

## Scenario 3: Format strings repeated

```java
// AuditLog.java
logger.info("user={} action={} at={}", user, action, Instant.now());

// SecurityLog.java
logger.warn("user={} action={} at={}", user, action, Instant.now());

// AccessLog.java
logger.info("user={} action={} at={}", user, action, Instant.now());
```

**Diagnosis.** Switch to structured logging (JSON, OpenTelemetry log records) means rewriting every call site. The format is the API; the API is duplicated.

**Fix.** Introduce a `StructuredLogger` facade:

```java
public final class AuditEvent {
    public static void emit(String user, String action) {
        LOG.info(Map.of("user", user, "action", action, "at", Instant.now()));
    }
}
```

All call sites become `AuditEvent.emit(user, action)`. Format changes once.

---

## Scenario 4: Change-coupled DTOs (entity, request, response, mapper)

```java
public class User { String name; String email; String phone; }
public record UserCreateRequest(String name, String email, String phone) {}
public record UserResponse(String name, String email, String phone) {}
public class UserMapper { /* manual copy fields */ }
```

**Diagnosis.** Adding `dateOfBirth` requires editing four files plus the OpenAPI spec, the database migration, the test fixtures. Codescene will rank this cluster as 90%+ coupled.

**Fix.** Use MapStruct for the mapper (it regenerates), share a common `UserCore` record where the DTOs differ only in additional fields, or unify request/response when CRUD symmetry makes that safe. The goal is N=4 file edits down to N=1 (the entity) plus one regen.

---

## Scenario 5: Magic strings as keys

```java
// LoginController.java
session.setAttribute("currentUser", user);

// LogoutController.java
session.removeAttribute("currentUser");

// ProfileController.java
User u = (User) session.getAttribute("currentUser");

// AdminController.java
User u = (User) session.getAttribute("currentUser");
```

**Diagnosis.** Rename the key, miss one site, runtime NPE. Shotgun surgery hidden as "just a string."

**Fix.** A `SessionKeys` constants holder or, better, a typed accessor:

```java
public final class SessionUser {
    private static final String KEY = "currentUser";
    public static void set(HttpSession s, User u) { s.setAttribute(KEY, u); }
    public static Optional<User> get(HttpSession s) {
        return Optional.ofNullable((User) s.getAttribute(KEY));
    }
    public static void clear(HttpSession s) { s.removeAttribute(KEY); }
}
```

---

## Scenario 6: Feature-flag checks scattered

```java
// PriceCalculator.java
if (featureFlags.isEnabled("new-pricing")) { return newCalc(order); }
else                                       { return oldCalc(order); }

// CartController.java
if (featureFlags.isEnabled("new-pricing")) { /* path A */ }
else                                       { /* path B */ }

// CheckoutService.java
if (featureFlags.isEnabled("new-pricing")) { /* path A */ }
else                                       { /* path B */ }
```

**Diagnosis.** Removing the flag (the most common end-state) means editing N files. Adding a flag variant likewise.

**Fix.** Strategy + a single composition root that picks the implementation based on the flag once. Call sites depend on the interface, not the flag.

---

## Scenario 7: Cross-cutting null-handling

```java
public String formatName(Customer c) {
    return c == null ? "" : c.getName() == null ? "" : c.getName();
}

public String formatEmail(Customer c) {
    return c == null ? "" : c.getEmail() == null ? "" : c.getEmail();
}

public String formatPhone(Customer c) {
    return c == null ? "" : c.getPhone() == null ? "" : c.getPhone();
}
```

**Diagnosis.** Changing the default from `""` to `"N/A"` is a multi-file edit. The shotgun is null-defensiveness.

**Fix.** Introduce a `NullCustomer` (Null Object pattern) or make `Customer` fields non-null by construction (`Optional<String>` or required constructor params). Null handling moves to a boundary.

---

## Scenario 8: Repeated HTTP retry/timeout config

```java
// PaymentClient.java
HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();

// InventoryClient.java
HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();

// ShippingClient.java
HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
```

**Diagnosis.** When SRE asks to bump timeouts and add retries with jitter, every client changes.

**Fix.** A `HttpClients` factory or a Spring `RestClient.Builder` bean configured once. Clients consume it.

---

## Scenario 9: SQL field lists duplicated

```java
String SELECT_USER = "SELECT id, name, email, phone FROM users WHERE id = ?";
String UPDATE_USER = "UPDATE users SET name = ?, email = ?, phone = ? WHERE id = ?";
String INSERT_USER = "INSERT INTO users (name, email, phone) VALUES (?, ?, ?)";
```

**Diagnosis.** Add `created_at` and you edit three statements, three RowMapper methods, three test fixtures. Schema changes radiate.

**Fix.** Use JPA / jOOQ / Spring Data with a single entity definition. If you must stay on raw JDBC, generate the SQL from a single field list constant and use a single `RowMapper`.

---

## Scenario 10: Event versioning leaking into every handler

```java
public void onOrderPlaced(OrderPlacedEvent e) {
    if (e.version() == 1) { /* handle v1 */ }
    else if (e.version() == 2) { /* handle v2 */ }
    else if (e.version() == 3) { /* handle v3 */ }
}

public void onOrderShipped(OrderShippedEvent e) {
    if (e.version() == 1) { /* v1 */ }
    else if (e.version() == 2) { /* v2 */ }
}
```

**Diagnosis.** Every new event version means editing every handler. The version-branching is duplicated and grows.

**Fix.** Upcasters at the consumer ingress (see `professional.md`): a chain `V1 -> V2 -> V3` runs once, handlers see only the current version. Adding V4 means adding one upcaster, zero handler changes.

---

## Pattern across all ten scenarios

Every fix above follows one of three moves from `Refactoring`:

1. **Move Function / Move Field** - put behavior next to data (Scenarios 1, 7).
2. **Extract Class / Combine Functions into Class** - make the scattered concept a thing (Scenarios 2, 3, 5, 8, 9).
3. **Replace Conditional with Polymorphism** - swap branches for types (Scenarios 1, 6, 10).

The recipe to detect them in code review: when the diff touches N files for what the PR description calls "a single change," ask whether one of these moves would have made it 1 file. If yes, the original code has shotgun surgery, and the PR is paying the tax instead of fixing it.
