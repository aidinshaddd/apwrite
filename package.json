// index.js
const Parser = require('rss-parser');
const { Client, Databases } = require('node-appwrite');
const fetch = require('node-fetch');

const parser = new Parser();

const APPWRITE_ENDPOINT = process.env.APPWRITE_ENDPOINT;
const APPWRITE_PROJECT  = process.env.APPWRITE_PROJECT;
const APPWRITE_API_KEY  = process.env.APPWRITE_API_KEY;
const DATABASE_ID       = process.env.DATABASE_ID;    // optional
const COLLECTION_ID     = process.env.COLLECTION_ID;  // optional
const RSS_FEEDS         = (process.env.RSS_FEEDS || '').split(',').map(s => s.trim()).filter(Boolean);
const WP_URL            = process.env.WP_URL;
const WP_USERNAME       = process.env.WP_USERNAME;
const WP_APP_PASSWORD   = process.env.WP_APP_PASSWORD;

const client = new Client()
  .setEndpoint(APPWRITE_ENDPOINT)
  .setProject(APPWRITE_PROJECT)
  .setKey(APPWRITE_API_KEY);

const databases = new Databases(client);

async function alreadyExists(link, guid) {
  if (!DATABASE_ID || !COLLECTION_ID) return false;
  try {
    if (link) {
      const res = await databases.listDocuments(DATABASE_ID, COLLECTION_ID, [
        `equal("link","${link.replace(/"/g, '\\"')}")`
      ]);
      if (res.total > 0) return true;
    }
    if (guid) {
      const res2 = await databases.listDocuments(DATABASE_ID, COLLECTION_ID, [
        `equal("guid","${guid.replace(/"/g, '\\"')}")`
      ]);
      if (res2.total > 0) return true;
    }
  } catch (err) {
    console.error("exists check error", err);
  }
  return false;
}

async function saveArticle(item, sourceName) {
  if (!DATABASE_ID || !COLLECTION_ID) return null;
  const doc = {
    title: item.title || '',
    link: item.link || '',
    guid: item.guid || item.link,
    pubDate: item.pubDate || new Date().toISOString(),
    summary: item.contentSnippet || item.summary || '',
    content: item.content || '',
    source: sourceName || '',
    image: (item.enclosure && item.enclosure.url) ? item.enclosure.url : '',
    posted_to_wp: false,
  };
  try {
    const resp = await databases.createDocument(DATABASE_ID, COLLECTION_ID, 'unique()', doc);
    return resp;
  } catch (err) {
    console.error("saveArticle error", err);
    return null;
  }
}

async function publishToWP(article) {
  if (!WP_URL || !WP_USERNAME || !WP_APP_PASSWORD) {
    console.log('WP credentials not provided; skipping WP publish.');
    return null;
  }
  try {
    const endpoint = `${WP_URL.replace(/\/$/, '')}/wp-json/wp/v2/posts`;
    const auth = Buffer.from(`${WP_USERNAME}:${WP_APP_PASSWORD}`).toString('base64');

    const body = {
      title: article.title,
      content: article.content || article.summary || '',
      status: 'draft', // change to 'publish' if you want auto-publish
      meta: { source: article.source, original_link: article.link }
    };

    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`WP API error ${resp.status}: ${txt}`);
    }

    const data = await resp.json();
    console.log('Created WP post:', data.id);
    return data;
  } catch (err) {
    console.error('publishToWP error', err);
    return null;
  }
}

async function main() {
  console.log('RSS worker started', new Date().toISOString());
  for (const feedUrl of RSS_FEEDS) {
    try {
      const feed = await parser.parseURL(feedUrl);
      const sourceName = feed.title || feedUrl;
      let count = 0;
      for (const item of feed.items) {
        if (count >= 10) break;
        const link = item.link || '';
        const guid = item.guid || link;
        const exists = await alreadyExists(link, guid);
        if (exists) continue;
        const savedDoc = await saveArticle(item, sourceName);
        let articleData = {
          title: item.title,
          summary: item.contentSnippet || item.summary || '',
          content: item.content || '',
          source: sourceName,
          link: item.link
        };
        if (savedDoc) {
          articleData = { ...articleData, ...{ title: savedDoc.title, content: savedDoc.content } };
        }
        const wpResp = await publishToWP(articleData);
        if (wpResp && savedDoc) {
          try {
            await databases.updateDocument(DATABASE_ID, COLLECTION_ID, savedDoc.$id, { posted_to_wp: true });
          } catch (e) { console.error('update posted flag error', e); }
        }
        count++;
      }
    } catch (err) {
      console.error('feed error', feedUrl, err);
    }
  }
  console.log('RSS worker finished', new Date().toISOString());
}

module.exports = async function (req, res) {
  try {
    await main();
    res.send(200, 'OK');
  } catch (err) {
    console.error(err);
    res.send(500, 'Error');
  }
};
