# Packages — Tasks

> Hands-on exercises for package design, module structure, access boundaries, and dependency hygiene.

---

## Task 1 — Basic package + import setup

Build a tiny two-package app.

**Requirements:**
- Package `com.example.banking` with public class `BankAccount`.
- Package `com.example.app` with `Main` that imports and uses `BankAccount`.
- Both compile and run.

**Acceptance:**
- File paths match package names.
- Build/run via Maven or Gradle.

---

## Task 2 — Convert from "package by layer" to "package by feature"

You have:

```
com.example.controller
├── UserController
└── OrderController

com.example.service
├── UserService
└── OrderService

com.example.repository
├── UserRepository
└── OrderRepository
```

**Requirements:**
- Reorganize into:
  ```
  com.example.user/{UserController, UserService, UserRepository}
  com.example.order/{OrderController, OrderService, OrderRepository}
  ```
- Update imports.
- Run tests; verify behavior unchanged.

**Acceptance:**
- New layout in place.
- Each feature is self-contained.
- Tests pass.

---

## Task 3 — API/internal split

For one feature package, split into api/internal sub-packages.

**Requirements:**
- `com.example.payments.api` — public types only (interfaces, DTOs).
- `com.example.payments.internal` — implementation (package-private classes).
- `Payments` factory class in `api` constructs implementations from `internal`.
- External code uses only `api`.

**Acceptance:**
- Implementation classes are package-private.
- External consumers compile fine using only `api` types.
- Tests still pass.

---

## Task 4 — Add `module-info.java`

Continue from Task 3. Make the package a module.

**Requirements:**
- Create `module-info.java` in the project's source root.
- `module com.example.payments { exports com.example.payments.api; }`
- Build a modular jar.
- Write a separate consumer module that imports `com.example.payments`.
- Confirm consumer can see `api` but not `internal`.

**Acceptance:**
- Modular build succeeds.
- Reflection on `internal` from consumer fails with `IllegalAccessError` or `ClassNotFoundException`.

---

## Task 5 — Detect cyclic package dependencies

Use `jdeps` or ArchUnit to detect cycles.

**Requirements:**
- Create a deliberately cyclic codebase: package A imports package B; package B imports package A.
- Run `jdeps -c` (cycles option). Confirm cycle detected.
- Refactor to break the cycle: extract shared types to a third package, or invert one direction via interface.
- Re-run `jdeps`; cycle gone.

**Acceptance:**
- Initial output shows the cycle.
- Refactored output is clean.

---

## Task 6 — Add `package-info.java`

For one of your packages, add documentation.

**Requirements:**
- Create `src/main/java/com/example/foo/package-info.java`:
  ```java
  /**
   * One-paragraph summary.
   *
   * Public API: ... Threading: ... Stability: ...
   */
  package com.example.foo;
  ```
- Run `javadoc`; confirm the package summary appears.

**Acceptance:**
- `package-info.java` in place.
- Javadoc output includes the package summary.

---

## Task 7 — Tests in same package as production

Place tests in the production package.

**Requirements:**
- For a class with package-private methods, write tests in `src/test/java/com.example.foo/`.
- Tests reach package-private members directly.
- No `public` widening of production code.

**Acceptance:**
- Tests pass.
- Production members remain package-private.

---

## Task 8 — Architectural rules with ArchUnit

Install ArchUnit and add CI tests.

**Requirements:**
- Add `com.tngtech.archunit:archunit-junit5` dependency.
- Write rules:
  - No cycles between top-level feature packages.
  - Controllers (`@RestController`-annotated) live in `..controller..` packages.
  - Services depend only on `..api..` and `..domain..` packages.
- Run as JUnit tests; CI fails if violated.

**Acceptance:**
- 3+ ArchUnit rules in place.
- A deliberate violation is caught.
- CI configuration enforces them.

---

## Task 9 — Static imports for assertions

Refactor test code to use static imports.

**Requirements:**
- Pick a test class with `Assertions.assertEquals(...)` and `Assertions.assertThrows(...)` calls.
- Add `import static org.junit.jupiter.api.Assertions.*;`
- Replace qualified calls with bare names.
- Compile and run; confirm tests still pass.

**Acceptance:**
- Tests work after refactoring.
- Test code is shorter and more readable.

---

## Task 10 — Configure `opens` for Jackson

For a record-based JSON deserialization scenario.

**Requirements:**
- A record `User(long id, String name)` in package `com.example.users`.
- Jackson deserialization in another module.
- Without `opens`: Jackson fails to construct `User` reflectively.
- Add `opens com.example.users to com.fasterxml.jackson.databind;` to `module-info.java`.
- Verify Jackson works.

**Acceptance:**
- The original code fails (or works only with `--add-opens`).
- The `opens` directive fixes it cleanly.

---

## Task 11 — Reduce public surface

Audit a feature package.

**Requirements:**
- List all `public` types in one package.
- For each, find external callers (IDE "Find Usages" or `grep`).
- Reduce visibility where possible:
  - No external callers → package-private.
  - Only one external caller → see if you can wrap via API entry point.
- Run tests after each change.

**Acceptance:**
- Public surface reduced by 30%+ (or document why fewer).
- Tests pass.
- Refactor commit message describes the rationale.

---

## Task 12 — Refactor a `util` god-package

You have:

```
com.example.util/
├── StringUtils
├── DateUtils
├── JsonUtils
├── HttpUtils
├── DBUtils
└── ... 30 more
```

**Requirements:**
- Categorize each class by domain.
- Move to feature-specific packages (e.g., `JsonUtils` to `com.example.serialization`, `DBUtils` to `com.example.persistence`).
- Update imports.
- Document any cross-cutting utilities that genuinely belong in `shared`.

**Acceptance:**
- `util` package is much smaller (or gone).
- Each class lives with its domain.
- Tests pass.

---

## Task 13 — Migrate from classpath to modulepath

Take a classpath-based project; add JPMS support.

**Requirements:**
- Add `module-info.java` to one of your jars.
- `requires` your direct dependencies; document `Automatic-Module-Name` for jars without modules.
- Build a modular jar.
- Run as a module: `java --module-path build/libs --module com.example.app/com.example.app.Main`.

**Acceptance:**
- Modular jar builds and runs.
- Document any necessary `--add-opens` flags.

---

## Task 14 — Detect "split package" issue

Demonstrate the split-package anti-pattern.

**Requirements:**
- Two jars (or modules) both contributing classes to `com.example.shared.*`.
- On classpath: behavior depends on order; works with surprises.
- On modulepath: explicit error.
- Refactor: rename one of the packages.
- Re-test.

**Acceptance:**
- The original setup demonstrates the issue.
- The refactor resolves it.

---

## Task 15 — Document a feature's package layout

Pick a feature in your codebase. Write a one-page document.

**Requirements:**
- Diagram the package structure (api/, internal/, domain/, etc.).
- For each sub-package, list public types.
- Document dependency direction: what imports what.
- Note any `module-info.java` directives.
- Note any `package-info.java` files.

**Acceptance:**
- A markdown / Javadoc document exists.
- It accurately reflects the code.
- New contributors can read it and understand the feature.

---

## How to verify

Tests should:

1. Demonstrate access boundaries (package-private blocks outside, allows inside).
2. Show JPMS module enforcement (cross-module reflection fails as expected).
3. Use ArchUnit to encode architectural rules.
4. Document via `package-info.java` files.
