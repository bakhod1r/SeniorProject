# Packages — Interview

> 50+ Q&A across all levels.

---

## Junior (1–15)

### Q1. What is a package in Java?
A namespace that groups related classes/interfaces. It also acts as an access boundary — same-package classes see each other's package-private members.

### Q2. How do you declare a package?
With `package com.example.foo;` as the first statement of a `.java` file. The directory structure must match (`com/example/foo/`).

### Q3. What is the unnamed package?
The default package, used when no `package` declaration exists. Suitable for tiny scripts; not for real applications. Cannot be imported by named packages.

### Q4. What's the convention for package naming?
Reverse-DNS — `com.organization.project.module`. All lowercase. Hierarchical structure conveys relationships.

### Q5. What is package-private access?
Default access (no modifier). Visible only within the same package. The most-overlooked-by-juniors access level — and one of the most useful for encapsulation.

### Q6. What does `import java.util.*;` mean?
Imports all public types from `java.util`. The `*` is a wildcard, not a regex. It doesn't recursively import sub-packages — `java.util.concurrent` is NOT imported.

### Q7. Is `java.lang` automatically imported?
Yes. Every Java compilation unit has `java.lang.*` implicitly available.

### Q8. What's a static import?
`import static some.Class.method;` (or `... .field;`) brings static members into scope without their class qualifier. Useful for test assertions; use sparingly otherwise.

### Q9. What's a `package-info.java` file?
A special file containing only a package declaration plus its Javadoc and optional annotations. Documents the package as a whole.

### Q10. Can you import nested classes?
Yes: `import java.util.Map.Entry;`. Or use the wildcard `import java.util.Map.*;`. Or qualify in the source: `Map.Entry e = ...;`.

### Q11. What does `java.util.Date` vs `java.sql.Date` ambiguity look like?
If you `import java.util.Date;` and `import java.sql.Date;`, the compiler errors with "ambiguous reference." Resolution: import one, fully qualify the other in the source.

### Q12. How does the file path relate to package name?
`com.example.foo` → directory `com/example/foo/`. `Foo.java` declaring `package com.example.foo;` should be at `<src>/com/example/foo/Foo.java`.

### Q13. Can a single file contain multiple top-level classes?
Yes, but at most one can be `public` — and its name must match the file name. Other classes must be package-private.

### Q14. What's the difference between `import` and `require`?
- `import` (always): brings types into scope at compile time.
- `requires` (Java 9+, in `module-info.java`): declares a module dependency.

You need both: `requires` for module access, `import` for using types.

### Q15. Does wildcard import affect performance?
No. The compiler resolves only the types you actually use. Wildcard imports are purely a source-level convenience.

---

## Middle (16–30)

### Q16. Why prefer "package by feature" over "package by layer"?
- Package by feature: each feature is self-contained. Easier extraction, better encapsulation, fewer cross-package dependencies.
- Package by layer: separates by technical role (controllers, services, repos). Bad for large apps — every feature touches every layer's package.

For new projects, package by feature is almost always the better choice.

### Q17. What's the "API/internal" split pattern?
Sub-packages within a feature:
- `com.example.feature.api` — public API (interfaces, DTOs, factories).
- `com.example.feature.internal` — implementations (package-private).

External code uses only `api/*`. Combined with JPMS modules, the internal package can be truly hidden.

### Q18. What's a "split package" and why is it bad?
A package whose classes are spread across multiple jars/modules. Pre-modules: legal but classpath-order dependent. Post-modules: explicitly forbidden. Always consolidate or rename.

### Q19. How does package-private interact with class loaders?
Same package + same defining class loader → same runtime package. Different loader = different runtime package, even if same name. So in app servers, package-private code from different webapps cannot collaborate.

### Q20. What tools detect cyclic package dependencies?
- `jdeps -c` (built into JDK).
- ArchUnit (test-time architecture rules).
- IntelliJ's Dependency Structure Matrix.
- Sonar plugins.

Cycles between packages are an architectural smell.

### Q21. Why prefer single imports over wildcard?
- Explicit: shows what's actually used.
- Avoids ambiguity (`Date` clashes).
- IDE auto-import handles them; no manual maintenance cost.

Some teams allow wildcards for test assertions only.

### Q22. What does `package-info.java` typically contain?
Package-level Javadoc and annotations:

```java
/**
 * Banking domain.
 */
@NonNullByDefault
package com.example.banking;
```

It's the package's manifest — read it before exploring the package's contents.

### Q23. Why might `import com.example.banking.*;` not match `com.example.banking.subdir.Foo`?
Because wildcards don't recurse into sub-packages. Each sub-package needs its own import. Java packages are NOT hierarchical for access purposes.

