# 8.13 `crypto/*` — Optimize

> **Audience.** Your crypto is correct. Your tests pass. Your audit
> notes are clear. Now the throughput numbers are looking back at you
> and asking why. This file covers the optimizations that matter:
> hardware acceleration, AEAD selection, TLS handshake amortization,
> the cost of `Sync`, and the rule that overrides everything in this
> file: **never trade correctness for speed in crypto**. If a "fast"
> path skips a check, it's not a fast path, it's a CVE.

## 1. Make sure AES-NI is on

On any x86 from the last decade and ARMv8, the CPU has AES
instructions. Go's `crypto/aes` detects them at startup and uses the
hardware path automatically. AES with hardware acceleration is on
the order of 1-3 GB/s per core; software AES (constant-time
bitslice) is 100-300 MB/s.

To check:

```sh
# Linux: look for aes in /proc/cpuinfo flags
grep -m1 -o 'aes' /proc/cpuinfo

# Apple Silicon, ARMv8: instructions are mandatory; not a question
```

If the host has AES-NI but the binary is slow at AES, the usual
suspect is a Docker image with `--platform=linux/amd64` running
under emulation on an ARM host. The QEMU emulator falls back to
software AES.

To benchmark:

```go
func BenchmarkAESGCM(b *testing.B) {
    key := make([]byte, 32)
    rand.Read(key)
    block, _ := aes.NewCipher(key)
    aead, _ := cipher.NewGCM(block)
    nonce := make([]byte, 12)
    pt := make([]byte, 1<<20) // 1 MiB
    b.SetBytes(int64(len(pt)))
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        aead.Seal(pt[:0], nonce, pt, nil)
    }
}
```

`b.SetBytes` makes `go test -bench=.` print MB/s. On a modern x86
laptop you should see 1-2 GB/s for AES-256-GCM. Significantly less
means software fallback or a CPU without AES-NI.

## 2. AES-GCM vs ChaCha20-Poly1305

| Platform | AES-256-GCM | ChaCha20-Poly1305 |
|----------|-------------|-------------------|
| x86 with AES-NI | Faster (1-2 GB/s) | Slower (~600 MB/s) |
| x86 without AES-NI | Slower (~200 MB/s) | Faster (~600 MB/s) |
| ARMv8 with AES | Faster | Comparable |
| Older ARM, RISC-V | Slower | Faster |

For server code on modern x86 and ARMv8: AES-GCM is the default.

For mobile / IoT / older embedded ARM without AES extensions:
ChaCha20-Poly1305 is faster and the right default. TLS 1.3
preference order encodes this — Go's TLS stack picks ChaCha when
the client signals (via `cipher_suites` order) that they prefer
it.

## 3. Hash performance

| Hash | Throughput on modern x86 | Notes |
|------|--------------------------|-------|
| SHA-256 | ~500 MB/s software, ~1 GB/s with SHA-NI | Default choice |
| SHA-512 | ~700 MB/s | Faster than SHA-256 on 64-bit CPUs (operates on 64-bit words) |
| SHA-1 | ~700 MB/s | Don't use for security |
| MD5 | ~700 MB/s | Don't use for security |
| BLAKE3 | ~3 GB/s | Not in stdlib; `lukechampine.com/blake3` if needed |

SHA-NI (the hardware path) is in 7th-gen Intel Core and AMD Zen+
and later. Without SHA-NI, SHA-256 is purely software. For
hashing very large files, SHA-512 is often faster than SHA-256 on
machines without SHA-NI — counterintuitive but real.

If your bottleneck is hashing, profile first (`pprof`), then
consider:

- Stream with a larger buffer (default `io.Copy` uses 32 KiB; some
  hashes go faster with 64 KiB+).
- Hash multiple files in parallel — `crypto/sha256` is not
  concurrency-safe per `hash.Hash` instance, but creating one per
  goroutine is fine.

## 4. RSA is slow; sign less

A 2048-bit RSA signature takes ~1 ms; an Ed25519 signature takes
~30 µs. A 4096-bit RSA signature takes ~5 ms. If you're signing
every request and your server CPU is pinned, switch to Ed25519
(if interop allows).

When stuck with RSA:

- **Cache the signing context.** `rsa.PrivateKey.Sign` allocates
  internal state on every call; pre-computing the public key's
  Montgomery form helps once (Go does this for you on first
  use). Signing the same key from multiple goroutines is safe and
  scales.
- **Sign hashes, not messages.** Pass a 32-byte SHA-256 digest, not
  a 1 MB document.
- **Use TLS session resumption.** TLS handshakes do RSA work; a
  resumed session skips it.

For verifying RSA signatures, the cost is much lower (~50 µs for
2048-bit). Verification rarely dominates.

## 5. TLS handshake amortization

A full TLS 1.3 handshake is ~1-2 ms server-side, dominated by
ECDHE and signing. Two amortizations:

### Session resumption (PSK)

