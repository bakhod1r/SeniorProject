# Publishing Go Modules — Optimization

> Honest framing first: the act of "publishing" a Go module is not a CPU-bound operation you can speed up. `git tag v1.4.2 && git push --tags` runs in well under a second; the proxy pulls the tag asynchronously; consumers fetch on demand. There is nothing to micro-tune in the publish step itself.
>
> What *is* worth optimizing is the release-engineering pipeline around it: the CI gates that catch breakage before a tag is cut, the artifacts produced, the velocity at which versions ship, the discoverability of new releases on `pkg.go.dev`, the size of the published archive, and the deprecation runway you give consumers when something has to go away. These decisions, made in your release pipeline, dominate the lived experience of every downstream user — and the on-call burden of every maintainer.
>
> Each entry below states the problem, shows a "before" setup, an "after" setup, and the realistic gain.

---

## Optimization 1 — Automate releases with GoReleaser

**Problem:** Hand-rolled release scripts produce inconsistent archives, forget checksums, miss platforms, and silently drift between maintainers. Every release becomes a manual ceremony where small mistakes (wrong `ldflags`, missing `darwin/arm64`, no SHA256 file) leak to consumers.

**Before (`release.sh`):**
```bash
#!/usr/bin/env bash
GOOS=linux  GOARCH=amd64 go build -o dist/mycli-linux  ./cmd/mycli
GOOS=darwin GOARCH=amd64 go build -o dist/mycli-darwin ./cmd/mycli
tar czf dist/mycli.tar.gz dist/mycli-*
gh release create "$1" dist/mycli.tar.gz
```
No checksums, no `arm64`, no reproducibility, no Homebrew tap, no signed artifacts.

**After (`.goreleaser.yaml`):**
```yaml
builds:
  - id: mycli
    main: ./cmd/mycli
    goos:   [linux, darwin, windows]
    goarch: [amd64, arm64]
    ldflags:
      - -s -w -X main.version={{.Version}} -X main.commit={{.Commit}}
    flags: [-trimpath]
checksum:
  name_template: 'checksums.txt'
  algorithm: sha256
release:
  github:
    owner: acme
    name:  mycli
```
Triggered from CI on any `v*` tag.

**Gain:** Every release ships the same matrix, with checksums, reproducible flags, and a populated GitHub release page. Maintainer time per release drops from "an hour and three Slack messages" to "push a tag."

---

## Optimization 2 — Pre-flight CI gates on every PR, not at tag time

**Problem:** If `go test`, `govulncheck`, license scanning, and breaking-change detection only run when a release is cut, every issue surfaces under release-day pressure. Tags get reverted, retracted, or — worse — left broken.

**Before:** A single `release.yml` workflow on tag push runs everything for the first time. Half the time, a vulnerability or a license violation forces a panic re-tag.

**After (`.github/workflows/pr.yml`):**
```yaml
on: { pull_request: { branches: [main] } }
jobs:
  preflight:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-go@v5
        with: { go-version: '1.23', cache: true }
      - run: go test -race ./...
      - run: go vet ./...
      - run: go install golang.org/x/vuln/cmd/govulncheck@latest && govulncheck ./...
      - run: go install github.com/google/go-licenses@latest && go-licenses check ./...
      - run: go install golang.org/x/exp/cmd/gorelease@latest && gorelease -base=$(git describe --tags --abbrev=0)
```
By the time a tag exists, every gate has been green for at least one PR cycle.

**Gain:** Release-day surprises drop near zero. Most release rollbacks are caused by gates that should have failed on a PR a week earlier.

---

## Optimization 3 — Isolate releases on a release branch

**Problem:** Releasing directly off `main` means every long-running feature branch is implicitly part of the next release. Hotfixes for `v1.x` collide with `v2.x` work in progress, and you cannot ship a patch without dragging in unrelated commits.

**Before:** Tag whatever `main` happens to be at 3pm Friday. Pray.

**After:**
```
main                      ──●──●──●──●──●──●─→  (active development)
                             │
release/v1                   └──●──●──●         (only fixes cherry-picked here)
                                    │
                                    v1.4.2 tag
```
Release branches receive only cherry-picked, audited commits. New features stay on `main` until the next minor.

**Gain:** Patch releases ship in minutes, contain only what's intended, and never accidentally include half-merged refactors. The cost is one extra cherry-pick per fix — paid back many times over the first time you need an emergency patch.

---

## Optimization 4 — Prefer many small releases over rare big ones

