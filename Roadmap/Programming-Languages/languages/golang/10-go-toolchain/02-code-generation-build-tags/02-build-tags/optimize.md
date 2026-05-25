# Build Tags — Optimization

Build tags don't have a runtime cost — the optimizations here are about **build time**, **cache reuse**, **binary size**, and **review clarity**. Each tag combination is a separate `GOCACHE` key, so discipline pays off most in CI. Numbers are illustrative; measure on your machine.

---

## Exercise 1: Minimize tag combinations

**Before** — three different developers and CI each pass slightly different tag sets:

```bash
go build .
go build -tags=integration .
go build -tags=integration,debug .
go build -tags=debug .
go build -tags=enterprise,debug .
```

Five distinct cache keys. Each first-time build pays full compilation cost; switching between any two still costs at least a relink.

**After** — standardize on two or three combinations across the team, declared in a Makefile:

```makefile
build:           ; go build .
build-ee:        ; go build -tags=enterprise .
test-integration:; go test -tags=integration ./...
```

| Metric | ad-hoc tags | standardized set |
|--------|-------------|------------------|
| Cache entries | 5+ | 3 |
| CI cold-build time across jobs | ~5 × full | ~3 × full |
| Cache hit rate after warmup | low | high |

Each new tag combo doubles the worst-case cache footprint. Treat them as a scarce resource.

---

## Exercise 2: Use the `unix` umbrella tag

**Before:**

```go
//go:build linux || darwin || freebsd || openbsd || netbsd || dragonfly || solaris || aix
```

Long, easy to forget a target (e.g., `illumos`), needs editing every time Go adds a Unix family member.

**After:**

```go
//go:build unix
```

| Metric | OS list | `unix` |
|--------|---------|--------|
| Characters in constraint | ~80 | 4 |
| New OS support | edit every file | automatic |
| Review clarity | parse the list | obvious |

Available since Go 1.19. There is no equivalent umbrella for Windows-family, but Windows is one identifier anyway.

---

## Exercise 3: Prefer file-name suffix for simple OS/arch constraints

**Before:**

```go
// driver.go
//go:build linux

package mypkg
```

The constraint and the file name carry **redundant** information.

**After:**

```go
// driver_linux.go     <-- name implies the constraint, no //go:build line needed

package mypkg
```

| Metric | explicit `//go:build` | file-name suffix |
|--------|-----------------------|------------------|
| Lines of source | 3 (constraint + blank + package) | 1 (package) |
| Convention familiarity | needs to be explained | universally recognized |
| Mistake surface | blank-line bug possible | impossible |

Use the suffix when one OS or one arch is the only constraint. Use `//go:build` when you need OR, NOT, custom tags, or `cgo`.

---

## Exercise 4: Keep a stable tag set in CI for cache reuse

**Before** — CI matrix runs jobs with combinations chosen ad-hoc per stage; each stage has its own tag set; `GOCACHE` is cold each time:

```
unit:        go test ./...
race:        go test -race ./...
integration: go test -tags=integration ./...
fuzz:        go test -tags=fuzz ./...
lint:        go vet -tags=integration ./...
```

Five distinct combinations, five cold builds.

**After** — collapse to a small set, persist `GOCACHE` across jobs, and align `go vet` with what tests use:

```yaml
- uses: actions/cache@v4
  with:
    path: |
      ~/.cache/go-build
      ~/go/pkg/mod
    key: go-${{ hashFiles('**/go.sum') }}-tags-${{ env.TAGS }}
```

| Metric | ad-hoc, cold cache | stable set, warm cache |
|--------|--------------------|--------------------------|
| First job in matrix | full compile | full compile |
| Subsequent jobs | full compile | mostly link |
| Total CI wall time | high | 2–4× faster |

The key insight: a cache key that includes the tag set lets each unique combination warm up once and then be reused.

---

## Exercise 5: Gate slow tests behind an `integration` tag

**Before** — slow tests live in regular `*_test.go` files; the unit-test loop is 30+ seconds because of network and DB setup:

```go
func TestStripeRealAPI(t *testing.T) {
    if os.Getenv("RUN_INTEGRATION") == "" { t.Skip() }
    // 5 seconds of network calls
}
```

The file still compiles, transitive imports still load, and the runtime skip wastes setup costs.

**After** — move to a tagged file:

```go
//go:build integration

package billing
```

| Metric | runtime skip | build tag |
|--------|--------------|-----------|
| Compile during `go test ./...` | yes | no |
| Transitive deps loaded | yes (stripe SDK, postgres driver) | no |
| Time to first failure in unit loop | seconds | sub-second |
| Test inventory clarity | scattered `t.Skip()` | one tag, one boundary |

The unit-test loop should be optimized for the inner loop; integration belongs behind a tag.

---

## Exercise 6: Avoid `//go:build ignore` for tool-like code

**Before** — a generator script sits in the same package, kept out of the build via `//go:build ignore`:

```go
//go:build ignore

package main      // pretends to be a tool but lives next to library code

func main() { /* code generation */ }
```

This works (`ignore` is never a true tag, so the file is always excluded), but:

- `go list` and `gopls` treat it as ignored Go code, missing autocomplete and refactoring.
- It pollutes the directory with a file that looks like part of the package.
- New contributors get confused about what package it belongs to.

**After** — move it to a proper subpackage:

```
mypkg/
  feature.go
  internal/gen/   <-- new subpackage
    main.go
```

```bash
go run ./mypkg/internal/gen
```

| Metric | `//go:build ignore` | subpackage |
|--------|---------------------|-----------|
| Tool support | partial | full |
| Directory clarity | mixed | separated |
| Imports in tool | constrained to fit | unconstrained |

Reserve `//go:build ignore` for genuinely throw-away scaffolding (one-shot scripts kept in the repo for historical reasons).

---

## Exercise 7: Replace `runtime.GOOS` checks with build-tagged files

**Before:**

```go
func socketPath() string {
    switch runtime.GOOS {
    case "linux", "darwin":
        return "/var/run/myapp.sock"
    case "windows":
        return `\\.\pipe\myapp`
    default:
        return ""
    }
}
```

All branches compile on every platform; the Windows-only path uses string syntax that works fine in source but pulls in no Windows-specific imports, hiding real cross-platform issues.

**After:**

```go
// socket_unix.go
//go:build unix

package mypkg
func socketPath() string { return "/var/run/myapp.sock" }
```

```go
// socket_windows.go
//go:build windows

package mypkg
func socketPath() string { return `\\.\pipe\myapp` }
```

| Metric | runtime switch | build-tag files |
|--------|----------------|-----------------|
| Per-OS imports | impossible | natural |
| Dead code in each binary | yes (other branches) | none |
| Compiler-checked completeness | no | yes (missing file → undefined) |
| Reads like idiomatic Go stdlib | no | yes |

The standard library (`os`, `net`, `syscall`) is built almost entirely with this pattern.

---

## Measurement checklist
- [ ] Count distinct tag combinations your repo builds; aim for ≤ 3.
- [ ] Replace OS lists with `unix` where applicable.
- [ ] Use file-name suffixes for one-OS or one-arch files.
- [ ] Persist `GOCACHE` and the module cache in CI, keyed by tag set.
- [ ] Tag slow tests with `integration` instead of using `t.Skip()`.
- [ ] Move generator/tool code to a subpackage rather than `//go:build ignore`.
- [ ] Replace `runtime.GOOS` switches with per-OS files where each branch has different imports.
