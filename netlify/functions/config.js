const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const SQUARE_APPLICATION_ID = process.env.SQUARE_APPLICATION_ID;
const SQUARE_BASE_URL = 'https://connect.squareup.com/v2';
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

    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    try {
        if (!SQUARE_APPLICATION_ID) {
            return { statusCode: 500, headers, body: JSON.stringify({ error: 'SQUARE_APPLICATION_ID not configured' }) };
        }

        const locationResponse = await fetch(`${SQUARE_BASE_URL}/locations`, {
            method: 'GET',
            headers: {
                'Square-Version': '2024-01-18',
                'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });

        const locationData = await locationResponse.json();
        if (!locationData.locations?.length) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'No Square location found' }) };
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                applicationId: SQUARE_APPLICATION_ID,
                locationId: locationData.locations[0].id
            })
        };
    } catch (error) {
        console.error('Config error:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to load config' }) };
    }
};
