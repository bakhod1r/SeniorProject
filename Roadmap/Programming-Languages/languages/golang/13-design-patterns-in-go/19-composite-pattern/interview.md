# Composite Pattern — Interview

## 1. How to use this file

25 questions in interview order — junior to staff — plus three live-coding prompts, a concept-check list, and signals interviewers grade on. Each question has a **short answer** (two to five sentences, the length you'd give in the room) and where it matters a **follow-up to expect**. Read top to bottom on first pass; on revision skim and re-read only the ones you stumbled on. Type the live-coding solutions out at least once. Composite is a small pattern in code and a big pattern in design taste: the interview signal is whether you can name the shape (pure-interface vs tagged-struct vs visitor), pick the right one for a given problem, and reason about cycles, mutation, and traversal control without prompting.

---

## 2. Junior questions (Q1–Q7)

### Q1. What is the Composite pattern?

**Short answer:** Composite lets clients treat individual objects (leaves) and groups of objects (composites) through the same interface, so a recursive tree can be walked and queried without the caller knowing which node is which. In Go terms: define an interface that both `File` and `Folder` satisfy, give `Folder` a `[]Node` of children, and the caller can call `Size()` on any node — leaves return their own size, composites sum their children. The pattern's payoff is the uniform interface; the structure is just a side effect of needing it.

**Follow-up:** What does "uniform interface" buy you specifically? Answer: one traversal function works for the whole tree, callers don't need type switches for the common operations, and a leaf can be substituted for a one-node subtree without changing any call site.

---

### Q2. Why does the uniform interface matter — what breaks if leaves and composites differ?

**Short answer:** Without a uniform interface, every caller has to branch on "is this a leaf or a composite?" before doing anything — recursion has to be re-implemented at each call site, traversal helpers can't exist, and adding a new node kind forces edits everywhere. With it, `Walk`, `Size`, `Render`, `Validate` are written once against the interface and work on any tree shape. The pattern's whole value proposition collapses if `Folder.Size()` requires the caller to know it's a folder.

**Follow-up:** What about operations that genuinely only make sense on composites — like `Add(child)`? Answer: keep them on the concrete `Folder` type. The interface holds the shared subset; composite-only behaviour stays on the composite. Don't bloat `Node` with `Add` just because you're tempted to call it on a leaf and get a "this is a leaf" panic.

---

### Q3. What's the difference between a leaf and a composite node?

**Short answer:** A **leaf** has no children — it's the terminal in the recursion (a file, an integer literal, a single HTML text node). A **composite** holds a collection of children (a folder, an arithmetic expression, an HTML element). Both implement the same interface; the leaf's `Children()` returns nil or an empty slice, and a leaf's operations are computed directly rather than by recursing. The distinction is purely about whether the node has substructure.

**Follow-up:** Can a node be both leaf and composite depending on state? Answer: yes — an empty `Folder` has no children but is still structurally a composite. The shape is determined by *what the type can hold*, not by what it happens to hold right now. Treating an empty folder as a leaf would force callers to re-derive the role on each visit.

---

### Q4. Name three Composite implementations in the Go standard library.

**Short answer:** `go/ast` is the canonical one — every AST node satisfies `ast.Node` with `Pos()`/`End()`, and walking is done by `ast.Walk` or `ast.Inspect`. `encoding/xml` builds a token stream that consumers commonly assemble into an element tree. `text/template` parses templates into a tree of `parse.Node` values. Outside the stdlib but standard-adjacent: `golang.org/x/net/html.Node` for the DOM and `gopkg.in/yaml.v3.Node` for YAML documents.

**Follow-up:** Is `io/fs.FS` a Composite? Answer: yes, but a *behavioural* one — the filesystem is a tree, but the interface exposes a traversal API (`Open`, `ReadDir`) rather than a structural one (no `Children()` method). Same pattern, different surface area.

---

### Q5. How do you express "children of any node type" in Go?

**Short answer:** Use a slice of the shared interface — `Children []Node` (or `Children() []Node` for an accessor). Because every node implements `Node`, the slice holds files, folders, symlinks, anything that satisfies the interface, and the recursion works without type switches. The alternative — `Children []*Folder` — defeats the polymorphism because then only folders can be children, and the tree can't mix node kinds.

```go
type Node interface {
    Name() string
    Children() []Node
}

type Folder struct {
    name     string
    children []Node // interface slice — heterogeneous children
}
```

**Follow-up:** Returning a slice vs returning an iterator? Answer: for trees under, say, a million nodes, slices are fine and simpler. For huge trees or expensive children (`*os.File` per entry), prefer an iterator or callback so you don't materialize the whole subtree at once. Go 1.23+ range-over-function makes this ergonomic.

---

### Q6. Composite vs Decorator — what's the difference?

**Short answer:** Both wrap nodes recursively, so they look similar on paper, but their intent differs. **Composite** is about *grouping*: a folder holds many files and behaves like a single thing. **Decorator** is about *augmenting*: a `LoggingReader` wraps a single `io.Reader` and adds logging without changing the interface. Composite has many children; Decorator has one. Composite computes by aggregating children; Decorator computes by delegating to the wrapped object plus extra behaviour.

**Follow-up:** Can you combine them? Answer: yes — a Composite tree where some nodes are themselves Decorators around real nodes (e.g. a logging wrapper around a folder that still satisfies `Node`). The interface is the contract; how each implementation realizes it is independent.

---

### Q7. What goes wrong if your tree has a cycle?

**Short answer:** Recursion that doesn't track visited nodes will follow the cycle forever — `Walk(root)` becomes infinite recursion, eats stack, panics or OOMs. If the tree is genuinely tree-shaped (parsed source, on-disk hierarchy), document the contract and trust callers not to introduce cycles. If cycles are physically possible (graph of references, hot-reloaded config, symlinks in a filesystem walk), defend by carrying a `seen` set through the traversal and skipping any node already visited.

```go
func Walk(n Node, fn func(Node), seen map[Node]bool) {
    if seen[n] { return }
    seen[n] = true
    fn(n)
    for _, c := range n.Children() { Walk(c, fn, seen) }
}
```

**Follow-up:** What identity to compare? Answer: pointer identity (`map[Node]bool` with interface values that wrap pointers) is the usual choice. Value identity is wrong if two semantically equal nodes are legitimately allowed at different positions in the tree.

---

## 3. Middle questions (Q8–Q15)

### Q8. Name the three Go shapes of Composite and when to pick each.

**Short answer:** The three shapes share a "node interface plus child list" core but differ in *where behaviour lives*.

| Shape | Distinguishing trait | Pick when |
|-------|----------------------|-----------|
| **Pure-interface** | Many node types, each implementing the shared interface | Strong static typing, many operations on each node directly |
| **Tagged-struct** | One concrete struct with a `Kind` field + child slice | Few node kinds, serialization is a primary concern |
| **Visitor-based** | Nodes are minimal; operations live in Visitor types | Many distinct operations over a stable node set (linters, analyzers) |

`go/ast` is pure-interface. `yaml.v3.Node` is tagged-struct. `ast.Inspect` and `ast.Walk` overlay visitor-based traversal on top of the pure-interface base. Picking wrong is expensive: tagged-struct for an AST with 40 node kinds means `switch kind` everywhere; pure-interface for a YAML tree means generic decode/encode is painful.

**Follow-up:** Can you migrate between shapes? Answer: pure-interface → visitor is cheap (write a `Walk` and visitor types, keep nodes). Pure-interface → tagged-struct is a rewrite. Tagged-struct → pure-interface is also a rewrite. Pick once with care.

---

### Q9. How does Composite combine with Visitor in Go, and why pair them?

**Short answer:** Composite gives you the tree; Visitor lets you add operations without modifying the nodes. The pattern is `Accept(v Visitor, n Node)` that type-switches on the node and calls the appropriate `VisitX` method, recursing on children. New operation = new Visitor implementation, no node code changes. The trade-off — adding a *new node type* forces every Visitor to add a method — is the classic Visitor cost; it's fine when the node set is stable.

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
        for _, c := range x.children { Accept(v, c) }
    }
}
```

`go/ast.Inspect` is a closure-based variant: same shape, the visitor is a `func(ast.Node) bool` that returns whether to descend.

**Follow-up:** Why does `ast.Walk` return a new visitor from `Visit`? Answer: it lets the visitor *change* during traversal — entering a function body returns a different visitor than the outer scope. The trick gives per-subtree state without explicit context plumbing.

---

### Q10. Walk through how `ast.Inspect` works mechanically.

**Short answer:** `ast.Inspect(node, fn)` is `ast.Walk(inspector(fn), node)`. The `inspector` type wraps the closure as a visitor: its `Visit(n)` calls `fn(n)`; if `fn` returns true, it returns itself (descend), else nil (stop). `ast.Walk` then dispatches on the concrete node type via a giant switch, calling itself recursively on each child field (Decl, Stmt, Expr, etc.). The whole machinery is ~250 lines of node-type-aware recursion plus the visitor closure trick. The lesson: the *generic* traversal helper is small; what's big is the per-node switch that knows which fields are children.

**Follow-up:** Why not have each node implement a `Children() []Node` method like our filesystem example? Answer: history and field types — many AST fields are typed (`*FuncDecl.Body *BlockStmt`), and exposing them as `[]Node` would lose static typing. `ast.Walk` is the bespoke alternative: pay the maintenance cost of one big switch to keep the node fields typed.

---

### Q11. What goes wrong if you mutate the tree during traversal?

**Short answer:** Three failure modes. (1) **Skipped or double-visited nodes** — appending to the slice you're ranging over changes its length mid-iteration; deleting shifts indices and the next iteration skips a node. (2) **Stale snapshots** — `range x.children` evaluates `x.children` once at the start; subsequent `Add`/`Remove` don't show up in the loop. (3) **Visitor invariant violation** — visitors often track state per subtree (depth, scope); restructuring under their feet breaks the state machine. The fix is to collect changes during traversal, apply them in a separate pass, or use a cursor that explicitly supports in-place edit (see `ast.Cursor` in `golang.org/x/tools/go/ast/astutil`).

**Follow-up:** What does `astutil.Cursor` do that plain `ast.Walk` doesn't? Answer: it exposes `Replace`, `Delete`, `InsertBefore`, `InsertAfter` on the current visit, with documented semantics about whether the new node is visited next. Mutation becomes a first-class operation instead of an undefined-behaviour escape hatch.

---

### Q12. Why is `fs.FS` called a "behavioural" Composite?

**Short answer:** `io/fs.FS` describes a filesystem tree — a Composite — but the interface exposes navigation methods (`Open(name)`, `ReadDir(name)`) rather than structural ones (no `Node`, no `Children()`). The tree is implicit in the naming scheme; consumers walk by calling the API, not by traversing fields. This shape is right when (a) the tree is virtual (zip, http, in-memory), (b) random-access by path matters more than per-node iteration, and (c) walking is the only operation consumers need. The structural Composite (`ast.Node`) wins when you need typed analysis; the behavioural one wins when you need uniform navigation across many storage backends.

**Follow-up:** Could `ast` be behavioural too? Answer: it could expose `LookupSymbol(name)` and `IterateChildren(visit)` instead of typed fields, but then every analysis would lose static typing on `*ast.FuncDecl.Body`. Behavioural is right for navigation-uniform problems; structural is right for analysis-rich problems. AST is analysis-heavy, so structural wins.

---

### Q13. When do you need parent pointers, and what do they cost?

**Short answer:** Parent pointers (`Node.Parent() Node`) let you climb up — useful for scope resolution in an AST, breadcrumbs in a UI tree, "delete this node from its parent" without re-traversal. The costs: (1) **construction complexity** — building a tree with parent pointers is harder because you can't construct children before their parent exists in a typed way (chicken-and-egg without nullable fields). (2) **Mutation invariants** — every `Add`/`Remove` must update parent pointers; one bug and the tree is corrupted. (3) **GC retention** — parent pointers create reference cycles (parent ↔ child); Go's GC handles them, but ownership analysis is harder. (4) **Serialization** — exporting a tree with parent pointers means choosing one direction to serialize. Add parent pointers only when an analysis genuinely needs them, and document the invariant precisely.

**Follow-up:** Alternative to baked-in parent pointers? Answer: thread the path through traversal — `Walk(n Node, path []Node, fn func(path []Node, n Node))`. Each visitor call gets the full ancestor chain without nodes storing it. Slower to construct on every walk, but no construction-time complexity and no mutation pitfalls.

---

### Q14. How minimal should the `Node` interface be?

**Short answer:** As minimal as possible. The interface holds operations that *every* node must support; everything else lives on concrete types and is reached by type assertion or by Visitor dispatch. A common antipattern: `Node` grows to 15 methods because *some* nodes need each, leaf types end up with no-op implementations, and the interface becomes a documentation problem. Better: define `Node` with one or two truly shared methods (often just `Pos()`/`End()` or `Children()`), and feature-detect specialized behaviour via narrower interfaces (`Renamable`, `Sized`).

```go
type Node interface { Children() []Node }
type Renamable interface { Node; Rename(string) }

