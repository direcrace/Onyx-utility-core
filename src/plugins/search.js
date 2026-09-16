

import { command } from "../plugins.js";
import { reply, replyFail, getCommandArgs, withTyping, tr } from "../utils/message.js";
import { BOT_INFO } from "../config/constants.js";

command(
  { pattern: "movie", fromMe: false, desc: "Movie/series info from IMDB", type: "search" },
  async (message, conn) => {
    await withTyping(conn, message.from, async () => {
      const text = getCommandArgs(message.body, "movie");
      if (!text) { await replyFail(conn, message, await tr(`Usage: \`${BOT_INFO.PREFIX}movie <title>\``, `Benutzung: \`${BOT_INFO.PREFIX}movie <titel>\``)); return; }
      try {
        const axios = (await import("axios")).default;
        const res = await axios.get(`http://www.omdbapi.com/?apikey=742b2d09&t=${encodeURIComponent(text)}&plot=full`);
        if (res.data.Response === "False") { await replyFail(conn, message, await tr("Movie or series not found.", "Film oder Serie nicht gefunden.")); return; }
        const d = res.data;
        let txt = await tr(
          `*${d.Title}* (${d.Year})\n\n⭐ Rated: ${d.Rated}\n⏳ Runtime: ${d.Runtime}\n🌀 Genre: ${d.Genre}\n👨‍💻 Director: ${d.Director}\n👨 Actors: ${d.Actors}\n📃 Plot: ${d.Plot}\n🌐 Language: ${d.Language}\n🌟 IMDB: ${d.imdbRating}/10 (${d.imdbVotes} votes)`,
          `*${d.Title}* (${d.Year})\n\n⭐ Altersfreigabe: ${d.Rated}\n⏳ Laufzeit: ${d.Runtime}\n🌀 Genre: ${d.Genre}\n👨‍💻 Regie: ${d.Director}\n👨 Schauspieler: ${d.Actors}\n📃 Handlung: ${d.Plot}\n🌐 Sprache: ${d.Language}\n🌟 IMDB: ${d.imdbRating}/10 (${d.imdbVotes} Stimmen)`
        );
        if (d.Poster && d.Poster !== "N/A") {
          await conn.sendMessage(message.from, { image: { url: d.Poster }, caption: txt },
            { quoted: { key: message.key, message: message.message } });
        } else { await reply(conn, message, txt); }
      } catch { await replyFail(conn, message, await tr("Error fetching movie data.", "Fehler beim Abrufen der Filmdaten.")); }
    });
  }
);

command(
  { pattern: "anime", fromMe: false, desc: "Search anime info", type: "search" },
  async (message, conn) => {
    await withTyping(conn, message.from, async () => {
      const text = getCommandArgs(message.body, "anime");
      if (!text) { await replyFail(conn, message, await tr(`Usage: \`${BOT_INFO.PREFIX}anime <name>\``, `Benutzung: \`${BOT_INFO.PREFIX}anime <name>\``)); return; }
      try {
        const axios = (await import("axios")).default;
        const res = await axios.get(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(text)}&limit=1`);
        const d = res.data?.data?.[0];
        if (!d) { await replyFail(conn, message, await tr("No anime found.", "Kein Anime gefunden.")); return; }
        await reply(conn, message, await tr(`*${d.title}*\n\n⭐ Score: ${d.score}/10\n🌀 Genres: ${d.genres.map((g) => g.name).join(", ")}\n📺 Episodes: ${d.episodes}\n📖 Synopsis: ${d.synopsis}\n🔗 ${d.url}`, `*${d.title}*\n\n⭐ Bewertung: ${d.score}/10\n🌀 Genres: ${d.genres.map((g) => g.name).join(", ")}\n📺 Folgen: ${d.episodes}\n📖 Handlung: ${d.synopsis}\n🔗 ${d.url}`));
      } catch { await replyFail(conn, message, await tr("Error fetching anime data.", "Fehler beim Abrufen der Anime-Daten.")); }
    });
  }
);

command(
  { pattern: "lyrics", fromMe: false, desc: "Search song lyrics", type: "search" },
  async (message, conn) => {
    await withTyping(conn, message.from, async () => {
      const text = getCommandArgs(message.body, "lyrics");
      if (!text || !text.includes("|")) { await replyFail(conn, message, await tr(`Usage: \`${BOT_INFO.PREFIX}lyrics Title|Artist\``, `Benutzung: \`${BOT_INFO.PREFIX}lyrics Titel|Künstler\``)); return; }
      try {
        const [title, artist] = text.split("|").map((s) => s.trim());
        const axios = (await import("axios")).default;
        const res = await axios.get(`https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`);
        if (res.data?.lyrics) { await reply(conn, message, res.data.lyrics.slice(0, 4000)); }
        else { await replyFail(conn, message, await tr("Lyrics not found.", "Songtext nicht gefunden.")); }
      } catch { await replyFail(conn, message, await tr("Error fetching lyrics.", "Fehler beim Abrufen des Songtexts.")); }
    });
  }
);

