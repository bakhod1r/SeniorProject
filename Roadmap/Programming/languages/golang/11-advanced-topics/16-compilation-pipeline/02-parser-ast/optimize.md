# Parser & AST — Optimize

Parsing is rarely the bottleneck for a single file, but tools that parse **whole module trees** (gopls, linters, codegen over `./...`) parse and hold thousands of files. Memory and wall-clock add up. This file covers where the cost is and how to cut it.

## 1. Where the time and memory go

For one `parser.ParseFile` the cost breaks down into:

| Cost | Driver |
| --- | --- |
| Scanning | proportional to source bytes (cheap, linear) |
| Tree allocation | one heap object per node — dominates allocations |
| Comment retention | `ParseComments` keeps every comment group (extra allocs + retained memory) |
| Object resolution | building `Ident.Obj` / `File.Scope` — extra work and pointers |
| Position tracking | the `FileSet` grows with every file added |

The AST itself is the big memory cost: a non-trivial file is thousands of small `*ast.*` structs, all live as long as you hold the `*ast.File`.

A rough mental model for one medium source file (a few hundred lines):

| Item | Order of magnitude |
| --- | --- |
| tokens scanned | thousands |
| AST nodes allocated | thousands of small heap objects |
| `*ast.Ident` (the most common node) | often 40–60% of nodes |
| retained bytes | dominated by node structs + their slices |

The takeaway: optimisation is mostly about (a) **not allocating** what you won't use, and (b) **not retaining** trees longer than needed.

---

## 2. `parser.SkipObjectResolution` — usually free speed

The legacy object-resolution pass populates `Ident.Obj`, `File.Scope`, and `File.Unresolved`. Most modern tools don't use it — they use `go/types` instead. Skipping it avoids work and pointers:

```go
file, _ := parser.ParseFile(fset, name, src,
	parser.SkipObjectResolution) // no Ident.Obj, faster & leaner
```

If you (or a dependency) read `Ident.Obj`, you can't skip it. But if you're doing your own resolution with `go/types`, set this. `go/packages` effectively does the equivalent. This is the single easiest win.

---

## 3. The cost of `ParseComments`

`parser.ParseComments` is not free: every comment becomes a retained `*ast.Comment`/`*ast.CommentGroup`, and the parser does extra bookkeeping to associate doc comments. If your tool **doesn't need comments**, don't ask for them:

```go
// Need comments (codemod that preserves docs):
parser.ParseComments
// Don't need comments (a counter, a type analysis):
0  // or parser.SkipObjectResolution
```

For a tool that only inspects structure (count functions, build a call graph), dropping `ParseComments` reduces both allocations and retained memory measurably across a large tree.

---

## 4. Parse only as much as you need

Several modes let you stop early when you don't need the full tree:

| Need | Mode |
| --- | --- |
| just the package name | `parser.PackageClauseOnly` |
| package + imports (dependency scan) | `parser.ImportsOnly` |
| full tree | `0` |

A tool that builds an import graph across 10,000 files should use `ImportsOnly` — it stops parsing each file right after the import block instead of building the whole body tree. Huge saving.

```go
// Dependency scan: never build function bodies.
f, _ := parser.ParseFile(fset, name, src,
	parser.ImportsOnly|parser.SkipObjectResolution)
for _, imp := range f.Imports {
	record(imp.Path.Value)
}
```

Because the parser stops early, it allocates a fraction of the nodes a full parse would. Combine the flags: there's no reason to resolve objects for an imports-only scan.

---

## 5. Reuse one FileSet

Create **one** `*token.FileSet` for the whole run and parse every file into it:

```go
fset := token.NewFileSet()
for _, name := range files {
	f, _ := parser.ParseFile(fset, name, nil, mode)
	// ...
}
```

Why: positions become globally comparable across files, and you avoid per-file allocation of new FileSets. Do **not** create a FileSet per file — you lose cross-file position comparability and pay extra allocation. (A FileSet does grow with files added; for truly enormous runs you can segment, but one-per-run is the right default.)

