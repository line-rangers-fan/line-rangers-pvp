# Private-repository development preview

The GitHub repository remains private and GitHub Pages is not used to expose the work-in-progress site.

A Cloudflare Worker bundles the current `docs/` assets from the private repository and serves a **no-login development preview**. The Worker strips the repository's maintenance wrapper only at delivery time. The repository copy of `docs/index.html` deliberately keeps `maintenance-mode`, `noindex`, and `nofollow` so an accidental direct Pages exposure does not silently publish the work-in-progress site.

The preview also sends `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet` and `Cache-Control: no-store`.

Because the preview has no login gate, anyone who knows its URL can view it. Do not place secrets or private-only content in `docs/`.
