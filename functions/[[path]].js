// --- CONFIGURATION ---
// Give this password to Brad for the mobile upload portal
const UPLOAD_PASSWORD = "brad_upload_123";

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  
  let path = decodeURIComponent(url.pathname);
  if (path.startsWith('/')) path = path.slice(1);
  if (path.endsWith('/')) path = path.slice(0, -1);

  // --- HANDLE SECURE MOBILE UPLOADS ---
  if (request.method === 'POST' && path === 'api/upload') {
    const authHeader = request.headers.get('Authorization');
    if (authHeader !== `Bearer ${UPLOAD_PASSWORD}`) {
      return new Response("Unauthorized password", { status: 401 });
    }

    try {
      const formData = await request.formData();
      const file = formData.get('file');
      const folderRaw = formData.get('folder');
      
      if (!file) return new Response("No file provided", { status: 400 });

      let targetFolder = (folderRaw || 'Uploads').trim().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9-_]/g, '');
      const cleanFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
      
      const uniqueFileName = `${targetFolder}/${Date.now()}_${cleanFileName}`;

      await env.PHOTOS_BUCKET.put(uniqueFileName, file, {
        httpMetadata: { contentType: file.type }
      });

      return new Response("Success", { status: 200 });
    } catch (e) {
      return new Response(e.message, { status: 500 });
    }
  }

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
  const isUploadPortal = path.toLowerCase() === 'upload-portal';
  const isHome = path === '';
  const activeFolder = (isAbout || isContact || isHome || isUploadPortal) ? '' : path;

  // 3. GET FOLDERS FOR SIDEBAR & UPLOAD DROPDOWN
  const rootList = await env.PHOTOS_BUCKET.list({ delimiter: '/' });
  const folders = rootList.delimitedPrefixes.map(p => p.slice(0, -1)); 

  // 4. FETCH IMAGES
  let images = [];
  if (isHome) {
    const homeFoldersToLoad = ['Featured']; 
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

  images.sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true, sensitivity: 'base' }));

  // 5. RENDER SIDEBAR LINKS
  const sidebarLinksHtml = folders.map(folder => {
    const displayName = folder.replace(/_/g, ' ').replace(/-/g, ' ');
    const isActive = folder === activeFolder ? 'class="active"' : '';
    return `<a class="folder-link" href="/${encodeURIComponent(folder)}" ${isActive}>${displayName}</a>`;
  }).join('\n');

  const folderOptionsHtml = folders.map(folder => {
    const displayName = folder.replace(/_/g, ' ').replace(/-/g, ' ');
    return `<option value="${folder}">${displayName}</option>`;
  }).join('\n');

  // 6. RENDER MAIN CONTENT AREA
  let mainContentHtml = '';

  if (isUploadPortal) {
    mainContentHtml = `
      <div class="static-page" style="max-width: 400px; margin: 0 auto; text-align: center; padding-top: 50px;">
        <h2>Gallery Live Upload</h2>
        <p style="font-size: 14px; margin-bottom: 30px;">Select an existing folder or create a new one to instantly add photos to the site.</p>
        
        <form id="mobileUploadForm" style="display: flex; flex-direction: column; gap: 20px;">
          <input type="password" id="uploadPass" placeholder="Enter Secret Password" required style="padding: 15px; font-size: 16px; border: 1px solid #ccc; border-radius: 4px;">
          
          <select id="folderSelect" required style="padding: 15px; font-size: 16px; border: 1px solid #ccc; border-radius: 4px; background: #fff; cursor: pointer;">
            <option value="" disabled selected>Choose a Folder...</option>
            ${folderOptionsHtml}
            <option value="NEW_FOLDER">-- ➕ Create New Folder --</option>
          </select>

          <input type="text" id="newFolderInput" placeholder="Enter New Folder Name" style="display: none; padding: 15px; font-size: 16px; border: 1px solid #ccc; border-radius: 4px;">

          <label style="background: #f4f4f4; border: 2px dashed #ccc; padding: 40px 20px; cursor: pointer; border-radius: 4px; font-weight: bold;">
            Tap to Select Photos
            <input type="file" id="uploadFiles" multiple accept="image/*" required style="display: none;">
          </label>
          <div id="fileCount" style="font-size: 12px; color: #777;">No files selected</div>
          
          <button type="submit" style="background: #000; color: #fff; padding: 15px; font-size: 16px; font-weight: bold; border: none; cursor: pointer; border-radius: 4px; text-transform: uppercase; letter-spacing: 1px;">Start Upload</button>
        </form>
        
        <div id="uploadStatus" style="margin-top: 20px; font-weight: bold; color: #333;"></div>
      </div>

      <script>
        document.getElementById('folderSelect').addEventListener('change', function(e) {
          const newFolderInput = document.getElementById('newFolderInput');
          if (e.target.value === 'NEW_FOLDER') {
            newFolderInput.style.display = 'block';
            newFolderInput.required = true;
          } else {
            newFolderInput.style.display = 'none';
            newFolderInput.required = false;
            newFolderInput.value = '';
          }
        });

        document.getElementById('uploadFiles').addEventListener('change', function(e) {
          const count = e.target.files.length;
          document.getElementById('fileCount').innerText = count > 0 ? count + " photo(s) selected" : "No files selected";
        });

        document.getElementById('mobileUploadForm').addEventListener('submit', async (e) => {
          e.preventDefault();
          const pass = document.getElementById('uploadPass').value;
          const files = document.getElementById('uploadFiles').files;
          const folderSelect = document.getElementById('folderSelect').value;
          const newFolderInput = document.getElementById('newFolderInput').value;
          
          const targetFolder = folderSelect === 'NEW_FOLDER' ? newFolderInput : folderSelect;
          const statusDiv = document.getElementById('uploadStatus');
          
          const submitBtn = e.target.querySelector('button');
          submitBtn.disabled = true;
          submitBtn.style.background = '#ccc';

          let successCount = 0;

          for (let i = 0; i < files.length; i++) {
            statusDiv.innerText = \`Uploading photo \${i + 1} of \${files.length}...\`;
            
            const formData = new FormData();
            formData.append('file', files[i]);
            formData.append('folder', targetFolder);

            try {
              const res = await fetch('/api/upload', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + pass },
                body: formData
              });

              if (!res.ok) {
                const errorText = await res.text();
                statusDiv.innerText = \`Error on photo \${i + 1}: \${errorText}\`;
                submitBtn.disabled = false;
                submitBtn.style.background = '#000';
                return;
              }
              successCount++;
            } catch (err) {
              statusDiv.innerText = "Network error occurred.";
              submitBtn.disabled = false;
              submitBtn.style.background = '#000';
              return;
            }
          }
          
          statusDiv.innerText = \`Successfully uploaded \${successCount} photo(s) to \${targetFolder}!\`;
          statusDiv.style.color = "green";
          document.getElementById('uploadFiles').value = "";
          document.getElementById('fileCount').innerText = "No files selected";
          submitBtn.disabled = false;
          submitBtn.style.background = '#000';
        });
      </script>
    `;
  } else if (isAbout) {
    mainContentHtml = `
      <div class="static-page">
        <img src="/about.jpg" alt="Brad Jarvis" class="static-image" />
        <h2>About</h2>
        <p> </p>
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

  const pageTitle = activeFolder ? activeFolder.replace(/_/g, ' ') : (isAbout ? 'About' : (isContact ? 'Contact' : (isUploadPortal ? 'Upload' : 'Portfolio')));
  
  const siteUrl = url.origin; 
  const ogImageUrl = `${siteUrl}/about.jpg`;
  const pageDescription = "Photography Portfolio of Brad Jarvis";
  
  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Brad Jarvis | ${pageTitle}</title>
      <meta property="og:title" content="Brad Jarvis | ${pageTitle}">
      <meta property="og:description" content="${pageDescription}">
      <meta property="og:image" content="${ogImageUrl}">
      <meta property="og:url" content="${url.href}">
      <meta property="og:type" content="website">
      <meta name="twitter:card" content="summary_large_image">
      <meta name="twitter:title" content="Brad Jarvis | ${pageTitle}">
      <meta name="twitter:description" content="${pageDescription}">
      <meta name="twitter:image" content="${ogImageUrl}">
      <link rel="icon" type="image/png" href="/favicon.png">
      <style>
        @font-face {
          font-family: 'US101';
          src: url('/US101.woff') format('woff'), url('/US101.ttf') format('truetype');
          font-weight: normal; font-style: normal; font-display: swap;
        }
        
        * { box-sizing: border-box; margin: 0; padding: 0; }
        
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #fff; color: #111; display: flex; }
        
        .mobile-header { display: none; }
        .mobile-overlay { display: none; }
        .close-menu-btn { display: none; }

        /* Sidebar set to flex to push social icon to the bottom */
        aside { 
          position: fixed; left: 0; top: 0; bottom: 0; width: 280px; padding: 50px 40px; 
          overflow-y: auto; z-index: 1000; background: #fff; 
          display: flex; flex-direction: column; justify-content: space-between;
        }
        
        .sidebar-top { flex-grow: 1; }
        .sidebar-bottom { margin-top: 40px; }

        /* Social Icon Styling */
        .social-link { display: inline-block; color: #111; transition: opacity 0.2s ease; }
        .social-link:hover { opacity: 0.6; }
        .social-link svg { width: 20px; height: 20px; }
        
        .desktop-brand { font-family: 'US101', sans-serif; font-size: 26px; font-weight: normal; text-decoration: none; color: #000; text-transform: uppercase; letter-spacing: 0px; -webkit-font-smoothing: antialiased; }
        .desktop-brand a { color: inherit; text-decoration: none; }
        
        aside nav { margin-top: 50px; display: flex; flex-direction: column; gap: 30px; }
        .nav-group { display: flex; flex-direction: column; gap: 15px; }
        aside nav a { text-decoration: none; color: #555; font-size: 13px; transition: color 0.2s; text-transform: uppercase; letter-spacing: 1.5px; }
        aside nav a:hover, aside nav a.active { color: #000; font-weight: bold; }
        
        .nav-section-title { font-size: 11px; color: #999; margin-bottom: 15px; text-transform: uppercase; letter-spacing: 2px; display: flex; justify-content: space-between; align-items: center; }
        .nav-section-title .arrow { display: none; }
        .folder-links { display: flex; flex-direction: column; gap: 15px; }
        .folder-link { text-transform: capitalize; letter-spacing: 1px; }

        main { margin-left: 280px; flex-grow: 1; padding: 50px 40px; min-height: 100vh; }
        .photo-grid { column-count: 3; column-gap: 20px; }
        .grid-item { break-inside: avoid; margin-bottom: 20px; cursor: pointer; position: relative; }
        .grid-item img { width: 100%; height: auto; display: block; transition: opacity 0.3s ease; }
        .grid-item:hover img { opacity: 0.85; }

        .static-page { max-width: 800px; line-height: 1.8; font-family: sans-serif; letter-spacing: normal; }
        .static-page h2 { margin-bottom: 20px; font-weight: normal; font-family: 'US101', sans-serif; letter-spacing: 1px; text-transform: uppercase; -webkit-font-smoothing: antialiased; }
        .static-page p { margin-bottom: 15px; color: #444; }
        .static-page a { color: #000; font-weight: 500; }
        .static-image { width: 100%; max-height: 600px; object-fit: cover; margin-bottom: 40px; display: block; }

        @media (max-width: 1200px) { .photo-grid { column-count: 2; } }
        
        @media (max-width: 768px) {
          body { flex-direction: column; }
          
          .mobile-header { 
            display: flex; align-items: center; justify-content: center;
            position: fixed; top: 0; left: 0; width: 100%; height: 60px;
            background: #fff; z-index: 900; border-bottom: 1px solid #efefef;
          }
          
          .mobile-header h1 { font-family: 'US101', sans-serif; font-size: 24px; font-weight: normal; letter-spacing: 0px; text-transform: uppercase; -webkit-font-smoothing: antialiased; }
          .mobile-header a { color: #000; text-decoration: none; }
          
          .hamburger-btn { position: absolute; left: 15px; background: none; border: none; cursor: pointer; padding: 10px; }
          .hamburger-btn span { display: block; width: 22px; height: 2px; background: #000; margin: 5px 0; border-radius: 1px; }

          aside { 
            position: fixed; top: 0; left: -100%; width: 280px; max-width: 80%; height: 100vh; 
            background: #fff; z-index: 1000; transition: left 0.3s ease; padding: 40px 30px;
            border-right: none; box-shadow: 2px 0 15px rgba(0,0,0,0.1);
          }
          aside.open { left: 0; }
          .desktop-brand { display: block; margin-top: 15px; } 
          
          .close-menu-btn { display: block; background: none; border: none; font-size: 11px; font-weight: bold; letter-spacing: 1px; text-transform: uppercase; cursor: pointer; color: #000; margin-bottom: 20px; }
          
          .mobile-overlay { display: none; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.4); z-index: 950; opacity: 0; transition: opacity 0.3s ease; }
          .mobile-overlay.open { display: block; opacity: 1; }

          main { margin-left: 0; padding: 80px 15px 30px; } 
          .photo-grid { column-count: 1; }
          
          aside nav { margin-top: 30px; gap: 20px; }
          .nav-group { flex-direction: column; gap: 15px; }
          .nav-section-title { cursor: pointer; padding: 10px 0; border-top: 1px solid #efefef; border-bottom: 1px solid #efefef; margin-bottom: 0; color: #000; font-weight: 500; }
          .nav-section-title .arrow { display: block; font-size: 10px; transition: transform 0.3s ease; }
          .nav-section-title.open .arrow { transform: rotate(180deg); }
          .folder-links { display: none; padding: 15px 0 0 5px; }
          .folder-links.open { display: flex; }
        }

        #lightbox { display: none; position: fixed; z-index: 9999; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(255,255,255,0.95); justify-content: center; align-items: center; padding: 40px; opacity: 0; transition: opacity 0.3s ease; }
        #lightbox.visible { opacity: 1; }
        #lightbox img { max-width: 100%; max-height: 100%; object-fit: contain; box-shadow: 0 10px 40px rgba(0,0,0,0.1); }
        #lightbox-close { position: absolute; top: 30px; right: 40px; color: #000; font-size: 40px; cursor: pointer; user-select: none; font-family: sans-serif; }
      </style>
    </head>
    <body>

      <div class="mobile-header">
        <button class="hamburger-btn" onclick="toggleMobileNav()">
          <span></span><span></span><span></span>
        </button>
        <h1><a href="/">BRAD JARVIS</a></h1>
      </div>

      <div class="mobile-overlay" id="mobile-overlay" onclick="toggleMobileNav()"></div>

      <aside id="main-sidebar">
        <div class="sidebar-top">
          <button class="close-menu-btn" onclick="toggleMobileNav()">&#8592; CLOSE</button>
          <div class="desktop-brand"><a href="/">BRAD JARVIS</a></div>
          
          <nav>
            <div class="nav-group">
              <a href="/" ${isHome ? 'class="active"' : ''}>Portfolio</a>
              <a href="/about" ${isAbout ? 'class="active"' : ''}>About</a>
              <a href="/contact" ${isContact ? 'class="active"' : ''}>Contact</a>
            </div>
            <div class="gallery-group">
              <div class="nav-section-title" id="gallery-toggle" onclick="toggleGalleryAccordion()">
                Galleries <span class="arrow">▼</span>
              </div>
              <div class="folder-links" id="folder-links">
                ${sidebarLinksHtml || '<span style="color:#aaa;font-size:11px;">No folders yet</span>'}
              </div>
            </div>
          </nav>
        </div>
        
        <div class="sidebar-bottom">
          <a href="https://instagram.com/bradjarv.is/" target="_blank" class="social-link" aria-label="Instagram">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect>
              <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path>
              <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line>
            </svg>
          </a>
        </div>
      </aside>
      
      <main>${mainContentHtml}</main>
      
      <div id="lightbox" onclick="closeLightbox()">
        <span id="lightbox-close">&times;</span>
        <img id="lightbox-img" src="" alt="Expanded View" />
      </div>
      
      <script>
        function toggleMobileNav() {
          const sidebar = document.getElementById('main-sidebar');
          const overlay = document.getElementById('mobile-overlay');
          sidebar.classList.toggle('open');
          overlay.classList.toggle('open');
        }

        function toggleGalleryAccordion() {
          if (window.innerWidth <= 768) {
            document.getElementById('folder-links').classList.toggle('open');
            document.getElementById('gallery-toggle').classList.toggle('open');
          }
        }
        
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
