# Composite — Specification

## 1. Origins

The Composite pattern was formally catalogued by Gamma, Helm, Johnson, and Vlissides in *Design Patterns: Elements of Reusable Object-Oriented Software* (Addison-Wesley, 1994). Their stated intent was to "compose objects into tree structures to represent part-whole hierarchies and let clients treat individual objects and compositions of objects uniformly." The chapter's running examples were a graphics editor (`Graphic` with `Line`, `Rectangle`, and `Picture` subclasses) and a file system (`Directory` containing `File` and other `Directory` instances). The pattern's defining commitment is uniformity: leaf and composite share an interface so client code never needs to ask which kind of node it is holding.

The idea predates the GoF book by two decades and arrived through three independent traditions:

- **Smalltalk Morphic (1980s)** — the Morphic UI toolkit treated every visual element, from a single pixel to a complete window, as a `Morph`. A `Morph` could contain submorphs; layout, drawing, and event dispatch all traversed the submorph tree uniformly. Morphic's "everything is a morph" stance is the earliest production-grade Composite system and the direct ancestor of the modern scene-graph idea.
- **Lisp S-expressions (1958 onward)** — McCarthy's original Lisp represented programs and data as cons cells: a node was either an atom (leaf) or a pair (composite), and every Lisp function that walked code did so by recursing on `car` and `cdr`. The pattern is so deeply embedded that "Lisp data" and "Composite" are synonymous in language-design literature. Macro systems, code walkers, and pattern matchers all rely on the uniform tree shape.
- **W3C DOM Level 1 (1998)** — the Document Object Model standardised a single `Node` interface for HTML and XML documents; concrete `Element`, `Text`, `Comment`, `Document`, and `Attr` nodes all implement it. The `firstChild`, `nextSibling`, `parentNode`, and `childNodes` accessors are the canonical Composite navigation API. Every browser DOM, every server-side HTML parser, and every XML library since has imitated this shape.

Go-specific history:

- **`go/ast` (Go 1.0, 2012)** — the canonical Composite implementation in the standard library. Every node in a parsed Go source file satisfies `ast.Node` (with `Pos()` and `End()`); concrete types are `*ast.File`, `*ast.FuncDecl`, `*ast.BlockStmt`, `*ast.BinaryExpr`, and roughly seventy others. `ast.Walk` and `ast.Inspect` are the visitor-style traversal helpers; the pattern shipped on day one and has not changed shape across Go releases.
- **`golang.org/x/net/html` (Go 1.0 era)** — the `html.Node` struct is a tagged-composite: a single concrete type with a `Type` field (`ElementNode`, `TextNode`, `DocumentNode`, `CommentNode`) and `FirstChild`, `NextSibling`, `PrevSibling`, `Parent` pointers. This is the DOM rendered in Go style, with explicit parent pointers and sibling links rather than a `Children []Node` slice.
- **`spf13/cobra` (2014 onward)** — the CLI command tree. Each `*cobra.Command` registers child commands via `parent.AddCommand(child)`; dispatch walks the tree by argv prefix matching. Cobra is a hybrid Composite plus Registry, and is the de facto Go CLI framework.
- **`spf13/viper` (2014 onward)** — configuration trees as nested `map[string]any`. Lookups by dotted path (`viper.GetString("server.http.port")`) walk the tree segment by segment; the composite is the value side of every config provider, and the navigation API is the dotted-key string rather than per-node accessors.

Go's distinctive contribution is to lean on interfaces rather than inheritance: a Composite is "any type whose method set includes the node operations", not "any class deriving from a `Node` base class". The pattern is therefore lighter in Go than in the GoF formulation. There is no abstract base class, no shared field set, no protected child slice. Each implementation chooses its own shape; the interface is the only contract.

A second Go-specific consequence is that Composite trees are rarely a single shape across a codebase. A web server might use `html.Node` for response rendering, `ast.Node` for code generation, `cobra.Command` for CLI plumbing, and `yaml.Node` for configuration — four Composites with four different shapes, none deriving from a shared base, none sharing a `Walk` helper, each idiomatic for its domain. The GoF formulation assumes a single Composite per system; Go's many-shapes-many-domains stance is the modern reality.

