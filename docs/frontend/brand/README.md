# Moventra identity

Based on `moventra-approved-reference.png`, the approved generated concept. The production artwork is a vector redraw with transparent backgrounds and outlined Public Sans lettering; the raster glow is omitted for clear rendering at navigation sizes.

- `public/brand/moventra-logo.svg`: cobalt symbol and navy wordmark for light backgrounds.
- `public/brand/moventra-logo-inverse.svg`: cobalt symbol and white wordmark for dark backgrounds.
- `public/brand/moventra-mark.svg`: standalone symbol.
- `public/favicon.svg`: symbol on a white rounded tile for browser tabs.

Use `src/components/BrandLogo.tsx` for the shared lockup. Preserve its aspect ratio; do not stretch or recolor individual paths. Brand blue is `#084CFF`; wordmark navy is `#071B38`. All SVG artwork uses paths, with no bitmap embeds, external font dependencies or scripts. Public Sans license is retained alongside this file.

Coverage: admin desktop/mobile navigation, desktop/mobile login, client landing and desktop/mobile navigation, page titles, and favicon. Existing API identifiers and demo credentials remain protocol values.
