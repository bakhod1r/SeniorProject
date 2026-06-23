# Publishing Modules — Junior Level

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
> Focus: "I have a Go module on my laptop. How do I let the world `go get` it?"

You have built a Go module. It compiles. It has a `go.mod`. It might even have tests. So far, only you can use it. The next step — the step that turns your private folder of code into a thing people on the internet can `import` — is **publishing**.

Publishing a Go module is surprisingly simple, and it does not involve a registry, a CLI tool, or an account on a package website. It is just three things:

1. Push your module to a public Git repository.
2. Tag a commit with a version number that begins with `v` (for example `v0.1.0`).
3. Wait for someone — anyone, including you — to run `go get` for that path.

That is it. There is no `go publish` command. There is no upload step. The Go module proxy will discover your module the first time anyone asks for it, fetch it from your Git host, cache it forever, and make it available to the rest of the world.

After reading this file you will:
- Understand what "publishing" means in the Go ecosystem
- Know how Git tags become module versions
- Be able to publish your first module under `v0.1.0`
- Know how to bump to `v1.0.0` (the stability promise)
- Understand the major-version-bump rule (`/v2`, `/v3`, ...)
- Know how to retract a bad release
- Recognise the role of `pkg.go.dev`, `proxy.golang.org`, and `sum.golang.org`

You do **not** need to know about private proxies, GOPRIVATE, GitHub Actions release workflows, or signed releases yet. Those come later. This file is about the moment you push a tag and your module enters the global Go ecosystem.

---

## Prerequisites

- **Required:** A Go installation (1.16 or newer). Check with `go version`.
- **Required:** A Go module that compiles locally — you have already run `go mod init` and the code builds.
- **Required:** A public account on a Git host that Go's proxy understands: GitHub, GitLab, Bitbucket, or a self-hosted server reachable from `proxy.golang.org`.
- **Required:** Comfort with `git add`, `git commit`, `git push`, and basic remote configuration.
- **Helpful:** Having read [`go mod init` Junior](../../01-modules-and-dependencies/01-go-mod-init/junior.md). Without that, the term "module path" will not feel grounded.
- **Helpful:** A working email and at least one project you would like to share — even a five-line `Hello` library is fine.

If `go version` works, your project compiles, and you can `git push` to your remote, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Publishing** | Making a Go module available so others can `go get` it. In Go, this means pushing a public Git repository and tagging a release. There is no separate upload step. |
| **Tag** | A named pointer to a specific Git commit. In Go, a tag like `v1.2.3` (with the leading `v`) is what the toolchain reads as a module version. |
| **Semver** | Semantic Versioning. A three-part numbering scheme `MAJOR.MINOR.PATCH` with rules about what kind of change bumps which number. Go modules require it. |
| **`v0`** | The "anything can change" major version. Versions `v0.1.0`, `v0.2.0`, ... do not promise backward compatibility. Most new projects start here. |
| **`v1`** | The first stable major version. Once you tag `v1.0.0`, you are promising that further `v1.x.y` releases will not break users. |
| **Major version bump** | Releasing a backward-incompatible change. In Go, going from `v1` to `v2` requires changing the module path to end with `/v2`. |
| **`proxy.golang.org`** | Google's public module proxy. The default mirror that `go get` talks to. It fetches modules from your Git host on first request and caches them. |
| **`sum.golang.org`** | The public checksum database. It records cryptographic hashes of every module version it has ever seen, so users can detect tampering. |
| **`pkg.go.dev`** | The public documentation site for Go modules. It indexes published modules, renders their `godoc`, displays the README, and shows version history. |
| **`godoc`** | Documentation auto-generated from comments above package, type, and function declarations. The format the Go toolchain understands. |
| **LICENSE** | A text file at the module root declaring the legal terms under which others can use your code. Required for almost any community use. |
| **Retract** | A `go.mod` directive declaring a previously-published version "should not be used." The version still exists; it is flagged as deprecated. |

---

## Core Concepts

### Publishing = pushing + tagging

Forget "registries." A Go module is published when two conditions hold:

1. The module's source code lives at a public URL that matches its module path. If `go.mod` says `module github.com/alice/hello`, then `https://github.com/alice/hello` must be a real, public Git repository whose contents include `go.mod` at the root.
2. A Git tag with the right shape (`vMAJOR.MINOR.PATCH`) points to a commit in that repository.

That is the entire mechanical definition.

### Git tags ARE module versions

This is the load-bearing fact of the whole topic: **a Go module's version is a Git tag.** Not a setting in a config file, not an entry in a database — a Git tag.

```bash
git tag v0.1.0
git push --tags
```

