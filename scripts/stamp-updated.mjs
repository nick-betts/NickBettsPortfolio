// Sets the "Last Updated" date in every page's footer. Netlify runs this on
// each publish (see netlify.toml), so the date in git isn't the one visitors see.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const TIME_ZONE = "America/New_York";
const now = new Date();
const iso = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(now);
const text = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "long",
  day: "numeric",
}).format(now);
const stamp = `<p class="footer-right">Last Updated: <time datetime="${iso}">${text}</time></p>`;

let stamped = 0;
for (const file of readdirSync(".").filter((name) => name.endsWith(".html"))) {
  const page = readFileSync(file, "utf8");
  const updated = page.replace(/<p class="footer-right">[\s\S]*?<\/p>/, stamp);
  if (updated === page && !page.includes(stamp)) throw new Error(`No footer date in ${file}`);
  writeFileSync(file, updated);
  stamped += 1;
}
console.log(`Stamped ${stamped} pages: ${text}`);
