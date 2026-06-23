# Composing Methods — Interview Q&A

> 50+ questions you can be asked about Composing Methods refactorings, ranging from "what does Extract Method do?" to "explain JIT inlining and why it makes Replace Temp with Query free."

---

## Conceptual (Q1–Q10)

**Q1. What does the "Composing Methods" category cover?**
A. Refactorings that **reorganize the inside of methods** — split, merge, rename, or replace fragments. They don't move code between classes (that's Moving Features) and don't change inheritance (that's Dealing with Generalization).

**Q2. What does Extract Method do?**
A. Takes a fragment of code that does one thing, gives it a name, replaces the fragment with a call. The cure for [Long Method](../../01-code-smells/01-bloaters/junior.md) and [Duplicate Code](../../01-code-smells/04-dispensables/junior.md).

**Q3. What's the inverse of Extract Method?**
A. Inline Method. Replace every call with the body and delete the method.

**Q4. When is Inline Method dangerous?**
A. When the method is polymorphic (overridden in subclasses), public API (external callers), recursive, or has side effects whose ordering matters.

**Q5. What does Extract Variable do?**
A. Names a complex sub-expression. Lets you replace 5 lines of comments with one well-named local.

**Q6. What's the difference between Extract Variable and Replace Temp with Query?**
A. Extract Variable creates a local within the same method. Replace Temp with Query promotes the expression to a method on the class — useable from other methods too.

**Q7. What's the danger of Replace Temp with Query?**
A. If the expression is expensive (DB call, sort, allocation), calling it 3 times instead of caching once is a perf disaster. Stick to pure expressions.

**Q8. When does Split Temporary Variable apply?**
A. When a single local is reassigned for two unrelated purposes — first holds perimeter, then holds area. Two roles → two named locals.

**Q9. What does "Method Object" mean?**
A. A class whose only job is to host one execution of a long method. Each local becomes a field; the body becomes `compute()`. Single-use.

**Q10. What's Substitute Algorithm?**
A. Replace the entire body of a method with a clearer (or sometimes faster) algorithm — same observable behavior. The riskiest refactoring in this category because it's not mechanical.

---

## When to / when not to (Q11–Q20)

**Q11. When would you NOT extract a method?**
A. When the fragment can't be named in 1–4 words; when it would need 5+ parameters; when it mixes abstraction levels; when extraction is premature (no rule of three yet).

**Q12. Why is the canonical refactoring order Remove Param Assignments → Split Temp → Replace Temp with Query → Extract Method?**
A. Each step "tames" something that would otherwise force the next step to take ugly parameters. By the time you Extract, locals and parameters are clean.

**Q13. When is Inline Temp the right move?**
A. When a temp is assigned once from a simple expression and used once. The temp adds noise without benefit.

**Q14. When does Extract Method become Extract Class instead?**
A. When the extracted method ends up on `OrderService` but its parameters and reads only touch `Customer` — it belongs to `Customer`. Apply [Move Method](../02-moving-features/junior.md) afterward.

**Q15. Why is mutating a parameter inside a method considered a smell?**
A. The parameter now plays two roles: input from caller and running state. Reading the method, you can't recover the original argument.

**Q16. When is `Replace Method with Method Object` overkill?**
A. When the method is short enough that Extract Method works. Method Object is for the 200+ line behemoth where extraction would need too many parameters.

**Q17. Why is Substitute Algorithm risky?**
A. It changes the implementation, not just the structure. Edge cases, floating-point determinism, and undocumented behavior in the old algorithm can all bite.

**Q18. What test is the bare minimum before Substitute Algorithm?**
A. A characterization test that captures current behavior (warts and all) — typically via approval testing on representative inputs.

**Q19. Should you Extract Method on a 5-line one-job method?**
A. No. That's premature decomposition. Each extra method-call boundary adds reading cost.

**Q20. When does Extract Variable beat a comment?**
A. Almost always. A comment can rot when someone changes the expression; a named variable is enforced by the compiler/IDE.

---

## Code-smell mapping (Q21–Q30)

**Q21. Which Composing Methods technique cures Long Method?**
A. Extract Method (primary), supported by Replace Temp with Query, Extract Variable, Replace Method with Method Object, Substitute Algorithm.

**Q22. Which technique cures Duplicate Code?**
A. Extract Method (one source) — pull the duplicate into a single helper. For broader cases, see Pull Up Method or Form Template Method in [Generalization](../06-dealing-with-generalization/junior.md).

**Q23. Which technique cures the Comments smell?**
A. Extract Method or Extract Variable — replace the comment with a name.

**Q24. Which Composing Methods technique cures Lazy Class?**
A. Inline Method (or [Inline Class](../02-moving-features/junior.md) at class level).

**Q25. What if a method's parameter list is too long?**
A. Not in this category — see [Simplifying Method Calls](../05-simplifying-method-calls/junior.md): Introduce Parameter Object, Preserve Whole Object, Replace Parameter with Method Call.

**Q26. What's the relationship between Long Method and Method Object?**
A. Method Object is the "last resort" cure for Long Method when Extract Method alone can't disentangle the locals.

**Q27. What's the relationship between Composing Methods and the Comments smell?**
A. Most "explanatory" comments become unnecessary after Extract Method/Variable — the name is the comment.

**Q28. How does Extract Method help with [Feature Envy](../../01-code-smells/05-couplers/junior.md)?**
A. Extract first to isolate the envious fragment, then [Move Method](../02-moving-features/junior.md) it to the class it envies. Two refactorings, one for clarity, one for placement.

**Q29. Which technique helps with Speculative Generality?**
A. Inline Method — if the wrapper exists "just in case" and adds no value, delete it.

