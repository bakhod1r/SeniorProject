# JPMS — Java Platform Module System — Junior

> **What?** The **Java Platform Module System** (JPMS, introduced in Java 9 by **JEP 261**) adds a unit of code organisation *above* the package: a **module**. A module declares — in a small file called `module-info.java` — which packages it exposes to the outside world, which other modules it depends on, and which services it consumes or provides. The JDK itself was split into modules (`java.base`, `java.sql`, `java.xml` …) by **JEP 200**.
> **How?** You put every package of your library or app into a single named module, write a `module-info.java` at the root of its source tree, and let `javac` plus the runtime enforce the boundary. Anything you didn't `exports` is *invisible* to other modules — not just by convention, but at the JVM level.

---

## 1. Why modules exist at all

Before Java 9, the unit of deployment was the JAR. Anything `public` in a JAR was reachable from any other JAR on the classpath. `public` actually meant *world-visible* — there was no way to say "this class is `public` for the rest of my library, but private to anything outside it".

The consequences were structural:

- Internal helpers (`sun.misc.Unsafe`, `com.sun.org.apache.xml.internal.*`) were used by application code that shouldn't have known they existed.
- A six-JAR library exposed thousands of `public` classes that were only meant for the other five JARs to call.
- "Jar hell" — two versions of the same library on the same classpath silently shadowed each other.
- The JDK could not be sliced into smaller distributions; every running JVM carried CORBA, RMI, JAXB, and the whole tower.

JPMS introduces a real boundary. A module can have `public` classes that are still *inaccessible* outside the module — `public` becomes "visible within this module" by default, and you opt classes *out* into a wider scope by listing their packages in `exports`. `java.base` exposes about 30 packages; it contains hundreds.

---

## 2. Your first `module-info.java`

A module declaration lives in a file called *exactly* `module-info.java`, at the root of the module's source folder, next to (not inside) the top-level package directories. It is compiled to a class file named `module-info.class`.

```
src/
  com.example.greeting/
    module-info.java
    com/example/greeting/
      Greeter.java
```

```java
// module-info.java
module com.example.greeting {
    exports com.example.greeting;
}
```

```java
// com/example/greeting/Greeter.java
package com.example.greeting;

public class Greeter {
    public String greet(String name) {
        return "Hello, " + name + "!";
    }
}
```

A consumer module:

```java
// module-info.java
module com.example.app {
    requires com.example.greeting;
}
```

```java
package com.example.app;
import com.example.greeting.Greeter;

public class App {
    public static void main(String[] args) {
        System.out.println(new Greeter().greet("Java"));
    }
}
```

Compile and run on the **module path** instead of the classpath:

```
javac -d out --module-source-path src $(find src -name "*.java")
java  --module-path out --module com.example.app/com.example.app.App
```

The `--module-path` (or `-p`) is to modules what `--class-path` is to JARs. The `--module` flag picks the entry-point module and main class.

---

## 3. The vocabulary of `module-info.java`

A module declaration is a tiny language of its own. The keywords you'll meet first:

| Keyword               | What it does                                                               |
|-----------------------|----------------------------------------------------------------------------|
| `module X`            | Declares a module named `X`.                                               |
| `requires Y;`         | Compile-time **and** runtime dependency on module `Y`.                     |
| `requires transitive Y;` | Same, and any module that `requires X` also implicitly `requires Y`.    |
| `requires static Y;`  | Compile-time only — the module may be absent at runtime (annotations, optional integrations). |
| `exports p;`          | Package `p` is visible to *every* other module.                            |
| `exports p to A, B;`  | Package `p` is visible only to modules `A` and `B` (a *qualified* export). |
| `opens p;`            | Package `p` is accessible *via reflection* to every module (deep reflection). |
| `opens p to A;`       | Same, but only to module `A` (Spring, Hibernate use this).                 |
| `uses S;`             | This module looks up a service `S` via `ServiceLoader`.                    |
| `provides S with Impl;` | This module supplies `Impl` as an implementation of service `S`.         |

You will not need all of them on day one. A module that depends on a couple of others and exports its public API will look like:

```java
module com.example.orders {
    requires com.example.payments;
    requires java.sql;
    exports com.example.orders.api;
}
```

`java.base` is *always* a `requires` — you don't write it; the compiler adds it for you.

---

## 4. The four keywords you must know first

### `requires`

Names a module you depend on. The compiler enforces that you can only `import` from `requires`d modules. At runtime the JVM enforces that those modules are resolvable on the module path.

