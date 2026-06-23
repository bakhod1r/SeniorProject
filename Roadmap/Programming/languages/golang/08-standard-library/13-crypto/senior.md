# 8.13 `crypto/*` — Senior

> **Audience.** You've built the signing endpoints, you've shipped
> AES-GCM in the right places, and you've at least once been the one
> who debugged a TLS handshake at 3 AM. This file is the systems-level
> picture: the precise `crypto/tls` configuration that ships in
> production, mutual TLS, hot-reload of certificates via
> `GetCertificate`, the side channels you actually have to think about,
> and the one-paragraph summary of `crypto/subtle` you can use when
> reviewing PRs. The thread: **trust Go's defaults, distrust your own
> creativity, measure timing if it's user-controlled**.

## 1. The `tls.Config` that you ship

Go's TLS defaults are sane. The `tls.Config{}` zero value, fed to a
modern HTTP server, gives you TLS 1.2+, secure cipher suites, server
name indication, and proper certificate verification on the client
side. Most production configs only need to set a few fields:

```go
cfg := &tls.Config{
    MinVersion:       tls.VersionTLS12,
    Certificates:     []tls.Certificate{cert},
    NextProtos:       []string{"h2", "http/1.1"},
    CurvePreferences: []tls.CurveID{tls.X25519, tls.CurveP256},
}
```

Field by field:

- **`MinVersion: tls.VersionTLS12`**. The minimum *most* of the
  industry has converged on. Anything older has known weaknesses
  (TLS 1.0/1.1 are both retired by the IETF). For new internal
  systems, `tls.VersionTLS13` is the better floor.
- **`Certificates`**. The server's leaf certificate plus any
  intermediates. For SNI-based multi-cert serving, prefer
  `GetCertificate` (covered below).
- **`NextProtos`**. Application Layer Protocol Negotiation. For HTTP/2,
  include `"h2"`. For HTTP/3, you're outside `crypto/tls`'s scope —
  HTTP/3 needs `quic-go`.
- **`CurvePreferences`**. The default in modern Go is fine. Setting
  it explicitly documents intent.

Fields you almost never set:

- `CipherSuites` — for TLS 1.2 only. The defaults are good. If you set
  it, you're either complying with a regulator (FIPS, BSI) or
  accidentally weakening your config. Don't add ciphers; if anything,
  remove the legacy ones the defaults still allow for compatibility.
- `PreferServerCipherSuites` — was deprecated in Go 1.18; ignored now.
- `Renegotiation` — never enable. Renegotiation is a TLS 1.2 feature
  that's been a security minefield for a decade. TLS 1.3 removes it.
- `ClientAuth`, `ClientCAs` — only when doing mTLS (section 5).
- `VerifyConnection`, `VerifyPeerCertificate` — when you need
  application-level checks beyond what stdlib does. Powerful, easy to
  misuse (section 6).

The TLS 1.3 cipher suites are *not* configurable. The Go authors
chose three (TLS_AES_128_GCM_SHA256, TLS_AES_256_GCM_SHA384,
TLS_CHACHA20_POLY1305_SHA256) and that's the end of the discussion.
This is good — TLS 1.3 cipher choice was a primary source of past
bugs.

## 2. The client `tls.Config`

For an HTTP client:

```go
client := &http.Client{
    Transport: &http.Transport{
        TLSClientConfig: &tls.Config{
            MinVersion: tls.VersionTLS12,
        },
    },
}
```

The defaults handle:

- **Server certificate verification** — uses the system trust store.
- **SNI** — sets ServerName from the URL host.
- **Hostname matching** — verifies the cert's SAN entries against
  the host you're connecting to.

The single field that gets misused most: `InsecureSkipVerify: true`.
Setting this disables *all* of those checks. The TLS connection is
still encrypted, but you have no idea who you're talking to. An
attacker on the path between you and the server can intercept and
decrypt freely.

There are exactly two legitimate uses:

1. **Tests against a self-signed cert** where the test code is
   under your control and the connection never leaves your machine.
2. **Custom verification via `VerifyConnection`** where you do the
   verification yourself, deliberately bypassing the default to
   replace it with stricter logic (cert pinning).

