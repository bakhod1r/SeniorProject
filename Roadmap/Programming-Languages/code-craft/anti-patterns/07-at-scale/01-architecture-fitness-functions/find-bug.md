# Architecture Fitness Functions — Find the Bug

> **Category:** [Anti-Patterns at Scale](../README.md) → **Architecture Fitness Functions**
> **Covers (collectively):** Layering & dependency rules · Cycle-detection gates · Allowed-dependency contracts · Metric thresholds · Evolutionary architecture & CI gating

---

This file is **critical-reading practice** with a twist: every snippet is a fitness function that **looks correct and passes CI** — green check, passing test, satisfied dashboard — but **guards nothing.** This is the most dangerous failure mode in the chapter, because a rule that's green for the wrong reason is *worse* than no rule: it manufactures confidence. Reviewers see the passing check and stop looking; the forbidden import sails straight through.

For each snippet, answer three questions:

> **Why does this rule pass even when the architecture is violated? What false confidence does it create? How do you fix it — including how you'd *prove* the fix fires?**

> **How to use this file:** read each snippet and write your own answer *before* expanding the collapsible. The skill you're training is the reviewer's instinct to ask "is this green because the code obeys it, or because the rule checks nothing?" The fast empirical test for every one of these is identical: **plant the violation and see if the build goes red.** If it stays green, the rule is a decoration.

---

## Table of Contents

