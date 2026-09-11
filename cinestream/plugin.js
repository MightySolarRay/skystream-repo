(function() {
    "use strict";

    const CINEMETA_CATALOG = "https://cinemeta-catalogs.strem.io";
    const CINEMETA_META = "https://v3-cinemeta.strem.io";
    const KITSU_URL = "https://anime-kitsu.strem.fun";
    const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

    const DEFAULT_HEADERS = {
        "User-Agent": USER_AGENT,
        "Accept": "application/json, text/plain, */*"
    };

    function getCatalogBase() {
        if (typeof manifest !== "undefined" && manifest && manifest.baseUrl) {
            return manifest.baseUrl.replace(/\/+$/, "");
        }
        return CINEMETA_CATALOG;
    }

    function getCatalogSections() {
        const catBase = getCatalogBase();
        return [
            { name: "Top Movies", url: `${catBase}/top/catalog/movie/top.json`, type: "movie" },
            { name: "Top Series", url: `${catBase}/top/catalog/series/top.json`, type: "tv" },
            { name: "Airing Anime", url: `${KITSU_URL}/catalog/anime/kitsu-anime-airing.json`, type: "tv" },
            { name: "Top Anime", url: `${KITSU_URL}/catalog/anime/kitsu-anime-trending.json`, type: "tv" },
            { name: "Action Movies", url: `${catBase}/top/catalog/movie/top/genre=Action.json`, type: "movie" },
            { name: "Comedy Movies", url: `${catBase}/top/catalog/movie/top/genre=Comedy.json`, type: "movie" },
            { name: "Horror Movies", url: `${catBase}/top/catalog/movie/top/genre=Horror.json`, type: "movie" },
            { name: "Sci-Fi & Fantasy", url: `${catBase}/top/catalog/movie/top/genre=Sci-Fi.json`, type: "movie" },
            { name: "Animation", url: `${catBase}/top/catalog/movie/top/genre=Animation.json`, type: "movie" }
        ];
    }

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

    async function fetchJson(url, extraHeaders = {}) {
        const headers = { ...DEFAULT_HEADERS, ...extraHeaders };
        const res = await timeoutPromise(http_get(url, headers), 20000);
        try {
            return JSON.parse(res && res.body ? res.body : "{}");
        } catch (e) {
            return {};
        }
    }

    async function fetchText(url, extraHeaders = {}) {
        const headers = { ...DEFAULT_HEADERS, ...extraHeaders };
        const res = await timeoutPromise(http_get(url, headers), 20000);
        return res && res.body ? res.body : "";
    }

    function getPoster(meta) {
        if (!meta) return "";
        if (meta.poster) {
            if (meta.poster.startsWith("http")) return meta.poster;
            return `https://images.metahub.space/poster/medium/${meta.id}/img`;
        }
        if (meta.id && meta.id.startsWith("tt")) {
            return `https://images.metahub.space/poster/medium/${meta.id}/img`;
        }
        return "";
    }

    /**
     * 1. getHome: Loads featured and categorized movies/series/anime from Cinemeta catalogs
     */
    async function getHome(cb) {
        try {
            const data = {};

            const sectionPromises = getCatalogSections().map(async (sec) => {
                try {
                    const res = await fetchJson(sec.url);
                    const metas = res && Array.isArray(res.metas) ? res.metas : [];
                    const items = metas.slice(0, 20).map((m) => {
                        const isSeries = m.type === "series" || sec.type === "tv";
                        return createItem({
                            title: m.name || "Untitled",
                            url: JSON.stringify({ id: m.id, type: isSeries ? "series" : "movie" }),
                            posterUrl: getPoster(m),
                            bannerUrl: m.background || getPoster(m),
                            type: isSeries ? "tv" : "movie",
                            description: m.description || "",
                            score: m.imdbRating ? parseFloat(m.imdbRating) : undefined
                        });
                    });
                    return { name: sec.name, items };
                } catch (e) {
                    return { name: sec.name, items: [] };
                }
            });

            const results = await Promise.all(sectionPromises);
            for (const r of results) {
                if (r.items && r.items.length > 0) {
                    if (r.name === "Top Movies") {
                        data["Trending"] = r.items.slice(0, 10);
                        data["Top Movies"] = r.items;
                    } else {
                        data[r.name] = r.items;
                    }
                }
            }

            if (!Object.keys(data).length) {
                return cb({ success: false, errorCode: "HOME_ERROR", message: "Cinemeta catalog unavailable" });
            }

            cb({ success: true, data });
        } catch (e) {
            cb({ success: false, errorCode: "HOME_ERROR", message: e.message || String(e) });
        }
    }

    /**
     * 2. search: Searches Cinemeta movie and series catalogs concurrently
     */
    async function search(query, cb) {
        try {
            const q = String(query || "").trim();
            if (!q) return cb({ success: true, data: [] });

            const enc = encodeURIComponent(q);
            const endpoints = [
                `${CINEMETA_META}/catalog/movie/top/search=${enc}.json`,
                `${CINEMETA_META}/catalog/series/top/search=${enc}.json`,
                `${KITSU_URL}/catalog/anime/kitsu-anime-airing/search=${enc}.json`
            ];

            const fetches = endpoints.map((u) => fetchJson(u).catch(() => ({})));
            const responses = await Promise.all(fetches);

            const items = [];
            const seen = new Set();

            for (const res of responses) {
                const list = res && Array.isArray(res.metas) ? res.metas : [];
                for (const m of list) {
                    if (!m || !m.id || seen.has(m.id)) continue;
                    seen.add(m.id);

                    const isSeries = m.type === "series" || m.type === "anime";
                    items.push(createItem({
                        title: m.name || "Untitled",
                        url: JSON.stringify({ id: m.id, type: isSeries ? "series" : "movie" }),
                        posterUrl: getPoster(m),
                        bannerUrl: m.background || getPoster(m),
                        type: isSeries ? "tv" : "movie",
                        description: m.description || "",
                        score: m.imdbRating ? parseFloat(m.imdbRating) : undefined
                    }));
                }
            }

            cb({ success: true, data: items });
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: e.message || String(e) });
        }
    }

    /**
     * 3. load: Fetches detailed metadata and seasons/episodes
     */
    async function load(url, cb) {
        try {
            let id = "";
            let type = "movie";

            if (url.startsWith("{")) {
                try {
                    const parsed = JSON.parse(url);
                    id = parsed.id || "";
                    type = parsed.type === "series" ? "series" : "movie";
                } catch (e) {
                    id = url;
                }
            } else {
                id = url;
                if (url.includes("series")) type = "series";
            }

            if (!id) return cb({ success: false, errorCode: "LOAD_ERROR", message: "Invalid item ID" });

            const isKitsu = id.startsWith("kitsu:");
            const metaBase = isKitsu ? KITSU_URL : CINEMETA_META;
            const metaUrl = `${metaBase}/meta/${type}/${encodeURIComponent(id)}.json`;

            const metaRes = await fetchJson(metaUrl);
            const m = metaRes && metaRes.meta ? metaRes.meta : null;
            if (!m) {
                return cb({ success: false, errorCode: "LOAD_ERROR", message: "Failed to retrieve media metadata" });
            }

            const title = m.name || "Untitled";
            const poster = getPoster(m);
            const isSeries = type === "series" || (Array.isArray(m.videos) && m.videos.length > 0);
            const episodes = [];

            if (isSeries && Array.isArray(m.videos) && m.videos.length > 0) {
                for (const v of m.videos) {
                    const sNum = v.season != null ? v.season : 1;
                    const eNum = v.number != null ? v.number : (v.episode != null ? v.episode : 1);
                    if (sNum === 0 && m.videos.length > 1) continue; // Skip specials if regular episodes present

                    const payload = JSON.stringify({
                        title: title,
                        imdbId: m.imdb_id || (id.startsWith("tt") ? id : ""),
                        tmdbId: m.moviedb_id || null,
                        season: sNum,
                        episode: eNum,
                        year: m.year ? parseInt(m.year) : undefined,
                        mediaType: "tv"
                    });

                    episodes.push(createEpisode({
                        name: v.title || v.name || `Episode ${eNum}`,
                        season: sNum,
                        episode: eNum,
                        url: payload,
                        posterUrl: v.thumbnail || poster
                    }));
                }
            } else {
                const payload = JSON.stringify({
                    title: title,
                    imdbId: m.imdb_id || (id.startsWith("tt") ? id : ""),
                    tmdbId: m.moviedb_id || null,
                    season: null,
                    episode: null,
                    year: m.year ? parseInt(m.year) : undefined,
                    mediaType: "movie"
                });

                episodes.push(createEpisode({
                    name: "Play Movie",
                    season: 1,
                    episode: 1,
                    url: payload,
                    posterUrl: poster
                }));
            }

            const mediaItem = createItem({
                title: title,
                url: url,
                posterUrl: poster,
                bannerUrl: m.background || poster,
                type: isSeries ? "tv" : "movie",
                description: m.description || "",
                year: m.year ? parseInt(String(m.year).slice(0, 4)) : undefined,
                score: m.imdbRating ? parseFloat(m.imdbRating) : undefined,
                episodes: episodes
            });

            cb({ success: true, data: mediaItem });
        } catch (e) {
            cb({ success: false, errorCode: "LOAD_ERROR", message: e.message || String(e) });
        }
    }

    /**
     * 4. loadStreams: Resolves multi-source streaming embeds and direct players
     */
    async function loadStreams(url, cb) {
        try {
            let info = null;
            let raw = String(url || "").trim();
            if (raw.startsWith('"') && raw.endsWith('"')) {
                try { raw = JSON.parse(raw); } catch(e) {}
            }
            try {
                info = JSON.parse(raw);
            } catch (e) {
                // Try unescaping backslashes
                try {
                    info = JSON.parse(raw.replace(/\\"/g, '"'));
                } catch (e2) {
                    info = null;
                }
            }

            if (!info || typeof info !== "object") {
                const ttMatch = raw.match(/tt\d+/);
                info = {
                    imdbId: ttMatch ? ttMatch[0] : (raw.startsWith("tt") ? raw : ""),
                    title: raw,
                    season: null,
                    episode: null,
                    mediaType: "movie"
                };
            }

            const title = info.title || "";
            let imdbId = info.imdbId || (info.id && String(info.id).startsWith("tt") ? info.id : "");
            if (!imdbId && typeof url === "string") {
                const m = url.match(/tt\d+/);
                if (m) imdbId = m[0];
            }
            const season = info.season;
            const episode = info.episode;
            const isTv = !!season;

            const streams = [];

            // 1. VidSrc.to Embed Resolver
            if (imdbId) {
                const vsUrl = isTv
                    ? `https://vidsrc.to/embed/tv/${imdbId}/${season}/${episode}`
                    : `https://vidsrc.to/embed/movie/${imdbId}`;
                streams.push(createStream({
                    url: vsUrl,
                    source: "VidSrc [Stream 1]",
                    headers: { "Referer": "https://vidsrc.to/" }
                }));
            }

            // 2. Videasy Embed Resolver
            if (imdbId) {
                const veUrl = isTv
                    ? `https://player.videasy.to/tv/${imdbId}/${season}/${episode}`
                    : `https://player.videasy.to/movie/${imdbId}`;
                streams.push(createStream({
                    url: veUrl,
                    source: "Videasy [Stream 2]",
                    headers: { "Referer": "https://player.videasy.to/" }
                }));
            }

            // 3. MultiMovies Fast Search & DooPlay Resolver
            if (title) {
                try {
                    const searchEnc = encodeURIComponent(title);
                    const mmHtml = await fetchText(`https://multimovies.beer/?s=${searchEnc}`);
                    const cardMatch = mmHtml.match(/<div class="title">\s*<a href="([^"]+)">([^<]+)<\/a>/i);
                    if (cardMatch && cardMatch[1]) {
                        const moviePageHtml = await fetchText(cardMatch[1]);
                        const optRegex = /data-post="(\d+)"\s+data-nume="(\d+)"\s+data-type="([^"]+)"/g;
                        let optM;
                        let count = 0;
                        while ((optM = optRegex.exec(moviePageHtml)) !== null && count < 3) {
                            count++;
                            const postId = optM[1];
                            const nume = optM[2];
                            const dtype = optM[3];
                            const formBody = `action=doo_player_ajax&post=${postId}&nume=${nume}&type=${dtype}`;
                            const ajaxRes = await timeoutPromise(http_post(
                                "https://multimovies.beer/wp-admin/admin-ajax.php",
                                {
                                    "Content-Type": "application/x-www-form-urlencoded",
                                    "X-Requested-With": "XMLHttpRequest",
                                    "Referer": cardMatch[1]
                                },
                                formBody
                            ), 8000);
                            if (ajaxRes && ajaxRes.body) {
                                try {
                                    const parsed = JSON.parse(ajaxRes.body);
                                    if (parsed.embed_url) {
                                        const iframeMatch = parsed.embed_url.match(/src="([^"]+)"/i) || [null, parsed.embed_url];
                                        const finalLink = iframeMatch[1] || parsed.embed_url;
                                        if (finalLink && !finalLink.includes("youtube.com")) {
                                            streams.push(createStream({
                                                url: finalLink,
                                                source: `MultiMovies Server ${count}`,
                                                headers: { "Referer": "https://multimovies.beer/" }
                                            }));
                                        }
                                    }
                                } catch (e) {}
                            }
                        }
                    }
                } catch (e) {}
            }

            // 4. Movies4u Fallback Search Resolver
            if (title) {
                try {
                    const m4uHtml = await fetchText(`https://new5.movies4u.clinic/?s=${encodeURIComponent(title)}`, {
                        "Cookie": "xla=s4t"
                    });
                    const m4uMatch = m4uHtml.match(/<article[\s\S]*?<a href="([^"]+)"[\s\S]*?<h[23][^>]*>([^<]+)<\/h[23]>/i);
                    if (m4uMatch && m4uMatch[1]) {
                        const m4uDetail = await fetchText(m4uMatch[1], { "Cookie": "xla=s4t" });
                        const dlMatches = [...m4uDetail.matchAll(/class="[^"]*downloads-btns-div[^"]*"[\s\S]*?<a[^>]+href="([^"]+)"/gi)];
                        for (let i = 0; i < Math.min(dlMatches.length, 2); i++) {
                            const dlUrl = dlMatches[i][1];
                            streams.push(createStream({
                                url: dlUrl,
                                source: `Movies4u [Server ${i + 1}]`,
                                headers: { "Referer": m4uMatch[1] }
                            }));
                        }
                    }
                } catch (e) {}
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
