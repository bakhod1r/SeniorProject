# Composite — Optimization

## 1. How to use this file

Twelve scenarios where Composite-shaped code allocates more, traverses slower, or scales worse than it should. Each entry has a **Before** (code + benchmark) and a collapsible **After** (optimized code + benchmark + why + trade-offs + when NOT).

Anchored at Go 1.23, amd64. Numbers are reproducible-shape — run `go test -bench=. -benchmem` on your hardware before quoting them. Composite cost is dominated by four things: per-node interface dispatch, per-traversal slice allocation, deep recursion stack growth, and pointer-chasing across the heap. Most wins remove one of those four from the hot path. Reading order: Ex. 1, 2, 5, then any order. Ex. 4, 7, 10 are the ones most senior reviews flag.

---

## 2. Exercise 1 — Recursive `Walk` on a deep tree

A pure-interface Composite walks a 50k-node parse tree of average depth 200. Each recursive call pushes a ~80 B frame. Go's stack copy on overflow is amortized, but a balanced 200-deep tree bounces between stack sizes.

```go
type Node interface{ Children() []Node }

func Walk(n Node, fn func(Node)) {
    fn(n)
    for _, c := range n.Children() { Walk(c, fn) }
}
```

```
BenchmarkRecursiveWalk-8   1500   780000 ns/op   0 B/op   0 allocs/op  // 50k nodes, depth 200
```

<details><summary>After</summary>

Iterative DFS with an explicit `[]Node` stack. Reuse via `sync.Pool` for very hot loops.

```go
func Walk(root Node, fn func(Node)) {
    stack := make([]Node, 0, 64)
    stack = append(stack, root)
    for len(stack) > 0 {
        n := stack[len(stack)-1]; stack = stack[:len(stack)-1]
        fn(n)
        kids := n.Children()
        for i := len(kids) - 1; i >= 0; i-- { stack = append(stack, kids[i]) } // reverse for pre-order
    }
}
```

```
BenchmarkIterativeWalk-8   2400   490000 ns/op   1024 B/op   1 allocs/op
```

~1.6× faster, depth bounded by an explicit slice not the goroutine stack.

**Why faster:** No call/return overhead per node. The stack slice fits in L1 once stabilized. The runtime stops growing/shrinking the goroutine stack mid-walk.
**Trade-off:** One slice allocation per walk (amortize via `sync.Pool`). Pre-order is easy; post-order needs a two-phase stack or `(node, visited)` pairs. Panic traces no longer show traversal depth.
**When NOT:** Shallow trees (depth ≤ 32) where recursion is shorter. Trees needing natural post-order without bookkeeping. Test code where stack traces are valuable.
</details>

---

## 3. Exercise 2 — `Children()` copying a slice per call

A `Folder.Children()` returns a defensive copy of `d.children` to prevent caller mutation. A walker over 100k nodes pays 100k allocations.

```go
func (d *Folder) Children() []Node {
    out := make([]Node, len(d.children))
    copy(out, d.children)
    return out
}
```

```
BenchmarkChildrenCopy-8   2000   600000 ns/op   3200000 B/op   100000 allocs/op
```

<details><summary>After</summary>

Return the underlying slice. Document the contract: callers must not mutate. The stdlib does this (`bytes.Buffer.Bytes()`).

```go
// Children returns the folder's children. Callers must not modify the
// returned slice; treat it as read-only. Use Add/Remove to mutate.
func (d *Folder) Children() []Node { return d.children }
```

```
BenchmarkChildrenView-8   50000   24000 ns/op   0 B/op   0 allocs/op
```

~25× faster, zero allocations.

**Why faster:** A slice header is three words on the stack — no heap traffic. The previous version copied 8 B per child × 100k = 0.8 MB through the allocator.
**Trade-off:** Callers can corrupt the tree by mutating the returned slice. Mitigated by code review and a doc comment. For untrusted library boundaries, expose `Len()` + `Child(i)` instead — allocation-free and unaliasable.
**When NOT:** Public API where mutation safety beats throughput. Concurrent access where another goroutine may `Add` mid-iteration — needs a copy or RWMutex-guarded view.
</details>

---

## 4. Exercise 3 — Interface method dispatch per node

A pure-interface Composite calls `n.Kind()` and `n.Children()` per node. Each call is an indirect through the iface itab — a pipeline stall under random node-type interleaving.

