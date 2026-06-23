# golangci-lint — Find the Bug

Each scenario shows a config or workflow that looks fine but misbehaves. Find the defect, explain it, and fix it.

---

## Bug 1 — `go install` produced a "broken" binary

```bash
$ go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest
$ golangci-lint run ./...
# different findings than CI; some linters report internal errors
```

**Bug:** the project explicitly warns against `go install`. It builds the linter with your local Go toolchain against current `master`, producing a binary that differs from any official release. Reproducibility and behavior diverge from CI.
**Fix:** install from the official release, pinned to the same version CI uses:

```bash
curl -sSfL https://raw.githubusercontent.com/golangci/golangci-lint/master/install.sh \
  | sh -s -- -b $(go env GOPATH)/bin v1.59.1
```

---

## Bug 2 — Local clean, CI fails

```bash
# local
$ golangci-lint --version
golangci-lint has version 1.55.2

# CI
$ golangci-lint --version
golangci-lint has version 1.59.1
# CI reports 12 new findings local does not
```

**Bug:** version mismatch. Newer releases add linters, bump bundled tools, and change defaults — they reliably surface findings older versions did not.
**Fix:** pin the version in both places. In CI: `golangci/golangci-lint-action@v6` with `version: v1.59.1`. Locally: `Makefile` target that checks `golangci-lint version` and refuses to run on a mismatch.

---

## Bug 3 — `--new-from-rev` reports old findings as new

```bash
git checkout feature/x
git rebase origin/main      # rewrites commits
golangci-lint run --new-from-rev=origin/main ./...
# now reports findings from code you did not touch
```

**Bug:** `--new-from-rev` diffs commits. After a rebase, every commit on the branch has a new SHA and looks "new" relative to `origin/main`, even if its content existed before. The diff calculation treats those untouched lines as introduced by the rebase.
**Fix:** use `--new-from-rev=<merge-base>` against the actual merge base, or rebase less aggressively (merge instead, or rebase only once before opening the PR). In GitHub Actions, prefer `--new-from-rev=origin/${{ github.base_ref }}` with `fetch-depth: 0`, accepting the rebase-cost trade-off.

---

## Bug 4 — Script breaks because output format changed

```bash
# CI script
golangci-lint run ./... | awk '{print $2}' > findings.txt
# default format changed across versions, script now parses the wrong column
```

**Bug:** the script depends on the human-readable default output, which is not a stable contract. A version bump or terminal-detection change reshapes the output.
**Fix:** request an explicit, stable format and parse that:

```bash
golangci-lint run --out-format=json ./... > findings.json
jq -r '.Issues[] | "\(.FromLinter): \(.Text)"' findings.json
```

`json` and `checkstyle` are versioned, stable schemas designed for machine consumption.

---

## Bug 5 — CI lint takes 5 minutes

```yaml
- uses: actions/checkout@v4
- uses: actions/setup-go@v5
- run: golangci-lint run ./...   # cold cache every time
```

**Bug:** no cache persisted between runs. Each CI job re-loads, re-type-checks, and re-analyses every package from scratch.
**Fix:** use `golangci/golangci-lint-action`, which caches `~/.cache/golangci-lint`, `~/.cache/go-build`, and `~/go/pkg/mod` keyed on Go version and `.golangci.yml` hash:

```yaml
- uses: golangci/golangci-lint-action@v6
  with:
    version: v1.59.1
```

Or, on other CI, persist those directories manually with `actions/cache` / equivalent.

---

## Bug 6 — `gocyclo` flagging every function

```yaml
linters-settings:
  gocyclo:
    min-complexity: 5
```

```
internal/billing/charge.go:42:1: cyclomatic complexity 7 of func `Charge` is high (> 5) (gocyclo)
...80 more findings...
```

**Bug:** threshold set lower than the codebase's natural complexity. `5` is unreasonable for any real business logic; the default `10` is already strict.
**Fix:** raise the threshold to something the codebase can realistically meet (`15` is a common starting point on legacy code), or scope the linter via `--new-from-rev` so only new high-complexity functions fail. Lower the threshold gradually as the codebase improves.

---

## Bug 7 — `gofmt` and `gofumpt` fight on the same file

```yaml
linters:
  enable:
    - gofmt
    - gofumpt
```

```bash
$ golangci-lint run --fix ./...
# file alternates between two formats; CI keeps failing
```

**Bug:** `gofumpt` is a superset of `gofmt` with stricter rules. With both on, one undoes the other's preferences on every run, and their suggested fixes conflict.
**Fix:** pick one. For modern code, enable `gofumpt` and disable `gofmt`:

```yaml
linters:
  disable: [gofmt]
  enable:  [gofumpt]
```

---

## Bug 8 — `gosec` false positive with no nolint comment

```go
import "math/rand"

func sessionID() string {
    return strconv.Itoa(rand.Int())  // gosec: G404 use of weak random number generator
}
```

For a non-crypto ID this is fine, but CI fails.

**Bug:** `gosec` rule G404 fires on any `math/rand` use, even when crypto strength is not required. There is no exclude rule and no `//nolint` comment, so the build breaks.
**Fix:** prefer a config-level exclude when the pattern is intentional and project-wide:

```yaml
issues:
  exclude-rules:
    - text: "G404"
      linters: [gosec]
      path: internal/ids/.*  # narrow it
```

Or, when truly per-line, add a specific nolint with a reason:

```go
return strconv.Itoa(rand.Int()) //nolint:gosec // G404: non-crypto ID
```

---

## Bug 9 — Bare `//nolint` disables everything

```go
func compute() {
    res, err := doThing() //nolint
    _ = err
    use(res)
}
```

**Bug:** `//nolint` with no linter name suppresses **all** linters on the line. The original intent was probably to silence one specific finding; now `errcheck`, `staticcheck`, `gosec` and the rest are also disabled there. Future bugs on that line will be invisible.
**Fix:** always name the linter and add a justification:

```go
res, err := doThing() //nolint:errcheck // intentional: best-effort cleanup
```

You can enforce this with the `nolintlint` linter, which fails the build on unnamed or unjustified `//nolint` directives.

---

## Bug 10 — `--new-from-rev` always reports nothing in CI

```yaml
- uses: actions/checkout@v4
  # no fetch-depth
- run: golangci-lint run --new-from-rev=origin/main ./...
```

**Bug:** `actions/checkout` defaults to a shallow clone (`fetch-depth: 1`). `git` has no history of `origin/main` to diff against, so the diff is empty and golangci-lint reports zero new issues even when there are some.
**Fix:** request a full history:

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0
```

Or fetch the base branch explicitly: `git fetch --no-tags --prune --depth=50 origin main`.

---

## How to approach these
1. Different findings local vs CI? → version mismatch or install method.
2. `--new-from-rev` lying? → shallow clone or rebase rewrote the SHA history.
3. Slow lint in CI? → no cache persisted.
4. Format/output broke a script? → use `--out-format=json`, never parse default output.
5. Bare `//nolint`? → name the linter, give a reason; enable `nolintlint`.
