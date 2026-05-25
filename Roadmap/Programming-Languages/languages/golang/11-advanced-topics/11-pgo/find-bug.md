# Profile-Guided Optimization (PGO) — Find the Bug

A collection of realistic PGO failure scenarios. For each: the symptom, the (often subtle) cause, and the fix. Reading them in order builds the intuition you need to diagnose PGO issues in the wild.

---

## Bug 1: The profile captured from a microbenchmark

```bash
go test -bench=BenchmarkOneFunction -cpuprofile=cpu.pgo ./pkg/parser
mv cpu.pgo cmd/server/default.pgo
go build -pgo=auto ./cmd/server
```

**Symptom.** PGO produces no measurable improvement on the real service; in some cases, latency P99 gets slightly *worse*.

**Cause.** The profile shows ~100 % of samples in `parser.OneFunction`. The compiler aggressively inlines that one function across every caller, exceeding the budget, and starves more nuanced decisions elsewhere. The binary is now hyper-tuned for a workload that doesn't exist in prod.

**Fix.** Capture from real traffic:

```bash
curl -o cmd/server/default.pgo \
  "http://prod-pod:6060/debug/pprof/profile?seconds=60"
```

Or merge a microbenchmark capture with a production capture — but only if real prod is the dominant input. Don't ever ship a binary built on a single-function profile.

---

## Bug 2: `default.pgo` in the repo root instead of next to `main`

```
.
├── go.mod
├── default.pgo          ← here
├── cmd/
│   └── server/
│       └── main.go
```

```bash
$ go build -pgo=auto ./cmd/server
$ go version -m ./bin/server | grep pgo
        build   -pgo=off
```

**Symptom.** Build succeeds. PGO silently does nothing. No warning, no error.

**Cause.** `-pgo=auto` looks for `default.pgo` **next to the `main` package**, not at the module root. The file in the root is invisible to the build.

**Fix.**

```bash
mv default.pgo cmd/server/default.pgo
```

Then verify:

```bash
go version -m ./bin/server | grep pgo
# build   -pgo=/abs/path/to/cmd/server/default.pgo
```

---

## Bug 3: Profile referencing functions that no longer exist

```bash
go build -pgo=auto ./cmd/server
# (no error)
```

But quietly, the warning:

```
warning: 72% of samples are from functions not in the build
```

**Symptom.** PGO build completes. Measured gain is much smaller than last release.

**Cause.** A recent refactor renamed or removed several hot functions. The profile still has samples for the old names. The compiler ignores them (correct behavior) but loses most of the signal.

**Fix.** Refresh the profile against the current code:

```bash
bash scripts/refresh-pgo.sh
git commit -am "pgo: refresh after handler refactor"
```

The refresh is mandatory after large renames; otherwise PGO's signal degrades silently across releases.

---

## Bug 4: Profile too small — only a few hundred samples

```bash
curl -o default.pgo \
  "http://localhost:6060/debug/pprof/profile?seconds=5"
go tool pprof -top default.pgo | head
# (300 samples total)
```

**Symptom.** PGO seems to fluctuate between builds — sometimes it helps, sometimes it makes things slightly worse. Hard to reproduce results.

**Cause.** A 5-second capture against light traffic produces too few samples for stable function-hotness rankings. The "hot" function this morning is in the noise tomorrow. The compiler's decisions flip from build to build.

**Fix.** Capture for **at least 60 seconds**, aggregate from **multiple instances**:

```bash
curl -o p1.pgo "http://pod1:6060/debug/pprof/profile?seconds=60"
curl -o p2.pgo "http://pod2:6060/debug/pprof/profile?seconds=60"
curl -o p3.pgo "http://pod3:6060/debug/pprof/profile?seconds=60"
go tool pprof -proto p1.pgo p2.pgo p3.pgo > cmd/server/default.pgo
```

Aim for 30 000+ aggregated samples. Stable across refreshes.

---

## Bug 5: Profile only captures startup

