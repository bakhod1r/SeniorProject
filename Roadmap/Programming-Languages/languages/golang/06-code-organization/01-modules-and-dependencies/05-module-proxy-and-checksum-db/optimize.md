# Module Proxy & Checksum Database — Optimization

> Honest framing first: the proxy and checksum database are network services. The `go` command's cost on a cold cache is dominated by round-trips to `proxy.golang.org` and `sum.golang.org` — TLS handshakes, version resolution, zip downloads, sumdb proof fetches. None of that is slow *code*; it is slow *network*. So "optimizing the proxy and sumdb" really means: cache aggressively, put a fast mirror close to your builders, resolve fewer things over the wire, and decide deliberately when to keep verification on (almost always) versus when its cost is genuinely a problem (almost never).
>
> Each entry states the problem, shows a "before" and "after" setup, and the realistic gain. The closing sections cover measurement and the security lines you must not cross in the name of speed.

---

## Optimization 1 — Cache `$GOMODCACHE` between CI jobs

**Problem:** A fresh CI runner has an empty module cache, so every job re-fetches the entire dependency set from the proxy — tens of seconds to minutes of TLS handshakes and zip downloads, repeated on every push.

**Before:**
```yaml
- uses: actions/setup-go@v5
  with: { go-version: '1.23' }
- run: go build ./...        # cold: pulls 150 modules from proxy.golang.org every job
```

**After:**
```yaml
- uses: actions/setup-go@v5
  with:
    go-version: '1.23'
    cache: true                       # caches $GOMODCACHE, keyed on go.sum
    cache-dependency-path: go.sum
- run: go build ./...
```

**Expected gain:** On cache hits, the download phase drops to ~0. A dependency-stable PR goes from "download + compile" to "compile only." Typical savings: 20–90 seconds per job, multiplied across every push and matrix leg.

---

## Optimization 2 — Put a private mirror close to your builders

**Problem:** `proxy.golang.org` is geographically distant from some build fleets, and its rate limits or transient outages occasionally stall CI. Every cold fetch crosses the public internet.

**Before:**
```bash
GOPROXY=https://proxy.golang.org,direct
# every cache miss is a round-trip to a distant public service
```

**After:**
```bash
GOPROXY=https://athens.corp.example.com,https://proxy.golang.org,direct
# a regional Athens/Artifactory mirror serves cached zips at LAN latency
```

The mirror caches public modules on first request and serves every subsequent fetch from local storage; it can also serve private modules and proxy the sumdb.

**Expected gain:** Cache-miss latency drops from internet RTT to LAN RTT. The fleet becomes resilient to public-proxy outages and rate limits. The headline metric to watch is cold-cache fetch time across the fleet.

---

## Optimization 3 — Warm the cache once, reuse it as a `file://` proxy

**Problem:** A cluster of ephemeral builders each cold-fetch the same dependency set independently, hammering the proxy with identical requests.

**Before:** Every builder runs `go build` against the public proxy from a clean cache.

**After:**
```bash
# Once, on a seed machine:
go mod download all
tar -czf modcache.tgz -C "$(go env GOMODCACHE)" cache/download

# Each builder mounts/extracts it and serves it locally:
GOPROXY="file:///srv/modcache/cache/download" go build ./...
```

Because `cache/download/` *is* the proxy protocol on disk, a shared read-only volume or pre-baked image layer serves all builders with zero network.

**Expected gain:** N builders fetch the dependency set *once* instead of N times. Eliminates redundant proxy traffic entirely and makes builds network-independent.

---

## Optimization 4 — Layer the module cache correctly in Docker

**Problem:** A Dockerfile that copies source and downloads modules in one layer re-fetches every dependency whenever any source file changes, because the cache layer is invalidated.

**Before:**
```dockerfile
FROM golang:1.23 AS build
WORKDIR /src
COPY . .
RUN go build -o /app ./cmd/api      # any source edit busts the layer, re-downloads all modules
```

**After:**
```dockerfile
FROM golang:1.23 AS build
WORKDIR /src
# Rare changes — cached aggressively, download happens here
COPY go.mod go.sum ./
RUN go mod download
# Frequent changes — only this small layer rebuilds
COPY . .
RUN go build -o /app ./cmd/api
```

