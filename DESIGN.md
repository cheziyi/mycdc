# Design decisions

These are the decisions that took some back-and-forth, written down so nobody
has to work them out twice. Each one says what we chose, what we tried instead,
and what settled it. If you're about to change one of these areas, it's worth a
read first.

## Credential blob

The `creds` parameter is these bytes, base64url encoded:

| Bytes | Holds |
| --- | --- |
| 0 | Version, `0x01` |
| 1 to 65 | The browser's ephemeral public key, as a raw uncompressed P-256 point |
| 66 to 77 | The AES-GCM IV |
| 78 onwards | The ciphertext of `{"id": …, "pw": …}`, with the 16-byte GCM tag appended |

The ephemeral public key does two jobs: it's the HKDF salt and the GCM
additional data. That way, a ciphertext moved into a blob with a different
ephemeral key simply fails to decrypt.

`public/app.js` encrypts and `src/ecies.ts` decrypts, so the two need to change
together.

## Retries live in `call`

- **We chose:** `call` in `src/cdc.ts` repeats any request whose reply looks
  transient.
- **We tried:** a retry loop in `signIn`, and another around `fetchBookings`.
- **What settled it:** CDC answers 206 intermittently on both endpoints, so one
  loop covers both.

`call` hands back the last reply without interpreting it. That's deliberate: a
206 that outlasts the attempts means rejected credentials at sign-in, but a
fault at booking/summary, and only the caller knows which.

## An empty booking list is requested twice

- **We chose:** `fetchBookingSummary` asks for an empty list a second time.
- **We tried:** returning the first empty list.
- **What settled it:** CDC sometimes answers an account that has bookings with
  an empty list and `code` 201, and `call` can't tell that from a real answer.

The cost is small: a learner who really has no bookings costs one extra request
per cache miss.

## The event summary is CDC's code

- **We chose:** the summary is the booking's code, such as `2BL2`, exactly as
  CDC writes it.
- **We tried:** expanding the code into a friendlier title.
- **What settled it:** the CDC app and the counter staff both use the code, so
  an expanded title made the calendar disagree with them.

## Fonts are served from `public/fonts/`

- **We chose:** self-hosted WOFF2 files.
- **We tried:** Google Fonts.
- **What settled it:** the FAQ in `public/index.html` names every third-party
  host the page contacts, and a font service added two.

## The Google tag sets cookies

- **We chose:** the unmodified Google tag, with the page naming its two cookies.
- **We tried:** `client_storage: "none"` in the `gtag("config", …)` call.
- **What settled it:** we measured it. A page with that field and a page without
  it both wrote `_ga` and `_ga_<ID>`.

If you'd like the page to set no cookies, Consent Mode
(`analytics_storage: "denied"`) is the route Google supports. Please measure it
before the page says so.

## The social card is committed

`npm run og` writes `public/og.png` and the PNG icons, and they're committed
instead of being drawn at deploy. The script asks for Figtree and Newsreader and
falls back to system typefaces, so what it draws depends on the machine that
runs it. Drawing once and committing the result keeps the card the same
everywhere.

## `overrides.sharp` in `package.json`

wrangler depends on miniflare, which pins sharp `0.35.2`, a version affected by
GHSA-rgj7-g3m4-5g8c. The override raises it to `^0.35.4`. Once miniflare pins
`0.35.4` or later, the override can go.
