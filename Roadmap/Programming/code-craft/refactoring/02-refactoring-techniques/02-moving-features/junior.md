# Moving Features Between Objects — Junior Level

> **Source:** [refactoring.guru/refactoring/techniques/moving-features-between-objects](https://refactoring.guru/refactoring/techniques/moving-features-between-objects)

---

## Table of Contents

1. [What this category is about](#what-this-category-is-about)
2. [Real-world analogy](#real-world-analogy)
3. [The 8 techniques at a glance](#the-8-techniques-at-a-glance)
4. [Move Method](#move-method)
5. [Move Field](#move-field)
6. [Extract Class](#extract-class)
7. [Inline Class](#inline-class)
8. [Hide Delegate](#hide-delegate)
9. [Remove Middle Man](#remove-middle-man)
10. [Introduce Foreign Method](#introduce-foreign-method)
11. [Introduce Local Extension](#introduce-local-extension)
12. [How they relate](#how-they-relate)
13. [Mini Glossary](#mini-glossary)
14. [Review questions](#review-questions)

---

## What this category is about

**Moving Features Between Objects** answers a single question: *"This responsibility — does it live on the right class?"*

Where Composing Methods restructures the **inside** of a method, Moving Features restructures **placement**: which class owns which method, which field belongs where, when one class is doing the work of two, and when a chain of delegates should be flattened.

The smells these techniques cure are about **coupling and cohesion**:

- **Feature Envy** — a method uses another class's data more than its own → [Move Method](#move-method).
- **Inappropriate Intimacy** — two classes know each other's internals → [Move Method](#move-method) / [Move Field](#move-field) / [Hide Delegate](#hide-delegate).
- **Large Class** — a class has too many jobs → [Extract Class](#extract-class).
- **Lazy Class** — a class has nothing meaningful to do → [Inline Class](#inline-class).
- **Message Chains** — `a.getB().getC().doIt()` → [Hide Delegate](#hide-delegate).
- **Middle Man** — a class only forwards calls → [Remove Middle Man](#remove-middle-man).

> **Key idea:** placement matters as much as implementation. A correct method on the wrong class is technical debt.

---

## Real-world analogy

### A reorganization at a small company

You're at a 30-person startup. The marketing team handles its own invoicing. The sales team handles its own legal review. The CTO debugs production directly.

This worked when there were 5 people. At 30, things break:

- Marketing's invoicing is inconsistent because they're not accountants.
- Sales' legal review misses things a real lawyer would catch.
- The CTO is a bottleneck.

The CEO **moves features between teams**:
- Invoicing → Finance.
- Legal review → Legal.
- Production debugging → SRE.

Same total amount of work — better placement. Each team now does what it's best at.

That's exactly what Move Method, Move Field, and Extract Class do at the code level.

---

## The 8 techniques at a glance

| Technique | What it does | Inverse |
|---|---|---|
| **Move Method** | A method belongs on a different class | (Move Method back) |
| **Move Field** | A field belongs on a different class | (Move Field back) |
| **Extract Class** | One class doing two jobs → split | Inline Class |
| **Inline Class** | A class with no real job → fold into another | Extract Class |
| **Hide Delegate** | Replace `a.getB().doIt()` with `a.doIt()` | Remove Middle Man |
| **Remove Middle Man** | Class only forwards → expose the delegate | Hide Delegate |
| **Introduce Foreign Method** | Add a wrapper method when you can't modify the class | (delete the wrapper) |
| **Introduce Local Extension** | Subclass / wrapper holding many foreign methods | (back to wrappers) |

---

## Move Method

### What it does

A method on class A reads/calls more from class B than from A itself. The method belongs on B.

### Symptoms

- Method body has more `b.x`, `b.y`, `b.foo()` than `this.something`.
- Method takes a `B` as parameter and barely uses `this`.
- A change in B forces a change in this method.

### Before

```java
class Account {
    private AccountType type;
    private double daysOverdrawn;

    double overdraftCharge() {
        if (type.isPremium()) {
            double result = 10;
            if (daysOverdrawn > 7) result += (daysOverdrawn - 7) * 0.85;
            return result;
        }
        return daysOverdrawn * 1.75;
    }
}
```

The body asks `type.isPremium()` and applies a different formula based on it. The decision is really the `AccountType`'s.

### After

```java
class AccountType {
    private boolean isPremium;
    public boolean isPremium() { return isPremium; }

    double overdraftCharge(double daysOverdrawn) {
        if (isPremium) {
            double result = 10;
            if (daysOverdrawn > 7) result += (daysOverdrawn - 7) * 0.85;
            return result;
        }
        return daysOverdrawn * 1.75;
    }
}

class Account {
    private AccountType type;
    private double daysOverdrawn;

    double overdraftCharge() {
        return type.overdraftCharge(daysOverdrawn);
    }
}
```

### Mechanics (Fowler)

1. Examine all features used by the method in the source class. Consider moving them too.
2. Check sub- and super-classes for other declarations of the method.
3. Declare the method in the target class. Copy the body.
4. Adjust the method to its new home (rename references).
5. Decide how to reference the target object from the source.
6. Turn the source method into a delegating call (or remove it).
7. Test.

### When NOT to move

- The method is on an aggregate root that orchestrates several collaborators — moving fragments to each leaf scatters logic.
- The "envious" reads are coincidental (e.g., logging — every method touches the logger).
- The target class is a value object you don't want to grow behavior.

---

## Move Field

### What it does

A field that lives on class A is read or written more by class B. Move it.

### Before

```java
class Account {
    private double interestRate;     // ❌ but the formula is on AccountType
    private AccountType type;
    private double balance;

    double interestForAmount(double amount, int days) {
        return interestRate * amount * days / 365;
    }
}
```

If `interestRate` is determined by the `type`, it belongs on `AccountType`.

### After

```java
class AccountType {
    private double interestRate;
    public double interestRate() { return interestRate; }
}

class Account {
    private AccountType type;
    private double balance;

    double interestForAmount(double amount, int days) {
        return type.interestRate() * amount * days / 365;
    }
}
```

### When NOT to move

- The field genuinely instance-varies (each Account has its own custom rate). Then it stays.
- Moving creates a circular reference (A holds B, B's field needs to refer back to A).

---

## Extract Class

### What it does

One class is doing **two distinct jobs**. Split it: one becomes two classes; the original delegates the second job to the new one.

### Before

```java
class Person {
    private String name;
    private String officeAreaCode;
    private String officeNumber;

    public String name() { return name; }
    public String telephoneNumber() { return "(" + officeAreaCode + ") " + officeNumber; }
    public String getOfficeAreaCode() { return officeAreaCode; }
    public void setOfficeAreaCode(String code) { officeAreaCode = code; }
    public String getOfficeNumber() { return officeNumber; }
    public void setOfficeNumber(String n) { officeNumber = n; }
}
```

A `Person` is acting as both a person and a phone number. Two responsibilities.

### After

```java
class TelephoneNumber {
    private String areaCode;
    private String number;

    public String getAreaCode() { return areaCode; }
    public void setAreaCode(String c) { areaCode = c; }
    public String getNumber() { return number; }
    public void setNumber(String n) { number = n; }
    public String formatted() { return "(" + areaCode + ") " + number; }
}

class Person {
    private String name;
    private TelephoneNumber officePhone = new TelephoneNumber();

    public String name() { return name; }
    public String telephoneNumber() { return officePhone.formatted(); }
    public TelephoneNumber officePhone() { return officePhone; }
}
```

### Mechanics

1. Decide how to split the responsibilities.
2. Create a new class.
3. Make a link from the source to the new class (one field).
4. Use Move Field on each field that belongs on the new class.
5. Use Move Method on each method.
6. Review the source class — is its remaining surface coherent?
7. Decide whether to expose the new class publicly or keep it as an implementation detail.

### When to apply

- The class has a "phone number" subset of fields — they cluster.
- Some methods only touch field-cluster A; others only touch B.
- The class name is too vague to capture all its jobs (`OrderManager` doing 7 things).

### See also

[Large Class](../../01-code-smells/01-bloaters/junior.md), [Data Clumps](../../01-code-smells/01-bloaters/junior.md), [Divergent Change](../../01-code-smells/03-change-preventers/junior.md).

---

## Inline Class

### What it does

The reverse of Extract Class. A class isn't doing enough to justify its existence. Fold its responsibilities back into another class and delete it.

### Before

```java
class TelephoneNumber {
    private String number;
    public String getNumber() { return number; }
    public void setNumber(String n) { number = n; }
}

class Person {
    private TelephoneNumber phone = new TelephoneNumber();
    public String getNumber() { return phone.getNumber(); }
    public void setNumber(String n) { phone.setNumber(n); }
}
```

`TelephoneNumber` adds nothing — it just holds one string with getter/setter.

### After

```java
class Person {
    private String phoneNumber;
    public String getPhoneNumber() { return phoneNumber; }
    public void setPhoneNumber(String n) { phoneNumber = n; }
}
```

### When to apply

- A "value object" that doesn't carry meaning — just one primitive in a wrapper.
- A class whose every method delegates to a field (could indicate Middle Man).
- A class created speculatively that turned out to be unused.

### When NOT

- The class will likely grow (planned feature, polymorphism point).
- The class encapsulates an invariant (e.g., `Email` validates format on set — don't inline that into `Person.email`).

---

## Hide Delegate

### What it does

Hide an intermediate hop in a call chain.

### Before

```java
class Person {
    private Department department;
    public Department getDepartment() { return department; }
}

class Department {
    private Person manager;
    public Person getManager() { return manager; }
}

// Caller:
Person manager = john.getDepartment().getManager();
```

The caller knows about `Department`. If you remove or rename `Department`, every caller of `getDepartment().getManager()` must change.

### After

```java
class Person {
    private Department department;

    public Person manager() {
        return department.getManager();
    }
}

// Caller:
Person manager = john.manager();
```

### Why

- The caller doesn't know about `Department` — coupling reduced.
- Renaming or refactoring `Department` only affects `Person`.
- See [Demeter's Law](../../01-code-smells/05-couplers/junior.md): "talk to your direct neighbors, not friends of friends."

### Mechanics

1. For each method on the delegate that callers use, add a delegating method on the source class.
2. Update callers to use the source's new method.
3. If no callers reach the delegate directly anymore, hide the delegate (remove `getDepartment` if possible).

### Trade-off

If you hide *every* delegate method, you'll grow `Person`'s API. There's a balance — see [Remove Middle Man](#remove-middle-man) for the opposite swing.

---

## Remove Middle Man

### What it does

The opposite of Hide Delegate. A class has so many delegating methods that it's adding no value — expose the delegate directly.

### Before

```java
class Person {
    private Department department;

    public Person manager() { return department.getManager(); }
    public String departmentName() { return department.getName(); }
    public int departmentSize() { return department.getSize(); }
    public List<Project> departmentProjects() { return department.getProjects(); }
    // ... 15 more delegating methods ...
}
```

### After

```java
class Person {
    private Department department;
    public Department department() { return department; }
}

// Caller:
john.department().manager();
john.department().getName();
```

### When to swing this way

- The delegate has 5+ methods that callers want — and the wrapper class is just forwarding.
- The wrapper isn't preserving any invariant or hiding anything meaningful.

### See also

[Middle Man smell](../../01-code-smells/05-couplers/junior.md).

---

## Introduce Foreign Method

### What it does

You need a method on a class you can't modify (third-party library, JDK class). Write a "foreign" method elsewhere — typically in your own utility class — that takes the foreign type as a parameter.

### Before

```java
Date newStart = new Date(previousEnd.getYear(), previousEnd.getMonth(), previousEnd.getDate() + 1);
```

### After

```java
class DateUtils {
    static Date nextDay(Date date) {
        return new Date(date.getYear(), date.getMonth(), date.getDate() + 1);
    }
}

// Caller:
Date newStart = DateUtils.nextDay(previousEnd);
```

### Notes

- Mark the foreign method clearly (Fowler's tip: add a comment `// foreign method: Date`).
- This is a stop-gap. If you accumulate many foreign methods on the same type, see Introduce Local Extension.

---

## Introduce Local Extension

### What it does

Many foreign methods on the same type? Promote them into a single class — either a subclass or a wrapper — that you can grow.

### Subclass form (when the foreign type is non-final)

```java
class MfDate extends Date {
    public MfDate(Date d) { super(d.getTime()); }
    public Date nextDay() { return new MfDate(new Date(getTime() + 86_400_000L)); }
    public Date previousDay() { return new MfDate(new Date(getTime() - 86_400_000L)); }
    public boolean isBetween(Date a, Date b) { return after(a) && before(b); }
}
```

### Wrapper form (when the foreign type is final or you prefer composition)

```java
class MfDate {
    private final Date original;
    public MfDate(Date d) { this.original = d; }
    public Date nextDay() { return new Date(original.getTime() + 86_400_000L); }
    public Date asDate() { return original; }
    // ... more methods ...
}
```

### Modern alternative

Java 8+ has `LocalDate`, `LocalDateTime`, `Instant` — modernizing the type often beats wrapping the legacy `Date`. Use Local Extension when you can't move off the legacy type yet.

In Kotlin / C# / Swift, **extension functions** make this nearly free:

```kotlin
fun Date.nextDay(): Date = Date(time + 86_400_000)
```

In Python, you'd use a free function or subclass:

```python
def next_day(d): return d + timedelta(days=1)
```

In Go, you must use a wrapper or function on a named type:

```go
type MfDate time.Time
func (d MfDate) NextDay() MfDate { return MfDate(time.Time(d).AddDate(0, 0, 1)) }
```

---

## How they relate

```
                           Large Class
                               │
                               ▼
                          Extract Class
                               │
                  ┌────────────┴───────────┐
                  ▼                        ▼
              Move Field               Move Method
                  ▼                        │
            new class grows  ◄─────────────┘
                  │
                  ▼
         Lazy Class? (no work)
                  │
                  ▼
              Inline Class

Message Chains (a.getB().doIt())
                  │
                  ▼
            Hide Delegate
                  │
                  ▼
       too many delegated methods?
                  │
                  ▼
          Remove Middle Man
```

The pairs **(Hide Delegate ↔ Remove Middle Man)** and **(Extract Class ↔ Inline Class)** swing in opposite directions. You choose based on the current state and the direction you want.

---

## Mini Glossary

- **Delegate** — an object held by another (`Person.department`) that handles part of the holder's work.
- **Middle Man** — a class whose methods only forward to a delegate.
- **Foreign method** — a method written outside the class it logically extends, because you can't modify the original class.
- **Local extension** — a subclass or wrapper holding multiple foreign methods.
- **Aggregate root** (DDD) — the entry point to a cluster of related objects; outsiders talk only to the root.

---

## Review questions

1. What's the difference between Move Method and Extract Method?
2. When does Feature Envy demand Move Method?
3. What's the relationship between Extract Class and the Single Responsibility Principle?
4. When is Inline Class the right move?
5. What does Hide Delegate do, and which smell does it cure?
6. When should you Remove Middle Man instead of Hide Delegate?
7. What's a "foreign method"?
8. When would you use Introduce Local Extension over a single foreign method?
9. How does Kotlin's extension function relate to Foreign Method / Local Extension?
10. What's the trade-off between exposing a delegate vs. forwarding every method?

---

## Next

- [middle.md](middle.md) — real-world triggers, trade-offs.
- [senior.md](senior.md) — at architecture scale.
- [professional.md](professional.md) — runtime cost.
- Practice: [tasks.md](tasks.md), [find-bug.md](find-bug.md), [optimize.md](optimize.md), [interview.md](interview.md).
