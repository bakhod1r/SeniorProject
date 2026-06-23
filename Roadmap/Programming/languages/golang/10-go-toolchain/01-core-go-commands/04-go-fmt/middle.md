# gofmt / go fmt — Middle

## 1. The flags that matter

`gofmt` is small but precise:

```bash
gofmt -l .          # list files whose formatting differs (no changes)
gofmt -w .          # write canonical formatting back to files
gofmt -d .          # print a unified diff of changes
gofmt -e file.go    # report all errors, not just the first 10
gofmt -s .          # apply simplifications (with -w to save them)
```

`go fmt ./...` is exactly `gofmt -l -w` over the matched packages. Use raw `gofmt` when you want `-d` (diff), `-s` (simplify), or to operate on directories rather than package paths.

---

## 2. `-s`: simplification rules

`-s` rewrites verbose-but-equivalent code into idiomatic forms:

```go
// before -s
s[1:len(s)]            // → s[1:]
for _, v := range x {} // unchanged
[]T{T{1}, T{2}}        // → []T{{1}, {2}}
m[k] = struct{}{}       // unchanged
```

It removes redundant slice high-bounds, redundant composite-literal type names, and similar noise. `-s` is safe and standard; many teams enforce `gofmt -s` rather than plain `gofmt`.

---

## 3. gofmt vs goimports

`gofmt` formats and groups imports but never **adds or removes** them. `goimports` (from `golang.org/x/tools`) does everything gofmt does **plus** manages the import list:

```bash
go install golang.org/x/tools/cmd/goimports@latest
goimports -w .      # format + add missing / remove unused imports
```

Most editors run `goimports` (or `gopls`, which incorporates it) on save, which is why imports "just fix themselves." In CI you typically check both formatting and import correctness.

---

## 4. gofumpt: a stricter superset

`gofumpt` (mvdan.cc/gofumpt) applies all gofmt rules plus extra opinionated ones (no empty lines at block start/end, consolidated short var groups, etc.). Its output is always also gofmt-valid.

```bash
go install mvdan.cc/gofumpt@latest
gofumpt -l -w .
```

Teams that want even less formatting variation adopt gofumpt; it is a drop-in replacement and integrates with gopls (`"gofumpt": true`).

---

## 5. Editor integration (the normal path)

In practice you rarely run the formatter manually. `gopls` (the language server) formats on save:

```jsonc
// VS Code settings (gopls)
"editor.formatOnSave": true,
"gopls": { "gofumpt": true },     // optional stricter mode
"editor.codeActionsOnSave": { "source.organizeImports": true }
```

This means gofmt + goimports run automatically on every save, so files are always canonical before you ever commit.

---

## 6. Checking, not fixing, in CI

CI should **verify** formatting and fail if anything is off — not silently rewrite:

```bash
# fails (non-empty output) if any file is unformatted
if [ -n "$(gofmt -l -s .)" ]; then
  echo "These files need gofmt -s:"; gofmt -l -s .
  exit 1
fi
```

Or with a diff for actionable output:

```bash
gofmt -s -d . | tee /tmp/fmt.diff
test ! -s /tmp/fmt.diff
```

The principle: developers format locally; CI only checks.

---

## 7. Pre-commit hooks

A common safety net so unformatted code never lands:

```bash
# .git/hooks/pre-commit (simplified)
files=$(git diff --cached --name-only --diff-filter=ACM | grep '\.go$')
[ -z "$files" ] && exit 0
unformatted=$(gofmt -l -s $files)
if [ -n "$unformatted" ]; then
  echo "Run gofmt -s -w on: $unformatted"; exit 1
fi
```

This catches files added with formatting issues before they reach CI.

---

## 8. What gofmt does NOT do

- It does not change semantics — only whitespace, layout, and the `-s` simplifications.
- It does not enforce naming, ordering of declarations, or line length.
- It does not add/remove imports (that is goimports).
- It does not lint for bugs (that is `go vet`/staticcheck).

Knowing the boundary keeps you from expecting gofmt to do a linter's job.

---

## 9. Trade-offs

| Choice | Pro | Con |
|--------|-----|-----|
| Plain gofmt | universal, zero config | leaves some variation gofumpt removes |
| `gofmt -s` | removes redundant code forms | none meaningful; adopt it |
| goimports | manages imports too | needs install; slightly more to run |
| gofumpt | maximal consistency | a non-stdlib tool to standardize on |

---

## 10. Summary

`go fmt ./...` is `gofmt -l -w` over packages; use raw `gofmt` for `-d`, `-s`, and `-l`. Add `-s` to remove redundant code forms, use `goimports` to manage imports, and consider `gofumpt` for stricter consistency. Editors run these on save via gopls, so you rarely type them; CI should *check* formatting (`gofmt -l`) and fail rather than rewrite. gofmt handles layout only — not imports, naming, or bugs.

---

## Further reading
- `gofmt`: https://pkg.go.dev/cmd/gofmt
- `goimports`: https://pkg.go.dev/golang.org/x/tools/cmd/goimports
- `gofumpt`: https://github.com/mvdan/gofumpt
