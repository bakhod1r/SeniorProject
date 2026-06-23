# Composite — Practice Tasks

Fifteen exercises from a four-line filesystem tree to a mini interpreter for a lambda DSL. Along the way: visitor split, AST evaluation, tagged-struct nodes, generic `Tree[T]`, cycle-safe traversal, concurrent walks under `errgroup`, JSON round-trips, command-tree CLIs, DOM with parent pointers, and structural diff. Difficulty: **B**eginner, **I**ntermediate, **A**dvanced, **S**enior.

Each task gives a Goal, Starter, Hints, and folded Reference solution. Read middle.md first — the choice between pure-interface, tagged-struct, and visitor-based form is the meta-decision every task either commits to or revisits.

---

## Task 1 — Filesystem tree: File + Folder (B)

**Goal.** Smallest pure-interface Composite. `Node` with `Name()`, `Size()`, `Children()`. `File` leaf, `Folder` composite. Recursive size, debug print.

**Starter.**

```go
type Node interface {
    Name() string
    Size() int64
    Children() []Node
}
type File struct { /* TODO */ }
type Folder struct { /* TODO */ }
```

**Hints.**
- Pointer receivers — `Folder` must mutate without copying.
- `File.Children()` returns `nil`. Leaves still implement the full interface.
- `Folder.Size()` recurses through `Children()` (the interface), not the concrete slice, so alternate composites slot in.

<details><summary>Reference solution</summary>

```go
package fs

import (
    "fmt"
    "strings"
)

// Senior decision: minimal Node interface. Anything more (Parent, Path,
// ModTime) belongs to specific node types and gets feature-detected
// with a type assertion. Bloating Node forces leaves to implement
// methods they don't need.
type Node interface {
    Name() string
    Size() int64
    Children() []Node
}

type File struct {
    name string
    size int64
}

func NewFile(name string, size int64) *File { return &File{name, size} }
func (f *File) Name() string                { return f.name }
func (f *File) Size() int64                 { return f.size }
func (f *File) Children() []Node            { return nil }

type Folder struct {
    name     string
    children []Node
}

func NewFolder(name string) *Folder { return &Folder{name: name} }
func (d *Folder) Name() string      { return d.name }
func (d *Folder) Children() []Node  { return d.children }

// Senior decision: Size recurses through Children() (the interface),
// not d.children (the concrete slice). A future SymlinkFolder slots
// in without changing this method.
func (d *Folder) Size() int64 {
    var total int64
    for _, c := range d.Children() {
        total += c.Size()
    }
    return total
}

func (d *Folder) Add(n Node) { d.children = append(d.children, n) }

func Print(n Node) string {
    var b strings.Builder
    var walk func(Node, int)
    walk = func(n Node, depth int) {
        fmt.Fprintf(&b, "%s%s (%d)\n", strings.Repeat("  ", depth), n.Name(), n.Size())
        for _, c := range n.Children() {
            walk(c, depth+1)
        }
    }
    walk(n, 0)
    return b.String()
}
```

The trap is `Children() []*Folder` — that defeats polymorphism. The interface-typed slice is the whole point.

</details>

---

## Task 2 — Recursive Size() with caching (B)

**Goal.** Same tree, `Folder.Size()` O(1) on repeated calls. Invalidate on `Add`/`Remove`.

**Starter.**

```go
type Folder struct {
    name       string
    children   []Node
    cachedSize int64
    sizeValid  bool
}
func (d *Folder) Size() int64        { /* TODO */ }
func (d *Folder) Remove(n Node) bool { /* TODO */ }
```

**Hints.**
- Start invalid. First `Size()` computes and stores.
- `Add`/`Remove` invalidate this folder only; ancestors are still stale because folders don't know parents. Defer the parent-pointer fix to Task 13; document the gap now.

<details><summary>Reference solution</summary>

```go
type Folder struct {
    name     string
    children []Node
    // Senior decision: cache only the LOCAL recursive sum. A child
    // added deep down invalidates only this folder; ancestors return
    // stale until Invalidate is called explicitly. The full fix needs
    // parent pointers (Task 13). Document the limitation; do not bolt
    // on a half-correct invalidation chain.
    cachedSize int64
    sizeValid  bool
}

func (d *Folder) Size() int64 {
    if d.sizeValid {
        return d.cachedSize
    }
    var total int64
    for _, c := range d.Children() {
        total += c.Size()
    }
    d.cachedSize = total
    d.sizeValid = true
    return total
}

func (d *Folder) Add(n Node) {
    d.children = append(d.children, n)
    d.sizeValid = false
}

func (d *Folder) Remove(n Node) bool {
    for i, c := range d.children {
        if c == n {
            d.children = append(d.children[:i], d.children[i+1:]...)
            d.sizeValid = false
            return true
        }
    }
    return false
}

// Senior decision: Invalidate is exported so callers who DID wire up
// parent pointers can bubble invalidation themselves.
func (d *Folder) Invalidate() { d.sizeValid = false }
```

"Is the cache thread-safe?" — no, and don't bolt on a mutex before you've decided whether the tree is mutated concurrently. Most trees are built once and read many times, in which case the immutable initial computation IS the cache. Premature thread-safety is the more frequent sin.

</details>

---

## Task 3 — Walk(node, fn) traversal (B)

**Goal.** One `Walk` for DFS pre-order. Implement `Count`, `TotalSize`, `FindByName` on top of it. No new methods on nodes.

**Starter.**

```go
func Walk(n Node, fn func(Node))           { /* TODO */ }
func Count(n Node) int                     { /* TODO */ }
func TotalSize(n Node) int64               { /* TODO */ }
func FindByName(n Node, name string) Node  { /* TODO */ }
```

**Hints.**
- Walk is five lines.
- Closure-based walk can't break out early. Either change the shape (Task 5) or capture the result and let the rest of the walk no-op.

<details><summary>Reference solution</summary>

