# gofmt / go fmt — Find the Bug

Each scenario looks fine but misbehaves. Find the defect, explain it, fix it.

---

## Bug 1 — File "formatted" but unchanged

```bash
$ gofmt messy.go
# nicely formatted output printed... but the file on disk is still messy
```

**Bug:** without `-w`, `gofmt` prints to stdout and does not modify the file.
**Fix:** `gofmt -w messy.go` to write the changes back.

---

## Bug 2 — CI rewrites files instead of failing

```yaml
- run: go fmt ./...
```

**Bug:** `go fmt` *writes* changes (`-w`); in CI it silently mutates files and the step passes even though contributors committed unformatted code.
**Fix:** check, don't write: `test -z "$(gofmt -l .)"` (fail if any file is unformatted).

---

## Bug 3 — Formatted file fails CI

A developer on Go 1.23 formats and commits; CI on Go 1.19 reports the file as unformatted.

**Bug:** gofmt's output is tied to the toolchain version; the two gofmts disagree (e.g., doc-comment formatting).
**Fix:** pin the toolchain so dev and CI use the same gofmt — `go` directive in `go.mod` plus `GOTOOLCHAIN`.

---

## Bug 4 — Expecting unused imports to be removed

```bash
$ gofmt -w file.go    # unused import still there
./file.go:5:2: "strings" imported and not used
```

**Bug:** gofmt groups/sorts imports but never adds or removes them.
**Fix:** use `goimports -w file.go` (or gopls organize-imports) to manage the import list.

---

## Bug 5 — Generated code fails the fmt check

A code generator writes Go with inconsistent spacing; CI's `gofmt -l` flags the generated files.

**Bug:** the generator emits non-canonical source and nothing reformats it.
**Fix:** pass output through `go/format.Source` in the generator, or run `gofmt -w` on generated files as a post-generation step.

---

## Bug 6 — Reformat churn buried in a feature PR

A feature PR also runs `gofmt -w ./...` after a toolchain bump, mixing hundreds of formatting-only lines with logic changes.

**Bug:** the formatting churn pollutes the diff and `git blame`.
**Fix:** do the reformat in a dedicated commit, add its SHA to `.git-blame-ignore-revs`, and keep logic changes separate.

---

## Bug 7 — `gofmt` reports only one error

```bash
$ gofmt file.go    # stops reporting after the first parse error
```

**Bug:** by default gofmt limits reported errors; a file with many syntax errors looks like it has only one.
**Fix:** `gofmt -e file.go` reports all errors. (Note gofmt needs the file to *parse*; fix syntax before formatting.)

---

## Bug 8 — Editor inserts spaces, fighting gofmt

The editor is set to indent with spaces, so saving without format-on-save leaves space-indented Go that gofmt then rewrites to tabs on commit.

**Bug:** editor indentation config conflicts with gofmt's tabs.
**Fix:** enable format-on-save (gopls) so gofmt normalizes indentation to tabs automatically; do not hand-indent Go.

---

## Bug 9 — Inconsistent tools across the team

Editor uses gofumpt; CI checks plain gofmt. Files pass locally, fail CI (or vice versa).

**Bug:** different formatters produce different output, so the same file is "correct" in one place and "wrong" in another.
**Fix:** standardize the exact same formatter (and version) in editor, pre-commit hook, and CI.

---

## How to approach these
1. File unchanged? → missing `-w`.
2. CI not catching unformatted code? → use `gofmt -l`, not `go fmt`.
3. Spurious failures? → toolchain version skew; pin it.
4. Imports not fixed? → that's goimports, not gofmt.
5. Generated/edited files flagged? → run them through gofmt / `go/format`.
