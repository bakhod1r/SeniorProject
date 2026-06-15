# Supply-Chain Integrity — Optimization

> Honest framing first: "optimizing" supply-chain integrity is not about making `govulncheck` run faster. It is about getting the *most security per unit of effort and friction*. The defenses are cheap to run; the expensive parts are the workflow around them — flaky CI gates that get bypassed, scans that produce noise nobody acts on, controls that are optional and therefore skipped, and a verification budget spent on low-risk links while the high-risk ones go unguarded. Each entry below states the problem, shows a "before" and an "after," and the realistic gain. The closing sections cover measurement and where hardening is the wrong tool.

---

## Optimization 1 — Cache `govulncheck` instead of reinstalling per job

**Problem:** Every CI job runs `go install golang.org/x/vuln/cmd/govulncheck@latest`, recompiling the tool from source on each run — tens of seconds of pure overhead, multiplied across every push.

**Before:**
```yaml
- run: go install golang.org/x/vuln/cmd/govulncheck@latest
- run: govulncheck ./...
```
The install recompiles `govulncheck` and its deps every time.

**After:**
```yaml
- uses: golang/govulncheck-action@v1
  with:
    go-version-input: '1.23'
    repo-checkout: false
```
The official action manages a pinned, cached binary. (Or pin a specific version and cache `$GOBIN` with `actions/cache`.)

**Expected gain:** Removes the per-job compile of the scanner — typically 20–40 seconds saved per job. Pinning the version also makes scan results reproducible (a floating `@latest` can change findings between runs).

---

## Optimization 2 — Scan on a schedule, not only on change

**Problem:** A push-only scan never re-examines code you are not currently touching. CVEs disclosed against already-shipped, stable dependencies stay invisible until something happens to rebuild that area — sometimes months of silent exposure.

**Before:**
```yaml
on: [push]
```
Only changed code is ever scanned.

**After:**
```yaml
on:
  push:
  pull_request:
  schedule:
    - cron: '0 6 * * 1'   # weekly re-scan of unchanged code
```

**Expected gain:** Exposure window for a newly-disclosed CVE in a shipped dependency drops from "whenever someone next builds that area" (unbounded) to at most the schedule interval (a week). This is the single highest-value, lowest-cost change for most teams.

---

## Optimization 3 — Scan SBOMs of deployed artifacts, no rebuild required

**Problem:** Re-scanning source tells you about the code in your repo. It does not tell you whether the *binary running in production* — built weeks ago — is now known-vulnerable. Rebuilding everything to find out is wasteful.

**Before:** A CVE drops; an engineer manually checks out old tags, rebuilds, and runs `govulncheck` to find which deployments are affected.

**After:**
```bash
# At build/release time, emit and store an SBOM per artifact:
cyclonedx-gomod bin -json -output sbom.json ./app

# Continuously, against stored SBOMs (no rebuild):
osv-scanner --sbom sbom.json
```
Run the SBOM scan on a schedule across your stored SBOM inventory.

**Expected gain:** "Which deployed services are affected by this new CVE?" becomes a query over stored SBOMs answered in seconds, instead of a manual rebuild-and-scan campaign. Incident response time drops from hours to minutes.

---

## Optimization 4 — Make supply-chain checks mandatory, not advisory

**Problem:** A scan that runs but does not gate merges is theater. `govulncheck ./... || true`, or a non-required status check, lets vulnerable code merge while the team *believes* it is protected.

**Before:**
```yaml
- run: govulncheck ./... || true   # never fails the build
```
Plus the job is not a required check, so PRs merge regardless.

**After:**
```yaml
- run: govulncheck ./...   # non-zero exit fails the build
```
And in branch protection, mark the supply-chain workflow as a **required** status check.

**Expected gain:** The check transitions from decorative to enforcing. The "optimization" is removing wasted effort — a scan nobody acts on is pure cost. For documented exceptions, use a reviewed allowlist parsed from `-json`, never a blanket `|| true`.

---

## Optimization 5 — Inherit checks via a reusable workflow

**Problem:** Each of 50 repos copies its own supply-chain CI. They drift: some forget the schedule, some omit `go mod verify`, some never added `govulncheck`. Coverage is inconsistent and impossible to audit.

**Before:** 50 hand-maintained `ci.yml` files, each slightly different.

