# Using Third-Party Packages — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [The `go get` Command in Depth](#the-go-get-command-in-depth)
3. [Pseudo-Versions and How to Read Them](#pseudo-versions-and-how-to-read-them)
4. [Major Version Imports (`/v2`, `/v3`)](#major-version-imports-v2-v3)
5. [Upgrading: `-u`, `-u=patch`, Per-Module Upgrades](#upgrading-u-upatch-per-module-upgrades)
6. [Downgrading and Pinning](#downgrading-and-pinning)
7. [Tracking What You Use vs What You Need](#tracking-what-you-use-vs-what-you-need)
8. [Replace Directives in Practice](#replace-directives-in-practice)
9. [Forking a Library You Depend On](#forking-a-library-you-depend-on)
10. [Auditing for Vulnerabilities (`govulncheck`)](#auditing-for-vulnerabilities-govulncheck)
11. [Auditing for Licenses (`go-licenses`)](#auditing-for-licenses-go-licenses)
12. [Reading the godoc / pkg.go.dev Effectively](#reading-the-godoc-pkggodev-effectively)
13. [Common Library Patterns and Gotchas](#common-library-patterns-and-gotchas)
14. [Best Practices for Established Codebases](#best-practices-for-established-codebases)
15. [Pitfalls You Will Meet](#pitfalls-you-will-meet)
16. [Self-Assessment](#self-assessment)
17. [Summary](#summary)

---

## Introduction

At the junior level, you `go get` a package and import it. That works for a weekend project. The middle-level job is *managing* third-party code as a long-running concern: deciding which versions to lock, when to upgrade, how to fork, and how to keep an audit trail of what your binary actually contains.

Third-party packages are not just a convenience — they are part of your build's surface area for security, licensing, performance, and operational risk. A team that treats `go get` as a one-shot install command will, two years in, find itself unable to upgrade because nobody remembers what each pinned version was for.

After reading this you will:
- Know every form of `go get pkg@<thing>` and when each is appropriate
- Read a pseudo-version and reconstruct the commit it points to
- Move a dependency cleanly from v1 to v2 without breaking imports
- Pick between `-u`, `-u=patch`, and a single-package upgrade
- Use `replace` directives correctly for forks and local development
- Run `govulncheck` and `go-licenses` and act on their output
- Read pkg.go.dev pages effectively, not just type-name references

---

## The `go get` Command in Depth

In modules-aware mode, `go get` only changes `go.mod` and `go.sum`. It does *not* install binaries any more — that is `go install`. Internalising that distinction will save hours.

### Forms of the version selector

```bash
go get github.com/foo/bar              # latest tagged release
go get github.com/foo/bar@latest       # explicit "latest" — same as above
go get github.com/foo/bar@v1.2.3       # exact version
go get github.com/foo/bar@v1.2         # latest patch within v1.2.x
go get github.com/foo/bar@v1           # latest minor.patch within v1
go get github.com/foo/bar@master       # forces a pseudo-version from branch tip
go get github.com/foo/bar@<commit-sha> # forces a pseudo-version from that commit
go get github.com/foo/bar@none         # removes the dependency
```

A few of these are surprising in practice:

- **`@latest`** means *latest tagged release*, not "tip of main." If a maintainer has not tagged in a year, `@latest` returns last year's tag.
- **`@master`** (or `@main`) skips tags entirely and asks the proxy to compute a *pseudo-version* from the branch's most recent commit. Use it sparingly — pseudo-versions are stable but visually noisy.
- **`@<commit-sha>`** does the same as `@master` but for a specific commit. The SHA may be short (12 chars) or long; the toolchain accepts both and rewrites it.
- **`@none`** is the "uninstall" form. It removes the `require` line and any indirect references that drop out as a result. Re-run `go mod tidy` to clean leftovers.

### What `go get` actually writes

Running `go get github.com/spf13/cobra@v1.8.0` produces:

```
go.mod:
    require github.com/spf13/cobra v1.8.0

go.sum:
    github.com/spf13/cobra v1.8.0 h1:...
    github.com/spf13/cobra v1.8.0/go.mod h1:...
```

The two `go.sum` lines hash the module *content* and the *`go.mod`* of that module. Both must match every time you build or your build is rejected.

### `go install` vs `go get`

```bash
go install github.com/foo/tool@latest   # install a binary, do NOT touch go.mod
go get     github.com/foo/lib@latest    # add a library dep to your go.mod
```

The two are commonly confused because in old (pre-1.16) Go they were merged. In modern Go they are strictly separate. If you find yourself running `go get` from outside a module to install a tool, switch to `go install`.

---

## Pseudo-Versions and How to Read Them

Sometimes you depend on a commit that has no tag. The Go module system invents a *pseudo-version* so it has something resembling SemVer to put in `go.mod`.

A pseudo-version looks like:

```
v0.0.0-20220101120000-abcdef123456
```

Three pieces:

| Piece | Example | Meaning |
|-------|---------|---------|
| Base version | `v0.0.0-` | The closest preceding tag, or `v0.0.0-` if none exists |
| UTC timestamp | `20220101120000` | The commit's timestamp in `YYYYMMDDhhmmss` |
| Short commit | `abcdef123456` | First 12 chars of the commit SHA |

Variations on the base:

- `v0.0.0-...` — there is no preceding tag at all
- `v1.2.3-0.YYYYMMDDhhmmss-abcdef` — preceded by tag `v1.2.2`; this commit is "after v1.2.2 on the way to a future release" so the base is `v1.2.3-0.`
- `v1.2.3-pre.0.YYYYMMDDhhmmss-abcdef` — based on a pre-release tag

### Why this matters

Pseudo-versions are *deterministic and stable*. Two developers who type `go get pkg@<same-commit>` get the same pseudo-version line in `go.mod`. The proxy ensures that.

But pseudo-versions are also a *signal*. A `go.mod` full of pseudo-versions usually means:

- The dependency is unstable (no real releases).
- Or someone wired in a fork that nobody re-tagged.
- Or someone needed an unreleased fix and never followed up to upgrade once a real release shipped.

Treat every pseudo-version in your `go.mod` as a TODO.

### Reading a pseudo-version back to a commit

```bash
go list -m -json github.com/foo/bar@v0.0.0-20220101120000-abcdef123456
```

The JSON includes `Origin.Hash`, the full SHA. Or `git log` in a clone of the upstream repo, searching for the short SHA.

---

## Major Version Imports (`/v2`, `/v3`)

Semantic Import Versioning is not a suggestion — it is enforced. A breaking-API release at `v2.0.0` of a library at `github.com/foo/bar` *must* be importable as `github.com/foo/bar/v2`.

### What this means for `go get`

```bash
go get github.com/foo/bar/v2          # picks the latest v2.x.y
go get github.com/foo/bar/v2@v2.3.1   # picks an explicit v2.x.y
go get github.com/foo/bar             # still picks v0/v1 line
```

Notice the `/v2` in the path. It is not a version selector — it is *part of the import path itself*. The toolchain treats `github.com/foo/bar` and `github.com/foo/bar/v2` as **two different modules** that may coexist in the same build.

### What this means for imports

After `go get github.com/foo/bar/v2`, your code must say:

```go
import "github.com/foo/bar/v2"
```

The package name on the right side of `bar.SomeFunc(...)` is usually still `bar` (the maintainer didn't rename the package, only the module path). So:

```go
import (
    "github.com/foo/bar/v2"
)

func main() {
    bar.SomeFunc()  // still "bar", not "v2"
}
```

To use both v1 and v2 simultaneously (rare but legal):

```go
import (
    bar1 "github.com/foo/bar"
    bar2 "github.com/foo/bar/v2"
)
```

### Common upgrade pattern from v1 to v2

```bash
# 1. Read the v2 release notes for breaking changes.
# 2. Update the import path everywhere:
find . -name '*.go' -exec sed -i '' 's|github.com/foo/bar"|github.com/foo/bar/v2"|g' {} +
# 3. Pull v2:
go get github.com/foo/bar/v2@v2.3.1
# 4. Drop the old line if go mod tidy hasn't:
go get github.com/foo/bar@none
# 5. Tidy and test:
go mod tidy
go build ./... && go test ./...
```

The v1 `require` line will not auto-disappear if any indirect dep still uses it. That is expected.

---

## Upgrading: `-u`, `-u=patch`, Per-Module Upgrades

`go get -u` is the upgrade hammer. Several variants:

```bash
go get -u ./...                # upgrade ALL deps to latest minor.patch
go get -u=patch ./...          # upgrade ALL deps to latest PATCH only
go get -u github.com/foo/bar   # upgrade ONE dep to its latest minor.patch
go get github.com/foo/bar@v1.4.0  # upgrade ONE dep to a specific version
```

What each does:

- **`-u`** moves to the most recent minor or patch within the same major. `v1.2.0` → `v1.5.7` is fine; `v1.x.x` → `v2.x.x` is *not* — major bumps are never silent.
- **`-u=patch`** is the safer flag: only patch-level (third-component) upgrades. `v1.2.0` → `v1.2.5` is fine; `v1.2.0` → `v1.3.0` is not.
- **Per-module** upgrades let you cherry-pick. Useful when you know one dep has a CVE fix in `v1.4.0` but you do not want to touch the rest.

### Recommended cadence

- **Patch upgrades:** weekly or per-release. `go get -u=patch ./...` followed by `go mod tidy` and the test suite. Almost always safe.
- **Minor upgrades:** monthly or per-release. `go get -u ./...` followed by reading the changelog of every diff. Run the full test suite, including integration tests.
- **Major upgrades:** ad-hoc, deliberate. One module at a time, with a feature branch and a code review.

### What `-u` does not upgrade

`-u` does not chase pseudo-versions. If a dep is pinned to a commit SHA, `-u` leaves it. You must explicitly `go get pkg@latest` (or `@<new-sha>`) to move it.

`-u` does not *downgrade* even if a constraint requires it. Downgrades are explicit.

---

## Downgrading and Pinning

Downgrading happens for three reasons:

1. The new version has a regression you cannot work around.
2. The new version increased your minimum Go toolchain.
3. The new version has an undisclosed CVE and you want to wait for a fix.

The mechanism:

```bash
go get github.com/foo/bar@v1.2.3   # explicit downgrade
go mod tidy
```

The pinned line in `go.mod` then reads:

```
require github.com/foo/bar v1.2.3
```

A subsequent `go get -u` will *not* push it forward unless you pass `-u` at that exact path. So pinning is sticky as long as nobody runs `go get pkg@latest` on it.

### Documenting a pin

Pins decay because nobody remembers why they exist. Always add a comment:

```
require (
    github.com/foo/bar v1.2.3 // pinned: v1.3.0 broke streaming, see #1234
)
```

The `//` comment survives `go mod tidy`. The line is now self-documenting.

### Pinning to a pseudo-version

You can pin to a commit you do not control:

```bash
go get github.com/foo/bar@abc123def456
```

This is appropriate when the upstream has merged your fix but not tagged a release. *Always* leave a comment explaining the reason and the upstream PR/issue. Pseudo-version pins are a maintenance liability — without context, the next person will not know whether they can upgrade.

---

## Tracking What You Use vs What You Need

A typical Go project's `go.mod` lists more modules than the project directly imports. Indirect modules — pulled in by your direct deps — also appear, marked `// indirect`.

Three commands you need:

### `go list -m all`

```bash
go list -m all
```

Lists every module in your *full* dependency closure, one per line. Useful for grepping ("does my build include some-module?") or piping into audit tools.

### `go list -m -u all`

```bash
go list -m -u all
```

Same list, but each line shows `[available_upgrade]` next to modules that have a newer version. This is the upgrade audit:

```
github.com/foo/bar v1.2.0 [v1.4.0]
golang.org/x/sync v0.5.0 [v0.6.0]
```

The output is *informational only*. It does not modify `go.mod`.

### `go mod why <pkg>`

```bash
go mod why github.com/spf13/pflag
```

Prints the *shortest import path* from one of your packages to the named module. If the answer is "(main module does not need package X)" you have leftover noise — usually a vendoring or `replace` artifact — that `go mod tidy` will clean.

`go mod why -m <module>` does the same at module granularity (slightly different question — "do I need this module at all?").

These three commands together form the audit triad: *what do I have, what could I upgrade, and why is each one here.*

---

## Replace Directives in Practice

`replace` is one of `go.mod`'s most powerful and most abused directives. The shape:

```
replace original/path => substitute/path version
```

Three common forms:

```
# 1. Local development against an unpublished sibling
replace github.com/myorg/lib => ../lib

# 2. A fork with a real version tag
replace github.com/upstream/x v1.2.3 => github.com/myorg/x v1.2.3-fork.1

# 3. A fork with a pseudo-version
replace github.com/upstream/x => github.com/myorg/x v0.0.0-20220101120000-abcdef123456
```

### Properties of `replace`

- It takes effect *only in the main module's `go.mod`.* Replacements in libraries you depend on are ignored. This is intentional: it stops a dep from forcing a substitution on everyone who imports it.
- It can substitute by path (a different module path entirely) or by version (same path, different version selected).
- It can point to a local directory (filesystem path) or a remote module path.
- It bypasses the proxy and checksum database when pointing to a local directory.

### When to use

- During local development of a library you are co-developing.
- For a temporary fork waiting on an upstream merge.
- For pinning a dep to a private patched build inside your organisation.

### When NOT to use

- As a substitute for `go.work`. If the replacement is purely for *your* local development, prefer `go.work` so you do not commit `replace` lines that are only meaningful on your machine.
- For long-term forks. If the fork is permanent, take ownership: rename the module path and publish under your own org.
- For "pin to commit X" — that is what version pinning (`go get pkg@<sha>`) is for. `replace` is for *swapping identities*, not for picking versions.

---

## Forking a Library You Depend On

Forking a third-party library is a process, not a single command. The recipe:

```bash
# 1. Fork the upstream on GitHub: github.com/upstream/x → github.com/myorg/x
# 2. Clone your fork locally and create a branch.
git clone git@github.com:myorg/x.git
cd x
git checkout -b fork-fix-issue-1234

# 3. Make changes, commit, push.
# 4. Tag a fork release that is clearly distinct from upstream tags.
git tag v1.2.3-fork.1
git push origin --tags

# 5. In your project, point the replace directive at the fork:
```

```
require github.com/upstream/x v1.2.3
replace github.com/upstream/x v1.2.3 => github.com/myorg/x v1.2.3-fork.1
```

Why this shape:

- The `require` line still names the upstream — *every* file in your code still imports `github.com/upstream/x/...`. No code changes needed.
- The `replace` swaps the identity at build time.
- The fork tag (`v1.2.3-fork.1`) is unambiguous — no risk of clashing with any future upstream tag.

### File a PR upstream

A fork is technical debt. Always:

1. Open the PR upstream.
2. Reference the upstream PR/issue in your fork's README and in a comment in `go.mod`.
3. Review the fork during every dependency audit.
4. Drop the fork as soon as the fix lands upstream and a release is cut.

A `replace` line that has been in `go.mod` for two years is almost always a bug.

---

## Auditing for Vulnerabilities (`govulncheck`)

`govulncheck` is the official Go vulnerability scanner. It checks your build against the [Go vulnerability database](https://pkg.go.dev/vuln/).

### Install

```bash
go install golang.org/x/vuln/cmd/govulncheck@latest
```

### Run

From the module root:

```bash
govulncheck ./...
```

Output looks like:

```
=== Symbol Results ===

Vulnerability #1: GO-2023-1234
    Some package has a buffer overflow when ...
  More info: https://pkg.go.dev/vuln/GO-2023-1234
  Module: github.com/foo/bar
    Found in: github.com/foo/bar@v1.2.0
    Fixed in: github.com/foo/bar@v1.2.4
    Example traces found:
      #1: cmd/server/main.go:42:6: server.handle calls bar.Parse
```

Key features:

- **Symbol-level analysis** — `govulncheck` traces from `main` through your code and only reports vulnerabilities on code paths your binary actually reaches. A vulnerable function that *exists* in a dep but is *unreachable* from your main is a low-priority informational hit, not a blocking finding.
- **No false positives from indirect deps you do not call.** This is the headline difference from vendor-name-only scanners.
- **Actionable upgrades.** Each finding lists the version that fixes it.

### Interpreting output

Three sections appear:

1. **Symbol Results** — functions in your build's call graph that are vulnerable. Action required.
2. **Imported Vulnerabilities** — modules you import that contain a vulnerable function, but you do not call that function. Lower priority but worth tracking.
3. **Required Vulnerabilities** — modules in your build whose source you do not even import directly. Even lower priority.

### CI integration

```bash
govulncheck -mode=binary ./bin/myapp           # scan a built binary
govulncheck -test ./...                        # also scan test code
govulncheck -json ./... > vuln.json            # machine-readable output
```

A typical CI step fails the build on any *Symbol Results* hit, warns on the others, and uploads the JSON for tracking.

---

## Auditing for Licenses (`go-licenses`)

License compliance is a real legal exposure. `go-licenses` (from Google) walks your build closure and lists each module's license.

### Install

```bash
go install github.com/google/go-licenses@latest
```

### Run

```bash
go-licenses report ./...
```

Output:

```
github.com/spf13/cobra,Apache-2.0
github.com/spf13/pflag,BSD-3-Clause
github.com/inconshreveable/mousetrap,Apache-2.0
golang.org/x/sync,BSD-3-Clause
```

Subcommands:

- `go-licenses check ./... --disallowed_types=forbidden` — fails if any dep has a forbidden license type (GPL family by default).
- `go-licenses save ./... --save_path=./third_party_licenses` — copies every dep's `LICENSE` file into your repo so you can ship them with your binary.

### Why care

- Distributing a binary built on GPL-licensed Go code without source disclosure is a license violation.
- Embedded systems and SaaS products often have license restrictions in customer contracts.
- Your legal team will eventually ask. Have the answer ready.

### Limitations

`go-licenses` reads `LICENSE` files from each module repo. Modules without a recognisable license file are flagged as "unknown" — track those down manually. Some modules use unusual filenames (`COPYING`, `LICENSE.md`, `MIT-LICENSE.txt`); the tool covers most common variants but not all.

---

## Reading the godoc / pkg.go.dev Effectively

`pkg.go.dev` is the public face of every module. Treat it as your primary reference, not just a search result.

### Page anatomy

A package page on pkg.go.dev has:

- **Header** — module path, latest version, license, repository.
- **Version dropdown** — switch between versions of the same module. Use this to read the docs for the *exact version you have*, not whatever the maintainer last shipped.
- **Constants and Variables** — top-level identifiers exported by the package.
- **Functions** — free functions, alphabetised.
- **Types** — each type with its methods, examples, and any nested types.
- **Examples** — runnable `Example_xxx` functions from `_test.go` files. These are gold; read them first.

### Workflow

1. Click the version dropdown and select your pinned version.
2. Read the package header docstring — that is the maintainer's intent.
3. Open the *Examples* section. Examples are the fastest way to grok an API.
4. Skim the *Types* — find the central type the package revolves around. Read its docstring and the docstrings of its methods in order of API obviousness.
5. Cross-reference with the source ("Open source code" link) when the docstring is thin.

### Useful URL patterns

- `https://pkg.go.dev/<modpath>@<version>` — pinned version page
- `https://pkg.go.dev/<modpath>@<version>#<symbol>` — anchor a specific function
- `https://pkg.go.dev/vuln/<id>` — Go vulnerability database entry

### Reading examples in your editor

Many tools (gopls, GoLand) surface package docs and examples inline. Configure them. Reading the docs *as you write the call* is faster than tab-switching to a browser.

---

## Common Library Patterns and Gotchas

Third-party Go libraries are not all built equal. A few common patterns to recognise:

### Heavy `init()` functions

A package's `init()` runs at process startup, before `main`. Some libraries do non-trivial work in `init()`:

- `github.com/lib/pq` parses `PG_TIMEZONEDIR` and similar environment variables at startup.
- Some database drivers register themselves with `database/sql` and panic if registered twice.
- Some logging libraries set global default loggers, which is invisible until you try to override them.

If you import a library and your binary's startup time jumps, look for `init()` functions in the new dep.

### Unstable APIs at v0

A module at `v0.x.y` is, by SemVer convention, *not yet stable*. Maintainers are free to break the API in any minor or patch release. If you depend on a v0 module:

- Pin to an exact version, never `@latest`.
- Do not assume v0.x → v0.x+1 is non-breaking. Read release notes.
- Plan for a "v1 migration" event when (if) the maintainer cuts v1.

### "Experimental" sub-packages

Some modules expose `experimental/` sub-packages whose API is officially unstable. `golang.org/x/exp/...` is the canonical example. Treat these as "may break at any time" — pin tightly and isolate behind your own interfaces so you can swap them out.

### Reflection-heavy libraries

Libraries that use `reflect` extensively (some ORM, validation, and serialisation libraries) tend to:

- Slow startup or per-request overhead.
- Surface bugs only at runtime rather than at compile time.
- Conflict with `go vet` and static-analysis tooling.

Their convenience is real; their cost is also real. Benchmark before adopting one in a hot path.

### Generics churn

Modules that adopted generics early (post-Go 1.18) sometimes shipped APIs that they later regretted. Watch for `go.mod` lines that bumped the `go` directive in step with a major release of a generics-heavy dep — that often signals a breaking API change.

---

## Best Practices for Established Codebases

1. **Run `go mod tidy` in CI as a verifier.** Any diff fails the build. This catches drift between imports and `go.mod`.
2. **Pin pseudo-versions only when you have a reason, and document the reason inline.** Untidy `go.mod` files are often half-pseudo-version, half-real, with no notes.
3. **Audit upgrades on a schedule.** A monthly hour-long session: `go list -m -u all`, read changelogs, run `govulncheck`, decide. Better than ad-hoc panic upgrades after a CVE.
4. **Treat every `replace` line as a debt.** Open a tracking issue. Set a reminder.
5. **Run `govulncheck` at least weekly in CI.** Make it a separate job from `go test` so its findings have their own visibility.
6. **Run `go-licenses` in CI for any binary you distribute.** Fail on disallowed licenses. Save license files alongside release artifacts.
7. **Fork by path-rename for permanent forks; fork by `replace` only for temporary ones.** Mixing these confuses everyone.
8. **Reference pkg.go.dev pages in code review when adopting a new dep.** "Why this dep, why this version, what's the maintenance cost" should be a short PR description, not a vibe.

---

## Pitfalls You Will Meet

### Pitfall 1 — `@latest` returns yesterday's bug fix, not today's

The proxy caches aggressively. A maintainer who tagged a release in the last few minutes may not be visible to `@latest` yet. If you need a brand-new release, pin the explicit version (`@v1.4.2`) — that triggers a fresh fetch.

### Pitfall 2 — `replace` only works in the main module

You added a `replace` line in your library, expecting consumers to inherit it. They do not. Their `go.mod` ignores your replacements completely. The fix is to communicate the substitution to consumers, not to bake it into your library.

### Pitfall 3 — Dropping a dep does not remove its `go.sum` lines

After `go get pkg@none`, the `require` line is gone but `go.sum` may keep checksums for transitive deps that were only needed by the removed module. Run `go mod tidy` to clean.

### Pitfall 4 — Major bump silently broken

You ran `go get -u` and it bumped a dep's *minor* version. Your build still works. What you missed: a different dep was at v2.x.x with a `/v2` path, and `-u` will not move it to v3 (which would require an import-path change). Always read the `[upgrade]` annotations of `go list -m -u all`.

### Pitfall 5 — Forked module with no fork-tag

You forked, changed code, pushed, and pointed `replace` at your fork *without tagging*. Now you depend on a moving target — the next push to your fork's main branch silently changes your build. Always tag fork releases (`v1.2.3-fork.1`).

### Pitfall 6 — `govulncheck` clean, real CVE in your build

`govulncheck` only finds vulnerabilities in the Go vulnerability database. Vulnerabilities that have been disclosed but not catalogued are invisible. Combine `govulncheck` with general SCA tools (Snyk, Trivy) for breadth.

### Pitfall 7 — Pseudo-version selected for a *tagged* release

You ran `go get pkg@<commit>` on a commit that had a tag attached. The `go.mod` ended up with a pseudo-version anyway. The fix: re-run `go get pkg@<tag>` to move it to the canonical tag form. Pseudo-versions for tagged commits are valid but ugly.

### Pitfall 8 — `init()` ordering surprise after upgrade

A patch-level upgrade introduced a new `init()` in a dep that registers a default handler before yours. Your once-working code now uses the wrong handler. There is no flag for this — diff the source between versions, or open an issue.

---

## Self-Assessment

You can move on to [senior.md](senior.md) when you can:

- [ ] Recite every form of `go get pkg@<thing>` and pick the right one for a given scenario
- [ ] Decode a pseudo-version into base, timestamp, and short-SHA, and explain why each is there
- [ ] Move a dependency from v1 to v2 without leaving v1 references in `go.mod`
- [ ] Choose between `-u`, `-u=patch`, and a one-package upgrade based on risk tolerance
- [ ] Write a `replace` line for a fork, and explain why it must be paired with a fork-tag
- [ ] Run `govulncheck`, distinguish Symbol-level findings from informational ones, and act on them
- [ ] Run `go-licenses` and produce a clean license report for a release
- [ ] Read a pkg.go.dev page for a pinned version and find the example for a specific symbol
- [ ] Diagnose every pitfall in this file from a build failure or audit-tool report

---

## Summary

Dependency management at the middle level is no longer about *getting code to compile*. It is about controlling identity, version, source-of-truth, and audit trail of every external module in your build. The toolchain is rich: `go get` with all its `@` selectors; pseudo-versions to name unnamed commits; `/v2` paths to enforce SemVer; `-u`/`-u=patch` to upgrade with discipline; `replace` for forks and local development; `govulncheck` and `go-licenses` to keep the audit trail honest. Use them deliberately. Document every pin, audit on a schedule, treat every `replace` as a debt, and read pkg.go.dev for the *exact* version you depend on. The team that does this finds upgrades boring. The team that does not eventually finds upgrades impossible.
