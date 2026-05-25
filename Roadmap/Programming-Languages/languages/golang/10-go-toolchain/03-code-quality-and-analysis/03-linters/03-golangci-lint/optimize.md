# golangci-lint — Optimization

A run of `golangci-lint` loads every package once, runs N analyzers over them, and writes results. These exercises reduce wall time, memory, and noise. Numbers are illustrative; measure on your machine.

---

## Exercise 1: Persist `~/.cache/golangci-lint` between CI runs

**Before** — every PR job loads, type-checks, and analyzes from scratch:

```yaml
- run: golangci-lint run ./...
```

**After** — use the official action (which caches `~/.cache/golangci-lint`, `~/.cache/go-build`, and `~/go/pkg/mod`) or `actions/cache`:

```yaml
- uses: golangci/golangci-lint-action@v6
  with:
    version: v1.59.1
```

| Metric | No cache | Warm cache |
|--------|----------|-----------|
| Lint job wall time on 200-pkg repo | ~5m | ~25s |
| Network egress | re-download deps | none |

The cache key includes the `.golangci.yml` hash and Go version, so config changes invalidate it correctly.

---

## Exercise 2: Disable redundant linters

**Before** — config enables overlapping checks; lint takes 40s and reports two findings per real issue:

```yaml
linters:
  enable:
    - govet
    - staticcheck
    - gosimple   # most checks already covered by staticcheck
    - deadcode   # superseded by unused
    - varcheck   # superseded by unused
    - structcheck# superseded by unused
```

**After** — drop the superseded linters; `staticcheck` already includes the `S1xxx` (simple) and `SA1xxx` (analysis) families, and `unused` is the modern whole-program checker:

```yaml
linters:
  enable:
    - govet
    - staticcheck
    - unused
```

| Metric | Before | After |
|--------|--------|-------|
| Linters enabled | 6 | 3 |
| Wall time | ~40s | ~22s |
| Duplicate findings per issue | 2 | 1 |

---

## Exercise 3: `--new-from-rev` on PRs

**Before** — every PR re-reports thousands of legacy findings; signal is lost in the noise and CI is slow:

```bash
golangci-lint run ./...
```

**After** — lint only what the PR changed; the linter still loads everything but most analyzers short-circuit on unchanged packages, and the *output* is scoped:

```bash
golangci-lint run --new-from-rev=origin/${BASE_BRANCH} ./...
```

| Metric | Full repo lint | `--new-from-rev` |
|--------|---------------|-----------------|
| Findings on a 10-line PR | 4,217 | 0-3 |
| Reviewer signal | drowned | actionable |
| Wall time | ~30s | ~25s |

Requires full git history in CI (`fetch-depth: 0`).

---

## Exercise 4: `--fast` preset for pre-commit

**Before** — pre-commit hook runs the full set (with `unused`, `gosec`), takes 20s, devs disable the hook:

```bash
golangci-lint run ./...
```

**After** — local hook uses only fast linters; CI keeps the full set:

```bash
# .git/hooks/pre-commit
golangci-lint run --fast ./...
```

`--fast` runs only the linters that do not require type info or whole-program analysis (`gofmt`, `goimports`, `ineffassign`, `misspell`, etc.).

| Metric | Full | `--fast` |
|--------|------|---------|
| Pre-commit wall time | ~20s | ~1.5s |
| Catches govet/staticcheck issues | yes | no (CI does) |

---

## Exercise 5: Exclude generated files via `issues.exclude-dirs`

**Before** — lint walks into `gen/`, `pb/`, and `mocks/` directories full of generated code, producing noise and slowing the run:

```yaml
issues: {}
```

**After:**

```yaml
issues:
  exclude-dirs:
    - gen
    - internal/pb
    - mocks
  exclude-files:
    - ".*\\.pb\\.go$"
    - ".*_mock\\.go$"
```

| Metric | Including generated | Excluding |
|--------|---------------------|-----------|
| Packages analyzed | 312 | 248 |
| Findings | 1,400 (mostly noise) | 90 |
| Wall time | ~45s | ~30s |

Auto-detection of `// Code generated ... DO NOT EDIT.` headers handles most cases; `exclude-dirs` covers generators that omit the header.

---

## Exercise 6: Set `concurrency` to the actual CPU quota

**Before** — running in a 2-vCPU CI container, golangci-lint defaults to `concurrency = NumCPU` (which on cgroup-limited Linux reports the host's CPUs, e.g., 32). Oversubscription causes thrashing:

```yaml
run: {}
```

**After:**

```yaml
run:
  concurrency: 2   # match the CI container's quota
```

Or via `GOMAXPROCS` (the linter respects it):

```bash
GOMAXPROCS=2 golangci-lint run ./...
```

| Metric | Default in 2-vCPU container | `concurrency: 2` |
|--------|----------------------------|-----------------|
| Wall time | ~50s | ~28s |
| Peak RSS | ~3 GB (32 packages in flight) | ~700 MB |

---

## Exercise 7: Pin the version — newer = more findings = drift

**Before** — `latest` in CI:

```yaml
- uses: golangci/golangci-lint-action@v6
  with:
    version: latest
```

Every silent upgrade adds linters or strengthens existing ones, intermittently failing previously-green PRs and creating an unpredictable lint debt.

**After:**

```yaml
- uses: golangci/golangci-lint-action@v6
  with:
    version: v1.59.1
```

| Metric | `latest` | `v1.59.1` |
|--------|---------|----------|
| New findings appearing without code change | sporadically | never |
| Reproducibility | low | high |
| Version bumps in PRs | implicit, untracked | explicit, reviewed |

Pair with a renovate/dependabot rule that opens a PR when a new golangci-lint release is available — bump deliberately.

---

## Exercise 8: Split a huge run into parallel sub-tree jobs

**Before** — one job lints the whole monorepo, hitting memory limits and taking 8 minutes:

```bash
golangci-lint run ./...
```

**After** — fan out by sub-tree:

```yaml
strategy:
  matrix:
    target: ["./cmd/...", "./internal/api/...", "./internal/store/...", "./pkg/..."]
steps:
  - uses: golangci/golangci-lint-action@v6
    with:
      version: v1.59.1
      args: ${{ matrix.target }}
```

| Metric | Single job | 4 parallel jobs |
|--------|-----------|----------------|
| Wall time | ~8m | ~2m30s |
| Peak RSS per runner | ~5 GB (OOM risk) | ~1.5 GB |

Caveat: whole-program linters like `unused` lose accuracy when packages are linted in isolation. Run `unused` in a separate full-repo job.

---

## Measurement checklist
- [ ] Persist `~/.cache/golangci-lint` (and Go caches) in CI.
- [ ] Drop linters whose checks are already covered by another.
- [ ] Use `--new-from-rev` on PRs; full-repo lint in a separate informational job.
- [ ] Use `--fast` locally, full set in CI.
- [ ] Exclude generated directories explicitly.
- [ ] Set `concurrency` (or `GOMAXPROCS`) to the real CPU quota.
- [ ] Pin the version; bump deliberately.
- [ ] Split very large repos across parallel jobs by sub-tree.
