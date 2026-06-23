# go clean — Hands-on Tasks

Go 1.21+. Each task has explicit acceptance criteria.

---

## Task 1: Preview before cleaning

Use `-n` to see what would happen.

**Acceptance criteria**
- [ ] `go clean -n -cache` prints the would-be removal of `$GOCACHE` without removing it.
- [ ] `go clean -n -modcache` does the same for the module cache.
- [ ] You confirm the caches still exist afterward.

---

## Task 2: Expire the test cache

Force tests to re-run.

**Acceptance criteria**
- [ ] `go test ./...` shows `(cached)` on a second run.
- [ ] `go clean -testcache` then `go test ./...` re-runs everything (no `(cached)`).
- [ ] You contrast this with `go test -count=1`.

---

## Task 3: Find the cache locations

Locate and size the caches.

**Acceptance criteria**
- [ ] `go env GOCACHE` and `go env GOMODCACHE` print their paths.
- [ ] You measure their sizes (`du -sh`).
- [ ] You explain which one usually holds the most data.

---

## Task 4: Reclaim module cache disk

Wipe and re-warm the module cache.

**Acceptance criteria**
- [ ] `go clean -modcache` removes the module cache (no permission errors).
- [ ] `go mod download` re-populates it.
- [ ] `go mod verify` reports all modules verified.

---

## Task 5: Cold-cache build

Verify a build from a cold cache.

**Acceptance criteria**
- [ ] `go clean -cache` empties the build cache.
- [ ] `go build ./...` rebuilds everything (slow first run).
- [ ] An immediate second build is fast again (cache re-warmed).

---

## Task 6: Clean installed artifacts

Remove an installed binary.

**Acceptance criteria**
- [ ] `go install ./cmd/tool` installs a binary.
- [ ] `go clean -i ./cmd/tool` removes the installed artifact for that package.
- [ ] You note there is no general `go uninstall`.

---

## Task 7: Fuzz cache

Clear generated fuzz corpora.

**Acceptance criteria**
- [ ] A fuzz target run (`go test -fuzz=Fuzz -fuzztime=5s`) generates corpus entries.
- [ ] `go clean -fuzzcache` clears the generated cache.
- [ ] You confirm `testdata/fuzz` seed corpora are untouched.

---

## Task 8: Diagnose before cleaning (reflection)

Practice not reaching for clean first.

**Acceptance criteria**
- [ ] Given a "broken build," you first check `go env GOFLAGS GOOS GOARCH`, `go version`, and `go build -x`.
- [ ] You write 2–3 sentences on why a clean that "fixes" a build usually hides the real cause.
