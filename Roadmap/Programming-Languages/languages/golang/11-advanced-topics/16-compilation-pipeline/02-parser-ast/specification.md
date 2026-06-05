# Parser & AST — Specification

A reference for the grammar, the node hierarchy, the parser API surface, parse modes, and position semantics. Names follow the standard library (`go/parser`, `go/ast`, `go/token`). This is a lookup document — skim the tables, then jump to the section you need.

## 1. The Go grammar (EBNF excerpts)

The language is defined by a context-free grammar in the spec, written in EBNF: `|` alternation, `[]` optional, `{}` zero-or-more, `()` grouping. Selected productions:

```ebnf
SourceFile = PackageClause ";" { ImportDecl ";" } { TopLevelDecl ";" } .

TopLevelDecl = Declaration | FunctionDecl | MethodDecl .
Declaration  = ConstDecl | TypeDecl | VarDecl .

FunctionDecl = "func" FunctionName Signature [ FunctionBody ] .
MethodDecl   = "func" Receiver MethodName Signature [ FunctionBody ] .

Block     = "{" StatementList "}" .
Statement = Declaration | LabeledStmt | SimpleStmt | ReturnStmt |
            IfStmt | SwitchStmt | ForStmt | ... .

IfStmt   = "if" [ SimpleStmt ";" ] Expression Block
           [ "else" ( IfStmt | Block ) ] .

Expression = UnaryExpr | Expression binary_op Expression .
UnaryExpr  = PrimaryExpr | unary_op UnaryExpr .
PrimaryExpr = Operand | PrimaryExpr Selector | PrimaryExpr Index |
              PrimaryExpr Arguments | ... .
```

**Operator precedence** (binary), highest binds tightest:

| Precedence | Operators |
| --- | --- |
| 5 | `*  /  %  <<  >>  &  &^` |
| 4 | `+  -  |  ^` |
| 3 | `==  !=  <  <=  >  >=` |
| 2 | `&&` |
| 1 | `||` |

Unary operators (`+ - ! ^ * & <-`) bind tighter than any binary operator. All binary operators are left-associative.

---

## 2. Node interface hierarchy

Every node satisfies `ast.Node`:

```go
type Node interface {
	Pos() token.Pos // position of first character of the node
	End() token.Pos // position of first character immediately after the node
}
```

Three sub-interfaces partition most nodes (each adds an unexported marker method so the sets stay disjoint):

```go
type Expr interface { Node; exprNode() } // produces a value
type Stmt interface { Node; stmtNode() } // performs an action
type Decl interface { Node; declNode() } // declares names
```

### Expressions (`ast.Expr`)

| Node | Meaning |
| --- | --- |
| `*ast.BadExpr` | placeholder for a parse error |
| `*ast.Ident` | identifier (`Name string`, `Obj *Object`) |
| `*ast.Ellipsis` | `...T` in params / `[...]T` arrays |
| `*ast.BasicLit` | literal: `Kind token.Token`, `Value string` |
| `*ast.FuncLit` | `func(...){...}` value |
| `*ast.CompositeLit` | `T{...}` |
| `*ast.ParenExpr` | `( X )` |
| `*ast.SelectorExpr` | `X.Sel` |
| `*ast.IndexExpr` | `X[Index]` |
| `*ast.IndexListExpr` | `X[A, B]` (generics, Go 1.18+) |
| `*ast.SliceExpr` | `X[lo:hi:max]` |
| `*ast.TypeAssertExpr` | `X.(T)` |
| `*ast.CallExpr` | `Fun(Args...)` |
| `*ast.StarExpr` | `*X` (deref and pointer type) |
| `*ast.UnaryExpr` | `op X` |
| `*ast.BinaryExpr` | `X op Y` |
| `*ast.KeyValueExpr` | `Key: Value` in composite lits |

Type-expression nodes (used where a type is written): `*ast.ArrayType`, `*ast.StructType`, `*ast.FuncType`, `*ast.InterfaceType`, `*ast.MapType`, `*ast.ChanType`.

### Statements (`ast.Stmt`)

`*ast.BadStmt`, `*ast.DeclStmt`, `*ast.EmptyStmt`, `*ast.LabeledStmt`, `*ast.ExprStmt`, `*ast.SendStmt`, `*ast.IncDecStmt`, `*ast.AssignStmt`, `*ast.GoStmt`, `*ast.DeferStmt`, `*ast.ReturnStmt`, `*ast.BranchStmt` (break/continue/goto/fallthrough), `*ast.BlockStmt`, `*ast.IfStmt`, `*ast.CaseClause`, `*ast.SwitchStmt`, `*ast.TypeSwitchStmt`, `*ast.CommClause`, `*ast.SelectStmt`, `*ast.ForStmt`, `*ast.RangeStmt`.

