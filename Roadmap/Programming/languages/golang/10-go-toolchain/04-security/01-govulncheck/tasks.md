# govulncheck — Hands-on Tasks

Work through these in order. Each has explicit acceptance criteria. Use Go 1.21+ and govulncheck v1.x.

---

## Task 1: Install and first scan

Install `govulncheck` and run a scan against a fresh module.

```bash
go install golang.org/x/vuln/cmd/govulncheck@latest
mkdir vulndemo && cd vulndemo
go mod init example.com/vulndemo
cat > main.go <<'EOF'
package main
import "fmt"
func main() { fmt.Println("hi") }
EOF
govulncheck ./...
```

**Acceptance criteria**
- [ ] `govulncheck -version` prints a version like `Go: ...  Scanner: govulncheck@v1.x.x`.
- [ ] The scan completes with `No vulnerabilities found.` (or, if your toolchain is old, reports stdlib findings — note which).
- [ ] You can explain in one sentence what "no vulnerabilities found" means.

---

## Task 2: Reproduce a real finding

Force a finding by depending on a known-vulnerable module version.

```bash
go get github.com/some/known-vulnerable@v0.0.0-old
# Or pin an old Go toolchain in go.mod that has a known stdlib CVE
govulncheck ./...
```

(Browse `https://pkg.go.dev/vuln/` for current entries to choose a reproducible example.)

**Acceptance criteria**
- [ ] At least one `Vulnerability #N: GO-YYYY-NNNN` is printed.
- [ ] The output shows a trace pointing into your code.
- [ ] Exit code is `3`: `govulncheck ./...; echo $?` prints `3`.

---

## Task 3: Scan a compiled binary

Build a static binary and scan it in binary mode.

```bash
go build -trimpath -o ./dist/app ./...
govulncheck -mode=binary ./dist/app
```

**Acceptance criteria**
- [ ] Binary-mode scan completes and reports the same vuln IDs as source mode (Task 2).
- [ ] You repeat with `go build -ldflags="-s -w"` and observe coarser (module-level) reporting.
- [ ] You can explain in one sentence why `-s -w` reduces precision.

---

## Task 4: JSON output and grep an OSV ID

Generate JSON and extract a specific finding with `jq`.

```bash
govulncheck -format=json ./... > scan.json
jq -r '.. | objects | .finding? | select(. != null) | .osv' scan.json | sort -u
```

**Acceptance criteria**
- [ ] `scan.json` is valid JSON (`jq empty scan.json` succeeds).
- [ ] You can extract a list of unique `GO-YYYY-NNNN` IDs.
- [ ] You can pull the full OSV record for one ID: `jq 'select(.osv? .id == "GO-2024-XXXX")' scan.json`.

---

## Task 5: GitHub Actions integration

Add a workflow that runs `govulncheck` with JSON output and fails on findings.

```yaml
name: vulnscan
on: [pull_request, schedule]
jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: { go-version-file: go.mod }
      - run: go install golang.org/x/vuln/cmd/govulncheck@v1.1.3
      - run: govulncheck -format=json ./... > scan.json
      - run: |
          if jq -e '.. | objects | .finding? | select(. != null and .fixed != null)' scan.json > /dev/null; then
            echo "vulnerabilities found"; jq '.finding // empty' scan.json; exit 1
          fi
```

**Acceptance criteria**
- [ ] Pipeline passes on a clean repo.
- [ ] Pipeline fails (red) when you reintroduce the Task 2 dependency.
- [ ] CLI version is pinned (`@v1.x.x`), not `@latest`.
- [ ] A scheduled nightly run is configured (`schedule:` cron in the workflow).

---

## Task 6: Scan a deployed binary in an image

Pull (or build) a container image, extract the binary, and scan it.

```bash
docker create --name tmp myorg/app:1.0
docker cp tmp:/usr/local/bin/app ./app
docker rm tmp
govulncheck -mode=binary ./app
```

**Acceptance criteria**
- [ ] You produce a list of GO-IDs from the shipped artifact (not the source tree).
- [ ] You explain in two sentences why this catches issues that source scans of the current `main` branch can miss.

---

## Task 7: Compare against `osv-scanner`

Install `osv-scanner` and scan the same repo.

```bash
go install github.com/google/osv-scanner/cmd/osv-scanner@latest
osv-scanner --lockfile=go.mod
govulncheck ./...
```

**Acceptance criteria**
- [ ] You list IDs reported by each tool.
- [ ] You can identify at least one ID reported by `osv-scanner` but not by `govulncheck`, and explain it as "present but not reachable from your code."
- [ ] You write 2–3 sentences on which tool you'd use to gate a PR for a Go service and why.

---

## Task 8: Document a known false positive

Create an allowlist file with a documented waiver, and wire a CI script that filters it.

```yaml
# .govulncheck-allowlist.yaml
- id: GO-2024-XXXX
  reason: "Only reachable via CGI mode; we never enable -cgi-bin."
  owner: platform-team
  added: 2025-05-01
  expires: 2025-08-01
```

```bash
#!/usr/bin/env bash
# ci/check_vulns.sh
set -euo pipefail
allowed=$(yq '.[].id' .govulncheck-allowlist.yaml | sort -u)
found=$(jq -r '.. | objects | .finding? | select(. != null) | .osv' scan.json | sort -u)
unwaived=$(comm -23 <(echo "$found") <(echo "$allowed"))
[ -z "$unwaived" ] || { echo "unwaived vulns:"; echo "$unwaived"; exit 1; }
```

**Acceptance criteria**
- [ ] Pipeline passes with the allowlist entry in place.
- [ ] A separate check fails the build if any allowlist entry's `expires` is in the past.
- [ ] You can explain why every waiver carries an expiry date.

---

## Task 9: Schedule a periodic full scan

Configure a scheduled job (cron in CI, or a Kubernetes CronJob) that runs `govulncheck` against the latest released artifact every night and posts results to your team channel.

**Acceptance criteria**
- [ ] The job runs without code changes triggering it.
- [ ] Findings are posted (Slack, email, ticket) within 24h of disclosure.
- [ ] Exit code `3` is treated as "alert, do not retry"; exit `1`/`2` is treated as "tool error, page on-call."
