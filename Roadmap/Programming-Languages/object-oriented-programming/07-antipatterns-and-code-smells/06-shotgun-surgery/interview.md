# Shotgun Surgery - Interview Q&A

> Twenty questions and concise answers. Style follows what good interviewers expect: definition, contrast, mechanism, fix, trade-off. References to Fowler `Refactoring` (2nd ed.), Adam Tornhill (`Your Code as a Crime Scene`, `Software Design X-Rays`), and Codescene where the question demands evidence.

---

**Q1. Define shotgun surgery.**

A code smell where a single conceptual change requires edits in many places across the codebase. Fowler in `Refactoring` (2nd ed., ch. 3) describes it as the inverse of Divergent Change: divergent change is one class changing for many reasons; shotgun surgery is one reason forcing changes in many classes.

---

**Q2. How is shotgun surgery different from Feature Envy?**

Feature Envy is a method that talks more to another class's data than to its own. Shotgun surgery is a change pattern across the codebase. They often coexist - methods envying another class get duplicated, creating a shotgun pattern - but they are diagnosed differently. Feature envy is local (read one method); shotgun surgery is global (read commit history).

---

**Q3. What is the operational metric for shotgun surgery?**

Change coupling percentage. For two files A and B, the fraction of commits touching one that also touched the other. Above ~40% over a 30-commit window suggests refactoring; above ~70% confirms shotgun surgery. The metric was popularized by Adam Tornhill and is the engine of Codescene's analysis.

---

**Q4. How do you detect it without commercial tools?**

A `git log --name-only` parse plus a small script that counts file co-occurrence per commit. CodeMaat (open-source Clojure jar by Tornhill) does this out of the box: `code-maat -a coupling`. A shell pipeline of `git log + awk + sort + uniq -c` gets you 80% of the signal in 20 lines.

---

**Q5. Which refactoring moves from Fowler fix shotgun surgery?**

Primarily `Move Function`, `Move Field`, `Inline Class`, and `Combine Functions into Class`. The strategic move is to put the scattered behavior together so that the next change is local. `Replace Conditional with Polymorphism` is the companion when the shotgun is driven by a type code or enum.

---

**Q6. Give a concrete Java example.**

An `OrderType` enum with three variants, switched in `PriceCalculator`, `ShippingCalculator`, `LoyaltyPoints`. Adding a fourth variant requires editing three files. The fix moves the data onto the enum (or to a sealed interface with records), so future variants are one-file changes.

---

**Q7. How do Java 17 sealed interfaces help?**

A sealed interface with `permits` enumerates the valid subtypes. An exhaustive `switch` expression fails to compile if a new variant is added without updating every consumer. This turns shotgun surgery from a runtime hazard into a compile-time error - the compiler enumerates the blast radius for you.

---

**Q8. What is the relationship between shotgun surgery and microservices?**

Microservices amplify the smell. Each cross-service change is a coordinated multi-PR release, possibly across multiple teams. A change that would be three lines in a monolith becomes a sprint of cross-team work. The fix is the same idea at a different scale - consolidate behavior, version contracts, use backwards-compatible schemas - but the consequences of getting it wrong are larger.

---

**Q9. How does event versioning relate?**

When an event schema evolves, every consumer needs to know. If consumers contain version-branching logic (`if version == 1 ... else if version == 2`), each new version is shotgun surgery across all consumers. The fix is upcasters at consumer ingress (Axon Framework pattern): a chain that transforms `V1 -> V2 -> V3`, so handlers only see the current version.

---

**Q10. What is a backwards-compatible schema change, and why does it matter here?**

In Avro / Protobuf / JSON Schema, an additive change (new optional field with a default) is backwards-compatible: old consumers ignore the field, new consumers use it. This contains shotgun surgery to the producer side. A breaking change (rename, required field) forces every consumer to update simultaneously - the worst-case shotgun.

---

**Q11. What is Codescene and what does it measure?**

