# Abstract Syntax Trees — Interview Level

> **Topic:** [Abstract Syntax Trees](README.md)
> **Focus:** Interview questions on ASTs — representation, the expression problem, the visitor pattern, desugaring/lowering, typed trees, real ASTs (Rust enums, OOP visitor, Python `ast`, Babel/ESTree, Roslyn/Clang), traps, and design.

---

## Table of Contents

1. [How to Use This Page](#how-to-use-this-page)
2. [Conceptual Questions](#conceptual-questions)
3. [Language-Specific Questions](#language-specific-questions)
4. [Tricky / Trap Questions](#tricky--trap-questions)
5. [Design Questions](#design-questions)
6. [Related Topics](#related-topics)

---

## How to Use This Page

Each question lists what the interviewer is probing, a strong answer, and (where useful) a follow-up. Read the answer, then close the page and reproduce it in your own words — recognition is not recall. Questions are grouped: **Conceptual** (representation, expression problem, traversal, lowering), **Language-Specific** (Rust enum ASTs, OOP visitor, Python `ast`, Babel/ESTree, Roslyn/Clang), **Tricky/Trap** (the misconceptions interviewers fish for), and **Design** (open-ended "design an X" prompts where the discussion matters more than a single answer).

---

## Conceptual Questions

### Question 1

**What is an AST, and how does it differ from a parse tree / CST?**

*Probing:* Do you know the boundary between syntax-as-written and meaning-as-structured?

A **parse tree / CST (Concrete Syntax Tree)** mirrors the grammar exactly — every token, every paren, every intermediate production. An **AST (Abstract Syntax Tree)** keeps only semantically meaningful structure and discards syntactic noise: `(1 + 2)` and `1 + 2` produce the *same* AST because the parens were a grouping instruction already consumed by the parser. The CST is verbose and grammar-shaped; the AST is compact and meaning-shaped. Most compilers parse straight to an AST (the CST is never materialized), but source-rewriting tools — formatters, IDEs, refactoring engines — keep a concrete/full-fidelity tree because they must reproduce the original text.

### Question 2

**State the expression problem and say which representation favors which axis.**

*Probing:* Do you understand the fundamental trade-off behind AST representation choice?

The expression problem is the tension that, given a 2-D grid of *node kinds* × *operations*, no naive design makes adding both cheap. **Sum types** (Rust/OCaml `enum`) make adding an *operation* cheap (one new function with a `match`) but adding a *kind* expensive (edit every `match`). **Class hierarchies + visitor** make adding a *kind* cheap (one subclass) but adding an *operation* require touching the visitor interface (which breaks every existing visitor). The practical reading: compilers add operations (passes) far more than kinds, so functional-style compilers use sum types; tooling ecosystems expecting third-party node kinds lean on class hierarchies.

### Question 3

**Explain the visitor pattern and double dispatch.**

*Probing:* Can you explain *why* visitors exist, not just recite the mechanism?

The visitor pattern lets you add an operation over a class-based AST without editing every node class. Mechanism: every node has `accept(visitor)` that calls the visitor's type-specific method (`v.visitBinOp(this)`); the visitor interface has one `visit` method per node type. It is **double dispatch** because behavior depends on two runtime types: `node.accept(v)` dispatches on the *node* type (picks `visitBinOp`), then `v.visitBinOp(this)` dispatches on the *visitor* type (picks `Evaluator` vs `Printer`). Two dispatches select the right (node, operation) cell. The payoff is that one operation lives in one class. Sum-type languages don't need it — `match` is the dispatch in one exhaustiveness-checked hop.

### Question 4

**What is the difference between pre-order and post-order traversal, and when do you use each?**

*Probing:* Do you connect traversal order to the *direction information flows*?

**Pre-order** (node before children) suits work that flows *down*: printing with indentation, building scopes, collecting declarations. **Post-order** (children before node) suits work computed *up* from leaves: evaluation, type inference, constant folding — you need the children's results first. Most real walkers do both, which is why frameworks expose `enter` (pre) and `exit` (post) hooks; Babel does exactly this. Folding in pre-order (before children are computed) is a classic bug; scope setup in post-order is too late.

### Question 5

**What is desugaring, and give three examples.**

*Probing:* Do you understand the front end's job of shrinking the language?

Desugaring rewrites convenience syntax into a small core the back end actually handles, so later passes deal with a handful of constructs instead of dozens. Examples: `a += b` → `a = a + b`; `for x in iter { ... }` → a `while`/`while-let` over an iterator; `x?.y` → an `Option`/`match` chain; a list comprehension → an append loop; `async fn` → a state machine. The hard constraint is **semantics preservation** — the desugared form must evaluate the same things, the same number of times, in the same order, with the same short-circuiting.

### Question 6

**Why do real compilers have multiple lowered ASTs (e.g., HIR, MIR) instead of one?**

*Probing:* Do you grasp the lowering staircase?

Different analyses want different shapes, so compilers lower in stages, each narrower and more explicit than the last, each its own data type. rustc: **AST** (parser output) → **HIR** (macro-expanded, name-resolved, desugared, still tree-shaped) → **THIR** (HIR + types) → **MIR** (a control-flow graph of basic blocks — no longer a tree — where borrow checking and many optimizations run). Separate types let the type system forbid using a surface construct in the back end. Swift does AST → SIL; GHC does HsSyn → Core. "Lower until the back end is bored."

### Question 7

**What is a typed / annotated AST and what does it enable?**

*Probing:* Do you see the syntax→semantics boundary?

A freshly parsed AST is *syntactic* — it knows shape, not meaning. Semantic analysis **annotates** it: name resolution binds each identifier use to its definition; type checking attaches a resolved type to every expression; constant evaluation may attach values. After this, `BinOp(Add, a, b)` knows "result `i32`, integer addition, no overload." The typed AST is the boundary between "what the program says" and "what it means," and every interesting compiler error (type mismatch, unresolved name, non-exhaustive match) is a query against it. Annotations live on the node or, better for sharing, in a side table keyed by node id.

### Question 8

**Why is the AST often described as a "phase interface"?**

*Probing:* Do you think in pipelines?

Because the AST is the contract between compiler phases: parsing produces it, resolution and type checking annotate it, lowering transforms it, codegen consumes it. Each phase is a function `Tree → Tree` (or `Tree → AnnotatedTree`), and the tree's shape *is* the API. The payoff: you can replace a phase — swap a hand-written parser for a generated one, insert a new optimization pass — without touching its neighbors, as long as the tree contract holds. That is why compilers are organized as pipelines of tree transforms.

### Question 9

**Why must source spans survive transformations, and what goes wrong if they don't?**

*Probing:* Do you connect tree transforms to diagnostic quality?

Every node carries a **span** (byte range / line-col) tying it to the original source. As the tree is lowered, synthesized nodes must inherit the span of whatever they were desugared from, because the user wrote surface syntax and every diagnostic — even one found deep in MIR — must point at that surface text. Lose spans and you get "error at 0:0" or carets under nonexistent text. Good compilers also track *why* a node was synthesized (desugaring provenance), so a message can say "the `?` operator cannot be used here" rather than pointing at machinery the programmer never typed.

### Question 10

**Name uses of ASTs beyond compilers.**

*Probing:* Do you see the AST as general infrastructure?

Linters (ESLint, clang-tidy, ruff) run visitor rules that *report* patterns; formatters (Prettier, gofmt, Black) parse to a tree, discard layout, and re-emit canonical layout; codemods (jscodeshift, libcst, OpenRewrite) transform trees at repo scale for mechanical migrations; transpilers (Babel, TypeScript, SWC) parse one language's AST and print another; static-analysis/security tools (Semgrep, CodeQL) match patterns against the tree. What unifies them: they need *structure*, not text — the moment a tool must tell a function call from a same-named variable, it needs an AST.

---

## Language-Specific Questions

### Question 11

**(Rust/OCaml) How do you represent an AST as an enum, and what does exhaustive matching give you?**

*Probing:* Sum-type idioms and compiler-checked completeness.

The whole AST is one `enum` with a variant per node kind:

```rust
enum Expr {
    Lit(i64),
    Var(String),
    BinOp { op: Op, lhs: Box<Expr>, rhs: Box<Expr> },
    Call { callee: Box<Expr>, args: Vec<Expr> },
}
```

An operation is one function that `match`es. **Exhaustive matching** means the compiler checks every variant is handled; add a new variant `Lambda` and every `match` lacking it becomes a compile error that lists exactly where to fix. This is the sum-type superpower: the compiler enumerates the work when the grammar grows. The cost is that adding a kind ripples through every match (the expression problem).

### Question 12

**(OOP) Walk through implementing the visitor pattern for a class-hierarchy AST.**

*Probing:* Can you write it, including the `accept`/`visit` plumbing?

```java
interface Visitor<R> { R visitLit(Lit n); R visitBinOp(BinOp n); }

abstract class Expr { abstract <R> R accept(Visitor<R> v); }
class Lit   extends Expr { long value; <R> R accept(Visitor<R> v){ return v.visitLit(this); } }
class BinOp extends Expr { Op op; Expr lhs, rhs; <R> R accept(Visitor<R> v){ return v.visitBinOp(this); } }

class Evaluator implements Visitor<Long> {
    public Long visitLit(Lit n)   { return n.value; }
    public Long visitBinOp(BinOp n){ return apply(n.op, n.lhs.accept(this), n.rhs.accept(this)); }
}
```

Each node's `accept` performs dispatch #1 (on node type); inside, `v.visitBinOp(this)` performs dispatch #2 (on visitor type). One operation = one visitor class, touching zero node classes. Mention that modern Java (sealed classes + switch patterns) and C# pattern matching let you skip the boilerplate.

### Question 13

**(Python) What do `ast.NodeVisitor` and `ast.NodeTransformer` do, and what is the gotcha with `NodeTransformer`?**

*Probing:* Practical Python `ast` knowledge.

`ast.NodeVisitor` walks the tree read-only — you override `visit_FunctionDef`, `visit_Call`, etc., and call `generic_visit` to recurse. `ast.NodeTransformer` is the same but each `visit_X` *returns* a node, replacing the original; it builds a (possibly) new tree. The gotcha: **returning `None` from a `visit_X` deletes the node** — forgetting `return node` silently removes it. A second gotcha: freshly constructed nodes have no source position, so you must call `ast.fix_missing_locations` (or `ast.copy_location`) or `ast.unparse`/`compile` will fail or diagnostics will point at nothing. Also note `ast` is **lossy**: it drops comments, parens, and exact formatting — use **libcst** if you need text fidelity.

### Question 14

**(Babel/ESTree) What is ESTree, and why does it matter for the JavaScript tooling ecosystem?**

*Probing:* Do you understand shared formats as composition glue?

**ESTree** is the de-facto-standard JSON shape for JavaScript ASTs — a community spec (not part of ECMAScript) that defines node types like `BinaryExpression`, `CallExpression`, `Identifier`. It matters because acorn (parser), ESLint (linter), Prettier (formatter), and Babel (transpiler) all operate on the *same* tree shape, so they compose: one parse, many consumers. This shared contract is why the JS toolchain is so interoperable. Babel's visitors expose `enter`/`exit` per node and wrap nodes in a `path` that knows parent, scope, and how to replace the node safely — which is what makes codemods possible.

### Question 15

**(Roslyn) What are red-green trees and what problem do they solve?**

*Probing:* Do you know the incremental-IDE design?

Red-green trees are Roslyn's two-layer AST for incremental editing. **Green** nodes are immutable, store only *relative width* (not absolute position), have no parent pointer, and are fully shareable — the reusable substance. **Red** nodes are lazy facades built on demand as you navigate down, adding a parent pointer and absolute position; cheap and disposable. The split is deliberate: position and parent are exactly the data that *changes* on an edit, so moving them into the throwaway red layer makes green an immutable, infinitely-shareable substrate. Edit one token, and only the green spine from the edit to the root is rebuilt; every other subtree is reused by reference — the basis of keystroke-latency IDE analysis. (The names come from the original red/green whiteboard drawing.)

### Question 16

**(Clang) What is special about the Clang AST, and how do you inspect it?**

*Probing:* Do you know a real, fidelity-rich C/C++ tree?

The Clang AST is a tree of `Stmt`/`Expr`/`Decl` classes, traversed with `RecursiveASTVisitor`. It is famously *rich and faithful* — it retains enough source detail that clang-tidy, clang-format, and refactoring tools work on real-world C++. You inspect it with `clang -Xclang -ast-dump -fsyntax-only file.c`. A key insight: even this "faithful" tree has *already* lowered some semantics — implicit conversions show up as explicit `ImplicitCastExpr` nodes that were invisible in source. The Clang AST is also immutable; rewriting C++ is done via a separate `Rewriter` operating on source ranges, not by mutating the tree.

### Question 17

**(rustc) Describe rustc's HIR and how it stores type information.**

*Probing:* Do you know a production lowering + annotation design?

**HIR (High-level IR)** is rustc's tree after macro expansion, name resolution, and desugaring (`for`, `while let`, `?` are gone); it is still tree-shaped, close to source, and carries spans on essentially every node. Type information is *not* stored on the HIR nodes — it lives in a **side table** (`TypeckResults`) keyed by `HirId`, computed per-function. Keeping types out-of-band keeps the HIR immutable and shareable across rustc's query system, and lets typeck be cached and recomputed without rebuilding the tree. From HIR, rustc lowers further to THIR (typed) and MIR (a CFG).

---

## Tricky / Trap Questions

### Question 18

**Is `(1 + 2)` represented differently from `1 + 2` in the AST?**

*Probing:* Do you know parens are a CST artifact?

No — in the AST they are identical. Parentheses are a grouping instruction to the *parser*; by the time the AST exists, that grouping is encoded in the *tree shape* (which node is whose child), and the paren tokens are gone. A *CST* would keep the parens; an AST does not. (Caveat: a fidelity-preserving tool like libcst or Roslyn deliberately retains parens precisely so it can round-trip the source.)

### Question 19

**"`a[i] += b` desugars to `a[i] = a[i] + b`." What's wrong?**

*Probing:* The classic desugaring-semantics trap.

It evaluates `a[i]` — and any side effects in the index — **twice**. If the target is `a[expensive()] += 1`, the naive rewrite calls `expensive()` twice, changing behavior. The correct desugaring introduces a temporary so the base/index is evaluated once: `let i = expensive(); a[i] = a[i] + 1`. Desugaring that changes evaluation count, order, or short-circuiting is a correctness bug, and this is the canonical example.

### Question 20

**"Sum types are strictly better than the visitor pattern." True?**

*Probing:* Do you avoid dogma and cite the expression problem?

No — they favor a different axis. Sum types make adding *operations* cheap but adding *node kinds* ripple through every match. Visitors (class hierarchies) make adding *kinds* cheap but adding an *operation* grows the visitor interface and breaks existing visitors. For a compiler that adds passes over a stable grammar, sum types win; for a framework where third parties add node kinds, class hierarchies win. Neither is universally better — the expression problem says you can't have both for free.

### Question 21

**"`ast.unparse(ast.parse(src)) == src`." Will this hold?**

*Probing:* Do you know `ast` is lossy?

Usually **no**. `ast.unparse` round-trips *semantics*, not *text*: the output is equivalent code, but comments are gone, redundant parens are dropped, string quoting and whitespace are normalized. Python's `ast` discards everything not semantically meaningful. If you need byte-faithful round-tripping (formatters, codemods that preserve style), use **libcst**, which keeps a concrete tree.

### Question 22

**Does the Clang/Python AST exactly mirror the source code?**

*Probing:* Do you know ASTs already encode some semantics?

No. Even "faithful" ASTs have lowered things. Clang inserts `ImplicitCastExpr` nodes for conversions that were invisible in source; the tree is *source with some semantics already baked in*, not a pure mirror. And lossy ASTs (Python `ast`) drop comments, parens, and formatting entirely. The mental error is assuming "AST = source as a tree"; it is "the meaningful structure of source, plus whatever semantics the parser/elaborator already resolved."

### Question 23

**In a flat/arena AST, a child is a `u32` index. Isn't that just as safe as a pointer?**

*Probing:* Do you know the safety cost of indices?

No — an index is a *manual* pointer. The compiler/borrow-checker cannot verify it points at a live node, the right arena, or a valid slot; a stale or cross-arena index reads nonsense with no error. You trade safety for locality, allocation, and serialization wins. Mitigations: wrap ids in typed handles (`struct ExprId(u32)`) so you can't cross arenas, and keep a single owning arena. The trade is usually worth it for compilers, but it is a real trade, not a free win.

### Question 24

**Why not just put `eval()`, `typecheck()`, `print()` as methods on each node class?**

*Probing:* Do you see why that's an anti-pattern?

Because it smears *every* operation across *every* node file: evaluation logic for `BinOp` is in `BinOp.java`, for `Call` in `Call.java`, and so on — one pass's logic is scattered across dozens of classes, and a node class grows a new method for every new operation. It also makes nodes carry behavior, not just data. The fix is to collect one operation into one place: a visitor (OOP) or a `match` function (sum types). Keep nodes data-only.

### Question 25

**You added a new AST node kind and the parser now produces it. Are you done?**

*Probing:* Do you anticipate the ripple?

Almost certainly not. In a sum-type AST, every `match` over the old set may now be non-exhaustive — the compiler will (helpfully) list them, but you must handle the new kind in eval, typecheck, lowering, pretty-print, etc. In a visitor AST, every visitor needs a new `visit` method (a breaking API change for published tools). Adding a kind is the *expensive* axis of the expression problem; the parser change is the small part.

---

## Design Questions

### Question 26

**Design the AST for a small language with arithmetic, variables, `if`, functions, and `for` loops. Which representation and why?**

*Probing:* Can you reason from requirements to a representation?

Clarify the consumer first: a compiler/interpreter (operations grow, grammar stable) → **sum type** with exhaustive matching; a framework expecting third-party node kinds → class hierarchy + visitor. For a small language, a sum type:

```rust
enum Expr { Lit(i64), Var(Symbol), BinOp{op,lhs,rhs}, Call{callee,args}, If{cond,then,els} }
enum Stmt { Let{name,value}, Assign{target,value}, For{var,iter,body}, ExprStmt(Expr) }
```

Every node carries a `Span`. Decide CST-vs-AST by whether you'll rewrite source (formatter → keep concrete; interpreter → AST). Plan to **desugar** `for` into a `while` early so the back end has fewer constructs. Store types in a side table after semantic analysis. Mention layout: pointer tree for a prototype, flat/arena if it must scale.

### Question 27

**Design a desugaring pass for `+=` that preserves source spans and correct semantics.**

*Probing:* Span hygiene + semantics preservation together.

For a simple-name target, rewrite `x += e` → `x = x + e` and copy the original `+=` span onto the synthesized `=` and `+` nodes (`copy_location`). For a target with side effects (`a[f()] += e`, `obj.field += e`), introduce a temporary so the base/index is evaluated *once*: `let __t = f(); a[__t] = a[__t] + e`. Tag the synthesized nodes with desugaring provenance ("from `+=`") so an error reports against the user's `+=`, not the synthesized `+`. Validate with a differential test: interpreting the surface form and the desugared form must give identical results *and* identical side-effect counts.

### Question 28

**Design an AST layout for a compiler that must parse million-line inputs fast. What do you choose?**

*Probing:* Data-oriented design judgment.

Choose a **flat / arena, index-based** AST: all nodes in one contiguous `Vec`, children as `u32` indices, parallel `spans` array. This gives one allocation (vs N), cache locality (the traversal streams through the array, the prefetcher works), small handles, and free serialization/parallel hand-off. Add **interning** for identifiers and types so equality is O(1) id comparison and memory is deduplicated. Consider **struct-of-arrays** if passes are field-selective (a tag-counting pass touches only the tag column) — but only after profiling, since SoA hurts non-selective passes. Reclaim via the arena (free wholesale). Wrap ids in typed handles to recover some safety. This is essentially what rustc, Zig, and Carbon do.

### Question 29

**Design the AST/tree for an IDE that must re-analyze on every keystroke.**

*Probing:* Incrementality and structural sharing.

Use a **red-green (persistent) tree**. Green nodes are immutable, store relative width (not absolute position), have no parent — fully shareable. Red nodes are lazy facades adding parent and absolute position, built on demand and discarded. On an edit, rebuild only the green spine from the edit to the root and reuse every other subtree by reference, so a one-character change in a 100k-node file rebuilds ~20 nodes. Keep full fidelity (trivia/whitespace) so you can round-trip and surgically edit source. Intern common green nodes (`;`, keywords) to share substance. Old tree versions persist and are GC'd when unreferenced, so multiple analyses can hold different versions. This is the Roslyn / rust-analyzer (rowan) / SwiftSyntax design.

### Question 30

**Design where type information lives after semantic analysis: on the node, or in a side table? Argue both.**

*Probing:* A real architectural trade-off.

**On-node** (`expr.ty = ...`): simplest to read ("what's the type? read the field"), good for a small single-pass interpreter. But it forces a mutable or rebuilt tree, and if a later pass rebuilds nodes the annotations are lost or stale. **Side table** (`HashMap<NodeId, Ty>`): keeps the syntactic tree immutable and shareable, lets types be computed lazily/per-function and cached, and survives tree-sharing across phases — at the cost of one indirection per "type of this node" query. Production incremental compilers (rustc, Roslyn) choose side tables precisely because immutability and sharing matter more than the indirection. Recommend side tables for any compiler that shares or incrementally recomputes the tree; on-node only for a small, single-pass tool.

---

## Related Topics

- [Junior level](junior.md) — what an AST is and how to walk it.
- [Middle level](middle.md) — representation, the visitor pattern, transformers, and spans.
- [Senior level](senior.md) — the AST as a phase interface, lowering staircases, and typed ASTs.
- [Professional level](professional.md) — memory layout, arenas/flat index trees, and red-green incremental trees.
- [Hands-on tasks](tasks.md) — build visitors, transformers, desugarers, and flat/red-green ASTs.