if r, ok := n.(Renamable); ok { r.Rename(newName) }
```

**Follow-up:** Why feature-detect instead of bloating the interface? Answer: a leaf that can't be renamed shouldn't have a `Rename` method that panics. Narrow interfaces document capability; wide interfaces with no-ops lie to callers. Go's structural typing makes narrow-interface feature detection cheap.

---

### Q15. How do you bound traversal depth without breaking the recursive shape?

**Short answer:** Carry a depth counter through traversal and stop when it hits the limit. The pattern:

```go
func Walk(n Node, depth, max int, fn func(Node) bool) {
    if depth > max { return }
    if !fn(n) { return }
    for _, c := range n.Children() {
        Walk(c, depth+1, max, fn)
    }
}
```

Two reasons to bound depth: defence against adversarial input (a hand-crafted document with 10k nesting levels blows the stack) and bounded latency (a UI tree renderer must finish in 16ms regardless of input). For Go specifically, stack overflows from deep recursion aren't fatal-then-recoverable — the runtime grows stacks, but eventually the goroutine dies. Converting to an explicit stack (`[]Node`) gives iteration that's bounded by heap rather than goroutine stack.

**Follow-up:** When is iterative traversal preferred over recursive? Answer: (a) trees deeper than ~10k levels, (b) when you need to pause/resume traversal (coroutine-style), (c) when memory pressure matters and you'd rather control allocation explicitly. For most trees, recursion is fine and reads better.

---

## 4. Senior questions (Q16–Q22)

### Q16. Design a generic `Tree[T]` Composite with type-safe children.

**Short answer:** Use Go generics to parameterise the payload while keeping the structural recursion typed. The key choice: `Tree[T]` has a `T` payload and `[]*Tree[T]` children — the recursion is on the wrapper type, not on the payload, so children type-check uniformly.

```go
type Tree[T any] struct {
    Value    T
    Children []*Tree[T]
}

