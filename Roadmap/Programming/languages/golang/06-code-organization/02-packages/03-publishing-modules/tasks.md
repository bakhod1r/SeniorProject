# Publishing Go Modules — Hands-on Tasks

> Practical exercises from easy to hard. Each task says what to build, what success looks like, and a hint or expected outcome. Solutions are at the end.

---

## Easy

### Task 1 — Tiny library, first tag

Create a directory `tinylib`. Inside, run `go mod init github.com/<you>/tinylib`. Add a single exported function `Greet(name string) string`. Initialise git, commit, and tag `v0.1.0`. Push the tag.

- Confirm `git tag --list` shows `v0.1.0`.
- Confirm `go list -m -versions github.com/<you>/tinylib` (after the proxy catches up) lists `v0.1.0`.

**Goal.** Walk through the minimum publish flow: code, commit, tag, push.

---

### Task 2 — LICENSE and README

Take the module from Task 1. Add a `LICENSE` file (MIT or Apache-2.0) and a `README.md` that includes:

- One-paragraph description.
- An install line: `go get github.com/<you>/tinylib@latest`.
- A minimal usage example fenced with ```` ```go ````.

Commit and tag `v0.1.1`. Confirm the README renders correctly on the repo's web view.

**Goal.** Make the module discoverable and legally usable.

---

### Task 3 — A godoc Example

Add an `example_test.go` next to `Greet` with a function `ExampleGreet`:

```go
func ExampleGreet() {
    fmt.Println(tinylib.Greet("world"))
    // Output: Hello, world
}
```

Run `go test ./...` and confirm the example runs and passes. Push and check that `pkg.go.dev/github.com/<you>/tinylib` shows the example after indexing.

**Goal.** Connect testing and documentation in the canonical Go way.

---

### Task 4 — Bumping `v0.1.0` to `v0.2.0`

Add a second function `Farewell(name string) string`. Commit. Tag `v0.2.0`. Push the tag. Confirm:

- `go get github.com/<you>/tinylib@latest` from a fresh consumer module pulls `v0.2.0`.
- `go.sum` in the consumer records the new version.

**Goal.** Master the routine minor-version bump.

---

### Task 5 — Crossing the v1 boundary

Decide that the API in `v0.2.0` is stable. Tag `v1.0.0` *without* changing the module path (v0 and v1 share the path). Push.

- Confirm `go list -m github.com/<you>/tinylib@latest` returns `v1.0.0`.
- Read the SemVer spec section on v1 and note one line about backward-compatibility commitments.

**Goal.** Understand that v0 and v1 share a path; v1 starts the public API contract.

---

## Medium

### Task 6 — Bumping to v2 (rename module path)

You decide v2 needs a breaking change to `Greet`'s signature. Walk through:

1. Edit `go.mod`: change the module line to `github.com/<you>/tinylib/v2`.
2. Update internal imports (none in this tiny case, but practise grepping).
3. Tag `v2.0.0` and push.
4. Confirm `go list -m github.com/<you>/tinylib/v2@v2.0.0` resolves.

In a fresh consumer, `go get github.com/<you>/tinylib/v2@latest` and use the new API.

**Goal.** Internalise the v2 path-rename rule.

---

### Task 7 — Retracting a release

You publish `v2.1.0` and discover a memory leak within an hour. Add to `go.mod` (in your repo's main branch):

```
retract v2.1.0
```

Tag `v2.1.1` (which contains the retraction directive and the fix). Push. Confirm:

- `go list -m -retracted -versions github.com/<you>/tinylib/v2` flags `v2.1.0` as retracted.
- A consumer running `go get github.com/<you>/tinylib/v2@latest` skips `v2.1.0`.
- `go get github.com/<you>/tinylib/v2@v2.1.0` still works (retract is advisory, not deletion).

**Goal.** Practise the retract workflow under realistic pressure.

---

### Task 8 — Vanity URL, static page

You want consumers to import `csv.example.com/csvkit` instead of `github.com/<you>/csvkit`. Without owning a real domain, simulate the static page locally.

Create `vanity/csvkit/index.html`:

```html
<!DOCTYPE html>
<html><head>
<meta name="go-import" content="csv.example.com/csvkit git https://github.com/<you>/csvkit">
<meta name="go-source" content="csv.example.com/csvkit https://github.com/<you>/csvkit https://github.com/<you>/csvkit/tree/main{/dir} https://github.com/<you>/csvkit/blob/main{/dir}/{file}#L{line}">
</head><body>
go get csv.example.com/csvkit
</body></html>
```

Serve the directory locally with `python3 -m http.server`. Use `curl http://localhost:8000/csvkit/?go-get=1` to verify the meta tag.

