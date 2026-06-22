# Custom Lint Rules & AST — Interview Level

> **Roadmap:** [Static Analysis](../README.md) → Custom Lint Rules & AST
> *The question bank: ASTs, when to write a rule, Semgrep vs. native, codemods, rollout, and the senior judgment of when a rule is the wrong tool.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Fundamentals](#fundamentals)
4. [Technique](#technique)
5. [Rule Design](#rule-design)
6. [Scenarios](#scenarios)
7. [Rapid-Fire](#rapid-fire)
8. [Red Flags / Green Flags](#red-flags--green-flags)
9. [Cheat Sheet](#cheat-sheet)
10. [Summary](#summary)
11. [Further Reading](#further-reading)
12. [Related Topics](#related-topics)

---

## Introduction

> Focus: **answering "could you write a custom lint rule?" with the depth that distinguishes someone who has shipped one — tested, rolled out, and known when not to bother.**

Interviewers probe custom rules to see whether you understand that tooling is leverage *and* a liability. Anyone can recite "code becomes an AST." The signal is in the judgment: choosing Semgrep over a native analyzer, recognizing when a type beats a rule, rolling out without breaking every build, and quantifying ROI. Answers below use **Q** / *what's really being tested* / **A** format.

---

## Prerequisites

- The junior through senior pages of this topic.
- You can sketch an AST and a Semgrep rule on a whiteboard.
- Familiarity with at least one rule ecosystem (ESLint, `go/analysis`, Semgrep) hands-on.

---

## Fundamentals

**Q1. Walk me from source code to a lint finding. What's an AST and where does it sit?**
*Tests: the core mental model.*
**A.** Source text -> a **lexer** produces **tokens** -> a **parser** builds a tree. The **concrete syntax tree** keeps every token (punctuation, whitespace); the **AST** drops detail irrelevant to meaning and keeps structure: an `if` node with a test and a body, a call node with a callee and arguments, literals, identifiers. Every node has a *type*. A linter then **walks** the AST and at each node asks "does this match a rule?" If yes, it reports a diagnostic anchored to that node's source position. So a lint rule is fundamentally an AST matcher: parse, walk, match, report. The parser and walker come free from the ecosystem; you write only the match and message.

**Q2. Why write a custom rule at all — what can't ESLint or `go vet` do out of the box?**
*Tests: motivation; that you grasp the limits of shipped tooling.*
**A.** Shipped linters know the *language*, not your *codebase's invariants*. They can't know "no `time.Now()` in domain logic," "every handler must call authz," "the web layer must not import db," "use our logger not `fmt.Println`." Those are institutional knowledge that today lives in senior heads and gets repeated in review forever. A custom rule encodes that knowledge as enforced policy that runs automatically and never forgets. The trigger: if you've made the same review comment more than a few times, it wants to be a rule (or, better, a type).

**Q3. Concrete vs. abstract syntax tree — why do rules use the AST?**
*Tests: precision.*
**A.** The concrete tree (parse tree) preserves every token including parentheses and whitespace — useful for a formatter that must round-trip exact text. The AST abstracts those away, keeping only meaning. Lint rules care about meaning ("is this a call to `fmt.Println`?"), not formatting, so they match on the AST. That's also why AST matching beats `grep`: it ignores comments and string contents and tolerates `fmt . Println` spacing, because it matches structure, not characters.

---

## Technique

**Q4. You need to ban `fmt.Println` in production code. Write it in Semgrep, then sketch the native version. When would you use each?**
*Tests: the tool-selection decision, hands-on.*
**A.** Semgrep first — it's a day of work, no parser knowledge:

```yaml
rules:
  - id: no-fmt-println
    languages: [go]
    severity: WARNING
    message: Use log.Info, not fmt.Println.
    patterns:
      - pattern: fmt.Println(...)
      - pattern-not-inside: func Test$T(t *testing.T) { ... }
```

I'd reach for a native `go/analysis` analyzer only if I needed something Semgrep can't express — type resolution, cross-file symbols, or a conditional autofix. The native version is an `Analyzer` with a `run(pass)` that uses the shared `inspector` to visit `*ast.CallExpr` nodes, checks the selector is `fmt.Println`, skips `_test.go`, and calls `pass.Report` (optionally with a `SuggestedFix` replacing `fmt.Println` with `log.Info`). More code, but full access to `pass.TypesInfo`. Decision rule: **start in Semgrep; graduate to native when a concrete false-positive class proves syntax isn't enough.**

**Q5. What do `$X` and `...` mean in Semgrep, and what does reusing `$X` buy you?**
*Tests: pattern-language literacy.*
**A.** `$X` is a metavariable that matches a single expression/identifier and *binds* it. `...` is an ellipsis matching any sequence — args (`foo(...)`), statements, or list elements. Reusing a bound metavariable enforces equality: `$X == $X` matches `a == a` (a likely bug) but not `a == b`. That binding is what makes patterns semantic rather than textual. You prune false positives with `pattern-not`, scope with `pattern-inside` / `pattern-not-inside`, and OR with `pattern-either`.

**Q6. How do you write a rule that requires a call — "every handler must call authz"?**
*Tests: that you can express *absence*, the harder case.*
**A.** You can't match the missing call directly; you match the function that *lacks* it. Match the handler shape with `pattern`, then subtract handlers that *do* contain the call with `pattern-not`:

```yaml
patterns:
  - pattern: |
      func $F(w http.ResponseWriter, r *http.Request) { ... }
  - pattern-not: |
      func $F(w http.ResponseWriter, r *http.Request) { ... authz.Check(...) ... }
```

Caveat: this proves the call *appears* in the function, not that the authorized identity actually reaches the protected action — that's data flow. If the interviewer pushes on "but what if they call authz on the wrong resource?", the answer is taint/dataflow analysis, not pattern matching.

**Q7. Sketch an ESLint rule with an autofix. What's the difference between a fix and a suggestion?**
*Tests: native-rule structure and fix safety.*
**A.** A rule is a module with `meta` and `create`. `create(context)` returns a visitor keyed by selectors; ESLint calls your function on each matching node; you `context.report({ node, messageId, fix })`. The `fix(fixer)` returns text edits (`fixer.replaceText(node.callee, "logger.info")`). Run `eslint --fix` to apply. A **fix** is auto-applied by `--fix` and must be *safe* — never change behaviour, never break code (e.g. `console.log -> logger.info` is only safe if `logger` is imported). A **suggestion** is offered to the human but not auto-applied — used when the transform needs judgment. Unsafe auto-fixes are the cardinal sin; when in doubt, suggest.

---

## Rule Design

**Q8. A new rule must go live on a large existing codebase. How do you roll it out?**
*Tests: operational maturity; that you won't break everyone's build.*
**A.** Never flip straight to error. Three stages: **(1) Warn** — ship as a warning; CI stays green, violations are visible, watch for false positives for a sprint or two. **(2) Baseline** — snapshot existing violations and have the gate ignore them but fail on any *new* one (`golangci-lint --new-from-rev`, `semgrep --baseline-commit`); now the codebase can only improve. **(3) Error** — once the baseline is burned down (a codemod clears the backlog), flip to error and delete the baseline. Throughout, the diagnostic message must say what to do *instead*, and there must be a documented escape hatch.

**Q9. How do you test a custom rule, and why does it matter so much?**
*Tests: that you treat rules as production code.*
**A.** Every ecosystem has the same valid/invalid contract. ESLint's `RuleTester` takes `valid` cases (must stay silent) and `invalid` cases (must fire, with expected `output` for fixes). Go's `analysistest` runs against fixtures annotated with `// want` and asserts *exactly* those lines fire — extra findings fail too — with `RunWithSuggestedFixes` diffing the fix against a golden file. Semgrep uses `--test` with `ruleid:`/`ok:` comments. It matters because a single false positive on a respected engineer's PR teaches the whole team to reflexively suppress, at which point the rule — and trust in the linter — is worth nothing.

**Q10. When is a custom rule the *wrong* tool? What beats it?**
*Tests: the senior judgment that separates levels.*
**A.** A rule is high-cost forever: maintenance, CI time, false-positive friction. The decisive question is *can I make the wrong thing impossible to write rather than merely flagged?*
- If a **type** can forbid it (mixing `UserID`/`OrderID` strings -> a newtype makes it a compile error), prefer the type — cheaper and unbypassable.
- If a **wrapper API** can remove the dangerous primitive (inject a `Clock` so `time.Now()` isn't reachable in domain), prefer that.
- If it's a **one-off**, a review comment costs nothing; a rule costs forever.
- A rule is genuinely right when the violation is *valid code no type or API can forbid* and *recurs often* — "use our logger not `fmt.Println`" (can't delete `fmt`), "web must not import db" (language won't enforce layering, so a rule or `depguard`).

---

## Scenarios

**Q11. You're migrating an API — `oldClient.fetch` to `httpClient.get` — across a monorepo of thousands of call sites. Plan it.**
*Tests: codemod-at-scale judgment.*
**A.** A codemod, not a manual slog. (1) **Scope**: count call sites with `ast-grep --pattern 'oldClient.fetch($$$)'` to know the blast radius. (2) **Write** the codemod — jscodeshift for complex TS, ast-grep for simple pattern->pattern. (3) **Dry-run** without writing; review the diff on a sample; measure the long tail it can't safely transform. (4) **Shard** into owner-sized PRs (per package / codeowner), never one 50k-line PR. (5) **Hand-fix** the residue. (6) **Lock** with a lint rule banning `oldClient.fetch` so it can't regress. The mantra: *codemod the past, lint the future.*

**Q12. Lint rule vs. codemod — what's the difference?**
*Tests: a distinction people blur.*
**A.** Same AST machinery, opposite lifecycle. A **lint rule** runs forever in CI and *reports* a recurring problem — it guards the future. A **codemod** runs *once* and *rewrites* source for a migration — it fixes the past, then gets deleted. Big migrations use both: a codemod to fix the existing call sites, then a lint rule so the old pattern can't come back. Tools: ESLint/Semgrep/`go vet` for rules; jscodeshift/ast-grep/`gofmt -r`/comby/OpenRewrite for codemods.

**Q13. Your org has 40 repos. How do you run custom rules consistently without copy-pasting?**
*Tests: rules-as-a-product thinking.*
**A.** A versioned, distributed rules library owned by a platform team — published as `@acme/eslint-config`/`-plugin`, a shared golangci config, a Semgrep registry, or OpenRewrite/Error Prone artifacts. Repos consume it as a dependency (`extends: ["@acme"]`). Distribution should be **pinned with an automated bump bot**, and new rules land as **warnings** first so an upgrade can't redden a build — that gives controlled rollout *and* convergence. The library needs per-rule tests, docs (the "why"), a maturity ladder (experimental -> stable -> enforced), and a deprecation policy, or it sprawls into 200 unowned rules that just tax CI.

**Q14. When do you need a *type-aware* rule, and what changes?**
*Tests: the syntax-vs-semantics boundary.*
**A.** When the rule says "of type X," "that implements Y," or "that refers to Z." Pure syntax can't tell `db.Close()` (`*sql.DB`) from `file.Close()` (`*os.File`) — both are `X.Close()`. A type-aware rule resolves the receiver's actual type via `go/types` (`pass.TypesInfo`) or `@typescript-eslint`'s type checker (`context.getTypeChecker()`). That's what enables `errcheck` (unhandled error returns) or `no-floating-promises` (the value is actually a `Promise`). If you tried these in Semgrep you'd get false positives, because Semgrep matches mostly on syntax. Type info is the reason to leave Semgrep for a native analyzer.

---

## Rapid-Fire

**Q15.** *Three stages source -> AST?* Tokens (lexer), parse tree (parser), AST.
**Q16.** *Why AST over grep?* Matches meaning; ignores comments/strings; tolerant of spacing.
**Q17.** *Semgrep `...` means?* Any sequence of args/statements/elements.
**Q18.** *Where to inspect a JS AST?* astexplorer.net (ESTree / espree).
**Q19.** *ESLint `create` returns?* A visitor object keyed by node selectors.
**Q20.** *How does ESLint autofix?* `fix(fixer)` returns text edits; `--fix` applies them.
**Q21.** *Go's analyzer framework?* `go/analysis` (`Analyzer` + `Pass` + `inspector`).
**Q22.** *Why `Requires: inspect.Analyzer`?* Reuse the shared, efficient AST traversal.
**Q23.** *Test a Go analyzer with?* `analysistest` + `// want` fixtures.
**Q24.** *Rollout order?* Warn -> baseline -> error.
**Q25.** *Type-aware Java refactor tool at scale?* OpenRewrite (recipes on a lossless semantic tree).
**Q26.** *Prune Semgrep false positives with?* `pattern-not` / `pattern-not-inside`.
**Q27.** *Rule vs codemod in one line?* Rule guards the future; codemod fixes the past.
**Q28.** *Cheaper, stronger alternative to a rule?* A type/newtype or wrapper API that makes the bad code impossible.

---

## Red Flags / Green Flags

**Red flags**
- "I'd just `grep` for it." Misses spacing, hits comments/strings — doesn't understand AST matching.
- Reaches for a native plugin for a simple "ban X" rule — over-engineering; Semgrep was a day's work.
- Flips a new rule to `error` on a large codebase immediately — will break every build.
- Ships a rule with no tests, or only tests that it fires (never that good code stays silent).
- Treats rules as free; no notion of false-positive cost, CI time, or maintenance.
- Writes a rule for something a type could forbid at compile time.
- Proposes one giant codemod PR, or applies a codemod without a dry-run.

**Green flags**
- Pictures code as a tree and "parse-walk-match-report" without prompting.
- Starts in Semgrep, graduates to native only when types/cross-file/flow demand it.
- Names the warn -> baseline -> error rollout unprompted.
- Insists on valid *and* invalid test cases and on testing fixed output.
- Asks "can a type or wrapper make this impossible instead?" — mechanism selection.
- "Codemod the past, lint the future" for migrations; shards PRs by owner.
- Thinks about false-positive/suppression rate and rules-as-a-product at org scale.

---

## Cheat Sheet

```text
PIPELINE     source -> tokens -> parse tree -> AST ; linter = parse,walk,match,report
WHY CUSTOM   encode YOUR invariants (no time.Now in domain, handlers must authz)
AST > grep   matches meaning, ignores comments/strings, tolerant of spacing

SEMGREP      $X metavar(binds) | ... any seq | pattern-not(prune) | pattern-inside(scope)
  required-call rule = match fn, pattern-not the fn-that-has-the-call
NATIVE when  needs types / cross-file / flow / conditional fix
  go/analysis: Analyzer{Name,Run,Requires:inspect} ; run(pass) inspector.Preorder ; pass.Report
  ESLint: meta + create(context)->{Selector(node){context.report({node,messageId,fix})}}
  fix(auto, must be safe) vs suggest(human-reviewed)

TEST   RuleTester{valid,invalid,output} | analysistest+//want | semgrep --test (ruleid/ok)
ROLLOUT  warn -> baseline(--new-from-rev / --baseline-commit) -> error  (+ codemod backlog)
RULE vs CODEMOD  guard the future  |  fix the past, run once
MIGRATION  scope->write->dry-run->shard-by-owner->hand-fix->LOCK with a rule
  ast-grep | jscodeshift | gofmt -r | comby | OpenRewrite(JVM, type-aware)
MECHANISM LADDER  type/newtype > wrapper API > lint rule > review comment
  ask: make it IMPOSSIBLE, not just flagged?
ORG SCALE  rules = product: owner, versioned distribution(pinned+bot+warn-first),
           tests, docs(why), maturity ladder, deprecation; guard against sprawl
```

---

## Summary

A strong interview answer treats a custom rule as both leverage and liability. You can explain the AST pipeline (tokens -> parse tree -> AST) and that every linter is parse-walk-match-report; motivate custom rules as encoding invariants no shipped linter knows; and write the canonical examples — a Semgrep "ban `fmt.Println`" rule, the `pattern-not` trick for "handlers must authorize," an ESLint rule with a safe `fix`, and a `go/analysis` analyzer when type information is needed. Above the mechanics is judgment: choose Semgrep before native, roll out warn -> baseline -> error, test valid *and* invalid cases, distinguish a guard rule from a one-shot codemod, codemod the past and lint the future for migrations, and — the senior signal — prefer a type or wrapper API that makes the wrong code impossible over a rule that merely flags it, while keeping the org's rule set small and owned.

---

## Further Reading

- *Semgrep — Pattern & Rule Syntax* docs; *ESLint — Custom Rules*; *golang.org/x/tools/go/analysis*.
- *AST Explorer* (astexplorer.net) — practice reading node shapes before an interview.
- *Google — Lessons from Building Static Analysis Tools at Google* — false-positive budgets and adoption.
- *OpenRewrite* and *jscodeshift* / *ast-grep* docs — codemods at scale.

---

## Related Topics

- [Linters & Style Checkers](../01-linters-and-style-checkers/) — the host tools and shared configs.
- [SAST Security Scanners](../04-sast-security-scanners/) — security rules on the same engines.
- [Taint & Dataflow Analysis](../08-taint-and-dataflow-analysis/) — where "did the call happen" becomes "did the data flow."
- [Static Analysis in CI](../09-static-analysis-in-ci/) — baselines, gating, and rollout in practice.
- Senior and Professional levels of this topic — native analyzers, testing, and rules-as-a-product.
