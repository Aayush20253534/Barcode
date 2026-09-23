# BAR CODE — Beverages · Lounge · Venue

Cinematic website for BAR CODE, the bar & restaurant in Civil Lines, Prayagraj.

The homepage opens with a scroll-controlled film, generated with Higgsfield: the BAR CODE bottle is revealed, then it pours into a crystal glass, carbonation rises, and the shot pulls back to the bottle-and-glass hero. Every reservation button opens WhatsApp (+91 98380 70333) with a pre-filled message.

## Run locally

Requires Node.js 18 or newer. There are no dependencies to install.

```bash
npm start
```

Then open http://localhost:5173. You can also open `index.html` directly in a browser.

## Structure

```
index.html            page markup and content
assets/css/main.css   design system, layout, responsive and reduced-motion rules
assets/js/main.js     hero scroll-scrub, smooth scroll, reveals, parallax, drinks rail, gallery, menu, cursor
assets/js/vendor/     Lenis smooth-scroll (vendored)
assets/hero/d, m/     hero film frames — desktop 1280×720 and mobile 450×800 (WebP)
assets/hero/          end-frame posters and the finale bubbles loop
assets/img/           optimised venue photography (WebP, responsive sizes)
assets/logo/          official logo with a transparent surround, favicons
img/, details.txt     original supplied photos, logo and venue details
serve.mjs             zero-dependency local server
```

## Notes

- The hero film has 283 frames. `FILM` in `assets/js/main.js` sets the frame count, shot names and timing.
- Visitors with reduced motion turned on see a still hero instead of the scroll film.
- Only supplied information is used: address, hours, phone, average spend and dishes come from `details.txt`.
