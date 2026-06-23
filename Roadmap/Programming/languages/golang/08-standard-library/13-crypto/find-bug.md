# 8.13 `crypto/*` — Find the Bug

> **Audience.** You can write the happy path. This file gives you the
> code paths that *look* right and aren't. Each section presents a
> snippet, asks you to spot the bug, then explains it. The bugs are
> drawn from real CVEs, real audit findings, and real bedtime stories
> from people who've lived through the incident. Read them before you
> ship something that ends up in a postmortem.

## Bug 1 — The MAC compared with bytes.Equal

```go
func verify(msg, tag, key []byte) bool {
    mac := hmac.New(sha256.New, key)
    mac.Write(msg)
    expected := mac.Sum(nil)
    return bytes.Equal(tag, expected)
}
```

The function returns the right answer. So what's wrong?

`bytes.Equal` returns at the first differing byte. An attacker who
can time the function — by measuring HTTP response latency, for
example — learns where the first mismatch is, then guesses byte by
byte instead of by the full 32-byte tag. The fix:

```go
return hmac.Equal(tag, expected)
```

`hmac.Equal` runs in time proportional to the length of the inputs,
not where they differ. The CVE list is full of variants of this bug
in popular libraries.

## Bug 2 — The fixed nonce

```go
func encrypt(key, plaintext []byte) ([]byte, error) {
    block, _ := aes.NewCipher(key)
    aead, _ := cipher.NewGCM(block)
    nonce := make([]byte, aead.NonceSize()) // all zeros
    return aead.Seal(nil, nonce, plaintext, nil), nil
}
```

It encrypts. It decrypts (with the inverse). The CI tests pass.

The bug: every ciphertext under this key shares the same nonce.
GCM under a fixed `(key, nonce)` is *catastrophically* broken —
two ciphertexts reveal the XOR of their plaintexts (recoverable
for English text, structured payloads, anything with low
entropy), and an attacker can forge new authentic ciphertexts.

The fix:

```go
nonce := make([]byte, aead.NonceSize())
if _, err := rand.Read(nonce); err != nil { return nil, err }
ct := aead.Seal(nonce, nonce, plaintext, nil) // prepend nonce
return ct, nil
```

The output is `nonce || ciphertext || tag` and the receiver splits
it back apart.

A particularly nasty variant: a counter-based nonce that resets
when the process restarts. If the counter starts from 0 every
time, every restart re-encrypts starting from nonce 0. Same
catastrophe. Persistent counter or random nonce — pick one.

## Bug 3 — `math/rand` for tokens

```go
import "math/rand"

func sessionID() string {
    b := make([]byte, 32)
    rand.Read(b) // math/rand.Read
    return base64.RawURLEncoding.EncodeToString(b)
}
```

The output looks random. The bug: `math/rand.Read` produces a
deterministic stream from the package's seed. As of Go 1.20, the
seed is auto-randomized per process — but the *output stream* is
still deterministic from that seed. An attacker who observes a few
session IDs can recover the seed (PRNG seed recovery is a known
problem, often only ~32 bits of entropy needed) and predict every
future session ID.

The fix: import `crypto/rand` and use that.

```go
import "crypto/rand"

func sessionID() (string, error) {
    b := make([]byte, 32)
    if _, err := rand.Read(b); err != nil { return "", err }
    return base64.RawURLEncoding.EncodeToString(b), nil
}
```

The error from `crypto/rand.Read` is essentially never non-nil on a
working system; check it anyway for a clear failure mode on
misconfigured containers.

## Bug 4 — Hashing the password directly

```go
func hashPassword(p string) string {
    sum := sha256.Sum256([]byte(p))
    return hex.EncodeToString(sum[:])
}
```

It hashes. It's deterministic. The bug: SHA-256 is fast — billions
of guesses per second on a GPU. A leaked password column with this
hashing is brute-forced for common passwords in seconds. There's
also no salt, so identical passwords produce identical hashes
(rainbow table friendly).

The fix: use argon2id (or bcrypt as a fallback):