**Goal.** Read the meta-tag protocol and produce a valid file.

---

### Task 9 — GoReleaser config

Add a `.goreleaser.yaml` to a CLI module that:

- Builds for `linux/amd64`, `linux/arm64`, `darwin/amd64`, `darwin/arm64`, `windows/amd64`.
- Embeds version, commit, and date via `-ldflags`.
- Produces a `.tar.gz` for unix and `.zip` for windows.
- Generates a `checksums.txt`.

Run `goreleaser release --snapshot --clean` and inspect `dist/`.

**Goal.** Get one `goreleaser` config working end-to-end before wiring it to CI.

---

### Task 10 — Multi-module monorepo, prefix tags

Set up a repo:

```
mono/
├── shared/
│   └── go.mod    (module github.com/<you>/mono/shared)
└── cli/
    └── go.mod    (module github.com/<you>/mono/cli)
```

Tag the `shared` module with the prefix-tag form: `shared/v0.1.0`. Tag `cli` with `cli/v0.1.0`. Confirm:

- `go list -m -versions github.com/<you>/mono/shared` shows `v0.1.0`.
- `go list -m -versions github.com/<you>/mono/cli` shows `v0.1.0`.
- An external consumer can `go get github.com/<you>/mono/shared@v0.1.0` and `go get github.com/<you>/mono/cli@v0.1.0` independently.

**Goal.** Master the `<dir>/vX.Y.Z` tag form for monorepos.

---

## Hard

### Task 11 — GitHub Actions release pipeline

Build a workflow `.github/workflows/release.yml` that triggers on `push` of tags matching `v*` and:

1. Sets up Go using `go-version-file: go.mod`.
2. Runs `go test ./...`.
3. Runs `goreleaser release --clean`.
4. Uploads artefacts to the GitHub Release that `goreleaser` creates.

Test by tagging `v0.3.0` on a sandbox repo and confirming the release page lists every artefact.

**Goal.** A minimum production-grade release pipeline.

---

### Task 12 — Cosign-signing your release artefacts

Extend the workflow from Task 11 to sign every artefact with `sigstore/cosign` keyless signing (using GitHub OIDC). For each artefact `foo.tar.gz`, produce `foo.tar.gz.sig` and `foo.tar.gz.cert`.

Verify after release:

```bash
cosign verify-blob \
  --certificate foo.tar.gz.cert \
  --signature foo.tar.gz.sig \
  --certificate-identity-regexp 'https://github.com/<you>/.*' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  foo.tar.gz
```

**Goal.** Add supply-chain signatures consumers can verify.

---

### Task 13 — v1 maintenance branch alongside v2

You've shipped `v2.0.0` and the module path has moved to `.../v2`. A large customer needs `v1` patches.

1. Create branch `release/v1` from the last v1 tag.
2. Apply a security fix.
3. Tag `v1.4.3` *on the `release/v1` branch*.
4. Push the branch and the tag.

Confirm with `git branch --contains v1.4.3` that the tag is on the `release/v1` branch, not on `main`. Confirm both `go get .../tinylib@v1.4.3` and `go get .../tinylib/v2@latest` resolve correctly.

**Goal.** Run the two-track maintenance workflow.

---

### Task 14 — A runnable `Example_complex`

Write an `Example_processFile` (or similar named example for an unexported scenario) that:

- Creates a temp file via `os.CreateTemp`.
- Writes sample CSV input.
- Calls your library's parser.
- Prints structured output.
- Has a `// Output:` block that matches exactly.

Run `go test -run Example_processFile -v` and confirm. Push and check that `pkg.go.dev` displays it under the "Examples" heading.

**Goal.** Produce non-trivial, runnable, indexed documentation.

---

### Task 15 — Coordinated security release

Simulate CVE coordination. Choose a vulnerability scenario (e.g., an input parser that is exponentially slow on crafted input).

1. Open a *private* GitHub Security Advisory in your repo.
2. Prepare the fix on a private branch.
3. Coordinate an embargo date with at least one downstream consumer (you can simulate this by making a second repo that depends on the library).
4. On embargo day: merge fix, tag `v2.4.7`, publish the advisory, and submit the GHSA to the Go vulnerability database (`go-vulndb`) via PR.
5. Confirm `govulncheck` flags the vulnerable versions.

**Goal.** Walk through the full coordinated-disclosure flow.

---

## Bonus / Stretch

### Task 16 — Migrating to a vanity path mid-life

You have `github.com/<you>/csvkit@v1.5.0`. You buy `csv.example.com` and want consumers to use `csv.example.com/csvkit`.

