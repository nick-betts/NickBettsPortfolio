# NickBettsPortfolio

Static site for nbetts.com, hosted on Netlify. There is no build step.

- `*.html`: one file per page. These stay at the top level because the file name is the URL (`movies.html` is `/movies`).
- `css/`, `js/`: site styles and script.
- `images/`: one folder per page, plus `placeholders/` and the link preview image (`og.png`).
- `videos/`: the ApplIQ walkthrough.
- `Nick_Betts_Resume.pdf`: stays at the top level so its URL doesn't change.
- `_redirects`, `_headers`, `robots.txt`, `sitemap.xml`, `favicon.svg`: site settings.
- `data/movies.json`, `scripts/`, `.github/`: the Movies page syncs from Letterboxd every 3 hours. The job commits to `main`, so run `git pull` before making changes.
- `_originals/`: full-size source photos and video. Not part of the site and not in git.
