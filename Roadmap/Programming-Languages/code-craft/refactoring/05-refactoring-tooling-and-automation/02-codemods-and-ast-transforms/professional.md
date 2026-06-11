# Codemods & AST Transforms — Professional

> **Source:** Facebook jscodeshift; OpenRewrite docs; Instagram/Meta LibCST

At the professional level codemods stop being one-off scripts and become **infrastructure**: they run in CI, they execute against monorepos with millions of lines, they produce diffs that *teams* have to review, and they live for years as the canonical way a change is rolled out. This page is about operating codemods at that scale — performance, CI integration, review strategy for generated diffs, the recipe ecosystems, maintenance, and failure handling.

---

## 1. Codemods in CI

There are two distinct jobs a codemod does in CI, and conflating them causes pain.

### Job A — apply a migration (one-shot, gated)

A large migration is too big for one human-reviewable PR. The pattern:

1. Run the codemod in a CI job that **opens PRs, sharded by directory/team**, not one giant PR. Meta and Google both shard mechanical migrations so each owning team reviews their slice.
2. Each PR runs the **full test suite** — the codemod's correctness is *verified by your existing tests*, not by trust. A green build on a tightly-scoped diff is the safety contract.
3. Land PRs incrementally. A failure in one shard doesn't block the others.

### Job B — enforce a rule (continuous, blocking)

Once migrated, you don't want the old pattern creeping back. Run the codemod in **check / dry-run mode** on every PR and fail the build if it *would* change anything:

```bash
# CI gate: fail if the codemod would still modify any file (i.e. old pattern reintroduced)
jscodeshift -t ban-console-log.js src/ --dry --print > /tmp/out.txt
if [ -s /tmp/out.txt ]; then
  echo "❌ console.log reintroduced — run the codemod or fix manually"; exit 1;
fi
```

OpenRewrite has this first-class via `rewrite:dryRun` failing the build when a recipe finds work to do. This turns a one-time migration into a *permanent invariant* — far stronger than a lint rule someone can disable, because it's the actual transform checking for the actual pattern.

> **When NOT to gate in CI:** if the codemod is slow (type-aware, whole-project parse) and the rule is better expressed as a lint rule, use the lint rule for the gate and keep the codemod for the one-shot migration. Don't put a 3-minute OpenRewrite dry-run on the critical path of every PR if an ESLint rule catches the same thing in 200ms.

---

## 2. Performance on large repos

On a monorepo, naïve codemod runs are slow enough to matter (tens of minutes), and the wrong approach can be *hours*.

**Parallelism.** jscodeshift parallelizes across files by default (worker processes; tune with `--cpus=N`). Because each file transforms independently, this scales near-linearly — the win is real and free. OpenRewrite parses incrementally and caches the LST. LibCST/Bowler can be driven over a process pool.

**Scope the file set.** Don't run over `node_modules`, generated code, vendored directories, or files that can't contain the pattern. The cheapest speedup is *not parsing files you don't need to*:

```bash
jscodeshift -t mod.js src/ \
  --ignore-pattern="**/*.test.js" \
  --ignore-pattern="**/generated/**" \
  --cpus=8
```

**Pre-filter cheaply, then parse.** Parsing is the expensive step. Use a fast textual grep to find *candidate* files (files that even mention the token), and only run the AST transform on those. A repo-wide `rg "console\.log" -l` narrows 50,000 files to 400 before you pay for a single parse. The regex here isn't *doing* the transform (that's still the AST's job) — it's just cheaply eliminating files that provably can't match.

**Type-aware = expensive.** ts-morph and OpenRewrite type-check the project; that dominates runtime. Run them once over the whole project (they share the parsed program) rather than per-file in a loop, and budget minutes, not seconds.

| Technique | Typical win | Caveat |
|---|---|---|
| `--cpus=N` parallelism | near-linear | bounded by cores / IO |
| Ignore generated/vendor dirs | large | maintain the ignore list |
| grep pre-filter → parse candidates only | huge on big repos | the grep must not *exclude* real matches (keep it loose) |
| Reuse one type-checked program | essential for type-aware | needs a buildable project |

> **When NOT to optimize:** a codemod you run *once* over a repo that finishes in 90 seconds doesn't need a grep pre-filter or worker tuning. Optimize the codemods that run **in CI on every PR** (Job B), where latency is paid forever. One-shot migrations: just let them run.

---

## 3. Reviewing machine-generated diffs

A 200-file codemod PR defeats normal line-by-line review — reviewers can't read 4,000 changed lines meaningfully, so they rubber-stamp, and the rubber-stamp is where bugs hide. The professional review strategy:

