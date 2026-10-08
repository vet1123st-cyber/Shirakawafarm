/* ------------------------------------------------------------
   1度読んだら端末に残して、次からは通信を待たずに開くための係
   ------------------------------------------------------------
   牛舎は電波が弱く、これまでは開くたびに本体（gzipで100KB以上）を
   落としていました。それがそのまま待ち時間になっていました。

   ここでやること：
   ・本体（index.html）は、まず端末の控えから出す → 待たない。圏外でも開く
   ・同時に裏で新しいものを取りに行き、控えを入れ替える → 次に開くと新しい
   ・version.txt は必ず外に聞く（控えから返すと、更新に気づけなくなる）
   ・Apps Script（別のドメイン）は何もせずそのまま通す

   このファイルは中身がほとんど変わらないので、GitHub に**1回上げれば**
   あとは置きっぱなしで構いません。
   困ったときは、アプリの 設定 →「アプリの控えを消して読み直す」で全部消せます。
   ------------------------------------------------------------ */
const CACHE = 'shirakawa-app-v1';
const PAGE  = './index.html';

self.addEventListener('install', e => {
  /* 立ち上がったその場で、いま開いている本体を控えに入れておきます。
     ブラウザがついさっき落としたものがそのまま使えるので、
     ここで余分に通信することはありません。
     これをしないと「2回目に開いたとき」に1回だけ落とし直しが起きます。 */
  e.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE);
      if (!(await cache.match(PAGE))) await cache.add(PAGE);
    } catch (err) { /* 入れられなくても、あとで入る */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    // 古い名前の控えが残っていたら片付ける
    const names = await caches.keys();
    await Promise.all(names.filter(n => n !== CACHE).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;      // Apps Script はそのまま
  if (url.pathname.endsWith('version.txt')) return;     // 版の確認は必ず外へ

  const isPage = req.mode === 'navigate' ||
                 url.pathname.endsWith('/') ||
                 url.pathname.endsWith('/index.html');
  if (!isPage) return;

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(PAGE);

    /* 控えがあれば、それで終わり。**裏で取り直すこともしません。**
       新しい版が出ているかは version.txt（36バイト）で分かるので、
       本体（100KB以上）は「変わったときだけ」落とせば十分です。
       毎回裏で落とすと、待ち時間にはならなくても通信量だけが増えます。 */
    if (hit) return hit;

    const res = await fetch(PAGE, { cache: 'no-cache' })
      .then(r => { if (r && r.ok) cache.put(PAGE, r.clone()); return r; })
      .catch(() => null);
    if (res) return res;
    return new Response(
      '<meta charset="utf-8"><body style="font-family:sans-serif;padding:24px">' +
      'まだ一度も開いたことがない端末です。電波のあるところで、もう一度開いてください。',
      { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } });
  })());
});

/* アプリから「新しい版を今すぐ控えに入れて」と頼まれたときの返事。
   version.txt が新しいと分かったときに、画面側から呼ばれます。 */
self.addEventListener('message', e => {
  const d = e.data || {};
  if (d.type !== 'pull') return;
  e.waitUntil((async () => {
    let ok = false;
    try {
      const res = await fetch(PAGE + (d.v ? '?v=' + encodeURIComponent(d.v) : ''),
                              { cache: 'reload' });
      if (res && res.ok){
        const cache = await caches.open(CACHE);
        await cache.put(PAGE, res.clone());
        ok = true;
      }
    } catch (err) { ok = false; }
    (e.source ? [e.source] : await self.clients.matchAll())
      .forEach(c => c.postMessage({ type: 'pulled', ok }));
  })());
});
