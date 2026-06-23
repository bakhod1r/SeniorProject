# Inappropriate Intimacy — Professional

At the professional level the fight against Inappropriate Intimacy moves out of single classes and into the architecture itself. We use the JPMS module system to forbid packages from seeing each other at compile time, ArchUnit to fail the build when a module reaches across a boundary it should not, and hexagonal (ports & adapters) layering to make sure the domain never grows tendrils into infrastructure code. The principle is simple: if the compiler or build cannot see the dependency, it cannot exist.

## 1. JPMS — modules that physically hide their internals

Before Java 9 the only access modifier above `public` was "the JAR is on the classpath, good luck". JPMS introduces a real module boundary. A class can be `public` and still be invisible outside its module unless the module explicitly `exports` its package.

```java
// src/com.shop.billing/module-info.java
module com.shop.billing {
    requires com.shop.catalog;          // we may depend on catalog API
    requires java.sql;

    exports com.shop.billing.api;       // public façade only
    // com.shop.billing.internal is NOT exported -> invisible to outsiders
    // com.shop.billing.persistence is NOT exported -> invisible to outsiders
}
```

```java
// src/com.shop.catalog/module-info.java
module com.shop.catalog {
    exports com.shop.catalog.api;       // only the api package leaks
    // implementation packages stay private to the module
}
```

If a class in `com.shop.billing.internal` tries to instantiate `com.shop.catalog.internal.PricingTable`, the compiler emits `package com.shop.catalog.internal is not visible`. There is no flag the consuming code can pass to bypass this — the only way is for the producing module to add an `exports` line, which is a deliberate, reviewable act.

### Qualified exports — selective intimacy

Sometimes one module truly does need access to an otherwise hidden package (an integration test module, a friendly sibling). Qualified exports let you whitelist exactly who is allowed in:

```java
module com.shop.billing {
    exports com.shop.billing.spi to com.shop.billing.tests, com.shop.billing.adapter.stripe;
}
```

Any other module referencing `com.shop.billing.spi` still fails to compile.

## 2. ArchUnit — boundary rules enforced as tests

JPMS handles package visibility. ArchUnit handles richer architectural rules: layered architecture, no-cycle constraints, naming conventions, and "this domain class must never import javax.persistence". You run it as plain JUnit tests, so the CI pipeline fails the moment someone introduces forbidden intimacy.

```java
// src/test/java/com/shop/arch/ArchitectureRulesTest.java
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchRule;
import com.tngtech.archunit.library.Architectures;

@AnalyzeClasses(packages = "com.shop")
class ArchitectureRulesTest {

    @ArchTest
    static final ArchRule layers = Architectures.layeredArchitecture()
        .consideringAllDependencies()
        .layer("Domain").definedBy("com.shop..domain..")
        .layer("Application").definedBy("com.shop..application..")
        .layer("Infrastructure").definedBy("com.shop..infrastructure..")
        .whereLayer("Infrastructure").mayNotBeAccessedByAnyLayer()
        .whereLayer("Application").mayOnlyBeAccessedByLayers("Infrastructure")
        .whereLayer("Domain").mayOnlyBeAccessedByLayers("Application", "Infrastructure");

    @ArchTest
    static final ArchRule domainStaysPure = noClasses()
        .that().resideInAPackage("com.shop..domain..")
        .should().dependOnClassesThat().resideInAnyPackage(
            "javax.persistence..", "jakarta.persistence..",
            "org.springframework..", "com.fasterxml.jackson.."
        );

    @ArchTest
    static final ArchRule noCycles = slices()
        .matching("com.shop.(*)..")
        .should().beFreeOfCycles();
}
```

The third rule is the one that catches Inappropriate Intimacy most often. Cycles between top-level modules are almost always the result of two classes reaching into each other's fields or helpers.

## 3. Hexagonal architecture — the domain in the centre

Inappropriate Intimacy frequently appears as a domain object that "just calls the repository once" or an entity that imports a Spring annotation. Hexagonal architecture removes that temptation by inverting the dependency direction: the domain defines ports (interfaces), and adapters in the outer ring implement them.