command(
  { pattern: "github", fromMe: false, desc: "GitHub user profile", type: "search" },
  async (message, conn) => {
    await withTyping(conn, message.from, async () => {
      const text = getCommandArgs(message.body, "github");
      if (!text) { await replyFail(conn, message, await tr(`Usage: \`${BOT_INFO.PREFIX}github <username>\``, `Benutzung: \`${BOT_INFO.PREFIX}github <benutzername>\``)); return; }
      try {
        const axios = (await import("axios")).default;
        const { data: u } = await axios.get(`https://api.github.com/users/${encodeURIComponent(text.trim())}`);
        let txt = await tr(`*GitHub — @${u.login}*\n\nName: ${u.name || "N/A"}\nBio: ${u.bio || "N/A"}\nRepos: ${u.public_repos} | Followers: ${u.followers}\nCreated: ${new Date(u.created_at).toLocaleDateString()}`, `*GitHub — @${u.login}*\n\nName: ${u.name || "N/A"}\nBio: ${u.bio || "N/A"}\nRepos: ${u.public_repos} | Follower: ${u.followers}\nErstellt: ${new Date(u.created_at).toLocaleDateString()}`);
        const { data: repos } = await axios.get(`https://api.github.com/users/${encodeURIComponent(text.trim())}/repos?per_page=3&sort=stargazers_count&direction=desc`);
        if (repos?.length) { txt += await tr(`\n\n*Top Repos:*\n`, `\n\n*Beste Repos:*\n`); repos.forEach((r) => { txt += `⭐ ${r.name} — ★${r.stargazers_count}\n`; }); }
        await conn.sendMessage(message.from, { image: { url: u.avatar_url }, caption: txt },
          { quoted: { key: message.key, message: message.message } });
      } catch { await replyFail(conn, message, await tr("GitHub user not found.", "GitHub-Benutzer nicht gefunden.")); }
    });
  }
);

command(
  { pattern: "translate", fromMe: false, desc: "Translate text to target language", type: "search" },
  async (message, conn) => {
    await withTyping(conn, message.from, async () => {
      const text = getCommandArgs(message.body, "translate");
      if (!text) { await replyFail(conn, message, await tr(`Usage: \`${BOT_INFO.PREFIX}translate <lang> <text>\``, `Benutzung: \`${BOT_INFO.PREFIX}translate <sprache> <text>\``)); return; }
      const parts = text.trim().split(/\s+/);
      const lang = parts[0].toLowerCase();
      const content = parts.slice(1).join(" ") || message.quoted?.text || "";
      if (!content) { await replyFail(conn, message, await tr("No text to translate.", "Kein Text zum Übersetzen.")); return; }
      try {
        const translate = (await import("translate-google-api")).default;
        const result = await translate(content, { to: lang });
        await reply(conn, message, `*[${lang}]*\n${result[0]}`);
      } catch { await replyFail(conn, message, await tr("Translation failed.", "Übersetzung fehlgeschlagen.")); }
    });
  }
);

command(
  { pattern: "qr", fromMe: false, desc: "Generate QR code from text", type: "search" },
  async (message, conn) => {
    await withTyping(conn, message.from, async () => {
      const text = getCommandArgs(message.body, "qr");
      if (!text) { await replyFail(conn, message, await tr(`Usage: \`${BOT_INFO.PREFIX}qr <text/link>\``, `Benutzung: \`${BOT_INFO.PREFIX}qr <text/link>\``)); return; }
      try {
        const QRCode = (await import("qrcode")).default;
        const buf = await QRCode.toBuffer(text, { type: "png", width: 512 });
        await conn.sendMessage(message.from, { image: buf, caption: "QR Code" },
          { quoted: { key: message.key, message: message.message } });
      } catch { await replyFail(conn, message, await tr("QR generation failed.", "QR-Code-Erstellung fehlgeschlagen.")); }
    });
  }
);

