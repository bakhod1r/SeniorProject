# Dealing with Generalization — Find the Bug

> 12 wrong refactors.

---

## Bug 1 — Pull Up Method when subclasses meant different things (Java)

**Original:**
```java
class Engineer { public String describe() { return "engineer-" + name; } }
class Manager { public String describe() { return "manager-" + name; } }
```

**"Refactored":**
```java
abstract class Employee {
    protected String name;
    public String describe() { return "employee-" + name; }   // ❌
}
```

<details><summary>Bug</summary>

The pulled-up method has a different output than either subclass had. Behavior changed.

**Fix:** The methods looked similar but produced different outputs. Either:
- Don't pull up; the difference is meaningful.
- Use Form Template Method:
```java
abstract class Employee {
    public String describe() { return prefix() + "-" + name; }
    protected abstract String prefix();
}
class Engineer extends Employee { protected String prefix() { return "engineer"; } }
```
</details>

---

## Bug 2 — Pull Up Field changes initialization (Java)

```java
class Engineer extends Employee { private double rate = 100.0; }
class Manager extends Employee { private double rate = 150.0; }
```

**"Refactored":**
```java
abstract class Employee { protected double rate = 0.0; }   // ❌ default 0
class Engineer extends Employee {}
class Manager extends Employee {}
```

<details><summary>Bug</summary>

Original initialized `rate` to 100/150; refactor initialized to 0. Subclasses no longer set rate.

**Fix:** Use constructors:
```java
abstract class Employee {
    protected final double rate;
    public Employee(double rate) { this.rate = rate; }
}
class Engineer extends Employee { public Engineer() { super(100.0); } }
class Manager extends Employee { public Manager() { super(150.0); } }
```
</details>

---

## Bug 3 — Push Down Method removes interface method (Java)

```java
abstract class Animal {
    public abstract String speak();
}
class Dog extends Animal { public String speak() { return "Woof"; } }
class Fish extends Animal { public String speak() { return ""; } }
```

**"Refactored":** "Fish doesn't really speak; push down."

```java
abstract class Animal {}   // ❌ removed abstract method
class Dog extends Animal { public String speak() { return "Woof"; } }
class Fish extends Animal {}
```

Now caller `for (Animal a : animals) print(a.speak());` doesn't compile.

<details><summary>Bug</summary>

Removing a method from the polymorphic root breaks all callers.

**Fix:** Either keep the abstract method (with Fish returning ""), or redesign to use Speaker interface:

```java
interface Speaker { String speak(); }
class Dog implements Speaker { public String speak() { return "Woof"; } }
class Fish {}   // doesn't implement Speaker

// Caller:
for (Animal a : animals) {
    if (a instanceof Speaker s) print(s.speak());
}
```
</details>

---

## Bug 4 — Extract Superclass with conflicting field types (Java)

```java
class A { protected int id; }
class B { protected String id; }
```

**"Refactored":**
```java
abstract class Common { protected Object id; }   // ❌
class A extends Common {}
class B extends Common {}
```

<details><summary>Bug</summary>

`Object id` defeats type safety. Now both A and B must downcast.

**Fix:** If `id` truly varies in type, don't pull it up. If both should be String, change one's type. If both should be int, change the other.

Or: use generics (`Common<T>`):
```java
abstract class Common<I> { protected I id; }
class A extends Common<Integer> {}
class B extends Common<String> {}
```
</details>

---

## Bug 5 — Form Template Method violates final (Java)

```java
abstract class Statement {
    public final String emit(Customer c) {
        return header() + lines(c) + footer();
    }
    protected abstract String header();
}

class CustomStatement extends Statement {
    @Override public String emit(Customer c) { ... }   // ❌ override final
}
```

<details><summary>Bug</summary>

Subclass tries to override `final emit()`. Compile error.

**Fix:** Decide whether the skeleton should be overridable. If yes, drop `final`. Usually `final` is intentional — to prevent override. Subclasses fill `header()`, `footer()` — not the skeleton.

If a CustomStatement truly needs a different skeleton, it shouldn't be a subclass of Statement.
</details>

---

## Bug 6 — Replace Inheritance with Delegation breaks polymorphism (Java)

**Original:**
```java
class Stack<E> extends Vector<E> { ... }
List<Number> ns = new Stack<>();   // ✓ Stack-as-Vector-as-List
```

**"Refactored":**
```java
class Stack<E> {
    private Vector<E> data;
    // ...
}
List<Number> ns = new Stack<>();   // ❌ won't compile
```

<details><summary>Bug</summary>

Stack no longer is-a List. Callers using polymorphism break.

**Fix:** Keep stacks-as-stacks. If callers really need a List interface, expose `asList()`:

```java
class Stack<E> {
    private final List<E> data = new ArrayList<>();
    public List<E> asList() { return Collections.unmodifiableList(data); }
}
```

Lesson: Replace Inheritance with Delegation has API impact.
</details>

---

## Bug 7 — Replace Delegation with Inheritance loses isolation (Java)

**Original:**
```java
class Person {
    private final Office office;
    public String getAddress() { return office.getAddress(); }
}
```

**"Refactored":**
```java
class Person extends Office { ... }
// Now Person inherits all of Office's API: setAddress, setHours, etc.
```

<details><summary>Bug</summary>

