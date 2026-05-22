# go doc — Interview Q&A

Labeled by level. Concise answers.

---

## Junior

**Q1. What does `go doc` do?**
It prints documentation for packages and symbols in the terminal, extracted from the doc comments in the source code.

**Q2. How do you see docs for a function?**
`go doc <pkg>.<Func>`, e.g., `go doc fmt.Println`. For a whole package: `go doc fmt`.

**Q3. What is a doc comment?**
The comment placed directly above a package/type/function declaration (no blank line), conventionally starting with the symbol's name.

**Q4. How do you see the full docs for a package, not just the summary?**
`go doc -all <pkg>`, e.g., `go doc -all strings`.

---

## Middle

**Q5. How do you see unexported symbols' docs?**
`go doc -u <pkg>` includes lowercase (unexported) names; by default `go doc` shows only exported ones.

**Q6. How do you read the source of a stdlib function?**
`go doc -src <pkg>.<Symbol>`, e.g., `go doc -src sort.Ints`.

**Q7. What is the difference between `go doc` and pkg.go.dev?**
`go doc` prints plain text in the terminal; pkg.go.dev renders HTML for published modules. pkgsite is the engine behind pkg.go.dev that you can run locally.

**Q8. What are `ExampleXxx` functions?**
Functions in `_test.go` that serve as documentation; with an `// Output:` comment they are compiled and run by `go test`, and pkg.go.dev displays them under the symbol.

---

## Senior

**Q9. Why treat doc comments as an API contract?**
For published modules, comments render verbatim on pkg.go.dev and the exported surface is what consumers depend on. `go doc -all .` audits exactly what you expose before release.

**Q10. What changed in Go 1.19 for doc comments?**
A defined lightweight syntax: headings (`# X`), lists, and `[links]`, normalized by gofmt and rendered by pkg.go.dev. Upgrading reformats existing comments once.

**Q11. How do you signal a deprecated API?**
A paragraph starting `// Deprecated:` — recognized by pkg.go.dev and linters (staticcheck `SA1019` flags callers). State the replacement and removal timeline.

**Q12. How do you preview docs exactly as they'll appear publicly?**
Run pkgsite locally: `pkgsite -open .`. It matches pkg.go.dev's rendering, unlike the legacy `godoc`.

---

## Professional

**Q13. How do you enforce documented exports across a team?**
A CI lint (e.g., revive's `exported` rule or staticcheck) failing on undocumented exported symbols in published packages, plus reviewing the public surface with `go doc -all .` in PRs.

**Q14. Why can't you just remove an exported function in a minor release?**
The Go compatibility promise: consumers code against your exported API within a major version. Removing it breaks them. Deprecate with `Deprecated:` and remove only in the next major version.

---

## Common traps

- Expecting `go doc` to show unexported symbols (use `-u`).
- A blank line detaching a doc comment from its declaration.
- Expecting Markdown/HTML rendering in the terminal (that's pkg.go.dev).
- Forgetting the package prefix (`go doc strings.Builder`, not `go doc Builder`).
- Using legacy `godoc` instead of pkgsite for previews.
- Writing prose where a tested `ExampleXxx` would be better.
