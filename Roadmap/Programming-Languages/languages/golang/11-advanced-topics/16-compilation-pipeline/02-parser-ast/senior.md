# Parser & AST — Senior

## 0. Where parsing sits in `go build`

The compiler front-end runs in a fixed order, and parsing is the second stage:

```
1. scan    (cmd/compile/internal/syntax/scanner.go)  bytes → tokens
2. parse   (cmd/compile/internal/syntax/parser.go)   tokens → *syntax.File
3. noding  (cmd/compile/internal/noder)              *syntax.File → ir, driving
4. types   (cmd/compile/internal/types2)             type checking
5. middle  (ir, SSA)                                  optimization
6. backend (ssa, obj)                                 machine code
```

Everything in this file concerns stage 2 and its handoff to stages 3–4. The defining property: stage 2 is **purely syntactic** — it decides "is this grammatically Go?" and nothing about meaning. Keeping it that way is what lets it be fast and lets the later stages own all semantic complexity.

---

## 1. The gc parser: recursive descent

The production compiler's parser lives in `cmd/compile/internal/syntax/parser.go`. It is a **hand-written recursive-descent** parser, not a generated table-driven one (no yacc/goyacc — that was replaced years ago). The design choice matters: recursive descent gives precise, fast error messages and full control over recovery, at the cost of writing one function per grammar production.

The mental model is direct. For each nonterminal in the grammar there is roughly one method on `*parser`:

```
sourceFile()  -> parses the whole file: package clause, imports, decls
decl()        -> one top-level declaration
funcDeclOrNil()
typeDecl()
stmtOrNil()   -> one statement
ifStmt(), forStmt(), switchStmt(), ...
expr()        -> an expression (entry to precedence climbing)
```

Each method assumes the current token is the start of its production, consumes tokens via `p.next()`, and returns a node. The call stack *is* the parse tree being built. When `ifStmt()` calls `p.expr()` for the condition and then `p.blockStmt()` for the body, the nesting of calls mirrors the nesting of the resulting `*syntax.IfStmt`. This direct correspondence — production ↔ method, nesting ↔ call depth — is the defining property of recursive descent and the reason the code is so readable once you know the grammar.

The parser pulls tokens from the scanner (`cmd/compile/internal/syntax/scanner.go`); the parser embeds the scanner and calls `p.next()` to advance. `p.tok` holds the current token kind, `p.lit` the literal text. Lookahead is effectively one token — the parser inspects `p.tok` to decide which production to enter.

A concrete sketch of how `if` parsing nests calls (paraphrased, not verbatim source):

```go
func (p *parser) ifStmt() *IfStmt {
	s := new(IfStmt)
	s.pos = p.pos()
	p.want(_If)                 // consume "if", error if not present
	s.Init, s.Cond = p.header() // optional SimpleStmt + condition expr
	s.Then = p.blockStmt("if")  // recurse into the block
	if p.got(_Else) {           // optional else
		switch p.tok {
		case _If:
			s.Else = p.ifStmt()    // else if  → recurse
		case _Lbrace:
			s.Else = p.blockStmt("else")
		default:
			p.syntaxError("else must be followed by if or statement block")
		}
	}
	return s
}
```

Every `p.want`, `p.got`, `p.blockStmt`, `p.ifStmt` call either consumes input or descends — the structure of the method is the structure of the grammar production, and the call stack at the deepest point is the path from the file root down to the token being read.

---

