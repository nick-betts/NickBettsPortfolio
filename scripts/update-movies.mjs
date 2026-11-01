// Pulls recent diary entries from Letterboxd and rebuilds the Movies pages:
// reviewed films go to data/movies.json (movies.html, movies-2.html, ...) and
// everything else to data/ratings.json. ratings.html lists both.
// Run by .github/workflows/update-movies.yml.
// Set FEED_FILE to read a saved feed instead of fetching it.
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";

const FEED_URL = "https://letterboxd.com/n1ckrich/rss/";
const POSTER_HOST = "https://a.ltrbxd.com/";
const REVIEWS_FILE = "data/movies.json";
const RATINGS_FILE = "data/ratings.json";
const SHELL_FILE = "movies.html";
const SITEMAP_FILE = "sitemap.xml";
const SITE_URL = "https://nbetts.com";
const START = "<!-- letterboxd:start -->";
const END = "<!-- letterboxd:end -->";
const PER_PAGE = 20;
const STAR_GROUPS = [5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1, 0.5, null];

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decode(text) {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, code) => {
    if (code[0] !== "#") return ENTITIES[code.toLowerCase()] ?? match;
    const hex = code[1].toLowerCase() === "x";
    return String.fromCodePoint(parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10));
  });
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function tag(item, name) {
  const match = item.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  if (!match) return "";
  const cdata = match[1].match(/^\s*<!\[CDATA\[([\s\S]*)\]\]>\s*$/);
  return cdata ? cdata[1] : decode(match[1]).trim();
}

function parseReview(description) {
  const paragraphs = [];
  for (const [, inner] of description.matchAll(/<p>([\s\S]*?)<\/p>/g)) {
    if (/<img\b/i.test(inner)) continue;
    const text = decode(inner.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "")).trim();
    if (text && !/^Watched on /.test(text)) paragraphs.push(text);
  }
  return paragraphs;
}

function parseFeed(xml) {
  const entries = [];
  for (const item of xml.match(/<item>[\s\S]*?<\/item>/g) ?? []) {
    const title = decode(tag(item, "letterboxd:filmTitle"));
    const watched = tag(item, "letterboxd:watchedDate");
    if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(watched)) continue; // lists and undated entries

    const description = tag(item, "description");
    const poster = decode(description.match(/<img\b[^>]*\bsrc="([^"]+)"/i)?.[1] ?? "");
    const rating = parseFloat(tag(item, "letterboxd:memberRating"));
    entries.push({
      id: tag(item, "guid"),
      source: "letterboxd",
      title,
      by: tag(item, "letterboxd:filmYear"),
      watched,
      rewatch: tag(item, "letterboxd:rewatch") === "Yes",
      rating: rating >= 0.5 && rating <= 5 ? rating : null,
      poster: poster.startsWith(POSTER_HOST) ? poster : "images/placeholders/poster.svg",
      review: parseReview(description),
    });
  }
  return entries;
}

const filmKey = (entry) => `${entry.title}|${entry.year ?? entry.by}`.toLowerCase();

function oldestDate(feed) {
  return feed.reduce((min, entry) => (entry.watched < min ? entry.watched : min), "9999");
}

function mergeReviews(saved, feed) {
  const inFeed = new Set(feed.map((entry) => entry.id));
  const reviewed = feed.filter((entry) => entry.review.length);
  const films = new Set(reviewed.map(filmKey));
  const oldest = oldestDate(feed);

  // Entries older than the feed reaches are kept. Newer ones missing from it were deleted.
  const kept = saved.filter((entry) => {
    if (inFeed.has(entry.id)) return false;
    if (entry.source === "manual") return !films.has(filmKey(entry));
    return entry.watched < oldest;
  });

  const number = (entry) => Number(entry.id.match(/\d+$/)?.[0] ?? 0);
  return [...kept, ...reviewed].sort(
    (a, b) => b.watched.localeCompare(a.watched) || number(b) - number(a)
  );
}

function sortTitle(title) {
  return title.replace(/^(the|a|an)\s+/i, "");
}

function byTitle(a, b) {
  return (
    sortTitle(a.title).localeCompare(sortTitle(b.title), "en", { sensitivity: "base" }) ||
    String(a.year).localeCompare(String(b.year))
  );
}

function mergeRatings(saved, feed, reviews) {
  const inFeed = new Set(feed.map((entry) => entry.id));
  const oldest = oldestDate(feed);
  const films = new Map();

  for (const entry of saved) {
    // A logged film that left the feed's date range but is gone from it was deleted
    if (entry.id && !inFeed.has(entry.id) && entry.date >= oldest) continue;
    films.set(filmKey(entry), entry);
  }
  for (const entry of feed) {
    if (entry.review.length) continue;
    const key = filmKey(entry);
    films.set(key, {
      id: entry.id,
      title: entry.title,
      year: entry.by,
      rating: entry.rating ?? films.get(key)?.rating ?? null,
      date: entry.watched,
    });
  }
  for (const entry of reviews) films.delete(filmKey(entry));
  return [...films.values()].sort(byTitle);
}

