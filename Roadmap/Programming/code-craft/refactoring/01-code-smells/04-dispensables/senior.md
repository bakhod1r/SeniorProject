# Dispensables — Senior Level

> Architectural Dispensables, tooling, code review heuristics.

---

## Table of Contents

1. [Architectural Dispensables](#architectural-dispensables)
2. [Detection tools](#detection-tools)
3. [The DRY / WET trade-off](#the-dry-wet-trade-off)
4. [Code-review heuristics](#code-review-heuristics)
5. [Removing dead microservices](#removing-dead-microservices)
6. [Architectural fitness functions](#architectural-fitness-functions)
7. [Review questions](#review-questions)

---

## Architectural Dispensables

| Code-level | Architectural |
|---|---|
| Comments | Outdated architecture docs, obsolete README sections |
| Duplicate Code | Two services solving the same problem (often from M&A or org silos) |
| Lazy Class | A microservice with one endpoint and minimal logic |
| Data Class | A "service" that's just a thin wrapper over a database CRUD |
| Dead Code | An entire service no one calls |
| Speculative Generality | A platform team's "framework" that no one uses |

### Dead microservices

A common pattern in older companies: services exist that nothing calls anymore. The team that built them has moved on. The service is still deployed, costs money, has dependencies, accumulates security alerts.

**Detection:** access logs, traces, network flow analysis. A service with zero ingress traffic for a month is a deletion candidate.

**Cure:** announce deprecation; check no internal callers; delete.

### Speculative microservice frameworks

A platform team builds an "internal framework" with extension points, plugin systems, custom DSLs — anticipating widespread adoption. Two years later: 1-2 teams use it, the framework's complexity exceeds the value. Cure: simplify (or delete) per actual usage.

---

## Detection tools

### Dead code detection

| Language | Tool |
|---|---|
| Java | IntelliJ "Inspect Code", `error-prone -Xep:UnusedMethod`, **`vulture` (yes, also for Java)** via JVMTI |
| Python | `vulture`, `ruff`'s `F401` (unused import), `F841` (unused local) |
| Go | `golangci-lint` with `unused`, `deadcode`, `unparam` |
| TypeScript | `tsc --noUnusedLocals --noUnusedParameters`, `eslint`'s `no-unused-vars` |
| Rust | `cargo clippy` (`unused_imports`, `dead_code`) |

### Duplicate code detection

| Tool | Notes |
|---|---|
| **PMD CPD** | Token-based duplicate detector; multi-language |
| **SonarQube** | Configurable threshold; flags blocks |
| **jscpd** | npm tool; supports many languages |
| **Simian** | Commercial, wide language coverage |

Use these to find *exact* and *near-duplicate* blocks. The output: ranked list of duplicates with locations.

### Comment quality

Limited automated tooling. Some linters flag:
- Commented-out code (heuristically): `eslint`'s `no-warning-comments`.
- TODO/FIXME counts: project-level dashboards.
- Doc coverage: SonarQube can require Javadoc on public methods.

The deeper issue (what-comments vs why-comments) requires human judgment.

---

## The DRY / WET trade-off

**DRY** (Don't Repeat Yourself): every piece of knowledge has one authoritative representation.

**WET** (Write Everything Twice, or Waste Everyone's Time, or We Enjoy Typing): the joke counter-acronym; sometimes used to mean "tolerate duplication."

**Reality**: extreme DRY creates *over-abstraction* — wrong abstractions that cause Speculative Generality. Extreme WET creates Duplicate Code that's hard to maintain.

The right balance:

- **Knowledge** should be DRY. A business rule should live in one place.
- **Code structure** can tolerate some duplication. Two methods with similar shape but different intent are not the same knowledge.
- **Apply Rule of Three**: refactor at the third occurrence, not the second.
- **Watch for premature abstraction**: an abstraction extracted from two cases often doesn't fit the third — leading to abstraction-distortion.

> Sandi Metz: "Duplication is far cheaper than the wrong abstraction."

---

## Code-review heuristics

Reviewers should flag:

- **Comments explaining *what***. Suggest extract method or rename.
- **Commented-out code**. Suggest delete (git remembers).
- **An abstract class with one subclass**. Ask: is a second subclass really expected?
- **A new "manager" / "helper" / "service" class with one method**. Ask: does it need its own class?
- **A new file added to the repo with one tiny class**. Probably Lazy Class.
- **Duplicate-looking blocks** within a single PR. Flag for extraction (subject to Rule of Three across PRs).

---

## Removing dead microservices

A 5-step playbook:

### Step 1 — Confirm zero traffic

Use observability tooling (Datadog, NewRelic, custom metrics). Look at the last 30 days of ingress + egress.

### Step 2 — Search for callers

In code: grep for the service's name, URL, hostname. In config: search Helm charts, Terraform, Kubernetes manifests. In docs: search Confluence, Notion.

### Step 3 — Announce removal

Send a Slack / email to engineering: "Service X is being removed. If you depend on it, respond by date Y." Wait two weeks.

### Step 4 — Disable but don't delete

Remove from production deployment but keep code in a `archive/` branch or marked-for-deletion repo. If something breaks, revert quickly.

### Step 5 — Delete after grace period

After 1-3 months without complaints, delete the code, the deployment configs, the database (if any), the docs, the Slack channels. The service is gone.

---

## Architectural fitness functions

```java
// ArchUnit: forbid lazy classes (less than N methods)
@ArchTest
static final ArchRule no_lazy_classes = 
    classes().that().resideInAPackage("..service..")
             .should().haveLessThanOrEqualTo(20).publicMethodsOrConstructors()
             .andShould().haveAtLeastOneMethod();

// Forbid abstract classes with one subclass (must use IDE + grep, ArchUnit limited)
```

For Dead Code at architectural level: integrate access-log analysis into CI, fail on services with no ingress for N days.

---

## Review questions

1. **A service has 1 endpoint and 50 lines of code. Lazy Class at architectural level?**
   Possibly. Reasons it might be valid: independent deployment cadence, separate team ownership, separate scaling needs. If none apply, fold the endpoint into a related service.

2. **A duplicate-code report shows 200 high-similarity blocks. Strategy?**
   Don't fix all 200. Rank by change frequency (which duplicates are touched most?) and fix top 10. The cold ones can wait.

3. **A team has a "documentation-as-code" rule — markdown in the repo. How does that interact with Comments smell?**
   It moves docs from comments to dedicated files — usually good. The smell of internal what-comments doesn't change; the docs are about *external* concerns (how to use the API), not internal *what* explanations.

4. **A "framework" was built by a platform team and one team uses it. Speculative Generality at architectural level?**
   Yes. Platform-team frameworks need at least 3 consumers to justify the maintenance burden. With one consumer, the framework should be simpler (or owned by that team directly).

5. **An abstract class has 1 concrete subclass plus a mock. Speculative Generality?**
   Borderline. The mock may justify the interface for testing. But often, you can mock the concrete class directly (with libraries like Mockito); the abstract class is unnecessary.

6. **DRY across services — same business logic in 3 services. Refactor or accept?**
   Often accept. Cross-service DRY usually means a shared library — which couples deployment, complicates rollouts, can lead to "library hell." Sometimes the right answer is duplicating with intentionality.

7. **A method's signature is `process(String, boolean, int)`. The boolean and int are always passed the same value. Smell?**
   Yes — Speculative Generality (parameters added "in case" of variation that never came). Cure: Remove Parameter.

8. **`vulture` finds 500 unused functions in Python. Trust the result?**
   No — verify. Reflection (`getattr`, `__init__.py` re-exports), framework callbacks (Flask routes, pytest fixtures, Django views), and dynamic imports may not be detected. Whitelist false positives.

9. **A team is rewriting a service. They want to keep dead code for "reference." Reasonable?**
   No — git is the reference. Keep the rewrite clean. If they need to look at the old code, branch off main.

10. **An interface in the public API is unused (no public consumers). Delete?**
    If truly public (third parties code against it), no — deletion is a breaking change. If "public" only means "exposed," and you control all consumers, delete after standard deprecation.

---

> **Next:** [professional.md](professional.md) — runtime cost of dispensables and detection internals.