---

## 2. Go language mechanics

### 2.1 Interface satisfaction

Go's structural interface satisfaction is what makes Composite cheap. A type satisfies `Node` by having the right method set; no `implements` keyword, no inheritance chain, no constructor wiring. A new leaf type drops into an existing tree by defining the interface methods and nothing else. This is why `go/ast` can have seventy node types without a class hierarchy: each is a struct with the right methods, and the compiler verifies satisfaction at the point of use.

The implicit-satisfaction model also means leaf and composite types can live in different packages without coupling. A package can define a new `Node` implementation without importing the package that defined the interface, provided it has the right methods. In practice most Composite trees live in one package, but the option is there.

### 2.2 Recursive `[]Interface` in struct

The canonical Composite uses a slice of the interface type as the child collection:

```go
type Node interface {
    Name() string
    Children() []Node
}

type Folder struct {
    name     string
    children []Node
}

func (d *Folder) Name() string     { return d.name }
func (d *Folder) Children() []Node { return d.children }
```

The recursion is in the slice element type, not in the struct field's concrete type. Go forbids a struct field of its own value type (infinite size at compile time) but permits a slice of an interface that the struct itself satisfies. This is the structural foundation of every pure-interface Composite in Go.

The trade-off is that `children` is a slice of pointers-or-interfaces, not a slice of values. Each element costs an interface header (type pointer plus data pointer); access requires a method-table lookup. For trees with millions of nodes this matters; for trees with hundreds it does not.

### 2.3 Type assertions for downcast

Most Composite operations are uniform — `Walk(root, fn)` cares only about `Children()`. Some operations need to distinguish kinds: count files versus directories, format expressions one way and statements another. The Go idiom is a type assertion or type switch at the consumer:

```go
switch x := n.(type) {
case *File:
    total += x.Size()
case *Folder:
    fmt.Println(x.Name())
}
```

The assertion is local to the operation, not embedded in the node. Adding a new operation does not modify any node type; adding a new node type forces every type switch to grow a case. This is the well-known Composite-versus-Visitor expression problem, and Go's switch syntax makes it visually explicit.

### 2.4 Generic `Tree[T]` (Go 1.18+)

Go 1.18 enabled a typed Composite where the leaf payload is a type parameter:

```go
type Tree[T any] struct {
    Value    T
    Children []*Tree[T]
}

func (t *Tree[T]) Walk(fn func(*Tree[T])) {
    fn(t)
    for _, c := range t.Children {
        c.Walk(fn)
    }
}
```

This is the homogeneous-tree variant: every node carries the same payload type. It is the right shape for syntax trees of a single grammar, B-trees, segment trees, and other algorithmic data structures. It is the wrong shape for heterogeneous trees (DOM, AST) where leaf and composite differ in fields; for those, the interface form remains canonical.

### 2.5 Closures for traversal callbacks

`ast.Inspect(root, func(n ast.Node) bool { ... })` is the closure-driven visitor. The callback closes over local state (a counter, a slice of matches, an error variable) without needing a dedicated `Visitor` struct. This is the cheapest and most idiomatic form for one-shot analyses:

```go
var calls []*ast.CallExpr
ast.Inspect(file, func(n ast.Node) bool {
    if c, ok := n.(*ast.CallExpr); ok {
        calls = append(calls, c)
    }
    return true
})
```

The closure replaces the GoF `ConcreteVisitor` class. The trade-off is one closure per operation rather than one method per node type per operation; for analysis tools with dozens of passes, the visitor-with-methods form scales better.

### 2.6 Pointer receivers and slice mutation

Composite nodes are almost always passed as pointers in Go. A `Folder` value carries an unexported `children []Node` slice; if `Add` is defined on a value receiver, the append mutates a copy of the slice header and the caller's tree is unchanged. The convention is pointer receivers throughout — `func (d *Folder) Add(n Node)` — and the interface is satisfied by `*Folder`, not `Folder`. Code that stores a node in an `[]Node` slice stores the interface value wrapping the pointer; the slice's element layout is `(type-ptr, data-ptr)` per element, and the `data-ptr` is the `*Folder` itself. This is the standard Go interface-storage shape and it costs sixteen bytes per child on a 64-bit machine.

