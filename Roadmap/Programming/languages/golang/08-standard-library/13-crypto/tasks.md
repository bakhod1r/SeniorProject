# 8.13 `crypto/*` — Tasks

> **Audience.** You've read junior, middle, and at least skimmed senior.
> These exercises put the material into practice. Each task is
> self-contained and runnable; constraints are part of the exercise,
> not decoration. Don't reach for third-party libraries unless the
> task says to.

## Task 1 — File integrity

Write a program `sumcheck` with two subcommands:

```
sumcheck hash <file>           # prints "<sha256-hex>  <file>"
sumcheck verify <file> <hex>   # exits 0 if matches, 1 if not
```

Constraints:

- Stream the file with `io.Copy` into `sha256.New()` — never read it
  fully into memory.
- For `verify`, compare with `hmac.Equal` (treat the hex as a tag).
  Yes, even though SHA-256 of a file isn't a MAC; the comparison
  habit is the point.
- Handle the case where the file doesn't exist with a clear error.

Stretch: support `--algo sha512` to switch hash. Use `crypto.Hash`
to dispatch.

## Task 2 — Random tokens

Write a function `NewToken(nBytes int) (string, error)` that returns
a base64url-encoded random token of `nBytes` bytes of entropy.
Then write a quick benchmark:

```go
func BenchmarkToken32(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _, _ = NewToken(32)
    }
}
```

Run it. Report the throughput. Then write the same function using
`math/rand` and benchmark. Note that the speeds are similar; the
difference is security, not performance. **Do not ship the
math/rand version.**

## Task 3 — HMAC-signed cookie

Implement two functions:

```go
func Sign(payload string, key []byte) string
func Verify(token string, key []byte) (string, error)
```

`Sign` produces `<base64url(payload)>.<base64url(hmac-sha256(payload, key))>`.
`Verify` returns the original payload if the tag is valid; an
error otherwise.

Constraints:

- Use `hmac.Equal` for tag comparison.
- The base64 encoding is `base64.RawURLEncoding` (no padding).
- Test that tampering with one byte of the payload causes verify
  to fail.

Stretch: add an `exp` field as Unix timestamp; sign `payload || "."
|| exp`. Reject expired tokens.

## Task 4 — AES-GCM file encryptor

Write a CLI:

```
gcmtool encrypt <password> <in> <out>
gcmtool decrypt <password> <in> <out>
```

Constraints:

- Derive the key with `argon2id` (`golang.org/x/crypto/argon2`),
  parameters `time=1, memory=64MiB, threads=4, hash=32 bytes`.
- File layout: `salt(16) || nonce(12) || ciphertext+tag`.
- Read and write streaming when the file fits in memory; if you
  want to handle truly large files, encrypt in 64 KiB chunks with a
  chunk counter in the AAD and a final-chunk bit. Document which
  you chose.
- Reject decryption if the AEAD `Open` fails. Don't print "wrong
  password" specifically — say "decryption failed" (the cause
  could be tampering).

Stretch: include the argon2 parameters in the file header so they
can be tuned later without breaking older files.

## Task 5 — Ed25519 signing service

Implement an HTTP service with two endpoints:

- `POST /sign` — body is the message to sign; returns
  `{"sig": "<base64>"}`. The private key is loaded from a PEM file
  on startup.
- `POST /verify` — body is JSON `{"msg": "...", "sig": "..."}`;
  returns 200 if valid, 401 if not.

Constraints:

- Use `crypto/ed25519` for signing, `crypto.Signer` interface to
  load the key (so the same code path could later use a KMS).
- Cap the request body with `http.MaxBytesReader` at 1 MiB.
- Don't log the message contents; do log a digest prefix and the
  result.

Stretch: add `kid` support — the service holds a keyset, signs with
the latest, accepts any. Rotate by adding a new key and switching
the "latest" pointer.

## Task 6 — Self-signed cert generator

