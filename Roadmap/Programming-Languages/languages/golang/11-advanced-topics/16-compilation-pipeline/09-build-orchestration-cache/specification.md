# Build Orchestration & Cache — Specification

Reference page. Behavior is as of Go 1.25; flags and environment knobs are real.
Verify locally with `go help build`, `go help cache`, `go help test`, and
`go help environment`.

## 1. The action graph model

The `go` command (`cmd/go/internal/work`) compiles a request into a DAG of
actions executed by a `Builder`.

| Concept | Definition |
| --- | --- |
| `Action` | One unit of work: a `Mode`, a `Package`, `Deps []*Action`, an `Objdir` scratch dir, a `Target`, and an `actionID`/`buildID`. |
| `Mode` | What the action does: `build`, `link`, `link-install`, `vet`, `run`, plus test modes. |
| `Builder` | Owns `WorkDir` (`$WORK`), dedupes actions by `(mode, package, flags)`, schedules them. |
| `Deps` | Actions that must reach `Built` before this one starts (defines order). |
| DAG | Acyclic because Go forbids import cycles. |
| Scheduling | An action runs when all `Deps` are done; up to `-p` actions run concurrently. |

`-debug-actiongraph=FILE` emits the graph as a JSON array. Per-node fields:
`ID`, `Mode`, `Package`, `Deps` (array of node IDs), `Objdir`, `Target`,
`Priority`, `BuildID` (`actionID/contentID`), `TimeReady`, `TimeStart`,
`TimeDone`, `Cmd`.

Per-package tool sequence (visible with `-x`):

```text
[asm     -p PKG ... -gensymabis -o $WORK/bNNN/symabis  *.s]   # if assembly present
[asm     -p PKG ... -o $WORK/bNNN/x.o  x.s]                   # if assembly present
 compile -o $WORK/bNNN/_pkg_.a -trimpath ... -importcfg $WORK/bNNN/importcfg -pack *.go
[pack    r $WORK/bNNN/_pkg_.a  $WORK/bNNN/x.o]                # if extra .o objects
 go tool buildid -w $WORK/bNNN/_pkg_.a
 link    -o $WORK/bNNN/exe/a.out -importcfg $WORK/bNNN/importcfg.link ...   # main only
```

## 2. Cache key (action ID) inputs

The action ID is a hash. For a **compile** action the mixed-in inputs include:

- Contents of all `.go` and `.s` files in the package.
- The package import path.
- The **action IDs of all dependency build actions** (transitive via the DAG).
- The compiler (`compile`) binary's hash → the toolchain version.
- Compiler-affecting flags: `-gcflags` (matching pattern), `-asmflags`, `-tags`,
  `-trimpath`, `-race`/`-msan`/`-asan`, build mode, `-cover` settings.
- Target `GOOS`, `GOARCH`, relevant `GOARM`/`GOAMD64`/etc., `GOEXPERIMENT`.
- For cgo packages: `CGO_ENABLED`, `CC`/`CXX`, `CGO_CFLAGS`/`CGO_LDFLAGS`, and
  hashes of the `.c`/`.h` files (but **not** external system C libraries —
  see test-cache/cgo caveats).

For a **link** action: the action IDs of all linked packages, the `link` binary
hash, and `-ldflags`/`-buildmode`/`-trimpath`. The output is addressed by a
**content ID** (hash of output bytes). `buildID = actionID/contentID`; read with
`go tool buildid FILE`. Observe key composition with `GODEBUG=gocachehash=1`.

Staleness rule: a package is stale iff its computed action ID is **absent** from
`GOCACHE`. Timestamps are not consulted.

## 3. `go build` flags (selected)

