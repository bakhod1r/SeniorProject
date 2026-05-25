# Profile-Guided Optimization (PGO) — Professional

## 1. The production framing

In a real organization, PGO is not "I ran `curl > default.pgo` once and forgot it." It is a small, dedicated piece of release engineering with these responsibilities:

1. **Capture** a representative profile from production on a schedule.
2. **Validate** the profile (sample count, stale ratio, hot-path coverage) before committing.
3. **Commit** the profile through the same review process as code.
4. **Build** with `-pgo=auto` in CI by default; have `-pgo=off` as a baseline lane for A/B.
5. **Measure** the impact via canary + benchmark suite; gate releases on regression.
6. **Roll back** the profile change if a release goes wrong (it is one file).

What follows is what that looks like in practice.

---

## 2. Where `default.pgo` lives in the repo

| Repo shape | Profile location |
|------------|------------------|
| Single-binary repo | `./default.pgo` (next to `main.go`) |
| Monorepo with `cmd/<name>` | `./cmd/<name>/default.pgo`, one per binary |
| Library only | No `default.pgo` — PGO applies to `main` packages |
| Multiple build tags | One profile per dominant tag combination if profiles diverge |

Treat `default.pgo` as **source code**: it is reviewed, committed, blamed, reverted. Git LFS is unnecessary at typical profile sizes (< 5 MiB).

---

## 3. Refresh cadence policy

Concrete options used in industry:

| Cadence | When it fits |
|---------|--------------|
| Every release | Weekly or bi-weekly release train; profile captured in a release-prep step |
| Weekly via CI cron | Long-lived release branches |
| Monthly | Mature, slow-changing service |
| On-demand only | Small/internal services where PGO is "nice to have" |

A reasonable default: **refresh weekly**, automated via a scheduled CI job that captures, validates, and opens a PR with the updated profile.

---

## 4. The refresh script

```bash
#!/usr/bin/env bash
# scripts/refresh-pgo.sh
set -euo pipefail

POD=$(kubectl -n prod get pod -l app=myservice -o name | head -1)
DURATION=${DURATION:-90}
OUTPUT=./cmd/myservice/default.pgo
TMP=$(mktemp)

kubectl -n prod port-forward "${POD}" 6060:6060 &
PF_PID=$!
trap "kill ${PF_PID}" EXIT
sleep 2

curl --fail --silent --max-time $((DURATION + 30)) \
  -o "${TMP}" \
  "http://127.0.0.1:6060/debug/pprof/profile?seconds=${DURATION}"

# sanity: at least 10 KiB and parseable
[ "$(stat -f %z "${TMP}" 2>/dev/null || stat -c %s "${TMP}")" -gt 10240 ]
go tool pprof -top -nodecount=1 "${TMP}" > /dev/null

mv "${TMP}" "${OUTPUT}"
echo "Updated ${OUTPUT}"
```

CI runs this, then opens a PR titled `pgo: refresh production profile (YYYY-MM-DD)`. Two-line diff, one binary file changed, easy to review.

---

## 5. Aggregating profiles across instances

A single pod's profile is noisier than the fleet aggregate. Merging:

```bash
for pod in $(kubectl -n prod get pod -l app=myservice -o name); do
  kubectl -n prod port-forward "${pod}" 6060:6060 &
  sleep 1
  curl -o "samples/${pod//\//_}.pgo" \
    "http://127.0.0.1:6060/debug/pprof/profile?seconds=60" || true
  pkill -f "port-forward ${pod}" || true
done

go tool pprof -proto samples/*.pgo > cmd/myservice/default.pgo
```

Merging across 5–10 instances gives a stable profile and dampens any per-pod weirdness (one pod stuck on a slow client, etc.).

---

## 6. Continuous profiling integration

Continuous profiling platforms (Pyroscope, Parca, Grafana Cloud Profiles, Polar Signals, Google Cloud Profiler) keep a rolling history of CPU profiles. They expose APIs to download the merged profile for a time window — exactly what PGO wants.

### Pyroscope

```bash
curl -G "https://pyroscope.example.com/render" \
  --data-urlencode "query=process_cpu:cpu:nanoseconds:cpu:nanoseconds{service_name=\"myapp\"}" \
  --data-urlencode "from=now-1h" \
  --data-urlencode "until=now" \
  --data-urlencode "format=pprof" \
  -o cmd/myapp/default.pgo
```

### Parca

```bash
parca-cli profile download \
  --query 'process_cpu:cpu:nanoseconds:cpu:nanoseconds{job="myapp"}' \
  --from "$(date -u -d '1 hour ago' +%FT%TZ)" \
  --to "$(date -u +%FT%TZ)" \
  --output cmd/myapp/default.pgo
```

### Google Cloud Profiler

```bash
gcloud profiler profiles download \
  --service=myapp --profile-type=CPU \
  --duration=1h --output-file=cmd/myapp/default.pgo
```

The advantage: no per-pod port-forwarding, no manual capture, and you can window the data to peak hours.

---

## 7. CI / CD pipeline

```yaml
# .github/workflows/build.yml
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: { go-version: '1.24' }

      - name: Validate profile (if present)
        run: |
          if [ -f ./cmd/myapp/default.pgo ]; then
            go tool pprof -top -nodecount=1 ./cmd/myapp/default.pgo > /dev/null
          fi

      - name: Build with PGO
        run: |
          go build -trimpath \
            -ldflags="-s -w -X main.version=${{ github.sha }}" \
            -o ./bin/myapp ./cmd/myapp

      - name: Verify PGO embedded
        run: |
          go version -m ./bin/myapp | grep -E 'build\s+-pgo=' || \
            (echo "PGO not applied"; exit 1)

  refresh-pgo:
    runs-on: ubuntu-latest
    if: github.event_name == 'schedule'
    steps:
      - uses: actions/checkout@v4
      - run: bash scripts/refresh-pgo.sh
      - uses: peter-evans/create-pull-request@v5
        with:
          branch: pgo/auto-refresh
          title: "pgo: refresh production profile"
          commit-message: "pgo: refresh production profile"
```

