# Primitive Obsession — Junior

> **What?** *Primitive Obsession* is the habit of using language primitives — `String`, `int`, `long`, `boolean`, `double` — to represent rich domain concepts: emails, user IDs, money, time instants, currencies, percentages, statuses. The type system happily accepts a `String` for an email, a `String` for a phone number, and a `String` for a user ID, but it cannot tell them apart. Bugs follow.
> **How?** When you see a method signature like `void notify(String a, String b, String c)`, ask: would the compiler catch me if I swapped any two of these arguments? If the answer is "no", you have Primitive Obsession. The fix is a small typed wrapper — usually a `record` — for each domain concept, so that `Email` and `UserId` become *different types* even though both are just a `String` underneath.

---

## 1. The point in one sentence

A `String` is a sequence of characters. An `Email` is a domain concept with a format, a normalisation rule, and an identity in your business. Using the former where you mean the latter throws away every guarantee the type system could have given you, and pushes those guarantees into runtime checks, comments, and human discipline — which fail.

Primitive Obsession is *not* about avoiding `String`s in your program. It is about avoiding `String`s in your *domain APIs*. Inside a `JsonParser` or a `CsvWriter` you live and breathe characters. Inside an `OrderService` you should not.

---

## 2. The canonical bug — swapped arguments

```java
public void sendWelcome(String email, String name, String userId) { ... }

// At a call site three layers up:
mailer.sendWelcome(user.getName(), user.getEmail(), user.getId());
//                  ^^^^ name in the email slot, email in the name slot
```

This compiles. Tests that use `"alice@example.com"` for both fields pass. Production sends a welcome email to a blank inbox addressed to `alice@example.com` — because the *name* ended up where the *email* was expected.

You did not write a bug. The type system invited one by saying "all three of these are just `String`".

```java
// With typed wrappers, the swap stops compiling:
public void sendWelcome(Email email, FullName name, UserId userId) { ... }

mailer.sendWelcome(user.getName(), user.getEmail(), user.getId());
//                  ^^^^ FullName supplied where Email expected — compile error
```

The compiler refuses the swap. Three minutes of writing wrappers buys a permanent guarantee.

---

## 3. The other canonical bug — naked `int` for money

```java
public void refund(int amount) { ... }
```

`int` for money is wrong on at least four counts:

- **Units.** Is `amount` cents, dollars, or thousandths of a unit? The signature does not say.
- **Currency.** Is it USD or YEN? They have different decimal places.
- **Overflow.** `Integer.MAX_VALUE` is about 2.1 billion — easily blown by a corporate invoice in cents.
- **Negatives.** Refund `-100` cents? Refund `+100`? Conventions differ across services.

Each call site must remember all four conventions. They forget.

```java
public record Money(long cents, Currency currency) {
    public Money {
        if (cents < 0) throw new IllegalArgumentException("negative amount");
    }
}

public void refund(Money amount) { ... }
```

Now the unit is part of the type, the currency travels with the value, the precision is wide enough for any realistic invoice, and "negative refund" stops compiling without an explicit unwrap.

---

## 4. The smell vocabulary

You'll meet Primitive Obsession in several disguises:

- **String-typing** — a `String` for everything that has a name: email, phone, country code, ISO currency, postcode, user ID, file path.
- **Numeric-typing** — `int`/`long` for money, time, percentage, quantity, identifier.
- **Boolean flags** — `void process(Order o, boolean isUrgent, boolean isRefund, boolean dryRun)` — three booleans, eight call combinations, zero compile-time hints.
- **Magic-number enums** — `int status; // 0 = pending, 1 = paid, 2 = cancelled` — a comment instead of an enum.

All four flavours share the same root cause: a domain concept is being smuggled through the type system as a primitive that has no idea what it represents.

---

## 5. The cheapest fix — a Java `record`

Since Java 16 (JEP 395), `record` gives you a typed wrapper in one line:

```java
public record Email(String value) {
    public Email {
        if (value == null || !value.contains("@")) {
            throw new IllegalArgumentException("invalid email: " + value);
        }
    }
}

public record UserId(long value) {
    public UserId {
        if (value <= 0) throw new IllegalArgumentException("userId must be positive");
    }
}

public record FullName(String value) {
    public FullName {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("name must not be blank");
        }
    }
}
```

Each `record` gives you:

- A `final` class with a `final` field.
- An auto-generated constructor, accessor, `equals`, `hashCode`, and `toString`.
- A *compact constructor* (`public Email { ... }`) for validation — no `this.value = value` needed; the assignment is implicit.

These three lines per concept are usually enough to eliminate an entire family of bugs.

---

## 6. Where the obsession hides

Primitive Obsession is rarely deliberate. It creeps in through three habits:

- **Database-first thinking.** A schema column is `VARCHAR(255)`, so the field is `String`. The mapper produces `String`, the service accepts `String`, the controller accepts `String`. Nobody ever wraps it.
- **JSON contracts.** An API receives `{"userId": "u-7f9"}` as a `String`, and the parsing layer never converts it. The `String` flows straight into business logic.
- **Convenience.** "It's just a phone number, it's already a `String`, why bother?" — until someone passes a name into the phone-number slot.