```go
import "golang.org/x/crypto/argon2"

func hashPassword(p string) (string, error) {
    salt := make([]byte, 16)
    if _, err := rand.Read(salt); err != nil { return "", err }
    h := argon2.IDKey([]byte(p), salt, 1, 64*1024, 4, 32)
    return fmt.Sprintf("argon2id$%s$%s",
        base64.RawStdEncoding.EncodeToString(salt),
        base64.RawStdEncoding.EncodeToString(h)), nil
}
```

Real apps store the parameters in the encoded form so they can
upgrade later without losing existing accounts.

## Bug 5 — `InsecureSkipVerify` for "the cert keeps expiring"

```go
client := &http.Client{
    Transport: &http.Transport{
        TLSClientConfig: &tls.Config{
            InsecureSkipVerify: true, // TODO: fix the cert
        },
    },
}
```

The TODO has been there for two years. The bug: `InsecureSkipVerify:
true` skips *all* of stdlib's TLS verification — chain to root,
expiration, hostname matching. The connection is encrypted, but
anyone on the network can present a self-signed cert and you'll
accept it. The data is shipped to the attacker, encrypted to the
attacker, and decrypted by the attacker.

The fix is to fix the cert. If you really need a custom verifier
(cert pinning), use `VerifyConnection`:

```go
TLSClientConfig: &tls.Config{
    InsecureSkipVerify: true, // bypass default; replace with stricter logic below
    VerifyConnection: func(s tls.ConnectionState) error {
        if len(s.PeerCertificates) == 0 {
            return errors.New("no peer cert")
        }
        spki := sha256.Sum256(s.PeerCertificates[0].RawSubjectPublicKeyInfo)
        if !bytes.Equal(spki[:], expectedSPKI[:]) {
            return errors.New("pin mismatch")
        }
        // Also check expiration; stdlib didn't.
        if time.Now().After(s.PeerCertificates[0].NotAfter) {
            return errors.New("expired")
        }
        return nil
    },
},
```

Pinning is the *only* legitimate use of `InsecureSkipVerify: true`
in production.

## Bug 6 — The `alg: none` JWT

```go
func parseJWT(token string) (json.RawMessage, error) {
    parts := strings.Split(token, ".")
    if len(parts) != 3 { return nil, errors.New("malformed") }

    var hdr struct{ Alg string `json:"alg"` }
    raw, _ := base64.RawURLEncoding.DecodeString(parts[0])
    json.Unmarshal(raw, &hdr)

    switch hdr.Alg {
    case "none":
        // No signature to verify — return payload directly
        payload, _ := base64.RawURLEncoding.DecodeString(parts[1])
        return payload, nil
    case "HS256":
        // ... verify HMAC
    }
    return nil, errors.New("unknown alg")
}
```

The bug is in the `case "none"`. JWT spec defines `alg: none` for
unsigned tokens; a verifier that *accepts* it lets an attacker
forge any JWT by just setting `alg: none` and any payload they
want. There's no signature to verify because they said there
isn't.

The fix: reject `alg: none` unconditionally, and reject any `alg`
the verifier doesn't expect. RFC 8725 ("JWT BCP") spells out the
full ruleset. Use a vetted library and configure it to accept
*one* algorithm.

A related bug: a verifier that accepts both HS256 and RS256
without distinguishing. An attacker takes the server's RSA *public*
key, treats it as a HMAC key, and signs an HS256 JWT with it. The
verifier sees `alg: HS256` and verifies the HMAC against the same
public key — and accepts. Configuring the verifier with a single
allowed algorithm prevents this.

## Bug 7 — The signature without the message

```go
type Token struct {
    UserID    string `json:"uid"`
    Expiry    int64  `json:"exp"`
    Signature []byte `json:"sig"`
}

func verify(t *Token, key []byte) bool {
    mac := hmac.New(sha256.New, key)
    mac.Write([]byte(t.UserID))           // signs UserID
    return hmac.Equal(t.Signature, mac.Sum(nil))
}
```

