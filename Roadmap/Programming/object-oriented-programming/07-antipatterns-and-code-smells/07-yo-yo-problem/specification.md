# Yo-Yo Problem — Specification

This document defines the metrics, thresholds, and automated rules used to detect and bound the Yo-Yo Problem in Java codebases. It is the reference for code reviewers, architects, and CI pipeline authors.

---

## 1. Primary metrics

### DIT — Depth of Inheritance Tree

**Definition (Chidamber & Kemerer, 1994):** The length of the longest path from a class to the root of the inheritance tree.

For Java, the root is `java.lang.Object`. By convention DIT counts only proper ancestors, so:
- `class A {}` has DIT = 1 (Object)
- `class B extends A {}` has DIT = 2
- `class C extends B {}` has DIT = 3

Some tools (e.g., CKJM) count Object as depth 0 and report `A` as DIT 0. Always confirm the convention before comparing numbers across tools. In this specification we use the **inclusive** convention (counting Object).

### NOC — Number Of Children

**Definition (Chidamber & Kemerer, 1994):** The number of immediate subclasses of a class.

NOC measures fan-out at a single level. High NOC on a deep class compounds the yo-yo: readers of any subclass must understand the shared base, and authors of the base must consider all NOC subclasses on every change.

---

## 2. Chidamber-Kemerer thresholds

The original CK paper (and subsequent empirical studies by Basili et al., Briand et al., and SIG) propose:

| Metric | Loose threshold | Tightened threshold | Project rule |
|---|---|---|---|
| DIT | ≤ 6 | ≤ 3 | **≤ 3** for project code, ≤ 5 including frameworks |
| NOC | ≤ 10 | ≤ 4 | **≤ 5** per class |

The tightened thresholds reflect modern Java practice (interfaces + composition replace deep inheritance) and the cognitive load research summarized in `senior.md`.

**Rationale for DIT ≤ 3:**
- One level: the concrete class.
- Two levels: an abstract base that captures structural invariants.
- Three levels: a marker interface or framework-imposed parent.
- Beyond three levels, comprehension cost grows superlinearly.

**Rationale for NOC ≤ 5:**
- A change to a class with NOC = 5 requires reasoning about 5 subclass behaviors. Above 5, the base author cannot hold all variants in working memory simultaneously.
- High NOC is often a sign that the base should be an interface, not a class.

---

## 3. Secondary metrics

| Metric | Definition | Threshold |
|---|---|---|
| **AHF** (Attribute Hiding Factor) | Fraction of protected/private attributes | > 0.7 (high hiding good) |
| **MHF** (Method Hiding Factor) | Fraction of protected/private methods | > 0.6 |
| **PolymorphismFactor** (PF) | Overrides ÷ possible overrides | < 0.2 (low is good) |
| **CBO** (Coupling Between Objects) | Number of classes a class depends on | ≤ 14 |
| **WMC** (Weighted Methods per Class) | Sum of method complexities | ≤ 20 |

In yo-yo investigations, **PF combined with DIT** is the strongest predictor: a class with DIT = 4 and PF = 0.6 is a near-certain yo-yo.

---

## 4. PMD rules

PMD ships rules that approximate yo-yo detection. Enable these in `pmd-ruleset.xml`:

```xml
<?xml version="1.0"?>
<ruleset name="Yo-Yo Detection"
         xmlns="http://pmd.sourceforge.net/ruleset/2.0.0">

    <rule ref="category/java/design.xml/ExcessiveClassLength"/>
    <rule ref="category/java/design.xml/ExcessiveParameterList"/>
    <rule ref="category/java/design.xml/CouplingBetweenObjects">
        <properties>
            <property name="threshold" value="14"/>
        </properties>
    </rule>
    <rule ref="category/java/design.xml/ExcessiveImports"/>

    <!-- Yo-yo specific -->
    <rule ref="category/java/design.xml/AbstractClassWithoutAbstractMethod"/>
    <rule ref="category/java/design.xml/SimplifyBooleanReturns"/>

    <!-- Custom DIT rule via XPath -->
    <rule name="DepthOfInheritanceTooHigh"
          language="java"
          message="Class has DIT > 3"
          class="net.sourceforge.pmd.lang.rule.XPathRule">
        <description>Flag classes whose inheritance chain exceeds 3 levels.</description>
        <priority>3</priority>
        <properties>
            <property name="xpath">
                <value>
//ClassOrInterfaceDeclaration[@Image and count(ancestor-or-self::ClassOrInterfaceDeclaration) > 3]
                </value>
            </property>
        </properties>
    </rule>
</ruleset>
```

