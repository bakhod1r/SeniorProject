# Composing Methods — Middle Level

> Focus: **why** and **when**. Real-world triggers, trade-offs, language-specific nuance, and the order in which to apply these refactorings on legacy code.

---

## Table of Contents

1. [The order matters](#the-order-matters)
2. [Real-world triggers](#real-world-triggers)
3. [Extract Method — when NOT to](#extract-method-when-not-to)
4. [Inline Method — when to be careful](#inline-method-when-to-be-careful)
5. [Replace Temp with Query — performance trap](#replace-temp-with-query-performance-trap)
6. [Method Object — single-use design](#method-object-single-use-design)
7. [Substitute Algorithm — the riskiest one](#substitute-algorithm-the-riskiest-one)
8. [Language-specific nuances](#language-specific-nuances)
9. [Composing Methods in functional style](#composing-methods-in-functional-style)
10. [Review questions](#review-questions)

---

## The order matters

If you walk into a 600-line method, do not immediately type **Extract Method**. Doing so on tangled state will produce extracted methods with 7-parameter signatures — you will have moved the mess, not removed it.

The canonical order from Fowler:

1. **Remove Assignments to Parameters** — so each parameter has one role.
2. **Split Temporary Variable** — so each temp has one role.
3. **Replace Temp with Query** — so locals don't have to become parameters.
4. **Extract Variable** — to name the gnarly sub-expressions.
5. **Extract Method** — now extraction is mechanical, parameters are minimal.
6. **If still too tangled:** Replace Method with Method Object and continue from step 1 inside the new class.

> **Mnemonic:** "Tame the temps, then extract." If a temp is mutated, split it. If it's a one-shot, inline it. If it's used many places, query it. *Then* you can cleanly carve up the body.

### Visual: the dependency graph

```
Remove Param Assignments ──┐
                           ├──► clean locals ──► Extract Method
Split Temporary Variable ──┤                       │
                           │                       │ if still tangled
Replace Temp with Query ──┘                       ▼
                                       Replace Method with Method Object
```

---

## Real-world triggers

These are the situations where Composing Methods refactorings actually get done, ranked by frequency:

### 1. Test pressure

You sit down to write a unit test for `OrderProcessor.processOrder()` and discover you'd need to set up 14 collaborators because the method does 7 things. You **Extract Method** on each phase, then your tests target the helpers individually.

### 2. Stack trace pressure

A 500-line method appears at the top of a production stack trace as `OrderService.process(OrderService.java:482)`. You can't tell what was happening at line 482. After Extract Method, the trace says `OrderService.applyLoyaltyDiscount(OrderService.java:23)` and the bug is obvious.

### 3. Code review pressure

A reviewer says "this method does too much" — the cheapest answer is Extract Method. The reviewer can now diff a 12-line orchestrator and 4 named helpers, instead of a 200-line lump.

### 4. Onboarding pressure

A new team member asks "what does `runDailyJob()` do?" If your answer takes more than a sentence, the method needs decomposition.

### 5. Bug pressure

The same bug returns three times in a quarter. Investigating shows the bug lives inside a 300-line method where the related code was scattered. Extract Method clusters the related logic; the next bug has one place to fix.

---

## Extract Method — when NOT to

Extract Method is the most-used refactoring, but it has limits.

### Don't extract if the fragment doesn't have a good name

If you can't find a 1–4-word name that describes what the fragment does, **the fragment isn't a unit**. Either:

- It's two separate ideas glued together — extract them separately.
- It's an implementation detail that doesn't deserve a name (e.g., a 3-line tight loop).

### Don't extract if extraction needs >4 parameters

The extracted method's signature tells you about the coupling between the fragment and the rest of the method. If you need to pass 5+ locals, the fragment was tangled with the surrounding state. Apply [Replace Temp with Query](junior.md#replace-temp-with-query) and [Split Temporary Variable](junior.md#split-temporary-variable) first.

### Don't extract across abstraction levels

A fragment that mixes domain logic ("compute discount") with low-level concerns ("log to file") shouldn't become one method. Split the abstraction levels first.

### Don't extract pure noise

```python
def total(items):
    return sum_items(items)

def sum_items(items):
    return sum(item.price for item in items)
```

`total` adds nothing over `sum_items`. Inline.

### Don't extract for "rule of three" prematurely

Two near-duplicates aren't yet duplication — they're coincidence. Wait for the third before extracting a shared helper. (See *DRY vs. WET* in [Dispensables](../../01-code-smells/04-dispensables/middle.md).)

---

## Inline Method — when to be careful

Inline is more dangerous than Extract because **callers exist**.

### Polymorphism

```java
class Shape {
    abstract double area();
}
class Circle extends Shape {
    double area() { return Math.PI * r * r; }
}
```

You **cannot** inline `area()` even though Circle's body is one line — `Shape s = ...; s.area();` dispatches at runtime.

### Public API

If the method is `public`, your IDE doesn't know all callers. Inlining and removing the method breaks downstream consumers. Most IDEs warn you. Treat `public` methods as load-bearing names.

### Recursive methods

You can't inline a method that calls itself.

### Side effects

If the method has side effects (writes to a logger, increments a counter), inlining can change call **order** subtly. Re-test.

### When inline is the right call

- A method created speculatively that turned out to be one-shot.
- A wrapper with no clarifying value (`getCustomerName()` → just `customer.name()`).
- A leaked private helper that was renamed and now duplicates a clearer call.

---

## Replace Temp with Query — performance trap

The basic example in [junior.md](junior.md#replace-temp-with-query) is harmless: `quantity * itemPrice` is two arithmetic ops, the JIT inlines, the optimizer may even constant-fold across calls.

**Watch out** when the temp caches the result of:

- A database query (`var customer = db.fetchById(id)` — calling 3 times = 3 round trips)
- A network call
- A sort or large allocation
- A side-effecting method (calling twice = doubled side effect; this is a correctness bug, not perf)

### Pragmatic rule

Replace Temp with Query when:
- The expression is **pure**.
- The cost is small or memoized.
- The method becomes part of the class's vocabulary.

Keep the temp when:
- The expression has **observable cost** (I/O, allocation, sort).
- The temp would be called many times in a loop.

If you want both clarity *and* caching, name the temp with a comment: `// cache: avoid repeated DB calls`.

---

## Method Object — single-use design

A Method Object is **not a normal class**. It exists to host one computation. After `compute()` returns, the object is dead.

### Why it works

In normal OOP, a class's fields are long-lived state. In a Method Object, fields are **just locals that can now be shared between extracted helpers without being passed**. This sidesteps the "extracting needs 7 parameters" problem.

### How to use it

```java
public Money totalForOrder(Order order, Customer customer) {
    return new TotalCalculator(order, customer).compute();
}
```

The caller doesn't see the object. It's a private implementation detail.

### When it's overkill

- The original method has 50 lines and 3 locals — Extract Method works fine; don't promote.
- The state is genuinely shared across calls — you want a normal collaborator, not a Method Object.

### When it shines

- A 400-line method with 12 mutually-dependent locals.
- A computation that has identifiable phases (validate → price → tax → ship → audit).
- A flow that you want to be **unit-testable per phase**.

> Method Object is also the natural starting point for the **Command** design pattern (when you want to queue, log, or undo the operation).

---

## Substitute Algorithm — the riskiest one

Every other refactoring in this category is mechanical — the IDE can do it. **Substitute Algorithm cannot be automated** because the new body is *new code*.

### Required pre-conditions

1. **Behavior-pinning tests.** Run the old algorithm against many inputs; capture outputs. Use that as a regression suite. ("Approval testing" is a name for this.)
2. **A known-equivalent reference.** Either a passage from a paper, a different language's standard library, or a colleague's review.
3. **A rollback plan.** Keep the old method behind a flag for a release.

### Common pitfalls

- **Edge cases.** The old algorithm handled the empty list / null / negative quantity in some specific way that wasn't in the spec but was relied upon.
- **Floating-point determinism.** Replacing `pow(x, 2)` with `x * x` is supposedly equivalent — until you see a test fail because rounding differs in the last bit.
- **Performance regression.** The old algorithm was slower in big-O but faster in the small-N case the production load actually has.

### Real example: linear scan vs. set lookup

The junior example replaces `if (a == "Don") || (a == "John") || ...` with a `Set.contains`. For 3 candidates and a 10-element input, the set is **slower** (hashing overhead). For 30 candidates and a 10000-element input, the set is dramatically faster. Substitute Algorithm is sometimes a perf trade you don't want.

---

## Language-specific nuances

### Java

- `final` parameters and locals make several refactorings (Remove Assignments, Split Temporary Variable) compile-time-checkable. Many style guides require it.
- IntelliJ and Eclipse have one-keystroke refactorings for every technique in this category. Trust them. Always commit before; test after.
- `var` (Java 10+) makes Extract Variable cheap — no type ceremony.

### Python

- Dynamic typing means Extract Method is more error-prone than in Java. The IDE can't always confirm the extracted signature is correct. Lean on tests.
- Closures replace many parameter-passing concerns: nested defs see enclosing locals automatically. This makes Method Object less needed; sometimes a closure does the job.
- `@staticmethod` / `@classmethod` make extracted helpers explicit about their `self` use.
- `dataclasses` are the natural home for Method Object (`@dataclass class Calculator: ... ; def compute(self): ...`).

### Go

- Go has no inheritance, so Inline Method has no polymorphism trap (interface satisfaction is structural — inlining a method removes interface satisfaction; the compiler will tell you).
- Closures + struct receivers cover Method Object cleanly.
- Go's strong tooling (`gofmt`, `gopls`) doesn't include automated Extract Method (yet); it's a manual operation, but `gopls`'s `extract` *is* available in some editors.

### TypeScript

- Arrow functions + closures make Extract Method cheap (`const subtotal = () => items.reduce(...)`).
- Type inference means extracted variable types rarely need to be written out.

---

## Composing Methods in functional style

Most "Composing Methods" refactorings predate the modern functional style. In a codebase using `.map`, `.filter`, `.reduce`, `Stream`, list comprehensions:

- **Extract Method** often becomes Extract Function, with no `this`.
- **Replace Temp with Query** maps onto pure functions naturally.
- **Long Method** is often pre-cured by pipelines: `items.stream().filter(...).map(...).reduce(...)` is implicitly decomposed.
- **Method Object** is replaced by *closures over a shared environment* (e.g., a builder function returning closures).

The principles still apply — long lambdas are a smell too. The cure is the same: name the parts.

---

## Review questions

1. What's the canonical order to apply Composing Methods refactorings on a legacy method?
2. Why must you "tame the temps" before extracting?
3. Give two scenarios where Extract Method is the wrong move.
4. What kinds of methods cannot be safely inlined?
5. Why is Replace Temp with Query a performance trap, and how do you mitigate?
6. How does a Method Object differ from a normal collaborator class?
7. What pre-conditions does Substitute Algorithm require?
8. What does `final` on a Java parameter buy you in this category?
9. How do closures change the Method Object refactoring?
10. How do functional pipelines pre-empt the Long Method smell?
