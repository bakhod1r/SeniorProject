# Module Proxy & Checksum Database — Interview Questions

> Practice questions ranging from junior to staff-level. Each has a model answer, common wrong answers, and follow-up probes.

---

## Junior

### Q1. Where do Go dependencies come from when you run `go build`?

**Model answer.** By default, from a *module proxy* — an HTTP server named in `GOPROXY`, defaulting to `proxy.golang.org`. Go does not clone the source repo directly in the common case; it asks the proxy for the module's version list, metadata, `go.mod`, and source zip over a small HTTP protocol. The proxy already did the Git work and cached the result. Downloaded modules land in the shared module cache (`$GOMODCACHE`).

**Common wrong answers.**
- "Go clones from GitHub directly." (Only with `GOPROXY=direct` or for `GOPRIVATE` paths.)
- "Dependencies are stored in `go.sum`." (No — `go.sum` stores hashes, not code.)

**Follow-up.** *What does `direct` at the end of `GOPROXY` mean?* — A fallback: if no proxy can serve a module, fetch it from its source VCS directly.

---

### Q2. What is `go.sum` and what does it protect against?

**Model answer.** `go.sum` records a cryptographic hash (`h1:`) for every module version your build uses — one line for the source zip, one for the `go.mod`. On every build, Go re-hashes the cached bytes and compares to `go.sum`. If they differ, the build fails. It protects against the dependency's bytes *changing* after you first recorded them — corruption, a moved Git tag, a tampering proxy, or a MITM.

**Common wrong answers.**
- "It stores the dependency source." (No — only hashes.)
- "It checks that dependencies are safe." (No — it checks they are *unchanged*, not that they are non-malicious.)

**Follow-up.** *Should you commit `go.sum`?* — Yes, always, alongside `go.mod`.

---

### Q3. What is the difference between `GOPROXY` and `GOSUMDB`?

**Model answer.** `GOPROXY` is *where code comes from* — the download server. `GOSUMDB` is *how integrity is verified* — the global checksum database (default `sum.golang.org`) that records the one true hash for each module version. Two different services with two different jobs: the proxy serves bytes; the sumdb attests to what those bytes should be.

**Follow-up.** *Can a compromised proxy feed you bad bytes?* — Not undetectably. The sumdb's independent hash catches tampered bytes. A bad proxy can deny service (availability), not corrupt content (integrity).

---

### Q4. What are the proxy's HTTP endpoints?

**Model answer.** For a module `M` and version `V`:
- `/<M>/@v/list` — newline list of tagged versions.
- `/<M>/@v/<V>.info` — JSON metadata (version, time).
- `/<M>/@v/<V>.mod` — the `go.mod` file.
- `/<M>/@v/<V>.zip` — the source zip.
- `/<M>/@latest` — metadata for the latest version.

All plain HTTP GETs. You can `curl` them by hand.

**Follow-up.** *What status code makes Go try the next proxy?* — 404 or 410 (not found).

---

### Q5. You see `checksum mismatch ... SECURITY ERROR`. What do you do?

**Model answer.** Do **not** delete `go.sum`. Investigate. The most common innocent cause is a corrupted module cache — fix with `go clean -modcache && go mod download`. Another is an upstream author who moved a Git tag (bad practice). Only after ruling those out should you suspect tampering. The error is a security feature working; silencing it removes the protection, not the problem.

**Common wrong answer.** "Delete `go.sum` and rebuild." (Dangerous — discards the integrity record.)

**Follow-up.** *Why does the error literally say SECURITY ERROR?* — Because a hash mismatch can indicate a supply-chain attack; Go wants you to treat it seriously.

---

## Middle

### Q6. Explain the comma vs pipe separators in `GOPROXY`.

**Model answer.** Both separate proxy entries, but with different fall-forward rules:
- **Comma (`,`)** — fall forward to the next entry **only on 404/410** (module genuinely not found). Any other error (500, timeout, TLS) aborts.
- **Pipe (`|`)** — fall forward on **any** error.

This matters for governance: a comma in front of a corporate mirror surfaces the mirror's outages (you find out it's broken); a pipe silently falls through to the next proxy, bypassing the mirror.

