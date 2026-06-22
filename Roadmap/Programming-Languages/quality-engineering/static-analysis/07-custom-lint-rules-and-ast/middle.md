# Custom Lint Rules & AST — Middle Level

> **Roadmap:** [Static Analysis](../README.md) → Custom Lint Rules & AST
> *Going from "I can write a Semgrep one-liner" to writing precise patterns, real ESLint rules with autofix, and codemods that rewrite code for you.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 -- Semgrep Pattern Language in Depth](#core-concept-1----semgrep-pattern-language-in-depth)
5. [Core Concept 2 -- pattern-inside, pattern-not, and Composing Conditions](#core-concept-2----pattern-inside-pattern-not-and-composing-conditions)
6. [Core Concept 3 -- A Real Worked Rule: "Handlers Must Authorize"](#core-concept-3----a-real-worked-rule-handlers-must-authorize)
7. [Core Concept 4 -- ESLint Custom Rules: Structure](#core-concept-4----eslint-custom-rules-structure)
8. [Core Concept 5 -- ESLint Autofix with the Fixer](#core-concept-5----eslint-autofix-with-the-fixer)
9. [Core Concept 6 -- Codemods: When a Rule Should Rewrite, Not Report](#core-concept-6----codemods-when-a-rule-should-rewrite-not-report)
10. [Real-World Examples](#real-world-examples)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **the full Semgrep pattern language, the anatomy of an ESLint rule including autofix, and the line between a lint rule and a codemod.**

At junior level a rule was a single `pattern:`. Real rules need precision: *"flag `time.Now()` but only inside the `domain/` package," "require an authz call but not when one is already present," "rename this API everywhere and fix it automatically."* That precision comes from composing patterns (`pattern-inside`, `pattern-not`, `metavariable-pattern`) and from dropping down to a native rule API (ESLint, `go/analysis`) when YAML can't express your logic.

This page builds one rule end to end in Semgrep, then rebuilds the same class of rule as a hand-written ESLint rule with an autofix, and finishes on the distinction between a *lint rule* (runs forever, reports) and a *codemod* (runs once, migrates).

---

## Prerequisites

**Required**

- The junior page of this topic — ASTs, the parse/walk/match model, basic Semgrep.
- Comfort reading JavaScript and Go.
- You have used npm and can run a Node script.

**Helpful**

- Familiarity with [AST Explorer](https://astexplorer.net) for inspecting ESTree nodes.
- Basic understanding of the [Linters & Style Checkers](../01-linters-and-style-checkers/) ecosystem.

---

## Glossary

| Term | Meaning |
|---|---|
| Metavariable | `$X`, `$FUNC` — binds to a matched sub-tree and can be reused/checked. |
| `...` (ellipsis) | Matches zero or more arguments, statements, or list elements. |
| `pattern-inside` | Restricts a match to code lexically inside another pattern. |
| `pattern-not` | Excludes matches that also match this sub-pattern. |
| `pattern-either` | Logical OR across several patterns. |
| Taint mode | Semgrep mode that tracks data from a source to a sink. |
| ESTree | The standard AST shape for JavaScript that ESLint uses. |
| Selector | An ESLint string like `CallExpression` that targets a node type. |
| `context.report` | The ESLint call that emits a finding. |
| Fixer | The ESLint object that performs an autofix edit. |
| Codemod | A one-time program that rewrites source en masse for a migration. |

---

## Core Concept 1 -- Semgrep Pattern Language in Depth

The pattern language is small but expressive:

- **`$X`** — a metavariable. Matches any single expression/identifier and *binds* it. Reuse the same name to require the same value: `$X == $X` matches `a == a` (a likely bug), not `a == b`.
- **`...`** — ellipsis. Matches any sequence: arguments (`foo(...)`), statements (`{ ...; risky(); ... }`), or array elements.
- **`"..."`** — matches any string literal.
- **`$FUNC(...)`** — any call to any function with any args.
- **Typed metavariables** (`(user : User)`) — match only when the inferred type is `User`.

Example — find a comparison of a value with itself:

```yaml
rules:
  - id: self-comparison
    languages: [python]
    severity: WARNING
    message: Comparing $X with itself is always true. Likely a typo.
    pattern: $X == $X
```

Because `$X` is bound, this fires on `count == count` but not on `count == limit`. That binding is what makes patterns *semantic*, not textual.

---

## Core Concept 2 -- pattern-inside, pattern-not, and Composing Conditions

A single pattern is rarely enough. Real rules are *boolean combinations* of patterns, evaluated against each AST location:

```yaml
rules:
  - id: no-time-now-in-domain
    languages: [go]
    severity: ERROR
    message: >
      Domain logic must not read the wall clock directly. Inject a Clock
      so behaviour is deterministic and testable.
    patterns:
      - pattern: time.Now()
      - pattern-inside: |
          package domain
          ...
```

The `patterns:` key is an implicit AND: a finding requires *both* that the code is `time.Now()` AND that it sits inside a `domain` package. The most common operators:

- **`pattern`** — must match.
- **`pattern-not`** — must NOT match (subtract false positives).
- **`pattern-inside`** — must be lexically within this larger shape (scope it to a function, package, class).
- **`pattern-not-inside`** — the inverse (e.g. "anywhere except tests").
- **`pattern-either`** — OR; match any of the listed sub-patterns.
- **`metavariable-pattern` / `metavariable-regex`** — constrain a bound metavariable further.

Pruning false positives is almost always done with `pattern-not`:

```yaml
    patterns:
      - pattern: $DB.Query($SQL, ...)
      - pattern-not: $DB.Query("...", ...)   # constant SQL is fine
```

This flags `db.Query(userInput)` but not `db.Query("SELECT 1")`.

---

## Core Concept 3 -- A Real Worked Rule: "Handlers Must Authorize"

The canonical institutional rule: *every HTTP handler must call `authz.Check(...)`.* This is a "required call" rule — harder than "banned call," because you must report the *absence* of something. The trick: match handlers that do **not** contain the required call, using `pattern-inside` + `pattern-not`.

```yaml
rules:
  - id: handler-must-authorize
    languages: [go]
    severity: ERROR
    message: >
      HTTP handler $FUNC does not call authz.Check. Every handler must
      authorize the request before doing work.
    patterns:
      # the function looks like an http.HandlerFunc
      - pattern: |
          func $FUNC(w http.ResponseWriter, r *http.Request) {
            ...
          }
      # ...and it does NOT call authz.Check anywhere inside
      - pattern-not: |
          func $FUNC(w http.ResponseWriter, r *http.Request) {
            ...
            authz.Check(...)
            ...
          }
```

Test fixture (`handler-must-authorize.go`):

```go
package api

// ruleid: handler-must-authorize
func GetUser(w http.ResponseWriter, r *http.Request) {
    id := r.URL.Query().Get("id")
    render(w, lookup(id))
}

// ok: handler-must-authorize
func DeleteUser(w http.ResponseWriter, r *http.Request) {
    authz.Check(r, "user:delete")
    remove(r.URL.Query().Get("id"))
}
```

This single rule encodes a security policy that previously depended on a reviewer remembering to ask "did you check auth?" on every handler PR. (For data-flow-aware versions — "the authorized identity must actually reach the deletion" — see [Taint & Dataflow Analysis](../08-taint-and-dataflow-analysis/).)

---

## Core Concept 4 -- ESLint Custom Rules: Structure

When logic outgrows YAML (you need to inspect scope, types, or do conditional fixes), drop to a native rule. In JavaScript that's an **ESLint rule**: a module with `meta` and `create`.

```js
// rules/no-console-log.js
/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: "suggestion",
    docs: { description: "Disallow console.log; use the logger" },
    messages: {
      noConsole: "Use logger.info(), not console.log().",
    },
    fixable: "code",
    schema: [], // no options
  },
  create(context) {
    return {
      // selector: visit every call expression
      "CallExpression[callee.object.name='console'][callee.property.name='log']"(node) {
        context.report({
          node,
          messageId: "noConsole",
        });
      },
    };
  },
};
```

The pieces:

- **`meta`** — metadata: type, docs, the message catalogue, `fixable`, and an options `schema`.
- **`create(context)`** — returns a **visitor object**. Its keys are **selectors** (ESLint's CSS-like query over [ESTree](https://github.com/estree/estree) nodes). ESLint walks the AST and calls your function whenever a node matches the selector.
- **`context.report({ node, messageId })`** — emits the finding, anchored to a node so the location is precise.

> Build the selector in [astexplorer.net](https://astexplorer.net): paste the bad code, set the parser to *espree*, click the node you want, and read its type and fields. The selector above came straight from inspecting `console.log(x)`.

---

## Core Concept 5 -- ESLint Autofix with the Fixer

A rule earns its keep when it *fixes* the problem. Add a `fix` function to `report`; ESLint gives it a `fixer` whose methods produce text edits.

```js
create(context) {
  const sourceCode = context.getSourceCode();
  return {
    "CallExpression[callee.object.name='console'][callee.property.name='log']"(node) {
      context.report({
        node,
        messageId: "noConsole",
        fix(fixer) {
          // rewrite `console.log` -> `logger.info`, keep the arguments
          return fixer.replaceText(node.callee, "logger.info");
        },
      });
    },
  };
}
```

Run `eslint --fix` and `console.log(x, y)` becomes `logger.info(x, y)` across the repo. Fixer methods you'll use: `replaceText`, `insertTextBefore/After`, `remove`, `replaceTextRange`.

**Safe vs unsafe fixes.** A fix is *safe* only if it never changes behaviour and never breaks code. `console.log -> logger.info` is borderline: it's safe *only if* `logger` is imported in that file. A robust rule checks that import exists (or adds it) before offering the fix. ESLint distinguishes `fix` (applied by `--fix`) from `suggest` (offered to the human but not auto-applied) precisely for fixes that need judgement.

---

## Core Concept 6 -- Codemods: When a Rule Should Rewrite, Not Report

A **lint rule** runs forever and *reports* a recurring problem. A **codemod** runs *once* and *transforms* code for a migration — renaming an API, changing a call signature, swapping a library. Both operate on the AST; the difference is lifecycle and intent.

| | Lint rule | Codemod |
|---|---|---|
| Runs | every commit / CI | once, then deleted |
| Output | a finding (warning/error) | rewritten source |
| Goal | prevent future violations | migrate existing code |
| Tools | ESLint, Semgrep, `go vet` | jscodeshift, ast-grep, `gofmt -r`, comby |

**`gofmt -r`** — the simplest codemod, a syntactic rewrite rule:

```bash
gofmt -r 'oldclient.New(a) -> newclient.Connect(a)' -w ./...
```

**ast-grep** — language-agnostic, pattern in / pattern out:

```bash
ast-grep --pattern 'console.log($A)' --rewrite 'logger.info($A)' --lang js -U
```

**jscodeshift** — programmatic, for non-trivial JS migrations:

```js
// transform.js
module.exports = function (file, api) {
  const j = api.jscodeshift;
  return j(file.source)
    .find(j.CallExpression, {
      callee: { object: { name: "console" }, property: { name: "log" } },
    })
    .forEach((path) => {
      path.node.callee.object.name = "logger";
      path.node.callee.property.name = "info";
    })
    .toSource();
};
```

```bash
jscodeshift -t transform.js src/
```

> Rule of thumb: if you want the *existing* code fixed *now*, you want a codemod. If you want *future* code to stay clean, you want a lint rule. Big migrations use both: a codemod to fix what exists, then a lint rule to stop regressions.

---

## Real-World Examples

**1. Ban a deprecated import, anywhere but tests (Semgrep):**

```yaml
rules:
  - id: no-legacy-pkg
    languages: [go]
    severity: WARNING
    message: legacypkg is deprecated; migrate to newpkg.
    patterns:
      - pattern: legacypkg.$F(...)
      - pattern-not-inside: |
          func Test$T(t *testing.T) { ... }
```

**2. Require `key` on every JSX list item (ESLint selector):** visit `JSXElement` inside `CallExpression[callee.property.name='map']` and report when no `key` attribute is present — the logic behind `react/jsx-key`.

**3. Migrate `moment()` to `dayjs()` (ast-grep codemod):**

```bash
ast-grep --pattern 'moment($$$ARGS)' --rewrite 'dayjs($$$ARGS)' --lang ts -U
```

---

## Mental Models

- **A pattern is a query, not a string.** `pattern-inside` and `pattern-not` are the WHERE clause; metavariables are the SELECT.
- **Required-call rules = match the function that *lacks* the call.** Report absence by subtracting presence with `pattern-not`.
- **ESLint `create` returns a visitor.** Selectors are CSS for the AST; your function fires on the hit.
- **Lint = guard the future, codemod = fix the past.** Same AST, opposite lifecycle.
- **Autofix is editing text by pointing at nodes.** The fixer turns "this node" into "this new text."

---

## Common Mistakes

- **Forgetting `pattern-not-inside` for tests.** Your "no `time.Now()`" rule screams at every test helper. Carve out tests explicitly.
- **Over-broad selectors in ESLint.** `CallExpression` alone fires on *every* call; narrow with attribute selectors or you'll tank performance and emit noise.
- **Unsafe autofixes.** Replacing `console.log` with `logger.info` in a file with no `logger` import produces code that doesn't compile. Verify preconditions or use `suggest`.
- **Writing a codemod when you wanted a rule (or vice versa).** A codemod doesn't stop the next developer; a lint rule doesn't fix the 4,000 existing call sites.
- **Building the selector by guessing.** Use AST Explorer; the node shape is rarely what you'd assume.
- **No fixtures.** Native and YAML rules both need valid/invalid test cases or they rot.

---

## Test Yourself

1. What does reusing `$X` twice in one pattern enforce?
2. How do you write a Semgrep rule that fires only inside a specific package?
3. Why does "every handler must call authz" require `pattern-not` rather than `pattern`?
4. In an ESLint rule, what does `create(context)` return, and how is it used?
5. What's the difference between an ESLint `fix` and a `suggest`?
6. You need to rename `oldclient.New` to `newclient.Connect` across 800 files *and* prevent it coming back. What two tools do you reach for?

---

## Cheat Sheet

```text
SEMGREP OPERATORS
  $X            metavariable (binds; reuse = same value)
  ...           ellipsis: any args/statements/elements
  "..."         any string literal
  patterns:     AND of sub-patterns
  pattern       must match
  pattern-not   must NOT match  (kill false positives)
  pattern-inside / pattern-not-inside   scope to a region
  pattern-either                        OR
  metavariable-regex / metavariable-pattern   constrain a binding

REQUIRED-CALL RULE
  pattern:     func handler(...) { ... }
  pattern-not: func handler(...) { ... required.Call(...) ... }

ESLINT RULE
  meta:   { type, docs, messages, fixable, schema }
  create(context) -> { "Selector"(node) { context.report({...}) } }
  selector: CallExpression[callee.object.name='console'][callee.property.name='log']
  fix(fixer): replaceText | insertTextBefore/After | remove
  fix vs suggest: auto-applied vs offered-to-human

CODEMODS (run once)
  gofmt -r 'old(a) -> new(a)' -w ./...
  ast-grep --pattern 'console.log($A)' --rewrite 'logger.info($A)' -U
  jscodeshift -t transform.js src/

  LINT = guard the future   |   CODEMOD = fix the past
```

---

## Summary

Real custom rules are precise: Semgrep patterns compose with `pattern-inside`, `pattern-not`, and bound metavariables so you can say "`time.Now()`, but only in `domain/`" or "a handler that lacks an authz call." When YAML can't express the logic, you drop to a native rule: an ESLint module is `meta` plus a `create` that returns a selector-keyed visitor, reports via `context.report`, and can autofix through the `fixer` — distinguishing safe `fix` from human-reviewed `suggest`. Finally, a lint rule and a codemod share the AST but differ in lifecycle: rules guard the future and run forever; codemods (`gofmt -r`, ast-grep, jscodeshift) fix the past and run once. Large migrations use both.

---

## Further Reading

- *ESLint — Custom Rules* and *Working with Rules* (official docs).
- *Semgrep — Pattern Syntax* and *Rule Syntax* reference.
- *ast-grep* docs (ast-grep.github.io) — pattern/rewrite codemods.
- *jscodeshift* README and *AST Explorer* (set transform to jscodeshift to prototype).
- The `refactoring-techniques` skill — for understanding the behaviour-preserving transforms a codemod should perform.

---

## Related Topics

- [Linters & Style Checkers](../01-linters-and-style-checkers/) — the host tools for your rules.
- [SAST Security Scanners](../04-sast-security-scanners/) — security rules built on the same engines.
- [Taint & Dataflow Analysis](../08-taint-and-dataflow-analysis/) — when "did the call happen" must become "did the data flow."
- [Dead Code & Complexity](../05-dead-code-and-complexity/) — analyzers that also walk the AST.
- Senior level of this topic — `go/analysis` analyzers, testing, and rollout strategy.
