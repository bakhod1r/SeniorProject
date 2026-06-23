# `go mod init` — Junior Level

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
> Focus: "What is a Go module?" and "How do I start one?"

Every real Go project — even the smallest "hello world" you intend to push to GitHub — begins with a single command:

```bash
go mod init example.com/hello
```

That command does only one visible thing: it creates a tiny text file in the current directory named `go.mod`. Inside is something like:

```
module example.com/hello

go 1.22
```

That is it. No source code, no folders, no configuration mountain. But this little file changes everything about how Go treats your project. Before this file existed, your folder was just "a folder with `.go` files in it." After this file exists, your folder is a **module** — a unit Go can build, version, depend on, and share with the world.

After reading this file you will:
- Understand what a Go module is and why it exists
- Know what `go mod init` does and what it doesn't do
- Be able to choose a sensible module path
- Read every line of a fresh `go.mod` file
- Know when to run `go mod init` (and when not to)
- Recover from the most common first-day mistakes

You do **not** need to know about dependencies, versions, replacement directives, or vendoring yet. Those come later. This file is about the moment you press Enter and Go says "ok, this is now a module."

---

## Prerequisites

- **Required:** A Go installation (1.16 or newer; modules are the default since 1.16). Check with `go version`.
- **Required:** A terminal and basic comfort with `cd`, `ls`, `mkdir`, `pwd`.
- **Required:** Knowing what a directory is and how to navigate to one.
- **Helpful:** A GitHub (or other VCS) account, because module paths are usually built from a repository URL — but a real account is not needed today.
- **Helpful but not required:** Having written and compiled at least one `.go` file with `go run`. This file assumes you have at least seen Go source code.

