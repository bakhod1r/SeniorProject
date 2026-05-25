# go tool — Optimization

The `go tool` family is mostly observation/analysis, so "optimization" here means making the tools cheaper to run, more reproducible, and easier to integrate. Numbers are illustrative; measure on your machine.

---

## Exercise 1: Pin the toolchain version for reproducible tool behavior

**Before** — `pprof`, `trace`, `cover` output format drifts between runners that picked up different Go versions; CI parsers break unpredictably.

**After:**

```bash
# go.mod
toolchain go1.22.3

# or per-shell
export GOTOOLCHAIN=go1.22.3
```

Every invocation of `go tool X` now runs the version pinned by the toolchain.

| Metric | unpinned | pinned `go1.22.3` |
|--------|----------|--------------------|
| Output format stability across runners | flaky | deterministic |
| Parser-breaking regressions per quarter | nonzero | 0 (until you bump) |

The cost is a deliberate bump cadence; the benefit is that `nm`/`objdump`/`pprof` output is grep-stable.

---

## Exercise 2: Use `go test -cover` + `go tool cover -html`, not per-file scripts

**Before** — a homegrown shell loop runs `go test` per package, parses output, and concatenates fragments to produce a coverage page.

**After:**

```bash
go test -coverprofile=cover.out -coverpkg=./... ./...
go tool cover -html=cover.out -o coverage.html
```

| Metric | per-file shell loop | one profile + `cover -html` |
|--------|---------------------|------------------------------|
| Lines of glue script | ~80 | 2 |
| Cross-package call coverage | wrong (missed) | correct |
| Runtime | N × test-startup | 1 × test-startup |

`-coverpkg=./...` is the underrated flag: it records coverage for every package the tests touch, not just the package being tested.

---

## Exercise 3: Batch `nm` output through `sort` for size analysis

**Before** — eyeballing `go tool nm app` and guessing what is large.

**After:**

```bash
go tool nm -size -sort=size app | head -50
# top 50 biggest symbols, descending
```

Or group by package prefix to see aggregate weight:

```bash
go tool nm -size app | \
  awk '{ split($4,a,"."); sym=a[1]; size[sym]+=$2 } END { for (k in size) print size[k], k }' | \
  sort -nr | head
```

| Metric | scrolling raw output | sorted/grouped |
|--------|----------------------|-----------------|
| Time to find top offender | minutes | seconds |
| Confidence | guess | data |

---

## Exercise 4: `test2json` once, query many times

**Before** — multiple CI steps each run `go test -v` and re-parse the human output for their own needs.

**After:**

```bash
go test -json ./... > events.jsonl
jq -r 'select(.Action=="fail") | "\(.Package) \(.Test)"' events.jsonl > failures.txt
jq -r 'select(.Action=="output") | .Output' events.jsonl > full-output.log
```

| Metric | re-parse plaintext per step | one JSON stream |
|--------|------------------------------|------------------|
| Test runs | N | 1 |
| Parsing complexity | regex per consumer | `jq` query per consumer |
| Stability across Go versions | fragile | stable schema |

The schema (`testing/internal/testdeps`) is documented and stable; the `go test -v` plaintext is not.

---

## Exercise 5: Cache `pprof`'s symbolization between steps

**Before** — every CI step that opens `cpu.out` re-symbolizes from scratch.

**After** — emit a single `.svg` / `.txt` artifact once and reuse it:

```bash
go tool pprof -svg -output=cpu.svg cpu.out
go tool pprof -top -nodecount=30 -output=cpu.top.txt cpu.out
# downstream steps consume cpu.svg / cpu.top.txt; no re-symbolization
```

| Metric | each step re-opens profile | shared rendered artifacts |
|--------|----------------------------|----------------------------|
| Total `pprof` invocations per build | N | 1–2 |
| Wall time on big profiles | seconds × N | seconds × 1 |

This also makes the profile diffable: a PR can attach `cpu.svg`, and reviewers do not need Go installed.

---

## Exercise 6: Skip `compile`/`link` invocation overhead with the build cache

**Before** — local `make all` triggers `go build` from a cold cache after every `make clean`.

**After** — keep `$GOCACHE` warm and avoid `make clean` for incremental work:

```bash
go env GOCACHE
# /Users/me/Library/Caches/go-build  -- preserve across builds

# CI:
- uses: actions/cache@v4
  with:
    path: |
      ~/.cache/go-build
      ~/go/pkg/mod
    key: go-${{ runner.os }}-${{ hashFiles('**/go.sum') }}
```

| Metric | cold cache | warm cache |
|--------|-----------|------------|
| `go build` time | ~30s | ~2s |
| `go tool compile` invocations | many | few |

`go tool` itself is fast; the cost is the toolchain pipeline (`compile`/`link`) that `go build` orchestrates. Caching turns that pipeline into a no-op for unchanged packages.

---

## Exercise 7: Use `buildid` to skip redundant work

**Before** — CI re-builds and re-packages even when nothing changed.

**After:**

```bash
NEW_ID=$(go tool buildid bin/app 2>/dev/null || echo "")
OLD_ID=$(cat .last-buildid 2>/dev/null || echo "")
if [ "$NEW_ID" = "$OLD_ID" ] && [ -n "$NEW_ID" ]; then
  echo "no input changes; skipping package step"
  exit 0
fi
go build -o bin/app ./cmd/app
go tool buildid bin/app > .last-buildid
```

| Metric | always repackage | gated by `buildid` |
|--------|------------------|---------------------|
| Idempotent CI step | no | yes |
| Wasted package/upload time | every run | only when inputs changed |

---

## Measurement checklist
- [ ] `GOTOOLCHAIN` pinned in CI and `go.mod`.
- [ ] One `cover.out` per build; one `coverage.html` artifact.
- [ ] `nm -size -sort=size` is part of the binary-size dashboard.
- [ ] `go test -json` everywhere; no `-v` parsing in scripts.
- [ ] `pprof` rendered once into shared artifacts.
- [ ] `GOCACHE`/`GOMODCACHE` persisted between CI jobs.
- [ ] `buildid`-gated steps for expensive idempotent work.
