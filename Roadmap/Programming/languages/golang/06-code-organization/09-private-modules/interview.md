# Private Modules — Interview Q&A

> Questions and short, defensible answers across junior, middle, senior, and staff levels. Each answer is what you would actually say in an interview — concise, with the right hedges.

---

## Junior

### Q1. What is `GOPRIVATE` and why does it exist?

`GOPRIVATE` is an environment variable that holds a comma-separated list of module-path globs the toolchain should treat as private. For paths that match, `go` skips the public proxy (`proxy.golang.org`) and the public checksum database (`sum.golang.org`), and instead fetches directly via Git. It exists because the public proxy refuses (with HTTP 410) to serve modules from private repos, so without `GOPRIVATE` you cannot import private code.

### Q2. You run `go get github.com/yourorg/yourrepo` in a fresh project and get `410 Gone`. What's wrong and how do you fix it?

The toolchain asked `proxy.golang.org` for the module, which answered "I don't have it" because the repo is private. Fix: `go env -w GOPRIVATE='github.com/yourorg/*'` and re-run `go mod tidy`. If it still fails, the next layer is Git auth — likely a missing PAT or SSH key.

### Q3. Where does Go get its credentials when fetching a private module?

It doesn't. Go shells out to `git` (or whatever VCS), and `git` uses its normal credential pipeline — credential helpers, `.netrc`, SSH agent. If `git clone <repo>` works in your terminal, `go get` will too.

### Q4. Difference between SSH and HTTPS for private modules?

Functionally equivalent for fetching. SSH uses public-key auth via `~/.ssh`; HTTPS uses Basic auth via `.netrc` or a credential helper. SSH is friendlier on a developer's laptop; HTTPS with a PAT is friendlier in CI. Pick one and configure it everywhere.

### Q5. Should you commit `go.sum` for a private module?

Yes — exactly the same as for a public module. The `go.sum` records the hash of each pinned dependency and is how `go build` detects byte-tampering. The fact that the module is private has no bearing on whether you commit the lockfile.

---

## Middle

### Q6. `GOPRIVATE` vs `GONOPROXY` vs `GONOSUMDB` — what each one does individually.

`GONOPROXY` is the routing switch: matching paths bypass the `GOPROXY` chain and go straight to VCS. `GONOSUMDB` is the verification switch: matching paths skip the `GOSUMDB` lookup. `GOPRIVATE` is a convenience variable that sets the same glob list as both `GONOPROXY` and `GONOSUMDB`. You'd set them separately when you want, e.g., to route private code through an *internal* proxy (so `GONOPROXY` empty) but still skip the *public* sumdb (`GONOSUMDB=<glob>`).

### Q7. How do you configure private modules in GitHub Actions?

The standard pattern: configure `git` to embed the token in HTTPS URLs:

```yaml
- run: |
    git config --global url."https://x-access-token:${{ secrets.GITHUB_TOKEN }}@github.com/".insteadOf "https://github.com/"
    go env -w GOPRIVATE='github.com/${{ github.repository_owner }}/*'
```

`GITHUB_TOKEN` is auto-injected and can read every repo in the same org if its permissions are configured. For cross-org access, use a fine-grained PAT injected as a secret.

### Q8. What is `.netrc` and how does Go use it?

`.netrc` is a plain-text file in `~/.netrc` listing hostname-credential triples. `git`'s HTTPS layer reads it for Basic authentication. Go uses it indirectly — `go` calls `git`, `git` reads `.netrc`. Format:

```
machine github.com
  login your-username
  password ghp_yourPAT
```

Permissions must be `chmod 600`.

### Q9. Your CI started failing two months in with `terminal prompts disabled`. What happened and how do you fix it?

Almost certainly a 90-day PAT expired. The token is no longer valid; `git` falls back to prompting for a password; in CI, `GIT_TERMINAL_PROMPT=0` makes that fatal. Fix: rotate the PAT in your CI secrets store. Long-term: use a service account with a long-lived deploy key, or automate rotation.

### Q10. How do you cache private modules in CI without leaking the auth?

Cache the `~/go/pkg/mod` directory. The cache key should be `hashFiles('**/go.sum')` — different `go.sum` means different deps, different cache. The cache itself contains only the bytes of the modules; no auth data lives there. The token only ever exists as a CI secret, injected at job start.