**Problem:** "We'll batch this for the next big release" is the most expensive sentence in module maintenance. Big releases concentrate risk, surface dozens of changes at once, and force consumers into long, painful upgrades. Bisecting a regression across 400 commits is its own punishment.

**Before:**
- One `v1.5.0` per quarter, each carrying 200+ commits.
- Every release is a multi-day stabilisation effort.
- Consumers skip versions because each upgrade is too risky.

**After:**
- A `v1.x.y` patch every week or two, a `v1.x.0` minor every few weeks.
- Each release contains a small, reviewable diff.
- Consumers upgrade routinely because the cost per upgrade is low.

**Gain:** Mean time to resolve a reported bug drops sharply (you can ship the fix tomorrow, not in eight weeks). Consumer trust rises because upgrades stop being scary. Regressions become bisectable in minutes.

**Caveat:** "Small and frequent" requires the CI gates from Optimization 2 to be solid. Frequent releases on flaky CI is just frequent breakage.

---

## Optimization 5 — Trigger `pkg.go.dev` indexing immediately after a tag

**Problem:** New tags can take minutes to hours to appear on `pkg.go.dev`. The proxy only fetches a version when *something* asks for it. If no one fetches your new tag, no one sees the new docs, and your release announcement points to a 404.

**Before:** Push tag, post to Slack, watch confused users report "the new version isn't on pkg.go.dev."

**After (CI step that runs after a successful release):**
```yaml
- name: Warm pkg.go.dev
  env:
    GOPROXY: https://proxy.golang.org
    GONOSUMCHECK: "0"
  run: |
    mkdir -p /tmp/warm && cd /tmp/warm
    go mod init warm
    go get github.com/acme/mycli@${{ github.ref_name }}
    curl -fsSL "https://proxy.golang.org/github.com/acme/mycli/@v/${{ github.ref_name }}.info"
    curl -fsSL "https://pkg.go.dev/github.com/acme/mycli@${{ github.ref_name }}" > /dev/null
```
A single `go get` is enough to register the version with the module proxy and trigger doc indexing.

**Gain:** Docs are live within seconds of the release announcement instead of "eventually." Users following along see the new version on the badge immediately.

---

## Optimization 6 — Pre-generate offline godoc for air-gapped consumers

**Problem:** Some consumers cannot reach `pkg.go.dev` (regulated networks, offline sites, internal-only enterprise builds). They need the same docs locally and currently scrape them by hand.

**Before:** Tell them "run `go doc` locally" and apologise. Examples and rendered markdown are missing entirely.

**After (release artifact):**
```yaml
- name: Build offline docs
  run: |
    go install golang.org/x/pkgsite/cmd/pkgsite@latest
    pkgsite -static ./docs-static &
    sleep 3
    wget -mk -e robots=off -P dist/docs http://localhost:8080/github.com/acme/mycli
    tar czf dist/docs-${{ github.ref_name }}.tar.gz -C dist/docs .
- name: Attach to release
  uses: softprops/action-gh-release@v2
  with:
    files: dist/docs-${{ github.ref_name }}.tar.gz
```
Now every release includes a `docs-vX.Y.Z.tar.gz` that users can serve from any static host.

**Gain:** Enterprise consumers stop filing doc-access tickets. The artifact is small (typically a few hundred KB) and produced once per release.

---

## Optimization 7 — Nightly compatibility tests against the latest published version

**Problem:** Your library may be green on `main`, but the *published* version may have started failing against a new Go release, a new dependency version, or a new platform. You only find out when a user reports it.

**Before:** No scheduled job. Latest published version is "definitely fine, last we checked, six weeks ago."

**After (`.github/workflows/nightly.yml`):**
```yaml
on:
  schedule: [ { cron: '0 5 * * *' } ]
jobs:
  compat:
    strategy:
      matrix:
        go: ['1.21.x', '1.22.x', '1.23.x', 'stable', 'tip']
        os: [ubuntu-latest, macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/setup-go@v5
        with: { go-version: ${{ matrix.go }} }
      - run: |
          mkdir t && cd t && go mod init t
          go get github.com/acme/mycli@latest
          go build ./...
          go test github.com/acme/mycli/...
```
Failures alert the maintainer team automatically.

**Gain:** Regressions are caught against published artifacts, on real platforms, at most a day late instead of by an angry user a month late.

---

## Optimization 8 — Auto-generate `CHANGELOG.md` from PR labels

**Problem:** Hand-written changelogs drift, omit entries, or get written under release-day stress. Consumers either skip the upgrade or ask "what changed?" in an issue.

