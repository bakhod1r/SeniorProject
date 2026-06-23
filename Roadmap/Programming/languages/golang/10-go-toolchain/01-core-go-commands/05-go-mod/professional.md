# go mod — Professional

## 1. The cleanliness invariant

The single most valuable team policy: **`go mod tidy` must be a no-op on a clean tree.** Enforce it in CI so `go.mod`/`go.sum` always exactly match the code.

```bash
# CI gate
go mod tidy
git diff --exit-code go.mod go.sum   # fails if tidy changed anything
```

This catches forgotten tidies, accidental dependency additions, and stale indirect entries in review rather than at runtime.

---

## 2. Reproducibility and `-mod=readonly`

Make builds incapable of silently mutating the module graph:

```bash
export GOFLAGS=-mod=readonly        # default in modern Go; set explicitly to be safe
```

Dependency changes happen only through deliberate, reviewed commands (`go get`, `go mod tidy`), never as a side effect of `go build`/`go test`. Combine with a pinned toolchain so MVS and pruning behave identically everywhere.

---

## 3. Private modules and proxy policy

For internal dependencies, configure the team's environment so private code is neither leaked to the public sum DB nor blocked:

```bash
export GOPRIVATE=git.internal.example.com,github.com/yourorg/*
export GOPROXY=https://proxy.internal.example.com,direct
export GONOSUMCHECK=  # rely on GOPRIVATE rather than disabling sums globally
```

- `GOPRIVATE` excludes matching modules from the checksum DB and the public proxy.
- A private `GOPROXY` makes all downloads auditable, cacheable, and resilient to upstream outages (`direct` as a fallback).

Standardize these via a committed `.envrc`, CI env, or organizational defaults.

---

## 4. Dependency hygiene and review

Reviewers should treat `go.mod`/`go.sum` diffs as first-class:

| Diff seen | Question to ask |
|-----------|-----------------|
| New `require` | Is this dependency justified? License? Maintenance? |
| Large indirect churn | Did the `go` directive change (pruning)? |
| Version downgrade | Intentional, or an MVS surprise? |
| New `replace` | Is it a temporary dev override that should not merge? |
| `go.sum` grows a lot | Is a heavy transitive dependency being pulled in? Use `go mod why`. |

`go mod why -m <module>` in review explains exactly why a questionable dependency entered the build.

---

## 5. Upgrading dependencies deliberately

```bash
go get -u ./...                 # upgrade direct + indirect to latest minor/patch
go get -u=patch ./...           # only patch upgrades (safer)
go get example.com/x@latest      # one dependency
go mod tidy                      # clean up afterward
```

Professional practice: schedule dependency upgrades (e.g., via Dependabot/Renovate) as their own PRs, run the full test suite + `govulncheck`, and never bundle upgrades with feature changes.

---

## 6. Vendoring decision

Decide as a team whether to vendor:

| Vendor | No vendor |
|--------|-----------|
| Hermetic, offline builds | Smaller repo, smaller diffs |
| Auditable deps in PRs | Relies on proxy/cache availability |
| Larger repo, big bump diffs | Faster clones |

If you vendor, enforce `go mod tidy && go mod vendor` together and check `go mod verify`/vendor consistency in CI (`go mod vendor && git diff --exit-code vendor`). Most teams skip vendoring in favor of a private proxy plus cache; high-security/air-gapped environments vendor.

---

## 7. Multi-module repos and workspaces

For monorepos or multi-module development:

- Use `go.work` (1.18+) locally to develop several modules together — **do not commit `go.work`** for published libraries (it would override consumers' resolution expectations); committing it is acceptable for internal-only monorepos by convention.
- Avoid scattering local `replace` directives across `go.mod` files; they leak into PRs and break consumers if merged.
- Run `go mod tidy` per module and verify each independently in CI.

---

## 8. Security: supply chain

- Run `govulncheck ./...` in CI to flag known-vulnerable dependency versions.
- Keep `GOSUMDB` enabled (with `GOPRIVATE` for internal code) so tampering is detected.
- Treat `go.sum` as a security artifact — never delete it to "fix" errors; run `go mod tidy`.
- Audit new dependencies' licenses and maintenance status as part of review.
- Pin the toolchain so MVS/pruning is reproducible across the org.

---

## 9. Reviewing for misuse

| Smell | Why it's wrong | Fix |
|-------|----------------|-----|
| `replace ... => ../local` merged to main | breaks CI/consumers | remove dev replaces; use `go.work` locally |
| `go.sum` deleted to fix an error | loses integrity guarantees | `go mod tidy` |
| Dependency upgrade mixed with features | hard to review/revert | separate PRs |
| `-mod=mod` in CI | silently mutates the graph | `-mod=readonly` |
| Unexplained heavy dependency | bloat/risk | `go mod why`; justify or drop |

---

## 10. Summary

At team scale, enforce a no-op `go mod tidy` in CI, `-mod=readonly` everywhere, a pinned toolchain, and a private `GOPROXY` plus `GOPRIVATE` for internal modules. Review `go.mod`/`go.sum` diffs as first-class, upgrade dependencies in dedicated PRs with `govulncheck`, decide vendoring deliberately, and keep local `replace`/`go.work` out of merged code. Treat `go.sum` as a security artifact, never to be hand-deleted.

---

## Further reading
- Managing dependencies: https://go.dev/doc/modules/managing-dependencies
- `govulncheck`: https://pkg.go.dev/golang.org/x/vuln/cmd/govulncheck
- Private modules: https://go.dev/ref/mod#private-modules
