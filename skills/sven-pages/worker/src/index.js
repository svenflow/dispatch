/**
 * Sven Pages Worker
 *
 * Serves static pages from KV with per-folder ACL support.
 * Authentication via Cloudflare Access (email OTP or Google OAuth).
 *
 * KV Key Structure:
 * - pages/{folder}/{path} -> file content (with metadata for content-type)
 * - acls/{folder} -> JSON array of allowed emails, e.g. ["user@example.com"]
 * - acls/{folder} = "*" means public (no auth required)
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Health check
    if (path === '/_health') {
      return new Response('ok', { status: 200 });
    }

    // API endpoints for managing pages
    if (path.startsWith('/_api/')) {
      return handleApi(request, env, path);
    }

    // Serve static content
    return servePage(request, env, path);
  }
};

/**
 * Handle API requests (requires admin auth)
 */
async function handleApi(request, env, path) {
  // Check for API key auth (for CLI access)
  const authHeader = request.headers.get('Authorization') || '';
  const apiKey = authHeader.replace('Bearer ', '');

  if (apiKey && env.API_KEY && apiKey === env.API_KEY) {
    // API key is valid - proceed
  } else {
    // Check admin auth via Cloudflare Access JWT
    const identity = await getAccessIdentity(request, env);
    if (!identity) {
      return jsonResponse({ error: 'Unauthorized - provide API key or Cloudflare Access token' }, 401);
    }

    // Only admins can use API
    const adminEmails = (env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase());
    if (!adminEmails.includes(identity.email.toLowerCase())) {
      return jsonResponse({ error: 'Forbidden - admin only' }, 403);
    }
  }

  const apiPath = path.replace('/_api/', '');

  // PUT /_api/upload/{folder}/{path} - Upload file
  if (request.method === 'PUT' && apiPath.startsWith('upload/')) {
    const filePath = apiPath.replace('upload/', '');
    const content = await request.arrayBuffer();
    const contentType = request.headers.get('content-type') || 'application/octet-stream';

    await env.SVEN_PAGES.put(`pages/${filePath}`, content, {
      metadata: { contentType }
    });

    return jsonResponse({ success: true, path: filePath });
  }

  // PUT /_api/acl/{folder} - Set ACL
  if (request.method === 'PUT' && apiPath.startsWith('acl/')) {
    const folder = apiPath.replace('acl/', '');
    const body = await request.json();
    const emails = body.emails; // Array of emails or "*" for public

    await env.SVEN_PAGES.put(`acls/${folder}`, JSON.stringify(emails));

    return jsonResponse({ success: true, folder, acl: emails });
  }

  // GET /_api/acl/{folder} - Get ACL
  if (request.method === 'GET' && apiPath.startsWith('acl/')) {
    const folder = apiPath.replace('acl/', '');
    const acl = await env.SVEN_PAGES.get(`acls/${folder}`);

    if (!acl) {
      return jsonResponse({ folder, acl: null });
    }

    return jsonResponse({ folder, acl: JSON.parse(acl) });
  }

  // GET /_api/list/{folder?} - List files
  if (request.method === 'GET' && (apiPath === 'list' || apiPath.startsWith('list/'))) {
    const prefix = apiPath === 'list' ? 'pages/' : `pages/${apiPath.replace('list/', '')}/`;
    const list = await env.SVEN_PAGES.list({ prefix });

    const files = list.keys.map(k => ({
      path: k.name.replace('pages/', ''),
      metadata: k.metadata
    }));

    return jsonResponse({ files });
  }

  // DELETE /_api/delete/{folder}/{path} - Delete file or folder
  if (request.method === 'DELETE' && apiPath.startsWith('delete/')) {
    const deletePath = apiPath.replace('delete/', '');

    // If path ends with /, delete all files in folder
    if (deletePath.endsWith('/')) {
      const prefix = `pages/${deletePath}`;
      const list = await env.SVEN_PAGES.list({ prefix });

      for (const key of list.keys) {
        await env.SVEN_PAGES.delete(key.name);
      }

      // Also delete ACL
      const folder = deletePath.slice(0, -1);
      await env.SVEN_PAGES.delete(`acls/${folder}`);

      return jsonResponse({ success: true, deleted: list.keys.length });
    }

    // Delete single file
    await env.SVEN_PAGES.delete(`pages/${deletePath}`);
    return jsonResponse({ success: true, path: deletePath });
  }

  return jsonResponse({ error: 'Not found' }, 404);
}

/**
 * Serve a page from KV
 */