1. [The rule that matches nothing](#snippet-1--the-rule-that-matches-nothing)
2. [The `orShould` that always passes](#snippet-2--the-orshould-that-always-passes)
3. [The reversed forbidden contract](#snippet-3--the-reversed-forbidden-contract)
4. [The madge config that ignores the cycle](#snippet-4--the-madge-config-that-ignores-the-cycle)
5. [The cycle check that only sees half the repo](#snippet-5--the-cycle-check-that-only-sees-half-the-repo)
6. [The rule that runs but never gates](#snippet-6--the-rule-that-runs-but-never-gates)
7. [The dependency-cruiser rule with no real `from`](#snippet-7--the-dependency-cruiser-rule-with-no-real-from)

---

## Snippet 1 — The rule that matches nothing

```java
// Packages in this codebase are actually: com.shop.services, com.shop.persistence
@ArchTest
static final ArchRule services_must_not_use_persistence =
    noClasses().that().resideInAPackage("..service..")             // singular
        .should().dependOnClassesThat().resideInAPackage("..persistence..");
// Green for two years. The services layer imports persistence helpers all over.
```

> Why does this pass even though `services` imports `persistence` everywhere?

<details>
<summary>Answer</summary>

**Why it passes:** the glob `..service..` matches a package segment named *exactly* `service`. The real package is `services` (plural), so `that().resideInAPackage("..service..")` selects **zero classes**. `noClasses()` over an empty set is **vacuously true** — there are no offending classes because there are no classes *in scope at all*. ArchUnit's default is that an empty `should` set passes, so the rule is green every run, regardless of what `services` actually imports.

**False confidence:** the dashboard shows a passing architecture rule named `services_must_not_use_persistence`. Reviewers and architects read that as "the boundary is enforced." It is not enforced at all — the rule asserts a property of *nothing*. This is strictly worse than having no rule, because the green check actively discourages anyone from checking the boundary by hand.

**Fix:**

```java
@ArchTest
static final ArchRule services_must_not_use_persistence =
    noClasses().that().resideInAPackage("..services..")            // plural — real name
        .should().dependOnClassesThat().resideInAPackage("..persistence..")
        .allowEmptyShould(false)                                    // empty selector => fail
        .because("business logic must not depend on the persistence layer directly");
```

And globally, disarm the footgun for *every* rule:

```properties
# src/test/resources/archunit.properties
archunit.fail.on.empty.should=true
```

**Prove the fix fires:** plant a `services → persistence` import and confirm the rule goes **red**, then remove it. The deeper defense is a **naming fitness function** so package names can't silently drift away from what the rules target. A rule's denominator (what it matched) matters as much as its numerator (what passed).

</details>

---

## Snippet 2 — The `orShould` that always passes

```java
@ArchTest
static final ArchRule web_layer_isolation =
    noClasses().that().resideInAPackage("..web..")
        .should().dependOnClassesThat().resideInAPackage("..db..")
        .orShould().bePublic();          // <-- added to "also allow public classes"
// Author wanted: forbid web->db. Build is always green now.
```

> The author swears this forbids `web → db`. Why is it always green?

<details>
<summary>Answer</summary>

**Why it passes:** the rule reads `noClasses().that(..web..).should(dependOnDb).orShould(bePublic)`. With `noClasses()`, the condition is negated for *every* matched class: the rule asserts that **no** web class "depends on db **OR** is public." A web class violates the rule only if it satisfies the *whole* disjunction's negation — but in practice almost every web class **is public** (controllers, handlers). The `orShould().bePublic()` makes the "bad" condition true for nearly every class via the harmless `bePublic` branch, and ArchUnit's evaluation of `noClasses(...).should(A).orShould(B)` collapses to "no class is (A or B)" — which the author has now made unsatisfiable in the direction they wanted. The net effect is a rule whose violation condition was widened into incoherence, so it never reports the `web → db` edge it was supposed to catch.

The mechanical bug is **chaining an unrelated, almost-always-true predicate with `orShould`**, which dilutes the real assertion until it can't fail. `orShould` is for combining conditions that *together* define "forbidden"; bolting on `bePublic` (a property unrelated to the dependency) turns a precise rule into noise.

**False confidence:** "web layer isolation" is green, so everyone believes web can't reach db. It can — freely.

**Fix — drop the meaningless disjunct; keep the single precise assertion:**

```java
@ArchTest
static final ArchRule web_layer_isolation =
    noClasses().that().resideInAPackage("..web..")
        .should().dependOnClassesThat().resideInAPackage("..db..")
        .because("the web layer must reach the db only through the service/repository layers");
```

If you genuinely need a real exception (say a `..web.config..` wiring package), express it by **narrowing the selector**, not by `orShould`-ing in an unrelated predicate:

```java
noClasses().that().resideInAPackage("..web..")
    .and().resideOutsideOfPackage("..web.config..")
    .should().dependOnClassesThat().resideInAPackage("..db..")
```

**Prove the fix fires:** plant a `web → db` import in a non-config web class and confirm red. The lesson: every `orShould`/`andShould` you add should *tighten* the definition of "forbidden," never widen it with an unrelated property.

</details>

---

## Snippet 3 — The reversed forbidden contract

```ini
# setup.cfg — intent: "the domain layer must not import the web framework"
[importlinter]
root_package = shop

[importlinter:contract:domain-purity]
name = Domain must not import web
type = forbidden
source_modules =
    shop.web
forbidden_modules =
    shop.domain
# lint-imports: 1 kept, 0 broken.  shop.domain imports shop.web in 6 files.
```

> The contract is green. `shop.domain` imports `shop.web` in six files. How?

<details>
<summary>Answer</summary>

**Why it passes:** the `source_modules` and `forbidden_modules` are **swapped relative to the intent**. A `forbidden` contract asserts "`source_modules` must not import `forbidden_modules`." As written, it forbids `shop.web → shop.domain`. But web *legitimately* sits above domain, so web → domain is exactly the import that **doesn't** happen (or happens correctly) — the contract checks an edge that's naturally absent and reports "kept." Meanwhile the edge the author actually cares about, `shop.domain → shop.web`, is never checked, so the six real violations are invisible.

The contract name (`Domain must not import web`) describes the *intended* rule; the config encodes the *opposite* direction. A reviewer reading only the name trusts it; only reading source-vs-forbidden reveals the reversal.

**False confidence:** "domain purity" is green, so the team believes the domain is framework-free. It's importing the web layer in six places — the exact coupling the rule was meant to forbid.

**Fix — put the direction back the way the name says:**

```ini
[importlinter:contract:domain-purity]
name = Domain must not import web
type = forbidden
source_modules =
    shop.domain          # the layer that must stay pure
forbidden_modules =
    shop.web             # the thing it must not reach for
```

Now `lint-imports` exits non-zero and prints the six chains (`shop.domain.order -> shop.web.dto`, …).

**Prove the fix fires:** the six violations already exist, so after the swap the contract should go **red immediately** and name them — that red is your confirmation the direction is now correct. The general guard: for any forbidden/layered contract, sanity-check by asking "which module is supposed to stay clean?" — that module is always `source`, and the thing it must avoid is `forbidden`. When a contract is green, briefly confirm it's green because the edge is absent, not because you're checking the absent direction.

</details>

---

## Snippet 4 — The madge config that ignores the cycle

```json
// .madgerc — "no cycles" gate for the front end
{
  "fileExtensions": ["ts", "tsx"],
  "exclude": "(node_modules|legacy|features/checkout)"
}
```

```yaml
# ci.yml
- run: npx madge --circular src/    # exits 0, build green
```

> `src/features/checkout/cart.ts` and `order.ts` import each other. Why is the gate green?

<details>
<summary>Answer</summary>

**Why it passes:** the `.madgerc` `exclude` regex is `(node_modules|legacy|features/checkout)`. madge applies it to *every* path it walks, so the entire `features/checkout` directory is removed from the graph before cycle detection runs. The `cart.ts ↔ order.ts` cycle lives *inside* `features/checkout`, so it's excluded along with the directory — madge analyzes a graph that no longer contains the cycle and reports "no circular dependency found," exit 0.

Someone almost certainly added `features/checkout` to `exclude` *to make the build green* when the cycle first appeared — "silence the check" instead of "fix the cycle." Now the gate is structurally incapable of seeing the one cycle that exists, and any *new* cycle in checkout is invisible too.

**False confidence:** "no circular dependencies" is green, so the team believes the front-end graph is acyclic. The most coupled module in the app — checkout — is exempt from the only check that would catch its cycles.

**Fix — narrow the exclusion to what legitimately belongs out of scope (vendored/generated code), never the area with the violation:**

```json
{
  "fileExtensions": ["ts", "tsx"],
  "exclude": "(node_modules|\\.d\\.ts$)"
}
```

If checkout genuinely has a cycle you can't fix this sprint, the honest move is a **baseline** (record the known cycle, fail on *new* ones) — not excluding the whole directory from detection forever.

**Prove the fix fires:** with checkout back in scope, `npx madge --circular src/` should now exit non-zero and print `cart.ts > order.ts > cart.ts`. The lesson: an `exclude`/`ignore` that contains the *feature directory with the violation* is the no-cycle gate's equivalent of commenting out the failing test. Excludes are for code that genuinely shouldn't be analyzed (vendored, generated), never for code that's failing.

</details>

---

## Snippet 5 — The cycle check that only sees half the repo

```yaml
# ci.yml — ArchUnit cycle gate, run for speed only on the module that changed
- run: |
    CHANGED=$(git diff --name-only origin/main... | grep -oE 'modules/[^/]+' | sort -u | head -1)
    ./gradlew :${CHANGED##*/}:archTest      # run arch tests ONLY in the first changed module
```

```java
// modules/order/.../CycleTest.java
slices().matching("com.shop.order.(*)..").should().beFreeOfCycles();
// modules/billing has the SAME test, scoped to com.shop.billing.(*)..
```

> A PR introduces a cross-module cycle: `com.shop.order → com.shop.billing → com.shop.order`. CI is green. Why?

<details>
<summary>Answer</summary>

**Why it passes:** two compounding scoping bugs.

1. **Per-module slice scope.** Each module's `CycleTest` only matches slices *within its own package* (`com.shop.order.(*)..`). A cycle that crosses modules (`order ↔ billing`) is a cycle in the *combined* graph, but neither single-module rule has both packages in scope, so neither can see the loop. You need a rule whose slices span `com.shop.(*)..` across both modules.
2. **"First changed module only."** The CI script runs arch tests for just `head -1` of the changed modules. A PR that edits both `order` and `billing` runs the check for one of them, and the cross-module cycle isn't even visible to that one. Worse, a PR that edits only `billing` skips `order`'s tests entirely.

So the cycle is invisible both because no rule's *slice scope* spans the two packages and because the CI *runs only a subset* of the modules' checks.

**False confidence:** the cycle gate is "green," but it's a per-module gate that runs on a subset of modules — it structurally cannot catch the cross-module cycles that are the most dangerous kind (they couple deployable units together).

**Fix — one repo-wide cycle rule, always run:**

```java
// A single top-level test, not per-module:
@AnalyzeClasses(packages = "com.shop")
class RepoWideCycleTest {
    @ArchTest
    static final ArchRule no_cross_module_cycles =
        slices().matching("com.shop.(*)..")   // spans order, billing, everything
            .should().beFreeOfCycles();
}
```

```yaml
# Run the repo-wide cycle gate on EVERY PR, not just the first changed module.
- run: ./gradlew archTest      # the whole arch suite, every time
```

If the full suite is too slow to run every PR, the answer is to make *it* faster (cache the class graph, parallelize — see [`optimize.md`](optimize.md)), **not** to run a correctness-critical gate on a subset. An incremental scan must still cover the *affected dependency closure*, never an arbitrary "first changed module."

**Prove the fix fires:** the cross-module cycle already exists in the PR, so the repo-wide rule should go **red** and name `Slice order -> Slice billing -> Slice order`. The lesson: scoping a fitness function for *speed* must never silently shrink its *coverage* — a gate that only inspects part of the graph misses exactly the integration-level violations it's most important to catch.

</details>

---

## Snippet 6 — The rule that runs but never gates

```java
@ArchTest
static final ArchRule no_field_injection =
    fields().that().areAnnotatedWith(Autowired.class)
        .should().bePrivate()   // intent: discourage field injection patterns
        .because("prefer constructor injection");
```

```yaml
# ci.yml
- run: ./gradlew test || true      # <-- never fails the job
- run: echo "tests done"
```

> The ArchUnit rule itself is correct. Why does it still enforce nothing?

<details>
<summary>Answer</summary>

**Why it "passes":** the *rule* is fine, but it's not a **gate**. The CI step runs `./gradlew test || true` — the `|| true` swallows the non-zero exit code, so even when ArchUnit (and every other test) fails, the step exits 0 and the job is green. A fitness function only bites if a failure **blocks the merge**; here a failing rule produces red text in the log and a green check on the PR. Nobody reads the log when the check is green.

This is the most common operational failure: a perfectly good rule wired into a pipeline that can't fail. Variants include putting arch tests on a non-required CI job, in an `allow_failure: true` stage, or as a warning-only linter step.

**False confidence:** the team "has" an architecture rule. The merge button never cares about it. It's a wiki rule with extra YAML.

**Fix — let the failure propagate and make the job required:**

```yaml
# ci.yml
- run: ./gradlew test          # no `|| true`; a failing test fails the job
```

Then mark the job a **required status check** in branch protection so a red result actually blocks merge. The whole value of a fitness function — "a machine enforces this identically on every commit, no fatigue, no exceptions" — depends on the failure being un-ignorable.

**Prove the fix fires:** introduce a `@Autowired` field that's not private, confirm the *job* goes red (not just a log line), and confirm the PR's merge button is blocked. The lesson: a fitness function that *runs* but doesn't *gate* enforces nothing. Either it can fail the build, or it isn't enforcement.

</details>

---

## Snippet 7 — The dependency-cruiser rule with no real `from`

```js
// .dependency-cruiser.js — "infra must not be imported by domain"
module.exports = {
  forbidden: [
    {
      name: 'domain-not-infra',
      severity: 'error',
      from: {},                              // <-- empty
      to: { path: '^src/infra' }
    }
  ]
};
// npx depcruise src --config .dependency-cruiser.js  => 0 errors, green.
// src/domain/order.ts imports src/infra/db.ts.
```

> Domain imports infra, but the rule reports no errors. Why?

<details>
<summary>Answer</summary>

**Why it passes:** in dependency-cruiser a `forbidden` rule flags a dependency whose *source* matches `from` **and** whose *target* matches `to`. An **empty `from: {}`** doesn't mean "from anything" in the way the author hoped here — combined with the missing path constraint, the rule fails to bind to the `domain` source it was meant to police. The author intended "from `src/domain` to `src/infra`," but only filled in `to`. With `from` unconstrained-but-unscoped, the rule doesn't match the `domain → infra` edge as a *forbidden* pair the way a properly-scoped rule would, and depcruise reports zero errors. (The reliable, intended form always names *both* ends.)

The bug is a **half-written rule**: the `to` (target) is specified, the `from` (source) is left blank. It looks complete at a glance — there's a `to`, a `severity: error`, a name — but the source selector that makes it actually forbid `domain → infra` is missing.

**False confidence:** `domain-not-infra` with `severity: error` reads like a hard boundary. The exact import it names is happening and not flagged.

**Fix — specify both ends explicitly:**

```js
module.exports = {
  forbidden: [
    {
      name: 'domain-not-infra',
      comment: 'domain must depend on abstractions, never on the infra layer',
      severity: 'error',
      from: { path: '^src/domain' },         // the layer that must stay clean
      to:   { path: '^src/infra' }           // the thing it must not import
    }
  ]
};
```

**Prove the fix fires:** `src/domain/order.ts → src/infra/db.ts` already exists, so `npx depcruise src` should now report it as an error and exit non-zero. The lesson — the same one as the reversed import-linter contract (Snippet 3): every forbidden-edge rule has a *source* and a *target*, and a rule that leaves one end blank or swapped checks an edge nobody is crossing. Always confirm both ends name the real packages, and confirm the rule reports the violation you already know exists.

</details>

---

## The Common Thread

Every snippet here is green for the *wrong reason*, and the failure falls into one of four buckets:

| Failure mode | Snippet(s) | The tell |
|---|---|---|
| **Empty / wrong selector** (vacuous pass) | 1 | A glob/path that matches zero classes; `noClasses()` over nothing is always true. |
| **Diluted / reversed assertion** | 2, 3, 7 | `orShould` widening "forbidden"; source↔target swapped; one end of the edge left blank. |
| **Scoped-out violation** | 4, 5 | An `exclude` or per-module/first-changed scope that removes the offending area from the graph. |
| **Runs but doesn't gate** | 6 | `\|\| true`, non-required job, warning-only — the failure can't block the merge. |

The single reviewer's instinct that catches all four: **"is this rule green because the code obeys it, or because the rule checks nothing?"** And the single empirical answer: **plant the violation and watch for red.** A fitness function you've never seen fail is a fitness function you have no evidence works — every critical rule should be *born from a failing planted violation*, then made green by fixing the code, not by weakening the rule.

---

## Summary

- The worst fitness-function bug isn't a crash — it's a rule that **passes while guarding nothing**, because a green-for-the-wrong-reason check manufactures false confidence and stops people from checking by hand.
- **Vacuous passes** come from selectors that match zero classes (a `service`/`services` typo). Disarm them globally — make empty selectors **fail** (`archunit.fail.on.empty.should=true`) and add a **naming rule** so selectors can't drift.
- **Diluted or reversed assertions** — `orShould` widening "forbidden," a swapped `source`/`forbidden` contract, a `from`/`to` with one end blank — check an edge nobody crosses. Every forbidden-edge rule must name *both* real ends.
- **Scoped-out violations** — an `exclude` covering the feature with the cycle, a per-module slice that can't span a cross-module cycle, a "first changed module only" CI step — shrink coverage in the name of silence or speed. Scope for speed must never shrink correctness; use a baseline, not an exclude.
- **Runs but doesn't gate** — `|| true`, a non-required job, warning-only — means the failure can't block the merge, so the rule is decoration. A fitness function that can't fail the build isn't enforcement.
- The universal check for all of these: **plant the violation and confirm the build goes red.** A rule you've never seen fail has no evidence it works.

---

## Related Topics

- [`tasks.md`](tasks.md) — build the *correct* versions of these rules (and Exercise 5 is exactly "prove a rule fires").
- [`junior.md`](junior.md) · [`senior.md`](senior.md) — the concept → designing and maintaining a real suite.
- [`optimize.md`](optimize.md) — how to scope for speed *without* the Snippet 4/5 coverage bug.
- [`interview.md`](interview.md) — the "passes but constrains nothing" trap as an interview topic.
- [Anti-Pattern Budgets & Ratcheting](../02-anti-pattern-budgets-and-ratcheting/find-bug.md) — baselines done wrong: the landfill that only ever grows.
- [Hotspot Analysis](../03-hotspot-analysis/find-bug.md) — misreading the signal that tells you where to aim a rule.
- [Architecture → Anti-Patterns](../../../../../Architecture/anti-patterns/README.md) — the system-level shapes these rules are meant to guard against.