**After:**
```yaml
# org/.github/.github/workflows/supply-chain.yml  (reusable)
on: { workflow_call: }
jobs:
  checks:
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
      - run: go mod verify
      - run: go mod tidy && git diff --exit-code -- go.mod go.sum
      - uses: golang/govulncheck-action@v1
```
```yaml
# each repo's ci.yml
jobs:
  supply-chain:
    uses: org/.github/.github/workflows/supply-chain.yml@v1
```

**Expected gain:** One place to define and upgrade the controls; every repo inherits them. Coverage becomes uniform and auditable (grep for the `uses:` line). Fixing or strengthening a check propagates org-wide with a single version bump.

---

## Optimization 6 — Run a private proxy as a kill-switch and cache

**Problem:** Without a private proxy, every build depends on the public proxy's availability, there is no org-wide way to *block* a version found malicious, and you have no audit log of what was fetched.

**Before:**
```bash
go env GOPROXY   # https://proxy.golang.org,direct
```
A malicious version must be blocked per-repo, reactively, by editing every `go.mod`.

**After:**
```bash
go env -w GOPROXY='https://goproxy.acme.internal,https://proxy.golang.org,direct'
go env -w GOPRIVATE='git.acme.internal,github.com/acme-org/*'
```
The private proxy caches immutably, logs every fetch, and — critically — lets you **deny a specific `module@version` once, org-wide**, instantly stopping every build from using it.

**Expected gain:** Incident containment goes from "edit N repos" to "block once at the proxy." Plus build availability survives public-proxy outages, and you gain a complete audit trail of dependency provenance. Keep `GOSUMDB` on so cached content is still globally verified.

---

## Optimization 7 — Layer the build for a hermetic, cached Docker build

**Problem:** A Dockerfile that downloads modules inside `RUN` busts its layer on every `go.sum` change and reaches the network mid-build, defeating both caching and hermeticity.

**Before:**
```dockerfile
FROM golang:latest AS build
COPY . .
RUN go build -o /app ./cmd/app   # downloads from proxy every layer-bust
```

**After:**
```dockerfile
FROM golang:1.23.2@sha256:<digest> AS build
WORKDIR /src
ENV GOTOOLCHAIN=local GOFLAGS=-mod=vendor GOPROXY=off
# Stable, cached layer: pinned deps + toolchain
COPY go.mod go.sum ./
COPY vendor/ ./vendor/
# Frequently-changing layer: source only
COPY cmd/ ./cmd/
COPY internal/ ./internal/
RUN go build -trimpath -o /app ./cmd/app
```

**Expected gain:** The build is hermetic (no network, pinned toolchain by digest) *and* cache-friendly (the vendor layer is reused across source-only changes). Source edits rebuild a small layer; the build never touches the network. Both a security and a speed win.

---

## Optimization 8 — Separate dependency-bump commits from code commits

**Problem:** A PR that bumps a dependency *and* changes code mixes a noisy `go.sum`/`vendor` diff with the real change. Reviewers cannot tell whether the upgrade or the code introduced a regression, and bisecting later is painful.

**Before:** One commit: "upgrade lib + refactor handler" — thousands of vendor lines plus 30 lines of real code.

**After:**
```bash
# Commit 1: the dependency change, isolated
go get github.com/some/lib@v2.0.0
go mod tidy && go mod vendor
git add go.mod go.sum vendor/
git commit -m "deps: bump some/lib to v2.0.0 (govulncheck clean)"

# Commit 2: the code that consumes the new API
git commit -am "api: adopt lib v2 surface"
```

**Expected gain:** Reviewers can scan the dependency bump (and its `govulncheck` result) independently from the code. Reverting a bad bump becomes a clean single-commit revert. The security-relevant change is no longer buried in feature noise.

---

## Optimization 9 — Differential capability scan only on dependency changes

**Problem:** Running full capability analysis (capslock) on every PR is slow and mostly noise — capabilities only change when dependencies change. But running it *never* means a malicious update's new privilege slips through.

**Before:** Either capslock on every PR (slow, noisy) or never (blind to the malicious-update vector).

**After:**
```yaml
- name: Detect dependency change
  id: deps
  run: |
    git diff --name-only origin/main... | grep -qE '^(go\.mod|go\.sum)$' \
      && echo "changed=true" >> $GITHUB_OUTPUT || true
- name: Capability diff
  if: steps.deps.outputs.changed == 'true'
  run: |
    capslock -packages ./... -output=json > caps.new.json
    diff <(jq -S . caps.baseline.json) <(jq -S . caps.new.json) || \
      echo "::warning::dependency capabilities changed — review"
```

