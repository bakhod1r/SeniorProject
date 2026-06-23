# Data Clumps — Middle

> **What?** At the middle level, Data Clumps stop being "a long parameter list" and start being a *detection-and-refactoring* skill. You learn to spot clumps in three signatures: parameter clumps, field clumps, and "passenger" clumps that ride together as DTO attributes across layers. You learn the catalogue of refactorings that dissolves them — *Introduce Parameter Object*, *Preserve Whole Object*, *Replace Method with Method Object*, *Extract Class* — and you learn to pick the right one.
> **How?** Grep the codebase for repeating parameter lists. Find clusters of fields that always appear together on multiple classes. For each cluster, decide whether it's a value (use a record), an entity slice (use a class with identity), or a behaviour (use a method object). Replace mechanically, layer by layer, with the IDE doing most of the work.

---

## 1. Detection — how to *find* clumps you didn't know you had

### 1.1 Grep for repeated parameter lists

The fastest mechanical hint is repeated parameter triples. A rough Unix one-liner can surface candidates in any Java project:

```bash
# Find method signatures and emit the parameter substring; sort | uniq -c | sort -nr
grep -RhoE 'String [a-zA-Z]+, String [a-zA-Z]+, String [a-zA-Z]+' src/main/java \
  | sort | uniq -c | sort -nr | head -20
```

A line like `42  String street, String city, String zip` means forty-two methods accept exactly that triple. Forty-two refactor targets, one missing `Address` class.

### 1.2 Look for parallel field names across classes

```bash
grep -RnE 'private .* (street|city|state|zip);' src/main/java | head
```

If `street/city/state/zip` appear together on `Customer`, `Order`, `Invoice`, `Supplier`, you have an entity-level clump. Each of those entities should hold one `Address` reference.

### 1.3 IDE inspections that find them for you

- **IntelliJ IDEA** ships *Three or more identical method parameters* and *Method with too many parameters* inspections (Preferences → Editor → Inspections → Java → Method metrics). Both surface clumps without grep.
- **SonarQube** has rule `S107` ("Methods should not have too many parameters", default threshold 7) and `S2293` for related smells.
- **PMD** offers `ExcessiveParameterList` and `LongParameterList`.

Tooling is a starting point; the *meaning* — does this trio name a real concept? — is yours to decide.

### 1.4 Smell-by-pain heuristics

If any of these are true in a slice of code, suspect a clump:

- Reviewers keep asking "what does parameter N do again?" on PRs.
- Tests need many lines of `final String firstName = "…"; final String lastName = "…"; …` setup.
- You added a new parameter to a method and a dozen unrelated callers broke.
- A bug was caused by an argument-order swap that the compiler accepted.

---

## 2. The refactoring catalogue, with worked examples

Fowler's *Refactoring* (2nd ed., chapter 6 and 9) catalogues several moves that all attack clumps from different angles. Pick the right one based on *where* the clump lives.

### 2.1 Introduce Parameter Object

Use when the clump lives in **method parameters**.

```java
// Before:
public Quote priceShipment(String street, String city, String state, String zip,
                           double weightKg, double lengthCm, double widthCm, double heightCm) { ... }

// After:
public record Address(String street, String city, String state, String zip) {}
public record Dimensions(double weightKg, double lengthCm, double widthCm, double heightCm) {}

public Quote priceShipment(Address dest, Dimensions box) { ... }
```

Two clumps lived inside one signature. Extract both. Note how the *count* of parameters dropped from 8 to 2 — a strong improvement against PMD/Sonar metrics and (more importantly) against human readability.

### 2.2 Preserve Whole Object

Use when a method receives several values that are all properties of a *single* object the caller already has.

```java
// Before — caller pulls the values apart:
double temp = weather.temperature();
double wind = weather.windSpeed();
double rain = weather.rainfall();
if (advisor.unsafe(temp, wind, rain)) { ... }

// After — pass the whole object:
if (advisor.unsafe(weather)) { ... }
```

