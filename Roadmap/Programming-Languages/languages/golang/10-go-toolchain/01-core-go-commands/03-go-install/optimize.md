# go install — Optimization

Make tool installs fast, reproducible, and cacheable. Numbers are illustrative.

---

## Exercise 1: Pin versions to cache the build

**Before** — `go install tool@latest` re-queries the proxy and may rebuild every CI run.

**After:**

```bash
go install honnef.co/go/tools/cmd/staticcheck@v0.5.1
```

| Metric | `@latest` | pinned `@v0.5.1` |
|--------|-----------|------------------|
| Proxy/version query each run | yes | resolved once, cached |
| Reproducibility | none | exact |

Pinning lets `GOCACHE`/`GOMODCACHE` serve repeat installs with no rebuild.

---

## Exercise 2: Cache the bin directory in CI

**Before** — tools reinstall from source on every job.

**After** — cache the bin directory keyed on the version source:

```yaml
- uses: actions/cache@v4
  with:
    path: ${{ github.workspace }}/bin
    key: tools-${{ hashFiles('Makefile') }}
```

| Metric | reinstall each job | cached bin |
|--------|--------------------|------------|
| Tool setup time | ~30s | ~1s (cache hit) |

Tools rebuild only when their pinned versions change.

---

## Exercise 3: `go run tool@version` for single-use tools

**Before** — `go install` a tool used exactly once per CI job, paying install + leaving a binary.

**After:**

```bash
go run honnef.co/go/tools/cmd/staticcheck@v0.5.1 ./...
```

| Metric | install then run | `go run` |
|--------|------------------|----------|
| Steps | 2 | 1 |
| Leaves a binary | yes (unused) | no |

For multi-use tools, install once; for single-use, `go run` is leaner.

---

## Exercise 4: Predictable GOBIN avoids PATH churn

**Before** — relying on `$GOPATH/bin` whose location varies per environment.

**After** — pin `GOBIN` to a repo-local directory:

```bash
export GOBIN="$PWD/bin"
export PATH="$GOBIN:$PATH"
go install ./cmd/...
```

| Metric | default GOPATH/bin | repo-local GOBIN |
|--------|--------------------|------------------|
| Cache key stability | depends on env | stable, cacheable |
| PATH setup | environment-specific | one line |

---

## Exercise 5: Batch installs with the tool directive (Go 1.24+)

**Before** — a setup script runs many `go install path@vX` lines, each resolving independently.

**After:**

```bash
go install tool      # installs all go.mod-declared tools at pinned versions in one pass
```

| Metric | N separate installs | one `go install tool` |
|--------|---------------------|------------------------|
| Resolution passes | N | shared module graph |
| Version source | scattered | single `go.mod` |

---

## Exercise 6: Warm the module cache once

**Before** — first install on a fresh machine downloads each tool's full module graph.

**After** — prime caches early in CI, before parallel steps:

```bash
go mod download           # for your own commands
# pinned tool installs hit GOMODCACHE on subsequent steps
```

| Metric | cold module cache | warmed |
|--------|-------------------|--------|
| Repeated downloads | yes | served from cache |

---

## Measurement checklist
- [ ] Pin tool versions so installs are cacheable and reproducible.
- [ ] Cache the bin directory + `GOCACHE` + `GOMODCACHE` in CI.
- [ ] `go run tool@version` for single-use tools; install for repeated ones.
- [ ] Set a stable, repo-local `GOBIN`.
- [ ] Use the `tool` directive (1.24+) to batch and centralize installs.
