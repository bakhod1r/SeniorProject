# 8.21 `path` and `path/filepath` — Interview

> **Audience.** Both sides of the table. Questions are tagged by
> level. Strong answers are concrete: they reference the right
> function, name the trade-off, and show awareness of the cross-
> platform and security dimensions.

## Junior

### Q1. When do you use `path` vs `path/filepath`?

`path` is for slash-separated logical paths: URLs, import paths,
S3 keys, ZIP entries. It always uses `/` as the separator. `filepath`
is for filesystem paths and uses the host OS separator (`/` on
Unix, `\` on Windows). Mixing them breaks code on Windows.

### Q2. What does `filepath.Join("a/", "/b/", "c")` return?

`"a/b/c"`. `Join` cleans the result, collapsing consecutive
separators and resolving `.` and `..` components. This is why
`Join` is the right tool — string concatenation with `+ "/" +`
doesn't normalize.

### Q3. What's wrong with `os.Open("./uploads/" + userInput)`?

Path traversal. If `userInput` is `"../../etc/passwd"`, the result
opens `/etc/passwd`. Defenses: `filepath.IsLocal(userInput)` to
reject unsafe paths, then `filepath.Join("./uploads", userInput)`.
For Go 1.24+, `os.OpenRoot("./uploads")` plus `root.Open(userInput)`
is the strongest because the kernel enforces the boundary.

### Q4. Difference between `filepath.Walk` and `filepath.WalkDir`?

`WalkDir` (Go 1.16+) is faster because it doesn't `stat` every
entry — `fs.DirEntry` provides `IsDir()` and `Name()` from the
directory listing itself. `Walk` calls `Lstat` on every entry.
For large trees, `WalkDir` is 2–5× faster. Use `WalkDir` for new
code.

### Q5. What does `filepath.SkipDir` do?

Returned from a walk callback, it tells the walker to skip the
remaining contents of the current directory. If the current entry
is a directory, skip its contents. If it's a file, skip the rest
of the parent's contents. It's how you exclude `node_modules` or
`.git` from a recursive search without `stat`-ing every file inside.

## Middle

### Q6. How would you implement a recursive file finder that excludes hidden directories?

```go
err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
    if err != nil { return err }
    if d.IsDir() && strings.HasPrefix(d.Name(), ".") && d.Name() != "." {
        return filepath.SkipDir
    }
    if !d.IsDir() {
        // process file
    }
    return nil
})
```

`SkipDir` on the directory prevents `WalkDir` from even reading
its contents. The check `d.Name() != "."` keeps the root itself
walkable.

### Q7. What does `filepath.Glob("**/*.go")` return?

Empty slice. `Glob` doesn't support `**` (recursive). The pattern
matches files at exactly one level. For recursive globbing, use
`WalkDir` with a `Match` check or `filepath.Ext` check per entry.
Third-party libraries (`doublestar`) implement `**`.

### Q8. Why might `os.Open(filepath.Join(base, name))` succeed when you expected an error?

If `name` is `../../etc/passwd`, `Join` resolves the `..`s textually,
producing a path that escapes `base`. If the resulting file exists
and is readable, `Open` succeeds. The bug is in the trust model:
the code assumed `Join` was safe, but `Join` is purely lexical and
provides no security guarantee. `filepath.IsLocal` is the right
pre-check.

### Q9. What's `filepath.EvalSymlinks` for, and what does it do with a symlink loop?

It resolves all symlinks in a path and returns the real, canonical
path. For a symlink loop (`A → B → A`), it gives up after ~40
levels and returns an error like `too many levels of symbolic
links`. Use cases: checking whether two paths refer to the same
file, sanitizing user input, finding the actual location of a
binary invoked via a symlink.

### Q10. How does `filepath.Rel` handle paths where one is not under the other?

It produces a path with `..` components. `Rel("/home/alice",
"/home/bob/x")` returns `"../bob/x"`. The contract: `Join(base,
result)` produces (after cleaning) the target. The function only
fails when one path is absolute and the other is relative, or when
the paths are on different drives (Windows).

### Q11. What's `filepath.IsLocal` and what does it protect against?

A Go 1.20+ check: returns true if a path is safe to join with a
base directory without escaping. It rejects absolute paths, paths
with escaping `..` components, empty paths, and Windows reserved
names (CON, PRN, etc.). It's the modern, platform-correct version
of the prefix-check defenses we used to write by hand.

## Senior

### Q12. Walk me through a safe archive extractor. What can go wrong?

The class of attacks is "Zip Slip" — entries with `..` in their
paths escape the destination. Defenses:

1. Validate each entry name with `filepath.IsLocal` before joining.
2. After `Join`, verify the result is still under the destination
   with a prefix check.
3. Reject symlinks and hardlinks (they can point outside).
4. Use `O_CREATE | O_EXCL` to prevent overwriting (matters if
   pre-existing symlinks already point outside).
5. Cap per-file size with `io.CopyN` to prevent zip-bombs.
6. For Go 1.24+, do all extraction through `os.OpenRoot(dest)` so
   the kernel enforces the boundary.

A real-world extractor must also handle: file permissions, modtimes,
sparse files, character encoding of names. The defenses above are
the security-critical subset.

### Q13. Why is `WalkDir` faster than `Walk` and when isn't it?

`WalkDir` uses `os.ReadDir`, which returns `[]os.DirEntry` from a
single `getdents` syscall. The entries carry name and type
information that's already in the kernel buffer — no extra `stat`
per entry. `Walk` calls `os.Lstat` for every entry, doubling the
syscall count.

The advantage shrinks when the callback needs `os.FileInfo` for
every entry (e.g., for size, permissions). Calling `d.Info()` on a
`DirEntry` triggers the same `Lstat`, removing the win.

For walks that only care about names and types (the common case),
`WalkDir` is 2–5× faster. For walks that need full file info on
every entry, the two are equivalent.

### Q14. How would you implement a concurrent file processor that walks a tree and runs CPU-heavy work on each file?

Single producer (the walker), N consumers (the workers), a
bounded channel for backpressure:

```go
work := make(chan string, runtime.NumCPU())
g, ctx := errgroup.WithContext(ctx)
g.Go(func() error {
    defer close(work)
    return filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
        if err != nil { return err }
        if d.IsDir() { return nil }
        select {
        case work <- path: return nil
        case <-ctx.Done(): return ctx.Err()
        }
    })
})
for i := 0; i < runtime.NumCPU(); i++ {
    g.Go(func() error {
        for p := range work {
            if err := process(p); err != nil { return err }
        }
        return nil
    })
}
return g.Wait()
```

The bounded channel is critical: without it, the walker outpaces
the workers and the memory footprint blows up. With it, the walker
blocks until a worker is free.

### Q15. What's the relationship between `filepath.WalkDir` and `io/fs.WalkDir`?

`io/fs.WalkDir` is the abstract version that works with any
`fs.FS`. `filepath.WalkDir` is the concrete OS version that uses
`os` directly. Internally, `filepath.WalkDir` is equivalent to
`fs.WalkDir(os.DirFS(""), root, fn)` — but it's optimized to avoid
the `os.DirFS` indirection.

For testable code, write functions that accept `fs.FS` and call
`fs.WalkDir`. For top-level entry points that touch the real
filesystem, use `filepath.WalkDir`.

### Q16. What's `os.OpenRoot` and why does it matter?

Go 1.24+ added `os.OpenRoot(path)`, which returns a `*os.Root`
that scopes all subsequent file operations to a directory tree.
Operations on `Root` (e.g., `root.Open(name)`) use the `openat2`
syscall on Linux with `RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS`,
meaning the **kernel** enforces that the access doesn't escape
the root — even via symlinks that were maliciously placed inside.

It's the strongest path-traversal defense available in the stdlib.
For any service that handles user-supplied paths, this should be
the default approach.

## Professional

### Q17. Your service handles file uploads and a security audit flags the path-traversal pattern. You're on Go 1.22 (pre-`OpenRoot`). What do you do?

Layered defenses:

1. Reject paths with `filepath.IsLocal` before any filesystem call.
2. Use `filepath.Clean` plus a `strings.HasPrefix` check against
   the destination base.
3. For `tar`/`zip` extraction, additionally reject symlinks and
   hardlinks at the metadata level.
4. Use `O_CREATE | O_EXCL` flags to refuse overwrite.
5. Drop privileges at the OS level: run the extractor as a
   restricted user, mount the upload directory `noexec` and
   `nosuid`.
6. Plan the upgrade to Go 1.24+ for `os.OpenRoot`.

In an audit response, list the defenses with code line references.
A single "we use `filepath.Clean`" isn't enough.

### Q18. You're indexing a 100M-file filesystem and the walk takes 2 hours. How do you investigate?

1. Profile: is it CPU or I/O bound? `go tool pprof` on a CPU
   profile shows the answer.
2. If I/O bound: measure stat-per-entry vs entries-per-directory-
   read. A network filesystem typically dominates here. The fix
   is parallelism — concurrent readers per subtree.
3. If CPU bound: look for hot frames. Common culprits: `filepath.Join`
   in tight loops, sort overhead in `os.ReadDir`, allocation from
   `Info()` calls.
4. Reduce work: `filepath.SkipDir` for directories you don't care
   about. `WalkDir` instead of `Walk`. Avoid calling `d.Info()` if
   `Type()` is enough.
5. Cache: persist the previous walk's metadata and use mod-times
   to detect changes incrementally.

For very large trees, the right answer is often "don't walk —
maintain an index". The walk becomes a one-time bootstrap; updates
come from inotify or filesystem journals.

### Q19. Your CI runs on Linux but a Windows user reports the build fails. How do you debug path issues?

Most common causes:

1. Hardcoded `/` in string concatenation. Search for `"/"` in path-
   building code; replace with `filepath.Join` or `filepath.Separator`.
2. `path` vs `filepath` mix-up. Functions like `path.Join` produce
   `/`-separated strings that may fail on Windows.
3. Case-sensitivity. Linux is case-sensitive; Windows isn't. Code
   that does `if name == "FILE.TXT"` is fragile.
4. Reserved names: `CON`, `NUL`, `COM1` cannot be filenames on
   Windows. If your tool creates files from user input, sanitize.
5. Long paths: 260-character limit without long-path prefix.

Run `go vet` with a `GOOS=windows` build tag, or run the full test
suite with `GOOS=windows` (compile-only check) as part of CI.

### Q20. Design a watch-directory daemon that processes new files. What primitives?

For "good enough" cross-platform, polling:

- `time.NewTicker(5 * time.Second)` for cadence.
- `filepath.WalkDir` per tick to enumerate.
- Compare against the previous state (path → modtime+size).
- Emit `Create`, `Modify`, `Remove` events.

For low-latency real-time:

- `github.com/fsnotify/fsnotify` (wraps inotify, FSEvents,
  ReadDirectoryChangesW).
- Subscribe to the root; receive events from the OS.
- Fallback to a polling layer for robustness (events can be missed
  on macOS in particular).

The choice depends on latency requirements and dependency
constraints. Polling is correct, robust, simple — and pays a CPU
cost per tick. Notification is fast, fragile, and requires a
non-stdlib dependency.

## Bonus

### Q21. What does `filepath.Ext(".bashrc")` return?

`".bashrc"`. `Ext` returns from the last `.` onward, including the
`.`. For files whose name starts with `.` and has no other `.`,
the entire name is the "extension". This is rarely useful; for
"file extension excluding leading dot of hidden file" you need to
write a custom helper.

### Q22. What's the difference between `filepath.Clean("")` and `path.Clean("")`?

Both return `"."`. The empty string is treated as "current
directory". This is a frequent source of confusion — code that
expects `Clean("")` to remain empty must special-case it.

### Q23. What does `os.OpenRoot` do that the older `filepath.Clean + HasPrefix` cannot?

Two things. First, it uses `openat2(RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS)`
on Linux, which means the kernel rejects symlink escapes — even
TOCTOU races where the attacker creates a symlink after your check
but before your open. Second, it composes naturally with
`fs.Sub`-like patterns: every operation on the `*Root` value is
scoped, so you can't forget the check.

The lexical defenses (`Clean`, `HasPrefix`) are subject to:

- Race conditions (the path is checked, then opened separately).
- Symlinks created after the check.
- Filesystem-level quirks (e.g., Windows long-path normalization).

`os.OpenRoot` collapses all of these into a single kernel-enforced
boundary.

### Q24. What does `filepath.Localize("a/b")` return on Windows?

`"a\\b"` (with the OS separator). `Localize` converts a portable
"io/fs"-style path (always `/`) to the host's native separator.
Useful when reading paths from a config file or archive entry and
converting to filesystem operations.

`Localize` also enforces safety: it returns an error for paths
that contain `..` or are absolute. Combined with `IsLocal`, it's
the modern way to go from portable input to safe local path.
