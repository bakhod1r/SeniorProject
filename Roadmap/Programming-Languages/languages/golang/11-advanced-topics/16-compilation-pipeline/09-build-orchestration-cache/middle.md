# Build Orchestration & Cache — Middle

At the junior level you watched `go build -x` run `compile` and `link`. Now we
look at the data structure that decides *what* runs and *when*: the **action
graph**. Everything the `go` command does — building, testing, installing,
caching — is expressed as a graph of `Action`s executed by a `Builder`. This is
implemented in `cmd/go/internal/work`.

## 1. The action graph

An **action** is one unit of work with a known set of inputs and one output.
Examples: "compile package `fmt`", "link the `main` package", "run the test
binary for package `foo`". Each action records:

- its **mode** (`build`, `link`, `link-install`, `run`, `vet`, …),
- the **package** it operates on,
- its **dependency actions** (the actions that must finish first),
- where its output goes (`Objdir`, `Target`).

The core types in `cmd/go/internal/work`:

```go
// cmd/go/internal/work/action.go  (shape, simplified)
type Action struct {
    Mode    string        // "build", "link", "vet", ...
    Package *load.Package // the package this action operates on
    Deps    []*Action     // actions that must complete first
    Func    func(*Builder, *Action) error // what to run
    Objdir  string        // $WORK/bNNN/ scratch dir
    Target  string        // final output path (or cache)
    actionID cache.ActionID // content hash of inputs (the cache key)
    buildID  string        // actionID + contentID of the output
}

type Builder struct {
    WorkDir string        // the $WORK temp directory
    actionCache map[cacheKey]*Action // dedupe: one action per (mode,package)
    // ... a semaphore limiting concurrency to -p ...
}
```

The graph is a **DAG** (no cycles — Go forbids import cycles, so the package
graph is acyclic, and the action graph inherits that). You can dump the real
graph as JSON:

```sh
go build -debug-actiongraph=ag.json .
```

A real node from that file (Go 1.25):

```json
{
  "ID": 2,
  "Mode": "build",
  "Package": "example.com/hello",
  "Deps": [3, 4, 7],
  "Objdir": "$WORK/b001/",
  "Priority": 12,
  "BuildID": "abc123.../def456...",
  "TimeReady": "2026-06-06T00:19:00Z",
  "TimeStart": "2026-06-06T00:19:00.01Z",
  "TimeDone":  "2026-06-06T00:19:00.08Z"
}
```

`Deps` are array indices into the same JSON. `Mode: "build"` is a compile;
`Mode: "link"` / `"link-install"` is the link step for `main`. The `TimeStart`/
`TimeDone` fields let you see which actions ran in parallel and which were the
bottleneck.

## 2. Dependency-ordered, parallel compilation

The `Builder` walks the DAG and runs actions **as soon as all their `Deps` are
done**. Independent packages run **concurrently**; an action that imports
another waits for it.

Concurrency is bounded by `-p` (default = `runtime.GOMAXPROCS(0)`, i.e. the
number of CPUs):

```sh
go build -p 1 ./...    # fully serial — useful for reading -x output in order
go build -p 4 ./...    # at most 4 actions in flight
go build ./...         # default: NumCPU
```

So in a tree where `main → A,B → C`, the build runs `C` first, then `A` and `B`
in parallel, then `main`, then `link`. The compiler itself is also internally
parallel (`-c=N` per package), but that's a separate axis from `-p`.

## 3. The per-package pipeline: compile / asm / pack / link

For one package the `go` tool issues these tool calls (visible with `-x`):

```text
# 1. assemble any .s files (only if the package has assembly)
asm -p internal/cpu -trimpath "$WORK/b011=>" -gensymabis -o $WORK/b011/symabis ./cpu_arm64.s
asm -p internal/cpu ... -o $WORK/b011/cpu_arm64.o ./cpu_arm64.s

# 2. compile the Go files into a package archive
compile -o $WORK/b011/_pkg_.a -trimpath "$WORK/b011=>" -p internal/cpu \
   -lang=go1.25 -std -complete -buildid <id> -goversion go1.25.3 \
   -importcfg $WORK/b011/importcfg -pack -asmhdr $WORK/b011/go_asm.h ./cpu.go

# 3. pack the assembled .o objects into the same archive
pack r $WORK/b011/_pkg_.a $WORK/b011/cpu_arm64.o   # (when there is asm)

# 4. stamp a build id into the archive
go tool buildid -w $WORK/b011/_pkg_.a
```

Then for the `main` package only:

```text
link -o $WORK/b001/exe/a.out -importcfg $WORK/b001/importcfg.link -buildmode=exe ...
```

Key files the `go` tool writes for the compiler/linker:

- **`importcfg`** — maps each imported package path to the file path of its
  compiled `.a`. This is how `compile` finds dependencies without searching.
- **`importcfg.link`** — the same idea for the linker: every package's archive,
  flattened.

