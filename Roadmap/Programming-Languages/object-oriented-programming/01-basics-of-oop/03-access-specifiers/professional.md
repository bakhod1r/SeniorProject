# Access Specifiers — Professional (Under the Hood)

> **What's actually happening?** Access flags are 16-bit fields (`access_flags`) in `ClassFile`, `field_info`, `method_info`, `nested_class_info`. The compiler enforces them at compile time; the JVM verifier rechecks them at link time and again at access time. Modules add a runtime layer above bytecode access flags. Nest mates (Java 11+) eliminated the synthetic-bridge tax that pre-11 inner classes used to pay for cross-class private access. Reflection's `setAccessible(true)` flips an internal flag that the runtime consults — but JPMS's `opens` keyword now constrains it.

---

## 1. Where access flags live in the class file

Three places, all in JVMS §4 (class file format):

| Location                  | Where                       | Flags applicable                                |
|---------------------------|-----------------------------|-------------------------------------------------|
| **Top-level class**       | `ClassFile.access_flags`    | `PUBLIC`, `FINAL`, `SUPER`, `INTERFACE`, `ABSTRACT`, `SYNTHETIC`, `ANNOTATION`, `ENUM`, `MODULE` |
| **Field**                 | `field_info.access_flags`   | `PUBLIC`, `PRIVATE`, `PROTECTED`, `STATIC`, `FINAL`, `VOLATILE`, `TRANSIENT`, `SYNTHETIC`, `ENUM` |
| **Method**                | `method_info.access_flags`  | `PUBLIC`, `PRIVATE`, `PROTECTED`, `STATIC`, `FINAL`, `SYNCHRONIZED`, `BRIDGE`, `VARARGS`, `NATIVE`, `ABSTRACT`, `STRICT`, `SYNTHETIC` |
| **Inner class entry**     | `InnerClasses` attribute    | The visibility of *nested* classes specifically |

For a top-level class, `private` and `protected` are illegal — there's no enclosing scope to be private *to*. The class file flag set reflects this.

The bit values (JVMS §4.1, §4.5, §4.6):

```
ACC_PUBLIC      = 0x0001
ACC_PRIVATE     = 0x0002
ACC_PROTECTED   = 0x0004
ACC_STATIC      = 0x0008
ACC_FINAL       = 0x0010
ACC_SYNCHRONIZED= 0x0020
ACC_VOLATILE    = 0x0040
ACC_BRIDGE      = 0x0040  (methods only — same bit reused)
ACC_TRANSIENT   = 0x0080
ACC_VARARGS     = 0x0080
ACC_NATIVE      = 0x0100
ACC_INTERFACE   = 0x0200
ACC_ABSTRACT    = 0x0400
ACC_STRICT      = 0x0800
ACC_SYNTHETIC   = 0x1000
ACC_ANNOTATION  = 0x2000
ACC_ENUM        = 0x4000
ACC_MODULE      = 0x8000  (top-level only)
```

The "package-private" level has **no flag** — it's the absence of `PUBLIC`/`PRIVATE`/`PROTECTED`.

You can see it all with `javap -v -p MyClass.class` or programmatically via `Class.getModifiers()` and `java.lang.reflect.Modifier`.

---

## 2. JVMS §5.4.4 — Access checking at link time

When the JVM resolves a `Methodref` or `Fieldref`, it performs an access check:

1. Identify the *referencing* class `D` (the class doing the access).
2. Identify the *referenced* class `C` and the *member* `m` (with `m`'s access flags).
3. Check accessibility per the rules:
   - `m` is `public` and `C` is accessible from `D` → ✓.
   - `m` is `protected`: ✓ if `D` is in the same package as `C`, or `D` is a subclass of `C` and (for instance access) the receiver is of type `D` or its subclass.
   - `m` is package-private: ✓ if `D` and `C` are in the same runtime package.
   - `m` is `private`: ✓ if `D` and `C` are in the same nest (Java 11+) or `D == C` (pre-11).

If any check fails, the JVM throws `IllegalAccessError` at link time (or `IllegalAccessException` for reflective access).

This is **runtime** enforcement — even if you bypass `javac` (e.g., by writing class files directly with ASM), the JVM's verifier and resolver still enforce access.

---

## 3. Same-class private — *one* class is one class

`private` access is per-class, not per-instance. The JVM determines "same class" by:

- Same fully-qualified name *and* same defining class loader.

This means **two classes loaded by different class loaders are different runtime classes**, even with the same name. They cannot access each other's privates. This is how application servers prevent cross-application leakage even when both apps load `com.example.Foo`.

```java
ClassLoader cl1 = ...;
ClassLoader cl2 = ...;
Class<?> a = cl1.loadClass("com.example.Foo");
Class<?> b = cl2.loadClass("com.example.Foo");
a == b;         // false — different runtime classes
a.equals(b);    // false
```

If `Foo` accesses its own `private` field, a `Foo` instance from `cl1` accessing a `Foo` instance from `cl2` would fail the access check (different classes). In practice this is rare — most code stays within one loader — but it's the foundation of a lot of container architecture.

---

## 4. The "package" — defined by name *and* class loader

JVMS §5.3 — *runtime packages*. Two classes are in the *same* runtime package iff:

1. They have the same package name (e.g., `com.example.shapes`).
2. They have the **same defining class loader**.

So `com.example.A` from class loader X and `com.example.B` from class loader Y are *not* in the same runtime package — `B` cannot package-private access `A`'s members.

This is how containers prevent cross-application access even when classes share a package name. It also means *splitting a package across modules* (a package shouldn't span jars) is a design smell — JPMS forbids it.

---

## 5. Nest mates: how Java 11+ shares private access

Pre-Java 11: two classes that wanted to share `private` (e.g., an outer class and its inner class) generated synthetic bridge methods.

```java
// Pre-11 source
public class Outer {
    private int counter;
    class Inner {
        void use() { counter++; }       // accesses Outer.counter
    }
}
```

Compiled to:

```
public class Outer {
    private int counter;
    static int access$008(Outer o) { return o.counter++; }   // synthetic bridge
}
public class Outer$Inner {
    void use() { Outer.access$008(this.outer); }
}
```

The synthetic accessors:

- Cluttered the class file (visible in `javap`).
- Were package-private, slightly weakening encapsulation.
- Made stack traces noisier.
- Were a target for "weird ways to access privates" — the bridges had to be `package-private` so the inner class could call them.

**JEP 181** (Java 11) introduced **nest mates**. A new pair of class file attributes:

- `NestHost`: declares which class is the "nest leader."
- `NestMembers`: lists nest members (only on the nest host).

Classes that share a nest can directly access each other's `private` members at the JVM level — no bridges needed. The verifier is updated to recognize "same nest" as a valid access path for `private`.

Compiled today, the example above produces direct `getfield`/`putfield` instructions, with `NestHost` / `NestMembers` attributes wiring the relationship.

You can inspect with `javap -v Outer.class` — look for the `NestMembers` attribute on the outer class and `NestHost` on inner ones.

---

## 6. Bytecode comparison: pre-11 vs post-11 private access

Pre-11 compiled bytecode of `Outer`:

```
Methods:
    private int counter
    static int access$008(Outer);                  ← synthetic bridge
        getfield #2  // Outer.counter:I
        ...
```

Post-11 compiled bytecode of `Outer`:

```
Methods:
    private int counter
    NestMembers: Outer$Inner
```

`Outer$Inner` simply reads `Outer.counter` directly:

```
    aload_1
    getfield #2  // Outer.counter:I
```

No more bridge. Smaller class files, cleaner stack traces, simpler reasoning about access.

---

## 7. Reflective access: `setAccessible` and JPMS

`AccessibleObject.setAccessible(true)` flips an internal bit that disables access checks in subsequent reflective operations:

```java
Field f = MyClass.class.getDeclaredField("balance");
f.setAccessible(true);              // bypass language-level access check
long v = (long) f.get(account);
```

Implementation: the `Method`/`Field`/`Constructor` object has an `override` boolean. When set, the access-check path is skipped.

Java 9+ added a *second* layer: even with `setAccessible(true)`, JPMS may forbid the call.

Specifically, for cross-module reflective access:

- The target type's package must be `opens` to the caller's module (or `opens` unconditionally).
- Otherwise `setAccessible(true)` throws `InaccessibleObjectException`.

```java
// module-info.java
module my.app {
    opens com.example.entities to com.fasterxml.jackson.databind;   // Jackson can reflect
    // not opens to other modules — only Jackson
}
```

Without the right `opens`, Jackson can't reflectively access `private` fields on entities. This is *strong encapsulation* — even reflection, the universal escape hatch, is now constrained.

For libraries that need fine-grained reflective access without `setAccessible(true)`, use `MethodHandles.privateLookupIn(targetClass, MethodHandles.lookup())`. This returns a `Lookup` object that can resolve `private` members of the target class — but it requires the target class's module to `opens` the package to the caller's module, OR for the caller to be in the same module.

---

## 8. The `--add-opens` and `--add-exports` runtime flags

Sometimes you control the runtime but not the source. To bypass JPMS strong encapsulation at runtime:

```
java --add-opens java.base/java.lang=ALL-UNNAMED ...
java --add-exports java.base/sun.security.util=my.module ...
```

These flags are command-line equivalents of `opens`/`exports` directives. Frameworks that need to reach into JDK internals often document the `--add-opens` they need (Spring's reflection on JDK classes, byte-buddy, jOOQ).

Operationally:

- `--add-exports module/package=target_module` makes a *non-exported* package accessible (compile-time and reflective `public` access).
- `--add-opens module/package=target_module` makes the package fully open to `setAccessible(true)`.

`ALL-UNNAMED` covers the unnamed module (i.e., classpath-loaded classes).

---

## 9. The verifier's role in access enforcement

JVMS §4.10: bytecode verification proves that no bytecode sequence can violate JVM safety, including access. Specifically:

- Every `getfield`/`putfield`/`getstatic`/`putstatic`/`invoke*` references a `CONSTANT_Fieldref`/`Methodref` in the constant pool.
- The verifier checks the access flags of the referenced member against the referencing class.
- If a `private` member is referenced from outside its nest (or from outside the same class pre-11), verification fails — `VerifyError`.

So even if a malicious class-file generator wrote a `getfield` for someone else's private field, the verifier would reject the class at load time.

Note: the verifier doesn't trust the access flags themselves to be honest. The JVM enforces *consistency* — a method's flags must agree with how the method is referenced and resolved.

---

## 10. `private` in interfaces (Java 9+)

Pre-9 interfaces couldn't have `private` methods. With default methods (Java 8), helpers had to be public defaults — leaking implementation. Java 9 added `private` and `private static` interface methods:

```java
public interface Parser {
    default int parseInt(String s)  { return parseSigned(s, 1); }
    default int parseNeg(String s)  { return parseSigned(s, -1); }

    private int parseSigned(String s, int sign) { ... }   // helper, not visible to implementors
}
```

At the bytecode level, `private` interface methods are flagged with `ACC_PRIVATE` plus `ACC_INTERFACE` on the enclosing class. They are resolved via `invokespecial` (not virtual) since they cannot be overridden.

This was a small but important encapsulation improvement — interfaces can now have hidden helpers without polluting the API.

---

## 11. Module visibility at runtime

The `Module` class (Java 9+) represents a runtime module. It exposes:

- `Module.canRead(Module other)` — does this module require that one?
- `Module.isExported(String pkg)` / `Module.isExported(String pkg, Module to)` — is the package exported (to that target)?
- `Module.isOpen(String pkg)` / `Module.isOpen(String pkg, Module to)` — is the package opened?
- `Module.addExports(String pkg, Module to)` — *only* available from same-module code, programmatically opens additional access at runtime.

The runtime answers questions like "can class X in module A see class Y in module B?" by walking these. The check happens at:

- Class loading (linking): `ClassNotFoundException` / `NoClassDefFoundError` if the package isn't visible.
- Reflective access: `IllegalAccessException` / `InaccessibleObjectException`.
- Method invocation: depends on resolution (the language compiler usually catches it before this).

---

## 12. Performance implications of access flags

`private final` and `static` methods can be invoked via `invokestatic` or `invokespecial` — direct calls, easily inlined.

`public` non-final methods compile to `invokevirtual` — vtable dispatch. The JIT can still inline (CHA, inline caches), but it's an extra step.

`public abstract` methods on interfaces compile to `invokeinterface` — itable dispatch. Slightly more expensive than `invokevirtual` but inline-cached effectively the same.

Practical difference between `public` and `private` is small at the call level. But:

- `private` methods cannot be overridden, so the JIT inlines without CHA dependency.
- `final public` methods get the same benefit.
- `public` non-final methods need CHA tracking; if a new subclass appears, the JIT may invalidate compiled code.

For hot methods on a class that's not designed to be subclassed, marking the *class* `final` is the cleanest performance improvement. Marking methods `final` is the second-best.

---

## 13. The historical mistake: `protected` static fields

In old Java code (pre-collections era), it was common to see:

```java
public abstract class AbstractList<E> extends AbstractCollection<E> {
    protected transient int modCount = 0;
}
```

`protected` fields like `modCount` are part of `AbstractList`'s contract. Any subclass *anywhere* — even outside the JDK — can read or write them. This locked the JDK's hands on every refactor of `AbstractList`.

Modern JDK design avoids `protected` fields. Hooks come as `protected` methods that subclasses override:

```java
public abstract class AbstractList<E> extends ... {
    private transient int modCount = 0;        // private, hidden
    protected void incrementModCount() { modCount++; }   // controlled hook
}
```

If you're designing a new framework, learn from this lesson. **State is `private`. Hooks are `protected` methods.**

---

## 14. Tools you should know

| Tool                         | What it shows                                       |
|------------------------------|-----------------------------------------------------|
| `javap -v -p MyClass.class`  | All access flags                                    |
| `Modifier.toString(flags)`   | Decode flags programmatically                       |
| `Class.getModifiers()`       | Runtime access of a class                           |
| `Field.getModifiers()` / `Method.getModifiers()` | Per-member access                |
| `--add-opens`, `--add-exports` | Runtime JPMS access overrides                     |
| `-Xlog:module=info`          | Module loading and access events                    |
| `Module.isExported(pkg, target)` | Module access checks at runtime                  |
| `MethodHandles.privateLookupIn(...)` | Cross-module reflective access via opens     |
| Static analyzers (Error Prone, SpotBugs, IntelliJ inspections) | Flag overly-public declarations |

---

## 15. Professional checklist

For each access modifier on every declaration:

1. What does the class file actually emit? (`javap -v` to confirm.)
2. Is the class's nest correct? (Old inner-class bridges still appearing? Recompile to Java 11+ target.)
3. For libraries: is the package `exports`'d? Is it `opens`'d? Are the right callers granted?
4. For frameworks reflecting on app code: does your `module-info.java` `opens` to the framework module?
5. For hot paths: is `final` applied where subclassing isn't allowed? Is the JIT inlining?
6. For SDK / public APIs: have you exercised `jdeprscan` to detect deprecated access patterns?
7. Are there `setAccessible(true)` calls that should be replaced by `MethodHandles.privateLookupIn(...)`?
8. Do you have `--add-opens` flags in your run scripts? Document why; minimize them.
9. Have you split your codebase into `api` (exported) and `internal` (not exported) packages?
10. For multi-class-loader environments (containers, plugins): does each class loader's accessibility match expectations?

Professional access-control is *aware* of every layer — language, bytecode, module, runtime, classloader. Each layer has its own access rules; a misalignment in any layer leaks security or breaks functionality. The expert's eye spots a `protected` field on a base class, a missing `opens` for a framework, a `setAccessible(true)` waiting to fail under modular runtime — and refactors before they cause production incidents.
