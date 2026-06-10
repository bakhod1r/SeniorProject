# Inheritance — Specification Deep-Dive

> Where the rules live: **JLS §4.10** (subtyping), **JLS §8.1.4** (`extends`), **JLS §8.4.8** (inheritance / overriding), **JLS §9.4.1** (interface default methods), **JLS §15.12** (method invocation), **JVMS §5** (loading/linking), **JVMS §6.5** (`invoke*` opcodes), **JEP 409 / JLS §8.1.1.2** (sealed classes).

---

## 1. Where to find canonical text

| Concept                                 | Authoritative source              |
|-----------------------------------------|-----------------------------------|
| `extends` clause syntax                 | JLS §8.1.4                        |
| Inheritance of members                  | JLS §8.2, §8.4.8                  |
| Override-equivalent signature           | JLS §8.4.2                        |
| Override compatibility (return, throws) | JLS §8.4.8.3, §8.4.8.4            |
| Subtype relation                        | JLS §4.10                         |
| Generics and erasure                    | JLS §4.6                          |
| Pattern matching for instanceof          | JLS §14.30, §15.20.2              |
| Sealed classes                          | JLS §8.1.1.2                      |
| Default methods                         | JLS §9.4                          |
| Method invocation expressions           | JLS §15.12                        |
| Class loading / linking                 | JVMS §5                           |
| `invokevirtual`/`invokespecial`/`invokeinterface` | JVMS §6.5                |
| `PermittedSubclasses` attribute         | JVMS §4.7.31                      |
| Class file `super_class` field          | JVMS §4.1                         |

---

## 2. JLS §8.1.4 — superclasses and subclasses

> The optional `extends` clause in a normal class declaration specifies the direct superclass of the current class.

```java
class Subclass extends Superclass { /* ... */ }
```

Restrictions:
- `Superclass` must denote a non-final class.
- It must be accessible.
- Cannot be `Subclass` itself or any subclass of `Subclass` (no cycles).
- If sealed, `Subclass` must be in the `permits` list.

