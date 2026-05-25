# govulncheck — Interview Q&A

A mix of conceptual and practical questions, labeled by level. Answers are concise; expand with examples in a real interview.

---

## Junior

**Q1. What is `govulncheck`?**
Go's official, call-graph-aware vulnerability scanner. It reports only vulnerabilities your code actually reaches, using the Go vulnerability database at `vuln.go.dev`.

**Q2. How do you install it and run a basic scan?**
`go install golang.org/x/vuln/cmd/govulncheck@latest`, then from a module root run `govulncheck ./...`.

**Q3. How does `govulncheck` differ from a generic SCA tool that scans `go.sum`?**
Generic SCA matches CVEs by module name/version and flags everything. `govulncheck` builds a call graph from your code and only reports vulnerabilities whose vulnerable functions are reachable from your code. Less noise, more actionable findings.

**Q4. What does the output "No vulnerabilities found" actually mean?**
None of the currently published Go vuln DB entries are reachable from your code right now. It is not a guarantee of safety: zero-days, non-Go deps, and unpublished issues are invisible.

---

## Middle

**Q5. What is the difference between source mode and binary mode?**
Source mode (`-mode=source`, default) compiles your packages and walks the SSA call graph — precise, requires `go.mod`. Binary mode (`-mode=binary path/to/bin`) reads the build info and symbol table embedded in a compiled binary — works on artifacts you didn't build, less precise.

**Q6. What is the Go vulnerability database and what format does it use?**
A curated DB at `vuln.go.dev` maintained by the Go security team. Entries use the OSV (Open Source Vulnerability) schema and include the specific symbols affected, which is what enables function-level reachability analysis.

**Q7. What does `govulncheck` exit code `3` mean?**
It means the scan completed successfully and found at least one vulnerability. Exit `0` is clean; `1`/`2` are tool errors. Treating `3` as a regular failure (without distinguishing from `1`/`2`) misses the "scanner crashed vs vulns found" distinction.

**Q8. How do you get the full call stack for a finding?**
Pass `-show=traces`. The default output shows one example trace per finding; `traces` expands every reachable path from `main` to the vulnerable symbol.

---

## Senior

**Q9. Why is "no findings" not the same as "no vulnerabilities"?**
The scanner only sees what is in the Go vuln DB and only reports reachable symbols. Vulnerabilities outside the Go DB (non-Go deps, runtime misconfig, zero-days), unreported issues, and dynamic reflection-based dispatch that the static call graph can't model can all hide. The DB also changes over time — yesterday's clean scan may have findings today.

**Q10. How would you design a CI gate around `govulncheck`?**
Output JSON, parse it, and gate by severity and reachability: block on HIGH/CRITICAL reachable findings; warn on MEDIUM; log informational items where the vuln is present in a dep but unreachable. Distinguish exit codes 0/3 from tool errors. Run per-PR for changed scope and a nightly full scan to catch newly disclosed vulns affecting unchanged code.

**Q11. How do you suppress a known false positive?**
There is no built-in suppression. The accepted workaround is a checked-in allowlist file (ID, rationale, owner, expiry) consumed by a CI script that filters JSON output. Every entry must have an expiry date so waivers do not become permanent.

**Q12. Why scan a binary you didn't build yourself?**
Source-mode scans verify code you have; binary mode verifies the artifact you actually shipped. It catches discrepancies between source and build (different Go toolchain, missing dependency update, vendor-supplied binary), and works on closed-source distributions.

---

## Professional

**Q13. How does source mode actually compute reachability?**
It loads packages via `go/packages`, builds SSA with `golang.org/x/tools/go/ssa`, constructs a call graph (typically VTA, variable type analysis), then intersects the reached symbol set with the per-symbol affected lists in OSV records. The OSV `ecosystem_specific.imports[].symbols` field is what makes function-level matching possible.

**Q14. What's required for binary mode to give precise findings?**
The binary must be produced by Go 1.18+ (for embedded build info via `runtime/debug.ReadBuildInfo`) and must retain its symbol table — i.e., do not strip with `-ldflags="-s -w"`. `-trimpath` is fine; it only rewrites paths. Stripped binaries degrade to module-level reporting.

**Q15. How do you operate `govulncheck` in an air-gapped environment?**
Mirror the Go vuln DB (it's a Git repo at `github.com/golang/vulndb` served as a static HTTP layout), serve it internally, and set `GOVULNDB` to your mirror URL. Sync hourly. Pin a specific govulncheck CLI version in CI rather than `@latest`. Optionally layer internal advisories in the same OSV format under your own module namespace.

---

## Common traps

- Treating "no vulnerabilities found" as proof your service is safe.
- Running `govulncheck` only in source mode and never scanning the shipped binary.
- Installing the CLI via `@latest` in CI (version drift; pin instead).
- Stripping binaries with `-ldflags="-s -w"` and wondering why binary-mode findings are coarse.
- Ignoring exit code `3` (treating it like success because no error message printed) or conflating it with `1`/`2`.
- Adding generic-SCA-style suppress lists with no expiry — permanent waivers become permanent debt.
- Comparing finding counts between `govulncheck` and `osv-scanner`/Trivy as if they're equivalent — only `govulncheck` is reachability-aware for Go.
- Scanning once and never again — the DB changes; yesterday's clean scan may have findings today.
- Running on a workstation outside a module and being surprised by "no module found."
