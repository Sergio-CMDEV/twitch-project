// Mini script para probar el token de Twitch y consultar datos públicos
let fetch;
try {
  fetch = require('node-fetch');
} catch (e) {
  if (typeof globalThis.fetch === 'function') {
    fetch = globalThis.fetch;
  } else {
    throw new Error('No se pudo cargar fetch. Instala node-fetch o usa Node 18+');
  }
}

// Pega aquí tu client_id y client_secret manualmente
const client_id = 'TU_CLIENT_ID';
const client_secret = 'TU_CLIENT_SECRET';
const channel = 'DearBird'; // Cambia si quieres otro canal

async function main() {
  try {
    // 1. Obtener token de app
    const tokenRes = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `client_id=${client_id}&client_secret=${client_secret}&grant_type=client_credentials`
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      console.error('No se pudo obtener token:', tokenData);
      return;
    }
    const accessToken = tokenData.access_token;
    console.log('✅ Token obtenido:', accessToken);

    // 2. Consultar estado del stream
    const twitchRes = await fetch(`https://api.twitch.tv/helix/streams?user_login=${channel}`, {
      headers: {
        'Client-ID': client_id,
        'Authorization': `Bearer ${accessToken}`
      }
    });
    const streamData = await twitchRes.json();
    console.log('Respuesta de /helix/streams:', streamData);

    // 3. Consultar clips
    // Primero obtener el user_id
    const userRes = await fetch(`https://api.twitch.tv/helix/users?login=${channel}`, {
      headers: {
        'Client-ID': client_id,
        'Authorization': `Bearer ${accessToken}`
      }
    });
    const userData = await userRes.json();
    const userId = userData.data?.[0]?.id;
    if (!userId) {
      console.error('No se encontró el usuario:', userData);
      return;
    }
    const clipsRes = await fetch(`https://api.twitch.tv/helix/clips?broadcaster_id=${userId}&first=3`, {
      headers: {
        'Client-ID': client_id,
        'Authorization': `Bearer ${accessToken}`
      }
    });
    const clipsData = await clipsRes.json();
    console.log('Respuesta de /helix/clips:', clipsData);
  } catch (e) {
    console.error('Error general:', e);
  }
}

main();