### Q24. What's the relationship between packages and modules?
- Packages: source-level grouping; access enforcement at compile + bytecode level.
- Modules (Java 9+): runtime-level grouping with explicit dependencies and exports. A module owns one or more packages.

Modules add a layer above packages — even `public` types are inaccessible if their package isn't `exported`.

### Q25. What's the danger of accessing `sun.misc.Unsafe` or `com.sun.*`?
These are *internal* JDK packages. Using them couples your code to a specific JDK implementation. Java 9+ JPMS strong-encapsulates these — `jdeps --jdk-internals` flags them; runtime access fails without `--add-opens`.

For new code, use `VarHandle`, `MethodHandle`, or the Foreign Function & Memory API as supported alternatives.

### Q26. How do you test package-private code?
Place the test in the same package:

```
src/main/java/com/example/foo/Foo.java
src/test/java/com/example/foo/FooTest.java
```

The test sees package-private members. No production access widening needed.

### Q27. What's the difference between `requires` and `requires transitive`?
- `requires X`: I depend on X.
- `requires transitive X`: I depend on X, AND any module that depends on me also gets X automatically.

Use `transitive` when X is part of your public API (e.g., your method returns a type from X).

### Q28. What's an `opens` directive for?
Allows reflection (`setAccessible(true)`) into a package from outside the module. Without `opens`, reflection on private members fails with `InaccessibleObjectException`.

Frameworks that reflect on app code (Jackson, Hibernate) need their target packages `opens`-ed.

### Q29. What's a "shared kernel" pattern?
A small package containing types shared across multiple features:

```
com.example.shared/
├── Money.java
├── Email.java
└── Result.java
```

The shared kernel is depended on by many but depends on nothing. Keep it small to avoid becoming a god-package.

### Q30. Why is `java.lang` not in `java.lang.*`?
It is — `java.lang.String` is in `java.lang`. The auto-import is `import java.lang.*;`. The "java.lang" name is just the package; `Math`, `Integer`, etc. are types within it.

---

## Senior (31–42)

### Q31. How would you refactor an "everything public" codebase?
1. Audit `public` declarations. Find ones with callers only inside the package.
2. Reduce to package-private.
3. Move tests into the same package as production.
4. Run static analyzers (Error Prone, IntelliJ) to flag remaining over-publicity.
5. Repeat for each package.

The goal: 5-10x fewer public types. Refactoring becomes much cheaper.

### Q32. What's the right granularity for a package?
1-3 public types as the API. 5-30 total classes. Anything bigger usually has hidden sub-features that should be sub-packages.

### Q33. How does JPMS strong encapsulation differ from package-private?
- Package-private: enforced by `javac` and bytecode verifier. Cross-package code from the same classloader can't see it.
- JPMS: enforced at runtime. Even `public` types in non-exported packages are inaccessible.

JPMS adds a layer above package-private. Both work together.

### Q34. When would you use `requires static`?
For optional dependencies — required at compile time but not at runtime. Common for compile-time annotation processors:

```java
requires static org.slf4j.api;     // optional logging
```

If your code references `Logger` types but the runtime doesn't have SLF4J, no `ClassNotFoundException` because the dependency is optional.

### Q35. What architectural rules would you enforce in CI?
With ArchUnit:
- No cycles between packages.
- Controllers in `..controller..` packages only.
- Services depend only on `domain` and `api` packages.
- No reverse dependencies (high-level → low-level only).
- No reflection on `internal` packages.

Tests run as part of CI; new PRs must comply.

### Q36. How do you handle the "shared kernel" growth problem?
- Keep types in shared kernel only if used by 3+ features.
- Move feature-specific types out into their owning feature.
- For utilities, prefer per-feature ownership over a centralized `util` package.
- Audit annually; remove dead code.

### Q37. What's the difference between `exports` and `exports to`?
- `exports com.example.api;` — exports to all consumers.
- `exports com.example.api to com.example.consumer1, com.example.consumer2;` — qualified export, only those modules see it.

Qualified exports let you expose internal APIs to specific friend modules without exposing globally.

### Q38. How do you migrate a classpath app to JPMS?
1. Start with libraries: add `module-info.java` to your jars.
2. Apps continue running on classpath; libraries work in both modes.
3. Add `module-info.java` to apps when ready.
4. Use `jdeps` to find unwanted internal JDK uses; fix them.
5. Document any `--add-opens` flags needed for legacy frameworks.

Most enterprise apps stay at step 1-2 indefinitely; library authors typically reach step 1.

### Q39. Why might a senior recommend "vertical slices" over "package by layer"?
- Each slice (feature) is self-contained.
- Easier to extract into a microservice later.
- Less cross-package coupling.
- Better encapsulation through API/internal split.
- Scales better as features multiply.