---

## 6. Parse packages in parallel

Parsing is CPU-bound and embarrassingly parallel **per file**. The catch: `token.FileSet` mutation (`AddFile`) must be serialised. Two safe patterns:

**A. `go/packages` does it for you.** It loads and parses packages concurrently with correct synchronisation. Prefer this for real tools.

A worker-pool shape that bounds memory while still using all cores:

```go
sem := make(chan struct{}, runtime.GOMAXPROCS(0)) // cap live trees
for _, name := range files {
	sem <- struct{}{}
	go func(name string) {
		defer func() { <-sem }()
		// parse + summarise + discard tree
	}(name)
}
```

**B. Hand-rolled with a guarded FileSet.** Parse file bytes concurrently but guard the FileSet:

```go
var mu sync.Mutex
var wg sync.WaitGroup
results := make([]*ast.File, len(files))
for i, name := range files {
	wg.Add(1)
	go func(i int, name string) {
		defer wg.Done()
		src, _ := os.ReadFile(name)
		mu.Lock()                       // FileSet is not goroutine-safe
		f, _ := parser.ParseFile(fset, name, src, mode)
		mu.Unlock()
		results[i] = f
	}(i, name)
}
wg.Wait()
```

Note the lock spans the whole `ParseFile` because the parser calls `fset.AddFile` internally. If lock contention dominates, give each worker its **own** FileSet and merge logically afterwards (you lose a single shared position space — a real tradeoff). Measure before choosing.

---

## 7. Memory: don't retain trees you don't need

ASTs are large and live as long as referenced. Strategies:

- **Stream, don't hoard.** If you process files independently (e.g. counting), parse → analyse → drop the `*ast.File` so it can be GC'd. Don't accumulate a slice of every file's AST if you only need a tally.
- **Extract a summary.** Walk each tree once, pull out the small facts you need (function names, import paths), and discard the tree.
- **Bound concurrency.** Parsing N files at once means N trees live simultaneously; a worker pool of `GOMAXPROCS` size caps peak memory.
- **`src` as `[]byte`/`string`** avoids an extra `io.Reader` copy; reading the file yourself with `os.ReadFile` is fine and explicit.

A stream-and-discard counter that never holds more than one tree at a time:

```go
total := 0
for _, name := range files {
	src, _ := os.ReadFile(name)
	f, err := parser.ParseFile(fset, name, src, parser.SkipObjectResolution)
	if err != nil { continue }
	ast.Inspect(f, func(n ast.Node) bool {
		if _, ok := n.(*ast.FuncDecl); ok { total++ }
		return true
	})
	// f goes out of scope here → eligible for GC before the next file
}
```

Contrast with appending every `f` to a slice "to analyse later" — that pins every tree in memory for the whole run.

---

## 7.5 Avoid redundant walks

Each `ast.Inspect` is a full traversal. If your tool answers several questions, don't run a separate walk per question — collect everything in **one** pass:

```go
// Bad: three full traversals.
countFuncs(file)
countCalls(file)
findTODOs(file)

// Good: one traversal, dispatch by type.
ast.Inspect(file, func(n ast.Node) bool {
	switch x := n.(type) {
	case *ast.FuncDecl: funcs++
	case *ast.CallExpr: calls++
	}
	return true
})
```

For repeated, typed traversals across many files, the `golang.org/x/tools/go/ast/inspector` package builds an **index once** and answers `Preorder([]ast.Node{...}, f)` queries without re-walking — this is what the `analysis` framework's `inspect.Analyzer` provides and why analyzers that depend on it are fast.

```go
insp := inspector.New(files)
insp.Preorder([]ast.Node{(*ast.CallExpr)(nil)}, func(n ast.Node) {
	// only CallExprs, no per-call type switch, no re-walk
})
```

---

## 8. Reparse vs. cache

In long-running tools (gopls), the win isn't faster parsing — it's **not reparsing**. Cache parsed files keyed by content hash / modtime and invalidate only changed files. This is incremental analysis, and it dwarfs any per-parse micro-optimisation. For one-shot CLI tools, caching isn't worth it; for editors/daemons it's essential.