After those two lines run successfully, the version `v0.1.0` of your module exists. Anyone, anywhere, can now write:

```bash
go get github.com/alice/hello@v0.1.0
```

and the Go toolchain will fetch the contents of the commit your `v0.1.0` tag points at.

### The `v` prefix is non-negotiable

Go reads `v0.1.0`. It does **not** read `0.1.0`. A tag without the `v` prefix is invisible to the Go module system. This is the single most common first-time publishing mistake.

### The proxy discovers your module on first `go get`

You do not "register" your module anywhere. The first time *anyone* runs `go get example.com/yourmodule@v0.1.0`, the Go toolchain forwards the request to `proxy.golang.org`. The proxy:

1. Looks the module up in its cache (it is not there — first time).
2. Resolves the module path to a Git host (`github.com/...`, `gitlab.com/...`, etc.).
3. Clones or fetches the tag `v0.1.0`.
4. Computes the module's checksum.
5. Reports the checksum to `sum.golang.org`.
6. Caches the bytes, forever.

After step 6, the module is "in the index." Future `go get` requests for that version are served from the cache, even if you delete the original repository (yes — that has implications, see Edge Cases & Pitfalls).

### `pkg.go.dev` indexes you after first download

`pkg.go.dev` is a separate service from the proxy. It watches the proxy for new modules and indexes their documentation. Within minutes to hours of your first `go get`, your module appears on `pkg.go.dev/<module-path>` with auto-generated docs and your README rendered as the front page.

### Semantic Versioning, in 30 seconds

The version `MAJOR.MINOR.PATCH` encodes intent:

- **MAJOR** changes when you break the API. Renaming, removing, or changing the signature of an exported symbol is a major change.
- **MINOR** changes when you add a backward-compatible feature. New exported function, new field on a struct that has no constructor, new package — these are minor.
- **PATCH** changes when you fix a bug without changing the API. Performance improvements, internal refactoring, and bug fixes are patches.

Go enforces a stricter rule on top of semver: **once you publish `v2.0.0` or later, your module path must end with `/vN`** (where `N` is the major version number). This is called the *Semantic Import Versioning* rule.

### `v0` is the "I'm still figuring it out" zone

While your version is `v0.x.y`, you are excused from the stability promise. You can break the API at every minor release if you want. The community knows this and treats `v0` modules as experimental.

The moment you tag `v1.0.0`, you are promising to follow semver strictly. No surprise breaking changes; only at `v2`, `v3`, etc.

---

## Real-World Analogies

**1. A book in a library.** Writing a book privately is like working on a Go module on your laptop. Donating the book to a public library is publishing — it is on the shelves, it has a catalog number (the version tag), and anyone with a library card (`go get`) can borrow it. The library does not produce the book; it just indexes and lends it.

**2. A street performer's set list.** A band can play in their garage forever, but until they post a setlist with dates ("v0.1.0 — first gig, June 4"), the audience cannot reference a specific show. Tags are dated, immutable references to "the version you heard that night."

**3. Pinning a postcard to a corkboard.** The proxy is a corkboard at the train station. The first person who runs `go get example.com/x@v1.0.0` walks in, pins your postcard there, and from then on every other traveller sees the same postcard. Even if you take down the original, the corkboard copy remains.

**4. A film's theatrical release.** The director (you) can edit the film privately as much as they want. But once the film is released — once a tag is cut and pushed — that version is the public artifact. Re-editing means a new release, not overwriting the old one.

---

## Mental Models

### Model 1 — Tag is the contract; commit is the bytes

Your tag is a *promise* — "this commit hash represents `v1.0.0`." The commit is the actual code. Someone who downloads `v1.0.0` gets exactly the bytes the tag points at, forever. Move the tag and you have lied; never move a tag.

### Model 2 — The proxy is a cache, not a registry

There is no "publish to proxy" action. The proxy is a passive cache. The first user populates it. Subsequent users hit warm cache. You are not uploading; you are merely preparing a place for the proxy to fetch from.

### Model 3 — Versions form a tree, not a line

For each major version (`v0`, `v1`, `v2`, ...), you maintain an independent line of releases. `v1` and `v2` are essentially separate modules with related code; they live at different module paths and can be developed in parallel.

### Model 4 — Documentation is a side effect of comments

You do not "write docs" separately. You write Go comments above declarations, push, and `pkg.go.dev` renders them. The README is the front page; godoc is the manual. Both are auto-discovered. There is no "docs build" step.

### Model 5 — Retraction is a flag, not a delete

Once a version is in the proxy, it is there forever. The most you can do is mark it "do not use." Users will see warnings, but the bytes remain accessible to anyone who explicitly asks for that version.

