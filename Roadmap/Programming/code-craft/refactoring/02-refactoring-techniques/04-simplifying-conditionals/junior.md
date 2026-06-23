# Simplifying Conditional Expressions — Junior Level

> **Source:** [refactoring.guru/refactoring/techniques/simplifying-conditional-expressions](https://refactoring.guru/refactoring/techniques/simplifying-conditional-expressions)

---

## Table of Contents

1. [What this category is about](#what-this-category-is-about)
2. [Real-world analogy](#real-world-analogy)
3. [The 8 techniques at a glance](#the-8-techniques-at-a-glance)
4. [Decompose Conditional](#decompose-conditional)
5. [Consolidate Conditional Expression](#consolidate-conditional-expression)
6. [Consolidate Duplicate Conditional Fragments](#consolidate-duplicate-conditional-fragments)
7. [Remove Control Flag](#remove-control-flag)
8. [Replace Nested Conditional with Guard Clauses](#replace-nested-conditional-with-guard-clauses)
9. [Replace Conditional with Polymorphism](#replace-conditional-with-polymorphism)
10. [Introduce Null Object](#introduce-null-object)
11. [Introduce Assertion](#introduce-assertion)
12. [How they relate](#how-they-relate)
13. [Mini Glossary](#mini-glossary)
14. [Review questions](#review-questions)

---

## What this category is about

Conditionals are where bugs hide. The deeper the nesting, the harder the code is to read, test, and reason about.

This category provides 8 techniques to **tame conditionals**:

- Hide the noise behind named methods (Decompose Conditional).
- Combine sequential checks (Consolidate Conditional Expression).
- Hoist common code out of every branch (Consolidate Duplicate Conditional Fragments).
- Replace boolean-flag-driven loops with structured exits (Remove Control Flag).
- Replace deeply nested ifs with guard clauses (Replace Nested Conditional with Guard Clauses).
- Replace type-code-based dispatch with polymorphism (Replace Conditional with Polymorphism).
- Replace null-checks with a no-op object (Introduce Null Object).
- Make implicit assumptions explicit (Introduce Assertion).

The smells these cure:

- [Long Method](../../01-code-smells/01-bloaters/junior.md) — most long methods are 70% conditionals.
- [Switch Statements](../../01-code-smells/02-oo-abusers/junior.md) — replaced with polymorphism or null object.
- [Duplicate Code](../../01-code-smells/04-dispensables/junior.md) — pulled out of branches.

> **Key idea:** every `if` is a fork in the reader's understanding. Reduce forks; name the ones you keep.

---

## Real-world analogy

### A meeting agenda

A meeting can be framed two ways:

**Bad:**
> "If the team has shipped the feature and QA approved and the deploy didn't fail, we'll discuss next steps. Otherwise, if QA rejected, we'll triage. Otherwise, if deploy failed, we'll have a postmortem. Otherwise, we'll wait."

You've finished reading the agenda before knowing what's actually on it.

**Good:**
> "1. Status: ship/triage/postmortem/wait (depending on this morning's state).
> 2. Discuss the chosen item."

Same logic, but the structure is exposed and the irrelevant branches are out of sight.

That's the spirit: convert the conditional **logic** into named **structure**.

---

## The 8 techniques at a glance

| Technique | What it does |
|---|---|
| Decompose Conditional | Extract conditions and branches into named methods |
| Consolidate Conditional Expression | Combine `if`s with the same body |
| Consolidate Duplicate Conditional Fragments | Pull common code out of branches |
| Remove Control Flag | Replace boolean flags with `break`/`return` |
| Replace Nested Conditional with Guard Clauses | Early returns instead of `if-else` pyramids |
| Replace Conditional with Polymorphism | `switch (type)` → polymorphism |
| Introduce Null Object | No-op object instead of null checks |
| Introduce Assertion | Explicit run-time invariant checks |

---

## Decompose Conditional

### What it does

Take a conditional, extract its *test* into a named method, and extract each branch into a named method.

### Before

```java
if (date.before(SUMMER_START) || date.after(SUMMER_END)) {
    charge = quantity * winterRate + winterServiceCharge;
} else {
    charge = quantity * summerRate;
}
```

### After

```java
if (notSummer(date)) {
    charge = winterCharge(quantity);
} else {
    charge = summerCharge(quantity);
}

private boolean notSummer(Date date) {
    return date.before(SUMMER_START) || date.after(SUMMER_END);
}
private double winterCharge(int quantity) {
    return quantity * winterRate + winterServiceCharge;
}
private double summerCharge(int quantity) {
    return quantity * summerRate;
}
```

The structure is now obvious: "winter or summer; charge accordingly." The arithmetic is hidden behind names.

---

## Consolidate Conditional Expression

### What it does

Several `if`s in a row that all return the same value (or do the same thing) → one combined check.

### Before

```java
double disabilityAmount() {
    if (seniority < 2) return 0;
    if (monthsDisabled > 12) return 0;
    if (isPartTime) return 0;
    // compute amount
    return amount;
}
```

### After

```java
double disabilityAmount() {
    if (isNotEligibleForDisability()) return 0;
    return amount;
}
private boolean isNotEligibleForDisability() {
    return seniority < 2 || monthsDisabled > 12 || isPartTime;
}
```

### Caveat

Don't consolidate independent reasons. If you'd want to log *why* someone was rejected, the original three checks are clearer:

```java
if (seniority < 2) { logReject("low seniority"); return 0; }
if (monthsDisabled > 12) { logReject("too long disabled"); return 0; }
```

Consolidate only when the branches are interchangeable.

---

## Consolidate Duplicate Conditional Fragments

### What it does

Two branches that share the same trailing (or leading) code → pull out the duplicate.

### Before

```java
if (isSpecialDeal()) {
    total = price * 0.95;
    send();
} else {
    total = price * 0.98;
    send();
}
```

### After

```java
if (isSpecialDeal()) {
    total = price * 0.95;
} else {
    total = price * 0.98;
}
send();
```

Or more functionally:

```java
double rate = isSpecialDeal() ? 0.95 : 0.98;
total = price * rate;
send();
```

---

## Remove Control Flag

### What it does

A `boolean done = false;` flag inside a loop is replaced with `break`/`return`.

### Before

```java
boolean found = false;
for (Person p : people) {
    if (!found) {
        if (p.name().equals("Don")) {
            sendAlert();
            found = true;
        }
        if (p.name().equals("John")) {
            sendAlert();
            found = true;
        }
    }
}
```

### After

```java
for (Person p : people) {
    if (p.name().equals("Don") || p.name().equals("John")) {
        sendAlert();
        return;   // or break, depending on context
    }
}
```

### When NOT

Some teams forbid `break`/`return` mid-loop. In those teams, the control flag remains. Don't fight team conventions for one refactor.

---

## Replace Nested Conditional with Guard Clauses

### What it does

Deeply nested `if-else` pyramids are flattened with early returns.

### Before

```java
double getPayAmount() {
    double result;
    if (isDead) {
        result = deadAmount();
    } else {
        if (isSeparated) {
            result = separatedAmount();
        } else {
            if (isRetired) {
                result = retiredAmount();
            } else {
                result = normalPayAmount();
            }
        }
    }
    return result;
}
```

### After

```java
double getPayAmount() {
    if (isDead) return deadAmount();
    if (isSeparated) return separatedAmount();
    if (isRetired) return retiredAmount();
    return normalPayAmount();
}
```

### Why guard clauses help

- One indent level instead of four.
- Each precondition is on a single line, making the "what's the special case" reading trivial.
- The "main path" (the last line) is unambiguous.

### Difference from a normal early return

A guard clause specifically handles **edge cases / special cases**. The main path is the *normal* flow, and it should be the last (and least-indented) thing in the method. If you find yourself with 8 guard clauses and only one main line, the function is probably doing too much — consider Decompose Conditional.

---

## Replace Conditional with Polymorphism

### What it does

```java
switch (employee.type()) {
    case ENGINEER: return baseRate * 1.0;
    case MANAGER: return baseRate * 1.5 + bonus;
    case CONSULTANT: return baseRate * 0.8 + commission;
}
```

becomes

```java
abstract class Employee { abstract double rate(); }
class Engineer extends Employee { double rate() { return baseRate * 1.0; } }
class Manager extends Employee { double rate() { return baseRate * 1.5 + bonus; } }
class Consultant extends Employee { double rate() { return baseRate * 0.8 + commission; } }
```

### Why

- Adding a new type doesn't require finding all `switch`es.
- Each implementation is colocated with its data and behavior.
- Compile-time exhaustiveness (with sealed types or exhaustive `enum`).

### When NOT

- Few types, simple behaviors → enum with abstract methods may be enough:
  ```java
  enum EmployeeType {
      ENGINEER { public double rate() { return baseRate(); } },
      MANAGER  { public double rate() { return baseRate() * 1.5; } };
      public abstract double rate();
  }
  ```
- The dispatch is genuinely on a runtime value (status, mode) — use the State pattern instead.

> See [OO Abusers — Switch Statements](../../01-code-smells/02-oo-abusers/junior.md) for the full treatment.

---

## Introduce Null Object

### What it does

Replace `if (x != null) x.doIt();` with a "Null Object" — a real object whose methods are no-ops.

### Before

```java
Customer c = order.customer();
if (c == null) {
    System.out.println("guest");
} else {
    System.out.println(c.name());
    if (c.plan() == null) plan = "free";
    else plan = c.plan().name();
}
```

### After

```java
class NullCustomer extends Customer {
    @Override public String name() { return "guest"; }
    @Override public Plan plan() { return new FreePlan(); }
}

Customer c = order.customer();
System.out.println(c.name());
plan = c.plan().name();
```

### Why

- One uniform code path, no special-casing.
- New code can call `customer.name()` without risking NPE.

### When NOT

- The "null" case really is exceptional and you want it loud (use `Optional` or throw).
- The Null Object would have to fake too much to be useful (e.g., a Null `Order` with no items).
- Modern Java prefers `Optional<Customer>` for explicit absence.

> See [OO Abusers — Switch Statements](../../01-code-smells/02-oo-abusers/junior.md) for null-checking branches as a Switch smell.

---

## Introduce Assertion

### What it does

Make implicit assumptions explicit at runtime. If the assumption is wrong, fail fast and loud.

### Before

```java
double getExpenseLimit() {
    return (expenseLimit != NULL_EXPENSE) ? expenseLimit : primaryProject.memberExpenseLimit();
}
```

The reader has to wonder: what if `expenseLimit == NULL_EXPENSE` AND `primaryProject` is null?

### After

```java
double getExpenseLimit() {
    assert expenseLimit != NULL_EXPENSE || primaryProject != null;
    return (expenseLimit != NULL_EXPENSE) ? expenseLimit : primaryProject.memberExpenseLimit();
}
```

The contract is now visible.

### Caveat

- Java assertions are off by default. Use `Objects.requireNonNull(x)` or a dedicated runtime check (Guava `Preconditions.checkArgument`) for production-relevant assertions.
- Don't use assertions for **public input validation** — that should always be checked, with a meaningful error.
- Assertions are for **invariants the code believes are true**. Failing means the code (not the input) is wrong.

---

## How they relate

```
Long Method
    │
    ▼
Decompose Conditional ── Consolidate Conditional Expression
    │                      │
    ▼                      ▼
Replace Nested with    Consolidate Duplicate
Guard Clauses          Conditional Fragments
    │
    ▼
Switch Statements
    │
    ▼
Replace Conditional with Polymorphism
    │
    └── Introduce Null Object (for null-checking switches)

Subtle bugs
    │
    ▼
Introduce Assertion

Boolean-flag loops
    │
    ▼
Remove Control Flag
```

---

## Mini Glossary

- **Guard clause** — early return for an edge case so the main path is cleanly indented.
- **Null Object** — a real object whose methods are no-ops; replaces null checks.
- **Polymorphic dispatch** — looking up the right method based on the runtime type of an object.
- **Assertion** — a check that fails (with a clear message) when a code-internal invariant is violated.
- **Control flag** — a boolean variable used to signal "should I keep going?" in a loop.

---

## Review questions

1. What's the difference between Decompose Conditional and Consolidate Conditional Expression?
2. When would you NOT consolidate parallel ifs?
3. What's a Guard Clause? When does it help?
4. When would you NOT use Replace Conditional with Polymorphism?
5. When does Introduce Null Object hurt clarity?
6. What's the difference between Introduce Assertion and runtime validation?
7. How does Remove Control Flag relate to structured loops?
8. Which Code Smells does this category address?
9. Why might the simple `if (x != null)` form be better than a Null Object?
10. When would you use Optional<T> instead of a Null Object in modern Java?

---

## Next

- [middle.md](middle.md) — when to apply, language nuances.
- [senior.md](senior.md) — pattern matching, sealed types, exhaustive switches.
- [professional.md](professional.md) — branch prediction, JIT, dispatch costs.
- Practice: [tasks.md](tasks.md), [find-bug.md](find-bug.md), [optimize.md](optimize.md), [interview.md](interview.md).
