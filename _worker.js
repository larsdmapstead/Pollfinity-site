/**
 * Pollfinity _worker.js
 * Cloudflare Pages Advanced Mode Worker
 * Handles /api/optin POST — all other requests served as static assets.
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Handle opt-in form submissions
    if (url.pathname === '/api/optin') {
      return handleOptin(request, env);
    }

    // All other requests: serve static assets
    return env.ASSETS.fetch(request);
  }
};

const CORS = {
  'Access-Control-Allow-Origin': 'https://pollfinity.com',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

async function handleOptin(request, env) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const formData = await request.formData();

    const firstName = (formData.get('first_name') || '').trim();
    const lastName  = (formData.get('last_name')  || '').trim();
    const phone     = (formData.get('phone')      || '').trim();
    const email     = (formData.get('email')      || '').trim();
    const zip       = (formData.get('zip')        || '').trim();
    const state     = (formData.get('state')      || '').trim();
    const party     = (formData.get('party')      || '').trim();
    const age       = (formData.get('age_range')  || '').trim();
    const timestamp = new Date().toISOString();

    if (!firstName || !lastName || !phone || !zip || !state) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }

    const escape = v => `"${v.replace(/"/g, '""')}"`;
    const row = [timestamp, firstName, lastName, phone, email, zip, state, party, age]
      .map(escape).join(',') + '\n';

    const CSV_KEY = '***';
    const HEADER  = '"timestamp","first_name","last_name","phone","email","zip","state","party","age_range"\n';

    if (!env.POLLFINITY_OPTINS) {
      throw new Error('R2 binding POLLFINITY_OPTINS missing');
    }

    const obj = await env.POLLFINITY_OPTINS.get(CSV_KEY);
    const existing = obj ? await obj.text() : HEADER;
    const updated = existing + row;

    await env.POLLFINITY_OPTINS.put(CSV_KEY, updated, {
      httpMetadata: { contentType: 'text/csv' },
    });

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...CORS },
    });

  } catch (err) {
    console.error('Optin error:', err.message);
    return new Response(JSON.stringify({ error: 'Server error', detail: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }
}