The fix is to *wrap at the boundary*: when data crosses from JSON / SQL / HTTP into your domain, convert it. From that point on, domain code only sees typed wrappers.

```java
// At the controller boundary:
@PostMapping("/users")
public ResponseEntity<?> create(@RequestBody CreateUserDto dto) {
    var email = new Email(dto.email());
    var name  = new FullName(dto.name());
    userService.register(email, name);
    return ResponseEntity.ok().build();
}
```

The DTO can stay primitive — it's a transport object. The service must not.

---

## 7. Why not just rely on parameter names?

You might be thinking: "but my method signature *does* name them — `String email, String name` — isn't that enough?"

It isn't, for three reasons:

- **Java is not named-argument-passing.** At the call site, arguments are positional. Compiler sees `(s1, s2)`, not `(email=…, name=…)`.
- **Refactors lose names.** When you extract a method, the new parameter names are whatever the IDE guessed. Original intent vanishes.
- **Cross-layer trips.** A `String` passed through five layers gets a different parameter name in each layer. Drift accumulates.

A *type* travels with the value through every layer. A *name* is local to one method.

---

## 8. Common newcomer mistakes

**Mistake 1: wrapping everything**

```java
public record FirstName(String value) {}
public record LastName(String value)  {}
public record MiddleName(String value) {}
public record Suffix(String value) {}
```

If first and last names are never confused for each other in any operation — they always travel together in a `FullName` — splitting them buys nothing. Wrap *concepts that get confused*.

**Mistake 2: skipping validation**

```java
public record Email(String value) {}      // anything goes

new Email(null);          // accepted
new Email("");            // accepted
new Email("not-an-email"); // accepted
```

The wrapper without validation is decoration, not protection. Always add the compact-constructor check.

**Mistake 3: leaking the primitive back out**

```java
public record Email(String value) {}

mailer.send(email.value(), subject, body);   // back to String — okay at boundary
mailer.send(email.value(), email.value(), body);   // not okay — domain code should not unwrap
```

Unwrapping at the boundary (DB, SMTP, network) is fine. Unwrapping in the middle of a domain method usually means you've stopped getting value from the type.

**Mistake 4: re-using `String` for the wrapper's underlying field unguarded**

```java
public record UserId(String value) {}    // looks fine

new UserId("u-7f9");
new UserId("alice@example.com");          // still accepted — the wrapper didn't actually narrow the domain
```

The wrapper's compact constructor is what *narrows* — without it the type just renames, it doesn't constrain.

---

## 9. Tiny worked example — the order service

Before:

```java
public class OrderService {
    public void placeOrder(String userId, String productId, int quantity, int amountCents) {
        // anything-goes — userId could be productId, quantity could be amountCents
    }
}
```

After:

```java
public record UserId(long value) {
    public UserId { if (value <= 0) throw new IllegalArgumentException(); }
}
public record ProductId(long value) {
    public ProductId { if (value <= 0) throw new IllegalArgumentException(); }
}
public record Quantity(int value) {
    public Quantity { if (value <= 0 || value > 1000) throw new IllegalArgumentException(); }
}
public record Money(long cents, Currency currency) {
    public Money { if (cents < 0) throw new IllegalArgumentException(); }
}

public class OrderService {
    public void placeOrder(UserId userId, ProductId productId, Quantity qty, Money amount) {
        // a swap is now a compile error
    }
}
```

Four typed records, each one to four lines, replace a swamp of `String`/`int` parameters. The signature now reads like prose: "place an order for this user, this product, this quantity, at this amount".

---

## 10. Quick rules

- [ ] If a method takes two or more `String`s that mean different things, wrap them.
- [ ] If a numeric primitive has a unit (cents, seconds, percent), wrap it.
- [ ] If a boolean encodes a *mode*, replace it with a small enum.
- [ ] Always validate in the compact constructor — wrapper without check is decoration.
- [ ] Wrap *at the boundary*, not inside hot loops.

---

## 11. What's next

| Topic                                                          | File              |
| -------------------------------------------------------------- | ----------------- |
| Refactoring catalog: Replace Data Value with Object            | `middle.md`        |
| DDD value objects, tiny types, Money traps                     | `senior.md`        |
| Project Valhalla, JEP 401 value classes, ArchUnit              | `professional.md`  |
| Metrics, thresholds, ArchUnit/Checkstyle rules                 | `specification.md` |
| Ten primitive-obsession bugs from production                   | `find-bug.md`      |
| Wrapper overhead, escape analysis, Valhalla performance        | `optimize.md`      |
| Hands-on exercises                                             | `tasks.md`         |
| Interview Q&A                                                  | `interview.md`     |

Related smells in this section:

- [Data Clumps](../08-data-clumps/) — three primitives that always travel together; wrap them as a value object.
- [Anemic Domain Model](../02-anemic-domain-model/) — data with no behaviour; typed wrappers carry the behaviour back.
- [Immutability patterns](../../05-immutability/) — value objects are immutable by default.

---

**Memorize this:** Primitive Obsession is the type system's silent failure mode. Every domain concept deserves a name in code, not a comment. When you see `String`, `int`, `long`, or `boolean` in a *domain* signature, ask whether the caller could swap two of them without the compiler noticing — if yes, wrap them.