**Before:** Maintainer writes the changelog from `git log` 30 minutes before tagging. Half the entries say "misc fixes."

**After (`.github/release.yml`):**
```yaml
changelog:
  categories:
    - title: Breaking changes
      labels: [breaking-change]
    - title: New features
      labels: [feat, enhancement]
    - title: Bug fixes
      labels: [fix, bug]
    - title: Documentation
      labels: [docs]
    - title: Internal / CI
      labels: [chore, ci]
  exclude:
    labels: [skip-changelog]
```
Combined with a PR-template requirement that every PR carry exactly one of these labels, the GitHub release notes (and a committed `CHANGELOG.md` via a small script) are generated automatically.

**Gain:** Changelogs are complete, categorised, and free. Consumers can skim a release page in seconds and decide whether to upgrade.

---

## Optimization 9 — Compute the next version from commit messages

**Problem:** Picking the next version number by hand invites disagreement ("is this a minor or a patch?") and is one more thing for the release-day brain to track. SemVer rules are mechanical; humans should not be the ones applying them.

**Before:** Maintainer eyeballs the commits, guesses, and types `git tag v1.4.2`.

**After (Conventional Commits + `semantic-release` or `git-cliff`):**
```yaml
- name: Compute next version
  id: ver
  run: |
    npx --yes semantic-release --dry-run --no-ci \
      --plugins '@semantic-release/commit-analyzer' \
      --branches main | tee semrel.log
    echo "next=$(grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' semrel.log | head -1)" >> $GITHUB_OUTPUT

- name: Tag and release
  if: steps.ver.outputs.next != ''
  run: |
    git tag ${{ steps.ver.outputs.next }}
    git push origin ${{ steps.ver.outputs.next }}
```
A `feat:` commit bumps the minor; a `fix:` bumps the patch; `BREAKING CHANGE:` in the footer bumps the major.

**Gain:** No more arguments about version numbers. SemVer becomes a property of how you write commits, which is also how you ought to be writing them.

---

## Optimization 10 — Cache the module cache across release CI runs

**Problem:** Release pipelines often spawn many parallel jobs (one per OS/arch matrix entry, plus a separate publish job). Each one re-downloads the dependency graph from scratch, costing minutes of release-day wall-clock time.

**Before:**
```yaml
- uses: actions/setup-go@v5
  with: { go-version: '1.23' }
# no cache; every matrix entry pays the full download cost
```

**After:**
```yaml
- uses: actions/setup-go@v5
  with:
    go-version: '1.23'
    cache: true
    cache-dependency-path: '**/go.sum'
- run: go mod download
```
For self-hosted runners or non-GitHub CI, mount a persistent volume at `${GOMODCACHE:-$(go env GOMODCACHE)}` and `${GOCACHE:-$(go env GOCACHE)}`.

**Gain:** Multi-platform release jobs that previously took 12–15 minutes finish in 4–6 minutes on warm cache. The release feedback loop becomes short enough to iterate on.

---

## Optimization 11 — Per-module tag pipelines in multi-module repos

**Problem:** In a multi-module monorepo, a single `release.yml` triggered on every tag will rebuild and re-release *every* module on every tag, or worse, build the wrong one. Tags also have to be namespaced — `mod1/v1.2.0` is not the same as `mod2/v1.2.0`.

**Before:**
```yaml
on:
  push:
    tags: ['v*']     # ambiguous in a multi-module repo
```

**After:**
```yaml
on:
  push:
    tags:
      - 'api/v*'
      - 'worker/v*'
      - 'shared/v*'
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - id: route
        run: |
          MODULE="${GITHUB_REF_NAME%%/*}"
          VERSION="${GITHUB_REF_NAME#*/}"
          echo "module=$MODULE"   >> $GITHUB_OUTPUT
          echo "version=$VERSION" >> $GITHUB_OUTPUT
      - run: cd ${{ steps.route.outputs.module }} && goreleaser release --clean
```
Each module has its own pipeline keyed off its own tag prefix.

**Gain:** Releases of unrelated modules stop interfering, parallel releases become possible, and the proxy receives correct per-module tag paths.

---

## Optimization 12 — Trim the published archive (`testdata`, `_examples`, CI files)

**Problem:** Every byte in your repo at tag time ends up in the `.zip` the proxy serves to every consumer. Large `testdata/`, `_examples/`, vendored experiments, screenshots, and CI workflow files inflate downloads for users who only need the library code.

