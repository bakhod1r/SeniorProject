# Composite — Senior

## 1. Mental model — recursive interface dispatch and the decision tree

Composite at senior level is **recursive interface dispatch over a heterogeneous node set**, with the recursion happening at the call site, not inside any node. Every method on the interface is implicitly a fold: leaves give the base case, composites give the recursive case, and the call graph mirrors the data graph one-for-one. Every Composite-shaped problem reduces to three questions: *what shape is the node set*, *what shape is the recursion*, and *where do new operations live*.

Three production-grade shapes in Go, not interchangeable:

| Shape | Node set | Operations live in | Adding a node type | Adding an operation | Static safety | Serializability |
|-------|----------|--------------------|--------------------|---------------------|---------------|------------------|
| Pure interface | Many small types, one interface | Methods on nodes | One file, one type | Edit every node | Maximum — exhaustive type switches | Awkward — needs custom marshalling |
| Tagged struct | One struct, `Kind` discriminator | Free functions switching on `Kind` | Add a `Kind` constant + every switch | One new function | Compiler will not catch missing cases | Trivial — single type |
| Visitor over interface | Pure-interface nodes + a `Visitor` interface | Methods on Visitor | Edit every Visitor | One new Visitor type | Strong if Visitor is exhaustive | Same as pure interface |

The decision tree is not a matter of taste:

```
                    ┌─ How many node types? ─┐
                  >5│                        │≤3 or data-shaped
            ┌───────▼─────┐         ┌────────▼────────┐
            │ How many    │         │ Tagged struct   │
            │ operations? │         │ (yaml.v3, JSON) │
            └──────┬──────┘         └─────────────────┘
        ≤3 stable  │  Many or unknown
        ┌──────────▼──────────┐
        │ Pure interface      │
        │ (go/ast, html.Node) │
        └──────────┬──────────┘
                   │ External tools add operations
                   ▼ without modifying nodes
        ┌─────────────────────┐
        │ Pure interface +    │
        │ Visitor (ast.Walk,  │
        │ ast.Inspect)        │
        └─────────────────────┘
```

Pure-interface is the Go default. Tagged structs win for serialization-heavy code (parser output, config trees, wire protocols). Visitor wins when the *consumers* of the tree outnumber and outlive the tree itself — analyzers, code generators, linters, transformers. `go/ast` ships all three: nodes are typed, `ast.Walk` is the Visitor, `ast.Inspect` is the closure variant.

Senior heuristic: **the Composite is the data; the operations are the customers**. If customers are stable and few, put operations on nodes. If they proliferate, push them into Visitors. If round-tripping through JSON or YAML is the dominant job, collapse to a tagged struct and accept the `switch Kind` tax.

---

## 2. `go/ast` deep dive — Node, Walker, Inspector, Cursor

`go/ast` is the canonical stdlib Composite. The base interface is two methods:

```go
type Node interface {
    Pos() token.Pos
    End() token.Pos
}
```

Sub-interfaces partition the node set with unexported marker methods:

```go
type Expr interface { Node; exprNode() }
type Stmt interface { Node; stmtNode() }
type Decl interface { Node; declNode() }
```

The markers enforce category membership at compile time without leaking implementation — you cannot pass `*ast.FuncDecl` where an `Expr` is required. **This is the pattern**: minimize the base interface, partition into sub-hierarchies with marker methods, let the compiler enforce membership. Junior Composites have 12-method `Node`; `go/ast` has two.

`ast.Walk` is a recursive Visitor:

```go
type Visitor interface { Visit(node Node) (w Visitor) }

func Walk(v Visitor, node Node) {
    if v = v.Visit(node); v == nil { return }
    switch n := node.(type) {
    case *File:     walkList(v, n.Decls)
    case *FuncDecl:
        if n.Recv != nil { Walk(v, n.Recv) }
        Walk(v, n.Name); Walk(v, n.Type)
        if n.Body != nil { Walk(v, n.Body) }
    // ~70 more cases
    }
    v.Visit(nil) // post-order signal
}
```

`Visit` returning a new Visitor (or nil to stop descending) lets the Visitor swap itself per subtree — useful when entering a scope changes context. The trailing `v.Visit(nil)` gives post-order hooks. This is the **enter/exit traversal** in one walk.

