// ============================================================
//  HANA LIMA — Service Worker (קאשינג בסיסי של קבצי הליבה)
// ============================================================
//  מאפשר פתיחה מהירה ועבודה בסיסית גם בלי רשת.
//  את הנתונים עצמם מנהל Firestore עם offline persistence.
// ============================================================

const CACHE = "hana-lima-v5";
const CORE = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./firebase-config.js",
  "./manifest.json",
  "./icon-180.png",
  "./icon-192.png",
  "./icon-512.png",
];

// התקנה — שמירת קבצי הליבה במטמון
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(CORE)).then(() => self.skipWaiting())
  );
});

// הפעלה — ניקוי מטמונים ישנים
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// שליפה:
//  - בקשות ל-Firebase/גוגל: תמיד מהרשת (לא מקאשים נתונים חיים).
//  - קבצי הליבה: קודם מהמטמון, ואם אין — מהרשת.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // לא לגעת בבקשות רשת של Firebase / Google APIs / גופנים
  if (
    url.hostname.includes("firebaseio.com") ||
    url.hostname.includes("googleapis.com") ||
    url.hostname.includes("gstatic.com") ||
    url.hostname.includes("firebase") ||
    url.hostname.includes("google.com")
  ) {
    return; // ברירת מחדל: הדפדפן ניגש לרשת
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          // שמירה במטמון של קבצים מאותו origin בלבד
          if (res && res.status === 200 && url.origin === self.location.origin) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
    })
  );
});
