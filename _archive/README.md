# Archived pages

Pages taken off the site but kept so they can come back later. Nothing in this
folder is served: `_redirects` sends `/_archive/*` to the 404 page.

- `sports.html` with `images/sports/`
- `gallery.html` with `images/gallery/`

To bring one back:

1. Move the page back to the site root, e.g. `git mv _archive/sports.html .`
2. Move its images back, e.g. `git mv _archive/images/sports images/`
3. Delete its lines from `_redirects`, add it back to `sitemap.xml`, and add a
   row for it in the More section of `home.html`.
