# Access Specifiers — Specification Deep-Dive

> Access rules are scattered: language-level rules in **JLS §6.6** (Access Control), enforcement in **JVMS §5.4.4** (Access Checking), bytecode flags in **JVMS §4.1, §4.5, §4.6**, the module layer in **JLS §7.7** and **JVMS §5.3.6**, and reflection in `java.lang.reflect` plus JEP 261 (modules), JEP 274 (lookups), and JEP 330+ for `setAccessible`. This file maps each rule to its source and the runtime mechanism that enforces it.

---

## 1. Where the rules live

| Concept                                  | Authoritative source                              |
|------------------------------------------|---------------------------------------------------|
| Access levels and rules                  | **JLS §6.6** — *Access Control*                   |
| `private`, `protected`, package access   | JLS §6.6.1, §6.6.2                                |
| Modules and accessibility                | JLS §6.6.1, §7.7                                  |
| Class file `access_flags` (top-level)    | **JVMS §4.1**                                     |
| Field `access_flags`                     | **JVMS §4.5**                                     |
| Method `access_flags`                    | **JVMS §4.6**                                     |
| InnerClasses attribute                   | JVMS §4.7.6                                       |
| NestHost / NestMembers attributes        | JVMS §4.7.28, §4.7.29 (since Java 11)             |
| Verification and access checks           | **JVMS §5.4.4** — *Access Control*                |
| Module attribute                         | JVMS §4.7.25                                      |
| Reflection and `setAccessible`           | JLS §6.6, JEP 396, JEP 403                         |
| `MethodHandles.Lookup` access modes      | java.lang.invoke specification                    |

The JLS describes what *the language* allows; the JVMS describes what *the JVM* will reject. They agree on the semantics, but the JVM has the final word at runtime.

---

## 2. JLS §6.6 — Access Control

The four levels (§6.6.1):

> *A member or constructor of a reference type, or that reference type itself, may be declared with the access modifier `public`, `protected`, or `private`, or with no access modifier (often called *package access*).*

The rules (§6.6.1, §6.6.2):

- **`public`**: member is accessible whenever the containing class is accessible.
- **`protected`**: accessible from the same package, AND from subclasses (subject to qualifications below).
- **Package access** (no modifier): accessible only within the same package.
- **`private`**: accessible only within the *body of the enclosing top-level class*.

A few subtleties:

- "Body of the enclosing top-level class" includes **all nested classes** (per §6.6.1) — that's why an inner class can access its enclosing class's privates without bridges (Java 11+) or with synthetic bridges (pre-11).
- For `protected` instance members from outside the package: the access is permitted only when the access expression's static type is the subclass or one of its subclasses (§6.6.2.1). You cannot `superClassRef.protectedField` from a sibling subclass in another package.

---

## 3. JLS §6.6.1 — When is a *type* accessible?

A type (top-level class, interface) is accessible from a given context if:

1. It is `public`, OR
2. It is in the same package as the context.

Modules add a third condition (Java 9+):

3. The type's package must be exported by its module to the context's module (or the context is in the same module).

So `public` plus same-module is the new "fully accessible." A `public` type in a non-exported package is not accessible from outside the module.

---

## 4. JLS §6.6.2 — `protected` access in detail

The rule reads carefully:

> *Let `C` be the class in which a `protected` member `m` is declared. Access is permitted only within the body of a subclass `S` of `C`. In addition, if `Id` denotes an instance field or instance method, then:*
>
> *- If the access is by a qualified name `Q.Id`, where `Q` is an `ExpressionName`, then the access is permitted if and only if the type of `Q` is `S` or a subclass of `S`.*
> *- If the access is by a field access expression `E.Id`, where `E` is a `Primary` expression, or by a method invocation expression `E.Id(...)`, where `E` is a `Primary` expression, then the access is permitted if and only if the type of `E` is `S` or a subclass of `S`.*

In plain English: a `protected` instance member can only be accessed *via a reference whose static type is the subclass*, when the access is from a different package. Accessing through a `Parent` reference, even if the runtime object is a `Child`, is rejected from outside the parent's package.

This rule prevents one subclass from poking at another's `protected` state through a parent reference — but it's surprising the first time you hit it.

---

## 5. JLS §7.7 — Module Declarations

A module declaration (`module-info.java`) lists:

- `requires <module>` — depend on another module.
- `requires transitive <module>` — re-export the dependency to my consumers.
- `requires static <module>` — needed at compile time but optional at runtime.
- `exports <package>` — make `public` types in this package accessible to other modules.
- `exports <package> to <module>, ...` — qualified export, only to listed modules.
- `opens <package>` — allow deep reflection (`setAccessible(true)`) into this package.
- `opens <package> to <module>, ...` — qualified open.
- `uses <service>` / `provides <service> with <impl>` — `ServiceLoader` integration.

