# Inappropriate Intimacy — Junior

> **What?** *Inappropriate Intimacy* is the code smell where two classes know too much about each other's internals — they read each other's private fields (via package-private access, friend-like leaks, or `protected` exposure), pass `this` references back and forth, and end up changing together every time either one is touched. Coined by Fowler in *Refactoring*, it is the OO equivalent of two coworkers reading each other's diary.
> **How?** When you see a method on class `A` that drills into class `B`'s state (`b.items.get(0).owner.address.street`), a bidirectional reference where `A` holds a `B` and `B` holds an `A`, or a "helper" that exists only to expose one class's internals to another, you are looking at intimacy. The fix is almost always: pick one direction, push the behaviour into the class that owns the data, or extract a third class that mediates between the two.

---

## 1. The point of Inappropriate Intimacy in one sentence

Encapsulation says a class owns its state and exposes only the *minimum* surface another class needs to do its job. Inappropriate Intimacy is the smell that appears when two classes quietly *agree* to ignore that rule — `Order` reaches inside `Customer` to read fields it has no business reading, `Customer` calls back into `Order` to mutate state nobody else can mutate, and the two evolve as a single tangled blob that the rest of the codebase can no longer touch safely.

You'll find this smell everywhere in OO code that was written without rigorous boundary discipline: JPA bidirectional mappings, GUI controllers that pass `this` into their models, parent-child entities that share package-private setters, and any pair of classes whose names always appear together in commit messages. Inappropriate Intimacy is the *coupling* side of the cohesion/coupling pair — Feature Envy is one class doing another's work; Inappropriate Intimacy is two classes doing each other's work.

---

## 2. The C++ "friend" analogy

In C++, a class can declare another class as a `friend`, granting it access to private members. Two classes that declare each other as `friend` are explicitly intimate — the compiler enforces a special trust relationship between them, bypassing normal access control.

Java has no `friend` keyword, but it does have *package-private* visibility (the default, no modifier). Two classes in the same package can read and write each other's package-private fields with the compiler's blessing. This is Java's quiet form of friendship — and it is the most common vector for Inappropriate Intimacy.

```java
// package com.acme.shop;
public class Order {
    Customer customer;        // package-private
    BigDecimal total;         // package-private
}

public class Customer {
    String name;              // package-private
    List<Order> orders;       // package-private

    void registerOrder(Order o) {
        this.orders.add(o);
        o.customer = this;           // Customer mutates Order's internals
        o.total = o.total.multiply(loyaltyMultiplier());  // and reads them
    }
}
```

`Customer` is treating `Order` as if it were the same class. Nothing prevents this in Java. The compiler is happy. Reviewers who only look at `public` APIs won't see it. But the moment anyone tries to test `Order` in isolation, or move `Customer` to a different package, the implicit contract breaks.

---

## 3. A small worked example — Order and Customer

Consider a shop where `Order` and `Customer` evolved together:

```java
// package com.acme.shop;

public class Customer {
    String name;
    String tier;
    List<Order> orders = new ArrayList<>();

    public void placeOrder(Order o) {
        orders.add(o);
        o.customer = this;
        if (tier.equals("GOLD")) {
            o.discount = new BigDecimal("0.10");
        }
        o.recalculateTotal();
    }
}

public class Order {
    Customer customer;
    BigDecimal subtotal;
    BigDecimal discount = BigDecimal.ZERO;
    BigDecimal total;
    List<LineItem> items;

    public BigDecimal effectiveName() {
        return new BigDecimal(customer.name.length());  // nonsense but compiles
    }

    void recalculateTotal() {
        total = subtotal.multiply(BigDecimal.ONE.subtract(discount));
        customer.lastOrderTotal = total;   // writes back into Customer
    }
}
```

What's wrong:

- `Customer.placeOrder` mutates `Order.customer`, `Order.discount`, and calls `Order.recalculateTotal()` — three internal touches.
- `Order.recalculateTotal` writes `customer.lastOrderTotal` — `Order` reaches back into `Customer`'s state.
- `Order.effectiveName` reads `customer.name` to compute something `Order` shouldn't care about.
- Both classes are in the same package precisely so they can do this. Move either to a different package and it stops compiling.

A reasonable refactor decides on a *direction* — usually the aggregate root (`Customer`) owns the relationship — and pushes behaviour into the class that owns the data:

```java
// package com.acme.shop;

public final class Customer {
    private final String name;
    private final CustomerTier tier;
    private final List<Order> orders = new ArrayList<>();

    public Order placeOrder(List<LineItem> items) {
        BigDecimal discount = tier.discountFor(items);
        Order o = new Order(items, discount);
        orders.add(o);
        return o;
    }
}

public final class Order {
    private final List<LineItem> items;
    private final BigDecimal discount;
    private final BigDecimal total;

    Order(List<LineItem> items, BigDecimal discount) {
        this.items    = List.copyOf(items);
        this.discount = discount;
        this.total    = subtotal(items).multiply(BigDecimal.ONE.subtract(discount));
    }

    public BigDecimal total() { return total; }
}
```

`Order` no longer knows about `Customer`. `Customer` no longer pokes at `Order`'s internals. The discount calculation lives in `CustomerTier` (the class that knows the rule). All three classes can sit in different packages without anything breaking.

