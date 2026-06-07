export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  
  let path = decodeURIComponent(url.pathname);
  if (path.startsWith('/')) path = path.slice(1);
  if (path.endsWith('/')) path = path.slice(0, -1);

  // 1. ASSET PASS-THROUGH
  if (path.match(/\.(jpg|jpeg|png|webp|gif|woff|woff2|ttf|otf|ico)$/i)) {
    const object = await env.PHOTOS_BUCKET.get(path);
    if (!object) {
      return new Response("Asset not found", { status: 404 });
    }
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('Cache-Control', 'public, max-age=604800'); 
    return new Response(object.body, { headers });
  }

  // 2. PAGE ROUTING LOGIC
  const isAbout = path.toLowerCase() === 'about';
  const isContact = path.toLowerCase() === 'contact';
  const isHome = path === '';
  const activeFolder = (isAbout || isContact || isHome) ? '' : path;

  // 3. GET FOLDERS FOR SIDEBAR
  const rootList = await env.PHOTOS_BUCKET.list({ delimiter: '/' });
  const folders = rootList.delimitedPrefixes.map(p => p.slice(0, -1)); 

  // 4. FETCH IMAGES
  let images = [];
  if (isHome) {
    const homeFoldersToLoad = ['BTS', 'Old Work']; 
    const folderPromises = homeFoldersToLoad.map(folderName => 
      env.PHOTOS_BUCKET.list({ prefix: `${folderName}/` })
    );
    const folderResults = await Promise.all(folderPromises);
    const combinedObjects = folderResults.flatMap(result => result.objects || []);
    images = combinedObjects.filter(obj => obj.key.match(/\.(jpg|jpeg|png|webp|gif)$/i));
  } else if (activeFolder) {
    const list = await env.PHOTOS_BUCKET.list({ prefix: `${activeFolder}/` });
    images = list.objects.filter(obj => obj.key.match(/\.(jpg|jpeg|png|webp|gif)$/i));
  }

  images.sort((a, b) => b.uploaded.getTime() - a.uploaded.getTime());

  // 5. RENDER SIDEBAR LINKS
  const sidebarLinksHtml = folders.map(folder => {
    const displayName = folder.replace(/_/g, ' ').replace(/-/g, ' ');
    const isActive = folder === activeFolder ? 'class="active"' : '';
    return `<a class="folder-link" href="/${encodeURIComponent(folder)}" ${isActive}>${displayName}</a>`;
  }).join('\n');

  // 6. RENDER MAIN CONTENT AREA
  let mainContentHtml = '';

  if (isAbout) {
    mainContentHtml = `
      <div class="static-page">
        <img src="/about.jpg" alt="Brad Jarvis" class="static-image" />
        <h2>About</h2>
        <p>Edit this text directly inside your [[path]].js file.</p>
      </div>
    `;
  } else if (isContact) {
    mainContentHtml = `
      <div class="static-page">
        <img src="/contact.jpg" alt="Contact Brad Jarvis" class="static-image" />
        <h2>Contact</h2>
        <p>Feel free to reach out to me for any inquiries.</p>
        <p><a href="mailto:hello@bradjarv.is">hello@bradjarv.is</a></p>
      </div>
    `;
  } else {
    if (images.length === 0) {
      mainContentHtml = `<p style="color:#777; font-family: sans-serif;">No photos found here yet.</p>`;
    } else {
      const photoGridHtml = images.map(img => {
        return `
          <div class="grid-item" onclick="openLightbox('/${encodeURIComponent(img.key)}')">
            <img src="/${encodeURIComponent(img.key)}" alt="Gallery photo" loading="lazy" />
          </div>
        `;
      }).join('\n');
      mainContentHtml = `<div class="photo-grid">${photoGridHtml}</div>`;
    }
  }

  // 7. FINAL HTML ASSEMBLY
  const pageTitle = activeFolder ? activeFolder.replace(/_/g, ' ') : (isAbout ? 'About' : (isContact ? 'Contact' : 'Home'));
  
  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Brad Jarvis | ${pageTitle}</title>
      
      <link rel="icon" type="image/png" href="/favicon.png">

      <style>
        @font-face {
          font-family: 'US101';
          src: url('/US101.woff') format('woff'),
               url('/US101.ttf') format('truetype');
          font-weight: normal;
          font-style: normal;
          font-display: swap;
        }

        * { 
          box-sizing: border-box; 
          margin: 0; 
          padding: 0; 
        }
        
        body { 
          font-family: 'US101', -apple-system, sans-serif; 
          background: #fff; 
          color: #111; 
          display: flex; 
          letter-spacing: 1px; 
        }
        
        /* Sidebar Styling */
        aside { 
          position: fixed; 
          left: 0; 
          top: 0; 
          bottom: 0; 
          width: 280px; 
          padding: 50px 40px; 
          overflow-y: auto; 
          z-index: 100; 
          background: #fff; 
        }
        
        aside h1 a { 
          font-size: 24px; 
          font-weight: bold; 
          text-decoration: none; 
          color: #000; 
          text-transform: uppercase; 
          letter-spacing: 2px; 
        }
        
        aside nav { 
          margin-top: 50px; 
          display: flex; 
          flex-direction: column; 
          gap: 15px; 
        }
        
        aside nav a { 
          text-decoration: none; 
          color: #555; 
          font-size: 13px; 
          transition: color 0.2s; 
          text-transform: uppercase; 
          letter-spacing: 1.5px; 
        }
        
        aside nav a:hover, 
        aside nav a.active { 
          color: #000; 
          font-weight: bold; 
        }
        
        .nav-section-title { 
          font-size: 11px; 
          color: #999; 
          margin-top: 20px; 
          margin-bottom: 5px; 
          text-transform: uppercase; 
          letter-spacing: 2px; 
        }
        
        .folder-link { 
          text-transform: capitalize; 
          letter-spacing: 1px; 
        }

        /* Main Content */
        main { 
          margin-left: 280px; 
          flex-grow: 1; 
          padding: 50px 40px; 
          min-height: 100vh; 
        }
        
        .photo-grid { 
          column-count: 3; 
          column-gap: 20px; 
        }
        
        .grid-item { 
          break-inside: avoid; 
          margin-bottom: 20px; 
          cursor: pointer; 
          position: relative; 
        }
        
        .grid-item img { 
          width: 100%; 
          height: auto; 
          display: block; 
          transition: opacity 0.3s ease; 
        }
        
        .grid-item:hover img { 
          opacity: 0.85; 
        }

        /* Static Pages & Images */
        .static-page { 
          max-width: 800px; 
          line-height: 1.8; 
          font-family: sans-serif; 
          letter-spacing: normal; 
        }
        
        .static-page h2 { 
          margin-bottom: 20px; 
          font-weight: normal; 
          font-family: 'US101', sans-serif; 
          letter-spacing: 2px; 
          text-transform: uppercase; 
        }
        
        .static-page p { 
          margin-bottom: 15px; 
          color: #444; 
        }
        
        .static-page a { 
          color: #000; 
          font-weight: 500; 
        }
        
        .static-image { 
          width: 100%; 
          max-height: 600px; 
          object-fit: cover; 
          margin-bottom: 40px; 
          display: block; 
        }

        /* Responsive Design */
        @media (max-width: 1200px) { 
          .photo-grid { column-count: 2; } 
        }
        
        @media (max-width: 768px) {
          body { flex-direction: column; }
          aside { position: relative; width: 100%; height: auto; padding: 30px 20px; border-bottom: 1px solid #efefef; }
          aside nav { margin-top: 25px; flex-direction: row; flex-wrap: wrap; gap: 20px; }
          main { margin-left: 0; padding: 20px; }
          .photo-grid { column-count: 1; }
        }

        /* Lightbox */
        #lightbox {
          display: none; position: fixed; z-index: 999;
          top: 0; left: 0; width: 100vw; height: 100vh;
          background: rgba(255,255,255,0.95);
          justify-content: center; align-items: center;
          padding: 40px; opacity: 0; transition: opacity 0.3s ease;
        }
        
        #lightbox.visible { opacity: 1; }
        #lightbox img { max-width: 100%; max-height: 100%; object-fit: contain; box-shadow: 0 10px 40px rgba(0,0,0,0.1); }
        #lightbox-close { position: absolute; top: 30px; right: 40px; color: #000; font-size: 40px; cursor: pointer; user-select: none; font-family: sans-serif; }
      </style>
    </head>
    <body>
      <aside>
        <h1><a href="/">BRAD JARVIS</a></h1>
        <nav>
          <a href="/" ${isHome ? 'class="active"' : ''}>Home</a>
          <a href="/about" ${isAbout ? 'class="active"' : ''}>About</a>
          <a href="/contact" ${isContact ? 'class="active"' : ''}>Contact</a>
          
          <div class="nav-section-title">Gallery</div>
          ${sidebarLinksHtml || '<span style="color:#aaa;font-size:11px;">No folders yet</span>'}
        </nav>
      </aside>
      <main>
        ${mainContentHtml}
      </main>

      <div id="lightbox" onclick="closeLightbox()">
        <span id="lightbox-close">&times;</span>
        <img id="lightbox-img" src="" alt="Expanded View" />
      </div>

      <script>
        function openLightbox(src) {
          const lightbox = document.getElementById('lightbox');
          document.getElementById('lightbox-img').src = src;
          lightbox.style.display = 'flex';
          setTimeout(() => lightbox.classList.add('visible'), 10);
        }
        function closeLightbox() {
          const lightbox = document.getElementById('lightbox');
          lightbox.classList.remove('visible');
          setTimeout(() => lightbox.style.display = 'none', 300);
        }
      </script>
    </body>
    </html>
  `;

  return new Response(html, {
    headers: { "Content-Type": "text/html;charset=UTF-8" }
  });
}