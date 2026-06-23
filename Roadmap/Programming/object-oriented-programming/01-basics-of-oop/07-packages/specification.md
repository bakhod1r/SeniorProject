# Packages — Specification Deep-Dive

> Package rules in **JLS §7** (packages and modules), with key subsections **§7.3** (compilation units), **§7.4** (package declarations), **§7.5** (imports), **§7.6-§7.7** (top-level types and modules). Runtime aspects in **JVMS §5.3** (runtime packages), **§4.7.25** (Module attribute), and **§5.4.4** (access checking).

---

## 1. Where the rules live

| Concept                                 | Source                              |
|-----------------------------------------|-------------------------------------|
| Compilation units                       | **JLS §7.3**                         |
| Package declarations                    | **JLS §7.4**                         |
| Import declarations                     | **JLS §7.5**                         |
| Module declarations                     | **JLS §7.7**                         |
| Top-level type declarations             | JLS §7.6                             |
| Package access rules                    | JLS §6.6.1                           |
| Static imports                          | JLS §7.5.3, §7.5.4                   |
| Runtime packages                        | **JVMS §5.3**                         |
| Module attribute                        | JVMS §4.7.25                         |
| Module-system access checks             | JVMS §5.3.6, §5.4.4                  |
| Class loading and resolution            | JVMS §5                              |

---

## 2. JLS §7.3 — Compilation units

A *compilation unit* is the contents of a single `.java` source file. Two kinds:

- **Ordinary compilation unit**: a regular `.java` file with a (possibly missing) package declaration, imports, and top-level types.
- **Modular compilation unit**: a `module-info.java` file declaring a module.

Grammar (simplified):

```
CompilationUnit:
    OrdinaryCompilationUnit
    ModularCompilationUnit

OrdinaryCompilationUnit:
    [PackageDeclaration]
    {ImportDeclaration}
    {TopLevelClassOrInterfaceDeclaration}

ModularCompilationUnit:
    {ImportDeclaration}
    ModuleDeclaration
```

Per-file constraints:

- At most one `public` top-level class/interface, with name matching the file name.
- Multiple non-public top-level classes are allowed.

---

## 3. JLS §7.4 — Package declarations

```
PackageDeclaration:
    {PackageModifier} package Identifier {. Identifier} ;
```

Rules:

- Optional. Without it, the compilation unit is in the *unnamed* package.
- Identifiers are Java identifiers (letters/digits/underscores).
- Conventionally lowercase, dotted reverse-DNS prefixes.
- Annotations are allowed via `package-info.java` only.

The package declaration determines the *named package* of all top-level types in the compilation unit.

---

## 4. JLS §7.5 — Import declarations

Four forms:

```
ImportDeclaration:
    SingleTypeImportDeclaration         // import a.b.C;
    TypeImportOnDemandDeclaration        // import a.b.*;
    SingleStaticImportDeclaration        // import static a.b.C.member;
    StaticImportOnDemandDeclaration      // import static a.b.C.*;
```

Resolution priority (JLS §6.5.5.1):

1. Single-type-import declarations.
2. Single-static-import declarations.
3. Type-import-on-demand declarations.
4. Static-import-on-demand declarations.
5. Types from the same package.
6. Types from `java.lang` (implicitly imported).

The first match wins. Beyond that, ambiguity at the use site is a compile error.

---

## 5. JLS §7.7 — Module declarations

```
ModuleDeclaration:
    {Annotation} [open] module Identifier {. Identifier} { {ModuleDirective} }

ModuleDirective:
    requires {RequiresModifier} ModuleName ;
    exports PackageName [to ModuleName {, ModuleName}] ;
    opens PackageName [to ModuleName {, ModuleName}] ;
    uses TypeName ;
    provides TypeName with TypeName {, TypeName} ;

RequiresModifier:
    transitive
    static
```

Each directive has runtime effect:

- `requires`: depend on another module.
- `requires transitive`: re-export the dependency to my consumers.
- `requires static`: compile-time only; runtime optional.
- `exports`: make this package's `public` types visible to consumers.
- `exports ... to`: qualified export, only to listed modules.
- `opens`: allow reflective access (`setAccessible(true)`).
- `opens ... to`: qualified opens.
- `open module`: shorthand for "all packages opened" (rarely needed).
- `uses` / `provides`: integration with `ServiceLoader`.

---

## 6. JLS §6.6.1 — Package access

> *If the member or constructor is declared with no access modifier (i.e., the default access), then the access is permitted only when both `C` and `D` are members of the same runtime package (§5.3 of The Java Virtual Machine Specification).*

The "runtime package" qualification is crucial: same package name + same defining class loader. Cross-loader same-package access is forbidden.

---

## 7. JVMS §5.3 — Runtime packages

JVMS §5.3 defines runtime packages:

> *The Java Virtual Machine determines whether two classes are members of the same runtime package by considering both the package name and the defining class loader.*

Implications:

- Two classes in `com.example.foo` from different loaders are in different runtime packages.
- They cannot access each other's package-private members.
- This is what isolates app server deployments.

---

## 8. JVMS §4.7.25 — Module attribute