---

## 4. Bidirectional getter chains — the "train wreck" cousin

Sometimes intimacy hides behind public getters. A class doesn't touch another's private state directly — it just calls a chain of getters that walks the object graph for it:

```java
String street = order.getCustomer().getAddress().getStreet();
order.getCustomer().getAddress().setStreet("New street");
```

The `Order` *caller* now depends on the shape of `Customer`, the existence of `Address`, and the field name `street`. If `Address` is refactored into `BillingAddress` and `ShippingAddress`, this line breaks in dozens of places. This is the Law of Demeter being violated, and it's a form of Inappropriate Intimacy — the caller is intimate with the *transitive* structure of `Order`.

Quick fix: have `Order` expose what the caller actually needs.

```java
order.shippingStreet();   // Order delegates internally; callers don't walk the graph
```

The caller's dependency shrinks from "I know the whole tree" to "I know `Order` has a shipping street". `Address` can be redesigned without touching this call site.

---

## 5. Circular references and ownership confusion

Two classes that hold references to each other create a *cycle*. Cycles aren't always wrong (a doubly-linked list has them on purpose), but in business code they nearly always signal that *ownership is unclear*:

```java
public class Department {
    private List<Employee> employees;
    public void hire(Employee e) {
        employees.add(e);
        e.setDepartment(this);   // Department sets the back-reference
    }
}

public class Employee {
    private Department department;
    public void setDepartment(Department d) {
        this.department = d;
        d.getEmployees().add(this);   // Employee also adds itself
    }
}
```

Call `department.hire(employee)` and the employee gets added *twice*. Call `employee.setDepartment(d)` and it works "by accident" because `add` happens to be idempotent on lists … oh wait, it isn't. Bidirectional updates without a clear *owner* become a source of duplicates, missed updates, and stale references.

Pick one side as the owner of the relationship. Make the other side *derived* — either computed on demand, or set via the owner.

```java
public final class Department {
    private final List<Employee> employees = new ArrayList<>();
    public void hire(Employee e) { employees.add(e); }
    public List<Employee> employees() { return List.copyOf(employees); }
}

public final class Employee {
    private final String name;
    public Employee(String name) { this.name = name; }
    // No reference to Department. If you need it, ask the repository.
}
```

If `Employee` truly needs to know its department, that should go through a service that asks the *current* state, not a cached back-reference that may diverge.

---

## 6. Common newcomer mistakes

**Mistake 1: "they're in the same package so it's fine."**

Same-package fields are *invisible to the compiler in another package*, but they're not invisible to your future selves. Treating package-private as "private to my buddy" is exactly the agreement that creates intimacy. Use `private` by default; raise visibility only when a sibling *has a documented reason* to need access.

**Mistake 2: "this is bidirectional because the database is bidirectional."**

A `1:N` row in a database does not require both Java sides to hold a Java reference. The "many" side can hold a foreign key; the "one" side queries when needed. Bidirectional mappings in JPA are a performance/API choice, not a correctness requirement — and they're a leading cause of Inappropriate Intimacy in Java code.

**Mistake 3: passing `this` into a child object's constructor.**

```java
public class Order {
    public Order() {
        this.invoice = new Invoice(this);   // Invoice now knows about Order
    }
}
```

`Invoice` only needed the order number and amount; you handed it the whole `Order`. Pass *values*, not whole objects — that's the Tell, Don't Ask principle applied at construction time.

**Mistake 4: confusing intimacy with cohesion.**

Two methods on the *same* class that share state are *cohesive*, which is good. Two *separate* classes that share state are *intimate*, which is bad. The fix often is: those methods *should* be on the same class, and merging the two classes is the right move (Inline Class).

---

## 7. Quick rules

- [ ] If class `A` reads or writes a non-public field of class `B`, name it — that's intimacy, not "internal access".
- [ ] If `A` holds a `B` and `B` holds an `A`, ask: *who owns the relationship?* Make the other side derived.
- [ ] If you can't move one of the two classes to a different package without breaking compilation, you have package-private intimacy.
- [ ] If a method on `A` reads `b.x.y.z`, push the work into `B` (or `B.x`). Tell, don't ask.
- [ ] If two classes always appear together in commits, they probably need to be merged (Inline Class) or split differently.

---

## 8. What's next

| Topic                                                       | File              |
| ----------------------------------------------------------- | ----------------- |
| Refactoring moves: Move Method, Hide Delegate, Extract Class | `middle.md`        |
| Information hiding, encapsulation breaks, detection         | `senior.md`        |
| JPMS modules, ArchUnit, hexagonal boundaries                | `professional.md`  |
| Metrics (CBO, MPC), JLS access rules                        | `specification.md` |
| Bidirectional JPA, serialization cycles, package leaks      | `find-bug.md`      |
| Fetch-join cost, equals/hashCode recursion                  | `optimize.md`      |
| Hands-on refactors                                          | `tasks.md`         |
| Interview Q&A                                               | `interview.md`     |

---

**Memorize this:** Inappropriate Intimacy is two classes sharing a private life — package-private fields, bidirectional references, getter chains, mutual setters. The smell is *coupling that survives only because both sides cooperate*. The cure is to pick an owner, push behaviour into the class that owns the data, and let the other side ask through a narrow public method.
