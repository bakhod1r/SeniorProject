# Simplifying Method Calls — Junior Level

> **Source:** [refactoring.guru/refactoring/techniques/simplifying-method-calls](https://refactoring.guru/refactoring/techniques/simplifying-method-calls)

---

## Table of Contents

1. [What this category is about](#what-this-category-is-about)
2. [Real-world analogy](#real-world-analogy)
3. [The 14 techniques at a glance](#the-14-techniques-at-a-glance)
4. [Rename Method](#rename-method)
5. [Add Parameter](#add-parameter)
6. [Remove Parameter](#remove-parameter)
7. [Separate Query from Modifier](#separate-query-from-modifier)
8. [Parameterize Method](#parameterize-method)
9. [Replace Parameter with Explicit Methods](#replace-parameter-with-explicit-methods)
10. [Preserve Whole Object](#preserve-whole-object)
11. [Replace Parameter with Method Call](#replace-parameter-with-method-call)
12. [Introduce Parameter Object](#introduce-parameter-object)
13. [Remove Setting Method](#remove-setting-method)
14. [Hide Method](#hide-method)
15. [Replace Constructor with Factory Method](#replace-constructor-with-factory-method)
16. [Encapsulate Downcast](#encapsulate-downcast)
17. [Replace Error Code with Exception / Replace Exception with Test](#replace-error-code-with-exception-replace-exception-with-test)
18. [Mini Glossary](#mini-glossary)
19. [Review questions](#review-questions)

---

## What this category is about

**Simplifying Method Calls** is about cleaning up method **interfaces** — names, parameter lists, return shapes, error reporting. Where Composing Methods restructures the *inside* and Moving Features changes *placement*, this category fixes how methods are *exposed*.

The smells these cure:

- [Long Parameter List](../../01-code-smells/01-bloaters/junior.md) — Introduce Parameter Object, Preserve Whole Object, Replace Parameter with Method Call.
- [Comments](../../01-code-smells/04-dispensables/junior.md) — Rename Method.
- [Inappropriate Intimacy](../../01-code-smells/05-couplers/junior.md) — Hide Method, Remove Setting Method.
- [Switch Statements](../../01-code-smells/02-oo-abusers/junior.md) — Replace Constructor with Factory Method.
- [Speculative Generality](../../01-code-smells/04-dispensables/junior.md) — Remove Parameter.
- [Duplicate Code](../../01-code-smells/04-dispensables/junior.md) — Parameterize Method.

> **Key idea:** the method's **signature** is its public face. Bad names, too many parameters, or hidden side effects make the API hostile. These refactorings make APIs honest and ergonomic.

---

## Real-world analogy

### Bad form labels

A government form asks:
- "Field 1: Number"
- "Field 2: Date (numeric)"
- "Field 3: Region (1-50)"
- "Field 4: Subject"
- "Field 5: Other Notes"

Nothing has a meaningful name. A user trying to fill it out has to read the instructions repeatedly to remember which field is what.

Same form with names:
- "Phone number"
- "Date of birth"
- "Country code"
- "Reason for application"
- "Additional notes"

Same data, drastically more usable.

That's exactly what Rename Method, Introduce Parameter Object, and Replace Parameter with Explicit Methods do at the code level.

---

## The 14 techniques at a glance

| Technique | What it does |
|---|---|
| Rename Method | Better name |
| Add Parameter | Method needs more info |
| Remove Parameter | Parameter no longer needed |
| Separate Query from Modifier | A method that returns a value should not have side effects |
| Parameterize Method | Several similar methods → one parameterized |
| Replace Parameter with Explicit Methods | Opposite: parameter triggers different paths → split |
| Preserve Whole Object | Pass the object instead of its fields |
| Replace Parameter with Method Call | Caller has access; let callee compute |
| Introduce Parameter Object | Group parameters into an object |
| Remove Setting Method | Field shouldn't change after construction |
| Hide Method | Make method private/protected |
| Replace Constructor with Factory Method | Need named construction or polymorphic creation |
| Encapsulate Downcast | Push downcast inside the method that returns the value |
| Replace Error Code with Exception / Replace Exception with Test | Pick the right error-reporting style |

---

## Rename Method

### What it does

Give a method a better name. Sounds trivial — and is the most-used refactoring in any IDE.

### Before

```java
class Order {
    public Money getCharge() { ... }   // does it compute? read? include tax?
}
```

### After

```java
class Order {
    public Money totalIncludingTax() { ... }
}
```

### Why

- The name is the documentation.
- A bad name forces every caller to read the body.
- IDE renames are safe — every caller updates atomically.

### Mechanics (Fowler)

1. Check if the method is in a superclass — rename in the whole hierarchy.
2. Declare a new method with the new name. Copy body. Old method delegates to new.
3. Update every caller (most IDEs do this automatically).
4. Remove the old method.

### Anti-pattern

Renaming the same method 4 times in a quarter as opinions shift. Pick a name with the team; commit; move on.

---

## Add Parameter

### What it does

A method needs more information from the caller.

### Before

```java
public Discount applyDiscount(Customer c) {
    if (c.isLoyal()) return Discount.of(0.10);
    return Discount.NONE;
}
```

### After

```java
public Discount applyDiscount(Customer c, Promotion p) {
    if (c.isLoyal()) return Discount.of(0.10);
    if (p != null && p.isActive()) return p.discount();
    return Discount.NONE;
}
```

### Cautions

- Update all callers (IDE will surface them).
- For public APIs, this is breaking — overload (keep old, add new with extra param) until consumers migrate.

### When to consider alternatives

If you're adding a 5th parameter, consider **Introduce Parameter Object** instead.

---

## Remove Parameter

### What it does

A parameter that's no longer needed adds noise. Remove it.

### Before

```java
public Money price(Order o, boolean unused) { ... }   // legacy
```

### After

```java
public Money price(Order o) { ... }
```

### Cautions

- Don't remove if some code paths still use it (look at every caller's argument).
- For public APIs, consider deprecating before removing.

### When does this happen

- A feature was reverted but the parameter remained.
- A parameter was added speculatively ("might need it later") and never used.

---

## Separate Query from Modifier

### What it does

A method that **returns a value AND has side effects** is hard to use safely. Split it.

### Before

```java
String getTotalOutstandingAndSetReadyForSummary() {
    double total = computeTotal();
    readyForSummary = true;   // side effect
    return total;
}
```

### After

```java
String getTotalOutstanding() { return computeTotal(); }
void setReadyForSummary() { readyForSummary = true; }
```

### Why

- Callers that want the total but not the side effect can call only the query.
- Test cases for each are independent.
- Idempotency: calling the query twice gives the same answer; the modifier is explicit.

### When NOT

- The side effect is intrinsic (e.g., `next()` on an iterator — returns and advances). That's domain.
- The side effect is logging/auditing — usually fine inside a query.

---

## Parameterize Method

### What it does

Several methods that differ only in a value → one method with a parameter.

### Before

```java
double tenPercentRaise() { return salary * 1.10; }
double fivePercentRaise() { return salary * 1.05; }
double fifteenPercentRaise() { return salary * 1.15; }
```

### After

```java
double raise(double percentage) { return salary * (1 + percentage); }
```

### When NOT

- The variants are conceptually different things, not values of the same operation. (`saveAsPdf()` vs. `saveAsHtml()` aren't really "save with format").

---

## Replace Parameter with Explicit Methods

### What it does

The opposite. A parameter that triggers entirely different code paths is hiding two methods.

### Before

```java
public Result process(Order o, boolean express) {
    if (express) return expressFlow(o);
    return standardFlow(o);
}
```

### After

```java
public Result processExpress(Order o) { return expressFlow(o); }
public Result processStandard(Order o) { return standardFlow(o); }
```

### When

- The boolean parameter selects entirely different behavior.
- Callers always know statically which they want.

### When NOT

- The parameter is genuinely runtime-determined.
- Callers select dynamically based on data.

> See [OO Abusers — Switch Statements](../../01-code-smells/02-oo-abusers/junior.md) on the "boolean parameter trap."

---

## Preserve Whole Object

### What it does

```java
double low = daysTempRange.getLow();
double high = daysTempRange.getHigh();
boolean withinPlan = plan.withinRange(low, high);
```

→

```java
boolean withinPlan = plan.withinRange(daysTempRange);
```

### Why

- Caller doesn't have to know `getLow()` / `getHigh()`.
- If TempRange grows a `mean` field that the plan also wants to use, no parameter list change needed.

### When NOT

- The callee doesn't need the whole object — passing it overspecifies the dependency.
- Test setup becomes harder (you need to construct a full TempRange).

> Trade-off: Preserve Whole Object reduces coupling at the call site; increases coupling at the callee. Pick based on direction of growth.

---

## Replace Parameter with Method Call

### What it does

The caller passes a value the callee can compute itself. Let the callee compute it.

### Before

```java
double basePrice = quantity * itemPrice;
double discount = discountFor(basePrice, customerType());
double total = basePrice - discount;
```

### After

```java
private double basePrice() { return quantity * itemPrice; }

double discount = discountFor(customerType());

private double discountFor(CustomerType type) {
    if (basePrice() > 1000) return basePrice() * 0.10;
    ...
}
```

### When

- Both methods are on the same class.
- The parameter is derivable from existing state.

### Caution

If the callee calls the query multiple times, watch perf (see [Replace Temp with Query in Composing Methods](../01-composing-methods/junior.md)).

---

## Introduce Parameter Object

### What it does

A parameter list of 4+ items, especially when the same group recurs, becomes one object.

### Before

```java
public boolean overlaps(Date startA, Date endA, Date startB, Date endB) { ... }
```

### After

```java
record DateRange(Date start, Date end) {}
public boolean overlaps(DateRange a, DateRange b) { ... }
```

### Why

- The signature is shorter and more readable.
- The `DateRange` type can grow methods (`overlaps`, `contains`, `daysBetween`).
- Type safety: can't pass `(end, start)` by mistake.

### When NOT

- The "parameters" don't naturally cluster (passing `name`, `total`, `currency`, `customerId` may not be one concept).
- The cluster only shows up once.

> Java records (Java 14+) make this nearly free.

---

## Remove Setting Method

### What it does

If a field shouldn't change after construction, remove its setter.

### Before

```java
class Customer {
    private String id;
    public Customer(String id) { this.id = id; }
    public void setId(String id) { this.id = id; }   // ❌
}
```

### After

```java
class Customer {
    private final String id;
    public Customer(String id) { this.id = id; }
}
```

### Why

- An entity's id shouldn't change. The setter was a footgun.
- Immutability simplifies reasoning; thread safety becomes natural.

### When

- Identifiers (id, email-as-key, social security number).
- Domain invariants (an Order's customer can't change after submission).

---

## Hide Method

### What it does

A method that's used only internally is made `private` (or `package-private`).

### Why

- Reduced API surface = less coupling.
- Future refactorings don't break external callers.
- Callers can't depend on what they can't see.

### Mechanics

1. Find every caller.
2. If all callers are within the class → private.
3. If callers are in the same package → package-private.
4. Otherwise: don't hide; the method is genuinely public.

---

## Replace Constructor with Factory Method

### What it does

```java
new Employee(ENGINEER);
```

becomes

```java
Employee.createEngineer();
```

### Why

- Factory methods have **names**.
- They can return subclasses or cached instances.
- They can validate or transform inputs.

### Before

```java
class Employee {
    public Employee(int type) {
        this.type = type;
    }
}
```

### After

```java
abstract class Employee {
    public static Employee createEngineer() { return new Engineer(); }
    public static Employee createManager() { return new Manager(); }
}
class Engineer extends Employee {}
class Manager extends Employee {}
```

### Modern alternatives

- `static of(...)` is the idiomatic Java naming.
- Java records often use named static factories.
- Kotlin: `companion object { fun create() = ... }`.
- Python: `@classmethod`.

### When NOT

- The class is a value object with one obvious constructor.
- Adding factory methods scatters construction logic without adding clarity.

> See Creational Patterns.

---

## Encapsulate Downcast

### What it does

A method returns a wide type, callers downcast.

### Before

```java
public Object lastReading() { return readings.last(); }

// Caller:
Reading r = (Reading) station.lastReading();
```

### After

```java
public Reading lastReading() { return (Reading) readings.last(); }

// Caller:
Reading r = station.lastReading();
```

### Why

- One downcast in one place instead of N.
- The downcast can be replaced by generics later.

### Modern alternative

Use generics:

```java
List<Reading> readings;
public Reading lastReading() { return readings.get(readings.size() - 1); }
```

No downcast needed.

---

## Replace Error Code with Exception / Replace Exception with Test

### Replace Error Code with Exception

```java
int withdraw(double amount) {
    if (amount > balance) return -1;   // ❌ error code
    balance -= amount;
    return 0;
}
```

becomes

```java
void withdraw(double amount) {
    if (amount > balance) throw new InsufficientFundsException();
    balance -= amount;
}
```

### Replace Exception with Test

The opposite. If the "error" is *expected* and easy to check, don't throw — let the caller check.

```java
double getValueForPeriod(int periodNumber) {
    try { return values[periodNumber]; }
    catch (ArrayIndexOutOfBoundsException e) { return 0; }
}
```

becomes

```java
double getValueForPeriod(int periodNumber) {
    if (periodNumber >= values.length) return 0;
    return values[periodNumber];
}
```

### Picking between

| Approach | When |
|---|---|
| Exception | The error is rare AND can't easily be detected by the caller |
| Test (return value or check) | The error is expected, frequent, or cheap to check |

Exceptions are for *exceptional* conditions. Don't use them as glorified gotos.

> Modern Go: errors as values (always returned). Modern Rust: `Result<T, E>`. Both encourage explicit checking over throwing.

---

## Mini Glossary

- **Query method** — returns a value, no side effects (pure).
- **Modifier** — changes state, possibly returns void.
- **Factory method** — static method that constructs an instance, possibly polymorphic.
- **Parameter Object** — a value type bundling related parameters.
- **Whole Object** — the entire object reference, vs. some of its fields.
- **Downcast** — `(Subtype) reference` — a runtime type assertion.

---

## Review questions

1. Why is Rename Method the most-used refactoring?
2. When should Add Parameter become Introduce Parameter Object?
3. What's the difference between Parameterize Method and Replace Parameter with Explicit Methods?
4. When does Preserve Whole Object hurt?
5. Why is Separate Query from Modifier important?
6. When is Replace Constructor with Factory Method right?
7. What does Encapsulate Downcast achieve?
8. When should errors be exceptions vs. return values?
9. What's the boolean parameter trap?
10. Why is Hide Method a good default discipline?

---

## Next

- [middle.md](middle.md) — when, trade-offs, language nuances.
- [senior.md](senior.md) — API evolution, library design, deprecation.
- [professional.md](professional.md) — JIT, dispatch, allocation.
- Practice: [tasks.md](tasks.md), [find-bug.md](find-bug.md), [optimize.md](optimize.md), [interview.md](interview.md).
