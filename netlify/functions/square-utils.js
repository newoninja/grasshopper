const SQUARE_BASE_URL = 'https://connect.squareup.com/v2';
const SQUARE_VERSION = '2024-01-18';

const locationCache = {
  expiresAt: 0,
  locationId: null
};

const catalogObjectCache = new Map();
const catalogListCache = new Map();

function getSquareHeaders(accessToken, version = SQUARE_VERSION) {
  return {
    'Square-Version': version,
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  };
}

async function fetchSquareJson(accessToken, path, options = {}) {
  const {
    method = 'GET',
    body,
    version = SQUARE_VERSION
  } = options;

  const response = await fetch(`${SQUARE_BASE_URL}${path}`, {
    method,
    headers: getSquareHeaders(accessToken, version),
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await response.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (_error) {
      data = {};
    }
  }

  return { ok: response.ok, status: response.status, data, rawText: text };
}

async function getLocationId(accessToken, ttlMs = 10 * 60 * 1000) {
  const now = Date.now();
  if (locationCache.locationId && locationCache.expiresAt > now) {
    return locationCache.locationId;
  }

  const { ok, status, data } = await fetchSquareJson(accessToken, '/locations');
  if (!ok || !data.locations?.length) {
    const message = data.errors?.[0]?.detail || `Square location lookup failed (${status})`;
    throw new Error(message);
  }

  locationCache.locationId = data.locations[0].id;
  locationCache.expiresAt = now + ttlMs;
  return locationCache.locationId;
}

function getCachedEntry(map, key) {
  const entry = map.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    map.delete(key);
    return null;
  }
  return entry.value;
}

function setCachedEntry(map, key, value, ttlMs) {
  map.set(key, {
    value,
    expiresAt: Date.now() + ttlMs
  });
}

async function getCatalogObject(accessToken, objectId, ttlMs = 5 * 60 * 1000) {
  if (!objectId) return null;
  const cacheKey = `obj:${objectId}`;
  const cached = getCachedEntry(catalogObjectCache, cacheKey);
  if (cached) return cached;

  const { ok, status, data } = await fetchSquareJson(accessToken, `/catalog/object/${encodeURIComponent(objectId)}`);
  if (!ok) {
    const message = data.errors?.[0]?.detail || `Catalog object lookup failed (${status})`;
    throw new Error(message);
  }

  const objectData = data.object || null;
  if (objectData) setCachedEntry(catalogObjectCache, cacheKey, objectData, ttlMs);
  return objectData;
}

async function listCatalogObjectsByType(accessToken, type, ttlMs = 5 * 60 * 1000) {
  const cacheKey = `list:${type}`;
  const cached = getCachedEntry(catalogListCache, cacheKey);
  if (cached) return cached;

  const objects = [];
  let cursor = null;

  do {
    const query = cursor ? `?types=${encodeURIComponent(type)}&cursor=${encodeURIComponent(cursor)}` : `?types=${encodeURIComponent(type)}`;
    const { ok, status, data } = await fetchSquareJson(accessToken, `/catalog/list${query}`);
    if (!ok) {
      const message = data.errors?.[0]?.detail || `Catalog list lookup failed (${status})`;
      throw new Error(message);
    }
    if (Array.isArray(data.objects)) objects.push(...data.objects);
    cursor = data.cursor || null;
  } while (cursor);

  setCachedEntry(catalogListCache, cacheKey, objects, ttlMs);
  return objects;
}

module.exports = {
  fetchSquareJson,
  getCatalogObject,
  getLocationId,
  listCatalogObjectsByType
};