The bug: `Expiry` isn't part of what's signed. An attacker takes a
legitimate token and modifies `exp` to a far-future timestamp; the
signature still verifies because it only covered `UserID`. The
token now never expires.

The fix: sign every field that matters. The classic recipe is to
sign a canonical encoding of the whole payload:

```go
canonical := fmt.Sprintf("%s|%d", t.UserID, t.Expiry)
mac.Write([]byte(canonical))
```

For real tokens, the signed encoding is the JWT structure
(`base64(header).base64(payload).base64(sig)` where the signature
covers the first two parts). Don't roll your own.

## Bug 8 — Trusting `r.Header.Get("X-Forwarded-For")`

```go
func userIP(r *http.Request) string {
    if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
        return xff
    }
    return r.RemoteAddr
}

func login(w http.ResponseWriter, r *http.Request) {
    if rateLimitedByIP(userIP(r)) {
        http.Error(w, "too many", 429)
        return
    }
    // ... auth ...
}
```

This isn't strictly crypto, but it's the kind of bug that breaks
crypto-adjacent rate limits. The bug: `X-Forwarded-For` is set by
the *client*. An attacker brute-forcing passwords sends a different
random IP in `X-Forwarded-For` per request and bypasses the rate
limit.

The fix: only trust `X-Forwarded-For` when the request comes from
a trusted proxy (whose IP you check via `r.RemoteAddr`). Better,
configure the proxy to set a header that includes a secret only it
knows, and verify that secret. Better still, use the proxy
protocol or a header your reverse proxy explicitly rewrites.

## Bug 9 — Plaintext-CBC then MAC vs encrypt-then-MAC

```go
// Wrong order: MAC the plaintext, then encrypt with CBC.
mac := hmac.New(sha256.New, macKey)
mac.Write(plaintext)
tag := mac.Sum(nil)

// Append tag to plaintext, encrypt the whole thing.
withMAC := append(plaintext, tag...)
ct := cbcEncrypt(encKey, iv, withMAC)

send(iv, ct)
```

The bug: this is "MAC-then-encrypt", which is vulnerable to the
class of padding-oracle attacks the industry spent two decades
discovering. The receiver decrypts *before* it can verify the MAC;
if decryption fails (bad pad), the receiver returns one error, and
if the MAC check fails it returns another. The attacker
distinguishes them by timing or response and recovers the
plaintext byte by byte.

The fix: encrypt-then-MAC, or use AEAD (GCM, ChaCha20-Poly1305)
which does the right thing automatically.

```go
ct := cbcEncrypt(encKey, iv, plaintext)

mac := hmac.New(sha256.New, macKey)
mac.Write(iv)
mac.Write(ct)
tag := mac.Sum(nil)

send(iv, ct, tag)
```

Receiver verifies the MAC over `iv || ct` first; only on success
does it decrypt. Equal-time failure on bad MAC.

For new code: use AES-GCM. The above pattern is what you'd
implement when an old protocol forces CBC.

## Bug 10 — Forgetting to authenticate the AAD

```go
type Record struct {
    Version    int
    Ciphertext []byte
    Nonce      []byte
}

func encrypt(key []byte, version int, pt []byte) Record {
    block, _ := aes.NewCipher(key)
    aead, _ := cipher.NewGCM(block)
    nonce := make([]byte, aead.NonceSize())
    rand.Read(nonce)
    ct := aead.Seal(nil, nonce, pt, nil) // AAD is nil
    return Record{Version: version, Ciphertext: ct, Nonce: nonce}
}

func decrypt(key []byte, r Record) ([]byte, error) {
    block, _ := aes.NewCipher(key)
    aead, _ := cipher.NewGCM(block)
    return aead.Open(nil, r.Nonce, r.Ciphertext, nil) // AAD nil too
}
```

The bug: `Version` is in plaintext alongside the ciphertext, but
not authenticated. An attacker who can modify the record changes
`Version` from 1 to 2 (which the application interprets
differently) without the receiver detecting tampering — `aead.Open`
only authenticates `Ciphertext` and `Nonce`.

