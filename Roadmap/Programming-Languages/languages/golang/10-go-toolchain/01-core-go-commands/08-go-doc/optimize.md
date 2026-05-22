# go doc — Optimization

`go doc` is a lookup tool, so "optimization" means faster discovery, better-rendering docs, and cheaper doc workflows. Numbers are illustrative.

---

## Exercise 1: `go doc` instead of a browser round-trip

**Before** — looking up an API means switching to a browser, searching pkg.go.dev, and waiting on the network.

**After:**

```bash
go doc strings.Builder        # instant, in the terminal
go doc -src sort.Ints         # implementation, no browser
```

| Metric | browser lookup | `go doc` |
|--------|----------------|----------|
| Time to answer | ~10–20s | <1s |
| Network needed | yes | no (for cached/local pkgs) |

For local and cached packages, terminal lookup is dramatically faster.

---

## Exercise 2: `-short` for a quick symbol survey

**Before** — `go doc -all pkg` floods the terminal when you only want the symbol list.

**After:**

```bash
go doc -short io       # one line per symbol
```

| Metric | `-all` | `-short` |
|--------|--------|----------|
| Output volume | full docs | compact list |
| Time to scan | slow | fast |

Use `-short` to find the right symbol, then drill in with `go doc pkg.Symbol`.

---

## Exercise 3: Prefer tested examples over prose

**Before** — long prose docs drift from real behavior and must be re-checked manually.

**After** — encode usage as `ExampleXxx` with `// Output:`:

```go
func ExampleClient_Get() { /* ... */ // Output: ... }
```

| Metric | prose docs | tested example |
|--------|-----------|----------------|
| Drift risk | high (manual) | zero (compiled + tested) |
| Maintenance | re-read periodically | `go test` enforces |

The example cannot rot because CI runs it.

---

## Exercise 4: Cache-friendly local HTML previews

**Before** — re-installing pkgsite each preview, or running a heavy server for one page.

**After** — a `make docs` target reusing the module cache:

```makefile
docs:
	go run golang.org/x/pkgsite/cmd/pkgsite@v0.0.0-... -open .
```

| Metric | reinstall each time | pinned `go run` |
|--------|---------------------|-----------------|
| Startup | re-resolve/build | cached after first |

Pin the pkgsite version so the module cache serves it without re-fetching.

---

## Exercise 5: Audit the public surface cheaply

**Before** — manually scanning files to know what a package exports.

**After:**

```bash
go doc -all . | grep -E '^(func|type|var|const) '
```

| Metric | manual file scan | one command |
|--------|------------------|-------------|
| Time | minutes | seconds |

A fast pre-release habit that catches accidental exports.

---

## Exercise 6: Lint docs in CI instead of manual review

**Before** — reviewers eyeball every PR for missing doc comments.

**After** — automate it:

```bash
go run github.com/mgechev/revive@v1.3.7 -rule exported ./...
```

| Metric | manual review | linter |
|--------|---------------|--------|
| Coverage | inconsistent | every PR |
| Reviewer effort | high | near zero |

---

## Measurement checklist
- [ ] Use `go doc` in the terminal for instant lookups.
- [ ] `-short` to survey symbols, then drill in.
- [ ] Encode usage as tested `ExampleXxx`, not prose.
- [ ] Pin pkgsite version so previews use the cache.
- [ ] Audit exports with `go doc -all . | grep`.
- [ ] Lint documented-exports in CI.