`go mod download` runs in a layer keyed only on `go.mod`/`go.sum`, so it is reused across all source-only rebuilds.

**Expected gain:** Source-only image rebuilds skip the download phase entirely — 20–60 seconds saved per build, plus reduced proxy traffic and faster developer inner loops.

---

## Optimization 5 — Use `go mod download` to separate fetch from compile

**Problem:** When `go build` does both downloading and compiling, CI logs and timing conflate "the proxy was slow" with "the build was slow," and a proxy hiccup looks like a build failure.

**Before:**
```yaml
- run: go build ./...               # one opaque step: fetch + compile
```

**After:**
```yaml
- run: go mod download              # explicit fetch step (cacheable, retryable)
- run: go build ./...               # pure compile, no network
```

Splitting them lets you cache the download step, retry it independently on transient proxy errors, and measure each phase.

**Expected gain:** Clearer timing attribution, targeted retries on network flakes (instead of re-running the whole build), and a natural cache boundary. The compile step becomes deterministic and network-free.

---

## Optimization 6 — Resolve fewer versions over the wire

**Problem:** Loose version queries (`@latest`, branch names) force the proxy to resolve and the toolchain to fetch `@latest`/`.info` on every run, adding round-trips and non-determinism.

**Before:**
```bash
go get github.com/some/lib@latest   # resolves over the network each invocation
```

**After:**
```bash
go get github.com/some/lib@v1.8.0   # exact version: no resolution round-trip, deterministic
```

Pin exact versions in `go.mod`; let `go.sum` and the cache do the rest. The `.mod`-before-`.zip` ordering already minimizes zip downloads to only compiled packages — pinning removes the resolution chatter too.

**Expected gain:** Fewer proxy round-trips per build, fully reproducible resolution, and no surprise upgrades. The cost is deliberate, scheduled upgrades instead of drift — which is also a correctness win.

---

## Optimization 7 — Cache sumdb tiles to amortize verification

**Problem:** First-time verification of a new module fetches sumdb tiles and proofs over the network. On a cold cache with many new modules, these add up.

**Before:** A clean runner verifies every new module against `sum.golang.org` from scratch each job.

**After:**
```yaml
# Cache the WHOLE download tree, which includes cache/download/sumdb/
- uses: actions/cache@v4
  with:
    path: ${{ env.GOMODCACHE }}/cache/download
    key: modcache-${{ hashFiles('go.sum') }}
```

The cached `sumdb/` tiles and tree heads mean subsequent jobs verify against local state, only fetching the delta.

**Expected gain:** Sumdb verification cost drops to near-zero on cache hits. The proof work is paid once per dependency set, then reused — important for repos with large dependency graphs.

---

## Optimization 8 — Proxy the sumdb for restricted/air-gapped runners

**Problem:** Builders behind a firewall can't reach `sum.golang.org`, so teams reflexively set `GOSUMDB=off` — trading away integrity verification for connectivity.

**Before:**
```bash
GOSUMDB=off            # works behind the firewall, but no integrity verification at all
```

**After:**
```bash
GOPROXY=https://athens.corp.example.com   # Athens proxies sum.golang.org under /sumdb/
GOSUMDB=sum.golang.org                     # verification still runs, via the proxy
```

The mirror forwards sumdb traffic; the client still verifies signatures and proofs end-to-end, so the proxy gains no ability to lie.

**Expected gain:** Restricted networks keep full tamper-evidence instead of disabling it. The "optimization" here is *not paying for connectivity with security* — you get both.

---

## Optimization 9 — Set `GOPRIVATE` to skip pointless public lookups

**Problem:** Without `GOPRIVATE`, internal modules are sent to the public proxy and sumdb, which 404/410 after a wasted round-trip — and leak internal paths.

**Before:**
```bash
# internal module fetched, public proxy tried first, 410s, THEN falls to direct
go get git.acme.internal/team/lib@v1.2.0
```