```go
type Node interface {
    Kind() Kind
    Children() []Node
}

func CountByKind(n Node, k Kind) int {
    count := 0
    Walk(n, func(x Node) { if x.Kind() == k { count++ } })
    return count
}
```

```
BenchmarkInterfaceDispatch-8   500   2400000 ns/op   0 B/op   0 allocs/op  // 100k nodes
```

<details><summary>After</summary>

Tagged-struct: one concrete `Node` with `Kind` field. Dispatch becomes a field load + integer compare. Inlines cleanly.

```go
type Kind uint8
const (
    KindFile Kind = iota
    KindFolder
)

type Node struct {
    Kind     Kind
    Name     string
    Children []*Node
}

func CountByKind(root *Node, k Kind) int {
    count := 0
    var walk func(*Node)
    walk = func(n *Node) {
        if n.Kind == k { count++ }
        for _, c := range n.Children { walk(c) }
    }
    walk(root); return count
}
```

```
BenchmarkTaggedStruct-8   1200   1000000 ns/op   0 B/op   0 allocs/op
```

~2.4× faster.

**Why faster:** No itab indirection, no iface header packing on returns. `Kind` is a single byte load with branch-predictor-friendly compares. The compiler inlines accessors and devirtualizes the recursive walk.
**Trade-off:** Loses static type safety — `Children` on a leaf is `nil` not a type error. Each `Kind` adds a switch case wherever behavior differs. Per-kind fields go into one struct (`Size` on `KindFile`, ignored elsewhere) — wasted bytes per leaf.
**When NOT:** Open ecosystems where third-party packages add node types. Many behaviors per node — switch statements multiply. Heterogeneous payloads where leaves carry very different shapes.
</details>

---

## 5. Exercise 4 — `ast.Inspect` descending into subtrees you don't need

A linter scans a 200-file package for `fmt.Println` calls. `ast.Inspect` walks every node, but the linter only cares about `*ast.CallExpr`. Returning `true` descends into bodies it doesn't need.

```go
ast.Inspect(file, func(n ast.Node) bool {
    if call, ok := n.(*ast.CallExpr); ok {
        if sel, ok := call.Fun.(*ast.SelectorExpr); ok && sel.Sel.Name == "Println" {
            report(call)
        }
    }
    return true
})
```

```
BenchmarkInspectAll-8   80   14000000 ns/op   320000 B/op   4000 allocs/op  // 200-file pkg
```

<details><summary>After</summary>

Return `false` early to skip subtrees that can't contain the target.

```go
ast.Inspect(file, func(n ast.Node) bool {
    switch x := n.(type) {
    case *ast.CallExpr:
        if sel, ok := x.Fun.(*ast.SelectorExpr); ok && sel.Sel.Name == "Println" {
            report(x)
        }
        return false // Args can't contain a top-level Println
    case *ast.FuncDecl, *ast.BlockStmt, *ast.File:
        return true
    case ast.Expr:
        return false // skip type exprs, literals, idents
    }
    return true
})
```

```
BenchmarkInspectPruned-8   280   4100000 ns/op   72000 B/op   900 allocs/op
```

~3.4× faster, ~4× less garbage.

**Why faster:** `ast.Inspect` allocates a closure-call per descent step. Skipping 70% of nodes skips 70% of those calls. Allocations drop because fewer `ast.Node` interfaces get materialized for child iteration.
**Trade-off:** Misclassifying a node as "skip" hides bugs. Document the assumed subtree shape. Future Go AST changes (new node types) default to "skipped" until updated — fail loudly in tests.
**When NOT:** First implementation before profiling — start with `return true` and prune what profiles show. Tools needing full descent (formatter, type-checker). Auditing tools where missing a node is a security gap.
</details>

---

## 6. Exercise 5 — Per-node `new` allocation during parse

A parser allocates each `*Node` with `&Node{...}`. For a 500k-node tree, that's 500k separate heap objects, ~32 B each, fragmented and individually traced by the GC.

```go
type Node struct {
    Kind     Kind
    Name     string
    Children []*Node
}

func parseFolder(name string, entries []entry) *Node {
    n := &Node{Kind: KindFolder, Name: name}
    for _, e := range entries {
        if e.IsDir {
            n.Children = append(n.Children, parseFolder(e.Name, e.Sub))
        } else {
            n.Children = append(n.Children, &Node{Kind: KindFile, Name: e.Name})
        }
    }
    return n
}
```

