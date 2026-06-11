# Codemods & AST Transforms — Optimize

> **Source:** Facebook jscodeshift; OpenRewrite docs; Instagram/Meta LibCST

Six repo-wide change requests. For each, the senior decision isn't just "write a codemod" — it's *whether* to, *which tool*, and *how to keep it safe*. Some of these should be codemods; some should explicitly **not** be (use the IDE or do it by hand). Read the request, decide the approach, then check the analysis.

---

## Scenario 1 — Rename an internal API method used in 380 files

> "We renamed `EventBus.emit()` to `EventBus.publish()`. It's called everywhere. Migrate the whole monorepo."

**Decision: codemod, type-aware.**

`emit` is a common method name — `EventEmitter.emit`, `process.emit`, stream `.emit` all exist. A name-only matcher would clobber them. This needs the receiver's type resolved to *your* `EventBus`.

- **TS:** ts-morph — resolve `prop.getExpression().getType().getSymbol()?.getName() === "EventBus"` before renaming (like Tasks §4).
- **Java:** OpenRewrite with a fully-qualified `MethodMatcher("com.acme.EventBus emit(..)")`.

**Optimize the run:** grep `-l "\.emit"` first to get candidate files (~380 of 50k), and only type-check/transform those — but feed them to one shared type-checked program, not per-file. Shard the resulting PRs by team for review. Add a CI dry-run gate afterward so `EventBus.emit` can't reappear.

> The trap here is reaching for the fast syntactic matcher because it's easier; the method-name ambiguity makes that unsafe. Pay for type-awareness — it's exactly the case that justifies the cost.

---

## Scenario 2 — Fix a typo in a constant string across the codebase

> "We misspelled a feature-flag key as `"enbaled_checkout"` in ~40 files. Fix it to `"enabled_checkout"`."

**Decision: NOT an AST codemod. Use a regex / `sed` (or your IDE's find-in-files).**

This is a *text* change, not a code-meaning change. The target is a string literal whose *content* is wrong — there's no scope, type, or structure involved. An AST codemod here is over-engineering: you'd parse every file to do what `sed -i 's/enbaled_checkout/enabled_checkout/g'` does instantly. The string is distinctive enough (a misspelling) that there's near-zero risk of a false match.

> The principle (junior §6 / §8): AST transforms earn their cost when correctness depends on *what the code means*. When you're literally fixing the *text* of a unique string, the simpler tool is the right tool. Reserve codemods for semantic changes.

---

## Scenario 3 — Migrate `console.log` to a structured logger, but only in `src/`, not tests

> "Replace `console.log(...)` with `logger.info(...)` in production code. Tests should keep using `console.log`."

**Decision: codemod, scoped by path, lossless, idempotent.**

The transform is the junior.md example. The optimizations are operational:

- **Scope the file set:** run on `src/` with `--ignore-pattern="**/*.test.*"` — don't transform (or even parse) test files. Path scoping is cleaner and faster than an in-codemod "am I a test file?" check.
- **Lossless printer** (jscodeshift/recast) so the diff is just the `console.log → logger.info` lines and reviewable across all files.
- **Idempotent by nature** (no `console.log` left after run 1), so the CI gate (`--dry`, fail if non-empty) becomes a permanent invariant banning `console.log` in `src/`.
- **Add the `logger` import** where missing — and dedup it (don't stack duplicate imports on rerun).

> The performance win is *not parsing files you'll discard*. Path-scoping at the runner level beats matching-then-skipping inside the transform.

---

## Scenario 4 — Replace one O(n²) hot loop with a hash-map lookup in ~12 places

> "We have a quadratic `findMatch` loop pattern duplicated in about 12 services. Replace each with the map-based version."

**Decision: NOT a codemod. Do it by hand (or IDE-assisted), per site.**

Although it's "the same pattern in 12 places," each instance differs in the surrounding code — the keys, the data shapes, what's done with the match, error handling. Building the map correctly requires *understanding each call site*. This is the "needs human judgment per site" case (junior §8): the rule isn't mechanical, so there's no safe single transform. A codemod that tried would either be so generic it's wrong, or so specific it only handles one of the twelve.

> Twelve thoughtful manual edits, each reviewed, beat one codemod that produces twelve subtly-wrong rewrites. Codemods are for *mechanical* changes; algorithmic improvement is not mechanical. (For the actual optimization technique, see the `hash-table-design` and `big-o-analysis` skills.)

---

## Scenario 5 — Upgrade JUnit 4 → JUnit 5 across a 600-module Java monorepo

> "Migrate all test files from JUnit 4 to JUnit 5: annotations, assertions, runners, the lot."

**Decision: codemod — but REUSE OpenRewrite's published recipe, don't build.**

This is the textbook reuse-first case (senior §5). OpenRewrite ships `org.openrewrite.java.testing.junit5.JUnit4to5Migration`, run across the entire OSS Java ecosystem, which already handles the long tail: `@Before` → `@BeforeEach`, `@Test(expected=...)` → `assertThrows`, `@RunWith` → `@ExtendWith`, parameterized tests, rule migrations. Your hand-rolled version would rediscover every one of those edge cases in production.

```bash
mvn org.openrewrite.maven:rewrite-maven-plugin:run \
  -Drewrite.activeRecipes=org.openrewrite.java.testing.junit5.JUnit4to5Migration
```

**Optimize the rollout:** run per-module (OpenRewrite caches the LST), shard PRs by owning team, gate each on a green test run. If your codebase has a *bespoke* test helper the recipe doesn't know, **compose**: run the published recipe, then a small custom recipe for your gap.

> Building this from scratch is the anti-pattern. The optimization is *not writing the codemod at all* — use the maintained one and spend your effort only on the company-specific delta.

---

## Scenario 6 — A CI codemod gate is taking 4 minutes on every PR

> "Our OpenRewrite `dryRun` that enforces 'no deprecated API' runs on every PR and adds 4 minutes. People are angry."

**Decision: don't optimize the codemod — move the *gate* to a cheaper tool; keep the codemod for the one-shot fix.**

A whole-project type-attributed parse on every PR is the wrong thing on the critical path. Two moves:

1. **Express the *check* as a lint rule** (an ESLint rule / a Checkstyle/PMD rule / a Semgrep pattern) that catches the deprecated API in ~200ms without a full project parse. The lint rule is the fast gate; it just needs to *detect*, not transform.
2. **Keep the OpenRewrite recipe** for the *fix* — run it when the lint rule fires, or on a schedule, not on every PR. The codemod's job is migration; the lint's job is the fast guardrail.

If you must keep the codemod gate, optimize it: run only on changed files (not the whole tree), cache the LST between runs, and parallelize modules. But the bigger win is recognizing that *detection* and *transformation* are different jobs with different cost budgets — put the cheap one on the hot path.

> Professional §1's "Job A vs Job B" distinction in action: one-shot apply (heavy, occasional) vs. continuous gate (must be cheap). Conflating them is what put a 4-minute parse on every PR.

---

### Decision checklist for any repo-wide change

1. **Is the change semantic or textual?** Textual → regex/Comby/IDE. Semantic → AST codemod.
2. **Is it mechanical, or does each site need judgment?** Judgment → manual/IDE, not a codemod.
3. **Does a published codemod already exist?** Yes → reuse (compose for the gap). No → build.
4. **Does the matcher need types?** Ambiguous name → type-aware (ts-morph/OpenRewrite). Unambiguous → fast syntactic.
5. **One-shot apply, or continuous gate?** Gate must be cheap (lint), apply can be heavy (codemod).
6. **Scoped, lossless, idempotent, tested?** All four before you trust it on the repo.
