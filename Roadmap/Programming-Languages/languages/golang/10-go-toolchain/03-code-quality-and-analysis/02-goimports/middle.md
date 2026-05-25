# goimports — Middle

## 1. What `goimports` actually does on each run

For every file it processes, `goimports`:

1. Parses the file with `go/parser`.
2. Re-applies `gofmt` formatting (whitespace, layout).
3. Walks identifiers to find unresolved names that look like package selectors (`pkg.Symbol`).
4. Searches the standard library, the module cache, and the current module for a package whose imported name could provide those symbols.
5. Removes import specs whose imported name is referenced by nothing.
6. Rewrites the import block, then writes the result (with `-w`) or prints it.

The interesting parts — and the source of every surprise — are steps 3-4. `goimports` does **not** type-check the program; it does a lightweight, name-based search. That is fast but ambiguous when multiple packages export the same identifier.

---

## 2. Grouping imports with `-local`

By convention, an idiomatic Go import block has three groups separated by blank lines:

```go
import (
    "fmt"                              // stdlib
    "os"

    "github.com/spf13/cobra"           // third-party
    "go.uber.org/zap"

    "example.com/myorg/internal/db"    // local (your org/module)
    "example.com/myorg/pkg/util"
)
```

By default `goimports` only produces **two** groups: stdlib and "everything else." To get the three-group layout, use `-local`:

```bash
goimports -w -local example.com/myorg .
```

`-local` takes a comma-separated list of import path prefixes that should be treated as "yours." Multiple prefixes work:

```bash
goimports -w -local example.com/myorg,internal/ .
```

Pin this string in your Makefile or CI script so the whole team produces identical output.

---

## 3. Editor integration in practice

**VS Code (Go extension):**

```jsonc
{
  "go.formatTool": "goimports",
  "go.formatFlags": ["-local", "example.com/myorg"],
  "[go]": { "editor.formatOnSave": true }
}
```

**Neovim with `gopls`:** `gopls` exposes the same fixup as a code action. Format-on-save and `organizeImports` together replicate `goimports -local` behavior:

```lua
vim.api.nvim_create_autocmd("BufWritePre", {
  pattern = "*.go",
  callback = function()
    vim.lsp.buf.code_action({
      context = { only = { "source.organizeImports" } }, apply = true,
    })
    vim.lsp.buf.format({ async = false })
  end,
})
```

Configure `gopls` with `"local": "example.com/myorg"` in your editor's `gopls` settings to get the three-group layout.

---

## 4. CI: gate merges on formatted code

The standard CI check uses `-l` (list) to fail when any file is not formatted:

```bash
# fail if any file would be changed
test -z "$(goimports -l -local example.com/myorg .)"
```

Or, for a clearer error:

```bash
diff=$(goimports -l -local example.com/myorg .)
if [ -n "$diff" ]; then
  echo "unformatted files:"; echo "$diff"; exit 1
fi
```

A common variant prints the actual diff so reviewers see what is wrong:

```bash
goimports -d -local example.com/myorg . | tee /tmp/diff
[ ! -s /tmp/diff ]   # fail if non-empty
```

This costs almost nothing and prevents formatter wars in PRs.

---

## 5. How does it resolve a missing import?

When `goimports` sees `foo.Bar()` with no import for `foo`, it asks: "Which packages on this system have the name `foo` and export `Bar`?" To answer, it scans:

1. The standard library (very fast, fixed list).
2. The current module's own packages.
3. The Go module cache (`$(go env GOMODCACHE)`).
4. Anything in `GOPATH/src` (legacy).

It builds a candidate set keyed by the **last path component** of each package (because that is the default package name). For each candidate, it confirms the export exists. The first unambiguous match wins.

Consequence: a package you have not yet downloaded into the module cache is **invisible** to `goimports`. Run `go mod download` (or just compile once) before expecting `goimports` to find a new dependency.

---

## 6. Failure mode: ambiguous symbols

Two packages export the same identifier:

```go
// Both have a "rand" package: math/rand and crypto/rand.
n := rand.Intn(100)
```

`goimports` cannot type-check, so it picks one — usually the most recently used or, deterministically, the standard library one. It picks `math/rand`, even if you intended `crypto/rand`. This is a classic source of *"my code now compiles but is subtly wrong"* bugs.

Mitigation: when two packages share a name, **import the one you want manually** before running `goimports`. Once the import is present, `goimports` will not re-fight you.

---

## 7. `goimports` vs `gofmt` revisited

| Behavior | `gofmt` | `goimports` |
|----------|---------|-------------|
| Whitespace/layout | yes | yes (delegates to `gofmt`) |
| Sort imports inside a group | yes | yes |
| Add missing imports | no | yes |
| Remove unused imports | no | yes |
| Custom local-prefix grouping | no | yes (`-local`) |
| Ships with the toolchain | yes | no |
| Speed on huge files | very fast (lexical) | slower (also scans candidate packages) |

`goimports` always produces gofmt-clean output, so running `gofmt` after `goimports` is redundant.

---

## 8. Caveats worth knowing

- `goimports` will not import a package for a name that does not exist as a reference in your code. If you write code that *will* reference a package but the reference is commented out, the import will be removed.
- `goimports` runs on one file at a time. Cross-file refactors should be handled by `gopls` or `gorename`/`gopls rename`.
- The first run after `go install` warms an internal cache (`~/.cache/go-build` for parsed packages). The first invocation in a session can be noticeably slower than the second.

---

## 9. Summary

`goimports` does `gofmt` plus add/remove/sort imports, with a three-group layout enabled by `-local <prefix>`. Wire it into your editor on save and into CI as `goimports -l -local <prefix> .` to block unformatted PRs. Remember its resolution is name-based, not type-based: ambiguous package names are picked heuristically, and packages not yet in the module cache are invisible.

---

## Further reading
- `goimports` source: https://pkg.go.dev/golang.org/x/tools/cmd/goimports
- `gopls` settings (`local`, `gofumpt`): https://github.com/golang/tools/blob/master/gopls/doc/settings.md
- Effective Go on imports: https://go.dev/doc/effective_go#imports