1. Set up the vanity static page (Task 8) for real.
2. In the existing repo, *do not* rename the module yet — first add a deprecation notice to the README pointing to the new path.
3. Cut a new repo or tag a fresh major (`v2`) at `csv.example.com/csvkit/v2`.
4. Document the migration: shim file, deprecation timeline, recommended `go.mod` `replace` for transition.

**Goal.** Renaming a published module without breaking everyone.

---

### Task 17 — Reproducing the proxy-zip byte-identically

The Go proxy serves `https://proxy.golang.org/<module>/@v/<version>.zip`. Pick one of your tagged versions. Build the zip locally with `go mod download -x` plus inspection, and compare it to the proxy's copy using `sha256sum`.

If they differ, identify why (file ordering, mtimes, included/excluded files, line endings, hidden directories).

**Goal.** Understand the module-zip format at byte level.

---

### Task 18 — Private Athens proxy

Stand up `gomods/athens` locally (Docker is fine). Configure your client:

```
GOPROXY=http://localhost:3000,direct
```

Use it for two days of normal Go work. Verify by killing your network and confirming `go build` still works because Athens has cached the modules.

Add private modules from a local git server and verify Athens proxies them too.

**Goal.** Operate a private module proxy.

---

### Task 19 — Breaking-change scanner

Write a Go program that, given two tags `vA` and `vB` of a module, lists every *breaking* API change between them. Detect at least:

- Removed exported identifier.
- Changed exported function signature.
- Removed exported struct field.
- Added required interface method (i.e., interface widened).

Use `golang.org/x/tools/go/packages` to load both. Run it on two non-trivial versions of one of your published modules.

Bonus: emit an exit code of `1` if any breaking changes are found *without* a major-version bump.

**Goal.** Build the tool you wish your CI had before every release.

---

### Task 20 — Deprecation timeline document

Pick one of your published modules. Write a `DEPRECATION.md` that includes:

- The deprecated symbol or path.
- The version in which deprecation was announced.
- The version in which it will be removed (no sooner than two minor releases later).
- A migration recipe (find/replace or `gofmt -r`).
- Communication channels: README banner, release notes, `// Deprecated:` doc comments, GitHub issue label.

