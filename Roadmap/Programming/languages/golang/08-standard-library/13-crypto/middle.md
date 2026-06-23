# 8.13 `crypto/*` — Middle

> **Audience.** You've read [junior.md](junior.md). You hash files, sign
> cookies with HMAC, and generate tokens with `crypto/rand`. This file
> covers the next layer: streaming AEAD over multi-megabyte payloads,
> the public-key trio (RSA, ECDSA, Ed25519), parsing X.509 certificates,
> reading PEM files, and password-based key derivation. The thread that
> runs through all of it: **default to high-level primitives, prefer
> Ed25519 for new signing, prefer GCM/ChaCha for new encryption, and
> never store passwords with anything that isn't argon2id, scrypt, or
> bcrypt**.

## 1. The `crypto.Hash` enum

`crypto.Hash` (in package `crypto`) is an enum that names every hash
algorithm in the stdlib. It's the type used to identify a hash for
APIs that work with multiple algorithms — RSA signatures, X.509
templates, JOSE-style headers.

```go
import "crypto"

h := crypto.SHA256
fmt.Println(h.Size())        // 32
fmt.Println(h.Available())   // true if linked in
hash := h.New()              // returns hash.Hash, like sha256.New()
```

The trick: `crypto.SHA256.New()` only works if the calling binary
imports `crypto/sha256`. The `crypto` package keeps a registry; each
hash package registers itself in `init()`. If you call
`crypto.SHA256.New()` without importing `crypto/sha256`, you get a
panic. Stdlib functions that take `crypto.Hash` rely on the caller to
import the right hash package.

```go
// Pin the dependency.
import _ "crypto/sha256"

// Now you can pass crypto.SHA256 around as a value.
opts := &rsa.PSSOptions{Hash: crypto.SHA256}
```

This is why even unused-looking blank imports of `crypto/sha256`
appear in production code.

## 2. Streaming AEAD — when the message is large

The `cipher.AEAD` interface has just two methods:

```go
type AEAD interface {
    NonceSize() int
    Overhead() int
    Seal(dst, nonce, plaintext, additionalData []byte) []byte
    Open(dst, nonce, ciphertext, additionalData []byte) ([]byte, error)
}
```

`Seal` and `Open` operate on a *whole message at once*. There's no
"chunked AEAD" in the stdlib — partly because chunking AEAD correctly
is harder than it looks (you must authenticate the chunk boundaries,
the order, and the absence of trailing data). For a multi-gigabyte
file, the right approach is one of:

1. **Encrypt in fixed-size chunks** with a chunk index in the AAD.
2. **Use `golang.org/x/crypto/chacha20poly1305` with the X variant**
   so the nonce is large enough to make collision negligible; chunk
   under one key.
3. **Wrap with TLS or Wireguard** if it's a network stream.

The chunked pattern, simplified:

```go
const chunkSize = 64 * 1024

type chunkedWriter struct {
    aead    cipher.AEAD
    out     io.Writer
    counter uint64
    buf     []byte
}

func (w *chunkedWriter) WriteChunk(p []byte) error {
    nonce := make([]byte, w.aead.NonceSize())
    binary.BigEndian.PutUint64(nonce[len(nonce)-8:], w.counter)
    w.counter++

    aad := []byte{0} // 0 = mid-stream, 1 = final, in real designs
    ct := w.aead.Seal(w.buf[:0], nonce, p, aad)
    if _, err := w.out.Write(ct); err != nil { return err }
    return nil
}
```

Production-grade chunking has a "final chunk" bit in the AAD so
truncation attacks (cutting off chunks at the end) fail. Don't ship
something like the snippet above without that bit — it's an example
of *exactly* the place where rolling your own protocol goes wrong.

For most apps: don't chunk. Either fit the message in memory and
`Seal` once, or use a higher-level construction (`age`, `nacl/secretstream`,
TLS) that already solved this.

## 3. AES-CTR, AES-CBC, and why you don't want them

`crypto/cipher` has three modes of operation:

| Mode | Constructor | Authenticated? | Use it? |
|------|-------------|----------------|---------|
| GCM | `cipher.NewGCM(block)` | Yes (AEAD) | **Yes — default** |
| CTR | `cipher.NewCTR(block, iv)` | No | No, unless you HMAC on top |
| CBC | `cipher.NewCBCEncrypter(block, iv)` | No | No |
| ECB | (none — by design) | No | Never |
| OFB, CFB | exist for legacy | No | No |