```
BenchmarkParseHeap-8   20   62000000 ns/op   24000000 B/op   500001 allocs/op  // 500k nodes
```

<details><summary>After</summary>

Arena: one big `[]Node` per parse, hand out pointers into it. Sub-chunks chained when full. GC sees one allocation per chunk.

```go
type Arena struct {
    chunks [][]Node
    cur    []Node
}

func (a *Arena) New() *Node {
    if len(a.cur) == cap(a.cur) {
        a.chunks = append(a.chunks, a.cur)
        a.cur = make([]Node, 0, 4096)
    }
    a.cur = append(a.cur, Node{})
    return &a.cur[len(a.cur)-1]
}
```

```
BenchmarkParseArena-8   180   5800000 ns/op   1500000 B/op   140 allocs/op
```

~10× faster, ~3500× fewer allocations.

**Why faster:** `runtime.mallocgc` per-call overhead is 30-50 ns regardless of size. Arena amortizes across 4096 nodes per chunk. GC scan drops from O(nodes) to O(chunks). Children of the same parent typically land in the same chunk — cache locality. The arena freezes a chunk when it fills so prior pointers stay stable.
**Trade-off:** Arena lifetime = tree lifetime — no individual frees. Replacing a subtree needs re-walking to compact. `*Node` from one arena passed to another is a footgun.
**When NOT:** Trees heavily mutated post-parse. Trees living across multiple parses where node identity must persist. Small trees (< 1k nodes) where wins don't pay for API friction.
</details>

---

## 7. Exercise 6 — Linear search in `Children` for a named child

A config tree resolves `root.Get("server.http.port")` by splitting on `.` and linearly scanning each level's `Children`. For wide nodes (50 keys), the inner loop is O(N) per segment.

```go
func (n *Node) Get(path string) (*Node, bool) {
    cur := n
    for _, seg := range strings.Split(path, ".") {
        var found *Node
        for _, c := range cur.Children {
            if c.Name == seg { found = c; break }
        }
        if found == nil { return nil, false }
        cur = found
    }
    return cur, true
}
```

```
BenchmarkConfigLookup-8   300000   4200 ns/op   96 B/op   2 allocs/op  // depth 4, fanout 50
```

<details><summary>After</summary>

Index children by name lazily on first lookup.

```go
type Node struct {
    Kind     Kind
    Name     string
    Children []*Node
    byName   map[string]*Node // lazily built; nil if never indexed
}

func (n *Node) child(name string) (*Node, bool) {
    if n.byName == nil && len(n.Children) > 8 {
        n.byName = make(map[string]*Node, len(n.Children))
        for _, c := range n.Children { n.byName[c.Name] = c }
    }
    if n.byName != nil { c, ok := n.byName[name]; return c, ok }
    for _, c := range n.Children { // fall through for small fanouts
        if c.Name == name { return c, true }
    }
    return nil, false
}
```

```
BenchmarkIndexedLookup-8   2000000   650 ns/op   96 B/op   2 allocs/op
```

~6× faster on the indexed path; identical to linear when fanout ≤ 8.

**Why faster:** Linear scan was 25 comparisons average per segment; map is one hash + bucket walk. The threshold of 8 reflects that a string-compare loop in cache beats a map allocation for small N.
**Trade-off:** ~80 B per indexed map entry. Index must be invalidated when children change — `Add`/`Remove` updates both `Children` and `byName`. Read-mostly config: fine. Streaming-built trees: invalidation tax adds up.
**When NOT:** Trees walked in order, not by name (AST visitors). Fanouts uniformly small (< 8). Trees rebuilt per request — amortization fails.
</details>

---

## 8. Exercise 7 — Pointer-tangled tree with `NextSibling`/`PrevSibling`

A DOM-style Composite (modeled on `golang.org/x/net/html.Node`) uses `Parent`, `FirstChild`, `NextSibling`, `PrevSibling` pointers. Each node is its own heap allocation; sibling iteration chases pointers across the heap.

```go
type Node struct {
    Parent, FirstChild, NextSibling, PrevSibling *Node
    Data string
}

func walkSiblings(parent *Node, fn func(*Node)) {
    for c := parent.FirstChild; c != nil; c = c.NextSibling { fn(c) }
}
```