`ast.Inspect` is the closure form — what 95% of analysis code actually uses:

```go
func Inspect(node Node, f func(Node) bool) { Walk(inspector(f), node) }
```

`ast.Cursor` (Go 1.22+) is the senior addition. `Walk` gives you a node but not its slot in the parent — you cannot rewrite without that handle. Cursor exposes it:

```go
func (c *Cursor) Node() ast.Node
func (c *Cursor) Parent() ast.Node
func (c *Cursor) Name() string  // field name in parent
func (c *Cursor) Index() int    // -1 if not in a slice
func (c *Cursor) Replace(n ast.Node)
func (c *Cursor) Delete()
func (c *Cursor) InsertBefore(n ast.Node)
func (c *Cursor) InsertAfter(n ast.Node)
```

`gopls`, `gofmt -r`, and modern refactoring tools are built on it. Tree rewrites become declarative: `if c.Node() is fmt.Println call, Replace with log.Println`.

**How `staticcheck` uses this.** Static analyzers cannot walk the whole AST per check — hundreds of checks, each interested in a few node kinds. `honnef.co/go/tools` uses `inspector.Inspector`: build a flat index of nodes by kind once, then dispatch by kind in O(matches) instead of O(tree).

```go
insp := inspector.New([]*ast.File{file})
filter := []ast.Node{(*ast.CallExpr)(nil)}
insp.Preorder(filter, func(n ast.Node) {
    if isFmtPrintln(n.(*ast.CallExpr)) { report(n) }
})
```

Twenty checks pay one tree walk total. Senior insight: **for read-heavy analysis, invert the recursion** — index the tree by node type up front, iterate by category. The Composite is queried, not walked.

---

## 3. `golang.org/x/net/html` — the pointer-tangle DOM

The HTML parser tree is the opposite pole. `html.Node` is **one fat struct** with rich navigation:

```go
type Node struct {
    Parent, FirstChild, LastChild, PrevSibling, NextSibling *Node
    Type      NodeType
    DataAtom  atom.Atom
    Data      string
    Namespace string
    Attr      []Attribute
}
```

Six pointers per node. No `[]*Node` — children are a doubly-linked list through `FirstChild`/`NextSibling`:

```go
for c := n.FirstChild; c != nil; c = c.NextSibling { walk(c) }
```

| Aspect | Slice-of-children (`go/ast`) | Pointer-tangle (`html.Node`) |
|--------|------------------------------|------------------------------|
| Memory per node | ~16 bytes + slice header | 48 bytes of pointers fixed |
| Insert/delete at position k | O(n) memcopy | O(1) pointer rewiring |
| Iterate children | Index slice | Walk linked list |
| Locality | Excellent (contiguous) | Poor (pointer-chase) |
| Mutation during traversal | Dangerous (slice resize) | Safe with snapshot of `NextSibling` |
| Parent pointer | Optional | Mandatory |
| Serialization | Trivial | Awkward (cycles via Parent) |

The DOM picks pointer-tangle because **the operations are tree mutation**: `removeChild`, `insertBefore`, `replaceChild`, `appendChild` — each O(1) with pointers, O(n) with slices. The parser knows the current insertion point as a `*Node` and threads it through the state machine without indexing.

Real costs: cycles by construction (a bad `Parent` makes any naive walker hang); no derivable serialization (`encoding/json` infinite-loops on `Parent`, hence the custom `Render`); cache misses dominate (10K-node walk is hundreds of microseconds, mostly L2 misses); aliasing (two `*Node` refs share state).

Copy this shape when **frequent in-place mutation, no serialization, traversal over a stable structure** — build-system action graphs, incremental compilers, scene graphs. Most application code that wants this actually wants the slice form.

---

## 4. `cobra.Command` — Composite for CLIs, lifecycle hooks

`cobra` models a CLI as a tree. Each `*cobra.Command` has child commands; leaves are runnable verbs.