### 2.7 Embedding for shared node behaviour

Struct embedding lets a node type reuse a common implementation. A `BaseNode` with `name string` and `Name() string` can be embedded into every concrete node type; the methods are promoted, and the embedded struct's fields are accessible by name. Embedding is the Go substitute for inheritance in Composite trees; it composes rather than extends, and it never introduces a class hierarchy. The trade-off is that the embedded type appears in the method set, which can confuse type switches if the embedded type itself satisfies the Component interface.

---

## 3. Canonical Go shapes

### 3.1 Pure-interface `Node`

```go
type Node interface {
    Name() string
    Children() []Node
}

type File struct{ name string }
func (f *File) Name() string     { return f.name }
func (f *File) Children() []Node { return nil }

type Folder struct {
    name     string
    children []Node
}

func (d *Folder) Name() string     { return d.name }
func (d *Folder) Children() []Node { return d.children }
func (d *Folder) Add(n Node)       { d.children = append(d.children, n) }
```

The most idiomatic Go Composite. Each kind is its own struct; the interface unifies traversal. Strong static typing, easy to add new kinds, requires a type switch at consumers that distinguish kinds. The reference shape for analysis-oriented trees (`go/ast`).

### 3.2 Tagged-struct with `Kind`

```go
type Kind int

const (
    KindScalar Kind = iota
    KindMapping
    KindSequence
)

type Node struct {
    Kind     Kind
    Value    string
    Children []*Node
}
```

One concrete struct with a discriminator. Easy to (un)marshal, easy to serialize, easy to inspect in a debugger. Adding behavior means switch-on-`Kind` everywhere; the compiler cannot help catch missing cases. The reference shape for parser output that round-trips through JSON or YAML (`yaml.v3.Node`).

### 3.3 Visitor pattern integration

```go
type Visitor interface {
    Visit(n Node) Visitor
}

func Walk(v Visitor, n Node) {
    if next := v.Visit(n); next != nil {
        for _, c := range n.Children() {
            Walk(next, c)
        }
    }
}
```

The visitor returns a new visitor (or nil to stop descending). This is the `go/ast.Walk` shape. Adding an operation means defining a new visitor; node types do not change. Adding a node type means every visitor grows a case. Right when many independent operations traverse the same tree (linter, formatter, evaluator).

### 3.4 `fs.FS`-style behavioural composite

```go
type FS interface {
    Open(name string) (File, error)
}

type ReadDirFS interface {
    FS
    ReadDir(name string) ([]DirEntry, error)
}
```

The tree exists conceptually but no `Children()` method exposes it directly; navigation is by path. The implementation might be a real filesystem, a `zip` archive, an in-memory map, or an HTTP-backed virtual tree. The interface is about traversal verbs, not structural accessors. Right when the tree might be virtual or remote and per-node iteration is less useful than path lookup.

### 3.5 Parent-pointer doubly-linked

```go
type Node struct {
    Parent      *Node
    FirstChild  *Node
    LastChild   *Node
    PrevSibling *Node
    NextSibling *Node
    Type        NodeType
    Data        string
}
```

The DOM shape, used by `golang.org/x/net/html`. No `Children []Node` slice; iteration is by walking sibling links. Constant-time parent and sibling access; mutations preserve link invariants and are correspondingly delicate. Right for trees with frequent mutation, parent climbing, or sibling navigation — interactive document editors and live DOMs.

---

## 4. Standard library use

### 4.1 `go/ast` Node

`ast.Node` has two methods: `Pos() token.Pos` and `End() token.Pos`. Concrete types (`*ast.File`, `*ast.FuncDecl`, `*ast.BlockStmt`, and dozens more) embed source positions and structural children directly. Traversal is via `ast.Walk(visitor, node)` (interface-driven) or `ast.Inspect(node, func(ast.Node) bool)` (closure-driven). The package is the textbook reference for pure-interface Composite in Go and the substrate of every Go static-analysis tool.

### 4.2 `encoding/xml` Token tree

