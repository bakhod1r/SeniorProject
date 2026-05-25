# govulncheck — Optimization

`govulncheck` walks call graphs and fetches a database on every run. These exercises cut the wall time and the cost of running it repeatedly without weakening the signal. Numbers are illustrative; measure on your own pipeline.

---

## Exercise 1: Cache the module cache and build cache

**Before** — every CI job re-downloads modules and rebuilds the SSA graph from scratch; cold-cache `govulncheck ./...` on a 500-package module takes 60–90s.

**After** — persist `GOMODCACHE` and `GOCACHE` between runs:

```yaml
- uses: actions/cache@v4
  with:
    path: |
      ~/go/pkg/mod
      ~/.cache/go-build
    key: gocache-${{ hashFiles('go.sum') }}
- run: govulncheck ./...
```

| Metric | Cold cache | Warm cache |
|--------|-----------|-----------|
| `govulncheck ./...` wall time | ~75s | ~20s |
| Network egress per run | ~50 MB | ~0 MB |

The vuln DB itself is also fetched per run; if your CI runner can mirror `vuln.go.dev` internally (set `GOVULNDB`), you save another network round-trip.

---

## Exercise 2: Pin the CLI version

**Before** — `go install ...@latest` re-downloads when a new release lands and may behave differently between PRs.

**After:**

```bash
go install golang.org/x/vuln/cmd/govulncheck@v1.1.3
```

| Metric | `@latest` | Pinned `@v1.1.3` |
|--------|-----------|-------------------|
| Repeatability | varies | identical across runs |
| Cache hit | possible re-resolve | served from module cache |
| Triage time per PR | "did the tool change?" | "did the code change?" |

The optimization here is *cognitive*, not just bytes: you stop chasing tool drift.

---

## Exercise 3: Scan only the changed module subtree

**Before** — every PR runs `govulncheck ./...` over the whole monorepo (~5 min on a large repo).

**After** — derive the changed package set and scan a tighter scope:

```bash
changed=$(git diff --name-only origin/main... | xargs -n1 dirname | sort -u | grep -v '^vendor' | sed 's|^|./|')
[ -n "$changed" ] && govulncheck $changed || echo "no Go changes"
```

| Metric | `./...` | Changed-only |
|--------|---------|--------------|
| Time per PR | ~5 min | ~30–60s |
| Risk of missing distant impact | none | small (mitigated by nightly full scan) |

Pair with a **nightly full scan** so anything reachable only via call paths outside the changed subtree is still caught.

---

## Exercise 4: Parallel scans per binary

**Before** — a monorepo with N service binaries runs one giant `govulncheck ./...`; analysis is sequential and dominated by the largest subtree.

**After** — fan out one scan per `cmd/<service>`:

```bash
for d in cmd/*; do
  ( govulncheck -format=json "./$d/..." > "scan-$(basename "$d").json" ) &
done
wait
```

| Metric | Single scan | Per-binary parallel (8 CPUs) |
|--------|-------------|------------------------------|
| Wall time | ~5 min | ~1 min |
| Findings (deduped) | identical | identical (merge JSON in post) |

Reachability is computed per entry point; per-binary scans are strictly more precise and naturally parallel.

---

## Exercise 5: Scan once, query many times

**Before** — three different gates each run `govulncheck` separately (block, report, ticket) — three full analyses.

**After** — scan once, parse the JSON for each consumer:

```bash
govulncheck -format=json ./... > scan.json

# Gate: any HIGH severity?
jq -e '[.. | objects | .finding? | select(. != null and .fixed != null)] | length == 0' scan.json

# Report: list all IDs
jq -r '.. | objects | .osv? | .id' scan.json | sort -u

# Ticket: format for Jira
jq '[.. | objects | .finding? | select(. != null)] | {findings: .}' scan.json
```

| Metric | 3x runs | 1x run + 3 jq passes |
|--------|---------|----------------------|
| `govulncheck` invocations | 3 | 1 |
| Total CI minutes | 3× analysis | 1× analysis + ms parse |

The JSON output is designed for this. Stop re-running the scanner just to ask a different question.

---

## Exercise 6: Binary scans in CI, source scans on schedule

**Before** — CI runs source-mode `govulncheck ./...` on every commit; takes minutes on a large repo.

**After** — in PR CI, **build once** and scan the binary; reserve source mode for a nightly job:

```bash
# PR CI:
go build -trimpath -o ./dist/app ./cmd/app
govulncheck -mode=binary ./dist/app          # fast: reads build info + symbols

# nightly:
govulncheck ./...                             # full source-mode reachability
```

| Metric | Source per-PR | Binary per-PR + nightly source |
|--------|---------------|--------------------------------|
| PR scan time | ~3 min | ~10s |
| Coverage | full reachability | reachability slightly looser per PR; full nightly |

Binary mode is cheap because the heavy lifting (the build) is something you were doing anyway. Pair with nightly source mode to keep full precision on the timeline that matters.

---

## Exercise 7: Daily full + per-PR incremental

**Before** — a single weekly full scan is the only safety net; new disclosures take up to seven days to surface.

**After** — split the cadence:

| Job | Trigger | Scope | Purpose |
|-----|---------|-------|---------|
| PR scan | `pull_request` | changed packages / built binary | Catch regressions on the way in |
| Nightly | `cron` | full source + shipped binaries | Catch newly disclosed vulns affecting unchanged code |
| Release | `release` tag | binary scan of artifact | Verify the thing you ship |

Wire the nightly to your alerting system (Slack/PagerDuty), not just CI dashboards — a fresh disclosure should be a ticket within hours.

---

## Exercise 8: Mirror the vuln DB

**Before** — every CI run fetches OSV index/files from `vuln.go.dev`; on a busy CI farm this is hundreds of requests per hour and a network-dependency.

**After** — mirror the DB (it is a static HTTP layout backed by `github.com/golang/vulndb`), serve internally, point `govulncheck` at it:

```bash
GOVULNDB="https://vulndb.internal.example.com" govulncheck ./...
```

| Metric | Public DB | Internal mirror |
|--------|-----------|-----------------|
| Network latency | 50–200 ms per fetch | LAN |
| Availability dependency | `vuln.go.dev` uptime | your mirror's uptime |
| Auditability | external | logged internally |

Sync the mirror hourly. This also unlocks layering internal advisories alongside the public DB.

---

## Measurement checklist
- [ ] `GOMODCACHE` and `GOCACHE` cached between CI runs.
- [ ] `govulncheck` CLI version pinned (no `@latest`).
- [ ] Per-PR scope is reduced (changed subtree or binary mode); full scan runs nightly.
- [ ] JSON written once and parsed multiple times instead of re-running the scanner.
- [ ] Multi-binary repos fan out one scan per `cmd/*` in parallel.
- [ ] Release pipeline includes a binary-mode scan of the artifact.
- [ ] Vuln DB is mirrored internally if you run a CI farm.
