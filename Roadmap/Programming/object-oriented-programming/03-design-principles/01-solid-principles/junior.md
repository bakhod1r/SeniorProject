# SOLID Principles — Junior

> **What?** *SOLID* is an acronym for five class-level design principles, popularised by Robert C. Martin: **S**ingle Responsibility, **O**pen/Closed, **L**iskov Substitution, **I**nterface Segregation, and **D**ependency Inversion. Each one targets a different way a class can become hard to change without breaking something else.
> **How?** When you design or review a class, walk through the letters: does this class have one reason to change? Can it gain new behaviour without modifying existing code? Could a subclass be slotted in for the parent transparently? Is the interface it depends on narrow enough? Does it depend on abstractions, not concretes?

---

## 1. The point of SOLID in one sentence

Most OO code rots from the inside: classes accumulate fields, methods, dependencies, and special cases until *changing one feature* requires *touching twenty files*. SOLID is a checklist of five forces that, applied consistently, keep this rot at bay. None of the letters is magic — they're just five different angles on the same goal: code that absorbs change without breaking.

You'll find every other principle in this section (Composition over Inheritance, Law of Demeter, Cohesion & Coupling, DRY/KISS/YAGNI, Fragile Base Class) overlaps with SOLID. Treat SOLID as the umbrella vocabulary that ties the rest together.

---

## 2. S — Single Responsibility Principle (SRP)

> **A class should have one, and only one, reason to change.**

"Reason to change" means a *stakeholder concern* — a person or department whose request would force you to edit the class. If your `Invoice` class is edited by both the *accounting* team (when tax rules change) and the *printing* team (when the PDF layout changes), it has two reasons to change.

```java
// SRP violation — two reasons to change in one class:
public class Invoice {
    public BigDecimal totalWithTax() { ... }     // changes when accounting rules change
    public byte[] renderPdf()        { ... }     // changes when print layout changes
}

// SRP-respecting split:
public class Invoice {
    public BigDecimal totalWithTax() { ... }
}
public class InvoicePdfRenderer {
    public byte[] render(Invoice inv) { ... }
}
```

The accounting team and the printing team can now make independent edits without stepping on each other. The classes also become easier to test — `Invoice` doesn't need a PDF library on its classpath.

**Pitfall:** SRP is often misread as "one method per class". It's not. A `BankAccount` legitimately has `deposit`, `withdraw`, and `balance` — they all serve the same stakeholder (the account holder). One *responsibility*, many methods.

---

## 3. O — Open/Closed Principle (OCP)

> **Software entities (classes, modules, functions) should be open for extension but closed for modification.**

You should be able to add *new* behaviour without editing *old* code. The classic mechanism is polymorphism.

```java
// OCP violation — adding a payment method means editing this class:
public class PaymentProcessor {
    public void pay(String type, BigDecimal amount) {
        switch (type) {
            case "CARD"   -> chargeCard(amount);
            case "BANK"   -> chargeBank(amount);
            case "CRYPTO" -> chargeCrypto(amount);
            // adding ApplePay = editing this class
        }
    }
}

// OCP-respecting — add a new PaymentMethod implementation, the processor doesn't change:
public interface PaymentMethod {
    void charge(BigDecimal amount);
}
public class PaymentProcessor {
    public void pay(PaymentMethod method, BigDecimal amount) {
        method.charge(amount);
    }
}
```

To add Apple Pay, you write `class ApplePay implements PaymentMethod {…}` and the existing processor doesn't change at all. The risk of breaking the credit-card path while adding Apple Pay drops to zero.

**Pitfall:** OCP is not "never edit code". It's "don't edit *for additions*". Bug fixes and refactoring still happen on existing classes. Treat OCP as a tool for the *change axes you predict* — don't over-abstract for changes you don't.

---

## 4. L — Liskov Substitution Principle (LSP)

> **Subtypes must be substitutable for their base types without altering the correctness of the program.**

If `Square extends Rectangle`, code that works on `Rectangle` must keep working when handed a `Square`. The classic counter-example: a method that sets width and height independently on a `Rectangle` breaks if you pass a `Square` that forces width == height.

```java
// LSP violation:
class Rectangle {
    int width, height;
    public void setWidth(int w)  { this.width  = w; }
    public void setHeight(int h) { this.height = h; }
    public int area() { return width * height; }
}
class Square extends Rectangle {
    @Override public void setWidth(int w)  { super.setWidth(w); super.setHeight(w); }
    @Override public void setHeight(int h) { super.setWidth(h); super.setHeight(h); }
}

void test(Rectangle r) {
    r.setWidth(5); r.setHeight(4);
    assert r.area() == 20;     // fails when r is actually a Square (returns 16)
}
```

`Square` *passes* the type checker but *violates* the behavioural contract of `Rectangle`. LSP says: don't write inheritance that breaks callers' expectations. If the contracts differ, you have two unrelated types, not a parent-child relationship.

**Pitfall:** LSP isn't about syntax (Java enforces type compatibility); it's about *semantics*. A subclass that throws where the parent didn't, or returns unexpected values, violates LSP even if it compiles.

---

## 5. I — Interface Segregation Principle (ISP)

> **Clients should not be forced to depend on interfaces they do not use.**

When one interface has a dozen methods and most callers only need two, those callers carry an artificial coupling to methods they don't care about.

```java
// ISP violation — one fat interface:
public interface MultifunctionDevice {
    void print(Document d);
    void scan(Document d);
    void fax(Document d);
    void emailScan(Document d, String to);
}

// A pure printer must "implement" scan/fax/email by throwing — fragile and confusing.

// ISP-respecting — small focused interfaces:
public interface Printer { void print(Document d); }
public interface Scanner { void scan(Document d); }
public interface Fax     { void fax(Document d); }

public class PureLaserPrinter implements Printer { ... }                 // doesn't lie
public class OfficeAllInOne   implements Printer, Scanner, Fax { ... }   // composes
```