Preserve Whole Object is the cheapest fix when the receiver class *already exists* — you just stop disassembling it at the call site. (Pair with care: don't pass `Weather` to a method that only uses `temperature()` — that creates **inappropriate intimacy** and a feature-envy backdoor. See [feature-envy](../03-feature-envy/) and [inappropriate-intimacy](../05-inappropriate-intimacy/).)

### 2.3 Replace Method with Method Object

Use when a single long method takes a clump *and* several local variables that depend on it. The method has overgrown its host.

```java
// Before — a 120-line method with 7 parameters and a dozen locals:
public class Order {
    public BigDecimal calculatePrice(BigDecimal base, BigDecimal taxRate, BigDecimal discountPct,
                                     List<Coupon> coupons, Currency currency, Locale locale, ...) {
        BigDecimal taxable = ...;
        BigDecimal afterDiscount = ...;
        // ... 100 more lines
    }
}

// After — pull into its own object whose fields are the old parameters/locals:
public class PriceCalculation {
    private final Order order;
    private final BigDecimal base, taxRate, discountPct;
    private final List<Coupon> coupons;
    private final Currency currency;
    private final Locale locale;

    public PriceCalculation(Order order, BigDecimal base, ...) { ... }

    public BigDecimal compute() {
        BigDecimal taxable = taxable();
        BigDecimal afterDiscount = applyDiscount(taxable);
        return roundTo(currency, afterDiscount);
    }

    private BigDecimal taxable() { ... }
    private BigDecimal applyDiscount(BigDecimal x) { ... }
    private BigDecimal roundTo(Currency c, BigDecimal x) { ... }
}
```

Now `compute` is short, each helper takes few parameters (they're fields), and the calculation can be tested in isolation. Method Object is the heavy-machinery variant of Parameter Object.

### 2.4 Extract Class

Use when the clump lives as **fields** on a class.

```java
// Before:
public class Customer {
    private String firstName, lastName;
    private LocalDate dob;
    private String ssn;
    private String street, city, state, zip;
    // ... 30 other fields
}

// After:
public record PersonalIdentity(String firstName, String lastName, LocalDate dob, String ssn) {}
public record Address(String street, String city, String state, String zip) {}

public class Customer {
    private PersonalIdentity identity;
    private Address address;
    // ... rest
}
```

Two new types absorb two clumps. The Customer class becomes a thin aggregate of named pieces.

---

## 3. Records as the modern default

Java 16's standardised `record` (JEP 395) is the smallest sufficient container for a clump:

```java
public record Money(BigDecimal amount, Currency currency) {
    public Money {
        Objects.requireNonNull(amount);
        Objects.requireNonNull(currency);
        if (amount.scale() > currency.getDefaultFractionDigits()) {
            throw new IllegalArgumentException("excess scale");
        }
    }

    public Money plus(Money other) {
        if (!currency.equals(other.currency)) {
            throw new IllegalArgumentException("currency mismatch");
        }
        return new Money(amount.add(other.amount), currency);
    }
}
```

You get for free:

- Immutability (final fields, no setters).
- `equals`/`hashCode` by component.
- A canonical `toString`.
- A compact constructor for validation.
- Pattern-matching support in `switch` and `instanceof`.

For 90% of clumps a record is the right answer. The 10% exception: clumps that require *identity* (two equal-valued objects must still be distinguishable) or *inheritance hierarchies* — those need full classes.

---

## 4. Where to put the new type

Three patterns work in practice:

- **Same package as the entity that owns it.** `com.acme.customer.Address` lives next to `Customer`. Fine when only one aggregate uses the type.
- **A shared `…domain.values` package.** `com.acme.domain.Money` lives once and is reused across order, invoice, payment, refund. Use this when the value is truly cross-cutting.
- **Nested in the aggregate that owns it.** `public class Customer { public record Identity(…) {} … }`. Useful when the value belongs *only* to that aggregate and you want strong namespacing.

Don't dump every value object into one giant `dto` package; that loses the modelling win.

---

## 5. Migrating an existing codebase

A pragmatic order:

1. **Spot the clump.** Use grep, IntelliJ inspections, or a code review eye.
2. **Sketch the new type.** Decide name, fields, validation.
3. **Add the type without removing the primitives.** New code uses it; old code still passes loose primitives. Compiles and tests still pass.
4. **Provide a bridge.** Static factory `Address.of(street, city, state, zip)` and an accessor `unpack()` returning the four primitives if needed.
5. **Migrate callers a layer at a time.** Web → service → repository. Each step is a small PR.
6. **Delete the primitives' overloads.** Once nothing uses them, the old signature goes.
7. **Move behaviour onto the new type.** Validation, formatting, comparison move from scattered utility methods to `Address`.

Don't try to do it in one giant PR — clumps live in many files, and a big-bang refactor stalls.

---

## 6. The "passenger clump" — DTOs across layers

A subtle clump moves through *DTOs* that don't talk to each other:

```java
class CustomerWebRequest { String firstName, lastName; LocalDate dob; String ssn; }
class CustomerServiceCmd  { String firstName, lastName; LocalDate dob; String ssn; }
class CustomerEntity       { String firstName, lastName; LocalDate dob; String ssn; }
class CustomerCsvRow      { String firstName, lastName; LocalDate dob; String ssn; }
```

Four classes, same quartet of fields, no shared type. Each layer separately validates "ssn must be 9 digits" because nothing is shared. The fix is *not* always "use the same class everywhere" (layers may have other distinct fields) — it's to extract `PersonalIdentity` and *compose* it into each DTO:

```java
record PersonalIdentity(String firstName, String lastName, LocalDate dob, String ssn) {}

record CustomerWebRequest(PersonalIdentity identity, String captcha) {}
record CustomerServiceCmd(PersonalIdentity identity, long createdBy) {}
@Embeddable record CustomerEntityIdentity(PersonalIdentity identity) {}      // JPA wrap
record CustomerCsvRow(PersonalIdentity identity, String sourceFile) {}
```

Each DTO still has its layer-specific extras, but the *shared concept* is shared.

---

## 7. When *not* to extract

- **The two values are coincidentally co-located.** A method takes `int retries, int backoffMs` — they sit together but don't form a domain concept worth a name. Threshold is *both* repetition *and* meaning.
- **The clump is genuinely two-valued and ephemeral.** A `(row, col)` pair used inside one method body doesn't need a `Coordinate` record.
- **Performance-critical numeric inner loops.** A `Vec3(double x, double y, double z)` record allocated millions of times in a tight loop may need scalar primitives until escape analysis is proven (see `optimize.md`).
- **An external API forces the primitive shape.** You can still wrap internally; the conversion is at the boundary.

Tasteful judgement, not mechanical rule.

---

## 8. Quick rules

- [ ] Three or more values, three or more places, real shared meaning → extract.
- [ ] Parameters clumps → *Introduce Parameter Object*. Field clumps → *Extract Class*. Long methods → *Method Object*.
- [ ] Records first, full classes only if you need identity or inheritance.
- [ ] Move the behaviour with the data — don't leave utility classes orphaned.
- [ ] Migrate in small steps with a bridging factory; never big-bang.
- [ ] DTOs across layers can compose the same value type rather than duplicate it.

---

## 9. What's next

- `senior.md` — records as more than syntax: design constraints, IntelliJ tooling, value objects, when to *not* use a record.
- `professional.md` — DDD value objects, custom AST detection, codebase-wide policy.
- `find-bug.md` — 10 concrete buggy clumps you can practice on.
- `optimize.md` — record runtime cost, scalar replacement, JIT behaviour.
- Related: [primitive-obsession](../09-primitive-obsession/) (often co-diagnosed), [anemic-domain-model](../02-anemic-domain-model/) (data clumps fuel anaemia), [feature-envy](../03-feature-envy/) (envious code is often a clump that didn't get extracted).

---

**Memorize this:** Detection precedes refactoring. Grep for repeating parameter lists, find parallel field clusters, then choose the right move — *Parameter Object* for arguments, *Extract Class* for fields, *Method Object* for runaway methods. Records are the default container. Migrate in small bridged steps, not big-bang.
