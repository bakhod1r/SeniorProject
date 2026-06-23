# Publishing Go Modules — Interview Questions

> Practice questions ranging from junior to staff-level. Each has a model answer, common wrong answers, and follow-up probes.

---

## Junior

### Q1. How do I publish a Go module?

**Model answer.** Three steps, no registry sign-up:

1. Push the code to a public VCS (typically a Git host like GitHub or GitLab) at the URL declared in `go.mod`.
2. Create an annotated Git tag matching a semantic version: `git tag v0.1.0 && git push --tags`.
3. Trigger the proxy: anyone running `go get example.com/lib@v0.1.0` (including yourself once) will cause `proxy.golang.org` to fetch and cache it.

There is no `go publish` command. Publishing is just "tag, push, and let consumers fetch."

**Common wrong answers.**
- "Run `go publish`." (No such command.)
- "Submit to a central registry." (Go has no central registry; the proxy is a passive cache.)
- "Email the Go team." (No.)

**Follow-up.** *Do I need an account on `proxy.golang.org`?* — No. The proxy fetches on demand from your VCS.

---

### Q2. What is the relationship between a Git tag and a module version?

**Model answer.** The Git tag *is* the version. When the toolchain resolves `mod@v1.2.3`, it looks for the Git tag `v1.2.3` (or `subdir/v1.2.3` for a sub-module) and treats the commit it points at as the released version. No tag means no release.

**Follow-up.** *What happens if I move the tag to a different commit?* — The proxy has cached the original; consumers may see two different bytes for the same version, which is exactly what `go.sum` is designed to detect. Treat tags as immutable once published.

---

### Q3. What does semantic versioning mean for a Go library?

**Model answer.** Three numbers `MAJOR.MINOR.PATCH`:

- **MAJOR**: incremented for incompatible API changes.
- **MINOR**: incremented for backwards-compatible additions.
- **PATCH**: incremented for backwards-compatible bug fixes.

Go enforces this with teeth: a major-version bump forces a new module path (`/v2`, `/v3`...). Consumers who ignore semver in their tags pay for it later.

**Follow-up.** *Is `v1.0.0` mandatory before I can release?* — No. `v0.x.y` is valid and signals "API may still change."

---

### Q4. Why does my repository need a LICENSE file?

**Model answer.** Without an explicit license, your code is "all rights reserved" by default in most jurisdictions — meaning nobody can legally copy, modify, or import it. A `LICENSE` file at the repo root tells consumers what they may do. Common choices for libraries: MIT, BSD-3-Clause, Apache-2.0. `pkg.go.dev` will refuse to render a license badge without one.

**Common wrong answers.**
- "Open repos are automatically open-source." (No — visibility and license are separate.)
- "MIT and Apache-2.0 are the same." (No — Apache-2.0 has explicit patent grants.)

**Follow-up.** *Where should the LICENSE file live in a multi-module repo?* — At the root of each module (or symlinked) so each tagged module ships with its license.

---

## Middle

### Q5. What is the difference between a pre-1.0 release and a v1 release?

**Model answer.** Mechanically nothing — both use the unsuffixed module path. Semantically everything:

- **v0.x.y**: "API not stable; breaking changes may appear in any minor version."
- **v1.x.y**: "API stable; breaking changes require a major bump *and* a `/v2` path change."

Releasing v1 is a public commitment to API stability. Many libraries deliberately stay on v0 for years to keep flexibility.

**Follow-up.** *Should I rush to v1?* — No. Tag v1 only when the API has been used long enough to discover its shape. v0 is not embarrassing; broken v1 is.

---

### Q6. What is a pseudo-version and when does the toolchain create one?

**Model answer.** A pseudo-version is a synthetic version string the toolchain generates when no proper Git tag exists at the requested commit. Format:

```
v0.0.0-20231215120000-abcdef123456
```

Three parts: a base version (often `v0.0.0`), a UTC commit timestamp, and a 12-character commit hash.

The toolchain uses pseudo-versions when:
- A consumer runs `go get example.com/lib@main` (no tag at HEAD).
- A consumer runs `go get example.com/lib@<commit-sha>`.
- A repository has zero tags but is fetched anyway.

Pseudo-versions sort *before* `v0.0.1`, so a tagged release always wins over an untagged commit.

**Follow-up.** *Are pseudo-versions safe to depend on long-term?* — They work, but they are not advertised stability. Prefer real tags for production dependencies.

---

### Q7. Explain the `/v2` rule and why it exists.

