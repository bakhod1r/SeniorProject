# Build Orchestration & Cache — Find the Bug

Each scenario is a real-world build/cache symptom. Read the setup, predict the
cause, then check the fix. The theme: the action graph and the content-addressed
cache are *correct by construction* — almost every bug here is a case where a
**real input changed but wasn't part of the cache key**, or a flag/CI mistake
that defeats reuse.

---

## Bug 1 — Stale build from a generated file the cache "didn't see"

**Symptom.** A `version.go` is produced by a `Makefile` rule that writes the
current git SHA before `go build`. CI binaries sometimes ship the *previous*
SHA. Local `go build` shows no recompile of the package.

```make
build:
	echo "package app; const SHA = \"$(GIT_SHA)\"" > version.go
	go build ./...
```

**Cause.** The generator runs but the build *order* isn't guaranteed, or
`version.go` is written with identical bytes to last time because `GIT_SHA`
wasn't re-exported — so the **source hash is unchanged**, the action ID matches,
and Go reuses the cached object. The cache is behaving correctly: same source
bytes ⇒ same output. The bug is upstream — the generated content didn't actually
change, or changed *after* `go build` already read it.

**Fix.** Make the version a **link-time** value instead of generated source, so
the build never depends on regenerating a file:

```sh
go build -ldflags="-X example.com/app.SHA=$GIT_SHA" ./cmd/app
```

`-ldflags -X` changes the **link** action ID, so each SHA produces a distinct
link without touching any compile. If you must generate source, ensure the
generator runs (and finishes writing) before `go build` and that its bytes truly
differ.

---

## Bug 2 — CI builds are cold on every run

**Symptom.** Every CI build takes 4 minutes; locally the second build is
instant. `-debug-actiongraph` on CI shows every package with `Mode:"build"`
running.

**Cause.** `GOCACHE` is not persisted between CI jobs. A fresh container starts
with an empty cache, so every package (including the std lib) is a miss.

**Fix.** Persist and restore `GOCACHE` (and `GOMODCACHE`).

```yaml
- uses: actions/setup-go@v5
  with: { go-version: '1.25.x', cache: true }
```

Verify it worked: a warm run's action graph should show few `build` actions and
mostly reused outputs.

---

## Bug 3 — `-gcflags` without `all=` doesn't apply to dependencies

**Symptom.** Debugging an inlining issue in a dependency, you run
`go build -gcflags='-l -N'` to disable inlining/optimization, but the dependency
is *still* inlined in the debugger.

```sh
go build -gcflags='-l -N' ./cmd/app   # deps still optimized
```

**Cause.** A bare `-gcflags` applies **only to the packages named on the command
line** (your `./cmd/app`), not to imported packages or the std lib.

**Fix.** Use the `all=` pattern to reach every package.

```sh
go build -gcflags='all=-l -N' ./cmd/app   # disables inlining everywhere
```

(Or target a specific dep: `-gcflags='example.com/dep=-l -N'`.) Note `all=`
recompiles everything into a *separate* cache variant, so the first such build
is slow.

---

## Bug 4 — A test "always passes" because it's cached and never re-runs

**Symptom.** A flaky test was "fixed," but really it's just printing
`(cached)` every run while the developer edits *other* packages.

```sh
go test ./pkg/flaky   # ok  example.com/pkg/flaky  (cached)
```

**Cause.** Nothing in `pkg/flaky` or its deps changed, so its test binary's
action ID is unchanged, so Go replays the last **successful** result. Correct
behavior — but misleading if you expect it to actually execute.

**Fix.**

```sh
go test -count=1 ./pkg/flaky    # always run, never use cache
# or
go clean -testcache && go test ./pkg/flaky
```

In CI, `-count=1` on the test step guarantees real execution. Diagnose with
`GODEBUG=gocachetest=1 go test ./pkg/flaky`.

---

## Bug 5 — Test cache never hits because of a non-cacheable flag

**Symptom.** Opposite of Bug 4: `go test` *never* shows `(cached)`, even when
nothing changed.

```sh
go test -coverprofile=cov.out ./...   # never cached
```

**Cause.** `-coverprofile` (and other output-producing flags like
`-o`, `-cpuprofile`, custom `-args`) are **not** in the cacheable flag set;
their presence disables test caching for that run.

**Fix.** Run coverage in a separate, deliberately-uncached job; use plain
`go test ./...` (cacheable) for the fast inner loop. Caching can't apply when the
command's whole purpose is to *produce a file*.

---

## Bug 6 — cgo changes don't trigger a rebuild

**Symptom.** You upgrade a system C library (`libfoo`) and rebuild, but the cgo
package keeps using the old behavior. `go build` reports nothing to do.

**Cause.** The build cache hashes the `.go`/`.c`/`.h` files in the package and
the cgo flags — but **not external system libraries** discovered at link time.
`go help cache` says so explicitly: the cache does not detect changes to C
libraries imported with cgo.

**Fix.**

```sh
go clean -cache && go build ./...    # or, for one build:
go build -a ./...
```

Long-term: pin the C toolchain/libs in a container image, or set
`CGO_ENABLED=0` where possible so the cache key is fully self-contained.

---

## Bug 7 — `-a` everywhere makes every build painfully slow

**Symptom.** A teammate "fixed cache weirdness" by adding `-a` to the Makefile.
Now every build, including warm ones, takes minutes.

