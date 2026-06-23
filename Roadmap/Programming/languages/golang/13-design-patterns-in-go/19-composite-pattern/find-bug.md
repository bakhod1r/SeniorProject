# Composite — Find the Bug

## 1. How to use this file

Fifteen buggy snippets of Composite-pattern code in Go: tree node interfaces, `Walk` traversals, `go/ast`-style visitors, `fs.WalkDir` walks, tagged-struct trees with a `Kind` discriminator. Read each in 30-60 seconds, decide where the defect is, then expand `<details>` for the answer.

Composite bugs almost never crash on the happy path. They silently skip a subtree because a method forgot to recurse, blow the stack on a deep input, panic on a cycle no test built, or expose internal state that callers mutate. Three questions to ask every snippet:

1. *Does every node type contribute to the recursion correctly — both leaf and Composite?*
2. *Who owns the children slice, and what happens if it's mutated, nil, or shared?*
3. *What does the traversal do at the edges — cycles, deep trees, nil children, concurrent walkers?*

If a snippet can't answer all three, there's a bug.

---

## Bug 1 — `Folder.Size()` returns own size only (forgot to recurse)

```go
type Node interface {
    Size() int64
    Children() []Node
}

type File struct{ size int64 }
func (f *File) Size() int64      { return f.size }
func (f *File) Children() []Node { return nil }

type Folder struct {
    selfSize int64           // bookkeeping bytes for the directory entry
    children []Node
}
func (d *Folder) Children() []Node { return d.children }
func (d *Folder) Size() int64      { return d.selfSize }   // BUG
```

<details><summary>Answer</summary>

**Bug:** `Folder.Size()` returns only the folder's bookkeeping bytes — never walks `d.children`. A folder with 10 GB of files reports a few hundred bytes.

**Why subtle:** Single-file unit tests pass: `(&File{size: 100}).Size() == 100` is correct, and `(&Folder{}).Size()` returns the empty-folder constant. The bug only appears when the folder is non-empty *and* someone compares against `du`.

**Spot:** Any Composite method on the container type whose body doesn't iterate `children`. If leaf and container compute "the same kind of value" without the container summing over children, the recursion is missing.

**Fix:**

```go
func (d *Folder) Size() int64 {
    total := d.selfSize
    for _, c := range d.children {
        total += c.Size()
    }
    return total
}
```

**Why common:** When you first write Composite, `selfSize` doesn't exist — the loop *is* the body. Later someone adds overhead bookkeeping, replaces the loop body with `return d.selfSize`, and forgets that the loop was the recursion. The pattern's whole point depends on every aggregating method actually aggregating.
</details>

---

## Bug 2 — `Children()` returns `[]*Folder` instead of `[]Node`

```go
type Node interface {
    Children() []Node
}

type File struct{ name string }
func (f *File) Children() []Node { return nil }

type Folder struct {
    name    string
    subdirs []*Folder           // BUG: only sub-folders, no files
    files   []*File
}
func (d *Folder) Children() []*Folder { return d.subdirs }   // wrong return type too
```

<details><summary>Answer</summary>

**Bug:** Two compounding mistakes. (1) `Children()` returns `[]*Folder`, not `[]Node` — so `Folder` doesn't satisfy `Node` at all (Go has no covariant return types). (2) Even if it compiled, returning only `subdirs` hides every `*File` child. A generic `Walk(root, fn)` would never visit any leaf.

**Why subtle:** The compiler catches the interface mismatch *only* if you write `var _ Node = (*Folder)(nil)`. Without it, the error appears far away at the first generic call site, and the team's instinct is to write a wrapper rather than fix the signature.

**Spot:** Any Composite container whose `Children()` returns a concrete-typed slice. Same for any tree where the container holds children in *multiple* typed slices — polymorphism has leaked into storage.

**Fix:** One interface, one storage, one accessor:

```go
type Folder struct {
    name     string
    children []Node           // one slice, both *File and *Folder
}
func (d *Folder) Children() []Node { return d.children }
```

Add `var _ Node = (*Folder)(nil)` at package scope to catch interface drift on the next build.

**Why common:** "Files and folders are different things; separate fields feel organised." It is organised — and wrong for Composite. The pattern's whole point is the uniform interface.
</details>

---

## Bug 3 — Mutating the children slice during `range`