The server keeps a session ticket; subsequent connections from the
same client use the PSK to skip the asymmetric work. Throughput
for resumed handshakes is ~10x higher.

Go's TLS stack does this automatically via session tickets. The
server's `tls.Config.SessionTicketsDisabled` defaults to false.
Don't change it.

The cost: session tickets break forward secrecy slightly (the
ticket key, if compromised, lets old recorded sessions be
decrypted). Mitigate by rotating session ticket keys regularly:

```go
type Config struct {
    SessionTicketKey [32]byte // documented as deprecated
    // Use:
    // SetSessionTicketKeys([][32]byte{newest, older})
}
```

`SetSessionTicketKeys` accepts a list; the first is the active
encryption key, the rest are accepted for decryption only. Rotate
by prepending a new key and dropping the oldest after the ticket
lifetime expires.

### Connection pooling

For HTTP, `http.Transport` pools connections. A keep-alive
connection reuses the TLS handshake for many requests. Default is
on; verify your code isn't accidentally closing connections after
each request:

```go
// Wrong: doesn't close response body, conn isn't released
resp, _ := http.Get(url)
fmt.Println(resp.StatusCode)

// Wrong: doesn't drain body before close
resp, _ := http.Get(url)
defer resp.Body.Close()
fmt.Println(resp.StatusCode)

// Correct: drain so the connection can be reused
resp, _ := http.Get(url)
defer resp.Body.Close()
io.Copy(io.Discard, resp.Body) // drain even if you don't care about the body
```

Without the drain, the underlying TCP connection can't be returned
to the pool, and every request pays for a new TLS handshake.

## 6. `crypto/rand` throughput

`rand.Read` is fast: ~1-2 GB/s on modern Linux (`getrandom(2)`).
For occasional small reads (32-byte tokens), it's irrelevant. For
generating large amounts of random data (e.g., test fixtures, key
derivation salts in bulk), it's still fast enough that it's almost
never the bottleneck.

If you genuinely need high-throughput random data:

- For test/non-security use, `math/rand/v2` with a seeded PCG is
  much faster (~10x).
- For security with high throughput, derive a stream from a
  `crypto/rand`-seeded ChaCha20:

```go
import "golang.org/x/crypto/chacha20"

key := make([]byte, 32)
nonce := make([]byte, 12)
rand.Read(key)
rand.Read(nonce)

cipher, _ := chacha20.NewUnauthenticatedCipher(key, nonce)
out := make([]byte, 1<<20)
cipher.XORKeyStream(out, out) // 1 MiB of pseudorandom bytes
```

This is a cryptographically strong PRNG seeded from the OS — fast
and safe. Use it when you genuinely need GB/s of random data, not
as a default replacement for `crypto/rand`.

## 7. The `Sync` cost in key-write paths

When you write a key file to disk and want it durable:

```go
f, _ := os.Create("key.pem")
f.Write(pemBytes)
f.Sync()  // 1-10 ms on consumer SSD
f.Close()
```

`Sync` blocks until the kernel flushes to stable storage. On
spinning rust it's tens of milliseconds. On SSD with battery-backed
write cache, hundreds of microseconds. Don't `Sync` on every
write to a hot file:

- For a key file written once at startup, sync once before
  signaling readiness. Cost is amortized over the process
  lifetime.
- For a write-ahead log of crypto operations (audit), batch
  multiple records and sync once per batch.

The wrong pattern is "write, sync, write, sync" — each `Sync`
blocks for the same fixed time regardless of how much you wrote.

## 8. Keyset lookups in hot path

When verifying tokens with multiple valid keys (rotation), a naive
`map[string]crypto.PublicKey` lookup is fine — it's nanoseconds.
Where it gets expensive: re-parsing the public key from PEM on
every verify.

```go
// Slow: parses on every call
func verify(token string) error {
    pem, _ := os.ReadFile("public.pem")
    pub := parsePub(pem)
    return jwtVerify(token, pub)
}

// Fast: parse once, cache
type Verifier struct {
    pub crypto.PublicKey
}

func NewVerifier(pemPath string) (*Verifier, error) {
    raw, err := os.ReadFile(pemPath)
    if err != nil { return nil, err }
    block, _ := pem.Decode(raw)
    pub, err := x509.ParsePKIXPublicKey(block.Bytes)
    if err != nil { return nil, err }
    return &Verifier{pub: pub}, nil
}

func (v *Verifier) Verify(token string) error {
    return jwtVerify(token, v.pub)
}
```

Same idea for cert pools: `x509.SystemCertPool()` is *not* free
(it scans the system trust store). Cache the result, reuse it
across requests.

## 9. PBKDF2/Argon2 cost — tune for your hardware

Password hashing is *deliberately* slow. The argon2 parameters in
the leaf — `t=1, m=64*1024, p=4` — produce a hash in ~100 ms on a
modern server. That's the right ballpark: slow enough to deter
brute force, fast enough that legitimate logins don't feel
sluggish.

