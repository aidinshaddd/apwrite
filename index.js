// index.js — Node 22, ESM
import Parser from "rss-parser";

// ---- CONFIG ---------------------------------------------------
const FEEDS = [
  "https://techcrunch.com/feed/",
  "https://www.theverge.com/rss/index.xml",
  "https://www.engadget.com/rss.xml",
  "https://www.gsmarena.com/rss-news-reviews.php3",
  "https://www.wired.com/feed/category/gear/latest/rss"
];
const ITEMS_PER_RUN = parseInt(process.env.POSTS_PER_RUN || "2", 10);

// --------------------------------------------------------------
const parser = new Parser();

const cleanAppPass = (s) => (s || "").replace(/\s+/g, " "); // keep spaces, just normalize
const b64 = (s) => Buffer.from(s).toString("base64");

async function authHeader() {
  const user = process.env.WP_USERNAME;
  const pass = cleanAppPass(process.env.WP_APP_PASSWORD);
  if (!user || !pass) throw new Error("Missing WP_USERNAME or WP_APP_PASSWORD");
  return `Basic ${b64(`${user}:${pass}`)}`;
}

async function wpFetch(path, opts = {}) {
  const base = process.env.WP_URL?.replace(/\/+$/, "");
  if (!base) throw new Error("Missing WP_URL");

  const headers = opts.headers || {};
  headers["Authorization"] = await authHeader();

  const res = await fetch(`${base}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });

  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }

  return { ok: res.ok, status: res.status, json };
}

async function authSelfTest(log) {
  const r = await wpFetch("/wp-json/wp/v2/users/me");
  if (!r.ok) {
    log(`Auth test failed: ${r.status} ${JSON.stringify(r.json)}`);
    throw new Error("WordPress auth failed (users/me). Check role=Author+, app password, and Authorization header pass-through.");
  }
}

// choose the best image URL from an RSS item
function pickImageFromItem(item) {
  if (item.enclosure?.url) return item.enclosure.url;
  if (item["media:content"]?.url) return item["media:content"].url;
  if (Array.isArray(item.mediaContent) && item.mediaContent[0]?.url) return item.mediaContent[0].url;
  return null;
}

async function fetchOgImage(url) {
  try {
    const htmlRes = await fetch(url, { redirect: "follow" });
    const html = await htmlRes.text();
    const m = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
    return m ? m[1] : null;
  } catch { return null; }
}

async function uploadImageToWP(imageUrl, log) {
  // download image
  const imgRes = await fetch(imageUrl, { redirect: "follow" });
  if (!imgRes.ok) throw new Error(`Failed to download image: ${imageUrl}`);
  const buf = Buffer.from(await imgRes.arrayBuffer());

  // pick filename + mime
  const urlObj = new URL(imageUrl);
  const base = urlObj.pathname.split("/").pop() || "image.jpg";
  const name = base.split("?")[0];
  const mime = imgRes.headers.get("content-type") || "image/jpeg";

  // upload to media
  const baseUrl = process.env.WP_URL.replace(/\/+$/, "");
  const auth = await authHeader();
  const res = await fetch(`${baseUrl}/wp-json/wp/v2/media`, {
    method: "POST",
    headers: {
      "Content-Disposition": `attachment; filename="${name}"`,
      "Content-Type": mime,
      "Authorization": auth,
    },
    body: buf,
  });

  const json = await res.json();
  if (!res.ok) {
    log(`Media upload failed: ${res.status} ${JSON.stringify(json)}`);
    throw new Error(json.message || "Media upload failed");
  }
  return json.id; // media ID
}

function buildContent(item) {
  const intro =
    item.contentSnippet ||
    item.summary ||
    (item.content ? item.content.replace(/<[^>]+>/g, "").slice(0, 500) : "");

  const src = `<p>Source: <a href="${item.link}" target="_blank" rel="nofollow noopener">${item.link}</a></p>`;
  return `<p>${intro}</p>${src}`;
}

export default async ({ req, res, log, error }) => {
  try {
    const categoryId = Number(process.env.WP_CATEGORY_ID || 1);

    // 0) verify auth first (clear error if fails)
    await authSelfTest(log);

    // 1) collect items
    const items = [];
    for (const f of FEEDS) {
      try {
        const feed = await parser.parseURL(f);
        items.push(...feed.items.slice(0, 5));
      } catch (e) {
        log(`RSS parse failed for ${f}: ${e.message}`);
      }
    }
    if (!items.length) throw new Error("No RSS items found.");

    // 2) pick N items
    const toPost = items.slice(0, ITEMS_PER_RUN);

    const results = [];
    for (const item of toPost) {
      try {
        // 2a) get an image
        let imageUrl = pickImageFromItem(item);
        if (!imageUrl) imageUrl = await fetchOgImage(item.link);

        let featuredId = null;
        if (imageUrl) {
          try {
            featuredId = await uploadImageToWP(imageUrl, log);
          } catch (e) {
            log(`Image upload skipped: ${e.message}`);
          }
        }

        // 2b) create post
        const postBody = {
          title: item.title,
          content: buildContent(item),
          status: "publish",
          categories: [categoryId],
          featured_media: featuredId || undefined,
        };

        const r = await wpFetch("/wp-json/wp/v2/posts", {
          method: "POST",
          body: JSON.stringify(postBody),
        });

        if (!r.ok) {
          error(`Post failed: ${r.status} ${JSON.stringify(r.json)}`);
          throw new Error(r.json?.message || "Post failed");
        }

        results.push({ ok: true, id: r.json.id, link: r.json.link });
      } catch (e) {
        results.push({ ok: false, error: e.message, title: item.title });
      }
    }

    return res.json({ success: true, posted: results });
  } catch (e) {
    error(e.stack || e.message);
    return res.json({ success: false, error: e.message }, 500);
  }
};