---

## Pros & Cons

### Pros

- **No registry, no account, no upload.** If you can `git push`, you can publish.
- **Decentralised.** Your module lives where your code lives. GitHub down? You can move to GitLab and update the path.
- **Cryptographically verifiable.** `sum.golang.org` records every version's hash; tampering is detectable.
- **Auto-documented.** `pkg.go.dev` builds your docs for free.
- **Versions are immutable.** Users can pin and trust that the bytes never silently change.
- **Free.** No paid tier, no rate-limit on most public modules.

### Cons

- **The `/v2` rule surprises new authors.** Major-version bumps are more involved than in npm or PyPI.
- **Tags are forever.** Push a buggy `v1.0.0` and the only "fix" is `v1.0.1` plus a retract directive.
- **The proxy caches forever, even after a deletion.** Pushing a secret in `v0.1.0` and then "untagging" does not remove it from the proxy. (Removing a published version from the proxy requires a written request.)
- **Documentation requires comment discipline.** If you do not write godoc comments, your `pkg.go.dev` page will be barren.
- **There is no draft / preview.** You cannot "test the publish" without actually publishing — though `v0.x` releases are the conventional answer.

---

## Use Cases

You should publish a module when:

- **You have a small reusable library** (a CSV parser, a sliding-window iterator, a config loader) you want to share or use from another project.
- **You have a CLI tool** distributed as a Go binary and want users to install it with `go install your.path@latest`.
- **You want to use your own code from another machine.** Publishing means you can `go get` it from anywhere, no manual checkout.
- **You are open-sourcing a project** and want it discoverable on `pkg.go.dev`.
- **You want a stable, immutable artifact** to depend on — a frozen `v1.0.0` is a strong contract.

You should **not** publish a module when:

- The code contains secrets, API keys, or proprietary data. Once published, removal is hard.
- The code is just a personal experiment with no intended audience. Keep it on a private branch.
- You have not yet decided on the module path. Publishing pins the path; renaming later is painful.
- The module depends on modules you do not have permission to redistribute.
- You are inside a company that requires internal-only code. Use a private proxy or `GOPRIVATE`.

---

## Code Examples

### Example 1 — Publishing a tiny `hello` library (first publish workflow)

Suppose you have written a one-function library locally:

```
hello/
├── go.mod      ← module github.com/alice/hello
└── hello.go
```

Contents of `hello.go`:

```go
// Package hello provides a friendly greeting function.
package hello

// Greet returns a polite hello aimed at name.
func Greet(name string) string {
    return "hello, " + name
}
```

Step 1 — create the public repository on GitHub at `https://github.com/alice/hello`.

Step 2 — push your code:

```bash
git init
git add .
git commit -m "Initial release: Greet function"
git branch -M main
git remote add origin https://github.com/alice/hello.git
git push -u origin main
```

Step 3 — tag and push the first release:

```bash
git tag v0.1.0
git push origin v0.1.0
```

Step 4 — anyone (including you, from another machine) can now run:

```bash
go get github.com/alice/hello@v0.1.0
```

That is publishing.

### Example 2 — Verifying the publish worked

After the tag push, wait about a minute, then visit:

```
https://pkg.go.dev/github.com/alice/hello@v0.1.0
```

If the page loads with your `Greet` function listed, you are published. If it says "Module not found," `pkg.go.dev` has not yet indexed your module. Force the index by running `go get` once from your terminal — that hits the proxy, which causes pkg.go.dev to pick it up.

### Example 3 — Bumping to v1.0.0 (the stability promise)

After a few weeks of use, you decide your `Greet` API is stable. You tag a v1:

```bash
git tag v1.0.0
git push origin v1.0.0
```

`go.mod` does **not** change. The module path is still `github.com/alice/hello`. Only major versions `>= 2` change the module path.

Users now do:

```bash
go get github.com/alice/hello@v1.0.0
```

You are now bound by semver: future `v1.x.y` releases must be backward compatible.

### Example 4 — Releasing a v2 with a breaking change

Six months later, you decide `Greet` should return an error if the name is empty. That is a breaking API change. You must publish a `v2`.

Step 1 — change the module path in `go.mod`:

```
module github.com/alice/hello/v2

go 1.22
```

Step 2 — update internal imports inside the module to use the new path (if any).

Step 3 — make the breaking change in `hello.go`:

```go
// Package hello provides a friendly greeting function.
package hello

import "errors"

// Greet returns a polite hello, or an error if name is empty.
func Greet(name string) (string, error) {
    if name == "" {
        return "", errors.New("name is required")
    }
    return "hello, " + name, nil
}
```

Step 4 — commit and tag:

```bash
git add .
git commit -m "v2: Greet now returns error on empty name"
git tag v2.0.0
git push origin main v2.0.0
```

Users who want the new version write:

```go
import "github.com/alice/hello/v2"
```

`v1` users keep working, untouched. `v1` and `v2` are independent.

### Example 5 — Retracting a bad release

You realise `v1.2.0` introduced a critical bug. You release `v1.2.1` immediately. But you also want `go get` users to skip `v1.2.0`. Edit `go.mod`:

```
module github.com/alice/hello

go 1.22

retract v1.2.0  // critical bug in Greet, use v1.2.1 or later
```

Commit, tag `v1.2.2` (the retraction itself is a release), push:

```bash
git add go.mod
git commit -m "Retract v1.2.0 due to Greet bug"
git tag v1.2.2
git push origin main v1.2.2
```

Anyone running `go get -u` will now see a warning that `v1.2.0` is retracted and pick `v1.2.1` (or later) instead.

### Example 6 — A minimal LICENSE file

Create `LICENSE` at the module root:

```
MIT License

Copyright (c) 2024 Alice Example

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is furnished
to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS"...
```

Without this file, `pkg.go.dev` displays a "no license" warning and many users will refuse to depend on your module.

### Example 7 — A minimal README

Create `README.md`:

```markdown
# hello

A tiny library that greets people.

## Install

    go get github.com/alice/hello@latest

## Usage

    import "github.com/alice/hello"

    fmt.Println(hello.Greet("world"))
    // Output: hello, world

## License

MIT — see [LICENSE](LICENSE).
```

`pkg.go.dev` will render this as the front page of your module.

---

## Coding Patterns

### Pattern: Always start at v0

Tag your first release `v0.1.0`. Stay in `v0` until your API has been used by at least one outside project for a few weeks. This signals to the community "still in design." Once you are sure, tag `v1.0.0`.

### Pattern: One repository, one module path

The module path in `go.mod` and the URL of the Git repository must match. If `go.mod` says `module github.com/alice/cooltool`, the repository is `github.com/alice/cooltool`. Mismatch breaks `go get` with confusing errors.

### Pattern: Tag from the branch you want to publish from

```bash
git checkout main
git pull
git tag v1.0.0
git push origin v1.0.0
```

Tag from a clean, up-to-date `main`. Avoid tagging from feature branches by accident.

### Pattern: Add a CHANGELOG.md

For each release, append an entry:

```
## v1.2.0 — 2024-03-15
- Added: Greet now accepts a `lang` parameter.
- Fixed: trailing whitespace in output.
```

`pkg.go.dev` does not parse CHANGELOG, but humans browsing your repo will read it.

### Pattern: Version your README's install snippet

If your module is at `v2`, your README's install line must be:

```bash
go get github.com/alice/hello/v2@latest
```

Forgetting the `/v2` is a top-five complaint from new users.

---

## Clean Code

- **Lowercase, hyphenated module names.** `github.com/alice/csv-kit`, not `CsvKit` or `csv_kit`.
- **Top-of-file package comment.** Every package's main file should start with `// Package foo does X.` This becomes the package summary on pkg.go.dev.
- **Exported names get godoc comments.** Every exported function, type, constant, and variable needs a `// Name does X.` comment starting with the name itself.
- **README has install + usage in the first 30 lines.** Visitors decide whether to depend on you in seconds. Get to the point.
- **LICENSE is a plain `LICENSE` file at the root.** Not `LICENSE.txt`, not `license.md`. `pkg.go.dev` looks for canonical names.
- **Tags are immutable.** Never delete or move a published tag. If you must "fix" `v1.0.0`, release `v1.0.1` instead.

---

## Product Use / Feature

When your module is part of a product:

- The module path appears in **every consumer's `go.mod`**. It is part of their lockfile and CI.
- The version appears in **build provenance**, error messages, and bug reports.
- The README is the **first impression** for prospective adopters and contributors.
- The license determines which **companies and projects** can use your code.
- The retract directive is your **emergency brake** for shipped bugs.

Treat publication seriously. A poorly-tagged release is harder to recover from than a poorly-written file — files get edited; published versions are forever.

---

## Error Handling

### "go: github.com/alice/hello@v0.1.0: invalid version: unknown revision v0.1.0"

The tag does not exist on the remote. Cause: you ran `git tag v0.1.0` but forgot `git push --tags` (or `git push origin v0.1.0`). Fix:

```bash
git push origin v0.1.0
```

### "go: github.com/alice/hello: invalid version: unknown revision 0.1.0"

You created a tag without the leading `v`. Fix: delete the bad tag, create the right one.

