# goimports — Hands-on Tasks

Work through these in order. Each has explicit acceptance criteria. Use Go 1.21+.

---

## Task 1: Install and run

Install `goimports` and confirm the binary is on your `PATH`.

**Acceptance criteria**
- [ ] `go install golang.org/x/tools/cmd/goimports@latest` completes without error.
- [ ] `goimports -h` prints usage from the terminal.
- [ ] `which goimports` resolves to a path under `$(go env GOBIN)` or `$(go env GOPATH)/bin`.

---

## Task 2: Rewrite a file with stray and missing imports

Create `hello.go` that uses `fmt.Println` but has no `fmt` import, and imports `"os"` it does not use:

```go
package main

import "os"

func main() {
    fmt.Println("hi")
}
```

**Acceptance criteria**
- [ ] `goimports hello.go` prints the corrected file to stdout (without changing the file).
- [ ] `goimports -w hello.go` rewrites the file: `fmt` added, `os` removed.
- [ ] The file now compiles (`go build ./...` succeeds).

---

## Task 3: Group local imports with `-local`

In a module named `example.com/myorg/app`, write a file that imports stdlib, a third-party package (e.g., `github.com/google/uuid`), and a local subpackage (e.g., `example.com/myorg/app/internal/util`).

**Acceptance criteria**
- [ ] Without `-local`, `goimports -w main.go` produces **two** groups (stdlib + everything else).
- [ ] With `goimports -w -local example.com/myorg main.go`, the file now has **three** groups separated by blank lines: stdlib, third-party, `example.com/myorg/...`.
- [ ] You can explain why `-local` only changes grouping, not which packages are imported.

---

## Task 4: Wire `goimports -l` as a CI gate

Add a shell script `scripts/fmt-check.sh` that fails if any `.go` file under the repo is not formatted with your project's `-local` prefix.

**Acceptance criteria**
- [ ] The script runs `goimports -l -local <your-prefix> .` and exits non-zero when the output is non-empty.
- [ ] Deliberately add a stray import to one file; the script fails.
- [ ] Run `goimports -w -local <your-prefix> .`; the script now passes.
- [ ] The script also prints the diff (`goimports -d`) on failure so a reviewer sees what is wrong.

---

## Task 5: Configure your editor to run `goimports` on save

Pick one editor and configure format-on-save with `goimports` (or `gopls organizeImports`).

**Acceptance criteria**
- [ ] Editing a `.go` file and saving it triggers an automatic format pass.
- [ ] Adding a reference to `fmt.Println` to a file without the import and saving causes the `fmt` import to be added automatically.
- [ ] Your editor uses the same `-local` value as your CI script (check the settings file).

---

## Task 6: Compare output to `gofmt`

Take the file from Task 2 (before fixing).

**Acceptance criteria**
- [ ] `gofmt -d hello.go` shows only whitespace/layout changes, **does not** add `fmt` or remove `os`.
- [ ] `goimports -d hello.go` shows the import-block change in addition.
- [ ] You can state in one sentence why `gofmt`-formatted broken code still does not compile while `goimports`-formatted code does.

---

## Task 7: Replace with `gopls organize_imports`

In your editor, disable `goimports` as the format tool and use `gopls`'s `source.organizeImports` code action instead (alongside `gopls`'s formatter).

**Acceptance criteria**
- [ ] Saving a file still adds missing imports and removes unused ones.
- [ ] The local-prefix grouping still works (configure `gopls` settings: `"local": "example.com/myorg"`).
- [ ] On a large file in a repo with many dependencies, saving feels noticeably snappier than the `goimports` CLI invocation did (informal comparison is fine).

---

## Task 8: Disambiguate two packages with the same name

Write code that calls `rand.Intn(100)` without an explicit import. Have both `math/rand` and `crypto/rand` available (they are both in the stdlib, so both are always available).

**Acceptance criteria**
- [ ] Run `goimports -w`; observe which `rand` was chosen.
- [ ] Manually replace the import with the other `rand` package; run `goimports -w` again — the explicit import is preserved, not changed back.
- [ ] You can describe what you would do in a code review if you saw `rand` used without an explicit import in a security-sensitive context.

---

## Task 9: Pre-commit hook on changed files

Add a Git pre-commit hook (`.git/hooks/pre-commit`) that runs `goimports -w -local <prefix>` on staged `.go` files only.

**Acceptance criteria**
- [ ] Committing a file with bad formatting auto-fixes it and re-stages it.
- [ ] Committing changes to a non-Go file does not run `goimports`.
- [ ] The hook is fast on a large repo because it only touches changed files (test by editing one file in a tree with thousands of `.go` files — it should complete in well under a second).
