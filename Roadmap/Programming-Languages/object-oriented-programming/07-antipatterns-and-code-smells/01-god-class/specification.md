# God Class — Specification

## 1. Formal Thresholds

A class is classified as a God Class when **two or more** of the following thresholds are exceeded:

| Metric                                   | Symbol  | Threshold     |
|------------------------------------------|---------|---------------|
| Lines of code (non-blank, non-comment)   | LOC     | > 200         |
| Public methods                           | NPM     | > 7           |
| Total methods (public + private)         | NOM     | > 20          |
| Fields                                   | NOF     | > 12          |
| Lack of Cohesion of Methods (Henderson-Sellers) | LCOM4 | > 1     |
| Weighted Methods per Class               | WMC     | > 20          |
| Response For Class                       | RFC     | > 50          |
| Coupling Between Objects (fan-out)       | CBO     | > 15          |
| Cyclomatic complexity of any method      | CC      | > 10          |
| Constructor parameters                   | NOPC    | > 5           |

These thresholds are not arbitrary — they come from Lanza & Marinescu's *Object-Oriented Metrics in Practice* (2006) and from PMD/SonarQube defaults that have been calibrated against thousands of open-source projects.

## 2. Metric Formulas

### 2.1 LCOM4 (Lack of Cohesion of Methods, version 4)

Build a graph G where:
- nodes are methods and fields of the class
- an edge exists between two methods if they share at least one field
- an edge exists between a method and each field it uses

```
LCOM4 = number of connected components in G
```

A cohesive class has LCOM4 = 1 (one connected blob). LCOM4 = 2 means the class is really two classes sharing a file. LCOM4 = 5 means it is five classes.

### 2.2 WMC (Weighted Methods per Class)

```
WMC = Σ cyclomatic_complexity(method_i) for all methods
```

A class with 10 methods, each of complexity 2, has WMC = 20. A class with 5 trivial methods (complexity 1) and 1 nasty method (complexity 25) has WMC = 30 — and is already a God Class on this metric alone.

### 2.3 RFC (Response For Class)

```
RFC = |M(C)| + |R(C)|
```

where `M(C)` is the set of methods declared in class C, and `R(C)` is the set of methods called *by* methods of C. A high RFC means the class participates in a wide network of calls — a transitive God Class.

### 2.4 CBO (Coupling Between Objects)

```
CBO(C) = |{D : C depends on D or D depends on C, and D != C}|
```

CBO counts unique types referenced. JDK types (`String`, `Integer`, primitives) are usually excluded. A CBO > 15 means the class touches more than 15 different domains.

### 2.5 TCC (Tight Class Cohesion)

```
TCC = NDC / NP
```

where NDC = number of directly connected method pairs (methods sharing at least one field), NP = N*(N-1)/2 possible pairs. Healthy: TCC ≥ 0.5. God Class: TCC < 0.2.

## 3. PMD Rule Configuration

PMD ships with built-in rules that map directly to these thresholds. Place this in `pmd-ruleset.xml`:

```xml
<?xml version="1.0"?>
<ruleset name="god-class-detection"
         xmlns="http://pmd.sourceforge.net/ruleset/2.0.0">

  <description>Detects God Classes and related size smells.</description>

  <!-- Marinescu's God Class metric: high WMC + high ATFD + low TCC -->
  <rule ref="category/java/design.xml/GodClass"/>

  <!-- Class exceeds threshold LOC -->
  <rule ref="category/java/design.xml/ExcessiveClassLength">
    <properties>
      <property name="minimum" value="200"/>
    </properties>
  </rule>

  <!-- Too many methods (public + private) -->
  <rule ref="category/java/design.xml/TooManyMethods">
    <properties>
      <property name="maxmethods" value="20"/>
    </properties>
  </rule>

  <!-- Too many fields -->
  <rule ref="category/java/design.xml/TooManyFields">
    <properties>
      <property name="maxfields" value="12"/>
    </properties>
  </rule>

  <!-- Cyclomatic complexity of any single method -->
  <rule ref="category/java/design.xml/CyclomaticComplexity">
    <properties>
      <property name="classReportLevel" value="40"/>
      <property name="methodReportLevel" value="10"/>
    </properties>
  </rule>

  <!-- Excessive public count -->
  <rule ref="category/java/design.xml/ExcessivePublicCount">
    <properties>
      <property name="minimum" value="7"/>
    </properties>
  </rule>

  <!-- Long methods often hide inside God Classes -->
  <rule ref="category/java/design.xml/ExcessiveMethodLength">
    <properties>
      <property name="minimum" value="40"/>
    </properties>
  </rule>

  <!-- Parameter list: surrogate for hidden complexity -->
  <rule ref="category/java/design.xml/ExcessiveParameterList">
    <properties>
      <property name="minimum" value="6"/>
    </properties>
  </rule>

  <!-- Coupling -->
  <rule ref="category/java/design.xml/CouplingBetweenObjects">
    <properties>
      <property name="threshold" value="15"/>
    </properties>
  </rule>

  <!-- Law of Demeter — fat classes love to chain calls -->
  <rule ref="category/java/design.xml/LawOfDemeter"/>

</ruleset>
```

