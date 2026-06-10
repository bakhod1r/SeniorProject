# JPMS — Specification Reading Guide

> The Java Platform Module System is *normative*. Unlike SOLID, JPMS is not a design philosophy — it is a language feature with grammar in the **JLS** (§7.7) and a class-file representation in the **JVMS** (§4.7.25 *Module*). This file maps every keyword in `module-info.java` to its binding spec text and the JEPs that shaped it.

---

## 1. Where to find the canonical text

| Concept                                       | Authoritative source                                       |
|-----------------------------------------------|------------------------------------------------------------|
| Module declarations grammar                   | **JLS §7.7** — *Module Declarations*                       |
| `requires`, modifiers (`transitive`, `static`)| JLS §7.7.1                                                 |
| `exports` and `exports … to`                  | JLS §7.7.2                                                 |
| `opens` and `opens … to`                      | JLS §7.7.2                                                 |
| `uses` and `provides … with`                  | JLS §7.7.3, §7.7.4                                         |
| `Module` class-file attribute                 | **JVMS §4.7.25**                                           |
| `ModulePackages` attribute                    | JVMS §4.7.26                                               |
| `ModuleMainClass` attribute                   | JVMS §4.7.27                                               |
| Access control rules across modules           | **JLS §6.6** — *Access Control* (with module-level rules)  |
| Reflective access (`Module.canRead`, `isOpen`)| `java.lang.Module` API documentation, JLS §17 cross-refs   |
| `ServiceLoader` specification                 | `java.util.ServiceLoader` API documentation                |
| `ModuleLayer` API                             | `java.lang.ModuleLayer` API documentation                  |
| JEP 200 — modular JDK                         | https://openjdk.org/jeps/200                               |
| JEP 261 — JPMS                                | https://openjdk.org/jeps/261                               |
| JEP 282 — `jlink`                             | https://openjdk.org/jeps/282                               |
| JEP 396 — strong encapsulation by default     | https://openjdk.org/jeps/396                               |
| JEP 403 — strongly encapsulate JDK internals  | https://openjdk.org/jeps/403                               |

JLS §7.7 is the canonical text for the *language*; JVMS §4.7.25 is the canonical text for the *binary*. The JEPs are the design discussions; the spec text is what compilers and the runtime enforce.

---

## 2. JLS §7.7 — module declarations

JLS §7.7 introduces `ModuleDeclaration` as a top-level compilation unit:

```
ModuleDeclaration:
    {Annotation} [open] module ModuleName { {ModuleDirective} }

ModuleDirective:
    requires {RequiresModifier} ModuleName ;
    exports PackageName [to ModuleName {, ModuleName}] ;
    opens   PackageName [to ModuleName {, ModuleName}] ;
    uses    TypeName ;
    provides TypeName with TypeName {, TypeName} ;

RequiresModifier:
    transitive | static
```

Key points the grammar makes precise:

- A module declaration is *one file* per module, named `module-info.java` (the only legal compilation-unit name with a hyphen).
- The optional `open` keyword on the module itself opens **every** package — equivalent to writing `opens P;` for each package. Reserve for special cases.
- `requires` accepts at most one `transitive` and at most one `static` modifier per clause.
- `exports … to` and `opens … to` are *qualified* forms; the `to` list is a comma-separated set of module names that may or may not exist when this module is compiled (the consumer module need not exist yet).

### §7.7.1 — `requires`

`requires` introduces a dependency on a named module. Modifiers compose:

- `requires com.example.x;` — compile-time and runtime read.
- `requires transitive com.example.x;` — same, *plus* implicit re-export to consumers of this module.
- `requires static com.example.x;` — compile-time only; module may be absent at runtime.
- `requires transitive static com.example.x;` — both modifiers; compile-time re-export, optional at runtime.

`java.base` is implicitly required by every module declaration. You may not write `requires java.base;` explicitly (it is permitted by the grammar but redundant).

### §7.7.2 — `exports` and `opens`

`exports` makes a *package* visible to other modules at the type-system level. `opens` makes it visible to *reflection*. These are independent:

- `exports P;` — every other module may import `public` types from `P`.
- `exports P to A, B;` — only modules `A` and `B` may import.
- `opens P;` — every module may use deep reflection (`setAccessible(true)`) on classes in `P`.
- `opens P to A, B;` — only `A` and `B` may.
- `open module M { ... }` — equivalent to `opens P;` for every package in the module.

A package may be opened *without* being exported (Hibernate-style entity package); exported without being opened (most public APIs); both; or neither (truly internal).

### §7.7.3 — `uses`

```
uses TypeName ;
```

Declares that this module *consumes* a service via `ServiceLoader`. Without `uses`, `ServiceLoader.load(T.class)` returns an empty iterator inside a named module — a common silent bug. The compiler does not warn about a missing `uses` because it cannot in general know that you called `ServiceLoader.load`.

### §7.7.4 — `provides … with`

```
provides ServiceTypeName with ImplTypeName {, ImplTypeName} ;
```

Declares one or more implementations of a service. Each implementation must either:

- have a `public` no-arg constructor; or
- declare a `public static` method named `provider()` returning the service type (a factory method).

The implementation class must be `public` and reside in the providing module (it does not need to be exported — only the *service type* needs to be visible to consumers).

---

## 3. JLS §6.6 — access control across modules

JLS §6.6 defines the access rules that the spec uses to decide whether a reference is legal. JPMS extends §6.6 with module-level rules:

- A type or member of a package `P` in module `M` is accessible to code in another module `N` only if:
  1. `M` `exports P` (unqualified) **or** `M` `exports P to N` (qualified), **and**
  2. `N` `requires` `M` (directly or transitively through `requires transitive`), **and**
  3. The type / member is otherwise accessible per the classic `public` / `protected` / package-private / `private` rules.

If all three conditions hold, the access compiles and runs. If any fails, the compiler reports an error and the runtime would refuse the access — even via reflection, unless the package is *opened* (then condition 1 is satisfied via `opens` instead of `exports`).

This is why `public` no longer means *globally visible*: a `public` class in an *unexported* package is visible only within its own module. The classic `public` was relative to the JAR; the JPMS-aware `public` is relative to the *module*.

---

## 4. JVMS §4.7.25 — the `Module` class-file attribute

When `javac` compiles `module-info.java`, it emits `module-info.class` containing an attribute structure named `Module`. The attribute carries every directive from the source declaration:

```
Module_attribute {
    u2 attribute_name_index;
    u4 attribute_length;
    u2 module_name_index;          // CONSTANT_Module_info
    u2 module_flags;               // ACC_OPEN, ACC_SYNTHETIC, ACC_MANDATED
    u2 module_version_index;       // optional CONSTANT_Utf8

    u2 requires_count;
    {  u2 requires_index;          // CONSTANT_Module_info
       u2 requires_flags;          // ACC_TRANSITIVE, ACC_STATIC_PHASE, ACC_SYNTHETIC, ACC_MANDATED
       u2 requires_version_index;
    } requires[requires_count];

    u2 exports_count;
    {  u2 exports_index;           // CONSTANT_Package_info
       u2 exports_flags;
       u2 exports_to_count;
       u2 exports_to_index[exports_to_count];
    } exports[exports_count];

    u2 opens_count;
    {  u2 opens_index;
       u2 opens_flags;
       u2 opens_to_count;
       u2 opens_to_index[opens_to_count];
    } opens[opens_count];

    u2 uses_count;
    u2 uses_index[uses_count];     // CONSTANT_Class_info

    u2 provides_count;
    {  u2 provides_index;          // CONSTANT_Class_info (service interface)
       u2 provides_with_count;
       u2 provides_with_index[provides_with_count];  // CONSTANT_Class_info (impls)
    } provides[provides_count];
}
```

Two practical notes:

- The *names* (`module_name_index`, `requires_index`) point into the constant pool's `CONSTANT_Module_info` entries (JVMS §4.4.11) — a tag introduced in class-file version 53 (Java 9).
- The flags use the same shape as method/field flags. `ACC_TRANSITIVE = 0x0020` on a `requires` makes it `requires transitive`; `ACC_STATIC_PHASE = 0x0040` makes it `requires static`; both can be combined.

A tool like `javap -v module-info.class` prints the attribute in readable form:

```
Module:
  #15,0                                   // "com.example.shop"
  flags: (0x0000)
  requires:
    #21,0x0020                            // transitive "com.example.money"
    #25,0x0040                            // static "lombok"
  exports:
    #28                                   // "com/example/shop/api"
  opens:
    #34 to #41                            // "com/example/shop/entity" to "org.hibernate.orm.core"
  uses:
    #45                                   // "com/example/shop/api/PaymentGateway"
  provides:
    #48 with #51                          // "com/example/shop/spi/Hook" with "...DefaultHook"
```

---

## 5. JVMS §4.7.26 / §4.7.27 — companion attributes

Two smaller attributes accompany `Module`:

- **`ModulePackages` (§4.7.26)** lists *all* packages in the module, including non-exported and non-opened ones. The runtime uses this to validate package uniqueness across the module graph (one of the reasons split packages fail loudly).
- **`ModuleMainClass` (§4.7.27)** names the main class, if any. `java --module com.example.app` looks this up to find the entry point without `--class`. Set by `javac --module ... --main-class ...` or by the `jar --main-class` flag.

---

## 6. The JEP timeline

| JEP    | Java | Title / change                                                       |
|--------|------|----------------------------------------------------------------------|
| **200** | 9    | The modular JDK — split the JDK itself into modules                  |
| **261** | 9    | Module System — the JPMS feature itself                              |
| **220** | 9    | Modular runtime images — runtime-image structure                     |
| **282** | 9    | `jlink` — the linker for runtime images                              |
| **260** | 9    | Encapsulate most internal APIs (with warnings)                       |
| 275    | 9    | Modular Java Application Packaging — deprecated `jpkg`               |
| **396** | 16   | Strongly encapsulate JDK internals by default (`deny` becomes default) |
| **403** | 17   | Strongly encapsulate JDK internals — remove `--illegal-access` flag |
| 392    | 16   | Packaging tool (`jpackage`) — distributable runtime images          |

**JEP 200** carved the JDK into modules (`java.base`, `java.sql`, `java.xml`, …). It is the reason a Java 8 app that depended on `javax.xml.bind` broke on Java 11 — the package moved to a non-default module (and later was removed).

**JEP 261** is the module system itself: `module-info.java`, the runtime, the module path, the access rules. Read its motivation section — it explains every design decision in JPMS.

**JEP 282** introduced `jlink`. Without JEP 261, `jlink` would have nothing to link; without JEP 282, JPMS would have no packaging output.

**JEP 260** was the *transition* policy for Java 9: encapsulate internals, but issue warnings rather than errors for legacy reflection. The compromise let Java 9 ship without breaking the ecosystem.

**JEP 396** (Java 16) flipped the default — `--illegal-access=deny` from `permit`. Legacy reflection that worked silently in Java 11 started throwing `InaccessibleObjectException` in Java 16.

**JEP 403** (Java 17) finished the job — `--illegal-access` was removed entirely. From Java 17 onward, every reflective access to a non-opened JDK internal must be authorised via `--add-opens` at launch.

---

## 7. `java.util.ServiceLoader` — the SPI mechanism

`ServiceLoader` (the class) predates JPMS by a decade (Java 6). JPMS adds module-aware lookup:

- In a *named* module, `ServiceLoader.load(S.class)` only finds providers declared in `module-info.java` via `provides S with ...;`. The consumer's `module-info.java` must declare `uses S;` (else the loader returns empty).
- In the *unnamed* module (classpath), the loader falls back to the legacy `META-INF/services/<service-type>` files. Classpath SPI still works for classpath apps.
- The loader honours module-graph access rules: it will not load a provider from a module that the consumer cannot read.

A useful overload added with JPMS:

```java
ServiceLoader<S> loader = ServiceLoader.load(layer, S.class);
```

Restricts the search to a specific `ModuleLayer`, enabling plugin scenarios where you've defined a child layer (see senior.md §8).

---

## 8. Reflection meets JPMS — the `Module` API

Every `Class` now belongs to a `java.lang.Module` accessible via `Class.getModule()`. The `Module` API provides the introspection JPMS made necessary:

| Method                                       | What it tells you                                       |
|----------------------------------------------|---------------------------------------------------------|
| `getName()`                                  | The module name, or null for the unnamed module         |
| `isNamed()`                                  | Whether this is a named module                          |
| `canRead(Module)`                            | Whether the module can read another module              |
| `isExported(String pkg)`                     | Whether a package is exported (unqualified)             |
| `isExported(String pkg, Module other)`       | Whether exported specifically to `other`                |
| `isOpen(String pkg)`                         | Whether a package is opened (unqualified)               |
| `isOpen(String pkg, Module other)`           | Whether opened specifically to `other`                  |
| `getDescriptor()`                            | `ModuleDescriptor` — programmatic view of `module-info` |

The `Module` API mirrors `module-info.java`: every keyword has a corresponding method. Frameworks use these to make decisions ("can I read this module's `Order` class via reflection?"), and your code can use them in tests.

`Module.addOpens(pkg, target)` exists, but only the module that owns the package can call it on its own behalf — you cannot grant yourself access to someone else's module from the outside. That's the strong-encapsulation guarantee in action.

---

## 9. `jlink` — JEP 282 specifics

`jlink` reads modules from the module path and assembles a runtime image. The spec-level interesting bits:

- **Plug-in architecture.** `jlink` operates as a chain of plug-ins (`--add-modules`, `--strip-debug`, `--compress`, `--launcher`, `--exclude-jmod-section`). Each plug-in transforms the module set or its contents. Third-party plug-ins exist (e.g., GraalVM-aware ones).
- **JIMAGE format.** The output is the `lib/modules` file in the JIMAGE container format (specific to `jlink`'s output, not exposed to apps). The JVM reads it via the *modular runtime image filesystem* (`jrt:` URLs).
- **No automatic modules accepted.** `jlink` refuses to link a module path that contains any automatic module. This is the strongest forcing function for library authors: until they ship a real `module-info`, downstream `jlink` users are blocked.

---

## 10. Spec-level corner cases worth knowing

**A `module-info.java` is its own compilation unit, with its own access rules.** Inside it you can reference types only from required modules (transitively) — same rule as any source file.

**Annotations on the module declaration** (e.g., `@Generated` on `module com.example.x { ... }`) are stored in the `RuntimeVisibleAnnotations` attribute of `module-info.class`. Most won't survive at runtime unless they're `@Retention(RUNTIME)`.

**Cyclic `requires` is forbidden.** `javac` refuses to compile a graph with a cycle (JLS §7.7.1). The grammar permits the words; the resolver rejects the cycle.

**Split packages are forbidden across modules.** The runtime fails fast with `java.lang.LayerInstantiationException: Package X in both modules A and B`. There is no workaround other than rename or merge.

**Concealed packages.** A package present in a module but not in `ModulePackages` is "concealed"; the compiler emits a class-file warning but accepts it. This is mostly relevant for `jar` files patched after `javac`.

**The `module-info.class` must be in the JAR root**, not in a `META-INF/versions/N/` (unless used in a multi-release JAR per JEP 238). Build tools handle this automatically.

---

## 11. Reading list

1. **JLS §7.7** — Module Declarations. Read all subsections; it's only ~10 pages.
2. **JVMS §4.7.25** — `Module` attribute. The binary representation.
3. **JEP 261** — Module System. The motivational text is excellent.
4. **JEP 200** — The modular JDK. Explains why the JDK's own structure changed.
5. **JEP 282** — `jlink`. The linker's design.
6. **JEP 396** and **JEP 403** — The Java 16 / 17 tightenings.
7. **`java.lang.Module` JavaDoc** — programmatic introspection.
8. **`java.util.ServiceLoader` JavaDoc** — the SPI mechanism with module-aware lookup.
9. **Mark Reinhold, *The State of the Module System*** (2017) — long-form essay accompanying JEP 261; still the clearest design summary.
10. **Alex Buckley, *Java's New Module System*** (2018 talk and slides) — the JLS editor walking through every keyword with examples.
11. **Sander Mak & Paul Bakker, *Java 9 Modularity*** (O'Reilly, 2017) — book-length treatment with realistic migration case studies.

The spec sections do not *advocate* JPMS — they describe its grammar and binary form. The JEPs give you the design reasoning. The book gives you the migration playbook. Together, they cover what `javac` does, what the JVM enforces, and what teams should plan for.
