# Automated Large-Scale Refactoring — Interview Questions

> **Category:** [Anti-Patterns at Scale](../README.md) → **Automated Large-Scale Refactoring**
> **Covers (collectively):** Codemods & AST transforms · Type-aware rewrites · Pattern tools (Comby, Semgrep, gofmt -r) · Idempotency & verification · Landing huge mechanical diffs

A bank of 35+ interview questions on applying one transform mechanically across thousands of files. The answers model the reasoning a strong staff-level candidate gives — including when *not* to automate. Use the `<details>` toggles to self-quiz: read the question, answer out loud, then expand.

---

## Table of Contents

1. [Fundamentals — Why Codemods, Not `sed`](#fundamentals--why-codemods-not-sed)
2. [AST vs Text vs Type-Aware](#ast-vs-text-vs-type-aware)
3. [Idempotency & Determinism](#idempotency--determinism)
4. [Testing & Verifying a Codemod](#testing--verifying-a-codemod)
5. [Tooling — Comby, Semgrep, jscodeshift, OpenRewrite, gofmt -r](#tooling--comby-semgrep-jscodeshift-openrewrite-gofmt--r)
6. [Landing the Diff — Review, Rollout, Rollback](#landing-the-diff--review-rollout-rollback)
7. [Curveballs](#curveballs)
8. [Rapid-Fire / One-Liners](#rapid-fire--one-liners)
9. [Summary](#summary)
10. [Related Topics](#related-topics)

---

## Fundamentals — Why Codemods, Not `sed`

> When the change is mechanical but spans hundreds of files, the question is never "can I do it by hand" — it's "what tool understands the code well enough to do it safely."

**Q1. What is a "codemod," and when do you reach for one instead of editing files by hand?**

<details><summary>Answer</summary>

A *codemod* is a program that rewrites source code programmatically — it parses your code into a structured representation (usually an AST), transforms that structure, and prints it back out. The term comes from Facebook's [jscodeshift](https://github.com/facebook/jscodeshift) toolkit.

You reach for one when a change is **mechanical and repetitive across many files**: renaming an API, migrating a deprecated call signature, adding a required argument, swapping an import. The break-even is low — even a 30-file change is often faster to codemod than to hand-edit, because the codemod is *reviewable*, *re-runnable*, and *self-documenting* (the transform itself is the spec for "what changed and why"). Hand edits scale linearly with files and have a per-file chance of a typo; a codemod has a fixed cost and a uniform result.

The anti-pattern this prevents is the **half-finished migration**: someone renames `getUser` to `fetchUser` in the 40 files they remember, ships it, and leaves 60 stragglers that rot until the next person trips over them.
</details>

**Q2. Why is `sed`/regex on source code dangerous? Give a concrete failure.**

<details><summary>Answer</summary>

`sed` and regex operate on **text**, not on **code structure**. They have no concept of strings, comments, scope, types, or nesting — so they match things that *look like* code but aren't, and they fail to match code that's spread across lines.

Concrete failure — renaming the method `total()` to `subtotal()`:

```bash
sed -i 's/\.total(/.subtotal(/g' **/*.js
```

This corrupts:
- `// returns the .total()` — a comment that documents the *old* name.
- `log("order .total() failed")` — a string literal mentioning the call.
- `account.total()` — a *different* type's `total()` that you didn't mean to touch.

And it misses:
```js
order
  .total()   // the dot and call are on different lines — depends on the regex
```

Regex sees characters; it cannot tell a method call on the receiver you care about from an identical substring inside a docstring. An AST tool can, because the parser already classified each token.
</details>

**Q3. Is regex *ever* acceptable for a code-wide change?**

<details><summary>Answer</summary>

Yes, in two situations:

1. **The artifact isn't a programming language with rich structure** — version strings in YAML, a license header, a copyright year. There's no AST that would help.
2. **You've bounded the blast radius and you verify after.** A one-line `sed` to bump `"version": "1.2.3"` in `package.json` files is fine because you can eyeball every hit (`grep` first, count them, then apply) and the build catches a mistake immediately.

The rule: regex is acceptable when the match is *unambiguous in text* and the cost of a wrong hit is *caught instantly*. The moment you're matching an identifier that could appear in a string, comment, or unrelated scope, switch to an AST or pattern tool. "I'll just be careful with the regex" is how the corrupted-comment bug ships.
</details>

**Q4. What's the difference between a *syntactic* and a *semantic* transform?**

<details><summary>Answer</summary>

- A **syntactic** transform reasons about the shape of the code: "find a call expression whose callee is `foo` and whose first argument is a literal." It works on the AST but has no knowledge of *what `foo` refers to* — it can't tell two different `foo`s apart if they look the same.
- A **semantic** (type-aware) transform additionally knows **what each name resolves to**: which declaration, which type, which overload. "Find calls to `foo` *where the receiver is of type `LegacyClient`*."

Most codemod tools (jscodeshift, Comby, Semgrep) are primarily syntactic. Type-aware tools (ts-morph with the TypeScript checker, OpenRewrite, IDE refactorings) resolve symbols. The difference matters the instant the same identifier means two things in your codebase — a rename that's safe syntactically can be catastrophically wrong semantically.
</details>

**Q5. A junior says "I'll just write a codemod" for *every* repetitive edit. When is that the wrong call?**

<details><summary>Answer</summary>

Automate when the transform is **uniform and the file count justifies the authoring cost**. Don't automate when:

- **The change isn't uniform** — each site needs human judgment about the surrounding logic. A codemod that's right 80% of the time and wrong 20% produces a diff where reviewers can't trust *any* hunk, which is worse than no automation.
- **It's a one-off in five files.** Writing, testing, and reviewing the codemod costs more than the edit.
- **The transform can't be made safe** — e.g. it depends on runtime behavior the AST can't see. Better to do it by hand with tests than to ship a confidently-wrong mass diff.

The decision is `authoring_cost + review_cost(automated)` vs `n × per_file_cost(manual)`, weighted by the *uniformity* of the change. Low uniformity kills the automation case even at high `n`.
</details>

---

## AST vs Text vs Type-Aware

**Q6. Walk me through the pipeline of an AST-based codemod.**

<details><summary>Answer</summary>

1. **Parse** each source file into an Abstract Syntax Tree — nodes for declarations, calls, literals, etc. A good codemod tool preserves *trivia* (comments, whitespace) so the output isn't reformatted wholesale.
2. **Query / traverse** the tree to find target nodes (e.g. all `CallExpression` nodes with callee `Identifier` named `oldName`).
3. **Transform** matched nodes — rewrite, wrap, replace, or remove them. You mutate the tree, not the text.
4. **Print** the tree back to source, ideally re-emitting only the changed regions so unrelated formatting is untouched.
5. **Format** with the project's formatter (Prettier, gofmt, google-java-format) as a separate pass, so the diff is minimal and consistent.

The key property: because you're editing structure, you cannot accidentally hit a string, a comment, or a same-named identifier in a scope you didn't query.
</details>

**Q7. What is a CST, and why do some tools use one instead of an AST?**

<details><summary>Answer</summary>

An **AST** (Abstract Syntax Tree) drops "irrelevant" tokens — parentheses, commas, whitespace, often comments — because they don't affect semantics. A **CST** (Concrete Syntax Tree) keeps *everything*, including trivia, so it can reproduce the source byte-for-byte.

Codemod tools lean toward CST-like representations (jscodeshift uses recast/ast-types with attached trivia; ts-morph wraps the TS compiler's tree which retains trivia) because **a refactoring tool must not destroy formatting and comments it didn't intend to touch.** If your tool emits from a pure AST, every transformed file gets reformatted top to bottom — a 3-line logical change becomes a 300-line diff, and reviewers can't see the real edit. Preserving trivia is what makes a mass diff reviewable.
</details>

**Q8. Explain OpenRewrite's LST and why it's "type-aware."**

<details><summary>Answer</summary>

[OpenRewrite](https://docs.openrewrite.org/) parses Java (and other JVM languages) into a **Lossless Semantic Tree (LST)**. "Lossless" = it round-trips to the exact original source (trivia preserved). "Semantic" = each node is **attributed with type information** — every method invocation knows the fully-qualified type it's called on, every variable knows its declared type, every reference is resolved to its declaration.

That attribution is what makes recipes precise. A recipe like `ChangeMethodName` can say "rename `org.legacy.Client foo()` to `bar()`" and it will rewrite *only* calls where the receiver's resolved type is `org.legacy.Client` — leaving every other `foo()` in the codebase alone. A syntactic tool can't do that; it would rename all `foo()` calls and corrupt the unrelated ones. The cost is that producing the LST requires a *compilable* project with classpath/dependencies resolved — type information has to come from somewhere.
</details>

**Q9. ts-morph vs jscodeshift — when does the type-awareness of ts-morph actually matter?**

<details><summary>Answer</summary>

[jscodeshift](https://github.com/facebook/jscodeshift) is syntactic: it queries the AST. [ts-morph](https://ts-morph.com/) wraps the TypeScript *compiler*, so it can ask the type checker "what type is this expression?" and "where is this symbol declared?"

Type-awareness matters whenever the *name alone is ambiguous*:

- Renaming a method `save()` **on one class** when other classes also have `save()`. Syntactic: renames all `save()` calls. Type-aware: filter to calls whose receiver type is the target class.
- Renaming a symbol and **all its references across files**, following imports/re-exports correctly. ts-morph's `renameNode` uses the language service's find-all-references — the same engine as the IDE's "Rename Symbol" — so it follows the binding, not the spelling.
- Distinguishing a local shadow from the imported function of the same name.

If your transform targets a *uniquely-named* symbol, jscodeshift is plenty and faster to write. The instant the name collides with anything, reach for the checker.
</details>

**Q10. Comby claims to be "language-aware" without a full parser. What does that mean?**

<details><summary>Answer</summary>

[Comby](https://comby.dev/) is **structural search-and-replace**. It doesn't build a full typed AST; instead it understands the *balanced-delimiter* structure of mainstream languages — parentheses, brackets, braces, strings, and comments. Its match holes (`:[name]`) bind to balanced spans, so `foo(:[args])` matches `foo(a, g(b, c), d)` correctly because Comby knows the inner `)` belongs to `g(`, and it won't match `foo(` text inside a string or comment because it recognizes those lexical regions.

This puts Comby between regex and a full codemod: far safer than `sed` (it respects nesting, strings, and comments), far lighter to author than jscodeshift (a one-line pattern, no traversal code), but **not semantic** — it can't resolve types or tell two same-named identifiers apart. It's the sweet spot for "structurally simple, syntactically uniform" rewrites across many languages with one tool.
</details>

---

## Idempotency & Determinism

**Q11. What does it mean for a codemod to be *idempotent*, and why must it be?**

<details><summary>Answer</summary>

A transform `T` is idempotent if `T(T(x)) == T(x)` — running it a second time changes nothing. Equivalently: the *output* of the transform does not match the transform's own *input pattern*.

It must be idempotent because at scale you *will* run it more than once: on a merge that re-introduced old code, on a branch that was forked before the migration, in a CI check that re-applies it to confirm there's nothing left to do, or simply because someone re-ran the command. A non-idempotent codemod double-applies — `wrap(x)` becomes `wrap(wrap(x))`, an argument gets added twice, an import gets duplicated — silently corrupting files that were already correct.

The discipline: **match the "before" state, not the "after" state**, and ensure the "after" state is *not* a "before" state. If the transform adds `await`, it must skip calls that are already awaited. The cleanest idempotent codemods are written so that the output is a fixed point of their own matcher.
</details>

**Q12. How do you make "add a `ctx` first argument to all calls to `Query`" idempotent?**

<details><summary>Answer</summary>

Match only calls that **don't already have `ctx` as the first argument**. Syntactically, guard the transform on the shape of the existing argument list:

- If the first argument node is an identifier named `ctx` (or, type-aware, *of type* `context.Context`), skip — it's already migrated.
- Otherwise insert `ctx` at position 0.

The second run finds every call already starting with `ctx`, matches nothing, and is a no-op. The failure mode you're designing against is `Query(ctx, ctx, sql)` after two runs. A good test for this is literally to **run the codemod twice in the test and assert the second run produces an empty diff** — that single assertion is the strongest idempotency check you can write.
</details>

**Q13. Why does *deterministic output* matter, and what breaks it?**

<details><summary>Answer</summary>

Deterministic = same input always yields byte-identical output, regardless of machine, run order, or thread scheduling. It matters because:

- **Reviewability:** if the diff changes between runs, reviewers can't trust that what they reviewed is what lands, and CI "re-apply, expect empty diff" checks become flaky.
- **Caching/parallelism:** non-determinism breaks build caches and makes parallel sharded runs irreproducible.

Common determinism killers:
- **Iterating an unordered set/map** of files or AST nodes (Go map iteration order, Python `set`, JS object key order in older engines) — sort the collection first.
- **Concurrency** that interleaves edits or writes to shared state.
- **Timestamps, random IDs, or `Date.now()`** baked into generated code.
- **Formatter version drift** — pin the formatter and run it as the *last* deterministic pass.

The fix is to make every ordering explicit (sort files, sort matches) and pull all nondeterministic inputs out of the transform.
</details>

**Q14. A teammate's codemod produces a different diff each run, even on the same files. Where do you look?**

<details><summary>Answer</summary>

In priority order:

1. **Unordered iteration.** Is it walking a hash map / set of files or nodes? In Go especially, `for f := range fileMap` is randomized by design. Sort the keys.
2. **Concurrency.** Are workers writing to a shared AST, import set, or output buffer without ordering? Collect results and apply them in a deterministic order.
3. **Formatting pass.** Is the formatter version unpinned, or is the codemod's own printer emitting in source-position order in one run and traversal order in another?
4. **Set-based dedup of imports/symbols** that then get emitted in iteration order.

The quickest diagnostic: run twice, `diff` the two outputs, and look at *what* moved — reordered imports point at a set; reordered files point at a map walk; reformatted whitespace points at the printer/formatter.
</details>

---

## Testing & Verifying a Codemod

**Q15. How do you *test* a codemod itself?**

<details><summary>Answer</summary>

With **fixture (snapshot) tests**: pairs of `input` and `expected-output` files. The test runs the transform on `input` and asserts the result equals `expected`. jscodeshift ships this pattern (`testUtils`); OpenRewrite recipes use `rewriteRun` with before/after source pairs.

A solid suite covers:
- **Happy path** — the canonical case the codemod targets.
- **Already-migrated input** → asserts an *empty diff* (this is your idempotency test).
- **Near-misses that must NOT change** — the same identifier inside a string, a comment, a different scope, a shadowed variable, a same-named method on another type.
- **Structural edge cases** — multi-line calls, nested calls, trailing commas, the target as the last statement.
- **Trivia preservation** — a case with comments and specific formatting, asserting they survive.

The "must-not-change" cases are the most valuable: they're exactly the false-positive corruptions that regex codemods ship. A codemod with only happy-path tests is untested where it counts.
</details>

**Q16. Beyond fixture tests, how do you verify the transform was correct across 5,000 real files?**

<details><summary>Answer</summary>

Layered verification, cheapest first:

1. **It still parses / compiles.** The strongest cheap signal: `tsc --noEmit`, `go build ./...`, `mvn compile`, `python -m compileall`. A codemod that produces unparseable output fails here on file one.
2. **Idempotency check:** re-run the codemod on the output; assert an empty diff. If the second run changes anything, the transform is non-idempotent or missed cases.
3. **The test suite stays green.** Behavior preservation. A pure-refactor codemod should change *no* test outcomes.
4. **Diff-shape sanity:** the diff should be *uniform*. Spot-check by sampling — `git diff` a random 20 files. If most hunks look identical and a few don't, the few are your bugs. Outliers in a mechanical diff are the signal.
5. **Static analysis / linters** as before/after invariants — no new lint errors introduced.

The mental model: you can't read 5,000 files, so you rely on *machine-checkable invariants* (parses, idempotent, tests green) plus *sampling* of the human-readable diff.
</details>

**Q17. What's a "characterization" or "golden" run, and how does it help verify a mass refactor?**

<details><summary>Answer</summary>

You capture the program's observable output *before* the refactor (a golden snapshot — API responses, generated artifacts, a serialized output of a representative workload) and compare it to the output *after*. For a behavior-preserving refactor, the golden output must be identical. It catches semantic changes that compile and pass thin unit tests but alter behavior — the class of bug where a codemod technically "worked" syntactically but changed meaning.

At scale this is often cheaper and more trustworthy than trying to read the diff: you don't care *how* the code changed, only that the system still produces the same answers. Pair it with a coverage check so you know the golden workload actually exercises the changed paths.
</details>

**Q18. Why run the project's formatter as a separate, final pass instead of formatting inside the codemod?**

<details><summary>Answer</summary>

Separation of concerns keeps the diff honest. If the codemod both rewrites and reformats, you can't tell which lines changed *because of the transform* and which changed *because of formatting* — the review signal drowns. By making the transform emit minimal edits and running `prettier` / `gofmt` / `google-java-format` as the last step:

- The formatting pass is **idempotent and deterministic** on its own, so re-running is safe.
- Reviewers can review the *logical* change; formatting noise is uniform and ignorable (or done in a separate commit).
- You pin one formatter version for the whole repo, so the codemod isn't coupled to formatter behavior.

A common pattern is two commits: one with the raw transform, one with `formatter --write .` — so reviewers can read the first and trust the second.
</details>

---

## Tooling — Comby, Semgrep, jscodeshift, OpenRewrite, gofmt -r

**Q19. Compare Comby, Semgrep autofix, and jscodeshift. When do you pick each?**

<details><summary>Answer</summary>

| Tool | Model | Author cost | Power ceiling | Pick it when |
|------|-------|-------------|---------------|--------------|
| **Comby** | Structural match/replace (balanced delimiters, lexically aware) | Very low — a one-line pattern | Syntactic only; no symbol resolution | The rewrite is structurally simple and uniform, across many languages, and you don't need types |
| **Semgrep** (autofix) | Pattern match with metavariables + `fix:` | Low — a YAML rule | Syntactic, with some flow analysis; lighter than a real checker | You already lint with Semgrep and want the *fix* shipped alongside the *detection* |
| **jscodeshift** | Full JS/TS AST traversal in code | High — you write a transform program | Arbitrary syntactic logic; type-aware only via ts-morph | The transform needs real logic (conditional rewrites, multi-step edits) the pattern tools can't express |

The progression is **regex → Comby/Semgrep → jscodeshift/ts-morph/OpenRewrite** by increasing power and authoring cost. Start at the lowest rung that's *safe* for your change: don't write a 200-line jscodeshift transform for what one Comby line does correctly, and don't force a Comby pattern to do something that needs type resolution.
</details>

**Q20. How does Semgrep's autofix work, and what's its limitation versus OpenRewrite?**

<details><summary>Answer</summary>

A [Semgrep](https://semgrep.dev/) rule has a `pattern` (with metavariables like `$X`) and an optional `fix:` template. When the pattern matches, Semgrep substitutes the captured metavariables into the fix and replaces the matched range. Example:

```yaml
rules:
  - id: use-strict-equality
    pattern: $A == $B
    fix: $A === $B
    languages: [javascript]
```

Its strength is the unified detect-and-fix workflow and a huge rule ecosystem. Its limitation vs OpenRewrite: Semgrep is **fundamentally syntactic with limited semantic analysis** — it doesn't carry full resolved type information for arbitrary expressions, and the fix is a text-template substitution into a matched range, not a tree edit. So it can't reliably do "rename this method only on type `Foo`," and a careless `fix:` can produce invalid syntax that Semgrep won't catch for you. OpenRewrite's LST gives type-attributed nodes and guarantees a parseable result, at the cost of needing a compilable project.
</details>

**Q21. What does `gofmt -r` do, and what are its limits?**

<details><summary>Answer</summary>

`gofmt -r 'pattern -> replacement'` is Go's built-in **rewrite rule** engine. It operates on the Go AST, so it's syntax-aware (won't touch strings/comments) and matches with single-letter wildcards that bind to expressions:

```bash
gofmt -r 'a[b:len(a)] -> a[b:]' -w ./...
```

Here `a` and `b` are wildcards binding to any expression; the rule rewrites the verbose slice to the idiomatic form everywhere. Limits:
- **Expression/statement-level only.** It matches single AST expressions/statements, not multi-statement structures or whole declarations.
- **Syntactic, not type-aware.** Wildcards match by shape; there's no "only where `a` is a `[]byte`."
- **No conditional logic** — it's a pure pattern→pattern rewrite, no "if/then."

For anything beyond a single-expression shape change you use `go fix` (versioned migration tool) or a real AST program with `go/ast` and `go/types` (the latter adds the type information `gofmt -r` lacks).
</details>

**Q22. What is `go fix` and how is it different from `gofmt -r`?**

<details><summary>Answer</summary>

`go fix` runs a set of **named, versioned migration "fixes"** that update code for changes in the Go standard library and language across versions — historically things like API moves between releases. It's a curated migration tool: the fixes are written by the Go team and shipped with the toolchain, each addressing a specific known breaking change.

`gofmt -r` is a **general-purpose, user-supplied** single-rule rewriter. You provide the pattern; it has no built-in knowledge of any specific API change.

So: `go fix` = "apply these blessed, packaged migrations"; `gofmt -r` = "apply *my* one rewrite rule." For your own codebase-specific renames you'll use `gofmt -r` for trivial expression rewrites and a `go/ast`+`go/types` program for anything requiring logic or type resolution.
</details>

**Q23. You need a type-aware rename in a large Java monorepo. Which tool, and what's the catch?**

<details><summary>Answer</summary>

**OpenRewrite.** Author or reuse a recipe (`ChangeMethodName`, `ChangeType`, `ChangePackage`, or a custom `Recipe`) and run it via the Maven/Gradle plugin. Because it parses to a type-attributed LST, the rename targets only the resolved type/method you specify, and the output is guaranteed parseable.

The catch is the **build dependency**: OpenRewrite must produce the LST, which requires the project to *resolve* — dependencies on the classpath, generated sources available, modules buildable. In a healthy monorepo that's a non-issue; in a tangled one, getting every module to parse with full type attribution is the hard part of the job. The transform is the easy 20%; making the whole repo parse with types is the 80%. (Compare: a syntactic tool runs on broken code, but can't do the type-aware rename you actually need.)
</details>

---

## Landing the Diff — Review, Rollout, Rollback

**Q24. A codemod produces a 40,000-line diff across 1,200 files. How do you get it reviewed?**

<details><summary>Answer</summary>

You don't ask a human to read 40,000 lines — you make the diff *trustworthy by construction* and review the *transform*, not the *output*:

1. **Review the codemod, not the diff.** The transform plus its fixture tests is the real artifact to scrutinize. If the transform is correct and tested, the output follows.
2. **Prove machine invariants in CI:** compiles, idempotent (re-apply → empty diff), tests green. State these in the PR description.
3. **Separate mechanical from manual.** One commit = pure codemod output; any hand-fixes for sites the codemod couldn't handle go in a *clearly labeled separate commit* that gets real human review.
4. **Sample, don't read-all.** Reviewers spot-check a random sample of files (and any flagged outliers) to confirm uniformity.
5. **Split by directory/owner** if org policy requires per-team sign-off — same codemod, multiple PRs scoped to each owning team's paths, each small enough to land.

The framing for reviewers: "this diff is uniform and machine-verified; here's the transform and its tests; please review *those* and sample the output."
</details>

**Q25. How and why would you split one huge mechanical diff into multiple PRs?**

<details><summary>Answer</summary>

**Why:** a single 1,200-file PR is unmergeable in practice — it conflicts with everything in flight, blocks the whole repo, requires every code-owner's approval at once, and is impossible to revert cleanly if one corner is wrong.

**How to split:**
- **By ownership / directory** — one PR per team's path, so each goes to the right reviewers and lands independently.
- **By module / package** — natural seams that compile independently.
- **Never split a single semantic unit** — if file A's change requires file B's change to compile, they must land together. The split must preserve "each PR is green on its own."

Operationally, the codemod is the same; you just scope its file glob per PR. Land them in a short window to minimize the period where the codebase is half-migrated, and consider a CI fitness function that *fails on new occurrences* of the old pattern so stragglers can't reappear while you finish.
</details>

**Q26. The codemod ran, merged, and a problem surfaces a week later. What's your rollback story?**

<details><summary>Answer</summary>

Because the change was mechanical and committed in isolation, rollback options are clean:

1. **Revert the commit/PR.** A pure-codemod commit reverts to a known-good state without entangling unrelated work — this is *why* you keep the mechanical change in its own commit.
2. **Re-run an inverse codemod.** If the forward transform was `A → B`, you can often author `B → A` and apply it, especially if the forward transform was lossless. (If it discarded information, the inverse isn't exact — note this when designing.)
3. **Fix-forward with a corrective codemod.** Often better than reverting the whole thing: write a small follow-up transform that fixes only the broken subset, since reverting 1,200 files to re-do them later is wasteful.

The enabling discipline is upstream: small, isolated, well-described commits and a tagged pre-migration state make any of these a one-command operation. A codemod tangled into feature work has no clean rollback.
</details>

**Q27. What do you do about the files your codemod *didn't* match?**

<details><summary>Answer</summary>

Non-matching files split into two categories, and you must distinguish them:

1. **Legitimately don't apply** — the pattern genuinely isn't present. Fine; leave them.
2. **Should have matched but the codemod couldn't handle the shape** — a variant spelling, a dynamic call, a macro/codegen site, a multi-line form the matcher missed. These are the dangerous ones: a *partial* migration is often worse than none, because now two conventions coexist.

To find category 2, run a **separate detector** (a Semgrep rule, a `grep`, a lint check) for *any* remaining occurrence of the old pattern after the codemod, and triage every hit: either extend the codemod to cover it, or hand-fix it with a tracking note. Then install that detector as a **CI fitness function** that fails the build on new occurrences, so the old pattern can't creep back while you mop up the long tail. "The codemod ran" is not "the migration is done" — the residual scan is.
</details>

**Q28. How do you communicate a large mechanical change so other in-flight branches don't suffer merge hell?**

<details><summary>Answer</summary>

A repo-wide rename conflicts with *every* open branch that touches the same files. Mitigations:

- **Announce a window** and land the codemod in one burst, so everyone rebases once against a known commit rather than fighting a moving target.
- **Land it when in-flight work is low** (not mid-sprint-crunch).
- **Provide the codemod command** so people with conflicts can resolve by *re-running the transform on their branch* instead of hand-merging — the conflict resolution is "apply the same mechanical change," which is trivial.
- **Keep it isolated and revertible** so if it does cause chaos you can back it out fast.

The insight: for a mechanical change, the best conflict-resolution tool is the codemod itself — "rebase, then re-run `make codemod`" beats resolving thousands of textual conflicts by hand.
</details>

---

## Curveballs

**Q29. Your codemod passes all fixture tests and the whole codebase compiles — but a service breaks in production. How is that possible?**

<details><summary>Answer</summary>

Compiling proves syntactic validity, not behavioral equivalence. Several gaps:

- **Reflection / dynamic dispatch / string-keyed lookups** — renaming a method the compiler is happy with, but something calls it by *string name* via reflection, a DI container, an ORM, or serialization. The compiler can't see those edges.
- **Generated or external call sites** — config files, RPC schemas, other repos, that reference the old name and weren't in the codemod's scope.
- **Semantic shift the AST allowed** — e.g. the transform reordered evaluation, changed an `==` to `===`, or altered overload resolution in a way that compiles but behaves differently.
- **Thin tests** — the changed paths weren't actually exercised, so green tests proved little.

This is why "compiles" is the *floor*, not the verification, and why golden/characterization runs and a check for string-keyed references matter for anything touching a public or reflective surface.
</details>

**Q30. When is a *manual* refactor genuinely safer than an automated one, even across many files?**

<details><summary>Answer</summary>

When the change requires **per-site judgment that can't be encoded** — each call site needs a human to decide *how* to adapt the surrounding logic, not just apply a uniform edit. Forcing a codemod here produces a diff that's right at most sites and subtly wrong at others, and because it *looks* uniform, reviewers stop scrutinizing — the worst outcome.

Also when the **blast radius of a wrong automated edit is catastrophic and hard to detect** (security-sensitive code, money math) and you can't build a strong enough verification net. In those cases the slower, attention-forcing manual change — with a checklist and tests per site — is the responsible choice. Automation amplifies whatever you feed it: a uniform correct rule across 1,000 files, or a uniform *mistake* across 1,000 files.
</details>

**Q31. Someone proposes a regex-based codemod because "the AST tool is slow to set up." How do you respond?**

<details><summary>Answer</summary>

Acknowledge the real trade-off (AST tooling has setup cost) but reframe the risk: the regex's cost isn't setup, it's the **silent corruption you won't notice until it's in production** — the matched-inside-a-string, the same-named identifier in another scope, the multi-line call it missed. That cost is paid later, by someone else, and it's unbounded.

Concretely, offer the **middle rung**: Comby or `gofmt -r` give AST-level safety (respect strings, comments, nesting) with regex-level authoring cost — often a one-liner. So the dichotomy "slow AST tool vs fast regex" is false; the language-aware pattern tool is *both* fast to write *and* safe. If even that can't express the change, that's a signal the change is complex enough to deserve a real codemod, not a riskier regex.
</details>

**Q32. A codemod needs to add an `await` to certain async calls. Why is "type-aware" suddenly load-bearing here?**

<details><summary>Answer</summary>

Whether a call *should* be awaited depends on whether it **returns a Promise / Future** — which is a *type* fact, not a *syntactic* one. Two calls can look identical (`obj.fetch()`) where one returns a `Promise<T>` and the other returns `T`. A syntactic codemod that adds `await` to all `fetch()` calls will wrongly `await` the synchronous ones (a type error at best, a behavior change at worst) and miss promise-returning calls spelled differently.

A type-aware tool (ts-morph with the checker) asks "is the return type assignable to `Promise<unknown>`?" and awaits exactly those. Plus the idempotency guard: skip calls already inside an `await`. This is a textbook case where the *correctness predicate* is semantic, so a syntactic tool can't be made reliably correct no matter how clever the pattern.
</details>

---

## Rapid-Fire / One-Liners

<details><summary>Expand for quick-hit Q&A</summary>

- **Codemod in one sentence?** A program that rewrites source by parsing it to a tree, transforming the tree, and printing it back.
- **`sed` vs codemod?** `sed` edits text and hits strings/comments/wrong scopes; a codemod edits structure.
- **Idempotent means?** Running it twice equals running it once — design the matcher so the output isn't a "before."
- **Cheapest idempotency test?** Run the transform twice; assert the second run's diff is empty.
- **Cheapest correctness check at scale?** It still compiles/parses.
- **Why preserve trivia?** So a 3-line change isn't a 300-line reformat; keeps the diff reviewable.
- **AST vs CST?** AST drops trivia; CST keeps it for lossless round-trip — codemods want the latter.
- **What makes OpenRewrite type-aware?** Its LST attributes every node with resolved type info; needs a compilable project.
- **Comby's niche?** Structural match/replace that respects nesting/strings/comments without a full parser — safer than regex, cheaper than jscodeshift.
- **`gofmt -r` limit?** Single-expression, syntactic, no conditional logic, no types.
- **Determinism killer #1?** Iterating an unordered map/set — sort first.
- **Review a 1,200-file diff how?** Review the transform + tests; verify machine invariants; sample the output.
- **Partial migration danger?** Two conventions now coexist — install a CI detector for the old pattern.
- **Best rollback enabler?** Keep the mechanical change in its own isolated, well-described commit.
- **When NOT to automate?** When each site needs human judgment — uniform-looking-but-wrong is the worst diff.
- **Formatter pass?** Separate, final, pinned — keep formatting noise out of the logical diff.

</details>

---

## Summary

- A **codemod** rewrites code through its **structure** (AST/CST/LST), not its text — that's the whole reason it's safe where `sed`/regex corrupts strings, comments, and same-named identifiers in other scopes.
- The tool ladder by power and authoring cost: **regex → `gofmt -r` / Comby / Semgrep (syntactic, cheap) → jscodeshift / ts-morph / OpenRewrite (programmable, type-aware where needed)**. Pick the lowest rung that's *safe* for your change.
- **Type-awareness** (OpenRewrite's LST, ts-morph's checker) is load-bearing exactly when a name is ambiguous — renaming a method on *one* type, awaiting only promise-returning calls.
- **Idempotency and determinism** aren't niceties: you will run the transform more than once, and a non-idempotent or nondeterministic codemod silently corrupts already-correct files and breaks reviewability.
- Verify with **machine-checkable invariants** (parses, idempotent re-apply, tests green, golden output) plus **sampling** of the diff — you cannot read 5,000 files, so you make the diff trustworthy by construction.
- Land big diffs by **reviewing the transform, not the output**, splitting by ownership, isolating the mechanical commit for clean rollback, and installing a **CI detector** so the old pattern can't creep back during the long tail.

---

## Related Topics

- [Anti-Patterns at Scale — overview](../README.md) — where automated refactoring sits among at-scale techniques.
- [Architecture → Anti-Patterns](../../../../../Architecture/anti-patterns/README.md) — the org/architecture-level view of large-scale change.
- [Hotspot Analysis](../03-hotspot-analysis/junior.md) — find *which* files are worth a mass refactor before you write the codemod.
- [Architecture Fitness Functions](../01-architecture-fitness-functions/junior.md) — the CI detectors that catch stragglers and prevent regressions after a migration.
- [Strangler Fig & Seams](../05-strangler-fig-and-seams/junior.md) — the complementary strategy when a change is too semantic to mechanize.
- Level files: [`senior.md`](senior.md) — the concepts behind these questions, worked at depth.
