# Supply-Chain Integrity — Hands-on Tasks

> Practical exercises from easy to hard. Each task says what to build, what success looks like, and a hint or expected outcome. Solutions are at the end.

---

## Easy

### Task 1 — Map your trust boundary

Create a module `example.com/sc` with one dependency (`github.com/google/uuid`) and a `main.go` that prints `uuid.New()`. Then:

```bash
go list -m all
go list -m all | wc -l
```

Note how many modules your one direct dependency expands to. List the *transitive* ones — the modules you never named but still ship.

**Goal.** See that your supply chain is larger than your `require` block.

---

### Task 2 — Read `go.sum` line by line

Open `go.sum` from Task 1. For one module, identify the two lines:

- `<module> <version> h1:...` — the hash of the full source tree.
- `<module> <version>/go.mod h1:...` — the hash of just its `go.mod`.

Explain why two hashes exist (hint: the `/go.mod` hash is used during graph construction, before downloading full content).

**Goal.** Understand `go.sum` as a cryptographic receipt, not a wish-list.

---

### Task 3 — Verify integrity explicitly

Run:

```bash
go mod verify
```

Confirm it prints `all modules verified`. Then tamper: find a cached file under `$(go env GOMODCACHE)/github.com/google/uuid@*/` (copy the cache first if you want to restore it), add a byte, and re-run `go mod verify`. Observe the mismatch report. Restore the cache afterward.

**Goal.** See that `go mod verify` re-hashes the *cache* against `go.sum`.

---

### Task 4 — Run govulncheck

```bash
go install golang.org/x/vuln/cmd/govulncheck@latest
govulncheck ./...
```

On a clean project you should see `No vulnerabilities found.` Now add a deliberately old, known-vulnerable dependency version (search `pkg.go.dev/vuln` for a candidate, e.g. an old `golang.org/x/text` or `golang.org/x/net`) and call an affected function. Re-run and read the trace.

**Goal.** Produce a real actionable finding and locate the call site.

---

### Task 5 — Actionable vs informational

Take the project from Task 4. Add the vulnerable dependency to `go.mod` but do **not** call the affected function (import a different, safe part of it). Run `govulncheck ./...`. Observe the finding moves to the **Informational** section.

**Goal.** Internalize that reachability — not mere presence — determines actionability.

---

### Task 6 — Configure a private module

Simulate a private namespace:

```bash
go env -w GOPRIVATE='git.acme.internal,*.acme.internal'
go env GOPRIVATE GONOSUMDB GONOPROXY
```

Observe that `GOPRIVATE` implies the other two for those patterns. Then explain why setting `GOPRIVATE=*` would be dangerous.

**Goal.** Configure private modules narrowly; understand the over-broadening risk.

---

## Medium

### Task 7 — Inspect a built binary

Build your project, then read its embedded module info:

```bash
go build -o app ./...
go version -m ./app
```

Identify the `dep` lines (modules baked in), the `build` lines (settings like `-trimpath`, VCS info). Compare the `dep` versions against `go.mod`. Then rebuild with `-trimpath` and note the `build -trimpath=true` line appears.

**Goal.** Use `go version -m` as the ground-truth inventory of what shipped.

---

### Task 8 — Scan a binary you didn't build from source

Build `app` (Task 7) with a known-vulnerable dependency, then:

```bash
govulncheck -mode=binary ./app
```

Note that binary mode reports module-level findings (no call-graph reachability, because there is no source). Compare its output to source-mode `govulncheck ./...`.

**Goal.** Understand the coarser binary-mode fallback and when to use it.

---

### Task 9 — A hardened CI workflow

Write `.github/workflows/supply-chain.yml` that, on push, PR, and a weekly schedule:

1. Runs `go mod verify`.
2. Runs `go mod tidy` and fails if `git diff` on `go.mod`/`go.sum` is non-empty.
3. Installs and runs `govulncheck ./...`.
4. Builds with `-trimpath`.
5. Sets `permissions: contents: read`.

