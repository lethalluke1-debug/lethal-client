/**
 * Real Microsoft account login for Minecraft: Java Edition.
 *
 * Two sign-in flows are implemented:
 *   - browserLogin(): opens the user's actual default browser to a real
 *     Microsoft login page, then automatically catches the redirect on a
 *     local loopback server. No code to copy, no embedded password field.
 *   - deviceCodeLogin(): the fallback "enter this code" flow, kept in case
 *     the browser-based one can't run in some environment.
 *
 * Both flows finish with the same steps:
 *   1. Get a Microsoft access token
 *   2. Exchange it for an Xbox Live token
 *   3. Exchange that for an XSTS token
 *   4. Exchange that for a Minecraft Services access token
 *   5. Check the account actually owns Minecraft: Java Edition
 *
 * There is deliberately no "offline" or "cracked" login path here — step 5
 * is a real ownership check against Mojang's servers, and login fails for
 * any account that hasn't purchased the game.
 *
 * You need your own Microsoft Azure "public client" app registration to
 * use this (see README.md → "Microsoft Azure app registration"), and that
 * app also needs to be approved by Microsoft for the XboxLive.signin scope
 * (see README.md → "Getting your app approved for Xbox/Minecraft login").
 * Put the Application (client) ID in config.json as `msClientId`.
 */

