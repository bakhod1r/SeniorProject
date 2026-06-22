# Registries & Distribution — Junior Level

> **Roadmap:** [Release Engineering](../README.md) → Registries & Distribution

*Where your artifacts live after the build, and how everyone else gets them.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — What a registry is](#core-concept-1--what-a-registry-is)
5. [Core Concept 2 — Coordinates: name, version, digest](#core-concept-2--coordinates-name-version-digest)
6. [Core Concept 3 — Publishing a container image](#core-concept-3--publishing-a-container-image)
7. [Core Concept 4 — Publishing a language package](#core-concept-4--publishing-a-language-package)
8. [Core Concept 5 — Pulling and authenticating](#core-concept-5--pulling-and-authenticating)
9. [Real-World Examples](#real-world-examples)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **A build produces an artifact. A registry is the place that artifact lives so other people and machines can fetch it.**

You wrote code. CI compiled it into something runnable — a container image, an npm tarball, a Python wheel, a JAR. That artifact has to go *somewhere* before anyone can use it. That somewhere is a **registry** (or "package repository", or "artifact store" — same idea, different ecosystems).

If a build pipeline is a factory, the registry is the warehouse. You don't ship from the assembly line; you ship from the warehouse. This file teaches you what registries are, how to name what you put in them, and how to publish and pull your first artifacts.

## Prerequisites

- You can run a CI build and produce *something* (an image, a tarball, a JAR).
- Basic command line: you can run `docker`, `npm`, or `pip`.
- You understand version numbers loosely — see [Versioning & SemVer](../01-versioning-and-semver/junior.md).
- You have an account on at least one registry (Docker Hub, npm, PyPI).

## Glossary

| Term | Meaning |
|------|---------|
| **Registry** | A server that stores and serves artifacts (images, packages). |
| **Repository** | A named bucket inside a registry holding one artifact's versions (e.g. `library/nginx`). |
| **Artifact** | The built thing you publish: image, tarball, wheel, JAR, binary. |
| **Tag** | A human-friendly, *mutable* label pointing at a version (e.g. `v1.2.3`, `latest`). |
| **Digest** | A cryptographic hash (`sha256:...`) that *uniquely and immutably* identifies exact bytes. |
| **Publish / push** | Upload an artifact to a registry. |
| **Pull** | Download an artifact from a registry. |
| **Namespace** | The owner prefix (`@myorg/`, `ghcr.io/myorg/`) that scopes who owns a name. |
| **Public vs private** | Anyone can pull (public) vs. auth required (private). |

## Core Concept 1 — What a registry is

A registry is an HTTP service that does two jobs: **accept uploads** of artifacts and **serve downloads** of them. Different ecosystems have their own registries, but they all play the same role.

| Kind | Examples | Holds |
|------|----------|-------|
| Container / OCI | Docker Hub, GitHub Container Registry (GHCR), Amazon ECR, Artifactory | Container images |
| Language packages | npm, PyPI, crates.io, Maven Central, RubyGems, Go module proxy | Libraries |
| OS packages | apt repos, yum/dnf repos | `.deb` / `.rpm` system packages |
| Generic | Artifactory, Nexus, S3 buckets | Any file: binaries, zips, installers |

When you run `npm install express`, npm contacts the npm registry. When Kubernetes starts a pod, the node pulls the image from a container registry. The registry is the hand-off point between "we built it" and "someone runs it".

```bash
# Every install you've ever run hits a registry under the hood
npm install express          # -> registry.npmjs.org
pip install requests         # -> pypi.org
docker pull nginx            # -> docker.io (Docker Hub)
```

## Core Concept 2 — Coordinates: name, version, digest

To fetch an artifact you need to *address* it. Three pieces matter:

1. **Name** — what it is: `express`, `nginx`, `requests`.
2. **Version** — which release: `4.18.2`, `1.25.3`.
3. **Digest** — the exact bytes, as a hash: `sha256:e7c3f...`.

A **tag** is a friendly pointer. `nginx:1.25` is a name + tag. But here's the crucial fact you'll meet everywhere:

> **Tags are mutable. Digests are immutable.**

A tag like `latest` or `1.25` can be *moved* to point at new bytes tomorrow. A digest can never point at different bytes — change one byte and the hash changes. So when you want certainty about *exactly* what you're running, you reference the digest:

```bash
# By tag — convenient, but the bytes can change later
docker pull nginx:1.25

# By digest — pinned forever to these exact bytes
docker pull nginx@sha256:e7c3f...d91
```

You'll learn much more about why this matters in [middle.md](middle.md). For now: tags = friendly + changeable, digests = exact + permanent.

## Core Concept 3 — Publishing a container image

Publishing an image is `build` then `push`. The image name encodes the registry, namespace, and repository.

```bash
# Format: REGISTRY/NAMESPACE/REPO:TAG
# Build and tag for GitHub Container Registry
docker build -t ghcr.io/myorg/web-api:1.4.0 .

# Log in (use a token, not your password)
echo "$GHCR_TOKEN" | docker login ghcr.io -u myuser --password-stdin

# Push it
docker push ghcr.io/myorg/web-api:1.4.0
```

After the push, the registry returns the **digest** it stored. Copy it — deployments should reference the digest, not just the tag:

```
ghcr.io/myorg/web-api:1.4.0
  digest: sha256:9b2c4e...a17
```

Common registries and their host prefixes:

```bash
docker.io/library/nginx          # Docker Hub (default if no host given)
ghcr.io/myorg/web-api            # GitHub Container Registry
123456789.dkr.ecr.us-east-1.amazonaws.com/web-api   # Amazon ECR
```

## Core Concept 4 — Publishing a language package

Each language ecosystem has its own publish command, but the shape is the same: authenticate, then upload.

**npm** (JavaScript):
```bash
npm login                    # or set an automation token in CI
npm publish                  # reads name + version from package.json
```

**PyPI** (Python) — build a wheel, then upload with `twine`:
```bash
python -m build              # produces dist/*.whl and *.tar.gz
twine upload dist/*          # uploads to pypi.org
```

**crates.io** (Rust):
```bash
cargo login                  # paste your API token once
cargo publish                # packages and uploads the crate
```

**Maven Central** (Java) — deploy to a staging repo, then release:
```bash
mvn deploy                   # uploads to the staging repository
# then "release" the staging repo (via Sonatype/Nexus UI or plugin)
```

**Go** is the odd one out — there is **no push**. You don't upload Go modules. You just **tag your Git repo** and the Go module proxy fetches it from version control the first time someone asks for it:

```bash
git tag v1.4.0
git push origin v1.4.0
# Done. proxy.golang.org fetches it from your VCS when requested.
```

> The key thing: the name in your manifest (`package.json`, `Cargo.toml`, `pom.xml`) plus the version is your coordinate. Bump the version every release.

## Core Concept 5 — Pulling and authenticating

Pulling public artifacts usually needs no auth. Private ones need a token.

```bash
# Public — just works
docker pull nginx:1.25
npm install lodash

# Private — log in first
docker login ghcr.io                     # container registry
npm config set //registry.npmjs.org/:_authToken=$NPM_TOKEN
pip install --index-url https://user:token@pypi.mycompany.com/simple/ mylib
```

**Use tokens, not passwords.** A token can be scoped (read-only, or read+publish) and revoked without changing your password. In CI you set the token as a secret environment variable — never commit it to the repo.

Two permission levels you'll meet immediately:

- **Read** — pull/install. Often public or a low-privilege token.
- **Publish/write** — push new versions. Always guard this; a leaked publish token lets an attacker ship malicious versions under your name.

## Real-World Examples

**Example 1 — A web service image.** Your CI builds `ghcr.io/acme/checkout:2.3.1`, pushes it, and records the digest `sha256:1f0a...`. The Kubernetes manifest deploys `checkout@sha256:1f0a...`. Even if someone later re-tags `2.3.1`, your running cluster keeps the exact bytes it deployed.

**Example 2 — Installing a library.** A teammate adds `requests==2.31.0` to `requirements.txt`. On every machine and in CI, `pip install` fetches the *same* version from PyPI. The version number is the shared coordinate.

**Example 3 — A Go module.** You release `github.com/acme/toolkit v0.5.0` by pushing a Git tag. A user runs `go get github.com/acme/toolkit@v0.5.0`; the Go proxy fetches it from your repo, caches it, and serves it to everyone after that. You never ran a "publish" command.

## Mental Models

- **Registry = warehouse.** The build line makes goods; the warehouse stores and ships them. You never ship straight off the line.
- **Coordinate = postal address.** `name + version` gets you to the right shelf; `digest` is the exact item's serial number.
- **Tag = sticky note, digest = fingerprint.** A sticky note can be peeled off and stuck on a different box. A fingerprint can't.
- **Token = a key that fits one door.** A read token opens the read door; a publish token opens the publish door. Don't carry the master key around.

## Common Mistakes

- **Depending on `latest`.** `latest` is just a tag that someone moves. Your build today and tomorrow can silently get different bytes. Pin a real version (and ideally a digest).
- **Committing tokens.** A registry token in Git is a published credential. Use CI secrets and revoke leaked ones immediately.
- **Forgetting to bump the version.** Most registries refuse to overwrite an existing version. If your publish fails with "version already exists", you forgot to increment.
- **Using your password to log in from CI.** Use a scoped automation token instead so you can revoke it cleanly.
- **Pushing to the wrong namespace.** `docker push nginx` (no namespace) targets Docker Hub's official library — which you can't write to. Always prefix `ghcr.io/myorg/...` or your registry host.

## Test Yourself

1. What is the difference between a *tag* and a *digest*?
2. Why is depending on the `latest` tag risky?
3. Name the publish command for npm, PyPI (via twine), and Rust.
4. Why does Go have no "publish" step?
5. Why should CI use a token rather than your account password?
6. What two permission levels does almost every registry distinguish?

## Cheat Sheet

```bash
# Containers
docker build -t ghcr.io/org/app:1.0.0 .
docker login ghcr.io -u user --password-stdin
docker push ghcr.io/org/app:1.0.0
docker pull ghcr.io/org/app@sha256:<digest>   # pin by digest

# npm
npm publish                 # version from package.json
npm install <pkg>

# Python
python -m build && twine upload dist/*
pip install <pkg>==<version>

# Rust
cargo publish

# Java (Maven Central)
mvn deploy                  # then release the staging repo

# Go (no push — just tag)
git tag v1.0.0 && git push origin v1.0.0
```

| Want | Use |
|------|-----|
| Convenience, accept changes | tag (`app:1.0.0`) |
| Exact, reproducible bytes | digest (`app@sha256:...`) |
| Authenticate in CI | scoped token as secret |

## Summary

A **registry** is where built artifacts live so others can fetch them. You address an artifact by **name + version**, and pin it exactly by **digest**. Tags are convenient but mutable; digests are permanent. Publishing is "authenticate, then push" (`docker push`, `npm publish`, `twine upload`, `cargo publish`, `mvn deploy`) — except Go, which fetches from your VCS tags via a proxy. Always use scoped tokens, never passwords or committed secrets, and never trust `latest` for anything you care about. Next, [middle.md](middle.md) digs into immutability, digests, and what to do when you ship a bad release.

## Further Reading

- Docker docs — "Push and pull images"
- npm docs — "Publishing packages"
- Python Packaging User Guide — "Uploading your project to PyPI"
- The Go Modules Reference — "Module proxy"

## Related Topics

- [Versioning & SemVer](../01-versioning-and-semver/junior.md) — how to choose the version number you publish under.
- [Artifact Signing & Provenance](../04-artifact-signing-and-provenance/junior.md) — proving the artifact really came from you.
- [Release Automation](../08-release-automation/junior.md) — wiring publish into CI.
- The `docker-best-practices` skill — building lean, secure images before you push them.