**Expected gain:** Capability analysis runs precisely when it can matter (dependency changes) and surfaces the exact signal that catches `xz`-style backdoors — a dependency gaining network/exec/filesystem access — without burdening every code-only PR.

---

## Optimization 10 — Pin `govulncheck` and the database for reproducible findings

**Problem:** `@latest` for the scanner and a live database mean two runs of "the same" pipeline can produce different findings, making CI non-deterministic and hard to reason about ("it passed yesterday").

**Before:**
```yaml
- run: go install golang.org/x/vuln/cmd/govulncheck@latest && govulncheck ./...
```

**After:**
```yaml
- run: go install golang.org/x/vuln/cmd/govulncheck@v1.1.3   # pinned
- run: govulncheck ./...                                       # default DB, fetched at run
```
For fully air-gapped reproducibility, mirror the vuln DB and point `-db` at the mirror.

**Expected gain:** Findings change only when *you* update the pinned tool (a reviewed event) or when the database legitimately gains an entry — not silently from a tool upgrade. This makes "why did CI start failing?" answerable. Note the trade-off: a pinned-too-long scanner misses new detection improvements, so pin and *update deliberately*, do not freeze forever.

---

## Optimization 11 — Triage informational findings on a cadence, not never

**Problem:** Informational `govulncheck` findings (vulnerable code present but not called) accumulate and get ignored. A later refactor that starts calling one silently converts it to an actionable, exploitable path nobody noticed.

**Before:** Only actionable findings are ever looked at; informational ones pile up indefinitely.

**After:**
```bash
# Periodically, surface informational findings too:
govulncheck -show=verbose ./...   # or parse -json for the informational set
```
Clear them as part of routine dependency updates (e.g. the monthly Dependabot batch), not as emergencies.

**Expected gain:** The "present but uncalled" backlog shrinks over time instead of growing, so a future refactor cannot quietly activate a latent vulnerability. Low effort folded into work you already do.

---

## Optimization 12 — Minimize dependencies to shrink the whole problem

**Problem:** Every dependency is a permanent link in the supply chain — its updates, its transitive deps, its CVEs, its maintainer's trustworthiness. A bloated tree multiplies every other cost: more to scan, more to review, more to keep updated, more attack surface.

**Before:**
```bash
go list -m all | wc -l      # 84 modules, several pulled for one trivial function each
```

**After:**
```bash
go mod why github.com/some/onefunc-lib   # justify it
# replace a one-function dep with a copied, license-compatible implementation
go mod tidy
go list -m all | wc -l      # 71 modules
govulncheck ./...           # CVEs in removed deps are simply gone
```

**Expected gain:** Fewer modules means a smaller attack surface, fewer transitive CVEs, fewer update PRs, and faster scans/reviews. The cheapest vulnerabilities to handle are the ones in dependencies you no longer have. This is the most *durable* optimization — it reduces the size of every other task.

---

## Optimization 13 — Sign and attest at release, verify at admission

**Problem:** Producing signatures and provenance but never *verifying* them is effort with no payoff. Conversely, hand-verifying every deployment does not scale.

**Before:** Releases are signed; nothing checks the signature before deploy. Or: a human is supposed to verify provenance manually (and forgets).

**After:**
```yaml
# Release: sign + attest (keyless, in CI)
- run: cosign sign-blob --yes --bundle app.bundle ./app
- run: cosign attest --yes --predicate sbom.json --type cyclonedx ./app
```
```yaml
# Admission (cosign policy-controller / Kyverno):
# refuse to run any image lacking a valid signature + SLSA provenance
```

**Expected gain:** Verification becomes automatic and unskippable at the deployment boundary. The cluster enforces "only signed, attested, scanned artifacts run," turning the signing effort into an actual guarantee instead of a ceremony. Effort spent producing attestations finally pays off.

---

## Optimization 14 — Spend the verification budget proportionally to risk

**Problem:** Applying the same heavy controls (SLSA L3, full vendoring, manual dependency review) uniformly to every artifact wastes effort on throwaway tools while possibly *still* under-protecting the crown-jewel service — or it gold-plates everything and exhausts the team's tolerance.