func (t *Tree[T]) Walk(fn func(*Tree[T])) {
    fn(t)
    for _, c := range t.Children { c.Walk(fn) }
}

func (t *Tree[T]) Filter(pred func(T) bool) []*Tree[T] {
    var out []*Tree[T]
    t.Walk(func(n *Tree[T]) {
        if pred(n.Value) { out = append(out, n) }
    })
    return out
}
```

Senior moves: (a) the recursion is generic but the concrete `Tree[int]` and `Tree[Event]` are independent types — no boxing; (b) `Walk` takes a func, not an interface, because there's only one operation parameter; (c) callers compose by closing over their own state. The cost vs interface-based Composite: you lose heterogeneous children (every node holds the same `T`). If you need polymorphism per node, fall back to `Tree[Node]` where `Node` is itself an interface — generics over interfaces is fine.

**Follow-up:** When is generic `Tree[T]` better than `Node` interface? Answer: when nodes really do hold the same payload type (event log, decision tree, in-memory FS where all entries are entries). When nodes are semantically different (AST file vs declaration vs statement), interfaces still win.

---

### Q17. Design a persistent (immutable) Composite tree.

**Short answer:** Persistent trees never mutate in place — every "modification" returns a new tree that shares unchanged subtrees with the old one. The path from root to the changed node is rebuilt; everything else aliases. Three design points.

```go
type Node struct {
    name     string
    children []*Node // never mutated after construction
}

