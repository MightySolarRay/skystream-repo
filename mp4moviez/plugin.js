(function() {
    "use strict";

    const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

    function getBaseUrl() {
        if (typeof manifest !== "undefined" && manifest && manifest.baseUrl) {
            return manifest.baseUrl.replace(/\/+$/, "");
        }
        return "https://www.mp4moviez.mu";
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

    function getHeaders(referer) {
        const base = getBaseUrl();
        return {
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Referer": referer || (base + "/")
        };
    }

    function fixUrl(url, base) {
        if (!url) return "";
        const b = base || getBaseUrl();
        if (url.startsWith("//")) return "https:" + url;
        if (url.startsWith("http://") || url.startsWith("https://")) return url;
        return b + (url.startsWith("/") ? "" : "/") + url;
    }

    /**
     * Helper to fetch HTML and parse it into a DOM Document.
     */
    async function fetchDoc(url, referer) {
        const fullUrl = fixUrl(url);
        const res = await http_get(fullUrl, getHeaders(referer));
        if (!res || !res.body) return null;
        return await parseHtml(res.body);
    }

    /**
     * Extracts a MultimediaItem from a container element (.fl)
     */
    function extractItem(el, baseUrl) {
        const a = el.querySelector('a');
        if (!a) return null;

        const href = a.getAttribute('href');
        if (!href) return null;
        const fullUrl = fixUrl(href, baseUrl);

        const img = el.querySelector('img');
        const title = (img?.getAttribute('alt') || a.textContent || "").trim();
        const imgSrc = img?.getAttribute('src');
        const posterUrl = imgSrc ? fixUrl(imgSrc, baseUrl) : '';

        const isTv = fullUrl.includes("series") || fullUrl.includes("season") || 
                     title.toLowerCase().includes("season") || title.toLowerCase().includes("series");

        return createItem({
            title: title,
            url: fullUrl,
            posterUrl: posterUrl,
            type: isTv ? "tv" : "movie",
            headers: { "Referer": baseUrl }
        });
    }

    /**
     * Categories ported from CloudStream Mp4MoviezProvider
     */
    const CATEGORIES = [
        { name: "Latest Updates", path: "" },
        { name: "Hot Web Series", path: "/88/hot-web-series.html" },
        { name: "Old Bollywood Movies", path: "/22/bollywwood-old-movies.html" },
        { name: "Hollywood Movies", path: "/49/hollywood-all-movies.html" },
        { name: "Punjabi Movies", path: "/42/punjabi-movies-collection.html" },
        { name: "Kannada Movies", path: "/74/latest-kannada-movies.html" },
        { name: "Hindi Dubbed Series", path: "/189/netflix-series-hindi-dubbed.html" },
        { name: "Tagalog Movies", path: "/167/tagalog-movies.html" },
        { name: "Filipino Movies", path: "/267/filipino-movies.html" },
        { name: "Hindi Short Films", path: "/296/latest-hindi-short-films-(2024).html" },
        { name: "ULLU Web Series", path: "/245/ullu-web-series.html" }
    ];

    /**
     * 1. getHome: Loads all categorized dashboard sections
     */
    async function getHome(cb) {
        try {
            const baseUrl = getBaseUrl();
            const data = {};

            // Fetch categories concurrently
            const categoryPromises = CATEGORIES.map(async (cat) => {
                try {
                    const catUrl = cat.path ? fixUrl(cat.path, baseUrl) : baseUrl;
                    const doc = await fetchDoc(catUrl, baseUrl);
                    if (!doc) return { name: cat.name, items: [] };

                    const items = [];
                    const elements = doc.querySelectorAll('.fl');
                    for (const el of elements) {
                        const item = extractItem(el, baseUrl);
                        if (item && item.title) {
                            items.push(item);
                        }
                    }
                    return { name: cat.name, items };
                } catch (err) {
                    return { name: cat.name, items: [] };
                }
            });

            const results = await Promise.all(categoryPromises);

            for (const res of results) {
                if (res.items && res.items.length > 0) {
                    if (res.name === "Latest Updates") {
                        data["Trending"] = res.items.slice(0, 10);
                        data["Latest Updates"] = res.items;
                    } else {
                        data[res.name] = res.items;
                    }
                }
            }

            cb({ success: true, data });
        } catch (e) {
            cb({ success: false, errorCode: "PARSE_ERROR", message: e.message || String(e) });
        }
    }

    /**
     * 2. search: Handles search queries
     */
    async function search(query, cb) {
        try {
            const baseUrl = getBaseUrl();
            const q = String(query || "").trim();
            if (!q) return cb({ success: true, data: [] });

            const encoded = encodeURIComponent(q);
            const searchUrl = `${baseUrl}/search/${encoded}.html`;

            const doc = await fetchDoc(searchUrl, baseUrl);
            if (!doc) {
                return cb({ success: false, errorCode: "NETWORK_ERROR", message: "Search request failed" });
            }

            const results = [];
            const elements = doc.querySelectorAll('.fl');
            for (const el of elements) {
                const item = extractItem(el, baseUrl);
                if (item && item.title) {
                    results.push(item);
                }
            }

            cb({ success: true, data: results });
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: e.message || String(e) });
        }
    }

    /**
     * 3. load: Fetches media details
     */
    async function load(url, cb) {
        try {
            const baseUrl = getBaseUrl();
            const doc = await fetchDoc(url, baseUrl);
            if (!doc) {
                return cb({ success: false, errorCode: "NETWORK_ERROR", message: "Failed to load movie details" });
            }

            const rawTitle = doc.querySelector('.moviename')?.textContent.trim() || 
                             doc.querySelector('h1')?.textContent.trim() || 
                             doc.querySelector('h2')?.textContent.trim() || 
                             doc.querySelector('title')?.textContent.trim() || 
                             "";
            const title = rawTitle
                .replace(/^Download\s+/i, '')
                .replace(/\s+Download$/i, '')
                .trim() || "Mp4Moviez Video";
            const imgEl = doc.querySelector('.posterss') || doc.querySelector('img[src*="/cover/"]');
            const imgSrc = imgEl?.getAttribute('src');
            const posterUrl = imgSrc ? fixUrl(imgSrc, baseUrl) : '';
            const description = doc.querySelector('.description')?.textContent.trim() || "";

            // Year regex match
            const releaseText = doc.querySelector('.releasedate')?.textContent || "";
            const yearMatch = releaseText.match(/(\d{4})/);
            const year = yearMatch ? parseInt(yearMatch[1], 10) : undefined;

            // Rating / Duration
            const durationText = doc.querySelector('.duration')?.textContent.trim() || "";
            let score = undefined;
            const scoreMatch = durationText.match(/(\d+(\.\d+)?)/);
            if (scoreMatch && !durationText.includes("N/A")) {
                score = parseFloat(scoreMatch[1]);
            }

            // Find link to download page
            const downloadPageLink = doc.querySelector('.mast a, div[style*="text-align:left"] a, a[href*="-hd-"], a[href*="download"]');
            const targetDownloadUrl = downloadPageLink?.getAttribute('href');
            const finalWatchUrl = targetDownloadUrl ? fixUrl(targetDownloadUrl, baseUrl) : url;

            const isTv = url.includes("series") || url.includes("season") || 
                         title.toLowerCase().includes("season") || title.toLowerCase().includes("series");

            const mediaItem = createItem({
                title: title,
                url: finalWatchUrl,
                posterUrl: posterUrl,
                type: isTv ? "tv" : "movie",
                description: description,
                year: year,
                score: score,
                headers: { "Referer": baseUrl },
                episodes: [
                    createEpisode({
                        name: title,
                        url: finalWatchUrl,
                        season: 1,
                        episode: 1,
                        posterUrl: posterUrl
                    })
                ]
            });

            cb({ success: true, data: mediaItem });
        } catch (e) {
            cb({ success: false, errorCode: "LOAD_ERROR", message: e.message || String(e) });
        }
    }

    /**
     * Resolves multi-hop HTTP redirects (dl.php -> location -> .fastxmp4.com)
     */
    async function resolveDirectStream(fullDlUrl, referer) {
        let curr = fullDlUrl;
        let ref = referer;
        for (let hop = 0; hop < 5; hop++) {
            try {
                const res = await http_get(curr, {
                    "User-Agent": USER_AGENT,
                    "Referer": ref,
                    "Range": "bytes=0-0"
                });
                if (!res) break;
                if (res.headers && res.headers.location) {
                    let loc = res.headers.location;
                    if (!loc.startsWith('http')) {
                        try {
                            const u = new URL(curr);
                            loc = new URL(loc, u.origin).href;
                        } catch (e) {
                            loc = fixUrl(loc);
                        }
                    }
                    ref = curr;
                    curr = loc;
                    if (curr.includes('.fastxmp4.com') || curr.includes('.mp4') || curr.includes('/download/')) {
                        return curr;
                    }
                } else {
                    break;
                }
            } catch (e) {
                break;
            }
        }
        return curr;
    }

    /**
     * 4. loadStreams: Resolves direct FastxMp4 / mp4 video download links
     */
    async function loadStreams(url, cb) {
        try {
            const baseUrl = getBaseUrl();
            const doc = await fetchDoc(url, baseUrl);
            if (!doc) {
                return cb({ success: false, errorCode: "NETWORK_ERROR", message: "Failed to open download page" });
            }

            const streams = [];
            const seenUrls = new Set();
            const links = doc.querySelectorAll('a[href*="dl.php"]');

            for (const a of links) {
                const href = a.getAttribute('href');
                if (!href) continue;

                const fullDlUrl = fixUrl(href, baseUrl);
                if (seenUrls.has(fullDlUrl)) continue;
                seenUrls.add(fullDlUrl);

                const label = a.textContent.trim() || "";
                const isJio = a.nextElementSibling?.textContent?.includes("Jio") || false;

                // Quality extraction
                let quality = "Auto";
                const qMatch = href.match(/q=(\d+)/) || label.match(/(\d{3,4})[pP]/);
                if (qMatch) {
                    quality = `${qMatch[1]}p`;
                }

                // Follow redirects to get direct playable media URL (with clean fallback)
                let directUrl = fullDlUrl;
                try {
                    directUrl = await resolveDirectStream(fullDlUrl, url);
                } catch (e) {
                    directUrl = fullDlUrl;
                }

                streams.push(createStream({
                    url: directUrl,
                    source: `FastxMp4 ${quality}${isJio ? ' (Jio Server)' : ''}`,
                    headers: {
                        "Referer": url,
                        "User-Agent": USER_AGENT
                    }
                }));
            }

            cb({ success: true, data: streams });
        } catch (e) {
            cb({ success: false, errorCode: "STREAM_ERROR", message: String(e) });
        }
    }

    // Export to global scope for SkyStream runtime
    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
