# Refused Bequest — Senior

> **What?** At the senior level, refused bequest stops being "a code smell" and becomes a *Liskov Substitution Principle (LSP)* problem with a specific shape: the subclass *strengthens preconditions* (it now refuses inputs the parent accepted) or *weakens postconditions* (it no longer guarantees what the parent did). The thrown `UnsupportedOperationException` is just the visible symptom. The deeper question — *what contract does the subtype claim to satisfy?* — is the one that determines whether your inheritance is a lie.
> **How?** When you encounter or design an inheritance pair, ask three questions: (1) what does the parent's contract promise? (2) does the subclass honour *every* clause of that promise? (3) if not, why is this a subclass instead of a separate type? Then apply *Pull Down Method* (move a refused method out of the parent, into the one subclass that wants it) or *Push Down Method* (move a parent method down into the subclasses that actually use it), or sever the inheritance entirely.

---

## 1. The Liskov frame

Barbara Liskov's 1987 substitution rule, rephrased for Java:

> If `S` is a subtype of `T`, then objects of type `T` may be replaced with objects of type `S` *without altering any of the desirable properties of the program*.

"Desirable properties" includes:

- **Method signatures** — Java's compiler enforces this.
- **Precondition strength** — the subtype may *weaken* preconditions (accept more inputs), but not strengthen them (reject inputs the parent accepted).
- **Postcondition strength** — the subtype may *strengthen* postconditions (guarantee more), but not weaken them (deliver less).
- **Invariants** — the subtype must preserve every invariant the parent maintains.
- **History constraint** — the subtype may not allow state changes the parent forbade, and must allow every state change the parent permitted.
- **Exceptions** — the subtype must not throw exceptions the parent didn't (or that aren't covered by the parent's contract).

Refused bequest is a *precondition strengthening* (`add` now requires the list be... what? unobtainable?) combined with *new exceptions* (`UnsupportedOperationException` where the parent had none) and *broken history constraints* (the parent allowed state to grow, the subtype refuses).

In short: refused bequest is LSP violation expressed through an `@Override` and a throw.

---

## 2. The UnsupportedOperationException question

`UnsupportedOperationException` is a unique creature in Java. It is a `RuntimeException`, so it isn't tracked by the compiler. It exists *specifically* to let subclasses refuse inherited bequests. Its Javadoc:

> "Thrown to indicate that the requested operation is not supported."

That sentence is an admission of design failure. If "the requested operation is not supported", why does the class advertise the operation by inheriting it? The answer is always: because the language only offered inheritance, and the developer compromised.

Treat `UnsupportedOperationException` as a code smell *unto itself*. There are exactly two contexts where it is the right answer:

1. **Inside a `Collections.unmodifiable*` view** — a JDK-mandated convention. You can't escape it; you can isolate it.
2. **In a final stub during exploratory development** — `throw new UnsupportedOperationException("TODO");` to make code compile while you wire other parts. This must never reach production.

Outside those two cases, every `UnsupportedOperationException` in your codebase is refused bequest.

---

## 3. The Collections.unmodifiableList trade-off

The JDK's `unmodifiableList` is worth dissecting because it illustrates the cost calculation.

```java
List<String> mutable   = new ArrayList<>(List.of("a", "b"));
List<String> view      = Collections.unmodifiableList(mutable);
view.add("c");                  // throws UnsupportedOperationException
mutable.add("c");
view.size();                    // 3 — the view reflects backing changes
```

Two things are happening:

1. **Type honesty is sacrificed for ergonomics.** The JDK chose to make the view a `List<T>` (rather than a separate `ReadList<T>` type) so callers can pass it to any method that takes a `List`. The price: that method can call `add` and crash. The JDK decided ergonomics-for-callers outweighed type-honesty-for-implementers.
2. **It's a view, not a copy.** Mutations to the original `mutable` list are visible through `view`. This is *necessary* given the choice in (1) — if `view` were a copy, the API would be cleaner, but every call to `unmodifiableList` would be O(n). The JDK chose O(1) wrapping over O(n) copying.

Both choices were defensible in 1998. Both choices baked refused bequest into millions of Java codebases. Modern Java has `List.of(...)` (since 9) which returns a *true* immutable list — but it's still typed as `List<T>` and still throws on mutation. The design debt is permanent.

Lesson: when designing your own libraries, *don't replicate this*. Make immutable types not extend mutable ones. The ergonomic cost is small; the LSP win is real.

---

## 4. Pull Down Method

Fowler's *Pull Down Method* refactoring (sometimes called *Push Down Method* in the opposite direction by other authors — terminology is messy): move a method *out of the parent* into the *one or two* subclasses that actually want it. The subclasses that *don't* want it lose their no-op overrides automatically.