A minimal content-hash cache:

```go
type cache struct {
	mu sync.Mutex
	m  map[[32]byte]*ast.File
}

func (c *cache) parse(fset *token.FileSet, name string, src []byte) *ast.File {
	key := sha256.Sum256(src)
	c.mu.Lock()
	if f, ok := c.m[key]; ok {
		c.mu.Unlock()
		return f // hit: skip the whole parse
	}
	c.mu.Unlock()
	f, _ := parser.ParseFile(fset, name, src, 0)
	c.mu.Lock()
	c.m[key] = f
	c.mu.Unlock()
	return f
}
```

Real systems key on file identity + modtime/hash and tie invalidation to the editor's change events; the principle is the same — the cheapest parse is the one you skip.

---

## 8.5 `go/packages` load modes are a cost dial

When you load with `go/packages`, the `Mode` bitset determines how much work the loader does — and type-checking a whole dependency graph is *far* more expensive than parsing. Request only what you use:

| Mode bit | Buys | Cost |
| --- | --- | --- |
| `NeedName` | package path/name | cheap |
| `NeedFiles` | file lists | cheap |
| `NeedSyntax` | parsed `*ast.File`s | moderate (parsing) |
| `NeedTypes` + `NeedTypesInfo` | full type info | expensive (type-checks deps) |
| `NeedDeps` | recurse into dependencies | very expensive |

A purely syntactic codemod should **not** request `NeedTypes` — it triggers type-checking the import graph for nothing. Conversely, a correctness-sensitive refactor needs it; pay the cost knowingly. Loading `./...` with full type info on a large module can dominate the entire tool's runtime, so scope the mode tightly.

---

## 9. Benchmark before optimising

Always measure on *your* corpus:

```go
func BenchmarkParse(b *testing.B) {
	src, _ := os.ReadFile("big.go")
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		fset := token.NewFileSet()
		parser.ParseFile(fset, "big.go", src, parser.SkipObjectResolution)
	}
}
```

Use `-benchmem` and `pprof` (`-memprofile`) to confirm whether tree allocation, comments, or resolution dominates **for your workload** before changing modes.

A back-to-back comparison makes the mode flags' impact visible:

```go
var modes = map[string]parser.Mode{
	"full":          0,
	"skipObjects":   parser.SkipObjectResolution,
	"importsOnly":   parser.ImportsOnly,
	"withComments":  parser.ParseComments,
}

func BenchmarkModes(b *testing.B) {
	src, _ := os.ReadFile("big.go")
	for name, mode := range modes {
		b.Run(name, func(b *testing.B) {
			b.ReportAllocs()
			for i := 0; i < b.N; i++ {
				fset := token.NewFileSet()
				parser.ParseFile(fset, "big.go", src, mode)
			}
		})
	}
}
```

Run with `go test -bench=Modes -benchmem`. You'll typically see `importsOnly` and `skipObjects` allocate noticeably less than `full`, and `withComments` allocate more — exactly matching the cost model in §1–§3. Always interpret the numbers against your real files, not a microbenchmark of one tiny file.

---

## 9.5 Reading a memory profile of a parsing tool

When a parsing tool's RSS climbs, capture a heap profile and look at what's *retained*, not just allocated:

```go
import "runtime/pprof"

f, _ := os.Create("mem.prof")
runtime.GC()                 // get up-to-date stats
pprof.WriteHeapProfile(f)    // inuse_space by default
f.Close()
```

Then `go tool pprof -inuse_space mem.prof` and `top` / `list`. For a tool that holds ASTs you'll typically see the bulk under `parser.ParseFile` → node allocation and, if you kept comments, under comment groups. The two questions to ask:

1. **Am I retaining trees I've finished with?** If `inuse_space` grows linearly with files processed, you're hoarding — drop `*ast.File`s after summarising (§7).
2. **Am I parsing more than I need?** If comment groups or object-resolution structures show up large, flip the corresponding mode off (§2–§3).