command(
  { pattern: "img", fromMe: false, desc: "Get one random Pinterest image for a query", type: "search" },
  async (message, conn) => {
    await withTyping(conn, message.from, async () => {
      const text = getCommandArgs(message.body, "img")?.trim();
      if (!text) { await replyFail(conn, message, await tr(`Usage: \`${BOT_INFO.PREFIX}img <query>\``, `Benutzung: \`${BOT_INFO.PREFIX}img <suche>\``)); return; }

      let urls = [];
      try { urls = await fetchPinterestPinImages(text); } catch {  }
      if (!urls.length) { await replyFail(conn, message, await tr("No Pinterest results for that query.", "Keine Pinterest-Ergebnisse für diese Suche.")); return; }

      const url = urls[Math.floor(Math.random() * urls.length)];
      try {
        const res = await fetch(url, { redirect: "follow" });
        if (!res.ok) throw new Error("download failed");
        const buf = Buffer.from(await res.arrayBuffer());
        if (!buf.length) throw new Error("empty response");
        await conn.sendMessage(message.from, { image: buf, caption: `*${text}*` },
          { quoted: { key: message.key, message: message.message } });
        return;
      } catch {
        await replyFail(conn, message, await tr("Could not download that Pinterest image.", "Das Pinterest-Bild konnte nicht heruntergeladen werden."));
      }
    });
  }
);

