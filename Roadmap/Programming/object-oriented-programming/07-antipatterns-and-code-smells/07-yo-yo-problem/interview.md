# Yo-Yo Problem — Interview Q&A

Twenty questions covering definition, detection, metrics, and refactoring. Use the answers as model responses — concise, technical, and grounded in measurable practice.

---

**Q1. What is the Yo-Yo Problem?**

A code-comprehension antipattern in which understanding a single method requires the reader to scroll up and down a deep inheritance chain, because behavior is split across many classes. Named because the reader's attention bounces like a yo-yo.

---

**Q2. Which metric best quantifies it?**

DIT — Depth of Inheritance Tree, from the Chidamber-Kemerer metric suite (1994). It measures the longest path from a class to the root of the inheritance tree. DIT > 3 in project code is a strong yo-yo signal.

---

**Q3. What is the Chidamber-Kemerer threshold for DIT?**

The original paper proposed DIT ≤ 6 as a loose upper bound. Modern empirical practice (and SonarQube's default rule java:S110) commonly tightens this to ≤ 5. For new project code I would set the bar at 3, and enforce it with ArchUnit.

---

**Q4. What is NOC and how does it relate?**

Number Of Children — the count of immediate subclasses. NOC measures fan-out at a single level. High NOC on a deep class compounds the yo-yo because every subclass author must understand the shared base and every base-class change must be validated against all NOC variants. I cap NOC at 5 for project code.

---

**Q5. How do you detect a yo-yo in IntelliJ?**

Two tools: Type Hierarchy (Ctrl+H) to see ancestor and descendant depth visually, and Method Hierarchy (Ctrl+Shift+H) to see every override of a method across the chain. If Method Hierarchy shows a method overridden at 3+ levels with `super` calls in the middle, that is a confirmed yo-yo.

---

**Q6. What is the relationship between the Yo-Yo Problem and the Fragile Base Class Problem?**

They are two symptoms of the same dysfunction. Yo-Yo is the read-time pain (hard to understand behavior); Fragile Base Class is the change-time pain (hard to modify the parent without breaking children). Deep hierarchies cause both. The fix — composition — addresses both simultaneously.

---

**Q7. How is Template Method related to yo-yo?**

Template Method is correct at depth 1 with a small number of well-named hooks. It becomes a yo-yo when subclasses themselves become templates, when hooks call other hooks, or when the skeleton itself is overridden in leaves. Most real-world yo-yos started as well-intentioned Template Method designs.

---

**Q8. What is the refactoring sequence to fix a yo-yo?**

Three steps in order:
1. Inline trivial overrides (empty or super-only) — often reduces DIT by 1 immediately.
2. Flatten via composition — extract leaf-specific behavior into strategy objects.
3. Replace Template Method with Strategy — make the skeleton itself a function parameter.

Doing them out of order tends to leave dead code or break tests.

---

**Q9. Why is calling an overridable method from a constructor a yo-yo bug?**

During `new Child()`, the JVM runs `Parent` constructor first, which calls the virtual method, which dispatches down to `Child`'s override — but `Child`'s fields are not yet initialized. The "yo-yo down" happens before the subclass is ready. Mark such methods `final` or `private`, or eliminate the inheritance.

---

**Q10. How does the JIT compiler treat deep hierarchies?**

HotSpot devirtualizes monomorphic call sites regardless of depth. The cost appears when a call site becomes megamorphic (3+ receiver types), at which point depth contributes to vtable lookup, larger vtables hurt cache locality, and inlining limits (MaxInlineLevel = 15) get consumed by chain plumbing. Sealed types help newer JITs devirtualize more aggressively.

---

**Q11. Give an example of an ArchUnit rule that detects yo-yo.**

```java
@ArchTest
static final ArchRule depth_of_inheritance_is_bounded =
    classes()
        .that().resideInAPackage("com.acme.app..")
        .and().areNotInterfaces()
        .should(haveDepthOfInheritanceLessThan(4));
```

The custom condition walks `getRawSuperclass()` until Object, counts levels, and fails if the count exceeds the bound.

---

**Q12. What SonarQube rule maps directly to yo-yo?**

`java:S110` — "Inheritance tree of classes should not be too deep." Default threshold is 5, recommended setting is 3. Also `java:S1185` — overrides that only delegate to super — which catches the trivial-override case.

---

**Q13. Is inheritance always bad?**

No. Inheritance is correct when it models a real *is-a* type relationship (the LSP-satisfying kind), when the hierarchy is shallow (DIT ≤ 2), and ideally when the base is `sealed`. It is wrong when it is used purely to share code — that is what composition is for.

---

**Q14. What is the `sealed` keyword and how does it help?**

Java 17 introduced `sealed` classes — abstract classes that explicitly enumerate their permitted subtypes via a `permits` clause. This bounds NOC, enables exhaustive pattern matching, and tells the JIT the closed set of receivers. It does not eliminate the yo-yo but makes the chain bounded and analyzable.

---

**Q15. How would you migrate a deep legacy hierarchy without breaking anything?**

A quarter-long playbook:
1. Measure DIT for every class.
2. Inline trivial overrides via IntelliJ.
3. Carve out leaf-specific behavior into composition seams.
4. Promote leaves to extend Object directly, injecting previously-inherited services.
5. Seal what remains.

Tighten the ArchUnit threshold step by step (8 → 6 → 4 → 3) as the work proceeds.

---

**Q16. What is the cost of overriding `equals` and `hashCode` in a deep hierarchy?**

Easy to violate the equals/hashCode contract because each level may compare different fields, and unless `hashCode` is updated in lockstep at every level, HashMap and HashSet break silently. The safe approach for entities is to use only the identifier in both, regardless of inheritance depth. Lombok's `@EqualsAndHashCode(onlyExplicitlyIncluded = true)` makes this auditable.

---

**Q17. Why is the JPA `@MappedSuperclass` chain a yo-yo risk?**

`@MappedSuperclass` couples the Java hierarchy to the database schema. Lifecycle callbacks (`@PrePersist`, `@PreUpdate`) are invoked across the chain in implementation-defined order. Multiple levels of timestamping or auditing produce timing bugs (Scenario 8 in find-bug.md). Cap entity inheritance at one level of `@MappedSuperclass` and prefer `@Embeddable` for cross-cutting concerns.

---

**Q18. What is the difference between Yo-Yo and Spaghetti Inheritance?**

Yo-Yo is specifically about the vertical scrolling required to understand a single method across an inheritance chain. Spaghetti Inheritance is the broader phenomenon of multiple inheritance-like chains intersecting via interfaces and default methods, producing a graph rather than a tree. Yo-Yo is one symptom of a spaghetti structure, but you can have a yo-yo in a clean tree.

---

**Q19. When would performance be a valid reason to flatten a hierarchy?**

When a profiler shows the method is hot, JMH confirms call cost is significant relative to body work, and JIT logs show megamorphism or inlining failures. Without all three pieces of evidence, do not flatten for performance — flatten for comprehension instead, which is always justified.

---

**Q20. How do you write a code review comment about a yo-yo without sounding pedantic?**

Make it concrete and actionable. Bad: "this is a yo-yo, refactor it." Good: "This method's behavior is distributed across `Parent.x`, `Middle.x` (calls super), and `Child.x` (calls super). DIT here is 4. Could we inline `Middle.x` since it only delegates? That would reduce the chain to 2 and make this PR's logic readable in one file." Cite the metric, name the next concrete step, keep the scope of the comment small.

---

**Memorize this:** The Yo-Yo Problem is measured by DIT, detected by IntelliJ's Method Hierarchy, enforced against by ArchUnit and SonarQube java:S110, and fixed by inlining, composition, and sealed types. Cap DIT at 3, NOC at 5, and never call overridable methods from constructors. The interview answer that wins is the one that names the metric, the tool, and the next concrete refactoring step in the same breath.
