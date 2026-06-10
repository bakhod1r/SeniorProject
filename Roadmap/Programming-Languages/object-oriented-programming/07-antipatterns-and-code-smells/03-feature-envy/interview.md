# Feature Envy — Interview Q&A

Twenty numbered questions and concise, interview-ready answers. Calibrated for mid-to-senior Java engineering interviews where the interviewer wants to hear precise definitions, tool names, and refactoring vocabulary.

---

**1. What is Feature Envy?**

A method-level code smell where a method is more interested in data of another class than in data of its own class. It repeatedly calls accessors of one foreign class to do its work. Fowler catalogued it in *Refactoring* (2nd ed., 2018); the canonical fix is **Move Method**.

---

**2. How is Feature Envy defined objectively?**

Lanza & Marinescu (*Object-Oriented Metrics in Practice*, 2006) define it as the conjunction of three metric thresholds: **ATFD > 5**, **LAA < 1/3**, and **FDP ≤ 5**. All three must hold.

---

**3. What does ATFD stand for?**

Access To Foreign Data. The number of distinct attributes of *other* classes that the method reads, either directly or through getters. Count distinct attributes, not call sites.

---

**4. What does FDP stand for?**

Foreign Data Providers. The number of distinct *classes* (other than the method's own) from which the method reads attributes. ATFD measures volume, FDP measures spread.

---

**5. What does LAA stand for, and what is the formula?**

Locality of Attribute Accesses. `LAA = own-attribute-accesses / (own + foreign) attribute accesses`. Range 0.0 (pure envy) to 1.0 (no envy). Threshold for envy: `LAA < 1/3`.

---

**6. Why isn't high ATFD alone sufficient to flag envy?**

Because a legitimate coordinator method may read many foreign attributes while also doing significant work on its own state. Without the LAA threshold you would flag every service method. The conjunction `ATFD > 5 AND LAA < 1/3 AND FDP ≤ 5` filters for the true centre-of-gravity-in-wrong-class pattern.

---

**7. What is the primary refactoring?**

**Move Method.** Move the envious method to the class whose data it envies. If only part of the method is envious, do **Extract Method** first to isolate the envious chunk, then Move Method on the extracted method.

---

**8. How do you choose the target class for Move Method?**

The foreign class with the highest contribution to ATFD — the class providing the most attributes the method consumes. Tie-breaker: the class with which the method shares the strongest behavioural cohesion (calls to its non-accessor methods).

---

**9. When is Feature Envy acceptable?**

Three legitimate cases: **Visitor pattern** (the visitor by design reads the visited object's state); **DTO mappers** (their job is to translate foreign data); **anti-corruption layers** between bounded contexts (the ACL exists to read across the boundary). In each case the envy is named, isolated, and expected.

---

**10. What is the relationship between Feature Envy and the Anemic Domain Model?**

An anemic domain model — entities with only getters and setters — *forces* Feature Envy at architectural scale. Every service method becomes envy-shaped because the entities have no behaviour. Fowler (2003) called this an anti-pattern for exactly this reason. The cure is to move behaviour into entities, eliminating the systemic envy.

---

**11. What is the relationship between Feature Envy and Law of Demeter?**

They are related but not identical. Law of Demeter forbids chains like `a.getB().getC().getD()`. Feature Envy is about *how many* foreign attributes a method reads in total, regardless of chain depth. A method can violate Law of Demeter with one call (`a.b().c().d()`) without crossing the ATFD threshold; and a method can have high envy without any chains, just many getters on one object. Both are caught by PMD's `LawOfDemeter` and SonarJava S3398 respectively.

---

**12. Which static analysers detect Feature Envy?**

**SonarJava** rule **S3398** ("methods should not access fields of other classes excessively"); **IntelliJ IDEA** built-in inspection "Feature envy" under Class metrics; **JArchitect** query `FeatureEnvyMethods`; **DesigniteJava** (open source); **inFusion / iPlasma** (Marinescu's reference tools); **NDepend** and **Structure101** also have rules.

---

**13. How does SonarJava S3398 differ from the Lanza & Marinescu definition?**

S3398 uses a simplified heuristic: a method is flagged if it accesses more than 4 distinct attributes of a single other class. It is roughly ATFD with FDP=1, ignoring LAA. Stricter on focused envy, more lenient on spread-out envy.

---

**14. How would you enforce no-envy at the architectural layer?**

**ArchUnit** fitness functions in the test suite. Example rules: no controller may call domain setters; no service method may read more than three getters of any single domain class; no class outside the domain package may navigate two-deep into domain aggregates. Failures fail the CI build.

---

**15. What is "Move Method" step by step?**

(1) Examine the source method's interaction with members of its own class; if it uses any, decide whether they move with it. (2) Check the target class does not already have a method with the conflicting signature. (3) Copy the method body to the target. (4) Adjust references to fields that no longer move. (5) Turn the source method into a delegating call (or remove it if no external callers). (6) Inline the delegating call at each caller. (7) Compile and test after each step. Fowler dedicates a full chapter to the mechanics.

---

**16. Give an example of Feature Envy in DTO-layer code.**

```java
@PostMapping("/users")
public ResponseEntity<UserDto> register(@RequestBody UserRegisterRequest req) {
    User u = new User();
    u.setEmail(req.getEmail().toLowerCase().trim());
    u.setFirstName(capitalize(req.getFirstName()));
    u.setLastName(capitalize(req.getLastName()));
    // ...more setters reading req fields
}
```

The controller envies `UserRegisterRequest`. Fix with a `UserMapper` (manual or MapStruct) or a `User.fromRegistration(req)` factory method.

---

**17. How does Feature Envy interact with performance?**

Removing envy can improve performance through three mechanisms: shorter call chains reduce dispatch overhead; concentrating field access on one receiver improves L1 cache locality and register allocation; making call sites monomorphic allows aggressive JIT inlining. The effects are usually small (single-digit nanoseconds) unless the method is on a very hot path. Verify with JFR or async-profiler.

---

**18. Can Feature Envy be a *positive* design choice?**

Yes, in **transaction script** architectures (Fowler, *PoEAA*) and **functional core / imperative shell** designs. In a transaction script the procedure deliberately reads data and writes results; entities are intentionally dumb. In functional-core designs, pure functions consume data records and produce new ones. Both are legitimate architectures with concentrated, named envy. The smell name is only valid in an OO architecture that claims to use rich domain models.

---

**19. What is the difference between Feature Envy and Inappropriate Intimacy?**

Feature Envy is a **method** reading another class's data excessively. Inappropriate Intimacy is a **two-class relationship** where both classes know too much about each other's internals — bidirectional coupling, mutual private-field access through package-private, friend-class anti-patterns. Feature Envy fix: Move Method. Inappropriate Intimacy fix: Move Method, Extract Class, or Change Bidirectional Association to Unidirectional.

---

**20. In a code review, how do you raise Feature Envy without sounding pedantic?**

Frame it around the method's name and centre of gravity. Ask: "What does this method *want* to do?" If the answer mentions another class's data five times, suggest moving it. Cite concrete metrics from the static analyser ("S3398 flagged this; ATFD is 7") rather than personal taste. Offer the refactoring move ("Extract Method here, then Move Method to `Order`?") rather than just naming the smell. Acknowledge the legitimate cases (mappers, visitors, coordinators) so the author trusts your judgement.

---

## Memorize this

Feature Envy = method more interested in another class's data than its own. Defined objectively by **ATFD > 5**, **LAA < 1/3**, **FDP ≤ 5** (Lanza & Marinescu). Fixed by **Move Method** (Fowler), preceded by Extract Method when only a chunk is envious. Detected by SonarJava S3398, IntelliJ "Feature envy" inspection, JArchitect, DesigniteJava, and ArchUnit fitness functions. Legitimate cases: visitors, DTO mappers, anti-corruption layers, transaction scripts. The anemic domain model is Feature Envy at architectural scale — fix by moving behaviour into entities. Related smells: Law of Demeter (chain-shaped), Inappropriate Intimacy (relationship-shaped).
