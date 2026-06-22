# Custom Lint Rules & AST — Junior Level

> **Roadmap:** [Static Analysis](../README.md) → Custom Lint Rules & AST
> *The moment you stop only running other people's linters and write your own rule that enforces a thing your team actually cares about.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 -- Why Off-the-Shelf Linters Are Not Enough](#core-concept-1----why-off-the-shelf-linters-are-not-enough)
5. [Core Concept 2 -- What an AST Is](#core-concept-2----what-an-ast-is)
6. [Core Concept 3 -- Every Linter Is an AST Matcher](#core-concept-3----every-linter-is-an-ast-matcher)
7. [Core Concept 4 -- Your First Custom Rule with Semgrep](#core-concept-4----your-first-custom-rule-with-semgrep)
8. [Core Concept 5 -- Reading and Testing Your Rule](#core-concept-5----reading-and-testing-your-rule)
9. [Real-World Examples](#real-world-examples)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **why teams write their own rules, what an AST is, and how to ship a working custom rule in an afternoon using Semgrep.**

A linter like ESLint or `go vet` knows about the *language*. It knows that an unused variable is suspicious and that comparing with `==` instead of `===` is risky. What it cannot know is your codebase's private rules: "nobody calls `time.Now()` inside domain logic," "every HTTP handler must check authorization," "use our `logger`, never `fmt.Println`." Those are *your* invariants, and no shipped linter will ever guess them.

A custom lint rule is how you teach a machine those invariants so a reviewer never has to type "please use the logger" again. The mechanism underneath every linter is the same: source code gets turned into a tree — the **AST** — and a rule is a pattern that matches part of that tree. Once you see code as a tree, writing a rule stops being magic and becomes "find this shape, complain about it."

---

## Prerequisites

**Required**

- You can read a small function in one language (examples use JavaScript, Go, and Python).
- You have run an existing linter before (see [Linters & Style Checkers](../01-linters-and-style-checkers/)).
- You can install a command-line tool and run it on a folder.

**Helpful**

- A vague sense of how a compiler reads code (it does *not* read it line by line as text).
- Comfort editing YAML.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| AST | Abstract Syntax Tree — your code represented as a tree of nodes instead of a string of characters. |
| Node | One element of the tree: a function call, a variable, an `if`, a string literal. |
| Parser | The program that turns source text into an AST. |
| Visit / walk | Stepping through every node of the tree, one at a time. |
| Custom rule | A check you wrote yourself, encoding a rule specific to your team. |
| Pattern | A "shape" of code you want to find (or forbid). |
| Metavariable | A placeholder in a pattern that matches *anything*, e.g. `$X`. |
| Semgrep | A tool where you write rules as code patterns in YAML, no parser knowledge needed. |
| Diagnostic / finding | One reported match: a file, a line, and a message. |
| Autofix | A rule that doesn't just complain — it rewrites the code for you. |

---

## Core Concept 1 -- Why Off-the-Shelf Linters Are Not Enough

Shipped linters enforce language-wide truths. They are excellent at "this is dead code" and useless at "this violates *our* architecture," because they have never seen your architecture.

Things only *you* know, that a custom rule can enforce:

- **"Never call `time.Now()` in domain logic."** Domain code should take time as a parameter so tests are deterministic.
- **"Every HTTP handler must call `authorize(...)`."** A forgotten check is a security hole.
- **"The `web` layer must not import the `db` package directly."** That would break your layering.
- **"Use our `log` package, never `fmt.Println`."** Stray prints bypass structured logging.
- **"Don't use `any` / `interface{}` in public APIs."**

Each of these is *institutional knowledge*. Today it lives in a senior engineer's head and gets repeated in code review forever. A custom rule turns that knowledge into an enforced policy that runs automatically and never gets tired.

> The test for "should this be a rule?": *Have we said the same thing in review more than three times?* If yes, it wants to be a rule.

---

## Core Concept 2 -- What an AST Is

Your code is text. A computer cannot reason about text directly — `"if (x > 0)"` is just characters. So a **parser** turns it into a tree of meaning. There are three stages:

```
source text  ->  tokens  ->  parse tree  ->  AST
"x > 0"          [x][>][0]   structured     simplified tree
```

- **Tokens** are the words: `x`, `>`, `0`.
- The **AST** is the meaning: "a comparison, whose operator is `>`, whose left side is the variable `x`, whose right side is the number `0`."

Take this snippet:

```js
if (user.age > 18) {
  greet(user);
}
```

Its AST looks roughly like this:

```
IfStatement
├── test: BinaryExpression (>)
│   ├── left:  MemberExpression (user.age)
│   │   ├── object:   Identifier (user)
│   │   └── property: Identifier (age)
│   └── right: Literal (18)
└── consequent: BlockStatement
    └── ExpressionStatement
        └── CallExpression
            ├── callee:    Identifier (greet)
            └── arguments: [ Identifier (user) ]
```

Every name (`IfStatement`, `CallExpression`, `Literal`) is a **node type**. A rule is just: "find me every node of type *X* that also looks like *Y*."

> **Abstract** means details that don't change meaning are dropped — whitespace, comments, the exact parentheses. A **concrete** syntax tree (parse tree) keeps every token including punctuation. Lint rules almost always work on the AST, because they care about meaning, not formatting.

---

## Core Concept 3 -- Every Linter Is an AST Matcher

This is the unlock. ESLint, `go vet`, Pylint, Clippy — under the hood every one of them does the same three things:

1. **Parse** the file into an AST.
2. **Walk** every node of the tree.
3. **At each node, ask "does this match a rule?"** and report if it does.

So the rule "no `fmt.Println`" is, in plain terms: *walk the tree; at every function-call node, check if the function being called is `fmt.Println`; if so, report it.*

```
walk the tree
  └── reach a CallExpression node
        └── is the callee "fmt.Println"?
              ├── yes -> report "use the logger"
              └── no  -> keep walking
```

You don't have to write the parser or the walker — every ecosystem gives you those for free. You only write step 3: the matching condition and the message. That is what "writing a lint rule" means.

---

## Core Concept 4 -- Your First Custom Rule with Semgrep

The lowest-barrier way to write a custom rule is **Semgrep**. You write a *pattern that looks like the code you want to find*, not tree-node names. Semgrep parses both your pattern and your code into ASTs and matches them.

Goal: **ban `fmt.Println` in Go production code.** Save this as `no-println.yml`:

```yaml
rules:
  - id: no-fmt-println
    languages: [go]
    severity: WARNING
    message: >
      Use the structured logger (log.Info), not fmt.Println.
      Stray prints bypass log levels and formatting.
    pattern: fmt.Println(...)
```

Two pieces of magic:

- `fmt.Println(...)` is just *Go code*. The `...` is a metavariable meaning "any arguments."
- Semgrep matches it against the AST, so `fmt.Println("hi")`, `fmt.Println(a, b)`, and `fmt . Println(x)` (odd spacing) all match. A `grep` for the text would miss the spaced one and would match it inside a comment.

Run it:

```bash
semgrep --config no-println.yml ./...
```

Output:

```
handlers/user.go
   12┊ fmt.Println("created user", id)
        Use the structured logger (log.Info), not fmt.Println.
```

You just shipped a custom rule. No parser, no plugin, no compiler knowledge.

---

## Core Concept 5 -- Reading and Testing Your Rule

A rule you can't test is a rule you can't trust. Semgrep has built-in testing: put example code next to the rule and annotate the lines that *should* match.

`no-println.go` (the test fixture):

```go
package demo

import "fmt"

func bad() {
    // ruleid: no-fmt-println
    fmt.Println("this should be caught")
}

func good() {
    // ok: no-fmt-println
    log.Info("this is fine")
}
```

The comments are the contract: `ruleid:` means "the next line MUST be flagged," `ok:` means "the next line must NOT be flagged." Run:

```bash
semgrep --test --config no-println.yml
```

Semgrep checks that reality matches your annotations and prints `1/1 passed`. Now you have a **valid case** (the logger call, which must stay quiet) and an **invalid case** (the print, which must be flagged). That valid/invalid pair is the heart of every lint-rule test in every ecosystem.

> Always write the *valid* case too. A rule that fires on the bad code but *also* fires on good code is worse than no rule — it trains people to ignore it.

---

## Real-World Examples

**1. Stop console logging shipping to production (JS).**

```yaml
rules:
  - id: no-console-log
    languages: [javascript, typescript]
    severity: ERROR
    message: Remove console.log before merging; use the logger.
    pattern: console.log(...)
```

**2. Forbid a dangerous function (Python `eval`).**

```yaml
rules:
  - id: no-eval
    languages: [python]
    severity: ERROR
    message: eval() executes arbitrary code. Use ast.literal_eval or a parser.
    pattern: eval(...)
```

**3. Find a deprecated internal API call.**

```yaml
rules:
  - id: no-legacy-client
    languages: [go]
    severity: WARNING
    message: oldclient.New is deprecated; use newclient.Connect.
    pattern: oldclient.New(...)
```

Each one started as a sentence a human kept repeating in review. Now it's a rule.

---

## Mental Models

- **Code is a tree, not a string.** The instant you picture `if`, calls, and literals as nested boxes, lint rules become "find this box shape."
- **A linter is parse + walk + match.** You only ever write the *match*.
- **A pattern is a photograph of bad code.** Semgrep: write what the bug looks like, let the tool find every copy.
- **A rule is a frozen code review.** Anything you'd say in review more than a handful of times wants to be a rule.

---

## Common Mistakes

- **Using `grep` instead of an AST tool.** `grep "fmt.Println"` matches comments, strings, and misses `fmt . Println`. ASTs match meaning.
- **Writing the rule without a test fixture.** You will not know if it actually fires until it nags the wrong person.
- **Forgetting the "good" example.** Only testing that bad code is caught; never checking that good code is left alone leads to false positives.
- **Setting severity to ERROR on day one.** A brand-new rule that blocks merges immediately makes people hate it. Start as a warning.
- **Trying to write an ESLint plugin first.** For 80% of "ban X / require Y" rules, Semgrep is faster and needs no parser knowledge.

---

## Test Yourself

1. What are the three stages from source code to AST?
2. Why does a custom rule catch things `go vet` never will?
3. In the Semgrep pattern `fmt.Println(...)`, what does `...` mean?
4. Why is matching on the AST better than `grep` for "ban `fmt.Println`"?
5. What do the `ruleid:` and `ok:` comments do in a Semgrep test file?
6. Give one rule your current team could use that no shipped linter knows.

---

## Cheat Sheet

```text
WHY CUSTOM RULES   encode invariants no shipped linter knows
                   ("no time.Now() in domain", "handlers must authz")

AST                source -> tokens -> parse tree -> AST (tree of nodes)
                   every node has a type: CallExpression, IfStatement, Literal
                   abstract = drops whitespace/comments; concrete = keeps all tokens

EVERY LINTER       parse -> walk every node -> match -> report
                   you only write the match + message

SEMGREP (easiest)  pattern = code that looks like the bug
                   $X   = metavariable (matches a thing)
                   ...  = matches anything (args, statements)

  semgrep --config rule.yml ./...     # run
  semgrep --test  --config rule.yml   # test against fixtures

TEST FIXTURE       // ruleid: my-rule   -> next line MUST match
                   // ok: my-rule       -> next line must NOT match

ROLLOUT            start severity: WARNING, not ERROR
```

---

## Summary

Shipped linters know the language; only you know your codebase's invariants. A custom lint rule encodes one of those invariants so it's enforced automatically forever. The mechanism is always the same: source becomes an **AST** (a tree of typed nodes), a linter **walks** that tree, and a **rule** matches a node shape and reports it. The fastest way in is **Semgrep**, where a rule is just a code-shaped pattern in YAML with `$X` and `...` placeholders — and you can unit-test it with `ruleid:`/`ok:` fixtures before anyone else sees it. Start every new rule as a warning, ship the good-code test alongside the bad, and you've turned a repeated review comment into permanent policy.

---

## Further Reading

- *Semgrep — Getting Started* (official docs): writing your first rule.
- *Semgrep Playground* (semgrep.dev/playground): write and test rules in the browser.
- *AST Explorer* (astexplorer.net): paste code, see its AST live.
- *Crafting Interpreters* by Robert Nystrom — the "Scanning" and "Parsing" chapters explain tokens and ASTs gently.

---

## Related Topics

- [Linters & Style Checkers](../01-linters-and-style-checkers/) — the tools your custom rules extend.
- [SAST Security Scanners](../04-sast-security-scanners/) — many are custom rules focused on security.
- [Taint & Dataflow Analysis](../08-taint-and-dataflow-analysis/) — rules that follow data, not just match shapes.
- [Static Analysis in CI](../09-static-analysis-in-ci/) — where your rules actually run.
- Middle level of this topic — Semgrep in depth and writing real ESLint rules.
