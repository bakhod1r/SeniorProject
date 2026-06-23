# go mod — Optimization

Speed up dependency download/verification and keep the graph lean. Numbers are illustrative.

---

## Exercise 1: Cache the module cache in CI

**Before** — every CI job re-downloads all modules from the network.

**After:**

```yaml
- uses: actions/cache@v4
  with:
    path: ~/go/pkg/mod        # GOMODCACHE
    key: gomod-${{ hashFiles('**/go.sum') }}
```

| Metric | cold | cached |
|--------|------|--------|
| `go mod download` time | ~40s | ~2s |
| Network dependency | high | none on hit |

Keyed on `go.sum`, the cache invalidates only when dependencies change.

---

## Exercise 2: Layer the Dockerfile

**Before** — `COPY . .` before downloading modules, so any source change re-downloads everything.

**After:**

```dockerfile
COPY go.mod go.sum ./
RUN go mod download           # cached unless go.mod/go.sum change
COPY . .
RUN go build ./...
```

| Metric | source-only change | with layering |
|--------|--------------------|---------------|
| Module download | every build | only on go.sum change |

---

## Exercise 3: Use a private proxy

**Before** — `GOPROXY=direct` fetches each module from its VCS origin (slow, fragile, rate-limited).

**After:**

```bash
export GOPROXY=https://proxy.internal.example.com,direct
```

| Metric | direct VCS | proxy |
|--------|-----------|-------|
| Download latency | high (git clone) | low (HTTP zip) |
| Upstream outage resilience | none | proxy caches |

A proxy serves prebuilt module zips and survives upstream outages.

---

## Exercise 4: Keep the graph pruned and lean

**Before** — an old `go 1.16` directive loads the full (unpruned) module graph; `go mod` operations are slower on large dependency trees.

**After** — bump the `go` directive to enable pruning:

```bash
go mod tidy -go=1.21
```

| Metric | unpruned (1.16) | pruned (1.17+) |
|--------|-----------------|----------------|
| Graph loaded for common ops | full | pruned subset |
| `go mod graph` size | larger | smaller |

---

## Exercise 5: Drop unnecessary dependencies

**Before** — a heavy dependency pulled in for a tiny utility bloats the graph and build.

**After** — find and remove it:

```bash
go mod why -m github.com/heavy/dep    # find what pulls it in
# replace with stdlib or a lighter alternative, then:
go mod tidy
```

| Metric | with heavy dep | after removal |
|--------|----------------|---------------|
| Modules in build list | N | N - (transitive count) |
| Build/download time | higher | lower |

---

## Exercise 6: `readonly` to avoid surprise graph work

**Before** — builds occasionally mutate `go.mod`/`go.sum`, causing re-resolution and inconsistent CI.

**After:**

```bash
export GOFLAGS=-mod=readonly
```

| Metric | mutable graph | readonly |
|--------|---------------|----------|
| Unexpected resolution work | possible | none (fails fast instead) |

Dependency changes become deliberate, so routine builds never pay resolution cost.

---

## Measurement checklist
- [ ] Cache `GOMODCACHE` in CI keyed on `go.sum`.
- [ ] Layer Dockerfiles so `go mod download` caches independently of source.
- [ ] Use a private `GOPROXY` for speed and resilience.
- [ ] Keep the `go` directive modern so the graph stays pruned.
- [ ] Remove unjustified heavy dependencies (`go mod why`).
- [ ] Use `-mod=readonly` so routine builds do no resolution work.
