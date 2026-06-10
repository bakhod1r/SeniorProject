# Primitive Obsession — Specification

> The measurable, enforceable contract for detecting and preventing Primitive Obsession in a Java codebase. This file is written so an engineer, a linter, or a CI pipeline can apply it without further interpretation. Definitions tighten the vocabulary (what counts as "domain", what counts as "boundary"); the metric pins down a measurable threshold; the sample rules give you copy-pasteable ArchUnit and Checkstyle configurations.

---

## 1. Definitions

The following terms have a precise meaning throughout this section.

| Term                  | Definition                                                                                                                       |
|-----------------------|----------------------------------------------------------------------------------------------------------------------------------|
| **Primitive type**    | One of the eight Java language primitives (`boolean`, `byte`, `short`, `int`, `long`, `float`, `double`, `char`) and their boxed equivalents. |
| **Quasi-primitive**   | `java.lang.String`, `java.util.UUID`, `java.math.BigInteger`, `java.math.BigDecimal` when used as a *standalone* parameter or field. |
| **Domain layer**      | Any class in the `..domain..` package family, or any class annotated with `@DomainEntity` / `@ValueObject`.                      |
| **Boundary layer**    | Classes in `..web..`, `..persistence..`, `..messaging..`, `..adapter..`, `..config..`. Test code (`src/test`) is also boundary.   |
| **Domain method**     | A `public` or `protected` method declared in the domain layer.                                                                   |
| **Confusable**        | Two or more parameters of the same primitive or quasi-primitive type in one method signature.                                    |
| **Wrapped value**     | A user-defined `record`, `final class`, or future `value class` that has a single conceptual responsibility.                     |

---

## 2. The smell, formally

A *domain method* exhibits **Primitive Obsession** when **any** of the following conditions is true:

1. **Confusable parameters.** The method declares two or more parameters of the same primitive or quasi-primitive type, and those parameters represent *different domain concepts*.
2. **Boolean mode parameter.** The method declares a `boolean` parameter whose name encodes a mode (`isDryRun`, `forceUpdate`, `silent`, `urgent`) rather than a true/false fact about the input.
3. **Numeric with implicit unit.** The method declares a numeric parameter whose name encodes a unit suffix (`amountCents`, `delayMs`, `priceUsd`, `ratioBps`).
4. **String with constrained format.** The method declares a `String` parameter whose Javadoc or name implies a constrained format (`email`, `iso2`, `phone`, `currency`).

A domain *field* exhibits Primitive Obsession under analogous rules applied to its declared type.

---

## 3. Measurable metric — the PSR

Define the **Primitive Signature Ratio (PSR)** for a domain method:

> PSR(method) = (count of primitive + quasi-primitive parameters) / (total parameter count)

For a class:

> PSR(class) = mean PSR over public domain methods

For a module:

> PSR(module) = mean PSR over domain classes

**Thresholds.** A healthy domain module sits at PSR ≤ 0.20. The thresholds:

| Range          | Status      | Action                                                |
|----------------|-------------|-------------------------------------------------------|
| 0.00 – 0.20    | Green       | Maintain. Spot-check on new code.                     |
| 0.21 – 0.50    | Yellow      | Add ArchUnit rules. Schedule refactor for top offenders. |
| 0.51 – 0.80    | Orange      | Active migration plan required. Pair-program new APIs. |
| 0.81 – 1.00    | Red         | Domain layer is effectively a bag of primitives. Apply playbook from `professional.md`. |

These are heuristics, not hard rules. A module that legitimately wraps low-information transport data may sit at higher PSR without bug risk; a module at low PSR that uses confusable primitives still has the smell.

---

## 4. "Primitive at the boundary vs inside the domain"

The same primitive type is acceptable in one place and a smell in another. The boundary rules:

| Layer                 | Raw `String`/`int`/`long` acceptable? | Reason                                                    |
|-----------------------|---------------------------------------|-----------------------------------------------------------|
| Domain method param   | No                                    | Where the smell lives.                                    |
| Domain method return  | No (except `boolean`, `int` count)    | Returned values cross boundaries; preserve typing.        |
| Domain private helper | Sometimes                             | Internal to one class; if scoped, primitive is fine.      |
| Repository interface  | No                                    | Repositories *are* domain ports.                          |
| Repository impl       | Yes                                   | Persistence layer; JDBC takes primitives.                 |
| HTTP controller       | Yes                                   | Wire contract; raw types in DTOs.                         |
| DTO                   | Yes                                   | Wire shape; conversion happens in the controller body.    |
| Message payload       | Yes                                   | Same rationale as DTO.                                    |
| Configuration class   | Yes                                   | `@Value("${app.timeout}")` is naturally typed.            |
| Test setup            | Yes (with caution)                    | Tests construct wrappers from primitives intentionally.   |

The principle: a primitive is acceptable *where data enters or exits the JVM*; everywhere else it must be wrapped.

---

## 5. Sample ArchUnit rule — domain APIs reject confusable primitives

Drop-in JUnit 5 + ArchUnit 1.x test:

```java
package com.acme.arch;

import com.tngtech.archunit.junit.*;
import com.tngtech.archunit.lang.*;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.*;

@AnalyzeClasses(packages = "com.acme")
class PrimitiveObsessionPolicy {

    @ArchTest
    static final ArchRule no_raw_string_in_domain =
        methods()
            .that().areDeclaredInClassesThat().resideInAPackage("..domain..")
            .and().arePublic()
            .should(haveNoMoreThanOneParameterOfType(String.class))
            .because("Two String parameters in one domain method are confusable. " +
                     "Wrap each in a typed record (Email, FullName, IsoCurrencyCode, etc.)");

    @ArchTest
    static final ArchRule no_long_for_id_in_domain =
        fields()
            .that().areDeclaredInClassesThat().resideInAPackage("..domain..")
            .and().haveNameMatching(".*[Ii]d")
            .should().haveRawType("com.acme.domain.id..")
            .because("IDs are opaque domain types; raw long leaks the persistence detail.");

    @ArchTest
    static final ArchRule no_boolean_flag_in_domain =
        methods()
            .that().areDeclaredInClassesThat().resideInAPackage("..domain..")
            .and().arePublic()
            .should().notHaveRawParameterTypes(boolean.class)
            .because("Boolean flags hide a mode. Replace with an enum.");
}
```

`haveNoMoreThanOneParameterOfType` is a custom predicate — implement it as:

```java
static ArchCondition<JavaMethod> haveNoMoreThanOneParameterOfType(Class<?> type) {
    return new ArchCondition<>("have no more than one parameter of " + type) {
        @Override public void check(JavaMethod method, ConditionEvents events) {
            long count = method.getRawParameterTypes().stream()
                .filter(p -> p.isAssignableTo(type)).count();
            if (count > 1) {
                events.add(SimpleConditionEvent.violated(method,
                    method.getFullName() + " has " + count + " parameters of " + type.getName()));
            }
        }
    };
}
```

---

## 6. Sample Checkstyle rule — parameter count + boolean

Checkstyle does not directly understand "primitive obsession", but two of its built-in modules nudge developers toward typed parameters:

```xml
<module name="ParameterNumber">
    <property name="max" value="4"/>
    <property name="ignoreOverriddenMethods" value="true"/>
</module>

<module name="JavadocMethod">
    <property name="validateThrows" value="true"/>
</module>
```

A custom regression: a method with two or more `boolean` parameters fails review.

```xml
<module name="RegexpSinglelineJava">
    <property name="format" value="\(.*\bboolean\b.*\bboolean\b.*\)"/>
    <property name="message" value="Two booleans in one signature — replace with an enum."/>
</module>
```

Crude but effective.

---

## 7. Sample SpotBugs filter

SpotBugs has primitive-smell-adjacent detectors. Enable them explicitly:

```xml
<!-- spotbugs-exclude.xml -->
<FindBugsFilter>
    <Match>
        <Bug code="BX"/>   <!-- BX_BOXING_IMMEDIATELY_UNBOXED -->
        <Confidence value="2"/>
    </Match>
    <Match>
        <Bug pattern="FE_FLOATING_POINT_EQUALITY"/>
    </Match>
</FindBugsFilter>
```

`BX` flags accidental autoboxing — a hint that `Integer` is being used where `int` would do, or that a primitive was wrapped only to be immediately unwrapped. `FE_FLOATING_POINT_EQUALITY` catches `double == double` comparisons that often indicate `double` used for money.

---

## 8. CI integration — gating PRs

The minimal CI gate:

```yaml
# .github/workflows/quality.yml
jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with: { java-version: '21' }
      - run: ./mvnw -B verify
      - run: ./mvnw -B archunit:check
      - run: ./mvnw -B checkstyle:check
      - run: ./mvnw -B spotbugs:check
```

A failing ArchUnit test fails the PR check. The developer sees the violation in plain English ("`PaymentService.charge` has 2 parameters of `String`") and fixes it before requesting review.

---

## 9. Auditing an existing codebase — the one-command report

For a brown-field audit, a self-contained shell pipeline that computes PSR by class:

```bash
# Domain methods with two or more String parameters
javap -p -c target/classes/com/acme/domain/**/*.class \
  | grep -E 'public.*\(.*Ljava/lang/String;.*Ljava/lang/String;'

# Methods with boolean parameters
javap -p -c target/classes/com/acme/domain/**/*.class \
  | grep -E 'public.*\(.*Z.*\)'

# Methods with two or more long parameters
javap -p -c target/classes/com/acme/domain/**/*.class \
  | grep -E 'public.*\(.*J.*J'
```

Pipe each through `sort | uniq -c | sort -rn` to find the worst offenders. A typical brown-field audit identifies 20-50 hotspots; address the top 10 first.

---

## 10. Exceptions and explicit waivers

Not every primitive in a domain signature is a bug. Three legitimate exceptions:

- **Single-parameter primitives** where there is no risk of confusion: `setMaxAttempts(int n)`, `setName(String name)` on a builder.
- **Implementations of external interfaces**: `Comparable<T>.compareTo(T)` returns `int`; the interface dictates the type.
- **Generic algorithm methods**: `MathUtils.gcd(long a, long b)` operates on numbers, not domain concepts.

For each exception in the codebase, document the waiver inline:

```java
@SuppressWarnings("PrimitiveObsession") // single-parameter, no confusion risk
public Builder withMaxAttempts(int n) { ... }
```

ArchUnit can be configured to honour the suppression.

---

## 11. Spec-version references

Behaviour cited in this file maps to the following Java specifications and JEPs:

| Reference                                  | Topic                                                    |
|--------------------------------------------|----------------------------------------------------------|
| JLS §4.2 — Primitive Types and Values      | What counts as a primitive                              |
| JLS §8.10 — Record Classes                 | `record` semantics, compact constructor                  |
| **JEP 395** (final, Java 16)               | Records                                                  |
| **JEP 409** (final, Java 17)               | Sealed classes                                           |
| **JEP 441** (final, Java 21)               | Pattern matching for `switch` (exhaustive sealed dispatch) |
| **JEP 401** (preview)                      | Value Classes and Objects — the Valhalla preview         |

The ArchUnit and Checkstyle configurations target their respective stable APIs (ArchUnit 1.x, Checkstyle 10.x as of writing). Version-pin in your `pom.xml` / `build.gradle`.

---

**Memorize this:** Primitive Obsession is measurable — define PSR per method, class, module; threshold at 0.20 green / 0.80 red. Domain methods must not accept confusable primitives; boundary layers may. Enforce with ArchUnit at PR time, audit with `javap` quarterly, waive explicitly with annotations. The metric, not the slogan, is what changes the codebase.
