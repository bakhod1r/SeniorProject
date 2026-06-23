# Publishing Go Modules — Find the Bug

> Each snippet contains a real-world bug related to publishing a Go module: tagging, versioning, vanity URLs, proxy/sumdb interaction, license hygiene, and the long tail of release-day surprises. Find it, explain it, fix it.

---

## Bug 1 — Tag without the `v` prefix

```bash
$ git tag 1.0.0
$ git push origin 1.0.0
$ # consumer
$ go get github.com/me/awesome@1.0.0
go: github.com/me/awesome@1.0.0: invalid version: must be of the form v1.2.3
```

**Bug:** Go's module system mandates SemVer with a `v` prefix. A bare `1.0.0` is not a valid module version — the proxy will not index it, `go get` will not resolve it, and `pkg.go.dev` will not list it. Some teams ship a "1.0.0" tag for years and wonder why no one can install their module.

**Fix:** retag with the `v` prefix and remove the bad tag from the remote:

```bash
$ git tag -d 1.0.0
$ git push origin :refs/tags/1.0.0
$ git tag v1.0.0
$ git push origin v1.0.0
```

From now on, every release tag must look like `vMAJOR.MINOR.PATCH`.

---

## Bug 2 — `v2.0.0` tag without `/v2` in the module path

```go.mod
module github.com/me/awesome

go 1.22
```

```bash
$ git tag v2.0.0
$ git push origin v2.0.0
$ # consumer
$ go get github.com/me/awesome@v2.0.0
go: github.com/me/awesome@v2.0.0: invalid version: module contains a go.mod
file, so major version must be compatible: should be v0 or v1, not v2
```

**Bug:** Semantic Import Versioning rule: starting at `v2`, the module path itself must encode the major version. The repo says `module github.com/me/awesome` but the tag claims `v2.0.0`. The proxy refuses to publish it because importers using `github.com/me/awesome` would silently get a backwards-incompatible API.

**Fix:** edit `go.mod` to include `/v2` and update every internal import path before re-tagging:

```go.mod
module github.com/me/awesome/v2
```

```bash
$ # update all imports inside the module to github.com/me/awesome/v2/...
$ git commit -am "Promote to v2"
$ git tag v2.0.0
$ git push origin v2.0.0
```

Consumers now `import "github.com/me/awesome/v2"`.

---

## Bug 3 — Tag pushed locally only, not to the remote

```bash
$ git tag v1.4.0
$ git push           # main is up to date, but no --tags
$ # consumer
$ go get github.com/me/awesome@v1.4.0
go: github.com/me/awesome@v1.4.0: reading
https://proxy.golang.org/github.com/me/awesome/@v/v1.4.0.info: 404 Not Found
```

**Bug:** `git push` without `--tags` (or without naming the tag explicitly) only pushes branch refs. The tag exists on the maintainer's laptop but not on GitHub. The Go proxy asks GitHub for `v1.4.0` and gets a 404 — which it caches as a negative result for several minutes.

**Fix:** push the tag explicitly:

```bash
$ git push origin v1.4.0
```

Or push every tag at once:

```bash
$ git push --tags
```

For CI release jobs, prefer the explicit form so you do not push half-finished local tags by accident.

---

## Bug 4 — Private repo with no `GOPRIVATE`

```bash
$ go get github.com/acme-corp/internal-lib@v1.0.0
go: github.com/acme-corp/internal-lib@v1.0.0: reading
https://proxy.golang.org/github.com/acme-corp/internal-lib/@v/v1.0.0.info:
404 Not Found
verifying github.com/acme-corp/internal-lib@v1.0.0: checksum database lookup
required for non-public module
```

**Bug:** The repo is private. `proxy.golang.org` cannot see private GitHub repos, so it returns 404. Even if the proxy is bypassed via direct mode, `sum.golang.org` cannot verify a module it cannot fetch — and the toolchain refuses to install code without a checksum-DB lookup unless told the module is private.