```
                +---------------------------+
                |        Adapters           |
                |  REST  CLI  Kafka  JPA    |
                +-----------+---------------+
                            |
                            v   implements
                +-----------+---------------+
                |          Ports            |
                |  in: command/query  out:  |
                |  repo / event publisher   |
                +-----------+---------------+
                            ^   used by
                            |
                +-----------+---------------+
                |          Domain           |
                |  pure java, no frameworks |
                +---------------------------+
```

### Domain — knows nothing about persistence

```java
// com.shop.billing.domain
package com.shop.billing.domain;

public final class Invoice {
    private final InvoiceId id;
    private final Money total;
    // pure: no annotations, no setters for identity, no toString of associations
    public Invoice(InvoiceId id, Money total) {
        this.id = id;
        this.total = total;
    }
    public Money total() { return total; }
}
```

### Outbound port — defined by the domain, implemented by the outside

```java
// com.shop.billing.application.port.out
package com.shop.billing.application.port.out;

public interface InvoiceRepository {
    void save(Invoice invoice);
    Optional<Invoice> findById(InvoiceId id);
}
```

### Adapter — the only place that knows JPA

```java
// com.shop.billing.adapter.jpa
package com.shop.billing.adapter.jpa;

@Repository
class JpaInvoiceRepository implements InvoiceRepository {
    private final JpaInvoiceCrudRepo crud;
    private final InvoiceMapper mapper;

    @Override public void save(Invoice invoice) {
        crud.save(mapper.toEntity(invoice));
    }
    @Override public Optional<Invoice> findById(InvoiceId id) {
        return crud.findById(id.value()).map(mapper::toDomain);
    }
}
```

The domain class `Invoice` has zero awareness of the adapter. The JPA entity (`InvoiceJpaEntity`) lives in the adapter package and never escapes. Even if a junior developer tries to inject a `JpaInvoiceCrudRepo` into a domain service, ArchUnit will fail the build, and JPMS will refuse to compile it because the adapter package is not exported.

## 4. Service mesh of context boundaries

In bigger systems, intimacy creeps in across bounded contexts. The classic mistake: the Billing context reading the Catalog's `Product` table directly to compute taxes.

Defence in depth:

- Each bounded context is its own JPMS module (or even its own service).
- Cross-context calls go through a published interface (REST, gRPC, message bus, or a local published API module).
- Shared kernel is kept minimal — only true ubiquitous concepts (`Money`, `Currency`) live there.
- Any new cross-context import triggers an ArchUnit `should().notDependOn` failure unless it lands in the explicitly approved `published-api` package.

## 5. Build-time tooling stack

A realistic professional setup combines:

| Tool | Boundary it enforces |
|------|----------------------|
| JPMS `module-info.java` | Package visibility across modules at compile time |
| Maven/Gradle module structure | Compile classpath separation |
| ArchUnit | Layered/sliced architecture, naming, no-cycle, framework-free domain |
| Error Prone / NullAway | Catches accidental leakage of internal types via return values |
| jdeps | Detects unintended JDK or 3rd-party dependencies in a module |
| Sonar "Tight class cohesion" | Flags growing CBO over time |

## Quick rules

- Treat every `exports` line in `module-info.java` like a public API change — review it explicitly.
- Forbid frameworks in the domain layer with ArchUnit, even Lombok if it bleeds annotations.
- Outbound ports belong to the application layer; adapters depend on ports, never the other way around.
- Cross-context reads go through a published API, never through a shared database table.
- Every new "shared utils" package is a future Inappropriate Intimacy site — split it before it grows.
- A test that fails on a forbidden dependency is worth more than a code review comment that asks for the same thing.

## What's next

Next we will quantify intimacy with metrics — CBO, MPC, fan-in/fan-out, bidirectional edge counts — and define the thresholds at which a class crosses from "well connected" into "intimate". Specification turns this chapter's discipline into numbers you can put on a dashboard.

## Memorize this

- JPMS hides packages; ArchUnit hides intent. Use both.
- Domain has no annotations, no Spring, no JPA, no Jackson — and a test that proves it.
- Ports are owned by the domain side; adapters are owned by the outside.
- Qualified exports are deliberate intimacy — every entry on the whitelist is a design decision.
- Cycles between modules are the loudest symptom of intimacy; ban them in CI.
- If a developer can break a boundary without the build going red, the boundary does not exist.