```bash
git tag -d 0.1.0
git push origin :refs/tags/0.1.0
git tag v0.1.0
git push origin v0.1.0
```

### "module declares its path as: github.com/alice/hello/v2 but was required as: github.com/alice/hello"

You bumped to `v2` in `go.mod` but a consumer is asking for the bare path. They need to update their import to include `/v2`. The fix lives in *their* code.

### "module github.com/alice/hello@v0.1.0 found, but does not contain package ..."

You tagged a commit that does not include the package. Possibly you tagged before pushing all your code. Fix: push the missing files, then tag a new version.

### "verifying ...: checksum mismatch"

The bytes the proxy fetched do not match what your local clone has. Cause: someone moved a tag (yours or a transitive dependency's). Real-world fix: report it to the maintainer; never silently rotate tags yourself.

---

## Security Considerations

- **Never publish secrets.** API keys, passwords, `.env` files, internal hostnames — once a tag is up, the proxy has them forever.
- **Audit before tagging.** Review every file in the commit you are about to tag. `git diff v0.1.0..HEAD` (after you have an old tag) is your friend.
- **Use signed tags** in security-critical projects: `git tag -s v1.0.0`. Consumers can verify your GPG signature.
- **Watch for typosquatting against your name.** If you publish `github.com/alice/cooltool`, register `github.com/alice/cool-tool` and `github.com/alice/cool_tool` if you can — preventing impersonation is cheaper than fighting it.
- **The sumdb sees everything.** Anything you publish, even by accident, is permanently fingerprinted. Treat publication as a one-way door.
- **Removing a version from the proxy is a manual escalation.** It involves filing a request with the Go team and is reserved for legal or security reasons. Do not rely on it.

---

## Performance Tips

- Tagging is instant. The slowness is on first-`go get`, when the proxy fetches your repo. Keep your repository small to make that fast.
- A repository with hundreds of megabytes of binary assets makes every `go get` of your module slow. Move large assets out of the module root.
- Tagging often (small, frequent releases) is better than tagging rarely (large, dramatic releases). Smaller diffs mean easier review and faster rollback.
- The proxy caches forever; subsequent users see milliseconds. The first user pays the cost.

---

## Best Practices

1. **Start at `v0.1.0`.** Reserve `v1.0.0` for the day you are confident the API is stable.
2. **Always include a LICENSE.** Without one, your code is technically not freely usable.
3. **Always include a README.** It is the front page of your module on pkg.go.dev.
4. **Write godoc comments on every exported symbol.** Free, automatic, beautiful documentation.
5. **Tag from a clean, up-to-date main branch.** Never from a feature branch or with uncommitted changes.
6. **Push the tag explicitly with `git push origin v1.0.0`.** "It worked locally" is not a publication.
7. **For breaking changes, do `/v2`, never silently break.** It is the single most important rule.
8. **Add a CHANGELOG.md.** Humans appreciate context.
9. **Verify on pkg.go.dev within a day.** Browse your own module. Look at it the way an outsider does.
10. **Keep tags immutable.** No moving, no deleting. Use `retract` for mistakes.

---

## Edge Cases & Pitfalls

### Pitfall 1 — Forgetting the `v` prefix

```bash
git tag 1.0.0  # wrong
git tag v1.0.0 # correct
```

A tag without `v` is invisible to Go. Fix the tag and push the corrected one.

### Pitfall 2 — Tagging without pushing

```bash
git tag v1.0.0
# you forgot to: git push origin v1.0.0
```

The tag exists on your laptop only. From the world's perspective, the version does not exist.

### Pitfall 3 — Mismatched module path and `/v2`

When bumping to `v2`:

- `go.mod` first line **must** end with `/v2`.
- The Git tag is `v2.0.0`, not `v2.0.0/v2`.
- The repository URL does not change — `github.com/alice/hello`, not `github.com/alice/hello/v2`.

A common mistake is to create a new repository called `hello-v2`. Don't. The `/v2` lives inside the module path of the existing repository.

### Pitfall 4 — Re-tagging a buggy release

```bash
git tag -d v1.0.0
git push origin :refs/tags/v1.0.0
git tag v1.0.0  # new commit, same tag name
git push origin v1.0.0
```

This works on Git, but the proxy and sumdb have already cached the old `v1.0.0`. They will refuse the new bytes (checksum mismatch). The "fix" looks like nothing changed for users. Use `v1.0.1` instead.

### Pitfall 5 — Accidentally publishing private code

Pushing a public repository with private secrets is a security incident. The fix involves rotating the secrets, not the repository — the proxy has cached the leaked bytes.

### Pitfall 6 — Tagging before the code is ready

You tag `v1.0.0` and discover an import path was wrong. The proxy has already cached the broken version. Fix: tag `v1.0.1` with the corrected code and add a `retract v1.0.0` directive.

### Pitfall 7 — A `go.mod` with no `go` directive

Older modules sometimes have a `go.mod` missing the `go` line. Modern Go tools will accept it but pkg.go.dev may complain. Add `go 1.x` and re-tag.

### Pitfall 8 — Module path mismatch with repo URL

If your `go.mod` says `module example.com/alice/hello` but the code lives at `github.com/alice/hello`, `go get example.com/alice/hello` will fail because Go cannot find the source.

---

## Common Mistakes

- **Tagging `1.0.0` instead of `v1.0.0`.** The most common publishing bug.
- **Forgetting `git push --tags` or `git push origin <tag>`.** Local tags are invisible to the world.
- **Going from `v1` to `v2` without renaming the module path.** Users will keep getting `v1` because the toolchain refuses to follow the major-version bump rule silently.
- **Editing a published tag.** Tags must be immutable. Use a new patch version to fix problems.
- **Skipping LICENSE.** Many shops auto-reject dependencies without one.
- **No package-level godoc comment.** pkg.go.dev shows a blank package summary.
- **Tagging from a feature branch.** The tag points at a commit that is not in `main`, leading to a confusing release history.
- **Publishing without verifying with `go get` from a clean cache.** Trust nothing about a release until you can `go get` it from a fresh machine.
- **Using `latest` in a production lockfile.** Always pin to a specific version.

---

## Common Misconceptions

> *"There is a `go publish` command."*

There is not. You publish by pushing to a public Git host and tagging.

> *"I have to register my module on pkg.go.dev."*

You do not. pkg.go.dev discovers modules automatically when they are pulled through the proxy.

> *"Once I delete my GitHub repository, my module is gone."*

It is gone from GitHub, but the proxy has cached it forever. Anyone who already has the version will keep working. Anyone trying to `go get` a *new* version will fail. Deletion is not a removal mechanism.

> *"I can fix a bad release by re-tagging it."*

You cannot. Tags are immutable from the proxy's perspective. Fix forward with a new patch version.

> *"`v0` versions are unstable, `v1+` versions are stable, but `v2`, `v3` are even more stable."*

`v2` is not "more stable" than `v1`. It is a different major version. Increasing the number does not mean increasing maturity — it means breaking compatibility.

> *"I have to switch to a new repository for `v2`."*

You do not. `v2` lives in the same Git repository, possibly on the same `main` branch, just with a `/v2` suffix in the module path.

> *"My module path can be anything because Go figures it out."*

It cannot. The module path must be the URL of a public repository. Mismatches break `go get`.

---

## Tricky Points

- **The proxy and the sumdb are eventually consistent with your Git host.** A tag pushed seconds ago may take up to a minute to appear when you `go get`. Patience.
- **`pkg.go.dev` indexes lazily.** If your module never gets a `go get`, it never appears on pkg.go.dev. Trigger indexing by running `go get` once yourself.
- **Pre-release tags exist.** `v1.0.0-rc1`, `v1.0.0-beta`, `v0.5.0-alpha+build.42` are valid. They sort below the corresponding stable release.
- **The `+incompatible` suffix is a fossil.** Pre-modules code that hit `v2` without renaming gets a synthetic `+incompatible` from the toolchain. New code should never need to think about this.
- **`go install path@latest`** for a CLI uses the highest tagged version. If your latest tag is `v0.x` and someone wants `v1+`, they must specify it explicitly.
- **`go get -u` does not cross major versions.** Going from `v1` to `v2` is a manual, deliberate import-path change.
- **A `go.mod` without a `go` directive will be auto-upgraded** on first toolchain interaction. Best to declare it explicitly.

---

## Test

Try this in a scratch folder.

```bash
mkdir hello
cd hello
go mod init github.com/<your-username>/hello

cat > hello.go <<'EOF'
// Package hello prints greetings.
package hello

// Greet says hello to name.
func Greet(name string) string { return "hello, " + name }
EOF

git init
git add .
git commit -m "initial"
git branch -M main
# Now create the matching empty repository on GitHub, then:
git remote add origin https://github.com/<your-username>/hello.git
git push -u origin main

git tag v0.1.0
git push origin v0.1.0
```

Now answer:

1. After `git push origin v0.1.0`, what does `go get github.com/<you>/hello@v0.1.0` do? (Answer: succeeds, downloads the module via the proxy.)
2. What command takes the place of "publish"? (Answer: `git push origin v0.1.0`. There is no other.)
3. Where does pkg.go.dev get your README from? (Answer: from the repository, fetched via the proxy.)
4. If you tag `v0.1.0` again on a different commit, will users see the new code? (Answer: no, the proxy will refuse the tampered tag.)

---

## Tricky Questions

**Q1.** I pushed `v1.0.0` an hour ago and pkg.go.dev still says "module not found." What is wrong?

A. pkg.go.dev only indexes modules the proxy has fetched. Trigger a fetch by running `go get github.com/<you>/<module>@v1.0.0` from any machine. Within minutes pkg.go.dev will pick it up.

**Q2.** I want to remove `v1.0.0` because it had a security bug. How?

A. You cannot remove it from the proxy. You can:
  1. Release a fixed `v1.0.1` (or `v1.1.0`).
  2. Add `retract v1.0.0` to `go.mod` in a new release.
  3. For severe issues, file a request with the Go team to remove from the proxy.

**Q3.** Can I have `v1` and `v2` in the same Git repository?

A. Yes — and it is the recommended layout. Both live on the same `main` branch (or in separate branches if you maintain `v1` patches). The `go.mod` path differs (`/v2`), and tags `v1.x.y` and `v2.x.y` coexist.

**Q4.** My tag is `release-1.0`, will Go pick it up?

A. No. Go only recognises tags that match the pattern `vMAJOR.MINOR.PATCH` (with optional pre-release/build suffix). `release-1.0` is invisible.

**Q5.** Can I publish a module without a LICENSE?

A. Technically yes — the proxy will fetch and serve it. But pkg.go.dev shows a "no license" warning, and most companies' policies forbid depending on unlicensed code. Always include a license.

**Q6.** What happens if I push two tags to the same commit, `v1.0.0` and `v1.0.1`?

A. Both are valid versions. They are equivalent in code but distinct in version. Users picking `v1.0.1` get the same bytes as `v1.0.0`. Mostly harmless, occasionally confusing.

**Q7.** How does `pkg.go.dev` know when I publish a new version?

A. It does not until someone runs `go get` for that version. The proxy notifies pkg.go.dev when a new module-version pair is fetched.

**Q8.** Do I need GitHub specifically, or do other Git hosts work?

A. Most Git hosts work: GitHub, GitLab, Bitbucket, sr.ht, Gitea-based servers reachable from `proxy.golang.org`. The module path encodes the host; if Go can resolve the path to a Git URL, it works.

---

## Cheat Sheet

```bash
# First-time publish
git init
git add .
git commit -m "initial"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
git tag v0.1.0
git push origin v0.1.0

# Subsequent release (patch)
# (after committing fixes)
git tag v0.1.1
git push origin v0.1.1

# Bump to v1
git tag v1.0.0
git push origin v1.0.0

# Bump to v2 (breaking change)
# 1) Edit go.mod: module github.com/<you>/<repo>/v2
# 2) Update internal imports if any
git add go.mod
git commit -m "v2: API change"
git tag v2.0.0
git push origin main v2.0.0

# Retract a bad release
# Edit go.mod, add: retract v1.0.0
git add go.mod
git commit -m "retract v1.0.0"
git tag v1.0.1
git push origin main v1.0.1

# Verify
go get github.com/<you>/<repo>@v0.1.0
open https://pkg.go.dev/github.com/<you>/<repo>@v0.1.0
```

| Symptom | Likely Cause |
|---------|-------------|
| `unknown revision v0.1.0` | Tag not pushed. |
| `unknown revision 0.1.0` | Missing `v` prefix on tag. |
| `module declares its path as ...` | `/v2` mismatch. |
| `not in module` | Tag points to a commit without the source. |
| pkg.go.dev shows "no license" | Add a LICENSE file at the root. |

```
Required files at the module root for a clean publish:
    go.mod        (module path, go directive)
    LICENSE       (legal terms)
    README.md     (front-page docs)
    *.go          (your code with godoc comments)
```

---

## Self-Assessment Checklist

You can move on to [middle.md](middle.md) when you can:

- [ ] Explain in one sentence what publishing a Go module is
- [ ] Describe the role of `proxy.golang.org`, `sum.golang.org`, and `pkg.go.dev`
- [ ] Choose between `v0` and `v1` for a first release
- [ ] Tag and push a new release from the command line
- [ ] Recognise the `v` prefix requirement
- [ ] Explain the `/v2` rule for breaking changes
- [ ] Draft a minimal LICENSE and README
- [ ] Recognise common publishing error messages
- [ ] Retract a buggy release using the `retract` directive
- [ ] Predict what happens if you delete a published Git tag

---

## Summary

Publishing a Go module is two steps: push the code to a public Git repository, and create a Git tag of the form `v0.1.0`. There is no upload, no registry account, no `go publish` command. The `proxy.golang.org` mirror discovers your module the first time anyone runs `go get`, caches its bytes forever, and feeds documentation to `pkg.go.dev`.

Semver dictates the version numbers: `v0.x.y` for "still figuring it out," `v1.0.0` for the stability promise, and `v2`, `v3`, ... for breaking changes — each requiring a `/vN` suffix in the module path. Tags are immutable; bad releases are corrected by `v1.0.1` plus a `retract` directive, never by deleting or moving tags.

Spend ten minutes on a good README, ten on a LICENSE, and an hour writing godoc comments on every exported symbol. Those three artifacts are 90% of how outsiders judge your module.

---

## What You Can Build

After learning this:

- **A published `hello` library** that anyone can `go get`.
- **A Go CLI distributed via `go install`**, installable on any developer's machine in one command.
- **A reusable utility module** you can import from your own future projects.
- **A `v1.0.0` library** with a stability promise and a CHANGELOG.
- **A `v2` of an existing library** that introduces a deliberate breaking change.

You cannot yet:
- Publish under a private proxy (later: middle.md, GOPRIVATE)
- Sign your tags and configure verifiable releases (later: senior.md)
- Automate releases with GitHub Actions / GoReleaser (later: senior.md / professional.md)
- Coordinate multi-module monorepos (later: middle.md)

---

## Further Reading

- [Publishing a module](https://go.dev/doc/modules/publishing) — official Go guide.
- [Module version numbering](https://go.dev/doc/modules/version-numbers) — the official semver-for-Go reference.
- [Major version suffixes](https://go.dev/ref/mod#major-version-suffixes) — the `/v2` rule explained.
- [`retract` directive](https://go.dev/ref/mod#go-mod-file-retract) — how retractions work.
- [Semantic Versioning 2.0.0](https://semver.org/) — the underlying spec.
- [pkg.go.dev FAQ](https://pkg.go.dev/about) — how the docs site indexes modules.

---

## Related Topics

- [6.1.1 `go mod init`](../../01-modules-and-dependencies/01-go-mod-init/junior.md) — creating the module before you publish it
- [6.1.2 `go mod tidy`](../../01-modules-and-dependencies/02-go-mod-tidy/junior.md) — cleaning up dependencies before tagging
- [6.2.1 Package Import Rules](../01-package-import-rules/junior.md) — how consumers will import your module
- 6.2.2 Internal & Vendor Folders — controlling visibility before publishing
- 11.1.5 `go mod` — the full module subcommand reference

---

## Diagrams & Visual Aids

```
First-publish workflow:

    [local module]
          │
          │   git push origin main
          ▼
    [public repo on GitHub]
          │
          │   git tag v0.1.0
          │   git push origin v0.1.0
          ▼
    [tagged commit on GitHub]
          │
          │   someone runs: go get example.com/m@v0.1.0
          ▼
    [proxy.golang.org fetches and caches]
          │
          │   reports checksum
          ▼
    [sum.golang.org records hash]
          │
          ▼
    [pkg.go.dev indexes documentation]
```

```
Version lifecycle:

    v0.1.0 ──► v0.2.0 ──► v0.3.0    (experimental, breaking allowed)
                              │
                              │ "I'm sure now"
                              ▼
                          v1.0.0 ──► v1.1.0 ──► v1.2.0    (stable, no breaks)
                                                    │
                                                    │ breaking change
                                                    ▼
                                            change module path to /v2
                                                    │
                                                    ▼
                                              v2.0.0 ──► v2.1.0
```

```
Module path anatomy when at v2+:

    github.com/alice/hello/v2
    └────┬───┘ └─┬─┘ └─┬─┘ └┬┘
       host   user  repo  major version suffix
                          (required for v2+, omitted for v0/v1)
```

```
Files at module root for a polished publish:

    hello/
    ├── go.mod          ← module github.com/alice/hello
    ├── LICENSE         ← legal terms (e.g. MIT)
    ├── README.md       ← front page on pkg.go.dev
    ├── CHANGELOG.md    ← release notes (optional but loved)
    ├── hello.go        ← // Package hello provides ...
    └── hello_test.go   ← tests (optional but professional)
```

```
What happens to a retracted version:

    [user runs: go get example.com/m@latest]
                       │
                       ▼
    [proxy returns latest non-retracted version]
                       │
                       ▼
    [printed warning: "v1.0.0 is retracted"]

    [user runs: go get example.com/m@v1.0.0]   ← explicit
                       │
                       ▼
    [proxy serves the bytes anyway, with warning]
```