**Model answer.** Modules at major version 2 or higher must end their path with `/vN` (e.g. `example.com/lib/v2`). The reason: Go enforces the *import compatibility rule* — within one major version, code that compiles today must compile tomorrow. To ship a breaking change, the path itself must change so that the old and new majors are *different modules* and can coexist in one build.

A v1 consumer is unaffected when v2 ships. A consumer who wants both can import both: `example.com/lib` and `example.com/lib/v2`. Without the path change, two majors of one library could not be in the same dependency graph.

**Follow-up.** *Do I bump the path on every minor release too?* — No, only on major. v2.0.0, v2.1.0, v2.5.3 all share `example.com/lib/v2`.

---

### Q8. How does `pkg.go.dev` learn about my module?

**Model answer.** Indirectly, via the Go module proxy. The flow:

1. You push a tag to your VCS.
2. Someone (often you) requests the version through `proxy.golang.org`.
3. The proxy fetches and caches it.
4. `pkg.go.dev` polls the proxy's index endpoint (`/index`) for new versions.
5. Within minutes, the new version appears on `pkg.go.dev/<module>`.

If the page is stale, visit `pkg.go.dev/<module>@<version>` directly — it triggers a re-fetch.

**Follow-up.** *Why might my module never appear?* — Common causes: `robots.txt` blocks the proxy, the repo is private, there is no `LICENSE` file (the page renders but is hidden from search until OSS-licensed), or the module path in `go.mod` does not match the URL where the code lives.

---

### Q9. What godoc conventions should I follow when publishing a library?

**Model answer.** Several:

- Every exported identifier has a comment that *starts with the identifier's name*: `// Open opens the file...`, not `// This function opens the file...`.
- Each package has a doc comment immediately above its `package` clause, summarising the package's purpose in one paragraph.
- A `doc.go` file is the conventional home for the package comment when it is more than a few lines.
- The first sentence is shown in summary listings — make it complete and informative.
- Use proper grammar; godoc is a public artifact.

**Follow-up.** *How do I show a code block in a doc comment?* — Indent the block by one tab; godoc renders it as preformatted code.

---

### Q10. What is a runnable example and why should I write them?

**Model answer.** A runnable example is a function in a `_test.go` file named `Example`, `ExampleFoo`, or `ExampleType_Method`, ending with an `// Output:` comment that lists the expected stdout.

```go
func ExampleHello() {
    fmt.Println(Hello("world"))
    // Output: hello, world
}
```

Three benefits:
1. `go test` runs them, so the docs cannot drift from reality.
2. `pkg.go.dev` displays them with a "Run" button next to each.
3. They give consumers a copy-paste starting point that *is verified to work*.

**Follow-up.** *What if my example produces non-deterministic output?* — Use `// Unordered output:` for sets, or omit the `Output:` line entirely (the example then compiles but is not executed by `go test`).

---

## Senior

### Q11. How do you design a stable public API for a Go library?

**Model answer.** A few hard-won principles:

- **Accept interfaces, return concrete types.** Consumers can swap their inputs; the library keeps a stable shape on the way out.
- **Keep the surface small.** Every exported name is a promise. Unexport whatever the user does not strictly need.
- **Use functional options for constructors with many parameters.** `New(opts ...Option)` survives addition of new knobs without breaking existing call sites.
- **Avoid panics in library code.** Return errors. Reserve panics for programmer errors that cannot be recovered.
- **Be conservative with types.** Do not export internal types just because they are convenient; once exported, they are forever.
- **Reserve the zero value.** A useful zero value for your structs lets consumers `var x Thing` and start using it.

**Follow-up.** *What is the most underrated rule?* — "Do not export until pressured to." Every export costs you v2.

---

### Q12. What does backwards-compatible mean for a Go library, and which changes break it?

**Model answer.** Backwards-compatible means: code that compiled and behaved correctly against version N continues to compile and behave correctly against N+1, where N+1 is a minor or patch release.

Changes that are **safe**:
- Adding a new exported function, type, or method.
- Adding a new field to a struct (in some cases — see next).
- Loosening a constraint (e.g., accepting more inputs).

