# Composing Methods — Senior Level

> Focus: architecture-scale impact, automated refactoring tooling, refactoring at the speed of CI, and the relationship between Composing Methods and design at the system level.

---

## Table of Contents

1. [Composing Methods at architecture scale](#composing-methods-at-architecture-scale)
2. [The IDE is the senior engineer's amplifier](#the-ide-is-the-senior-engineers-amplifier)
3. [Refactoring under green CI](#refactoring-under-green-ci)
4. [The Mikado Method](#the-mikado-method)
5. [Strangler Fig and Branch by Abstraction](#strangler-fig-and-branch-by-abstraction)
6. [Characterization tests](#characterization-tests)
7. [Extract Method as architecture move](#extract-method-as-architecture-move)
8. [Method Object → Command/Saga/Workflow](#method-object-commandsagaworkflow)
9. [The cost of refactoring debt](#the-cost-of-refactoring-debt)
10. [Anti-patterns: refactoring theatre](#anti-patterns-refactoring-theatre)
11. [Review questions](#review-questions)

---

## Composing Methods at architecture scale

These refactorings start local but accumulate into architecture-level wins:

| Local refactoring | Architectural payoff |
|---|---|
| Extract Method (across one bounded context) | Reveals service boundaries hidden inside a "god" service. |
| Method Object | Becomes the seed of a Command, Saga, or Workflow class — lifts a method into a first-class operation. |
| Replace Temp with Query | Surfaces queries that turn out to belong on a different aggregate root → triggers Move Method. |
| Substitute Algorithm | One method's perf change shifts the whole service's p99. |

A senior's job is to recognize when a method-level refactor is signaling a class-level (or service-level) re-architecture. Extracting a 40-line "fraud scoring" block from `OrderService` is rarely "just a helper" — it usually wants to be its own class, and eventually its own service.

---

## The IDE is the senior engineer's amplifier

Composing Methods is the category where IDE refactoring tools have the highest ROI.

### IntelliJ IDEA / Android Studio (Java/Kotlin)

| Action | Shortcut (mac) | What it does |
|---|---|---|
| Extract Method | ⌘⌥M | Selection → new method, parameters inferred. |
| Inline | ⌘⌥N | Method/variable inlined, all callers updated. |
| Extract Variable | ⌘⌥V | Selection → local; offers all-occurrences. |
| Extract Constant | ⌘⌥C | Selection → static final. |
| Extract Field | ⌘⌥F | Selection → field, with init choice. |
| Extract Parameter | ⌘⌥P | Selection → method parameter, callers updated. |
| Refactor This | ⌃T | Menu of every contextual refactoring. |

These are **safe** in the formal sense: IntelliJ runs static analysis to ensure the refactoring is behavior-preserving for the in-language semantics. They are **not safe** for reflection, code generation, or build-time annotation processors — see [professional.md](professional.md).

### Eclipse JDT

Eclipse's refactoring engine predates IntelliJ's by years and remains rigorous. The same set is available, plus **rename in workspace** which crosses module boundaries.

### VS Code + Language Servers

- TypeScript: extract function / inline / move to file.
- Python: `pyright`, `pylsp` — extract variable, extract method, rename.
- Go: `gopls` — extract function (selection-based), rename, simplify range loop.
- Rust: `rust-analyzer` — extract function with borrow-checker-aware parameter passing.

### Tree-sitter / AST-grep / OpenRewrite

For codebase-wide refactoring across thousands of files:

- **OpenRewrite** (Java, Kotlin, Groovy, Maven, Gradle) — declarative recipes that describe a refactoring; runs as a build step. Used by Spring/Boot upgrades.
- **ast-grep** — language-agnostic structural search-and-replace.
- **comby** — match patterns across multiple languages.

These are how senior engineers **roll out a refactoring across 50 microservices** without a 6-month manual program.

---

## Refactoring under green CI

The cardinal rule: **commit small, commit often, never break the build**.

### The 3-minute commit rhythm

1. Apply ONE refactoring (one Extract Method, one Inline Temp).
2. Run the test suite (or the affected subset).
3. Commit with a message that names the refactoring (`refactor: Extract Method subtotal()`).
4. Push (or stack a PR commit).

Rinse for 8 hours. At the end of the day you have 50 small, reviewable, individually-revertible commits — and a much cleaner codebase.

### Why this rhythm matters

- **Bisectable.** If a refactor introduces a bug, `git bisect` finds it in 6 commits, not 600.
- **Reviewable.** A reviewer can rubber-stamp 50 mechanical commits in 20 minutes; one giant PR takes a day.
- **Resumable.** If interrupted, you've shipped value at every checkpoint.

### When the build is red

Stop. Composing Methods refactorings are not a place to be heroic. If you have to wade into a method to fix a bug *and* clean up, do them in two commits — bug first, refactor after, with green CI between.

---

## The Mikado Method

When a refactoring you want to do can't be done because it depends on another, which depends on another, you have a **Mikado graph**.

### The procedure

1. Try the refactoring you want.
2. It fails — note the obstacle (e.g., "can't inline this method, it's polymorphic").
3. Revert.
4. Refactor away the obstacle.
5. Try again.
6. Repeat — building up a graph of dependencies.

The leaves of the graph are the refactorings you can actually do today. Do those, and the dependencies cascade upward.

### Why this works for Composing Methods

A 600-line method can be terrifying to refactor head-on. The Mikado method gives you a way to **always be making progress**. You never get stuck — every revert teaches you what the next leaf is.

> Reference: *The Mikado Method* (Ola Ellnestam, Daniel Brolund, 2014). Free intro materials online.

---

## Strangler Fig and Branch by Abstraction

These are the architectural counterparts to Method Object.

### Strangler Fig

Wrap the old method/system with a new interface. Route some calls to old, some to new. Gradually migrate. Old gets pruned when no callers remain.

For Composing Methods scale: rename old `processOrder()` to `processOrderLegacy()`, create new `processOrder()` that delegates, and migrate callers one by one. Eventually delete the legacy.

### Branch by Abstraction

Insert an interface between callers and the implementation. Provide two implementations: old, new. Toggle between them with a flag.

For a method object: `interface OrderProcessor { compute(); } class LegacyOrderProcessor; class NewOrderProcessor;`. Flip the binding once new is verified.

These let you refactor under live traffic — critical for systems where you cannot freeze.

---

## Characterization tests

When refactoring legacy code with no tests, you write **characterization tests** first: tests that capture *current behavior* (warts and all) so you can refactor without behavior drift.

### Procedure

1. Pick a representative input.
2. Call the method.
3. Capture the output (and any side effects).
4. Encode the captured behavior as an assertion.
5. Repeat until you have coverage.

These tests **codify bugs** — they may fail after a future correctness fix. That's a feature: the next person to touch the bug must update the test, signaling intent.

### Tools

- **Approval testing** (`approvaltests`, Verify, snap-shot) — store the expected output as a file; diff on each run.
- **Property-based testing** with hand-picked values for legacy paths.
- **Differential testing**: run old and new side-by-side on production traffic, alert on disagreement (Twitter's "Diffy", LinkedIn's "Lambda Architecture").

> Reference: *Working Effectively with Legacy Code* — Michael Feathers (2004). The book that named this technique.

---

## Extract Method as architecture move

Watch what happens when you Extract Method on a 400-line `processOrder()`:

```
processOrder() {                  processOrder() {
  validate(...)                     validate(o)
  price(...)                        price(o)
  tax(...)              ─────►     tax(o)
  inventory(...)                    inventory(o)
  payment(...)                      payment(o)
  email(...)                        email(o)
  log(...)                          log(o)
}                                 }
```

Now ask: *do these 7 helpers belong in `OrderService`?*

- `validate` and `tax` probably belong in dedicated classes (`OrderValidator`, `TaxCalculator`).
- `email` belongs in a notification module.
- `log` is a cross-cutting concern (filter/aspect).
- `payment` likely calls a `PaymentGateway` collaborator.

In other words: **Extract Method exposes the structural shape**. The next refactoring is [Move Method](../02-moving-features/junior.md) — and now you have the building blocks of a properly-decomposed module.

This is what senior engineers mean by "refactor the small to discover the big." The local move surfaces the global design.

---

## Method Object → Command/Saga/Workflow

Once you have a Method Object, four directions of growth are common:

### Command pattern

Add `undo()`, `serialize()`, `enqueue()`. Now the method is a first-class action: you can audit it, replay it, queue it. (See Behavioral Patterns.)

### Saga / orchestration

A Method Object whose phases are async (validate, charge, ship) is a saga. Rename phases to `step1Validate`, `step2Charge`, `step3Ship`, add a state machine, and you have an orchestration class.

### Workflow engine

If sagas pile up, a workflow engine (Temporal, Cadence, AWS Step Functions, Camunda) externalizes the state machine. The Method Object becomes the workflow definition.

### Pipeline / chain

If the phases are pure transforms, the Method Object becomes a pipeline: `items.through(validate).through(price).through(tax)`. Data flows linearly.

> The trajectory: **method → method object → command → workflow → service** is one of the most reliable refactoring paths from messy monolith to clean architecture. Every step is small. Every step is reversible.

---

## The cost of refactoring debt

Composing Methods refactorings are individually small but the **debt of not doing them** compounds:

- **Onboarding cost.** Every new engineer pays interest on a 500-line `runDailyJob()`.
- **Bug cost.** Long methods produce bugs at a rate roughly quadratic in length (data: SonarQube studies, Microsoft Research).
- **Throughput cost.** Each PR touching the bloated method spends ~30% of review time on context.
- **Architectural opacity.** You cannot see the system's structure through a hairball of long methods, so you can't make architectural decisions.

Senior engineers track this debt explicitly. SonarQube, CodeScene, Code Climate all surface "long method" and "complexity hotspot" metrics.

---

## Anti-patterns: refactoring theatre

Avoid these — they look like refactoring but produce no value (or worse).

### 1. Premature decomposition

Extracting a 5-line method into 5 one-line methods. Each method-call boundary now costs cognitive load. The cure is worse than the smell.

### 2. Renaming carousel

Renaming the same method 4 times in a quarter as opinions shift. Pick a name, commit, move on.

### 3. Leaky helpers

Extracting a "helper" that takes 8 parameters because the original method had a tangled local state. The signature is screaming for [Method Object](junior.md#replace-method-with-method-object) — but instead you've buried the smell.

### 4. The PR with 80 mechanical commits and one logic change

Reviewers can't see the logic change in the noise. Separate refactoring PRs from feature PRs.

### 5. Re-extracting fragments that were merged into the body for a reason

Sometimes a previous engineer inlined a helper to fix a hot path. Re-extracting reverses a real performance fix. Always check git log.

---

## Review questions

1. How do Composing Methods refactorings reveal architecture-level structure?
2. What's the "3-minute commit rhythm" and why does it matter?
3. Describe the Mikado Method and when you'd use it.
4. What's a characterization test? When is it the right tool?
5. How does Strangler Fig differ from Branch by Abstraction?
6. What four design patterns naturally extend from a Method Object?
7. Why should refactoring PRs be separate from feature PRs?
8. What IDE shortcuts do you use 10× per day in Java? Python?
9. How does OpenRewrite differ from IntelliJ refactoring?
10. Give an example of refactoring theatre and a concrete fix.