```
BenchmarkPointerSiblings-8   5000   320000 ns/op   0 B/op   0 allocs/op  // 50k nodes
```

<details><summary>After</summary>

Contiguous `[]Node` arena; reference parents/children/siblings by `int32` index. Sibling iteration becomes sequential memory access.

```go
type NodeIdx int32
const NoNode NodeIdx = -1

type Node struct {
    Parent, FirstChild, NextSib NodeIdx
    Data string
}

type Tree struct{ nodes []Node }

func (t *Tree) walkSiblings(parent NodeIdx, fn func(NodeIdx)) {
    for c := t.nodes[parent].FirstChild; c != NoNode; c = t.nodes[c].NextSib {
        fn(c)
    }
}
```

```
BenchmarkIndexSiblings-8   11000   140000 ns/op   0 B/op   0 allocs/op
```

~2.3× faster.

**Why faster:** The original chases pointers to arbitrary heap addresses; the prefetcher can't predict them. The indexed version dereferences into a contiguous slice — sequential access hits cache lines already prefetched. Node size drops from 40 B to 24 B, packing more nodes per cache line.
**Trade-off:** Indices are stable only if the slice doesn't reallocate — pre-size or freeze the tree post-build. Removing a node leaves a tombstone (or requires compaction). Loses cross-tree node sharing. `n.FirstChild.Data` becomes `t.nodes[t.nodes[n].FirstChild].Data`; wrap in helpers.
**When NOT:** Trees needing cross-tree references or persistent node identity across mutations. Trees mutated heavily — index churn outweighs cache wins. Public APIs where `*Node` is part of the contract.
</details>

---

## 9. Exercise 8 — Concurrent walk with a channel per node

A parallel walker sends every node through a channel to a worker pool. Per-node send/receive is ~150 ns and contends on the channel's lock.

```go
func ParallelWalk(root Node, fn func(Node)) {
    ch := make(chan Node, 64)
    var wg sync.WaitGroup
    for i := 0; i < runtime.GOMAXPROCS(0); i++ {
        wg.Add(1)
        go func() { defer wg.Done(); for n := range ch { fn(n) } }()
    }
    var enqueue func(Node)
    enqueue = func(n Node) {
        ch <- n
        for _, c := range n.Children() { enqueue(c) }
    }
    enqueue(root); close(ch); wg.Wait()
}
```

```
BenchmarkChannelPerNode-8   200   7800000 ns/op   1200000 B/op   50000 allocs/op  // 50k nodes
```

<details><summary>After</summary>

Fan-out worker pool seeded with the root's children. Each worker pulls a *subtree* and walks it locally. Channel sees subtree roots only.

```go
func ParallelWalk(root Node, fn func(Node)) {
    work := make(chan Node, runtime.GOMAXPROCS(0))
    var wg sync.WaitGroup
    walkLocal := func(n Node) { // iterative DFS, no channel per node
        stack := []Node{n}
        for len(stack) > 0 {
            x := stack[len(stack)-1]; stack = stack[:len(stack)-1]
            fn(x)
            kids := x.Children()
            for i := len(kids) - 1; i >= 0; i-- { stack = append(stack, kids[i]) }
        }
    }
    for i := 0; i < runtime.GOMAXPROCS(0); i++ {
        wg.Add(1)
        go func() { defer wg.Done(); for n := range work { walkLocal(n) } }()
    }
    fn(root)
    for _, c := range root.Children() { work <- c }
    close(work); wg.Wait()
}
```

```
BenchmarkFanOutSubtrees-8   2400   470000 ns/op   4096 B/op   8 allocs/op
```

~16× faster, ~6000× fewer allocations.

**Why faster:** Channel ops drop from 50k to ~root.fanout. Each worker walks a subtree with a cache-friendly local stack. No cross-goroutine traffic per node; `fn` runs in parallel across subtrees.
**Trade-off:** Imbalanced trees (one huge subtree) leave workers idle. Mitigate with work stealing or split subtrees on overflow. `fn` must be safe to run concurrently.
**When NOT:** Tiny trees (< 100 nodes) — parallelism overhead dominates. Heavily skewed trees with no rebalancing. `fn` mutating shared state without locking — single-threaded walk is simpler.
</details>

---

