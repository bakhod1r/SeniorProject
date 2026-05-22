# go doc — Professional

## 1. Documentation as a team deliverable

For libraries and shared internal packages, documentation is part of the API and should be reviewed like code. Establish that:

- Every exported symbol has a doc comment starting with its name.
- Package-level docs (often in `doc.go`) explain purpose and usage.
- Non-trivial APIs ship a tested `ExampleXxx`.
- `go doc -all .` is used in review to inspect the public surface a PR adds or changes.

The reviewer's question for any new exported symbol: *does this need to be public, and is it documented?*

---

## 2. Enforce documented exports in CI

Make missing docs a CI failure for public packages:

```bash
# using revive's "exported" rule
go run github.com/mgechev/revive@v1.3.7 -rule exported ./...
```

Or staticcheck's checks plus a custom script. Policy: exported symbols in published/shared packages must be documented; internal/`_test` code is exempt. This keeps pkg.go.dev clean and prevents undocumented API from leaking out.

---

## 3. Standardize on pkgsite for previews

Pick one local preview tool — **pkgsite** — and document it so everyone sees docs exactly as pkg.go.dev will render them:

```makefile
.PHONY: docs
docs:
	go run golang.org/x/pkgsite/cmd/pkgsite@latest -open .
```

Avoid the legacy `godoc` for new work; pkgsite matches the hosted site (1.19 comment formatting, examples, links). A `make docs` target removes setup friction for contributors.

---

## 4. Deprecation policy

Standardize how the team retires API without breaking consumers:

```go
// Deprecated: use Client.DoContext instead. Will be removed in v2.
func (c *Client) Do() error { ... }
```

- Always use the `Deprecated:` marker (tool-recognized; staticcheck `SA1019` flags callers).
- State the replacement and the removal timeline.
- Never remove exported API within a major version (Go's compatibility promise); deprecate, then remove in the next major.

This makes deprecations visible on pkg.go.dev and actionable for downstream teams.

---

## 5. Internal documentation discovery

`go doc` is the team's fastest internal-API discovery tool — better than a wiki that drifts:

```bash
go doc ./internal/billing            # what does this package offer?
go doc -all ./internal/billing       # everything, incl. usage notes
go doc -u ./internal/billing         # incl. unexported (for maintainers)
```

Encourage `doc.go` package overviews for non-obvious internal packages so a newcomer can `go doc ./internal/x` and understand it. Documentation co-located with code stays current; a separate wiki does not.

---

## 6. Reviewing for misuse

| Smell | Why it's wrong | Fix |
|-------|----------------|-----|
| New exported symbol, no doc comment | undocumented public API | require a comment or unexport it |
| Comment detached by a blank line | symbol appears undocumented | place comment directly above |
| Prose example that can rot | drifts from real behavior | add a tested `ExampleXxx` |
| Removing exported API in a minor release | breaks consumers | deprecate, remove next major |
| Over-exporting helpers | bloats the public surface | unexport; expose only what's needed |
| Using legacy `godoc` for previews | mismatches pkg.go.dev | use pkgsite |

---

## 7. Publishing-quality docs

Before tagging a public release:

1. `go doc -all .` to review the full exported surface.
2. `pkgsite -open .` to preview the exact HTML rendering.
3. Verify all `[links]` resolve and examples pass (`go test`).
4. Confirm `Deprecated:` markers are correct.
5. Ensure the package doc comment reads well as the landing page on pkg.go.dev.

This checklist catches public-facing doc problems while they are still cheap to fix.

---

## 8. Documentation and the compatibility promise

Because pkg.go.dev publishes your docs and consumers code against your exported API, professional teams treat the doc surface as versioned:

- New exported symbols are additive (safe within a major version).
- Doc comment changes that alter documented behavior are effectively API changes — review them.
- Examples encode the intended usage and are part of what you promise to keep working.

---

## 9. Summary

At team scale, documentation is a reviewed deliverable: enforce documented exports in CI, standardize on pkgsite for previews (not legacy godoc), and use `go doc -all .` to audit the public surface in review. Adopt the `Deprecated:` convention for tool-aware API retirement, never remove exported API within a major version, and keep package overviews in `doc.go` so `go doc ./internal/x` is the team's living, accurate API reference. Run a doc-quality checklist before public releases.

---

## Further reading
- Go doc comments: https://go.dev/doc/comment
- Go compatibility promise: https://go.dev/doc/go1compat
- pkgsite: https://pkg.go.dev/golang.org/x/pkgsite
