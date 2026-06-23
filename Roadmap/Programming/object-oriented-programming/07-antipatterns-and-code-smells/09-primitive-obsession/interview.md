# Primitive Obsession — Interview Q&A

20 questions covering definitions, design trade-offs, modern Java idioms (records, sealed types, JEP 401), performance, tooling, and migration. Answers are concise and assume working Java knowledge.

---

## Q1. What is Primitive Obsession?

A code smell, named in Fowler's *Refactoring*: using language primitives (`String`, `int`, `long`, `boolean`, `double`, plus quasi-primitives like `UUID` and `BigDecimal`) to represent domain concepts that deserve their own types. The compiler then cannot distinguish `userId` from `orderId`, `USD` from `EUR`, or `email` from `name`. Bugs that should be type errors become silent runtime failures.

**Follow-up:** *"Give an example you've actually seen."* — a real anecdote (swapped `String email, String name`, currency mismatches, time-unit confusions) is what interviewers want.

---

## Q2. Why is `String email, String name` a smell when `String email` alone isn't?

A single `String email` parameter has no neighbour to be confused with at the call site. Two `String` parameters of the same type *can* be swapped silently — the type system has no way to enforce position. The smell escalates with confusability; one well-named `String` is usually fine, two same-typed `String`s with different meanings is not.

**Trap:** Candidates often claim *every* `String` is Primitive Obsession. That's tiny-types maximalism; it isn't pragmatic.

---

## Q3. What's the cheapest fix in modern Java?

A `record` with a compact constructor.

```java
public record Email(String value) {
    public Email {
        if (value == null || !value.contains("@")) throw new IllegalArgumentException();
    }
}
```

Three lines: nominally distinct type, value-based equality, immutable, self-validating. Java 16+ (JEP 395, finalized). Before records, the same wrapper took 15–20 lines of boilerplate.

---

## Q4. What does the compact constructor do that a regular one can't?

The compact constructor (the body without explicit parameters) runs *before* the implicit field assignments and can *reassign* the parameters. This is where validation and normalisation live.

```java
public record Email(String value) {
    public Email {
        Objects.requireNonNull(value);
        if (!value.contains("@")) throw new IllegalArgumentException();
        value = value.toLowerCase(Locale.ROOT);    // normalise
    }
}
```

A regular canonical constructor would require `this.value = value.toLowerCase(...)` — more typing and easier to forget. Compact constructors make the validation+normalisation idiom one line cheaper.

---

## Q5. When should you *not* wrap a primitive?

Three cases:

- **Free-form content** (a search query, a chat message) — no invariants, no confusion.
- **Single-use locals** that never cross a method boundary.
- **Transport-layer DTOs** — JSON and SQL speak primitives; wrap on the way in.

Wrapping these adds friction without removing bugs.

---

## Q6. How do you handle Money correctly?

Three constraints:

- **`BigDecimal` for the amount.** `double` loses pennies; `long cents` works for integer addition but breaks under multiplication for tax/interest.
- **Currency travels with the amount.** A `Money(amount, currency)` record refuses cross-currency operations.
- **Explicit rounding mode.** `RoundingMode.HALF_EVEN` is the banking default; document the choice on the API.

```java
public record Money(BigDecimal amount, Currency currency) {
    public Money plus(Money o) {
        if (!currency.equals(o.currency)) throw new IllegalArgumentException();
        return new Money(amount.add(o.amount), currency);
    }
}
```

**Trap:** "Just use `double`" — every interview answer that does is wrong. IEEE-754 cannot represent `0.1` exactly.

---

## Q7. Should IDs be `long` or `UUID`?

It depends on exposure. **Internal IDs** can be `long` (sequential, cheap, indexable). **Externally visible IDs** should be `UUID` or `ULID` — sequential IDs leak business volume (a competitor counting your IDs).

Whichever you choose, wrap them:

```java
public record UserId(UUID value) {}
```

The wrapper type protects against ID-confusion bugs (`UserId` vs `OrderId`) regardless of the underlying representation.

---

## Q8. What's a "tiny type" and is it always a good idea?