The superclass relation is single (a class has exactly one direct superclass; `Object`'s direct superclass is undefined / nothing).

---

## 3. JLS §8.2 — what gets inherited

> A class C inherits from its direct superclass and direct superinterfaces all abstract and default methods (§9.4) of those types that are visible to it (§6.6) and not overridden (§8.4.8.1) by methods declared in C.

> A class C inherits all the non-private fields of its direct superclass that are accessible to C.

Note the access-based inheritance rule: a `private` field exists in the parent's object layout but is not inherited (i.e., not visible by simple name in the subclass).

Constructors are *never* inherited (§8.8.7).

---

## 4. JLS §8.4.2 — override-equivalent signatures

Two methods have **override-equivalent signatures** if either:
- They have the same name, same number of parameters, and same parameter types after erasure, **or**
- One method's signature is a *subsignature* of the other's (after type-parameter substitution).

This is the basis for what counts as overriding vs overloading.

```java
class A<T> { void m(T x) { } }
class B extends A<String> { @Override void m(String x) { } }   // override-equivalent post-erasure
```

---

## 5. JLS §8.4.8.3 — covariant return types

The override's return type must be:
- The same type as the parent's, or
- A subtype of the parent's (covariant), or
- A primitive type identical to the parent's primitive return.

```java
class A { Number n() { return 0; } }
class B extends A { @Override Integer n() { return 1; } }   // OK
```

The compiler synthesizes a bridge method on `B` with signature `Number n()` that delegates to the actual override, ensuring binary compatibility.

---

## 6. JLS §8.4.8.4 — exception narrowing

The override may throw fewer or more specific checked exceptions than the parent declares. It cannot introduce new checked exceptions not declared by the parent.

```java
class A { void m() throws IOException { } }
class B extends A {
    @Override void m() throws FileNotFoundException { }   // OK — narrower
    @Override void m() throws Exception { }               // ERROR — wider
}
```

Unchecked exceptions (subtypes of `RuntimeException` or `Error`) can always be thrown by overrides regardless of the parent.

---

## 7. JLS §8.4.8.1 — when one method overrides another

A method `m1` declared in class `C` overrides a method `m2` declared in class `A` (or interface `A`) iff:

1. `C` is a subclass of `A`.
2. `m1`'s signature is a subsignature of `m2`'s.
3. `m1` is not `private`.
4. Either `m2` is accessible from `C`, or there's a method `m3` such that `m1` overrides `m3` and `m3` overrides `m2`.

The last clause covers transitive overriding through intermediate classes.

---

## 8. JLS §4.10 — the subtype relation

The **subtype** relation is reflexive and transitive. Direct subtype rules:

- For a class type `C` with direct superclass `D` and direct superinterfaces `I1, ..., In`: `D` and each `Ik` are direct supertypes of `C`.
- For an interface `I` with direct superinterfaces `J1, ..., Jn`: each `Jk` is a direct supertype of `I`.
- `Object` is the direct supertype of every interface that has no other superinterface.
- `null` is a subtype of every reference type.
- Array covariance: if `S` is a subtype of `T`, then `S[]` is a subtype of `T[]`. (Generics: invariance — see below.)

Generics use *invariance* by default: `List<String>` is **not** a subtype of `List<Object>`. Wildcards introduce variance:
- `List<? extends T>` — covariant in `T`
- `List<? super T>` — contravariant in `T`
- `List<?>` — equivalent to `List<? extends Object>`

---

## 9. JLS §9.4.1 — default method resolution

When a class implements multiple interfaces with conflicting default methods:

> If a class inherits methods with the same signature from multiple supertypes, the resolution depends on whether one is from a superclass and the other from an interface (class wins), or both from interfaces (the more specific interface wins; if incomparable, the class must override).

```java
interface Walker { default void move() { System.out.println("walk"); } }
interface Swimmer { default void move() { System.out.println("swim"); } }

class Penguin implements Walker, Swimmer {
    @Override
    public void move() {            // required — must disambiguate
        Walker.super.move();         // explicit selection
    }
}
```

Failing to override produces a compile error.

---

## 10. JLS §15.12 — method invocation expressions

The method invocation expression `e.m(args)` is resolved in three steps (§15.12.2):

1. **Identify the type to search.** The compile-time type of the receiver `e`.
2. **Identify candidate methods.** All accessible methods of that type with name `m`.
3. **Determine the most specific method.** Three phases (strict → loose → variable-arity), as described in JLS §15.12.2.5.

Once resolved, the bytecode emits `invokevirtual`/`invokeinterface`/`invokestatic` with a symbolic reference to the chosen method. Runtime dispatch is then governed by the JVMS.

---

## 11. JVMS §5.4.5 — vtable construction

Method tables are built during *preparation*:

> For each non-private, non-static method m declared in C, set m's vtable index. If m overrides a method m' inherited from a superclass, m takes m''s vtable slot. Otherwise, m gets a new slot.

Subtle: `private` and `static` methods do **not** participate in the vtable. They use `invokespecial` and `invokestatic` respectively, which are direct calls.

---

## 12. JVMS §6.5.invokevirtual — the dispatch algorithm

```
1. The objectref must be of type reference, not null.
2. Resolve the method symbolic reference (§5.4.3.3).
3. Let C be the class of objectref.
4. Search C and superclasses for a method matching the resolved method's
   name and descriptor that is accessible and not abstract.
5. Invoke that method.
```

The "search" is implemented as a vtable lookup in HotSpot — the symbolic reference's vtable index is precomputed during resolution.

If no method is found (could happen with `abstract`), `AbstractMethodError`.

---

## 13. JLS §8.1.1.2 — sealed classes

> A sealed class has a `permits` clause listing the classes/interfaces directly extending it.

Rules:
- Each permitted subclass must be in the same module as the sealed class (or in the same package, for unnamed modules).
- Each permitted subclass must declare itself as `final`, `sealed`, or `non-sealed`.
- The compiler emits a `PermittedSubclasses` attribute (JVMS §4.7.31).

The verifier rejects a class whose superclass is sealed but is not listed in its `PermittedSubclasses`. This makes the hierarchy *closed*.

---

## 14. JEP 441 — pattern matching for switch (Java 21)

Patterns over sealed types let the compiler verify exhaustiveness:

```java
sealed interface Shape permits Circle, Square { }
double area(Shape s) {
    return switch (s) {
        case Circle c -> Math.PI * c.r() * c.r();
        case Square sq -> sq.side() * sq.side();
    };   // exhaustive — no default needed
}
```

If you add a new permitted subclass `Triangle`, all `switch`es over `Shape` become non-exhaustive — compile error. This forces you to handle the new case everywhere.

---

## 15. JEP 482 — flexible constructor bodies (Java 22 preview)

Historically, `super(...)` had to be the first statement of a constructor. JEP 482 relaxes this to allow a *prologue* of statements that don't reference `this`:

```java
class Base { Base(int x) { /* ... */ } }
class Derived extends Base {
    Derived(int x) {
        if (x < 0) throw new IllegalArgumentException();   // ok pre-super
        super(x);
    }
}
```

This makes constructor logic less awkward when validation depends on arguments. Useful in records too.

---

## 16. JLS rules summary table

| Rule                                  | Source            |
|---------------------------------------|-------------------|
| Single class inheritance              | JLS §8.1.4        |
| Multiple interface implementation     | JLS §8.1.5        |
| Field hiding                          | JLS §8.3.1.1, §15.11 |
| Static method hiding                  | JLS §8.4.8.2      |
| Instance method overriding            | JLS §8.4.8.1      |
| Constructor non-inheritance           | JLS §8.8.7        |
| Final class/method                    | JLS §8.1.1.2 (final), §8.4.3.3 |
| Abstract class/method                 | JLS §8.1.1.1, §8.4.3.1 |
| Sealed class                          | JLS §8.1.1.2 (sealed) |

---

## 17. Reading order for spec depth

1. JLS §4.10 (subtype relation)
2. JLS §8.1.4 (extends)
3. JLS §8.2, §8.4.8 (inheritance, overriding)
4. JLS §8.4.2 (override-equivalent signatures)
5. JLS §15.12 (method invocation)
6. JLS §9.4 (interface methods)
7. JLS §8.1.1.2 (sealed classes)
8. JVMS §5 (loading/linking)
9. JVMS §6.5 invokevirtual/invokespecial/invokeinterface
10. JVMS §4.7.31 (PermittedSubclasses attribute)

---

**Memorize this**: The JLS defines what *can* be inherited and overridden; the JVMS defines what the runtime *does* when you call a method. Subtyping is invariant for generics, covariant for arrays, and reflexive/transitive everywhere. Sealed types add closure to the hierarchy and exhaustiveness to pattern matching.
