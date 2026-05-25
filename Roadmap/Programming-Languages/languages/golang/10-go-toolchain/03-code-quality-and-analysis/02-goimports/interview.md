# goimports — Interview Q&A

A mix of conceptual and practical questions, labeled by level. Answers are concise; expand with examples in a real interview.

---

## Junior

**Q1. What is `goimports` and how is it different from `gofmt`?**
`goimports` is a Go formatter that does everything `gofmt` does (whitespace, layout, sort imports) **plus** automatically adds missing imports and removes unused ones. Its output is always also valid `gofmt` output — `goimports` is a strict superset.

**Q2. How do you install `goimports`?**
`go install golang.org/x/tools/cmd/goimports@latest`. The binary goes to `$(go env GOBIN)` (or `$(go env GOPATH)/bin`), which must be on your `PATH`.

**Q3. How do you actually change a file with `goimports`?**
Use `-w` to write the result back: `goimports -w main.go`. Without `-w`, the formatted output is printed to stdout and the file is unchanged.

**Q4. How do you wire `goimports` to run on save?**
In VS Code, set `"go.formatTool": "goimports"` and `"editor.formatOnSave": true`. In Neovim with `gopls`, bind the `source.organizeImports` LSP code action plus `vim.lsp.buf.format` to the `BufWritePre` autocmd.

---

## Middle

**Q5. What does the `-local` flag do?**
It tells `goimports` which import path prefix(es) belong to "your" code, so they form a third group (separated by a blank line) below stdlib and third-party imports: `goimports -w -local example.com/myorg .`. Without `-local`, you only get two groups.

**Q6. How does `goimports` find a package to import for an unresolved name?**
It searches stdlib, your current module, the module cache (`$(go env GOMODCACHE)`), and `GOPATH/src` for packages whose name matches the unresolved selector, then confirms the candidate exports the symbol. A package not yet downloaded into the module cache is invisible — run `go mod download` first if needed.

**Q7. Two packages export the same identifier. What does `goimports` do?**
It picks one heuristically (typically the stdlib one or by deterministic priority). This can silently insert the wrong import. The fix is to import the intended package manually first; `goimports` will keep the explicit import as-is.

**Q8. How do you gate merges in CI on `goimports`?**
`test -z "$(goimports -l -local example.com/myorg .)"` — `-l` prints files that would be changed, and the script fails if the list is non-empty. Optionally also print the diff with `goimports -d` for nicer error output.

---

## Senior

**Q9. Why is `goimports` slow on large repos and what is the modern alternative?**
Because it must build a candidate index from stdlib + module cache + your module, and may load `go/types` data for several candidate packages to disambiguate symbols. The modern alternative inside editors is `gopls`'s `source.organizeImports` code action, which reuses live type information and is dramatically faster per file.

**Q10. What goes into a sensible CI policy for `goimports`?**
Pin the binary version (`@vX.Y.Z`), fix one `-local` prefix in a shared script, run on the entire tree with `-l` so the gate is non-zero exit on any unformatted file, surface the diff (`-d`) in the failure message, and never use `-w` in CI — fail loudly, don't auto-fix.

**Q11. What is the three-group import convention and how do you enforce it?**
Three blocks separated by blank lines: stdlib, third-party, local. Enforced via `goimports -local <your-prefix>` (or `gopls`'s `local` setting). Without `-local`, your internal packages are grouped with third-party — the most common reason a team's import blocks "look fine locally but CI rejects them."

**Q12. How does `goimports` interact with `gofumpt` and `gci`?**
`gofumpt` is a stricter `gofmt` (no import logic); pair it with `goimports` by running `goimports` first, then `gofumpt`. `gci` is a richer import grouper than `-local` (supports more than three groups, custom prefixes); teams that outgrow `-local` typically switch to `gofumpt + gci` and drop `goimports`. Mixing all three without strict ordering causes formatter battles.

---

## Professional

**Q13. Where is the `goimports` engine and what else uses it?**
The CLI is `golang.org/x/tools/cmd/goimports`; the engine is `golang.org/x/tools/internal/imports`. The same engine is embedded in `gopls`, which is why CLI and editor produce consistent results — *when their versions agree*. Pin both in lockstep to avoid drift.

**Q14. What does `-srcdir` do and when do you need it?**
`-srcdir <dir>` tells the engine to resolve imports as if the input file lived in `<dir>`. Editors and language servers use it when handing an in-memory buffer to the engine while the on-disk path is a temp file. You will rarely set it manually.

**Q15. How would you keep `goimports` fast on a 5,000-file monorepo?**
Exclude `vendor/` and generated trees explicitly; run the full check in CI but use changed-files only in pre-commit (`git diff --cached --name-only | xargs goimports -w`); parallelize with `xargs -P`; ensure the build cache is persisted in CI so candidate scans are warm; prefer `gopls organizeImports` for the inner editor loop.

---

## Common traps

- Forgetting `-w` and wondering why the file is unchanged (output went to stdout).
- Forgetting `-local`, so internal packages get grouped with third-party.
- Ambiguous package names silently resolving to the wrong package (`math/rand` vs `crypto/rand`).
- Different `goimports` versions locally vs in CI producing different "correct" output.
- Running `goimports -w .` over `vendor/` and rewriting thousands of files you do not own.
- Treating `goimports` and `gopls organizeImports` as different tools — they share an engine, but only when versions agree.
- Putting `goimports -w` in CI instead of `-l`/`-d` — auto-fixing in CI hides the formatting problem from the author.
- Expecting `goimports` to import a package for code you commented out — it cannot see references that are not there.
