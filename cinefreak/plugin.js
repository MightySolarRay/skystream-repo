(function() {
    "use strict";

    const STREAM_API = "https://subtitle.yagaverse.net/stream-api.php";
    const API_KEY = "pushpa";
    const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

    const DEFAULT_HEADERS = {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    };

    /**
     * All categories on CineFreak
     */
    const CATEGORIES = [
        { row: "Latest Releases", path: "/", type: "movie" },
        { row: "Hindi Movies", path: "/hindi-movies/", type: "movie" },
        { row: "English Movies", path: "/english-movies/", type: "movie" },
        { row: "Hindi Dubbed", path: "/hindi-dubbed-movies/", type: "movie" },
        { row: "Web Series", path: "/web-series/", type: "tv" },
        { row: "Bangla Movies", path: "/bangla-movies/", type: "movie" },
        { row: "Bangla Dubbed", path: "/bangla-dubbed/", type: "movie" },
        { row: "K-Drama", path: "/k-drama/", type: "tv" },
        { row: "Korean Movies", path: "/korean/", type: "movie" },
        { row: "Chinese Movies", path: "/chinese/", type: "movie" },
        { row: "Japanese Movies", path: "/japanese/", type: "movie" },
        { row: "Dual Audio", path: "/dual-audio/", type: "movie" },
        { row: "Animation", path: "/animation/", type: "movie" },
        { row: "South Hindi Dubbed (Tamil)", path: "/tamil/", type: "movie" },
        { row: "South Hindi Dubbed (Telugu)", path: "/telugu/", type: "movie" },
        { row: "South Hindi Dubbed (Malayalam)", path: "/malayalam/", type: "movie" },
        { row: "South Hindi Dubbed (Kannada)", path: "/kannada/", type: "movie" },
        { row: "Horror", path: "/horror/", type: "movie" },
        { row: "Marvel / MCU", path: "/mcu/", type: "movie" }
    ];

    function createItem(s) {
        try { return new MultimediaItem(s); } catch (e) { return s; }
    }
    function createEpisode(s) {
        try { return new Episode(s); } catch (e) { return s; }
    }
    function createStream(s) {
        try { return new StreamResult(s); } catch (e) { return s; }
    }

    function timeoutPromise(promise, ms) {
        return Promise.race([
            Promise.resolve(promise),
            new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), ms))
        ]);
    }

    function getBaseUrl() {
        if (typeof manifest !== "undefined" && manifest && manifest.baseUrl) {
            return manifest.baseUrl.replace(/\/+$/, "");
        }
        return "https://cinefreak.net";
    }

    async function fetchHtml(url) {
        const headers = { ...DEFAULT_HEADERS, Referer: getBaseUrl() + "/" };
        const res = await timeoutPromise(http_get(url, headers), 25000);
        return (res && res.body) ? res.body : "";
    }

    async function fetchJson(url) {
        const headers = {
            "User-Agent": USER_AGENT,
            "Accept": "application/json",
            Referer: getBaseUrl() + "/"
        };
        const res = await timeoutPromise(http_get(url, headers), 25000);
        try {
            return JSON.parse(res && res.body ? res.body : "{}");
        } catch (e) {
            return {};
        }
    }

    function decodeEntities(s) {
        return String(s || "")
            .replace(/&#0?38;|&amp;/g, "&")
            .replace(/&#0?8211;|&ndash;/g, "–")
            .replace(/&#0?8217;/g, "'")
            .replace(/&quot;/g, '"')
            .replace(/&#0?39;|&apos;/g, "'")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">");
    }

    function cleanTitle(s) {
        let t = decodeEntities(s).replace(/\s+details\s*$/i, "");
        t = t.replace(/\s*[–|-]\s*(GDrive|ESub|CineFreak|HD).*$/i, "");
        t = t.replace(/\s*\|\s*(HEVC|ESub|GDrive|CineFreak).*$/i, "");
        t = t.replace(/\b(WEB-?DL|BluRay|HDRip|HDTV|WEBRip|DVDRip)\b.*$/i, "");
        t = t.replace(/\s*(?:Download|Watch\s+Online)\b.*$/i, "");
        t = t.replace(/\s*\[[^\]]*\]\s*$/, "").trim();
        t = t.replace(/\s*&\s*$/, "").replace(/\s*,\s*$/, "").trim();
        return t || decodeEntities(s);
    }

    function parseMovieCards(html, defaultType) {
        const items = [];
        const seen = {};
        const regex = /<a[^>]+href="(?:https?:\/\/[^\/]+)?\/([a-z0-9][a-z0-9-]*)\/"[^>]*class="movie-card"[^>]*>([\s\S]*?)<\/a>/g;
        let match;

        while ((match = regex.exec(html)) !== null) {
            const slug = match[1];
            if (seen[slug]) continue;

            const inner = match[2];
            const imgMatch = inner.match(/<img[^>]*\ssrc="([^"]+)"/);
            if (!imgMatch) continue;

            seen[slug] = true;
            const ariaMatch = match[0].match(/aria-label="([^"]*)"/);
            const titleMatch = inner.match(/<h3 class="movie-card-title">([\s\S]*?)<\/h3>/);
            const rawTitle = (ariaMatch && ariaMatch[1]) || (titleMatch && titleMatch[1]) || slug;

            items.push(createItem({
                title: cleanTitle(rawTitle),
                url: JSON.stringify({ slug }),
                posterUrl: decodeEntities(imgMatch[1]),
                bannerUrl: decodeEntities(imgMatch[1]),
                type: defaultType || "movie"
            }));
        }
        return items;
    }

    /**
     * 1. getHome: Loads all categories concurrently
     */
    async function getHome(cb) {
        try {
            const baseUrl = getBaseUrl();
            const data = {};

            const categoryPromises = CATEGORIES.map(async (cat) => {
                try {
                    const html = await fetchHtml(baseUrl + cat.path);
                    const items = parseMovieCards(html, cat.type);
                    return { row: cat.row, items };
                } catch (err) {
                    return { row: cat.row, items: [] };
                }
            });

            const results = await Promise.all(categoryPromises);

            for (const res of results) {
                if (res.items && res.items.length > 0) {
                    if (res.row === "Latest Releases") {
                        data["Trending"] = res.items.slice(0, 10);
                        data["Latest Releases"] = res.items;
                    } else {
                        data[res.row] = res.items;
                    }
                }
            }

            if (!Object.keys(data).length) {
                return cb({ success: false, errorCode: "HOME_ERROR", message: "CineFreak catalog unavailable right now." });
            }

            cb({ success: true, data });
        } catch (e) {
            cb({ success: false, errorCode: "HOME_ERROR", message: e.message || String(e) });
        }
    }

    /**
     * 2. search: Searches CineFreak API
     */
    async function search(query, cb) {
        try {
            const baseUrl = getBaseUrl();
            const q = String(query || "").trim();
            if (!q) return cb({ success: true, data: [] });

            const searchUrl = `${baseUrl}/search-api.php?q=${encodeURIComponent(q)}&pg=1`;
            const res = await fetchJson(searchUrl);
            const rawList = res && res.results ? res.results : [];
            const results = [];

            for (let i = 0; i < rawList.length && results.length < 40; i++) {
                const item = rawList[i];
                if (!item || !item.l) continue;

                const isSeries = /series|drama|show|anime|tv\b/i.test(String(item.c || ""));
                results.push(createItem({
                    title: cleanTitle(item.t),
                    url: JSON.stringify({ slug: String(item.l) }),
                    posterUrl: item.i ? decodeEntities(item.i) : "",
                    bannerUrl: item.i ? decodeEntities(item.i) : "",
                    type: isSeries ? "tv" : "movie"
                }));
            }

            cb({ success: true, data: results });
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: e.message || String(e) });
        }
    }

    function extractDataset(html) {
        const marker = "const dataset=";
        const start = html.indexOf(marker);
        if (start < 0) return null;

        const valStart = start + marker.length;
        let end = html.indexOf(";let currentSeasonIdx", valStart);
        if (end < 0) end = html.indexOf(";</script>", valStart);
        if (end < 0) return null;

        let jsonStr = html.slice(valStart, end)
            .replace(/!0\b/g, "true")
            .replace(/!1\b/g, "false");

        try {
            return JSON.parse(jsonStr);
        } catch (e) {
            return null;
        }
    }

    /**
     * 3. load: Media details and seasons/episodes
     */
    async function load(url, cb) {
        try {
            const baseUrl = getBaseUrl();
            let parsed = null;
            try { parsed = JSON.parse(url); } catch (e) { parsed = null; }

            const slug = (parsed && parsed.slug) ? parsed.slug : url.replace(/https?:\/\/[^\/]+\//, "").replace(/\/$/, "");
            if (!slug) return cb({ success: false, errorCode: "BAD_URL", message: "Unrecognized item url" });

            const pageHtml = await fetchHtml(`${baseUrl}/${slug}/`);
            const titleMatch = pageHtml.match(/<meta property="og:title" content="([^"]*)"/);
            const imageMatch = pageHtml.match(/<meta property="og:image" content="([^"]*)"/);
            const title = cleanTitle(titleMatch ? titleMatch[1] : slug.replace(/-/g, " "));
            const poster = imageMatch ? decodeEntities(imageMatch[1]) : "";

            const dataset = extractDataset(pageHtml);
            const isSeries = !!(dataset && dataset.type === "series");
            const episodes = [];

            if (isSeries && Array.isArray(dataset.seasons) && dataset.seasons.length > 0) {
                for (let sIdx = 0; sIdx < dataset.seasons.length; sIdx++) {
                    const season = dataset.seasons[sIdx] || {};
                    const epList = season.episodes || [];
                    const seasonName = String(season.season_name || `Season ${sIdx + 1}`);

                    for (let eIdx = 0; eIdx < epList.length; eIdx++) {
                        const ep = epList[eIdx] || {};
                        if (!ep.sources) continue;

                        const epNum = parseInt(String(ep.ep_num || eIdx + 1), 10) || (eIdx + 1);
                        const epTitle = String(ep.ep_title || `Episode ${epNum}`);
                        const epMeta = String(ep.ep_meta || "");

                        episodes.push(createEpisode({
                            name: `${seasonName} · ${epTitle}${epMeta ? " · " + epMeta : ""}`,
                            url: JSON.stringify({ slug, s: sIdx, e: eIdx }),
                            season: sIdx + 1,
                            episode: epNum
                        }));
                    }
                }
            }

            if (!episodes.length) {
                episodes.push(createEpisode({
                    name: "Play Full Movie",
                    url: JSON.stringify({ slug, s: -1, e: -1 }),
                    season: 1,
                    episode: 1
                }));
            }

            cb({
                success: true,
                data: createItem({
                    title: title,
                    url: url,
                    posterUrl: poster,
                    bannerUrl: poster,
                    type: isSeries ? "tv" : "movie",
                    episodes: episodes
                })
            });
        } catch (e) {
            cb({ success: false, errorCode: "DETAIL_ERROR", message: e.message || String(e) });
        }
    }

    async function resolveStreamsFromSources(sources) {
        if (!sources) return [];
        const params = [`key=${encodeURIComponent(API_KEY)}`];
        const keys = Object.keys(sources);

        for (const k of keys) {
            params.push(`r${encodeURIComponent(k)}=${encodeURIComponent(sources[k])}`);
        }

        const primaryId = sources["720p"] || sources["1080p"] || sources["480p"] || sources[keys[0]];
        if (primaryId) {
            params.push(`id=${encodeURIComponent(primaryId)}`);
        }

        const res = await fetchJson(`${STREAM_API}?${params.join("&")}`);
        if (!res) return [];

        const streamResults = [];
        const resolutions = (res.resolutions || []).slice().sort((a, b) => {
            const qA = parseInt(String(a.quality || "").match(/(\d+)/)?.[1] || "0", 10);
            const qB = parseInt(String(b.quality || "").match(/(\d+)/)?.[1] || "0", 10);
            return qB - qA;
        });

        for (const r of resolutions) {
            if (!r || !r.url) continue;
            streamResults.push(createStream({
                url: String(r.url),
                source: `CineFreak · ${String(r.quality || "Auto")}`,
                headers: { "User-Agent": USER_AGENT }
            }));
        }

        if (!streamResults.length && res.videoUrl) {
            streamResults.push(createStream({
                url: String(res.videoUrl),
                source: "CineFreak",
                headers: { "User-Agent": USER_AGENT }
            }));
        }

        return streamResults;
    }

    /**
     * 4. loadStreams: Direct playback link resolver
     */
    async function loadStreams(url, cb) {
        try {
            const baseUrl = manifest.baseUrl || "https://cinefreak.net";
            let parsed = null;
            let raw = String(url || "").trim();
            if (raw.startsWith('"') && raw.endsWith('"')) {
                try { raw = JSON.parse(raw); } catch(e) {}
            }
            try {
                parsed = JSON.parse(raw);
            } catch (e) {
                try {
                    parsed = JSON.parse(raw.replace(/\\"/g, '"'));
                } catch (e2) {
                    parsed = null;
                }
            }

            let slug = "";
            let s = -1;
            let ep = -1;

            if (parsed && typeof parsed === "object") {
                slug = parsed.slug || "";
                s = parsed.s != null ? parsed.s : -1;
                ep = parsed.e != null ? parsed.e : -1;
            }

            if (!slug) {
                const match = raw.match(/cinefreak\.net\/([a-z0-9-]+)/i) || raw.match(/([a-z0-9-]+)/);
                if (match) slug = match[1];
            }

            if (!slug) {
                return cb({ success: false, errorCode: "BAD_URL", message: "Unrecognized episode url" });
            }

            const pageHtml = await fetchHtml(`${baseUrl}/${slug}/`);
            const dataset = extractDataset(pageHtml);
            if (!dataset) {
                return cb({ success: false, errorCode: "NO_STREAMS", message: "No stream data on this page" });
            }

            let sources = null;
            if (s >= 0 && Array.isArray(dataset.seasons) && dataset.seasons[s]) {
                const seasonEps = dataset.seasons[s].episodes || [];
                const episodeObj = seasonEps[ep] || seasonEps[0];
                sources = episodeObj ? episodeObj.sources : null;
            }
            if (!sources) {
                sources = dataset.sources;
            }

            const streams = await resolveStreamsFromSources(sources);
            if (!streams.length) {
                return cb({ success: false, errorCode: "NO_STREAMS", message: "No playable stream found" });
            }

            cb({ success: true, data: streams });
        } catch (e) {
            cb({ success: false, errorCode: "STREAM_ERROR", message: e.message || String(e) });
        }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
