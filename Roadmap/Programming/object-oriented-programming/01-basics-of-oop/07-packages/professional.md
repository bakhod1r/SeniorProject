# Packages — Professional (Under the Hood)

> **What's actually happening?** A package is a *naming and access control unit* defined by JLS §7. At the JVM level, a runtime package is identified by its name *and* defining class loader (JVMS §5.3); two classes with the same package name in different loaders are in *different* runtime packages. Modules add a layer of access control above packages. The classpath/modulepath, class loaders, and reflection all interact with this model.

---

## 1. Where the rules live

| Concept                              | Source                                  |
|--------------------------------------|-----------------------------------------|
| Package declarations                 | **JLS §7.4**                             |
| Package access (package-private)     | JLS §6.6.1                               |
| Compilation units                    | JLS §7.3                                 |
| Imports                              | **JLS §7.5**                             |
| Static imports                       | JLS §7.5.3, §7.5.4                       |
| Module declarations                  | **JLS §7.7** (Java 9+)                   |
| Runtime packages                     | **JVMS §5.3**                             |
| Module attribute                     | JVMS §4.7.25                              |
| Package-info attribute               | JVMS §4.7.5 (annotations)                 |
| Class loader / package relationship  | `java.lang.ClassLoader` documentation     |

---

## 2. JLS §7.3 — Compilation units

A Java source file is called a *compilation unit*. Structure:

```
CompilationUnit:
    OrdinaryCompilationUnit       // standard .java file
    ModularCompilationUnit         // module-info.java

OrdinaryCompilationUnit:
    [PackageDeclaration]
    {ImportDeclaration}
    {TypeDeclaration}
```

Rules:

- A compilation unit may contain at most one *public* top-level type.
- If a public type exists, the file must be named `TypeName.java`.
- Package declaration is optional (default: unnamed package).
- Imports follow the package declaration.

---

## 3. JLS §7.4 — Package declarations

```java
package com.example.foo;
```

Rules:

- Package name follows the dotted-identifier syntax: `Identifier(. Identifier)*`.
- Identifiers are letters/digits, but conventionally lowercase.
- Should not collide with reserved words.

A *package* in JLS terms has:

- A name.
- A set of compilation units that declare it.
- The types declared in those units.

The actual *physical* mapping (directory structure) is implementation-defined but conventionally `com/example/foo/` for `com.example.foo`.

---

## 4. JVMS §5.3 — Runtime packages

JVMS introduces *runtime packages*:

> *At run time, a class or interface is determined not only by its binary name (§4.2.1) but also by its defining class loader (§5.3). Two classes in the same package, but loaded by different class loaders, are not the same runtime class.*

So:

```
com.example.Foo (loaded by L1)   ≠   com.example.Foo (loaded by L2)
```

Runtime package equality requires: same package name AND same defining class loader.

Practical implications:

- App servers can isolate apps by giving each its own loader.
- Two apps with `com.example.Foo` are unrelated runtime types.
- Cross-loader package-private access is *forbidden* — they're different runtime packages.

---

## 5. JLS §7.5 — Imports

Three forms:

```java
import java.util.List;                    // single-type-import declaration
import java.util.*;                       // type-import-on-demand declaration
import static java.lang.Math.PI;           // single-static-import declaration
import static java.lang.Math.*;            // static-import-on-demand declaration
```

Resolution rules:

- Single-type imports take precedence over on-demand imports.
- Imports from the same package as the current compilation unit are implicit.
- `java.lang` is implicitly imported into every compilation unit.

Imports do *not* affect bytecode — they're resolved at compile time. Wildcard imports don't cost anything beyond compile time.

---

## 6. JLS §7.5 — Import grammar details

Imports may not change semantics in subtle ways:

```java
import java.util.List;
import java.awt.List;     // ❌ ambiguity error
```

Two single-type imports of the same simple name from different packages produce a compile error.

Wildcard imports don't produce errors — they're resolved by:

1. Imports from explicit single-type imports first.
2. Then from wildcard imports.
3. Then from the current package.
4. Then from `java.lang`.

The first match wins. Beyond that, ambiguity at the use site is an error.

---

## 7. JLS §7.7 — Module declarations

A `module-info.java` file:

```
ModularCompilationUnit:
    {ImportDeclaration}
    ModuleDeclaration

ModuleDeclaration:
    {Annotation} [open] module Identifier {. Identifier} { {ModuleDirective} }

ModuleDirective:
    requires {RequiresModifier} ModuleName ;
    exports PackageName [to ModuleName {, ModuleName}] ;
    opens PackageName [to ModuleName {, ModuleName}] ;
    uses TypeName ;
    provides TypeName with TypeName {, TypeName} ;
```

Each directive has runtime semantics:

- `requires`: load the module; access its exports.
- `exports`: make this package's `public` types accessible to consumers.
- `opens`: allow deep reflection (`setAccessible(true)`) into this package.
- `uses` / `provides`: integration with `ServiceLoader`.

The module is enforced by the JVM at class-load time and at reflective access time.

---

## 8. JVMS §4.7.25 — Module attribute

Compiled `module-info.class` contains a `Module` attribute:

