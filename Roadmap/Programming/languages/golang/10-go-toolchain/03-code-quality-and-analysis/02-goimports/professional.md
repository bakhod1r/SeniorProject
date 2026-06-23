# goimports — Professional

## 1. Where the code lives

The `goimports` tool is a thin CLI wrapper around a library that does the real work.

- CLI entry point: `golang.org/x/tools/cmd/goimports` (a single `main.go` that wires flags and walks paths).
- Core logic: `golang.org/x/tools/internal/imports` (the import-fixup engine, candidate scanning, type-based filtering).

The same engine is embedded inside `gopls` (its `organizeImports` code action calls into the same `internal/imports` package), which is why the two are usually behaviorally consistent — but **only when their versions agree**. The CLI and `gopls` are released independently; mismatches between them are the most common source of "formatter says different things on different machines."

A practical implication: when you bump `gopls` in your editor, also bump the pinned `goimports` version in CI/Makefile so the two stay in lockstep.

---

## 2. The candidate-scanning algorithm

When `goimports` sees a reference to an unimported package `foo`, the engine roughly:

1. Builds (or reuses a cached) **dirCache** of every package on disk: standard library, current module, every entry in `$(go env GOMODCACHE)`, every directory in `GOPATH/src`. Each entry keys on the **directory name** (the conventional package name).
2. Filters the dirCache to candidates whose name matches `foo`.
3. For each candidate, parses just enough of the package to enumerate its exported identifiers — preferring **export data** from the build cache when available, falling back to source parsing.
4. Picks the candidate whose exported set contains the needed symbol(s). Ties are broken by a fixed priority: standard library beats local module beats third-party; shorter paths beat longer.
5. Synthesizes the corresponding `import` spec and inserts it into the import block.

The expensive steps are 1 and 3. Step 1 happens once per process and is memoized in memory; that is why `goimports -w` over many files is roughly *one* scan plus *N* file rewrites, not *N* scans. Step 3 is bounded by candidate count and cache warmth — cold export data forces a full type-check of the candidate.

For unresolved symbols whose imports are already declared, `goimports` skips scanning entirely and just verifies the existing import remains referenced.

---

## 3. `-srcdir`: lying about where the file lives

When you run `goimports` on a file outside your module tree (e.g., processing a buffer in an editor, or running on a snippet), the import resolver does not know which module's `go.mod` to consult. `-srcdir` solves this:

```bash
goimports -srcdir /path/to/your/module /tmp/snippet.go
```

The flag tells the engine "pretend this file lives in `<srcdir>` for import resolution purposes." Editors and language servers use it when they feed a file's in-memory buffer to the engine while the on-disk path is a temp file.

You will rarely set `-srcdir` yourself; you will see it in editor logs and in tools that wrap `goimports` programmatically.

---

## 4. `goimports` CLI vs `gopls organizeImports`

| Aspect | `goimports` CLI | `gopls organizeImports` |
|--------|-----------------|-------------------------|
| Trigger | Shell command, one-shot | LSP code action, in-editor |
| Reload cost | Builds candidate index each process start | Reuses live type info from the open session |
| Scope | One file (or many via path walk) | Single file in response to a request |
| Latency on warm cache | 100ms-1s per file | 5-50ms |
| Configuration | CLI flags (`-local`, `-srcdir`, …) | `gopls` settings (`local`, `gofumpt`) |
| CI usage | Standard | Not applicable (no LSP server) |
| Same library? | Yes, both call into `golang.org/x/tools/internal/imports` | Yes |

The takeaway: **use `gopls` inside the editor, `goimports` CLI in CI.** They share an engine so the results agree (subject to version pinning). Trying to run the CLI from inside the editor on every keystroke duplicates the candidate scan and is meaningfully slower.

---

## 5. Performance pitfalls in monorepos

In repos with hundreds of internal packages and thousands of vendored or cached third-party packages:

- **Cold candidate index.** First `goimports` invocation after `go clean -cache` can take seconds, not milliseconds.
- **Vendor explosion.** `goimports -w .` will descend into `vendor/` unless excluded; this rewrites thousands of files you do not own. Always pair with a path filter.
- **Generated files.** Big generated files (protobuf, mocks) inflate `goimports` time per file dramatically because the AST is huge. Either exclude them or arrange for the generator to emit canonical output.
- **Symbol ambiguity at scale.** In a large org you will have multiple internal packages named `client`, `util`, `model`. `goimports`'s name-based heuristic picks one; users are surprised. The `-local` flag does **not** change disambiguation, only grouping. The robust fix is to rename packages so names are unique, or to manually import the intended package in code templates.
- **CI feedback latency.** Running `goimports` on the full tree in CI is fine; running it serially in a single step that takes a minute is annoying. Parallelize with `xargs -P` or shard by directory.

```bash
find . -name '*.go' -not -path './vendor/*' -not -path '*/gen/*' -print0 | \
  xargs -0 -P 8 -n 50 goimports -l -local example.com/myorg
```

---

## 6. Embedding `goimports` programmatically

The engine is importable:

```go
import "golang.org/x/tools/imports"

opts := &imports.Options{
    Fragment:  false,
    AllErrors: false,
    Comments:  true,
    TabIndent: true,
    TabWidth:  8,
    FormatOnly: false,        // false → also fix imports; true → just gofmt
}
out, err := imports.Process("path/to/file.go", srcBytes, opts)
```

Useful when building custom formatters, pre-commit tools, or editor plugins. Setting `FormatOnly: true` gives you `gofmt`-only behavior; setting it false is what the CLI does by default.

This is the same library `gopls` uses; if you wrap it, pin its version and update in lockstep with whatever ecosystem versions you also depend on.

---

## 7. Operational policy at scale

For a Go org maintaining tens of services:

- **One formatter binary version, repo-wide.** Pin in `tools/go.mod` or a `Makefile` target. Treat upgrades as PRs that touch every file affected by the version change.
- **One `-local` string.** Lives in `scripts/format.sh` and is the only place it is allowed to be defined.
- **CI gate uses `-l`, never `-w`.** Never let CI silently fix formatting; fail loudly so the diff lives in human-reviewed PRs.
- **Editor settings checked in.** Ship a `.vscode/settings.json` / `.editorconfig` so contributors do not need to configure `goimports` by hand.
- **Document the migration path** to `gofumpt + gci` if/when you outgrow `goimports`. A single PR that switches the formatter, run on the entire tree at once, is the only sane way; piecemeal migration creates merge conflicts.

---

## 8. Summary

`goimports` is a small CLI over `golang.org/x/tools/internal/imports`; the same engine powers `gopls`'s `organizeImports`. Its candidate-scanning algorithm scales with the size of your module graph and is memoized per process, which is why bulk runs are tolerable but per-file edits in an editor are best served by `gopls` instead. In production teams, pin the binary version, fix `-local` once, exclude `vendor/` and generated trees, and parallelize CI runs with `xargs -P` — and plan ahead for the eventual migration to `gofumpt + gci` if your import grouping needs outgrow what `-local` can express.

---

## Further reading
- `golang.org/x/tools/cmd/goimports`: https://pkg.go.dev/golang.org/x/tools/cmd/goimports
- `golang.org/x/tools/imports`: https://pkg.go.dev/golang.org/x/tools/imports
- `gopls` `organizeImports` source: https://github.com/golang/tools/tree/master/gopls/internal/golang
- `gci`: https://github.com/daixiang0/gci
- `gofumpt`: https://github.com/mvdan/gofumpt