// The ratings page lists every film, so reviewed ones join in (newest review wins)
function withReviewedFilms(reviews, ratings) {
  const films = new Map();
  for (const entry of reviews) {
    const key = filmKey(entry);
    if (!films.has(key)) films.set(key, { title: entry.title, year: entry.year ?? entry.by, rating: entry.rating });
  }
  for (const film of ratings) films.set(filmKey(film), film);
  return [...films.values()].sort(byTitle);
}

function formatDate(iso) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function renderEntry(entry, index) {
  const name = escapeHtml(entry.title);
  const loading = index === 0 ? "" : ' loading="lazy"';
  const lines = [
    '          <article class="log-entry log-entry-movie">',
    `            <img class="log-cover" src="${escapeHtml(entry.poster)}" alt="${name} poster" width="600" height="900" decoding="async"${loading} />`,
    '            <div class="log-heading">',
    `              <h2 class="log-title">${name}</h2>`,
    `              <p class="log-by">${escapeHtml(entry.by)}</p>`,
  ];
  if (entry.rating) {
    lines.push(
      `              <p class="rating" role="img" aria-label="Rated ${entry.rating} out of 5 stars" style="--rating: ${entry.rating}"><span class="stars" aria-hidden="true">★★★★★</span> ${entry.rating}/5</p>`
    );
  }
  lines.push(
    `              <p class="log-date">${entry.rewatch ? "Rewatched" : "Watched"}: <time datetime="${entry.watched}">${formatDate(entry.watched)}</time></p>`,
    "            </div>"
  );
  if (entry.review.length) {
    lines.push('            <div class="log-writeup">');
    for (const paragraph of entry.review) lines.push(`              <p>${escapeHtml(paragraph)}</p>`);
    lines.push("            </div>");
  }
  lines.push("          </article>");
  return lines.join("\n");
}

function renderSection(label, entries, offset) {
  if (!entries.length) return "";
  const body = entries.map((entry, i) => renderEntry(entry, i + offset)).join("\n");
  return `        <section class="log">\n          <h2 class="subpage-label">${label}</h2>\n${body}\n        </section>\n`;
}

function renderSubnav(active, reviewCount, ratingCount) {
  const link = (name, href, label, count) =>
    `<a${active === name ? ' class="is-active" aria-current="page"' : ""} href="${href}">${label} (${count})</a>`;
  return (
    '        <nav class="subnav" aria-label="Movies">\n' +
    `          ${link("reviews", "/movies", "Reviews", reviewCount)}\n` +
    `          ${link("ratings", "/ratings", "Ratings", ratingCount)}\n` +
    "        </nav>\n"
  );
}

function pagePath(number) {
  return number === 1 ? "/movies" : `/movies-${number}`;
}

function renderPagination(number, total) {
  if (total < 2) return "";
  const previous =
    number > 1 ? `<a class="text-link" href="${pagePath(number - 1)}">Previous</a>` : "<span></span>";
  const next =
    number < total ? `<a class="text-link" href="${pagePath(number + 1)}">Next</a>` : "<span></span>";
  return (
    '        <nav class="pagination" aria-label="Reviews pages">\n' +
    `          ${previous}\n          <span>Page ${number} of ${total}</span>\n          ${next}\n` +
    "        </nav>\n"
  );
}

function starsLabel(rating) {
  return rating === null ? "Not rated" : `${rating} star${rating === 1 ? "" : "s"}`;
}

function groupId(rating) {
  return rating === null ? "not-rated" : `stars-${String(rating).replace(".", "-")}`;
}

function renderRatings(ratings) {
  const groups = STAR_GROUPS.map((rating) => ({
    rating,
    films: ratings.filter((film) => (film.rating ?? null) === rating),
  })).filter((group) => group.films.length);

  const jump = groups
    .map(({ rating }) => `          <a href="#${groupId(rating)}">${rating === null ? "Not rated" : rating}</a>`)
    .join("\n");
  const sections = groups
    .map(({ rating, films }) => {
      const rows = films
        .map((film) => {
          const stars =
            rating === null
              ? ""
              : `<span class="rating" role="img" aria-label="Rated ${rating} out of 5 stars" style="--rating: ${rating}"><span class="stars" aria-hidden="true">★★★★★</span></span>`;
          return `            <li class="rating-row"><span class="rating-title">${escapeHtml(film.title)} <span class="rating-year">${escapeHtml(String(film.year))}</span></span>${stars}</li>`;
        })
        .join("\n");
      return (
        `        <section class="rating-group" id="${groupId(rating)}">\n` +
        `          <h2 class="subpage-label">${starsLabel(rating)} (${films.length})</h2>\n` +
        `          <ul class="rating-list">\n${rows}\n          </ul>\n        </section>\n`
      );
    })
    .join("");
  return `        <nav class="rating-jump" aria-label="Jump to a rating">\n${jump}\n        </nav>\n${sections}`;
}