The streaming `xml.Decoder.Token()` returns `xml.Token` values (`StartElement`, `EndElement`, `CharData`, `Comment`, `ProcInst`, `Directive`); the higher-level `xml.Unmarshal` materialises a tree of Go structs. Either model presents XML as a tree of typed nodes. The Token form is a flat sequence with implied tree structure; the Unmarshal form binds the tree to a user-defined struct hierarchy.

### 4.3 `io/fs.FS`

`fs.FS` is the behavioural Composite: the filesystem is a tree, but the interface exposes `Open(name string)`. `fs.WalkDir(fsys, root, fn)` performs the depth-first traversal without the consumer ever seeing a `Children()` method. The same interface backs real disk filesystems, zip archives, embedded `//go:embed` filesystems, and the testfs variants used in unit tests.

### 4.4 `net/http.ServeMux` as routing tree (1.22+)

The Go 1.22 `ServeMux` rewrite introduced method-aware patterns and segment matching, turning the mux into a routing tree. Patterns like `"GET /users/{id}/posts"` are decomposed into segments and stored in an internal trie; lookup walks the trie segment by segment. The mux is a Composite of route nodes from an internal-implementation standpoint, even though the public API exposes only `Handle` and `HandleFunc`.

### 4.5 `html/template` parse tree

`text/template/parse.Tree` is the parsed-template Composite. Concrete node types — `ActionNode`, `IfNode`, `RangeNode`, `WithNode`, `TextNode` — each implement the `parse.Node` interface (`Type()`, `String()`, `Position()`, `Copy()`). Execution walks the tree, evaluating actions against the input data context. The pattern is identical to `go/ast` in shape; the methods differ because the operations differ.

---

## 5. Real library use

### 5.1 `golang.org/x/net/html`

The reference Go DOM implementation. `html.Node` is a tagged struct with parent and sibling pointers; `html.Parse(r)` returns the document root; `html.Render(w, node)` walks the tree to produce HTML. The package is the substrate of every Go web scraper, every server-side HTML transformer, and most accessibility checkers.

### 5.2 `gopkg.in/yaml.v3`

`yaml.Node` is the textbook tagged-struct Composite. A `Kind` field (`DocumentNode`, `SequenceNode`, `MappingNode`, `ScalarNode`, `AliasNode`) discriminates; `Content []*yaml.Node` holds children. The shape preserves YAML's quirks — anchors, aliases, tags, document streams — that the higher-level `Unmarshal` API cannot represent. Round-trip editors and configuration linters operate at this layer.

### 5.3 `spf13/cobra`

The CLI command tree. Each `*cobra.Command` carries a slice of `Commands []*Command` and a `parent *Command`; `parent.AddCommand(child)` wires the tree. Argv dispatch walks from root by prefix match (`myapp users list` resolves `users` then `list`); help, completion, and validation all traverse the same tree. Cobra is the most-used Composite in the Go CLI ecosystem.

### 5.4 `spf13/viper`

Configuration as a tree of nested `map[string]any`. Dotted-key lookups (`viper.GetString("server.http.port")`) split the key on `.` and walk the tree segment by segment. The tree itself is not exposed as a `Node` interface; it is a recursive map, and viper's `Sub(key)` returns a subtree-rooted viper instance. The pattern is a behavioural Composite at the configuration layer, mirroring the file-system shape of `fs.FS`.

### 5.5 `gioui.org`

Gio's immediate-mode UI builds a tree of widgets per frame. Each `layout.Widget` is a function from a `layout.Context` to `layout.Dimensions`; layout primitives (`Flex`, `Stack`, `List`) compose child widgets into a tree that the framework walks during the layout pass. The Composite here is functional rather than structural: the tree exists as a call graph during the frame, not as a long-lived data structure.

---

## 6. Formal specification

A Go Composite consists of:

| Element | Description |
|---------|-------------|
| **Component** | The interface (or root struct type) that every node — leaf or composite — satisfies. Defines the operations the consumer can invoke uniformly. |
| **Leaf** | A node with no children; `Children()` returns `nil` or the empty slice. Implements all Component operations independently. |
| **Composite** | A node that holds child nodes and forwards or aggregates Component operations across them; provides `Add`, `Remove`, and `Children` accessors. |
| **Children collection** | The container holding child references — typically `[]Node` (interface slice), `[]*ConcreteNode` (typed slice), or a sibling linked list. |
| **Walk / Inspect** | The generic traversal helper that visits every node in some order (pre-order, post-order, BFS) and invokes a callback or a visitor. |
| **Visitor** | An optional interface or function type whose methods correspond to the operations being performed during traversal; decouples operations from node types. |
| **Parent pointer** | An optional back-reference from child to parent; required for upward traversal and sibling navigation; must be maintained on every mutation. |

**Invariants:**

1. **The Component interface is satisfied by every node type in the tree.** Leaf and composite are uniform from the consumer's standpoint; no operation requires a downcast unless it is fundamentally kind-specific.
2. **`Children()` returns only references the receiver owns or has been told to own.** No node appears as a child of two parents unless the tree is explicitly a DAG; cycles are excluded by construction or detected explicitly.
3. **Traversal is well-defined.** Either the tree is acyclic by invariant, or every walker carries a visited set keyed by node identity. There is no "trust the inputs" path that risks infinite recursion in production.
4. **Mutation during traversal is forbidden.** Adding or removing children while a `Walk` is in progress is a documented error; if mutation is needed, the consumer collects pending changes and applies them after the walk completes.
5. **Parent pointers — if present — are kept consistent on every Add and Remove.** A child whose `Parent()` does not match the composite holding it is a corrupt tree; helpers that mutate the tree are the only code allowed to touch parent fields directly.

Together these invariants reduce the Composite to a well-formed tree (or DAG) of uniformly-typed nodes with a predictable traversal contract.

**Lifecycle states:**

| State | Description | Transition |
|-------|-------------|------------|
| **Empty** | Root constructed; no children; `Children()` returns nil. | First `Add` moves to Populated. |
| **Populated** | Steady state; one or more children; walks visit every node. | Further mutations preserve invariants and keep the state Populated. |
| **Frozen** | Optional terminal state; mutations rejected; safe to share across goroutines without locking. | None; once frozen, the tree is read-only. Used in compiled-AST caches and parsed-template registries. |

Most Composites occupy only Empty and Populated; the Frozen state is application-level discipline.

---

## 7. Anti-patterns

### 7.1 Fat interface

A `Node` interface with twenty methods because *some* node type needs each. Every leaf has to implement methods that do not apply, returning sentinel zero values or panicking. The interface no longer documents the common contract; it documents the union of all kind-specific contracts. **Fix:** keep the base interface minimal (`Name()`, `Children()`); feature-detect with type assertions for kind-specific behaviour (`if r, ok := n.(Renamable); ok { r.Rename(...) }`).

### 7.2 Concrete `Children` type

`func (d *Folder) Children() []*Folder` defeats the polymorphism. Files cannot live in the slice; the consumer is forced to handle Folders specially and never see Files through the uniform interface. **Fix:** return `[]Node`, the interface slice; let the consumer's type switch (if any) discover concrete kinds.

### 7.3 Mutation during traversal

```go
Walk(root, func(n Node) {
    if shouldDelete(n) {
        n.Parent().Remove(n) // bug: modifies the children slice mid-iteration
    }
})
```

Range loops over slices snapshot the length and the backing array pointer at loop start; deleting an element while iterating skips the next element. Recursive walks compound the problem because the parent's slice changes while children are being visited. **Fix:** collect deletions during the walk, apply them after; or walk a snapshot of the children slice rather than the live one.

### 7.4 Cycle without detection

A tree where `Add` blindly appends without checking ancestry permits cycles. A subsequent `Walk` recurses forever; if `Size()` aggregates over children, the call stack overflows before any output is produced. The bug appears only when a specific mutation sequence creates the cycle, which makes it hard to reproduce. **Fix:** in any tree where cycles are physically possible, walkers carry a visited set; alternatively, `Add` rejects insertions that would create a cycle by walking up the proposed parent chain.

### 7.5 Parent pointer without invariants

