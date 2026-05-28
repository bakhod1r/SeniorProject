# Composite — Middle

## 1. Where Composite actually lives in Go

Composite is one of the patterns that's everywhere once you can recognize it. In Go specifically:

- **`go/ast`** — the canonical Composite implementation in the standard library; every node satisfies `ast.Node`.
- **`golang.org/x/net/html`** — DOM with a unified `Node` type.
- **`cobra.Command`** — CLI command tree.
- **`encoding/xml`** — token/element tree.
- **fs.FS / fs.WalkDir** — filesystem abstraction that *uses* a Composite tree without exposing it directly.
- **chi / gin Groups** — middleware groups + routes.
- **`yaml.v3.Node`** — document tree with `Kind` discriminator.

The middle-level skill is understanding the design choices each of these makes — and when each is right for your tree.

---

## 2. Three Go shapes of Composite

You'll see roughly three variants:

| Shape | Distinguishing trait | When to choose |
|-------|----------------------|----------------|
| **Pure-interface** | All nodes implement one interface; type-switch only at consumer leaves | Strong static-typing, many node types |
| **Tagged-struct** | One concrete struct with a `Kind` field + child slice | Few node kinds, serialization matters |
| **Visitor-based** | Nodes accept a Visitor; behavior moves out of the tree | Read-mostly traversal with many operations |

Pure-interface (`go/ast`-style) is the most idiomatic. Tagged-struct (`yaml.v3.Node`) is best for parser output you serialize/deserialize. Visitor-based (`go/ast.Inspect`, `go/ast.Walk`) is used for analysis tools.

---

## 3. The pure-interface form (production-shaped)

```go
type Node interface {
    Name() string
    Size() int64
    Children() []Node
}

type File struct{ name string; size int64 }
func (f *File) Name() string     { return f.name }
func (f *File) Size() int64      { return f.size }
func (f *File) Children() []Node { return nil }

type Folder struct {
    name     string
    children []Node
}

func (d *Folder) Name() string     { return d.name }
func (d *Folder) Children() []Node { return d.children }
func (d *Folder) Size() int64 {
    var total int64
    for _, c := range d.children {
        total += c.Size()
    }
    return total
}

func (d *Folder) Add(n Node) { d.children = append(d.children, n) }
func (d *Folder) Remove(n Node) {
    for i, c := range d.children {
        if c == n {
            d.children = append(d.children[:i], d.children[i+1:]...)
            return
        }
    }
}
```

The middle-level additions are:
- `Children()` exposes the structure without requiring downcasts.
- `Add`/`Remove` for mutation, only on the Composite type.
- Pointer receivers, so a `Folder` can mutate and be passed around without copying its slice.

---

## 4. Generic traversal — visitor and walker

Once nodes share an interface, you can write *one* traversal that works on any tree:

```go
// DFS pre-order
func Walk(n Node, fn func(Node)) {
    fn(n)
    for _, c := range n.Children() {
        Walk(c, fn)
    }
}

// Filter by predicate
func Filter(n Node, pred func(Node) bool) []Node {
    var out []Node
    Walk(n, func(x Node) {
        if pred(x) {
            out = append(out, x)
        }
    })
    return out
}
```

Total size:

```go
var total int64
Walk(root, func(n Node) {
    if f, ok := n.(*File); ok {
        total += f.Size()
    }
})
```

This is the analog of `filepath.Walk` and `ast.Inspect`. Walker-based code is endlessly reusable; nodes only need to expose `Children()`.

The visitor form lets the traversal control descent:

```go
type Visitor interface {
    Visit(n Node) (descend bool)
}

func Walk(n Node, v Visitor) {
    if v.Visit(n) {
        for _, c := range n.Children() {
            Walk(c, v)
        }
    }
}
```

`go/ast.Walk` is exactly this shape: the visitor's `Visit` returns a new visitor (or nil to stop descending). Skipping subtrees is essential for any non-trivial analysis tool.

---

## 5. The tagged-struct form

When the tree is mostly *data*, having many tiny types is overkill. One struct with a `Kind` discriminator can be simpler:

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

That's roughly the `yaml.v3.Node` shape. Benefits:
- One type to (un)marshal.
- Easy `json.Marshal` round-trip.
- No type-switch in producers.

Drawbacks:
- Adding behaviour means switch-on-`Kind` everywhere.
- "Doesn't apply" methods need sensible defaults.
- The compiler can't help you catch missing cases.

The tagged-struct form trades static safety for serialization friendliness. It's the right choice for parser output and config trees.

---

## 6. Composite + Visitor (the analysis-tool sweet spot)

