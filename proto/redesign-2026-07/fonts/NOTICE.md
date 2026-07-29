# Bundled fonts

Both faces in this folder ship inside the app bundle (see `css/fonts.css`) so typography is
identical offline in the WebView and at `:8124`. Both are licensed under the SIL Open Font
License 1.1, which permits bundling and redistribution in this form.

| File(s) | Family | Role | License |
| --- | --- | --- | --- |
| `PlusJakartaSans-*.ttf` | Plus Jakarta Sans (400/500/600/700/800) | UI and body copy — `--font` | SIL OFL 1.1 |
| `archivo-exp900.woff2` | Archivo Expanded 900 | Scores only — `--font-display` | SIL OFL 1.1 |

`archivo-exp900.woff2` is the same file the marketing site serves from
`web/landing/fonts/`, which is deliberate: the score in the app and the headline type on
onstandard.app are the same letterform. If one is ever re-subset or replaced, replace both.

Full license text: https://openfontlicense.org/open-font-license-official-text/