Production code that has `InsecureSkipVerify: true` for any other
reason is a bug. The two common excuses — "we're behind a corporate
firewall" or "the cert keeps expiring and I can't deal with it" —
are wrong. Fix the cert.

## 3. SNI and `GetCertificate` for hot reload

A server hosting multiple domains uses Server Name Indication: the
client sends the hostname it wants in the TLS ClientHello, the server
selects a cert. Two ways to wire this up:

```go
cfg := &tls.Config{
    Certificates: []tls.Certificate{certA, certB},
}
```

stdlib looks at each cert's `Leaf.DNSNames` and picks the matching
one. Works for static configs.

For dynamic reload — rotating Let's Encrypt certs every 60 days
without restarting the server — use `GetCertificate`:

```go
type certStore struct {
    mu  sync.RWMutex
    cur *tls.Certificate
}

func (s *certStore) get() *tls.Certificate {
    s.mu.RLock()
    defer s.mu.RUnlock()
    return s.cur
}

func (s *certStore) set(c *tls.Certificate) {
    s.mu.Lock()
    s.cur = c
    s.mu.Unlock()
}

cfg := &tls.Config{
    GetCertificate: func(_ *tls.ClientHelloInfo) (*tls.Certificate, error) {
        return store.get(), nil
    },
}
```

`GetCertificate` is called on every handshake, *before* the server
chooses which cert to present. The `ClientHelloInfo` includes
`ServerName` (SNI), supported signature schemes, supported curves,
and ALPN protocols — enough to pick a cert per domain or per
client capability.

A reload goroutine:

```go
go func() {
    t := time.NewTicker(15 * time.Minute)
    defer t.Stop()
    for range t.C {
        cert, err := tls.LoadX509KeyPair(certPath, keyPath)
        if err != nil {
            log.Printf("cert reload: %v", err)
            continue
        }
        store.set(&cert)
    }
}()
```

The atomic swap means in-flight handshakes see either the old or the
new cert, never a half-loaded one. Existing connections are
unaffected — they keep using the cert they handshook with.

For a real Let's Encrypt setup, the right library is
`golang.org/x/crypto/acme/autocert`. It does `GetCertificate` for
you and handles the ACME challenge.

## 4. Verifying peer chains by hand: `VerifyConnection`

Most servers accept any client cert that chains to a trusted CA. For
a stricter check — pinning a specific issuer, requiring a specific
SAN, blocking a known-bad cert — use `VerifyConnection`:

```go
cfg := &tls.Config{
    VerifyConnection: func(s tls.ConnectionState) error {
        if len(s.PeerCertificates) == 0 {
            return errors.New("no peer cert")
        }
        leaf := s.PeerCertificates[0]

        if !slices.Contains(leaf.DNSNames, "client.internal") {
            return fmt.Errorf("unexpected SAN: %v", leaf.DNSNames)
        }

        // s.VerifiedChains is populated by stdlib's verification.
        // Inspect the issuer if you need to pin a specific intermediate.
        return nil
    },
}
```

`VerifyConnection` runs *after* stdlib's normal verification (chain
to a root in `RootCAs`/`ClientCAs`, expiration, name match). It's
the place for application-specific extra checks. Returning an error
aborts the handshake.

`VerifyPeerCertificate` runs *during* the handshake before stdlib's
verification. Use it only if you need to fully replace stdlib's
logic — say, for cert pinning where you skip the chain check
entirely. For "stdlib + extra rule," use `VerifyConnection`.

## 5. Mutual TLS (mTLS)

mTLS means both sides present certificates. The client proves its
identity to the server, in addition to the server proving its identity
to the client.

Server side:

```go
caPool := x509.NewCertPool()
caPool.AppendCertsFromPEM(internalCA)

cfg := &tls.Config{
    Certificates: []tls.Certificate{serverCert},
    ClientAuth:   tls.RequireAndVerifyClientCert,
    ClientCAs:    caPool,
    MinVersion:   tls.VersionTLS12,
}
```

`ClientAuth` modes, in order of strictness:

| Mode | Client must send cert? | Verify against ClientCAs? |
|------|------------------------|--------------------------|
| `NoClientCert` | No | n/a |
| `RequestClientCert` | Optional | No |
| `RequireAnyClientCert` | Yes | No |
| `VerifyClientCertIfGiven` | Optional | Yes if given |
| `RequireAndVerifyClientCert` | Yes | Yes |

For internal services, `RequireAndVerifyClientCert` is the right
choice. The server is now authenticating both sides; you can map
the client's cert subject to a service identity and use that for
authorization:

```go
mux := http.NewServeMux()
mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
    if r.TLS == nil || len(r.TLS.PeerCertificates) == 0 {
        http.Error(w, "client cert required", http.StatusUnauthorized)
        return
    }
    leaf := r.TLS.PeerCertificates[0]
    clientID := leaf.Subject.CommonName
    // ... authorize based on clientID
})
```

Client side, presenting a cert:

```go
clientCert, _ := tls.LoadX509KeyPair("client.crt", "client.key")
caPool := x509.NewCertPool()
caPool.AppendCertsFromPEM(serverCABundle)

client := &http.Client{
    Transport: &http.Transport{
        TLSClientConfig: &tls.Config{
            Certificates: []tls.Certificate{clientCert},
            RootCAs:      caPool,
            MinVersion:   tls.VersionTLS12,
        },
    },
}
```

`RootCAs` overrides the system trust store. For a private CA that
issues both server and client certs, this is exactly right — you
don't want to trust public CAs for an internal endpoint.

## 6. Cert pinning

Pinning means: instead of trusting any cert chained to a trusted CA,
trust *only* a specific cert (or its public key, or its issuer).
It's stricter than CA-based verification and used for high-stakes
connections where you control both endpoints.

```go
expectedSPKI := sha256.Sum256(expectedCert.RawSubjectPublicKeyInfo)

cfg := &tls.Config{
    InsecureSkipVerify: true, // we do verification ourselves
    VerifyConnection: func(s tls.ConnectionState) error {
        if len(s.PeerCertificates) == 0 {
            return errors.New("no peer cert")
        }
        spki := sha256.Sum256(s.PeerCertificates[0].RawSubjectPublicKeyInfo)
        if !bytes.Equal(spki[:], expectedSPKI[:]) {
            return errors.New("cert pin mismatch")
        }
        // Still check expiration and name yourself, since you bypassed stdlib.
        return nil
    },
}
```

Setting `InsecureSkipVerify: true` here is the *only* legitimate use
of that flag in production. The combination with `VerifyConnection`
replaces stdlib verification with strictly-stronger pinning logic.

Pin the **public key** (SPKI), not the cert itself, so a routine
re-issue with the same key doesn't break the pin. For rotation, pin
two keys: the current and the next.

## 7. The `crypto/subtle` review checklist

When you review a PR that touches secrets, scan for these:

| Pattern | Look for | The fix |
|---------|----------|---------|
| `bytes.Equal(tag, expected)` | comparing MACs, signatures, opaque tokens | `hmac.Equal` or `subtle.ConstantTimeCompare` |
| `if a[i] != b[i] { return ... }` | hand-rolled byte comparison loop | `subtle.ConstantTimeCompare` |
| `==` on a `[N]byte` from a `Sum` | comparing hash digests of secrets | `subtle.ConstantTimeCompare` (note: `[N]byte == [N]byte` is constant-time on most platforms but not guaranteed) |
| `if password != stored { ... }` | string comparison for password | password hashing, then `subtle.ConstantTimeCompare` on the hash |
| `strings.HasPrefix(token, "Bearer ")` then `strings.Contains(token, ...)` | parsing then scanning | Parse first; only constant-time-compare what's a secret |
| `if memcmp(...)` via cgo | calling out to C | use `crypto/subtle` |

