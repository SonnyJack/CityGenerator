# @citygen/web

The CityGenerator editor, a static site.

```sh
pnpm dev        # http://localhost:5173
pnpm build      # apps/web/dist
pnpm e2e        # Playwright; builds and serves a preview on :4173
```

`BASE_PATH` sets the Vite base for GitHub Pages (the workflow sets it to
`/<repo>/`). To run Playwright with a pre-installed Chromium, set
`PW_CHROMIUM_PATH=/path/to/chrome`.