```go
parent.children = append(parent.children, child)
// bug: forgot to set child.parent = parent
```

A child whose `Parent()` does not match its containing composite breaks any traversal that climbs up. The error mode is silent until something reads the parent pointer and gets a stale or nil value. **Fix:** wrap all parent-aware mutations behind helpers (`parent.AppendChild(child)`) that set both directions atomically; never let consumers mutate `children` or `parent` fields directly.

### 7.6 Allocating `Children()` return

```go
func (d *Folder) Children() []Node {
    out := make([]Node, len(d.children))
    copy(out, d.children)
    return out // bug: allocates per call on a hot path
}
```

Defensive copying is cheap per call but catastrophic when a tree of ten thousand nodes is walked. Each `Children()` call allocates and copies; the GC sees garbage proportional to the tree size on every traversal. **Fix:** return the underlying slice and document "callers must not mutate"; or expose a `Range(func(Node) bool)` that iterates without allocation.

### 7.7 Missing nil child check

```go
for _, c := range n.Children() {
    Walk(c, fn) // bug: c might be nil
}
```

A child slice containing a nil interface or a typed nil pointer crashes the recursive call. The case is unusual but appears when parsers emit placeholder slots ("error nodes") that callers forgot to skip. The interface-nil-vs-typed-nil distinction compounds the problem: a `var f *File` stored in `[]Node` is a non-nil interface wrapping a nil pointer, which passes `c != nil` and still crashes on the next method call. **Fix:** filter nil children at the walker (`if c == nil || reflect.ValueOf(c).IsNil() { continue }` for the paranoid case), or document that `Children()` never returns nil entries and enforce it at `Add` time.

---

## 8. Variants and dialects

| Variant | Description |
|---------|-------------|
| **Pure-interface** | One Component interface; many concrete node types; children stored as `[]Component`. Most idiomatic Go; canonical: `go/ast`. |
| **Tagged-struct** | One concrete struct with a `Kind` discriminator; children stored as `[]*Self`. Serialization-friendly; canonical: `yaml.v3.Node`. |
| **Visitor-based** | Nodes implement an `Accept(Visitor)` method or are walked by an external `Walk(Visitor, Node)`; operations live on Visitor types. Canonical: `go/ast.Walk`. |
| **Behavioural** | Tree is implicit; access is via traversal verbs (`Open`, `ReadDir`) rather than structural accessors. Canonical: `io/fs.FS`. |
| **Parent-linked** | Doubly-linked nodes with parent and sibling pointers; no children slice. Constant-time parent and sibling access; mutation invariants are delicate. Canonical: `x/net/html.Node`. |
| **Persistent / immutable** | Each mutation returns a new tree sharing unchanged subtrees with the old one; readers see a stable snapshot. Used in functional configuration languages and incremental compilers. |
| **Generic typed `Tree[T]`** | Homogeneous tree with a type parameter for the payload; right for B-trees, segment trees, and algorithmic uses; wrong for heterogeneous DOM/AST trees. |

---

## 9. Naming conventions

- **`Node` / `Element` / `Component`** — names for the Component interface. `Node` is most common in Go (`ast.Node`, `html.Node`, `yaml.Node`, `parse.Node`); `Element` appears in DOM-flavoured packages; `Component` is rare in Go but common in GoF translations.
- **`Children()` / `Children` field** — the child accessor. Method form (`Children() []Node`) is idiomatic for interface-based Composites; field form (`Children []*Node`) is idiomatic for tagged-struct Composites. The names are stable; the typing differs.
- **`Walk` / `WalkDir` / `Walker`** — the generic traversal. `filepath.Walk`, `fs.WalkDir`, `ast.Walk`, and `cobra.Command.VisitParents` all use the verb. `Walk` walks the whole tree; `Walker` is the visitor type passed in.
- **`Visit` / `VisitFunc`** — the visitor's callback. `ast.Visitor.Visit(n) Visitor`; the returned visitor controls descent. Function-typed variants are `VisitFunc func(Node) bool` where the bool says "descend".
- **`Inspect`** — closure-driven visitor. `ast.Inspect(root, func(ast.Node) bool)` is the reference; closure replaces an interface, return bool controls descent. Slightly more common than `Walk` in modern Go because it avoids the interface ceremony.
- **`Add(child)` / `AppendChild(child)`** — the mutation entry point on the Composite. `Add` is GoF-style; `AppendChild` is DOM-style. Either is fine; consistency within a package matters more than the choice.
- **`Remove(child)` / `RemoveChild(child)`** — the corresponding removal entry point. Returns the removed child or an error if not found; never removes silently if the child is not present.
- **`Parent()` / `Parent` field** — the upward link; method form on interface Composites, field form on tagged-struct Composites. Optional; include only when upward navigation is required.

