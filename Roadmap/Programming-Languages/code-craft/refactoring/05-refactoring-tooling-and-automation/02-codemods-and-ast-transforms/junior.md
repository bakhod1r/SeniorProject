# Codemods & AST Transforms — Junior

> **Source:** Facebook jscodeshift; OpenRewrite docs; Instagram/Meta LibCST

A **codemod** is a program that edits other programs. Instead of you opening 800 files and changing the same thing 800 times by hand, you write one small script that understands your code's *structure* and applies the change everywhere — correctly, consistently, and in seconds.

The word is short for "code modification." The technique that makes codemods reliable is the **AST transform**: you don't treat source code as a flat string of characters, you treat it as a *tree* of meaning, change the tree, and turn the tree back into source.

This page teaches you what an AST is, the four-step pipeline every codemod follows, a complete worked example in jscodeshift, and exactly why an AST beats a regular expression for this job.

---

## Table of Contents

1. [The problem codemods solve](#1-the-problem-codemods-solve)
2. [What is an AST?](#2-what-is-an-ast)
3. [The pipeline: parse → match → transform → print](#3-the-pipeline-parse--match--transform--print)
4. [A complete worked codemod (jscodeshift)](#4-a-complete-worked-codemod-jscodeshift)
5. [Running it: dry-run, diff, apply](#5-running-it-dry-run-diff-apply)
6. [Why AST beats regex](#6-why-ast-beats-regex)
7. [Idempotency: run it twice, get the same answer](#7-idempotency-run-it-twice-get-the-same-answer)
8. [When NOT to write a codemod](#8-when-not-to-write-a-codemod)
9. [Glossary](#9-glossary)
10. [Review questions](#10-review-questions)
11. [Next](#11-next)

---

## 1. The problem codemods solve

You renamed a function. `getUser()` is now `fetchUser()`. It's called in 312 places across 140 files. Some calls are `getUser(id)`, some are `obj.getUser()`, some are `const f = getUser`, and one file has a *variable* also named `getUser` that has nothing to do with your function.

Your options:

- **Find-and-replace `getUser` → `fetchUser` in your editor.** Fast, but it also rewrites the unrelated variable, the word `getUser` inside a comment, and the string `"getUser"` in a log message. Now you have bugs.
- **Open all 140 files and fix each call by hand.** Correct, but it takes a day, you'll miss some, and the diff is impossible to review for "did you only change what you meant to?"
- **Write a codemod.** One script, ~30 lines, that says: "find every *call* to the function named `getUser` and rename it; leave variables, strings, and comments alone." Run it once. Review the diff. Done in minutes, and it's *provably* scoped to the right thing.

The first two options scale badly and make mistakes. The third is what professional teams do when a change is **mechanical** (the same rule applied everywhere) and **large** (too many sites to do by hand safely).

> **When NOT to (preview):** if the change is in *three* places, don't write a codemod — use your IDE's rename, which is also AST-aware and takes ten seconds. Codemods earn their keep at scale. We cover the full decision in [§8](#8-when-not-to-write-a-codemod).

---

## 2. What is an AST?

**AST** = **Abstract Syntax Tree**. It's how a compiler "sees" your code: not as text, but as a tree of nested nodes, each labelled with what it *is*.

Take this one line of JavaScript:

```js
const total = price + tax;
```

A regex sees 24 characters. A parser sees this tree:

```
VariableDeclaration  (kind: "const")
└── VariableDeclarator
    ├── id:   Identifier        (name: "total")
    └── init: BinaryExpression  (operator: "+")
        ├── left:  Identifier   (name: "price")
        └── right: Identifier   (name: "tax")
```

Every meaningful piece is a **node** with a **type** (`Identifier`, `BinaryExpression`, `VariableDeclaration`…) and **properties** (`name`, `operator`, `left`, `right`). The tree captures *structure* and *meaning* that the flat text throws away:

- It knows `price` here is an **identifier being read**, not the word "price" in a comment.
- It knows `+` is a **binary operator**, and which operands it joins.
- It knows `total` is **being declared**, not used.

Because the AST carries meaning, you can ask precise questions — "find every *function call* named `getUser`" — that are impossible to ask of raw text. That precision is the entire point of codemods.

> The "Abstract" in AST means it drops syntax that doesn't change meaning — semicolons, the exact whitespace, sometimes parentheses. A close cousin, the **CST** (Concrete Syntax Tree), keeps *everything*, including comments and formatting. You'll meet the CST in [middle.md](middle.md) — it's what lets a codemod preserve your code's exact style.

---

## 3. The pipeline: parse → match → transform → print

Every codemod, in every tool, in every language, is the same four steps:

```
SOURCE TEXT  ──parse──▶  AST  ──match──▶  nodes  ──transform──▶  new AST  ──print──▶  SOURCE TEXT
```

1. **Parse** — turn the source string into an AST. The tool does this for you; you never parse by hand.
2. **Match** — walk the tree and *find* the nodes you care about ("every call to `getUser`"). This is a query against the tree.
3. **Transform** — change those nodes (rename, wrap, delete, replace). You mutate or rebuild parts of the tree.
4. **Print** — turn the modified AST back into source text, **ideally preserving the original formatting and comments** of the parts you didn't touch.

The magic is in steps 2 and 4. Matching against a tree is *semantic*: you select by what code *is*, not how it's spelled. Printing back losslessly is what makes the diff small and reviewable — only the lines you actually changed should move.

Keep this four-word mantra — **parse, match, transform, print** — in your head. Every example below maps onto it.

---

## 4. A complete worked codemod (jscodeshift)

Let's do a real one end to end. **jscodeshift** is Facebook's codemod runner for JavaScript and TypeScript. It hands you a parsed AST wrapped in a jQuery-like API (find these nodes, do this to them) and prints the result back.

### The task

Our codebase logs with the old console API:

```js
console.log("user signed in", userId);
```

We're migrating to a structured logger. Every `console.log(...)` should become `logger.info(...)` — but **only** `console.log`, not `console.error` or `console.warn`, and not a variable someone happened to name `console`.

### Setup

```bash
npm install -g jscodeshift
```

A jscodeshift codemod is a single module that exports a `transform` function:

```js
// console-to-logger.js
//
// Rewrites console.log(...) → logger.info(...)
module.exports = function transform(fileInfo, api) {
  const j = api.jscodeshift;          // the AST toolkit, bound to this file
  const root = j(fileInfo.source);    // PARSE: source string → AST, wrapped in a collection

  // MATCH: every call expression whose callee is exactly `console.log`
  root
    .find(j.CallExpression, {
      callee: {
        type: "MemberExpression",
        object:   { type: "Identifier", name: "console" },
        property: { type: "Identifier", name: "log" },
      },
    })
    // TRANSFORM: rewrite the callee to `logger.info`
    .forEach((path) => {
      const callee = path.node.callee;
      callee.object.name = "logger"; // console -> logger
      callee.property.name = "info";  // log     -> info
    });

  // PRINT: AST → source text, preserving untouched formatting
  return root.toSource();
};
```

Walk through it against the mantra:

- **Parse** — `j(fileInfo.source)` reads the file's text and builds the AST. `root` is a *collection* (think: a set of matched nodes) wrapping the whole file.
- **Match** — `.find(j.CallExpression, {...})` searches the tree for **call expressions** (something being *called*, like `f(x)`) whose `callee` is a **member expression** (`a.b`) where the object is the identifier `console` and the property is the identifier `log`. That filter object is a *pattern*: jscodeshift returns only nodes whose shape matches every key you specified.
- **Transform** — for each match, we reach into the node and rename the two identifiers. We're mutating the tree in place.
- **Print** — `root.toSource()` serializes the modified AST back to a string. Under the hood jscodeshift uses **recast**, which reprints *only the nodes that changed* and copies the rest verbatim — so your formatting and comments survive untouched.

### Why the match is precise

That nested filter is doing a lot of work for free:

| Source line | Matched? | Why |
|---|---|---|
| `console.log("hi")` | ✅ yes | object `console`, property `log` |
| `console.error("x")` | ❌ no | property is `error`, not `log` |
| `myObj.log("x")` | ❌ no | object is `myObj`, not `console` |
| `const console = ...` | ❌ no | that's a declaration, not a `CallExpression` |
| `// console.log here` | ❌ no | comments aren't parsed into call nodes |
| `"console.log"` (a string) | ❌ no | it's a string literal, not a call |

You did not write a single rule to *exclude* comments or strings. They simply aren't `CallExpression` nodes, so the tree query never reaches them. **That's the whole reason we use ASTs.**

---

## 5. Running it: dry-run, diff, apply

Never run a codemod straight onto your working files and trust it. The workflow is **dry-run → inspect diff → apply → review diff again**.

```bash
# Dry run: report what WOULD change, but write nothing.
jscodeshift -t console-to-logger.js src/ --dry --print
```

`--dry` makes no edits; `--print` prints the transformed output to stdout so you can eyeball it. jscodeshift also gives you a summary:

```
Processing 214 files...
Results:
  0 errors
  198 unmodified
  16 ok
Time elapsed: 1.420 seconds
```

Read that: 16 files changed, 0 errors, the rest untouched. If the count looks wrong (say it touched 0 files, or 214), your matcher is too narrow or too broad — fix it *before* applying.

When the dry run looks right, apply for real and review with git:

```bash
jscodeshift -t console-to-logger.js src/   # writes the changes
git diff                                     # review every modification by eye
```

Because the printer is lossless, `git diff` shows *only* the `console.log → logger.info` lines. A clean, tightly-scoped diff is your proof that the codemod did exactly what you intended and nothing else. If the diff has surprising hunks — reformatted lines, moved comments — stop and investigate; that's a sign the printer or your transform touched more than you meant.

> **When NOT to skip this:** never. Even a one-line codemod gets a dry run and a diff review. The cost is ten seconds; the cost of a bad codemod silently corrupting 200 files is a very bad afternoon.

---

## 6. Why AST beats regex

The single most important idea on this page. People reach for a regular expression to do bulk edits because it's quick to type. It is also *wrong* the moment code gets even slightly real, because **a regex sees characters; it does not understand code.**

### A regex that breaks

Suppose you try to do our `console.log → logger.info` rename with `sed`:

```bash
sed -i 's/console\.log/logger.info/g' src/**/*.js
```

This looks fine until it meets real files. It will happily rewrite:

```js
// BEFORE                                  // AFTER (all wrong)
const url = "https://console.log.io";  →  const url = "https://logger.info.io";   // 💥 string corrupted
// remember to console.log debug info   →  // remember to logger.info debug info   // 💥 comment rewritten
myConsole.logger();                     →  // (untouched — but a NaiveR regex for `\blog\b` would hit this)
console
  .log("multi-line");                   →  // 💥 MISSED — the dot is on the next line, regex didn't match
```

Four lines, three different failures: it corrupted a **string**, rewrote a **comment**, and *missed* a real call because the method was on a new line. A regex has no concept of "this is inside a string" or "this dotted access spans two lines" — to a regex, it's all just text.

### The AST equivalent doesn't have these problems

Our jscodeshift version from [§4](#4-a-complete-worked-codemod-jscodeshift):

- Never touches the string `"https://console.log.io"` — it's a `StringLiteral` node, not a `CallExpression`.
- Never touches the comment — comments aren't `CallExpression` nodes.
- Catches the multi-line `console\n.log(...)` — the parser builds the same `MemberExpression` tree whether the dot is on the same line or not. Whitespace is irrelevant to structure.

Here's the principle in one table:

| A regex cannot understand… | …but the AST encodes it directly |
|---|---|
| **Scope** — which `getUser` is *your* function vs. a local variable | Each identifier resolves within its declaration scope |
| **Nesting** — matched brackets, balanced calls | The tree structure *is* the nesting |
| **Strings vs. code** — `"console.log"` is data, not a call | A `StringLiteral` is a different node type than a `CallExpression` |
| **Comments** — text that should never be treated as code | Comments are attached as metadata, not parsed as expressions |
| **Multi-line / whitespace variation** — `a\n.b()` | Formatting is discarded; structure is the same |

A regex is fine for finding *candidates* ("which files mention `console.log`?"). It is the wrong tool for *transforming* code, because it cannot tell code from text. The AST can, because it *is* the code's meaning.

> **When NOT to (use AST):** if your change is genuinely textual — fix a typo in a constant string, update a copyright year in file headers, change a value in YAML config — then a regex or a tool like Comby is the right, simpler tool. AST transforms shine when the change depends on *what the code means*, not what it says. See [middle.md](middle.md) for Comby, the structural-but-lighter middle ground.

---

## 7. Idempotency: run it twice, get the same answer

A codemod is **idempotent** if running it a second time changes nothing. The first run does the migration; the second run is a no-op because there's nothing left to match.

Our example is naturally idempotent: after the first run there are no more `console.log` calls, so the second run finds zero matches and rewrites zero files. Perfect.

Idempotency matters because in practice codemods get run more than once — someone reruns it on a branch that already migrated, or it runs in CI on every push, or two engineers run it on overlapping code. A non-idempotent codemod *compounds* its change every time:

```js
// A BAD, non-idempotent transform: "wrap every call to fetch() in a retry"
// Run 1:  fetch(url)            →  retry(() => fetch(url))
// Run 2:  retry(() => fetch(url))  →  retry(() => retry(() => fetch(url)))   // 💥 double-wrapped!
```

The fix is to **match only the unmigrated shape**: before wrapping, check the call isn't *already* inside a `retry(...)`. Then run 2 finds nothing to do. The rule of thumb:

> A good codemod's matcher should never match its own output.

We go deep on guaranteeing idempotency — and *testing* for it — in [middle.md](middle.md). For now, just internalize the goal: **run twice, second run is a no-op.**

---

## 8. When NOT to write a codemod

Codemods are powerful, which makes them tempting to over-apply. Skip the codemod when:

- **The change is small (a handful of sites).** Use your IDE's structural rename / change-signature instead — it's also AST-aware, it's instant, and you don't have to write and test a script. Writing a codemod for three call sites is busywork. (The IDE-refactoring path is the sibling topic *01-ide-refactorings* in this same section.)
- **The change needs human judgment per site.** "Replace this O(n²) loop with a better algorithm" is not mechanical — every site needs thought. Codemods only work when the *same* rule applies *everywhere* with no decisions. If you find yourself wanting `if (this is the tricky case) { ask a human }`, it's not a codemod.
- **You can't make the transform safe.** If the change can silently break behavior and you can't write a matcher tight enough to be sure — or can't test the result — don't automate it. A wrong codemod is worse than a manual change because it fails *at scale*, all at once.
- **It's genuinely a text change**, not a code-meaning change (see [§6](#6-why-ast-beats-regex)) — use a regex or Comby.

The decision in one line: **codemod when the change is mechanical, large, and safe to automate.** Otherwise reach for the IDE, or do it by hand.

---

## 9. Glossary

- **Codemod** — a script that programmatically edits source code across many files. Short for "code modification."
- **AST (Abstract Syntax Tree)** — a tree representation of source code where each node is a typed, structured piece of the program. Drops insignificant syntax (whitespace, sometimes comments).
- **CST (Concrete Syntax Tree)** — like an AST but retains *everything*, including comments and exact formatting. Used by tools that need lossless printing.
- **Node** — one element of the tree, e.g. an `Identifier`, `CallExpression`, or `BinaryExpression`, with a `type` and properties.
- **Parse** — turn source text into an AST.
- **Print / serialize** — turn an AST back into source text.
- **Lossless / lossy printing** — lossless preserves the original formatting and comments of untouched code; lossy reformats everything.
- **Match / query** — finding the nodes in the tree that a transform should act on.
- **Transform** — the function that mutates matched nodes.
- **Idempotent** — running the operation twice produces the same result as running it once.
- **jscodeshift** — Facebook's JavaScript/TypeScript codemod runner, built on recast.
- **recast** — the printer jscodeshift uses; reprints only changed nodes to keep diffs small.
- **Dry run** — execute the codemod reporting what *would* change without writing any files.

---

## 10. Review questions

1. Name the four steps of the codemod pipeline in order.
2. In the line `total = price + tax;`, what *node type* is `price`, and what node type joins `price` and `tax`?
3. Give one thing a `sed`-style regex rename will wrongly rewrite that an AST transform will leave alone — and explain *why* the AST leaves it alone.
4. What does it mean for a codemod to be **idempotent**, and what's the rule of thumb for guaranteeing it?
5. Why is `console.error("x")` *not* matched by our `find(j.CallExpression, { callee: {... property: { name: "log" }}})` filter?
6. You have to rename a method that appears in 4 files. Should you write a codemod? Justify your answer.
7. What does `--dry` do, and why should you *always* use it before applying?
8. What's the difference between an AST and a CST, and which one do you want if you care about preserving comments?

---

## 11. Next

- **[middle.md](middle.md)** — the full tool landscape (jscodeshift, ts-morph, LibCST, OpenRewrite, Comby), CST vs AST and comment preservation in depth, and how to *test* a codemod.
- Sibling topic *01-ide-refactorings* (same section) — the lighter-weight, point-and-click cousin you should prefer for small changes.
- The **Visitor pattern** is exactly how AST tools walk the tree: [../../../design-patterns/03-behavioral/10-visitor/junior.md](../../../design-patterns/03-behavioral/10-visitor/junior.md). Understanding Visitor makes every codemod API click.
- For *what* mechanical refactorings you'll often automate, see [Simplifying Method Calls](../../02-refactoring-techniques/05-simplifying-method-calls/junior.md) (rename method, add/remove parameter — classic codemod targets).