**CBC and CTR are unauthenticated.** A ciphertext encrypted with CBC
or CTR can be modified in flight in ways the receiver can't detect —
flip a bit in the ciphertext, the corresponding plaintext bit flips
(CTR) or the next block becomes garbage but the rest decrypts (CBC).
This was the basis for padding-oracle attacks that broke real systems
for two decades. AEAD modes (GCM, ChaCha20-Poly1305) make those
attacks structurally impossible.

If you must use CTR or CBC for a legacy protocol:

1. **Always pair with HMAC** in encrypt-then-MAC order.
2. **Use a separate key for the MAC** — derive both keys from a
   master key with HKDF.
3. **Verify the MAC before doing anything with the ciphertext.**

For new code: use GCM. The above paragraph exists so you recognize the
pattern in legacy code, not so you write it.

**ECB is a special kind of broken.** ECB encrypts each block
independently; identical plaintext blocks become identical ciphertext
blocks. The famous "ECB penguin" picture (the Linux mascot encrypted
with ECB and still recognizable) is the canonical illustration. Go
deliberately doesn't expose an ECB mode constructor. Don't construct
your own.

## 4. ChaCha20-Poly1305

The non-AES AEAD in `golang.org/x/crypto/chacha20poly1305`:

```go
import "golang.org/x/crypto/chacha20poly1305"

key := make([]byte, chacha20poly1305.KeySize) // 32 bytes
rand.Read(key)

aead, err := chacha20poly1305.New(key) // 12-byte nonce
// or
xaead, err := chacha20poly1305.NewX(key) // 24-byte nonce, "extended"
```

When to prefer ChaCha20-Poly1305 over AES-GCM:

- **No AES hardware acceleration** (older ARM, embedded). ChaCha20
  runs at competitive speed on any CPU; AES is slow without AES-NI.
- **You want a 24-byte nonce** for random-nonce safety beyond GCM's
  birthday bound. Use the `X` variant.

Otherwise, AES-GCM is the default. Modern x86, ARMv8, and Apple
silicon all have AES instructions; AES-GCM is faster than ChaCha
there.

## 5. Public-key crypto: which one to pick

| Algorithm | Package | Sign | Encrypt | Use it for |
|-----------|---------|------|---------|------------|
| Ed25519 | `crypto/ed25519` | Yes | No | **New signing.** Fast, small keys, simple |
| ECDSA P-256 | `crypto/ecdsa` | Yes | No | When a spec demands NIST curves |
| RSA | `crypto/rsa` | Yes | Yes | Legacy, JWK, X.509, S/MIME |
| X25519 / ECDH | `crypto/ecdh` | No | Key exchange | TLS, Noise, your own KEX |

The recommendation in 2026:

- **Sign new things with Ed25519.** Smaller keys (32 bytes), shorter
  signatures (64 bytes), no parameters to choose, no nonce to leak,
  hash-and-sign API.
