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

It always points at `releases/latest/download/…`, so the download links keep working
across releases without editing the widget.

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

The version label and DMG filenames are hard-coded to `1.0.0`, matching
[`index.html`](index.html). When you cut a new release with a different version number,
bump the version in **both** files:

| File | What to update |
|------|----------------|
| [`embed.html`](embed.html) | `v1.0.0` badge text + `…-1.0.0-arm64.dmg` / `…-1.0.0.dmg` URLs |
| [`index.html`](index.html) | `v1.0.0` badge + the same two DMG URLs |