### Q11. Can you have private modules in a Docker image without leaking the token in a layer?

Yes — use BuildKit secret mounts:

```dockerfile
RUN --mount=type=secret,id=netrc,target=/root/.netrc \
    go build ./...
```

The file is visible only during that `RUN` step and is not baked into the layer. Build with `docker build --secret id=netrc,src=$HOME/.netrc`.

### Q12. You have a `replace` directive pointing at a relative path. What breaks in CI?

The CI environment doesn't have your local `/Users/alice/foo` directory. Build fails with "directory does not exist." `replace` directives with absolute or `../` paths are a developer-convenience feature; they don't survive the trip to CI. Either remove before commit, or use a file-system-independent replace (a fork on Git).

---

## Senior

### Q13. When would you set up an internal Go module proxy?

When (a) your CI is hammering GitHub Enterprise to the point of rate-limiting, (b) you need a single audit point for "what dependencies entered our binaries," (c) you ship to air-gapped customers, or (d) you want to keep building when GitHub or the public proxy has an outage. For 1-10 person teams, plain Git plus `GOPRIVATE` is fine; the operational cost of a proxy outweighs the benefit. The break-even is somewhere in the 10-50 person range.

### Q14. Athens vs Artifactory — what's the trade-off?

Athens is open source, single binary, designed specifically for Go. Free, easy to stand up, ships modules and proxies public deps cleanly. Weaker on enterprise auth (you bolt on SSO via a reverse proxy), HA story is "run replicas with shared S3."

Artifactory is commercial, integrates Go alongside npm/Maven/Docker/Helm. Strong RBAC, audit logs, replication. Costs money and operationally heavier. Right answer if you already pay for it; wrong answer to license it just for Go.

### Q15. How does the public sumdb interact with private modules?

It doesn't, by design. `sum.golang.org` cannot fetch your private repo, so any lookup against it would fail. `GOPRIVATE` matches the path and skips the sumdb call entirely — both to prevent the failure and to avoid leaking your private path to the public DB operator.

For private code you want verified, options are: (1) trust your own `go.sum`, gated through PR review; (2) run an internal sumdb (significant engineering effort); (3) commit `vendor/` and review byte changes manually.

### Q16. What is the security trade-off of `GOSUMDB=off`?

It disables checksum verification for *every* module, including public ones. The first download of any new dep is unverified — a network-level attacker could substitute bytes. The hashes get committed to `go.sum`, and from then on the bad bytes are cached as canonical.

The only acceptable case is when you have an internal proxy you trust to enforce hashes (often the same proxy that maintains its own internal sumdb). For developer laptops, never set this.

### Q17. How would you architect access for an org with 100 engineers, 30 services, and an air-gapped customer?

- Athens (HA, S3 backing) inside the corporate network. All developers and CI use it as `GOPROXY`.
- One-PAT-per-org configured on Athens. Engineers don't carry tokens.
- For the air-gapped customer: vendor `vendor/` for those service repos, ship a tarball. Air-gapped builds use `go build -mod=vendor`.
- Audit hooks: Athens logs every fetch to a central pipeline. Quarterly review of "what entered prod."
- License/CVE: `govulncheck` and `go-licenses` in CI; fail on disallowed licenses.

### Q18. What happens if your internal proxy goes down at midnight?

Depends on `GOPROXY`. If you have `GOPROXY=https://athens.acme.io,direct`, every build with a warm `~/go/pkg/mod` keeps working — the toolchain reads from cache and never hits Athens. Cold builds fall through to `direct` and contact GitHub Enterprise instead. If you have `GOPROXY=https://athens.acme.io` (no fallback), cold builds fail until Athens is back. The trade-off is auditability vs availability.

### Q19. How does `GOPRIVATE` interact with `replace` directives?

`replace` short-circuits the entire fetch pipeline. For a path that matches a `replace`, the toolchain reads the local path or the alternate module path directly — `GOPROXY`, `GONOPROXY`, `GOSUMDB`, `GOPRIVATE` are all irrelevant. This is why `replace github.com/private/foo => /tmp/foo` works without any `GOPRIVATE` setup but is also why you should never commit a path-based `replace`.

