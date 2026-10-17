# Self-hosted fonts for document PDF render (TZ-BACKEND-DOCSTUDIO-BLOCK-STYLE)

The PDF pipeline renders with a server-side headless browser. The dev box
(Windows Chrome) and the production image (`node:20-alpine` + `chromium` +
`font-noto`/`ttf-dejavu`) have **no common system font set** (verified by live
`canvas.measureText` probe). Any "system font" whitelist entry would therefore
be silently substituted on at least one environment, and the operator would see
one typeface on screen and another in the PDF.

Fix: self-host metric-equivalent fonts and wire them via `@font-face` in the
render template, so **both** the screen checkbox and the server PDF load the
same glyph file.

| Display name (whitelist) | Backing font | License | Source |
|---|---|---|---|
| `Times New Roman` | Tinos | SIL OFL 1.1 | https://github.com/google/fonts/tree/main/ofl/tinos |
| `Arial` | Liberation Sans | GPLv2 + font exception | local LibreOffice/`/c/Windows/Fonts` |
| `Calibri` | Carlito | SIL OFL 1.1 | https://github.com/google/fonts/tree/main/ofl/carlito |

Only Regular / Bold / Italic are bundled (Bold-Italic is synthesized by the
browser from these faces). All files carry Cyrillic coverage.

- `LICENSE-OFL.txt` — SIL Open Font License 1.1 text covering Tinos and Carlito.
- Liberation Sans is distributed under the GPL v2 with the font embedding
  exception (see upstream liberation-fonts project); the three installed
  faces are copied from the local system, no derivative changes.

The whitelist constant lives in `template-block/font.menu.ts`; the render
service maps a display name to CSS via `@font-face` in
`styledTemplateFontCss()`, and `main.ts` serves this directory at `/fonts/*`.