Push a PR that adds an import without running `go mod tidy`; confirm the tidy gate catches it.

**Goal.** Build the canonical CI gate for integrity + vulnerabilities.

---

### Task 10 — Generate an SBOM

Install and run a CycloneDX generator over your binary:

```bash
go install github.com/CycloneDX/cyclonedx-gomod/cmd/cyclonedx-gomod@latest
cyclonedx-gomod bin -json -output sbom.cdx.json ./app
```

Open `sbom.cdx.json`. Find the `components` array and the `purl` of one component (`pkg:golang/...`). Then generate from the module graph (`cyclonedx-gomod mod`) and diff the two — explain why the binary form is the ground truth.

**Goal.** Produce an SBOM and understand binary-vs-module sourcing.

---

### Task 11 — Scan the SBOM for vulnerabilities

```bash
go install github.com/google/osv-scanner/cmd/osv-scanner@latest
osv-scanner --sbom sbom.cdx.json
```

Confirm it reports the same known vulnerability `govulncheck` found (at module granularity). Explain how this enables *continuous* fleet scanning without rebuilding.

**Goal.** Close the loop from SBOM to continuous vulnerability detection.

---

### Task 12 — Capability analysis

```bash
go install github.com/google/capslock/cmd/capslock@latest
capslock -packages ./...
```

Read the capability report. Identify which dependencies exercise `CAPABILITY_NETWORK`, `CAPABILITY_FILES`, or `CAPABILITY_EXEC`. Then emit JSON (`-output=json`), save it as a baseline, add or bump a dependency, and diff the capabilities.

**Goal.** Use differential capability analysis to spot a dependency gaining new privileges.

---

## Hard

### Task 13 — Prove a reproducible build

Build the same binary twice with a cache clean between, and compare:

```bash
go build -trimpath -buildvcs=false -o b1 ./cmd/app
go clean -cache
go build -trimpath -buildvcs=false -o b2 ./cmd/app
cmp b1 b2
```

If `cmp` reports a difference, hunt the non-determinism (embedded timestamps, VCS state, codegen, build-time randomness). Make the build byte-reproducible.

**Goal.** Achieve and verify bit-for-bit reproducibility.

---

### Task 14 — Prove a hermetic build

Vendor your dependencies, then build with the network disabled and the cache wiped:

```bash
go mod vendor
go clean -modcache
export GOPROXY=off GOFLAGS=-mod=vendor GOTOOLCHAIN=local
go build ./...
```

It must succeed with zero network. If anything tries to fetch, identify which step (codegen, a `tools.go` build dependency, a toolchain download) and eliminate it.

**Goal.** Test the offline/hermetic guarantee end-to-end.

---

### Task 15 — Respond to a CVE end-to-end

Pick a real CVE from `pkg.go.dev/vuln`. Reproduce the full response cycle:

1. Pin your project to the vulnerable version; `govulncheck ./...` confirms it (actionable).
2. Upgrade to the "Fixed in" version: `go get module@fixed`.
3. `go mod tidy && go mod vendor` (if vendoring).
4. `govulncheck ./...` is now clean.
5. Regenerate the SBOM; confirm the version changed.
6. Commit `go.mod`, `go.sum`, `vendor/`, and the SBOM in one reviewable change.

**Goal.** Run vulnerability response as a repeatable process with evidence.

---

### Task 16 — Sign and verify a binary with cosign

Install cosign and sign your binary keylessly (you will be prompted to authenticate via OIDC in your browser for the interactive flow):

```bash
cosign sign-blob --yes --bundle app.bundle ./app
cosign verify-blob \
  --bundle app.bundle \
  --certificate-identity-regexp '.*' \
  --certificate-oidc-issuer-regexp '.*' \
  ./app
```

Then tamper with `app` (append a byte) and re-verify; confirm verification fails. Explain what Rekor records.

**Goal.** Produce and verify a keyless signature; see tamper detection.

---

### Task 17 — Detect a dependency-confusion setup

