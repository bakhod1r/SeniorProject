# Encapsulation — Specification Deep-Dive

> Where the rules live: **JLS §6.6** (access control), **JLS §8.10** (records), **JLS §8.1.1.2** (sealed classes), **JLS §17.5** (final fields), **JLS §7.7** (modules), **JVMS §4.1/§4.5/§4.6** (class file access flags), **JVMS §4.10.1.6** (verifier), **JVMS §5.4.4** (linker access), **JEP 181** (nestmates).

---

## 1. Where canonical text lives

| Concept                         | Source                |
|---------------------------------|-----------------------|
| Access modifiers                | JLS §6.6              |
| Default access                  | JLS §6.6.1            |
| `protected` rules               | JLS §6.6.2            |
| Records                         | JLS §8.10             |
| Sealed classes                  | JLS §8.1.1.2          |
| Final fields, freeze action     | JLS §17.5             |
| Module declarations             | JLS §7.7              |
| Class file access flags         | JVMS §4.1, §4.5, §4.6 |
| Verifier (access)               | JVMS §4.10.1.6        |
| Linker (access)                 | JVMS §5.4.4           |
| Nestmates                       | JEP 181 (Java 11)     |
| Module access enforcement       | JEP 261 (Java 9)      |

---

## 2. JLS §6.6 — accessibility

> A reference type, member, or constructor of a reference type is accessible only if the type is accessible and the member or constructor is declared to permit access.

The four modifiers:
- `public` — accessible everywhere the type is accessible
- `protected` — accessible from same package, plus subclasses (with restrictions)
- (default) — accessible only from the same package
- `private` — accessible only from the same top-level class (and nestmates)

A class itself can be `public` or default (package-private). Inner classes can also be `protected` or `private`.

---

## 3. JLS §6.6.2 — protected access

The famous "protected access via subclass-typed reference" rule:

> Let `C` be the class in which a `protected` member is declared. Access is permitted only within the body of a subclass `S` of `C`. In addition, if `Id` denotes an instance field or instance method, then:
> - If the access is by a qualified name `Q.Id`, where `Q` is an `ExpressionName`, then the access is permitted if and only if the type of the expression `Q` is `S` or a subclass of `S`.

In short: `protected` lets you access via `this`, but not via an arbitrary `C`-typed reference. Surprises beginners.

```java
package alpha;
public class C { protected int x; }

package beta;
public class S extends C {
    void m(C other) { other.x = 1; }    // ERROR — other not S-typed
    void n(S other) { other.x = 1; }    // OK
}
```

---

## 4. JLS §8.10 — records

> A record class declaration declares a class with a header that lists components. The class is implicitly final and extends java.lang.Record. The components are the canonical state of the record, and accessor methods are automatically generated.

Mandates:
- Implicitly `final` (cannot be extended)
- Implicitly extends `Record`
- Accessors auto-generated (one per component)
- Canonical constructor auto-generated (or compact form)
- `equals`, `hashCode`, `toString` auto-generated based on components

Programmer can override any of the auto-generated members. Compact constructors validate but cannot reassign components after the implicit `this.x = x` assignments.

---

## 5. JLS §8.1.1.2 — sealed classes

> A sealed class restricts which classes may directly extend it. The permits clause lists the directly extending classes/interfaces. Each permitted class must be `final`, `sealed`, or `non-sealed`.

Encapsulation aspect: the hierarchy is closed. External code cannot introduce variants, preserving invariants of the sealed type.

JVMS §4.7.31 — the `PermittedSubclasses` attribute makes this enforceable at the bytecode level.

---

## 6. JLS §17.5 — final field semantics

> A thread that can only see a reference to an object after that object has been completely initialized is guaranteed to see the correctly initialized values for that object's final fields.

This gives `final` fields safe publication. A class with all final fields, no leaking `this`, is thread-safe for unsynchronized sharing.

This is the technical backbone of immutable encapsulation.

---

## 7. JLS §7.7 — modules

A module declaration:
```java
module com.example {
    requires com.other;
    exports com.example.api;
    opens com.example.entity to com.fasterxml.jackson;
}
```

