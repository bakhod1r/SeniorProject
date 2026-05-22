# go mod — Hands-on Tasks

Go 1.21+. Each task has explicit acceptance criteria.

---

## Task 1: Create and inspect a module

Initialize a module and read its files.

**Acceptance criteria**
- [ ] `go mod init example.com/lab` creates `go.mod` with a `module` and `go` directive.
- [ ] You can explain what the module path is used for.

---

## Task 2: Add a dependency

Import an external package and tidy.

**Acceptance criteria**
- [ ] Importing `github.com/google/uuid` and running `go mod tidy` adds a `require` line and `go.sum` entries.
- [ ] `go run .` builds using the dependency.
- [ ] `git status` shows `go.mod` and `go.sum` modified.

---

## Task 3: tidy adds and removes

Observe tidy in both directions.

**Acceptance criteria**
- [ ] Removing the import and running `go mod tidy` removes the `require` line.
- [ ] Adding it back and tidying restores it.
- [ ] On a clean tree, `go mod tidy` then `git diff` shows no changes (the cleanliness invariant).

---

## Task 4: Explain the graph

Use `graph` and `why`.

**Acceptance criteria**
- [ ] `go mod graph` prints dependency edges.
- [ ] `go mod why github.com/google/uuid` prints the import chain.
- [ ] `go list -m all` shows the selected version of every module.

---

## Task 5: Verify and download

Exercise integrity and caching commands.

**Acceptance criteria**
- [ ] `go mod download` populates the module cache.
- [ ] `go mod verify` reports all modules verified.
- [ ] You locate the cache at `go env GOMODCACHE`.

---

## Task 6: Local replace for development

Develop against a local copy of a module.

**Acceptance criteria**
- [ ] `go mod edit -replace=example.com/dep=../dep` adds a replace directive.
- [ ] Builds use the local copy.
- [ ] `go mod edit -dropreplace=example.com/dep` removes it; you note why replaces must not be merged.

---

## Task 7: MVS in action

See Minimal Version Selection pick a version.

**Acceptance criteria**
- [ ] Require an old version of a dependency, add another dependency that needs a newer version of the same module, and `go list -m` shows the higher one selected.
- [ ] You explain why MVS chose that version.

---

## Task 8: Vendor a module

Create and use a vendor directory.

**Acceptance criteria**
- [ ] `go mod vendor` creates `vendor/` with dependency sources.
- [ ] `go build -mod=vendor ./...` builds from `vendor/`.
- [ ] After a dependency change, `go mod vendor` keeps it in sync and `git diff vendor` shows the update.