```go
func (d *Folder) PurgeEmpty() {
    for i, c := range d.children {
        if sub, ok := c.(*Folder); ok && len(sub.children) == 0 {
            d.children = append(d.children[:i], d.children[i+1:]...)  // BUG
        }
    }
}
```

<details><summary>Answer</summary>

**Bug:** `for i, c := range d.children` captures the slice header *once*, at the start. Mutating `d.children` mid-loop shifts later elements left, but `i` keeps advancing — so the loop *skips* the element that just moved into position `i`. With two adjacent empty folders, the second survives.

**Why subtle:** It looks correct for one match. A test with one empty folder passes. The bug is visible only when two or more deletions happen, and even then the survivor depends on adjacency.

**Spot:** Any forward `range` whose body contains `append(s[:i], s[i+1:]...)`, `s = append(s, ...)`, or `delete(s, k)` on the same slice/map. Same trap with maps under `for k := range m` plus `delete(m, k')` for a *different* key.

**Fix:** Iterate backwards, build a filtered copy, or use `slices.DeleteFunc` (Go 1.21+) which encodes the pattern correctly:

```go
// backward
for i := len(d.children) - 1; i >= 0; i-- {
    if sub, ok := d.children[i].(*Folder); ok && len(sub.children) == 0 {
        d.children = append(d.children[:i], d.children[i+1:]...)
    }
}

// or: d.children = slices.DeleteFunc(d.children, isEmptyFolder)
```

**Why common:** Forward iteration is the default mental model. Deleting feels like "drop this one and keep going" — but the slice shift breaks the "keep going" half. The bug rarely surfaces with one delete, and one delete is the common test case.
</details>

---

## Bug 4 — Cycle in tree causes infinite recursion

```go
func (d *Folder) Size() int64 {
    var total int64
    for _, c := range d.children {
        total += c.Size()
    }
    return total
}

// elsewhere
a, b := &Folder{name: "a"}, &Folder{name: "b"}
a.children = append(a.children, b)
b.children = append(b.children, a)    // cycle
_ = a.Size()                          // recurses forever
```

<details><summary>Answer</summary>

**Bug:** `Add` accepts any `Node` with no cycle check. The moment two folders reference each other, `Size()` recurses `a -> b -> a -> b -> ...` until the goroutine stack overflows. Same for `Walk` and any operation that touches every node.

**Why subtle:** Trees built from disk, AST parsers, or one-shot constructors never form cycles. Trees built from runtime config, plugin graphs, or hot-reloaded YAML occasionally do. The crash is loud, but the input that caused it is rare unless you can produce it deterministically.

**Spot:** Any tree where `Add` can take an arbitrary `Node`, especially one already in the tree or assembled from external input. Without an "is `c` already reachable from `d`?" check, cycles are physically possible.

**Fix:** Either guarantee acyclicity at construction (validate in `Add`), or carry a visited set through traversal:

```go
func (d *Folder) Size() int64 {
    return sizeWith(d, map[Node]bool{})
}
func sizeWith(n Node, seen map[Node]bool) int64 {
    if seen[n] { return 0 }
    seen[n] = true
    var total int64
    for _, c := range n.Children() {
        total += sizeWith(c, seen)
    }
    return total
}
```

Cleanest: separate `Graph` (can cycle) from `Tree` (cannot). If the domain is genuinely tree-shaped, document and trust. If it isn't, model as a DAG and defend.

**Why common:** "It's a tree" is the spec. "It's a tree as long as no caller closes a loop" is the reality. Composite literature uses "tree" loosely; production code needs the stronger guarantee.
</details>

---

## Bug 5 — Stack overflow on deep tree (recursion-only `Walk`)

```go
func Walk(n Node, fn func(Node)) {
    fn(n)
    for _, c := range n.Children() {
        Walk(c, fn)               // recurses to depth O(tree height)
    }
}

// caller
root := buildFromYAML(deeplyNestedConfig)   // 100k levels
Walk(root, func(n Node) { ... })            // stack overflow
```

<details><summary>Answer</summary>

**Bug:** Pure recursive `Walk` consumes one Go stack frame per node along the deepest path. Default goroutine stacks grow, but cap at 1 GB. Deep trees — generated configs, attacker-crafted JSON, pathological AST — hit it and crash with `runtime: goroutine stack exceeds`.

**Why subtle:** Test trees are shallow. Real trees can be deep when produced by repetitive transformations or hostile input. The crash is rare but unrecoverable — the panic is fatal, not catchable.

