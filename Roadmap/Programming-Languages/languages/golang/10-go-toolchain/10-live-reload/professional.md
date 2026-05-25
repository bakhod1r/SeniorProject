# Live Reload — Professional

## 1. The OS file-system event APIs

Watchers do not poll. They subscribe to **kernel notifications** about FS changes:

| OS | API | Library used by `air`/`fsnotify` |
|----|-----|----------------------------------|
| Linux | `inotify` | `fsnotify` (uses `inotify_init1`, `inotify_add_watch`) |
| macOS / *BSD | `kqueue` | `fsnotify` (uses `kqueue`, `EVFILT_VNODE`) |
| Windows | `ReadDirectoryChangesW` | `fsnotify` (uses the Win32 API) |

All Go watchers in this space — `air`, `reflex`, `watchexec` (in its Go wrapper), `CompileDaemon` — sit on top of `fsnotify` (https://github.com/fsnotify/fsnotify), which is the cross-platform abstraction.

### Limits to internalize

- **`inotify` is per-directory, not recursive.** You must walk and `add_watch` every subdirectory. New subdirectories created at runtime require a fresh `add_watch`. `fsnotify` does this for you, but if you create 10k directories quickly there is a race window.
- **Watch descriptor caps.** Linux defaults are roughly `fs.inotify.max_user_watches = 8192` and `max_user_instances = 128`. A monorepo with `node_modules` blows through this; you must exclude or bump the sysctl.
- **`kqueue` opens an FD per watched file/dir.** Same exhaustion story (`ulimit -n`).
- **Windows coalesces** events at the OS level — fewer notifications, more "something changed in this dir."

---

## 2. Event coalescing and missed events

Two failure modes you should know about:

**Coalescing.** When events arrive faster than user-space drains the queue, the kernel coalesces them (Linux signals `IN_Q_OVERFLOW`; macOS drops). You receive *fewer* events than writes that actually happened, with no detail about which files. Watchers respond by rescanning the directory after an overflow, but during that window you can race a rebuild against an in-progress save.

**Atomic-replace saves.** Vim, IntelliJ, and many editors do not modify the file in place. They write to `foo.go~` and `rename("foo.go~", "foo.go")`. The original inode is destroyed and replaced.

- On Linux, your `inotify` watch was tied to the *original* inode. After the rename, you are watching a deleted inode. Subsequent edits emit **no events**.
- `fsnotify` mitigates this by re-watching on `RENAME`/`REMOVE`, but during that gap an edit can be missed entirely.

Practical consequence: on rare occasions a save does not trigger a rebuild. Save a second time and it will. If it is frequent, tell people to disable atomic-write in their editor or switch to a polling fallback.

---

## 3. When polling is the right answer

Kernel events fail or behave badly in three places:

- **Network/remote file systems** (NFS, SMB, sshfs) — `inotify` only sees changes made locally; remote writes are invisible.
- **Some containerized/overlay file systems** (Docker bind mounts on macOS/Windows are notorious).
- **Very large trees that exceed watch limits.**

Polling is `stat` every file every N ms and diff `mtime`+`size`. `air` does not poll natively; `reflex` does not poll; `watchexec` has `--poll <duration>`. Use polling intervals of 500ms–2s. It is slower and burns CPU but is the only reliable option on macOS Docker bind mounts.

---

## 4. How `air` runs your binary

Conceptually:

```
loop:
    wait for FS event(s)
    debounce delay ms
    if previous child is alive:
        send SIGINT (or build.send_interrupt signal)
        wait kill_delay
        send SIGKILL if still alive
    run `build.cmd` (a shell command) → exit code
    if exit != 0:
        print error, go back to loop
    exec `build.full_bin` (or `build.bin`) as a child process
    capture stdout/stderr to air's stdout
    record pid
```

Key implementation notes:

- The build step is a `sh -c` invocation, not a direct exec of `go build`. So `cmd = "templ generate && go build ..."` works.
- The child is launched in its own process group on Unix (so a single signal can reach grandchildren). `air` calls `syscall.Kill(-pid, sig)`.
- `air`'s own stdout/stderr is interleaved with the child's; that is why you see `[building...]` lines mixed with your `log.Println` output.

---

## 5. Signal-handling contract for your binary

For live reload to be smooth, your binary must:

1. **Install a signal handler** for `SIGINT` (and `SIGTERM` if you want production parity). `signal.NotifyContext` is the canonical pattern.
2. **Close listeners and drain in-flight work** before exiting.
3. **Exit within `kill_delay`** (default `500ms`; raise to `2s`+ if your shutdown is slow).
4. **Return zero exit code on a clean shutdown.** A non-zero exit may make `air` print a confusing error.

```go
ctx, stop := signal.NotifyContext(context.Background(),
    syscall.SIGINT, syscall.SIGTERM)
defer stop()

go run(ctx) // your server loop

<-ctx.Done()                     // first signal
shutdownCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
defer cancel()
srv.Shutdown(shutdownCtx)        // close listeners; wait for handlers
```

If your code calls `log.Fatal` from a goroutine on shutdown noise (e.g., "use of closed connection"), `air` reports a failed build cycle even though everything is fine. Filter expected errors:

```go
if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
    log.Fatal(err)
}
```

---

## 6. Race conditions during rebuild + restart

The classic timing window:

```
t0  edit + save foo.go
t1  air receives event, debounces 200ms
t2  air sends SIGINT to old binary
t3  go build starts (compiling)
t4  old binary's Shutdown() is still draining a slow request
t5  go build finishes; air tries to exec new binary
t6  new binary tries to net.Listen(":8080") → EADDRINUSE because t4 has not finished
```

Mitigations:

- Raise `kill_delay` to be **longer than your max graceful shutdown**.
- Use `SO_REUSEPORT` so the new binary can bind while the old is still draining.
- Reduce graceful-shutdown latency in dev (shorter `Shutdown` timeout in dev builds).
- Build to a **temporary path** then `rename` over the final path so partial-build executables cannot be launched. `air` does this implicitly by writing to `tmp/` then exec'ing the new file.

Another race: a build error leaves the *old* binary running. Some teams want "always run latest", others want "keep last good binary running while errors are fixed." `air`'s `stop_on_error = true` chooses the first; `false` chooses the second.

---

## 7. Watch-descriptor exhaustion on Linux

If you suddenly see:

```
inotify: instance limit reached
```

or `fsnotify` errors with `no space left on device` on a system that has plenty of disk, you have hit the watch cap. Inspect and raise:

```bash
sysctl fs.inotify.max_user_watches
sysctl fs.inotify.max_user_instances
sudo sysctl -w fs.inotify.max_user_watches=524288
sudo sysctl -w fs.inotify.max_user_instances=512
# persist in /etc/sysctl.d/99-inotify.conf
```

Excluding `node_modules`, `.git`, and build output is still the right first step — bumping the limit is a backstop.

---

## 8. Performance: what dominates a reload cycle

Profile a single reload by enabling timestamps:

```toml
[log]
  time = true
```

A typical breakdown on a medium project (cold cache excluded):

| Stage | Time |
|-------|------|
| Debounce | 200ms |
| `go build` (incremental, warm cache) | 250ms |
| Signal + graceful shutdown of old proc | 100ms |
| Process exec + Go runtime init | 30ms |
| App `main()` until listener bound | 50ms |
| **Total wall time** | **~630ms** |

Anything above ~1s feels sluggish. The leverage points are: narrow `go build` scope (single package), `CGO_ENABLED=0`, `-buildvcs=false`, and lazy-init expensive subsystems.

---

## 9. Summary

Live reload is a watcher + build + supervise loop on top of OS-specific FS-event APIs (`inotify`, `kqueue`, `ReadDirectoryChangesW`), abstracted by `fsnotify`. Know the failure modes: event coalescing, atomic-replace saves losing watches, watch-descriptor caps, and remote/bind-mount filesystems needing polling. Your binary's side of the contract is signal handling + graceful shutdown within `kill_delay`; the watcher's side is correct debounce, restart ordering, and stable temp-path build outputs. The races that surface in production-quality dev loops are all about *when* the old process actually frees its resources — design for that and reloads stay invisible.

---

## Further reading
- `fsnotify`: https://github.com/fsnotify/fsnotify
- `inotify(7)`: https://man7.org/linux/man-pages/man7/inotify.7.html
- `kqueue(2)` on macOS: https://developer.apple.com/library/archive/documentation/Darwin/Conceptual/FSEvents_ProgGuide/
- `tableflip` (zero-downtime restart): https://github.com/cloudflare/tableflip
- `SO_REUSEPORT`: https://lwn.net/Articles/542629/
