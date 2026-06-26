# Abstract Syntax Trees — Junior Level

> **Topic:** [Abstract Syntax Trees](README.md)
> **Focus:** What an AST is, why a compiler throws away your parentheses and semicolons, and how to walk a tree of nodes.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Code Examples](#code-examples)
8. [Pros & Cons](#pros--cons)
9. [Use Cases](#use-cases)
10. [Coding Patterns](#coding-patterns)
11. [Best Practices](#best-practices)
12. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
13. [Common Mistakes](#common-mistakes)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [What You Can Build](#what-you-can-build)
18. [Further Reading](#further-reading)
19. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What is the tree-shaped thing a compiler builds from your source code, and why does it look so different from the text you typed?**

When you write `1 + 2 * 3`, that is just a string — a flat sequence of characters. A compiler cannot *do* anything useful with a flat string. To evaluate it, optimize it, type-check it, or translate it to machine code, the compiler first turns it into a **tree**. That tree is the **Abstract Syntax Tree**, or **AST**.

The AST for `1 + 2 * 3` is not "the characters 1, +, 2, *, 3 in a row." It is a structured object that captures *meaning*: a multiplication of `2` and `3`, whose result is added to `1`. Drawn out:

```text
        (+)
       /   \
     1     (*)
          /   \
        2       3
```

The shape of the tree already encodes that `*` binds tighter than `+`. There are **no parentheses in the tree** — they were never needed, because the tree's *structure* says which operation happens first. There is no `;`, no whitespace, no comment. The AST keeps the **essential structure** and throws away everything that was only there to help the *parser* (and the human reading the text) figure out that structure.

In one sentence: **an AST is your program as a tree of operations, with all the punctuation and grouping that the tree no longer needs stripped away.**

> 🎓 **Why this matters for a junior:** Almost every tool you use that "understands code" — your linter (ESLint), your formatter (Prettier), your bundler (Babel/webpack), your IDE's go-to-definition, your test coverage tool — works by building an AST and walking it. If you ever want to write a custom lint rule, a codemod that renames a function across 500 files, or a tiny language of your own, the AST is the single most important data structure to understand. It is *the* thing compilers and dev tools operate on.

This page covers: what an AST is, how it differs from the raw "parse tree" (which keeps everything), what a *node* looks like, and how to **walk** a tree to do something useful — like print every function name or count the additions. We will keep it concrete with small examples in JavaScript, Python, and Rust. The deeper levels (`middle.md`, `senior.md`, `professional.md`) go into how ASTs are represented in memory, how they get *desugared* and *typed*, and the real production ASTs inside Babel, Clang, Roslyn, and rustc.

---

## Prerequisites

What you should know before reading this:

- **Required:** How to write a small program with functions and `if`/`while` in at least one language (JavaScript, Python, or any C-family language).
- **Required:** What a tree is — a node that has children, each of which may have its own children. If you have seen the DOM (`document.body.children`), you already know a tree.
- **Required:** What an expression is (`1 + 2`, `f(x)`) versus a statement (`let x = 5;`, `return y;`).
- **Helpful but not required:** A vague idea that source code goes through "compilation" — text in, program out.
- **Helpful but not required:** Recursion. Walking a tree is naturally recursive: "to process a node, process its children."

You do **not** need to know:

- How a parser turns text into a tree (that is the *parsing* topic — here we start *after* the tree already exists).
- Type systems, optimization, or code generation (later topics and tiers).
- How the AST is laid out in memory — pointers vs arenas (that is `senior.md`).

---

## Glossary

| Term | Definition |
|------|-----------|
| **AST (Abstract Syntax Tree)** | A tree representation of source code that captures its essential structure (operations, nesting) and discards syntactic noise (parentheses, semicolons, whitespace, comments). |
| **Node** | One element of the tree. Every node has a *kind* (e.g. `BinaryExpression`, `IfStatement`) and usually some children. |
| **Leaf** | A node with no children — a literal like `42` or a variable name like `x`. |
| **Root** | The top node of the tree. For a whole file it is usually a `Program` or `Module` node. |
| **Child** | A node directly contained by another. `1 + 2` is a `BinaryExpression` whose children are the `1` and the `2`. |
| **Parse tree / CST (Concrete Syntax Tree)** | A tree that keeps *everything* the parser saw — every parenthesis, comma, and keyword. The AST is the simplified version of it. |
| **Token** | A single "word" of the source: `if`, `(`, `x`, `+`, `42`. Tokens are the input to the parser; the AST is the output. |
| **Expression** | Code that produces a value: `1 + 2`, `f(x)`, `a && b`. |
| **Statement** | Code that does something but does not itself produce a value: `let x = 5;`, `return y;`, `if (...) {...}`. |
| **Literal** | A value written directly in the source: `42`, `"hello"`, `true`, `null`. |
| **Identifier** | A name: a variable, function, or parameter name like `x` or `getUser`. |
| **Traversal / walking** | Visiting every node of the tree, usually to read or transform it. |
| **Visitor** | A standard way to "visit" each kind of node with a dedicated function, e.g. "do this when you see a `CallExpression`." |
| **Span / source position** | The location (line, column, byte offset) in the original file that a node came from. Used for error messages. |

---

## Core Concepts

### 1. Text Is Not Structure — The Tree Is

The string `if (x > 0) y = 1;` is a line of characters. The compiler cannot ask it "what is the condition?" or "what is the body?" — strings do not have a condition or a body. The AST does:

```text
IfStatement
├── test:  BinaryExpression (>)
│           ├── left:  Identifier  "x"
│           └── right: Literal       0
└── then:  AssignmentStatement (=)
            ├── target: Identifier "y"
            └── value:  Literal      1
```

Now every question has an answer that is just "follow a child pointer": the condition is the `test` child; the body is the `then` child. **This is the entire point of an AST** — it turns *questions about code* into *navigation of a tree*.

### 2. The AST Drops Syntactic Noise

Look again at `1 + 2 * 3`. In the source you might also write `(1 + (2 * 3))` or `1+2*3` with no spaces. All three produce **the exact same AST**, because the parentheses, the spaces, and the precedence rules were only ever there to help work out the structure. Once the structure is captured by the tree's *shape*, that scaffolding is no longer needed.

Things the AST typically throws away:

- **Grouping parentheses** — `(1 + 2)` and `1 + 2` (when already grouped by structure) collapse to the same subtree.
- **Whitespace and indentation** — irrelevant once you have a tree.
- **Comments** — usually dropped (some tools keep them attached; more on that later).
- **Some punctuation** — semicolons, commas separating arguments. The fact that there *are* arguments is captured as a list of children; the commas themselves are gone.

This is the difference between the AST and the **parse tree** (also called the **concrete syntax tree**, or **CST**). The parse tree keeps *all of it* — every parenthesis and comma is a node. That is useful for tools that must reproduce the source *exactly* (a code formatter, a refactoring engine that preserves your comments). But for most jobs — evaluation, type-checking, optimization — the noise is in the way, and we use the simpler AST.

> 💡 **Rule of thumb:** the AST keeps what *matters to the meaning*; the parse tree keeps what *matters to the exact text*.

### 3. Every Node Has a Kind

An AST is not a tree of anonymous boxes. Each node has a **kind** (sometimes called a *type* or *tag*) that says what it is: `BinaryExpression`, `IfStatement`, `FunctionDeclaration`, `Literal`, `Identifier`, and so on. The kind determines what children the node has:

- A `Literal` has a value and no children. It is a leaf.
- A `BinaryExpression` has an operator (`+`, `*`, …), a `left` child, and a `right` child.
- An `IfStatement` has a `test`, a `then` body, and an optional `else` body.
- A `FunctionDeclaration` has a name, a list of parameters, and a body.

When you "do something" with an AST, you almost always **switch on the node's kind**: "if it's a `BinaryExpression`, do X; if it's a `Literal`, do Y."

### 4. Walking the Tree

To use an AST you *walk* it: visit the root, then visit its children, then their children, recursively, until you have touched every node. A walk that processes a node *before* its children is **pre-order**; *after* is **post-order**. For an evaluator you usually want post-order (compute the children's values first, then combine them), which is exactly how `1 + 2 * 3` evaluates: figure out `2 * 3 = 6` first, then `1 + 6 = 7`.

The walk is naturally recursive:

```text
walk(node):
    do something with node           # pre-order work
    for each child of node:
        walk(child)                  # recurse
    do something with node           # post-order work
```

That recursion is the heart of every compiler pass, every linter, every formatter you will ever read.

---

## Real-World Analogies

**A recipe vs. the printed cookbook page.** The cookbook page has a title, a font, page numbers, a photo, and decorative borders. The *recipe* — what you actually cook from — is "combine flour and sugar, then add eggs, then bake." The AST is the recipe: the steps and their structure. The CST/printed page is everything, including the layout. Two cookbooks can print the same recipe with different fonts and borders (different source text) but the recipe itself (the AST) is the same.

**A sentence diagram.** Remember diagramming sentences in school — subject, verb, object, with modifiers hanging off branches? "The quick brown fox jumps" becomes a little tree: a subject phrase ("the quick brown fox") and a verb ("jumps"). The diagram keeps the *grammatical structure* and drops the fact that there happened to be spaces between words. That diagram **is** an AST for English.

**An org chart.** A company org chart is a tree: a CEO at the root, VPs as children, managers below them, individual contributors as leaves. To answer "who reports up to the VP of Engineering?" you walk the subtree rooted at that VP. Walking an AST to answer "what variables does this function use?" is the same operation on a tree of code instead of people.

**Nested boxes.** Picture Russian nesting dolls, or folders inside folders on your computer. A folder contains files and other folders; each of *those* folders contains more. That is a tree, and "find every `.png` under this folder" is a tree walk — exactly like "find every `console.log` call under this function."

---

## Mental Models

**Model 1 — "The AST is the program; the text is just one way to write it down."** This is the most important shift. Beginners think of the source text as "the program." It is not — it is a *serialization* of the program, the way JSON is a serialization of an object. The real program is the tree. Many different texts can serialize to the same tree (`1+2` and `1 + 2` and `(1 + 2)`), and a tool can take a tree and serialize it back to text in its own style — that is exactly what a code formatter does.

**Model 2 — "Each node answers a fixed set of questions."** Don't think of a node as a blob. Think of it as a small form with labeled fields. An `IfStatement` form has three fields: *test*, *then*, *else*. A `CallExpression` form has *callee* and *arguments*. Once you know the kind, you know the fields, and navigation is just "read field X."

**Model 3 — "Walking the tree = recursion on shape."** Any time you want to compute something over a whole program — count the function calls, find all the variable names, sum up the literals — the answer is "walk the tree, and at each node, switch on its kind." If you can recurse over a tree, you can write a compiler pass.

**Model 4 — "The AST is the meeting point between phases."** The parser produces the AST. The type-checker reads (and decorates) the AST. The optimizer rewrites the AST. The code generator reads the AST. Nobody passes raw text around — they all pass the tree. The AST is the shared currency of the whole compiler.

---

## Code Examples

We will look at the *same idea* — building or inspecting an AST — across three ecosystems. The point is not to memorize APIs but to see that the tree-of-nodes concept is universal.

### Example 1 — JavaScript: see a real AST

Modern JS tooling uses a standard AST shape called **ESTree**. You can produce one in your browser's console or with a small script using a parser like Acorn or Babel. For `1 + 2 * 3`, the AST (ESTree shape) is roughly:

```json
{
  "type": "BinaryExpression",
  "operator": "+",
  "left":  { "type": "Literal", "value": 1 },
  "right": {
    "type": "BinaryExpression",
    "operator": "*",
    "left":  { "type": "Literal", "value": 2 },
    "right": { "type": "Literal", "value": 3 }
  }
}
```

Notice: the outer node is the `+` (because `+` happens *last*), and the `*` is nested inside its right child (because `*` happens *first*). The tree's shape encodes precedence. No parentheses anywhere.

### Example 2 — Python: the built-in `ast` module

Python ships an AST library in the standard library. You can parse code and print the tree:

```python
import ast

source = "x = 1 + 2 * 3"
tree = ast.parse(source)

print(ast.dump(tree, indent=2))
```

Output (trimmed):

```text
Module(
  body=[
    Assign(
      targets=[Name(id='x', ctx=Store())],
      value=BinOp(
        left=Constant(value=1),
        op=Add(),
        right=BinOp(
          left=Constant(value=2),
          op=Mult(),
          right=Constant(value=3))))])
```

Same story: `Add` on the outside, `Mult` nested inside as the right operand. The variable name is an `ast.Name` node; the numbers are `ast.Constant` nodes.

### Example 3 — Python: walk the tree with `NodeVisitor`

Python gives you a ready-made walker, `ast.NodeVisitor`. You subclass it and define a method per node kind you care about. Here we print every function name in a file:

```python
import ast

class FunctionFinder(ast.NodeVisitor):
    def visit_FunctionDef(self, node):
        print("found function:", node.name)
        self.generic_visit(node)   # keep walking into the body

source = """
def greet(name):
    def helper():
        return 42
    return helper()
"""

FunctionFinder().visit(ast.parse(source))
# found function: greet
# found function: helper
```

The `visit_FunctionDef` method runs once for each `FunctionDef` node. `generic_visit(node)` tells the walker to keep descending into the children — without it, you would never see `helper` (it is nested inside `greet`). This *visitor* pattern is exactly how ESLint, Babel, and most tools walk their trees too.

### Example 4 — Build your own tiny AST (Rust enum)

In languages with **sum types** (Rust, OCaml, Haskell, Swift), an AST is naturally one `enum` whose variants are the node kinds:

```rust
enum Expr {
    Num(f64),                          // a literal: 42
    Add(Box<Expr>, Box<Expr>),         // left + right
    Mul(Box<Expr>, Box<Expr>),         // left * right
}

// The tree for 1 + 2 * 3, built by hand:
fn example() -> Expr {
    Expr::Add(
        Box::new(Expr::Num(1.0)),
        Box::new(Expr::Mul(
            Box::new(Expr::Num(2.0)),
            Box::new(Expr::Num(3.0)),
        )),
    )
}

// Evaluate the tree with a recursive walk (post-order):
fn eval(e: &Expr) -> f64 {
    match e {
        Expr::Num(n)    => *n,
        Expr::Add(a, b) => eval(a) + eval(b),   // children first
        Expr::Mul(a, b) => eval(a) * eval(b),
    }
}
// eval(&example()) == 7.0
```

The `Box<...>` is just "a pointer to another node on the heap," which is how the tree gets its children. The `match` is the switch-on-kind we keep mentioning, and the compiler *forces* you to handle every variant — forget one and it will not compile. (Why `enum` here but a *class hierarchy* in Java? That trade-off is the big idea in `middle.md` and `senior.md`.)

### Example 5 — Build your own tiny AST (JavaScript object)

In JavaScript you do not have sum types, so a node is just an object with a `type` field:

```js
// The tree for 1 + 2 * 3:
const tree = {
  type: "Add",
  left:  { type: "Num", value: 1 },
  right: {
    type: "Mul",
    left:  { type: "Num", value: 2 },
    right: { type: "Num", value: 3 },
  },
};

function evaluate(node) {
  switch (node.type) {
    case "Num": return node.value;
    case "Add": return evaluate(node.left) + evaluate(node.right);
    case "Mul": return evaluate(node.left) * evaluate(node.right);
    default: throw new Error("unknown node type: " + node.type);
  }
}

console.log(evaluate(tree)); // 7
```

Same tree, same recursive walk, different language. The shape of the idea never changes.

---

## Pros & Cons

**Pros of working with an AST instead of raw text:**

- **Structure is explicit.** "What is the condition of this `if`?" is a field access, not a parsing problem you re-solve every time.
- **Noise is gone.** You don't trip over whitespace, comments, or redundant parentheses.
- **Walking is uniform.** One recursive walk handles arbitrarily nested code.
- **It is language-tool-friendly.** Linters, formatters, refactoring tools, and compilers all share this representation.
- **Precedence is baked in.** The tree's shape already resolved `*` before `+`; you never re-derive it.

**Cons / costs:**

- **You lose exact formatting.** A plain AST cannot perfectly reproduce the original text (where the comments were, how things were indented). Tools that must preserve text need a richer tree (or a CST).
- **Building one is work.** You need a parser to produce the AST in the first place.
- **It uses memory.** A 10-character expression can become several heap-allocated nodes. For huge files this adds up (later tiers cover memory-efficient representations).
- **It can drift from the source.** If you transform the tree but forget to track *where each node came from*, your error messages point at the wrong place. (Keeping source positions is covered below.)

---

## Use Cases

ASTs are not just a compiler-internals curiosity — they power tools you use daily:

- **Linters (ESLint).** A lint rule is a small visitor: "when you see a `CallExpression` whose callee is `console.log`, report a warning."
- **Formatters (Prettier).** Parse to a tree, then *pretty-print* the tree back out in a consistent style. Your messy spacing is normalized because the formatter prints from the tree, not your text.
- **Codemods / refactors (jscodeshift).** "Rename `oldApi()` to `newApi()` everywhere" = walk the tree, find the matching `CallExpression` nodes, change them, print the tree back.
- **Transpilers (Babel).** Parse modern JS to an AST, transform new syntax into older syntax (an arrow function becomes a regular function), print it back out.
- **Compilers and interpreters.** Type-check, optimize, and generate code — all by walking and rewriting the AST.
- **IDE features.** Go-to-definition, autocomplete, "find all references," and syntax highlighting all consult an AST of your code.
- **Static analysis & security scanners.** "Find every place that builds a SQL string by concatenation" is a tree query.

---

## Coding Patterns

**Pattern 1 — Switch on node kind.** The fundamental move. Whatever you are doing — evaluating, printing, counting — you branch on the node's `type`/variant and handle each kind.

```js
function describe(node) {
  switch (node.type) {
    case "Num":        return String(node.value);
    case "Add":        return `(${describe(node.left)} + ${describe(node.right)})`;
    case "Mul":        return `(${describe(node.left)} * ${describe(node.right)})`;
    default:           throw new Error("unhandled: " + node.type);
  }
}
```

**Pattern 2 — Recursive walk.** To process a whole tree, process the node, then recurse into its children. The recursion mirrors the tree's nesting.

**Pattern 3 — The visitor.** Instead of one giant switch, register a small handler per node kind and let a generic walker dispatch to the right one. Python's `NodeVisitor` and ESLint rules both work this way. It keeps each concern (one handler) small and separate.

```python
class CallCounter(ast.NodeVisitor):
    def __init__(self): self.count = 0
    def visit_Call(self, node):
        self.count += 1
        self.generic_visit(node)

counter = CallCounter()
counter.visit(ast.parse("print(f(g(x)))"))
print(counter.count)   # 3 calls: print, f, g
```

**Pattern 4 — Accumulate while you walk.** Carry a counter, a list, or a set through the walk to collect facts about the program (all function names, all string literals, the maximum nesting depth).

---

## Best Practices

- **Always handle the `default`/unknown case.** A `switch` on node kind should error loudly on a kind you forgot, not silently do nothing. (In Rust, `match` enforces this for you.)
- **Don't parse code with regexes.** Regular expressions cannot handle nesting (matching parentheses, nested comments). If you find yourself regexing source code to extract structure, you want an AST.
- **Recurse into children.** A common beginner bug is visiting only the top level and missing nested nodes. In Python remember `generic_visit`; in a hand-written walker remember to recurse on every child.
- **Keep node kinds small and meaningful.** Each kind should represent one concept (`IfStatement`, `BinaryExpression`), not a grab-bag.
- **Use the standard tree when one exists.** For JavaScript, target **ESTree** (the de-facto standard) so your tool composes with the rest of the ecosystem. For Python, use the built-in `ast`. Don't reinvent the shape.
- **Read a real AST early.** Paste code into AST Explorer (astexplorer.net) and click around. Seeing the live tree for code you wrote is the fastest way to build intuition.

---

## Edge Cases & Pitfalls

- **Forgetting to recurse.** You write `visit_Call` and it only fires for top-level calls. You forgot `generic_visit` / forgot to descend. Nested calls are invisible.
- **Confusing the AST with the text.** The AST does not remember whether you wrote `1+2` or `1 + 2`. If your tool needs that, a plain AST is the wrong tool.
- **Assuming the parser kept your comments.** Most ASTs drop comments by default. If you need them (for a doc tool), you must ask the parser to attach them.
- **Off-by-one in source positions.** Editors are 1-based for lines but often 0-based for columns; AST libraries vary. Mixing them gives error messages that point one character off.
- **Empty bodies and optional children.** An `if` with no `else`, a function with no parameters, an empty block — the corresponding child is often `null` or an empty list. Walks must not crash on the missing piece.
- **Very deep trees.** Code like `1 + 1 + 1 + ... + 1` a thousand times produces a deeply nested tree; a naive recursive walk can blow the call stack. Rare for juniors, but real.

---

## Common Mistakes

| Mistake | Why it's wrong | Fix |
|---------|----------------|-----|
| Parsing code with `String.replace`/regex | Can't handle nesting, strings, comments | Build/use an AST |
| Visiting only the root's direct children | Misses everything nested | Recurse / call `generic_visit` |
| Expecting the AST to keep formatting | The AST drops whitespace and parens | Use a CST or a position-preserving tree |
| No `default` in the kind switch | Silently ignores unhandled nodes | Throw on unknown kinds |
| Treating a list child like a single child | Function args / block statements are *lists* | Iterate the list |
| Inventing your own JS AST shape | Won't interoperate with the ecosystem | Use ESTree |

---

## Test Yourself

1. Draw the AST for `(a + b) * c`. Where do the parentheses go in the tree? *(Answer: there are none — the grouping is captured by `*` being the root with `(a + b)` as its left child.)*
2. Why is `2 * 3` *nested inside* the `+` node for `1 + 2 * 3`, instead of sitting next to the `1`?
3. What is the difference between an AST and a parse tree (CST)? Name one tool that needs the CST.
4. In Python's `ast`, why must a `NodeVisitor` call `generic_visit` to find nested functions?
5. In the Rust `enum Expr` example, what does the Rust compiler force you to do that the JavaScript `switch` does not?
6. Name three tools you already use that work by walking an AST.

---

## Cheat Sheet

```text
AST          = source code as a tree of operations, noise removed
CST / parse  = the full tree, every paren/comma kept (for formatters etc.)
Node         = { kind/type, children... }
Leaf         = literal or identifier (no children)
Root         = whole-file node (Program / Module)

THE TREE'S SHAPE encodes precedence — no parentheses needed.
  1 + 2 * 3  →  Add(1, Mul(2, 3))   // * is deeper, runs first

To DO anything with an AST:
  switch on node.kind, recurse into children   (a "walk")
  pre-order  = act, then recurse   (printing, collecting)
  post-order = recurse, then act   (evaluating)

Visitor = one handler per node kind; a generic walker dispatches.
  Python: ast.NodeVisitor, define visit_<Kind>, call generic_visit
  JS:     ESTree + ESLint/Babel visitors
  Rust:   one enum + a match

Tools built on ASTs: ESLint, Prettier, Babel, jscodeshift, IDEs.
Play with one: astexplorer.net
```

---

## Summary

An **Abstract Syntax Tree** is your source code reorganized as a **tree of operations**, with all the parentheses, semicolons, whitespace, and comments stripped away. The tree's *shape* captures the meaning — including operator precedence — so the noise is no longer needed. This is what distinguishes it from the **parse tree / CST**, which keeps every last token for tools that must reproduce the exact text.

Each **node** has a **kind** (`BinaryExpression`, `IfStatement`, `Literal`, …) that tells you what children it has. To do anything useful — evaluate, print, count, lint, refactor — you **walk** the tree: switch on each node's kind and recurse into its children. That recursive walk is the engine behind every compiler pass and every dev tool that "understands code." In sum-type languages (Rust, OCaml) an AST is one `enum` matched exhaustively; in object/JS languages it is a node object with a `type` field. The deeper tiers explore how those representations differ, how the tree gets simplified (*desugared*) and decorated with types, and how production compilers like Babel, Clang, and rustc structure their ASTs.

---

## What You Can Build

With just this level you can build:

- **A four-function calculator** that parses `1 + 2 * 3` and evaluates the AST.
- **A "function lister"** that prints every function name in a Python or JS file using a visitor.
- **A literal counter** that reports how many string/number literals a file contains.
- **A tiny lint rule** that warns whenever it finds a `console.log` (JS) or `print` (Python) call.
- **An expression pretty-printer** that walks a tree and prints it with explicit parentheses.

Each of these is a recursive walk over a tree of nodes — the same skill, applied to different goals.

---

## Further Reading

- *AST Explorer* (astexplorer.net) — paste code, see its live AST in several languages and parsers. The single best way to build intuition.
- Python documentation: the `ast` module, including `ast.dump`, `NodeVisitor`, and `NodeTransformer`.
- The ESTree specification — the standard AST shape for JavaScript.
- *Crafting Interpreters* by Robert Nystrom — the chapters on representing and evaluating expressions build an AST from scratch.
- The Babel handbook's "AST" section — a gentle tour of a production JS AST.

---

## Related Topics

- [Middle level](middle.md) — sum types vs class hierarchies, the visitor pattern in depth, transformers, and source spans.
- [Senior level](senior.md) — desugaring, typed/annotated ASTs, multiple IRs, and the expression problem.
- [Professional level](professional.md) — arena/flat memory layouts, red-green trees, and incremental compilation.
- [Interview questions](interview.md) — common AST questions and how to answer them.
- [Hands-on tasks](tasks.md) — build and walk your own ASTs.
