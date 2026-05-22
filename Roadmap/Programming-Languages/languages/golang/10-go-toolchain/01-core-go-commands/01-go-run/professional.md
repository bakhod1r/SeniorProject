# go run — Professional

## 1. Team policy: where `go run` belongs

Establish a clear rule so reviewers do not have to relitigate it per PR:

- **Allowed:** local development inner loop; version-pinned one-off tooling (`tool@version`) in scripts and CI; `go:generate` directives.
- **Discouraged:** running the application repeatedly inside a build pipeline (build once, reuse).
- **Forbidden:** as a container/production entrypoint; in any deployed artifact.

Put this in `CONTRIBUTING.md` and enforce the entrypoint rule in Dockerfile review.

---

## 2. Standardizing tool invocation

A frequent team decision: how to run developer tools (linters, generators) reproducibly. Two patterns:

**Pattern A — `go run tool@version` (no go.mod pollution):**

```bash
go run honnef.co/go/tools/cmd/staticcheck@v0.5.1 ./...
```

**Pattern B — `tool` directive in `go.mod` (Go 1.24+) or a `tools.go` file (older):**

```go
//go:build tools
package tools
import _ "honnef.co/go/tools/cmd/staticcheck"
```

Trade-off: Pattern A keeps `go.mod` clean and pins the exact tool version inline, but each invocation may re-resolve. Pattern B versions tools alongside the project and works offline after `go mod download`. Pick one per repo and document it. Mixing both leads to version drift between local and CI.

---

## 3. Makefile / task-runner integration

Wrap `go run` so the whole team uses identical flags:

```makefile
.PHONY: dev generate lint
dev:
	go run ./cmd/server

generate:
	go run golang.org/x/tools/cmd/stringer@v0.24.0 -type=State ./internal/fsm

lint:
	go run honnef.co/go/tools/cmd/staticcheck@v0.5.1 ./...
```

Benefit: `make dev` is impossible to get wrong (correct package, correct flags), and the tool versions are pinned in one reviewed place rather than in each engineer's shell history.

---

## 4. `go:generate` and `go run`

`go run` is the canonical way to invoke generators so contributors do not need tools pre-installed:

```go
//go:generate go run golang.org/x/tools/cmd/stringer@v0.24.0 -type=Color
```

Then `go generate ./...` runs them. Policy points to enforce in review:
- Pin the tool version in the directive (`@vX.Y.Z`), not `@latest`, so generation is reproducible.
- Generated files must be committed and CI must verify they are up to date (`go generate ./... && git diff --exit-code`).

---

## 5. Reviewing for misuse

Red flags in a PR:

| Smell | Why it's wrong | Fix |
|-------|----------------|-----|
| `CMD ["go", "run", "."]` in a Dockerfile | Ships the compiler; recompiles on every start; slow, large, insecure image | Multi-stage build → run the binary |
| `go run tool@latest` in CI | Non-reproducible; version drifts silently | Pin `@vX.Y.Z` |
| `go run main.go` in a multi-file repo | Misses sibling files; brittle | `go run .` |
| `go run` to "test" a service in CI | Recompiles per step; no caching of the binary | `go build` once, run the artifact |
| Flags after the package expecting build behavior | Silently passed to the program | Move build flags before the path |

---

## 6. CI cost discipline

`go run` recompiles every time it is invoked unless the cache is warm. In CI, the build cache is often cold per job. Two professional moves:

1. **Cache `GOCACHE` and the module cache** between CI runs (e.g., GitHub Actions `actions/cache` keyed on `go.sum`). This makes `go run tool@version` and repeated builds dramatically faster.
2. **Prefer one `go build`** of the app and reuse the artifact across test/lint/integration steps rather than re-`go run`-ing it, because each `go run` pays the link cost again.

```yaml
# CI sketch
- uses: actions/cache@v4
  with:
    path: |
      ~/.cache/go-build
      ~/go/pkg/mod
    key: go-${{ hashFiles('**/go.sum') }}
```

---

## 7. Security considerations

- `go run tool@latest` executes **arbitrary downloaded code** with your developer's privileges. For supply-chain hygiene, pin versions, set `GOFLAGS=-mod=readonly`, and consider `GONOSUMCHECK`/`GOSUMDB` policy and a private proxy (`GOPROXY`) so tool fetches are auditable.
- Never run untrusted modules with `go run path@version` on a machine with secrets unless the version is reviewed.
- In production: a `go run` entrypoint means the **build toolchain and full source** ship in the image — a larger attack surface and image. Always ship a static binary instead.

---

## 8. Onboarding ergonomics

`go run`'s superpower for teams is **zero pre-install tooling**: a new engineer can run generators and linters via `go run tool@version` with only Go installed. Lean into this for contributor experience, but keep versions pinned centrally (Makefile, `go:generate`, or `go.mod tool` directives) so "works on my machine" version skew never happens.

---

## 9. Summary

At team scale, `go run` is a development and tooling instrument, never a deployment one. Standardize *where* it is allowed, pin tool versions centrally (Makefile, `go:generate`, or `go.mod` tool directives), cache `GOCACHE`/module cache in CI, and reject `go run` as a container entrypoint in review. Treat `tool@version` as executing third-party code and gate it with version pinning and proxy/sum policy.

---

## Further reading
- `go help generate`
- Go 1.24 `tool` directive: https://go.dev/doc/modules/managing-dependencies
- Build/test caching: https://pkg.go.dev/cmd/go#hdr-Build_and_test_caching