```go
// Senior decision: DFS pre-order matches go/ast.Inspect and
// filepath.Walk. If you need post-order, expose a second function —
// overloading one with a flag bloats the API and surprises readers.
func Walk(n Node, fn func(Node)) {
    fn(n)
    for _, c := range n.Children() {
        Walk(c, fn)
    }
}

func Count(n Node) int {
    var c int
    Walk(n, func(Node) { c++ })
    return c
}

// Senior decision: TotalSize sums LEAVES only. Summing folders too
// would double-count. The type switch is the canonical "consumer
// downcasts at the leaf" idiom.
func TotalSize(n Node) int64 {
    var total int64
    Walk(n, func(x Node) {
        if f, ok := x.(*File); ok {
            total += f.Size()
        }
    })
    return total
}

func FindByName(root Node, name string) Node {
    var found Node
    Walk(root, func(n Node) {
        if found == nil && n.Name() == name {
            found = n
        }
    })
    return found
}
```

The visitor form (next task) gives proper early exit. For now the set-and-skip closure is honest about its limitation.

</details>

---

## Task 4 — Filter(node, pred) returning matches (B)

**Goal.** `Filter(n, pred) []Node` on top of Walk. Use it for `.go` files, empty folders, folders with >5 children.

**Starter.**

```go
func Filter(n Node, pred func(Node) bool) []Node { /* TODO */ }
```

**Hints.**
- One closure on Walk.
- Return `nil` for no matches; same semantics as `[]Node{}` under range/len.

<details><summary>Reference solution</summary>

```go
func Filter(n Node, pred func(Node) bool) []Node {
    var out []Node
    Walk(n, func(x Node) {
        if pred(x) {
            out = append(out, x)
        }
    })
    return out
}

// Senior decision: don't write FilterByExt — once Filter exists, the
// caller composes predicates. Keeping the kernel small is half the
// point of building Walk and Filter as separate combinators.

func IsFile(n Node) bool   { _, ok := n.(*File); return ok }
func IsFolder(n Node) bool { _, ok := n.(*Folder); return ok }

func HasExt(ext string) func(Node) bool {
    return func(n Node) bool { return IsFile(n) && strings.HasSuffix(n.Name(), ext) }
}
func IsEmptyFolder(n Node) bool {
    f, ok := n.(*Folder)
    return ok && len(f.Children()) == 0
}
func MoreThan(k int) func(Node) bool {
    return func(n Node) bool { return len(n.Children()) > k }
}
func And(ps ...func(Node) bool) func(Node) bool {
    return func(n Node) bool {
        for _, p := range ps {
            if !p(n) {
                return false
            }
        }
        return true
    }
}

// goFiles  := Filter(root, HasExt(".go"))
// bigDirs  := Filter(root, And(IsFolder, MoreThan(5)))
```

Once Walk exists, every "find all X" function compiles down to one closure. That's the structural win of pure-interface Composite: traversal is a library, not a method on every node.

</details>

---

## Task 5 — Visitor interface with Accept (I)

**Goal.** Replace closure traversal with `Visitor.Visit(n) (descend bool)` and an `Accept` kernel. Two visitors: `CountVisitor`, `SkipNoise` (skip `vendor`, `.git`, `node_modules`).

**Starter.**

```go
type Visitor interface { Visit(n Node) (descend bool) }
func Accept(n Node, v Visitor) { /* TODO */ }
```

**Hints.**
- `Visit` returns false → kernel does not recurse into children.
- `go/ast.Walk` returns a `Visitor` (or nil); pick the simpler `bool` version.

<details><summary>Reference solution</summary>

```go
type Visitor interface {
    Visit(n Node) (descend bool)
}

// Senior decision: Visit returns descend bool. That's the smallest
// extension over closure-Walk that lets the visitor prune subtrees —
// the single most important capability for analysis tools.
func Accept(n Node, v Visitor) {
    if !v.Visit(n) {
        return
    }
    for _, c := range n.Children() {
        Accept(c, v)
    }
}

type CountVisitor struct{ Count int }

func (v *CountVisitor) Visit(n Node) bool {
    v.Count++
    return true
}

// Senior decision: skipping subtrees is the day-one win of visitor
// over closure. A linter that wants to ignore vendor/.git/node_modules
// returns false on those folders and never pays for the subtree walk.
type SkipNoise struct{ Found []Node }

func (v *SkipNoise) Visit(n Node) bool {
    name := n.Name()
    if name == "vendor" || name == ".git" || name == "node_modules" {
        return false
    }
    if _, ok := n.(*File); ok {
        v.Found = append(v.Found, n)
    }
    return true
}
```

Biggest payoff: many operations on the same tree shape, each its own struct with its own accumulator. Closures get messy past two or three concurrent accumulators.

</details>

---

## Task 6 — AST evaluator for arithmetic (I)

**Goal.** Composite AST for integer arithmetic (`Num`, `Add`, `Mul`, `Neg`). `Eval(Expr) int` via type switch. Then add `Sub` and `Div` without changing the signature.

**Starter.**

```go
type Expr interface{ isExpr() } // sealed
type Num struct{ V int }
type Add struct{ L, R Expr }
type Mul struct{ L, R Expr }
type Neg struct{ X Expr }
func Eval(e Expr) int { /* TODO */ }
```

**Hints.**
- Sealed interface via unexported `isExpr()` — keeps the type switch exhaustive.
- Each case recurses on subexpressions.

<details><summary>Reference solution</summary>