Write a function that produces a leaf certificate plus matching
private key, both as PEM strings, suitable for `tls.X509KeyPair`:

```go
func SelfSigned(host string, validFor time.Duration) (certPEM, keyPEM []byte, err error)
```

Constraints:

- Use `crypto/ecdsa` with P-256 (or `ed25519` if you prefer).
- Set `Subject.CommonName`, `DNSNames`, and `IPAddresses`
  appropriately based on `host`.
- Set `KeyUsage = DigitalSignature | KeyEncipherment` and
  `ExtKeyUsage = ServerAuth`.
- Output PEM blocks: `CERTIFICATE` and `PRIVATE KEY` (PKCS#8).

Test it by passing the result through `tls.X509KeyPair` and
spinning up an `httptest.NewTLSServer` with that cert.

## Task 7 — mTLS server

Build an HTTP server that requires client certs from an internal CA.
Use the cert generator from Task 6 to make:

- A CA cert + key (set `IsCA = true`).
- A server cert signed by the CA.
- A client cert signed by the CA.

Server config:

- `ClientAuth: tls.RequireAndVerifyClientCert`
- `ClientCAs` holds only your CA cert.

The single handler returns the client's `Subject.CommonName` from
`r.TLS.PeerCertificates[0]`.

Test with a Go client using the client cert. Then test with a Go
client *not* presenting a cert and confirm the handshake fails.

## Task 8 — Hot-reload TLS

Extend Task 7's server: instead of static `Certificates`, use
`GetCertificate` plus a goroutine that polls the cert file every
2 seconds. When the file changes, atomically swap the active cert.

Test: connect, replace the cert file, wait 3 seconds, connect
again. The new cert should be presented. Existing keep-alive
connections may continue to use the old cert until they close;
verify with `curl` (which closes between requests).

## Task 9 — Envelope encryption

Implement an in-memory mock KMS:

```go
type KMS struct {
    keys map[string][]byte // keyID -> raw 32-byte key
}

func (k *KMS) Wrap(keyID string, dek []byte) ([]byte, error)   // AES-GCM with KEK
func (k *KMS) Unwrap(keyID string, wrapped []byte) ([]byte, error)
```

Then build an `Envelope` type that stores ciphertext and a wrapped
DEK:

```go
type Envelope struct {
    KeyID      string
    WrappedDEK []byte
    Nonce      []byte
    Ciphertext []byte
}

func Seal(kms *KMS, keyID string, plaintext, aad []byte) (*Envelope, error)
func Open(kms *KMS, e *Envelope, aad []byte) ([]byte, error)
```

Test with two key IDs. Re-wrap a DEK from one KEK to another to
simulate KEK rotation; verify the data still decrypts and that the
ciphertext didn't change.

## Task 10 — Find the timing leak

Write the buggy version first, then fix it:

```go
func badEqual(a, b []byte) bool {
    if len(a) != len(b) { return false }
    for i := range a {
        if a[i] != b[i] { return false }
    }
    return true
}
```

Write a benchmark that shows the timing difference:

- Bench 1: equal 32-byte slices.
- Bench 2: 32-byte slices that differ in the first byte.
- Bench 3: 32-byte slices that differ in the last byte.

Run the benchmarks 100 times each (`-count=100`). On many machines
you'll see Bench 3 measurably slower than Bench 2 (the loop runs
longer). Replace `badEqual` with `subtle.ConstantTimeCompare` and
re-run; the differences should disappear (or at least become
indistinguishable from noise).

If you can't see the difference (modern CPUs and Go's bench
infrastructure both add noise), that's fine — the principle is
real even when the measurement is hard. Keep using
`subtle.ConstantTimeCompare` regardless.

## Task 11 — Password verification

Implement a tiny user store backed by argon2id:

```go
type Users struct {
    mu sync.Mutex
    db map[string]string // username -> "argon2id$..." encoded hash
}

func (u *Users) Register(name, password string) error
func (u *Users) Verify(name, password string) (bool, error)
```

