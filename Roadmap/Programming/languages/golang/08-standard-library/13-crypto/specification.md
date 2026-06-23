# 8.13 `crypto/*` — Specification

> **Audience.** You want the contracts in one place: what the interfaces
> require, what the algorithms guarantee, what the package docs imply
> but spread across many pages. Distilled, no examples.

## 1. `hash.Hash`

```go
type Hash interface {
    io.Writer
    Sum(b []byte) []byte
    Reset()
    Size() int
    BlockSize() int
}
```

Contract:

- `Write` never returns an error. Return value is always `(len(p), nil)`.
- `Sum(b)` appends the digest to `b` and returns the result. The
  internal state is *not* modified — you can call `Sum` repeatedly
  to checkpoint, then `Write` more, then `Sum` again.
- `Reset` returns the hash to its initial state.
- `Size()` is the digest size in bytes.
- `BlockSize()` is the internal block size (used by HMAC).

Implementations: `crypto/sha256`, `crypto/sha512`, `crypto/sha1`,
`crypto/md5`, `crypto/hmac` (which wraps any of the above).

## 2. `cipher.Block`

```go
type Block interface {
    BlockSize() int
    Encrypt(dst, src []byte)
    Decrypt(dst, src []byte)
}
```

A keyed block cipher. `Encrypt` transforms exactly `BlockSize()`
bytes from `src` to `dst`. `dst` and `src` may alias only if exactly
the same.

Constructed by `aes.NewCipher(key)` with key length 16, 24, or 32.

Direct use is **discouraged** — use a mode (`cipher.NewGCM`,
`cipher.NewCTR`, `cipher.NewCBCEncrypter`) on top.

## 3. `cipher.AEAD`

```go
type AEAD interface {
    NonceSize() int
    Overhead() int
    Seal(dst, nonce, plaintext, additionalData []byte) []byte
    Open(dst, nonce, ciphertext, additionalData []byte) ([]byte, error)
}
```

Contract:

- `Seal` appends the encrypted+authenticated payload to `dst` and
  returns the result.
- `Open` decrypts and authenticates. On any tampering or wrong
  `additionalData`, returns a non-nil error and *does not* return
  any plaintext bytes.
- The output of `Seal` is `Overhead()` bytes longer than
  `plaintext` (the auth tag).
- The same `(key, nonce)` pair must **never** be used to encrypt two
  different plaintexts. Reuse breaks confidentiality and authenticity.

Implementations:

| Constructor | Nonce size | Tag size | Notes |
|-------------|-----------|----------|-------|
| `cipher.NewGCM(block)` | 12 | 16 | Standard GCM |
| `cipher.NewGCMWithNonceSize(block, n)` | n | 16 | Custom nonce size; `n != 12` is **discouraged** |
| `cipher.NewGCMWithTagSize(block, t)` | 12 | t | Custom tag size; **discouraged** |
| `chacha20poly1305.New(key)` | 12 | 16 | x/crypto |
| `chacha20poly1305.NewX(key)` | 24 | 16 | x/crypto, extended nonce |

## 4. `cipher.Stream` and `cipher.BlockMode`

```go
type Stream interface {
    XORKeyStream(dst, src []byte)
}

type BlockMode interface {
    BlockSize() int
    CryptBlocks(dst, src []byte)
}
```

Unauthenticated. CTR is a `Stream`; CBC is a `BlockMode`. Using
either without an authenticator (HMAC, encrypt-then-MAC) is
**unsafe** for data crossing a trust boundary.

## 5. `crypto.Hash`

```go
type Hash uint
```

Identifier for a hash algorithm. Values include `MD5`, `SHA1`,
`SHA224`, `SHA256`, `SHA384`, `SHA512`, `SHA3_256`, `SHA3_512`,
others.

- `(h Hash).New()` returns a `hash.Hash`. Panics if the underlying
  package isn't imported (`_ "crypto/sha256"`).
- `(h Hash).Available()` reports whether `New()` would succeed.
- `(h Hash).Size()` returns digest size without instantiating.

## 6. `crypto.Signer` and `crypto.Decrypter`

```go
type Signer interface {
    Public() PublicKey
    Sign(rand io.Reader, digest []byte, opts SignerOpts) (signature []byte, err error)
}

type SignerOpts interface {
    HashFunc() Hash
}

type Decrypter interface {
    Public() PublicKey
    Decrypt(rand io.Reader, msg []byte, opts DecrypterOpts) (plaintext []byte, err error)
}
```