```java
module com.example.orders {
    requires java.sql;            // because we use java.sql.Connection
    requires com.example.money;   // our own money library
}
```

If `java.sql` is missing at runtime, the JVM fails to start with a `FindException`, not with a `ClassNotFoundException` halfway through execution. The error moves earlier in time — that's a big part of JPMS's value.

### `exports`

Declares which packages are visible to other modules. **A package that isn't exported is invisible** — `public` classes inside it are unreachable from outside the module, even by reflection. This is the strong encapsulation guarantee.

```java
module com.example.orders {
    exports com.example.orders.api;    // visible
    // com.example.orders.internal is NOT exported — invisible to consumers
}
```

A consumer that writes `import com.example.orders.internal.Tx;` gets a compile error. Even reflection (`Class.forName("com.example.orders.internal.Tx")`) succeeds in finding the class but fails to access its members from outside the module.

### `opens`

Sometimes a framework legitimately needs *reflective* access to your code that you don't otherwise want exported. Hibernate reads private fields to hydrate entities; Spring instantiates beans by reflection; Jackson serialises private getters. `opens` is the gate for those uses.

```java
module com.example.orders {
    exports com.example.orders.api;          // normal API
    opens   com.example.orders.entity to org.hibernate.orm.core;  // reflective only
}
```

`exports` is for the *compile-time* type system. `opens` is for the *runtime* reflection system. A package can be exported, opened, both, or neither — they are independent dimensions.

### `uses` / `provides`

Java's `ServiceLoader` mechanism is the JPMS-blessed way to inject implementations across module boundaries without naming them at the consumer.

```java
// In the abstraction module:
module com.example.payments.api {
    exports com.example.payments.api;
    uses    com.example.payments.api.PaymentGateway;   // I will look one up
}

// In the implementation module:
module com.example.payments.stripe {
    requires com.example.payments.api;
    provides com.example.payments.api.PaymentGateway
        with com.example.payments.stripe.StripeGateway;
}
```

`ServiceLoader.load(PaymentGateway.class)` finds `StripeGateway` at runtime without the API module ever naming Stripe.

---

## 5. Module path vs classpath

A modern Java application can mix two worlds:

- **Module path** — JARs that have a `module-info.class` are *named modules*. The runtime knows their name, their dependencies, their exports.
- **Classpath** — JARs without `module-info.class` end up in the *unnamed module* on the classpath. The unnamed module can read every other module, but no named module can read *it* by name.

```
java --module-path mods --class-path libs --module com.example.app/com.example.app.App
```

A third category, the **automatic module**, is the bridge. A JAR placed on the module path *without* a `module-info.class` becomes a named module whose name is derived from the JAR file name (or read from `Automatic-Module-Name` in the JAR manifest, which the JAR author can set). It exports *everything* and reads *every* other module — basically a relaxed citizen of the module world, used as a stepping stone during migration.

---

## 6. Hello, real example

A two-module project — `com.example.math` exposes a calculator, `com.example.app` uses it.

```
src/
  com.example.math/
    module-info.java
    com/example/math/Calculator.java
  com.example.app/
    module-info.java
    com/example/app/Main.java
```

```java
// src/com.example.math/module-info.java
module com.example.math {
    exports com.example.math;
}
```

```java
// src/com.example.math/com/example/math/Calculator.java
package com.example.math;
public class Calculator {
    public int add(int a, int b) { return a + b; }
}
```

```java
// src/com.example.app/module-info.java
module com.example.app {
    requires com.example.math;
}
```

```java
// src/com.example.app/com/example/app/Main.java
package com.example.app;
import com.example.math.Calculator;

public class Main {
    public static void main(String[] args) {
        System.out.println(new Calculator().add(2, 3));
    }
}
```

Compile and run:

```
javac -d out --module-source-path src $(find src -name "*.java")
java --module-path out --module com.example.app/com.example.app.Main
```

Output: `5`. The two modules are independently resolvable; if you delete `com.example.math` at runtime, the JVM tells you up front rather than failing inside `Main`.

---

## 7. Common confusions for newcomers

**`requires` is compile *and* runtime, not just compile.** Unlike a Maven `provided` scope, `requires` means "this module must also be on the module path when I run". The compile-time-only sibling is `requires static`.

**`exports` is about packages, not classes.** You cannot export an individual class — you export the package, and every `public` class inside it becomes visible. The unit of encapsulation is the package.

**`public` no longer means "visible everywhere".** Inside a module, a `public` class in a non-exported package is visible to other code in the same module, but invisible to outsiders. Module modifiers refine `public`, they don't replace it.

