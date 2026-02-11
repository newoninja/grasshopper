const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const SITE_ORIGIN = process.env.SITE_ORIGIN || 'https://shopgrasshopper.com';
const { buildCorsHeaders, jsonResponse, methodNotAllowed, parseJsonBody } = require('./request-utils');
const { buildDiscountResponse, resolvePromoCode } = require('./promo-utils');

exports.handler = async (event) => {
    const headers = buildCorsHeaders(SITE_ORIGIN);

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    if (event.httpMethod !== 'POST') {
        return methodNotAllowed(headers);
    }

    const parsed = parseJsonBody(event, headers);
    if (!parsed.ok) return parsed.response;

    try {
        if (!SQUARE_ACCESS_TOKEN) {
            return jsonResponse(200, headers, { valid: false, message: 'Promo service unavailable' });
        }
        const { code } = parsed.body;
        const resolved = await resolvePromoCode(SQUARE_ACCESS_TOKEN, code);
        if (!resolved.valid) {
            return jsonResponse(200, headers, { valid: false, message: resolved.message || 'Invalid promo code' });
        }
        return jsonResponse(200, headers, buildDiscountResponse(resolved));
    } catch (err) {
        console.error('Validate promo error:', err);
        return jsonResponse(200, headers, { valid: false, message: 'Unable to validate promo code. Please try again.' });
    }
};