// SetChild returns a new Node with child i replaced; structural sharing keeps it cheap.
func (n *Node) SetChild(i int, c *Node) *Node {
    cp := *n
    cp.children = append([]*Node(nil), n.children...)
    cp.children[i] = c
    return &cp
}
```

(1) **Structural sharing** — children that don't change are reused by pointer; only the modified path is copied. Cost of a write is O(depth), memory is O(depth). (2) **No parent pointers** — they'd force re-copying the entire subtree on any change; without them, sharing works. (3) **Concurrency for free** — readers hold a snapshot; writers publish a new root via `atomic.Pointer[Node]`; old readers see the old tree until they finish.

Use when (a) you need cheap snapshotting (undo, time-travel debug, MVCC), (b) reads vastly outnumber writes, (c) concurrent readers must not see torn writes. The cost: write-heavy workloads pay for the copies, and the `[]*Node` slice gets allocated on every change.

**Follow-up:** When is in-place mutation still right? Answer: write-heavy single-owner trees (a parser building output, a layout engine computing geometry) where snapshotting isn't a requirement. Persistent trees are a tax on writes; pay it only when you need the read-side properties.

---

### Q18. How do you traverse a Composite tree concurrently, and what are the pitfalls?

**Short answer:** Concurrent traversal fans out one goroutine per subtree, joins on a `WaitGroup`, and writes results to a channel or shared slice under a lock. The pitfalls are (a) **stack depth amplification** — each level forks a goroutine, so a deep tree spawns thousands; cap concurrency with a worker pool or semaphore. (b) **Result ordering loss** — concurrent walks produce out-of-order results; if order matters, run serial or impose post-traversal sort. (c) **Shared state races** — if the visitor mutates shared state, you need a mutex or per-goroutine accumulators merged at the end. (d) **Error propagation** — first-error-wins requires `context.Context` cancellation propagated to all sibling goroutines; `errgroup.Group` gives you that.

```go
func WalkConcurrent(ctx context.Context, n Node, fn func(context.Context, Node) error) error {
    g, ctx := errgroup.WithContext(ctx)
    g.Go(func() error { return walk(ctx, g, n, fn) })
    return g.Wait()
}

func walk(ctx context.Context, g *errgroup.Group, n Node, fn func(context.Context, Node) error) error {
    if err := fn(ctx, n); err != nil { return err }
    for _, c := range n.Children() {
        c := c
        g.Go(func() error { return walk(ctx, g, c, fn) })
    }
    return nil
}
```

Senior moves: (a) `errgroup` bounds error handling and cancellation; (b) shadow `c := c` to capture the loop variable correctly (less of a concern in Go 1.22+); (c) cap goroutines with `g.SetLimit(N)` for trees with millions of nodes — without a limit you'll exhaust scheduler resources.

**Follow-up:** When does concurrent traversal help, and when does it hurt? Answer: helps when per-node work is non-trivial (file open, parse, network call) and tree is wide. Hurts when per-node work is tiny and parallelism adds scheduler overhead — pure traversal of an in-memory tree is usually faster serial.

---

### Q19. What's the "billion laughs" attack, and how does it apply to Composite trees?

**Short answer:** Billion laughs is an exponential blow-up attack: a small input expands to huge output through recursive references. Classic version in XML — `<!ENTITY a "<b/>"><!ENTITY b "<c/>"><!ENTITY c "....">` chained so resolving one root entity expands to billions of nodes. In Composite terms: any tree format that supports references-by-name (YAML anchors, XML entities, template includes) can be made to expand exponentially when realized as a tree. Defences: (1) **bound expansion** — cap the total node count during materialization, fail when exceeded. (2) **track expansion budget per parse** — each reference deducts from a shared counter; refuse to descend when the budget is exhausted. (3) **disable references at parse time** for untrusted input — `gopkg.in/yaml.v3` has options to limit anchors.

**Follow-up:** Does this affect `encoding/json`? Answer: less directly — JSON has no references, so input size bounds tree size linearly. But deep nesting (`{{{{...}}}}`) still attacks the parser stack; `encoding/json` panics around 10k depth. The same defence applies: bound depth at the parser, not at the consumer.

---

### Q20. When would you reach for `ast.Cursor` over `ast.Inspect`?

**Short answer:** `ast.Inspect` is read-only — you can observe the tree but not change it. `astutil.Cursor` (from `golang.org/x/tools/go/ast/astutil`) supports in-place mutation with documented semantics. Reach for it when (a) you're writing a refactoring tool (rename, inline, extract function), (b) you need to rewrite expressions in place rather than build a new AST, (c) you want to delete or insert nodes during traversal without rebuilding the parent. The trade: `astutil.Cursor` is more verbose (you call `c.Replace(newNode)`, `c.Delete()`, `c.InsertBefore(node)` explicitly), but mutation is well-defined and the cursor handles parent-slice updates.

```go
astutil.Apply(file, func(c *astutil.Cursor) bool {
    if call, ok := c.Node().(*ast.CallExpr); ok {
        if isDeprecated(call) { c.Replace(replacement(call)) }
    }
    return true
}, nil)
```

**Follow-up:** Why doesn't `go/ast` itself ship cursor support? Answer: scope discipline — `go/ast` is the type-and-walk layer, `golang.org/x/tools` is the tooling layer. Keeping mutation primitives out of the core means the AST package stays stable and small; refactoring tools get a separate, evolvable API.

---

### Q21. How do you serialize a tagged-struct Composite tree to JSON cleanly?

**Short answer:** Tagged-struct shines here — one type, one `(Un)Marshal`. The tag field discriminates kind; children are a recursive slice. Watch four issues. (1) **Empty children** — `json:",omitempty"` on the slice avoids `"children":null` for leaves. (2) **Kind as string vs int** — strings round-trip across languages and survive enum reordering; ints are smaller but brittle. (3) **Polymorphic value field** — if `Value` holds different types per kind, use `json.RawMessage` and decode lazily based on `Kind`. (4) **Cycle detection** — `encoding/json` will recurse forever on a cyclic graph; either guarantee acyclic or write a custom marshaller with a visited set.

```go
type Node struct {
    Kind     string          `json:"kind"`
    Value    json.RawMessage `json:"value,omitempty"`
    Children []*Node         `json:"children,omitempty"`
}

