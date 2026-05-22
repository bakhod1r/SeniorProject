# go clean — Optimization

`go clean` mostly *trades* speed for disk. Optimization here means cleaning surgically and not undermining the caches you rely on. Numbers are illustrative.

---

## Exercise 1: Stop cleaning caches you persist

**Before** — CI restores `GOCACHE`/`GOMODCACHE` for speed, then runs `go clean -cache` each job: every build is cold.

**After** — remove the per-job clean entirely:

```yaml
# restore cache; do NOT clean it
- uses: actions/cache@v4
  with: { path: ~/.cache/go-build, key: gocache-${{ hashFiles('**/go.sum') }} }
- run: go build ./...
```

| Metric | clean each job | persist, no clean |
|--------|----------------|-------------------|
| Build time per job | cold (~90s) | warm (~8s) |

The single biggest "optimization" is *not* cleaning.

---

## Exercise 2: Threshold-based cleaning on persistent runners

**Before** — a self-hosted runner is wiped fully on a fixed schedule, throwing away a still-useful warm cache.

**After** — clean only when disk pressure warrants it:

```bash
used=$(df --output=pcent "$(go env GOMODCACHE)" | tail -1 | tr -dc 0-9)
if [ "$used" -gt 85 ]; then go clean -modcache; fi
```

| Metric | always wipe | threshold |
|--------|-------------|-----------|
| Cache warmth | frequently cold | usually warm |
| Disk safety | fine | fine |

---

## Exercise 3: Target the test cache narrowly

**Before** — `go clean -testcache` to re-run one package expires *all* results, so the whole suite re-runs next time.

**After:**

```bash
go test -count=1 ./onepackage/...
```

| Metric | global `-testcache` | targeted `-count=1` |
|--------|---------------------|---------------------|
| Tests re-run | entire suite | one package |

---

## Exercise 4: Re-warm efficiently after a necessary wipe

**Before** — after `go clean -modcache`, the first build serially re-downloads everything on the critical path.

**After** — pre-download in a parallel/early step:

```bash
go clean -modcache
go mod download        # bulk download up front, before build/test steps
```

| Metric | download during build | pre-download |
|--------|-----------------------|--------------|
| Critical-path time | download + build | build only (deps ready) |

---

## Exercise 5: Cold-build verification without slowing every job

**Before** — every PR runs a clean build "to be safe," paying full recompile each time.

**After** — run the cold build only on a schedule or pre-release:

```bash
# nightly job only
go clean -cache && go build ./... && go test ./...
```

| Metric | clean build every PR | scheduled cold build |
|--------|----------------------|----------------------|
| PR feedback time | slow (cold) | fast (warm) |
| Reproducibility check | redundant | still covered |

---

## Exercise 6: Clear fuzz cache to bound disk, keep seeds

**Before** — long fuzzing runs grow the generated corpus cache unbounded on a runner.

**After:**

```bash
go clean -fuzzcache     # clears generated corpus, keeps testdata/fuzz seeds
```

| Metric | unbounded corpus | cleared cache |
|--------|------------------|---------------|
| Disk used by fuzz | grows | reset to seeds |
| Seed corpus | intact | intact |

---

## Measurement checklist
- [ ] Do not `go clean -cache`/`-modcache` per CI job if you persist caches.
- [ ] Clean module cache by disk threshold on persistent runners.
- [ ] Use `-count=1` for targeted test re-runs, not global `-testcache`.
- [ ] `go mod download` up front after a necessary `-modcache` wipe.
- [ ] Run cold builds on a schedule, not every PR.
- [ ] `-fuzzcache` to bound fuzz corpus disk without losing seeds.