Run via Maven:

```xml
<plugin>
  <groupId>net.sourceforge.pmd</groupId>
  <artifactId>pmd-maven-plugin</artifactId>
  <version>3.21.0</version>
  <configuration>
    <rulesets><ruleset>pmd-ruleset.xml</ruleset></rulesets>
    <failOnViolation>true</failOnViolation>
    <printFailingErrors>true</printFailingErrors>
  </configuration>
</plugin>
```

## 4. SonarQube Quality Gate

```json
{
  "name": "God-Class-Gate",
  "conditions": [
    { "metric": "ncloc_per_class",            "op": "GT", "error": "200" },
    { "metric": "complexity_per_class",       "op": "GT", "error": "40"  },
    { "metric": "complexity_per_function",    "op": "GT", "error": "10"  },
    { "metric": "public_api_method_count",    "op": "GT", "error": "7"   },
    { "metric": "class_complexity",           "op": "GT", "error": "40"  },
    { "metric": "lcom4",                      "op": "GT", "error": "1"   },
    { "metric": "rfc",                        "op": "GT", "error": "50"  },
    { "metric": "cbo",                        "op": "GT", "error": "15"  },
    { "metric": "new_code_smells",            "op": "GT", "error": "0"   },
    { "metric": "new_maintainability_rating", "op": "GT", "error": "1"   }
  ],
  "isDefault": false
}
```

Apply with the Sonar CLI:

```bash
curl -u $SONAR_TOKEN: -X POST \
  "$SONAR_URL/api/qualitygates/create" \
  --data-urlencode "name=God-Class-Gate"
```

## 5. Checkstyle Backstop

For projects that do not run PMD, the following Checkstyle module catches the most common cases:

```xml
<module name="ClassDataAbstractionCoupling">
  <property name="max" value="15"/>
</module>
<module name="ClassFanOutComplexity">
  <property name="max" value="25"/>
</module>
<module name="JavaNCSS">
  <property name="classMaximum" value="200"/>
  <property name="methodMaximum" value="40"/>
</module>
<module name="MethodCount">
  <property name="maxPublic" value="7"/>
  <property name="maxTotal"  value="20"/>
</module>
```

## 6. Decision Matrix

When a class trips one threshold, evaluate; when it trips two, refactor; when it trips three, treat it as a P1 defect.

| Trips     | Action                                      |
|-----------|---------------------------------------------|
| 0         | OK                                          |
| 1         | Discuss in code review                      |
| 2         | Schedule refactor next sprint               |
| 3         | Block PR, file refactoring ticket           |
| 4+        | Architectural review, write an ADR          |

## 7. Exemptions

Not every large class is a God Class. Legitimate exceptions:

- Generated code (`*.g4`-derived parsers, JOOQ records).
- DTOs aggregating many fields (no behavior).
- Protocol message classes (e.g., gRPC stubs).
- Configuration objects bound to YAML (Spring `@ConfigurationProperties`).

For each exemption, add `@SuppressWarnings("PMD.GodClass")` plus a one-line justification, and record the type in your team's "metric exclusions" doc.

**Memorize this:** Two metrics over threshold means refactor — God Class detection is mechanical, not subjective; let PMD and Sonar fail the build for you.