**Follow-up.** *Which would you use for an authoritative governance mirror?* — Comma, so failures surface rather than silently bypassing controls.

---

### Q7. What does the `h1:` hash actually hash?

**Model answer.** Not the raw zip bytes. It is `dirhash.Hash1`: SHA-256 of each file's contents → lines of `<hex>  <path>` → sorted → SHA-256 of that concatenation → base64, prefixed `h1:`. So it is a hash of a *sorted manifest of per-file content hashes*. The benefit: two zips with identical file contents but different compression/ordering produce the same hash. Integrity depends on content, not packaging.

**Common wrong answer.** "It's SHA-256 of the zip file." (No — that would vary by zip implementation.)

**Follow-up.** *Why two `go.sum` lines per version?* — One for the zip (full source), one for just `go.mod` (read early, during module-graph construction, before zips are fetched).

---

### Q8. How do you configure Go for private/internal modules?

**Model answer.** Set `GOPRIVATE` to a glob of the private paths:

```bash
go env -w GOPRIVATE='github.com/yourco/*,git.internal.example.com/*'
```

`GOPRIVATE` is a convenience that sets the defaults for `GONOPROXY` (fetch from VCS directly, skip the proxy) and `GONOSUMDB` (skip the public checksum database). Without it, Go would try the public proxy/sumdb for private code — which 404s and leaks internal paths. You also need VCS credentials (netrc, SSH, or `.gitconfig` URL rewrites).

**Follow-up.** *Does `GONOSUMDB` disable `go.sum`?* — No. It only skips the *global* checksum database. Your local `go.sum` is still enforced.

---

### Q9. What is `GONOSUMCHECK` and should you use it?

**Model answer.** A removed, deprecated variable from the early module rollout (~Go 1.13) that disabled all checksum verification. It no longer exists. Stale blog posts suggest it to "fix" checksum errors — ignore them. Use the precise modern variables: `GONOSUMDB`/`GOPRIVATE` to scope which paths skip the *checksum database*, or `GOSUMDB=off` for the blunt machine-wide switch. And usually the underlying checksum error is real and should be investigated, not silenced.

**Follow-up.** *Difference between `GONOSUMDB` and `GOSUMDB=off`?* — `GONOSUMDB` scopes by path (a glob); `GOSUMDB=off` disables the sumdb entirely for the whole machine.

---

### Q10. Walk me through the module cache layout.

**Model answer.** Under `$GOMODCACHE` (default `$GOPATH/pkg/mod`):
- `cache/download/<M>/@v/` — the raw proxy responses (`list`, `.info`, `.mod`, `.zip`, `.ziphash`). This subtree *is* the proxy protocol on disk.
- `cache/download/sumdb/` — cached sumdb tiles and tree heads.
- `<M>@<V>/` — the extracted, read-only source tree used by the compiler.

Because `cache/download/` mirrors the protocol, you can serve it as a proxy: `GOPROXY="file://$(go env GOMODCACHE)/cache/download"`.

**Follow-up.** *Why is the extracted tree read-only?* — So accidental edits are detected as corruption rather than silently building tampered code.

---

### Q11. How is a `go.sum` entry created the first time?

**Model answer.** On first fetch of a version with no existing entry:
1. Download the `.zip` and `.mod` from the proxy.
2. Compute the `h1:` hash of each.
3. If `GOSUMDB` is set and the module is not private, ask the checksum database for the official hash and verify the download matches.
4. Write the verified hashes into `go.sum`.

After that, `go.sum` is the local source of truth; the sumdb is not consulted again for that version. This is "trust on first use" (TOFU).

**Follow-up.** *What if the sumdb is unreachable?* — New entries can't be verified and `go get` for new versions fails; existing builds (already in `go.sum`) are unaffected.

---

### Q12. How do you make a build work offline?

**Model answer.** Two paths:
1. **Warm the cache first**, then forbid network: `go mod download` (connected), then `GOPROXY=off go build ./...`. Already-cached modules build; missing ones error loudly.
2. **Vendor** the dependencies: commit `vendor/` and build with `-mod=vendor`, `GOPROXY=off`, `GOSUMDB=off`.

`GOPROXY=off` is also the way to *prove* a build is hermetic — if it succeeds, no network was needed.