```bash
# Pod just deployed
sleep 2
curl -o default.pgo "http://localhost:6060/debug/pprof/profile?seconds=60"
```

**Symptom.** PGO helps a 30-second cold-start scenario; on long-running steady-state traffic it does nothing.

**Cause.** The capture window started during init: `runtime.init`, package init functions, config loading, cache warmup. These functions dominate the profile but are run **once** per process. The compiler optimizes them — and the steady-state hot path gets nothing.

**Fix.** Wait for steady state before capturing:

```bash
sleep 300   # let the service warm
curl -o default.pgo "http://localhost:6060/debug/pprof/profile?seconds=60"
```

Or capture from a long-running pod, not one that just rolled out.

---

## Bug 6: Devirtualization regression after refactor

A previously hot interface call had one dominant implementation; the profile showed `(*Cache).Get` was 95 % `*RedisCache`. After a refactor that added two more cache backends used roughly equally:

```
samples: (*RedisCache).Get  35%
         (*MemcachedCache).Get 33%
         (*InMemoryCache).Get  30%
```

**Symptom.** PGO build's CPU is now 2 % worse than baseline (the previous release's `default.pgo` ran 5 % faster than non-PGO; the new release does worse than non-PGO).

**Cause.** The stale profile claimed `*RedisCache` dominated. The compiler emitted the type-check fast-path, but now 65 % of calls take the *slow* (interface-dispatch) branch. The type-check itself is now pure overhead on the majority of calls.

**Fix.** Refresh the profile. The fresh profile shows no dominant type → compiler refuses to devirtualize → fast-path overhead disappears. Lesson: any refactor that changes the type-mix of an interface call must trigger a PGO refresh.

---

## Bug 7: Profile from staging that doesn't match prod

Staging traffic is `wrk` against the API at 10 RPS, hitting the same five endpoints.

```bash
curl -o default.pgo "http://staging:6060/debug/pprof/profile?seconds=60"
git commit -am "pgo: refresh from staging"
```

**Symptom.** Production canary regresses 1–3 % CPU after the new release.

**Cause.** Staging traffic is uniform — five endpoints, equal weight. Production traffic is Zipfian — one endpoint takes 60 % of traffic, others tail off. The compiler optimized for "balanced five endpoints" when the real workload is "one endpoint matters most."

**Fix.** Capture from prod, not staging. If you cannot, capture from the staging traffic generator configured to **mimic the prod request distribution**.

---

## Bug 8: Mismatched Go version assumption

A profile was captured on a Go 1.20 release (pre-GA PGO behavior). The team upgraded the toolchain to 1.24 and rebuilt with the same profile.

**Symptom.** Build succeeds; PGO appears to work; measured gain is below expectation.

**Cause.** PGO file format is forward-compatible; the profile is parsed correctly. But the *compiler's interpretation* has improved across versions — devirtualization in 1.21+ is qualitatively better than 1.20's preview implementation. The old profile is technically valid but was captured when the runtime/optimizer mix was different.

**Fix.** Refresh the profile under the new toolchain version. The fix here is operational: tie the profile refresh to the Go toolchain bump.

---

## Bug 9: `go build` succeeds but PGO silently disabled

A CI job sets `GOFLAGS=-pgo=off` from an old experiment and never removes it.

```bash
$ env | grep GOFLAGS
GOFLAGS=-pgo=off
$ go build ./cmd/server
$ go version -m ./bin/server | grep pgo
        build   -pgo=off
```

**Symptom.** `default.pgo` is committed in the right place. CI builds succeed. PGO does nothing. No warning visible to a dev who isn't looking for it.

**Cause.** `GOFLAGS` provides build defaults; `-pgo=off` overrides `-pgo=auto`.

**Fix.** Audit `GOFLAGS` in CI environments. Add a CI step that asserts PGO is on:

```bash
go version -m ./bin/server | grep -E 'build\s+-pgo=' | grep -v '=off' \
  || (echo "ERROR: PGO not applied"; exit 1)
```

---

## Bug 10: Profile bloats the binary unexpectedly