- `exports` — package is accessible from any module that requires this one
- `exports ... to` — only specified modules see it
- `opens` — package is open for reflection (deep access) but not for code dependency
- `opens ... to` — restricted to specified modules

`exports` and `opens` together gives full access. `exports` alone allows compilation but blocks reflection. `opens` alone allows reflection but blocks compile-time dependency.

---

## 8. Verifier access checks (JVMS §4.10.1.6)

The verifier ensures bytecode does not violate access rules at runtime:

- `getfield`/`putfield` instructions check access against the declared field's class and modifiers.
- `invokevirtual`/`invokespecial`/`invokeinterface`/`invokestatic` check method access.
- `new` checks the target class is accessible.

Failure → `IllegalAccessError` at class link time.

---

## 9. Linker access checks (JVMS §5.4.4)

When the JVM resolves a symbolic reference:
- It locates the target class/method/field
- It checks access modifiers
- It throws `IllegalAccessError` if access is denied

Reflection (`Field.get`, `Method.invoke`) performs the same check at runtime, throwing `IllegalAccessException` (a checked exception). `setAccessible(true)` skips the check, but JPMS adds another layer (`InaccessibleObjectException`).

---

## 10. JEP 181 — nestmate access (Java 11)

A *nest* is a logical group of classes that share a single source file (top-level + nested classes). Members of the same nest can access each other's private members directly via the JVM's `NestHost` and `NestMembers` attributes.

Pre-Java 11: synthetic bridge methods. Post-Java 11: direct access.

This is purely a runtime simplification; doesn't change source-level semantics.

---

## 11. JEP 261 — module system (Java 9)

Defined modules as first-class entities. A module is a named collection of packages. The runtime enforces module boundaries during class resolution and reflection.

Provides:
- Strong encapsulation of internal packages
- Explicit declared dependencies
- Improved security (no accidental access to JDK internals)

The JDK itself is split into ~80 modules, each strongly encapsulated.

---

## 12. JLS §15.13 / §15.27 — method references and lambdas

Lambdas can access private members of enclosing class:

```java
class Outer {
    private int x;
    Runnable r = () -> System.out.println(x);   // lambda accesses private x
}
```

The lambda's hidden class is generated as a nestmate of `Outer`, allowing direct access. The bytecode performs `getfield Outer.x` directly.

---

## 13. Reflection access semantics

`Class.getDeclaredField(String)` returns a `Field` regardless of access. `Field.get(instance)` checks access at *call time*:

```java
Field f = User.class.getDeclaredField("password");
f.setAccessible(true);   // ask for access (may throw with JPMS)
Object value = f.get(user);
```

`setAccessible(true)` raises `InaccessibleObjectException` if JPMS forbids it. The flag, once set, allows future access on this Field instance.

Frameworks routinely use this; `--add-opens` flags allow legacy code to keep working.

---

## 14. The "package" notion in JPMS

In JPMS, packages span at most one module. A package cannot be shared between modules. This is a strong rule: if `com.example.X` is in module A, it cannot also be in module B.

Result: package access (default modifier) effectively equals "same module + same package."

---

## 15. Reading order

1. JLS §6.6 — access modifiers
2. JLS §6.6.2 — protected rules
3. JLS §8.10 — records
4. JLS §8.1.1.2 — sealed classes
5. JLS §17.5 — final field semantics
6. JLS §7.7 — modules
7. JVMS §4.5, §4.6 — class file (field/method flags)
8. JVMS §4.7.31 — PermittedSubclasses
9. JVMS §4.10 — verifier
10. JVMS §5.4.4 — linker access checks
11. JEP 181 — nestmates
12. JEP 261 — modules

---

**Memorize this**: encapsulation is enforced at three levels: the compiler (`javac` rejects illegal access), the verifier (bytecode-level checks), and the linker/runtime (`IllegalAccessError`). JPMS adds module-level enforcement on top. Records, sealed types, and modules are the modern Java tools to express encapsulation declaratively. The spec is precise; read it when access surprises you.
