# gofmt / go fmt — Professional

## 1. Pick one formatter and enforce it everywhere

The only formatting decision a team makes is *which* formatter is the standard; after that, gofmt's lack of options does the rest. Decide once:

- **Baseline:** `gofmt -s` (formatting + simplifications).
- **Imports:** `goimports` or rely on gopls's organize-imports.
- **Stricter:** `gofumpt` if you want maximal consistency.

Then apply the **exact same tool and version** in three places: editor (gopls config), pre-commit hook, and CI. Mismatch is the #1 cause of recurring "format" diffs.

---

## 2. CI policy: check, never rewrite

```bash
# scripts/check-fmt.sh
set -euo pipefail
unformatted=$(gofmt -s -l .)
if [ -n "$unformatted" ]; then
  echo "::error::Unformatted files (run 'gofmt -s -w .'):"
  echo "$unformatted"
  exit 1
fi
```

Rules to encode in `CONTRIBUTING.md`:
- Developers format locally (on save); CI only verifies.
- CI uses `gofmt -l`, never `go fmt` (which writes and would mask the problem).
- CI runs under the **pinned toolchain** so gofmt version matches developers'.

---

## 3. Pin the toolchain so gofmt is deterministic

Because gofmt's output is tied to the toolchain version, pin it:

```
// go.mod
go 1.23.0
```

```bash
export GOTOOLCHAIN=go1.23.0   # or `local` with a managed install
```

Now every developer and CI runner formats identically. Without this, a contributor on a newer Go can introduce diffs that fail CI on an older runner (or vice versa).

---

## 4. Editor configuration as a committed standard

Ship editor settings so new contributors are formatted-on-save from day one:

```jsonc
// .vscode/settings.json (committed)
{
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": { "source.organizeImports": "explicit" },
  "gopls": { "gofumpt": true }
}
```

This makes the standard the path of least resistance, so the CI check almost never fails in practice.

---

## 5. Handling formatter upgrades cleanly

When you bump the toolchain and gofmt's output changes (e.g., doc-comment reformatting), do it as a **dedicated, isolated commit**:

```bash
gofmt -s -w ./...
git commit -m "chore: reformat for go1.XX gofmt"
echo "<sha>" >> .git-blame-ignore-revs
git config blame.ignoreRevsFile .git-blame-ignore-revs
```

Keep formatting churn out of logic PRs, and ignore the reformat commit in blame so history stays readable.

---

## 6. Generated code must be gofmt-clean

Generators that emit Go must produce canonical output, or CI's format check fails on machine-written files. Two approaches:

1. Pass output through `go/format.Source` in the generator.
2. Run `gofmt -w` on generated files as a post-generation step.

Mark generated files with the standard header (`// Code generated ... DO NOT EDIT.`) and ensure `go generate ./...` plus a format pass leaves no diff.

---

## 7. Reviewing for misuse

| Smell | Why it's wrong | Fix |
|-------|----------------|-----|
| `go fmt ./...` in CI | Rewrites files, hides the violation | `gofmt -l` to check and fail |
| Different formatter in editor vs CI | Endless format diffs | One tool/version everywhere |
| Manually reformatting in a feature PR | Pollutes the diff | Isolate reformat commits |
| Generated files failing fmt check | Generator emits non-canonical code | `go/format` or post-`gofmt` |
| Discussing brace/indent style in review | gofmt already decided | Defer to the tool |
| No toolchain pin | gofmt version skew → flaky checks | Pin `go` directive + `GOTOOLCHAIN` |

---

## 8. Why this matters at scale

gofmt's value is **eliminating an entire category of bikeshedding**. A team that standardizes the formatter and toolchain never debates layout in code review, never has merge conflicts caused by whitespace, and onboards contributors who are correct-by-default. The professional job is not formatting code — it is removing every way for formatting to be inconsistent.

---

## 9. Summary

Choose one formatter (`gofmt -s`, optionally `goimports`/`gofumpt`) and enforce the identical tool and toolchain version across editor, pre-commit hooks, and CI. CI checks with `gofmt -l` and never rewrites. Pin the toolchain so gofmt is deterministic, handle formatter upgrades as isolated commits in `.git-blame-ignore-revs`, ensure generated code is canonical, and reject formatting debates in review. The goal: make inconsistent formatting impossible.

---

## Further reading
- `gofmt`: https://pkg.go.dev/cmd/gofmt
- `go/format`: https://pkg.go.dev/go/format
- gopls formatting: https://pkg.go.dev/golang.org/x/tools/gopls
