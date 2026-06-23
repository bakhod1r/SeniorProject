# Simplifying Conditionals — Find the Bug

> 12 refactors with hidden bugs.

---

## Bug 1 — Decompose Conditional changes operator precedence (Java)

**Original:**
```java
if (a && b || c) { doSomething(); }
```

**"Refactored":**
```java
if (allConditions(a, b, c)) { doSomething(); }
private boolean allConditions(boolean a, boolean b, boolean c) {
    return a && (b || c);   // ❌ moved parens
}
```

<details><summary>Bug</summary>

`a && b || c` parses as `(a && b) || c`. The "refactored" version has `a && (b || c)`. Different truth table.

**Fix:** Preserve precedence:
```java
private boolean allConditions(boolean a, boolean b, boolean c) {
    return (a && b) || c;
}
```

Lesson: when extracting a condition, verify the AST parse, not just the textual order.
</details>

---

## Bug 2 — Guard clause skipping cleanup (Java)

**Original:**
```java
public void process(File f) {
    InputStream in = openStream(f);
    if (validateHeader(in)) {
        readBody(in);
    } else {
        logBadHeader(in);
    }
    in.close();
}
```

**"Refactored":**
```java
public void process(File f) {
    InputStream in = openStream(f);
    if (!validateHeader(in)) {
        logBadHeader(in);
        return;   // ❌ leaks the stream
    }
    readBody(in);
    in.close();
}
```

<details><summary>Bug</summary>

The early return skips `in.close()`. Resource leak.

**Fix:** Use try-with-resources.

```java
public void process(File f) {
    try (InputStream in = openStream(f)) {
        if (!validateHeader(in)) {
            logBadHeader(in);
            return;
        }
        readBody(in);
    }
}
```

Lesson: guard clauses must respect cleanup. Use RAII / try-with-resources to make cleanup automatic.
</details>

---

## Bug 3 — Replace Conditional with Polymorphism violates LSP (Java)

**Original:**
```java
double rate(Employee e) {
    if (e.type() == ENGINEER) return 5000;
    if (e.type() == MANAGER) return 7000;
    return 3000;
}
```

**"Refactored":**
```java
abstract class Employee { abstract double rate(); }
class Engineer extends Employee { double rate() { return 5000; } }
class Manager extends Employee {
    double rate() { throw new RuntimeException("Managers don't have rate; use salary"); }
    double salary() { return 7000; }
}
```

<details><summary>Bug</summary>

`Manager.rate()` throws — breaking Liskov: callers expect `rate()` to return a number, not throw. Existing call sites that worked before now fail.

**Fix:** Either:
1. Implement `rate()` consistently for all subclasses.
2. Move `rate()` out of the base type if not all subclasses have one.
3. Use a sealed type and dispatch externally.

```java
sealed interface Employee permits Engineer, Manager {}
record Engineer(double rate) implements Employee {}
record Manager(double salary) implements Employee {}

double pay(Employee e) {
    return switch (e) {
        case Engineer eng -> eng.rate();
        case Manager m -> m.salary();
    };
}
```
</details>

---

## Bug 4 — Null Object hides necessary error (Java)

**Original:**
```java
Customer c = repo.findByEmail(email);
if (c == null) {
    log.warn("customer not found: " + email);
    auditFailedLookup(email);
}
return c;
```

**"Refactored":**
```java
public Customer findByEmail(String email) {
    Customer c = repo.findByEmail(email);
    return c != null ? c : new NullCustomer();
}
```

Caller now treats NullCustomer as a real Customer — the warn/audit is gone.

<details><summary>Bug</summary>

The Null Object eliminated necessary observability. Failed lookups now look like successful ones to the rest of the code.

**Fix:** Don't introduce Null Object when the absence has business meaning. Use Optional or keep the explicit null check with logging.
</details>

---

## Bug 5 — Consolidate Conditional Expression flattens different reasons (Python)

**Original:**
```python
def reject_reason(user, cart):
    if user.age < 18:
        return "underage"
    if cart.total < 10:
        return "min order"
    if not user.verified:
        return "unverified"
    return None
```

**"Refactored":**
```python
def reject_reason(user, cart):
    if not eligible(user, cart):
        return "rejected"   # ❌
    return None
def eligible(user, cart):
    return user.age >= 18 and cart.total >= 10 and user.verified
```

<details><summary>Bug</summary>

The original returned a *specific* reason. The "refactor" returns "rejected" with no detail. Customers / support / logs can no longer tell why.

**Fix:** Don't consolidate when the branch identity matters.
</details>

---

## Bug 6 — Replace Nested with Guard Clauses misses fall-through (Java)

**Original:**
```java
if (x > 0) {
    if (x < 100) {
        process(x);
    }
}
```

**"Refactored":**
```java
if (x <= 0) return;
if (x >= 100) return;
process(x);
```

Looks fine. But the original was nested:

**Real original:**
```java
if (x > 0) {
    if (x < 100) {
        process(x);
    } else {
        log("too big");
    }
}
```

**Bad refactor:**
```java
if (x <= 0) return;
if (x >= 100) return;   // ❌ swallows the "too big" log
process(x);
```

<details><summary>Bug</summary>

The else-branch was lost in flattening.

**Fix:**
```java
if (x <= 0) return;
if (x >= 100) { log("too big"); return; }
process(x);
```

Lesson: when flattening, examine *every* branch including else.
</details>

---

