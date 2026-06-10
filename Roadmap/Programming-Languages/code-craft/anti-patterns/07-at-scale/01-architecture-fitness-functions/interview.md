# Architecture Fitness Functions — Interview Questions

> **Category:** [Anti-Patterns at Scale](../README.md) → **Architecture Fitness Functions**
> **Covers (collectively):** Layering & dependency rules · Cycle-detection gates · Allowed-dependency contracts · Metric thresholds · Evolutionary architecture & CI gating

A bank of 30+ interview questions and answers spanning the concept of fitness functions, the three flagship tools, baselining real codebases, false positives, build-time cost, and the failure modes that make a rule look green while guarding nothing. Each answer models the reasoning a strong candidate gives — including the trade-offs. Use the `<details>` toggles to self-quiz: read the question, answer out loud, then expand.

---

## Table of Contents

1. [Concept — Fitness Functions & Evolutionary Architecture](#concept--fitness-functions--evolutionary-architecture)
2. [Tools — ArchUnit, import-linter, dependency-cruiser/madge](#tools--archunit-import-linter-dependency-crusermadge)
3. [Rules — Dependency, Naming, Metrics, Cycles](#rules--dependency-naming-metrics-cycles)
4. [Adoption — Baselining, False Positives, Ownership](#adoption--baselining-false-positives-ownership)
5. [Operations — Build Cost, Incremental Checks, CI Gating](#operations--build-cost-incremental-checks-ci-gating)
6. [Failure Modes — "Passes but Constrains Nothing"](#failure-modes--passes-but-constrains-nothing)
7. [Curveballs](#curveballs)
8. [Rapid-Fire / One-Liners](#rapid-fire--one-liners)
9. [Summary](#summary)
10. [Related Topics](#related-topics)

---

## Concept — Fitness Functions & Evolutionary Architecture

> Definitions and the "why automate structure" reasoning.

**Q1. What is an architecture fitness function?**

<details><summary>Answer</summary>

It's **an automated test that asserts a structural property of the code** — which module imports which, how deep a package nests, whether a layer is bypassed, whether the dependency graph has a cycle — and **fails the build when that property is violated**. The term comes from *Building Evolutionary Architectures* (Ford, Parsons, Kua) by way of evolutionary biology: a fitness function measures how close a system is to a characteristic you want it to keep. Here the characteristic is structural ("dependencies point the right way") and the function is just a test you run in CI.

The defining move is that it checks the *shape* of the code, not its output. `add(2, 2) == 4` is behavioral; `package web does not import package db` is a fitness function. Both fail the build; only the second notices when a teammate couples two things that should stay apart.
</details>

**Q2. What is evolutionary architecture, and how do fitness functions fit into it?**

<details><summary>Answer</summary>

**Evolutionary architecture** is the idea that you do *not* design the architecture fully up front and freeze it — you let it change incrementally, guided by automated checks that protect the properties you care about (the "architectural characteristics": modularity, performance, security boundaries, deployability). Fitness functions are the mechanism that makes evolution safe: instead of a frozen diagram that drifts out of date, you have *executable* guarantees that survive every change.

The slogan is "guided, incremental change across multiple dimensions." Without fitness functions, "evolutionary" just means "we let it rot." The functions are what convert a wiki diagram into a guardrail that a growing team and a deadline can't quietly erode.
</details>

**Q3. How is a fitness function different from a unit or integration test?**

<details><summary>Answer</summary>

A unit/integration test asserts **runtime behavior** — given input X, the code produces output Y (correctly computes a total, returns 404, persists a row). A fitness function asserts **static structure** — the code is *allowed to look* a certain way, regardless of what it computes.

Concretely: if someone makes `web` import `db` directly, every behavioral test stays green — the totals still add up, the endpoint still returns 200. Nothing about the output changed. What changed is the shape: a layer was bypassed. Behavioral tests protect correctness; fitness functions protect structure. A codebase with a fully green behavioral suite can still be rotting — the rot just isn't a wrong answer, it's a wrong shape.
</details>

**Q4. If behavioral tests are green and the fitness functions are green, can the architecture still be getting worse?**

<details><summary>Answer</summary>

Yes. Fitness functions only catch the shapes you *wrote a rule for*. If the regression is a shape no rule covers — a new God Object inside an allowed package, a third module joining two that were supposed to stay independent, a metric (fan-in, instability) you never thresholded — every existing check stays green while the architecture decays. Behavioral tests never see structure at all.

This is the honest limitation: a fitness-function suite is a *whitelist of structural invariants*, not a general "is the architecture good?" oracle. It's exactly as good as the rules in it. The practical answer is to add a rule the moment you name a new invariant — often triggered by a code review where a senior says "this shouldn't be allowed."
</details>

**Q5. Are fitness functions only about dependencies?**

<details><summary>Answer</summary>

No — dependencies are the *most common* and easiest kind, but the category is broader. A fitness function is any automated assertion about an architectural characteristic. Examples beyond imports:

- **Naming:** "every class in `..controller..` ends in `Controller`."
- **Metrics:** "no package has efferent coupling > 20"; "cyclomatic complexity per method ≤ 15"; "the cycle count in the dependency graph is 0."
- **Layering:** the ordered version of dependency rules — `web` may call `service`, `service` may call `repo`, never upward or skipping.
- **Co-location / placement:** "no SQL string literal outside the `repository` package."
- **Operational ones (atypical in this chapter):** "p99 latency < 200ms," "the deploy artifact has no CVE above HIGH." Those are fitness functions too, just runtime ones.

In this chapter the focus is *static, structural* fitness functions — the ones a tool like ArchUnit/import-linter/madge can check from the dependency graph.
</details>

**Q6. Give the canonical taxonomy of fitness functions from *Building Evolutionary Architectures*.**

<details><summary>Answer</summary>

The book classifies them along a few axes:

- **Atomic vs. holistic** — atomic checks one characteristic in isolation (a single import rule); holistic checks several interacting characteristics together (security *and* throughput under load).
- **Triggered vs. continual** — triggered runs in response to an event (per-commit, per-PR in CI); continual runs constantly in production (a monitor on latency).
- **Static vs. dynamic** — static evaluates a fixed value (this import exists / doesn't); dynamic evaluates against a shifting context (acceptable latency depends on current load).
- **Automated vs. manual** — automated is the goal; manual exists for things you genuinely can't yet automate (a human review gate).

The structural rules in this chapter are overwhelmingly **atomic, triggered, static, automated** — the cheapest, most reliable quadrant, which is why teams start there.
</details>

---

## Tools — ArchUnit, import-linter, dependency-cruiser/madge

> The three flagship tools, what each is good at, and where Go fits.

**Q7. Compare ArchUnit, import-linter, and dependency-cruiser/madge.**

<details><summary>Answer</summary>

All three build a dependency graph and assert properties of it; they differ by ecosystem and expressiveness.

| Tool | Ecosystem | Form | Sweet spot |
|---|---|---|---|
| **ArchUnit** | Java/JVM | A JUnit test in a fluent Java DSL; scans compiled bytecode | Rich rules (layers, naming, slices, cycles, metrics) that live *as tests* and run wherever tests run |
| **import-linter** | Python | A declarative config (`.importlinter` / `setup.cfg`) checked by `lint-imports` | Layered + forbidden + independence *contracts* with zero test-code to write |
| **dependency-cruiser** | JS/TS | A JS config of `forbidden`/`allowed` rules; CLI | Rich forbidden-edge rules, regex on paths, orphan detection in polyglot front ends |
| **madge** | JS/TS | A zero-config CLI; `--circular` is the headline | The one-liner no-cycles gate; visualizing the graph |

ArchUnit is the most *expressive* (it's a full API in a real language). import-linter is the most *declarative* (no code, just contracts). madge is the cheapest *first win* (`--circular` needs no config at all); dependency-cruiser is its richer sibling when you need real layering rules in JS/TS.
</details>

**Q8. Where does Go fit? It has none of those tools by default.**

<details><summary>Answer</summary>

Go gives you the **no-cycle rule for free** — the compiler rejects import cycles between packages, so that fitness function is enforced before you write a line of config. For "layer A must not import layer B," the idiomatic hello-world is a few lines over `go list`:

```bash
go list -deps ./web/... | grep -q 'myapp/internal/db' \
  && { echo "FORBIDDEN: web imports db"; exit 1; } || true
```

For richer, declarative rules Go teams reach for libraries like `go-arch-lint` (YAML component rules) or write a small `go/analysis` analyzer that runs under `go vet`. The package-layout convention `internal/` is itself a compiler-enforced fitness function: packages under `internal/` can't be imported from outside their parent tree.
</details>

**Q9. ArchUnit scans bytecode; import-linter and madge read source. Does that matter?**

<details><summary>Answer</summary>

Yes, in two ways. **Bytecode scanning (ArchUnit)** sees the *resolved* dependency graph — reflection the compiler turned into real calls, dependencies introduced by annotations, generics erased to concrete types. It needs a *compiled* artifact, so it runs after the build. **Source/AST scanning (import-linter, madge, dependency-cruiser)** sees `import` statements directly, runs without compiling, and is faster to invoke — but it can miss dependencies expressed dynamically (Python `importlib`, JS dynamic `import()`, reflection) and can be fooled by re-exports.

Practical consequence: ArchUnit catches "sneaky" runtime couplings the source-level tools miss, at the cost of needing a build first. For most layering rules the difference doesn't bite; for "does the domain *really* avoid the framework, including via DI/annotations," bytecode-level is more trustworthy.
</details>

**Q10. Your shop is polyglot — Java services, a TS front end, some Python tooling. One tool or many?**

<details><summary>Answer</summary>

Many — there is no cross-language fitness-function tool, because each reads a different graph (bytecode, Python imports, TS imports). The right model is **one tool per language, one consistent CI convention.** Each repo/module runs its native tool (ArchUnit in the Java modules, import-linter in the Python ones, dependency-cruiser/madge in the front end), and they all share the same *non-negotiable*: the check is a **CI gate** that exits non-zero on violation, with a message that names the offending edge.

What you standardize across languages is not the tool but the *policy*: where rules live (next to the code they constrain, version-controlled), who owns them, and that "go red and block the merge" is identical everywhere. The taxonomy and the rules are portable; the executors aren't.
</details>

**Q11. dependency-cruiser or madge — when do you reach for which?**

<details><summary>Answer</summary>

**madge** when all you want is the no-cycle gate or a quick graph picture — `npx madge --circular --extensions ts,tsx src/` needs zero config and is the cheapest first win. **dependency-cruiser** when you need *named, layered* rules: "nothing in `src/domain` may import `src/infra`," "no `src/**` file may import a dev-only module," orphan detection, regex path matching, and a machine-readable report. madge answers "is there a cycle?"; dependency-cruiser answers "does the graph obey this rule set?" Most teams adopt madge for the cycle gate on day one and graduate to dependency-cruiser when they want real layering.
</details>

---

## Rules — Dependency, Naming, Metrics, Cycles

> Writing the actual checks.

**Q12. Write the simplest possible fitness function and name its shape.**

<details><summary>Answer</summary>

The simplest shape is a **forbidden dependency**: "package A must not import package B." In ArchUnit:

```java
@ArchTest
static final ArchRule web_must_not_touch_db =
    noClasses().that().resideInAPackage("..web..")
        .should().dependOnClassesThat().resideInAPackage("..db..");
```

Most layering and isolation rules reduce to this one shape: "domain must not import the framework" is `domain ↛ spring/django/gin`; "nothing may import legacy" is `* ↛ legacy`; a no-cycle rule between two packages is just two forbidden dependencies pointing opposite ways.
</details>

**Q13. What's the difference between a *forbidden* contract and a *layered* contract in import-linter?**

<details><summary>Answer</summary>

A **forbidden** contract bans specific edges: `source_modules` must not import `forbidden_modules`. It's unordered and explicit — you name exactly which import is illegal.

A **layered** contract encodes an *ordered stack*: you list layers high-to-low, and the tool forbids every "lower imports higher" *and* every "skip a layer" edge in one declaration:

```ini
[importlinter:contract:layers]
name = Web → service → repository, one direction only
type = layers
layers =
    shop.web
    shop.service
    shop.repository
```

That single contract forbids `repository → service`, `repository → web`, `service → web`, and (depending on `containers`/strictness) the skip `web → repository`. A layered contract is N forbidden contracts you didn't have to write by hand — and it's self-documenting, because the layer order *is* the architecture diagram.
</details>

**Q14. How do you write a naming fitness function, and why bother?**

<details><summary>Answer</summary>

Naming rules assert that classes in a role follow a convention, which keeps the architecture *legible* and makes other rules targetable (you can't say "controllers must not import repositories" reliably if controllers aren't named consistently). ArchUnit:

```java
@ArchTest
static final ArchRule controllers_are_named_Controller =
    classes().that().resideInAPackage("..controller..")
        .should().haveSimpleNameEndingWith("Controller");
```

The payoff is twofold: humans navigate faster, and *machines* can rely on the convention — `..*Controller` becomes a precise selector for further rules. A naming rule is cheap insurance that your other fitness functions keep matching the right classes as the codebase grows.
</details>

**Q15. What's a metric-threshold fitness function? Give a real one.**

<details><summary>Answer</summary>

It asserts a *number* derived from the structure stays under a threshold, rather than asserting a specific edge. Examples: package efferent coupling (how many other packages it depends on) ≤ 20; the number of cycles in the slice graph = 0; per-method cyclomatic complexity ≤ 15; "instability × abstractness distance from the main sequence" within a band.

```java
@ArchTest
static final ArchRule no_package_cycles =
    slices().matching("com.shop.(*)..").should().beFreeOfCycles();
```

The trade-off: thresholds are **fuzzier** than forbidden edges. A forbidden-dependency rule is binary and unarguable; a metric threshold invites bikeshedding ("why 20 and not 25?") and tends to be set as a *ratchet* — start at today's value, only allow it to improve — rather than an absolute. That's the bridge to [Anti-Pattern Budgets & Ratcheting](../02-anti-pattern-budgets-and-ratcheting/senior.md).
</details>

**Q16. Why is the no-cycle gate the rule almost everyone adds first?**

<details><summary>Answer</summary>

Three reasons. (1) **Cycles are almost always a smell** — a loop in the dependency graph means two modules can't be understood, built, or tested independently, and it's the seed of a Big Ball of Mud. (2) **It needs zero design** — unlike layering, you don't have to draw a layer map first; "no cycles anywhere" is a universal rule. (3) **It's a one-liner** — `madge --circular`, ArchUnit `beFreeOfCycles()`, and in Go the compiler already enforces it. Cheapest possible first win, highest signal: a cycle is rarely a false positive.
</details>

---

## Adoption — Baselining, False Positives, Ownership

> Putting fitness functions on a codebase that already has violations.

**Q17. You add a layering rule to a 500k-line codebase and it reports 240 existing violations. Now what?**

<details><summary>Answer</summary>

You **baseline**. Fixing 240 violations before you can merge the rule means the rule never merges. Instead, snapshot the current set of known violations into a baseline file, configure the check to **fail only on violations *not* in the baseline**, and commit. From that moment: existing debt is *frozen* (it can't grow) and any *new* violation goes red immediately.

ArchUnit has `FreezingArchRule` for exactly this; import-linter and dependency-cruiser support ignore/exception lists; for ad-hoc checks you write a baseline-diff script (covered in [`tasks.md`](tasks.md)). The principle is "stop the bleeding first, drain the debt later" — the same ratchet idea as [Anti-Pattern Budgets & Ratcheting](../02-anti-pattern-budgets-and-ratcheting/senior.md). A rule you can adopt *today* with a baseline beats a perfect rule you adopt *never*.
</details>

**Q18. What's the danger with a baseline, and how do you keep it from becoming a dumping ground?**

<details><summary>Answer</summary>

The danger is that the baseline turns into a **permanent landfill** — people add new violations to it to get green ("just add it to the ignore list"), and the count only ever grows. Two safeguards: (1) **the baseline may only shrink** — wire a check (or PR rule) that fails if the baseline *grew*, so removing an entry is fine but adding one requires a deliberate, reviewed exception; (2) **make it visible** — surface the count in the build output and trend it, so a growing baseline is a number someone has to defend, not a silent file. The baseline is a debt ledger, not an amnesty.
</details>

**Q19. A fitness function fires on something that is actually fine — a legitimate exception. How do you handle false positives?**

<details><summary>Answer</summary>

First, **distrust the instinct that it's a false positive** — most "false positives" are the rule correctly catching a real coupling the author rationalizes. Once you've genuinely confirmed it's legitimate (e.g., a `main`/wiring package is *supposed* to touch everything, or a generated-code package is exempt):

- Prefer **narrowing the rule** so it expresses the real intent (`..web..` excluding `..web.config..`) over a blanket suppression.
- If you must suppress a specific edge, use a **scoped, documented exception** — ArchUnit's ignore predicate / `@ArchIgnore`, import-linter's `ignore_imports`, dependency-cruiser's per-rule exceptions — with a comment stating *why* and ideally a ticket.
- Never relax the *whole* rule to silence one case. Relaxing the rule the moment it bites is undoing the rule.

A rule that produces frequent false positives is itself a bug — it's too coarse, and a too-coarse rule trains people to ignore red, which is worse than no rule.
</details>

**Q20. Where should the rules physically live, and who owns them?**

<details><summary>Answer</summary>

**Live:** in the repository, next to the code they constrain, version-controlled and code-reviewed like any other code — ArchUnit rules in `src/test`, import-linter contracts in the project config, dependency-cruiser config at the repo root. Rules that live in a separate "governance repo" or a CI dashboard nobody edits go stale; rules in the repo evolve *with* the code in the same PR.

**Own:** the team that owns the code, with architectural guidance. The anti-pattern is a central architecture board that *writes* rules and throws them over the wall — those rules get resented and circumvented. The healthy model: architects and senior engineers establish the *invariants* and the review bar for adding/relaxing a rule; the owning team writes and maintains the actual checks. A rule with no owner is a rule that rots into either constant false positives or a permanently-growing baseline.
</details>

**Q21. How do you introduce fitness functions to a team that's never used them without it feeling like cops?**

<details><summary>Answer</summary>

Start with a rule the team *already believes in* and is *already not violating* — the no-cycle gate is ideal because it's usually green on day one, so it adds a guarantee without adding friction. Then add rules that protect invariants the team has been *burned by* (the time `web` reached into `db` and the DB swap took a month). Each rule should ship with a message explaining the *why*, so a red build teaches rather than scolds. Crucially, **don't encode the whole architecture on day one** — a single enforced rule everyone agrees on beats a grand unmerged ruleset that triggers a turf war. Fitness functions land well when they feel like "we wrote down the thing we already agreed on," not "the architects are policing us."
</details>

---

## Operations — Build Cost, Incremental Checks, CI Gating

> Making the checks fast and trustworthy enough to gate on.

**Q22. What makes a fitness function a "gate," and why does that distinction matter so much?**

<details><summary>Answer</summary>

A **gate** is a check that **blocks the merge** when it fails — exit non-zero in the required CI pipeline, a red status that the merge button respects. The distinction matters because a fitness function that *runs* but doesn't *gate* enforces nothing: a warning everyone scrolls past, a check on a non-required job, a script on someone's laptop. The entire value proposition — "a machine enforces this identically on every commit, with no fatigue" — collapses the moment it's not blocking. A non-gating fitness function is just a wiki rule with extra steps. Either it can fail the build or it isn't enforcement.
</details>

**Q23. The full ArchUnit/madge scan adds 90 seconds to every commit and developers are grumbling. How do you keep enforcement without the tax?**

<details><summary>Answer</summary>

Several levers, usually combined:

- **Scope to what changed.** On a PR, run the heavy structural scan only over the packages touched by the diff, not the whole repo; the whole-repo scan moves to a less frequent trigger.
- **Cache the class/import graph.** Building the dependency graph is the expensive part; cache it keyed by a content hash so unchanged modules aren't re-parsed (CI build cache, ArchUnit's frozen store, madge with a warmed cache).
- **Split fast vs. slow.** Cheap, high-signal rules (no-cycles, the one or two critical forbidden edges) run **per-PR**; expensive holistic/metric scans run **nightly** against `main` and open a ticket on regression.
- **Parallelize.** Independent rule sets / modules run as separate CI jobs in parallel rather than one serial mega-test.

The trade-off to state explicitly: per-PR you sacrifice some coverage for speed (you might catch a whole-repo violation a few hours later in the nightly instead of at PR time). For *new* structural drift that's an acceptable lag, because the per-PR fast rules still catch the common, dangerous cases instantly. This is the core of [`optimize.md`](optimize.md).
</details>

**Q24. Is it safe to move expensive fitness functions to a nightly job instead of per-PR?**

<details><summary>Answer</summary>

It's a deliberate trade, not free. **Per-PR** catches the violation *at the moment it's introduced*, by the person who introduced it, while the context is fresh and the fix is cheap — but it taxes every commit. **Nightly** is much cheaper (runs once, against `main`) but catches drift *hours later*, possibly after several merges, so attributing and fixing it costs more, and `main` is briefly "dirty."

The standard split: **fast, high-signal rules gate per-PR** (no-cycles, the handful of critical forbidden edges); **slow, broad, or metric-heavy rules run nightly** and open a tracked issue on regression. You keep instant feedback where it's cheapest to act and accept a short lag where the scan is genuinely expensive. What you never do is move *all* enforcement to nightly — then PRs merge unchecked and `main` becomes the place violations are discovered.
</details>

**Q25. How do you make an incremental (changed-packages-only) check correct? Isn't it easy to miss a violation?**

<details><summary>Answer</summary>

Yes — naive "only scan changed files" is unsound, because a violation can be introduced by a change *outside* the offending file. If module C newly imports A, and A→B was already legal, but now C→A→B creates a cycle, scanning only C misses it. The fix is to scan the **affected dependency closure**, not just the literal diff: include every module that imports (transitively) the changed modules. Tools that understand the graph (Nx, Bazel, Turborepo, `go list`) can compute that closure. The cheaper, common compromise is "run incremental per-PR for fast feedback, run the *full* scan nightly as a backstop" — so an unsoundness in the incremental scope is caught within a day rather than never. State the unsoundness explicitly; don't pretend incremental is a free lunch.
</details>

**Q26. Should a fitness function block the merge, or just warn on the PR?**

<details><summary>Answer</summary>

For a rule the team has agreed protects the architecture: **block.** A warning that doesn't fail the build is a warning everyone learns to ignore — ten thousand warnings equal zero warnings. The whole reason fitness functions beat code-review comments is that they *can't be politely ignored*; demote them to warnings and you've thrown that away.

The legitimate exception is the **adoption ramp**: a *brand-new* rule on a codebase with unknown violations can run in "warn-only" mode for a sprint to surface the scale of the problem and build a baseline, *then* flip to blocking. But "warn-only" is a temporary state with an end date, not a permanent posture. A permanently non-blocking fitness function is decoration.
</details>

---

## Failure Modes — "Passes but Constrains Nothing"

> The rules that are green for the wrong reason.

**Q27. What is the "passes but constrains nothing" trap?**

<details><summary>Answer</summary>

It's a fitness function that is reliably **green not because the code obeys it, but because the rule never actually checks anything** — so it provides false confidence while guarding nothing. The classic causes:

- **The selector matches zero classes.** A rule on `..service..` when the packages are named `services` (or `svc`) selects an empty set; a rule that asserts something about *nothing* trivially passes.
- **A logically-empty assertion.** `noClasses()...` against a predicate nothing can satisfy, or an `orShould()` chain whose alternative is always true.
- **The scan excludes the offending area.** A madge config that ignores the directory where the cycle actually lives.
- **A reversed forbidden contract.** Source and target swapped, so it forbids the import that never happens and permits the one that does.

In every case the build is green, the dashboard shows a passing rule, and reviewers trust it — but the moment a real violation appears, the rule sails past it. This is *more* dangerous than no rule, because it manufactures confidence. [`find-bug.md`](find-bug.md) is a gallery of these.
</details>

**Q28. How do you prove a fitness function actually fires — that it isn't silently vacuous?**

<details><summary>Answer</summary>

You **test the test**: deliberately introduce the violation the rule is supposed to catch and confirm the rule goes *red*. A fitness function should be born from a failing state — write the rule, watch it fail on a planted bad import, *then* fix the code/rule and watch it go green. If you can't make it fail, it isn't checking what you think.

Beyond that one-time check: assert the selector is non-empty (ArchUnit's `allowEmptyShould(false)`, or an explicit "this rule must match ≥ 1 class" guard), pin the *count* of matched elements for critical rules so a refactor that renames packages and silently empties the selector trips a separate alarm, and review rules in PRs like code. A rule you've never seen fail is a rule you have no evidence works.
</details>

**Q29. ArchUnit's `..service..` matched nothing for a year and nobody noticed. What's the root cause and the systemic fix?**

<details><summary>Answer</summary>

**Root cause:** the package-matching glob (`..service..`) didn't match the real package names (`services`/`svc`), so the rule selected an empty set and "passed" vacuously every run. Nobody noticed because *passing is the expected state* — a green check that's green for the wrong reason looks identical to a green check that's green for the right reason.

**Systemic fix:** (1) configure the tool to **fail on empty selectors** (`allowEmptyShould(false)`) so "matched nothing" becomes red, not green; (2) **planted-violation tests** in CI that confirm each critical rule fires; (3) a **naming fitness function** so package/class names *can't* drift away from what the rules target without their own rule failing. The lesson: a rule's denominator (what it matched) is as important as its numerator (what passed), and the default "empty set passes" is a footgun you should disarm globally.
</details>

**Q30. A reviewer sees an import-linter `forbidden` contract is green. What should they verify before trusting it?**

<details><summary>Answer</summary>

That it's green for the right reason. Check: (1) **`source_modules` and `forbidden_modules` aren't swapped** — a reversed contract forbids the import that never happens; (2) the module *names are real* and current (a typo or a renamed package makes the contract target nothing); (3) the **`root_package`/containers** are set so the modules are actually in scope; (4) the contract isn't shadowed by an `ignore_imports` list that exempts the exact edge it claims to forbid. The fast empirical check is the same as Q28: temporarily add the forbidden import and confirm `lint-imports` exits non-zero. Green is necessary but not sufficient; *green-and-fires-on-a-violation* is the real bar.
</details>

---

## Curveballs

**Q31. "We have 100% test coverage, so we don't need fitness functions." Respond.**

<details><summary>Answer</summary>

Coverage measures how much *behavior* your tests exercise; it says nothing about *structure*. You can have 100% line coverage while the web layer reaches straight into the database, while a cycle ties two modules together, while a God Object swallows ten responsibilities — none of those is a wrong *answer*, so no behavioral test (and no coverage metric) will ever flag them. Coverage and fitness functions protect orthogonal properties: coverage protects "does it compute the right result?", fitness functions protect "is it allowed to be shaped this way?" 100% of one is 0% of the other.
</details>

**Q32. A senior says "fitness functions just ossify the architecture — isn't that the opposite of *evolutionary*?" Respond.**

<details><summary>Answer</summary>

It's the opposite of ossification, properly used. Ossification is a frozen up-front design no one dares change. Fitness functions make change *safe*: because the invariants you care about are guarded by executable checks, you can refactor aggressively and trust the gate to catch the day you accidentally break a boundary. The architecture is *free to evolve* everywhere the rules don't constrain — the rules pin only the handful of properties you've decided are load-bearing. The failure mode the senior fears is real but distinct: *too many, too rigid* rules (especially fuzzy metric thresholds bikeshedded into handcuffs) can over-constrain. The cure is fewer, sharper, well-owned rules — not zero rules. Guarding the boundaries is what lets the interior change.
</details>

**Q33. When is a fitness function *not* worth writing?**

<details><summary>Answer</summary>

When the rule is fuzzy enough that it produces frequent false positives (it trains people to ignore red, which poisons every *other* rule); when the property it checks is already enforced more cheaply by the compiler or language (Go cycles, `internal/` visibility, module boundaries); when the cost to run it can't be brought low enough to gate on and the property doesn't justify a nightly job; or when the "rule" is really a style preference that belongs in a formatter/linter, not an architecture gate. A fitness function earns its place by guarding a *load-bearing structural invariant* cheaply and unambiguously. If it's expensive, ambiguous, or trivial, it's the wrong tool.
</details>

---

## Rapid-Fire / One-Liners

<details><summary>Expand</summary>

- **Fitness function in one line?** An automated test of the code's *shape* that fails the build on structural drift.
- **Behavioral test vs. fitness function?** Output vs. structure; one checks `==`, the other checks "may import."
- **Simplest fitness function?** A forbidden dependency: A must not import B.
- **First rule most teams add?** The no-cycle gate (`madge --circular` / `beFreeOfCycles()`).
- **Java tool?** ArchUnit (a JUnit test over bytecode).
- **Python tool?** import-linter (`lint-imports` over declarative contracts).
- **JS/TS tools?** madge (cycles) and dependency-cruiser (rich rules).
- **Go's free fitness function?** Compiler-enforced no import cycles; `internal/` visibility.
- **240 existing violations — now what?** Baseline them, fail only on *new* ones.
- **A baseline may only…** shrink. Growing it requires a reviewed exception.
- **Where do rules live?** In the repo, next to the code, version-controlled.
- **Who owns rules?** The team that owns the code, guided by architects — not a wall-throwing board.
- **A non-blocking fitness function is…** decoration.
- **"Passes but constrains nothing" cause?** A selector that matches zero classes (vacuous pass).
- **How to trust a green rule?** Plant the violation and confirm it goes red.
- **Fast per-PR, slow…** nightly.
- **Layered contract = …** N forbidden contracts you didn't hand-write.
- **The wrong reflex when a rule fails?** Edit the rule; the right one is to fix the code.

</details>

---

## Summary

- A **fitness function** is an automated test of the code's *structure* that **fails the build on drift**; it complements behavioral tests, which only check output. Green behavioral tests + green fitness functions can still hide decay in shapes no rule covers.
- **Evolutionary architecture** is guided, incremental change made *safe* by fitness functions — they pin the load-bearing invariants so everything else can change freely. The structural rules here are atomic, triggered, static, automated.
- **ArchUnit** (Java, bytecode, fluent test), **import-linter** (Python, declarative contracts), **madge/dependency-cruiser** (JS/TS), and **`go list` + a script** (Go, which already forbids cycles) are the flagship tools — one per language, one CI convention.
- On a real codebase you **baseline** existing violations (freeze the count, fail on new), keep the baseline **shrink-only**, handle **false positives** by narrowing the rule rather than relaxing it, and keep rules **in the repo, owned by the code's team**.
- Enforcement requires a **CI gate** that blocks the merge; make it affordable by **scoping to changed packages, caching the graph, running heavy checks nightly, and parallelizing**.
- Beware the **"passes but constrains nothing" trap** — a rule green because its selector matched nothing, its contract was reversed, or its scan excluded the violation. **Test the test:** plant the violation and confirm it goes red.

---

## Related Topics

- [`junior.md`](junior.md) · [`senior.md`](senior.md) — what a fitness function is → designing a suite for a real codebase.
- [`tasks.md`](tasks.md) — write a layering rule, a layered contract, a no-cycle gate, and a baseline-then-forbid-new script.
- [`find-bug.md`](find-bug.md) — fitness functions that look right but guard nothing.
- [`optimize.md`](optimize.md) — making whole-repo scans fast enough to gate per-PR.
- [Anti-Pattern Budgets & Ratcheting](../02-anti-pattern-budgets-and-ratcheting/interview.md) — the baseline idea generalized: freeze the count and only let it improve.
- [Hotspot Analysis](../03-hotspot-analysis/interview.md) — which part of the codebase deserves a fitness function first.
- [Architecture → Anti-Patterns](../../../../../Architecture/anti-patterns/README.md) — the system-level shapes (Big Ball of Mud) these rules guard against.