```make
build: ; go build -a ./...
```

**Cause.** `-a` forces a rebuild of **all** packages, **including the standard
library**, on every invocation — it disables cache reuse entirely.

**Fix.** Remove `-a`. Use it only as a one-off diagnostic. If you suspect cache
corruption, `go clean -cache` once, then rebuild normally (the next build repopulates
the cache and subsequent builds are fast again).

---

## Bug 8 — Cross-machine cache never hits (absolute paths)

**Symptom.** A shared/distributed cache (via `GOCACHEPROG`) gets populated by the
build host but laptops still rebuild from scratch.

**Cause.** Without `-trimpath`, compiled objects embed absolute paths
(`/home/runner/...` vs `/Users/dev/...`). Different paths ⇒ different action IDs
⇒ no cross-machine hit.

**Fix.** Build everywhere with `-trimpath` (ideally via `GOFLAGS`):

```sh
export GOFLAGS='-trimpath'
```

Now action IDs are path-independent and the shared cache is reusable across
machines.

---

## Bug 9 — Builds differ between two developers, same commit

**Symptom.** Two developers on the same commit produce binaries with different
bytes (`sha256` differs), breaking a reproducibility check.

**Cause.** Different toolchains (`go1.25.1` vs `go1.25.3`) and/or no
`-trimpath`, so the compiler hash and embedded paths differ.

**Fix.** Pin the toolchain in `go.mod` and trim paths:

```text
// go.mod
go 1.25.3
toolchain go1.25.3
```
```sh
go build -trimpath -ldflags='-buildid=' -o app ./cmd/app
```

Same toolchain + `-trimpath` ⇒ identical action IDs ⇒ identical bytes.

---

## Bug 10 — `go build ./...` is slow because it builds test-only and tool packages

**Symptom.** CI "build" stage compiles thousands of packages including internal
codegen tools you never ship.

**Cause.** `./...` matches **every** package in the module, not just your
`main`s. You're compiling far more than you deploy.

**Fix.** Build the specific targets:

```sh
go build -o bin/server ./cmd/server
go build -o bin/worker ./cmd/worker
```

Let a separate `go test ./...` / `go vet ./...` stage exercise the rest.

---

## Bug 11 — `-p 1` (or an env override) silently serializes the build

**Symptom.** A build that used to take 30s now takes 3 minutes on the same
machine. CPU usage sits at one core.

**Cause.** Someone set `-p 1` (or `GOMAXPROCS=1` / `GOFLAGS=-p=1`) for a
debugging session and committed it. The action graph runs serially.

**Fix.** Remove the override; default `-p` is `NumCPU`. Confirm with
`go build -x` that multiple `compile` processes overlap, or check `TimeStart`
overlap in `-debug-actiongraph` output.

---

## Bug 12 — Volatile data in `-gcflags` busts the compile cache every build

**Symptom.** Compiles (not just the link) rerun on every build even when source
is unchanged.

```sh
go build -gcflags="-trimpath=$PWD" ./...   # $PWD-dependent flag on COMPILE
```

**Cause.** Any per-build-varying value baked into a **compile** flag changes the
compile action ID, so every package recompiles. Volatile values belong only on
the **link** step.

**Fix.** Keep stamping in `-ldflags` (link only); use the built-in `-trimpath`
build flag rather than hand-rolled compile flags:

```sh
go build -trimpath -ldflags="-X main.build=$BUILD_ID" ./...
```

Now compiles stay cached; only the link reflects the changing `$BUILD_ID`.

---

## Bug 13 — Module cache not persisted: re-downloads every CI run

**Symptom.** CI spends a minute on `go: downloading ...` even though the build
cache *is* restored.

**Cause.** `GOCACHE` was cached but `GOMODCACHE` (`$GOPATH/pkg/mod`) was not, so
module **source** is re-fetched each run.

**Fix.** Cache both directories; `actions/setup-go` with `cache: true` already
does. Key the module cache on `go.sum`.

---

## Bug 14 — `touch`ing a file doesn't rebuild (and someone expects it to)

**Symptom.** A script does `touch generated.go && go build` to "force" a rebuild
of that package, but nothing recompiles.

**Cause.** Modern Go decides staleness from **content hashes**, not timestamps.
`touch` changes mtime but not bytes, so the action ID is unchanged ⇒ cache hit.

**Fix.** Either actually change the content, or force the build explicitly:

```sh
go build -a ./pkg/generated      # rebuild this package's subtree
# or just trust the cache — if bytes didn't change, the old object is correct.
```

---

## Summary

- The build cache is almost never "wrong": a cache hit means *the inputs Go
  hashes are identical*. Bugs are usually **inputs Go can't see** (cgo system
  libs, regenerated-but-identical files) or **CI/flag mistakes** (cold cache,
  missing `all=`, stray `-a`, volatile compile flags, no `-trimpath`).
- Reach for: `go build -x` / `-work` (what ran), `-debug-actiongraph` (the
  graph + timings), `GODEBUG=gocachehash=1` (what's in the key),
  `GODEBUG=gocachetest=1` (test-cache decisions), `-count=1` (force re-run).
- Reproducibility = pinned toolchain + `-trimpath`. Speed = persisted `GOCACHE`
  + `GOMODCACHE` + no cache busters.
