(function() {
    "use strict";

    const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

    function getBaseUrl() {
        if (typeof manifest !== "undefined" && manifest && manifest.baseUrl) {
            return manifest.baseUrl.replace(/\/+$/, "");
        }
        return "https://new3.moviesdrive.christmas";
    }

    function getHeaders(extraHeaders = {}) {
        return {
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Referer": getBaseUrl() + "/",
            ...extraHeaders
        };
    }

    const CATEGORIES = [
        { name: "Latest Movies", path: "/", type: "movie" },
        { name: "Bollywood Movies", path: "/category/bollywood/", type: "movie" },
        { name: "Hollywood Movies", path: "/category/hollywood/", type: "movie" },
        { name: "South Indian Movies", path: "/category/south-indian/", type: "movie" },
        { name: "Web Series", path: "/category/web-series/", type: "tv" },
        { name: "Prime Video", path: "/category/amzn-prime-video/", type: "movie" },
        { name: "Netflix", path: "/category/netflix/", type: "movie" },
        { name: "Hotstar", path: "/category/hotstar/", type: "movie" },
        { name: "K-Drama", path: "/category/k-drama/", type: "tv" }
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

    async function fetchHtml(url, extraHeaders = {}) {
        const headers = getHeaders(extraHeaders);
        const res = await timeoutPromise(http_get(url, headers), 25000);
        return res && res.body ? res.body : "";
    }

    function decodeEntities(s) {
        return String(s || "")
            .replace(/&#0?38;|&amp;/g, "&")
            .replace(/&#8211;|&ndash;/g, "–")
            .replace(/&#8217;/g, "'")
            .replace(/&quot;/g, '"')
            .replace(/&#0?39;|&apos;/g, "'")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">");
    }

    function cleanTitle(s) {
        let t = decodeEntities(s).replace(/^Download\s+/i, "");
        t = t.replace(/\s*\[[^\]]*\]\s*/g, " ");
        t = t.replace(/\s*\([^)]*\b(?:Dual Audio|ORGs|Clean|HQ|HC|HDTC|ESub)\b[^)]*\)/gi, "");
        t = t.replace(/\b(480p|720p|1080p|2160p|4k|HDRip|BluRay|WEB-DL|CAM|V2)\b.*$/i, "");
        return t.replace(/\s*–\s*.*$/i, "").trim() || decodeEntities(s);
    }

    function parseCards(html, defaultType) {
        const items = [];
        const seen = new Set();
        const base = getBaseUrl();

        const cardRegex = /<a[^>]+href="([^"]+)"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"[^>]*alt="([^"]+)"[\s\S]*?<\/a>/gi;
        let match;

        while ((match = cardRegex.exec(html)) !== null) {
            const href = match[1];
            const poster = match[2];
            const titleRaw = match[3];

            if (!href || href.includes("#") || seen.has(href)) continue;
            if (href.includes("/category/") || href.includes("/page/")) continue;
            seen.add(href);

            const title = cleanTitle(titleRaw);
            const fullUrl = href.startsWith("http") ? href : `${base}${href.startsWith("/") ? "" : "/"}${href}`;
            const fullPoster = poster.startsWith("http") ? poster : `${base}${poster.startsWith("/") ? "" : "/"}${poster}`;

            const isSeries = defaultType === "tv" || href.includes("series") || href.includes("season") || titleRaw.toLowerCase().includes("season");

            items.push(createItem({
                title: title,
                url: fullUrl,
                posterUrl: fullPoster,
                bannerUrl: fullPoster,
                type: isSeries ? "tv" : "movie"
            }));
        }

        return items;
    }

    /**
     * 1. getHome: Loads all categorized sections from MoviesDrive
     */
    async function getHome(cb) {
        try {
            const baseUrl = getBaseUrl();
            const data = {};

            const promises = CATEGORIES.map(async (cat) => {
                try {
                    const html = await fetchHtml(`${baseUrl}${cat.path}`);
                    const items = parseCards(html, cat.type);
                    return { name: cat.name, items };
                } catch (e) {
                    return { name: cat.name, items: [] };
                }
            });

            const results = await Promise.all(promises);

            for (const r of results) {
                if (r.items && r.items.length > 0) {
                    if (r.name === "Latest Movies") {
                        data["Trending"] = r.items.slice(0, 10);
                        data["Latest Movies"] = r.items;
                    } else {
                        data[r.name] = r.items;
                    }
                }
            }

            if (!Object.keys(data).length) {
                return cb({ success: false, errorCode: "HOME_ERROR", message: "Failed to load MoviesDrive" });
            }

            cb({ success: true, data });
        } catch (e) {
            cb({ success: false, errorCode: "HOME_ERROR", message: e.message || String(e) });
        }
    }

    /**
     * 2. search: Search movies and series on MoviesDrive
     */
    async function search(query, cb) {
        try {
            const baseUrl = getBaseUrl();
            const q = String(query || "").trim();
            if (!q) return cb({ success: true, data: [] });

            const searchUrl = `${baseUrl}/search.php?q=${encodeURIComponent(q)}&page=1`;
            const jsonStr = await fetchHtml(searchUrl);
            let items = [];

            try {
                const parsed = JSON.parse(jsonStr);
                const hits = parsed && Array.isArray(parsed.hits) ? parsed.hits : [];
                items = hits.map(hit => {
                    const doc = hit.document || {};
                    const title = cleanTitle(doc.post_title || "Untitled");
                    const href = doc.permalink ? (doc.permalink.startsWith("http") ? doc.permalink : `${baseUrl}${doc.permalink.startsWith("/") ? "" : "/"}${doc.permalink}`) : "";
                    const isSeries = (doc.category && doc.category.some(c => /series|k-drama|drama/i.test(c))) || /season/i.test(doc.post_title || "");

                    return createItem({
                        title: title,
                        url: href,
                        posterUrl: doc.post_thumbnail || "",
                        bannerUrl: doc.post_thumbnail || "",
                        type: isSeries ? "tv" : "movie"
                    });
                }).filter(it => it.url);
            } catch (e) {
                // Fallback to HTML search if JSON parse fails
                const html = await fetchHtml(`${baseUrl}/?s=${encodeURIComponent(q)}`);
                items = parseCards(html, "movie");
            }

            cb({ success: true, data: items });
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: e.message || String(e) });
        }
    }

    /**
     * 3. load: Media details, poster and quality options/episodes
     */
    async function load(url, cb) {
        try {
            const baseUrl = getBaseUrl();
            const fullUrl = url.startsWith("http") ? url : `${baseUrl}${url.startsWith("/") ? "" : "/"}${url}`;
            const html = await fetchHtml(fullUrl);
            if (!html) {
                return cb({ success: false, errorCode: "LOAD_ERROR", message: "Failed to load movie page" });
            }

            const titleMatch = html.match(/<meta property="og:title" content="([^"]*)"/i) || html.match(/<title>([^<]+)<\/title>/i);
            const imgMatch = html.match(/<meta property="og:image" content="([^"]*)"/i) || html.match(/<main[\s\S]*?<img[^>]+src="([^"]+)"/i);

            const title = cleanTitle(titleMatch ? titleMatch[1] : "Movie");
            const poster = imgMatch ? imgMatch[1] : "";

            const isSeries = url.includes("season") || url.includes("series") || title.toLowerCase().includes("season");
            const episodes = [];

            // Find all quality download/stream buttons
            const btnRegex = /<h5[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
            let btnMatch;
            let epCount = 0;

            while ((btnMatch = btnRegex.exec(html)) !== null) {
                const href = btnMatch[1];
                const text = btnMatch[2].replace(/<[^>]+>/g, "").trim();

                if (!href || href.includes("{{{") || href.includes("telegram") || href.includes("t.me")) continue;
                epCount++;

                episodes.push(createEpisode({
                    name: `${title} - ${text}`,
                    season: 1,
                    episode: epCount,
                    url: href,
                    posterUrl: poster
                }));
            }

            if (episodes.length === 0) {
                episodes.push(createEpisode({
                    name: title,
                    season: 1,
                    episode: 1,
                    url: fullUrl,
                    posterUrl: poster
                }));
            }

            const mediaItem = createItem({
                title: title,
                url: fullUrl,
                posterUrl: poster,
                bannerUrl: poster,
                type: isSeries ? "tv" : "movie",
                description: title,
                episodes: episodes
            });

            cb({ success: true, data: mediaItem });
        } catch (e) {
            cb({ success: false, errorCode: "LOAD_ERROR", message: e.message || String(e) });
        }
    }

    /**
     * 4. loadStreams: Resolves HubCloud fast CDN direct streams
     */
    async function loadStreams(url, cb) {
        try {
            const streams = [];
            const seen = new Set();

            function addStream(sUrl, label, referer) {
                if (!sUrl || seen.has(sUrl)) return;
                seen.add(sUrl);
                streams.push(createStream({
                    url: sUrl,
                    source: label || "MoviesDrive Stream",
                    headers: referer ? { "Referer": referer } : undefined
                }));
            }

            // Step 1: Fetch archive page (e.g. https://mdrive.lol/archive/...)
            const hubPageHtml = await fetchHtml(url);
            const hubLinks = [...hubPageHtml.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];

            let hcResolvedCount = 0;
            for (const hl of hubLinks) {
                const linkHref = hl[1];
                const linkText = hl[2].replace(/<[^>]+>/g, "").trim();

                // Check HubCloud links (limit to first 2 to keep response instant)
                if (linkHref.includes("hubcloud.cx/drive/") || linkHref.includes("hubcloud.") || linkHref.includes("/drive/")) {
                    if (hcResolvedCount < 2) {
                        hcResolvedCount++;
                        try {
                            const hcHtml = await fetchHtml(linkHref, { "Referer": url });
                            const genBtn = hcHtml.match(/<a[^>]+href="([^"]*gamerxyt\.com\/hubcloud\.php[^"]*)"/i);
                            if (genBtn && genBtn[1]) {
                                const genUrl = genBtn[1];
                                const genHtml = await fetchHtml(genUrl, { "Referer": linkHref });
                                const dlMatches = [...genHtml.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];

                                for (const dl of dlMatches) {
                                    const dlUrl = dl[1];
                                    const dlText = dl[2].replace(/<[^>]+>/g, "").trim();
                                    if (dlText.includes("Download") || dlText.includes("Server") || dlText.includes("FSL") || dlText.includes("10Gbps") || dlText.includes("PixelServer")) {
                                        addStream(dlUrl, `HubCloud [${dlText.replace(/^Download\s*\[?/i, "").replace(/\]?$/, "")}]`, genUrl);
                                    }
                                }
                            }
                        } catch (e) {}
                    }
                }

                // Check GDFlix links
                if (linkHref.includes("gdflix.dev/file/") || linkHref.includes("gdflix.")) {
                    addStream(linkHref, "GDFlix Fast Server", url);
                }
            }

            cb({ success: true, data: streams });
        } catch (e) {
            cb({ success: false, errorCode: "STREAM_ERROR", message: e.message || String(e) });
        }
    }

    // Export to global scope for SkyStream runtime
    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