**Follow-up.** *Difference between `GOPROXY=off` and `GOPROXY=direct`?* — `off` forbids all downloads; `direct` skips the proxy but still fetches from the source VCS over the network.

---

## Senior

### Q13. Why is the checksum database tamper-evident?

**Model answer.** It is an append-only Merkle-tree transparency log. Every `(module, version) → hash` record is a leaf; the root hash commits to all records; the log publishes signed tree heads (STHs). Two proofs make it trustworthy: **inclusion proofs** verify a record is genuinely in the tree (a MITM can't fabricate a hash), and **consistency proofs** verify the tree only ever grew (history can't be rewritten). To feed you a different hash than the world gets, an attacker would need a forked tree with a different signed root — which the consistency checks expose. The log isn't *prevented* from lying; its lying is *detectable*. It's the same construction as Certificate Transparency.

**Follow-up.** *What's the CT analogy?* — CT logs every issued TLS cert so a rogue CA can't issue a fraudulent cert invisibly. The sumdb logs every module hash so a rogue proxy can't serve tampered bytes invisibly. Same principle: misbehavior leaves cryptographic evidence.

---

### Q14. What does the proxy + sumdb system *not* protect against?

**Model answer.** It guarantees you get the same bytes everyone else got — *integrity*, not *safety*. It does not protect against:
- A dependency that was malicious from the moment it was published (the sumdb faithfully records its hash; you faithfully build the backdoor).
- Typosquatting / dependency confusion (you selected the wrong package; it's served perfectly).
- A compromised author account pushing a malicious new version you then upgrade to.
- Build-time code execution outside the module system (`go generate`, cgo).

Integrity is the foundation; *vetting* dependencies — scanning, pinning, reviewing upgrades — is the safety layer on top, covered by supply-chain integrity practices.

**Follow-up.** *So why bother with the sumdb?* — It eliminates a whole class of attacks (post-publication tampering, split views) and makes builds reproducible. It's necessary but not sufficient.

---

### Q15. When would you run a private module proxy, and what are the options?

**Model answer.** Run one for caching/availability (decouple from `proxy.golang.org` and upstream VCS uptime), governance (allow/deny lists, approval gates), serving private modules uniformly, and bridging air-gaps. Options:
- **Athens** — open-source, Go-native, pluggable storage (disk, S3, GCS). The canonical self-hosted choice.
- **JFrog Artifactory / Sonatype Nexus** — commercial artifact managers with Go-modules repo types; fit existing enterprise governance.
- **`file://` + the module cache** — the simplest proxy: serve `cache/download/` over `file://` or static HTTP. Great for one-off air-gap transfers.

A mirror can also *proxy the sumdb* (under `/sumdb/`), keeping integrity verification working inside restricted networks.

**Follow-up.** *Single-URL `GOPROXY` vs `mirror,direct`?* — Single URL enforces that *all* fetches go through governance; adding `,direct` favors resilience but lets developers bypass the mirror for VCS-reachable modules.

---

### Q16. How do you run hermetic, air-gapped Go builds?

**Model answer.** Three strategies:
1. **Vendor** — commit `vendor/`, build with `-mod=vendor GOPROXY=off GOSUMDB=off`. Simplest per-repo.
2. **Pre-populated cache** — `go mod download all` on a connected machine, ship `$GOMODCACHE/cache/download` into the air-gap, serve it as a `file://` proxy. Because that tree *is* the proxy protocol, it just works. If the `sumdb/` tiles came along, verification still works; otherwise `GOSUMDB=off`.
3. **Edge mirror** — Athens/Artifactory in a DMZ serving the isolated network; can proxy the sumdb to preserve verification.

Pin the toolchain with `GOTOOLCHAIN=local` so Go doesn't try to fetch a newer toolchain mid-build. Prove hermeticity with `GOPROXY=off`.

**Follow-up.** *What's the explicit decision in an air-gap?* — Whether to proxy the sumdb (keep integrity) or `GOSUMDB=off` (rely on `go.sum` TOFU-against-cache). Document it; don't let it be accidental.

---

### Q17. Compare relying on the proxy + `go.sum` versus vendoring.

**Model answer.** Both give reproducible, integrity-checked builds; they draw the trust boundary differently.

| | Proxy + `go.sum` + sumdb | Vendoring |
|--|--------------------------|-----------|
| Build-time bytes | module cache (fetched) | `vendor/` in repo |
| Network at build | yes (cache miss) | no |
| Integrity | sumdb (first use) + `go.sum` | git history + `go.sum` |
| Repo size | small | large |
| Dep-bump diff | a few lines | thousands of lines |
| Best for | most teams w/ reliable proxy | air-gapped, regulated, audit |

A healthy private proxy plus committed `go.sum` covers most needs without vendoring's diff cost. Vendor when you need bytes-in-repo for audit/air-gap, or can't guarantee a proxy at build time. They can be combined (belt and braces).

**Follow-up.** *Does vendoring skip the sumdb?* — At build time, yes (bytes come from `vendor/`); but `go mod vendor` itself fetched and verified through the normal proxy/sumdb path.

---

### Q18. A private module fetch fails through the public proxy. Diagnose.

**Model answer.** The public proxy and sumdb can't see internal code, so a private path either 404s or fails sumdb verification — and worse, *leaks* the internal path to Google's logs. Likely causes and fixes:
1. **`GOPRIVATE` not set** → `go env -w GOPRIVATE='git.corp/*'` so the path skips the proxy and sumdb.
2. **Credentials missing** → `GOPRIVATE` makes Go fetch from VCS directly, but you still need auth: `~/.netrc` for HTTPS, SSH keys, or a `.gitconfig` `insteadOf` URL rewrite.
3. **`GOINSECURE` needed** for an internal host with a self-signed cert (scope it narrowly).

The privacy angle matters too: leaking an internal module path can reveal product names and unreleased features.

**Follow-up.** *Comma vs pipe interaction here?* — `GONOPROXY` (from `GOPRIVATE`) short-circuits the proxy list entirely for matching paths, so separators don't apply to private modules.

---

## Staff / Architect

### Q19. Design the module-fetch policy for a 200-engineer org.

**Model answer.** A uniform, documented set of settings applied in dev (`go env -w`), CI (env vars), and `CONTRIBUTING.md`.

```bash
GOPROXY=https://athens.corp.example.com,direct
GOPRIVATE=github.com/acme/*,git.acme.internal/*
GOSUMDB=sum.golang.org
GOFLAGS=-mod=readonly
```

Rationale:
- **Athens mirror first** — caches public modules, governs/audits dependencies, survives upstream outages; `,direct` lets private (GOPRIVATE-matched) modules reach VCS.
- **Comma** so a mirror outage surfaces rather than silently bypassing governance.
- **`GOPRIVATE`** scopes internal paths (proxy + sumdb exclusion) and prevents leakage.
- **Public sumdb on** for integrity of public modules.
- **`-mod=readonly`** surfaces `go.mod`/`go.sum` drift in review.

Operational layer: CI caches `$GOMODCACHE`; the mirror has HA/health checks; a dependency-approval workflow gates new modules; the mirror proxies the sumdb for restricted runners.

**Follow-up.** *How do you handle a CVE in a transitive dep across all repos?* — Scripted bulk PRs: bump in each `go.mod`, `go mod tidy`, verify; gate with `govulncheck` in CI.

---

### Q20. Explain the sumdb's relationship to Certificate Transparency in detail.

**Model answer.** Both solve "an authority could misbehave invisibly" with the same tool: a public, append-only Merkle transparency log.

- **CT:** CAs issue TLS certs. A compromised CA could mint a fraudulent cert for `yourbank.com`. CT requires every cert be logged; browsers demand an SCT (inclusion proof); auditors monitor logs. A rogue CA *can* issue a bad cert but can't do so without it appearing in a public log.
- **Sumdb:** authors publish module versions. A compromised proxy could serve tampered bytes. The sumdb logs every `(module, version, hash)`; `go` demands an inclusion proof and a consistency proof; the log can't present a split view without detection. A rogue proxy *can* deny service but can't serve undetectably-altered content.

Both share inclusion proofs (membership), consistency proofs (append-only), signed tree heads (commitments), and the philosophy: don't require the authority to be honest; require dishonesty to be detectable. The Go team built the sumdb explicitly on the CT model, reusing tile-based-log machinery (`x/mod/sumdb/tlog`).

**Follow-up.** *What's the equivalent of CT's "gossip"?* — Clients cache STHs and demand consistency proofs across them; the proxy that forwards sumdb traffic effectively spreads a common view, making equivocation detectable.

---

### Q21. How do you keep module-fetch metadata private?

**Model answer.** Every public-proxy/sumdb request reveals which module paths you fetch. For public modules that's usually fine; for private ones it leaks product/infra information. Controls:
1. **`GOPRIVATE`** for all internal paths — they never reach the public proxy or sumdb.
2. **A private proxy** that mirrors public modules, so *no* fetch metadata leaves your network (set `GOPROXY` to the mirror only).
3. **`GONOSUMDB=*`** if you want to never consult the public sumdb (you lose its protection for public modules — trade-off).
4. Treat the public services' logging policy as the default for anything not excluded; the policy explicitly logs module paths.

The architectural answer for a privacy-sensitive org: route *everything* through a self-hosted mirror, and never let a raw fetch hit `proxy.golang.org`.

**Follow-up.** *Does a 404 leak anything?* — Yes; even a failed lookup confirms the path was requested. `GOPRIVATE` prevents the request entirely.

---

### Q22. How would you implement a minimal Go module proxy?

**Model answer.** The protocol is plain HTTP GETs returning files: `list`, `.info`, `.mod`, `.zip`, `@latest`, with `!`-escaped uppercase. A minimal read-through proxy:
1. Map the request path to a local cache file.
2. If present, serve it.
3. If absent, fetch from upstream (`proxy.golang.org`), tee to cache atomically (temp file + rename), serve.

The protocol surface is trivial. The real work in production proxies (Athens, Artifactory) is storage backends, eviction, access control, sumdb proxying, concurrency, and `direct` resolution for uncached modules. Critically, a proxy *cannot* alter content undetectably — the `h1:` hash and sumdb catch tampering — so even a hand-rolled pass-through is safe for integrity; it can only affect availability.

You'd reuse `golang.org/x/mod/module` for escaping and `x/mod/sumdb/dirhash` for hashing rather than reimplementing.

**Follow-up.** *Why can't a malicious proxy corrupt a build?* — Any altered zip yields a different `h1:`, which fails both `go.sum` and the sumdb verification. The proxy is trusted for availability, not integrity.

---

## Quick-fire

| Q | Crisp answer |
|---|--------------|
| Default `GOPROXY`? | `https://proxy.golang.org,direct`. |
| Default `GOSUMDB`? | `sum.golang.org`. |
| Proxy endpoints? | `list`, `.info`, `.mod`, `.zip`, `@latest`. |
| Status that triggers fall-forward? | 404 / 410. |
| Comma vs pipe? | Comma forgives only 404/410; pipe forgives any error. |
| What does `h1:` hash? | A sorted manifest of per-file SHA-256s, not the raw zip. |
| `go.sum` lines per version? | Two — zip and `/go.mod`. |
| `GOPRIVATE` implies? | `GONOPROXY` + `GONOSUMDB`. |
| `GONOSUMCHECK`? | Removed; do not use. |
| sumdb data structure? | Append-only Merkle transparency log. |
| Sumdb analogy? | Certificate Transparency. |
| Self-hosted proxy? | Athens (also Artifactory, Nexus, `file://`). |

---

## Mock Interview Pacing

A 30-minute interview on the proxy and sumdb might cover:

- 0–5 min: warm-up — Q1, Q2, Q3.
- 5–15 min: middle topics — Q6, Q7, Q11, Q12.
- 15–25 min: a senior scenario — Q13, Q15, or Q17.
- 25–30 min: a curveball — Q19, Q20, or Q22.

If the candidate claims supply-chain experience, drive straight to Q13 (why the sumdb is tamper-evident) and Q14 (what it doesn't protect against) — both separate people who memorized facts from people who understand the model. For an infra/platform candidate, Q15 (private proxy) and Q16 (air-gapped builds) are field-test questions. A staff candidate should reach Q19 or Q20 within fifteen minutes and articulate the CT analogy unprompted.
