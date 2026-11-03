# Vendored libraries

Self-hosted so the site doesn't depend on a CDN. Loaded by `/assets/js/motion.js`.

| Library | Version | Files | Licence |
|---|---|---|---|
| GSAP (core, ScrollTrigger, SplitText) | 3.15.0 | `gsap-3.15.0/` | GSAP Standard "no charge" licence, free for commercial use: https://gsap.com/standard-license |
| Lenis | 1.3.27 | `lenis-1.3.27/` | MIT (see `lenis-1.3.27/LICENSE`) |

Taken unmodified from the npm packages' `dist/` folders. To upgrade, put the
new files in a folder named after the new version and change the paths in
`assets/js/motion.js`, so returning visitors don't get a cached old copy.
