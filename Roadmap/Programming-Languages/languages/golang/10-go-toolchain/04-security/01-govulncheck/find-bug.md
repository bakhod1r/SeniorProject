# govulncheck — Find the Bug

Each scenario shows a setup or pipeline that looks fine but misbehaves. Find the defect, explain it, and fix it.

---

## Bug 1 — "Zero vulns" but production binary is vulnerable

```bash
# CI scans source on every PR; all green for months.
govulncheck ./...
# No vulnerabilities found.
```

Meanwhile, the deployed image still ships a binary built six months ago with an old `net/http`.

**Bug:** the source-mode scan checks the *current* code against the *current* DB, but the deployed artifact was built earlier with a different toolchain. Source scans never see the production binary.
**Fix:** add a binary-mode scan of the actual shipped artifact, run on a schedule and after each release: `govulncheck -mode=binary ./dist/server` (or pull the binary out of the image and scan it).

---

## Bug 2 — Binary mode reports nothing on an old binary

```bash
$ govulncheck -mode=binary ./legacy-app
govulncheck: could not parse build info from binary: ...
```

**Bug:** the binary was built with Go <1.18 (before `runtime/debug.BuildInfo` was embedded) or was stripped of all metadata. Binary mode has nothing to work with.
**Fix:** rebuild with Go 1.18+ and `-trimpath` (no `-s -w`), or fall back to source scanning. If you must scan that exact binary, you cannot — there is no metadata to inspect.

---

## Bug 3 — Docker image scans against a stale DB

```dockerfile
FROM golang:1.21 AS scan
RUN go install golang.org/x/vuln/cmd/govulncheck@latest
WORKDIR /src
COPY . .
RUN govulncheck ./...
```

This image was built once and cached for weeks. Builds keep using the cached layer; new disclosures are never seen.

**Bug:** the `govulncheck` install layer is cached, **and** the DB fetch happens inside that cached layer's run. Same image → same DB snapshot, regardless of how many days pass.
**Fix:** run `govulncheck` outside the cached layer (in a CI step after `docker build`, or in a stage that uses `--no-cache` / a daily cache-busting ARG). Better: install/run `govulncheck` directly in CI rather than baking it into an image.

---

## Bug 4 — Production binaries scanned in source mode by accident

```yaml
- name: scan release
  run: govulncheck ./...
```

The pipeline scans the source checkout, not the artifact being released. A drift between the build environment and CI's source view is invisible.

**Bug:** missing `-mode=binary path/to/binary`. The scan validates the source, not the thing you're about to ship.
**Fix:** after `go build`, scan the artifact explicitly:

```bash
go build -trimpath -o ./dist/server ./cmd/server
govulncheck -mode=binary ./dist/server
```

---

## Bug 5 — Expecting `govulncheck` to flag every CVE

A reviewer asks: "Why didn't `govulncheck` catch CVE-2024-XXXX in `lib/foo`? It's clearly in our `go.sum`."

**Bug:** `govulncheck` only reports vulnerabilities whose vulnerable functions are **reachable** from your code. If `lib/foo` is imported but the vulnerable function is in an unused subpackage, govulncheck stays quiet — and that is correct, not a bug.
**Fix:** confirm reachability with `-show=traces`. If reachability is in doubt (reflection, dynamic dispatch), audit manually. For a "list every CVE in any imported module" view, use `osv-scanner` *alongside* — do not expect `govulncheck` to behave that way.

---

## Bug 6 — `@latest` install causes version drift in CI

```yaml
- run: go install golang.org/x/vuln/cmd/govulncheck@latest
- run: govulncheck ./...
```

Two PRs on the same day produce different finding counts. Engineers blame the DB; the actual cause is a new `govulncheck` CLI release between runs that changed default flags or analysis behavior.

**Bug:** unpinned CLI in CI. The tool itself changes underneath you.
**Fix:** pin a specific version, treat updates as a deliberate PR:

```yaml
- run: go install golang.org/x/vuln/cmd/govulncheck@v1.1.3
```

---

## Bug 7 — Vendored build, missing module info

```bash
$ govulncheck ./...
no module information found
```

The repo uses `-mod=vendor`, has a `vendor/` directory but no `go.sum` in a clean state, or the build is being run outside the module root.

**Bug:** `govulncheck` needs the module graph to map imports to DB entries. A broken or incomplete module setup defeats the matcher.
**Fix:** run from the module root, ensure `go.mod` and `go.sum` are consistent (`go mod tidy` or `go mod verify`), and confirm `go list ./...` works before scanning. If you maintain `vendor/`, also keep `go.sum` up to date — vendoring does not replace the sum file for govulncheck's purposes.

---

## Bug 8 — Treating "no findings" as a security sign-off

The team sees green `govulncheck` runs for a quarter and tells leadership the service is "vulnerability-free."

**Bug:** `govulncheck` reports only what is **in the Go vuln DB** and **reachable from Go source**. Misconfigurations, non-Go deps (libc, OpenSSL in cgo), runtime issues, unpublished zero-days, and reflection-based dispatch are invisible.
**Fix:** combine with `osv-scanner`/Trivy for non-Go scope, security-headers/TLS audits for runtime, dependency review at PR time, and pen-test cadence. `govulncheck` raises a floor; it does not certify a ceiling.

---

## Bug 9 — Suppressing a finding by deleting the trace

A developer noticed a finding pointing into `_test.go`, decided it was "just tests," and added a build-tag to exclude that file from the default build. The next scan is clean.

**Bug:** the test code still exists and may still execute in CI; the production code path was never the issue, but hiding the file from `govulncheck` doesn't make the vuln unreachable, only invisible to the scanner.
**Fix:** if test-only reachability is intentional, document it in an allowlist with rationale and expiry. Do not hide files to silence the scanner — that's tampering with the signal, not the risk.

---

## Bug 10 — Stripped binary with no findings

```bash
go build -ldflags="-s -w" -o ./dist/app ./cmd/app
govulncheck -mode=binary ./dist/app
# No vulnerabilities found.
```

Source scan of the same code reports two findings.

**Bug:** `-ldflags="-s -w"` strips the symbol table; binary mode loses function-level resolution and falls back to module-level — and may even miss findings entirely if the matcher can't enumerate enough.
**Fix:** drop `-s -w` for artifacts you intend to scan post-build (image size cost is small). If you must strip, run source-mode scans as the authoritative gate and use binary mode only as a defense-in-depth check.

---

## How to approach these
1. "Clean source scan" alone proves nothing about the shipped artifact — also scan binaries.
2. Binary mode needs Go ≥1.18 build info and an un-stripped symbol table for precision.
3. CI determinism requires pinning both the `govulncheck` CLI and the Go toolchain.
4. "No findings" = none reachable in the current DB, not "secure."
5. Don't hide files or modules to silence the scanner; document waivers explicitly with expiry.
6. If a CVE you expected isn't reported, check reachability — that's usually the answer.
