(function() {
    "use strict";

    const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

    function getBaseUrl() {
        if (typeof manifest !== "undefined" && manifest && manifest.baseUrl) {
            return manifest.baseUrl.replace(/\/+$/, "");
        }
        return "https://banglaplex.biz";
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
        { name: "Latest Releases", path: "", type: "movie" },
        { name: "Bengali Movies", path: "/genre/bengali-movies.html", type: "movie" },
        { name: "Bengali Web Series", path: "/genre/bengali-web-series.html", type: "tv" },
        { name: "Bollywood Movies", path: "/genre/bollywood-movies.html", type: "movie" },
        { name: "South Indian (Hindi Dubbed)", path: "/genre/south-indian-movies.html", type: "movie" },
        { name: "Hollywood Movies", path: "/genre/hollywood-movies.html", type: "movie" },
        { name: "Dual Audio Movies", path: "/genre/dual-audio-movies.html", type: "movie" },
        { name: "Hindi Web Series", path: "/genre/bollywood-series.html", type: "tv" }
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
    function createActor(s) {
        try { return new Actor(s); } catch (e) { return s; }
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

    async function postData(url, body, extraHeaders = {}) {
        const headers = getHeaders({
            "Content-Type": "application/x-www-form-urlencoded",
            ...extraHeaders
        });
        const res = await timeoutPromise(http_post(url, headers, body), 20000);
        return res && res.body ? res.body : "";
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
        return decodeEntities(s)
            .replace(/\|.*$/i, "")
            .replace(/Watch\s+Online.*$/i, "")
            .replace(/Download.*$/i, "")
            .replace(/\s*1080p.*$/i, "")
            .replace(/\s*720p.*$/i, "")
            .replace(/\s*480p.*$/i, "")
            .replace(/\s*WEB-DL.*$/i, "")
            .replace(/\s*HDRip.*$/i, "")
            .replace(/\s*HDTC.*$/i, "")
            .trim();
    }

    function fixUrl(url, base) {
        if (!url) return "";
        const b = base || getBaseUrl();
        if (url.startsWith("//")) return "https:" + url;
        if (url.startsWith("/")) return b + url;
        return url;
    }

    /**
     * Unpack packer-obfuscated javascript: eval(function(p,a,c,k,e,d)...)
     */
    function unpackJs(p, a, c, k) {
        function e(c) {
            return (c < a ? "" : e(parseInt(c / a, 10))) + ((c = c % a) > 35 ? String.fromCharCode(c + 29) : c.toString(36));
        }
        while (c--) {
            if (k[c]) {
                p = p.replace(new RegExp("\\b" + e(c) + "\\b", "g"), k[c]);
            }
        }
        return p;
    }

    /**
     * Parses card items from listing HTML
     */
    function parseCards(html, defaultType) {
        const items = [];
        const seen = new Set();

        // 1. Popup card container pattern
        const blockRegex = /<div class="popup">[\s\S]*?style="[^"]*url\('([^']+)'\)[\s\S]*?<div class="movie-title">\s*<h[1-6][^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
        let match;

        while ((match = blockRegex.exec(html)) !== null) {
            const poster = match[1];
            const href = match[2];
            const titleRaw = match[3].replace(/<[^>]+>/g, "").trim();

            if (!href || seen.has(href)) continue;
            seen.add(href);

            const title = cleanTitle(titleRaw);
            const fullUrl = fixUrl(href);
            const fullPoster = fixUrl(poster);

            const isSeries = defaultType === "tv" || href.includes("series") || title.toLowerCase().includes("season") || title.toLowerCase().includes("series");

            items.push(createItem({
                title: title,
                url: fullUrl,
                posterUrl: fullPoster,
                bannerUrl: fullPoster,
                type: isSeries ? "tv" : "movie"
            }));
        }

        // 2. Fallback card regex (movie-img container)
        if (items.length === 0) {
            const altRegex = /<div class="movie-img"[^>]*>[\s\S]*?<a href="([^"]+)"[\s\S]*?<\/a>[\s\S]*?<div class="movie-title">\s*<h[1-6][^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/gi;
            let m2;
            while ((m2 = altRegex.exec(html)) !== null) {
                const href = m2[1];
                const titleRaw = m2[2].replace(/<[^>]+>/g, "").trim();
                if (!href || seen.has(href)) continue;
                seen.add(href);

                const title = cleanTitle(titleRaw);
                const fullUrl = fixUrl(href);
                items.push(createItem({
                    title: title,
                    url: fullUrl,
                    type: defaultType || "movie"
                }));
            }
        }

        return items;
    }

    /**
     * 1. getHome: Loads all categorized movie and series sections
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
                    if (r.name === "Latest Releases" || r.name === "Bengali Movies") {
                        if (!data["Trending"]) {
                            data["Trending"] = r.items.slice(0, 10);
                        }
                    }
                    data[r.name] = r.items;
                }
            }

            if (!Object.keys(data).length) {
                return cb({ success: false, errorCode: "HOME_ERROR", message: "No content available" });
            }

            cb({ success: true, data });
        } catch (e) {
            cb({ success: false, errorCode: "HOME_ERROR", message: e.message || String(e) });
        }
    }

    /**
     * 2. search: Search movies and web series on BanglaPlex
     */
    async function search(query, cb) {
        try {
            const baseUrl = getBaseUrl();
            const q = String(query || "").trim();
            if (!q) return cb({ success: true, data: [] });

            const searchUrl = `${baseUrl}/search?q=${encodeURIComponent(q)}`;
            const html = await fetchHtml(searchUrl);
            const items = parseCards(html, "movie");

            cb({ success: true, data: items });
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: e.message || String(e) });
        }
    }

    /**
     * 3. load: Media details and episode parsing
     */
    async function load(url, cb) {
        try {
            const fullUrl = fixUrl(url);
            const html = await fetchHtml(fullUrl);
            if (!html) {
                return cb({ success: false, errorCode: "LOAD_ERROR", message: "Failed to load movie details" });
            }

            // Title
            const titleMatch = html.match(/<meta property="og:title" content="([^"]*)"/i) || html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || html.match(/<title>([^<]+)<\/title>/i);
            const title = cleanTitle(titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").trim() : "BanglaPlex Video");

            // Poster
            const imgMatch = html.match(/<meta property="og:image" content="([^"]*)"/i) || html.match(/id="info"[\s\S]*?<img[^>]+src="([^"]+)"/i) || html.match(/img class="img-responsive"[^>]+src="([^"]+)"/i);
            const poster = imgMatch ? fixUrl(imgMatch[1]) : "";

            // Description / Plot
            let plot = "";
            const descMatch = html.match(/<meta property="og:description" content="([^"]*)"/i);
            if (descMatch && descMatch[1].trim().length > 15) {
                plot = decodeEntities(descMatch[1].trim());
            } else {
                const pMatches = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map(m => decodeEntities(m[1].replace(/<[^>]+>/g, "").trim()));
                const candidate = pMatches.find(p =>
                    p.length > 20 &&
                    !p.startsWith("Genre:") &&
                    !p.startsWith("Actor:") &&
                    !p.startsWith("Director:") &&
                    !p.startsWith("Writer:") &&
                    !p.startsWith("Country:") &&
                    !p.startsWith("Watch") &&
                    !p.startsWith("Quality:") &&
                    !p.startsWith("Subscribe") &&
                    !p.startsWith("Copyright") &&
                    !p.startsWith("Opps")
                );
                if (candidate) plot = candidate;
            }

            // Actors
            const actorMatches = [...html.matchAll(/href="[^"]*\/star\/[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)];
            const actors = actorMatches.map(m => createActor({ name: m[1].replace(/<[^>]+>/g, "").trim() })).filter(a => a.name);

            // Year
            let year = undefined;
            const yearMatch = html.match(/Release:\s*(\d{4})/i) || html.match(/href="[^"]*\/year\/(\d{4})/i);
            if (yearMatch) {
                year = parseInt(yearMatch[1], 10);
            }

            // Duration
            let duration = undefined;
            const durMatch = html.match(/Duration:\s*(\d+)\s*Min/i);
            if (durMatch) {
                duration = parseInt(durMatch[1], 10);
            }

            // Trailer
            let trailerUrl = undefined;
            const trailerMatch = html.match(/href="([^"]*(?:youtube\.com\/watch\?v=|youtu\.be\/)[^"]*)"/i);
            if (trailerMatch) {
                trailerUrl = trailerMatch[1];
            }

            // Find pasteurl / download links from page
            const pasteLinks = [];
            const pasteMatches = [...html.matchAll(/href="([^"]*(?:pasteurl|pastetot|view)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)];
            for (const m of pasteMatches) {
                const href = fixUrl(m[1]);
                const text = m[2].replace(/<[^>]+>/g, "").trim();
                if (href && !pasteLinks.some(p => p.url === href)) {
                    pasteLinks.push({ url: href, text: text || "Download Link" });
                }
            }

            // Check if series
            const isSeries = url.includes("series") || title.toLowerCase().includes("season") || title.toLowerCase().includes("series") || html.includes("Episode") || (pasteLinks.length > 1 && (html.includes("Season") || html.includes("S0")));
            const episodes = [];

            if (isSeries && pasteLinks.length > 1) {
                pasteLinks.forEach((item, idx) => {
                    const epName = (item.text || "").replace(/\s+/g, " ").trim() || `Episode ${idx + 1}`;
                    let sNum = 1;
                    let epNum = idx + 1;

                    const sMatch = epName.match(/S(?:eason)?\s*(\d+)/i);
                    if (sMatch) sNum = parseInt(sMatch[1], 10);

                    const eMatch = epName.match(/E(?:pisode)?\s*(\d+)/i);
                    if (eMatch) epNum = parseInt(eMatch[1], 10);

                    episodes.push(createEpisode({
                        name: epName,
                        url: `${fullUrl}###${item.url}`,
                        season: sNum,
                        episode: epNum,
                        posterUrl: poster
                    }));
                });
            } else {
                const primaryPaste = pasteLinks.length > 0 ? pasteLinks[0].url : "";
                const playUrl = primaryPaste ? `${fullUrl}###${primaryPaste}` : fullUrl;

                episodes.push(createEpisode({
                    name: title,
                    url: playUrl,
                    season: 1,
                    episode: 1,
                    posterUrl: poster
                }));
            }

            const mediaItem = createItem({
                title: title,
                url: fullUrl,
                posterUrl: poster,
                bannerUrl: poster,
                type: isSeries ? "tv" : "movie",
                description: plot,
                year: year,
                duration: duration,
                cast: actors.slice(0, 10),
                trailerUrl: trailerUrl,
                headers: { "Referer": getBaseUrl() + "/" },
                episodes: episodes
            });

            cb({ success: true, data: mediaItem });
        } catch (e) {
            cb({ success: false, errorCode: "LOAD_ERROR", message: e.message || String(e) });
        }
    }

    /**
     * Resolves PasteURL protected links via form POST
     */
    async function resolvePasteUrl(pageUrl) {
        try {
            const html = await fetchHtml(pageUrl, { "Referer": getBaseUrl() + "/" });
            if (!html) return [];

            const tokenMatch = html.match(/<input[^>]+name="([^"]+)"[^>]+value="([^"]+)"/i);
            let targetHtml = html;

            if (tokenMatch) {
                const body = `${encodeURIComponent(tokenMatch[1])}=${encodeURIComponent(tokenMatch[2])}`;
                const resHtml = await postData(pageUrl, body, { "Referer": pageUrl });
                if (resHtml) targetHtml = resHtml;
            }

            const extracted = [...targetHtml.matchAll(/href="([^"]+)"/gi)]
                .map(m => m[1].trim())
                .filter(u => u.startsWith("http") && !u.includes("pasteurl") && !u.includes("pastetot") && !u.includes("bootstrapcdn") && !u.includes("google"));

            return Array.from(new Set(extracted));
        } catch (e) {
            return [];
        }
    }

    /**
     * Resolves StreamHG / Vibuxer packed Javascript to direct M3U8 streams
     */
    async function resolveStreamHG(hgUrl) {
        try {
            const fetchUrl = hgUrl.replace("hgcloud.to", "vibuxer.com").replace("streamhg.to", "vibuxer.com").replace("streamhg.com", "vibuxer.com");
            const html = await fetchHtml(fetchUrl, { "Referer": "https://hgcloud.to/" });
            if (!html) return [];

            let textToSearch = html;
            const packMatch = html.match(/eval\(function\(p,a,c,k,e,d\)[\s\S]*?\}\('(.*?)',(\d+),(\d+),'([^']+)'\.split\('\|'\)/);
            if (packMatch) {
                const p = packMatch[1];
                const a = parseInt(packMatch[2], 10);
                const c = parseInt(packMatch[3], 10);
                const k = packMatch[4].split("|");
                textToSearch = unpackJs(p, a, c, k).replace(/\\\//g, "/");
            }

            const m3u8Matches = [...textToSearch.matchAll(/https?:\/\/[^\s"'<>]+\.(?:m3u8|mp4)[^\s"'<>]*/g)].map(m => m[0]);
            return Array.from(new Set(m3u8Matches)).map(url => ({
                url,
                isM3u8: url.includes(".m3u8"),
                referer: fetchUrl
            }));
        } catch (e) {
            return [];
        }
    }

    /**
     * 4. loadStreams: Extract streaming embeds and download servers
     */
    async function loadStreams(url, cb) {
        try {
            const parts = url.split("###");
            const fullUrl = fixUrl(parts[0]);
            const targetPasteUrl = parts[1] || "";

            const html = await fetchHtml(fullUrl);
            const streams = [];
            const seen = new Set();

            function addStream(streamUrl, name, referer) {
                if (!streamUrl || !streamUrl.startsWith("http") || seen.has(streamUrl)) return;
                if (streamUrl.includes("/page/") || streamUrl.includes("privacy") || streamUrl.includes("terms") || streamUrl.includes("dmca")) return;
                seen.add(streamUrl);
                streams.push(createStream({
                    url: streamUrl,
                    source: name || "BanglaPlex Stream",
                    headers: referer ? { "Referer": referer } : undefined
                }));
            }

            // 1. Direct embed iframe in video player container (Plextream / Abyss)
            const iframeMatches = [...html.matchAll(/<iframe[^>]+src="([^"]+)"/gi)].map(m => m[1]);
            for (const iframe of iframeMatches) {
                if (iframe.includes("plextream.work")) {
                    try {
                        const plexHtml = await fetchHtml(iframe, { "Referer": fullUrl });
                        const innerIframes = [...plexHtml.matchAll(/<iframe[^>]+src="([^"]+)"/gi)].map(m => m[1]);
                        for (const inner of innerIframes) {
                            if (inner.includes("abyssplayer.com") || inner.includes("abyss.to")) {
                                addStream(inner, "BanglaPlex Abyss Player", "https://plextream.work/");
                            } else {
                                addStream(inner, "BanglaPlex Stream", "https://plextream.work/");
                            }
                        }
                    } catch (e) {}
                    addStream(iframe, "Plextream Server", fullUrl);
                } else if (!iframe.includes("youtube.com")) {
                    addStream(iframe, "BanglaPlex Player", fullUrl);
                }
            }

            // 2. Discover PasteURL / PasteTot links
            const candidatePasteUrls = [];
            if (targetPasteUrl) {
                candidatePasteUrls.push(targetPasteUrl);
            }
            const pagePasteMatches = [...html.matchAll(/href="([^"]*(?:pasteurl|pastetot)[^"]*)"/gi)].map(m => m[1]);
            for (const p of pagePasteMatches) {
                if (!candidatePasteUrls.includes(p)) candidatePasteUrls.push(p);
            }

            // 3. Resolve unlocked links from PasteURL & extract StreamHG/GDFlix links
            for (const pasteLink of candidatePasteUrls) {
                const unlocked = await resolvePasteUrl(pasteLink);
                for (const u of unlocked) {
                    if (u.includes("hgcloud.to") || u.includes("vibuxer.com") || u.includes("streamhg")) {
                        const hgStreams = await resolveStreamHG(u);
                        for (const s of hgStreams) {
                            addStream(s.url, "BanglaPlex [Fast HLS / StreamHG]", s.referer);
                        }
                    } else if (u.includes("gofile.io") || u.includes("streamtape.com")) {
                        addStream(u, `BanglaPlex [${u.includes("gofile") ? "GoFile" : "StreamTape"}]`, pasteLink);
                    } else {
                        addStream(u, "BanglaPlex [Mirror]", pasteLink);
                    }
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