1. **Review the *codemod*, not (only) the diff.** The transform logic and its fixture tests are what's actually being reviewed for correctness. If the codemod is right and well-tested, the diff is mechanically derived. Put effort there.
2. **Audit the diff for *shape*, not every line.** Reviewers verify: is the change *uniform*? `git diff --stat` and spot-checking a sample of files confirms every site changed the same way. Non-uniform hunks are where the codemod mishandled a variant — those are what you read closely.
3. **Lean on the lossless printer.** Because the printer only moves lines you changed (see [middle.md](middle.md)), the diff *is* the set of intended edits. If a file shows reformatting noise, that's a finding — investigate it.
4. **Trust the test suite as the real reviewer.** The contract is: tightly-scoped diff + green full test run = safe. The tests verify behavior; the human verifies the transform is principled and the diff is uniform.
5. **Sample, don't skim everything.** Read 5–10 representative files in full, including the gnarliest ones you can find (multi-line, commented, edge-case). If those are right and the rest are uniform, you're done.

> **When NOT to auto-merge:** never auto-merge a codemod PR on green CI alone if the transform touches semantics (not just naming). Behavior-changing codemods need a human to confirm the *intent* was right, because the tests only catch behavior they cover. Pure renames with full lossless diffs are the only ones safe to fast-track.

---

## 4. Recipe ecosystems and codemods as living tools

The highest-leverage professional move is treating common migrations as **shared, versioned, reusable recipes** rather than throwaway scripts.

**OpenRewrite** is the canonical example: recipes are published artifacts, composed from sub-recipes, versioned, and run via the build. The org-level pattern is a **recipe catalog** — your company's conventions (logging API, error handling, banned methods, dependency upgrades) encoded as recipes anyone can run and CI can enforce. A migration written once is rerun forever as new code lands.

**jscodeshift / LibCST** ecosystems work the same socially: libraries ship codemods with breaking releases (`react-codemod`, `next codemod`, MUI, Jest). The professional expectation when *you* ship a breaking change to an internal library is to **ship the codemod that migrates consumers** — you don't push the migration cost onto every team, you automate it.

Maintaining codemods as living tools means:

- **Version them with the thing they migrate.** The `v2→v3` codemod lives next to the v3 release and is tagged.
- **Keep their tests green in CI.** A codemod whose fixtures rot is a codemod no one trusts to run.
- **Document the escape hatches** — which variants it flags for manual handling (see [senior.md](senior.md) §2), so consumers know what to finish by hand.

> **When NOT to invest in a reusable recipe:** a genuinely one-time, one-repo change doesn't need to be a published, versioned recipe — that's gold-plating. Reserve the recipe-as-artifact treatment for migrations that recur, that other teams run, or that CI must enforce going forward.

---

## 5. Failure handling

At scale, a codemod *will* hit files it can't handle. The difference between professional and amateur is what happens then.

- **Parse failures must not be silent.** A file with a syntax error (or a syntax the parser version doesn't support) can't be transformed. The codemod must **report** it, not skip it quietly — a silently-skipped file is an un-migrated site that looks migrated. jscodeshift reports per-file errors in its summary; surface and fail on them.
- **Unhandled variants get flagged, not guessed.** As in [senior.md](senior.md), when a site can't be transformed safely (spread args, dynamic dispatch, macro-generated code), emit a report line for a human, and *don't* emit wrong code.
- **Partial application is fine; partial silence is not.** It's acceptable for a codemod to handle 95% and list the 5%. It is never acceptable for it to handle 95%, mangle 4%, and tell you it did 100%.
- **Make reruns safe.** Because some shards will fail and get rerun, idempotency ([middle.md](middle.md) §3) isn't optional at scale — it's what makes "just run it again" a safe instruction.
- **Validate after applying.** The post-apply gate is your test suite plus a *compile/typecheck*. A codemod that produces parseable-but-uncompilable code (wrong type, missing import) is caught here. Never trust a codemod's output without re-typechecking the result.

The mental model: a codemod operating on thousands of files is a distributed batch job. Treat its failures the way you'd treat any batch job — explicit error reporting, idempotent retries, a verification step, and a manifest of what it couldn't do.

---

## Next

- **[interview.md](interview.md)** — the questions that separate people who've *operated* codemods from those who've only read about them.
- **[tasks.md](tasks.md)** — write real codemods end to end.
- Org-wide recipe catalogs are a form of automated [Refactoring to Patterns](../../03-refactoring-to-patterns/02-creational/junior.md) enforcement.
- The traversal at the heart of every recipe is, again, [Visitor](../../../design-patterns/03-behavioral/10-visitor/junior.md).
