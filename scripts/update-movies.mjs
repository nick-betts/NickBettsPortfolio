// Pulls recent diary entries from Letterboxd into data/movies.json and rebuilds
// the list in movies.html. Run by .github/workflows/update-movies.yml.
// Set FEED_FILE to read a saved feed instead of fetching it.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const FEED_URL = "https://letterboxd.com/n1ckrich/rss/";
const PROFILE_URL = "https://letterboxd.com/n1ckrich/";
const POSTER_HOST = "https://a.ltrbxd.com/";
const DATA_FILE = "data/movies.json";
const PAGE_FILE = "movies.html";
const START = "<!-- letterboxd:start -->";
const END = "<!-- letterboxd:end -->";

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

function merge(saved, feed) {
  const inFeed = new Set(feed.map((entry) => entry.id));
  const films = new Set(feed.map((entry) => `${entry.title}|${entry.by}`));
  const oldest = feed.reduce((min, entry) => (entry.watched < min ? entry.watched : min), "9999");

  // Entries older than the feed reaches are kept. Newer ones missing from it were deleted.
  const kept = saved.filter((entry) => {
    if (inFeed.has(entry.id)) return false;
    if (entry.source === "manual") return !films.has(`${entry.title}|${entry.year}`);
    return entry.watched < oldest;
  });

  const number = (entry) => Number(entry.id.match(/\d+$/)?.[0] ?? 0);
  return [...kept, ...feed].sort(
    (a, b) => b.watched.localeCompare(a.watched) || number(b) - number(a)
  );
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

function renderPage(page, entries) {
  const start = page.indexOf(START);
  const end = page.indexOf(END);
  if (start < 0 || end < start) throw new Error(`Missing ${START} markers in ${PAGE_FILE}`);
  const list =
    renderSection("Most recent watch", entries.slice(0, 1), 0) +
    renderSection("Earlier", entries.slice(1), 1) +
    `        <p class="letterboxd-link"><a class="text-link" href="${PROFILE_URL}" rel="me noopener">More on Letterboxd</a></p>\n`;
  return `${page.slice(0, start)}${START}\n${list}        ${page.slice(end)}`;
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

const feed = parseFeed(await loadFeed());
// A failed or changed feed should never empty the page
if (!feed.length) throw new Error("No film entries found in the feed");

const saved = existsSync(DATA_FILE) ? JSON.parse(readFileSync(DATA_FILE, "utf8")) : [];
const entries = merge(saved, feed);
writeFileSync(DATA_FILE, `${JSON.stringify(entries, null, 2)}\n`);
writeFileSync(PAGE_FILE, renderPage(readFileSync(PAGE_FILE, "utf8"), entries));
console.log(`${feed.length} entries in feed, ${entries.length} on the page`);
