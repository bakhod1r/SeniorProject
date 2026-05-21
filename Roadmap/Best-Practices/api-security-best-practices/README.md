# API Security Best Practices

- Roadmap: https://roadmap.sh/best-practices/api-security

## 1. Authentication
- 1.1 Use Standard Authentication (do not invent your own)
- 1.2 Authentication Mechanisms
- 1.3 Centralized Logins (single auth service)
- 1.4 Endpoint Authentication (every endpoint protected by default)
- 1.5 Good JWT Secret (high-entropy, rotate)
- 1.6 JWT Algorithm (no `none`, no `HS*` with public secret)
- 1.7 JWT Payload (no PII, no secrets)
- 1.8 Token Expiry (short-lived access, refresh tokens)
- 1.9 Max Retry / Jail (brute-force lockout)

## 2. Authorization
- 2.1 Authorization Header (Bearer, not query string)
- 2.2 OAuth Validate Scope
- 2.3 OAuth Redirect URI (whitelist exact match)
- 2.4 OAuth State Parameter (CSRF protection)
- 2.5 Response Type Token (avoid implicit flow)
- 2.6 Restrict Private APIs (network-level isolation)
- 2.7 Avoid Personal IDs in URLs (no `/users/email@x.com`)

## 3. Transport and Headers
- 3.1 Use HTTPS Everywhere
- 3.2 HSTS Header
- 3.3 CSP Header
- 3.4 No-Sniff Header (`X-Content-Type-Options: nosniff`)
- 3.5 Remove Fingerprint Header (`Server`, `X-Powered-By`)

## 4. Input and Output
- 4.1 Force Content-Type
- 4.2 Validate Content-Type
- 4.3 Proper HTTP Methods (GET/POST/PUT/DELETE per RFC)
- 4.4 Proper Response Code (no `200` for errors)
- 4.5 Payload Size Limits
- 4.6 Prefer UUIDs over Sequential IDs
- 4.7 Disable Entity Expansion (XXE/Billion Laughs)
- 4.8 Disable Entity Parsing in XML

## 5. Data Protection
- 5.1 Avoid Sensitive Data in URLs / Query Params
- 5.2 Avoid Logging Sensitive Data
- 5.3 Sensitive Data Encryption (at rest)
- 5.4 Only Server-Side Encryption (never trust client crypto)

## 6. Infrastructure
- 6.1 API Gateway (single ingress)
- 6.2 CDN for File Uploads
- 6.3 Use IDS/IPS Systems
- 6.4 Throttle Requests (per-user, per-endpoint)
- 6.5 Avoid HTTP Blocking (async I/O)

## 7. Code, Dependencies and Deployment
- 7.1 Check Dependencies (audit, SBOM)
- 7.2 Run Security Analysis (SAST/DAST)
- 7.3 Code Review Process
- 7.4 Debug Mode Off (in production)
- 7.5 Directory Listings Disabled
- 7.6 Non-Executable Stacks
- 7.7 Rollback Deployments (safe rollback path)
- 7.8 Unit and Integration Tests

## 8. Monitoring
- 8.1 Monitor Everything
- 8.2 Set Alerts on Anomalies
