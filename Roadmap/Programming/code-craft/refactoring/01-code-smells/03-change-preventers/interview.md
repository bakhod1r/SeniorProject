# Change Preventers — Interview Q&A

> 50 questions across all skill levels.

---

## Junior (15 questions)

### Q1. Name the three Change Preventers.
Divergent Change, Shotgun Surgery, Parallel Inheritance Hierarchies.

### Q2. What is Divergent Change?
A class is changed for many different reasons — multiple responsibilities mixed in one place. SRP violation.

### Q3. What is Shotgun Surgery?
A single logical change requires editing many classes. The "scatter" of one concept across the codebase.

### Q4. How are Divergent Change and Shotgun Surgery opposites?
Divergent Change: one class, many reasons. Shotgun Surgery: one reason, many classes. The cures are opposite — split vs merge.

### Q5. Cure for Divergent Change?
Extract Class — split along responsibility boundaries.

### Q6. Cure for Shotgun Surgery?
Move Method (gather scattered behavior to one place) or Inline Class (merge classes whose existence created the scatter).

### Q7. What is Parallel Inheritance Hierarchies?
Adding a subclass in tree A forces a corresponding subclass in tree B. The two hierarchies grow in parallel.

### Q8. Cure for Parallel Inheritance?
Move Method — fold the second hierarchy's methods onto the first. Result: one tree.

### Q9. SRP and Divergent Change — relationship?
Divergent Change is the practical manifestation of SRP violation. SRP says "one reason to change"; Divergent Change is "many reasons to change."

### Q10. A method in `OrderService` is renamed and we have to update 12 call sites — Shotgun Surgery?
No, that's just a normal rename. Shotgun Surgery is when *one logical change* (e.g., adding a field) cascades — not when renaming references.

### Q11. Logging in every method seems like Shotgun Surgery — true?
Logging is a *cross-cutting concern*, not Shotgun Surgery. The cure isn't extraction; it's AOP / middleware / decorators.

### Q12. Two parallel hierarchies, each with 10 classes. Smell?
Likely. Cure: Move Method to fold the operations onto the data hierarchy. Then: 10 classes, not 20.

### Q13. When is a parallel hierarchy NOT a smell?
When the two hierarchies represent genuinely independent axes (e.g., Vehicle × Region for region-specific pricing). Use Bridge pattern instead of Move.

### Q14. Adding a field requires editing 6 files. Always Shotgun Surgery?
Often, but not always. If the 6 files are different layers (domain, DTO, entity, schema, ...) and represent a consistent boundary architecture, the scatter may be necessary. Cure with code generation, not refactoring.

### Q15. How do you tell Divergent Change from "this class has lots of methods"?
Look at git history. Many unrelated commits (different topics, different authors) → Divergent Change. Many commits all about the same topic → just a hot file, possibly OK.

---

## Middle (15 questions)

### Q16. How do you diagnose Divergent Change?
`git log` per file: read commit messages for diversity. Tools: `code-maat`, `git-of-theseus`, `CodeScene` for hotspot analysis. If commits cover unrelated topics, it's Divergent Change.

### Q17. How do you diagnose Shotgun Surgery?
Co-change analysis: which files change together in commits? Pairs that always co-change are candidates. Tools: `code-maat coupling`.

### Q18. Why is "co-change" a useful refactoring signal?
Files that always change together either contain duplicated structure (cure: consolidate) or represent legitimately related concepts that should be in fewer files (cure: merge or generate).

### Q19. Code generation as a cure for Shotgun Surgery?
Yes — define one source of truth (proto, OpenAPI, GraphQL schema), generate the layers (DTO, entity, validator, types). Adding a field touches the source; the layers regenerate.

### Q20. AOP for cross-cutting concerns — examples?
Logging, security (auth checks), transactions, retries, audit, metrics, caching. Spring AOP, AspectJ, Python decorators, JS middleware all serve this.

### Q21. Why is "service per use case" better than "service per entity"?
Service per use case localizes change. `PlaceOrderService` changes when placing-order rules change. `OrderService` changes for *all* order-related changes — Divergent Change. Use cases align with reasons-to-change.

### Q22. A team uses a single canonical `Customer` model across 5 microservices. Risk?
Distributed Shotgun Surgery. A schema change requires coordinated deployment. Cure: per-context Customer types + ACLs to translate.

### Q23. DDD Bounded Context — how does it relate to Change Preventers?
Bounded Context limits one model to one context. Multiple contexts → multiple models. Prevents the Divergent Change of "one canonical Customer." ACLs handle inter-context translation.

### Q24. Cross-cutting concern vs Shotgun Surgery — distinguish.
- **Cross-cutting concern**: behavior naturally crosses many functions (logging, security). Cure: AOP / middleware.
- **Shotgun Surgery**: a *concept* is duplicated, not a *cross-cutting behavior*. Cure: consolidate.

The diagnostic: would a thoughtful designer have intentionally placed this in many places? If yes, cross-cutting. If no, Shotgun Surgery.

### Q25. Conway's Law — how does it relate?
Service boundaries should match team boundaries. If two teams own one service, conflicts (Divergent Change at code level, distributed-monolith at architectural level) are inevitable.

### Q26. What's the "distributed monolith" anti-pattern?
Microservices that look independent but always deploy together for any feature. The Shotgun Surgery has been pushed across the network — making it slower and harder to refactor.

### Q27. Strangler Fig vs Branch by Abstraction — when to use which?
Strangler Fig: gradual replacement at use-site level, time scale months. Branch by Abstraction: side-by-side implementations, time scale weeks. Use Strangler Fig for service-level migrations; Branch by Abstraction for class-level.

### Q28. ACL (Anti-Corruption Layer) — what is it?
A boundary class/service that translates between two domain models (e.g., between two bounded contexts). Keeps each side's model clean.