Constraints:

- Use `argon2.IDKey` with parameters `t=1, m=64*1024, p=4, k=32`.
- Store as `argon2id$v=19$m=65536,t=1,p=4$<base64-salt>$<base64-hash>`
  (the standard PHC format). Parse this format on verify.
- `Verify` returns false for unknown user without revealing whether
  the user exists. Compute a dummy hash anyway to avoid a timing
  oracle that distinguishes "no such user" from "wrong password".

Stretch: implement parameter migration — if a stored hash has
weaker parameters than the current default, upgrade on successful
login.

## Task 12 — JWT verifier (minimal)

Write a verifier for HS256 JWTs that checks:

- Three dot-separated base64url segments.
- Header `alg == "HS256"` exactly. Reject anything else, *especially*
  `none`.
- Signature verifies with `hmac.Equal`.
- `exp` claim present and in the future (allow 60 seconds skew).
- `iat` claim if present, not in the far future (allow 60 seconds skew).

```go
func VerifyHS256(token string, key []byte, expectedAud string) (json.RawMessage, error)
```

Test with three positive cases and ten negative cases:

- Tampered payload.
- Tampered signature.
- `alg: none`.
- `alg: HS512` (we only accept HS256).
- Expired (`exp` in the past).
- Wrong audience.
- Missing `exp`.
- Two segments instead of three.
- Empty signature.
- Different key.

## Task 13 — Detect a nonce reuse

You have a log of AES-GCM ciphertexts in the format
`nonce(12) || ciphertext`. Write a tool that scans the log and
reports any nonce that appears twice:

```
$ noncedup log.bin
nonce 4f1a2b3c... appears at offsets 0, 1024
```

Constraints:

- Stream the log; don't load it all in memory.
- Use a `map[[12]byte][]int64` for nonce → offsets. The fixed-size
  array key avoids the slice-key issue.
- Report file offsets, not record indices, so the user can
  navigate the file directly.

The point: in production, a tool like this run periodically across
your encrypted-at-rest storage tells you whether your nonce
discipline is working.

## Task 14 — Constant-time prefix match

Write a function that reports whether `a` is a prefix of `b` in
constant time over `len(a)`:

```go
func ConstantTimeHasPrefix(a, b []byte) bool
```

Constraints:

- Run in time `O(len(a))`, not `O(len(a))` early-exit.
- Don't allocate.
- Handle `len(a) > len(b)` (return false in constant time over
  `len(a)`, not `len(b)` — the lengths themselves leaking is fine).

This is a building block for token validation where the prefix
might be a tenant ID and the suffix is the secret.

## Task 15 — TLS config audit

Write a function that takes a `*tls.Config` and returns a list of
warnings about suspicious settings:

```go
func AuditTLSConfig(cfg *tls.Config) []string
```

Flags it should produce:

- `MinVersion < tls.VersionTLS12`
- `InsecureSkipVerify == true`
- `ClientAuth == tls.NoClientCert` *and* the function is told this
  is a "private mTLS" config (parameterize as you like)
- `Renegotiation != RenegotiateNever`
- `len(CipherSuites) > 0` containing any name from a known-bad list
  (`TLS_RSA_WITH_*`, anything with `_CBC_` and SHA-1)

Run it against `&tls.Config{}` (should be clean) and against a
deliberately bad config (should produce warnings).

This is the start of a CI lint for crypto config in your codebase.
Once the function exists, wire it into `go test` for the package
that holds your TLS config builder.

## Task 16 — Cert chain validator

Write a function that validates a PEM bundle representing a
chain (leaf, intermediates, root):

```go
func ValidateChain(pem []byte, host string, when time.Time) error
```

Constraints:

- Decode all PEM blocks; expect at least one `CERTIFICATE`.
- Build a `CertPool` from the last cert (the alleged root).
- Build an intermediates pool from the middle certs.
- Use `Cert.Verify(VerifyOptions{...})` with `Roots`,
  `Intermediates`, `CurrentTime: when`, `DNSName: host`.
- Return a clear error if the chain doesn't validate.

Stretch: detect cases where the bundle is in the wrong order
(root first instead of leaf first) and fix it before validating.

## Task 17 — HMAC keyset rotation

Extend Task 3's signed cookies to support multiple keys:

```go
type Keyset struct {
    Active []byte            // current signing key
    Older  map[string][]byte // kid -> key, accepted for verify
}

func Sign(payload string, ks *Keyset, kid string) string
func Verify(token string, ks *Keyset) (string, error)
```

Constraints:

- Cookie format includes `kid`: `<base64(payload)>.<kid>.<base64(tag)>`.
- `Verify` looks up the key by `kid`. Active key for new tokens;
  older keys for verifying tokens issued before rotation.
- Test rotation: sign with old keyset, rotate, verify with new
  keyset (the old key is now in `Older`), confirm verification
  works.

## Task 18 — Encrypt-then-MAC the legacy way

Implement AES-CBC + HMAC-SHA256 encrypt-then-MAC for compatibility
with a (hypothetical) legacy system:

```go
func Encrypt(plaintext, encKey, macKey []byte) ([]byte, error)
func Decrypt(ciphertext, encKey, macKey []byte) ([]byte, error)
```

Constraints:

- Random IV per message; prepend to ciphertext.
- PKCS#7 padding for plaintext.
- HMAC-SHA256 over `iv || ct`; append the tag.
- Output: `iv(16) || ciphertext || tag(32)`.
- Decrypt MUST verify the MAC *before* doing PKCS#7 unpadding.
  Failing the MAC check returns a generic error; failing unpadding
  returns the same generic error. Same code path, same timing.

The point: build it correctly and notice how careful you have to
be. Then realize AES-GCM does all this for you in one call.

## Task 19 — A tiny X.509 inspector

Write a CLI that prints the human-readable summary of a
certificate file:

```
$ certinfo server.pem
Subject: CN=example.com
Issuer:  CN=Example Internal CA
NotBefore: 2026-01-01T00:00:00Z
NotAfter:  2026-12-31T23:59:59Z
DNSNames:  example.com, www.example.com
KeyUsage:  DigitalSignature, KeyEncipherment
ExtKeyUsage: ServerAuth
Public Key: ECDSA P-256
SerialNumber: 1234567890
SHA256 Fingerprint: ab:cd:ef:...
```

Constraints:

- Handle PEM and DER inputs (try DER first, fall back to PEM).
- For multi-cert PEM, print each cert.
- Format the SHA-256 fingerprint as colon-separated hex pairs (the
  format `openssl x509 -fingerprint -sha256` uses).

Stretch: add a `--check-expiry` flag that exits 1 if any cert
expires within 30 days. Wire it into a CI cron.

## How to verify your work

For each task:

1. **Does it run?** Build with `go build ./...`, test with `go test ./...`.
2. **Does it pass `go vet`?** No `go vet` warnings.
3. **Does it pass `staticcheck`?** Useful for catching simple
   mistakes; not crypto-specific but worth running.
4. **Did you use `crypto/rand`?** Search your code for
   `math/rand`. If it's there for any token, key, nonce, or salt,
   that's a bug.
5. **Did you use `hmac.Equal` / `subtle.ConstantTimeCompare`?**
   Search for `bytes.Equal` and `==` near tag/digest variables.
   Each one is a candidate timing leak.
6. **Are there any hard-coded keys, nonces, or secrets in the
   source?** Should be zero in tasks above.

## What to read next

- [find-bug.md](find-bug.md) — when your code looks right but
  isn't.
- [optimize.md](optimize.md) — when correctness is settled and
  throughput becomes the question.
