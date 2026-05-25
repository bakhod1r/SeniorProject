# go generate — Optimization

`go generate` itself has no cache: every invocation re-runs every matched directive sequentially across all packages. On a large repo with protobuf, mocks, and a dozen `stringer` directives, a full regen can take minutes. These exercises cut that down. Numbers are illustrative; measure with `time go generate ./...` on your machine.

---

## Exercise 1: Filter directives with `-run`

**Before** — you change one `.proto` file and re-run everything:

```bash
go generate ./...     # runs stringer, mockgen, protoc, easyjson, ...
```

**After** — `-run` matches each directive's command line against a regex, so you can invoke only the relevant one:

```bash
go generate -run="protoc" ./api/...
```

| Metric | Full regen | `-run="protoc"` |
|--------|-----------|------------------|
| Wall time on medium repo | ~45s | ~6s |

Use a narrow scope (`./api/...` instead of `./...`) and a narrow `-run` regex during iteration; rely on full regen + `git diff --exit-code` in CI.

---

## Exercise 2: Parallelize per package via the build tool

`go generate` runs sequentially across packages. For large repos, a parallel driver scales linearly with CPU count:

**Before:**

```bash
go generate ./...
```

**After** — list packages and feed them to GNU parallel (or `xargs -P`):

```bash
go list ./... | parallel -j 8 go generate {}
```

| Metric | sequential | `parallel -j 8` |
|--------|-----------|------------------|
| Wall time on 60-package repo | ~120s | ~18s |

Caveats: directives that write to shared paths can race; pin those generators to a single package and use `-run` to exclude them from the parallel pass.

---

## Exercise 3: Warm the module cache for `go run pkg@version`

**Before** — fresh CI checkout: every `go run pkg@v1.2.3` re-downloads the tool's module:

```bash
go generate ./...     # downloads stringer, mockgen, oapi-codegen each time
```

**After** — persist `~/go/pkg/mod` across CI jobs (GitHub Actions cache, GitLab cache, etc.). Subsequent jobs reuse the cached modules and only re-link the binary on demand:

| Metric | Cold module cache | Warm module cache |
|--------|-------------------|-------------------|
| Per-tool cost first run | ~3s (download) | ~0.4s (cached) |
| Full regen, 5 tools | ~18s | ~3s |

Locally the same cache is shared across all your projects, so the cost is amortized after the first run.

---

## Exercise 4: Replace per-file `protoc` with `buf`

**Before** — directive per `.proto` file invokes `protoc` every time, no incremental behavior:

```go
//go:generate protoc -I=. --go_out=. user.proto
//go:generate protoc -I=. --go_out=. order.proto
//go:generate protoc -I=. --go_out=. invoice.proto
```

**After** — a single `buf generate` invocation with its own cache and dependency graph:

```go
//go:generate buf generate
```

`buf.yaml` and `buf.gen.yaml` describe inputs and plugins. `buf` only regenerates outputs whose inputs (or plugin versions) changed.

| Metric | N x protoc | `buf generate` (warm) |
|--------|-----------|-----------------------|
| Wall time, 30 protos, 1 changed | ~25s | ~2s |

Trade-off: another tool to install and pin. Worth it past ~10 `.proto` files.

---

## Exercise 5: Make protobuf regeneration mtime-aware via a Makefile

If `buf` is too heavy, a Makefile target can regenerate only what changed:

```make
PROTOS := $(shell find . -name '*.proto')
PB_GO  := $(PROTOS:.proto=.pb.go)

%.pb.go: %.proto
	protoc -I=. --go_out=. $<

generate: $(PB_GO)
.PHONY: generate
```

**Before** — `go generate ./...` re-runs `protoc` for every file.

**After** — `make generate` only rebuilds `.pb.go` files whose `.proto` source is newer.

| Metric | `go generate ./...` | `make generate` (1 proto changed) |
|--------|---------------------|-----------------------------------|
| Wall time, 30 protos | ~25s | ~1s |

In CI you still run the full pass to guard against stale mtimes; locally Make's incremental rebuild dominates.

---

## Exercise 6: gofmt once at the end, not per file

A custom generator that writes 50 files and runs `go/format.Source` per file pays the parser cost 50 times. Buffer all output, write all files, then run `gofmt -w ./generated_dir/` once:

**Before** — per-file format:

```go
for _, f := range files {
    out, _ := format.Source(f.bytes)
    os.WriteFile(f.path, out, 0o644)
}
```

**After** — write raw, format once:

```go
for _, f := range files {
    os.WriteFile(f.path, f.bytes, 0o644)
}
// Then in the directive itself:
//go:generate gofmt -w ./internal/generated
```

| Metric | 50 files, per-file format | one gofmt pass |
|--------|---------------------------|----------------|
| Wall time | ~1.2s | ~0.3s |

Caveat: skipping `format.Source` per file makes syntax errors trickier to attribute — emit clean code first, treat gofmt as polish.

---

## Exercise 7: Drop `@latest` to hit the module cache

**Before** — `@latest` may re-resolve to a new version, forcing fresh download and rebuild:

```go
//go:generate go run honnef.co/go/tools/cmd/staticcheck@latest ./...
```

**After** — pinned version is served entirely from the local module cache after first download:

```go
//go:generate go run honnef.co/go/tools/cmd/staticcheck@v0.5.1 ./...
```

| Metric | `@latest` | pinned `@v0.5.1` |
|--------|-----------|-------------------|
| Per-invocation network call | possible | none after first run |
| Reproducibility | none | guaranteed |

Reproducibility and speed both improve.

---

## Exercise 8: Skip generation in feedback loops; verify in CI

In a tight inner loop you often do not need to regenerate. Run only the affected generator manually when you change its input, and rely on CI's `go generate ./... && git diff --exit-code` to catch drift.

**Before** — habitual `go generate ./...` before every `go test ./...`.

**After** — only regen when you change a `.proto`, an enum constant, or an interface that has a mock. Trust the CI guard.

| Metric | Generate-before-every-test | Generate-on-input-change |
|--------|----------------------------|---------------------------|
| Dev loop iteration | ~25s | ~3s |

The savings compound across a day; the CI check ensures you cannot accidentally commit stale output.

---

## Measurement checklist
- [ ] Use `-run=<regex>` and narrow package scopes during iteration.
- [ ] Parallelize across packages with `go list ./... | parallel`.
- [ ] Persist `~/go/pkg/mod` across CI jobs.
- [ ] Adopt `buf` (or another incremental tool) for protobuf at scale.
- [ ] Drive proto regeneration from a Makefile that compares mtimes.
- [ ] gofmt once at the end of the generator pass rather than per file.
- [ ] Pin every `go run pkg@version` — never `@latest`.
- [ ] Stop regenerating before every test; rely on CI to catch drift.
