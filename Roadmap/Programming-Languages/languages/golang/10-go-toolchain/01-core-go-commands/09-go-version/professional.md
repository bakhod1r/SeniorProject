# go version — Professional

## 1. Pin the toolchain across the org

Inconsistent Go versions cause subtly different binaries, gofmt diffs, and version-specific bugs. The professional baseline: every developer and CI runner builds with the **same** toolchain.

```
// go.mod
go 1.23.0
toolchain go1.23.1
```

```bash
# org default — choose deliberately
go env -w GOTOOLCHAIN=auto      # convenience: download as needed
# or
go env -w GOTOOLCHAIN=local     # control: use the provisioned version, error if too old
```

Document the choice. `auto` is convenient; `local` (with a managed install) is required in air-gapped or strictly controlled environments.

---

## 2. Assert the toolchain in CI

Make a mismatch a hard failure rather than a silent source of "works on my machine":

```bash
expected="go1.23.1"
got="$(go version | awk '{print $3}')"
if [ "$got" != "$expected" ]; then
  echo "::error::toolchain mismatch: have $got, want $expected"
  exit 1
fi
echo "GOTOOLCHAIN=$(go env GOTOOLCHAIN)"
```

This catches drift between the `toolchain` directive, the CI image, and `GOTOOLCHAIN` policy before it produces inconsistent artifacts.

---

## 3. Auto-download policy and supply chain

`GOTOOLCHAIN=auto` downloads toolchains as modules, verified via `GOSUMDB`. Decide org policy:

- **Convenience environments:** `auto` is fine; toolchains are checksum-verified.
- **Locked-down/air-gapped:** `local` plus pre-provisioned toolchains, or a private `GOPROXY` that mirrors toolchain modules so downloads are auditable and offline-capable.
- Never disable sum verification to make auto-download "work" — provision the toolchain instead.

```bash
# mirror toolchains through the private proxy
export GOPROXY=https://proxy.internal.example.com,direct
```

---

## 4. Release artifact provenance with `-m`

Embed and verify provenance for every release:

```bash
# build with provenance-friendly flags
go build -trimpath -o dist/app ./cmd/app
# verify what shipped
go version -m dist/app | grep -E 'go1\.|mod|vcs\.revision|vcs\.modified|-trimpath'
```

Policy points:
- Reject release artifacts where `vcs.modified=true` (dirty tree).
- Record the `go version` and dependency manifest with the release.
- Use `govulncheck -mode=binary dist/app` to scan the exact shipped dependency versions.

---

## 5. Upgrade cadence

Treat Go upgrades as deliberate, scheduled events:

1. Bump the `toolchain` directive (and `go` directive when adopting new language features) in a dedicated PR.
2. Update the CI image / provisioned toolchain to match.
3. Run the full suite, `-race`, `govulncheck`, and a cold build.
4. Handle any gofmt reformat churn in an isolated commit (toolchain bumps can change gofmt output).
5. Roll out to all developers (communicate the required version).

Never let the toolchain version drift implicitly across the team.

---

## 6. Reviewing for misuse

| Smell | Why it's wrong | Fix |
|-------|----------------|-----|
| No `toolchain` directive in a shared repo | version drift | pin `toolchain goX.Y.Z` |
| CI image version ≠ `toolchain` directive | inconsistent builds | align them; assert in CI |
| `GOTOOLCHAIN=auto` in air-gapped CI | download fails or unaudited | `local` + provisioned toolchain |
| Shipping `vcs.modified=true` artifacts | unprovenanced release | build from a clean tag |
| Disabling `GOSUMDB` to fix auto-download | supply-chain risk | mirror toolchains via private proxy |
| Reporting bugs without the `go version` line | unreproducible | require it in templates |

---

## 7. Standardize bug-report context

Make `go version` (and `go env`) part of every internal bug report and issue template:

```bash
go version
go env GOOS GOARCH GOTOOLCHAIN CGO_ENABLED
```

Because Go behavior can be version- and platform-specific, this context turns "cannot reproduce" into "reproduced immediately."

---

## 8. Multi-version testing

For libraries with a wide consumer base, test against multiple toolchains:

```yaml
strategy:
  matrix:
    go: ['1.22.x', '1.23.x', '1.24.x']
```

Each job runs `go version` to confirm the active toolchain and runs the suite. This ensures your `go` directive's claimed minimum actually works and that new versions do not break consumers.

---

## 9. Summary

Pin one toolchain across the org via the `go.mod` `toolchain` directive and a deliberate `GOTOOLCHAIN` policy (`auto` for convenience, `local` for locked-down), and assert the active version in CI to catch drift. Use `go version -m` for release provenance and pair it with `govulncheck -mode=binary`; reject dirty-tree artifacts. Treat Go upgrades as scheduled events, mirror toolchains through a private proxy where downloads must be auditable, require `go version`/`go env` in bug reports, and test libraries across a version matrix.

---

## Further reading
- Go toolchains: https://go.dev/doc/toolchain
- `govulncheck` binary mode: https://pkg.go.dev/golang.org/x/vuln/cmd/govulncheck
- BuildInfo: https://pkg.go.dev/runtime/debug#ReadBuildInfo
