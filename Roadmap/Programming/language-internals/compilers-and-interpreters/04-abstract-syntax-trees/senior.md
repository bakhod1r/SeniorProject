# Abstract Syntax Trees — Senior Level

> **Topic:** [Abstract Syntax Trees](README.md)
> **Focus:** The AST as a phase interface — desugaring pipelines, multiple lowered ASTs (HIR/MIR), typed/annotated trees after semantic analysis, span survival through transforms, and the real ASTs of Python, Babel, Clang, Roslyn, and rustc.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Code Examples](#code-examples)
8. [Trade-offs](#trade-offs)
9. [Use Cases](#use-cases)
10. [Coding Patterns](#coding-patterns)
11. [Best Practices](#best-practices)
12. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
13. [Common Mistakes](#common-mistakes)
14. [Tricky Points](#tricky-points)
15. [Test Yourself](#test-yourself)
16. [Cheat Sheet](#cheat-sheet)
17. [Summary](#summary)
18. [What You Can Build](#what-you-can-build)
19. [Further Reading](#further-reading)
20. [Related Topics](#related-topics)

---

## Introduction

> 🎓 At middle level you learned how a single AST is *represented* (sum type vs class hierarchy) and *traversed* (visitors, transformers, spans). At senior level the question changes: **there is rarely one AST.** A production compiler threads a *sequence* of trees — surface AST, desugared AST, one or more lowered intermediate representations — each one a deliberately narrower language than the last, and the AST's real job is to be the **stable interface between phases**.

The surface syntax a programmer writes is wide: `for`, `while`, list comprehensions, `+=`, `?.`, pattern matches, string interpolation, async/await, default arguments. Every one of those is a convenience. The back end does not want to handle forty kinds of loop; it wants one. So the front end *lowers* the wide surface language into a narrow core, in stages, and each stage is an AST-to-AST transform. The discipline that makes this tractable is **desugaring**: systematically rewriting convenience constructs into a small set of primitives, while the source spans ride along so diagnostics still point at what the programmer actually wrote.

This level is about that pipeline and the trees inside it. We will look at why compilers keep *several* ASTs (rustc's `AST → HIR → THIR → MIR`, Swift's `AST → SIL`, GHC's `HsSyn → Core`), what a **typed/annotated AST** is and why type information turns a parse artifact into a semantic one, and how the span — the thread from middle level — must survive every lowering or your error messages rot. Then we ground all of it in the real ASTs you will actually touch: Python's `ast`, Babel/ESTree, Clang's AST, Roslyn's red-green trees, and rustc's HIR. The `professional.md` file then goes underneath these to memory layout, arenas, and incremental red-green trees.

## Prerequisites

- The [middle](middle.md) level: sum-type vs class-hierarchy ASTs, the expression problem, the visitor pattern and double dispatch, transformers vs in-place mutation, and source spans.
- Comfort with at least one statically-typed language's compiler model (you know roughly what "type checking" produces).
- A working idea of what an intermediate representation (IR) is, even if only "something between the AST and machine code."
- Having read or written at least one tree transform (a Babel plugin, a `NodeTransformer`, a desugaring pass) helps the lowering sections land.

You do **not** need: SSA construction details, register allocation, or backend codegen — those live past the AST. You also do not need parser theory; we still start *after* the tree exists.

## Glossary

| Term | Meaning |
| --- | --- |
| **CST / parse tree** | Concrete Syntax Tree: a tree that mirrors the grammar exactly, including every token, paren, and keyword. The AST's verbose ancestor. |
| **Lowering** | Translating a higher-level construct into lower-level primitives (`for` → `while`; method call → function call + receiver). |
| **Desugaring** | Lowering specifically of *syntactic sugar* — convenience forms — into core forms. |
| **Core language** | The minimal set of constructs the back end actually handles, after all sugar is removed. |
| **HIR** | High-level IR (rustc): the AST after name resolution and desugaring, still tree-shaped, simpler than surface syntax. |
| **THIR / MIR** | rustc's Typed HIR and Mid-level IR: further-lowered, typed, eventually a control-flow graph (no longer a tree). |
| **Typed / annotated AST** | An AST whose nodes carry the results of semantic analysis: resolved types, symbol bindings, constant values. |
| **Phase interface** | A data structure that one compiler phase produces and the next consumes; the AST is the archetypal one. |
| **Span propagation** | Copying source positions onto synthesized nodes so diagnostics survive lowering. |
| **Red-green tree** | Roslyn's two-layer design: an immutable, position-agnostic "green" node reused everywhere, wrapped by a lazy "red" node that knows its parent and absolute position. |
| **ESTree** | The de-facto-standard JSON shape for JavaScript ASTs that Babel, ESLint, Prettier, and acorn all agree on. |
| **Codemod** | An automated, AST-driven, large-scale source transformation (jscodeshift, Babel, libcst, OpenRewrite). |
| **Sea of nodes** | A graph IR (not tree) used past the AST in some JITs (HotSpot C2); mentioned for contrast. |

## Core Concepts

### 1. AST vs CST: what the parser keeps and what it throws away

A **parse tree / CST (Concrete Syntax Tree)** mirrors the grammar one-to-one: every parenthesis, every `;`, every keyword token, every intermediate grammar production (`Term → Factor → Primary`) shows up as a node. An **AST** keeps only what carries meaning. `(1 + 2)` and `1 + 2` produce the *same* AST — the parens were a grouping instruction to the parser, already consumed by the time the tree exists. A chain `Expr → AdditiveExpr → MultiplicativeExpr → PrimaryExpr → 1` collapses to a single literal node.

The distinction is not academic. Most compilers parse straight into an AST (the CST is conceptual, never materialized) because the CST is enormous and full of nodes no later phase cares about. But a crucial class of tools *wants* the CST: formatters, refactoring engines, and IDEs need to reproduce or surgically edit the original text, including comments and whitespace, which a pure AST has discarded. This is exactly why **Roslyn keeps a full-fidelity tree** (you can round-trip the exact source byte-for-byte) and why **libcst** ("Concrete Syntax Tree") exists for Python alongside the lossy `ast`. The rule of thumb: a compiler can throw away syntax; a *source-rewriting tool* usually cannot.

### 2. The AST as a phase interface

The single most useful senior-level reframing: the AST is not a thing the compiler *has*, it is the *contract between phases*. Parsing produces it; name resolution annotates it; type checking annotates it further; lowering transforms it; codegen consumes it. Each phase is a function `Tree → Tree` (or `Tree → AnnotatedTree`), and the tree's shape *is* the API.

This has a sharp design consequence: **you can change a phase without touching its neighbors as long as the tree contract holds.** Swap a recursive-descent parser for a generated one — downstream phases never notice, because they consume the AST, not the parser. Add a new optimization pass — it slots between two existing passes as another `Tree → Tree`. This is why compilers are organized as pipelines of tree transforms and why "the AST" is really "the family of trees that flow between phases."

### 3. Desugaring and the narrow core

The front end's job is to shrink the language. The programmer writes a wide surface language; the back end implements a narrow core; **desugaring is the bridge.** Canonical examples:

- `a += b` → `a = a + b` (and `a[i] += b` carefully, evaluating `a[i]` *once*).
- `for x in iter { body }` → roughly `{ let mut it = iter.into_iter(); while let Some(x) = it.next() { body } }`.
- `x?.y` → `match x { Some(v) => Some(v.y), None => None }` (or equivalent).
- List comprehension `[f(x) for x in xs if g(x)]` → a loop that appends.
- `async fn` → a state machine returning a future.
- Default/keyword arguments → call-site argument reordering and fill-in.

After desugaring, the back end sees a handful of constructs — function, call, conditional, loop, assignment, literal — instead of dozens. Every later pass is simpler because of it. The art is choosing the core: too small and desugaring becomes a contortion (encoding everything as lambdas); too large and you have not actually simplified the back end.

The subtle part is *semantics preservation*. `a[expensive()] += 1` must evaluate `expensive()` exactly once, so the naive desugar `a[expensive()] = a[expensive()] + 1` is **wrong** — you must introduce a temporary: `let i = expensive(); a[i] = a[i] + 1`. Desugaring that changes evaluation count, order, or short-circuiting is a correctness bug, and these bugs are notoriously easy to ship.

### 4. Multiple lowered ASTs: HIR, MIR, and friends

Why not desugar in one pass? Because different analyses want different shapes. Real compilers maintain a *staircase* of trees, each lower than the last:

**rustc** is the textbook example:
- **AST** — exactly what the parser produced; macros not yet expanded fully, sugar intact.
- **HIR (High-level IR)** — after macro expansion and name resolution; `for`/`while let`/`?` desugared; still tree-shaped and close to source. Borrow-check-irrelevant. Carries spans everywhere.
- **THIR (Typed HIR)** — HIR with full type information attached; used for exhaustiveness checking and as the input to MIR building.
- **MIR (Mid-level IR)** — a *control-flow graph* of basic blocks, not a tree. Borrow checking, drop elaboration, and many optimizations happen here. This is where the "tree" finally becomes a graph.

Other languages do the same with different names: **Swift** lowers `AST → SIL` (Swift Intermediate Language, where ARC and ownership are made explicit); **GHC** lowers Haskell's giant surface syntax `HsSyn` into tiny **Core** (System FC, about a dozen constructs) before optimizing; **Kotlin** has a frontend IR (FIR) and a backend IR. The pattern is universal: **lower in stages, each stage narrower and more explicit than the last, each a separate data type so the type system enforces "you cannot accidentally use a surface construct in the back end."**

### 5. The typed / annotated AST

A freshly parsed AST is a *syntactic* artifact: it knows shape, not meaning. `a + b` is a `BinOp(Add, Var("a"), Var("b"))` — but it does not yet know whether `a` is an `int`, a `String`, an overloaded operator, or undeclared. **Semantic analysis annotates the tree**: name resolution attaches each `Var` to the symbol it refers to (which `a`? the local or the field?); type checking attaches a resolved type to every expression node; constant evaluation may attach computed values.

After this, the same tree means much more. `BinOp(Add, ...)` now carries "result type `i32`, this is integer addition, no overload." This annotated tree is what enables everything downstream: codegen needs the type to pick the right instruction; overload resolution needs it to pick the right method; the borrow checker needs resolved bindings. Some compilers store annotations *in* the node (a `ty` field), some in a *side table* keyed by node id (rustc keeps a `TypeckResults` map keyed by `HirId`, which keeps the HIR itself immutable and shareable). The side-table approach is increasingly favored: it keeps the tree clean and lets type information be computed lazily and cached per-function.

The conceptual jump: **a typed AST is the boundary between "what the program says" and "what the program means."** Before it, you have syntax; after it, you have semantics, and every interesting compiler error (type mismatch, unresolved name, non-exhaustive match) is a query against the annotated tree.

### 6. Spans surviving every transform

The thread from middle level becomes a discipline at senior level. As the tree is lowered through HIR, MIR, and beyond, the original source span must survive, because the user wrote *surface* syntax and any diagnostic — even one discovered in MIR borrow checking — must point at the surface text. rustc carries a `Span` on essentially every HIR and MIR node, and crucially tracks **desugaring provenance**: a span can record "this node came from desugaring a `?` operator," so the error message can say "the `?` operator cannot be used here" instead of pointing at synthesized machinery the programmer never wrote.

The failure mode is concrete: desugar `for` into `while` without copying spans, and a type error in the loop variable points at column 0, or at the synthesized `while` that has no textual existence. Worse, a *correct* span pointing at the wrong *conceptual* construct ("error in this `while`" when the user wrote a `for`) confuses more than no span at all. Production compilers therefore track both *where* (byte range) and *why* (desugaring origin), and lowering passes are reviewed specifically for span hygiene.

### 7. Real ASTs you will actually use

Theory meets practice in five widely-used trees:

- **Python `ast`** — a clean sum-of-classes (`Module`, `FunctionDef`, `BinOp`, `Call`, `Constant`...) with `NodeVisitor` (read) and `NodeTransformer` (rewrite). Lossy: it drops comments, parens, and exact formatting. `ast.parse` / `ast.unparse` round-trips *semantics*, not *text*. For text-faithful work, **libcst** keeps a concrete tree.
- **Babel / ESTree** — JavaScript's AST is a JSON object graph following the **ESTree** spec, the shared contract that lets acorn (parser), ESLint (linter), Prettier (formatter), and Babel (transpiler) all operate on the *same* tree shape. This shared format is why the JS tooling ecosystem composes so well: one parse, many consumers.
- **Clang AST** — a C/C++ tree of `Stmt`/`Expr`/`Decl` classes, traversed with `RecursiveASTVisitor`. It is famously *rich and faithful* — it retains enough source detail that clang-tidy, clang-format, and refactoring tools work on real code. Inspect it with `clang -Xclang -ast-dump`.
- **Roslyn (C#/VB)** — uses **red-green trees** (next section / `professional.md`): immutable, full-fidelity (round-trips exact source including trivia/whitespace), and built for incremental IDE editing.
- **rustc HIR** — the desugared, name-resolved tree described above; typed via side tables; spans everywhere.

Each embodies a different priority: Python `ast` favors simplicity, Clang favors fidelity for tooling, Roslyn favors incremental editing, rustc favors a clean lowering staircase. Knowing *which tree you are holding* tells you what it will and will not preserve.

### 8. Uses beyond compilers

The AST escaped the compiler decades ago. The same tree powers an entire class of source-level tools:

- **Linters** (ESLint, clang-tidy, ruff) — visitor-based rules over the AST that *report* style/bug patterns.
- **Formatters** (Prettier, gofmt, clang-format, Black) — parse to a tree, throw away the original layout, re-emit canonical layout. The tree is the proof that formatting is purely a printing decision.
- **Codemods** (jscodeshift, libcst, OpenRewrite) — AST transformers applied at repo scale to perform mechanical migrations ("rename this API across 10,000 files").
- **Transpilers** (Babel, TypeScript, SWC) — parse one language's AST, lower/translate, print another.
- **Static analysis & security tools** (Semgrep, CodeQL) — match patterns against the AST (and beyond) to find vulnerabilities.

What unifies them: they all need *structure*, not text. The moment a tool must understand "is this a function call or a variable named the same thing," it needs an AST. This is why "learn the AST" pays off far beyond writing a compiler.

## Real-World Analogies

| Concept | Analogy |
| --- | --- |
| CST vs AST | A court stenographer's verbatim transcript (every "um", every pause) vs the clean published opinion (only what matters). |
| Phase interface | A standardized shipping container: the ship, the crane, and the truck all agree on the container, so any one can be swapped. |
| Desugaring | A chef's *mise en place*: forty menu items reduced to a dozen prepped base components the line cooks actually combine. |
| Lowering staircase (HIR/MIR) | Translating a novel: idiomatic prose → literal gloss → interlinear annotation → grammar-tagged corpus, each stage more explicit, less literary. |
| Typed AST | A blueprint after the structural engineer stamps it: same drawing, now load-bearing facts attached. |
| Span provenance | A footnote that survives every re-edit: "this sentence was paraphrased from the original on page 7." |
| ESTree shared format | USB: one connector spec, so any device works with any port. |
| Red-green tree | A wiki page (shared, immutable content) plus your browser tab's scroll position and breadcrumb (where *you* are in it). |

## Mental Models

### "There is no AST; there is a pipeline of trees."

Stop picturing one tree. Picture a conveyor belt of trees, each narrower than the last: surface → desugared → HIR → typed → MIR. Each station does one transform. A senior engineer thinks in *which tree am I in* and *what has been made explicit by now*.

### "Lower until the back end is bored."

You keep lowering until the remaining language is so small and explicit that the back end has nothing left to decide. `for` is interesting; `while` is less so; a conditional jump is boring. The whole front end exists to make the back end's input boring.

### "Annotations turn syntax into semantics."

Parsing gives you a tree that *looks* like the program. Semantic analysis pins facts onto it — types, bindings, constants — until it *means* the program. The annotated AST is the first artifact a compiler can actually reason about correctness with.

### "The span is the programmer's GPS coordinate, and it must survive teleportation."

Every transform teleports nodes into new shapes. The span is the coordinate that says where in the *original* source this thing lived. Lose it during a transform and the user gets "error at 0:0" — the compiler equivalent of "you are lost."

## Code Examples

### Python — desugaring `+=` correctly (evaluate target once)

```python
import ast

class DesugarAugAssign(ast.NodeTransformer):
    """
    Rewrite `target OP= value` into `target = target OP value`.
    For a simple Name target this is safe. For a subscript/attribute target
    a naive rewrite would evaluate the target expression twice — a bug.
    """
    def visit_AugAssign(self, node):
        self.generic_visit(node)
        if isinstance(node.target, ast.Name):
            # Safe: a plain name has no side effects when evaluated.
            load = ast.Name(id=node.target.id, ctx=ast.Load())
            new = ast.Assign(
                targets=[ast.Name(id=node.target.id, ctx=ast.Store())],
                value=ast.BinOp(left=load, op=node.op, right=node.value),
            )
            return ast.copy_location(new, node)   # <-- span survives
        # Subscript/attribute targets need a temporary to evaluate the
        # base ONCE; left as an exercise (see tasks.md). Don't ship the
        # naive double-eval version.
        return node

src = "x += 1"
tree = DesugarAugAssign().visit(ast.parse(src))
ast.fix_missing_locations(tree)
print(ast.unparse(tree))   # x = x + 1
```

The `copy_location` call is the span discipline in miniature: the synthesized assignment inherits the original `+=`'s position, so a later error still points at the user's line.

### Inspecting a real lowering — Clang AST dump

```bash
# See the tree Clang actually builds. Note how `for` is kept structurally
# but every implicit conversion becomes an explicit ImplicitCastExpr node.
clang -Xclang -ast-dump -fsyntax-only example.c
```

```text
`-FunctionDecl <line:1:1> main 'int ()'
  `-CompoundStmt
    |-DeclStmt
    | `-VarDecl sum 'int' cinit
    |   `-IntegerLiteral 'int' 0
    `-ForStmt
      |-DeclStmt ...
      |-BinaryOperator 'int' '<'
      | |-ImplicitCastExpr 'int' <LValueToRValue>   <-- made explicit
      | | `-DeclRefExpr 'i' 'int'
      | `-IntegerLiteral 'int' 10
      ...
```

The lesson: even a "faithful" AST has *already lowered* things — implicit conversions that were invisible in source are now explicit nodes. The AST is never a pure mirror of source; it is source with some semantics already baked in.

### Rust-style lowering sketch — `for` → `while let` (pseudocode)

```rust
// Surface:
//   for x in iter { body }
//
// HIR lowering (conceptually), preserving the for-loop's span on synthesized nodes:
{
    let mut __iter = IntoIterator::into_iter(iter);   // span = `iter`
    loop {                                             // span = whole `for`
        match __iter.next() {                          // span = whole `for` (desugared)
            Some(x) => { body }                        // x-span = original `x`
            None => break,
        }
    }
}
```

Two things to notice: a fresh `__iter` temporary is introduced (the iterator is evaluated exactly once), and every synthesized node carries a span tagged as *desugared from `for`*, so a borrow error in the loop reports against the user's `for`, not against machinery they never typed.

### A typed AST as a side table (Rust-flavored pseudocode)

```rust
// The HIR stays immutable and span-rich. Types live in a SEPARATE table
// keyed by node id — so the tree itself is never mutated by type checking.
struct Hir { nodes: Arena<HirNode> }          // built once, shared
struct TypeckResults {
    node_types: HashMap<HirId, Ty>,           // expr id -> resolved type
    bindings:   HashMap<HirId, DefId>,        // name use -> definition
}

fn type_of(expr: HirId, results: &TypeckResults) -> Ty {
    results.node_types[&expr]                 // query, don't mutate
}
```

Keeping types out-of-band is what lets rustc share the HIR across queries and recompute typeck per-function without rebuilding the tree.

## Trade-offs

| You gain... | ...at the cost of... |
| --- | --- |
| Multiple lowered ASTs (HIR/MIR) — each pass sees the simplest shape it needs | More data types, more conversions, more code to maintain |
| A small core language after desugaring | Desugaring logic must rigorously preserve semantics (eval count/order) |
| Annotations in a side table (immutable tree) | An extra indirection on every "what's the type of this node" query |
| Annotations stored on the node | Mutable or rebuilt trees; harder to share across phases |
| Full-fidelity CST (Roslyn, libcst) | Much larger trees; more memory; you carry trivia you may not need |
| Lossy AST (Python `ast`) | Cannot round-trip exact source; useless for formatters |
| Shared AST format (ESTree) | Locked into a spec; evolving the language means evolving the spec for everyone |
| Span provenance tracking | Every node grows; every transform must maintain it |

## Use Cases

- **Self-hosting compilers** maintain explicit HIR/MIR staircases for analysis at the right altitude (rustc, Swift, GHC).
- **Transpilers** translate between surface languages by lowering one AST and printing as another (Babel ES2022→ES5, TypeScript→JS).
- **IDEs** need typed ASTs to power go-to-definition, hover types, and rename — all queries against the annotated tree.
- **Large-scale migrations** use codemods over the AST to mechanically refactor thousands of files safely.
- **Security scanners** (CodeQL, Semgrep) match against the AST plus dataflow to find vulnerability patterns.
- **Formatters** prove that layout is a printing concern by discarding it at parse and regenerating it.

## Coding Patterns

### 1. One AST type per altitude

Give each level of the staircase its own data type (`Ast`, `Hir`, `Mir`). The type system then *forbids* using a surface construct in the back end — a desugared-away `for` simply cannot be constructed at the HIR level.

### 2. Side-table annotations

Keep the syntactic tree immutable; store types/bindings in a map keyed by node id. The tree stays shareable and cheap to clone; semantic facts are computed and cached separately.

### 3. Span-copying constructors

Never call a raw node constructor in a lowering pass. Wrap it: `mk(kind, span_of(original))`. Make it impossible to synthesize a span-less node.

### 4. Desugar with explicit temporaries

When a target appears more than once after lowering (`a[i] += b`), bind it to a fresh temporary first. Make "evaluate once" a structural property of the lowered tree, not a hope.

### 5. Separate "lower" from "optimize"

Lowering changes the *language* (wide → narrow); optimization changes the *program* within a fixed language. Keep them as distinct pass categories so each is independently testable.

## Best Practices

- **Decide CST-or-AST by your output.** If you must reproduce source text (formatter, refactoring tool), keep a concrete/full-fidelity tree. If you only consume meaning (compiler, interpreter), parse straight to an AST.
- **Make each lowering total and semantics-preserving.** Write a property test: lowering then interpreting must give the same result as interpreting the surface form.
- **Propagate spans mechanically, not manually.** A helper that *requires* a source span to build a node beats remembering to set one.
- **Track desugaring provenance** so diagnostics can explain "this came from a `?`/`for`/comprehension."
- **Prefer side tables for type annotations** when the tree must be shared or incrementally recomputed.
- **Reuse the ecosystem's AST format** (ESTree for JS, libcst/ast for Python) rather than inventing your own — interop with linters/formatters is free.
- **Test lowerings with round-trip and differential checks**, not just spot examples; sugar interactions are where bugs hide.

## Edge Cases & Pitfalls

- **Double evaluation in desugaring.** `a[f()] += 1` → `a[f()] = a[f()] + 1` calls `f()` twice. Introduce a temporary.
- **Short-circuit loss.** Desugaring `a && b` or `x?.y` into something that always evaluates both sides changes behavior.
- **Span-less synthesized nodes.** Forgetting `copy_location` / span propagation yields "error at 0:0" or carets under nonexistent text.
- **Wrong-construct spans.** A correct byte range that points at a synthesized `while` confuses the user who wrote a `for`. Track provenance.
- **Lossy AST used for formatting.** Python `ast` drops comments and parens; a formatter built on it silently deletes them. Use libcst.
- **Macro expansion order.** In languages with macros (Rust, Lisp), desugaring must happen *after* expansion, or you desugar code that does not exist yet.
- **Annotations on a mutated tree.** If type info is stored on nodes and a later pass rebuilds nodes, the annotations are lost or stale. Side tables avoid this.
- **Assuming the AST mirrors source.** Even Clang's AST inserts `ImplicitCastExpr`; the tree already encodes semantics that were invisible in text.

## Common Mistakes

1. **Treating "the AST" as singular** in a compiler that actually has three or four trees. Know which altitude you are at.
2. **Desugaring that changes evaluation count or order** — the classic `+=`/comprehension/short-circuit bug.
3. **Losing spans across lowering**, then wondering why error messages degraded.
4. **Storing types by mutating nodes**, then rebuilding nodes in a later pass and silently dropping the types.
5. **Building a formatter on a lossy AST** and deleting the user's comments.
6. **Inventing a bespoke AST format** when ESTree/`ast`/libcst already exist, then losing all linter/formatter interop.
7. **Confusing lowering with optimization** and mixing language-narrowing logic with program-improving logic in one tangled pass.
8. **Desugaring before macro expansion** in a macro language.

## Tricky Points

- **The CST is usually never materialized** — most parsers go grammar → AST directly; the "CST" is a mental model, except in fidelity-preserving tools that deliberately keep it.
- **rustc's MIR is not a tree** — it is a CFG of basic blocks. The "AST staircase" stops being a tree at MIR; the word "AST" stops applying.
- **Type info location is a real architectural choice** — on-node (simple, mutable) vs side-table (shareable, immutable). rustc, Roslyn, and most incremental compilers chose side tables for a reason.
- **`ast.unparse` round-trips semantics, not text** — `unparse(parse(src))` is *equivalent* code, not *identical* source. Comments, parens, and whitespace are gone.
- **ESTree is a community spec, not an official ECMAScript one** — yet it is more load-bearing than many official specs because the whole JS toolchain depends on it.
- **Clang's AST is immutable by design** — clang's RecursiveASTVisitor reads; rewriting C++ is done via a separate `Rewriter` working on source ranges, not by mutating the tree.
- **Spans can carry *why*, not just *where*** — rustc's `SpanData` records an expansion/desugaring context, which is how it produces "in this expansion of macro `foo`" diagnostics.

## Test Yourself

1. Give three constructs your favorite language desugars, and write the core form each lowers to.
2. Why does `a[f()] += 1` require a temporary, and what bug appears without one?
3. Explain the difference between a CST and an AST, and name a tool that needs each.
4. rustc has AST, HIR, THIR, MIR. At which point does the "tree" stop being a tree, and why?
5. What is a typed/annotated AST, and what becomes possible only after annotation?
6. Argue for storing type information in a side table rather than on the node. When is on-node better?
7. Why must a desugaring pass track *why* a node was synthesized, not just *where* the original was?
8. Why does the JS ecosystem (ESLint, Prettier, Babel) compose so well? What shared artifact makes it possible?
9. `ast.unparse(ast.parse(src)) == src` is often `False`. Explain.

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────────┐
│  SENIOR AST CHEAT SHEET                                                │
├──────────────────────────────────────────────────────────────────────┤
│ CST  = grammar-faithful, every token/paren. Tools: formatters, IDEs.  │
│ AST  = meaning only; (1+2) == 1+2. Compilers parse straight to it.    │
├──────────────────────────────────────────────────────────────────────┤
│ AST = THE PHASE INTERFACE. Each phase: Tree -> Tree (or -> AnnTree).   │
│ Swap a phase freely as long as the tree contract holds.               │
├──────────────────────────────────────────────────────────────────────┤
│ DESUGARING (wide surface -> narrow core):                             │
│   a += b      -> a = a + b   (temp if target has side effects!)       │
│   for x in it -> while-let over an iterator (eval `it` ONCE)          │
│   x?.y        -> match/Option chain (preserve short-circuit)          │
├──────────────────────────────────────────────────────────────────────┤
│ LOWERING STAIRCASE (rustc):                                           │
│   AST -> HIR -> THIR -> MIR(CFG, not a tree)                          │
│   Each: narrower, more explicit, its own data type.                   │
├──────────────────────────────────────────────────────────────────────┤
│ TYPED AST: semantic analysis pins types+bindings onto the tree.       │
│   on-node  : simple, mutable                                          │
│   side-table (HirId -> Ty): immutable, shareable  ← favored           │
├──────────────────────────────────────────────────────────────────────┤
│ SPANS survive every transform. Track WHERE (bytes) + WHY (desugar     │
│   origin). No span -> "error at 0:0".                                  │
├──────────────────────────────────────────────────────────────────────┤
│ REAL ASTs:                                                            │
│   Python ast (lossy) / libcst (fidelity)                              │
│   Babel/ESTree (shared by ESLint, Prettier, acorn)                    │
│   Clang AST (rich, RecursiveASTVisitor, -ast-dump)                    │
│   Roslyn red-green (full fidelity, incremental)                       │
│   rustc HIR (desugared, side-table types, spans)                      │
└──────────────────────────────────────────────────────────────────────┘
```

## Summary

- A real compiler has **not one AST but a pipeline of trees**, each lower and narrower than the last (rustc: AST → HIR → THIR → MIR; Swift: AST → SIL; GHC: HsSyn → Core).
- The AST is best understood as the **phase interface**: each phase is `Tree → Tree`, and the tree's shape is the contract that lets phases be swapped independently.
- **Desugaring** shrinks the wide surface language into a small core, and its hardest obligation is **semantics preservation** — evaluate targets once, keep short-circuiting, preserve order.
- A **typed/annotated AST** is the line between syntax and semantics; annotations live either on nodes or, better for sharing, in **side tables** keyed by node id.
- **Spans must survive every transform**, carrying both *where* (byte range) and *why* (desugaring provenance), or diagnostics rot.
- **CST vs AST** is decided by output: source-rewriting tools keep a concrete/full-fidelity tree; compilers parse straight to an AST.
- The real ASTs — Python `ast`/libcst, Babel/ESTree, Clang, Roslyn red-green, rustc HIR — each encode a different priority (simplicity, fidelity, incrementality, clean lowering).
- The AST powers far more than compilers: linters, formatters, codemods, transpilers, and security tools all need structure, not text.

## What You Can Build

- A **mini lowering pipeline** that takes a small language with `for`, `+=`, and `?` and desugars to a three-construct core, with a differential test proving semantics are preserved.
- A **span-preserving desugarer** whose test asserts that an error on a synthesized node points at the original surface construct.
- A **typed-AST query API** that stores types in a side table and answers "type of this expression" without mutating the tree.
- A **transpiler** that parses Python `ast`, lowers comprehensions to loops, and re-emits valid Python.
- A **codemod** built on libcst (or jscodeshift) that performs a repo-wide API rename while preserving comments and formatting.

## Further Reading

- The rustc dev guide: "The HIR", "The THIR", "The MIR" chapters — the clearest public description of a real lowering staircase.
- Simon Peyton Jones et al., *System F with Type Equality Coercions* (GHC Core) — how a huge surface language compiles to a dozen constructs.
- The ESTree specification (estree.github.io) — the shared JS AST contract.
- Clang documentation: "Introduction to the Clang AST" and `RecursiveASTVisitor`.
- Roslyn wiki: "Roslyn Overview" and the red-green tree design notes.
- Python docs: `ast`, `ast.NodeTransformer`, `ast.unparse`; and the libcst documentation for the fidelity-preserving alternative.
- *Crafting Interpreters* (Nystrom) — desugaring and the AST as a phase boundary, made concrete.

## Related Topics

- [Junior level](junior.md) — what an AST is and how to walk it.
- [Middle level](middle.md) — representation, the visitor pattern, transformers, and spans.
- [Professional level](professional.md) — memory layout, arenas/flat index trees, and red-green incremental trees.
- [Interview questions](interview.md) — desugaring, lowering, typed-AST, and real-AST questions.
- [Hands-on tasks](tasks.md) — build a lowering pipeline, a span-preserving desugarer, and a codemod.
