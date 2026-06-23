# Packages — Junior

> **What?** A *package* is a namespace that groups related classes and interfaces. It also acts as an access boundary — classes in the same package see each other's package-private members.
> **How?** Declare a package at the top of a source file with `package com.example.foo;`, place the file in the corresponding directory (`com/example/foo/`), and import classes from other packages with `import`.

---

## 1. The two-line mental model

```java
// File: src/main/java/com/example/banking/BankAccount.java
package com.example.banking;

public class BankAccount { ... }
```

```java
// File: src/main/java/com/example/app/Main.java
package com.example.app;

import com.example.banking.BankAccount;        // bring it into scope

public class Main {
    public static void main(String[] args) {
        BankAccount a = new BankAccount();
    }
}
```

Two responsibilities of packages:

- **Namespace**: avoid name collisions. `com.example.banking.User` and `com.example.crm.User` can both exist.
- **Access boundary**: classes in the same package can see each other's package-private members; outsiders cannot.

---

## 2. Anatomy of a package declaration

```java
package com.example.banking;     // exactly one, must be the first statement (after comments)
```

Rules:

- Exactly one `package` declaration per file (or none, for the *unnamed* / default package).
- Must be the first statement in the file, before any imports.
- Package name uses lowercase + dots: `com.example.banking`. Mixed case is technically legal but conventionally avoided.
- The directory structure must match: `com/example/banking/` directory contains the `.java` file.

The convention: reverse-DNS-style names (`com.companyname.product.module`) — gives globally unique names without coordination.

---

## 3. Importing classes

```java
package com.example.app;

import com.example.banking.BankAccount;          // single import
import java.util.List;                           // standard library import
import java.util.*;                              // wildcard — imports all of java.util

public class Main { ... }
```

- **Single import**: `import com.example.banking.BankAccount;` — brings `BankAccount` into scope.
- **Wildcard import**: `import java.util.*;` — brings every public type from `java.util`.
- Wildcards are optional and don't affect performance — the compiler resolves only what you use.
- `java.lang` is **automatically imported** — you don't need `import java.lang.String;`.

Modern style: prefer single imports for clarity. IDE auto-import handles them.

---

## 4. Static imports

```java
import static java.lang.Math.PI;
import static java.lang.Math.sqrt;

public class Calc {
    double diagonal(double a, double b) { return sqrt(PI + a*a + b*b); }
}
```

`import static` brings static members (fields and methods) into scope without their class qualifier. Use sparingly — heavy static imports make code ambiguous.

Common acceptable uses: test assertions (`import static org.junit.jupiter.api.Assertions.*;`), math-heavy code, fluent DSLs.

---

## 5. Same-package access

Classes in the same package see each other's package-private members:

```java
// File: com/example/banking/BankAccount.java
package com.example.banking;
class BankAccount {                              // package-private
    long balance;                                 // package-private
    void debit(long cents) { ... }                 // package-private
}

// File: com/example/banking/Transfer.java
package com.example.banking;
public class Transfer {
    public static void move(BankAccount from, BankAccount to, long cents) {
        from.debit(cents);                        // ✓ same package
    }
}
```

`Transfer` reaches `BankAccount.debit` because they're in the same package. From `com.example.app`, that wouldn't work — `BankAccount` itself is package-private and invisible.

This is a foundational tool for **encapsulation at the package level**.

---

## 6. The unnamed (default) package

If you don't declare a `package`, the file lives in the *unnamed package*:

```java
public class Hello {                             // no package declaration
    public static void main(String[] args) {
        System.out.println("hi");
    }
}
```

The unnamed package:

- Is essentially a "top-level" package with no name.
- Cannot be imported by named packages (you can't `import Hello;`).
- Is fine for tiny scripts and exercises.
- Should **not** be used in real applications. Always declare a package.

---

## 7. Directory structure must match package name

```
src/main/java/
└── com/
    └── example/
        └── banking/
            ├── BankAccount.java   (package com.example.banking)
            └── Transfer.java       (package com.example.banking)
```

If `BankAccount.java` declares `package com.example.banking;` but lives in `src/main/java/wrong/path/`, the compiler will produce class files in the wrong place. Modern build tools (Maven, Gradle) enforce the structure.

---

## 8. Package naming conventions

Convention: reverse domain name + project + module:

```
com.example.banking
com.example.banking.api
com.example.banking.internal
org.springframework.boot
io.netty.handler.codec.http
```

Rules:

- All lowercase.
- Use ASCII letters and digits.
- Avoid Java reserved words (`int`, `class`, etc.).
- Hierarchical structure communicates relationships.

Don't use top-level names like `com`, `org`, `io` arbitrarily — pick what reflects your organization or project namespace.

---

## 9. Package-private — the "default" access

A class, field, method, or constructor *without* an access modifier is **package-private**:

```java
package com.example.foo;

class Helper { }                                 // package-private class
public class Service {
    int internalCount;                           // package-private field
    void internalMethod() { }                    // package-private method
}
```

Package-private is visible only inside `com.example.foo`. It's perfect for:

- Helper classes that are part of the package's implementation, not its API.
- Methods that should only be called by sibling classes.
- Test fixtures co-located with production code.

Many codebases under-use package-private. Default to it for internal collaboration; reserve `public` for the actual API.

---

## 10. Java's standard packages

A few you'll see constantly:

| Package          | Purpose                                          |
|------------------|--------------------------------------------------|
| `java.lang`      | Core types (`String`, `Integer`, `Object`). Auto-imported. |
| `java.util`      | Collections, dates, scanners, Optional.            |
| `java.io`        | I/O streams.                                       |
| `java.nio`       | Modern NIO (channels, buffers, paths).             |
| `java.time`      | Modern date/time (`LocalDate`, `Instant`).          |
| `java.net`       | Networking.                                        |
| `java.util.concurrent` | Concurrency utilities.                       |
| `java.util.stream` | Streams API.                                     |

Read the JDK API docs for each — they're well-organized and consistently designed.

---

## 11. Importing nested classes

```java
import java.util.Map;
import java.util.Map.Entry;                      // explicit nested import

Map.Entry<String, Integer> e = ...;
```

Or use the wildcard:

```java
import java.util.Map.*;                          // imports nested types of Map
```

Or just qualify in the source:

```java
import java.util.Map;
Map.Entry<String, Integer> e = ...;              // qualified — usually clearest
```

Qualified is most readable. Imports are less of a problem with modern IDEs.

---

## 12. The `package-info.java` file

A special file holding **package-level documentation** and annotations:

```java
// File: com/example/banking/package-info.java
/**
 * Banking domain types and operations.
 */
package com.example.banking;
```

Rules:

- Filename must be exactly `package-info.java`.
- Contains only the package declaration plus its Javadoc.
- Optionally annotations applied to the package (`@NonNullByDefault`, etc.).

Useful for documenting package-level conventions.

---

## 13. Common beginner mistakes

| Mistake                                          | Symptom                                | Fix                              |
|--------------------------------------------------|----------------------------------------|----------------------------------|
| Wrong package declaration vs file path           | Class not found                        | Match `package` to directory     |
| Two top-level public classes in one file         | Compile error                          | One per file                     |
| Missing import                                    | Symbol not found                       | Add `import`                     |
| Wildcard import collision                         | Ambiguous class name                   | Switch to single imports         |
| Using the unnamed package in a real project      | Cannot import from named packages      | Declare a package                |
| Package-private class accessed from another package | Compile error                       | Make it `public` or move it      |

---

## 14. Quick rules of thumb

- Always declare a `package` (don't use the unnamed package).
- Use reverse-DNS-style names: `com.org.project.module`.
- Match directory structure to package name.
- One public class per file, file name matches the class name.
- Default to package-private for internal helpers; `public` only for the API.
- Use single imports over wildcards.
- Prefer `import static` only for assertions and DSL-style fluent APIs.

---

## 15. Cheat sheet

```java
// Declare
package com.example.banking;

// Import
import com.example.banking.BankAccount;        // single
import java.util.*;                            // wildcard
import static java.lang.Math.PI;                // static

// File location
src/main/java/com/example/banking/BankAccount.java

// Package-private (no keyword)
class Helper { }                                // visible within package
int field;                                      // visible within package

// Public
public class Service { }                        // visible everywhere (subject to module rules)
```

Master packages and you have the basic organizational unit of every Java codebase. The next steps — JPMS modules, classpath vs modulepath — build on this foundation.
