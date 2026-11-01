// One-off import of a Letterboxd data export into data/ratings.json. Use it to
// pick up ratings the feed can't see, then run update-movies.mjs to rebuild:
//   node scripts/import-letterboxd.mjs _originals/letterboxd-export-folder
// Only titles, years, and ratings are read. Nothing else in the export is used.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const RATINGS_FILE = "data/ratings.json";

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field || row.length) rows.push([...row, field]);
  const [header, ...body] = rows;
  return body.map((values) => Object.fromEntries(header.map((name, i) => [name, values[i] ?? ""])));
}

const folder = process.argv[2];
if (!folder) throw new Error("Pass the path of the export folder");
const read = (name) => parseCsv(readFileSync(join(folder, name), "utf8").replace(/^﻿/, ""));
const key = (title, year) => `${title}|${year}`.toLowerCase();

const films = new Map();
const saved = existsSync(RATINGS_FILE) ? JSON.parse(readFileSync(RATINGS_FILE, "utf8")) : [];
for (const film of saved) films.set(key(film.title, film.year), film);

for (const row of [...read("watched.csv"), ...read("diary.csv")]) {
  const id = key(row.Name, row.Year);
  if (!films.has(id)) films.set(id, { title: row.Name, year: row.Year, rating: null });
}
for (const row of read("ratings.csv")) {
  const rating = parseFloat(row.Rating);
  const id = key(row.Name, row.Year);
  films.set(id, { ...films.get(id), title: row.Name, year: row.Year, rating: rating >= 0.5 && rating <= 5 ? rating : null });
}

writeFileSync(RATINGS_FILE, `${JSON.stringify([...films.values()], null, 2)}\n`);
console.log(`${films.size} films saved to ${RATINGS_FILE}`);
