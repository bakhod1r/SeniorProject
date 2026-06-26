# Abstract Syntax Trees — Middle Level

> **Topic:** [Abstract Syntax Trees](README.md)
> **Focus:** How ASTs are represented — sum types vs class hierarchies — and the visitor pattern, transformers, and source spans that make them usable.

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

> Focus: **How do you actually represent an AST in code, how do you add operations to it without rewriting everything, and how do you transform one tree into another while keeping good error messages?**

At the junior level an AST was "a tree of nodes, each with a kind." That is true, but it papers over the two decisions that shape every real compiler and dev tool:

1. **How is a node represented?** As a variant of a **sum type** (Rust/OCaml `enum Expr { Lit, BinOp, Call, ... }`), where the whole AST is one type and you `match` on it? Or as a **class hierarchy** (Java/C# `abstract class Node` with one subclass per kind), where you add operations using the **visitor pattern**? These two choices pull in opposite directions, and the tension has a name — the **expression problem**.

2. **How do you traverse and rewrite the tree?** A read-only walk is easy. But compilers don't just read trees — they *rewrite* them: desugaring `a += b` into `a = a + b`, lowering a `for` into a `while`, constant-folding `2 * 3` into `6`. You can mutate the tree in place, or you can build a **new** tree (a *transformer* / *rewriter*), which is what most modern, immutable-AST tools do.

And underneath both: every node carries a **source position / span** so that when something goes wrong three phases later, the error message can still point at the right line and column in the *original* file.

In one sentence: **the AST's representation is a deliberate trade-off (sum type vs class hierarchy), the visitor pattern is the workaround that lets class-based ASTs grow new operations, and source spans are the thread that keeps diagnostics honest as the tree is transformed.**

> 🎓 **Why this matters at the middle level:** This is the level where you stop *using* ASTs and start *designing* them. Whether you are writing a Babel plugin, an ESLint rule, a small interpreter, or a refactoring tool, you are constantly choosing how to add an operation, deciding whether to mutate or rebuild, and trying not to lose the source location. Getting these right is the difference between a tool that works and one that produces "error at line 0" garbage.

This page covers: sum-type vs class-hierarchy ASTs and the expression problem; the visitor pattern in depth (double dispatch, `accept`/`visit`, why it exists); traversal orders; transformers vs in-place mutation and immutable ASTs; and source spans surviving transformations. `senior.md` then goes into desugaring pipelines, typed ASTs, and multiple IRs; `professional.md` into memory layout and incremental red-green trees.

---

## Prerequisites

What you should know before reading this:

- **Required:** The junior material — what an AST is, that it drops syntactic noise, and how to walk a tree by switching on node kind.
- **Required:** Comfort with at least one OOP language (Java, C#, TypeScript) *and* familiarity with `enum`/`match` or `switch` in some language.
- **Required:** Recursion over trees.
- **Helpful but not required:** Knowing what *polymorphism* and *dynamic dispatch* mean in OOP.
- **Helpful but not required:** Having used ESLint, Babel, or Python's `ast` even once.

You do **not** need to know:

- Type theory or semantic analysis internals (touched on here, detailed in `senior.md`).
- Memory layout, arenas, or red-green trees (`professional.md`).
- Parser construction — we still start *after* the tree exists.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Sum type / tagged union** | A type that is "one of" several variants, each carrying its own data: Rust `enum`, OCaml/Haskell ADTs, TypeScript discriminated unions. The natural fit for an AST. |
| **Class hierarchy** | An `abstract class Node` with one concrete subclass per node kind. The OOP way to model an AST. |
| **Exhaustive matching** | A `match`/`switch` that the compiler checks covers *every* variant. Add a new node kind and the compiler lists every place you forgot to handle it. |
| **Visitor pattern** | A way to add a new operation over a class hierarchy without editing the node classes: an interface with one `visit` method per node type. |
| **Double dispatch** | Selecting behavior based on *two* runtime types (the node's and the visitor's). The visitor pattern's mechanism. |
| **`accept` / `visit`** | The two halves of the visitor: a node's `accept(v)` calls back `v.visitFoo(this)`. |
| **Expression problem** | The fundamental tension: it is easy to add *cases* (node kinds) OR new *operations*, but no naive design makes both easy. |
| **Traversal order** | The order nodes are visited: pre-order (node first), post-order (children first), in-order (binary trees). |
| **Transformer / rewriter** | A traversal that returns a *new* tree instead of mutating the old one. |
| **Immutable AST** | An AST whose nodes are never modified after creation; transforms produce fresh trees. |
| **In-place mutation** | Editing node fields directly during a walk. Fast but fragile. |
| **Span / source range** | A `(start, end)` pair of byte offsets (or line/col) tying a node back to the source text. |
| **Diagnostic** | A compiler/tool message (error, warning) anchored to a span. |
| **Desugaring** | Rewriting a convenience construct into a simpler core one (`a += b` → `a = a + b`). |

---

## Core Concepts

### 1. Two Representations: Sum Type vs Class Hierarchy

There are two dominant ways to model an AST, and which one a language pushes you toward shapes how the rest of your compiler feels.

**Sum type (Rust, OCaml, Haskell, Swift, F#).** The entire AST is one type with many variants:

```rust
enum Expr {
    Lit(i64),
    Var(String),
    BinOp { op: Op, lhs: Box<Expr>, rhs: Box<Expr> },
    Call { callee: Box<Expr>, args: Vec<Expr> },
    If   { cond: Box<Expr>, then: Box<Expr>, els: Box<Expr> },
}
```

An operation is one function that `match`es on the variant:

```rust
fn eval(e: &Expr, env: &Env) -> i64 {
    match e {
        Expr::Lit(n)              => *n,
        Expr::Var(name)           => env.get(name),
        Expr::BinOp { op, lhs, rhs } => apply(*op, eval(lhs, env), eval(rhs, env)),
        Expr::Call { callee, args } => call(eval(callee, env), eval_all(args, env)),
        Expr::If { cond, then, els } =>
            if eval(cond, env) != 0 { eval(then, env) } else { eval(els, env) },
    }
}
```

The compiler checks the `match` is **exhaustive**: add a new variant `Lambda` and every `match` in the codebase that does not handle it becomes a compile error. This is wonderful when your set of *operations* is large and growing (eval, type-check, optimize, pretty-print) but your set of *node kinds* is relatively stable.

**Class hierarchy (Java, C#, traditional C++, TypeScript classes).** Each node kind is a subclass:

```java
abstract class Expr { }
class Lit   extends Expr { final long value; }
class Var   extends Expr { final String name; }
class BinOp extends Expr { final Op op; final Expr lhs, rhs; }
class Call  extends Expr { final Expr callee; final List<Expr> args; }
class If    extends Expr { final Expr cond, then, els; }
```

Where does an operation live? You could put an abstract `eval()` method on `Expr` and override it in each subclass. That works — but it means *every* operation (eval, typecheck, print, optimize) becomes another method bolted onto every node class, and the logic for one pass is smeared across dozens of files. The standard escape hatch is the **visitor pattern** (next section), which collects one operation into one class.

### 2. The Expression Problem

These two designs are not arbitrary taste — they sit at opposite ends of a genuine, named trade-off, the **expression problem** (Philip Wadler's framing). You have a 2-D grid: *node kinds* (rows) × *operations* (columns).

- **Sum types make adding an OPERATION cheap, adding a KIND expensive.** A new operation is one new function with a `match` — touch nothing else. A new *kind* means editing every existing `match` (the compiler at least points you at all of them).
- **Class hierarchies make adding a KIND cheap, adding an OPERATION expensive (without visitors).** A new kind is one new subclass. A new *operation* means adding a method to every subclass — or, with the visitor pattern, adding one visitor *but editing the visitor interface and every node's `accept`*.

```text
              add a new NODE KIND        add a new OPERATION
sum type      edit every match  (hard)   one new function  (easy)
class+visitor one new subclass  (easy)   one new visitor   (easy-ish)
              + edit visitor iface             but visitor iface grows
```

The practical reading: **compilers add operations far more often than node kinds** (you write pass after pass over a roughly fixed grammar), which is one reason rustc, OCaml compilers, and most functional-language compilers use sum types. Conversely, **language frameworks and tooling ecosystems** that expect third parties to add node kinds (plugins, new syntax) lean on class hierarchies and visitors. Neither is "right"; the choice follows which axis you expect to grow.

### 3. The Visitor Pattern, In Depth

The visitor pattern exists to answer one question: *in a class-based AST, how do I add a new operation without editing every node class?* The answer is **double dispatch**.

The mechanism is two methods:

- Every node has an `accept(Visitor v)` that calls the *right* method on the visitor for its own type.
- The visitor interface has one `visit` method per node type.

```java
interface Visitor<R> {
    R visitLit(Lit n);
    R visitVar(Var n);
    R visitBinOp(BinOp n);
    R visitCall(Call n);
    R visitIf(If n);
}

abstract class Expr { abstract <R> R accept(Visitor<R> v); }

class BinOp extends Expr {
    Op op; Expr lhs, rhs;
    <R> R accept(Visitor<R> v) { return v.visitBinOp(this); }  // dispatch #2
}
```

Now an operation is one class:

```java
class Evaluator implements Visitor<Long> {
    public Long visitLit(Lit n)   { return n.value; }
    public Long visitBinOp(BinOp n) {
        long l = n.lhs.accept(this);   // recurse via accept
        long r = n.rhs.accept(this);
        return apply(n.op, l, r);
    }
    // ... visitVar, visitCall, visitIf
}
```

**Why "double dispatch"?** You want behavior that depends on *two* types at runtime: which node (`BinOp` vs `Lit`) and which operation (`Evaluator` vs `Printer`). A single virtual call dispatches on one type. The visitor does it in two hops: `node.accept(visitor)` dispatches on the **node** type (picks `visitBinOp`), and inside, `v.visitBinOp(this)` dispatches on the **visitor** type (picks `Evaluator`'s implementation). Two dispatches → the right (node, operation) cell of the grid.

**Why bother instead of an abstract method per node?** Because the visitor *collects one operation into one place*. All of evaluation lives in `Evaluator`; all of pretty-printing in `Printer`. To add type-checking you write one `TypeChecker implements Visitor` and touch zero node classes. That is the payoff. The cost: adding a new node kind forces a new `visit` method on the interface, which breaks every existing visitor (the expression problem, again).

> 💡 In languages with sum types you do **not** need the visitor pattern — a `match` *is* the dispatch, in one hop, checked for exhaustiveness. The visitor pattern is largely an OOP workaround for the lack of pattern matching. Modern Java (sealed classes + switch patterns), C# (pattern matching), and TypeScript (discriminated unions) are closing this gap.

### 4. Traversal Orders

Walking a tree is not one thing — *when* you do work relative to the children matters:

- **Pre-order** (node, then children): good for things that flow *down* — printing with indentation, building a scope, collecting declarations before bodies.
- **Post-order** (children, then node): good for things computed *up* from leaves — evaluation, type inference, constant folding (you need the children's results first).
- **In-order** (left, node, right): meaningful only for binary-shaped nodes; rarely used for whole ASTs but natural for printing a binary expression as infix text.

Most real walkers do both: some work on the way *in* (pre) and some on the way *out* (post), which is exactly why visitor frameworks often expose `enter(node)` and `exit(node)` hooks (Babel does precisely this).

### 5. Transform In Place vs Build a New Tree

Compilers rewrite trees constantly. Two strategies:

- **In-place mutation:** walk the tree and edit node fields directly. Fast, low allocation. But it is fragile — if any other part of the system holds a reference to the old subtree, you have just changed it under their feet; and you cannot easily compare "before" and "after."
- **Transformer / rewriter (immutable AST):** the walk *returns a new node*. Unchanged subtrees are shared (reused by reference); only the path from the root to a changed node is rebuilt. This is how Python's `ast.NodeTransformer`, Babel's transforms (conceptually), and rustc's lowering work. Immutability makes transforms composable and debuggable: the old tree is still intact, so you can diff, cache, or roll back.

```python
import ast

class PlusOne(ast.NodeTransformer):
    """Rewrite every integer literal n into n + 1."""
    def visit_Constant(self, node):
        if isinstance(node.value, int):
            return ast.BinOp(left=node, op=ast.Add(), right=ast.Constant(value=1))
        return node

tree = ast.parse("x = 5")
new_tree = PlusOne().visit(tree)
ast.fix_missing_locations(new_tree)     # repair source positions on new nodes
print(ast.unparse(new_tree))            # x = 5 + 1
```

Notice `fix_missing_locations` — the freshly created nodes have *no source position*, which leads us to the last core concept.

### 6. Source Positions / Spans

Every node should carry where it came from in the source: a **span**, usually a start and end byte offset (cheap, exact) from which line/column can be derived on demand. Spans are the backbone of diagnostics: when the type-checker finds `"a" + 1`, it reports the error *at the span of that expression*, with a caret under the exact text.

The hard part is **spans surviving transformation**. When you desugar `a += b` into `a = a + b`, the new `+` node did not exist in the source. Good compilers attach the *original* span to the synthesized node (so the error still points at the `+=`), and many track a *desugaring trail* so a message can say "this came from a `+=`." When you create nodes by hand (the `PlusOne` example above), you must copy spans over, or your diagnostics point at line 0. This is why `ast.NodeTransformer` users call `fix_missing_locations`, and why rustc carries a `Span` on essentially every HIR node.

---

## Real-World Analogies

**The visitor as a touring inspector.** Imagine a building with many room *types* (kitchen, server room, lobby). You want to run different *inspections* (fire safety, accessibility, cleaning). You do not want to teach every room how to inspect itself for every inspection — that bloats every room and you cannot add a new inspection without renovating every room. Instead, an *inspector* (the visitor) walks the building; at each room, the room says "I'm a kitchen — run your kitchen routine on me" (`accept`). One inspector = one inspection, applied to all room types. That is double dispatch: the room picks the routine *category*, the inspector supplies the actual *behavior*.

**The expression problem as a spreadsheet you can only grow one way.** Picture a grid of rooms × inspections. Sum types let you add a whole new *inspection column* by writing one formula — but adding a *room row* means editing every column. Class+visitor lets you add a *room row* easily — but a new *inspection column* forces you to update the master template every room references. You can grow rows cheaply or columns cheaply, not both, for free.

**Transformer vs mutation as editing a document.** In-place mutation is editing the original manuscript with a pen — fast, but if someone else was reading it, you have changed their copy too, and there is no "undo." A transformer is "track changes / save as a new version": the old version is untouched, only the changed paragraphs are new, and everything else is the same shared text. That is why version-controlled, immutable trees are easier to reason about.

**Spans as page-and-line citations.** A good error message is like an academic citation: not "something is wrong somewhere" but "page 7, line 12." Even after you photocopy and rearrange the document (transform the tree), a careful editor keeps the original citation so the reader can find the source.

---

## Mental Models

**Model 1 — "Choose your representation by which axis grows."** Before writing a node type, ask: will I add more *operations* (passes) or more *kinds* (syntax)? Operations → sum type. Kinds added by third parties → class hierarchy + visitor. This single question explains most real compiler designs.

**Model 2 — "A visitor is a `match` you were forced to spread across an interface."** If you understand `match`/`switch` on node kind, you already understand visitors — they are the same dispatch, mechanically reassembled to fit OOP's lack of pattern matching. Read `visitBinOp` as "the `BinOp` arm of the match."

**Model 3 — "Transform = rebuild the spine, share the rest."** An immutable transform does not copy the whole tree. It copies only the nodes from the root down to what changed; every untouched subtree is reused by reference. Cheap and safe.

**Model 4 — "Spans are luggage tags."** Every node wears a tag saying where it came from. Synthesized nodes inherit the tag of whatever they were desugared from, so no piece of the program is ever 'unaddressable' in an error message.

---

## Code Examples

### Example 1 — Adding an operation: sum type vs visitor

**Sum type (Rust): a pretty-printer is just another function.**

```rust
fn print(e: &Expr) -> String {
    match e {
        Expr::Lit(n)               => n.to_string(),
        Expr::Var(s)               => s.clone(),
        Expr::BinOp { op, lhs, rhs } =>
            format!("({} {} {})", print(lhs), op, print(rhs)),
        _ => unimplemented!(),
    }
}
```

No node type changed. The whole operation is one self-contained function.

**Class hierarchy (Java): a pretty-printer is one visitor.**

```java
class Printer implements Visitor<String> {
    public String visitLit(Lit n)   { return Long.toString(n.value); }
    public String visitVar(Var n)   { return n.name; }
    public String visitBinOp(BinOp n) {
        return "(" + n.lhs.accept(this) + " " + n.op + " " + n.rhs.accept(this) + ")";
    }
    // ...
}
```

No node class changed. The whole operation is one `Printer` class. Same payoff, achieved through the visitor instead of `match`.

### Example 2 — A Babel-style enter/exit visitor (JavaScript)

Babel's visitors expose `enter` (pre-order) and `exit` (post-order). Here is the *shape* of a plugin that renames every identifier `foo` to `bar`:

```js
// A Babel plugin is an object returning a `visitor` with per-type handlers.
module.exports = function () {
  return {
    visitor: {
      Identifier(path) {                 // path wraps the node + its context
        if (path.node.name === "foo") {
          path.node.name = "bar";        // in-place mutation of the node
        }
      },
    },
  };
};
```

`path` is more than the node — it knows the node's parent, scope, and how to replace it (`path.replaceWith(...)`), which is how real codemods rewrite safely.

### Example 3 — A transformer that builds a new tree (Python)

```python
import ast

class StripDocstrings(ast.NodeTransformer):
    def visit_FunctionDef(self, node):
        self.generic_visit(node)                 # transform children first
        body = node.body
        if (body and isinstance(body[0], ast.Expr)
                and isinstance(body[0].value, ast.Constant)
                and isinstance(body[0].value.value, str)):
            node.body = body[1:] or [ast.Pass()] # drop the docstring statement
        return node

src = '''
def f():
    """remove me"""
    return 1
'''
new = StripDocstrings().visit(ast.parse(src))
ast.fix_missing_locations(new)
print(ast.unparse(new))
```

This returns a modified tree; `return node` is what hands the (possibly new) subtree back to the walker. Returning `None` from a `NodeTransformer` visit *deletes* the node — a sharp edge worth remembering.

### Example 4 — Carrying a span through a hand-written desugaring

```rust
struct Span { start: u32, end: u32 }

enum Stmt {
    AddAssign { target: Box<Expr>, value: Box<Expr>, span: Span }, // a += b
    Assign    { target: Box<Expr>, value: Box<Expr>, span: Span }, // a = ...
}

// Desugar `a += b`  →  `a = a + b`, preserving the ORIGINAL span.
fn desugar(s: Stmt) -> Stmt {
    match s {
        Stmt::AddAssign { target, value, span } => {
            let sum = Expr::BinOp {
                op: Op::Add,
                lhs: target.clone(),
                rhs: value,
                span,                 // synthesized node inherits the += span
            };
            Stmt::Assign { target, value: Box::new(sum), span }
        }
        other => other,
    }
}
```

The synthesized `+` node carries the span of the original `+=`, so any later error on it still points at the right text.

---

## Pros & Cons

**Sum-type ASTs**

- ➕ Exhaustive matching: forget a case and it won't compile.
- ➕ Operations are cheap to add; logic for a pass lives in one place.
- ➕ No `accept`/`visit` boilerplate.
- ➖ Adding a node kind ripples through every `match`.
- ➖ Less natural when third parties must extend the node set.

**Class-hierarchy + visitor ASTs**

- ➕ Adding a node kind is one subclass.
- ➕ The visitor keeps one operation in one class.
- ➕ Fits OOP ecosystems and plugin-style extension.
- ➖ Adding a node kind breaks every visitor (interface grows).
- ➖ `accept`/`visit` boilerplate; double dispatch is indirect to read.

**In-place mutation vs transformers**

- In-place: ➕ fast, low allocation ➖ fragile, no before/after, aliasing hazards.
- Transformer/immutable: ➕ safe, composable, diffable, cacheable ➖ more allocation, needs structural sharing to stay cheap.

---

## Use Cases

- **Interpreters** evaluate via a post-order walk (sum type `match` or an `Evaluator` visitor).
- **Linters** are pre/post-order visitors that *report* but rarely rewrite (ESLint).
- **Codemods / refactors** are transformers that rewrite matched nodes and print the tree back (jscodeshift, Babel plugins).
- **Desugaring passes** turn convenience syntax into core syntax (`+=`, `for`, string interpolation), preserving spans.
- **Pretty-printers / formatters** are pre-order visitors that emit text.
- **Multi-pass compilers** add new operations constantly — a strong argument for sum types where the language allows.

---

## Coding Patterns

**Pattern 1 — One visitor (or one function) per operation.** Keep eval, typecheck, print, and optimize as separate visitors/functions; do not interleave concerns.

**Pattern 2 — `enter`/`exit` hooks.** Expose both pre- and post-order callbacks so a single walk can do top-down work (scoping) and bottom-up work (folding) together.

**Pattern 3 — Return-a-node transform.** Make transform visitors return the (possibly new) node so unchanged subtrees are shared and the old tree stays intact.

**Pattern 4 — Span propagation helper.** Provide a `with_span_of(original)` helper used whenever you synthesize a node, so no created node is ever location-less.

**Pattern 5 — `generic_visit` / `super.visit` for the default.** Default behavior should be "recurse into all children"; override only the kinds you care about.

---

## Best Practices

- **Make the default traversal recurse.** A visitor that forgets to descend into children silently misses nested code. Provide and call a generic recurse.
- **Prefer immutable transforms for anything multi-pass.** They compose and debug far better than in-place edits; reach for mutation only in a tight, well-understood hot path.
- **Never synthesize a node without a span.** Copy the source position from whatever the node was derived from; otherwise diagnostics rot.
- **Use exhaustive matching where the language offers it.** Let the compiler enumerate the places a new node kind must be handled.
- **Keep node types data-only.** Behavior belongs in visitors/passes, not bolted onto nodes — this is what keeps the expression problem manageable.
- **Wrap nodes in a `path`/cursor when you need context.** Knowing a node's parent and scope (as Babel's `path` does) is essential for safe replacement and renaming.

---

## Edge Cases & Pitfalls

- **Returning `None` from a transformer deletes the node.** In Python's `NodeTransformer`, forgetting to `return node` silently removes it from the tree.
- **Mutating a shared subtree.** If two parts of the tree reference the same node and you mutate it in place, you changed both. Immutable transforms avoid this.
- **The visitor interface as a breaking change.** Adding a node kind means every third-party visitor must implement a new `visit` method — an API break in published tools.
- **Lost spans on synthesized nodes.** Desugaring without span propagation produces "error at 0:0" or carets under the wrong text.
- **Pre- vs post-order mismatch.** Doing folding work in pre-order (before children are computed) yields wrong results; doing scope setup in post-order (after the body) is too late.
- **Stack overflow on deep trees.** Long chains (`a + a + a + ...`) make recursive walks blow the stack; production compilers sometimes use an explicit work-stack.

---

## Common Mistakes

| Mistake | Why it's wrong | Fix |
|---------|----------------|-----|
| Putting `eval()` etc. as methods on every node class | Smears each operation across all node files; expression problem bites | Use a visitor (or sum type) to collect one operation in one place |
| Forgetting `return node` in a transformer | Node gets deleted | Always return the (possibly new) node |
| Synthesizing nodes with no span | Diagnostics point nowhere | Propagate the original span |
| Mutating in place when others alias the tree | Corrupts unrelated parts | Use immutable transforms with structural sharing |
| Adding a node kind and only fixing the parser | Every visitor/match silently or loudly breaks | Update all operations; let exhaustiveness checks help |
| Doing all work in pre-order | Bottom-up passes need children first | Use post-order (or exit hooks) for upward-flowing computations |

---

## Test Yourself

1. State the expression problem in one sentence, and say which side sum types favor.
2. Explain *double dispatch* in the visitor pattern: which two types are dispatched on, and where does each dispatch happen?
3. Why do sum-type languages rarely need the visitor pattern?
4. You desugar `for` into `while`. The `while`'s condition node is new — what span should it carry and why?
5. What is the difference between an in-place mutation pass and a transformer, and when is each appropriate?
6. In Python's `NodeTransformer`, what happens if a `visit_X` method returns `None`?
7. Babel exposes `enter` and `exit` for each node. What kind of work belongs in each?

---

## Cheat Sheet

```text
REPRESENTATION
  sum type   enum Expr { Lit, BinOp, ... }   match (exhaustive)   ← functional langs
  class hier abstract Node + subclasses      visitor pattern      ← OOP langs

EXPRESSION PROBLEM
  sum type     : + operation = easy   |  + node kind = hard
  class+visitor: + node kind = easy   |  + operation = easy-ish (iface grows)
  pick by: which axis (operations vs kinds) grows more?

VISITOR = double dispatch
  node.accept(v)  -> dispatch on NODE type  -> v.visitBinOp(this)
                                             -> dispatch on VISITOR type
  one visitor = one operation over all node kinds.

TRAVERSAL
  pre-order  (enter): scoping, printing, top-down facts
  post-order (exit):  eval, type-infer, fold — needs children first

TRANSFORM
  in-place  : fast, fragile, aliasing hazards
  transformer/immutable: return new node, share unchanged subtrees (safe)

SPANS
  every node carries (start,end). Synthesized nodes inherit the
  original span. No span -> "error at 0:0".
  Python: fix_missing_locations after building nodes.
```

---

## Summary

A real AST is shaped by two design decisions. **Representation:** a **sum type** (`enum Expr`, matched exhaustively — the functional-language default, great for adding operations) or a **class hierarchy** (`abstract Node` + subclasses, extended via the **visitor pattern** — the OOP default, great for adding node kinds). The tension between these is the **expression problem**: you can make adding *kinds* cheap or adding *operations* cheap, not both for free. The **visitor pattern** is OOP's answer to that tension — it uses **double dispatch** (`accept` picks the node, `visit` picks the operation) to collect one operation into one class without editing the node classes; sum-type languages get the same effect from `match` in a single, exhaustiveness-checked hop.

**Traversal** comes in pre-order (top-down) and post-order (bottom-up) flavors, and most walkers offer both as `enter`/`exit`. Compilers don't just read trees, they **rewrite** them — either by **in-place mutation** (fast, fragile) or, more often in modern tools, by **transformers** that return a *new* immutable tree while sharing unchanged subtrees. Through all of this, every node carries a **source span**, and synthesized nodes inherit the span of whatever they were desugared from, so diagnostics keep pointing at the right text. `senior.md` builds on this with desugaring pipelines, typed/annotated ASTs, and multiple lowered IRs.

---

## What You Can Build

- **A two-backend evaluator+printer** for a tiny expression language, implemented once as a sum-type `match` and once as a visitor, to feel the difference.
- **A Babel/ESLint-style rename codemod** that walks identifiers and rewrites matches.
- **A docstring-stripping `NodeTransformer`** in Python that returns a new tree.
- **A `+=` → `= ... +` desugaring pass** that preserves source spans, with a test that an error on the new node points at the original `+=`.
- **A formatter** that pretty-prints your AST with consistent spacing, proving the AST forgot the original whitespace.

---

## Further Reading

- Philip Wadler, "The Expression Problem" (the original 1998 note) — short and foundational.
- *Design Patterns* (Gang of Four) — the Visitor pattern chapter, including double dispatch.
- The Babel handbook — visitors, `path`, scope, and `enter`/`exit`.
- Python docs: `ast.NodeVisitor` and `ast.NodeTransformer`, plus `fix_missing_locations` and `unparse`.
- *Crafting Interpreters* — the chapter that builds the AST with the visitor pattern, then contrasts it with pattern matching.

---

## Related Topics

- [Junior level](junior.md) — what an AST is and how to walk it.
- [Senior level](senior.md) — desugaring pipelines, typed/annotated ASTs, and multiple IRs.
- [Professional level](professional.md) — arena/flat layouts and red-green incremental trees.
- [Interview questions](interview.md) — visitor, expression problem, and transform questions.
- [Hands-on tasks](tasks.md) — implement visitors, transformers, and span-preserving desugaring.