A tiny type (also "micro-type" or "newtype") is a wrapper around a single primitive with no behaviour beyond identity. The argument *for* tiny types: maximum compile-time safety. The argument *against* in Java today: each wrapper is a heap allocation, and 200 micro-types in a 50-class service add cognitive load.

The pragmatic position: wrap where bugs would happen — confusable primitives, validated formats, behaviour-bearing values. Skip wrappers for primitives that travel alone with no risk of confusion.

When Valhalla (JEP 401) finalises, the allocation cost largely disappears, and the calculus shifts toward more universal wrapping.

---

## Q9. How do you encode an enum-like type with different per-variant fields?

A `sealed interface` with `record` permitted subtypes. Each variant carries only the fields it needs.

```java
public sealed interface Notification permits EmailNotification, SmsNotification {}
public record EmailNotification(Email to, String subject, String body) implements Notification {}
public record SmsNotification(PhoneNumber to, String message)          implements Notification {}
```

JEP 409 (sealed classes, finalised in Java 17) + JEP 441 (pattern matching for switch, finalised in Java 21) make this idiom first-class. Exhaustive switch on a sealed type forces every consumer to handle every variant at compile time.

---

## Q10. Records vs sealed classes vs value classes — when do you use each?

| Tool                    | Use when                                                |
|-------------------------|---------------------------------------------------------|
| `record`                | Single-shape immutable value (Email, Money, UserId)     |
| `enum`                  | Small fixed set with simple, identical behaviour        |
| `sealed interface` + records | Closed set of variants with *different* shapes     |
| `value class` (JEP 401, preview) | Record-like value in a hot path where allocation hurts |

Default to `record`; promote to sealed when shapes diverge; reach for `value class` only after JMH proves allocation cost is significant.

---

## Q11. What about boolean flags?

Two or more boolean parameters in a method are an anti-pattern equivalent to confusable strings — the call site reads as `(true, false, true)` with no hint about which slot is which. Replace each with a small enum.

```java
// Smell
processor.process(o, true, false, true);

// Fix
processor.process(o, Priority.URGENT, Mode.REGULAR, Execution.DRY_RUN);
```

A single boolean naming a clear binary fact (`isReadOnly`) is fine. A boolean naming a *mode* (`isUrgent`) almost never is.

---

## Q12. How does this relate to *Data Clumps*?

Closely. Primitive Obsession is the *atomic* smell — one primitive that should be a type. Data Clumps is the *aggregate* smell — three or four primitives that always travel together and should be one type.

```java
// Data Clump: year, month, day always together → use LocalDate or Appointment
public void schedule(long id, int year, int month, int day, int hour, int minute) { ... }
```

The fix for both is the same family of refactorings: *Replace Data Value with Object* (single primitive) and *Introduce Parameter Object* (clump of primitives). See [../08-data-clumps/](../08-data-clumps/).

---

## Q13. What's Project Valhalla and why does it matter?

Project Valhalla is an OpenJDK effort to add *value types* — identity-free, immutable, flattenable classes — to the JVM. The first preview, **JEP 401: Value Classes and Objects**, introduces the `value` modifier.

For Primitive Obsession, Valhalla matters because today every wrapper is a heap allocation; in Valhalla a `value record Money(...)` field can be stored *inline* in its containing class, taking only the memory of its components. The allocation argument against wrapping largely disappears.

Status check before answering this in 2026+: confirm whether JEP 401 has finalised or is still preview, and which version it ships in.

---

## Q14. How do you enforce the discipline across a team?

**ArchUnit rules** are the strongest mechanism. A rule that fails the build when a domain method takes raw `String`/`int`/`UUID` catches regressions before review.

```java
@ArchTest
static final ArchRule domain_methods_dont_take_raw_primitives =
    methods().that().areDeclaredInClassesThat().resideInAPackage("..domain..")
             .and().arePublic()
             .should().notHaveRawParameterTypes(String.class, UUID.class, int.class, long.class);
```

For legacy modules, use `ArchUnit.freeze()` to baseline existing violations and fail only on new ones. Pair with Checkstyle (parameter-count rules) and SpotBugs (autoboxing detectors).

