# go doc — Hands-on Tasks

Go 1.21+. Each task has explicit acceptance criteria.

---

## Task 1: Read stdlib docs

Look up standard-library documentation.

**Acceptance criteria**
- [ ] `go doc fmt` shows the package summary and symbol list.
- [ ] `go doc fmt.Println` shows that function's docs.
- [ ] `go doc -all errors` shows the full package documentation.

---

## Task 2: Drill into a type

Explore a type and its methods.

**Acceptance criteria**
- [ ] `go doc strings.Builder` lists the type's methods.
- [ ] `go doc strings.Builder.WriteString` shows one method's docs.
- [ ] `go doc -src strings.HasPrefix` shows source.

---

## Task 3: Document your own package

Write doc comments and verify them.

**Acceptance criteria**
- [ ] A package with a package comment and an exported `Func` with a doc comment exists.
- [ ] `go doc .` shows your package summary.
- [ ] `go doc .Func` shows the function's comment exactly as written.

---

## Task 4: Exported vs unexported

See the visibility difference.

**Acceptance criteria**
- [ ] An unexported helper is hidden in `go doc .`.
- [ ] `go doc -u .` reveals it.
- [ ] You explain why only exported symbols show by default.

---

## Task 5: Detached comment bug

Reproduce and fix a documentation gap.

**Acceptance criteria**
- [ ] A blank line between a comment and its declaration makes the symbol appear undocumented in `go doc`.
- [ ] Removing the blank line restores the documentation.

---

## Task 6: Tested example

Add an `ExampleXxx`.

**Acceptance criteria**
- [ ] `func ExampleFunc()` with an `// Output:` comment exists in a `_test.go` file.
- [ ] `go test` runs and verifies the example output.
- [ ] You note that examples appear under the symbol on pkg.go.dev.

---

## Task 7: Local HTML preview with pkgsite

Render docs as HTML.

**Acceptance criteria**
- [ ] `go run golang.org/x/pkgsite/cmd/pkgsite@latest -open .` serves your module.
- [ ] Your package and its example render in the browser.
- [ ] The rendering matches what `go doc` shows in text.

---

## Task 8: Audit your public surface

Review what you export.

**Acceptance criteria**
- [ ] `go doc -all .` lists every exported symbol.
- [ ] You identify any symbol that should have been unexported.
- [ ] You add a `// Deprecated:` marker to one symbol and confirm it shows in `go doc`.
