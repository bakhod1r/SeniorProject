# go work — Hands-on Tasks

Work through these in order. Each has explicit acceptance criteria. Use Go 1.21+.

---

## Task 1: Create two modules and join them with `go work init`

Lay out two minimal modules:

```
workspace/
  mod-a/   go.mod (module example.com/mod-a) + a.go exporting Greet()
  mod-b/   go.mod (module example.com/mod-b) + main.go importing example.com/mod-a
```

Run `go work init ./mod-a ./mod-b` from `workspace/`.

**Acceptance criteria**
- [ ] `workspace/go.work` exists and contains both `use` directives.
- [ ] `go run ./mod-b` from `workspace/` prints the greeting from `mod-a`.
- [ ] Neither `mod-a/go.mod` nor `mod-b/go.mod` contains a `replace` directive.

---

## Task 2: Edit one module and confirm the other sees the change immediately

Change the string returned by `Greet()` in `mod-a/a.go`. Do not publish, do not run `go mod` anything.

**Acceptance criteria**
- [ ] `go run ./mod-b` shows the new string on the very next run.
- [ ] `mod-b/go.mod` is unchanged (`git diff` empty).
- [ ] You can explain in one sentence why the workspace made this work without a `replace`.

---

## Task 3: Sync the workspace

Add a dependency (e.g., `github.com/google/uuid`) to `mod-a` via `go get` from inside `mod-a/`. Then run `go work sync` from `workspace/`.

**Acceptance criteria**
- [ ] `mod-a/go.mod` now requires `github.com/google/uuid` at the version you fetched.
- [ ] After `go work sync`, if `mod-b` already requires `uuid` (add it first), its version is realigned to match the workspace's resolved version.
- [ ] You verified that `sync` did **not** add `uuid` to a module that did not require it.

---

## Task 4: Use `GOWORK=off` to test the published-only path

From `workspace/`, run `mod-b` with workspace disabled.

**Acceptance criteria**
- [ ] `GOWORK=off go run ./mod-b` fails (or builds against the published `mod-a` if any) because the local edit is now invisible.
- [ ] `go env GOWORK` (without the override) prints the path to your `go.work`.
- [ ] `GOWORK=off go env GOWORK` prints `off`.

---

## Task 5: Migrate from `replace` to workspace

Start a fresh scenario where `app/go.mod` contains `replace example.com/lib => ../lib`. Migrate it to a workspace.

**Acceptance criteria**
- [ ] You delete the `replace` line from `app/go.mod`.
- [ ] You create a workspace covering `app` and `lib` (`go work init ./app ./lib`).
- [ ] `go test ./...` from the workspace root still passes.
- [ ] `GOWORK=off go test ./app/...` fails *because* the published `lib` lacks the change — confirming the workspace was doing the redirect.

---

## Task 6: Gitignore `go.work` for personal use

Make the workspace developer-local.

**Acceptance criteria**
- [ ] `workspace/.gitignore` (or each repo's `.gitignore`) includes `go.work` and `go.work.sum`.
- [ ] `git status` shows no `go.work` as a candidate to commit.
- [ ] A teammate cloning the repos without `go.work` can still build each module standalone (`go build ./...`).

---

## Task 7: Ensure CI ignores the workspace

Add a CI step that builds each module standalone, even if a contributor accidentally commits `go.work`.

**Acceptance criteria**
- [ ] The CI script sets `GOWORK=off` for every `go build`/`go test` invocation that targets a single module.
- [ ] Locally, `GOWORK=off go test ./...` inside each module reproduces what CI does.
- [ ] You wrote a one-sentence comment in the CI file explaining *why* `GOWORK=off` is set.

---

## Task 8: Use `-r` to onboard a monorepo

Place three modules under `monorepo/services/{a,b,c}`. From `monorepo/`, run `go work init && go work use -r .`.

**Acceptance criteria**
- [ ] `go.work` lists all three services with no manual paths typed.
- [ ] Adding a new module `services/d` and re-running `go work use -r .` adds it without touching the existing entries.
- [ ] `go work edit -dropuse=./services/c` removes one cleanly.

---

## Task 9: Prove `go install path@version` ignores the workspace

In the workspace, modify `mod-a` so `Greet()` returns `"workspace edit"`. Then install `mod-a`'s binary form (if any) via `go install example.com/mod-a@latest` (or a real public module you control).

**Acceptance criteria**
- [ ] The installed binary reflects the **published** version, not your workspace edit.
- [ ] `go install ./mod-a` (no `@version`) from inside the workspace *does* reflect the edit.
- [ ] You can articulate why this asymmetry is by design (`@version` must be reproducible from the proxy).