**Fix:** mark the namespace as private in your environment (and document it in the repo's README so consumers do the same):

```bash
$ go env -w GOPRIVATE=github.com/acme-corp/*
```

For belt-and-braces:

```bash
$ go env -w GONOPROXY=github.com/acme-corp/*
$ go env -w GONOSUMCHECK=github.com/acme-corp/*
```

Commit a `Makefile` or `direnv` file that exports these for new contributors.

---

## Bug 5 — No `LICENSE` file in the repo

```bash
$ ls
README.md  go.mod  go.sum  main.go
$ # pkg.go.dev shows: "License: None detected"
```

**Bug:** Without a top-level `LICENSE` (or `LICENSE.md`, `COPYING`, etc.), pkg.go.dev marks the module as "license: None detected" and refuses to render most of the documentation. Many corporate consumers will not import an unlicensed module because in most jurisdictions "no license" means "all rights reserved" — i.e. legally unusable.

**Fix:** add an SPDX-recognised LICENSE file at the repo root before tagging:

```bash
$ curl -s https://choosealicense.com/licenses/mit/ -o /dev/null  # pick a license
$ cp ~/templates/LICENSE-MIT ./LICENSE
$ git add LICENSE
$ git commit -m "Add MIT license"
$ git tag v1.0.1
$ git push origin v1.0.1
```

pkg.go.dev re-scans on the next request to a fresh version.

---

## Bug 6 — Tag created on a non-default branch

```bash
$ git checkout feature/refactor
$ git tag v1.5.0
$ git push origin v1.5.0
$ # consumer
$ go get github.com/me/awesome@v1.5.0
# downloads, but pkg.go.dev shows the README from main, not the new docs
```

**Bug:** Go itself does not require the tag to be on `main` — it just resolves the commit. But pkg.go.dev, badge generators, and GitHub's "latest release" widget all read from the default branch. Tagging on a feature branch yields a working `go get` but mismatched documentation, missing release notes, and confused consumers who diff the tag against `main` and see unrelated changes.

**Fix:** merge the release into the default branch first, then tag the merge commit:

```bash
$ git checkout main
$ git merge --no-ff feature/refactor
$ git push origin main
$ git tag v1.5.0
$ git push origin v1.5.0
```

Make this an enforced rule in the release runbook: "tag `main`, never a feature branch."

---

## Bug 7 — Force-pushing a tag after the proxy cached it

```bash
$ git tag -f v1.2.0          # oh no, I forgot a fix
$ git push --force origin v1.2.0
$ # consumer (a few hours later)
$ go get github.com/me/awesome@v1.2.0
verifying github.com/me/awesome@v1.2.0: checksum mismatch
	downloaded: h1:abc...
	sum.golang.org: h1:def...
SECURITY ERROR
```

**Bug:** Once `proxy.golang.org` and `sum.golang.org` see a tag, its hash is recorded in an immutable transparency log. Force-pushing the tag changes the underlying commit/tree and therefore the module's hash. Every consumer who already cached the old version now gets a checksum mismatch — Go treats this as a possible attack and refuses to build.

**Fix:** *never* mutate a published tag. Cut a new patch version that supersedes it:

```bash
$ git tag v1.2.1
$ git push origin v1.2.1
```

If a published tag must be retracted (e.g. it leaks a secret or has a critical bug), use the `retract` directive (see Bug 8) — do not rewrite history.

---

## Bug 8 — `retract` is invisible until consumers upgrade

```go.mod
module github.com/me/awesome

go 1.22

retract v1.4.0   // had a critical correctness bug
```

```bash
$ git tag v1.4.1
$ git push origin v1.4.1
$ # consumer who is still on v1.4.0
$ go list -m -u github.com/me/awesome
github.com/me/awesome v1.4.0
```

**Bug:** A `retract` directive only takes effect when consumers fetch a *newer* version that contains it. Users still pinned to `v1.4.0` see no warning at all because `v1.4.0`'s own `go.mod` knows nothing about its retraction.

**Fix:** retract from a later release *and* announce it loudly:

1. Tag a new patch (`v1.4.1`) whose `go.mod` lists the retraction.
2. Add release notes warning users on `v1.4.0` to upgrade.
3. Open a GitHub Security Advisory if the bug is exploitable.
4. Optionally publish a Go vulnerability report so `govulncheck` flags it.

```go.mod
retract (
    v1.4.0    // critical bug, see GHSA-xxxx-xxxx
)
```

Consumers running `go list -m -u all` on a fresh resolve now see the warning.

---

## Bug 9 — Vanity URL meta tag malformed

The team owns `go.acme.dev/lib` and wants it to forward to GitHub. The HTML returned by `https://go.acme.dev/lib?go-get=1`:

```html
<meta name="go-import" content="go.acme.dev/lib https://github.com/acme/lib">
```

```bash
$ go get go.acme.dev/lib
go: go.acme.dev/lib: unrecognized import path "go.acme.dev/lib":
parse https://go.acme.dev/lib?go-get=1: meta tag missing VCS field
```

**Bug:** The `go-import` meta tag must contain *three* space-separated fields: `<import-prefix> <vcs> <repo-url>`. The example above omits the VCS (`git`).

**Fix:**

```html
<meta name="go-import"
      content="go.acme.dev/lib git https://github.com/acme/lib">
```

Verify with curl before announcing the path:

```bash
$ curl -sS 'https://go.acme.dev/lib?go-get=1' | grep go-import
```

While you are there, add the companion `go-source` tag so pkg.go.dev can link to source:

```html
<meta name="go-source"
      content="go.acme.dev/lib
               https://github.com/acme/lib
               https://github.com/acme/lib/tree/main{/dir}
               https://github.com/acme/lib/blob/main{/dir}/{file}#L{line}">
```

---

## Bug 10 — pkg.go.dev never indexes the module

```bash
$ # release pushed weeks ago
$ open https://pkg.go.dev/github.com/me/obscure
# 404 — "module not yet indexed"
```

**Bug:** pkg.go.dev only indexes modules that the public proxy has been asked about. For obscure modules, no one ever runs `go get`, so the proxy never fetches them, so pkg.go.dev never learns they exist.

**Fix:** trigger an indexing fetch by hitting the proxy directly:

```bash
$ GOPROXY=https://proxy.golang.org go get github.com/me/obscure@v1.0.0
```

Or just open `https://pkg.go.dev/github.com/me/obscure` once — the site requests on-demand if the version is missing. After that, every published version auto-indexes within minutes.

For new modules, also submit them to awesome-go and link from your README so users discover them.

---

## Bug 11 — Multi-module monorepo with the wrong tag prefix

```
repo/
├── go.mod                  # module github.com/me/repo
├── api/
│   ├── go.mod              # module github.com/me/repo/api
│   └── ...
└── cli/
    ├── go.mod              # module github.com/me/repo/cli
    └── ...
```

```bash
$ git tag v1.0.0
$ git push origin v1.0.0
$ # consumer
$ go get github.com/me/repo/api@v1.0.0
go: github.com/me/repo/api@v1.0.0: invalid version: unknown revision
api/v1.0.0
```

**Bug:** In a multi-module repo, each sub-module is versioned by a *prefixed* tag matching its directory: `api/v1.0.0`, `cli/v1.0.0`. A bare `v1.0.0` only versions the root module.

**Fix:** tag each sub-module with the directory prefix:

```bash
$ git tag api/v1.0.0
$ git tag cli/v1.0.0
$ git push origin api/v1.0.0 cli/v1.0.0
```

Document this in `RELEASING.md`. For convenience, automate it in the release script so contributors do not have to remember the convention.

---

## Bug 12 — CI tagged with uncommitted changes

```yaml
# .github/workflows/release.yml (excerpt)
- run: |
    sed -i 's/VERSION = ".*"/VERSION = "v1.6.0"/' version.go
    git tag v1.6.0
    git push origin v1.6.0
```

**Bug:** The workflow modifies `version.go`, then tags — but never commits. The tag points at the *previous* commit (the one that triggered the workflow), so `version.go` in the released code still says the old number. Worse, every fresh checkout of the tag shows clean state, hiding the discrepancy until someone runs `--version` and sees yesterday's value.

**Fix:** commit before tagging, or skip the in-file version entirely (use `runtime/debug.ReadBuildInfo` and `-ldflags`):

```yaml
- run: |
    sed -i 's/VERSION = ".*"/VERSION = "v1.6.0"/' version.go
    git add version.go
    git commit -m "Release v1.6.0"
    git tag v1.6.0
    git push origin main v1.6.0
```

Better: drop the hand-edited constant and inject at build time:

```bash
$ go build -ldflags "-X main.version=$(git describe --tags)"
```

---

## Bug 13 — `replace` directive committed in a release

```go.mod
module github.com/me/lib

go 1.22

require github.com/me/shared v1.4.0

replace github.com/me/shared => ../shared
```

```bash
$ git tag v1.5.0
$ git push origin v1.5.0
$ # consumer
$ go get github.com/me/lib@v1.5.0
go: github.com/me/lib@v1.5.0 requires
	github.com/me/shared@v1.4.0:
		replacement directory ../shared does not exist
```

**Bug:** `replace` only applies to the *main* module — it is ignored when the module is consumed. But it still ships in `go.mod`, signalling broken state and triggering errors on consumers whose tools (e.g. `go mod download` with `-x`) honour replacements during inspection. Even when ignored, it tells reviewers "this release was built against unstable local code."

**Fix:** strip `replace` directives before tagging. For local development, move them into a `go.work` file (which is *not* shipped):

```bash
$ go mod edit -dropreplace=github.com/me/shared
$ git commit -am "Drop replace before release"
$ git tag v1.5.0
```

CI guard:

```bash
$ grep -E '^replace\s' go.mod && { echo "replace directive present"; exit 1; } || true
```

---

## Bug 14 — `internal/` types leak through public API

```go
// pkg/api/handler.go
package api

import "github.com/me/lib/internal/auth"

func New() *Handler {
    return &Handler{Token: auth.Token{}}    // auth.Token re-exposed
}

type Handler struct {
    Token auth.Token
}
```

**Bug:** Code inside `internal/` cannot be imported by anyone outside the module — but a *type* from `internal/` can still be re-exposed through a public function's signature. Consumers cannot construct `auth.Token` (because they cannot import it), and yet they need one to use `Handler`. The public API is unusable from outside the module.

**Fix:** never expose internal types in public signatures. Either keep the type internal and use a public alias/interface, or move the type out of `internal/`:

```go
// pkg/api/handler.go
package api

type Token struct {
    Raw string
}

type Handler struct {
    Token Token
}
```

A simple lint gate:

```bash
$ go vet -vettool=$(which apidoc-lint) ./...   # or a custom check that scans
                                                # exported decls for internal/ types
```

---

## Bug 15 — Major v2 published without `/v2` in path

```go.mod
module github.com/me/awesome

go 1.22

// API was completely rewritten — breaking change!
```

```bash
$ git tag v2.0.0
$ git push origin v2.0.0
$ # the proxy rejects it (see Bug 2), but the team works around it
$ # by publishing as v1.99.0 instead — "close enough"
$ git tag v1.99.0
$ git push origin v1.99.0
```

**Bug:** Skipping `/v2` to avoid a "messy" rename violates SemVer. Existing `v1.x` consumers running `go get -u` get the breaking change automatically and their builds explode. SIV exists precisely to prevent this — bypassing it is hostile to downstream users.

**Fix:** do the rename properly. Either:

- Use a sub-directory: keep `v1.x` on `main`, put the new code under `/v2/` with its own `go.mod`.
- Use a branch: cut a `v2` branch, set its `go.mod` to `module github.com/me/awesome/v2`, tag `v2.0.0` from there.

Either way, document the migration in `MIGRATING-v2.md` and add a deprecation banner to v1's README pointing at v2.

---

## Bug 16 — Pre-release tag treated as latest

```bash
$ git tag v0.1.0-alpha.1
$ git push origin v0.1.0-alpha.1
$ # consumer
$ go get github.com/me/new-thing
go: added github.com/me/new-thing v0.0.0-20240101000000-abcdef123456
```

**Bug:** `go get` without an explicit version chooses the latest *stable* (non-prerelease) tag. With only pre-release tags published, Go falls back to the latest commit's pseudo-version — effectively giving every consumer an unstable, ever-changing pin. pkg.go.dev also refuses to mark a pre-release as "latest version," so the docs page looks empty.

**Fix:** publish a stable tag as soon as the API is usable. Even `v0.1.0` is fine:

```bash
$ git tag v0.1.0
$ git push origin v0.1.0
```

If you genuinely need a pre-release window, tell users explicitly:

```bash
$ go get github.com/me/new-thing@v0.1.0-alpha.1
```

…and document it in the README. Never ship pre-release-only.

---

## Bug 17 — Forgotten module deprecation comment

The team has rewritten `github.com/me/old-lib` as `github.com/me/new-lib` and intends `old-lib` to be archived.

```go.mod
module github.com/me/old-lib

go 1.22
```

**Bug:** Archiving the GitHub repo does not stop new users from `go get`-ing the module — the proxy continues serving cached versions. Without a deprecation marker, pkg.go.dev shows no warning, search results still rank the old module, and confused users keep filing issues against an archived repo.

**Fix:** add a *module-level* deprecation comment in `go.mod`, then publish one final tag:

```go.mod
// Deprecated: use github.com/me/new-lib instead.
module github.com/me/old-lib

go 1.22
```

```bash
$ git commit -am "Deprecate in favour of new-lib"
$ git tag v1.99.0
$ git push origin v1.99.0
```

`go list -m -u github.com/me/old-lib` now prints the deprecation message, and pkg.go.dev shows a banner.

---

## Bug 18 — License is not OSS-compatible

```
LICENSE
-------
Copyright (c) 2026 Acme Corp.

This software may be used internally by Acme Corp. employees only.
Redistribution prohibited.
```

**Bug:** pkg.go.dev only renders documentation when it can detect an *OSI-approved* license. A custom proprietary license is recognised as "non-standard" and the docs are hidden. Worse, many enterprise consumers run automated license scanners (FOSSA, Snyk) which block any non-permissive license — your module silently becomes unusable for half the Go community.

**Fix:** decide intentionally. If you want OSS distribution, use a recognised license: MIT, BSD, Apache-2.0, MPL-2.0. If the code is proprietary, do not publish to a public proxy at all — keep the repo private and use `GOPRIVATE`.

```bash
$ curl -sSL https://opensource.org/licenses/MIT > LICENSE
$ # edit copyright line, then commit and re-tag
```

For polyglot organisations: maintain an `LICENSING.md` that documents which licenses are approved.

---

## Bug 19 — Tag collision between branches

```bash
$ git checkout v1
$ git tag v1.5.0
$ git push origin v1.5.0
$ git checkout v2
$ git tag v1.5.0     # accidentally typed v1 instead of v2
fatal: tag 'v1.5.0' already exists
$ git tag -f v1.5.0
$ git push --force origin v1.5.0
```

**Bug:** Same as Bug 7 (force-pushed tag) plus a maintenance variant: in repos with multiple long-lived major-version branches, it is easy to mistype and overwrite a tag from another branch. The proxy already cached `v1.5.0` from the v1 branch — the force-push corrupts the relationship between tag and code.

**Fix:** never reuse tags. If you accidentally tag the wrong commit *before pushing*, delete locally and re-tag:

```bash
$ git tag -d v1.5.0
$ git tag v1.5.0 <correct-sha>
$ git push origin v1.5.0
```

If you already pushed, *do not* force-push. Bump the patch:

```bash
$ git tag v1.5.1
$ git push origin v1.5.1
```

CI guard: a `pre-push` hook that rejects `--force` on tags matching `v[0-9]*`.

---

## Bug 20 — Mixed-case module path breaks on Linux

```bash
$ go mod init github.com/Acme/MyLib
$ git tag v1.0.0
$ git push origin v1.0.0
$ # macOS developer: works
$ # Linux CI of consumer:
$ go get github.com/acme/mylib@v1.0.0
go: github.com/acme/mylib@v1.0.0: github.com/acme/mylib@v1.0.0:
parsing go.mod: unexpected module path "github.com/Acme/MyLib"
```

**Bug:** Module paths are case-sensitive on Linux but not on macOS/Windows. The maintainer's filesystem hides the mistake; consumers on Linux hit a hard error. Module paths must be lowercase by convention — and the proxy escapes uppercase as `!`-prefixed lowercase in cache paths, which is a separate footgun.

**Fix:** rename to all lowercase. This is a breaking change in the path, so it requires a coordinated migration:

1. Rename the GitHub repo to lowercase (GitHub redirects).
2. `go mod edit -module=github.com/acme/mylib`.
3. Update every internal import.
4. Tag a new release.
5. Add a redirect notice on the old (uppercase) path or archive it.

```bash
$ go mod edit -module=github.com/acme/mylib
$ git commit -am "Lowercase module path"
$ git tag v1.0.1
$ git push origin v1.0.1
```

---

## Bug 21 — No CHANGELOG, no release notes

```bash
$ ls
LICENSE  README.md  go.mod  go.sum  *.go
$ git tag v1.7.0
$ git push origin v1.7.0
$ # consumer running 'go get -u'
$ go list -m -u all
github.com/me/lib v1.6.0 [v1.7.0]
$ # what's new in v1.7.0? nobody knows.
```

**Bug:** No `CHANGELOG.md`, no GitHub Release notes, no annotated tag message. Consumers who upgrade have no way to know whether `v1.7.0` is a bug-fix sprint or a stealth API change. Auto-update bots silently bump and break.

**Fix:** keep a `CHANGELOG.md` (Keep-a-Changelog format works well) and either populate GitHub Release notes manually or use an annotated tag:

```markdown
# Changelog

## v1.7.0 — 2026-05-05
### Added
- New `Client.WithRetry` option.
### Fixed
- Race condition in connection pool ([#142]).
### Deprecated
- `Client.SetTimeout` — use the option instead.
```

```bash
$ git tag -a v1.7.0 -m "Release v1.7.0 — see CHANGELOG.md"
$ git push origin v1.7.0
$ gh release create v1.7.0 --notes-file CHANGELOG-v1.7.0.md
```

Automate this with `git-cliff`, `release-please`, or a hand-rolled script.

---

## Bug 22 — Silent v0 → v1 transition without docs

```bash
$ # historical state
$ git tag --list
v0.1.0
v0.2.0
v0.3.0
$ # today
$ git tag v1.0.0
$ git push origin v1.0.0
```

**Bug:** Going from `v0.x` to `v1.0.0` is a *commitment*: per SemVer, the API surface of `v1.0.0` is now stable and any breaking change requires a major bump. Users on `v0.3.0` who run `go get -u` are upgraded to `v1.0.0` automatically — and if `v1.0.0` is just `v0.3.0` renumbered, no one notices the contract changed. But if the API was tweaked along the way (`v0.x` allows breakage between minors), users get unexpected breakage with no migration guide.

**Fix:** treat the v1 release as a deliberate event:

1. Audit the public API. Lock it down. Run `gorelease` or `apidiff` against `v0.3.0`.
2. Write `MIGRATING-v1.md` listing every breakage since the last v0.
3. Update README to advertise v1 stability guarantees.
4. Tag and announce.

```bash
$ go install golang.org/x/exp/cmd/gorelease@latest
$ gorelease -base=v0.3.0
$ # fix any unintended breakage, document the rest
$ git tag v1.0.0
$ git push origin v1.0.0
$ gh release create v1.0.0 -F RELEASE-NOTES-v1.md
```

After v1, every breaking change needs `/v2`. No exceptions.

---

## Summary

Publishing a Go module is the moment when local convenience becomes a public contract. Most release-day bugs come from one of four sins:

1. **Mutating what should be immutable.** Tags, once pushed and seen by the proxy, are forever. Force-push, retract by rewrite, and reused tag names all break the checksum-DB invariant.
2. **Confusing major versions with minor releases.** `/v2` in the path and `vMAJOR` in the tag must agree. Skipping the rename to "save time" hurts every downstream user.
3. **Leaking local state into a release.** `replace`, `go.work`, hand-edited versions, and tags built from uncommitted CI state all signal "this artifact cannot be trusted."
4. **Forgetting that consumers are on a different machine.** Private repos need `GOPRIVATE`. Mixed-case paths break Linux. Unlicensed code is unusable. Pre-release-only tags hide your stable from `go get`.

Adopt a release runbook that enforces: stable tag, on the default branch, with a license, a CHANGELOG, no `replace`, and a CI check that runs `gorelease`. The rest of the publishing pipeline becomes mechanical.
