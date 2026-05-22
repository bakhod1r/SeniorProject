# go doc — Senior

## 1. Documentation is an API contract

For a published module, your doc comments *are* the public contract on pkg.go.dev. `go doc` is the fast local mirror of that. The senior mindset: treat the exported surface and its docs as deliberately as the code, because:

- Every exported symbol becomes a public API others depend on (the Go compatibility promise applies within a major version).
- pkg.go.dev renders your comments verbatim; sloppy or missing docs are publicly visible.
- `go doc -all .` is the cheapest way to audit "what do I actually export?" before a release.

```bash
go doc -all . | grep -E '^(func|type|var|const|    [A-Z])'   # survey the public surface
```

---

## 2. Doc comment formatting (Go 1.19+) and reproducibility

Since Go 1.19, doc comments have a defined lightweight syntax (headings `# X`, lists, links `[Name]`, code blocks via indentation). gofmt normalizes this. Consequences seniors track:

- Upgrading to 1.19+ reformats existing doc comments (one-time churn) — handle as an isolated commit.
- Links like `[OtherType]` and `[pkg.Symbol]` resolve on pkg.go.dev; broken links are silent — verify with a local pkgsite render.
- `go doc` shows the formatted text; pkg.go.dev renders the HTML. They should agree, so preview locally before publishing.

---

## 3. pkgsite vs godoc vs pkg.go.dev

| Tool | Status | What it is |
|------|--------|-----------|
| `pkg.go.dev` | hosted | The official site; renders published modules |
| `pkgsite` | current | The open-source engine behind pkg.go.dev; run locally for an accurate preview |
| `godoc` | legacy | The original local HTML server (x/tools); largely superseded |

```bash
go install golang.org/x/pkgsite/cmd/pkgsite@latest
pkgsite -open .    # exact pkg.go.dev rendering, locally, before you publish
```

Senior practice: preview with **pkgsite** (not the legacy `godoc`) because it matches what users will actually see, including the 1.19 comment formatting and example rendering.

---

## 4. Examples as tested documentation

`ExampleXxx` functions are the strongest documentation because they are compiled and run by `go test`:

- `Example()` documents the package; `ExampleType_Method()` documents a method.
- An `// Output:` comment makes the example a real test (output must match); omit it for examples that should compile but not be checked.
- `// Unordered output:` handles nondeterministic ordering.

Because they are tested, examples cannot rot the way prose can. Seniors prefer adding an example over a paragraph of prose for non-trivial APIs.

```go
func ExampleClient_Do() {
	// shown on pkg.go.dev AND verified by `go test`
}
```

---

## 5. Where it surprises people

- **`go doc` shows only exported symbols by default.** Use `-u` to see unexported; people debugging internal code forget this.
- **Two-arg vs dotted form.** `go doc strings Compare` and `go doc strings.Compare` are equivalent; ambiguous names sometimes need the two-arg form.
- **Module not in cache.** `go doc some/third/party` requires the module to be available (downloaded); otherwise it errors. Run inside the module or `go mod download` first.
- **`-src` shows the *cached* source** for the resolved version, not necessarily your local edits to a dependency.
- **Doc comment placement.** A blank line between the comment and the declaration detaches it; the symbol then appears undocumented.
- **Deprecation convention.** A paragraph starting `// Deprecated:` is recognized by tools (and pkg.go.dev) — seniors use it to signal API sunset.

---

## 6. Deprecation and stability signaling

```go
// OldFunc does X.
//
// Deprecated: use NewFunc instead.
func OldFunc() {}
```

The `Deprecated:` marker is a recognized convention: pkg.go.dev styles it, and linters (e.g., staticcheck `SA1019`) flag callers. This is the standard, tool-aware way to retire API without breaking the compatibility promise.

---

## 7. CI and documentation quality

While `go doc` is mostly interactive, docs can be gated in CI:

- Run `go doc -all .` and check exported symbols have non-empty comments (a small script or a linter like `revive`'s `exported` rule / staticcheck).
- Ensure `ExampleXxx` outputs are correct (`go test` already does this).
- Optionally render with pkgsite in CI to catch broken doc links before release.

```bash
# lint exported symbols are documented (revive)
revive -rule exported ./...
```

---

## 8. Reading the standard library

`go doc -src` plus `go doc -all` is a senior's fastest path into stdlib behavior:

```bash
go doc -all sync          # full API of sync
go doc -src sync.Once.Do  # exactly how Once works
```

Reading the source via `go doc -src` (it resolves the exact version your toolchain ships) is often faster and more authoritative than searching the web.

---

## 9. Summary

`go doc` is the terminal mirror of pkg.go.dev; your doc comments are a public API contract rendered verbatim, so audit the surface with `go doc -all .` and preview HTML with **pkgsite** (modern) rather than the legacy `godoc`. Use Go 1.19+ doc-comment formatting (headings, lists, `[links]`), prefer tested `ExampleXxx` functions over prose, and use the `Deprecated:` convention to retire API. Remember `-u` for unexported symbols, `-src` for cached implementations, and that detached comments make symbols look undocumented.

---

## Further reading
- Go doc comments (1.19+): https://go.dev/doc/comment
- `go doc`: https://pkg.go.dev/cmd/doc
- pkgsite: https://pkg.go.dev/golang.org/x/pkgsite
