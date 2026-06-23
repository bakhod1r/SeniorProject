# Module Proxy & Checksum Database — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros-cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use / Feature](#product-use-feature)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases-pitfalls)
18. [Common Mistakes](#common-mistakes)
19. [Common Misconceptions](#common-misconceptions)
20. [Tricky Points](#tricky-points)
21. [Test](#test)
22. [Tricky Questions](#tricky-questions)
23. [Cheat Sheet](#cheat-sheet)
24. [Self-Assessment Checklist](#self-assessment-checklist)
25. [Summary](#summary)
26. [What You Can Build](#what-you-can-build)
27. [Further Reading](#further-reading)
28. [Related Topics](#related-topics)
29. [Diagrams & Visual Aids](#diagrams-visual-aids)

---

## Introduction
> Focus: "Where do my dependencies actually come from?" and "What is that `go.sum` file protecting me from?"

When you write `import "github.com/google/uuid"` and run `go build`, Go has to find that code somewhere and download it. You might assume it clones a Git repository directly from GitHub. By default, it does **not**. Instead, Go talks to a *module proxy* — a web server that speaks a tiny, well-defined HTTP protocol and hands back module source as `.zip` files.

The default proxy is run by Google at `proxy.golang.org`. It sits between you and the original source repositories. When you fetch a module, you almost always fetch it *from the proxy*, not from GitHub directly.

```bash
go env GOPROXY
# https://proxy.golang.org,direct
```

That one environment variable, `GOPROXY`, controls where modules come from. There is a second service too — the *checksum database* — that makes sure nobody can ever swap out a module's bytes after the fact. Its address lives in `GOSUMDB`:

```bash
go env GOSUMDB
# sum.golang.org
```

After reading this file you will:
- Understand what a module proxy is and why Go uses one by default
- Know what `GOPROXY` is and how to read its value
- Understand the `go.sum` file and what those `h1:` hashes mean
- Know what the checksum database is and what it protects against
- Read and interpret `go env` output for proxy and sumdb settings
- Recover from a `checksum mismatch` build error
- Know the basic env vars: `GOPROXY`, `GOSUMDB`, `GOPRIVATE`, `GONOSUMCHECK`

You do **not** need to understand the Merkle-tree internals of the transparency log yet, or how to run your own proxy. This file is about the moment you ask: "where did this code come from, and how do I know it wasn't tampered with?"

---

## Prerequisites

- **Required:** A working Go installation, version 1.16 or newer. The proxy and sumdb were introduced in 1.13 and became the default shortly after. Check with `go version`.
- **Required:** A Go module — a folder with a `go.mod` file. If you are not sure, see [01-go-mod-init/junior.md](../01-go-mod-init/junior.md).
- **Required:** Familiarity with `go get` and `go mod tidy` — the commands that actually trigger downloads. See [02-go-mod-tidy/junior.md](../02-go-mod-tidy/junior.md).
- **Required:** Comfort reading environment variables (`go env`, `echo $GOPROXY`).
- **Helpful:** Basic understanding of HTTP (URLs, GET requests, status codes) and what a cryptographic hash is (a fixed-length fingerprint of some bytes).
- **Helpful:** `curl` installed, so you can poke the proxy by hand and see the protocol with your own eyes.

If `go version` prints `go version go1.16` or higher, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Module proxy** | An HTTP server that serves Go module source code (zip files), `go.mod` files, and version lists, speaking the **GOPROXY protocol**. |
| **`GOPROXY`** | The environment variable listing one or more proxy URLs (comma- or pipe-separated), ending in `direct` or `off`. |
| **`proxy.golang.org`** | Google's public, free module proxy — the default first entry of `GOPROXY`. |
| **`direct`** | A special `GOPROXY` keyword meaning "fetch straight from the source repository (Git, etc.) instead of a proxy." |
| **`off`** | A special `GOPROXY` keyword meaning "do not download anything from the network." |
| **Module cache** | The on-disk store of downloaded modules, under `$GOPATH/pkg/mod` (or `$GOMODCACHE`). Read-only; shared across all your projects. |
| **`go.sum`** | A file in your module that records a cryptographic hash for every module version your build uses. Verifies integrity. |
| **`h1:` hash** | The hash format used in `go.sum`. The `h1:` prefix names the algorithm (SHA-256, base64-encoded). |
| **Checksum database (sumdb)** | A global, append-only, tamper-evident log of `(module, version) → hash` mappings. The default is `sum.golang.org`. |
| **`GOSUMDB`** | The environment variable naming the checksum database. Default `sum.golang.org`; can be `off`. |
| **`GOPRIVATE`** | A glob list of module path prefixes that are private — skip the proxy and the sumdb for them. |
| **TOFU** | "Trust On First Use" — the first time you fetch a module, you trust the bytes; from then on `go.sum` enforces they never change. |

---

## Core Concepts

### Where dependencies come from: the proxy

When Go needs `github.com/google/uuid@v1.6.0`, it does not (by default) run `git clone https://github.com/google/uuid`. Instead it makes a few small HTTP requests to the proxy named in `GOPROXY`:

1. "What versions of this module exist?" → `GET .../github.com/google/uuid/@v/list`
2. "Give me the metadata for v1.6.0." → `GET .../github.com/google/uuid/@v/v1.6.0.info`
3. "Give me the `go.mod` file for v1.6.0." → `GET .../github.com/google/uuid/@v/v1.6.0.mod`
4. "Give me the source zip for v1.6.0." → `GET .../github.com/google/uuid/@v/v1.6.0.zip`

The proxy returns plain HTTP responses. There is no Git involved on your side. The proxy already did the Git work — cloned the repo, picked the tag, packaged the source — and cached the result for everyone.

### Why a proxy at all?

Three reasons, all of which benefit you even as a beginner:

- **Speed.** The proxy caches modules close to you. Fetching a zip is faster than cloning a whole Git history.
- **Availability.** If a GitHub repo is deleted, renamed, or goes offline, the proxy may still have a cached copy. Your build keeps working.
- **Immutability.** Once the proxy serves `v1.6.0`, those bytes never change. A Git tag *can* be moved by a malicious or careless author; a proxy version cannot.

### The module cache

After Go downloads a module from the proxy, it stores it on disk so it never has to download it again. That store is the **module cache**:

```bash
go env GOMODCACHE
# /Users/you/go/pkg/mod
```

The cache is shared across *all* your projects. If two projects use `uuid@v1.6.0`, it is downloaded once and reused. The cache is read-only — you are not meant to edit files in it. You can wipe it with `go clean -modcache` if it ever gets corrupted, and Go will re-download on the next build.

### What `go.sum` is

Look inside any module that has dependencies and you will find a `go.sum` file:

```
github.com/google/uuid v1.6.0 h1:NIvaJDMOsjHA8n1jAhLSgzrAzy1Hgr+hNrb57e+94F0=
github.com/google/uuid v1.6.0/go.mod h1:TIyPZe4MgqvfeYDBFedMoGGpEw/LqOeaOT+nhxU+yHo=
```

Each line records a **cryptographic hash** of some downloaded bytes. The first line hashes the module's *source zip*; the second hashes its *`go.mod` file*. Both are pinned to the exact version `v1.6.0`.

The point: every time Go reads a module out of the cache to build with, it re-hashes the bytes and checks them against `go.sum`. If they do not match — because the cache got corrupted, or somebody swapped the bytes — the build **fails loudly**. You are protected from silently building against tampered code.

### What the checksum database is

`go.sum` protects you against changes *after* the first download. But what about the *first* download? How do you know the bytes you got the very first time are the same bytes everyone else got?

That is the job of the **checksum database** (`sum.golang.org`). It is a global, public, append-only log. When Go downloads a module version for the first time, it asks the sumdb: "what is the official hash for `github.com/google/uuid@v1.6.0`?" The sumdb answers, Go compares that answer to the bytes it just downloaded, and only if they match does it write the hash into your `go.sum`.

The crucial property: the sumdb is **append-only and tamper-evident**. Once a `(module, version, hash)` entry is published, it can never be changed or deleted without everyone noticing. So if a malicious proxy tries to serve you different bytes than everyone else got, the sumdb hash will not match and your build will fail.

### How `go.sum` is built (the normal flow)

You almost never edit `go.sum` by hand. It is populated automatically:

```bash
go get github.com/google/uuid@v1.6.0
```

Behind that single command:
1. Go fetches the module from the proxy.
2. Go asks `sum.golang.org` for the official hash.
3. Go verifies the downloaded bytes against the sumdb hash.
4. Go writes the verified hash into `go.sum`.

From then on, the hash in `go.sum` is the source of truth. Future builds compare against it without needing the sumdb again.

### The three keywords you will see

In `go env` output, three special words appear:

- `direct` — at the end of `GOPROXY`, means "if the proxies before me don't have it, fetch directly from the source repo."
- `off` — means "do not download anything; fail if a module is missing."
- A real URL like `https://proxy.golang.org` — an actual proxy server.

A typical default:

```
GOPROXY=https://proxy.golang.org,direct
```

Read that as: "try the public proxy first; if it can't serve a module, fall back to fetching directly from the source repo."

---

## Real-World Analogies

**1. The app store vs. installing from the developer's website.** When you install an app, you usually go through an app store (the proxy) rather than downloading a raw installer from a random website (direct). The store caches the app, scans it, and serves it fast. The proxy is the app store for Go modules.

**2. A notary public.** When you sign an important document, a notary stamps it and keeps a record. Later, nobody can claim the document said something different — the notary's logbook proves what was signed. The checksum database is the notary: it keeps a permanent, public record of "module X version Y had exactly these bytes."

**3. A tamper-evident seal on a medicine bottle.** You trust the seal the first time you open the bottle (trust on first use). After that, if the seal is broken, you know something is wrong. `go.sum` is the seal: once recorded, any change to the contents breaks it and you find out immediately.

**4. A library's central catalog.** Instead of every reader hunting down the original publisher of every book, the library keeps a catalog and a shelf of copies. The proxy is that shelf; the catalog (with ISBNs that never change) is the checksum database.

---

## Mental Models

### Model 1 — The proxy is a cache in front of the world's Git repos

You ask the proxy for a module. The proxy either has it cached or goes and fetches it from the real source for you, caches it, and hands it back. You rarely talk to GitHub directly.

### Model 2 — `go.sum` is a list of fingerprints, not the code

`go.sum` does not contain any source code. It contains *fingerprints* (hashes) of code. The code lives in the module cache and in the proxy; `go.sum` just lets you verify that the code matches what was approved.

### Model 3 — Two layers of integrity

```
[checksum database]  ← protects the FIRST download (is this the same bytes everyone got?)
        │
        ▼
[go.sum in your repo] ← protects EVERY later download (did the bytes change since?)
```

The sumdb is the global, one-time check. `go.sum` is your local, forever check.

### Model 4 — TOFU: trust on first use

The first time you encounter a module version, you have to trust *something*. Go's answer: trust the global checksum database, record the hash in `go.sum`, and never trust blindly again. After the first use, the recorded hash is law.

### Model 5 — Resolution order, left to right

```
GOPROXY = https://corp-proxy.example.com,https://proxy.golang.org,direct
              │                              │                       │
              try this first ───────────────┘                       │
              if it 404s, try the next one ─────────────────────────┘
              if that fails too, go straight to the source repo
```

Go walks the `GOPROXY` list left to right, falling forward on "not found" responses.

---

## Pros & Cons

### Pros of the proxy + sumdb system

- **Fast, cached downloads.** No full Git clones; just zip fetches from a nearby cache.
- **Resilient to upstream disappearance.** Deleted or renamed repos often still build via the proxy's cache.
- **Strong integrity guarantees.** `go.sum` plus the sumdb make tampering detectable.
- **Reproducible builds.** The same `go.sum` produces the same dependency bytes, forever.
- **Zero configuration for most people.** The defaults just work; you may never touch `GOPROXY`.

### Cons / costs

- **Privacy.** By default, the proxy and sumdb learn which modules you fetch. (For *public* modules; private ones are excluded via `GOPRIVATE`.)
- **A third party in your supply chain.** You trust Google's proxy and sumdb unless you opt out.
- **Private modules need extra setup.** Internal company code must be excluded with `GOPRIVATE`, or fetches will fail or leak.
- **A new failure mode.** `checksum mismatch` errors confuse beginners until they understand what `go.sum` is doing.
- **Network dependency on first fetch.** The very first download of a version needs network access (to the proxy and sumdb), unless you have a cache or vendored copy.

For the vast majority of beginners, the defaults are the right choice and the costs are invisible.

---

## Use Cases

You interact with the proxy and sumdb whenever you:

- **Add a new dependency** with `go get` — triggers a proxy fetch and a sumdb lookup.
- **Run `go mod tidy`** — fills in missing modules and `go.sum` entries.
- **Build on a fresh machine** — downloads everything `go.mod` requires through the proxy.
- **Set up CI** — the CI runner fetches through the proxy just like your laptop does.
- **Work behind a corporate firewall** — you may need to point `GOPROXY` at an internal mirror.
- **Use private repositories** — you must set `GOPRIVATE` so Go skips the public proxy and sumdb for those.

You will need to *configure* `GOPROXY`/`GOSUMDB` when:

- Your company runs its own module proxy and wants all fetches to go through it.
- You work with private/internal modules that the public proxy cannot see.
- You build in an air-gapped environment with no internet at all (advanced).
- Your network blocks `proxy.golang.org` and you need an alternative.

---

## Code Examples

### Example 1 — Inspecting your current configuration

```bash
go env GOPROXY
# https://proxy.golang.org,direct

go env GOSUMDB
# sum.golang.org

go env GOMODCACHE
# /Users/you/go/pkg/mod

go env GOPRIVATE
# (empty by default)
```

These four values tell you everything about where your modules come from and how they are verified.

### Example 2 — Watching a fetch happen

Start a fresh module and add a dependency with verbose output:

```bash
mkdir proxydemo && cd proxydemo
go mod init example.com/proxydemo
GOPROXY=https://proxy.golang.org,direct go get -x github.com/google/uuid@v1.6.0
```

The `-x` flag prints the commands Go runs. You will see it download from the proxy and verify against the sumdb, then write `go.sum`.

### Example 3 — Reading `go.sum`

After Example 2:

```bash
cat go.sum
```

Output:

```
github.com/google/uuid v1.6.0 h1:NIvaJDMOsjHA8n1jAhLSgzrAzy1Hgr+hNrb57e+94F0=
github.com/google/uuid v1.6.0/go.mod h1:TIyPZe4MgqvfeYDBFedMoGGpEw/LqOeaOT+nhxU+yHo=
```

Decoding it:
- `github.com/google/uuid v1.6.0 h1:...` — the SHA-256 hash of the module's *source zip*, base64-encoded, with the `h1:` algorithm prefix.
- `github.com/google/uuid v1.6.0/go.mod h1:...` — the hash of just the `go.mod` file for that version.

Two lines per module version: one for the zip, one for the `go.mod`.

### Example 4 — Poking the proxy with `curl`

You can speak the protocol by hand. The proxy is just HTTP:

```bash
# List all known versions
curl https://proxy.golang.org/github.com/google/uuid/@v/list

# Get metadata for a specific version (JSON)
curl https://proxy.golang.org/github.com/google/uuid/@v/v1.6.0.info
# {"Version":"v1.6.0","Time":"2024-01-12T20:25:00Z"}

# Get the go.mod for that version
curl https://proxy.golang.org/github.com/google/uuid/@v/v1.6.0.mod

# Get info about the latest version
curl https://proxy.golang.org/github.com/google/uuid/@latest
```

That is the entire surface a beginner needs to know: `/@v/list`, `.info`, `.mod`, `.zip`, and `/@latest`.

### Example 5 — Downloading the zip (and seeing its size)

```bash
curl -sO https://proxy.golang.org/github.com/google/uuid/@v/v1.6.0.zip
ls -lh v1.6.0.zip
# the actual module source, as a zip
```

This is exactly the bytes Go downloads and hashes. The `h1:` line in `go.sum` is the fingerprint of (the canonical form of) this file.

### Example 6 — Forcing direct mode (bypass the proxy)

```bash
GOPROXY=direct go get github.com/google/uuid@v1.6.0
```

With `GOPROXY=direct`, Go skips the proxy entirely and clones from the source repository (GitHub) itself. Slower, but sometimes necessary for testing or for repos the proxy cannot reach.

### Example 7 — Turning the network off

```bash
GOPROXY=off go build ./...
```

`GOPROXY=off` forbids any download. If everything you need is already in the cache, the build succeeds. If anything is missing, you get a clear error instead of a network call. This is how offline builds are forced.

---

## Coding Patterns

### Pattern: let the defaults work

For most beginner and even intermediate work, do nothing. The default `GOPROXY=https://proxy.golang.org,direct` and `GOSUMDB=sum.golang.org` are correct. Do not change them without a reason.

### Pattern: always commit `go.sum`

`go.sum` is part of your project. Commit it alongside `go.mod`:

```bash
git add go.mod go.sum
git commit -m "add uuid dependency"
```

Without `go.sum`, anyone who clones your repo loses the integrity guarantee and Go will re-fetch and re-verify from scratch.

### Pattern: configure `GOPRIVATE` for company code

If you import private modules (e.g. `github.com/mycompany/internal-lib`), tell Go they are private so it does not try the public proxy or sumdb:

```bash
go env -w GOPRIVATE='github.com/mycompany/*'
```

This single setting makes Go skip both the public proxy *and* the public checksum database for matching paths.

### Pattern: warm the cache before going offline

If you know you will lose network (a flight, an air-gapped build), pre-download:

```bash
go mod download
```

This populates the module cache with everything `go.mod` requires, so a later `GOPROXY=off go build` succeeds.

---

## Clean Code

- **Commit `go.sum`** in the same commit as the `go.mod` change that caused it. They are a pair.
- **Never hand-edit `go.sum`.** It is machine-generated. If it is wrong, regenerate with `go mod tidy` or `go mod download`.
- **Set `GOPRIVATE` once, globally**, with `go env -w`, rather than exporting it ad-hoc in every shell. That way it persists.
- **Do not disable the sumdb (`GOSUMDB=off`) to "fix" an error** unless you fully understand what you are giving up. The error is usually telling you something real.
- **Keep `GOPROXY` simple.** A single corporate proxy plus `direct`, or just the default. Long fragile chains are hard to debug.

---

## Product Use / Feature

The proxy and sumdb affect real products in concrete ways:

- **CI reliability.** A flaky GitHub or a renamed repo no longer breaks your pipeline if the proxy has the version cached.
- **Onboarding speed.** A new engineer clones the repo and `go build` just works — modules come from the proxy, integrity is checked automatically.
- **Security posture.** The sumdb makes a whole class of supply-chain attacks (silently swapping a dependency's bytes) detectable.
- **Compliance.** Some companies route all fetches through an internal proxy so they can audit and approve every external dependency.
- **Reproducibility.** A committed `go.sum` means a build from a year ago fetches byte-identical dependencies today.

For most teams the default proxy and sumdb are a free, invisible upgrade to build speed and security.

---

## Error Handling

The errors you will actually meet as a beginner:

### `checksum mismatch`

```
verifying github.com/foo/bar@v1.2.3: checksum mismatch
	downloaded: h1:AAAA...
	go.sum:     h1:BBBB...
SECURITY ERROR
```

The bytes Go downloaded do not match the hash recorded in `go.sum`. Possible causes:
- The module cache got corrupted. Fix: `go clean -modcache` then rebuild.
- A dependency author force-pushed and changed a tag's contents (bad practice). Fix: investigate; do **not** blindly delete `go.sum`.
- Someone tampered with the download. Take it seriously — this is the security check working.

This is the most important error in this topic. The safe first move is `go clean -modcache && go mod download`. If it persists, investigate before overriding.

### `missing go.sum entry`

```
missing go.sum entry for module providing package github.com/foo/bar
	run 'go mod download github.com/foo/bar' or 'go mod tidy' to add it
```

You imported a package but `go.sum` has no hash for it. Fix:

```bash
go mod tidy
```

### `module ... reading https://proxy.golang.org/...: 404 Not Found`

The proxy does not have the module or version you asked for. Causes:
- A typo in the import path or version.
- A private module the public proxy can't see (you need `GOPRIVATE`).
- A version that was never published.

Fix the path/version, or set `GOPRIVATE` for private code.

### `verifying ...: ... 410 Gone` for a private module

You tried to fetch a private/internal module through the public proxy or sumdb. Fix:

```bash
go env -w GOPRIVATE='your.private.host/*'
```

### Network errors / timeouts

If `proxy.golang.org` is unreachable (firewall, outage, offline), fetches fail. Fix: use a reachable proxy, warm the cache in advance, or set `GOPROXY=off` if everything is already cached.

---

## Security Considerations

- **The sumdb defends against tampering, not against bad code.** It guarantees you get the *same* bytes everyone else got — not that those bytes are *safe*. A malicious-but-popular library will still have a valid checksum.
- **`go.sum` is a security file. Treat it as one.** A `checksum mismatch` is a `SECURITY ERROR` by design. Do not "fix" it by deleting `go.sum`.
- **Never set `GONOSUMCHECK` or `GOSUMDB=off` casually.** These disable verification. Doing so removes a key supply-chain protection.
- **Use `GOPRIVATE` for internal code** so private module paths never leak to the public proxy or sumdb. Leaking an internal module path can reveal product names, infrastructure, or unreleased features.
- **Commit `go.sum`.** A repo without `go.sum` gives every cloner a fresh trust-on-first-use moment, which is weaker than verifying against a pinned hash.
- **Be suspicious of instructions that disable verification.** A common attack vector is a README or script that tells you to turn off the sumdb to "make the build work."

The deeper supply-chain story is covered in [07-supply-chain-integrity](../07-supply-chain-integrity/) — this topic is the integrity foundation it builds on.

---

## Performance Tips

- **The cache makes the second build fast.** The first fetch hits the network; after that, modules come from `$GOMODCACHE` instantly.
- **`go mod download` warms the cache** before a build, useful in CI to separate "download time" from "compile time."
- **A nearby proxy is faster than `direct`.** Cloning full Git histories (direct mode) is slower than fetching a cached zip from the proxy.
- **CI should cache `$GOMODCACHE`** between runs so it does not re-download every job. Most CI systems have a built-in Go cache step.
- **Do not wipe the module cache habitually.** `go clean -modcache` forces a full re-download next time. Reserve it for corruption.

---

## Best Practices

1. **Leave `GOPROXY` and `GOSUMDB` at their defaults** unless you have a concrete reason to change them.
2. **Always commit `go.sum`** alongside `go.mod`.
3. **Set `GOPRIVATE` for all internal module paths**, globally, with `go env -w`.
4. **Never delete `go.sum` to fix a checksum error.** Investigate first.
5. **Warm the cache (`go mod download`) before offline or air-gapped work.**
6. **Cache `$GOMODCACHE` in CI** to speed up repeated builds.
7. **Understand a `checksum mismatch` before overriding it** — it is a security signal.
8. **Use `curl` to inspect the proxy** when debugging "where did this come from?" questions; the protocol is simple and readable.

---

## Edge Cases & Pitfalls

### Pitfall 1 — Deleting `go.sum` to silence an error

The most dangerous beginner reflex. A `checksum mismatch` is telling you bytes changed. Deleting `go.sum` removes the alarm, not the problem. Investigate instead.

### Pitfall 2 — Private modules without `GOPRIVATE`

You import `github.com/yourco/secret-lib`, run `go get`, and it fails trying to reach the public proxy or sumdb (which can't see private code). Fix: set `GOPRIVATE='github.com/yourco/*'`.

### Pitfall 3 — Forgetting to commit `go.sum`

You commit `go.mod` but not `go.sum`. A teammate clones, and their build re-fetches and re-verifies from scratch — weaker, and a source of "works on my machine" confusion. Always commit both.

### Pitfall 4 — Confusing `GOPROXY=off` with `GOPROXY=direct`

`off` means "no network at all; fail if missing." `direct` means "skip the proxy but still hit the source repo over the network." They are opposites in network behaviour.

### Pitfall 5 — Assuming the proxy clones from GitHub for you in real time

The proxy serves *cached, immutable* versions. If a brand-new tag was pushed seconds ago, the proxy may not have it yet. Usually it catches up within minutes.

### Pitfall 6 — Expecting `go.sum` to contain source code

It does not. It contains hashes only. The source lives in the cache and on the proxy.

### Pitfall 7 — A 404 from the proxy that is actually a typo

`module github.com/google/uudi/@v/list: 404` — read carefully; that is a misspelling of `uuid`. The proxy returns 404 for anything it cannot resolve, including typos.

### Pitfall 8 — Disabling the sumdb globally and forgetting

`GOSUMDB=off` removes a security check for *all* projects on your machine until you re-enable it. If you must disable it, do so narrowly and remember to revert.

---

## Common Mistakes

- **Deleting `go.sum` when you see a checksum error.** Almost always wrong. Investigate first.
- **Not setting `GOPRIVATE` for company code.** Causes fetch failures and can leak internal paths.
- **Setting `GONOSUMCHECK` or `GOSUMDB=off`** to make a build "work" without understanding the consequences.
- **Editing files inside the module cache.** It is read-only by design; edits will be detected as corruption.
- **Forgetting to commit `go.sum`.** Leaves teammates without integrity verification.
- **Confusing the proxy (`GOPROXY`) with the sumdb (`GOSUMDB`).** They are two different services with two different jobs.
- **Assuming `direct` means "no network."** It still uses the network — just the source repo instead of the proxy.
- **Wiping the module cache to "fix" unrelated problems.** Slows the next build down for no benefit.

---

## Common Misconceptions

> *"Go clones my dependencies straight from GitHub."*

No. By default Go fetches from the proxy (`proxy.golang.org`). It only clones directly when you use `direct` mode or for modules matching `GOPRIVATE`.

> *"`go.sum` stores my dependencies' code."*

No. `go.sum` stores cryptographic *hashes* of code, not the code itself. The code is in the module cache.

> *"The checksum database checks that my dependencies are safe."*

No. It checks that the bytes you got match the bytes everyone else got. It says nothing about whether the code is malicious or buggy.

> *"`GOPROXY=off` and `GOPROXY=direct` are the same."*

No. `off` blocks all downloads. `direct` skips the proxy but still downloads from the source repo over the network.

> *"I should disable the sumdb if I get a checksum error."*

No. That removes a security protection. The error almost always indicates a real problem (corruption, a moved tag, tampering). Investigate.

> *"The proxy can change a module's bytes after publishing."*

No. Proxy versions are immutable. Once `v1.6.0` is served, those bytes are fixed — and the sumdb guarantees it.

---

## Tricky Points

- **There are two `go.sum` lines per module version**: one for the `.zip` and one for the `/go.mod`. Both must verify.
- **The sumdb is consulted only on the *first* fetch** of a version (or when adding a `go.sum` entry). After that, `go.sum` is the local source of truth.
- **`GOPRIVATE` is a convenience that sets two other things**: it implies `GONOSUMDB` (skip the sumdb) and `GONOPROXY` (skip the proxy) for matching paths. You usually only need to set `GOPRIVATE`.
- **The proxy protocol is plain HTTP.** You can read it with `curl`. There is no special client needed.
- **`@latest` is its own endpoint**, separate from `/@v/list`. It returns the version Go would pick as "latest."
- **`off` fails the build if anything is missing; `direct` is a fallback, not a blocker.**
- **The `h1:` prefix is part of the format**, naming the hashing scheme. There is room for future `h2:` etc., but `h1:` is what you will see.

---

## Test

Try this in a scratch folder.

```bash
mkdir sumtest && cd sumtest
go mod init example.com/sumtest
cat > main.go <<'EOF'
package main

import (
    "fmt"
    "github.com/google/uuid"
)

func main() {
    fmt.Println(uuid.New())
}
EOF
go mod tidy
cat go.sum
go env GOPROXY GOSUMDB
```

Expected: `go.sum` contains two lines for `github.com/google/uuid` (a zip hash and a `/go.mod` hash), and the env values show the public proxy and sumdb.

Now answer:
1. How many `go.sum` lines exist per module version, and what does each hash? (Answer: two — the `.zip` and the `/go.mod`.)
2. What does `GOPROXY=off go build` do if the module is already cached vs. not cached? (Answer: builds if cached; errors if not.)
3. What URL would you `curl` to list all versions of `github.com/google/uuid`? (Answer: `https://proxy.golang.org/github.com/google/uuid/@v/list`.)
4. What does `GOPRIVATE` do for a matching module path? (Answer: skips both the public proxy and the sumdb.)

---

## Tricky Questions

**Q1.** I see `checksum mismatch`. Is my computer hacked?

A. Not necessarily, but treat it seriously. The most common innocent cause is a corrupted module cache (`go clean -modcache` then rebuild). Another is an upstream author who moved a Git tag (bad practice). Only after ruling those out should you suspect tampering — but do not silence the error by deleting `go.sum`.

**Q2.** Why does Go use a proxy instead of cloning from GitHub directly?

A. Speed (cached zips beat full clones), availability (cached copies survive deleted repos), and immutability (proxy versions never change, unlike Git tags). The proxy did the Git work once, for everyone.

**Q3.** What is the difference between `GOPROXY` and `GOSUMDB`?

A. `GOPROXY` is *where code comes from* (the download server). `GOSUMDB` is *how integrity is verified* (the global checksum log). Different services, different jobs.

**Q4.** If I delete my module cache, will my build still work?

A. Yes, if you have network access — Go re-downloads from the proxy and re-verifies against `go.sum`. Offline, it fails unless you have a vendored copy.

**Q5.** Do I need internet to build a project I already built once?

A. No, if the modules are still in your cache. The first build downloads; later builds read from the cache. `GOPROXY=off` lets you prove this.

**Q6.** What does `direct` at the end of `GOPROXY` mean?

A. "If the proxies listed before me cannot serve a module, fetch it directly from its source repository (e.g. clone the Git repo)." It is a fallback, not a network switch-off.

**Q7.** Can two `go.sum` files for the same module ever differ between two repos?

A. They should not, for the same versions — the hashes are deterministic and verified against the global sumdb. If they differ, somebody got different bytes, which is exactly what `go.sum` exists to catch.

**Q8.** What happens to my build if `proxy.golang.org` goes down?

A. New fetches fail until it returns or you switch to another proxy/`direct`. Already-cached modules build fine. This is one reason teams run internal proxy mirrors or vendor.

**Q9.** Is `go.sum` the same as `go.mod`?

A. No. `go.mod` *declares* which versions you want. `go.sum` *proves* the bytes of those versions. You commit both.

**Q10.** How do I make Go skip the proxy and sumdb for my company's private repos?

A. Set `GOPRIVATE` to a glob of your private paths, e.g. `go env -w GOPRIVATE='github.com/yourco/*'`. That one setting covers both.

---

## Cheat Sheet

```bash
# Inspect configuration
go env GOPROXY GOSUMDB GOPRIVATE GOMODCACHE

# The default values
# GOPROXY=https://proxy.golang.org,direct
# GOSUMDB=sum.golang.org

# Fetch through the proxy (the default)
go get github.com/google/uuid@v1.6.0

# Skip the proxy, clone directly from the source repo
GOPROXY=direct go get github.com/google/uuid@v1.6.0

# Forbid all downloads (offline build; must be cached)
GOPROXY=off go build ./...

# Mark private module paths (skips proxy + sumdb for them)
go env -w GOPRIVATE='github.com/yourco/*'

# Warm the cache before going offline
go mod download

# Recover from a corrupted cache
go clean -modcache && go mod download

# Speak the proxy protocol by hand
curl https://proxy.golang.org/github.com/google/uuid/@v/list
curl https://proxy.golang.org/github.com/google/uuid/@v/v1.6.0.info
curl https://proxy.golang.org/github.com/google/uuid/@v/v1.6.0.mod
curl -O https://proxy.golang.org/github.com/google/uuid/@v/v1.6.0.zip
curl https://proxy.golang.org/github.com/google/uuid/@latest
```

```
go.sum line anatomy:

    github.com/google/uuid v1.6.0 h1:NIvaJ...=        ← hash of the source ZIP
    github.com/google/uuid v1.6.0/go.mod h1:TIyP...=  ← hash of just the go.mod
    └── module path ──────┘ └ver┘ └suffix┘ └─ h1: hash ─┘
```

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| `checksum mismatch` | Corrupted cache or moved tag | `go clean -modcache && go mod download`; investigate if it persists |
| `missing go.sum entry` | Imported a package without a hash | `go mod tidy` |
| `404 Not Found` from proxy | Typo or private module | Fix path; set `GOPRIVATE` for private code |
| `410 Gone` on private module | Public proxy/sumdb can't see it | `go env -w GOPRIVATE='host/*'` |
| Fetch hangs/times out | Proxy unreachable | Use a reachable proxy, cache, or `GOPROXY=off` |

---

## Self-Assessment Checklist

You can move on to [middle.md](middle.md) when you can:

- [ ] Explain in one sentence what a module proxy is
- [ ] Read your `GOPROXY`, `GOSUMDB`, and `GOMODCACHE` values and say what each means
- [ ] Name the four proxy endpoints: `/@v/list`, `.info`, `.mod`, `.zip` (plus `/@latest`)
- [ ] Read a `go.sum` line and say what each part hashes
- [ ] Explain the difference between `GOPROXY` and `GOSUMDB`
- [ ] Explain what the checksum database protects against (and what it does *not*)
- [ ] Recover safely from a `checksum mismatch` error
- [ ] Explain TOFU (trust on first use)
- [ ] Set `GOPRIVATE` for an internal module path
- [ ] Distinguish `GOPROXY=off` from `GOPROXY=direct`
- [ ] Fetch a module's version list with `curl`

---

## Summary

When Go needs a dependency, it fetches it from a **module proxy** — a simple HTTP server (default `proxy.golang.org`) that serves module versions as immutable zip files. The proxy is faster than cloning Git, survives deleted repos, and guarantees version bytes never change. Where it fetches from is controlled by `GOPROXY`, a left-to-right list ending in `direct` (fall back to the source repo) or `off` (no network).

Downloaded modules land in the shared **module cache** (`$GOMODCACHE`). Their integrity is protected by two layers: the **checksum database** (`sum.golang.org`, configured via `GOSUMDB`) verifies the *first* download against a global, tamper-evident log, and the **`go.sum` file** in your repo verifies *every* later download against pinned `h1:` hashes. This is trust-on-first-use: trust the global log once, then enforce the recorded hash forever.

Leave the defaults alone unless you have a reason. Commit `go.sum`. Set `GOPRIVATE` for company code. And when you see `checksum mismatch`, investigate before you override — it is a security feature doing its job.

---

## What You Can Build

After learning this:

- **A project that builds offline** after one cache-warming `go mod download`.
- **A correctly-configured workspace for private modules** using `GOPRIVATE`.
- **A small script that lists a module's versions** by `curl`-ing the proxy.
- **A reproducible CI pipeline** that caches `$GOMODCACHE` and verifies `go.sum`.
- **A clear mental model** of where every byte of your dependency tree came from and how its integrity is checked.

You cannot yet:
- Run your own private module proxy (next: middle.md and senior.md)
- Understand the Merkle-tree internals of the transparency log (professional.md)
- Build a fully air-gapped enterprise mirror with Athens or Artifactory (senior.md)
- Reason about the full supply-chain threat model (see [07-supply-chain-integrity](../07-supply-chain-integrity/))

---

## Further Reading

- [Go Modules Reference — Module proxy](https://go.dev/ref/mod#module-proxy) — the authoritative protocol spec.
- [Go Modules Reference — Checksum database](https://go.dev/ref/mod#checksum-database) — how the sumdb works.
- [Go Modules Reference — Environment variables](https://go.dev/ref/mod#environment-variables) — `GOPROXY`, `GOSUMDB`, `GOPRIVATE`, and friends.
- [proxy.golang.org documentation](https://proxy.golang.org/) — the public proxy's own page.
- ["Go Module Mirror, Index, and Checksum Database"](https://go.dev/blog/module-mirror-launch) — the launch blog post explaining the design.

---

## Related Topics

- [6.1.1 `go mod init`](../01-go-mod-init/junior.md) — start a module
- [6.1.2 `go mod tidy`](../02-go-mod-tidy/junior.md) — populates `go.mod` and `go.sum`
- [6.1.3 `go mod vendor`](../03-go-mod-vendor/junior.md) — copy deps into the repo (an alternative to relying on the proxy at build time)
- 6.1.7 Supply-Chain Integrity — the broader threat model this topic underpins
- [6.2.1 Package Import Rules](../../02-packages/01-package-import-rules/junior.md) — how imports resolve to modules

---

## Diagrams & Visual Aids

```
How a fetch flows:

    go get github.com/google/uuid@v1.6.0
                  │
                  ▼
       Read GOPROXY (left to right)
                  │
                  ▼
       GET proxy.golang.org/.../@v/v1.6.0.info   ← metadata
       GET proxy.golang.org/.../@v/v1.6.0.mod    ← go.mod
       GET proxy.golang.org/.../@v/v1.6.0.zip    ← source
                  │
                  ▼
       Ask GOSUMDB (sum.golang.org) for the official hash
                  │
                  ▼
       Verify downloaded bytes == sumdb hash
                  │
              match? ── no ──> SECURITY ERROR (build fails)
                  │
                 yes
                  │
                  ▼
       Write hash into go.sum  +  store in module cache
```

```
The two layers of integrity:

    FIRST download of a version:
        checksum database (sum.golang.org)
        "is this the same bytes everyone got?"  ← global, one-time

    EVERY later use:
        go.sum in your repo
        "did the bytes change since we recorded them?"  ← local, forever
```

```
GOPROXY resolution (left to right, fall forward on 404):

    GOPROXY = https://corp,https://proxy.golang.org,direct
                  │              │                    │
        try corp ─┘              │                    │
        404? try public ─────────┘                    │
        404? clone the source repo directly ──────────┘
        off anywhere = stop, fail if missing
```

```
The proxy protocol endpoints (all plain HTTP GET):

    /<module>/@v/list              → newline list of versions
    /<module>/@v/<version>.info    → JSON {Version, Time}
    /<module>/@v/<version>.mod     → the go.mod file
    /<module>/@v/<version>.zip     → the source zip
    /<module>/@latest              → JSON for the latest version
```

```
Where things live:

    proxy.golang.org      ← serves module zips (the download source)
    sum.golang.org        ← the checksum log (the integrity oracle)
    $GOMODCACHE           ← your on-disk cache of downloaded modules
    go.mod                ← declares which versions you want
    go.sum                ← pins the hash of every version you use
```