- **Sign legacy things with RSA-PSS** (not RSA-PKCS#1 v1.5) when you
  must use RSA for interop. PSS is the modern, side-channel-safer
  RSA signing mode.
- **Encrypt with RSA-OAEP** if you're encrypting a small key with a
  recipient's RSA public key. For arbitrary data, use a hybrid scheme
  (RSA-OAEP encrypts a random AES key; AES-GCM encrypts the data).
- **Key exchange** uses `crypto/ecdh` (Go 1.20+) — X25519 for new
  protocols, NIST P-256 for interop.

### Ed25519 — the right default for signatures

```go
import "crypto/ed25519"

pub, priv, err := ed25519.GenerateKey(nil) // nil → uses crypto/rand

sig := ed25519.Sign(priv, []byte("hello"))         // 64-byte signature
ok := ed25519.Verify(pub, []byte("hello"), sig)    // bool
```

That's the whole API. There's no hash to choose, no padding scheme,
no nonce, no salt, no curve to pick. The signature is deterministic
(no `crypto/rand` needed for signing — the algorithm is RFC 8032 —
which means no risk of nonce reuse leaking the key the way ECDSA can).

For very large messages, hash first and sign the hash:

```go
sum := sha512.Sum512(largeMsg)
sig := ed25519.Sign(priv, sum[:])
```

Or use `ed25519.Options{Hash: crypto.SHA512}` and the `SignerOpts`
form via `crypto.Signer` for code that's polymorphic over signing
algorithms.

### ECDSA — when a spec asks for NIST curves

```go
import (
    "crypto/ecdsa"
    "crypto/elliptic"
    "crypto/rand"
)

priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)

hash := sha256.Sum256(msg)
sig, err := ecdsa.SignASN1(rand.Reader, priv, hash[:])
ok := ecdsa.VerifyASN1(&priv.PublicKey, hash[:], sig)
```

`SignASN1` produces a DER-encoded `(r, s)` pair, which is what most
specs (X.509, JWS-ES256) expect. The older `Sign` returns separate
big.Int values you must encode yourself.

ECDSA's known footgun: signing requires a per-signature random value
`k`. If `k` is ever reused or biased, the private key leaks (the
2010 PS3 hack worked this way). Go's `crypto/ecdsa` uses RFC 6979
deterministic `k` derivation when you pass `rand.Reader`, which
removes the foot from the gun. Don't pass anything else.

### RSA — when you have to

```go
import "crypto/rsa"

priv, err := rsa.GenerateKey(rand.Reader, 2048) // 2048 is the minimum

// Sign with PSS (preferred for new code)
hash := sha256.Sum256(msg)
sig, err := rsa.SignPSS(rand.Reader, priv, crypto.SHA256, hash[:], nil)
ok := rsa.VerifyPSS(&priv.PublicKey, crypto.SHA256, hash[:], sig, nil)

// Encrypt with OAEP
ct, err := rsa.EncryptOAEP(sha256.New(), rand.Reader, &priv.PublicKey, plaintext, nil)
pt, err := rsa.DecryptOAEP(sha256.New(), nil, priv, ct, nil)
```

Things to know:

- **2048 bits is the floor** for new RSA keys. 1024 is broken; 4096
  is sometimes required by policy but slows everything down. 3072 is
  a reasonable compromise if you need more than 2048.
- **PSS is preferred over PKCS#1 v1.5** for new signing code. v1.5 is
  still the default in many specs (JWS-RS256 is v1.5) — use it only
  when interop demands.
- **OAEP is required** for encryption. The older PKCS#1 v1.5 padding
  for encryption is vulnerable to Bleichenbacher attacks; don't ship
  it for new systems.
- **RSA-2048 signing is ~50x slower than Ed25519.** If you're
  signing every request, prefer Ed25519.

## 6. The `crypto.Signer` interface

A unifying interface for signing:

```go
type Signer interface {
    Public() PublicKey
    Sign(rand io.Reader, digest []byte, opts SignerOpts) ([]byte, error)
}
```

All three private key types (`*rsa.PrivateKey`, `*ecdsa.PrivateKey`,
`ed25519.PrivateKey`) implement it. Code that signs polymorphically
takes a `crypto.Signer` and works with any of them:

```go
func signMessage(s crypto.Signer, msg []byte) ([]byte, error) {
    h := sha256.Sum256(msg)
    return s.Sign(rand.Reader, h[:], crypto.SHA256)
}
```

This is also the interface a KMS- or HSM-backed signer should
implement. The private key never leaves the device; your code
calls `Sign` and gets back bytes. We come back to this in
[professional.md](professional.md).

## 7. Reading PEM files

Most key and certificate material on disk is PEM-encoded — base64
between `-----BEGIN ...-----` and `-----END ...-----` markers.

```go
import "encoding/pem"

raw, err := os.ReadFile("server.key")
if err != nil { return err }

block, _ := pem.Decode(raw) // returns the first block, plus the rest
if block == nil {
    return errors.New("not a PEM file")
}
fmt.Println(block.Type) // "RSA PRIVATE KEY", "PRIVATE KEY", "CERTIFICATE", ...
```

`block.Bytes` holds the DER-encoded content. From there:

| Block type | Parser |
|------------|--------|
| `CERTIFICATE` | `x509.ParseCertificate(block.Bytes)` |
| `PRIVATE KEY` (PKCS#8) | `x509.ParsePKCS8PrivateKey(block.Bytes)` |
| `RSA PRIVATE KEY` (PKCS#1) | `x509.ParsePKCS1PrivateKey(block.Bytes)` |
| `EC PRIVATE KEY` (SEC 1) | `x509.ParseECPrivateKey(block.Bytes)` |
| `PUBLIC KEY` (PKIX) | `x509.ParsePKIXPublicKey(block.Bytes)` |

For new code, prefer **PKCS#8** for private keys (`x509.MarshalPKCS8PrivateKey`,
`x509.ParsePKCS8PrivateKey`) — it works for RSA, ECDSA, and Ed25519
uniformly. The older format is per-algorithm.

Production loaders should be defensive:

```go
func loadPrivateKey(path string) (crypto.Signer, error) {
    raw, err := os.ReadFile(path)
    if err != nil { return nil, err }

    block, _ := pem.Decode(raw)
    if block == nil { return nil, errors.New("no PEM block in key file") }

    var key any
    switch block.Type {
    case "PRIVATE KEY":
        key, err = x509.ParsePKCS8PrivateKey(block.Bytes)
    case "RSA PRIVATE KEY":
        key, err = x509.ParsePKCS1PrivateKey(block.Bytes)
    case "EC PRIVATE KEY":
        key, err = x509.ParseECPrivateKey(block.Bytes)
    default:
        return nil, fmt.Errorf("unsupported key type %q", block.Type)
    }
    if err != nil { return nil, err }

    s, ok := key.(crypto.Signer)
    if !ok { return nil, errors.New("key does not implement crypto.Signer") }
    return s, nil
}
```

## 8. X.509 certificates: parse and create

A certificate is a public key plus identity information signed by an
issuer. Stdlib has full support:

```go
import "crypto/x509"

raw, _ := os.ReadFile("cert.pem")
block, _ := pem.Decode(raw)
cert, err := x509.ParseCertificate(block.Bytes)
fmt.Println(cert.Subject.CommonName)
fmt.Println(cert.NotAfter)
fmt.Println(cert.DNSNames)
```

To create one (typical: a self-signed cert for tests, or a CA signing
a leaf):

```go
template := &x509.Certificate{
    SerialNumber: big.NewInt(1),
    Subject:      pkix.Name{CommonName: "test"},
    NotBefore:    time.Now(),
    NotAfter:     time.Now().Add(365 * 24 * time.Hour),
    DNSNames:     []string{"localhost"},
    KeyUsage:     x509.KeyUsageDigitalSignature,
    ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
}

priv, _ := ed25519.GenerateKey(rand.Reader)
// For a self-signed cert: parent and template are the same.
der, err := x509.CreateCertificate(rand.Reader, template, template, priv.Public(), priv)
```

The result is DER bytes. PEM-encode them with `pem.Encode`. For a
proper CA chain, `parent` is the issuing CA's certificate and the
last argument is the issuer's private key.

## 9. CertPool and SystemCertPool

Verifying a chain needs a set of trusted roots. `x509.CertPool` is
that set:

```go
roots, err := x509.SystemCertPool() // returns the OS trust store
if err != nil { return err }

opts := x509.VerifyOptions{
    Roots:       roots,
    CurrentTime: time.Now(),
    DNSName:     "example.com",
}
chains, err := cert.Verify(opts)
```

`SystemCertPool` reads the OS's CA bundle (Mozilla on Linux from
`/etc/ssl/certs`, Keychain on macOS, the Windows store). On
distroless or scratch containers, the bundle may not be present —
you'll get `crypto/x509: system roots are unavailable`. Either
include the CA bundle in the image (`COPY ca-certificates.crt`) or
build a `CertPool` from a curated set:

```go
roots := x509.NewCertPool()
if ok := roots.AppendCertsFromPEM(bundlePEM); !ok {
    return errors.New("no certs in bundle")
}
```

For pinning a specific issuer (private CA, internal mTLS), `roots`
contains only that CA.

## 10. `crypto/ecdh` — modern key exchange

Go 1.20 added `crypto/ecdh` — a clean ECDH API that doesn't expose
elliptic curve details:

```go
import "crypto/ecdh"

curve := ecdh.X25519()
priv, _ := curve.GenerateKey(rand.Reader)
pub := priv.PublicKey()

// Send pub.Bytes() over the wire.

// On the other side, given peerPub:
shared, err := priv.ECDH(peerPub)
// shared is 32 bytes for X25519.
```

The shared secret is *not* directly a key — feed it through HKDF
(HMAC-based key derivation) to derive symmetric keys:

```go
import "golang.org/x/crypto/hkdf"

h := hkdf.New(sha256.New, shared, salt, info)
key := make([]byte, 32)
io.ReadFull(h, key)
```

`salt` should be a fresh random value (or empty for protocols where
both sides agree on a fixed salt); `info` is a context label like
`"my-app session key v1"`. HKDF is the standard way to turn a
shared secret into one or more keys.

## 11. Password hashing and KDFs (not in stdlib)

The four functions that hash passwords correctly:

| Function | Package | Notes |
|----------|---------|-------|
| `argon2.IDKey` | `golang.org/x/crypto/argon2` | **Modern default**. Memory-hard. |
| `bcrypt.GenerateFromPassword` | `golang.org/x/crypto/bcrypt` | Old reliable. Caps password length at 72 bytes. |
| `scrypt.Key` | `golang.org/x/crypto/scrypt` | Memory-hard. Older than Argon2. |
| `pbkdf2.Key` | `golang.org/x/crypto/pbkdf2` | Old. Use only when a spec demands it (PBKDF2-SHA256). |

The pattern for argon2id:

```go
import "golang.org/x/crypto/argon2"

salt := make([]byte, 16)
rand.Read(salt)

// Tunable parameters: time=1, memory=64MiB, threads=4, hash=32 bytes.
hash := argon2.IDKey([]byte(password), salt, 1, 64*1024, 4, 32)

// Store: salt || hash, plus the parameters.
```

Real apps use a wrapper that bundles parameters with the hash, like
`github.com/alexedwards/argon2id`. Don't roll the wrapping yourself —
storing the hash without the parameters means you can't change the
parameters later.

bcrypt is simpler:

```go
import "golang.org/x/crypto/bcrypt"

hash, err := bcrypt.GenerateFromPassword([]byte(password), 12) // cost 12
ok := bcrypt.CompareHashAndPassword(hash, []byte(password)) == nil
```

bcrypt's "cost" is a logarithm; cost 12 means 4096 iterations. Bump
it as hardware gets faster — current recommendation is 12-14 for
interactive logins.

**Why this matters**: a password in the database, even if the column
is "hashed", is the only thing standing between a leak and account
takeover at every site the user reused that password on. The slow
hashing is the entire point.

## 12. Verifying a JWT manually (HS256 + RS256 sketch)

A JWT is `header.payload.signature`, base64url-encoded, separated by
dots. Verifying one with HS256 (HMAC-SHA256) and a 32-byte key:

```go
func verifyHS256(token, secret string) (json.RawMessage, error) {
    parts := strings.SplitN(token, ".", 3)
    if len(parts) != 3 { return nil, errors.New("malformed") }

    signingInput := parts[0] + "." + parts[1]
    sig, err := base64.RawURLEncoding.DecodeString(parts[2])
    if err != nil { return nil, err }

    mac := hmac.New(sha256.New, []byte(secret))
    mac.Write([]byte(signingInput))
    if !hmac.Equal(sig, mac.Sum(nil)) {
        return nil, errors.New("bad signature")
    }

    payload, err := base64.RawURLEncoding.DecodeString(parts[1])
    if err != nil { return nil, err }
    return payload, nil
}
```

For RS256 (RSA-PKCS#1 v1.5 with SHA-256):

```go
sigErr := rsa.VerifyPKCS1v15(pubKey, crypto.SHA256, sha256Sum(signingInput), sig)
```

In production, use a JWT library — there are subtle pitfalls (the
`alg: none` attack, key confusion when one verifier accepts both
HS256 and RS256). Listing them is beyond this leaf; the reference
is RFC 8725 ("JSON Web Token Best Current Practices").

## 13. Constant-time comparison: `crypto/subtle`

For comparisons of secrets:

```go
import "crypto/subtle"

ok := subtle.ConstantTimeCompare(a, b) == 1
```

Returns 1 if equal, 0 if not. Runs in time proportional only to
`len(a)` and `len(b)` — no early exit on first difference.

`hmac.Equal` is `subtle.ConstantTimeCompare` plus a length check.
For comparing tags from `hmac.New(...).Sum(nil)`, prefer `hmac.Equal`
(it's named for the use case). For comparing other secrets — API
keys, password reset codes, opaque tokens — use
`subtle.ConstantTimeCompare`.

The other functions in `crypto/subtle`:

| Function | Use it for |
|----------|------------|
| `ConstantTimeCompare(a, b)` | Equal byte slices? |
| `ConstantTimeSelect(v, x, y)` | Branchless `if v == 1 { x } else { y }` |
| `ConstantTimeByteEq(x, y)` | Equal bytes? |
| `ConstantTimeEq(x, y)` | Equal int32s? |
| `ConstantTimeLessOrEq(x, y)` | `x <= y`? branchless |
| `ConstantTimeCopy(v, dst, src)` | Copy `src` to `dst` if `v == 1` |

You will mostly use `ConstantTimeCompare`. The others matter when
you write low-level crypto — and you shouldn't be writing low-level
crypto.

## 14. PEM round-trip: certificate plus key

A common task: load a server's certificate and private key from disk
and present them to TLS:

```go
cert, err := tls.LoadX509KeyPair("server.crt", "server.key")
if err != nil { return err }

cfg := &tls.Config{Certificates: []tls.Certificate{cert}}
```

`tls.LoadX509KeyPair` does PEM decoding, parses the key (any of
the supported algorithms), parses the cert chain (one or more
`CERTIFICATE` blocks), and validates that the private key matches
the leaf certificate's public key. If you assemble the pieces
yourself (`tls.X509KeyPair` from in-memory PEM bytes), it does the
same checks.

For the server to present a chain, the cert file should contain
the leaf cert *first*, then any intermediate CAs. The browser will
follow the chain to a root in its trust store.

## 15. A real example: encrypting a file with AES-GCM

Putting AEAD, key derivation, and `crypto/rand` together:

```go
package main

import (
    "crypto/aes"
    "crypto/cipher"
    "crypto/rand"
    "io"
    "os"

    "golang.org/x/crypto/argon2"
)

func deriveKey(password string, salt []byte) []byte {
    return argon2.IDKey([]byte(password), salt, 1, 64*1024, 4, 32)
}

func encryptFile(in, out, password string) error {
    plaintext, err := os.ReadFile(in)
    if err != nil { return err }

    salt := make([]byte, 16)
    if _, err := rand.Read(salt); err != nil { return err }

    key := deriveKey(password, salt)
    block, err := aes.NewCipher(key)
    if err != nil { return err }
    aead, err := cipher.NewGCM(block)
    if err != nil { return err }

    nonce := make([]byte, aead.NonceSize())
    if _, err := rand.Read(nonce); err != nil { return err }

    f, err := os.Create(out)
    if err != nil { return err }
    defer f.Close()

    // File layout: salt(16) || nonce(12) || ciphertext+tag
    if _, err := f.Write(salt); err != nil { return err }
    if _, err := f.Write(nonce); err != nil { return err }
    ct := aead.Seal(nil, nonce, plaintext, nil)
    if _, err := f.Write(ct); err != nil { return err }
    return nil
}

func decryptFile(in, password string) ([]byte, error) {
    f, err := os.Open(in)
    if err != nil { return nil, err }
    defer f.Close()

    salt := make([]byte, 16)
    if _, err := io.ReadFull(f, salt); err != nil { return nil, err }

    key := deriveKey(password, salt)
    block, err := aes.NewCipher(key)
    if err != nil { return nil, err }
    aead, err := cipher.NewGCM(block)
    if err != nil { return nil, err }

    nonce := make([]byte, aead.NonceSize())
    if _, err := io.ReadFull(f, nonce); err != nil { return nil, err }

    ct, err := io.ReadAll(f)
    if err != nil { return nil, err }
    return aead.Open(nil, nonce, ct, nil)
}
```

Why this is usable but not perfect:

- It loads the entire file into memory. For multi-GB files, chunk
  with the caveats in section 2.
- It hardcodes argon2 parameters. Production code stores them with
  the file so they can be tuned later.
- It doesn't authenticate the salt or the parameters as AAD. A
  better design feeds `salt || nonce` into the AAD argument.
- It doesn't compress before encrypting. If your plaintext is
  compressible, compress first; AEAD adds 16 bytes overhead.

The kind of polish that takes a working example to production is
why "use a library" beats "build your own" almost every time.
[`age`](https://age-encryption.org) is the right library for this
exact use case in Go.

## 16. What to read next

- [senior.md](senior.md) — TLS configuration, mTLS, certificate
  rotation, `crypto/subtle` deeply, side channels.
- [professional.md](professional.md) — production patterns: KMS,
  envelope encryption, key rotation, secret hygiene.
- [find-bug.md](find-bug.md) — drills based on the bugs in this file.
- The package docs:
  [`crypto`](https://pkg.go.dev/crypto),
  [`crypto/cipher`](https://pkg.go.dev/crypto/cipher),
  [`crypto/ed25519`](https://pkg.go.dev/crypto/ed25519),
  [`crypto/ecdsa`](https://pkg.go.dev/crypto/ecdsa),
  [`crypto/rsa`](https://pkg.go.dev/crypto/rsa),
  [`crypto/x509`](https://pkg.go.dev/crypto/x509).
