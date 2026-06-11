# Codemods & AST Transforms — Interview

> **Source:** Facebook jscodeshift; OpenRewrite docs; Instagram/Meta LibCST

Fourteen questions, ordered roughly easy → hard. Each has a model answer at the depth a strong candidate gives — concrete, with the trade-off named, not a definition recited.

---

### Q1. What is a codemod, in one sentence?

**A.** A program that programmatically edits other programs across many files by manipulating their Abstract Syntax Tree rather than their text, so a mechanical refactoring can be applied consistently and at scale. The classic example is renaming a function used in hundreds of places without touching same-named variables, strings, or comments.

---

### Q2. Walk me through the codemod pipeline.

**A.** Four steps: **parse** the source into an AST; **match** the nodes of interest by querying the tree; **transform** them (mutate, replace, delete, wrap); **print** the AST back to source — ideally losslessly, preserving the formatting and comments of untouched code. Every tool — jscodeshift, LibCST, OpenRewrite — is this same pipeline; they differ mainly in matcher ergonomics and how losslessly they print.

---

### Q3. Why use an AST instead of a regular expression for a bulk code change?

**A.** A regex sees characters; an AST encodes meaning. A regex can't tell that `console.log` inside a string literal or a comment isn't a real call, can't follow a `console\n.log()` split across lines, and can't distinguish *your* `getUser` function from a local variable of the same name. The AST encodes scope, nesting, node type (string vs. call vs. comment), and structure directly, so the match is *semantic* — you select code by what it **is**. A regex rename will corrupt strings, rewrite comments, and miss multi-line forms; the AST equivalent has none of those failure modes because comments and strings simply aren't the node type you're matching. Regex is fine for finding candidate *files*; it's the wrong tool for *transforming* code.

---

### Q4. When would you *not* write a codemod?

**A.** Four cases. (1) The change is small — a handful of sites — use the IDE's structural rename instead; it's also AST-aware and instant, and writing/testing a script for three call sites is wasted effort. (2) The change needs per-site human judgment ("replace this loop with a better algorithm") — codemods only work when the *same* rule applies everywhere with no decisions. (3) You can't make the transform safe and can't test it — a wrong codemod fails at scale, all at once, which is worse than a manual change. (4) It's genuinely a *text* change (typo in a string, copyright year) — use a regex or Comby. The rule: codemod when the change is mechanical, large, and safe to automate.

---

### Q5. What does it mean for a codemod to be idempotent, and why does it matter?

**A.** Idempotent means running it a second time changes nothing — the first run does the migration, the second is a no-op. It matters because codemods get rerun in practice: on CI per-push, on branches that already migrated, on overlapping code by two engineers, and as retries of failed shards in a large rollout. A non-idempotent codemod *compounds* — e.g. "wrap `fetch()` in `withRetry`" run twice yields `withRetry(withRetry(fetch))`. You guarantee idempotency by making the matcher never match its own output: encode the "already done" state into the match condition (skip the fetch already inside a `withRetry`). You also *test* it by feeding the transformed output back in and asserting no change.

---

### Q6. Explain CST vs AST. Which do you want for a codemod, and why?

**A.** An AST is *abstract* — it keeps meaning and drops "insignificant" syntax like whitespace and often comments, so two differently-formatted files yield the same AST. A CST (Concrete Syntax Tree) keeps *everything*: comments, exact spacing, trailing commas, so `print(parse(src)) == src` byte-for-byte. For a codemod whose output humans review, you want CST-grade losslessness (LibCST, OpenRewrite's LST, or jscodeshift via recast). The reason is the **diff**: a lossy printer drops comments and reformats every line, so the reviewer can't separate your one intended change from reformatting noise — review becomes impossible and bugs slip through. A lossless printer moves *only* the lines you changed, so the diff *is* the intended change and the reviewer can approve with confidence.

---

### Q7. How is a codemod different from an IDE "Rename" refactoring?

**A.** They're cousins — both are AST-aware, so both correctly skip strings and comments and respect scope. The differences are scale, reuse, and reach. IDE rename is interactive, instant, and best for a single symbol in one project; it's the right tool for small, local changes. A codemod is a *written program*: it can encode arbitrary transformation logic (not just rename — wrap, restructure, migrate an API), it's reusable and versionable, it runs headless across many repos in CI, and it can ship with a library so consumers auto-migrate. Rule of thumb: a few sites or a simple rename → IDE; a complex or repo-spanning mechanical change, or one you need to rerun/enforce → codemod.

---

### Q8. When does a pure syntactic matcher fail, and what do you reach for?

**A.** It fails when the rule depends on *types* or on *which declaration a name refers to*. "Rename only the `save()` on `Repository`, not the dozens of unrelated `save()` methods" can't be done by name — same name, different types. You need type resolution: ts-morph (wraps the TS type checker), or OpenRewrite whose `MethodMatcher` is fully type-qualified (`com.example.Repository save(java.lang.Object)`). The cost is that type-aware tools must type-check the whole project — slow, and they need a buildable, dependency-resolved codebase — whereas a syntactic jscodeshift transform runs per-file in milliseconds with no build. So you reach for type-awareness only when shape genuinely can't disambiguate.

---

### Q9. A codemod ran and reported "214 unmodified, 0 ok." The change should have hit ~30 files. What's your debugging process?

**A.** Zero matches means the **matcher** is wrong, not the transform. I'd (1) take one file I *know* should match and dump its AST (jscodeshift's `--print`, or astexplorer.net) to see the real node shapes; (2) compare the actual node structure to my filter — the usual culprit is assuming a node type that's wrong (e.g. matching `Identifier` callee when it's actually a `MemberExpression`), or a property nested differently than I assumed; (3) loosen the matcher one constraint at a time until it hits, then tighten back. The opposite symptom — it touched 400 files — means the matcher is too *broad* (missing a context anchor), and the fix is to anchor the match to its enclosing context.