`inuse_space` answers "what's alive now"; `alloc_space` answers "what churned" (GC pressure). For peak-memory problems use `inuse_space`; for CPU-in-GC use `alloc_space`. Most parsing-tool wins come from reducing *retained* trees, so start with `inuse_space`.

---

## 10. Checklist

- [ ] Set `parser.SkipObjectResolution` unless you read `Ident.Obj`.
- [ ] Drop `parser.ParseComments` if the tool doesn't need comments.
- [ ] Use `PackageClauseOnly` / `ImportsOnly` when you don't need bodies.
- [ ] One `FileSet` per run; never per file.
- [ ] Parallelise with `go/packages`, or guard a shared FileSet with a mutex.
- [ ] Cap concurrency to bound the number of live ASTs.
- [ ] Drop `*ast.File`s once you've extracted your summary.
- [ ] Cache parses (by content hash) only in long-running daemons.
- [ ] Benchmark with `-benchmem`/pprof on your real corpus first.

---

## 10.5 Decision flow

A compact way to pick the right knobs for a parsing workload:

```
What do you need from each file?
├─ just the package name ............ PackageClauseOnly
├─ package + imports (dep graph) .... ImportsOnly  (+ SkipObjectResolution)
├─ full structure, no comments ...... 0            (+ SkipObjectResolution)
├─ full structure + comments ........ ParseComments(+ SkipObjectResolution)
└─ full type information ............ go/packages NeedTypes|NeedTypesInfo

How many files?
├─ a handful ........................ sequential, simplest
├─ a whole package tree ............. go/packages (concurrent, correct)
└─ custom pipeline .................. worker pool, FileSet under a mutex

Long-running (editor/daemon)?
└─ cache parses by content hash, invalidate on change

Do you read Ident.Obj?
├─ no .............................. always set SkipObjectResolution
└─ yes ............................. you can't skip it; consider switching to go/types
```

Default for a one-shot CLI scanning a tree: `go/packages` if you need types, otherwise sequential `ParseFile` with `SkipObjectResolution` and comments only if required.

---

## 10.6 Anti-patterns to avoid

A few habits silently kill parsing-tool performance:

- **A new `FileSet` per file.** Loses cross-file comparability and adds allocations. One per run.
- **`ParseComments` everywhere "just in case."** Pure overhead for tools that never read comments.
- **Hoarding `[]*ast.File`** for "later" when you only need a tally now. Pins every tree.
- **Running multiple full `ast.Inspect` passes** when one type-switching pass would do.
- **Requesting `NeedTypes` for a syntactic codemod.** Type-checks the whole import graph for nothing.
- **Unbounded goroutines** over thousands of files — peak memory = all trees at once.
- **Re-parsing unchanged files** in a daemon instead of caching by content hash.

Each one is easy to introduce and easy to fix once measured; the profile (§9.5) will point straight at whichever is hurting you.

---

## 11. Summary

The dominant parse cost is per-node allocation, and the dominant *retained* cost is holding ASTs alive. The cheapest wins are mode flags: `SkipObjectResolution` (skip legacy name binding), dropping `ParseComments` when unneeded, and `ImportsOnly`/`PackageClauseOnly` to stop early. Use one `FileSet` per run for comparable positions and fewer allocations; parallelise via `go/packages` (or a mutex-guarded FileSet) and cap concurrency to bound live memory. Stream-and-discard trees instead of hoarding them, cache parses only in daemons, and always benchmark with `-benchmem`/pprof on your real corpus before tuning.

---

## Further reading
- `parser.Mode` (SkipObjectResolution, ImportsOnly): https://pkg.go.dev/go/parser#Mode
- `parser.ParseFile`: https://pkg.go.dev/go/parser#ParseFile
- `go/packages` (concurrent loading): https://pkg.go.dev/golang.org/x/tools/go/packages
- `go/token` FileSet: https://pkg.go.dev/go/token#FileSet
- `testing` benchmarks: https://pkg.go.dev/testing#hdr-Benchmarks
