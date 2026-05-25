# govulncheck — Middle

## 1. Two scanning modes

`govulncheck` has two primary modes, selected by `-mode`:

```bash
govulncheck -mode=source ./...                   # default: scan source
govulncheck -mode=binary path/to/server          # scan a compiled binary
```

**Source mode** (default) requires the full source tree and `go.mod`. It compiles your packages into SSA form and walks the call graph — the most precise mode.

**Binary mode** reads the build info embedded by `go build` into the executable. It knows the module list, the Go toolchain version, and (since recent toolchains) enough symbol info to determine which functions are present. The call-graph precision is lower than source mode, but it works on artifacts you didn't build yourself.

Use binary mode for:
- Vendor-supplied binaries.
- Container images where the source is not on disk.
- Post-deploy verification of what you actually shipped.

---

## 2. Showing the full call stack

By default, `govulncheck` prints one short example trace per finding. For the full picture:

```bash
govulncheck -show=traces ./...
```

This expands every reachable call path from your code to the vulnerable function. It is verbose but invaluable when you need to:
- Decide whether the path is truly exercised in production.
- Locate the import you can swap to dodge the vulnerability.
- Justify a fix priority during triage.

Other `-show` values:
- `-show=verbose` — extra detail per finding.
- `-show=color` — colorize output (handy in terminals).

Combine: `-show=traces,verbose,color`.

---

## 3. The Go vulnerability database

The Go vuln DB lives at https://vuln.go.dev/ and is operated by the Go security team. Entries:
- Have IDs like `GO-YYYY-NNNN`.
- Are stored in **OSV** format (Open Source Vulnerability schema, https://ossf.github.io/osv-schema/).
- Cover the Go standard library and modules published on the public proxy.
- Include the **symbols** (packages and functions) affected — this is what powers reachability analysis.

The DB is a critical input. If a vulnerability hasn't been published there yet, `govulncheck` cannot know about it. Subscribe to the Go security mailing list to learn about new disclosures.

---

## 4. JSON output

For machine processing, use `-format=json` (or the legacy `-json`):

```bash
govulncheck -format=json ./... > scan.json
```

The output is a stream of JSON messages, each with a `"message"` field describing its type (`"config"`, `"progress"`, `"osv"`, `"finding"`). Typical pipeline:

```bash
govulncheck -format=json ./... \
  | jq -c 'select(.finding) | .finding | {osv: .osv, trace: .trace[0].symbol}'
```

This is the basis for almost every CI integration: scan once, then parse the JSON to drive gates, dashboards, or tickets.

Other formats:
- `-format=text` — human-readable (default).
- `-format=sarif` — SARIF, for GitHub code-scanning and similar tools.
- `-format=openvex` — VEX statements for attestations.

---

## 5. CI integration

A minimal GitHub Actions step:

```yaml
- uses: actions/setup-go@v5
  with:
    go-version-file: go.mod
- name: govulncheck
  run: |
    go install golang.org/x/vuln/cmd/govulncheck@latest
    govulncheck -format=sarif ./... > govulncheck.sarif
- uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: govulncheck.sarif
```

For a hard gate on findings:

```bash
govulncheck ./... ; rc=$?
if [ "$rc" -ne 0 ]; then echo "vulns found"; exit "$rc"; fi
```

---

## 6. Exit codes

| Exit code | Meaning |
|-----------|---------|
| `0` | Scan completed; no vulnerabilities found |
| `3` | Scan completed; one or more vulnerabilities found |
| `1` or `2` | Error (invalid arguments, scan failed, network issue) |

Notice `3` for "found vulnerabilities" — it's distinct from a tool error, which lets CI tell apart "scanner crashed" from "scan worked and discovered something."

In a CI shell, do not blindly `set -e` and discard the difference:

```bash
govulncheck ./...
case $? in
  0) echo "ok" ;;
  3) echo "vulns: failing build"; exit 1 ;;
  *) echo "govulncheck error"; exit 2 ;;
esac
```

---

## 7. "Zero matches" is not "safe"

A clean run means **none of the vulnerabilities currently in the Go vuln DB are reachable from your code right now.** It does not mean:

- Your code is bug-free.
- There are no zero-days waiting to be disclosed.
- Non-Go dependencies are clean.
- Your runtime config (TLS, headers, secrets) is hardened.

Treat `govulncheck` as one layer of defense. Combine it with `staticcheck`, code review, dependency review (`osv-scanner` for the broader ecosystem), and runtime monitoring.

Also: the DB grows. A scan that was clean yesterday may report findings tomorrow without your code changing — schedule periodic scans, not only PR-time scans.

---

## 8. Targeting tests and tagged builds

```bash
govulncheck -test ./...                  # include _test.go files in the call graph
govulncheck -tags=integration ./...      # consider tagged files
govulncheck -C ./subdir ./...            # cd to subdir before running
```

If your production code never reaches a vulnerable symbol but your test code does, that is usually fine — but knowing the difference matters when the trace points only into `_test.go`.

---

## 9. Summary

`govulncheck` has two modes: source (precise, needs `go.mod`) and binary (works on compiled artifacts via embedded build info). Use `-show=traces` for full call stacks, `-format=json|sarif` for machine output, and exit code `3` as the signal that something was found. The Go vuln DB at `vuln.go.dev` (OSV format) is the source of truth; "no findings" means none in that DB are reachable today, not that your code is safe forever.

---

## Further reading
- govulncheck reference: https://pkg.go.dev/golang.org/x/vuln/cmd/govulncheck
- Go vuln DB: https://vuln.go.dev/
- OSV schema: https://ossf.github.io/osv-schema/
- SARIF for code scanning: https://docs.github.com/en/code-security/code-scanning