The module system adds a layer of access checks above the language-level ones. Both must pass:

1. JLS §6.6 access rules (visibility based on `public`/`protected`/etc.).
2. Module rules: package must be exported (or in the same module).

---

## 6. JVMS §4.1 — Class file access_flags

The top-level class flags:

```
ACC_PUBLIC      0x0001    Declared public; may be accessed from outside its package.
ACC_FINAL       0x0010    Declared final; no subclasses allowed.
ACC_SUPER       0x0020    Treat superclass methods specially when invoked via invokespecial.
ACC_INTERFACE   0x0200    Is an interface, not a class.
ACC_ABSTRACT    0x0400    Declared abstract; must not be instantiated.
ACC_SYNTHETIC   0x1000    Not present in source (compiler-generated).
ACC_ANNOTATION  0x2000    Declared as an annotation type.
ACC_ENUM        0x4000    Declared as an enum type.
ACC_MODULE      0x8000    Declared as a module (module-info.class).
```

Constraints:

- Top-level classes cannot have `ACC_PRIVATE` or `ACC_PROTECTED`.
- `ACC_INTERFACE` and `ACC_FINAL` are mutually exclusive.
- `ACC_SUPER` is set on every modern class file.

---

## 7. JVMS §4.5 — Field access_flags

```
ACC_PUBLIC      0x0001
ACC_PRIVATE     0x0002
ACC_PROTECTED   0x0004
ACC_STATIC      0x0008
ACC_FINAL       0x0010
ACC_VOLATILE    0x0040
ACC_TRANSIENT   0x0080
ACC_SYNTHETIC   0x1000
ACC_ENUM        0x4000
```

Constraints (JVMS §4.5):

- At most one of `PUBLIC`, `PRIVATE`, `PROTECTED`.
- `FINAL` and `VOLATILE` cannot both be set.
- Interface fields must be `PUBLIC`, `STATIC`, and `FINAL` (`0x0019`).

The verifier rejects classes with illegal flag combinations.

---

## 8. JVMS §4.6 — Method access_flags

```
ACC_PUBLIC          0x0001
ACC_PRIVATE         0x0002
ACC_PROTECTED       0x0004
ACC_STATIC          0x0008
ACC_FINAL           0x0010
ACC_SYNCHRONIZED    0x0020
ACC_BRIDGE          0x0040
ACC_VARARGS         0x0080
ACC_NATIVE          0x0100
ACC_ABSTRACT        0x0400
ACC_STRICT          0x0800
ACC_SYNTHETIC       0x1000
```

Constraints:

- At most one of `PUBLIC`, `PRIVATE`, `PROTECTED`.
- `ABSTRACT` excludes `FINAL`, `STATIC`, `PRIVATE`, `SYNCHRONIZED`, `NATIVE`, `STRICT`.
- `<init>` methods may have `PUBLIC`, `PRIVATE`, `PROTECTED`, plus `STRICT`, `VARARGS`, `SYNTHETIC`.
- `<clinit>` methods always have `STATIC` set (and originally `STRICT` pre-JEP 306).

`ACC_BRIDGE` and `ACC_SYNTHETIC` are compiler-generated indicators.

---

## 9. JVMS §5.4.4 — Access checking at link time

The verifier and resolver check, for each `getfield`/`putfield`/`getstatic`/`putstatic`/`invokestatic`/`invokespecial`/`invokevirtual`/`invokeinterface`:

1. Resolve the symbolic reference to a `(class, member)` pair.
2. Check accessibility from the *referring* class:
   - `public`: always accessible.
   - `protected`: accessible if the caller is in the same package, OR is a subclass and (for instance access) the receiver is a subclass.
   - Package access: accessible if the caller is in the same runtime package.
   - `private`: accessible if the caller is in the same nest (Java 11+) or the same class.

If the check fails, the JVM throws `IllegalAccessError`.

These checks happen *once per resolution* — typically on first reference. The result is cached in the constant pool.

---

## 10. JVMS §5.3.6 — Module access

Java 9 added a layer: even if language access (§6.6) and bytecode access (§5.4.4) permit, the module system may forbid:

- The referring class's module must `requires` the referenced class's module (transitively).
- The referenced class must be in a package `exports`-ed by its module to the referring module (or the same module).
- For reflective deep access (`setAccessible(true)`), the package must be `opens`-ed.

If any check fails, `IllegalAccessError` (link time) or `IllegalAccessException` / `InaccessibleObjectException` (reflection).

---

## 11. JVMS §4.7.28, §4.7.29 — Nest attributes

`NestHost` (per nest member, single attribute):

```
NestHost_attribute {
    u2 attribute_name_index;
    u4 attribute_length;
    u2 host_class_index;     // index in constant pool to the nest host
}
```

`NestMembers` (on the nest host):