| Flag | Effect |
| --- | --- |
| `-x` | Print every command the `go` tool runs (incl. `WORK=` and tool invocations). |
| `-v` | Print package import paths as they are built. |
| `-n` | Print commands but do **not** run them. |
| `-work` | Print `WORK=...` and **do not delete** the `$WORK` scratch dir. |
| `-a` | Force rebuild of all packages this run (ignore cache; includes std lib). |
| `-p n` | Max parallel actions. Default `GOMAXPROCS(0)` ≈ `NumCPU`. |
| `-trimpath` | Remove absolute filesystem paths from outputs (reproducible, machine-independent action IDs). |
| `-gcflags '[pattern=]flags'` | Pass flags to `compile`. No pattern ⇒ command-line packages only. `all=` ⇒ every package. |
| `-asmflags '[pattern=]flags'` | Same `[pattern=]` rule for `asm`. |
| `-ldflags '[pattern=]flags'` | Pass flags to `link` (e.g. `-s -w`, `-X`, `-buildid=`). |
| `-debug-actiongraph=FILE` | Write the action graph as JSON (with timings). |
| `-tags 'a,b'` | Build tags; part of the cache key. |
| `-race` / `-msan` / `-asan` | Instrumentation; changes the cache key (separate cached variants). |
| `-cover` / `-covermode` | Coverage instrumentation; part of the key. |
| `-mod=readonly|mod|vendor` | Module resolution mode. |
| `-C dir` | Change to `dir` before running (must be first flag). |
| `-o path` | Output path for the result. |

`[pattern=]` accepts `all` (every package), a module/import pattern (e.g.
`example.com/x/...`), or omission (command-line packages only).

## 4. Environment knobs

| Variable | Meaning |
| --- | --- |
| `GOCACHE` | Build cache directory. `go env GOCACHE` prints it; set `off` to disable (forces cold builds, rarely useful). |
| `GOMODCACHE` | Module download cache (`$GOPATH/pkg/mod` by default). |
| `GOFLAGS` | Flags injected into every `go` command, e.g. `-trimpath -mod=readonly`. |
| `GOCACHEPROG` | External program implementing the cache get/put protocol (remote/distributed cache). |
| `CGO_ENABLED` | `0` disables cgo (pure-Go, simpler/reproducible cache); `1` enables it (host C toolchain enters the picture). |
| `GOOS` / `GOARCH` | Target platform; part of the cache key. |
| `GOEXPERIMENT` | Toolchain experiments; part of the key. |
| `GODEBUG=gocachehash=1` | Print each input mixed into cache keys. |
| `GODEBUG=gocachetest=1` | Trace test-cache decisions (hit/miss reasons). |
| `GODEBUG=gocacheverify=1` | Recompute and verify cache entries (debug cache correctness). |

## 5. Cache management commands

| Command | Effect |
| --- | --- |
| `go env GOCACHE` | Print the cache directory. |
| `go clean -cache` | Delete the entire build cache (next build is cold). |
| `go clean -testcache` | Expire all cached **test** results. |
| `go clean -modcache` | Remove the module download cache. |
| `go clean -fuzzcache` | Remove cached fuzzing corpus/files. |
| `go build -a` | Ignore the cache for this build only. |

## 6. Test-cache invalidation rules

`go test` caches a **successful** run and replays it as `(cached)`. A cached
result is reused only if **all** hold:

1. The test binary's action ID is unchanged (package + all deps unchanged).
2. The command-line test flags are from the cacheable subset and unchanged:
   `-run`, `-bench` (note: matched benches still run), `-benchtime`, `-count`,
   `-cpu`, `-list`, `-parallel`, `-short`, `-timeout`, `-failfast`, `-v`,
   `-tags`. Any flag **outside** this set disables caching for that run.
3. Inputs the test observed at runtime are unchanged: files it `Open`/`Stat`ed
   and environment variables it read via `os.Getenv`. The test cache records
   these; if any changes, the cache misses.

Forcing a rerun:

- `go test -count=1 ./...` — idiomatic "do not use the cache."
- `go clean -testcache` — expire all cached results.
- A failing test is never cached.

Trace decisions with `GODEBUG=gocachetest=1 go test ./...`.

## 7. Summary

- The build is a DAG of `Action`s (`work` package); `-debug-actiongraph`
  serializes it with timings.
- The cache key is the **action ID** = hash of source + deps' action IDs +
  toolchain + flags + target; output addressed by **content ID**.
- Key flags: `-x`/`-work` (observe), `-a` (force), `-p` (parallel), `-trimpath`
  (reproducible), `-gcflags`/`-ldflags` (`[pattern=]`, `all=`),
  `-debug-actiongraph` (analyze).
- Test caching reuses successful runs unless the binary, cacheable flags, or
  observed files/env change.

## Further reading

- `go help build`, `go help cache`, `go help clean`, `go help test`, `go help testflag`, `go help environment`
- `cmd/go` package docs: <https://pkg.go.dev/cmd/go>
- `cmd/go/internal/cache` & `cmd/go/internal/work`: <https://cs.opensource.google/go/go/+/refs/tags/go1.25.3:src/cmd/go/internal/>