---

### Q10. Your codemod handles `f(a, b)` but the codebase also has `obj.f(a, b)`, `f(...args)`, and multi-line calls with comments. How do you make it robust?

**A.** Enumerate the variants deliberately and decide each one's fate. Normalize the callee so both `f(...)` and `obj.f(...)` are considered (or explicitly excluded). Multi-line and comments come free if I use a lossless tool — formatting is irrelevant to the AST structure and the printer preserves it. The dangerous variant is the spread `f(...args)`: I *can't* know the argument count, so I must not guess — I **flag it for human review and leave it unchanged**. A robust codemod does the safe 95% automatically and emits a report of the unsafe 5% rather than silently producing wrong code for it. I'd add a fixture for each variant, including a "must not change" case and an idempotency case.

---

### Q11. How do you test a codemod?

**A.** With fixture pairs: an `input` source and the `expected` output; run the transform on input, assert equality. jscodeshift's `defineTest` and LibCST's `CodemodTest`/`assertCodemod` do exactly this. The fixtures must cover: the happy path; variants that *should* also transform (multi-line, trailing comment, nested); look-alikes that must be **left alone** (the same word in a string, in a comment, in a different scope); and the **idempotency case** — feed the already-transformed output back and assert it's unchanged. A codemod is high-leverage code — one bug multiplies across the whole repo — so it gets tested like any other code. Twenty lines of fixtures is the cheapest insurance available.

---

### Q12. How do you run a 500-file codemod migration so it's actually reviewable and safe to land?

**A.** Don't open one giant PR — **shard by directory/team** so each owning team reviews their slice, and each shard runs the **full test suite** (green build on a tightly-scoped diff is the safety contract). Review the *codemod and its tests* for correctness, then audit the diff for *shape* — `git diff --stat` plus reading a sample of files (including the gnarliest) confirms every site changed uniformly; non-uniform hunks are where a variant was mishandled and deserve close reading. Lean on the lossless printer: any reformatting noise in the diff is a finding. Land shards incrementally so one failure doesn't block the rest. For pure renames with clean lossless diffs you can fast-track; for behavior-changing transforms a human must confirm intent, because tests only catch behavior they cover.

---

### Q13. What's the difference between sequencing codemods and composing them, and when do you use each?

**A.** *Sequencing* runs separate codemods in a pipeline (mod A, then mod B on A's output) — each is independently testable and its diff is separately reviewable; good for ad-hoc one-off chains. *Composing* runs multiple passes inside one codemod sharing the parsed tree — OpenRewrite recipes are a list of sub-recipes run as a unit; you parse once, share type info, apply atomically, and reuse battle-tested sub-recipes like `RemoveUnusedImport`. Composition wins for big framework migrations; sequencing wins when you want each step's diff in isolation. The critical invariant in either case: **every step must stay idempotent**, because in a chain a later step may see input a previous step already partly transformed.

---

### Q14. Should you always build your own codemod for a framework upgrade? How do you decide build vs. reuse?

**A.** Reuse-first. Major framework/library upgrades usually ship a published codemod (OpenRewrite's JUnit 4→5 and Spring Boot recipes; `react-codemod`; `next codemod`), and those have been run across thousands of real repos and have absorbed the variant edge cases you haven't thought of. Building from scratch means rediscovering all of them in your own production code. Build custom only for *your* domain — internal API renames, company conventions — that no published recipe covers. If an existing recipe is ~90% right, compose: run it, then a small custom step for the gap. And if the change is one-off, small, or needs judgment, don't codemod at all — use the IDE or do it by hand.

---

### Q15. A codemod produced parseable code that doesn't compile (wrong type, missing import). The tests were green for the files it touched. What went wrong and how do you prevent it?

**A.** Green tests for *touched* files don't prove the *whole project* still compiles — the broken site may be in code those tests don't exercise, or the breakage is a type error the runtime tests never hit. The prevention is a **post-apply verification step beyond unit tests: a full compile/typecheck of the resulting tree.** That's exactly the gate that catches "parseable but uncompilable." It also argues for using a type-aware tool (ts-morph, OpenRewrite) for type-sensitive transforms in the first place — they resolve types as they transform, so they're less likely to emit type-incoherent code, and you can re-run the checker on the output. Never trust a codemod's output without re-typechecking it.
