# gofmt / go fmt — Interview Q&A

Labeled by level. Concise answers.

---

## Junior

**Q1. What does gofmt do?**
It rewrites Go source into the single canonical style — tab indentation, normalized spacing, grouped imports. Go has one official format and gofmt enforces it.

**Q2. What's the difference between `go fmt` and `gofmt`?**
`go fmt` is a wrapper that runs `gofmt -l -w` on the packages you name (writes changes). `gofmt` is the underlying tool with flags like `-l`, `-d`, `-w`, `-s`.

**Q3. How do you check formatting without changing files?**
`gofmt -l .` lists files that are not formatted; it prints nothing if all are clean. `gofmt -d .` shows a diff.

**Q4. Can you configure gofmt's style?**
No — it has no style options by design. The lack of choices is the feature: no formatting debates.

---

## Middle

**Q5. What does `gofmt -s` add?**
Simplifications: removing redundant slice bounds (`s[1:len(s)]` → `s[1:]`), redundant composite-literal types (`[]T{T{1}}` → `[]T{{1}}`), etc. Recommended baseline.

**Q6. gofmt vs goimports?**
gofmt formats and groups imports but never adds or removes them. goimports does everything gofmt does plus adding missing and removing unused imports.

**Q7. How should CI handle formatting?**
Check, don't rewrite: `test -z "$(gofmt -l .)"` (fail if anything is unformatted). Never run `go fmt` in CI — it writes and hides the violation.

**Q8. What is gofumpt?**
A stricter superset of gofmt with extra opinionated rules; its output is still gofmt-valid. Teams adopt it for maximal consistency.

---

## Senior

**Q9. Why can a formatted file fail a formatting check in CI?**
gofmt's output is tied to the toolchain version. If CI runs a different Go version than the developer, the two gofmts can disagree. Fix: pin the toolchain (`go` directive + `GOTOOLCHAIN`).

**Q10. How do you handle a formatter upgrade that reformats many files (e.g., Go 1.19 doc comments)?**
Do the `gofmt -w ./...` in a dedicated reformat commit isolated from logic, and add that commit to `.git-blame-ignore-revs` so blame stays clean.

**Q11. Does gofmt type-check?**
No. It parses to an AST and re-prints, so it formats code that does not compile (as long as it parses). That is why format-on-save works mid-edit. Use `gofmt -e` to see all parse errors.

**Q12. How do you keep generated code from failing the fmt check?**
Pass generator output through `go/format.Source`, or run `gofmt -w` on generated files as a post-step, so machine-written code is canonical.

---

## Professional

**Q13. What's the one formatting decision a team actually makes?**
Which formatter is the standard (`gofmt`, `gofmt -s`, or `gofumpt`) plus import handling — then enforce the identical tool and toolchain version across editor, pre-commit hook, and CI.

**Q14. Why is gofmt valuable at the team level?**
It eliminates formatting bikeshedding, whitespace merge conflicts, and onboarding friction. The professional goal is to make inconsistent formatting impossible, not to format code by hand.

---

## Common traps

- Confusing `gofmt` (prints) with `gofmt -w` (writes).
- Running `go fmt` in CI (rewrites instead of failing).
- Expecting gofmt to add/remove imports (that's goimports).
- Expecting gofmt to lint for bugs (that's vet/staticcheck).
- Toolchain version skew causing spurious format failures.
- Trying to configure gofmt's style.