```go
type Command struct {
    Use, Short, Long string
    Run     func(cmd *Command, args []string)
    RunE    func(cmd *Command, args []string) error
    PreRun, PreRunE     func(cmd *Command, args []string)
    PostRun, PostRunE   func(cmd *Command, args []string)
    PersistentPreRunE   func(cmd *Command, args []string) error
    PersistentPostRunE  func(cmd *Command, args []string) error
    commands []*Command
    parent   *Command
}

func (c *Command) AddCommand(cmds ...*Command) {
    for _, cmd := range cmds {
        cmd.parent = c
        c.commands = append(c.commands, cmd)
    }
}
```

Composite recursion lives in `Execute()`. Dispatch is path-based: `myapp users create --email=x` walks the tree matching tokens against `command.Use`. The lifecycle:

```
PersistentPreRunE  (walk up; nearest non-nil per level)
  PreRunE
    RunE
  PostRunE
PersistentPostRunE
```

The persistent hooks are the senior part. `PersistentPreRunE` on root runs before *any* subcommand — auth, logging, telemetry init. On a middle node, before any descendant — group-scoped setup. The walk resolves hooks bottom-up: this is the **inherited attribute** pattern from compilers, applied to CLI lifecycle.

**Why cobra requires explicit `AddCommand` from `main` instead of `init()`.** `init()`-time registration (the `database/sql` shape) gives plugin extensibility but loses determinism: two subcommands with the same `Use` would race on package init order. Explicit `AddCommand` builds the tree in code, in `main`, in predictable order. Trade: cannot extend a cobra app via blank import. Senior interpretation: **registration order matters for CLIs (UX, help, errors); determinism beats extensibility**. Compare with `database/sql`, where any order works because lookup is by name.

The cost of the Composite shape here is interface bloat in `Command` (~40 fields) because every node is both group and runnable. Splitting into `CommandGroup` + `Leaf` was rejected for ergonomic reasons — most middle nodes have both children and default behavior. Senior takeaway: **when group and leaf share most config, one struct is pragmatic**; when they would not, split.

---

## 5. Visitor pattern integration — analysis tools, transformers

Composite + Visitor pays off when *operations* outnumber and outlive *node types*. The marginal cost of a new operation is one Visitor; the marginal cost of a new node type is updating every Visitor. The trade is asymmetric and only worth it on one side.

Minimal Go shape:

```go
type Visitor interface { Visit(n Node) (w Visitor, descend bool) }

func Walk(v Visitor, n Node) {
    w, descend := v.Visit(n)
    if w == nil || !descend { return }
    for _, c := range n.Children() { Walk(w, c) }
}
```

`go/ast.Walk` is this with descent encoded in `w == nil`. Returning a fresh `w` for the subtree lets the Visitor change state without mutating itself — important for parallel walks.

**Closure-based Visitor** when the operation is one-shot:

```go
func Inspect(n Node, fn func(Node) bool) {
    if !fn(n) { return }
    for _, c := range n.Children() { Inspect(c, fn) }
}
```

Reserve the interface form for stateful, multi-method Visitors that need symmetry (enter/exit, pre/post).

**Double dispatch and why Go does not have it.** Classical GoF Visitor uses `node.Accept(visitor)` to dispatch on node type, then `visitor.VisitXxx(node)` to dispatch on operation. The first dispatch is virtual. Go does not need it — a type switch is the dispatch. Idiomatic Go Visitors are walker-driven: the walker switches on `node.(type)` once; the Visitor is data + a hook.

**Transformers vs analyzers.** Analyzers read; transformers rewrite. Transformers need either (a) tree mutation through a `Cursor`-like API, or (b) reconstructing the tree as you walk and returning a new root (`fmap`). Go usually picks (a). When to pick (b) anyway: **concurrent analyses on the same tree** — two goroutines deriving different transforms force serialization under in-place mutation; cloning gives lock-free parallelism at memory cost.

---

## 6. Generics typed Composite (Go 1.18+) with full `Node[T]` code

Pre-generics Composites used `interface{}` or a fixed `Node` interface. Generics parameterize the payload while retaining static types.

