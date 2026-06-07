export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  
  let path = decodeURIComponent(url.pathname);
  if (path.startsWith('/')) path = path.slice(1);
  if (path.endsWith('/')) path = path.slice(0, -1);

  if (path.match(/\.(jpg|jpeg|png|webp|gif)$/i)) {
    const object = await env.PHOTOS_BUCKET.get(path);
    if (!object) {
      return new Response("Image not found", { status: 404 });
    }
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('Cache-Control', 'public, max-age=604800'); 
    return new Response(object.body, { headers });
  }

  const rootList = await env.PHOTOS_BUCKET.list({ delimiter: '/' });
  const folders = rootList.delimitedPrefixes.map(p => p.slice(0, -1)); 

  const activeFolder = path || folders[0] || '';

  let images = [];
  if (activeFolder) {
    const folderList = await env.PHOTOS_BUCKET.list({ prefix: `${activeFolder}/` });
    images = folderList.objects.filter(obj => obj.key.match(/\.(jpg|jpeg|png|webp|gif)$/i));
  }

  const sidebarLinksHtml = folders.map(folder => {
    const displayName = folder.replace(/_/g, ' ').replace(/-/g, ' ');
    const isActive = folder === activeFolder ? 'class="active"' : '';
    return `<a href="/${encodeURIComponent(folder)}" ${isActive}>${displayName}</a>`;
  }).join('\n');

  const photoGridHtml = images.map(img => {
    return `
      <div class="grid-item">
        <img src="/${encodeURIComponent(img.key)}" alt="${activeFolder} photo" loading="lazy" />
      </div>
    `;
  }).join('\n');

  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${activeFolder ? activeFolder.replace(/_/g, ' ') : 'Photo Gallery'}</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #fff; color: #111; display: flex; }
        aside { position: fixed; left: 0; top: 0; bottom: 0; width: 260px; padding: 40px 30px; border-right: 1px solid #efefef; overflow-y: auto; }
        aside h1 a { font-size: 18px; font-weight: 600; text-decoration: none; color: #000; letter-spacing: -0.5px; }
        aside nav { margin-top: 40px; display: flex; flex-direction: column; gap: 12px; }
        aside nav a { text-decoration: none; color: #777; font-size: 14px; transition: color 0.2s; text-transform: capitalize; }
        aside nav a:hover, aside nav a.active { color: #000; font-weight: 500; }
        main { margin-left: 260px; flex-grow: 1; padding: 40px; }
        .photo-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(350px, 1fr)); gap: 20px; }
        .grid-item { width: 100%; overflow: hidden; background: #fafafa; aspect-ratio: 3 / 2; }
        .grid-item img { width: 100%; height: 100%; object-fit: cover; display: block; transition: opacity 0.3s ease; }
        .grid-item img:hover { opacity: 0.9; }
        @media (max-width: 768px) {
          body { flex-direction: column; }
          aside { position: relative; width: 100%; height: auto; border-right: none; border-bottom: 1px solid #efefef; padding: 20px; }
          aside nav { margin-top: 15px; flex-direction: row; flex-wrap: wrap; gap: 15px; }
          main { margin-left: 0; padding: 20px; }
          .photo-grid { grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 15px; }
        }
      </style>
    </head>
    <body>
      <aside>
        <h1><a href="/">Gallery</a></h1>
        <nav>
          ${sidebarLinksHtml || '<span style="color:#aaa;font-size:12px;">No folders uploaded yet</span>'}
        </nav>
      </aside>
      <main>
        <div class="photo-grid">
          ${photoGridHtml || '<p style="color:#777;">This folder is empty or loading...</p>'}
        </div>
      </main>
    </body>
    </html>
  `;

  return new Response(html, {
    headers: { "Content-Type": "text/html;charset=UTF-8" }
  });
}