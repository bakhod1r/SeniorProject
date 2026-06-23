# Default Methods and the Diamond Problem — Specification Reading Guide

> Default methods, static interface methods, and private interface methods are governed by **JLS §9.4** (interface bodies), with the resolution algorithm split across **§8.4.8** (overriding/hiding) and **§9.4.1** (inheritance and overriding within interfaces). The feature was proposed in **JEP 126** (Java 8) and extended with `private` interface methods in **JEP 213** (Java 9). The dispatch instruction behind defaults is `invokeinterface`, documented in **JVMS §6.5**. This file maps each capability and constraint back to the spec text that pins it down.

---

## 1. Where to find the canonical text

| Concept                                                                   | Authoritative source                              |
| ------------------------------------------------------------------------- | ------------------------------------------------- |
| Interface declarations, members, modifiers                                | **JLS §9.1** — *Interface Declarations*           |
| Interface methods, `default`, `static`, `private`                         | **JLS §9.4** — *Method Declarations*              |
| Default method definition and rules                                       | **JLS §9.4.3** — *Method Body*                    |
| Inheritance and overriding among interface methods                        | **JLS §9.4.1** — *Inheritance and Overriding*     |
| Overriding from class methods (Rule 1, "classes win")                     | **JLS §8.4.8** — *Inheritance, Overriding, Hiding* |
| Object-method clash with defaults                                         | **JLS §9.4.1.3** — *Requirements in Overriding and Hiding* |
| Maximally specific method (Rule 2, "more specific interface wins")        | **JLS §15.12.2.5** — *Choosing the Most Specific Method* |
| Unrelated conflict (Rule 3, "must override")                              | **JLS §8.4.8.4** — *Inheriting Methods with Override-Equivalent Signatures* |
| `super` syntax for interface defaults                                     | **JLS §15.12.1** — *Compile-Time Step 1: Determine Type to Search* |
| `invokeinterface` bytecode                                                | **JVMS §6.5.invokeinterface**                     |
| `invokevirtual` bytecode (class-method dispatch)                          | **JVMS §6.5.invokevirtual**                       |
| `invokespecial` (for `Interface.super.method()` calls)                    | **JVMS §6.5.invokespecial**                       |
| Binary compatibility of interface changes                                 | **JLS §13.5** — *Evolution of Interfaces*         |
| JEP 126 — Lambda expressions and default methods                          | https://openjdk.org/jeps/126                      |
| JEP 213 — Milling Project Coin (incl. private interface methods, Java 9)  | https://openjdk.org/jeps/213                      |
| Records (relevant for default-shadowing by accessors)                     | **JLS §8.10** — JEP 395                           |
| Sealed types (defaults on sealed interfaces)                              | **JLS §8.1.1.2**, §9.1.1.4 — JEP 409              |

The JLS rules listed in §8.4.8 and §9.4.1 are the *binding* description of Java's resolution algorithm; the "three rules" stated in `junior.md` and `middle.md` are simplifications of those two sections.

---

## 2. JLS §9.4.3 — what a default method actually is

JLS §9.4.3 says: an interface method may be a *default method* if its declaration is preceded by the keyword `default` and the method body is a block (not `;`). The method is implicitly `public`. It is *not* implicitly `abstract`; it inherits a body that subtype classes inherit unless they override.

Key constraints stated in §9.4.3:

- A `default` method may not be `static`, `abstract`, `private`, or `final` (the conjunction is unsatisfiable — `default` is its own modifier).
- A `default` method *must* have a body.
- A `default` method's body is type-checked against the interface's declared signature exactly as a normal method.

Additional constraints from §9.4.1.3 (the "object-method ban"):

> *It is a compile-time error if a default method has the same signature as a non-private method of `java.lang.Object`.*

This is the spec text behind the rule that defaults cannot override `toString`, `equals`, `hashCode`, `getClass`, `notify`, `notifyAll`, `wait`. Even attempting to declare `default int hashCode() { return ...; }` is a compile error.

```java
public interface Named {
    default String toString() { return "named"; }   // §9.4.1.3 — compile error
}
```

The rationale, named explicitly in the JEP 126 design notes: every class already inherits these from `Object` (Rule 1, classes win), so an interface default could never be reached. Forbidding the declaration prevents silent dead code.