### 4.1 Before

```java
abstract class Employee {
    private String name;
    private BigDecimal salary;

    public BigDecimal commission()    {      // most employees don't have a commission
        return BigDecimal.ZERO;
    }
    public BigDecimal overtimeRate() {       // most employees don't earn overtime
        return BigDecimal.ZERO;
    }
}

class SalariedEmployee extends Employee { }   // both methods are refused (return 0)
class HourlyEmployee   extends Employee {
    @Override public BigDecimal overtimeRate() { return BigDecimal.valueOf(1.5); }
}
class SalesEmployee    extends Employee {
    @Override public BigDecimal commission() { return BigDecimal.valueOf(0.05); }
}
```

The `Employee` base has two methods that *most* employees refuse (silently, by returning zero). Refused bequest in a softer form than throwing — but still refused.

### 4.2 After Pull Down

```java
abstract class Employee {
    private String name;
    private BigDecimal salary;
}

class SalariedEmployee extends Employee { }

class HourlyEmployee extends Employee {
    public BigDecimal overtimeRate() { return BigDecimal.valueOf(1.5); }
}

class SalesEmployee extends Employee {
    public BigDecimal commission() { return BigDecimal.valueOf(0.05); }
}
```

Now `SalariedEmployee` has no refused methods. Callers that need commission take `SalesEmployee`, not `Employee`. The type system carries the information that used to live in "this returns zero".

### 4.3 When this isn't enough

If callers genuinely need to ask any employee "do you earn commission?" — for example, a payroll system that iterates over all employees — Pull Down alone isn't sufficient. The right structure is a *capability interface*:

```java
interface CommissionEarner {
    BigDecimal commission();
}
class SalesEmployee extends Employee implements CommissionEarner {
    public BigDecimal commission() { return BigDecimal.valueOf(0.05); }
}
```

And the payroll code:

```java
BigDecimal total = employees.stream()
    .filter(e -> e instanceof CommissionEarner)
    .map(e -> ((CommissionEarner) e).commission())
    .reduce(BigDecimal.ZERO, BigDecimal::add);
```

Or, more modernly with pattern matching:

```java
BigDecimal total = BigDecimal.ZERO;
for (Employee e : employees) {
    if (e instanceof CommissionEarner ce) {
        total = total.add(ce.commission());
    }
}
```

The capability interface gives you a *type-level test* for "can this employee earn commission?" rather than a runtime "did this method return zero?".

---

## 5. Push Down Method

The mirror move: a parent has a method that *one* subclass refuses. Move the method *down* into the subclasses that want it.

```java
// Before
abstract class Vehicle {
    public void refuel(double litres) { ... }   // EVs refuse: they don't refuel.
}
class GasolineCar extends Vehicle { }
class ElectricCar extends Vehicle {
    @Override public void refuel(double litres) {
        throw new UnsupportedOperationException("electric");
    }
}

// After Push Down
abstract class Vehicle { }
class GasolineCar extends Vehicle {
    public void refuel(double litres) { ... }
}
class ElectricCar extends Vehicle {
    public void charge(double kWh) { ... }
}
```

The shared `Vehicle` parent kept the methods that *all* vehicles have (move, brake, weight, etc.). Energy-input methods went where they belong.

Push Down vs Pull Down: same direction (parent → child), different framing. *Push* emphasises "we moved the parent's method into children"; *Pull* emphasises "we removed the method from the parent". They are the same refactor.

---

## 6. Sealed hierarchies as a Liskov-safe alternative

Java 17's sealed types make some refused-bequest cases trivial to model correctly:

```java
public sealed interface PaymentMethod
        permits CardPayment, BankTransfer, CryptoPayment {
    BigDecimal fee(BigDecimal amount);
}

public record CardPayment(String cardNumber) implements PaymentMethod {
    @Override public BigDecimal fee(BigDecimal amount) { return amount.multiply(new BigDecimal("0.029")); }
}
public record BankTransfer(String iban) implements PaymentMethod {
    @Override public BigDecimal fee(BigDecimal amount) { return new BigDecimal("0.50"); }
}
public record CryptoPayment(String wallet) implements PaymentMethod {
    @Override public BigDecimal fee(BigDecimal amount) { return amount.multiply(new BigDecimal("0.01")); }
}
```

Every subtype implements `fee` — there is no bequest to refuse. Callers can pattern-match exhaustively:

```java
String description(PaymentMethod m) {
    return switch (m) {
        case CardPayment c   -> "Card ending " + c.cardNumber().substring(c.cardNumber().length() - 4);
        case BankTransfer b  -> "Bank " + b.iban();
        case CryptoPayment c -> "Crypto wallet " + c.wallet();
    };
}
```