### Q20. A teammate accidentally pushes a force-rewrite to a tag your `go.sum` references. What happens?

The first build that touches the cache afresh will fail with `checksum mismatch`. Existing builds with warm caches keep working. Engineers who already pulled the original bytes have them on their `go.sum`; engineers who pulled after the force-push see different bytes. The fix is coordination: identify the canonical version, all reset `go.sum`, all re-tidy. Long-term, lock branch protection on tag operations to prevent re-tagging.

---

## Staff

### Q21. The toolchain's proxy chain falls through on `404` and `410` only. Why those two specifically and not on, say, `5xx`?

By design — falling through on transient failures is dangerous. If `proxy.golang.org` had a 503 spike, the toolchain would skip it and go to `direct`, fetching from GitHub. That sounds fine, except `direct` doesn't go through the public sumdb (since the proxy was the source of truth for hashes). A determined attacker who could induce 5xx on the proxy could trigger an unverified VCS fetch. So the toolchain treats 5xx as "stop, the build must fail" rather than "fall through."

The pipe (`|`) separator opts in to fall-through-on-anything if you accept that risk.

### Q22. How would you implement a private GOPROXY in 200 lines of Go?

The protocol is just five HTTP endpoints. Pseudo-code:

```go
http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
    parts := strings.SplitN(r.URL.Path, "/@", 2)
    module := strings.Trim(parts[0], "/")
    op := parts[1] // e.g. "v/list" or "v/v0.3.1.zip"

    switch {
    case op == "v/list":
        versions := gitListTags(module)
        fmt.Fprintln(w, strings.Join(versions, "\n"))
    case strings.HasSuffix(op, ".info"):
        version := strings.TrimSuffix(op[2:], ".info")
        info := gitTagInfo(module, version)
        json.NewEncoder(w).Encode(info)
    case strings.HasSuffix(op, ".mod"):
        version := strings.TrimSuffix(op[2:], ".mod")
        w.Write(gitFileAt(module, version, "go.mod"))
    case strings.HasSuffix(op, ".zip"):
        version := strings.TrimSuffix(op[2:], ".zip")
        zipModule(w, module, version)
    }
})
```

Real implementations like Athens add caching, auth, signing, error handling, and conformance testing. But the protocol surface is genuinely tiny.

### Q23. The Go team adopted Sigstore for signing module zips experimentally. What changes for private modules?

If module zips are signed and the toolchain verifies signatures, you get a stronger integrity story than `go.sum`: the signature proves *who* released the bytes, not just *that* the bytes match an earlier observation. For private modules, the signing key is yours (per-org), and consumers verify against your published key. It is a long way from being default, and most teams will continue with `go.sum` + PR review for the foreseeable future. The infrastructure ask is non-trivial.

### Q24. You're asked to design a checksum DB for an internal Go ecosystem. How?

The protocol is well-defined. Components:

1. **Append-only Merkle tree of `(module, version, hash)` tuples.** Each leaf is one record; internal nodes are SHA-256 over children. Implementations like `mod/sumdb/tlog` give the storage primitives.
2. **Signing key** for the tree head. Hardware-backed (HSM) ideally.
3. **HTTPS frontend** serving `/lookup/...`, `/tile/...`, `/latest`.
4. **Backend ingestion** — when a release is tagged, fetch the bytes, hash, append to the tree, sign new head.
5. **Client config** — distribute the public key to dev machines: `go env -w GOSUMDB='internal-sumdb.acme.io+<key>+<url>'`.

The cryptographic engineering risk is high — bad signing or replay protection breaks the whole guarantee. Most companies skip this and rely on careful review of `go.sum`.

### Q25. What's wrong with `go.sum` as a security mechanism?

It is *Trust On First Use*. The first time a developer or CI fetches a dep, the bytes are blindly hashed and recorded. If those bytes were malicious, every subsequent build verifies against the bad hash and reports "all good." A real defence requires a third party to publish *expected* hashes — that is what `sum.golang.org` does for public modules. For private modules, no such third party exists by default. You substitute either an internal sumdb or rigorous PR review of `go.sum` deltas.