```go
// Senior decision: sealed interface via unexported method. External
// packages can hold Expr values but cannot fabricate new variants.
// That keeps Eval's type switch exhaustive — no "default" case
// panicking on user-defined types. Cost: AST closed to user
// extension. For a DSL evaluator, right trade.
type Expr interface{ isExpr() }

type Num struct{ V int }
type Add struct{ L, R Expr }
type Sub struct{ L, R Expr }
type Mul struct{ L, R Expr }
type Div struct{ L, R Expr }
type Neg struct{ X Expr }

func (Num) isExpr() {}
func (Add) isExpr() {}
func (Sub) isExpr() {}
func (Mul) isExpr() {}
func (Div) isExpr() {}
func (Neg) isExpr() {}

func Eval(e Expr) int {
    switch x := e.(type) {
    case Num: return x.V
    case Add: return Eval(x.L) + Eval(x.R)
    case Sub: return Eval(x.L) - Eval(x.R)
    case Mul: return Eval(x.L) * Eval(x.R)
    case Div: return Eval(x.L) / Eval(x.R)
    case Neg: return -Eval(x.X)
    default:  panic(fmt.Sprintf("arith: unknown Expr %T", e))
    }
}

// Senior decision: Print is a second visitor over the same tree.
// Adding "optimize" or "typecheck" is another. The day you add a
// new operation, write one function. The day you add a new node,
// touch every operation. Open-closed only one way at a time.
func Print(e Expr) string {
    switch x := e.(type) {
    case Num: return fmt.Sprintf("%d", x.V)
    case Add: return "(" + Print(x.L) + " + " + Print(x.R) + ")"
    case Sub: return "(" + Print(x.L) + " - " + Print(x.R) + ")"
    case Mul: return "(" + Print(x.L) + " * " + Print(x.R) + ")"
    case Div: return "(" + Print(x.L) + " / " + Print(x.R) + ")"
    case Neg: return "-" + Print(x.X)
    }
    return "?"
}
```

Canonical "Composite stores syntax, visitor carries semantics" split. Eval, Print, optimiser, type checker — separate functions, same `Expr`.

</details>

---

## Task 7 — Tagged-struct yaml-like Node (I)

**Goal.** One struct with `Kind`, `Value`, `Children`. Constructors per kind. Round-trip JSON marshal/unmarshal trivially — compare with Task 11 to feel the difference.

**Starter.**

```go
type Kind int
const ( KindScalar Kind = iota; KindMapping; KindSequence )
type Node struct {
    Kind     Kind
    Value    string
    Children []*Node
}
```

**Hints.**
- Operations switch on `Kind`. No compiler help for exhaustiveness — write tests.
- Mapping uses pairs in `Children` (key, value, key, value), as `yaml.v3` does.

<details><summary>Reference solution</summary>

```go
type Kind int

const (
    KindScalar Kind = iota
    KindMapping
    KindSequence
)

// Senior decision: one struct, Kind discriminator. Mapping uses
// Children in pairs (key, value, ...) the way yaml.v3 does — the
// alternative (separate KeyChildren/ValChildren slices) fragments
// the shape, which matters when you marshal.
type Node struct {
    Kind     Kind    `json:"kind"`
    Value    string  `json:"value,omitempty"`
    Children []*Node `json:"children,omitempty"`
}

// Senior decision: constructors per Kind. The zero Node compiles as
// KindScalar with empty Value — that's silently produced bugs in the
// yaml code this is modelled after. Constructors make intent visible.
func Scalar(v string) *Node     { return &Node{Kind: KindScalar, Value: v} }
func Sequence(items ...*Node) *Node { return &Node{Kind: KindSequence, Children: items} }
func Mapping(kvs ...*Node) *Node {
    if len(kvs)%2 != 0 {
        panic("ynode: Mapping needs key,value pairs")
    }
    return &Node{Kind: KindMapping, Children: kvs}
}

// JSON works out of the box — flat struct, no interfaces. THE thing
// pure-interface Composite makes hard (compare with Task 11).
//
//   root := Mapping(Scalar("name"), Scalar("alice"),
//                   Scalar("tags"), Sequence(Scalar("dev"), Scalar("go")))
//   b, _ := json.Marshal(root)
//   var back Node; _ = json.Unmarshal(b, &back)
```

Trade: serialization went from "custom marshaler" to free. Behaviour went from method dispatch to `switch Kind` with no compile-time exhaustiveness check. Tagged-struct is right for data, wrong for behaviour.

</details>

---

## Task 8 — Generic Tree[T] (Go 1.18+) (I)

**Goal.** One `Tree[T any]` covering trees of strings, ints, anything. Walk, Map, Fold.

**Starter.**

```go
type Tree[T any] struct {
    Value    T
    Children []*Tree[T]
}
func Walk[T any](t *Tree[T], fn func(*Tree[T]))             { /* TODO */ }
func Map[T, U any](t *Tree[T], fn func(T) U) *Tree[U]       { /* TODO */ }
func Fold[T, U any](t *Tree[T], init U, fn func(U, T) U) U  { /* TODO */ }
```

**Hints.**
- Methods on the receiver if they don't need T's structure. Top-level functions when they do — Go disallows type parameters on methods.
- `Map` allocates new nodes. Don't mutate the input.

<details><summary>Reference solution</summary>

```go
// Senior decision: Tree[T] over any. Methods that DON'T touch T's
// structure stay on the receiver (Add). Methods that DO (Map, Fold)
// become top-level functions because Go still disallows type
// parameters on methods.
type Tree[T any] struct {
    Value    T
    Children []*Tree[T]
}

func New[T any](v T) *Tree[T]   { return &Tree[T]{Value: v} }
func (t *Tree[T]) Add(v T) *Tree[T] {
    c := New(v)
    t.Children = append(t.Children, c)
    return c
}
func (t *Tree[T]) AddTree(c *Tree[T]) *Tree[T] {
    t.Children = append(t.Children, c)
    return c
}

func Walk[T any](t *Tree[T], fn func(*Tree[T])) {
    if t == nil { return }
    fn(t)
    for _, c := range t.Children {
        Walk(c, fn)
    }
}

// Senior decision: Map allocates — never mutates input. Matches
// slices/maps conventions. In-place is faster but invites aliasing
// bugs.
func Map[T, U any](t *Tree[T], fn func(T) U) *Tree[U] {
    if t == nil { return nil }
    out := New(fn(t.Value))
    for _, c := range t.Children {
        out.AddTree(Map(c, fn))
    }
    return out
}

func Fold[T, U any](t *Tree[T], init U, fn func(U, T) U) U {
    if t == nil { return init }
    acc := fn(init, t.Value)
    for _, c := range t.Children {
        acc = Fold(c, acc, fn)
    }
    return acc
}

func Count[T any](t *Tree[T]) int {
    return Fold(t, 0, func(n int, _ T) int { return n + 1 })
}
```

