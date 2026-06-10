# Refused Bequest — Professional Level

At the professional level, refused bequest is not a curiosity you spot in a code review — it is **inheritance debt** that the team has been paying interest on for years. Your job is to find it programmatically, quantify it, and migrate away from it without breaking the world.

This document covers:

1. Automated detection with ArchUnit and static analyzers.
2. Real refused-bequest cases in the JDK itself.
3. A migration playbook for legacy inheritance debt.
4. Quick rules and a checklist.

## 1. Why "professional" means "automated"

Junior engineers find refused bequest by reading code. Senior engineers find it during reviews. **Professional engineers find it before the commit lands** — through CI gates, ArchUnit tests, and metric thresholds.

The reason is simple: every refused bequest is a future LSP bug waiting to be triggered by a polymorphic caller who trusted the supertype. The cost of detection grows linearly with the number of downstream callers, so you want to catch it on the day it's introduced.

## 2. The smell in the JDK itself

The JDK is the canonical case study, partly because it was written before generics, partly because backward compatibility froze early mistakes.

### Stack extends Vector

```java
public class Stack<E> extends Vector<E> {
    public E push(E item) { addElement(item); return item; }
    public synchronized E pop() { /* ... */ }
    public synchronized E peek() { /* ... */ }
}
```

`Stack` inherits **every** method of `Vector` — `add(int, E)`, `insertElementAt`, `get(int)`, `set(int, E)`, `remove(int)`. A LIFO stack has no business exposing random-access mutation. Stack doesn't `throw` on these methods; it simply leaves them open, which is arguably worse: callers can corrupt the stack invariant silently.

Joshua Bloch openly recommends using `Deque` instead in *Effective Java*. The fix that the JDK could not apply is exactly the playbook in section 4 below — extract an interface (`Deque`), provide a fresh implementation (`ArrayDeque`), and deprecate the inheritance.

### Properties extends Hashtable<Object, Object>

```java
public class Properties extends Hashtable<Object, Object> {
    public synchronized Object setProperty(String key, String value) { ... }
    public String getProperty(String key) { ... }
}
```

`Properties` is documented to hold `String -> String` only, yet it inherits `put(Object, Object)` from `Hashtable`. The class **refuses the type contract** of its parent — `put(42, new Date())` compiles and runs, then explodes when something calls `store(...)` and tries to write a `Date` to a `.properties` file.

This is refused bequest at the type level: the subtype quietly narrows what is acceptable but cannot remove the inherited method.

### Other JDK examples worth knowing

- `Collections.unmodifiableList(...)` returns a `List` that throws `UnsupportedOperationException` on `add`, `remove`, `set`, `clear`. Every mutator method is refused.
- `Arrays.asList(...)` returns a fixed-size list that refuses `add` and `remove` but accepts `set`. It refuses *part* of the bequest.
- `Collections.emptyList()` refuses every mutator.
- `AbstractList.add(E)` throws `UnsupportedOperationException` by default — explicitly inviting refused bequest in subclasses.

## 3. Detection — ArchUnit rules

ArchUnit lets you encode design rules as JUnit tests. Three rules catch the majority of refused bequests in production code.

### Rule 1 — Production code must not throw UnsupportedOperationException

```java
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchRule;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;

@AnalyzeClasses(packages = "com.example.domain")
class RefusedBequestRules {

    @ArchTest
    static final ArchRule no_unsupported_operation_in_domain =
        noClasses()
            .should()
            .accessClassesThat()
            .areAssignableTo(UnsupportedOperationException.class)
            .because("Throwing UnsupportedOperationException in production domain " +
                     "code is a refused bequest — prefer composition over inheritance.");
}
```

You whitelist test fixtures and immutable-collection factories, but the domain layer must be free of refused bequests.

### Rule 2 — No empty overrides

```java
@ArchTest
static final ArchRule no_empty_overrides =
    methods()
        .that().areDeclaredInClassesThat().resideInAPackage("..domain..")
        .and().areAnnotatedWith(Override.class)
        .should(new ArchCondition<JavaMethod>("not have empty body") {
            @Override
            public void check(JavaMethod m, ConditionEvents events) {
                if (m.getMethodCallsFromSelf().isEmpty()
                    && m.getFieldAccessesFromSelf().isEmpty()
                    && !m.getRawReturnType().getName().equals("void")) {
                    events.add(SimpleConditionEvent.violated(m,
                        m.getFullName() + " is an empty override (refused bequest)"));
                }
            }
        });
```

### Rule 3 — Subclasses must use a configurable percentage of inherited API

This rule requires you to compute the **NORM** (Number of Refused Methods) ratio. We'll define it in `specification.md`; here is the enforcement:

```java
@ArchTest
static final ArchRule subclasses_must_use_parent =
    classes()
        .that().areNotInterfaces()
        .and().areNotAnnotations()
        .should(new UsesAtLeastHalfOfParentApi());
```

### PMD and SonarJava rules

- **SonarJava `S1185`** — "Overriding methods should do more than simply call the same method in the super class." Catches refused bequest of the form `@Override void foo() { super.foo(); }`.
- **SonarJava `S1186`** — "Methods should not be empty."
- **PMD `EmptyMethodInAbstractClassShouldBeAbstract`** — empty methods in abstract classes are usually a refused bequest waiting to happen.
- **PMD `UnusedFormalParameter`** combined with empty body — strong signal.
- **SonarJava `S2386`** — "Mutable fields should not be public static" (often surfaces refused immutability contracts).