command(
  { pattern: "weather", fromMe: false, desc: "Weather for a city (Open-Meteo, no key)", type: "search" },
  async (message, conn) => {
    await withTyping(conn, message.from, async () => {
      const q = getCommandArgs(message.body, "weather");
      if (!q) { await replyFail(conn, message, await tr(`Usage: \`${BOT_INFO.PREFIX}weather <city>\``, `Benutzung: \`${BOT_INFO.PREFIX}weather <stadt>\``)); return; }
      try {
        const axios = (await import("axios")).default;
        const geo = await axios.get(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=en&format=json`);
        const spot = geo.data?.results?.[0];
        if (!spot) { await replyFail(conn, message, await tr(`No location found for *${q}*.`, `Keinen Ort gefunden für *${q}*.`)); return; }
        const w = await axios.get(`https://api.open-meteo.com/v1/forecast?latitude=${spot.latitude}&longitude=${spot.longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,precipitation&timezone=auto`);
        const c = w.data?.current;
        if (!c) { await replyFail(conn, message, await tr("Weather data unavailable.", "Wetterdaten nicht verfügbar.")); return; }
        const desc = weatherCode(c.weather_code);
        const txt = await tr(
          `🌦️ *${spot.name}*${spot.country ? `, ${spot.country}` : ""}\n\n${desc}\n🌡️ ${c.temperature_2m}°C (feels ${c.apparent_temperature}°C)\n💧 ${c.relative_humidity_2m}% · 💨 ${c.wind_speed_10m} km/h\n🌧️ Precip: ${c.precipitation} mm`,
          `🌦️ *${spot.name}*${spot.country ? `, ${spot.country}` : ""}\n\n${desc}\n🌡️ ${c.temperature_2m}°C (gefühlt ${c.apparent_temperature}°C)\n💧 ${c.relative_humidity_2m}% · 💨 ${c.wind_speed_10m} km/h\n🌧️ Niederschlag: ${c.precipitation} mm`
        );
        await reply(conn, message, txt);
      } catch { await replyFail(conn, message, await tr("Weather lookup failed.", "Wetterabfrage fehlgeschlagen.")); }
    });
  }
);

function weatherCode(code) {
  const map = {
    0: "☀️ Clear sky", 1: "🌤️ Mainly clear", 2: "⛅ Partly cloudy", 3: "☁️ Overcast",
    45: "🌫️ Fog", 48: "🌫️ Rime fog",
    51: "🌦️ Light drizzle", 53: "🌧️ Drizzle", 55: "🌧️ Dense drizzle",
    61: "🌧️ Slight rain", 63: "🌧️ Rain", 65: "🌧️ Heavy rain",
    71: "🌨️ Slight snow", 73: "🌨️ Snow", 75: "❄️ Heavy snow",
    80: "🌦️ Rain showers", 81: "🌧️ Rain showers", 82: "⛈️ Violent showers",
    95: "⛈️ Thunderstorm", 96: "⛈️ Thunderstorm + hail", 99: "⛈️ Severe + hail",
  };
  return map[code] || "🌡️";
}

command(
  { pattern: "wiki", fromMe: false, desc: "Search Wikipedia summary", type: "search" },
  async (message, conn) => {
    await withTyping(conn, message.from, async () => {
      const q = getCommandArgs(message.body, "wiki")?.trim();
      if (!q) { await replyFail(conn, message, await tr(`Usage: \`${BOT_INFO.PREFIX}wiki <topic>\``, `Benutzung: \`${BOT_INFO.PREFIX}wiki <thema>\``)); return; }
      try {
        const lang = process.env.WIKI_LANG || (await langTag()) || "en";
        const axios = (await import("axios")).default;
        const res = await axios.get(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(q)}`);
        const d = res.data;
        if (d?.type === "disambiguation") {
          await reply(conn, message, await tr(`*${d.title}*\n\n${d.extract || "Multiple meanings."}\n\nDisambiguation page — try a more specific query.`, `*${d.title}*\n\n${d.extract || "Mehrere Bedeutungen."}\n\nMehrdeutige Seite — versuche eine genauere Suche.`));
          return;
        }
        if (!d?.extract) { await replyFail(conn, message, await tr(`No Wikipedia article found for *${q}*.`, `Kein Wikipedia-Artikel für *${q}* gefunden.`)); return; }
        let txt = `*${d.title}*\n\n${d.extract}`;
        if (d.content_urls?.desktop?.page) txt += `\n\n🔗 ${d.content_urls.desktop.page}`;
        if (d.thumbnail?.source) {
          await conn.sendMessage(message.from, { image: { url: d.thumbnail.source }, caption: txt },
            { quoted: { key: message.key, message: message.message } });
        } else {
          await reply(conn, message, txt);
        }
      } catch { await replyFail(conn, message, await tr("Wikipedia lookup failed.", "Wikipedia-Abfrage fehlgeschlagen.")); }
    });
  }
);

async function langTag() {
  try {
    const { getLang } = await import("../utils/i18n.js");
    const l = await getLang();
    if (l === "de") return "de";
  } catch {  }
  return "en";
}

command(
  { pattern: "reddit", fromMe: false, desc: "Top posts from a subreddit", type: "search" },
  async (message, conn) => {
    await withTyping(conn, message.from, async () => {
      const q = (getCommandArgs(message.body, "reddit")?.trim() || "").replace(/^r\//i, "");
      if (!q) { await replyFail(conn, message, await tr(`Usage: \`${BOT_INFO.PREFIX}reddit <subreddit>\``, `Benutzung: \`${BOT_INFO.PREFIX}reddit <subreddit>\``)); return; }
      try {
        const axios = (await import("axios")).default;
        const res = await axios.get(`https://www.reddit.com/r/${encodeURIComponent(q)}/top.json?limit=5&t=week`, {
          headers: { "User-Agent": "onyx-bot/5.0" },
        });
        const posts = res.data?.data?.children?.map((c) => c.data).filter(Boolean) || [];
        if (!posts.length) { await replyFail(conn, message, await tr(`No posts found in *r/${q}*.`, `Keine Beiträge in *r/${q}* gefunden.`)); return; }
        const lines = posts.map((p, i) => `${i + 1}. ${p.title || ""} (▲${p.ups ?? 0}${p.num_comments !== undefined ? ` · 💬${p.num_comments}` : ""})`);
        await reply(conn, message, await tr(`🔴 *r/${q}* — top this week\n${lines.join("\n")}`, `🔴 *r/${q}* — Top diese Woche\n${lines.join("\n")}`));
      } catch { await replyFail(conn, message, await tr("Reddit lookup failed.", "Reddit-Abfrage fehlgeschlagen.")); }
    });
  }
);

