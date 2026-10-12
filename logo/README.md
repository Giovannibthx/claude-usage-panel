# Logo

The mark is a gauge: a 270-degree arc filled to 60%, with a caret marking how
far the window has run. Colors: orange `#D0683A` (`#E07A4B` on dark), ink
`#1D1B18`, track `#E4DFD6`, paper `#F6F4EF`.

## svg/

- `mark.svg`: the main version, for light backgrounds
- `mark-on-dark.svg`: for dark backgrounds
- `mark-mono-black.svg` / `mark-mono-white.svg`: monochrome
- `mark-small.svg`: no caret, thicker stroke, for 24 px and below
- `app-icon.svg`: app icon on the macOS grid (824/1024); `app-icon-square.svg`
  fills the frame

## png/

Three exports, for the places that take a raster: `mark-256.png` and
`mark-on-dark-256.png` (a README or a post that cannot embed SVG) and
`app-icon-512.png` (the extensions.gnome.org listing, the GitHub social
preview). The macOS sizes live in `macos/AppIcon.iconset/`; any other size is
rendered from the SVG when needed (`rsvg-convert -w 128 svg/mark.svg`).

## Where each client takes it from

| Surface | File |
| ------- | ---- |
| README | `svg/mark.svg` + `svg/mark-on-dark.svg` in a `<picture>` |
| GNOME top bar | drawn live by `lib/panelGauge.js`: the arc filled to the real percentage, tinted by severity |
| macOS app icon | `macos/AppIcon.iconset/` (16 to 1024 px), built into `AppIcon.icns` by `install.sh macos` |
| macOS menu bar | drawn live by `MenuBarGauge.swift`, same rule as GNOME |
| Site favicon | `docs/favicon.svg` (light/dark), `docs/favicon.ico`, `docs/apple-touch-icon.png` |
| Site nav | `docs/logo.svg` (= `svg/mark-on-dark.svg`) |
| OpenGraph card | `scripts/screenshots/render.mjs` inlines `svg/mark-on-dark.svg` |

Tip: the filled arc can be drawn live with the real percentage
(`stroke-dasharray = pct x 150.8` over `201.06`).