Person now exposes the whole Office API — `setAddress`, `setHours`, etc. Callers can mutate the office through Person. The original encapsulation is gone.

**Fix:** Don't replace delegation with inheritance unless every Office method is appropriate for Person. Usually delegation is the right answer.
</details>

---

## Bug 8 — Collapse Hierarchy removes useful tagging (Java)

```java
class Identifier {
    protected final String value;
}
class CustomerId extends Identifier {}
class OrderId extends Identifier {}
```

**"Refactored":**
```java
class Identifier { protected final String value; }
// Caller:
public Customer findById(Identifier id) { ... }
```

Caller can now pass an OrderId where a CustomerId was expected.

<details><summary>Bug</summary>

Removing the subclasses lost type-tagging. Compile-time prevention of mix-ups is gone.

**Fix:** Don't collapse value-typed subclass tags. They're load-bearing for type safety.

Better as:
```java
public record CustomerId(String value) {}
public record OrderId(String value) {}
```

No inheritance, but each is its own type. Compile-time enforcement.
</details>

---

## Bug 9 — Extract Subclass introduces wrong polymorphism (Java)

```java
class Order {
    private boolean isExpress;
    public Money shippingCost() { return isExpress ? Money.of(20) : Money.of(5); }
}
```

**"Refactored":**
```java
abstract class Order { public abstract Money shippingCost(); }
class ExpressOrder extends Order { public Money shippingCost() { return Money.of(20); } }
class StandardOrder extends Order { public Money shippingCost() { return Money.of(5); } }
```

But `isExpress` could change at runtime (customer upgrades shipping).

<details><summary>Bug</summary>

Subclass identity is fixed at construction. If `isExpress` changes, you'd need a different object — but the original had one mutable field.

**Fix:** Either guarantee immutability (orders can't change shipping mode), or use State pattern (per [Simplifying Conditionals](../04-simplifying-conditionals/junior.md)) where the state object is swappable.

Lesson: Extract Subclass requires the type to be fixed. Use State for runtime changes.
</details>

---

## Bug 10 — Extract Interface but methods conflict (Java)

```java
class Bird { public String fly() { return "flying"; } }
class Plane { public boolean fly() { return true; } }
```

**"Refactored":**
```java
interface Flyer { ??? fly(); }   // can't have both String and boolean
```

<details><summary>Bug</summary>

The methods looked the same name but had different signatures. Can't unify without changing one.

**Fix:** Either unify (both return same type), or recognize that the methods aren't actually the same operation:

```java
interface Flyer { void fly(); }   // void; both classes adapt
```

Lesson: Extract Interface requires that the methods be genuinely the same protocol.
</details>

---

## Bug 11 — Pull Up Constructor Body breaks finals (Java)

```java
class Engineer extends Employee {
    private final String name;
    public Engineer(String name) { this.name = name; }
}
```

**"Refactored":**
```java
abstract class Employee { protected String name; }   // ❌ no longer final, mutable
class Engineer extends Employee {
    public Engineer(String name) { this.name = name; }   // works but lost immutability
}
```

<details><summary>Bug</summary>

The pulled-up field can't be `final` if subclasses initialize it from their constructors (Java doesn't allow `final` field assignment outside the declaring class's constructor).

**Fix:** Use a parent constructor:
```java
abstract class Employee {
    protected final String name;
    protected Employee(String name) { this.name = name; }
}
class Engineer extends Employee {
    public Engineer(String name) { super(name); }
}
```

Now `name` is `final`, and immutability is preserved.
</details>

---

## Bug 12 — Replace Inheritance with Delegation forgets equals/hashCode (Java)

**Original:**
```java
class Stack<E> extends Vector<E> { /* inherits equals/hashCode */ }
```

**"Refactored":**
```java
class Stack<E> {
    private final Vector<E> data = new Vector<>();
    public void push(E e) { data.add(e); }
}
```

`new Stack<>()` and `new Stack<>()` are not equal even with empty content. Callers using `Set<Stack<?>>` see bugs.

<details><summary>Bug</summary>

The wrapper doesn't override `equals`/`hashCode`. Object identity is now the only equality.

**Fix:**
```java
@Override public boolean equals(Object o) {
    return o instanceof Stack<?> s && s.data.equals(this.data);
}
@Override public int hashCode() { return data.hashCode(); }
```

Lesson: Replace Inheritance with Delegation must port equals/hashCode/toString.
</details>

---

## Patterns

| Bug | Root cause |
|---|---|
| Pulled-up method changes behavior | Methods looked same, weren't |
| Pulled-up field default | Init was per-subclass |
| Push Down breaks interface | Polymorphism abandoned |
| Type erasure on pull-up | Field types differ |
| Final method overridden | Skeleton meant to be fixed |
| Delegation breaks polymorphism | Not is-a anymore |
| Delegation→Inheritance leaks API | Wrapper hiding gone |
| Collapse loses type tagging | Subclasses were value tags |
| Extract Subclass + mutability | Type fixed at construction |
| Extract Interface conflict | Method signatures differ |
| Pull Up Constructor breaks final | Field can't be final mid-hierarchy |
| Delegation drops equals | Object identity not value identity |

---

## Next

- [optimize.md](optimize.md), [tasks.md](tasks.md), [interview.md](interview.md)
