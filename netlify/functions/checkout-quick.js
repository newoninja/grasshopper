const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const { getShippingCost } = require('./shipping-data');
const SITE_ORIGIN = process.env.SITE_ORIGIN || 'https://shopgrasshopper.com';
const { fetchSquareJson, getCatalogObject, getLocationId } = require('./square-utils');
const { buildCorsHeaders, jsonResponse, methodNotAllowed, parseJsonBody } = require('./request-utils');

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
        const { variationId, quantity = 1 } = parsed.body;
        const qty = Number.parseInt(quantity, 10);
        if (!variationId || !Number.isFinite(qty) || qty < 1 || qty > 100) {
            return jsonResponse(400, headers, { error: 'Invalid item payload' });
        }
        if (!SQUARE_ACCESS_TOKEN) {
            return jsonResponse(500, headers, { error: 'Checkout service not configured' });
        }
        console.log('Legacy endpoint used: checkout-quick.js');

        const locationId = await getLocationId(SQUARE_ACCESS_TOKEN);

        // Get product info to calculate proper shipping
        let shippingAmount = 750 * qty; // Default $7.50 per item
        try {
            const variationObj = await getCatalogObject(SQUARE_ACCESS_TOKEN, variationId);
            const variationName = variationObj?.item_variation_data?.name || 'Standard';
            const parentItemId = variationObj?.item_variation_data?.item_id;
            if (parentItemId) {
                const parentObj = await getCatalogObject(SQUARE_ACCESS_TOKEN, parentItemId);
                const productName = parentObj?.item_data?.name || '';
                const shippingPerUnit = getShippingCost(productName, variationName);
                shippingAmount = shippingPerUnit * qty;
            }
        } catch (err) {
            console.error('Error fetching product for shipping:', err);
        }

        const checkoutDataResponse = await fetchSquareJson(SQUARE_ACCESS_TOKEN, '/online-checkout/payment-links', {
            method: 'POST',
            body: {
                idempotency_key: `quick-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
                order: {
                    location_id: locationId,
                    line_items: [{
                        quantity: qty.toString(),
                        catalog_object_id: variationId,
                        item_type: 'ITEM'
                    }],
                    service_charges: [{
                        name: 'Shipping',
                        amount_money: { amount: shippingAmount, currency: 'USD' },
                        calculation_phase: 'SUBTOTAL_PHASE'
                    }]
                },
                checkout_options: {
                    allow_tipping: false,
                    ask_for_shipping_address: true,
                    accepted_payment_methods: {
                        apple_pay: true,
                        google_pay: true,
                        cash_app_pay: false,
                        afterpay_clearpay: false
                    }
                }
            }
        });

        const checkoutData = checkoutDataResponse.data;

        if (checkoutData.payment_link) {
            return jsonResponse(200, headers, { checkoutUrl: checkoutData.payment_link.url });
        } else {
            console.error('Checkout error:', checkoutData);
            return jsonResponse(400, headers, { error: 'Failed to create checkout' });
        }
    } catch (error) {
        console.error('Error:', error);
        return jsonResponse(500, headers, { error: 'Failed to create checkout' });
    }
};
