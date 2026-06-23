# Private Modules — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Five Variables That Matter](#the-five-variables-that-matter)
3. [Glob Patterns in Detail](#glob-patterns-in-detail)
4. [Authentication Mechanics](#authentication-mechanics)
5. [`.netrc` in Production Detail](#netrc-in-production-detail)
6. [Personal Access Tokens — Practical Guide](#personal-access-tokens--practical-guide)
7. [SSH-First Workflows](#ssh-first-workflows)
8. [Private Modules in CI](#private-modules-in-ci)
9. [Docker Build Patterns](#docker-build-patterns)
10. [Troubleshooting Recipes](#troubleshooting-recipes)
11. [Mixing Public and Private](#mixing-public-and-private)
12. [Pitfalls at Scale](#pitfalls-at-scale)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)

---

## Introduction
> Focus: "Why do these env vars exist and what do they each do?" "How do I make this work in CI?"

The junior file showed the minimum: set `GOPRIVATE`, configure `git`, done. This file is for the day after — when your team grows, your CI matrix grows, and your toolchain quirks start to bite. We will:

- Disambiguate `GOPRIVATE`, `GONOPROXY`, `GONOSUMDB`, `GOPROXY`, `GOSUMDB` and which one to reach for in which situation.
- Walk through `.netrc` and PAT setup with real numbers.
- Build a working GitHub Actions and a GitLab CI pipeline that pulls private modules.
- Build a Docker image that pulls private modules during the build (the right way and the wrong way).
- Diagnose ten of the most common errors with reproducible scripts.

---

## The Five Variables That Matter

| Variable | Default | What it controls |
|----------|---------|------------------|
| `GOPROXY` | `https://proxy.golang.org,direct` | Comma-separated list of proxies. The toolchain tries each in order. `direct` means "skip a proxy and use VCS." `off` disables network fetches. |
| `GOSUMDB` | `sum.golang.org` | Hostname of the checksum database. Set to `off` to skip verification entirely. |
| `GOPRIVATE` | unset | Globs for module paths that are private. Implies `GONOPROXY` and `GONOSUMDB` for those globs. |
| `GONOPROXY` | inherits from `GOPRIVATE` | Globs that bypass the proxy and go straight to VCS. |
| `GONOSUMDB` | inherits from `GOPRIVATE` | Globs whose checksum is not verified against `GOSUMDB`. |

A diagram of how a single `go get` is routed:

```mermaid
flowchart TD
    A[go get path@version] --> B{path matches GONOPROXY?}
    B -- yes --> C[direct: git clone]
    B -- no --> D[GOPROXY chain]
    D --> E[proxy.golang.org]
    E --> F{200 OK?}
    F -- no --> G[next proxy or direct]
    F -- yes --> H[bytes received]
    C --> H
    H --> I{path matches GONOSUMDB?}
    I -- yes --> J[skip sumdb verify]
    I -- no --> K[verify against sum.golang.org]
    J --> L[hash recorded in go.sum]
    K --> L
```

### When to set each one

- `GOPROXY` — only when you operate an internal proxy (Athens, Artifactory, JFrog) or want offline behaviour.
- `GOSUMDB` — set to `off` only in tightly controlled environments, otherwise leave default.
- `GOPRIVATE` — almost always; your one-stop knob for "we have private code."
- `GONOPROXY` — only when you want to bypass the proxy for paths that *are* publicly verifiable. Rare.
- `GONOSUMDB` — only when you want to skip checksum verification for paths whose proxy answer you do trust. Rare.

The 95% case is "set `GOPRIVATE`, leave the others." `GONOPROXY` and `GONOSUMDB` exist for the 5% where you want different policies for routing vs verification.

### A worked example

You operate an internal Athens proxy at `https://athens.acme.io`. You want every public dep through Athens (so it caches them), but private deps to bypass Athens *and* the public sumdb:

```bash
go env -w GOPROXY='https://athens.acme.io,direct'
go env -w GOPRIVATE='github.com/acme-corp/*'
# GOSUMDB stays at default (sum.golang.org), but GOPRIVATE makes
# matching paths bypass it.
```

Result: a public dep like `github.com/google/uuid` is fetched from Athens, hash-verified against `sum.golang.org`. A private dep like `github.com/acme-corp/auth` is fetched directly via Git, hash recorded in `go.sum` without external verification.

---

## Glob Patterns in Detail

The matcher is a simple glob, not a regex. It supports:

- `*` — match any sequence of non-separator characters in *one path segment*.
- `?` — single character.
- `[abc]` — character class.

It does **not** support `**`, `{a,b}`, or anchors. Comma separates entries.

### Examples

| Pattern | Matches | Does not match |
|---------|---------|----------------|
| `github.com/acme-corp/*` | `github.com/acme-corp/auth`, `github.com/acme-corp/billing` | `github.com/acme-corp/auth/v2`, `github.com/acme-corp/auth/internal` |
| `github.com/acme-corp/...` | (no — `...` is not a wildcard here) | everything |
| `*.acme.io/*` | `git.acme.io/foo`, `gitlab.acme.io/bar` | `acme.io/foo`, `git.acme.io` (no second segment) |
| `gopkg.in/acme/*` | `gopkg.in/acme/v1`, `gopkg.in/acme/util` | `gopkg.in/acme.v1` |

> **Surprise:** `github.com/acme-corp/*` matches *first-level* paths only. To cover `github.com/acme-corp/auth/v2` (a v2+ module) you may need `github.com/acme-corp/*,github.com/acme-corp/*/v2`. In practice, since v2+ paths are rare, most teams add the wildcards as needed.

### Glob debugging trick

There is no `go env -dryrun`, but you can introspect the resolved pattern by running:

```bash
$ GOPRIVATE='github.com/acme-corp/*' go env GONOPROXY
github.com/acme-corp/*
```

`GONOPROXY` is the live, resolved value the toolchain will use. If your `GOPRIVATE` is a comma-mess, this surfaces it.

---

## Authentication Mechanics

The Go toolchain has *no* authentication code of its own. It calls `git` (or `hg`, `svn`, `bzr`, `fossil`) to do the fetch. Whatever `git` does, `go` inherits.

`git` itself has multiple credential sources, tried in order:

1. URL embedded credentials (`https://user:pass@host/...`).
2. `git credential` helpers (the ones configured in `~/.gitconfig`).
3. `~/.netrc` (or `~/_netrc` on Windows).
4. Interactive prompt — fails in CI when `GIT_TERMINAL_PROMPT=0`.

### The credential helper chain

`git config --get-all credential.helper` shows the active chain. On macOS it is usually `osxkeychain` plus `cache`. On Linux it is empty by default — you opt in with `manager-core` or `libsecret`.

To force `git` to read `.netrc` and ignore other helpers, on a per-command basis:

```bash
GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
HOME=/tmp/clean go get github.com/acme-corp/foo
```

This is sometimes useful in CI to reproduce a "clean room" auth scenario.

---

## `.netrc` in Production Detail

A `.netrc` entry has three fields. For a token-based GitHub setup:

```
machine github.com
  login your-username-or-anything
  password ghp_yourPersonalAccessTokenHere
```

For GitHub fine-grained tokens, `login` can be any string — GitHub ignores it. For classic PATs, `login` must be your username.

### Multiple machines

```
machine github.com
  login your-username
  password ghp_xxxxxxxxxxxxx

machine gitlab.acme.io
  login deploy-token-bot
  password glpat-yyyyyyyyyyyyyy

machine api.bitbucket.org
  login your-username
  password app-pwd-zzzzz
```

The first matching `machine` wins. If GitHub Enterprise sits at a different host, add a separate entry.

### Permissions

```bash
chmod 600 ~/.netrc
```

If world-readable, modern `git` versions warn but still proceed. Older versions or strict filesystems may refuse. Always 600.

### Windows quirks

The file is `_netrc` (underscore), not `.netrc`. Place in `%USERPROFILE%`. PowerShell:

```powershell
"machine github.com login your-user password ghp_xxx" | Out-File -Encoding ASCII $env:USERPROFILE\_netrc
```

ASCII encoding matters; `git` on Windows does not parse UTF-16.

---

## Personal Access Tokens — Practical Guide

### GitHub classic PAT

- Settings → Developer settings → Personal access tokens → Tokens (classic).
- Scopes: `repo` is enough for read+write on private repos. For read-only, use a fine-grained token.
- Expiration: pick the shortest you can rotate. 90 days is reasonable.

### GitHub fine-grained PAT

- Same menu → Fine-grained tokens.
- Resource owner: pick the org (you may need org admin to allow PATs).
- Repository access: All repositories or a list.
- Permissions: **Contents: Read** (and Metadata: Read, automatically included).

### GitLab project access tokens

- Project → Settings → Access Tokens.
- Scopes: `read_repository`.
- Role: Reporter is enough.

### GitLab deploy tokens

- Project → Settings → Repository → Deploy tokens.
- A username + password pair, no user account behind it. Better for CI than PATs because there is no human to lose access.

### Bitbucket app passwords

- Personal settings → App passwords.
- Permissions: `Repositories: Read`.

### Azure DevOps PAT

- User settings → Personal access tokens.
- Scopes: `Code: Read`.

---

## SSH-First Workflows

If your team standardises on SSH, your `.ssh/config` carries the load:

```
Host github.com
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519_acme
  IdentitiesOnly yes

Host gitlab.acme.io
  HostName gitlab.acme.io
  User git
  IdentityFile ~/.ssh/id_ed25519_acme
  IdentitiesOnly yes
```

Push `IdentitiesOnly yes` to avoid the SSH agent trying every key in sequence — that hits GitHub's rate limit fast if you have many keys.

To force `go` to use SSH for HTTPS module paths:

```bash
git config --global url."git@github.com:".insteadOf "https://github.com/"
git config --global url."git@gitlab.acme.io:".insteadOf "https://gitlab.acme.io/"
```

Now `go get github.com/acme-corp/foo` uses SSH transparently.

### SSH agent in CI

Spawn a fresh agent and load a deploy key:

```bash
eval "$(ssh-agent -s)"
ssh-add - <<< "${DEPLOY_SSH_KEY}"
ssh-keyscan github.com >> ~/.ssh/known_hosts
```

`ssh-keyscan` populates `known_hosts` so the host-key prompt does not block CI.

---

## Private Modules in CI

### GitHub Actions — HTTPS + GITHUB_TOKEN

The job's auto-injected `GITHUB_TOKEN` can read every repo in the same org if your repo's permissions allow it. Cleanest pattern:

```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-go@v5
        with:
          go-version: '1.22'

      - name: Configure git for private modules
        run: |
          git config --global url."https://x-access-token:${{ secrets.GITHUB_TOKEN }}@github.com/".insteadOf "https://github.com/"

      - name: Set GOPRIVATE
        run: go env -w GOPRIVATE='github.com/${{ github.repository_owner }}/*'

      - name: Build & test
        run: |
          go mod download
          go build ./...
          go test ./...
```

`x-access-token` is the magic GitHub username when using a token. The trick is the `git config insteadOf` rewrite — every clone of `https://github.com/...` is replaced with `https://x-access-token:<TOKEN>@github.com/...`, which embeds the credential.

> Cross-org access: `GITHUB_TOKEN` only sees the current repo's org. For a different org, create a fine-grained PAT and inject it as a secret.

### GitHub Actions — Service-account PAT

If you cross orgs:

```yaml
- name: Configure git for private modules (cross-org PAT)
  env:
    GH_PAT: ${{ secrets.PRIVATE_MODULES_PAT }}
  run: |
    git config --global url."https://x-access-token:${GH_PAT}@github.com/".insteadOf "https://github.com/"
```

### GitLab CI — Job token

GitLab injects `CI_JOB_TOKEN` automatically. It can read other repos *if* the repo's settings → CI/CD → Job token permissions allow it.

```yaml
# .gitlab-ci.yml
build:
  image: golang:1.22
  variables:
    GOPRIVATE: "gitlab.acme.io/*"
  before_script:
    - echo "machine gitlab.acme.io login gitlab-ci-token password ${CI_JOB_TOKEN}" > ~/.netrc
    - chmod 600 ~/.netrc
  script:
    - go build ./...
    - go test ./...
```

`gitlab-ci-token` is GitLab's magic username for the job token.

### GitLab CI — Deploy token (cross-project)

Use a deploy token with `read_repository` scope:

```yaml
build:
  image: golang:1.22
  variables:
    GOPRIVATE: "gitlab.acme.io/*"
  before_script:
    - echo "machine gitlab.acme.io login ${DEPLOY_USER} password ${DEPLOY_TOKEN}" > ~/.netrc
    - chmod 600 ~/.netrc
  script:
    - go build ./...
```

Where `DEPLOY_USER` and `DEPLOY_TOKEN` are project-level CI/CD variables marked **masked**.

### CircleCI

CircleCI's `add-ssh-keys` orb is the easiest path:

```yaml
version: 2.1
jobs:
  build:
    docker:
      - image: cimg/go:1.22
    steps:
      - add-ssh-keys:
          fingerprints:
            - "aa:bb:cc:..."
      - run: |
          go env -w GOPRIVATE='github.com/acme-corp/*'
          git config --global url."git@github.com:".insteadOf "https://github.com/"
      - checkout
      - run: go build ./...
```

The fingerprint corresponds to a deploy key uploaded in CircleCI's UI.

### Jenkins

Use a credential of type "Username with password" (the password is the PAT). Bind it in the pipeline:

```groovy
withCredentials([usernamePassword(credentialsId: 'gh-pat',
                                  usernameVariable: 'GH_USER',
                                  passwordVariable: 'GH_TOKEN')]) {
  sh '''
    git config --global url."https://${GH_USER}:${GH_TOKEN}@github.com/".insteadOf "https://github.com/"
    go env -w GOPRIVATE='github.com/acme-corp/*'
    go build ./...
  '''
}
```

---

## Docker Build Patterns

A common mistake is committing the PAT into a Docker image. The token ends up in a layer and is shipped to every consumer.

### Good: BuildKit secret mount

```dockerfile
# Dockerfile
# syntax=docker/dockerfile:1.4
FROM golang:1.22 AS builder

ENV GOPRIVATE=github.com/acme-corp/*

# Mount a secret — it is NOT baked into the image
RUN --mount=type=secret,id=netrc,target=/root/.netrc,required=true \
    --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=cache,target=/root/go/pkg/mod \
    cd /src && go build -o /out/app ./cmd/app

WORKDIR /src
COPY . .
```

Build:

```bash
DOCKER_BUILDKIT=1 docker build \
  --secret id=netrc,src=$HOME/.netrc \
  -t myapp .
```

The `.netrc` exists *only during the RUN step*. The final image has no trace.

### Good: SSH agent forward

```dockerfile
# syntax=docker/dockerfile:1.4
FROM golang:1.22 AS builder

ENV GOPRIVATE=github.com/acme-corp/*

RUN mkdir -p ~/.ssh && \
    ssh-keyscan github.com >> ~/.ssh/known_hosts && \
    git config --global url."git@github.com:".insteadOf "https://github.com/"

RUN --mount=type=ssh \
    --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=cache,target=/root/go/pkg/mod \
    cd /src && go build -o /out/app ./cmd/app
```

Build:

```bash
DOCKER_BUILDKIT=1 docker build --ssh default -t myapp .
```

`--ssh default` forwards your local agent into the build. Token never leaves your machine.

### Bad (do not do this)

```dockerfile
# DO NOT — the PAT becomes a layer
ARG GH_TOKEN
RUN echo "machine github.com login x password $GH_TOKEN" > ~/.netrc
RUN go build ./...
```

Even if you `RUN rm ~/.netrc` later, the prior layer still contains the secret.

### Multi-stage tip

Always build in a builder stage and `COPY` only the final binary:

```dockerfile
FROM golang:1.22 AS builder
# ... see above ...
RUN go build -o /out/app ./cmd/app

FROM gcr.io/distroless/static
COPY --from=builder /out/app /app
ENTRYPOINT ["/app"]
```

The runtime image has no `git`, no Go toolchain, no secrets.

---

## Troubleshooting Recipes

A field guide. For each error: what it means, what to check, the fix.

### Recipe 1 — `410 Gone`

```
go: github.com/acme-corp/foo: ...: 410 Gone
```

`proxy.golang.org` answered: "I cannot serve this." Either it is private (very likely) or the path is malformed.

**Check:** `go env GOPRIVATE`. Empty? Set it.

**Fix:**

```bash
go env -w GOPRIVATE='github.com/acme-corp/*'
go clean -modcache  # only if stale entries linger
go mod tidy
```

### Recipe 2 — `terminal prompts disabled`

```
fatal: could not read Username for 'https://github.com': terminal prompts disabled
```

In CI, `GIT_TERMINAL_PROMPT=0` (set automatically by `go`) prevents `git` from asking. You must inject creds non-interactively.

**Fix:** add an `insteadOf` rewrite or a `.netrc` (see CI sections above).

### Recipe 3 — `Permission denied (publickey)`

```
git@github.com: Permission denied (publickey).
fatal: Could not read from remote repository.
```

Your SSH key is not loaded or not authorised.

**Check:** `ssh -T git@github.com`. If it fails too, the issue is SSH itself.

**Fix:** `ssh-add -l` to list loaded keys; `ssh-add ~/.ssh/id_ed25519` if missing.

### Recipe 4 — `unknown revision <branch>`

```
go: github.com/acme-corp/foo@unknown-branch: invalid version: unknown revision unknown-branch
```

The branch name does not exist on the remote (or `git ls-remote` cannot see it because of auth).

**Check:** `git ls-remote https://github.com/acme-corp/foo`. Does the branch appear?

**Fix:** correct the branch name *or* fix auth.

### Recipe 5 — `verifying ...: checksum mismatch`

```
verifying github.com/acme-corp/foo@v1.2.3: checksum mismatch
        downloaded: h1:abcd...
        go.sum:     h1:zzzz...
```

Either:

- `go.sum` was hand-edited, or
- the upstream re-tagged the version (force-push of a tag).

**Fix:** `git checkout go.sum && go mod tidy`. If the mismatch returns, the upstream really did republish — coordinate with the maintainer to pick a new version.

### Recipe 6 — `missing go.sum entry`

```
missing go.sum entry for module providing package github.com/acme-corp/foo
```

You added an `import` but never ran `go mod tidy`.

**Fix:** `go mod tidy`. In a CI that disallows network, run `go mod download` against a populated cache instead.

### Recipe 7 — `dial tcp: lookup proxy.golang.org: no such host`

The runner has no DNS or no internet.

**Fix:** if intentional (air-gapped), set `GOPROXY=off` or `GOPROXY=https://internal-proxy/...`. Otherwise check the network.

### Recipe 8 — `GIT_ASKPASS exited`

A stale `GIT_ASKPASS` env var points to a binary that no longer exists.

**Fix:** `unset GIT_ASKPASS` or set `GIT_ASKPASS=/bin/true` to make `git` fall back to other helpers.

### Recipe 9 — `module declares its path as: X but was required as: Y`

Capitalisation mismatch or a recent rename.

**Fix:** open the dep's `go.mod`. Whatever follows `module` is the canonical path. Use that exact string in your `import` and `require`.

### Recipe 10 — Slow private fetches

A clone takes 30s every time even in CI.

**Fix:** cache `~/go/pkg/mod` between runs. In GitHub Actions:

```yaml
- uses: actions/cache@v4
  with:
    path: |
      ~/.cache/go-build
      ~/go/pkg/mod
    key: go-${{ runner.os }}-${{ hashFiles('**/go.sum') }}
```

After the first run, `go mod download` is a no-op.

---

## Mixing Public and Private

A typical microservice imports both `github.com/acme-corp/auth` (private) and `github.com/google/uuid` (public). The build must:

- Fetch `uuid` through `proxy.golang.org` and verify against `sum.golang.org`.
- Fetch `auth` directly from GitHub, skip the public sumdb.

Configuration:

```bash
go env -w GOPROXY='https://proxy.golang.org,direct'
go env -w GOSUMDB='sum.golang.org'
go env -w GOPRIVATE='github.com/acme-corp/*'
```

That is the entire setup. The toolchain handles the rest.

If you operate an internal proxy (Athens) that proxies *both* public and private:

```bash
go env -w GOPROXY='https://athens.acme.io,direct'
go env -w GOPRIVATE='github.com/acme-corp/*'
```

Athens caches public modules and proxies private ones if you give it the right credentials (senior level).

---

## Pitfalls at Scale

- **Secret rotation.** A 90-day PAT means every CI job touching that org breaks every 90 days unless rotated. Use a service account with a longer-lived deploy key, or automate rotation.
- **Multiple repos with different glob patterns.** A monorepo and a polyrepo with different orgs need their `GOPRIVATE` updated. Document it.
- **Forgotten `replace` directives.** A developer adds `replace github.com/acme/foo => /Users/alice/foo` and pushes by accident. Now CI fails with "directory does not exist." Lint for committed `replace` of local paths.
- **Module renames.** A repo moves orgs (`github.com/old/foo` → `github.com/new/foo`). Old builds keep importing the old path; the upstream sets a 404. Fix `go.mod` *and* every `import` statement.
- **Public mirrors of private repos.** Someone pushes a private repo to a public fork. Now `go.sum` from a previously-private build matches a public mirror's hash. Confusing but not insecure as long as the bytes are identical.

---

## Cheat Sheet

```bash
# Standard private setup, with internal proxy
go env -w GOPROXY='https://athens.acme.io,direct'
go env -w GOPRIVATE='github.com/acme-corp/*'

# CI: HTTPS via PAT injected as URL rewrite
git config --global url."https://x-access-token:${TOKEN}@github.com/".insteadOf "https://github.com/"

# CI: HTTPS via .netrc
echo "machine github.com login x-access-token password ${TOKEN}" > ~/.netrc
chmod 600 ~/.netrc

# CI: SSH
eval "$(ssh-agent -s)"
ssh-add - <<< "${SSH_KEY}"
ssh-keyscan github.com >> ~/.ssh/known_hosts

# Docker BuildKit secret mount
RUN --mount=type=secret,id=netrc,target=/root/.netrc go build ./...

# Inspect resolved values
go env GOPROXY GOSUMDB GOPRIVATE GONOPROXY GONOSUMDB
```

---

## Summary

`GOPRIVATE` is a glob-based switch that affects *routing* (`GONOPROXY`) and *verification* (`GONOSUMDB`). Authentication is `git`'s job — you configure it with `.netrc`, a credential helper, or an SSH key. CI is mostly about injecting that auth non-interactively (via `insteadOf` rewrites or a generated `.netrc`) and caching `~/go/pkg/mod` so subsequent runs do not re-fetch. Most error messages map cleanly to one of routing, auth, or stale state — and once you know which, the fix is mechanical.