Changes that are **breaking**:
- Removing or renaming an exported identifier.
- Changing a function signature.
- Adding a method to an interface (consumers' implementations no longer satisfy it).
- Adding a field to a struct that consumers construct with positional `T{a, b}` syntax.
- Changing the type of an exported variable.

The Go 1 compatibility promise (and many libraries' promises) prohibits all of the latter.

**Follow-up.** *How do I add a method to an interface without breaking consumers?* — Define a new interface that embeds the old one and add the method there; or accept the breakage and bump major.

---

### Q13. Explain `Deprecated:` comments and the `retract` directive.

**Model answer.** Two different mechanisms:

- **`// Deprecated:`** — a human-and-tool-readable signal in a doc comment. Linters (`staticcheck`) and IDEs flag uses of the deprecated identifier and surface the replacement. The code still compiles. Use this when you want to phase out an API over months or years.

  ```go
  // Deprecated: use OpenContext instead.
  func Open(...) {...}
  ```

- **`retract`** — a directive in `go.mod` that withdraws a published version. Consumers who already use the retracted version see a warning; consumers running `go get` are pushed to a non-retracted version. Use this for releases that should never be used (security holes, accidentally-tagged WIP, severe regressions).

  ```
  retract v1.4.2 // Tagged by mistake; missing migration logic.
  ```

You retract by *publishing a new version* with the `retract` line in `go.mod`. The retraction itself is a release.

**Follow-up.** *Can I un-retract?* — Yes — publish another version that removes the `retract` line. But the audit trail is permanent in git history.

---

### Q14. A security vulnerability is discovered in your library. Walk through the coordinated release.

**Model answer.**

1. **Receive the report through a private channel** — `SECURITY.md` should advertise this (e.g. a security email or a GitHub Security Advisory). Do not discuss the bug in public issues.
2. **Confirm the vulnerability** on a private branch.
3. **Reserve a CVE** through GitHub's advisory tooling or directly with MITRE.
4. **Develop the fix on a private fork** so the diff is not visible until release.
5. **Coordinate disclosure** with the reporter. Pick a release date that allows downstream consumers (especially large ones who rely on you) some lead time to prepare patches.
6. **Tag the patched version** on the release date — typically a patch bump (`v1.5.4`) for the current major, plus parallel patches for any still-supported earlier majors.
7. **Publish the advisory** on `pkg.go.dev/vuln`. Include CVE, affected versions, fixed versions, severity, and a workaround if any.
8. **Retract** the vulnerable versions in a follow-up release if the issue is severe enough that no consumer should ever use them.
9. **Communicate** through release notes, mailing lists, and a pinned issue.

**Follow-up.** *How do you balance speed against coordination?* — Critical RCE: tag-and-disclose within hours. Information leak with no exploit path: schedule with downstream consumers over a week.

---

### Q15. When and how would you set up a vanity import path for your module?

**Model answer.** When the project's identity should be decoupled from its hosting URL — typically because:

- You may relocate from one VCS host to another without breaking consumers.
- The project belongs to an organisation with its own brand (`go.uber.org/zap`, `gopkg.in/yaml.v2`).
- The actual VCS URL would leak details (private corporate hosts, internal mirror URLs).

**Mechanism.** Serve an HTML page at the vanity URL with a `<meta name="go-import">` tag pointing to the real VCS:

```html
<meta name="go-import" content="example.com/mylib git https://github.com/myorg/mylib">
```

The toolchain fetches this page, reads the meta tag, and clones from the real URL. Consumers see only `example.com/mylib`.

You also need a `<meta name="go-source">` tag (optional) so `pkg.go.dev` can link to source.

**Follow-up.** *What is the operational risk?* — The vanity host becomes a single point of failure. If `example.com` goes down, every consumer's `go get` for your module fails. Use a CDN-backed static page to mitigate.

---

## Staff / Architect

### Q16. Why use GoReleaser and what does a typical release pipeline look like?

**Model answer.** GoReleaser automates the steps between "I just pushed a tag" and "users can install the binary on every platform we support." For a library it adds value too — checksums, signed artifacts, changelogs.

A typical pipeline triggered by a tag push:

1. CI checkout at the tagged commit.
2. `goreleaser release --clean`:
    - Cross-compile for all configured `GOOS`/`GOARCH` pairs.
    - Build archive files (`.tar.gz`, `.zip`).
    - Compute SHA-256 checksums.
    - Sign artifacts (Cosign / Sigstore).
    - Generate the changelog from commit messages.
    - Create a GitHub release with all artifacts attached.
    - Publish a Homebrew tap formula, a Scoop bucket entry, etc.
3. Push container images to a registry, also signed.
4. (Optional) Trigger a release notification (Slack, Discord).

The `.goreleaser.yaml` is committed; the pipeline is reproducible and reviewable.

**Follow-up.** *What does GoReleaser not solve?* — It does not bump the version, decide what to release, or coordinate with downstream. It is build-and-publish only.

---

### Q17. How do you tag releases in a multi-module monorepo?

**Model answer.** With per-module path-prefixed tags. If your repo contains modules at:

- `/` → module `github.com/org/project`
- `/cli/` → module `github.com/org/project/cli`
- `/pkg/sdk/` → module `github.com/org/project/pkg/sdk`

Then tags are:

- `v1.2.3` for the root module.
- `cli/v0.4.0` for the CLI module.
- `pkg/sdk/v2.1.0` for the SDK.

The Go toolchain understands this convention: when resolving `github.com/org/project/cli@v0.4.0`, it looks for the tag `cli/v0.4.0` and treats the directory `cli/` of that commit as the module root.

**Operational notes.**
- CI tooling must understand the prefix scheme — naive tag pipelines tag everything at `vX.Y.Z` and break.
- Release tooling (`goreleaser`, custom scripts) must be configured per module.
- A single commit can carry multiple module tags if a coordinated release is desired.

**Follow-up.** *What if a sub-module has its own `LICENSE` requirement?* — Each tagged sub-module is its own module to `pkg.go.dev`; each needs a license discoverable from its module root.

---

### Q18. How would you sign release artifacts with Sigstore / Cosign?

**Model answer.** The goal: consumers can verify "this binary was built by the maintainer's CI from this commit" without the maintainer holding a long-lived signing key.

Sigstore's keyless signing flow:

1. CI authenticates to Sigstore's Fulcio CA via OIDC (GitHub Actions provides an OIDC token automatically).
2. Fulcio issues a short-lived (10-minute) X.509 certificate bound to the OIDC identity (`https://github.com/org/repo/.github/workflows/release.yml@refs/tags/v1.2.3`).
3. Cosign signs the artifact with the certificate's private key, then discards the key.
4. The signature, certificate, and a transparency log entry (Rekor) are attached to the release.

Consumers verify with:

```
cosign verify-blob \
  --certificate-identity 'https://github.com/org/repo/...' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  --signature sig.txt --certificate cert.pem \
  artifact.tar.gz
```

No key material is stored long-term. The transparency log makes signatures non-repudiable.

GoReleaser has a `signs:` section that wires this up declaratively.

**Follow-up.** *How does this compare to GPG signing?* — GPG requires you to safeguard a private key forever and consumers to trust it via the web of trust. Sigstore replaces both with short-lived certs and a public log.

---

### Q19. Your company runs a private Go module proxy. What does the deployment look like?

**Model answer.** Several moving parts:

- **Proxy server.** Athens or a hosted equivalent (JFrog Artifactory, Google Artifact Registry's Go support). Stores fetched module zips and `go.mod` files.
- **Storage backend.** S3, GCS, or block storage; modules are immutable, so cache-forever is fine.
- **Authentication.** Modules from corp VCS need credentials; the proxy holds them so individual developers do not.
- **`GOPROXY` configuration on developer machines.** Typically:
  ```
  GOPROXY=https://corp.example.com/proxy,https://proxy.golang.org,direct
  ```
  Corp proxy first for private modules; public proxy for everything else.
- **`GOPRIVATE` configuration.** Lists the corp module path prefixes (`corp.example.com/*`) so the toolchain skips checksum DB lookups for them.
- **`GONOSUMCHECK` or a private sumdb.** For private modules with no public checksum database.
- **CI-side mirroring.** CI also points at the corp proxy; combined with `-mod=readonly` it produces hermetic, auditable builds.
- **Audit logging.** Every fetch is logged for compliance.

**Follow-up.** *Why not just use `direct` everywhere internally?* — Latency (no caching), credential sprawl (every dev has VCS creds), and no audit trail. The proxy is the chokepoint where security and performance both win.

---

### Q20. How do you decide when to release v2 versus making a careful additive change in v1?

**Model answer.** A v2 release is expensive: every consumer must update import paths. The cost is visible (PRs across an ecosystem), the benefit is invisible (cleaner API). Default to *not* doing v2.

Heuristics for the v2 decision:

- **Is the breaking change avoidable?** Often a deprecation + new function alongside is enough. Half of "v2 plans" can be solved with `Deprecated:` and a parallel API.
- **Is the cost concentrated?** If only your team consumes the library, v2 is cheap. If thousands of repos depend on it, v2 is a community event.
- **Is there technical debt v1 cannot absorb?** Sometimes the type system itself is wrong (an interface that should never have been exposed, a generic that needs different constraints). Then v2 is unavoidable.
- **Can I batch breaking changes?** Holding back several breaking changes for one v2 amortises the migration cost.

When you do go v2: announce it well in advance, ship a migration guide, run v1 patches in parallel for at least 6 months, and consider a `v1tov2` static-analysis tool that auto-rewrites consumers' imports.

**Follow-up.** *What is "v2-and-done"?* — Some libraries treat v2 as so painful that they pre-emptively over-design v1, then refuse to v2 ever. Pragmatic but ossifying.

---

### Q21. A consumer reports that `go get example.com/lib@latest` is returning an old version. What is the diagnostic path?

**Model answer.**

1. **Confirm the tag exists in the VCS.** `git ls-remote --tags origin`. Missing tag → just push it.
2. **Check the proxy index.** `curl https://proxy.golang.org/example.com/lib/@v/list` should list the tag. If not, request `https://proxy.golang.org/example.com/lib/@v/v1.2.3.info` to force a fetch.
3. **Verify the tag format.** Lightweight tags (`git tag v1.2.3`) work; annotated tags (`git tag -a`) work; tags without a leading `v` (e.g. `1.2.3`) do not.
4. **Verify the module path matches.** If `go.mod` says `module example.com/lib/v2` and the tag is on `master`, but no `v2.x.x` tag exists, the proxy treats `latest` as the highest v0/v1 tag.
5. **Check `retract` directives** in newer versions; a retracted "latest" is skipped.
6. **Is the repo private?** The public proxy returns 404; consumers must configure `GOPRIVATE`.
7. **Stale local cache.** `go clean -modcache` and retry.

**Follow-up.** *What does `@latest` mean precisely?* — The highest non-retracted, non-prerelease tag of the module's current major. v0/v1 share, v2+ have their own `@latest` per major.

---

### Q22. You inherit a popular open-source Go library. What does "good module hygiene" look like as a maintainer?

**Model answer.** A checklist:

- **`go.mod` declares the minimum supported Go version**, and CI tests against that minimum *and* tip.
- **`go.sum` is committed** and verified clean by CI (`go mod tidy && git diff --exit-code`).
- **`LICENSE`, `README.md`, `CHANGELOG.md`, `SECURITY.md`, `CONTRIBUTING.md`** all present and current.
- **Doc comments on every exported identifier**, with at least one runnable example per top-level package.
- **Release process documented** — branch protection, signed tags, automated changelog.
- **Vulnerability scanning** in CI (`govulncheck ./...`).
- **Dependency hygiene** — minimal direct dependencies, no abandoned transitives, `dependabot` or equivalent enabled.
- **`pkg.go.dev` page healthy** — license badge present, examples render, no broken links.
- **Issue triage SLA** — even a slow one is better than none. Stale issues drive contributors away.
- **Predictable release cadence** — even "we tag when there are accumulated changes" is a cadence; "whenever I feel like it" is not.

**Follow-up.** *Which is most important?* — Documentation and a license. Consumers can work around bugs; they cannot work around "I do not know what this code does or whether I am allowed to use it."

---

## Quick-fire

| Q | Crisp answer |
|---|--------------|
| Command to publish a Go module? | `git tag vX.Y.Z && git push --tags`. |
| Required tag prefix? | `v` (e.g. `v1.0.0`). |
| Path suffix for v3? | `/v3`. |
| Pre-1.0 stability promise? | None — API may change. |
| Pseudo-version base? | Often `v0.0.0-` plus timestamp + commit. |
| File needed for `pkg.go.dev` license badge? | `LICENSE` at module root. |
| Directive that withdraws a published version? | `retract`. |
| Where is keyless artifact signing logged? | Rekor (Sigstore transparency log). |
| Tag for module at `/cli` directory v0.4.0? | `cli/v0.4.0`. |
| Tool that automates cross-build + release? | GoReleaser. |

---

## Mock Interview Pacing

A 30-minute interview on publishing Go modules might cover:

- 0–5 min: warm-up — Q1, Q3, LICENSE basics.
- 5–15 min: middle topics — Q5, Q7, Q8, godoc/examples.
- 15–25 min: a senior scenario — Q12, Q13, or the security release Q14.
- 25–30 min: a curveball — monorepo tagging Q17, Sigstore Q18, or v2 decision Q20.

If the candidate is sharp on semver and `/v2`, jump straight into deprecation and security workflows. If they stumble on tags vs versions, stay in junior/middle territory until they can recite the publishing flow without prompting.