**After:**
```bash
go env -w GOPRIVATE='git.acme.internal/*,github.com/acme/*'
go get git.acme.internal/team/lib@v1.2.0   # goes straight to VCS, no public round-trip
```

`GOPRIVATE` short-circuits the proxy and sumdb for matching paths — `GONOPROXY` + `GONOSUMDB` in one setting.

**Expected gain:** One fewer failed round-trip per internal module, no leakage of internal paths, and cleaner build logs. The privacy benefit is the bigger win; the latency saving is a bonus.

---

## Optimization 10 — Tune `GOMAXPROCS`-independent fetch concurrency via a mirror

**Problem:** The toolchain parallelizes fetches, but against a distant public proxy the bottleneck is RTT and rate limits, not local CPU. Throwing more parallelism at a far proxy hits rate limits.

**Before:** Cold builds against `proxy.golang.org` saturate connections and occasionally get throttled (429-style backoff), slowing the whole fetch.

**After:** A LAN-local mirror (Athens/Artifactory) absorbs the parallel fetches at low latency without public rate limits. Concurrency then actually helps, because each request is cheap.

```bash
GOPROXY=https://athens.corp.example.com,https://proxy.golang.org,direct
```

**Expected gain:** Parallel module resolution becomes effective rather than rate-limited. The mirror's local bandwidth, not the public proxy's policy, governs throughput.

---

## Optimization 11 — Avoid `GOPROXY=direct` for routine fetches

**Problem:** `direct` mode clones full VCS histories — slow, bandwidth-heavy, and fragile (depends on upstream host uptime and stable tags). Using it as the primary fetch path is a self-inflicted slowdown.

**Before:**
```bash
GOPROXY=direct go build ./...        # full git clone per module, every cold build
```

**After:**
```bash
GOPROXY=https://proxy.golang.org,direct   # cached zips first; direct only as a fallback
```

The proxy serves a pre-packaged zip; `direct` clones the whole repository. The zip is dramatically smaller and faster, and survives upstream takedowns.

**Expected gain:** Cold-fetch time drops substantially (cached zip vs full clone), and builds stop breaking when an upstream tag moves or a repo goes offline. Reserve `direct` for the fallback slot.

---

## Optimization 12 — Don't `go clean -modcache` habitually

**Problem:** Some scripts and developers run `go clean -modcache` as a "reset everything" reflex. It wipes the shared cache, forcing a full re-download (and re-verification) of every module on the next build across *all* projects on the machine.

**Before:**
```bash
go clean -modcache && go build ./...   # nukes the cache "just in case", re-downloads everything
```

**After:**
```bash
go build ./...                          # reuse the cache; it's verified on every build anyway
# Only clean the module cache for genuine corruption:
# go clean -modcache   # reserved for a real checksum/corruption issue
```

The cache is integrity-checked against `go.sum` on every build, so a "stale" cache is not a correctness risk — only corruption warrants a wipe.

**Expected gain:** Eliminates needless multi-minute re-downloads. The cache is a feature; treat clearing it as a last resort, not a routine.

---

## Optimization 13 — Decide honestly whether you even need a mirror

**Problem:** Teams stand up Athens/Artifactory infrastructure — with its operational cost, storage, and maintenance — when the public proxy plus CI caching already meets their needs. The mirror becomes a thing to run for marginal benefit.

**Before:** A small team runs and maintains a self-hosted proxy for a handful of repos with public dependencies and reliable internet.

**After:**
```yaml
- uses: actions/setup-go@v5
  with: { go-version: '1.23', cache: true, cache-dependency-path: go.sum }
- run: go build ./...
```

Rely on the public proxy + CI cache. No mirror to operate.

**When a mirror is justified:** air-gapped/restricted networks, dependency governance/approval gates, geographic distance from the public proxy, serving private modules uniformly, or insulation from public-proxy outages at scale.

**Expected gain (when you skip the mirror):** No infrastructure to run, no storage to manage, one fewer service in the supply-chain path. The best optimization is sometimes the system you don't build.

---

## Optimization 14 — Refresh dependencies on a schedule, not under pressure

