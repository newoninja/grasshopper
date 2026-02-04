const fetch = require('node-fetch');

const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const SQUARE_BASE_URL = 'https://connect.squareup.com/v2';

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
        const { items } = JSON.parse(event.body);

        // Get location ID
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

        const locationId = locationData.locations[0].id;

        const lineItems = items.map(item => ({
            quantity: item.quantity.toString(),
            catalog_object_id: item.variationId,
            item_type: 'ITEM'
        }));

        // Calculate shipping: $5 per item
        const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
        const shippingAmount = totalItems * 500;

        const checkoutResponse = await fetch(`${SQUARE_BASE_URL}/online-checkout/payment-links`, {
            method: 'POST',
            headers: {
                'Square-Version': '2024-01-18',
                'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                idempotency_key: `checkout-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                order: {
                    location_id: locationId,
                    line_items: lineItems,
                    service_charges: [{
                        name: 'Shipping',
                        amount_money: { amount: shippingAmount, currency: 'USD' },
                        calculation_phase: 'SUBTOTAL_PHASE'
                    }]
                },
                checkout_options: {
                    allow_tipping: false,
                    ask_for_shipping_address: true
                }
            })
        });

        const checkoutData = await checkoutResponse.json();

        if (checkoutData.payment_link) {
            return { statusCode: 200, headers, body: JSON.stringify({ checkoutUrl: checkoutData.payment_link.url }) };
        } else {
            console.error('Checkout error:', checkoutData);
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'Failed to create checkout' }) };
        }
    } catch (error) {
        console.error('Error:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to create checkout' }) };
    }
};