func (n *Node) DecodeValue(out any) error { return json.Unmarshal(n.Value, out) }
```

Senior moves: (a) `RawMessage` defers polymorphic decoding until you know the kind; (b) `omitempty` keeps the wire format compact; (c) explicit `DecodeValue(out any)` helper avoids type-switch boilerplate at the consumer.

**Follow-up:** Pure-interface trees with JSON — what's the right shape? Answer: define `MarshalJSON`/`UnmarshalJSON` per concrete node type and use a custom unmarshaller for the parent that reads the kind field, dispatches via a registry (`map[string]reflect.Type`), and decodes into the concrete type. Trades JSON wire-format simplicity for static type safety inside the program.

---

### Q22. What are the trade-offs between pure-interface and tagged-struct Composite trees?

**Short answer:** Pick by which axis matters most.

| Concern | Pure-interface | Tagged-struct |
|---------|---------------|---------------|
| **Adding a node kind** | New type, implement interface | New `Kind` constant, update switches |
| **Adding a method** | Add to interface, implement on every type | Add a function that switches on `Kind` |
| **Serialization** | Custom marshaller per type | One `MarshalJSON` for the struct |
| **Compile-time safety** | Strong — missing method is a compile error | Weak — missing switch case is silent |
| **Memory** | One small struct per node | One uniform struct, may waste fields for some kinds |
| **In-code clarity** | `*FuncDecl` is self-describing | `node.Kind == KindFunc` is more cryptic |

Pure-interface wins for ASTs, internal IRs, anything that's primarily consumed by typed code. Tagged-struct wins for parser output, config trees, anything that crosses the wire or is primarily data. The smell of picking wrong: pure-interface code with `default: panic("unknown kind")` everywhere (you wanted tagged-struct), or tagged-struct code with five "this only applies to KindX" methods (you wanted pure-interface).

**Follow-up:** Can you mix them? Answer: yes, and `yaml.v3` does — its `Node` is tagged-struct, but it exposes typed decoders (`Node.Decode(&FuncSpec{})`) that map a subtree to an arbitrary struct. The hybrid lets the parser stay simple while consumers get typed access.

---

## 5. Staff/Architect questions (Q23–Q25)

### Q23. Design the AST for a new DSL from scratch — what's in scope?

**Short answer:** Seven decisions grounded in production constraints.

1. **Pick the shape upfront.** Pure-interface if you'll write many static analyses on the tree (linter, type checker, optimizer); tagged-struct if the AST is mostly a serialization format consumed by interpreters. For a DSL, pure-interface usually wins because tooling is the long tail.
2. **Position info on every node.** Embed `Pos token.Pos` or `Range struct{ Start, End int }` so every error message can point at source. Cheap to add at construction, impossible to retrofit cleanly.
3. **Two trees, not one.** Concrete syntax tree (lossless, holds comments and whitespace) for formatters and IDE tooling; abstract syntax tree (lowered, normalized) for execution. `gofmt` and `go/parser` are the model.
4. **Walk and Inspect from day one.** Ship `Walk(visitor)`, `Inspect(fn)`, and an `astutil.Cursor`-style mutator together. Without them, every analysis re-invents traversal poorly.
5. **Versioning at the AST layer.** Embed `Schema int` on the root; bump when node shapes change. Tools can refuse to operate on unknown schemas instead of crashing on missing fields.
6. **Pretty-printer round-trip.** `Print(ast.File) -> source -> Parse -> ast.File` must be lossless within the concrete syntax tree. This is the smoke test for whether the AST actually captures everything.
7. **Annotations as side tables, not fields.** Type info, symbol info, source positions for synthetic nodes live in `map[Node]TypeInfo`, not on the node struct. Keeps the AST stable across analysis passes; multiple analyses can attach independently.

Staff move: name what's **not** in scope — the AST is not the IR. Don't bake optimization decisions into AST nodes; lower to an IR for that, keep the AST honest to the source.

**Follow-up:** When does tagged-struct beat pure-interface for a DSL? Answer: when the DSL is mostly *configuration* (Terraform-like — declare resources, no control flow). The tree is data; serializability dominates; tagged-struct fits. When the DSL has expressions, statements, declarations, type system, the pure-interface AST pays off in tooling.

---

### Q24. Design storage for a billion-row Composite tree.

**Short answer:** You can't hold a billion nodes in RAM as a Go object graph — each node has interface header + slice header + payload ≈ 50–100 bytes, so 50–100GB just for structure. Three architectures by what subset of the tree you need to materialize.

1. **Page-based on disk.** Store nodes in fixed-size pages indexed by node ID; children become `[]NodeID` not `[]*Node`. Walking deserializes pages on demand, LRU-caches the working set, and pages out the rest. Pattern is B+tree or LSM-style — closer to a database than to an in-memory tree.
2. **Streaming walk only.** If you only ever walk and never random-access, store the tree as a depth-first stream on disk and consume it as an iterator. No tree at all — just an event stream of "enter", "leaf", "exit". This is how XML SAX parsers handle gigabytes; `encoding/xml` token mode is the Go equivalent.
3. **Materialized path indexing.** Each node stores its full path (`/root/a/b/c`) as a string; queries like "all descendants of /root/a" become a prefix scan. Trades storage for query speed; works when the dominant access pattern is "subtree by path".

Cross-cutting decisions: (a) **schema separation** — node types are an enum in a side table; node rows carry the enum, not type info inline; (b) **compression** — tagged-struct serialization plus Snappy or Zstd is ~5–10x denser than Go's in-memory representation; (c) **partitioning** — shard by subtree (path prefix) for horizontal scale; (d) **caching layers** — hot subtrees in Redis or local LRU; cold tree on object storage.

Staff move: pick the architecture by *workload*. "We mostly do full traversal" → streaming. "We mostly query subtrees by path" → materialized path. "We mix random access with localized writes" → page-based. Building all three because "we might need it" is the antipattern.

**Follow-up:** Why not just put it in Postgres with adjacency-list (`parent_id` column)? Answer: works for thousands to millions of nodes; recursive CTEs handle subtree queries. Above ~100M nodes, the recursive CTE plan degenerates and you need either materialized path or `ltree`. Postgres scales further than people think — pick a tree DB only when Postgres has been measured and found insufficient.

---

### Q25. Design a multi-version Composite tree (think Git of nested data).

**Short answer:** Persistent tree + version pointer. Every tree state is an immutable root; each "commit" produces a new root sharing subtrees with its parent. Five pieces.

1. **Persistent node store.** Nodes are immutable, keyed by content hash (SHA-256 of `kind || children || payload`). Two nodes with the same content collapse to one entry. Equivalent to Git's blob/tree object model.
2. **Versions as root references.** A "version" is a triple `(root_hash, parent_version, metadata)`. Forms a DAG: branches, merges, tags. `HEAD` is a moving pointer.
3. **Diff and merge.** Two trees diff by recursively descending until hashes match (identical subtree, skip). Three-way merge uses common ancestor; conflicts surface at the smallest subtree where left and right differ from base in incompatible ways.
4. **Garbage collection.** Reference-counted or mark-and-sweep on the node store; an old version's nodes stay alive until no version transitively references them. Same as Git GC.
5. **Read API contracts.** `Snapshot(version)` returns an immutable view; `Modify(version, fn) -> new_version` produces the next version; readers and writers never coordinate. Concurrency is free.

Staff move: name what *Git's* model doesn't give you and decide whether you need it. (a) **Random-access by path** — Git walks the tree to find a path; if your workload needs subtree-by-path queries at scale, layer a path index over the content-addressed store. (b) **Partial materialization** — Git assumes the working tree fits on disk; for billion-row trees, you need lazy loading of nodes on access. (c) **Schema migration across versions** — Git stores opaque blobs; if your nodes have a typed schema, version-pin the schema or carry version metadata on every node.

**Follow-up:** When does multi-version add too much complexity? Answer: when the dominant workload is read-the-latest with rare snapshots. A single-version tree plus periodic full-tree backups is cheaper. Multi-version pays off when (a) branching/merging is intrinsic to the workflow (collaborative editing, scenario planning), (b) audit trails require every historical state, (c) bisection across versions is a query you'll run.

---

## 6. Live-coding prompts

### Prompt 1: Composite filesystem with Walk

**Problem.** Implement `Node` (interface), `File` (leaf), and `Folder` (composite) for an in-memory filesystem. `Folder` supports `Add(Node)`. Provide a top-level `Walk(n Node, fn func(Node))` that visits every node depth-first. Compute total size of any subtree with `Walk`.

**Answer.**

```go
package fs