async function servePage(request, env, path) {
  // Normalize path
  let pagePath = path === '/' ? '/index.html' : path;
  if (!pagePath.includes('.')) {
    // No extension - try adding /index.html
    pagePath = pagePath.endsWith('/') ? `${pagePath}index.html` : `${pagePath}/index.html`;
  }

  // Extract folder name (first path segment)
  const segments = pagePath.split('/').filter(Boolean);
  const folder = segments[0] || '';

  // Check ACL
  const acl = await env.SVEN_PAGES.get(`acls/${folder}`);
  const isPublic = acl === '"*"' || acl === '*';

  if (!isPublic) {
    // Requires authentication - check Cloudflare Access
    const identity = await getAccessIdentity(request, env);

    if (!identity) {
      // Not authenticated - return 401 with link to authenticate
      return new Response(`
        <!DOCTYPE html>
        <html>
        <head><title>Authentication Required</title></head>
        <body>
          <h1>Authentication Required</h1>
          <p>Please <a href="/.auth/login">log in</a> to access this page.</p>
        </body>
        </html>
      `, {
        status: 401,
        headers: { 'Content-Type': 'text/html' }
      });
    }

    // Check if user is in ACL
    if (acl) {
      const allowedEmails = JSON.parse(acl);
      if (Array.isArray(allowedEmails)) {
        const userEmail = identity.email.toLowerCase();
        const allowed = allowedEmails.some(e => e.toLowerCase() === userEmail);

        if (!allowed) {
          return new Response(`
            <!DOCTYPE html>
            <html>
            <head><title>Access Denied</title></head>
            <body>
              <h1>Access Denied</h1>
              <p>Your email (${identity.email}) is not authorized to view this page.</p>
            </body>
            </html>
          `, {
            status: 403,
            headers: { 'Content-Type': 'text/html' }
          });
        }
      }
    } else {
      // No ACL defined - deny by default (require explicit ACL)
      return new Response(`
        <!DOCTYPE html>
        <html>
        <head><title>Not Configured</title></head>
        <body>
          <h1>Page Not Configured</h1>
          <p>This page has not been configured with access permissions.</p>
        </body>
        </html>
      `, {
        status: 403,
        headers: { 'Content-Type': 'text/html' }
      });
    }
  }

  // Fetch content from KV
  const kvKey = `pages${pagePath}`;
  const { value, metadata } = await env.SVEN_PAGES.getWithMetadata(kvKey, { type: 'arrayBuffer' });

  if (!value) {
    // Try without /index.html suffix
    const altPath = pagePath.replace('/index.html', '');
    if (altPath !== pagePath) {
      const { value: altValue, metadata: altMeta } = await env.SVEN_PAGES.getWithMetadata(`pages${altPath}`, { type: 'arrayBuffer' });
      if (altValue) {
        return new Response(altValue, {
          headers: {
            'Content-Type': altMeta?.contentType || 'application/octet-stream',
            'Cache-Control': 'public, max-age=3600'
          }
        });
      }
    }

    return new Response('Not Found', { status: 404 });
  }

  const contentType = metadata?.contentType || getContentType(pagePath);

  return new Response(value, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=3600'
    }
  });
}

/**
 * Get user identity from Cloudflare Access JWT
 */
async function getAccessIdentity(request, env) {
  // Get JWT from cookie or header
  const cookie = request.headers.get('Cookie') || '';
  const cfAccessJwt = cookie.match(/CF_Authorization=([^;]+)/)?.[1];
  const headerJwt = request.headers.get('Cf-Access-Jwt-Assertion');

  const jwt = cfAccessJwt || headerJwt;
  if (!jwt) return null;

  try {
    // Verify JWT with Cloudflare Access
    // The JWT contains the user's email in the payload
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;

    const payload = JSON.parse(atob(parts[1]));

    // Check expiration
    if (payload.exp && payload.exp < Date.now() / 1000) {
      return null;
    }

    return {
      email: payload.email,
      name: payload.name || payload.email,
      sub: payload.sub
    };
  } catch (e) {
    console.error('JWT decode error:', e);
    return null;
  }
}

/**
 * Get content type from file extension
 */
function getContentType(path) {
  const ext = path.split('.').pop()?.toLowerCase();
  const types = {
    'html': 'text/html',
    'htm': 'text/html',
    'css': 'text/css',
    'js': 'application/javascript',
    'json': 'application/json',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'svg': 'image/svg+xml',
    'ico': 'image/x-icon',
    'woff': 'font/woff',
    'woff2': 'font/woff2',
    'ttf': 'font/ttf',
    'pdf': 'application/pdf',
    'txt': 'text/plain',
    'xml': 'application/xml'
  };
  return types[ext] || 'application/octet-stream';
}

/**
 * JSON response helper
 */
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
