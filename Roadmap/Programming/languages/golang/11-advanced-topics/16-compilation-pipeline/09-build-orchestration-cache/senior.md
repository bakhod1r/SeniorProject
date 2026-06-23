# Build Orchestration & Cache — Senior

This page is the mental model. The earlier compiler-internals topics (lexer,
parser, type checker, SSA, codegen, assembler, linker) each described **one
tool**. The `go` command is the conductor that decides *which* of those tools to
run, *in what order*, *with what flags*, and — crucially — *whether to run them
at all*. The whole thing reduces to two ideas: an **action graph** built by a
**Builder**, and a **content-addressed cache** keyed by action IDs.

## 1. The Builder / Action model

`cmd/go/internal/work` turns your command into a DAG of `Action`s and executes
it. The relationship to the stages you already studied:

```text
go build ./cmd/server
        │
        ▼  load: resolve modules, parse imports, build package graph
   ┌────────────────────────────────────────────────┐
   │ action graph (DAG of *Action)                   │
   │                                                 │
   │  build:fmt   build:net   build:yourpkg ...      │  each "build" action
   │      └──────────┴────────────┘                  │  shells out to:
   │                 │                               │    asm  (if .s present)
   │            build:main                           │    compile  → _pkg_.a
   │                 │                               │    pack (if .o objects)
   │             link:main  ────────────────────────┼──► link → executable
   └────────────────────────────────────────────────┘
```

`Builder.Do(ctx, root)` runs the graph. Each `Action.Func` is the thing that
actually executes — e.g. `(*Builder).build` for a compile, `(*Builder).link`
for a link. The Builder:

- **dedupes**: `(mode, package, flags)` maps to exactly one `Action` (an
  `actionCache`), so a package imported by 50 others is compiled once.
- **orders**: it only starts an action when every entry in `Deps` is `Built`.
- **parallelizes**: a counting semaphore caps in-flight actions at `-p`.

The `Mode` strings you'll see in `-debug-actiongraph` output: `build` (compile a
package to `_pkg_.a`), `link` and `link-install` (link `main`), `vet`, `run`,
plus test-specific modes when running `go test`.

## 2. The content-addressed cache (action IDs)

Each cacheable action has two hashes (`cmd/go/internal/cache`,
`cmd/go/internal/work/buildid.go`):

- **action ID** — a hash of all **inputs**. For a compile that's: the source
  file contents, the package import path, the **action IDs of the dependency
  actions**, the compiler binary's hash, every flag that reaches the compiler,
  and target `GOOS`/`GOARCH`/build mode. This is the *cache key*.
- **content ID** — a hash of the **output** bytes (the compiled `.a`).

The two combine into the **build ID** stamped into the archive:
`actionID/contentID` (`go tool buildid file.a` prints it). The cache directory
(`GOCACHE`) stores entries indexed by action ID; the value is the content ID,
and the content (the actual `.a` or linked binary) is stored once, addressed by
its content hash — so identical outputs are de-duplicated on disk.

Why include **deps' action IDs** rather than their output? Because it makes the
key *transitive and cheap*: change one byte in a leaf package and its action ID
changes, which changes the action ID of everything that imports it,
automatically and without re-reading their source. The hash propagates up the
DAG exactly like staleness should.

Inspect the hashing:

```sh
GODEBUG=gocachehash=1 go build . 2>&1 | grep -A1 'yourpkg'
# Each "HASH <subject>" line is one input mixed into that action's key:
#   compiler version, file content, importcfg lines, flags, GOOS/GOARCH...
```

## 3. Staleness rules

Pre-cache (old GOPATH era) Go used **timestamps** of `.a` files vs source — a
notoriously fragile heuristic. Modern Go (since 1.10) decides staleness purely
from **content hashes**:

> A package is "stale" iff its computed action ID has no entry in the cache.

That single rule subsumes all the old cases:

- edit a `.go` file → source hash changes → action ID changes → miss → rebuild.
- upgrade the toolchain → compiler hash changes → **everything** misses → full
  rebuild (this is why a new Go release makes the first build slow).
- change `-gcflags`/`-tags`/`-trimpath` → flag hash changes → affected packages
  miss.
- bump a dependency in `go.mod` → that module's source hash changes → its action
  ID changes → all importers miss.

Timestamps are no longer consulted, so `touch`ing a file does **not** trigger a
rebuild (its bytes are unchanged). The classic gotcha is the inverse:
**generated** content the cache can't "see" as an input — covered in
`find-bug.md`.

## 4. Parallelism tuning (`-p`)

`-p` bounds how many actions run at once; default `GOMAXPROCS(0)` ≈ `NumCPU`.

```sh
go build -p "$(nproc)" ./...     # explicit max
go build -p 1 ./...              # serial: reproducible -x ordering, easier debugging
```

Tuning notes for big builds:

- The graph is often **wide at the leaves** (many independent packages) and
  **narrow at the top** (one `main`, one `link`). Early phases scale with cores;
  the final link is single-threaded and frequently the tail latency.
- Memory, not CPU, is the usual cap on `-p` for large monorepos — each `compile`
  process holds the package's IR. On a constrained CI box, lowering `-p`
  prevents OOM-kills that otherwise *look* like flaky build failures.
- `-p` is orthogonal to the compiler's internal `-c=N` concurrency (per
  package). You rarely set the latter directly.

## 5. How this orchestrates the earlier stages

Tie it back to the compiler-internals chapters:

| Stage (earlier topic) | Who runs it | When `go` decides to run it |
| --- | --- | --- |
| scan/parse/typecheck/SSA/codegen | `compile` (one process per package) | `build` action, on cache miss |
| assemble `.s` → `.o` | `asm` | only if the package ships assembly |
| bundle objects → `.a` | `compile -pack`, or `pack` for extra `.o` | per package |
| stamp build id | `go tool buildid` | per archive |
| link `.a`s → executable | `link` | `link` action, for `main` only |

The `go` command never *peers inside* those tools — it treats each as a pure
function from (inputs, flags) to (output, action ID). That purity is exactly
what makes content addressing sound: same inputs ⇒ same output ⇒ safe to cache.
The single most senior thing to internalize: **the action graph is the build,
and the action ID is the proof that a cached result is still correct.**

## 6. Summary

- `cmd/go/internal/work` builds a DAG of `Action`s; a `Builder` dedupes, orders
  by `Deps`, and runs up to `-p` in parallel. The earlier compiler stages are
  the *leaves* of this graph.
- The cache is content-addressed: **action ID** (hash of inputs incl. deps'
  action IDs, toolchain, flags) is the key; **content ID** addresses the output.
- Staleness = "action ID not in cache." Hashes propagate up the DAG, so changes
  invalidate exactly the affected subtree. Timestamps are irrelevant.
- `-p` caps parallelism (default NumCPU); the final link is the serial tail.

## Further reading

- `cmd/go/internal/work`: <https://cs.opensource.google/go/go/+/refs/tags/go1.25.3:src/cmd/go/internal/work/>
- `cmd/go/internal/cache`: <https://cs.opensource.google/go/go/+/refs/tags/go1.25.3:src/cmd/go/internal/cache/>
- "Cache" design doc / Russ Cox notes: <https://research.swtch.com/vgo-mvs> (modules) and the build-cache proposal in the Go issue tracker
- `go help buildid`, `go tool buildid -h`