### Q26. Walk me through the entire request flow when a developer runs `go get github.com/acme/internal-auth@v0.3.1` with `GOPROXY=https://athens.acme.io` and `GOPRIVATE=github.com/acme/*`.

1. Toolchain checks `GONOPROXY` (inherits from `GOPRIVATE`). Path matches → routing decision is "go to `direct`."
2. But `GONOPROXY` skips only the proxy *chain*; the toolchain still considers `direct` for fetching.
3. So the path goes to `direct`: toolchain runs `git ls-remote https://github.com/acme/internal-auth.git`. `git` reads `.netrc` for github.com, authenticates, lists tags. Confirms `v0.3.1` exists.
4. `git clone --depth 1 --branch v0.3.1 ...` into the module cache build directory.
5. Toolchain validates the module zip rules (path layout, size, no symlinks).
6. Computes `h1:` hash of the zip and `h1:` hash of the `go.mod`.
7. Checks `GONOSUMDB`. Path matches → skip `sum.golang.org` lookup.
8. Compare computed hashes against existing `go.sum`. If first time, write to `go.sum`. If existing, must match.
9. Extract zip into `$GOMODCACHE/github.com/acme/internal-auth@v0.3.1/`, mark read-only.
10. Update `go.mod` `require` line.

If `GONOPROXY` were *empty* (not inheriting from `GOPRIVATE`), the request would go to Athens first; Athens would do steps 3-6 internally and stream the zip back. The toolchain would still skip sumdb (`GONOSUMDB`).

### Q27. A regulator asks "prove that the binary in production was built from this exact source." How do you answer with private modules involved?

- `go.sum` records the hash of every module — direct and transitive — that contributed source.
- `go build -trimpath` strips machine-local paths, making the build deterministic.
- `SOURCE_DATE_EPOCH` pins file mtimes for the same reason.
- Combine with an SBOM (`cyclonedx-gomod`) generated at build time.
- Sign the binary (`cosign sign`) keyed to the git commit and the SBOM digest.

Audit pipeline:

1. Take `go.sum` from the binary's source commit.
2. Take the SBOM signed alongside the binary.
3. Re-fetch each module at the recorded version (from your internal proxy).
4. Re-build with `-trimpath` and matching `SOURCE_DATE_EPOCH`.
5. Compare hashes byte-for-byte.

This works for private modules as long as the internal proxy retains the historical version. That is why retention policies on Athens/Artifactory matter for compliance.

### Q28. What is the biggest design weakness in `GOPRIVATE`?

Two candidates, both real:

(a) The variable conflates *routing* and *verification*. Setting `GOPRIVATE` skips both the public proxy *and* the public sumdb. For most teams that is what you want; for teams that want to use an internal proxy as a routing point but still verify against an internal sumdb, you have to explicitly unset `GONOPROXY` or `GONOSUMDB`. The mental model is fiddlier than it looks.

(b) Glob matching is on module *paths*, not URLs. If your private repo lives at `git.acme.io` and the module path is `git.acme.io/foo`, you have to ensure imports use that exact spelling — including case. Mismatches between the canonical module path (declared in `go.mod`) and the import path (used in code) silently bypass `GOPRIVATE`. This bites teams during host migrations.

### Q29. Why is module path case-folded with `!` instead of just lower-cased?

Because path lookup is on the *escaped* form, but the user-facing form preserves case. If `cmd/go` lower-cased imports, you'd lose the connection between `import "github.com/Acme/Foo"` in source and the canonical capitalisation. The `!`-prefix encoding lets the on-disk and on-wire representations be lowercase while the original case is recoverable. This matters most on case-insensitive filesystems (macOS default HFS+, Windows NTFS).

### Q30. Final: in what scenario would you pick "vendor everything, no proxy" over "internal proxy, no vendor"?

- The build environment is fully air-gapped (no network at all, ever).
- The build environment is hostile (potentially compromised) and you want to reduce moving parts.
- Compliance requires that the source contributing to the binary is in the same repo as the binary's source.
- The dep set is tiny enough that vendor bloat is not an issue.

For a typical ten-services-and-an-Athens setup, vendoring is overhead. For a single, regulated, ship-once-a-quarter binary on a closed network, vendoring is the simpler answer.
