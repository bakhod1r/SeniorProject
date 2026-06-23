# 8.13 `crypto/*` — Index

Cryptography in Go's standard library: hashes, MACs, AEAD ciphers,
public-key signing, X.509 certificates, and TLS. The leaf is opinionated:
**use the high-level primitives, never invent your own protocol, and
default to `crypto/rand` for any byte that has to be unguessable**.

## Files

| File | Audience |
|------|----------|
| [junior.md](junior.md) | First contact: hashes, HMAC, `crypto/rand`, AES-GCM, the only RNG to use |
| [middle.md](middle.md) | Streams, AEAD layout, RSA/ECDSA/Ed25519 sign-and-verify, X.509 basics |
| [senior.md](senior.md) | TLS configuration, mTLS, hot-reload certs, side channels, `crypto/subtle` |
| [professional.md](professional.md) | Production patterns: KMS boundaries, key rotation, secret hygiene |
| [specification.md](specification.md) | The contracts: `hash.Hash`, `cipher.AEAD`, `crypto.Signer`, nonce rules |
| [interview.md](interview.md) | Questions you should answer without notes |
| [tasks.md](tasks.md) | Exercises: build a token signer, an mTLS server, a KEK/DEK envelope |
| [find-bug.md](find-bug.md) | Real bugs that ship to production — find and fix them |
| [optimize.md](optimize.md) | When the crypto is correct but the throughput isn't |

## Cross-links

- [`../04-encoding-json/`](../04-encoding-json/) — signed JSON tokens
- [`../11-net-http-internals/`](../11-net-http-internals/) — TLS in the HTTP server
- [`../12-encoding/`](../12-encoding/) — PEM, base64, and the encoding side
- [`../05-os/`](../05-os/) — secure file modes for key files
