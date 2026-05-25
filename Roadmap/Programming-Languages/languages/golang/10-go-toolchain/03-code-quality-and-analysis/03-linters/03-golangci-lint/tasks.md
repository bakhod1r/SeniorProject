# golangci-lint — Hands-on Tasks

Work through these in order. Each has explicit acceptance criteria. Use Go 1.21+ and golangci-lint v1.59+ (note where v2 changes things).

---

## Task 1: Install from the official binary release

Install a **pinned** golangci-lint version using the official install script, not `go install`.

```bash
curl -sSfL https://raw.githubusercontent.com/golangci/golangci-lint/master/install.sh \
  | sh -s -- -b $(go env GOPATH)/bin v1.59.1
```

**Acceptance criteria**
- [ ] `golangci-lint --version` prints `1.59.1`.
- [ ] The binary lives under `$(go env GOPATH)/bin`.
- [ ] You can explain in one sentence why `go install ...@latest` is discouraged for this tool.

---

## Task 2: Run with default config on a real project

Pick any module of yours (or clone a small open-source Go repo). With **no** `.golangci.yml`, run the default set.

**Acceptance criteria**
- [ ] `golangci-lint run ./...` executes and either prints findings or exits 0.
- [ ] `golangci-lint linters` shows `govet`, `staticcheck`, `errcheck`, `ineffassign`, `unused`, `gosimple` as enabled.
- [ ] You note one finding (or "no findings") and which linter produced it.

---

## Task 3: Write a `.golangci.yml` enabling six linters

Create `.golangci.yml` at the project root that disables all defaults and enables exactly: `govet`, `staticcheck`, `errcheck`, `revive`, `gocritic`, `gocyclo`.

```yaml
run:
  timeout: 3m

linters:
  disable-all: true
  enable:
    - govet
    - staticcheck
    - errcheck
    - revive
    - gocritic
    - gocyclo

linters-settings:
  gocyclo:
    min-complexity: 15
```

**Acceptance criteria**
- [ ] `golangci-lint linters` shows exactly those 6 as enabled.
- [ ] `golangci-lint run ./...` runs successfully (any findings are fine).
- [ ] Changing `min-complexity: 5` produces more `gocyclo` findings than `15`.

---

## Task 4: Exclude `_test.go` from one linter

Tests often legitimately ignore errors (`_, _ = w.Write(...)` is annoying in tests). Exclude `errcheck` only for test files.

```yaml
issues:
  exclude-rules:
    - path: _test\.go
      linters: [errcheck]
```

**Acceptance criteria**
- [ ] Introduce an ignored error in `foo.go` — `errcheck` flags it.
- [ ] Introduce the same pattern in `foo_test.go` — no finding.
- [ ] Removing the exclude rule causes both to be flagged.

---

## Task 5: Use `--new-from-rev` on a feature branch

Create a branch off `main`, add code with a deliberate lint issue, and lint only your changes.

```bash
git checkout -b feature/lint-demo
# add code with an unused variable
golangci-lint run --new-from-rev=origin/main ./...
```

**Acceptance criteria**
- [ ] On `main`, an existing issue is reported as usual.
- [ ] On the branch, with `--new-from-rev=origin/main`, only the newly introduced issue is reported.
- [ ] Rebasing the branch onto `main` and rerunning still works (or you can explain why it might not — see find-bug.md).

---

## Task 6: Integrate into GitHub Actions with cache

Add a workflow that lints PRs, with both the Go build cache and the golangci-lint cache persisted.

```yaml
# .github/workflows/lint.yml
name: lint
on: [pull_request]
jobs:
  golangci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }   # needed for --new-from-rev
      - uses: actions/setup-go@v5
        with: { go-version: '1.22' }
      - uses: golangci/golangci-lint-action@v6
        with:
          version: v1.59.1
          args: --new-from-rev=origin/${{ github.base_ref }} --out-format=github-actions
```

**Acceptance criteria**
- [ ] A PR triggers the workflow.
- [ ] On a second push to the same PR, the action reports a cache hit (visible in the logs).
- [ ] Inline annotations appear on the PR for any new findings.

---

## Task 7: Use `--fix` to auto-correct

Introduce a `goimports`/`gofumpt`-fixable issue (e.g., unsorted imports or unnecessary `else`).

```bash
golangci-lint run --fix ./...
git diff
```

**Acceptance criteria**
- [ ] Before: `golangci-lint run` reports the issue.
- [ ] After `--fix`: the file is modified, `git diff` shows the change, and the next run is clean.
- [ ] You can name at least three linters that **cannot** auto-fix (e.g., `errcheck`, `gocyclo`, `unused`).

---

## Task 8: Pin the version in CI and enforce it locally

Add a `Makefile` target that fails if a developer's locally-installed `golangci-lint` does not match the CI version.

```makefile
GOLANGCI_LINT_VERSION := v1.59.1

lint:
    @golangci-lint version 2>&1 | grep -q "$(GOLANGCI_LINT_VERSION)" \
        || (echo "expected golangci-lint $(GOLANGCI_LINT_VERSION)" && exit 1)
    golangci-lint run ./...
```

**Acceptance criteria**
- [ ] `make lint` runs and either succeeds or refuses to start due to a version mismatch.
- [ ] A teammate with a different installed version sees a clear actionable error.
- [ ] The same `GOLANGCI_LINT_VERSION` is referenced from the CI workflow.

---

## Task 9: Track lint debt (stretch)

Add a non-blocking second CI job that lints the whole repo (without `--new-from-rev`) and uploads the JSON report as an artifact.

**Acceptance criteria**
- [ ] PRs still pass/fail only on the `--new-from-rev` job.
- [ ] The debt job uploads `lint-debt.json` as an artifact every run.
- [ ] You can grep the artifact to count issues by linter (`jq '.Issues[].FromLinter' lint-debt.json | sort | uniq -c`).
