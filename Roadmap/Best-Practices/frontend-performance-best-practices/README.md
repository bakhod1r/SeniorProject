# Frontend Performance Best Practices

- Roadmap: https://roadmap.sh/best-practices/frontend-performance

## 1. Performance Targets
- 1.1 Page Load Time Below 3s
- 1.2 Keep TTFB Below 1.3s
- 1.3 Page Weight Below 1500 KB
- 1.4 Minimize HTTP Requests
- 1.5 Avoid 404 Files
- 1.6 Page Speed Insights (Core Web Vitals)

## 2. HTML
- 2.1 Minify HTML
- 2.2 Minimize iframe Count
- 2.3 Avoid Multiple Inline JS Snippets
- 2.4 Avoid Inline CSS

## 3. CSS
- 3.1 Inline Critical CSS (above the fold)
- 3.2 Make CSS Files Non-Blocking
- 3.3 Concatenate CSS into a Single File
- 3.4 Minify CSS
- 3.5 Remove Unused CSS
- 3.6 Analyse Stylesheet Complexity
- 3.7 Prevent Flash of Unstyled Text

## 4. JavaScript
- 4.1 Use Non-Blocking JavaScript (`async`, `defer`)
- 4.2 Minify JavaScript
- 4.3 Analyze JavaScript for Performance Issues
- 4.4 Check Dependency Size (BundlePhobia)
- 4.5 Keep Dependencies Up-to-Date

## 5. Images
- 5.1 Choose Image Format Appropriately (WebP, AVIF, SVG)
- 5.2 Prefer Vector Images (SVG)
- 5.3 Compress Your Images
- 5.4 Serve Exact-Size Images (responsive `srcset`)
- 5.5 Set Width and Height on Images (CLS)
- 5.6 Load Offscreen Images Lazily
- 5.7 Avoid Base64 Images
- 5.8 Squoosh.app for Compression

## 6. Fonts
- 6.1 Keep Web Fonts Under 300 KB
- 6.2 Use WOFF2 Font Format
- 6.3 Use Preconnect to Load Fonts

## 7. Network and Transport
- 7.1 Use HTTPS
- 7.2 Use Same Protocol (avoid mixed content)
- 7.3 Enable Compression (gzip, brotli)
- 7.4 Use HTTP Cache Headers
- 7.5 Use CDN
- 7.6 Pre-load URLs Where Possible

## 8. Service Workers and Caching
- 8.1 Use Service Workers for Caching
- 8.2 Use HTTP Cache Headers

## 9. Cookies
- 9.1 Keep Cookie Count Below 20
- 9.2 Cookie Size Less Than 4096 Bytes

## 10. Measurement Tools
- 10.1 Lighthouse
- 10.2 Chrome DevTools
- 10.3 Page Speed Insights
- 10.4 WebPageTest
- 10.5 BundlePhobia
- 10.6 Squoosh

## 11. Framework Guidance
- 11.1 Framework-Specific Performance Guides
- 11.2 Recommended Guides and Resources