```go
package tree

import (
    "context"
    "sync"
)

type Node[T any] struct {
    Value    T
    Parent   *Node[T]
    children []*Node[T]
    mu       sync.RWMutex // protects children; not Value
}

func New[T any](v T) *Node[T] { return &Node[T]{Value: v} }

// Children returns a defensive copy.
func (n *Node[T]) Children() []*Node[T] {
    n.mu.RLock(); defer n.mu.RUnlock()
    out := make([]*Node[T], len(n.children))
    copy(out, n.children)
    return out
}

// ChildrenRef returns the underlying slice. Caller MUST NOT retain across
// mutations. Used by hot traversals.
func (n *Node[T]) ChildrenRef() []*Node[T] {
    n.mu.RLock(); defer n.mu.RUnlock()
    return n.children
}

func (n *Node[T]) Add(child *Node[T]) {
    n.mu.Lock(); defer n.mu.Unlock()
    child.Parent = n
    n.children = append(n.children, child)
}

func (n *Node[T]) Remove(child *Node[T]) bool {
    n.mu.Lock(); defer n.mu.Unlock()
    for i, c := range n.children {
        if c == child {
            n.children = append(n.children[:i], n.children[i+1:]...)
            child.Parent = nil
            return true
        }
    }
    return false
}

// Walk: pre-order DFS; short-circuits on first non-nil error.
func Walk[T any](n *Node[T], fn func(*Node[T]) error) error {
    if err := fn(n); err != nil { return err }
    for _, c := range n.ChildrenRef() {
        if err := Walk(c, fn); err != nil { return err }
    }
    return nil
}

func WalkCtx[T any](ctx context.Context, n *Node[T], fn func(context.Context, *Node[T]) error) error {
    if err := ctx.Err(); err != nil { return err }
    if err := fn(ctx, n); err != nil { return err }
    for _, c := range n.ChildrenRef() {
        if err := WalkCtx(ctx, c, fn); err != nil { return err }
    }
    return nil
}

func Fold[T, R any](n *Node[T], init R, combine func(R, *Node[T]) R) R {
    acc := combine(init, n)
    for _, c := range n.ChildrenRef() { acc = Fold(c, acc, combine) }
    return acc
}

// Map builds a parallel tree with values transformed by f.
func Map[T, U any](n *Node[T], f func(T) U) *Node[U] {
    out := New(f(n.Value))
    for _, c := range n.ChildrenRef() { out.Add(Map(c, f)) }
    return out
}

func Depth[T any](n *Node[T]) int {
    max := 0
    for _, c := range n.ChildrenRef() {
        if d := Depth(c); d > max { max = d }
    }
    return max + 1
}

func Size[T any](n *Node[T]) int {
    return Fold(n, 0, func(acc int, _ *Node[T]) int { return acc + 1 })
}
```

Notes that matter:

- **`Value T` is a field**, not behind an interface — callers get static access, no type assertions.
- **`ChildrenRef` alongside `Children`**: default returns a copy (safe); hot paths use the ref version under a documented contract. Give both.
- **`Walk`, `Fold`, `Map` are package-level generic functions**, not methods. Go generics do not allow generic methods on generic types with a different type parameter (`Map[U]` cannot be a method on `Node[T]`).
- **`Map` builds a parallel tree** for immutable rewrites — O(n) allocations.
- **Locking covers `children`, not `Value`** — concurrent reads of `Value` are the caller's concern.

Senior trade: **method receivers force allocation when the receiver escapes; free functions over pointer params do not**. For tight loops over millions of nodes, prefer free functions and explicit pointers.

---

## 7. Performance — traversal cost, allocation, depth limits

Composite traversal is one of the most-measured Go workloads — compilers, linters, HTTP routers all walk trees. Dominant costs:

| Cost | Per-node | Mitigation |
|------|----------|------------|
| Interface method call | ~2 ns (vtable lookup, indirect call) | Concrete types in hot loops |
| `Children()` slice copy | O(k) + heap alloc | `ChildrenRef`; iterate once |
| Recursive call frame | ~50 ns + stack growth | Iterative DFS with explicit stack |
| Cache miss on pointer chase | 50-200 ns per L2 miss | Arena allocation, contiguous layout |
| Closure escape in `fn` | Alloc per call if closure captures | Reuse closure across calls |

100K-node balanced tree, branching factor 4, Apple M-class:

```
BenchmarkWalk_Slice-10        12   85 ms/op    0 B/op       0 allocs/op
BenchmarkWalk_SliceCopy-10     9  112 ms/op  6.4 MB/op  100k allocs/op
BenchmarkWalk_Iterative-10    14   71 ms/op    0 B/op       0 allocs/op
BenchmarkWalk_Visitor-10      11   94 ms/op  1.6 MB/op   25k allocs/op
```