**Spot:** Any `Walk`/`Visit`/`Render` that recurses without an iterative alternative, on a tree whose depth could be controlled by external input.

**Fix:** Offer an iterative variant using an explicit stack:

```go
func WalkIter(root Node, fn func(Node)) {
    stack := []Node{root}
    for len(stack) > 0 {
        n := stack[len(stack)-1]; stack = stack[:len(stack)-1]
        fn(n)
        kids := n.Children()                            // push in reverse for original order
        for i := len(kids) - 1; i >= 0; i-- { stack = append(stack, kids[i]) }
    }
}
```

For untrusted input, validate depth at parse time. For trusted-but-deep input, the iterative form is enough.

**Why common:** Recursion is the most readable expression of tree traversal. It's correct for 99.9% of inputs and catastrophic for 0.1%. The fix isn't to remove recursion universally — it's to *offer* the iterative form and use it where depth is suspect.
</details>

---

## Bug 6 — Nil child in slice causes nil pointer dereference

```go
func (d *Folder) Add(n Node) {
    d.children = append(d.children, n)   // BUG: accepts nil
}

func Walk(n Node, fn func(Node)) {
    fn(n)
    for _, c := range n.Children() {
        Walk(c, fn)                       // panics if c is nil
    }
}

// caller
parent := loadFromJSON(payload)           // some entries decoded as nil
walk.Walk(parent, printer)                // nil pointer dereference inside Walk
```

<details><summary>Answer</summary>

**Bug:** `Add` accepts nil. The slice stores it. `Walk` calls `fn(nil)`, then asks `nil.Children()` — nil pointer dereference. The stack points inside `Walk`, far from whatever planted the nil.

**Why subtle:** Test fixtures never contain nil children. Production paths decoding JSON, Protobuf `oneof`, or `if x != nil { add }` branches can plant nil through one upstream bug. The crash surfaces in `Walk`; the registration site is invisible.

**Spot:** Any `Add(n Node)` whose body is `append(d.children, n)` with no nil-check, paired with `Children()` consumers that don't guard `if c == nil`. Either-side defence is fine; *both* missing is the bug.

**Fix:** Reject at registration — Composite's analog of `sql.Register`'s nil check:

```go
func (d *Folder) Add(n Node) {
    if n == nil {
        panic(fmt.Sprintf("Folder %q: Add nil node", d.name))
    }
    d.children = append(d.children, n)
}
```

**Why common:** "Maybe it's OK to add nothing" reads like a feature. It isn't — Composite's traversal contract assumes every element is a valid `Node`.
</details>

---

## Bug 7 — Visitor returns nil to stop, but `Walk` doesn't check

```go
type Visitor interface {
    Visit(n Node) Visitor    // contract: return nil to stop descent on this subtree
}

func Walk(n Node, v Visitor) {
    v.Visit(n)                         // BUG: return value ignored
    for _, c := range n.Children() {
        Walk(c, v)
    }
}
// caller's Visit returns nil at ErrorNode expecting Walk to stop — it doesn't.
```

<details><summary>Answer</summary>

**Bug:** The contract — borrowed from `go/ast.Walk` — is "return nil to skip the subtree". `Walk` here discards the return value and descends unconditionally. For analyses that early-out on errors, every node still gets visited, producing spurious errors after the first.

**Why subtle:** Result is "more output than expected", not "wrong output". Tests that count visits catch it; tests asserting on the final report don't. The visitor *interface* compiles correctly because the return type matches; only the *implementation* of `Walk` is wrong.

**Spot:** Any `Walk`/`Inspect`/`Traverse` whose body is a bare `v.Visit(n)` rather than `next := v.Visit(n)` plus conditional descent.

**Fix:** Honour the return value:

```go
func Walk(n Node, v Visitor) {
    next := v.Visit(n)
    if next == nil { return }
    for _, c := range n.Children() {
        Walk(c, next)
    }
}
```

Note the descent uses `next`, not `v` — visitors can change themselves for the subtree (push context, swap behaviour). Preserve the contract even if you don't use it.

**Why common:** "Of course it descends — that's what Walk does." The skip-subtree contract is easy to forget when copying just the *shape* of the visitor pattern.
</details>

---

## Bug 8 — Concurrent `Walk` with shared mutable state (data race)

