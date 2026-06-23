# Organizing Data — Junior Level

> **Source:** [refactoring.guru/refactoring/techniques/organizing-data](https://refactoring.guru/refactoring/techniques/organizing-data)

---

## Table of Contents

1. [What this category is about](#what-this-category-is-about)
2. [Real-world analogy](#real-world-analogy)
3. [The 15 techniques at a glance](#the-15-techniques-at-a-glance)
4. [Self Encapsulate Field](#self-encapsulate-field)
5. [Replace Data Value with Object](#replace-data-value-with-object)
6. [Change Value to Reference](#change-value-to-reference)
7. [Change Reference to Value](#change-reference-to-value)
8. [Replace Array with Object](#replace-array-with-object)
9. [Duplicate Observed Data](#duplicate-observed-data)
10. [Change Unidirectional Association to Bidirectional](#change-unidirectional-association-to-bidirectional)
11. [Change Bidirectional Association to Unidirectional](#change-bidirectional-association-to-unidirectional)
12. [Replace Magic Number with Symbolic Constant](#replace-magic-number-with-symbolic-constant)
13. [Encapsulate Field](#encapsulate-field)
14. [Encapsulate Collection](#encapsulate-collection)
15. [Replace Type Code with Class](#replace-type-code-with-class)
16. [Replace Type Code with Subclasses](#replace-type-code-with-subclasses)
17. [Replace Type Code with State/Strategy](#replace-type-code-with-statestrategy)
18. [Replace Subclass with Fields](#replace-subclass-with-fields)
19. [How they relate](#how-they-relate)
20. [Mini Glossary](#mini-glossary)
21. [Review questions](#review-questions)

---

## What this category is about

**Organizing Data** is about how state is represented — the shape of the data, not the algorithms. The 15 techniques here cover:

- **Encapsulation** — hiding fields behind accessors so you can change implementation later.
- **Promotion** — turning primitives into proper types (`String email` → `Email`).
- **Type codes** — replacing `int FREE = 0; int PREMIUM = 1;` with proper types.
- **Associations** — choosing the right direction(s) for object references.
- **Magic numbers** — naming the unnamed.

The smells these cure are mostly about **hidden information**:

- [Primitive Obsession](../../01-code-smells/01-bloaters/junior.md): a `String` doing the job of an `Email`.
- [Switch Statements](../../01-code-smells/02-oo-abusers/junior.md): branching on integer type codes.
- [Inappropriate Intimacy](../../01-code-smells/05-couplers/junior.md): bidirectional links you don't need.
- [Magic Numbers]: `78.5` appearing in three places with no name.

> **Key idea:** data shape determines what's easy and hard to change. Bad data shape locks in bad design.

---

## Real-world analogy

### A spreadsheet that grew

The accounting team has a single spreadsheet:
- Column A: Customer name
- Column B: City
- Column C: Postal code
- Column D: Lifetime spend
- Column E: VIP (1/0)
- Column F: Country (sometimes "US", sometimes "USA", sometimes blank)

Six months later they want:
- Country-specific tax rules → but Column F is unreliable.
- "VIP" status to grant benefits → but it's unclear what makes someone VIP.
- Reports per region → but "City + Postal Code" wasn't normalized.

What the team really needed was a small **Address** table, a **CustomerStatus** type instead of `1/0`, and a controlled vocabulary for `Country`. The spreadsheet's *data shape* was the bottleneck, not the formulas.

That's exactly what Organizing Data refactorings do at the code level: shape the data so the code can grow.

---

## The 15 techniques at a glance

| Technique | What it does | Resolves smell |
|---|---|---|
| Self Encapsulate Field | Use accessors even from inside the class | (preparation) |
| Replace Data Value with Object | `String customerName` → `Customer` | Primitive Obsession |
| Change Value to Reference | Logical id → single instance | (entity correctness) |
| Change Reference to Value | Small immutable object → value semantics | (simplifies sharing) |
| Replace Array with Object | Index-based array → named fields | Primitive Obsession |
| Duplicate Observed Data | Domain data trapped in UI → duplicated and synced | (architecture) |
| Change Unidir to Bidir Association | Add the back-pointer | (modeling) |
| Change Bidir to Unidir Association | Remove unneeded back-pointer | Inappropriate Intimacy |
| Replace Magic Number with Symbolic Constant | `1.78` → `AVG_HEIGHT` | (clarity) |
| Encapsulate Field | Make field private + accessors | Inappropriate Intimacy |
| Encapsulate Collection | Don't expose mutable collection | Inappropriate Intimacy |
| Replace Type Code with Class | `int BLOOD_TYPE_A = 1` → `BloodType` class | Primitive Obsession, Switch Statements |
| Replace Type Code with Subclasses | When behavior differs per code | Switch Statements |
| Replace Type Code with State/Strategy | When the type changes at runtime | Switch Statements |
| Replace Subclass with Fields | Subclasses differ only by data | Lazy Class, Speculative Generality |

---

## Self Encapsulate Field

### What it does

Even within the class, use the getter/setter instead of the field directly. This makes it possible to override behavior in subclasses, add logging/validation later, or migrate the field shape without touching every internal use.

### Before

```java
class IntRange {
    private int low, high;
    boolean includes(int arg) {
        return arg >= low && arg <= high;
    }
}
```

### After

```java
class IntRange {
    private int low, high;
    int low() { return low; }
    int high() { return high; }
    boolean includes(int arg) {
        return arg >= low() && arg <= high();
    }
}
```

### Why

- A subclass can now override `low()` to dynamically compute (e.g., based on tenant).
- Validation can move into setters without touching every assignment.
- It's a precondition for many other refactorings.

### When NOT

- The class is value-final and never subclassed. Pure overhead.
- The accessors would just be noise without a reason.

---

## Replace Data Value with Object

### What it does

A simple data value (a `String`, an `int`) is doing more work than its type implies. Promote it to a proper class.

### Before

```java
class Order {
    private String customer;   // ❌ what *is* a customer?
}
```

### After

```java
class Customer {
    private final String name;
    public Customer(String n) { this.name = n; }
    public String name() { return name; }
}

class Order {
    private Customer customer;
}
```

### Why

- Now `Customer` can grow behavior (loyalty status, preferred region).
- Can't pass a random `String` where a `Customer` is expected.
- Equality and lifecycle become explicit.

This is the canonical cure for [Primitive Obsession](../../01-code-smells/01-bloaters/junior.md).

---

## Change Value to Reference

### What it does

Two `Customer` objects with the same name are two distinct objects. If they should be the **same** customer (because they share state, like loyalty points), make them point to a single shared instance.

### Before

```java
Order o1 = new Order(new Customer("Alice"));
Order o2 = new Order(new Customer("Alice"));
// Two Alices — incrementing one's loyalty doesn't affect the other's.
```

### After

```java
class Customer {
    private static Map<String, Customer> instances = new HashMap<>();
    public static Customer named(String name) {
        return instances.computeIfAbsent(name, Customer::new);
    }
    private Customer(String name) { this.name = name; }
}

Order o1 = new Order(Customer.named("Alice"));
Order o2 = new Order(Customer.named("Alice"));
// Both orders share the same Alice.
```

### When

- The object represents an **entity** with identity (Customer, Account, Document).
- State changes on one instance must be visible to all references.

---

## Change Reference to Value

### What it does

The opposite. An object that logically represents a small immutable concept (Money, Date, Coordinate) shouldn't be shared via reference — equality should be by value.

### Before

```java
Currency c1 = currencies.get("USD");
Currency c2 = currencies.get("USD");
// c1 == c2 (same object)
// What happens if a different module also caches "USD"? Two Currency objects, equality breaks.
```

### After

```java
class Currency {
    private final String code;
    public Currency(String c) { this.code = c; }
    @Override public boolean equals(Object o) { ... code-based ... }
    @Override public int hashCode() { return code.hashCode(); }
}
```

Now any two `Currency("USD")` are equal — value semantics.

### When

- The object is small and immutable.
- Identity doesn't matter — only the value.

Examples: Currency, Money, ZIP code, Color, ISBN.

---

## Replace Array with Object

### What it does

```java
String[] row = new String[]{"Alice", "Mgr", "30"};
```

`row[0]` is name, `row[1]` is title, `row[2]` is age. Tribal knowledge — the array is a junk drawer.

### After

```java
class Employee {
    private final String name;
    private final String title;
    private final int age;
    // ... constructor + accessors
}
Employee row = new Employee("Alice", "Mgr", 30);
```

### Why

- Type safety — can't put name where age goes.
- IDE autocomplete.
- Easier to add fields (just add a field, not a magic index).

> Note: Java records (`record Employee(String name, String title, int age) {}`) make this trivial.

---

## Duplicate Observed Data

### What it does

A piece of domain data lives only in a UI widget. Move it (or duplicate it) into the domain model so business logic can work with it without depending on the UI.

This is mostly historical — modern web/mobile uses MVVM, Redux, signals, etc., that already separate domain from view. Still relevant for legacy desktop apps.

### Before

```java
// Swing-style:
JTextField nameField = ...;
String name = nameField.getText();   // domain logic reads from UI
```

### After

```java
class CustomerModel {
    private String name;
    // listeners propagate from UI to model
}
CustomerModel model = ...;
String name = model.getName();
```

---

## Change Unidirectional Association to Bidirectional

### What it does

`Order` knows its `Customer`. Now you need `Customer` to also know its `Order`s (e.g., for `customer.orderCount()`).

### Before

```java
class Order {
    private Customer customer;
}
class Customer {
    // doesn't know about Order
}
```

### After

```java
class Order {
    private Customer customer;
    public void setCustomer(Customer c) {
        if (customer != null) customer.removeOrder(this);
        customer = c;
        if (c != null) c.addOrder(this);
    }
}
class Customer {
    private final Set<Order> orders = new HashSet<>();
    void addOrder(Order o) { orders.add(o); }
    void removeOrder(Order o) { orders.remove(o); }
    public int orderCount() { return orders.size(); }
}
```

### Caveat

Bidirectional links are stickier than they look:
- Both sides must be kept consistent (use a single setter).
- ORM mappings (Hibernate, JPA) need explicit "owning side" annotations.
- Serialization can loop infinitely (use `@JsonIgnore` on one side).

---

## Change Bidirectional Association to Unidirectional

### What it does

The opposite — when one direction is no longer needed, drop it. Reduces coupling, simplifies serialization.

### Before

```java
class Order { Customer customer; }
class Customer { Set<Order> orders; }
```

If `customer.orders` is never used (or replaced by a query), drop it:

### After

```java
class Order { Customer customer; }
class Customer {
    public List<Order> ordersFromRepo(OrderRepository repo) {
        return repo.findByCustomer(this);
    }
}
```

The "back-pointer" becomes a query.

### When

- The collection is rarely accessed but expensive to maintain.
- The application has a repository / database — let the database do the join.

---

## Replace Magic Number with Symbolic Constant

### What it does

```java
return amount * 1.785;   // ❌ what is 1.785?
```

```java
private static final double GST_RATE = 1.785;
return amount * GST_RATE;
```

### Why

- The reader knows the meaning.
- Changing the rate updates one place.
- Easy to grep.

### When NOT

- The number is obvious in context (`x * 2` to double).
- The number has no business meaning (loop bounds, array index).

> Common offenders: tax rates, percentages, milliseconds (`86400000`), HTTP status codes, retry counts, magic chars (`'@'`, `'#'`).

---

## Encapsulate Field

### What it does

```java
public String name;
```

becomes

```java
private String name;
public String getName() { return name; }
public void setName(String n) { this.name = n; }
```

### Why

- Validation can be added later without changing call sites.
- Equivalence: from outside, the API is uniform.
- A precondition for nearly every other Organizing Data refactoring.

### Modern languages

- **Kotlin**: `var name: String` already has implicit accessors. Encapsulation is automatic.
- **C#**: `public string Name { get; set; }` — properties.
- **Python**: properties via `@property` decorator.
- **Go**: lower-case = private; uppercase = public. No accessors automatically — write them when needed.

---

## Encapsulate Collection

### What it does

```java
public Set<Order> getOrders() { return orders; }   // ❌ caller can mutate
```

becomes

```java
public Set<Order> getOrders() { return Collections.unmodifiableSet(orders); }
public void addOrder(Order o) { orders.add(o); /* maintain invariants */ }
public void removeOrder(Order o) { orders.remove(o); }
```

### Why

- The owner controls what enters / leaves the collection.
- Outsiders can read but not mutate.
- Invariants (e.g., max size, no duplicates by id) can be enforced.

### Modern equivalents

- Java: `List.copyOf(list)` (Java 10+) returns an immutable copy.
- Kotlin: `val orders: List<Order>` (read-only by default).
- Rust: borrow rules enforce this at compile time.

---

## Replace Type Code with Class

### What it does

```java
class Person {
    public static final int A = 1, B = 2, AB = 3, O = 4;
    private int bloodGroup;
}
```

is replaced with

```java
class BloodGroup {
    public static final BloodGroup A = new BloodGroup(1);
    public static final BloodGroup B = new BloodGroup(2);
    public static final BloodGroup AB = new BloodGroup(3);
    public static final BloodGroup O = new BloodGroup(4);
    private final int code;
    private BloodGroup(int c) { this.code = c; }
    public int code() { return code; }
}
class Person {
    private BloodGroup bloodGroup;
}
```

### Modern alternative

Java enums:

```java
enum BloodGroup { A, B, AB, O }
```

This is by far the cleanest cure. Enums are type-safe, exhaustive, and switch-able.

---

## Replace Type Code with Subclasses

### What it does

If behavior differs by type code, replace the code with **subclasses**.

```java
class Employee {
    static final int ENGINEER = 0, SALESMAN = 1;
    private int type;
    double monthlyPay() {
        switch (type) {
            case ENGINEER: return 5000;
            case SALESMAN: return 3000 + commission;
        }
    }
}
```

becomes

```java
abstract class Employee {
    abstract double monthlyPay();
}
class Engineer extends Employee { double monthlyPay() { return 5000; } }
class Salesman extends Employee {
    private double commission;
    double monthlyPay() { return 3000 + commission; }
}
```

This eliminates the `switch` and aligns with [OO Abusers](../../01-code-smells/02-oo-abusers/junior.md) cures.

### When NOT

- The "subclass" needs to change at runtime (Engineer becomes Manager). Use State/Strategy instead.
- There are too few behavioral differences to justify subclasses. An enum with a method works:

```java
enum EmployeeType {
    ENGINEER { double pay(double commission) { return 5000; } },
    SALESMAN { double pay(double commission) { return 3000 + commission; } };
    abstract double pay(double commission);
}
```

---

## Replace Type Code with State/Strategy

### What it does

When the "type" changes at runtime — an Employee becomes a Manager — subclasses don't fit (you can't change an object's class). Delegate behavior to a State/Strategy object that can be swapped.

```java
class Employee {
    private EmployeeType type;
    public void promote() { this.type = new ManagerType(); }
    double monthlyPay() { return type.monthlyPay(); }
}

interface EmployeeType { double monthlyPay(); }
class EngineerType implements EmployeeType { ... }
class ManagerType implements EmployeeType { ... }
```

### When

- The "type" can transition during the object's lifetime.
- Different "states" require different behavior + the transitions matter.

> See the State and Strategy patterns.

---

## Replace Subclass with Fields

### What it does

Sometimes subclasses differ only by data — no behavior differences. Replace them with fields.

```java
abstract class Person {
    abstract boolean isMale();
    abstract char code();
}
class Male extends Person {
    boolean isMale() { return true; }
    char code() { return 'M'; }
}
class Female extends Person {
    boolean isMale() { return false; }
    char code() { return 'F'; }
}
```

becomes

```java
class Person {
    private final boolean male;
    private final char code;
    public static Person createMale() { return new Person(true, 'M'); }
    public static Person createFemale() { return new Person(false, 'F'); }
}
```

### When

- The "subclass" doesn't override any meaningful behavior.
- All the difference is in constants.

This is the cure for [Lazy Class](../../01-code-smells/04-dispensables/junior.md) and [Speculative Generality](../../01-code-smells/04-dispensables/junior.md) when applied to a tiny inheritance hierarchy.

---

## How they relate

```
Primitive Obsession ─── Replace Data Value with Object
                    ─── Replace Type Code with Class
                    ─── Replace Array with Object

Switch Statements ──── Replace Type Code with Subclasses
                  ──── Replace Type Code with State/Strategy

Inappropriate Intimacy ── Encapsulate Field
                       ── Encapsulate Collection
                       ── Change Bidir to Unidir Association

Magic Number ──── Replace Magic Number with Symbolic Constant

Lazy Class ────── Replace Subclass with Fields
                  Inline Class
```

The category is foundational: many refactorings in other categories (especially [Conditionals](../04-simplifying-conditionals/junior.md) and [Generalization](../06-dealing-with-generalization/junior.md)) start from cleanly-organized data.

---

## Mini Glossary

- **Type code** — an integer constant used to distinguish kinds of things (`int BLOOD_TYPE_A = 1`). Almost always a smell.
- **Magic number** — a literal whose meaning is opaque (`78.5`). Replace with a named constant.
- **Value object** — small, immutable, equality-by-value. Money, ZIP code, RGB color.
- **Entity** — has identity, equality-by-id. Customer, Account.
- **Reference vs. Value semantics** — does `==` mean "same object" or "equivalent value."
- **Encapsulation** — hiding internal state behind methods so callers can't reach in.

---

## Review questions

1. What's a Type Code, and why is it a smell?
2. When do you use Replace Type Code with Subclasses vs. Replace Type Code with State/Strategy?
3. What's the difference between Value semantics and Reference semantics?
4. Why is Self Encapsulate Field a "preparation" refactoring?
5. What does Encapsulate Collection prevent?
6. When is bidirectional association the right choice? When wrong?
7. How does Replace Data Value with Object cure Primitive Obsession?
8. When can a magic number be left as-is?
9. When does Replace Subclass with Fields apply?
10. How do modern language features (Java records, Kotlin properties) collapse some of these techniques?

---

## Next

- [middle.md](middle.md) — real-world triggers, trade-offs.
- [senior.md](senior.md) — at architecture scale.
- [professional.md](professional.md) — runtime cost.
- Practice: [tasks.md](tasks.md), [find-bug.md](find-bug.md), [optimize.md](optimize.md), [interview.md](interview.md).