function fill(shell, list, { title, description, path }) {
  const start = shell.indexOf(START);
  const end = shell.indexOf(END);
  if (start < 0 || end < start) throw new Error(`Missing ${START} markers in ${SHELL_FILE}`);
  return `${shell.slice(0, start)}${START}\n${list}        ${shell.slice(end)}`
    .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
    .replace(/(name="description"\s+content=")[^"]*"/, `$1${description}"`)
    .replace(/(rel="canonical" href=")[^"]*"/, `$1${SITE_URL}${path}"`)
    .replace(/(property="og:title" content=")[^"]*"/, `$1${title}"`)
    .replace(/(property="og:description" content=")[^"]*"/, `$1${description}"`)
    .replace(/(property="og:url" content=")[^"]*"/, `$1${SITE_URL}${path}"`);
}

function buildPages(reviews, ratings) {
  const shell = readFileSync(SHELL_FILE, "utf8");
  const total = Math.max(1, Math.ceil(reviews.length / PER_PAGE));
  const allFilms = withReviewedFilms(reviews, ratings);
  const subnavReviews = renderSubnav("reviews", reviews.length, allFilms.length);

  for (let number = 1; number <= total; number += 1) {
    const entries = reviews.slice((number - 1) * PER_PAGE, number * PER_PAGE);
    const sections =
      number === 1
        ? renderSection("Most recent watch", entries.slice(0, 1), 0) + renderSection("Earlier", entries.slice(1), 1)
        : renderSection("Earlier", entries, 0);
    const html = fill(shell, subnavReviews + sections + renderPagination(number, total), {
      title: number === 1 ? "Movies | Nick Betts" : `Movies, page ${number} | Nick Betts`,
      description: "Movies Nick Betts has been watching, with ratings and reviews.",
      path: pagePath(number),
    });
    writeFileSync(number === 1 ? SHELL_FILE : `movies-${number}.html`, html);
  }

  // Remove pages left over from when there were more reviews
  for (const file of readdirSync(".")) {
    const match = file.match(/^movies-(\d+)\.html$/);
    if (match && Number(match[1]) > total) rmSync(file);
  }

  writeFileSync(
    "ratings.html",
    fill(shell, renderSubnav("ratings", reviews.length, allFilms.length) + renderRatings(allFilms), {
      title: "Movie ratings | Nick Betts",
      description: "Every movie Nick Betts has logged on Letterboxd, with ratings.",
      path: "/ratings",
    })
  );

  const sitemap = readFileSync(SITEMAP_FILE, "utf8").replace(/ *<url><loc>[^<]*\/(?:movies-\d+|ratings)<\/loc><\/url>\n/g, "");
  const extra = ["/ratings"];
  for (let number = 2; number <= total; number += 1) extra.push(pagePath(number));
  const anchor = `  <url><loc>${SITE_URL}/movies</loc></url>\n`;
  if (!sitemap.includes(anchor)) throw new Error("Movies page missing from the sitemap");
  writeFileSync(
    SITEMAP_FILE,
    sitemap.replace(anchor, anchor + extra.map((path) => `  <url><loc>${SITE_URL}${path}</loc></url>\n`).join(""))
  );
  return total;
}

async function loadFeed() {
  if (process.env.FEED_FILE) return readFileSync(process.env.FEED_FILE, "utf8");
  const response = await fetch(FEED_URL, {
    headers: { "User-Agent": "nbetts.com movie sync" },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Letterboxd returned ${response.status}`);
  return response.text();
}

const readJson = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : []);

const feed = parseFeed(await loadFeed());
// A failed or changed feed should never empty the pages
if (!feed.length) throw new Error("No film entries found in the feed");

const reviews = mergeReviews(readJson(REVIEWS_FILE), feed);
const ratings = mergeRatings(readJson(RATINGS_FILE), feed, reviews);
writeFileSync(REVIEWS_FILE, `${JSON.stringify(reviews, null, 2)}\n`);
writeFileSync(RATINGS_FILE, `${JSON.stringify(ratings, null, 2)}\n`);
const pages = buildPages(reviews, ratings);
console.log(`${feed.length} entries in feed, ${reviews.length} reviews on ${pages} page(s), ${ratings.length} ratings`);