### Q29. A microservice has 30 endpoints and 5 entities. Smell?
Probably. 30 endpoints per service is a lot. Likely Divergent Change at service scale. Cure: split into use-case-focused services.

### Q30. When is a god class actually OK?
When it's a documented boundary (e.g., a public API facade), where the multi-responsibility is its job. Internal classes that incidentally bloat are the smell.

---

## Senior (10 questions)

### Q31. Hotspot analysis — what does it produce?
A ranked list of files combining change frequency × complexity. Top 5% files are usually where bugs cluster and where refactoring pays the highest ROI.

### Q32. Schema-first design — pros and cons.
Pros: single source of truth, multi-language code generation, no schema drift, types stay in sync. Cons: build-time complexity, learning curve, generated code can be opaque.

### Q33. AspectJ vs Spring AOP — performance and capability differences.
AspectJ: compile-time weaving, near-zero overhead, intercepts all code (including `this`-calls, final methods). Spring AOP: runtime proxies, ~50-100ns per call, intercepts Spring beans only.

### Q34. CQRS as a Change Preventer cure?
CQRS (Command Query Responsibility Segregation) splits read and write models. Each model evolves for its own reasons — limits Divergent Change. The cost: two models, eventual consistency.

### Q35. Code-as-data — relate to Shotgun Surgery.
Defining behavior as data (config, schema) rather than spread across code reduces Shotgun Surgery. Adding a tax rate = config change, not a code change.

### Q36. Open/Closed Principle and refactoring — tension?
OCP says "closed for modification." Refactoring modifies the structure. They're orthogonal: OCP is about extension behavior; refactoring is about structural change while preserving behavior.

### Q37. Migrating away from a god service — concrete steps.
1. Map responsibilities (read git history; identify clusters).
2. Extract one cluster into its own class/service (Strangler Fig or Branch by Abstraction).
3. Migrate callers gradually.
4. Repeat until the god service is empty.

### Q38. ArchUnit fitness function for Divergent Change?
```java
classes().that().resideInAPackage("..service..")
         .should().haveLessThanOrEqualTo(15).publicMethods();
```
Limits public surface area per service. Crude but useful guardrail.

### Q39. Why does Conway's Law imply microservices = team boundaries?
Architecture mirrors communication structure. If two teams must coordinate every release, they're effectively one team — and merging the services reduces overhead. If teams are autonomous, services should be too.

### Q40. Eventual consistency as a Change Preventer cure?
By making services eventually consistent (via events), you can deploy them independently. Strict consistency forces synchronous coordination → distributed monolith. Eventual consistency loosens coupling but introduces eventual-consistency complexity.

---

## Professional (10 questions)

### Q41. Spring AOP proxy mechanism — JDK vs CGLIB.
JDK dynamic proxy: requires interface, ~10ns dispatch. CGLIB: subclass via bytecode generation, works on any class, ~20ns dispatch, can't proxy `final`.

### Q42. AspectJ load-time weaving (LTW) vs compile-time weaving (CTW).
LTW: aspects woven when the JVM loads classes; requires `-javaagent`. CTW: aspects woven at compile; produces final bytecode. CTW is faster at runtime; LTW is more flexible (can weave dependencies).

### Q43. MapStruct's annotation processor — how does it work?
At compile time: reads `@Mapper`-annotated interfaces, infers field-by-name mappings, generates `*MapperImpl.java` files. Output is plain Java, no runtime overhead.

### Q44. Pydantic v2's Rust core — performance impact.
~5-50× faster than v1's pure-Python validators. Critical for high-throughput services where validation was the bottleneck.

### Q45. Protobuf vs JSON serialization performance.
Protobuf: ~5× faster, ~50% smaller payload, type-safe. Requires schema and codegen. JSON: zero-config, schema-flexible, slower. Use Protobuf for internal hot paths; JSON for public APIs.

### Q46. Why is "code generation" sometimes worse than reflection?
Generated code lives in `target/generated-sources/`, which can confuse engineers and IDE tooling. If the generator is buggy or out-of-date, debugging is hard. Reflection is "magical" but visible (`Class.getDeclaredFields()` is documented).

### Q47. Spring proxy interception of internal calls — workaround?
`self`-injection: inject the proxy bean as a field, call via `self.method()` instead of `this.method()`. Or use AspectJ (no proxies; aspects woven directly).

### Q48. Lombok's mechanism — why is it special?
Lombok modifies the AST during annotation processing using internal `javac` APIs (not just generating new files). This means Lombok-annotated classes have generated methods at compile time, but no separate generated file.

### Q49. Annotation processor performance — what slows it down?
Multiple processors processing the same source repeatedly (no incremental support). Solution: enable incremental annotation processing where the tool supports it (Gradle has flags; Maven needs care).

### Q50. How does CodeScene rank refactoring priority?
Combines change frequency, complexity (cyclomatic / cognitive), authorship diversity, and bug density. Top of the list: files with high change frequency, high complexity, many authors, recent bugs. Refactor those first.

---

## Cheat sheet

| Smell | Telltale | Primary cure |
|---|---|---|
| Divergent Change | One class touched in PRs about many topics | [Extract Class](../../02-refactoring-techniques/02-moving-features/junior.md) |
| Shotgun Surgery | One logical change → many file edits | [Move Method](../../02-refactoring-techniques/02-moving-features/junior.md), [Inline Class](../../02-refactoring-techniques/02-moving-features/junior.md), code generation |
| Parallel Inheritance | Adding to tree A forces adding to tree B | [Move Method](../../02-refactoring-techniques/02-moving-features/junior.md) (or Bridge pattern when 2 axes are real) |

> **Diagnose with `git log`**, not aesthetics. The smells are about change patterns; the diagnostic is change history.