Cost: constraints are limited. You can't write `if v == nil` for `T any`. The pattern stays useful; you give up some runtime validation.

</details>

---

## Task 9 — Cycle-safe Walk with visited set (I)

**Goal.** Naïve Walk infinite-loops on a cycle. Add a visited-set version. Test on a folder added to itself.

**Starter.**

```go
func WalkSafe(n Node, fn func(Node)) { /* TODO */ }
```

**Hints.**
- `map[Node]bool` works because interface values compare by (type, pointer).
- Early-return on `seen[n]`.

<details><summary>Reference solution</summary>

```go
// Senior decision: cycle-safe by default? No. The unsafe Walk is 5
// lines and adequate for genuinely tree-shaped data. Charging every
// caller a map allocation for a footgun they don't have is wrong.
// Expose both; document when each is right.
func WalkSafe(n Node, fn func(Node)) {
    seen := map[Node]bool{}
    var walk func(Node)
    walk = func(n Node) {
        if n == nil || seen[n] {
            return
        }
        seen[n] = true
        fn(n)
        for _, c := range n.Children() {
            walk(c)
        }
    }
    walk(n)
}

// Senior decision: a path-set distinguishes back-edge (real cycle)
// from shared subtree (DAG). WalkSafe alone treats shared subtrees
// as cycles and prunes them — fine for traversal, wrong for analysis.
func DetectCycle(n Node) []Node {
    var cycle []Node
    seen := map[Node]bool{}
    var walk func(Node, map[Node]bool) bool
    walk = func(n Node, path map[Node]bool) bool {
        if path[n] {
            cycle = append(cycle, n)
            return true
        }
        if seen[n] {
            return false
        }
        seen[n] = true
        path[n] = true
        defer delete(path, n)
        for _, c := range n.Children() {
            if walk(c, path) {
                return true
            }
        }
        return false
    }
    walk(n, map[Node]bool{})
    return cycle
}
```

If `Node` were a struct (tagged-struct form), you'd need `map[*Node]bool` because struct comparison would copy values. Be explicit about which model you're in.

</details>

---

## Task 10 — Concurrent Walk with errgroup (A)

**Goal.** `Node.Size()` is slow (network FS). Walk in parallel with `errgroup.Group`. Bound concurrency. Cancel everything on first error.

**Starter.**

```go
func WalkParallel(ctx context.Context, n Node, fn func(context.Context, Node) error, parallelism int) error { /* TODO */ }
```

**Hints.**
- `g.SetLimit(parallelism)` bounds workers.
- `errgroup.WithContext` cancels on first error — don't re-implement.
- Per-node vs per-subtree dispatch: senior decision below.

<details><summary>Reference solution</summary>

```go
// Senior decision: errgroup over hand-rolled WaitGroup + error chan.
// errgroup gives cancel-on-first-error and concurrency limit for free.
// The home-grown equivalent is ~30 lines and gets the race against
// ctx cancel wrong on the first try.
func WalkParallel(
    ctx context.Context, root Node,
    fn func(context.Context, Node) error, parallelism int,
) error {
    g, gctx := errgroup.WithContext(ctx)
    if parallelism > 0 {
        g.SetLimit(parallelism)
    }
    var walk func(Node)
    walk = func(n Node) {
        n := n
        // Senior decision: per-node dispatch. Per-subtree is identical
        // for shallow-wide trees, MUCH worse for deep-narrow because
        // recursion serialises. Per-node is the right default.
        g.Go(func() error {
            if err := gctx.Err(); err != nil {
                return err
            }
            if err := fn(gctx, n); err != nil {
                return err
            }
            for _, c := range n.Children() {
                walk(c)
            }
            return nil
        })
    }
    walk(root)
    return g.Wait()
}

// Concurrent fn must be safe — that's the caller's job:
//   var total atomic.Int64
//   WalkParallel(ctx, root, func(_ context.Context, n Node) error {
//       if f, ok := n.(*File); ok { total.Add(f.Size()) }
//       return nil
//   }, 16)
```