---

## 3. JLS §9.4.1 — inheritance among interface methods

§9.4.1 governs which interface methods are *inherited* by a class or another interface. The algorithm is:

1. A method `m` is *inherited* from a direct superinterface `I` if `I` declares `m` and the inheriting type does not declare a method with the same signature.
2. If two direct superinterfaces both contribute a method `m` with the same erased signature, the inheriting type inherits a *single* method — chosen by the *maximally specific* rule.
3. If no method is more specific than the others, the type *must* override `m` or it is a compile error.

JLS §9.4.1.2 defines *more specific*: interface `B`'s method is more specific than `A`'s if `B extends A` (transitively) and both declare the method. This is Rule 2.

§8.4.8 brings in the class side: if any of the type's superclasses declares a method with the same signature, that class method *hides* (for `static`) or *overrides* (for instance) all inherited interface methods. This is Rule 1.

The maximally-specific algorithm in §15.12.2.5 is the formal version of "more specific wins". For interface inheritance specifically:

- Among multiple candidates with the same signature, pick the one declared in the most specific type.
- If there are multiple maximally specific candidates and none is abstract (i.e., all are defaults from unrelated interfaces), it is a compile-time error to leave the method unimplemented.

```java
// JLS §9.4.1 — the worked example the spec implicitly assumes
public interface A { default void m() { } }
public interface B { default void m() { } }
public class C implements A, B { }   // §9.4.1.4 compile error: must override m()
```

The error message produced by `javac` quotes both candidates and the rule directly.

---

## 4. JLS §8.4.8 — Rule 1, "classes win"

§8.4.8 is the *override* rule. A class method overrides any superclass method *and* any interface method with the same erased signature (modulo accessibility). The corollary stated in §8.4.8.4:

> *A class member that overrides or hides one or more methods inherited from a direct superclass or direct superinterface determines, by its own declaration, the body that is invoked.*

Concretely: when method resolution at a call site reaches a class `C`, it walks `C`'s own declared methods first, then its superclass chain, then its superinterfaces. The first match wins. Interface defaults are reached *last* — only when nothing class-side claims the signature.

```java
public class Base {
    public void log(String msg) { System.out.println("[class] " + msg); }
}
public interface Talker {
    default void log(String msg) { System.out.println("[default] " + msg); }
}
public class Child extends Base implements Talker { }

new Child().log("hi");   // "[class] hi" — §8.4.8 says Base.log overrides Talker.log
```

The spec mechanism here is *override-equivalence* — same name and erased signature — combined with the search order. Once `Base.log` is found, the search stops.

---

## 5. JLS §15.12.1 — `Interface.super.method()` syntax

When two interface defaults conflict and the class must override, the implementer can call a specific superinterface's default via `Interface.super.method(args)`. The spec describes this in §15.12.1 ("compile-time step 1: determine type to search"):

> *In `T.super.Identifier(...)`, the qualifying type `T` must be a direct superinterface of the type currently being compiled, and the method invocation refers to the version of `Identifier` declared in `T`.*

Three constraints fall out of this:

- `T` must be a *direct* superinterface of the current type — declared in the `implements` clause. Indirect superinterfaces are not reachable.
- `T` must be a non-class type. `T.super.x()` where `T` is a class is `invokespecial` to the parent class (a different mechanism, used by `super.m()`).
- The compile-time dispatch goes to *exactly* the method declared in `T` — it is not redispatched through subinterfaces.

This is why nested inheritance cannot reach grand-parent defaults without an explicit `implements` declaration:

```java
public interface Vehicle { default String describe() { return "vehicle"; } }
public interface Car extends Vehicle { /* inherits describe */ }
public class Sedan implements Car {
    public String describe() {
        return Vehicle.super.describe();   // §15.12.1: Vehicle is not direct — compile error
    }
}
```

Adding `implements Vehicle` to `Sedan` (even though redundant for type checking) makes the call legal.

---

## 6. JVMS §6.5 — dispatch under the hood

A `default` method is compiled to an ordinary instance method on the interface's class file, with the standard `ACC_PUBLIC` flag (no special "default" flag — the compiler emits an interface method that simply has a body). The dispatch instruction at the call site is normally `invokeinterface`.