Construct a scenario: a project imports `acme.io/internal/auth`. Configure two resolution paths — one private (correct) and one where a public look-alike could be resolved. Show that *without* `GOPRIVATE`, the toolchain attempts the public path (and would be vulnerable to confusion), and *with* correctly-scoped `GOPRIVATE`, it always fetches directly from your private source.

**Goal.** Reproduce and defend against dependency confusion.

---

### Task 18 — Audit effective Go security config across machines

Write a script that prints the effective security-relevant config:

```bash
go env -json | jq '{GOPROXY,GOSUMDB,GOPRIVATE,GONOSUMDB,GOINSECURE,GOFLAGS,GOTOOLCHAIN,GONOSUMCHECK}'
```

Run it locally and in CI. Diff the outputs. Flag any dangerous value (`GOSUMDB=off`, `GOPRIVATE=*`, `GOFLAGS=-insecure`). Build the diff into a CI check that fails on a downgraded config.

**Goal.** Catch silent security downgrades and "works for me" config drift.

---

### Task 19 — A SLSA provenance pipeline

For a project hosted on GitHub, configure the SLSA GitHub generator reusable workflow to build a release binary and emit signed L3 provenance on tag push. Then, as a consumer, verify it:

```bash
slsa-verifier verify-artifact app \
  --provenance-path app.intoto.jsonl \
  --source-uri github.com/<you>/<repo> \
  --source-tag v0.1.0
```

Explain why L3 provenance is generated by the build platform, not your build steps.

**Goal.** Produce and verify non-forgeable build provenance.

---

### Task 20 — Minimize the dependency tree

For a real project, audit and shrink the supply chain:

1. `go list -m all | wc -l` (baseline).
2. `go mod why <module>` for each suspicious dependency — justify or remove.
3. Replace a one-function dependency with a copied (license-compatible) implementation.
4. `go mod tidy && go list -m all | wc -l` (after).
5. Re-run `govulncheck` and note any vulnerabilities that disappeared with the removed deps.

Write a one-paragraph recommendation on the resulting attack-surface reduction.

**Goal.** Treat dependency minimization as a measurable security improvement.

---

## Solutions (sketched)

### Solution 1
```bash
mkdir sc && cd sc
go mod init example.com/sc
cat > main.go <<'EOF'
package main
import ("fmt"; "github.com/google/uuid")
func main() { fmt.Println(uuid.New()) }
EOF
go mod tidy
go list -m all          # uuid plus any transitive deps
```
`uuid` is tiny, so the tree is small — but real frameworks expand to dozens.

### Solution 2
Two hashes: the `/go.mod` hash is verified during module-graph construction (before downloading the full zip); the plain `h1:` hash is verified against the full source tree. Both must match.

### Solution 3
`go mod verify` re-hashes the module cache against `go.sum`. A tampered cached file produces `dir has been modified`. It does *not* hash `vendor/` or your code.

### Solution 4
The actionable finding includes `Fixed in:` and an `Example traces:` line pointing at your call site:
```
your-module/main.go:12:9: calls vulnerable.Func
```

### Solution 5
Same vulnerable dependency, but no reachable call → the finding appears under `=== Informational ===` with "not imported by a called function."

### Solution 6
```bash
go env GOPRIVATE       # git.acme.internal,*.acme.internal
go env GONOSUMDB       # inherits the GOPRIVATE patterns
```
`GOPRIVATE=*` would disable checksum-database verification for *every* module, public ones included — a global downgrade.

### Solution 7
```
go version -m ./app
  dep github.com/google/uuid v1.6.0 h1:...
  build -trimpath=true
  build vcs.revision=...
```
`dep` lines are the shipped modules; `build` lines are settings/provenance.

### Solution 8
`govulncheck -mode=binary ./app` reads embedded module info and reports at module granularity (no reachability). Source mode is more precise; binary mode works without source.