## Bug 7 — Remove Control Flag changes loop semantics (Java)

**Original:**
```java
boolean found = false;
String first = null;
for (String s : list) {
    if (!found && s.startsWith("Don")) {
        first = s;
        found = true;
    }
}
return first;
```

**"Refactored":**
```java
for (String s : list) {
    if (s.startsWith("Don")) return s;
}
return null;
```

But the original kept iterating after finding (maybe to count, log, etc.).

<details><summary>Bug</summary>

If the loop had side effects after `found = true` (e.g., counting, processing other elements), they're now skipped.

**Fix:** Check the original carefully. If the loop genuinely just needs the first match:

```java
return list.stream()
           .filter(s -> s.startsWith("Don"))
           .findFirst()
           .orElse(null);
```

If side effects matter, keep them inside the loop and return after.
</details>

---

## Bug 8 — Introduce Assertion in production code (Python)

**Original:**
```python
def transfer(amount, balance):
    if amount < 0: raise ValueError("amount must be positive")
    if amount > balance: raise ValueError("insufficient funds")
    return balance - amount
```

**"Refactored":**
```python
def transfer(amount, balance):
    assert amount >= 0, "amount must be positive"
    assert amount <= balance, "insufficient funds"
    return balance - amount
```

<details><summary>Bug</summary>

`python -O` strips `assert` statements. In production, the validation is gone — negative transfers and overdrafts go through.

**Fix:** Don't replace user-input validation with assertions. Assertions are for *internal invariants*; validation is for *boundary checks*.
</details>

---

## Bug 9 — Polymorphism breaks ORM mapping (Java)

**Original:**
```java
@Entity
class Employee {
    int type;
    double rate(double base) {
        return type == 0 ? base : base * 1.5;
    }
}
```

**"Refactored":**
```java
abstract class Employee { abstract double rate(double base); }
class Engineer extends Employee { ... }
class Manager extends Employee { ... }
```

<details><summary>Bug</summary>

JPA needs `@Inheritance(strategy=...)` to know how to persist the subclass hierarchy. Without it, the ORM throws or silently mishandles.

**Fix:**
```java
@Entity
@Inheritance(strategy = InheritanceType.SINGLE_TABLE)
@DiscriminatorColumn(name = "type")
abstract class Employee { ... }

@Entity @DiscriminatorValue("ENG")
class Engineer extends Employee { ... }
```

Lesson: ORM, JSON, and Replace Conditional with Polymorphism interact. Plan persistence shape.
</details>

---

## Bug 10 — Pattern matching missing variant (Java 21)

```java
sealed interface Shape permits Circle, Square, Triangle {}

double area(Shape s) {
    return switch (s) {
        case Circle c -> Math.PI * c.r() * c.r();
        case Square sq -> sq.side() * sq.side();
        // ❌ Triangle missing
    };
}
```

<details><summary>Bug</summary>

This won't compile — exhaustive switch fails. Java 21 catches this. Older Java relies on `default`.

If you used `default: throw` to silence the compiler:
```java
default -> throw new IllegalStateException();
```

You've defeated the safety. New variants slip into the default branch.

**Fix:** Don't use `default` for sealed types. Add the case:
```java
case Triangle t -> 0.5 * t.base() * t.height();
```
</details>

---

## Bug 11 — Decompose Conditional doesn't preserve short-circuit (Java)

**Original:**
```java
if (user != null && user.isActive()) {
    process(user);
}
```

**"Refactored":**
```java
if (canProcess(user)) {
    process(user);
}
private boolean canProcess(User user) {
    return user != null && user.isActive();
}
```

This is fine. But:

```java
private boolean canProcess(User user) {
    return user.isActive() && user != null;   // ❌
}
```

<details><summary>Bug</summary>

Reordered conjuncts. Now `user.isActive()` runs first — NPE on null user.

**Fix:** Preserve order. `user != null` must come first.
</details>

---

## Bug 12 — Null Object equality (Java)

```java
class NullCustomer extends Customer {
    public NullCustomer() { super("guest", "guest@example.com"); }
}

// Caller:
if (customer == NullCustomer.INSTANCE) ...   // ❌ if INSTANCE wasn't a singleton
```

<details><summary>Bug</summary>

Multiple `new NullCustomer()` instances aren't equal by reference. If callers occasionally check `customer == ...` they get unexpected results.

**Fix:** Make NullCustomer a singleton (single static INSTANCE), or override `equals` to be type-based.

```java
class NullCustomer extends Customer {
    public static final NullCustomer INSTANCE = new NullCustomer();
    private NullCustomer() { super(...); }
    @Override public boolean equals(Object o) { return o instanceof NullCustomer; }
}
```
</details>

---

## Patterns

| Bug | Root cause |
|---|---|
| Op precedence change | Refactor moved parens |
| Resource leak | Guard skipped cleanup |
| LSP violation | Subclass throws on base method |
| Lost observability | Null Object too greedy |
| Lost specific reason | Consolidate erased branch identity |
| Else dropped in flatten | Incomplete branch capture |
| Loop semantics changed | Removed flag, lost side effect |
| Assertion stripped | `-O` flag |
| ORM persistence | No discriminator |
| Default swallows new variant | Defeated exhaustive |
| Order changed | Lost short-circuit safety |
| Reference equality on null obj | Not singleton |

---

## Next

- [optimize.md](optimize.md) — perf
- [tasks.md](tasks.md) — practice
- [interview.md](interview.md) — review