If `go version` prints something like `go version go1.22.x darwin/arm64`, you are ready. If it errors, install Go from [go.dev/dl](https://go.dev/dl/) before continuing.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Module** | A collection of related Go packages versioned together as a single unit. The unit Go ships, depends on, and tags. |
| **Module path** | The canonical name of a module — usually a URL-shaped string like `github.com/alice/cooltool`. Used to import the module's packages. |
| **`go.mod`** | The text file at the root of a module. Declares the module path, the Go version, and the dependencies. |
| **`go.sum`** | Sister file to `go.mod` that records cryptographic hashes of every dependency for reproducible, tamper-proof builds. Created automatically when you add dependencies — `go mod init` does not create it. |
| **Package** | A directory of `.go` files with the same `package` clause. The smallest thing you can `import`. |
| **Import path** | The string after `import "..."`. For your own packages, it is `<module path>/<sub-folder>`. |
| **GOPATH** | The legacy way Go organised code (one giant workspace under `$HOME/go/src/...`). Replaced by modules. You can mostly ignore it now. |
| **`go.mod` directive** | A line in `go.mod` that begins with a keyword like `module`, `go`, `require`, `replace`, `exclude`. |
| **VCS** | Version Control System — Git, Mercurial, etc. The module path conventionally encodes the VCS host and repository. |
| **Module root** | The directory that contains the `go.mod` file. Everything below it is part of the module unless another `go.mod` is nested inside. |

---

## Core Concepts

### A module is just "a folder with a `go.mod` in it"

There is no magic. A module is a directory tree whose root contains a `go.mod` file. That is the entire definition. Move the folder, and you have moved the module. Delete the `go.mod`, and the module is gone — the folder reverts to just being a folder.

### `go mod init <path>` writes that file for you

You could write `go.mod` by hand. The two-line minimum is trivial:

```
module github.com/alice/hello

go 1.22
```

But `go mod init` does it for you, picks a sensible Go version line, and verifies the module path is plausible. That is its entire job. Everything else (`require`, `go.sum`, downloading dependencies) happens later, mostly automatically.

### The module path matters more than you think

The module path is **the name your code is known by everywhere**. If your module is `github.com/alice/hello`, then:

- Inside a sub-folder `greet/`, the import path of that package is `github.com/alice/hello/greet`.
- Anyone who wants to use your module writes `import "github.com/alice/hello"` in their code.
- The Go toolchain expects to be able to reach that path over the network if it needs to download the module.

Pick the module path carefully — changing it later means editing every import in every project that depends on you. We will come back to this in Best Practices.

### `go mod init` is a one-time event

You run `go mod init` once per module, on the day you create it. After that, you almost never touch `go.mod` directly — `go get`, `go mod tidy`, and the compiler edit it for you.

If you ever find yourself running `go mod init` a second time on the same directory, something has gone wrong. (We will cover the recovery path in Edge Cases & Pitfalls.)

### What `go mod init` does NOT do

- It does **not** create source files. No `main.go`, no `cmd/`, nothing.
- It does **not** create folders. The directory you run it in is the only one touched.
- It does **not** download anything from the network.
- It does **not** create `go.sum`. That file appears later, when you have dependencies.
- It does **not** initialise a Git repository. `go mod` and `git` are independent.

---

## Real-World Analogies

**1. A street address.** A module path is like the postal address of a building. The building exists physically, but until it has an address, you cannot tell anyone where to find it. `go mod init` paints the address on the door.

**2. The cover page of a book.** Imagine a manuscript in a folder. It has chapters (packages) and pages (`.go` files). `go mod init` is writing the title page: "This is *The Hello Module*, by Alice, 2024 edition." Now the manuscript can be catalogued and cited.

**3. A barcode on a product.** A grocery item is just a bag of beans until it has a barcode. The barcode is unique, scannable, traceable. The module path is the barcode of your code — that is how Go's package proxy looks it up, downloads it, caches it.

**4. Registering a company name.** You can do business out of your kitchen, but until you register a business name, no bank or supplier will deal with you. `go mod init` is the registration step. Your code can now appear in dependency graphs.

---

## Mental Models

### Model 1 — `go.mod` is a small declaration of identity

The first line — `module <path>` — is a self-declaration: "I am known as this." Everything else in `go.mod` is bookkeeping. The module path is the identity.

### Model 2 — Modules are nested namespaces

Your module is a subtree of the global Go namespace. The root of that subtree is the module path, and every package inside is reached by suffixing a folder name. There is exactly one root per module — never two.

### Model 3 — `go.mod` is the contract; `go.sum` is the receipt

`go.mod` says *what* you depend on (names and version constraints). `go.sum` says *what you actually got* (cryptographic fingerprints of the bytes). Today, with `go mod init`, you only have the contract. The receipts come later.

### Model 4 — Modules are immutable in spirit, mutable in practice

Once you publish version 1.0.0 of your module, the contents of that version should never change. The version is the bytes. `go mod init` creates the *first* version of a module — the one in your working directory — and from that point on each tagged release is supposed to be a frozen artifact.

---

## Pros & Cons

### Pros

- **Zero ceremony to start.** One short command produces a working module. No config wizard.
- **Reproducible builds.** Once `go.mod` and `go.sum` exist, anyone with the same versions of Go and your code gets the same compiled output.
- **No GOPATH headaches.** You can keep your code anywhere. No magic directories required.
- **Plays well with Git.** `go.mod` and `go.sum` are tiny text files designed to be committed and diffed.
- **Self-documenting dependency graph.** Reading `go.mod` tells you exactly what a project consumes.

### Cons

- **The module path is hard to change later.** You commit to it on day one and live with the choice.
- **A wrong module path silently works for a while** — until you try to publish or `go get` it. Then it fails confusingly.
- **Beginners often confuse "module" with "package"** and produce structures that compile but read strangely.
- **`go mod init` does nothing visible**, which makes new users wonder if it worked.

The pros vastly outweigh the cons. The cons are mostly avoidable by following naming conventions.

---

## Use Cases

You should run `go mod init` when:

- **Starting a new application.** Any new CLI, web service, or program with a `main` package.
- **Starting a new library.** Any reusable package you intend to share.
- **Starting a new prototype or experiment.** Even a throwaway script benefits from being a module — `go run` works inside one without surprises.
- **Joining a folder of `.go` files that has no `go.mod` yet.** (Rare today, but you may inherit a legacy GOPATH-style codebase.)
- **Splitting a sub-folder into its own module.** (Advanced; covered in [middle.md](middle.md).)

You should **not** run `go mod init` when:

- The current directory already contains a `go.mod` file. The command will refuse.
- You are inside a sub-folder of an existing module and just want a new package. Just create a sub-folder with `.go` files — that is enough.
- You are inside an existing module and want to "modularise" a sub-folder. That is a deliberate sub-module decision; it has consequences. Do not do it accidentally.

---

## Code Examples

### Example 1 — Minimal hello module

```bash
mkdir hello
cd hello
go mod init example.com/hello
```

Resulting `go.mod`:

```
module example.com/hello

go 1.22
```

That is a complete, valid Go module. Add a `main.go`:

```go
package main

import "fmt"

func main() {
    fmt.Println("hello, world")
}
```

Then:

```bash
go run .
```

Output:

```
hello, world
```

Notice you ran `go run .`, not `go run main.go`. The `.` means "the package in the current directory," and Go knows what package that is because of `go.mod`.

### Example 2 — Module on GitHub

```bash
mkdir cooltool
cd cooltool
go mod init github.com/alice/cooltool
```

`go.mod`:

```
module github.com/alice/cooltool

go 1.22
```

Now if you have a sub-folder `greet/greet.go`:

```go
package greet

import "fmt"

func Hello(name string) {
    fmt.Println("hello,", name)
}
```

You can use it from `main.go` at the module root:

```go
package main

import "github.com/alice/cooltool/greet"

func main() {
    greet.Hello("Alice")
}
```

The import path is `<module path>/<folder>`. Always.

### Example 3 — Module with a hyphenated name

```bash
go mod init github.com/alice/web-tool
```

`go.mod`:

```
module github.com/alice/web-tool

go 1.22
```

The module path can contain hyphens — but the **package name** inside Go source still has to be a valid Go identifier (no hyphens). So inside `web-tool` your `main.go` is still `package main`, and a sub-folder `pretty-print/` would have to declare `package prettyprint` (or any valid identifier) inside its `.go` files.

### Example 4 — Throwaway local module

If you never plan to publish:

```bash
go mod init scratch
```

`go.mod`:

```
module scratch

go 1.22
```

This works locally. Other people cannot `go get` your module (`scratch` is not a URL), and you cannot use it as a dependency in another project unless you `replace` it. But for personal experiments it is fine.

### Example 5 — Just looking at what changed

```bash
$ ls
$ go mod init example.com/hello
go: creating new go.mod: module example.com/hello
$ ls
go.mod
$ cat go.mod
module example.com/hello

go 1.22
```

That is the entire state change.

---

## Coding Patterns

### Pattern: One module, one repository

A single Git repository contains a single `go.mod` at the root. This is the default and the path of least resistance. Tools, IDEs, and CI assume this layout. Do not deviate without a reason.

### Pattern: Import-path-equals-folder-path

If your module is `github.com/alice/cooltool`, and you have a folder `internal/cache/`, the import path is exactly `github.com/alice/cooltool/internal/cache`. Always. There is no aliasing at the module level. Resist creating mental indirection.

### Pattern: Run `go mod init` from a fresh, empty folder

The cleanest workflow:

```bash
mkdir mything
cd mything
go mod init github.com/me/mything
git init
git add go.mod
git commit -m "init module"
```

Then start adding code. Doing it in this order avoids the next-most-common bug: `go.mod` written with the wrong path because someone ran the command from the wrong folder.

### Pattern: Module path as future URL

Even if you have not created the GitHub repository yet, choose the module path *as if* you had. This way, when you do push to GitHub, nothing has to change in `go.mod`. Future-you will thank present-you.

---

## Clean Code

- **The module path should match the canonical URL of the repository.** `github.com/alice/cooltool`, not `Cool-Tool` or `cooltool` or `cool_tool`.
- **Lowercase only.** Mixed-case module paths technically work but cause platform-portability headaches (Windows and macOS have case-insensitive filesystems by default; Linux does not).
- **No trailing slash.** Never `github.com/alice/cooltool/`.
- **No `.git` suffix.** Never `github.com/alice/cooltool.git`. The Go tools strip it but it looks unprofessional.
- **Pick a meaningful name.** `github.com/alice/util` is a poor choice; `github.com/alice/csvkit` is better.

A good module path is short, all lowercase, hyphenated when needed, and matches the repository URL.

---

## Product Use / Feature

When you ship software professionally:

- The module path appears in your **import statements** (engineers see it).
- It appears in your **published binaries' debug info** (`runtime/debug.ReadBuildInfo`).
- It appears in **error messages** when builds fail.
- It appears in **proxy logs** when users download the module from `proxy.golang.org`.
- It is part of your **public identity** as a project.

Treat the module path the same way you would treat a brand name — chosen once, used everywhere, hard to rebrand.

---

## Error Handling

`go mod init` itself rarely fails, but here are the failure modes a junior will see:

### "go: cannot determine module path for source directory"

You ran `go mod init` with no argument inside a folder that does not look like a known repository. Fix: provide an explicit path:

```bash
go mod init github.com/alice/mything
```

### "go.mod already exists"

You ran `go mod init` twice. Fix: either accept the existing file (do nothing), or — if you need to change the path — open `go.mod` in an editor and change the first line manually. Do not delete `go.mod` to "start over" if you already have dependencies.

### "malformed module path"

You included characters that are not allowed (uppercase domain, spaces, etc.). Fix: use lowercase letters, digits, dots, hyphens, and forward slashes only.

### "missing dot in first path element"

You wrote `go mod init mything` — no domain. Go assumes that means a *local-only* module. This is fine for experiments but warns you that it is not a network-resolvable name. Choose `example.com/mything` if you want a namespace without going public yet. (`example.com` is a reserved domain that will never collide with anything real.)

---

## Security Considerations

- **The module path is public if you publish.** Do not encode secrets, internal hostnames, or company-confidential identifiers into the module path. It will end up in dependency lists, build logs, and possibly the public Go module proxy.
- **Avoid typosquatting risk.** A module path that closely matches a popular project (`github.com/golamg/...` instead of `github.com/golang/...`) invites user confusion and supply-chain attacks. Choose distinctive names.
- **Internal-only modules need an internal-looking path.** If your company runs a private proxy, use `corp.example.com/team/repo`, not `github.com/...`.
- **`go mod init` does not authenticate.** It is a local file-creation operation. No credentials are exchanged. So nothing leaks at this step — the leaks happen later when you push the repository.

---

## Performance Tips

- `go mod init` finishes in milliseconds. There is nothing to tune.
- The cost of a *bad* module path is later — every `go get` of your module pays a network round-trip to a path that may not exist or may be ambiguous. Choose well now to spend nothing later.
- A module that is split into too many sub-modules (advanced topic) will pay a coordination cost. Default to one module per repository.

---

## Best Practices

1. **Always specify the module path explicitly.** Do not rely on auto-detection. `go mod init github.com/alice/thing` is clearer than bare `go mod init`.
2. **Match the path to the repository.** If GitHub, use `github.com/<user>/<repo>`. If GitLab, `gitlab.com/<group>/<repo>`. Self-hosted? Use the canonical hostname.
3. **Lowercase only.** Always.
4. **Pick a name a stranger could pronounce.** `csvkit` beats `cs8k`; `httpclient` beats `httpclnt`.
5. **Run `go mod init` before writing code, not after.** Every minute you write `.go` files without a `go.mod` is a minute spent with a tooling experience that is slightly worse.
6. **Commit `go.mod` immediately.** Even if it is only two lines.
7. **Do not nest modules unless you mean to.** A sub-folder with its own `go.mod` is a separate module. This is occasionally what you want, but never accidentally.

---

## Edge Cases & Pitfalls

### Pitfall 1 — Running it from a parent folder

```bash
cd ~/projects        # NOT inside the project!
go mod init github.com/alice/hello
```

You just turned `~/projects` into a module. Every existing project below it is now a sub-folder of one giant unintended module. **Always `cd` into the target directory first.**

### Pitfall 2 — Picking a name you cannot push to

Naming your module `github.com/alice/hello` when no such repository exists is fine *today*. But the moment you try to publish, you must create exactly that repository. Mismatched names produce runtime download errors with messages like "could not find module" — at the time someone else tries to use your code.

### Pitfall 3 — Re-running `go mod init` after dependencies exist

If your `go.mod` already lists `require` lines, running `go mod init` again will error out. Good. If you delete `go.mod` and re-run, you will lose the dependency list and the version pins. Bad. Just edit the first line of `go.mod` instead.

### Pitfall 4 — Whitespace in folder paths

The module path itself cannot contain spaces. Folder paths on disk can — `/Users/alice/My Projects/hello` is fine. Just make sure the module path argument is quoted only if your shell needs it (it usually does not).

### Pitfall 5 — Modules inside Git submodules

A Git submodule that contains its own `go.mod` is its own Go module. The Go toolchain does not look "up the tree." This is rarely a problem but surprises people who expected one big module.

### Pitfall 6 — The Go version line

The `go 1.22` line is not just decoration — it is a *minimum* Go version for the module's source. If you write code using a feature added in Go 1.21 (like `min`/`max`), the line should be at least `go 1.21`. `go mod init` picks the version of the tool you used; if you upgrade later, run `go mod tidy` to keep the directive sensible.

---

## Common Mistakes

- **Not running `go mod init` at all.** Trying to use `go run`, `go build`, or import packages without it. This used to "kind of work" via GOPATH; it does not anymore.
- **Choosing a single-word name.** `go mod init hello` works, but the name is local-only. Future-you cannot publish `hello` — there is no domain for it. Use `github.com/<user>/hello` even if `<user>` is a placeholder.
- **Putting the module path in CamelCase.** `go mod init github.com/Alice/Hello` works on macOS, breaks on Linux, confuses Windows. Always lowercase.
- **Running `go mod init` and immediately running `go mod tidy`.** Tidy is for when you have dependencies. With a fresh init, there is nothing to tidy. Harmless but unnecessary.
- **Manually editing the `go` directive** to a version that is newer than the installed toolchain. The build will fail with a confusing version-mismatch error.
- **Editing `go.mod` to remove the `go` directive.** It is required.
- **Adding files outside the module root and expecting them to be importable.** Only `.go` files in folders *under* the module root are part of the module.

---

## Common Misconceptions

> *"`go.mod` lists my packages."*

No. `go.mod` lists your **dependencies** and the **module path**. Your packages are detected automatically by walking the directory tree.

> *"I have to use GitHub for the module path."*

No. The module path is just a string. It conventionally looks like a URL because Go's default proxy expects to find it on the public internet, but for local-only or company-internal modules any consistent path works (use `replace` directives in consumers).

> *"I can rename a module by editing one line."*

You can edit the `module` line of `go.mod`, yes — but every project that depends on the old name still depends on the old name. Renames are coordinated, breaking changes.

> *"`go mod init` is just for libraries."*

It is for **everything** in modern Go: applications, libraries, scripts, plugins, prototypes. If it has a `.go` file, it lives in a module.

> *"The `go.sum` file is part of `go mod init`."*

`go.sum` does not exist after `go mod init`. It appears the first time you add a dependency.

---

## Tricky Points

- **The `go` directive enforces source compatibility, not toolchain version.** `go 1.22` means "this code uses features no older than Go 1.22"; it does not pin you to that exact toolchain.
- **The implicit module path of a sub-folder is *not* the module's path.** A folder `pkg/cache/` inside module `github.com/alice/foo` has *import* path `github.com/alice/foo/pkg/cache`. There is no separate module path.
- **`example.com` is special.** It is reserved by IANA and will never resolve to a real server, so it is safe to use as a placeholder module path forever.
- **A module path is case-sensitive at lookup time.** Even if your filesystem is not. So `github.com/Alice/Repo` and `github.com/alice/repo` are different modules to the Go proxy.
- **`go mod init` does not validate that the network path exists.** You can type a typo and the file gets written anyway. Errors only appear later.

---

## Test

Try this quick test in a scratch folder.

```bash
mkdir mod-test
cd mod-test
go mod init example.com/test
ls
cat go.mod
```

Expected: `go.mod` exists, contains two non-blank lines (`module ...` and `go 1.x`), and nothing else.

Now answer:
1. What happens if you run `go mod init example.com/test` again? (Answer: error — file exists.)
2. What does `go run .` print if there is no `.go` file? (Answer: error — no Go files.)
3. What is the import path of a sub-folder named `greet`? (Answer: `example.com/test/greet`.)

---

## Tricky Questions

**Q1.** I ran `go mod init` and there is no `go.sum`. Did the command fail?

A. No. `go.sum` is created when you add dependencies (run `go get` or `go mod tidy` after importing something external). A fresh module has no dependencies, so no `go.sum`.

**Q2.** Can I have two `go.mod` files in the same folder?

A. No. One folder, one `go.mod`. They can be in *different* folders; that creates two modules.

**Q3.** I created `go.mod` by hand, with the right two lines. Do I still need to run `go mod init`?

A. No. The command is just a convenience. A correctly formatted hand-written file is equally valid.

**Q4.** Can the module path be `123.com/me`?

A. Yes — module paths must contain at least one dot in the first component, but pure-numeric domain names are legal. Practical advice: use a real-looking hostname, even if hypothetical.

**Q5.** What is the difference between `go mod init mod` and `go mod init example.com/mod`?

A. `mod` is a *single-segment* path with no dot. Go treats it as a local-only module — it will compile, but other modules cannot resolve it from the network. `example.com/mod` is a *URL-shaped* path that any tool can in principle resolve.

**Q6.** I deleted `go.mod` and re-ran `go mod init`. Did I lose anything?

A. Yes — the entire dependency list (`require` lines), version pins, and `replace` directives that may have existed. Recovering them means re-running `go get` for each, which is tedious. Always **edit** `go.mod`, never delete it.

**Q7.** Should I commit `go.mod` to git?

A. **Yes, always.** And commit `go.sum` once it appears. They are part of the source code.

**Q8.** What happens if my `go` directive says `go 1.22` but the user's toolchain is `go 1.20`?

A. Their build fails with a version-mismatch error. The `go` line in `go.mod` is a *minimum* required Go version.

---

## Cheat Sheet

```bash
# Start a new module
go mod init github.com/alice/cooltool

# Inspect the file
cat go.mod

# What's the current module path?
go list -m

# Print the entire module graph (just the module, no deps yet)
go mod graph

# After init, add code, then tidy
go mod tidy
```

```
go.mod minimum content:
    module <path>
    go     <version>
```

| Symptom | Likely Cause |
|---------|-------------|
| `go.mod already exists` | Already a module. Edit, don't re-init. |
| `cannot determine module path` | Run with explicit path argument. |
| `malformed module path` | Lowercase, no spaces, valid characters only. |
| Imports in your own code don't resolve | Module path doesn't match folder structure. |

---

## Self-Assessment Checklist

You can move on to [middle.md](middle.md) when you can:

- [ ] Explain in one sentence what `go mod init` does
- [ ] Read a `go.mod` file and explain every line
- [ ] Choose a sensible module path for a new project
- [ ] Explain the difference between a module path and a package name
- [ ] Explain why module paths are URL-shaped
- [ ] Recognise the four common error messages from `go mod init`
- [ ] Recover from accidentally running `go mod init` with the wrong path
- [ ] Decide between a local-only path and a public path
- [ ] Explain why `go.sum` is not created by `go mod init`
- [ ] Predict the import path of a sub-folder given the module path

---

## Summary

`go mod init <path>` creates a `go.mod` file in the current directory and writes two lines into it: the module path (the canonical name) and the Go version directive. That is the entire mechanical effect.

Conceptually, the command turns a directory into a Go module — a versionable, dependency-graph-aware unit of Go code. The module path you choose lives forever in import statements, build artifacts, and dependency graphs; spend ten seconds picking it well.

Run it once per module, before writing code. Commit `go.mod` to version control. Trust the toolchain for the rest.

---

## What You Can Build

After learning this:

- **A "hello world" module** ready to push to GitHub.
- **A small CLI tool** with sub-packages organised under your module path.
- **A scratchpad project** for experiments, with no plan to publish.
- **A starter skeleton** that someone else can clone and build with two commands (`git clone && go build`).

You cannot yet:
- Add third-party dependencies (next: 6.1.2 `go mod tidy`)
- Vendor dependencies for offline builds (later: 6.1.3 `go mod vendor`)
- Publish your module so others can import it (later: 6.2.3)

---

## Further Reading

- [Go Modules Reference](https://go.dev/ref/mod) — official, authoritative, dense.
- [The `go.mod` File](https://go.dev/ref/mod#go-mod-file) — every directive explained.
- [Tutorial: Create a Go module](https://go.dev/doc/tutorial/create-module) — official walkthrough.
- [Go Modules: A Beginner's Guide](https://go.dev/blog/using-go-modules) — short blog series.

---

## Related Topics

- [6.1.2 `go mod tidy`](../02-go-mod-tidy/junior.md) — what to run after you start using imports
- [6.1.3 `go mod vendor`](../03-go-mod-vendor/junior.md) — offline-friendly dependency copies
- [6.2.1 Package Import Rules](../../02-packages/01-package-import-rules/junior.md) — how imports inside a module are resolved
- [6.2.3 Publishing Modules](../../02-packages/03-publishing-modules/junior.md) — sharing your module with the world
- 11.1.5 `go mod` — the full `go mod` subcommand reference

---

## Diagrams & Visual Aids

```
A module is a folder with a go.mod at the root:

    cooltool/                ← module root
    ├── go.mod               ← declares: module github.com/alice/cooltool
    ├── main.go              ← package main
    ├── greet/               ← sub-folder
    │   └── greet.go         ← package greet
    └── internal/
        └── store/
            └── store.go     ← package store

Import paths derive from the module path + folder path:

    Folder                  Import path
    ----------------------- -------------------------------------------
    cooltool/               github.com/alice/cooltool
    cooltool/greet/         github.com/alice/cooltool/greet
    cooltool/internal/store github.com/alice/cooltool/internal/store
```

```
go mod init lifecycle:

    [empty folder]
          │
          │   go mod init <path>
          ▼
    [folder + go.mod]    ← you are here
          │
          │   write some .go files, add imports
          ▼
    [folder + go.mod + .go files]
          │
          │   go mod tidy
          ▼
    [folder + go.mod + go.sum + .go files]    ← real project
```

```
Module path anatomy:

    github.com/alice/cooltool
    └────┬───┘ └─┬─┘ └──┬───┘
       host   user    repo
       (VCS)  (org)  (module name)
```
