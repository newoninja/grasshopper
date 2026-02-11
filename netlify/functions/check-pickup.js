// Check if a zip code is within pickup range
// Uses Haversine formula to calculate distance between coordinates

const STORE_LAT = 35.2271;  // 28212 coordinates
const STORE_LON = -80.8431;
const MAX_DISTANCE_MILES = 10;

function toRad(value) {
  return value * Math.PI / 180;
}

function getDistanceMiles(lat1, lon1, lat2, lon2) {
  const R = 3959; // Earth's radius in miles
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Simple zip to coordinates lookup for nearby zips
// In production, you'd use a full zip code database or API
const zipCoordinates = {
  '28212': { lat: 35.2271, lon: -80.8431 },
  '28213': { lat: 35.2940, lon: -80.8648 },
  '28214': { lat: 35.2826, lon: -80.9590 },
  '28215': { lat: 35.2485, lon: -80.7374 },
  '28216': { lat: 35.2635, lon: -80.8951 },
  '28217': { lat: 35.1849, lon: -80.9173 },
  '28226': { lat: 35.1349, lon: -80.8473 },
  '28269': { lat: 35.2968, lon: -80.7349 },
  '28262': { lat: 35.3029, lon: -80.7646 },
  '28205': { lat: 35.2207, lon: -80.8046 },
  '28206': { lat: 35.2435, lon: -80.8273 },
  '28208': { lat: 35.2268, lon: -80.8784 },
  '28210': { lat: 35.1491, lon: -80.8593 },
  '28211': { lat: 35.1849, lon: -80.8173 },
  '28270': { lat: 35.3474, lon: -80.7349 },
};

const SITE_ORIGIN = process.env.SITE_ORIGIN || 'https://shopgrasshopper.com';

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': SITE_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const { zipCode } = JSON.parse(event.body);

    if (!zipCode) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Zip code required' })
      };
    }

    const zip = zipCode.toString().trim();

    // Check if we have coordinates for this zip
    if (zipCoordinates[zip]) {
      const coords = zipCoordinates[zip];
      const distance = getDistanceMiles(STORE_LAT, STORE_LON, coords.lat, coords.lon);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          eligible: distance <= MAX_DISTANCE_MILES,
          distance: Math.round(distance * 10) / 10
        })
      };
    }

    // For unknown zip codes, try to use an external API or return not eligible
    // For now, return not eligible
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        eligible: false,
        distance: null
      })
    };
  } catch (error) {
    console.error('Error checking pickup eligibility:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to check eligibility' })
    };
  }
};
