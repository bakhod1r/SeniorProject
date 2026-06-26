# Abstract Syntax Trees — Hands-On Tasks

> **Topic:** [Abstract Syntax Trees](README.md)
> **Focus:** Build, traverse, transform, desugar, and lay out ASTs by hand — from a two-backend evaluator to a span-preserving desugarer to a flat/arena and red-green tree.

---

## Table of Contents

1. [How to Use These Tasks](#how-to-use-these-tasks)
2. [Warm-Up Tasks](#warm-up-tasks)
3. [Core Tasks](#core-tasks)
4. [Advanced Tasks](#advanced-tasks)
5. [Capstone Project](#capstone-project)
6. [Self-Assessment Checklist](#self-assessment-checklist)
7. [Related Topics](#related-topics)

---

## How to Use These Tasks

Work top to bottom — each tier assumes the previous one. Try every task before reading its hint, and write the hint's idea in your own words before reading the (sparse) solution sketch. Pick **one** implementation language and stick with it across a tier so the AST type carries over. Most tasks take 20–90 minutes; the capstone is a multi-session build. Where a task says "verify," actually run it — an AST bug that "looks right" is the norm, not the exception.

You will reuse a tiny expression/statement language throughout. Suggested surface grammar:

```text
expr  := INT | IDENT | expr OP expr | IDENT "(" args ")" | "if" expr expr expr
stmt  := "let" IDENT "=" expr | IDENT "=" expr | IDENT "+=" expr
       | "for" IDENT "in" expr "{" stmt* "}" | expr
```

You may hand-build ASTs in code (no parser required) unless a task says otherwise — the focus is the *tree*, not parsing.

---

## Warm-Up Tasks

### Task W1 — Define the AST two ways

Define the expression AST above (a) as a **sum type** (Rust/OCaml `enum`, or a TypeScript discriminated union) and (b) as a **class hierarchy** (Java/C#/TS classes with an abstract base). Hand-construct the tree for `2 * (3 + 4)` in both.

**Self-check:** Does your sum-type version compile to one type? Does your class version have one class per node kind and a shared base?

<details><summary>Hint</summary>

Sum type: one `enum Expr { Lit(i64), BinOp{op,lhs,rhs}, ... }` with `Box`/`Rc` for children. Class: `abstract class Expr {}` plus `Lit`, `BinOp`, etc. The parens in `2 * (3 + 4)` vanish — they're encoded by which node is whose child.
</details>

### Task W2 — Pretty-print (one operation, two representations)

Write a `print(expr) -> String` that emits `(2 * (3 + 4))`. Do it once as a sum-type `match` function and once as a `Printer` visitor over the class hierarchy.

**Self-check:** Did the sum-type version touch zero node definitions? Did the visitor version touch zero node classes? That's the expression problem's "add an operation" axis in action.

<details><summary>Hint</summary>

`match`: `BinOp{op,lhs,rhs} => format!("({} {} {})", print(lhs), op, print(rhs))`. Visitor: `visitBinOp` returns `"(" + lhs.accept(this) + " " + op + " " + rhs.accept(this) + ")"`.
</details>

### Task W3 — Walk and count

Write a read-only traversal that counts how many `BinOp` nodes the tree contains. Use a sum-type recursion or an `ast.NodeVisitor`-style visitor.

**Self-check:** Does your walker recurse into *all* children by default? A walker that forgets to descend silently undercounts nested expressions.

<details><summary>Hint</summary>

The default action for every node must be "recurse into children"; override only the node you care about (`BinOp`) to also increment the counter.
</details>

### Task W4 — Pre-order vs post-order

Print every node's kind, once in **pre-order** and once in **post-order**, for `2 * (3 + 4)`. Then answer: which order would you use to *evaluate* the tree, and why?

**Self-check:** Post-order for evaluation — you need both operands' values before you can apply the operator. Pre-order would try to apply `*` before `3 + 4` is computed.

---

## Core Tasks

### Task C1 — Two-backend evaluator

Add an `eval(expr) -> i64` operation. Implement it once as a sum-type `match` and once as an `Evaluator` visitor. Run both on `2 * (3 + 4)` and assert they return `14`.

**Self-check:** Both backends share the *same* AST. You added an operation without changing any node definition. If you found yourself editing node classes, you bolted behavior onto data — back it out into a visitor/function.

<details><summary>Solution sketch</summary>

Sum type: `BinOp{op,lhs,rhs} => apply(op, eval(lhs), eval(rhs))`. Visitor: `visitBinOp` computes `lhs.accept(this)` and `rhs.accept(this)` then applies. Both post-order.
</details>

### Task C2 — A `NodeTransformer` that rewrites the tree

In Python (or your language's equivalent), write a transformer that replaces every integer literal `n` with `n + 1`, returning a *new* tree. Verify `x = 5` becomes `x = 5 + 1`.

**Self-check:** Did you remember to **return the node** (returning `None` deletes it)? Did you call `ast.fix_missing_locations`/`copy_location` so the new nodes have positions? Run `ast.unparse` to confirm.

<details><summary>Hint</summary>

Subclass `ast.NodeTransformer`, override `visit_Constant`, and for `int` values return `ast.BinOp(left=node, op=ast.Add(), right=ast.Constant(value=1))`. Then `fix_missing_locations`.
</details>

### Task C3 — In-place vs transformer

Implement a constant-folding pass (`2 * 3` → `6`) two ways: (a) mutating nodes in place, (b) returning a new tree (transformer). Then write a test where *two* parts of the tree share a subtree by reference, and show the in-place version corrupts the shared copy while the transformer does not.

**Self-check:** Can you state the aliasing hazard out loud? In-place mutation of a shared subtree changes it everywhere it's referenced; immutable transforms with structural sharing avoid this.

<details><summary>Hint</summary>

Build `let a = (2*3); let b = a` where both `let`s point at the *same* `BinOp` node object. Fold in place → both see `6`, but if only one should have folded you've corrupted the other.
</details>

### Task C4 — Span-preserving `+=` desugaring

Give every node a `Span {start, end}`. Write a desugaring pass turning `x += e` into `x = x + e`, copying the original `+=`'s span onto the synthesized `=` and `+` nodes. Then write a test asserting that a (simulated) type error on the synthesized `+` reports the *original* `+=`'s span.

**Self-check:** Do your synthesized nodes have a real span, or `(0,0)`? A node with no span is a future "error at 0:0".

<details><summary>Solution sketch</summary>

`AddAssign{target, value, span}` → `Assign{ target, value: BinOp{op:Add, lhs: target.clone(), rhs: value, span}, span }`. The synthesized `BinOp` inherits `span`. Add a `provenance: DesugaredFrom::AddAssign` field if you want the error to *explain* the origin.
</details>

### Task C5 — Desugar `for` into `while`

Lower `for v in iter { body }` into a `while`-style loop over an iterator, introducing a fresh temporary so `iter` is evaluated exactly once. Preserve spans. Confirm by interpreting both the surface `for` and the lowered form over the same input and getting identical results *and* identical side-effect counts (count how many times `iter` is evaluated).

**Self-check:** Is `iter` evaluated once or twice in your lowering? If your desugaring re-evaluates `iter` each iteration, it's wrong.

<details><summary>Hint</summary>

Introduce `let __it = into_iter(iter);` once, then loop `while let Some(v) = __it.next() { body }`. The temporary is what guarantees single evaluation.
</details>

---

## Advanced Tasks

### Task A1 — The double-evaluation trap

Desugar `a[idx()] += 1` where `idx()` has a side effect (e.g., prints / increments a counter). First write the *naive* `a[idx()] = a[idx()] + 1` and observe `idx()` runs twice. Then fix it with a temporary so `idx()` runs once. Write a test counting `idx()` calls.

**Self-check:** Naive version: 2 calls. Correct version: 1 call. This is the canonical desugaring-semantics bug — make sure you can reproduce *and* fix it.

<details><summary>Solution sketch</summary>

Correct: `let __i = idx(); a[__i] = a[__i] + 1`. The temporary `__i` captures the index once; both the load and store reuse it.
</details>

### Task A2 — Typed AST via a side table

After "type checking" (you may hardcode types: int literals are `Int`, etc.), attach a resolved type to every expression. Store the types **in a side table** keyed by a node id, *not* on the node. Write a `type_of(node_id) -> Type` query. Then prove the tree itself was never mutated (e.g., it's still `==` to a fresh clone of the original).

**Self-check:** Did you keep the syntactic tree immutable? Can two analyses share the same tree while holding different type tables?

<details><summary>Hint</summary>

Give each node a stable `id: u32` at construction. Type checking fills `HashMap<u32, Type>`. The tree never changes; only the map grows. This mirrors rustc's `HirId → TypeckResults`.
</details>

### Task A3 — Flat / arena AST + benchmark

Reimplement your AST as a **flat, index-based** structure: `nodes: Vec<Node>` with children as `u32` indices, plus a parallel `spans: Vec<Span>`. Reimplement `eval` to follow indices. Generate a large tree (e.g., a deeply nested sum of 1,000,000 nodes) and benchmark build time, eval time, and peak memory against your original `Box`/pointer version.

**Self-check:** Is the flat version faster to build (one growing `Vec` vs N allocations) and to traverse (cache locality)? Can you explain *why* from the cost model?

<details><summary>Solution sketch</summary>

`enum Node { Lit(i64), BinOp{op,lhs:u32,rhs:u32} }`; `push` returns the index; `eval(id)` does `match self.nodes[id as usize]`. Push to `nodes` and `spans` together so they never drift. Expect the flat version to win on both build and traversal at scale.
</details>

### Task A4 — Interning

Add a string interner: each unique identifier maps to a `Symbol(u32)`; the AST stores `Symbol`s, not `String`s. Write name resolution that compares `Symbol`s. Benchmark identifier equality against the string-comparison version on a program with many repeated names.

**Self-check:** Is `counter == counter` now a `u32` compare instead of a string compare? Is each unique name stored exactly once?

<details><summary>Hint</summary>

`Interner { map: HashMap<String, Symbol>, strs: Vec<String> }`; `intern(s)` returns the existing id or assigns the next one. Downstream, never compare strings — compare `Symbol`s.
</details>

### Task A5 — Struct-of-arrays + a field-selective pass

Convert your flat AST to **struct-of-arrays**: separate `tags: Vec<Tag>`, `lhs: Vec<u32>`, `rhs: Vec<u32>`, `spans: Vec<Span>`. Write two passes — one that only reads `tags` (count `BinOp`s) and one that reads everything (eval) — and benchmark both against the array-of-structs version. Explain the result.

**Self-check:** Does the tag-only pass get faster in SoA (it touches only the `tags` column)? Does the full-eval pass possibly get *slower* (it now stride-jumps across arrays)? SoA isn't universally faster — name when it pays.

### Task A6 — Toy red-green tree

Implement a minimal red-green tree: **green** nodes are immutable, store relative **width** (not absolute position), and have no parent; a **red** wrapper computes absolute position and parent lazily on the way down. Implement `replace_leaf(path, new_leaf)` that returns a new green root, and prove (by pointer/reference identity) that unchanged sibling subtrees are *reused*, not copied.

**Self-check:** After a one-leaf edit, are only the nodes on the path from the edit to the root newly allocated? Are all other green subtrees the *same objects* as before?

<details><summary>Solution sketch</summary>

`GreenNode { kind, width, children: Vec<Rc<GreenNode>> }`. `replace_leaf` clones the children vec at each level on the path (shallow — shares siblings via `Rc`), recurses into the one changed child, and recomputes `width`. Assert `Rc::ptr_eq(old.children[j], new.children[j])` for untouched siblings.
</details>

---

## Capstone Project

### Build a mini compiler front end: surface language → core IR, with a codemod tool on the side

Combine the tier skills into one coherent project. Implement a front end for the expression/statement language above with these stages:

1. **AST** — a sum-type (or class) surface AST, every node carrying a `Span`. (You may parse a real string or hand-build trees; parsing is optional.)
2. **Desugaring pass** — lower `+=`, `for`, and `if`-without-else into a small core (`Assign`, `While`, conditional), preserving spans *and* desugaring provenance, and introducing temporaries to keep evaluation-count semantics correct (Tasks C4, C5, A1).
3. **A second lowered IR** — define a *separate* core-IR type (its own enum/classes) so the type system forbids surface constructs in the core. Write `lower: Ast -> CoreIr`. This is your HIR-style staircase (Senior level).
4. **Typed annotations** — a type-checking pass that attaches resolved types to core-IR expressions via a **side table** (Task A2).
5. **Two backends over the core IR** — an interpreter (`eval`) and a pretty-printer, each one operation in one place (visitor or `match`). Prove they share the IR untouched.
6. **A diagnostics test** — deliberately introduce a type error inside a desugared `for`/`+=` and assert the message points at the *original surface span* with the right provenance ("from `+=`"), not at synthesized machinery.
7. **Layout swap (stretch)** — reimplement the core IR as a flat/arena, interned representation (Tasks A3, A4) and benchmark the interpreter against the pointer version on a large generated program.
8. **Codemod tool (stretch)** — using your transformer infrastructure (or Python `libcst` / `jscodeshift` for a real language), write a tool that performs a mechanical rewrite (e.g., rename a function across the tree) preserving spans, and run it on a multi-node program.

**Definition of done:**

- Surface AST and core IR are *distinct types*; `lower` is total and you cannot construct a surface-only node in the core.
- Every desugaring is **semantics-preserving**: a differential test interprets the surface form and the lowered form and gets identical results *and* identical side-effect counts.
- Every synthesized node has a real span; the diagnostics test passes (error points at surface text + provenance).
- Type information lives in a side table; the IR tree is never mutated by type checking.
- (Stretch) The flat/interned backend is measurably faster to build and traverse on a large input, and you can explain why from the cost model.
- (Stretch) The codemod preserves formatting/comments where the tool's tree allows (libcst yes; lossy `ast` no — note which you used and why).

**Extension ideas:** add `?.` optional-chaining desugaring (preserve short-circuiting); add a red-green core IR for an incremental "re-typecheck only the edited function" demo; add a formatter that proves layout is purely a printing decision by discarding and regenerating it.

---

## Self-Assessment Checklist

You have mastered this topic's hands-on side when you can, without notes:

- [ ] Define an AST as both a sum type and a class hierarchy, and add an operation to each without touching node definitions.
- [ ] Implement a visitor with correct double dispatch, and explain which dispatch happens where.
- [ ] Write a tree transformer that returns a new tree, remembering to return (not drop) nodes and to fix positions.
- [ ] Explain and reproduce the in-place-mutation aliasing hazard, and avoid it with structural sharing.
- [ ] Desugar `+=` and `for` while preserving spans, provenance, and evaluation-count semantics (introduce temporaries).
- [ ] Reproduce *and* fix the `a[idx()] += 1` double-evaluation bug.
- [ ] Store type annotations in a side table and keep the syntactic tree immutable.
- [ ] Build a flat/arena, index-based AST and explain its build/locality wins over a pointer tree.
- [ ] Implement interning and explain why it makes equality O(1).
- [ ] Explain (and sketch) a red-green tree: what lives on green vs red, and how a one-leaf edit reuses unchanged subtrees.

---

## Related Topics

- [Junior level](junior.md) — what an AST is and how to walk it.
- [Middle level](middle.md) — representation, the visitor pattern, transformers, and spans.
- [Senior level](senior.md) — the AST as a phase interface, lowering staircases, and typed ASTs.
- [Professional level](professional.md) — memory layout, arenas/flat index trees, and red-green incremental trees.
- [Interview questions](interview.md) — conceptual, language-specific, trap, and design questions.
