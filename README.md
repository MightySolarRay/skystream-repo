# 🌌 msr-stream

Official plugin repository for [SkyStream](https://github.com/akashdh11/skystream).

---

## 🛠 Setting Up in SkyStream

SkyStream supports quick repository installation:

### Quick Add via Short Code:
In SkyStream, go to **Settings** > **Manage Extensions** > **Add Repository** and enter:
```text
MightySolarRay
```
*(The shortcode alias will automatically resolve to this repository).*

---

### Or Add via Full URL:
```text
https://raw.githubusercontent.com/MightySolarRay/skystream-repo/main/repo.json
```

---

## 📦 Included Plugins

| Plugin | Package ID | Categories | Description |
| :--- | :--- | :--- | :--- |
| **BanglaPlex [MSR]** | `com.skystream.repo.banglaplex` | Movies, Series | Dedicated Bengali movies, web series, Bollywood, and dual audio collection |
| **MoviesDrive [MSR]** | `com.skystream.repo.moviesdrive` | Movies, Series | Premier Hindi, Bollywood, Hollywood & Series provider with high-speed HubCloud CDN resolvers |
| **CineStream [MSR]** | `com.skystream.repo.cinestream` | Movies, Series, Anime | Multi-catalog streaming aggregator powered by Cinemeta & Kitsu with multiple fast stream resolvers |
| **CineFreak** | `com.skystream.repo.cinefreak` | Movies, Series | 19 categories (Hero Trending, Bollywood, Hollywood, Bengali, South Indian, Web Series, K-Drama) with direct CDN streams |
| **Mp4Moviez** | `com.skystream.repo.mp4moviez` | Movies | Bollywood, Hollywood & South Indian Hindi Dubbed Movies |

---

## 🚀 Getting Started with SkyStream

1. **Install SkyStream**: Download the latest release from the [SkyStream Releases page](https://github.com/akashdh11/skystream/releases/).
2. **Add Repository**: Enter `MightySolarRay` or the repository URL in **Manage Extensions**.
3. **Install Plugins**: Tap download next to CineFreak or Mp4Moviez.
4. **Browse & Watch**: Return to the **Home Screen** and switch to `msr-stream` using the bottom right provider switcher.

---

## 🛠 Development & Deployment

```bash
# Test a plugin
skystream test -f getHome

# Deploy & bundle all plugins
npm run deploy
```