```
0: aload_0
1: ldc           #2                 // String "hello"
3: invokeinterface #4, 2            // InterfaceMethod Talker.log:(Ljava/lang/String;)V
```

The JVM resolves the call dynamically: it looks up the actual class of the receiver, walks the resolved method's *itable*, and dispatches to the resolved entry. The itable (interface method table) is built at class-load time to include defaults — so even if the implementor never wrote a body, the itable points back to the interface's default.

`Interface.super.method()` lowers to `invokespecial`, not `invokeinterface`:

```
0: aload_0
1: invokespecial #5                 // InterfaceMethod Walker.describe:()Ljava/lang/String;
```

`invokespecial` dispatches *statically* — exactly the method declared in `Walker`, no re-routing through subinterfaces or implementors. That is what makes `super` chains predictable.

`static` interface methods compile to `invokestatic`:

```
0: invokestatic  #6                 // InterfaceMethod Maths.squareS:(I)I
```

They take no receiver and are resolved purely by name + descriptor on the interface's class file. They are not inherited, exactly because `invokestatic` does not consult the receiver's class.

---

## 7. JLS §13.5 — binary compatibility of interface changes

§13.5 catalogues which interface changes are *binary-compatible* (existing class files keep working without recompilation) and which are not. The relevant entries for defaults:

- **Adding a default method to an interface** — binary-compatible *in isolation*. Existing implementors inherit the new method without recompilation. Existing callers continue to link. Two caveats:
  - If a downstream class implements another interface that already has the same-signature default, the diamond becomes real at link time, producing `IncompatibleClassChangeError` on first invocation (§13.5.3).
  - If the new method is `abstract`, not `default`, it *breaks* existing implementors — `AbstractMethodError` at first invocation on those classes.

- **Changing a method from `abstract` to `default`** — binary-compatible. Implementors that already overrode it continue to work; implementors that hadn't (which means the code didn't compile before) now compile.

- **Changing a method from `default` to `abstract`** — *not* binary-compatible. Implementors that inherited the default now need to override; existing implementors fail to link with `AbstractMethodError`.

- **Removing a `default` method** — *not* binary-compatible. Callers compiled against the old interface emit `invokeinterface` to the missing method, producing `NoSuchMethodError` at runtime.

- **Changing a default's signature** — same severity as renaming. *Not* binary-compatible.

- **Changing only the default body** — binary-compatible *at the JVM level*. Note that this is a contract change semantically — the implementor inherits new behaviour, which may or may not match what they expect. The JVMS is silent on contract, only on linkage.

§13.5.6 specifically calls out that the `default` keyword is *not* recorded in the class file beyond the method's body — so a tool inspecting the class file at runtime sees a normal method with `ACC_PUBLIC` and a `Code` attribute.

---

## 8. JEP 126 — *Lambda expressions and virtual extension methods* (Java 8)

JEP 126 (originally titled "Lambda Expressions for the Java Programming Language") landed both the lambda syntax and *virtual extension methods* — the JEP's name for what we now call default methods. The motivation in the JEP text:

> *The goal is to allow interfaces to evolve in a compatible way, without breaking existing implementations.*

The JEP enumerates four design choices that ended up in the JLS:

1. The new feature is called `default` (not `extension`), to make the intent clear at the declaration site.
2. Defaults are inherited like instance methods, not like static methods.
3. The three-rule resolution algorithm (class wins, more-specific wins, otherwise conflict) is settled to balance simplicity with predictability.
4. Defaults cannot override `Object` methods — the JEP cites both the redundancy (class wins anyway) and the risk of silent shadowing.

The JEP also notes the *binary compatibility* property — adding a default is link-compatible — and lists the seven defaults added to `java.util.Collection` and `java.util.Map` in Java 8: `forEach`, `removeIf`, `spliterator`, `stream`, `parallelStream`, `getOrDefault`, `replaceAll`, `merge`, `putIfAbsent`, `computeIfAbsent`, `computeIfPresent`, `compute`.

JEP 126 is the canonical source for design intent — the JLS sections describe the rules but not the *why*. Read both when designing your own library evolution.

---

## 9. JEP 213 — *Milling Project Coin* (Java 9, private interface methods)

