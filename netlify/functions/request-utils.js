function buildCorsHeaders(siteOrigin, extraHeaders = {}) {
  return {
    'Access-Control-Allow-Origin': siteOrigin,
    'Access-Control-Allow-Headers': 'Content-Type, x-admin-key',
    ...extraHeaders
  };
}

function jsonResponse(statusCode, headers, payload) {
  return {
    statusCode,
    headers: {
      ...headers,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  };
}

function methodNotAllowed(headers) {
  return jsonResponse(405, headers, { error: 'Method not allowed' });
}

function parseJsonBody(event, headers) {
  if (!event || typeof event.body !== 'string') {
    return { ok: true, body: {} };
  }

  try {
    const parsed = JSON.parse(event.body || '{}');
    return { ok: true, body: parsed && typeof parsed === 'object' ? parsed : {} };
  } catch (_error) {
    return {
      ok: false,
      response: jsonResponse(400, headers, { error: 'Invalid JSON body' })
    };
  }
}

function getHeader(headers, key) {
  if (!headers || !key) return undefined;
  const target = String(key).toLowerCase();
  const matchedKey = Object.keys(headers).find((headerKey) => headerKey.toLowerCase() === target);
  return matchedKey ? headers[matchedKey] : undefined;
}

module.exports = {
  buildCorsHeaders,
  getHeader,
  jsonResponse,
  methodNotAllowed,
  parseJsonBody
};