## 4. Migration playbook — legacy inheritance debt

You inherit a 200K-line codebase. `PaymentMethod` is extended by 14 subclasses, three of which throw `UnsupportedOperationException` on `refund()`. You cannot delete the parent. Here is the playbook.

### Step 1 — Inventory

Use a script to list every method that throws `UnsupportedOperationException` or has an empty body across the hierarchy. Map the call graph: which callers depend on which inherited methods?

### Step 2 — Extract the honest interface

For each refused method, ask: "Is the subclass refusing because it shouldn't have this responsibility?" If yes, the bequest itself is wrong.

```java
// Before
abstract class PaymentMethod {
    abstract void charge(Money m);
    abstract void refund(Money m);     // GiftCard refuses this
    abstract void preAuthorize(Money m); // Cash refuses this
}

// After — split the bequest along refusal lines
interface Chargeable      { void charge(Money m); }
interface Refundable      { void refund(Money m); }
interface PreAuthorizable { void preAuthorize(Money m); }

class CreditCard implements Chargeable, Refundable, PreAuthorizable { ... }
class Cash       implements Chargeable, Refundable { ... }
class GiftCard   implements Chargeable { ... }
```

Each class now implements **only** what it honors. Refusal disappears because there is nothing to refuse.

### Step 3 — Introduce composition where behavior is shared

If subclasses shared real behavior (not just signatures), extract it into a collaborator and inject it:

```java
class CreditCard implements Chargeable, Refundable {
    private final PaymentGateway gateway;
    private final RefundPolicy policy;
    // delegate, don't inherit
}
```

### Step 4 — Migrate callers incrementally with a Strangler Fig

You cannot do this in one pull request. Use the Strangler Fig pattern:

1. Introduce the new interfaces alongside the old base class.
2. Make the old base class implement the new interfaces (adapter layer).
3. Migrate callers one by one to depend on `Chargeable` instead of `PaymentMethod`.
4. Once all callers are migrated, remove the old base class.

### Step 5 — Add ArchUnit guards before deletion

Before deleting the legacy class, add an ArchUnit rule:

```java
@ArchTest
static final ArchRule no_one_extends_payment_method =
    noClasses().should().beAssignableTo(PaymentMethod.class)
        .because("PaymentMethod is deprecated. Use Chargeable / Refundable.");
```

This makes the migration **monotonic** — no one can re-introduce the debt.

### Step 6 — Use `@Deprecated(forRemoval = true)` and JDK 17's sealed types

```java
@Deprecated(forRemoval = true, since = "v4.2")
public abstract class PaymentMethod { ... }
```

If you cannot delete yet, seal the hierarchy so no new subclasses can be added:

```java
public sealed abstract class PaymentMethod
    permits CreditCard, Cash, GiftCard { ... }
```

Sealing is a powerful guard against further refused-bequest debt in the same family.

## 5. Quick rules

1. **Run ArchUnit in CI.** Refused bequest detection that lives on someone's laptop is not detection.
2. **Treat every `throw new UnsupportedOperationException()` in domain code as a bug ticket**, not a design choice.
3. **Inherited mutators on immutable types are non-negotiable refused bequests.** Use `List.copyOf(...)` and return interface types, never the mutable subtype.
4. **Sealed hierarchies first, open inheritance second.** If you must inherit, restrict the permitted set.
5. **Migrate by extracting interfaces, then composing**, never by deleting the parent class first.
6. **No PRs that increase NORM**, only PRs that decrease it.
7. **JDK precedent is not blanket permission.** `Stack extends Vector` is a known mistake; don't cite it as justification.
8. **Document refusals you cannot fix.** If a third-party API forces you into a refused bequest, write a comment explaining why and a ticket for the day the constraint lifts.

## Checklist

- [ ] ArchUnit rule blocks `UnsupportedOperationException` in production packages
- [ ] SonarJava `S1185` and `S1186` are enabled and not suppressed
- [ ] Every subclass uses at least 50% of its parent's API (NORM ≤ 0.5)
- [ ] No abstract class has an `@Override` method whose body is empty or only `super.foo()`
- [ ] Mutable subtypes do not extend immutable supertypes, and vice versa
- [ ] Inheritance is sealed or final unless `extends` is explicitly part of the API
- [ ] Each refused bequest in legacy code has a deprecation date

## What's next

Refused bequest is the surface symptom; the disease underneath has a name and a fix.

- **Fragile Base Class Problem** — when changes in the parent break subclasses you don't even own. Refused bequest is the warning sign that you're already exposed.
- **Liskov Substitution Principle (LSP)** — the formal rule that refused bequest violates. Every refused method is a witness that the subtype is not substitutable for the supertype.
- **Composition Over Inheritance** — the structural fix. The next file in your roadmap shows you how to design new hierarchies so refused bequest never appears in the first place.

Read them in that order: diagnosis (fragile base class) → principle (LSP) → cure (composition).

## Memorize this

> Refused bequest is **inheritance debt with compound interest**. The professional move is not to argue about whether it is acceptable — it is to gate it at the CI boundary, quantify it with NORM, and pay it down through extracted interfaces and composition. Every `UnsupportedOperationException` in domain code is a payment you forgot to make.