const http = require('http');
const crypto = require('crypto');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formBody(obj) {
  return Object.entries(obj)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

function base64url(buffer) {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function buildConfirmationPage({ error, username } = {}) {
  const title = error ? 'Sign-in failed' : "You're signed in";
  const message = error
    ? `${error} — you can close this tab and try again.`
    : 'You can close this tab and go back to Lethal Client.';
  const icon = error
    ? `<svg viewBox="0 0 24 24" width="40" height="40"><circle cx="12" cy="12" r="11" fill="none" stroke="#d95a5a" stroke-width="2"/><path d="M8 8l8 8M16 8l-8 8" stroke="#d95a5a" stroke-width="2" stroke-linecap="round"/></svg>`
    : `<svg viewBox="0 0 24 24" width="40" height="40"><circle cx="12" cy="12" r="11" fill="none" stroke="#5cb37d" stroke-width="2"/><path d="M7 12.5l3 3 7-7" stroke="#5cb37d" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const headImg = !error && username
    ? `<img class="skinhead" src="https://minotar.net/avatar/${encodeURIComponent(username)}/72.png" alt="">`
    : '';
  const greeting = !error && username ? `<div class="greeting">Welcome, ${username}</div>` : '';

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Lethal Client</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&family=Rubik:wght@400;600&display=swap');
  *{ margin:0; padding:0; box-sizing:border-box; }
  html,body{ height:100%; font-family:'Rubik',sans-serif; }
  body{
    position:relative;
    display:flex; align-items:center; justify-content:center;
    background:linear-gradient(180deg, #2a2035 0%, #4a2e3a 35%, #6b3f3f 55%, #1a1414 100%);
    overflow:hidden;
  }
  .sun{
    position:absolute; left:50%; top:30%; transform:translate(-50%,-50%);
    width:220px; height:220px; border-radius:50%;
    background:radial-gradient(circle, rgba(255,200,140,.9), rgba(255,157,61,.15) 70%, transparent 100%);
    filter:blur(2px);
  }
  .hill{
    position:absolute; left:0; right:0; bottom:0; height:22vh;
    clip-path: polygon(0% 60%, 8% 45%, 20% 55%, 32% 35%, 46% 50%, 58% 30%, 72% 48%, 86% 32%, 100% 46%, 100% 100%, 0% 100%);
  }
  .hill-back{ background:#2e2438; height:26vh; opacity:.8; }
  .hill-front{ background:#1c1620; height:18vh; }
  .card{
    position:relative; z-index:2;
    width:360px; background:rgba(23,27,31,.92); border:1px solid #2e353b; border-radius:14px;
    padding:36px 32px; text-align:center;
    backdrop-filter:blur(6px);
  }
  .brandmark{
    width:48px; height:48px; margin:0 auto 18px;
    background:linear-gradient(135deg, #ff9d3d 0%, #b3661f 100%);
    border-radius:11px;
    display:flex; align-items:center; justify-content:center;
    font-family:'Press Start 2P'; font-size:16px; color:#1a1200;
  }
  .icon{ margin:6px 0 16px; }
  h1{ color:#e9e6dd; font-size:18px; margin-bottom:10px; }
  p{ color:#8b9299; font-size:13.5px; line-height:1.5; }
  .skinhead{
    width:64px; height:64px; border-radius:12px; image-rendering:pixelated;
    margin:0 auto 14px; display:block;
    box-shadow:0 0 0 1px rgba(0,0,0,.4), 0 6px 16px rgba(255,157,61,.25);
  }
  .greeting{ font-family:'Press Start 2P'; font-size:12px; color:var(--text,#e9e6dd); margin-bottom:14px; }
</style></head>
<body>
  <div class="sun"></div>
  <div class="hill hill-back"></div>
  <div class="hill hill-front"></div>
  <div class="card">
    <div class="brandmark">LC</div>
    ${headImg}
    ${greeting}
    <div class="icon">${icon}</div>
    <h1>${title}</h1>
    <p>${message}</p>
  </div>
</body></html>`;
}

/**
 * Steps 2-6 shared by both login flows: turns a Microsoft access token
 * into a verified Minecraft account (token + uuid + username).
 */
async function finishLoginWithMicrosoftToken(msAccessToken) {
  // Xbox Live auth
  const xblRes = await fetch('https://user.auth.xboxlive.com/user/authenticate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      Properties: {
        AuthMethod: 'RPS',
        SiteName: 'user.auth.xboxlive.com',
        RpsTicket: `d=${msAccessToken}`,
      },
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT',
    }),
  });
  const xbl = await xblRes.json();
  const uhs = xbl.DisplayClaims.xui[0].uhs;

  // XSTS token
  const xstsRes = await fetch('https://xsts.auth.xboxlive.com/xsts/authorize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.Token] },
      RelyingParty: 'rp://api.minecraftservices.com/',
      TokenType: 'JWT',
    }),
  });
  const xsts = await xstsRes.json();
  if (xstsRes.status === 401) {
    if (xsts.XErr === 2148916233) {
      throw new Error('This Microsoft account has no Xbox account. Create one at xbox.com and try again.');
    }
    if (xsts.XErr === 2148916238) {
      throw new Error('This account is a child account and needs a family group before it can sign in.');
    }
    throw new Error('Xbox Live authorization failed.');
  }

  // Minecraft Services token
  const mcRes = await fetch('https://api.minecraftservices.com/authentication/login_with_xbox', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identityToken: `XBL3.0 x=${uhs};${xsts.Token}`,
    }),
  });
  const mc = await mcRes.json();

  console.log("Minecraft Services status:", mcRes.status);
  console.log("Minecraft Services response:", mc);

  if (!mc.access_token) {
    throw new Error(
      `Could not get a Minecraft access token. Microsoft said: ${JSON.stringify(mc)}`
    );
  }

  // REAL ownership check — this is what stops this from being a "cracked"
  // login. If the account hasn't bought the game, this 404s.
  const profileRes = await fetch('https://api.minecraftservices.com/minecraft/profile', {
    headers: { Authorization: `Bearer ${mc.access_token}` },
  });
  if (profileRes.status !== 200) {
    throw new Error('This Microsoft account does not own Minecraft: Java Edition.');
  }
  const profile = await profileRes.json();

  return {
    minecraftAccessToken: mc.access_token,
    uuid: profile.id,
    username: profile.name,
  };
}

/**
 * Opens the system's default browser to a real Microsoft login page, and
 * catches the redirect on a local loopback server — no code to type,
 * no password typed into an unknown app window.
 *
 * Requires "http://localhost" to be registered as a redirect URI on the
 * Azure app (under Authentication → Mobile and desktop applications).
 */