The fix: pass the metadata as AAD.

```go
aad := []byte(fmt.Sprintf("v=%d", version))
ct := aead.Seal(nil, nonce, pt, aad)
// receiver passes the same aad to Open
```

If `version` is tampered with, `Open` fails. AAD authenticates
without encrypting — perfect for headers that need to be visible
but not modifiable.

## Bug 11 — The unbounded request body

```go
func handler(w http.ResponseWriter, r *http.Request) {
    body, _ := io.ReadAll(r.Body)
    var token string
    json.Unmarshal(body, &token)
    if !validToken(token) {
        http.Error(w, "unauthorized", 401)
        return
    }
    // ...
}
```

Not a crypto bug per se, but: an attacker sends a 10 GB JSON body.
`io.ReadAll` happily allocates 10 GB. OOM. Service crash. Repeat.

The fix: cap with `http.MaxBytesReader`:

```go
r.Body = http.MaxBytesReader(w, r.Body, 1<<20) // 1 MiB
```

This bug shows up around crypto endpoints (sign, verify, encrypt)
because they accept variable-length inputs. Cap the body
unconditionally at the boundary; let crypto code assume the input
is reasonable.

## Bug 12 — Loading the certificate after MinVersion is set

```go
cfg := &tls.Config{
    MinVersion: tls.VersionTLS12,
    Certificates: []tls.Certificate{cert},
}

// Later: rotate the cert.
cfg.Certificates = []tls.Certificate{newCert}
```

The bug: `tls.Config` is read concurrently by the TLS library while
your code is mutating `Certificates`. Concurrent map/slice access
on the live config is a race. Some platforms tolerate it; others
crash; some serve a half-rotated cert.

The fix: use `GetCertificate` instead of `Certificates`. The
function is called per-handshake and you control concurrency in
your own type:

```go
type certHolder struct {
    mu  sync.RWMutex
    cur *tls.Certificate
}
// ... use a sync.RWMutex around the swap ...
cfg.GetCertificate = func(_ *tls.ClientHelloInfo) (*tls.Certificate, error) {
    return holder.get(), nil
}
```

`tls.Config`'s zero value documents which fields are safe to mutate
after first use — most aren't.

## Bug 13 — Logging the secret

```go
type LoginRequest struct {
    Username string
    Password string
}

func login(w http.ResponseWriter, r *http.Request) {
    var req LoginRequest
    json.NewDecoder(r.Body).Decode(&req)
    log.Printf("login attempt: %+v", req) // bug
    // ...
}
```

`log.Printf("%+v", req)` prints `{Username:alice Password:hunter2}`.
The password is now in the log. Backups of the log have it. The
log shipper has it. The grep search someone runs while debugging
has it.

The fix: a redacted type.

```go
type Password string

func (p Password) String() string                { return "[REDACTED]" }
func (p Password) GoString() string              { return "[REDACTED]" }
func (p Password) MarshalJSON() ([]byte, error)  { return []byte(`"[REDACTED]"`), nil }
```

Now `%v` prints `[REDACTED]`. Internal code that needs the bytes
calls `string(p)` deliberately. The default formatting is safe.

Variants of this bug: logging the whole `*http.Request` (headers
include `Authorization: Bearer ...`), printing a struct in a panic
message, including request bodies in error responses returned to
the client.

## Bug 14 — Reusing a `cipher.Stream`

```go
stream := cipher.NewCTR(block, iv)
ct1 := make([]byte, len(pt1))
stream.XORKeyStream(ct1, pt1)

ct2 := make([]byte, len(pt2))
stream.XORKeyStream(ct2, pt2) // continues the keystream from where ct1 left off
```

The bug: `XORKeyStream` is stateful. The keystream advances with
each call. If you reset to the same `iv` and reuse the keystream
for two messages — same disaster as nonce reuse in GCM.