## 10. Exercise 9 — `json.Marshal` of a 100 MB tree

`json.Marshal` builds the entire output in a `[]byte` before returning. Peak memory doubles (tree + serialized form), and the GC sees a multi-MB allocation.

```go
func WriteTree(w io.Writer, root *Node) error {
    data, err := json.Marshal(root)
    if err != nil { return err }
    _, err = w.Write(data); return err
}
```

```
BenchmarkMarshalAll-8   2   640000000 ns/op   120000000 B/op   850000 allocs/op  // 100 MB tree
```

<details><summary>After</summary>

Stream JSON manually, writing each subtree as it's emitted. Peak memory stays bounded.

```go
func WriteTree(w io.Writer, n *Node) error {
    io.WriteString(w, `{"name":`)
    nameBytes, _ := json.Marshal(n.Name)
    w.Write(nameBytes)
    if len(n.Children) > 0 {
        io.WriteString(w, `,"children":[`)
        for i, c := range n.Children {
            if i > 0 { io.WriteString(w, ",") }
            if err := WriteTree(w, c); err != nil { return err }
        }
        io.WriteString(w, `]`)
    }
    _, err := io.WriteString(w, `}`); return err
}
```

```
BenchmarkStream-8   10   140000000 ns/op   1600000 B/op   50000 allocs/op
```

~4.5× faster, ~75× less peak memory.

**Why faster:** `json.Marshal` builds the full result in a `bytes.Buffer` that grows to 100 MB — multiple realloc/copy cycles. Streaming writes go straight to the destination. Skipping reflection on the known schema removes per-node `reflect.Value` materialization.
**Trade-off:** Streaming output cannot be retried mid-tree — partial bytes already left the writer. Manual streaming duplicates JSON syntax knowledge — easy to mis-escape. Pair with a fuzz test that round-trips through `json.Unmarshal`.
**When NOT:** Small trees (< 1 MB) where the doubled allocation is invisible. Code that must retry on error. Schema changes coming — manual streaming locks in the shape.
</details>

---

## 11. Exercise 10 — Naive O(n²) tree diff

A reconciler computes the structural diff of two trees by checking, for each node in tree A, whether tree B contains an isomorphic subtree. Naive: for every (a, b) pair, recursively compare — O(n²) at best.

```go
func equalSubtree(a, b *Node) bool {
    if a.Kind != b.Kind || a.Name != b.Name || len(a.Children) != len(b.Children) { return false }
    for i := range a.Children {
        if !equalSubtree(a.Children[i], b.Children[i]) { return false }
    }
    return true
}

func findMoves(oldTree, newTree *Node) []Move {
    var moves []Move
    var visit func(*Node)
    visit = func(n *Node) {
        for _, m := range allNodes(newTree) {
            if equalSubtree(n, m) { moves = append(moves, Move{n, m}); break }
        }
        for _, c := range n.Children { visit(c) }
    }
    visit(oldTree); return moves
}
```

```
BenchmarkNaiveDiff-8   5   240000000 ns/op   400000 B/op   8000 allocs/op  // 1000 nodes
```

<details><summary>After</summary>

Hash each subtree bottom-up: `H(kind, name, child_hashes...)`. Equal subtrees collide. Lookup is O(1) per node.

```go
func computeHash(n *Node) uint64 {
    h := fnv.New64a()
    binary.Write(h, binary.LittleEndian, n.Kind)
    h.Write([]byte(n.Name))
    for _, c := range n.Children { binary.Write(h, binary.LittleEndian, computeHash(c)) }
    return h.Sum64()
}

func findMoves(oldTree, newTree *Node) []Move {
    newIndex := map[uint64]*Node{}
    var index func(*Node)
    index = func(n *Node) { newIndex[computeHash(n)] = n; for _, c := range n.Children { index(c) } }
    index(newTree)
    var moves []Move
    var visit func(*Node)
    visit = func(n *Node) {
        if m, ok := newIndex[computeHash(n)]; ok {
            moves = append(moves, Move{n, m}); return // whole subtree matched
        }
        for _, c := range n.Children { visit(c) }
    }
    visit(oldTree); return moves
}
```

```
BenchmarkHashedDiff-8   1200   980000 ns/op   140000 B/op   3000 allocs/op
```

~245× faster on 1000-node trees; cleaner asymptotic (O(n) hashing + O(n) lookups).