type Node interface {
    Name() string
    Size() int64
    Children() []Node
}

type File struct {
    name string
    size int64
}

func NewFile(name string, size int64) *File { return &File{name: name, size: size} }

func (f *File) Name() string     { return f.name }
func (f *File) Size() int64      { return f.size }
func (f *File) Children() []Node { return nil }

type Folder struct {
    name     string
    children []Node
}

func NewFolder(name string) *Folder { return &Folder{name: name} }

func (d *Folder) Name() string     { return d.name }
func (d *Folder) Children() []Node { return d.children }
func (d *Folder) Add(n Node)       { d.children = append(d.children, n) }

func (d *Folder) Size() int64 {
    var total int64
    for _, c := range d.children { total += c.Size() }
    return total
}

func Walk(n Node, fn func(Node)) {
    fn(n)
    for _, c := range n.Children() { Walk(c, fn) }
}

func TotalSize(root Node) int64 {
    var total int64
    Walk(root, func(n Node) {
        if _, ok := n.(*File); ok { total += n.Size() }
    })
    return total
}
```

Senior moves: (a) `Children()` is the structural method that makes `Walk` reusable — no type switch in the traversal; (b) `Folder.Size()` aggregates by recursion, leveraging the interface; (c) `TotalSize` uses `Walk` plus a type assertion to count only leaves — composite sizes are already included in the recursion; (d) pointer receivers throughout so `Add` mutates the actual folder.

---

### Prompt 2: Visitor-based AST evaluator

**Problem.** Implement a tiny arithmetic AST (Num, Add, Mul) and a Visitor interface that evaluates the expression. Evaluation is implemented as a Visitor with state, *not* on the nodes themselves. Show the result for `(2 + 3) * 4`.

**Answer.**

```go
package eval

