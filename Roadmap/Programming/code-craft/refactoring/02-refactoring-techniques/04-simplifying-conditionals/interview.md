# Simplifying Conditionals — Interview Q&A

> 50+ questions on the 8 techniques.

---

## Conceptual (Q1–Q12)

**Q1.** What does Decompose Conditional do?
A. Extracts the condition and each branch into named methods.

**Q2.** What's the difference between Decompose Conditional and Consolidate Conditional Expression?
A. Decompose names branches/conditions. Consolidate combines several `if`s with the same body.

**Q3.** What's a Guard Clause?
A. An early return for a special case (precondition or edge), keeping the main path at the lowest indent level.

**Q4.** What's the inverse approach to guard clauses?
A. Single-Entry-Single-Exit (SESE) — one return statement; nested ifs with a result accumulator.

**Q5.** What's Replace Conditional with Polymorphism?
A. Replace a `switch (type)` with subclasses each implementing the per-type behavior.

**Q6.** What's a Null Object?
A. A real object whose methods are no-ops, replacing null checks with normal method calls.

**Q7.** What does Introduce Assertion do?
A. Codifies an implicit assumption as a runtime check that fails fast on violation.

**Q8.** What does Remove Control Flag do?
A. Replaces a boolean flag (often used to exit a loop) with a `break` or `return`.

**Q9.** What does Consolidate Duplicate Conditional Fragments do?
A. Pulls code repeated in every branch out of the conditional.

**Q10.** Why is "indent depth" a quality metric?
A. Each level of indent adds cognitive load. Three levels are typically the upper bound for readable code.

**Q11.** What's "exhaustiveness checking"?
A. Compile-time guarantee that every variant of a type is handled in a switch / match.

**Q12.** What's the "expression problem"?
A. Polymorphism makes adding **types** easy and **operations** hard; pattern matching is the reverse.

---

## When to apply (Q13–Q25)

**Q13.** When is Replace Conditional with Polymorphism the wrong move?
A. When you have only 2–3 cases with simple bodies (a switch is clearer), or when the dispatch is on runtime state (use State pattern), or when the types don't form a real hierarchy.

**Q14.** When is Null Object wrong?
A. When the absence is genuinely exceptional (use Optional or throw); when faking would confuse callers; when default behavior isn't sensible.

**Q15.** When are guard clauses the wrong move?
A. When SESE is mandated by the team / domain; when the function is a pure calculation with symmetric branches.

**Q16.** When should you NOT consolidate sibling ifs?
A. When the reasons differ and you want to log/communicate which one fired.

**Q17.** When does Introduce Assertion become noise?
A. When the type system already enforces the invariant (e.g., `Objects.requireNonNull` after `@NonNull`).

**Q18.** When is `default: throw IllegalStateException` a smell?
A. When sealed types / exhaustive switch is available — relying on `default` to catch missing cases is type-system regression.

**Q19.** When is a state machine engine right vs. State pattern?
A. State pattern: ~5-10 states, simple transitions. Engine: many states, audit/persistence, distributed flows.

**Q20.** When should rules become a decision table outside code?
A. When rules change without code releases, when domain experts maintain them, when audit trails are required.

**Q21.** When is Visitor preferable to sealed types + pattern matching?
A. When the visitor needs complex shared state across traversal, or when pattern matching isn't available.

**Q22.** When should you prefer Optional over Null Object?
A. When absence is normal but worth thinking about explicitly; when the caller decides default behavior.

