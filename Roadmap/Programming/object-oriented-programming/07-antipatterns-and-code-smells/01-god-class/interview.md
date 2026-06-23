# God Class — Interview Q&A

Twenty questions, ordered roughly from junior screen to senior architectural discussion.

---

**Q1: What is a God Class?**

A: A class that has taken on too many responsibilities — typically large in LOC, in number of methods, and in dependencies. It centralizes logic that should be distributed across several focused classes. It violates the Single Responsibility Principle and tends to grow without bound because every new feature is easier to bolt on than to factor out.

---

**Q2: How do you decide a class has become a God Class? Give concrete numbers.**

A: I use two-of-N thresholds: LOC > 200, public methods > 7, total methods > 20, fields > 12, WMC > 20, RFC > 50, CBO > 15, LCOM4 > 1. Trip two and it is time to refactor; trip three and it blocks merge. The exact numbers come from Lanza & Marinescu and from PMD/SonarQube defaults.

---

**Q3: What is LCOM and what does a high value mean?**

A: Lack of Cohesion of Methods. LCOM4 counts the number of connected components in a graph where methods are nodes and an edge exists between two methods if they share a field. LCOM4 = 1 means cohesive (one component); LCOM4 = 3 means the class is really three classes sharing a file. A high LCOM is a textbook signal that the class should be split along its field-sharing boundaries.

---

**Q4: What is WMC?**

A: Weighted Methods per Class — the sum of cyclomatic complexity over all methods in the class. A class with 10 methods of complexity 2 has WMC = 20. WMC captures both size and per-method complexity, so it catches God Classes that are not lengthy in line count but pack many branchy methods.

---

**Q5: What is CBO and why does it matter for God Classes?**

A: Coupling Between Objects — the count of distinct types a class depends on (excluding language primitives). God Classes accumulate collaborators, so CBO climbs. High CBO predicts ripple effects: changes elsewhere force changes here. It is also a good proxy for test difficulty — high CBO means lots of mocks.

---

**Q6: How would you refactor a God Class in production safely?**

A: Strangler Fig at class scale. Identify clusters of fields and methods that belong together; create new focused classes; turn the original class into a thin `@Deprecated` facade that delegates; migrate callers gradually; delete the facade. Tests stay green at every step; the deploy is incremental, not a big-bang rewrite.

---

**Q7: When should you *not* split a God Class?**

A: When the class is generated (parser output, gRPC stubs), when it is a pure DTO carrying no behavior, when it represents a third-party protocol message, or when it is configuration bound by a framework. Also, if a refactor would destabilize a release and the class is not on the change path, defer — but record the debt.

---

**Q8: Which static analysis tools detect God Classes?**

A: PMD (rules `GodClass`, `ExcessiveClassLength`, `TooManyMethods`, `CouplingBetweenObjects`), SonarQube (metrics `class_complexity`, `ncloc_per_class`, etc.), Checkstyle (`ClassDataAbstractionCoupling`, `JavaNCSS`, `MethodCount`), and IntelliJ inspections. ArchUnit complements these by enforcing custom thresholds in tests.

---

**Q9: How do ArchUnit rules differ from PMD or Sonar?**

A: ArchUnit rules are tests written in Java that run on the build server. They enforce *project-specific* rules (e.g., "no domain class depends on infrastructure", "no class has more than 7 public methods in package `..domain..`") that PMD's generic rules cannot. They run as part of `mvn test`, so violations fail the build like any other test.

---

**Q10: How does a God Class relate to SOLID?**

A: It violates Single Responsibility (many reasons to change), Open/Closed (modifying it for new behavior), Interface Segregation (clients depend on methods they do not use), and often Dependency Inversion (it depends directly on concrete infrastructure). Liskov is the only principle it does not necessarily break — though if it sits in an inheritance hierarchy, it usually breaks that too.

---

**Q11: What is the typical refactoring sequence?**

A: 1) Add characterization tests so behavior is locked in; 2) inventory methods and fields, grouping them by which fields they touch; 3) extract each group into a new class; 4) turn the old class into a delegating facade; 5) migrate callers in small commits; 6) delete the facade; 7) add ArchUnit/PMD rules so the next God Class fails the build.

---

**Q12: God Class vs Long Method — which to fix first?**

A: Long Method usually first. Extracting methods often reveals which groups belong together, which then guides the class split. Going straight to a class extraction without first shrinking methods can produce two God Classes from one.

---

**Q13: Can microservice boundaries prevent God Classes?**

A: They help but do not cure. Splitting a monolith into services along bounded contexts forces a natural shrinkage of any single service's scope. However, a microservice can still grow its own God Class internally if discipline lapses. The same metrics and gates apply at the service level.

---

**Q14: What is an Anti-Corruption Layer and how does it relate?**

A: An Anti-Corruption Layer is a translation boundary between bounded contexts that prevents one context's model from polluting another. It matters here because God Classes often form when a team takes on translation work inline — accumulating mapping code, validation code, and adapter logic into one growing class. Putting an ACL in its own module keeps the rest of the code small.

---

**Q15: How does Conway's Law apply?**

A: Conway said systems mirror the communication structures of their builders. God Classes often live at organizational seams — code "owned by everyone" or "owned by no one." The fix is partly social: assign clear ownership, then split the code along the seams the team boundaries already imply. The Inverse Conway Maneuver — restructure teams to get the architecture — is more durable than another refactor sprint.

---

**Q16: What metrics would you put in a quality gate to catch new God Classes?**

A: For new code on a PR: `ncloc_per_class ≤ 200`, `complexity_per_class ≤ 40`, `complexity_per_function ≤ 10`, `public_api_method_count ≤ 7`, `lcom4 = 1`. I would not enforce these retroactively on the existing baseline — apply only to *new* code to avoid blocking unrelated work.

---

**Q17: How does a God Class affect JVM performance?**

A: Several ways. Large methods exceed `FreqInlineSize` (325 B) and stop being inlined. The code cache fills faster. Interface dispatch into a God Class that implements many interfaces becomes megamorphic. Big instances span multiple cache lines and inflate GC promotion. Escape analysis fails on large transient instances. Splitting often yields a measurable speedup with no algorithmic change.

---

**Q18: How do you keep a refactor from regressing behavior?**

A: Characterization tests around the old behavior before any change; small commits with green tests; one cluster moved at a time; feature flags or branch-by-abstraction for risky migrations; observability (metrics, error rates) watched after each deploy. The point is to be able to revert the *single* commit that broke production, not the whole refactor.

---

**Q19: Why are static `Utils` classes God Classes in disguise?**

A: They have no fields, so LCOM looks artificially perfect, but they accumulate dozens of unrelated functions. Every module depends on them, so CBO is effectively unbounded. They cannot be mocked. Changes ripple everywhere. The fix is to promote each function — or each cluster — to a real type, often the value object the function operates on (`isValidEmail` belongs on `EmailAddress`).

---

**Q20: Walk me through how you would prevent God Classes on a new project.**

A: From day one: 1) define bounded contexts as separate Maven modules; 2) enforce hexagonal layering with ArchUnit (no domain → infrastructure dependency); 3) add PMD with `GodClass`, `ExcessiveClassLength`, `TooManyMethods` to the build; 4) configure a Sonar gate with concrete thresholds; 5) include "any class > 200 LOC?" in the code review checklist; 6) write ADRs for any exceptions; 7) review module budgets quarterly. The cheapest God Class to prevent is the one that never gets committed.

---

**Memorize this:** A God Class is a measurable, mechanical defect — name the responsibilities, measure with PMD/Sonar/ArchUnit, split behind a facade with tests, and gate the build so the next one fails before merge.