`subtle.ConstantTimeCompare` returns 1 for equal, 0 for not. The
result type (`int`) lets you chain into `subtle.ConstantTimeSelect`
without branching. The lengths must match — if they don't, the
function returns 0 *without* the constant-time guarantee
(short-circuits on length mismatch). For comparing tags from HMAC,
the lengths always match by construction; for arbitrary input, length-pad
or use `hmac.Equal` (which checks length up front but in a way that
doesn't leak the *contents*).

The other cases for `subtle`:

- **Branching on a secret bit**: when computing `if k_bit == 1 { do
  expensive_thing }` is OK only if `expensive_thing` is also done in
  the other branch. Otherwise an attacker measuring time learns
  `k_bit`. `ConstantTimeSelect` does branchless choice between two
  precomputed values.
- **Padding-sensitive operations**: most padding-oracle problems come
  from returning early on a bad pad. Don't return early. Validate
  in constant time, then fail at the end.

You will mostly *not* write code that needs `subtle` directly. But
you will read code that needs it — and the cost of getting it wrong
is "we ship the secret over a side channel." Worth the awareness.

## 8. Side channels: cache, branch, memory

Three side channels matter for typical Go server code:

### Cache timing

Lookup tables indexed by secret data leak via L1/L2 cache. Classic
example: AES with a precomputed S-box accessed at `sbox[secretKey[i]]`.
The CPU caches some lines and not others; an attacker who can
observe cache state (collocated VM, malicious thread on the same
core) can recover the key.

Go's `crypto/aes` package addresses this:

- On x86 with AES-NI, `crypto/aes` uses the hardware instructions —
  no S-box, no table, no cache leak.
- On x86 without AES-NI, falls back to a software implementation
  that uses bitsliced S-boxes (constant-time).
- On ARM, similar story with ARMv8 AES instructions.

You can verify which path you're on:

```go
import "crypto/aes"
fmt.Println(aes.BlockSize) // always 16
// stdlib doesn't expose "is HW path?" directly; on Linux check /proc/cpuinfo for "aes".
```

The takeaway: don't write your own AES in Go. The stdlib version is
constant-time on every platform that supports the algorithm at all.

### Branch timing (early exit)

```go
// LEAKS: returns early on first mismatch.
func eq(a, b []byte) bool {
    if len(a) != len(b) { return false }
    for i := range a {
        if a[i] != b[i] { return false }
    }
    return true
}
```

An attacker timing this can binary-search the differing position.
The `subtle.ConstantTimeCompare` implementation does:

```go
func ConstantTimeCompare(x, y []byte) int {
    if len(x) != len(y) { return 0 }
    var v byte
    for i := range x {
        v |= x[i] ^ y[i]
    }
    return int(ConstantTimeByteEq(v, 0))
}
```

It runs the full length regardless of mismatches. The XOR-OR
accumulator is zero only if every byte matched.

### Memory access patterns

Hash table lookups, slice index validation (`x[i]` with `i` derived
from a secret), `map[string]bool` membership tests — all leak via
cache and branch prediction. For these, you need to redesign so the
secret isn't an index, or use constant-time alternatives. Most
application code doesn't need this; it matters for crypto
primitives, password verification, and code on the path between an
attacker and a secret.

## 9. Forward secrecy and key rotation

Forward secrecy means: if your long-term private key is stolen
tomorrow, *yesterday's* recorded traffic stays unreadable.

In TLS, this is achieved with ECDHE (Ephemeral ECDH) cipher suites.
A fresh keypair is generated per-handshake; the long-term server
key signs the ephemeral public key so the client knows it's
talking to the right server. Stealing the long-term key lets the
attacker impersonate the server going forward, but not decrypt
past sessions (the ephemeral keys were thrown away).

**TLS 1.3 always uses (EC)DHE.** It's not optional. If you're on
TLS 1.3, you have forward secrecy.

In TLS 1.2, the older RSA key-exchange suites (where the client
encrypts a session key with the server's public RSA key) do not
have forward secrecy. Stealing the server's RSA key lets you
decrypt every recorded session. Go's defaults disable RSA
key-exchange suites; you'd have to explicitly add them. Don't.

For at-rest encryption: rotate keys regularly so an attacker who
gets a key only gets the data encrypted under that key, not all
historical data. Section 10 covers the envelope pattern that makes
rotation cheap.

## 10. The envelope encryption pattern

You need to encrypt 100 GB of data and rotate keys without
re-encrypting all 100 GB. The pattern:

- A **KEK** (Key Encryption Key) lives in a KMS. You don't see its
  bytes; you call the KMS to wrap/unwrap.
- A **DEK** (Data Encryption Key) is generated per-object with
  `crypto/rand`. The DEK encrypts the actual data with AES-GCM.
- The DEK itself is wrapped (encrypted) with the KEK and stored
  alongside the encrypted data.

```
Object on disk:
  [wrapped DEK | nonce | ciphertext | tag]

To read:
  1. KMS.Unwrap(wrappedDEK) -> DEK
  2. AES-GCM.Open(DEK, nonce, ciphertext, ...) -> plaintext

To rotate KEK:
  - Generate new KEK in KMS.
  - For each object: KMS.Unwrap(wrappedDEK_old) with old KEK,
    KMS.Wrap(DEK) with new KEK, store new wrapped DEK.
  - Data ciphertexts are unchanged.
```

The DEK never leaves your process for more than a memory lifetime.
The KEK never leaves the KMS. Rotation re-wraps the DEKs (cheap),
not the data (expensive).

stdlib doesn't have the KMS half — you call AWS KMS, GCP KMS, or
HashiCorp Vault for that. The `crypto/cipher` half is what you write
in Go.

## 11. `crypto.Signer` with KMS

When the private key is in a KMS, you can't use `rsa.SignPSS`
directly — it wants `*rsa.PrivateKey`. The standard pattern:
implement `crypto.Signer` whose `Sign` calls the KMS.

```go
type kmsSigner struct {
    keyID string
    pub   crypto.PublicKey
    api   *kms.Client
}

func (k *kmsSigner) Public() crypto.PublicKey { return k.pub }

func (k *kmsSigner) Sign(_ io.Reader, digest []byte, opts crypto.SignerOpts) ([]byte, error) {
    return k.api.Sign(k.keyID, digest, opts.HashFunc())
}
```

Now any code that takes a `crypto.Signer` works:

```go
template := &x509.Certificate{ /* ... */ }
der, err := x509.CreateCertificate(rand.Reader, template, parent, k.Public(), k)
```

`x509.CreateCertificate` calls `k.Sign(...)`, which calls the KMS,
which signs in HSM-backed hardware. Your code never sees the private
key.

This is also how `tls.Config.Certificates` can hold a KMS-backed
key: build a `tls.Certificate` whose `PrivateKey` field is your
`crypto.Signer` (not a raw `*rsa.PrivateKey`). TLS will use it to
sign the handshake.

## 12. The `tls.ConnectionState` reference

After a handshake, both the server-side `*http.Request.TLS` and the
client-side `*http.Response.TLS` give you a `*tls.ConnectionState`:

| Field | Meaning |
|-------|---------|
| `Version` | TLS protocol version (e.g., `tls.VersionTLS13`) |
| `CipherSuite` | The negotiated cipher suite ID |
| `ServerName` | SNI value sent by the client |
| `NegotiatedProtocol` | ALPN result, e.g., `"h2"` |
| `PeerCertificates` | Cert chain the *peer* presented (client cert on server, server cert on client) |
| `VerifiedChains` | Chains stdlib verified back to a trust root |
| `DidResume` | True if this was a session resumption (no full handshake) |
| `TLSUnique` | tls-unique channel binding (TLS 1.2 only) |

Use `PeerCertificates[0]` for the leaf. `Subject.CommonName` is the
classic "who is this", but for modern certs you should look at
`DNSNames`/`URIs`/`IPAddresses` (the SANs); CN is being phased out.

## 13. Random in containers and on weird hardware

`crypto/rand` reads from the OS entropy source: `/dev/urandom` on
Linux, `getrandom(2)` if available, the equivalent on each OS. Two
edge cases:

1. **Distroless or scratch containers without `/dev/urandom`.**
   Some minimal images don't bind `/dev/urandom` from the host. On
   modern Linux Go uses `getrandom(2)` directly via the syscall, so
   this rarely matters anymore — but if you see `crypto/rand: failed
   to read random` on startup, check the container's `/dev` and use
   a base image that mounts it.

2. **VMs and early-boot.** Right after a VM starts, the kernel may
   not have collected enough entropy. `getrandom(2)` blocks until
   the pool is initialized; on Go, this means `rand.Read` blocks. On
   modern kernels (5.4+) with `RDRAND` (Intel/AMD) or
   `arch_random` (ARM), this is fast. On older kernels, you can
   wait seconds. The fix is at the OS level (`virtio-rng`, the
   `haveged` daemon) — Go can't help.

The quick check that the RNG works:

```go
b := make([]byte, 16)
if _, err := rand.Read(b); err != nil {
    log.Fatalf("crypto/rand broken: %v", err)
}
```

Run this at process startup. It catches misconfigured containers
before any business logic runs.

## 14. Logging, but not the secrets

The single most-violated rule: don't log secrets. The vectors:

- **Whole-struct logging** (`log.Printf("%+v", req)`) prints every
  field. Wrap secret-bearing fields in a type with a custom
  `String()` and `MarshalJSON` (see encoding-json
  professional.md, section 10).
- **Error messages** that include the input. `errors.New("bad token:
  " + token)` puts the token in the log. Drop it: `errors.New("bad
  token")`. The user already knows what they sent.
- **Trace span attributes**. OTel spans get exported. Don't put
  bearer tokens on a span.
- **Stack traces** with reflected struct values. Some panic recovers
  pretty-print the panic value; if that value contains a secret,
  it's now in the panic log.

For a server that handles tokens, build a "redacted" type and use
it everywhere:

```go
type Token string

func (t Token) String() string                { return "[REDACTED]" }
func (t Token) GoString() string              { return "[REDACTED]" }
func (t Token) MarshalJSON() ([]byte, error)  { return []byte(`"[REDACTED]"`), nil }
```

The internal code that *needs* the value calls `string(token)`
explicitly. Default formatting redacts.

## 15. Common errors at this level

| Symptom | Likely cause |
|---------|--------------|
| `tls: failed to verify certificate: x509: certificate signed by unknown authority` | Self-signed cert; not in `RootCAs`; system trust store missing in the container |
| `tls: client doesn't support certificate type ECDSA` | Mismatched `tls.Config.ClientCAs` or weird client; rarely real |
| `tls: bad record MAC` | Wrong cipher; clock skew; corrupted connection. Almost never an attack. |
| `tls: server selected unsupported protocol version 301` | Connecting to a server that downgrades to TLS 1.0/1.1; raise its `MinVersion` |
| `crypto/rsa: verification error` | Wrong key, wrong hash, wrong padding scheme, or actual tampering |
| `x509: cannot validate certificate for X because it doesn't contain any IP SANs` | Connecting by IP; cert needs an IP SAN; modern CAs don't issue them — connect by name |
| Slow first connection, fast after | DNS, OS root cert load, or session ticket warm-up |

For TLS debugging, `GODEBUG=x509ignoreCN=0,tlsdebug=1` and
`SSLKEYLOGFILE` (decrypt traffic in Wireshark) are the two flags you
should know.

## 16. What to read next

- [professional.md](professional.md) — KMS integration, envelope
  encryption, key rotation in production, secret hygiene.
- [specification.md](specification.md) — the contracts: `cipher.AEAD`,
  `crypto.Signer`, `hash.Hash`, nonce rules, distilled.
- [find-bug.md](find-bug.md) — TLS misconfigurations, comparison-timing
  bugs, nonce reuse, signature verification gone wrong.
- [optimize.md](optimize.md) — when AES-NI does or doesn't kick in,
  TLS handshake amortization, `crypto/rand` throughput.
- External: the [OWASP Cheat Sheet on TLS](https://cheatsheetseries.owasp.org/cheatsheets/Transport_Layer_Protection_Cheat_Sheet.html),
  the [Go security policy](https://go.dev/security/policy), and
  Filippo Valsorda's writeups on Go's crypto stack.