After enabling PGO, the binary went from 45 MiB to 67 MiB (~+49 %).

**Symptom.** Binary size jumped enormously. Container image is now 20 MB larger. Deploy times up.

**Cause.** The profile is from a narrow micro-workload that made one specific call site appear extraordinarily hot. The compiler inlined a large function into hundreds of call sites, exploding code size.

**Fix.** Broaden the profile (longer capture, more endpoints). Audit:

```bash
ls -l ./bin/server.no-pgo ./bin/server.pgo
go tool nm -size -sort=size ./bin/server.pgo | head -20
```

If a few symbols dominate the size jump, those are the ones being over-inlined. Re-capture with a broader workload. Expected normal growth: +1 to +3 %.

---

## Bug 11: PGO and `-race` combined, "no gain"

```bash
go build -race -pgo=auto ./cmd/server
```

**Symptom.** PGO appears to do nothing under `-race`.

**Cause.** The race detector adds runtime instrumentation that dominates execution time. PGO's percentage gain over a `-race` build is much smaller because the absolute time is much larger. PGO is still working — it's just that the relative win is hidden in the instrumentation overhead.

**Fix.** Never ship `-race` builds to production. PGO is for the release build. Use `-race` only in CI and dev.

```bash
# CI race tests (without PGO is fine)
go test -race ./...

# Release build (PGO on, no race)
go build -pgo=auto -trimpath -ldflags='-s -w' ./cmd/server
```

---

## Bug 12: The "committed by accident" non-pgo profile

A teammate committed a `cpu.pgo` from a quick local benchmark. The filename isn't `default.pgo` so PGO doesn't pick it up. But over time, the team forgets which file is which and applies the wrong one.

**Symptom.** Random PGO regressions. Profile content surprises in code review.

**Cause.** Two profile files in the repo, no documented contract for which to use.

**Fix.** One profile per binary, file always named `default.pgo`, located next to `main`. Add a CI check:

```bash
find . -name '*.pgo' ! -name 'default.pgo' \
  && (echo "Stray profile files found"; exit 1) || true
```

Stale profiles in branches die at PR review.

---

## Bug 13: Profile refresh job that never validates the captured file

A scheduled CI job pulls a profile, commits it, opens a PR. No validation. One day the upstream port-forward times out and the captured file is 12 bytes of HTML error text.

**Symptom.** The next build errors out:

```
compile: cannot read profile cmd/server/default.pgo: invalid profile
```

Or worse — the toolchain accepts a zero-byte file and silently builds without PGO.

**Cause.** No validation in the refresh script. A failed capture overwrites a good profile.

**Fix.** Validate every capture before overwriting:

```bash
TMP=$(mktemp)
curl --fail --max-time 90 -o "${TMP}" "${URL}" || exit 1

[ "$(stat -f%z "${TMP}" 2>/dev/null || stat -c%s "${TMP}")" -gt 10240 ] \
  || { echo "Profile too small"; exit 1; }

go tool pprof -top -nodecount=1 "${TMP}" > /dev/null \
  || { echo "Profile not parseable"; exit 1; }

mv "${TMP}" cmd/server/default.pgo
```

Capture, validate, then replace. Never replace then validate.

---

## 14. Summary

PGO bugs fall into a few archetypes: bad profile source (microbenchmark, staging, startup-only), file location mistakes (root vs main), stale-after-refactor, profile too small, environment overrides (`GOFLAGS=-pgo=off`), and operational hygiene issues (refresh job without validation, stray `.pgo` files). The good news: every failure mode is detectable with `go version -m`, the compiler's stale-sample warning, or a small CI assertion. PGO is robust — silent failures are common but always observable.

---

## Further reading
- Official PGO guide: https://go.dev/doc/pgo
- Common pitfalls listed by the Go team: https://go.dev/doc/pgo#caveats
- `pgodebug` flag: search for `pgodebug` in https://github.com/golang/go/tree/master/src/cmd/compile/internal/pgo
- Continuous profiling: https://www.polarsignals.com