### Declarations (`ast.Decl`)

| Node | Meaning |
| --- | --- |
| `*ast.BadDecl` | parse-error placeholder |
| `*ast.GenDecl` | `import` / `const` / `type` / `var` (holds `Specs []Spec`) |
| `*ast.FuncDecl` | function or method (`Recv` non-nil for methods) |

Specs: `*ast.ImportSpec`, `*ast.ValueSpec`, `*ast.TypeSpec`. Support nodes: `*ast.Field`, `*ast.FieldList`, `*ast.Comment`, `*ast.CommentGroup`, `*ast.File`, `*ast.Package`.

### Selected node fields

The fields you reach for most often:

```go
type File struct {
	Doc      *CommentGroup   // package doc, or nil
	Name     *Ident          // package name
	Decls    []Decl          // top-level declarations
	Imports  []*ImportSpec   // all imports
	Comments []*CommentGroup // all comments (with ParseComments)
}

type FuncDecl struct {
	Doc  *CommentGroup
	Recv *FieldList // receiver (nil → function, non-nil → method)
	Name *Ident
	Type *FuncType  // signature: params and results
	Body *BlockStmt // nil for forward/external decls
}

type CallExpr struct {
	Fun      Expr      // function expression
	Lparen   token.Pos
	Args     []Expr    // arguments
	Ellipsis token.Pos // position of "..." (or NoPos)
	Rparen   token.Pos
}

type BasicLit struct {
	ValuePos token.Pos
	Kind     token.Token // INT, FLOAT, IMAG, CHAR, STRING
	Value    string      // RAW source text, e.g. "42" or `"hi"`
}
```

Note `BasicLit.Value` is the literal source text (quotes and all), not the decoded value.

---

## 3. Parser API surface (`go/parser`)

```go
func ParseFile(fset *token.FileSet, filename string, src any, mode Mode) (*ast.File, error)
func ParseDir(fset *token.FileSet, path string, filter func(fs.FileInfo) bool, mode Mode) (map[string]*ast.Package, error)
func ParseExpr(x string) (ast.Expr, error)
func ParseExprFrom(fset *token.FileSet, filename string, src any, mode Mode) (ast.Expr, error)
```

- `src` may be `string`, `[]byte`, `io.Reader`, or `nil` (read file from disk).
- `ParseFile` returns a partial `*ast.File` **even on error** when `mode` permits, so tools can work on broken code.
- `ParseExpr` parses a standalone expression (no package context) — convenient for templates.

---

## 4. Parse modes (`parser.Mode`)

A bitset passed as the `mode` argument:

| Mode | Effect |
| --- | --- |
| `parser.PackageClauseOnly` | stop after the `package` clause |
| `parser.ImportsOnly` | stop after the import declarations |
| `parser.ParseComments` | retain comments in `*ast.File.Comments` and `.Doc`/`.Comment` |
| `parser.Trace` | print a parse trace to stdout (debugging) |
| `parser.DeclarationErrors` | report declaration errors |
| `parser.SpuriousErrors` | (deprecated) report extra errors |
| `parser.SkipObjectResolution` | do **not** build `*ast.Object` resolution (`Ident.Obj` stays nil) — faster, less memory |
| `parser.AllErrors` | report all errors, not just the first 10 |

Combine with `|`, e.g. `parser.ParseComments | parser.SkipObjectResolution`.

Object resolution (`Ident.Obj`, `File.Scope`, `File.Unresolved`) is a legacy, file-local name-binding pass — it is **not** real type checking and is widely skipped in favour of `go/types`.

Typical combinations:

```go
// Tooling that does its own type checking:
parser.SkipObjectResolution
// Comment-preserving codemod:
parser.ParseComments | parser.SkipObjectResolution
// Fast import-graph scan:
parser.ImportsOnly | parser.SkipObjectResolution
// Maximum diagnostics:
parser.AllErrors | parser.ParseComments
```

---

## 5. Position semantics (`go/token`)

```go
type Pos int                 // opaque offset into a FileSet; 0 == token.NoPos
type Position struct {        // resolved, human-readable
	Filename string
	Offset   int             // 0-based byte offset
	Line     int             // 1-based
	Column   int             // 1-based, in bytes
}
```

Resolution and registry:

```go
fset := token.NewFileSet()
f := fset.AddFile(name, -1, size)        // usually done by the parser
pos := fset.Position(node.Pos())         // Pos -> Position
```

Rules:

- `Pos()` returns the first byte; `End()` returns the byte **after** the last — so a node spans `[Pos(), End())`.
- `token.NoPos` (zero) means "no position"; common on synthesised nodes. `Position{}.IsValid()` is false when `Line == 0`.

Common position-bearing sub-token fields (useful for precise edits):

| Node | Sub-position field(s) |
| --- | --- |
| `*ast.CallExpr` | `Lparen`, `Ellipsis`, `Rparen` |
| `*ast.BasicLit` | `ValuePos` |
| `*ast.BinaryExpr` | `OpPos` |
| `*ast.BlockStmt` | `Lbrace`, `Rbrace` |
| `*ast.GenDecl` | `TokPos`, `Lparen`, `Rparen` |
| `*ast.ReturnStmt` | `Return` |
- Positions are only meaningful relative to the `FileSet` that produced them. Sharing one `FileSet` across all parsed files gives every node a globally unique `Pos`.
- A `BasicLit`'s `ValuePos`, a `CallExpr`'s `Lparen`/`Rparen`, etc., let you locate sub-tokens precisely (used by printers and refactoring tools).

---

## 6. Quick API recall

| Want | Use |
| --- | --- |
| parse a file | `parser.ParseFile` |
| parse one expression | `parser.ParseExpr` |
| keep comments | mode `parser.ParseComments` |
| skip name binding (faster) | mode `parser.SkipObjectResolution` |
| walk every node | `ast.Inspect` / `ast.Walk` |
| dump the tree | `ast.Print` / `ast.Fprint` |
| resolve a `Pos` | `fset.Position(pos)` |
| associate comments | `ast.NewCommentMap` |
| re-emit source | `format.Node` / `printer.Fprint` |

---

## 6b. Worked grammar→node example

The statement `if n > 0 { return n }` maps onto nodes as:

```
*ast.IfStmt
├── Init: nil
├── Cond: *ast.BinaryExpr { X: Ident "n", Op: GTR (>), Y: BasicLit "0" }
├── Body: *ast.BlockStmt
│         └── List[0]: *ast.ReturnStmt
│                       └── Results[0]: *ast.Ident "n"
└── Else: nil
```

Each field corresponds directly to a slot in the `IfStmt` grammar production: `Init` is the optional `SimpleStmt`, `Cond` the `Expression`, `Body` the `Block`, `Else` the optional `else` branch.

---

## 6c. Walking and printing API

```go
// go/ast — traversal & dumping
func Inspect(node Node, f func(Node) bool)
func Walk(v Visitor, node Node)            // Visitor.Visit(Node) Visitor
func Print(fset *token.FileSet, x any) error
func Fprint(w io.Writer, fset *token.FileSet, x any, f FieldFilter) error
func NewCommentMap(fset *token.FileSet, node Node, comments []*CommentGroup) CommentMap

// go/printer — render AST back to source
func Fprint(output io.Writer, fset *token.FileSet, node any) error
type Config struct { Mode Mode; Tabwidth int; Indent int }

// go/format — gofmt-formatted rendering (wraps printer)
func Node(dst io.Writer, fset *token.FileSet, node any) error
func Source(src []byte) ([]byte, error)
```

`printer.Config` lets you tune output (e.g. `printer.UseSpaces`, `printer.TabIndent`); `format.Node` is the canonical, gofmt-equivalent choice for tools.

---

## 7. Summary

Go's grammar is EBNF with five binary precedence levels (all left-associative) and tighter-binding unary operators. The AST is rooted at `*ast.File`; every node implements `ast.Node` (with `Pos`/`End`), and most also implement `ast.Expr`, `ast.Stmt`, or `ast.Decl`, kept disjoint by marker methods. The parser API centres on `ParseFile`/`ParseExpr`, tuned by a `parser.Mode` bitset (`ParseComments`, `SkipObjectResolution`, `AllErrors`, ...). Positions are opaque `token.Pos` offsets resolved to `token.Position` through a `FileSet`; a node spans `[Pos(), End())`, and `NoPos` marks the absence of a position.

---

## Further reading
- Go spec (full grammar): https://go.dev/ref/spec
- `go/ast` node reference: https://pkg.go.dev/go/ast
- `go/parser` (modes, ParseFile): https://pkg.go.dev/go/parser
- `go/token` (Pos, Position, FileSet): https://pkg.go.dev/go/token
- `parser.Mode`: https://pkg.go.dev/go/parser#Mode
