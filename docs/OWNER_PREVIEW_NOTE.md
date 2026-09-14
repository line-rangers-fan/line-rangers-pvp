# Owner preview loading note

The authenticated Cloudflare preview must set explicit MIME types when proxying files from `raw.githubusercontent.com`.

Without this, `X-Content-Type-Options: nosniff` can cause browsers (notably Safari) to reject proxied JavaScript and CSS served as `text/plain`, leaving the page stuck at the initial loading state.

Required mappings include JavaScript, CSS, JSON, HTML, images, fonts, and video types used by the site.
