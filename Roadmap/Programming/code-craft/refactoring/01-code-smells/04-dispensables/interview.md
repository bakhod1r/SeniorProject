# Dispensables — Interview Q&A

> 50 questions across all skill levels.

---

## Junior (15 questions)

### Q1. Name the six Dispensables.
Comments, Duplicate Code, Lazy Class, Data Class, Dead Code, Speculative Generality.

### Q2. Are all comments a smell?
No. *What*-comments compensating for unclear code are. *Why*-comments (explaining non-obvious choices, workarounds, regulations) are good.

### Q3. Cure for "Comments" smell?
Extract Method with a self-explanatory name; Rename Method; Introduce Assertion when the comment documents an invariant.

### Q4. What is Duplicate Code?
The same logic in multiple places. Cure: Extract Method; for cross-class duplication, Pull Up Method or Form Template Method.

### Q5. The Rule of Three?
Tolerate duplication twice; refactor at the third occurrence. Premature unification produces wrong abstractions.

### Q6. What is Lazy Class?
A class that does too little to justify its existence. Cure: Inline Class.

### Q7. Lazy Class — when is a small class OK?
Value objects (Email, Money, OrderId), markers in algorithms, strategies in larger patterns. The smell is when the class adds *no* meaning.

### Q8. What is Data Class?
A class with only fields and accessors, no behavior. Cure: Move Method to put logic on the data; Encapsulate Field to enforce invariants.

### Q9. When is Data Class OK?
DTOs (wire types), records (value objects with structural equality), Pydantic models for validation at boundaries. The smell is when business logic naturally belongs on the type but lives elsewhere.

### Q10. What is Dead Code?
Code never executed — methods with no callers, unreachable branches, commented-out blocks. Cure: delete.

### Q11. Why delete commented code instead of leaving it?
Git remembers. Commented code becomes a "tombstone" — easy to misread, easy to accidentally re-enable, accumulates drift.

### Q12. What is Speculative Generality?
Abstractions, parameters, hooks added "just in case" — for variation that hasn't appeared.

### Q13. Cure for Speculative Generality?
Inline Class (when the abstraction has one user); Collapse Hierarchy (when an inheritance tree degenerates to one branch); Remove Parameter (for parameters always passed the same value).

### Q14. YAGNI — what does it mean?
"You Aren't Gonna Need It" — XP principle. Don't add complexity for hypothetical future needs. Cure speculative generality at the design stage.

### Q15. A class with `equals` and `hashCode` only. Lazy Class?
No — it's a value object. Equality + hashing is real semantic work.

---

## Middle (15 questions)

### Q16. Comments smell — diagnose with one question.
"Does the comment explain *what* the code does?" If yes, the code should communicate it (Extract Method, Rename Method). "Does it explain *why*?" Keep the comment.

