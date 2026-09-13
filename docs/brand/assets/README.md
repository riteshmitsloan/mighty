# Mighty current-logo asset pack

This pack preserves the current two-circle Mighty identity and the full name **Mighty**. It contains no alternate mark or renamed brand. The app, favicon, and review-book pages were not changed.

## Start here

Root-level files are direct download aliases for the organized svg/, png/, and tokens/ folders. The ready-to-share archive is **mighty-brand-kit-v1.zip**.

- **svg/mighty-mark-source.svg** is an exact byte-for-byte copy of the current 31×22 source SVG: two radius 11 circles centered at (11,11) and (20,11), indigo #4A3FD1 and coral #E87A56, with multiply on the second circle.
- **svg/mighty-mark.svg** is the portable full-color mark. It uses the same geometry and colors, with a fixed #431E46 intersection. This color is the 8-bit sRGB multiply result on white. It has a transparent background and needs no CSS blend support. Its appearance is fixed; it does not adapt to a colored backdrop like the original multiply construction can. It is not a flattened opaque-white PNG.
- **svg/mighty-lockup.svg** combines that portable mark with actual outlined Schibsted Grotesk glyphs spelling Mighty. It needs no font installation or network request.
- **svg/mighty-mark-ink.svg**, **svg/mighty-mark-white.svg** and corresponding lockups are normal-blend monochrome variants. The two equal-color circles preserve the original union silhouette without a contrasting intersection. Use white on a dark surface.
- **svg/mighty-icon.svg** is the portable mark centered in a 40×40 transparent square. The mark retains its 31:22 aspect ratio. This is a packaging canvas, not a new glyph or a replacement of the app's differently proportioned existing favicon.
- **png/** includes transparent square icons at 16,32,48,128 and256 pixels, in portable color, ink and white.

## Wordmark and typeface

The outlined wordmark uses the exact bundled Schibsted Grotesk Latin variable font from @fontsource-variable/schibsted-grotesk 5.3.0, instantiated at wght 800, 19px with −0.3px tracking. The horizontal lockup uses a 10-unit gap from the 31-unit mark box to the text pen. The font's normal line metrics determine vertical centering in a 24-unit export canvas. Every letter is outlined from the font; no substitute font or invented letterform is used. The plain SVG text converter ignored variable weight in a trial, so exports explicitly use the renderer's wght 800 setting and verify different outlines from wght400.

The font file in **fonts/** is unmodified and includes its original SIL Open Font License. **tokens/mighty.css** provides a self-hosted font face, source colors and layout values, and a reusable HTML lockup class. **tokens/design-tokens.json** records geometry, typography and the existing mobile source values. Browser font shaping, normal line boxes and antialiasing may differ slightly from these Skia outlines; no cross-renderer pixel match is claimed.

## Verification

**verification/asset-proof.png** shows large lockups and actual-size PNG samples. **verification/checks.json** records source/font hashes, weight-instance checks, transparent corners, opaque mark centers, exact PNG dimensions, and sampled indigo/coral/fixed-overlap pixels. SVG and PNG exports use the installed @napi-rs/canvas Skia renderer. Review tiny icons at 100% zoom; enlarged thumbnails do not demonstrate 16-pixel legibility.

The portable files avoid CSS blending dependencies. Only the file explicitly named **source** preserves source multiply behavior. No color-profile conversion, print proof, browser accessibility test or trademark review was performed for this asset export.

Build record: generated locally by work/logo-review/build-assets.mjs. The ZIP contains the entire asset pack with source SVG, portable/monochrome vectors, PNGs, font and license, tokens, verification and this README.