Tuning:

- **Time (`t`)**: linear in cost. Doubling doubles login latency.
- **Memory (`m`)**: linear in cost; also the dominant defense
  against GPU brute force. 64 MiB makes GPU attacks expensive.
- **Parallelism (`p`)**: how many threads argon2 uses. Match to
  your server's per-login budget; 4 is reasonable.

Benchmark on your actual production hardware:

```go
func BenchmarkArgon2(b *testing.B) {
    salt := make([]byte, 16)
    for i := 0; i < b.N; i++ {
        argon2.IDKey([]byte("password"), salt, 1, 64*1024, 4, 32)
    }
}
```

If this prints 200 ms/op on your server, that's about right for an
interactive login. If it's 20 ms, bump the parameters until you're
in the 100-300 ms range. If it's 2 seconds, your server is too
small for these parameters or another process is using the cores.

When you tune, store the parameters in the encoded hash so you can
change them later without orphaning existing hashes.

## 10. Streaming hash with shared buffers

For hashing many files in a loop, reuse the buffer:

```go
// Slower: allocates 32 KiB per file
for _, path := range files {
    f, _ := os.Open(path)
    h := sha256.New()
    io.Copy(h, f)
    f.Close()
    fmt.Printf("%x %s\n", h.Sum(nil), path)
}

// Faster: one buffer, reused
buf := make([]byte, 64*1024)
for _, path := range files {
    f, _ := os.Open(path)
    h := sha256.New()
    io.CopyBuffer(h, f, buf)
    f.Close()
    fmt.Printf("%x %s\n", h.Sum(nil), path)
}
```

`io.CopyBuffer` skips the internal 32 KiB allocation that
`io.Copy` does on each call. For small files, the saving is
negligible; for thousands of files, it adds up.

The hash itself can be reused across files via `h.Reset()`:

```go
h := sha256.New()
buf := make([]byte, 64*1024)
for _, path := range files {
    f, _ := os.Open(path)
    h.Reset()
    io.CopyBuffer(h, f, buf)
    f.Close()
    fmt.Printf("%x %s\n", h.Sum(nil), path)
}
```

`h.Reset()` reuses the same internal state buffer instead of
allocating a new one.

## 11. Concurrency: fan out, but mind the limits

For hashing many files in parallel:

```go
sem := make(chan struct{}, runtime.NumCPU())
var wg sync.WaitGroup
for _, path := range files {
    wg.Add(1)
    sem <- struct{}{}
    go func(path string) {
        defer wg.Done()
        defer func() { <-sem }()
        f, _ := os.Open(path)
        defer f.Close()
        h := sha256.New()
        io.Copy(h, f)
        // emit result
    }(path)
}
wg.Wait()
```

Bounded concurrency (a semaphore of `NumCPU` slots) prevents
opening every file at once. SHA-256 is mostly CPU-bound; running
more goroutines than cores doesn't help.

For AES-GCM, the same parallelism applies — `cipher.AEAD` is not
concurrency-safe per instance, but creating one per goroutine
(from a shared `cipher.Block`) works. The `cipher.Block` from
`aes.NewCipher` is read-only after construction and safe to share.

## 12. Things you should not optimize

| Thing | Why not |
|-------|---------|
| `subtle.ConstantTimeCompare` | The "slowness" is the security |
| `crypto/rand.Read` for small reads | Already fast; tweaking is risky |
| Argon2 parameters down | The slowness is the security |
| TLS cipher choice | Defaults are sane; tweaking weakens |
| Hash algorithm to "faster" non-cryptographic ones | xxhash isn't a substitute for SHA-256 in security contexts |
| Skipping `f.Sync()` for "speed" on key writes | Lost keys on power failure are not faster |

The general rule: in crypto, "slow but correct" beats "fast and
wrong" every time, and most of the apparent slowness either has a
security purpose or isn't where your real bottleneck lives.

## 13. Profile before optimizing

The single best advice for crypto-adjacent performance: don't
guess.

```sh
go test -bench=. -cpuprofile=cpu.prof
go tool pprof -http=:8080 cpu.prof
```

If your `pprof` flame graph shows time in `crypto/aes`, fine —
maybe AES-NI isn't kicking in. If it shows time in `runtime.mallocgc`,
the bottleneck is allocations. If it shows time in `syscall.Read`,
it's I/O — the crypto isn't your problem.

Most "the crypto is slow" complaints turn out to be allocations,
TLS handshakes that didn't get pooled, or password hashing in a
hot loop. Fixing those without touching the algorithm gives you
the speedup.

## 14. What to read next

- [find-bug.md](find-bug.md) — bugs that masquerade as performance
  problems (a slow loop because it's brute-forcing through a
  failure condition, for example).
- [professional.md](professional.md) — when your throughput budget
  is set by KMS round-trips, not by your code.
- The Go runtime profiling docs at https://go.dev/doc/diagnostics —
  the right starting point for "where is my CPU going."