```go
func Walk(n Node, fn func(Node)) {
    fn(n)
    for _, c := range n.Children() {
        c := c
        go Walk(c, fn)                 // BUG: parallel descent
    }
}

// caller
var found []*File
walk.Walk(root, func(n Node) {
    if f, ok := n.(*File); ok {
        found = append(found, f)        // unsynchronised
    }
})
```

<details><summary>Answer</summary>

**Bug:** Two problems compound. (1) Parallel `Walk` writes to `found` from many goroutines without a lock — `-race` reports a race, and under load the slice loses updates or corrupts its header. (2) The parent `Walk` doesn't wait for spawned goroutines — by the time it returns, half the subtrees haven't been visited. The caller reads `found` and gets a partial result.

**Why subtle:** Tests pass when the tree is small and goroutines finish before the assertion runs. Manifests as flaky CI or missing results in production.

**Spot:** Any `Walk` whose loop body is `go Walk(...)` without a `wg.Add`/`wg.Done`. Any visitor closure that captures shared state without a `sync.Mutex` or channel.

**Fix:** Keep `Walk` sequential (usually fast enough), or do parallelism explicitly with `errgroup`, a semaphore, and synchronised state — use a `WaitGroup` to wait for completion and a mutex (or single-reader channel) for the shared collector. Naked `go` per child gives neither.

**Why common:** "Just add `go`" looks like an obvious speedup. Visitor closures are exactly the kind of state that doesn't tolerate concurrent writes. Parallel traversal is a real optimisation; "sprinkle `go`" is not how.
</details>

---

## Bug 9 — `Children()` exposes the internal slice; caller mutates it

```go
func (d *Folder) Children() []Node { return d.children }   // BUG: shares backing array

// caller
kids := folder.Children()
kids = append(kids, newFile)        // may write into folder's backing array (or not)
sort.Slice(kids, func(i, j int) bool { ... })   // reorders folder.children too
```

<details><summary>Answer</summary>

**Bug:** `Children()` returns the underlying slice. Callers sort, reverse, `append` within cap, or assign `kids[0] = nil` and silently mutate the `Folder`. `append` is especially perverse: if there's spare capacity, it writes in place; if not, it reallocates — the mutation is sometimes visible to the `Folder` and sometimes not. Heisenbug.

**Why subtle:** Reading is correct. Mutating is correct *in the caller's view* — the slice is theirs. The shared-storage truth is invisible from the call site.

**Spot:** Any accessor returning a slice or map field directly without copying.

**Fix:** Copy on the way out:

```go
func (d *Folder) Children() []Node {
    out := make([]Node, len(d.children))
    copy(out, d.children)
    return out
}
```

Alternatives: a range-over-func iterator (Go 1.23+), or documented read-only contract. Documentation is weaker than encapsulation; pick it only when allocation is a hot path.

**Why common:** "Just return the slice" is the shortest implementation. The cost is paid by whoever debugs the mysterious sort-order-changes bug six months later.
</details>

---

## Bug 10 — Loop variable capture in goroutine spawn (pre-Go-1.22)

```go
// Compile with Go 1.21 or earlier — this pattern was the famous Go gotcha.
func SpawnPerChild(n Node) {
    for _, c := range n.Children() {
        go func() {
            process(c)               // BUG: c is loop variable, captured by reference
        }()
    }
}
```

<details><summary>Answer</summary>

**Bug:** Pre-Go-1.22, the loop variable `c` was declared *once* per loop and reused. All spawned goroutines closed over the same variable; by the time they ran, the loop had finished and `c` held the last value. Every goroutine processed the *last* child. Go 1.22 changed the semantics; pre-1.22 binaries (or `go.mod` at `go 1.21`) still see the old behaviour.

**Why subtle:** Scheduler-dependent. With many children and a fast body, goroutines often catch each `c` value in flight and the bug *looks* fixed. Under load or with sleep, every goroutine reads the final value. CI passes; production drops every child but the last.

**Spot:** Any `for _, x := range ... { go func() { ... x ... }() }` with no shadowing. `go vet` flags it.

**Fix:** Shadow explicitly (`c := c` inside the loop), or take as a parameter (`go func(c Node) { process(c) }(c)`).

Both are safe on any Go version. Updating `go.mod` to `go 1.22+` also fixes it, but mechanically rewriting to an explicit form is cheaper than enforcing a version floor.