**Q30. Which smell is Substitute Algorithm best for?**
A. Long Method *with* unclear correctness — and Duplicate Code where two implementations diverged accidentally. Pick the better one and Substitute.

---

## Tooling & process (Q31–Q40)

**Q31. What IDE shortcut do you use most for Extract Method in IntelliJ?**
A. ⌘⌥M on Mac (Ctrl+Alt+M on Linux/Win).

**Q32. How do you Inline a method in IntelliJ?**
A. Caret on the method name → ⌘⌥N (Ctrl+Alt+N).

**Q33. What's the "3-minute commit rhythm"?**
A. One refactoring → run tests → commit. Aim for sub-3-minute cycles. After 8 hours you have 50 small reversible commits.

**Q34. What is the Mikado Method?**
A. When a refactoring blocks on a dependency, revert; address the blocker first. Builds a graph of dependencies, leaves are doable today.

**Q35. What's a characterization test?**
A. A test that captures current behavior of legacy code (without judging whether the behavior is correct), enabling refactoring without behavior drift.

**Q36. When would you use OpenRewrite?**
A. To run the same refactoring across many repos / projects automatically. Common for framework migrations (e.g., Spring 5 → 6).

**Q37. What's Strangler Fig?**
A. Wrap legacy with a new interface; route some calls new, some legacy; gradually migrate; eventually delete legacy.

**Q38. Why separate refactoring PRs from feature PRs?**
A. Reviewers can't see the logic change buried in 80 mechanical commits. Separation of concerns at the PR level.

**Q39. What's the cost of refactoring debt?**
A. Onboarding cost, bug rate (roughly quadratic in method length), review time, architectural opacity.

**Q40. How do you avoid "refactoring theatre"?**
A. Measure the smell first (length, complexity, hotspot data); refactor with a goal; commit small; integrate frequently. Don't rename the same thing 4 times in a quarter.

---

## Performance & internals (Q41–Q55)

**Q41. Does Extract Method add overhead?**
A. In bytecode, yes — one extra invocation. After JIT, no — small methods are inlined. Practically free in steady state.

**Q42. What's HotSpot's `MaxInlineSize`?**
A. ~35 bytecode bytes (default). Methods up to that size are inlined unconditionally.

**Q43. What's `FreqInlineSize`?**
A. ~325 bytes (default). Hot methods up to that size are inlined.

**Q44. How do you check whether your method is being inlined?**
A. `-XX:+UnlockDiagnosticVMOptions -XX:+PrintInlining` on the JVM. You'll see `(hot)` / `inline` / `too big` annotations.

**Q45. What is escape analysis?**
A. JIT analysis that determines whether an allocated object can be proven not to "escape" its caller; if so, it can be stack-allocated or scalar-replaced.

**Q46. How does escape analysis help Method Object?**
A. The `new Gamma(...).compute()` pattern — Gamma never escapes. EA + scalar replacement removes the allocation entirely.

**Q47. When does escape analysis fail?**
A. Object stored in a field, returned, passed to non-inlined methods, synchronized on, or accessed via reflection.

**Q48. What's a "monomorphic call site"?**
A. A virtual call that has only ever seen one receiver type. JIT inlines aggressively — practically as fast as a direct call.

**Q49. What's a "megamorphic call site"?**
A. A virtual call that has seen 4+ types. JIT punts to a vtable lookup. ~5–10× slower than monomorphic.

**Q50. How does Go's PGO interact with these refactorings?**
A. Profile-Guided Optimization (Go 1.21+) lets the compiler inline aggressively at hot sites — recovering perf you'd otherwise lose to interface dispatch.

**Q51. Does CPython have an inliner?**
A. No. Method calls cost ~100–500ns of pure overhead. PyPy / Cython / Numba bridge the gap for hot code.

**Q52. When does Replace Temp with Query become a real cost?**
A. When the expression has observable cost (I/O, allocation, sort) — not when it's pure arithmetic.

**Q53. Why might Inline Method improve performance?**
A. Flattens dispatch chains; helps the JIT devirtualize; removes a deopt risk if the call site is monomorphic; reduces inline-depth budget consumption.

**Q54. What does `-XX:MaxInlineLevel` control?**
A. Maximum recursive inline depth (default 15). Deep call chains hit this and stop being inlined.

**Q55. Why are micro-benchmarks of Substitute Algorithm misleading?**
A. They miss warmup, dead code elimination, inlining decisions, GC pressure, and branch prediction effects. JMH (Java) or `pprof` (Go) is required.

---

## Bonus (Q56–Q60)

**Q56. What does Fowler call "the most important refactoring"?**
A. Extract Method.

**Q57. Why does naming matter so much in this category?**
A. Because the whole point of these refactorings is that **names are documentation**. A bad extracted method name is worse than a 50-line method.

**Q58. What's the relation between Composing Methods and the Method Object pattern?**
A. Method Object is one specific Composing Methods technique (Replace Method with Method Object) — the others stop at the method level; this one promotes a method to a class.

**Q59. Where does Composing Methods stop and Moving Features begin?**
A. Composing Methods stays inside one class. The moment you move a method to a different class, you're in [Moving Features](../02-moving-features/junior.md).

**Q60. Which Composing Methods refactorings are mechanical (IDE-doable)?**
A. All except Substitute Algorithm. The IDE can Extract, Inline, Rename, Split safely. Substituting an algorithm is by definition new code.

---

## Next

- Practice: [tasks.md](tasks.md), [find-bug.md](find-bug.md), [optimize.md](optimize.md)
- Theory recap: [junior.md](junior.md) → [middle.md](middle.md) → [senior.md](senior.md) → [professional.md](professional.md)