The build job is normal; the scheduled job opens a PR with the updated profile. A human reviews and merges.

---

## 8. A/B comparison in CI

To prove PGO is still paying for itself, run a benchmark suite in both modes on every release.

```yaml
- name: Bench (baseline, no PGO)
  run: go test -run=^$ -bench=. -count=8 -pgo=off ./bench/... | tee bench-baseline.txt

- name: Bench (with PGO)
  run: go test -run=^$ -bench=. -count=8 -pgo=auto ./bench/... | tee bench-pgo.txt

- name: Compare
  run: |
    go install golang.org/x/perf/cmd/benchstat@latest
    benchstat bench-baseline.txt bench-pgo.txt | tee bench-diff.txt
```

Archive `bench-diff.txt` as a CI artifact. Plot the delta over time. If PGO's measured gain drops toward zero, the profile is stale or the code has shifted away from interface/inline-friendly patterns.

---

## 9. Regression detection

PGO can regress: a new release's profile may push the inliner into a pessimal choice.

Three signals to watch in the canary:

| Signal | Source | Action threshold |
|--------|--------|------------------|
| Request CPU (median) | Prometheus | > 5 % worse than non-PGO |
| Binary size | `ls -l` | > 5 % bigger than expected |
| Compile time (CI) | CI job duration | > 25 % slower |

When a canary regresses, rollback is one of two PRs:

```bash
# rollback the profile only
git revert <profile-commit-sha>

# build without PGO (escape hatch)
go build -pgo=off ./cmd/myapp
```

The second is the emergency: "ship now, investigate later."

---

## 10. Multi-environment profiles

A common question: should `staging` and `production` share a profile?

| Setup | Recommendation |
|-------|----------------|
| Staging mirrors prod traffic | Yes, share `default.pgo` |
| Staging is synthetic | No — staging profile would mislead prod |
| Multiple prod regions, similar workload | Merge into one `default.pgo` |
| Multiple prod tiers (free / paid) | Either merge or maintain two binaries; usually merge |

The general rule: **capture from the workload you want to optimize**. If staging doesn't look like prod, staging's profile doesn't help prod's binary.

---

## 11. Security and review concerns

Two things to know.

1. **The profile contains function names.** It is essentially a list of function and file paths from your repo. If your repo is public, that's already public. If it's private, treat the profile as sensitive (commit to the private repo only).
2. **PRs that change `default.pgo`** are binary diffs and look unreviewable. Add a comment to the PR: where the profile was captured, what time window, what fleet size. Reviewer reads the metadata, accepts on trust.

```text
Title: pgo: refresh production profile
Body:
- Source: prod-us-east, 12 pods
- Window: 2026-05-20 14:00–15:00 UTC (peak hour)
- Duration per pod: 60 s
- Aggregated via: go tool pprof -proto
- Top function (pre): handlers.serveRequest 8.4 %
- Top function (post): handlers.serveRequest 9.1 %
```

Six lines of context turn a blob commit into something a human can evaluate.

---

## 12. Bootstrap problem

The first time you enable PGO, you have no profile yet. The bootstrap:

1. Build and deploy a non-PGO release. (Same code, `-pgo=off`.)
2. Wait for it to take production traffic at peak.
3. Capture a profile.
4. Commit as `default.pgo`.
5. Future builds pick it up automatically via `-pgo=auto`.

There is no chicken-and-egg problem: PGO is strictly additive. You ship without it, then turn it on.

---

## 13. Documenting PGO in your runbook

A one-page section in your service runbook:

```text
PGO
---
- Profile location: cmd/myapp/default.pgo
- Refresh cadence: weekly (via scheduled CI job)
- Capture source: production peak hour, aggregated across all pods
- Expected gain: 4–6 % CPU vs -pgo=off
- Rollback: git revert the profile commit
- Emergency disable: build with -pgo=off
- Where to look if something breaks: bench-diff.txt in CI artifacts
```

A new on-call engineer reads this, understands the contract in 60 seconds.

---

## 14. The "do we even need it?" calculation

PGO has a cost: extra CI minutes, extra review surface, one extra committed file. Run the math:

- Service runs on 200 pods, each costing $50/month → $10 000/month compute.
- PGO saves 5 % CPU → 5 % fewer pods → $500/month saved.
- Engineer time to set up + maintain: ~4 hours/year. Roughly $400 one-time + maintenance.
- ROI: positive after the first month.

For small services (<10 pods), the math may go the other way. PGO is most worth it for **services with significant CPU spend** and **interface- or call-graph-heavy** hot paths.

---

## 15. Summary

Production PGO is release engineering, not a magic incantation. The profile is committed source, refreshed on a cadence, captured from real traffic (ideally via a continuous profiler), validated in CI, A/B-benchmarked on every release, and rolled back with a single revert if it misbehaves. Document the contract in the runbook. The whole apparatus is small but disciplined — and rewards services with substantial CPU footprints.

---

## Further reading
- Official PGO guide: https://go.dev/doc/pgo
- Pyroscope: https://pyroscope.io
- Parca: https://www.parca.dev
- Grafana Cloud Profiles: https://grafana.com/products/cloud/profiles-for-continuous-profiling/
- Google Cloud Profiler: https://cloud.google.com/profiler
- `benchstat`: https://pkg.go.dev/golang.org/x/perf/cmd/benchstat