**Problem:** A repo that pins versions and never updates accumulates known-vulnerable transitive dependencies. The "optimization" of never touching `go.mod` becomes a security debt that gets paid expensively during an incident.

**Before:** `go.sum` last changed 14 months ago; a CVE scanner flags six patched-upstream vulnerabilities sitting in the dependency graph.

**After:**
```yaml
# .github/workflows/dep-refresh.yml
on:
  schedule: [{ cron: '0 6 1 * *' }]      # 06:00 UTC, first of each month
  workflow_dispatch:
jobs:
  refresh:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: { go-version: '1.23' }
      - run: |
          go get -u=patch ./...
          go mod tidy
      - run: govulncheck ./... || true
      - uses: peter-evans/create-pull-request@v6
        with: { title: 'deps: monthly patch refresh', branch: deps/monthly-refresh }
```

A bot opens a small, reviewable patch-level PR monthly; the proxy serves the new versions, the sumdb verifies them, `go.sum` updates.

**Expected gain:** CVE exposure window shrinks from "whenever someone notices" to ~30 days. The proxy/sumdb make each upgrade verifiable; the schedule makes it routine instead of a fire drill.

---

## Benchmarking and Measurement

Optimization without measurement is folklore. The useful signals for proxy/sumdb workflows:

```bash
# Cold-fetch cost (the headline number a mirror/cache improves):
go clean -modcache
time go mod download all

# Cold-fetch via the proxy vs direct VCS:
go clean -modcache; time GOPROXY=https://proxy.golang.org go mod download all
go clean -modcache; time GOPROXY=direct                 go mod download all

# How big is the cache, and how many modules?
du -sh "$(go env GOMODCACHE)/cache/download"
go list -m all | wc -l

# Prove offline/hermetic behaviour:
GOPROXY=off go build ./...        # must succeed from cache/vendor

# See exactly what hits the network:
go mod download -x 2>&1 | grep -E 'https?://'

# CI level: track cache hit rate and per-job download time over weeks.
# A "proxy optimization" that doesn't move those numbers isn't one.
```

Track two metrics above all: **cold-cache fetch time** (what mirrors and caching reduce) and **proxy/sumdb error rate** (what a mirror and CI cache make resilient). If a change doesn't improve one of those, it isn't an optimization.

---

## The Security Lines You Must Not Cross

Speed is never worth silently weakening integrity. These "optimizations" are anti-patterns, no matter how much time they appear to save:

- **`GOSUMDB=off` to avoid sumdb round-trips.** You lose tamper-evidence on every new module. Cache the tiles or proxy the sumdb instead.
- **`GONOSUMCHECK` / deleting `go.sum` to skip verification.** `GONOSUMCHECK` is removed; deleting `go.sum` discards the integrity record. Neither is a speed win — they are security regressions.
- **`GOINSECURE` / `GOFLAGS=-insecure` for public modules.** Plain-HTTP fetches invite MITM. Scope `GOINSECURE` strictly to trusted internal hosts.
- **A pipe (`\|`) `GOPROXY` to "avoid failures."** It silently bypasses your governance mirror on any error. Use a comma and fix the mirror.

The honest summary: the proxy and sumdb are *cheap* once you cache them. Every shortcut that disables verification trades a few seconds of network for a hole in your supply chain. Cache aggressively, mirror when it pays, pin versions, and keep verification on.

---

## Summary

The proxy and checksum database are not slow; the network around them is, and only on a cold cache. The wins come from treating fetched modules as a *cache to be reused*: cache `$GOMODCACHE` between CI jobs and Docker layers, put a fast mirror near your builders, warm-and-reuse the cache as a `file://` proxy, pin exact versions to cut resolution chatter, and cache the sumdb tiles so verification is paid once. The biggest decision is upstream of all of these — whether you even need a self-hosted mirror (often you don't) and whether your dependencies are being refreshed on a schedule for CVE hygiene (often they aren't). Through all of it, the security lines hold: never disable the sumdb, delete `go.sum`, or relax TLS to shave seconds. The proxy and sumdb are inexpensive once cached, and the integrity they provide is the whole point of having them.
