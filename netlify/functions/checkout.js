const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const SQUARE_BASE_URL = 'https://connect.squareup.com/v2';
const { getShippingCost } = require('./shipping-data');

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

        // Fetch product details for each item to calculate shipping
        let totalShipping = 0;
        const lineItems = [];

        for (const item of items) {
            lineItems.push({
                quantity: item.quantity.toString(),
                catalog_object_id: item.variationId,
                item_type: 'ITEM'
            });

            // Get product info from Square to determine shipping cost
            try {
                const productResponse = await fetch(`${SQUARE_BASE_URL}/catalog/object/${item.variationId}`, {
                    method: 'GET',
                    headers: {
                        'Square-Version': '2024-01-18',
                        'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
                        'Content-Type': 'application/json'
                    }
                });

                if (productResponse.ok) {
                    const productData = await productResponse.json();
                    const variationName = productData.object?.item_variation_data?.name || 'Standard';

                    // Get parent item name
                    const itemId = productData.object?.item_variation_data?.item_id;
                    if (itemId) {
                        const itemResponse = await fetch(`${SQUARE_BASE_URL}/catalog/object/${itemId}`, {
                            method: 'GET',
                            headers: {
                                'Square-Version': '2024-01-18',
                                'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
                                'Content-Type': 'application/json'
                            }
                        });

                        if (itemResponse.ok) {
                            const itemData = await itemResponse.json();
                            const productName = itemData.object?.item_data?.name || '';
                            const shippingPerUnit = getShippingCost(productName, variationName);
                            totalShipping += shippingPerUnit * item.quantity;
                        }
                    }
                }
            } catch (err) {
                console.error('Error fetching product for shipping:', err);
                // Fallback to default shipping
                totalShipping += 750 * item.quantity; // $7.50 default
            }
        }

        const shippingAmount = totalShipping;

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
                    ask_for_shipping_address: true,
                    accepted_payment_methods: {
                        apple_pay: true,
                        google_pay: true,
                        cash_app_pay: false,
                        afterpay_clearpay: false
                    }
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