command(
  { pattern: "npm", fromMe: false, desc: "Get package info from npm", type: "search" },
  async (message, conn) => {
    await withTyping(conn, message.from, async () => {
      const q = (getCommandArgs(message.body, "npm")?.trim() || "").replace(/^@/, "@");
      if (!q) { await replyFail(conn, message, await tr(`Usage: \`${BOT_INFO.PREFIX}npm <package>\``, `Benutzung: \`${BOT_INFO.PREFIX}npm <paket>\``)); return; }
      try {
        const axios = (await import("axios")).default;
        const res = await axios.get(`https://registry.npmjs.org/${encodeURIComponent(q)}`);
        const d = res.data;
        if (!d?.name) { await replyFail(conn, message, await tr(`Package *${q}* not found.`, `Paket *${q}* nicht gefunden.`)); return; }
        const latest = d["dist-tags"]?.latest;
        const versions = Object.keys(d.versions || {});
        const ver = latest ? d.versions?.[latest] : null;
        const txt = await tr(
          `📦 *${d.name}*\n\nLatest: *${latest}* (${versions.length} versions)\nDescription: ${d.description || "N/A"}\n\nAuthor: ${ver?.author?.name || d.author?.name || "N/A"}\nLicense: ${ver?.license || d.license || "N/A"}\n🔗 https://www.npmjs.com/package/${encodeURIComponent(d.name)}`,
          `📦 *${d.name}*\n\nNeueste: *${latest}* (${versions.length} Versionen)\nBeschreibung: ${d.description || "N/A"}\n\nAutor: ${ver?.author?.name || d.author?.name || "N/A"}\nLizenz: ${ver?.license || d.license || "N/A"}\n🔗 https://www.npmjs.com/package/${encodeURIComponent(d.name)}`
        );
        await reply(conn, message, txt);
      } catch { await replyFail(conn, message, await tr("npm lookup failed.", "npm-Abfrage fehlgeschlagen.")); }
    });
  }
);

command(
  { pattern: "define", fromMe: false, desc: "Dictionary definition of a word", type: "search" },
  async (message, conn) => {
    await withTyping(conn, message.from, async () => {
      const q = (getCommandArgs(message.body, "define")?.trim() || "").toLowerCase();
      if (!q || /\s/.test(q)) { await replyFail(conn, message, await tr(`Usage: \`${BOT_INFO.PREFIX}define <word>\``, `Benutzung: \`${BOT_INFO.PREFIX}define <wort>\``)); return; }
      try {
        const axios = (await import("axios")).default;
        const res = await axios.get(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(q)}`);
        const entry = res.data?.[0];
        if (!entry) { await replyFail(conn, message, await tr(`No definition found for *${q}*.`, `Keine Definition für *${q}* gefunden.`)); return; }
        const parts = [];
        for (const m of entry.meanings || []) {
          const def = m.definitions?.[0];
          if (def?.definition) {
            parts.push(`*${m.partOfSpeech}*: ${def.definition}${def.example ? `\n  e.g. "${def.example}"` : ""}`);
          }
          if (parts.length >= 3) break;
        }
        if (!parts.length) { await replyFail(conn, message, await tr(`No definition found for *${q}*.`, `Keine Definition für *${q}* gefunden.`)); return; }
        await reply(conn, message, `📖 *${entry.word}* ${entry.phonetic ? `(${entry.phonetic})` : ""}\n\n${parts.join("\n")}`);
      } catch { await replyFail(conn, message, await tr("Dictionary lookup failed.", "Wörterbuch-Abfrage fehlgeschlagen.")); }
    });
  }
);

command(
  { pattern: "news", fromMe: false, desc: "Top headlines (set NEWS_API_KEY)", type: "search" },
  async (message, conn) => {
    await withTyping(conn, message.from, async () => {
      const key = process.env.NEWS_API_KEY;
      if (!key) { await replyFail(conn, message, await tr("News is not configured — set \`NEWS_API_KEY\` in the bot's environment.", "News ist nicht konfiguriert — setze \`NEWS_API_KEY\` in der Bot-Umgebung.")); return; }
      const q = getCommandArgs(message.body, "news")?.trim();
      try {
        const axios = (await import("axios")).default;
        const src = q && /^[a-z-]+$/i.test(q)
          ? `&sources=${encodeURIComponent(q)}`
          : q ? `&q=${encodeURIComponent(q)}` : "";
        const res = await axios.get(`https://newsapi.org/v2/top-headlines?language=${process.env.NEWS_LANG || "en"}${src}&pageSize=8`, {
          headers: { "X-Api-Key": key },
        });
        const arts = res.data?.articles?.filter((a) => a.title && a.title !== "[Removed]") || [];
        if (!arts.length) { await replyFail(conn, message, await tr("No headlines found.", "Keine Schlagzeilen gefunden.")); return; }
        const lines = arts.map((a, i) => `${i + 1}. ${a.title}${a.source?.name ? ` — ${a.source.name}` : ""}`);
        await reply(conn, message, `📰 ${q ? `Headlines for *${q}*` : "Top headlines"}\n\n${lines.join("\n")}`);
      } catch { await replyFail(conn, message, await tr("News fetch failed.", "News-Abruf fehlgeschlagen.")); }
    });
  }
);