```
Module_attribute {
    u2 attribute_name_index;
    u4 attribute_length;
    u2 module_name_index;
    u2 module_flags;            // ACC_OPEN, ACC_SYNTHETIC, ACC_MANDATED
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

The runtime parses this to construct the `Module` object. Reflection on a `Module` (`Module.getDescriptor()`) returns a `ModuleDescriptor` derived from this attribute.

---

## 9. The bootstrap, platform, and application class loaders

JVMS §5.3 defines three default loaders:

- **Bootstrap class loader** (written in C++ inside the JVM): loads core classes like `java.base/java.lang.Object`. No parent.
- **Platform class loader**: loads platform modules (everything in `lib/modules` that isn't `java.base`).
- **System / application class loader**: loads classes from the classpath (-cp) and modulepath (--module-path).

User code typically runs in the application loader. Custom class loaders (URLClassLoader, plugin systems) extend this hierarchy.

Two classes loaded by different loaders are different runtime classes — even if from the same `.class` file.

---

## 10. Class loader delegation

Default delegation (parent-first):

1. Class loader checks if class is already loaded.
2. If not, asks parent loader to load it.
3. If parent fails, attempts to load it itself.

This means a class in `java.lang` *always* comes from the bootstrap loader, regardless of which loader you use to ask for it. Custom loaders cannot override JDK classes.

OSGi and other plugin systems sometimes invert this (child-first) for isolation. Most standard apps use parent-first.

---

## 11. JLS §6.6.1 — Package-private access

Per JLS:

> *If the member or constructor is declared with no access modifier, then the access is permitted only when both `C` and `D` are members of the same runtime package (§5.3 of JVMS).*

The "runtime package" qualification is important: same package name *and* same defining class loader. Cross-loader access is forbidden even within the same package name.

This is what isolates webapps in app servers — package-private members can't leak across deployments.

---

## 12. Module access checks

Java 9+ adds module-level access checks. Every reflective or bytecode reference goes through:

1. Language access (JLS §6.6) — public, package-private, etc.
2. Module access (JVMS §5.3.6) — is the package exported?
3. Reflective access (`opens` for `setAccessible`) — for deep reflection only.

`Class.forName(...)` may now fail with `ClassNotFoundException` even when the class exists — if it's in a non-exported package.

---

## 13. Annotations on packages

A `package-info.java` may carry annotations:

```java
@NonNullByDefault
package com.example.foo;
```

Internally, these compile to a `package-info.class` containing a class file with `ACC_INTERFACE | ACC_ABSTRACT | ACC_SYNTHETIC` flags and the annotations attached. Reflection (`Package.getAnnotations()`) reads them.

The class itself has no methods or fields — it exists purely to carry the package's metadata.

---

## 14. Reflection API for packages

```java
Package p = Class.forName("...").getPackage();
p.getName();                      // "com.example.foo"
p.getAnnotations();                // package-level annotations
p.getSpecificationTitle();         // from MANIFEST.MF
p.getImplementationTitle();        // from MANIFEST.MF
```

Java 9+ adds module info:

```java
Module m = Class.forName("...").getModule();
m.getName();                       // module name
m.isOpen();                        // open module?
m.canRead(otherModule);            // reads-relationship?
m.isExported("pkg");               // is this package exported?
```

---

## 15. The `Synthetic` flag

Compiler-generated members (bridge methods, anonymous-class accessors, package-info classes) are marked with `ACC_SYNTHETIC = 0x1000`. Reflection's `Modifier.isSynthetic` filters them out.

Most users don't see synthetic members. Tools (debuggers, decompilers) can show them when needed.

---

## 16. The `jdeps` tool

A standard JDK tool for analyzing dependencies:

```
$ jdeps --module-path . my-app.jar
$ jdeps --jdk-internals my-app.jar      (find internal JDK references)
$ jdeps --check com.example.lib          (check module declaration)
```

Produces:

- Module dependency graph.
- Package dependency graph.
- Internal-API usage (the things that broke under JPMS).
- Cyclic dependencies.

For senior architects, `jdeps` is the canonical tool for understanding what depends on what at the package and module level.

---

## 17. Tools you should know

| Tool                     | What it shows                                   |
|--------------------------|-------------------------------------------------|
| `jdeps`                  | Package and module dependency graph              |
| `javap -v`               | Class file contents including module attribute   |
| `Class.getModule()`      | Runtime module information                        |
| `ModuleLayer.boot()`     | Boot-layer module configuration                   |
| `ServiceLoader.load(...)`| Service loading via `uses`/`provides`             |
| `ArchUnit`               | Architectural tests for package layout            |
| `--add-exports`, `--add-opens` | Runtime overrides for module access         |

---

## 18. Professional checklist

For each package:

1. Does it have a `package-info.java` with annotations and documentation?
2. Are runtime packages distinct? (Same package name across loaders is OK only if intentional.)
3. For modules: are exports / opens correct? Use `jdeps --check`.
4. Are package-level dependencies acyclic? Use `jdeps` or ArchUnit.
5. Are tests in the same package as production?
6. For libraries: is the API package separate from internal?
7. Is the directory structure correctly mirroring the package name?
8. Are there any split packages? (Same package across two jars/modules.)

For class loaders:

9. Are custom loaders documented?
10. Do test isolation strategies (different loaders per test) interact correctly with package-private access?

Professional package management is *infrastructural*: the package structure dictates how the codebase scales, how teams interact, and how easily a feature can be extracted or shipped. Get the foundations right and refactoring becomes a continuous cheap activity.