```
NestMembers_attribute {
    u2 attribute_name_index;
    u4 attribute_length;
    u2 number_of_classes;
    u2 classes[number_of_classes];   // indices to nest member classes
}
```

The verifier and resolver use these to permit `private` access between nest mates. Pre-Java 11 class files (without these attributes) treat `private` as same-class only — and require synthetic bridge methods for cross-class access.

---

## 12. The Module attribute (JVMS §4.7.25)

`module-info.class` contains a `Module` attribute with the structure:

```
Module_attribute {
    u2 attribute_name_index;
    u4 attribute_length;
    u2 module_name_index;
    u2 module_flags;            // ACC_OPEN, ACC_SYNTHETIC, ACC_MANDATED
    u2 module_version_index;

    u2 requires_count;
    requires_info requires[];   // each: module_index, flags, version

    u2 exports_count;
    exports_info exports[];     // each: package_index, flags, to_module_index[]

    u2 opens_count;
    opens_info opens[];         // each: package_index, flags, to_module_index[]

    u2 uses_count;
    u2 uses[];                  // class_index for each used service

    u2 provides_count;
    provides_info provides[];   // service + provider classes
}
```

The runtime parses this to construct the `Module` object and answer access-check questions.

---

## 13. JEP 396 / 403 — Strong encapsulation by default

JEP 396 (Java 16): strong encapsulation became *default* for JDK internals. Reflective access to JDK internals via classpath without `--add-opens` started failing.

JEP 403 (Java 17): made it *permanent* — `--illegal-access` (which used to allow opt-out) was removed. The only escape hatches are explicit `--add-opens` flags or proper `module-info.java` declarations.

Practical impact:

- Old libraries that reflected on `java.util.HashMap`'s private fields (or similar) require `--add-opens java.base/java.util=ALL-UNNAMED`.
- Newer versions of those libraries either avoid reflection or use `MethodHandles.privateLookupIn` with proper opens.
- Application code rarely needs these flags — the JDK is more careful now about exposing what users actually need.

---

## 14. `MethodHandles.Lookup` access modes

`java.lang.invoke.MethodHandles.Lookup` carries an *access mode* bitmask:

- `PUBLIC` — can find public methods.
- `PROTECTED` — can find protected methods.
- `PACKAGE` — can find package-private members.
- `PRIVATE` — can find private members.
- `MODULE` — can read across modules (if the module exports/opens permit).
- `UNCONDITIONAL` — can find members that are unconditionally exported.

Each `Lookup` is created with a subset of these modes corresponding to the calling class's privileges. Some operations *drop* modes (`Lookup.in(otherClass)` keeps only modes the new context can have).

`MethodHandles.lookup()` returns a Lookup with all modes for the calling class. `MethodHandles.privateLookupIn(target, original)` creates a lookup with `PRIVATE` mode for `target`, but only if JPMS permits it.

---

## 15. The reflection access check sequence

For `Field.setAccessible(true)`, the runtime performs:

1. Is the field's class in the same module as the caller? If yes → allowed.
2. Else: is the field's package `opens`-ed (unconditionally or to the caller's module)? If yes → allowed.
3. Else: is the caller in `ALL-UNNAMED` and is the package `opens`-ed via `--add-opens`? If yes → allowed.
4. Else: throw `InaccessibleObjectException`.

The Security Manager (deprecated in 17, removed in 24) used to add an additional check; modern code should not rely on it.

---

## 16. Reading order

1. **JLS §6.6** — read top to bottom. The whole chapter is short and dense.
2. **JLS §7.7** — module declarations, if you're working on libraries or modular apps.
3. **JVMS §4.5 & §4.6** — class file flags. Skim, refer back as needed.
4. **JVMS §5.4.4** — runtime access checking.
5. **JEP 181** (nest mates), **JEP 261** (module system), **JEP 396/403** (strong encapsulation) — for context on modern access control.

The spec is precise. When a colleague claims "Java doesn't allow X" or "you can always do Y," cite §6.6 or §5.4.4 to settle it.

---

## 17. The takeaway

Access control in Java spans four interacting layers:

1. **Language** (JLS §6.6) — what `javac` enforces.
2. **Bytecode** (JVMS §4.5–6, §5.4.4) — what the verifier and resolver enforce.
3. **Modules** (JLS §7.7, JVMS §4.7.25) — what JPMS enforces above bytecode.
4. **Reflection** (`java.lang.invoke` + JPMS opens) — what reflective callers can bypass.

Most application bugs are at layer 1; most library bugs at layer 2; most modular-app surprises at layer 3; most framework integration issues at layer 4. Knowing which layer is rejecting your access is half the fix.

The discipline: tighten at layer 1 by default, structure for layer 2's sake, design for layer 3 if you're shipping a library, and document your layer-4 needs explicitly.
