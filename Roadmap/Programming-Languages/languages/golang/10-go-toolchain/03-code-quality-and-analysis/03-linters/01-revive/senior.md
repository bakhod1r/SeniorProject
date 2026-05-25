# revive — Senior

## 1. The rule-as-plugin architecture

`revive`'s design choice that matters most: **every check is an isolated rule** implementing one small Go interface, and the engine orchestrates them. A rule looks roughly like this:

```go
package rule

import (
    "go/ast"
    "github.com/mgechev/revive/lint"
)

type TodoCommentRule struct{}

func (*TodoCommentRule) Name() string { return "todo-comment" }

func (*TodoCommentRule) Apply(file *lint.File, args lint.Arguments) []lint.Failure {
    var failures []lint.Failure
    ast.Inspect(file.AST, func(n ast.Node) bool {
        c, ok := n.(*ast.Comment)
        if !ok {
            return true
        }
        if strings.HasPrefix(c.Text, "// TODO") {
            failures = append(failures, lint.Failure{
                Node:       c,
                Confidence: 1,
                Category:   "comments",
                Failure:    "TODO comment should be tracked in an issue",
            })
        }
        return true
    })
    return failures
}
```

Two methods (`Name`, `Apply`) and a `lint.Failure` value per finding. There is no callback graph and no analyzer composition like `go/analysis`. That simplicity is `revive`'s personality: rules are easy to write, easy to read, and easy to reason about in review.

The flip side: rules cannot consume each other's results. A rule that needs type information must call `go/types` itself (via `file.Pkg.TypeCheck()`), whereas `staticcheck` and other `go/analysis`-based tools share that work across analyzers.

---

## 2. Writing a custom rule (end to end)

In a real team you maintain a small fork (or a separate binary built around `revive`'s library) for repo-specific rules. Skeleton:

```go
// cmd/team-revive/main.go
package main

import (
    "github.com/mgechev/revive/config"
    "github.com/mgechev/revive/lint"
    "github.com/mgechev/revive/rule"
    ourrules "example.com/lint/rules"
)

func main() {
    extra := []lint.Rule{
        &ourrules.TodoCommentRule{},
        &ourrules.NoPanicInLibraryRule{},
    }
    // wire `extra` into a Linter and run with the standard CLI...
}
```

Even without forking, you can ship a small CLI that imports `revive` as a library plus your in-house rules. Teams typically host one or two rules that encode policies the public catalogue does not cover (e.g., "no `panic()` in library code", "all HTTP handlers must accept `context.Context`").

---

## 3. Team policy authoring

A `revive.toml` is a *policy document* once a team has more than a handful of services. Three principles:

1. **One config, many repos.** Put `revive.toml` in a shared internal module and `include` (copy at build time, or fetch in CI). Drift between services produces inconsistent reviews.
2. **Severity ladder.** New rules enter at `warning`; they are promoted to `error` only after the backlog is zero on the main branch. This gives engineers time to fix without blocking unrelated PRs.
3. **Document the *why*.** Next to each rule in the config, a one-line TOML comment explaining the team decision saves quarterly rehashing.

```toml
# error-strings: error messages are user-visible in logs; capitalization breaks our log parser.
[rule.error-strings]
  severity = "error"
```

---

## 4. False-positive triage workflow

Every linter produces some false positives. Healthy process:

1. **First response is never a directive comment.** Investigate the finding; nine times out of ten it points at a real smell even if the rule's stated reason does not fit.
2. **If the finding is genuinely wrong here**, use `//revive:disable-next-line:rule-name` with a comment explaining why. Reviewers should reject naked disables.
3. **If it is wrong systematically** (e.g., on every generated file), fix the *config*, not each call site — add an exclude pattern or arguments, or use `-exclude` to skip a directory.
4. **If the rule itself is bad for your repo**, remove it from the config. Honest reduction beats death by 1,000 inline disables.

A useful metric: count `revive:disable` directives in the repo and chart it over time. A growing number means the policy is mis-tuned.

---

## 5. Where `revive` fits among go vet / staticcheck

Three tools, three niches:

| Tool | What it is for | Confidence of findings |
|------|----------------|------------------------|
| `go vet` | Compiler-adjacent correctness checks (printf formats, shadowing, lock copying) | Very high — almost no false positives |
| `staticcheck` | Deeper correctness, dead code, suspicious patterns | High |
| `revive` | Style and convention enforcement | Medium — context-dependent |

Run all three in CI, but in that order of trust: `vet` failures block immediately, `staticcheck` failures block at `error` severity, `revive` failures block only the rules promoted to `error`. Do not collapse them into one tool — their failure modes and signal quality differ.

---

## 6. The `confidence` knob

Each rule emits findings with a confidence score (often 1.0, sometimes lower for ambiguous patterns). The top-level `confidence` setting suppresses anything below the threshold:

```toml
confidence = 0.8   # default
# confidence = 0.95  # very strict: only fire when we are nearly sure
```

In practice:

- `0.8` (default) keeps almost everything.
- `0.95`+ filters out marginal calls — useful for noisy rules during initial adoption.
- `<0.5` is rarely useful; you will get reports rules' authors did not want you to see.

Lower it deliberately while debugging a specific rule, then restore it. Do not ship a low `confidence` to teammates without saying so.

---

## 7. Gradual adoption strategy

Inheriting a large untouched repo, the worst move is enabling 30 rules and opening a PR with 4,000 changes. The progression that actually works:

1. **Week 1 — establish the floor.** `revive.toml` with three rules at `error`: `error-return`, `error-strings`, `package-comments`. Fix everything they find. Land it.
2. **Week 2–4 — opinion phase.** Add `var-naming`, `exported`, `if-return`, `unused-parameter` at `warning`. Open one tracking issue listing the findings; chip away in small PRs.
3. **Month 2 — promote.** Move rules to `error` as their backlog reaches zero on main. New violations now block.
4. **Month 3+ — house rules.** Write one or two custom rules for things only your team cares about. Add them only after the catalog ones are stable.

This sequence keeps `git blame` clean and stops linter changes from drowning real work.

---

## 8. Operational considerations

- **Module loading is the slow part.** `revive` calls into the Go toolchain to load packages with `go list`. On a large monorepo this dominates wall time; `-exclude vendor/...` and avoiding `./...` over giant trees matters.
- **Per-rule cost varies wildly.** `unused-parameter` is cheap; rules that re-type-check are not. Profile with `-x` (verbose) when wall time grows.
- **Generated code.** The default behavior skips files with the `// Code generated ... DO NOT EDIT.` header. Verify your generators emit that line; otherwise you will lint code you have no control over.
- **Parallelism.** `revive` processes files in parallel internally. On constrained CI runners, this is fine; on a laptop with other tools running, it can spike CPU.

---

## 9. Summary

`revive` is small at its core: rules implement a two-method interface, the engine fans them out across files, and a TOML config selects and tunes them. As a senior you author *team policy*, not just commands: pick the rule set, document why, ladder severities, triage false positives by fixing config (not by sprinkling directives), and write a custom rule only when no catalogue entry matches. Treat `revive` as one of three complementary tools — `vet` for hard correctness, `staticcheck` for deep checks, `revive` for style — and tune the `confidence` knob deliberately.

---

## Further reading
- `lint.Rule` interface: https://pkg.go.dev/github.com/mgechev/revive/lint
- Rule catalogue: https://github.com/mgechev/revive/blob/master/RULES_DESCRIPTIONS.md
- `golang.org/x/tools/go/analysis` (for contrast): https://pkg.go.dev/golang.org/x/tools/go/analysis
