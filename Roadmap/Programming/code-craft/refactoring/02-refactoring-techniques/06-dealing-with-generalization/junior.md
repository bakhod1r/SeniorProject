# Dealing with Generalization — Junior Level

> **Source:** [refactoring.guru/refactoring/techniques/dealing-with-generalization](https://refactoring.guru/refactoring/techniques/dealing-with-generalization)

---

## Table of Contents

1. [What this category is about](#what-this-category-is-about)
2. [Real-world analogy](#real-world-analogy)
3. [The 12 techniques at a glance](#the-12-techniques-at-a-glance)
4. [Pull Up Field](#pull-up-field)
5. [Pull Up Method](#pull-up-method)
6. [Pull Up Constructor Body](#pull-up-constructor-body)
7. [Push Down Method](#push-down-method)
8. [Push Down Field](#push-down-field)
9. [Extract Subclass](#extract-subclass)
10. [Extract Superclass](#extract-superclass)
11. [Extract Interface](#extract-interface)
12. [Collapse Hierarchy](#collapse-hierarchy)
13. [Form Template Method](#form-template-method)
14. [Replace Inheritance with Delegation](#replace-inheritance-with-delegation)
15. [Replace Delegation with Inheritance](#replace-delegation-with-inheritance)
16. [How they relate](#how-they-relate)
17. [Mini Glossary](#mini-glossary)
18. [Note on Go](#note-on-go)
19. [Review questions](#review-questions)

---

## What this category is about

**Dealing with Generalization** is the family of refactorings that move features through an inheritance hierarchy:

- **Pull up** common fields/methods from sibling classes to a shared parent.
- **Push down** features that only one subclass uses.
- **Extract** new layers (superclass / subclass / interface) to capture commonality or specialization.
- **Collapse** layers that turned out to be unnecessary.
- **Convert** between inheritance and delegation when the relationship was wrong.

The smells these cure:

- [Duplicate Code](../../01-code-smells/04-dispensables/junior.md) — Pull Up Method, Pull Up Field, Form Template Method.
- [Refused Bequest](../../01-code-smells/02-oo-abusers/junior.md) — Push Down Method/Field, Replace Inheritance with Delegation.
- [Lazy Class](../../01-code-smells/04-dispensables/junior.md) — Collapse Hierarchy, Replace Subclass with Fields.
- [Alternative Classes with Different Interfaces](../../01-code-smells/02-oo-abusers/junior.md) — Extract Superclass, Extract Interface.
- [Middle Man](../../01-code-smells/05-couplers/junior.md) — Replace Delegation with Inheritance.

> **Key idea:** inheritance is a strong claim ("X is a Y"). When the claim turns out to be wrong, this category gives you the tools to fix it.

---

## Real-world analogy

### The reorganization at the publishing house

A publishing house has separate departments for fiction and non-fiction. Each does:
- Manuscript receipt.
- Editing.
- Cover design.
- Marketing.

Each department reinvented procedures for receipt and editing, but they're functionally identical.

**Pull up:** the CEO creates a "Common Operations" department handling receipt and editing for both. Specialized work (cover design, marketing) stays per-fiction-vs-non-fiction.

**Push down:** later, "marketing" turns out to need fiction-specific events (book signings) but not non-fiction-specific events (academic conferences). The marketing function splits — push down per-type.

**Extract superclass:** if a third type (poetry) is added, and it shares operations with both fiction and non-fiction, a higher-level "Books Operations" emerges.

**Replace inheritance with delegation:** if "Children's Books" was forced to inherit from "Fiction" but doesn't really fit (it has different age-rating workflows, no romance subplots), Children's Books becomes its own department that *delegates* to Fiction for shared operations.

These exact moves apply to OO code.

---

## The 12 techniques at a glance

| Technique | What it does |
|---|---|
| Pull Up Field | Common field on multiple subclasses → superclass |
| Pull Up Method | Common method on multiple subclasses → superclass |
| Pull Up Constructor Body | Common constructor work → superclass constructor |
| Push Down Method | Method only used by one subclass → push down |
| Push Down Field | Field only used by some subclasses → push down |
| Extract Subclass | Features used only sometimes → subclass for that case |
| Extract Superclass | Two classes share features → common superclass |
| Extract Interface | Same operations used together → interface |
| Collapse Hierarchy | Superclass and subclass not different enough → merge |
| Form Template Method | Two methods do similar work in different ways → Template Method |
| Replace Inheritance with Delegation | Subclass uses only part of superclass → composition |
| Replace Delegation with Inheritance | Pure pass-through delegation → inheritance |

---

## Pull Up Field

### What it does

A field appears in multiple subclasses with the same meaning → move it to the superclass.

### Before

```java
abstract class Employee { ... }
class Salesman extends Employee { protected String name; }
class Engineer extends Employee { protected String name; }
```

### After

```java
abstract class Employee { protected String name; }
class Salesman extends Employee {}
class Engineer extends Employee {}
```

### Mechanics

1. Confirm the fields are identical (same type, same meaning, same initialization).
2. Declare the field in the superclass.
3. Remove from each subclass.
4. Test.

---

## Pull Up Method

### What it does

A method appears in multiple subclasses doing the same thing → move it to the superclass.

### Before

```java
class Salesman extends Employee {
    public String name() { return "Salesman: " + this.name; }
}
class Engineer extends Employee {
    public String name() { return "Salesman: " + this.name; }   // identical
}
```

### After

```java
abstract class Employee {
    protected String name;
    public String name() { return getClass().getSimpleName() + ": " + name; }
}
```

### When NOT

- The methods *look* the same but mean different things in each subclass.
- The methods rely on subclass-specific helpers — pull those up first.

---

## Pull Up Constructor Body

### What it does

Subclass constructors that do the same setup work → push the work to a superclass constructor.

### Before

```java
class Manager extends Employee {
    public Manager(String name, String id, int grade) {
        this.name = name;
        this.id = id;
        this.grade = grade;
    }
}
class Engineer extends Employee {
    public Engineer(String name, String id, int level) {
        this.name = name;
        this.id = id;
        this.level = level;
    }
}
```

### After

```java
abstract class Employee {
    public Employee(String name, String id) {
        this.name = name;
        this.id = id;
    }
}
class Manager extends Employee {
    private int grade;
    public Manager(String name, String id, int grade) {
        super(name, id);
        this.grade = grade;
    }
}
class Engineer extends Employee {
    private int level;
    public Engineer(String name, String id, int level) {
        super(name, id);
        this.level = level;
    }
}
```

---

## Push Down Method

### What it does

A method that only one subclass uses → move it to that subclass.

### Before

```java
abstract class Employee {
    public double quota() { ... }   // only Salesman uses this
}
```

### After

```java
abstract class Employee {}
class Salesman extends Employee {
    public double quota() { ... }
}
```

### When

- A method on the parent is overridden as a no-op (or throws) in some subclasses → that's [Refused Bequest](../../01-code-smells/02-oo-abusers/junior.md). Push it down.
- The set of subclasses that use the method is a small minority.

---

## Push Down Field

### What it does

A field used by only some subclasses → move it down.

### Before

```java
abstract class Employee {
    protected double quota;   // only Salesman uses
}
```

### After

```java
abstract class Employee {}
class Salesman extends Employee { protected double quota; }
```

---

## Extract Subclass

### What it does

A class has features that are used only in some scenarios → split into a subclass for that case.

### Before

```java
class Job {
    private String name;
    private double unitPrice;
    private int employeeId;       // only used for "internal" jobs
    private boolean isInternal;

    public double cost() {
        return isInternal ? employeeRate(employeeId) : unitPrice;
    }
}
```

### After

```java
abstract class Job {
    protected String name;
    public abstract double cost();
}
class ExternalJob extends Job {
    private double unitPrice;
    public double cost() { return unitPrice; }
}
class InternalJob extends Job {
    private int employeeId;
    public double cost() { return employeeRate(employeeId); }
}
```

---

## Extract Superclass

### What it does

Two classes share features → common superclass.

### Before

```java
class Department {
    private String name;
    private List<Person> staff;
    public double totalAnnualCost() { ... }
    public int headCount() { return staff.size(); }
}
class Employee {
    private String name;
    private double salary;
    public double annualCost() { ... }
}
```

### After

```java
abstract class Party {
    protected String name;
    public String name() { return name; }
    public abstract double annualCost();
}
class Department extends Party {
    private List<Person> staff;
    public double annualCost() { return totalAnnualCost(); }
    public int headCount() { return staff.size(); }
}
class Employee extends Party {
    private double salary;
    public double annualCost() { return salary * 12; }
}
```

---

## Extract Interface

### What it does

Multiple classes (possibly unrelated) share a common operation → declare an interface.

### Before

```java
class TimesheetService {
    public double charge(Employee e, int days) {
        return e.rate() * days * (e.hasSpecialSkill() ? 1.5 : 1);
    }
}
class BillingService {
    public double bill(Contract c) {
        return c.rate() * c.days();
    }
}
```

### After

```java
interface Billable {
    double rate();
    double days();
}
class Employee implements Billable { ... }
class Contract implements Billable { ... }

class BillingService {
    public double charge(Billable b) { return b.rate() * b.days(); }
}
```

### When

- A subset of methods on different classes need to be treated uniformly.
- You want to test against an interface rather than a concrete class.
- Two classes have a common protocol but no shared state.

---

## Collapse Hierarchy

### What it does

A subclass and superclass are too similar to justify the hierarchy → merge.

### Before

```java
class Employee {
    protected String name;
    protected double salary;
}
class FullTimeEmployee extends Employee {
    // adds nothing meaningful
}
```

### After

```java
class Employee {
    private String name;
    private double salary;
}
```

---

## Form Template Method

### What it does

Two methods do similar work in different ways → extract the common pattern into a Template Method on the superclass.

### Before

```java
class CustomerStatement {
    public String emit(Customer c) {
        StringBuilder b = new StringBuilder();
        b.append("Customer: ").append(c.name()).append("\n");
        for (Order o : c.orders()) b.append(" - ").append(o.summary()).append("\n");
        b.append("Total: ").append(c.total());
        return b.toString();
    }
}
class CustomerHtmlStatement {
    public String emit(Customer c) {
        StringBuilder b = new StringBuilder();
        b.append("<h1>Customer: ").append(c.name()).append("</h1>");
        for (Order o : c.orders()) b.append("<p>").append(o.summary()).append("</p>");
        b.append("<p>Total: ").append(c.total()).append("</p>");
        return b.toString();
    }
}
```

### After

```java
abstract class Statement {
    public final String emit(Customer c) {
        StringBuilder b = new StringBuilder();
        b.append(header(c.name()));
        for (Order o : c.orders()) b.append(line(o.summary()));
        b.append(footer(c.total()));
        return b.toString();
    }
    protected abstract String header(String name);
    protected abstract String line(String summary);
    protected abstract String footer(Money total);
}
class TextStatement extends Statement {
    protected String header(String name) { return "Customer: " + name + "\n"; }
    protected String line(String s) { return " - " + s + "\n"; }
    protected String footer(Money t) { return "Total: " + t; }
}
class HtmlStatement extends Statement {
    protected String header(String name) { return "<h1>Customer: " + name + "</h1>"; }
    protected String line(String s) { return "<p>" + s + "</p>"; }
    protected String footer(Money t) { return "<p>Total: " + t + "</p>"; }
}
```

The skeleton (`emit`) is common; the specific steps vary per subclass. This is the Template Method pattern.

---

## Replace Inheritance with Delegation

### What it does

A subclass that only uses *part* of its superclass — or breaks the LSP — should not be a subclass. It should be a separate class that delegates to the original.

### Before

```java
class Stack<E> extends Vector<E> {   // Java's textbook anti-example
    public void push(E e) { add(e); }
    public E pop() { return remove(size() - 1); }
}
```

`Stack` inherits all of `Vector`'s methods, including `add(int index, E e)` — which lets callers shove things into the middle of a "stack." Broken.

### After

```java
class Stack<E> {
    private final Vector<E> data = new Vector<>();
    public void push(E e) { data.add(e); }
    public E pop() { return data.remove(data.size() - 1); }
    public int size() { return data.size(); }
    public boolean isEmpty() { return data.isEmpty(); }
}
```

Now `Stack` exposes only what makes sense.

### When

- The subclass overrides most of the parent (or throws on most).
- The "is-a" relationship is wrong; it's really "has-a."
- The parent's API is wider than the subclass should expose.

---

## Replace Delegation with Inheritance

### What it does

The opposite. A class that delegates *every* method to the same target → just inherit.

### Before

```java
class Person {
    private final Office office;
    public String getName() { return office.getName(); }
    public String getAddress() { return office.getAddress(); }
    public String getPhone() { return office.getPhone(); }
    // etc — pure forwarding
}
```

### After

```java
class Person extends Office {}
```

### When

- Every delegated method just calls the same method on the delegate.
- The delegate is genuinely an "is-a" relationship (Person is-an Office? probably not — but in some domains yes).

### Caution

This is rarer than the other direction. Most "Middle Man" classes are wrong because they should hide some of the delegate's API, not all of it. Replacing with inheritance loses that hiding.

---

## How they relate

```
Duplicate Code in subclasses ──── Pull Up Field
                              ──── Pull Up Method
                              ──── Form Template Method
                              ──── Pull Up Constructor Body

Refused Bequest ─────────────── Push Down Method
                            ─── Push Down Field
                            ─── Replace Inheritance with Delegation

Two unrelated classes ──── Extract Superclass
   sharing features      ── Extract Interface

Lazy hierarchy ────── Collapse Hierarchy

Variant case in single class ─── Extract Subclass

Pure pass-through ──── Replace Delegation with Inheritance
```

---

## Mini Glossary

- **Pull up** — move toward the superclass (more general).
- **Push down** — move toward the subclass (more specific).
- **Liskov Substitution Principle** — a subclass must be usable wherever the superclass is expected.
- **Template Method** — a method on the superclass that defines a skeleton, with hook methods for subclasses to implement.
- **Composition over inheritance** — the principle that delegation is often safer than inheritance.

---

## Note on Go

Go has **no inheritance**. This entire category is largely N/A in Go.

The Go idioms that fill the role:

- **Embedding** — a struct can embed another, getting promotion of methods/fields.
- **Interfaces** — implicit (a type satisfies an interface by having the methods).
- **Composition** — explicit fields, explicit method delegation.

Refactorings translate roughly:

| Java | Go |
|---|---|
| Pull Up Method | Move method to embedded struct |
| Push Down Method | Move method out of embedded struct |
| Extract Superclass | Create struct with shared behavior; embed in others |
| Extract Interface | Define interface; types satisfy implicitly |
| Collapse Hierarchy | Inline embedded struct |
| Replace Inheritance with Delegation | Move from embedding to explicit field |
| Form Template Method | Functions taking interfaces; or higher-order functions |

In Go, the conversation isn't "should I inherit?" but "should I embed or delegate?" — and the answer is usually "delegate explicitly" unless the embedded type's API is fully appropriate.

---

## Review questions

1. What does Pull Up Field do, and when is it inappropriate?
2. When is Push Down Method the right move?
3. What's the difference between Extract Superclass and Extract Interface?
4. When should you Collapse Hierarchy?
5. What's the Template Method pattern?
6. When should you Replace Inheritance with Delegation?
7. Why is `Stack extends Vector` a textbook bad inheritance?
8. What's Liskov's Substitution Principle?
9. Why does Go's lack of inheritance not eliminate these refactorings?
10. When would you Replace Delegation with Inheritance, and what's the risk?

---

## Next

- [middle.md](middle.md) — when, trade-offs.
- [senior.md](senior.md) — architecture.
- [professional.md](professional.md) — runtime.
- Practice: [tasks.md](tasks.md), [find-bug.md](find-bug.md), [optimize.md](optimize.md), [interview.md](interview.md).
