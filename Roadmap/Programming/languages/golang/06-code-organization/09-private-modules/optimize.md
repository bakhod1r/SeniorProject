# Private Modules — Optimize the Setup

> Each scenario shows a working-but-suboptimal private-module setup and asks for an improvement. Read the "before," apply the suggested optimisation, measure the result.

---

## Optimisation 1 — Tighten an over-broad `GOPRIVATE` glob

**Before.**

```bash
GOPRIVATE=*
```

The user wanted "all my private modules" and reached for the simplest pattern. Now *every* module — including `github.com/google/uuid` and `golang.org/x/sys` — bypasses the public sumdb. They are downloaded from `direct` (sometimes faster), but checksums are no longer verified against `sum.golang.org`.

**After.**

```bash
GOPRIVATE='github.com/acme-corp/*'
```

Tight glob covers only paths under the org. Public deps are verified again, supply-chain protection restored.

**Measured impact.** Restored `sum.golang.org` lookups for ~50 public deps (~50 small HTTP calls on first fetch, cached forever after). Build time barely changes; security posture changes a lot.

---

## Optimisation 2 — Remove `GOSUMDB=off` from a CI pipeline

**Before.**

```yaml
env:
  GOSUMDB: off
  GOPRIVATE: github.com/acme/*
```

Six months ago the team disabled the public sumdb to "fix a flaky CI." Today every dep — public *and* private — is unverified.

**After.** Remove `GOSUMDB: off`. `GOPRIVATE` already skips the sumdb for the matching paths; public deps go back to verifying against `sum.golang.org`.

```yaml
env:
  GOPRIVATE: github.com/acme/*
```

**Measured impact.** 100% of public deps are verified again. Adds < 100ms to a cold build (one HTTP call per dep, parallelised, cached on subsequent fetches). Drops the supply-chain risk meaningfully.

---

## Optimisation 3 — Replace `GOFLAGS=-insecure` with scoped `GOINSECURE`

**Before.**

```bash
GOFLAGS=-insecure go build ./...
```

The team set this because their internal Git server uses a self-signed certificate. But `-insecure` applies to *every* module, including those fetched from the public proxy over the open internet.

**After.**

```bash
GOINSECURE='gitlab.acme.io/*'
go build ./...
```

Only the matching glob is allowed insecure transport. The public proxy still uses validated TLS.

**Measured impact.** Eliminates a TLS-MITM risk on every public-dep fetch. No build-time impact.

