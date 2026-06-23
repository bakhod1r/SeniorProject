# go generate — Interview Q&A

A mix of conceptual and practical questions, labeled by level. Answers are concise; expand with examples in a real interview.

---

## Junior

**Q1. What does `go generate` do?**
It scans Go source files for `//go:generate ...` comments and runs the command on each one. It does not compile your code and does not modify files itself — anything written to disk is produced by the tool you invoked.

**Q2. Does `go build` run `go generate` for me?**
No. They are independent. You must run `go generate` manually (or via CI / a Makefile target). `go build` only compiles existing files.

**Q3. What is the most common syntax mistake with the directive?**
Putting a space between `//` and `go:generate`. `// go:generate ...` is a plain comment and is ignored. The literal prefix `//go:generate` must appear at column 1 with no inner spaces.

**Q4. How do you avoid requiring your teammate to install `stringer` first?**
Invoke it through `go run` with a pinned version:
`//go:generate go run golang.org/x/tools/cmd/stringer@v0.24.0 -type=Color`. Now `go generate` fetches it on demand into the module cache.

---

## Middle

**Q5. Which files does `go generate` scan?**
All Go files in the matched packages that are *included by the current build context* — that means build constraints (`//go:build`, `_GOOS`/`_GOARCH` suffixes) filter directives in or out. `_test.go` files are scanned too.

**Q6. What environment variables does Go inject into the generator?**
`$GOFILE`, `$GOLINE`, `$GOPACKAGE`, `$GOOS`, `$GOARCH`, `$GOROOT`, and `$DOLLAR` (literal `$`). Tools like `stringer` use `$GOFILE`/`$GOPACKAGE` automatically; you rarely set them yourself.

**Q7. What is the working directory of the generator?**
The directory of the source file containing the directive — not the shell's CWD. That is why `//go:generate protoc -I=. foo.proto` finds `foo.proto` even when you run `go generate ./...` from the repo root.

**Q8. How do you only run one generator without re-running all of them?**
Use `-run` with a regex matched against each directive's command line:
`go generate -run="stringer" ./...`. Useful when one generator (e.g., protoc) is slow and you only changed enums.

**Q9. How does CI verify that committed generated files are in sync with their sources?**
The standard recipe is `go generate ./...` followed by `git diff --exit-code`. If the regenerated output differs from what was committed, the diff is non-empty and CI fails the PR.

---

## Senior

**Q10. Why must generated code be deterministic, and how do you achieve it?**
Because the `git diff --exit-code` CI check fails on any difference. Determinism requires sorting map iteration, sorting symbol lists, omitting timestamps, and never embedding random IDs. Two engineers on the same commit must produce byte-identical output.

**Q11. What are the trade-offs of `@latest` versus a pinned version in a directive?**
`@latest` always grabs the newest module version. That breaks reproducibility — CI and a teammate can produce different output on the same commit, and a tool author's release can silently change your build. Always pin (`@v0.24.0`) in committed directives.

**Q12. When would you write your own generator instead of using `text/template` at runtime?**
When the cost of reflection or template parsing at runtime is non-trivial, when the inputs are versioned schemas (`.proto`, `.sql`, OpenAPI), or when type safety matters — generated code surfaces schema errors at compile time. Pure boilerplate elimination is also a good fit.

---

## Professional

**Q13. Walk through what happens inside `cmd/go` when you run `go generate ./...`.**
The Go tool resolves the package pattern, enumerates files using the current build context, and reads each file line by line looking for the regex `^//go:generate( |\t)(.*)$`. For each match it expands env vars (`$GOFILE` etc.), splits the command into argv with `strconv.Unquote`-style quoting, and calls `exec.Command` with `Dir` set to the source file's directory. Directives run sequentially in source order; the run aborts on the first non-zero exit.

**Q14. Why is `//line` important in generated code?**
Generators emit `//line schema.proto:42` directives so compile errors and stack traces point back at the source schema instead of the generated `.go` file. The Go compiler, `go vet`, and the language server honor these mappings.

**Q15. What is the security boundary of `go generate`?**
There is none beyond Unix file permissions. `go generate ./...` runs arbitrary commands embedded in source comments under the calling user. On an untrusted checkout, a malicious directive can do anything that user can. Mitigations are policy, not technical: review repos before generating, pin versions, run under a non-privileged user, and rely on `GOPROXY`/`go.sum` to constrain what is downloaded.

---

## Common traps

- Leading space — `// go:generate ...` is silently ignored.
- Assuming `go build` runs generation. It does not.
- Using `@latest` in directives and getting non-reproducible CI.
- Hand-editing a generated `_string.go` file, then losing the edit on the next regen.
- Forgetting that the generator's CWD is the source directory, not the shell's CWD.
- A directive inside a file behind a build tag that the current environment never satisfies — the directive is invisible.
- Non-deterministic generator output (map iteration order, timestamps) that fails `git diff --exit-code` in CI.
- Skipping `go/format.Source` in a custom generator, then watching `gofmt -l` fail.
- Forgetting the `// Code generated ... DO NOT EDIT.` header — tools that exempt generated files (vet, lints, review) no longer recognize the file.
