# go install — Professional

## 1. The team problem: tool version drift

The core issue `go install` creates at scale is **version drift**: each engineer's machine has whatever tool versions they happened to install, so lint and generation results differ. The professional fix is to manage tool versions centrally.

Three sanctioned approaches:

| Approach | How | Best when |
|----------|-----|-----------|
| `go.mod` `tool` directives (Go 1.24+) | Declare tools in `go.mod`; `go install tool@latest`-free | You want versions tracked in the module |
| `tools.go` (pre-1.24) | Build-tagged file importing tool packages; `go install` from module | Older toolchains |
| Pinned `go install path@vX.Y.Z` in a Makefile | Single reviewed place pins versions | Tools you do not want as module deps |

Pick one per repo and document it. The anti-pattern is engineers running `go install tool@latest` ad hoc.

---

## 2. The Go 1.24 `tool` directive

Modern repos track tools in `go.mod`:

```bash
go get -tool honnef.co/go/tools/cmd/staticcheck
```

```
// go.mod
tool honnef.co/go/tools/cmd/staticcheck
```

Then:

```bash
go install tool                 # installs all declared tools at the pinned versions
go tool staticcheck ./...       # run a declared tool
```

Benefit: tool versions are versioned with the module, reviewed in PRs, and identical for everyone. This is the recommended standard going forward.

---

## 3. Makefile integration with pinned versions

For repos not yet on `tool` directives:

```makefile
STATICCHECK_VERSION := v0.5.1
GOBIN := $(PWD)/bin
export PATH := $(GOBIN):$(PATH)

.PHONY: tools lint
tools:
	GOBIN=$(GOBIN) go install honnef.co/go/tools/cmd/staticcheck@$(STATICCHECK_VERSION)

lint: tools
	staticcheck ./...
```

A single reviewed file pins every version; `make lint` installs and runs deterministically.

---

## 4. CI: predictable bin directory and caching

```yaml
env:
  GOBIN: ${{ github.workspace }}/bin
steps:
  - uses: actions/cache@v4
    with:
      path: |
        ~/.cache/go-build
        ~/go/pkg/mod
        ${{ github.workspace }}/bin
      key: tools-${{ hashFiles('Makefile', 'go.sum') }}
  - run: echo "${{ github.workspace }}/bin" >> "$GITHUB_PATH"
  - run: make tools
```

Caching the bin directory keyed on the version source means tools rebuild only when versions change.

---

## 5. Policy: `@latest` is banned in shared contexts

State it plainly in `CONTRIBUTING.md`:

- **Allowed:** `@latest` for personal, ad-hoc local installs.
- **Forbidden:** `@latest` in CI, Makefiles, scripts, or `go:generate` directives — it is non-reproducible and lets a new release break the build at any time.

Reviewers reject `@latest` in any committed file.

---

## 6. Supply-chain controls

`go install path@version` runs third-party build logic with developer/CI privileges. Team controls:

- **Private `GOPROXY`** so all tool downloads are auditable and cacheable, with no direct VCS fetches.
- **`GOSUMDB` / committed `go.sum`** to verify integrity.
- **Pinned versions only** so a compromised `@latest` cannot silently propagate.
- **`govulncheck`** in CI to catch vulnerable tool/dependency versions.
- For high-security environments, restrict CI network egress and pre-mirror approved tool versions.

---

## 7. Reviewing for misuse

| Smell | Why it's wrong | Fix |
|-------|----------------|-----|
| `go install tool@latest` in CI/Makefile | Non-reproducible | Pin `@vX.Y.Z` or use `tool` directive |
| Each engineer installs tools manually | Version drift | Centralize via Make/`tool` directive |
| Relying on a tool being "already installed" | Breaks on fresh machines/CI | Install explicitly in the pipeline |
| `go install` in a Dockerfile to "add" the app | Wrong tool; bloats image | `go build` the binary, copy it |
| Custom binary name expected from `go install` | No `-o` support | `go build -o` or rename |

---

## 8. Distributing tools to users

When you publish a Go CLI, `go install your.module/cmd/tool@latest` becomes the install instruction users follow. To make that smooth:

- Tag releases with proper semver so `@latest` and `@v1` resolve correctly.
- Stamp version via `-ldflags -X` so `tool --version` and `go version -m` agree.
- Keep `main` packages under `cmd/<name>` so the installed binary name is predictable.
- Document the `PATH` requirement (`$GOPATH/bin`) in your README.

---

## 9. Summary

At team scale, `go install` must be governed by central version management — `go.mod` `tool` directives (Go 1.24+), `tools.go`, or pinned Makefile installs — never ad-hoc `@latest`. Standardize `GOBIN`, cache the bin directory and module/build caches in CI, enforce a private proxy and checksum verification for supply-chain safety, and reject `@latest` in any committed file during review. For published CLIs, tag semver releases and stamp versions so `go install path@version` is reliable for users.

---

## Further reading
- Go 1.24 tool directives: https://go.dev/doc/modules/managing-dependencies
- `go install` reference: https://go.dev/ref/mod#go-install
- `govulncheck`: https://pkg.go.dev/golang.org/x/vuln/cmd/govulncheck