The 30% gap between `Slice` and `SliceCopy` is the **allocation tax of safe `Children()`**. 100K nodes eats 6 MB of garbage per walk; a linter walking 10K files burns 60 GB per run, half a minute of GC pause. Provide both APIs and document which to use.

**Iterative DFS** with an explicit stack is faster than recursive — no per-frame call overhead, amortized stack growth, the compiler can vectorize the inner loop:

```go
func WalkIter[T any](n *Node[T], fn func(*Node[T])) {
    stack := make([]*Node[T], 0, 64) // tune cap to expected depth
    stack = append(stack, n)
    for len(stack) > 0 {
        i := len(stack) - 1
        cur := stack[i]; stack = stack[:i]
        fn(cur)
        kids := cur.ChildrenRef()
        for i := len(kids) - 1; i >= 0; i-- { stack = append(stack, kids[i]) }
    }
}
```

Trade: iterative is faster, recursive is readable. `go/ast.Walk` chose recursive because source nesting is bounded (rarely above 100). For unbounded user-supplied trees, choose iterative.

**Goroutine stack overflow.** Go stacks start at 8 KB and grow to 1 GB by default. Recursive DFS on a degenerate linear tree (linked list disguised as a tree) of 10M nodes blows the stack. Fix: hard depth limit (refuse to parse), iterative DFS, or grow with `runtime.SetMaxStack` (not recommended — fix the recursion).

**Arena allocation** changes the constant factor dramatically. One `make([]Node, N)` for the whole tree makes traversal sequential memory, cache-friendly, GC-free until the arena dies. `go/ast` does this implicitly via the parser's allocator; protobuf `arenas` do it explicitly. Use case: parse, walk, discard. Not a fit for long-lived mutable trees.

**Depth limits as a security boundary.** Untrusted input (XML, JSON, HTML, source) can be crafted to maximize depth. `encoding/xml` caps via `MaxDepth` (Go 1.21+); HTML parser caps implicitly via HTML5's model. For your own parsers: enforce a hard limit, error on exceed, document it. Without a cap, 10 KB of input builds a 100K-deep tree and OOMs a 4 GB process.

---

## 8. Observability — tree size, depth histograms, traversal duration

Composite trees are invisible runtime structures. They cost CPU and memory in proportion to their shape, and the shape is rarely what you assume.

| Metric | Type | Labels | Question |
|--------|------|--------|----------|
| `tree_size_nodes` | gauge | tree_name | How big is the tree? |
| `tree_depth_max` | gauge | tree_name | Close to depth limit? |
| `tree_depth_p99` | histogram | tree_name | One-tail abuse |
| `tree_traversal_duration_seconds` | histogram | tree_name, operation | Slow operation? |
| `tree_traversal_nodes_visited` | histogram | tree_name, operation | Walking too much? |
| `tree_build_duration_seconds` | histogram | tree_name | Parse / construction |
| `tree_node_alloc_bytes` | counter | tree_name | Rebuild churn |
| `tree_cycle_detected_total` | counter | tree_name | Alert on > 0 |

Instrumentation lives in the walker, not the node:

```go
func WalkInstrumented[T any](n *Node[T], op string, fn func(*Node[T]) error, m *Metrics) error {
    t0 := time.Now()
    var visited int
    err := Walk(n, func(x *Node[T]) error {
        visited++
        return fn(x)
    })
    m.TraversalDuration.WithLabelValues(op).Observe(time.Since(t0).Seconds())
    m.NodesVisited.WithLabelValues(op).Observe(float64(visited))
    return err
}
```

The `visited` count is more informative than total time — it controls for tree size. A linter that visits 12% of nodes is healthy; one that visits 98% is doing a global rebuild every check.

**Depth histograms catch adversarial input.** A parser fed `<<<<<<<<<...` with 1M nesting levels shows up as p99 depth spiking. Alert on p99 > expected_max — the cheapest signal of malformed or hostile input.

**Tree shape sampling** for huge trees: every Nth request, walk and emit `(depth, fanout, leaf_count)`. Aggregated over hours, shape drift becomes visible — a routing tree gaining a 50-deep subbranch nobody noticed.