**Why faster:** Naive did O(n²) subtree compares of average size O(n) — effectively O(n³) worst case. Hashed visits each node once for hashing, once for lookup. React's reconciler uses a similar trick keyed on stable IDs.
**Trade-off:** Hash collisions are astronomically rare with FNV-64 but possible. Verify with `equalSubtree` after match if correctness is critical. `binary.Write` allocs — use `binary.LittleEndian.AppendUint64` instead. Memoize `computeHash` on the node in production.
**When NOT:** Diff computed once per minute — naive is simpler. Tree has unique IDs per node — compare by ID directly. Edits dominated by small changes — Myers-style edit distance may be tighter.
</details>

---

## 12. Exercise 11 — Visitor allocating a closure per call

A traversal builds a per-node closure capturing local state. Each `Walk(root, func(n Node) { ... })` heap-allocates the closure because the `func` escapes through `Walk`. A watcher calling `Walk` 10k times per scan churns 240 KB/s of garbage.

```go
func CountFiles(root Node) int {
    count := 0
    Walk(root, func(n Node) { // closure escapes — heap alloc
        if _, ok := n.(*File); ok { count++ }
    })
    return count
}
```

```
BenchmarkClosureVisitor-8   500000   2400 ns/op   24 B/op   1 allocs/op  // per Walk call
```

<details><summary>After</summary>

Define a Visitor struct once; reuse across walks. Method dispatch is monomorphic per visitor type, and no closure escapes.

```go
type Visitor interface{ Visit(n Node) (descend bool) }

func Walk(n Node, v Visitor) {
    if !v.Visit(n) { return }
    for _, c := range n.Children() { Walk(c, v) }
}

type FileCounter struct{ Count int }
func (fc *FileCounter) Visit(n Node) bool {
    if _, ok := n.(*File); ok { fc.Count++ }
    return true
}

func CountFiles(root Node) int { fc := FileCounter{}; Walk(root, &fc); return fc.Count }
```

```
BenchmarkStructVisitor-8   800000   1500 ns/op   0 B/op   0 allocs/op
```

~1.6× faster, allocation eliminated.

**Why faster:** `FileCounter` lives on the stack of `CountFiles`; `&fc`'s escape stops at `Walk`. No closure header materializes on the heap. The visitor's `Visit` is monomorphic at the call site if `Walk` is generic over visitor type.
**Trade-off:** More boilerplate — every traversal needs a named visitor type. State natural in a closure (`count`) becomes a struct field. Generic variant: `func WalkF[V Visitor](n Node, v V)` to fully monomorphize.
**When NOT:** One-shot walks where 24 B is invisible. Quick scripts where readability beats savings. Closures capturing complex state — the visitor struct grows the same way; the closure form is shorter.
</details>

---

## 13. Exercise 12 — `ast.Walk` on a hot lint path

A linter uses `ast.Walk(visitor, file)`. The interface requires `Visit(ast.Node) ast.Visitor` — returning a new visitor per node. Each call materializes an iface header on the return path.

```go
type printlnFinder struct{}

func (p printlnFinder) Visit(n ast.Node) ast.Visitor {
    if call, ok := n.(*ast.CallExpr); ok {
        if sel, ok := call.Fun.(*ast.SelectorExpr); ok && sel.Sel.Name == "Println" {
            report(call)
        }
    }
    return p // returning iface per node
}

ast.Walk(printlnFinder{}, file)
```

```
BenchmarkAstWalk-8   200   6200000 ns/op   180000 B/op   3000 allocs/op  // 50-file pkg
```

<details><summary>After</summary>

`ast.Inspect` takes `func(ast.Node) bool` — a single closure, no per-node visitor return.

```go
ast.Inspect(file, func(n ast.Node) bool {
    if call, ok := n.(*ast.CallExpr); ok {
        if sel, ok := call.Fun.(*ast.SelectorExpr); ok && sel.Sel.Name == "Println" {
            report(call)
        }
    }
    return true
})
```

```
BenchmarkAstInspect-8   280   4400000 ns/op   72000 B/op   900 allocs/op
```

~1.4× faster, ~2.5× less garbage.