JEP 213 was a small grab-bag of cleanups. One of its deliverables: *private interface methods*. The motivation:

> *Interface methods often need helpers. Since Java 8, all interface methods were implicitly `public`. Private helper methods allow factoring out shared logic from default methods without exposing it as part of the interface's public API.*

Two flavours, both spec'd in §9.4:

- `private` instance method — callable from `default` methods on the same interface.
- `private static` method — callable from `default` and `static` methods on the same interface.

Constraints from §9.4 / §9.4.3:

- A `private` interface method *must* have a body (no abstract `private` methods).
- A `private` interface method is *not* inherited — neither by sub-interfaces nor by implementor classes.
- A `private` interface method may not have a `default` modifier (it's already non-abstract by definition).

```java
public interface NameValidator {
    default boolean isValidFirstName(String s) { return notBlank(s) && allLetters(s); }
    default boolean isValidLastName(String s)  { return notBlank(s) && allLettersOrHyphen(s); }

    private static boolean notBlank(String s) { return s != null && !s.isBlank(); }
    private boolean allLetters(String s) { return s.chars().allMatch(Character::isLetter); }
    private boolean allLettersOrHyphen(String s) {
        return s.chars().allMatch(c -> Character.isLetter(c) || c == '-');
    }
}
```

The bytecode for a `private` interface method is identical to a regular interface method except the `ACC_PRIVATE` flag — callers compile to `invokeinterface` if instance, `invokestatic` if static. The JVM enforces accessibility at link time.

---

## 10. Records, sealed types, and defaults — cross-spec interactions

**Records (JLS §8.10, JEP 395)** implicitly declare a `public` accessor for each component, plus `equals`, `hashCode`, `toString`, and a canonical constructor. The accessor declarations *override* any same-named default in implemented interfaces (Rule 1, classes win). §8.10.3 says explicitly that record accessors satisfy override obligations for matching abstract or default methods.

**Sealed types (JLS §8.1.1.2 / §9.1.1.4, JEP 409)** restrict the implementor set of an interface via `permits`. A sealed interface with defaults is the spec's safest position — the interface author knows every implementor at compile time, so the FBCP risks (`senior.md` §1) are bounded.

**Pattern matching for `switch` (JLS §14.11, JEP 441)** on a sealed type with defaults works as a normal polymorphic dispatch — the default is reached for the type's static type, the override (if any) for the runtime type. No special interaction beyond what `invokeinterface` already does.

---

## 11. Reading list

1. **JLS §9.4** — Interface method declarations. Read §9.4.1 (inheritance), §9.4.3 (default method body and the Object-method ban) carefully.
2. **JLS §8.4.8** — Overriding/hiding. Rule 1 ("classes win") is here.
3. **JLS §15.12.2.5** — Most specific method. Rule 2 ("more specific wins") is here.
4. **JLS §15.12.1** — `T.super.Identifier`. The grammar that makes `Interface.super.method()` legal.
5. **JLS §13.5** — Evolution of interfaces. Binary-compat catalogue.
6. **JVMS §6.5.invokeinterface / invokevirtual / invokespecial / invokestatic** — the four dispatch instructions.
7. **JEP 126** — Lambda expressions and virtual extension methods. The design intent of default methods.
8. **JEP 213** — Milling Project Coin. Private interface methods.
9. **JEP 395** — Records. Relevant for how accessors shadow defaults.
10. **JEP 409** — Sealed classes (final). Relevant for taming default-method risk.
11. **Brian Goetz, "Interface evolution via virtual extension methods"** — the design paper that fed JEP 126.
12. **Maurice Naftalin, *Mastering Lambdas* (McGraw-Hill, 2014)** — the most thorough treatment of default-method interaction with lambdas and resolution rules.
13. **Java Magazine, "Default methods: a deep dive"** (Oracle, 2014) — practical examples covering each of the three resolution rules.

The spec sections do not *teach* default methods — they constrain them. When a coworker says "but my default doesn't override the class method", you cite §8.4.8. When somebody asks "why can't I declare `default String toString()`", you cite §9.4.1.3. When the design team debates "should we add a default or split the interface", JEP 126 has the design notes that say *exactly when* the original authors thought a default was safe. The spec gives you the levers; judgement is yours.