```go
// Wrong: same IV, two streams
stream1 := cipher.NewCTR(block, iv)
stream2 := cipher.NewCTR(block, iv)
stream1.XORKeyStream(ct1, pt1)
stream2.XORKeyStream(ct2, pt2)
// ct1 ⊕ ct2 = pt1 ⊕ pt2
```

The fix: distinct IV per message, generated randomly. And once
again: prefer AEAD (GCM) which integrates the nonce discipline
into the API.

## Bug 15 — The 1-byte off chunk

```go
// Streaming AES-GCM encryption in chunks (don't do this naively).
const chunkSize = 64 * 1024
counter := uint64(0)

for {
    n, err := r.Read(buf[:chunkSize])
    if n > 0 {
        nonce := make([]byte, 12)
        binary.BigEndian.PutUint64(nonce[4:], counter)
        counter++
        ct := aead.Seal(nil, nonce, buf[:n], nil)
        w.Write(ct)
    }
    if err == io.EOF { break }
    if err != nil { return err }
}
```

Two bugs:

1. **No "final chunk" marker.** An attacker who can truncate the
   stream cuts off the last chunk; the receiver can't tell. The
   fix is a final-chunk bit in the AAD: `aad = []byte{0}` for
   non-final, `aad = []byte{1}` for final.
2. **No total-stream binding.** Two recordings of the same data
   under the same key produce the same chunks. Reordering or
   replacing chunks across recordings is an attack vector. Bind
   the chunk index *and* a stream ID into the AAD.

This is the right snippet to internalize as "don't roll your own
streaming AEAD." The corrections turn it into a small protocol
that you have to specify and review carefully. Use a library
(`age`, `nacl/secretstream`) instead.

## Bug 16 — The signed URL with weak parameters

```go
func signURL(u string, key []byte, exp time.Time) string {
    payload := fmt.Sprintf("%s?exp=%d", u, exp.Unix())
    mac := hmac.New(sha256.New, key)
    mac.Write([]byte(payload))
    sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
    return payload + "&sig=" + sig
}
```

The bug: the URL is signed, but if the URL already contains a
query string (`u = "https://x.com/p?id=42"`), `payload` becomes
`https://x.com/p?id=42?exp=...`. That's malformed and almost
certainly not what the verifier sees when reconstructing.

A worse variant: the verifier strips the `sig=` parameter and
re-signs `u`. An attacker adds an `&admin=true` parameter; the
verifier strips only `sig`, signs `u + "&admin=true"`, and the
HMAC matches because that's what was originally signed.

The fix: canonicalize and parse the URL with `net/url`, sign a
canonical encoding of `(path, sorted-query-params, exp)`, and on
the verifier side parse and canonicalize the same way before
comparing.

## Bug 17 — Forgetting to verify the chain

```go
func handshake(conn net.Conn) error {
    state := tls.Server(conn, &tls.Config{
        Certificates: []tls.Certificate{srvCert},
        ClientAuth:   tls.RequireAnyClientCert, // not RequireAndVerify
    })
    if err := state.Handshake(); err != nil { return err }
    leaf := state.ConnectionState().PeerCertificates[0]
    return processClient(leaf.Subject.CommonName)
}
```

The bug: `RequireAnyClientCert` requires the client to *send* a
cert but doesn't verify it against `ClientCAs`. An attacker can
present a self-signed cert with `Subject.CommonName = "admin"`
and the server happily extracts the CN and uses it as identity.

The fix: `RequireAndVerifyClientCert` plus `ClientCAs` set to your
internal CA pool. The handshake fails on an unverified cert, the
handler never runs.

## Bug 18 — The half-baked custom verifier

```go
cfg := &tls.Config{
    InsecureSkipVerify: true,
    VerifyPeerCertificate: func(rawCerts [][]byte, _ [][]*x509.Certificate) error {
        cert, _ := x509.ParseCertificate(rawCerts[0])
        if cert.Subject.CommonName != "expected.example.com" {
            return errors.New("wrong CN")
        }
        return nil
    },
}
```

Three bugs in five lines:

1. `InsecureSkipVerify: true` plus `VerifyPeerCertificate` runs
   the custom verifier in place of stdlib's. The custom verifier
   doesn't check the chain, doesn't check expiration, doesn't
   check name match against SANs.
2. `Subject.CommonName` is deprecated for hostname matching;
   modern certs put the name in `DNSNames` (SAN). Pinning by CN
   accepts any cert with that CN regardless of who issued it.
3. There's no chain verification at all. A self-signed cert with
   the right CN passes.

The fix: use `VerifyConnection` instead of `VerifyPeerCertificate`
for application-specific extra checks (it runs *after* stdlib's
verification), or do *full* custom verification including chain
walking if you really need to replace stdlib's logic.

## Bug 19 — Storing the salt next to the hash without the parameters

```go
func hashPassword(p string) (string, error) {
    salt := make([]byte, 16)
    rand.Read(salt)
    h := argon2.IDKey([]byte(p), salt, 1, 64*1024, 4, 32)
    return base64.RawStdEncoding.EncodeToString(salt) + "$" +
        base64.RawStdEncoding.EncodeToString(h), nil
}
```

It works today. The bug: the parameters (`time=1, memory=64KiB,
parallelism=4`) are baked into the verification code. When you
upgrade the parameters next year, you can't tell which stored
hashes were computed with the old parameters and which with the
new — verification has to try both, or worse, you migrate
silently and break everyone's login.

The fix: store the parameters in the encoded string, PHC format:

```
$argon2id$v=19$m=65536,t=1,p=4$<salt>$<hash>
```

Now verification reads the parameters from the stored value and
applies them. Migration is "if stored params are weaker than
current default, recompute on next successful login."

## Bug 20 — The signed token without `aud`

```go
func issueToken(userID string, key []byte) string {
    claims := map[string]any{
        "sub": userID,
        "exp": time.Now().Add(time.Hour).Unix(),
    }
    return signJWT(claims, key)
}
```

The token works for the service that issues it. The bug: nothing
binds the token to *that* service. If service A and service B
share a signing key (common in microservice setups), a token
issued by A is also accepted by B — the user signs in to A and
gets credentials for B too, even though they should be separate
authentication boundaries.

The fix: include an `aud` (audience) claim and verify it on every
service:

```go
claims := map[string]any{
    "sub": userID,
    "aud": "service-a",
    "exp": time.Now().Add(time.Hour).Unix(),
}
```

The verifier rejects tokens whose `aud` doesn't match its own
service identity. Different services should also have different
keys when feasible — `aud` is defense-in-depth, separate keys
are the primary control.

## Bug 21 — The deterministic JWT ID

```go
func makeJTI(userID string, issuedAt time.Time) string {
    return userID + "-" + strconv.FormatInt(issuedAt.Unix(), 10)
}
```

The bug: `jti` is supposed to be unique per token, but if the
same user gets two tokens issued in the same second (a fast
client retrying), both tokens have the same `jti`. Now your
revocation list (which adds `jti` when a token is invalidated)
can't distinguish them — revoking one revokes both.

The fix: `jti` should be random:

```go
func makeJTI() string {
    b := make([]byte, 16)
    rand.Read(b)
    return base64.RawURLEncoding.EncodeToString(b)
}
```

`jti` is opaque to the consumer; randomness costs nothing and
removes the entire class of "two tokens with the same ID" bugs.

## How to use this list

For each bug:

1. Read the snippet first, before the explanation.
2. Try to spot the issue cold.
3. Check yourself against the explanation.
4. **Search your own code for the same shape.** That's the
   exercise that pays.

If you find one of these in a code review, don't soft-pedal the
fix — these aren't style issues, they're the difference between
"works" and "shows up on Hacker News for the wrong reasons."

## What to read next

- [optimize.md](optimize.md) — when the code is correct but slow.
- [interview.md](interview.md) — questions about these bugs.
- The Go security advisories list at https://pkg.go.dev/vuln/list —
  the ones in your dependencies are bugs you didn't write but
  inherit.
