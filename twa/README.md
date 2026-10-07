# Turning Cryptomium into an Android app (TWA)

A Trusted Web Activity runs your live site full-screen inside Chrome with no address bar. Web Push keeps working
(`enableNotifications: true`), so alerts arrive as normal Android notifications.

1. Deploy the site and backend first (HTTPS). Set the backend VAPID variables (`npm run vapid` in `backend/`) and
   `ALLOWED_ORIGIN` to your real site address.
2. Edit `twa-manifest.json`: replace `YOUR-SITE.example`, choose a permanent `packageId`.
3. `npm i -g @bubblewrap/cli`, then in this folder: `bubblewrap init --manifest=https://YOUR-SITE.example/manifest.webmanifest`
   (or `bubblewrap build` to use this file), then `bubblewrap build`. It produces `app-release-bundle.aab` (Play Store)
   and an `.apk` for testing.
4. Digital Asset Links, or Chrome shows a URL bar: take the SHA-256 signing fingerprint (Play Console, App integrity,
   or `bubblewrap fingerprint`), then set in Vercel `ANDROID_PACKAGE=your.package.id` and
   `ANDROID_SHA256_CERTS=AA:BB:...` (comma separate several), and redeploy. Check
   `https://YOUR-SITE.example/.well-known/assetlinks.json`.
5. Play Console needs: privacy policy URL (`/privacy` is ready), data-safety form (push address, alerts, no account), 512px icon, screenshots.

Test on a real phone: install the APK, open from a notification, press Back, go offline and back, rotate. Without the
fingerprint step the app opens with a visible address bar.

## Two versions, two release paths

| | Web app (this repo's `frontend/`) | Android shell (this folder) |
|---|---|---|
| Version | `frontend/package.json` (shown in the app: Settings, App updates) | `appVersionName` / `appVersionCode` in `twa-manifest.json` |
| What changes it | UI, features, API calls, service worker, caches, notifications | Package id, signing key, icons, splash, Android-only settings, Bubblewrap/TWA library upgrades |
| How it ships | `git push` > Vercel deploy > the app's Update Center installs it (automatic, or on Update now when set to Manual) | A new `.aab` through Play Console. Needed rarely |

The shell only opens the live site, so a web release never needs a Play Store release. Do not bump the shell version for a web
release, and do not copy the web version into `twa-manifest.json`. The web app contains no Android updater and never downloads an APK.

A new shell release is only needed when `twa-manifest.json` changes (icons, colours, package settings, shortcuts) or Bubblewrap asks for it.

Themed (monochrome) icon: `monochromeIconUrl` points at `icon-monochrome-512.png`. Android 13 and newer paints it in the wallpaper colours
when the person turns on "Themed icons" in Wallpaper and style. Older Android versions keep the normal icon.