When you need many different *operations* over the same tree (a linter checks types, an evaluator computes values, a pretty-printer formats), the pure-interface form forces you to put all those methods on each node type. That's a lot.

The Visitor form moves the operations out:

```go
type Visitor interface {
    VisitFile(*File)
    VisitFolder(*Folder)
}

func Accept(v Visitor, n Node) {
    switch x := n.(type) {
    case *File:   v.VisitFile(x)
    case *Folder:
        v.VisitFolder(x)
        for _, c := range x.children {
            Accept(v, c)
        }
    }
}
```

Now adding "compute total size", "print tree", "delete empty folders" is *each* a new Visitor — no node code changes. Adding a new *node type* changes every Visitor, which is the well-known Visitor trade-off.

This is why `go/ast.Inspect` exists: same shape, but using a closure instead of an interface to define the visit.

---

## 7. Sharing data across the tree

Real trees often need shared context: a config, a logger, a cycle-detection set.

Three idioms in Go:

**Thread context through traversal:**

```go
func Walk(ctx context.Context, n Node, fn func(context.Context, Node) error) error {
    if err := fn(ctx, n); err != nil { return err }
    for _, c := range n.Children() {
        if err := Walk(ctx, c, fn); err != nil { return err }
    }
    return nil
}
```

**State on the visitor:**

```go
type CountVisitor struct{ count int }
func (v *CountVisitor) Visit(n Node) bool { v.count++; return true }
```

**Pass-by-state closure:**

```go
var depth int
var maxDepth int
Walk(root, func(n Node) {
    depth++
    if depth > maxDepth { maxDepth = depth }
    // post-order decrement is awkward — better in a custom Walk
})
```

The visitor form is the cleanest for multi-pass analyses. Closure state works for one-shot accumulation.

---

## 8. Cycles — when trees aren't trees

A "tree" that allows arbitrary `Add(child)` can be made into a cycle:

```go
a := &Folder{name: "a"}
b := &Folder{name: "b"}
a.Add(b)
b.Add(a)
a.Size() // infinite recursion
```

If your domain genuinely tree-shaped (parse trees), document it and trust callers. If cycles are physically possible (graph of references, hot-reload config), defend:

```go
func Walk(n Node, fn func(Node), seen map[Node]bool) {
    if seen[n] { return }
    seen[n] = true
    fn(n)
    for _, c := range n.Children() {
        Walk(c, fn, seen)
    }
}
```

Same shape, plus a visited set.

---

## 9. fs.FS — Composite-without-the-interface

`io/fs.FS` is interesting: it's a Composite (filesystem is a tree) but the *tree structure* is hidden. You navigate by `Open(name)` and `ReadDir(name)`; there's no `Folder.Children()` method.

This is the "behavioural" Composite: the interface exposes a *traversal API* (`Open`, `ReadDir`), not a structural one (`Children`). It's the right call when:

- The tree might be virtual (zip, tar, http).
- Walking is the only operation that matters.
- Random access by full path is more useful than per-node iteration.

So Go pushes you toward two flavours: structural Composite (`ast.Node`, `html.Node`) for analysis, behavioural Composite (`fs.FS`, route trees) for navigation.

---

## 10. Common middle-level mistakes

- **Interface bloat.** `Node` with 20 methods because *some* node needs each. Make the interface minimal and feature-detect (`if d, ok := n.(Renamable); ok`).
- **Mutating during traversal.** Adding/removing children while ranging over them.
- **Concrete-typed Children method.** `Folder.Children() []*Folder` defeats the polymorphism.
- **Allocating per traversal.** `Children() []Node` that copies a slice every call. Either return the underlying slice (caller must not mutate) or accept the allocation as a cost.
- **No `Parent()` accessor when you need it.** Pure trees don't need it; analyses that climb up do. Decide once.
- **Confusing Composite with Decorator.** Decorator wraps; Composite groups. The trees look similar; the semantics differ.

---

## 11. Summary

Middle-level Composite is about picking the right shape — pure-interface for typed analysis, tagged-struct for serializable parsers, visitor-based for many operations on one tree. Pair with a `Walk` helper and you get a reusable traversal for free. Watch for cycles, mutation during iteration, and interface bloat. The pattern is small in code; the discipline is in defining the right interface boundary.

---

## Further reading
- `go/ast` package — canonical pure-interface Composite
- `ast.Inspect` and `ast.Walk` — visitor variants
- `golang.org/x/net/html.Node` — DOM Composite
- `gopkg.in/yaml.v3.Node` — tagged-struct example
- `io/fs.FS` — behavioural Composite
- `spf13/cobra` Command — CLI tree
- GoF (1994) — Composite chapter