**Why common:** The most famous Go gotcha for a decade. Composite traversals are a natural place to encounter it — spawning a goroutine per child is exactly the operation that exposes the capture.
</details>

---

## Bug 11 — JSON unmarshal into `Node` interface needs custom `UnmarshalJSON`

```go
type Node interface{ kind() string }

type File   struct{ Name string; Size int64 }
func (*File) kind() string   { return "file" }

type Folder struct{ Name string; Children []Node }
func (*Folder) kind() string { return "folder" }

// caller
var root Folder
err := json.Unmarshal(payload, &root)   // BUG: Children unmarshals as []interface{}, all nil
```

<details><summary>Answer</summary>

**Bug:** `encoding/json` cannot pick a concrete type for an interface field. When the decoder hits `Children []Node`, it has no rule for which concrete type each element should be — `Node` has no exported fields, so the decoder fills each element with `nil`. The decoded tree has children-shaped holes everywhere.

**Why subtle:** No error returned. `len(root.Children)` matches the array length. Each entry is `nil`. The first call to `c.kind()` panics. Looks like "Walk crashed", not "decoder did nothing".

**Spot:** Any struct with an interface-typed field being JSON-unmarshalled. `encoding/gob` handles interface roundtrip via `gob.Register`; `encoding/json` requires custom discrimination.

**Fix:** Write `UnmarshalJSON` that reads a discriminator from each child as `json.RawMessage`, dispatches on a `"kind"` field, and decodes into the matching concrete type:

```go
func (d *Folder) UnmarshalJSON(data []byte) error {
    var raw struct {
        Name     string            `json:"name"`
        Children []json.RawMessage `json:"children"`
    }
    if err := json.Unmarshal(data, &raw); err != nil { return err }
    d.Name = raw.Name
    for _, rm := range raw.Children {
        var head struct{ Kind string `json:"kind"` }
        if err := json.Unmarshal(rm, &head); err != nil { return err }
        switch head.Kind {
        case "file":   var f File;   _ = json.Unmarshal(rm, &f); d.Children = append(d.Children, &f)
        case "folder": var sub Folder; _ = json.Unmarshal(rm, &sub); d.Children = append(d.Children, &sub)
        default: return fmt.Errorf("unknown kind %q", head.Kind)
        }
    }
    return nil
}
```

Or sidestep: use the tagged-struct form for anything that crosses a wire — `yaml.v3.Node` is the canonical example.

**Why common:** The pure-interface form is the cleanest Composite. Serialization bites: `encoding/json` is structural, and interfaces have no structure to decode against.
</details>

---

## Bug 12 — `fs.WalkDir` error swallowed by returning `nil`

```go
func WalkSize(root string) (int64, error) {
    var total int64
    err := fs.WalkDir(os.DirFS(root), ".", func(path string, d fs.DirEntry, err error) error {
        if err != nil {
            log.Printf("walk: %v", path, err)
            return nil                      // BUG: swallows err, walk continues
        }
        if d.IsDir() { return nil }
        info, _ := d.Info()                 // BUG: second swallowed error
        total += info.Size()
        return nil
    })
    return total, err
}
```

<details><summary>Answer</summary>

**Bug:** Two swallows. (1) `fs.WalkDir` calls WalkDirFunc with a non-nil `err` to *report* a per-entry error (permission denied, broken symlink). Returning `nil` says "keep going" past the failed entry; the final returned `err` is `nil` even though subtrees were skipped. (2) `d.Info()` returns `(FileInfo, error)`; ignoring it treats inaccessible entries as size zero. Total is an underestimate with no signal it's wrong.

**Why subtle:** The function returns successfully. The number is *almost* right. No log of which path failed because the format string is wrong too.

**Spot:** Any `WalkDirFunc` whose body returns bare `nil` on the error branch. Any inner error discarded with `_`. `errcheck` flags both.

**Fix:** Propagate, or return `fs.SkipDir` to skip-but-not-abort:

```go
err := fs.WalkDir(os.DirFS(root), ".", func(path string, d fs.DirEntry, err error) error {
    if err != nil {
        // Choose: abort the walk, skip this entry, or skip this directory.
        return fmt.Errorf("walk %s: %w", path, err)
    }
    if d.IsDir() { return nil }
    info, err := d.Info()
    if err != nil { return fmt.Errorf("stat %s: %w", path, err) }
    total += info.Size()
    return nil
})
```

