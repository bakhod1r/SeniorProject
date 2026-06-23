# Automated Large-Scale Refactoring — Optimize This

> **Category:** [Anti-Patterns at Scale](../README.md) → **Automated Large-Scale Refactoring**
> **Covers (collectively):** Codemods & AST transforms · Type-aware rewrites · Pattern tools (Comby, Semgrep, gofmt -r) · Idempotency & verification · Landing huge mechanical diffs

---

These are **make-the-rollout-good** exercises. Each gives you a transform that *runs* but is **slow, unsafe, or both** at scale — a bash loop that boots a fresh JVM per file across 10,000 files, a regex masquerading as a codemod, an unverified mass diff. Your job is to fix it on **two axes at once: correctness and speed.** Faster but still corrupting strings is not a win; safe but taking six hours per run means nobody will re-run it to verify.

> **The mindset:** at scale, *startup cost dominates* and *every edge case is present in some file*. A per-file process spawn that's invisible at n=10 is a 30-minute tax at n=10,000; a regex that's "probably fine" *will* hit the one file where it isn't. Optimize the rollout, not just the transform.

> **How to use this file:** read "Before," predict the bottleneck and the unsafe case yourself, then expand "After." The note on *why it's faster AND safer* is the point.

---

## Table of Contents

| # | Exercise | Problem | Fix |
|---|---|---|---|
| 1 | [The per-file Node spawn](#exercise-1--the-per-file-node-spawn) | Startup × 10k files | One process, batch the files |
| 2 | [The per-file JVM (OpenRewrite the wrong way)](#exercise-2--the-per-file-jvm-openrewrite-the-wrong-way) | JVM boot × every file | One run over the whole module |
| 3 | [The unsafe regex rollout](#exercise-3--the-unsafe-regex-rollout) | `sed` corrupts code | Structural/AST tool |
| 4 | [The unverified mass diff](#exercise-4--the-unverified-mass-diff) | No safety net at scale | Add a machine-checkable verification pass |
| 5 | [The serial codemod that ignores cores](#exercise-5--the-serial-codemod-that-ignores-cores) | One core, hours of wall time | Parallel shards + deterministic merge |

---

## Exercise 1 — The per-file Node spawn

**Problem:** This script applies a jscodeshift transform to a large repo by looping in bash and invoking the runner **once per file**. On 10,000 files it takes ~25 minutes, almost all of it Node/V8 startup.

```bash
# Before — a fresh `node` (and full jscodeshift load) per file.
find src -name '*.ts' | while read -r f; do
  npx jscodeshift -t transform.js "$f"      # spawns node + parses transform EACH time
done
```

> Why is this slow, and how do you fix it without changing what the transform does?

<details>
<summary>After</summary>

**Diagnosis.** The cost isn't the transform — it's **process startup paid 10,000 times.** Each `npx jscodeshift ...` boots Node, initializes V8, resolves and loads `jscodeshift` + its parser + `transform.js`, then transforms *one* file and exits. That fixed startup (~100–200 ms of Node boot + module load) dominates; the actual AST work on a single file is milliseconds. Plus `npx` itself does a resolution step every invocation.

```text
Before:  10,000 × (node boot + load jscodeshift + load transform + 1 file)  ≈ 25 min
                  └──────────────── paid 10,000 times ─────────────────┘
```

**Fix — jscodeshift already takes many paths and parallelizes internally. Hand it the whole set in *one* process:**

```bash
# After — ONE node process; jscodeshift walks the tree and uses a worker pool.
npx jscodeshift -t transform.js --extensions=ts --parser=ts src
```

`jscodeshift` accepts a directory (or a list of paths), loads the transform **once**, and runs files across a pool of worker threads. Startup is paid a single time; the per-file cost is now just parsing + transforming.

```text
After:   (node boot + load jscodeshift + load transform) ONCE
         + 10,000 files spread across N workers           ≈ 30–60 sec
```

If you must drive it from a file list (e.g. only changed files), batch them into one invocation rather than looping:

```bash
# Still one process: pass all paths at once.
git diff --name-only --diff-filter=d origin/main -- '*.ts' \
  | xargs npx jscodeshift -t transform.js --extensions=ts --parser=ts
```

**Correctness is unchanged** — same transform, same output per file; you only removed the repeated startup. **Speed: ~25 min → under a minute**, a ~25–50× win, entirely from amortizing process boot and exploiting the built-in worker pool. The general rule for any AST tooling: **one process over many files, never one process per file** — startup is a fixed cost you pay once, not n times.
</details>

---

## Exercise 2 — The per-file JVM (OpenRewrite the wrong way)

**Problem:** A team wants an OpenRewrite recipe applied to a Java service. Someone wrote a loop that invokes the build **per file**. JVM startup plus Maven's own startup, paid thousands of times, turns a 2-minute job into an hour-plus — and it's also *wrong*.

```bash
# Before — boots Maven + JVM + re-parses the project for EVERY file.
find . -name '*.java' | while read -r f; do
  mvn -q org.openrewrite.maven:rewrite-maven-plugin:run \
      -Drewrite.activeRecipes=com.example.RenameApi \
      -Drewrite.includes="$f"
done
```

> Two things are wrong here. What are they, and what's the correct invocation?

<details>
<summary>After</summary>

**Diagnosis — two faults:**

1. **JVM + Maven startup × every file.** Each `mvn` invocation boots the JVM, starts Maven, and re-resolves the project. That's seconds of fixed cost per file before any rewriting happens. At thousands of files it's the entire runtime.
2. **It defeats the *reason* you chose OpenRewrite.** OpenRewrite is type-aware: it builds a **Lossless Semantic Tree for the whole module** so it can resolve types across files. Running it one file at a time means each run parses that file *without the rest of the project's type context* — so the type attribution that makes the recipe safe is degraded or absent. You've thrown away the exact feature you paid for.

**Fix — run the recipe ONCE over the whole module. OpenRewrite parses the full project, builds the typed LST, and applies the recipe across all files in a single JVM:**

```bash
# After — one Maven run; full-project LST; recipe applied everywhere, type-aware.
mvn -q org.openrewrite.maven:rewrite-maven-plugin:run \
    -Drewrite.activeRecipes=com.example.RenameApi
```

(or, in a multi-module monorepo, run it at the reactor root so every module is parsed with shared type context.)

```text
Before:  N files × (JVM boot + Maven start + single-file parse without type ctx)
         → slow AND semantically degraded
After:   1 × (JVM boot + Maven start + full-project LST + recipe over all files)
         → minutes, AND fully type-aware
```

**Correctness improves and speed improves together.** Speed: the JVM and project resolution are paid once, not per file (hours → minutes). Correctness: with the whole-project LST, the recipe resolves types across files, so a `ChangeMethodName` recipe targets exactly the intended type's method everywhere and leaves same-named methods on other types alone — which the per-file run could not guarantee. This is the recurring at-scale lesson: **the type-aware tool must see the whole compilation unit; feeding it one file at a time is both slower and less safe.**
</details>

---

## Exercise 3 — The unsafe regex rollout

**Problem:** A migration replaces the deprecated constructor call `NewClient(url)` with `NewClientWithOptions(url, DefaultOpts)` across a Go monorepo. Someone shipped it as a `sed` loop "because it was fast to write." It *is* fast — and it corrupts the codebase.

```bash
# Before — fast to write, unsafe at scale.
grep -rl 'NewClient(' --include='*.go' . | while read -r f; do
  sed -i 's/NewClient(\(.*\))/NewClientWithOptions(\1, DefaultOpts)/g' "$f"
done
```

```go
// What it hits in the wild:
c := NewClient(baseURL)                       // intended → NewClientWithOptions(baseURL, DefaultOpts)
d := NewClient(join(host, port))              // arg has nested parens + comma → BREAKS
// see NewClient(url) for the old form        // a comment → corrupted
msg := "call NewClient(url) directly"         // a string → corrupted
e := NewClientV2(baseURL)                     // 'NewClient(' is a SUBSTRING of NewClientV2(? no — but watch prefixes
```

> What does this corrupt, and what's the safe rollout that's *also* fast?

<details>
<summary>After</summary>

**Diagnosis — `sed`'s `.*` is greedy and text-only:**

- `NewClient(join(host, port))`: `\(.*\)` greedily grabs `join(host, port)` *and* eats the closing paren, then the substitution mangles the balance → `NewClientWithOptions(join(host, port), DefaultOpts)` is what you *wanted*, but with multiple calls on a line, greedy `.*` spans across them and corrupts everything between the first `NewClient(` and the *last* `)` on the line.
- The **comment** and **string** mentioning `NewClient(url)` are rewritten — meaning and user-facing text changed.
- `NewClientV2(` doesn't match `NewClient(` (the `(` differs), but `sed` gives you no guarantee about such prefix hazards in general — you're one careless pattern away from matching `NewClientV2`.

It's "fast to write" but produces a diff you cannot trust, on code that may not even compile.

**Fix — use a structural tool. Comby gives balanced-span safety with the same one-line authoring cost, and runs over the whole tree in one go:**

```bash
# After — structural, balanced-aware, ignores strings/comments, one invocation.
comby 'NewClient(:[args])' 'NewClientWithOptions(:[args], DefaultOpts)' .go -in-place
```

`:[args]` binds to a **balanced span**, so `join(host, port)` is captured as one argument (Comby knows the inner `)` closes `join(`), and multiple calls on one line are each matched independently. Comby recognizes Go's lexical regions, so the comment and string are left untouched.

For a *type-aware* guarantee (only the `NewClient` from the package you mean), step up to a `go/ast` + `go/types` program; but for this uniform syntactic swap, Comby is the right rung — as fast to write as the `sed`, as safe as an AST.

```text
Before:  sed loop — corrupts nested calls, comments, strings; may not compile.   "fast but wrong"
After:   one comby run — balanced spans, lexical-region-aware, all files.        "fast AND correct"
```

**Verify after** (cheap, machine-checkable):

```bash
go build ./... && go test ./...                 # compiles + behavior preserved
comby 'NewClient(:[args])' 'NewClientWithOptions(:[args], DefaultOpts)' .go -in-place
git diff --quiet && echo "idempotent: clean second run"   # output isn't a 'before'
```

**Both axes win:** the speed was never the problem (`sed` is fast); the fix keeps the speed *and* removes the corruption, plus adds a verification pass that the original had none of. The lesson: "fast to write" regex trades a small authoring saving for an unbounded correctness risk — and a structural tool removes the trade entirely.
</details>

---

## Exercise 4 — The unverified mass diff

**Problem:** A codemod produced a 30,000-line diff across 900 files. The rollout script applies it and opens a PR. There is **no verification** — no compile check, no idempotency check, no test run. The author plans to "review the diff." Reviewing 30,000 lines by eye is not verification; it's theater. Add a real safety net.

```bash
# Before — apply and pray.
npx jscodeshift -t migrate.js --extensions=ts src
git add -A && git commit -m "mechanical migration"
gh pr create --title "Migrate API" --body "Big codemod, please review the diff."
```

> What verification passes turn this from "apply and pray" into a trustworthy rollout — and why are they cheaper than reading the diff?

<details>
<summary>After</summary>

**Diagnosis.** At 30,000 lines, human review can't *verify* correctness — it can only sample. The trustworthiness must come from **machine-checkable invariants**, run automatically, because they scale to any diff size and don't fatigue. You cannot read 900 files; you *can* assert four properties about them.

**Fix — a verification pipeline, cheapest signal first:**

```bash
#!/usr/bin/env bash
set -euo pipefail

# 1. Apply the codemod (one process — see Exercise 1).
npx jscodeshift -t migrate.js --extensions=ts --parser=ts src

# 2. STILL COMPILES — the strongest cheap signal. Unparseable output fails here.
npx tsc --noEmit

# 3. IDEMPOTENT — re-apply; a clean second run proves the transform reaches a fixed point.
git add -A
npx jscodeshift -t migrate.js --extensions=ts --parser=ts src
if ! git diff --quiet; then
  echo "FAIL: codemod is not idempotent — second run changed files" >&2
  git diff --stat >&2
  exit 1
fi

# 4. BEHAVIOR PRESERVED — a pure refactor must not change test outcomes.
npm test

# 5. NO RESIDUALS — the old pattern is fully gone (catches variants the codemod missed).
if grep -rn --include='*.ts' 'oldApiCall(' src; then
  echo "FAIL: legacy pattern still present — partial migration" >&2
  exit 1
fi

# 6. Formatting as a separate, pinned, final pass (keeps the logical diff clean).
npx prettier --write src

echo "All invariants hold — safe to open PR."
```

**Why each pass, and why it beats reading the diff:**

| Pass | Catches | Cost vs reading 30k lines |
|------|---------|---------------------------|
| `tsc --noEmit` | Any syntactically broken output | Seconds; a human can't reliably spot a broken file among 900 |
| Re-apply → empty diff | Non-idempotency (double-apply) | One re-run; invisible to eyeballing |
| `npm test` | Behavior changes the transform shouldn't have made | Existing suite; a human can't trace behavior across 900 files |
| Residual `grep`/Semgrep | The long tail — variants the codemod didn't match | Instant; "looks complete" ≠ "is complete" |

**The framing for the PR:** "This diff is uniform and machine-verified — compiles, idempotent, tests green, no residuals. Please review *the transform* (`migrate.js`) and its fixture tests, and sample a few output files." Reviewers now scrutinize the ~50-line transform and its tests — the real artifact — instead of pretending to read 30,000 lines.

**Both axes:** this doesn't slow the rollout meaningfully (the passes are a few minutes of CI), and it converts an untrustworthy diff into one you can land with confidence — and **roll back cleanly**, because the mechanical change is isolated in its own commit. Speed of the codemod was fine; what was missing was the *verification that makes the speed safe to use.*
</details>

---

## Exercise 5 — The serial codemod that ignores cores

**Problem:** A custom Go codemod (using `go/ast`) processes files **one at a time on a single goroutine**. On a 16-core machine and 12,000 files it runs for ~18 minutes using one core. Parallelize it — without breaking determinism.

```go
// Before — serial; one core; deterministic but slow.
func main() {
	files := listGoFiles("./...")   // returns a sorted []string
	for _, path := range files {
		src, _ := os.ReadFile(path)
		out := transform(src)        // pure: bytes in, bytes out, no shared state
		os.WriteFile(path, out, 0o644)
	}
}
```

> The transform is pure per file. Parallelize across cores while keeping the output deterministic and the run idempotent.

<details>
<summary>After</summary>

**Diagnosis.** `transform` is **pure and independent per file** — perfect for parallelism — but the loop uses one core, so 15 of 16 cores sit idle. The risk in parallelizing is **introducing nondeterminism**: if workers write shared state or you collect results in completion order, the output (or any report) becomes order-dependent and the "re-apply → empty diff" check goes flaky.

**Fix — a bounded worker pool over the *already-sorted* file list. Each worker handles whole files independently; ordering is preserved because files don't interact, and any aggregated output is keyed back to the sorted index.**

```go
// After — N workers, one per core; deterministic because work is per-file and independent.
func main() {
	files := listGoFiles("./...")          // STILL sorted → deterministic file set
	workers := runtime.NumCPU()
	jobs := make(chan string)

	var wg sync.WaitGroup
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for path := range jobs {
				src, err := os.ReadFile(path)
				if err != nil {
					log.Fatalf("read %s: %v", path, err)
				}
				out := transform(src)          // pure: no shared state to race on
				if err := os.WriteFile(path, out, 0o644); err != nil {
					log.Fatalf("write %s: %v", path, err)
				}
			}
		}()
	}
	for _, p := range files {                 // feed in sorted order
		jobs <- p
	}
	close(jobs)
	wg.Wait()
}
```

```text
Before:  12,000 files × transform, on 1 core            ≈ 18 min
After:   12,000 files / 16 workers, in parallel         ≈ 1.5–2 min   (~10× on 16 cores)
```

**Why it stays deterministic and idempotent:**

- **Per-file independence** means there is *no shared mutable state* between workers — no race, and the contents written to each file depend only on that file's input. The output is identical regardless of which worker handled which file or in what order they finish.
- **The file list is sorted**, so the *set* of work and any per-file naming is reproducible. (Order of *execution* doesn't matter precisely because files don't interact.)
- If the codemod also produced an **aggregated artifact** (a report, a shared import manifest), you must *not* append to a shared slice in completion order — instead collect `results[i]` keyed by the sorted index and emit in index order, exactly as Exercise 7 of [`find-bug.md`](find-bug.md) shows. That's the one place parallelism could sneak nondeterminism in.

**Both axes:** ~10× faster on a 16-core box *and* still byte-for-byte deterministic and idempotent, because the parallelism only exploits the transform's existing per-file independence — it doesn't introduce shared state. The principle: **parallelize the embarrassingly-parallel part (independent files), keep all ordering explicit, and never let completion order leak into output.**
</details>

---

## Summary

- **Startup cost dominates at scale.** The #1 rollout bug is *one process per file* — spawning Node/JVM/Maven 10,000 times. Fix: **one process over many files** (jscodeshift takes a directory; OpenRewrite parses the whole module once). 10–50× wins with zero change to the transform (Exercises 1–2).
- **Feeding a type-aware tool one file at a time is slower *and* less safe** — it loses the cross-file type context that justified choosing it. Run it over the whole compilation unit (Exercise 2).
- **"Fast to write" regex trades a tiny authoring saving for unbounded corruption** — nested calls, strings, comments. A structural tool (Comby) is *equally fast to write and actually safe* (Exercise 3).
- **Reading a 30,000-line diff is not verification.** Trust comes from **machine-checkable invariants**: compiles, idempotent (re-apply → empty diff), tests green, no residual pattern, formatter as a final pinned pass. Cheaper than eyeballing and scales to any diff (Exercise 4).
- **Parallelize the embarrassingly-parallel part** — independent per-file transforms across a worker pool — but keep ordering explicit and never let completion order leak into output, or you trade speed for nondeterminism (Exercise 5).
- The through-line: **optimize the rollout, not just the transform.** Speed comes from amortizing startup and using cores; safety comes from structural/type-aware tooling plus an automated verification pass. You need both, because at scale every edge case is present and every fixed cost is multiplied.

---

## Related Topics

- [Anti-Patterns at Scale — overview](../README.md) — where rollout mechanics fit among at-scale techniques.
- [Architecture → Anti-Patterns](../../../../../Architecture/anti-patterns/README.md) — the architecture-level view of large mechanical change.
- [Hotspot Analysis](../03-hotspot-analysis/junior.md) — scope the rollout to the code that matters.
- [Architecture Fitness Functions](../01-architecture-fitness-functions/junior.md) — the CI invariants that make Exercise 4's verification permanent.
- [Strangler Fig & Seams](../05-strangler-fig-and-seams/junior.md) — the staged alternative when a mass rollout is too risky.
- Level files: [`senior.md`](senior.md) — the principles behind these optimizations, at depth.