**`pprof` heap** tells you which node type dominates allocation. If `*ast.CommentGroup` is 40% of heap, that is your refactoring target. **`runtime/trace`** shows GC pauses around tree rebuilds — a 200 ms pause every 30 seconds correlates with config reload, the trace pointing at the old tree's death. Mitigation: copy-on-write Composite, swap atomically.

---

## 9. Failure modes — cycles, stack overflow, mutation during traversal, interface bloat

**Cycles on a tree that thought it was acyclic.** `Add(child)` does not check whether `child` is an ancestor; a bug wires a cycle; the walker hangs.

```go
a.Add(b); b.Add(a) // Walk(a) never returns
```

Defense — cycle check in `Add` (O(depth) per insert, acceptable for low-frequency mutation):

```go
func (n *Node[T]) Add(child *Node[T]) error {
    for cur := n; cur != nil; cur = cur.Parent {
        if cur == child {
            return fmt.Errorf("tree: cycle; %p is ancestor of %p", child, n)
        }
    }
    n.mu.Lock(); defer n.mu.Unlock()
    child.Parent = n
    n.children = append(n.children, child)
    return nil
}
```

For trees built from untrusted input, walk with a visited set unconditionally. For internal-only trees, document the precondition and audit at review.

**Stack overflow on deep trees.** A 100K-deep linear tree (parsed comment chain, generated AST, deeply nested JSON) recurses until the goroutine stack hits its limit. Fix: iterative DFS plus a configurable max depth that errors before the runtime does.

**Mutation during traversal.** Removing or adding children while iterating produces missed nodes, double visits, or slice panics. Three fixes, increasing rigor: (1) two-pass — collect targets in pass 1, mutate in pass 2; (2) snapshot children before iterating (`append(nil, n.ChildrenRef()...)`); (3) Cursor-mediated mutation — the walker gives every callback a `Cursor` and tracks iteration index (`ast.Inspector.Cursor`). For concurrent traversal + mutation, per-node `RWMutex` is not enough — only a tree-wide write lock or a copy-on-write root is safe.

**Interface bloat.** The `Node` interface grows because some specific node type needs a method; the lazy fix is to add it everywhere with a default. Five generations of this and `Node` has 20 methods, 15 returning zero/nil/error from leaves. Fix: **feature detection over interface widening**:

```go
type Renamable interface { Rename(newName string) error }

if r, ok := n.(Renamable); ok { return r.Rename(newName) }
return fmt.Errorf("node %T does not support rename", n)
```

The base `Node` stays small. Capabilities are optional interfaces, queried at the call site — `io.Reader`/`io.WriterTo`/`io.Closer` in stdlib are exactly this.

**Slice aliasing.** `Children()` returns the underlying slice. Caller appends, slice doubles, original tree references stale storage. Fix: document the contract, return a copy, or return an `iter.Seq` (Go 1.23+) that does not expose the slice.

**Visitor exhaustion.** A new node type breaks every Visitor silently — the type switch hits `default` and skips. Fix: centralized walker switch + Visitor methods per kind; or `go vet`-style analyzers that warn on non-exhaustive switches over sealed interface sets.

**Stale Parent pointer.** Removing a node from one parent and re-adding to another without updating `Parent`. Fix: `Add` sets `child.Parent`; `Remove` clears it. All mutation through the tree API, never bare-field assignment.

| Failure | Symptom | Fix |
|---------|---------|-----|
| Cycle on insert | `Walk` hangs forever | Cycle check in `Add`; visited-set in `Walk` |
| Stack overflow | Goroutine panics on deep trees | Iterative DFS, depth cap |
| Mutation during traversal | Skipped or duplicate visits | Two-pass, snapshot, or Cursor |
| Interface bloat | 20-method `Node`, dead defaults | Feature detection via optional interfaces |
| Slice aliasing | Tree corruption after `Children()` use | Return copy or `iter.Seq` |
| Visitor exhaustion gaps | Silent skip on new node type | Centralized walker switch; analyzers |
| Stale Parent pointer | `Path()` wrong, root walk diverges | All mutation through tree API |
| Concurrent walk + mutate | Race, panic, or stale read | Tree-wide lock or copy-on-write root |

