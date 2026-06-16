/**
 * Pollfinity SMS Opt-In Handler
 * Cloudflare Pages Function — /api/optin
 * Receives form POST, appends a row to optins.csv in R2 bucket.
 */

export async function onRequestPost(context) {
  const { request, env } = context;

  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': 'https://pollfinity.com',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  try {
    const formData = await request.formData();

    const firstName  = (formData.get('first_name')  || '').trim();
    const lastName   = (formData.get('last_name')   || '').trim();
    const phone      = (formData.get('phone')       || '').trim();
    const email      = (formData.get('email')       || '').trim();
    const zip        = (formData.get('zip')         || '').trim();
    const state      = (formData.get('state')       || '').trim();
    const party      = (formData.get('party')       || '').trim();
    const age        = (formData.get('age_range')   || '').trim();
    const timestamp  = new Date().toISOString();

    // Basic validation
    if (!firstName || !lastName || !phone || !zip || !state) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // Escape CSV fields
    const escape = v => `"${v.replace(/"/g, '""')}"`;
    const row = [timestamp, firstName, lastName, phone, email, zip, state, party, age]
      .map(escape)
      .join(',') + '\n';

    const CSV_KEY = 'optins.csv';
    const HEADER  = '"timestamp","first_name","last_name","phone","email","zip","state","party","age_range"\n';

    // Read existing CSV (or start fresh)
    let existing = '';
    const obj = await env.POLLFINITY_OPTINS.get(CSV_KEY);
    if (obj) {
      existing = await obj.text();
    } else {
      existing = HEADER;
    }

    const updated = existing + row;

    await env.POLLFINITY_OPTINS.put(CSV_KEY, updated, {
      httpMetadata: { contentType: 'text/csv' },
    });

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: 'Server error', detail: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}

// Handle CORS preflight
export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': 'https://pollfinity.com',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