type Node interface{ accept(Visitor) }

type Num struct{ Value int }
type Add struct{ Left, Right Node }
type Mul struct{ Left, Right Node }

type Visitor interface {
    VisitNum(*Num)
    VisitAdd(*Add)
    VisitMul(*Mul)
}

func (n *Num) accept(v Visitor) { v.VisitNum(n) }
func (n *Add) accept(v Visitor) { v.VisitAdd(n) }
func (n *Mul) accept(v Visitor) { v.VisitMul(n) }

type Evaluator struct{ stack []int }

func (e *Evaluator) push(x int)      { e.stack = append(e.stack, x) }
func (e *Evaluator) pop() int        { n := len(e.stack) - 1; x := e.stack[n]; e.stack = e.stack[:n]; return x }
func (e *Evaluator) Result() int     { return e.stack[len(e.stack)-1] }
func (e *Evaluator) VisitNum(n *Num) { e.push(n.Value) }

func (e *Evaluator) VisitAdd(n *Add) {
    n.Left.accept(e); n.Right.accept(e)
    e.push(e.pop() + e.pop())
}

func (e *Evaluator) VisitMul(n *Mul) {
    n.Left.accept(e); n.Right.accept(e)
    e.push(e.pop() * e.pop())
}

func Evaluate(n Node) int {
    e := &Evaluator{}
    n.accept(e)
    return e.Result()
}

// Build (2 + 3) * 4 and evaluate.
func Example() int {
    tree := &Mul{
        Left:  &Add{Left: &Num{2}, Right: &Num{3}},
        Right: &Num{4},
    }
    return Evaluate(tree) // 20
}
```

Senior moves: (a) `accept(Visitor)` is the double-dispatch hook — each node knows which visitor method to call; (b) `Evaluator` holds an explicit value stack rather than returning from `VisitX` because Visitor methods can't return values; (c) the evaluator visits children itself (post-order: left, right, then operate); (d) adding a "print" or "type-check" visitor is now zero changes to node code — that's the Visitor payoff in one example.

---

### Prompt 3: Generic `Tree[T]` with concurrent fan-out

**Problem.** Implement `Tree[T any]` with a `Value T` and `[]*Tree[T]` children. Provide `ConcurrentMap(ctx, fn) ([]U, error)` that applies `fn(ctx, T) (U, error)` to every node in parallel and returns results in DFS pre-order. First error cancels remaining work.

**Answer.**

```go
package tree

import (
    "context"
    "sync"

    "golang.org/x/sync/errgroup"
)

type Tree[T any] struct {
    Value    T
    Children []*Tree[T]
}

