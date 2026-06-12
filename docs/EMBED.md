# Embeddable Download Widget

A compact, self-contained download card for the **Unifize Test Runner** that any
website can drop in with a single `<iframe>`. It is **not** the full landing page —
it's a small card sized for embedding in sidebars, docs, marketing pages, etc.

**Live URL:** https://prasadhelaskar-unifize.github.io/playwright-runner/embed.html

Source: [`embed.html`](embed.html)

---

## What it shows

- The Unifize logo, app name, and a `v1.0.0 · macOS 11+` badge
- Both download buttons — **Apple Silicon** and **Intel** — opening in a new tab
- A **Learn more →** link back to the full landing page

On load it queries the [GitHub Releases API](https://api.github.com/repos/prasadhelaskar-unifize/playwright-runner/releases/latest)
and rewrites the version badge and both download links to the **latest published
release** — so publishing a new release on GitHub updates the widget automatically,
with no edits. The hard-coded values in the markup are a fallback used only if the
API is unreachable.

---

## How to embed

### Basic — fixed height

```html
<iframe
  src="https://prasadhelaskar-unifize.github.io/playwright-runner/embed.html"
  width="404" height="400"
  style="border:0;overflow:hidden"
  title="Unifize Test Runner — Download"
  loading="lazy"></iframe>
```

### Auto-resizing (recommended)

The widget posts its rendered height to the parent window, so the iframe never clips
or leaves a gap. Listen for the `unifize-embed-height` message:

```html
<iframe id="unifize-embed"
  src="https://prasadhelaskar-unifize.github.io/playwright-runner/embed.html"
  width="404" style="border:0;width:100%;max-width:404px"
  title="Unifize Test Runner — Download" loading="lazy"></iframe>

<script>
  addEventListener('message', e => {
    if (e.data?.type === 'unifize-embed-height')
      document.getElementById('unifize-embed').style.height = e.data.height + 'px';
  });
</script>
```

---

## Design notes

- **Theme-aware** — transparent background plus `prefers-color-scheme`, so it blends
  into light *or* dark host pages automatically.
- **Zero dependencies** — no frameworks, no animations, no tracking. Safe to embed
  anywhere.
- **Responsive** — the card is fluid up to a `max-width` of 380px.

---

## Maintenance

The widget pulls the version and download links from the latest GitHub Release at
runtime, so **no edit is needed when you publish a new release** — just make sure the
release has two `.dmg` assets and the Apple Silicon one has `arm64` in its filename.

The only hard-coded values are the fallback `href`/badge in the markup, used when the
GitHub API can't be reached (e.g. rate limiting — unauthenticated calls are limited to
60/hour per IP). Refresh those occasionally so the fallback isn't wildly out of date.

> Note: the full landing page ([`index.html`](index.html)) still hard-codes the version
> and DMG URLs. Bump those there on each release, or port this same auto-fetch script
> over to it.
