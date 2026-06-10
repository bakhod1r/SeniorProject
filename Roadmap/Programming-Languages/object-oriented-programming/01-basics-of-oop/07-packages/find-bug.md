# Packages — Find the Bug

> 12 buggy snippets where the bug is package-related. Read each, identify why it bites, when it bites, and the fix.

---

## Bug 1 — Wrong package declaration

```java
// File: src/main/java/com/example/Foo.java
package com.example.bar;          // ⚠ doesn't match directory

public class Foo { }
```

**Bug.** The package declaration says `com.example.bar`, but the file is in `com/example/`. Compile may succeed (depending on build tool), but the resulting class files end up in unexpected places, and consumers see import errors.

**Fix.** Either move the file to `com/example/bar/Foo.java` or change the declaration to `package com.example;`.

**Lesson.** Package name and directory must match. Standard build tools (Maven, Gradle) enforce this.

---

## Bug 2 — Two public classes in one file

```java
// File: Multi.java
public class Foo { }
public class Bar { }      // ❌ compile error — only one public top-level class allowed
```

**Bug.** A `.java` file can contain at most one `public` top-level class, and its name must match the file name.

**Fix.** Either make one of them package-private, or split into two files.

**Lesson.** One public class per file. Other classes can coexist as package-private helpers.

---

## Bug 3 — Wildcard import collision

```java
import java.util.*;       // imports java.util.Date
import java.sql.*;        // also imports java.sql.Date

Date d = new Date();      // ❌ ambiguous reference
```

**Bug.** Both `java.util.Date` and `java.sql.Date` are in scope. The compiler can't pick.

**Fix.** Single import for the one you want; fully qualify the other:

```java
import java.util.Date;
import java.sql.*;

Date utilDate = new Date();
java.sql.Date sqlDate = new java.sql.Date(...);
```

**Lesson.** Wildcards make ambiguity easy. Prefer single imports.

---

## Bug 4 — Missing import

```java
package com.example.app;

public class Main {
    public static void main(String[] args) {
        BankAccount a = new BankAccount();      // ❌ symbol not found
    }
}
```

**Bug.** `BankAccount` isn't in `com.example.app` or `java.lang`, and there's no import.

**Fix.**

```java
import com.example.banking.BankAccount;
```

**Lesson.** Beginners' first compile error. IDE auto-import handles 99% of cases.

---

## Bug 5 — Package-private class accessed from another package

```java
// com.example.banking
class BankAccount { }                    // package-private (no modifier)

// com.example.app
import com.example.banking.BankAccount;  // ❌ BankAccount not visible
public class Main {
    public static void main(String[] args) {
        BankAccount a = new BankAccount();
    }
}
```

**Bug.** `BankAccount` is package-private and invisible outside `com.example.banking`. The import fails.

**Fix.** Either make `BankAccount` `public`, or move `Main` into `com.example.banking`, or expose `BankAccount` via a public factory in the same package.

**Lesson.** Package-private means same-package only. Other packages can't even type the class name.

---

## Bug 6 — Sub-package not in wildcard scope

```java
import java.util.*;

ArrayList<Integer> list = new ArrayList<>();   // ✓ ArrayList is in java.util
ConcurrentHashMap<String, Integer> map = new ConcurrentHashMap<>();  // ❌ in java.util.concurrent
```

**Bug.** `import java.util.*` does NOT recursively import `java.util.concurrent.*`. Sub-packages need separate imports.

**Fix.**

```java
import java.util.*;
import java.util.concurrent.*;
```

**Lesson.** Java packages are flat for import purposes. Each sub-package is independent.

---

## Bug 7 — Unnamed package limitations

```java
// No package declaration
public class Hello { }
```

```java
package com.example;

public class App {
    public static void main(String[] args) {
        Hello h = new Hello();   // ❌ cannot import from unnamed package
    }
}
```

**Bug.** Named packages cannot import classes from the unnamed (default) package. The compiler can't even reference `Hello`.

**Fix.** Add a `package` declaration to `Hello.java`:

```java
package com.example.utility;
public class Hello { }
```

**Lesson.** The unnamed package is a dead end for any real project. Always declare a package.

---

## Bug 8 — Cyclic package dependency

```
com.example.a → com.example.b → com.example.a
```

Each package's classes import the other's.

**Bug.** Architecturally fragile. Refactoring one ripples to the other; tests run together; no clear separation. Build tools generally accept it (Java has no source-level cycle prohibition for packages), but `jdeps` flags it.

**Fix.** Identify the shared concept; extract it to a third package depended on by both:

```
com.example.a    →    com.example.shared
com.example.b    →    com.example.shared
```

**Lesson.** Cyclic dependencies compromise modularity. Detect with `jdeps -c` or ArchUnit; break by extraction or interface introduction.

---

## Bug 9 — Wrong import for nested class

```java
import java.util.Map;

Entry<String, Integer> e = ...;        // ❌ Entry not found
```

**Bug.** `Entry` is a nested type of `Map` (`Map.Entry`). The plain import doesn't bring it into scope unqualified.

**Fix.** Either:

```java
import java.util.Map;
Map.Entry<String, Integer> e = ...;     // qualified
```

Or:

```java
import java.util.Map;
import java.util.Map.Entry;              // import the nested type
Entry<String, Integer> e = ...;
```

**Lesson.** Nested types either need their own import or must be qualified.

---

## Bug 10 — Module not exporting needed package

```java
// module-info.java
module com.example.lib {
    exports com.example.lib;
    // forgot to export com.example.lib.types
}

// Consumer:
import com.example.lib.types.Foo;        // ❌ ClassNotFoundException at runtime
```

**Bug.** The package isn't exported. Even though `Foo` is `public`, JPMS hides it because its package isn't in the `exports` list.

**Fix.**

```java
module com.example.lib {
    exports com.example.lib;
    exports com.example.lib.types;
}
```

**Lesson.** JPMS modules require explicit `exports` for each package consumers should access.

---

## Bug 11 — Reflection blocked by missing `opens`

```java
// Consumer (Jackson):
new ObjectMapper().readValue(json, User.class);  // ❌ InaccessibleObjectException
```

```java
// Target module:
module com.example.users {
    exports com.example.users;
    // missing: opens com.example.users to com.fasterxml.jackson.databind;
}
```

**Bug.** Jackson uses reflection on `User`'s private fields. Without `opens`, `setAccessible(true)` fails.

**Fix.** Add the targeted `opens`:

```java
opens com.example.users to com.fasterxml.jackson.databind;
```

Or, for records, use Jackson's record support (no reflection on privates needed).

**Lesson.** `exports` allows compile/regular runtime access; `opens` allows reflection. Frameworks reflecting on app types need explicit `opens`.

---

## Bug 12 — Split package across modules

```
lib-a.jar (com.example.shared.A)
lib-b.jar (com.example.shared.B)

module com.app {
    requires lib.a;
    requires lib.b;        // ❌ split package error
}
```

**Bug.** The same package `com.example.shared` is contributed by two modules. JPMS forbids this — packages must belong to exactly one module.

**Fix.** Rename one of them, or merge them into a single module.

**Lesson.** Modules require packages to be uniquely owned. Pre-modules classpath was permissive (last-loaded wins); modules are strict.

---

## Pattern summary

| Bug type                                 | Watch for                                     |
|------------------------------------------|-----------------------------------------------|
| Source/path mismatch (1, 2)              | Package declaration vs file location          |
| Import issues (3, 4, 6, 9)               | Wildcards, missing imports, sub-package gotchas |
| Access (5)                                | Package-private vs public misalignment        |
| Unnamed package (7)                       | Named packages can't reference unnamed        |
| Architecture (8)                          | Cyclic dependencies                            |
| JPMS (10, 11, 12)                         | Missing exports/opens; split packages         |

These bugs come from the various rules of how packages, imports, and modules interact. Static analysis (Error Prone, IntelliJ inspections, jdeps, ArchUnit) catches most of them.