// ConcurrentMap walks the tree in parallel, applying fn to each Value.
// Results are returned in DFS pre-order; first error cancels the rest.
func ConcurrentMap[T, U any](
    ctx context.Context,
    root *Tree[T],
    fn func(context.Context, T) (U, error),
) ([]U, error) {
    // First, collect node pointers in DFS pre-order so we have stable indices.
    var nodes []*Tree[T]
    var collect func(*Tree[T])
    collect = func(n *Tree[T]) {
        nodes = append(nodes, n)
        for _, c := range n.Children { collect(c) }
    }
    collect(root)

    out := make([]U, len(nodes))
    g, ctx := errgroup.WithContext(ctx)
    g.SetLimit(64) // cap goroutines for huge trees

    var mu sync.Mutex
    for i, n := range nodes {
        i, n := i, n
        g.Go(func() error {
            v, err := fn(ctx, n.Value)
            if err != nil { return err }
            mu.Lock()
            out[i] = v
            mu.Unlock()
            return nil
        })
    }
    if err := g.Wait(); err != nil { return nil, err }
    return out, nil
}
```

Senior moves: (a) collect nodes serially first to lock in DFS pre-order indices — concurrent traversal alone would lose ordering; (b) `errgroup` propagates the first error via context cancellation; (c) `SetLimit(64)` caps parallelism so a billion-node tree doesn't spawn a billion goroutines; (d) `mu` guards `out[i]` writes — even though indices don't collide, Go's race detector flags concurrent slice writes without synchronisation in some configurations; (e) `i, n := i, n` shadows loop vars for pre-1.22 safety (harmless on 1.22+); (f) the generic signature works for any node payload and any output type without boxing.

---

## 7. Concept checks

If you cannot answer any of these in one breath, study more before the interview.

- What is Composite? (Uniform interface over leaves and groups so a recursive tree can be walked without the caller knowing which node is which.)
- What's the role of `Children() []Node`? (Exposes the tree structure through the interface so generic `Walk` works without type switches.)
- Leaf vs composite — define both. (Leaf: no children, terminates recursion. Composite: holds a `[]Node` and aggregates children's results.)
- Name three stdlib Composites. (`go/ast`, `encoding/xml`, `text/template`. Outside stdlib: `golang.org/x/net/html`, `yaml.v3.Node`, `io/fs.FS`.)
- Composite vs Decorator — one-liner. (Composite groups many children; Decorator wraps a single object to add behaviour.)
- The three shapes of Composite in Go. (Pure-interface, tagged-struct, visitor-based.)
- When is tagged-struct better than pure-interface? (Few node kinds, serialization is the primary concern, no need for typed per-node operations.)
- Why pair Composite with Visitor? (New operations don't require touching node types; trade-off is that new node types touch every visitor.)
- What does `ast.Inspect` do mechanically? (Wraps a closure as a visitor, dispatches per-node-type switch in `ast.Walk`, recurses on typed children fields.)
- Mutation during traversal — what's the safe pattern? (Collect changes, apply in a second pass; or use `astutil.Cursor` for documented in-place mutation.)
- Why is `fs.FS` "behavioural"? (Tree structure is implicit; navigation is via `Open`/`ReadDir`, not via `Children()`.)
- When do you need parent pointers? (Scope resolution, breadcrumb construction, in-place node deletion. Costs: construction complexity, mutation invariants, GC reachability.)
- How minimal should `Node` be? (Just shared operations. Specialised behaviour is on concrete types, reached via narrow interfaces and type assertion.)
- How to bound traversal depth? (Pass a depth counter, stop at the limit. Defend against adversarial input and stack exhaustion.)
- What's the billion laughs attack? (Recursive reference expansion in a small input balloons to billions of nodes. Defend by capping total node count or disabling references for untrusted input.)

---

## 8. Red flags for interviewers

These signal a weak candidate.

- **Cannot name `go/ast` as a Composite.** Treats the pattern as theoretical; has never read stdlib trees.
- **Puts every method on the interface.** Bloats `Node` with 15 methods so every node type ends up with no-ops; misses the narrow-interface idiom.
- **Concrete-typed `Children()`.** Declares `Folder.Children() []*Folder` and breaks polymorphism on day one.
- **No mention of cycles.** Walks recursively without acknowledging that a `seen` set might be needed for non-trees.
- **Mutates during traversal.** Appends to children inside a `range children` loop; can't explain what goes wrong.
- **Confuses Composite with Decorator.** Cannot draw the line between grouping and wrapping.
- **No Visitor variant.** Solves "add 5 operations to this tree" by adding 5 methods to every node type; doesn't recognize the design smell.
- **Misses tagged-struct option.** Defaults to pure-interface for everything, including parsed YAML and JSON config; can't justify the choice.
- **No depth bound.** Recursive walks with no protection against adversarial deep input; has never thought about stack safety.
- **No mention of parent pointers' costs.** Adds them reflexively for "convenience" without weighing construction and GC implications.

---

## 9. Strong-candidate signals

These signal a strong candidate.

- **Names the three shapes unprompted.** Pure-interface / tagged-struct / visitor-based with concrete stdlib examples for each.
- **Reaches for narrow interfaces.** Says "feature-detect with `if r, ok := n.(Renamable); ok`" instead of bloating `Node`.
- **Knows `ast.Inspect` mechanics.** Explains the closure-as-visitor trick and why `ast.Walk` returns a new visitor from `Visit`.
- **Mentions `astutil.Cursor` for mutation.** Doesn't try to mutate during a plain `ast.Walk`; reaches for the documented mutator.
- **Cycles + `seen` set reflexively.** Brings up the problem before being asked when the domain allows cycles.
- **Bounded depth.** Adds depth limits to defend against adversarial input without prompting.
- **Persistent tree intuition.** Recognises content-addressed nodes and structural sharing as the right model for multi-version workloads.
- **Generic `Tree[T]` vs `Node` interface — picks correctly.** Generics for uniform payloads; interfaces for heterogeneous semantics.
- **Concurrent traversal with `errgroup` and a limit.** Knows the goroutine-explosion failure mode and caps it.
- **Honest about when Composite is wrong.** Recommends a flat slice or map when recursion isn't intrinsic; doesn't force the pattern.

---

## 10. Further reading

- **`go/ast` source code**: <https://cs.opensource.google/go/go/+/refs/heads/master:src/go/ast/> — canonical pure-interface Composite, `Walk` and `Inspect` implementations. Read once to internalize the typed-children-fields trade-off.
- **`golang.org/x/tools/go/ast/astutil`**: <https://pkg.go.dev/golang.org/x/tools/go/ast/astutil> — `Apply` and `Cursor` for in-place AST mutation. The model for documented mutation on a Composite tree.
- **`io/fs` design doc**: <https://go.googlesource.com/proposal/+/master/design/draft-iofs.md> — the rationale for the behavioural Composite shape, why no `Children()`, and how virtual filesystems compose.
- **`gopkg.in/yaml.v3.Node`**: <https://pkg.go.dev/gopkg.in/yaml.v3#Node> — the canonical tagged-struct Composite in Go, with `Kind` discriminator and recursive children. Read for the JSON-friendly serialization model.
- **GoF Composite chapter (1994)**: *Design Patterns: Elements of Reusable Object-Oriented Software* — the original definition. Skim for the intent statement and "treat individual objects and compositions uniformly" — everything else is dated C++.