> Most pure-Go packages have **no** `asm`/`pack` step — `compile` writes the
> `.a` directly. `asm` + `pack` appear when a package ships `.s` files (parts of
> `runtime`, `internal/cpu`, `math`, crypto, etc.).

## 4. Cache keys — the intuition

The cache is content-addressed by an **action ID**: a hash over everything that
could change the output. For a *compile* action that includes:

- the **content** of every `.go` (and `.s`) file in the package,
- the **import paths and the action IDs of the dependencies** (so a change deep
  in the tree ripples upward),
- the **compiler binary's hash** (toolchain version),
- the **flags** that reach the compiler (`-gcflags`, `-trimpath`, `-tags`,
  build mode, target `GOOS`/`GOARCH`, …),
- relevant environment (`GOEXPERIMENT`, cgo settings, `CGO_*` for cgo packages).

Two builds with the same action ID reuse the same output; change any input and
the ID changes, so that package (and everything downstream) recompiles. You can
watch the hashing decisions:

```sh
GODEBUG=gocachehash=1 go build . 2>&1 | head
# prints "HASH ..." lines showing each input mixed into the key
```

## 5. Test caching

`go test` caches **successful** test results, not just compiled code. A cached
result prints with `(cached)`:

```sh
go test ./...        # runs the tests
go test ./...        # ok  example.com/foo  (cached)
```

A cached result is reused only when **all** of these match the cached run:

- the test binary's action ID (so the package and its deps are unchanged),
- the **command-line test flags** — and only a safe subset is cacheable
  (`-run`, `-count`, `-cpu`, `-list`, `-short`, `-timeout`, `-parallel`, `-v`,
  `-failfast`, `-benchtime`, `-tags`). Any other flag disables caching.
- the **files and env vars the test reads** via `os.Getenv`/`os.Stat` etc.
  (the test cache records these accesses; if they change, the cache misses).

Two ways to bypass it deliberately:

```sh
go test -count=1 ./...     # idiomatic "always run, don't use cache"
go clean -testcache        # expire all cached test results
```

`-count=1` works because `-count` is part of the key, and the special value `1`
combined with the way results are keyed forces a fresh run on each invocation.

## 6. Forcing rebuilds and cleaning

```sh
go build -a ./...      # ignore the cache: rebuild every package this run
go clean -cache        # delete the entire build cache (next build is cold)
go clean -testcache    # expire test results only
go build -a            # NOTE: also recompiles the standard library — slow!
```

Use `-a` to debug "is the cache lying to me?" — but never bake it into CI
(Section in `optimize.md`). It rebuilds the std library every time.

## 7. GOFLAGS and gcflags scoping

`GOFLAGS` injects flags into **every** `go` invocation — handy in CI:

```sh
export GOFLAGS='-trimpath -mod=readonly'
go build ./...   # behaves as: go build -trimpath -mod=readonly ./...
```

`-gcflags` takes an optional **package pattern**. This trips people up:

```sh
go build -gcflags='-m' ./...          # applies ONLY to the packages named on
                                      # the command line (your main module),
                                      # NOT to dependencies.
go build -gcflags='all=-m' ./...      # 'all=' applies to EVERY package, incl.
                                      # std lib and deps.
go build -gcflags='example.com/x=-m' ./...  # only that one package pattern
```

So `-gcflags=-N -l` (disable optimization/inlining, e.g. for debugging) without
`all=` leaves your dependencies and the std lib optimized. To debug across the
whole binary you usually want `all=`. The same `[pattern=]` syntax applies to
`-asmflags` and `-ldflags`. Because flags are part of the cache key, switching
`-gcflags` recompiles the affected packages (and `all=` recompiles everything,
warming a *separate* cache entry).

## 8. Summary

- The `go` command compiles via an **action graph** (`Action`/`Builder` in
  `cmd/go/internal/work`), a DAG executed in dependency order with up to `-p`
  actions in parallel.
- Per package: optional `asm`, then `compile` → `.a`, optional `pack`,
  `buildid`; `link` only for `main`. `importcfg` tells tools where deps live.
- The cache key (action ID) hashes source + deps' IDs + toolchain + flags;
  `GODEBUG=gocachehash=1` shows it. `-a` ignores the cache, `go clean -cache`
  empties it.
- `go test` caches successful runs; `-count=1` or `go clean -testcache` reruns.
- `-gcflags` defaults to command-line packages only; use `all=` to include
  dependencies and the standard library.

## Further reading

- `cmd/go/internal/work` source: <https://cs.opensource.google/go/go/+/refs/tags/go1.25.3:src/cmd/go/internal/work/>
- `go help test` (test caching rules) and `go help testflag`
- `go help build` (`-gcflags`, `-p`, `-a`, `-debug-actiongraph`)
- Build cache: <https://pkg.go.dev/cmd/go#hdr-Build_and_test_caching>
