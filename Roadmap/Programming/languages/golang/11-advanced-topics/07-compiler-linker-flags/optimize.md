# Compiler & Linker Flags — Optimize

## 1. PGO is the cheapest 5–10% you'll find

Profile-guided optimization needs:

- A CPU profile from representative load (60s+).
- The profile committed as `default.pgo` next to your main package.
- A normal `go build` (which picks up the profile automatically).

```bash
curl -o cmd/app/default.pgo http://prod-canary:6060/debug/pprof/profile?seconds=60
go build ./cmd/app
```

Typical wins:

- Hot inlining: more inlined calls in hot paths.
- Devirtualization: interface calls become direct calls when one type dominates.
- Register allocation: hot loops get more registers.

Refresh the profile periodically (every few weeks or per release).

---

## 2. Strip aggressively for release

```bash
go build -ldflags='-s -w' -trimpath ./cmd/app
```

Effects:

- `-s`: ~5% size reduction (drops symbol table).
- `-w`: ~10% size reduction (drops DWARF).
- `-trimpath`: small additional size win + reproducibility.

Don't combine with `delve` — debugging will be limited.

---

## 3. `CGO_ENABLED=0` if you can

```bash
CGO_ENABLED=0 go build ./cmd/app
```

Drops:

- The cgo runtime (~500 KiB).
- Glibc dependency.
- External linker invocation.

Builds faster (no C compile step), produces a fully static binary. Compatible only if your dependencies are also cgo-free.

For services using `net`, `os/user`, `database/sql/driver`, etc., add the relevant tags:

```bash
CGO_ENABLED=0 go build -tags='netgo,osusergo,timetzdata' ./cmd/app
```

---

## 4. `-trimpath` saves a little

```bash
go build -trimpath ./...
```

Slight binary size reduction (~1–2%) plus reproducibility. Always use in release builds.

---

## 5. The `-spectre` cost

```bash
go build -gcflags='-spectre=all' ./...
```

Adds Spectre v1 mitigations. Performance cost: ~1–5% on affected hot paths. Enable in hardened environments (multi-tenant servers, untrusted code execution); skip otherwise.

---

## 6. Avoid `-N -l` in production

```bash
# Bad in production
go build -gcflags='all=-N -l' ./cmd/app
```

Disabling optimizations (`-N`) and inlining (`-l`) makes binaries:

- 2–3× slower in hot paths.
- 30%+ larger.

Use only for debugging. Standard release builds should let the compiler do its job.

---

## 7. Build cache hygiene

```bash
go env GOCACHE          # where compiled package objects live
du -sh $(go env GOCACHE)
go clean -cache         # nuclear option
go clean -testcache     # clear test cache only
```

A warm cache makes incremental builds fast (sub-second for small changes). The cache grows; trimming yearly is fine.

For CI, persistent caches between builds dramatically speed things up:

```yaml
- uses: actions/cache@v3
  with:
    path: ~/.cache/go-build
    key: ${{ runner.os }}-go-${{ hashFiles('**/go.sum') }}
```

---

## 8. Parallelism

```bash
go build -p $(nproc) ./...
```

Default `-p` is `GOMAXPROCS`. For huge codebases, you may pin it higher if your I/O is fast and CPU is plentiful. Usually the default is right.

---

## 9. The link-time cost

For large binaries, the link step can dominate:

- `cmd/link` reads all object files.
- Resolves symbols.
- Performs dead-code elimination.
- Writes the output.

For a 50 MiB binary, linking can take 5–10 seconds. The internal linker is faster than the external; use `-linkmode=internal` when cgo allows.

For `-buildmode=pie`:

- Requires the external linker.
- Position-independent code is slightly slower (a few percent).
- Binary slightly bigger.

PIE is good for hardened production deployments; skip if you don't need it.

---

## 10. Optimizing test build times

```bash
go test -count=1 ./...        # skip test cache (slower)
go test -short ./...          # honor `t.Short()`, skip long tests
go test -p 1 ./...            # serialize, useful for shared resources
go test -bench=. -benchtime=1s ./...   # short benches
```

For dev loops, `go test ./pkg` (single package) is much faster than `./...`. Tests cache by default; if you suspect a stale result, `-count=1`.

---

## 11. Binary size investigation

```bash
go tool nm -size -sort=size -n ./bin/app | tail -30
```

Lists the largest symbols. Common findings:

- A vendored library you barely use.
- A reflection-heavy package generating per-type code.
- Embedded files via `embed.FS`.
- Cgo libc bloat.

```bash
go build -gcflags='-m=2' ./... 2>&1 | grep "binary size"   # not real, but you get the idea
```

Real tool: [`bloaty`](https://github.com/google/bloaty) for cross-language size analysis.

---

## 12. PGO and binary size

PGO usually doesn't change binary size meaningfully. Inlining more increases size; devirtualization decreases it; net is small. Track via the size-monitoring jobs you already have.

---

## 13. Compile-time benchmarking

```bash
time go build ./cmd/app
```

For large projects, profile the compile itself:

```bash
go build -p 1 -x ./cmd/app 2>&1 | head -50    # see what's compiling
```

Slow packages often have:

- Heavy use of generics (more instantiations).
- Lots of reflect / interface{} (less inlining).
- Heavy cgo with large preambles.

Refactoring is sometimes worth it for build-time savings.

---

## 14. Summary

The biggest build-time optimizations: PGO for runtime perf (5–10%), `-s -w -trimpath` for binary size (10–20%), `CGO_ENABLED=0` for static binaries and faster builds, persistent build cache in CI. Avoid `-N -l` in production; standardize release flags via Makefile.

---

## Further reading
- PGO docs: https://go.dev/doc/pgo
- `bloaty`: https://github.com/google/bloaty
- Go build cache: https://pkg.go.dev/cmd/go#hdr-Build_and_test_caching