async function browserLogin(clientId, openUrl) {
  const codeVerifier = base64url(crypto.randomBytes(32));
  const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest());
  const state = base64url(crypto.randomBytes(16));

  let capturedPort = null;

  const { code, redirectUri, res } = await new Promise((resolve, reject) => {
    const server = http.createServer((req, httpRes) => {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname !== '/') return;

      const returnedState = url.searchParams.get('state');
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error_description') || url.searchParams.get('error');

      if (error) {
        httpRes.writeHead(200, { 'Content-Type': 'text/html' });
        httpRes.end(buildConfirmationPage({ error }));
        server.close();
        return reject(new Error(error));
      }
      if (returnedState !== state) {
        const msg = 'Sign-in state mismatch — please try again.';
        httpRes.writeHead(200, { 'Content-Type': 'text/html' });
        httpRes.end(buildConfirmationPage({ error: msg }));
        server.close();
        return reject(new Error(msg));
      }
      if (!code) {
        const msg = 'No authorization code returned.';
        httpRes.writeHead(200, { 'Content-Type': 'text/html' });
        httpRes.end(buildConfirmationPage({ error: msg }));
        server.close();
        return reject(new Error(msg));
      }

      // Don't respond yet — keep this one connection open so we can show
      // the real username once sign-in actually finishes, instead of a
      // generic "you're signed in" before we even know who that is.
      const redirectUri = `http://localhost:${capturedPort}`;
      server.close(); // stop accepting NEW connections; this one stays open
      resolve({ code, redirectUri, res: httpRes });
    });

    server.listen(0, '127.0.0.1', () => {
      capturedPort = server.address().port;
      const redirectUri = `http://localhost:${capturedPort}`;
      const authUrl = new URL('https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize');
      authUrl.search = formBody({
        client_id: clientId,
        response_type: 'code',
        redirect_uri: redirectUri,
        response_mode: 'query',
        scope: 'XboxLive.signin offline_access',
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        prompt: 'select_account',
      });
      openUrl(authUrl.toString());
    });

    server.on('error', reject);

    // Safety timeout so a window doesn't hang forever if the user never finishes
    setTimeout(() => {
      server.close();
      reject(new Error('Sign-in timed out — please try again.'));
    }, 5 * 60 * 1000);
  });

  try {
    const tokenRes = await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody({
        client_id: clientId,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
    });
    const tokenData = await tokenRes.json();
    if (tokenData.error) {
      throw new Error(tokenData.error_description || tokenData.error);
    }

    const account = await finishLoginWithMicrosoftToken(tokenData.access_token);
    account.refreshToken = tokenData.refresh_token;

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(buildConfirmationPage({ username: account.username }));

    return account;
  } catch (err) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(buildConfirmationPage({ error: err.message }));
    throw err;
  }
}

/**
 * Fallback flow: shows a code, the user enters it on a separate page.
 * Kept in case the browser-redirect flow can't run in some environment.
 */
async function deviceCodeLogin(clientId, onUserCode) {
  const deviceRes = await fetch(
    'https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody({
        client_id: clientId,
        scope: 'XboxLive.signin offline_access',
      }),
    }
  );
  const device = await deviceRes.json();
  if (!device.device_code) {
    throw new Error(device.error_description || 'Could not start Microsoft sign-in.');
  }

  onUserCode({ userCode: device.user_code, verificationUri: device.verification_uri });

  const expiresAt = Date.now() + device.expires_in * 1000;
  let msToken = null;

  while (Date.now() < expiresAt) {
    await sleep((device.interval || 5) * 1000);

    const tokenRes = await fetch(
      'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formBody({
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          client_id: clientId,
          device_code: device.device_code,
        }),
      }
    );
    const tokenData = await tokenRes.json();

    if (tokenData.error === 'authorization_pending') continue;
    if (tokenData.error) {
      throw new Error(tokenData.error_description || tokenData.error);
    }
    msToken = tokenData;
    break;
  }

  if (!msToken) throw new Error('Sign-in timed out — please try again.');

  return finishLoginWithMicrosoftToken(msToken.access_token);
}

/**
 * Uses a saved refresh token to silently sign back in on app startup — no
 * browser window, no user interaction. Throws if the refresh token is
 * expired/revoked, which just means the user needs to sign in normally again.
 */
async function refreshLogin(clientId, refreshToken) {
  const tokenRes = await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formBody({
      client_id: clientId,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: 'XboxLive.signin offline_access',
    }),
  });
  const tokenData = await tokenRes.json();
  if (tokenData.error) {
    throw new Error(tokenData.error_description || tokenData.error);
  }

  const account = await finishLoginWithMicrosoftToken(tokenData.access_token);
  account.refreshToken = tokenData.refresh_token || refreshToken; // MS sometimes rotates it
  return account;
}

module.exports = { browserLogin, deviceCodeLogin, refreshLogin };