A subtlety worth naming: the parser also inserts **automatic semicolons** at the scanner boundary (Go's rule that a newline after certain tokens becomes a `;`). By the time the parser sees tokens, statement terminators are already present, so productions like `stmtList` can rely on `;` as a separator without the source literally containing them. This is why Go needs no explicit semicolons but the grammar is still semicolon-delimited.

---

## 2. Precedence climbing for binary expressions

Binary operators are the place where naive "one function per production" would force a deep chain of methods (`orExpr → andExpr → cmpExpr → addExpr → mulExpr → unaryExpr`). Go's parser collapses that into a single loop using **operator-precedence climbing** (a.k.a. precedence-driven Pratt-style parsing).

The technique avoids a chain of one-method-per-level productions. Instead of `orExpr() → andExpr() → cmpExpr() → addExpr() → mulExpr()`, a single parameterised method handles every level by carrying the current precedence floor.

The shape, simplified from `binaryExpr`:

```go
func (p *parser) binaryExpr(prec int) Expr {
	x := p.unaryExpr()
	for p.tok == _Operator && p.prec > prec {
		// p.prec is the precedence of the current operator
		op, opPrec := p.op, p.prec
		p.next()
		y := p.binaryExpr(opPrec) // recurse for higher/equal-precedence RHS
		x = newBinaryExpr(op, x, y)
	}
	return x
}
```

Starting at the lowest precedence and recursing with the current operator's precedence as the new floor naturally produces a **left-associative** tree where higher-precedence operators sit deeper. So `a + b * c` builds `+(a, *(b, c))` without a separate method per level. Go has only five binary precedence levels (`||`, `&&`, comparisons, `+ - | ^`, `* / % << >> & &^`), which keeps this compact.

Trace `a + b * c` (`+` prec 4, `*` prec 5):

1. `binaryExpr(0)` parses `a` as the initial `x`.
2. Sees `+` (prec 4 > 0): consume `+`, recurse `binaryExpr(4)` for the RHS.
3. Inside, parse `b` as `x`; sees `*` (prec 5 > 4): consume `*`, recurse `binaryExpr(5)`.
4. Parse `c`; next is EOF/`;` (prec 0, not > 5): return `c`. Build `*(b, c)`, return it.
5. Back at level 1, RHS is `*(b, c)`. Build `+(a, *(b, c))`.

For a *left*-associative case like `a - b - c`, the loop (not the recursion) handles it: after building `-(a, b)`, the loop sees the second `-` at the same level and folds it as the new `x`, yielding `-(-(a, b), c)`. Recursion deepens on higher precedence; the loop chains equal precedence to the left.

---

## 3. Error recovery and sync points

A compiler must report **many** errors per run, not stop at the first. After detecting a syntax error, the parser must resynchronise to a known-good point and keep going, or it would emit a cascade of garbage errors.

The gc parser tracks a set of "sync" tokens. When `p.syntaxError(...)` fires, it calls `p.advance(followSet...)` which skips tokens until it reaches one of a follow set (e.g. `;`, `}`, `case`, the start of a new declaration). The `stmtList`/`declList` loops pass appropriate follow sets so a broken statement doesn't poison the rest of the block. The std-lib `go/parser` uses the same idea with `p.expect`, `p.advance`, and `syncStmt`/`syncDecl` helpers, plus a guard that bails out if it isn't making progress (to avoid infinite loops on pathological input).

Recovery quality is *why* recursive descent was chosen: the parser knows exactly which production it's in, so it can phrase errors like "expected `;`, found `}`" and pick a sensible follow set, instead of a generic "syntax error" from a table-driven engine.

When the parser can't build a real node after an error, it inserts a **bad node** — `syntax.BadExpr`/`syntax.BadStmt` in gc, `*ast.BadExpr`/`*ast.BadStmt`/`*ast.BadDecl` in `go/ast`. These act as placeholders so the tree stays well-formed and the *rest* of the file still produces usable structure. That's exactly why `parser.ParseFile` can return a partial `*ast.File` together with an error: a tool can still operate on the good parts of a file that doesn't fully parse. The parser also caps the number of reported errors (the std lib stops at 10 unless `parser.AllErrors` is set) to avoid flooding output once recovery starts producing noise.

---

## 4. Two ASTs: `syntax` vs `go/ast`

A common surprise: Go has **two completely separate AST representations**, and they are not interchangeable.

| | `cmd/compile/internal/syntax` | `go/ast` (+ `go/parser`, `go/token`) |
| --- | --- | --- |
| Who uses it | the gc compiler itself | external tooling (gopls, linters, codegen) |
| Node types | `syntax.Node`, `syntax.File`, `syntax.FuncDecl`, `syntax.CallExpr`, `syntax.IfStmt`, ... (in `nodes.go`) | `ast.Node`, `ast.File`, `ast.FuncDecl`, `ast.CallExpr`, `ast.IfStmt`, ... |
| Positions | compact `syntax.Pos` (line/col packed), set on every node via `node.pos` | `token.Pos` resolved through a `FileSet` |
| Comments | not retained for compilation (modes control this) | optional via `parser.ParseComments` |
| Goal | speed and low allocation for the compiler hot path | stability, completeness, ergonomics for tools |

Why two? History and constraints diverged. `go/ast` predates the rewritten compiler and is part of the public, backward-compatible standard library — it can never change shape without breaking every tool. The `syntax` package was introduced (Go 1.5–1.8 era, with the move away from the C compiler) to be **faster and leaner** for the compiler's own use: simpler position encoding, fewer allocations, structure tuned for the next phase rather than for tooling. The compiler team can refactor `syntax` freely between releases because it is internal.

The two trees carry the same *information* but with different field names and shapes; you cannot pass a `syntax.File` where an `ast.File` is wanted. A frequent point of confusion for newcomers reading the compiler is expecting `go/ast` types and finding `syntax` types instead — they look similar but are entirely separate packages.

A side-by-side of the *same* construct in both trees illustrates the divergence:

```go
// go/ast
type CallExpr struct {
	Fun      Expr
	Lparen   token.Pos
	Args     []Expr
	Ellipsis token.Pos
	Rparen   token.Pos
}

// cmd/compile/internal/syntax (conceptually)
type CallExpr struct {
	Fun     Expr
	ArgList []Expr
	HasDots bool
	// position carried in the embedded node, not as separate fields
}
```

Same idea, different ergonomics: `go/ast` exposes every sub-token position (`Lparen`, `Rparen`, `Ellipsis`) because printers and refactoring tools need them; `syntax` keeps only what the compiler needs (`HasDots` bool instead of an ellipsis position), trading tooling-friendliness for compactness. Multiply that across ~40 node types and you see why the teams keep them separate rather than trying to unify.

The historical pivot: when the compiler was translated from C to Go (Go 1.5) and then rewritten, the team built `syntax` fresh rather than reuse `go/ast`, because `go/ast`'s public contract couldn't be changed and its shape wasn't ideal for a high-throughput compiler front-end. The cost is real — two parsers, two node sets to maintain — but it buys the compiler freedom to evolve and the std lib stability for the entire tooling ecosystem.

---

## 5. From parse tree to the rest of the compiler

In the modern compiler the `syntax` AST is not used directly all the way down. The pipeline (Go 1.18+) is roughly:

```
scanner ──tokens──▶ syntax parser ──*syntax.File──▶ noder (types2 IR builder)
                                          │
                                          ├─▶ go/types-style checking (types2)
                                          │
                                          ▼
                                     cmd/compile/internal/ir  (the IR tree, ir.Node)
                                          │
                                          ▼
                                       SSA, optimization, codegen
```

- The **noder** (`cmd/compile/internal/noder`) walks the `*syntax.File` and drives **type checking** using `types2` (the compiler's internal copy of the `go/types` algorithm). Since the "unified IR" work, the noder produces the `ir` representation that later phases consume.
- So `syntax` is a *front-end* tree: it exists to be parsed fast and then translated into the typed `ir.Node` tree. Type information is attached during this translation, never by the parser itself.

It's worth stressing how strict this separation is: the parser produces structure for code that can never compile (`var x int = "hello"` parses fine), and conversely the type checker assumes a syntactically valid tree as input. Each phase has exactly one job, and the interface between them is the AST.

The key senior insight: **parsing and type-checking are distinct phases.** The parser guarantees the program is grammatically well-formed and produces a tree; it knows nothing about whether `a + b` is legal (are they numbers? defined? assignable?). All of that is later. This separation is why a syntactically valid file can still fail to compile, and why tools built only on `go/ast` (no `go/types`) can be fooled by anything semantic.

The std-lib mirror of this pipeline, which tooling reproduces, is:

```
go/scanner → go/parser → go/ast → go/types (Check) → typed program facts
```

`go/types` is the externally-available twin of the compiler's `types2`. A serious analysis tool runs the same two-phase shape the compiler does: parse to `*ast.File`, then run `(*types.Config).Check` (or load via `go/packages`) to get a `*types.Info` mapping idents to objects and expressions to types. Only then can it answer "is this *really* `io.Reader`?" — questions the parser, by design, never touches.

---

## 5.5 Ambiguities and where one-token lookahead isn't enough

Recursive descent with single-token lookahead handles most of Go, but a few constructs are genuinely ambiguous at the point of decision and the parser uses targeted tricks:

- **Composite literals vs. blocks.** In `if x == T{} { ... }`, is `T{}` a composite literal or is `{` the start of the `if` body? Go resolves this by **forbidding** unparenthesised composite literals in the controlling expression of `if`/`for`/`switch`. The parser parses expressions in those positions in a mode that disallows the `{`, removing the ambiguity by grammar rule rather than lookahead.
- **Conversions vs. calls.** `(*T)(x)` is a conversion; `f(x)` is a call. Both are `PrimaryExpr Arguments`. The parser builds the same `CallExpr` shape and lets the **type checker** decide later whether `Fun` denotes a type (conversion) or a function (call). The parser deliberately doesn't try to disambiguate — another instance of "shape now, meaning later."
- **Type parameters vs. indexing.** Since generics (1.18), `a[b]` could be an index or a generic instantiation `F[int]`. The parser produces `*ast.IndexExpr` / `*ast.IndexListExpr` and again leaves the type-vs-value decision to type checking.

The recurring theme: when meaning would require type information, the parser produces a structurally valid node and defers. This keeps the parser fast and the phases cleanly separated.

---

## 6. Practical takeaways

- When debugging the compiler, dump the `syntax` tree with the compiler's own debug flags; when building tools, use `go/ast`. Don't mix them.
- Recursive descent means stack depth grows with nesting; deeply nested expressions can in theory exhaust the stack — the parser has limits/recovery for adversarial input.
- Precedence lives in the *tree shape*, set once at parse time; downstream phases never re-derive it.
- "It parses" ≠ "it compiles." Reserve type questions for `go/types`/`types2`.
- The parser defers genuinely ambiguous decisions (conversion vs. call, index vs. instantiation) to the type checker rather than peeking ahead — a deliberate phase-separation choice.
- Reading `go/parser` (public) teaches the same techniques as the compiler's internal parser; start there.

---

## 6.5 The same technique in the std-lib `go/parser`

`go/parser/parser.go` is structured identically — hand-written recursive descent — and reading it is the most accessible way to internalise the pattern (it's public, unlike the compiler's internal package). The shapes you'll recognise:

```go
// paraphrased from go/parser
func (p *parser) parseIfStmt() *ast.IfStmt {
	pos := p.expect(token.IF)
	init, cond := p.parseIfHeader()
	body := p.parseBlockStmt()
	var else_ ast.Stmt
	if p.tok == token.ELSE {
		p.next()
		switch p.tok {
		case token.IF:     else_ = p.parseIfStmt()
		case token.LBRACE: else_ = p.parseBlockStmt(); p.expectSemi()
		default:           p.errorExpected(p.pos, "if statement or block")
		}
	}
	return &ast.IfStmt{If: pos, Init: init, Cond: cond, Body: body, Else: else_}
}
```

Notice `p.expect` (consume-or-error), `p.next` (advance), the `else`/`else if` recursion, and the explicit `errorExpected` for recovery. The std-lib parser also climbs binary precedence in `parseBinaryExpr(prec1 int)`, mirroring §2. If you want to *see* recursive descent and precedence climbing without compiler internals, `go/parser` is the reference implementation.

---

## 6.6 What the noder actually adds

The translation from `*syntax.File` to `ir.Node` is not a one-to-one copy — it's where the tree gains the information the parser refused to compute:

- **Types on every expression.** After `types2` checking, each expression node carries a resolved type. The parser's `a + b` becomes a typed add with a known operand type (and the operation may be specialised — string concat vs. integer add).
- **Resolved identifiers.** Names are bound to their declarations across files and scopes (not the legacy file-local `Obj`), so `Foo` unambiguously refers to one object.
- **Desugaring.** Some surface syntax is lowered toward a simpler IR (e.g. `range` loops, certain conversions), so later phases see fewer distinct shapes.
- **Implicit operations made explicit.** Implicit conversions, method-value capture, and similar "invisible" steps become explicit IR nodes.

This is why the compiler keeps parsing dumb: the parser produces a faithful syntactic tree quickly, and *all* semantic enrichment happens once, centrally, in the noder/types2/IR step. A tool that wants the same enrichment runs `go/types` over the `go/ast` tree — the public mirror of exactly this step.

---

## 6.7 Reading the source: a map

If you want to study the real implementations, here's where to look:

| File | Contains |
| --- | --- |
| `cmd/compile/internal/syntax/parser.go` | the recursive-descent parser methods |
| `cmd/compile/internal/syntax/nodes.go` | the `syntax` node type definitions |
| `cmd/compile/internal/syntax/scanner.go` | the scanner the parser consumes |
| `cmd/compile/internal/noder/` | translation from `syntax` to `ir` + types2 |
| `cmd/compile/internal/types2/` | the compiler's type checker |
| `src/go/parser/parser.go` | the public, std-lib recursive-descent parser |
| `src/go/ast/ast.go` | the public node types |

Start with `go/parser` for the technique (it's smaller and documented), then compare with `cmd/compile/internal/syntax` to see the performance-tuned variant. The `cmd/compile/README.md` gives the architectural overview that ties the phases together.

---

## 7. Summary

The gc parser (`cmd/compile/internal/syntax/parser.go`) is hand-written recursive descent: one method per production, one-token lookahead, the call stack mirroring the tree. Binary expressions use precedence climbing to encode associativity and precedence directly into tree shape. Error recovery uses follow-set sync points so one bad statement doesn't cascade. Go maintains **two** ASTs — the lean internal `syntax` tree for the compiler and the stable public `go/ast` tree for tooling — because their stability and performance constraints differ. The `syntax` tree feeds the noder, which type-checks via `types2` and builds the `ir` tree for SSA and codegen; parsing and type-checking remain strictly separate phases.

---

## Further reading
- `cmd/compile/internal/syntax`: https://pkg.go.dev/cmd/compile/internal/syntax
- Source: https://cs.opensource.google/go/go/+/master:src/cmd/compile/internal/syntax/parser.go
- `cmd/compile` README (architecture): https://github.com/golang/go/blob/master/src/cmd/compile/README.md
- `go/parser`: https://pkg.go.dev/go/parser
- Go spec (grammar): https://go.dev/ref/spec