A commercial code analysis tool by Adam Tornhill that mines git history to compute change coupling, hotspots, code health, and team-knowledge maps. It ranks refactoring targets by combined coupling and complexity, so you fix the highest-leverage clusters first. Open-source equivalents: CodeMaat, gitqualia, git-of-theseus.

---

**Q12. What's the difference between temporal coupling and structural coupling?**

Structural coupling is what static analysis sees: file A imports file B, so they are coupled. Temporal coupling is what git history sees: file A and file B change together, regardless of imports. Shotgun surgery is primarily a temporal coupling problem - the static graph may look clean while the change history is tangled.

---

**Q13. How do you measure success of a shotgun-surgery refactor?**

Before/after on three numbers: files-per-commit median for changes in the affected area, p95 of files-per-commit for the area, and the coupling percentage of the top pair in the cluster. A successful refactor cuts all three by half or more. Track over 30+ post-refactor commits to confirm the drop is durable.

---

**Q14. Why is shotgun surgery costly in CI?**

Build cache keys depend on file content hashes. Each touched file invalidates a target and its downstream closure. A 20-file shotgun PR typically rebuilds 5-10x more targets than a 1-file PR, with corresponding wall-time and remote-cache-miss costs. Polyglot monorepos amplify this further when shared schemas regenerate code in multiple languages.

---

**Q15. How do you prevent shotgun surgery in code review?**

Three checks: PR size warning at 15+ files (warn, not block); coupling-aware diff bot that flags when a PR touches a file but not its historically-coupled partners; ArchUnit or equivalent rules that fail PRs introducing new cross-module edges. None alone is sufficient; together they catch most early signs.

---

**Q16. What's the role of Strategy pattern here?**

Strategy collapses scattered conditionals into an interface with one implementation per branch. Shotgun surgery driven by `if type == X` branches across many classes becomes a single composition-root choice: pick the implementation once, inject it. New variants are new implementations, not edits to existing classes.

---

**Q17. How does shotgun surgery relate to the Open/Closed Principle?**

OCP says code should be open to extension, closed to modification. Shotgun surgery is exactly the failure of OCP: extending the system requires modifying many existing files. Fixing shotgun surgery usually means restoring OCP locally - adding a new variant becomes adding a file, not editing existing ones.

---

**Q18. When is shotgun surgery acceptable?**

When the change axis genuinely cuts across boundaries that should remain separate - e.g., a regulatory rule that touches user-data handling in every domain. Then the cross-cutting nature is intrinsic. Aspect-oriented programming, decorators, or middleware are the legitimate tools. Shotgun surgery is unacceptable when the cross-cutting is accidental (a leaked enum, a shared format string).

---

**Q19. Name a tactical pre-commit guard against shotgun surgery.**

A pre-push or PR-CI script: `git diff --name-only origin/main...HEAD | wc -l` and warn over a threshold. Combine with `bazel query 'rdeps(//..., $(diff_targets))'` to estimate the affected-target count. Surface both numbers in the PR description automatically so reviewers see the blast radius.

---

**Q20. If you had only one diagnostic to run on a new codebase, which would it be?**

`git log --since="12 months ago" --name-only` parsed for the top-10 most-changed files and the top-10 most-coupled pairs. Five minutes of analysis. The hotspots are almost always the source of the team's pain, and the coupling pairs are almost always the shotgun-surgery clusters that need consolidation. This is the entire diagnostic premise behind Codescene, distilled into one shell command.

---

**Memorize this:** Shotgun surgery is defined by Fowler, quantified by Tornhill's change-coupling metric, detected by mining git history (CodeMaat, Codescene), and fixed by Fowler's consolidation moves (`Move Function`, `Inline Class`, `Replace Conditional with Polymorphism`). At scale, sealed types, schema-registry compatibility rules, and upcasters at consumer ingress are the architectural defenses. The single number that matters is change coupling percentage over a 30-commit window; above 40% is the threshold to act.
