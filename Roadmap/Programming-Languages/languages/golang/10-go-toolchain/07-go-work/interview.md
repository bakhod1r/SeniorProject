# go work — Interview Q&A

A mix of conceptual and practical questions, labeled by level. Answers are concise; expand with examples in a real interview.

---

## Junior

**Q1. What does `go work` do, in one sentence?**
It creates a local overlay (`go.work`) that lets one `go` command build, test, and run against multiple modules on disk as if they were a single project.

**Q2. Which Go version added workspaces?**
Go 1.18. Before that, the only way to develop two related modules in parallel was a `replace` directive in `go.mod`.

**Q3. What command creates a workspace from two existing modules?**
`go work init ./mod-a ./mod-b`. It writes a `go.work` file in the current directory listing both modules under `use` directives.

**Q4. What goes in a `.gitignore` for a developer-local workspace?**
```
go.work
go.work.sum
```
Workspaces describe your local disk layout, so they should not be committed (unless your team has explicitly decided to commit one for a monorepo).

---

## Middle

**Q5. How does `go.work` interact with `replace` directives in member `go.mod` files?**
When a workspace is active, `replace` directives in member `go.mod` files are ignored for paths the workspace covers via `use`. The workspace's own `replace` (if any) and `use` directives win.

**Q6. What does `go work sync` do?**
It computes the workspace's resolved module versions via MVS across all members and writes those versions back into each member's `go.mod` `require` lines. It does not add new requires — it only realigns existing ones.

**Q7. How do you temporarily disable the workspace for one command?**
`GOWORK=off go test ./...`. This makes `go` behave as if no `go.work` existed, building against the published versions in each `go.mod`.

**Q8. Why is `go work` cleaner than `replace ../sibling` in `go.mod`?**
The workspace lives in a separate, gitignored file, so the redirect never reaches `go.mod` history or downstream consumers. With `replace` you have to remember to remove it before publishing; with a workspace there is nothing to remove.

---

## Senior

**Q9. You added a dependency to one workspace module. Why is `go work sync` important?**
Inside the workspace, MVS picked a single version for that dependency across all members. Without `sync`, the *other* members' `go.mod` files still pin older versions; they would build fine in the workspace (because MVS upgrades them) but fail or diverge when built standalone (without `GOWORK=off`-style isolation in CI).

**Q10. How should CI handle a committed `go.work` in a monorepo?**
Run two passes: (1) the integrated build (`go test ./...` with the workspace) catches workspace-wide regressions; (2) a per-module build with `GOWORK=off` catches "this module won't build for its published consumers because the workspace was hiding a missing require." Skipping the second pass is a common monorepo bug.

**Q11. Why run `go mod tidy` with `GOWORK=off`?**
`tidy` operates on one module and would otherwise see the workspace's merged graph. With workspace on, it might add or remove requires based on workspace-resolved state instead of what the module truly needs standalone. `GOWORK=off go mod tidy` keeps each `go.mod` honest from a published-world standpoint.

**Q12. When should you commit `go.work` to source control?**
When the repo itself is the build unit — a monorepo where every member module lives in the same repo at known paths and CI uses the workspace as the integrated test target. Never commit one that references `../sibling-repo` paths; those leak host-specific assumptions.

---

## Professional

**Q13. What does `go install example.com/cmd/foo@latest` do when a workspace is active, and why?**
It ignores the workspace. `@version` installs must be reproducible from the module proxy regardless of any developer's local state, so the toolchain deliberately bypasses workspace overlays for these invocations. `go install ./cmd/foo` (no `@`), in contrast, builds from local source and respects the workspace.

**Q14. What is `go.work.sum` for, and when can it bite you?**
It holds checksums for modules introduced by the workspace beyond what any single member's `go.sum` covers (typically because MVS across the union of members elevated a version). If you delete the workspace and rebuild against per-module `go.sum` alone, you may need `go mod download` to refetch checksums that only lived in `go.work.sum`.

**Q15. How does `gopls` use `go.work`?**
On finding a `go.work` (by walking up from the open file), `gopls` loads every member as a single workspace view, enabling cross-module Go-to-Definition, Find References, and Rename without configuration. Committing `go.work` in a monorepo gives every contributor this for free.

---

## Common traps

- Committing a `go.work` that references `../neighbor-repo` (works on your machine only).
- Letting CI silently use a committed `go.work` and failing to verify each module with `GOWORK=off`.
- Forgetting `go work sync` after upgrading a dep in one member; standalone builds drift from the workspace.
- Running `go mod tidy` with workspace on and then committing the resulting `go.mod`.
- Expecting `go install path@version` to honor the workspace — it never does, by design.
- Treating `go.work.sum` as noise and gitignoring only `go.work`; if you commit `go.work` you should commit `go.work.sum` too.
- Keeping old `replace ../sibling` directives in `go.mod` alongside a workspace — pick one mechanism, not both.
- Having two `use` directives that resolve to the same module path (load error).
- Assuming downstream consumers see your workspace `replace` — they never do (workspaces are local).
