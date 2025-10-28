// index.js
// ❌ not needed; Node 18+ has native fetch
// import fetch from "node-fetch";
import Parser from "rss-parser";

const parser = new Parser();

export default async ({ req, res, log, error }) => {
  try {
    const rssFeeds = [
      "https://techcrunch.com/feed/",
      "https://www.theverge.com/rss/index.xml",
      "https://mashable.com/feed/",
      "https://www.marketingdive.com/feeds/news/",
      "https://www.socialmediatoday.com/feed"
    ];

    const WP_URL = process.env.WP_URL;
    const WP_USERNAME = process.env.WP_USERNAME;
    const WP_APP_PASSWORD = process.env.WP_APP_PASSWORD;
    const WP_CATEGORY_ID = process.env.WP_CATEGORY_ID;

    // ✅ Check credentials
    if (!WP_URL || !WP_USERNAME || !WP_APP_PASSWORD)
      throw new Error("Missing WordPress environment variables");

    // 1️⃣ Fetch and combine RSS feeds
    const allItems = [];
    for (const feedUrl of rssFeeds) {
      try {
        const feed = await parser.parseURL(feedUrl);
        allItems.push(...feed.items.slice(0, 3)); // top 3 from each
      } catch (e) {
        log(`Failed to parse ${feedUrl}: ${e.message}`);
      }
    }

    // 2️⃣ Random article
    const randomItem = allItems[Math.floor(Math.random() * allItems.length)];
    if (!randomItem) throw new Error("No RSS items found");

    // 3️⃣ Create WordPress post
    const postBody = {
      title: randomItem.title,
      content: `
        <p>${randomItem.contentSnippet || randomItem.content || ""}</p>
        <p><a href="${randomItem.link}" target="_blank">Read original article</a></p>
      `,
      status: "publish",
      categories: [Number(WP_CATEGORY_ID)]
    };

    const auth = Buffer.from(`${WP_USERNAME}:${WP_APP_PASSWORD}`).toString("base64");

    const response = await fetch(`${WP_URL}/wp-json/wp/v2/posts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`
      },
      body: JSON.stringify(postBody)
    });

    const result = await response.json();

    if (!response.ok) {
      error("Failed to post:", result);
      throw new Error(result.message || "WordPress post failed");
    }

    return res.json({
      success: true,
      message: `Posted successfully: ${result.link}`,
      post: result
    });
  } catch (err) {
    error("Error:", err.message);
    return res.json({ success: false, error: err.message }, 500);
  }
};
