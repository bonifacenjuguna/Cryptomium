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
