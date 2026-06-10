# Data Clumps — Junior

> **What?** A *data clump* is the same little group of variables — typically three to five — that keeps showing up together: as method parameters, as fields on multiple classes, as columns travelling side by side through every layer of the application. `firstName, lastName, dateOfBirth, ssn` repeated on every signature; `street, city, state, zip` floating between forms, validators, and persistence; `startDate, endDate` separated by commas in twenty places. The clump is begging to become a single concept with a name.
> **How?** Whenever you see the same three-or-more variables travel together in three-or-more places, stop and extract them into a class (or a Java **record**). Replace every signature, field group, and method body that handled them as loose primitives with a single object reference. The pile of parameters collapses; a real domain concept emerges.

---

## 1. The smell in one picture

```java
// Before — the clump (firstName, lastName, dob, ssn) appears everywhere:
public class CustomerService {
    public Customer create(String firstName, String lastName, LocalDate dob, String ssn) { ... }
    public void update(long id, String firstName, String lastName, LocalDate dob, String ssn) { ... }
    public boolean isAdult(LocalDate dob) { ... }
    public boolean matches(String firstName, String lastName, LocalDate dob, String ssn,
                           Customer other) { ... }
}

public class CustomerValidator {
    public void validate(String firstName, String lastName, LocalDate dob, String ssn) { ... }
}

public class CustomerExporter {
    public String toCsv(String firstName, String lastName, LocalDate dob, String ssn) { ... }
}
```

The same four values move as a *quartet* through the entire codebase. They aren't four independent values — they are one thing (*personal identity*) wearing the disguise of four separate primitives.

```java
// After — Introduce Parameter Object (Fowler):
public record PersonalIdentity(String firstName, String lastName, LocalDate dob, String ssn) {}

public class CustomerService {
    public Customer create(PersonalIdentity id) { ... }
    public void update(long id, PersonalIdentity newId) { ... }
    public boolean isAdult(PersonalIdentity id) { ... }
    public boolean matches(PersonalIdentity id, Customer other) { ... }
}
```

Every signature shrinks. Validation, equality, and formatting now belong on `PersonalIdentity` rather than being recomputed by every caller.

---

## 2. Why "three or more, three or more places" is the trigger

Two values together aren't necessarily a clump — `(x, y)` may legitimately stay a pair on a hot path. The smell appears when:

1. **Three or more** values travel together (the cognitive load of "what's the order of these parameters again?" jumps),
2. across **three or more** call sites, methods, or classes,
3. and they share a *single conceptual meaning* (an address, a date range, a money amount).

Below this threshold you have an accidental tuple; above it you have a missing concept. Martin Fowler's *Refactoring* lists Data Clumps among the original code smells precisely because the threshold is observable: once you spot the same trio in a third method, your hand should already be reaching for **Extract Class**.

---

## 3. Two refactorings, one outcome

Fowler's catalogue gives two main moves:

- **Introduce Parameter Object** — when the clump appears mainly in method *parameters*, wrap it in a small class and replace each signature.
- **Extract Class** — when the clump appears as *fields* on a larger class (or several classes), promote those fields into their own class and have the original hold a reference.

In modern Java both moves are usually one line:

```java
public record Address(String street, String city, String state, String zip) {}
public record DateRange(LocalDate start, LocalDate end) {}
public record Money(BigDecimal amount, Currency currency) {}
```

The record is the smallest sufficient container — immutable, with `equals`/`hashCode`/`toString` generated. The rest of the codebase improves the moment you replace `String street, String city, …` with `Address address`.

---

## 4. Symptoms you'll feel before you name the smell

You don't need to read the definition to feel a clump. The day-to-day pain looks like:

- **Long parameter lists.** Every method on the service takes five-plus primitives.
- **Parameter order mistakes.** A `String lastName, String firstName` argument swap compiles fine and ships a bug to production.
- **Copy-pasted validation.** Every layer re-checks `if (ssn.length() != 9)` because nobody owns the rule.
- **Refactor avalanches.** Adding a `middleName` requires editing forty signatures.
- **Anaemic domain.** The "Customer" class is a struct of primitives because all the logic lives in services that operate on the loose clump.

When two or more of these show up in the same area of the code, the diagnosis is almost always Data Clumps.

---

## 5. A walkthrough: address fields across three layers

```java
// Web layer:
public Response submitOrder(String street, String city, String state, String zip,
                            List<LineItem> items) { ... }

// Service layer:
public Order place(String street, String city, String state, String zip,
                   List<LineItem> items) { ... }

// Persistence layer:
public void insertShipping(long orderId,
                           String street, String city, String state, String zip) { ... }
```

The street/city/state/zip quartet appears in every layer, in the same order, with the same names. Mistakes that nothing catches:

- Web sends `(zip, state, city, street)` because a developer swapped two lines.
- Service trims `street` but not `zip`, so the database stores `"94107 "` and queries miss.
- A change to support international addresses (add `country`) means editing every signature in every layer.

Refactor:

```java
public record Address(String street, String city, String state, String zip) {
    public Address {
        Objects.requireNonNull(street);
        Objects.requireNonNull(city);
        Objects.requireNonNull(state);
        Objects.requireNonNull(zip);
    }
}

public Response submitOrder(Address shipTo, List<LineItem> items) { ... }
public Order place(Address shipTo, List<LineItem> items) { ... }
public void insertShipping(long orderId, Address shipTo) { ... }
```

The compile-time order bug disappears (you can't swap `Address.street` and `Address.zip` at the call site — they live inside the record). Validation centralises in the constructor. Adding `country` is one field, not forty edits.

---

## 6. The hardest case: clumps inside JPA entities

Junior developers often think the clump only lives in *methods*. It also hides in *entities*:

```java
@Entity
public class Customer {
    @Id long id;
    String firstName;
    String lastName;
    LocalDate dob;
    String ssn;
    String street;
    String city;
    String state;
    String zip;
}
```

That's two clumps in one entity — identity and address. The fix uses JPA's `@Embeddable`:

```java
@Embeddable
public record Address(String street, String city, String state, String zip) {}

@Entity
public class Customer {
    @Id long id;
    @Embedded PersonalIdentity identity;
    @Embedded Address address;
}
```

Same database columns, much better Java model. (JPA's records support has evolved across versions — Hibernate 6.2+ handles `@Embeddable record` directly; older stacks may need a plain class. The conceptual move is the same.)

---

## 7. What the fix is *not*

- **Not** a `Map<String, Object>`. That replaces an ordering bug with a typo bug.
- **Not** a bare two-element `Object[]`. You lose type safety and field names.
- **Not** a Lombok `@Data` mutable POJO if the clump is meant to be a value. Records or immutable classes win — the clump is supposed to be one concept, indivisible.
- **Not** a god-object that swallows every clump in sight. Each clump deserves its own small class.

---

## 8. Common mistakes when extracting

**Mistake 1: extracting only the parameters, not the methods that worked on them.**

```java
public record DateRange(LocalDate start, LocalDate end) {}

// But this stayed in a utility class:
public class DateRangeUtils {
    public static boolean overlaps(LocalDate s1, LocalDate e1, LocalDate s2, LocalDate e2) { ... }
}
```

You moved the data but not the behaviour. Move `overlaps`, `contains`, `days`, and friends *onto* `DateRange` — that's the point. (See [feature-envy](../03-feature-envy/) for the related smell.)

**Mistake 2: extracting too aggressively.**

```java
public record Pair<A, B>(A first, B second) {}   // generic, meaningless
```

A clump deserves a *named* class. `Pair` is a clump in disguise — the names tell callers nothing.

**Mistake 3: keeping the primitives around "for compatibility".**

```java
public class Customer {
    Address address;
    String street;   // duplicates address.street, drifts out of sync
}
```

Pick one representation. Synchronising two is worse than either alone.

---

## 9. Quick rules

- [ ] Same 3+ values in 3+ places means *extract a class or a record*.
- [ ] Name the concept — `Address`, `Money`, `DateRange`, `PersonalIdentity` — not `Pair` or `Tuple`.
- [ ] Move behaviour with the data (validation, comparison, formatting belong on the new type).
- [ ] Prefer records for value-style clumps; immutability removes a whole class of bugs.
- [ ] Don't leave the old primitives lying around alongside the new object.

---

## 10. What's next

| Topic                                                       | File              |
| ----------------------------------------------------------- | ----------------- |
| Detection patterns, full refactoring catalogue              | `middle.md`        |
| Records (JEP 395) as the modern cure, IDE tooling           | `senior.md`        |
| Value Objects in DDD, custom AST detection rules            | `professional.md`  |
| Metrics, thresholds, VO invariants                          | `specification.md` |
| 10 buggy clumps with diagnosis and fix                      | `find-bug.md`      |
| Record performance, escape analysis, scalar replacement     | `optimize.md`      |
| Hands-on extraction exercises                               | `tasks.md`         |
| Interview Q&A                                               | `interview.md`     |

Related smells: [primitive-obsession](../09-primitive-obsession/), [anemic-domain-model](../02-anemic-domain-model/), and the value-side of [immutability](../../05-immutability/) (when added) all sit next to this one.

---

**Memorize this:** *Three or more values, three or more places, one conceptual meaning* — that's a Data Clump. The cure is a one-line `record` with a real name. Move the behaviour with the data, not just the data.