Note: PMD's XPath visibility of ancestors is limited to the AST, not the type hierarchy. For true DIT measurement use a tool that resolves the classpath (SonarQube, CKJM, or ArchUnit).

---

## 5. SonarQube rules

SonarQube has built-in DIT detection. Activate these rules in your quality profile:

| Rule key | Description | Default threshold |
|---|---|---|
| `java:S110` | Inheritance tree of classes should not be too deep | 5 |
| `java:S1182` | `clone()` methods should be implemented carefully | n/a |
| `java:S1185` | Overriding methods should do more than simply call the same method in the super class | n/a |
| `java:S2972` | Inner classes should not have too many lines of code | 200 |

**S110 configuration:** lower the threshold from 5 to 3 in your quality profile:

```
Quality Profile → Java → Activate Rule java:S110 → Parameters → max: 3
```

**S1185** is the explicit "yo-yo override" detector: an override that only delegates to `super` is flagged.

---

## 6. ArchUnit rules

Beyond the DIT-bound rule shown in `professional.md`, encode these:

### Rule 1 — No override that only calls super

```java
@ArchTest
static final ArchRule no_trivial_super_only_overrides =
    methods()
        .that().areDeclaredInClassesThat().resideInAPackage("com.acme.app..")
        .and().areAnnotatedWith(Override.class)
        .should(notOnlyCallSuper());
```

Implementation of `notOnlyCallSuper` inspects bytecode to confirm the method body is exactly `super.x(args); [return]`.

### Rule 2 — Sealed hierarchies for non-leaf abstracts

```java
@ArchTest
static final ArchRule abstract_classes_should_be_sealed =
    classes()
        .that().areAbstract()
        .and().resideInAPackage("com.acme.app.domain..")
        .should().beSealed()
        .orShould().bePrivate();
```

Java 17 `sealed` keyword required.

### Rule 3 — Final by default for concrete classes

```java
@ArchTest
static final ArchRule concrete_domain_classes_are_final =
    classes()
        .that().resideInAPackage("com.acme.app.domain..")
        .and().areNotAbstract()
        .and().areNotInterfaces()
        .should().haveModifier(JavaModifier.FINAL);
```

### Rule 4 — Bounded NOC

ArchUnit does not ship a direct NOC condition, but you can write one:

```java
private static ArchCondition<JavaClass> haveAtMostNChildren(int max) {
    return new ArchCondition<JavaClass>("have at most " + max + " direct subclasses") {
        @Override
        public void check(JavaClass item, ConditionEvents events) {
            int children = item.getSubclasses().size();
            if (children > max) {
                events.add(SimpleConditionEvent.violated(item,
                    item.getName() + " has " + children + " direct subclasses (max " + max + ")"));
            }
        }
    };
}
```

---

## 7. Measurement pipeline

A practical CI configuration:

```
mvn test → ArchUnit (DIT, NOC, sealed, final rules)
        ↓
mvn pmd:check → PMD ruleset (S110-like XPath)
        ↓
sonar:sonar → SonarQube (S110, S1185, polymorphism factor)
        ↓
ckjm-extended → DIT/NOC/CBO/WMC report
```

Trends, not single readings, are what matter. Track median DIT across the codebase quarter over quarter. A successful refactoring program shows median DIT dropping from ~4 to ~2 over two quarters.

---

## 8. Acceptance criteria for new code

A pull request introducing or modifying inheritance must satisfy all of:

1. DIT of every changed class ≤ 3 (excluding framework superclasses).
2. NOC of every changed class ≤ 5.
3. No `@Override` method whose body is only `super.x(args)`.
4. Every abstract class is `sealed` or has a written justification in javadoc.
5. Every concrete class outside `domain` is `final` or has a written justification.
6. ArchUnit + PMD + SonarQube all pass.

Reviewers reject the PR if any criterion fails. Exceptions require architect sign-off and an entry in `docs/inheritance-exceptions.md`.

---

**Memorize this:** Bound DIT at 3 and NOC at 5 for project code. Enforce with ArchUnit, PMD, and SonarQube in CI. Track median DIT over time — that single number is the most honest measure of whether your codebase is sliding toward yo-yo or away from it.