The compiler enforces that every case is handled. Adding a fourth payment method forces an update to every `switch`. This is OCP and LSP working together — no refused inheritance possible.

---

## 7. A nuanced case: AbstractList

`java.util.AbstractList` is *designed* for refused bequest in a constrained way:

```java
public abstract class AbstractList<E> extends AbstractCollection<E> implements List<E> {
    public boolean add(E e) {
        add(size(), e);
        return true;
    }
    public void add(int index, E element) {
        throw new UnsupportedOperationException();   // refuses by default
    }
    public E set(int index, E element) {
        throw new UnsupportedOperationException();   // refuses by default
    }
    public E remove(int index) {
        throw new UnsupportedOperationException();   // refuses by default
    }
    public abstract E get(int index);                 // mandatory
    public abstract int size();                       // mandatory
}
```

The JDK's intent: *subclasses opt in to mutability by overriding the throwing defaults*. A read-only list overrides only `get` and `size`. A mutable list also overrides `set`, `add(int,E)`, `remove(int)`.

This is refused bequest *as a template method pattern*. It's mostly defensible because:

- The Javadoc on `AbstractList` explicitly tells you what to override for read-only vs modifiable lists.
- Callers using `List<E>` know mutation is allowed only when the contract of the specific subtype permits it (the `List` Javadoc warns that mutation methods are "optional operations").
- The alternative — two separate interfaces `ReadList` and `MutableList` — would force the JDK to break source compatibility.

It is still a smell *in your code* unless you deliberately want to mirror this pattern. And if you do, document it loudly.

---

## 8. Detecting refused bequest in code review

Senior-level signals to spot during review:

1. **Override that throws.** Search regex: `@Override[^{]*\{[^}]*throw new UnsupportedOperationException` — almost always a hit.
2. **Override that returns the type's "zero" without explanation.** `return 0`, `return null`, `return BigDecimal.ZERO`, `return Collections.emptyList()` in a context where the parent's contract suggests a real answer.
3. **Override that silently calls `super` but then does nothing useful.** A subclass override whose body is just `super.foo(x);` is suspicious — why does it exist?
4. **Class-level Javadoc that warns callers off inherited methods.** "Do not call `setEnabled` on instances of this class" means *you've already lost the type war*.
5. **`@Deprecated` overrides without an enclosing `@Deprecated` parent.** The subclass is signalling "stop using what I inherited".
6. **Suppressed warnings on overrides.** `@SuppressWarnings("unused")` on an override often hides a no-op refusal.

---

## 9. Quick rules

- [ ] `UnsupportedOperationException` outside JDK collections views is refused bequest.
- [ ] Strengthening preconditions in a subclass is LSP violation; refusing a method strengthens the precondition to "false".
- [ ] When two subclasses out of three refuse a method, *Pull Down* into the third (or extract a capability interface).
- [ ] When one subclass out of three refuses a method, *Push Down* into the two that want it.
- [ ] Prefer sealed hierarchies + pattern matching over throwing overrides for closed variant sets.
- [ ] Document deliberate template-method refusal (à la `AbstractList`) loudly in Javadoc — assume the reader assumes refused bequest is a bug.

---

## 10. What's next

| Topic                                                              | File              |
| ------------------------------------------------------------------ | ----------------- |
| ArchUnit rules, JDK case studies, legacy migration                 | `professional.md`  |
| Formal NOM metric, PMD/SonarJava rules                             | `specification.md` |
| Numbered diagnosis scenarios                                       | `find-bug.md`      |
| JIT inlining, vtable bloat                                         | `optimize.md`      |
| Exercises                                                          | `tasks.md`         |
| Interview Q&A                                                      | `interview.md`     |

Related principles:

| Topic                          | Path                                                          |
| ------------------------------ | ------------------------------------------------------------- |
| Liskov Substitution Principle  | `../../03-design-principles/01-solid-principles/`              |
| Fragile Base Class             | `../../03-design-principles/05-fragile-base-class/`            |
| Composition over Inheritance   | `../../03-design-principles/02-composition-over-inheritance/`  |

---

**Memorize this:** Refused bequest is LSP violation expressed as an override. Every `UnsupportedOperationException` in `@Override` is a subclass strengthening preconditions to "false" and adding an exception the parent's contract didn't promise. The senior moves are *Pull Down* (remove the refused method from the parent so refusing subclasses no longer need to refuse) and *Push Down* (move parent methods to the subclasses that want them). When the variant set is fixed and closed, sealed hierarchies + pattern matching let you avoid the inheritance question entirely.