If permission-denied is OK to skip, return `fs.SkipDir` and log — that's the explicit, auditable choice. Bare `nil` says "I didn't think about this".

**Why common:** `WalkDirFunc`'s three-arg signature with the error in the *third* position invites the happy path first with error handling as an afterthought — and "afterthought" is often `return nil`.
</details>

---

## Bug 13 — Parent pointer not updated after `Add`; upward traversal breaks

```go
type Node interface {
    Parent() Node
    Children() []Node
}

type Folder struct {
    parent   Node
    children []Node
}

func (d *Folder) Parent() Node { return d.parent }
func (d *Folder) Add(n Node)   { d.children = append(d.children, n) }   // BUG

// caller wants "what folder am I in?"
for p := someFile.Parent(); p != nil; p = p.Parent() { /* always nil */ }
```

<details><summary>Answer</summary>

**Bug:** `Add` registers the child in the parent's slice but doesn't tell the child who its parent is. Downward traversal works. Any algorithm walking *up* (path-to-root, scope resolution, error reporting) breaks because `Parent()` returns `nil` for every `Add`ed node.

**Why subtle:** Build-and-walk-down tests pass. The fail surfaces in diagnostics: "in folder /" instead of "in folder /a/b/c".

**Spot:** Any tree with a `Parent` accessor whose `Add` doesn't set it. Cross-check: `child.parent = parent` should appear inside the same operation that appends `child` to `parent.children`.

**Fix:** Set/clear the parent pointer atomically with the slice mutation — `Add` calls `child.setParent(d)` before append, `Remove` calls `setParent(nil)` before the splice. Or more idiomatic: avoid parent pointers entirely. Pass the path-from-root down through traversal as a slice; the callee knows where it is. `go/ast` famously does *not* expose parent pointers — `astutil.PathEnclosingInterval` reconstructs the path on demand.

**Why common:** Parent pointers feel cheap — "just a field". They're cheap to add and expensive to maintain: every mutation must update both ends. Forgetting one end is the bug.
</details>

---

## Bug 14 — `ast.Inspect` returns `false`; caller assumed it means "continue"

```go
import "go/ast"

func findCallsTo(file *ast.File, name string) []*ast.CallExpr {
    var out []*ast.CallExpr
    ast.Inspect(file, func(n ast.Node) bool {
        call, ok := n.(*ast.CallExpr)
        if !ok { return false }            // BUG: stops descending into non-call nodes
        if id, ok := call.Fun.(*ast.Ident); ok && id.Name == name {
            out = append(out, call)
        }
        return false                       // BUG: also stops on every call
    })
    return out
}
```

<details><summary>Answer</summary>

**Bug:** `ast.Inspect`'s callback returns `bool`: `true` means "descend", `false` means "skip this subtree". This code returns `false` everywhere. The traversal visits only the root and quits. Nested calls `f(g(x))` are missed — after `f`, descent stops and `g` is never visited.

**Why subtle:** "Return false means stop walking" feels like a natural reading. Tests with one call per statement pass; nested-call tests fail.

**Spot:** Any visitor callback returning `false` from the *non-matching* branch. The `bool` controls descent, not "is this the answer?". Same trap in `filepath.WalkDir` with `fs.SkipDir` vs `fs.SkipAll`.

**Fix:** Return `true` whenever descent should continue, regardless of match:

```go
ast.Inspect(file, func(n ast.Node) bool {
    call, ok := n.(*ast.CallExpr)
    if !ok { return true }                 // not a call, but keep looking
    if id, ok := call.Fun.(*ast.Ident); ok && id.Name == name {
        out = append(out, call)
    }
    return true                            // also descend into call args
})
```

To avoid recursing into matched calls (outermost-only), return `false` *only* on match — and document why.

**Why common:** The visitor `bool` is overloaded — could mean "found it", "continue", or "descend". `ast.Inspect` uses "descend"; callers often misread it as "found it". Reading the docs once is the cheapest insurance.
</details>

---

## Bug 15 — Tagged-struct with missing `Kind` switch case (silent skip)