---

## Q15. How do you migrate a million-line codebase from primitives to wrappers?

Phased migration:

1. Pick a bounded context with a single owning team.
2. Introduce the wrappers alongside existing primitive APIs.
3. Add overloads that take the wrappers; have them delegate to the primitive versions.
4. Migrate callers one at a time.
5. When usage is zero, deprecate the primitive API; two releases later, delete.

Time budget: 12–24 months for a million-line service, with two engineers at 20% time. Bug-reduction starts in month three.

---

## Q16. How does Java's wrapper approach compare to TypeScript or Haskell?

TypeScript uses *brand types* (also called nominal types) — a structural-typing escape hatch:

```typescript
type Email = string & { readonly __brand: 'Email' };
```

Haskell uses `newtype` — zero-cost, compile-time only.

Scala has *value classes* — zero-cost in some contexts. Kotlin has *inline classes* (now *value classes*) similarly.

Java's approach via `record` is *nominal* (the type is distinct, like brand types) but *not* zero-cost (each wrap allocates). Project Valhalla closes the gap.

---

## Q17. What's the difference between a value object and an entity?

A **value object** is identified by its attributes — two `Money(100, USD)` instances are interchangeable.

An **entity** is identified by an ID — two `Customer` records with the same name but different IDs are still different customers.

Value objects are immutable, side-effect free, replaceable. Entities have a lifecycle. Both can be implemented in modern Java with `record` (value object) and a class with a `CustomerId` field (entity), but the semantics differ.

---

## Q18. Should DTOs and JSON contracts use typed wrappers?

Generally no. DTOs are the *boundary* — they speak the wire format, which speaks primitives. Leaking wrapper types into JSON either bloats the schema (`{"email":{"value":"..."}}`) or requires custom serializers that hide the structure.

```java
public record CreateUserRequest(String email, String name) {}    // primitive at the boundary

@PostMapping("/users")
public ResponseEntity<?> create(@RequestBody CreateUserRequest req) {
    userService.register(new Email(req.email()), new FullName(req.name()));
    return ResponseEntity.ok().build();
}
```

The DTO stays primitive; the controller converts at the boundary. From `userService.register` inwards, everything is typed.

---

## Q19. What's the runtime cost of wrapping?

A `record` instance on HotSpot, 64-bit JVM with compressed OOPs: 12-byte header + payload + padding = roughly 24–32 bytes per instance. Compare to a bare `long`: 8 bytes, no header, no allocation.

In practice the JIT *erases* most of this cost via escape analysis and scalar replacement — the intermediate wrappers inside a hot loop never reach the heap. Measure with `-XX:+PrintEliminateAllocations` and JMH before assuming wrappers are expensive.

For genuinely allocation-sensitive paths today: drop to primitives inside the hot loop, re-wrap at the boundary. When Valhalla ships, this trade-off largely disappears.

---

## Q20. If you had to name *one* refactor that has the highest ROI in a primitive-heavy codebase, which is it?

**Replace `String` user IDs with a typed `UserId` (and the same for every other entity ID).**

Reasons:

- IDs appear in almost every method signature.
- ID confusion bugs (passing `OrderId` where `UserId` is expected) are the most common Primitive Obsession failure in real systems.
- The refactor is mechanical, low-risk, and yields hundreds of compile-time guards for the price of one wrapper per entity.

Money is a close second — but money types take more care (BigDecimal, currency, rounding). IDs are the easy win.

**Follow-up:** *"How would you start the migration?"* — introduce the wrappers, add overloaded APIs, migrate the highest-traffic callers first, freeze the legacy API, delete after two releases.

---

**Memorize this:** Primitive Obsession is "the compiler can't tell my values apart". The cure is *typed wrappers* (records in Java 16+), validated in compact constructors, enforced at boundaries, automated with ArchUnit. Money uses `BigDecimal` + `Currency`; IDs are opaque wrappers; booleans become enums; time uses `Instant`/`Duration`. Wrap where confusion can happen, leave primitives where they're already the domain, and watch JEP 401 — it will change the cost equation for good.