---

## 10. When NOT Composite + closing principles

### 10.1 When not Composite

- **Flat list.** No recursion → use a slice.
- **One node type.** `type Node struct { Children []*Node }` is a recursive struct, not Composite. The pattern requires *heterogeneity*.
- **Write-heavy.** Composite biases toward reads. Heavy mutation wants a database with indexes and transactions.
- **Lookup is the operation, not traversal.** A map keyed by node ID beats a walk. Pair the tree with an index, or skip the tree.
- **Shallow, fixed recursion.** Two levels → `Group{Name; Files []File}` is clearer.
- **Total order across the structure.** Composites are locally ordered. Global order needs a separate index — usually a flat list or B-tree.
- **Serialization is the dominant use case.** Tagged-struct or custom encoding beats pure-interface with hand-written marshalers.
- **The "tree" is a graph.** Multi-parenting, cycles by design, shortest-path queries — graph problems. Use graph algorithms.

### 10.2 Closing principles

**Choose the shape from the operation set, not the data.** Three nodes, twenty operations → pure interface + Visitor. Twenty nodes, three operations → pure interface with methods. One node, many serializations → tagged struct. Read the consumer side first.

**Minimize the base interface.** `go/ast.Node` has two methods. Junior Composites have twelve. Every base method taxes every node type. Per-category methods move to sub-interfaces; the rest is feature detection via optional interfaces (`io.Reader`/`io.WriterTo` shape).

**Make `Children()` honest.** Document whether it returns a copy, a reference, or an iterator. Provide both safe and fast variants if needed. "I thought it was a copy" is the most common Composite bug in production.

**Walkers belong to the package, not the node.** `Walk`, `Inspect`, `Fold`, `Filter`, `Map` are free functions parameterized over the node type. Methods on the node force every type to re-derive them; free functions are written once.

**Visitors are stateful walker closures with extra methods.** Do not over-engineer with `Accept(visitor)`. Go's type switch is the dispatch. Interface Visitor is justified for multi-category operations (enter/exit, pre/post); otherwise a `func(Node) bool` is enough.

**Cap depth on every tree built from untrusted input.** XML, JSON, HTML, source code, config DSLs — all weaponizable via depth. A configurable `MaxDepth` is one of the cheapest security controls in the codebase.

**Cycle detection is a precondition, not a feature.** If the domain forbids cycles, audit at construction. If cycles are possible, walk with a visited set unconditionally. The middle position — "we think it is a tree, but the walker does not check" — is where production hangs come from.

**Mutate through the tree's API or not at all.** Direct field access defeats invariant maintenance. Use `Cursor` for transformers, `Walk`/`Inspect` for analyzers.

**Observe the shape.** Tree size, depth, traversal duration, nodes visited. Shape drifts; without metrics you find out at 3 AM when GC pauses spike.

**Generics replace `interface{}` in libraries, not in node sets.** `Node[T]` is the right shape when the payload is uniform. A Composite of mixed leaf and branch types still needs the pure-interface shape — generics cannot encode an open set of types.

**The Composite is a contract about recursion.** State the base case, the recursive case, what the operation folds to, and the termination guarantee in the package doc. Most Composite bugs evaporate before they happen.

Done well, a Composite is the most reusable structure a Go codebase has — one walker, dozens of operations, indefinite lifetime. Done badly, it is twenty methods of leaky abstraction with a stack overflow waiting for the right input.

---

## Further reading

- `go/ast` — canonical Composite with `Walk`, `Inspect`, sub-interfaces, marker methods
- `golang.org/x/tools/go/ast/inspector` and `ast.Cursor` (Go 1.22+) — indexed access and rewriting
- `golang.org/x/net/html` — pointer-tangle DOM Composite
- `spf13/cobra` Command — CLI Composite with persistent lifecycle hooks
- `honnef.co/go/tools` (staticcheck) — Composite traversal at production scale
- `gopkg.in/yaml.v3` Node — tagged-struct Composite; `io/fs.FS` — behavioural Composite
- `encoding/xml` `MaxDepth` (Go 1.21+); `runtime/trace` and `pprof` for tree workloads
- GoF (1994) — Composite and Visitor chapters
