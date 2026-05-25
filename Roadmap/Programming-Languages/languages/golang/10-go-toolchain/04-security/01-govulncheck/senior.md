# govulncheck — Senior

## 1. Designing the CI gate

A useful policy distinguishes "block the build" from "notify the team":

| Trigger | Action |
|---------|--------|
| Reachable vuln in stdlib or direct dependency, severity HIGH/CRITICAL | Block PR; require fix or documented waiver |
| Reachable vuln in transitive dependency, severity HIGH/CRITICAL | Block; allow waiver with expiry date |
| Reachable vuln, severity MEDIUM | Warn; require ticket; fail nightly build if unresolved after N days |
| Informational (vuln present in dep but **not reachable**) | Log only |
| Tool error (exit code other than 0 or 3) | Fail loudly; do not silently treat as "no vulns" |

Implement with the JSON output and `jq`:

```bash
govulncheck -format=json ./... > scan.json
jq -e '[.[] | select(.finding) | .finding | select(.fixed != null)] | length == 0' scan.json
```

The exact severity classification is your call — the OSV record carries `database_specific.severity` for Go-DB entries, and `affected[].ecosystem_specific` carries reachable symbols. Build the gate on those fields, not on string greps.

---

## 2. Version skew: CLI vs toolchain

`govulncheck` and your Go toolchain are independent:

- `govulncheck -version` prints the CLI version.
- `go version` prints the toolchain version (which determines the stdlib being scanned).

Mismatches matter:
- Old `govulncheck` against a new toolchain may not understand newer build info layouts (binary mode) or new analysis features.
- New `govulncheck` against an old toolchain may report stdlib vulns that the toolchain genuinely has; the fix is to upgrade Go.

Pin both in CI. Don't run `@latest` in shared pipelines:

```bash
go install golang.org/x/vuln/cmd/govulncheck@v1.1.3
```

Track the upstream changelog and bump deliberately, the same way you treat any security tool.

---

## 3. Patching cadence

The Go vuln DB updates as soon as new advisories are published. Two cadences a team should run:

| Cadence | Scope | Purpose |
|---------|-------|---------|
| Per-PR | Modified packages (or whole module) | Catch regressions on the way in |
| Nightly / scheduled | Whole module **and** built artifacts | Catch newly disclosed vulns affecting code that hasn't changed |

The nightly job is the one that catches "the world changed, your code didn't." Wire it to your alerting system so a fresh disclosure becomes a ticket within hours, not at the next deploy.

---

## 4. Scanning binaries built elsewhere

For supply-chain assurance, scan the artifact you actually shipped:

```bash
govulncheck -mode=binary ./dist/server
govulncheck -mode=binary /usr/local/bin/some-vendor-tool
```

Binary mode reads:
- Embedded module info (since Go 1.18, `runtime/debug.ReadBuildInfo`).
- Function symbol info (for reachability), when present.

If the binary was built with `-ldflags="-s -w"` or `-trimpath`, module info is preserved (it's in a separate section, `.go.buildinfo`), but symbol granularity drops, reducing precision. If the binary was built by `go build` from an older toolchain, you might only get the module list — `govulncheck` then falls back to module-level reporting.

Realistic flow: build artifact → push to registry → scan registry copy on a schedule → alert if any module changes severity.

---

## 5. Compared to other scanners

| Tool | Coverage | Precision | Notes |
|------|----------|-----------|-------|
| `govulncheck` | Go modules + Go stdlib via Go vuln DB | High (call-graph reachability) | First-party; the trace points to your code |
| `osv-scanner` | Multi-language via OSV | Medium (no reachability by default) | Broader ecosystem; uses the same OSV schema |
| Trivy | OS packages, container layers, language deps | Medium | Strong at container scanning, not call-graph aware |
| Snyk | Multi-language, commercial | Medium-High (some call-graph features in paid tiers) | UI/policy/SBOM heavy; licensing trade-off |

Practical guidance: run `govulncheck` for Go reachability findings (block on those), and `osv-scanner` or Trivy for non-Go and container-layer findings (informational unless you ship those layers). Don't replace `govulncheck` with a generic SCA — you lose the reachability signal that makes it actionable.

---

## 6. Custom or private vuln DB

`GOVULNDB` selects the database URL:

```bash
GOVULNDB="https://vuln.example.com" govulncheck ./...
```

Use cases:
- An air-gapped CI environment with a mirrored DB.
- An organization that maintains internal advisories for private modules.
- Layering a corporate DB on top of the public one (set `GOVULNDB` to a comma- or pipe-joined list, depending on the version — check the docs).

If you mirror the public DB, periodically sync from `https://vuln.go.dev` and verify checksums.

---

## 7. Suppressing known false positives

`govulncheck` has **no built-in suppression mechanism**. Intentionally — the team prefers you fix or document, not silently mute.

Workaround pattern: maintain a checked-in allowlist with rationale and expiry:

```yaml
# .govulncheck-allowlist.yaml
- id: GO-2024-2598
  reason: "Vuln only triggered when CGI mode is enabled; we run plain HTTP."
  added: 2024-09-01
  expires: 2025-03-01
  owner: platform-team
```

Then in CI:

```bash
govulncheck -format=json ./... > scan.json
python3 ci/check_vulns.py scan.json .govulncheck-allowlist.yaml
```

The script filters out allowed IDs (refusing any past `expires`) and fails the build on anything else. Two non-negotiables:
1. Every entry has an **expiry**. Permanent waivers become permanent debt.
2. Every entry has a **rationale** reviewed in PR. "Known FP" is not a rationale.

---

## 8. Operational pitfalls

- **`@latest` in CI** → version drifts; pin the CLI.
- **Source-mode-only** policy → you never verify the shipped artifact; add a binary scan of the released image.
- **Single periodic scan** → new disclosures sit unseen for a week; run nightly.
- **Ignoring exit code 3** → CI passes "successfully" with vulns silently present.
- **Treating all findings equally** → no triage; team learns to ignore the alert.
- **Mixing scanners and adding up findings** → double-counts; pick one as canonical per scope.

---

## 9. Summary

At senior level, `govulncheck` is one input in a layered policy: pin both the CLI and the Go toolchain, gate PRs on reachable findings, scan shipped binaries (not just source) on a schedule, and accept that suppression is intentionally manual — a documented allowlist with expiry is the workaround. Other scanners (`osv-scanner`, Trivy, Snyk) complement it for non-Go scope, but they don't replace the reachability signal that makes `govulncheck` findings worth acting on.

---

## Further reading
- govulncheck CLI: https://pkg.go.dev/golang.org/x/vuln/cmd/govulncheck
- Go vuln DB design: https://go.dev/security/vuln/database
- osv-scanner: https://github.com/google/osv-scanner
- Go security mailing list: https://groups.google.com/g/golang-security-announce