**Why faster:** `ast.Walk` boxes the returned `ast.Visitor` per node. `ast.Inspect` internally wraps the closure in a single visitor instance — the closure is allocated once at the top, not per visit. The bool return avoids iface header construction on the hot return path.
**Trade-off:** `ast.Inspect` can't vary descent behavior beyond yes/no — no per-subtree visitor switch. Most linters don't need it; state-machine visitors do. Beware of capturing huge state through `ast.Inspect` if called many times.
**When NOT:** Visitors that legitimately need to return a different visitor per subtree (switching modes when entering a function body). Tools needing the pre/post hook of `Walk`. Code where explicit visitor types beat marginal speed.
</details>

---

## 14. When NOT to optimize

Composite cost dominates only when traversal is on the hot path of a high-frequency operation. If your tree is walked once per minute (config reload, periodic report), every optimization here is irrelevant: one-shot AST walks in a CLI tool, filesystem scans triggered by user action, test fixtures built per case — Composite cost is dwarfed by surrounding work.

**Profile first.** Composite overhead has four signatures in a CPU profile: `runtime.mallocgc` on a hot stack → Ex. 2 or 5; `runtime.morestack_noctxt` on traversal → Ex. 1; `runtime.convI2I` per node → Ex. 3 or 11; `runtime.mapaccess2_faststr` on a tree walk → Ex. 7 (or reconsider whether you're using the tree as a map).

**Common premature optimizations:** iterative `Walk` (Ex. 1) on trees of depth < 32; arena (Ex. 5) on trees < 1k nodes; index-by-name (Ex. 7) when fanout averages < 8; contiguous index tree (Ex. 8) when sibling iteration isn't a hotspot; hash diff (Ex. 10) on trees diffed once per session.

**Correctness gaps disguised as optimizations:** returning the underlying `Children` slice (Ex. 2) without documenting "do not mutate"; tagged struct (Ex. 3) without exhaustiveness checks — a new `Kind` falls through silently; pruned `ast.Inspect` (Ex. 4) that skips a category the linter was supposed to cover; arena (Ex. 5) where a pointer escapes the arena's lifetime — UAF returning garbage; cached child index (Ex. 7) where `Add`/`Remove` forgot to update the map; indexed tree (Ex. 8) where slice growth invalidates pointers callers held; fan-out walk (Ex. 9) calling a non-thread-safe `fn`; streaming JSON (Ex. 9) that doesn't flush on error; hash diff (Ex. 10) without collision fallback — two different subtrees treated as identical; struct visitor (Ex. 11) reused across concurrent walks.

---

## 15. Summary

**Always-ship wins** (default in any new Composite code): return the underlying `Children` slice with a "do not mutate" doc (Ex. 2); `return false` from `ast.Inspect` for subtrees that can't contain the target (Ex. 4); hoist tree lookups out of hot loops; prefer `ast.Inspect` over `ast.Walk` for closure-style traversals (Ex. 12); stable identity (`Name`, `ID`) on nodes — not pointer equality — when reconciling across rebuilds.

**Wins behind a profile** (when measurements justify them): iterative `Walk` (Ex. 1, when `morestack` shows); tagged-struct (Ex. 3, when `convI2I` shows); arena allocation (Ex. 5, when `mallocgc` shows in parse paths); indexed children (Ex. 7, when linear scan in `Children` shows); contiguous-slice tree (Ex. 8, when pointer-chase stalls show); fan-out worker pool (Ex. 9, when single-threaded walk is CPU-bound and tree is balanced); streaming JSON (Ex. 9, when peak memory matters); hashed subtree diff (Ex. 10, when reconciliation is on a request path); struct visitor (Ex. 11, when closure-per-walk shows in alloc profiles).

**Specialty** (only when the design calls for it): custom arena with per-chunk freezing for parsers with millions of nodes per parse; slice-of-Node-as-DOM for game scene graphs and AST batch transforms; bottom-up hash diff with collision fallback for VDOM reconcilers and structural search; work-stealing parallel walk for heavily skewed trees with deep subtree workloads.

Composite cost is dispatch, allocation, depth, and cache misses. Strip those four from the read path by choosing the right primitive: pure-interface for ergonomic typed analysis; tagged-struct for tight memory and switch dispatch; arena for parse-heavy paths; indexed slices for cache-friendly siblings. The pattern itself is cheap — the wins come from matching the traversal shape to the tree shape. Profile, then pick the lever; the four signatures above tell you which one.