Add `// Deprecated: use Bar instead.` doc comments to the deprecated symbols. Confirm `go vet` (or `staticcheck`'s SA1019) flags consumers' use of them.

**Goal.** Produce a humane deprecation experience.

---

## Solutions (sketched)

### Solution 1
```bash
mkdir tinylib && cd tinylib
go mod init github.com/<you>/tinylib
# write greet.go with func Greet
git init && git add . && git commit -m "v0.1.0"
git tag v0.1.0
git remote add origin git@github.com:<you>/tinylib.git
git push -u origin main --tags
```

### Solution 2
LICENSE — copy the official MIT or Apache-2.0 text. README must include the install line and a fenced Go example. Re-tag `v0.1.1` only after `git commit`-ing both files.

### Solution 3
The example function name must match `ExampleGreet`. The `// Output:` comment is parsed by the test framework — exact whitespace match required. `go test ./...` runs it like any test.

### Solution 4
```bash
git tag v0.2.0
git push origin v0.2.0
```
Consumer side:
```bash
go get github.com/<you>/tinylib@latest
```

### Solution 5
```bash
git tag v1.0.0
git push origin v1.0.0
```
v0 → v1 is *not* a path rename. SemVer says v1.0.0 commits to backward-compatibility within the v1 line.

### Solution 6
```bash
# in go.mod:
module github.com/<you>/tinylib/v2
```
Then:
```bash
git commit -am "v2.0.0: breaking API"
git tag v2.0.0
git push origin v2.0.0
```
The `/v2` path suffix is the rule for v2+.

### Solution 7
`retract` block in `go.mod`:
```
retract v2.1.0  // memory leak, fixed in v2.1.1
```
Tag `v2.1.1` *after* committing the retract directive. Module-aware tools read retractions from the latest version's `go.mod`.

### Solution 8
The static page must be served at the import-path prefix and respond to `?go-get=1`. The `<meta name="go-import">` tag is mandatory; `go-source` is optional but improves pkg.go.dev.

### Solution 9
Minimum `.goreleaser.yaml`:
```yaml
project_name: tinycli
builds:
  - env: [CGO_ENABLED=0]
    goos: [linux, darwin, windows]
    goarch: [amd64, arm64]
    ignore:
      - {goos: windows, goarch: arm64}
    ldflags:
      - -s -w
      - -X main.version={{.Version}}
      - -X main.commit={{.Commit}}
      - -X main.date={{.Date}}
archives:
  - format_overrides:
      - {goos: windows, format: zip}
checksum:
  name_template: checksums.txt
```

### Solution 10
```bash
git tag shared/v0.1.0
git tag cli/v0.1.0
git push --tags
```
The `<subdir>/vX.Y.Z` form is the only correct way to version a sub-module in a monorepo.

### Solution 11
```yaml
on:
  push:
    tags: ['v*']
permissions:
  contents: write
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: {fetch-depth: 0}
      - uses: actions/setup-go@v5
        with: {go-version-file: go.mod}
      - run: go test ./...
      - uses: goreleaser/goreleaser-action@v6
        with: {args: release --clean}
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Solution 12
Add to GoReleaser:
```yaml
signs:
  - cmd: cosign
    artifacts: all
    output: true
    args:
      - sign-blob
      - --yes
      - --output-signature=${signature}
      - --output-certificate=${certificate}
      - ${artifact}
```
Workflow needs `id-token: write` permission for OIDC.

### Solution 13
```bash
git checkout -b release/v1 v1.4.2
# apply fix
git commit -am "fix: backport CVE-XXXX"
git tag v1.4.3
git push origin release/v1 v1.4.3
```
Tags do not have to be on `main`. The Go proxy resolves any reachable tag.

### Solution 14
```go
func Example_processFile() {
    f, _ := os.CreateTemp("", "in*.csv")
    f.WriteString("a,b\n1,2\n")
    f.Close()
    rows, _ := csvkit.Parse(f.Name())
    for _, r := range rows { fmt.Println(r) }
    // Output:
    // [a b]
    // [1 2]
}
```

### Solution 15
- GitHub: Security tab → Advisories → New draft.
- Private fork or branch for fix; tag only after embargo lifts.
- After release, open a PR to `github.com/golang/vulndb` adding a YAML report.
- Verify with `govulncheck ./...` against a consumer pinned to the vulnerable version.

### Solution 16
```
README banner:
> NOTICE: this module is moving to csv.example.com/csvkit/v2.
> github.com/<you>/csvkit will receive security fixes only until 2027-05-01.
```
Provide a transition `replace`:
```
replace csv.example.com/csvkit/v2 => github.com/<you>/csvkit/v2 v2.0.0
```

### Solution 17
```bash
GOPROXY=off go mod download -x github.com/<you>/tinylib@v1.0.0
sha256sum $GOPATH/pkg/mod/cache/download/.../v1.0.0.zip
curl -sL https://proxy.golang.org/github.com/<you>/tinylib/@v/v1.0.0.zip -o proxy.zip
sha256sum proxy.zip
```
Common differences: file mode bits, trailing slashes on directory entries, .git/ inclusion. Use `golang.org/x/mod/zip` to compare programmatically.

### Solution 18
```bash
docker run -d -p 3000:3000 \
  -v $PWD/athens-storage:/var/lib/athens \
  -e ATHENS_DISK_STORAGE_ROOT=/var/lib/athens \
  -e ATHENS_STORAGE_TYPE=disk \
  gomods/athens:latest
export GOPROXY=http://localhost:3000,direct
go build ./...
```

### Solution 19
Skeleton:
```go
import "golang.org/x/tools/go/packages"
cfg := &packages.Config{Mode: packages.NeedTypes | packages.NeedTypesInfo}
old, _ := packages.Load(cfg, "<modA>/...")
new, _ := packages.Load(cfg, "<modB>/...")
// Walk old's exported objects; for each, find counterpart in new.
// Compare type signatures; report removals and incompatible changes.
```
Combine with `git tag --list` to detect missing major bumps.

### Solution 20
```markdown
# Deprecation: Greet(name string)

Announced: v2.4.0 (2026-04-01)
Removal:   v3.0.0 (no sooner than 2026-08-01)

Migration:
  Greet(x)  -->  GreetCtx(ctx, x)
```
Add `// Deprecated:` doc comments. Static analysers will flag callers.

---

## Checkpoints

After completing the easy tasks: you can publish a v0 library, tag releases, and write godoc examples that the proxy and pkg.go.dev pick up.
After completing the medium tasks: you can run major-version bumps, retract bad releases, set up vanity URLs, and ship reproducible builds with GoReleaser across a monorepo.
After completing the hard tasks: you can drive a real release pipeline with signing, run a v1 maintenance branch alongside v2, write professional examples, and coordinate a security release end-to-end.
After completing the bonus tasks: you can rename modules without breaking ecosystems, operate your own proxy, audit your own releases for breakage, and run deprecations that your downstream consumers can actually act on.