Implemented by:

| Type | Sign | Decrypt |
|------|------|---------|
| `*rsa.PrivateKey` | Yes (PKCS#1 v1.5 or PSS via opts) | Yes (OAEP or v1.5 via opts) |
| `*ecdsa.PrivateKey` | Yes | No |
| `ed25519.PrivateKey` | Yes | No |

`SignerOpts` for RSA: `crypto.SHA256` (PKCS#1 v1.5) or
`*rsa.PSSOptions{Hash: crypto.SHA256}`. For ECDSA: `crypto.SHA256`.
For Ed25519: pass `crypto.Hash(0)` (signs the message directly) or
`&ed25519.Options{Hash: crypto.SHA512}` for Ed25519ph.

## 7. `crypto/rand`

```go
var Reader io.Reader

func Read(b []byte) (n int, err error)
func Int(rand io.Reader, max *big.Int) (*big.Int, error)
func Prime(rand io.Reader, bits int) (*big.Int, error)
```

`Reader` is OS-backed: `getrandom(2)` on Linux 3.17+, equivalent
syscalls elsewhere. `Read` may block briefly if the OS pool isn't
seeded; once seeded, returns instantly with full requested length.

Do not substitute `math/rand`. The `Reader` interface lets you pass
`crypto/rand.Reader` to functions that expect `io.Reader`.

## 8. `crypto/hmac`

```go
func New(h func() hash.Hash, key []byte) hash.Hash
func Equal(mac1, mac2 []byte) bool
```

`New` returns a keyed hash. `Equal` is constant-time over `mac1`
and `mac2`. Lengths may differ; the function returns false without
revealing where they differ.

For correct HMAC, `key` should be at least as long as the hash's
block size (64 bytes for SHA-256). Shorter keys are permitted but
weaker.

## 9. `crypto/subtle`

```go
func ConstantTimeCompare(x, y []byte) int
func ConstantTimeSelect(v, x, y int) int
func ConstantTimeByteEq(x, y uint8) int
func ConstantTimeEq(x, y int32) int
func ConstantTimeLessOrEq(x, y int) int
func ConstantTimeCopy(v int, x, y []byte)
func XORBytes(dst, x, y []byte) int
```

`ConstantTimeCompare` returns 1 if equal, 0 if not. Length mismatch
returns 0 without leaking content. For tag comparison after HMAC,
prefer `hmac.Equal` (it does the length check up front in a way
the use case prefers).

## 10. AES-GCM nonce rule

For a 12-byte random nonce, the safe limit is approximately 2^32
encryptions per key (birthday bound on 96-bit nonces). Beyond that,
the probability of a collision is non-negligible.

Mitigations:

- **Rotate the key** before reaching 2^32 messages.
- **Use ChaCha20-Poly1305 with NewX** (24-byte nonce) for keys with
  vastly more messages.
- **Use a counter-based nonce** if your producer is single-threaded
  and you can guarantee the counter never repeats. Combine with a
  random prefix to mitigate counter resets.

The unsafe approach: a fixed nonce. This is **catastrophic** in GCM
and breaks confidentiality after the second message under the same
nonce.

## 11. `crypto/x509` essentials

```go
func ParseCertificate(der []byte) (*Certificate, error)
func CreateCertificate(rand io.Reader, template, parent *Certificate, pub, priv any) ([]byte, error)
func ParsePKCS8PrivateKey(der []byte) (any, error)
func MarshalPKCS8PrivateKey(key any) ([]byte, error)
func ParsePKIXPublicKey(der []byte) (any, error)
func MarshalPKIXPublicKey(pub any) ([]byte, error)
```

`pub` and `priv` in `CreateCertificate` are interface-typed because
they accept any of `*rsa.PublicKey`/`*ecdsa.PublicKey`/`ed25519.PublicKey`
and the corresponding `crypto.Signer` for `priv`.

```go
type CertPool struct{}
func NewCertPool() *CertPool
func SystemCertPool() (*CertPool, error)
func (s *CertPool) AppendCertsFromPEM(pemCerts []byte) bool

type VerifyOptions struct {
    DNSName       string
    Intermediates *CertPool
    Roots         *CertPool
    CurrentTime   time.Time
    KeyUsages     []ExtKeyUsage
}
```

`Verify` checks the chain to a root in `Roots`, expiration against
`CurrentTime`, and the leaf SAN against `DNSName`.

## 12. `crypto/tls` essentials

```go
type Config struct {
    Certificates       []Certificate
    GetCertificate     func(*ClientHelloInfo) (*Certificate, error)
    RootCAs            *x509.CertPool
    ClientCAs          *x509.CertPool
    ClientAuth         ClientAuthType
    InsecureSkipVerify bool
    MinVersion         uint16
    MaxVersion         uint16
    NextProtos         []string
    CipherSuites       []uint16
    CurvePreferences   []CurveID
    VerifyConnection   func(ConnectionState) error
    VerifyPeerCertificate func(rawCerts [][]byte, verifiedChains [][]*x509.Certificate) error
    SessionTicketsDisabled bool
    ClientSessionCache ClientSessionCache
}
```

Defaults that you should rarely override:

- `MinVersion` should be `VersionTLS12` or `VersionTLS13`. Never
  set lower.
- `CipherSuites` for TLS 1.2 has a curated, secure default. Don't
  set unless complying with a regulator.
- `InsecureSkipVerify` should be `false` everywhere except
  cert-pinning code that does its own verification.

`ClientAuth` enum:

| Value | Meaning |
|-------|---------|
| `NoClientCert` | Don't request a client cert |
| `RequestClientCert` | Request, optional, don't verify |
| `RequireAnyClientCert` | Require, don't verify |
| `VerifyClientCertIfGiven` | Optional, verify if given |
| `RequireAndVerifyClientCert` | Require and verify |

## 13. PEM block types reference

| Type | Body | Parser |
|------|------|--------|
| `CERTIFICATE` | DER X.509 cert | `x509.ParseCertificate` |
| `CERTIFICATE REQUEST` | DER PKCS#10 | `x509.ParseCertificateRequest` |
| `PRIVATE KEY` | DER PKCS#8 (any algorithm) | `x509.ParsePKCS8PrivateKey` |
| `RSA PRIVATE KEY` | DER PKCS#1 RSA | `x509.ParsePKCS1PrivateKey` |
| `EC PRIVATE KEY` | DER SEC 1 | `x509.ParseECPrivateKey` |
| `PUBLIC KEY` | DER PKIX | `x509.ParsePKIXPublicKey` |
| `RSA PUBLIC KEY` | DER PKCS#1 RSA public | `x509.ParsePKCS1PublicKey` |
| `ENCRYPTED PRIVATE KEY` | DER PKCS#8 encrypted | not in stdlib (use third-party) |

## 14. Error sentinels

| Error | Meaning |
|-------|---------|
| `rsa.ErrMessageTooLong` | Plaintext exceeds key size minus padding |
| `rsa.ErrDecryption` | Generic decryption failure (constant-time, deliberately vague) |
| `rsa.ErrVerification` | Signature verification failed |
| `x509.UnknownAuthorityError` | Chain doesn't reach a trusted root |
| `x509.HostnameError` | DNSName doesn't match SANs |
| `x509.CertificateInvalidError` | Various: expired, not yet valid, name constraints, etc. |
| `tls.RecordHeaderError` | TLS record framing broken (bad data, not TLS) |

`rsa.ErrDecryption` is intentionally vague — distinguishing "wrong
key" from "bad padding" leaks information to a Bleichenbacher-style
attacker.

## 15. Algorithm choice cheat sheet

| Need | New code | Legacy interop |
|------|----------|----------------|
| Cryptographic hash | SHA-256 | SHA-1 (Git only), MD5 (legacy checksums) |
| Authenticated encryption | AES-256-GCM or ChaCha20-Poly1305 | — |
| Symmetric MAC | HMAC-SHA256 | — |
| Digital signature | Ed25519 | RSA-PSS, ECDSA-P256 |
| Key exchange | X25519 (`crypto/ecdh`) | ECDH P-256, RSA-OAEP for static |
| Password hashing | argon2id | bcrypt, scrypt, pbkdf2 |
| Key derivation from a shared secret | HKDF-SHA256 | — |
| Random bytes | `crypto/rand.Read` | — |
| Constant-time compare | `subtle.ConstantTimeCompare` / `hmac.Equal` | — |
