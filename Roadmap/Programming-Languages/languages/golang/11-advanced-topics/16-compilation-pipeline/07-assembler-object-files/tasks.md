# Assembler & Object Files — Tasks

Hands-on exercises. Do them in a throwaway module (`go mod init scratch`) on your own machine; use `_amd64.s`/`_arm64.s` to match your `GOARCH` (`go env GOARCH`). Each task names what to produce and how to check it.

## 1. Write `Add` in assembly

Create `add.go` with `func Add(a, b int) int` (no body) and `add_<arch>.s` implementing it (`MOVQ a+0(FP)...; ADDQ; MOVQ ...ret...(FP); RET`). Build and call it from `main`. **Check:** prints the right sum.

## 2. Break the argsize and watch vet catch it

In task 1's `.s`, change `$0-24` to `$0-16`. Run `go vet ./...`. **Check:** vet reports the frame/arg-size mismatch. Restore it.

## 3. Break an FP offset and watch vet catch it

Change `b+8(FP)` to `b+4(FP)`. Run `go vet ./...`. **Check:** vet prints `expected b+8(FP)`. Restore it.

## 4. Read a function's frame and arg size from the source

Open `$(go env GOROOT)/src/runtime/asm_<arch>.s` and find a `TEXT` line. Write down its `$frame-args`. **Check:** you can explain what each number means (local frame bytes vs args+results bytes).

## 5. Dump symbols with `go tool nm`

`go build -o app .`, then `go tool nm app | grep Add`. **Check:** you see a `T` (text) symbol for your `Add` with its package-qualified name (`·` became `.`).

## 6. Inspect the temp `.o`/`.a` with `-work`

Run `go build -x -work . 2>&1 | head -40`. Note the `WORK=` dir, then `cd` into `.../b001` and run `go tool pack t _pkg_.a`. **Check:** you see your assembled object listed inside the package archive.

## 7. Run `nm` on the package archive

In that same WORK dir: `go tool nm _pkg_.a`. **Check:** find your `Add` symbol and any data symbols, with their section codes.

## 8. Disassemble your function

`go tool objdump -s 'Add' app`. **Check:** the disassembly shows the `MOV`/`ADD`/`RET` you wrote.

## 9. Define package data with DATA/GLOBL

Add a `.s` snippet: `GLOBL ·mask(SB), RODATA|NOPTR, $16` plus two `DATA ·mask+0(SB)/8, $...` lines that tile all 16 bytes. Reference it from asm. **Check:** `go tool nm` shows `mask` as an `R` (rodata) symbol.

## 10. Trigger and read a `nosplit stack overflow`

Write `TEXT ·big(SB), NOSPLIT, $8192-0` with a `RET`. Build. **Check:** the linker reports `nosplit stack overflow`. Remove `NOSPLIT` (or shrink the frame) to fix.

## 11. Observe `//go:noescape` removing allocations

Write an asm function taking a `*[N]byte`. Benchmark it with and without `//go:noescape` on the Go stub using `go test -bench . -benchmem`. **Check:** `allocs/op` drops to 0 with the pragma. (Ensure the asm truly doesn't retain the pointer.)

## 12. Compare against a `math/bits` intrinsic

Write a popcount in asm vs `bits.OnesCount64`. Benchmark both with `benchstat`. **Check:** the intrinsic is competitive or better — evidence that asm often isn't needed.

## 13. See ABI symbols

Build a binary that calls an asm function and `go tool nm -size app | grep YourFunc`. Look for `<ABI0>` / `<ABIInternal>` markers and any ABI wrapper symbol. **Check:** you can identify which ABI your asm symbol has.

## 14. Find relocations / referenced symbols

Add an asm function that `CALL`s another package function (e.g. references a global via `(SB)`). Build with `-x -work`, then run `go tool objdump -s YourFunc app` and identify the call/reference target. **Check:** you can point to where a relocation must connect your symbol to the target.

## 15. Build for another architecture

`GOARCH=arm64 go vet ./...` (and `GOARCH=arm64 go build`). **Check:** your `_arm64.s` (or Go fallback) compiles and vet passes for that arch — proving your multi-arch setup is sound.