A `module-info.class` contains a `Module` attribute:

```
Module_attribute {
    u2 attribute_name_index;
    u4 attribute_length;
    u2 module_name_index;
    u2 module_flags;             // ACC_OPEN, ACC_SYNTHETIC, ACC_MANDATED
    u2 module_version_index;

    u2 requires_count;
    requires_info requires[];

    u2 exports_count;
    exports_info exports[];

    u2 opens_count;
    opens_info opens[];

    u2 uses_count;
    u2 uses[];

    u2 provides_count;
    provides_info provides[];
}
```

`requires_info`:

```
requires_info {
    u2 requires_index;        // module name
    u2 requires_flags;         // ACC_TRANSITIVE, ACC_STATIC_PHASE, ACC_SYNTHETIC, ACC_MANDATED
    u2 requires_version_index;
}
```

`exports_info` / `opens_info`:

```
exports_info {
    u2 exports_index;          // package name
    u2 exports_flags;
    u2 exports_to_count;
    u2 exports_to_index[];     // 0 if exported to all; otherwise list of target modules
}
```

The runtime parses this to build the `Module` object exposed via reflection.

---

## 9. JVMS §5.3.6 — Module access checks

When the JVM resolves a class reference across modules:

1. Verify that the *referencing* module reads the *referenced* module (`requires`).
2. Verify that the referenced class's package is exported to the referencing module.
3. Standard access rules (JLS §6.6) still apply.

Failure throws `IllegalAccessError` (link time) or, for reflection, `IllegalAccessException` / `InaccessibleObjectException`.

---

## 10. JVMS §4.7.5 — Annotations on packages

A `package-info.java` file compiles to a `package-info.class`:

```
public abstract interface package-info {
    // no methods, no fields
    // RuntimeVisibleAnnotations attribute carries the package's annotations
}
```

The class flags are `ACC_INTERFACE | ACC_ABSTRACT | ACC_SYNTHETIC`. Reflection reads the annotations via `Package.getAnnotations()` (or `Module.getAnnotations()` for Java 9+).

The class itself has no methods or fields — it exists purely as metadata.

---

## 11. The classpath model (pre-JPMS)

Classes loaded via `-cp` (or `-classpath`) form the "unnamed module" in Java 9+. Properties:

- All packages are implicitly exported.
- Access control via package-private and `public`.
- No module-level isolation.

Most existing apps run on the classpath. Migration to modules is opt-in.

---

## 12. The modulepath model (Java 9+)

Classes loaded via `--module-path` (or `-p`) are organized into modules:

- Each module declares its `requires` and `exports`.
- Modules form a graph; cycles are detected at load time.
- Strong encapsulation: non-exported packages are inaccessible.

Modulepath and classpath can coexist. A *named* module (with `module-info.class`) gets full module semantics; *automatic* modules (jars without `module-info.class` placed on the modulepath) export everything by default.

---

## 13. Service loading via `uses` / `provides`

```java
// Provider:
module com.example.lib {
    provides com.example.api.Service with com.example.lib.DefaultService;
}

// Consumer:
module com.example.app {
    uses com.example.api.Service;
}

ServiceLoader<Service> loaders = ServiceLoader.load(Service.class);
loaders.forEach(s -> s.run());
```

The `provides`/`uses` directives integrate with `ServiceLoader` in a JPMS-aware way. Module-based providers are preferred over `META-INF/services/` files (which still work for compatibility).

---

## 14. Imports of nested types (JLS §7.5.1)

```java
import java.util.Map.Entry;
```

The compiler treats `Map.Entry` as a single-type import. The nested type `Entry` becomes available by its simple name within the compilation unit.

Wildcard imports of nested types:

```java
import java.util.Map.*;
```

Brings all nested types of `Map` into scope.

---

## 15. The `Synthetic` flag

Compiler-generated members (bridge methods, package-info, anonymous-class accessors) are marked `ACC_SYNTHETIC = 0x1000`. Reflection's `Modifier.isSynthetic` filters them.

Most users don't see synthetic members. They show up in `javap -v` output and in detailed reflection.

---

## 16. Reading order

1. **JLS §7.3, §7.4, §7.5** — compilation units, packages, imports.
2. **JLS §7.7** — modules (if working with libraries or modular apps).
3. **JLS §6.6.1** — package access.
4. **JVMS §5.3** — runtime packages.
5. **JVMS §4.7.25, §5.3.6** — module attribute and runtime checks.

Sections are short. Reading them once resolves most "how does this work?" questions.

---

## 17. The takeaway

Packages are the *foundational organizing unit* of Java code. They span:

1. **Source**: namespace and import resolution (JLS §7).
2. **Compilation**: file system layout (build tool conventions).
3. **Bytecode**: class file's package (`InnerClasses`, fully qualified names).
4. **Runtime**: runtime packages keyed by `(name, defining class loader)` (JVMS §5.3).
5. **Modules**: another layer of access control on top (JLS §7.7, JVMS §4.7.25).

Understanding all five layers — and how they enforce each other — is what separates "I name files" from "I architect codebases." The right package structure makes refactoring cheap, encapsulation real, and architectural rules enforceable.