command(
  { pattern: "search", fromMe: false, desc: "Web search (DuckDuckGo, no key)", type: "search" },
  async (message, conn) => {
    await withTyping(conn, message.from, async () => {
      const q = getCommandArgs(message.body, "search")?.trim();
      if (!q) { await replyFail(conn, message, await tr(`Usage: \`${BOT_INFO.PREFIX}search <query>\``, `Benutzung: \`${BOT_INFO.PREFIX}search <anfrage>\``)); return; }
      try {
        const axios = (await import("axios")).default;
        const res = await axios.get(`https://api.duckduckgo.com/`, {
          params: { q, format: "json", no_html: 1, skip_disambig: 1 },
        });
        const d = res.data;
        const results = [];
        if (d?.AbstractText) results.push({ title: d.Heading || q, text: `${d.AbstractText}\n🔗 ${d.AbstractURL || ""}`.trim() });
        for (const r of d.RelatedTopics || []) {
          if (r.Text) {
            const url = r.FirstURL || "";
            results.push({ title: r.Text?.split(" ").slice(0, 6).join(" "), text: url ? `${r.Text}\n🔗 ${url}` : r.Text });
          }
          if (results.length >= 4) break;
        }
        if (!results.length) {
          await reply(conn, message, await tr(`No direct answers for *${q}*.\nTry 🔗 https://duckduckgo.com/?q=${encodeURIComponent(q)}`, `Keine direkten Antworten für *${q}*.\nVersuche 🔗 https://duckduckgo.com/?q=${encodeURIComponent(q)}`));
          return;
        }
        const lines = results.slice(0, 4).map((r, i) => `${i + 1}. *${r.title}*\n   ${r.text}`);
        await reply(conn, message, `🔍 *${q}*\n\n${lines.join("\n\n")}`);
      } catch { await replyFail(conn, message, await tr("Search failed.", "Suche fehlgeschlagen.")); }
    });
  }
);

const PIN_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const PIN_LANDING = "https://www.pinterest.com/";
const PIN_SEARCH = "https://www.pinterest.com/resource/BaseSearchResource/get/";

async function pinterestCookies() {
  const res = await fetch(PIN_LANDING, { headers: { "User-Agent": PIN_UA } });
  let setCookies;
  if (typeof res.headers.getSetCookie === "function") {
    setCookies = res.headers.getSetCookie();
  } else {
    const single = res.headers.get("set-cookie");
    setCookies = single ? [single] : [];
  }
  return setCookies.join("; ");
}

export async function fetchPinterestPinImages(query) {
  const cookies = await pinterestCookies();
  const csrf = (cookies.match(/csrftoken=([^;]+)/) || [])[1] || "";
  const data = JSON.stringify({
    options: { query, types: ["pins"], page_size: 25 },
    context: {},
  });
  const body = new URLSearchParams({
    source_url: `/search/pins/?q=${encodeURIComponent(query)}`,
    data,
  });
  const res = await fetch(PIN_SEARCH, {
    method: "POST",
    headers: {
      "User-Agent": PIN_UA,
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Requested-With": "XMLHttpRequest",
      "X-CSRFToken": csrf,
      Cookie: cookies,
    },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`Pinterest API ${res.status}`);
  const json = await res.json();
  const results = json?.resource_response?.data?.results || [];
  const urls = [];
  for (const item of results) {
    const pins = item?.objects?.length ? item.objects : [item];
    for (const p of pins) {
      if (p?.is_video) continue;
      const variants = p?.images || {};
      let img = variants?.orig || variants?.originals;
      if (!img?.url) {
        for (const k of Object.keys(variants)) { if (variants[k]?.url) { img = variants[k]; break; } }
      }
      if (img?.url) urls.push(img.url);
    }
  }
  return urls;
}
