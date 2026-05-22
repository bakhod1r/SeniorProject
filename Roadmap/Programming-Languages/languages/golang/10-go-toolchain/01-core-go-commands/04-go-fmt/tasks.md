# gofmt / go fmt — Hands-on Tasks

Go 1.21+. Each task has explicit acceptance criteria.

---

## Task 1: Format a messy file

Write a `.go` file with bad indentation and spacing, then format it.

**Acceptance criteria**
- [ ] `gofmt -d messy.go` shows a diff before formatting.
- [ ] `gofmt -w messy.go` rewrites it to canonical style.
- [ ] A second `gofmt -l messy.go` prints nothing (it is now clean).

---

## Task 2: List vs write vs print

Understand the flag behaviors.

**Acceptance criteria**
- [ ] `gofmt file.go` prints formatted output but leaves the file unchanged.
- [ ] `gofmt -l file.go` lists the file only if it needs formatting.
- [ ] `gofmt -w file.go` modifies the file in place.

---

## Task 3: Simplification with `-s`

Write code with redundant forms.

**Acceptance criteria**
- [ ] A file containing `s[0:len(s)]` and `[]T{T{1}}` exists.
- [ ] `gofmt -s -d file.go` shows the simplifications.
- [ ] After `gofmt -s -w file.go`, the redundant forms are gone.

---

## Task 4: go fmt over a module

Format every package.

**Acceptance criteria**
- [ ] `go fmt ./...` formats all packages and lists changed files.
- [ ] You confirm `go fmt` equals `gofmt -l -w` by comparing behavior.

---

## Task 5: goimports for import management

Install and use goimports.

**Acceptance criteria**
- [ ] `go install golang.org/x/tools/cmd/goimports@latest` succeeds.
- [ ] Adding an unused import, then `goimports -w file.go`, removes it.
- [ ] Using a package without importing it, then `goimports -w`, adds the import.

---

## Task 6: CI-style check

Write a check that fails on unformatted code.

**Acceptance criteria**
- [ ] `test -z "$(gofmt -l .)"` exits 0 when everything is formatted.
- [ ] Introducing an unformatted file makes it exit non-zero and list the file.
- [ ] You explain why CI uses `gofmt -l`, not `go fmt`.

---

## Task 7: Format generated code

Generate Go programmatically and ensure it is canonical.

**Acceptance criteria**
- [ ] A small program builds a Go source string and writes it to a file.
- [ ] Passing it through `go/format.Source` produces gofmt-clean output.
- [ ] `gofmt -l` on the generated file prints nothing.

---

## Task 8: Editor format-on-save (reflection)

Configure your editor to format on save.

**Acceptance criteria**
- [ ] Saving a messy file auto-formats it (via gopls/the Go extension).
- [ ] Organize-imports-on-save adds/removes imports automatically.
- [ ] You write 2 sentences on why this makes the CI check rarely fail.
