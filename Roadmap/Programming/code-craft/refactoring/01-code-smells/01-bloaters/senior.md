# Bloaters — Senior Level

> Focus: "How to architect?" "How to optimize?" — system-scale impact, tooling, CI integration, and large-codebase migration patterns.

---

## Table of Contents

1. [Bloaters at architectural scale](#bloaters-at-architectural-scale)
2. [Detection: linters, AST analysis, custom tooling](#detection-linters-ast-analysis-custom-tooling)
3. [Architectural cures](#architectural-cures)
4. [Migration patterns for large codebases](#migration-patterns-for-large-codebases)
5. [CI/CD integration](#cicd-integration)
6. [Metrics that catch Bloaters early](#metrics-that-catch-bloaters-early)
7. [Code-review heuristics](#code-review-heuristics)
8. [Architectural anti-patterns built on Bloaters](#architectural-anti-patterns-built-on-bloaters)
9. [The "rewrite vs. refactor" decision](#the-rewrite-vs-refactor-decision)
10. [Review questions](#review-questions)

---

## Bloaters at architectural scale

A Long Method is the same smell as a **Long Service** or a **Long Microservice**. A Large Class is the same smell as a **Monolithic Service**. Bloaters scale up — the cures scale up too.

| Code-level smell | Architectural-level analog |
|---|---|
| Long Method | A microservice that does too many things in one HTTP handler |
| Large Class | A "monolith" microservice (sometimes called a "macroservice") |
| Primitive Obsession | A `String userId` flowing through service boundaries with no schema |
| Long Parameter List | An API endpoint with 14 query parameters |
| Data Clumps | Repeated address fields across 12 different REST endpoints |

The cures map the same way:

| Code-level cure | Architectural-level cure |
|---|---|
| Extract Method | Extract a private function / library |
| Extract Class | Extract a microservice (or a bounded context within a monolith) |
| Replace Data Value with Object | Define a schema-versioned domain type, share via `.proto` / `.avsc` / `openapi.yaml` |
| Introduce Parameter Object | Define a request DTO; version it |
| Extract Class (for clumps) | Extract a shared schema referenced by all endpoints |

> **Warning:** scaling up the cure must be deliberate. "Extract Microservice" applied carelessly produces a *distributed monolith* — same code-level smells, plus latency and ops overhead.

---

## Detection: linters, AST analysis, custom tooling

You can't ship a fix for what you can't measure. Production-grade Bloater detection uses several layers:

### 1. Built-in linter rules

| Tool | Long Method | Large Class | Long Param List | Notes |
|---|---|---|---|---|
| **SonarQube** | `S138` (max method length) | `S1820` (too many fields), `S1448` (too many methods) | `S107` (too many params) | Configurable thresholds; baseline mode for legacy code |
| **IntelliJ inspections** | "Method is too long" | "Class is too big" | "Method has too many parameters" | Severity tunable per project |
| **Checkstyle (Java)** | `MethodLength` | `ClassDataAbstractionCoupling`, `ClassFanOutComplexity` | `ParameterNumber` | XML-configured |
| **PMD (Java)** | `ExcessiveMethodLength`, `CognitiveComplexity` | `GodClass` (custom rule), `ExcessiveClassLength` | `ExcessiveParameterList` | Rule-based; CI-friendly |
| **golangci-lint** | `funlen` (function length), `gocognit` (cognitive complexity) | `gocyclo` (file-level only — Go has no classes) | `revive: argument-limit` | Compose multiple linters |
| **Pylint** | `R0915` (too-many-statements), `C0301` line length | `R0902` (too-many-instance-attributes) | `R0913` (too-many-arguments) | Configurable in `.pylintrc` |
| **ruff** (Python, fast) | `PLR0915` | `PLR0902` | `PLR0913` | Drop-in replacement for Pylint with similar codes |
| **ESLint (JS/TS)** | `max-lines-per-function`, `max-statements`, `complexity` | `max-classes-per-file` | `max-params` | Plugin-extendable |

### 2. Cognitive complexity (preferred over cyclomatic)

**Cyclomatic complexity** counts decision points (`if`, `&&`, `case`). It's blind to nesting — a flat 20-branch switch scores the same as 20 deeply nested `if`s.

**Cognitive complexity** (Sonar's invention) penalizes nesting. A 3-deep nested `if` scores higher than a flat sequence with the same branch count. This matches what humans actually find hard.

```
function classify(x) {           // CC: 0
  if (x > 0) {                   // CC: +1
    if (x > 100) {               // CC: +2 (nested)
      if (x > 1000) {            // CC: +3 (nested)
        return "huge";
      }
    }
  }
}
// Cyclomatic: 4. Cognitive: 6. The cognitive score reflects the actual reading cost.
```

**Recommended thresholds:**
- Cognitive complexity per method: **15** (warn), **25** (fail)
- Method length: **50** lines (warn)
- Class field count: **15** (warn), **25** (fail)
- Method parameter count: **5** (warn), **8** (fail)

### 3. Custom AST checks

For project-specific Bloaters, build a small AST analyzer:

- **Java:** Spoon, JavaParser, Eclipse JDT
- **Python:** `ast` (built-in), `libcst` (preserves formatting)
- **Go:** `go/ast`, `go/types`, `golang.org/x/tools/go/analysis`
- **TypeScript:** the TypeScript Compiler API

Useful custom checks:

- **"Money as primitive"** detector: any parameter or field named `*amount`, `*price`, `*cost`, `*total` whose type is `double`/`float`/`BigDecimal` instead of a project-defined `Money` type.
- **"ID as bare string"** detector: any parameter or field whose name ends in `Id`/`_id` whose type is `String`/`UUID` instead of a typed ID.
- **"Address clump"** detector: any class declaring 3+ of {street, city, state, zip, country} as separate fields.
- **"Boolean parameter explosion"** detector: any method with ≥3 boolean parameters.

### 4. Architectural fitness functions

For the architectural-scale Bloaters, **ArchUnit** (Java) and **NetArchTest** (.NET) let you assert architecture invariants in tests:

```java
@ArchTest
static final ArchRule services_must_not_exceed_15_methods =
    classes().that().resideInAPackage("..service..")
             .should().haveLessThanOrEqualTo(15)
             .methodsThatAreNotPrivate();

@ArchTest
static final ArchRule rest_endpoints_must_use_dto =
    methods().that().areAnnotatedWith(PostMapping.class)
             .should().haveRawParameterTypes(DescribedPredicate.describe(
                 "exactly one DTO parameter",
                 (params) -> params.size() == 1
             ));
```

These run as JUnit tests; they fail the build if the architecture drifts.

---

## Architectural cures

### From a 5,000-line `OrderManager` to a bounded context

A Large Class at module scale becomes a **bounded context** (DDD term). The transformation:

1. **Identify cohesion clusters** inside the class. Use **method-field usage matrix**: rows = methods, columns = fields, mark cells where method touches field. Clusters appear as block-diagonal patterns.
2. **Extract one cluster at a time** into its own package/module/service.
3. **Define a stable interface** between the new module and the original. Avoid leaking internal types.
4. **Migrate callers** to the new interface.
5. **Repeat** until the original class is small or empty.

### From a god service to microservices

The same process at service scale:

1. Identify subdomain clusters via use-case analysis or event storming.
2. Extract one subdomain into its own service. Define the **anti-corruption layer** that maps between old and new domain models.
3. Migrate clients via strangler fig (route new calls to new service; old calls keep working).
4. Eventually retire the corresponding code from the monolith.

> **Critical:** the order matters. Extract the **least-coupled** cluster first. Extracting the most-coupled cluster first creates a chatty distributed system that's worse than the monolith.

### Schema-driven cures for service-boundary Primitive Obsession

When a `String userId` flows through five services with five different validation rules:

1. Define `UserId` in a **shared schema** (Protobuf, Avro, or JSON Schema).
2. Generate code per language.
3. Each service uses the generated type — validation, serialization, and equality come for free.
4. Schema versioning becomes the contract.

This is the architectural analog of Replace Data Value with Object.

---

## Migration patterns for large codebases

### Strangler fig

Originated by Martin Fowler. Wrap the bloater (a class, a service, a database table) in a new interface. Route new use cases to a new implementation. Migrate old callers gradually. The new code "strangles" the old, replacing it leaf by leaf.

**When to use:** large, change-prone bloaters. The bloater stays operational throughout.

### Branch by abstraction

Introduce an interface over the bloater. Provide two implementations: the old (delegates to bloater) and the new (refactored). Switch via feature flag. Both implementations live side-by-side until rollout completes; then the old one is deleted.

**When to use:** when you need to roll out the change gradually with a kill-switch.

### Mikado method

Attempt the desired refactoring. Record everything that breaks. Revert. Now the broken things become prerequisite refactorings. Apply them. Re-attempt. Recurse.

The output is a **dependency tree of small refactorings** (the "Mikado graph"), executed bottom-up in safe steps.

**When to use:** when the bloater is too tangled to attack head-on.

### Characterization tests

Before refactoring a bloater that has no tests:

1. Run the bloater on representative inputs in production.
2. Capture inputs and outputs (use VCR-style recording).
3. Replay them as tests against the current code — they pass by construction.
4. Refactor; the captured tests now act as a safety net.

These tests don't document *what should be true* — they document *what is true today*. Once the refactoring is done, replace them with intent-based tests.

---

## CI/CD integration

### Baseline mode for legacy code

The hardest part of introducing a linter to a legacy codebase: the first run produces 10,000 violations. Don't fail the build on all of them — adopt a **baseline**:

- Run the linter once. Save the violations to `lint-baseline.json`.
- Future builds fail only on **new** violations or **changes** to existing violation lines.
- The baseline shrinks over time as violations are fixed.

SonarQube, ESLint, golangci-lint, and ruff all support baseline mode.

### "Don't make it worse" gate

A weaker but practical gate: PRs cannot increase the violation count for changed files. This:

- Allows urgent fixes that don't worsen the code.
- Prevents drift toward more bloating.
- Doesn't require fixing the entire backlog.

### Per-PR complexity diff

Some teams report cognitive complexity *delta* per PR:

```
+ Cognitive complexity: 47 (was 32)
- Method `processOrder` complexity: 28 (was 18) — please review
```

This makes the cost of "just one more conditional" visible at review time.

### Quality gates by responsibility area

A common compromise: stricter thresholds for new code, looser for legacy. Tag legacy directories in the linter config. New files get full enforcement; legacy files get the baseline approach.

---

## Metrics that catch Bloaters early

| Metric | Catches | Trigger threshold |
|---|---|---|
| **Lines of code per method** | Long Method | > 50 |
| **Cognitive complexity per method** | Long Method (nuanced) | > 15 |
| **Field count per class** | Large Class | > 15 |
| **Method count per class** | Large Class | > 30 |
| **Parameter count per method** | Long Parameter List | > 5 |
| **Boolean parameters per method** | LPL with hidden behavior | ≥ 3 |
| **Fan-out (classes referenced)** | Large Class | > 20 |
| **Fan-in (classes referencing this)** | Possible god class | > 30 |
| **Change frequency × file size** | Bloater hotspots | top 5% × > 500 lines |

The **change frequency × size** metric (sometimes called "code hotspot") is especially useful: a 2,000-line class that hasn't changed in 3 years isn't worth refactoring; a 600-line class changed every week is the highest-value target.

> **Tooling:** `git log --pretty=format:%H --name-only | sort | uniq -c | sort -nr` gives a quick "files changed most often" list. Combine with `wc -l` for size.

---

## Code-review heuristics

Reviewers should flag:

- **Adding a 6th parameter** to an existing method. Suggest parameter object.
- **Adding a 16th field** to an existing class. Suggest extracting a sub-concept.
- **Adding a third boolean parameter.** Suggest split into separate methods.
- **Adding a 4-field clump** of `String`s with related names. Suggest class extraction.
- **Methods crossing 60 lines** in the diff. Suggest extraction.
- **A new function returning a tuple of 4+ unnamed values** (Go especially). Suggest a result struct.
- **Adding `// step 1`, `// step 2` comments** inside a method. The "steps" want to be methods.

Code review is the cheapest place to catch Bloaters — they're 5 lines now, not 500.

---

## Architectural anti-patterns built on Bloaters

| Anti-pattern | Underlying smell |
|---|---|
| **God Class / God Object** | Large Class |
| **Anemic Domain Model** | Data Clumps + Primitive Obsession (data with no behavior) |
| **Shotgun Architecture** | Long Parameter List spreading across services |
| **Magic Strings / Magic Numbers** | Primitive Obsession |
| **Distributed Monolith** | Long Method scaled to "single workflow spread across N services" |
| **Stringly-Typed APIs** | Primitive Obsession at API surface |
| **The Big Ball of Mud** | All five Bloaters compounded |

Naming the anti-pattern often clarifies the underlying smell — and points to which cure to start with.

---

## The "rewrite vs. refactor" decision

When a bloater is bad enough to consider a rewrite:

| Favors refactor | Favors rewrite |
|---|---|
| Bloater is < 10,000 lines | Bloater is > 100,000 lines |
| Tests exist or can be added | No tests, no chance of writing them |
| Changes are frequent (work is amortized) | Changes are rare |
| Domain understanding lives in the team | Domain understanding has been lost |
| Tech stack is current | Tech stack is dead (e.g., Java 6, Python 2) |
| Business logic is correct | Business logic itself is wrong |

Most decisions should favor refactoring. Rewrites famously fail more often than refactors — Joel Spolsky's "Things You Should Never Do" essay (2000) and many post-mortems confirm: **the rewrite usually re-introduces every bug the original learned to handle, plus new ones, plus the business logic the rewriter didn't know about.**

> **Compromise:** *strangler fig* lets you incrementally rewrite without committing to a big-bang replacement. New functionality goes to the new system; old paths stay in the bloater until they age out.

---

## Review questions

1. **A 5,000-line class is changed once a year and has no test failures. Should you refactor it?**
   Probably not on its own merits. Cost-benefit: 1 change/year × low pain = low ROI on refactoring. But check: is it blocking a needed change *now*? If yes, refactor enough to unblock the change. Otherwise leave it.

2. **Your linter reports 8,000 Bloater violations on Day 1. What's the practical move?**
   Adopt a baseline. Don't try to fix all 8,000 — you'll lose. Configure the linter to fail only on new violations and on changes to violation-bearing lines. The backlog shrinks naturally as files are touched.

3. **A team argues that microservices "by design" prevent Large Class. Defend or refute.**
   Refute. Microservices change *where* the smell appears. A 5,000-line class becomes a 5,000-line service. The smell follows the code. The cure (Extract Class → Extract Service) is the same idea applied at a different scale.

4. **Cognitive complexity vs. cyclomatic complexity — when is cyclomatic still useful?**
   Cyclomatic is still useful for *test coverage planning* — it estimates the number of distinct paths through a method, which roughly maps to the number of tests needed. For *maintainability*, cognitive complexity is closer to what humans experience.

5. **You're asked to refactor a Bloater but only have 30% test coverage. Plan?**
   Add characterization tests for the changed code paths first. Use VCR-style recording or property-based tests to capture current behavior. Then refactor inside the test net. Finally, replace characterization tests with intent-based tests that document desired behavior.

6. **An architectural review claims "every endpoint should take exactly one DTO." Is that always right?**
   Mostly yes. But health checks, simple GETs by ID, and metrics endpoints are pure overhead with a wrapper DTO. The rule's spirit is "no Long Parameter List at the boundary" — apply it where it pays.

7. **What's the relationship between Bloaters and code coverage?**
   Bloaters are usually undertested *because* they're hard to test. A 400-line method with 30 branches needs many tests; teams often write 1–2 happy-path tests and call it done. Splitting the bloater makes tests possible. Coverage as a metric *follows* the refactor, not precedes it.

8. **A team uses `var args` (`String... names`) to "avoid" Long Parameter List. Is that valid?**
   No — it disguises the smell. Varargs is fine when the parameters are genuinely homogeneous (`Math.max(int...)`). It's wrong when used as a hatch to avoid naming individual parameters; the cure for hidden parameters is parameter objects, not making them invisible.

9. **Strangler fig vs. branch by abstraction — which when?**
   Strangler fig: gradual replacement at *use site* level, often spanning months or years. Branch by abstraction: side-by-side implementations gated by a flag, usually completing in days/weeks. Strangler fig for big architectural moves; branch by abstraction for tactical refactors with rollback safety.

10. **Why does cognitive complexity penalize nesting more than line count?**
    Reading nested code requires holding the surrounding context in your head as you descend. Every nesting level adds a layer of "what's true at this point." A flat 100-line method imposes a fixed memory cost; a 5-deep nested 50-line method imposes a stack of conditions. The latter is harder despite being shorter.

---

> **Next:** [professional.md](professional.md) — runtime, JIT, GC, allocation patterns, and the actual measured cost of value objects vs. primitives.