**Automatic modules are a migration aid, not a destination.** They work, but their name is derived from a file name, which is fragile. A library on the module path should ship a real `module-info.java` long-term.

**`module-info.java` is *not* `package-info.java`.** They are different files, in different locations, with different syntax. `package-info.java` carries package-level annotations; `module-info.java` carries the module declaration.

**The default module is unnamed, not nonexistent.** Code on the classpath always belongs to *the* unnamed module of its class loader. The unnamed module can read everyone and reflectively access most things — that's why classpath code mostly "just works" even after JPMS shipped.

---

## 8. Tiny troubleshooting checklist

When a module project won't start, walk this list:

- `javac` says **"package X is not visible"**. Either you forgot `requires Y` (where `Y` exports `X`), or `Y` doesn't `exports X` at all.
- Runtime says **"module Y not found"**. The module isn't on `--module-path`. Check the path; check that the JAR has a `module-info.class`.
- Runtime says **"cannot access class A.B because module M does not export A"**. Reflection (or a framework) tried to read a non-exported package. The fix is usually `opens A to <framework-module>;` — or `exports A;` if it really is API.
- Runtime says **"module com.example.x reads package P from both A and B"**. Two modules export the same package — a *split package*. Move the package, rename one half, or merge.
- `requires` X but you imported from Y and the compiler complains. `X` may export `Y`'s package transitively via `requires transitive` — but if it doesn't, add `requires Y;` directly.

---

## 9. Where you'll meet modules in the wild

- **The JDK itself.** `java.base`, `java.sql`, `java.xml`, `java.logging`, `java.net.http`, `java.management` are all modules. Open the JDK with `java --list-modules` to see them.
- **`jlink` runtime images.** A custom runtime that contains only `java.base` plus your app's modules is dramatically smaller than a full JDK (see [middle.md](middle.md) and [optimize.md](optimize.md)).
- **Libraries with explicit boundaries** — JavaFX, Jackson 2.x (partially), JUnit 5 (Jupiter is a module).
- **Frameworks via `opens`** — Spring, Hibernate, Lombok ask you to `opens` packages so they can hydrate / weave / inject by reflection.

---

## 10. Quick rules

- [ ] One module per logically coherent library or app; module names use reverse-DNS dotted notation (`com.example.orders`).
- [ ] `requires` is compile + runtime; `requires static` is compile-only; `requires transitive` re-exports.
- [ ] `exports` is for the type system; `opens` is for reflection; they are independent.
- [ ] Don't export internals — leave them unexported and visible only within the module.
- [ ] Module path is the new home for JARs with `module-info.class`; classpath still works for legacy JARs.
- [ ] Use the **automatic module** mechanism only as a migration stepping stone.
- [ ] `ServiceLoader` plus `uses` / `provides` is the canonical cross-module plugin point.
- [ ] You don't need to declare `requires java.base` — it's implicit.

---

## 11. What's next

| Topic                                                                  | File              |
| ---------------------------------------------------------------------- | ----------------- |
| Converting a multi-package classpath app to modules                    | [middle.md](middle.md)            |
| Strong encapsulation, frameworks, jlink, JEP 396 / 403                 | [senior.md](senior.md)            |
| Library authoring, ArchUnit module rules, `--add-opens` policy         | [professional.md](professional.md)      |
| Where JPMS lives in the JLS / JVMS, the relevant JEPs                  | [specification.md](specification.md)     |
| Ten module-system bugs and their fixes                                 | [find-bug.md](find-bug.md)          |
| jlink images, AppCDS per module, startup gains                         | [optimize.md](optimize.md)          |
| Hands-on JPMS exercises                                                | [tasks.md](tasks.md)             |
| Interview Q&A on modules                                               | [interview.md](interview.md)         |

Related sections you may want to read alongside:

- Sibling: [../01-sealed-classes-and-pattern-matching/](../01-sealed-classes-and-pattern-matching/)
- Design principles JPMS supports: [../../03-design-principles/04-cohesion-and-coupling/](../../03-design-principles/04-cohesion-and-coupling/)
- General modules section in the roadmap: [../../../../07-modules/](../../../../07-modules/)

---

**Memorize this:** a module is a *named* group of packages with explicit `requires` and `exports`. `exports` controls the compile-time type system; `opens` controls runtime reflection. JARs without `module-info` live on the classpath (unnamed module) or, placed on the module path, become *automatic* modules — a temporary bridge. Move from "every public class is world-visible" to "only what I `exports` is world-visible", and almost every modularisation pain you have heard about disappears.