### Q17. DRY vs WET — what's the trade-off?
DRY (Don't Repeat Yourself): single source of truth for knowledge. WET ("Write Everything Twice"): tolerate duplication. Extreme DRY → wrong abstractions; extreme WET → maintenance pain. Rule of Three balances them.

### Q18. Inline Class — when does it harm?
When the class is a real future expansion point (with multiple expected variants) or encapsulates a non-trivial concept. Inline only when the class adds nothing now.

### Q19. Speculative Generality — what's a quick test?
Has the abstraction *ever* had more than one implementation in production? If no, and there's no concrete pending need, it's speculative.

### Q20. Why is Data Class often paired with Feature Envy?
When the data has no behavior, callers reach in to do work — Feature Envy. Cure both with Move Method.

### Q21. A method has 200 lines of inline comments. Smell?
Likely. The 200 lines are likely Long Method (Bloater) with what-comments compensating. Cure: Extract Method per phase; the method names replace the comments.

### Q22. Static analyzers detect dead code — should I trust them blindly?
No. Reflection (Spring `@Service`, Hibernate, JPA), framework callbacks (Flask routes, JUnit `@Test`), dynamic imports defeat static analysis. Verify before deleting.

### Q23. Sandi Metz: "Duplication is far cheaper than the wrong abstraction." Defend.
A wrong abstraction creates lock-in: future divergence becomes hard. Two duplicates are independent; you can refactor each as needed. Duplication is local; abstraction couples globally. Hence: prefer duplication while uncertainty exists.

### Q24. A team has 1,000 `// TODO` comments. What's the move?
Triage. Categorize: bugs to file, features to backlog, dead notes to delete. Old TODOs (>3 months, no owner) are usually dead — delete.

### Q25. Comments that document *invariants* — is that a smell?
No, but consider Introduce Assertion. An invariant document by comment can drift; an assertion crashes if violated.

### Q26. Why is Speculative Generality so common?
Optimism plus low immediate cost. "Adding an interface 'in case' takes 2 minutes." The compounded cost (cognitive load, bugs from extra dispatch, megamorphic JIT cost) shows up later.

### Q27. Anemic Domain Model — Fowler's claim.
Anemic models (data-only classes + service classes for behavior) lose OO benefits: encapsulation of invariants, polymorphism, locality of behavior. The cure is Move Method onto domain classes.

### Q28. When are records (Java) Data Classes?
Records are value objects, not Data Class smells. They're designed for immutable data with structural equality. They support adding methods.

### Q29. Code generation reduces some Dispensables — which?
Reduces Duplicate Code (mappers generated, not hand-written) and reduces what-comments (the schema is the doc). Doesn't help with Speculative Generality (which is about abstraction shape, not content).

### Q30. A class is final, has only static methods. Lazy Class?
No — it's a namespace / utility container. Java standard library has many: `Collections`, `Arrays`, `Files`. The smell is when a normal-looking class has only one useful method.

---

## Senior (10 questions)

### Q31. Architectural-level "Dispensable" — example?
A microservice with one endpoint that's barely used. A platform-team framework with one consumer. An obsolete service still deployed but not called. Cure: same as code level — delete after confirming no consumers.

### Q32. Strangler Fig for service deletion — steps?
1. Confirm zero traffic via observability.
2. Search code/config/docs for callers.
3. Announce removal; wait grace period.
4. Disable but don't delete (revertible).
5. After grace period, delete code, deploy configs, database.

### Q33. Token-based duplicate detection (PMD CPD) — strengths and weaknesses?
Strengths: language-agnostic, fast. Weaknesses: doesn't recognize semantic equivalence (different syntax, same logic). For semantic dedup, you'd need program-graph analysis (rare in production tools).

### Q34. ProGuard / R8 / native-image — what do they do?
Build-time dead code elimination + minification. Walk the call graph from entry points; everything not reached is removed from the artifact. Used for client-side code (Android apps, serverless) where size matters.

### Q35. Tree-shaking in JS — how does it work?
Bundler analyzes ES module imports; only imports actually used by entry-point code are bundled. Requires static `import` (not `require`); side-effect-free modules can be more aggressively shaken. The result: smaller bundles for browsers.

### Q36. `vulture` for Python — limitations.
Reflection (`getattr`, `__import__`), dynamic dispatch (`hasattr`), framework decorators (Flask, click), and string-based references defeat it. Whitelist false positives.

### Q37. What's "code rot," and how do Dispensables contribute?
Code rot = gradual decay of a codebase's quality. Dispensables (especially commented-out code, dead code, stale comments) add "noise" that obscures live code; refactoring becomes harder; small bugs accumulate. Regular pruning fights rot.

### Q38. Library design and Speculative Generality — different rule?
Yes. Libraries serve unknown future consumers; some flexibility is for those consumers. But even libraries can over-abstract (every JDK release has examples). Apply YAGNI to internal complexity; provide narrow extension points only where evidence justifies.

### Q39. Refactoring rule: "delete on sight"?
Stricter teams enforce it: any commented-out code or unused method discovered during a PR is deleted. This is a process choice — encourages action over deferral. Most teams accept some gradualism.

### Q40. CodeScene / hotspot analysis — refactoring priority?
Combines change frequency, complexity, authorship diversity, recent bug density. Top of list: hot files with high complexity and many authors — biggest ROI for refactoring effort.

---

## Professional (10 questions)

### Q41. JIT dead code elimination — what does it eliminate?
`if (false)` branches, unreachable code after `throw`/`return`, compute-but-don't-use variables, constant-folded conditionals. Aggressive in HotSpot/V8.

### Q42. Public method DCE — limitation?
Public methods are reachable from outside the JVM (via reflection or external callers). JIT can't prove unreachability. Source-level DCE (ProGuard, R8) requires explicit configuration of "what's externally reachable."

### Q43. Speculative interface kept monomorphic — runtime cost?
Zero. Inline cache stays monomorphic; JIT devirtualizes; calls inline. The "speculative" overhead is only in code complexity, not performance.

### Q44. What turns a monomorphic IC megamorphic?
Observing 4+ concrete types (HotSpot threshold) at the call site. Test mocks at production call sites, plugin systems, framework dispatch — all common causes.

### Q45. GraalVM native-image — handles dispensables how?
AOT-compiles only reachable code. Dead code (with no static call path) is excluded from the binary. Reflection-only code requires explicit configuration (`reflect-config.json`) or it's also dropped — leading to runtime errors.

### Q46. Class metadata cost in JVM — measurable?
~1-2KB per loaded class in metaspace. 5,000 classes = 10MB; 50,000 = 100MB+. Class loading adds startup latency. Modern frameworks (Quarkus, native-image) reduce class count via build-time analysis.

### Q47. Pydantic v2 vs v1 — relevance to Data Class?
Pydantic v2's Rust core makes value-object validation 5-50× faster. Critical when "data class with validation" is on a hot path (API request parsing).

### Q48. Compile-time vs runtime DCE — different optimizations?
Compile-time (ProGuard, R8, tree-shaking): removes from the artifact. Runtime (JIT DCE): the JIT generates compiled code without the dead branches; bytecode still contains them. Different stages, different concerns.

### Q49. False sharing in Data Classes — when?
Two threads writing different fields of the same instance, with the fields in the same cache line. Common in multi-threaded counters / state on shared objects. Cure: padding (`@Contended`) or split into separate objects.

### Q50. Why does removing dead code sometimes *slow* startup?
Class loading / DCE happens at startup. Removing some code may shift work earlier (eager init replaces lazy). Most cases: removing dead code speeds startup. The exception: if dead code prevented other classes from loading via dependency tracking, you may inadvertently load more.

---

## Cheat sheet

| Smell | Telltale | Cure |
|---|---|---|
| Comments | Comment explains *what* | [Extract Method](../../02-refactoring-techniques/01-composing-methods/junior.md), [Rename Method](../../02-refactoring-techniques/05-simplifying-method-calls/junior.md) |
| Duplicate Code | Same logic in N places | [Extract Method](../../02-refactoring-techniques/01-composing-methods/junior.md), [Pull Up Method](../../02-refactoring-techniques/06-dealing-with-generalization/junior.md) |
| Lazy Class | Class with one method, used once | [Inline Class](../../02-refactoring-techniques/02-moving-features/junior.md) |
| Data Class | Class with only getters/setters | [Move Method](../../02-refactoring-techniques/02-moving-features/junior.md), [Encapsulate Field](../../02-refactoring-techniques/03-organizing-data/junior.md) |
| Dead Code | Unreachable code | Delete |
| Speculative Generality | Abstraction with one user | [Inline Class](../../02-refactoring-techniques/02-moving-features/junior.md), [Collapse Hierarchy](../../02-refactoring-techniques/06-dealing-with-generalization/junior.md), [Remove Parameter](../../02-refactoring-techniques/05-simplifying-method-calls/junior.md) |

> **YAGNI + Rule of Three** — the two principles that prevent most Dispensables before they appear.