---

## 10. Related patterns

| Pattern | Distinction |
|---------|-------------|
| **Decorator** | Wraps a single object to add behaviour; the wrapper satisfies the same interface as the wrapped. Looks tree-like but the "children" are always one element. Composite groups; Decorator wraps. The shapes resemble each other; the semantics differ. |
| **Visitor** | Separates an operation from the node types it operates on. Pairs naturally with Composite: a Visitor defines the operation, the Composite tree is the input. `go/ast.Walk` is Composite + Visitor; the two patterns coexist in nearly every analysis tool. |
| **Iterator** | Produces a flat sequence of elements; `Walk` is Composite's Iterator. The Iterator pattern abstracts the traversal mechanism so the consumer's loop does not depend on the container's shape; Composite is the most common container that needs Iterator. |
| **Chain of Responsibility** | A list of handlers tried in order until one accepts; if the Composite stores a list of handlers and dispatches by trying each, it becomes Chain of Responsibility. Middleware stacks sit on this boundary. |
| **Builder** | Constructs a Composite tree step by step; `cobra.Command{}.AddCommand(...).AddCommand(...)` is a fluent Builder for the command tree. The Builder hides the tree-construction sequence behind an API that produces a finished tree. |

---

## 11. Further reading

- **Gamma, Helm, Johnson, Vlissides, *Design Patterns: Elements of Reusable Object-Oriented Software* (Addison-Wesley, 1994)** — the source of the Composite pattern name and its formal description; the file-system and graphics examples remain the standard introduction.
- **Go standard library: `go/ast` package documentation** — the reference Go Composite. The interface is two methods; the node taxonomy is seventy types; the traversal helpers are `Walk` and `Inspect`. Required reading before designing any Go tree of comparable scope.
- **`ast.Inspect` blog post (golang.org/blog, "Generating code")** — the closure-driven visitor explained in the context of code generation; the cleanest articulation of why `Inspect` exists alongside `Walk`.
- **W3C DOM Level 1 Specification (1998)** — the foundational tree-of-nodes API that every subsequent DOM library imitates; the parent-and-sibling pointer shape used by `x/net/html` traces directly to this document.
- **`golang.org/x/net/html` source** — production-grade tagged-struct Composite with parent and sibling pointers; the implementation of `Parse`, `Render`, and the tokenizer is the canonical example of a DOM-style Composite in Go.
- **`spf13/cobra` source: `command.go`** — production-grade CLI command tree; demonstrates Composite plus Registry plus Builder in one package.
- **`gopkg.in/yaml.v3` source: `yaml.go`** — production-grade tagged-struct Composite for parser output; the `Kind` discriminator and `Content []*Node` shape are the reference for round-trip-safe configuration trees.
- **Eric Lippert, "Wizards and warriors" series (2015)** — although a C# discussion, the analysis of when class hierarchies (and by extension Composite kind-trees) drift into incoherence applies directly to Go interface-based Composites and explains why fat-interface anti-patterns recur.

**Observability and Composites.**

A Composite is invisible to production debugging unless instrumented. The minimum useful telemetry:

- A `Size()` or `NodeCount()` helper that reports tree size at any point; cheap to expose, invaluable for sizing decisions.
- A `String()` on the root that produces a deterministic, indented rendering for log output; essential for diffing trees across versions.
- A `Walk` variant that records a counter per node kind so that a single pass produces a histogram (`map[string]int{"File": 1024, "Folder": 47}`) without rewriting the traversal.
- A guard around mutating helpers that detects cycle introduction (walk the proposed parent chain) and refuses with an explicit error rather than producing an unwalkable tree.