```go
type Kind int
const (
    KindScalar Kind = iota
    KindSequence
    KindMapping
    KindAlias            // added in v2 of the schema
)

type Node struct {
    Kind     Kind
    Value    string
    Children []*Node
}

func Walk(n *Node, fn func(*Node)) {
    fn(n)
    switch n.Kind {
    case KindSequence, KindMapping:
        for _, c := range n.Children {
            Walk(c, fn)
        }
    case KindScalar:
        // no children
    // BUG: KindAlias falls through, treated as leaf; alias target never walked
    }
}
```

<details><summary>Answer</summary>

**Bug:** Tagged-struct trades static safety for serialization friendliness — the compiler can't enforce exhaustive `switch`. When `KindAlias` was added, `Walk`'s switch didn't grow. Aliases (which *do* have children — the aliased subtree) are silently treated as leaves.

**Why subtle:** Tests written before `KindAlias` still pass. New alias tests pass *if* they only check the alias node, not its target. The missing case isn't a compile error; it's a behavioural gap, invisible until someone notices the wrong count.

**Spot:** Any `switch x.Kind` without `default:`. Any kind-discriminated tree where the kind list lives in one file and switches live in dozens. `nishanths/exhaustive` flags these.

**Fix:** Add a `default` that panics:

```go
func Walk(n *Node, fn func(*Node)) {
    fn(n)
    switch n.Kind {
    case KindSequence, KindMapping, KindAlias:
        for _, c := range n.Children {
            Walk(c, fn)
        }
    case KindScalar:
        // no children
    default:
        panic(fmt.Sprintf("Walk: unknown kind %d", n.Kind))
    }
}
```

Better still: prefer the pure-interface form (Bug 2's lesson) so the compiler enforces the contract directly. Tagged-struct is right for parser/serialization roots; just pay the exhaustiveness tax.

**Why common:** Adding `KindAlias` is one line in the const block; dozens of switches need updating. Review catches the addition; nobody notices the switches that didn't change. The default-panic guard is the only sure defence.
</details>

---

## Summary

These bugs cluster into four families.

**Recursion correctness (1, 4, 5, 14, 15):** aggregating methods that forgot to recurse, cycles that run forever, deep trees that overflow the stack, `Inspect` callbacks misreading the bool contract, tagged switches silently skipping new kinds. Composite's promise is *uniform* treatment of leaf and Composite; every aggregating method must aggregate, every traversal must terminate, every dispatch must cover every case.

**Tree-structure invariants (2, 6, 13):** `Children()` returning a concrete-typed slice, nil children crashing traversal, parent pointers stale after `Add`. The contract: every child is a `Node`, every parent knows its children, every child knows its parent. One missing edge breaks every algorithm that depends on it.

**Sharing and mutation (3, 9, 10):** mutating during `range`, exposing the internal slice, capturing the loop variable in spawned goroutines. The tree is shared state with an iteration contract; violations pass tests and fail under load.

**Serialization and integration (8, 11, 12):** parallel `Walk` racing on visitor state, JSON unmarshal losing interface children, `fs.WalkDir` errors swallowed. Composite intersects with the outside world at exactly the seams where structural assumptions break down.

Review checklist for any Composite / tree-traversal / AST-walking PR:

- [ ] Does every aggregating method on the container actually iterate `Children()` rather than returning a single-node value?
- [ ] Does `Children()` return `[]Node` (an interface slice), not a concrete-typed slice that hides one branch of the tree?
- [ ] Are slice mutations on `children` done backward, via a filtered copy, or with `slices.DeleteFunc` — never `append(s[:i], s[i+1:]...)` inside a forward `range`?
- [ ] Do `Walk`/`Size` carry a visited set (or `Add` validate acyclicity), and is there an iterative variant for deep or untrusted-depth input?
- [ ] Does `Add` reject nil children, and does `Children()` either copy or document a read-only contract — never expose the backing slice?
- [ ] If a visitor has a "skip subtree" signal, does `Walk` actually check the return value? On `ast.Inspect` callbacks, is `true` returned whenever descent should continue?
- [ ] Does parallel traversal use `errgroup`/`WaitGroup`, bounded concurrency, and synchronised state — not naked `go` into a shared closure?
- [ ] Does interface-typed JSON/YAML unmarshal go through a custom `UnmarshalJSON` (or tagged-struct shim) that reads a discriminator, and does every `WalkDirFunc` propagate the third-argument error?
- [ ] If parent pointers exist, does every `Add`/`Remove`/`Move` update both ends? On tagged-struct trees, does every `switch n.Kind` end with `default: panic(...)` or use an exhaustiveness linter?
