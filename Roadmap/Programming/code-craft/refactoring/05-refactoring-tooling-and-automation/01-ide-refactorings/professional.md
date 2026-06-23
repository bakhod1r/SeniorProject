# IDE & Automated Refactorings — Professional

> **Source:** Martin Fowler, *Refactoring* (2nd ed.); JetBrains IntelliJ IDEA & ReSharper refactoring docs

The professional concern is the *system around* the refactoring: which engine your team actually has and what it can guarantee, how to keep automated refactorings honest in CI, the specific places they break in a real production codebase, and the team conventions that turn "the IDE has a Rename button" into "we refactor continuously and trust it."

---

## 1. The tooling landscape — engine reality

"Automated refactoring" is not one capability; it's whatever your specific engine implements for your specific language. Know what you actually have.

| Engine | Strongest where | Refactoring depth | Notes |
|---|---|---|---|
| **IntelliJ IDEA** (and the JetBrains family: PyCharm, GoLand, Rider, WebStorm) | JVM languages (Java/Kotlin) | Deepest available; rich catalog, strong previews, conflict detection, structural search/replace | The reference implementation. Kotlin/Java refactorings are essentially provably correct. |
| **ReSharper** (Visual Studio plugin) | C#/.NET | Comparable to IntelliJ for .NET; large catalog | Heavy; for big solutions teams sometimes prefer **Rider** (IntelliJ-based) for performance. Roslyn underpins the .NET semantic model. |
| **Roslyn analyzers / `dotnet format`** | C# | Scriptable, CI-runnable fixers | Lets you ship *custom* automated fixes as analyzers — refactoring-as-code in the build. |
| **LSP servers in VS Code/Neovim** (e.g. `rust-analyzer`, `gopls`, `tsserver`, `clangd`, `jdtls`) | Per language | Varies widely | The catalog depends entirely on the *server*, not the editor. `rust-analyzer` and `gopls` are excellent; `jdtls` (Eclipse JDT under the hood) is good but trails IntelliJ; many servers offer only Rename + a few "code actions." |
| **Eclipse JDT** | Java | Solid, mature | The original heavyweight Java refactoring engine; still the floor everyone measures against. |

Operational consequences:

- **The editor is not the engine.** "We use VS Code" tells you nothing about refactoring power — the language server does the work. A team standardized on VS Code + a thin LSP server has *weaker* automated refactoring than a team on IntelliJ, even for the same Java code. Budget for this, or standardize the engine for the languages that matter.
- **Per-language asymmetry within one repo.** A polyglot service may have airtight Kotlin refactoring and best-effort Python refactoring in the *same* repo. Your conventions must reflect that the trust level differs by directory.

> **When NOT to:** don't mandate a single IDE for ergonomics reasons if it costs you the strong engine. Mandate the *engine capability* (e.g. "Java/Kotlin must be refactored with an IntelliJ-class engine"), and let people pick editors that meet it.

## 2. Refactoring safety in CI

Automated refactorings run on a developer's machine; the *guarantee* must be re-established in CI, because (a) dynamic-language renames are heuristic and (b) any change crossing a boundary the IDE can't see (config/SQL/templates) won't be caught locally.

A pragmatic CI safety stack for refactoring-heavy work:

1. **Compile / type-check as a gate.** For typed languages this catches the vast majority of broken references instantly. Treat *new* type errors and *new* warnings as build failures during refactoring sprints.
2. **Full test suite, including the integration layer.** Unit tests miss reflection/DI/SQL breakage by construction (those wire up at runtime). You need tests that actually boot the framework, hit the DB, render the template. This is where a renamed bean id or stale JSON key finally surfaces.
3. **Schema/contract checks.** If a field is also a serialized contract, add a contract test (consumer-driven contract, JSON schema validation, or a golden serialization snapshot) so a "harmless" rename that changes wire format fails loudly.
4. **Static analyzers for known dynamic links.** Config-aware linters (e.g. Spring's, or a custom check) can flag a bean id referenced in XML/annotations that no longer resolves.
5. **Codemod review for the boundary changes.** When the change crossed into config/SQL, it was a codemod, not an IDE refactoring — review it as code ([`../02-codemods-and-ast-transforms/professional.md`](../02-codemods-and-ast-transforms/professional.md)).

The principle: **the IDE's green checkmark is a local optimization; CI re-proves behavior at the boundaries the IDE couldn't see.** See [`../03-automated-safety-nets/professional.md`](../03-automated-safety-nets/professional.md).

## 3. Where automated refactorings break in production

The recurring real-world failure modes, with the concrete artifact each one stales:

| Boundary | The invisible reference | Failure |
|---|---|---|
| **Reflection** | `Class.forName("...")`, `getMethod("name")`, annotation processors keyed on names | `ClassNotFoundException` / `NoSuchMethodException` at runtime after a rename/move |
| **Dependency injection** | Spring bean ids (`@Qualifier("...")`, XML `<bean id>`), Guice binding annotations | Context fails to start; `NoSuchBeanDefinitionException` |
| **ORM / SQL** | `@Column(name=...)`, raw SQL strings, JPQL/HQL referencing renamed fields | Wrong column / SQL error / silent wrong mapping |
| **Templates** | JSP/Thymeleaf/JSX/Handlebars referencing a renamed model property | Blank field / template error at render, not at build |
| **Serialization contracts** | JSON/Protobuf/Avro field names tied to a Java field | Wire format changes silently; consumers break |
| **Config & env** | `@Value("${...}")`, property keys, feature-flag names | `null`/default silently used; misconfiguration |
| **Cross-process strings** | event names, queue/topic names, cache keys, route paths | Messages no longer match; routes 404 |

The professional reflex when planning *any* rename/move on a domain type: ask "**is this name also a string somewhere?**" — DB column, wire field, bean id, route, template binding, cache key. If yes, the IDE refactoring is *step one of N*, and you need a grep for the string plus a boundary test. JPA `@Column` / serialization `@JsonProperty` annotations are your friends precisely because they *decouple* the code symbol from the external name, letting you rename the symbol freely.

> **When NOT to:** never let a junior do a "quick rename" of a JPA entity field or a Spring bean class without the boundary checklist. The IDE will report success and production will report an outage.

## 4. Measuring and building trust

Trust in automation is earned with evidence; a team that doesn't trust the tools refactors timidly and the code rots.

- **Track refactoring-induced incidents.** If a rename/move caused an incident, postmortem the *boundary* it crossed and add a test/check for that class of boundary — not a "be more careful" action item.
- **Make the green path cheap.** Fast compile + fast test subset means people refactor in small steps (the safe way) instead of batching (the risky way). Slow CI *causes* big risky changes.
- **Adopt structural search/replace for repeatable shapes.** IntelliJ's Structural Search and Replace, or Roslyn analyzers/`comby`, let the team encode "always refactor X into Y" as a checked, repeatable rule rather than tribal knowledge.
- **Type the hot code.** The single biggest lever on tooling trust in a gradually-typed codebase is reducing `any`/untyped surfaces in frequently-changed modules (see [senior.md](senior.md)).

## 5. Team conventions

- **Refactor in the same PR as the feature is fine — if separated into reviewable commits.** "Refactoring commit" then "behavior commit" lets reviewers verify the refactoring was behavior-preserving (ideally: diff produces no test changes) before reviewing new logic.
- **Pure-refactoring PRs should not change tests.** If a "refactoring" PR also edits assertions, it wasn't behavior-preserving — that's a red flag in review.
- **Name the refactoring in the commit message.** "Extract Method `calculateTax`; Rename `amt`→`amount`" tells the reviewer it was mechanical and reversible.
- **Codify the boundary checklist.** A short PR template line — "Does this rename a field/class that is also a DB column / wire field / bean id / route / template binding? If yes, list the matching string changes" — catches the §3 failures before merge.
- **Standardize the engine for safety-critical languages**, as in §1.

## 6. Next

- **[interview.md](interview.md)** — articulate these trade-offs under questioning.
- **[find-bug.md](find-bug.md)** — diagnose the §3 failures in concrete code.
- **[optimize.md](optimize.md)** — name the exact refactoring sequence to clean given snippets.
- When the IDE can't reach: [`../02-codemods-and-ast-transforms/professional.md`](../02-codemods-and-ast-transforms/professional.md) · [`../04-large-scale-automated-migrations/professional.md`](../04-large-scale-automated-migrations/professional.md)