Picking parallelism. Wide-shallow tree of network resources: 64+. Deep CPU-bound AST: `runtime.NumCPU()`. Tree where each node holds a slow lock: 1 (Go's just structuring the cancellation for you).

</details>

---

## Task 11 — JSON marshal/unmarshal a Composite tree (A)

**Goal.** Pure-interface Composite round-trips through JSON. `Unmarshal` doesn't know each child's concrete type — add a `type` discriminator field and a registry of factories.

**Starter.**

```go
type Node interface {
    Type() string
    Children() []Node
}
func Marshal(n Node) ([]byte, error)      { /* TODO */ }
func Unmarshal(data []byte) (Node, error) { /* TODO */ }
```

**Hints.**
- Envelope: `{type, payload}`. Peek `type` first, dispatch to factory.
- Children come back as `[]json.RawMessage`; unmarshal each recursively.

<details><summary>Reference solution</summary>

```go
type Node interface { Type() string; Children() []Node }
type File   struct{ Name string; Size int64 }
type Folder struct{ Name string; Kids []Node }

func (f *File) Type() string     { return "file" }
func (f *File) Children() []Node { return nil }
func (d *Folder) Type() string     { return "folder" }
func (d *Folder) Children() []Node { return d.Kids }

// Senior decision: package-level registry — concrete types known at
// compile time. Plugin discovery would put it on a *Registry.
var factories = map[string]func() Node{
    "file":   func() Node { return &File{} },
    "folder": func() Node { return &Folder{} },
}

// Senior decision: discriminator + payload as SEPARATE fields.
// Embedding works until a payload has its own "type" field.
type envelope struct {
    Type    string          `json:"type"`
    Payload json.RawMessage `json:"payload"`
}

func Marshal(n Node) ([]byte, error) {
    var payload []byte
    var err error
    switch x := n.(type) {
    case *File:
        payload, err = json.Marshal(x)
    case *Folder:
        kids := make([]json.RawMessage, 0, len(x.Kids))
        for _, c := range x.Kids {
            b, err := Marshal(c)
            if err != nil { return nil, err }
            kids = append(kids, b)
        }
        payload, err = json.Marshal(struct {
            Name string            `json:"Name"`
            Kids []json.RawMessage `json:"Kids"`
        }{x.Name, kids})
    default:
        return nil, fmt.Errorf("cannot marshal %T", n)
    }
    if err != nil { return nil, err }
    return json.Marshal(envelope{n.Type(), payload})
}

func Unmarshal(data []byte) (Node, error) {
    var env envelope
    if err := json.Unmarshal(data, &env); err != nil { return nil, err }
    factory, ok := factories[env.Type]
    if !ok { return nil, fmt.Errorf("unknown type %q", env.Type) }
    node := factory()
    switch x := node.(type) {
    case *File:
        if err := json.Unmarshal(env.Payload, x); err != nil { return nil, err }
    case *Folder:
        var w struct {
            Name string
            Kids []json.RawMessage
        }
        if err := json.Unmarshal(env.Payload, &w); err != nil { return nil, err }
        x.Name = w.Name
        for _, raw := range w.Kids {
            child, err := Unmarshal(raw)
            if err != nil { return nil, err }
            x.Kids = append(x.Kids, child)
        }
    }
    return node, nil
}
```

This is why tagged-struct exists. The JSON wire format is monomorphic; concrete-type knowledge has to come from *somewhere*. Same plumbing as encoding/gob's tagged types, CBOR type tags, ProtoBuf `oneof`.

</details>

---

## Task 12 — Mini cobra-like CLI command tree (A)

**Goal.** Tree of `Command{Name, Use, Run, Subcommands}`. `Execute(args)` walks to the matching command and calls Run with remaining args. Help printed for non-leaf with no Run.

**Starter.**

```go
type Command struct {
    Name        string
    Use         string
    Run         func(args []string) error
    Subcommands []*Command
}
func (c *Command) Execute(args []string) error { /* TODO */ }
```

**Hints.**
- Execute peels args left-to-right matching Subcommand names. Stop when no further match.
- No flag parser — pass remaining args to Run untouched.

<details><summary>Reference solution</summary>

```go
// Senior decision: Command is one struct, no interface. Pure-interface
// is overdesigned for a CLI — every command is data plus a Run
// closure. Tagged-struct also wrong because there's only one Kind.
// "One struct, no interface" is what cobra.Command is.
type Command struct {
    Name        string
    Use         string
    Run         func(args []string) error
    Subcommands []*Command
    parent      *Command
}

func (c *Command) Add(sub *Command) {
    sub.parent = c
    c.Subcommands = append(c.Subcommands, sub)
}

func (c *Command) findSub(name string) *Command {
    for _, s := range c.Subcommands {
        if s.Name == name { return s }
    }
    return nil
}

// Senior decision: Execute is iterative, not recursive. The arg list
// is a flat stream; matching one subcommand at a time and looping is
// clearer than threading state through recursion. Recursion navigates
// STRUCTURE; iteration consumes STREAM.
func (c *Command) Execute(args []string) error {
    cmd, rest := c, args
    for len(rest) > 0 {
        if rest[0] == "-h" || rest[0] == "--help" || rest[0] == "help" {
            fmt.Print(cmd.Help())
            return nil
        }
        sub := cmd.findSub(rest[0])
        if sub == nil { break }
        cmd = sub
        rest = rest[1:]
    }
    if cmd.Run == nil {
        fmt.Print(cmd.Help())
        if cmd == c && len(args) > 0 {
            return fmt.Errorf("unknown command: %s", args[0])
        }
        return nil
    }
    return cmd.Run(rest)
}

func (c *Command) Help() string {
    var b strings.Builder
    fmt.Fprintf(&b, "%s — %s\n\n", c.fullPath(), c.Use)
    if len(c.Subcommands) > 0 {
        fmt.Fprintln(&b, "Subcommands:")
        subs := append([]*Command(nil), c.Subcommands...)
        sort.Slice(subs, func(i, j int) bool { return subs[i].Name < subs[j].Name })
        max := 0
        for _, s := range subs {
            if len(s.Name) > max { max = len(s.Name) }
        }
        for _, s := range subs {
            fmt.Fprintf(&b, "  %-*s  %s\n", max, s.Name, s.Use)
        }
    }
    return b.String()
}

func (c *Command) fullPath() string {
    if c.parent == nil { return c.Name }
    return c.parent.fullPath() + " " + c.Name
}
```

Cobra adds flag parsing, completions, generated docs, hooks. The Composite part is the skeleton above. Every CLI framework uses this shape; the rest is decoration.

</details>

---

## Task 13 — HTML/XML-like DOM with parent pointers (A)

**Goal.** DOM node with `Tag`, `Attrs`, `Text`, `Children`, `Parent`. Methods: `Append`, `Detach`, `Closest(tag)`, `Path()`. Maintain parent invariants.

**Starter.**

```go
type Node struct {
    Tag      string
    Attrs    map[string]string
    Text     string
    Children []*Node
    Parent   *Node
}
func (n *Node) Append(child *Node)        { /* TODO */ }
func (n *Node) Closest(tag string) *Node  { /* TODO */ }
```

**Hints.**
- `Append`: detach from old parent, then set `child.Parent = n`, then append.
- Closest walks up via `Parent` including self (matches browser `Element.closest`).
- Add a `CheckInvariants()` for tests. Run after every mutation in fuzz.

<details><summary>Reference solution</summary>

```go
type Node struct {
    Tag      string
    Attrs    map[string]string
    Text     string
    Children []*Node
    Parent   *Node
}

func New(tag string) *Node {
    return &Node{Tag: tag, Attrs: map[string]string{}}
}

// Senior decision: Append manages parent linkage on BOTH sides.
// Forgetting to detach from the old parent leaves the child in two
// parent.Children lists — classic DOM bug.
func (n *Node) Append(child *Node) {
    if child == nil { return }
    if child.Parent != nil { child.Detach() }
    child.Parent = n
    n.Children = append(n.Children, child)
}

func (n *Node) Detach() {
    p := n.Parent
    if p == nil { return }
    for i, c := range p.Children {
        if c == n {
            p.Children = append(p.Children[:i], p.Children[i+1:]...)
            break
        }
    }
    n.Parent = nil
}

// Senior decision: Closest INCLUDES self. Same semantics as browser
// Element.closest(). "Starts from parent" surprises are a perennial
// source of jQuery bugs.
func (n *Node) Closest(tag string) *Node {
    for cur := n; cur != nil; cur = cur.Parent {
        if cur.Tag == tag { return cur }
    }
    return nil
}

func (n *Node) Path() string {
    if n.Parent == nil { return "/" + n.Tag }
    return n.Parent.Path() + "/" + n.Tag
}

// Senior decision: invariant check that tests must run after every
// mutation. The parent-pointer model is brittle; fuzz it hard.
func (n *Node) CheckInvariants() error {
    for _, c := range n.Children {
        if c.Parent != n {
            return fmt.Errorf("node %s child %s has wrong parent", n.Path(), c.Tag)
        }
        if err := c.CheckInvariants(); err != nil { return err }
    }
    return nil
}
```

Parent pointers turn the tree into a doubly-linked structure. Linters need them; parsers do not. Triple the mutation code on every operation that touches the structure.

</details>

---

## Task 14 — Tree diff (two trees, return changes) (A)

**Goal.** Given two trees, output `Added`, `Removed`, `Modified`, `Moved` records. Match by path; identify moves by content hash.

**Starter.**

```go
type ChangeKind int
const ( Added ChangeKind = iota; Removed; Modified; Moved )
type Change struct {
    Kind ChangeKind
    Path string
    From string
}
func Diff(before, after Node) []Change { /* TODO */ }
```

**Hints.**
- Path-based matching turns the NP-hard general tree diff into O(N).
- Move = exactly one removal and one addition share a content hash.
- For AST/DOM diff (no stable names) you need Zhang-Shasha or GumTree — different problem.

<details><summary>Reference solution</summary>

```go
type Node interface {
    Name() string
    Children() []Node
    Hash() string
}

type ChangeKind int
const ( Added ChangeKind = iota; Removed; Modified; Moved )

type Change struct {
    Kind   ChangeKind
    Path   string
    From   string // for Moved
    Before Node
    After  Node
}

// Senior decision: path-based matching makes this O(N). Right for
// filesystems, config trees, sitemaps. For AST/DOM diff (no stable
// names, order matters) you need Zhang-Shasha. Be honest about model.
func Diff(before, after Node) []Change {
    bm, am := flatten(before), flatten(after)
    return diffMaps(bm, am)
}

func flatten(n Node) map[string]Node {
    out := map[string]Node{}
    var walk func(Node, string)
    walk = func(n Node, p string) {
        path := p + "/" + n.Name()
        if p == "" { path = n.Name() }
        out[path] = n
        for _, c := range n.Children() { walk(c, path) }
    }
    walk(n, "")
    return out
}

func diffMaps(before, after map[string]Node) []Change {
    var changes []Change

    // Senior decision: a node is "moved" only if EXACTLY one removal
    // and one addition share its content hash. Multi-match means we
    // can't tell; report as add+remove. Arbitrary pairing creates
    // noisy diffs.
    rmHash, addHash := map[string][]string{}, map[string][]string{}
    for p, n := range before {
        if _, ok := after[p]; !ok { rmHash[n.Hash()] = append(rmHash[n.Hash()], p) }
    }
    for p, n := range after {
        if _, ok := before[p]; !ok { addHash[n.Hash()] = append(addHash[n.Hash()], p) }
    }
    movedFrom, movedTo := map[string]string{}, map[string]string{}
    for h, rms := range rmHash {
        if ads := addHash[h]; len(rms) == 1 && len(ads) == 1 {
            movedFrom[ads[0]], movedTo[rms[0]] = rms[0], ads[0]
        }
    }

    var rms, adds []string
    for p := range before {
        if _, ok := after[p]; !ok && movedTo[p] == "" { rms = append(rms, p) }
    }
    for p := range after {
        if _, ok := before[p]; !ok && movedFrom[p] == "" { adds = append(adds, p) }
    }
    sort.Strings(rms)
    sort.Strings(adds)
    for _, p := range rms {
        changes = append(changes, Change{Kind: Removed, Path: p, Before: before[p]})
    }
    for _, p := range adds {
        changes = append(changes, Change{Kind: Added, Path: p, After: after[p]})
    }

    var moved []string
    for np := range movedFrom { moved = append(moved, np) }
    sort.Strings(moved)
    for _, np := range moved {
        op := movedFrom[np]
        changes = append(changes, Change{Kind: Moved, From: op, Path: np,
            Before: before[op], After: after[np]})
    }

    var shared []string
    for p := range before {
        if _, ok := after[p]; ok { shared = append(shared, p) }
    }
    sort.Strings(shared)
    for _, p := range shared {
        if before[p].Hash() != after[p].Hash() {
            changes = append(changes, Change{Kind: Modified, Path: p,
                Before: before[p], After: after[p]})
        }
    }
    return changes
}
```

Two completely different problems behind "tree diff": identity-by-path (filesystems) and identity-by-structure (ASTs). Pick the simple model and be explicit about its limits.

</details>

---

## Task 15 — Mini AST + evaluator for a DSL with let/lambda/if (S)

**Goal.** A real little language. AST for `Num`, `Var`, `Add`, `Sub`, `Mul`, `Lt`, `If`, `Let`, `LetRec`, `Lambda`, `Apply`. `Eval` with lexical envs. Pretty-printer. Test on factorial.

**Starter.**

```go
type Expr interface{ isExpr() }
type Value interface{ isValue() }
type Env struct { /* ... */ }
func Eval(e Expr, env *Env) (Value, error) { /* TODO */ }
```

**Hints.**
- `Env` is `map[string]Value` plus `parent *Env`. Lookup walks parents.
- Lambda captures the `Env` at construction (lexical, not dynamic).
- `If` short-circuits — otherwise factorial recurses forever.
- `LetRec`: bind name in the new scope BEFORE evaluating the binding. That's how the closure sees itself.

<details><summary>Reference solution</summary>

```go
// Senior decision: sealed Expr, exhaustive switch in Eval. Adding
// binding forms — let, lambda, apply — is what makes this a language
// and not a calculator.
type Expr interface{ isExpr() }

type Num    struct{ V int }
type Var    struct{ Name string }
type Add    struct{ L, R Expr }
type Sub    struct{ L, R Expr }
type Mul    struct{ L, R Expr }
type Lt     struct{ L, R Expr }
type If     struct{ Cond, Then, Else Expr }
type Let    struct{ Name string; Bind, Body Expr }
type LetRec struct{ Name string; Bind, Body Expr }
type Lambda struct{ Params []string; Body Expr }
type Apply  struct{ Fn Expr; Args []Expr }

func (Num) isExpr()    {}
func (Var) isExpr()    {}
func (Add) isExpr()    {}
func (Sub) isExpr()    {}
func (Mul) isExpr()    {}
func (Lt) isExpr()     {}
func (If) isExpr()     {}
func (Let) isExpr()    {}
func (LetRec) isExpr() {}
func (Lambda) isExpr() {}
func (Apply) isExpr()  {}

// Senior decision: distinguish Expr (syntax) from Value (semantics).
// Mixing them is the single biggest source of bugs in toy interpreters
// — "is this Num the expression I'm about to evaluate or the value I
// just produced?"
type Value interface{ isValue() }
type IntV    struct{ V int }
type BoolV   struct{ V bool }
type Closure struct{ Params []string; Body Expr; Env *Env }
func (IntV) isValue()    {}
func (BoolV) isValue()   {}
func (Closure) isValue() {}

// Senior decision: lexical Env as parent-chained maps. Each call
// frame's parent is the closure's CAPTURED env, not the caller's.
// That's lexical (Scheme/OCaml/Go) vs dynamic (old Lisps/Emacs). One
// of the most important decisions in a language; cheap here.
type Env struct {
    bindings map[string]Value
    parent   *Env
}

func NewEnv(parent *Env) *Env {
    return &Env{bindings: map[string]Value{}, parent: parent}
}

func (e *Env) Lookup(name string) (Value, bool) {
    for cur := e; cur != nil; cur = cur.parent {
        if v, ok := cur.bindings[name]; ok { return v, true }
    }
    return nil, false
}

func (e *Env) Define(name string, v Value) { e.bindings[name] = v }

func Eval(e Expr, env *Env) (Value, error) {
    switch x := e.(type) {
    case Num:
        return IntV{x.V}, nil
    case Var:
        v, ok := env.Lookup(x.Name)
        if !ok { return nil, fmt.Errorf("unbound: %s", x.Name) }
        return v, nil
    case Add: return bin(x.L, x.R, env, func(a, b int) Value { return IntV{a + b} })
    case Sub: return bin(x.L, x.R, env, func(a, b int) Value { return IntV{a - b} })
    case Mul: return bin(x.L, x.R, env, func(a, b int) Value { return IntV{a * b} })
    case Lt:  return bin(x.L, x.R, env, func(a, b int) Value { return BoolV{a < b} })
    case If:
        c, err := Eval(x.Cond, env)
        if err != nil { return nil, err }
        bv, ok := c.(BoolV)
        if !ok { return nil, fmt.Errorf("if cond not bool: %T", c) }
        // Senior decision: short-circuit. Eagerly evaluating both
        // branches breaks recursion and changes observable semantics
        // when Eval has effects.
        if bv.V { return Eval(x.Then, env) }
        return Eval(x.Else, env)
    case Let:
        v, err := Eval(x.Bind, env)
        if err != nil { return nil, err }
        inner := NewEnv(env)
        inner.Define(x.Name, v)
        return Eval(x.Body, inner)
    case LetRec:
        // Senior decision: bind the name in the new scope FIRST, then
        // evaluate the binding in that scope. The closure's captured
        // env then sees the name. This is the trick every functional
        // language uses for letrec / local rec.
        inner := NewEnv(env)
        inner.Define(x.Name, nil)
        v, err := Eval(x.Bind, inner)
        if err != nil { return nil, err }
        inner.Define(x.Name, v)
        return Eval(x.Body, inner)
    case Lambda:
        return Closure{x.Params, x.Body, env}, nil
    case Apply:
        fnV, err := Eval(x.Fn, env)
        if err != nil { return nil, err }
        cl, ok := fnV.(Closure)
        if !ok { return nil, fmt.Errorf("apply non-function: %T", fnV) }
        if len(cl.Params) != len(x.Args) {
            return nil, fmt.Errorf("arity: want %d got %d", len(cl.Params), len(x.Args))
        }
        callEnv := NewEnv(cl.Env) // lexical — NOT env
        for i, p := range cl.Params {
            v, err := Eval(x.Args[i], env)
            if err != nil { return nil, err }
            callEnv.Define(p, v)
        }
        return Eval(cl.Body, callEnv)
    }
    return nil, fmt.Errorf("unknown Expr: %T", e)
}

func bin(l, r Expr, env *Env, op func(a, b int) Value) (Value, error) {
    lv, err := Eval(l, env)
    if err != nil { return nil, err }
    rv, err := Eval(r, env)
    if err != nil { return nil, err }
    li, lok := lv.(IntV)
    ri, rok := rv.(IntV)
    if !lok || !rok { return nil, fmt.Errorf("binop needs ints, got %T %T", lv, rv) }
    return op(li.V, ri.V), nil
}

// Factorial:
//   prog := LetRec{Name: "fact",
//       Bind: Lambda{Params: []string{"n"},
//           Body: If{Cond: Lt{Var{"n"}, Num{2}},
//               Then: Num{1},
//               Else: Mul{Var{"n"},
//                   Apply{Var{"fact"}, []Expr{Sub{Var{"n"}, Num{1}}}}}}},
//       Body: Apply{Var{"fact"}, []Expr{Num{5}}}}
//   v, _ := Eval(prog, NewEnv(nil)) // IntV{120}
```

Composite + Visitor in full dress: the AST is the tree; Eval and PrettyPrint are two visitors over the same shape; adding a typechecker or a JIT is a third without touching the tree. The cost — adding a new node touches every visitor — is the standard Visitor trade. From here, records, pattern matching, mutual recursion, lazy semantics are more code but no new structural decisions.

</details>

---

## 4. How to grade yourself

Score each task `0` (didn't try), `1` (got it with hints), `2` (unaided), `3` (wrote tests that exposed a bug in your first version — cycle in Walk, mismatched parent pointer in DOM, divergent diff). Sum:

| Score | What it means |
|-------|---------------|
| 0–15  | You can write a struct with a child slice but can't yet articulate when to use pure-interface, tagged-struct, or visitor-based form. Re-read middle.md §2; redo Tasks 1–4. The "Walk is just a library function" insight is non-optional. |
| 16–25 | Comfortable with pure-interface Composite. Build the AST evaluator (6), the yaml-like tagged struct (7), and the generic Tree (8). The three shapes should now feel like three different tools, not three versions of the same one. |
| 26–35 | You can pick the right shape and write the traversal. Tasks 10–13 are runtime concerns: concurrency, serialization, CLI ergonomics, mutation invariants. Distinguishes "I built it once" from "I would put this in production". |
| 36–45 | Senior. Tasks 14–15 force a real algorithmic choice (tree diff identity model, lexical scope) and multi-visitor architecture. If they didn't teach you something concrete, read `go/ast`, `golang.org/x/net/html`, and `cobra.Command` source and identify which task each one corresponds to. |

Concrete checks worth running:

- `go test -race ./...` clean on every task that uses goroutines (Task 10 minimum).
- Walk (3) vs WalkSafe (9): WalkSafe must not blow the stack on a 100-node cycle; Walk must.
- Task 2: adding a leaf five levels deep invalidates the immediate folder; the root still returns the stale value. Document that.
- Task 5: a visitor returning `false` on every `*Folder` named "vendor" must skip the subtree — count nodes and prove they were not visited.
- Task 10: `parallelism=4`, 1000 leaves, wall time ~250x leaf time, not 1000x. If it's serial, you're over-locking inside `fn` or awaiting children sequentially.
- Task 11: Marshal-Unmarshal-Marshal output equals the first Marshal output byte-for-byte (modulo map ordering). If not, the dispatch is dropping a field.
- Task 13: after every Append/Detach/move, `CheckInvariants()` passes. Make it a fuzz target.
- Task 14: `Diff(t, t)` returns zero changes; `Diff(a, b)` and `Diff(b, a)` are inverse change-sets modulo move detection.
- Task 15: `fact(5) == 120`. A free variable in a lambda body errors "unbound" at Apply, not at Lambda definition.

The most important question is not *did you finish* — it's *can you predict which Composite shape a given Go library is using just from its `Walk`/`Inspect`/`ServeMux` signature?* When `cobra.Command` reads instantly as Task 12's one-struct Composite; when `ast.Inspect` clicks as a closure version of Task 5's visitor; when `html.Node.Type` reads as Task 7's discriminator — you understand the pattern. The rest is plumbing.

---

## 5. Stretch challenges

**S1 — Persistent Composite with structural sharing.** Take Task 8's `Tree[T]` and make every mutation return a new tree, reusing unchanged subtrees by pointer. `t.Add(v)` returns a new `*Tree[T]` sharing all of `t`'s untouched siblings. Prove via benchmark that 10000 small edits use O(log N) new nodes per edit, not O(N). Clojure persistent vector / `im.Map` model. Bonus: `Zipper[T]` for O(1) localized edits.

**S2 — Incremental tree diff with edit script.** Extend Task 14 to produce an edit script (`Insert`, `Delete`, `Move`, `Update`) such that applying it to `before` yields `after`. Cache subtree hashes so unchanged whole subtrees are skipped in O(1). Stress with 10000-node random trees and verify `Apply(before, Diff(before, after)) == after` over 1000 trials. This is what powers React reconcile and `git diff-tree`.

**S3 — Typed AST with phases.** Take Task 15's DSL and add a parallel `TypedExpr` shape where every node carries a resolved type. Write `TypeCheck(Expr) (TypedExpr, error)` using Hindley-Milner unification, then `EvalTyped(TypedExpr, *Env)` that no longer needs runtime type checks. Show the typed evaluator beats the untyped one on factorial-heavy workloads. The trade — two parallel Composite trees, two visitors per operation — is what every serious compiler (GCC, OCaml, Roslyn) makes; the senior decision is where you put the boundary.
