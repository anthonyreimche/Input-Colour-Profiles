# Input Colour Profiles for Safelight

Reads the colour profile a JPEG, PNG, WebP, AVIF or TIFF carries, and has Safelight convert from it without clipping. Colour outside sRGB, such as a phone's Display P3 or a scan in Adobe RGB, survives into the edit instead of being cut off as the photo opens.

Without it, Safelight decodes these files the way the browser does: it converts the embedded profile to 8-bit sRGB, and anything outside sRGB is clipped. A TIFF's profile is ignored altogether.

RAW photos aren't affected. Their colour comes from the camera.

## What it does

- **Converts from the embedded profile.** Each photo is read with its own profile and converted into Safelight's working space in floating point. A colour sRGB can't show comes through as a negative channel, as it does for RAW. Your edits can then bring it back in, and a wide-gamut export keeps it.
- **Assigns a profile.** Give a photo a different profile when its tag is wrong, or when it has none. The **Input Profile** panel in Develop does this for the open photo. **Assign input profile…** in the Library's right-click menu does it for every selected photo.
- **Reads files with no profile your way.** Preferences ▸ Extensions ▸ Input Colour Profiles ▸ **Files without a profile** sets the profile they're read as. The default is sRGB, which is what the browser assumes.
- **Takes your own profiles.** **Add profile…** in the panel adds an `.icc` or `.icm` file and gives it to the open photo. Remove takes it out again; photos that used it go back to their embedded profile.

Built in: sRGB, Display P3, Adobe RGB (1998), ProPhoto RGB, Rec. 2020 and linear sRGB.

## What it reads

- **Containers:**
  - JPEG (APP2, also split over several segments);
  - PNG (`iCCP`);
  - WebP (`ICCP`);
  - TIFF (the ICC tag);
  - AVIF and HEIF (a `colr` profile, or `nclx` codes for sRGB, Display P3 and Rec. 2020 with an SDR transfer).
- **Profiles:** RGB matrix and tone-curve profiles, and greyscale profiles. A profile built from lookup tables is read through the matrix and curves it carries alongside them, when it has them.

Some photos stay with Safelight's standard decode, which handles them as before. The panel says why. They are:

- a CMYK or Lab profile;
- a lookup-table profile without a matrix;
- an HDR transfer (PQ, HLG).

A photo whose profile works out to sRGB also stays with the standard decode. It would come out the same, and costs nothing extra.

## How it fits into Safelight

- The conversion is relative colorimetric through the ICC's D50 connection space, as matrix profiles chain anywhere else. The built-in profiles use the same primaries Safelight embeds when it exports. So a photo exported in Display P3 and imported again converts back to what it was.
- Safelight asks the extension for each photo's profile as it decodes the photo: in Develop, for export, for headless renders and for edited thumbnails. A plain Library thumbnail is still the browser's decode.
- Changing a photo's profile is like changing its rating: it doesn't go into the edit history, presets or copy and paste.
- The pixels are converted at 8 bits per channel, as the files are decoded today.

## Develop

```bash
npm install
npm run check    # typecheck, build, then test
```

`npm test` runs the unit tests. `test/bundle.test.ts` checks the built bundle, so it needs `npm run build` first. `test/real-profiles.test.ts` compares against the profiles Windows ships, and skips where they aren't installed.

Needs Safelight 3.2.3 or later.

## Licence

GPL-3.0-or-later. See [LICENSE](LICENSE).
