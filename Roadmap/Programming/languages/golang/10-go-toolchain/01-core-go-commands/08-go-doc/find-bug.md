# go doc — Find the Bug

Each scenario looks fine but misbehaves. Find the defect, explain it, fix it.

---

## Bug 1 — Symbol shows as undocumented

```go
// Hello returns a greeting.

func Hello() string { return "hi" }
```

```bash
$ go doc .Hello
func Hello() string
```

(No documentation text appears.)

**Bug:** the blank line between the comment and the declaration detaches the doc comment.
**Fix:** remove the blank line so the comment is directly above `func Hello`.

---

## Bug 2 — Can't find an unexported symbol

```bash
$ go doc .helper
doc: no symbol helper in package ...
```

**Bug:** `go doc` only shows exported symbols by default; `helper` is unexported.
**Fix:** `go doc -u .helper` to include unexported names.

---

## Bug 3 — Wrong symbol address

```bash
$ go doc Builder
doc: no such package Builder
```

**Bug:** the package prefix is missing; `go doc` treats `Builder` as a package name.
**Fix:** `go doc strings.Builder` (or `go doc strings Builder`).

---

## Bug 4 — Third-party package not found

```bash
$ go doc github.com/foo/bar
doc: cannot find package "github.com/foo/bar"
```

**Bug:** the module is not available locally (not a dependency / not downloaded).
**Fix:** run `go doc` from within a module that requires it, or `go mod download github.com/foo/bar` first; outside a module, fetch it as a dependency.

---

## Bug 5 — `-src` shows unexpected code

```bash
$ go doc -src github.com/foo/bar.Do    # shows v1.2.0, but I edited a local copy
```

**Bug:** `-src` shows the resolved cached version's source, not your local edits to a dependency (unless via a `replace`).
**Fix:** use a `replace` to your local copy, or read the file directly; `go doc` reflects the module graph's version.

---

## Bug 6 — Example not shown / not tested

```go
func ExampleHello() {
	fmt.Println(Hello())
	// output: hi      // lowercase "output"
}
```

**Bug:** the magic comment must be `// Output:` (capital O); lowercase is ignored, so the example is not verified.
**Fix:** use `// Output:` exactly; then `go test` checks it and pkg.go.dev shows it.

---

## Bug 7 — Doc comment formatting looks wrong on pkg.go.dev

```go
// Config tunes the cache.
// -size: max entries
// -ttl: expiry
```

**Bug:** Go 1.19+ doc-comment formatting expects list markers and indentation; ad-hoc dashes may not render as a list.
**Fix:** use the documented syntax (e.g., a blank line then ` - item` lists), and verify with a local pkgsite render.

---

## Bug 8 — Using legacy godoc, output differs from pkg.go.dev

A developer previews docs with `godoc` and they look different from the published site.

**Bug:** `godoc` is the legacy tool; it does not match pkg.go.dev's current rendering (1.19 comments, examples, links).
**Fix:** preview with `pkgsite` (the engine behind pkg.go.dev): `pkgsite -open .`.

---

## Bug 9 — Removed exported API in a minor release

A library deleted an exported function in `v1.5.0`; consumers' builds break.

**Bug:** removing exported API within a major version violates the Go compatibility promise.
**Fix:** restore it, add `// Deprecated:` with a replacement, and remove only in the next major version (`v2`).

---

## How to approach these
1. Doc missing? → check for a detached comment (no blank line).
2. Symbol not found? → exported-only by default (`-u`), and include the package prefix.
3. Third-party not found? → it must be available/downloaded.
4. Example not verified? → `// Output:` capitalization.
5. Rendering wrong? → preview with pkgsite, use 1.19 comment syntax.