Without these, a malformed Composite surfaces only as a stack overflow during traversal, a missed leaf in an analysis pass, or a corrupt rendering — far from the mutation that introduced the bug.

**On choosing the right shape.** Reach for the pure-interface Composite when the tree has many heterogeneous kinds and consumers need strong static typing for kind-specific operations. Reach for the tagged-struct form when the tree round-trips through serialization and the kind set is small and stable. Reach for the visitor-based form when many independent operations traverse the same tree and node types should not be modified for each. Reach for the behavioural form when the tree might be virtual, remote, or constructed on demand and per-node iteration is less useful than path navigation. Reach for the parent-linked form when mutation is frequent and parent or sibling navigation dominates over downward walks.

The senior calculus for any Composite-shaped problem in Go:

1. Is the tree homogeneous (one payload type)? Use `Tree[T]` with generics.
2. Are nodes heterogeneous and the operation set small? Use pure-interface with `Children()` and a `Walk` helper.
3. Will the tree be serialised or pretty-printed for human editing? Use the tagged-struct form.
4. Are there many independent operations to add over time? Use Composite + Visitor with closure-based `Inspect` for one-shots and interface-based `Walk` for multi-pass tools.
5. Is the tree implicit or virtual? Use the behavioural form (`fs.FS`-style verb interface) rather than exposing the structure.
6. Is mutation frequent and upward navigation common? Use parent-linked doubly-linked nodes and pay the invariant-maintenance cost.

A practical follow-up: most production Composites end up paired with at least two helpers. The first is a `Walk` or `Inspect` that fixes the traversal order so consumers do not reinvent it. The second is a `String` or `Render` that produces a deterministic text rendering, which doubles as a diff target in tests and a log artefact in production. Trees without these two helpers tend to grow ad-hoc traversals in every consumer, and the shape of the Composite quietly drifts as each consumer adds the helper it needed locally.

Composite in Go is recursive interfaces. Senior skill is choosing the shape — pure interface, tagged struct, visitor — that matches how the tree will be used.

---

## 12. Glossary

| Term | Meaning |
|------|---------|
| **Component** | The interface (or root struct type) that every node in a Composite tree satisfies; defines the uniform operations leaf and composite both expose. |
| **Leaf** | A node with no children; the terminal element of the tree; satisfies Component but its `Children()` returns nil or the empty slice. |
| **Composite** | A node that contains child nodes; provides `Add`, `Remove`, and `Children` operations and aggregates Component behaviour across its children. |
| **Children** | The collection of direct child nodes held by a Composite; typically `[]Component` for interface-based trees, `[]*Self` for tagged-struct trees. |
| **Walk** | The generic depth-first traversal helper; visits every node in pre-order, post-order, or BFS and invokes a callback or visitor at each. |
| **Visitor** | A pattern partner of Composite: a type whose methods correspond to the operations performed during traversal; decouples operations from node types. |
| **Inspector** | The closure-driven Visitor variant (`ast.Inspect`-style); a function that takes a node and returns a bool controlling descent; replaces an interface with a single callback. |
| **DOM** | Document Object Model; the W3C tree-of-nodes API for HTML and XML documents; the canonical structural Composite in browsers and parser libraries. |
| **AST** | Abstract Syntax Tree; the parsed representation of source code as a tree of typed nodes; `go/ast` is the Go standard-library AST and the reference Composite in the language. |
| **Cycle** | A path in the tree that revisits an ancestor; transforms the tree into a graph; breaks any naive recursive walker; must be excluded by invariant or detected by a visited set. |
| **Pre-order / Post-order** | Pre-order visits a node before its children; post-order visits children first. The choice affects which subtree information is available at the callback; structural rewriters typically need post-order so child results are ready before the parent is processed. |
| **DAG** | Directed acyclic graph; a Composite where a node may be shared by multiple parents but no cycle exists. Walking a DAG with a naive recursive walker double-visits shared subtrees; the fix is a visited set keyed by node identity, the same machinery used for cycle defence. |