(Better fix: install your private CA's root cert on the build machines and stop using `GOINSECURE`. But scoped is much better than global.)

---

## Optimisation 4 — Cache `~/go/pkg/mod` in CI

**Before.**

```yaml
- uses: actions/checkout@v4
- uses: actions/setup-go@v5
- run: go build ./...
```

Every CI run does a full module fetch. Build job: ~120s, of which ~80s is `go mod download`.

**After.**

```yaml
- uses: actions/checkout@v4
- uses: actions/setup-go@v5
- uses: actions/cache@v4
  with:
    path: |
      ~/.cache/go-build
      ~/go/pkg/mod
    key: go-${{ runner.os }}-${{ hashFiles('**/go.sum') }}
    restore-keys: |
      go-${{ runner.os }}-
- run: go mod download
- run: go build ./...
```

**Measured impact.** Cold cache: same 120s. Warm cache: 25s. ~80% saved on every PR after the first.

The cache key is hashed `go.sum` — any dep change invalidates. The `restore-keys` allows partial cache hits when only one dep changed.

---

## Optimisation 5 — Install Athens to halve VCS load

**Before.** Every developer and every CI runner clones private deps directly from GitHub Enterprise. GHE shows 50% CPU on the Git frontend during peak hours.

**After.** Stand up Athens in the corporate network with S3 backing:

```bash
GOPROXY='https://athens.acme.io,direct'
GOPRIVATE='github.com/acme-corp/*'
```

Athens does the actual `git clone` once per version per Athens replica. Subsequent fetches are static-file serves from S3.

**Measured impact.** GHE CPU drops to ~10% peak. Module fetch latency drops from "git clone time" (~1-3s for medium deps) to "S3 GET time" (~50ms).

---

## Optimisation 6 — Use BuildKit secret mounts instead of build args

**Before.**

```dockerfile
ARG GH_TOKEN
RUN echo "machine github.com login x password $GH_TOKEN" > ~/.netrc \
 && go build ./... \
 && rm ~/.netrc
```

The token is in `ARG` history, the layer where `.netrc` was created, and may leak via `docker history`.

**After.**

```dockerfile
# syntax=docker/dockerfile:1.4
RUN --mount=type=secret,id=netrc,target=/root/.netrc \
    go build ./...
```

```bash
DOCKER_BUILDKIT=1 docker build --secret id=netrc,src=$HOME/.netrc -t app .
```

**Measured impact.** Token never lives in any image layer. `docker history app | grep -i token` returns nothing.

---

## Optimisation 7 — Mount the module cache during Docker builds

**Before.** Every `docker build` re-downloads all modules from scratch. Build time: 90s, of which 70s is `go mod download`.

**After.**

```dockerfile
# syntax=docker/dockerfile:1.4
RUN --mount=type=cache,target=/root/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=secret,id=netrc,target=/root/.netrc \
    go build ./...
```

**Measured impact.** Cold: still 90s. Warm: 15s.

The cache is preserved across builds in the BuildKit cache (separate from image layers). Multiple developers on the same Docker daemon share it.

---

## Optimisation 8 — Centralise auth on Athens, drop tokens from dev machines

**Before.** Each engineer carries a personal PAT in `~/.netrc`. Tokens have to be rotated personally; departing engineers' tokens stay valid until manually revoked.

**After.** Athens carries one service-account PAT; engineers set:

```bash
GOPROXY='https://athens.acme.io,direct'
# no .netrc on dev machines
```

Athens authenticates to GitHub on behalf of all consumers.

**Measured impact.** Token sprawl drops to 1. Onboarding for new engineers: install Go, point to Athens, done. Departing engineers: remove their corporate SSO, no leak.

---

## Optimisation 9 — Switch from per-developer SSH keys to a deploy token

**Before.** GitLab CI pipelines use individual engineers' SSH keys. When a person leaves, every pipeline using their key fails.

**After.** Create a project- or group-scoped Deploy Token with `read_repository` scope. Use it in CI:

```yaml
before_script:
  - echo "machine gitlab.acme.io login ${DEPLOY_USER} password ${DEPLOY_TOKEN}" > ~/.netrc
  - chmod 600 ~/.netrc
```

`DEPLOY_USER`/`DEPLOY_TOKEN` are project-level CI variables, masked.

**Measured impact.** Pipeline reliability is no longer coupled to individual engineers. Token rotation is one variable update, no human in the loop.

---

## Optimisation 10 — Trim CI Docker image size by stripping the build toolchain

**Before.** A multi-stage Dockerfile that mistakenly leaves Go installed in the runtime image:

```dockerfile
FROM golang:1.22 AS builder
# ... build ...

FROM golang:1.22       # WRONG — keeps the toolchain
COPY --from=builder /out/app /app
ENTRYPOINT ["/app"]
```

Image size: 850MB. Includes `go`, `git`, certificate authorities, source headers — none of which are used at runtime.

**After.**

```dockerfile
FROM gcr.io/distroless/static-debian12
COPY --from=builder /out/app /app
ENTRYPOINT ["/app"]
```

Image size: ~35MB.

**Measured impact.** 96% smaller image. Faster pulls in production. No `git` binary present, so a compromised app cannot exfiltrate code via `git clone`.

---

## Optimisation 11 — Skip `go.sum` regeneration in CI when deps haven't changed

**Before.** Every CI step runs `go mod tidy` to "make sure things are clean." Adds 5s and may produce diffs that fail the build.

**After.** Run `go mod download` only — it does not modify files. If you want to *check* tidiness, do it as a separate guard step:

```yaml
- run: go mod download
- run: go build ./...
- name: Verify go.mod is tidy
  run: |
    cp go.mod go.mod.orig
    cp go.sum go.sum.orig
    go mod tidy
    diff go.mod go.mod.orig
    diff go.sum go.sum.orig
```

The first three steps are fast and not destructive. The verify step is run once, not on every shard of a parallel matrix.

**Measured impact.** ~5s shaved off every shard.

---

## Optimisation 12 — Pin a tag instead of a branch

**Before.**

```
require github.com/acme-corp/exp v0.0.0-20250408120102-deadbeefcafe
```

The module has no tags — devs always pin a SHA off `main`. When `main` is rebased, the SHA disappears and builds break.

**After.** Tag releases on the upstream and pin the tag:

```
require github.com/acme-corp/exp v0.4.1
```

**Measured impact.** Build robustness goes from "fragile to upstream rebases" to "immutable as long as the tag exists." Forces upstream to publish proper releases — a worthy discipline.

---

## Optimisation 13 — Use a checkout shallow-clone strategy in proxy fetches

**Before.** Athens performs full clones of every private repo. A 5GB monorepo takes 90s to clone. Athens spends a lot of disk on `.git` directories.

**After.** Athens supports `ATHENS_DOWNLOAD_MODE=async_redirect` and various clone strategies. Configure shallow clones:

```toml
[Storage.Disk]
  RootPath = "/var/lib/athens"

[Network]
  GoBinaryEnvVars = ["GOFLAGS=-mod=mod"]
```

For a custom proxy, use `git clone --depth 1 --branch <tag>`. The tag is enough for modules — full history is unused.

**Measured impact.** Per-version fetch on cold cache drops from 90s to ~10s for the monorepo.

---

## Optimisation 14 — Vendor only what changes rarely

**Before.** A team decided "never vendor anything." But they have one foundational dep that hits the network on every build, slowing CI by 8s.

**After.** Vendor only that dep using a directory replacement:

```
replace github.com/acme/foundation => ./vendor-foundation
```

Or for a small enough dep, copy it inline. Or use a Go workspace.

A more controversial pattern: vendor *one* critical dep without vendoring all of them — tools like `gomvp` do this.

**Measured impact.** 8s shaved off cold CI builds.

(General advice: don't vendor everything if you have a working proxy. But vendoring one painful dep can be the right local optimisation.)

---

## Optimisation 15 — Stop polling `@latest` in CI

**Before.** A nightly job runs:

```bash
go get github.com/acme-corp/auth@latest
go get github.com/acme-corp/billing@latest
go mod tidy
```

The fetch is slow because `@latest` always re-checks the upstream. Plus, the build is now non-deterministic.

**After.** Use Dependabot (GitHub) or Renovate (cross-platform) to open PRs with explicit version bumps:

```
- github.com/acme-corp/auth: v1.4.2 -> v1.4.3
```

Dependabot configurations support private modules:

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: "gomod"
    directory: "/"
    schedule: { interval: "weekly" }
    registries:
      - github-acme
registries:
  github-acme:
    type: git
    url: https://github.com
    token: ${{ secrets.DEPENDABOT_TOKEN }}
```

**Measured impact.** Reproducible builds; one PR per dep change with full diff visibility; eliminates the always-runs-and-might-break nightly.

---

## Optimisation 16 — Replace per-glob `GONOSUMDB` with a per-glob `GONOPROXY`

**Before.** A team operates an internal proxy *and* an internal sumdb. They want public deps to use both. They want private deps to use the internal proxy but skip the public sumdb. Their config:

```bash
GOPROXY='https://athens.acme.io,direct'
GOPRIVATE='github.com/acme-corp/*'
```

But this also routes private deps directly via Git (`GONOPROXY` inherits from `GOPRIVATE`), bypassing Athens.

**After.** Use the variables surgically:

```bash
GOPROXY='https://athens.acme.io,direct'
GONOSUMDB='github.com/acme-corp/*'
# do NOT set GOPRIVATE; do NOT set GONOPROXY
```

Now private deps go through Athens (which authenticates them centrally) but don't hit the public sumdb.

**Measured impact.** Private fetches are now centralised on Athens — fewer Git hits on GHE, audit logs in one place. Auth is centralised. The split between routing and verification is now clean.

---

## Optimisation 17 — Pre-warm a CI cache once per branch

**Before.** Every PR gets a cold `go mod download` because the cache key is `hashFiles('**/go.sum')` and `go.sum` differs per branch.

**After.** Use restore keys to fall back to a base cache:

```yaml
- uses: actions/cache@v4
  with:
    path: |
      ~/.cache/go-build
      ~/go/pkg/mod
    key: go-${{ runner.os }}-${{ hashFiles('**/go.sum') }}
    restore-keys: |
      go-${{ runner.os }}-main-
      go-${{ runner.os }}-
```

Have a scheduled job on `main` populate `go-${{ runner.os }}-main-` once a day.

**Measured impact.** First CI run on a feature branch: 25s instead of 80s. After the branch's first run, normal cache hits.

---

## Optimisation 18 — Use BuildKit's `RUN --network=none` for non-fetching steps

**Before.** A long Dockerfile has a series of `RUN` steps. The penultimate step is `go test ./...`, which runs every test against private deps. Network is open the whole time, so a test misfire could try to fetch a fresh dep.

**After.** Lock down network for steps that should not need it:

```dockerfile
# syntax=docker/dockerfile:1.4
RUN --mount=type=cache,target=/root/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    --network=none \
    go test ./...
```

If a test tries to fetch, it fails fast with a network error rather than hitting the internet.

**Measured impact.** Catches tests that rely on hidden network calls; tightens the security model of the build.

---

## Optimisation 19 — Cap the CI matrix's parallel module fetches

**Before.** A matrix CI job runs 20 parallel shards. Each shard does `go mod download` independently. GHE serves the same modules 20 times concurrently, occasionally rate-limiting.

**After.** Run one "warm cache" job first. Have all shards depend on it:

```yaml
warm:
  steps:
    - run: go mod download
    - uses: actions/cache/save@v4
      with:
        path: ~/go/pkg/mod
        key: warm-${{ hashFiles('**/go.sum') }}

shard:
  needs: warm
  strategy:
    matrix:
      shard: [1, 2, ..., 20]
  steps:
    - uses: actions/cache/restore@v4
      with:
        path: ~/go/pkg/mod
        key: warm-${{ hashFiles('**/go.sum') }}
    - run: go test ./shard${{ matrix.shard }}/...
```

**Measured impact.** GHE sees 1 fetch per build, not 20. Shards start ~30s faster. Rate-limit issues disappear.

---

## Optimisation 20 — Replace SSH agent forwarding with sealed credentials

**Before.** Engineers have SSH agent forwarding enabled to a build host. Anyone who SSH-jumps through that host can use forwarded keys to reach private repos. Audit fail.

**After.** Use a per-job, short-lived deploy key on the build host. Or better, use a per-job credential service that issues a one-time PAT scoped to the relevant repos. Either way, no agent forwarding.

**Measured impact.** Removes a privilege-escalation path. Audit logs show which credential pulled which version.

---

## How to measure your wins

A common mistake when optimising private-module setups is not measuring. The metrics that matter:

- **Cold-cache CI build time.** Run after `actions/cache@v4` purge.
- **Warm-cache CI build time.** Steady-state PR builds.
- **Time from `git push` to deploy.** End-to-end, not just module fetch.
- **GHE / GitLab CPU.** If your VCS is the bottleneck, an internal proxy moves the needle.
- **Image size.** `docker images | sort -k7`.
- **Failed-build rate due to fetch issues.** Track in your CI dashboard. If > 1%, your setup has a fragility.
- **Token rotation toil.** If anyone fixes a CI failure caused by an expired PAT, that is a smell.

Optimisations that don't move any of these numbers are noise. Optimisations that move several at once are wins.
