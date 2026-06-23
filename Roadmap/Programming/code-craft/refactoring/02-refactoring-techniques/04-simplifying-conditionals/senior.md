# Simplifying Conditional Expressions — Senior Level

> Exhaustiveness checking, type-driven design, the expression problem, and how conditional structure reflects (or hides) architecture.

---

## Table of Contents

1. [Conditional structure as a design indicator](#conditional-structure-as-a-design-indicator)
2. [Exhaustiveness as a design tool](#exhaustiveness-as-a-design-tool)
3. [The expression problem at scale](#the-expression-problem-at-scale)
4. [Visitor pattern and double dispatch](#visitor-pattern-and-double-dispatch)
5. [State machines vs. conditionals](#state-machines-vs-conditionals)
6. [Decision tables and rule engines](#decision-tables-and-rule-engines)
7. [Refactoring under uncertainty](#refactoring-under-uncertainty)
8. [Tooling: SonarQube, ESLint, type-driven flags](#tooling-sonarqube-eslint-type-driven-flags)
9. [Anti-patterns at scale](#anti-patterns-at-scale)
10. [Review questions](#review-questions)

---

## Conditional structure as a design indicator

A senior reading code looks at the *shape* of conditionals as a diagnostic:

| Symptom | Likely diagnosis |
|---|---|
| Deep nesting (4+ levels) | Method has too many responsibilities |
| Big switch on type code | Missing polymorphism |
| Many sequential `if x == null` | Missing Null Object or Optional |
| Booleans as parameters | Missing Replace Parameter with Explicit Methods |
| Same condition in 5 places | Missing query method or strategy |
| Long if-else if chain over numeric ranges | Missing decision table |
| Nested switch statements | Missing strategy / state machine |

These are not surface-level concerns. Each pattern signals a deeper design issue.

> **Senior heuristic:** the structure of conditionals reveals what the code *thinks* the world looks like. Mismatch between conditional structure and domain structure is a refactoring opportunity.

---

## Exhaustiveness as a design tool

When you Replace Conditional with Polymorphism using a sealed type or exhaustive switch, the compiler enforces that **every variant is handled**:

```java
sealed interface Order permits Draft, Submitted, Shipped, Cancelled {}

String describe(Order o) {
    return switch (o) {
        case Draft d -> "Draft #" + d.id();
        case Submitted s -> "Submitted #" + s.id();
        case Shipped sh -> "Shipped #" + sh.id();
        case Cancelled c -> "Cancelled #" + c.id();
    };  // compile error if a case is missing
}
```

Adding a new variant `Returned` becomes a compile-time event, not a runtime surprise.

### Why this matters

In a non-exhaustive design (`switch` on `int` or strings), a new variant silently slips into a `default` branch — often handled wrong. Exhaustiveness shifts the cost from production bugs to compiler errors.

### Languages with exhaustive switch

- Rust (`match` is exhaustive on enums).
- Scala (sealed traits).
- Kotlin (`when` on sealed classes).
- TypeScript (discriminated unions with `never`).
- Java 21+ (sealed + pattern matching).

### Languages without (default behavior)

- Python (`match` is not exhaustive by default; use type-checking).
- Go (no sum types; tag fields + switch).
- C (no compile-time checking).

---

## The expression problem at scale

The classic trade-off:

| Approach | Easy to add | Hard to add |
|---|---|---|
| Polymorphism (subclasses + virtual methods) | A new **type** (one new class) | A new **operation** (modify every subclass) |
| Pattern matching / switch | A new **operation** (write a new function) | A new **type** (modify every function) |

In a closed domain (the set of types is stable; new operations come up): use pattern matching.

In an open domain (new types arrive often; operations are stable): use polymorphism.

In real codebases, you have both pressures. The senior move:

1. Identify the closed parts (e.g., financial instruments — fixed set: stock, bond, option).
2. Identify the open parts (e.g., events in an event-sourced system — new event types added monthly).
3. Use the right tool for each.

Don't apply Replace Conditional with Polymorphism universally. Sometimes the conditional is right.

---

## Visitor pattern and double dispatch

When you need to add new operations to a closed type hierarchy *without modifying it*, the Visitor pattern is the classical answer:

```java
interface Shape { <R> R accept(ShapeVisitor<R> v); }
class Circle implements Shape {
    public <R> R accept(ShapeVisitor<R> v) { return v.visit(this); }
}
class Square implements Shape {
    public <R> R accept(ShapeVisitor<R> v) { return v.visit(this); }
}

interface ShapeVisitor<R> {
    R visit(Circle c);
    R visit(Square s);
}

// New operation = new Visitor implementation:
class AreaVisitor implements ShapeVisitor<Double> {
    public Double visit(Circle c) { return Math.PI * c.r() * c.r(); }
    public Double visit(Square s) { return s.side() * s.side(); }
}
```

### When Visitor wins

- The type hierarchy is closed (you control it).
- New operations come up frequently.
- The operation logic is non-trivial.

### When sealed + pattern matching wins

- The language supports it (Java 21+, Scala, Kotlin, Rust).
- Operations are simple expressions (no need for class-level structure).
- Less ceremony than Visitor.

In modern Java, sealed + switch has largely replaced Visitor for new code. Visitor remains useful for:
- Complex compiler/AST traversal where each visit may carry state.
- Cross-cutting operations that benefit from a Visitor parameter.

---

## State machines vs. conditionals

Order: DRAFT → SUBMITTED → SHIPPED → DELIVERED. With cancellation possible at most stages.

### Bad: imperative conditionals

```java
public void cancel() {
    if (status == DRAFT) { status = CANCELLED; return; }
    if (status == SUBMITTED) { refund(); status = CANCELLED; return; }
    if (status == SHIPPED) { throw new IllegalStateException(); }
    if (status == DELIVERED) { throw new IllegalStateException(); }
}
```

### Better: State pattern

Each state knows what `cancel()` means.

```java
interface OrderStatus { void cancel(Order o); }
class DraftStatus implements OrderStatus { ... }
class SubmittedStatus implements OrderStatus { ... }
// etc.
```

### Best for complex flows: explicit state machine

```java
StateMachine<OrderStatus, Event> sm = StateMachine.builder()
    .from(DRAFT).on(SUBMIT).to(SUBMITTED)
    .from(SUBMITTED).on(SHIP).to(SHIPPED)
    .from(SHIPPED).on(DELIVER).to(DELIVERED)
    .from(DRAFT).on(CANCEL).to(CANCELLED)
    .from(SUBMITTED).on(CANCEL).to(CANCELLED, REFUND_ACTION)
    .build();
```

Spring StateMachine, Java's Squirrel-Foundation, or even AWS Step Functions externalize the flow entirely.

### Senior decision

| Need | Tool |
|---|---|
| 2–3 states, simple | switch / polymorphism |
| 4–10 states, complex transitions | State pattern |
| Many states, audit/persistence/replay | State machine engine |
| Distributed, async, failure handling | Workflow engine (Temporal, Cadence) |

---

## Decision tables and rule engines

Some "if-else if" chains aren't really code — they're **rules**.

```java
double tier(double spend, int years, String country) {
    if (years > 10 && spend > 5000) return GOLD;
    if (country.equals("US") && spend > 1000) return SILVER;
    if (years > 5) return SILVER;
    if (spend > 100) return BRONZE;
    return NONE;
}
```

When this grows to 50 rules involving 10 variables, it's a **decision table** trapped in code.

### Move to data

```yaml
tiers:
  - name: GOLD
    when: years > 10 AND spend > 5000
  - name: SILVER
    when: country == "US" AND spend > 1000
  - name: SILVER
    when: years > 5
  - name: BRONZE
    when: spend > 100
```

Engines: Drools, Camunda DMN, Easy Rules, OpenL Tablets.

### When to externalize

- Rules change often without code releases.
- Domain experts (non-developers) maintain the rules.
- Auditing the rule set is required (compliance, finance).

### When NOT

- Rules are stable for years.
- The "rule" is so tied to performance / data shape that an engine adds latency.
- The team doesn't want a new technology.

---

## Refactoring under uncertainty

Sometimes you find a 200-line conditional and don't know all the cases. Senior approach:

1. **Characterize first.** Write tests that capture current behavior on representative inputs.
2. **Map by case.** Read the conditional and write a table:
   ```
   | input | branch taken | output |
   ```
3. **Identify dead branches.** Some are unreachable. Note carefully — they may be defensive against rare inputs.
4. **Apply Decompose Conditional.** Each branch becomes a named method.
5. **Apply Replace Conditional with Polymorphism** (or guard clauses) once structure is clear.
6. **Re-run characterization tests.**

This is slow. It's also reliable. Don't shortcut on conditionals you don't fully understand.

---

## Tooling: SonarQube, ESLint, type-driven flags

| Tool | Helps with |
|---|---|
| SonarQube | Cyclomatic complexity, "switch missing default", duplicate branches |
| ESLint (with plugins) | `no-fallthrough`, `default-case`, exhaustive-deps for hooks |
| TypeScript strict | `--strictNullChecks`, exhaustiveness via `never` |
| Cognitive Complexity (G. Ann Campbell) | Better than cyclomatic for nested ifs |
| ArchUnit | Forbid switch over types in non-factory code |

### Cyclomatic vs. cognitive complexity

Cyclomatic counts branches. A 10-case switch is "complexity 10."

Cognitive complexity weights nesting more heavily — a 10-case flat switch is "cognitive 10," but two nested switches of 5 each is "cognitive 25" (or worse). Cognitive complexity better matches what readers experience.

Set CI gates on cognitive complexity to catch nested-conditional regressions early.

---

## Anti-patterns at scale

### 1. Mass refactoring to polymorphism prematurely

Two cases is not polymorphism. Hold off until you have 3+ AND each case has non-trivial behavior.

### 2. Universal Null Object

Replacing every nullable with a Null Object means callers can never tell if data was found. The Null Object is invisible — bugs hide in default behavior.

### 3. Over-asserted code

Assertions in every method, often duplicating type system. After type checks, more assertions add noise without value.

### 4. The `default: throw new IllegalStateException("can't happen")` epidemic

If you trust the type system, the default isn't reachable. If you don't, your model is wrong. Either fix the model or use exhaustive checking. The throw is symptomatic.

### 5. Guard clauses for everything

A method with 12 guard clauses and 1 line of "real" work is inverted — the special cases dominate. Often the method is too generic; consider Replace Parameter with Explicit Methods.

---

## Review questions

1. How does conditional structure reveal architectural mismatches?
2. What does exhaustiveness checking buy you over a default branch?
3. What is the expression problem? How do polymorphism and pattern matching trade off?
4. When is the Visitor pattern still preferable to sealed types + pattern matching?
5. When does a state machine engine win over the State pattern?
6. When should rules become a decision table outside code?
7. What's the difference between cyclomatic and cognitive complexity?
8. When is "Universal Null Object" a problem?
9. Why is `default: throw new IllegalStateException(...)` a smell?
10. How do you refactor a 200-line conditional you don't fully understand?
