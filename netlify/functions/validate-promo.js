// Promo code validation
// Add codes here as needed
const PROMO_CODES = {
    'WELCOME10': { type: 'percent', value: 10, message: '10% off your order!' },
    'GRASSHOPPER15': { type: 'percent', value: 15, message: '15% off your order!' },
    'FREESHIP': { type: 'fixed', value: 0, message: 'Free shipping applied!', freeShipping: true },
};

exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    try {
        const { code } = JSON.parse(event.body);
        const promo = PROMO_CODES[code?.toUpperCase()];

        if (promo) {
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    valid: true,
                    code: code.toUpperCase(),
                    type: promo.type,
                    value: promo.value,
                    message: promo.message,
                    freeShipping: promo.freeShipping || false
                })
            };
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ valid: false, message: 'Invalid promo code' })
        };
    } catch (err) {
        return { statusCode: 400, headers, body: JSON.stringify({ valid: false, message: 'Invalid request' }) };
    }
};