### Solution 9
```yaml
on: { push: , pull_request: , schedule: [{ cron: '0 6 * * 1' }] }
permissions: { contents: read }
steps:
  - uses: actions/checkout@v4
  - uses: actions/setup-go@v5
    with: { go-version: '1.23' }
  - run: go mod verify
  - run: go mod tidy && git diff --exit-code -- go.mod go.sum
  - run: go install golang.org/x/vuln/cmd/govulncheck@latest && govulncheck ./...
  - run: go build -trimpath ./...
```
The tidy gate fails when an import was added without `go mod tidy`.

### Solution 10
`cyclonedx-gomod bin` reads the binary's embedded info (ground truth); `cyclonedx-gomod mod` reads `go.mod` (can drift if `replace`/flags altered the graph). Prefer the binary form for release artifacts.

### Solution 11
`osv-scanner --sbom sbom.cdx.json` cross-references the SBOM's `purl`s against OSV. Because it consumes a stored SBOM, you can re-scan deployed artifacts on a schedule without rebuilding.

### Solution 12
`capslock` lists capabilities per package. Baseline with `-output=json`; after a dependency change, diff. A logging lib gaining `CAPABILITY_NETWORK` is a red flag.

### Solution 13
If `cmp` differs, common culprits: `vcs.modified=true` (uncommitted changes), embedded `time.Now()` at build, or non-deterministic codegen. `-trimpath -buildvcs=false` removes path and VCS variance; fix the rest in your own code.

### Solution 14
With `vendor/`, `GOPROXY=off`, `GOFLAGS=-mod=vendor`, `GOTOOLCHAIN=local`, and a wiped modcache, the build must succeed from vendored bytes alone. Network attempts mean a missing vendor entry or a toolchain auto-download (pin it).

### Solution 15
`govulncheck` (confirm) → `go get @fixed` → `go mod tidy`/`vendor` → `govulncheck` (clean) → regenerate SBOM → single commit. The committed SBOM + version bump is the audit evidence the fix shipped.

### Solution 16
`cosign sign-blob --bundle` produces a signature bundle (cert + Rekor entry). Tampering with `app` makes `verify-blob` fail. Rekor records a public, timestamped, tamper-evident entry of the signing event, so signatures cannot be back-dated even after a key/identity compromise.

### Solution 17
Without `GOPRIVATE`, Go resolves `acme.io/internal/auth` via the proxy/sumdb and could fetch a public impostor. With `GOPRIVATE='acme.io/*'` it fetches directly from your authenticated source, defeating confusion.

### Solution 18
```bash
go env -json | jq '{GOSUMDB,GOPRIVATE,GOFLAGS,...}'
```
Fail CI if `GOSUMDB=off`, `GOPRIVATE` is `*`, or `GOFLAGS` contains `-insecure`. Diffing local vs CI catches "works for me" config drift and silent downgrades.

### Solution 19
The SLSA GitHub generator runs the build in an isolated reusable workflow your repo's other steps cannot tamper with, then emits signed L3 provenance. `slsa-verifier` checks the provenance binds the artifact digest to your source tag and builder identity. L3 holds because the provenance is generated by the platform, not by code you control.

### Solution 20
```bash
go list -m all | wc -l        # before: 40
go mod why github.com/some/lib
# remove the import, copy the tiny util
go mod tidy
go list -m all | wc -l        # after: 31
govulncheck ./...             # any vulns in removed deps are gone
```
Fewer modules = smaller attack surface, fewer transitive CVEs, fewer update-vector exposures.

---

## Checkpoints

After completing the easy tasks: you can map your trust boundary, read `go.sum`, verify integrity, run `govulncheck`, distinguish actionable from informational findings, and configure private modules safely.
After completing the medium tasks: you can inspect shipped binaries, scan binaries and SBOMs, build a hardened CI gate, generate SBOMs, and run differential capability analysis.
After completing the hard tasks: you can prove reproducible and hermetic builds, run end-to-end CVE response, sign and verify artifacts, defend against dependency confusion, audit security config across environments, produce SLSA provenance, and measurably minimize the supply chain.