Smaller interfaces also keep test doubles small — mocking `Printer` is one method, not twelve.

**Pitfall:** ISP isn't a demand for "one method per interface". The unit of cohesion is the *role a caller plays* — `Printer` covers everything a print-only caller wants, no less, no more.

---

## 6. D — Dependency Inversion Principle (DIP)

> **High-level modules should not depend on low-level modules. Both should depend on abstractions. Abstractions should not depend on details; details should depend on abstractions.**

The *direction* of the dependency arrow matters. A domain class that talks directly to a database driver inverts the natural cost: now changing the database forces changes in the domain.

```java
// DIP violation:
public class OrderService {
    private final PostgresOrderRepository repo;   // concrete, low-level

    public void place(Order o) {
        repo.insert(o);
    }
}

// DIP-respecting:
public interface OrderRepository {
    void save(Order o);
}

public class OrderService {
    private final OrderRepository repo;   // abstraction
    public OrderService(OrderRepository repo) { this.repo = repo; }
    public void place(Order o) { repo.save(o); }
}

public class PostgresOrderRepository implements OrderRepository { ... }   // detail
```

Now `OrderService` (the high-level policy) doesn't know about Postgres. Tests substitute an in-memory `OrderRepository`; production wires in the Postgres one. Swap the database, change *one* class.

**Pitfall:** DIP is not "wrap everything in an interface". Wrap *what crosses an interesting boundary* — database, message bus, external API, clock. Don't wrap the JDK's `String` in `IString`.

---

## 7. The letters interact

SOLID isn't five independent rules. Most real-world fixes touch two or three letters at once.

- A class that violates SRP usually grows so large that it can't be substituted (LSP at the class level becomes meaningless) and forces clients to depend on methods they don't use (ISP).
- A class that violates DIP usually can't satisfy OCP — to extend it, you must edit it, because it's hard-coded to the wrong concrete.
- LSP violations are a sign of misapplied inheritance — composition (see [../02-composition-over-inheritance/](../02-composition-over-inheritance/)) is often the fix.

When you find yourself reaching for SOLID, ask which letters are in play, then make one targeted change. Don't try to score all five at once.

---

## 8. SOLID in modern Java

Modern Java idioms make some letters easier:

- **Records** give you immutable value carriers. Their *single* responsibility is to be a value — SRP for free.
- **Sealed interfaces** + **pattern matching** let you write OCP-friendly code without polymorphism explosion: you decide upfront which types are allowed, and the compiler enforces exhaustiveness.
- **Functional interfaces** (`Function`, `BiFunction`, `Predicate`) are tiny ISP-respecting types — one method, one role.
- **Constructor injection** with `final` fields is the cleanest DIP idiom; no framework required.

---

## 9. Common newcomer mistakes

**Mistake 1: applying every letter to every class.**

```java
public interface IUserSaver  { void save(User u); }
public interface IUserDeleter { void delete(User u); }
public interface IUserFinder { Optional<User> find(long id); }
public interface IUserCounter { int count(); }
```

You've over-segregated. A `UserRepository` with these four methods is fine — they serve one role (storing users). ISP doesn't mean "one method per interface".

**Mistake 2: confusing SRP with size.**

A 200-line class with one responsibility (e.g., a complex `TaxCalculator` that handles a real legal regime) is *not* an SRP violation. A 20-line class that prints, emails, and persists is.

**Mistake 3: violating LSP by accident.**

```java
class ReadOnlyList<T> extends ArrayList<T> {
    @Override public boolean add(T t) { throw new UnsupportedOperationException(); }
}
```

Code that takes `List<T>` and calls `add` now crashes when handed a `ReadOnlyList`. Make `ReadOnlyList` *not* extend `ArrayList`; have it implement a narrower interface.

**Mistake 4: wrapping everything in interfaces for DIP.**

```java
public interface ILogger { void log(String msg); }
public interface IClock  { Instant now(); }
public interface IString { int length(); }   // ← nonsense
```

DIP applies to *interesting boundaries*, not to every type you touch.

---

## 10. Quick rules

- [ ] **S** — one *stakeholder concern* per class, not one method.
- [ ] **O** — design for the change axes you can name, not every conceivable axis.
- [ ] **L** — subclasses must honour the parent's behavioural contract, not just its method signatures.
- [ ] **I** — split fat interfaces by *the role each caller plays*.
- [ ] **D** — depend on abstractions across interesting boundaries (DB, network, clock).

---

## 11. What's next

| Topic                                                       | File              |
| ----------------------------------------------------------- | ----------------- |
| Worked refactors per letter, before/after                   | `middle.md`        |
| Edge cases, anti-patterns, "SOLIDified to death"            | `senior.md`        |
| Driving SOLID across a team and a codebase                  | `professional.md`  |
| Where SOLID-relevant rules live in JLS/JVMS                 | `specification.md` |
| Spotting silent SOLID violations and runtime symptoms       | `find-bug.md`      |
| JIT, dispatch, allocation: the cost of SOLID idioms         | `optimize.md`      |
| Hands-on exercises                                          | `tasks.md`         |
| Interview Q&A                                               | `interview.md`     |

---

**Memorize this:** SRP for *who edits this*; OCP for *what extends without editing*; LSP for *honouring the parent's contract*; ISP for *the role each caller plays*; DIP for *which way the arrow points*. Don't apply every letter to every class — apply the one that names the smell you're seeing.
