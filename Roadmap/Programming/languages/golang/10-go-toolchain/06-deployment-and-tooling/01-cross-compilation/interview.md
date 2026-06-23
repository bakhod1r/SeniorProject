# Cross-compilation — Interview Q&A

A mix of conceptual and practical questions, labeled by level. Answers are concise; expand with examples in a real interview.

---

## Junior

**Q1. What is cross-compilation in Go?**
Building an executable for an operating system or CPU architecture different from the host. In Go you set `GOOS` and `GOARCH` before `go build`, e.g. `GOOS=linux GOARCH=amd64 go build -o app .`.

**Q2. Why is cross-compiling easy in Go compared to many other languages?**
The standard Go installation ships compilers, assemblers, and a linker that already target every supported port. For pure-Go code you do not need a separate SDK or external toolchain per platform.

**Q3. How do you list all supported targets?**
`go tool dist list` prints every valid `GOOS/GOARCH` pair the current Go installation supports.

**Q4. You ran `GOOS=linux GOARCH=amd64 go build -o app .` on macOS, then `./app` failed with "exec format error". What happened?**
Not a bug. You produced a Linux ELF binary; the macOS kernel can't execute it. Run it on a Linux host or inside a container.

---

## Middle

**Q5. What does `CGO_ENABLED=0` change, and why is it important for cross-compiling?**
It forces pure-Go implementations of packages that would otherwise use cgo (notably `net` and `os/user`). The result is a static binary that does not depend on the target's libc, and you do not need a C cross-compiler to build it. It is the default switch for clean cross-builds.

**Q6. Difference between using a build tag and checking `runtime.GOOS` at run time?**
Build tags (`//go:build linux` or filename suffixes like `_windows.go`) decide which files are *compiled* for the target — necessary when code uses platform-only imports or syscalls. `runtime.GOOS` is a compile-time constant you can branch on at run time without affecting what gets compiled; use it for cosmetic differences (logging, banner strings), not to gate imports.

**Q7. You set `GOOS=js GOARCH=wasm` and built `app.wasm`. The browser cannot load it. What is missing?**
The `wasm_exec.js` loader script. Copy it from `$(go env GOROOT)/lib/wasm/wasm_exec.js` (or `misc/wasm/wasm_exec.js` on older Go) and reference it from your HTML.

**Q8. How would you avoid one cross-build overwriting another in a multi-target script?**
Encode the target in the output name: `-o app-$GOOS-$GOARCH` (plus `.exe` on Windows). Conventional shape: `<name>-<goos>-<goarch>[.exe]`.

---

## Senior

**Q9. When should you cross-compile vs build inside a target-arch container with `docker buildx`?**
Cross-compile for pure-Go programs — it's faster, more reproducible, and avoids QEMU. Use `buildx`/QEMU/native ARM runners when the build itself needs the target arch: cgo with C cross-toolchain pain, target-arch tests, or distro-specific glibc constraints. A common hybrid: cross-compile Go in a `--platform=$BUILDPLATFORM` stage, then `COPY` the binary into a target-arch base image.

**Q10. How do you make a cross-build byte-reproducible across two runners?**
Use `-trimpath -buildvcs=false -ldflags="-s -w -buildid="`, pin the toolchain via `go.mod`'s `toolchain` directive, and keep `CGO_ENABLED=0`. Then `sha256sum` of the output should match on independent builders.

**Q11. How would you cross-compile a cgo program from Linux/amd64 to Linux/arm64 without setting up a full cross GCC?**
Use `zig` as the C cross-compiler: `CC="zig cc -target aarch64-linux-musl"` `CXX="zig c++ -target aarch64-linux-musl"` with `CGO_ENABLED=1 GOOS=linux GOARCH=arm64 go build`. Linking against musl yields a static binary not tied to host glibc.

**Q12. What is `GOAMD64=v3` and when would you set it?**
A minimum-microarchitecture level for amd64 (v1=baseline, v2≈Nehalem, v3≈Haswell+AVX2, v4=AVX-512). Setting it lets the compiler emit newer instructions for performance, but the binary will `SIGILL` on older CPUs. Set it only when you control the deployment hardware.

---

## Professional

**Q13. Why is cgo cross-compilation fundamentally harder than pure-Go cross-compilation?**
The Go toolchain provides the Go compiler, assembler, and linker for all targets, but not a C compiler or system linker. cgo requires both: a target-correct C compiler to build the `.c`/`.cgo` translation units, and the external system linker to combine Go and C objects. That toolchain has to be installed and configured per target, with matching ABI and sysroot.

**Q14. Where in the Go source tree are supported platforms defined, and how does the runtime select per-OS code?**
The authoritative table lives in `src/cmd/dist/build.go` (also surfaced by `go tool dist list -json`). The runtime selects per-OS / per-arch files by filename build constraints (`os_linux.go`, `signal_windows.go`, `defs_linux_arm64.go`) and `//go:build` lines. There is no per-target SDK — there are per-target source files in one tree.

**Q15. The team needs SLSA-level provenance for cross-compiled artifacts. What does that change about the build?**
Builds must be hermetic and reproducible: pinned toolchain, deterministic flags (`-trimpath`, `-buildvcs=false`, cleared build IDs), no network during build (vendored or hashed-locked module cache), and a trusted CI runner that signs the build's provenance (e.g., GitHub OIDC + Sigstore cosign). The artifact, its checksum, and an attestation describing inputs are published together; consumers verify the attestation, not the binary alone.

---

## Common traps

- Forgetting `CGO_ENABLED=0` and getting a dynamically-linked binary that won't run on a `scratch`/distroless image.
- Running the cross-built binary on the host and treating "exec format error" as a build bug.
- Using `runtime.GOOS` to try to gate `import` statements — only build tags do that.
- Building several targets to the same `-o app` filename and overwriting the previous output.
- Building for `GOARCH=arm` without setting `GOARM` and getting a binary that won't run on the target's FPU class.
- Setting `GOAMD64=v3` and shipping to an old VM that lacks AVX2 — `SIGILL` at startup.
- Using `@latest` toolchains or unpinned `go` versions in CI and breaking reproducibility.
- Treating `docker buildx --platform` as the only option and paying for QEMU emulation when a pure-Go cross-compile would have worked.
- Forgetting that `js/wasm` and `wasip1/wasm` are different targets with different runners.
- Cross-compiling cgo without a target C toolchain and getting `gcc: error: unrecognized command-line option '-m64'` or similar host-toolchain errors.