**Before:** One uniform, maximal policy for all 50 repos, regardless of exposure. Teams resent the friction on internal tools; the policy gets watered down for everyone.

**After (tiered policy):**
```
Tier 0 (throwaway/internal tools):  go.sum + govulncheck in CI
Tier 1 (internal services):         + scheduled scan, Dependabot, -trimpath
Tier 2 (internet-facing/privileged): + SBOM, signing, SLSA L2, capability diff
Tier 3 (crown jewels/regulated):     + SLSA L3, hermetic builds, admission policy
```

**Expected gain:** The verification budget lands where likelihood × blast radius is highest. High-risk artifacts get strong controls without burning the team out on low-risk ones. Proportional security is the difference between a policy that holds and one that gets bypassed under deadline pressure.

---

## Benchmarking and Measurement

Optimization without measurement is folklore. For supply-chain workflows the useful signals are:

```bash
# How big is the attack surface?
go list -m all | wc -l

# How long does a scan take? (should be CI-cheap)
time govulncheck ./...

# Is the build hermetic? (must succeed with zero network)
GOPROXY=off GOFLAGS=-mod=vendor go build ./...

# Is the build reproducible? (must be byte-identical)
go build -trimpath -o b1 ./cmd/app && go clean -cache
go build -trimpath -o b2 ./cmd/app && cmp b1 b2

# Audit effective security config (catch silent downgrades):
go env -json | jq '{GOPROXY,GOSUMDB,GOPRIVATE,GOFLAGS,GOTOOLCHAIN,GOINSECURE}'

# What actually shipped?
go version -m ./app
```

The metrics that matter most are *not* raw speed: they are **exposure window** (time from CVE disclosure to detection — driven by scan cadence), **mean time to remediate** (driven by SBOM inventory and update automation), **coverage** (fraction of repos inheriting the mandatory checks), and **attack surface** (module count). A change that does not move one of those is not a supply-chain optimization.

---

## When NOT to Over-Harden

Supply-chain controls have real costs in friction, build complexity, and team attention. More is not always better.

- **Throwaway scripts and learning projects:** `go.sum` plus an occasional `govulncheck` is plenty. SLSA, SBOMs, and signing are pure overhead with no consumer to benefit.
- **Small teams without the bandwidth to act on findings:** a scan whose results nobody triages is wasted CI minutes. Start with *one* enforced check (`govulncheck`) and grow only as you build the muscle to respond.
- **Library projects:** consumers run their *own* supply-chain checks against your code in *their* build. Heavy per-library signing/vendoring mostly bloats your distribution; keep `go.sum` clean and scan in your own CI, but do not impose your vendor tree or attestations on consumers.
- **Uniform maximal policy across all artifacts:** gold-plating a throwaway internal tool to SLSA L3 wastes the budget that the internet-facing service needs. Tier the controls (Optimization 14).
- **Disabling protections for convenience, ever:** the inverse failure — the one optimization that is *never* worth it. A "faster" build that sets `GOSUMDB=off` or `-insecure` has optimized away the security itself.

Harden in proportion to risk: heaviest where exposure and blast radius are high, lightest where they are not. The best optimization is often not adding another control — it is making the controls you already have *mandatory, scheduled, inherited, and acted upon*.

---

## Summary

Optimizing supply-chain integrity is optimizing *security per unit of effort and friction*, not tool runtime. The defenses are cheap to run; the waste is in the workflow — scans that only run on push (fix: schedule them), scans nobody enforces or acts on (fix: make them mandatory and gating), controls each repo reimplements and forgets (fix: inherit via reusable workflows), incident response that rebuilds instead of querying stored SBOMs (fix: continuous SBOM scanning), and a uniform policy that gold-plates throwaway tools while exhausting the team (fix: tier controls by risk). The highest-leverage moves are the cheap ones: a weekly scheduled scan that shrinks the CVE exposure window, a private proxy that becomes an org-wide kill-switch, dependency minimization that shrinks every other task at once, and signing-plus-admission-verification that finally makes attestation effort pay off. Measure what matters — exposure window, time-to-remediate, coverage, attack surface — not raw speed. And remember the one optimization that is never worth it: disabling a protection to make a build faster or an error go away. Hardening is proportional security; spend the budget where likelihood meets blast radius, and make the controls you have *unskippable* before adding new ones.