Layer-based packaging works for small apps but becomes unwieldy past ~10 features.

### Q40. What's a `package-info.java` actually compiled to?
A `package-info.class` with `ACC_INTERFACE | ACC_ABSTRACT | ACC_SYNTHETIC` flags, no methods, no fields. Carries the package's annotations and Javadoc.

Reflection's `Package.getAnnotations()` reads it.

### Q41. What's the relationship between class loaders and package access?
Same package name + different class loaders = different runtime packages. So package-private code from one loader cannot access package-private code from another, even with the same package name.

This is what makes app server isolation work.

### Q42. What's `--add-opens` and when is it appropriate?
A runtime flag that opens a package for deep reflection from outside the module:

```
java --add-opens java.base/java.lang=ALL-UNNAMED ...
```

Appropriate as a *temporary* crutch when migrating frameworks to JPMS. Long-term: declare `opens` in `module-info.java` or use a JPMS-aware library.

---

## Professional (43–52)

### Q43. How does the compiler resolve an ambiguous wildcard import?
JLS §7.5.4: single-type imports take precedence over wildcards. If two wildcards each provide a type with the same simple name, and you reference that name unqualified, you get a compile-time ambiguity error.

The fix is a single-type import overriding one of them.

### Q44. What is `java.lang.Package` and how is it used?
A reflection class representing a Java package at runtime. `Class.getPackage()` returns it. Provides annotations, name, and (from MANIFEST.MF) specification/implementation title.

Java 9+ added `Module` for module-level reflection; `Package` remains for backward compatibility.

### Q45. What's the JVMS definition of a runtime package?
JVMS §5.3: a runtime package is identified by its name and its defining class loader. Two classes with the same package name but different defining loaders are in different runtime packages — and cannot access each other's package-private members.

### Q46. How does `ServiceLoader` interact with packages and modules?
`ServiceLoader.load(Service.class)` finds providers via:
- Module: `provides Service with Impl;` directives.
- Classpath: `META-INF/services/com.example.Service` files listing impl class names.

Both mechanisms work; modules are preferred for new code. Classpath fallback is for compatibility.

### Q47. What's the cost of a wildcard import?
Zero runtime cost. Compile-time cost is negligible — the compiler resolves only types you actually reference.

The cost is *cognitive*: readers can't tell at a glance which types come from which packages. Tools mitigate this; conventions decide whether to allow.

### Q48. How does JPMS handle reflective access from libraries?
A library reflecting on app types must:
- Be in a module declared as a consumer (`requires`).
- Have the app's package `opens`-ed to it (via `opens com.app.entities to com.lib;`).
- Or use `MethodHandles.privateLookupIn(...)` with the app's lookup.

Without these, reflection fails with `InaccessibleObjectException`.

### Q49. What's the difference between `Module.canRead(otherModule)` and `Module.isExported(pkg)`?
- `canRead`: does this module `requires` (transitively) the other?
- `isExported`: is this package exported (to all or to a specific target)?

Both must be true for cross-module access.

### Q50. What's an "automatic module"?
A non-modular jar placed on the modulepath. JPMS treats it as a module, deriving the module name from the jar filename (or from `Automatic-Module-Name` in MANIFEST.MF). All packages are automatically exported.

Convenient for migrating legacy jars; not a long-term solution. Library authors should ship proper `module-info.java`.

### Q51. How does `--add-exports` differ from `--add-opens`?
- `--add-exports`: makes a non-exported package's `public` types accessible at compile and runtime (no reflection bypass).
- `--add-opens`: additionally allows reflective access to private members.

Use `--add-exports` for normal API-style access. Use `--add-opens` only when reflection on privates is needed.

### Q52. How do you debug a "package not visible" error?
- For compile errors: check imports and module dependencies. Use `jdeps`.
- For runtime errors: check `--add-exports` / `--add-opens` flags. Check `Module.isExported(pkg)` reflectively.
- For test errors: check that test classloader has the same module configuration as production.
- For library issues: check the library's `Automatic-Module-Name` or `module-info.java`.

---

## Behavioral / Design (bonus)

- *"Tell me about a package design that worked well."* — concrete example: a payments feature split into api/internal/domain, with clear `module-info.java`, ArchUnit tests, all internal classes package-private. Refactors took hours, not days.
- *"How would you organize a 200-class codebase?"* — vertical slices by feature; small shared kernel; API/internal split per slice; ArchUnit rules in CI.
- *"What's wrong with `com.example.util.*`?"* — junk drawer; loses cohesion; classes don't cooperate. Replace with feature-specific ownership.

The senior pattern: specific examples, named trade-offs, references to tools (jdeps, ArchUnit). Generic platitudes ("packages should be small") aren't signal.