**Q23.** When should you throw vs. Optional?
A. Throw when absence is exceptional (programming error / not-found in a context where that's a 4xx/5xx). Optional when the caller decides.

**Q24.** When is Replace Nested Conditional with Guard Clauses NOT enough?
A. When the function still has too many branches even after flattening — apply Decompose Conditional or Replace with Polymorphism.

**Q25.** When is `switch` over an enum the right design?
A. When the variants are stable (closed set), the dispatch is in one place, and adding behavior is rare.

---

## Code-smell mapping (Q26–Q35)

**Q26.** Which smell does Replace Conditional with Polymorphism cure?
A. [Switch Statements](../../01-code-smells/02-oo-abusers/junior.md), often [Shotgun Surgery](../../01-code-smells/03-change-preventers/junior.md).

**Q27.** Which smell does Decompose Conditional cure?
A. [Long Method](../../01-code-smells/01-bloaters/junior.md) (when the length comes from conditionals), [Comments](../../01-code-smells/04-dispensables/junior.md).

**Q28.** Which smell does Consolidate Duplicate Conditional Fragments cure?
A. [Duplicate Code](../../01-code-smells/04-dispensables/junior.md).

**Q29.** Which smell does Introduce Null Object cure?
A. The "Switch Statements" variant where branches all check for null.

**Q30.** Which smell does Replace Nested with Guard Clauses cure?
A. [Long Method](../../01-code-smells/01-bloaters/junior.md), excessive nesting.

**Q31.** Why is excessive nesting a smell?
A. Cognitive complexity grows quadratically with nesting depth.

**Q32.** Which Composing Methods refactoring is most related to Decompose Conditional?
A. Extract Method.

**Q33.** Which smell suggests Remove Control Flag?
A. Long Method with a "found" or "done" boolean inside a loop.

**Q34.** When is a comment in conditional code a smell?
A. Whenever the comment could become a name. `// check if eligible` → `if (isEligible(user))`.

**Q35.** What smell does excessive use of Introduce Assertion indicate?
A. Either the type system is too weak (consider promoting types), or the code is defensive against bugs that should be impossible.

---

## Performance (Q36–Q45)

**Q36.** How does branch prediction affect refactoring decisions?
A. Predictable branches are nearly free; unpredictable ones cost 10-20 cycles per misprediction. Refactor toward patterns the predictor handles well (early-out guards).

**Q37.** What's the difference between `tableswitch` and `lookupswitch` in JVM?
A. `tableswitch` is a jump table for dense cases (O(1)); `lookupswitch` is a sorted lookup for sparse cases (O(log N)).

**Q38.** When does Replace Conditional with Polymorphism cost more than a switch?
A. When the call site becomes megamorphic (4+ types observed) — adds vtable lookup overhead.

**Q39.** Is Null Object slower than null check?
A. Roughly equivalent post-JIT for monomorphic call sites. Slightly slower if the site is bimorphic.

**Q40.** How does pattern matching compile in modern Java?
A. Via `invokedynamic` and a bootstrap that emits efficient `instanceof` chains; often equivalent to or faster than virtual dispatch.

**Q41.** What's an inline cache?
A. A small per-call-site cache of recent receiver types; allows monomorphic and bimorphic dispatch to be ~as fast as direct call.

**Q42.** How does PGO help conditional-heavy code in Go?
A. The compiler can devirtualize hot interface calls and inline aggressively at hot sites.

**Q43.** Why is `default: throw new IllegalStateException("can't happen")` sometimes a perf optimization?
A. It hints to the JIT that the default branch is unreachable, allowing more aggressive optimization of the other branches.

**Q44.** What's the cost of `Optional<T>` vs. nullable T at runtime?
A. Optional allocates an object (heap or stack via escape analysis); nullable is just a reference. For hot paths, the allocation matters.

**Q45.** Why does CPython make all conditional refactorings effectively free in terms of dispatch cost?
A. Every conditional is a bytecode instruction with similar overhead; refactoring doesn't change the bytecode count meaningfully. Only algorithmic changes help in CPython.

---

## Modern features (Q46–Q55)

**Q46.** What's a sealed type?
A. A type whose subclasses are explicitly enumerated. Enables exhaustive switch / match.

**Q47.** When was sealed types added to Java?
A. Java 17 (preview in 15/16).

**Q48.** What's pattern matching for switch in Java?
A. Java 21 (final). Allows `case Circle c -> ...` directly.

**Q49.** What's a discriminated union in TypeScript?
A. A union of types with a literal "tag" field that allows narrowing (`type Result = {ok: true, value: T} | {ok: false, error: E}`).

**Q50.** How does TypeScript enforce exhaustive switch?
A. Via the `never` type — the default branch must accept `never`, which is only possible if all cases are covered.

**Q51.** What's `match` in Python 3.10+?
A. Structural pattern matching. Like switch but matches on structure (tuples, dicts, classes).

**Q52.** Is Python's `match` exhaustive?
A. Not by default. Use type checkers (mypy) to enforce coverage.

**Q53.** What does `?.` do in TypeScript / Kotlin?
A. Optional chaining — returns null/undefined if the receiver is null instead of throwing.

**Q54.** What's `?:` (Elvis operator) in Kotlin?
A. Returns left side if non-null, otherwise right side. Common in Null Object alternatives.

**Q55.** What's `if let` in Rust?
A. Match a single pattern; bind a variable if it matches. Replaces nested `match` for single cases.

---

## Bonus (Q56–Q60)

**Q56.** What's "cognitive complexity"?
A. A complexity metric that weights nesting more than cyclomatic complexity, better matching reader experience.

**Q57.** What's the difference between cyclomatic and cognitive complexity?
A. Cyclomatic counts branches (linear). Cognitive counts and weights nesting/recursion. A flat 10-case switch is cyclomatic 10 / cognitive 10. A 3-deep nested switch is cyclomatic 10 / cognitive 25+.

**Q58.** Why is Replace Conditional with Polymorphism not always SOLID's "Open-Closed"?
A. Because polymorphism makes adding types easy but operations hard. Pattern matching is OCP for operations.

**Q59.** What's Liskov Substitution Principle's role in Replace Conditional with Polymorphism?
A. The subclasses replacing the conditional must be substitutable — same contract, no surprises. Violations re-introduce the switch.

**Q60.** What's the most common mistake when introducing Null Object?
A. Making the Null Object's behavior wrong for some callers — they actually needed to know about the missing case.

---

## Next

- Practice: [tasks.md](tasks.md), [find-bug.md](find-bug.md), [optimize.md](optimize.md)
- Recap: [junior.md](junior.md) → [middle.md](middle.md) → [senior.md](senior.md) → [professional.md](professional.md)