**Before (`go mod download` of your module pulls 18 MB):**
```
mymod/
  pkg/                  // 400 KB of actual library
  testdata/golden/      // 14 MB of fixtures
  _examples/            // 3 MB of demos with their own deps
  .github/workflows/    // CI yaml the consumer doesn't need
  docs/screenshots/     // PNGs
```

**After:**
- Move bulky `testdata/` into a separate, gitignored cache, or fetch fixtures at test time.
- Keep `_examples/` as its own module (`_examples/go.mod`) — Go ignores subtrees with their own `go.mod`.
- Add a `.gitattributes` `export-ignore` for items that shouldn't ship if you produce source archives separately.
- Use `go mod why -m` and `go list -m -f '{{.Dir}}'` to confirm what's actually in the archive served by the proxy.

A leaner module that pulls 600 KB instead of 18 MB respects every consumer's CI cache, network, and disk.

**Gain:** Smaller `go get` for every consumer, faster cold builds, and an honest signal of what the module actually contains.

---

## Optimization 13 — A real deprecation policy with timeline and tooling

**Problem:** Removing an API "because no one should be using it anymore" breaks downstream users who never received a warning. They open angry issues, downgrade, and lose trust. SemVer alone does not communicate intent over time.

**Before:** Function is removed in `v2.0.0` with a one-line changelog entry. Users discover the removal at upgrade time.

**After (deprecation runway):**

1. **Mark in code** with a `// Deprecated:` comment that `gopls`, `staticcheck`, and `pkg.go.dev` all surface:
   ```go
   // Deprecated: use ParseContext instead. Will be removed in v2.0.0.
   func Parse(s string) (*Doc, error) { ... }
   ```
2. **Announce in `CHANGELOG.md`** under a "Deprecated" section as soon as the deprecation lands.
3. **Wait at least one minor release cycle** (often two) before removal. State the removal version explicitly.
4. **Offer migration tooling** when feasible: a `gofix`-style rewriter, a script in `_examples/migrate/`, or a documented `sed` recipe.
5. **In the removal release**, link back to the deprecation announcement and the migration guide from the changelog.

**Gain:** Consumers get warnings in their editor, in `staticcheck`, and on `pkg.go.dev` long before anything breaks. The removal release becomes a non-event because everyone has already migrated.

---

## Benchmarking and Measurement

Optimization without measurement is folklore. For release-engineering work the most useful signals are:

```bash
# Time from tag push to "live on pkg.go.dev"
git push origin v1.4.2
# (start a stopwatch; the warm-up step in Optimization 5 should make this < 60 s)

# Size of the published archive a consumer actually downloads
curl -sI "https://proxy.golang.org/github.com/acme/mycli/@v/v1.4.2.zip" | grep -i content-length

# Wall-clock time of the full release pipeline
gh run list --workflow=release.yml --limit 10 --json conclusion,createdAt,updatedAt

# Adoption: how quickly do consumers move to a new version?
# Track this informally via GitHub Insights → Dependents over time.

# Nightly compat health: how often does the latest published version fail against tip?
gh run list --workflow=nightly.yml --limit 30 --json conclusion
```

Track these numbers before and after each change. If a "fix" does not move them measurably, it was not a fix.

---

## When NOT to Optimize

- **Pre-1.0 library with three users:** ship `v0.x.y` by hand, write the changelog yourself, do not invest in GoReleaser, semantic-release, or nightly matrices yet. The infrastructure outweighs the benefit.
- **Internal-only module behind a private proxy:** skip the `pkg.go.dev` warm-up and the offline docs artifact entirely.
- **One-shot migration tool that will be archived next quarter:** a deprecation policy is overkill; a deprecation *commit* is enough.
- **Hobby project with no CI budget:** prefer GoReleaser's free GitHub Actions integration and stop there. A nightly matrix across five Go versions and three OSes is a lot of minutes for very few users.
- **The publish step itself:** it is already free. Optimize the pipeline that leads up to it and the experience it produces for consumers.

---

## Summary

Publishing a Go module is a single `git push --tags` away. Its real cost is everything that surrounds the tag: the gates that should have caught problems on a PR, the artifacts that should ship alongside the release, the changelog and version number that should be computed for you, the proxy and indexer that should be warmed within seconds, the consumers who deserve a deprecation runway, and the nightly probe that should catch regressions before they do. Get those right and releases become routine — small, safe, frequent, and boring. Get them wrong and every release becomes a meeting. Optimize the pipeline, not the push.
